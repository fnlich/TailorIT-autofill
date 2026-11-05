/*
 * The worker's half of a repeatable section's plan (Requirement C: "compare profile entry count to rendered blocks,
 * click Add until they match, then fill by block index"; docs/design/core.md §10.2, "What wave 2 wires";
 * docs/ARCHITECTURE.md "Repeatable sections"): which profile entry each rendered block is filled from. planFrame runs
 * it for the sections plan/request names, where both the profile and the page's prefilled values are in memory:
 * - every entry's fingerprint (experiencePrint, educationPrint, languagePrint), every block's from the fields the scan
 *   read in it (their rule categories and current values: blockPrint, an education block's degree level parsed with
 *   the vocabularies), then assignEntries. So a block the site prefilled with an entry (a resume parse, "Use my last
 *   application") is filled from that entry, never from the one its place names, and nothing is duplicated;
 * - a section the frame already holds an assignment for keeps it (a plan/request that sends only some of the frame's
 *   fields, a typeahead's results, cannot see the other blocks): each entry index is checked against the profile;
 * - the answer is the profile's entry count (what the frame's Add clicks are counted against: planAdd), the entry of
 *   each block (null: none, so its fields get no value), and whether that entry is a current job (planCurrentJob).
 *   Indices, counts and flags only: a fingerprint never leaves this function, and no value does.
 * Blocks are the section's indices the scan names (FieldSpec.section.block, the adapter's block order), from 0 to the
 * highest; a block whose fields the scan does not show counts as empty. A block the frame says shows a saved entry's
 * summary and no fields (RepeatableRequest.shown: Workable's folded entries, the Phase 7a review) is read from the words
 * the summary names, so the entry it holds is found by its fingerprint; such a block takes an entry only so, never by
 * its place, since nothing in it can be written.
 */
import { parseDegree } from '../profile/degreeParse';
import { classifyField } from '../resolver/resolve';
import type { CurrentValue, FieldSpec } from '../types/field';
import type { FieldCategory } from '../types/intent';
import type { Profile } from '../types/profile';
import { MAX_REPEATABLE_BLOCKS, REPEATABLE_KINDS, type RepeatableKind } from '../types/run';
import type { Vocab } from '../vocab/types';
import {
  assignEntries, blockPrint, educationPrint, experiencePrint, isBlockEmpty, languagePrint, type BlockField,
  type EntryPrint, type RepeatableBlock,
} from './repeatable';

export { MAX_REPEATABLE_BLOCKS } from '../types/run';

/** The categories a saved entry's summary may name (RepeatableRequest.shown). */
export const SHOWN_CATEGORIES = ['education.school', 'experience.company', 'experience.title', 'experience.startDate',
  'languages.language'] as const satisfies readonly FieldCategory[];
export type ShownCategory = (typeof SHOWN_CATEGORIES)[number];

/** A block that shows a saved entry's summary (Adapter.prefill.readEntries): its index, and its words by category. */
export interface ShownBlock {
  block: number;
  values: ReadonlyArray<{ category: ShownCategory; text: string }>;
}

/** A section the frame asks about: its kind, the entry of each block when it already holds an assignment (null: the
 *  plan assigns them from the specs), and the blocks that show a saved entry's summary. */
export interface RepeatableRequest {
  kind: RepeatableKind;
  entries: readonly (number | null)[] | null;
  shown?: readonly ShownBlock[];
}

/** What the frame learns of a section: counts, indices and flags only. */
export interface RepeatableAnswer {
  kind: RepeatableKind;
  /** The profile's entries of this kind. */
  profile: number;
  /** By block index: the profile entry the block is filled from, or null when no entry is assigned to it. */
  entries: (number | null)[];
  /** By block index: the block's entry is a current job ("I currently work here"); false for any other. */
  current: boolean[];
}

const KINDS: ReadonlySet<string> = new Set<string>(REPEATABLE_KINDS);

/** The profile's entries of a kind, as fingerprints, in the profile's order. */
function entryPrints(kind: RepeatableKind, profile: Profile): EntryPrint[] {
  switch (kind) {
    case 'experience':
      return profile.experience.map(experiencePrint);
    case 'education':
      return profile.education.map(educationPrint);
    case 'language':
      return profile.languages.map(languagePrint);
  }
}

