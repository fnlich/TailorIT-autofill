/*
 * One planned write (docs/design/runtime.md §8.3; docs/ARCHITECTURE.md "Orchestrator"). The reactive loop (loop.ts)
 * scans, plans and orders a pass's writes, and hands each one here, in that order:
 * 1. a pause the page shows anywhere in the document, or another step showing, refuses it (PassEnv.heldBy, detectPause
 *    document-wide: the Phase 5 review, X-S1); the DOM half of the Guard re-finds the field by key in a fresh scan (never a cached node) and
 *    checks it may be written now (domGuardBeforeWrite); a follow-up box that holds other text on that scan keeps it
 *    (WriteOptions.keep, the Phase 3 review, L-S7);
 * 2. the core's frame-side Guard checks the write against the field as it is now: honeypot, the value fits, the
 *    options it names still read as planned at their places, the provenance's shape, an llm-pick's option unchanged,
 *    the canary scan over this frame's canaries, the mark-all cover test (guardWriteInFrame);
 * 3. a file write first receives the resume over the `resume` port (transfer.ts), or the run's cover letter (Phase G:
 *    the write's `ref`; a letter that could not be brought is cover-letter-unavailable, one the input refuses
 *    format-unsupported), then is checked again, since the page had a moment to change, and is dropped as user-stopped
 *    if the person pressed Cancel meanwhile;
 * 4. fill() writes with untrusted events and reads back at once; what the field then holds (readBack, values.ts) is
 *    what the loop hashes for its flip count. v5 p2-fill: a rich-text box takes the browser's own insert
 *    (fillers/text.ts fillEditable); a résumé control that opens the page's own picker (FieldTarget.picker) takes its
 *    file through that picker, armed for one press (fillers/picker.ts); the page's alert and confirm are held through
 *    the write's own events and an upload's wait (fillers/dialogs.ts: only dialogs no action of the person's brought,
 *    counted); and where the page parses the résumé (Adapter.quirks.resumeParse; the loop writes it first:
 *    core/plan/order.ts) its parse is waited for before the next write (dom/resume-parse.ts). An ARIA widget is
 *    written by the widget helpers instead (Phase 4, dom/widgets): its option chosen, its missing options added, its member pressed, or, for a remote typeahead, each
 *    query a guarded write of its own and each result list matched by the worker (searchField). A widget's options in
 *    the scan may be the run's kept reading of a closed list, so the write's origin goes to the widget filler, which
 *    checks an llm-pick again on what the list shows right before its click (the Phase 4 review, R1). A long list its
 *    own text box filters (dom/widgets' searchesList: Greenhouse's phone country) has a profile option searched for by
 *    the option's words instead, that one query guarded as a typeahead's are (searchOption). React first
 *    (docs/SPEC-AMENDMENTS.md §12): a combobox its adapter declares for the page-world bridge has its option chosen
 *    by its own React code before either (dom/widgets' chooseThroughBridge: the write's one command), and the search
 *    and the events follow only when nothing the frame can see changed; after a choice the bridge said it made, the
 *    list is not searched, and the events' path never ends as "nothing written". jr6 ENGINE E3 (FIXPLAN §6.2 item 13):
 *    a box of several answers its adapter declares (WidgetDecl.tags) takes its planned text value by value, each
 *    missing from its chips a guarded write of its own (writeTags, dom/widgets' fillTags), and is read back by its
 *    chips;
 * 5. the planner's row is settled from what happened (settleRow).
 * The person's Skip of the write (v3 Phase 3: PassEnv.runSignal) ends its waits. A write that has not touched the page
 * yet throws RunAborted, and the loop flags the field skipped-by-you; once the page was touched (a file put into its
 * input, an option clicked, a query typed and then a result chosen) Skip only ends the wait, and the write's result
 * stands: written, read back after the settle, and seen by the final Guard (an upload not confirmed yet is
 * upload-not-confirmed). What a widget write opened or typed and did not keep is put back (dom/widgets).
 * A refused write leaves its field untouched, with the guard's reason: blocked for what the Guard forbids (not
 * visible, no visible label, a canary, its provenance, its own UI), flagged for what could not be done (gone, options
 * changed, disabled, an auth field on the step, the site ignored our events). A dry run gets no writes from the
 * worker, and writes nothing. The verification after the pass's settle (verify.ts) has the last word on every written
 * field.
 */
