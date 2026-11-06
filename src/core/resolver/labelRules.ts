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
 *   attestation whenever it names AI; only a real "I did not use AI" statement (attestsNoAiUse) is one a run reads as
 *   forbidding AI (the Phase E review, M5).
 * - Data retention is the employer retaining or keeping the application on file; being contacted about future roles,
 *   job alerts and a talent community or pool are marketing (the Phase E review, B1), which is never pre-approved by
 *   default.
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
  /** How the application was made (the audit of 2026-11-06, S-4): whether AI, automation, an extension or someone's help
   *  made it, or a denial that any was used. Only the person can say; the extension is automation itself. */
  'how-made',
  /** A binding waiver or covenant (arbitration, a jury-trial or class-action waiver, a non-compete or non-solicitation)
   *  asked on anything but a lone checkbox (the audit of 2026-11-06, S-5): the person's, never an AI's. */
  'binding-waiver',
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
  { id: 'label.current-study', re: /\bstill\s+(?:a\s+)?(?:student|studying|enrolled|attending)\b|\bcurrently\s+(?:a\s+student|studying|enrolled|attending)\b|\bi\s+(?:currently\s+)?(?:study|attend)\s+here\b/, category: 'education.current', strength: 'strong' },
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
/** More wordings of work authorization: "entitled to work", "(legally) eligible to be employed". */
const WORK_AUTH_WIDE = /\bentitled\s+to\s+work\b|\b(?:eligible|authori[sz]ed|permitted|entitled)\s+to\s+be\s+(?:employed|hired)\b|\beligible\s+for\s+employment\b/;
/** A question about which work authorization status the applicant holds (Workable's "Work Authorization Status",
 *  "Which best describes your work authorization status?"): which status, never yes or no. */
const WORK_AUTH_STATUS = /\bauthori[sz]ation\s+status\b|\bwork\s+(?:authori[sz]ation\s+)?status\b/;
/** An experience block's own summary of the role, labelled with that one word (the Phase 7a review: Workable's
 *  Experience "Summary"); any longer wording ("Role description") is left to the LLM's classification, as before. */
const EXPERIENCE_DESCRIPTION = /^(?:summary|description)$/;
const EXPERIENCE_DESCRIPTION_RULE = { id: 'label.experience-description', strength: 'normal' } as const;
const WORK_AUTH_STATUS_RULE = { id: 'label.work-auth-status', strength: 'strong' } as const;

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
const DISABILITY_SELF = /^(?:voluntary\s+)?(?:self\s+identification\s+(?:of\s+)?)?disabilit(?:y|ies)(?:\s+(?:status|self\s+identification|disclosure|information|inclusion))*$|\bdisability\s+status\b|\b(?:do|did)\s+you\s+(?:currently\s+)?(?:identify|consider\s+yourself)\s+(?:as\s+|to\s+be\s+)?(?:a\s+)?disabled\b|\b(?:do|did)\s+you\s+(?:currently\s+)?(?:have|consider\s+yourself\s+to\s+have|identify\s+as\s+(?:having|a\s+person\s+with|an?\s+individual\s+with))\s+(?:a\s+|any\s+)?disabilit|\b(?:are\s+you|i\s+am)\s+(?:a\s+|an\s+)?(?:person|individual)\s+with\s+(?:a\s+)?disabilit|\bi\s+(?:have|do\s+not\s+have|dont\s+have)\s+(?:a\s+)?disabilit|\b(?:have\s+you\s+ever\s+had|history\s+of)\s+(?:a\s+)?disabilit|\bself\s+identif\w*(?:\s+\w+){0,4}\s+disabilit|\bdisabilit\w*(?:\s+\w+){0,4}\s+self\s+identif/;
const ORIENTATION_WIDE = /\blgbt\w*|\bqueer\b/;
const ORIENTATION_SELF = /^(?:your\s+)?sexual\s+orientation\b|\b(?:your|my)\s+sexual\s+orientation\b|\bsexual\s+orientation\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\bidentify\b(?:\s+\w+){0,4}\s+sexual\s+orientation\b|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|i\s+consider\s+myself|do\s+you\s+consider\s+yourself)\b(?:\s+\w+){0,4}?\s+(?:lgbt\w*|queer|gay|lesbian|bisexual)\b|^(?:lgbt\w*\+?|queer)(?:\s+(?:status|identity|community|community\s+member))?$/;
const TRANSGENDER_WIDE = /\bassigned\s+at\s+birth\b|\bcisgender\b/;
const TRANSGENDER_SELF = /^transgender(?:\s+(?:status|identity|experience|history))?$|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|do\s+you\s+consider\s+yourself|i\s+consider\s+myself)\s+(?:to\s+be\s+)?(?:a\s+)?(?:trans|transgender|cisgender|cis)\b|\bassigned\s+at\s+birth\b|\bcisgender\b|\btransgender\s+(?:experience|history|status|identity)\b/;
/** Over-18 wordings §8.3's rule misses ("over the age of 18", "18 or older"). "Under 18" is not among them: its yes
 *  means the opposite. */
