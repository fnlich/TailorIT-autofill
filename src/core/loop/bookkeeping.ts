/*
 * The reactive loop's bookkeeping (Requirement D; docs/design/core.md §10.1; docs/ARCHITECTURE.md "Orchestrator"). The
 * content script runs the loop, at most MAX_PASSES passes of scan, plan, write and settle; this module keeps its books
 * and decides what each pass plans and when the loop ends. A field's identity is its base key, never a node, so a list
 * whose options change keeps its identity. It is pure, and it never sees a value: the content script hands it each
 * scan's fields (without their current values), each write's keyed value hash (ValueMac) and each pass's settled rows.
 * - Pending: the fields to plan, in DOM order. A field is resolved once it has a row, and is planned again only when
 *   its options change (the same base key with a new option-set hash: its match is dropped and it is matched again,
 *   neither gone nor new), when its value changes after our write (below), when it comes back after disappearing, or
 *   once (MAX_RETRIES) when its write could not happen because the page moved it under us (element-not-found,
 *   options-changed) and the next scan finds it as it was. When a re-plan finds our value in place (already-correct),
 *   the row of our write stays, whatever its options or its comings and goings did meanwhile (the Phase 3 review,
 *   LC-9). A field planned as optional that the page makes required after our writes (BeyondTrust's demographic
 *   consent box, required once a demographic answer is chosen), and that we did not write, is planned again ('required'),
 *   so it is decided as the required question it now is: a required consent is ticked. Its new row records that it is
 *   required, so the page's turning it off and on again plans it no more; only another plan's optional row could.
 *   jr6 ENGINE E3 (FIXPLAN §6.2 item 14): a field whose adapter names another as resetting it (ScanInput.dependsOn,
 *   Adapter.dependsOn) is planned again once that other was written since the scan before ('parent-written'), and so
 *   is one whose kind, or whose element where we never wrote it, changed under its base key after a write
 *   ('reshaped'): dependsAgain. jr6 line W review (REVC-7): a pass may hold such a field back, unwritten and with no
 *   row, while its parent waits for its options (content/loop.ts heldDependents): it stays pending, and the scan after
 *   that pass is no stall (holdBack).
 * - Our value changed (the Phase 3 review, LC-3 and LC-4). A field the person touched after our write (a trusted
 *   input, keydown, paste or drop: ScanInput.touched) is frozen: never planned or written again, and once its value is
 *   no longer ours its row is the person's (changed-by-you). Otherwise a value is written again only after the page
 *   reset it to empty or its placeholder (ScanInput.cleared); another value the page put there is planned again for
 *   its row only and never written (mayWrite): a mismatch, unless the planner finds our value in place (a reformatted
 *   phone). A file field is never written again: an input emptied after our upload is the upload taken, and an input
 *   the page puts back in its place is the same one.
 * - Waiting: a list the planner found with no usable options (waiting-for-options) is not planned again until its
 *   options change. It waits at most OPTION_WAIT_PASSES scans, or until the DOM's awaitOptions says they never loaded:
 *   then it is options-never-loaded (recovering if its options still arrive). A lazy widget (option-set hash 'lazy')
 *   waits the same way until the frame opens it and reads its options (Phase 4): that first read changes its key to
 *   the hash of what it read, and is planned again like any change of options, except that no writer is its parent
 *   and it counts as no change of options (MAX_OPTION_CHANGES).
 * - Disappeared: a field that was planned or written and is missing from a scan. Its recorded write is dropped, and
 *   its row becomes field-disappeared (rows.ts). A field never planned is dropped silently.
 * - Reveal edges: a field that appears after a pass's writes, or whose options change after them, gets one parent: the
 *   writer the DOM layer attributes it to, else the nearest writer before it in DOM order, else the nearest after it.
 *   An edge is certain only when the DOM attributed it: a pass's one writer is a guess too, since what shows during the
 *   settle may be anyone's (the Phase 3 review, LC-1). Edges order later passes (parents first) and go to
 *   RunState.revealEdges (keys only, each section and label slug hashed: storedBaseKey; at most MAX_REVEAL_EDGES).
 *   A cycle of certain edges stops its fields (reveal-cycle); a guessed edge never stops a field.
 * - Flips: every change of a written field's value hash after our first write, the page's or our own rewrite, is a
 *   flip. So a page that resets a field after our write makes one flip, our second write another, and its second reset
 *   the third: more than MAX_VALUE_FLIPS, and the field is stopped and flagged (value-oscillated), never written again.
 *   A list whose options change more than MAX_OPTION_CHANGES times is stopped too (options-oscillated), and so is a
 *   field that comes back more than MAX_REAPPEARANCES times (reveal-cycle).
 * - Follow-ups: a choice written with free text (an Other option, or an EEO self-describe option: recordWrite's
 *   followUp) names, at the next scan, the text box its write revealed: only on an edge the DOM attributed, and only
 *   the one box whose label asks to specify, describe or explain (or names "other"); there is no "only box" fallback
 *   (the Phase 3 review, LC-1 and L-S1). The content script types the free text, which it holds in its planned write,
 *   there, after its own checks of the box (src/content/follow-up.ts); the core never holds it. Blank beats wrong.
 * - The end: nothing pending, waiting or awaiting the LLM; or the scan after MAX_PASSES planned passes; or the same
 *   scan twice in a row with no write between and nothing new to plan (stalled). loopVerdict lists what is left, each
 *   with its reason.
 * LoopState holds value hashes, so it lives in the content script's memory only; revealEdgesOf is what may be stored.
 */
import type { FieldKind } from '../enums';
import { settleRow } from '../plan/settle';
import { OPTION_SET_LAZY, sectionKey } from '../text/keys';
import { keyWithBrackets } from '../text/normalize';
import { sha256Hex } from '../text/sha256';
import type { BaseKey, FieldKey, FieldSpec, OptionSetHash } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { ValueMac } from '../types/loop';

/** At most this many passes plan and write; the scan after the last of them only observes (but MAX_AI_PASSES). */
export const MAX_PASSES = 8;
/** s2 core-gh (decision 14; the owner's live Greenhouse runs of 2026-11-07, where every react-select only TailorIT's AI
 *  answers, and some drafts, ended max-passes-reached): while a field still waits for the AI, or for its list's read,
 *  the loop goes on past MAX_PASSES, up to this many passes. The worker ran one AI task at a time (since v5 two: background/ai-tasks
 *  createRunAi), so the answers come in one batch after another, each taking a pass. The loop's cap on a wait with no
 *  answer coming in (content/loop.ts AI_WAIT_CAP_MS) still ends a wait. */