import type { Adapter, UploadState } from '../adapters/types';
import type { Platform } from '../core/enums';
import { guardWriteInFrame } from '../core/guard/write';
import { settleRow, type FillOutcome } from '../core/plan/settle';
import { capCodePoints } from '../core/text/fold';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { FieldCategory, ValueOrigin, WriteValue } from '../core/types/intent';
import { optionQuery } from '../core/matcher/listSearch';
import { NO_MATCH_OTHER_QUERY } from '../core/matcher/searchLimits';
import { accepts, acceptTokens, fill } from '../dom/fillers';
import { fillDateParts } from '../dom/fillers/date-parts';
import { mismatch } from '../dom/fillers/outcome';
import { awaitUpload, revealUpload, uploadStateOf } from '../dom/fillers/upload';
import { selectEditable } from '../dom/fillers/text';
import { isEditingHost } from '../dom/kinds';
import type { HeldDialogs } from '../dom/patch-protocol';
import { withDialogsHeld, withDialogsHeldWhile } from '../dom/fillers/dialogs';
import { fillThroughPicker, type PickerResult } from '../dom/fillers/picker';
import { awaitResumeParse } from '../dom/resume-parse';
import { isOptionList, optionsState } from '../dom/await-options';
import { holdsComposed } from '../dom/composed';
import { windowOf } from '../dom/fillers/events';
import { quietWait } from '../dom/settle';
import { widgetListOf } from '../dom/widgets/aria';
import { widgetBusy } from '../dom/widgets/options';
import { log } from '../shared/log';
import { sameOptionLabel } from '../dom/fillers/verify';
import { domGuardBeforeWrite, type PlannedField } from '../dom/guard';
import { hashOfOptions } from '../dom/option-hash';
import { toFieldSpec } from '../dom/scan';
import {
  DEPENDENT_QUIET_MS, DEPENDENT_WAIT_CAP_MS, SEARCH_FIELD_BUDGET_MS, TEXT_CAP_LABEL,
} from '../dom/thresholds';
import { monotonicNow } from '../dom/time';
import type {
  FieldTarget, FillOutcome as DomFillOutcome, ReadBackRule, ScannedField, ScanResult, WidgetOptionRead, WidgetReading,
} from '../dom/types';
import { readBackTextOf } from '../dom/values';
import { visiblePlaceholder } from '../dom/visible-text';
import {
  awaitPageReady, chooseThroughBridge, fillTags, fillWidget, isActionable, searchesList, searchForOption,
  searchTypeahead, widgetHolds,
  type BridgeRun, type LearnList, type TagsHooks, type TypeaheadHooks, type TypeaheadResult, type WidgetFillContext,
  type WidgetReadiness,
} from '../dom/widgets';
import type { ContentPlatform } from '../platform/types';
import type { AnswerData } from './channel';
import { pagePatchesSettled } from './page-patches';
import { receiveResume, type ReceivedResume, type ResumeFailure } from './transfer';
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
  /** The form root, read at each use: the run finds it again by the adapter's hook, so a form the page draws again
   *  (the whole form, its root included) is the new one. */
  root: Element;
  platform: Platform;
  frameId: number;
  dryRun: boolean;
  /** Every canary this frame holds in memory (tripwire.allCanaries, at most 1024, not only the 32 plan/request
   *  carries): every outgoing value is scanned for them before it is written (CORE-15). */
  canaries: readonly string[];
  signal: AbortSignal;
  /** While the person may Skip this write (v3 Phase 3, content/loop.ts CurrentWrite): the run's own signal, which only
   *  the run's end aborts; `signal` then aborts on the Skip too. */
  runSignal?: AbortSignal;
  /** Whether the platform still holds the extension, asked before every write (false tears the runtime down). */
  valid(): boolean;
  /** Whether the person stopped the run (run/cancel): nothing more is written. */
  stopped(): boolean;
  /** The run's id now, for the resume port. */
  runId(): string;
  /** Why no write may be made now, asked right before every write: a pause the page shows anywhere in the document
   *  (detectPause: a CAPTCHA, an email code by its type or its label, a sign-in or account box, a session dialog outside
   *  the form root: auth-required or challenge-present; the Phase 5 review, X-S1), or another step showing than the one
   *  being filled (field-disappeared). Null to go on. Without it only the DOM guard's own check of the form root
   *  counts. */
  heldBy?(): ReasonCode | null;
  /** v5 p2-fill review (security 4): told what a write's hold of the page's dialogs held back (counts only, never
   *  words), so the person sees it (content/orchestrator.ts). */
  dialogsHeld?(held: HeldDialogs): void;
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
  /** A native list's planned option, its label as the list showed it at the write (injected text and all), so a list
   *  whose options change during the settle is read back at that option's place in the list as it is then (LC-9);
   *  null for any other write. */
  optionShown: string | null;
  /** A file's upload as the page showed it after the write (Adapter.uploadState, fillers/upload.ts), and how to read it
   *  again; null for any other write, and for a page whose adapter reads no upload. */
  upload: UploadState | null;
  uploadNow: (() => UploadState | null) | null;
  /** The core pass of 2026-11-06: whether the file input written has left the page since (Greenhouse takes it out once
   *  a file is in it: fixtures/greenhouse/axle-attached.html); set only beside uploadNow. */
  inputLeft?: () => boolean;
  /** v5 p2-fill: what the page's own picker opened for a picker control's write (dom/fillers/picker.ts): a file input of
   *  its own, read back at the write, or its showOpenFilePicker, which leaves nothing to read back. */
  picked?: 'input' | 'file-system';
}

/** What a widget's write needs from its loop (Phase 4). */
export interface WidgetWriteEnv {
  /** The run's widget readings, by base key (ScanOptions.widgetReadings): a fresh read of a list replaces its field's. */
  readings: Map<BaseKey, WidgetReading>;
  /** plan/request for one field, with the whole pass's index: a remote typeahead's results go to the worker, which
   *  matches them. */
  plan(specs: FieldSpec[], planKeys: FieldKey[]): Promise<PlanAnswer>;
  /** The run's readiness for declared activations (dom/widgets' WidgetReadiness): only the run's first one the page
   *  does not answer waits for its script to attach. */
  readiness?: WidgetReadiness;
  /** The run's page-world bridge (dom/widgets' BridgeRun): off for the rest of the run once its word did not hold. */
  bridge?: BridgeRun;
  /** s2 lists: told of a learnable dropdown's complete whole read (dom/widgets' LearnList), for its host. */
  learn?: LearnList;
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
  /** v5 p2-fill review (L1): the page's résumé parse changed the form's values: the pass reads the form again before
   *  its other writes (content/loop.ts), so what the parse put in is reconciled and an overwrite of it flagged. */
  reread?: true;
}

/** DOM-guard refusals that mean the Guard forbids the write; the rest mean it could not be done. */
const GUARD_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'no-visible-label',
  'internal-error']);
/** Filler refusals that mean the write was not allowed; the rest mean it could not be done. A widget filler refuses an
 *  llm-pick whose option no longer reads as the LLM saw it, as the frame-side Guard does (the Phase 4 review, R1). */
const FILL_BLOCKS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['not-user-visible', 'internal-error',
  'llm-pick-rejected']);
/** The frame-side core Guard's refusals that mean the write could not be done: the options it names moved or changed
 *  since the plan, as the DOM guard and the fillers say it too. Every other refusal of it blocks. */
const FRAME_GUARD_FLAGS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['options-changed']);

/** A refusal of the frame-side core Guard, as settleRow takes it. */
function frameGuardRefusal(reason: ReasonCode): FillOutcome {
  return FRAME_GUARD_FLAGS.has(reason) ? { kind: 'not-written', reason } : { kind: 'blocked', reason };
}
/** Mismatch reasons a row keeps instead of settleRow's verify-mismatch. */
const MISMATCH_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['verify-mismatch', 'unexpected-selection',
  'value-rejected-by-site', 'disabled-or-readonly', 'upload-failed', 'upload-not-confirmed',
  // jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers that took its cap of chips before every value.
  'max-selections-reached']);