const OVER18_WIDE = /\b(?:over|above|older\s+than)\s+the\s+age\s+of\s+(?:18|eighteen)\b|\b(?:18|eighteen)\s+(?:years\s+)?(?:of\s+age\s+)?(?:old\s+)?(?:or|and)\s+(?:older|over|above)\b|\b(?:at\s+least|over|older\s+than)\s+eighteen\b|\beighteen\s+years\s+(?:of\s+age|or\s+older)\b/;
/** Criminal-history wordings §8.3's rule misses ("unspent convictions", "found guilty", "an offence"). */
const CRIMINAL_WIDE = /\bconvictions?\b|\boffen[cs]es?\b|\boffenders?\b|\bguilty\b|\barrested\b|\bunspent\b|\bmisdemeanou?rs?\b|\bnolo\s+contendere\b|\bcharged\s+with\s+(?:a\s+|an\s+|any\s+)?(?:crime|criminal|offen[cs]e|felony|misdemeanou?r)\b|\bcrimes?\b/;
/** Data retention as the Phase E review reads it (B1): the employer retaining, storing or keeping the application on
 *  file. Being considered for, contacted about or told of future roles, and a talent community or pool, are not. */
const RETENTION_ONLY = /\bretain(?:s|ed|ing)?\b|\bretention\b|\bkeep(?:s|ing)?\s+(?:\w+\s+){0,4}?on\s+file\b|\bon\s+file\b|\bstor(?:e|es|ed|ing)\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|details|application|cv|resume|profile)\b/;
/** Retention wordings §8.3's rule misses ("retaining my CV", "storing your details"). */
const RETENTION_WIDE = /\bretain(?:s|ed|ing)?\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|details|application|cv|resume|profile)\b|\bkeep(?:s|ing)?\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|details|application|cv|resume|profile)\s+on\s+file\b|\bstor(?:e|es|ed|ing)\s+(?:my|your)\s+(?:personal\s+)?(?:data|information|details|application|cv|resume|profile)\b/;
/** Future roles named after a contact verb: "about future job opportunities", "of other openings". */
const FUTURE_ROLES = String.raw`(?:future|other|new|upcoming|similar|relevant|additional|open|more)\s+(?:\w+\s+){0,2}?(?:jobs?|careers?|roles?|positions?|openings?|opportunit\w*|vacanc\w*|postings?)`;
const CONTACT_VERB = String.raw`(?:contact|contacted|contacting|email|emailed|emailing|e\s?mail|e\s?mailed|notify|notified|notifying|notifications?|reach\s+out|reached\s+out|call|called|text|texted|message|messaged|send|sent|sending|receive|receiving|hear|inform|informed|alert|alerted|updates?|updated)`;
/** Marketing as the Phase E review reads it (B1): being contacted, emailed, notified, sent updates or alerts about
 *  future roles, or joining a talent community or pool. Never pre-approved by default (docs/SPEC-AMENDMENTS.md §7). */
const MARKETING_WIDE = new RegExp(String.raw`\b${CONTACT_VERB}\b(?:\s+\w+){0,6}?\s+${FUTURE_ROLES}\b|\b(?:talent|candidate)\s+(?:pool|community|network|database)s?\b|\bkeep\s+me\s+(?:updated|informed|posted)\b|\bstay\s+in\s+touch\b|\bjob\s+(?:alerts?|notifications?|updates?)\b|\bcareer\s+(?:updates?|newsletters?|alerts?)\b`);

/** A check the person consents to, which is not a claim about their record ("a criminal background check"). */
const RECORD_CHECK = /\b(?:criminal\s+)?(?:background|record|records|history)\s+(?:checks?|screenings?|search|searches|investigations?|reports?|verifications?)\b|\bcriminal\s+(?:checks?|screenings?|search|searches|investigations?|reports?)\b/g;

/** AI, by its name or a named assistant (the audit of 2026-11-06, S-4: Claude, Gemini, Bard, Perplexity, machine
 *  learning, an AI or writing assistant, and the like). */
const AI_TERM = String.raw`(?:ai|a\s+i|artificial\s+intelligence|chat\s?gpt|gpt\w*|llms?|large\s+language\s+models?|language\s+models?|generative|genai|gen\s+ai|copilot|claude|gemini|bard|perplexity|openai|anthropic|deepseek|grammarly|quillbot|chat\s?bots?|machine\s+learning|(?:ai\s+|virtual\s+)?(?:writing|ai)\s+assistants?)`;
const NEGATION = String.raw`(?:did\s+not|didnt|have\s+not|havent|has\s+not|hasnt|had\s+not|hadnt|was\s+not|wasnt|were\s+not|werent|do\s+not|dont|does\s+not|doesnt|will\s+not|wont|not|never|no|without)`;
/** A statement that the application is the applicant's own work (the Phase 7a review: Workable's "Can you confirm that
 *  everything in this application is true and your own?"), which a fill that used AI cannot make: an AI attestation.
 *  The audit of 2026-11-06 (S-4) adds a claim of sole authorship ("I wrote every answer in this application myself",
 *  "I completed this application myself"), ticked, like the attestation, only when the run used no AI at all. */
const OWN_WORK = String.raw`\btrue\s+and\s+(?:\w+\s+)?(?:my|your|their)\s+own\b|\b(?:entirely\s+|completely\s+|all\s+)?(?:my|your)\s+own\s+(?:work|words|writing)\b|\b(?:i|myself)\b(?:\s+\w+){0,3}?\s+(?:wrote|written|write|authored|composed|drafted|prepared|completed|filled\s+(?:in|out))\b(?:\s+\w+){0,8}?\s+(?:myself|by\s+myself|on\s+my\s+own|personally|alone|without\s+(?:any\s+)?(?:help|assistance))\b|\b(?:written|authored|composed|prepared|completed)\s+(?:entirely\s+|solely\s+|only\s+|wholly\s+)?by\s+me\b|\bsole\s+author\b`;

