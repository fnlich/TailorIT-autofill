/*
 * Repeatable sections on the content side (docs/SPEC.md Requirement C: "compare profile entry count to rendered blocks,
 * click Add until they match, then fill by block index. Handle 'I currently work here' (disables the end date)";
 * docs/ARCHITECTURE.md "Repeatable sections"; docs/design/core.md §10.2). The worker holds the profile, so the frame
 * works from counts: the plan answer's entry count per section (plan/request's repeatables), the blocks the adapter
 * shows, and RunState's counters.
 * - The sections are the adapter's repeatables on the step, each kind once (the first the adapter names).
 * - Adds (addBlocks), before the step's reactive loop: planAdd decides from the counts; the Add button must be visible
 *   and pass assertNotSubmit before its click is counted, and the counters (the REPEATABLE event, stored before the
 *   click) never let the clicks on a step pass the profile's count, across reloads too (s2 wd: but the first plan of a
 *   section in a new document that shows fewer blocks than were counted starts the count again, planAdd's
 *   newDocument: the reload dropped them). Once counted, the button is
 *   checked again at the click itself (still the adapter's Add, connected, shown, enabled, clickIfAllowed), with
 *   nothing awaited between, and a click not made is uncounted (the Phase 5 review, X-S3). An Add that is, holds or
 *   sits in the adapter's Next or Submit is never clicked (X-S7). One untrusted click() at a
 *   time, settled after each; a click that added no block stops the adding. A typeless button inside a form is a
 *   submit button: it is never clicked, and the entries left without a block are the person's to add
 *   (needs-your-click, the needs-click notice). No Add is ever a field, so it has no row (FIELD_KINDS has no button).
 * - "I currently work here" (currentJobRows), after the loop: the plan ticks the box of a current job (the resolver's
 *   check), and its end date is never written; planCurrentJob then gives the box and the end date the rows the page
 *   left them with (an end date the page disabled is skipped, end-date-not-applicable; one the page still holds or
 *   requires is flagged). A row of our own write is never replaced. The loop writes a block's box before its end date
 *   (boxBeforeEndDate).
 * - Save (saveBlocks), after the step's fill and its final Guard, never in a dry run: a block whose page keeps its
 *   entry only once its own Save is pressed (the adapter's save: Workable's editors, "Update") has it pressed, one
 *   untrusted click() through clickIfAllowed, settled after, only when (the Phase 7a review) the run opened that block
 *   or found it empty when the step began, the person touched nothing in it, and its rows are ready (rowsReadyToSave:
 *   each verified or skipped with nothing asked of the person, none the person changed, one at least holding our
 *   value, written or already right). A block left so (the click refused, or the page still showing its Save after
 *   the settle: it refused the entry) is the person's to finish (the needs-click notice).
 * - Rounds (the orchestrator's fill step): an Add the page disables while an editor is open adds one block at a time,
 *   so the step adds, fills and saves again while a section kept by its own Save still lacks an entry and shows its
 *   Add (moreToAdd), at most as many rounds as the profile has entries; an entry still without a block is the person's
 *   to add (entriesLeft), which holds Submit mode Auto. A saved entry is a block of its own, which shows its summary
 *   and no field: the adapter reads its words (savedSummaries, Adapter.prefill.readEntries) for the plan request, so
 *   the worker finds the entry it holds by its fingerprint and never fills that entry into a new block.
 * Nothing here sends or logs a value: counts, indices, flags and the page's own disabled and checked states; a saved
 * entry's words go only to the worker's plan, as a field's current value does.
 */
import type { Adapter } from '../adapters/types';
import { planAdd, planCurrentJob, type AddStop } from '../core/steps/repeatable';
import { SHOWN_CATEGORIES, type RepeatableAnswer, type ShownBlock, type ShownCategory } from '../core/steps/blocks';
import { sectionKey } from '../core/text/keys';
import type { FieldKey } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import { MAX_REPEATABLE_BLOCKS, REPEATABLE_KINDS, type RepeatableCounter, type RepeatableKind }
  from '../core/types/run';
