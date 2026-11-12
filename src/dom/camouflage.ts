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
 * v3 Phase 7b: where an image below makes the compositing 'unknown', the nearest opaque layer of plain colour that is
 * painted wholly under the content judged (the text's own box, a Range over its text nodes; a control's box), with no
 * rounded corner, stands for everything beneath it (opaqueLayerUnder); a layer the content overflows or lies outside
 * does not (the v3 Phase 6/7b review, S4).
 */
import type { Adapter } from '../adapters/types';
import { BLACK, between, contrast, fade, gradientStops, leastContrast, over, parseColor, type Rgba, WHITE } from './color';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import { isInOwnUi } from './own-ui';
import { flatContains, flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import {
  CAMOUFLAGE_MAX_CONTRAST, CONTROL_DRAWN_MIN_CONTRAST, DARK_CANVAS_RGB, MAX_BACKGROUND_CANDIDATES, MIN_BOX_PX, MIN_FONT_PX,
  MIN_OPACITY, MIN_OUTLINE_PX, MIN_SHADOW_REACH_PX, WRAPPER_CONTROL_MIN_SHARE, WRAPPER_DECORATION_MAX_PX, WRAPPER_HUG_PX,
} from './thresholds';
import { absoluteContainingBlock, fixedContainingBlock, isMasked, isUserVisible, opacityOf } from './visibility';

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
    const backdrop = backdropOf(el, cache, ownTextBox(el));
    if (backdrop === 'unknown') return 'unknown';
    const text = fade(fill ?? color, opacity);
    const verdict = against(text, backdrop);
    if (verdict !== 'clear' && !outlined(style, backdrop, opacity, doc)) return verdict;
    // The security fix of 2026-11-06 (S8): words read clear on a translucent layer's bound only where no other box is
    // painted on that layer where they are.
    if (backdrop.some((colour) => colour.hi !== undefined) && boxAtTheWords(el, cache)) return 'unknown';
    return firstLineVerdict(el, backdrop, opacity, cache);
  });
}

// ── The security fix of 2026-11-06 (S8): the translucent layer's bound, no wider than before for a box at the words ──
/** A box painted inside a panel (paintedBoxesIn). */
interface PaintedBox {
  el: Element;
  box: Box;
}

/**
 * Whether a box of colour that is not one of `el`'s ancestors (paintedBoxesIn) is painted, inside the layer the
 * translucent ones lie on (panelOf: the nearest of `el` and its ancestors that paints an image or an opaque colour),
 * where a line of `el`'s words is, by MIN_BOX_PX or more on both axes. The translucent layer's bound
 * (opaqueLayerUnder, the core pass of 2026-11-06) reads only the words' ancestors, so on such a box it would read
 * words clear that a person cannot see (the review's P6a:
 * #111 words over a #111 box on a translucent panel over an image); before that bound such words read 'unknown', and
 * so they do again. Known limit (the review's P-1, older than the bound): on an opaque panel, or with no image below,
 * the compositing still follows ancestors alone, not painted layers, so such a box there is not seen.
 */
function boxAtTheWords(el: Element, cache: ScanCache): boolean {
  const lines = ownTextLines(el);
  if (lines.length === 0) return false;
  return paintedBoxesIn(panelOf(el, cache), cache).some((painted) => painted.el !== el && !flatContains(painted.el, el)
    && lines.some((line) => overlap(line.left, line.right, painted.box.left, painted.box.right) >= MIN_BOX_PX
      && overlap(line.top, line.bottom, painted.box.top, painted.box.bottom) >= MIN_BOX_PX));
}

/** The nearest of `el` and its ancestors that paints an image or an opaque colour, else the document's root: the layer
 *  the translucent layers over it lie on, which every box inside it may show through. */
function panelOf(el: Element, cache: ScanCache): Element {
  for (let at: Element | null = el; at !== null; at = flatParent(at)) {
    const style = styleOf(at, cache);
    if (style === null) continue;
    const bg = parseColor(style.backgroundColor, at.ownerDocument);
    if ((bg !== null && bg.a >= 1) || (style.backgroundImage !== '' && style.backgroundImage !== 'none')) return at;
  }
  return el.ownerDocument.documentElement;
}

/** The boxes painted inside `panel` (its descendants, open shadow roots included, the panel itself and the extension's
 *  own UI left out): visible, making a box, and a background colour that shows at their opacity or an image. */
function paintedBoxesIn(panel: Element, cache: ScanCache): readonly PaintedBox[] {
  return cache.memo('painted-boxes', panel, (): readonly PaintedBox[] => {
    const found: PaintedBox[] = [];
    const scopes: Array<Element | ShadowRoot> = [panel];
    if (panel.shadowRoot !== null) scopes.push(panel.shadowRoot);
    for (let at = 0; at < scopes.length; at += 1) {
      for (const el of Array.from(scopes[at]!.querySelectorAll('*'))) {
        if (el.shadowRoot !== null) scopes.push(el.shadowRoot);
        if (isInOwnUi(el)) continue;
        const style = styleOf(el, cache);
        if (style === null || style.visibility !== 'visible' || style.display === 'contents') continue;
        const image = style.backgroundImage !== '' && style.backgroundImage !== 'none';
        const bg = parseColor(style.backgroundColor, el.ownerDocument);
        if (!image && (bg === null || bg.a === 0)) continue;
        if (opacityOf(el, cache) * (image ? 1 : bg!.a) < MIN_OPACITY) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        found.push({ el, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
      }
    }
    return found;
  });
}

/** Each line box of `el`'s own words (its own text nodes, or the nodes assigned to a slot, as ownTextBox reads them). */
function ownTextLines(el: Element): Box[] {
  const doc = el.ownerDocument;
  const lines: Box[] = [];
  const assigned = el.localName === 'slot' ? (el as HTMLSlotElement).assignedNodes() : [];
  for (const node of assigned.length > 0 ? assigned : Array.from(el.childNodes)) {
    if (node.nodeType !== 3 || (node.textContent ?? '').trim() === '') continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) {
        lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
    }
  }
  return lines;
}

/** How far two spans overlap (negative when apart). */
function overlap(start: number, end: number, from: number, to: number): number {
  return Math.min(end, to) - Math.max(start, from);
}
// ── end of the security fix's block (S8) ──

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
  const backdrop = backdropOf(el, cache, el.getBoundingClientRect());
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
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 7, O4): before the wrapper rule, the box its adapter declares (Adapter.controlBox:
 * Oracle's phone number, borderless inside the bordered group it shares with its country code) draws it, where that box
 * is visible, holds the control (across shadow roots) and encloses it, and shows a border, an outline, a shadow or a
 * background (drawnByDeclaredBox). `adapter`: the scan's (null: none declares a box).
 */
export function isControlCamouflaged(control: Element, placeholderVisible: boolean,
  cache: ScanCache = newScanCache(), adapter: Adapter | null = null): boolean {
  const style = styleOf(control, cache);
  if (style === null) return true;
  const parent = flatParent(control);
  if (hasUnknownEffect(style) || zUnder(control, parent, cache)) return true;
  const behind = parent === null ? [canvasOf(control.ownerDocument, cache)]
    : backdropOf(parent, cache, control.getBoundingClientRect());
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
  if (stops === null) return false;
  // Its own gradient draws it only where it paints at all and a colour of it shows (round 4, Y2: one of no size, or in
  // the colours behind it, draws nothing).
  if (stops.length > 0 && gradientCover(style) !== 'none' && stops.some(shows)) return false;
  if (shows(parseColor(style.backgroundColor, doc))) return false;
  if (drawnShadows(style.boxShadow, doc).some(shows)) return false;
  if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1
    && shows(parseColor(style.outlineColor, doc))) return false;
  if (drawnByDeclaredBox(control, adapter, cache)) return false; // jr6 ENGINE
  return !drawnByWrapper(control, cache);
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 7, O4): the box an adapter declares draws a borderless control ──
/**
 * Whether the element the adapter declares as the control's drawn box (Adapter.controlBox) draws it: Oracle's
 * input.phone-row__input has no border, background or outline of its own, and the bordered white box a person types in
 * is its group div.input-row-composite__inputs.phone-row[role=group], which also holds the country code's picker
 * (fixtures/oracle/hjf-apply-section.html; the jr6 Oracle audit's O4), so the wrapper rule (drawnByWrapper) refuses it
 * as shared. The declared box counts where it is not the control, holds it (across shadow roots), a person can see it,
 * its visibility is 'visible', its box encloses the control's, and it shows a border, an outline or a shadow
 * (drawnByWrapper's reading) or a background, against what is behind it. Unlike a wrapper, it may hold other controls:
 * the adapter wrote it from a snapshot. None declared, or a hook that throws: false. jr7 ENGINE-7 E2 (DFPC-7's PC7-04):
 * a declared box may also be a decoration beside the control (declaredDecoration: MUI's outlined box, Paycom's, draws
 * its border on an aria-hidden fieldset inside the input root, beside the input); only where the adapter declares it.
 */
