/*
 * isCamouflaged (docs/design/runtime.md §5.2; docs/ARCHITECTURE.md "Visibility"): text whose colour is nearly the
 * colour behind it ("white on white") is hidden from people as surely as display: none, so it is treated the same way.
 *
 * The background behind an element is composited from the canvas up through every ancestor's background colour and
 * gradient stops, each faded by the opacity above it. A background image, `background-clip: text`, a transparent
 * `-webkit-text-fill-color`, `mix-blend-mode`, `filter` or `backdrop-filter` make the answer 'unknown', which callers
 * treat as hidden (fail closed). A contrasting text-shadow or text stroke makes text clear. Known limit: this follows
 * DOM ancestors, not painted layers, so a positioned sibling drawn behind the text is not seen.
 */
import { contrast, fade, gradientStops, over, parseColor, type Rgba, WHITE } from './color';
import { flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import {
  CAMOUFLAGE_MAX_CONTRAST, CONTROL_DRAWN_MIN_CONTRAST, DARK_CANVAS_RGB, MAX_BACKGROUND_CANDIDATES, MIN_OPACITY,
  MIN_OUTLINE_PX,
} from './thresholds';
import { opacityOf } from './visibility';

/** 'unknown' means the colours behind the text cannot be worked out; it counts as hidden. */
export type CamouflageVerdict = 'clear' | 'camouflaged' | 'unknown';

/** The opaque colours that may sit behind an element's content (several under a gradient), or 'unknown'. */
type Backdrop = Rgba[] | 'unknown';

/** Is the text of `el` camouflaged against what is behind it? */
export function isCamouflaged(el: Element, cache: ScanCache = newScanCache()): CamouflageVerdict {
  return cache.memo('camouflage', el, (): CamouflageVerdict => {
    const style = styleOf(el, cache);
    if (style === null) return 'unknown';
    const doc = el.ownerDocument;
    const color = parseColor(style.color, doc);
    if (color === null) return 'unknown';
    const opacity = opacityOf(el, cache);
    // Transparent text is camouflaged whatever is behind it.
    if (color.a * opacity < MIN_OPACITY) return 'camouflaged';
    const fill = style.webkitTextFillColor ? parseColor(style.webkitTextFillColor, doc) : null;
    // A transparent fill over a visible colour is gradient or image text (background-clip: text): unknown.
    if (fill !== null && fill.a * opacity < MIN_OPACITY) return 'unknown';
    const backdrop = backdropOf(el, cache);
    if (backdrop === 'unknown') return 'unknown';
    const text = fade(fill ?? color, opacity);
    const verdict = against(text, backdrop);
    if (verdict === 'clear') return 'clear';
    if (outlined(style, backdrop, opacity, doc)) return 'clear';
    return verdict;
  });
}

/** How a text colour (already faded by its opacity) reads against `el`'s own background: used for placeholders,
 *  whose colour comes from the ::placeholder pseudo-element. */
export function textAgainstBackground(text: Rgba, el: Element, cache: ScanCache = newScanCache()): CamouflageVerdict {
  const backdrop = backdropOf(el, cache);
  return backdrop === 'unknown' ? 'unknown' : against(text, backdrop);
}

/**
 * A control drawn so that it cannot be seen: no visible border on any side, a background that matches what is behind
 * it, no box shadow, no outline and no visible placeholder. Such a control is never filled. Natively drawn widgets
 * (a checkbox, a radio, a select or a file button with their default appearance) always show themselves. When the
 * colours behind cannot be worked out, the control is not called camouflaged: this check only catches the clear case.
 */
export function isControlCamouflaged(control: Element, placeholderVisible: boolean,
  cache: ScanCache = newScanCache()): boolean {
  const style = styleOf(control, cache);
  if (style === null) return false;
  if (drawnNatively(control, style)) return false;
  if (placeholderVisible) return false;
  const parent = flatParent(control);
  const behind = parent === null ? [canvasOf(control.ownerDocument, cache)] : backdropOf(parent, cache);
  if (behind === 'unknown') return false;
  const doc = control.ownerDocument;
  const opacity = opacityOf(control, cache);
  const shows = (colour: Rgba | null) => colour !== null && colour.a * opacity >= MIN_OPACITY
    && against(fade(colour, opacity), behind, CONTROL_DRAWN_MIN_CONTRAST) === 'clear';
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const borderStyle = style.getPropertyValue(`border-${side}-style`);
    const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
    if (borderStyle !== 'none' && borderStyle !== 'hidden' && width >= 1
      && shows(parseColor(style.getPropertyValue(`border-${side}-color`), doc))) return false;
  }
  const stops = gradientStops(style.backgroundImage, doc);
  if (stops === null || stops.length > 0) return false;
  if (shows(parseColor(style.backgroundColor, doc))) return false;
  if (style.boxShadow !== '' && style.boxShadow !== 'none' && shadowColours(style.boxShadow, doc)
    .some((shadow) => shadow.a * opacity >= MIN_OPACITY)) return false;
  if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
    && shows(parseColor(style.outlineColor, doc))) return false;
  return true;
}

