/*
 * LLM classification (docs/design/core.md §8.4; docs/ARCHITECTURE.md "Resolver" › "LLM classification is limited" and
 * "AI" › "Category mapping"). It runs only for a field nothing classified (no autocomplete token, name or id pattern,
 * label rule or saved answer) and only while settings.llm.classify is on. The LLM has no authority: it answers one of
 * TailorIT's categories or null, and the code decides what that means.
 * - Screening, before a field enters a batch (screenForClassify): its label, description and option labels against
 *   the sensitive terms (TailorIT's SENSITIVE_LABEL list, plus work permit, eligib*, visa, citizen*, consent, agree,
 *   authori[sz]e and share my/your data or information), and its options against the EEO decline vocabulary. A hit
 *   makes the field needs-user, and it is never sent.
 * - What goes out is visible text only (classifyItemOf): the label, never one known only from aria-label; the
 *   description; the section's slug; the first 20 usable options' clean labels, injected text cut. Each passes
 *   asUntrusted. Fields nothing could be learnt from (a file, a field with no label the LLM may see) are not sent.
 * - SERVER_CATEGORY_MAP maps each of TailorIT's 47 categories onto ours, by the field's section where one needs it: an
 *   employer, a job title, a location, the dates and the role's description in an employment entry are that entry's; a
 *   start date elsewhere is when the person can start. The six needs-user categories map to needs-user.
 * - judgeClassification accepts a category only when the field's kind can hold it and its class lets an LLM
 *   classification fill (CLASS_POLICIES' llmClassified: only the profile class). A lone checkbox and a field that
 *   offers a decline option never take an LLM-only category. Everything else is needs-user, with the suggested
 *   category shown. An accepted category scores CLASSIFY_LLM (0.70), so the field is always flagged (resolve.ts).
 * - The worker keeps the answers for the run only.
 */
import type { AutofillFieldCategory } from '../../contract/tailorit';
import { CLASSIFY_MAX_OPTIONS, CLASSIFY_TEXT_MAX } from '../confidence';
import type { FieldKind, Platform } from '../enums';
import { detectionViews } from '../guard/fold';
import { llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { cutAtWord } from '../text/fold';
import { normalize } from '../text/normalize';
import { asUntrusted } from '../text/untrusted';
import type { FieldKey, FieldSpec, SectionRef } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory } from '../types/intent';
import type { UntrustedText, VisibleText } from '../types/text';
import { EEO_QUESTIONS, type Vocab } from '../vocab/types';
import { CLASS_POLICIES, kindAllowed, policyClassOf, USER_ONLY_CATEGORIES } from './categories';
import { sectionKindOf, type SectionKind } from './labelRules';

/** One of TailorIT's classification categories (AUTOFILL_FIELD_CATEGORIES). */
export type ServerCategory = AutofillFieldCategory;

/** What a server category means here: one of our categories, one per section kind, or needs-user. */
export type ServerCategoryTarget = FieldCategory | 'needs-user' | Readonly<Record<SectionKind, FieldCategory>>;

/**
 * Every server category onto ours. Typed over the contract's list, so a category TailorIT adds fails the build until
 * it is mapped; test/contract.test.ts checks the keys against the copied list as well. An entry's answer comes from
 * the section's kind (labelRules' sectionKindOf) where the category is an employment entry's.
 */
