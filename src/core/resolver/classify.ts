/*
 * LLM classification (docs/design/core.md §8.4; docs/ARCHITECTURE.md "Resolver" › "LLM classification is limited" and
 * "AI" › "Category mapping"). It runs only for a field nothing classified (no autocomplete token, name or id pattern,
 * label rule or saved answer) and only while settings.llm.classify is on. The LLM has no authority: it answers one of
 * TailorIT's categories or null, and the code decides what that means.
 * - Screening, before a field enters a batch (screenForClassify): its label, description, section's words and option
 *   labels against the sensitive terms (TailorIT's SENSITIVE_LABEL list, plus work permit, eligib*, visa, citizen*,
 *   consent, agree, authori[sz]e and share my/your data or information, plus the Phase 4 review's shared terms, plus
 *   the Phase 6 review's sponsorship paraphrases), and its options against the EEO answers and the EEO decline
 *   vocabulary. A hit makes the field needs-user, and it is never sent. The same screen keeps a field from a saved
 *   answer and from Save my answer (resolve.ts, plan/frame.ts savable, T6-1) and from a draft (plan/drafts.ts, E2).
 * - A pick's value is screened by its category (namesSensitivePickValue): a school, a degree or a field of study only
 *   for a sum of money, any other also by the sensitive terms.
 * - What a box holds, before Edit with AI sends it to be rewritten (namesSensitiveAnswer): the sensitive terms and
 *   sums, an EEO answer or a decline phrase on a line of its own, and any contact detail or postal address, as
 *   TailorIT's screen reads the same text.
 * - What goes out is visible text only (classifyItemOf): the label, never one known only from aria-label; the
 *   description; the section's slug; the first 20 usable options' clean labels, injected text cut. Each passes
 *   asUntrusted. Fields nothing could be learnt from (a file, a field with no label the LLM may see) are not sent.
 * - SERVER_CATEGORY_MAP maps each of TailorIT's 47 categories onto ours, by the field's section where one needs it: an
 *   employer, a job title, a location, the dates and the role's description in an employment entry are that entry's; a
 *   start date elsewhere is when the person can start. The six needs-user categories map to needs-user; a free-text
 *   question among them is read as freeText.other on a box that can hold one (the owner's amendments,
 *   docs/SPEC-AMENDMENTS.md: it takes the run's draft or AI answer).
 * - judgeClassification accepts a category only when the field's kind can hold it and its class lets an LLM
 *   classification fill (CLASS_POLICIES' llmClassified: only the profile class). A lone checkbox and a field that
 *   offers a decline option never take an LLM-only category. A free-text category ('draft-only') stays the person's
 *   from the profile's side (needs-user, free-text-requires-user) and takes the run's draft or AI answer instead
 *   (plan/drafts.ts, plan/answers.ts). Everything else is needs-user, with the suggested category shown. An accepted
 *   category scores CLASSIFY_LLM (0.70), so the field is always flagged (resolve.ts).
 * - The worker keeps the answers for the run only.
 */
