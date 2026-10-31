/*
 * One planned write (docs/design/runtime.md §8.3; docs/ARCHITECTURE.md "Orchestrator"). The reactive loop (loop.ts)
 * scans, plans and orders a pass's writes, and hands each one here, in that order:
 * 1. the DOM half of the Guard re-finds the field by key in a fresh scan (never a cached node) and checks it may be
 *    written now (domGuardBeforeWrite); a follow-up box that holds other text on that scan keeps it (WriteOptions.keep,
 *    the Phase 3 review, L-S7);
 * 2. the core's frame-side Guard checks the write against the field as it is now: honeypot, the value fits, the
 *    options it names still read as planned at their places, the provenance's shape, an llm-pick's option unchanged,
 *    the canary scan over this frame's canaries, the mark-all cover test (guardWriteInFrame);
 * 3. a file write first receives the resume over the `resume` port (transfer.ts), then is checked again, since the
 *    page had a moment to change, and is dropped as user-stopped if the person pressed Cancel meanwhile;
 * 4. fill() writes with untrusted events and reads back at once; what the field then holds (readBack, values.ts) is
 *    what the loop hashes for its flip count. An ARIA widget is written by the widget helpers instead (Phase 4,
 *    dom/widgets): its option chosen, its missing options added, its member pressed, or, for a remote typeahead, each
 *    query a guarded write of its own and each result list matched by the worker (searchField);
 * 5. the planner's row is settled from what happened (settleRow).
 * A refused write leaves its field untouched, with the guard's reason: blocked for what the Guard forbids (not
 * visible, no visible label, a canary, its provenance, its own UI), flagged for what could not be done (gone, options
 * changed, disabled, an auth field on the step, the site ignored our events). A dry run gets no writes from the
 * worker, and writes nothing. The verification after the pass's settle (verify.ts) has the last word on every written
 * field.
 */
import type { Adapter } from '../adapters/types';
import type { Platform } from '../core/enums';
import { guardWriteInFrame } from '../core/guard/write';
import { settleRow, type FillOutcome } from '../core/plan/settle';
import { capCodePoints } from '../core/text/fold';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { FieldCategory, ValueOrigin, WriteValue } from '../core/types/intent';
import { accepts, acceptTokens, fill } from '../dom/fillers';
import { domGuardBeforeWrite, type PlannedField } from '../dom/guard';
import { hashOfOptions } from '../dom/option-hash';
import { toFieldSpec } from '../dom/scan';
import { TEXT_CAP_LABEL } from '../dom/thresholds';
import type {
  FieldTarget, FillOutcome as DomFillOutcome, ReadBackRule, ScannedField, ScanResult, WidgetOptionRead, WidgetReading,
} from '../dom/types';
import { visiblePlaceholder } from '../dom/visible-text';
import {
  fillWidget, isActionable, searchTypeahead, type TypeaheadHooks, type WidgetFillContext,
} from '../dom/widgets';
import type { ContentPlatform } from '../platform/types';
import type { AnswerData } from './channel';
import { receiveResume, type ReceivedResume } from './transfer';
import { readBack } from './values';

/** The run was aborted (the extension went away, the document is leaving, or a new run replaced it). */
export class RunAborted extends Error {
  constructor() {
    super('the run was aborted');
    this.name = 'RunAborted';
  }
}

/** The worker's answer to plan/request. */
export type PlanAnswer = AnswerData<'plan/request'>;

/** What a write needs from its run. */
export interface PassEnv {
  content: ContentPlatform;
  adapter: Adapter;
  root: Element;
  platform: Platform;
  frameId: number;
  dryRun: boolean;
  /** Every canary this frame holds in memory (tripwire.allCanaries, at most 1024, not only the 32 plan/request
   *  carries): every outgoing value is scanned for them before it is written (CORE-15). */
  canaries: readonly string[];
  signal: AbortSignal;
  /** Whether the platform still holds the extension, asked before every write (false tears the runtime down). */
  valid(): boolean;
  /** Whether the person stopped the run (run/cancel): nothing more is written. */
  stopped(): boolean;
  /** The run's id now, for the resume port. */
  runId(): string;
  /** Overrides for the transfer, for tests. */
  resume?: { idleMs?: number; releaseAfterMs?: number };
}