function drawnByDeclaredBox(control: Element, adapter: Adapter | null, cache: ScanCache): boolean {
  if (adapter?.controlBox === undefined) return false;
  let box: Element | null;
  try {
    box = adapter.controlBox(control) ?? null;
  } catch {
    return false;
  }
  if (box === null || box === control) return false;
  // jr7 ENGINE-7 E2 (DFPC-7's PC7-04): or the declared decoration beside it.
  const decoration = declaredDecoration(box, control, cache);
  if (!decoration && (!flatContains(box, control) || !isUserVisible(box, cache))) return false;
  const style = styleOf(box, cache);
  const outer = box.getBoundingClientRect();
  if (style === null || style.visibility !== 'visible' || !encloses(outer, control.getBoundingClientRect())) return false;
  return drawsBox(box, style, outer, cache, true) || pseudoEdgeDraws(box, cache); // jr7 ENGINE-7 E2 (UKGR-5)
}
// ── end jr6 ENGINE E2 item 7 ──

// ── jr7 ENGINE-7 E2 (DFPC-7's PC7-04: Paycom's outlined text boxes, textareas and selects) ──
/** The controls a decoration never holds. */
const DECORATION_HOLDS_NONE = 'input, select, textarea, button, [contenteditable]:not([contenteditable="false" i])';

/**
 * Whether the box an adapter declares for a control (Adapter.controlBox) is a decoration drawn beside it: MUI's
 * outlined text box (Paycom, snapshot7 paycomonline1 apply-2) draws its border on a <fieldset aria-hidden="true"> laid
 * over its input root, beside the input, so the box neither holds the control nor reads as visible (aria-hidden). It
 * counts only where the box itself says aria-hidden="true" (never an aria-hidden it sits under: its parent must be
 * visible), holds no control of any kind, and its parent holds the control and a person can see that parent. The rest
 * of drawnByDeclaredBox's rules then hold as for any declared box (visibility 'visible', its box enclosing the
 * control's, an edge or a fill that shows). Never read for a box no adapter declares: an undeclared aria-hidden wrapper,
 * and a white-on-white or clipped honeypot (judged by the visibility rules before any of this), stay as they are.
 */
function declaredDecoration(box: Element, control: Element, cache: ScanCache): boolean {
  if ((box.getAttribute('aria-hidden') ?? '').trim().toLowerCase() !== 'true') return false;
  const parent = box.parentElement;
  if (parent === null || !flatContains(parent, control) || !isUserVisible(parent, cache)) return false;
  return box.querySelector(DECORATION_HOLDS_NONE) === null && !box.matches(DECORATION_HOLDS_NONE);
}
// ── end jr7 ENGINE-7 E2 (PC7-04) ──

// ── jr7 ENGINE-7 E2 (UKGR-5, gated by O-7: TOOLING-7's live-order re-check still read UKG Ready's boxes camouflaged) ──
/** The thinnest pseudo-element edge pseudoEdgeDraws counts: a border or an inset ring this wide draws a line a person
 *  sees (UKG Ready's 0.5 px ring), under MIN_SHADOW_REACH_PX, which an outer shadow needs. */
const PSEUDO_EDGE_MIN_PX = 0.5;

/**
 * Whether the declared box draws its edge with a pseudo-element: UKG Ready's span.c-form-control__field is white on
 * the page's near-white (or on its white dialogs) and its edge is its ::before, absolutely positioned at inset 0 with an
 * inset box-shadow ring of 0.5 px in a dark translucent colour (snapshot7 secure7.saashr; the UKG Ready audit's UKGR-5).
 * A ::before or ::after counts only where it is generated (content not none), shown (display not none, visibility
 * visible, opacity at MIN_OPACITY or above), absolutely positioned at inset 0 (it covers the box), and draws a border on
 * a side, or an inset box-shadow of spread PSEUDO_EDGE_MIN_PX or more, in a colour that shows against the box's own
 * fill (CONTROL_DRAWN_MIN_CONTRAST). A pseudo-box with no visible edge draws nothing: a honeypot stays refused.
 */
function pseudoEdgeDraws(box: Element, cache: ScanCache): boolean {
  const view = viewOf(box);
  const doc = box.ownerDocument;
  if (view === null) return false;
  const fill = backdropOf(box, cache);
  if (fill === 'unknown') return false;
  const opacity = opacityOf(box, cache);
  return (['::before', '::after'] as const).some((which) => {
    let pseudo: CSSStyleDeclaration;
    try {
      pseudo = view.getComputedStyle(box, which);
    } catch {
      return false;
    }
    if (pseudo.content === 'none' || pseudo.content === 'normal' || pseudo.display === 'none'
      || pseudo.visibility !== 'visible' || pseudo.position !== 'absolute') return false;
    if (!['top', 'right', 'bottom', 'left'].every((side) => parseFloat(pseudo.getPropertyValue(side)) === 0)) return false;
    const alpha = opacity * Number(pseudo.opacity);
    if (!Number.isFinite(alpha) || alpha < MIN_OPACITY) return false;
    const shows = (colour: Rgba | null) => colour !== null && colour.a * alpha >= MIN_OPACITY
      && against(fade(colour, alpha), fill, CONTROL_DRAWN_MIN_CONTRAST) === 'clear';
    const border = (['top', 'right', 'bottom', 'left'] as const).some((side) => {
      const lineStyle = pseudo.getPropertyValue(`border-${side}-style`);
      return lineStyle !== 'none' && lineStyle !== 'hidden'
        && parseFloat(pseudo.getPropertyValue(`border-${side}-width`)) >= PSEUDO_EDGE_MIN_PX
        && shows(parseColor(pseudo.getPropertyValue(`border-${side}-color`), doc));
    });
    // An inset ring: an inset shadow whose spread draws a line inside the box's edge (insetShadows reads them).
    return border || (insetShadows(pseudo.boxShadow, doc) ?? []).some((ring) => ring.spread >= PSEUDO_EDGE_MIN_PX
      && shows(ring.colour));
  });
}

