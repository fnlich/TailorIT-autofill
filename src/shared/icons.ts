/*
 * The extension's icons and TailorIT's mark, as data: our own drawings on a 20-unit grid, and the mark exactly as
 * TailorIT draws it (apps/web/public/logo-mark.svg: a rounded teal tile with a white "T" over a stitched seam). Two
 * builders draw them: svgOf (src/content/ui/svg.ts) in the page's closed root, with createElementNS and setAttribute,
 * and <Icon> (src/ui/brand/Icon.tsx) in the extension's pages; scripts/icons.mjs renders the mark into the manifest's
 * PNGs. No builder parses markup, and each sets only the attributes SVG_ATTRIBUTES names, so a drawing can never carry
 * an event handler, a link or a style. Every icon is decorative: aria-hidden, never a <title>, the words beside it
 * saying what it means.
 *
 * Data only, with no runtime import: Node reads this file as it is (scripts/icons.mjs), by stripping its types.
 */

/** One shape of a drawing: its tag and its attributes, by their SVG names. */
export interface SvgPart {
  readonly tag: 'path' | 'circle' | 'rect';
  readonly attrs: Readonly<Record<string, string>>;
}

/** A drawing: its view box, whether its shapes are strokes (1.8 units, round ends, in the text's colour) or fills (in
 *  the text's colour), and its shapes. */
export interface IconDef {
  readonly viewBox: string;
  readonly stroked: boolean;
  readonly parts: readonly SvgPart[];
}

/** The only shapes a drawing may hold. */
export const SVG_TAGS: ReadonlySet<string> = new Set(['path', 'circle', 'rect']);

/** The only attributes a builder sets on a shape: geometry and paint. Never an `on…` handler, `href` or `style`. */
export const SVG_ATTRIBUTES: ReadonlySet<string> = new Set(['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-rule',
  'clip-rule']);