/** `work`'s answer, or null as soon as `signal` aborts (the answer, when it comes, is unused). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, (failure: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(failure);
    });
  });
}

/** The run itself ended (aborted, or the extension went away): never the person's Skip of one write. */
function runOver(env: PassEnv): boolean {
  return (env.runSignal ?? env.signal).aborted || !env.valid();
}

/** After a wait the run's end or the person's Skip may cut short (see the header): the run's end throws; a Skip throws
 *  too (the loop flags the field skipped-by-you) unless the write already touched the page, whose result stands. */
function afterWait(env: PassEnv, touched: boolean): void {
  if (runOver(env) || (env.signal.aborted && !touched)) throw new RunAborted();
}

/** A refusal before the write, as settleRow takes it. */
function refusal(reason: ReasonCode, blocks: ReadonlySet<ReasonCode>): FillOutcome {
  return blocks.has(reason) ? { kind: 'blocked', reason } : { kind: 'not-written', reason };
}

// ── behaviour review 2026-11-06 (M2): the owner's setting "Résumé already on the page" ──
/** The DOM guard's refusals that mean the field's file input is no longer one to put a file in. */
const NO_INPUT: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['element-not-found', 'disabled-or-readonly']);

/** A refusal of the DOM guard, said plainly for a résumé the page showed held (CurrentValue `held`) that the planner
 *  sent again (Upload mine again): the input gone or disabled by the write is the person's, resume-held-no-input. */
function guardRefusal(field: ScannedField, write: PlannedWrite, reason: ReasonCode): FillOutcome {
  const held = write.value.kind === 'file' && field.current.kind === 'files' && field.current.held === true;
  return refusal(held && NO_INPUT.has(reason) ? 'resume-held-no-input' : reason, GUARD_BLOCKS);
}
// ── end behaviour review (M2) ──

/** A written field that reads back differently, keeping the specific reason. */
export function mismatchRow(planned: FillResult, reason: ReasonCode): FillResult {
  const row = settleRow(planned, { kind: 'mismatch' });
  return MISMATCH_REASONS.has(reason) ? { ...row, reason } : row;
}

/** A file the page says it failed to upload, or never showed uploaded (Adapter.uploadState): written, never verified,
 *  and flagged for the person, since the page's own copy of it may be missing. */
