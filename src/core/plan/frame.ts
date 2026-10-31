/*
 * planFrame: one plan/request in the core (docs/ARCHITECTURE.md "What the worker does"; docs/design/core.md §10.1's
 * pass, for one frame's fields). For each field: the honeypot and label checks, resolve (resolver/resolve.ts), match
 * the value onto the field's options (matchOne), plan the write in the shape the field's kind takes, pass it through
 * guardWrite, and give the field a row. The answer holds the values for this frame's own fields only, never the
 * profile.
 * - The LLM steps (Phase 4), each only while its setting is on: a field nothing classified, screened first
 *   (classify.ts), and a single answer the cascade hands to the tiebreak, wait for the LLM. Such a field is in
 *   `awaiting`, with its question in `ask` and the row that stands until the answer (blank, flagged). The worker asks,
 *   and plans the field again with the run's answers (`ai`): a classification decides its category (at most 0.70,
 *   always flagged), a verdict completes its match (completeTiebreak). A valid pick is written as an llm-pick naming
 *   its task, the candidate and the hash of the option's clean text as sent, at 0.75 at most, always flagged; the frame
 *   checks that text before it writes (llmPickStillValid). A set's values and a typeahead's results never go to the
 *   LLM, and neither does a tie whose pick could not reach the flag band (a field only the LLM classified, at 0.70).
 *   A list the widget read only in part (optionsPartial) never goes to the LLM either.
 * - The request carries the frame's whole scan and the keys this pass plans (planKeys; every spec without them). Only
 *   those are resolved, written and rowed, and only they can ask for the sensitive part; every spec is read for what
 *   the planner sees across the frame, so a phone planned again alone still knows the code select beside it (the
 *   Phase 3 review, LC-2).
 * - Rows never carry a value or an option label. A field with a write gets the row its fill produces when the value
 *   reads back as planned (wrote false, verification 'not-checked'); the content script settles it after the fill
 *   (settle.ts). A dry run returns the rows and no write.
 * - A text longer than the field's maxLength is never cut: the field is flagged maxlength-exceeded.
 * - What the field already holds is read first. A value equal to the plan is left alone (already-correct); a page's
 *   own value in a structured field is overwritten and flagged (prefill-conflict), and in a box of prose kept and
 *   flagged (prefill-kept); a box the plan would not tick is never unticked (unexpected-selection).
 * - A field no visible label names gets no write: with no label at all it is skipped (it may be no question at all),
 *   and one named only by a label nobody sees (an aria-label whose words are not beside it) is flagged, both with the
 *   frame guard's reason, no-visible-label.
 * - While the sensitive part is not loaded, a field that needs it makes the whole answer needsSensitive, with nothing
 *   else in it: the worker fetches the part once and plans again. Only a field that could be written asks: never a
 *   honeypot, a disabled control or a field no visible label names.
 * - An options write carries each chosen option's clean label beside its index, from the prepared options.
 * - A remote typeahead (Phase 4) gets its queries; once the frame has typed one and read what it showed, it sends the
 *   field again with those results as its options, and one of them is chosen only in the fill band (§4.11). A
 *   typeahead that already shows the school is left alone; one showing another answer is searched, flagged.
 * - The canaries scanned for are the frame's and any its fields' own labels carry; only the frame's that equal no
 *   profile value may be kept in RunState (persistableCanaries).
 * - Repeatable sections (Phase 5): for each section the request names, each block gets its profile entry first
 *   (steps/blocks.ts: a block the site prefilled is matched to the entry it holds, the rest in order), and the resolver
 *   fills the block from that entry, not from the one its place names. The answer gives the frame the section's entry
 *   count, each block's entry and its current-job flag, for its Add clicks and "I currently work here".
 * - Phase 6: the person's saved answers apply by their exact key (resolver/saved.ts), a free-text one only for the
 *   company PlanInput.company names. With settings.llm.drafts on (never in a dry run), a free-text question no saved
 *   answer fills waits for a draft (drafts.ts: `ask.drafts`); the run's draft, once in (`ai.drafts`), is written as an
 *   llm-draft through guardWrite, always flagged, and a discarded or over-long one leaves the field flagged with its
 *   reason. The writes' matches the accepted-match cache may take once accepted are `cacheCandidates`, and the cache
 *   entries a match found stale `cacheDrops`: both for the worker, never for the frame.
 */
