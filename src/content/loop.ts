/*
 * The reactive loop (docs/SPEC.md Requirement D; docs/ARCHITECTURE.md "Orchestrator"; docs/design/core.md §10.1;
 * docs/design/runtime.md §8.3): the fill step runs at most MAX_PASSES passes over the form root, on the core's books
 * (src/core/loop), which decide what each pass plans and when the loop ends. A field is known by its base key, never by
 * a node. Each pass, in order:
 * 1. scan. Every scan of the run, the DOM guard's before each write included, goes through one tap that keeps the
 *    attribution (attribution.ts), and every scan reads the run's heldPlaceholders (DOM-7);
 * 2. observeScan, with the keyed hash of each written field's value now (values.ts) and the DOM's attribution. The
 *    written fields its events name are dropped (field-disappeared; options-changed, whose old write is void);
 * 3. plan/request for the pending fields only, in orderPending's order, with the pass's index. A native list that shows
 *    real options while it is still loading (busy, or a loading row: awaitOptions' optionsState) is held back, so it is
 *    never matched against options on their way out; one with nothing usable goes to the worker, which can only answer
 *    waiting-for-options for it;
 * 4. each write in that order (pass.ts: the DOM guard, guardWriteInFrame, the fill, the read-back), then recordWrite
 *    with the read-back's hash and followUp (an option written with free text). The box a choice's write revealed
 *    (follow-up-found at this pass's scan) takes that choice's free text instead of any write the worker planned for
 *    it (follow-up.ts); a choice whose box never showed is flagged other-without-free-text. After the pass's last
 *    write one more scan sees what that write revealed at once;
 * 5. settle() (dom/settle.ts), then each written field is verified on a fresh scan (verify.ts) and its resume, if any,
 *    released;
 * 6. recordRows for every planned key. Then the lists still waiting for options, the ones held back, and the lists a
 *    writer of this pass is known to change (childrenOf, its options edges) are awaited (awaitOptions), each counted
 *    from its parent's write, else the pass's last write: ready means the next scan sees the options, never-loaded
 *    flags options-never-loaded, gone is left to the next scan; Cancel ends the waits at once, and so does the run's
 *    end.
 * The loop ends when loopVerdict says so: nothing pending, MAX_PASSES, or a stalled page. At the settle cap the page is
 * scanned once more, observed, and the loop is cut with page-busy (the run pauses; Continue starts afresh). Cancel
 * cuts it with user-stopped, between writes, once the writes made are settled and verified. A dry run plans one pass
 * and writes nothing: nothing written, nothing revealed.
 * Values, free text and hashes stay in this frame's memory; nothing here sends or logs one. The waits are settle()'s
 * and awaitOptions()', on dom/time.ts's timers: there is no fixed sleep.
 */
import {
  baseKeyOf, childrenOf, createLoop, isStopped, loopVerdict, orderPending, recordOptionsWait, recordRows, recordWrite,
  revealEdgesOf, observeScan, type LoopEnd, type LoopEvent, type LoopState, type LoopVerdict, type ScanObservation,
} from '../core/loop/bookkeeping';
import { loopRows, unplannedRow, unresolvedRow } from '../core/loop/rows';
import { settleRow } from '../core/plan/settle';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { awaitOptions, isOptionList, optionsState, type AwaitOptionsOptions } from '../dom/await-options';
import { isUsableOption } from '../dom/option-hash';
import { scan, toFieldSpec } from '../dom/scan';
import { busySigns, settle, type SettleOptions } from '../dom/settle';
import { monotonicNow } from '../dom/time';
import { BUSY_SIGNS, type BusySign, type ScannedField, type ScanResult, type SettleResult } from '../dom/types';
import { log } from '../shared/log';
import { Attribution } from './attribution';
import { followUpWrite, type FollowUpSource, type QueuedWrite } from './follow-up';
import { RunAborted, writeField, type PassEnv, type PlanAnswer, type WrittenField } from './pass';
import type { ReceivedResume } from './transfer';
import { createValueHasher, type ValueHasher } from './values';
import { verifyWritten } from './verify';

/** settle()'s windows and caps, overridable for tests. */
export type SettleTimings = Pick<SettleOptions, 'quietMs' | 'capMs' | 'optionsCapMs'>;
/** awaitOptions()' window and cap, overridable for tests. */
export type OptionsTimings = Pick<AwaitOptionsOptions, 'quietMs' | 'capMs'>;

