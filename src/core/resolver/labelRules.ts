/*
 * The label rules (docs/design/core.md §8.3), the third of the three rule sources: regular expressions over the
 * normalized label (normalizeLabel: folded, punctuation as spaces, parentheticals left out). LABEL_RULES is the design's
 * list, verbatim and in its order, and the first rule that matches decides, with two refinements the design states
 * beside it: a rule whose category the field's kind cannot hold is no match, so the next rule is tried, and when a
 * label matches several consent kinds the strictest wins (§8.7).
 *
 * The resolver review (2026-10-30) found real wordings the list answers wrongly with no flag, so more refinements sit
 * beside the list rather than in it, which keeps the list the design's (docs/design/core.md §8.3 is to record them):
 * - PRE_RULES run first. A question that ties authorization to sponsorship, a work permit, a nationality and an age
 *   are questions no profile answer states, so they go to the person (a `needsUser` hit).
 * - A lone checkbox or a radio worded as consent (a consent verb, "Do you consent", "Would you like to receive", an AI
 *   attestation) is read as consent before anything else, so a box that certifies or consents is never ticked from a
 *   profile answer (the specification: consent is never inferred). A criminal-history claim still goes to the person
 *   first.
 * - REFINEMENTS narrow some of the design's rules (a phone, an employer or a job title must be the label's own noun,
 *   not a word in a question; a self-identification topic needs a self-identification wording; sponsorship needs its
 *   immigration sense) and widen others to the wordings real forms use (gender, race, veterans, criminal history, AI
 *   attestations, unrecognised consent).
 * - A legal, EEO or sensitive question on a kind that cannot hold its answer stops at a needs-user hit instead of
 *   letting a later rule claim it; consent does the same once no consent kind fits the field.
 * - Consent wording adds unrecognised consent (`consent.other`) for each clause no specific kind covers, and an AI
 *   attestation whenever it names AI.
 */
import { LABEL_RULE_CONFIDENCE } from '../confidence';
import type { FieldKind } from '../enums';
import type { FieldCategory, PolicyClass } from '../types/intent';
import { kindAllowed, policyClassOf, USER_ONLY_CATEGORIES } from './categories';

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
  /** The normalized words of the label's parentheticals, '' when none: the sponsorship rule reads a time there too. */
  qualifiers: string;
  /** The label as the page wrote it, '' when the caller has none: "Why Acme?" needs the capital. */
  rawLabel: string;
  /** The field's block, when it sits in a repeatable section. */
  block?: number;
}

/** What matchLabelRules reads besides the text, when the caller has it (classifyByRules always passes all three). */
export interface LabelContext {
  qualifiers?: string;
  rawLabel?: string;
  block?: number;
}

/** One label rule. `^…$` in a pattern means the whole label must match. */
export interface LabelRule {
  id: string;
  re: RegExp;
  category: FieldCategory | ((ctx: RuleCtx) => FieldCategory);
  strength: RuleStrength;
}

/**
 * Why the rules hand a field to the person: nothing (the profile, a pre-approval, a saved answer or an LLM) may answer
 * it, and the resolver gives it the action `needs-user`, blank and flagged, whatever its category's policy allows.
 */
export const NEEDS_USER_CAUSES = [
  /** A legal, EEO or sensitive question, or consent, on a kind that cannot hold its answer. */
  'kind-mismatch',
  /** A legal, EEO, consent or sensitive category read from the help text alone, never from the label. */
  'description-only',
  /** A legal, EEO, consent or sensitive reading that another source contradicts. */
  'source-conflict',
  /** A self-identification or other sensitive topic in a question that does not ask for the person's own answer. */
  'sensitive-topic',
  /** Authorization tied to sponsorship ("authorized to work without sponsorship"): no one profile answer states it. */
  'authorization-and-sponsorship',
  /** A sponsorship question whose time cannot be read: a "currently" in another clause, or the past tense. */
  'unclear-time',
  /** Whether a work or residence permit is held or needed: neither authorization nor sponsorship says it. */
  'work-permit',
  /** Nationality, or a country of citizenship, birth or origin: the profile holds none. */
  'nationality',
  /** Age or date of birth: the profile holds only whether the person is over 18. */
  'age',
  /** Current, previous or historical pay: the profile holds only expected pay, and saved answers refuse pay. */
  'current-pay',
] as const;
export type NeedsUserCause = (typeof NEEDS_USER_CAUSES)[number];

const EXPERIENCE_WORDS = new Set(['experience', 'experiences', 'employment', 'employer', 'employers', 'internship',
  'internships']);
const EDUCATION_WORDS = new Set(['education', 'educational', 'academic', 'academics', 'school', 'schools',
  'schooling', 'university', 'college']);
/** Headings that name a work history in two words although neither word does alone ("career history"). */
const EXPERIENCE_PAIRS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['work', ['history', 'experience', 'background', 'positions']],
  ['job', ['history']],
  ['career', ['history', 'background']],
  ['professional', ['experience', 'background', 'history']],
  ['positions', ['held']],
];

/**
 * What a section id is about. The id is an adapter's ('experience', 'education', 'main') or the slug of the nearest
 * heading ('work-experience', 'employment-history', 'education-history'), camelCase included ('workExperience'). A
 * work, job or career history and internships count as experience; bare 'work' or 'professional' do not
 * ('work-authorization', 'professional-references'). An id that names both, or neither, is 'other'.
 */
export function sectionKindOf(sectionId: string): SectionKind {
  const words = sectionId.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  const experience = words.some((word) => EXPERIENCE_WORDS.has(word))
    || (words.includes('history') && (words.includes('work') || words.includes('job')))
    || words.some((word, at) => EXPERIENCE_PAIRS.some(([first, seconds]) => word === first
      && seconds.includes(words[at + 1] ?? '')));
  const education = words.some((word) => EDUCATION_WORDS.has(word));
  if (experience === education) return 'other';
  return experience ? 'experience' : 'education';
}

/** Which time a sponsorship question asks about; 'unclear' goes to the person. */
export const SPONSORSHIP_TIMES = ['combined', 'now', 'future', 'unclear'] as const;
export type SponsorshipTime = (typeof SPONSORSHIP_TIMES)[number];

const NOW_WORD = String.raw`(?:now|currently|presently|today|at\s+present|at\s+this\s+time|at\s+the\s+moment)`;
const FUTURE_WORD = String.raw`(?:future|later|going\s+forward|eventually|down\s+the\s+road|in\s+the\s+coming\s+\w+|at\s+a\s+later\s+(?:date|time|point))`;
const NEED_WORD = String.raw`(?:require|requires|required|requiring|need|needs|needed|needing)`;
/** Words that cover now as well as later: the combined question even with no "now" ("Will you ever require..."). */
const ANY_TIME = /\b(?:ever|at\s+any\s+(?:time|point)|anytime|at\s+some\s+point)\b/;
const FUTURE = new RegExp(String.raw`\b${FUTURE_WORD}\b`);
const ANY_NOW = new RegExp(String.raw`\b${NOW_WORD}\b`);
/** A "now" that belongs to the requirement: within a few words of require or need, or paired with a future time ("now
 *  or later"). Further off it may be another clause's ("a role you are currently applying for"). */
