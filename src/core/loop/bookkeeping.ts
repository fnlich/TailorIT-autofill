/*
 * The reactive loop's bookkeeping (Requirement D; docs/design/core.md §10.1; docs/ARCHITECTURE.md "Orchestrator"). The
 * content script runs the loop, at most MAX_PASSES passes of scan, plan, write and settle; this module keeps its books
 * and decides what each pass plans and when the loop ends. A field's identity is its base key, never a node, so a list
 * whose options change keeps its identity. It is pure, and it never sees a value: the content script hands it each
 * scan's fields (without their current values), each write's keyed value hash (ValueMac) and each pass's settled rows.
 * - Pending: the fields to plan, in DOM order. A field is resolved once it has a row, and is planned again only when
 *   its options change (the same base key with a new option-set hash: its match is dropped and it is matched again,
 *   neither gone nor new), when its value changes after our write (a flip, below the flip limit), when it comes back
 *   after disappearing, or once (MAX_RETRIES) when its write could not happen because the page moved it under us
 *   (element-not-found, options-changed) and the next scan finds it as it was.
 * - Waiting: a list the planner found with no usable options (waiting-for-options) is not planned again until its
 *   options change. It waits at most OPTION_WAIT_PASSES scans, or until the DOM's awaitOptions says they never loaded:
 *   then it is options-never-loaded (recovering if its options still arrive).
 * - Disappeared: a field that was planned or written and is missing from a scan. Its recorded write is dropped, and
 *   its row becomes field-disappeared (rows.ts). A field never planned is dropped silently.
 * - Reveal edges: a field that appears after a pass's writes, or whose options change after them, gets one parent: the
 *   writer the DOM layer attributes it to, else the nearest writer before it in DOM order, else the nearest after it.
 *   An edge is certain when the DOM attributed it or the pass had that one writer. Edges order later passes (parents
 *   first) and go to RunState.revealEdges (keys only, at most MAX_REVEAL_EDGES). A cycle of certain edges stops its
 *   fields (reveal-cycle); a guessed edge never stops a field.
 * - Flips: every change of a written field's value hash after our first write, the page's or our own rewrite, is a
 *   flip. So a page that resets a field after our write makes one flip, our second write another, and its second reset
 *   the third: more than MAX_VALUE_FLIPS, and the field is stopped and flagged (value-oscillated), never written again.
 *   A list whose options change more than MAX_OPTION_CHANGES times is stopped too (options-oscillated), and so is a
 *   field that comes back more than MAX_REAPPEARANCES times (reveal-cycle).
 * - Follow-ups: a choice written with free text (an Other option, or an EEO self-describe option: recordWrite's
 *   followUp) names, at the next scan, the text box its write revealed: the one whose label asks to specify, describe
 *   or explain, or else the only one. The content script types the free text, which it holds in its planned write,
 *   there; the core never holds it. With several such choices in one pass only a certain edge names a box: blank beats
 *   wrong.
 * - The end: nothing pending, waiting or awaiting the LLM; or the scan after MAX_PASSES planned passes; or the same
 *   scan twice in a row with no write between and nothing new to plan (stalled). loopVerdict lists what is left, each
 *   with its reason.
 * LoopState holds value hashes, so it lives in the content script's memory only; revealEdgesOf is what may be stored.
 */
import type { FieldKind } from '../enums';
import { sectionKey } from '../text/keys';
import { keyWithBrackets } from '../text/normalize';
import type { BaseKey, FieldKey, FieldSpec, OptionSetHash } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { ValueMac } from '../types/loop';

/** At most this many passes plan and write; the scan after the last of them only observes. */
export const MAX_PASSES = 8;
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

/** A tracked field's state. 'oscillating' is final: such a field is never planned or written again. */
export const TRACKED_STATUSES = ['pending', 'awaiting-llm', 'waiting-options', 'resolved', 'unresolvable',
  'disappeared', 'oscillating'] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

/** Why a field is pending. */
export const PENDING_CAUSES = ['new', 'reappeared', 'options-changed', 'value-changed', 'retry'] as const;
export type PendingCause = (typeof PENDING_CAUSES)[number];

/** How the loop ended: nothing left to do, the passes ran out, the page stopped changing, or the content script cut it
 *  short (the settle cap, the person's Cancel). */
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
  /** Why it is unresolvable, oscillating or disappeared, or its row's reason once resolved. */
  reason: ReasonCode | null;
  /** The latest row recorded for it (value-free). */
  row: FillResult | null;
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
}

