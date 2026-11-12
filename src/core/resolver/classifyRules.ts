/*
 * The deterministic part of classification (docs/design/core.md §8.1, steps 1 to 3): the autocomplete attribute, the
 * name and id attributes and the label rules each say what a field is, and combine() settles them. Agreement adds a
 * little confidence; a disagreement flags the field. The attention and tripwire checks run before this and pre-empt
 * it; saved answers and LLM classification come after it, in the resolver.
 *
 * The resolver review (2026-10-30) added what keeps a wrong value out when the sources mislead, since saved answers
 * come next (§8.1 step 4) and would otherwise fill what the rules leave open:
 * - a field about another person (a referee, an emergency contact) takes none of the applicant's own details;
 * - a generic autocomplete token (url, organization) gives way to the specific label it agrees with in kind;
 * - without a strong label rule, two sources that agree outvote one that does not, whatever its precedence;
 * - a closed-class reading that another source contradicts, and one read from the help text alone, go to the person;
 * - what no rule classifies is screened for sensitive topics before the textarea and checkbox fallbacks.
 * A classification with `needsUser` is the person's: it carries no `category`, only what it `asks` about, so nothing
 * downstream can look up a policy for it and fill it; the resolver gives it the action `needs-user`.
 */
import {
  CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP, CLASSIFY_CONFLICT_FACTOR, LABEL_RULE_CONFIDENCE,
} from '../confidence';
import type { FieldKind } from '../enums';
import { prepareOptions } from '../matcher/prepare';
import type { FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import { FIELD_CATEGORIES, type FieldCategory, type PolicyClass } from '../types/intent';
import type { Classifier } from '../types/match';
import { normalize, normalizeLabel } from '../text/normalize';
import type { Vocab } from '../vocab/types';
import { autocompleteRule } from './autocomplete';
import { kindAllowed, policyClassOf } from './categories';
import { FOLD_MAX_CODE_POINTS } from '../text/fold';
import {
  affirmativeOption, attestsNoAiUse, consentChoiceHit, entryOf, matchLabelRules, nationalIdHit, noAiStatementHit,
  sectionKindOf,
  unlabelledTextarea, unrecognisedField, withDescriptionConsent, type LabelContext, type LabelRuleHit,
  type NeedsUserCause,
} from './labelRules';
import { nameIdRule, nameIdText } from './nameId';
import { namesStatusList } from './workStatus';

/** The classifiers a rule can be. */
export type RuleClassifier = Extract<Classifier, 'autocomplete' | 'name-id' | 'label-rule'>;

/** Where a label rule found its match: the label alone, or the label and description together (§8.3). */
export type LabelMatchedOn = 'label' | 'description';

/** One source's verdict, as combine() reads it. */
export interface RuleVote {
  classifiedBy: RuleClassifier;
  category: FieldCategory;
  confidence: number;
  /** The rule's id: 'autocomplete.given-name', 'name-id.email', 'label.first-name'. */
  rule: string;
  /** A strong label rule: the one source that overrules a conflicting autocomplete token. */
  strongLabel: boolean;
  /** Label votes only. */
  matchedOn?: LabelMatchedOn;
  /** Label votes on a consent category only: see LabelRuleHit. */
  consentKinds?: FieldCategory[];
  /** Label votes only: see LabelRuleHit. */
  needsUser?: NeedsUserCause;
}

/** What every rule classification holds. */
interface RuleClassificationBase {
  /** The classification part of the final confidence (classification × value × match). */
  confidence: number;
  classifiedBy: RuleClassifier;
  rule: string;
  /** `classification-conflict` when a source disagreed with the winner, so the field is flagged. */
  reason: Extract<ReasonCode, 'ok' | 'classification-conflict'>;
  /** Set when a label rule decided. */
  matchedOn?: LabelMatchedOn;
  /** Set when a label rule decided a consent category: every consent kind the label matched, strictest first. */
  consentKinds?: FieldCategory[];
}

/** A field the rules classified: its category's policy says what may fill it. */
export interface CategorizedClassification extends RuleClassificationBase {
  category: FieldCategory;
  needsUser?: undefined;
  asks?: undefined;
}

/**
 * A field only the person may answer, whatever its topic's policy would allow: no profile value, pre-approval, saved
 * answer or LLM. It has no `category`, so no policy can be looked up for it and nothing can fill it by mistake; the
 * resolver leaves it blank and flags it (action `needs-user`), and the panel shows what it `asks` about.
 */
export interface HandedOverClassification extends RuleClassificationBase {
  category?: undefined;
  /** What the field asks about, for the panel only: never a category to fill. */
  asks: FieldCategory;
  /** Why the field is the person's. */
  needsUser: NeedsUserCause;
}

/** What the rules say a field is: a category, or the person's (`needsUser`). */
export type RuleClassification = CategorizedClassification | HandedOverClassification;

/** The classification for `category`, handed to the person when `needsUser` is set. */
function classification(category: FieldCategory, base: RuleClassificationBase, needsUser?: NeedsUserCause):
  RuleClassification {
  return needsUser === undefined ? { category, ...base } : { asks: category, ...base, needsUser };
}

/** Confidences are rounded to this many decimals, so float noise never moves a value across a threshold. */
const DECIMALS = 6;
const round = (value: number) => Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;

/** The classes only the profile's explicit values, settings or the person may answer: when another source contradicts
 *  a vote in one, no precedence may settle it (the review), so the field is the person's. */
const CLOSED_CLASSES: readonly PolicyClass[] = ['legal', 'eeo', 'consent', 'sensitive'];

/**
 * Which vote wins a disagreement: a strong label rule, then autocomplete, then name/id, then any other label rule.
 * §8.1 says a strong label rule wins over a conflicting autocomplete token and otherwise autocomplete wins; name/id
 * sits between them, as in the spec's order (autocomplete, name/id, label rules), and below a strong label rule, which
 * beats even autocomplete.
 */
function precedence(vote: RuleVote): number {
  if (vote.classifiedBy === 'label-rule') return vote.strongLabel ? 0 : 3;
  return vote.classifiedBy === 'autocomplete' ? 1 : 2;
}

const first = (votes: readonly RuleVote[]) => votes.reduce((best, vote) => (precedence(vote) < precedence(best)
  ? vote : best));

/**
 * Which vote decides, and whether the field is then the person's. A vote that hands the field to the person decides.
 * A closed-class vote (legal, EEO, consent, sensitive) that another vote contradicts decides, and the field is the
 * person's ('source-conflict'). Otherwise a strong label rule decides (§8.1); without one, the category most votes
 * agree on, so a label rule and a name together outvote one autocomplete token; a tie goes by precedence.
 */
function decide(present: readonly RuleVote[]): { winner: RuleVote; needsUser?: NeedsUserCause } {
  const handedOver = present.filter((vote) => vote.needsUser !== undefined);
  if (handedOver.length > 0) {
    const winner = first(handedOver);
    return { winner, needsUser: winner.needsUser! };
  }
  const closed = present.filter((vote) => CLOSED_CLASSES.includes(policyClassOf(vote.category)));
  if (closed.length > 0 && present.some((vote) => vote.category !== present[0]!.category)) {
    return { winner: first(closed), needsUser: 'source-conflict' };
  }
  const strong = present.filter((vote) => vote.strongLabel);
  if (strong.length > 0) return { winner: first(strong) };
  const votesFor = (category: FieldCategory) => present.filter((vote) => vote.category === category).length;
  const most = Math.max(...present.map((vote) => votesFor(vote.category)));
  return { winner: first(present.filter((vote) => votesFor(vote.category) === most)) };
}

/**
 * §8.1's combine(). With one vote, that vote. When votes agree, the higher confidence plus 0.02, capped at 0.99. When
 * any vote disagrees, the winner (see decide) keeps its category, its confidence, with the agreement bonus if another
 * vote agreed with it, is multiplied by 0.8, and the reason is `classification-conflict`. The winner also names the
 * classifier and the rule; when votes agree, that is the one of highest precedence.
 */
export function combine(votes: ReadonlyArray<RuleVote | null>): RuleClassification | null {
  const present = votes.filter((vote): vote is RuleVote => vote !== null);
  if (present.length === 0) return null;
  const { winner, needsUser } = decide(present);
  const agreeing = present.filter((vote) => vote.category === winner.category);
  const conflict = agreeing.length < present.length;
  let confidence = Math.max(...agreeing.map((vote) => vote.confidence));
  if (agreeing.length > 1) confidence = Math.min(confidence + CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP);
  if (conflict) confidence *= CLASSIFY_CONFLICT_FACTOR;
  const base: RuleClassificationBase = {
    confidence: round(confidence),
    classifiedBy: winner.classifiedBy,
    rule: winner.rule,
    reason: conflict ? 'classification-conflict' : 'ok',
  };
  if (winner.matchedOn !== undefined) base.matchedOn = winner.matchedOn;
  if (winner.consentKinds !== undefined) base.consentKinds = winner.consentKinds;
  return classification(winner.category, base, needsUser);
}

function labelVote(hit: LabelRuleHit, matchedOn: LabelMatchedOn): RuleVote {
  const vote: RuleVote = { classifiedBy: 'label-rule', category: hit.category, confidence: hit.confidence,
    rule: hit.rule, strongLabel: hit.strength === 'strong', matchedOn };
  if (hit.consentKinds !== undefined) vote.consentKinds = hit.consentKinds;
  if (hit.needsUser !== undefined) vote.needsUser = hit.needsUser;
  return vote;
}

/** A '#' closing a word of two letters or more: normalization keeps it (so "C#" and "C" stay apart), but a page writes
 *  "Phone#" for "Phone number", so the rules read the word without it. A one-letter word keeps it ("c#"). */
const CLOSING_HASH = /(?<=\b[a-z]{2,})#+(?=\s|$)/g;

/** jr6 RULES R3 (JV-16, VHL's "Question 2: Do you have 10+ years of work experience in Engineering?", fixtures
 *  jr6-vhl-step3-filled): a question's own number before its words. */
const QUESTION_NUMBER = /^question\s+\d+\s+(?=\S)/;

/** The text the label rules read for a normalized label or description: CLOSING_HASH dropped, and (jr6 RULES R3,
 *  JV-16) a leading "Question N" set aside. */
export function ruleText(key: string): string {
  return key.replace(CLOSING_HASH, '').replace(QUESTION_NUMBER, '');
}

/** s2 core-gh (decision 13): a label's text up to its last question mark, as the rules read it, when the label states
 *  something after it ("Will you … require sponsorship …? You must be work authorized … without the need for employer
 *  sponsorship."); undefined for a label with no question, or nothing after it. */
export function questionsOf(label: string): string | undefined {
  const last = label.lastIndexOf('?');
  if (last < 0 || !/[\p{L}\p{N}]/u.test(label.slice(last + 1))) return undefined;
  const asked = ruleText(normalizeLabel(label.slice(0, last + 1)));
  return asked === '' ? undefined : asked;
}

/** The classes a category read from the help text alone may never be filled in: the closed ones and attention. */
const CLOSED_FROM_DESCRIPTION: readonly PolicyClass[] = [...CLOSED_CLASSES, 'attention'];

/** Help text asking for a place rather than a street: a city and a country, and no street, postcode or ZIP (Workable's
 *  Address, the capture of 2026-11-02: "Include your city, region, and country, so that employers can easily manage
 *  your application."). Only a label that is "Address" and nothing more is read so (the Phase 7a review): "Street
 *  address", "Address line 1" or "Address (flat and street)" stays the street, whatever its help says. */
const PLACE_HINT = /\bcity\b.*\bcountry\b|\bcountry\b.*\bcity\b/;
const STREET_HINT =
  /\bstreet\b|\blines?\b|\bflat\b|\bsuite\b|\bunit\b|\bpost(?:al)?\s*code\b|\bzip\b|\bapartment\b|\bhouse\s+number\b/;
/** The normalized label that is the word Address alone. */
const ADDRESS_ALONE = /^\s*address\s*$/;

/** jr6 RULES R3 (smartrecruiters-new-2): help text that is a résumé's heading and nothing more ("Resume/CV", "Resume",
 *  "Your CV", "Upload your resume"), as normalized. jr6 fix (RULES-R56, WD-R3: Workday's "Upload a file (5MB max)" under
 *  "Resume/CV/Cover Letter" on Dana-Farber's and Travelers' My Experience, fixtures jr6-danafarber-my-experience,
 *  jr6-travelers-my-experience): or a list of documents that starts with the résumé ("Resume or Cover Letter", "Upload
 *  your resume and cover letter", "CV / Cover Letter", "Resume and supporting documents"); never one that names no
 *  résumé, or names it later ("Additional attachments", "Cover Letter/Resume"). */
const RESUME_DOC = String.raw`(?:resume|cv|curriculum\s+vitae)`;
const RESUME_HEADING = new RegExp(String.raw`^(?:(?:upload|attach)\s+)?(?:your\s+|a\s+)?${RESUME_DOC}(?:\s+(?:(?:and\s+)?or\s+|and\s+)?(?:a\s+|your\s+)?(?:${RESUME_DOC}|cover\s+letters?|(?:other\s+|supporting\s+|additional\s+)?(?:documents?|attachments?)))*(?:\s+(?:upload|uploads|file|files|document|documents))?$`);

/** jr6 RULES R3 (SR-9: SmartRecruiters' drop zone restriction "Supported files: DOC, DOT, RMR, RSM, RESUME, OXPS, PDF,
 *  … (10MB size limit)" as the field's help, fixtures/smartrecruiters/xplor-screening, where "RESUME" is a file type): a
 *  run of three or more comma-separated single words. */
const WORD_RUN = /(?:\.?[A-Za-z0-9_]{1,16}[ \t]*,[ \t]*){2,}\.?[A-Za-z0-9_]{1,16}/g;
/** File types as upload widgets list them (public extension names). */
const FILE_TYPES: ReadonlySet<string> = new Set(['pdf', 'doc', 'docx', 'dot', 'dotx', 'rtf', 'txt', 'text', 'odt',
  'ods', 'odp', 'pages', 'gdoc', 'gslides', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'ppsx', 'pps', 'jpg', 'jpeg',
  'jfif', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic', 'svg', 'html', 'htm', 'zip', 'md', 'wpd', 'wps', 'pub',
  'msg', 'eml', 'mp3', 'mp4', 'mov', 'wav', 'm4a', 'psd', 'ai', 'key', 'numbers', 'json', 'xml', 'ics', 'ical',
  'icalendar', 'ifb', 'vcf', 'sxw', 'abw', 'oxps', 'xps', 'p7s', 'rmr', 'rsm', 'resume']);

/** jr6 RULES R3 (SR-9): help text without its runs of file types (WORD_RUN, at least half of its words known file
 *  types), which name no document the field asks for. */
export function withoutFileTypes(text: string): string {
  return text.replace(WORD_RUN, (run) => {
    const words = run.split(',').map((word) => word.trim().replace(/^\./, '').toLowerCase());
    return words.filter((word) => FILE_TYPES.has(word)).length * 2 >= words.length ? ' ' : run;
  });
}

/**
 * The label rules over the normalized label; when nothing matches it and the field has a description, over the
 * normalized label and description together (§8.3's "plus the description for long questions"). A consent label also
 * takes the consent kinds of its description, which only ever make it stricter. A legal, EEO, consent, sensitive or
 * attention category found only once the description is read is the person's: help text names topics the question
 * does not ask ("Do you need any accommodations?" over a paragraph about disability). An "Address" whose help text asks
 * for a city and a country, not a street (PLACE_HINT), is the applicant's location.
 */
function labelRuleVote(spec: FieldSpec, label: string, context: LabelContext): RuleVote | null {
  const section = sectionKindOf(spec.section.id);
  // jr6 RULES R3 (SR-9): a list of file types in the help text names no document.
  const description = ruleText(normalizeLabel(withoutFileTypes(spec.description)));
  const onLabel = matchLabelRules(label, section, spec.kind, context);
  if (onLabel !== null && onLabel.rule === 'label.address1' && ADDRESS_ALONE.test(label)
    && !STREET_HINT.test(spec.label.toLowerCase()) && PLACE_HINT.test(description) && !STREET_HINT.test(description)
    && kindAllowed('location.current', spec.kind)) {
    return labelVote({ ...onLabel, category: 'location.current' }, 'label');
  }
  if (onLabel !== null) return labelVote(withDescriptionConsent(onLabel, description, spec.kind), 'label');
  if (description === '') return null;
  const both = label === '' ? description : `${label} ${description}`;
  // The label's question sentences are the label's alone: the text with the description is read whole.
  const { questions: _questions, ...withDescription } = context;
  const onBoth = matchLabelRules(both, section, spec.kind, withDescription);
  if (onBoth === null) return null;
  // jr6 RULES R3 (smartrecruiters-new-2): help text alone never makes an upload the résumé's ("Additional attachments",
  // "Portfolio", "Writing sample" over SmartRecruiters' restriction text), unless it is a résumé's heading itself
  // (Workday's drop zone "Upload a file (5MB max)" under its group heading "Resume/CV": the behaviour review's M2).
  if (onBoth.category === 'file.resume' && !RESUME_HEADING.test(description)) return null;
  const closed = CLOSED_FROM_DESCRIPTION.includes(policyClassOf(onBoth.category));
  return labelVote(closed && onBoth.needsUser === undefined ? { ...onBoth, needsUser: 'description-only' } : onBoth,
    'description');
}

/**
 * The generic autocomplete tokens (§8.3 scores them 0.85 because sites use them for any link or organisation) and the
 * categories each stands for: a label or name naming one of them more precisely is no conflict, and decides.
 */
const GENERIC_TOKEN_CATEGORIES: Readonly<Record<string, readonly FieldCategory[]>> = {
  'autocomplete.url': ['links.linkedin', 'links.github', 'links.portfolio', 'links.website', 'links.twitter',
    'links.other'],
  'autocomplete.organization': ['experience.company', 'experience.currentCompany'],
  'autocomplete.organization-title': ['experience.title', 'experience.currentTitle'],
  // jr6 RULES (WD-09): Workday's agreement box by its name only where its label reads as no consent kind of its own; a
  // label that does ("I agree to the privacy policy") decides.
  'name-id.accept-terms': FIELD_CATEGORIES.filter((category) => category.startsWith('consent.')),
};

/** jr6 fix (RULES-R49): a label naming a chosen or preferred first name ("Chosen First Name", "Preferred First Name"). */
const CHOSEN_FIRST_NAME_LABEL = /\b(?:chosen|preferred)\s+first\s+name\b/;

/** A field about someone other than the applicant, named in the label: a referee, an emergency contact, a manager. A
 *  job's own reference ("Job reference", "Reference number") is not a person. s2 core-gh (decision 13, the gh study's
 *  3d: s2-onestream-related-open question_8152432009 "If yes, please enter the referring employee's full name", which
 *  took the profile's referral text): normalization deletes the apostrophe, so a possessive reads "employees"; and a
 *  relative named as a noun ("the name of your relative", question_8152428009) is another person too. */
const OTHER_PERSON_LABEL = /\b(?:referr?ers?|referees?|reference\s+\d+|(?<!\b(?:job|requisition|posting|vacancy|role|position)\s)references?(?!\s+(?:number|no|num|code|id|letters?)\b)|emergency|next\s+of\s+kin|spouse|guardian|managers?|supervisors?|recruiters?|referral\s+(?:name|email|e\s?mail|phone|contact|first|last|full)|referring\s+(?:employees?|persons?|individuals?|friends?)|employee\s+referral|(?:your|the|a|my)\s+relatives?)\b/;
/** The same in the name and id attributes, as nameIdText writes them ("referrer_email", "reference1_first_name"). */
const OTHER_PERSON_ID = /(?:^|[_ ])(?<!(?:job|requisition|posting|vacancy)_)(?:referr?er\w*|referee\w*|references?\d*|emergency\w*|spouse\w*|guardian\w*|manager\w*|supervisor\w*|recruiter\w*)(?![_ ](?:number|no|num|code|id)(?:[_ ]|$))(?=[_ \d]|$)/;
/** A section about other people ("references", "emergency-contact"). */
const OTHER_PERSON_SECTION = /\b(?:references?|referees?|referrers?|referrals?|emergency|kin)\b/;

/** jr7 RULES-7 R2 (DF7-11): a field about the person's supervisor or manager at a job ("Supervisor", "Supervisor's
 *  Phone", "Manager name"), by its own label. */
const SUPERVISOR_FIELD = /^(?:(?:your|immediate|direct|reporting)\s+)?(?:supervisor|manager)s?(?:\s+(?:name|first\s+name|last\s+name|phone|telephone|phone\s+number|e\s?mail|title|contact|number))*$/;

/** Which source names another person: the label (or the section), else the name and id attributes; null for none. */
function otherPersonNamedBy(spec: FieldSpec, label: string): RuleClassifier | null {
  const section = spec.section.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (OTHER_PERSON_LABEL.test(label) || OTHER_PERSON_SECTION.test(section)) return 'label-rule';
  return OTHER_PERSON_ID.test(nameIdText(spec.nameAttr, spec.idAttr)) ? 'name-id' : null;
}

/** Whether a field asks about someone other than the applicant (a referee, an emergency contact, a manager), by its
 *  label, its section or its name and id: an AI answer never fills one (plan/answers.ts, the Phase E review, M2). */
export function namesAnotherPerson(spec: FieldSpec): boolean {
  return otherPersonNamedBy(spec, ruleText(normalize(spec.label, 'label').key)) !== null;
}

/** jr6 RULES R3 (jazzhr-new-1): whether a field's own words (its label or its section's) name someone other than the
 *  applicant (a referee, an emergency contact): its name and id alone do not ("hiring-manager-message-input", the
 *  message box SmartRecruiters addresses to the hiring manager, fixtures/smartrecruiters/xplor-one-click). */
export function wordsNameAnotherPerson(spec: FieldSpec): boolean {
  return otherPersonNamedBy(spec, ruleText(normalize(spec.label, 'label').key)) === 'label-rule';
}

/** Whether a field's own words state "I did not use AI" (labelRules attestsNoAiUse): its normalized label with its
 *  parentheticals, or its description (the Phase E review, M5). The core pass of 2026-11-06: the whole of each, sentence
 *  by sentence past what normalization reads at once (FOLD_MAX_CODE_POINTS), and the frame's reading of the label past
 *  its 300 characters (FieldSpec.statesNoAi: Dropzone's policy attests in its last sentences). The same rules read each. */
export function statesNoAiUse(spec: Pick<FieldSpec, 'label' | 'description' | 'statesNoAi'>
  & Partial<Pick<FieldSpec, 'kind'>>): boolean {
  if (spec.statesNoAi === true) return true;
  // jr6 RULES (SR-3): with its kind, a field states that the work is its author's own only on a box or a choice
  // (labelRules attestsNoAiUse); "In your own words, …" over a text box is an instruction.
  const description = ruleText(normalizeLabel(spec.description));
  if ([labelText(spec.label), description].some((text) => text !== '' && attestsNoAiUse(text, spec.kind))) return true;
  return [spec.label, spec.description].some((whole) => [...whole].length > FOLD_MAX_CODE_POINTS
    && sentencesOf(whole).some((sentence) => {
      const text = labelText(sentence);
      return text !== '' && attestsNoAiUse(text, spec.kind);
    }));
}

/** A label as the attestation is read in it: normalized, with its parentheticals. */
function labelText(label: string): string {
  const normalized = normalize(label, 'label');
  return [ruleText(normalized.key), ...normalized.qualifiers.map((qualifier) => qualifier.tokens.join(' '))]
    .join(' ').trim();
}

/** Where a passage's raw text (before normalization) breaks between sentences: after a full stop, a question or
 *  exclamation mark, a semicolon or a colon, or at a line break. */
const SENTENCE_BREAK = /(?<=[.!?;:])\s+|\n+/;

/** The sentences of a passage (SENTENCE_BREAK). */
function sentencesOf(text: string): string[] {
  return text.split(SENTENCE_BREAK).map((sentence) => sentence.trim()).filter((sentence) => sentence !== '');
}

/** The applicant's own details: none of them belongs in a field about another person. Referral fields stay. */
const isOwnDetail = (vote: RuleVote) => policyClassOf(vote.category) === 'profile'
  && !vote.category.startsWith('referral.');

/** A telephone box that is not the applicant's own number: a fax, an extension, a country or area code alone. */
const NOT_OWN_PHONE = /\bfax\b|\bext(?:ension)?\b|\b(?:country|area|dial(?:ing)?)\s+code\b|\bpager\b/;

/**
 * What the screen catches in a field no rule classifies (the design's classify screen runs only at LLM classification,
 * after saved answers): self-identification, authorization, criminal history, age, pay, and consent wording. Such a
 * field is the person's, so no saved answer or LLM answers it.
 */
export const SENSITIVE_TOPIC = /\b(?:disabilit\w*|disabled|handicap\w*|veterans?|military|armed\s+forces|race|races|racial|ethnic\w*|hispanic|latin[oax]|gender|sex|sexual|transgender|cisgender|lgbt\w*|queer|pronouns?|citizen\w*|nationalit\w*|visas?|sponsor\w*|immigra\w*|work\s+permits?|authori[sz]\w*|eligib\w*|criminal|convict\w*|felon\w*|arrest\w*|offen[cs]es?|offenders?|age|birth\w*|salary|salaries|compensation|wages?|religio\w*|pregnan\w*|marital|medical\s+conditions?|consent\w*|agree\w*|share\s+(?:my|your)\s+(?:data|information))\b/;

// ── jr6 RULES: lists their options classify (FIXPLAN §6.3 R1 items 12 and 24) ────────────────────────────────────────

/** The single-choice kinds whose options the options rules read. */
const OPTION_RULE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['radio', 'select', 'combobox']);
/** An option that is a veteran self-identification statement ("I AM NOT A PROTECTED VETERAN", "I identify as one or
 *  more of the classifications of protected veterans listed above"). */
