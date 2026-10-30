/*
 * The label rules (docs/design/core.md §8.3), the third of the three rule sources: regular expressions over the
 * normalized label (normalizeLabel: folded, punctuation as spaces, parentheticals left out). LABEL_RULES is the design's
 * list, verbatim and in its order, and the first rule that matches decides, with two refinements the design states
 * beside it: a rule whose category the field's kind cannot hold is no match, so the next rule is tried, and when a
 * label matches several consent kinds the strictest wins (§8.7).
 */
import { LABEL_RULE_CONFIDENCE } from '../confidence';
import type { FieldKind } from '../enums';
import type { FieldCategory } from '../types/intent';
import { kindAllowed, policyClassOf } from './categories';

/** How sure a label rule is: strong 0.97, normal 0.92, weak 0.75 (LABEL_RULE_CONFIDENCE). */
export const RULE_STRENGTHS = ['strong', 'normal', 'weak'] as const;
export type RuleStrength = (typeof RULE_STRENGTHS)[number];

/** What a section is about, for the rules that tell an employment date from a school date. */
export const SECTION_KINDS = ['experience', 'education', 'other'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** What a rule's category function reads. */
export interface RuleCtx {
  /** The text the rule matched: the normalized label, or the normalized label and description together. */
  label: string;
  section: SectionKind;
  kind: FieldKind;
}

/** One label rule. `^…$` in a pattern means the whole label must match. */
export interface LabelRule {
  id: string;
  re: RegExp;
  category: FieldCategory | ((ctx: RuleCtx) => FieldCategory);
  strength: RuleStrength;
}

const EXPERIENCE_WORDS = new Set(['experience', 'experiences', 'employment', 'employer', 'employers']);
const EDUCATION_WORDS = new Set(['education', 'educational', 'academic', 'academics', 'school', 'schools',
  'schooling', 'university', 'college']);

/**
 * What a section id is about. The id is an adapter's ('experience', 'education', 'main') or the slug of the nearest
 * heading ('work-experience', 'employment-history', 'education-history'). A work or job history counts as experience.
 * An id that names both, or neither, is 'other'.
 */
export function sectionKindOf(sectionId: string): SectionKind {
  const words = sectionId.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== '');
  const experience = words.some((word) => EXPERIENCE_WORDS.has(word))
    || (words.includes('history') && (words.includes('work') || words.includes('job')));
  const education = words.some((word) => EDUCATION_WORDS.has(word));
  if (experience === education) return 'other';
  return experience ? 'experience' : 'education';
}

const FUTURE = /\bfuture\b/;
const NOW = /\bnow\b|\bcurrently\b/;

/**
 * Which sponsorship question a normalized label asks (§8.3 and docs/ARCHITECTURE.md): one naming both "now" (or
 * "currently") and "future" is the combined question, `workAuth.sponsorship`, answered by `legal.sponsorship-combined`;
 * "future" alone gives `workAuth.sponsorshipFuture`; "now" or "currently" alone gives `workAuth.sponsorshipNow`. A
 * label naming no time ("Do you require sponsorship?") is read as the combined question, which answers No only when
 * both of the person's answers are an explicit no.
 */
export function sponsorshipKind(label: string): FieldCategory {
  const future = FUTURE.test(label);
  const now = NOW.test(label);
  if (future && !now) return 'workAuth.sponsorshipFuture';
  if (now && !future) return 'workAuth.sponsorshipNow';
  return 'workAuth.sponsorship';
}