const NOW_OF_THE_NEED = new RegExp(String.raw`\b${NOW_WORD}\s+(?:\w+\s+){0,2}?${NEED_WORD}\b|\b${NEED_WORD}\s+(?:\w+\s+){0,3}?${NOW_WORD}\b|\b${NOW_WORD}\s+or\s+(?:(?:will|would)\s+you\s+)?(?:in\s+the\s+)?${FUTURE_WORD}\b`);
/** A present-tense question joined to a future one: "Do you require sponsorship, or will you in the future?" */
const NOW_OR_WILL = new RegExp(String.raw`\b(?:do|does)\s+you\s+(?:\w+\s+){0,2}?${NEED_WORD}\b.*\bor\s+(?:will|would)\s+you\b|\b(?:do|does)\s+you\s+or\s+(?:will|would)\s+you\b`);
/** Sponsorship in the past: "Have you ever been sponsored?", "Has an employer sponsored you?" */
const PAST_SPONSORSHIP = /\b(?:have|has|had|was|were)\b(?:\s+\w+){0,3}?\s+(?:been\s+)?sponsored\b|\bsponsored\s+(?:you|by)\b|\b(?:have|has|had)\s+you\s+(?:ever\s+|previously\s+|already\s+)?(?:required|needed|held|received|obtained)\b/;

/**
 * Which time a normalized sponsorship question asks about (docs/ARCHITECTURE.md defines the kinds by meaning). A word
 * that covers any time ("ever", "at any point"), a "now" of the requirement with a future time ("now or later"), or a
 * present-tense question joined to a "will you" one is the combined question. A future time alone is future-only; a
 * "now" of the requirement alone ("currently require", "at this time", "presently") is now-only. A "now" in another
 * clause ("Are you currently located in the US, and will you require sponsorship?") and the past tense are 'unclear'.
 * No time at all is the combined question, which answers No only when both of the person's answers are an explicit no.
 */
export function sponsorshipTime(label: string): SponsorshipTime {
  if (PAST_SPONSORSHIP.test(label)) return 'unclear';
  if (ANY_TIME.test(label)) return 'combined';
  const future = FUTURE.test(label);
  const now = NOW_OF_THE_NEED.test(label);
  if ((now && future) || NOW_OR_WILL.test(label)) return 'combined';
  if (future) return 'future';
  if (now) return 'now';
  return ANY_NOW.test(label) ? 'unclear' : 'combined';
}

/**
 * Which sponsorship question a normalized label asks (§8.3 and docs/ARCHITECTURE.md), from sponsorshipTime: the
 * combined question is `workAuth.sponsorship`, answered by `legal.sponsorship-combined`; a future-only question
 * `workAuth.sponsorshipFuture`; a now-only one `workAuth.sponsorshipNow`. An unclear time is read as the combined
 * question here, and matchLabelRules hands that field to the person.
 */
export function sponsorshipKind(label: string): FieldCategory {
  const time = sponsorshipTime(label);
  if (time === 'future') return 'workAuth.sponsorshipFuture';
  if (time === 'now') return 'workAuth.sponsorshipNow';
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
 * The fallbacks classifyByRules applies after everything else (the resolver review): a labelled textarea no rule
 * classifies is free text, whose saved answers stay with one company, never the open unknown class; a lone checkbox
 * no rule classifies is unrecognised consent, which only the person ticks (§8.7), never one a saved answer ticks.
 */
export const UNRECOGNISED_FIELD_RULES: Readonly<Partial<Record<FieldKind, { readonly id: string;
  readonly category: FieldCategory; readonly strength: RuleStrength }>>> = {
  textarea: { id: 'label.unrecognised-textarea', category: 'freeText.other', strength: 'weak' },
  checkbox: { id: 'label.unrecognised-checkbox', category: 'consent.other', strength: 'weak' },
};

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
  /** Set when nothing may answer the field: see NEEDS_USER_CAUSES. `category` then says only what it asks about. */
  needsUser?: NeedsUserCause;
}

function hitOf(rule: { id: string; strength: RuleStrength }, category: FieldCategory): LabelRuleHit {
  return { rule: rule.id, category, strength: rule.strength, confidence: LABEL_RULE_CONFIDENCE[rule.strength] };
}

const consentRank = (category: FieldCategory) => {
  const rank = CONSENT_STRICTNESS.indexOf(category);
  return rank < 0 ? CONSENT_STRICTNESS.length : rank;
};

const ruleById = (id: string) => LABEL_RULES.find((rule) => rule.id === id)!;

// ---- The review's refinements (2026-10-30) ----

/** A leading ask ("What is your", "Please enter your", "Your") set aside before a label is read as a noun phrase. */
const ASK = /^(?:(?:please|kindly)\s+)?(?:(?:what\s+(?:is|are|was|were)|whats|who\s+(?:is|was)|whos|enter|provide|list|share|give|state|indicate|type|add|include|tell\s+us)\s+)?(?:(?:your|the)\s+)?/;

/** Words that may qualify an employer, a job title or a phone in the field's own label. */
const WHEN = String.raw`(?:current|currently|most\s+recent|recent|previous|prior|past|last|present|former|your|the)`;

/** A phone number's own label ("Phone", "Mobile number", "Best phone number to reach you"); not "Phone extension",
 *  not a question that mentions a phone ("availability for a phone interview", "mobile development experience"). */
const PHONE_NOUN = /^(?:(?:primary|main|daytime|day|evening|home|work|business|contact|mobile|cell|cellular|personal|best|preferred|current|your)\s+)*(?:phone|mobile|cell|cellphone|telephone)(?:\s+(?:phone|number|no|num))*(?:\s+(?:to\s+(?:reach|contact)\s+you|where\s+(?:we\s+can\s+reach\s+you|you\s+can\s+be\s+reached)|(?:with|including|incl|include)\s+(?:the\s+)?(?:country|area)\s+code))?$/;
/** A phone number whose label also names its country code: the number, not the code. */
const PHONE_WITH_CODE = /\b(?:phone|mobile|telephone)\s+(?:number\s+)?(?:with|including|incl|include)\s+(?:the\s+)?country\s+code\b/;
/** Address line 2's own label ("Apt / Suite", "Unit"); not "business unit", not "Office Suite". */
const ADDRESS2_NOUN = /address\s+line\s*2|^address\s+2$|^(?:apt|apartment|suite|ste|unit|floor|fl|building|bldg|room)(?:\s+(?:apt|apartment|suite|ste|unit|floor|fl|building|bldg|room|number|no|or|and|etc))*$/;
/** A portfolio link's own label; not "What size portfolio have you managed?" */
const PORTFOLIO_NOUN = /^(?:(?:online|personal|design|work|professional|your)\s+)*portfolio(?:\s+(?:url|link|website|site|web\s+site|address|or\s+website))*$|\b(?:link|url)\s+to\s+(?:your\s+|a\s+|an\s+)?(?:online\s+)?portfolio\b|\bportfolio\s+(?:url|link|website|site)\b/;
/** A field of study: the design's longer wordings anywhere, but "major" and "discipline" only as the label's own noun
 *  ("Major", "Intended major"); not "What are your major accomplishments?" */