const VETERAN_STATEMENT = /\bveterans?\b/;
/** U-09 (UltiPro's "Ethnic Origin", select#HispanicOrigin: Hispanic/Latino, Not Hispanic/Latino). */
const ETHNIC_ORIGIN = /^ethnic\s+origin$/;
const HISPANIC_OPTION = /\bhispanic\b|\blatin[aoxe]\b/;
const VETERAN_OPTIONS_RULE = 'options.veteran-statements';
/** jr6 RULES R4 (WD-25, "Title as honorific"): a list labelled "Title" whose options are honorifics (Mr., Ms., Dr.). */
const TITLE_ALONE = /^(?:name\s+)?title$/;
const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|doctor|prof|professor|rev|reverend|sir|madam|dame|lord|lady|mister|misses)$/;
const HONORIFIC_OPTIONS_RULE = 'options.honorifics';
const ETHNIC_ORIGIN_RULE = 'label.ethnic-origin';
const WORK_STATUS_OPTIONS_RULE = 'options.work-status';

/** Whether the rules' own reading of a field settles nothing certain: none, an unknown or open screening question, or
 *  one handed to the person for a sensitive topic its wording only touches. */
function uncertain(rules: RuleClassification | null): boolean {
  if (rules === null) return true;
  const asks = rules.category ?? rules.asks;
  return asks === 'unknown' || asks === 'screening.other' || rules.needsUser === 'sensitive-topic';
}