export const MAX_AI_PASSES = 20;
/** v5 p2-stream: the AI's answers now come one by one as they land (TailorIT's stream), so a pass that only writes
 *  answers that came in (no field planned, none held back) is not counted against MAX_PASSES or MAX_AI_PASSES: each
 *  such pass writes at least one answer, and each answer comes once. This cap still ends a loop of any passes. */
export const MAX_LOOP_PASSES = 80;
/** A field whose value flips more often than this is stopped for good (value-oscillated). */
export const MAX_VALUE_FLIPS = 2;
/** A list whose options change more often than this is stopped for good (options-oscillated). */
export const MAX_OPTION_CHANGES = 3;
/** A list without usable options waits this many scans, unplanned, before it is options-never-loaded. */
export const OPTION_WAIT_PASSES = 2;
/** A write the page moved out from under us (RETRY_REASONS) is planned again at most this many times. */
export const MAX_RETRIES = 1;
/** A field that comes back after disappearing more often than this is stopped for good (reveal-cycle). */
export const MAX_REAPPEARANCES = 2;
/** RunState.revealEdges keeps at most this many edges, this run's first (the RunState store's worst case holds 100). */
export const MAX_REVEAL_EDGES = 100;

/** A tracked field's state. 'oscillating' and 'frozen' are final: such a field is never planned or written again.
 *  'frozen': the person touched it after our write. */
export const TRACKED_STATUSES = ['pending', 'awaiting-llm', 'waiting-options', 'resolved', 'unresolvable',
  'disappeared', 'oscillating', 'frozen'] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

/** Why a field is pending. 'value-changed': the page reset our value (it is written again); 'replaced': the page put
 *  another value in place of ours (planned for its row only, never written); 'required': the page made a field we
 *  left unwritten as optional required after our writes (decided again as a required question). jr6 ENGINE E3
 *  (FIXPLAN §6.2 item 14): 'parent-written': the field its adapter names as resetting it (Adapter.dependsOn) was
 *  written since the scan before (decided again, and written where its plan says so); 'reshaped': its kind, or the
 *  element the page draws it as, changed under the same base key (ADP's State: a text box that becomes a list). */
export const PENDING_CAUSES = ['new', 'reappeared', 'options-changed', 'value-changed', 'replaced', 'retry',
  'required', 'parent-written', 'reshaped'] as const;
export type PendingCause = (typeof PENDING_CAUSES)[number];

/** How the loop ended: nothing left to do, the passes ran out, the page stopped changing, or the content script cut it
 *  short (the settle cap, the person's Cancel, a pause, a policy notice, a hidden frame). */
export const LOOP_ENDS = ['nothing-pending', 'max-passes', 'stalled', 'cut'] as const;
export type LoopEnd = (typeof LOOP_ENDS)[number];

/** A row reason that means the write could not happen because the page moved the field under us: planned again. */
export const RETRY_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['element-not-found', 'options-changed']);

/** The kinds a follow-up's free text is typed into. */
const TEXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea']);

/** A box that asks for a choice's free text: "Please specify", "If other, please describe", "Other", "Self-describe". */
const FOLLOW_UP_LABEL = /\b(?:specify|other|describe|explain)\b/;

/** What the loop reads of a scanned field: a FieldSpec without its current value or its options. A FieldSpec is one. */
export type LoopField = Pick<FieldSpec, 'key' | 'baseKey' | 'kind' | 'label' | 'section' | 'required' | 'optionSetHash'
  | 'domOrder'>;

/** One field's books. In memory only (valueMac). */
export interface TrackedField {
  baseKey: BaseKey;
  /** The key the latest scan that saw it gave it (its option-set hash included). */
  key: FieldKey;
  optionSetHash: OptionSetHash;
  kind: FieldKind;
  /** The field's visible label (page text), for an unplanned field's row and the follow-up check. */
  label: string;
  /** The section's key (sectionKey), as rows carry it. */
  section: string;
  required: boolean;
  /** Its place in the latest scan that saw it. */
  domOrder: number;
  /** Whether the latest scan saw it. */
  present: boolean;
  firstSeenPass: number;
  lastSeenPass: number;
  status: TrackedStatus;
  /** Why it is pending; null otherwise. */
  cause: PendingCause | null;
  /** Why it is unresolvable, oscillating, frozen or disappeared, or its row's reason once resolved. */
  reason: ReasonCode | null;
  /** The latest row recorded for it (value-free). */
  row: FillResult | null;
  /** The latest row of a write of ours to it (wrote true), kept when its options change or it goes and comes back:
   *  a re-plan that finds our value in place keeps it. */
  ourRow: FillResult | null;
  /** We wrote it since it last appeared or its options last changed. */
  wrote: boolean;
  /** The latest hash of its value after our first write. */
  valueMac: ValueMac | null;
  flips: number;
  optionChanges: number;
  /** Scans it has waited for its options. */
  waitedScans: number;
  retries: number;
  /** How many times a scan has found it after it was missing, plus one. */
  appearances: number;
  /** The writer whose write revealed it, when it appeared after one. */
  revealedBy: BaseKey | null;
  revealCertain: boolean;
  /** Its latest write chose an option with free text (Other, self-describe), for the box that write reveals. */
  followUp: boolean;
  /** The core pass of 2026-11-06: a file of ours the page showed done, whose input it then took out of the page
   *  (ScanInput.uploaded): gone from the scan, it keeps its row. */
  taken?: true;
}

/** "Filling parent revealed child" ('revealed'), or "changed child's options" ('options'). */
export interface RevealEdge {
  parent: BaseKey;
  child: BaseKey;
  /** The DOM layer attributed it. */
  certain: boolean;
  kind: 'revealed' | 'options';
}

/** The loop's books between scans. In memory only: it holds value hashes. */
export interface LoopState {
  /** The index of the latest scan observed, -1 before the first. Passes plan at scans 0 to MAX_PASSES - 1. */
  pass: number;
  fields: ReadonlyMap<BaseKey, TrackedField>;
  /** This run's edges, in the order they were found. */
  edges: readonly RevealEdge[];
  /** Earlier runs' edges (RunState.revealEdges, in their stored form: storedBaseKey): they order passes, and never
   *  stop a field. */
  priorEdges: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  /** The fields written since the latest scan, in write order. */
  writers: readonly BaseKey[];
  /** The latest scan's keys, sorted. */
  signature: string | null;
  /** The latest scan repeated the one before it (the same keys), with no write between and nothing new to plan. */
  stalled: boolean;
  /** v5 p2-stream: the passes that only wrote answers that came in from the AI (noteArrivalPass): not counted against
   *  MAX_PASSES or MAX_AI_PASSES. Absent: none. */
  arrivalPasses?: number;
  /** jr6 line W review (REVC-7): how many pending fields the pass since the latest scan held back, unwritten and with no
   *  row, while the field whose write resets them waited for its options (holdBack): the next scan is then no stall,
   *  since they are planned again. Absent: none. */
  heldBack?: number;
}