const FIELD_NOUN = /field\s+of\s+study|area\s+of\s+study|concentration|speciali[sz]ation|^(?:(?:your|primary|intended|declared|first|second|double|academic|main)\s+)*(?:majors?|discipline)(?:\s+(?:and\s+|or\s+)?(?:majors?|minors?|discipline|subject|field|area))*$/;
const COMPANY_WORD = String.raw`(?:company|employer|organi[sz]ation)`;
/** An employer's own label ("Current company", "Employer name", "Who is your current employer?"); not a question that
 *  mentions a company ("Have you previously worked for this company?", "How did you hear about our company?"). */
const COMPANY_NOUN = new RegExp(String.raw`^(?:${WHEN}\s+)*${COMPANY_WORD}(?:\s+(?:or\s+|and\s+)?${COMPANY_WORD})*(?:\s+name)?$|^name\s+of\s+(?:${WHEN}\s+)*${COMPANY_WORD}$`);
const TITLE_WORD = String.raw`(?:title|position|role)`;
/** A job title's own label ("Job title", "Current position", "Title/Position"); not "Position applied for", not a
 *  question about a role, and not "title" inside a word ("entitled"). */
const TITLE_NOUN = new RegExp(String.raw`^(?:(?:${WHEN}|job|position|role|professional|work)\s+)*${TITLE_WORD}(?:\s+(?:or\s+|and\s+)?${TITLE_WORD})*(?:\s+(?:name|held))?$|^title\s+of\s+(?:${WHEN}\s+)*(?:position|role|job)$`);
/** Total experience. Years with a skill or in a role ("years of experience with Python") are another question. */
const TOTAL_YEARS = /^(?:total\s+)?(?:number\s+of\s+)?years\s+of\s+(?:total\s+|professional\s+|relevant\s+|work\s+|working\s+|industry\s+)?experience$|how\s+many\s+(?:total\s+)?years\s+of\s+(?:total\s+|professional\s+|relevant\s+|work\s+|working\s+|industry\s+)?experience\s+do\s+you\s+have$/;
/** Availability to start. Availability for an interview, a shift or a weekend is another question. */
const START_AVAILABILITY = /when\s+can\s+you\s+start|earliest\s+start|available\s+to\s+start|availability\s+(?:to|for)\s+(?:start|starting|begin|employment)\b|\bstart(?:ing)?\s+availability\b|^availability(?:\s+date)?$/;
/** Pay as a topic rather than the person's pay: "compensation planning", "experience with payroll". */
const PAY_TOPIC = /\b(?:compensation|salary|salaries|pay|payroll)\s+(?:planning|plans?|strateg(?:y|ies)|benchmark\w*|analysis|analyst|analytics|structures?|philosophy|programs?|committee|management|administration|surveys?|data|consulting|practices|polic(?:y|ies)|reviews?|cycles?|design|tools?|software|systems?|teams?|functions?|benefits|equity|transparency|laws?|regulations?)\b|\b(?:compensation|salary|pay)\s+and\s+benefits\b|\b(?:experience|familiar|familiarity|knowledge|expertise)\s+(?:with|in|of)\s+(?:\w+\s+){0,2}(?:compensation|salary|salaries|payroll)\b/;
/** Current, previous or historical pay, the time word qualifying the pay itself. */
const PAST_PAY = /\b(?:current|currently|previous|prior|last|present|most\s+recent|existing|former)\s+(?:\w+\s+){0,2}?(?:salary|salaries|compensation|pay|wages?|remuneration|ctc|earnings|income|base)\b|\b(?:salary|pay|compensation)\s+history\b|\bhow\s+much\s+(?:do|did)\s+you\s+(?:currently\s+)?(?:make|earn)\b/;
/** Expected-pay wordings §8.3's rule misses. An hourly or day rate is not among them: the value is a yearly figure. */
const PAY_EXPECTATION = /\bpay\s+range\b|\bbase\s+pay\b|\b(?:desired|expected|target|requested)\s+(?:(?:annual|yearly|base|total)\s+)*(?:pay|compensation|salary)\b|\btotal\s+compensation\b/;
/** Language names, for a proficiency question about a language rather than a tool ("Excel proficiency"). */
const LANGUAGE_PROFICIENCY = /\b(?:languages?|english|spanish|french|german|italian|portuguese|dutch|polish|russian|ukrainian|turkish|arabic|hebrew|persian|farsi|hindi|urdu|bengali|punjabi|tamil|telugu|marathi|gujarati|mandarin|cantonese|chinese|japanese|korean|vietnamese|thai|indonesian|malay|tagalog|filipino|swahili|greek|swedish|norwegian|danish|finnish|czech|slovak|hungarian|romanian|bulgarian|serbian|croatian|catalan|irish|welsh|afrikaans|amharic|nepali|sign\s+language)\b|^(?:proficiency|fluency)(?:\s+level)?$|^level\s+of\s+(?:proficiency|fluency)$/;
/** A legal reading of "eligible", "permitted" or "entitled to work": a place, "legally", "lawfully" or any employer.
 *  Without one it is a question about the job ("eligible to work overtime"). */
const WORK_AUTH_LEGAL = /authori[sz]ed\s+to\s+work|right\s+to\s+work|work\s+authori[sz]ation|\b(?:legally|lawfully)\b|(?:eligible|permitted|entitled)\s+to\s+work\s+(?:\w+\s+){0,4}?(?:in|within)\s+(?!(?:a|an|our|shifts?|teams?|person|office|offices|hybrid|remote|remotely|this\s+(?:role|position|job|team|office)|the\s+(?:office|field|evenings?|mornings?|afternoons?|weekends?|days?|nights?|shifts?|role|position|job|team|warehouse|store|lab|clinic))\b)\w+|(?:eligible|permitted|entitled)\s+to\s+work\s+for\s+(?:any|an|all)\s+employers?/;
/** Sponsorship in the immigration sense: a visa or work authorization named, or sponsorship required or needed.
 *  Without one it is sponsorship in the business sense ("sponsorship sales"). */