/** What the loop needs from its run. */
export interface LoopEnv extends PassEnv {
  /** Sends plan/request for a pass's specs (the run renews itself once on 'expired') and answers the plan. */
  plan(specs: FieldSpec[], pass: number): Promise<PlanAnswer>;
  /** Aborted when the person stops the run (stopped() turns true): a wait for a list's options ends at once. */
  stopSignal?: AbortSignal;
  settle?: SettleTimings;
  options?: OptionsTimings;
}

/** What the loop leaves for the final Guard and the report. Memory only: `written` holds values. */
export interface LoopResult {
  /** Every field's row (loopRows): those present at the last scan in DOM order, then those that went. */
  rows: FillResult[];
  /** The latest scan of the form root. */
  scan: ScanResult;
  /** The written fields still in the page under the key the books have for them. */
  written: WrittenField[];
  /** The passes that ran (counters.passes): the books' pass, or one more when the person stopped one mid-way. */
  passes: number;
  /** Why it ended. A dry run plans one pass. */
  end: LoopEnd | 'dry-run';
  /** RunState.revealEdges: keys only. */
  revealEdges: Array<[BaseKey, BaseKey]>;
  /** The latest plan's persistableCanaries ([] when nothing was planned). */
  persistableCanaries: string[];
  /** The busy signs at the settle cap (names only), or null when every settle answered. */
  busy: BusySign[] | null;
}

/** How a pass ended. */
type PassEnd =
  | { kind: 'next'; scan: ScanResult }
  | { kind: 'busy'; scan: ScanResult }
  | { kind: 'stopped'; scan: ScanResult }
  | { kind: 'dry-run'; rows: FillResult[] };

/** Runs the reactive loop over the form root. */
export async function runLoop(env: LoopEnv): Promise<LoopResult> {
  const hasher = await createValueHasher();
  if (env.signal.aborted) throw new RunAborted();
  return new ReactiveLoop(env, hasher).run();
}

/** A native list that shows real options while it is still loading: it is not planned now. */
function loadingWithOptions(scanned: ScanResult, field: ScannedField): boolean {
  if (field.options === 'lazy' || !field.options.some((option) => isUsableOption(option.label))) return false;
  const control = scanned.target(field.key)?.control ?? null;
  if (control === null || !isOptionList(control)) return false;
  const now = optionsState(control, null);
  return !now.ready && (now.waiting === 'busy' || now.waiting === 'loading');
}

/** One run's loop. */
class ReactiveLoop {
  private state: LoopState = createLoop();
  /** The run's heldPlaceholders: every scan of the run reads them. */
  private readonly held = new WeakMap<Element, string>();
  private readonly attribution = new Attribution();
  /** What was written and still stands, by base key. */
  private readonly written = new Map<BaseKey, WrittenField>();
  /** Every resume received: released once its pass is verified, and when the loop ends whatever happened. */
  private readonly resumes: ReceivedResume[] = [];
  /** The choices written with free text since the latest scan, by base key. Memory only. */
  private asking = new Map<BaseKey, FollowUpSource>();
  /** The boxes the latest scan named for those choices, by key. */
  private boxes = new Map<FieldKey, FollowUpSource>();
  /** From when each list's wait for its options counts (monotonicNow), by base key. */
  private readonly waitFrom = new Map<BaseKey, number>();
  private persistable: string[] = [];
  private busy: BusySign[] | null = null;
  private passes = 0;

  constructor(private readonly env: LoopEnv, private readonly hasher: ValueHasher) {}

  async run(): Promise<LoopResult> {
    try {
      let current = this.scanNow();
      for (;;) {
        const observed = await this.observe(current);
        if (observed.verdict.done) return this.result(current, observed.verdict);
        if (this.env.stopped()) return this.result(current, loopVerdict(this.state, { cut: 'user-stopped' }));
        this.passes += 1;
        const end = await this.pass(current, observed.pending);
        if (end.kind === 'dry-run') return this.dryRunResult(current, end.rows);
        if (end.kind === 'busy') {
          // What the busy page revealed or changed meanwhile gets its row: one more scan, then the cut.
          await this.observe(end.scan);
          return this.result(end.scan, loopVerdict(this.state, { cut: 'page-busy' }));
        }
        if (end.kind === 'stopped') return this.result(end.scan, loopVerdict(this.state, { cut: 'user-stopped' }));
        current = end.scan;
      }
    } finally {
      for (const resume of this.resumes) resume.release();
    }
  }