/** What happened at a scan. Value-free: keys and counts only. */
export type LoopEvent =
  /** A field that appeared after the first scan (`again`: it had disappeared). */
  | { type: 'field-appeared'; key: FieldKey; baseKey: BaseKey; revealedBy: BaseKey | null; certain: boolean;
    again: boolean }
  /** Drop what was recorded for it (`wrote`: we had written it); its row becomes field-disappeared. */
  | { type: 'field-disappeared'; key: FieldKey; baseKey: BaseKey; wrote: boolean }
  /** Its match is dropped and it is matched again; a write planned under `from` is void. */
  | { type: 'options-changed'; baseKey: BaseKey; from: FieldKey; to: FieldKey }
  /** A value we wrote changed (a flip): it is planned again. */
  | { type: 'value-changed'; key: FieldKey; baseKey: BaseKey; flips: number }
  /** Stopped for good: never planned or written again. */
  | { type: 'oscillating'; key: FieldKey; baseKey: BaseKey; reason: 'value-oscillated' | 'options-oscillated' }
  | { type: 'reveal-cycle'; keys: BaseKey[] }
  | { type: 'options-never-loaded'; key: FieldKey; baseKey: BaseKey }
  /** Type the free text of `parent`'s choice (Other, self-describe) into `child`. Always on a certain edge. */
  | { type: 'follow-up-found'; parent: FieldKey; child: FieldKey; certain: boolean };

/** What a scan adds besides its fields. Value-free: hashes and keys only. */
export interface ScanInput {
  /** The keyed hash of each field's value now, by base key: at least every field we wrote. In memory only. */
  valueMacs?: ReadonlyMap<BaseKey, ValueMac>;
  /** The DOM layer's exact "this field followed that write" pairs, child to parent, when it has them. */
  attribution?: ReadonlyMap<BaseKey, BaseKey>;
  /** The written fields the person touched since our latest write to them: a trusted input, keydown, paste or drop. */
  touched?: ReadonlySet<BaseKey>;
  /** The written fields that now hold nothing, or only their placeholder: a reset, after which a write is allowed. */
  cleared?: ReadonlySet<BaseKey>;
  /** The core pass of 2026-11-06: the written file fields whose upload the page shows done and whose input it took out
   *  of the page (Greenhouse: fixtures/greenhouse/axle-attached.html). Missing from the scan, each is the upload taken,
   *  not a field gone: its row stands (TrackedField.taken). */
  uploaded?: ReadonlySet<BaseKey>;
  // ── jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19, ADP-2) ──
  /** Each field the adapter names as reset by another's write (Adapter.dependsOn), child to parent, by base key: a
   *  child whose parent was written since the scan before is decided again ('parent-written'). Keys only. */
  dependsOn?: ReadonlyMap<BaseKey, BaseKey>;
  /** The fields the page draws as another element than at the scan before (the content script compares them; never a
   *  value): with a write since that scan, one we did not write is decided again ('reshaped'). */
  replaced?: ReadonlySet<BaseKey>;
  // ── end jr6 ENGINE E3 ──
}

/** Whether the loop is over, and what it leaves unresolved. */
export interface LoopVerdict {
  done: boolean;
  /** Why it ended; null while it goes on. */
  end: LoopEnd | null;
  /** The present fields left unresolved, in DOM order, each with the reason its row takes; empty while it goes on. */
  unresolved: Array<{ key: FieldKey; baseKey: BaseKey; reason: ReasonCode }>;
}

/** One scan folded in. */
export interface ScanObservation {
  state: LoopState;
  /** The fields to plan this pass, in DOM order. Plan them only while the verdict is not done. */
  pending: FieldKey[];
  /** Lists waiting for their options, unplanned: await them (awaitOptions) before the next scan. */
  waiting: FieldKey[];
  events: LoopEvent[];
  verdict: LoopVerdict;
}

/** The base key inside a field key: `platform|section|slug|hash|ordinal` without its hash. */
export function baseKeyOf(key: FieldKey): BaseKey {
  const parts = key.split('|');
  return (parts.length === 5 ? [parts[0], parts[1], parts[2], parts[4]].join('|') : key) as BaseKey;
}

/**
 * A base key as RunState.revealEdges stores it: its section (a heading slug) and its label slug, both page text that
 * may echo a value the page shows back ("Preferred name if not Alex Rivera"), each replaced by the first 16 hex of its
 * SHA-256 (the Phase 3 review, L-S3). A key of another shape is hashed whole. Earlier runs' edges are compared in this
 * form.
 */
export function storedBaseKey(baseKey: BaseKey): BaseKey {
  const parts = baseKey.split('|');
  if (parts.length !== 4) return sha256Hex(baseKey).slice(0, 16) as BaseKey;
  return [parts[0], sha256Hex(parts[1]!).slice(0, 16), sha256Hex(parts[2]!).slice(0, 16), parts[3]].join('|') as
    BaseKey;
}

/** A field the loop will never plan or write again. */
export function isStopped(field: TrackedField): boolean {
  return field.status === 'oscillating' || field.status === 'frozen';
}

/** Whether a pass may write this field now: not stopped, and not a value the page replaced (planned for its row
 *  only). */
export function mayWrite(state: LoopState, key: FieldKey): boolean {
  const field = state.fields.get(baseKeyOf(key));
  return field !== undefined && field.key === key && !isStopped(field) && field.cause !== 'replaced';
}

/** A text box that asks for a choice's free text, by its label's words. */
export function isFollowUpLabel(label: string): boolean {
  return FOLLOW_UP_LABEL.test(keyWithBrackets(label, 'label'));
}

/**
 * A loop with no scan yet. `revealEdges` are earlier runs' (RunState.revealEdges, stored form), for ordering.
 * `carried`: an earlier attempt's fields on the same step, in the same run (carriedFields: a fix pass, or the step
 * again after Back), so this attempt knows what we wrote there (the value hash, under the run's key) and what the
 * person took over (the Phase 5 review, C-S3, C-S5). Their first scan reads them as any later scan does: a value still
 * ours keeps our row and is not planned again; one the person touched is frozen, theirs once it changed; one the page
 * reset is written again; another value in its place is planned for its row only.
 */