// ── end jr7 ENGINE-7 E2 (UKGR-5) ──

/**
 * Some forms draw a control's box on an element around it instead of on the control: Greenhouse outlines the
 * div.input-wrapper around each text input and textarea, whose own border is none
 * (fixtures/greenhouse/*.html: `.text-input-wrapper .input-wrapper { outline: 1px solid ... }`), and that wrapper holds
 * the field's label too. So the control counts as drawn when an ancestor inside its field container (an ancestor that
 * holds no other field control, below the form) shows a border, outline or box shadow, and that ancestor's box hugs
 * the control and its own labels: it encloses them, within WRAPPER_HUG_PX on every side. A wrapper shared with another
 * control, a box the control spills out of, and a card around a whole section (a heading and a paragraph above a
 * borderless input: DOM-4) do not count.
 * Core pass Z2 of 2026-11-06: a wrapper whose only content is the control and its decorations (onlyDecorations: no
 * word, digit or other control, nothing to press) is the control's box when its content box (inside its border and
 * padding) hugs them within WRAPPER_HUG_PX: Rippling draws each text box's border on a wrapper 17 px wider than the
 * input on each side, its padding (fixtures/rippling/qu-careers-form.html: div.css-1mlcsw, 16 px padding and a 1 px
 * border around Location's search icon and input, or a custom question's input alone); BambooHR's LinkedIn URL shares
 * its bordered MuiInputBase-root with a start adornment, an icon (fixtures/bamboohr/swyfft-form.html). A wrapper that
 * holds words, another control or a button, or whose content box is wider than what it holds, still does not count.
 * The security fix of 2026-11-06 (S6): each decoration is an icon's size (WRAPPER_DECORATION_MAX_PX on each axis), and
 * the control spans most of the wrapper's content box (more than WRAPPER_CONTROL_MIN_SHARE of it on each axis): a 4 px
 * input beside a wide empty box inside a bordered wrapper is no box a person sees to type into.
 */
function drawnByWrapper(control: Element, cache: ScanCache): boolean {
  const inner = control.getBoundingClientRect();
  for (let at = control.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'form' || at.localName === 'body' || at.localName === 'html') return false;
    if (holdsAnotherControl(at, control, cache)) return false;
    const style = styleOf(at, cache);
    const outer = at.getBoundingClientRect();
    if (style === null || style.visibility !== 'visible' || !encloses(outer, inner)) continue;
    if (!hugs(outer, fieldBox(control, at, inner, cache))) {
      const decorated = onlyDecorations(at, control, inner);
      const content = contentBox(outer, style);
      if (decorated === null || !hugs(content, decorated) || !spansMost(inner, content)) continue;
    }
    if (drawsBox(at, style, outer, cache, false)) return true;
  }
  return false;
}

/** Whether `el` draws a box a person sees around what it holds: a border on any side, an outline or a box shadow (and,
 *  with `background`, a background colour or gradient) in a colour that shows against what is behind it. Behind it
 *  unknown: no. drawnByWrapper reads it without the background; jr6 ENGINE E2's declared box (drawnByDeclaredBox)
 *  with it. */
function drawsBox(el: Element, style: CSSStyleDeclaration, outer: DOMRect, cache: ScanCache, background: boolean):
  boolean {
  const doc = el.ownerDocument;
  const parent = flatParent(el);
  const behind = parent === null ? [canvasOf(doc, cache)] : backdropOf(parent, cache, outer);
  if (behind === 'unknown') return false;
  const opacity = opacityOf(el, cache);
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
  if (edge || outline || drawnShadows(style.boxShadow, doc).some(shows)) return true;
  if (!background) return false;
  // jr6 ENGINE E2 (item 7): a background a person sees, its colour or a gradient's stop that paints.
  const stops = gradientStops(style.backgroundImage, doc);
  if (stops !== null && stops.length > 0 && gradientCover(style) !== 'none' && stops.some(shows)) return true;
  return shows(parseColor(style.backgroundColor, doc));
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

/** What can be pressed or typed into, besides a native control: such an element is no decoration. */
const PRESSABLE = 'a[href], button, label, summary, [contenteditable]:not([contenteditable="false" i]), [role="button" i], '
  + '[role="link" i], [role="checkbox" i], [role="radio" i], [role="switch" i], [role="combobox" i], [role="textbox" i], '
  + '[role="menuitem" i], [role="option" i], [role="tab" i], [tabindex]:not([tabindex="-1"])';

/** A letter or a digit: words, numbers, a label's text. */
const WORDISH = /[\p{L}\p{N}]/u;

/**
 * Core pass Z2 of 2026-11-06 (drawnByWrapper): the box of `control` and of everything else `wrapper` holds, when all of
 * that else is decoration: no text with a letter or a digit (shown or not), no native control (a hidden input
 * included), nothing a person can press or type into (PRESSABLE), open shadow roots read too; else null. Stricter than
 * it need be: text no one can see still disqualifies the wrapper.
 */
function onlyDecorations(wrapper: Element, control: Element, inner: DOMRect): Box | null {
  const box: Box = { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom };
  const stack: Node[] = [...Array.from(wrapper.shadowRoot?.childNodes ?? []), ...Array.from(wrapper.childNodes)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === control) continue;
    if (node.nodeType === 3) {
      if (WORDISH.test(node.textContent ?? '')) return null;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.contains(control)) {
      // An element around the control: its own other content is read, the control's own is not.
      stack.push(...Array.from(el.shadowRoot?.childNodes ?? []), ...Array.from(el.childNodes));
      continue;
    }
    if (el.matches(CONTROL_SELECTOR) || el.matches(PRESSABLE)) return null;
    const r = el.getBoundingClientRect();
    // The security fix of 2026-11-06 (S6): a decoration is an icon's size.
    if (r.width > WRAPPER_DECORATION_MAX_PX || r.height > WRAPPER_DECORATION_MAX_PX) return null;
    if (r.width > 0 && r.height > 0) {
      box.left = Math.min(box.left, r.left);
      box.top = Math.min(box.top, r.top);
      box.right = Math.max(box.right, r.right);
      box.bottom = Math.max(box.bottom, r.bottom);
    }
    stack.push(...Array.from(el.shadowRoot?.childNodes ?? []), ...Array.from(el.childNodes));
  }
  return box;
}

/** The security fix of 2026-11-06 (S6): whether the control's box spans more than WRAPPER_CONTROL_MIN_SHARE of the
 *  wrapper's content box on each axis. */
