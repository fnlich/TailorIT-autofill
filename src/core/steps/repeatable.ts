/*
 * Repeatable sections: work experience, education, languages (Requirement C; docs/ARCHITECTURE.md "Repeatable
 * sections"; docs/design/runtime.md §8.6 and §8.7). The adapter names each section's blocks and its Add button
 * (adapters/types.ts repeatables); this plans what to do with them, from counts and fingerprints only.
 * - Entries to blocks (assignEntries): a block the site prefilled (a resume parse, "Use my last application") is matched
 *   to the profile entry it names by fingerprint, first where both name a detail (a start year, a degree level) and it
 *   agrees, then where either lacks one; every other entry takes the next block left, in page order, its prefill (if
 *   any) reconciled field by field (prefill.ts: the profile wins, flagged). So a block that already holds an entry is
 *   reused, never added again: nothing is duplicated. Blocks no entry takes are reported, never deleted or cleared.
 * - Add clicks (planAdd): one at a time, settling after each, until every entry has a block. Each click is counted
 *   (RunState.repeatableCounters, through the REPEATABLE event) before it is made, so across reloads the clicks on a
 *   step never pass the profile's count; a click that added no block is the page ignoring our click (the person's
 *   click, needs-your-click), never retried.
 * - "I currently work here" (planCurrentJob): the box is ticked before anything else happens to the end date, which is
 *   decided only on the scan after the tick has settled; the end date of a current job is never written (skipped when
 *   the page disabled it), and a box the page ticked for a past job is never unticked.
 * Fingerprints are hashes of normalized names, built where both the profile and the page's prefilled values are in
 * memory (the worker: plan/request carries each field's current value). They are never stored, sent or logged; a plan
 * holds indices and counts only.
 */
import type { DegreeLevel } from '../enums';
import { fold } from '../text/fold';
import { keyWithBrackets } from '../text/normalize';
import { sha256Hex } from '../text/sha256';
import type { CurrentValue } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory } from '../types/intent';
import type { ExperienceEntry } from '../types/profile';
import type { RepeatableCounter, RepeatableKind } from '../types/run';

/** A profile entry's fingerprint: the hashes of its names (any may match), and a detail that tells two entries with
 *  one name apart (an experience's start year, a school's degree level); null when unknown. */
export interface EntryPrint {
  ids: readonly string[];
  detail: string | null;
}

/** A prefilled block's fingerprint: the hash of the name it holds, and its detail when it shows one. */
export interface BlockPrint {
  id: string;
  detail: string | null;
}

/** A rendered block, as the plan sees it. */
export interface RepeatableBlock {
  /** Its place among the section's blocks (FieldSpec.section.block). */
  index: number;
  /** The entry its prefilled fields name (blockPrint); null when they name none. */
  print: BlockPrint | null;
  /** None of its fields holds anything (isBlockEmpty). */
  empty: boolean;
}

/** Where one profile entry is filled. */
export interface EntryAssignment {
  /** The entry's index in the profile's list. */
  entry: number;
  /** The block it is filled into; null until one is added. */
  block: number | null;
  /** 'fingerprint': the block already holds this entry; 'order': the next block left (its prefill reconciled field
   *  by field); null: no block yet. */
  by: 'fingerprint' | 'order' | null;
  /** The block held something before we wrote (its fields are reconciled, never blindly overwritten). */
  prefilled: boolean;
}

export interface RepeatableMatch {
  /** One per profile entry, in the profile's order. */
  assignments: EntryAssignment[];
  /** Entries without a block: the Add clicks still needed. */
  missing: number;
  /** Blocks no entry takes, in page order: reported, never deleted or cleared. */
  extra: number[];
}

/** Why no Add click is planned now. 'complete': every entry has a block; 'add-ignored': our last click added no
 *  block; 'no-add-button': the adapter found none; 'add-cap': the clicks made on this step reach the profile's count. */
