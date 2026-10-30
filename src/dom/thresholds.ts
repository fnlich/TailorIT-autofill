/*
 * Every size, count and timing the DOM layer uses, in one place (docs/ARCHITECTURE.md "Visibility", "Scanner",
 * "settle()"; docs/design/runtime.md §5 and §7). The visibility and camouflage values were tuned on the trap fixtures;
 * a change here must keep every trap green. The text caps match the message schemas (src/messaging/schemas.ts), so a
 * scanned field always fits its plan/request.
 */

/** A box, a clipped area or an on-screen area under this many CSS pixels on either side is not visible. */
export const MIN_BOX_PX = 4;
/** Text whose computed font size is under this many pixels is not visible. */
export const MIN_FONT_PX = 4;
/** A circle() or ellipse() clip-path radius under this many pixels hides what it clips. */
export const MIN_CLIP_RADIUS_PX = 2;
/** An opacity product (or a text colour's alpha times it) under this is invisible. */
export const MIN_OPACITY = 0.05;
/** WCAG contrast between text and its effective background under this ratio is camouflaged ("white on white"). */
export const CAMOUFLAGE_MAX_CONTRAST = 1.35;
/** A control's border, fill, shadow or outline counts as drawn from this contrast with what is behind it. A large area
 *  or a line shows at far less contrast than text needs (a #eee fill or a #e5e5e5 border on white is plainly seen), so
 *  only colours that are practically identical (#fdfdfd on white) count as not drawn. */
export const CONTROL_DRAWN_MIN_CONTRAST = 1.04;
/** A text-shadow or text stroke counts as an outline only from this many pixels of offset, blur or width. */
export const MIN_OUTLINE_PX = 0.5;
/** The canvas behind a page that uses a dark colour scheme while the browser prefers dark (Chromium's default). */
export const DARK_CANVAS_RGB: readonly [number, number, number] = [0x12, 0x12, 0x12];
/** At most this many candidate backgrounds are kept while compositing gradient stops; past it the answer is unknown. */
export const MAX_BACKGROUND_CANDIDATES = 16;

/** visibleText's cap for a job description or any long passage, in code points. */
export const TEXT_CAP_PASSAGE = 20_000;
/** A field's label, an option's label, an option's value and a group heading: at most this many code points. */
export const TEXT_CAP_LABEL = 300;
/** A field's description (its visible help text). */
export const TEXT_CAP_DESCRIPTION = 2_000;
/** A name or id attribute as a FieldSpec carries it. */
export const TEXT_CAP_ATTRIBUTE = 300;
/** A section id. */
export const TEXT_CAP_SECTION = 200;
/** A display pattern read from a placeholder ("MM/YYYY"). */
export const TEXT_CAP_PATTERN = 100;
/** A field's current text, held in memory only. */
export const TEXT_CAP_CURRENT = 20_000;
/** autocomplete tokens kept per field, and the length of each. */
export const MAX_AUTOCOMPLETE_TOKENS = 10;
export const TEXT_CAP_AUTOCOMPLETE_TOKEN = 60;
/** accept tokens kept per file input, and the length of each. */
export const MAX_ACCEPT_TOKENS = 20;
export const TEXT_CAP_ACCEPT_TOKEN = 100;
/** Options kept per field, and selected labels kept in a current value. */
export const MAX_OPTIONS = 5_000;
export const MAX_SELECTED_LABELS = 300;
/** Fields one scan reports: a plan/request carries at most this many. */
export const MAX_SCAN_FIELDS = 500;

/** The tripwire's raw scan reads at most this many nodes per call. */
export const RAW_SCAN_MAX_NODES = 50_000;
/** The raw scan works in slices of about this many milliseconds, yielding to the page between them. */
export const RAW_SCAN_SLICE_MS = 8;
/** An attribute value the raw scan reads is cut to this many code points. */
export const RAW_ATTRIBUTE_CAP = 2_000;

/** settle(): the quiet window with no mutation and no busy sign. */
export const SETTLE_QUIET_MS = 250;
/** settle(): past this the pass stops with the "page busy" notice. An adapter may raise it. */
export const SETTLE_CAP_MS = 8_000;
/** A dependent option list waits at most this long for real options. */
export const OPTIONS_CAP_MS = 5_000;
/** After an auto-advance click, the step transition waits at most this long. */
export const TRANSITION_CAP_MS = 20_000;
/** The URL poll, where the Navigation API is missing. */
export const URL_POLL_MS = 500;