function spansMost(inner: DOMRect, content: Box): boolean {
  const width = content.right - content.left;
  const height = content.bottom - content.top;
  return width > 0 && height > 0 && inner.width > width * WRAPPER_CONTROL_MIN_SHARE
    && inner.height > height * WRAPPER_CONTROL_MIN_SHARE;
}

/** A box's content box: inside its border and its padding. */
function contentBox(outer: DOMRect, style: CSSStyleDeclaration): Box {
  const inset = (side: 'top' | 'right' | 'bottom' | 'left') => (parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0)
    + (parseFloat(style.getPropertyValue(`padding-${side}`)) || 0);
  return { left: outer.left + inset('left'), top: outer.top + inset('top'), right: outer.right - inset('right'),
    bottom: outer.bottom - inset('bottom') };
}

/** `outer` reaches no more than WRAPPER_HUG_PX past `inner` on any side. */
function hugs(outer: Box, inner: Box): boolean {
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

/** How a colour reads against each colour that may be behind it: under `threshold` contrast it is lost. Against a
 *  colour known only between bounds (a translucent layer over an image: opaqueLayerUnder), it reads clear only where
 *  its least contrast over every colour between them passes (leastContrast); else what shows is unknown. */
function against(text: Rgba, backdrop: readonly Rgba[], threshold: number = CAMOUFLAGE_MAX_CONTRAST):
  CamouflageVerdict {
  let camouflaged = 0;
  let unsure = false;
  for (const behind of backdrop) {
    if (behind.hi !== undefined) {
      if (leastContrast(text, behind) < threshold) unsure = true;
    } else if (contrast(over(text, behind), behind) < threshold) camouflaged += 1;
  }
  if (camouflaged === 0 && !unsure) return 'clear';
  return camouflaged === backdrop.length ? 'camouflaged' : 'unknown';
}

/** A box on the page, in CSS pixels: the content whose backdrop is read (S4 of the v3 Phase 6/7b review). */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The opaque colours behind `el`'s content: the canvas, then every ancestor's background down to `el`'s own. With the
 * box of the content judged (`subject`), each of those counts only as far as it paints under the content, and what
 * paints over a background must stay clear of it (heldUnder); where the colours cannot be worked out (a background
 * image below), the nearest opaque layer painted wholly under it stands for everything beneath it (opaqueLayerUnder).
 * Content drawn under its ancestors' backgrounds (a negative z-index that applies, on it or on anything above it) is
 * 'unknown' (the v3 Phase 6/7b review's rounds 2 and 3: E2, K2, X2, X3).
 */
function backdropOf(el: Element, cache: ScanCache, subject: Box | null = null): Backdrop {
  if (negativeZ(el, cache)) return 'unknown';
  const composed = cache.memo('backdrop', el, (): Backdrop => {
    const parent = flatParent(el);
    const below = parent === null ? [canvasOf(el.ownerDocument, cache)] : backdropOf(parent, cache);
    if (below === 'unknown') return 'unknown';
    const style = styleOf(el, cache);
    if (style === null || hasUnknownEffect(style)) return 'unknown';
    return layer(el, style, below, cache);
  });
  if (subject === null) return composed;
  return composed === 'unknown' ? opaqueLayerUnder(el, subject, cache) : heldUnder(el, subject, cache);
}

/** Whether `el` or anything above it is drawn with a negative z-index, which may put it under the backgrounds of what
 *  holds it: one that applies, on a positioned element or on a flex or grid item (positioned or not). */
function negativeZ(el: Element, cache: ScanCache): boolean {
  return cache.memo('negative-z', el, (): boolean => {
    const parent = flatParent(el);
    if (zUnder(el, parent, cache)) return true;
    return parent !== null && negativeZ(parent, cache);
  });
}

/** Whether `el`'s own z-index is negative where it applies (round 2, E2: a static flex or grid item counts; round 3,
 *  X2: its layout parent is the nearest that is not display: contents, and an old flexbox, -webkit-box, is a flexbox). */
function zUnder(el: Element, parent: Element | null, cache: ScanCache): boolean {
  const style = styleOf(el, cache);
  if (style === null || !(parseFloat(style.zIndex) < 0)) return false;
  if (style.position !== 'static') return true;
  let holder = parent;
  let holderStyle = holder === null ? null : styleOf(holder, cache);
  while (holder !== null && holderStyle !== null && holderStyle.display === 'contents') {
    holder = flatParent(holder);
    holderStyle = holder === null ? null : styleOf(holder, cache);
  }
  return holderStyle !== null && /flex|grid|-webkit-box|-webkit-inline-box/.test(holderStyle.display);
}

/**
 * `el`'s own background composited over `below`, or 'unknown'. An element whose visibility is not `visible`, or that
 * makes no box (display: contents), paints no background, so what is below shows through it (round 2, E2; round 3,
 * X3). A border image may paint inside the box: 'unknown'. Inset shadows are the subject's to weigh (heldUnder).
 */
function layer(el: Element, style: CSSStyleDeclaration, below: readonly Rgba[], cache: ScanCache): Backdrop {
  if (style.visibility !== 'visible' || style.display === 'contents') return [...below];
  const doc = el.ownerDocument;
  const bg = parseColor(style.backgroundColor, doc);
  const stops = gradientStops(style.backgroundImage, doc);
  if (bg === null || stops === null || borderImaged(style)) return 'unknown';
  const opacity = opacityOf(el, cache);
  let result = below.map((colour) => over(fade(bg, opacity), colour));
  if (stops.length > 0) {
    // The gradients replace what is under them only where they paint the whole box (round 4 of the v3 Phase 6/7b
    // review, Y2): a band, one pushed aside or one of no size leaves the colour beneath showing too.
    const cover = gradientCover(style);
    const painted = result.flatMap((colour) => stops.map((stop) => over(fade(stop, opacity), colour)));
    result = cover === 'all' ? painted : cover === 'none' ? result : [...result, ...painted];
  }
  const unique = dedupe(result);
  return unique.length > MAX_BACKGROUND_CANDIDATES ? 'unknown' : unique;
}

/**
 * How much of its box an element's background gradients paint, by their computed background-size, -position and
 * -repeat (round 4 of the v3 Phase 6/7b review, Y2): 'all' where every one fills it on both axes (repeated, or sized to
 * the whole box, auto, cover, contain or 100%, at a percentage or zero offset); 'none' where every one is of no size;
 * else 'some'. A gradient has no size of its own, so auto, cover and contain are the whole box.
 */
function gradientCover(style: CSSStyleDeclaration): 'all' | 'some' | 'none' {
  const layers = splitTopLevel(style.backgroundImage).length;
  const sizes = splitTopLevel(style.backgroundSize || 'auto');
  const positions = splitTopLevel(style.backgroundPosition || '0% 0%');
  const repeats = splitTopLevel(style.backgroundRepeat || 'repeat');
  let all = true;
  let none = true;
  for (let index = 0; index < layers; index += 1) {
    const size = sizes[index % sizes.length]!.trim();
    const [sx, sy] = size === 'cover' || size === 'contain' ? ['100%', '100%'] : pair(size, 'auto');
    const [px, py] = pair(positions[index % positions.length]!, '50%');
    const repeat = repeats[index % repeats.length]!.trim();
    const [rx, ry] = repeat === 'repeat-x' ? ['repeat', 'no-repeat'] : repeat === 'repeat-y' ? ['no-repeat', 'repeat']
      : pair(repeat, repeat);
    const empty = (value: string) => value !== 'auto' && parseFloat(value) === 0;
    if (!empty(sx) && !empty(sy)) none = false;
    const fills = (extent: string, offset: string, repeated: string) => !empty(extent)
      && (repeated === 'repeat' || repeated === 'round'
        || ((extent === 'auto' || extent === '100%') && (offset.endsWith('%') || parseFloat(offset) === 0)));
    const twoValues = positions[index % positions.length]!.trim().split(/\s+/).length <= 2;
    if (!(twoValues && fills(sx, px, rx) && fills(sy, py, ry))) all = false;
  }
  return all ? 'all' : none ? 'none' : 'some';
}

/** A computed one- or two-value property as its two values, the second `otherwise` when only one is given. */
function pair(value: string, otherwise: string): [string, string] {
  const parts = value.trim().split(/\s+/);
  return [parts[0] ?? otherwise, parts[1] ?? otherwise];
}

/** One inset box-shadow: its colour, its offsets, its blur and its spread (CSS pixels). */
interface InsetShadow {
  colour: Rgba;
  x: number;
  y: number;
  blur: number;
  spread: number;
}

/** A box-shadow's inset shadows ([] for none), or null when one cannot be read. */
function insetShadows(value: string, doc: Document): InsetShadow[] | null {
  if (value === '' || value === 'none') return [];
  const shadows: InsetShadow[] = [];
  for (const shadow of splitTopLevel(value)) {
    if (!/\binset\b/.test(shadow)) continue;
    const colourText = /rgba?\([^)]*\)|transparent|[a-z]+\([^)]*\)/i.exec(shadow)?.[0];
    const colour = colourText === undefined ? null : parseColor(colourText, doc);
    const lengths = shadow.replace(colourText ?? '', '').replace(/\binset\b/, '').trim().split(/\s+/)
      .filter((part) => part !== '').map((part) => parseFloat(part));
    if (colour === null || lengths.length < 2 || lengths.some((length) => !Number.isFinite(length))) return null;
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    if (colour.a > 0) shadows.push({ colour, x, y, blur: Math.max(0, blur), spread });
  }
  return shadows;
}

