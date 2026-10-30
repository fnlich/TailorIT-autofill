/*
 * isCamouflaged (docs/design/runtime.md §5.2; docs/ARCHITECTURE.md "Visibility"): text whose colour is nearly the
 * colour behind it ("white on white") is hidden from people as surely as display: none, so it is treated the same way.
 *
 * The background behind an element is composited from the canvas up through every ancestor's background colour and
 * gradient stops, each faded by the opacity above it (`filter: opacity()` included). A background image,
 * `background-clip: text`, a transparent `-webkit-text-fill-color`, `mix-blend-mode`, `backdrop-filter`, a mask, or a
 * filter other than opacity() make the answer 'unknown', which callers treat as hidden (fail closed). The first line
 * and the first letter may be drawn in colours of their own (::first-line, ::first-letter, on the element or an
 * ancestor): each must read clear too. A contrasting text-shadow or text stroke makes text clear. Known limit: this
 * follows DOM ancestors, not painted layers, so a positioned sibling drawn behind the text is not seen.
 */
import { contrast, fade, gradientStops, over, parseColor, type Rgba, WHITE } from './color';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import { flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import {
  CAMOUFLAGE_MAX_CONTRAST, CONTROL_DRAWN_MIN_CONTRAST, DARK_CANVAS_RGB, MAX_BACKGROUND_CANDIDATES, MIN_FONT_PX,
  MIN_OPACITY, MIN_OUTLINE_PX, MIN_SHADOW_REACH_PX, WRAPPER_HUG_PX,
} from './thresholds';
import { isMasked, isUserVisible, opacityOf } from './visibility';

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
    if (verdict !== 'clear' && !outlined(style, backdrop, opacity, doc)) return verdict;
    return firstLineVerdict(el, backdrop, opacity, cache);
  });
}

/** How a ::first-line or ::first-letter draws text differently from its element. */
interface PseudoText {
  /** The glyphs' colour: the fill colour, which paints over `color`. */
  glyph: string;
  fontSize: string;
  background: string;
  backgroundImage: string;
}

const PSEUDO_TEXT = ['::first-line', '::first-letter'] as const;

/**
 * The ::first-line and ::first-letter styles of `el` and of its ancestors that draw text otherwise than the element
 * they belong to (S4: a label whose ::first-line is white on white still named its field). An ancestor's applies to
 * the first line of what it holds, unless a descendant sets its own colour; that case is not told apart, so it fails
 * closed.
 */
function pseudoTextOf(el: Element, cache: ScanCache): readonly PseudoText[] {
  return cache.memo('pseudo-text', el, (): readonly PseudoText[] => {
    const parent = flatParent(el);
    const inherited = parent === null ? [] : pseudoTextOf(parent, cache);
    const view = viewOf(el);
    const style = styleOf(el, cache);
    if (view === null || style === null) return inherited;
    const own: PseudoText[] = [];
    for (const pseudo of PSEUDO_TEXT) {
      const drawn = view.getComputedStyle(el, pseudo);
      const glyph = drawn.webkitTextFillColor || drawn.color;
      const background = drawn.backgroundColor;
      const backgroundImage = drawn.backgroundImage;
      const plainBackground = (background === '' || parseColor(background, el.ownerDocument)?.a === 0)
        && (backgroundImage === '' || backgroundImage === 'none');
      if (glyph === (style.webkitTextFillColor || style.color) && drawn.fontSize === style.fontSize && plainBackground) {
        continue;
      }
      own.push({ glyph, fontSize: drawn.fontSize, background, backgroundImage });
    }
    return own.length === 0 ? inherited : [...inherited, ...own];
  });
}