import { assertNotSubmit, clickIfAllowed } from '../dom/fillers';
import { datePartsValue } from '../dom/fillers/date-parts';
import { newScanCache } from '../dom/scan-cache';
import { settle, type SettleOptions } from '../dom/settle';
import type { ScanResult } from '../dom/types';
import { isUserVisible } from '../dom/visibility';

/** A repeatable section as the adapter shows it on the step. */
export interface SectionView {
  kind: RepeatableKind;
  blocks(): Element[];
  addButton(): HTMLElement | null;
  currentlyHere?(block: Element): HTMLInputElement | null;
  /** The block's own Save (Adapter.repeatables' save: Workable's "Update"); null for a block that shows none. */
  save?(block: Element): HTMLElement | null;
}

const KINDS: ReadonlySet<string> = new Set<string>(REPEATABLE_KINDS);

/** The adapter's repeatable sections on the step, each kind once; none when it declares none or its hook fails. */
export function sectionsOf(adapter: Adapter, root: Element): SectionView[] {
  let declared: ReturnType<NonNullable<Adapter['repeatables']>>;
  try {
    declared = adapter.repeatables?.(root) ?? [];
  } catch {
    return [];
  }
  const seen = new Set<RepeatableKind>();
  return declared.filter((section) => {
    if (!KINDS.has(section.kind) || seen.has(section.kind)) return false;
    seen.add(section.kind);
    return true;
  });
}

/** The section's blocks that show a saved entry's summary, as the adapter reads them (Adapter.prefill.readEntries),
 *  kept to the bounds the plan request takes; none when it reads none or its hook fails. */
export function savedSummaries(adapter: Adapter, section: SectionView):
  Array<{ block: number; values: Array<{ category: ShownCategory; text: string }> }> {
  let read: readonly ShownBlock[];
  try {
    read = adapter.prefill?.readEntries?.(section.kind, section.blocks()) ?? [];
  } catch {
    return [];
  }
  const allowed: ReadonlySet<string> = new Set<string>(SHOWN_CATEGORIES);
  return read.flatMap((summary) => {
    if (!Number.isInteger(summary.block) || summary.block < 0 || summary.block >= MAX_REPEATABLE_BLOCKS) return [];
    const values = summary.values.filter((value) => allowed.has(value.category) && value.text.trim() !== '')
      .slice(0, SHOWN_CATEGORIES.length)
      .map((value) => ({ category: value.category, text: value.text.trim().slice(0, 300) }));
    return values.length === 0 ? [] : [{ block: summary.block, values }];
  }).slice(0, MAX_REPEATABLE_BLOCKS);
}

/** How one section's adding ended. */
export interface AddOutcome {
  kind: RepeatableKind;
  /** The counters as last stored. */
  counter: RepeatableCounter;
  /** The Add clicks made now. */
  clicks: number;
  stop: AddStop | 'add-refused' | 'page-busy' | 'stopped';
  /** Entries left without a block: the person adds them (needs-your-click). */
  missing: number;
  /** The blocks the clicks made now (in the page when the adding ended). */
  opened: Element[];
}

/** What the adds need from the run. */
export interface AddEnv {
  adapter: Adapter;
  root: Element;
  signal: AbortSignal;
  settle?: Pick<SettleOptions, 'quietMs' | 'capMs' | 'optionsCapMs'>;
  /** The profile's entries of each section the worker counted (its plan answer). */
  profile: ReadonlyMap<RepeatableKind, number>;
  /** The step's counters as RunState holds them now (repeatableCounters, by kind). */
  prior(kind: RepeatableKind): RepeatableCounter | null;
  /** Stores the counters before a click is made, and after the last (the REPEATABLE event, then runstate/put). */
  record(kind: RepeatableKind, counter: RepeatableCounter): Promise<void>;
  /** Whether the person stopped the run. */
  stopped(): boolean;
}

/** Whether an Add button is there for a click: shown, and not disabled. */
function clickable(button: HTMLElement | null): button is HTMLElement {
  return button !== null && isUserVisible(button, newScanCache()) && (button as HTMLButtonElement).disabled !== true;
}