/** The category the rules give a field, or null (the planner's look across the frame does the same). */
function ruleCategory(spec: FieldSpec): BlockField['category'] | null {
  const classification = classifyField(spec);
  return classification.by === 'rules' ? classification.rules.category ?? null : null;
}

/** The section's rendered blocks, as assignEntries reads them, from the specs in them and the summaries shown. */
function blocksOf(kind: RepeatableKind, specs: readonly FieldSpec[], vocab: Vocab, shown: readonly ShownBlock[] = []):
  RepeatableBlock[] {
  const fields = new Map<number, BlockField[]>();
  const saved = new Set<number>();
  for (const summary of shown) {
    if (!Number.isInteger(summary.block) || summary.block < 0 || summary.block >= MAX_REPEATABLE_BLOCKS) continue;
    const words = summary.values.map(({ category, text }): BlockField => ({ category,
      current: { kind: 'text', text } satisfies CurrentValue }));
    fields.set(summary.block, [...(fields.get(summary.block) ?? []), ...words]);
    saved.add(summary.block);
  }
  for (const spec of specs) {
    const block = spec.section.block;
    if (spec.section.id !== kind || block === undefined || block >= MAX_REPEATABLE_BLOCKS) continue;
    const category = ruleCategory(spec);
    const list = fields.get(block) ?? [];
    list.push({ category: category ?? 'unknown', current: spec.current });
    fields.set(block, list);
  }
  const count = fields.size === 0 ? 0 : Math.max(...fields.keys()) + 1;
  return Array.from({ length: count }, (_, index) => {
    const own = fields.get(index) ?? [];
    const degree = own.find((field) => field.category === 'education.degree' && field.current.kind !== 'empty');
    const degreeText = degree === undefined ? '' : degree.current.kind === 'text' ? degree.current.text
      : degree.current.kind === 'selected' ? degree.current.labels.join(' ') : '';
    const degreeLevel = kind === 'education' && degreeText.trim() !== '' ? parseDegree(degreeText, vocab).level ?? null
      : null;
    return { index, print: blockPrint(kind, own, { degreeLevel }), empty: isBlockEmpty(own),
      ...(saved.has(index) ? { saved: true as const } : {}) };
  });
}

/** The entry a block names, checked against the profile's count: a whole index below it, else null. */
function checkedEntry(entry: number | null | undefined, count: number): number | null {
  return typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < count ? entry : null;
}

/** Whether the entry is a current job. */
function isCurrent(kind: RepeatableKind, entry: number | null, profile: Profile): boolean {
  return kind === 'experience' && entry !== null && profile.experience[entry]?.current === true;
}

/** One section's plan (module header): the request's assignment, checked, or one made from the specs. */
export function planBlocks(request: RepeatableRequest, specs: readonly FieldSpec[], profile: Profile, vocab: Vocab):
  RepeatableAnswer {
  const { kind } = request;
  const prints = entryPrints(kind, profile);
  let entries: (number | null)[];
  if (request.entries !== null) {
    entries = request.entries.slice(0, MAX_REPEATABLE_BLOCKS).map((entry) => checkedEntry(entry, prints.length));
  } else {
    const blocks = blocksOf(kind, specs, vocab, request.shown);
    const match = assignEntries(prints, blocks);
    entries = blocks.map(() => null);
    for (const assignment of match.assignments) {
      if (assignment.block !== null) entries[assignment.block] = assignment.entry;
    }
  }
  return { kind, profile: prints.length, entries, current: entries.map((entry) => isCurrent(kind, entry, profile)) };
}

/** Every requested section's plan, the first request of each kind only. */
export function planRepeatables(requests: readonly RepeatableRequest[], specs: readonly FieldSpec[], profile: Profile,
  vocab: Vocab): RepeatableAnswer[] {
  const seen = new Set<RepeatableKind>();
  const answers: RepeatableAnswer[] = [];
  for (const request of requests) {
    if (!KINDS.has(request.kind) || seen.has(request.kind)) continue;
    seen.add(request.kind);
    answers.push(planBlocks(request, specs, profile, vocab));
  }
  return answers;
}