import { FLAG_AT, LLM_DRAFT, MATCH_LLM_PICK, TIEBREAK_LABEL_MAX } from '../confidence';
import type { MatcherStage } from '../enums';
import { extractCanaries, persistableCanaries, profileIndex } from '../guard/canary';
import { checkHoneypot, llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { tripwireHits } from '../guard/tripwire';
import { guardWrite, type GuardContext, type WriteSubject } from '../guard/write';
import { cacheEntryFor } from '../matcher/cache';
import { noMatch, matchOne } from '../matcher/cascade';
import { completeTiebreak } from '../matcher/tiebreak';
import { prepareOptions } from '../matcher/prepare';
import type { MatchInput, PreparedOptions, TiebreakItem } from '../matcher/types';
import { parseSelectionHints, selectionLimits } from '../multiselect/hints';
import { planMultiSelect, type MultiSelectValue } from '../multiselect/plan';
import type { Choice } from '../resolver/candidate';
import { classifiable, classifyItemOf, judgeClassification, SCREENED, screenForClassify, type ClassifyItem } from
  '../resolver/classify';
import { actionFor, classifyField, resolveField, type FieldClassification, type ResolvedField, type Shaped } from
  '../resolver/resolve';
import { planRepeatables } from '../steps/blocks';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import { asUntrusted } from '../text/untrusted';
import type { FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../types/fill';
import type { FieldCategory, PolicyClass, ValueOrigin, WriteValue } from '../types/intent';
import type { Match, MatchFlag, Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';
import { draftItemOf, draftRefusal, type DraftItem, type DraftVerdict } from './drafts';
import type { CacheCandidate, PlanInput, PlanOutput } from './types';

/** The match of a write with no options to choose from (text, a box, a date, a file, queries). */
const NOT_APPLICABLE: Match = { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [],
  suggestions: [], reason: 'ok' };

/** Confidences are rounded to this many decimals, so float noise never moves a value across a threshold. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const codePoints = (text: string) => [...text].length;

/** The weakest stage first: a set's row shows the least certain stage of its added options. */
const STAGE_TRUST: readonly MatcherStage[] = ['llm', 'other', 'fuzzy', 'cache', 'alias', 'exact', 'not-applicable', 'none'];

/** The classes whose set of values is one answer, written whole or not at all (the review, CORE-4). */
const WHOLE_ANSWER_CLASSES: readonly PolicyClass[] = ['eeo', 'legal', 'sensitive'];

/** The stages that may choose from a list read only in part (FieldSpec.optionsPartial, the Phase 4 review, R9): the
 *  value itself or one of its known spellings. A loose (fuzzy), Other or LLM choice could pass over the right answer
 *  past what was read. */
const PARTIAL_LIST_STAGES: ReadonlySet<MatcherStage> = new Set<MatcherStage>(['exact', 'alias', 'cache']);

/** The match flags the design always shows the person (§4.3, §4.4, §4.9, §4.12): an ignored `other` bracket only
 *  lowers the confidence. */
const FORCING_FLAGS: ReadonlySet<MatchFlag> = new Set<MatchFlag>(['injected-label', 'ambiguous-abbreviation',
  'level-fallback', 'same-entity-duplicates', 'small-margin']);

/** A row with nothing written. */
function rowWithout(spec: FieldSpec, category: FieldCategory, status: FillResult['status'], reason: ReasonCode,
  confidence: number, match?: Match): FillResult {
  const options = spec.options === 'lazy' || spec.options.length > 0;
  const suggestions = match?.suggestions ?? [];
  return {
    key: spec.key, label: spec.label, kind: spec.kind, category, section: sectionKey(spec.section), required: spec.required,
    status, provenance: null, matcherStage: match?.stage ?? (options ? 'none' : 'not-applicable'),
    confidence: round(confidence), reason, wrote: false, verification: 'not-applicable',
    needsUserAction: status === 'flagged' || status === 'blocked',
    ...(suggestions.length > 0 ? { detail: { suggestions } } : {}),
  };
}

/** The status of a field the Guard keeps from being written: a honeypot is blocked; a field with no label at all is
 *  skipped, since it may be no question at all; one named only by a label nobody sees is flagged, since it names a
 *  question the person may want to answer. */
function refusedStatus(spec: FieldSpec, reason: ReasonCode): FillResult['status'] {
  if (reason !== 'no-visible-label') return 'blocked';
  return spec.labelSource === 'none' ? 'skipped' : 'flagged';
}

/** The row of a resolution that writes nothing. */
function rowOfResolution(spec: FieldSpec, resolution: Resolution): FillResult {
  const status: FillResult['status'] = resolution.reason === 'tripwire-in-label' ? 'blocked'
    : resolution.action === 'skip' ? 'skipped' : 'flagged';
  return rowWithout(spec, resolution.category, status, resolution.reason, resolution.confidence);
}

/** Two texts the field would show alike: digits for a phone, case for an email or a link, spaces and case for the
 *  rest. */
function sameText(category: FieldCategory, a: string, b: string): boolean {
  if (category === 'contact.phone') return a.replace(/\D/g, '') === b.replace(/\D/g, '');
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  return tidy(a) === tidy(b);
}

/** The usable options a field has selected now, by index: their own selected flags, and the labels the scan read as
 *  selected (chips). A placeholder ("Select...") a native select shows by default is no selection. */
function selectedIndices(spec: FieldSpec, prepared: PreparedOptions): Set<number> {
  const labels = spec.current.kind === 'selected'
    ? new Set(spec.current.labels.map((label) => cutInjected(label).clean.trim().toLowerCase())) : new Set<string>();
  return new Set(prepared.list.filter((option) => !option.unusable && (option.selected
    || (option.clean !== '' && labels.has(option.clean.trim().toLowerCase())))).map((option) => option.index));
}

/** What the planner knows of the run, for one field, and what it gathers across the frame. */
interface FieldPlanContext {
  input: PlanInput;
  guard: GuardContext;
  /** Cache entries a match found stale (matchOne's cacheDrop), for the worker to delete. */
  drops: Set<string>;
}

/** A field's write before the Guard: its value, its match, a reason it must be flagged for, if any, and the origin
 *  when it is not the resolution's (the LLM's pick). */
interface Planned {
  value: WriteValue;
  match: Match;
  flag?: ReasonCode;
  multi?: WriteSubject['multi'];
  origin?: ValueOrigin;
  /** The matches the worker may cache once the write is accepted (Phase 6). */
  cache?: CacheCandidate[];
}

/** A field that waits for the LLM's tiebreak: its question, and the row that stands until the answer comes. */
interface Asked {
  asked: TiebreakItem;
  row: FillResult;
}

/** What matching one value of a single-answer field gave, the LLM allowed: a match (with the llm-pick origin when the
 *  LLM chose), a wait for options, or a question for the LLM and the match that stands until it answers. */
type Matched =
  | { kind: 'match'; match: Match; origin?: ValueOrigin }
  | { kind: 'waiting' }
  | { kind: 'ask'; item: TiebreakItem; fallback: Match };

/** The input matchOne reads for one of the field's values. */
function matchInputOf(spec: FieldSpec, resolution: Resolution, choice: Choice, options: PreparedOptions,
  valueRef?: string): MatchInput {
  return {
    key: spec.key,
    ...(valueRef !== undefined ? { valueRef } : {}),
    platform: spec.platform,
    labelKey: normalizeLabel(spec.label),
    // A label known only from aria-label (or none) never reaches an LLM.
    fieldLabel: llmMaySeeLabel(spec.labelSource) ? asUntrusted(spec.label as VisibleText, TIEBREAK_LABEL_MAX)
      : '' as UntrustedText,
    optionSetHash: spec.optionSetHash,
    policy: resolution.policy,
    intended: choice.intended,
    options,
    ...(choice.degreeField ? { degreeField: choice.degreeField } : {}),
    ...(choice.hispanicLatino !== undefined ? { hispanicLatino: choice.hispanicLatino } : {}),
  };
}

/** Whether a valid pick could be written at all: the field's own confidence times a pick's (0.75) reaches the flag
 *  band. A field only the LLM classified (0.70) never does, so its tie is never asked about: the answer could only
 *  leave it blank (the Phase 4 review, R6). */
function pickCouldFill(resolution: Resolution): boolean {
  return round(resolution.confidence * MATCH_LLM_PICK) >= FLAG_AT;
}

/** One value's match, the LLM off: a field the LLM would be asked about falls back to Other or blank. A set's values
 *  and a typeahead's results never go to the LLM (a pick's provenance names one option, and a search chooses only in
 *  the fill band, which a pick never reaches). */
function matchValue(input: MatchInput, ctx: FieldPlanContext): Match | 'waiting' {
  const outcome = matchOne(input, { vocab: ctx.input.vocab, llm: false, ...(ctx.input.cache ? { cache: ctx.input.cache }
    : {}) });
  if ('cacheDrop' in outcome && outcome.cacheDrop !== undefined) ctx.drops.add(outcome.cacheDrop);
  if (outcome.done) return outcome.match;
  return 'waiting' in outcome ? 'waiting' : outcome.partial.fallback;
}

/**
 * A single answer's match with the LLM tiebreak allowed (settings.llm.tiebreak; the domain and the policy class decide
 * the rest: matchOne's stage plan). A field the cascade hands to the LLM completes with the run's verdict for its
 * item (completeTiebreak, which refuses a verdict of another item or a changed label), else waits for one. A valid
 * pick is written as an llm-pick: the task, the candidate and the hash of the option's clean text as sent.
 */
function matchChoice(input: MatchInput, ctx: FieldPlanContext): Matched {
  const llm = ctx.input.settings.llm.tiebreak;
  const outcome = matchOne(input, { vocab: ctx.input.vocab, llm, ...(ctx.input.cache ? { cache: ctx.input.cache }
    : {}) });
  if ('cacheDrop' in outcome && outcome.cacheDrop !== undefined) ctx.drops.add(outcome.cacheDrop);
  if (outcome.done) return { kind: 'match', match: outcome.match };
  if ('waiting' in outcome) return { kind: 'waiting' };
  const answered = ctx.input.ai?.verdicts.get(outcome.tiebreak.id);
  if (answered === undefined) return { kind: 'ask', item: outcome.tiebreak, fallback: outcome.partial.fallback };
  const { verdict, taskId } = answered;
  const match = completeTiebreak(outcome.partial, verdict);
  if (match.stage !== 'llm' || verdict.picked === null || verdict.labelHash === null) return { kind: 'match', match };
  return { kind: 'match', match,
    origin: { provenance: 'llm-pick', taskId, pickedCandidate: verdict.picked, labelHash: verdict.labelHash } };
}

/** A row with nothing written, for the field being planned. */
type Blank = (status: FillResult['status'], reason: ReasonCode, match?: Match) => FillResult;

/** The cache entry a match would give once accepted, as a candidate for this field (cacheEntryFor: never an LLM pick
 *  the person did not confirm, an Other choice, or a field outside the open classes). */
function candidateOf(spec: FieldSpec, input: MatchInput, match: Match): CacheCandidate[] {
  const found = cacheEntryFor(input, match, 'run-complete', 0);
  if (found === null) return [];
  const { label, stage, confidence } = found.entry;
  return [{ fieldKey: spec.key, cacheKey: found.key, entry: { label, stage, confidence } }];
}

/** One answer chosen among a field's options (a select, a radio group, a combobox, a typeahead's results), or the row
 *  it gets instead. With `llm`, a tie may go to the LLM tiebreak: the field then waits for it (Asked). */
function planChoice(spec: FieldSpec, resolution: Resolution, choice: Choice, ctx: FieldPlanContext, blank: Blank,
  llm = false): Planned | Asked | FillResult {
  if (spec.options === 'lazy') return blank('flagged', 'waiting-for-options');
  const prepared = prepareOptions(spec.options, choice.domain, ctx.input.vocab);
  const input = matchInputOf(spec, resolution, choice, prepared);
  const partial = spec.optionsPartial === true;
  let matched: Matched;
  // A list read only in part never goes to the LLM.
  if (llm && !partial) {
    matched = matchChoice(input, ctx);
  } else {
    const plain = matchValue(input, ctx);
    matched = plain === 'waiting' ? { kind: 'waiting' } : { kind: 'match', match: plain };
  }
  if (matched.kind === 'waiting') return blank('flagged', 'waiting-for-options');
  if (matched.kind === 'ask') {
    // Until the LLM answers, the field stands as the cascade left it, blank and flagged.
    return { asked: matched.item, row: blank('flagged', matched.fallback.stage === 'none' ? matched.fallback.reason
      : 'ambiguous-options', { ...matched.fallback, stage: 'none', optionIndex: null }) };
  }
  const { match, origin } = matched;
  if (partial && (match.stage === 'none' || !PARTIAL_LIST_STAGES.has(match.stage))) {
    return blank('flagged', 'options-incomplete');
  }
  if (match.stage === 'none' || match.optionIndex === null) return blank('flagged', match.reason, match);
  const option = prepared.list.find((candidate) => candidate.index === match.optionIndex)!;
  const selected = selectedIndices(spec, prepared);
  if (selected.has(option.index)) return blank('skipped', 'already-correct');
  const freeText = match.freeText ?? choice.freeText;
  // A checked radio or a chosen combobox value is the page's own answer (a resume parse): the profile wins,
  // flagged. A native select always shows some option, so its selection says something only when the select has
  // a placeholder to show instead (the review, CORE-17).
  const prefilled = selected.size > 0 && (spec.kind !== 'select' || prepared.list.some((item) => item.placeholder));
  const cache = candidateOf(spec, input, match);
  return {
    value: { kind: 'option', index: option.index, cleanLabel: option.clean, ...(freeText ? { freeText } : {}) },
    match, ...(prefilled ? { flag: 'prefill-conflict' as const } : partial ? { flag: 'options-incomplete' as const } : {}),
    ...(origin ? { origin } : {}), ...(cache.length > 0 ? { cache } : {}),
  };
}

/** The planned write of a field, the row it gets instead, or the question it waits on. */
function plan(spec: FieldSpec, resolution: Resolution, shaped: Shaped, ctx: FieldPlanContext): Planned | Asked | FillResult {
  const { category } = resolution;
  const blank: Blank = (status, reason, match) =>
    rowWithout(spec, category, status, reason, resolution.confidence * (match?.confidence ?? 1), match);
  const current = spec.current;
  switch (shaped.shape) {
    case 'text': {
      const { text } = shaped;
      const maxLength = spec.constraints.maxLength;
      if (maxLength !== undefined && codePoints(text) > maxLength) return blank('flagged', 'maxlength-exceeded');
      if (current.kind === 'text' && current.text.trim() !== '') {
        if (sameText(category, current.text, text)) return blank('skipped', 'already-correct');
        // A page's own text in a box of prose is the person's to judge; in a structured field the profile wins.
        if (spec.kind === 'textarea') return blank('flagged', 'prefill-kept');
        return { value: { kind: 'text', text }, match: NOT_APPLICABLE, flag: 'prefill-conflict' };
      }
      return { value: { kind: 'text', text }, match: NOT_APPLICABLE };
    }
    case 'date':
      if (current.kind === 'text' && current.text.trim() === shaped.iso) return blank('skipped', 'already-correct');
      return { value: { kind: 'date', iso: shaped.iso }, match: NOT_APPLICABLE,
        ...(current.kind === 'text' && current.text.trim() !== '' ? { flag: 'prefill-conflict' as const } : {}) };
    case 'file':
      if (current.kind === 'files' && current.count > 0) return blank('flagged', 'prefill-kept');
      return { value: { kind: 'file', ref: 'resume' }, match: NOT_APPLICABLE };
    case 'check': {
      const checked = current.kind === 'checked' && current.checked;
      if (!shaped.check) return checked ? blank('flagged', 'unexpected-selection') : blank('skipped', 'already-correct');
      if (checked) return blank('skipped', 'already-correct');
      return { value: { kind: 'check' }, match: NOT_APPLICABLE };
    }
    case 'search': {
      // The results one of its queries showed, which the frame read (Phase 4, §4.11): matched as a choice. Only a match
      // in the fill band chooses one (planField); anything less leaves them unchosen, and the frame types its next
      // query.
      if (spec.options !== 'lazy' && spec.options.length > 0) {
        const chosen = planChoice(spec, resolution, shaped.choice, ctx, blank);
        return 'asked' in chosen ? chosen.row : chosen;
      }
      const search: Planned = { value: { kind: 'query', queries: shaped.queries }, match: NOT_APPLICABLE };
      const shown = current.kind === 'text' ? [current.text] : current.kind === 'selected' ? current.labels : [];
      if (shown.length === 0 || shown.every((text) => text.trim() === '')) return search;
      // What the widget shows already: our earlier choice, or the page's own answer, which the profile replaces,
      // flagged.
      const prepared = prepareOptions(shown.map((label, index) => ({ index, label, disabled: false, selected: false })),
        shaped.choice.domain, ctx.input.vocab);
      const match = matchValue(matchInputOf(spec, resolution, shaped.choice, prepared), ctx);
      const confidence = resolution.confidence * (match === 'waiting' ? 0 : match.confidence);
      if (match !== 'waiting' && match.optionIndex !== null
        && actionFor(confidence, match.flags.some((item) => FORCING_FLAGS.has(item))) === 'fill') {
        return blank('skipped', 'already-correct');
      }
      return { ...search, flag: 'prefill-conflict' };
    }
    case 'choice':
      return planChoice(spec, resolution, shaped.choice, ctx, blank, pickCouldFill(resolution));
    case 'set': {
      if (spec.options === 'lazy') return blank('flagged', 'waiting-for-options');
      const preparedBy = new Map<string, PreparedOptions>();
      const prepare = (choice: Choice) => {
        let prepared = preparedBy.get(choice.domain);
        if (!prepared) {
          prepared = prepareOptions(spec.options as Exclude<FieldSpec['options'], 'lazy'>, choice.domain,
            ctx.input.vocab);
          preparedBy.set(choice.domain, prepared);
        }
        return prepared;
      };
      const values: MultiSelectValue[] = [];
      const inputs = new Map<string, MatchInput>();
      const partial = spec.optionsPartial === true;
      for (const [order, choice] of shaped.set.entries()) {
        const ref = `v${order}`;
        const valueInput = matchInputOf(spec, resolution, choice, prepare(choice), ref);
        inputs.set(ref, valueInput);
        const found = matchValue(valueInput, ctx);
        if (found === 'waiting') return blank('flagged', 'waiting-for-options');
        // A list read only in part takes a value's exact or alias match only.
        const match = partial && !PARTIAL_LIST_STAGES.has(found.stage) ? noMatch('options-incomplete') : found;
        values.push({ ref, priority: order, order, match });
      }
      const options = prepare(shaped.set[0]!);
      const multi = planMultiSelect({ options: options.list, selected: selectedIndices(spec, options), values,
        limits: selectionLimits(spec.constraints, parseSelectionHints(spec.label, spec.description)) });
      if (multi.verdict === 'mark-all-aborted' || multi.verdict === 'exceeds-profile-set') {
        return blank('blocked', multi.reason);
      }
      // An EEO, legal or sensitive set is one answer: part of it states another (Asian alone for Asian and White), and
      // so does a set beside an option the page chose. It is written only when every value is selected and nothing
      // else is (the review, CORE-4).
      if (WHOLE_ANSWER_CLASSES.includes(resolution.policy) && multi.reason !== 'ok' && multi.reason !== 'already-correct') {
        return blank('flagged', multi.reason);
      }
      if (multi.add.length === 0) return blank(multi.reason === 'already-correct' ? 'skipped' : 'flagged', multi.reason);
      const added = multi.add.map((item) => values.find((candidate) => candidate.ref === item.ref)!.match);
      const weakest = added.reduce((low, match) => (STAGE_TRUST.indexOf(match.stage) < STAGE_TRUST.indexOf(low.stage)
        ? match : low));
      const confidence = Math.min(...added.map((match) => match.confidence));
      const flags = [...new Set(added.flatMap((match) => match.flags))];
      const match: Match = { ...noMatch('ok'), stage: weakest.stage, rule: weakest.rule, confidence, flags,
        reason: added.find((candidate) => candidate.reason !== 'ok')?.reason ?? 'ok' };
      const exclusive = new Set(options.list.filter((option) => option.exclusive).map((option) => option.index));
      const cleanOf = (index: number) => options.list.find((option) => option.index === index)!.clean;
      const cache = multi.add.flatMap((item) => candidateOf(spec, inputs.get(item.ref)!,
        values.find((candidate) => candidate.ref === item.ref)!.match));
      return { value: { kind: 'options', indices: multi.add.map((item) => item.index),
        cleanLabels: multi.add.map((item) => cleanOf(item.index)) }, match,
        ...(multi.reason !== 'ok' ? { flag: multi.reason } : partial ? { flag: 'options-incomplete' as const } : {}),
        multi: { profileSetSize: shaped.set.length, kept: multi.keep.length, exclusive },
        ...(cache.length > 0 ? { cache } : {}) };
    }
  }
}

/** The origin a planned write carries: a typed query is the profile value with the typeahead.query transform. */
function originOf(resolution: Resolution, value: WriteValue): ValueOrigin {
  const origin = resolution.origin!;
  if (value.kind === 'query' && origin.provenance === 'profile') return { ...origin, transform: 'typeahead.query' };
  return origin;
}

/** A field planned: its write, if any, its row, the tiebreak it waits on, and the matches it may cache. */
interface FieldPlan {
  write?: PlannedWrite;
  row: FillResult;
  asked?: TiebreakItem;
  cache?: CacheCandidate[];
}

/**
 * A free-text field with its draft (drafts.ts): the draft written as an llm-draft through guardWrite (its canary scan
 * included), always flagged for the person's confirmation; or, for a draft TailorIT discarded or one past the field's
 * cap, a flagged row with the reason, and nothing written. A Guard refusal blocks it, as any write's.
 */
function planDraft(spec: FieldSpec, resolution: Resolution, verdict: DraftVerdict, ctx: FieldPlanContext): FieldPlan {
  const { category } = resolution;
  if (verdict.text === null) return { row: rowWithout(spec, category, 'flagged', verdict.why, 0) };
  const refusal = draftRefusal(spec, verdict.text);
  if (refusal !== null) return { row: rowWithout(spec, category, 'flagged', refusal, 0) };
  const write: PlannedWrite = { key: spec.key, value: { kind: 'text', text: verdict.text },
    origin: { provenance: 'llm-draft', taskId: verdict.taskId, confirmedByUser: false }, match: NOT_APPLICABLE };
  const guarded = guardWrite(write, { spec, category }, ctx.guard);
  if (!guarded.ok) {
    return { row: rowWithout(spec, category, refusedStatus(spec, guarded.reason), guarded.reason, LLM_DRAFT) };
  }
  return {
    write,
    row: {
      key: spec.key, label: spec.label, kind: spec.kind, category, section: sectionKey(spec.section),
      required: spec.required, status: 'flagged', provenance: 'llm-draft', matcherStage: 'not-applicable',
      confidence: LLM_DRAFT, reason: 'llm-draft-needs-confirmation', wrote: false, verification: 'not-checked',
      needsUserAction: true,
    },
  };
}

/** One field's write, if any, its row, and the tiebreak it waits on, if any. */
function planField(spec: FieldSpec, resolved: ResolvedField, ctx: FieldPlanContext): FieldPlan {
  const { resolution, shaped } = resolved;
  const honeypot = checkHoneypot(spec);
  if (!honeypot.ok) {
    return { row: rowWithout(spec, resolution.category, refusedStatus(spec, honeypot.reason), honeypot.reason, 0) };
  }
  if (spec.disabled || spec.readOnly) {
    return { row: rowWithout(spec, resolution.category, 'skipped', 'disabled-or-readonly', resolution.confidence) };
  }
  const fills = resolution.action === 'fill' || resolution.action === 'fill-and-flag';
  if (!fills || shaped === null || resolution.origin === null) return { row: rowOfResolution(spec, resolution) };

  const planned = plan(spec, resolution, shaped, ctx);
  if ('asked' in planned) return { row: planned.row, asked: planned.asked };
  if (!('value' in planned)) return { row: planned };
  const confidence = round(resolution.confidence * planned.match.confidence);
  const flag = planned.flag ?? (resolution.reason !== 'ok' ? resolution.reason : undefined)
    ?? (planned.match.reason !== 'ok' ? planned.match.reason : undefined);
  const action = actionFor(confidence, flag !== undefined || planned.match.flags.some((item) => FORCING_FLAGS.has(item)));
  if (action === 'leave-blank') {
    return { row: rowWithout(spec, resolution.category, 'flagged', 'low-confidence', confidence, planned.match) };
  }
  // A remote typeahead chooses one of its results only in the fill band (§4.11: the first result that reaches it ends
  // the search). A weaker match, or one always flagged (an injected label's clean part), is left unchosen with its
  // reason, and the frame types its next query: blank beats wrong.
  if (spec.kind === 'typeahead-remote' && planned.value.kind === 'option' && action !== 'fill') {
    return { row: rowWithout(spec, resolution.category, 'flagged', flag ?? 'low-confidence', confidence, planned.match) };
  }
  const write: PlannedWrite = { key: spec.key, value: planned.value,
    origin: planned.origin ?? originOf(resolution, planned.value), match: planned.match };
  const verdict = guardWrite(write, { spec, category: resolution.category,
    ...(planned.multi ? { multi: planned.multi } : {}) }, ctx.guard);
  if (!verdict.ok) {
    return { row: rowWithout(spec, resolution.category, refusedStatus(spec, verdict.reason), verdict.reason, confidence) };
  }
  const status: FillResult['status'] = action === 'fill' ? 'verified' : 'flagged';
  const reason: ReasonCode = flag ?? (action === 'fill-and-flag' ? 'filled-low-confidence' : 'ok');
  return {
    write,
    ...(planned.cache !== undefined ? { cache: planned.cache } : {}),
    row: {
      key: spec.key, label: spec.label, kind: spec.kind, category: resolution.category, section: sectionKey(spec.section),
      required: spec.required, status, provenance: write.origin.provenance, matcherStage: planned.match.stage,
      confidence, reason, wrote: false, verification: 'not-checked', needsUserAction: status === 'flagged',
    },
  };
}

/** The canaries a field's own label or description carries, when a tripwire matches there. */
function labelCanaries(spec: FieldSpec): string[] {
  return [spec.label, spec.description].flatMap((text) => {
    const hits = tripwireHits(text as VisibleText);
    return hits.length === 0 ? [] : extractCanaries(text, hits);
  });
}

/** The category a classification gives, for the planner's look across the frame's fields. */
function categoryOf(classification: FieldClassification): FieldCategory | null {
  return classification.by === 'rules' ? classification.rules.category ?? null : null;
}

/** One plan/request (types.ts): every field of planKeys (every spec without them) resolved, matched, planned and
 *  guarded, each with a value-free row; the other specs are read for context only (the Phase 3 review, LC-2). */
export function planFrame(input: PlanInput): PlanOutput {
  const { profile } = input;
  const kept = persistableCanaries(input.canaries, profile);
  // Each requested section's blocks get their entries (a prefilled block its own) before anything is resolved.
  const repeatables = planRepeatables(input.repeatables ?? [], input.specs, profile, input.vocab);
  const blockEntries = Object.fromEntries(repeatables.map((answer) => [answer.kind, answer.entries]));
  const sections = repeatables.length > 0 ? { repeatables } : {};
  // Every spec is read across the frame; only the planned ones are resolved, written and rowed.
  const wanted = input.planKeys === undefined ? null : new Set<string>(input.planKeys);
  const classified = input.specs.map((spec) => ({ spec, classification: classifyField(spec) }));
  // A phone number is written without its country code when the section has its own control for the code.
  const phoneCountrySections = new Set(classified
    .filter((field) => categoryOf(field.classification) === 'contact.phoneCountry')
    .map((field) => sectionKey(field.spec.section)));
  const chosen = classified.filter((field) => wanted === null || wanted.has(field.spec.key));
  const specs = chosen.map((field) => field.spec);
  const resolveWith = (spec: FieldSpec, classification: FieldClassification) => resolveField(spec, {
    profile, sensitiveState: input.sensitiveState, savedAnswers: input.savedAnswers, settings: input.settings,
    vocab: input.vocab, now: input.now, separatePhoneCountry: phoneCountrySections.has(sectionKey(spec.section)),
    ...(input.company !== undefined ? { company: input.company } : {}),
    ...(repeatables.length > 0 ? { blockEntries } : {}),
  }, classification);
  // Only a field that could be written asks for the sensitive part or the LLM: never a honeypot, a disabled control or
  // a field no visible label names (checkHoneypot).
  const writable = (spec: FieldSpec) => checkHoneypot(spec).ok && !spec.disabled && !spec.readOnly;
  const classify: ClassifyItem[] = [];
  const resolved = chosen.map(({ spec, classification }) => {
    const first = resolveWith(spec, classification);
    // Step 5: a field nothing classified, not even a saved answer, goes to the LLM (settings.llm.classify), screened
    // first; the run's answer, once it has one, decides it.
    if (classification.by !== 'none' || first.resolution.classifiedBy !== 'none' || !input.settings.llm.classify
      || !writable(spec) || !classifiable(spec)) return first;
    if (screenForClassify(spec, input.vocab) !== null) return resolveWith(spec, { by: 'llm', llm: SCREENED });
    const verdict = input.ai?.classifications.get(spec.key);
    if (verdict !== undefined) {
      return resolveWith(spec, { by: 'llm', llm: judgeClassification(spec, verdict, input.vocab) });
    }
    const item = classifyItemOf(spec);
    if (item !== null) classify.push(item);
    return first;
  });
  if (input.sensitiveState === 'not-loaded' && resolved.some((field, at) => field.needsSensitive && writable(specs[at]!))) {
    return { writes: [], results: [], awaiting: [], needsSensitive: true, persistableCanaries: kept,
      ...sections };
  }
  // The canaries any label of the frame carries, the context's too: more to scan for is never less safe.
  const guard: GuardContext = { canaries: [...input.canaries, ...input.specs.flatMap(labelCanaries)], profile,
    profileIndex: profileIndex(profile), savedAnswers: input.savedAnswers };
  const ctx: FieldPlanContext = { input, guard, drops: new Set() };
  // Drafts (Phase 6): a free-text question no saved answer fills, with the setting on and never in a dry run, takes
  // the run's draft when there is one, and is asked for otherwise.
  const drafting = input.settings.llm.drafts && !input.dryRun;
  const drafts: DraftItem[] = [];
  const planned = specs.map((spec, at) => {
    const field = resolved[at]!;
    const item = drafting ? draftItemOf(spec, chosen[at]!.classification, field.resolution, writable(spec)) : null;
    if (item !== null) {
      const verdict = input.ai?.drafts?.get(spec.key);
      if (verdict !== undefined) return { spec, ...planDraft(spec, field.resolution, verdict, ctx) };
      drafts.push(item);
    }
    return { spec, ...planField(spec, field, ctx) };
  });
  const writes = planned.filter((field) => field.write !== undefined)
    .sort((a, b) => a.spec.domOrder - b.spec.domOrder).map((field) => field.write!);
  const tiebreaks = planned.flatMap((field) => field.asked === undefined ? [] : [field.asked]);
  const asking = new Set<string>([...classify.map((item) => item.key), ...drafts.map((item) => item.key), ...planned
    .filter((field) => field.asked !== undefined).map((field) => field.spec.key)]);
  const awaiting = specs.filter((spec) => asking.has(spec.key)).map((spec) => spec.key);
  const cacheCandidates = input.dryRun ? [] : planned.flatMap((field) => (field.write === undefined ? []
    : field.cache ?? []));
  return { writes: input.dryRun ? [] : writes, results: planned.map((field) => field.row), awaiting,
    ...(awaiting.length > 0 ? { ask: { tiebreaks, classify, ...(drafts.length > 0 ? { drafts } : {}) } } : {}),
    needsSensitive: false, persistableCanaries: kept, ...sections,
    ...(cacheCandidates.length > 0 ? { cacheCandidates } : {}),
    ...(ctx.drops.size > 0 ? { cacheDrops: [...ctx.drops] } : {}) };
}