/**
 * jr6 RULES: what a list's own options say it asks, where the rules read nothing certain (uncertain):
 * - JV-2 (Jobvite's veteran block labelled only "Choose One", fixtures jr6-vhl-step2, jr6-sikich-step2,
 *   ninjaone-step2): a radio, a select or a combobox with at least two veteran self-identification statements among its
 *   options is the veteran question, whatever its label;
 * - U-09 (UltiPro's application): "Ethnic Origin" whose options name Hispanic or Latino is the Hispanic or Latino
 *   question.
 * Null for any other field.
 */
function optionsRule(spec: FieldSpec, label: string, rules: RuleClassification | null): RuleClassification | null {
  if (!OPTION_RULE_KINDS.has(spec.kind) || spec.options === 'lazy') return null;
  const base = { confidence: LABEL_RULE_CONFIDENCE.normal, classifiedBy: 'label-rule' as const, reason: 'ok' as const,
    matchedOn: 'label' as const };
  // jr6 RULES (JV-7, JV-11): an authorization question (label.work-auth) or one read as nothing certain whose options
  // are work statuses ("US Citizen", "Permanent Resident", "H1B"; workStatus.ts namesStatusList) asks which status.
  if ((uncertain(rules) || (rules?.rule === 'label.work-auth' && rules.needsUser === undefined))
    && spec.optionsPartial !== true && namesStatusList(spec.options.map((option) => option.label))) {
    return classification('workAuth.status', { ...base, rule: WORK_STATUS_OPTIONS_RULE });
  }
  if (!uncertain(rules)) return null;
  const options = spec.options.map((option) => normalizeLabel(option.label)).filter((text) => text !== '');
  if (options.filter((text) => VETERAN_STATEMENT.test(text)).length >= 2) {
    return classification('eeo.veteran', { ...base, rule: VETERAN_OPTIONS_RULE });
  }
  if (ETHNIC_ORIGIN.test(label) && options.some((text) => HISPANIC_OPTION.test(text))) {
    return classification('eeo.hispanicLatino', { ...base, rule: ETHNIC_ORIGIN_RULE });
  }
  // jr6 RULES R4 (WD-25): a "Title" list of honorifics is the name's prefix, which the profile never holds.
  if (TITLE_ALONE.test(label) && options.filter((text) => HONORIFIC.test(text)).length >= 2) {
    return classification('identity.prefix', { ...base, rule: HONORIFIC_OPTIONS_RULE });
  }
  return null;
}

