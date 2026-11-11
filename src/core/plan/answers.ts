/*
 * AI answers (the owner's amendments, docs/SPEC-AMENDMENTS.md "Fill everything"; TailorIT's POST /api/autofill/ai/answer,
 * AutofillAnswerRequest in the contract). With settings.llm.answers on (the default since settings version 2), a
 * question nothing on the extension's side settled is asked of TailorIT, which answers from the resume and the
 * profile's non-sensitive facts it reads itself, or with its best guess (basis `guess`, marked "AI guess"):
 * - Which fields (answerItemOf): one that can be written, named by a label a person and the LLM may see, with no
 *   tripwire or attention check in its own text, no rule handing it to the person, no saved answer, and no EEO, legal
 *   or sensitive context (the classify screen over its label, description, section and options, which also withholds
 *   any field that offers a decline option, then the questions it belongs to: drafts.ts inClosedContext, E2). Its gap
 *   is one the AI may fill: an unknown question; a short free-text box (maxLength under DRAFT_MIN_LENGTH: a longer one
 *   takes a draft); a job preference, availability, referral, years of experience or skill the profile holds no value
 *   for (ANSWERABLE_PROFILE_CATEGORIES); or, among the profile's questions, a list only the LLM classified whose match
 *   was a tie no tiebreak could settle (an AI-only tie). Never a sensitive, legal, EEO, consent, attention or file
 *   question, never one only the person answers, and never one about another person, an identifier, a postal address
 *   or a security clearance (namesUnanswerableTopic, classifyRules' namesAnotherPerson: the Phase E review, M2).
 * - A lazy list (a combobox whose options show only when opened) whose question is answerable waits for its options
 *   (answerWaitsForOptions: the planner rows it waiting-for-options), so the loop reads it and the next pass asks with
 *   them (the Phase E review, M7).
 * - Its shape: a choice for a select, a radio group or a combobox (never a set, a lone checkbox, a typeahead, a date or
 *   an upload), whose list was read whole, holds nothing chosen yet, and offers 2 to ANSWER_MAX_OPTIONS options that
 *   can be chosen, an option whose label had injected text cut never among them; or a text for an empty text box or
 *   textarea that asks for no contact detail, link or postal code, capped at min(maxLength, ANSWER_TEXT_MAX), or for an
 *   empty date box. Since TailorIT's API 4 a text names the layout its answer must have (answerFormatOf, the contract's
 *   AUTOFILL_ANSWER_FORMATS): a number box its number, integer or currency, a date box the date layout it shows
 *   (MM/DD/YYYY, DD/MM/YYYY, MM/YYYY, or YYYY-MM-DD for a date input); a date box of any other layout, and a birth date
 *   whatever its layout, is never asked.
 * - What is sent: visible text only, each string made by asUntrusted: the label, the description, the section's words
 *   and, for a choice, each option's clean label under its own index (the hash of that label stays here). No profile
 *   text: TailorIT reads the facts itself. The worker adds the posting's visible text, the lookup's company and title,
 *   the resume and the canaries.
 * - What comes back (AnswerVerdict, the worker's translation): a choice of one sent option, a text, or why there is
 *   none. planFrame writes a choice as an llm-pick naming the task, the option and the hash of its label as sent (the
 *   frame checks the option again: llmPickStillValid), and a text as an llm-answer naming the task and its basis; each
 *   through guardWrite (the canary scan included), never past the field's own cap. Either is accepted as written:
 *   `llm-answer-written`, or `ai-guess` when it rests on nothing, neither needing the person.
 * - The `all` scope (settings.modes.ai 'all', the default: the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md
 *   §11): a legal, criminal-history, pay or attention-check question the profile leaves open is asked too, with
 *   TailorIT's `all` scope (AnswerItem.scope), and its answer is written as any other ("AI guess" unless a fact settles
 *   it). Which: a category of AI_OPENED_CATEGORIES whose row says the profile holds no answer (legal-not-in-profile,
 *   criminal-not-covered, no-profile-value), an attention check whose own words name no consent (never one only the
 *   person can answer, guard/attention.ts PERSON_ONLY_ATTENTION: the posting's phrase or code word, the Phase 7a
 *   review; nor a bot check, a human check, a sum or a CAPTCHA, the audit of 2026-11-06, S-2), a question the classify
 *   screen kept from the LLM, or one an EEO, legal or sensitive context closed, as long as its
 *   own text names only open topics (classify.ts openAnswerTopics: authorization, age, pay, criminal history; never a
 *   self-identification, a consent or an identity number, never an EEO answer among its options, a decline option
 *   only beside an open topic) and its context holds no self-identification, consent or pronoun question
 *   (drafts.ts inClosedContext, open). A rule hands it to the person only for what an answer can still say (a legal
 *   question on a text box, one read from its help text, one tying authorization to sponsorship, a time that cannot be
 *   read, a work permit, a nationality, an age band); never current pay, a source conflict, a self-identification topic
 *   or a birth date. In this scope a clearance may be named, and so may a number in a pay or attention-check question;
 *   another person, an identifier, a postal address, a consent topic and an "I did not use AI" attestation (or a
 *   question whether AI wrote the application) are never sent in any scope. Only the question's text and options
 *   travel: the profile's values never do, and a question the profile answers is never asked.
 * Pure: no text is logged or kept here; the worker holds the answers for the run only.
 */