export const SERVER_CATEGORY_MAP: Readonly<Record<ServerCategory, ServerCategoryTarget>> = {
  first_name: 'identity.firstName',
  middle_name: 'identity.middleName',
  last_name: 'identity.lastName',
  full_name: 'identity.fullName',
  preferred_name: 'identity.preferredName',
  email: 'contact.email',
  phone: 'contact.phone',
  phone_country_code: 'contact.phoneCountry',
  address_line1: 'address.line1',
  address_line2: 'address.line2',
  city: 'address.city',
  region: 'address.region',
  postal_code: 'address.postalCode',
  country: 'address.country',
  location: { experience: 'experience.location', education: 'location.current', other: 'location.current' },
  linkedin: 'links.linkedin',
  github: 'links.github',
  portfolio: 'links.portfolio',
  website: 'links.website',
  current_employer: 'experience.currentCompany',
  current_title: 'experience.currentTitle',
  employer: 'experience.company',
  job_title: 'experience.title',
  // The role a description is about is an entry's; outside one nothing says which.
  role_description: { experience: 'experience.description', education: 'unknown', other: 'unknown' },
  years_experience: 'experience.totalYears',
  school: 'education.school',
  degree: 'education.degree',
  field_of_study: 'education.field',
  graduation_date: 'education.endDate',
  gpa: 'education.gpa',
  language: 'languages.language',
  language_proficiency: 'languages.proficiency',
  skills: 'skills.list',
  start_date: { experience: 'experience.startDate', education: 'education.startDate', other: 'availability.startDate' },
  // An end date outside an entry ends nothing the profile holds.
  end_date: { experience: 'experience.endDate', education: 'education.endDate', other: 'unknown' },
  notice_period: 'availability.noticePeriod',
  relocation: 'preferences.relocation',
  work_arrangement: 'preferences.workArrangement',
  referral_source: 'referral.source',
  resume_upload: 'file.resume',
  cover_letter_upload: 'file.coverLetter',
  sensitive_eeo: 'needs-user',
  sensitive_legal: 'needs-user',
  sensitive_compensation: 'needs-user',
  consent: 'needs-user',
  attention_check: 'needs-user',
  free_text_question: 'needs-user',
};

/** Our category for a server category, by the field's section, or needs-user. */
export function mapServerCategory(category: ServerCategory, section: SectionRef): FieldCategory | 'needs-user' {
  const target = SERVER_CATEGORY_MAP[category];
  if (typeof target === 'string') return target;
  return target[sectionKindOf(section.id)];
}

/** Why a server category is the person's, as the panel words it. */
const NEEDS_USER_REASONS: Readonly<Partial<Record<ServerCategory, ReasonCode>>> = {
  consent: 'consent-requires-user',
  attention_check: 'attention-check',
  free_text_question: 'free-text-requires-user',
};

// ── Screening ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The sensitive-question terms: TailorIT's SENSITIVE_LABEL (apps/api/src/features/autofill/ai/screen.ts, as its design
 * lists it in docs/design/tailorit.md §3.5) plus the plan's additions. Matched over every detection view of the text
 * (guard/fold.ts), so a look-alike letter or a joiner cannot split a word. The extension screens at least as widely as
 * TailorIT, which screens every item again.
 */
export const SENSITIVE_TERMS: readonly RegExp[] = [
  // Work authorization (the plan's: work permit, eligib*, visa, citizen*, authori[sz]e).
  /\bauthori[sz]/, /\bsponsor/, /\bvisas?\b/, /\bcitizen/, /\bnationalit(?:y|ies)\b/, /\b(?:in)?eligib/,
  /\bwork\s*permits?\b/, /\bright\s+to\s+work\b/, /\bimmigra/, /\bgreen\s+card\b/, /\bclearance\b/,
  // Self-identification (EEO).
  /\bgender/, /\bsex(?:es|ual\w*)?\b/, /\btrans(?:gender|sexual)/, /\bpronouns?\b/, /\brac(?:e|es|ial)\b/, /\bethnic/,
  /\bhispanic/, /\blatin[aeox]s?\b/, /\bveterans?\b/, /\bmilitary\b/, /\bdisab/, /\breligio/, /\bmarital\b/,
  /\bself[\s-]*identif/, /\beeoc?\b/, /\bequal\s+(?:employment\s+)?opportunit/, /\borientation\b/,
  // Age.
  /\bages?\b/, /\bdate\s+of\s+birth\b/, /\bbirth\s*(?:date|day)\b/, /\bdob\b/, /\bhow\s+old\b/,
  /\b(?:at\s+least|over|under|older\s+than|younger\s+than)\s+(?:the\s+age\s+of\s+)?(?:16|18|19|21)\b/,
  /\b(?:16|18|19|21)\s*(?:years?|yrs?)\s+(?:of\s+age|old|or\s+(?:older|over))\b/,
  // Pay.
  /\bsalar(?:y|ies)\b/, /\bcompensation\b/, /\bpay\b/, /\bwages?\b/, /\bremuneration\b/,
  // Consent and agreement (the plan's: consent, agree, share my/your data or information).
  /\bconsent/, /\b(?:dis)?agree/, /\bprivacy\b/,
  /\bshare\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|info|details)\b/, /\bbackground\s+(?:check|screening)s?\b/,
  // Criminal history.
  /\bcriminal/, /\bconvict/, /\bfelon/, /\bmisdemeano/, /\barrest/,
  // Identity numbers.
  /\bsocial\s+security\b/, /\bssn\b/,
];

