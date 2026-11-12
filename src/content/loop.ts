/*
 * The reactive loop (docs/SPEC.md Requirement D; docs/ARCHITECTURE.md "Orchestrator"; docs/design/core.md §10.1;
 * docs/design/runtime.md §8.3): the fill step runs at most MAX_PASSES passes over the form root, on the core's books
 * (src/core/loop), which decide what each pass plans and when the loop ends. A field is known by its base key, never by
 * a node. Each pass, in order:
 * 1. scan. Every scan of the run, the DOM guard's before each write included, goes through one tap that keeps the
 *    attribution (attribution.ts), and every scan reads the run's heldPlaceholders (DOM-7). Every scan reads the form
 *    root as the run finds it then (LoopEnv.root, found again by the adapter's hook): a page that draws its whole form
 *    again mid-fill (Twitch's Greenhouse form) is scanned anew, and the fields the new form shows empty are resets,
 *    written again;
 * 2. observeScan, with the keyed hash of each written field's value now (values.ts), the DOM's attribution, the
 *    written fields the person touched since our write (a trusted input, keydown, paste or drop: touches.ts, which the
 *    run keeps for its document, resting included; frozen, never written again) and those that now hold nothing or
 *    their placeholder (a reset: written again). The
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
 * 7. recordRows for every planned key. Then the waiting path (Phase 4): each lazy widget whose row waits for options
 *    is opened, read whole and closed (dom/widgets' readWidget), and what it showed is kept as its reading by base key,
 *    which every later scan of the run reads (ScanOptions.widgetReadings), so the next pass plans it with real options;
 *    one that ignores our activation is flagged needs-your-click (a dry run opens nothing), after the run's one wait
 *    for a page whose script has not attached yet (WidgetReadiness, one record for the run, which the pass's widget
 *    writes share); one the page replaced meanwhile is left to the next scan. Then the lists still
 *    waiting for options, the ones held back (until their busy or loading sign clears: LC-8), and the lists a writer
 *    of this pass is known to change (childrenOf, its options edges) are awaited (awaitOptions), each counted from its parent's write, else the pass's last write: ready means
 *    the next scan sees the options, never-loaded flags options-never-loaded, gone is left to the next scan; Cancel ends
 *    the waits at once, and so does the run's end. A list the page replaces is found again by one shared scan while the
 *    page has not changed since it was made, and a pass makes at most MAX_REFIND_SCANS of them (L-S5). Last (jr7
 *    ENGINE-7 E2 item 1, ADP7-2), a required field the pass left empty because the page held it disabled or read-only
 *    is waited for (awaitWritable) until the page lets it in, then planned again; past WRITABLE_WAIT_MS it is flagged.
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19, ADP-2): a field its adapter names as resetting another
 * (Adapter.dependsOn) is written before it in the pass (pass.ts parentsFirst), and the page's answer awaited after its
 * write (pass.ts writeField); each scan tells the books which fields depend on which, and which the page now draws as
 * other elements, so a dependent is decided again after its parent's write (bookkeeping.ts: 'parent-written',
 * 'reshaped'). jr6 line W review (REVC-7): a dependent whose parent waits for its options this pass (a lazy list read
 * at the pass's end: Oracle's Country on a first visit), or is held back itself, is held back too (heldDependents):
 * not written, given no row, still pending, so a later pass writes it after its parent instead of before it and again.
 * Fields the plan leaves waiting for the LLM (Phase 4: a tiebreak or a classification the worker asked TailorIT for)
 * are polled with plan/poll before each pass: at once when the pass has other fields to plan, else every AI_POLL_MS
 * until an answer comes, capped at AI_WAIT_CAP_MS with no answer coming in (then llm-unavailable); a field the worker
 * planned again and asked anew (a classification in, then its answer asked) counts as an answer coming in, so each
 * task of a chain has its own cap (the Phase E review, M6). Once the run fills from the profile only (LoopEnv.aiOff),
 * what still waits is given up, and an AI write that came in is not written, both ai-off-for-posting. What arrives (rows,
 * and the writes of those the LLM settled) is written by the next pass through the same guards as its own plan's, an
 * llm-pick's option text checked again (guardWriteInFrame's llmPickStillValid); a field the worker no longer knows (it
 * restarted) is pending again, so the next pass asks plan/request again. A field the pass wrote anyway (a choice's free
 * text typed into it) stops waiting. A dry run waits for its answers too, and shows their rows.
 * A cover-letter upload waiting for the run's letter (Phase G: TailorIT finding or writing it) is polled the same way,
 * under LETTER_WAIT_CAP_MS instead (the worker's own cap is 180 s), and given up as cover-letter-timed-out (or
 * cover-letter-unavailable when the worker could not answer). A profile-only run keeps waiting for it (a letter the
 * person wrote is still theirs to attach), but never writes one TailorIT's AI wrote (cover-letter-written).
 * The loop ends when loopVerdict says so: nothing pending, MAX_PASSES, or a stalled page. At the settle cap the page is
 * scanned once more, observed, and the loop is cut with page-busy (the run pauses; Continue starts afresh). Cancel
 * cuts it with user-stopped, between writes, once the writes made are settled and verified and what they revealed is
 * observed (LC-11). A dry run plans one pass and writes nothing: nothing written, nothing revealed.
 * A later attempt on the same step in the same run (a validation's fix pass, or the step again after Back) starts from
 * the earlier attempt's books (LoopEnv.carry, LoopResult.carry: the Phase 5 review, C-S3 and C-S5): the fields we wrote
 * keep their value hashes under the run's one key (LoopEnv.hasher), what was written (for the final Guard) and when, so
 * a value still ours keeps our verified row and is not written again, a value the person changed since is theirs
 * (changed-by-you, never written), and one the page reset is written again. Its passes add to the earlier ones'.
 * v3 Phase 3: the loop tells its run how far it is (LoopEnv.progress: the rows known now, the keys the pass still
 * writes, the one it writes now), so the side panel spins the current row and counts only what is done; and the write
 * being made can be given up at the person's Skip (CurrentWrite): that one write's waits end at once, its field is
 * flagged skipped-by-you and never planned or written again in the run, and the pass goes on. Skip never passes a
 * guard: it only ever writes less.
 * Values, free text and hashes stay in this frame's memory; nothing here sends or logs one (plan/request carries the
 * scan's FieldSpecs, as every pass's always did). The waits are settle()'s and awaitOptions()', on dom/time.ts's
 * timers: there is no fixed sleep.
 * v5 p2-stream (Jobright parity, Phase 2: each AI answer fills as it lands): TailorIT streams each answer as it lands
 * and the worker tells the frame (plan/ready, LoopEnv.wake: AiWake), so the wait for the AI polls at once instead of
 * at its next AI_POLL_MS tick; the tick stays, as the fallback and to keep the worker awake. A pass that only writes
 * answers that came in (no field planned or held back) is not counted against MAX_PASSES or MAX_AI_PASSES
 * (bookkeeping.ts noteArrivalPass; MAX_LOOP_PASSES still ends any loop), since answers now arrive a few at a time.
 */