import {
  ANSWER_HINT_MAX, ANSWER_MAX_OPTIONS, ANSWER_MIN_OPTIONS, ANSWER_QUESTION_MAX, ANSWER_SECTION_MAX, ANSWER_TEXT_MAX,
  DRAFT_MIN_LENGTH, TIEBREAK_LABEL_MAX,
} from '../confidence';
import type { AutofillAnswerFormat } from '../../contract/tailorit';
import type { FieldFormat, FieldKind, Platform } from '../enums';
import { attentionHits, namesBotCheck, PERSON_ONLY_ATTENTION } from '../guard/attention';
import { detectionViews } from '../guard/fold';
import { llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { chooseable, prepareOptions } from '../matcher/prepare';
import {
  AI_OPENED_CATEGORIES, ANSWERABLE_PROFILE_CATEGORIES, policyClassOf, USER_ONLY_CATEGORIES,
} from '../resolver/categories';
import { classifiable, openAnswerTopics, sectionWordsOfKey, type ScreenTopic } from '../resolver/classify';
import { namesAnotherPerson } from '../resolver/classifyRules';
import {
  asksHowApplicationMade, attestsNoAiUse, namesBindingWaiver, namesConsentTopic, restrictiveAgreementFact,
  type NeedsUserCause,
} from '../resolver/labelRules';
import type { FieldClassification } from '../resolver/resolve';
import { capCodePoints } from '../text/fold';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import { sha256Hex } from '../text/sha256';
import { asUntrusted } from '../text/untrusted';
import type { FieldKey, FieldSpec } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { AnswerBasis } from '../types/intent';
import type { Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';
import { inClosedContext, type DraftContext } from './drafts';

/** What an answer is: one of the field's own options, or a short text (TailorIT's AUTOFILL_ANSWER_SHAPES). */
export type AnswerShape = 'choice' | 'text';

/** One option a choice is asked with: its own index, its clean label as sent, and that label's hash (never sent: the
 *  llm-pick it becomes names it, so the frame can tell the option still reads as the LLM saw it). */
export interface AnswerOption {
  index: number;
  label: UntrustedText;
  labelHash: string;
}

/** Which questions an answer request asks (TailorIT's AUTOFILL_ANSWER_SCOPES): `standard`, or `all`, which also asks
 *  the legal, criminal-history, pay and attention-check questions the profile leaves open (module header). */
export type AnswerScope = 'standard' | 'all';

/** One question to answer (TailorIT's AutofillAnswerItem). */
export interface AnswerItem {
  /** The field's key: the item's identity, repeated in the answer. */
  key: FieldKey;
  /** The scope it is asked under: `all` only for a question the standard scope would not ask. */
  scope: AnswerScope;
  shape: AnswerShape;
  kind: FieldKind;
  /** The field's visible label, quotable. */
  question: UntrustedText;
  /** Its visible description, '' when none. */
  hint: UntrustedText;
  /** Its section's words, '' for the form's main part. */
  section: UntrustedText;
  /** A choice's observed option-set hash; null for a text. */
  optionSetHash: string | null;
  /** A choice's options, in the field's order; [] for a text. */
  options: AnswerOption[];
  /** A text's cap: min(maxLength, ANSWER_TEXT_MAX), or null when the field names none (TailorIT then keeps to
   *  ANSWER_TEXT_MAX); null for a choice. */
  maxLength: number | null;
  /** The layout a text's answer must have (answerFormatOf); null for any short text, and for a choice. */
  format: AutofillAnswerFormat | null;
  /** v5 p2-stream (one round): a question nothing classified asks its category too, in the same task, on its frame's
   *  platform (frame.ts): its answer is used only as the category then allows (planFrame). */
  classify?: true;
  platform?: Platform;
}

/** Why an answer is not written (the worker maps TailorIT's reasons to these; the frame adds the checks of its own). */
export type AnswerDiscard = Extract<ReasonCode, 'llm-no-answer' | 'llm-invalid-output' | 'llm-unavailable'
  | 'llm-disabled-for-category' | 'canary-in-value' | 'options-changed' | 'llm-pick-rejected' | 'maxlength-exceeded'>;

/** TailorIT's answer for one field, as the worker read it: a chosen option (its index, the hash of its label as sent),
 *  a text, or why there is none. */
export type AnswerVerdict = (
  | { key: FieldKey; kind: 'choice'; optionSetHash: string; index: number; labelHash: string; basis: AnswerBasis;
      taskId: string }
  | { key: FieldKey; kind: 'text'; text: string; basis: AnswerBasis; taskId: string }
  | { key: FieldKey; kind: 'none'; why: AnswerDiscard }
) & {
  /** v5 p2-stream (one round): the answer came with its question's category, asked before any classification under
   *  this scope; planFrame uses it only where the category leaves the question to the AI under the same scope. */
  oneRound?: AnswerScope;
};

/** The kinds each shape answers (the contract's AUTOFILL_ANSWER_KINDS). */
const CHOICE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'combobox']);
const TEXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea']);