export const ADD_STOPS = ['complete', 'add-ignored', 'no-add-button', 'add-cap'] as const;
export type AddStop = (typeof ADD_STOPS)[number];

export interface AddPlan {
  /** Click Add once now, then settle and plan again with `afterClick`. */
  add: boolean;
  /** The counters to store first (the REPEATABLE event): a planned click is already counted in them. */
  counter: RepeatableCounter;
  /** Why no click now; null when one is planned. */
  stop: AddStop | null;
  /** The reason for entries left without a block (needs-your-click: the person adds them); null when none is. */
  reason: ReasonCode | null;
}

export interface RepeatablePlan extends RepeatableMatch, AddPlan {
  kind: RepeatableKind;
}

// ── Fingerprints ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Trailing words of a company name that say only what kind of company it is. */
const COMPANY_SUFFIXES: ReadonlySet<string> = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited',
  'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'bv', 'nv', 'pty', 'pvt']);

/** A name's hash, tagged by kind; null for a name with nothing in it. */
function idOf(kind: RepeatableKind, key: string): string | null {
  return key === '' ? null : sha256Hex(`${kind}\u001f${key}`).slice(0, 16);
}

/** A company name's key: folded, punctuation as spaces, a leading "the" and trailing suffix words ("Inc.", "LLC")
 *  dropped, but never its last word. */
