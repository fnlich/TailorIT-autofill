/*
 * The one way page text becomes LLM input (docs/design/core.md §1.4). It accepts only VisibleText, so hidden text,
 * comments and TailorIT's stored posting copy can never be quoted to a model, and it returns the UntrustedText brand
 * that every request builder requires. It removes what could hide from the person or break out of the
 * `<untrusted>` wrapper. That is a speed bump: the real boundary is constrained output validated in code. TailorIT's
 * server applies the same treatment again (its untrustedText), so the two sides agree on the text.
 */
import type { UntrustedText, VisibleText } from '../types/text';
import { capCodePoints } from './fold';

/** Invisible and bidi characters: every format character (zero-width, bidi controls, tags), the combining grapheme
 *  joiner, Khmer inherent vowels, variation selectors and Hangul fillers. The combining marks come first, so none of
 *  them follows a base character in the class. */
const INVISIBLE = /[\p{Cf}\u{34F}\u{17B4}\u{17B5}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{115F}\u{1160}\u{3164}\u{FFA0}]/gu;
/** Control characters become spaces. */
const CONTROL = /\p{Cc}/gu;
/** An opening or closing wrapper tag, attributes included when a '>' follows soon. */
const WRAPPER_TAG = /<\s*\/?\s*untrusted(?:[^<>]{0,100}>)?/gi;
/** The JSON sentinels TailorIT's output parser looks for. */
const SENTINEL = /@@\s*(?:begin|end)[\s_-]*json\s*@@/gi;

/** What replaces a wrapper tag in page text. */
export const TAG_REMOVED = '[tag removed]';
/** What replaces a JSON sentinel in page text. */
export const MARKER_REMOVED = '[marker removed]';

/**
 * Page text as a prompt may quote it: compatibility forms folded (NFKC, so a full-width "＜/untrusted＞" is caught),
 * invisible and bidi characters removed, control characters made spaces, wrapper tags and JSON sentinels defused,
 * whitespace collapsed, and at most `max` code points kept.
 */
export function asUntrusted(text: VisibleText, max: number): UntrustedText {
  const limit = max >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : max > 0 ? Math.floor(max) : 0;
  const cleaned = text.normalize('NFKC').replace(INVISIBLE, '').replace(CONTROL, ' ')
    .replace(WRAPPER_TAG, TAG_REMOVED).replace(SENTINEL, MARKER_REMOVED)
    .replace(/\s+/g, ' ').trim();
  return capCodePoints(cleaned, limit).trimEnd() as UntrustedText;
}