// jr6 RULES end

/** jr7 RULES-7 (ICIMS7-06): whether a list, a combobox or a radio group read whole offers exactly a Yes and a No (its
 *  options normalized, a placeholder aside): a yes-or-no question, never a skills list. */
function offersOnlyYesNo(spec: FieldSpec): boolean {
  if (!OPTION_RULE_KINDS.has(spec.kind) || spec.options === 'lazy' || spec.optionsPartial === true) return false;
  const options = spec.options.map((option) => normalizeLabel(option.label))
    .filter((text) => text !== '' && !PLACEHOLDER_OPTION.test(text));
  return options.length === 2 && options.includes('yes') && options.includes('no');
}
/** An option that only asks to choose ("Make a Selection", "Select…", "Please select", "Choose one"). */
const PLACEHOLDER_OPTION = /^(?:please\s+)?(?:make\s+a\s+selection|select(?:\s+(?:one|an?\s+option))?|choose(?:\s+(?:one|an?\s+option))?|none\s+selected)$/;

/**
 * What the deterministic rules say `spec` is: the autocomplete, name/id and label votes combined (§8.1), each checked
 * against the field's kind (CATEGORY_KINDS), so a mismatch is no vote. A field about another person keeps none of the
 * applicant's own details (`screening.other` when nothing else is left). What nothing classifies is, in order: the
 * person's when it names a sensitive topic; free text when it is a textarea (`freeText.other`, weak, as §8.3 has it
 * for an unlabelled one), outside an experience or education section; unrecognised consent when it is a lone checkbox.
 * Otherwise null: the resolver then tries saved answers and LLM classification. A rule that decides `unknown` ("Resume"
 * on a text field) is a classification, not a miss, so it is returned as such.
 */