/** Is a native `<option>` camouflaged in the select's list? The list is drawn by the browser on the select's own
 *  background (then the optgroup's and the option's), not on the page, so only those layers count. */
export function optionCamouflage(option: HTMLOptionElement, select: HTMLSelectElement,
  cache: ScanCache = newScanCache()): CamouflageVerdict {
  const doc = select.ownerDocument;
  let behind = canvasOf(doc, cache);
  const group = option.parentElement?.localName === 'optgroup' ? option.parentElement : null;
  for (const layer of [select, group, option]) {
    if (layer === null) continue;
    const style = styleOf(layer, cache);
    const bg = style === null ? null : parseColor(style.backgroundColor, doc);
    if (bg === null) return 'unknown';
    behind = over(bg, behind);
  }
  const style = styleOf(option, cache);
  const text = style === null ? null : parseColor(style.color, doc);
  if (text === null) return 'unknown';
  if (text.a < MIN_OPACITY) return 'camouflaged';
  return against(text, [behind]);
}

// ── Compositing ──────────────────────────────────────────────────────────────────────────────────────────────────

/** How a colour reads against each colour that may be behind it: under `threshold` contrast it is lost. */
function against(text: Rgba, backdrop: readonly Rgba[], threshold: number = CAMOUFLAGE_MAX_CONTRAST):
  CamouflageVerdict {
  let camouflaged = 0;
  for (const behind of backdrop) {
    if (contrast(over(text, behind), behind) < threshold) camouflaged += 1;
  }
  if (camouflaged === 0) return 'clear';
  return camouflaged === backdrop.length ? 'camouflaged' : 'unknown';
}

/** The opaque colours behind `el`'s content: the canvas, then every ancestor's background down to `el`'s own. */
function backdropOf(el: Element, cache: ScanCache): Backdrop {
  return cache.memo('backdrop', el, (): Backdrop => {
    const parent = flatParent(el);
    const below = parent === null ? [canvasOf(el.ownerDocument, cache)] : backdropOf(parent, cache);
    if (below === 'unknown') return 'unknown';
    const style = styleOf(el, cache);
    if (style === null || hasUnknownEffect(style)) return 'unknown';
    const doc = el.ownerDocument;
    const bg = parseColor(style.backgroundColor, doc);
    const stops = gradientStops(style.backgroundImage, doc);
    if (bg === null || stops === null) return 'unknown';
    const opacity = opacityOf(el, cache);
    let result = below.map((colour) => over(fade(bg, opacity), colour));
    if (stops.length > 0) result = result.flatMap((colour) => stops.map((stop) => over(fade(stop, opacity), colour)));
    const unique = dedupe(result);
    return unique.length > MAX_BACKGROUND_CANDIDATES ? 'unknown' : unique;
  });
}

