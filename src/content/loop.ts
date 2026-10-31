/*
 * The reactive loop (docs/SPEC.md Requirement D; docs/ARCHITECTURE.md "Orchestrator"; docs/design/core.md §10.1;
 * docs/design/runtime.md §8.3): the fill step runs at most MAX_PASSES passes over the form root, on the core's books
 * (src/core/loop), which decide what each pass plans and when the loop ends. A field is known by its base key, never by
 * a node. Each pass, in order:
 * 1. scan. Every scan of the run, the DOM guard's before each write included, goes through one tap that keeps the
 *    attribution (attribution.ts), and every scan reads the run's heldPlaceholders (DOM-7);
 * 2. observeScan, with the keyed hash of each written field's value now (values.ts), the DOM's attribution, the
 *    written fields the person touched since our write (a trusted input, keydown, paste or drop the form root heard:
 *    frozen, never written again) and those that now hold nothing or their placeholder (a reset: written again). The
 *    written fields its events name are dropped (field-disappeared; options-changed, whose old write is void), but kept
 *    aside: a re-plan that finds our value in place makes them ours again (the Phase 3 review, LC-4, LC-9);
 * 3. before every pass after the first, the run's checks of what the page now shows (LoopEnv.recheck: the frame still
 *    seen, the tripwire over new passages, the policy patterns, a pause); any of them cuts the loop (L-S2, L-S4);
 * 4. plan/request with the whole scan as context and the pending fields as planKeys, in orderPending's order, with the
 *    pass's index (LC-2). A native list that shows real options while it is still loading (busy, or a loading row:
 *    awaitOptions' optionsState) is held back, so it is never matched against options on their way out; one with
 *    nothing usable goes to the worker, which can only answer waiting-for-options for it;
 * 5. each write in that order (pass.ts: the DOM guard, guardWriteInFrame, the fill, the read-back), then recordWrite
 *    with the read-back's hash and followUp (an option written with free text). A field the page replaced our value in
 *    is planned for its row only, never written (mayWrite). The box a choice's write revealed (follow-up-found at this
 *    pass's scan) takes that choice's free text instead of any write the worker planned for it (follow-up.ts); a
 *    choice whose box never showed, or whose box was not typed into and verified, is flagged other-without-free-text
 *    (LC-10). After the pass's last write one more scan sees what that write revealed at once;
 * 6. settle() (dom/settle.ts), then each written field is verified on a fresh scan (verify.ts) and its resume, if any,
 *    released;
 * 7. recordRows for every planned key. Then the lists still waiting for options, the ones held back (until their busy
 *    or loading sign clears: LC-8), and the lists a writer of this pass is known to change (childrenOf, its options
 *    edges) are awaited (awaitOptions), each counted from its parent's write, else the pass's last write: ready means
 *    the next scan sees the options, never-loaded flags options-never-loaded, gone is left to the next scan; Cancel ends
 *    the waits at once, and so does the run's end. A list the page replaces is found again by one shared scan while the
 *    page has not changed since it was made, and a pass makes at most MAX_REFIND_SCANS of them (L-S5).
 * The loop ends when loopVerdict says so: nothing pending, MAX_PASSES, or a stalled page. At the settle cap the page is
 * scanned once more, observed, and the loop is cut with page-busy (the run pauses; Continue starts afresh). Cancel
 * cuts it with user-stopped, between writes, once the writes made are settled and verified and what they revealed is
 * observed (LC-11). A dry run plans one pass and writes nothing: nothing written, nothing revealed.
 * Values, free text and hashes stay in this frame's memory; nothing here sends or logs one (plan/request carries the
 * scan's FieldSpecs, as every pass's always did). The waits are settle()'s and awaitOptions()', on dom/time.ts's
 * timers: there is no fixed sleep.
 */
import {
  baseKeyOf, childrenOf, createLoop, isStopped, loopVerdict, mayWrite, orderPending, recordOptionsWait, recordRows,
  recordWrite, revealEdgesOf, observeScan, type LoopEnd, type LoopEvent, type LoopState, type LoopVerdict,
  type ScanObservation,
} from '../core/loop/bookkeeping';
import { loopRows, unplannedRow, unresolvedRow } from '../core/loop/rows';
import { settleRow } from '../core/plan/settle';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec, OptionSetHash } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import { awaitOptions, isOptionList, optionsState, type AwaitOptionsOptions } from '../dom/await-options';
import { isUsableOption } from '../dom/option-hash';
import { scan, toFieldSpec } from '../dom/scan';
import { busySigns, settle, type SettleOptions } from '../dom/settle';
import { OPTIONS_QUIET_MS } from '../dom/thresholds';
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