/** What fills or writes an application other than the person: automation, autofill, a bot, a script, software, a tool,
 *  an extension or plug-in, an app, or someone's help (the audit of 2026-11-06, S-4). The extension itself is such
 *  automation, so a statement that none was used is never true of a run of it. */
const AUTOMATION_TERM = String.raw`(?:automat\w*|auto\s?fill\w*|autocomplete\w*|bots?|robots?|scripts?|software|tools?|(?:browser\s+)?extensions?|plug\s?ins?|add\s?ons?|third\s+part(?:y|ies)|assistance|help|helpers?|anyone\s+else|another\s+person|someone\s+else)`;
/** A negation the person makes of their own doing ("I did not", "I have never"), or an impersonal one ("no", "without",
 *  "not used"): never a company's ("this company does not use automated decision-making"). */
const PERSON_NEGATION = String.raw`(?:\bi\s+(?:\w+\s+){0,2}?(?:did\s+not|didnt|have\s+not|havent|had\s+not|hadnt|do\s+not|dont|will\s+not|wont|never|was\s+not|wasnt)\b|\b(?:no|without|neither|nor)\b|\bnot\s+(?:used|employed|relied|assisted|helped|aided|with|by)\b)`;
/** A denial that automation or help was used ("I confirm that no autofill software or browser extension was used",
 *  "I completed this application without automated tools or bots"): never ticked or answered yes, whatever the run
 *  used, since the extension is automation (S-4). */
const AUTOMATION_DENIAL = new RegExp(String.raw`${PERSON_NEGATION}(?:\s+\w+){0,3}?\s+(?:(?:the\s+)?(?:use|help|aid|assistance|support)\s+of\s+)?(?:any\s+|an\s+|a\s+)?(?:\w+\s+)??${AUTOMATION_TERM}\b|\b${AUTOMATION_TERM}\b(?:\s+\w+){0,4}?\s+(?:was|were|has\s+been|have\s+been|is|are)\s+(?:not|never)\s+(?:used|involved|employed)\b`);
/** A tool, software or help named by its AI ("AI tools", "machine learning software", "AI-powered assistance"): AI. */
const AI_QUALIFIED = new RegExp(String.raw`\b(${AI_TERM})\s+(?:based\s+|powered\s+|driven\s+|enabled\s+|writing\s+)?(?:tools?|software|assistance|help|helpers?|bots?|scripts?|extensions?|plug\s?ins?|add\s?ons?)\b`, 'g');
/** The person speaking of themselves: a denial in the first person, not a company's ("We do not use automated
 *  decisions"). */
const FIRST_PERSON = /\b(?:i|my|me|myself)\b/;
/** What a question about how the application was made asks about: THIS application, or the person's own materials in
 *  it ("this application", "your cover letter", "the form", "your answers", "these responses"). A plural or another
 *  application ("web applications", "a production application", "application deployment") is a skills question, never
 *  this one (the review of the audit's S-4). */
const THIS_APPLICATION = /\b(?:this|your|the)\s+(?:(?:job|own|online|whole|entire|written)\s+)?(?:application|form|answers?|responses?|submission|essays?|cover\s+letter|resume|cv)\b|\bthese\s+(?:answers|responses)\b/;
/** A question's start ("Did you", "Was this application", "Has anyone", "Were any of your answers"). */
const QUESTION_START = /^(?:(?:please|kindly)\s+)?(?:\w+\s+){0,2}?(?:did|have|has|had|were|was|is|are|do|does|will|would|can)\s+(?:you|anyone|anybody|anything|someone|something|any|this|your|the|it|ai)\b/;
/** Who or what made the application, as a question asks it: AI, automation, an autofill, a bot, a script, an extension,
 *  or the person alone ("yourself"). */
const MADE_BY_AGENT = String.raw`(?:${AI_TERM}|automat\w*|auto\s?fill\w*|autocomplete\w*|(?:ro)?bots?|scripts?|(?:browser\s+)?extensions?|plug\s?ins?|add\s?ons?|yourself|by\s+yourself|on\s+your\s+own|your\s+own\s+(?:work|words|writing))`;
/** What making the application is: using, helping, completing, filling, writing, preparing, answering, drafting,
 *  generating or submitting it. */
const MAKING_VERB = String.raw`(?:use[ds]?|using|help\w*|assist\w*|complet\w*|fill\w*|writ\w*|wrote|prepar\w*|answer\w*|draft\w*|generat\w*|submit\w*)`;
/** Who or what made the application, as a question asks it, beside the making (the review of the audit's S-4): an agent
 *  within a few words of a making verb, either way round ("use AI to complete", "written by ChatGPT", "complete this
 *  application yourself"), or someone's help to make it ("Did anyone help you", "help you fill"). "Built automation
 *  tools", "experience with test automation" or "worked with Claude" name no making of this application. */
const MADE_BY = new RegExp(String.raw`\b${MADE_BY_AGENT}\b(?:\s+\w+){0,4}?\s+${MAKING_VERB}\b|\b${MAKING_VERB}\b(?:\s+\w+){0,4}?\s+${MADE_BY_AGENT}\b|\b(?:anyone|anybody|anything|someone|something|any\s+(?:one|person|tool|tools))\b(?:\s+\w+){0,3}?\s+(?:help|helped|assist|assisted)\b|\b(?:help|helped|assist|assisted)\s+(?:\w+\s+){0,2}?(?:fill|complet|writ|wrote|prepar|answer|draft)\w*`);