export function uploadRow(planned: FillResult, state: 'failed' | 'pending'): FillResult {
  const row = mismatchRow(planned, state === 'failed' ? 'upload-failed' : 'upload-not-confirmed');
  return { ...row, status: row.status === 'blocked' ? 'blocked' : 'flagged', needsUserAction: true };
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

/** Why a cover letter could not be put into its field (Phase G), as its row says it: an input that refuses a PDF
 *  takes no letter (format-unsupported), and anything else is the letter that could not be brought. */
function letterFailure(reason: ResumeFailure): ReasonCode {
  return reason === 'resume-format-unsupported' || reason === 'pdf-only-input' ? 'format-unsupported'
    : 'cover-letter-unavailable';
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

// ── jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19, ADP-2): a write that resets other fields ──

/** The field of a scan that `el` is: its control, its widget's element, text box or opener, its proxy or a member;
 *  else the first field whose own elements hold it; null for none. */
function fieldOwning(scanned: ScanResult, el: Element): ScannedField | null {
  let holding: ScannedField | null = null;
  for (const field of scanned.fields) {
    const target = scanned.target(field.key);
    if (target === null) continue;
    const own = [target.control, target.widget?.element, target.widget?.input, target.widget?.opener, target.proxy,
      ...target.members].filter((part): part is Element => part !== null && part !== undefined);
    if (own.includes(el)) return field;
    if (holding === null && own.some((part) => holdsComposed(part, el))) holding = field;
  }
  return holding;
}

/**
 * Each field of a scan whose adapter names another field's control as the one whose write resets it
 * (Adapter.dependsOn: iCIMS's State under its Country and "Please specify" under its source list, ADP's State under
 * Country, Oracle's address block), child to parent by base key. A hook that throws, or names no field of the scan or
 * the field itself, names none. Keys only.
 */
export function dependenciesOf(scanned: ScanResult, adapter: Adapter): Map<BaseKey, BaseKey> {
  const parents = new Map<BaseKey, BaseKey>();
  if (adapter.dependsOn === undefined) return parents;
  for (const field of scanned.fields) {
    const target = scanned.target(field.key);
    if (target === null) continue;
    let named: Element | null = null;
    try {
      named = adapter.dependsOn(target.control) ?? null;
    } catch {
      named = null;
    }
    const parent = named === null ? null : fieldOwning(scanned, named);
    if (parent !== null && parent.baseKey !== field.baseKey) parents.set(field.baseKey, parent.baseKey);
  }
  return parents;
}

/**
 * A pass's writes with each parent before the fields it resets (dependenciesOf): a dependent the queue holds before its
 * parent is written right after it (its own dependents after it in turn); every other write keeps its place. Writes on
 * a cycle keep their order. Jobright writes the country first and reads its dependents again after it
 * (~contents/sites/icims fillCountry, ~contents/sites/adp-workforcenow runPreFillForm, Oracle's
 * prefillCountryBeforeRules).
 */
export function parentsFirst<T extends { write: PlannedWrite }>(queue: readonly T[], scanned: ScanResult,
  adapter: Adapter): T[] {
  const parents = dependenciesOf(scanned, adapter);
  if (parents.size === 0 || queue.length < 2) return [...queue];
  const baseOf = (entry: T): BaseKey | undefined => scanned.fields.find((field) => field.key === entry.write.key)?.baseKey;
  const queued = new Set(queue.map(baseOf).filter((base): base is BaseKey => base !== undefined));
  const out: T[] = [];
  const placed = new Set<BaseKey>();
  const waiting = new Map<BaseKey, T[]>();
  const place = (entry: T): void => {
    out.push(entry);
    const base = baseOf(entry);
    if (base === undefined) return;
    placed.add(base);
    const children = waiting.get(base) ?? [];
    waiting.delete(base);
    for (const child of children) place(child);
  };
  for (const entry of queue) {
    const base = baseOf(entry);
    const parent = base === undefined ? undefined : parents.get(base);
    if (parent !== undefined && queued.has(parent) && !placed.has(parent)) {
      waiting.set(parent, [...(waiting.get(parent) ?? []), entry]);
      continue;
    }
    place(entry);
  }
  // A cycle leaves its writes waiting: they keep their order.
  for (const entry of queue) if (!out.includes(entry)) out.push(entry);
  return out;
}

/** Whether a dependent shows its page still loading it: a widget's own busy signs (its declared ones beside its list
 *  included), or a native list's busy sign or loading option (awaitOptions' optionsState). */
function dependentBusy(target: FieldTarget): boolean {
  if (target.widget !== undefined) return widgetBusy(target.widget, widgetListOf(target.widget));
  if (!isOptionList(target.control)) return false;
  const state = optionsState(target.control, null);
  return !state.ready && (state.waiting === 'busy' || state.waiting === 'loading');
}

/**
 * After the write of a field others depend on (dependenciesOf): the page's answer awaited before the next write, so a
 * dependent is written into the list its parent's value brings, never into the old one the page is about to replace:
 * quiet windows of DEPENDENT_QUIET_MS on the form root until no dependent shows a busy sign, at most
 * DEPENDENT_WAIT_CAP_MS (Jobright waits up to 8 s for iCIMS's State list to settle, ~contents/sites/icims
 * waitForIcimsStateProvinceOptionsRefresh, and for Oracle's own address fill). Each window's end finds the dependents
 * again on a fresh scan (the page may draw them anew: ADP's State, a text box that becomes a list). The person's Skip
 * and the run's end cut it short: the parent's write stands. Nothing is read of any value.
 */
async function awaitDependents(env: PassEnv, last: ScanResult, parent: BaseKey): Promise<void> {
  if (env.adapter.dependsOn === undefined || env.signal.aborted) return;
  const children = (scanned: ScanResult) => [...dependenciesOf(scanned, env.adapter)]
    .filter(([, of]) => of === parent).map(([child]) => child);
  if (children(last.rescan()).length === 0) return;
  const busy = (): boolean => {
    const now = last.rescan();
    return children(now).some((child) => {
      const field = now.fields.find((candidate) => candidate.baseKey === child);
      const target = field === undefined ? null : now.target(field.key);
      return target !== null && dependentBusy(target);
    });
  };
  const wait = quietWait<boolean>({ view: windowOf(env.root), quietMs: DEPENDENT_QUIET_MS, capMs: DEPENDENT_WAIT_CAP_MS,
    signal: env.signal, aborted: false, atQuiet: () => (busy() ? null : true), atCap: () => false });
  wait.observe(env.root);
  await wait.done;
}

// ── end jr6 ENGINE E3 (item 14) ──

/**
 * Writes one planned value through both Guards: the row it ends with, and what was written. `last` is any earlier scan
 * of the form root (the guard scans afresh from it), `field` the field as the plan saw it, and `held` the run's
 * heldPlaceholders, which every scan of the run reads. jr6 ENGINE E3 (FIXPLAN §6.2 item 14): a write of a field others
 * depend on (Adapter.dependsOn) is followed by the page's answer to it (awaitDependents) before the next write.
 */
export async function writeField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, held: WeakMap<Element, string>, options: WriteOptions = {}): Promise<WriteResult> {
  const result = await writeOnce(env, last, field, write, planned, held, options);
  if (result.written !== undefined) await awaitDependents(env, last, result.written.field.baseKey);
  return result;
}

/** One planned value written through both Guards (writeField, before the wait for what it resets). */
async function writeOnce(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, held: WeakMap<Element, string>, options: WriteOptions = {}): Promise<WriteResult> {
  const wanted = plannedFieldOf(field);
  // Nothing is written while the page asks for the person (a CAPTCHA, a code or a sign-in anywhere in the document),
  // nor once another step shows.
  const hold = env.heldBy?.() ?? null;
  if (hold !== null) return { row: settleRow(planned, { kind: 'not-written', reason: hold }) };
  let verdict = domGuardBeforeWrite(last, wanted);
  if (!verdict.ok) return { row: settleRow(planned, guardRefusal(field, write, verdict.reason)) };
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
    // v5 p2-fill: a picker control has no input to read an accept list from: the page's own input is read at the press.
    const tokens = verdict.target.picker === true ? [] : acceptTokens(verdict.target.control as HTMLInputElement);
    const document = write.value.ref;
    const got = await receiveResume(env.content, { runId: env.runId(), accepts: (file) => accepts(tokens, file),
      signal: env.signal, ...env.resume, ...(document === 'cover-letter' ? { document } : {}) });
    if (env.signal.aborted || !env.valid()) {
      if (got.ok) got.resume.release();
      throw new RunAborted();
    }
    // The person may have pressed Cancel while the bytes were on their way (DOM-8): nothing more is written.
    if (env.stopped()) {
      if (got.ok) got.resume.release();
      return { row: settleRow(planned, { kind: 'not-written', reason: 'user-stopped' }) };
    }
    if (!got.ok) {
      const reason = document === 'cover-letter' ? letterFailure(got.reason) : got.reason;
      return { row: settleRow(planned, { kind: 'not-written', reason }) };
    }
    resume = got.resume;
    // The bytes took a moment, in which the page could change: the field is found and checked again.
    const heldSince = env.heldBy?.() ?? null;
    if (heldSince !== null) {
      resume.release();
      return { row: settleRow(planned, { kind: 'not-written', reason: heldSince }) };
    }
    verdict = domGuardBeforeWrite(last, wanted);
    if (!verdict.ok) {
      resume.release();
      return { row: settleRow(planned, guardRefusal(field, write, verdict.reason)) };
    }
    check = guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries);
    if (!check.ok) {
      resume.release();
      return { row: settleRow(planned, frameGuardRefusal(check.reason)) };
    }
    // jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): a file input its adapter shows only through a link (JazzHR's "Attach
    // resume"): the upload filler presses it once and waits for the input to show (dom/fillers/upload.ts revealUpload),
    // found again by the guard's fresh scan; the field is then checked again as it shows. An input that stays hidden
    // is the person's (needs-your-click), nothing written.
    if (verdict.target.picker !== true) {
      const revealed = await revealUpload(env.adapter, verdict.target.control as HTMLInputElement, () => {
        const again = domGuardBeforeWrite(last, wanted);
        return again.ok ? again.target.control as HTMLInputElement : null;
      }, env.signal);
      if (revealed.outcome === 'refused' || revealed.outcome === 'revealed') {
        if (runOver(env) || env.signal.aborted) resume.release();
        afterWait(env, false);
      }
      if (revealed.outcome === 'refused') {
        resume.release();
        return { row: settleRow(planned, { kind: 'not-written', reason: 'needs-your-click' }) };
      }
      if (revealed.outcome === 'revealed') {
        verdict = domGuardBeforeWrite(last, wanted);
        if (!verdict.ok) {
          resume.release();
          return { row: settleRow(planned, guardRefusal(field, write, verdict.reason)) };
        }
        check = guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries);
        if (!check.ok) {
          resume.release();
          return { row: settleRow(planned, frameGuardRefusal(check.reason)) };
        }
      }
    }
  }

  const target = verdict.target;
  if (target.widget !== undefined) return writeWidget(env, last, field, write, planned, target, options.widgets);
  // Our write hides the placeholder showing now, which labels this field or makes it fillable: the run's rescans keep
  // it while the page still shows this text (DOM-7), so the field keeps its label and its key.
  const shown = visiblePlaceholder(target.control);
  if (shown !== null) held.set(target.control, shown);
  const textLike = target.field.kind === 'text' || target.field.kind === 'textarea';
  // v5 p2-fill: a rich-text box's text too, as it renders (dom/values.ts readBackTextOf; v5 p2-fill review: memory only,
  // for guard.revert, never sent).
  const textBefore = textLike ? readBackTextOf(target.control) : null;
  const selectedBefore = selectedOf(target.field);
  const rule = readBackOf(planned.category);
  const file = resume?.file ?? undefined;
  const listed = target.field.options;
  const optionShown = write.value.kind === 'option' && listed !== 'lazy'
    ? listed[write.value.index]?.label ?? null : null;
  // v5 p2-fill (PLAN decision 14): the page's alert and confirm held through the write's own events and an upload's
  // wait, for the dialogs no action of the person's brought (dom/fillers/dialogs.ts; counts logged, never words).
  const doc = target.control.ownerDocument;
  await pagePatchesSettled(doc, env.signal);
  const heard = (dialogs: HeldDialogs) => {
    log('content.dialogs-held', { alerts: dialogs.alerts, confirms: dialogs.confirms });
    // v5 p2-fill review (security 4): and the person sees the counts.
    env.dialogsHeld?.(dialogs);
  };
  // v5 p2-fill: a résumé control that opens the page's own file picker (Adapter.uploadPickers) gets its file through
  // that picker, armed for one press (dom/fillers/picker.ts); s2 wd: a date drawn in parts (Adapter.dateFor: Workday's)
  // is written part by part and read back from its displays, its page's answer awaited (dom/fillers/date-parts.ts);
  // every other field by the native fillers.
  let picked: PickerResult | null = null;
  let outcome: DomFillOutcome;
  if (target.picker === true && write.value.kind === 'file') {
    picked = await withDialogsHeldWhile(doc, () => fillThroughPicker(target.control as HTMLElement, file,
      { adapter: env.adapter, root: env.root, signal: env.signal }), heard);
    log('content.picker', { input: picked.picked === 'input', fileSystem: picked.picked === 'file-system',
      wrote: picked.outcome.wrote });
    outcome = picked.outcome;
  } else if (target.dateParts !== undefined && write.value.kind === 'date') {
    const iso = write.value.iso;
    outcome = await withDialogsHeldWhile(doc, () => fillDateParts(target, iso, { adapter: env.adapter, root: env.root,
      signal: env.signal }), heard);
  } else {
    // v5 p2-fill review (L6): a rich-text box is selected first, and its editor given the time to see the selection
    // (dom/fillers/text.ts selectEditable), so its insert replaces the box's content, never lands at an old caret.
    if (write.value.kind === 'text' && isEditingHost(target.control)) {
      await selectEditable(target.control as HTMLElement, env.signal);
      // Nothing written yet (a text write holds no résumé): the run's end, or the person's Skip, gives the write up.
      afterWait(env, false);
    }
    outcome = withDialogsHeld(doc, () => fill(target, write.value, { adapter: env.adapter, root: env.root, file,
      readBack: rule }), heard);
  }
  let row = rowAfterFill(planned, outcome);
  if (!outcome.wrote) {
    resume?.release();
    return { row };
  }
  // A page that uploads a file the moment it goes in says whether its upload worked (Adapter.uploadState): waited for,
  // and a failed or unconfirmed upload is never verified. v5 p2-fill: the input is the one the page's picker opened
  // for a picker control (none where the page took the file through its showOpenFilePicker).
  const input = picked === null ? target.control as HTMLInputElement : picked.input;
  const upload = write.value.kind === 'file' && file !== undefined && input !== null
    ? await withDialogsHeldWhile(doc, () => awaitUpload(env.adapter, input, file.name, env.signal), heard) : null;
  // The file is in its input: the person's Skip only ends the wait for the page's word (still pending, so
  // upload-not-confirmed); the run's end throws.
  if (runOver(env)) {
    resume?.release();
    throw new RunAborted();
  }
  if (upload === 'failed' || upload === 'pending') row = uploadRow(planned, upload);
  // v5 p2-fill: a file the page took through its showOpenFilePicker leaves nothing of ours to read back: flagged.
  else if (picked?.picked === 'file-system') row = uploadRow(planned, 'pending');
  // v5 p2-fill: the résumé of a page that parses it (Adapter.quirks.resumeParse; core/plan/order.ts wrote it first):
  // its parse is waited for, so the rest of the pass is written over it, never under it (dom/resume-parse.ts).
  let reread = false;
  if (write.value.kind === 'file' && write.value.ref === 'resume' && env.adapter.quirks?.resumeParse === true
    && upload !== 'failed') {
    const parse = await awaitResumeParse(() => env.root, env.adapter, env.signal);
    reread = parse.changed;
    log('content.resume-parse', { ms: Math.round(parse.ms), changed: parse.changed, parsed: parse.outcome === 'parsed' });
    if (runOver(env)) {
      resume?.release();
      throw new RunAborted();
    }
  }
  const named = file?.name;
  const watched = upload === null || named === undefined || input === null ? null : input;
  return {
    row,
    written: { key: write.key, field: wanted, value: write.value, origin: write.origin, planned, rule,
      file: file === undefined ? null : { name: file.name, size: file.size }, resume, textBefore, selectedBefore,
      readBackVerified: outcome.verification === 'verified', optionShown, upload,
      uploadNow: watched === null || named === undefined ? null : () => uploadStateOf(env.adapter, watched, named),
      ...(watched === null ? {} : { inputLeft: () => !watched.isConnected }),
      ...(picked === null || picked.picked === null ? {} : { picked: picked.picked }) },
    readBack: readBack(target),
    ...(reread ? { reread: true as const } : {}),
  };
}