/** 'clear' when every first line and first letter that applies to `el`'s text reads clear against what is behind it. */
function firstLineVerdict(el: Element, backdrop: readonly Rgba[], opacity: number, cache: ScanCache): CamouflageVerdict {
  const doc = el.ownerDocument;
  for (const pseudo of pseudoTextOf(el, cache)) {
    if (parseFloat(pseudo.fontSize) < MIN_FONT_PX) return 'camouflaged';
    if (pseudo.backgroundImage !== '' && pseudo.backgroundImage !== 'none') return 'unknown';
    const glyph = parseColor(pseudo.glyph, doc);
    const band = pseudo.background === '' ? null : parseColor(pseudo.background, doc);
    if (glyph === null || (pseudo.background !== '' && band === null)) return 'unknown';
    if (glyph.a * opacity < MIN_OPACITY) return 'camouflaged';
    const behind = band === null || band.a === 0 ? backdrop : backdrop.map((colour) => over(fade(band, opacity), colour));
    const verdict = against(fade(glyph, opacity), behind);
    if (verdict !== 'clear') return verdict;
  }
  return 'clear';
}

/** How a text colour (already faded by its opacity) reads against `el`'s own background: used for placeholders,
 *  whose colour comes from the ::placeholder pseudo-element. */
export function textAgainstBackground(text: Rgba, el: Element, cache: ScanCache = newScanCache()): CamouflageVerdict {
  const backdrop = backdropOf(el, cache);
  return backdrop === 'unknown' ? 'unknown' : against(text, backdrop);
}

/**
 * A control drawn so that it cannot be seen: no visible border on any side, a background that matches what is behind
 * it, no box shadow that reaches past its box in a colour that shows, no outline and no visible placeholder, and no
 * wrapper hugging it inside its field container drawing a box around it (drawnByWrapper). Such a control is never
 * filled. Natively drawn widgets (a checkbox, a radio, a select or a file button with their default appearance)
 * always show themselves, but only where their colours can be judged: a control under an effect this cannot work out
 * (a filter other than opacity(), a blend mode, a mask) or in front of colours it cannot work out (a background image,
 * too many gradient stops) counts as camouflaged (fails closed: DOM-3).
 */
export function isControlCamouflaged(control: Element, placeholderVisible: boolean,
  cache: ScanCache = newScanCache()): boolean {
  const style = styleOf(control, cache);
  if (style === null) return true;
  if (hasUnknownEffect(style)) return true;
  const parent = flatParent(control);
  const behind = parent === null ? [canvasOf(control.ownerDocument, cache)] : backdropOf(parent, cache);
  if (behind === 'unknown') return true;
  if (drawnNatively(control, style)) return false;
  if (placeholderVisible) return false;
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
  if (drawnShadows(style.boxShadow, doc).some(shows)) return false;
  if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
    && shows(parseColor(style.outlineColor, doc))) return false;
  return !drawnByWrapper(control, cache);
}

/**
 * Some forms draw a control's box on an element around it instead of on the control: Greenhouse outlines the
 * div.input-wrapper around each text input and textarea, whose own border is none
 * (fixtures/greenhouse/*.html: `.text-input-wrapper .input-wrapper { outline: 1px solid ... }`), and that wrapper holds
 * the field's label too. So the control counts as drawn when an ancestor inside its field container (an ancestor that
 * holds no other field control, below the form) shows a border, outline or box shadow, and that ancestor's box hugs
 * the control and its own labels: it encloses them, within WRAPPER_HUG_PX on every side. A wrapper shared with another
 * control, a box the control spills out of, and a card around a whole section (a heading and a paragraph above a
 * borderless input: DOM-4) do not count.
 */