/** A field the pass wrote: what the verification after the settle and the final Guard need. Memory only. */
export interface WrittenField {
  key: FieldKey;
  field: PlannedField;
  value: WriteValue;
  origin: ValueOrigin;
  /** The planner's row, which the verification settles again. */
  planned: FillResult;
  rule: ReadBackRule | undefined;
  /** The resume's name and size, for a file write's read-back. */
  file: { name: string; size: number } | null;
  resume: ReceivedResume | null;
  /** A text-like field's value before our write, for guard.revert. Memory only, never sent or logged. */
  textBefore: string | null;
  /** The options a multi-select had selected before our write. */
  selectedBefore: number[];
  /** The fill's own read-back, right after the write, found what was written. */
  readBackVerified: boolean;
}

/** What a widget's write needs from its loop (Phase 4). */
export interface WidgetWriteEnv {
  /** The run's widget readings, by base key (ScanOptions.widgetReadings): a fresh read of a list replaces its field's. */
  readings: Map<BaseKey, WidgetReading>;
  /** plan/request for one field, with the whole pass's index: a remote typeahead's results go to the worker, which
   *  matches them. */
  plan(specs: FieldSpec[], planKeys: FieldKey[]): Promise<PlanAnswer>;
}

/** What else a write may need. */
export interface WriteOptions {
  /** A follow-up's box row as the worker planned it: when the DOM guard's fresh scan finds the box holding text other
   *  than the free text (typed meanwhile), nothing is written and this row stands (the Phase 3 review, L-S7). */
  keep?: FillResult;
  /** A widget's write (Phase 4): without it a widget is widget-unsupported. */
  widgets?: WidgetWriteEnv;
}

/** What one write did: the row it ends with and, when the field changed, what was written and what the field held
 *  right after (its read-back, for the loop's value hash). Memory only. */
export interface WriteResult {
  row: FillResult;
  written?: WrittenField;
  readBack?: CurrentValue;
}

/** DOM-guard refusals that mean the Guard forbids the write; the rest mean it could not be done. */
const GUARD_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'no-visible-label',
  'internal-error']);
/** Filler refusals that mean the write was not allowed; the rest mean it could not be done. */
const FILL_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'internal-error']);
/** The frame-side core Guard's refusals that mean the write could not be done: the options it names moved or changed
 *  since the plan, as the DOM guard and the fillers say it too. Every other refusal of it blocks. */
const FRAME_GUARD_FLAGS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['options-changed']);

/** A refusal of the frame-side core Guard, as settleRow takes it. */
function frameGuardRefusal(reason: ReasonCode): FillOutcome {
  return FRAME_GUARD_FLAGS.has(reason) ? { kind: 'not-written', reason } : { kind: 'blocked', reason };
}
/** Mismatch reasons a row keeps instead of settleRow's verify-mismatch. */
const MISMATCH_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['verify-mismatch', 'unexpected-selection',
  'value-rejected-by-site', 'disabled-or-readonly']);

/** A refusal before the write, as settleRow takes it. */
function refusal(reason: ReasonCode, blocks: ReadonlySet<ReasonCode>): FillOutcome {
  return blocks.has(reason) ? { kind: 'blocked', reason } : { kind: 'not-written', reason };
}

/** A written field that reads back differently, keeping the specific reason. */
export function mismatchRow(planned: FillResult, reason: ReasonCode): FillResult {
  const row = settleRow(planned, { kind: 'mismatch' });
  return MISMATCH_REASONS.has(reason) ? { ...row, reason } : row;
}

/** A field that already held the planned value when the write came: nothing written, as the planner rows it. */
function alreadyCorrectRow(planned: FillResult): FillResult {
  return { ...planned, status: 'skipped', provenance: null, reason: 'already-correct', wrote: false,
    verification: 'not-applicable', needsUserAction: false };
}

/** The row after a fill, from its immediate read-back. */
export function rowAfterFill(planned: FillResult, outcome: DomFillOutcome): FillResult {
  if (outcome.verification === 'verified') {
    return outcome.wrote ? settleRow(planned, { kind: 'verified' }) : alreadyCorrectRow(planned);
  }
  if (outcome.verification === 'mismatch') return mismatchRow(planned, outcome.reason);
  return settleRow(planned, refusal(outcome.reason, FILL_BLOCKS));
}

/** How a text read-back is compared, from the planned row's category. */
function readBackOf(category: FieldCategory): ReadBackRule | undefined {
  if (category === 'contact.phone') return 'digits';
  if (category === 'contact.email') return 'casefold';
  return undefined;
}

/** The option indices a scanned field has selected. */
export function selectedOf(field: Pick<ScannedField, 'options'> | null | undefined): number[] {
  if (!field || field.options === 'lazy') return [];
  return field.options.filter((option) => option.selected).map((option) => option.index);
}