// ── Widgets (Phase 4) ────────────────────────────────────────────────────────────────────────────────────────────

/** A written widget, as the verification after the settle and the final Guard need it. Memory only. */
function writtenWidget(field: PlannedField, write: PlannedWrite, planned: FillResult, before: ScannedField,
  verified: boolean): WrittenField {
  return { key: write.key, field, value: write.value, origin: write.origin, planned, rule: undefined, file: null,
    resume: null, textBefore: null, selectedBefore: selectedOf(before), readBackVerified: verified, optionShown: null,
    upload: null, uploadNow: null };
}

/** One write into an ARIA widget, through the widget helpers (dom/widgets): a combobox's option, a multiselect's
 *  missing options, a group's member, or a remote typeahead's queries. The Guards have passed it already. */
async function writeWidget(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, widgets: WidgetWriteEnv | undefined): Promise<WriteResult> {
  if (widgets === undefined) return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  const ctx: WidgetFillContext = { adapter: env.adapter, root: env.root, signal: env.signal, readings: widgets.readings,
    ...(env.runSignal === undefined ? {} : { runSignal: env.runSignal }),
    ...(widgets.readiness === undefined ? {} : { readiness: widgets.readiness }),
    ...(widgets.bridge === undefined ? {} : { bridge: widgets.bridge }),
    ...(widgets.learn === undefined ? {} : { learn: widgets.learn }) };
  if (write.value.kind === 'query') return searchField(env, last, field, write, planned, target, widgets, ctx);
  // jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers takes its planned text value by value.
  if (target.widget?.tags !== undefined && write.value.kind === 'text') {
    return writeTags(env, last, field, write, planned, target, ctx);
  }
  const settled = (outcome: DomFillOutcome): WriteResult => {
    const row = rowAfterFill(planned, outcome);
    if (!outcome.wrote) return { row };
    return { row, written: writtenWidget(plannedFieldOf(field), write, planned, target.field,
      outcome.verification === 'verified'), readBack: readBack(target) };
  };
  if (write.value.kind !== 'option') {
    const outcome = await fillWidget(target, write.value, ctx, write.origin);
    afterWait(env, outcome.wrote);
    return settled(outcome);
  }
  // React first: the write's one command to the bridge, before a long list's search too; neither the search nor
  // fillWidget sends another (bridgeTried).
  let attempt = await chooseThroughBridge(target, write.value, ctx, write.origin);
  // s2 lists: a stored list's react-select is planned on the first pass, so its command may come before the page's
  // React attached ('no-react'): after the run's one wait for the page (dom/widgets' awaitPageReady), the field is found
  // again, guarded again, and its command sent once more.
  if (attempt.kind === 'fallback' && !attempt.sent && attempt.reason === 'no-react' && target.widget?.knownOptions !== undefined
    && await awaitPageReady(ctx)) {
    const again = domGuardBeforeWrite(last, plannedFieldOf(field));
    if (again.ok && guardWriteInFrame(write, toFieldSpec(again.target.field), env.canaries).ok) {
      target = again.target;
      attempt = await chooseThroughBridge(target, write.value, ctx, write.origin);
    }
  }
  afterWait(env, attempt.kind === 'done' ? attempt.outcome.wrote : attempt.sent);
  if (attempt.kind === 'done') return settled(attempt.outcome);
  // A Skip after the bridge said it chose: React may hold the choice, so it is written, not verified, and no event
  // follows it.
  if (env.signal.aborted) return settled(mismatch('verify-mismatch'));
  const tried: WidgetFillContext = { ...ctx, bridgeTried: { sent: attempt.sent, before: attempt.before } };
  // After a choice the bridge said it made, the list is not searched: typing into it would add to what React holds.
  const searched = attempt.sent ? null : await searchOption(env, last, field, write, planned, target, tried);
  if (searched !== null) return searched;
  const outcome = await fillWidget(target, write.value, tried, write.origin);
  afterWait(env, outcome.wrote);
  return settled(outcome);
}