/** A pass's awaited lists find the ones the page replaced again with at most this many fresh scans (L-S5). */
export const MAX_REFIND_SCANS = 24;

/** The person's own input on a field: trusted events of these types, heard on the form root (LC-4). */
const TOUCH_EVENTS = ['input', 'keydown', 'paste', 'drop'] as const;
/** At most this many touches are kept between two scans (the latest). */
const MAX_TOUCHES = 512;

/** What the loop needs from its run. */
export interface LoopEnv extends PassEnv {
  /** Sends plan/request with the whole scan's specs and the keys to plan (the run renews itself once on 'expired'),
   *  and answers the plan. */
  plan(specs: FieldSpec[], planKeys: FieldKey[], pass: number): Promise<PlanAnswer>;
  /** The run's checks before a pass after the first: null to go on, or the reason that cuts the loop (form-hidden,
   *  policy-notice, auth-required, challenge-present). */
  recheck?(): Promise<ReasonCode | null>;
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
  /** The written fields still in the page holding our value (their rows say so), under the key they have now. */
  written: WrittenField[];
  /** The passes that ran (counters.passes): the books' pass, or one more when the person stopped one mid-way. */
  passes: number;
  /** Why it ended. A dry run plans one pass. */
  end: LoopEnd | 'dry-run';
  /** The reason a cut gave what was left (page-busy, user-stopped, a recheck's), or null. */
  cut: ReasonCode | null;
  /** RunState.revealEdges: keys only, each section and label slug hashed. */
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

/** A value that is nothing, or a list's placeholder: what a page's reset leaves (the scanner reads a placeholder chosen
 *  as empty). */
function isCleared(current: CurrentValue): boolean {
  switch (current.kind) {
    case 'empty':
      return true;
    case 'text':
      return current.text.trim() === '';
    case 'checked':
      return !current.checked;
    case 'selected':
      return current.labels.length === 0;
    case 'files':
      return current.count === 0;
  }
}

/** The row of a choice whose free text was typed nowhere. */
function untypedRow(row: FillResult): FillResult {
  return { ...row, status: row.status === 'blocked' ? 'blocked' : 'flagged', reason: 'other-without-free-text',
    needsUserAction: true };
}

/** One run's loop. */
class ReactiveLoop {
  private state: LoopState = createLoop();
  /** The run's heldPlaceholders: every scan of the run reads them. */
  private readonly held = new WeakMap<Element, string>();
  private readonly attribution = new Attribution();
  /** What was written, by base key: kept when the field goes or its options change, and ours again only while its row
   *  says it wrote (a re-plan that found our value in place). */
  private readonly written = new Map<BaseKey, WrittenField>();
  /** When we last wrote each field (monotonicNow): a touch counts only after it. */
  private readonly lastWriteAt = new Map<BaseKey, number>();
  /** The person's trusted input on the form since the latest scan: elements and times only, never a value. */
  private touches: Array<{ target: Element; at: number }> = [];
  /** Every resume received: released once its pass is verified, and when the loop ends whatever happened. */
  private readonly resumes: ReceivedResume[] = [];
  /** The choices written with free text since the latest scan, by base key. Memory only. */
  private asking = new Map<BaseKey, FollowUpSource>();
  /** The boxes the latest scan named for those choices, by key. */
  private boxes = new Map<FieldKey, FollowUpSource>();
  /** The boxes named at this pass's scan, by key, and the choice each one completes. */
  private boxParents = new Map<FieldKey, BaseKey>();
  /** The named boxes this pass queued the free text for. */
  private typing = new Set<FieldKey>();
  /** From when each list's wait for its options counts (monotonicNow), by base key. */
  private readonly waitFrom = new Map<BaseKey, number>();
  /** awaitOptions' shared refind scan, made at `refindAt`, good until the form root mutates (L-S5). */
  private refindScan: ScanResult | null = null;
  private refindAt = 0;
  private refindScans = 0;
  private persistable: string[] = [];
  private busy: BusySign[] | null = null;
  private passes = 0;
  private cutBy: ReasonCode | null = null;

  constructor(private readonly env: LoopEnv, private readonly hasher: ValueHasher) {}

  private readonly onTouch = (event: Event): void => {
    if (!event.isTrusted) return;
    const target = event.composedPath()[0] as Node | undefined;
    if (target === undefined || target.nodeType !== 1) return;
    this.touches.push({ target: target as Element, at: monotonicNow() });
    if (this.touches.length > MAX_TOUCHES) this.touches.shift();
  };