/** Formats an AI never writes: a contact detail, a link or a postal code is the profile's or the person's. A date is
 *  written only in a layout TailorIT checks it in (answerFormatOf). */
const NO_ANSWER_FORMATS: ReadonlySet<FieldFormat> = new Set<FieldFormat>(['email', 'tel', 'url', 'postal-code']);

/** The answer layouts that are a date or a month. */
const DATE_LAYOUTS: ReadonlySet<AutofillAnswerFormat> = new Set<AutofillAnswerFormat>(['date', 'MM/DD/YYYY',
  'DD/MM/YYYY', 'MM/YYYY']);

/**
 * The layout an answer must have in this field (TailorIT's API 4, AUTOFILL_ANSWER_FORMATS): a number box's number,
 * integer or currency; a date input's YYYY-MM-DD ('date'); a text date box's MM/DD/YYYY, DD/MM/YYYY or MM/YYYY, or
 * YYYY-MM-DD, as its pattern shows it. Null for any short text; undefined for a date box whose layout no format names
 * (a month input, DD.MM.YYYY, a date with no pattern): such a box is never asked.
 */
export function answerFormatOf(spec: Pick<FieldSpec, 'kind' | 'constraints'>): AutofillAnswerFormat | null | undefined {
  const format = spec.constraints.format;
  const pattern = (spec.constraints.pattern ?? '').trim().toUpperCase();
  if (spec.kind === 'date') return format === 'month-year' ? undefined : 'date';
  switch (format) {
    case 'number':
    case 'integer':
    case 'currency':
      return format;
    case 'date':
      return pattern === 'MM/DD/YYYY' || pattern === 'DD/MM/YYYY' ? pattern : pattern === 'YYYY-MM-DD' ? 'date' : undefined;
    case 'month-year':
      return pattern === 'MM/YYYY' ? 'MM/YYYY' : undefined;
    default:
      return null;
  }
}

/**
 * What an AI answer never states, read in a question's text, its hint, its section's words and its options (the Phase
 * E review, M2): another person's details (an emergency contact, a referee or reference, a manager's, a spouse's), an
 * identifier (a number, an ID, a licence, a passport, a social security or insurance number), a postal address and, jr6
 * fix (revD-01), the person's health. Lower case, over every detection view.
 */