import {
  awaitingKeys, baseKeyOf, carriedFields, childrenOf, createLoop, holdBack, isStopped, loopVerdict, mayWrite,
  noteArrivalPass, orderPending, recordOptionsWait, recordRows, recordWritableWait, recordWrite, requeueAwaiting,
  revealEdgesOf, observeScan, type LoopEnd, type LoopEvent, type LoopState, type LoopVerdict, type ScanObservation, type TrackedField,
} from '../core/loop/bookkeeping';
import { loopRows, unplannedRow, unresolvedRow } from '../core/loop/rows';
import type { Provenance } from '../core/enums';
import { resumeFirst, signatureLast } from '../core/plan/order';
import { settleRow } from '../core/plan/settle';
import { reconcilePrefill, type PrefillIntent } from '../core/steps/prefill';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec, OptionSetHash } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import { awaitOptions, isOptionList, optionsState, type AwaitOptionsOptions } from '../dom/await-options';
import { isUsableOption } from '../dom/option-hash';
import { scan, toFieldSpec } from '../dom/scan';
import { busySigns, settle, type SettleOptions } from '../dom/settle';
import { OPTIONS_QUIET_MS } from '../dom/thresholds';
import { deadline, monotonicNow } from '../dom/time';
import {
  BUSY_SIGNS, type BusySign, type ScannedField, type ScanResult, type SettleResult, type WidgetReading,
} from '../dom/types';
import { newBridgeRun, newReadiness, readWidget, type LearnList } from '../dom/widgets';
import type { StoredListId } from '../shared/learned-lists';
import { log } from '../shared/log';
import { Attribution } from './attribution';
import { followUpWrite, type FollowUpSource, type QueuedWrite } from './follow-up';
import { phoneCountryFirst } from './phone-order';
import { boxBeforeEndDate, filesAfterTheRest } from './repeatables';
import {
  dependenciesOf, parentsFirst, RunAborted, writeField, type PassEnv, type PlanAnswer, type WidgetWriteEnv,
  type WriteResult, type WrittenField,
} from './pass';
import type { ReceivedResume } from './transfer';
import { TouchLog } from './touches';
import { createValueHasher, type ValueHasher } from './values';
import { verifyWritten } from './verify';

/** settle()'s windows and caps, overridable for tests. */
export type SettleTimings = Pick<SettleOptions, 'quietMs' | 'capMs' | 'optionsCapMs'>;
/** awaitOptions()' window and cap, overridable for tests. */
export type OptionsTimings = Pick<AwaitOptionsOptions, 'quietMs' | 'capMs'>;

/** A pass's awaited lists find the ones the page replaced again with at most this many fresh scans (L-S5). */
export const MAX_REFIND_SCANS = 24;

/** How often the fields waiting for the LLM are polled (TailorIT's AUTOFILL_AI_POLL_MS; test/contract.test.ts checks):
 *  each plan/poll keeps the worker awake while its task runs. */
export const AI_POLL_MS = 1500;
/** How long the loop waits for the LLM with no answer coming in: the worker's own cap on a task (120 s) and a poll
 *  more. Past it the fields still waiting are left blank and flagged (llm-unavailable). */
export const AI_WAIT_CAP_MS = 125_000;
/** How long the loop waits for a cover-letter upload's letter with no answer coming in (Phase G): the worker's cap on
 *  it (180 s, background/cover-letters.ts LETTER_CAP_MS) and a few polls more. */
export const LETTER_WAIT_CAP_MS = 185_000;
/** The P2 review (H1's backstop): a field the worker plans again and asks anew more often than this in one run is
 *  given up (llm-unavailable, flagged): asked again so often, it would keep the wait for the AI from ever reaching its
 *  cap. A chain asks a field anew two or three times at most (a classification, then an answer or a draft, then
 *  another scope). */
export const MAX_AI_REASKS = 4;
/** A dry run plans one pass, and asks again at most this many times for fields the worker forgot (it restarted). */
const DRY_RUN_ASKS = 2;

// ── jr7 ENGINE-7 E2 item 1 (FIX7PLAN §6.2, ADP7-2) ──
/** How long a required, empty field the page holds disabled or read-only is waited for, from the end of the pass that
 *  first found it so (ADP's Address Line 1, read-only until its Country is in): then it is flagged for the person. */
export const WRITABLE_WAIT_MS = 3_000;
/** The wait looks at the page again at least this often, besides each change of the attributes that lock a field. */
const WRITABLE_POLL_MS = 200;
/** The attributes whose change may let a held field in. */
const LOCK_ATTRIBUTES = ['disabled', 'readonly', 'aria-disabled', 'aria-readonly'];

/** A field the page lets a person write: as the planner reads it (frame.ts: disabled or read-only is skipped). */
function writableField(field: ScannedField): boolean {
  return !field.disabled && !field.readOnly;
}
// ── end jr7 ENGINE-7 E2 item 1 ──

// v5 p2-stream
/**
 * The worker's word that answers the run waits for came in (plan/ready): the loop's wait for the AI ends at once and
 * polls. A ring between a poll and the wait after it is kept (`pending`), so it is never lost. Holds no key.
 */
export class AiWake {
  private controller = new AbortController();
  private rung = false;

  /** plan/ready came: the wait now, or the next one, ends at once. */
  ring(): void {
    this.rung = true;
    this.controller.abort();
  }

  /** A poll is about to read everything in: what rang before it is taken. */
  take(): void {
    this.rung = false;
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }

  /** Whether it rang since the last take. */
  get pending(): boolean {
    return this.rung;
  }

  /** Aborted by the next ring (already, when it rang since the last take). */
  get signal(): AbortSignal {
    return this.controller.signal;
  }
}
// v5 p2-stream end

/** The write the loop makes now, and the person's Skip of it (v3 Phase 3): the run holds one and the loop fills it in
 *  around each write. Keys only. */
export class CurrentWrite {
  private now: { key: FieldKey; skip: AbortController } | null = null;

  /** A write of `key` begins: answers the signal its Skip aborts. */
  begin(key: FieldKey): AbortSignal {
    this.now = { key, skip: new AbortController() };
    return this.now.skip.signal;
  }

  end(): void {
    this.now = null;
  }

  /** The key being written now, or null. */
  get key(): FieldKey | null {
    return this.now?.key ?? null;
  }

  /** Gives up the write of `key` when it is the one being made now; answers whether it was. */
  skip(key: FieldKey): boolean {
    if (this.now === null || this.now.key !== key) return false;
    this.now.skip.abort();
    return true;
  }
}


/** What the loop needs from its run. */
export interface LoopEnv extends PassEnv {
  /** Sends plan/request with the whole scan's specs and the keys to plan (the run renews itself once on 'expired'),
   *  and answers the plan. `revealEdges`: this run's reveal edges on the step ([parent, child] base keys), for a
   *  draft's context (the Phase 6 review, E2). */
  plan(specs: FieldSpec[], planKeys: FieldKey[], pass: number, revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]>):
    Promise<PlanAnswer>;
  /** plan/request for some of the frame's fields only (a typeahead's results, Phase 4): the run sends its step's
   *  block→entry assignment with it (Phase 5). plan() without it. */
  planSome?(specs: FieldSpec[], planKeys: FieldKey[], pass: number): Promise<PlanAnswer>;
  /** Sends plan/poll for fields that wait for the LLM (Phase 4): the answer holds the rows and writes of those whose
   *  answers are in and names those still waited for; 'expired' when the worker knows none of them; 'failed' when it
   *  could not answer. Without it nothing is polled, and a waiting field ends as the loop leaves it. */
  poll?(keys: FieldKey[]): Promise<PlanAnswer | 'expired' | 'failed'>;
  /** Whether the run fills from the profile only now (the owner's amendments: a later pass found the posting forbids
   *  AI, or an "I did not use AI" attestation): the fields still waiting for the LLM are given up, ai-off-for-posting,
   *  and an AI write that came in is never written (the Phase E review, security MINOR 4). */
  aiOff?(): boolean;
  /** A draft about to be written: the row it rests with instead when the run holds it back (an AI draft on a page
   *  that saves every answer as it is written, while drafts wait for the person: orchestrator.ts), else null. */
  holdDraft?(write: PlannedWrite, planned: FillResult): FillResult | null;
  /** The poll interval and the caps on waiting for the LLM and for a cover letter (Phase G), overridable for tests. */
  ai?: { pollMs?: number; capMs?: number; letterCapMs?: number };
  /** The run's checks before a pass after the first: null to go on, or the reason that cuts the loop (form-hidden,
   *  policy-notice, auth-required, challenge-present). */
  recheck?(): Promise<ReasonCode | null>;
  /** Aborted when the person stops the run (stopped() turns true): a wait for a list's options ends at once. */
  stopSignal?: AbortSignal;
  /** Where the run keeps what it read of its lazy widgets (Phase 4); a map of the loop's own without it. */
  widgetReadings?: Map<BaseKey, WidgetReading>;
  /** s2 lists: the lists this host's dropdowns showed before (ScanOptions.learnedLists), and where a learnable
   *  dropdown's complete whole read is told (the orchestrator keeps it and sends it to the worker). */
  learnedLists?: ReadonlyMap<string, readonly string[]>;
  /** s2 lists: the stored lists the worker served the run (ScanOptions.storedLists). */
  storedLists?: ReadonlyMap<StoredListId, readonly string[]>;
  learn?: LearnList;
  settle?: SettleTimings;
  options?: OptionsTimings;
  /** The run's keyed value hasher (one key for the run, so an earlier attempt's hashes compare); a key of the loop's
   *  own without it. */
  hasher?: ValueHasher;
  /** The person's input on the document, as the run hears it all along (touches.ts); the loop listens on the form
   *  root for its own time without it. */
  touches?: TouchLog;
  /** An earlier attempt's books on this step, in this run (LoopResult.carry): the Phase 5 review, C-S3. */
  carry?: LoopCarry;
  /** How far the fill is (v3 Phase 3): the rows known now in DOM order, the keys the pass still writes (the one being
   *  written among them) and the one written now (null between writes). Called often and never awaited. */
  progress?(rows: readonly FillResult[], pending: readonly FieldKey[], current: FieldKey | null): void;
  /** Where the loop names the write it makes now, so the person's Skip can give it up (CurrentWrite). */
  writing?: CurrentWrite;
  /** v5 p2-stream: rung by the worker's plan/ready (an answer came in): the wait for the AI polls at once. Without it
   *  the wait polls every AI_POLL_MS only. */
  wake?: AiWake;
}