export function createLoop(prior: { revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  carried?: readonly TrackedField[] } = {}): LoopState {
  const fields = new Map<BaseKey, TrackedField>();
  for (const field of prior.carried ?? []) {
    // Where it was and what this attempt's passes did start afresh; what we wrote and whose it is stay.
    fields.set(field.baseKey, { ...field, present: true, firstSeenPass: 0, lastSeenPass: -1, followUp: false,
      waitedScans: 0 });
  }
  return { pass: -1, fields, edges: [], priorEdges: (prior.revealEdges ?? []).slice(0, MAX_REVEAL_EDGES),
    writers: [], signature: null, stalled: false };
}

/** The fields a later attempt on the same step carries (createLoop's `carried`): those present at the latest scan that
 *  we wrote, whose row was a write of ours, or that the person took over. In memory only: they hold value hashes. */
export function carriedFields(state: LoopState): TrackedField[] {
  return [...state.fields.values()].filter((field) => field.present
    && (field.wrote || field.ourRow !== null || field.status === 'frozen'));
}

/** The parts of a tracked field a scan sets. */
function placed(spec: LoopField, pass: number): Pick<TrackedField, 'key' | 'optionSetHash' | 'kind' | 'label' | 'section'
  | 'required' | 'domOrder' | 'present' | 'lastSeenPass'> {
  return { key: spec.key, optionSetHash: spec.optionSetHash, kind: spec.kind, label: spec.label,
    section: sectionKey(spec.section), required: spec.required, domOrder: spec.domOrder, present: true,
    lastSeenPass: pass };
}

/** The parent a field that appeared, or whose options changed, after the last pass's writes is given. */
type ParentOf = (child: BaseKey, domOrder: number) => { parent: BaseKey; certain: boolean } | null;

/** The DOM layer's attribution, else the nearest present writer before the child in DOM order, else after it, else
 *  the last writer. Certain only when attributed. */
function parentFinder(writers: readonly BaseKey[], seen: ReadonlyMap<BaseKey, LoopField>,
  attribution: ReadonlyMap<BaseKey, BaseKey> | undefined): ParentOf {
  const placedWriters = writers.flatMap((writer) => {
    const spec = seen.get(writer);
    return spec ? [{ writer, order: spec.domOrder }] : [];
  });
  return (child, domOrder) => {
    const named = attribution?.get(child);
    if (named !== undefined && named !== child) return { parent: named, certain: true };
    const candidates = placedWriters.filter((candidate) => candidate.writer !== child);
    let best: { writer: BaseKey; order: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.order < domOrder && (best === null || candidate.order > best.order)) best = candidate;
    }
    if (best === null) {
      for (const candidate of candidates) {
        if (candidate.order > domOrder && (best === null || candidate.order < best.order)) best = candidate;
      }
    }
    const parent = best?.writer ?? [...writers].reverse().find((writer) => writer !== child) ?? null;
    return parent === null ? null : { parent, certain: false };
  };
}

/** The fields on cycles of certain edges (Tarjan's strongly connected components of more than one field). */
function cycles(edges: readonly RevealEdge[]): BaseKey[][] {
  const next = new Map<BaseKey, BaseKey[]>();
  for (const edge of edges) {
    if (!edge.certain || edge.parent === edge.child) continue;
    next.set(edge.parent, [...(next.get(edge.parent) ?? []), edge.child]);
  }
  const index = new Map<BaseKey, number>();
  const low = new Map<BaseKey, number>();
  const stack: BaseKey[] = [];
  const onStack = new Set<BaseKey>();
  const found: BaseKey[][] = [];
  const visit = (node: BaseKey) => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const child of next.get(node) ?? []) {
      if (!index.has(child)) {
        visit(child);
        low.set(node, Math.min(low.get(node)!, low.get(child)!));
      } else if (onStack.has(child)) {
        low.set(node, Math.min(low.get(node)!, index.get(child)!));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: BaseKey[] = [];
    for (;;) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    if (component.length > 1) found.push(component);
  };
  for (const node of next.keys()) if (!index.has(node)) visit(node);
  return found;
}

/** A scan's signature: its fields' keys (option-set hashes included), sorted. */
function signatureOf(seen: ReadonlyMap<BaseKey, LoopField>): string {
  return [...seen.values()].map((spec) => spec.key).sort().join('\u001e');
}

/** The present fields with this status, in DOM order. */
function presentWith(fields: ReadonlyMap<BaseKey, TrackedField>, status: TrackedStatus): TrackedField[] {
  return [...fields.values()].filter((field) => field.present && field.status === status)
    .sort((a, b) => a.domOrder - b.domOrder);
}

/** A file field we uploaded to: never written again, even when the page puts a new input in its place, so a resume is
 *  never sent twice (LC-3). */
function fileTaken(field: TrackedField): boolean {
  return field.kind === 'file' && field.ourRow !== null && field.ourRow.wrote;
}

/** Whether the page made a field required after our writes (the module header): its row was planned for an optional
 *  field and wrote nothing, nothing of ours is in it, it is required now, and something was written since the scan
 *  before. Bounded: the next plan's row records it as required. */
function madeRequired(old: TrackedField, spec: LoopField, state: LoopState): boolean {
  return spec.required && old.row !== null && !old.row.required && !old.row.wrote && !old.wrote
    && state.writers.length > 0;
}

// ── jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19's re-plan, ADP-2) ──
/**
 * Whether a field present at both scans is decided again because a write reset it, and why (null: it is not):
 * - 'parent-written': its adapter names a field whose write resets it (ScanInput.dependsOn: iCIMS's State under its
 *   Country, "Please specify" under "How did you hear about us?"; ADP's State; Oracle's address block), and that field
 *   was written since the scan before (LoopState.writers). Whatever its own row was, kept or written and for any reason,
 *   it is planned again: its options, its value or its being enabled may have changed with the parent's (Jobright reads
 *   its rules again after the country commits: ADP's doFillForm, iCIMS's combo questions re-extracted after a settle);
 *   a value of ours the page replaced then is written again, not left;
 * - 'reshaped': its kind changed under the same base key, or (with a write since the scan before) the page draws it as
 *   another element and we never wrote it (ScanInput.replaced): ADP's State, a text box that becomes a list once
 *   Country is chosen. A field we wrote is the value hashes' (a reset is written again), so a page that draws its
 *   fields anew on every change never re-plans what we wrote.
 * Bounded: only a resolved or unresolvable field (a pending one is planned anyway; one waiting for its options or for
 * the AI waits on; a stopped one never moves), or one pending as 'replaced' after its parent's write; never a field
 * the person skipped; and only after a write, so a page that changes nothing ends the loop as before.
 */