export function classifyByRules(spec: FieldSpec): RuleClassification | null {
  const normalized = normalize(spec.label, 'label');
  const label = ruleText(normalized.key);
  const context: LabelContext = { qualifiers: normalized.qualifiers.map((q) => q.tokens.join(' ')).join(' '),
    rawLabel: spec.label };
  if (spec.section.block !== undefined) context.block = spec.section.block;
  // jr6 RULES (ICIMS-09, O7): a job's or a school's own block.
  const entry = entryOf(spec.section);
  if (entry !== null) context.entry = entry;
  const questions = questionsOf(spec.label);
  if (questions !== undefined) context.questions = questions;
  // jr7 RULES-7 (UKGR-14): a national id or a social security number, by its label, its mask or its name, before any
  // other source (the "999-99-9999" placeholder reads as a phone's mask).
  const nationalId = nationalIdHit(label, spec.label, spec.constraints.pattern, nameIdText(spec.nameAttr, spec.idAttr));
  if (nationalId !== null) return combine([labelVote(nationalId, 'label')]);
  // jr7 RULES-7 (ICIMS7-06): a list read whole of a Yes and a No.
  if (offersOnlyYesNo(spec)) context.yesNoOptions = true;
  // jr7 RULES-7 R2 (DF7-11): an optional reason for leaving is an entry detail; a required one stays the AI's (jr6).
  if (spec.required) context.required = true;
  const autocomplete = autocompleteRule(spec.autocomplete, spec.kind);
  const nameId = nameIdRule(spec.nameAttr, spec.idAttr, spec.kind);
  let votes = [
    autocomplete && { classifiedBy: 'autocomplete' as const, ...autocomplete, strongLabel: false },
    nameId && { classifiedBy: 'name-id' as const, category: nameId.category, confidence: nameId.confidence,
      rule: nameId.rule, strongLabel: false },
    labelRuleVote(spec, label, context),
  ].filter((vote): vote is RuleVote => vote !== null);
  const generic = votes.find((vote) => GENERIC_TOKEN_CATEGORIES[vote.rule] !== undefined);
  if (generic !== undefined && votes.some((vote) => vote.category !== generic.category
    && GENERIC_TOKEN_CATEGORIES[generic.rule]!.includes(vote.category))) {
    votes = votes.filter((vote) => vote !== generic);
  }
  // jr6 fix (RULES-R49-CHOSEN-NAME-CONFLICT): a chosen or preferred first name is a given name, more precisely named
  // (NinjaOne's "Chosen First Name" with autocomplete="given-name", jobvite/ninjaone-step1): the label decides with no
  // conflict flagged (the value is the first name either way when the profile holds no preferred one). A "Nickname"
  // names no first name and still conflicts (§8.1's example).
  if (CHOSEN_FIRST_NAME_LABEL.test(label) && votes.some((vote) => vote.category === 'identity.preferredName')) {
    votes = votes.filter((vote) => vote.rule !== 'autocomplete.given-name');
  }
  const otherPerson = otherPersonNamedBy(spec, label);
  // jr7 RULES-7 R2 (DF7-11, Dayforce's employment record "Supervisor", snapshot7 dayforce1): a field whose own words
  // name another person and that no source reads is no question of the person's either: nobody's details to give, and
  // no AI's to invent (plan/answers.ts never answers one).
  if (otherPerson === 'label-rule' && votes.length === 0 && SUPERVISOR_FIELD.test(label)) {
    return classification('screening.other', { confidence: LABEL_RULE_CONFIDENCE.normal, classifiedBy: otherPerson,
      rule: 'label.another-person', reason: 'ok', matchedOn: 'label' });
  }
  if (otherPerson !== null && votes.some(isOwnDetail)) {
    votes = votes.filter((vote) => !isOwnDetail(vote));
    if (votes.length === 0) {
      const base: RuleClassificationBase = { confidence: LABEL_RULE_CONFIDENCE.normal, classifiedBy: otherPerson,
        rule: 'label.another-person', reason: 'ok' };
      if (otherPerson === 'label-rule') base.matchedOn = 'label';
      return classification('screening.other', base);
    }
  }
  const combined = combine(votes);
  // jr6 RULES (JV-2, U-09): a list whose own options say what it asks, where the rules read nothing certain.
  const byOptions = optionsRule(spec, label, combined);
  if (byOptions !== null) return byOptions;
  if (combined !== null) return combined;
  // The core pass of 2026-11-06: an "I did not use AI" statement past the label's 300 characters, which the frame read
  // (FieldSpec.statesNoAi): an AI attestation, as label.consent-ai reads one in a label.
  if (spec.statesNoAi === true) return combine([labelVote(noAiStatementHit(spec.kind), 'label')]);
  const sensitive = SENSITIVE_TOPIC.test(`${label} ${normalizeLabel(spec.description)}`);
  // A telephone box (input type=tel) whose label no rule reads ("Best Contact Number", multiverse 2026-11-01) is a
  // phone, weakly (filled and flagged for a look): never another person's, a fax or an extension.
  if (!sensitive && spec.kind === 'text' && spec.constraints.format === 'tel' && otherPerson === null
    && !NOT_OWN_PHONE.test(label)) {
    return classification('contact.phone', { confidence: LABEL_RULE_CONFIDENCE.weak, classifiedBy: 'label-rule',
      rule: 'format.tel', reason: 'ok', matchedOn: 'label' });
  }
  if (sensitive) {
    return classification('unknown', { confidence: LABEL_RULE_CONFIDENCE.weak, classifiedBy: 'label-rule',
      rule: 'label.sensitive-topic', reason: 'ok', matchedOn: 'label' }, 'sensitive-topic');
  }
  // A textarea in an employment or school block is more often that entry's own text ("Role description") than a
  // question, so it is left to LLM classification there.
  const inBlock = spec.kind === 'textarea' && sectionKindOf(spec.section.id) !== 'other';
  const fallback = unlabelledTextarea(label, spec.kind) ?? (inBlock ? null : unrecognisedField(spec.kind));
  return fallback === null ? null : combine([labelVote(fallback, 'label')]);
}