const UNANSWERABLE: readonly RegExp[] = [
  // Another person.
  /\bemergency\b/, /\breferences?\b/, /\breferees?\b/, /\bnext\s+of\s+kin\b/, /\bspouses?\b/, /\bguardians?\b/,
  /\b(?:manager|supervisor|spouse|partner|parent|guardian)(?:'|’)s\b/,
  /\b(?:managers?|supervisors?)\s+(?:name|e\s?-?mail|phone|contact|title)\b/,
  // Identifiers (a bare "number" is BARE_NUMBER).
  /\bids?\b/, /\bidentification\b/, /\bidentifier\b/, /\blicen[cs]e[sd]?\b/, /\bpassports?\b/,
  /\bssn\b/, /\bsocial\s+(?:security|insurance)\b/, /\bnational\s+insurance\b/, /\btax\s+(?:id|file|number)\b/,
  // A postal address ("address" as a verb, "How would you address a conflict?", is none).
  /\b(?:home|mailing|postal|street|current|permanent|residential|billing|physical|full|your|e\s?-?mail)\s+address(?:es)?\b/,
  /^\W*address(?:es)?\b/, /\baddress\s+(?:line|1|2|of\s+residence)\b/, /\bstreet\b/, /\bzip\b/, /\bpostal\b/,
  /\bpost\s?codes?\b/, /\bp\.?\s?o\.?\s+box\b/, /\bapartment\b/, /\bwhere\s+do\s+you\s+(?:currently\s+)?live\b/,
  // jr6 fix (revD-01): the person's health, a disability or an accommodation they need ("Can you perform the essential
  // functions of this job without reasonable accommodation?", "Do you have any physical or mental condition that would
  // prevent you …?"): a self-identification's topic, which an AI answer would state for them (the owner's rule of
  // 2026-11-01: never a self-identification question), in any scope.
  /\baccommodations?\b/, /\bdisab(?:led|ility|ilities)\b/, /\bimpair(?:ed|ments?)\b/,
  /\b(?:physical|mental|medical|health|psychological|psychiatric|emotional)\s+(?:or\s+(?:physical|mental|medical|health|psychological|psychiatric|emotional)\s+)?(?:conditions?|impairments?|limitations?|illness(?:es)?|disorders?)\b/,
  /\bmedical\s+(?:history|reasons?)\b/,
];

/** A number the question asks for, which may be an identifier ("Number of years" counts, so a number followed by
 *  "of" is none). The `all` scope lets it through in a pay or attention-check question ("Enter a number only",
 *  "Select the number 7"). */
const BARE_NUMBER = /\bnumbers?\b(?!\s+of\b)/;

/** A security clearance (TS/SCI, secret, ITAR: the legal class), which only the `all` scope may ask about. */
const CLEARANCE: readonly RegExp[] = [/\bclearances?\b/, /\bts\s*[/-]?\s*sci\b/, /\bsecret\b/, /\bitar\b/, /\bpolygraph\b/];

/** The short identifiers matched in capitals only, as the page wrote them: SIN, NI ("sin" and "ni" are words too). */
const UNANSWERABLE_ACRONYMS: readonly RegExp[] = [/\bSIN\b/, /\bNI\b/];

/** What the `all` scope lets a question name besides what the standard scope does: a clearance, and a number. */
export interface AnswerAllowance {
  clearance?: boolean;
  number?: boolean;
}

/** Whether page text names what an AI answer never states (UNANSWERABLE, the Phase E review, M2; a bare number and a
 *  security clearance unless `allow` lets them through), asks for a consent (labelRules namesConsentTopic: a
 *  newsletter, being contacted about other roles, a talent pool), which only the person or a pre-approval gives, or is
 *  an "I did not use AI" attestation or a question whether AI wrote the application (the owner's decision of
 *  2026-11-01: never sent, in any scope). The audit of 2026-11-06 adds, in any scope: a bot check or CAPTCHA (S-2:
 *  "Are you a robot?", a sum, "Enter the characters you see in the image", "I'm not a robot"; guard/attention.ts), a
 *  question or statement about how the application was made, by a named assistant, automation, an extension or
 *  someone's help (S-4, labelRules asksHowApplicationMade), and a binding waiver or covenant (S-5, labelRules
 *  namesBindingWaiver). The worker screens each answer item again with it (ai-tasks.ts answerItemOfCore). */
export function namesUnanswerableTopic(text: string, allow: AnswerAllowance = {}): boolean {
  if (text.trim() === '') return false;
  if (UNANSWERABLE_ACRONYMS.some((acronym) => acronym.test(text))) return true;
  if (namesBotCheck(text) || attentionHits(text, '').some((id) => PERSON_ONLY_ATTENTION.has(id))) return true;
  const normalized = normalizeLabel(text);
  // jr6 RULES (jobvite-new-1): a restrictive agreement asked as a fact names a contract the person may hold, no
  // waiver an answer would give.
  if (namesConsentTopic(normalized) || attestsNoAiUse(normalized) || asksHowApplicationMade(normalized)
    || (namesBindingWaiver(normalized) && !restrictiveAgreementFact(normalized))) return true;
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    return UNANSWERABLE.some((pattern) => pattern.test(lower)) || (allow.number !== true && BARE_NUMBER.test(lower))
      || (allow.clearance !== true && CLEARANCE.some((pattern) => pattern.test(lower)));
  });
}

