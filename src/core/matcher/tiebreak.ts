/*
 * Stage d, the LLM tiebreak (docs/design/core.md §4.6, docs/ARCHITECTURE.md "The LLM tiebreak"). The LLM has no
 * authority: it answers an index into a list the code built, or null, and the code decides what that means.
 * - Only institutions, degrees, fields, languages, proficiencies, referral sources and generic custom questions are
 *   asked, as TailorIT's pick categories. EEO, legal, salary, consent, country and region values never are: the
 *   domain table and the policy classes keep them out (domains.ts), and the request builder refuses any other
 *   category.
 * - A task holds at most 20 items, each with 1 to 30 guard-passing candidates and at most 10 aliases, and the
 *   observed 16-hex option-set hash. Page text goes out only as UntrustedText, and only the clean part of a label.
 * - The answer must be `{answers: [{id, index}]}` with an integer index in range, naming neither a hard-conflict nor
 *   an injected candidate; anything else is no pick. A valid pick scores 0.75, so it is always flagged, and it is
 *   never cached until the person confirms it.
 */
import {
  MATCH_LLM_PICK, TIEBREAK_LABEL_MAX, TIEBREAK_MAX_ALIASES, TIEBREAK_MAX_CANDIDATES, TIEBREAK_MAX_ITEMS,
  TIEBREAK_MIN_CANDIDATES,
} from '../confidence';
import { sha256Hex } from '../text/sha256';
import { asUntrusted } from '../text/untrusted';
import type { ReasonCode } from '../types/fill';
import type { VocabDomain } from '../types/intent';
import type { Match } from '../types/match';
import type { VisibleText } from '../types/text';
import { degreeConflict } from './degree';
import { scoreOptions } from './fuzzy';
import { substantive } from './prepare';
import type { Scope } from './scope';
import {
  PICK_CATEGORIES, type MatchDomain, type PartialMatch, type PickCategory, type PreparedOption, type PreparedOptions,
  type TiebreakCandidate, type TiebreakFn, type TiebreakItem, type TiebreakRequest, type TiebreakVerdict,
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

/**
 * Whether an option may be offered to the LLM: substantive, passing the distinctive-token guard, and in the degree
 * domain consistent with the intended level and type class.
 */
export function guardPassing(scope: Scope, option: PreparedOption): boolean {
  if (!substantive(option) || !scope.verdict(option).pass) return false;
  const { intended } = scope.input;
  if (intended.kind !== 'degree') return true;
  return !degreeConflict({ level: intended.level, type: intended.type }, option.degree, scope.vocab);
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
  const verdict = scope.verdict(option);
  return { optionIndex: option.index, label, labelHash: sha256Hex(label),
    hardConflict: !verdict.pass && verdict.hard, injected: option.injected };
}

/** The intended value's other spellings, at most 10, none repeating the display. */
function aliasesOf(scope: Scope): string[] {
  const seen = new Set<string>();
  const display = scope.surfaces.find((surface) => surface.text === scope.display)?.norm.key;
  if (display !== undefined) seen.add(display);
  const out: string[] = [];
  for (const surface of scope.surfaces) {
    if (out.length >= TIEBREAK_MAX_ALIASES) break;
    if (surface.text === scope.display || seen.has(surface.norm.key) || surface.norm.key === '') continue;
    seen.add(surface.norm.key);
    out.push(surface.text);
  }
  return out;
}

/** The tiebreak item and what completes it, or null when the domain may not be sent or nothing can be offered. */
export function buildTiebreak(scope: Scope, candidates: readonly PreparedOption[], fallback: Match):
  { item: TiebreakItem; partial: PartialMatch } | null {
  const category = pickCategory(scope.domain);
  const { input } = scope;
  if (category === null || !OBSERVED_HASH.test(input.optionSetHash) || scope.display.trim() === '') return null;
  if (candidates.length < TIEBREAK_MIN_CANDIDATES || candidates.length > TIEBREAK_MAX_CANDIDATES) return null;
  const sent = candidates.map((option) => candidateOf(scope, option));
  const item: TiebreakItem = {
    id: input.key, category, fieldLabel: input.fieldLabel, optionSetHash: input.optionSetHash, intended: scope.display,
    aliases: aliasesOf(scope), candidates: sent,
  };
  const partial: PartialMatch = {
    id: input.key, optionSetHash: input.optionSetHash, fallback,
    candidates: sent.map(({ optionIndex, labelHash, hardConflict, injected }) =>
      ({ optionIndex, labelHash, hardConflict, injected })),
  };
  return { item, partial };
}

/** Whether an item may be sent at all (checked again here, so a hand-built item cannot slip a category through). */
function sendable(item: TiebreakItem): boolean {
  return (PICK_CATEGORIES as readonly string[]).includes(item.category) && OBSERVED_HASH.test(item.optionSetHash)
    && item.candidates.length >= TIEBREAK_MIN_CANDIDATES && item.candidates.length <= TIEBREAK_MAX_CANDIDATES
    && item.intended.trim() !== '';
}

/** The tasks for a pass's items: the sendable ones, at most 20 per task, aliases cut to 10, each id once. */
export function tiebreakRequests(items: readonly TiebreakItem[]): TiebreakRequest[] {
  const seen = new Set<string>();
  const ready: TiebreakItem[] = [];
  for (const item of items) {
    if (!sendable(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    ready.push({ ...item, aliases: item.aliases.slice(0, TIEBREAK_MAX_ALIASES) });
  }
  const requests: TiebreakRequest[] = [];
  for (let at = 0; at < ready.length; at += TIEBREAK_MAX_ITEMS) {
    requests.push({ v: 1, items: ready.slice(at, at + TIEBREAK_MAX_ITEMS) });
  }
  return requests;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const INVALID: TiebreakVerdict = { picked: null, why: 'llm-invalid-output' };

/** One answer, judged against its item. */
function judge(item: TiebreakItem, answer: Record<string, unknown>): TiebreakVerdict {
  if ('optionSetHash' in answer && answer.optionSetHash !== item.optionSetHash) return INVALID;
  const index = answer.index;
  if (index === null) return { picked: null, why: 'no-match' };
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= item.candidates.length) {
    return INVALID;
  }
  const candidate = item.candidates[index]!;
  if (candidate.hardConflict || candidate.injected) return { picked: null, why: 'llm-pick-rejected' };
  return { picked: index, why: 'ok' };
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
    for (const [id, count] of answered) if (count > 1) verdicts.set(id, INVALID);
  }
  for (const item of items) if (!verdicts.has(item.id)) verdicts.set(item.id, INVALID);
  return verdicts;
}

/**
 * Asks the LLM about every item, one task at a time (TailorIT allows two tasks per user and kind; one stays free),
 * and validates each answer. A task that fails or times out gives `llm-unavailable` for its items; an item that may
 * not be sent gives `llm-disabled-for-category`.
 */
export async function runTiebreaks(items: readonly TiebreakItem[], llm: TiebreakFn):
  Promise<Map<string, TiebreakVerdict>> {
  const verdicts = new Map<string, TiebreakVerdict>();
  for (const request of tiebreakRequests(items)) {
    let reply: unknown;
    try {
      reply = await llm(request);
    } catch {
      for (const item of request.items) verdicts.set(item.id, { picked: null, why: 'llm-unavailable' });
      continue;
    }
    for (const [id, verdict] of readTiebreakReply(request.items, reply)) verdicts.set(id, verdict);
  }
  for (const item of items) {
    if (!verdicts.has(item.id)) verdicts.set(item.id, { picked: null, why: 'llm-disabled-for-category' });
  }
  return verdicts;
}

/**
 * The match once the LLM has answered (§4.0). A valid pick of a clean, guard-passing candidate gives stage 'llm',
 * rule 'llm-index', confidence 0.75 (always flagged). Otherwise the fallback stands: "Other" plus free text when the
 * form offers it, else blank, carrying why the LLM gave nothing.
 */
export function completeTiebreak(partial: PartialMatch, picked: number | null, why: ReasonCode): Match {
  let reason = why;
  if (picked !== null) {
    const candidate = Number.isInteger(picked) ? partial.candidates[picked] : undefined;
    if (candidate && !candidate.hardConflict && !candidate.injected) {
      return { stage: 'llm', optionIndex: candidate.optionIndex, rule: 'llm-index', confidence: MATCH_LLM_PICK,
        flags: [], suggestions: [], reason: 'llm-pick-needs-review' };
    }
    reason = candidate ? 'llm-pick-rejected' : 'llm-invalid-output';
  }
  const { fallback } = partial;
  if (fallback.stage !== 'none') return fallback;
  return { ...fallback, reason: reason === 'ok' || reason === 'no-match' ? fallback.reason : reason };
}