function dependsAgain(old: TrackedField, field: TrackedField, spec: LoopField, state: LoopState, input: ScanInput):
  'parent-written' | 'reshaped' | null {
  if (field.row?.reason === 'skipped-by-you') return null;
  const parent = input.dependsOn?.get(spec.baseKey);
  const parentWritten = parent !== undefined && parent !== spec.baseKey && state.writers.includes(parent);
  const decided = field.status === 'resolved' || field.status === 'unresolvable';
  if (parentWritten && (decided || (field.status === 'pending' && field.cause === 'replaced'))) return 'parent-written';
  if (!decided) return null;
  if (spec.kind !== old.kind) return 'reshaped';
  const ours = old.wrote || old.ourRow !== null;
  return state.writers.length > 0 && !ours && input.replaced?.has(spec.baseKey) === true ? 'reshaped' : null;
}
// ── end jr6 ENGINE E3 ──

/** Folds one scan in: new, returning, changed and missing fields, flips, reveal edges, cycles and follow-ups. `scanned`
 *  is the scan's fields (FieldSpecs will do); the first scan is pass 0. */
export function observeScan(state: LoopState, scanned: readonly LoopField[], input: ScanInput = {}): ScanObservation {
  const pass = state.pass + 1;
  const macs = input.valueMacs ?? new Map<BaseKey, ValueMac>();
  const touched = input.touched ?? new Set<BaseKey>();
  const cleared = input.cleared ?? new Set<BaseKey>();
  const fields = new Map(state.fields);
  const events: LoopEvent[] = [];
  const seen = new Map<BaseKey, LoopField>();
  for (const spec of [...scanned].sort((a, b) => a.domOrder - b.domOrder)) {
    if (!seen.has(spec.baseKey)) seen.set(spec.baseKey, spec);
  }
  const parentOf = parentFinder(state.writers, seen, input.attribution);
  const added: RevealEdge[] = [];
  const edgeFor = (child: BaseKey, domOrder: number, kind: RevealEdge['kind']) => {
    const parent = pass > 0 ? parentOf(child, domOrder) : null;
    if (parent !== null) added.push({ ...parent, child, kind });
    return parent;
  };

  for (const spec of seen.values()) {
    const old = fields.get(spec.baseKey);
    const now = placed(spec, pass);
    if (old === undefined) {
      const parent = edgeFor(spec.baseKey, spec.domOrder, 'revealed');
      fields.set(spec.baseKey, { baseKey: spec.baseKey, ...now, firstSeenPass: pass, status: 'pending', cause: 'new',
        reason: null, row: null, ourRow: null, wrote: false, valueMac: null, flips: 0, optionChanges: 0,
        waitedScans: 0, retries: 0, appearances: 1, revealedBy: parent?.parent ?? null,
        revealCertain: parent?.certain ?? false, followUp: false });
      if (pass > 0) {
        events.push({ type: 'field-appeared', key: spec.key, baseKey: spec.baseKey, revealedBy: parent?.parent ?? null,
          certain: parent?.certain ?? false, again: false });
      }
      continue;
    }
    const mac = macs.get(spec.baseKey);
    const changed = old.wrote && old.valueMac !== null && mac !== undefined && mac !== old.valueMac;
    if (old.status === 'frozen') {
      // The person's: never planned or written again. Once its value is no longer ours, the row is theirs.
      fields.set(spec.baseKey, { ...old, ...now, ...(changed ? { valueMac: mac, reason: 'changed-by-you' as const } : {}) });
      continue;
    }
    if (isStopped(old)) {
      fields.set(spec.baseKey, { ...old, ...now });
      continue;
    }
    if (!old.present) {
      if (fileTaken(old)) {
        // The upload widget put a new input where ours was: the upload stands, and nothing is sent twice (LC-3).
        fields.set(spec.baseKey, { ...old, ...now, appearances: old.appearances + 1, status: 'resolved', cause: null,
          reason: old.ourRow!.reason, row: old.ourRow, wrote: false, valueMac: null, followUp: false });
        continue;
      }
      const parent = edgeFor(spec.baseKey, spec.domOrder, 'revealed');
      const appearances = old.appearances + 1;
      const back = { ...old, ...now, appearances, wrote: false, valueMac: null, followUp: false, retries: 0,
        waitedScans: 0, revealedBy: parent?.parent ?? null, revealCertain: parent?.certain ?? false };
      if (appearances - 1 > MAX_REAPPEARANCES) {
        fields.set(spec.baseKey, { ...back, status: 'oscillating', cause: null, reason: 'reveal-cycle' });
        events.push({ type: 'reveal-cycle', keys: [spec.baseKey] });
      } else {
        fields.set(spec.baseKey, { ...back, status: 'pending', cause: 'reappeared', reason: null });
        events.push({ type: 'field-appeared', key: spec.key, baseKey: spec.baseKey, revealedBy: parent?.parent ?? null,
          certain: parent?.certain ?? false, again: true });
      }
      continue;
    }
    if (old.wrote && touched.has(spec.baseKey)) {
      // The person touched what we wrote: frozen, theirs once its value or its options are no longer ours (LC-4).
      const theirs = changed || spec.optionSetHash !== old.optionSetHash;
      fields.set(spec.baseKey, { ...old, ...now, status: 'frozen', cause: null, reason: theirs ? 'changed-by-you' : null,
        valueMac: mac ?? old.valueMac, followUp: false });
      continue;
    }
    if (spec.optionSetHash !== old.optionSetHash) {
      // A lazy widget read for the first time (the frame opened it: Phase 4) shows options it always had: no writer
      // changed them, so it gets no edge and the read is no change of options.
      const firstRead = old.optionSetHash === OPTION_SET_LAZY;
      if (!firstRead) edgeFor(spec.baseKey, spec.domOrder, 'options');
      const optionChanges = firstRead ? old.optionChanges : old.optionChanges + 1;
      // Matched anew, as a new question: a value lost with the old options is no flip, and the next write is a first.
      const changedOptions = { ...old, ...now, optionChanges, wrote: false, valueMac: null, followUp: false, retries: 0,
        waitedScans: 0 };
      if (optionChanges > MAX_OPTION_CHANGES) {
        fields.set(spec.baseKey, { ...changedOptions, status: 'oscillating', cause: null, reason: 'options-oscillated' });
        events.push({ type: 'oscillating', key: spec.key, baseKey: spec.baseKey, reason: 'options-oscillated' });
      } else {
        fields.set(spec.baseKey, { ...changedOptions, status: 'pending', cause: 'options-changed', reason: null });
        events.push({ type: 'options-changed', baseKey: spec.baseKey, from: old.key, to: spec.key });
      }
      continue;
    }
    let field: TrackedField = { ...old, ...now };
    if (old.wrote && mac !== undefined && old.valueMac === null) field = { ...field, valueMac: mac };
    if (changed && old.kind === 'file') {
      // An upload widget empties its input once it has the file: the upload taken, not a flip (LC-3).
      field = { ...field, valueMac: mac! };
    } else if (changed) {
      const flips = old.flips + 1;
      field = { ...field, valueMac: mac!, flips };
      if (flips > MAX_VALUE_FLIPS) {
        field = { ...field, status: 'oscillating', cause: null, reason: 'value-oscillated' };
        events.push({ type: 'oscillating', key: spec.key, baseKey: spec.baseKey, reason: 'value-oscillated' });
      } else {
        // Written again only after the page reset it; another value in its place is planned for its row only.
        field = { ...field, status: 'pending', cause: cleared.has(spec.baseKey) ? 'value-changed' : 'replaced',
          reason: null };
        events.push({ type: 'value-changed', key: spec.key, baseKey: spec.baseKey, flips });
      }
    } else if (field.status === 'waiting-options') {
      const waitedScans = old.waitedScans + 1;
      field = { ...field, waitedScans };
      if (waitedScans >= OPTION_WAIT_PASSES) {
        field = { ...field, status: 'unresolvable', reason: 'options-never-loaded' };
        events.push({ type: 'options-never-loaded', key: spec.key, baseKey: spec.baseKey });
      }
    } else if (field.status === 'resolved' && field.row !== null && RETRY_REASONS.has(field.row.reason)
      && field.retries < MAX_RETRIES) {
      field = { ...field, status: 'pending', cause: 'retry', retries: field.retries + 1 };
    } else if (field.status === 'resolved' && madeRequired(old, spec, state)) {
      field = { ...field, status: 'pending', cause: 'required' };
    }
    // jr6 ENGINE E3 (FIXPLAN §6.2 item 14): decided again after a write that reset it (dependsAgain).
    const again = dependsAgain(old, field, spec, state, input);
    if (again !== null) field = { ...field, status: 'pending', cause: again, reason: null };
    fields.set(spec.baseKey, field);
  }

  for (const [baseKey, old] of state.fields) {
    if (seen.has(baseKey) || !old.present) continue;
    if (isStopped(old)) {
      fields.set(baseKey, { ...old, present: false });
      continue;
    }
    // The core pass of 2026-11-06: an upload the page took, its input gone with it (ScanInput.uploaded).
    if (old.wrote && old.kind === 'file' && input.uploaded?.has(baseKey) === true) {
      fields.set(baseKey, { ...old, present: false, taken: true });
      continue;
    }
    fields.set(baseKey, { ...old, present: false, status: 'disappeared', cause: null, reason: 'field-disappeared',
      wrote: false, valueMac: null, followUp: false });
    if (old.row !== null || old.wrote) {
      events.push({ type: 'field-disappeared', key: old.key, baseKey, wrote: old.wrote || old.row?.wrote === true });
    }
  }

  const known = new Set(state.edges.map((edge) => `${edge.kind}\u001f${edge.parent}\u001f${edge.child}`));
  const fresh = added.filter((edge) => {
    const id = `${edge.kind}\u001f${edge.parent}\u001f${edge.child}`;
    if (known.has(id)) return false;
    known.add(id);
    return true;
  });
  const edges = [...state.edges, ...fresh];
  for (const component of cycles(edges)) {
    const stopping = component.filter((baseKey) => {
      const field = fields.get(baseKey);
      return field !== undefined && !isStopped(field);
    });
    if (stopping.length === 0) continue;
    for (const baseKey of stopping) {
      fields.set(baseKey, { ...fields.get(baseKey)!, status: 'oscillating', cause: null, reason: 'reveal-cycle' });
    }
    events.push({ type: 'reveal-cycle',
      keys: stopping.sort((a, b) => fields.get(a)!.domOrder - fields.get(b)!.domOrder) });
  }

  // Follow-ups: the box a choice's write revealed takes its free text, named only on an attributed edge and only when
  // its label asks for it (LC-1, L-S1).
  const askers = [...state.fields.values()].filter((field) => field.followUp && fields.get(field.baseKey)?.present);
  for (const asker of askers) {
    const asking = added.filter((edge) => edge.kind === 'revealed' && edge.certain && edge.parent === asker.baseKey)
      .flatMap((edge) => {
        const child = fields.get(edge.child);
        return child !== undefined && child.present && child.status === 'pending' && TEXT_KINDS.has(child.kind)
          && isFollowUpLabel(child.label) ? [child] : [];
      });
    if (asking.length !== 1) continue;
    events.push({ type: 'follow-up-found', parent: fields.get(asker.baseKey)!.key, child: asking[0]!.key,
      certain: true });
  }
  // A choice's box shows at the scan after its write, or not at all.
  for (const [baseKey, field] of state.fields) {
    if (field.followUp) fields.set(baseKey, { ...fields.get(baseKey)!, followUp: false });
  }

  // Stalled: the page shows what it showed, nothing was written since, and this scan gave nothing new to plan. jr6 line
  // W review (REVC-7): nor is a scan after a pass that held fields back for their parent (holdBack) a stall.
  const signature = signatureOf(seen);
  const newlyPending = [...fields].some(([baseKey, field]) => field.status === 'pending'
    && state.fields.get(baseKey)?.status !== 'pending');
  const next: LoopState = { pass, fields, edges, priorEdges: state.priorEdges, writers: [], signature,
    stalled: pass > 0 && state.writers.length === 0 && signature === state.signature && !newlyPending
      && (state.heldBack ?? 0) === 0,
    ...(state.arrivalPasses === undefined ? {} : { arrivalPasses: state.arrivalPasses }) };
  return { state: next, pending: presentWith(fields, 'pending').map((field) => field.key),
    waiting: presentWith(fields, 'waiting-options').map((field) => field.key), events, verdict: loopVerdict(next) };
}