/** What an `all` item's own topics let it name (namesUnanswerableTopic): a clearance always, a number in a pay
 *  question or an attention check. */
export function allowanceOf(topics: ReadonlySet<ScreenTopic>, attention: boolean): AnswerAllowance {
  return { clearance: true, number: attention || topics.has('pay') };
}

/** The reasons a profile field's row gives for a gap an AI answer may fill (ANSWERABLE_PROFILE_CATEGORIES). */
const PROFILE_GAPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['no-profile-value', 'low-confidence', 'no-match',
  'ambiguous-options', 'unknown-field']);

/** The reasons an AI-only tie leaves (a list only the LLM classified, whose match the tiebreak may not settle). */
const TIE_GAPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['ambiguous-options', 'low-confidence']);

/** Whether the field's gap is one an AI answer may fill (module header), by its class, its row and how it was
 *  classified. */
function answerableGap(spec: FieldSpec, resolution: Resolution, row: FillResult): boolean {
  const { category } = resolution;
  if (USER_ONLY_CATEGORIES.has(category)) return false;
  switch (policyClassOf(category)) {
    case 'unknown':
      return row.reason === 'unknown-field';
    case 'free-text': {
      // A box too short for a draft; a longer one takes the draft path.
      const max = spec.constraints.maxLength;
      return resolution.reason === 'free-text-requires-user' && max !== undefined && max < DRAFT_MIN_LENGTH;
    }
    case 'profile':
      if (ANSWERABLE_PROFILE_CATEGORIES.has(category)) return PROFILE_GAPS.has(row.reason);
      return resolution.classifiedBy === 'llm-classify' && CHOICE_KINDS.has(spec.kind) && TIE_GAPS.has(row.reason);
    default:
      return false;
  }
}

/** A text cut after a whole code point limit, quotable. */
function quote(text: string, max: number): UntrustedText {
  return capCodePoints(asUntrusted(text as VisibleText, 4 * max), max).trimEnd() as UntrustedText;
}

/** The options a choice is asked with: every one that can be chosen and has a label, none whose label had injected text
 *  cut; null when the list was not read whole, already holds a choice, or has too few or too many to ask about. A
 *  search's results (v4, drop: FieldSpec.searchResults, one typed query's) are no list to ask about: the frame types its
 *  next query instead. */
function choiceOptions(spec: FieldSpec, context: DraftContext): AnswerOption[] | null {
  if (spec.options === 'lazy' || spec.optionsPartial === true || spec.searchResults === true) return null;
  const prepared = prepareOptions(spec.options, 'generic', context.vocab);
  // A list with a choice of its own (the page's, the person's) is theirs. A native select always shows an option, so
  // its selection says something only when it has a placeholder to show instead (planChoice's rule).
  const selected = prepared.list.some((option) => option.selected && !option.unusable && !option.placeholder);
  const labels = spec.current.kind === 'selected' ? spec.current.labels.filter((label) => label.trim() !== '') : [];
  const holds = spec.kind === 'select' ? selected && prepared.list.some((option) => option.placeholder)
    : selected || labels.length > 0;
  if (holds) return null;
  const usable = prepared.list.filter((option) => chooseable(option) && !option.injected && option.clean.trim() !== '');
  if (usable.length < ANSWER_MIN_OPTIONS || usable.length > ANSWER_MAX_OPTIONS) return null;
  const options = usable.map((option) => {
    const label = asUntrusted(option.clean as VisibleText, TIEBREAK_LABEL_MAX);
    return { index: option.index, label, labelHash: sha256Hex(label) };
  });
  return options.some((option) => option.label === '') ? null : options;
}

/** The texts a field's answer screens read: its label, description, section's words and options, injected text cut. */
function screenedTexts(spec: FieldSpec): string[] {
  const options = spec.options === 'lazy' ? [] : spec.options.map((option) => cutInjected(option.label).clean);
  return [spec.label, spec.description, sectionWordsOfKey(sectionKey(spec.section)), ...options];
}