// ---------------------------------------------------------------------------------------------------------------
// A consent asked as a choice

/** The kinds a consent may be asked as a choice on: a list, a combobox, a radio group (a lone box is consent's own). */
const CONSENT_CHOICE_KINDS: readonly FieldKind[] = ['select', 'combobox', 'radio'];

/** The consent words SENSITIVE_TOPIC's fallback reads: a label that names no sensitive topic but these is consent. */
const CONSENT_WORDS = /\b(?:consent\w*|agree\w*|share\s+(?:my|your)\s+(?:data|information))\b/g;

/**
 * The one option a consent asked as a choice offers (the owner's decision of 2026-11-01): on a list, a combobox or a
 * radio group read whole, the only option that can be chosen (a placeholder aside), when it plainly agrees
 * (labelRules affirmativeOption: "Acknowledge/Confirm", "I agree", "Yes"), as its clean label; 'pending' while the
 * options are not read (a combobox shows them only when opened); null for any other field: several options a person
 * can choose (a Yes and a No, a list of answers: no consent but a question), one that does not agree, one disabled, one
 * read only in part, or any option with injected text cut.
 */
export function consentChoiceOption(spec: Pick<FieldSpec, 'kind' | 'options' | 'optionsPartial'>, vocab: Vocab):
  string | 'pending' | null {
  if (!CONSENT_CHOICE_KINDS.includes(spec.kind)) return null;
  if (spec.options === 'lazy') return 'pending';
  if (spec.optionsPartial === true) return null;
  const list = prepareOptions(spec.options, 'generic', vocab).list;
  if (list.some((option) => option.injected)) return null;
  const usable = list.filter((option) => !option.unusable);
  const only = usable.length === 1 ? usable[0]! : null;
  if (only === null || only.disabled || !affirmativeOption(normalizeLabel(only.clean))) return null;
  return only.clean;
}

