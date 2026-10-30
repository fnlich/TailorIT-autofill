/*
 * One pass (docs/design/runtime.md §8.3; docs/ARCHITECTURE.md "Orchestrator"): scan the form root, send one
 * plan/request, then write each planned value in DOM order. Phase 3's reactive loop runs this up to MAX_PASSES times
 * with settle() between passes; Phase 2 runs it once.
 * For each planned write:
 * 1. the DOM half of the Guard re-finds the field by key in a fresh scan (never a cached node) and checks it may be
 *    written now (domGuardBeforeWrite);
 * 2. the core's frame-side Guard checks the write against the field as it is now: honeypot, the value fits, the
 *    provenance's shape, an llm-pick's option unchanged, the canary scan over this frame's canaries, the mark-all cover
 *    test (guardWriteInFrame);
 * 3. a file write first receives the resume over the `resume` port (transfer.ts), then is checked again, since the
 *    page had a moment to change;
 * 4. fill() writes with untrusted events and reads back at once;
 * 5. the planner's row is settled from what happened (settleRow).
 * A refused write leaves its field untouched, with the guard's reason: blocked for what the Guard forbids (not
 * visible, no visible label, a canary, its provenance, its own UI), flagged for what could not be done (gone, options
 * changed, disabled, an auth field on the step, the site ignored our events). A dry run gets no writes from the
 * worker, and any that came would be ignored: its rows are the plan's, settled as dry-run. The verification after the
 * settle (verify.ts) has the last word on every written field.
 */
import type { Adapter } from '../adapters/types';
import type { Platform } from '../core/enums';
import { guardWriteInFrame } from '../core/guard/write';
import { settleRow, type FillOutcome } from '../core/plan/settle';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { FieldCategory, ValueOrigin, WriteValue } from '../core/types/intent';
import { accepts, acceptTokens, fill } from '../dom/fillers';
import { domGuardBeforeWrite, type PlannedField } from '../dom/guard';
import { scan, toFieldSpec } from '../dom/scan';
import type { FillOutcome as DomFillOutcome, ReadBackRule, ScannedField, ScanResult } from '../dom/types';
import type { ContentPlatform } from '../platform/types';
import type { AnswerData } from './channel';
import { receiveResume, type ReceivedResume } from './transfer';

/** The run was aborted (the extension went away, the document is leaving, or a new run replaced it). */
export class RunAborted extends Error {
  constructor() {
    super('the run was aborted');
    this.name = 'RunAborted';
  }
}

/** The worker's answer to plan/request. */
export type PlanAnswer = AnswerData<'plan/request'>;

/** What a pass needs from its run. */
export interface PassEnv {
  content: ContentPlatform;
  adapter: Adapter;
  root: Element;
  platform: Platform;
  frameId: number;
  dryRun: boolean;
  /** This frame's canaries (at most 32, folded): every outgoing value is scanned for them before it is written. */
  canaries: readonly string[];
  signal: AbortSignal;
  /** Whether the platform still holds the extension, asked before every write (false tears the runtime down). */
  valid(): boolean;
  /** Whether the person stopped the run (run/cancel): nothing more is written. */
  stopped(): boolean;
  /** Sends plan/request for this pass's specs (the run renews itself once on 'expired') and answers the plan. */
  plan(specs: FieldSpec[], pass: number): Promise<PlanAnswer>;
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

/** What one pass did. */
export interface PassResult {
  /** The scan the plan was made from. */
  scan: ScanResult;
  /** Every field's row, in the request's order (DOM order). */
  rows: Map<FieldKey, FillResult>;
  written: WrittenField[];
  persistableCanaries: string[];
  awaiting: FieldKey[];
}

/** DOM-guard refusals that mean the Guard forbids the write; the rest mean it could not be done. */
const GUARD_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'no-visible-label',
  'internal-error']);
/** Filler refusals that mean the write was not allowed; the rest mean it could not be done. */
const FILL_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'internal-error']);
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

/** Writes one planned value: the row it ends with, and what was written. `held` is the pass's scans' heldPlaceholders. */
async function writeOne(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite, planned: FillResult,
  held: WeakSet<Element>): Promise<{ row: FillResult; written?: WrittenField }> {
  const wanted = plannedFieldOf(field);
  let verdict = domGuardBeforeWrite(last, wanted);
  if (!verdict.ok) return { row: settleRow(planned, refusal(verdict.reason, GUARD_BLOCKS)) };
  let check = guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries);
  if (!check.ok) return { row: settleRow(planned, { kind: 'blocked', reason: check.reason }) };

  let resume: ReceivedResume | null = null;
  if (write.value.kind === 'file') {
    const tokens = acceptTokens(verdict.target.control as HTMLInputElement);
    const got = await receiveResume(env.content, { runId: env.runId(), accepts: (file) => accepts(tokens, file),
      signal: env.signal, ...env.resume });
    if (env.signal.aborted || !env.valid()) {
      if (got.ok) got.resume.release();
      throw new RunAborted();
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
      return { row: settleRow(planned, { kind: 'blocked', reason: check.reason }) };
    }
  }

  const target = verdict.target;
  // Our write hides the placeholder that labels this field: the pass's rescans keep it, so the field keeps its key.
  if (target.field.labelSource === 'placeholder' && target.field.labelVisible) held.add(target.control);
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
  };
}

/** Runs one pass over the form root. */
export async function runPass(env: PassEnv, pass: number): Promise<PassResult> {
  // The controls this pass writes while a visible placeholder labels them; every rescan of `scanned` reads it.
  const held = new WeakSet<Element>();
  const scanned = scan(env.root, env.adapter, { platform: env.platform, frameId: env.frameId, heldPlaceholders: held });
  const plan = await env.plan(scanned.fields.map(toFieldSpec), pass);
  if (env.signal.aborted) throw new RunAborted();
  // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
  const results = plan.results as unknown as FillResult[];
  const writes = plan.writes as unknown as PlannedWrite[];
  const rows = new Map<FieldKey, FillResult>(results.map((row) => [row.key, row]));
  if (env.dryRun) {
    for (const [key, row] of rows) rows.set(key, settleRow(row, { kind: 'dry-run' }));
    return { scan: scanned, rows, written: [], persistableCanaries: plan.persistableCanaries,
      awaiting: plan.awaiting as FieldKey[] };
  }

  const fields = new Map(scanned.fields.map((field) => [field.key, field]));
  const ordered = writes.filter((write) => fields.has(write.key) && rows.has(write.key))
    .sort((a, b) => fields.get(a.key)!.domOrder - fields.get(b.key)!.domOrder);
  const written: WrittenField[] = [];
  for (const write of ordered) {
    if (env.signal.aborted || !env.valid()) throw new RunAborted();
    const planned = rows.get(write.key)!;
    if (env.stopped()) {
      rows.set(write.key, settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }));
      continue;
    }
    const done = await writeOne(env, scanned, fields.get(write.key)!, write, planned, held);
    rows.set(write.key, done.row);
    if (done.written) written.push(done.written);
  }
  return { scan: scanned, rows, written, persistableCanaries: plan.persistableCanaries,
    awaiting: plan.awaiting as FieldKey[] };
}