/** Whether a field's question is one the standard scope answers (module header): no attention check, no rule or LLM
 *  handing it to the person, a gap an answer may fill, no EEO, legal or sensitive context, and no clearance or bare
 *  number named. */
function standardAnswerable(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, context: DraftContext): boolean {
  if (classification.by === 'attention') return false;
  if (classification.by === 'rules' && classification.rules.needsUser !== undefined) return false;
  // What the LLM hands to the person (a sensitive, consent or attention-check question) is theirs; a free-text
  // question it names takes a draft, or an answer when its box is short.
  if (classification.by === 'llm' && classification.llm.kind === 'needs-user'
    && policyClassOf(classification.llm.category) !== 'free-text') return false;
  if (!answerableGap(spec, resolution, row)) return false;
  if (inClosedContext(spec, context)) return false;
  return !screenedTexts(spec).some((text) => namesUnanswerableTopic(text));
}

/** What a rule's hand-off to the person still lets the `all` scope answer: a legal question on a kind its profile
 *  answer could not be matched into (a yes or no in a text box), one read from its help text, authorization tied to
 *  sponsorship, a sponsorship time that cannot be read, a work permit, a nationality, an age (never a birth date). */
const OPENABLE_CAUSES: ReadonlySet<NeedsUserCause> = new Set<NeedsUserCause>(['kind-mismatch', 'description-only',
  'authorization-and-sponsorship', 'unclear-time', 'work-permit', 'nationality', 'age']);

/** The reasons an opened category's row gives when the profile holds no answer for it. A decline the person gave, a
 *  value that matched no option, a failed fetch, and a sensitive part this browser may not read (`sensitive-not-shared`:
 *  the person may hold an answer there, which a guess must never overrule) stay as they are, and so does a country the
 *  question does not settle, unless the profile holds no work-authorization entry at all (openGap). */
const OPEN_GAPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['legal-not-in-profile', 'criminal-not-covered',
  'no-profile-value', 'attention-check', 'llm-disabled-for-category']);

/** Whether an opened category's row is a gap the `all` scope answers (OPEN_GAPS). */
const openGap = (reason: ReasonCode, context: DraftContext) => OPEN_GAPS.has(reason)
  || (reason === 'work-auth-country-unknown' && context.noWorkAuthorization === true);

/** A birth date, which no AI answer ever gives (an identifier the facts do not hold). */
const BIRTH_DATE = /\b(?:date\s+of\s+birth|birth\s*(?:date|day|year|place)|years?\s+of\s+birth|dob|born)\b/;

/** Whether a field's question is one the `all` scope answers (module header): an attention check with no consent of
 *  its own, an opened category, a question the classify screen kept from the LLM, or a gap the standard scope only
 *  left for its context, whose own text names only open topics (at least one, but for an attention check, an opened
 *  category and a box closed by its context alone, such as "Please provide details" after a felony question), in a
 *  context of no self-identification, consent or pronoun question. Answers its topics. */
function openAnswerable(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, context: DraftContext): { topics: ReadonlySet<ScreenTopic>; attention: boolean } | null {
  const attention = classification.by === 'attention';
  if (attention && (classification.consent !== null || classification.botCheck === true)) return null;
  // A check of what the applicant did (the posting's phrase or code word) is the person's alone (the Phase 7a review),
  // and so is a bot check (the audit of 2026-11-06, S-2).
  if (attention && attentionHits(spec.label, spec.description).some((id) => PERSON_ONLY_ATTENTION.has(id))) return null;
  if (classification.by === 'rules' && classification.rules.needsUser !== undefined
    && !OPENABLE_CAUSES.has(classification.rules.needsUser)) return null;
  if (classification.by === 'rules' && classification.rules.needsUser === 'age' && !CHOICE_KINDS.has(spec.kind)) {
    return null;
  }
  const opened = attention || AI_OPENED_CATEGORIES.has(resolution.category);
  // A question the classify screen kept from the LLM is unknown; any other closed only by its context keeps its gap.
  const screened = resolution.category === 'unknown' && row.reason === 'llm-disabled-for-category';
  if (!(opened ? openGap(row.reason, context) : screened || answerableGap(spec, resolution, row))) return null;
  const named = openAnswerTopics(spec, context.vocab, attention);
  if (named === null) return null;
  const texts = screenedTexts(spec);
  const lowered = texts.flatMap((text) => detectionViews(text).map((view) => view.toLowerCase()));
  // A clearance named with no topic word ("Do you hold an active TS/SCI?") is work authorization.
  const topics: ReadonlySet<ScreenTopic> = lowered.some((view) => CLEARANCE.some((pattern) => pattern.test(view)))
    ? new Set<ScreenTopic>([...named, 'authorization']) : named;
  if (!opened && topics.size === 0 && !inClosedContext(spec, context)) return null;
  if (lowered.some((view) => BIRTH_DATE.test(view))) return null;
  if (texts.some((text) => namesUnanswerableTopic(text, allowanceOf(topics, attention)))) return null;
  return inClosedContext(spec, context, true) ? null : { topics, attention };
}