import type { AutofillFieldCategory } from '../../contract/tailorit';
import { CLASSIFY_MAX_OPTIONS, CLASSIFY_TEXT_MAX } from '../confidence';
import type { FieldKind, Platform } from '../enums';
import { CONFUSABLES, detectionViews } from '../guard/fold';
import { llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { cutAtWord, foldLetters, removeInvisibles } from '../text/fold';
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
 * The terms the Phase 4 review added to both TailorIT's SENSITIVE_LABEL and SENSITIVE_TERMS below (T-F1), as the lead
 * listed them, in that order: each alone names a sensitive topic. classify.test.ts pins this list, and TailorIT's tests
 * pin the same; the shared phrase fixture (sensitive-phrases.fixture.json, copied into TailorIT's tests) shows drift.
 */
export const SHARED_SENSITIVE_TERMS: readonly string[] = [
  // Pay.
  'hourly rate', 'rate of pay', 'CTC', 'current CTC', 'expected CTC', 'base salary', 'annual base', 'bonus', 'equity',
  'compensation expectations',
  // Self-identification (EEO). "orientation" is the EEO phrase only (the lead's word, 2026-10-30): never "Team
  // orientation".
  'Aboriginal', 'Torres Strait Islander', 'Indigenous', 'First Nations', 'visible minority', 'LGBTQ', 'LGBTQ+',
  'LGBTQIA', 'sexual orientation',
  // Disability, as the ADA defines it, with no "disab" word (the lead's word, 2026-10-30; the review's R4).
  'substantially limits', 'major life activity', 'major life activities',
  // Age.
  'year of birth', 'birth year', 'born',
  // Work authorization.
  'H-1B', 'H1B', 'OPT', 'CPT', 'TN', 'export control', 'U.S. person', 'clearance',
  // Criminal history.
  'guilty', 'offence', 'offense',
  // Identity numbers.
  'passport number', 'National Insurance', 'NI number',
  // Consent.
  'acknowledge', 'certify', 'accept the terms',
];

/** Work authorization. */
const AUTHORIZATION_TERMS: readonly RegExp[] = [
  // Work authorization (the plan's: work permit, eligib*, visa, citizen*, authori[sz]e; the review's: export control,
  // U.S. person, clearance; H-1B, OPT, CPT and TN are SENSITIVE_ACRONYMS').
  /\bauthori[sz]/, /\bsponsor/, /\bvisas?\b/, /\bcitizen/, /\bnationalit(?:y|ies)\b/, /\b(?:in)?eligib/,
  /\bwork\s*permits?\b/, /\bright\s+to\s+work\b/, /\blegally\s+(?:able|allowed|permitted|entitled)\b/, /\bimmigra/,
  /\bgreen\s+card\b/, /\bclearances?\b/, /\bexport\s+control/, /\bu\s*\.?\s*s\s*\.?\s+persons?\b/,
  // Sponsorship with no topic word (the Phase 6 review, T6-1): "Will you now or in the future require us to support
  // your employment?".
  /\bnow\s+or\s+in\s+the\s+future\b/, /\bsupport\s+(?:for\s+)?(?:your|my|their)\s+(?:employment|work)\b/,
];

/** Self-identification (EEO). */
const SELF_IDENTIFICATION_TERMS: readonly RegExp[] = [
  // Self-identification (EEO; the review's: Aboriginal, Torres Strait Islander, Indigenous, First Nations, visible
  // minority, LGBTQ and its longer forms, and orientation as the EEO phrase only: "sexual orientation", or orientation
  // within a few words of gender, LGBTQ or identity; "Team orientation" is none).
  /\bgender/, /\bsex(?:es|ual\w*)?\b/, /\btrans(?:gender|sexual)/, /\bpronouns?\b/, /\brac(?:e|es|ial)\b/, /\bethnic/,
  /\bhispanic/, /\blatin[aeox]s?\b/, /\bveterans?\b/, /\bmilitary\b/, /\bdisab/, /\breligio/, /\bmarital\b/,
  /\bself[\s-]*identif/, /\beeoc?\b/, /\bequal\s+(?:employment\s+)?opportunit/, /\baboriginal/,
  /\btorres\s+strait/, /\bindigenous\b/, /\bfirst\s+nations?\b/, /\bvisible\s+minorit/, /\blgbt/,
  /\bsexual\s+orientation\b/, /\b(?:identit|gender|lgbt)\w*\W+(?:\w+\W+){0,3}orientation\b/,
  /\borientation\W+(?:\w+\W+){0,3}(?:identit|gender|lgbt)/,
  // Disability as the ADA defines it, with no "disab" word ("a condition that substantially limits a major life
  // activity": the review's R4).
  /\bsubstantially\s+limit(?:s|ed|ing)?\b/, /\bmajor\s+life\s+activit(?:y|ies)\b/,
];

/** Age. */
const AGE_TERMS: readonly RegExp[] = [
  // Age (the review's: year of birth, birth year, born).
  /\bages?\b/, /\bdate\s+of\s+birth\b/, /\bbirth\s*(?:date|day)\b/, /\bdob\b/, /\bhow\s+old\b/,
  /\b(?:at\s+least|over|under|older\s+than|younger\s+than)\s+(?:the\s+age\s+of\s+)?(?:16|18|19|21)\b/,
  /\b(?:16|18|19|21)\s*(?:years?|yrs?)\s+(?:of\s+age|old|or\s+(?:older|over))\b/, /\byears?\s+of\s+birth\b/,
  /\bbirth\s*years?\b/, /\bborn\b/,
];

/** Pay. */
const PAY_TERMS: readonly RegExp[] = [
  // Pay (the review's: hourly rate, rate of pay, CTC, base salary, annual base, bonus, equity, compensation
  // expectations).
  /\bsalar(?:y|ies)\b/, /\bcompensation\b/, /\bpay\b/, /\bwages?\b/, /\bremuneration\b/, /\bhourly\s+rates?\b/,
  /\brates?\s+of\s+pay\b/, /\bctc\b/, /\bannual\s+base\b/, /\bbonus(?:es)?\b/, /\bequity\b/,
];

/** Consent and agreement. */
const CONSENT_TERMS: readonly RegExp[] = [
  // Consent and agreement (the plan's: consent, agree, share my/your data or information; the review's: acknowledge,
  // certify, accept the terms).
  /\bconsent/, /\b(?:dis)?agree/, /\bprivacy\b/,
  /\bshare\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|info|details)\b/, /\bbackground\s+(?:check|screening)s?\b/,
  /\backnowledg/, /\bcertif(?:y|ies|ied|ying)\b/, /\baccept(?:s|ed|ing)?\s+(?:all\s+)?(?:the\s+|these\s+|our\s+)?terms\b/,
];

/** Criminal history. */
const CRIMINAL_TERMS: readonly RegExp[] = [
  // Criminal history (the review's: guilty, offence, offense).
  /\bcriminal/, /\bconvict/, /\bfelon/, /\bmisdemeano/, /\barrest/, /\bguilty\b/, /\boffen[cs]es?\b/,
];

/** Identity numbers. */
const IDENTITY_NUMBER_TERMS: readonly RegExp[] = [
  // Identity numbers (the review's: passport number, National Insurance; NI number is SENSITIVE_ACRONYMS').
  /\bsocial\s+security\b/, /\bssn\b/, /\bpassport\s*(?:numbers?|no\b|#)/, /\bnational\s+insurance\b/,
];

/**
 * The sensitive-question terms: TailorIT's SENSITIVE_LABEL (apps/api/src/features/autofill/ai/screen.ts, as its design
 * lists it in docs/design/tailorit.md §3.5) plus the plan's additions and the Phase 4 review's (SHARED_SENSITIVE_TERMS,
 * on both sides). Matched over every detection view of the text (guard/fold.ts), and over each view with its spaced-out
 * letters closed up ("G e n d e r"), so a look-alike letter, a combining mark, a joiner or a space cannot split a word.
 * The short acronyms are SENSITIVE_ACRONYMS', matched in capitals only. The extension screens at least as widely as
 * TailorIT, which screens every item again.
 */
export const SENSITIVE_TERMS: readonly RegExp[] = [
  ...AUTHORIZATION_TERMS,
  ...SELF_IDENTIFICATION_TERMS,
  ...AGE_TERMS,
  ...PAY_TERMS,
  ...CONSENT_TERMS,
  ...CRIMINAL_TERMS,
  ...IDENTITY_NUMBER_TERMS,
];

/**
 * The short acronyms (the lead's word, 2026-10-30), matched case-sensitively, in capitals only, over the text as written
 * and its case-keeping fold (caseKept): OPT, CPT, TN and H-1B (H1B) for work authorization, NI for the National
 * Insurance number. In any case they would catch "Opt in to SMS updates"; TN right after a comma is a state written
 * after a city ("Nashville, TN"), not the visa.
 */
export const SENSITIVE_ACRONYMS: readonly RegExp[] = [
  /\bOPT\b/, /\bCPT\b/, /(?<!,\s*)\bTN\b/, /\bH\s*[-\u2010-\u2015]?\s*1\s*[-\u2010-\u2015]?\s*B\b/,
  /\bNI\s*(?:[Nn][Uu][Mm][Bb][Ee][Rr][Ss]?\b|[Nn][Oo]\b|#)/,
];
/** SENSITIVE_ACRONYMS' work-authorization four (OPT, CPT, TN, H-1B) and its identity number (NI). */
const AUTHORIZATION_ACRONYMS = SENSITIVE_ACRONYMS.slice(0, 4);
const IDENTITY_NUMBER_ACRONYMS = SENSITIVE_ACRONYMS.slice(4);

/** The extension's own criminal-history terms. */
const EXTENSION_CRIMINAL_TERMS: readonly RegExp[] = [
  // Criminal history.
  /\bcrimes?\b/, /\bcharged\s+with\b/, /\bpending\s+charges?\b/, /\bprobation\b/, /\bparole\b/, /\bincarcerat/,
  /\b(?:jail|prison)\b/, /\bsentenced\b/, /\bno\s+contest\b|\bnolo\b/,
];

/** The extension's own pay terms. */
const EXTENSION_PAY_TERMS: readonly RegExp[] = [
  // Pay ("on-target earnings" is OTE; a package is pay, but never a package manager, registry or version).
  /\bincome\b/, /\bote\b/, /\b(?:expected|desired|target|minimum|asking)\s+(?:base|rates?|earnings)\b/,
  /\b(?:current|day|daily|contract|billing)\s+(?:rates?|earnings)\b/,
  /\b(?:current|expected|desired|target|minimum|asking)\s+(?:salary\s+)?package\b(?!\s+(?:manager|management|registry|version))/,
  /\bwhat\s+rate\b/,
];

/** The extension's own identity and tax number terms. */
const EXTENSION_IDENTITY_NUMBER_TERMS: readonly RegExp[] = [
  // Identity and tax numbers.
  /\bsocial\s+insurance\b/, /\btax\s+(?:file|identification|id|reference|registration|payer)\s*(?:numbers?|no\b|#)/,
];

/**
 * The extension's own terms beyond the two pinned lists above: the ones TailorIT's server screen holds on its side only
 * (its stricter terms since API version 2), so a question that names them never leaves the extension for an AI either.
 * Matched as SENSITIVE_TERMS are (every detection view, in any case, spaced-out letters closed up). Neither the shared
 * list nor its phrase fixture holds them; classify.test.ts tests them here. A question the rules classify is still
 * answered from the profile (a criminal-history claim through its polarity, the salary the profile holds): this screen
 * only keeps text from the AI.
 */
export const EXTENSION_SENSITIVE_TERMS: readonly RegExp[] = [
  ...EXTENSION_CRIMINAL_TERMS,
  ...EXTENSION_PAY_TERMS,
  ...EXTENSION_IDENTITY_NUMBER_TERMS,
];

/** The extension's own acronyms, as SENSITIVE_ACRONYMS are matched (capitals only): SIN, Canada's Social Insurance
 *  Number, and TFN, Australia's Tax File Number. In any case they would catch "sin" and the like. */
export const EXTENSION_SENSITIVE_ACRONYMS: readonly RegExp[] = [/\bSIN\b/, /\bTFN\b/];

/** Every term and every acronym the screen reads: the pinned lists, then the extension's own. */
const SCREENED_TERMS: readonly RegExp[] = [...SENSITIVE_TERMS, ...EXTENSION_SENSITIVE_TERMS];
const SCREENED_ACRONYMS: readonly RegExp[] = [...SENSITIVE_ACRONYMS, ...EXTENSION_SENSITIVE_ACRONYMS];

/** The text with its case kept: invisible characters deleted, a look-alike letter read as its Latin letter (a capital
 *  as a capital), then decomposed with its combining marks deleted, so "OPT" in Cyrillic or full-width capitals reads
 *  "OPT". */
function caseKept(text: string): string {
  let out = '';
  for (const cp of removeInvisibles(text)) {
    const latin = CONFUSABLES.get(cp);
    out += latin === undefined ? cp : cp !== cp.toLowerCase() ? latin.toUpperCase() : latin;
  }
  return foldLetters(out);
}

/** Three or more single letters with one space or joiner between each ("g e n d e r", "p.a.s.s"), closed up. */
const SPACED_LETTERS = /(?<![\p{L}\p{N}])\p{L}(?:[ \-_.\u00B7]\p{L}(?![\p{L}\p{N}])){2,}/gu;

/** A view with its spaced-out letters closed up: a page can spell a word one letter at a time. */
function closedUp(view: string): string {
  return view.replace(SPACED_LETTERS, (run) => run.replace(/[ \-_.\u00B7]/g, ''));
}

/** Whether page text names a sensitive topic: the terms read in every detection view, in any case, and the acronyms
 *  in capitals, as written and in the case-keeping fold, spaced-out letters closed up in each (the pinned lists and the
 *  extension's own). */
export function namesSensitiveTopic(text: string): boolean {
  if (text.trim() === '') return false;
  const kept = caseKept(text);
  for (const view of new Set([text, kept, closedUp(text), closedUp(kept)])) {
    if (SCREENED_ACRONYMS.some((term) => term.test(view))) return true;
  }
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    const closed = closedUp(lower);
    return SCREENED_TERMS.some((term) => term.test(lower) || (closed !== lower && term.test(closed)));
  });
}

/**
 * What a sensitive term names (the owner's decision of 2026-11-01; TailorIT's SENSITIVE_TOPICS): with
 * settings.modes.ai 'all', a question of the open topics (OPEN_SCREEN_TOPICS) may be answered by TailorIT's AI,
 * and one of any other never is.
 */
export const SCREEN_TOPICS = ['authorization', 'self_identification', 'age', 'pay', 'consent', 'criminal',
  'identity_number'] as const;
export type ScreenTopic = (typeof SCREEN_TOPICS)[number];

/** The topics TailorIT's `all` answer scope asks about (its OPEN_TOPICS): work authorization (sponsorship, a visa,
 *  citizenship or residence status, a clearance, export control), age, pay and criminal history. */
export const OPEN_SCREEN_TOPICS: ReadonlySet<ScreenTopic> = new Set<ScreenTopic>(['authorization', 'age', 'pay',
  'criminal']);

/** Each topic's terms and acronyms, the pinned lists' and the extension's own: together, exactly the screen's. */
const TOPIC_SCREENS: ReadonlyArray<{ topic: ScreenTopic; terms: readonly RegExp[]; acronyms: readonly RegExp[] }> = [
  { topic: 'authorization', terms: AUTHORIZATION_TERMS, acronyms: AUTHORIZATION_ACRONYMS },
  { topic: 'self_identification', terms: SELF_IDENTIFICATION_TERMS, acronyms: [] },
  { topic: 'age', terms: AGE_TERMS, acronyms: [] },
  { topic: 'pay', terms: [...PAY_TERMS, ...EXTENSION_PAY_TERMS], acronyms: [] },
  { topic: 'consent', terms: CONSENT_TERMS, acronyms: [] },
  { topic: 'criminal', terms: [...CRIMINAL_TERMS, ...EXTENSION_CRIMINAL_TERMS], acronyms: [] },
  { topic: 'identity_number', terms: [...IDENTITY_NUMBER_TERMS, ...EXTENSION_IDENTITY_NUMBER_TERMS],
    acronyms: [...IDENTITY_NUMBER_ACRONYMS, ...EXTENSION_SENSITIVE_ACRONYMS] },
];

/** The topics page text names, read as namesSensitiveTopic reads it (so the set is empty exactly when it is false):
 *  "Will you now or in the future require sponsorship?" names authorization, "Gender" self-identification. */
export function sensitiveTopicsOf(text: string): Set<ScreenTopic> {
  const topics = new Set<ScreenTopic>();
  if (text.trim() === '') return topics;
  const kept = caseKept(text);
  const cased = [...new Set([text, kept, closedUp(text), closedUp(kept)])];
  const lowered = detectionViews(text).flatMap((view) => {
    const lower = view.toLowerCase();
    const closed = closedUp(lower);
    return closed === lower ? [lower] : [lower, closed];
  });
  for (const { topic, terms, acronyms } of TOPIC_SCREENS) {
    if (cased.some((view) => acronyms.some((term) => term.test(view)))
      || lowered.some((view) => terms.some((term) => term.test(view)))) topics.add(topic);
  }
  return topics;
}

/** A sum of money ("$120,000", "120k", "USD 95000", "45 per hour"), as TailorIT's screen reads one. */
const MONEY: readonly RegExp[] = [
  /[$€£¥₹]\s*\d/, /\b(?:usd|eur|gbp|cad|aud|inr|chf|jpy)\s*\d/, /\b\d[\d,.]*\s*(?:k|usd|eur|gbp|cad|aud|inr|chf|jpy)\b/,
  /\b\d[\d,.]*\s*(?:per|an?|\/)\s*(?:year|yr|month|mo|hour|hr|annum)\b/,
];

/** Whether text names a sum of money, read in every detection view. */
export function namesSum(text: string): boolean {
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    return MONEY.some((money) => money.test(lower));
  });
}