/** §8.3's label rules, verbatim and in the design's order: the first that matches decides. */
export const LABEL_RULES: ReadonlyArray<LabelRule> = [
  { id: 'label.preferred-name', re: /preferred\s+(?:first\s+)?name|nickname|name\s+you\s+go\s+by/, category: 'identity.preferredName', strength: 'strong' },
  { id: 'label.first-name', re: /^(?:legal\s+)?first\s+name$|^given\s+name$|^forename$/, category: 'identity.firstName', strength: 'strong' },
  { id: 'label.middle-name', re: /^middle\s+(?:name|initial)/, category: 'identity.middleName', strength: 'strong' },
  { id: 'label.last-name', re: /^(?:legal\s+)?(?:last\s+name|surname|family\s+name)$/, category: 'identity.lastName', strength: 'strong' },
  { id: 'label.full-name', re: /^(?:full\s+|legal\s+)?name$|^your\s+(?:full\s+)?name$/, category: 'identity.fullName', strength: 'strong' },
  { id: 'label.pronouns', re: /\bpronouns?\b/, category: 'identity.pronouns', strength: 'normal' },
  { id: 'label.email', re: /^e\s?mail(?:\s+address)?$/, category: 'contact.email', strength: 'strong' },
  { id: 'label.phone-country', re: /country\s+code|dial(?:ing)?\s+code/, category: 'contact.phoneCountry', strength: 'normal' },
  { id: 'label.phone', re: /\b(?:phone|mobile|cell|telephone)\b(?!\s+type)/, category: 'contact.phone', strength: 'normal' },
  { id: 'label.address2', re: /address\s+line\s*2|\bapt\b|\bsuite\b|\bunit\b/, category: 'address.line2', strength: 'normal' },
  { id: 'label.address1', re: /^(?:street\s+)?address(?:\s+line)?\s*1?$/, category: 'address.line1', strength: 'normal' },
  { id: 'label.city', re: /^city$|^town$/, category: 'address.city', strength: 'strong' },
  { id: 'label.region', re: /^(?:state|province|region|state\s+province|state\s+region)$/, category: 'address.region', strength: 'strong' },
  { id: 'label.postal', re: /\bzip\b|postal|post\s?code/, category: 'address.postalCode', strength: 'strong' },
  { id: 'label.country', re: /^country(?:\s+of\s+residence)?$/, category: 'address.country', strength: 'strong' },
  { id: 'label.location', re: /^(?:current\s+)?location$|where\s+are\s+you\s+(?:currently\s+)?(?:located|based)|^city\s+state$/, category: 'location.current', strength: 'normal' },
  { id: 'label.linkedin', re: /linked\s?in/, category: 'links.linkedin', strength: 'strong' },
  { id: 'label.github', re: /git\s?hub/, category: 'links.github', strength: 'strong' },
  { id: 'label.portfolio', re: /\bportfolio\b/, category: 'links.portfolio', strength: 'normal' },
  { id: 'label.twitter', re: /\btwitter\b|\bx\s+(?:handle|profile)\b/, category: 'links.twitter', strength: 'normal' },
  { id: 'label.website', re: /(?:personal\s+)?web\s?site|\burl\b|\bblog\b/, category: 'links.website', strength: 'weak' },
  { id: 'label.work-auth', re: /(?:legally\s+)?(?:authori[sz]ed|eligible|permitted)\s+to\s+work|right\s+to\s+work|work\s+authori[sz]ation/, category: 'workAuth.authorized', strength: 'strong' },
  { id: 'label.sponsorship', re: /\bsponsor(?:ship)?\b|\bh\s?1\s?b\b|visa\s+(?:support|transfer)/, category: (c) => sponsorshipKind(c.label), strength: 'strong' },
  { id: 'label.visa-type', re: /(?:visa|immigration)\s+(?:type|status)|current\s+visa/, category: 'workAuth.visaType', strength: 'normal' },
  { id: 'label.citizenship', re: /\bcitizen(?:ship)?\b/, category: 'workAuth.status', strength: 'normal' },
  { id: 'label.clearance', re: /security\s+clearance|clearance\s+level/, category: 'workAuth.clearance', strength: 'normal' },
  { id: 'label.over18', re: /(?:at\s+least|over|older\s+than)\s+18|18\s+years\s+(?:of\s+age|or\s+older)|legal\s+(?:working\s+)?age/, category: 'screening.over18', strength: 'strong' },
  { id: 'label.criminal', re: /\bconvicted\b|\bfelony\b|\bcriminal\b/, category: 'screening.criminalHistory', strength: 'strong' },
  { id: 'label.hispanic', re: /hispanic|latin[oax]/, category: 'eeo.hispanicLatino', strength: 'strong' },
  { id: 'label.race', re: /^race\b|\bethnicity\b|\bracial\b/, category: 'eeo.race', strength: 'strong' },
  { id: 'label.gender', re: /^gender(?:\s+identity)?$|^sex$|what\s+is\s+your\s+gender/, category: 'eeo.gender', strength: 'strong' },
  { id: 'label.veteran', re: /\bveteran\b|military\s+service/, category: 'eeo.veteran', strength: 'strong' },
  { id: 'label.disability', re: /\bdisabilit(?:y|ies)\b/, category: 'eeo.disability', strength: 'strong' },
  { id: 'label.orientation', re: /sexual\s+orientation/, category: 'eeo.sexualOrientation', strength: 'strong' },
  { id: 'label.transgender', re: /\btransgender\b/, category: 'eeo.transgender', strength: 'strong' },
  { id: 'label.highest-level', re: /highest\s+(?:level\s+of\s+)?(?:education|degree)/, category: 'education.highestLevel', strength: 'strong' },
  { id: 'label.degree', re: /^degree(?:\s+type)?$|degree\s+(?:obtained|earned|level)|level\s+of\s+education/, category: 'education.degree', strength: 'normal' },
  { id: 'label.field', re: /\bdiscipline\b|\bmajor\b|field\s+of\s+study|area\s+of\s+study|concentration|speciali[sz]ation/, category: 'education.field', strength: 'normal' },
  { id: 'label.minor', re: /^minor\b/, category: 'education.minor', strength: 'normal' },
  { id: 'label.gpa', re: /\bc?gpa\b|grade\s+point/, category: 'education.gpa', strength: 'strong' },
  { id: 'label.school', re: /\bschool\b|\buniversity\b|\bcollege\b|\binstitution\b/, category: 'education.school', strength: 'normal' },
  { id: 'label.start-date', re: /start\s+date|^from$|date\s+started/, category: (c) => c.section === 'experience' ? 'experience.startDate' : c.section === 'education' ? 'education.startDate' : 'availability.startDate', strength: 'normal' },
  { id: 'label.end-date', re: /end\s+date|^to$|graduation\s+date|date\s+(?:ended|graduated)|expected\s+graduation/, category: (c) => c.section === 'experience' ? 'experience.endDate' : 'education.endDate', strength: 'normal' },
  { id: 'label.current-job', re: /currently\s+(?:work|working)\s+here|i\s+currently\s+work|current\s+(?:role|position|job)$/, category: 'experience.current', strength: 'strong' },
  { id: 'label.company', re: /\bcompany\b|\bemployer\b|\borgani[sz]ation\b/, category: (c) => /current/.test(c.label) ? 'experience.currentCompany' : 'experience.company', strength: 'normal' },
  { id: 'label.title', re: /(?:job\s+)?title|\bposition\b|\brole\b/, category: (c) => /current/.test(c.label) ? 'experience.currentTitle' : 'experience.title', strength: 'normal' },
  { id: 'label.years', re: /years\s+of\s+(?:professional\s+|relevant\s+)?experience|how\s+many\s+years/, category: 'experience.totalYears', strength: 'normal' },
  { id: 'label.salary', re: /\bsalary\b|compensation|pay\s+(?:expectation|requirement)|desired\s+pay|expected\s+(?:base\s+)?(?:salary|compensation)/, category: (c) => /current|previous/.test(c.label) ? 'unknown' : 'salary.expected', strength: 'normal' },
  { id: 'label.availability', re: /when\s+can\s+you\s+start|earliest\s+start|available\s+to\s+start|\bavailability\b/, category: 'availability.startDate', strength: 'normal' },
  { id: 'label.notice', re: /notice\s+period/, category: 'availability.noticePeriod', strength: 'strong' },
  { id: 'label.relocation', re: /\brelocat/, category: 'preferences.relocation', strength: 'strong' },
  { id: 'label.arrangement', re: /\bremote\b|\bhybrid\b|\bon\s?site\b|in\s+office|work\s+arrangement/, category: 'preferences.workArrangement', strength: 'weak' },
  { id: 'label.travel', re: /\btravel\b/, category: 'preferences.travel', strength: 'weak' },
  { id: 'label.referral-source', re: /how\s+did\s+you\s+(?:hear|find|learn)|where\s+did\s+you\s+(?:hear|find|see)|source\s+of\s+(?:your\s+)?application|referral\s+source/, category: 'referral.source', strength: 'strong' },
  { id: 'label.referrer', re: /referr(?:ed|er)s?\s+(?:by|name)|who\s+referred\s+you/, category: 'referral.referrerName', strength: 'normal' },
  { id: 'label.previously-employed', re: /(?:previously|ever)\s+(?:been\s+)?(?:worked|employed)\s+(?:for|at|by)|former\s+employee/, category: 'screening.previouslyEmployed', strength: 'normal' },
  { id: 'label.language', re: /^languages?\b|languages?\s+(?:spoken|you\s+speak)/, category: 'languages.language', strength: 'normal' },
  { id: 'label.proficiency', re: /proficiency|fluency/, category: 'languages.proficiency', strength: 'normal' },
  { id: 'label.skills', re: /\bskills\b|technologies|tools\s+you\s+(?:use|know)/, category: 'skills.list', strength: 'weak' },
  { id: 'label.resume', re: /\bresume\b|\bcv\b|curriculum\s+vitae/, category: (c) => c.kind === 'file' ? 'file.resume' : 'unknown', strength: 'strong' },
  { id: 'label.cover-letter', re: /cover\s+letter/, category: (c) => c.kind === 'file' ? 'file.coverLetter' : 'freeText.coverLetter', strength: 'strong' },
  { id: 'label.why-company', re: /why\s+(?:do\s+you\s+want\s+to\s+work|are\s+you\s+interested\s+in\s+(?:us|working)|this\s+company|join)/, category: 'freeText.whyCompany', strength: 'normal' },
  { id: 'label.why-role', re: /why\s+(?:this|the)\s+(?:role|position)|what\s+interests\s+you\s+about\s+(?:this|the)\s+role/, category: 'freeText.whyRole', strength: 'normal' },
  { id: 'label.additional', re: /additional\s+information|anything\s+else/, category: 'freeText.additionalInfo', strength: 'normal' },
  // consent kinds: checkbox or radio (signature: text) labels
  { id: 'label.consent-ai', re: /(?:did\s+not|didn't|have\s+not|haven't)\s+use[d]?\s+(?:ai|artificial\s+intelligence)|not\s+(?:been\s+)?(?:written|generated)\s+(?:by|with|using)\s+ai|without\s+(?:the\s+use\s+of\s+)?ai/, category: 'consent.aiAttestation', strength: 'strong' },
  { id: 'label.consent-privacy', re: /privacy\s+(?:policy|notice|statement)|candidate\s+privacy|data\s+protection|\bgdpr\b/, category: 'consent.privacy', strength: 'strong' },
  { id: 'label.consent-terms', re: /terms\s+(?:of\s+(?:use|service)|and\s+conditions)/, category: 'consent.terms', strength: 'strong' },
  { id: 'label.consent-certify', re: /i\s+(?:hereby\s+)?certify|true\s+and\s+(?:complete|accurate)|to\s+the\s+best\s+of\s+my\s+knowledge|\battest\b/, category: 'consent.certify', strength: 'strong' },
  { id: 'label.consent-retention', re: /future\s+(?:job\s+)?opportunit|retain\s+my\s+(?:data|information)|talent\s+(?:pool|community)|keep\s+my\s+(?:application|information)\s+on\s+file/, category: 'consent.dataRetention', strength: 'strong' },
  { id: 'label.consent-marketing', re: /newsletter|job\s+alerts|marketing|updates\s+about/, category: 'consent.marketing', strength: 'strong' },
  { id: 'label.consent-sms', re: /text\s+messages?|\bsms\b|receive\s+texts/, category: 'consent.sms', strength: 'strong' },
  { id: 'label.consent-background', re: /background\s+check|consumer\s+report/, category: 'consent.backgroundCheck', strength: 'strong' },
  { id: 'label.consent-signature', re: /\bsignature\b|sign\s+(?:here|below)|type\s+your\s+(?:full\s+)?(?:legal\s+)?name\s+to\s+sign/, category: 'consent.signature', strength: 'strong' },
  { id: 'label.consent-generic', re: /\bi\s+(?:agree|consent|acknowledge|accept|understand)\b/, category: 'consent.other', strength: 'strong' },
];