export function companyKey(name: string): string {
  const tokens = fold(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((token) => token !== '');
  if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

/** The year a date as a page shows it names ("01/2020", "2020-01", "Jan 2020", "2020"); null when it names none. */
export function yearOf(text: string): number | null {
  const years = [...fold(text).matchAll(/(?<!\d)(19|20)\d{2}(?!\d)/g)].map((match) => Number(match[0]));
  return years.length === 1 ? years[0]! : null;
}

/** The fingerprint of a profile's experience entry: its company, and its start year. */
export function experiencePrint(entry: Pick<ExperienceEntry, 'company' | 'startDate'>): EntryPrint {
  const id = idOf('experience', companyKey(entry.company));
  return { ids: id === null ? [] : [id], detail: entry.startDate === undefined ? null : String(entry.startDate.y) };
}

/** The fingerprint of a profile's education entry: every name of its school (canonical, as typed, its aliases), and
 *  its degree level. */
export function educationPrint(entry: { institution: { canonicalName: string; userText: string; aliases: readonly string[] };
  degree: { level: DegreeLevel } }): EntryPrint {
  const { institution } = entry;
  const names = [institution.canonicalName, institution.userText, ...institution.aliases];
  const ids = names.map((name) => idOf('education', keyWithBrackets(name, 'institution')))
    .filter((id): id is string => id !== null);
  return { ids: [...new Set(ids)], detail: entry.degree.level };
}

/** The fingerprint of a profile's language: its name. */
export function languagePrint(entry: { name: string }): EntryPrint {
  const id = idOf('language', keyWithBrackets(entry.name, 'answer'));
  return { ids: id === null ? [] : [id], detail: null };
}

/** What a field holds, as text: a box's text, or a list's first chosen label; '' otherwise. */
function textOf(current: CurrentValue): string {
  if (current.kind === 'text') return current.text;
  if (current.kind === 'selected') return current.labels[0] ?? '';
  return '';
}

/** A block's field, as the worker sees it: its category and what it holds (in memory only). */
export interface BlockField {
  category: FieldCategory;
  current: CurrentValue;
}

/**
 * The fingerprint of the entry a prefilled block holds: experience by its company (and its start date's year),
 * education by its school (and `degreeLevel`, the level its degree field names, which the caller parses with the
 * vocabularies), a language by its name. Null when the block names none.
 */
export function blockPrint(kind: RepeatableKind, fields: readonly BlockField[],
  options: { degreeLevel?: DegreeLevel | null } = {}): BlockPrint | null {
  const text = (category: FieldCategory) => {
    const field = fields.find((candidate) => candidate.category === category && textOf(candidate.current).trim() !== '');
    return field === undefined ? '' : textOf(field.current);
  };
  switch (kind) {
    case 'experience': {
      const id = idOf(kind, companyKey(text('experience.company')));
      const year = yearOf(text('experience.startDate'));
      return id === null ? null : { id, detail: year === null ? null : String(year) };
    }
    case 'education': {
      const id = idOf(kind, keyWithBrackets(text('education.school'), 'institution'));
      return id === null ? null : { id, detail: options.degreeLevel ?? null };
    }
    case 'language': {
      const id = idOf(kind, keyWithBrackets(text('languages.language'), 'answer'));
      return id === null ? null : { id, detail: null };
    }
  }
}

/** Whether a block holds nothing: no text, no ticked box, no file. A list's choice does not count, since a native list
 *  always shows one (its placeholder or first option). */
export function isBlockEmpty(fields: readonly Pick<BlockField, 'current'>[]): boolean {
  return fields.every(({ current }) => current.kind === 'empty' || current.kind === 'selected'
    || (current.kind === 'text' && current.text.trim() === '') || (current.kind === 'checked' && !current.checked)
    || (current.kind === 'files' && current.count === 0));
}

// ── The plan ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a block's fingerprint names the entry: one of its names, and a detail that agrees (`strict`: both known
 *  and equal; otherwise either may be unknown). */
function names(entry: EntryPrint, print: BlockPrint, strict: boolean): boolean {
  if (!entry.ids.includes(print.id)) return false;
  if (entry.detail === null || print.detail === null) return !strict;
  return entry.detail === print.detail;
}

/** The profile's entries assigned to the rendered blocks (module header). */
export function assignEntries(entries: readonly EntryPrint[], blocks: readonly RepeatableBlock[]): RepeatableMatch {
  const ordered = [...blocks].sort((a, b) => a.index - b.index);
  const taken = new Set<number>();
  const assignments: EntryAssignment[] = entries.map((_, entry) => ({ entry, block: null, by: null, prefilled: false }));
  const take = (assignment: EntryAssignment, block: RepeatableBlock, by: 'fingerprint' | 'order') => {
    taken.add(block.index);
    assignment.block = block.index;
    assignment.by = by;
    assignment.prefilled = !block.empty;
  };
  for (const strict of [true, false]) {
    for (const assignment of assignments) {
      if (assignment.block !== null) continue;
      const entry = entries[assignment.entry]!;
      const block = ordered.find((candidate) => !taken.has(candidate.index) && candidate.print !== null
        && names(entry, candidate.print, strict));
      if (block !== undefined) take(assignment, block, 'fingerprint');
    }
  }
  // A block holding an entry the profile has would have been found; the rest go in order.
  for (const assignment of assignments) {
    if (assignment.block !== null) continue;
    const block = ordered.find((candidate) => !taken.has(candidate.index));
    if (block !== undefined) take(assignment, block, 'order');
  }
  return {
    assignments,
    missing: assignments.filter((assignment) => assignment.block === null).length,
    extra: ordered.filter((block) => !taken.has(block.index)).map((block) => block.index),
  };
}

/**
 * The next Add click, from counts only: one when an entry still lacks a block, the adapter has an Add button and the
 * clicks counted on this step (`prior`, from RunState, across reloads) are fewer than the profile's entries. With
 * `afterClick` (this plan follows our own click, settled), a click that added no block stops the adding: the page
 * ignores untrusted clicks there, so the person adds the rest.
 */
export function planAdd(input: { profile: number; rendered: number; prior: RepeatableCounter | null;
  afterClick: boolean; addButton: boolean }): AddPlan {
  const profile = Math.max(0, Math.floor(input.profile));
  const rendered = Math.max(0, Math.floor(input.rendered));
  const clicks = input.prior?.addClicks ?? 0;
  const counter = { profile, rendered, addClicks: clicks };
  const missing = Math.max(0, profile - rendered);
  const stop = (why: AddStop): AddPlan => ({ add: false, counter, stop: why,
    reason: missing > 0 ? 'needs-your-click' : null });
  if (missing === 0) return stop('complete');
  if (input.afterClick && input.prior !== null && rendered <= input.prior.rendered) return stop('add-ignored');
  if (!input.addButton) return stop('no-add-button');
  if (clicks >= profile) return stop('add-cap');
  return { add: true, counter: { ...counter, addClicks: clicks + 1 }, stop: null, reason: null };
}

/** A section's whole plan: the entries assigned to its blocks, and the next Add click. */
export function planRepeatable(input: { kind: RepeatableKind; entries: readonly EntryPrint[];
  blocks: readonly RepeatableBlock[]; prior: RepeatableCounter | null; afterClick: boolean; addButton: boolean }):
  RepeatablePlan {
  const match = assignEntries(input.entries, input.blocks);
  const add = planAdd({ profile: input.entries.length, rendered: input.blocks.length, prior: input.prior,
    afterClick: input.afterClick, addButton: input.addButton });
  return { kind: input.kind, ...match, ...add };
}

// ── "I currently work here" ─────────────────────────────────────────────────────────────────────────────────────────

/** A block's "I currently work here" box and end date, as the latest scan found them. */
export interface CurrentJobInput {
  /** The profile's entry says the person works there now. */
  current: boolean;
  /** The adapter's currentlyHere box for the block. */
  box: 'absent' | 'checked' | 'unchecked';
  /** The block's end date: absent, empty, holding something, or disabled by the page. */
  endDate: 'absent' | 'empty' | 'filled' | 'disabled';
  endDateRequired: boolean;
}

/** What becomes of a field that is not written: its row's status and reason. */
export interface LeaveRow {
  status: 'skipped' | 'flagged';
  reason: ReasonCode;
}

export interface CurrentJobPlan {
  /** Tick the box (its own guarded write), settle, scan, and plan again: the end date is decided only after that. */
  tick: boolean;
  /** The box's row when nothing is written to it: a box the page ticked for a past job is never unticked. */
  box: LeaveRow | null;
  /** The end date: written from the profile, left with its row, or not decided yet (`pending`: after the tick). */
  endDate: 'write' | 'pending' | LeaveRow | null;
}

/** "I currently work here" before the end date (module header). */
export function planCurrentJob(input: CurrentJobInput): CurrentJobPlan {
  const { endDate } = input;
  if (input.current) {
    if (input.box === 'unchecked') return { tick: true, box: null, endDate: endDate === 'absent' ? null : 'pending' };
    // The box is ticked (or there is none): a current job's end date is never written.
    const row: LeaveRow | null = endDate === 'absent' ? null
      : endDate === 'disabled' ? { status: 'skipped', reason: 'end-date-not-applicable' }
        : endDate === 'filled' ? { status: 'flagged', reason: 'prefill-conflict' }
          : { status: input.endDateRequired ? 'flagged' : 'skipped', reason: 'end-date-not-applicable' };
    return { tick: false, box: input.box === 'checked' ? { status: 'skipped', reason: 'already-correct' } : null,
      endDate: row };
  }
  // A past job: never ticked, and never unticked when the page ticked it.
  const box: LeaveRow | null = input.box === 'absent' ? null : input.box === 'checked'
    ? { status: 'flagged', reason: 'unexpected-selection' } : { status: 'skipped', reason: 'already-correct' };
  const end: CurrentJobPlan['endDate'] = endDate === 'absent' ? null : endDate !== 'disabled' ? 'write'
    : input.box === 'checked' ? { status: 'flagged', reason: 'unexpected-selection' }
      : { status: 'skipped', reason: 'disabled-or-readonly' };
  return { tick: false, box, endDate: end };
}
