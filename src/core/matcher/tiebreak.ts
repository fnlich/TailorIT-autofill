/*
 * Stage d, the LLM tiebreak (docs/design/core.md §4.6, docs/ARCHITECTURE.md "The LLM tiebreak"). The LLM has no
 * authority: it answers an index into a list the code built, or null, and the code decides what that means.
 * - Only institutions, degrees, fields, languages, proficiencies, referral sources and generic custom questions are
 *   asked, as TailorIT's pick categories. EEO, legal, salary, consent, country and region values never are: the
 *   domain table and the policy classes keep them out (domains.ts), and the request builder refuses any other
 *   category.
 * - A task holds at most 20 items, each with 1 to 30 guard-passing candidates and at most 10 aliases, and the
 *   observed 16-hex option-set hash. Page text goes out only as UntrustedText, and only the clean part of a label.
 *   TailorIT's caps on a value, an alias, a key and a request's text are kept too, since one string over them would
 *   have the whole request refused.
 * - No candidate is a hard conflict: the guard's (§4.5), the degree rules' (§4.9, a field of study included), or an
 *   option the vocabulary resolves only to other entities it knows ("Glassdoor" is not LinkedIn).
 * - A school known only by an acronym nobody confirmed ("OSU" with no id) is never sent: the guard leaves only the
 *   options that name no place, which are not the schools the acronym stands for (scope.ts, restsOnAcronymsAlone).
 * - Each item's id is unique in a pass: two values of one field (a multi-select's, a typeahead's result lists) carry
 *   their own reference, two different items under one id are refused rather than merged, and a verdict completes
 *   only the item it was given for.
 * - The answer must be `{answers: [{id, index}]}` with an integer index in range, naming neither a hard-conflict nor
 *   an injected candidate; anything else is no pick. A valid pick scores 0.75, so it is always flagged, and it is
 *   never cached until the person confirms it.
 */
import {
  MATCH_LLM_PICK, TIEBREAK_ALIAS_MAX, TIEBREAK_ID_MAX, TIEBREAK_INTENDED_MAX, TIEBREAK_LABEL_MAX, TIEBREAK_MAX_ALIASES,
  TIEBREAK_MAX_CANDIDATES, TIEBREAK_MAX_ITEMS, TIEBREAK_MIN_CANDIDATES, TIEBREAK_REQUEST_TEXT_MAX,
  TIEBREAK_REQUEST_TEXT_SHARE,
} from '../confidence';
import { sha256Hex } from '../text/sha256';
import { asUntrusted } from '../text/untrusted';
import type { ReasonCode } from '../types/fill';
import type { VocabDomain } from '../types/intent';
import type { Match } from '../types/match';
import type { VisibleText } from '../types/text';
import { degreeConflict } from './degree';
import { namesKnownOther } from './exact';
import { scoreOptions } from './fuzzy';
import { substantive } from './prepare';
import { restsOnAcronymsAlone, type Scope } from './scope';
import {
  PICK_CATEGORIES, type MatchDomain, type MatchInput, type PartialMatch, type PickCategory, type PreparedOption,
  type PreparedOptions, type TiebreakCandidate, type TiebreakFn, type TiebreakItem, type TiebreakRequest,
  type TiebreakVerdict,
} from './types';

/** The pick category each LLM-allowed domain is sent as (§4.6). No other domain is sent. */
export const PICK_CATEGORY_BY_DOMAIN = {
  institution: 'school', degree: 'degree', field: 'field_of_study', language: 'language',
  proficiency: 'language_proficiency', referral: 'referral_source', generic: 'generic',
} as const satisfies Partial<Record<VocabDomain, PickCategory>>;

/** The pick category of a domain, or null when the LLM may never see its values. */
export function pickCategory(domain: MatchDomain): PickCategory | null {
  return (PICK_CATEGORY_BY_DOMAIN as Partial<Record<MatchDomain, PickCategory>>)[domain] ?? null;
}

const OBSERVED_HASH = /^[0-9a-f]{16}$/;

/** The number of code points in a string, as TailorIT's schema counts its caps. */
const codePoints = (text: string): number => [...text].length;

/**
 * The tiebreak item's id for a match input: the field key, and when the input names which of the field's values it is
 * (`valueRef`), that reference and the option-set hash too, so two values of one field never share an id.
 */
export function tiebreakId(input: Pick<MatchInput, 'key' | 'valueRef' | 'optionSetHash'>): string {
  return input.valueRef === undefined ? input.key : `${input.key}#${input.valueRef}@${input.optionSetHash}`;
}

