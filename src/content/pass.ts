/*
 * One planned write (docs/design/runtime.md §8.3; docs/ARCHITECTURE.md "Orchestrator"). The reactive loop (loop.ts)
 * scans, plans and orders a pass's writes, and hands each one here, in that order:
 * 1. the DOM half of the Guard re-finds the field by key in a fresh scan (never a cached node) and checks it may be
 *    written now (domGuardBeforeWrite);
 * 2. the core's frame-side Guard checks the write against the field as it is now: honeypot, the value fits, the
 *    options it names still read as planned at their places, the provenance's shape, an llm-pick's option unchanged,
 *    the canary scan over this frame's canaries, the mark-all cover test (guardWriteInFrame);
 * 3. a file write first receives the resume over the `resume` port (transfer.ts), then is checked again, since the
 *    page had a moment to change, and is dropped as user-stopped if the person pressed Cancel meanwhile;
 * 4. fill() writes with untrusted events and reads back at once; what the field then holds (readBack, values.ts) is
 *    what the loop hashes for its flip count;
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
import type { CurrentValue, FieldKey } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { FieldCategory, ValueOrigin, WriteValue } from '../core/types/intent';
import { accepts, acceptTokens, fill } from '../dom/fillers';
import { domGuardBeforeWrite, type PlannedField } from '../dom/guard';
import { toFieldSpec } from '../dom/scan';
import type { FillOutcome as DomFillOutcome, ReadBackRule, ScannedField, ScanResult } from '../dom/types';
import { visiblePlaceholder } from '../dom/visible-text';
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
  planned: FillResult, held: WeakMap<Element, string>): Promise<WriteResult> {
  const wanted = plannedFieldOf(field);
  let verdict = domGuardBeforeWrite(last, wanted);
  if (!verdict.ok) return { row: settleRow(planned, refusal(verdict.reason, GUARD_BLOCKS)) };
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
      file: file === undefined ? null : { name: file.name, size: file.size }, resume, textBefore, selectedBefore },
    readBack: readBack(target),
  };
}