/** A typeahead's results as the worker matches them: the field's spec with the results as its options (their hash its
 *  observed one), partial when their read was cut short, marked as a search's results (v4, drop: FieldSpec
 *  .searchResults, so one is chosen only in the fill band and never by the LLM), and nothing chosen yet (the box holds
 *  our query, which is no answer). */
function resultsSpec(field: ScannedField, results: readonly WidgetOptionRead[], complete: boolean,
  other = false): FieldSpec {
  const options = results.map((result, index) => ({ index, label: capCodePoints(result.label, TEXT_CAP_LABEL),
    disabled: result.disabled, selected: false }));
  const { optionsPartial: _, ...spec } = toFieldSpec(field);
  return { ...spec, options, optionSetHash: hashOfOptions(options.map((option) => option.label)),
    current: { kind: 'empty' }, searchResults: true, ...(complete ? {} : { optionsPartial: true as const }),
    ...(other ? { searchOther: true as const } : {}) };
}

/** One typed query's Guard (a remote typeahead's, or a long list's search): a pause the page shows or the person's
 *  Cancel refuses it, then the DOM guard finds the field again on a fresh scan, and guardWriteInFrame checks `write`
 *  with that one query as its value (its origin the profile's, transform typeahead.query). */
function queryGuard(env: PassEnv, last: ScanResult, wanted: PlannedField, write: PlannedWrite):
  TypeaheadHooks['guard'] {
  return async (query) => {
    if (runOver(env)) throw new RunAborted();
    // The person's Skip: the search ends there (dom/widgets puts back what it typed).
    if (env.signal.aborted) return { ok: false, reason: 'internal-error', blocked: false };
    if (env.stopped()) return { ok: false, reason: 'user-stopped', blocked: false };
    const hold = env.heldBy?.() ?? null;
    if (hold !== null) return { ok: false, reason: hold, blocked: false };
    const again = domGuardBeforeWrite(last, wanted);
    if (!again.ok) return { ok: false, reason: again.reason, blocked: GUARD_BLOCKS.has(again.reason) };
    const one: PlannedWrite = { ...write, value: { kind: 'query', queries: [query] } };
    const check = guardWriteInFrame(one, toFieldSpec(again.target.field), env.canaries);
    if (!check.ok) return { ok: false, reason: check.reason, blocked: !FRAME_GUARD_FLAGS.has(check.reason) };
    return { ok: true, target: again.target };
  };
}

// ── jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a box of several answers ──

/** One value's Guard in a box of several answers (dom/widgets' fillTags): a pause the page shows or the person's Cancel
 *  refuses it, then the DOM guard finds the field again on a fresh scan, and guardWriteInFrame checks `write` with that
 *  one value as its text (its origin the write's own). */
function tagGuard(env: PassEnv, last: ScanResult, wanted: PlannedField, write: PlannedWrite): TagsHooks['guard'] {
  return async (value) => {
    if (runOver(env)) throw new RunAborted();
    if (env.signal.aborted) return { ok: false, reason: 'internal-error', blocked: false };
    if (env.stopped()) return { ok: false, reason: 'user-stopped', blocked: false };
    const hold = env.heldBy?.() ?? null;
    if (hold !== null) return { ok: false, reason: hold, blocked: false };
    const again = domGuardBeforeWrite(last, wanted);
    if (!again.ok) return { ok: false, reason: again.reason, blocked: GUARD_BLOCKS.has(again.reason) };
    const one: PlannedWrite = { ...write, value: { kind: 'text', text: value } };
    const check = guardWriteInFrame(one, toFieldSpec(again.target.field), env.canaries);
    if (!check.ok) return { ok: false, reason: check.reason, blocked: !FRAME_GUARD_FLAGS.has(check.reason) };
    return { ok: true, target: again.target };
  };
}

/**
 * A box of several answers its adapter declares (WidgetDecl.tags: Workday's Skills, UltiPro's review Skills), planned
 * as the person's values joined with MANY_SEPARATOR: each value missing from its chips added in turn by the tags filler
 * (dom/widgets' fillTags), each a guarded write of its own (tagGuard), and the field read back by its chips. Nothing
 * added: the planner's row flagged (blocked where a Guard refused) with why, or already-correct where every value shows
 * already. Something added: written, verified when every value shows as a chip, else filled with why (at the box's cap,
 * max-selections-reached). A chip is never removed.
 */
async function writeTags(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite, planned: FillResult,
  target: FieldTarget, ctx: WidgetFillContext): Promise<WriteResult> {
  if (write.value.kind !== 'text' || !isActionable(target.widget!)) {
    return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  }
  const wanted = plannedFieldOf(field);
  const result = await fillTags(target, write.value.text, ctx, { guard: tagGuard(env, last, wanted, write) });
  afterWait(env, result.added > 0);
  if (result.added === 0) {
    if (result.verified) return { row: alreadyCorrectRow(planned) };
    return { row: settleRow(planned, result.blocked ? { kind: 'blocked', reason: result.reason }
      : { kind: 'not-written', reason: result.reason }) };
  }
  const row = result.verified ? settleRow(planned, { kind: 'verified' }) : mismatchRow(planned, result.reason);
  const now = last.rescan().target(write.key) ?? target;
  return { row, written: writtenWidget(wanted, write, planned, target.field, result.verified), readBack: readBack(now) };
}

// ── end jr6 ENGINE E3 (item 13) ──

// s2 core-wd: the list's own "Other", once three styles found nothing.

/** Why a search ends before its "Other" query: the page did not answer typed text (or a click), the field went or
 *  changed, the run or the person stopped it, or the widget cannot be searched. Any other end (no result was the value,
 *  or none was sure enough) is "nothing found". */
const OTHER_QUERY_STOPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['needs-your-click', 'element-not-found',
  'options-changed', 'internal-error', 'user-stopped', 'widget-unsupported']);

/** Whether a search that chose nothing types the list's own "Other" next (searchField): the planner asked for it
 *  (WriteValue query `other`), no Guard refused anything, it found nothing for a reason no stop names, and the run goes
 *  on. */
function otherQueryFollows(value: WriteValue, result: TypeaheadResult, env: PassEnv): boolean {
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 5): a free-text search's typed text stood: no "Other" follows it.
  return value.kind === 'query' && value.other === true && result.chosen === null && result.freeText === undefined
    && !result.blocked && !OTHER_QUERY_STOPS.has(result.reason) && !env.signal.aborted && !env.stopped() && !runOver(env);
}

// end s2 core-wd

/** Why a long list's search may end with nothing chosen and its list still be chosen from whole: no result was the
 *  planned option, the page did not answer the typed query (or the click on a result), or what it listed changed. */
const SEARCH_FALLS_BACK: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['no-match', 'needs-your-click',
  'options-changed']);

/**
 * A planned option of a long list its own text box filters (dom/widgets' searchesList: a combobox its adapter declared,
 * with WIDGET_SEARCH_MIN_OPTIONS options or more, or read only in part: Greenhouse's phone country, 244 countries),
 * from the profile: searched for by the option's words (optionQuery: "Canada" for "Canada +1"), that one query a
 * guarded write as a typeahead's are (queryGuard, the write's origin with transform typeahead.query), and the one
 * result that is the planned option, as the page shows it, clicked and read back (dom/widgets' searchForOption). Null
 * when the option is not searched for (a short list; another origin, such as an llm-pick, which is checked again on the
 * whole list right before its click; an option the widget shows already, or one no longer at its place; a label too
 * short to type) or the search fell back (SEARCH_FALLS_BACK: the text box holds what it held before, and its list is
 * closed): the list is then chosen from whole (fillWidget).
 */