const VISA_SPONSORSHIP = /\bvisas?\b|\bimmigra\w*|\bh\s?1\s?b\b|\bgreen\s+card\b|\bpermanent\s+residen\w*|\bcitizen\w*|\bwork\s+(?:authori[sz]\w*|permits?|status|eligibility)\b|\bemployment\s+(?:authori[sz]\w*|visas?|status|eligibility|based)\b|\bto\s+work\b|\bfor\s+employment\b|\b(?:require|requires|required|requiring|need|needs|needed|needing)\b(?:\s+\w+){0,3}?\s+sponsor\w*|\bsponsor\w*\s+(?:\w+\s+){0,2}?(?:required|needed|status)\b|^(?:visa\s+)?sponsorship\b|\bsponsorship\s+(?:now|in\s+the\s+future|to\s+work)\b/;

// Self-identification wordings: a topic word without one ("experience supporting individuals with disabilities") is a
// question about the job, which the person answers; it never takes their self-identification answer.
const HISPANIC_WORD = String.raw`(?:hispanic|latin[oax]|latine|spanish)`;
const HISPANIC_SELF = new RegExp(String.raw`^(?:(?:are|r)\s+you\s+|ethnicity\s+|i\s+am\s+|you\s+are\s+)?(?:of\s+)?(?:not\s+)?${HISPANIC_WORD}(?:\s+(?:or\s+|and\s+)?${HISPANIC_WORD})*(?:\s+(?:origin|descent|heritage|ethnicity|status|background|self\s+identification))*$|\b(?:are\s+you|i\s+am|you\s+are)\s+(?:not\s+)?(?:of\s+)?(?:hispanic|latin)|\bidentify\s+(?:yourself\s+)?as\s+(?:a\s+)?(?:hispanic|latin)|\bconsider\s+yourself\s+(?:to\s+be\s+)?(?:a\s+)?(?:hispanic|latin)`);
const RACE_WIDE = /\b(?:your|my)\s+(?:race|races|racial|ethnicity|ethnicities|ethnic)\b|\b(?:race|races|ethnicity|ethnicities)\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\b(?:which|what)\s+(?:race|races)\b/;
const RACE_SELF = /^(?:race|races|ethnicity|ethnicities|racial|ethnic)\b|\b(?:your|my)\s+(?:race|races|racial|ethnicity|ethnicities|ethnic)\b|\b(?:race|races|ethnicity|ethnicities)\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\b(?:which|what)\s+(?:race|races|ethnicity|ethnicities)\b|\bidentify\b(?:\s+\w+){0,4}\s+(?:race|ethnicity|racial|ethnic)\b|\b(?:race|ethnicity|racial|ethnic)\b(?:\s+\w+){0,4}\s+(?:identify|identification)\b|\b(?:race|ethnicity)\s+(?:and|or)\s+(?:race|ethnicity)\b/;
/** Gender wordings §8.3's anchored rule misses ("What best describes your gender?", "Which gender do you identify
 *  as?"). A question that sets gender identity against the sex assigned at birth is the transgender question. */
const GENDER_WIDE = /^(?!.*\b(?:transgender|cisgender|assigned\s+at\s+birth|sexual\s+orientation)\b)(?:.*\b(?:your|my)\s+(?:gender|sex)\b|.*\b(?:which|what)\s+gender\b|.*\bgender\s+(?:do\s+you|you)\s+(?:\w+\s+)?identify\b|^(?:gender|sex)\s+(?:identity|identification|self\s+identification)$)/;
const VETERAN_WIDE = /\b(?:have|did)\s+you\s+(?:ever\s+)?serve[d]?\s+in\s+the\s+(?:us\s+|u\s+s\s+|united\s+states\s+)?(?:military|armed\s+forces|army|navy|air\s+force|marines?|marine\s+corps|coast\s+guard|national\s+guard|reserves?|space\s+force)\b|\bmilitary\s+status\b/;
const VETERAN_SELF = /^(?:(?:protected|military|us|u\s+s|armed\s+forces)\s+(?:and\s+|or\s+)?)*(?:veteran|military)(?:\s+(?:and\s+|or\s+)?(?:veteran|military|protected))*(?:\s+(?:status|self\s+identification|classification|information|service))*$|\b(?:are\s+you|i\s+am|you\s+are)\s+(?:not\s+)?(?:a\s+|an\s+)?(?:(?:protected|military|us|u\s+s|armed\s+forces|disabled|recently\s+separated)\s+)*veteran\b|\bidentify\s+as\s+(?:a\s+|one\s+or\s+more\s+of\s+the\s+classifications\s+of\s+)?(?:protected\s+)?veteran\b|\b(?:veteran|military)\s+status\b|\bprotected\s+veteran\b|\b(?:have|did)\s+you\s+(?:ever\s+)?serve[d]?\s+in\s+the\b|\b(?:your|my)\s+(?:veteran|military)\s+(?:status|service)\b/;
const DISABILITY_SELF = /^(?:voluntary\s+)?(?:self\s+identification\s+(?:of\s+)?)?disabilit(?:y|ies)(?:\s+(?:status|self\s+identification|disclosure|information|inclusion))*$|\bdisability\s+status\b|\b(?:do|did)\s+you\s+(?:currently\s+)?(?:have|consider\s+yourself\s+to\s+have|identify\s+as\s+(?:having|a\s+person\s+with|an?\s+individual\s+with))\s+(?:a\s+|any\s+)?disabilit|\b(?:are\s+you|i\s+am)\s+(?:a\s+|an\s+)?(?:person|individual)\s+with\s+(?:a\s+)?disabilit|\bi\s+(?:have|do\s+not\s+have|dont\s+have)\s+(?:a\s+)?disabilit|\b(?:have\s+you\s+ever\s+had|history\s+of)\s+(?:a\s+)?disabilit|\bself\s+identif\w*(?:\s+\w+){0,4}\s+disabilit|\bdisabilit\w*(?:\s+\w+){0,4}\s+self\s+identif/;
const ORIENTATION_WIDE = /\blgbt\w*|\bqueer\b/;
const ORIENTATION_SELF = /^(?:your\s+)?sexual\s+orientation\b|\b(?:your|my)\s+sexual\s+orientation\b|\bsexual\s+orientation\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\bidentify\b(?:\s+\w+){0,4}\s+sexual\s+orientation\b|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|i\s+consider\s+myself|do\s+you\s+consider\s+yourself)\b(?:\s+\w+){0,4}?\s+(?:lgbt\w*|queer|gay|lesbian|bisexual)\b|^(?:lgbt\w*\+?|queer)(?:\s+(?:status|identity|community|community\s+member))?$/;
const TRANSGENDER_WIDE = /\bassigned\s+at\s+birth\b|\bcisgender\b/;
const TRANSGENDER_SELF = /^transgender(?:\s+(?:status|identity|experience|history))?$|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|do\s+you\s+consider\s+yourself|i\s+consider\s+myself)\s+(?:to\s+be\s+)?(?:a\s+)?(?:trans|transgender|cisgender|cis)\b|\bassigned\s+at\s+birth\b|\bcisgender\b|\btransgender\s+(?:experience|history|status|identity)\b/;
/** Over-18 wordings §8.3's rule misses ("over the age of 18", "18 or older"). "Under 18" is not among them: its yes
 *  means the opposite. */