/** Whether a value from the profile (a tiebreak's intended value or an alias) is one no LLM may see: a sensitive topic
 *  or a sum of money (TailorIT's isSensitiveValue). The core never builds such an item; the worker checks again. */
export function namesSensitiveValue(text: string): boolean {
  return namesSensitiveTopic(text) || namesSum(text);
}

/** The pick categories whose values are names of schools, degrees and fields of study: "United States Military
 *  Academy" and "Gender Studies" are ordinary answers, so their topic words withhold nothing (the review, T-F4). */
const NAMED_BY_TOPIC_WORDS: ReadonlySet<string> = new Set(['school', 'degree', 'field_of_study']);

/** Whether a pick's value or alias of this category is one no LLM may see: for a school, a degree or a field of study
 *  only a sum of money (TailorIT then compares it with the person's sensitive answers), for any other category a
 *  sensitive topic or a sum (namesSensitiveValue). */
export function namesSensitivePickValue(text: string, category: string): boolean {
  return NAMED_BY_TOPIC_WORDS.has(category) ? namesSum(text) : namesSensitiveValue(text);
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

/** The answer keys of every EEO answer the vocabulary knows ("Woman", "Non-binary", "Asian", "White", "Black or
 *  African American"), but yes and no, which answer far more than EEO questions. One set per vocabulary. */
const EEO_ANSWER_KEYS = new WeakMap<Vocab, ReadonlySet<string>>();

function eeoAnswerKeys(vocab: Vocab): ReadonlySet<string> {
  let keys = EEO_ANSWER_KEYS.get(vocab);
  if (keys === undefined) {
    const { yes, no } = vocab.answers.polarity;
    keys = new Set(EEO_QUESTIONS.flatMap((question) => vocab.answers.eeo[question].values)
      .flatMap((value) => value.surfaces.map((surface) => surface.key))
      .filter((key) => key !== '' && !yes.has(key) && !no.has(key)));
    EEO_ANSWER_KEYS.set(vocab, keys);
  }
  return keys;
}

/** Whether an option's clean label is one of the EEO answers the vocabulary knows (its answer-context key). */
function isEeoAnswer(label: string, vocab: Vocab): boolean {
  const key = normalize(label, 'answer').key;
  return key !== '' && eeoAnswerKeys(vocab).has(key);
}

/**
 * Whether the option labels of an answer the person would save name what a saved answer may never answer (the Phase 6
 * review, T6-1): an EEO answer the vocabulary knows ("Woman", "Asian"), a decline phrase ("Prefer not to say"), or a
 * sensitive topic. Injected text is cut first. The worker reads it at Save my answer, whatever the question's label.
 */
export function namesUnsavableAnswer(labels: readonly string[], vocab: Vocab): boolean {
  return labels.some((label) => {
    const clean = cutInjected(label).clean.trim();
    return clean !== '' && (namesSensitiveTopic(clean) || isEeoAnswer(clean, vocab) || isDeclinePhrase(clean, vocab));
  });
}

// ── What a box holds (Edit with AI) ─────────────────────────────────────────────────────────────────────────────────
// The contact patterns of TailorIT's screen (apps/api/src/features/autofill/ai/contacts.ts), which refuses a current
// answer sent to be rewritten that holds any: an email address, a link, a domain, a phone number or a postal address.

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/gi;
/** A domain with a path ("evil.ru/apply"), but a code name ("Node.js/TypeScript", "ASP.NET/C#"). */
const PATHED_DOMAIN = /(?<![\p{L}\p{N}@._/-])(?<domain>(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?<ending>\p{L}{2,63}))\/[^\s<>"'`]*/giu;
/** A domain without a path, in lower case, with one of these endings; a product ending ("socket.io") only with a path. */
const BARE_DOMAIN = /(?<![\p{L}\p{N}@._/-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?<ending>com|net|org|io|ai|co|dev|app|me|info|biz|xyz|link|site|online|tech|cloud|page|us|uk|ca|de|fr|eu|in|au|nz|gg|tv|ly|sh|to)(?![\p{L}\p{N}-])/gu;
const PRODUCT_ENDINGS: ReadonlySet<string> = new Set(['io', 'ai', 'dev', 'app', 'me', 'tech', 'cloud', 'gg', 'tv', 'ly',
  'sh', 'to']);
const CODE_ENDINGS: ReadonlySet<string> = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'yaml', 'yml', 'toml',
  'html', 'htm', 'css', 'scss', 'sass', 'cpp', 'hpp', 'java', 'kt', 'kts', 'swift', 'txt', 'csv', 'exe', 'dll', 'lock',
  'vue', 'svelte']);
const DOT_NET_NAMES: ReadonlySet<string> = new Set(['asp.net', 'vb.net', 'ado.net']);
/** A run of digits and the separators phone numbers are written with. */
const PHONE_RUN = /\+?\(?\d[\d\s().\-‐-―]{5,}\d/g;
/** The words a street address ends its street with ("221B Baker Street", "12 Elm St."). */
const STREET_WORDS = String.raw`(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|terrace|close|crescent|square|sq|parkway|pkwy|highway|hwy|row|mews|grove|gardens|walk|circle|cir|trail|alley|plaza)`;
const POSTCODE_END = String.raw`(?=\s*(?:$|[,;|)]))`;
/** A postal address in a line: a street address, a post office box or an apartment, a UK or Canadian postcode in
 *  capitals, or a US state and ZIP code. */
const ADDRESS: readonly RegExp[] = [
  new RegExp(String.raw`(?:^|[,|;:]\s*)\d{1,6}[a-z]?\s+(?:[\p{L}'.-]+\s+){0,3}${STREET_WORDS}\b`, 'imu'),
  /\b(?:p\.?\s?o\.?\s+box|apt\.?\s*#?\s*\d|apartment\s+#?\d|suite\s+#?\d|flat\s+\d)/i,
  new RegExp(String.raw`\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b${POSTCODE_END}`, 'm'),
  new RegExp(String.raw`\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b${POSTCODE_END}`, 'm'),
  /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(?:-\d{4})?\b/,
];

/** A run that is a phone number: 9 to 15 digits, and not years only ("2019 2023"). */
function isPhoneNumber(run: string): boolean {
  const digits = run.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  return !run.split(/\D+/).filter(Boolean).every((group) => /^(?:19|20)\d\d$/.test(group));
}

/** The views the contact patterns read: the text as written, and its compatibility form with look-alike letters read
 *  as Latin ones, case kept. */
const contactViews = (text: string) => [...new Set([text, caseKept(text.normalize('NFKC'))])];

/** Whether text holds a contact detail (TailorIT's namesForeignContact with no contacts of the person's) or a postal
 *  address (holdsPostalAddress). */
export function namesContactDetail(text: string): boolean {
  return contactViews(text).some((view) => {
    if (ADDRESS.some((pattern) => pattern.test(view))) return true;
    let rest = view;
    if ((rest.match(EMAIL) ?? []).length > 0) return true;
    rest = rest.replace(EMAIL, ' ');
    if ((rest.match(LINK) ?? []).length > 0) return true;
    rest = rest.replace(LINK, ' ');
    for (const match of rest.matchAll(PATHED_DOMAIN)) {
      const { domain = '', ending = '' } = match.groups ?? {};
      if (!CODE_ENDINGS.has(ending.toLowerCase()) && !DOT_NET_NAMES.has(domain.toLowerCase())) return true;
    }
    rest = rest.replace(PATHED_DOMAIN, ' ');
    for (const match of rest.matchAll(BARE_DOMAIN)) {
      if (!PRODUCT_ENDINGS.has(match.groups?.ending ?? '')) return true;
    }
    rest = rest.replace(BARE_DOMAIN, ' ');
    return (rest.match(PHONE_RUN) ?? []).some(isPhoneNumber);
  });
}

/**
 * Whether what a box holds is one no LLM may see (Edit with AI's current text: the Phase E review, MAJOR 3): a
 * sensitive topic or a sum (namesSensitiveValue), a line that is an EEO answer the vocabulary knows or a decline
 * phrase, or a contact detail or postal address (namesContactDetail, as TailorIT screens the same text). The core asks
 * no rewrite of such a box (plan/drafts.ts rewriteItemOf), and the worker checks again (ai-tasks.ts draftBatches).
 */
export function namesSensitiveAnswer(text: string, vocab: Vocab): boolean {
  if (text.trim() === '') return false;
  if (namesSensitiveValue(text)) return true;
  const lines = text.split(/\r\n?|\n/).map((line) => cutInjected(line).clean.trim()).filter((line) => line !== '');
  if (lines.some((line) => namesSensitiveValue(line) || isEeoAnswer(line, vocab) || isDeclinePhrase(line, vocab))) {
    return true;
  }
  return namesContactDetail(text);
}

/** Why a field may not enter a classify batch, or null when it may: a sensitive topic in its label, description,
 *  section's words or options, or an option that is an EEO answer ("How do you identify?" with Man, Woman and
 *  Non-binary: the review, R4) ('sensitive'); or a decline option among its options ('decline'). Such a field is
 *  needs-user. */
export function screenForClassify(spec: Pick<FieldSpec, 'label' | 'description' | 'section' | 'options'>, vocab: Vocab):
  'sensitive' | 'decline' | null {
  const options = cleanOptions(spec);
  if ([spec.label, spec.description, sectionWords(spec.section), ...options].some(namesSensitiveTopic)) return 'sensitive';
  if (options.some((label) => isEeoAnswer(label, vocab))) return 'sensitive';
  return options.some((label) => isDeclinePhrase(label, vocab)) ? 'decline' : null;
}

/**
 * The topics a field's own text names, for an AI answer of TailorIT's `all` scope (settings.modes.ai 'all', the owner's
 * decision of 2026-11-01), or null when it may get none: its label, description, section's words and options may name
 * only open topics (OPEN_SCREEN_TOPICS; a consent only in an attention check's own words), none of its options is an
 * EEO answer the vocabulary knows, and a decline option ("Prefer not to say") stands only beside a question that names
 * an open topic (a fair answer to a legal or pay question; elsewhere the mark of a self-identification one).
 */
export function openAnswerTopics(spec: Pick<FieldSpec, 'label' | 'description' | 'section' | 'options'>, vocab: Vocab,
  attention: boolean): Set<ScreenTopic> | null {
  return openTopicsOfTexts([spec.label, spec.description, sectionWords(spec.section)], cleanOptions(spec), vocab,
    attention);
}

/** openAnswerTopics over a question's texts (its label, hint and section's words) and its clean option labels, as the
 *  worker screens an answer item again (ai-tasks.ts answerItemOfCore). */
export function openTopicsOfTexts(asked: readonly string[], options: readonly string[], vocab: Vocab,
  attention: boolean): Set<ScreenTopic> | null {
  const topics = new Set<ScreenTopic>();
  for (const text of [...asked, ...options]) {
    for (const topic of sensitiveTopicsOf(text)) topics.add(topic);
  }
  if ([...topics].some((topic) => !OPEN_SCREEN_TOPICS.has(topic) && !(attention && topic === 'consent'))) return null;
  if (options.some((label) => isEeoAnswer(label, vocab))) return null;
  const opened = [...topics].some((topic) => OPEN_SCREEN_TOPICS.has(topic));
  return !opened && options.some((label) => isDeclinePhrase(label, vocab)) ? null : topics;
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

/** A row's section (text/keys.ts sectionKey: the id, and "[n]" for a repeatable block) as the words it was made from;
 *  '' for the form's main part. */
export function sectionWordsOfKey(key: string): string {
  return sectionWords({ id: key.replace(/\[\d+\]$/, '') });
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
  // A free-text question on a box that can hold one is the person's from the profile's side, and takes the run's draft
  // or AI answer (the owner's amendments: §8.2's "draft only").
  if (verdict.category === 'free_text_question' && kindAllowed('freeText.other', spec.kind)
    && !offersDecline(spec, vocab)) {
    return { kind: 'needs-user', category: 'freeText.other', reason: 'free-text-requires-user' };
  }
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