async function searchOption(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, ctx: WidgetFillContext): Promise<WriteResult | null> {
  const { value, origin } = write;
  if (value.kind !== 'option' || origin.provenance !== 'profile' || !searchesList(target)) return null;
  const option = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  if (option === undefined || !sameOptionLabel(option.label, value.cleanLabel) || widgetHolds(target, value)) {
    return null;
  }
  const query = optionQuery(option.label);
  if (query === '') return null;
  const wanted = plannedFieldOf(field);
  const asQuery: PlannedWrite = { ...write, origin: { ...origin, transform: 'typeahead.query' } };
  const result: TypeaheadResult = await searchForOption(target, { label: option.label, cleanLabel: value.cleanLabel },
    query, ctx, queryGuard(env, last, wanted, asQuery));
  afterWait(env, result.chosen !== null);
  if (result.chosen === null) {
    if (!result.blocked && SEARCH_FALLS_BACK.has(result.reason)) return null;
    return { row: settleRow(planned, result.blocked ? { kind: 'blocked', reason: result.reason }
      : { kind: 'not-written', reason: result.reason }) };
  }
  const row = result.verified ? settleRow(planned, { kind: 'verified' }) : mismatchRow(planned, 'verify-mismatch');
  const now = last.rescan().target(write.key) ?? target;
  return { row, written: writtenWidget(wanted, write, planned, target.field, result.verified), readBack: readBack(now) };
}

/**
 * A remote typeahead's search (dom/widgets' searchTypeahead): each query a guarded write of its own (queryGuard: the
 * DOM guard on a fresh scan, then guardWriteInFrame on that one query, provenance profile and transform
 * typeahead.query), and each result list matched by the worker (plan/request for this field alone, its results as its
 * options), whose choice passes guardWriteInFrame before it is clicked. The row is the worker's for the chosen result,
 * or the planned one flagged (blocked when a Guard refused) with why nothing was chosen.
 * v4 (drop): a combobox's query write is a long list's search with the value's candidate answers, where the planner
 * found no option of the list's read to be the value (plan/frame.ts planChoice): searched the same way, but only where
 * its own text box filters it as typed (dom/widgets' searchesList); any other list is left, with why nothing was
 * chosen from its read (options-incomplete when it was read only in part, else no-match).
 */
async function searchField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, widgets: WidgetWriteEnv, ctx: WidgetFillContext): Promise<WriteResult> {
  if (write.value.kind !== 'query' || !isActionable(target.widget!)) {
    return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  }
  if (target.widget!.kind === 'combobox' && !searchesList(target)) {
    return { row: settleRow(planned, { kind: 'not-written',
      reason: target.field.optionsPartial === true ? 'options-incomplete' : 'no-match' }) };
  }
  const wanted = plannedFieldOf(field);
  let chosen: { row: FillResult; write: PlannedWrite } | null = null;
  const hooksFor = (other: boolean): TypeaheadHooks => ({
    guard: queryGuard(env, last, wanted, write),
    match: async (results, now, complete) => {
      const spec = resultsSpec(now.field, results, complete, other);
      // The worker's match may wait on the AI: the person's Skip ends that wait (its answer, when it comes, is unused).
      const answer = await untilAborted(widgets.plan([spec], [spec.key]), env.signal);
      if (runOver(env)) throw new RunAborted();
      if (answer === null) return { choose: null, reason: 'internal-error', blocked: false };
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
  });
  const started = monotonicNow();
  let searched = target;
  let result = await searchTypeahead(target, write.value.queries, ctx, hooksFor(false));
  // s2 core-wd: three styles found nothing, so the list's own "Other" is searched for once (the planner asked for it:
  // settings.modes.noMatch 'other'), within the field's time budget; its results go to the worker marked
  // FieldSpec.searchOther, which chooses that "Other" alone (plan/frame.ts planNoMatchOther).
  // What nothing found keeps the styles' reason; a choice, or a Guard's refusal, is the "Other" query's.
  if (otherQueryFollows(write.value, result, env) && monotonicNow() - started < SEARCH_FIELD_BUDGET_MS) {
    const again = last.rescan().target(write.key) ?? target;
    const other = await searchTypeahead(again, [NO_MATCH_OTHER_QUERY], ctx, hooksFor(true),
      SEARCH_FIELD_BUDGET_MS - (monotonicNow() - started), { freeText: false });
    if (other.chosen !== null || other.blocked) {
      result = other;
      searched = again;
    }
  }
  afterWait(env, result.chosen !== null || result.freeText !== undefined);
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 5, U-04): nothing matched and the typed text stood as the answer of a search its
  // adapter declares free text (WidgetDecl.freeText: UltiPro's School Name): the planner's row, written, read back now
  // and after the settle by the box's value (widgetHolds' 'text'), as a text write of that one query is.
  if (result.chosen === null && result.freeText !== undefined) {
    const row = result.verified ? settleRow(planned, { kind: 'verified' }) : mismatchRow(planned, 'verify-mismatch');
    const now = last.rescan().target(write.key) ?? target;
    // Its origin is the query write's own (the profile's, transform typeahead.query: core/plan/frame.ts).
    const typed: PlannedWrite = { ...write, value: { kind: 'text', text: result.freeText } };
    return { row, written: writtenWidget(wanted, typed, planned, target.field, result.verified), readBack: readBack(now) };
  }
  const picked = chosen as { row: FillResult; write: PlannedWrite } | null;
  if (result.chosen === null || picked === null) {
    return { row: settleRow(planned, result.blocked ? { kind: 'blocked', reason: result.reason }
      : { kind: 'not-written', reason: result.reason }) };
  }
  const base = { ...picked.row, key: write.key };
  const row = result.verified ? settleRow(base, { kind: 'verified' }) : mismatchRow(base, 'verify-mismatch');
  // s2 core-wd: a choice whose box it reveals takes its free text ("Other", chosen once three styles found nothing) is
  // read back from its own live elements while they stand, with no scan: a scan now would see the box before the loop
  // records the write (content/attribution.ts), and the box would never be named its follow-up.
  const followed = picked.write.value.kind === 'option' && picked.write.value.freeText !== undefined
    && (searched.widget?.element ?? searched.control).isConnected;
  const now = followed ? searched : last.rescan().target(write.key) ?? target;
  return { row, written: writtenWidget(wanted, { ...picked.write, key: write.key }, base, target.field, result.verified),
    readBack: readBack(now) };
}