  async run(): Promise<LoopResult> {
    const { root } = this.env;
    for (const type of TOUCH_EVENTS) root.addEventListener(type, this.onTouch, { capture: true });
    try {
      let current = this.scanNow();
      for (;;) {
        const observed = await this.observe(current);
        if (observed.verdict.done) return this.result(current, observed.verdict);
        if (this.env.stopped()) return this.cut(current, 'user-stopped');
        if (this.passes > 0 && !this.env.dryRun && this.env.recheck !== undefined) {
          // What the last pass revealed may be a pause, AI-directed text, a policy statement, or a hidden frame.
          const reason = await this.env.recheck();
          this.alive();
          if (reason !== null) return this.cut(current, reason);
        }
        this.passes += 1;
        const end = await this.pass(current, observed.pending);
        if (end.kind === 'dry-run') return this.dryRunResult(current, end.rows);
        if (end.kind === 'busy' || end.kind === 'stopped') {
          // What the pass revealed or changed meanwhile gets its row: one more scan, then the cut.
          await this.observe(end.scan);
          return this.cut(end.scan, end.kind === 'busy' ? 'page-busy' : 'user-stopped');
        }
        current = end.scan;
      }
    } finally {
      for (const type of TOUCH_EVENTS) root.removeEventListener(type, this.onTouch, { capture: true });
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

  /** A list's control by base key, once the page replaced its element (awaitOptions' refind): every list awaited in a
   *  pass reads one shared scan while the page has not changed since it was made, and within one options window of
   *  it; a pass makes at most MAX_REFIND_SCANS (then the list is left to the next scan). */
  private refind(baseKey: BaseKey): Element | null {
    const window = this.env.options?.quietMs ?? OPTIONS_QUIET_MS;
    if (this.refindScan !== null && monotonicNow() - this.refindAt > window) this.refindScan = null;
    if (this.refindScan === null) {
      if (this.refindScans >= MAX_REFIND_SCANS) return null;
      this.refindScans += 1;
      this.refindScan = this.scanNow();
      this.refindAt = monotonicNow();
    }
    const field = this.refindScan.fields.find((candidate) => candidate.baseKey === baseKey);
    return field === undefined ? null : this.refindScan.target(field.key)?.control ?? null;
  }

  /** The written fields the person touched after our latest write to them, by this scan's elements. */
  private touchedIn(scanned: ScanResult, wrote: readonly ScannedField[]): Set<BaseKey> {
    const touched = new Set<BaseKey>();
    const touches = this.touches;
    this.touches = [];
    if (touches.length === 0) return touched;
    for (const field of wrote) {
      const target = scanned.target(field.key);
      if (target === null) continue;
      const own = [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
      const since = this.lastWriteAt.get(field.baseKey) ?? Number.NEGATIVE_INFINITY;
      if (touches.some((touch) => touch.at > since && own.some((el) => el === touch.target || el.contains(touch.target)))) {
        touched.add(field.baseKey);
      }
    }
    return touched;
  }

  /** Folds a scan into the books, with the hashes of the written fields' values, the DOM's attribution, the person's
   *  touches and the resets. */
  private async observe(scanned: ScanResult): Promise<ScanObservation> {
    const wrote = scanned.fields.filter((field) => this.state.fields.get(field.baseKey)?.wrote === true);
    const valueMacs = await this.hasher.macsOf(wrote);
    this.alive();
    const touched = this.touchedIn(scanned, wrote);
    const cleared = new Set(wrote.filter((field) => isCleared(field.current)).map((field) => field.baseKey));
    const observed = observeScan(this.state, scanned.fields, { valueMacs, attribution: this.attribution.take(),
      touched, cleared });
    this.state = observed.state;
    this.afterScan(observed.events);
    return observed;
  }

  /** What a scan's events change here: written fields' resumes released, and the boxes named for this pass's free
   *  text. */
  private afterScan(events: readonly LoopEvent[]): void {
    const named = new Set<BaseKey>();
    this.boxes = new Map();
    this.boxParents = new Map();
    for (const event of events) {
      if (event.type === 'field-disappeared') this.release(event.baseKey);
      else if (event.type === 'follow-up-found') {
        const parent = baseKeyOf(event.parent);
        const source = this.asking.get(parent);
        if (source === undefined) continue;
        this.boxes.set(event.child, source);
        this.boxParents.set(event.child, parent);
        named.add(parent);
      }
    }
    // A choice's box shows at the scan after its write, or not at all: then its free text was not typed anywhere.
    this.untyped([...this.asking.keys()].filter((parent) => !named.has(parent)));
    this.asking = new Map();
  }

  /** Flags these choices' rows other-without-free-text: their free text was typed nowhere (LC-10). */
  private untyped(parents: readonly BaseKey[]): void {
    const rows: FillResult[] = [];
    for (const parent of parents) {
      const tracked = this.state.fields.get(parent);
      const row = tracked?.row ?? null;
      if (tracked?.status !== 'resolved' || row === null || !row.wrote || row.reason !== 'other-option-with-free-text') {
        continue;
      }
      rows.push(untypedRow(row));
    }
    if (rows.length > 0) this.state = recordRows(this.state, rows);
  }

  /** Releases a written field's resume: the field went. What was written is kept, in case it comes back holding it. */
  private release(baseKey: BaseKey): void {
    const entry = this.written.get(baseKey);
    if (entry === undefined || entry.resume === null) return;
    entry.resume.release();
    this.written.set(baseKey, { ...entry, resume: null });
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
      // The whole scan goes as context; only the asked keys are planned (LC-2), and only their answers are taken.
      const plan = await env.plan(current.fields.map(toFieldSpec), asked, this.state.pass);
      this.alive();
      this.persistable = plan.persistableCanaries;
      const wanted = new Set<string>(asked);
      // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      for (const row of plan.results as unknown as FillResult[]) if (wanted.has(row.key)) rows.set(row.key, row);
      writes = (plan.writes as unknown as PlannedWrite[]).filter((write) => wanted.has(write.key));
      awaiting = (plan.awaiting as FieldKey[]).filter((key) => wanted.has(key));
    }
    if (env.dryRun) {
      for (const [key, row] of rows) rows.set(key, settleRow(row, { kind: 'dry-run' }));
      this.state = recordRows(this.state, rows.values(), { awaiting });
      return { kind: 'dry-run', rows: [...rows.values()] };
    }

    const done: WrittenField[] = [];
    const writtenAt = new Map<BaseKey, number>();
    for (const { write, planned, keep } of this.queue(order, rows, writes, fields)) {
      if (env.signal.aborted || !env.valid()) throw new RunAborted();
      if (env.stopped()) {
        rows.set(write.key, settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }));
        continue;
      }
      const result = await writeField(env, current, fields.get(write.key)!, write, planned, this.held,
        keep === undefined ? {} : { keep });
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
    this.settleFollowUps(rows);
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
   *  when it may (follow-up.ts), and that a field whose value the page replaced is never written (mayWrite). */
  private queue(order: readonly FieldKey[], rows: ReadonlyMap<FieldKey, FillResult>, writes: readonly PlannedWrite[],
    fields: ReadonlyMap<FieldKey, ScannedField>): QueuedWrite[] {
    const planned = new Map(writes.map((write) => [write.key, write] as const));
    const queue: QueuedWrite[] = [];
    this.typing = new Set();
    for (const key of order) {
      const row = rows.get(key);
      if (row === undefined || !mayWrite(this.state, key)) continue;
      const source = this.boxes.get(key);
      const followUp = source === undefined ? null : followUpWrite(source, row, fields.get(key)!);
      if (followUp !== null) {
        queue.push(followUp);
        this.typing.add(key);
        continue;
      }
      const write = planned.get(key);
      if (write !== undefined) queue.push({ write, planned: row });
    }
    return queue;
  }

  /** The choices whose box this pass's scan named: each keeps "your answer typed in" only when its box took the free
   *  text and it read back after the settle; else other-without-free-text (the box refused, kept its text, failed, or
   *  the person stopped the run first: LC-10). */
  private settleFollowUps(rows: ReadonlyMap<FieldKey, FillResult>): void {
    const untyped: BaseKey[] = [];
    for (const [box, parent] of this.boxParents) {
      const row = rows.get(box);
      const typed = this.typing.has(box) && row !== undefined && row.wrote && row.verification === 'verified';
      if (!typed) untyped.push(parent);
    }
    this.boxParents = new Map();
    this.typing = new Set();
    this.untyped(untyped);
  }

  /** Records a write the fill made: the books (the read-back's hash), the attribution, what was written (the first
   *  write's textBefore kept for guard.revert), when, and a choice's free text for the box it reveals. */
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
    // Taken after the fill: the trusted input and change Chromium fires during our click on a box are ours, not the
    // person's.
    this.lastWriteAt.set(baseKey, monotonicNow());
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
    const lists = new Map<BaseKey, { startedAt: number; prevHash: OptionSetHash | null }>();
    const add = (baseKey: BaseKey, parentAt: number | null, changes: boolean) => {
      const tracked = this.state.fields.get(baseKey);
      if (tracked === undefined || !tracked.present || isStopped(tracked) || lists.has(baseKey)) return;
      const startedAt = parentAt ?? lastWrite ?? this.waitFrom.get(baseKey) ?? monotonicNow();
      this.waitFrom.set(baseKey, startedAt);
      // A list held back only while it loaded waits for its busy or loading sign to clear, not for new options (LC-8).
      lists.set(baseKey, { startedAt, prevHash: changes ? tracked.optionSetHash : null });
    };
    for (const [writer, at] of writtenAt) for (const child of this.listsChangedBy(writer)) add(child, at, true);
    for (const tracked of this.state.fields.values()) {
      if (tracked.status === 'waiting-options') add(tracked.baseKey, null, true);
    }
    for (const key of holding) add(baseKeyOf(key), null, false);
    if (lists.size === 0) return false;

    const byBase = new Map(fresh.fields.map((field) => [field.baseKey, field] as const));
    const { stopSignal } = this.env;
    const signal = stopSignal === undefined ? this.env.signal : AbortSignal.any([this.env.signal, stopSignal]);
    // The lists' refinds share one scan until the form root mutates (L-S5).
    this.refindScan = null;
    this.refindScans = 0;
    const view = this.env.root.ownerDocument.defaultView;
    const stale = view === null ? null : new view.MutationObserver(() => {
      this.refindScan = null;
    });
    stale?.observe(this.env.root, { subtree: true, childList: true, attributes: true, characterData: true });
    let waited = false;
    let answers: Array<{ baseKey: BaseKey; status: string } | null>;
    try {
      answers = await Promise.all([...lists].map(async ([baseKey, { startedAt, prevHash }]) => {
        const field = byBase.get(baseKey);
        const control = field === undefined ? null : fresh.target(field.key)?.control ?? null;
        if (control === null || !isOptionList(control)) return null;
        // The settle has just seen the list quiet: options already there need no wait.
        if (optionsState(control, prevHash).ready) return { baseKey, status: 'ready' as const };
        waited = true;
        const answer = await awaitOptions(control, { prevHash, signal, startedAt,
          refind: () => this.refind(baseKey), ...this.env.options });
        return { baseKey, status: answer.status };
      }));
    } finally {
      stale?.disconnect();
      this.refindScan = null;
    }
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

  /** Ends the loop now: what is pending or waiting takes `reason`. */
  private cut(last: ScanResult, reason: ReasonCode): LoopResult {
    this.cutBy = reason;
    return this.result(last, loopVerdict(this.state, { cut: reason }));
  }

  private result(last: ScanResult, verdict: LoopVerdict): LoopResult {
    // Boxes named for a choice's free text that no pass typed into: the choice says so.
    this.untyped([...this.boxParents.values()]);
    this.boxParents = new Map();
    // What was written counts as ours while the field is there and its row says we wrote it, under its key now (a
    // re-plan that found our value in place, LC-9); never once the person changed it (LC-4).
    const written = [...this.written.values()].flatMap((entry) => {
      const tracked = this.state.fields.get(entry.field.baseKey);
      if (tracked === undefined || !tracked.present || tracked.row?.wrote !== true) return [];
      if (tracked.status === 'frozen' && tracked.reason === 'changed-by-you') return [];
      return [tracked.key === entry.key ? entry : { ...entry, key: tracked.key, field: { ...entry.field,
        key: tracked.key } }];
    });
    const end = verdict.end ?? 'nothing-pending';
    log('content.loop-ended', { passes: this.passes, nothingPending: end === 'nothing-pending',
      maxPasses: end === 'max-passes', stalled: end === 'stalled', cut: end === 'cut' });
    return { rows: loopRows(this.state, verdict), scan: last, written, passes: this.passes, end, cut: this.cutBy,
      revealEdges: revealEdgesOf(this.state), persistableCanaries: this.persistable, busy: this.busy };
  }

  /** A dry run's one pass: the plan's rows, as the fill would leave them, and nothing written. */
  private dryRunResult(last: ScanResult, rows: FillResult[]): LoopResult {
    return { rows, scan: last, written: [], passes: this.passes, end: 'dry-run', cut: null, revealEdges: [],
      persistableCanaries: this.persistable, busy: null };
  }
}