  private alive(): void {
    if (this.env.signal.aborted) throw new RunAborted();
  }

  // ── Scans ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A fresh scan of the form root, which the attribution sees, as it sees its rescans. */
  private scanNow(): ScanResult {
    const { env } = this;
    return this.seen(scan(env.root, env.adapter, { platform: env.platform, frameId: env.frameId,
      heldPlaceholders: this.held }));
  }

  private seen(result: ScanResult): ScanResult {
    this.attribution.saw(result.fields);
    return { ...result, rescan: () => this.seen(result.rescan()) };
  }

  /** A list's control in a fresh scan, by base key: awaitOptions' refind once the page replaced the element. */
  private refind(baseKey: BaseKey): Element | null {
    const again = this.scanNow();
    const field = again.fields.find((candidate) => candidate.baseKey === baseKey);
    return field === undefined ? null : again.target(field.key)?.control ?? null;
  }

  /** Folds a scan into the books, with the hashes of the written fields' values and the DOM's attribution. */
  private async observe(scanned: ScanResult): Promise<ScanObservation> {
    const wrote = scanned.fields.filter((field) => this.state.fields.get(field.baseKey)?.wrote === true);
    const valueMacs = await this.hasher.macsOf(wrote);
    this.alive();
    const observed = observeScan(this.state, scanned.fields, { valueMacs, attribution: this.attribution.take() });
    this.state = observed.state;
    this.afterScan(observed.events);
    return observed;
  }

  /** What a scan's events change here: written fields dropped, and the boxes named for this pass's free text. */
  private afterScan(events: readonly LoopEvent[]): void {
    const named = new Set<BaseKey>();
    this.boxes = new Map();
    for (const event of events) {
      if (event.type === 'field-disappeared') this.drop(event.baseKey);
      else if (event.type === 'options-changed' && this.written.get(event.baseKey)?.key === event.from) {
        this.drop(event.baseKey);
      } else if (event.type === 'follow-up-found') {
        const parent = baseKeyOf(event.parent);
        const source = this.asking.get(parent);
        if (source === undefined) continue;
        this.boxes.set(event.child, source);
        named.add(parent);
      }
    }
    // A choice's box shows at the scan after its write, or not at all: then its free text was not typed anywhere.
    const untyped: FillResult[] = [];
    for (const parent of this.asking.keys()) {
      const tracked = this.state.fields.get(parent);
      const row = tracked?.row ?? null;
      if (named.has(parent) || tracked?.status !== 'resolved' || row === null || !row.wrote
        || row.reason !== 'other-option-with-free-text') continue;
      untyped.push({ ...row, status: row.status === 'blocked' ? 'blocked' : 'flagged', reason: 'other-without-free-text',
        needsUserAction: true });
    }
    if (untyped.length > 0) this.state = recordRows(this.state, untyped);
    this.asking = new Map();
  }

  /** Drops what was recorded for a written field: it went, or its options changed under it. */
  private drop(baseKey: BaseKey): void {
    this.written.get(baseKey)?.resume?.release();
    this.written.delete(baseKey);
  }

  // ── A pass ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async pass(current: ScanResult, pending: readonly FieldKey[]): Promise<PassEnd> {
    const { env } = this;
    const fields = new Map(current.fields.map((field) => [field.key, field] as const));
    const order = orderPending(this.state, pending).filter((key) => fields.has(key));
    const holding = new Set(env.dryRun ? [] : order.filter((key) => loadingWithOptions(current, fields.get(key)!)));
    const asked = order.filter((key) => !holding.has(key));
    const rows = new Map<FieldKey, FillResult>();
    let writes: PlannedWrite[] = [];
    let awaiting: FieldKey[] = [];
    if (asked.length > 0) {
      const plan = await env.plan(asked.map((key) => toFieldSpec(fields.get(key)!)), this.state.pass);
      this.alive();
      this.persistable = plan.persistableCanaries;
      // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      for (const row of plan.results as unknown as FillResult[]) rows.set(row.key, row);
      writes = plan.writes as unknown as PlannedWrite[];
      awaiting = plan.awaiting as FieldKey[];
    }
    if (env.dryRun) {
      for (const [key, row] of rows) rows.set(key, settleRow(row, { kind: 'dry-run' }));
      this.state = recordRows(this.state, rows.values(), { awaiting });
      return { kind: 'dry-run', rows: [...rows.values()] };
    }

