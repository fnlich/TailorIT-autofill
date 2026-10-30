/*
 * What a multi-select question's own words say about how many answers it takes (docs/design/core.md §9; Requirement
 * B: "Detect 'select all that apply' and 'choose up to N' from the label text"). "Select all that apply" is never an
 * instruction to select everything: it only says the question takes several answers, those that apply to the
 * profile. "Choose up to 2" caps the selection, so the profile's highest-priority values are taken first; "choose 3"
 * asks for exactly three; "at least 2" for a minimum; a range ("Select 1-3", "choose 2 or 3", "between 2 and 4") for
 * both a minimum and a cap, never an exact count. A cap needs no verb before it ("(up to 3)", "(max 3)", "Maximum of
 * 2"; the review, CORE-9), but a number of years, hours or people is no cap. The label and description are read folded
 * for detection, with their brackets kept ("(choose up to 2)"), and a number may be written in digits or as a word from
 * one to ten.
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
const NUMBER = String.raw`(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;
const N = `(${NUMBER})`;
const VERB = String.raw`(?:select|choose|pick|check|tick|mark)`;
/** What a number counts when it is no number of answers: a length of time, a distance, a share, people. */
const NOT_ANSWERS = String.raw`(?!\s*(?:years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|miles?|km|kilomet(?:er|re)s?|percent|%|people|persons?|employees|reports|direct\s+reports|members|times)\b)`;
/** Between the two ends of a range. */
const TO = String.raw`\s*(?:-|\u{2013}|\u{2014}|to|or|and)\s*`;
/** The answers a range or a count may name after it. */
const ANSWERS = String.raw`(?:selections?|choices?|options?|answers?|items?|responses?)`;

const SELECT_ALL = new RegExp(String.raw`\b${VERB}\s+all\s+(?:that|which)\s+(?:apply|applies)\b`);
const UP_TO = new RegExp(String.raw`\b(?:${VERB}\s+)?(?:up\s+to|at\s+most|a\s+maximum\s+of|maximum\s+of|no\s+more\s+than|max(?:imum)?\.?)\s+${N}\b${NOT_ANSWERS}`, 'u');
const RANGE = new RegExp(String.raw`\b${VERB}\s+(?:between\s+)?${N}${TO}${N}\b${NOT_ANSWERS}|\b(?:between\s+)?${N}${TO}${N}\s+${ANSWERS}\b|\(\s*${N}${TO}${N}\s*\)`, 'u');
const EXACTLY = new RegExp(String.raw`\b(?:select|choose|pick)\s+(?:exactly\s+)?${N}\b(?!\s*(?:or\s+more|\+|or\s+fewer|or\s+less)|${TO}${NUMBER}\b)`, 'u');
const AT_LEAST = new RegExp(String.raw`\b(?:at\s+least|a\s+minimum\s+of|minimum\s+of|min\.?)\s+${N}\b${NOT_ANSWERS}`, 'u');
const TOP = new RegExp(String.raw`\b(?:your\s+)?top\s+${N}\b`);

const numberOf = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const value = WORDS[text] ?? Number(text);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

/** The two ends of the first range a text names, the lower first; null for none, or for two equal ends. */
function rangeOf(text: string): { min: number; max: number } | null {
  const match = RANGE.exec(text);
  if (match === null) return null;
  const [low, high] = match.slice(1).filter((part) => part !== undefined).map(numberOf);
  return low !== undefined && high !== undefined && low < high ? { min: low, max: high } : null;
}

/** The hints of a question's label and description (§9). */
export function parseSelectionHints(label: string, description: string): SelectionHints {
  const text = detectionText(`${label} ${description}`);
  const hints: SelectionHints = { selectAllThatApply: SELECT_ALL.test(text) };
  const range = rangeOf(text);
  const caps = [numberOf(UP_TO.exec(text)?.[1] ?? TOP.exec(text)?.[1]), range?.max]
    .filter((cap): cap is number => cap !== undefined);
  if (caps.length > 0) hints.maxSelections = Math.min(...caps);
  const exactly = caps.length === 0 ? numberOf(EXACTLY.exec(text)?.[1]) : undefined;
  if (exactly !== undefined) hints.exactSelections = exactly;
  const floors = [numberOf(AT_LEAST.exec(text)?.[1]), range?.min].filter((floor): floor is number => floor !== undefined);
  if (floors.length > 0) hints.minSelections = Math.max(...floors);
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