/** An option that no stage, the LLM and the cache included, may choose for the intended value: the guard rules it
 *  out for good (rules 1, 3, 4), it names only other entities the vocabulary knows, or the degree rules rule it out. */
export function hardConflict(scope: Scope, option: PreparedOption): boolean {
  const verdict = scope.verdict(option);
  if (!verdict.pass && verdict.hard) return true;
  if (namesKnownOther(scope, option)) return true;
  const { intended } = scope.input;
  return intended.kind === 'degree'
    && degreeConflict({ level: intended.level, type: intended.type }, option.degree, scope.vocab,
      scope.input.degreeField);
}

/**
 * Whether an option may be offered to the LLM: substantive, passing the distinctive-token guard, and no hard conflict
 * (another known entity, or in the degree domain another level, type class or field of study).
 */
export function guardPassing(scope: Scope, option: PreparedOption): boolean {
  return substantive(option) && scope.verdict(option).pass && !hardConflict(scope, option);
}

/**
 * The candidates for stage d: the tied options for a tie; otherwise every guard-passing option of a list of at most
 * 30, else the 30 guard-passing options with the best fuzzy scores. Always in option order.
 */
export function tiebreakCandidates(scope: Scope, options: PreparedOptions, tied?: readonly PreparedOption[]):
  PreparedOption[] {
  if (tied) return tied.filter((option) => guardPassing(scope, option)).sort((a, b) => a.index - b.index);
  const answers = options.list.filter(substantive);
  if (answers.length <= TIEBREAK_MAX_CANDIDATES) return answers.filter((option) => guardPassing(scope, option));
  return scoreOptions(scope, options).filter((item) => guardPassing(scope, item.option))
    .slice(0, TIEBREAK_MAX_CANDIDATES).map((item) => item.option).sort((a, b) => a.index - b.index);
}

/** An option as the LLM sees it: its clean label only, with the label's hash for the provenance check. */
export function candidateOf(scope: Scope, option: PreparedOption): TiebreakCandidate {
  // Option labels come from visibleText's option reader (docs/ARCHITECTURE.md, Visibility); FieldSpec carries them
  // as plain strings.
  const label = asUntrusted(option.clean as VisibleText, TIEBREAK_LABEL_MAX);
  return { optionIndex: option.index, label, labelHash: sha256Hex(label), hardConflict: hardConflict(scope, option),
    injected: option.injected };
}

/** The intended value's other spellings, at most 10, none repeating the display and none longer than TailorIT
 *  takes (dropped, never cut: a cut spelling may name something else). */
function aliasesOf(scope: Scope): string[] {
  const seen = new Set<string>();
  const display = scope.surfaces.find((surface) => surface.text === scope.display)?.norm.key;
  if (display !== undefined) seen.add(display);
  const out: string[] = [];
  for (const surface of scope.surfaces) {
    if (out.length >= TIEBREAK_MAX_ALIASES) break;
    if (surface.text === scope.display || seen.has(surface.norm.key) || surface.norm.key === '') continue;
    if (codePoints(surface.text) > TIEBREAK_ALIAS_MAX) continue;
    seen.add(surface.norm.key);
    out.push(surface.text);
  }
  return out;
}

/** What the LLM is told the person means: the canonical display, with a degree's field of study when the entry has
 *  one ("Bachelor of Science in Physics"), since the field decides which combined option fits. */
function intendedText(scope: Scope): string {
  const field = scope.input.intended.kind === 'degree' ? scope.input.degreeField?.name.trim() : undefined;
  return field ? `${scope.display} in ${field}` : scope.display;
}

/** The tiebreak item and what completes it, or null when the domain may not be sent, nothing can be offered, the value
 *  is a school known only by an unconfirmed acronym, or the value or id is longer than TailorIT takes. */