/**
 * Whether normalized text asks or states how the application was made, which only the person can say (the audit of
 * 2026-11-06, S-4): a question whether AI, automation, an autofill, an extension or someone's help made it, or whether
 * the person made it alone ("Did you use Claude to complete this application?", "Was this application filled in by an
 * autofill tool?", "Did you complete this application yourself?"); or a first-person denial that automation or help
 * was used, on a box or a choice (`statement`: a statement to tick), elsewhere only about the application or the form.
 * Never answered, ticked or sent to an AI.
 */
export function asksHowApplicationMade(text: string, statement = false): boolean {
  if (QUESTION_START.test(text) && THIS_APPLICATION.test(text) && MADE_BY.test(text)) return true;
  // "AI tools", "machine learning software": AI, which the attestation's rule reads (ticked only in a run that used
  // none), not a denial of automation.
  const denial = text.replace(AI_QUALIFIED, '$1');
  return FIRST_PERSON.test(denial) && AUTOMATION_DENIAL.test(denial) && (statement || THIS_APPLICATION.test(denial));
}

/** What binds the person beyond applying (the audit of 2026-11-06, S-5): arbitration, a jury-trial or class-action
 *  waiver, a non-compete or non-solicitation covenant, a waiver or release of claims, giving up inventions. A waiver
 *  counts only beside what it gives up in law (a right, a claim, a jury, a trial, a class, a lawsuit or a court: the
 *  review of the audit's S-5), never "waive the 2-week notice" or "a waiting period waiver". */
const BINDING_WAIVER = /\barbitrat\w*|\bjury\b|\bclass\s+action\b|\bnon\s?compet\w*|\bnoncompet\w*|\bnon\s?solicit\w*|\bnonsolicit\w*|\brestrictive\s+covenants?\b|\bwaiv(?:e|ed|es|er|ers|ing)\b(?:\s+\w+){0,4}?\s+(?:rights?|claims?|jury|trial|class|lawsuits?|suits?|courts?|litigation|legal\s+actions?)\b|\b(?:rights?|claims?|jury|trial|class|lawsuits?|courts?|litigation)\b(?:\s+\w+){0,4}?\s+waiv(?:e|ed|es|er|ers|ing)\b|\brelease\s+(?:of\s+)?(?:all\s+|any\s+)?(?:claims|liability)\b|\b(?:assign|relinquish|transfer|surrender|forfeit)\w*\s+(?:\w+\s+){0,4}?(?:inventions?|intellectual\s+property|copyrights?|patents?)\b|\binventions?\s+assignment\b/;
/** Wording that asks the person to take on such a commitment ("Do you agree", "Are you willing to sign", "waive"). */
const BINDING_ASK = /\b(?:agree\w*|accept\w*|consent\w*|sign\w*|willing|bound|abide|waive\w*|submit\w*\s+to|enter\w*\s+into|comply|relinquish\w*|assign\w*|forfeit\w*|release)\b/;

/** The kinds a statement is ticked or chosen on, where a denial of automation is read alone. */
const STATEMENT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['checkbox', 'radio', 'select', 'combobox']);
const HOW_MADE_RULE = { id: 'label.how-application-made', strength: 'strong' } as const;
const BINDING_WAIVER_RULE = { id: 'label.binding-waiver', strength: 'strong' } as const;

/** Whether normalized text asks the person to take on a binding waiver or covenant (BINDING_WAIVER with BINDING_ASK):
 *  the person's, in any form but a required lone checkbox (which still follows the Consents mode), never an AI's. */
export function namesBindingWaiver(text: string): boolean {
  return BINDING_WAIVER.test(text) && BINDING_ASK.test(text);
}
/** An "I did not use AI" attestation as normalizeLabel writes it (no apostrophes: "didnt", "havent"), with a few words
 *  between the negation and the AI term, either way round; or a statement that it is the applicant's own (OWN_WORK). */
const AI_ATTESTATION = new RegExp(String.raw`\b${NEGATION}\b(?:\s+\w+){0,5}?\s+${AI_TERM}\b|\b${AI_TERM}\b(?:\s+\w+){0,4}?\s+(?:was|were|has\s+been|have\s+been|is|are)\s+(?:not|never)\s+(?:used|involved)\b|${OWN_WORK}`);
/** AI named anywhere in consent wording: that box is an AI attestation, which is never pre-approved (§8.7). */
const AI_NAMED = new RegExp(String.raw`\b${AI_TERM}\b`);
/** Unrecognised-consent wordings beyond §8.3's "I agree, consent, acknowledge, accept, understand". */
const CONSENT_WIDE = /\bi\s+(?:(?:hereby|also|further|expressly|fully)\s+)*(?:confirm|declare|have\s+read|give\s+(?:my\s+)?(?:permission|consent)|authori[sz]e|grant|allow)\b|\byou\s+(?:also\s+)?(?:agree|consent|acknowledge|accept|confirm|authori[sz]e)\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b|\bi\s+would\s+like\s+to\s+(?:receive|be\s+(?:contacted|considered|notified|added|kept))\b/;
/** A radio that asks for consent: a first-person consent verb, or "Do you consent", "Would you like to receive", or
 *  "Check Yes or No to indicate your agreement to receive text message updates" (Ashby's SMS consent). On a radio
 *  without one, a consent topic word ("experience in marketing") is not consent. */
