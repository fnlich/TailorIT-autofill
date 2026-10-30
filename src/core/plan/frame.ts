/*
 * planFrame: one plan/request in the core (docs/ARCHITECTURE.md "What the worker does"; docs/design/core.md §10.1's
 * pass, for one frame's fields). For each field: the honeypot and label checks, resolve (resolver/resolve.ts), match
 * the value onto the field's options (matchOne, with the LLM off in Phase 2), plan the write in the shape the field's
 * kind takes, pass it through guardWrite, and give the field a row. The answer holds the values for this frame's own
 * fields only, never the profile.
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
 * - The canaries scanned for are the frame's and any its fields' own labels carry; only the frame's that equal no
 *   profile value may be kept in RunState (persistableCanaries).
 */
import { TIEBREAK_LABEL_MAX } from '../confidence';
import type { MatcherStage } from '../enums';
import { extractCanaries, persistableCanaries, profileIndex } from '../guard/canary';
import { checkHoneypot, llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { tripwireHits } from '../guard/tripwire';
import { guardWrite, type GuardContext, type WriteSubject } from '../guard/write';
import { noMatch, matchOne } from '../matcher/cascade';
import { prepareOptions } from '../matcher/prepare';
import type { MatchInput, PreparedOptions } from '../matcher/types';
import { parseSelectionHints, selectionLimits } from '../multiselect/hints';
import { planMultiSelect, type MultiSelectValue } from '../multiselect/plan';
import type { Choice } from '../resolver/candidate';
import { actionFor, classifyField, resolveField, type FieldClassification, type ResolvedField, type Shaped } from
  '../resolver/resolve';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import { asUntrusted } from '../text/untrusted';
import type { FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../types/fill';
import type { FieldCategory, PolicyClass, ValueOrigin, WriteValue } from '../types/intent';
import type { Match, MatchFlag, Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';
import type { PlanInput, PlanOutput } from './types';

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

/** What the planner knows of the run, for one field. */
interface FieldPlanContext {
  input: PlanInput;
  guard: GuardContext;
}

/** A field's write before the Guard: its value, its match, and a reason it must be flagged for, if any. */
interface Planned {
  value: WriteValue;
  match: Match;
  flag?: ReasonCode;
  multi?: WriteSubject['multi'];
}

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

/** One value's match, the LLM off: a field the LLM would be asked about falls back to Other or blank. */
function matchValue(input: MatchInput, ctx: FieldPlanContext): Match | 'waiting' {
  const outcome = matchOne(input, { vocab: ctx.input.vocab, llm: false, ...(ctx.input.cache ? { cache: ctx.input.cache }
    : {}) });
  if (outcome.done) return outcome.match;
  return 'waiting' in outcome ? 'waiting' : outcome.partial.fallback;
}

/** The planned write of a field, or the row it gets instead. */
function plan(spec: FieldSpec, resolution: Resolution, shaped: Shaped, ctx: FieldPlanContext): Planned | FillResult {
  const { category } = resolution;
  const blank = (status: FillResult['status'], reason: ReasonCode, match?: Match) =>
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
    case 'search':
      return { value: { kind: 'query', queries: shaped.queries }, match: NOT_APPLICABLE };
    case 'choice': {
      if (spec.options === 'lazy') return blank('flagged', 'waiting-for-options');
      const prepared = prepareOptions(spec.options, shaped.choice.domain, ctx.input.vocab);
      const match = matchValue(matchInputOf(spec, resolution, shaped.choice, prepared), ctx);
      if (match === 'waiting') return blank('flagged', 'waiting-for-options');
      if (match.stage === 'none' || match.optionIndex === null) return blank('flagged', match.reason, match);
      const option = prepared.list.find((candidate) => candidate.index === match.optionIndex)!;
      const selected = selectedIndices(spec, prepared);
      if (selected.has(option.index)) return blank('skipped', 'already-correct');
      const freeText = match.freeText ?? shaped.choice.freeText;
      // A checked radio or a chosen combobox value is the page's own answer (a resume parse): the profile wins,
      // flagged. A native select always shows some option, so its selection says something only when the select has
      // a placeholder to show instead (the review, CORE-17).
      const prefilled = selected.size > 0 && (spec.kind !== 'select' || prepared.list.some((item) => item.placeholder));
      return {
        value: { kind: 'option', index: option.index, cleanLabel: option.clean, ...(freeText ? { freeText } : {}) },
        match, ...(prefilled ? { flag: 'prefill-conflict' as const } : {}),
      };
    }
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
      for (const [order, choice] of shaped.set.entries()) {
        const ref = `v${order}`;
        const match = matchValue(matchInputOf(spec, resolution, choice, prepare(choice), ref), ctx);
        if (match === 'waiting') return blank('flagged', 'waiting-for-options');
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
      return { value: { kind: 'options', indices: multi.add.map((item) => item.index),
        cleanLabels: multi.add.map((item) => cleanOf(item.index)) }, match,
        ...(multi.reason !== 'ok' ? { flag: multi.reason } : {}),
        multi: { profileSetSize: shaped.set.length, kept: multi.keep.length, exclusive } };
    }
  }
}

/** The origin a planned write carries: a typed query is the profile value with the typeahead.query transform. */
function originOf(resolution: Resolution, value: WriteValue): ValueOrigin {
  const origin = resolution.origin!;
  if (value.kind === 'query' && origin.provenance === 'profile') return { ...origin, transform: 'typeahead.query' };
  return origin;
}

/** One field's write, if any, and its row. */
function planField(spec: FieldSpec, resolved: ResolvedField, ctx: FieldPlanContext):
  { write?: PlannedWrite; row: FillResult } {
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
  if (!('value' in planned)) return { row: planned };
  const confidence = round(resolution.confidence * planned.match.confidence);
  const flag = planned.flag ?? (resolution.reason !== 'ok' ? resolution.reason : undefined)
    ?? (planned.match.reason !== 'ok' ? planned.match.reason : undefined);
  const action = actionFor(confidence, flag !== undefined || planned.match.flags.some((item) => FORCING_FLAGS.has(item)));
  if (action === 'leave-blank') {
    return { row: rowWithout(spec, resolution.category, 'flagged', 'low-confidence', confidence, planned.match) };
  }
  const write: PlannedWrite = { key: spec.key, value: planned.value, origin: originOf(resolution, planned.value),
    match: planned.match };
  const verdict = guardWrite(write, { spec, category: resolution.category,
    ...(planned.multi ? { multi: planned.multi } : {}) }, ctx.guard);
  if (!verdict.ok) {
    return { row: rowWithout(spec, resolution.category, refusedStatus(spec, verdict.reason), verdict.reason, confidence) };
  }
  const status: FillResult['status'] = action === 'fill' ? 'verified' : 'flagged';
  const reason: ReasonCode = flag ?? (action === 'fill-and-flag' ? 'filled-low-confidence' : 'ok');
  return {
    write,
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

/** One plan/request (types.ts): every field resolved, matched, planned and guarded, each with a value-free row. */
export function planFrame(input: PlanInput): PlanOutput {
  const { specs, profile } = input;
  const kept = persistableCanaries(input.canaries, profile);
  const classifications = specs.map((spec) => classifyField(spec));
  // A phone number is written without its country code when the section has its own control for the code.
  const phoneCountrySections = new Set(specs.filter((_, at) => categoryOf(classifications[at]!) === 'contact.phoneCountry')
    .map((spec) => sectionKey(spec.section)));
  const resolved = specs.map((spec, at) => resolveField(spec, {
    profile, sensitiveState: input.sensitiveState, savedAnswers: input.savedAnswers, settings: input.settings,
    vocab: input.vocab, now: input.now, separatePhoneCountry: phoneCountrySections.has(sectionKey(spec.section)),
  }, classifications[at]!));
  // Only a field that could be written asks for the sensitive part: never a honeypot, a disabled control or a field no
  // visible label names (checkHoneypot).
  const writable = (spec: FieldSpec) => checkHoneypot(spec).ok && !spec.disabled && !spec.readOnly;
  if (input.sensitiveState === 'not-loaded' && resolved.some((field, at) => field.needsSensitive && writable(specs[at]!))) {
    return { writes: [], results: [], awaiting: [], needsSensitive: true, persistableCanaries: kept };
  }
  const guard: GuardContext = { canaries: [...input.canaries, ...specs.flatMap(labelCanaries)], profile,
    profileIndex: profileIndex(profile), savedAnswers: input.savedAnswers };
  const planned = specs.map((spec, at) => ({ spec, ...planField(spec, resolved[at]!, { input, guard }) }));
  const writes = planned.filter((field) => field.write !== undefined)
    .sort((a, b) => a.spec.domOrder - b.spec.domOrder).map((field) => field.write!);
  return { writes: input.dryRun ? [] : writes, results: planned.map((field) => field.row), awaiting: [],
    needsSensitive: false, persistableCanaries: kept };
}