function drawnByWrapper(control: Element, cache: ScanCache): boolean {
  const inner = control.getBoundingClientRect();
  const doc = control.ownerDocument;
  for (let at = control.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'form' || at.localName === 'body' || at.localName === 'html') return false;
    if (holdsAnotherControl(at, control, cache)) return false;
    const style = styleOf(at, cache);
    const outer = at.getBoundingClientRect();
    if (style === null || style.visibility !== 'visible' || !encloses(outer, inner)
      || !hugs(outer, fieldBox(control, at, inner, cache))) continue;
    const parent = flatParent(at);
    const behind = parent === null ? [canvasOf(doc, cache)] : backdropOf(parent, cache);
    if (behind === 'unknown') continue;
    const opacity = opacityOf(at, cache);
    const shows = (colour: Rgba | null) => colour !== null && colour.a * opacity >= MIN_OPACITY
      && against(fade(colour, opacity), behind, CONTROL_DRAWN_MIN_CONTRAST) === 'clear';
    const edge = (['top', 'right', 'bottom', 'left'] as const).some((side) => {
      const lineStyle = style.getPropertyValue(`border-${side}-style`);
      return lineStyle !== 'none' && lineStyle !== 'hidden'
        && parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1
        && shows(parseColor(style.getPropertyValue(`border-${side}-color`), doc));
    });
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
      && shows(parseColor(style.outlineColor, doc));
    const shadow = drawnShadows(style.boxShadow, doc).some(shows);
    if (edge || outline || shadow) return true;
  }
  return false;
}

/** The box of a control together with its own visible labels inside `wrapper`. */
function fieldBox(control: Element, wrapper: Element, inner: DOMRect, cache: ScanCache):
  { left: number; top: number; right: number; bottom: number } {
  const box = { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom };
  const labels = (control as HTMLInputElement).labels;
  for (const label of labels ? Array.from(labels) : []) {
    if (!wrapper.contains(label) || label.contains(control) || !isUserVisible(label, cache)) continue;
    const r = label.getBoundingClientRect();
    box.left = Math.min(box.left, r.left);
    box.top = Math.min(box.top, r.top);
    box.right = Math.max(box.right, r.right);
    box.bottom = Math.max(box.bottom, r.bottom);
  }
  return box;
}

/** `outer` reaches no more than WRAPPER_HUG_PX past `inner` on any side. */
function hugs(outer: DOMRect, inner: { left: number; top: number; right: number; bottom: number }): boolean {
  return inner.left - outer.left <= WRAPPER_HUG_PX && inner.top - outer.top <= WRAPPER_HUG_PX
    && outer.right - inner.right <= WRAPPER_HUG_PX && outer.bottom - inner.bottom <= WRAPPER_HUG_PX;
}

/**
 * True when `ancestor` holds another control a person can use: a visible field or auth control, or a hidden radio,
 * checkbox or file input shown through a visible tied label (the proxy rule). A control nobody can see does not share
 * the box: Greenhouse's phone input sits beside intl-tel-input's country search, hidden in its closed dropdown
 * (fixtures/greenhouse/*.html: div.iti inside the outlined div.input-wrapper).
 */
function holdsAnotherControl(ancestor: Element, control: Element, cache: ScanCache): boolean {
  return Array.from(ancestor.querySelectorAll(CONTROL_SELECTOR)).some((other) => {
    if (other === control) return false;
    const kind = kindOf(other);
    if (!kind.field && !kind.auth) return false;
    if (isUserVisible(other, cache)) return true;
    if (!kind.field || !['radio', 'checkbox', 'file'].includes(kind.kind)) return false;
    const labels = (other as HTMLInputElement).labels;
    return labels !== null && Array.from(labels).some((label) => isUserVisible(label, cache));
  });
}

/** `outer` encloses `inner`, to half a pixel. */
function encloses(outer: DOMRect, inner: DOMRect): boolean {
  return outer.left <= inner.left + 0.5 && outer.top <= inner.top + 0.5 && outer.right >= inner.right - 0.5
    && outer.bottom >= inner.bottom - 0.5;
}

/** Is a native `<option>` camouflaged in the select's list? The list is drawn by the browser on the select's own
 *  background (then the optgroup's and the option's), not on the page, so only those layers count. */