const CONSENT_ASK = /\bindicate\s+your\s+(?:agreement|consent)\b|\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*(?:agree|consent|acknowledge|accept|understand|certify|attest|confirm|declare|authori[sz]e|give|grant|allow|have\s+read)\b|\b(?:do|would|will|can|may)\s+(?:you|we)\s+(?:\w+\s+){0,2}?(?:consent|agree|accept|acknowledge|authori[sz]e|allow|permit|opt|subscribe|receive|join|store|keep|retain|contact|share|use|send|text|email)\b|\b(?:would|do)\s+you\s+(?:like|want|wish)\s+to\b|\bopt\s+(?:in|out)\b|\bsign\s+up\b|\bsubscribe\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b/;
/** Where a consent clause starts: a consent verb, with its "I". */
const CONSENT_VERB = /(?:\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*)?\b(?:agree|consent|acknowledge|accept|understand|certify|attest|confirm|declare|authori[sz]e|give|grant|allow)\b/g;
/** Words that carry no object of their own, so a clause of only these after its verb ("I acknowledge that I have read
 *  and") belongs to the next one, or, at the end ("Privacy policy: I agree"), to the one before. */
const CLAUSE_FILLER = new Set(['that', 'i', 'have', 'has', 'had', 'read', 'and', 'or', 'understood', 'understand',
  'receipt', 'of', 'the', 'above', 'below', 'following', 'hereby', 'fully', 'carefully', 'also', 'both', 'all',
  'these', 'those', 'this', 'a', 'an', 'to', 'am', 'been', 'reviewed', 'review', 'received', 'it', 'them', 'any',
  'with', 'my', 'do', 'further', 'expressly']);
/** Words that name no object a person agrees to: the filler, the consent verbs, and the words around a tick. */
const NO_OBJECT: ReadonlySet<string> = new Set([...CLAUSE_FILLER, 'agree', 'agreed', 'consent', 'consented',
  'acknowledge', 'acknowledged', 'accept', 'accepted', 'certify', 'attest', 'confirm', 'declare', 'authorize',
  'authorise', 'give', 'grant', 'allow', 'yes', 'please', 'by', 'checking', 'ticking', 'clicking', 'selecting',
  'box', 'here', 'hereto', 'herein', 'same', 'its', 'their', 'your', 'our']);

/**
 * Commitments no pre-approval covers, named anywhere in consent wording (the review, CORE-1): a box that also binds
 * the person to arbitration, a jury or class-action waiver, a restrictive covenant, a drug test or a credit check is
 * unrecognised consent, wherever the commitment stands. Normalization reads commas as spaces, so a list joined by
 * commas alone ("the privacy policy, arbitration agreement") is caught here rather than by the coordinators below.
 */
const BINDING_COMMITMENT = /\barbitrat\w*|\bjury\b|\bclass\s+action\b|\bnon\s?compet\w*|\bnoncompet\w*|\bnon\s?solicit\w*|\bnonsolicit\w*|\bnon\s?disclosure\b|\bnda\b|\bconfidentiality\s+agreements?\b|\bdrug\s+(?:tests?|testing|screens?|screening)\b|\bcredit\s+(?:checks?|reports?|history)\b|\bat\s+will\b|\bwaive[ds]?\b|\bwaivers?\b|\brelease\s+(?:of\s+)?(?:all\s+|any\s+)?(?:claims|liability)\b|\bindemnif\w*|\bassign\w*\s+(?:of\s+)?(?:all\s+|my\s+)?(?:inventions|intellectual\s+property)\b/;

/**
 * Consent wording that declines or opts out rather than agrees (the review, CORE-2): "I do not consent", "I do not
 * wish to receive", "Opt out of SMS", "Do not contact me", "Check this box if you do not want ...", "Would you like to
 * opt out ...?". Such a box names a consent kind but is not that consent, so it is unrecognised consent, which only
 * the person ticks. A sentence that only says opting out is possible later ("Reply STOP to opt out", "you may
 * unsubscribe at any time") is no opt-out. normalizeLabel deletes apostrophes ("dont").
 */
const OPT_OUT = new RegExp([
  String.raw`\b(?:i|you)\s+(?:(?:hereby|also|further|really|would|d)\s+)*(?:do\s+not|dont|does\s+not|doesnt|will\s+not|wont|would\s+not|wouldnt|cannot|can\s+not|cant|am\s+not|never|not)\s+(?:\w+\s+){0,2}?(?:consent|agree|accept|acknowledge|authori[sz]e|allow|permit|give|grant|wish|want|like|opt|subscribe|sign|join|certify|confirm)\b`,
  String.raw`\b(?:i|you)\s+(?:(?:hereby|also|would|d)\s+)*(?:decline|refuse|withdraw|object|revoke|opt\s+out|unsubscribe|prefer\s+not|rather\s+not)\b`,
  String.raw`(?:^|\b(?:please|kindly)\s+)(?:opt\s+(?:me\s+)?out|unsubscribe|remove\s+me|do\s+not|dont|never)\b`,
  String.raw`\bopt\s+me\s+out\b|\bunsubscribe\s+me\b|\bremove\s+me\s+from\b`,
  String.raw`\b(?:do\s+not|dont|never)\s+(?:contact|send|email|e\s?mail|text|call|message|share|sell|keep|retain|store|add|subscribe|enroll|enrol|sign)(?:\s+(?:or|and)\s+\w+)?\s+(?:me|my)\b`,
  String.raw`\b(?:check|tick|select|mark|click)\s+(?:this\s+|the\s+|here\s+)?(?:box\s+)?(?:if\s+you\s+(?:\w+\s+){0,3}?|to\s+)(?:opt\s+out|unsubscribe|decline|withdraw|not|do\s+not|dont|never|are\s+not)\b`,
  String.raw`^(?:no|opt\s+out)\b`,
  String.raw`\b(?:do|would|will|can|may)\s+you\s+(?:\w+\s+){0,3}?(?:opt\s+out|unsubscribe|decline|withdraw)\b`,
  String.raw`\b(?:do|would|will)\s+you\s+not\b`,
  String.raw`(?<!\b(?:may|can|could|to|will\s+be\s+able\s+to)\s)\bopt\s+out\s+of\b`,
].join('|'));