/** Whether an inset shadow of `el` paints where `subject` is: inside `el`'s padding box, outside the hole the shadow
 *  leaves (the padding box moved by its offsets and shrunk by its spread and half its blur). A thin ring, an underline
 *  bar or a soft vignette at the edge stays clear of text inset by padding (round 3, X5). */
function shadowReaches(el: Element, style: CSSStyleDeclaration, shadow: InsetShadow, subject: Box): boolean {
  const box = el.getBoundingClientRect();
  const border = (side: 'top' | 'right' | 'bottom' | 'left') => parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
  const padding: Box = { left: box.left + border('left'), top: box.top + border('top'), right: box.right - border('right'),
    bottom: box.bottom - border('bottom') };
  if (!intersects(padding, subject)) return false;
  const inset = shadow.spread + shadow.blur / 2;
  const hole: Box = { left: padding.left + shadow.x + inset, top: padding.top + shadow.y + inset,
    right: padding.right + shadow.x - inset, bottom: padding.bottom + shadow.y - inset };
  return !(hole.right > hole.left && hole.bottom > hole.top && holds(hole, subject));
}

/** Whether an outline of `el` drawn inside its box (a negative outline-offset) paints where `subject` is (round 3, X3);
 *  one drawn outside its box never does. */
function outlineOver(el: Element, style: CSSStyleDeclaration, subject: Box): boolean {
  const width = parseFloat(style.outlineWidth);
  const offset = parseFloat(style.outlineOffset) || 0;
  if (style.outlineStyle === 'none' || !(width > 0) || offset >= 0) return false;
  const box = el.getBoundingClientRect();
  const inner: Box = { left: box.left - offset, top: box.top - offset, right: box.right + offset, bottom: box.bottom + offset };
  const outer: Box = { left: inner.left - width, top: inner.top - width, right: inner.right + width, bottom: inner.bottom + width };
  return intersects(outer, subject) && !(inner.right > inner.left && inner.bottom > inner.top && holds(inner, subject));
}

/** Whether a text decoration thicker than a line (over 3 px) is drawn: in its colour it can cover the glyphs it runs
 *  through (round 3, X3). */
function thickDecoration(style: CSSStyleDeclaration): boolean {
  const line = style.textDecorationLine;
  return line !== undefined && line !== '' && line !== 'none' && parseFloat(style.textDecorationThickness) > 3;
}

/** Whether an element's background paints the whole canvas: the root's, or the body's where the root draws none. */
function paintsCanvas(el: Element, cache: ScanCache): boolean {
  if (el.localName === 'html') return true;
  if (el.localName !== 'body' || el.parentElement?.localName !== 'html') return false;
  const root = styleOf(el.parentElement, cache);
  const bg = root === null ? null : parseColor(root.backgroundColor, el.ownerDocument);
  return bg !== null && bg.a === 0 && (root?.backgroundImage === 'none' || root?.backgroundImage === '');
}

/**
 * The backdrop of content whose box is `subject`, inside `el`, held to where each layer paints (the v3 Phase 6/7b
 * review's round 3, X3 and X5). From the content out, what of it shows at each box (clipOf: a box below that clips its
 * overflow cuts it, a scrolling one brings it into view; a hidden overflow that cuts all of it leaves it 'unknown'; jr6
 * ENGINE E2, the ICIMS package's ICIMS-01: as on screen, a box positioned absolutely escapes the overflow of the boxes
 * between it and its containing block, a fixed one of every box below its own: escapesClipOf);
 * an outline drawn inside a box over it, or a text decoration thicker than a line: 'unknown'. Then from the canvas in,
 * each layer that makes a box and is visible is composited where it paints:
 * - one whose background changes what shows counts as far as its painted box (by background-clip, clear of its
 *   rounded corners) covers what of the content shows there: under all of it, its colours replace those below; under
 *   none (a layer of no height the text overflows, content positioned past it, a background clipped to the content box
 *   with the text in the padding), it adds nothing; under a part (a narrow layer the text runs out of), both are
 *   candidates. The root's, and a body's painting the canvas, cover everything. Turned, skewed or drawn in 3D (turnsAt),
 *   its box is no longer where it paints: 'unknown';
 * - an inset shadow that paints where the content is adds its colour over that layer's as one more candidate; one that
 *   stays clear of it (a ring, an underline bar, a vignette inset by padding) adds nothing.
 * The candidates, near-equal colours merged, beyond MAX_BACKGROUND_CANDIDATES: 'unknown'.
 */
