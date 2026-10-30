/*
 * The tripwire (docs/design/core.md §7.2, §7.3): text addressed to AI tools, found wherever the page shows or hides it.
 * Each of TRIPWIRE_PATTERNS runs over a passage folded for detection and its loose view, and over its spaced reading
 * and that reading's loose view when the passage has format characters (fold.ts); a hit in any view counts, and its
 * span is mapped back to the passage's own text, so the canary extraction (canary.ts) can read the sentence it sits in.
 *
 * It reads RawPageText (the raw scan's hidden text, comments and attributes) and VisibleText alike. Either way the
 * passages only feed the notice and the canaries: never a field, never an LLM. A hit in a field's own label or
 * description blocks that field (the resolver's first check). These regexes are a smoke detector, never the defence:
 * the real boundary is values chosen by code and validated LLM output.
 */
import type { RawPageText, VisibleText } from '../types/text';
import { extractCanaries, mergeCanaries } from './canary';
import { detectionViews, foldForDetection, hasFormatCharacter, looseView, originalSpan } from './fold';
import { TRIPWIRE_PATTERNS, type TripwirePatternId } from './patterns';

/** Page text the tripwire reads: the raw scan's or visibleText's. */
export type DetectableText = RawPageText | VisibleText;

/** One pattern's match, as a span of the text it was found in (UTF-16 offsets, end exclusive). */
export interface TripwireHit {
  patternId: TripwirePatternId;
  start: number;
  end: number;
}

/** Every pattern with the global flag, for its matches; they all carry the single flag 'i'. */
const GLOBAL = TRIPWIRE_PATTERNS.map(({ id, re }) => ({ id, re: new RegExp(re.source, `${re.flags}g`) }));
/** Every pattern in one alternation: most text matches none, and one test settles that before any offset is mapped. */
const ANY = new RegExp(TRIPWIRE_PATTERNS.map(({ re }) => `(?:${re.source})`).join('|'), 'i');
/** A pattern's position in TRIPWIRE_PATTERNS, which orders hits that start together. */
const ORDER = new Map<string, number>(TRIPWIRE_PATTERNS.map(({ id }, at) => [id, at]));

/**
 * The tripwire's hits in `text`, each once, in order of where they start (then pattern order). Empty when nothing
 * matches. The spans are offsets of `text` itself, whichever view matched.
 */
export function tripwireHits(text: DetectableText): TripwireHit[] {
  if (text === '' || !detectionViews(text).some((view) => ANY.test(view))) return [];
  const readings = hasFormatCharacter(text)
    ? [foldForDetection(text), foldForDetection(text, { formatAsSpace: true })]
    : [foldForDetection(text)];
  const seen = new Set<string>();
  const hits: TripwireHit[] = [];
  for (const reading of readings) {
    for (const view of [reading.text, looseView(reading.text)]) {
      for (const { id, re } of GLOBAL) {
        for (const match of view.matchAll(re)) {
          const span = originalSpan(reading, match.index, match.index + match[0].length);
          const key = `${id}:${span.start}:${span.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ patternId: id, start: span.start, end: span.end });
        }
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start || ORDER.get(a.patternId)! - ORDER.get(b.patternId)!);
}

/** Whether any tripwire pattern matches `text`: the cheap test, for a label or a description. */
export function hasTripwire(text: DetectableText): boolean {
  return text !== '' && detectionViews(text).some((view) => ANY.test(view));
}

/** One passage's hits, with the passage's position in the scan's input. */
export interface PassageHit extends TripwireHit {
  passage: number;
}

/** What scanTripwires found over a page's passages. */
export interface TripwireScan {
  hits: PassageHit[];
  /** The canaries of every hit's window (canary.ts), deduplicated by folded form, at most MAX_CANARIES. */
  canaries: string[];
  /** Any hit at all: the panel shows "This page contains text addressed to AI tools. It was ignored." */
  notice: boolean;
}

/**
 * The tripwire over a page's passages (the raw scan's, or visible ones): every hit, the canaries of the hits' windows
 * (hidden and visible windows alike), and whether the notice shows. Any passage shape that carries its text will do.
 */
export function scanTripwires(passages: ReadonlyArray<{ readonly text: DetectableText }>): TripwireScan {
  const hits: PassageHit[] = [];
  const found: string[][] = [];
  passages.forEach((passage, index) => {
    const own = tripwireHits(passage.text);
    if (own.length === 0) return;
    for (const hit of own) hits.push({ ...hit, passage: index });
    found.push(extractCanaries(passage.text, own));
  });
  return { hits, canaries: mergeCanaries(...found), notice: hits.length > 0 };
}