/** Whether page text names a sensitive topic, read in every detection view, in any case. */
export function namesSensitiveTopic(text: string): boolean {
  if (text.trim() === '') return false;
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    return SENSITIVE_TERMS.some((term) => term.test(lower));
  });
}

/** A sum of money ("$120,000", "120k", "USD 95000", "45 per hour"), as TailorIT's screen reads one. */
const MONEY: readonly RegExp[] = [
  /[$€£¥₹]\s*\d/, /\b(?:usd|eur|gbp|cad|aud|inr|chf|jpy)\s*\d/, /\b\d[\d,.]*\s*(?:k|usd|eur|gbp|cad|aud|inr|chf|jpy)\b/,
  /\b\d[\d,.]*\s*(?:per|an?|\/)\s*(?:year|yr|month|mo|hour|hr|annum)\b/,
];

/** Whether a value from the profile (a tiebreak's intended value or an alias) is one no LLM may see: a sensitive topic
 *  or a sum of money (TailorIT's isSensitiveValue). The core never builds such an item; the worker checks again. */
export function namesSensitiveValue(text: string): boolean {
  if (namesSensitiveTopic(text)) return true;
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    return MONEY.some((money) => money.test(lower));
  });
}

/** The option labels a field shows, clean (injected text cut) and non-empty; none for a lazy list. */
function cleanOptions(spec: Pick<FieldSpec, 'options'>): string[] {
  if (spec.options === 'lazy') return [];
  return spec.options.map((option) => cutInjected(option.label).clean.trim()).filter((label) => label !== '');
}

/** Whether a label (its answer-context key) is a decline phrase: the generic ones or any EEO question's own. */
function isDeclinePhrase(label: string, vocab: Vocab): boolean {
  const key = normalize(label, 'answer').key;
  if (key === '') return false;
  if (vocab.answers.decline.has(key)) return true;
  return EEO_QUESTIONS.some((question) => vocab.answers.eeo[question].decline.has(key));
}

/** Whether a field offers a decline option ("Prefer not to say", "I don't wish to answer"). */
export function offersDecline(spec: Pick<FieldSpec, 'options'>, vocab: Vocab): boolean {
  return cleanOptions(spec).some((label) => isDeclinePhrase(label, vocab));
}

/** Why a field may not enter a classify batch, or null when it may: a sensitive topic in its label, description or
 *  options ('sensitive'), or a decline option among its options ('decline'). Such a field is needs-user. */
export function screenForClassify(spec: Pick<FieldSpec, 'label' | 'description' | 'options'>, vocab: Vocab):
  'sensitive' | 'decline' | null {
  const options = cleanOptions(spec);
  if ([spec.label, spec.description, ...options].some(namesSensitiveTopic)) return 'sensitive';
  return options.some((label) => isDeclinePhrase(label, vocab)) ? 'decline' : null;
}

// ── The request ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One field for the LLM to classify: visible text only, each string made by asUntrusted. */
export interface ClassifyItem {
  /** The field's key: the item's identity, repeated in the answer. */
  key: FieldKey;
  platform: Platform;
  kind: FieldKind;
  label: UntrustedText;
  /** The field's visible description, '' when none. */
  hint: UntrustedText;
  /** The section's slug as words ("work experience"), '' for the form's main part. */
  section: UntrustedText;
  /** The first CLASSIFY_MAX_OPTIONS usable options' clean labels. */
  options: UntrustedText[];
}

/** Whether classification could tell anything about a field: not an upload (no LLM classification may attach a file),
 *  and with a label the LLM may see. */
export function classifiable(spec: Pick<FieldSpec, 'kind' | 'label' | 'labelSource'>): boolean {
  return spec.kind !== 'file' && llmMaySeeLabel(spec.labelSource) && spec.label.trim() !== '';
}

