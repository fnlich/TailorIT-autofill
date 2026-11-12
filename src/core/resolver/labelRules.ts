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
  /** jr6 RULES (ICIMS-09, O7): the entry the field belongs to, when it sits in a job's or a school's own block
   *  (entryOf): its place parts are that entry's, never the home address. */
  entry?: EntryKind;
}

/** jr6 RULES: the kinds of profile entry a section may hold. */
export type EntryKind = 'experience' | 'education';

/**
 * jr6 RULES (ICIMS-09, O7): the entry a field's section is, or null: a section about work or school (sectionKindOf)
 * that is a repeatable block (it has a block index) or that the adapter names by the entry's own word ("experience",
 * "education": iCIMS's employer and school blocks, Oracle's education editor). A heading that only mentions employment
 * ("Employment Application") is no entry, so the person's own address there stays theirs.
 */
export function entryOf(section: { id: string; block?: number }): EntryKind | null {
  const kind = sectionKindOf(section.id);
  if (kind === 'other') return null;
  return section.block !== undefined || section.id === kind ? kind : null;
}

/** What matchLabelRules reads besides the text, when the caller has it (classifyByRules always passes all three). */
export interface LabelContext {
  qualifiers?: string;
  rawLabel?: string;
  block?: number;
  /** s2 core-gh (decision 13): the label's question sentences alone (questionSentences), normalized, when it also
   *  states something after its last question ("…? You must be work authorized … without the need for employer
   *  sponsorship."): a pre-rule that joins two answers reads only what is asked. Absent otherwise. */
  questions?: string;
  /** jr6 RULES: the entry the field's section is (entryOf), when it is one. */
  entry?: EntryKind;
  /** jr7 RULES-7 (ICIMS7-06): the field is a list read whole whose options are exactly a Yes and a No: a skills list it
   *  never is. */
  yesNoOptions?: true;
  /** jr7 RULES-7 R2 (DF7-11): the field is required. */
  required?: true;
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
  /** jr7 RULES-7 (UKGR-14): a national id or a social security number, or its type: only the person types one, never a
   *  profile value, a saved or earlier answer, nor an AI. */
  'identifier',
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
// jr7 RULES-7 (ADP7-9, ADP's "How many years of related experience do you have?", snapshot7 adp1): related too.
const TOTAL_YEARS = /^(?:total\s+)?(?:number\s+of\s+)?years\s+of\s+(?:total\s+|professional\s+|relevant\s+|related\s+|work\s+|working\s+|industry\s+)?experience$|how\s+many\s+(?:total\s+)?years\s+of\s+(?:total\s+|professional\s+|relevant\s+|related\s+|work\s+|working\s+|industry\s+)?experience\s+do\s+you\s+have$/;
/** Availability to start. Availability for an interview, a shift or a weekend is another question. */
const START_AVAILABILITY = /when\s+can\s+you\s+start|earliest\s+start|available\s+to\s+start|availability\s+(?:to|for)\s+(?:start|starting|begin|employment)\b|\bstart(?:ing)?\s+availability\b|^availability(?:\s+date)?$/;
/** jr7 RULES-7 R2 (RBP7-15, BambooHR's "Date Available", snapshot7 bamboohr1 and bamboohr2): the date the person is
 *  available to start, laid out by its placeholder. */
const DATE_AVAILABLE = /^(?:the\s+)?date\s+(?:you\s+are\s+)?available(?:\s+to\s+(?:start|begin))?$/;
/** Pay as a topic rather than the person's pay: "compensation planning", "experience with payroll". */
const PAY_TOPIC = /\b(?:compensation|salary|salaries|pay|payroll)\s+(?:planning|plans?|strateg(?:y|ies)|benchmark\w*|analysis|analyst|analytics|structures?|philosophy|programs?|committee|management|administration|surveys?|data|consulting|practices|polic(?:y|ies)|reviews?|cycles?|design|tools?|software|systems?|teams?|functions?|benefits|equity|transparency|laws?|regulations?)\b|\b(?:compensation|salary|pay)\s+and\s+benefits\b|\b(?:experience|familiar|familiarity|knowledge|expertise)\s+(?:with|in|of)\s+(?:\w+\s+){0,2}(?:compensation|salary|salaries|payroll)\b/;
/** Current, previous or historical pay, the time word qualifying the pay itself. */
const PAST_PAY = /\b(?:current|currently|previous|prior|last|present|most\s+recent|existing|former)\s+(?:\w+\s+){0,2}?(?:salary|salaries|compensation|pay|wages?|remuneration|ctc|earnings|income|base)\b|\b(?:salary|pay|compensation)\s+history\b|\bhow\s+much\s+(?:do|did)\s+you\s+(?:currently\s+)?(?:make|earn)\b/;
/** Expected-pay wordings §8.3's rule misses. An hourly or day rate is not among them: the value is a yearly figure. */
const PAY_EXPECTATION = /\bpay\s+range\b|\bbase\s+pay\b|\b(?:desired|expected|target|requested)\s+(?:(?:annual|yearly|base|total)\s+)*(?:pay|compensation|salary)\b|\btotal\s+compensation\b/;
/** jr7 RULES-7 (ADP7-8, ADP's "What is the minimum hourly rate you would consider for this position?", snapshot7 adp1):
 *  the lowest, desired or expected hourly or daily rate asked for: the expected pay in its own period (values.ts never
 *  converts it). */
const PAY_RATE_EXPECTATION = /\b(?:minimum|lowest|desired|expected|target|requested)\s+(?:hourly|daily)\s+(?:pay\s+)?rate\b/;
/** Language names, for a proficiency question about a language rather than a tool ("Excel proficiency"). */
const LANGUAGE_PROFICIENCY = /\b(?:languages?|english|spanish|french|german|italian|portuguese|dutch|polish|russian|ukrainian|turkish|arabic|hebrew|persian|farsi|hindi|urdu|bengali|punjabi|tamil|telugu|marathi|gujarati|mandarin|cantonese|chinese|japanese|korean|vietnamese|thai|indonesian|malay|tagalog|filipino|swahili|greek|swedish|norwegian|danish|finnish|czech|slovak|hungarian|romanian|bulgarian|serbian|croatian|catalan|irish|welsh|afrikaans|amharic|nepali|sign\s+language)\b|^(?:proficiency|fluency)(?:\s+level)?$|^level\s+of\s+(?:proficiency|fluency)$/;
/** More wordings of work authorization: "entitled to work", "(legally) eligible to be employed". */
// jr7 RULES-7 (WD7-09, Workday's aristocrat "Do you currently have the right/entitlement to work in the country where the
// job is located?", snapshot7 workday1; UKGR-16, UKG Ready's required box "Eligible For Work in the USA", snapshot7
// secure7.saashr): a right or an entitlement to work, and eligible for work in a place. In the refinement, never in
// §8.3's own pattern (the design-verbatim test).
const WORK_AUTH_WIDE = /\bentitled\s+to\s+work\b|\b(?:eligible|authori[sz]ed|permitted|entitled)\s+to\s+be\s+(?:employed|hired)\b|\beligible\s+for\s+employment\b|\bright\s+(?:(?:or|and)\s+)?entitlement\s+to\s+work\b|\bentitlement\s+to\s+work\b|\beligible\s+for\s+work\s+in\b/;
/** A question about which work authorization status the applicant holds (Workable's "Work Authorization Status",
 *  "Which best describes your work authorization status?"): which status, never yes or no. */
const WORK_AUTH_STATUS = /\bauthori[sz]ation\s+status\b|\bwork\s+(?:authori[sz]ation\s+)?status\b/;
/** jr6 RULES (JV-7, Jobvite's NinjaOne "What is your US Work Authorization type?", fixtures/jobvite/ninjaone-step3): the
 *  type of an authorization or a visa, and a country's or an immigration employment status, asked as which one; never
 *  beside a sponsorship ("sponsorship for any visa type"), nor a person's employment ("current employment status"). */
const WORK_AUTH_TYPE = /\bauthori[sz]ation\s+type\b|\btype\s+of\s+(?:work\s+|employment\s+)?authori[sz]ation\b|\bvisa\s+type\b|\btype\s+of\s+visa\b|\b(?:us|u\s+s|united\s+states|immigration|citizenship|legal)\s+(?:\w+\s+)?employment\s+status\b/;
/** An experience block's own summary of the role, labelled with that one word (the Phase 7a review: Workable's
 *  Experience "Summary"). s2 core-wd: or the role's, the job's or the position's ("Role Description", Workday's
 *  formField-roleDescription in fixtures/workday/s2-exelixis-my-experience; the wd study §4). Any longer wording is left
 *  to the LLM's classification, as before. */
// jr7 RULES-7 (ICIMS7-08, arc-onesolutions' required "Duties" in every employment block, snapshot7 iCIMS1; DF7-11,
// Dayforce's "Duties and Responsibilities", snapshot7 dayforce1; jr7-O4, Oracle's tile editor "Responsibilities",
// snapshot7 oraclecloud1): the role's duties or responsibilities.
const EXPERIENCE_DESCRIPTION = /^(?:(?:role|job|position)\s+)?(?:summary|description)$|^(?:(?:job|role|position|main|key|primary)\s+)?(?:duties|responsibilities)(?:\s+(?:and|or)\s+(?:duties|responsibilities))?$/;
const EXPERIENCE_DESCRIPTION_RULE = { id: 'label.experience-description', strength: 'normal' } as const;
const WORK_AUTH_STATUS_RULE = { id: 'label.work-auth-status', strength: 'strong' } as const;

/** A legal reading of "eligible", "permitted" or "entitled to work": a place, "legally", "lawfully" or any employer.
 *  Without one it is a question about the job ("eligible to work overtime"). */
const WORK_AUTH_LEGAL = /authori[sz]ed\s+to\s+work|right\s+to\s+work|entitlement\s+to\s+work|eligible\s+for\s+work\s+(?:in|within)\s+(?!(?:a|an|our|shifts?|teams?|person|office|offices|hybrid|remote|remotely|this\s+(?:role|position|job|team|office)|the\s+(?:office|field|evenings?|mornings?|afternoons?|weekends?|days?|nights?|shifts?|role|position|job|team|warehouse|store|lab|clinic))\b)\w+|work\s+authori[sz]ation|\b(?:legally|lawfully)\b|(?:eligible|permitted|entitled)\s+to\s+work\s+(?:\w+\s+){0,4}?(?:in|within)\s+(?!(?:a|an|our|shifts?|teams?|person|office|offices|hybrid|remote|remotely|this\s+(?:role|position|job|team|office)|the\s+(?:office|field|evenings?|mornings?|afternoons?|weekends?|days?|nights?|shifts?|role|position|job|team|warehouse|store|lab|clinic))\b)\w+|(?:eligible|permitted|entitled)\s+to\s+work\s+for\s+(?:any|an|all)\s+employers?/;
/** Sponsorship in the immigration sense: a visa or work authorization named, or sponsorship required or needed.
 *  Without one it is sponsorship in the business sense ("sponsorship sales"). */
const VISA_SPONSORSHIP = /\bvisas?\b|\bimmigra\w*|\bh\s?1\s?b\b|\bgreen\s+card\b|\bpermanent\s+residen\w*|\bcitizen\w*|\bwork\s+(?:authori[sz]\w*|permits?|status|eligibility)\b|\bemployment\s+(?:authori[sz]\w*|visas?|status|eligibility|based)\b|\bto\s+work\b|\bfor\s+employment\b|\b(?:require|requires|required|requiring|need|needs|needed|needing)\b(?:\s+\w+){0,3}?\s+sponsor\w*|\bsponsor\w*\s+(?:\w+\s+){0,2}?(?:required|needed|status)\b|^(?:visa\s+)?sponsorship\b|\bsponsorship\s+(?:now|in\s+the\s+future|to\s+work)\b/;
/** The core pass of 2026-11-06: a need for sponsored authorization, sponsorship asked about the work authorization
 *  itself (ClassPass on Greenhouse, the owner's snapshot "[job-boards.greenhouse.io] ... Sr Software Engineer - Backend
 *  at ClassPass": "Do you now, or will you in the future, require employer-sponsored work authorization to legally work
 *  in the country where this role is located?"). §8.3's authorization rule, read first, took it for authorization. */
// jr6 RULES (WD-13, fixtures jr6-travelers-application-questions: "Will you now or in the future require support from an
// employer to obtain/extend a work visa/permit in order to be employed (for example, H-1B, …)?"): a need for an
// employer's support or assistance to obtain, extend or maintain a visa, a work permit or a work authorization is
// sponsorship too; VISA_SPONSORSHIP still refines it, and label.work-auth's `unless` keeps the authorization rule off it.
const SPONSORED_NEED = /\b(?:require|requires|required|requiring|need|needs|needed|needing)\b(?:\s+\w+){0,3}?\s+sponsored\s+(?:work|employment|visas?|immigration)\b|\b(?:require|requires|required|requiring|need|needs|needed|needing)\b(?:\s+\w+){0,3}?\s+(?:support|assistance)\s+from\s+(?:an|the|your)\s+(?:\w+\s+){0,2}?employer\s+to\s+(?:obtain|extend|maintain)\b(?:\s+\w+){0,6}?\s+(?:visas?|work\s+permits?|work\s+authori[sz]ation)\b/;
// s2 core-gh (decision 13, the gh study's 3b: fixtures/greenhouse/s2-onestream-related-open question_8152423009, "Will
// you now or in the future require OneStream to sponsor your employment visa status/work authorization in the
// country/province you are applying for?"): a need for the employer to sponsor, a few words on, is sponsorship, whatever
// "work authorization" the sentence names after it. §8.3's authorization rule, read first, took it for authorization
// and answered a person who needs no sponsorship "Yes".
// jr7 RULES-7 (WD7-01, Workday's aristocrat "Will you now, or in the future, require any immigration filing or visa
// sponsorship by Aristocrat to maintain work authorization (…)?", snapshot7 workday1): five words between the need and
// the sponsorship, the narrowest width that reads it (the verifier's trial of {0,4} to {0,8}).
const NEED_TO_SPONSOR = /\b(?:require|requires|required|requiring|need|needs|needed|needing)\b(?:\s+\w+){0,5}?\s+sponsor\w*/;
// s2 core-gh end

// Self-identification wordings: a topic word without one ("experience supporting individuals with disabilities") is a
// question about the job, which the person answers; it never takes their self-identification answer.
const HISPANIC_WORD = String.raw`(?:hispanic|latin[oax]|latine|spanish)`;
const HISPANIC_SELF = new RegExp(String.raw`^(?:(?:are|r)\s+you\s+|ethnicity\s+|i\s+am\s+|you\s+are\s+)?(?:of\s+)?(?:not\s+)?${HISPANIC_WORD}(?:\s+(?:or\s+|and\s+)?${HISPANIC_WORD})*(?:\s+(?:origin|descent|heritage|ethnicity|status|background|self\s+identification))*$|\b(?:are\s+you|i\s+am|you\s+are)\s+(?:not\s+)?(?:of\s+)?(?:hispanic|latin)|\bidentify\s+(?:yourself\s+)?as\s+(?:a\s+)?(?:hispanic|latin)|\bconsider\s+yourself\s+(?:to\s+be\s+)?(?:a\s+)?(?:hispanic|latin)`);
// jr6 RULES (WD-08, Workday's Voluntary Disclosures: fixtures jr6-gnw-, jr6-resolvetech-, jr6-travelers-,
// jr6-cisive- and jr6-verawholehealth-voluntary-disclosures, danafarber-voluntary-disclosures): "If you identify with
// one or more ethnic groups please choose from the list below" names ethnic groups, not "ethnicity".
const RACE_WIDE = /\b(?:your|my)\s+(?:race|races|racial|ethnicity|ethnicities|ethnic)\b|\b(?:race|races|ethnicity|ethnicities)\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\b(?:which|what)\s+(?:race|races)\b|\bethnic\s+groups?\b/;
// jr6 RULES (WD-08): a race or an ethnicity within eight words of identify or identification ("Please select the
// ethnicity which most accurately describes how you identify yourself."), of "describe(s) you/yourself" or "applies to
// you" ("Please select the race/ethnicity that best applies to you:"), and "race/ethnicity" itself (normalized "race
// ethnicity").
const RACE_SELF = /^(?:race|races|ethnicity|ethnicities|racial|ethnic)\b|\b(?:your|my)\s+(?:race|races|racial|ethnicity|ethnicities|ethnic)\b|\b(?:race|races|ethnicity|ethnicities)\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\b(?:which|what)\s+(?:race|races|ethnicity|ethnicities)\b|\bidentify\b(?:\s+\w+){0,8}?\s+(?:race|races|ethnicity|ethnicities|racial|ethnic)\b|\b(?:race|races|ethnicity|ethnicities|racial|ethnic)\b(?:\s+\w+){0,8}?\s+(?:identify|identification|describes?\s+(?:you|yourself)|applies\s+to\s+you)\b|\b(?:race|ethnicity)\s+(?:and|or)\s+(?:race|ethnicity)\b|\brace\s+ethnicity\b/;
/** Gender wordings §8.3's anchored rule misses ("What best describes your gender?", "Which gender do you identify
 *  as?"). A question that sets gender identity against the sex assigned at birth is the transgender question. */
// jr6 RULES (WD-11, Workday's Dana-Farber "Please select a gender.", web's "Veterans Status", Dana-Farber's "If you
// believe you belong to any of the categories of protected veterans listed below, …": fixtures
// danafarber-voluntary-disclosures, jr6-web-voluntary-disclosures): a gender asked to be selected, chosen, indicated or
// provided (never "gender neutral"); veterans in the plural, and the categories of protected veterans one belongs to.
// jr7 RULES-7 (EFA-10, Eightfold's twilio "Voluntary Self-Identification of Gender", snapshot7 twillio): the
// self-identification of a gender or a sex, its noun after.
const GENDER_WIDE = /^(?!.*\b(?:transgender|cisgender|assigned\s+at\s+birth|sexual\s+orientation)\b)(?:.*\b(?:your|my)\s+(?:gender|sex)\b|.*\b(?:which|what)\s+gender\b|.*\bgender\s+(?:do\s+you|you)\s+(?:\w+\s+)?identify\b|^(?:gender|sex)\s+(?:identity|identification|self\s+identification)$|.*\b(?:select|choose|indicate|provide|specify)\s+(?:a|your)\s+gender\b(?!\s+neutral)|^(?:voluntary\s+)?self\s+identification\s+(?:of\s+)?(?:gender|sex)(?:\s+identity)?$)/;
const VETERAN_WIDE = /\b(?:have|did)\s+you\s+(?:ever\s+)?serve[d]?\s+in\s+the\s+(?:us\s+|u\s+s\s+|united\s+states\s+)?(?:military|armed\s+forces|army|navy|air\s+force|marines?|marine\s+corps|coast\s+guard|national\s+guard|reserves?|space\s+force)\b|\bmilitary\s+status\b|\bveterans\b/;
const VETERAN_SELF = /^(?:(?:protected|military|us|u\s+s|armed\s+forces)\s+(?:and\s+|or\s+)?)*(?:veterans?|military)(?:\s+(?:and\s+|or\s+)?(?:veterans?|military|protected))*(?:\s+(?:status|self\s+identification|classification|information|service))*$|\b(?:are\s+you|i\s+am|you\s+are)\s+(?:not\s+)?(?:a\s+|an\s+)?(?:(?:protected|military|us|u\s+s|armed\s+forces|disabled|recently\s+separated)\s+)*veteran\b|\bidentify\s+as\s+(?:a\s+|one\s+or\s+more\s+of\s+the\s+classifications\s+of\s+)?(?:protected\s+)?veteran\b|\b(?:veterans?|military)\s+status\b|\bprotected\s+veterans?\b|\b(?:have|did)\s+you\s+(?:ever\s+)?serve[d]?\s+in\s+the\b|\b(?:your|my)\s+(?:veteran|military)\s+(?:status|service)\b|\bbelongs?\s+to\s+(?:any\s+of\s+|one\s+or\s+more\s+of\s+)?the\s+(?:categories|classifications)\s+of\s+protected\s+veterans\b/;
const DISABILITY_SELF = /^(?:voluntary\s+)?(?:self\s+identification\s+(?:of\s+)?)?disabilit(?:y|ies)(?:\s+(?:status|self\s+identification|disclosure|information|inclusion))*$|\bdisability\s+status\b|\b(?:do|did)\s+you\s+(?:currently\s+)?(?:identify|consider\s+yourself)\s+(?:as\s+|to\s+be\s+)?(?:a\s+)?disabled\b|\b(?:do|did)\s+you\s+(?:currently\s+)?(?:have|consider\s+yourself\s+to\s+have|identify\s+as\s+(?:having|a\s+person\s+with|an?\s+individual\s+with))\s+(?:a\s+|any\s+)?disabilit|\b(?:are\s+you|i\s+am)\s+(?:a\s+|an\s+)?(?:person|individual)\s+with\s+(?:a\s+)?disabilit|\bi\s+(?:have|do\s+not\s+have|dont\s+have)\s+(?:a\s+)?disabilit|\b(?:have\s+you\s+ever\s+had|history\s+of)\s+(?:a\s+)?disabilit|\bself\s+identif\w*(?:\s+\w+){0,4}\s+disabilit|\bdisabilit\w*(?:\s+\w+){0,4}\s+self\s+identif/;
const ORIENTATION_WIDE = /\blgbt\w*|\bqueer\b/;
// jr7 RULES-7 (EFA-10, Eightfold's twilio "Voluntary Self-Identification of Sexual Orientation", snapshot7 twillio).
const ORIENTATION_SELF = /^(?:voluntary\s+)?self\s+identification\s+(?:of\s+)?sexual\s+orientation$|^(?:your\s+)?sexual\s+orientation\b|\b(?:your|my)\s+sexual\s+orientation\b|\bsexual\s+orientation\s+(?:do\s+you|you)\s+(?:most\s+)?identify\b|\bidentify\b(?:\s+\w+){0,4}\s+sexual\s+orientation\b|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|i\s+consider\s+myself|do\s+you\s+consider\s+yourself)\b(?:\s+\w+){0,4}?\s+(?:lgbt\w*|queer|gay|lesbian|bisexual)\b|^(?:lgbt\w*\+?|queer)(?:\s+(?:status|identity|community|community\s+member))?$/;
const TRANSGENDER_WIDE = /\bassigned\s+at\s+birth\b|\bcisgender\b/;
const TRANSGENDER_SELF = /^transgender(?:\s+(?:status|identity|experience|history))?$|\b(?:do\s+you\s+identify\s+as|are\s+you|i\s+am|i\s+identify\s+as|do\s+you\s+consider\s+yourself|i\s+consider\s+myself)\s+(?:to\s+be\s+)?(?:a\s+)?(?:trans|transgender|cisgender|cis)\b|\bassigned\s+at\s+birth\b|\bcisgender\b|\btransgender\s+(?:experience|history|status|identity)\b/;
/** Over-18 wordings §8.3's rule misses ("over the age of 18", "18 or older"). "Under 18" is not among them: its yes
 *  means the opposite. jr6 RULES (WD-12, Workday's verily "Are you at least the age of majority under applicable law
 *  …?", fixtures jr6-verily-application-questions): the age of majority. */
