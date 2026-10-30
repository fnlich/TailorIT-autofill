/*
 * The "mark all" check (docs/design/core.md §7.7, docs/ARCHITECTURE.md "Mark-all"; the spec's "Never mark all"). Every
 * selection comes from a profile value mapped through the matcher, and page text never adds one, so a planned
 * selection that marks a whole group means something went wrong. Before any write to a group of more than two options:
 * - mark-all-aborted when the selection after the write would cover every selectable option, an exclusive one ("None
 *   of the above", a decline) left aside: stronger than "equals every option", which a trap could dodge by adding a
 *   "None of the above";
 * - exceeds-profile-set when the options this field would hold for the person (those added, and wanted ones already
 *   selected) outnumber the profile's values. Options the page itself had selected are not ours: they are reported,
 *   never unticked, and do not count here.
 * When the page had already selected every option, nothing is added at all (preselected-left-untouched, flagged).
 * "Select all that apply" is never treated as an attack: it means the ones that apply to the profile. The worker runs
 * the check with the profile's set size and the vocabulary's exclusive options; the frame, which has neither, runs the
 * cover test alone over what it can see.
 */
import type { ReasonCode } from '../types/fill';

/** A group needs more than this many selectable options for the cover test to apply. */
export const MARK_ALL_MIN_OPTIONS = 2;

/** One option as the check reads it. */
export interface MarkAllOption {
  index: number;
  /** Usable (not a placeholder, something left after the injected-text cut) and enabled. */
  selectable: boolean;
  /** Excludes every other choice: "None of the above" or a decline. */
  exclusive: boolean;
  /** Selected before the write. */
  selected: boolean;
}

/** What the check reads of one planned multi-select write. */
export interface MarkAllInput {
  options: readonly MarkAllOption[];
  /** The indices the write adds. */
  added: readonly number[];
  /** How many of the already selected options are wanted (the planner's keep); 0 when unknown (the frame). */
  kept?: number;
  /** How many values the profile's set holds; omitted where unknown (the frame). */
  profileSetSize?: number;
}

/** The check's answer: pass, or why the write is aborted. */
export type MarkAllVerdict = { ok: true } | { ok: false; reason: Extract<ReasonCode, 'mark-all-aborted' |
  'exceeds-profile-set' | 'preselected-left-untouched'> };

/** Checks one planned multi-select write before anything is written (§7.7). */
export function checkMarkAll(input: MarkAllInput): MarkAllVerdict {
  const selectable = input.options.filter((option) => option.selectable && !option.exclusive);
  const added = new Set(input.added);
  if (selectable.length > 0 && selectable.every((option) => option.selected)) {
    return added.size === 0 ? { ok: true } : { ok: false, reason: 'preselected-left-untouched' };
  }
  if (added.size === 0) return { ok: true };
  if (selectable.length > MARK_ALL_MIN_OPTIONS
    && selectable.every((option) => option.selected || added.has(option.index))) {
    return { ok: false, reason: 'mark-all-aborted' };
  }
  if (input.profileSetSize !== undefined && added.size + (input.kept ?? 0) > input.profileSetSize) {
    return { ok: false, reason: 'exceeds-profile-set' };
  }
  return { ok: true };
}
