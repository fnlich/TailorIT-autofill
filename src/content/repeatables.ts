/*
 * Repeatable sections on the content side (docs/SPEC.md Requirement C: "compare profile entry count to rendered blocks,
 * click Add until they match, then fill by block index. Handle 'I currently work here' (disables the end date)";
 * docs/ARCHITECTURE.md "Repeatable sections"; docs/design/core.md §10.2). The worker holds the profile, so the frame
 * works from counts: the plan answer's entry count per section (plan/request's repeatables), the blocks the adapter
 * shows, and RunState's counters.
 * - The sections are the adapter's repeatables on the step, each kind once (the first the adapter names).
 * - Adds (addBlocks), before the step's reactive loop: planAdd decides from the counts; the Add button must be visible
 *   and pass assertNotSubmit before its click is counted, and the counters (the REPEATABLE event, stored before the
 *   click) never let the clicks on a step pass the profile's count, across reloads too. Once counted, the button is
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
 * Nothing here reads, sends or logs a value: counts, indices, flags and the page's own disabled and checked states.
 */
import type { Adapter } from '../adapters/types';
import { planAdd, planCurrentJob, type AddStop } from '../core/steps/repeatable';
import type { RepeatableAnswer } from '../core/steps/blocks';
import { sectionKey } from '../core/text/keys';
import type { FieldKey } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import { REPEATABLE_KINDS, type RepeatableCounter, type RepeatableKind } from '../core/types/run';
import { assertNotSubmit, clickIfAllowed } from '../dom/fillers';
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

/** Clicks each section's Add until every entry has a block, one click at a time (module header). */
export async function addBlocks(env: AddEnv, sections: readonly SectionView[]): Promise<AddOutcome[]> {
  const outcomes: AddOutcome[] = [];
  for (const section of sections) {
    const profile = env.profile.get(section.kind);
    if (profile === undefined) continue;
    let clicks = 0;
    let afterClick = false;
    for (;;) {
      const button = section.addButton();
      const rendered = section.blocks().length;
      const shown = clickable(button);
      const plan = planAdd({ profile, rendered, prior: env.prior(section.kind), afterClick, addButton: shown });
      const missing = Math.max(0, profile - rendered);
      if (!plan.add) {
        await env.record(section.kind, plan.counter);
        outcomes.push({ kind: section.kind, counter: plan.counter, clicks, stop: plan.stop ?? 'complete', missing });
        break;
      }
      // The click must be one we may make before it is counted: a typeless button inside a form submits it.
      const counted = plan.counter;
      if (button === null || !shown || !assertNotSubmit(button, { adapter: env.adapter, root: env.root }).ok) {
        const unclicked = { ...counted, addClicks: Math.max(0, counted.addClicks - 1) };
        await env.record(section.kind, unclicked);
        outcomes.push({ kind: section.kind, counter: unclicked, clicks, stop: 'add-refused', missing });
        break;
      }
      await env.record(section.kind, counted);
      if (env.stopped() || env.signal.aborted) {
        outcomes.push({ kind: section.kind, counter: counted, clicks, stop: 'stopped', missing });
        break;
      }
      // The page had the record's round trip to change the button: it is checked again at the click itself, with
      // nothing awaited between (the Phase 5 review, X-S3), and a click not made is uncounted after.
      if (!clickNow(button, section, env)) {
        const unclicked = { ...counted, addClicks: Math.max(0, counted.addClicks - 1) };
        await env.record(section.kind, unclicked);
        outcomes.push({ kind: section.kind, counter: unclicked, clicks, stop: 'add-refused', missing });
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
        outcomes.push({ kind: section.kind, counter: busy, clicks, stop: 'page-busy', missing: Math.max(0, profile - now) });
        break;
      }
    }
  }
  return outcomes;
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
    const endState = endControl === undefined ? 'absent' : endControl.disabled ? 'disabled'
      : endControl.value.trim() === '' ? 'empty' : 'filled';
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