const OVER18_WIDE = /\b(?:over|above|older\s+than)\s+the\s+age\s+of\s+(?:18|eighteen)\b|\b(?:18|eighteen)\s+(?:years\s+)?(?:of\s+age\s+)?(?:old\s+)?(?:or|and)\s+(?:older|over|above)\b|\b(?:at\s+least|over|older\s+than)\s+eighteen\b|\beighteen\s+years\s+(?:of\s+age|or\s+older)\b|\bage\s+of\s+majority\b/;
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
 *  "I completed this application myself"), ticked, like the attestation, only when the run used no AI at all.
 *  jr6 RULES (SR-3, fixtures/smartrecruiters/xplor-screening: "Think about the industry … In your own words, what's one
 *  real challenge …"): OWN_WORK counts only on a box or a choice the person affirms it on (OWN_WORK_KINDS), where "in my
 *  own words" attests too (jr6 fix RULES-R22: "I certify that all answers are in my own words", ticked); on a text box
 *  or a textarea, where "in your own words" is an instruction, attestationFor reads the explicit denials alone. */
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
 *  never an AI's to answer. v4 (D5): one that asks the person to agree (asksToAgree) is decided by the Consents mode;
 *  any other (whether one binds them now) stays unanswered. */
export function namesBindingWaiver(text: string): boolean {
  return BINDING_WAIVER.test(text) && BINDING_ASK.test(text);
}

// ── v4 run (D5) ──
/** An ask to take something on now: "Do you agree to", "Will you sign", "Are you willing to", "I agree to", "Do you
 *  waive". */
const AGREE_ASK = /\b(?:do|will|would|can)\s+you\s+(?:\w+\s+){0,2}?(?:agree|accept|consent|waive|sign|submit|abide|comply|relinquish|assign|forfeit|release)\b|\bare\s+you\s+willing\b|\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*(?:agree|accept|consent|waive|acknowledge)\b/;
/** A question of fact about a commitment: whether one binds the person now, or did ("Are you subject to a
 *  non-competition agreement", "Have you signed", "Are you bound by", "Do you have"). Its Yes would state a fact. */
const COMMITMENT_FACT = /\b(?:are|were)\s+you\s+(?:currently\s+|now\s+|still\s+)?(?:subject|bound|party|a\s+party|under)\b|\bhave\s+you\s+(?:ever\s+)?(?:signed|entered|agreed|been)\b|\bdo\s+you\s+(?:currently\s+)?have\b/;

/** The v4 review (security M2): an ask whose object is a "that"-clause ("I acknowledge that I am not bound by …", "Do
 *  you agree that you are not currently subject to …"): it asks the person to say something is so, not to take
 *  something on. */
const AGREE_THAT = /\b(?:agree\w*|accept\w*|consent\w*|acknowledge\w*|waive\w*|confirm\w*|certif\w*|attest\w*|declare\w*|understand\w*|represent\w*)\s+(?:(?:hereby|also|further|expressly|fully)\s+)*that\b/;
/** The v4 review (security M2): a first- or second-person state now or then, whatever the question around it ("I am /
 *  I'm / you are / I have (not) … bound, subject, party to, signed, under, entered into"): its Yes would state a fact.
 *  normalizeLabel deletes apostrophes ("im", "youre", "ive"). */
const COMMITMENT_STATE = /\b(?:i\s+am|im|i\s+was|you\s+are|youre|you\s+were|i\s+have|ive|i\s+had|you\s+have|youve)\s+(?:\w+\s+){0,3}?(?:bound|subject|party|signed|under|entered)\b/;

/** v4 (D5): whether normalized text asks the person to agree to something now, never whether something binds them: a
 *  binding waiver asked so is decided by the Consents mode; one asked as a fact stays unanswered (never a false Yes).
 *  The v4 review (security M2): only when its sole ask is to take something on from now on: a "that"-clause
 *  (AGREE_THAT), a first- or second-person state (COMMITMENT_STATE) or any word that denies (DENIES: "not bound", "no
 *  agreement") makes it a statement of fact the run cannot know, never answered. */
export function asksToAgree(text: string): boolean {
  return AGREE_ASK.test(text) && !COMMITMENT_FACT.test(text) && !AGREE_THAT.test(text)
    && !COMMITMENT_STATE.test(text) && !DENIES.test(text);
}
/** The core pass of 2026-11-06: a denial that AI made or helped make the work, in two joined participles (Dropzone's AI
 *  policy on Greenhouse, the owner's snapshot "[job-boards.greenhouse.io] ... Forward Deployed Engineer at Dropzone AI":
 *  "... are my own original work and were not generated or substantially assisted by any AI tool"), whose AI term sits
 *  six words past its negation, one more than AI_ATTESTATION's own reach. */
const NOT_MADE_BY_AI = String.raw`\b(?:not|never)\s+(?:been\s+)?(?:written|generated|assisted)\s+(?:or|nor)\s+(?:\w+\s+)?(?:written|generated|assisted)\s+(?:by|with|using)\s+(?:any\s+|an\s+)?${AI_TERM}\b`;
/** An "I did not use AI" attestation as normalizeLabel writes it (no apostrophes: "didnt", "havent"), with a few words
 *  between the negation and the AI term, either way round. jr6 RULES (SR-3): these explicit denials hold on any kind of
 *  field. */
const AI_DENIAL = String.raw`\b${NEGATION}\b(?:\s+\w+){0,5}?\s+${AI_TERM}\b|\b${AI_TERM}\b(?:\s+\w+){0,4}?\s+(?:was|were|has\s+been|have\s+been|is|are)\s+(?:not|never)\s+(?:used|involved)\b|${NOT_MADE_BY_AI}`;
const AI_DENIAL_RE = new RegExp(AI_DENIAL);
/** The denials, or a statement that it is the applicant's own (OWN_WORK). */
const AI_ATTESTATION = new RegExp(String.raw`${AI_DENIAL}|${OWN_WORK}`);
/** jr6 RULES (SR-3): the kinds a statement that the work is one's own is affirmed on (a box ticked, an option chosen);
 *  on a text box or a textarea it is a question or an instruction, never the person's attestation. */
const OWN_WORK_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['checkbox', 'radio', 'select', 'combobox']);
/** The attestation patterns a field of this kind is read with (undefined: any kind, the strictest reading). */
const attestationFor = (kind: FieldKind | undefined) => (kind === undefined || OWN_WORK_KINDS.has(kind)
  ? AI_ATTESTATION : AI_DENIAL_RE);
/** AI named anywhere in consent wording: that box is an AI attestation, which is never pre-approved (§8.7). */
const AI_NAMED = new RegExp(String.raw`\b${AI_TERM}\b`);
/** Unrecognised-consent wordings beyond §8.3's "I agree, consent, acknowledge, accept, understand". */
const CONSENT_WIDE = /\bi\s+(?:(?:hereby|also|further|expressly|fully)\s+)*(?:confirm|declare|have\s+read|give\s+(?:my\s+)?(?:permission|consent)|authori[sz]e|grant|allow)\b|\byou\s+(?:also\s+)?(?:agree|consent|acknowledge|accept|confirm|authori[sz]e)\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b|\bi\s+would\s+like\s+to\s+(?:receive|be\s+(?:contacted|considered|notified|added|kept))\b/;
/** A radio that asks for consent: a first-person consent verb, or "Do you consent", "Would you like to receive", or
 *  "Check Yes or No to indicate your agreement to receive text message updates" (Ashby's SMS consent). On a radio
 *  without one, a consent topic word ("experience in marketing") is not consent. jr6 RULES (JV-14): or a company asking
 *  to text the person by its name ("Can NinjaOne text you about your application?"). */
const CONSENT_ASK = /\bindicate\s+your\s+(?:agreement|consent)\b|\bi\s+(?:(?:hereby|also|further|expressly|fully|do)\s+)*(?:agree|consent|acknowledge|accept|understand|certify|attest|confirm|declare|authori[sz]e|give|grant|allow|have\s+read)\b|\b(?:do|would|will|can|may)\s+(?:you|we)\s+(?:\w+\s+){0,2}?(?:consent|agree|accept|acknowledge|authori[sz]e|allow|permit|opt|subscribe|receive|join|store|keep|retain|contact|share|use|send|text|email)\b|\b(?:would|do)\s+you\s+(?:like|want|wish)\s+to\b|\bopt\s+(?:in|out)\b|\bsign\s+up\b|\bsubscribe\b|\bby\s+(?:checking|ticking|clicking|selecting|submitting)\b|\b(?:can|may|could)\s+(?:\w+\s+){1,3}?(?:text|sms|message)\s+(?:you|me)\b/;
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

// ── s2 core-gh (snapshot round 2: the gh and eeo studies' Greenhouse and Lever questions) ──────────────────────────

/** X, the old Twitter, by its own name beside what the box takes ("X username", "X (formerly Twitter) profile": the
 *  parenthetical is left out), never a bare "X" (screenshot 7 of 2026-11-07). */
export const X_LINK = /\bx\s+(?:formerly\s+(?:known\s+as\s+)?twitter\s+)?(?:user\s?names?|handles?|accounts?|profiles?|urls?|links?)\b|\bx\s+com\b/;
/** The person's place of residence asked as a question (s2-ahead-0 "Where do you currently reside? (City/State)?",
 *  s2-tripledot-right-to-work-open "Please provide your city and state of residence", s2-robotspencils-clear-id-open
 *  "What city are you located in?"); never "Do you currently reside in …?", a yes or no. */
