/*
 * Every size, count and timing the DOM layer uses, in one place (docs/ARCHITECTURE.md "Visibility", "Scanner",
 * "settle()"; docs/design/runtime.md §5 and §7). The visibility and camouflage values were tuned on the trap fixtures;
 * a change here must keep every trap green. The text caps match the message schemas (src/messaging/schemas.ts), so a
 * scanned field always fits its plan/request.
 */
import { SEARCH_LIST_MIN_OPTIONS } from '../core/matcher/searchLimits';

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
/** A control's (or its wrapper's) box-shadow draws something only when its offset, blur and spread together reach
 *  this many pixels past the box: `0 0 0 0` draws nothing, however dark its colour. */
export const MIN_SHADOW_REACH_PX = 1;
/** A wrapper draws a control's box only when it hugs the control and its own labels: it reaches no more than this
 *  many pixels past them on any side (Greenhouse's outlined div.input-wrapper holds its label and its input). */
export const WRAPPER_HUG_PX = 8;
// ── The security fix of 2026-11-06 (S6): a wide wrapper's decorations ──
/** A wrapper whose only content is a control and its decorations draws the control's box only when each decoration
 *  is an icon's size, no wider and no taller than this (Rippling's search icon, BambooHR's start adornment)... */
export const WRAPPER_DECORATION_MAX_PX = 32;
/** ...and the control spans more than this share of the wrapper's content box on each axis. */
export const WRAPPER_CONTROL_MIN_SHARE = 0.5;
// ── end of the security fix's block (S6) ──
/** The canvas behind a page that uses a dark colour scheme while the browser prefers dark (Chromium's default). */
export const DARK_CANVAS_RGB: readonly [number, number, number] = [0x12, 0x12, 0x12];
/** At most this many candidate backgrounds are kept while compositing gradient stops; past it the answer is unknown. */
export const MAX_BACKGROUND_CANDIDATES = 16;

/** An aria-label counts as shown beside its control only when its words, whole and in order, hold at least this many
 *  letters or digits: a one-letter "e" is found in any sentence. */
export const MIN_ARIA_LABEL_CHARS = 2;

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

// ── Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 33) ──
/** A document's first scan finds no form while a form fades in: it waits at most this long for the entrance animations
 *  running on what holds a form's controls to finish (dom/entrance.ts; Pinpoint's panel fades in over 1 s). */
export const ENTRANCE_CAP_MS = 2_000;

/** settle(): the quiet window with no mutation and no busy sign; a busy sign seen at its end starts another. */
export const SETTLE_QUIET_MS = 250;
/** settle(): past this the pass stops with the "page busy" notice. An adapter may raise it. */
export const SETTLE_CAP_MS = 8_000;
/** An adapter's raised settle cap (quirks.settleCapMs) is held at this at most: a page busy for longer is the person's
 *  to wait for, with Continue. It also keeps every cap far below the browser timer's 2^31 - 1 ms limit, past which a
 *  timer fires at once. */
export const SETTLE_CAP_MAX_MS = 30_000;
/** A dependent option list waits at most this long for real options. */
export const OPTIONS_CAP_MS = 5_000;
/** awaitOptions(): real options count as arrived once the list has had no mutation for this long. */
export const OPTIONS_QUIET_MS = 250;
/** A widget (Phase 4): after one activation, a click on an option or a close, the page has this long without a mutation
 *  before the widget is read again. */
export const WIDGET_QUIET_MS = 150;
/** A widget's wait after one activation, click or close ends here at the latest. */
export const WIDGET_CAP_MS = 2_000;
/** A widget's list just opened that shows no option, no busy sign and no change for this long is empty. */
export const WIDGET_EMPTY_AFTER_MS = 1_000;
/** A run's first declared activation the page did not answer at all waits this long at most for the page's script to
 *  attach before it is sent once more: Greenhouse's React attaches 1.8 to 3.1 s after its form shows (the capture of
 *  2026-11-01), and nothing answers before. */
