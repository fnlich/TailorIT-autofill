/*
 * The multi-select planner (docs/design/core.md §9; Requirement B): checkbox groups, native select[multiple], chips
 * and "select all that apply" questions. The profile supplies a set; each value has been matched on its own through
 * the matcher (planFrame calls matchOne once per value, each with its own valueRef), and the planner decides what to
 * add, in priority order. All of it is pure and deterministic:
 * 1. values are taken by priority; two values matching one option make one add, recorded on the higher-priority one;
 *    a value that matched nothing is reported (partial success per value);
 * 2. the current selection is read first: wanted options already selected are kept and never clicked again (the
 *    write is idempotent); selected options nobody wants are reported and never unticked;
 * 3. an exclusive option ("None of the above", a decline) is added only alone and only when the profile asks for
 *    exactly that; with one already selected nothing else is added, and with others selected it is not added;
 * 4. a cap (maxSelections, "choose up to N", an exact count) takes the highest-priority values; the rest are reported
 *    as max-selections-reached;
 * 5. the mark-all check (guard/markAll.ts) runs on the selection the write would leave, before anything is written; an
 *    abort adds nothing;
 * 6. the final set is verified after filling (verify.ts).
 */
import { checkMarkAll } from '../guard/markAll';
import type { MatchDomain, PreparedOption } from '../matcher/types';
import type { ReasonCode } from '../types/fill';
import type { Match } from '../types/match';
import type { SelectionLimits } from './hints';

/** One of the profile's values, matched. */
export interface MultiSelectValue {
  /** Which value this is ('v0', 'v1', ...): the match's valueRef. */
  ref: string;
  /** Lower is more important. */
  priority: number;
  /** The value's place in the profile's list, for equal priorities. */
  order: number;
  match: Match;
}

/** What the planner reads. */
export interface MultiSelectInput {
  /** The field's options, prepared in the values' domain, in DOM order. */
  options: readonly PreparedOption[];
  /** The options selected now (checked boxes, selected options, chips), by index. */
  selected: ReadonlySet<number>;
  values: readonly MultiSelectValue[];
  limits: SelectionLimits;
}

/** One value's option. */
export interface PlannedOption {
  ref: string;
  index: number;
}

/** What the planner decided. */
export interface MultiSelectPlan {
  /** Options to select, in priority order: the write's indices. */
  add: PlannedOption[];
  /** Wanted and already selected: untouched. */
  keep: PlannedOption[];
  /** Selected and not wanted: untouched, reported. */
  extraneous: number[];
  /** Values that matched no usable option. */
  unmatched: string[];
  /** Values left out by the cap. */
  skippedByMax: string[];
  conflicts: Array<{ ref: string; reason: 'exclusive-conflict' }>;
  verdict: 'ok' | 'partial' | 'nothing-to-do' | 'mark-all-aborted' | 'exceeds-profile-set';
  /** The row's reason (the first that applies, most pressing first); 'ok' when nothing does. */
  reason: ReasonCode;
  /** Every option that should be selected once the write is done, by index, ascending. */
  expectedFinal: number[];
}

/** An option the planner may select: usable and enabled. */
const usable = (option: PreparedOption) => !option.unusable && !option.disabled;

/** Plans one multi-select write (§9). */
export function planMultiSelect(input: MultiSelectInput): MultiSelectPlan {
  const byIndex = new Map(input.options.map((option) => [option.index, option]));
  const ordered = [...input.values].sort((a, b) => a.priority - b.priority || a.order - b.order);
  const wanted: PlannedOption[] = [];
  const unmatched: string[] = [];
  const claimed = new Set<number>();
  for (const item of ordered) {
    const index = item.match.optionIndex;
    const option = index === null ? undefined : byIndex.get(index);
    if (item.match.stage === 'none' || option === undefined || !usable(option)) {
      unmatched.push(item.ref);
      continue;
    }
    if (claimed.has(option.index)) continue;
    claimed.add(option.index);
    wanted.push({ ref: item.ref, index: option.index });
  }

  const { selected } = input;
  const exclusive = (index: number) => byIndex.get(index)?.exclusive === true;
  const keep = wanted.filter((item) => selected.has(item.index));
  const extraneous = [...selected].filter((index) => !claimed.has(index)).sort((a, b) => a - b);
  const conflicts: MultiSelectPlan['conflicts'] = [];
  const exclusiveSelected = [...selected].some(exclusive);
  let add = wanted.filter((item) => !selected.has(item.index)).filter((item) => {
    // Nothing joins an exclusive option already selected; an exclusive option goes in only alone, and only when it is
    // all the profile asks for.
    const alone = exclusive(item.index) ? wanted.length === 1 && selected.size === 0 : !exclusiveSelected;
    if (!alone) conflicts.push({ ref: item.ref, reason: 'exclusive-conflict' });
    return alone;
  });

  const skippedByMax: string[] = [];
  const { max, min, exact } = input.limits;
  if (max !== undefined) {
    const room = Math.max(0, max - keep.length - extraneous.length);
    for (const item of add.slice(room)) skippedByMax.push(item.ref);
    add = add.slice(0, room);
  }
  const finalCount = keep.length + extraneous.length + add.length;
  const short = (min !== undefined && finalCount < min) || (exact !== undefined && finalCount < exact);

  // The page itself selected every option there is: nothing is added, and the person is shown it.
  const selectable = input.options.filter((option) => usable(option) && !option.exclusive);
  const allPreselected = selectable.length > 0 && selectable.every((option) => selected.has(option.index));
  const verdictOfCheck = checkMarkAll({
    options: input.options.map((option) => ({ index: option.index, selectable: usable(option), exclusive: option.exclusive,
      selected: selected.has(option.index) })),
    added: add.map((item) => item.index), kept: keep.length, profileSetSize: input.values.length,
  });
  const aborted = !verdictOfCheck.ok && verdictOfCheck.reason !== 'preselected-left-untouched'
    ? verdictOfCheck.reason : null;
  if (aborted !== null || allPreselected) add = [];

  const partial = unmatched.length > 0 || skippedByMax.length > 0 || conflicts.length > 0 || short;
  const verdict: MultiSelectPlan['verdict'] = aborted ?? (add.length === 0 ? (partial ? 'partial' : 'nothing-to-do')
    : partial ? 'partial' : 'ok');
  const reason: ReasonCode = aborted ?? (allPreselected ? 'preselected-left-untouched'
    : conflicts.length > 0 ? 'exclusive-conflict'
      : skippedByMax.length > 0 ? 'max-selections-reached'
        : unmatched.length > 0 || short ? 'partial-multi-select'
          : extraneous.length > 0 ? 'unexpected-selection'
            : add.length === 0 ? 'already-correct' : 'ok');
  const expectedFinal = [...new Set([...keep.map((item) => item.index), ...extraneous, ...add.map((item) => item.index)])]
    .sort((a, b) => a - b);
  return { add, keep, extraneous, unmatched, skippedByMax, conflicts, verdict, reason, expectedFinal };
}

/** The domain a set's values share, for preparing the options once; null when they differ. */
export function sharedDomain(domains: readonly MatchDomain[]): MatchDomain | null {
  const [first] = domains;
  return first !== undefined && domains.every((domain) => domain === first) ? first : null;
}