const RESIDENCE = /^where\s+do\s+you\s+(?:currently\s+|now\s+)?(?:reside|live)\b|\b(?:your\s+)?city\s+(?:and|or)\s+(?:state|province|region|country)\s+of\s+residence\b|^(?:what|which)\s+city\s+(?:are\s+you|do\s+you)\s+(?:currently\s+)?(?:located|based|live|reside)\b|\bcity\s+of\s+(?:current\s+)?residence\b/;
/** Employed or appointed by the company before (s2-horacemann-certify-open question_20182379004 "Have you ever been
 *  employed or appointed by Horace Mann …"), with a second verb §8.3's rule misses. */
const EMPLOYED_BEFORE = /\b(?:previously|ever)\s+(?:been\s+)?(?:worked|employed|appointed|contracted)(?:\s+or\s+(?:worked|employed|appointed|contracted))?\s+(?:for|at|by|with)\b/;
/** Employed by the company now (s2-horacemann-certify-open question_20182378004 "Are you currently a Full-Time/
 *  Part-Time employee or appointee of Horace Mann Inc …?"): the previously-employed rule's value then reads the current
 *  entries only (values.ts previouslyEmployedValue). */
// jr6 RULES R3 (JV-13, NinjaOne's Jobvite "Are you a current NinjaOne Employee", fixtures/jobvite/ninjaone-step3): or a
// current (or present) employee, contractor or appointee with the company named before the noun; never "a current or
// former employee", which asks of every employer (§8.3's "former employee").
export const EMPLOYED_NOW = /\bare\s+you\s+(?:currently|presently|now)\s+(?:an?\s+)?(?:\w+\s+){0,4}?(?:employee|appointee|employed|contractor|working)\b(?:\s+or\s+\w+)?\s+(?:of|at|by|for|with)\b|\bare\s+you\s+(?:an?\s+)?(?:current|present)\s+(?!or\b)(?:\w+\s+){0,3}?(?:employee|contractor|appointee)s?\b/;
/** Tools or technologies asked as a list the person has used (s2-pie-cicd-open question_20266022004[] "Which of the
 *  following infrastructure-as-code tools have you used in a production environment?"). */
const SKILLS_USED = /\b(?:which|what)\s+(?:of\s+the\s+following\s+)?(?:\w+\s+){0,4}?(?:tools|technologies|languages|frameworks|platforms|libraries|databases|services)\b(?:\s+\w+){0,6}?\s+(?:have\s+you|do\s+you)\s+(?:used|use|worked\s+with|know)\b/;
/** A security clearance by its levels (s2-virtru-clearance-open question_9225664005 "Do you hold an Active TS/SCI?"). */
const CLEARANCE_WIDE = /\bts\s*sci\b|\btop\s+secret\b|\b(?:security\s+)?clearances?\b|\bpolygraph\b|\bpublic\s+trust\b/;
/** A consent to an identity check asked as a question (s2-robotspencils-clear-id-open question_18795013008 "… we are
 *  sending automated CLEAR ID verification … are you okay doing this validation?"): unrecognised consent, decided by
 *  the Consents mode (decision 10). Only a check, a verification or a validation: "Are you comfortable doing on-call?"
 *  is a question. */
const CHECK_CONSENT = /\bare\s+you\s+(?:ok|okay|comfortable|fine|happy|willing|alright)\s+(?:with\s+)?(?:doing|completing|undergoing|taking|having|going\s+through)\s+(?:this|the|a|an|our)?\s*(?:\w+\s+){0,2}?(?:validation|verification|identity\s+check|id\s+check|background\s+check|screening)\b/;
/** A restrictive agreement asked as a fact (s2-horacemann-certify-open question_20182385004 "Are you subject to any
 *  agreement (Non-compete, non-solicitation, …) that may restrict your ability to be employed …?", s2-onestream-
 *  related-open question_8152425009 "Are you subject to a non-compete or other agreement … that would preclude or
 *  restrict your employment …?"): the person's own answer (screening.restrictiveAgreement), read with the
 *  parentheticals; an ask to agree to one stays the binding waiver it is. */
// jr6 RULES (WD-14, Workday's Genworth "Do you have an agreement in place with a current or former employer that would
// prevent or limit your ability to do this role at Genworth?", fixtures jr6-gnw-application-questions): an agreement in
// place with an employer that would prevent, limit or restrict the role.
const RESTRICTIVE_TOPIC = /\bnon\s?compet\w*|\bnoncompet\w*|\bnon\s?solicit\w*|\bnonsolicit\w*|\brestrictive\s+covenants?\b|\bsubject\s+to\s+(?:any|an?)\s+(?:\w+\s+){0,2}?agreements?\b(?:\s+\w+){0,8}?\s+(?:restrict|preclude|prevent|limit|prohibit)\w*|\bagreements?\s+in\s+place\s+with\s+(?:an?\s+|any\s+|your\s+)?(?:current|former|previous|prior|past)\b(?:\s+\w+){0,4}?\s+employers?\b(?:\s+\w+){0,8}?\s+(?:prevent|limit|restrict|preclude|prohibit)\w*/;
const RESTRICTIVE_FACT = /^(?:(?:are|were)\s+you\s+(?:currently\s+|now\s+|still\s+)?(?:subject|bound|party|a\s+party|under)\b|(?:have|did)\s+you\s+(?:ever\s+)?(?:signed|entered|agreed)\b|do\s+you\s+(?:currently\s+)?have\b)/;
/** U.S. military or government service asked as one question (s2-onestream-related-open question_8152429009 "Are you
 *  currently or have you within the last five years served in the U.S. armed forces or been employed by any U.S.
 *  federal, state, and local government?"): a federal, state or local government, or the armed forces beside one.
 *  Military service alone is the veteran question, and "a government agency" alone an employment question the AI
 *  answers. jr6 RULES R3 (adp-new-2, ADP's "Have you ever been employed as a civilian employee at a government
 *  agency?", fixtures/adp/questions): except employed or worked as a (civilian or federal) employee at, of, for or with
 *  a government agency, which is government service (policy.ts governmentServiceValue: the government answer). */
export const GOVERNMENT_SERVICE = /\b(?:employed|worked)\s+as\s+an?\s+(?:civilian\s+|federal\s+)?employee\s+(?:at|of|for|with)\s+(?:an?\s+|any\s+|the\s+)?(?:(?:federal|state|local|u\s+s|us)\s+)?government\s+agenc(?:y|ies)\b|\b(?:employed|worked|served|serving|working)\s+(?:by|for|in|at|with)\s+(?:an?\s+|any\s+|the\s+)?(?:\w+\s+){0,5}?(?:federal|state|local|municipal|u\s+s|us)\s+(?:\w+\s+){0,3}?government\b|\b(?:armed\s+forces|military)\b(?:\s+\w+){0,14}?\s+government\b|\bgovernment\b(?:\s+\w+){0,14}?\s+(?:armed\s+forces|military)\b|\b(?:federal|government)\s+(?:employee|official)\b/;
/** s2 core-gh review (C5): a government's contractor, vendor, supplier, subcontractor, contract or client. */
const GOVERNMENT_TRADE = /\b(?:government|federal|state|public\s+sector)\s+(?:\w+\s+)?(?:contractors?|vendors?|suppliers?|subcontractors?|contracts?|clients?|customers?)\b/;
/** A relative at the company (s2-onestream-related-open question_8152427009 "Are you related to anyone currently
 *  employed at OneStream?"). */
// jr6 RULES (WD-15, Workday's Genworth "Do you have a familial or personal relationship with any current Genworth
// employee (…)?", Parsons' "Are you a relative … of a Parsons employee?"): a familial or personal relationship with an
// employee, a relative of one. A close friend, a customer, a subcontractor or a vendor stays unclassified (owner Q14):
// label.relatives' `unless`.
const RELATIVES = /\brelated\s+to\s+(?:anyone|anybody|someone|any\s+(?:one|employee|person|current\s+employee)|an?\s+(?:current\s+)?employee)\b|\b(?:any\s+)?(?:relatives?|family\s+members?)\s+(?:who\s+(?:currently\s+)?(?:work|works|is\s+employed|are\s+employed)|(?:currently\s+)?(?:working|employed))\b|\b(?:familial|family|personal)\s+(?:(?:or|and)\s+(?:familial|family|personal)\s+)?relationships?\s+with\s+(?:any\s+|an?\s+)?(?:current\s+)?(?:\w+\s+){0,3}?employees?\b|\brelatives?\s+of\s+(?:an?\s+|any\s+)?(?:current\s+)?(?:\w+\s+){0,3}?employees?\b/;
/** jr6 RULES (WD-15): a relationship the profile's relatives never answer: a close friend's, or one with a customer, a
 *  subcontractor, a vendor or a supplier (owner Q14). */
const RELATIVES_NOT = /\bclose\s+friends?\b|\b(?:customers?|subcontractors?|vendors?|suppliers?|clients?)\b/;
/** The role's essential functions (s2-ahead-0 "Confirm the ability to perform the requisite duties of the role with or
 *  without reasonable accommodations"). */
const ESSENTIAL_FUNCTIONS = /\b(?:able|ability)\s+to\s+perform\b(?:\s+\w+){0,6}?\s+(?:duties|functions|requirements|tasks)\b(?:\s+\w+){0,8}?\s+(?:with\s+or\s+without|reasonable\s+accommodations?)\b|\bessential\s+(?:job\s+)?functions\b/;
/** The person's certifications (s2-ahead-0 "Do you hold any industry related certifications?"); never "I certify". */
const CERTIFICATIONS = /\b(?:any|your|list|hold|have)\s+(?:(?:industry(?:\s+related)?|professional|relevant|technical|other)\s+)?certifications?\b|^(?:(?:professional|industry|relevant|technical)\s+)?certifications?(?:\s+(?:held|obtained|earned))?$/;
/** Where the person would relocate or work from (s2-ahead-0 "If so, where would you be open to relocating?",
 *  s2-lightning-0 "… select all locations you are able to work a hybrid schedule from"). */
const RELOCATION_PLACES = /\bwhere\b(?:\s+\w+){0,6}?\s+relocat\w*|\brelocat\w*\s+to\s+(?:which|what)\s+(?:locations?|cities|places|countries)\b|\b(?:select|choose|which|what)\b(?:\s+\w+){0,4}?\s+locations?\b(?:\s+\w+){0,6}?\s+(?:work|relocat\w*|commute)\b/;
/** The education written out (s2-ahead-0 "Provide All Post-Secondary Education Attained - Formatted as: College Name;
 *  Degree Obtained …"). */
const EDUCATION_SUMMARY = /\beducation\s+attained\b|^(?:please\s+)?(?:list|provide|describe)\s+(?:all\s+)?(?:of\s+)?(?:your\s+)?(?:post\s+secondary\s+|higher\s+|formal\s+)?education\b/;
/** A whole address in one box (s2-horacemann-certify-open question_20182381004 "What is your current address?",
 *  s2-ahead-0 "Primary Residence Address"); "Address", "Your address", a home or street address or a line stays the
 *  street's (a form with its own city and postcode boxes asks the street there). */
const FULL_ADDRESS = /^(?:(?:current|full|complete|primary|permanent|residence|residential)\s+)+address$|^(?:current\s+)?address\s+of\s+(?:current\s+)?residence$/;
/** A nationality asked by country (decision 11: "Country of Origin" is the first citizenship; s2-sandtech-salary-open
 *  question_9737048101): never a birth place or a national origin, and never a yes or no about one country. */
const CITIZENSHIP_ASKED = /\bnationalit(?:y|ies)\b|\bcountr(?:y|ies)\s+of\s+(?:citizenship|nationality|origin)\b|\bcitizenship\s+countr(?:y|ies)\b|\bcountr(?:y|ies)\b(?:\s+\w+){0,4}?\s+citizen(?:ship)?s?\b|\bcitizen(?:ship)?s?\s+(?:\w+\s+){0,2}?countr(?:y|ies)\b|\bpassport\s+(?:country|nationality)\b/;
const NOT_CITIZENSHIP = /\bbirth\w*|\bborn\b|\bnational\s+origin\b/;
/** The yes/no legal questions a text box may take, as "Yes" or "No" (decision 11; categories.ts YES_NO_TEXT). */
const TYPED_YES_NO: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized', 'workAuth.sponsorship',
  'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture']);
/** A yes-or-no question: an auxiliary verb leads it. */
export const YES_NO_QUESTION = /^(?:are|is|am|was|were|do|does|did|have|has|had|will|would|can|could|may|might|shall|should)\b/;
/** jr6 RULES R4 (WD-28): any text that is no yes-or-no question. */
const NOT_YES_NO = new RegExp(`^(?!${YES_NO_QUESTION.source.slice(1)})`);

/** The rules s2 core-gh adds, tried in order before §8.3's list, each on a kind its category takes. */
const S2_RULES: ReadonlyArray<{ id: string; re: RegExp; category: FieldCategory; strength: RuleStrength;
  unless?: RegExp }> = [
  { id: 'label.telegram', re: /\btelegram\b/, unless: /\btelegram\s+(?:number|phone)\b/, category: 'links.telegram',
    strength: 'normal' },
  { id: 'label.full-address', re: FULL_ADDRESS, category: 'address.full', strength: 'normal' },
  // s2 core-gh review (C5): working for a government contractor, vendor or client is no government service.
  { id: 'label.government-service', re: GOVERNMENT_SERVICE, unless: GOVERNMENT_TRADE,
    category: 'screening.governmentService', strength: 'strong' },
  { id: 'label.relatives', re: RELATIVES, unless: RELATIVES_NOT, category: 'screening.relatives', strength: 'strong' },
  { id: 'label.essential-functions', re: ESSENTIAL_FUNCTIONS, category: 'screening.essentialFunctions',
    strength: 'strong' },
  { id: 'label.certifications', re: CERTIFICATIONS, category: 'skills.certifications', strength: 'normal' },
  { id: 'label.relocation-places', re: RELOCATION_PLACES, category: 'preferences.relocationPlaces', strength: 'normal' },
  { id: 'label.education-summary', re: EDUCATION_SUMMARY, category: 'education.summary', strength: 'normal' },
];
/** s2 core-gh: the rules tried after §8.3's list, when none of it matched. */
const S2_LATE_RULES: typeof S2_RULES = [
  { id: 'label.skills-used', re: SKILLS_USED, category: 'skills.list', strength: 'normal' },
];
const RESTRICTIVE_RULE = { id: 'label.restrictive-agreement', strength: 'strong' } as const;
const CITIZENSHIP_RULE = { id: 'label.citizenship-country', strength: 'normal' } as const;
const CHECK_CONSENT_RULE = { id: 'label.consent-check', strength: 'strong' } as const;

// s2 core-gh end

/** How the review narrows or widens one of the design's rules. */
interface Refinement {
  /** More wordings the rule covers. */
  also?: RegExp;
  /** jr6 RULES (SR-3): the wordings `also` covers on a field of this kind, where the kind is known (`also` stands for
   *  any kind). */
  alsoFor?: (kind: FieldKind) => RegExp;
  /** The rule applies only when this matches too; tested without a leading ask ("What is your") when `ask` is set. */
  only?: RegExp;
  ask?: boolean;
  /** jr6 RULES R3 (U-11): what the rule takes on a field of this kind, where narrower than its patterns (none: as on any
   *  kind): "Where are you currently located?" on a box of prose only as the whole question. */
  onlyFor?: (kind: FieldKind) => RegExp | undefined;
  /** Wordings the rule leaves alone. */
  unless?: RegExp;
  /** s2 core-gh review (C1): `unless` reads only the label's question sentences where the label states more after them
   *  (LabelContext.questions): a disclaimer after the question ("Candidates requiring sponsorship are not eligible.")
   *  turns nothing away. */
  unlessQuestionsOnly?: true;
  /** What a text the rule matched but `only` or `unless` turned away is instead; without it the next rule is tried. */
  otherwise?: { id: string; category: FieldCategory; strength: RuleStrength; needsUser?: NeedsUserCause };
  /** The category in place of the design's. */
  category?: (ctx: RuleCtx) => FieldCategory;
  /** The category and needsUser read the label with its parentheticals ("Do you require sponsorship (now)?"). */
  readsQualifiers?: boolean;
  /** Why nothing may answer what the rule matched, when the text says so. */
  needsUser?: (ctx: RuleCtx) => NeedsUserCause | null;
}