/** A span a specific consent kind matched stands as this one character, so the words joined inside it ("terms and
 *  conditions", "true and complete") join no objects. No normalized label holds it. */
const KIND_MARK = '\u{E000}';
/** Coordinators that always join a further object to a consent verb. */
const ALWAYS_JOINS: ReadonlyArray<readonly string[]> = [['as', 'well', 'as'], ['along', 'with'], ['together', 'with'],
  ['in', 'addition', 'to'], ['which', 'includes'], ['which', 'include'], ['which', 'contains'], ['including'],
  ['plus']];
/** Coordinators that join a further object when a kind's span stands right before them or one starts right after
 *  them ("the privacy policy and binding arbitration", "and to binding arbitration", "and the arbitration
 *  agreement"); otherwise they join words inside one object ("the collection and processing of my data"). */
const JOINS_IF = new Set(['and', 'or', 'nor']);
/** The words that start a further object after "and" or "or". */
const OBJECT_START = new Set(['to', 'the', 'a', 'an', 'any', 'all', 'my', 'your', 'our', 'its', 'their', 'that',
  'this', 'these', 'those', 'being', 'having', 'also']);

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
  // The Phase 7a review: "legally eligible to be employed" is authorization too (a work authorization status is read
  // before this rule: matchLabelRules).
  'label.work-auth': { also: WORK_AUTH_WIDE, only: WORK_AUTH_LEGAL },
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
  // "Have you worked here before?" (docs/SPEC-AMENDMENTS.md §8), which §8.3's rule misses. The rule's value is taken
  // only for a question that names the posting's company or points at it (values.ts, the Phase E review, M3).
  'label.previously-employed': { also: /\bworked\s+(?:here|for\s+us|with\s+us)\b|\bemployed\s+(?:here|by\s+us)\b|\bworked\s+(?:at|for)\s+(?:\w+\s+){1,4}?before\b|\bex\s+employees?\b|\bformer\s+employees?\b/ },
  'label.travel': { unless: /\btravel\s+(?:restrictions?|limitations?|constraints?|bans?|reimbursements?|expenses?|polic(?:y|ies)|documents?|history)\b|\brestrictions?\s+on\s+(?:your\s+)?travel\b/ },
  // "Which languages do you speak?" (Phase 2): §8.3's rule takes "languages you speak" with nothing between. Only
  // "speak": "What programming languages do you know?" asks about skills.
  'label.language': { also: /\blanguages?\s+(?:do|can)\s+you\s+speak\b/, unless: /\b(?:proficiency|fluency|level)\b/ },
  'label.proficiency': { only: LANGUAGE_PROFICIENCY },
  'label.resume': { category: (c) => (c.kind === 'file' ? 'file.resume'
    : c.kind === 'checkbox' || c.kind === 'radio' ? 'consent.other' : 'unknown') },
  'label.why-company': { also: /why\s+do\s+you\s+want\s+to\s+(?:work|join)|why\s+(?:are\s+you\s+)?interested\s+in\s+(?:joining|working\s+(?:at|for|with))|what\s+(?:excites|interests|attracts|draws)\s+you\s+(?:to|about)\s+(?:joining|working\s+(?:at|for|with)|our\s+company|the\s+company|us)\b|^why\s+us$/ },
  'label.why-role': { also: /why\s+(?:are\s+you\s+)?interested\s+in\s+(?:this|the|our)\s+(?:role|position|job|opportunity)|why\s+do\s+you\s+want\s+(?:this|the)\s+(?:role|position|job)|why\s+(?:are\s+you\s+)?applying\s+(?:for|to)\s+(?:this|the)\s+(?:role|position|job)|what\s+(?:excites|interests|attracts|draws|appeals\s+to)\s+you\s+(?:about|in|to)\s+(?:this|the)\s+(?:role|position|job|opportunity)/ },
  'label.consent-ai': { also: AI_ATTESTATION },
  'label.consent-retention': { also: RETENTION_WIDE, only: RETENTION_ONLY },
  'label.consent-marketing': { also: MARKETING_WIDE },
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

/** Every specific consent kind's patterns (its rule's and its refinement's `also`), global and widened to whole
 *  words, for marking the spans they match. */
const KIND_SPANS: readonly RegExp[] = SPECIFIC_CONSENT_RULES.flatMap((rule) => [rule.re, REFINEMENTS[rule.id]?.also]
  .filter((re): re is RegExp => re !== undefined)
  .map((re) => new RegExp(String.raw`\S*(?:${re.source})\S*`, 'g')));

/** The objects a consent clause joins (the review, CORE-1): its words with every specific kind's span marked, cut at
 *  the coordinators that join a further object. */