/**
 * Records one write, right after the fill: `valueMac` is the keyed hash of the field's value as read back then, by the
 * same function as the scans' hashes. A rewrite that changes the value is itself a flip. `followUp`: the write chose an
 * option with free text (an option write whose value carries freeText: Other, self-describe), to be typed into the box
 * it reveals. Every write must be recorded: a pass with none is what tells a stalled page.
 */
export function recordWrite(state: LoopState, key: FieldKey, write: { valueMac: ValueMac; followUp?: boolean }):
  LoopState {
  const baseKey = baseKeyOf(key);
  const field = state.fields.get(baseKey);
  if (field === undefined) return state;
  const flips = field.wrote && field.valueMac !== null && write.valueMac !== field.valueMac ? field.flips + 1 : field.flips;
  const stops = flips > MAX_VALUE_FLIPS && !isStopped(field);
  const fields = new Map(state.fields);
  fields.set(baseKey, { ...field, wrote: true, valueMac: write.valueMac, flips, followUp: write.followUp === true,
    ...(stops ? { status: 'oscillating' as const, cause: null, reason: 'value-oscillated' as const } : {}) });
  return { ...state, fields, writers: [...state.writers.filter((writer) => writer !== baseKey), baseKey] };
}

/**
 * Records a pass's rows (planned, filled, verified), by key. A row resolves its field, except waiting-for-options
 * (waiting) and a key in `awaiting` (the LLM's, Phase 4). A row under a key the field no longer has (its options
 * changed since) is stale and ignored. When a value we wrote is planned again and found in place (already-correct),
 * the row of our write stays, under the key the field has now (LC-9); a value the page replaced, planned for its row
 * only, otherwise ends as our write that no longer reads back (a mismatch, LC-4).
 */
