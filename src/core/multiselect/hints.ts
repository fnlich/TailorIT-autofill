/*
 * What a multi-select question's own words say about how many answers it takes (docs/design/core.md §9; Requirement
 * B: "Detect 'select all that apply' and 'choose up to N' from the label text"). "Select all that apply" is never an
 * instruction to select everything: it only says the question takes several answers, those that apply to the
 * profile. "Choose up to 2" caps the selection, so the profile's highest-priority values are taken first; "choose 3"
 * asks for exactly three; "at least 2" for a minimum. The label and description are read folded for detection, with
 * their brackets kept ("(choose up to 2)"), and a number may be written in digits or as a word from one to ten.
 */
import { detectionText } from '../guard/fold';
import type { Constraints } from '../types/field';

/** What a question's words say about its number of answers. */
export interface SelectionHints {
  selectAllThatApply: boolean;
  maxSelections?: number;
  minSelections?: number;
  exactSelections?: number;
}

const WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10 };
const N = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;
const VERB = String.raw`(?:select|choose|pick|check|tick|mark)`;

const SELECT_ALL = new RegExp(String.raw`\b${VERB}\s+all\s+(?:that|which)\s+(?:apply|applies)\b`);
const UP_TO = new RegExp(String.raw`\b${VERB}\s+(?:up\s+to|at\s+most|a\s+maximum\s+of|no\s+more\s+than|max(?:imum)?\.?)\s+${N}\b`);
const EXACTLY = new RegExp(String.raw`\b(?:select|choose|pick)\s+(?:exactly\s+)?${N}\b(?!\s*(?:or\s+more|\+|or\s+fewer|or\s+less))`);
const AT_LEAST = new RegExp(String.raw`\b(?:at\s+least|a\s+minimum\s+of|minimum\s+of|min\.?)\s+${N}\b`);
const TOP = new RegExp(String.raw`\b(?:your\s+)?top\s+${N}\b`);

const numberOf = (text: string): number | undefined => {
  const value = WORDS[text] ?? Number(text);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

/** The hints of a question's label and description (§9). */
export function parseSelectionHints(label: string, description: string): SelectionHints {
  const text = detectionText(`${label} ${description}`);
  const hints: SelectionHints = { selectAllThatApply: SELECT_ALL.test(text) };
  const upTo = UP_TO.exec(text)?.[1] ?? TOP.exec(text)?.[1];
  const max = upTo === undefined ? undefined : numberOf(upTo);
  if (max !== undefined) hints.maxSelections = max;
  const exact = upTo === undefined ? EXACTLY.exec(text)?.[1] : undefined;
  const exactly = exact === undefined ? undefined : numberOf(exact);
  if (exactly !== undefined) hints.exactSelections = exactly;
  const least = AT_LEAST.exec(text)?.[1];
  const min = least === undefined ? undefined : numberOf(least);
  if (min !== undefined) hints.minSelections = min;
  return hints;
}

/** How many answers a field takes: the scanner's constraints and the question's words together, the tighter bound
 *  winning. `max` is the cap the planner keeps under (an exact count caps it too). */
export interface SelectionLimits {
  max?: number;
  min?: number;
  exact?: number;
}

const least = (...values: Array<number | undefined>) => {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length === 0 ? undefined : Math.min(...defined);
};
const most = (...values: Array<number | undefined>) => {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length === 0 ? undefined : Math.max(...defined);
};

/** The limits of a field from its constraints and its hints. */
export function selectionLimits(constraints: Constraints, hints: SelectionHints): SelectionLimits {
  const exact = constraints.exactSelections ?? hints.exactSelections;
  const max = least(constraints.maxSelections, hints.maxSelections, exact);
  const min = most(constraints.minSelections, hints.minSelections);
  return { ...(max !== undefined ? { max } : {}), ...(min !== undefined ? { min } : {}),
    ...(exact !== undefined ? { exact } : {}) };
}