function clauseObjects(clause: string): string[][] {
  const marked = KIND_SPANS.reduce((text, re) => text.replace(re, KIND_MARK), clause);
  const words = marked.split(' ').filter((word) => word !== '');
  const objects: string[][] = [[]];
  for (let at = 0; at < words.length;) {
    const always = ALWAYS_JOINS.find((joiner) => joiner.every((word, offset) => words[at + offset] === word));
    const next = words[at + 1];
    const joinsIf = JOINS_IF.has(words[at]!) && (words[at - 1] === KIND_MARK
      || (next !== undefined && (next === KIND_MARK || OBJECT_START.has(next))));
    if (always !== undefined || joinsIf) {
      objects.push([]);
      at += always?.length ?? 1;
      continue;
    }
    objects[objects.length - 1]!.push(words[at]!);
    at += 1;
  }
  return objects;
}

/** Whether a consent clause holds an object no specific kind names: one with a word of its own and no kind's span. */
const namesUnrecognisedObject = (clause: string) => clauseObjects(clause).some((object) => !object.includes(KIND_MARK)
  && object.some((word) => !NO_OBJECT.has(word)));

interface ConsentEntry {
  rule: LabelRule;
  category: FieldCategory;
}

/**
 * Every consent kind `text` reads as, strictest first (§8.7), equals in rule order, each with its rule: the specific
 * kinds over the whole text; unrecognised consent for consent wording that names nothing, and whenever the text binds
 * the person to more than its kinds name (the review, CORE-1 and CORE-2): a clause, or an object a coordinator joins
 * ("and to binding arbitration", "and phone calls"), that no specific kind names; a binding commitment named anywhere;
 * an opt-out or a refusal. A text with no consent verb is read as one clause when it names a kind. An AI attestation is
 * added when consent wording names AI; its own negation ("I did not use AI") is no opt-out.
 */