/** How much of a text is cleaned before it is cut to CLASSIFY_TEXT_MAX: the scanner's own caps are below it. */
const QUOTE_MAX = 2000;

/** The section id as the words it was made from: 'main' is no section. */
function sectionWords(section: SectionRef): string {
  return section.id === 'main' ? '' : section.id.replace(/[-_]+/g, ' ').trim();
}

/**
 * The classify item of a field (the caller has screened it: screenForClassify null), or null when classification could
 * tell nothing about it. The scanner read every label, description, section heading and option through visibleText;
 * FieldSpec carries them as plain strings.
 */
export function classifyItemOf(spec: FieldSpec): ClassifyItem | null {
  if (!classifiable(spec)) return null;
  // Cleaned whole, then cut after a whole word as TailorIT takes it; cutting only drops text, so it stays quotable.
  const quote = (text: string) =>
    cutAtWord(asUntrusted(text as VisibleText, QUOTE_MAX), CLASSIFY_TEXT_MAX) as UntrustedText;
  const label = quote(spec.label);
  if (label === '') return null;
  return {
    key: spec.key,
    platform: spec.platform,
    kind: spec.kind,
    label,
    hint: quote(spec.description),
    section: quote(sectionWords(spec.section)),
    options: cleanOptions(spec).slice(0, CLASSIFY_MAX_OPTIONS).map(quote).filter((option) => option !== ''),
  };
}

// ── The answer ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the LLM answered for one field, once the worker read TailorIT's result: a category, or why there is none
 *  ('unknown-field': it named none; 'llm-invalid-output', 'llm-unavailable'; 'llm-disabled-for-category': TailorIT
 *  screened it). */
export type ClassifyVerdict =
  | { key: FieldKey; category: ServerCategory; why: 'ok' }
  | { key: FieldKey; category: null; why: 'unknown-field' | 'llm-invalid-output' | 'llm-unavailable'
      | 'llm-disabled-for-category' };

/** What a classification means for one field. */
export type LlmClassification =
  /** Accepted: the field may be filled with this category, always flagged. */
  | { kind: 'category'; category: FieldCategory }
  /** The person's: nothing is filled. `category` is the suggestion the row shows ('unknown' when there is none). */
  | { kind: 'needs-user'; category: FieldCategory; reason: ReasonCode }
  /** Still nothing known: the field stays unknown, with this reason. */
  | { kind: 'none'; reason: ReasonCode };

/** The needs-user classification of a field that was screened, never sent. */
export const SCREENED: LlmClassification = { kind: 'needs-user', category: 'unknown', reason: 'llm-disabled-for-category' };

/**
 * Validates a classification in code (§8.4): the category maps onto ours, the field's kind can hold it, its class lets
 * an LLM classification fill (the profile class only), and the field is not a lone checkbox and offers no decline
 * option. Anything else is needs-user or nothing.
 */
export function judgeClassification(spec: Pick<FieldSpec, 'kind' | 'section' | 'options'>, verdict: ClassifyVerdict,
  vocab: Vocab): LlmClassification {
  if (verdict.category === null) {
    return verdict.why === 'llm-disabled-for-category' ? SCREENED : { kind: 'none', reason: verdict.why };
  }
  const target = mapServerCategory(verdict.category, spec.section);
  if (target === 'needs-user') {
    return { kind: 'needs-user', category: 'unknown',
      reason: NEEDS_USER_REASONS[verdict.category] ?? 'llm-disabled-for-category' };
  }
  if (target === 'unknown' || !kindAllowed(target, spec.kind)) return { kind: 'none', reason: 'unknown-field' };
  const fills = CLASS_POLICIES[policyClassOf(target)].llmClassified === 'fill-flagged' && !USER_ONLY_CATEGORIES.has(target);
  // A lone box would be ticked on the LLM's word alone; a decline option says the question is one only the person
  // answers (the design's rule for an LLM-only category).
  if (!fills || spec.kind === 'checkbox' || offersDecline(spec, vocab)) {
    return { kind: 'needs-user', category: target, reason: 'llm-disabled-for-category' };
  }
  return { kind: 'category', category: target };
}