export function recordRows(state: LoopState, rows: Iterable<FillResult>, options: { awaiting?: Iterable<FieldKey> } = {}):
  LoopState {
  const awaiting = new Set(options.awaiting ?? []);
  const fields = new Map(state.fields);
  for (const row of rows) {
    const baseKey = baseKeyOf(row.key);
    const field = fields.get(baseKey);
    if (field === undefined || field.key !== row.key) continue;
    const ourRow = field.ourRow;
    const ours = ourRow !== null && row.status === 'skipped' && row.reason === 'already-correct';
    const kept = ours ? { ...ourRow, key: row.key }
      : field.cause === 'replaced' ? { ...settleRow(ourRow ?? row, { kind: 'mismatch' }), key: row.key }
        : row;
    // Our value, found in place after its options changed or it came back, is ours again: its changes count.
    const adopted = ours && !field.wrote ? { wrote: true, valueMac: null } : {};
    const books = { ...field, ...adopted, row: kept, ourRow: kept.wrote ? kept : ourRow };
    if (isStopped(field) || field.status === 'disappeared') {
      fields.set(baseKey, { ...field, row: kept, ourRow: books.ourRow });
    } else if (awaiting.has(row.key)) {
      fields.set(baseKey, { ...books, status: 'awaiting-llm', cause: null, reason: kept.reason });
    } else if (kept.reason === 'waiting-for-options') {
      fields.set(baseKey, { ...books, status: 'waiting-options', cause: null, reason: kept.reason,
        waitedScans: field.status === 'waiting-options' ? field.waitedScans : 0 });
    } else {
      fields.set(baseKey, { ...books, status: 'resolved', cause: null, reason: kept.reason });
    }
  }
  return { ...state, fields };
}

/**
 * jr6 line W review (REVC-7): records that the pass now ending held these fields back, unwritten and with no row (each a
 * dependent whose parent waits for its options: content/loop.ts heldDependents), so they stay pending, and the next scan
 * is no stall: they are planned again in a later pass, after their parent's write or once it is decided. A key whose
 * field is not pending under it is left out. Keys only. Bounded: a parent waits for its options OPTION_WAIT_PASSES
 * scans at most.
 */
export function holdBack(state: LoopState, keys: Iterable<FieldKey>): LoopState {
  const held = [...new Set(keys)].filter((key) => {
    const field = state.fields.get(baseKeyOf(key));
    return field !== undefined && field.key === key && field.present && field.status === 'pending';
  });
  return held.length === 0 ? state : { ...state, heldBack: (state.heldBack ?? 0) + held.length };
}

/** Records the DOM's awaitOptions answer for a waiting list: 'never-loaded' makes it options-never-loaded (it still
 *  recovers if its options change later); 'ready' and 'aborted' change nothing (the next scan sees the options). */
export function recordOptionsWait(state: LoopState, key: FieldKey, verdict: 'ready' | 'never-loaded' | 'aborted'):
  LoopState {
  const baseKey = baseKeyOf(key);
  const field = state.fields.get(baseKey);
  if (verdict !== 'never-loaded' || field === undefined || field.status !== 'waiting-options') return state;
  const fields = new Map(state.fields);
  fields.set(baseKey, { ...field, status: 'unresolvable', reason: 'options-never-loaded' });
  return { ...state, fields };
}

/** The keys of the fields present at the latest scan that await the LLM (Phase 4), in DOM order. */
export function awaitingKeys(state: LoopState): FieldKey[] {
  return presentWith(state.fields, 'awaiting-llm').map((field) => field.key);
}

/**
 * Puts fields that await the LLM back to pending (Phase 4): plan/poll answered that the worker no longer knows them
 * (it restarted, and its memory of the task went with it), so the next pass sends them in plan/request again, where the
 * worker finds the task by its id or TailorIT reattaches it. Not a retry: nothing was written. A key the field no longer
 * has, or a field that does not await, is left alone. Answers the state and the keys put back.
 */
export function requeueAwaiting(state: LoopState, keys: Iterable<FieldKey>): { state: LoopState; requeued: FieldKey[] } {
  const fields = new Map(state.fields);
  const requeued: FieldKey[] = [];
  for (const key of keys) {
    const baseKey = baseKeyOf(key);
    const field = fields.get(baseKey);
    if (field === undefined || field.key !== key || field.status !== 'awaiting-llm') continue;
    fields.set(baseKey, { ...field, status: 'pending', cause: 'new', reason: null });
    requeued.push(key);
  }
  return requeued.length === 0 ? { state, requeued } : { state: { ...state, fields }, requeued };
}