/** s2 core-gh (decision 10): a list read whole whose usable options are exactly a Yes and a No ("Yes", "No", "Yes, I
 *  certify", "No"), none of them injected or disabled. */
function offersYesAndNo(spec: Pick<FieldSpec, 'kind' | 'options' | 'optionsPartial'>, vocab: Vocab): boolean {
  if (spec.options === 'lazy' || spec.optionsPartial === true) return false;
  const list = prepareOptions(spec.options, 'generic', vocab).list;
  if (list.some((option) => option.injected)) return false;
  const usable = list.filter((option) => !option.unusable && !option.disabled).map((option) => normalizeLabel(option.clean));
  return usable.length === 2 && usable.some((label) => /^yes\b/.test(label) && affirmativeOption(label))
    && usable.some((label) => /^no$/.test(label));
}

/** Whether the rules leave a field to a consent read as a choice: they classify nothing, they hand a consent to the
 *  person only because its kind holds no box (kind-mismatch), or they hand it over for a sensitive topic that is only
 *  its consent wording ("Consent to processing"). A field the rules read as anything else keeps that reading. */
function opensToConsentChoice(spec: FieldSpec, rules: RuleClassification | null, label: string): boolean {
  if (rules === null) return true;
  const asks = rules.category ?? rules.asks;
  if (policyClassOf(asks) === 'consent') return rules.needsUser === 'kind-mismatch';
  return rules.needsUser === 'sensitive-topic' && rules.rule === 'label.sensitive-topic'
    && !SENSITIVE_TOPIC.test(`${label} ${normalizeLabel(spec.description)}`.replace(CONSENT_WORDS, ' '));
}