export const WIDGET_READY_CAP_MS = 4_000;
/** That wait ends sooner once the form root has changed (the page rebuilt its form) and then been quiet this long. */
export const WIDGET_READY_QUIET_MS = 400;
/** A virtualized list, after its scrollTop is set: the page has this long without a mutation to draw its rows. */
export const WIDGET_SCROLL_QUIET_MS = 40;
/** A list that does not change after its scrollTop was set (it is drawn whole) is read after this long. */
export const WIDGET_SCROLL_SETTLE_MS = 120;
/** A virtualized list's wait after one scroll ends here at the latest. */
export const WIDGET_SCROLL_CAP_MS = 400;
/** A widget's options read at most: a longer list is read this far. */
export const MAX_WIDGET_OPTIONS = 1_000;
/** A virtualized list is scrolled at most this many times while it is read. */
export const MAX_WIDGET_SCROLLS = 200;
/** A widget's list is read for at most this long in all (each view waits up to WIDGET_SCROLL_CAP_MS, so a hostile list
 *  could hold a read of MAX_WIDGET_SCROLLS views for 80 s): a read this stops is partial (the Phase 4 review, R9). */
export const WIDGET_READ_CAP_MS = 10_000;
/** A remote typeahead: one query's results arrive within this, or the query found nothing. */
export const TYPEAHEAD_QUERY_CAP_MS = 3_000;
/** v4 (drop): one field's search, all its queries together, types no further query once it has run this long (checked
 *  before each query after the first): six queries that each wait their whole cap would hold the form for 18 s. */
export const SEARCH_FIELD_BUDGET_MS = 15_000;
/** A combobox its adapter declared, whose text box filters its list as typed, with at least this many options (or a
 *  list read only in part), has its planned option searched for by its words rather than scrolled to: Greenhouse's
 *  phone country lists 244 countries, its country questions about 200, its Yes/No, EEO and month lists a dozen at most
 *  (dom/widgets' searchesList). The core's own number (core/matcher/searchLimits.ts), which the planner's long-list
 *  search reads too (v4). */
export const WIDGET_SEARCH_MIN_OPTIONS = SEARCH_LIST_MIN_OPTIONS;
/** A file's upload, as the page shows it (fillers/upload.ts): waited for at most this long after the file went in. */
export const UPLOAD_CONFIRM_CAP_MS = 10_000;
/** A page that shows a file's upload done counts once it has been quiet this long: its failure message may follow. */
export const UPLOAD_QUIET_MS = 1_000;
/** jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): after the upload filler pressed the link that shows a hidden file input
 *  (fillers/upload.ts revealUpload), the input is read again once the page has been quiet this long, never sooner
 *  (Jobright's JazzHR uploadResume waits 300 ms), and at each quiet window after... */
export const UPLOAD_REVEAL_SETTLE_MS = 300;
/** ...until it shows, at most this long after the press: then the row is the person's. */
export const UPLOAD_REVEAL_CAP_MS = 2_000;
/** jr6 ENGINE E3 (FIXPLAN §6.2 item 13, U-05 and WD-18): after the tags filler chose a value's result or pressed its
 *  Add (widgets/tags.ts), the box's chips are awaited this long at most for the value to show as one (Jobright's
 *  fillSkills reads the chips again 100 to 200 ms after each add). */
export const TAGS_ADD_CAP_MS = 3_000;
/** ...and a box's adds, all its values together, add no further value once they have run this long (checked before each
 *  value after the first added): Workday's Skills takes up to its adapter's cap of them, each one a search. */
export const TAGS_FIELD_BUDGET_MS = 60_000;
/** After an auto-advance click, the step transition waits at most this long. */
export const TRANSITION_CAP_MS = 20_000;
/** The URL poll, where the Navigation API is missing. */
export const URL_POLL_MS = 500;