function heldUnder(el: Element, subject: Box, cache: ScanCache): Backdrop {
  const chain: Element[] = [];
  for (let at: Element | null = el; at !== null; at = flatParent(at)) chain.push(at);
  // What of the content shows at each box that paints (null: one that paints nothing).
  const shownAt: Array<Box | null> = [];
  // jr6 ENGINE E2 (ICIMS-01): whether each box's overflow cuts the content (escapesClipOf).
  const cutsAt: boolean[] = [];
  let escape: Escape = null;
  let shown: Box | null = subject;
  for (const at of chain) {
    const style = styleOf(at, cache);
    if (style === null || thickDecoration(style)) return 'unknown';
    if (style.display === 'contents') {
      shownAt.push(null);
      cutsAt.push(false);
      continue;
    }
    if (shown === null) return 'unknown';
    const paints = style.visibility === 'visible';
    if (paints && outlineOver(at, style, shown)) return 'unknown';
    shownAt.push(paints ? shown : null);
    // jr6 ENGINE: a box the content escapes (between an absolute box and its containing block) cuts nothing of it.
    const cuts = escape === null || escape.until === at;
    cutsAt.push(cuts);
    if (cuts) shown = clipOf(at, style, shown);
    escape = escapesClipOf(at, style, escape, cache); // jr6 ENGINE
  }
  let candidates: Rgba[] = [canvasOf(el.ownerDocument, cache)];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const at = chain[index]!;
    const visible = shownAt[index];
    const style = styleOf(at, cache);
    if (visible === null || visible === undefined || style === null) continue;
    const layered = layer(at, style, candidates, cache);
    if (layered === 'unknown') return 'unknown';
    if (keyOf(layered) !== keyOf(candidates) && !paintsCanvas(at, cache)) {
      if (turnsAt(at, cache)) return 'unknown';
      const covers = coverageOf(at, style, visible, cutsAt[index] !== false); // jr6 ENGINE
      candidates = covers === 'all' ? layered : covers === 'none' ? candidates : dedupe([...candidates, ...layered]);
    } else {
      candidates = layered;
    }
    const inset = insetShadows(style.boxShadow, at.ownerDocument);
    if (inset === null) return 'unknown';
    const base = candidates;
    const opacity = opacityOf(at, cache);
    for (const shadow of inset) {
      if (!shadowReaches(at, style, shadow, visible)) continue;
      candidates = dedupe([...candidates, ...base.map((colour) => over(fade(shadow.colour, opacity), colour))]);
    }
    if (candidates.length > MAX_BACKGROUND_CANDIDATES) return 'unknown';
  }
  return candidates;
}

/** How much of `shown`, what of some content shows at `el`, `el`'s background paints under: 'all' (its painted box, by
 *  background-clip, holds what of it shows past `el`, clear of its rounded corners), 'none', or a 'part'. jr6 ENGINE
 *  E2: `cuts` false, content that escapes `el`'s overflow (escapesClipOf) is all past it. */
function coverageOf(el: Element, style: CSSStyleDeclaration, shown: Box, cuts = true): 'all' | 'none' | 'part' {
  const past = cuts ? clipOf(el, style, shown) : shown;
  if (past === null) return 'all';
  const painted = paintedBox(el, style);
  if (holds(painted, past) && !cornersOver(el, style, past)) return 'all';
  return intersects(painted, past) ? 'part' : 'none';
}

// ── jr6 ENGINE E2 (the ICIMS package's ICIMS-01): overflow cuts follow the containing blocks ──
/** Where the content being walked out from escapes the overflow of the boxes it passes: up to (not including) `until`,
 *  its containing block, which cuts again; `until` null: every box above (the initial containing block, or the
 *  viewport for a fixed box). Null: it escapes nothing. */
type Escape = { until: Element | null } | null;

/**
 * The escape the walk carries past `at` (heldUnder), as the browser clips: a box positioned absolutely is cut only by
 * the overflow of its containing block and the boxes above it (visibility.ts absoluteContainingBlock), a fixed one only
 * by those above its own (fixedContainingBlock; none below the viewport), any other by every box it sits in. iCIMS
 * draws an open dropdown's results in a div.dropdown-container, position: absolute, inside its row's static
 * div.iCIMS_InfoData, 40 px tall and overflow: hidden (the ICIMS package's jr6-ars-profile-address): the cell is not
 * the container's containing block, so it never cuts the results, which a person sees below it. Reaching `until` ends
 * the escape, and `at`'s own position may start another.
 */
function escapesClipOf(at: Element, style: CSSStyleDeclaration, escape: Escape, cache: ScanCache): Escape {
  const carried = escape !== null && escape.until !== at ? escape : null;
  if (style.position === 'absolute') return { until: absoluteContainingBlock(at, cache) };
  if (style.position === 'fixed') return { until: fixedContainingBlock(at, cache) };
  return carried;
}
// ── end jr6 ENGINE E2 (ICIMS-01) ──

/** What of `subject`, a box inside `el`, shows past `el`: all of it, or, on an axis where `el` clips what overflows it,
 *  the part inside its padding box. Where that axis scrolls (a long list, a panel), content out of view is scrolled into
 *  it: then all of the padding box's extent on that axis. Null when a hidden overflow cuts all of it (a collapsed "Read
 *  more", a box with no size). */
function clipOf(el: Element, style: CSSStyleDeclaration, subject: Box): Box | null {
  if (style.overflowX === 'visible' && style.overflowY === 'visible') return subject;
  const box = el.getBoundingClientRect();
  const border = (side: 'top' | 'right' | 'bottom' | 'left') => parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
  const axis = (overflow: string, from: number, to: number, low: number, high: number): [number, number] | null => {
    if (overflow === 'visible') return [from, to];
    if (high <= low) return null;
    const start = Math.max(from, low);
    const end = Math.min(to, high);
    if (end > start) return [start, end];
    return overflow === 'auto' || overflow === 'scroll' ? [low, high] : null;
  };
  const x = axis(style.overflowX, subject.left, subject.right, box.left + border('left'), box.right - border('right'));
  const y = axis(style.overflowY, subject.top, subject.bottom, box.top + border('top'), box.bottom - border('bottom'));
  return x === null || y === null ? null : { left: x[0], top: y[0], right: x[1], bottom: y[1] };
}

/** Whether `el`'s background is painted wherever `subject`, a box inside it, shows: its painted box (its
 *  background-clip's) holds what of `subject` shows past it (clipOf: nothing showing holds). */
function paintsUnder(el: Element, style: CSSStyleDeclaration, subject: Box): boolean {
  const shown = clipOf(el, style, subject);
  return shown === null || holds(paintedBox(el, style), shown);
}

/** A backdrop's colours as one string, near-equal ones alike (dedupe's rounding), in order; a colour known between
 *  bounds by both of them. */
const keyOf = (colours: readonly Rgba[]) => dedupe([...colours]).map((colour) => {
  const own = (c: Rgba) => `${Math.round(c.r / 3)},${Math.round(c.g / 3)},${Math.round(c.b / 3)}`;
  return colour.hi === undefined ? own(colour) : `${own(colour)}~${own(colour.hi)}`;
}).sort().join(';');

/** Whether `outer` holds `inner`, half a pixel either way. */
function holds(outer: Box, inner: Box): boolean {
  return outer.right > outer.left && outer.bottom > outer.top && outer.left <= inner.left + 0.5
    && outer.top <= inner.top + 0.5 && outer.right >= inner.right - 0.5 && outer.bottom >= inner.bottom - 0.5;
}

/** Whether two boxes overlap. */
function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Whether a border image is set, which may paint over the background (its fill). */
function borderImaged(style: CSSStyleDeclaration): boolean {
  const source = style.borderImageSource;
  return source !== undefined && source !== '' && source !== 'none';
}