/**
 * A consent asked as a choice (the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11; the live BeyondTrust
 * form's "Please review and acknowledge BeyondTrust's" with its one option "Acknowledge/Confirm"): a list, a combobox
 * or a radio group the rules leave open (opensToConsentChoice) whose one option plainly agrees (consentChoiceOption),
 * and whose label, with that option's words, is consent wording (labelRules consentChoiceHit): its consent kinds,
 * strictest first, so the consent policy decides it as it decides a box (policy.ts consentValue: a required one is
 * chosen, an optional one only when pre-approved, an AI attestation only in a run that used no AI). A combobox whose
 * options are not read yet is read so by its label alone, and waits for them (consentValue). Null for anything else:
 * the field is read as before. A tripwire, an attention check, a honeypot and a hidden field are refused before this
 * (resolve.ts classifyField, planFrame).
 */
export function consentChoice(spec: FieldSpec, rules: RuleClassification | null, vocab: Vocab): RuleClassification | null {
  if (!CONSENT_CHOICE_KINDS.includes(spec.kind)) return null;
  const normalized = normalize(spec.label, 'label');
  const label = [ruleText(normalized.key), ...normalized.qualifiers.map((qualifier) => qualifier.tokens.join(' '))]
    .join(' ').trim();
  if (label === '' || !opensToConsentChoice(spec, rules, label)) return null;
  const option = consentChoiceOption(spec, vocab);
  // s2 core-gh (decision 10): a consent the rules read asked as a Yes and a No ("I certify that all information I have
  // provided … is true and accurate." on s2-horacemann-certify-open, "I certify … I understand that false … may result
  // in my release." on s2-onestream-related-open, the CLEAR ID check on s2-robotspencils-clear-id-open) is decided by
  // the Consents mode like any consent: its Yes is chosen by polarity (policy.ts consentValue) where it is approved or
  // required.
  // While the list is not read, the rules' consent reading waits for it (consentValue: waiting-for-options).
  const fromRules: RuleClassification | null = rules?.needsUser === 'kind-mismatch'
    && policyClassOf(rules.asks) === 'consent'
    ? { category: rules.asks, confidence: rules.confidence, classifiedBy: rules.classifiedBy, rule: rules.rule,
      reason: 'ok', matchedOn: rules.matchedOn ?? 'label', consentKinds: rules.consentKinds ?? [rules.asks] }
    : null;
  if (option === null) return fromRules !== null && offersYesAndNo(spec, vocab) ? fromRules : null;
  const asked = option === 'pending' ? label : `${label} ${normalizeLabel(option)}`;
  const hit = consentChoiceHit(asked, ruleText(normalizeLabel(spec.description)));
  if (hit === null) return option === 'pending' ? fromRules : null;
  return { category: hit.category, confidence: hit.confidence, classifiedBy: 'label-rule', rule: hit.rule,
    reason: 'ok', matchedOn: 'label', consentKinds: hit.consentKinds! };
}