// jr6 RULES: the refinements' own wordings (see REFINEMENTS).
/** workday-new-2: an outside business, one doing business with the company, or its vendor, supplier, customer,
 *  subcontractor or competitor that the person works for or owns ("worked for one of our vendors", "employed by a
 *  competitor", "employee of a supplier"). jr6 fix (RULES-R4-OUTSIDE-BUSINESS-CAPACITY-LIST): never a capacity in which
 *  the person worked for the company itself ("… for any other Alphabet company as an employee, temp, vendor, contingent
 *  worker, or intern?", workday/jr6-verily-application-questions; "as a vendor"). */
const OUTSIDE_BUSINESS = /\boutside\s+(?:\w+\s+)?(?:company|companies|organi[sz]ations?|business(?:es)?|firms?|entit(?:y|ies))\b|\bdoing\s+business\s+with\b|\b(?:for|by|of|with)\s+(?:(?!as\b)\w+\s+){0,6}?(?:vendors?|suppliers?|customers?|subcontractors?|competitors?)\b/;
const SCHOOL_WORD = String.raw`(?:school|schools|university|universities|college|colleges|institution|institutions|academy)`;
/** JV-4: a school's own label ("School", "School name", "College / University", "University attended", "Name of
 *  institution", "Enter school name if not in the list above"), or which one the person attended. jr6 fix
 *  (RULES-R14-SCHOOL-ONLY-TOO-NARROW): also "Select your school", "Search for your school", "Name of the school you
 *  attended" and "Highest Level School Attended", which main read as the school. */
const SCHOOL_NOUN = new RegExp(String.raw`^(?:name\s+of\s+(?:the\s+|your\s+)?)?(?:(?:current|most\s+recent|recent|last|previous|prior|high|graduate|undergraduate|secondary|post\s+secondary|educational|education|academic|other|your|the)\s+)*${SCHOOL_WORD}(?:\s+(?:(?:or|and)\s+)?${SCHOOL_WORD})*(?:\s+(?:name|attended|of\s+study))*(?:\s+if\s+not\s+in\s+the\s+list(?:\s+above)?)?$|^(?:which|what)\s+${SCHOOL_WORD}\s+(?:did|do)\s+you\s+(?:attend|graduate\s+from|study\s+at)\b|^(?:select|choose|search\s+for|find|enter)\s+(?:your|the|a)\s+${SCHOOL_WORD}(?:\s+name)?$|^name\s+of\s+(?:the\s+)?${SCHOOL_WORD}\s+(?:you\s+)?(?:attended|graduated\s+from)$|^highest\s+(?:level\s+(?:of\s+)?)?${SCHOOL_WORD}\s+attended$`);
/** JV-14: a company asking to text the person ("Can NinjaOne text you about your application?"), to contact them by
 *  text, or to send them texts; never "the text you entered". */
const SMS_WIDE = /\b(?:can|may|could|will|would|to|we|us|they)\s+(?:\w+\s+){0,2}?text\s+(?:you|me)\b|\bcontact\s+(?:you|me)\s+(?:by|via|through)\s+text\b|\bsend\s+(?:you|me)\s+(?:a\s+)?texts?\b/;
/** JV-15, JV-22, ADP-19, U-11: the name of whoever referred the person. */
const REFERRER_WIDE = /\breferral\s+name\b|\bname\s+of\s+(?:your\s+|the\s+)?(?:referral|referrer|referring\s+(?:employee|person))\b|\bname\s+of\s+the\s+(?:employee|person)\s+who\s+referred\s+you\b|\bprovide\s+(?:their|the|his|her)\s+(?:full\s+)?name\b(?:\s+\w+){0,8}?\s+referred\b/;
// jr6 RULES R3 (items 49 to 61).
/** icims-new-3 (GitHub's iCIMS profile "Preferred Last Name", fixtures/icims/githubinc-profile.frame-1): the last name
 *  the person goes by, a preferred or chosen one (NinjaOne's Jobvite "Chosen Last Name", fixtures/jobvite/ninjaone-step1):
 *  the profile holds one last name, which it is. */
const PREFERRED_LAST_NAME = /^(?:preferred|chosen)\s+(?:last|family)\s+name$|^(?:preferred|chosen)\s+surname$/;
/** icims-new-3's neighbour (NinjaOne's "Chosen First Name"): a chosen first name is the preferred one. */
const CHOSEN_FIRST_NAME = /^chosen\s+(?:first\s+)?name$/;
/** ADP-4 (ADP's "State / Territory", fixtures/adp/personal): a territory, a state or a province or territory. */
const REGION_TERRITORY = /^(?:(?:state|province)\s+(?:or\s+)?)*territory$/;
/** ADP-8 (ADP's "If an offer is presented, how soon can you start?"), WD-27 (Workday's Parsons "When could you
 *  start?"): when the person could start, asked so. */
// jr7 RULES-7 (WD7-12, Workday's republic "If hired, when can you begin work?", snapshot7 workday2): or begin.
const START_WHEN = /\bhow\s+soon\s+(?:can|could|would|will)\s+you\s+(?:be\s+(?:able|available)\s+to\s+)?(?:start|begin)\b|\bwhen\s+(?:could|can|would|will)\s+you\s+(?:be\s+(?:able|available)\s+to\s+)?(?:start|begin)\b/;
/** SR-7 (Xplor's SmartRecruiters "How did you first hear about this opportunity?", fixtures/smartrecruiters/
 *  xplor-screening): how the person first, initially or originally heard. */
const REFERRAL_FIRST = /how\s+did\s+you\s+(?:first|initially|originally)\s+(?:hear|find|learn)/;
/** U-11 (UltiPro's "Where are you currently located?" as a box of prose, fixtures/ultipro/application): on a textarea,
 *  only the whole question of where the person is. */
const LOCATION_WHOLE = /^(?:(?:what\s+is\s+)?your\s+)?(?:current\s+)?location$|^where\s+are\s+you\s+(?:currently\s+|presently\s+)?(?:located|based)(?:\s+(?:now|today|currently))?$|^where\s+do\s+you\s+(?:currently\s+)?(?:live|reside)$/;
// jr6 RULES end

// ── jr7 RULES-7 (FIX7PLAN §6.3 R1): the refinements' own wordings, each from the owner's snapshot7 ──────────────────

/** ICIMS7-06: an attestation's words, which a skills list never holds (label.consent-certify's: "I (hereby) certify",
 *  "true and complete/accurate", "to the best of my knowledge", "attest"). */
// jr7 RULES-7 R2 (WD7-11, Workday's republic "Please list any job related military experience or skills", snapshot7
// workday2): nor a military, veteran or armed-forces question.
const SKILLS_NOT = /\bi\s+(?:hereby\s+)?certify\b|\btrue\s+and\s+(?:complete|accurate)\b|\bto\s+the\s+best\s+of\s+my\s+knowledge\b|\battest\b|\bmilitary\b|\bveterans?\b|\barmed\s+forces\b/;
/** ICIMS7-07 (careers-quartzbenefits' Q47 "… contingent upon successful completion of a pre-employment criminal
 *  background check. Are you willing to submit to a pre-employment background check if offered a position?", snapshot7
 *  icims3): a willingness or a consent to undergo a (criminal) background check, with no conviction asked about. */
const WILLING_CHECK = /^(?!.*\b(?:convicted|convictions?|felon\w*|pleaded|pled|charged|arrest\w*|guilty|misdemeanou?rs?|offen[cs]es?)\b).*\b(?:willing|consent\w*|agree\w*|authori[sz]\w*)\b(?:\s+\w+){0,8}?\s+(?:criminal\s+)?background\s+(?:checks?|screenings?|investigations?)\b/;
/** J7-GH-1: "zip" that is no postal code: inside a yes-or-no question, or the name of an organisation after a
 *  preposition ("support from Zip", "work at Zip", "hear about Zip"), never "Zip code" or "Zip+4". */
const POSTAL_NOT = new RegExp(String.raw`${YES_NO_QUESTION.source}|\b(?:at|for|with|from|about|join(?:ing)?|to|by)\s+zip\b(?!\s*(?:code|postal|\+))`);
/** RBP7-07, UKGR-18: a name typed as the person's signature. */
const TYPED_NAME_SIGNATURE = /\btyp(?:e|ing)\s+(?:in\s+)?your\s+(?:full\s+)?(?:legal\s+)?name\b|\bfull\s+(?:legal\s+)?name\s+to\s+(?:confirm|sign)\b/;
/** UKGR-16: the single-choice kinds a bare "Referral" is the source on. */
const CHOICE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'combobox']);
/** UKGR-18: a signature's prompt with the name it shows, to its end ("please type your full name to confirm <name>"). */
const SIGNATURE_PROMPT = /\b(?:please\s+)?typ(?:e|ing)\s+(?:in\s+)?your\s+(?:full\s+)?(?:legal\s+)?name\s+to\s+(?:confirm|sign)(?:\s+\w+){0,4}\s*$/;
/** DF7-V3: the application's own candidate acknowledgement ("I agree to the Candidate Acknowledgement"). */
const CANDIDATE_ACKNOWLEDGEMENT = /\b(?:candidate|applicant)\s+acknowledge?ments?\b/;
/** UP7-08: a certification that the information is truthful (and complete, and accurate). */
const CERTIFY_WIDE = /\btruthful\s+(?:and\s+)?(?:complete|accurate|correct)\b|\b(?:complete|accurate|correct)\s+and\s+truthful\b|\btrue\s+(?:complete|correct)\s+and\s+(?:accurate|complete|correct)\b/;
/** UP7-08 (UltiPro's "If offered employment by <employer>, would you be legally eligible in the United States to begin
 *  employment immediately?", snapshot7 ultipro1): legally eligible to begin, start or take up employment. */
const ELIGIBLE_TO_BEGIN = /\b(?:legally|lawfully)\s+eligible\b(?:\s+\w+){0,5}?\s+to\s+(?:begin|start|commence|take\s+up|accept)\s+(?:employment|work)\b/;

// jr7 RULES-7 R2: the fields of a job's or a school's entry the rules missed.
/** jr7-O4 (Oracle's tile editor "Employer City", "Employer Country", snapshot7 oraclecloud1): the employer's place, the
 *  entry's, never the home address. */
const EMPLOYER_PLACE = /^(?:employer|company|job|work)\s+(city|state|region|province|country)$/;
/** UKGR-15 (UKG Ready's work editor "Job title #1", snapshot7 secure7.saashr): a job title numbered by its entry. */
const NUMBERED_TITLE = /^(?:job\s+|position\s+)?title\s+\d{1,2}$/;
/** UKGR-15 (UKG Ready's work editor "Present"): the entry is the current job. */
const PRESENT_JOB = /^(?:present|current|to\s+present|until\s+present|still\s+(?:employed|working)(?:\s+here)?)$/;
/** DF7-11 (Dayforce's education record "Not Completed", snapshot7 dayforce1; Jobright reads `input[id*="notCompleted"]`
 *  as the education's isCurrent: cited): the school entry is not finished yet. */
export const NOT_COMPLETED = /^(?:not\s+(?:yet\s+)?(?:completed|complete|finished)|incomplete|in\s+progress|still\s+in\s+progress)$/;
/** DF7-11 (Dayforce's employment record "Division / Dept.", "Reason For Leaving?"): an entry's department and, when
 *  optional, why the person left: no profile answer, and no AI's to invent. */
const ENTRY_DEPARTMENT = /^(?:division|department|dept|business\s+unit)(?:\s+(?:or\s+|and\s+)?(?:division|department|dept))*(?:\s+name)?$/;
const REASON_FOR_LEAVING = /^(?:reasons?\s+for\s+leaving|why\s+did\s+you\s+leave)$/;
const ENTRY_FIELD_RULE = { id: 'label.entry-field', strength: 'normal' } as const;

/**
 * jr7 RULES-7 R2 (jr7-O4, UKGR-15, DF7-11, ICIMS7-08): an entry's own field: the employer's city or country (any
 * section); in a job's entry (its block, or a section the adapter names "experience") its duties as its description, a
 * numbered job title, "Present" as its current flag, and its department or an optional reason for leaving as an
 * entry detail no profile value or AI fills (`experience.detail`); in a school's entry "Not Completed" as its
 * in-progress flag. Null for any other field.
 */
function entryFieldHit(text: string, section: SectionKind, kind: FieldKind, context: LabelContext): LabelRuleHit | null {
  const place = EMPLOYER_PLACE.exec(text)?.[1];
  if (place !== undefined) {
    const category: FieldCategory = place === 'city' ? 'experience.city'
      : place === 'country' ? 'experience.country' : 'experience.region';
    return kindAllowed(category, kind) ? hitOf(ENTRY_FIELD_RULE, category) : null;
  }
  const job = section === 'experience' && (context.block !== undefined || context.entry === 'experience');
  const school = section === 'education' && (context.block !== undefined || context.entry === 'education');
  const hits: Array<[boolean, FieldCategory]> = [
    [job && EXPERIENCE_DESCRIPTION.test(text), 'experience.description'],
    [job && NUMBERED_TITLE.test(text), 'experience.title'],
    [job && kind === 'checkbox' && PRESENT_JOB.test(text), 'experience.current'],
    [job && (ENTRY_DEPARTMENT.test(text) || (REASON_FOR_LEAVING.test(text) && context.required !== true)),
      'experience.detail'],
    [school && kind === 'checkbox' && NOT_COMPLETED.test(text), 'education.current'],
  ];
  const found = hits.find(([matched, category]) => matched && kindAllowed(category, kind));
  if (found !== undefined) return hitOf(ENTRY_FIELD_RULE, found[1]);
  // ICIMS7-14 (arc-onesolutions' optional "License/Certification Name/Type", "… Number", "… State", snapshot7 iCIMS1):
  // the name or type is a certification the profile may hold; its number or state none (skipped, never an AI's).
  if (LICENCE_NAME.test(text) && kindAllowed('skills.certifications', kind)) {
    return hitOf(LICENCE_RULE, 'skills.certifications');
  }
  if (LICENCE_DETAIL.test(text) && kindAllowed('skills.certificationDetail', kind)) {
    return hitOf(LICENCE_RULE, 'skills.certificationDetail');
  }
  return null;
}
const LICENCE_WORD = String.raw`(?:(?:professional\s+)?licen[cs]e(?:\s+(?:or\s+|and\s+)?certification)?|certification(?:\s+(?:or\s+|and\s+)?licen[cs]e)?)`;
const LICENCE_NAME = new RegExp(String.raw`^${LICENCE_WORD}\s+(?:name|type|title)(?:\s+(?:or\s+|and\s+)?(?:name|type|title))*$`);
const LICENCE_DETAIL = new RegExp(String.raw`^${LICENCE_WORD}\s+(?:number|no|num|id|state|issuing\s+(?:state|authority|body)|country|expiration(?:\s+date)?|expiry(?:\s+date)?|issue\s+date|date\s+(?:issued|obtained))$`);
const LICENCE_RULE = { id: 'label.licence', strength: 'normal' } as const;

/** UKGR-14 (UKG Ready's "Primary National ID" list and its SSN box, snapshot7 secure7.saashr): a national id's or a
 *  social security number's own label, or the type of one. */