export function optionCamouflage(option: HTMLOptionElement, select: HTMLSelectElement,
  cache: ScanCache = newScanCache()): CamouflageVerdict {
  const doc = select.ownerDocument;
  const behind = optionBackdrop(option, select, cache);
  if (behind === null) return 'unknown';
  const style = styleOf(option, cache);
  const text = style === null ? null : parseColor(style.color, doc);
  if (text === null) return 'unknown';
  if (text.a < MIN_OPACITY) return 'camouflaged';
  return against(text, [behind]);
}

/** The opaque colour a select's list draws behind an option: the canvas, then the select's, the optgroup's and the
 *  option's own backgrounds; null when one cannot be read. */
export function optionBackdrop(option: HTMLOptionElement, select: HTMLSelectElement,
  cache: ScanCache = newScanCache()): Rgba | null {
  const doc = select.ownerDocument;
  let behind = canvasOf(doc, cache);
  const group = option.parentElement?.localName === 'optgroup' ? option.parentElement : null;
  for (const layer of [select, group, option]) {
    if (layer === null) continue;
    const style = styleOf(layer, cache);
    const bg = style === null ? null : parseColor(style.backgroundColor, doc);
    if (bg === null) return null;
    behind = over(bg, behind);
  }
  return behind;
}

/** How a colour (already faded) reads against one opaque colour behind it, at the text threshold. */
export function inkAgainst(ink: Rgba, behind: Rgba): CamouflageVerdict {
  return against(ink, [behind]);
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

/** An effect whose result on the colours this code cannot work out: a blend mode, a backdrop filter, a mask, text
 *  clipped to its background, or a filter with any function but opacity() (which opacityOf multiplies in). */
function hasUnknownEffect(style: CSSStyleDeclaration): boolean {
  const set = (value: string | undefined) => value !== undefined && value !== '' && value !== 'none'
    && value !== 'normal';
  return set(style.mixBlendMode) || unknownFilter(style.filter) || set(style.backdropFilter) || isMasked(style)
    || /\btext\b/.test(style.backgroundClip ?? '') || /\btext\b/.test(style.getPropertyValue('-webkit-background-clip'));
}

/** A computed filter list with a function other than opacity(): blur(), brightness(), drop-shadow(), url(), ... */
function unknownFilter(filter: string | undefined): boolean {
  if (filter === undefined || filter === '' || filter === 'none') return false;
  return splitFunctions(filter).some((fn) => !/^opacity\(/.test(fn));
}

/** The functions of a computed filter list, each with its arguments ("opacity(0.5)", "url(\"#f\")"). */
function splitFunctions(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        parts.push(value.slice(from, i + 1).trim());
        from = i + 1;
      }
    }
  }
  const rest = value.slice(from).trim();
  if (rest !== '') parts.push(rest);
  return parts.filter((part) => part !== '');
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

/**
 * The colours of the shadows in a computed box-shadow list that draw something: the offset, blur and spread together
 * reach MIN_SHADOW_REACH_PX past the box (or into it, for an inset shadow). A shadow of 0 0 0 0 draws nothing, however
 * dark (DOM-4); whether a colour shows against what is behind it is the caller's check. A shadow this cannot read
 * draws nothing (fails closed).
 */
function drawnShadows(value: string, doc: Document): Rgba[] {
  if (value === '' || value === 'none') return [];
  return splitTopLevel(value).flatMap((shadow) => {
    const colourText = /rgba?\([^)]*\)|transparent|[a-z]+\([^)]*\)/i.exec(shadow)?.[0];
    const colour = colourText === undefined ? null : parseColor(colourText, doc);
    const lengths = shadow.replace(colourText ?? '', '').replace(/\binset\b/, '').trim().split(/\s+/)
      .filter((part) => part !== '').map((part) => parseFloat(part));
    if (colour === null || lengths.length < 2 || lengths.some((length) => !Number.isFinite(length))) return [];
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    const reach = Math.max(Math.abs(x), Math.abs(y)) + Math.max(0, blur) + spread;
    return reach >= MIN_SHADOW_REACH_PX ? [colour] : [];
  });
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