/** The one untrusted click on a section's Add, decided where it is made: still the adapter's Add, in the page, shown,
 *  enabled, and allowed by assertNotSubmit (clickIfAllowed: never Submit, never the step's Next). */
function clickNow(button: HTMLElement, section: SectionView, env: AddEnv): boolean {
  let now: HTMLElement | null;
  try {
    now = section.addButton();
  } catch {
    return false;
  }
  if (!button.isConnected || now !== button || !clickable(button)) return false;
  return clickIfAllowed(button, { adapter: env.adapter, root: env.root });
}

/** s2 wd: the sections whose adds this document has planned already, by kind: the first plan of a kind in a document is
 *  a new document's (planAdd's newDocument: a reload that dropped the blocks the counted clicks added). */
const PLANNED_IN = new WeakMap<Document, Set<RepeatableKind>>();

/** Whether this is the first plan of `kind`'s adds in `doc`, marking it planned. */
function firstPlanIn(doc: Document, kind: RepeatableKind): boolean {
  const planned = PLANNED_IN.get(doc) ?? new Set<RepeatableKind>();
  PLANNED_IN.set(doc, planned);
  if (planned.has(kind)) return false;
  planned.add(kind);
  return true;
}

/** Clicks each section's Add until every entry has a block, one click at a time (module header). */
export async function addBlocks(env: AddEnv, sections: readonly SectionView[]): Promise<AddOutcome[]> {
  const outcomes: AddOutcome[] = [];
  for (const section of sections) {
    const profile = env.profile.get(section.kind);
    if (profile === undefined) continue;
    let clicks = 0;
    let afterClick = false;
    const before = new Set(section.blocks());
    const opened = () => section.blocks().filter((block) => !before.has(block));
    const newDocument = firstPlanIn(env.root.ownerDocument, section.kind);
    for (;;) {
      const button = section.addButton();
      const rendered = section.blocks().length;
      const shown = clickable(button);
      const plan = planAdd({ profile, rendered, prior: env.prior(section.kind), afterClick, addButton: shown,
        newDocument: newDocument && clicks === 0 });
      const missing = Math.max(0, profile - rendered);
      if (!plan.add) {
        await env.record(section.kind, plan.counter);
        outcomes.push({ kind: section.kind, counter: plan.counter, clicks, stop: plan.stop ?? 'complete', missing,
          opened: opened() });
        break;
      }
      // The click must be one we may make before it is counted: a typeless button inside a form submits it.
      const counted = plan.counter;
      if (button === null || !shown || !assertNotSubmit(button, { adapter: env.adapter, root: env.root }).ok) {
        const unclicked = { ...counted, addClicks: Math.max(0, counted.addClicks - 1) };
        await env.record(section.kind, unclicked);
        outcomes.push({ kind: section.kind, counter: unclicked, clicks, stop: 'add-refused', missing,
          opened: opened() });
        break;
      }
      await env.record(section.kind, counted);
      if (env.stopped() || env.signal.aborted) {
        outcomes.push({ kind: section.kind, counter: counted, clicks, stop: 'stopped', missing,
          opened: opened() });
        break;
      }
      // The page had the record's round trip to change the button: it is checked again at the click itself, with
      // nothing awaited between (the Phase 5 review, X-S3), and a click not made is uncounted after.
      if (!clickNow(button, section, env)) {
        const unclicked = { ...counted, addClicks: Math.max(0, counted.addClicks - 1) };
        await env.record(section.kind, unclicked);
        outcomes.push({ kind: section.kind, counter: unclicked, clicks, stop: 'add-refused', missing,
          opened: opened() });
        break;
      }
      clicks += 1;
      afterClick = true;
      const settled = await settle(env.root, { adapter: env.adapter, signal: env.signal, ...env.settle });
      if (!settled.settled && settled.reason === 'aborted') return outcomes;
      if (!settled.settled) {
        const now = section.blocks().length;
        const busy = { ...counted, rendered: now };
        await env.record(section.kind, busy);
        outcomes.push({ kind: section.kind, counter: busy, clicks, stop: 'page-busy',
          missing: Math.max(0, profile - now), opened: opened() });
        break;
      }
    }
  }
  return outcomes;
}