/** The attributes a drawing's <svg> carries for its kind: strokes or fills, in the text's colour. */
export function iconRootAttributes(def: IconDef): Readonly<Record<string, string>> {
  return def.stroked
    ? { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
    : { fill: 'currentColor' };
}

const GRID = '0 0 20 20';
const ring = (r = '7.5'): SvgPart => ({ tag: 'circle', attrs: { cx: '10', cy: '10', r } });
const line = (d: string, extra: Record<string, string> = {}): SvgPart => ({ tag: 'path', attrs: { d, ...extra } });
const dot = (cx: string, cy: string): SvgPart => ({ tag: 'circle', attrs: { cx, cy, r: '1.1', fill: 'currentColor', stroke: 'none' } });
const TICK = 'M6.6 10.3l2.3 2.3 4.6-4.8';

/** The icons, by name. */
export const ICONS = {
  /** Verified: a filled circle with a white tick. */
  'check-circle': { viewBox: GRID, stroked: false, parts: [ring('8.25'),
    line(TICK, { fill: 'none', stroke: '#ffffff', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })] },
  /** Filled, or a question that needed nothing: a ring with a tick. */
  check: { viewBox: GRID, stroked: true, parts: [ring(), line(TICK)] },
  /** A tick alone (the launcher's badge when nothing needs the person). */
  tick: { viewBox: GRID, stroked: true, parts: [line('M4.75 10.5l3.4 3.4 7.1-7.3', { 'stroke-width': '2.4' })] },
  /** Needs the person: a ring with an exclamation mark. */
  alert: { viewBox: GRID, stroked: true, parts: [ring(), line('M10 5.9v5'), dot('10', '13.9')] },
  /** Blocked: a ring with a cross. */
  'x-circle': { viewBox: GRID, stroked: true, parts: [ring(), line('M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2')] },
  /** An optional field left alone (v3 Phase 3 review, Jobright's grey dash): a dash alone. */
  dash: { viewBox: GRID, stroked: true, parts: [line('M6.25 10h7.5')] },
  /** Skipped: a ring with a dash. */
  'minus-circle': { viewBox: GRID, stroked: true, parts: [ring(), line('M6.75 10h6.5')] },
  'chevron-down': { viewBox: GRID, stroked: true, parts: [line('M5.5 8l4.5 4.5 4.5-4.5')] },
  'chevron-up': { viewBox: GRID, stroked: true, parts: [line('M5.5 12l4.5-4.5 4.5 4.5')] },
  'chevron-right': { viewBox: GRID, stroked: true, parts: [line('M8 5.5l4.5 4.5L8 14.5')] },
  /** The person's own information: a head and shoulders (v3 Phase 3's "Your autofill information"). */
  person: { viewBox: GRID, stroked: true, parts: [{ tag: 'circle', attrs: { cx: '10', cy: '6.75', r: '3.25' } },
    line('M3.75 17.25a6.25 6.25 0 0 1 12.5 0')] },
  /** Something to drag: two columns of three dots (the launcher's grip). */
  grip: { viewBox: GRID, stroked: false, parts: [dot('7.5', '5.5'), dot('12.5', '5.5'), dot('7.5', '10'), dot('12.5', '10'),
    dot('7.5', '14.5'), dot('12.5', '14.5')] },
  /** Written by the AI: a four-pointed star. */
  sparkle: { viewBox: GRID, stroked: false, parts: [line('M10 2l1.6 4.8a2.4 2.4 0 0 0 1.6 1.6L18 10l-4.8 1.6a2.4 2.4 0 0 0-1.6 '
    + '1.6L10 18l-1.6-4.8a2.4 2.4 0 0 0-1.6-1.6L2 10l4.8-1.6a2.4 2.4 0 0 0 1.6-1.6z')] },
  /** Working: a faint ring and a quarter arc (the stylesheet turns it). */
  spinner: { viewBox: GRID, stroked: true, parts: [{ tag: 'circle', attrs: { cx: '10', cy: '10', r: '7', opacity: '0.25' } },
    line('M17 10a7 7 0 0 0-7-7')] },
  /** Settings: a cog of eight teeth (outer radius 8.6, root 6.7) around a hole of radius 2.7. */
  gear: { viewBox: GRID, stroked: false, parts: [line('M8.72 3.42L8.95 1.46A8.6 8.6 0 0 1 11.05 1.46L11.28 3.42A6.7 6.7 0 0 1 '
    + '13.75 4.45L15.29 3.22A8.6 8.6 0 0 1 16.78 4.71L15.55 6.25A6.7 6.7 0 0 1 16.58 8.72L18.54 8.95A8.6 8.6 0 0 1 18.54 '
    + '11.05L16.58 11.28A6.7 6.7 0 0 1 15.55 13.75L16.78 15.29A8.6 8.6 0 0 1 15.29 16.78L13.75 15.55A6.7 6.7 0 0 1 11.28 '
    + '16.58L11.05 18.54A8.6 8.6 0 0 1 8.95 18.54L8.72 16.58A6.7 6.7 0 0 1 6.25 15.55L4.71 16.78A8.6 8.6 0 0 1 3.22 15.29L4.45 '
    + '13.75A6.7 6.7 0 0 1 3.42 11.28L1.46 11.05A8.6 8.6 0 0 1 1.46 8.95L3.42 8.72A6.7 6.7 0 0 1 4.45 6.25L3.22 4.71A8.6 8.6 0 '
    + '0 1 4.71 3.22L6.25 4.45A6.7 6.7 0 0 1 8.72 3.42ZM12.7 10A2.7 2.7 0 1 0 7.3 10A2.7 2.7 0 1 0 12.7 10Z',
  { 'fill-rule': 'evenodd' })] },
  /** Dismiss: a cross. */
  close: { viewBox: GRID, stroked: true, parts: [line('M5.5 5.5l9 9M14.5 5.5l-9 9')] },
  /** A document with a folded corner. */
  doc: { viewBox: GRID, stroked: true, parts: [line('M5.25 2.75h6.25l3.25 3.25v11.25h-9.5z'), line('M11.5 2.75V6h3.25'),
    line('M7.75 10.5h4.5M7.75 13.5h4.5')] },
  /** Information: a ring with an "i". */
  info: { viewBox: GRID, stroked: true, parts: [ring(), line('M10 9.1v5'), dot('10', '6.2')] },
  // ── v4 ui: the side panel in Jobright's layout (our own drawings on the same grid) ──
  /** Autofill in one click (the set-up view's mark): a lightning bolt, its two strokes joined at a slanted waist. */
  bolt: { viewBox: GRID, stroked: true, parts: [line('M11.6 1.9L4.4 11.2h5.1l-1.1 6.9 7.2-9.3h-5.1z')] },
  /** A field not filled (D1): an empty ring alone, drawn grey by the stylesheet. */
  circle: { viewBox: GRID, stroked: true, parts: [ring()] },
  /** An explanation on hover or focus (HelpTip): a ring with a question mark. */
  help: { viewBox: GRID, stroked: true, parts: [ring(), line('M7.9 8a2.15 2.15 0 1 1 3.1 1.95c-.6.3-1 .8-1 1.45v.45'),
    dot('10', '14.1')] },
  /** A preview: an eye, its outline and its pupil. */
  eye: { viewBox: GRID, stroked: true, parts: [line('M1.9 10s3-5.6 8.1-5.6 8.1 5.6 8.1 5.6-3 5.6-8.1 5.6S1.9 10 1.9 10z'),
    { tag: 'circle', attrs: { cx: '10', cy: '10', r: '2.4' } }] },
  /** Add: a plus. */
  plus: { viewBox: GRID, stroked: true, parts: [line('M10 4.5v11M4.5 10h11')] },
  // ── end v4 ui ──
} as const satisfies Record<string, IconDef>;

/** An icon's name. */
export type IconName = keyof typeof ICONS;

const WHITE = '#ffffff';
/** The mark's "T" and its stitched seam, without the tile: what the launcher draws on its own teal tile. */
const MARK_GLYPH: readonly SvgPart[] = [
  { tag: 'rect', attrs: { x: '7.5', y: '7', width: '17', height: '4.5', rx: '2.25', fill: WHITE } },
  { tag: 'rect', attrs: { x: '13.75', y: '7', width: '4.5', height: '15', rx: '2.25', fill: WHITE } },
  { tag: 'path', attrs: { d: 'M8 25.75h16', fill: 'none', stroke: WHITE, 'stroke-width': '1.75', 'stroke-linecap': 'round',
    'stroke-dasharray': '2.25 2.75', opacity: '0.9' } },
];

/** TailorIT's mark (apps/web/public/logo-mark.svg), its colours written in full: the teal tile (palette BRAND.fill),
 *  then the glyph. */
export const LOGO_MARK: IconDef = {
  viewBox: '0 0 32 32',
  stroked: false,
  parts: [{ tag: 'rect', attrs: { width: '32', height: '32', rx: '9', fill: '#14a1c0' } }, ...MARK_GLYPH],
};

/** The mark without its tile. */
export const LOGO_GLYPH: IconDef = { viewBox: '0 0 32 32', stroked: false, parts: MARK_GLYPH };