/** §8.3: a textarea with no label that no rule (autocomplete, name/id or label) classifies. classifyByRules applies it
 *  last. */
export const UNLABELLED_TEXTAREA_RULE: { readonly id: string; readonly category: FieldCategory;
  readonly strength: RuleStrength } = { id: 'label.unlabelled-textarea', category: 'freeText.other', strength: 'weak' };

/**
 * The consent kinds from the strictest down (§8.7): an AI attestation, unrecognised consent, a certification, a
 * signature; every other kind ranks after these, equally. When a label matches several kinds the strictest wins, and
 * among equals the earlier rule.
 */
export const CONSENT_STRICTNESS: readonly FieldCategory[] = ['consent.aiAttestation', 'consent.other',
  'consent.certify', 'consent.signature'];

/** The rules whose category is a consent kind, in order. */
const CONSENT_RULES = LABEL_RULES.filter((rule) => typeof rule.category === 'string'
  && policyClassOf(rule.category) === 'consent');

/** What a label rule says a field is. */
export interface LabelRuleHit {
  /** The rule's id ('label.first-name'): the review panel shows it. */
  rule: string;
  category: FieldCategory;
  strength: RuleStrength;
  confidence: number;
  /**
   * For a consent category, every consent kind the text matched, strictest first; `category` is the first. The
   * consent policy can require each of them to be pre-approved, so a box that also certifies is never ticked on a
   * privacy pre-approval alone.
   */
  consentKinds?: FieldCategory[];
}