const OVER18_WIDE = /\b(?:over|above|older\s+than)\s+the\s+age\s+of\s+(?:18|eighteen)\b|\b(?:18|eighteen)\s+(?:years\s+)?(?:of\s+age\s+)?(?:old\s+)?(?:or|and)\s+(?:older|over|above)\b|\b(?:at\s+least|over|older\s+than)\s+eighteen\b|\beighteen\s+years\s+(?:of\s+age|or\s+older)\b/;
/** Criminal-history wordings §8.3's rule misses ("unspent convictions", "found guilty", "an offence"). */
const CRIMINAL_WIDE = /\bconvictions?\b|\boffen[cs]es?\b|\boffenders?\b|\bguilty\b|\barrested\b|\bunspent\b|\bmisdemeanou?rs?\b|\bnolo\s+contendere\b|\bcharged\s+with\s+(?:a\s+|an\s+|any\s+)?(?:crime|criminal|offen[cs]e|felony|misdemeanou?r)\b|\bcrimes?\b/;
/** A check the person consents to, which is not a claim about their record ("a criminal background check"). */
const RECORD_CHECK = /\b(?:criminal\s+)?(?:background|record|records|history)\s+(?:checks?|screenings?|search|searches|investigations?|reports?|verifications?)\b|\bcriminal\s+(?:checks?|screenings?|search|searches|investigations?|reports?)\b/g;

const AI_TERM = String.raw`(?:ai|a\s+i|artificial\s+intelligence|chat\s?gpt|gpt\w*|llms?|large\s+language\s+models?|language\s+models?|generative|genai|gen\s+ai|copilot)`;
const NEGATION = String.raw`(?:did\s+not|didnt|have\s+not|havent|has\s+not|hasnt|had\s+not|hadnt|was\s+not|wasnt|were\s+not|werent|do\s+not|dont|does\s+not|doesnt|will\s+not|wont|not|never|no|without)`;
/** An "I did not use AI" attestation as normalizeLabel writes it (no apostrophes: "didnt", "havent"), with a few words
 *  between the negation and the AI term, either way round. */
const AI_ATTESTATION = new RegExp(String.raw`\b${NEGATION}\b(?:\s+\w+){0,5}?\s+${AI_TERM}\b|\b${AI_TERM}\b(?:\s+\w+){0,4}?\s+(?:was|were|has\s+been|have\s+been|is|are)\s+(?:not|never)\s+(?:used|involved)\b`);
/** AI named anywhere in consent wording: that box is an AI attestation, which is never pre-approved (§8.7). */
const AI_NAMED = new RegExp(String.raw`\b${AI_TERM}\b`);
/** Unrecognised-consent wordings beyond §8.3's "I agree, consent, acknowledge, accept, understand". */
const CONSENT_WIDE = /\bi\s+(?:(?:hereby|also|further|expressly|fully)\s+)*(?:confirm|declare|have\s+read|give\s+(?:my\s+)?(?:permission|consent)|authori[sz]e|grant|allow)\b|\byou\s+(?:also\s+)?(?:agree|consent|acknowledge|accept|confirm|authori[sz]e)\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b|\bi\s+would\s+like\s+to\s+(?:receive|be\s+(?:contacted|considered|notified|added|kept))\b/;
/** A radio that asks for consent: a first-person consent verb, or "Do you consent", "Would you like to receive". On a
 *  radio without one, a consent topic word ("experience in marketing") is not consent. */
const CONSENT_ASK = /\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*(?:agree|consent|acknowledge|accept|understand|certify|attest|confirm|declare|authori[sz]e|give|grant|allow|have\s+read)\b|\b(?:do|would|will|can|may)\s+(?:you|we)\s+(?:\w+\s+){0,2}?(?:consent|agree|accept|acknowledge|authori[sz]e|allow|permit|opt|subscribe|receive|join|store|keep|retain|contact|share|use|send|text|email)\b|\b(?:would|do)\s+you\s+(?:like|want|wish)\s+to\b|\bopt\s+(?:in|out)\b|\bsign\s+up\b|\bsubscribe\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b/;
/** Where a consent clause starts: a consent verb, with its "I". */
const CONSENT_VERB = /(?:\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*)?\b(?:agree|consent|acknowledge|accept|understand|certify|attest|confirm|declare|authori[sz]e|give|grant|allow)\b/g;
/** Words that carry no object of their own, so a clause of only these after its verb ("I acknowledge that I have read
 *  and") belongs to the next one, or, at the end ("Privacy policy: I agree"), to the one before. */
const CLAUSE_FILLER = new Set(['that', 'i', 'have', 'has', 'had', 'read', 'and', 'or', 'understood', 'understand',
  'receipt', 'of', 'the', 'above', 'below', 'following', 'hereby', 'fully', 'carefully', 'also', 'both', 'all',
  'these', 'those', 'this', 'a', 'an', 'to', 'am', 'been', 'reviewed', 'review', 'received', 'it', 'them', 'any',
  'with', 'my', 'do', 'further', 'expressly']);

/** How the review narrows or widens one of the design's rules. */
interface Refinement {
  /** More wordings the rule covers. */
  also?: RegExp;
  /** The rule applies only when this matches too; tested without a leading ask ("What is your") when `ask` is set. */
  only?: RegExp;
  ask?: boolean;
  /** Wordings the rule leaves alone. */
  unless?: RegExp;
  /** What a text the rule matched but `only` or `unless` turned away is instead; without it the next rule is tried. */
  otherwise?: { id: string; category: FieldCategory; strength: RuleStrength; needsUser?: NeedsUserCause };
  /** The category in place of the design's. */
  category?: (ctx: RuleCtx) => FieldCategory;
  /** The category and needsUser read the label with its parentheticals ("Do you require sponsorship (now)?"). */
  readsQualifiers?: boolean;
  /** Why nothing may answer what the rule matched, when the text says so. */
  needsUser?: (ctx: RuleCtx) => NeedsUserCause | null;
}