    const done: WrittenField[] = [];
    const writtenAt = new Map<BaseKey, number>();
    for (const { write, planned } of this.queue(order, rows, writes, fields)) {
      if (env.signal.aborted || !env.valid()) throw new RunAborted();
      if (env.stopped()) {
        rows.set(write.key, settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }));
        continue;
      }
      const result = await writeField(env, current, fields.get(write.key)!, write, planned, this.held);
      rows.set(write.key, result.row);
      if (result.written === undefined || result.readBack === undefined) continue;
      done.push(result.written);
      writtenAt.set(result.written.field.baseKey, monotonicNow());
      await this.recordWritten(result.written, result.readBack, planned);
    }
    // What the pass's last write revealed at once is that write's.
    if (this.attribution.awaitingScan) this.scanNow();

    let settled: SettleResult | null = null;
    if (done.length > 0) {
      settled = await settle(env.root, { adapter: env.adapter, signal: env.signal, ...env.settle });
      if (!settled.settled && settled.reason === 'aborted') throw new RunAborted();
      this.alive();
    }
    const fresh = current.rescan();
    for (const entry of done) {
      rows.set(entry.key, verifyWritten(fresh, entry));
      entry.resume?.release();
    }
    this.state = recordRows(this.state, rows.values(), { awaiting });
    if (settled !== null && !settled.settled) {
      const busy = busySigns(env.root, env.adapter);
      this.busy = busy;
      log('content.page-busy', Object.fromEntries(BUSY_SIGNS.map((sign) => [sign, busy.includes(sign)])));
      return { kind: 'busy', scan: fresh };
    }
    if (env.stopped()) return { kind: 'stopped', scan: fresh };
    const waited = await this.awaitLists(fresh, holding, writtenAt);
    return { kind: 'next', scan: waited ? this.scanNow() : fresh };
  }

  /** The pass's writes in its order: the worker's, except that a box named for a choice's free text takes that text
   *  when it may (follow-up.ts). */
  private queue(order: readonly FieldKey[], rows: ReadonlyMap<FieldKey, FillResult>, writes: readonly PlannedWrite[],
    fields: ReadonlyMap<FieldKey, ScannedField>): QueuedWrite[] {
    const planned = new Map(writes.map((write) => [write.key, write] as const));
    const queue: QueuedWrite[] = [];
    for (const key of order) {
      const row = rows.get(key);
      if (row === undefined) continue;
      const source = this.boxes.get(key);
      const followUp = source === undefined ? null : followUpWrite(source, row, fields.get(key)!);
      if (followUp !== null) {
        queue.push(followUp);
        continue;
      }
      const write = planned.get(key);
      if (write !== undefined) queue.push({ write, planned: row });
    }
    return queue;
  }

  /** Records a write the fill made: the books (the read-back's hash), the attribution, what was written (the first
   *  write's textBefore kept for guard.revert), and a choice's free text for the box it reveals. */
  private async recordWritten(entry: WrittenField, value: CurrentValue, planned: FillResult): Promise<void> {
    const baseKey = entry.field.baseKey;
    this.attribution.wrote(baseKey);
    if (entry.resume !== null) this.resumes.push(entry.resume);
    const before = this.written.get(baseKey);
    this.written.set(baseKey, before === undefined ? entry : { ...entry, textBefore: before.textBefore });
    const freeText = entry.value.kind === 'option' ? entry.value.freeText ?? '' : '';
    if (freeText !== '') {
      this.asking.set(baseKey, { freeText, origin: entry.origin, category: planned.category,
        confidence: planned.confidence });
    }
    const valueMac = await this.hasher.mac(value);
    this.alive();
    this.state = recordWrite(this.state, entry.key, { valueMac, followUp: freeText !== '' });
  }

  // ── Option lists ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** The lists a write of this pass is known to change, by their options (childrenOf without the edges that only
   *  revealed a list, whose options no write changes). */
  private listsChangedBy(writer: BaseKey): BaseKey[] {
    const revealedOnly = (child: BaseKey) => {
      const edges = this.state.edges.filter((edge) => edge.parent === writer && edge.child === child);
      return edges.length > 0 && edges.every((edge) => edge.kind === 'revealed');
    };
    return childrenOf(this.state, writer).filter((child) => !revealedOnly(child));
  }

  /** Awaits the lists still waiting for options, the ones held back, and those this pass's writes change. Answers
   *  whether any wait was made (then the next pass scans again). */
  private async awaitLists(fresh: ScanResult, holding: ReadonlySet<FieldKey>,
    writtenAt: ReadonlyMap<BaseKey, number>): Promise<boolean> {
    const lastWrite = writtenAt.size > 0 ? Math.max(...writtenAt.values()) : null;
    const lists = new Map<BaseKey, number>();
    const add = (baseKey: BaseKey, parentAt: number | null) => {
      const tracked = this.state.fields.get(baseKey);
      if (tracked === undefined || !tracked.present || isStopped(tracked) || lists.has(baseKey)) return;
      const startedAt = parentAt ?? lastWrite ?? this.waitFrom.get(baseKey) ?? monotonicNow();
      this.waitFrom.set(baseKey, startedAt);
      lists.set(baseKey, startedAt);
    };
    for (const [writer, at] of writtenAt) for (const child of this.listsChangedBy(writer)) add(child, at);
    for (const tracked of this.state.fields.values()) if (tracked.status === 'waiting-options') add(tracked.baseKey, null);
    for (const key of holding) add(baseKeyOf(key), null);
    if (lists.size === 0) return false;

    const byBase = new Map(fresh.fields.map((field) => [field.baseKey, field] as const));
    const { stopSignal } = this.env;
    const signal = stopSignal === undefined ? this.env.signal : AbortSignal.any([this.env.signal, stopSignal]);
    let waited = false;
    const answers = await Promise.all([...lists].map(async ([baseKey, startedAt]) => {
      const tracked = this.state.fields.get(baseKey)!;
      const field = byBase.get(baseKey);
      const control = field === undefined ? null : fresh.target(field.key)?.control ?? null;
      if (control === null || !isOptionList(control)) return null;
      // The settle has just seen the list quiet: options already there need no wait.
      if (optionsState(control, tracked.optionSetHash).ready) return { baseKey, status: 'ready' as const };
      waited = true;
      const answer = await awaitOptions(control, { prevHash: tracked.optionSetHash, signal, startedAt,
        refind: () => this.refind(baseKey), ...this.env.options });
      return { baseKey, status: answer.status };
    }));
    this.alive();
    for (const answer of answers) {
      if (answer === null) continue;
      // Aborted: the run ended, or the person stopped it, which the next scan's verdict cuts.
      if (answer.status === 'aborted') continue;
      const tracked = this.state.fields.get(answer.baseKey)!;
      if (answer.status === 'ready') this.state = recordOptionsWait(this.state, tracked.key, 'ready');
      if (answer.status !== 'never-loaded') continue;
      if (tracked.status === 'waiting-options') {
        this.state = recordOptionsWait(this.state, tracked.key, 'never-loaded');
      } else if (tracked.status === 'pending') {
        // Held back while it loaded, and it never finished: blank and flagged, never matched against what it shows.
        const row = tracked.row === null ? unplannedRow(tracked, 'options-never-loaded')
          : unresolvedRow(tracked.row, 'options-never-loaded', tracked.key);
        this.state = recordRows(this.state, [row]);
      }
    }
    return waited;
  }

  // ── The end ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private result(last: ScanResult, verdict: LoopVerdict): LoopResult {
    const written = [...this.written.values()].filter((entry) => {
      const tracked = this.state.fields.get(entry.field.baseKey);
      return tracked !== undefined && tracked.present && tracked.key === entry.key;
    });
    const end = verdict.end ?? 'nothing-pending';
    log('content.loop-ended', { passes: this.passes, nothingPending: end === 'nothing-pending',
      maxPasses: end === 'max-passes', stalled: end === 'stalled', cut: end === 'cut' });
    return { rows: loopRows(this.state, verdict), scan: last, written, passes: this.passes, end,
      revealEdges: revealEdgesOf(this.state), persistableCanaries: this.persistable, busy: this.busy };
  }

  /** A dry run's one pass: the plan's rows, as the fill would leave them, and nothing written. */
  private dryRunResult(last: ScanResult, rows: FillResult[]): LoopResult {
    return { rows, scan: last, written: [], passes: this.passes, end: 'dry-run', revealEdges: [],
      persistableCanaries: this.persistable, busy: null };
  }
}