function hasUnknownEffect(style: CSSStyleDeclaration): boolean {
  const set = (value: string | undefined) => value !== undefined && value !== '' && value !== 'none'
    && value !== 'normal';
  return set(style.mixBlendMode) || set(style.filter) || set(style.backdropFilter)
    || /\btext\b/.test(style.backgroundClip ?? '') || /\btext\b/.test(style.getPropertyValue('-webkit-background-clip'));
}

function dedupe(colours: Rgba[]): Rgba[] {
  const seen = new Set<string>();
  return colours.filter((colour) => {
    const id = `${Math.round(colour.r)},${Math.round(colour.g)},${Math.round(colour.b)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The canvas under the page: white, or Chromium's dark canvas when the page uses a dark colour scheme that applies
 *  (dark only, or light and dark while the browser prefers dark). */
function canvasOf(doc: Document, cache: ScanCache): Rgba {
  return cache.memo('canvas', doc, (): Rgba => {
    const root = doc.documentElement;
    const computed = root ? styleOf(root, cache)?.colorScheme ?? 'normal' : 'normal';
    const meta = doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? '';
    const schemes = (computed !== 'normal' ? computed : meta).toLowerCase().split(/[\s,]+/);
    if (!schemes.includes('dark')) return WHITE;
    const prefersDark = viewOf(doc)?.matchMedia('(prefers-color-scheme: dark)').matches ?? false;
    if (schemes.includes('light') && !prefersDark) return WHITE;
    const [r, g, b] = DARK_CANVAS_RGB;
    return { r, g, b, a: 1 };
  });
}

/** Controls that draw something of their own whatever their borders say: a file input's button and a date input's
 *  segments always, and a select, checkbox, radio, range or colour well while its native appearance is on. */
function drawnNatively(control: Element, style: CSSStyleDeclaration): boolean {
  const type = control.localName === 'input' ? (control as HTMLInputElement).type : '';
  if (['file', 'date', 'month', 'week', 'time', 'datetime-local'].includes(type)) return true;
  if (style.appearance === 'none') return false;
  if (control.localName === 'select') return true;
  return ['checkbox', 'radio', 'range', 'color'].includes(type);
}

// ── Outlines ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A text-shadow with some offset or blur, or a text stroke, that contrasts with every colour behind the text. */
function outlined(style: CSSStyleDeclaration, backdrop: readonly Rgba[], opacity: number, doc: Document): boolean {
  const visible = (colour: Rgba | null) => colour !== null && colour.a * opacity >= MIN_OPACITY
    && against(fade(colour, opacity), backdrop) === 'clear';
  const strokeWidth = parseFloat(style.getPropertyValue('-webkit-text-stroke-width'));
  if (strokeWidth >= MIN_OUTLINE_PX && visible(parseColor(style.getPropertyValue('-webkit-text-stroke-color'), doc))) {
    return true;
  }
  if (style.textShadow === '' || style.textShadow === 'none') return false;
  return splitTopLevel(style.textShadow).some((shadow) => {
    const colourText = /rgba?\([^)]*\)|transparent|[a-z]+\([^)]*\)/i.exec(shadow)?.[0];
    const lengths = shadow.replace(colourText ?? '', '').trim().split(/\s+/).map((part) => parseFloat(part));
    const [x = 0, y = 0, blur = 0] = lengths.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0));
    return (x >= MIN_OUTLINE_PX || y >= MIN_OUTLINE_PX || blur >= MIN_OUTLINE_PX)
      && visible(colourText === undefined ? null : parseColor(colourText, doc));
  });
}

/** The colours of a computed box-shadow list. */
function shadowColours(value: string, doc: Document): Rgba[] {
  return splitTopLevel(value).map((shadow) => {
    const colourText = /rgba?\([^)]*\)|transparent|[a-z]+\([^)]*\)/i.exec(shadow)?.[0];
    return colourText === undefined ? null : parseColor(colourText, doc);
  }).filter((colour): colour is Rgba => colour !== null);
}

/** Splits a comma-separated list at commas outside parentheses. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(value.slice(from).trim());
  return parts.filter((part) => part !== '');
}