/** A self-identification topic without a self-identification wording: a question about the job, the person's own. */
const SENSITIVE_TOPIC = { id: 'label.sensitive-topic', category: 'screening.other', strength: 'normal',
  needsUser: 'sensitive-topic' } as const;

/** The review's refinements, by the design rule they change. */
const REFINEMENTS: Readonly<Record<string, Refinement>> = {
  'label.preferred-name': { also: /name\s+you(?:d|\s+would)?\s+(?:prefer|like)\s+(?:us\s+)?to\s+(?:use|call\s+you)|\bname\s+you\s+prefer\b/ },
  'label.phone-country': { unless: PHONE_WITH_CODE },
  'label.phone': { only: PHONE_NOUN, ask: true },
  'label.address2': { only: ADDRESS2_NOUN },
  'label.country': { also: /^(?:what\s+is\s+your\s+)?(?:current\s+)?country(?:\s+of\s+(?:current\s+)?residence)?$|^what\s+country\s+do\s+you\s+(?:currently\s+)?(?:live|reside)\s+in$/ },
  'label.location': { also: /^(?:what\s+is\s+)?your\s+(?:current\s+)?location$/ },
  'label.portfolio': { only: PORTFOLIO_NOUN, ask: true },
  'label.work-auth': { also: /\bentitled\s+to\s+work\b/, only: WORK_AUTH_LEGAL },
  'label.sponsorship': { only: VISA_SPONSORSHIP, readsQualifiers: true,
    needsUser: (c) => (sponsorshipTime(c.label) === 'unclear' ? 'unclear-time' : null) },
  'label.over18': { also: OVER18_WIDE },
  'label.criminal': { also: CRIMINAL_WIDE },
  'label.hispanic': { only: HISPANIC_SELF, otherwise: SENSITIVE_TOPIC },
  'label.race': { also: RACE_WIDE, only: RACE_SELF, otherwise: SENSITIVE_TOPIC },
  'label.gender': { also: GENDER_WIDE },
  'label.veteran': { also: VETERAN_WIDE, only: VETERAN_SELF, otherwise: SENSITIVE_TOPIC },
  'label.disability': { only: DISABILITY_SELF, otherwise: SENSITIVE_TOPIC },
  'label.orientation': { also: ORIENTATION_WIDE, only: ORIENTATION_SELF, otherwise: SENSITIVE_TOPIC },
  'label.transgender': { also: TRANSGENDER_WIDE, only: TRANSGENDER_SELF, otherwise: SENSITIVE_TOPIC },
  'label.field': { only: FIELD_NOUN, ask: true },
  'label.company': { only: COMPANY_NOUN, ask: true },
  'label.title': { only: TITLE_NOUN, ask: true },
  'label.years': { only: TOTAL_YEARS,
    otherwise: { id: 'label.skill-years', category: 'screening.other', strength: 'normal' } },
  'label.salary': { also: PAY_EXPECTATION, unless: PAY_TOPIC,
    category: (c) => (PAST_PAY.test(c.label) ? 'unknown' : 'salary.expected'),
    needsUser: (c) => (PAST_PAY.test(c.label) ? 'current-pay' : null) },
  'label.availability': { only: START_AVAILABILITY, ask: true,
    otherwise: { id: 'label.other-availability', category: 'screening.other', strength: 'normal' } },
  'label.relocation': { unless: /\brelocat\w*\s+(?:assistance|package|support|benefits?|reimbursement|bonus|expenses?|costs?|stipend|allowance|help|budget|polic(?:y|ies)|services?)\b/ },
  'label.travel': { unless: /\btravel\s+(?:restrictions?|limitations?|constraints?|bans?|reimbursements?|expenses?|polic(?:y|ies)|documents?|history)\b|\brestrictions?\s+on\s+(?:your\s+)?travel\b/ },
  'label.language': { unless: /\b(?:proficiency|fluency|level)\b/ },
  'label.proficiency': { only: LANGUAGE_PROFICIENCY },
  'label.resume': { category: (c) => (c.kind === 'file' ? 'file.resume'
    : c.kind === 'checkbox' || c.kind === 'radio' ? 'consent.other' : 'unknown') },
  'label.why-company': { also: /why\s+do\s+you\s+want\s+to\s+(?:work|join)|why\s+(?:are\s+you\s+)?interested\s+in\s+(?:joining|working\s+(?:at|for|with))|what\s+(?:excites|interests|attracts|draws)\s+you\s+(?:to|about)\s+(?:joining|working\s+(?:at|for|with)|our\s+company|the\s+company|us)\b|^why\s+us$/ },
  'label.why-role': { also: /why\s+(?:are\s+you\s+)?interested\s+in\s+(?:this|the|our)\s+(?:role|position|job|opportunity)|why\s+do\s+you\s+want\s+(?:this|the)\s+(?:role|position|job)|why\s+(?:are\s+you\s+)?applying\s+(?:for|to)\s+(?:this|the)\s+(?:role|position|job)|what\s+(?:excites|interests|attracts|draws|appeals\s+to)\s+you\s+(?:about|in|to)\s+(?:this|the)\s+(?:role|position|job|opportunity)/ },
  'label.consent-ai': { also: AI_ATTESTATION },
  'label.consent-generic': { also: CONSENT_WIDE },
};

/** "Why Acme?" as the page wrote it: a why-question naming the company with its own capitals, never "Why not?" or
 *  "Why leaving?". A label all in capitals tells nothing, so it never counts. */
const WHY_NAME = /^\s*[Ww][Hh][Yy]\s+\p{Lu}[\p{L}\p{N}&.\u2019'-]*(?:\s+\p{Lu}[\p{L}\p{N}&.\u2019'-]*)*[\s?*]*$/u;
const whyName = (rawLabel: string) => WHY_NAME.test(rawLabel) && rawLabel !== rawLabel.toUpperCase();

/** A rule that decides before §8.3's list (the review): each is a question no profile answer states. */
interface PreRule {
  id: string;
  re: RegExp;
  unless?: RegExp;
  /** The rule reads the label's parentheticals too: "Country (of citizenship)" asks for a nationality. */
  readsQualifiers?: boolean;
  category: FieldCategory;
  strength: RuleStrength;
  needsUser: NeedsUserCause;
}