/** What the saves need from the run. */
export interface SaveEnv {
  adapter: Adapter;
  root: Element;
  signal: AbortSignal;
  settle?: Pick<SettleOptions, 'quietMs' | 'capMs' | 'optionsCapMs'>;
  /** Whether the block's Save may be pressed at all: the run opened it (an Add of its own), or it was empty when the
   *  step began. An editor the person opened and typed into is theirs to save. */
  ours(block: Element): boolean;
  /** Whether the person edited anything in the block since the step began (the touch log's edits). */
  touched(block: Element): boolean;
}

/** How the saves went: the blocks saved (their section keys, sectionKey: "education[0]"), whose fields the page then
 *  folds away, and the number left for the person (their editor still open). */
export interface SaveOutcome {
  saved: string[];
  left: number;
}

/** Whether a block's rows let its Save be pressed (module header): each verified or skipped with nothing asked of the
 *  person, none the person changed, and one at least holding our value (written and verified, or already right). */
export function rowsReadyToSave(own: readonly FillResult[]): boolean {
  const clean = own.every((row) => (row.status === 'verified' || (row.status === 'skipped' && !row.needsUserAction))
    && row.reason !== 'changed-by-you' && row.detail?.userEdited !== true && row.detail?.filledByYou !== true);
  const ours = own.some((row) => (row.wrote && row.verification === 'verified') || row.reason === 'already-correct');
  return clean && ours;
}

/** Presses each filled block's own Save (module header), one block at a time, settled after each. `rows` are the
 *  step's rows. */
export async function saveBlocks(env: SaveEnv, sections: readonly SectionView[], rows: readonly FillResult[]):
  Promise<SaveOutcome> {
  const outcome: SaveOutcome = { saved: [], left: 0 };
  for (const section of sections) {
    if (section.save === undefined) continue;
    const blocks = section.blocks();
    for (const [index, block] of blocks.entries()) {
      if (env.signal.aborted) return outcome;
      let button: HTMLElement | null;
      try {
        button = section.save(block);
      } catch {
        button = null;
      }
      if (button === null) continue;
      const name = sectionKey({ id: section.kind, block: index });
      const own = rows.filter((row) => row.section === name);
      if (!env.ours(block) || env.touched(block) || !rowsReadyToSave(own) || !clickable(button)
        || !clickIfAllowed(button, { adapter: env.adapter, root: env.root })) {
        outcome.left += 1;
        continue;
      }
      const settled = await settle(env.root, { adapter: env.adapter, signal: env.signal, ...env.settle });
      if (!settled.settled && settled.reason === 'aborted') return outcome;
      let still: HTMLElement | null;
      try {
        still = block.isConnected ? section.save(block) : null;
      } catch {
        still = null;
      }
      if (still !== null && still.isConnected) outcome.left += 1;
      else outcome.saved.push(name);
    }
  }
  return outcome;
}

/** Whether a section whose entries are kept by their own Save still has an entry to add and its Add to add it with:
 *  the next round of add, fill and save (the orchestrator's fill step). */
export function moreToAdd(sections: readonly SectionView[], profile: ReadonlyMap<RepeatableKind, number>): boolean {
  return sections.some((section) => {
    if (section.save === undefined) return false;
    let button: HTMLElement | null;
    try {
      button = section.addButton();
    } catch {
      return false;
    }
    return (profile.get(section.kind) ?? 0) > section.blocks().length && clickable(button);
  });
}

/** The entries the profile has that no block of a section kept by its own Save holds: the person's to add. */
export function entriesLeft(sections: readonly SectionView[], profile: ReadonlyMap<RepeatableKind, number>): number {
  return sections.filter((section) => section.save !== undefined)
    .reduce((left, section) => left + Math.max(0, (profile.get(section.kind) ?? 0) - section.blocks().length), 0);
}