/** "Filling parent revealed child" ('revealed'), or "changed child's options" ('options'). */
export interface RevealEdge {
  parent: BaseKey;
  child: BaseKey;
  /** The DOM layer attributed it, or the pass had this one writer. */
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
  /** Earlier runs' edges (RunState.revealEdges): they order passes, and never stop a field. */
  priorEdges: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  /** The fields written since the latest scan, in write order. */
  writers: readonly BaseKey[];
  /** The latest scan's keys, sorted. */
  signature: string | null;
  /** The latest scan repeated the one before it (the same keys), with no write between and nothing new to plan. */
  stalled: boolean;
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
  /** Type the free text of `parent`'s choice (Other, self-describe) into `child`. */
  | { type: 'follow-up-found'; parent: FieldKey; child: FieldKey; certain: boolean };

/** What a scan adds besides its fields. */
export interface ScanInput {
  /** The keyed hash of each field's value now, by base key: at least every field we wrote. In memory only. */
  valueMacs?: ReadonlyMap<BaseKey, ValueMac>;
  /** The DOM layer's exact "this field followed that write" pairs, child to parent, when it has them. */
  attribution?: ReadonlyMap<BaseKey, BaseKey>;
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

/** A field the loop will never plan or write again. */
export function isStopped(field: TrackedField): boolean {
  return field.status === 'oscillating';
}

/** A text box that asks for a choice's free text, by its label's words. */
export function isFollowUpLabel(label: string): boolean {
  return FOLLOW_UP_LABEL.test(keyWithBrackets(label, 'label'));
}

/** A loop with no scan yet. `revealEdges` are earlier runs' (RunState.revealEdges), for ordering. */
export function createLoop(prior: { revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]> } = {}): LoopState {
  return { pass: -1, fields: new Map(), edges: [], priorEdges: (prior.revealEdges ?? []).slice(0, MAX_REVEAL_EDGES),
    writers: [], signature: null, stalled: false };
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
 *  the last writer. Certain when attributed, or when the pass had this one writer. */
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
    return parent === null ? null : { parent, certain: writers.length === 1 };
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

/** Folds one scan in: new, returning, changed and missing fields, flips, reveal edges, cycles and follow-ups. `scanned`
 *  is the scan's fields (FieldSpecs will do); the first scan is pass 0. */
export function observeScan(state: LoopState, scanned: readonly LoopField[], input: ScanInput = {}): ScanObservation {
  const pass = state.pass + 1;
  const macs = input.valueMacs ?? new Map<BaseKey, ValueMac>();
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
        reason: null, row: null, wrote: false, valueMac: null, flips: 0, optionChanges: 0, waitedScans: 0, retries: 0,
        appearances: 1, revealedBy: parent?.parent ?? null, revealCertain: parent?.certain ?? false, followUp: false });
      if (pass > 0) {
        events.push({ type: 'field-appeared', key: spec.key, baseKey: spec.baseKey, revealedBy: parent?.parent ?? null,
          certain: parent?.certain ?? false, again: false });
      }
      continue;
    }
    if (isStopped(old)) {
      fields.set(spec.baseKey, { ...old, ...now });
      continue;
    }
    if (!old.present) {
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
    if (spec.optionSetHash !== old.optionSetHash) {
      edgeFor(spec.baseKey, spec.domOrder, 'options');
      const optionChanges = old.optionChanges + 1;
      // Matched anew, as a new question: a value lost with the old options is no flip, and the next write is a first.
      const changed = { ...old, ...now, optionChanges, wrote: false, valueMac: null, followUp: false, retries: 0,
        waitedScans: 0 };
      if (optionChanges > MAX_OPTION_CHANGES) {
        fields.set(spec.baseKey, { ...changed, status: 'oscillating', cause: null, reason: 'options-oscillated' });
        events.push({ type: 'oscillating', key: spec.key, baseKey: spec.baseKey, reason: 'options-oscillated' });
      } else {
        fields.set(spec.baseKey, { ...changed, status: 'pending', cause: 'options-changed', reason: null });
        events.push({ type: 'options-changed', baseKey: spec.baseKey, from: old.key, to: spec.key });
      }
      continue;
    }
    let field: TrackedField = { ...old, ...now };
    const mac = macs.get(spec.baseKey);
    if (old.wrote && mac !== undefined && old.valueMac === null) field = { ...field, valueMac: mac };
    if (old.wrote && mac !== undefined && old.valueMac !== null && mac !== old.valueMac) {
      const flips = old.flips + 1;
      field = { ...field, valueMac: mac, flips };
      if (flips > MAX_VALUE_FLIPS) {
        field = { ...field, status: 'oscillating', cause: null, reason: 'value-oscillated' };
        events.push({ type: 'oscillating', key: spec.key, baseKey: spec.baseKey, reason: 'value-oscillated' });
      } else {
        field = { ...field, status: 'pending', cause: 'value-changed', reason: null };
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
    }
    fields.set(spec.baseKey, field);
  }

  for (const [baseKey, old] of state.fields) {
    if (seen.has(baseKey) || !old.present) continue;
    if (isStopped(old)) {
      fields.set(baseKey, { ...old, present: false });
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

  // Follow-ups: the box a choice's write revealed takes its free text.
  const askers = [...state.fields.values()].filter((field) => field.followUp && fields.get(field.baseKey)?.present);
  for (const asker of askers) {
    const boxes = added.filter((edge) => edge.kind === 'revealed' && edge.parent === asker.baseKey).flatMap((edge) => {
      const child = fields.get(edge.child);
      return child !== undefined && child.present && child.status === 'pending' && TEXT_KINDS.has(child.kind)
        ? [{ child, certain: edge.certain }] : [];
    });
    const asking = boxes.filter((box) => isFollowUpLabel(box.child.label));
    const chosen = asking.length === 1 ? asking[0]! : asking.length === 0 && boxes.length === 1 ? boxes[0]! : null;
    if (chosen === null || (!chosen.certain && askers.length > 1)) continue;
    events.push({ type: 'follow-up-found', parent: fields.get(asker.baseKey)!.key, child: chosen.child.key,
      certain: chosen.certain });
  }
  // A choice's box shows at the scan after its write, or not at all.
  for (const [baseKey, field] of state.fields) {
    if (field.followUp) fields.set(baseKey, { ...fields.get(baseKey)!, followUp: false });
  }

  // Stalled: the page shows what it showed, nothing was written since, and this scan gave nothing new to plan.
  const signature = signatureOf(seen);
  const newlyPending = [...fields].some(([baseKey, field]) => field.status === 'pending'
    && state.fields.get(baseKey)?.status !== 'pending');
  const next: LoopState = { pass, fields, edges, priorEdges: state.priorEdges, writers: [], signature,
    stalled: pass > 0 && state.writers.length === 0 && signature === state.signature && !newlyPending };
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
 * the row of the write that put it there stays.
 */
export function recordRows(state: LoopState, rows: Iterable<FillResult>, options: { awaiting?: Iterable<FieldKey> } = {}):
  LoopState {
  const awaiting = new Set(options.awaiting ?? []);
  const fields = new Map(state.fields);
  for (const row of rows) {
    const baseKey = baseKeyOf(row.key);
    const field = fields.get(baseKey);
    if (field === undefined || field.key !== row.key) continue;
    const ours = field.wrote && field.row?.wrote === true && row.status === 'skipped' && row.reason === 'already-correct';
    const kept = ours ? field.row! : row;
    if (isStopped(field) || field.status === 'disappeared') {
      fields.set(baseKey, { ...field, row: kept });
    } else if (awaiting.has(row.key)) {
      fields.set(baseKey, { ...field, row: kept, status: 'awaiting-llm', cause: null, reason: kept.reason });
    } else if (kept.reason === 'waiting-for-options') {
      fields.set(baseKey, { ...field, row: kept, status: 'waiting-options', cause: null, reason: kept.reason,
        waitedScans: field.status === 'waiting-options' ? field.waitedScans : 0 });
    } else {
      fields.set(baseKey, { ...field, row: kept, status: 'resolved', cause: null, reason: kept.reason });
    }
  }
  return { ...state, fields };
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

/**
 * Whether the loop is over: nothing pending, waiting or awaiting; the scan after MAX_PASSES planned passes; or a
 * stalled page (not while the LLM is awaited). `cut` ends it now with that reason for what is pending or waiting
 * (page-busy at the settle cap, user-stopped): a busy page says nothing yet of a list's options. What is left
 * otherwise: pending fields as max-passes-reached, or internal-error on a stalled page (they were handed out to plan
 * and no row came back), waiting lists as options-never-loaded, unresolvable and stopped fields with their own reasons.
 * Before a cut at the settle cap, one more scan (observeScan) gives the fields the busy page revealed or changed
 * meanwhile their page-busy rows.
 */
export function loopVerdict(state: LoopState, options: { cut?: ReasonCode } = {}): LoopVerdict {
  const pending = presentWith(state.fields, 'pending');
  const waiting = presentWith(state.fields, 'waiting-options');
  const awaiting = presentWith(state.fields, 'awaiting-llm');
  const end: LoopEnd | null = options.cut !== undefined ? 'cut'
    : pending.length + waiting.length + awaiting.length === 0 ? 'nothing-pending'
      : state.pass >= MAX_PASSES ? 'max-passes'
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

/**
 * The order to write a pass's fields in: DOM order, except that a field another of them is known to reveal or
 * change (this run's edges and earlier runs') comes after it. A cycle is broken at its first field in DOM order.
 */
export function orderPending(state: LoopState, keys: readonly FieldKey[]): FieldKey[] {
  const order = (key: FieldKey) => state.fields.get(baseKeyOf(key))?.domOrder ?? Number.MAX_SAFE_INTEGER;
  const byBase = new Map(keys.map((key) => [baseKeyOf(key), key]));
  const parents = new Map<BaseKey, Set<BaseKey>>();
  const pairs: Array<readonly [BaseKey, BaseKey]> = [...state.edges.map((edge) => [edge.parent, edge.child] as const),
    ...state.priorEdges];
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

/** This run's edges, then earlier runs' not found again, as RunState.revealEdges keeps them: unique, keys only, at
 *  most MAX_REVEAL_EDGES. */
export function revealEdgesOf(state: LoopState): Array<[BaseKey, BaseKey]> {
  const seen = new Set<string>();
  const out: Array<[BaseKey, BaseKey]> = [];
  const pairs: Array<readonly [BaseKey, BaseKey]> = [...state.edges.map((edge) => [edge.parent, edge.child] as const),
    ...state.priorEdges];
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
    ...state.priorEdges];
  return [...new Set(pairs.filter(([from, to]) => from === parent && to !== parent).map(([, child]) => child))];
}