/** The rules run before §8.3's list, in order. */
export const PRE_RULES: ReadonlyArray<PreRule> = [
  // "Are you authorized to work in the US without sponsorship?" and "I am authorized to work and do not require
  // sponsorship" join two answers; "able to work without sponsorship" inverts the sponsorship one.
  { id: 'label.authorization-and-sponsorship', re: /\bwithout\b(?:\s+\w+){0,5}?\s+sponsor\w*|\b(?:not|never|dont|wont|doesnt|cannot|cant|no\s+longer)\b(?:\s+\w+){0,6}?\s+(?:need|require)\w*(?:\s+\w+){0,4}?\s+sponsor\w*|\bno\s+(?:need\s+for\s+|requirement\s+for\s+)?(?:\w+\s+)?sponsorship\b|(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b.*\bsponsor\w*|\bsponsor\w*\b.*\b(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b/,
    category: 'workAuth.authorized', strength: 'strong', needsUser: 'authorization-and-sponsorship' },
  { id: 'label.work-permit', re: /\b(?:work|working|residence|residency)\s+permits?\b|\bblue\s+card\b|\bpermit\s+to\s+work\b/,
    unless: /\bsponsor/, category: 'workAuth.authorized', strength: 'strong', needsUser: 'work-permit' },
  { id: 'label.nationality', re: /\bnationalit(?:y|ies)\b|\bnational\s+origin\b|\bcountr(?:y|ies)\s+of\s+(?:citizenship|nationality|birth|origin)\b|\bcountr(?:y|ies)\b(?:\s+\w+){0,6}?\s+citizen\w*|\bcitizen\w*(?:\s+\w+){0,4}?\s+countr(?:y|ies)\b|\bpassport\s+(?:country|nationality)\b|\bplace\s+of\s+birth\b|\bbirth\s*place\b/,
    readsQualifiers: true, category: 'workAuth.status', strength: 'normal', needsUser: 'nationality' },
  // An age, a date of birth, or an age line other than 18 ("under 18" inverts the over-18 answer; 21 is another line).
  { id: 'label.age', re: /^(?:what\s+is\s+)?(?:your\s+)?(?:current\s+)?age(?:\s+(?:range|group|bracket|in\s+years))?$|\bdate\s+of\s+birth\b|\bbirth\s*date\b|\bbirthday\b|\bdob\b|\bhow\s+old\s+are\s+you\b|\byear\s+of\s+birth\b|\bbirth\s+year\b|\byour\s+age\b|\b(?:under|younger\s+than|below)\s+(?:the\s+age\s+of\s+)?(?:18|eighteen|21|twenty\s+one)\b|\b(?:21|twenty\s+one)\s+(?:years\s+)?(?:of\s+age\s+)?(?:old\s+)?(?:or|and)\s+(?:older|over|above)\b|\b(?:over|at\s+least|older\s+than)\s+(?:the\s+age\s+of\s+)?(?:21|twenty\s+one)\b/,
    readsQualifiers: true, category: 'screening.over18', strength: 'normal', needsUser: 'age' },
];

/** The design's own rules for dates, which in a repeatable section the design does not name belong to the block. */
const DATE_RULES = new Set(['label.start-date', 'label.end-date']);
/** The classes whose question stops at a needs-user hit on a kind that cannot hold it, so no later rule claims it. */
const STOPPING_CLASSES: readonly PolicyClass[] = ['legal', 'eeo', 'sensitive', 'attention'];

const SPECIFIC_CONSENT_RULES = CONSENT_RULES.filter((rule) => rule.id !== 'label.consent-generic');
const GENERIC_CONSENT_RULE = ruleById('label.consent-generic');
const AI_CONSENT_RULE = ruleById('label.consent-ai');
const CRIMINAL_RULE = ruleById('label.criminal');

/** Whether `rule`, with its refinement, reads `text` as its own: 'match', 'turned-away' (`only` or `unless` refused a
 *  text the rule's patterns matched), or null. */
function refinedMatch(rule: LabelRule, text: string): 'match' | 'turned-away' | null {
  const refinement = REFINEMENTS[rule.id];
  if (!rule.re.test(text) && !(refinement?.also?.test(text) ?? false)) return null;
  if (refinement === undefined) return 'match';
  if (refinement.unless?.test(text)) return 'turned-away';
  const only = refinement.only;
  if (only !== undefined && !only.test(refinement.ask ? text.replace(ASK, '') : text)) return 'turned-away';
  return 'match';
}

/** The consent clauses of `text`: from one consent verb to the next, a clause with no object of its own joined to its
 *  neighbour. Text before the first verb is no clause; [] when there is no consent verb. */
function consentClauses(text: string): string[] {
  const verbs = [...text.matchAll(CONSENT_VERB)];
  const first = verbs[0];
  if (first === undefined) return [];
  const pieces = verbs.map((verb, at) => {
    const end = verbs[at + 1]?.index ?? text.length;
    const rest = text.slice(verb.index + verb[0].length, end).split(' ').filter((word) => word !== '');
    return { text: text.slice(verb.index, end), filler: rest.every((word) => CLAUSE_FILLER.has(word)) };
  });
  const clauses: string[] = [];
  let pending = '';
  for (const [at, piece] of pieces.entries()) {
    const joined = pending + piece.text;
    pending = '';
    if (piece.filler && at + 1 < pieces.length) pending = joined;
    else if (piece.filler && clauses.length > 0) clauses[clauses.length - 1] += joined;
    else if (piece.filler) clauses.push(text.slice(0, first.index) + joined);
    else clauses.push(joined);
  }
  return clauses;
}

/** Whether a consent clause names a kind §8.3 knows (read as "I ...", as its rules expect). */
const clauseHasKind = (clause: string) => {
  const asI = clause.startsWith('i ') ? clause : `i ${clause}`;
  return SPECIFIC_CONSENT_RULES.some((rule) => refinedMatch(rule, asI) === 'match');
};

interface ConsentEntry {
  rule: LabelRule;
  category: FieldCategory;
}

/**
 * Every consent kind `text` reads as, strictest first (§8.7), equals in rule order, each with its rule: the specific
 * kinds over the whole text; unrecognised consent for each consent clause no specific kind covers ("and agree to
 * binding arbitration"), or for consent wording that names nothing; an AI attestation when consent wording names AI.
 */
function consentEntries(text: string): ConsentEntry[] {
  const entries: ConsentEntry[] = [];
  const add = (rule: LabelRule, category: FieldCategory) => {
    if (!entries.some((entry) => entry.category === category)) entries.push({ rule, category });
  };
  for (const rule of SPECIFIC_CONSENT_RULES) {
    if (refinedMatch(rule, text) === 'match') add(rule, rule.category as FieldCategory);
  }
  if (consentClauses(text).some((clause) => !clauseHasKind(clause))
    || (entries.length === 0 && refinedMatch(GENERIC_CONSENT_RULE, text) === 'match')) {
    add(GENERIC_CONSENT_RULE, 'consent.other');
  }
  if (entries.length > 0 && AI_NAMED.test(text)) add(AI_CONSENT_RULE, 'consent.aiAttestation');
  return entries.sort((a, b) => consentRank(a.category) - consentRank(b.category));
}

/**
 * The hit for consent `entries` on a field of `kind`: the strictest kind the field can hold, with all such kinds. When
 * no kind fits, or the strictest is one nothing may fill (an AI attestation, unrecognised consent) and the field cannot
 * hold it ("Sign below to agree to binding arbitration" in a text box), the field is the person's.
 */
function consentVerdict(entries: readonly ConsentEntry[], kind: FieldKind): LabelRuleHit {
  const top = entries[0]!;
  const fitting = entries.filter((entry) => kindAllowed(entry.category, kind));
  const winner = fitting[0];
  if (winner === undefined || (USER_ONLY_CATEGORIES.has(top.category) && !kindAllowed(top.category, kind))) {
    return { ...hitOf(top.rule, top.category), consentKinds: entries.map((entry) => entry.category),
      needsUser: 'kind-mismatch' };
  }
  return { ...hitOf(winner.rule, winner.category), consentKinds: fitting.map((entry) => entry.category) };
}

/** A claim about the person's criminal record, which only they make, even inside a certification; a criminal
 *  background check they consent to is not one. */
const criminalClaim = (text: string) => {
  const claims = text.replace(RECORD_CHECK, ' ');
  return CRIMINAL_RULE.re.test(claims) || CRIMINAL_WIDE.test(claims);
};

/**
 * The first label rule that matches `text` (a normalized label, or a normalized label and description) and whose
 * category the field's kind can hold, or null, with the review's refinements (see the header): PRE_RULES first; on a
 * lone checkbox or a radio worded as consent, consent first; then §8.3's list, each rule narrowed or widened by its
 * refinement. A consent match is settled by strictness among all the consent rules. A legal, EEO or sensitive rule on
 * a kind that cannot hold its category stops at a needs-user hit.
 */
export function matchLabelRules(text: string, section: SectionKind, kind: FieldKind, context: LabelContext = {}):
  LabelRuleHit | null {
  if (text === '') return null;
  const ctx: RuleCtx = { label: text, section, kind, qualifiers: context.qualifiers ?? '',
    rawLabel: context.rawLabel ?? '' };
  if (context.block !== undefined) ctx.block = context.block;
  for (const rule of PRE_RULES) {
    const reads = rule.readsQualifiers && ctx.qualifiers !== '' ? [text, `${text} ${ctx.qualifiers}`] : [text];
    if (reads.some((read) => rule.re.test(read) && !(rule.unless?.test(read) ?? false))) {
      return { ...hitOf(rule, rule.category), needsUser: rule.needsUser };
    }
  }
  // Consent first only for wording that consents: a box that names a consent topic and nothing more ("Willing to
  // travel for marketing events") keeps §8.3's order, where the consent rules come last.
  const asksConsent = CONSENT_ASK.test(text);
  if ((kind === 'checkbox' || kind === 'radio') && (asksConsent || AI_ATTESTATION.test(text))) {
    if (criminalClaim(text)) return hitOf(CRIMINAL_RULE, 'screening.criminalHistory');
    const entries = consentEntries(text);
    if (entries.length > 0) return consentVerdict(entries, kind);
  }
  for (const rule of LABEL_RULES) {
    if (DATE_RULES.has(rule.id) && section === 'other' && context.block !== undefined) continue;
    const verdict = refinedMatch(rule, text);
    if (verdict === null) continue;
    const refinement = REFINEMENTS[rule.id];
    if (verdict === 'turned-away') {
      const otherwise = refinement?.otherwise;
      if (otherwise === undefined) continue;
      const hit = hitOf(otherwise, otherwise.category);
      if (otherwise.needsUser !== undefined) return { ...hit, needsUser: otherwise.needsUser };
      if (kindAllowed(otherwise.category, kind)) return hit;
      continue;
    }
    const read: RuleCtx = refinement?.readsQualifiers && ctx.qualifiers !== ''
      ? { ...ctx, label: `${text} ${ctx.qualifiers}` } : ctx;
    const category = refinement?.category?.(read)
      ?? (typeof rule.category === 'function' ? rule.category(read) : rule.category);
    const needsUser = refinement?.needsUser?.(read) ?? null;
    if (needsUser !== null) return { ...hitOf(rule, category), needsUser };
    const policy = policyClassOf(category);
    if (policy === 'consent') {
      if (kind === 'radio' && !asksConsent && category !== 'consent.aiAttestation') continue;
      const entries = consentEntries(text);
      if (entries.length > 0) return consentVerdict(entries, kind);
      return consentVerdict([{ rule, category }], kind);
    }
    if (!kindAllowed(category, kind)) {
      if (STOPPING_CLASSES.includes(policy)) return { ...hitOf(rule, category), needsUser: 'kind-mismatch' };
      continue;
    }
    return hitOf(rule, category);
  }
  if (whyName(ctx.rawLabel) && kindAllowed('freeText.whyCompany', kind)) {
    return hitOf(ruleById('label.why-company'), 'freeText.whyCompany');
  }
  return null;
}

/**
 * A consent hit with the consent kinds its field's description adds: help text that binds the box to more ("By ticking
 * this box you also agree to binding arbitration") or names AI makes it stricter, never laxer (§8.7).
 */
export function withDescriptionConsent(hit: LabelRuleHit, description: string, kind: FieldKind): LabelRuleHit {
  if (hit.consentKinds === undefined || hit.needsUser !== undefined || description === '') return hit;
  const extra = consentEntries(description);
  if (extra.length === 0) return hit;
  const own = hit.consentKinds.map((category) => ({ category,
    rule: (category === hit.category ? LABEL_RULES.find((rule) => rule.id === hit.rule) : undefined)
      ?? CONSENT_RULES.find((rule) => rule.category === category)! }));
  const merged = [...own, ...extra.filter((entry) => !hit.consentKinds!.includes(entry.category))]
    .sort((a, b) => consentRank(a.category) - consentRank(b.category));
  return consentVerdict(merged, kind);
}

/** UNLABELLED_TEXTAREA_RULE's hit for a textarea whose normalized label is empty, else null. */
export function unlabelledTextarea(normalizedLabel: string, kind: FieldKind): LabelRuleHit | null {
  return kind === 'textarea' && normalizedLabel === ''
    ? hitOf(UNLABELLED_TEXTAREA_RULE, UNLABELLED_TEXTAREA_RULE.category)
    : null;
}

/** UNRECOGNISED_FIELD_RULES' hit for a labelled textarea or a lone checkbox no rule classified, else null. */
export function unrecognisedField(kind: FieldKind): LabelRuleHit | null {
  const rule = UNRECOGNISED_FIELD_RULES[kind];
  if (rule === undefined) return null;
  const hit = hitOf(rule, rule.category);
  return policyClassOf(rule.category) === 'consent' ? { ...hit, consentKinds: [rule.category] } : hit;
}
