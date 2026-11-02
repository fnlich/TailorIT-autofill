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
 *    what the loop hashes for its flip count. An ARIA widget is written by the widget helpers instead (Phase 4,
 *    dom/widgets): its option chosen, its missing options added, its member pressed, or, for a remote typeahead, each
 *    query a guarded write of its own and each result list matched by the worker (searchField). A widget's options in
 *    the scan may be the run's kept reading of a closed list, so the write's origin goes to the widget filler, which
 *    checks an llm-pick again on what the list shows right before its click (the Phase 4 review, R1). A long list its
 *    own text box filters (dom/widgets' searchesList: Greenhouse's phone country) has a profile option searched for by
 *    the option's words instead, that one query guarded as a typeahead's are (searchOption). React first
 *    (docs/SPEC-AMENDMENTS.md §12): a combobox its adapter declares for the page-world bridge has its option chosen
 *    by its own React code before either (dom/widgets' chooseThroughBridge: the write's one command), and the search
 *    and the events follow only when nothing the frame can see changed; after a choice the bridge said it made, the
 *    list is not searched, and the events' path never ends as "nothing written";
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
import { accepts, acceptTokens, fill } from '../dom/fillers';
import { mismatch } from '../dom/fillers/outcome';
import { awaitUpload, uploadStateOf } from '../dom/fillers/upload';
import { sameOptionLabel } from '../dom/fillers/verify';
import { domGuardBeforeWrite, type PlannedField } from '../dom/guard';
import { hashOfOptions } from '../dom/option-hash';
import { toFieldSpec } from '../dom/scan';
import { TEXT_CAP_LABEL } from '../dom/thresholds';
import type {
  FieldTarget, FillOutcome as DomFillOutcome, ReadBackRule, ScannedField, ScanResult, WidgetOptionRead, WidgetReading,
} from '../dom/types';
import { visiblePlaceholder } from '../dom/visible-text';
import {
  chooseThroughBridge, fillWidget, isActionable, searchesList, searchForOption, searchTypeahead, widgetHolds,
  type BridgeRun, type TypeaheadHooks, type TypeaheadResult, type WidgetFillContext, type WidgetReadiness,
} from '../dom/widgets';
import type { ContentPlatform } from '../platform/types';
import type { AnswerData } from './channel';
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
  'value-rejected-by-site', 'disabled-or-readonly', 'upload-failed', 'upload-not-confirmed']);

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

/**
 * Writes one planned value through both Guards: the row it ends with, and what was written. `last` is any earlier scan
 * of the form root (the guard scans afresh from it), `field` the field as the plan saw it, and `held` the run's
 * heldPlaceholders, which every scan of the run reads.
 */
export async function writeField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, held: WeakMap<Element, string>, options: WriteOptions = {}): Promise<WriteResult> {
  const wanted = plannedFieldOf(field);
  // Nothing is written while the page asks for the person (a CAPTCHA, a code or a sign-in anywhere in the document),
  // nor once another step shows.
  const hold = env.heldBy?.() ?? null;
  if (hold !== null) return { row: settleRow(planned, { kind: 'not-written', reason: hold }) };
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
  const listed = target.field.options;
  const optionShown = write.value.kind === 'option' && listed !== 'lazy'
    ? listed[write.value.index]?.label ?? null : null;
  const outcome = fill(target, write.value, { adapter: env.adapter, root: env.root, file, readBack: rule });
  let row = rowAfterFill(planned, outcome);
  if (!outcome.wrote) {
    resume?.release();
    return { row };
  }
  // A page that uploads a file the moment it goes in says whether its upload worked (Adapter.uploadState): waited for,
  // and a failed or unconfirmed upload is never verified.
  const input = target.control as HTMLInputElement;
  const upload = write.value.kind === 'file' && file !== undefined ? await awaitUpload(env.adapter, input, file.name,
    env.signal) : null;
  // The file is in its input: the person's Skip only ends the wait for the page's word (still pending, so
  // upload-not-confirmed); the run's end throws.
  if (runOver(env)) {
    resume?.release();
    throw new RunAborted();
  }
  if (upload === 'failed' || upload === 'pending') row = uploadRow(planned, upload);
  const named = file?.name;
  return {
    row,
    written: { key: write.key, field: wanted, value: write.value, origin: write.origin, planned, rule,
      file: file === undefined ? null : { name: file.name, size: file.size }, resume, textBefore, selectedBefore,
      readBackVerified: outcome.verification === 'verified', optionShown, upload,
      uploadNow: upload === null || named === undefined ? null : () => uploadStateOf(env.adapter, input, named) },
    readBack: readBack(target),
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
    ...(widgets.bridge === undefined ? {} : { bridge: widgets.bridge }) };
  if (write.value.kind === 'query') return searchField(env, last, field, write, planned, target, widgets, ctx);
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
  const attempt = await chooseThroughBridge(target, write.value, ctx, write.origin);
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
 *  observed one), partial when their read was cut short, and nothing chosen yet (the box holds our query, which is no
 *  answer). */
function resultsSpec(field: ScannedField, results: readonly WidgetOptionRead[], complete: boolean): FieldSpec {
  const options = results.map((result, index) => ({ index, label: capCodePoints(result.label, TEXT_CAP_LABEL),
    disabled: result.disabled, selected: false }));
  const { optionsPartial: _, ...spec } = toFieldSpec(field);
  return { ...spec, options, optionSetHash: hashOfOptions(options.map((option) => option.label)),
    current: { kind: 'empty' }, ...(complete ? {} : { optionsPartial: true as const }) };
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
 */
async function searchField(env: PassEnv, last: ScanResult, field: ScannedField, write: PlannedWrite,
  planned: FillResult, target: FieldTarget, widgets: WidgetWriteEnv, ctx: WidgetFillContext): Promise<WriteResult> {
  if (write.value.kind !== 'query' || !isActionable(target.widget!)) {
    return { row: settleRow(planned, { kind: 'not-written', reason: 'widget-unsupported' }) };
  }
  const wanted = plannedFieldOf(field);
  let chosen: { row: FillResult; write: PlannedWrite } | null = null;
  const hooks: TypeaheadHooks = {
    guard: queryGuard(env, last, wanted, write),
    match: async (results, now, complete) => {
      const spec = resultsSpec(now.field, results, complete);
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
  };
  const result = await searchTypeahead(target, write.value.queries, ctx, hooks);
  afterWait(env, result.chosen !== null);
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