export function buildTiebreak(scope: Scope, candidates: readonly PreparedOption[], fallback: Match):
  { item: TiebreakItem; partial: PartialMatch } | null {
  const category = pickCategory(scope.domain);
  const { input } = scope;
  const intended = intendedText(scope);
  const id = tiebreakId(input);
  if (category === null || !OBSERVED_HASH.test(input.optionSetHash) || intended.trim() === '') return null;
  if (restsOnAcronymsAlone(scope)) return null;
  if (codePoints(intended) > TIEBREAK_INTENDED_MAX || codePoints(id) > TIEBREAK_ID_MAX) return null;
  if (candidates.length < TIEBREAK_MIN_CANDIDATES || candidates.length > TIEBREAK_MAX_CANDIDATES) return null;
  const sent = candidates.map((option) => candidateOf(scope, option));
  const item: TiebreakItem = {
    id, category, fieldLabel: input.fieldLabel, optionSetHash: input.optionSetHash, intended,
    aliases: aliasesOf(scope), candidates: sent,
  };
  const partial: PartialMatch = {
    id, optionSetHash: input.optionSetHash, fallback,
    candidates: sent.map(({ optionIndex, labelHash, hardConflict: conflict, injected }) =>
      ({ optionIndex, labelHash, hardConflict: conflict, injected })),
  };
  return { item, partial };
}

/** Whether an item may be sent at all (checked again here, so a hand-built item cannot slip a category or an
 *  over-long string through). */
function sendable(item: TiebreakItem): boolean {
  return (PICK_CATEGORIES as readonly string[]).includes(item.category) && OBSERVED_HASH.test(item.optionSetHash)
    && item.candidates.length >= TIEBREAK_MIN_CANDIDATES && item.candidates.length <= TIEBREAK_MAX_CANDIDATES
    && item.intended.trim() !== '' && codePoints(item.intended) <= TIEBREAK_INTENDED_MAX
    && item.id !== '' && codePoints(item.id) <= TIEBREAK_ID_MAX
    && item.candidates.every((candidate) => codePoints(candidate.label) <= TIEBREAK_LABEL_MAX);
}

/** The ids two different items share. Such items are never merged and never sent: an answer could not say which of
 *  them it is for. Equal items under one id are one question. */
export function clashingIds(items: readonly TiebreakItem[]): Set<string> {
  const first = new Map<string, string>();
  const clashing = new Set<string>();
  for (const item of items) {
    const json = JSON.stringify(item);
    const known = first.get(item.id);
    if (known === undefined) first.set(item.id, json);
    else if (known !== json) clashing.add(item.id);
  }
  return clashing;
}

/** The most text one task may hold, as counted here (TIEBREAK_REQUEST_TEXT_SHARE of TailorIT's cap). */
const TASK_TEXT_BUDGET = Math.floor(TIEBREAK_REQUEST_TEXT_MAX * TIEBREAK_REQUEST_TEXT_SHARE);

/**
 * The tasks for a pass's items: the sendable ones, each id once (two different items under one id are refused), at
 * most 20 items per task and less text than TailorIT's cap, over-long aliases dropped and the rest cut to 10.
 */