/** The scope a field's question is answered under, its options aside (module header), or null for none: writable,
 *  labelled for the LLM, no tripwire, no saved answer, never about another person; then the standard scope's
 *  question, or with `answerAll` the `all` scope's. */
function answerScope(spec: FieldSpec, classification: FieldClassification, resolution: Resolution, row: FillResult,
  writable: boolean, context: DraftContext, answerAll: boolean): AnswerScope | null {
  if (!writable || !classifiable(spec) || !llmMaySeeLabel(spec.labelSource)) return null;
  if (classification.by === 'tripwire') return null;
  // v1.3 B: nor one an earlier submitted answer settles (its option gone included); v1.5 X: nor a prepared one.
  if (resolution.classifiedBy === 'saved' || resolution.classifiedBy === 'submitted'
    || resolution.classifiedBy === 'prebuilt' || row.status === 'blocked' || row.wrote) return null;
  if (namesAnotherPerson(spec)) return null;
  if (standardAnswerable(spec, classification, resolution, row, context)) return 'standard';
  return answerAll && openAnswerable(spec, classification, resolution, row, context) !== null ? 'all' : null;
}

/**
 * Whether a field would be asked once its options are read (the Phase E review, M7): a single choice whose list is
 * lazy (a combobox read only when opened) and whose question is answerable. The planner then rows it
 * waiting-for-options, so the loop reads the widget and the next pass asks with the real options.
 */
export function answerWaitsForOptions(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, writable: boolean, context: DraftContext, answerAll = false): boolean {
  return spec.options === 'lazy' && CHOICE_KINDS.has(spec.kind)
    && answerScope(spec, classification, resolution, row, writable, context, answerAll) !== null;
}

/**
 * The answer item of a field, or null when it gets none (module header). `row` is the row planField gave it (the gap
 * it leaves), `writable` the planner's own check (no honeypot, not disabled or read-only), `answerAll` the person's
 * setting (settings.modes.ai 'all': the `all` scope).
 */
export function answerItemOf(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, writable: boolean, context: DraftContext, answerAll = false): AnswerItem | null {
  const scope = answerScope(spec, classification, resolution, row, writable, context, answerAll);
  if (scope === null) return null;
  const question = quote(spec.label, ANSWER_QUESTION_MAX);
  if (question === '') return null;
  const base = { key: spec.key, scope, kind: spec.kind, question, hint: quote(spec.description, ANSWER_HINT_MAX),
    section: quote(sectionWordsOfKey(sectionKey(spec.section)), ANSWER_SECTION_MAX) };
  if (CHOICE_KINDS.has(spec.kind)) {
    const options = choiceOptions(spec, context);
    if (options === null || spec.optionSetHash === 'lazy' || spec.optionSetHash === 'none') return null;
    return { ...base, shape: 'choice', optionSetHash: spec.optionSetHash, options, maxLength: null, format: null };
  }
  if (!TEXT_KINDS.has(spec.kind) && spec.kind !== 'date') return null;
  if (spec.current.kind === 'text' ? spec.current.text.trim() !== '' : spec.current.kind !== 'empty') return null;
  const format = spec.constraints.format;
  if (format !== undefined && NO_ANSWER_FORMATS.has(format)) return null;
  const layout = answerFormatOf(spec);
  if (layout === undefined) return null;
  // A birth date is never asked, whatever its layout (an identifier the facts do not hold).
  if (layout !== null && DATE_LAYOUTS.has(layout)
    && screenedTexts(spec).some((text) => detectionViews(text).some((view) => BIRTH_DATE.test(view.toLowerCase())))) {
    return null;
  }
  const max = spec.constraints.maxLength;
  if (max !== undefined && max < 1) return null;
  return { ...base, shape: 'text', optionSetHash: null, options: [],
    maxLength: max === undefined ? null : Math.min(max, ANSWER_TEXT_MAX), format: layout };
}