/**
 * Whether the loop is over: nothing pending, waiting or awaiting; the scan after MAX_PASSES planned passes; or a
 * stalled page (not while the LLM is awaited). `cut` ends it now with that reason for what is pending or waiting
 * (page-busy at the settle cap, user-stopped, a pause, a policy notice, a hidden frame): a busy page says nothing yet
 * of a list's options. What is left otherwise: pending fields as max-passes-reached, or internal-error on a stalled
 * page (they were handed out to plan and no row came back), waiting lists as options-never-loaded, unresolvable and
 * stopped fields with their own reasons (a frozen field only once its value is the person's). Before a cut at the
 * settle cap, one more scan (observeScan) gives the fields the busy page revealed or changed meanwhile their
 * page-busy rows.
 */
/** v5 p2-stream: the pass now ending only wrote answers that came in from the AI (no field planned or held back): it
 *  is not counted against MAX_PASSES or MAX_AI_PASSES (MAX_LOOP_PASSES still is). */
export function noteArrivalPass(state: LoopState): LoopState {
  return { ...state, arrivalPasses: (state.arrivalPasses ?? 0) + 1 };
}

export function loopVerdict(state: LoopState, options: { cut?: ReasonCode } = {}): LoopVerdict {
  const pending = presentWith(state.fields, 'pending');
  const waiting = presentWith(state.fields, 'waiting-options');
  const awaiting = presentWith(state.fields, 'awaiting-llm');
  // v5 p2-stream: the passes that only wrote what the AI's stream brought are not counted.
  const counted = state.pass - (state.arrivalPasses ?? 0);
  // s2 core-gh (decision 14): past MAX_PASSES the loop goes on, up to MAX_AI_PASSES, while a field waits for the AI or
  // for its list to be read (a lazy list is read, then classified or answered with its options: one pass each).
  const listRead = (field: TrackedField) => field.cause === 'options-changed'
    && field.row?.reason === 'waiting-for-options';
  const stillComing = awaiting.length > 0 || waiting.length > 0 || pending.some(listRead);
  const end: LoopEnd | null = options.cut !== undefined ? 'cut'
    : pending.length + waiting.length + awaiting.length === 0 ? 'nothing-pending'
      : (counted >= MAX_PASSES && (!stillComing || counted >= MAX_AI_PASSES)) || state.pass >= MAX_LOOP_PASSES
        ? 'max-passes'
        : state.stalled && awaiting.length === 0 ? 'stalled' : null;
  if (end === null) return { done: false, end, unresolved: [] };
  const reasonOf = (field: TrackedField): ReasonCode | null => {
    switch (field.status) {
      case 'pending':
      case 'awaiting-llm':
        if (options.cut !== undefined) return options.cut;
        return end === 'stalled' ? 'internal-error' : 'max-passes-reached';
      case 'waiting-options':
        return options.cut ?? 'options-never-loaded';
      case 'unresolvable':
      case 'oscillating':
      case 'frozen':
        return field.reason;
      default:
        return null;
    }
  };
  const unresolved = [...state.fields.values()].filter((field) => field.present)
    .sort((a, b) => a.domOrder - b.domOrder).flatMap((field) => {
      const reason = reasonOf(field);
      return reason === null ? [] : [{ key: field.key, baseKey: field.baseKey, reason }];
    });
  return { done: true, end, unresolved };
}

/** Earlier runs' edges between these fields, in this run's base keys: stored edges are matched by storedBaseKey. */
function priorPairs(state: LoopState, among: Iterable<BaseKey>): Array<readonly [BaseKey, BaseKey]> {
  if (state.priorEdges.length === 0) return [];
  const byStored = new Map([...among].map((baseKey) => [storedBaseKey(baseKey), baseKey] as const));
  return state.priorEdges.flatMap(([parent, child]) => {
    const from = byStored.get(parent);
    const to = byStored.get(child);
    return from === undefined || to === undefined ? [] : [[from, to] as const];
  });
}

/**
 * The order to write a pass's fields in: DOM order, except that a field another of them is known to reveal or
 * change (this run's edges and earlier runs') comes after it. A cycle is broken at its first field in DOM order.
 */
export function orderPending(state: LoopState, keys: readonly FieldKey[]): FieldKey[] {
  const order = (key: FieldKey) => state.fields.get(baseKeyOf(key))?.domOrder ?? Number.MAX_SAFE_INTEGER;
  const byBase = new Map(keys.map((key) => [baseKeyOf(key), key]));
  const parents = new Map<BaseKey, Set<BaseKey>>();
  const pairs: Array<readonly [BaseKey, BaseKey]> = [...state.edges.map((edge) => [edge.parent, edge.child] as const),
    ...priorPairs(state, byBase.keys())];
  for (const [parent, child] of pairs) {
    if (parent === child || !byBase.has(parent) || !byBase.has(child)) continue;
    parents.set(child, (parents.get(child) ?? new Set<BaseKey>()).add(parent));
  }
  const left = [...byBase.keys()].sort((a, b) => order(byBase.get(a)!) - order(byBase.get(b)!));
  const done = new Set<BaseKey>();
  const out: FieldKey[] = [];
  while (left.length > 0) {
    const free = left.findIndex((base) => [...(parents.get(base) ?? [])].every((parent) => done.has(parent)));
    const [base] = left.splice(free < 0 ? 0 : free, 1);
    done.add(base!);
    out.push(byBase.get(base!)!);
  }
  return out;
}

/** This run's edges, then earlier runs' not found again, as RunState.revealEdges keeps them: unique, keys only with
 *  their sections and label slugs hashed (storedBaseKey), at most MAX_REVEAL_EDGES. */
export function revealEdgesOf(state: LoopState): Array<[BaseKey, BaseKey]> {
  const seen = new Set<string>();
  const out: Array<[BaseKey, BaseKey]> = [];
  const pairs: Array<readonly [BaseKey, BaseKey]> = [...state.edges.filter((edge) => edge.parent !== edge.child)
    .map((edge) => [storedBaseKey(edge.parent), storedBaseKey(edge.child)] as const), ...state.priorEdges];
  for (const [parent, child] of pairs) {
    const id = `${parent}\u001f${child}`;
    if (parent === child || seen.has(id)) continue;
    seen.add(id);
    out.push([parent, child]);
    if (out.length === MAX_REVEAL_EDGES) break;
  }
  return out;
}

/** The fields a field is known to reveal or change (this run's edges and earlier runs'): after writing it, the lists
 *  among them are the ones worth awaiting (awaitOptions). */
export function childrenOf(state: LoopState, parent: BaseKey): BaseKey[] {
  const pairs: Array<readonly [BaseKey, BaseKey]> = [...state.edges.map((edge) => [edge.parent, edge.child] as const),
    ...priorPairs(state, state.fields.keys())];
  return [...new Set(pairs.filter(([from, to]) => from === parent && to !== parent).map(([, child]) => child))];
}