export function tiebreakRequests(items: readonly TiebreakItem[]): TiebreakRequest[] {
  const clashing = clashingIds(items);
  const seen = new Set<string>();
  const ready: TiebreakItem[] = [];
  for (const item of items) {
    if (!sendable(item) || clashing.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const aliases = item.aliases.filter((alias) => codePoints(alias) <= TIEBREAK_ALIAS_MAX)
      .slice(0, TIEBREAK_MAX_ALIASES);
    ready.push({ ...item, aliases });
  }
  const requests: TiebreakRequest[] = [];
  let task: TiebreakItem[] = [];
  let size = 0;
  for (const item of ready) {
    const itemSize = JSON.stringify(item).length + 1;
    if (task.length === TIEBREAK_MAX_ITEMS || (task.length > 0 && size + itemSize > TASK_TEXT_BUDGET)) {
      requests.push({ v: 1, items: task });
      task = [];
      size = 0;
    }
    task.push(item);
    size += itemSize;
  }
  if (task.length > 0) requests.push({ v: 1, items: task });
  return requests;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A verdict for `item`. */
function verdictOf(item: Pick<TiebreakItem, 'id' | 'optionSetHash'>, picked: number | null, why: ReasonCode,
  labelHash: string | null = null): TiebreakVerdict {
  return { id: item.id, optionSetHash: item.optionSetHash, picked, labelHash, why };
}

/** One answer, judged against its item. */
function judge(item: TiebreakItem, answer: Record<string, unknown>): TiebreakVerdict {
  if ('optionSetHash' in answer && answer.optionSetHash !== item.optionSetHash) {
    return verdictOf(item, null, 'llm-invalid-output');
  }
  const index = answer.index;
  if (index === null) return verdictOf(item, null, 'no-match');
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= item.candidates.length) {
    return verdictOf(item, null, 'llm-invalid-output');
  }
  const candidate = item.candidates[index]!;
  if (candidate.hardConflict || candidate.injected) return verdictOf(item, null, 'llm-pick-rejected');
  return verdictOf(item, index, 'ok', candidate.labelHash);
}

/**
 * Validates a tiebreak answer in code (§4.6). Every item gets a verdict: a pick, or why there is none. A reply that
 * fails its shape, an item answered twice or not at all, a non-integer or out-of-range index, or an echoed hash that
 * differs is `llm-invalid-output`; a pick of a hard-conflict or injected candidate is `llm-pick-rejected`; null is
 * `no-match`. Answers with unknown ids are ignored.
 */
export function readTiebreakReply(items: readonly TiebreakItem[], reply: unknown): Map<string, TiebreakVerdict> {
  const verdicts = new Map<string, TiebreakVerdict>();
  const byId = new Map(items.map((item) => [item.id, item]));
  if (isRecord(reply) && Array.isArray(reply.answers)) {
    const answered = new Map<string, number>();
    for (const answer of reply.answers as unknown[]) {
      if (!isRecord(answer) || typeof answer.id !== 'string') continue;
      const item = byId.get(answer.id);
      if (!item) continue;
      answered.set(item.id, (answered.get(item.id) ?? 0) + 1);
      verdicts.set(item.id, judge(item, answer));
    }
    for (const [id, count] of answered) {
      if (count > 1) verdicts.set(id, verdictOf(byId.get(id)!, null, 'llm-invalid-output'));
    }
  }
  for (const item of items) {
    if (!verdicts.has(item.id)) verdicts.set(item.id, verdictOf(item, null, 'llm-invalid-output'));
  }
  return verdicts;
}

/**
 * Asks the LLM about every item, one task at a time (TailorIT allows two tasks per user and kind; one stays free),
 * and validates each answer. A task that fails or times out gives `llm-unavailable` for its items; two different
 * items under one id give `llm-invalid-output`; an item that may not be sent gives `llm-disabled-for-category`.
 */
export async function runTiebreaks(items: readonly TiebreakItem[], llm: TiebreakFn):
  Promise<Map<string, TiebreakVerdict>> {
  const verdicts = new Map<string, TiebreakVerdict>();
  const clashing = clashingIds(items);
  for (const item of items) {
    if (clashing.has(item.id) && !verdicts.has(item.id)) {
      verdicts.set(item.id, verdictOf(item, null, 'llm-invalid-output'));
    }
  }
  for (const request of tiebreakRequests(items)) {
    let reply: unknown;
    try {
      reply = await llm(request);
    } catch {
      for (const item of request.items) verdicts.set(item.id, verdictOf(item, null, 'llm-unavailable'));
      continue;
    }
    for (const [id, verdict] of readTiebreakReply(request.items, reply)) verdicts.set(id, verdict);
  }
  for (const item of items) {
    if (!verdicts.has(item.id)) verdicts.set(item.id, verdictOf(item, null, 'llm-disabled-for-category'));
  }
  return verdicts;
}

/**
 * The match once the LLM has answered (§4.0). A valid pick of a clean, guard-passing candidate gives stage 'llm',
 * rule 'llm-index', confidence 0.75 (always flagged). A verdict given for another item (another id or option-set
 * hash), or naming a candidate whose label hash differs, is `llm-invalid-output`. Otherwise the fallback stands:
 * "Other" plus free text when the form offers it, else blank, carrying why the LLM gave nothing.
 */
export function completeTiebreak(partial: PartialMatch, verdict: TiebreakVerdict): Match {
  const own = verdict.id === partial.id && verdict.optionSetHash === partial.optionSetHash;
  let reason: ReasonCode = own ? verdict.why : 'llm-invalid-output';
  const picked = own ? verdict.picked : null;
  if (picked !== null) {
    const candidate = Number.isInteger(picked) ? partial.candidates[picked] : undefined;
    if (candidate && !candidate.hardConflict && !candidate.injected && verdict.labelHash === candidate.labelHash) {
      return { stage: 'llm', optionIndex: candidate.optionIndex, rule: 'llm-index', confidence: MATCH_LLM_PICK,
        flags: [], suggestions: [], reason: 'llm-pick-needs-review' };
    }
    reason = candidate && (candidate.hardConflict || candidate.injected) ? 'llm-pick-rejected' : 'llm-invalid-output';
  }
  const { fallback } = partial;
  if (fallback.stage !== 'none') return fallback;
  return { ...fallback, reason: reason === 'ok' || reason === 'no-match' ? fallback.reason : reason };
}