/** The cap an answer's text is held to in this field: its maxLength, never more than ANSWER_TEXT_MAX. */
export function answerCap(spec: Pick<FieldSpec, 'constraints'>): number {
  const max = spec.constraints.maxLength;
  return max === undefined ? ANSWER_TEXT_MAX : Math.min(max, ANSWER_TEXT_MAX);
}

/** Why an answer's text may not be written into this field, or null: empty, past its cap, a line break in a one-line
 *  box, in a number box (format number, integer or currency) anything but one number (numberAnswer), or in a date
 *  input anything but one YYYY-MM-DD date (its layout, answerFormatOf, which the worker checked it in). */
export function answerRefusal(spec: Pick<FieldSpec, 'constraints' | 'kind'>, text: string): AnswerDiscard | null {
  if (text.trim() === '') return 'llm-no-answer';
  if ([...text].length > answerCap(spec)) return 'maxlength-exceeded';
  if (spec.kind === 'text' && /[\r\n]/.test(text)) return 'llm-invalid-output';
  if (spec.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return 'llm-invalid-output';
  return answerText(spec, text) === null ? 'llm-invalid-output' : null;
}

/** The formats whose box takes one number (a Workable salary box drops anything else). */
const NUMBER_FORMATS: ReadonlySet<FieldFormat> = new Set<FieldFormat>(['number', 'integer', 'currency']);

/** What an answer writes into this field: in a number box, the one number its text states (numberAnswer), else the
 *  text itself; null when a number box's text states no single number. */
export function answerText(spec: Pick<FieldSpec, 'constraints'>, text: string): string | null {
  const format = spec.constraints.format;
  return format !== undefined && NUMBER_FORMATS.has(format) ? numberAnswer(text, format === 'integer') : text;
}

/** Two amounts joined as a range ("80-90k", "80,000 to 90,000", "80k/90k"). */
const RANGE = /[\dk]\s*(?:[-–—/]|\bto\b|\band\b|\bor\b)\s*[$€£¥₹]?\s*\d/i;
/** A currency's sign or code beside an amount. */
const CURRENCY = /[$€£¥₹]|\b(?:US|CA|AU|NZ|HK|SG)\$|\b(?:USD|EUR|GBP|CAD|AUD|NZD|CHF|INR|JPY|SGD|HKD|SEK|NOK|DKK|PLN|BRL|MXN)\b/g;
/** One amount: digits with thousands separators (comma, space, apostrophe) or none, a decimal part, and "k". */
const AMOUNT = /^(\d{1,3}(?:[,' \u00a0\u202f]\d{3})+|\d+)(?:\.(\d+))?\s*(k)?$/i;
/** Dots as thousands separators, twice or more ("1.250.000"); one such dot ("4.500") could be either. */
const DOTTED = /^\d{1,3}(?:\.\d{3}){2,}$/;

/**
 * The one number an AI's answer states for a number box, as plain digits (a point and at most two decimals unless
 * `integer`): its currency sign or code and its thousands separators gone, "k" as thousands ("$85,000" and "85k" are
 * "85000", "1.250.000" is "1250000"). Null for a range, words, two numbers, one dot that could be a decimal or a
 * thousands separator ("4.500"), or a fraction in an integer box.
 */
export function numberAnswer(text: string, integer = false): string | null {
  if (RANGE.test(text)) return null;
  const bare = text.replace(CURRENCY, ' ').trim();
  const dotted = DOTTED.test(bare) ? bare.replace(/\./g, '') : bare;
  if (/^\d{1,3}\.\d{3}$/.test(dotted)) return null;
  const amount = AMOUNT.exec(dotted);
  if (amount === null) return null;
  const whole = amount[1]!.replace(/[,' \u00a0\u202f]/g, '');
  let value = Number(`${whole}.${amount[2] ?? '0'}`) * (amount[3] === undefined ? 1 : 1000);
  if (!Number.isFinite(value)) return null;
  value = Math.round(value * 100) / 100;
  if (integer && !Number.isInteger(value)) return null;
  return String(value);
}