/** The rule's category for this text and field, or null when it does not match or the kind cannot hold it. */
function categoryFor(rule: LabelRule, ctx: RuleCtx): FieldCategory | null {
  if (!rule.re.test(ctx.label)) return null;
  const category = typeof rule.category === 'function' ? rule.category(ctx) : rule.category;
  return kindAllowed(category, ctx.kind) ? category : null;
}

function hitOf(rule: { id: string; strength: RuleStrength }, category: FieldCategory): LabelRuleHit {
  return { rule: rule.id, category, strength: rule.strength, confidence: LABEL_RULE_CONFIDENCE[rule.strength] };
}

const consentRank = (category: FieldCategory) => {
  const rank = CONSENT_STRICTNESS.indexOf(category);
  return rank < 0 ? CONSENT_STRICTNESS.length : rank;
};

/**
 * The strictest consent kind the text matches. The generic "I agree / I consent / I acknowledge" rule
 * (`label.consent-generic`, `consent.other`) is the fallback for consent no other rule recognises, so it counts only
 * when no specific kind matched: "I agree to the privacy policy" is `consent.privacy`.
 */
function strictestConsent(ctx: RuleCtx, first: LabelRule, firstCategory: FieldCategory): LabelRuleHit {
  const matched: Array<{ rule: LabelRule; category: FieldCategory }> = [];
  for (const rule of CONSENT_RULES) {
    const category = categoryFor(rule, ctx);
    if (category !== null) matched.push({ rule, category });
  }
  if (matched.length === 0) matched.push({ rule: first, category: firstCategory });
  const specific = matched.filter((entry) => entry.category !== 'consent.other');
  const ranked = (specific.length > 0 ? specific : matched)
    .sort((a, b) => consentRank(a.category) - consentRank(b.category));
  const winner = ranked[0]!;
  return { ...hitOf(winner.rule, winner.category), consentKinds: ranked.map((entry) => entry.category) };
}

/**
 * The first label rule that matches `text` (a normalized label, or a normalized label and description) and whose
 * category the field's kind can hold, or null. A consent match is settled by strictness among all the consent rules.
 */
export function matchLabelRules(text: string, section: SectionKind, kind: FieldKind): LabelRuleHit | null {
  if (text === '') return null;
  const ctx: RuleCtx = { label: text, section, kind };
  for (const rule of LABEL_RULES) {
    const category = categoryFor(rule, ctx);
    if (category === null) continue;
    if (policyClassOf(category) === 'consent') return strictestConsent(ctx, rule, category);
    return hitOf(rule, category);
  }
  return null;
}

/** UNLABELLED_TEXTAREA_RULE's hit for a textarea whose normalized label is empty, else null. */
export function unlabelledTextarea(normalizedLabel: string, kind: FieldKind): LabelRuleHit | null {
  return kind === 'textarea' && normalizedLabel === ''
    ? hitOf(UNLABELLED_TEXTAREA_RULE, UNLABELLED_TEXTAREA_RULE.category)
    : null;
}