/** What the planner saw of a field, which the DOM guard checks the page still shows. */
export function plannedFieldOf(field: ScannedField): PlannedField {
  return { key: field.key, baseKey: field.baseKey, label: field.label, kind: field.kind };
}

/**
 * Writes one planned value through both Guards: the row it ends with, and what was written. `last` is any earlier scan
 * of the form root (the guard scans afresh from it), `field` the field as the plan saw it, and `held` the run's
 * heldPlaceholders, which every scan of the run reads.
 */
export async function writeField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, held: WeakMap<Element, string>, options: WriteOptions = {}): Promise<WriteResult> {
  const wanted = plannedFieldOf(field);
  let verdict = domGuardBeforeWrite(last, wanted);
  if (!verdict.ok) return { row: settleRow(planned, refusal(verdict.reason, GUARD_BLOCKS)) };
  // A follow-up box the person (or the page) typed into since the pass's scan keeps that text: compared on the DOM
  // guard's fresh scan, right before the write.
  const now = verdict.target.field.current;
  if (options.keep !== undefined && write.value.kind === 'text' && now.kind === 'text' && now.text !== ''
    && now.text !== write.value.text) {
    return { row: options.keep };
  }
  let check = guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries);
  if (!check.ok) return { row: settleRow(planned, frameGuardRefusal(check.reason)) };

  let resume: ReceivedResume | null = null;
  if (write.value.kind === 'file') {
    const tokens = acceptTokens(verdict.target.control as HTMLInputElement);
    const got = await receiveResume(env.content, { runId: env.runId(), accepts: (file) => accepts(tokens, file),
      signal: env.signal, ...env.resume });
    if (env.signal.aborted || !env.valid()) {
      if (got.ok) got.resume.release();
      throw new RunAborted();
    }
    // The person may have pressed Cancel while the bytes were on their way (DOM-8): nothing more is written.
    if (env.stopped()) {
      if (got.ok) got.resume.release();
      return { row: settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }) };
    }
    if (!got.ok) return { row: settleRow(planned, { kind: 'not-written', reason: got.reason }) };
    resume = got.resume;
    // The bytes took a moment, in which the page could change: the field is found and checked again.
    verdict = domGuardBeforeWrite(last, wanted);
    if (!verdict.ok) {
      resume.release();
      return { row: settleRow(planned, refusal(verdict.reason, GUARD_BLOCKS)) };
    }
    check = guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries);
    if (!check.ok) {
      resume.release();
      return { row: settleRow(planned, frameGuardRefusal(check.reason)) };
    }
  }

  const target = verdict.target;
  if (target.widget !== undefined) return writeWidget(env, last, field, write, planned, target, options.widgets);
  // Our write hides the placeholder showing now, which labels this field or makes it fillable: the run's rescans keep
  // it while the page still shows this text (DOM-7), so the field keeps its label and its key.
  const shown = visiblePlaceholder(target.control);
  if (shown !== null) held.set(target.control, shown);
  const textLike = target.field.kind === 'text' || target.field.kind === 'textarea';
  const textBefore = textLike ? (target.control as HTMLInputElement | HTMLTextAreaElement).value : null;
  const selectedBefore = selectedOf(target.field);
  const rule = readBackOf(planned.category);
  const file = resume?.file ?? undefined;
  const outcome = fill(target, write.value, { adapter: env.adapter, root: env.root, file, readBack: rule });
  const row = rowAfterFill(planned, outcome);
  if (!outcome.wrote) {
    resume?.release();
    return { row };
  }
  return {
    row,
    written: { key: write.key, field: wanted, value: write.value, origin: write.origin, planned, rule,
      file: file === undefined ? null : { name: file.name, size: file.size }, resume, textBefore, selectedBefore,
      readBackVerified: outcome.verification === 'verified' },
    readBack: readBack(target),
  };
}

// ── Widgets (Phase 4) ────────────────────────────────────────────────────────────────────────────────────────────

/** A written widget, as the verification after the settle and the final Guard need it. Memory only. */
function writtenWidget(field: PlannedField, write: PlannedWrite, planned: FillResult, before: ScannedField,
  verified: boolean): WrittenField {
  return { key: write.key, field, value: write.value, origin: write.origin, planned, rule: undefined, file: null,
    resume: null, textBefore: null, selectedBefore: selectedOf(before), readBackVerified: verified };
}

/** One write into an ARIA widget, through the widget helpers (dom/widgets): a combobox's option, a multiselect's
 *  missing options, a group's member, or a remote typeahead's queries. The Guards have passed it already. */