function consentEntries(text: string): ConsentEntry[] {
  const entries: ConsentEntry[] = [];
  const add = (rule: LabelRule, category: FieldCategory) => {
    if (!entries.some((entry) => entry.category === category)) entries.push({ rule, category });
  };
  for (const rule of SPECIFIC_CONSENT_RULES) {
    if (refinedMatch(rule, text) === 'match') add(rule, rule.category as FieldCategory);
  }
  // Wording that names AI is an AI attestation (below), the strictest kind, which nothing ticks: its own negation is
  // no opt-out, and nothing it joins can make it stricter.
  const namesAi = AI_NAMED.test(text);
  const clauses = consentClauses(text).map((clause) => (clause.startsWith('i ') ? clause : `i ${clause}`));
  const read = namesAi ? [] : clauses.length > 0 ? clauses : entries.length > 0 ? [text] : [];
  if (read.some(namesUnrecognisedObject)
    || (entries.length > 0 && !namesAi && (BINDING_COMMITMENT.test(text) || OPT_OUT.test(text)))
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

/** Words that deny a lone checkbox's statement or say it does not hold ("I am not authorized", "unable to relocate",
 *  "with no restrictions"). normalizeLabel deletes apostrophes ("dont"). */
const DENIES = /\b(?:not|no|never|neither|nor|none|cannot|cant|dont|doesnt|didnt|wont|wouldnt|isnt|arent|wasnt|werent|havent|hasnt|hadnt|shouldnt|couldnt|unable|unwilling|ineligible|unauthori[sz]ed|refuse[sd]?|decline[sd]?|without|opt\s+out)\b/;
/** Words that make a statement hold only sometimes ("unless the role is remote", "except", "whether"). */
const ONLY_SOMETIMES = /\b(?:unless|except|excepting|other\s+than|instead\s+of|rather\s+than|whether|if\s+not|or\s+not|depending|depends|provided\s+that|only\s+if)\b/;

/** How a lone checkbox's statement reads: affirmative, negated, or unclear. */
export const STATEMENT_POLARITIES = ['affirmative', 'negated', 'unclear'] as const;
export type StatementPolarity = (typeof STATEMENT_POLARITIES)[number];

/**
 * How the statement of a lone checkbox reads (the review, CORE-2), from its normalized text: 'negated' when a word
 * denies it or says it does not hold ("I am not legally authorized", "I am unable to relocate"), 'unclear' when it
 * holds only sometimes ("unless", "except", "whether"), else 'affirmative'. A box is ticked from a yes or no answer
 * only when its statement is affirmative, so ticking it says exactly the person's answer; any other goes to the
 * person. Consent reads its own wording (consentEntries: an opt-out is unrecognised consent).
 */
export function statementPolarity(text: string): StatementPolarity {
  if (DENIES.test(text)) return 'negated';
  return ONLY_SOMETIMES.test(text) ? 'unclear' : 'affirmative';
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
  // An experience block's own "Summary" or "Description" is the role's description (the Phase 7a review).
  if (section === 'experience' && context.block !== undefined && EXPERIENCE_DESCRIPTION.test(text)
    && kindAllowed('experience.description', kind)) {
    return hitOf(EXPERIENCE_DESCRIPTION_RULE, 'experience.description');
  }
  for (const rule of PRE_RULES) {
    const reads = rule.readsQualifiers && ctx.qualifiers !== '' ? [text, `${text} ${ctx.qualifiers}`] : [text];
    if (reads.some((read) => rule.re.test(read) && !(rule.unless?.test(read) ?? false))) {
      return { ...hitOf(rule, rule.category), needsUser: rule.needsUser };
    }
  }
  // The audit of 2026-11-06: how the application was made (S-4), on any field, and a binding waiver on anything but a
  // lone checkbox (S-5), are the person's, before any consent reading. A required lone box still follows the Consents
  // mode (consent.required), since the person cannot apply without it.
  if (asksHowApplicationMade(text, STATEMENT_KINDS.has(kind))) {
    return { ...hitOf(HOW_MADE_RULE, 'consent.aiAttestation'), consentKinds: ['consent.aiAttestation'],
      needsUser: 'how-made' };
  }
  if (kind !== 'checkbox' && namesBindingWaiver(text)) {
    return { ...hitOf(BINDING_WAIVER_RULE, 'consent.other'), consentKinds: ['consent.other'],
      needsUser: 'binding-waiver' };
  }
  // Consent first only for wording that consents: a box that names a consent topic and nothing more ("Willing to
  // travel for marketing events") keeps §8.3's order, where the consent rules come last.
  const asksConsent = CONSENT_ASK.test(text);
  if ((kind === 'checkbox' || kind === 'radio') && (asksConsent || AI_ATTESTATION.test(text))) {
    if (criminalClaim(text)) return hitOf(CRIMINAL_RULE, 'screening.criminalHistory');
    const entries = consentEntries(text);
    if (entries.length > 0) return consentVerdict(entries, kind);
  }
  // Which work authorization status (the Phase 7a review), before the design's authorization rule reads it as yes or
  // no.
  if (WORK_AUTH_STATUS.test(text) && kindAllowed('workAuth.status', kind)) {
    return hitOf(WORK_AUTH_STATUS_RULE, 'workAuth.status');
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

/**
 * Whether normalized text is a real "I did not use AI" attestation (the Phase E review, M5): label.consent-ai's own
 * wording or its negation pattern (AI_ATTESTATION). Consent wording that only names AI ("AI tools may be used to review
 * my application") is an AI attestation to the consent policy, never ticked, but no such statement: it does not switch
 * a run to the profile only.
 */
export function attestsNoAiUse(text: string): boolean {
  return AI_CONSENT_RULE.re.test(text) || AI_ATTESTATION.test(text);
}

/** The rule a consent asked as a choice is read by (consentChoiceHit). */
const CONSENT_CHOICE_RULE = { id: 'label.consent-choice', strength: 'strong' } as const;

/**
 * The hit for a consent asked as a choice (classifyRules consentChoice; the owner's decision of 2026-11-01): every
 * consent kind `text` (the normalized label, with the one option's words once they are read) reads as, strictest first
 * (consentEntries: unrecognised consent for an object no kind names, an AI attestation whenever it names AI), with the
 * kinds the field's description adds, which only make it stricter (withDescriptionConsent). A signature is typed, never
 * chosen, so a choice that names one is unrecognised consent. Null when the text is no consent wording.
 */
export function consentChoiceHit(text: string, description = ''): LabelRuleHit | null {
  const entries = consentEntries(text);
  if (entries.length === 0) return null;
  const extra = description === '' ? [] : consentEntries(description)
    .filter((entry) => !entries.some((own) => own.category === entry.category));
  const chosen = [...entries, ...extra].filter((entry) => entry.category !== 'consent.signature')
    .sort((a, b) => consentRank(a.category) - consentRank(b.category));
  const kinds = chosen.length > 0 ? chosen.map((entry) => entry.category) : ['consent.other' as const];
  return { ...hitOf(CONSENT_CHOICE_RULE, kinds[0]!), consentKinds: kinds };
}

/** An option that plainly agrees (normalizeLabel: no apostrophes, parentheticals left out): it starts with yes, an OK,
 *  "I do", "I will", a consent verb ("Acknowledge/Confirm", "I agree", "I accept", "Understood") or "I have read". */
const AFFIRMATIVE_OPTION = /^(?:yes|y|ok|okay|i\s+(?:do|will)|(?:i\s+)?(?:(?:hereby|fully|also)\s+)?(?:acknowledge[ds]?|confirm(?:ed|s)?|agree[ds]?|accept(?:ed|s)?|consent(?:ed|s)?|certif(?:y|ies|ied)|attest(?:ed|s)?|understand|understood)|(?:i\s+)?(?:have|ive)\s+(?:fully\s+|carefully\s+)?read|read\s+and\s+(?:understood|agreed|accepted|acknowledged))\b/;

/** Whether a normalized option is plainly affirmative: an AFFIRMATIVE_OPTION start, and nothing that denies it or makes
 *  it hold only sometimes (statementPolarity: "I do not agree", "I agree unless", "Decline"). */
export function affirmativeOption(text: string): boolean {
  return AFFIRMATIVE_OPTION.test(text) && statementPolarity(text) === 'affirmative';
}

/** Marketing and contact wordings a question can carry with no consent verb ("Receive our newsletter?", "Can we text
 *  you?"). */
const CONTACT_TOPIC = /\bnewsletters?\b|\bjob\s+alerts?\b|\bmarketing\s+(?:e\s?mails?|communications?|messages?|materials?|updates?|offers?|lists?)\b|\btext\s+messages?\b|\bsms\b|\b(?:un)?subscribe\b|\bopt\s+(?:in|out)\b|\b(?:text|sms|call|e\s?mail|contact|message)\s+(?:you|me)\b/;

/**
 * Whether normalized text asks for a consent the person gives (B1's marketing and retention wordings, newsletters,
 * texts, being contacted), with or without a consent verb: on a radio or a list such a question is no consent kind to
 * the rules, but an AI answer must never give it (plan/answers.ts namesUnanswerableTopic).
 */
export function namesConsentTopic(text: string): boolean {
  return MARKETING_WIDE.test(text) || RETENTION_WIDE.test(text) || CONTACT_TOPIC.test(text);
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