const NATIONAL_ID_LABEL = /^(?:(?:your|primary|secondary)\s+)*(?:ssn|social\s+security(?:\s+(?:number|no|num|card))?|social\s+insurance\s+(?:number|no)|national\s+(?:id|identification|identity|insurance)(?:\s+(?:number|no|num|card|type))?|(?:type\s+of\s+)?national\s+id|tax\s+(?:id|identification)\s+(?:number|no))$|\blast\s+(?:4|four)\s+(?:digits\s+)?of\s+(?:your\s+)?(?:ssn|social\s+security(?:\s+number)?)\b/;
/** UKGR-14: a social security number's mask ("999-99-9999", "###-##-####"), as a placeholder or the label it gave. */
const SSN_MASK = /^[9#Xx0]{3}-[9#Xx0]{2}-[9#Xx0]{4}$/;
/** UKGR-14: a national id or social security number by the control's name or id ("SSN", "social_security_number"). */
const NATIONAL_ID_NAME = /(?:^|[_ ])(?:ssn|social_?security(?:_?(?:number|no|num))?|social_?insurance_?number|national_?id(?:_?number)?)(?=[_ \d]|$)/;
const NATIONAL_ID_RULE = { id: 'label.national-id', strength: 'strong' } as const;

/**
 * jr7 RULES-7 (UKGR-14, the safety line: UKG Ready's SSN box, labelled only by its "999-99-9999" placeholder, was read as
 * the phone and planned with the person's number): whether a field asks for a national id or a social security number
 * (or its type) by its label, its mask (the label or the pattern a placeholder gave) or its name or id. Such a field is
 * `identity.nationalId`, handed to the person (`identifier`): never filled, never asked of an AI, never a phone.
 */
export function nationalIdHit(label: string, rawLabel: string, pattern: string | undefined, nameId: string):
  LabelRuleHit | null {
  if (!NATIONAL_ID_LABEL.test(label) && !SSN_MASK.test(rawLabel.trim()) && !SSN_MASK.test((pattern ?? '').trim())
    && !NATIONAL_ID_NAME.test(nameId)) return null;
  return { ...hitOf(NATIONAL_ID_RULE, 'identity.nationalId'), needsUser: 'identifier' };
}
// jr7 RULES-7 end

/** A self-identification topic without a self-identification wording: a question about the job, the person's own. */
const SENSITIVE_TOPIC = { id: 'label.sensitive-topic', category: 'screening.other', strength: 'normal',
  needsUser: 'sensitive-topic' } as const;

/** The review's refinements, by the design rule they change. */
const REFINEMENTS: Readonly<Record<string, Refinement>> = {
  // jr6 RULES R3 (icims-new-3's neighbour): a chosen first name (CHOSEN_FIRST_NAME).
  'label.preferred-name': { also: new RegExp(String.raw`name\s+you(?:d|\s+would)?\s+(?:prefer|like)\s+(?:us\s+)?to\s+(?:use|call\s+you)|\bname\s+you\s+prefer\b|${CHOSEN_FIRST_NAME.source}`) },
  // jr6 RULES R3 (icims-new-3): a preferred or chosen last name (PREFERRED_LAST_NAME).
  'label.last-name': { also: PREFERRED_LAST_NAME },
  // s2 core-wd: Workday's "Country Phone Code" (formField-countryPhoneCode, fixtures/workday/s2-exelixis-state-open), and
  // a "Phone country" alone.
  'label.phone-country': { also: /\bcountry\s+phone\s+code\b|\bphone\s+country(?:\s+code)?\b/, unless: PHONE_WITH_CODE },
  'label.phone': { only: PHONE_NOUN, ask: true },
  'label.address2': { only: ADDRESS2_NOUN },
  // jr7 RULES-7 (UKGR-16, UKG Ready's required Address "Street", snapshot7 secure7.saashr): the street alone.
  'label.address1': { also: /^(?:street|street\s+name|street\s+and\s+number)$/ },
  // jr7 RULES-7 (J7-GH-1, Greenhouse's "Do you now or will you in the future require any form of immigration sponsorship
  // or work authorization support from Zip to legally work in the United States …?", snapshot7 greenhouse): "zip" is the
  // postal code only as the label's own noun, never inside a yes-or-no question nor right after a preposition naming
  // an organisation (POSTAL_NOT); the next rule is tried.
  'label.postal': { unless: POSTAL_NOT },
  // jr6 RULES (ICIMS-09, O7): a City, a State/Region or a Country in a job's or a school's block is that entry's
  // (fixtures/icims/nyu-profile.frame-1's employer and school blocks; Oracle's education editor), never the home
  // address.
  'label.city': { category: (c) => ENTRY_PLACE[c.entry ?? 'home'].city },
  // jr6 RULES R3 (ADP-4): a territory too (REGION_TERRITORY).
  'label.region': { also: REGION_TERRITORY, category: (c) => ENTRY_PLACE[c.entry ?? 'home'].region },
  // jr6 RULES R4 (SR-10: SmartRecruiters' "Country/Region" in the location's manual mode, fixtures
  // jr6-xplor-one-click-filled; SuccessFactors' "Country/Region of Residence"): a country or region.
  'label.country': { also: /^(?:what\s+is\s+your\s+)?(?:current\s+)?country(?:\s+(?:or\s+)?region)?(?:\s+of\s+(?:current\s+)?residence)?$|^what\s+country\s+do\s+you\s+(?:currently\s+)?(?:live|reside)\s+in$/,
    category: (c) => ENTRY_PLACE[c.entry ?? 'home'].country },
  // s2 core-gh: a residence asked as a question (RESIDENCE). s2 core-wd: "Location" inside a job's block is that job's
  // place (Workday's formField-location in each Work Experience block, fixtures/workday/s2-exelixis-my-experience),
  // never the person's current location.
  // jr6 RULES R3 (U-11): on a box of prose, only the whole question (LOCATION_WHOLE).
  'label.location': { also: new RegExp(String.raw`^(?:what\s+is\s+)?your\s+(?:current\s+)?location$|` + RESIDENCE.source),
    onlyFor: (kind) => (kind === 'textarea' ? LOCATION_WHOLE : undefined),
    category: (c) => (c.section === 'experience' && c.block !== undefined && !/\bcurrent\b/.test(c.label)
      ? 'experience.location' : 'location.current') },
  'label.portfolio': { only: PORTFOLIO_NOUN, ask: true },
  // s2 core-gh: X by its own name (decision 9), a clearance by its levels.
  'label.twitter': { also: X_LINK },
  'label.clearance': { also: CLEARANCE_WIDE },
  // The Phase 7a review: "legally eligible to be employed" is authorization too (a work authorization status is read
  // before this rule: matchLabelRules).
  // The core pass of 2026-11-06: a need for employer-sponsored work authorization is sponsorship (SPONSORED_NEED).
  // s2 core-gh (decision 13): a need for the employer to sponsor is sponsorship too (NEED_TO_SPONSOR).
  // s2 core-gh review (C1): read in the question alone, so a disclaimer after it ("Are you authorized to work in the
  // US? Candidates requiring sponsorship are not eligible.") leaves the authorization question authorization.
  // jr7 RULES-7 (UP7-08): legally eligible to begin employment (ELIGIBLE_TO_BEGIN).
  'label.work-auth': { also: new RegExp(`${WORK_AUTH_WIDE.source}|${ELIGIBLE_TO_BEGIN.source}`), only: WORK_AUTH_LEGAL,
    unless: new RegExp(`${SPONSORED_NEED.source}|${NEED_TO_SPONSOR.source}`), unlessQuestionsOnly: true },
  'label.sponsorship': { also: SPONSORED_NEED, only: VISA_SPONSORSHIP, readsQualifiers: true,
    needsUser: (c) => (sponsorshipTime(c.label) === 'unclear' ? 'unclear-time' : null) },
  'label.over18': { also: OVER18_WIDE },
  // jr7 RULES-7 (ICIMS7-07): a willingness to undergo a (criminal) background check is no claim about a record
  // (WILLING_CHECK): label.consent-background then decides it.
  'label.criminal': { also: CRIMINAL_WIDE, unless: WILLING_CHECK },
  'label.hispanic': { only: HISPANIC_SELF, otherwise: SENSITIVE_TOPIC },
  'label.race': { also: RACE_WIDE, only: RACE_SELF, otherwise: SENSITIVE_TOPIC },
  'label.gender': { also: GENDER_WIDE },
  'label.veteran': { also: VETERAN_WIDE, only: VETERAN_SELF, otherwise: SENSITIVE_TOPIC },
  'label.disability': { only: DISABILITY_SELF, otherwise: SENSITIVE_TOPIC },
  'label.orientation': { also: ORIENTATION_WIDE, only: ORIENTATION_SELF, otherwise: SENSITIVE_TOPIC },
  'label.transgender': { also: TRANSGENDER_WIDE, only: TRANSGENDER_SELF, otherwise: SENSITIVE_TOPIC },
  'label.field': { only: FIELD_NOUN, ask: true },
  // jr6 RULES R4 (O7: Oracle's education editor "Average Grade", fixtures/oracle/hjf-after-submit): the GPA.
  'label.gpa': { also: /^(?:average\s+grade|grade\s+average)$/ },
  'label.company': { only: COMPANY_NOUN, ask: true },
  'label.title': { only: TITLE_NOUN, ask: true },
  'label.years': { only: TOTAL_YEARS,
    otherwise: { id: 'label.skill-years', category: 'screening.other', strength: 'normal' } },
  // jr7 RULES-7 (ADP7-8): or an hourly or daily rate asked so (PAY_RATE_EXPECTATION).
  'label.salary': { also: new RegExp(`${PAY_EXPECTATION.source}|${PAY_RATE_EXPECTATION.source}`), unless: PAY_TOPIC,
    category: (c) => (PAST_PAY.test(c.label) ? 'unknown' : 'salary.expected'),
    needsUser: (c) => (PAST_PAY.test(c.label) ? 'current-pay' : null) },
  // jr6 RULES R3 (ADP-8, WD-27): "how soon can you start", "when could you start" (START_WHEN).
  // jr7 RULES-7 R2 (RBP7-15): "Date Available" (DATE_AVAILABLE).
  'label.availability': { also: new RegExp(`${START_WHEN.source}|${DATE_AVAILABLE.source}`),
    only: new RegExp(`${START_AVAILABILITY.source}|${START_WHEN.source}|${DATE_AVAILABLE.source}`),
    ask: true, otherwise: { id: 'label.other-availability', category: 'screening.other', strength: 'normal' } },
  // jr6 RULES (JV-4, fixtures jr6-vhl-step1: "Have you been employed by any United States K-12 School District since
  // 2016 in any capacity?"): a school's own label, never a word in a question.
  'label.school': { only: SCHOOL_NOUN, ask: true },
  'label.relocation': { unless: /\brelocat\w*\s+(?:assistance|package|support|benefits?|reimbursement|bonus|expenses?|costs?|stipend|allowance|help|budget|polic(?:y|ies)|services?)\b/ },
  // "Have you worked here before?" (docs/SPEC-AMENDMENTS.md §8), which §8.3's rule misses. The rule's value is taken
  // only for a question that names the posting's company or points at it (values.ts, the Phase E review, M3).
  // s2 core-gh: employed or appointed before, and employed now (EMPLOYED_BEFORE, EMPLOYED_NOW).
  'label.previously-employed': { also: new RegExp(String.raw`\bworked\s+(?:here|for\s+us|with\s+us)\b|\bemployed\s+(?:here|by\s+us)\b|\bworked\s+(?:at|for)\s+(?:\w+\s+){1,4}?(?:previously|before|in\s+the\s+past|in\s+any\s+capacity)\b|\b(?:been\s+)?an?\s+(?:independent\s+)?contractor\s+(?:at|for|with)\b|\bex\s+employees?\b|\bformer\s+employees?\b|\b(?:previous|prior|past)\s+(?:\w+\s+){0,3}?(?:employee|worker|contractor)s?\b|`
    + `${EMPLOYED_BEFORE.source}|${EMPLOYED_NOW.source}`),
    // jr6 RULES (workday-new-2, fixtures jr6-parsons-application-questions: "Are you currently the owner or employee
    // of any outside company that is currently …"): working for an outside business, for one doing business with the
    // company, or for its vendor, supplier, customer, subcontractor or competitor is no employment by the company.
    // jr6 RULES (WD-16, JV-12: VHL's "Have you worked for VHL in any capacity previously?", fixtures jr6-vhl-step1;
    // WD-17: AEP's "Are you now or have you ever been a contractor at AEP?", fixtures aep-application-questions-2):
    // worked for a company previously, before, in the past or in any capacity; a contractor at or for it.
    unless: OUTSIDE_BUSINESS },
  // jr6 RULES R4 (WD-28, Workday's Dana-Farber "Have you ever, or are you currently participating in a student training
  // program …", fixtures jr6-danafarber-application-questions-1): skills never on a yes or no question (a list that takes
  // several answers aside: "Do you have any of these skills?" over the skills themselves).
  // jr7 RULES-7 (ICIMS7-06, careers-quartzbenefits' required "I certify that the information provided in this
  // application … I confirm that all statements regarding my skills, qualifications, and experiences, are my own. …",
  // an iCIMS dropdown, snapshot7 icims3): never an attestation (SKILLS_NOT), whose consent reading then decides it.
  'label.skills': { onlyFor: (kind) => (kind === 'checkbox-group' || kind === 'multiselect' ? undefined : NOT_YES_NO),
    unless: SKILLS_NOT },
  'label.travel': { unless: /\btravel\s+(?:restrictions?|limitations?|constraints?|bans?|reimbursements?|expenses?|polic(?:y|ies)|documents?|history)\b|\brestrictions?\s+on\s+(?:your\s+)?travel\b/ },
  // "Which languages do you speak?" (Phase 2): §8.3's rule takes "languages you speak" with nothing between. Only
  // "speak": "What programming languages do you know?" asks about skills.
  'label.language': { also: /\blanguages?\s+(?:do|can)\s+you\s+speak\b/, unless: /\b(?:proficiency|fluency|level)\b/ },
  'label.proficiency': { only: LANGUAGE_PROFICIENCY },
  'label.resume': { category: (c) => (c.kind === 'file' ? 'file.resume'
    : c.kind === 'checkbox' || c.kind === 'radio' ? 'consent.other' : 'unknown') },
  'label.why-company': { also: /why\s+do\s+you\s+want\s+to\s+(?:work|join)|why\s+(?:are\s+you\s+)?interested\s+in\s+(?:joining|working\s+(?:at|for|with))|what\s+(?:excites|interests|attracts|draws)\s+you\s+(?:to|about)\s+(?:joining|working\s+(?:at|for|with)|our\s+company|the\s+company|us)\b|^why\s+us$/ },
  'label.why-role': { also: /why\s+(?:are\s+you\s+)?interested\s+in\s+(?:this|the|our)\s+(?:role|position|job|opportunity)|why\s+do\s+you\s+want\s+(?:this|the)\s+(?:role|position|job)|why\s+(?:are\s+you\s+)?applying\s+(?:for|to)\s+(?:this|the)\s+(?:role|position|job)|what\s+(?:excites|interests|attracts|draws|appeals\s+to)\s+you\s+(?:about|in|to)\s+(?:this|the)\s+(?:role|position|job|opportunity)/ },
  // jr6 RULES (SR-3): a statement that the work is one's own counts only where it is affirmed (attestationFor).
  'label.consent-ai': { also: AI_ATTESTATION, alsoFor: attestationFor },
  'label.consent-retention': { also: RETENTION_WIDE, only: RETENTION_ONLY },
  'label.consent-marketing': { also: MARKETING_WIDE },
  // jr6 RULES (JV-14, fixtures ninjaone-step1: "Can NinjaOne text you about your application?").
  'label.consent-sms': { also: SMS_WIDE },
  'label.consent-generic': { also: CONSENT_WIDE },
  // jr7 RULES-7 (UP7-08, UltiPro's "I confirm that the information provided within this application is truthful,
  // complete, and accurate…", snapshot7 ultipro1): a certification by "truthful" (CERTIFY_WIDE).
  'label.consent-certify': { also: CERTIFY_WIDE },
  // jr7 RULES-7 R2 (RBP7-07, Rippling's attestation help "… acknowledge this by typing your full name in the text field",
  // snapshot7 rippling1; UKGR-18, UKG Ready's "Please type your full name to confirm: …", "Full name to confirm" by the
  // label contract of FIX7PLAN §3.3, snapshot7 secure7.saashr): a typed name asked for, a signature.
  'label.consent-signature': { also: TYPED_NAME_SIGNATURE },
  // jr7 RULES-7 (DF7-V3, Dayforce's Submit step "I agree to the Candidate Acknowledgement", fixtures/dayforce/
  // submit-challenge; Jobright's agreeCheckbox rule treats it as the application's required terms: cited): the
  // application's terms, decided by the Consents mode.
  'label.consent-terms': { also: CANDIDATE_ACKNOWLEDGEMENT },
  // jr6 RULES (JV-15, JV-22, ADP-19, U-11): the name of whoever referred the person ("Referral Name", "If yes, please
  // provide their name or enter N/A if you were not referred.").
  'label.referrer': { also: REFERRER_WIDE },
  // jr6 RULES R3 (SR-7): how the person first heard (REFERRAL_FIRST).
  // jr7 RULES-7 R2 (UKGR-16, UKG Ready's "Referral" select, snapshot7 secure7.saashr): "Referral" on a list (never a
  // box, where it may name the referrer).
  'label.referral-source': { also: REFERRAL_FIRST,
    alsoFor: (kind) => (CHOICE_KINDS.has(kind) ? new RegExp(`${REFERRAL_FIRST.source}|^referral(?:\\s+type)?$`)
      : REFERRAL_FIRST) },
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
  /** s2 core-gh (decision 13): the rule reads only the label's question sentences where the label states more after
   *  them (LabelContext.questions). */
  questionsOnly?: true;
  category: FieldCategory;
  strength: RuleStrength;
  needsUser: NeedsUserCause;
}

/** The rules run before §8.3's list, in order. */
export const PRE_RULES: ReadonlyArray<PreRule> = [
  // "Are you authorized to work in the US without sponsorship?" and "I am authorized to work and do not require
  // sponsorship" join two answers; "able to work without sponsorship" inverts the sponsorship one.
  // s2 core-gh (decision 13, the gh study's 3c: s2-ridgeline-sponsorship-open question_32819764003, "Will you now or in
  // the future require sponsorship …? You must be work authorized in the United States without the need for employer
  // sponsorship."): only the question sentences are read, so a requirement stated after the question joins no second
  // answer to it.
  { id: 'label.authorization-and-sponsorship', re: /\bwithout\b(?:\s+\w+){0,5}?\s+sponsor\w*|\b(?:not|never|dont|wont|doesnt|cannot|cant|no\s+longer)\b(?:\s+\w+){0,6}?\s+(?:need|require)\w*(?:\s+\w+){0,4}?\s+sponsor\w*|\bno\s+(?:need\s+for\s+|requirement\s+for\s+)?(?:\w+\s+)?sponsorship\b|(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b.*\bsponsor\w*|\bsponsor\w*\b.*\b(?:authori[sz]ed|eligible|permitted|entitled)\s+to\s+work\b/,
    questionsOnly: true, category: 'workAuth.authorized', strength: 'strong', needsUser: 'authorization-and-sponsorship' },
  { id: 'label.work-permit', re: /\b(?:work|working|residence|residency)\s+permits?\b|\bblue\s+card\b|\bpermit\s+to\s+work\b/,
    unless: /\bsponsor/, category: 'workAuth.authorized', strength: 'strong', needsUser: 'work-permit' },
  // jr7 RULES-7 (EFA-10, Eightfold's twilio "Please indicate whether you are either a citizen or resident of any of
  // the following countries: Cuba, Iran, North Korea, Syria or Crimea Region of Ukraine.", snapshot7 twillio; and
  // WD7-07's export-control "… a citizen or permanent resident of any of the following countries/regions?"): a citizen
  // or resident of any listed country asks a citizenship whose No the profile never states: the person's (owner Q7-3,
  // default theirs).
  { id: 'label.nationality', re: /\bcitizens?\s+(?:or|and|and\s+or)\s+(?:a\s+)?(?:permanent\s+)?residents?\s+of\s+any\s+of\s+the\s+(?:following|listed|below|these)\b|\bresidents?\s+(?:or|and)\s+(?:a\s+)?citizens?\s+of\s+any\s+of\s+the\s+(?:following|listed|below|these)\b|\bnationalit(?:y|ies)\b|\bnational\s+origin\b|\bcountr(?:y|ies)\s+of\s+(?:citizenship|nationality|birth|origin)\b|\bcountr(?:y|ies)\b(?:\s+\w+){0,6}?\s+citizen\w*|\bcitizen\w*(?:\s+\w+){0,4}?\s+countr(?:y|ies)\b|\bpassport\s+(?:country|nationality)\b|\bplace\s+of\s+birth\b|\bbirth\s*place\b/,
    readsQualifiers: true, category: 'workAuth.status', strength: 'normal', needsUser: 'nationality' },
  // An age, a date of birth, or an age line other than 18 ("under 18" inverts the over-18 answer; 21 is another line).
  { id: 'label.age', re: /^(?:what\s+is\s+)?(?:your\s+)?(?:current\s+)?age(?:\s+(?:range|group|bracket|in\s+years))?$|\bdate\s+of\s+birth\b|\bbirth\s*date\b|\bbirthday\b|\bdob\b|\bhow\s+old\s+are\s+you\b|\byear\s+of\s+birth\b|\bbirth\s+year\b|\byour\s+age\b|\b(?:under|younger\s+than|below)\s+(?:the\s+age\s+of\s+)?(?:18|eighteen|21|twenty\s+one)\b|\b(?:21|twenty\s+one)\s+(?:years\s+)?(?:of\s+age\s+)?(?:old\s+)?(?:or|and)\s+(?:older|over|above)\b|\b(?:over|at\s+least|older\s+than)\s+(?:the\s+age\s+of\s+)?(?:21|twenty\s+one)\b/,
    readsQualifiers: true, category: 'screening.over18', strength: 'normal', needsUser: 'age' },
];

// s2 core-wd: Workday's My Information and My Experience (the wd study §4-5), each from a snapshot.

/** A label rule of snapshot round 2, read before §8.3's list (matchLabelRules): its own label, on a kind its category
 *  holds. */
interface InfoRule {
  id: string;
  re: RegExp;
  category: FieldCategory;
  strength: RuleStrength;
}

/** Workday's My Information fields no rule of §8.3 reads (fixtures/workday/s2-exelixis-state-open,
 *  s2-verily-my-information): "Phone Device Type" (formField-phoneType, required), "Suffix" (formField-legalName--social),
 *  "Phone Extension" (formField-extension) and "I have a preferred name" (formField-preferredCheck). Each is the
 *  label's own noun: "Phone type" or "Type of phone" too, a name's suffix, an extension alone; never a question that
 *  mentions one. */
const WORKDAY_INFO_RULES: readonly InfoRule[] = [
  { id: 'label.phone-type', re: /^(?:phone|telephone|mobile)\s+(?:device\s+|number\s+)?type$|^type\s+of\s+(?:phone|telephone)(?:\s+number)?$|^phone\s+device$/,
    category: 'contact.phoneType', strength: 'strong' },
  { id: 'label.suffix', re: /^(?:name\s+)?suffix$|^suffix\s+name$/, category: 'identity.suffix', strength: 'strong' },
  { id: 'label.phone-extension', re: /^(?:phone\s+|telephone\s+)?(?:extension|ext)(?:\s+number)?$/,
    category: 'contact.phoneExtension', strength: 'strong' },
  // jr6 RULES R4 (adp-new-3: ADP's "I have a preferred or chosen name", fixtures/adp/personal): or a chosen one.
  { id: 'label.has-preferred-name', re: /^(?:i\s+have|do\s+you\s+have|i\s+use|do\s+you\s+use)\s+a\s+(?:preferred\s+(?:or\s+chosen\s+)?|chosen\s+)(?:first\s+)?name$/,
    category: 'identity.hasPreferredName', strength: 'strong' },
  // jr6 RULES R3 (ICIMS-13, Jobright's normalizeIcimsAddressTypeLabel relabels iCIMS's address "Type" so: cited): an
  // address's own type.
  { id: 'label.address-type', re: /^(?:address\s+type|type\s+of\s+address)$/, category: 'address.type',
    strength: 'strong' },
];

/** "Overall Result (GPA)" (Workday's formField-gradeAverage, fixtures/workday/s2-verily-field-of-study-open): a result,
 *  grade, score or average whose parenthetical is the GPA alone. */
const GPA_QUALIFIER = /^(?:c?gpa|grade\s+point\s+average)$/;
const RESULT_WORD = /\b(?:results?|grades?|score|average|marks?)\b/;
const GPA_RULE = { id: 'label.gpa', strength: 'strong' } as const;

/** Snapshot round 2's rules for Workday's My Information and a GPA asked in a parenthetical (see above), or null. */
function workdayInfoHit(text: string, kind: FieldKind, qualifiers: string): LabelRuleHit | null {
  for (const rule of WORKDAY_INFO_RULES) {
    if (rule.re.test(text) && kindAllowed(rule.category, kind)) return hitOf(rule, rule.category);
  }
  if (GPA_QUALIFIER.test(qualifiers.trim()) && RESULT_WORD.test(text) && kindAllowed('education.gpa', kind)) {
    return hitOf(GPA_RULE, 'education.gpa');
  }
  return null;
}

// end s2 core-wd

// ── jr6 RULES (FIXPLAN §6.3 R1): the eight platform audits' wordings, each from an owner's snapshot ─────────────────

/** ICIMS-09, O7: the place categories of the home address, a job's and a school's. */
const ENTRY_PLACE: Readonly<Record<EntryKind | 'home', { city: FieldCategory; region: FieldCategory;
  country: FieldCategory }>> = {
  home: { city: 'address.city', region: 'address.region', country: 'address.country' },
  experience: { city: 'experience.city', region: 'experience.region', country: 'experience.country' },
  education: { city: 'education.city', region: 'education.region', country: 'education.country' },
};

/** JV-1 (Jobvite's "Today's Date", read with the adapter's "signature" after it), workday-new-1 (Workday's Self
 *  Identify date, "Date signed" by the label contract of FIXPLAN §3.2), JZ-15 (JazzHR's disability signature date, no
 *  capture): the date that goes with a signature. jr6 fix (RULES-R11, IC-R1: iCIMS's IForm dates drawn in parts, "<base
 *  label> month/day/year" by the label contract of FIXPLAN §3.2: Edgewater's and Sentinel's "Today's Date month",
 *  fixtures edgewater-self-id-veteran.frame-2, jr6-sentinel-iform-selfid.frame-2; NYU's "Date" with the adapter's
 *  "signature" before the part, nyu-self-id-disability.frame-2): or one part of it (captured). */
const SIGNATURE_DATE = /^(?:todays?\s+date|current\s+date|date\s+signed|signature\s+date|date\s+of\s+signature|signed\s+on|date)\s+signature(?:\s+(month|day|year))?$|^(?:todays?\s+date|date\s+signed|signature\s+date|date\s+of\s+signature|date\s+signed\s+on)(?:\s+(month|day|year))?$/;
/** workday-new-1 (Workday's disability form "Language", "Language of this form" by the label contract): the language
 *  the form itself is in, never the person's languages. */
const FORM_LANGUAGE = /^(?:the\s+)?language\s+of\s+(?:this|the)\s+(?:form|document|survey|questionnaire)$|^(?:form|document)\s+language$/;
/** jr7 RULES-7 R2 (WD7V-02, Workday's aristocrat required "What is your preferred language for written
 *  communications?", snapshot7 workday1): the language the person prefers to be written to in. */
const PREFERRED_LANGUAGE = /^(?:what\s+is\s+)?(?:your\s+)?preferred\s+language(?:\s+(?:for|of)\s+(?:written\s+)?(?:communications?|correspondences?|contact))?$/;
/** workday-new-1 (Workday's Self Identify "Employee ID (if applicable)"): an employer's own number for the person,
 *  which the profile never holds. */
const EMPLOYEE_ID = /^(?:your\s+)?(?:current\s+)?employee\s+(?:id|identification|number|no|num)(?:\s+(?:number|no))?$/;
/** JV-3 (Jobvite's "County of Residence"), WD-26 (Workday's Address "County"), ADP-14 (ADP's "County"), O3 (Oracle's
 *  "County"): the word county, never "country", asked for, not as a yes or no. jr6 fix (RULES-R13): a county's own
 *  label only ("County", "County of Residence", "County Name", "County or Parish", "Home County"); never a region's
 *  label that names a county among a state, province or country ("County/State/Province", "State or County"), nor a
 *  county of employment or a preference ("Which counties are you willing to work in?"): those go to the AI as before. */
const COUNTY = /^(?:(?:your|current|home|residence|residential|resident)\s+)*county(?:\s+(?:or|and)\s+(?:parish|borough))?(?:\s+(?:name|of\s+(?:your\s+)?(?:current\s+)?(?:residence|home|address)))?$/;
/** JV-9 (Jobvite's consent gate, "Location of Residence and Language", the label contract): the residence a privacy
 *  policy is chosen by. */
const POLICY_RESIDENCE = /^(?:your\s+)?(?:location|country|region)\s+of\s+residence\s+and\s+language$/;
/** JV-15 (NinjaOne's "Were you referred to this role by a current NinjaOne employee?"), ADP-19 ("Did any of our
 *  employees inform you about this position?"), U-11 (UltiPro's "Were you referred by a current employee?"): whether
 *  an employee of the company referred the person, asked yes or no. */
const REFERRED_BY_EMPLOYEE = /\b(?:were|was)\s+you\s+referred\b(?:\s+\w+){0,5}?\s+by\s+(?:an?\s+|any\s+|one\s+of\s+our\s+|our\s+)?(?:current\s+)?(?:\w+\s+){0,2}?employees?\b|\b(?:did|has|have)\s+(?:any(?:one)?\s+(?:of\s+)?)?(?:our|the|its|a|an)\s+(?:current\s+)?employees?\s+(?:\w+\s+){0,2}?(?:inform\w*|tell|told|refer\w*|recommend\w*|notif\w*)\s+you\b/;
/** JV-17 (VHL's "Question 10: If within commutable distance to Boston, MA, are you willing and able to work the Hybrid
 *  schedule …", NinjaOne's "If you live in Illinois, is your address in the City of Chicago?"): a question asked only
 *  of those who live in, or within reach of, a place it names (captured: the place). */
const RESIDES_IN = /^(?:question\s+\d+\s+)?if\s+(?:(?:you\s+(?:currently\s+)?(?:live|reside)\s+in)|(?:you\s+are\s+)?(?:with)?in\s+(?:a\s+)?commut\w*\s+distance\s+(?:to|of|from))\s+(.+?)\s+(?:is|are|do|does|will|would|can|could|have|has|please|what|which|how)\b/;
/** U-02 (UltiPro's period boxes, "From Month", "From Year (YYYY)", "To Month", "To Year (YYYY)" by the label contract):
 *  a part of a job's or a school's start (from) or end (to). */
const PERIOD_PART = /^(from|to)\s+(?:month|year)\b/;
/** jr6 RULES R2 (WD-30, Workday's AEP "Will you be using Optional Practical Training (OPT) or STEM OPT to begin
 *  employment at AEP?", fixtures/workday/aep-application-questions-2): OPT or CPT to begin or continue employment. */
/** jr6 RULES R3 (WD-29, Workday's AEP "Do you have military training or a military certification related to this
 *  position?", fixtures aep-application-questions-2): military training or a certification for the role, a
 *  qualification, never the veteran's self-identification. */
export const MILITARY_TRAINING = /\bmilitary\s+(?:training|certifications?|qualifications?)\b(?:\s+\w+){0,8}?\s+(?:related|relevant|applicable)\s+to\s+(?:this|the)\s+(?:position|role|job)\b/;
/** jr6 RULES R3 (ICIMS-21: Sentinel's "What state are you physically located in today?", fixtures
 *  jr6-sentinel-job-questions; JV-8: NinjaOne's "In which state do you currently live?", fixtures/jobvite/ninjaone-step3;
 *  JZ-9: "What state do you live in?", "state of residence"): the state the person lives in. */
// jr7 RULES-7 (J7-GH-2, Greenhouse's "What US state do you reside in?", snapshot7 greenhouse): a country's state.
const RESIDENCE_STATE = /^(?:in\s+)?(?:which|what)\s+(?:(?:u\s?s|united\s+states|american)\s+)?state\s+(?:do|are)\s+you\s+(?:(?:currently|physically|presently|now)\s+)*(?:live|reside|located|based|living|residing)(?:\s+in)?(?:\s+(?:today|now|currently|at\s+present))?$|^(?:your\s+|current\s+|present\s+)*state\s+of\s+(?:current\s+)?residen(?:ce|cy)$/;
/** jr6 RULES R3 (JZ-9: WellHive's "From which state will you be working?", fixtures/jazzhr/wellhive-submitting): the
 *  state the person will work from, read as the one they live in (an inference: flagged, resolve.ts). */
const WORK_STATE = /^(?:from\s+)?(?:which|what)\s+state\s+will\s+you\s+be\s+working(?:\s+from)?$|^(?:which|what)\s+state\s+(?:do|will)\s+you\s+(?:plan\s+to\s+)?work\s+(?:from|in)$/;
/** jr6 RULES R3 (ICIMS-26: ARS's "Time Zone", fixtures jr6-ars-profile): the person's time zone. */
const TIME_ZONE = /^(?:(?:your|current|preferred|local|home)\s+)*time\s?zone$|^(?:what|which)\s+time\s?zone\s+(?:are\s+you\s+(?:currently\s+)?(?:in|located\s+in|based\s+in)|do\s+you\s+(?:currently\s+)?(?:live|work|reside)\s+in)$/;
/** jr6 RULES R3 (JV-16: VHL's "Question 9: Do you currently reside in a state located within the Eastern US Time
 *  Zone?", fixtures jr6-vhl-step3-filled): whether the person lives in a US time zone (its name captured). */
export const IN_TIME_ZONE = /\b(?:reside|resides|residing|live|lives|living|located|based)\b(?:\s+\w+){0,6}?\s+(?:within|in)\s+(?:the\s+)?(eastern|central|mountain|pacific|alaska|hawaii)\s+(?:us\s+|u\s+s\s+)?time\s?zone\b/;
/** jr6 RULES R3 (JV-16: VHL's "Question 2: Do you have 10+ years of work experience in Engineering?", "Question 3: Do
 *  you have 5+ years' work experience in a DevOps role?"): N years of experience in or as something (N and it
 *  captured). */
export const YEARS_IN = /^(?:do|have)\s+you\s+(?:have\s+)?(?:at\s+least\s+|a\s+minimum\s+of\s+)?(\d{1,2})\s+(?:or\s+more\s+)?years?\s+(?:of\s+)?(?:(?:professional|relevant|hands\s+on|work|working|industry)\s+)*experience\s+(?:in|as|with|working\s+(?:in|as|with))\s+(.+)$/;
/** jr6 RULES R3 (JV-16: VHL's "Question 4: Do you have experience with …?"): experience with or using a tool (it
 *  captured), no number of years; never "experience in" a field ("in marketing": the AI's, as before). jr6 fix
 *  (RULES-R48-EXPERIENCE-WITH-USING, REVC-8): VHL's own wording "experience with using Terraform" captures the tool, not
 *  "using terraform". */
export const EXPERIENCE_WITH = /^(?:do|have)\s+you\s+(?:have\s+)?(?:any\s+)?(?:(?:prior|previous|professional|hands\s+on|practical)\s+)*experience\s+(?:with\s+(?:using\s+)?|using\s+|working\s+with\s+)(.+)$/;
/** jr6 RULES R3: what experience with a tool is never asked about: a self-identification, legal, pay or consent topic
 *  ("experience with sponsorship sales", "racial equity programs": the person's own, as the sensitive screen reads them),
 *  a government's or another client's work (the AI's, as before). */
const EXPERIENCE_WITH_NOT = /\b(?:disabilit\w*|disabled|veterans?|military|race|races|racial|ethnic\w*|hispanic|latin[oax]|gender|sex|sexual|transgender|lgbt\w*|pronouns?|citizen\w*|nationalit\w*|visas?|sponsor\w*|immigra\w*|criminal|convict\w*|felon\w*|religio\w*|pregnan\w*|salar(?:y|ies)|compensation|pay|payroll|wages?|consent\w*|government|federal|clients?|customers?)\b/;
const OPT_WORK = /\b(?:(?:stem\s+)?opt|cpt|optional\s+practical\s+training|curricular\s+practical\s+training)\b(?:\s+\w+){0,8}?\s+(?:to|in\s+order\s+to)\s+(?:begin|start|continue|commence|extend)\s+(?:\w+\s+){0,2}?(?:employment|working|work)\b/;
/** jr6 RULES R3 (ADP-7: ADP's "Select currency type", fixtures/adp/questions): the currency the person is paid in, asked
 *  for; never a yes or no about one, nor a currency as a field of work ("currency trading"). */
const CURRENCY = /\bcurrency\b/;
const CURRENCY_NOT = /\bcurrency\s+(?:trading|exchange|markets?|risk|conversion|hedging|operations|management)\b|\bforeign\s+currency\b/;
/** jr6 fix (RULES-R51): on a text box, only a label that is the currency itself ("Currency", "Desired Salary currency",
 *  "Currency code"): "What is your expected salary? Please specify the currency." asks for the pay, in a currency. */
const CURRENCY_ALONE = /^(?:(?:select|choose|enter|your|the|preferred|desired|expected|salary|pay|compensation|wage|rate)\s+)*currency(?:\s+(?:type|code))?$/;
/** jr6 RULES R3 (JZ-11: JazzHR's "Will you be working from inside the United States?" on invaluable-form, "Are you able
 *  to work remotely from a state within the United States?" on wellhive-submitting; "Do you currently reside in the
 *  United States?"): whether the person lives or will work inside the place named last (a country: policy.ts
 *  inCountryValue reads it), asked yes or no; never a county, a city, an area or a state ("Do you currently reside in Los
 *  Angeles County?", "in the Denver Metro area?": the AI's, as before). */
export const IN_COUNTRY = /^(?:will|would|do|are|can|could)\s+you\s+(?:\w+\s+){0,4}?(?:(?:live|living|reside|residing|located|based)\b(?:\s+\w+){0,5}?\s+(?:inside|within|in)|(?:work|working)\b(?:\s+\w+){0,4}?\s+(?:inside|within|from\s+(?:\w+\s+){0,3}?(?:inside|within|in)))\s+(?:the\s+)?(?!(?:a|an|any|one|this|that|our|your|which|what)\b)(?!(?:\w+\s+){0,3}?(?:county|counties|area|metro|metropolitan|city|town|region|district|borough|parish|state|province|office|campus)\b)(\w+(?:\s+\w+){0,3})$/;
/** jr7 RULES-7 R2 (RBP7-08, Rippling's required "<employer> can only hire candidates with a primary residence in the
 *  following States: AZ, CA, … TX, …", snapshot7 rippling1; BambooHR's "Do you currently reside in one of the states
 *  where <employer> is au…", snapshot7 bamboohr2): whether the person lives in one of the states a question lists. */
const IN_LISTED_REGIONS = /\b(?:residen(?:ce|cy|t|ts)|resides?|reside|live|lives|located|based)\b(?:\s+\w+){0,4}?\s+in\s+(?:one\s+of\s+)?the\s+(?:following|listed|below)\s+(?:states|provinces|regions)\b|\b(?:reside|live|located|based)\s+in\s+one\s+of\s+the\s+(?:states|provinces)\s+(?:where|in\s+which|listed|below)\b/;
/** jr6 RULES R3 (JZ-11): never a preference, a move, a commute or travel ("Are you willing to relocate to the United
 *  States?"), and never the right to work there (work authorization's own question). */
const IN_COUNTRY_NOT = /\b(?:willing|open|prepared|happy|want|wish|like|prefer|plan|planning|intend|intending|relocat\w*|move|moving|commut\w*|travel\w*|authori[sz]\w*|eligib\w*|permit\w*|entitled|right|legal\w*|lawful\w*|citizen\w*|visas?|sponsor\w*|resident|residency|remote\s+role)\b/;
/** jr6 RULES R3 (U-11: UltiPro's "Former Name", fixtures/ultipro/application and resume-review): a former, previous,
 *  prior, maiden or other name, which the profile never holds: left as the page has it, never asked of an AI. */
const FORMER_NAME = /^(?:(?:your|any)\s+)?(?:former|previous|prior|maiden|other)\s+(?:(?:last|first|legal|family|full)\s+)?names?(?:\s+(?:used|if\s+any|if\s+applicable))*$|^name\s+at\s+birth$/;
/** jr6 RULES R4 (WD-25: Workday's "Prefix" in Legal Name, fixtures resolvetech-source-open, s2-exelixis-state-open): a
 *  name's prefix, salutation or honorific, which the profile never holds (classifyRules reads a "Title" whose options
 *  are honorifics so). */
const PREFIX = /^(?:(?:name|your)\s+)?(?:prefix|salutation|honorific)(?:\s+name)?$/;
/** jr6 RULES R4 (ICIMS-25: NYU's iCIMS "Did You Graduate?" in an education block, fixtures jr6-nyu-profile-parsed): the
 *  entry's graduation, asked yes or no. */
const GRADUATED = /^(?:did|have)\s+you\s+graduated?(?:\s+from\s+(?:this|the)\s+(?:school|program|institution|university|college))?$|^graduated$/;
/** jr6 RULES R4 (ADP-14: ADP's "Address Line 3", fixtures/adp/personal; Oracle's, hjf-apply-section): an address's third
 *  line, which the profile never holds. */
const ADDRESS_LINE3 = /^(?:street\s+)?address\s+(?:line\s*)?3$/;
/** jr6 RULES R4 (ADP-16: ADP's desired-salary Annually | Hourly radios, "<block title> pay basis" by the label contract
 *  of FIXPLAN §3.2): the period the pay is asked in. jr6 fix (RULES-R68-PAY-BASIS-NEAR-MISS): only a label that ends
 *  with it ("… pay basis", "Desired Salary period"); a pay frequency asked for ("Please indicate your preferred pay
 *  frequency", how often payroll pays) is no period of the expected pay. */
// jr7 RULES-7 (ICIMS7-V3, iCIMS's arc-onesolutions "Desired Salary" Time Frame select, "Desired Salary time frame" by the
// label contract of FIX7PLAN §3.3, snapshot7 iCIMS1): or its time frame.
const PAY_BASIS = /\b(?:pay|salary|compensation|wage|rate)\s+(?:basis|period|time\s*frame)$/;
/** jr6 RULES R4 (ADP-18: ADP's "How would you like to provide the candidate's resume?", Upload File | Enter Professional
 *  Details, fixtures jr6-resume-choice): how the résumé is given, chosen; never a consent. */
const RESUME_METHOD = /\bhow\s+(?:would|do|will|can)\s+you\s+(?:like\s+to\s+|want\s+to\s+|prefer\s+to\s+)?(?:provide|submit|share|send|add|give|attach|upload)\s+(?:the\s+candidates?\s+|your\s+|a\s+|the\s+)?(?:resume|cv)\b/;
/** jr6 RULES R4 (ADP-20: ADP's "Are you a high school graduate or passed the GED?", fixtures jr6-questions2-blank): a
 *  high-school diploma or its equivalent, asked yes or no. */
const HIGH_SCHOOL = /\bhigh\s+school\s+(?:graduate|diploma|degree|education)\b|\bged\b|\bg\s+e\s+d\b/;
/** jr6 fix (RULES-R70): what may stand between two of HIGH_SCHOOL's phrases ("… graduate or passed the GED"), and after
 *  the last ("… diploma or (its) equivalent"); anything else asks for more than the diploma. */
const DIPLOMA_BETWEEN = /^\s+or\s+(?:(?:have\s+|has\s+)?(?:passed|completed|obtained|earned|received|hold|have)\s+)?(?:the\s+|a\s+|an\s+|its\s+)?$/;
const DIPLOMA_AFTER = /^(?:\s+or\s+(?:(?:have\s+|has\s+)?(?:passed|completed|obtained|earned|received|hold|have)\s+)?(?:the\s+|a\s+|an\s+|its\s+)?(?:equivalent|equivalency|high\s+school\s+equivalency|ged|g\s+e\s+d)(?:\s+(?:diploma|certificate|degree|test|exam|education))?)*\s*$/;
/** jr6 fix (RULES-R70: "Do you have a high school diploma and a valid driver's license?", VHL's "Question 1: Do you have
 *  a minimum of a High School diploma or GED along with relevant/required work experience?"): whether a question asks
 *  for the diploma (or its equivalent) and nothing more; a compound question is the AI's, as before. */
function asksDiplomaAlone(text: string): boolean {
  const found = [...text.matchAll(new RegExp(HIGH_SCHOOL.source, 'g'))];
  if (found.length === 0) return false;
  const first = found[0]!;
  const last = found.at(-1)!;
  if (/\b(?:and|with|along|plus|also)\b/.test(text.slice(0, first.index))) return false;
  for (let at = 1; at < found.length; at += 1) {
    const before = found[at - 1]!;
    if (!DIPLOMA_BETWEEN.test(text.slice(before.index + before[0].length, found[at]!.index))) return false;
  }
  return DIPLOMA_AFTER.test(text.slice(last.index + last[0].length));
}
/** jr6 RULES R4 (JV-19: VHL's "Mailing Address, if different from above", fixtures jr6-vhl-step1): a second address
 *  asked only where it differs, which the profile never holds. */
const ADDRESS_IF_DIFFERENT = /\b(?:mailing|postal|address)\b(?:\s+\w+){0,4}?\s+if\s+(?:it\s+is\s+)?different\s+(?:from|than)\s+(?:the\s+)?(?:above|home|current|permanent|residential|physical|your)\b/;
/** jr6 RULES R4 (SR-13: SmartRecruiters' "Facebook", fixtures/smartrecruiters/xplor-one-click): a Facebook link's own
 *  box; Jobright keeps only a facebook.com address there (cited). */
const FACEBOOK = /^(?:your\s+)?facebook(?:\s+(?:profile|page|url|link|username|user\s+name|handle|account))*$/;

/** A jr6 label rule: its pattern, the category (or none, for a section or kind it does not fit). */
interface Jr6Rule {
  id: string;
  re: RegExp;
  unless?: RegExp;
  category: FieldCategory | ((ctx: RuleCtx, found: RegExpExecArray) => FieldCategory | null);
  strength: RuleStrength;
}

/** The jr6 rules, tried in order before §8.3's list, each on a kind its category holds. */
const JR6_RULES: readonly Jr6Rule[] = [
  // jr6 fix (RULES-R11): a list takes one part of the date (its month or its day), never the whole date.
  { id: 'label.signature-date', re: SIGNATURE_DATE, strength: 'strong', category: (c, found) => ((c.kind === 'select'
    || c.kind === 'combobox') && (found[1] ?? found[2]) === undefined ? null : 'consent.signatureDate') },
  { id: 'label.form-language', re: FORM_LANGUAGE, category: 'languages.formLanguage', strength: 'strong' },
  // jr7 RULES-7 R2 (WD7V-02).
  { id: 'label.preferred-language', re: PREFERRED_LANGUAGE, category: 'languages.preferred', strength: 'normal' },
  { id: 'label.employee-id', re: EMPLOYEE_ID, category: 'identity.employeeId', strength: 'strong' },
  { id: 'label.county', re: COUNTY, unless: YES_NO_QUESTION, category: 'address.county', strength: 'normal' },
  { id: 'label.policy-residence', re: POLICY_RESIDENCE, category: 'location.policyResidence', strength: 'strong' },
  { id: 'label.employee-referred', re: REFERRED_BY_EMPLOYEE, category: 'referral.employeeReferred',
    strength: 'normal' },
  { id: 'label.resides-in', re: RESIDES_IN, category: 'location.residesIn', strength: 'normal' },
  // U-02: by the section's kind (sectionKindOf); in any other section the part names no date the profile holds.
  { id: 'label.period-part', re: PERIOD_PART, strength: 'normal', category: (c, found) => (c.section === 'other' ? null
    : found[1] === 'from' ? `${c.section}.startDate` : `${c.section}.endDate`) },
  // jr6 RULES R2 (WD-30).
  { id: 'label.opt', re: OPT_WORK, category: 'workAuth.opt', strength: 'strong' },
  // jr6 RULES R3 (WD-29, ICIMS-21, JV-8, JZ-9, ICIMS-26, JV-16).
  { id: 'label.military-training', re: MILITARY_TRAINING, category: 'screening.militaryTraining', strength: 'normal' },
  { id: 'label.residence-state', re: RESIDENCE_STATE, category: 'address.region', strength: 'normal' },
  { id: 'label.work-state', re: WORK_STATE, category: 'address.region', strength: 'normal' },
  // jr6 fix (RULES-R48-TZ): the label is the time zone's own and nothing else (anchored), as strong as the form's
  // language's, so a search may choose a single zone's result (frame.ts: a remote typeahead chooses in the fill band).
  { id: 'label.time-zone', re: TIME_ZONE, category: 'preferences.timeZone', strength: 'strong' },
  { id: 'label.in-time-zone', re: IN_TIME_ZONE, category: 'location.inTimeZone', strength: 'normal' },
  { id: 'label.years-in', re: YEARS_IN, category: 'experience.yearsIn', strength: 'normal' },
  { id: 'label.experience-with', re: EXPERIENCE_WITH, unless: EXPERIENCE_WITH_NOT, category: 'skills.experienceWith',
    strength: 'normal' },
  // jr6 RULES R3 (ADP-7, JZ-11, U-11).
  // jr6 fix (RULES-R51): the word anywhere on a list (FIXPLAN item 51: select, combobox); on a text box only the
  // currency's own label (CURRENCY_ALONE), never a pay question that asks for its currency too.
  { id: 'label.currency', re: CURRENCY, unless: new RegExp(`${YES_NO_QUESTION.source}|${CURRENCY_NOT.source}`),
    category: (c) => (c.kind === 'text' && !CURRENCY_ALONE.test(c.label) ? null : 'salary.currency'),
    strength: 'normal' },
  { id: 'label.in-country', re: IN_COUNTRY, unless: IN_COUNTRY_NOT, category: 'location.inCountry', strength: 'normal' },
  // jr7 RULES-7 R2 (RBP7-08).
  { id: 'label.in-listed-regions', re: IN_LISTED_REGIONS, category: 'location.inListedRegion', strength: 'normal' },
  { id: 'label.former-name', re: FORMER_NAME, category: 'identity.formerName', strength: 'strong' },
  // jr6 RULES R4 (WD-25, ICIMS-25, ADP-14, ADP-16, ADP-18, ADP-20, JV-19, SR-13).
  { id: 'label.prefix', re: PREFIX, category: 'identity.prefix', strength: 'strong' },
  { id: 'label.graduated', re: GRADUATED, category: 'education.graduated', strength: 'normal' },
  { id: 'label.address3', re: ADDRESS_LINE3, category: 'address.line3', strength: 'strong' },
  { id: 'label.pay-basis', re: PAY_BASIS, category: 'salary.period', strength: 'normal' },
  { id: 'label.resume-method', re: RESUME_METHOD, category: 'application.resumeMethod', strength: 'normal' },
  // jr6 fix (RULES-R70): only a question of the diploma alone (asksDiplomaAlone).
  { id: 'label.high-school', re: HIGH_SCHOOL, category: (c) => (YES_NO_QUESTION.test(c.label)
    && asksDiplomaAlone(c.label) ? 'education.highSchool' : null), strength: 'normal' },
  { id: 'label.address-if-different', re: ADDRESS_IF_DIFFERENT, category: 'address.mailing', strength: 'normal' },
  { id: 'label.facebook', re: FACEBOOK, category: 'links.facebook', strength: 'strong' },
];

/** The first jr6 rule that reads `text` on a field of this kind, or null. */
function jr6Hit(text: string, ctx: RuleCtx): LabelRuleHit | null {
  for (const rule of JR6_RULES) {
    const found = rule.re.exec(text);
    if (found === null || (rule.unless?.test(text) ?? false)) continue;
    const category = typeof rule.category === 'function' ? rule.category(ctx, found) : rule.category;
    if (category !== null && kindAllowed(category, ctx.kind)) return hitOf(rule, category);
  }
  return null;
}

/** JV-17: the place a question asks only its residents about ("illinois", "boston ma"), as normalized words, and
 *  whether it asks of those within commuting distance (rather than living there); null for any other label. */
export function residencePlaceOf(text: string): { place: string; commute: boolean } | null {
  const found = RESIDES_IN.exec(text);
  return found === null ? null : { place: found[1]!, commute: /\bcommut/.test(found[0]) };
}

/** U-09 (UltiPro's "I decline to say" boxes beside its EEO lists, "<question> I decline to say" by the label contract)
 *  and ADP-17 (ADP's "I decline to identify my race and ethnicity"): a lone box that declines a self-identification
 *  question, by its own topic. */
const DECLINE_BOX = /\b(?:i\s+)?(?:decline|refuse|prefer\s+not|do\s+not\s+wish|dont\s+wish|choose\s+not|would\s+rather\s+not)\s+to\s+(?:say|answer|identify|self\s+identify|disclose|state|specify|provide|respond)\b/;
/** The self-identification topics a decline box names, in the order a box naming two is read by. */
const DECLINE_BOX_TOPICS: ReadonlyArray<readonly [RegExp, FieldCategory]> = [
  [/\b(?:race|races|racial)\b/, 'eeo.race'],
  [/\bethnic\s+origin\b|\bhispanic\b|\blatin[oax]\b/, 'eeo.hispanicLatino'],
  [/\bethnic\w*\b/, 'eeo.race'],
  [/\bgender\b|\bsex\b/, 'eeo.gender'],
  [/\bveterans?\b|\bmilitary\b/, 'eeo.veteran'],
  [/\bdisabilit(?:y|ies)\b/, 'eeo.disability'],
];
export const EEO_DECLINE_BOX_RULE = { id: 'label.eeo-decline-box', strength: 'strong' } as const;

/** U-09, ADP-17: the self-identification topics a lone box declines (DECLINE_BOX), the first its category; [] for a box
 *  that declines nothing of the kind. */
export function declineBoxTopics(text: string): FieldCategory[] {
  if (!DECLINE_BOX.test(text)) return [];
  return [...new Set(DECLINE_BOX_TOPICS.filter(([re]) => re.test(text)).map(([, category]) => category))];
}

/** jobvite-new-1 (Sikich's "Are you currently subject to a non-compete, non-solicitation or any other restrictive
 *  employment agreement?"): a restrictive agreement asked as a fact, or one that names a non-compete, a
 *  non-solicitation, an employment or a confidentiality agreement: there "agreement" names a contract the person may
 *  hold, never a consent the run gives (classify.ts openTopicsOfTexts, plan/answers.ts). */
export function namesRestrictiveAgreement(text: string): boolean {
  return restrictiveAgreementFact(text) || NAMED_AGREEMENT.test(text);
}

/** jobvite-new-1: a restrictive agreement asked as a fact ("Are you currently subject to a non-compete …?"): a
 *  question about a contract the person may hold, never an ask to take one on (namesBindingWaiver), so an AI may answer
 *  it in the `all` scope (plan/answers.ts namesUnanswerableTopic). An ask to agree to one stays the binding waiver. */
export function restrictiveAgreementFact(text: string): boolean {
  return RESTRICTIVE_TOPIC.test(text) && RESTRICTIVE_FACT.test(text);
}
const NAMED_AGREEMENT = /\b(?:non\s?compet\w*|noncompet\w*|non\s?solicit\w*|nonsolicit\w*|restrictive|employment|confidentiality|non\s?disclosure)\s+(?:\w+\s+){0,2}?agreements?\b/;

// jr6 RULES end

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
function refinedMatch(rule: LabelRule, text: string, questions?: string, kind?: FieldKind): 'match' | 'turned-away'
  | null {
  const refinement = REFINEMENTS[rule.id];
  const also = kind !== undefined && refinement?.alsoFor !== undefined ? refinement.alsoFor(kind) : refinement?.also;
  if (!rule.re.test(text) && !(also?.test(text) ?? false)) return null;
  if (refinement === undefined) return 'match';
  const unlessText = refinement.unlessQuestionsOnly === true && questions !== undefined ? questions : text;
  if (refinement.unless?.test(unlessText)) return 'turned-away';
  const only = refinement.only;
  if (only !== undefined && !only.test(refinement.ask ? text.replace(ASK, '') : text)) return 'turned-away';
  // jr6 RULES R3 (U-11): a kind's own narrower reading.
  const onlyKind = kind === undefined ? undefined : refinement.onlyFor?.(kind);
  if (onlyKind !== undefined && !onlyKind.test(text)) return 'turned-away';
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
function consentEntries(text: string, kind?: FieldKind): ConsentEntry[] {
  const entries: ConsentEntry[] = [];
  const add = (rule: LabelRule, category: FieldCategory) => {
    if (!entries.some((entry) => entry.category === category)) entries.push({ rule, category });
  };
  for (const rule of SPECIFIC_CONSENT_RULES) {
    if (refinedMatch(rule, text, undefined, kind) === 'match') add(rule, rule.category as FieldCategory);
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

/** The core pass of 2026-11-06: the hit for an "I did not use AI" statement a field's own label makes past the 300
 *  characters the worker sees (FieldSpec.statesNoAi; Dropzone's AI policy): label.consent-ai's on a field of `kind`, as
 *  consentVerdict gives it there (the person's where the kind cannot hold an AI attestation). */
export function noAiStatementHit(kind: FieldKind): LabelRuleHit {
  return consentVerdict([{ rule: AI_CONSENT_RULE, category: 'consent.aiAttestation' }], kind);
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
  if (context.entry !== undefined) ctx.entry = context.entry;
  // An experience block's own "Summary" or "Description" is the role's description (the Phase 7a review).
  if (section === 'experience' && context.block !== undefined && EXPERIENCE_DESCRIPTION.test(text)
    && kindAllowed('experience.description', kind)) {
    return hitOf(EXPERIENCE_DESCRIPTION_RULE, 'experience.description');
  }
  // jr7 RULES-7 R2: an entry's own fields (entryFieldHit).
  const entryField = entryFieldHit(text, section, kind, context);
  if (entryField !== null) return entryField;
  // s2 core-gh (decision 11): a nationality asked by country takes the person's citizenships, before the pre-rule that
  // hands every nationality question over.
  const withQualifiers = ctx.qualifiers === '' ? text : `${text} ${ctx.qualifiers}`;
  if (CITIZENSHIP_ASKED.test(withQualifiers) && !NOT_CITIZENSHIP.test(withQualifiers) && !YES_NO_QUESTION.test(text)
    && kindAllowed('workAuth.citizenship', kind)) {
    return hitOf(CITIZENSHIP_RULE, 'workAuth.citizenship');
  }
  for (const rule of PRE_RULES) {
    const own = rule.questionsOnly === true && context.questions !== undefined ? context.questions : text;
    const reads = rule.readsQualifiers && ctx.qualifiers !== '' ? [own, `${own} ${ctx.qualifiers}`] : [own];
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
  // s2 core-gh: a restrictive agreement asked as a fact is the person's own answer (screening.restrictiveAgreement),
  // never the binding waiver an ask to agree to one is.
  if (RESTRICTIVE_TOPIC.test(withQualifiers) && RESTRICTIVE_FACT.test(text)
    && kindAllowed('screening.restrictiveAgreement', kind)) {
    return hitOf(RESTRICTIVE_RULE, 'screening.restrictiveAgreement');
  }
  // jr7 RULES-7 (UP7-08, UltiPro's required textarea "Are you currently subject to any non-competition,
  // non-solicitation …?", snapshot7 ultipro1): asked as a fact in a box of prose it is still the restrictive agreement,
  // before the waiver rule claims it: a legal question on a kind that cannot hold its Yes or No (kind-mismatch), which
  // stays the person's (legal-not-in-profile) unless TailorIT's AI answers it, marked an AI guess (GUESS_ONLY).
  if (RESTRICTIVE_TOPIC.test(withQualifiers) && RESTRICTIVE_FACT.test(text) && (kind === 'text' || kind === 'textarea')) {
    return { ...hitOf(RESTRICTIVE_RULE, 'screening.restrictiveAgreement'), needsUser: 'kind-mismatch' };
  }
  if (kind !== 'checkbox' && namesBindingWaiver(text)) {
    return { ...hitOf(BINDING_WAIVER_RULE, 'consent.other'), consentKinds: ['consent.other'],
      needsUser: 'binding-waiver' };
  }
  // jr6 RULES (U-09, ADP-17): a lone box that declines a self-identification question is that question's, never a
  // consent: its tick is the person's explicit decline (policy.ts eeoDeclineBoxValue, plan/eeoDeclineBox.ts).
  if (kind === 'checkbox') {
    const declined = declineBoxTopics(text)[0];
    if (declined !== undefined) return hitOf(EEO_DECLINE_BOX_RULE, declined);
  }
  // Consent first only for wording that consents: a box that names a consent topic and nothing more ("Willing to
  // travel for marketing events") keeps §8.3's order, where the consent rules come last.
  const asksConsent = CONSENT_ASK.test(text);
  if ((kind === 'checkbox' || kind === 'radio') && (asksConsent || attestationFor(kind).test(text))) {
    if (criminalClaim(text)) return hitOf(CRIMINAL_RULE, 'screening.criminalHistory');
    const entries = consentEntries(text, kind);
    if (entries.length > 0) return consentVerdict(entries, kind);
  }
  // Which work authorization status (the Phase 7a review), before the design's authorization rule reads it as yes or
  // no.
  if (WORK_AUTH_STATUS.test(text) && kindAllowed('workAuth.status', kind)) {
    return hitOf(WORK_AUTH_STATUS_RULE, 'workAuth.status');
  }
  // jr6 RULES (JV-7): the type of an authorization or a visa, never beside a sponsorship.
  if (WORK_AUTH_TYPE.test(text) && !/\bsponsor\w*/.test(text) && kindAllowed('workAuth.status', kind)) {
    return hitOf(WORK_AUTH_STATUS_RULE, 'workAuth.status');
  }
  // s2 core-gh: the snapshot round's own rules (S2_RULES), and a consent to an identity check asked as a question
  // (decision 10), which the Consents mode decides as a consent asked as a choice (classifyRules consentChoice).
  const asked = text.replace(ASK, '');
  for (const rule of S2_RULES) {
    if ((rule.re.test(text) || rule.re.test(asked)) && !(rule.unless?.test(text) ?? false)
      && kindAllowed(rule.category, kind)) {
      return hitOf(rule, rule.category);
    }
  }
  if (CHECK_CONSENT.test(text)) {
    return consentVerdict([{ rule: { ...CHECK_CONSENT_RULE, re: CHECK_CONSENT, category: 'consent.other' },
      category: 'consent.other' }], kind);
  }
  // s2 core-wd: Workday's My Information (WORKDAY_INFO_RULES).
  const info = workdayInfoHit(text, kind, ctx.qualifiers);
  if (info !== null) return info;
  // jr6 RULES: the eight platform audits' wordings (JR6_RULES).
  const jr6 = jr6Hit(text, ctx);
  if (jr6 !== null) return jr6;
  for (const rule of LABEL_RULES) {
    if (DATE_RULES.has(rule.id) && section === 'other' && context.block !== undefined) continue;
    // jr7 RULES-7 (ICIMS7-06): a list of a Yes and a No is never the skills list.
    if (rule.id === 'label.skills' && context.yesNoOptions === true) continue;
    const verdict = refinedMatch(rule, text, context.questions, kind);
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
      const entries = consentEntries(text, kind);
      if (entries.length > 0) return consentVerdict(entries, kind);
      return consentVerdict([{ rule, category }], kind);
    }
    // s2 core-gh (decision 11): a yes/no legal question takes a text box only when it is asked as yes or no.
    if (!kindAllowed(category, kind) || (kind === 'text' && TYPED_YES_NO.has(category) && !YES_NO_QUESTION.test(text))) {
      if (STOPPING_CLASSES.includes(policy)) return { ...hitOf(rule, category), needsUser: 'kind-mismatch' };
      continue;
    }
    return hitOf(rule, category);
  }
  // s2 core-gh: tools used asked as a list (S2_LATE_RULES).
  for (const rule of S2_LATE_RULES) {
    if (rule.re.test(text) && kindAllowed(rule.category, kind)) return hitOf(rule, rule.category);
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
  // jr7 RULES-7 R2 (UKGR-18, UKG Ready's "Please type your full name to confirm: <the name>"): a signature's own prompt,
  // with the name it shows, names nothing more the person agrees to; the rest of the help text still reads.
  const read = hit.category === 'consent.signature' ? description.replace(SIGNATURE_PROMPT, ' ').trim() : description;
  if (read === '') return hit;
  const extra = consentEntries(read, kind);
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
 * a run to the profile only. jr6 RULES (SR-3): with the field's `kind`, a statement that the work is one's own counts
 * only on a box or a choice (OWN_WORK_KINDS); without it, it counts wherever it stands (the strictest reading).
 */
export function attestsNoAiUse(text: string, kind?: FieldKind): boolean {
  return AI_CONSENT_RULE.re.test(text) || attestationFor(kind).test(text);
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