/** Whether `el` or an ancestor turns, skews or draws in 3D what it holds (turned). */
function turnsAt(el: Element, cache: ScanCache): boolean {
  return cache.memo('turns', el, (): boolean => {
    const style = styleOf(el, cache);
    if (style === null || turned(style)) return true;
    const parent = flatParent(el);
    return parent !== null && turnsAt(parent, cache);
  });
}

/**
 * Whether `style` turns or skews what it draws, or draws it in 3D (round 3, X4: failing closed on rotate, skew, 3D and
 * perspective alone): a transform whose matrix is not axis-aligned (b and c zero, a and d positive) or that turns around
 * or scales along the depth axis, a rotate, a mirroring or flattening scale, a perspective. A translate (along the depth
 * axis too), a positive scale and a zoom keep a box a box, whose drawn place getBoundingClientRect gives.
 */
function turned(style: CSSStyleDeclaration): boolean {
  const set = (value: string | undefined) => value !== undefined && value !== '' && value !== 'none';
  if (set(style.rotate) || set(style.perspective)) return true;
  if (set(style.scale) && style.scale!.trim().split(/\s+/).map((part) => parseFloat(part)).some((value) => !(value > 0))) {
    return true;
  }
  const transform = style.transform;
  if (!set(transform)) return false;
  const values = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (values === null) return true;
  const m = values[2]!.split(',').map((part) => parseFloat(part));
  if (m.some((value) => !Number.isFinite(value))) return true;
  if (values[1] === undefined) return !(m.length === 6 && m[1] === 0 && m[2] === 0 && m[0]! > 0 && m[3]! > 0);
  // matrix3d, column by column: a 2D axis-aligned matrix with a depth translation at most (translateZ, translate3d).
  const zeros = [1, 2, 3, 4, 6, 7, 8, 9, 11];
  return !(m.length === 16 && zeros.every((at) => m[at] === 0) && m[0]! > 0 && m[5]! > 0 && m[10] === 1 && m[15] === 1);
}

/** Whether `style` draws over its background where `subject` is, so the layer rule cannot follow it: an inset shadow
 *  that reaches the content, an outline drawn inside the box over it, a border image (rounds 2 and 3: E2, X4). */
function drawsOver(el: Element, style: CSSStyleDeclaration, subject: Box): boolean {
  if (borderImaged(style) || outlineOver(el, style, subject)) return true;
  const inset = insetShadows(style.boxShadow, el.ownerDocument);
  return inset === null || inset.some((shadow) => shadowReaches(el, style, shadow, subject));
}

/**
 * v3 Phase 7b (Taleo's white body over its html's background image, which made every word of its pages read as hidden),
 * held to the v3 Phase 6/7b review's S4 and its rounds 2 and 3 (E2, K2, X3, X4): the backdrop of content whose box is
 * `subject`, inside `el`, from the nearest of `el` and its ancestors that is an opaque layer painted wholly under it
 * (opaqueOver). What shows behind the content is that colour, with each layer between it and `el` composited over it.
 * 'unknown' where there is none, and wherever the layer, anything above it or anything between it and the content has
 * an effect this code cannot work out or turns, skews or draws in 3D what it holds (turned), or where the layer or
 * anything between draws over the content (drawsOver) or changes what shows behind it without painting where it is.
 * Content with a negative z-index never gets here (backdropOf).
 * The core pass of 2026-11-06 (Oracle's apply flow on a government-cloud tenant, fixtures/oracle/hjf-apply-section.html:
 * its form a panel of rgba(248, 248, 247, 0.75) over the tenant's cover image): where no opaque layer gives the answer,
 * a translucent layer of plain colour painted wholly under the content, under the same rules (translucentOver), bounds
 * what shows behind it: whatever the image, the layer over it lies between the layer over black and over white
 * (Rgba.hi), and the content reads clear only where its least contrast over every colour between passes (against).
 * The farthest such layer is tried first (more of what lies over the image is then known); any layer it cannot follow
 * between it and the content leaves the next nearer one to try.
 */
function opaqueLayerUnder(el: Element, subject: Box, cache: ScanCache): Backdrop {
  const chain: Array<{ el: Element; style: CSSStyleDeclaration }> = [];
  // The translucent layers met on the way, nearest first: each with its colour and the chain below it.
  const translucent: Array<{ colour: Rgba; below: number }> = [];
  for (let at: Element | null = el; at !== null; at = flatParent(at)) {
    const style = styleOf(at, cache);
    if (style === null || hasUnknownEffect(style) || turned(style) || thickDecoration(style)) return 'unknown';
    const paints = style.display !== 'contents' && style.visibility === 'visible';
    if (paints && drawsOver(at, style, subject)) return 'unknown';
    const colour = paints ? opaqueOver(at, style, subject, cache) : null;
    if (colour !== null) {
      const result = composedOver([colour], chain, chain.length, subject, cache);
      if (result !== 'unknown') return result;
      break;
    }
    const tint = paints ? translucentOver(at, style, subject, cache) : null;
    if (tint !== null) translucent.push({ colour: tint, below: chain.length });
    chain.push({ el: at, style });
  }
  for (let index = translucent.length - 1; index >= 0; index -= 1) {
    const { colour, below } = translucent[index]!;
    const result = composedOver([between(over(colour, BLACK), over(colour, WHITE))], chain, below, subject, cache);
    if (result !== 'unknown') return result;
  }
  return 'unknown';
}

/** `base` with the first `count` layers of `chain` (the content's nearest first) composited over it, outermost first;
 *  'unknown' where one cannot be followed, or changes what shows without painting where the content is (X3). */
function composedOver(base: Rgba[], chain: ReadonlyArray<{ el: Element; style: CSSStyleDeclaration }>, count: number,
  subject: Box, cache: ScanCache): Backdrop {
  let result: Backdrop = base;
  for (let index = count - 1; index >= 0 && result !== 'unknown'; index -= 1) {
    const { el: inner, style: innerStyle } = chain[index]!;
    const before: Backdrop = result;
    result = layer(inner, innerStyle, result, cache);
    if (result !== 'unknown' && keyOf(result) !== keyOf(before) && !paintsUnder(inner, innerStyle, subject)) {
      return 'unknown';
    }
  }
  return result;
}

/** The core pass of 2026-11-06: `el`'s background colour when it is a translucent layer of plain colour painted wholly
 *  under `subject` (opaqueLayerUnder): as opaqueOver asks of an opaque one (visible, no image or gradient, at full
 *  opacity, no effect above it, its painted area holding `subject` clear of its rounded corners), with a colour that is
 *  neither opaque nor transparent; else null. */
function translucentOver(el: Element, style: CSSStyleDeclaration, subject: Box, cache: ScanCache): Rgba | null {
  if (style.visibility !== 'visible') return null;
  const bg = parseColor(style.backgroundColor, el.ownerDocument);
  const stops = gradientStops(style.backgroundImage, el.ownerDocument);
  if (bg === null || !(bg.a > 0 && bg.a < 1) || stops === null || stops.length > 0 || opacityOf(el, cache) < 1) return null;
  if (effectAbove(el, cache)) return null;
  if (!paintsUnder(el, style, subject) || cornersOver(el, style, subject)) return null;
  return bg;
}