async function writeWidget(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, widgets: WidgetWriteEnv | undefined): Promise<WriteResult> {
  if (widgets === undefined) return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  const ctx: WidgetFillContext = { adapter: env.adapter, root: env.root, signal: env.signal, readings: widgets.readings };
  if (write.value.kind === 'query') return searchField(env, last, field, write, planned, target, widgets, ctx);
  const outcome = await fillWidget(target, write.value, ctx);
  if (env.signal.aborted || !env.valid()) throw new RunAborted();
  const row = rowAfterFill(planned, outcome);
  if (!outcome.wrote) return { row };
  return { row, written: writtenWidget(plannedFieldOf(field), write, planned, target.field,
    outcome.verification === 'verified'), readBack: readBack(target) };
}

/** A typeahead's results as the worker matches them: the field's spec with the results as its options (their hash its
 *  observed one), and nothing chosen yet (the box holds our query, which is no answer). */
function resultsSpec(field: ScannedField, results: readonly WidgetOptionRead[]): FieldSpec {
  const options = results.map((result, index) => ({ index, label: capCodePoints(result.label, TEXT_CAP_LABEL),
    disabled: result.disabled, selected: false }));
  return { ...toFieldSpec(field), options, optionSetHash: hashOfOptions(options.map((option) => option.label)),
    current: { kind: 'empty' } };
}

/**
 * A remote typeahead's search (dom/widgets' searchTypeahead): each query a guarded write of its own (the DOM guard on a
 * fresh scan, then guardWriteInFrame on that one query, provenance profile and transform typeahead.query), and each
 * result list matched by the worker (plan/request for this field alone, its results as its options), whose choice
 * passes guardWriteInFrame before it is clicked. The row is the worker's for the chosen result, or the planned one
 * flagged (blocked when a Guard refused) with why nothing was chosen.
 */
async function searchField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, widgets: WidgetWriteEnv, ctx: WidgetFillContext): Promise<WriteResult> {
  if (write.value.kind !== 'query' || !isActionable(target.widget!)) {
    return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  }
  const wanted = plannedFieldOf(field);
  let chosen: { row: FillResult; write: PlannedWrite } | null = null;
  const hooks: TypeaheadHooks = {
    guard: async (query) => {
      if (env.signal.aborted || !env.valid()) throw new RunAborted();
      if (env.stopped()) return { ok: false, reason: 'user-stopped', blocked: false };
      const again = domGuardBeforeWrite(last, wanted);
      if (!again.ok) return { ok: false, reason: again.reason, blocked: GUARD_BLOCKS.has(again.reason) };
      const one: PlannedWrite = { ...write, value: { kind: 'query', queries: [query] } };
      const check = guardWriteInFrame(one, toFieldSpec(again.target.field), env.canaries);
      if (!check.ok) return { ok: false, reason: check.reason, blocked: !FRAME_GUARD_FLAGS.has(check.reason) };
      return { ok: true, target: again.target };
    },
    match: async (results, now) => {
      const spec = resultsSpec(now.field, results);
      const answer = await widgets.plan([spec], [spec.key]);
      if (env.signal.aborted || !env.valid()) throw new RunAborted();
      // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      const row = (answer.results as unknown as FillResult[]).find((candidate) => candidate.key === spec.key);
      const pick = (answer.writes as unknown as PlannedWrite[]).find((candidate) => candidate.key === spec.key);
      if (row === undefined || pick === undefined || pick.value.kind !== 'option') {
        return { choose: null, reason: row?.reason ?? 'no-match', blocked: row?.status === 'blocked' };
      }
      const check = guardWriteInFrame(pick, spec, env.canaries);
      if (!check.ok) return { choose: null, reason: check.reason, blocked: !FRAME_GUARD_FLAGS.has(check.reason) };
      chosen = { row, write: pick };
      return { choose: { index: pick.value.index, cleanLabel: pick.value.cleanLabel } };
    },
  };
  const result = await searchTypeahead(target, write.value.queries, ctx, hooks);
  if (env.signal.aborted || !env.valid()) throw new RunAborted();
  const picked = chosen as { row: FillResult; write: PlannedWrite } | null;
  if (result.chosen === null || picked === null) {
    return { row: settleRow(planned, result.blocked ? { kind: 'blocked', reason: result.reason }
      : { kind: 'not-written', reason: result.reason }) };
  }
  const base = { ...picked.row, key: write.key };
  const row = result.verified ? settleRow(base, { kind: 'verified' }) : mismatchRow(base, 'verify-mismatch');
  const now = last.rescan().target(write.key) ?? target;
  return { row, written: writtenWidget(wanted, { ...picked.write, key: write.key }, base, target.field, result.verified),
    readBack: readBack(now) };
}