/** The sections whose entries are left for the person to add. */
export function needsClicks(outcomes: readonly AddOutcome[]): number {
  return outcomes.filter((outcome) => outcome.missing > 0 && outcome.stop !== 'page-busy' && outcome.stop !== 'stopped')
    .length;
}

// ── "I currently work here" ─────────────────────────────────────────────────────────────────────────────────────

/** The rows' order of writes with a block's "I currently work here" tick before its end date (planCurrentJob's
 *  order): each box write moves before the first end-date write of its block. */
export function boxBeforeEndDate<T extends { write: PlannedWrite; planned: FillResult }>(queue: readonly T[]): T[] {
  const ordered = [...queue];
  for (const box of queue.filter((item) => item.planned.category === 'experience.current' && item.write.value.kind === 'check')) {
    const at = ordered.indexOf(box);
    const end = ordered.findIndex((item) => item.planned.category === 'experience.endDate'
      && item.planned.section === box.planned.section);
    if (end >= 0 && end < at) {
      ordered.splice(at, 1);
      ordered.splice(end, 0, box);
    }
  }
  return ordered;
}

/** The queue with its file writes moved after every other write, each kind keeping its order (Adapter.quirks.filesLast:
 *  a page whose failed upload takes the form down keeps the rest of the fill). */
export function filesAfterTheRest<T extends { write: PlannedWrite }>(queue: readonly T[]): T[] {
  const file = (item: T) => item.write.value.kind === 'file';
  return [...queue.filter((item) => !file(item)), ...queue.filter(file)];
}

/** A row nothing of ours was written for, as planCurrentJob leaves it. */
function leftRow(row: FillResult, status: 'skipped' | 'flagged', reason: ReasonCode): FillResult {
  return { ...row, status, reason, provenance: null, wrote: false, verification: 'not-applicable',
    needsUserAction: status === 'flagged' };
}

/**
 * The rows of each position's "I currently work here" box and end date after the loop, as planCurrentJob reads the
 * page now (module header). `current` is the plan answer's flag for each block's entry; a block without one is left
 * alone, and so is a row of our own write.
 */
export function currentJobRows(rows: ReadonlyMap<FieldKey, FillResult>, scan: ScanResult, section: SectionView,
  answer: RepeatableAnswer | undefined): Map<FieldKey, FillResult> {
  const out = new Map(rows);
  if (section.kind !== 'experience' || answer === undefined || section.currentlyHere === undefined) return out;
  section.blocks().forEach((block, index) => {
    const current = answer.current[index];
    if (current === undefined || answer.entries[index] === null) return;
    const box = section.currentlyHere!(block);
    const name = sectionKey({ id: 'experience', block: index });
    const end = [...out.values()].find((row) => row.section === name && row.category === 'experience.endDate');
    const endTarget = end === undefined ? null : scan.target(end.key);
    const endControl = endTarget?.control as HTMLInputElement | undefined;
    // s2 wd: an end date drawn in parts (Workday's) holds what its parts' displays show, disabled as its scan says.
    const endState = endControl === undefined ? 'absent' : endTarget?.dateParts !== undefined
      ? endTarget.field.disabled ? 'disabled' : datePartsValue(endTarget.dateParts).kind === 'empty' ? 'empty' : 'filled'
      : endControl.disabled ? 'disabled' : endControl.value.trim() === '' ? 'empty' : 'filled';
    const plan = planCurrentJob({ current, box: box === null ? 'absent' : box.checked ? 'checked' : 'unchecked',
      endDate: endState, endDateRequired: endTarget?.field.required ?? false });
    const boxRow = box === null ? undefined : [...out.values()].find((row) => row.section === name
      && scan.target(row.key)?.control === box);
    if (plan.box !== null && boxRow !== undefined && !boxRow.wrote) {
      out.set(boxRow.key, leftRow(boxRow, plan.box.status, plan.box.reason));
    }
    if (end !== undefined && !end.wrote && plan.endDate !== null && typeof plan.endDate === 'object') {
      out.set(end.key, leftRow(end, plan.endDate.status, plan.endDate.reason));
    }
  });
  return out;
}