/** `el`'s background colour when it is an opaque layer painted wholly under `subject` (opaqueLayerUnder): visible, an
 *  opaque background colour with no image, at full opacity, nothing above it that has an effect or turns what it holds,
 *  its painted area (its background-clip's box) holding `subject`, and a rounded corner only where `subject` stays
 *  clear of it (round 3, X4); else null. */
function opaqueOver(el: Element, style: CSSStyleDeclaration, subject: Box, cache: ScanCache): Rgba | null {
  if (style.visibility !== 'visible') return null;
  const bg = parseColor(style.backgroundColor, el.ownerDocument);
  const stops = gradientStops(style.backgroundImage, el.ownerDocument);
  if (bg === null || bg.a < 1 || stops === null || stops.length > 0 || opacityOf(el, cache) < 1) return null;
  if (effectAbove(el, cache)) return null;
  if (!paintsUnder(el, style, subject) || cornersOver(el, style, subject)) return null;
  return bg;
}

/** Whether `subject` reaches past a rounded corner of `el`, where its background is not painted: each corner's own
 *  radii, horizontal and vertical (a percentage of the box's size), scaled down together where neighbours overlap, as
 *  CSS draws them (a pill's 25 px on a box 22 px high is 11 px); `subject`'s point nearest that corner, half a pixel in,
 *  outside the corner's ellipse. `subject` lies inside `el`'s box. */
function cornersOver(el: Element, style: CSSStyleDeclaration, subject: Box): boolean {
  const box = el.getBoundingClientRect();
  const radii = (corner: string): [number, number] => {
    const parts = style.getPropertyValue(`border-${corner}-radius`).trim().split(/\s+/);
    const read = (part: string | undefined, size: number) => (part === undefined ? NaN
      : part.endsWith('%') ? (parseFloat(part) / 100) * size : parseFloat(part));
    const x = read(parts[0], box.width);
    const y = read(parts[1] ?? parts[0], box.height);
    return [Number.isFinite(x) ? Math.max(0, x) : 0, Number.isFinite(y) ? Math.max(0, y) : 0];
  };
  const [tl, tr, br, bl] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(radii) as Array<[number, number]>;
  const fits = (side: number, sum: number) => (sum > side ? side / sum : 1);
  const scale = Math.min(fits(box.width, tl![0] + tr![0]), fits(box.width, bl![0] + br![0]),
    fits(box.height, tl![1] + bl![1]), fits(box.height, tr![1] + br![1]));
  const inner: Box = { left: Math.max(box.left, subject.left + 0.5), top: Math.max(box.top, subject.top + 0.5),
    right: Math.min(box.right, subject.right - 0.5), bottom: Math.min(box.bottom, subject.bottom - 0.5) };
  if (inner.right <= inner.left || inner.bottom <= inner.top) return false;
  // Each corner: its radii, which way it lies from its ellipse's centre, and the subject's point nearest it.
  const corners: Array<[[number, number], number, number, number, number]> = [
    [tl!, -1, -1, inner.left, inner.top], [tr!, 1, -1, inner.right, inner.top],
    [br!, 1, 1, inner.right, inner.bottom], [bl!, -1, 1, inner.left, inner.bottom],
  ];
  return corners.some(([[rx, ry], sx, sy, x, y]) => {
    const radiusX = rx * scale;
    const radiusY = ry * scale;
    if (radiusX <= 0 || radiusY <= 0) return false;
    const cx = sx < 0 ? box.left + radiusX : box.right - radiusX;
    const cy = sy < 0 ? box.top + radiusY : box.bottom - radiusY;
    if ((x - cx) * sx <= 0 || (y - cy) * sy <= 0) return false;
    return ((x - cx) / radiusX) ** 2 + ((y - cy) / radiusY) ** 2 > 1;
  });
}

/** The box `el`'s background is painted in: its border box, or its padding or content box by its background-clip. */
function paintedBox(el: Element, style: CSSStyleDeclaration): Box {
  const box = el.getBoundingClientRect();
  const clip = style.backgroundClip || 'border-box';
  const inset = (side: 'top' | 'right' | 'bottom' | 'left') => {
    const border = parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0;
    const padding = parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
    return /content-box/.test(clip) ? border + padding : /padding-box/.test(clip) ? border : 0;
  };
  return { left: box.left + inset('left'), top: box.top + inset('top'), right: box.right - inset('right'),
    bottom: box.bottom - inset('bottom') };
}

/** The box of `el`'s own text (a Range over its own text nodes), or of `el` itself when it holds none. A slot's own
 *  text is what it renders: the nodes assigned to it (else its fallback content). Core pass Z2 of 2026-11-06: a slot
 *  is display: contents, its own box empty at the page's origin, so text slotted into a shadow root (UltiPro's
 *  ukg-label, fixtures/ultipro/register.html: "First name" slotted into its shadow root's <slot>) was judged where it is
 *  not, cut by the account card's overflow: hidden, and read 'unknown'. */
function ownTextBox(el: Element): Box {
  const doc = el.ownerDocument;
  let box: Box | null = null;
  const assigned = el.localName === 'slot' ? (el as HTMLSlotElement).assignedNodes() : [];
  for (const node of assigned.length > 0 ? assigned : Array.from(el.childNodes)) {
    if (node.nodeType !== 3 || (node.textContent ?? '').trim() === '') continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      box = box === null ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top),
          right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom) };
    }
  }
  return box ?? el.getBoundingClientRect();
}

/** Whether an ancestor of `el` has an effect whose result on the colours this code cannot work out (hasUnknownEffect),
 *  turns, skews or draws in 3D what it holds (turned), draws an outline inside its box, or a border image: it changes
 *  how everything inside it is drawn, an opaque layer included. An ancestor's inset shadow paints under the layer. */
function effectAbove(el: Element, cache: ScanCache): boolean {
  const parent = flatParent(el);
  if (parent === null) return false;
  return cache.memo('effect-above', parent, (): boolean => {
    const style = styleOf(parent, cache);
    if (style === null || hasUnknownEffect(style) || turned(style) || borderImaged(style)) return true;
    const insideOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      && (parseFloat(style.outlineOffset) || 0) < 0;
    return insideOutline || effectAbove(parent, cache);
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
  // Near-equal colours are one (each channel within NEAR_COLOUR of a kept one: round 3, X5), so faint nested shadows
  // never pass the candidates' cap.
  const kept: Rgba[] = [];
  const near = (a: Rgba, b: Rgba) => Math.abs(a.r - b.r) <= NEAR_COLOUR && Math.abs(a.g - b.g) <= NEAR_COLOUR
    && Math.abs(a.b - b.b) <= NEAR_COLOUR;
  // A colour known between bounds is one with another only where both bounds are (the core pass of 2026-11-06).
  const same = (a: Rgba, b: Rgba) => near(a, b) && (a.hi === undefined ? b.hi === undefined
    : b.hi !== undefined && near(a.hi, b.hi));
  for (const colour of colours) {
    if (!kept.some((other) => same(other, colour))) kept.push(colour);
  }
  return kept;
}

/** How far apart two channels of colours that read the same may be (of 255). */
const NEAR_COLOUR = 2;

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