/** What a later attempt on the same step starts from (LoopEnv.carry): the books of the fields written or taken over,
 *  what was written and when, and the passes made so far. Memory only: `written` holds values. */
export interface LoopCarry {
  fields: readonly TrackedField[];
  written: ReadonlyMap<BaseKey, WrittenField>;
  /** When each was last written (monotonicNow): a touch counts only after it. */
  lastWriteAt: ReadonlyMap<BaseKey, number>;
  passes: number;
  /** The fields the person skipped (v3 Phase 3), with their skipped-by-you row (null: the write stood). Optional, so an
   *  older carry reads as none skipped. */
  skipped?: ReadonlyMap<BaseKey, FillResult | null>;
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
  /** What the step's next attempt in this run starts from (LoopEnv.carry). Memory only. */
  carry: LoopCarry;
}

/** How a pass ended. */
type PassEnd =
  | { kind: 'next'; scan: ScanResult }
  | { kind: 'busy'; scan: ScanResult }
  | { kind: 'stopped'; scan: ScanResult }
  | { kind: 'dry-run'; rows: FillResult[] };

/** Runs the reactive loop over the form root. */
export async function runLoop(env: LoopEnv): Promise<LoopResult> {
  const hasher = env.hasher ?? await createValueHasher();
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

/** jr7 ENGINE-7 E2 item 1 (ADP7-2): the keys of a pass's rows that wrote nothing for disabled-or-readonly (the
 *  planner's skip, the DOM guard's refusal) on a field the fresh scan shows required and empty: the books hold them
 *  waiting for the page to let them in (recordRows' `locked`). A field that holds a value never waits. Nor does one
 *  that waited before (`waited`) and that the fresh scan reads writable again: the page let it in and the plan still
 *  says it is locked, so a second wait would only plan it again, pass after pass; its row stands. */
function lockedIn(fresh: ScanResult, rows: ReadonlyMap<FieldKey, FillResult>, waited: (baseKey: BaseKey) => boolean):
  FieldKey[] {
  const byKey = new Map(fresh.fields.map((field) => [field.key, field] as const));
  return [...rows.values()].filter((row) => {
    if (row.wrote || row.reason !== 'disabled-or-readonly') return false;
    const field = byKey.get(row.key);
    return field !== undefined && field.required && isCleared(field.current)
      && !(waited(field.baseKey) && writableField(field));
  }).map((row) => row.key);
}

/** The provenances of what the AI writes: an option it picked, a draft, an answer. */
const AI_WRITES: ReadonlySet<Provenance> = new Set<Provenance>(['llm-pick', 'llm-draft', 'llm-answer']);

/** Whether an arrived write is the AI's: an AI provenance, or a cover letter TailorIT's AI wrote (Phase G: its origin
 *  is the profile's document, its row says the AI wrote it). */
function aiWrite(entry: { row: FillResult; write?: PlannedWrite }): boolean {
  return entry.write !== undefined && (AI_WRITES.has(entry.write.origin.provenance)
    || entry.row.reason === 'cover-letter-written');
}

/** Whether a waiting field waits for the run's cover letter (Phase G), by the row it stands with: a cover-letter upload,
 *  or (the audit of 2026-11-06, M2) a cover-letter text box waiting for the letter's words (v3 Phase 3b: its row
 *  cover-letter-waiting; a rewrite Edit with AI asked for in it waits for the AI as any field does). */
function waitsForLetter(field: { row: FillResult | null } | undefined): boolean {
  const row = field?.row;
  return row?.category === 'file.coverLetter'
    || (row?.category === 'freeText.coverLetter' && row.reason === 'cover-letter-waiting');
}

/** The row of a field the AI would have answered, once the run fills from the profile only: an optional question left
 *  skipped stays so, and any other is flagged ai-off-for-posting with nothing of the AI's in it (planFrame's own rule). */
function aiOffRow(row: FillResult, key: FieldKey = row.key): FillResult {
  if (row.status === 'skipped' && row.provenance === null) return { ...row, key };
  if (row.status === 'blocked') return { ...row, key };
  return { ...row, key, status: 'flagged', reason: 'ai-off-for-posting', provenance: null, wrote: false,
    verification: 'not-applicable', needsUserAction: true };
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
  /** What the run has read of its lazy widgets, by base key (Phase 4): every scan of the run reads them. */
  private readonly readings: Map<BaseKey, WidgetReading>;
  /** Whether the page answered a declared activation yet (dom/widgets' WidgetReadiness), for the whole run. */
  private readonly readiness = newReadiness();
  /** The run's page-world bridge (dom/widgets' BridgeRun): once its word did not hold, no command is sent this run. */
  private readonly bridge = newBridgeRun();
  /** The fields the person skipped while they were written (v3 Phase 3): never planned or written again on this step,
   *  this attempt or a later one (LoopCarry.skipped). Each with its skipped-by-you row, or null when the write had
   *  touched the page and its own row stands. */
  private readonly skipped = new Map<BaseKey, FillResult | null>();
  private readonly attribution = new Attribution();
  /** What was written, by base key: kept when the field goes or its options change, and ours again only while its row
   *  says it wrote (a re-plan that found our value in place). */
  private readonly written = new Map<BaseKey, WrittenField>();
  /** When we last wrote each field (monotonicNow): a touch counts only after it. */
  private readonly lastWriteAt = new Map<BaseKey, number>();
  /** The person's trusted input (touches.ts): elements and times only, never a value. */
  private touches: TouchLog | null = null;
  /** The passes an earlier attempt on this step made (LoopEnv.carry). */
  private readonly passesBefore: number;
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
  /** What plan/poll brought for fields that waited for the LLM, by key: their row, and their write when there is one
   *  (memory only: a write holds a value). The next pass writes them as it writes its own plan's. */
  private arrived = new Map<FieldKey, { row: FillResult; write?: PlannedWrite }>();
  /** When the wait for the LLM last made progress (a field began waiting, or an answer came): its cap runs from it. */
  private aiProgressAt: number | null = null;
  private aiPolls = 0;
  /** How often the worker planned each field again and asked it anew (MAX_AI_REASKS). Keys only. */
  private readonly reasked = new Map<FieldKey, number>();
  /** This pass's fields still to come besides its writes (v3 Phase 3 review): those that began to wait for the AI and
   *  those whose list's options it waits for. The progress counts them as being filled, never as left for the person. */
  private waitingNow: FieldKey[] = [];

  constructor(private readonly env: LoopEnv, private readonly hasher: ValueHasher) {
    this.readings = env.widgetReadings ?? new Map();
    const carry = env.carry;
    this.passesBefore = carry?.passes ?? 0;
    if (carry !== undefined) {
      this.state = createLoop({ carried: carry.fields });
      // What was written stays ours to verify; its resume was released when its own attempt ended.
      for (const [baseKey, entry] of carry.written) this.written.set(baseKey, { ...entry, resume: null });
      for (const [baseKey, at] of carry.lastWriteAt) this.lastWriteAt.set(baseKey, at);
      for (const [baseKey, row] of carry.skipped ?? []) this.skipped.set(baseKey, row);
    }
  }

  async run(): Promise<LoopResult> {
    const listening = new AbortController();
    this.touches = this.env.touches ?? new TouchLog(this.env.root, listening.signal);
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
        let pending = observed.pending;
        if (awaitingKeys(this.state).length > 0 && this.env.poll !== undefined && !this.env.dryRun) {
          // Fields waiting for the LLM are polled between passes; with nothing else to plan, the loop waits for them.
          const requeued = await this.pollAwaiting(pending.length === 0);
          pending = [...pending, ...requeued];
          if (pending.length === 0 && this.arrived.size === 0) {
            if (this.env.stopped()) return this.cut(current, 'user-stopped');
            const verdict = loopVerdict(this.state);
            if (verdict.done) return this.result(current, verdict);
          }
        }
        this.passes += 1;
        const end = await this.pass(current, pending);
        if (end.kind === 'dry-run') return this.dryRunResult(current, end.rows);
        if (end.kind === 'busy' || end.kind === 'stopped') {
          // What the pass revealed or changed meanwhile gets its row: one more scan, then the cut.
          await this.observe(end.scan);
          return this.cut(end.scan, end.kind === 'busy' ? 'page-busy' : 'user-stopped');
        }
        current = end.scan;
      }
    } finally {
      listening.abort();
      for (const resume of this.resumes) resume.release();
    }
  }

  private alive(): void {
    if (this.env.signal.aborted) throw new RunAborted();
  }

  // ── Scans ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A fresh scan of the form root as the run finds it now (LoopEnv.root: a form the page drew again is the new one),
   *  which the attribution sees, as it sees its rescans. */
  private scanNow(): ScanResult {
    const { env } = this;
    return this.seen(scan(env.root, env.adapter, { platform: env.platform, frameId: env.frameId,
      heldPlaceholders: this.held, widgetReadings: this.readings,
      ...(env.learnedLists === undefined ? {} : { learnedLists: env.learnedLists }),
      ...(env.storedLists === undefined ? {} : { storedLists: env.storedLists }) }));
  }

  /** A scan the attribution has seen; its rescans scan the form root found then, never the one it was made from. */
  private seen(result: ScanResult): ScanResult {
    this.attribution.saw(result.fields);
    return { ...result, rescan: () => this.scanNow() };
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
    if (touches === null) return touched;
    for (const field of wrote) {
      const target = scanned.target(field.key);
      if (target === null) continue;
      const own = [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
      const since = this.lastWriteAt.get(field.baseKey) ?? Number.NEGATIVE_INFINITY;
      if (own.some((el) => touches.touchedSince(el, since))) touched.add(field.baseKey);
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
    // jr7 ENGINE-7 E2 item 1 (ADP7-2): the held fields the page now lets in.
    const writable = new Set(scanned.fields.filter((field) => writableField(field)
      && this.state.fields.get(field.baseKey)?.status === 'waiting-writable').map((field) => field.baseKey));
    const observed = observeScan(this.state, scanned.fields, { valueMacs, attribution: this.attribution.take(),
      touched, cleared, uploaded: this.uploadsTaken(), ...this.reshapes(scanned), writable });
    this.state = observed.state;
    this.afterScan(observed.events);
    return observed;
  }

  // ── jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19's re-plan, ADP-2) ──
  /** Each field's element at the scan before, by base key: a field the page draws as another element since is told to
   *  the books (ScanInput.replaced). Elements only, never a value; dropped with the loop. */
  private drawnAs = new Map<BaseKey, Element>();

  /** What a scan tells the books of the fields a write resets (ScanInput.dependsOn: the adapter's dependsOn, child to
   *  parent) and of the fields the page now draws as other elements than at the scan before (ScanInput.replaced). */
  private reshapes(scanned: ScanResult): { dependsOn: Map<BaseKey, BaseKey>; replaced: Set<BaseKey> } {
    const replaced = new Set<BaseKey>();
    const drawnAs = new Map<BaseKey, Element>();
    for (const field of scanned.fields) {
      const control = scanned.target(field.key)?.control;
      if (control === undefined) continue;
      const before = this.drawnAs.get(field.baseKey);
      if (before !== undefined && before !== control) replaced.add(field.baseKey);
      drawnAs.set(field.baseKey, control);
    }
    this.drawnAs = drawnAs;
    return { dependsOn: dependenciesOf(scanned, this.env.adapter), replaced };
  }

  /**
   * jr6 line W review (REVC-7): the writes a pass holds back because the field whose write resets them
   * (Adapter.dependsOn) is written in a later pass, not this one: it waits for its list's options (its row this pass
   * says waiting-for-options: a lazy list, read at this pass's end, as Oracle's Country is on a first visit; or its books
   * say it still waits), or it is held back itself (a chain: Oracle's ZIP under Address Line 1 under Country). Jobright
   * writes Oracle's country first (prefillCountryBeforeRules). A held write is neither written nor given a row: its
   * field stays pending and a later pass plans it again and writes it after its parent (parentsFirst). Never held: an
   * answer that came in from the AI; a dependent whose parent awaits the AI (pending fields keep the AI's poll from
   * blocking, so a hold there would spend passes while the AI thinks), or whose list shows a busy sign while it holds
   * options (no bound but the passes'). Keys only.
   */
  private heldDependents(scanned: ScanResult, rows: ReadonlyMap<FieldKey, FillResult>, writes: readonly PlannedWrite[],
    arrived: ReadonlyMap<FieldKey, unknown>): Set<FieldKey> {
    const held = new Set<FieldKey>();
    const parents = dependenciesOf(scanned, this.env.adapter);
    if (parents.size === 0) return held;
    const keyOf = new Map(scanned.fields.map((field) => [field.baseKey, field.key] as const));
    const waits = (parent: BaseKey): boolean => {
      const key = keyOf.get(parent);
      if (key === undefined) return false;
      if (held.has(key)) return true;
      const row = rows.get(key);
      if (row !== undefined) return row.reason === 'waiting-for-options';
      const tracked = this.state.fields.get(parent);
      return tracked !== undefined && tracked.key === key && tracked.status === 'waiting-options';
    };
    const candidates = writes.filter((write) => !arrived.has(write.key));
    for (let grew = true; grew;) {
      grew = false;
      for (const write of candidates) {
        const parent = parents.get(baseKeyOf(write.key));
        if (held.has(write.key) || parent === undefined || !waits(parent)) continue;
        held.add(write.key);
        grew = true;
      }
    }
    return held;
  }
  // ── end jr6 ENGINE E3 ──

  /** The core pass of 2026-11-06: the files written whose upload the page shows done and whose input it has taken out
   *  of the page (Greenhouse: fixtures/greenhouse/axle-attached.html), by base key (ScanInput.uploaded). */
  private uploadsTaken(): Set<BaseKey> {
    const taken = new Set<BaseKey>();
    for (const [baseKey, entry] of this.written) {
      if (entry.value.kind === 'file' && entry.inputLeft?.() === true && entry.uploadNow?.() === 'confirmed') {
        taken.add(baseKey);
      }
    }
    return taken;
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
    // What the LLM's answers brought since the last pass, for fields still under the key they were asked by and still
    // waiting (not one the person has since touched, which is theirs).
    const arrived = new Map([...this.arrived].filter(([key]) => fields.has(key)
      && this.state.fields.get(baseKeyOf(key))?.status === 'awaiting-llm'));
    this.arrived = new Map();
    const order = orderPending(this.state, [...pending, ...arrived.keys()]).filter((key) => fields.has(key)
      && !this.skipped.has(baseKeyOf(key)));
    const holding = new Set(env.dryRun ? [] : order.filter((key) => !arrived.has(key)
      && loadingWithOptions(current, fields.get(key)!)));
    const asked = order.filter((key) => !holding.has(key) && !arrived.has(key));
    // v5 p2-stream: a pass that only writes answers that came in is not counted against the pass caps.
    const arrivalOnly = asked.length === 0 && holding.size === 0 && arrived.size > 0;
    const rows = new Map<FieldKey, FillResult>();
    let writes: PlannedWrite[] = [];
    let awaiting: FieldKey[] = [];
    if (asked.length > 0) {
      // The whole scan goes as context; only the asked keys are planned (LC-2), and only their answers are taken.
      const plan = await env.plan(current.fields.map(toFieldSpec), asked, this.state.pass, this.revealed());
      this.alive();
      this.persistable = plan.persistableCanaries;
      const wanted = new Set<string>(asked);
      // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      for (const row of plan.results as unknown as FillResult[]) if (wanted.has(row.key)) rows.set(row.key, row);
      writes = (plan.writes as unknown as PlannedWrite[]).filter((write) => wanted.has(write.key));
      awaiting = (plan.awaiting as FieldKey[]).filter((key) => wanted.has(key));
    }
    for (const [key, entry] of arrived) {
      // Profile-only since it came in (an attestation this pass's plan found): no AI write is written.
      const dropped = env.aiOff?.() === true && aiWrite(entry);
      rows.set(key, dropped ? aiOffRow(entry.row) : entry.row);
      if (!dropped && entry.write !== undefined) writes.push(entry.write);
    }
    // A field the person skipped on an earlier attempt of this step keeps its skipped-by-you row (LoopCarry.skipped);
    // it is never planned again.
    for (const field of current.fields) {
      const row = this.skipped.get(field.baseKey);
      if (row === undefined || row === null || this.state.fields.get(field.baseKey)?.row?.reason === 'skipped-by-you') {
        continue;
      }
      rows.set(field.key, { ...row, key: field.key });
    }
    // A field that begins to wait means a task was asked for: the wait's cap runs from now.
    if (awaiting.length > 0) this.aiProgressAt = monotonicNow();
    this.waitingNow = [...awaiting, ...holding];
    if (env.dryRun) {
      if (awaiting.length > 0 && env.poll !== undefined) await this.dryRunAnswers(current, rows, awaiting);
      for (const [key, row] of rows) rows.set(key, settleRow(row, { kind: 'dry-run' }));
      this.state = recordRows(this.state, rows.values(), { awaiting: env.poll === undefined ? awaiting
        : awaitingKeys(this.state) });
      return { kind: 'dry-run', rows: [...rows.values()] };
    }
    // jr6 line W review (REVC-7): a dependent whose parent is written in a later pass waits for it (heldDependents):
    // no row, no write, still pending; the books hear of it, so the next scan is no stall.
    const heldBack = this.heldDependents(current, rows, writes, arrived);
    if (heldBack.size > 0) {
      for (const key of heldBack) rows.delete(key);
      this.state = holdBack(this.state, heldBack);
      this.waitingNow = [...this.waitingNow, ...heldBack];
    }

    const done: WrittenField[] = [];
    const writtenAt = new Map<BaseKey, number>();
    // v5 p2-fill review (L1): the scan the writes find their fields in, read again after a résumé's parse.
    let scanned = current;
    // jr6 ENGINE E3 (FIXPLAN §6.2 item 14): a field others depend on (Adapter.dependsOn) is written before them.
    const queued = parentsFirst(this.queue(order, rows, writes, fields), current, env.adapter);
    const left = queued.map((entry) => entry.write.key);
    this.progress(rows, left, null);
    for (const [at, { write, planned, keep }] of queued.entries()) {
      if (env.signal.aborted || !env.valid()) throw new RunAborted();
      if (env.stopped()) {
        rows.set(write.key, settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }));
        continue;
      }
      this.progress(rows, left.slice(at), write.key);
      const field = fields.get(write.key)!;
      // An AI draft the run holds back until the person confirms it (LoopEnv.holdDraft) is not written.
      const held = env.holdDraft?.(write, planned) ?? null;
      if (held !== null) {
        rows.set(write.key, held);
        continue;
      }
      // What the page put in a field before our first write (a resume parse, browser autofill) is reconciled.
      const prefill = keep === undefined ? this.prefillOf(field, write, planned) : null;
      if (prefill !== null && !prefill.write) {
        rows.set(write.key, prefill.row);
        continue;
      }
      const result = await this.writeSkippable(scanned, field, write, prefill?.row ?? planned, keep);
      rows.set(write.key, result.row);
      if (result.written === undefined || result.readBack === undefined) continue;
      done.push(result.written);
      writtenAt.set(result.written.field.baseKey, monotonicNow());
      await this.recordWritten(result.written, result.readBack, planned);
      // v5 p2-fill review (L1): the page's résumé parse changed the form: it is read again before the other writes, so
      // what the parse put in is reconciled (prefillOf) and an overwrite of it flagged, as on a later pass.
      if (result.reread === true) {
        scanned = this.scanNow();
        for (const fresh of scanned.fields) fields.set(fresh.key, fresh);
      }
    }
    this.progress(rows, [], null);
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
    // A field this pass wrote anyway (a choice's free text typed into it) no longer waits for the LLM: its answer
    // would only overwrite the row of our write.
    const waiting = awaiting.filter((key) => rows.get(key)?.wrote !== true);
    this.state = recordRows(this.state, rows.values(), { awaiting: waiting,
      locked: lockedIn(fresh, rows, (baseKey) => this.lockedFrom.has(baseKey)) });
    if (arrivalOnly) this.state = noteArrivalPass(this.state);
    this.settleFollowUps(rows);
    if (settled !== null && !settled.settled) {
      const busy = busySigns(env.root, env.adapter);
      this.busy = busy;
      log('content.page-busy', Object.fromEntries(BUSY_SIGNS.map((sign) => [sign, busy.includes(sign)])));
      return { kind: 'busy', scan: fresh };
    }
    if (env.stopped()) return { kind: 'stopped', scan: fresh };
    const read = await this.readWidgets(fresh);
    if (env.stopped()) return { kind: 'stopped', scan: read ? this.scanNow() : fresh };
    const waited = await this.awaitLists(fresh, holding, writtenAt);
    // The lists' waits are over; the AI's are in the books (awaitingKeys) now.
    this.waitingNow = [];
    this.progress(new Map(), [], null);
    const after = waited || read ? this.scanNow() : fresh;
    // jr7 ENGINE-7 E2 item 1 (ADP7-2): then the fields the page holds disabled or read-only.
    return { kind: 'next', scan: await this.awaitWritable(after) ? this.scanNow() : after };
  }

  // ── jr7 ENGINE-7 E2 item 1 (FIX7PLAN §6.2, ADP7-2) ──
  /** When each held field's wait began (monotonicNow), by base key: one bound for the loop, however often the page
   *  locks it again. */
  private readonly lockedFrom = new Map<BaseKey, number>();

  /**
   * Waits on the page while required, empty fields are held disabled or read-only (the books' 'waiting-writable'):
   * until one of them is writable (the next scan plans it again, ScanInput.writable), the person stops the run, or each
   * has waited WRITABLE_WAIT_MS from the end of the pass that first found it held; those past the bound are flagged
   * (recordWritableWait: disabled-or-readonly, for the person). It reads the page at each change of a locking attribute
   * and every WRITABLE_POLL_MS. Answers whether it waited (then the next pass scans again). Never writes.
   */
  private async awaitWritable(after: ScanResult): Promise<boolean> {
    const { env } = this;
    const held = [...this.state.fields.values()].filter((tracked) => tracked.present
      && tracked.status === 'waiting-writable');
    if (held.length === 0) return false;
    const now = monotonicNow();
    for (const tracked of held) if (!this.lockedFrom.has(tracked.baseKey)) this.lockedFrom.set(tracked.baseKey, now);
    const left = (tracked: TrackedField) => WRITABLE_WAIT_MS - (monotonicNow() - this.lockedFrom.get(tracked.baseKey)!);
    const letIn = (scanned: ScanResult) => held.some((tracked) => {
      const field = scanned.fields.find((candidate) => candidate.baseKey === tracked.baseKey);
      return field !== undefined && writableField(field);
    });
    const stop = env.stopSignal === undefined ? env.signal : AbortSignal.any([env.signal, env.stopSignal]);
    const view = env.root.ownerDocument.defaultView;
    let scanned = after;
    let waited = false;
    while (!letIn(scanned) && !stop.aborted) {
      const longest = Math.max(...held.map(left));
      if (longest <= 0) break;
      waited = true;
      const changed = new AbortController();
      const watch = view === null ? null : new view.MutationObserver(() => changed.abort());
      watch?.observe(env.root, { subtree: true, attributeFilter: LOCK_ATTRIBUTES });
      try {
        await deadline(Math.min(longest, WRITABLE_POLL_MS), AbortSignal.any([stop, changed.signal]));
      } finally {
        watch?.disconnect();
      }
      this.alive();
      if (env.stopped()) return waited;
      scanned = this.scanNow();
    }
    if (stop.aborted || letIn(scanned)) return waited;
    for (const tracked of held) if (left(tracked) <= 0) this.state = recordWritableWait(this.state, tracked.key);
    return waited;
  }
  // ── end jr7 ENGINE-7 E2 item 1 ──

  /**
   * One write, which the person's Skip may give up (v3 Phase 3, CurrentWrite): the write sees a signal its Skip aborts
   * and a stop its Skip turns on, so its waits (a resume on its way, a list's options, an AI pick, an upload) end at
   * once and it writes nothing more. A write that had touched the page stands (pass.ts: written, read back after the
   * settle, seen by the final Guard); one given up is flagged skipped-by-you. Either way the field is never planned or
   * written again on this step, in this attempt or a later one (LoopCarry.skipped). The run's own abort still ends the
   * run.
   */
  private async writeSkippable(current: ScanResult, field: ScannedField, write: PlannedWrite, planned: FillResult,
    keep: FillResult | undefined): Promise<WriteResult> {
    const { env } = this;
    const options = { ...(keep === undefined ? {} : { keep }), widgets: this.widgetWrites() };
    const slot = env.writing;
    if (slot === undefined) return writeField(env, current, field, write, planned, this.held, options);
    const skip = slot.begin(write.key);
    // The run's own env underneath, its getters (the form root, the canaries) read at each use.
    const skippable: PassEnv = Object.create(env, {
      signal: { value: AbortSignal.any([env.signal, skip]) },
      runSignal: { value: env.signal },
      stopped: { value: () => env.stopped() || skip.aborted },
    }) as PassEnv;
    const skipped = (): WriteResult => {
      const row = settleRow(planned, { kind: 'not-written', reason: 'skipped-by-you' });
      this.skipped.set(field.baseKey, row);
      log('content.field-skipped', { wrote: false });
      return { row };
    };
    try {
      const result = await writeField(skippable, current, field, write, planned, this.held, options);
      if (skip.aborted && result.written !== undefined) {
        // Touched before the Skip came: the write stands, and is never made again.
        this.skipped.set(field.baseKey, null);
        log('content.field-skipped', { wrote: true });
        return result;
      }
      // A Guard's block stays as it is: Skip never stands in for a guard's word.
      return skip.aborted && result.written === undefined && result.row.status !== 'blocked' && !env.stopped()
        ? skipped() : result;
    } catch (failure) {
      if (failure instanceof RunAborted && skip.aborted && !env.signal.aborted && env.valid()) return skipped();
      throw failure;
    } finally {
      slot.end();
    }
  }

  /** Tells the run how far the pass is (LoopEnv.progress): the rows known now, those of this pass over the books', in
   *  DOM order; still to come, the pass's writes, the fields waiting for the AI (asked this pass, in the books, or
   *  arrived and written next pass) and those waiting for their list's options. */
  private progress(rows: ReadonlyMap<FieldKey, FillResult>, writes: readonly FieldKey[], current: FieldKey | null): void {
    const tell = this.env.progress;
    if (tell === undefined) return;
    const pending = [...new Set([...writes, ...this.waitingNow, ...awaitingKeys(this.state), ...this.arrived.keys()])];
    const known = new Map<BaseKey, { order: number; row: FillResult }>();
    for (const field of this.state.fields.values()) {
      if (field.present && field.row !== null) known.set(field.baseKey, { order: field.domOrder, row: field.row });
    }
    for (const [key, row] of rows) {
      const baseKey = baseKeyOf(key);
      known.set(baseKey, { order: this.state.fields.get(baseKey)?.domOrder ?? Number.MAX_SAFE_INTEGER, row });
    }
    try {
      tell([...known.values()].sort((a, b) => a.order - b.order).map((entry) => entry.row), pending, current);
    } catch {
      // The progress is the panel's: a failure there never stops a fill.
    }
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
      if (row === undefined || !mayWrite(this.state, key) || this.skipped.has(baseKeyOf(key))) continue;
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
    // A block's "I currently work here" is ticked before its end date (planCurrentJob's order, Phase 5); a page whose
    // failed upload takes the form down gets its files last (Adapter.quirks.filesLast); s2 lists: a phone's country is
    // chosen before its number is typed (phone-order.ts); jr6 RULES item 44 (ICIMS-15, applied at the forms merge): a
    // signature box is ticked last, after the form's other answers (core/plan/order.ts signatureLast).
    const ordered = signatureLast(phoneCountryFirst(boxBeforeEndDate(queue)));
    // v5 p2-fill: a page that parses the résumé gets it first (core/plan/order.ts), its parse awaited (content/pass.ts).
    if (this.env.adapter.quirks?.resumeParse === true) return resumeFirst(ordered);
    return this.env.adapter.quirks?.filesLast ? filesAfterTheRest(ordered) : ordered;
  }

  /**
   * A text or date write over what the page put in the field before our first write on the step (Phase 5;
   * core/steps/prefill.ts reconcilePrefill): the profile's value replaces a structured answer, flagged
   * prefill-conflict; prose (a textarea, a free-text question, a job's description) is kept, flagged prefill-kept; the
   * same answer written another way (a date by its numbers, a phone by its digits) is kept, already-correct. Choices,
   * boxes, sets and uploads are reconciled by the planner itself (core/plan/frame.ts), and so is any field we wrote.
   * Null: nothing to reconcile.
   */
  private prefillOf(field: ScannedField, write: PlannedWrite, planned: FillResult): { write: boolean; row: FillResult }
    | null {
    if (this.written.has(field.baseKey) || field.current.kind !== 'text' || field.current.text.trim() === '') return null;
    const intent: PrefillIntent | null = write.value.kind === 'text' ? { kind: 'text', text: write.value.text }
      : write.value.kind === 'date' ? { kind: 'date', iso: write.value.iso } : null;
    if (intent === null) return null;
    const decision = reconcilePrefill({ category: planned.category, kind: field.kind }, field.current, intent);
    if (decision.action === 'keep') {
      return { write: false, row: { ...planned, status: decision.flagged ? 'flagged' : 'skipped', reason: decision.reason,
        provenance: null, wrote: false, verification: 'not-applicable', needsUserAction: decision.flagged } };
    }
    if (decision.action === 'overwrite') {
      return { write: true, row: { ...planned, status: planned.status === 'blocked' ? 'blocked' : 'flagged',
        reason: decision.reason, needsUserAction: true } };
    }
    return null;
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

  /** This run's reveal edges on the step ([parent, child] base keys: the writer whose write revealed the child), as
   *  plan/request carries them for a draft's context (E2). Keys only. */
  private revealed(): Array<[BaseKey, BaseKey]> {
    return this.state.edges.filter((edge) => edge.kind === 'revealed').map((edge) => [edge.parent, edge.child]);
  }

  // ── Widgets (Phase 4) ─────────────────────────────────────────────────────────────────────────────────────────────

  /** What a widget's write needs: the run's readings, and plan/request for a typeahead's results, at this pass. */
  private widgetWrites(): WidgetWriteEnv {
    const plan = this.env.planSome ?? this.env.plan;
    return { readings: this.readings, readiness: this.readiness, bridge: this.bridge,
      plan: (specs, planKeys) => plan(specs, planKeys, this.state.pass),
      ...(this.env.learn === undefined ? {} : { learn: this.env.learn }) };
  }

  /**
   * The waiting path: each lazy widget the planner needs the options of (a row waiting-for-options) is opened, read
   * whole and closed, in DOM order, and what it showed is kept as its reading, so the next scan gives the field real
   * options (a first read is no change of options to the books) and the next pass plans it. One read as a remote search
   * is planned as one. One that ignores our activation is flagged needs-your-click, one that shows no list
   * widget-unsupported, and one whose list stays empty options-never-loaded. Cancel ends it between widgets. Answers
   * whether any widget was read (then the next pass scans again).
   */
  private async readWidgets(fresh: ScanResult): Promise<boolean> {
    const { env } = this;
    const waiting = [...this.state.fields.values()].filter((tracked) => tracked.present
      && tracked.status === 'waiting-options').sort((a, b) => a.domOrder - b.domOrder);
    let read = false;
    const rows: FillResult[] = [];
    for (const tracked of waiting) {
      if (env.stopped()) break;
      const target = fresh.target(tracked.key);
      if (target === null || target.widget === undefined || target.field.options !== 'lazy') continue;
      const result = await readWidget(target, { adapter: env.adapter, root: env.root, signal: env.signal,
        readings: this.readings, readiness: this.readiness, ...(env.learn === undefined ? {} : { learn: env.learn }) });
      this.alive();
      if (result.status === 'aborted') break;
      // Read, or replaced while the run waited for the page to be ready: the next scan sees it either way.
      if (result.status === 'read' || result.status === 'gone') {
        read = true;
        continue;
      }
      if (result.reason === 'options-never-loaded') {
        this.state = recordOptionsWait(this.state, tracked.key, 'never-loaded');
      } else if (tracked.row !== null) {
        rows.push(settleRow(tracked.row, { kind: 'not-written', reason: result.reason }));
      }
    }
    if (rows.length > 0) this.state = recordRows(this.state, rows);
    return read;
  }

  // ── The LLM's answers (Phase 4) ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Polls the fields waiting for the LLM (plan/poll): the rows and writes of those whose answers are in wait for the
   * next pass (arrived), and those the worker no longer knows (it restarted) are pending again, so the next pass sends
   * them in plan/request. With `block` the poll repeats every AI_POLL_MS until something comes, the person stops the
   * run, or AI_WAIT_CAP_MS pass with no progress: then what still waits is left blank and flagged, llm-unavailable, and
   * so is everything when the worker could not answer. Answers the keys put back to pending.
   */
  private async pollAwaiting(block: boolean): Promise<FieldKey[]> {
    const { env } = this;
    const pollMs = env.ai?.pollMs ?? AI_POLL_MS;
    const aiCapMs = env.ai?.capMs ?? AI_WAIT_CAP_MS;
    // A cover letter's wait is longer (Phase G): while one waits, the cap is its own.
    const capMs = () => (awaitingKeys(this.state).some((key) => waitsForLetter(this.state.fields.get(baseKeyOf(key))))
      ? Math.max(aiCapMs, env.ai?.letterCapMs ?? LETTER_WAIT_CAP_MS) : aiCapMs);
    this.aiProgressAt ??= monotonicNow();
    const started = monotonicNow();
    // v5 p2-stream: the waits plan/ready ended early, and whether it rang (read afresh at each ask).
    let woken = 0;
    const rang = (): boolean => env.wake?.pending === true;
    /** The field whose Skip the wait takes (the audit of 2026-11-06, m5): one slot across the whole wait, the poll's
     *  requests included, so a Skip the person sends while a poll is out is never lost. It moves only when the wait
     *  moves on to another field. */
    let held: { key: FieldKey; skip: AbortSignal } | null = null;
    const hold = (key: FieldKey | null): AbortSignal | null => {
      if (held !== null && held.key === key) return held.skip;
      if (held !== null) env.writing?.end();
      held = key === null || env.writing === undefined ? null : { key, skip: env.writing.begin(key) };
      return held?.skip ?? null;
    };
    /** A Skip that came for the held field, given up (skipAwaiting) and the slot let go; answers whether one came. */
    const skippedNow = (): boolean => {
      if (held === null || !held.skip.aborted || env.stopped()) return false;
      const { key } = held;
      hold(null);
      this.skipAwaiting(key);
      return true;
    };
    try {
      for (;;) {
        // Profile-only now: nothing more is waited for, or written, of the AI's; a cover letter still is (Phase G).
        if (env.aiOff?.() === true) {
          this.dropAi();
          if (!awaitingKeys(this.state).some((key) => !this.arrived.has(key))) return [];
        }
        const keys = awaitingKeys(this.state).filter((key) => !this.arrived.has(key));
        if (keys.length === 0 || env.poll === undefined) return [];
        if (block) hold(keys[0] ?? null);
        this.aiPolls += 1;
        // v5 p2-stream: this poll reads everything in so far, so what rang before it is taken.
        env.wake?.take();
        const answer = await env.poll(keys);
        this.alive();
        if (answer === 'failed') {
          this.giveUp(keys, 'llm-unavailable', 'cover-letter-unavailable');
          // A Skip sent meanwhile still says the person's word on that one field.
          skippedNow();
          return [];
        }
        const asked = new Set<string>(keys);
        let forgotten: FieldKey[] = keys;
        if (answer !== 'expired') {
          // The answer's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
          const writes = new Map((answer.writes as unknown as PlannedWrite[]).map((write) => [write.key, write] as const));
          const still = new Set<string>(answer.awaiting);
          let asksAgain = false;
          for (const row of answer.results as unknown as FillResult[]) {
            if (!asked.has(row.key)) continue;
            // A key still waiting that comes with a row was planned again and asked anew (a classification in, then
            // its answer asked): a task finished, so the wait made progress (the Phase E review, M6).
            if (still.has(row.key)) {
              // The P2 review (H1's backstop): asked anew past MAX_AI_REASKS, the field is given up, flagged.
              const times = (this.reasked.get(row.key as FieldKey) ?? 0) + 1;
              this.reasked.set(row.key as FieldKey, times);
              if (times > MAX_AI_REASKS) {
                this.giveUp([row.key as FieldKey], 'llm-unavailable');
                log('content.ai-reask-limit');
                continue;
              }
              asksAgain = true;
              continue;
            }
            const write = writes.get(row.key);
            this.arrived.set(row.key, write === undefined ? { row } : { row, write });
          }
          forgotten = keys.filter((key) => !still.has(key) && !this.arrived.has(key));
          if (this.arrived.size > 0 || asksAgain) this.aiProgressAt = monotonicNow();
        }
        const requeue = requeueAwaiting(this.state, forgotten);
        this.state = requeue.state;
        // A Skip sent while the poll was out (m5): that field's answer, arrived or not, is never used.
        if (skippedNow()) continue;
        // The field the wait is on, while nothing else is left to do (v3 Phase 3 review): the panels spin its row and,
        // after a while on it, offer its Skip, which gives up that one field's answer (skipAwaiting).
        const on = block ? awaitingKeys(this.state).find((key) => !this.arrived.has(key)) ?? null : null;
        // What came in shows at once: an answer arrived is still to be written, a field asked again still waits.
        this.progress(new Map(), [], on);
        if (!block || this.arrived.size > 0 || requeue.requeued.length > 0) return requeue.requeued;
        const left = capMs() - (monotonicNow() - this.aiProgressAt);
        if (left <= 0) {
          this.giveUp(awaitingKeys(this.state), 'llm-unavailable', 'cover-letter-timed-out');
          return [];
        }
        const skip = hold(on);
        // v5 p2-stream: an answer came in while the poll was out (plan/ready): poll again at once.
        if (rang()) {
          woken += 1;
          continue;
        }
        const stop = AbortSignal.any([env.signal, ...(env.stopSignal === undefined ? [] : [env.stopSignal]),
          ...(skip === null ? [] : [skip]), ...(env.wake === undefined ? [] : [env.wake.signal])]);
        const waited = await deadline(Math.min(pollMs, left), stop);
        this.alive();
        if (skippedNow()) continue;
        if (env.stopped()) return [];
        if (waited === 'aborted') {
          // v5 p2-stream: the worker's plan/ready ended the wait: poll now.
          if (rang()) {
            woken += 1;
            continue;
          }
          return [];
        }
      }
    } finally {
      hold(null);
      if (block) log('content.ai-waited', { polls: this.aiPolls, ms: Math.round(monotonicNow() - started), woken });
    }
  }

  /** The person's Skip of a field whose AI answer the run waits for (v3 Phase 3 review): its answer, when it comes, is
   *  never used; its row is flagged skipped-by-you, and it is never planned or written again on this step. */
  private skipAwaiting(key: FieldKey): void {
    this.giveUp([key], 'skipped-by-you');
    const entry = this.arrived.get(key);
    if (entry !== undefined) this.skipped.set(baseKeyOf(key), entry.row);
    log('content.field-skipped', { wrote: false, waiting: true });
  }

  /** The run fills from the profile only now (LoopEnv.aiOff): the fields still waiting for the LLM are given up, and an
   *  AI write that came in is dropped; each row says ai-off-for-posting (aiOffRow) and waits for the next pass. */
  private dropAi(): void {
    for (const key of awaitingKeys(this.state)) {
      if (this.arrived.has(key)) continue;
      const tracked = this.state.fields.get(baseKeyOf(key));
      if (tracked === undefined || tracked.key !== key || tracked.status !== 'awaiting-llm') continue;
      // A cover letter still comes (Phase G): the person's own is theirs to attach; the AI's is dropped as it arrives.
      if (waitsForLetter(tracked)) continue;
      this.arrived.set(key, { row: tracked.row === null ? unplannedRow(tracked, 'ai-off-for-posting')
        : aiOffRow(tracked.row, key) });
    }
    for (const [key, entry] of this.arrived) {
      if (aiWrite(entry)) this.arrived.set(key, { row: aiOffRow(entry.row) });
    }
  }

  /** Fields still waiting for the LLM that it will not answer now: their rows, flagged with `reason` (a cover-letter
   *  upload's with `letterReason`, Phase G), wait for the next pass, with nothing to write. */
  private giveUp(keys: readonly FieldKey[], reason: ReasonCode, letterReason: ReasonCode = reason): void {
    for (const key of keys) {
      const tracked = this.state.fields.get(baseKeyOf(key));
      if (tracked === undefined || tracked.key !== key || tracked.status !== 'awaiting-llm') continue;
      const why = waitsForLetter(tracked) ? letterReason : reason;
      this.arrived.set(key, { row: tracked.row === null ? unplannedRow(tracked, why)
        : unresolvedRow(tracked.row, why, key) });
    }
  }

  /**
   * A dry run's one pass, when some of its fields wait for the LLM: it waits for their answers (they are rows only: a
   * dry run gets no write), and a field the worker forgot is asked again, at most DRY_RUN_ASKS times. The rows go into
   * `rows`.
   */
  private async dryRunAnswers(current: ScanResult, rows: Map<FieldKey, FillResult>, awaiting: readonly FieldKey[]):
    Promise<void> {
    this.state = recordRows(this.state, rows.values(), { awaiting });
    for (let asks = 0; awaitingKeys(this.state).length > 0 && !this.env.stopped();) {
      const requeued = await this.pollAwaiting(true);
      const answered = [...this.arrived.values()].map((entry) => entry.row);
      this.arrived = new Map();
      for (const row of answered) rows.set(row.key, row);
      this.state = recordRows(this.state, answered);
      if (requeued.length === 0) continue;
      if (asks >= DRY_RUN_ASKS) {
        const left = requeued.flatMap((key) => {
          const row = rows.get(key);
          return row === undefined ? [] : [unresolvedRow(row, 'llm-unavailable', key)];
        });
        for (const row of left) rows.set(row.key, row);
        this.state = recordRows(this.state, left);
        continue;
      }
      asks += 1;
      const plan = await this.env.plan(current.fields.map(toFieldSpec), requeued, this.state.pass, this.revealed());
      this.alive();
      const wanted = new Set<string>(requeued);
      const again = (plan.results as unknown as FillResult[]).filter((row) => wanted.has(row.key));
      for (const row of again) rows.set(row.key, row);
      this.state = recordRows(this.state, again, { awaiting: (plan.awaiting as FieldKey[]).filter((key) => wanted.has(key)) });
    }
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
    const passes = this.passesBefore + this.passes;
    return { rows: loopRows(this.state, verdict), scan: last, written, passes, end, cut: this.cutBy,
      revealEdges: revealEdgesOf(this.state), persistableCanaries: this.persistable, busy: this.busy,
      carry: this.carryOut(passes) };
  }

  /** What the step's next attempt in this run starts from: the fields written or taken over, and what was written. */
  private carryOut(passes: number): LoopCarry {
    const fields = carriedFields(this.state);
    const kept = new Set(fields.map((tracked) => tracked.baseKey));
    return { fields, passes,
      written: new Map([...this.written].filter(([baseKey]) => kept.has(baseKey))),
      lastWriteAt: new Map([...this.lastWriteAt].filter(([baseKey]) => kept.has(baseKey))),
      skipped: new Map(this.skipped) };
  }

  /** A dry run's one pass: the plan's rows, as the fill would leave them, and nothing written. */
  private dryRunResult(last: ScanResult, rows: FillResult[]): LoopResult {
    return { rows, scan: last, written: [], passes: this.passes, end: 'dry-run', cut: null, revealEdges: [],
      persistableCanaries: this.persistable, busy: null,
      carry: { fields: [], written: new Map(), lastWriteAt: new Map(), passes: 0 } };
  }
}
