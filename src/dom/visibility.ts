/*
 * isUserVisible (docs/design/runtime.md §5.1; docs/ARCHITECTURE.md "Visibility"): could a person see this element? Only
 * what passes ever becomes a field, a label, an option or LLM input; everything else is a honeypot or hidden text.
 *
 * The browser's checkVisibility (with its opacity, visibility and content-visibility options) runs first where it
 * exists, and a manual walk always runs after it. The walk is also the whole check where checkVisibility is missing
 * (older Safari), and it covers what checkVisibility never looks at: the hidden, inert and aria-hidden attributes, an
 * open modal dialog, the content of a closed <details>, a mask of any kind, a back face turned away under a 3D
 * transform, `filter: opacity()` (multiplied into the opacity product), boxes under 4 px, off-screen positions,
 * clipping by overflow, `clip` and `clip-path`, tiny fonts and a tiny frame. A shape it cannot measure counts as
 * hidden: uncertain cases fail closed. Off-screen is judged in document coordinates downwards (content below the fold
 * still counts) but within the viewport's width across, since a box placed far to the right only widens the page's
 * scroll area.
 *
 * Known limit (docs/ARCHITECTURE.md, Risks, 3): an element covered by an opaque overlay still counts as visible
 * (occlusion is not tested here; the in-page UI checks its own controls with IntersectionObserver v2 instead).
 */
import { isInOwnUi } from './own-ui';
import { flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import { MIN_BOX_PX, MIN_CLIP_RADIUS_PX, MIN_FONT_PX, MIN_OPACITY } from './thresholds';

/** The rules, in the order they run; the first that fails names why an element is hidden. */
export const VISIBILITY_RULES = ['disconnected', 'own-ui', 'frame', 'deferred', 'native-check', 'hidden-attribute',
  'inert', 'outside-modal', 'aria-hidden', 'display-none', 'closed-details', 'mask', 'backface', 'content-visibility',
  'opacity', 'visibility', 'box-size', 'off-screen', 'overflow-clip', 'font-size', 'clip', 'clip-path'] as const;
export type VisibilityRule = (typeof VISIBILITY_RULES)[number];

/** Why an element is or is not visible. */
export interface VisibilityVerdict {
  visible: boolean;
  /** The first rule that failed; null when visible. */
  rule: VisibilityRule | null;
  /** Hidden only because `content-visibility: auto` has not rendered it yet: counted as a deferred field, and the
   *  notice asks the person to scroll to it. */
  deferred: boolean;
}

/** A rectangle in client (viewport) coordinates. */
export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const NATIVE: CheckVisibilityOptions = { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true,
  checkOpacity: true, checkVisibilityCSS: true };
const NATIVE_WITHOUT_AUTO: CheckVisibilityOptions = { opacityProperty: true, visibilityProperty: true,
  checkOpacity: true, checkVisibilityCSS: true };

const VISIBLE: VisibilityVerdict = { visible: true, rule: null, deferred: false };
const hidden = (rule: VisibilityRule): VisibilityVerdict => ({ visible: false, rule, deferred: rule === 'deferred' });

/** Could a person see `el`? */
export function isUserVisible(el: Element, cache: ScanCache = newScanCache()): boolean {
  return visibilityOf(el, cache).visible;
}

/** The fixed boxes that hold a declared widget's list drawn where its field is (followsItsField): judged where they
 *  stand in the page, as their field is, never as fixed to the viewport. Kept until the list closes (stopsFollowing). */
const FOLLOWING_FIELDS = new WeakSet<Element>();

/** How far from its field's edge a list drawn at the field's place may start, in CSS px (Workable's dialog starts at the
 *  box's own bottom). */
const FOLLOW_GAP_PX = 24;

/** The nearest fixed box holding `list` inside `shared`, or null. */
function fixedBoxOf(list: Element, shared: Element | null): Element | null {
  for (let at: Element | null = list; at !== null && at !== shared; at = flatParent(at)) {
    if (at.ownerDocument.defaultView?.getComputedStyle(at).position === 'fixed') return at;
  }
  return null;
}

/**
 * A declared widget's open list that its page draws `position: fixed` at its field's place on screen
 * (WidgetDecl.listFollowsField: Workable's dropdowns, whose fixed dialog's top is the field's own bottom, so a field
 * below the fold opens its list beyond the viewport, where a person who scrolled to the field would see it): the
 * nearest fixed box holding the list, when it sits in the field's own part of the page (an ancestor of both that is no
 * form, body or html) and is drawn at the field (the Phase 7a review: its top or its bottom within the field's height and
 * FOLLOW_GAP_PX either side, and across the field's own width), is judged by rule 5 as a page element below the fold is, its
 * field's way, until the list closes. Every other rule stands for it and everything in it; any other fixed box, one
 * drawn elsewhere, and this one beyond the document, stay judged as fixed.
 */
export function followsItsField(list: Element, field: Element): void {
  let shared: Element | null = field.parentElement;
  while (shared !== null && !shared.contains(list)) shared = shared.parentElement;
  if (shared === null || ['html', 'body', 'form'].includes(shared.localName)) return;
  const box = fixedBoxOf(list, shared);
  if (box === null) return;
  const drawn = box.getBoundingClientRect();
  const own = field.getBoundingClientRect();
  // Its top at the field (below it, or over it), or its bottom at the field's top (a list that opens upwards).
  const near = (y: number) => y >= own.top - FOLLOW_GAP_PX && y <= own.bottom + FOLLOW_GAP_PX;
  const adjacent = near(drawn.top) || near(drawn.bottom);
  const across = drawn.left < own.right && drawn.right > own.left;
  if (adjacent && across) FOLLOWING_FIELDS.add(box);
  else FOLLOWING_FIELDS.delete(box);
}

/** The list closed (or the run is done with it): its fixed box is judged as fixed again. */
export function stopsFollowing(list: Element): void {
  const box = fixedBoxOf(list, null);
  if (box !== null) FOLLOWING_FIELDS.delete(box);
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 10, ADP-6): what a modal's focus trap alone hides ──
/** The caches whose judgments lift a focus trap's aria-hidden (visibleBesideFocusTrap): fresh ones, each for one
 *  check, so no other judgment ever reads them. */
const TRAP_LIFTED = new WeakSet<ScanCache>();

/**
 * Whether a person could see `el` but for the aria-hidden a modal's focus trap set on the page around it: judged as
 * isUserVisible is, with an aria-hidden="true" lifted only where its element carries data-old-aria-hidden, the value it
 * had before the trap, and that value was not "true" (ADP's SDF focus trap, around its BrightJump promo pane after a
 * Submit: <div data-old-aria-hidden="null" aria-hidden="true">, the jr6 ADP audit's ADP-6, snapshot6 adp1 and adp2).
 * Every other kind of hiding still hides (the hidden and inert attributes, an aria-hidden the page set itself,
 * display, visibility, opacity, size, place, clipping). Only adapters/success.ts asks it, for a success rule's sign
 * while that rule's modal (SuccessRule.underModal) is open.
 */
export function visibleBesideFocusTrap(el: Element): boolean {
  const cache = newScanCache();
  TRAP_LIFTED.add(cache);
  return visibilityOf(el, cache).visible;
}

/** An aria-hidden a focus trap set (visibleBesideFocusTrap): the element keeps its value from before, not "true". */
function trapHidden(el: Element): boolean {
  const before = el.getAttribute('data-old-aria-hidden');
  return before !== null && before.trim().toLowerCase() !== 'true';
}
// ── end jr6 ENGINE E2 item 10 ──

/** isUserVisible with the rule that decided. */
export function visibilityOf(el: Element, cache: ScanCache = newScanCache()): VisibilityVerdict {
  return cache.memo('visibility', el, () => judgeElement(el, cache));
}

function judgeElement(el: Element, cache: ScanCache): VisibilityVerdict {
  if (!el.isConnected) return hidden('disconnected');
  if (isInOwnUi(el)) return hidden('own-ui');
  const view = viewOf(el);
  const style = styleOf(el, cache);
  if (view === null || style === null) return hidden('disconnected');
  if (frameTooSmall(view)) return hidden('frame');
  // 2. The browser's own check, where it exists. The method is looked up on the element each time, so a page (or a
  // test) without it gets the manual walk alone.
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility(NATIVE)) {
    return el.checkVisibility(NATIVE_WITHOUT_AUTO) ? hidden('deferred') : hidden('native-check');
  }
  // 3. The ancestor walk.
  const walked = walkVerdict(el, cache);
  if (walked !== null) return hidden(walked);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return hidden('visibility');
  // 4. The box, transforms included (so scale(0) fails here).
  const box = boxOf(el);
  if (box === null || box.right - box.left < MIN_BOX_PX || box.bottom - box.top < MIN_BOX_PX) return hidden('box-size');
  // 5. Off-screen, in document coordinates: content below the fold still counts.
  if (!onScreen(box, el, cache)) return hidden('off-screen');
  // 6. Clipping by overflow and paint containment along the containing-block chain.
  if (!fitsAll(box, overflowClipsOf(el, cache))) return hidden('overflow-clip');
  // 7. Tiny text.
  if (rendersText(el) && parseFloat(style.fontSize) < MIN_FONT_PX) return hidden('font-size');
  // 8. clip and clip-path on the element or any ancestor.
  const painted = paintClipFailure(box, paintClipsOf(el, cache));
  if (painted !== null) return hidden(painted);
  return VISIBLE;
}

/** Could a person see this text node? It is judged by its parent's walk and by its own glyph boxes (rules 4 to 8).
 *  Camouflage is a separate check (camouflage.ts). */
export function isTextVisible(text: Text, cache: ScanCache = newScanCache()): boolean {
  return textVisibilityOf(text, cache).visible;
}

/** isTextVisible with the rule that decided. */
export function textVisibilityOf(text: Text, cache: ScanCache = newScanCache()): VisibilityVerdict {
  return cache.memo('text-visibility', text, () => judgeText(text, cache));
}

function judgeText(text: Text, cache: ScanCache): VisibilityVerdict {
  if (!text.isConnected) return hidden('disconnected');
  const parent = flatParent(text);
  if (parent === null) return hidden('disconnected');
  if (isInOwnUi(parent)) return hidden('own-ui');
  const view = viewOf(parent);
  const style = styleOf(parent, cache);
  if (view === null || style === null) return hidden('disconnected');
  if (frameTooSmall(view)) return hidden('frame');
  // A parent with `display: contents` has no box of its own, so the browser's check is asked about the text's real
  // container instead.
  const boxed = style.display === 'contents' ? nearestBoxed(parent, cache) : parent;
  if (boxed !== null && typeof boxed.checkVisibility === 'function' && !boxed.checkVisibility(NATIVE)) {
    return boxed.checkVisibility(NATIVE_WITHOUT_AUTO) ? hidden('deferred') : hidden('native-check');
  }
  const facts = factsOf(parent, cache);
  if (facts.contentHiddenBy !== null) return hidden(facts.contentHiddenBy);
  // A text node right inside a closed <details> is never its summary.
  if (isClosedDetails(parent)) return hidden('closed-details');
  if (outsideModal(parent, cache)) return hidden('outside-modal');
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return hidden('visibility');
  const box = textBox(text);
  if (box === null || box.right - box.left < MIN_BOX_PX || box.bottom - box.top < MIN_BOX_PX) return hidden('box-size');
  if (!onScreen(box, parent, cache)) return hidden('off-screen');
  if (!fitsAll(box, contentClipsOf(parent, cache))) return hidden('overflow-clip');
  if (parseFloat(style.fontSize) < MIN_FONT_PX) return hidden('font-size');
  const painted = paintClipFailure(box, paintClipsOf(parent, cache));
  if (painted !== null) return hidden(painted);
  return VISIBLE;
}

/** True when `el` and everything inside it are hidden by a rule that no descendant can undo (the hidden, inert and
 *  aria-hidden attributes, display: none, a closed <details> it is not the summary of, a mask, a back face turned
 *  away, an opacity product under 0.05, sitting outside an open modal dialog). visibleText skips such a subtree whole. */
export function isSubtreeHidden(el: Element, cache: ScanCache = newScanCache()): boolean {
  return factsOf(el, cache).hiddenBy !== null || outsideModal(el, cache) || isInOwnUi(el);
}

/** True when the children of `el` are not rendered: isSubtreeHidden, or `content-visibility: hidden` on `el`. */
export function isContentHidden(el: Element, cache: ScanCache = newScanCache()): boolean {
  return factsOf(el, cache).contentHiddenBy !== null || outsideModal(el, cache) || isInOwnUi(el);
}

/** The product of the opacities of `el` and its flat-tree ancestors, `filter: opacity()` included. */
export function opacityOf(el: Element, cache: ScanCache = newScanCache()): number {
  return factsOf(el, cache).opacity;
}

// ── The ancestor walk ────────────────────────────────────────────────────────────────────────────────────────────

interface Facts {
  /** A rule that hides this element and everything inside it. */
  hiddenBy: VisibilityRule | null;
  /** The rule that hides this element's children: hiddenBy, or content-visibility: hidden on the element itself. */
  contentHiddenBy: VisibilityRule | null;
  /** The product of the opacities of this element and its ancestors, their `filter: opacity()` included. */
  opacity: number;
  /** Inside an open modal dialog. */
  inModal: boolean;
}

function factsOf(el: Element, cache: ScanCache): Facts {
  return cache.memo('facts', el, (): Facts => {
    const parent = flatParent(el);
    const inherited = parent === null ? null : factsOf(parent, cache);
    const style = styleOf(el, cache);
    const opacity = (inherited?.opacity ?? 1) * opacityValue(style?.opacity) * filterOpacity(style?.filter);
    const own = ownHidingRule(el, style, parent, parent === null ? null : styleOf(parent, cache),
      TRAP_LIFTED.has(cache)); // jr6 ENGINE
    const hiddenBy = inherited?.contentHiddenBy ?? own ?? (opacity < MIN_OPACITY ? 'opacity' : null);
    const contentHiddenBy = hiddenBy ?? (style?.contentVisibility === 'hidden' ? 'content-visibility' : null);
    const inModal = (inherited?.inModal ?? false) || isOpenModal(el);
    return { hiddenBy, contentHiddenBy, opacity, inModal };
  });
}

function ownHidingRule(el: Element, style: CSSStyleDeclaration | null, parent: Element | null,
  parentStyle: CSSStyleDeclaration | null, trapLifted = false): VisibilityRule | null {
  if (el.hasAttribute('hidden')) return 'hidden-attribute';
  if (el.hasAttribute('inert')) return 'inert';
  // jr6 ENGINE E2 (item 10): a focus trap's aria-hidden is lifted for visibleBesideFocusTrap's judgment alone.
  if ((el.getAttribute('aria-hidden') ?? '').trim().toLowerCase() === 'true' && !(trapLifted && trapHidden(el))) {
    return 'aria-hidden';
  }
  if (style === null || style.display === 'none') return 'display-none';
  if (parent !== null && isClosedDetails(parent) && summaryOf(parent) !== el) return 'closed-details';
  if (isMasked(style)) return 'mask';
  if (backFaceHidden(style, parentStyle)) return 'backface';
  return null;
}

function opacityValue(text: string | undefined): number {
  const value = text === undefined || text === '' ? 1 : Number(text);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** The opacity a computed `filter` multiplies in: the product of its opacity() functions (1 when it has none). An
 *  amount this cannot read counts as 0, so the element is hidden (fails closed). Chromium's checkVisibility does not
 *  look at filters. */
export function filterOpacity(filter: string | undefined): number {
  if (filter === undefined || filter === '' || filter === 'none') return 1;
  let product = 1;
  for (const match of filter.matchAll(/(?:^|[\s)])opacity\(\s*([^)]*?)\s*\)/g)) {
    const text = match[1]!;
    const amount = text === '' ? 1 : text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
    product *= Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  }
  return product;
}

/** A closed <details> renders its summary (its first <summary> child) and nothing else. */
function isClosedDetails(el: Element): boolean {
  return el.localName === 'details' && !el.hasAttribute('open');
}

function summaryOf(details: Element): Element | null {
  for (const child of Array.from(details.children)) {
    if (child.localName === 'summary') return child;
  }
  return null;
}

/** A list of CSS image layers that is set ('none' alone, or once per layer, is not). */
function imageSet(value: string | undefined): boolean {
  return value !== undefined && value !== '' && !/^none(?:\s*,\s*none)*$/.test(value.trim());
}

/** A mask of any kind (mask-image, its -webkit- spelling, or a mask border) hides what it covers, whatever shape it
 *  has: this code does not measure masks, so every one fails closed. */
export function isMasked(style: CSSStyleDeclaration | null): boolean {
  if (style === null) return false;
  return imageSet(style.maskImage) || imageSet(style.getPropertyValue('-webkit-mask-image'))
    || imageSet(style.getPropertyValue('-webkit-mask-box-image-source'))
    || imageSet(style.getPropertyValue('mask-border-source'));
}

/**
 * `backface-visibility: hidden` on an element whose back faces the viewer: its own transform turns it away (the sign
 * Chromium tests, of the transformed normal), a 3D `rotate` or `scale` may (fails closed), or its parent keeps a 3D
 * context (preserve-3d), whose accumulated transforms are not followed here (fails closed). A 2D transform never turns
 * an element away, and translateZ(0), the GPU hack, does not.
 */
function backFaceHidden(style: CSSStyleDeclaration | null, parentStyle: CSSStyleDeclaration | null): boolean {
  if (style === null || style.backfaceVisibility !== 'hidden') return false;
  if (parentStyle?.transformStyle === 'preserve-3d') return true;
  const rotate = (style.rotate ?? 'none').trim();
  if (rotate !== '' && rotate !== 'none') {
    const parts = rotate.split(/\s+/);
    if (!(parts.length === 1 || (parts.length === 2 && parts[0] === 'z'))) return true;
  }
  const scale = (style.scale ?? 'none').trim();
  if (scale !== '' && scale !== 'none' && scale.split(/\s+/).length > 2) return true;
  return turnedAway(style.transform);
}

/** Whether a computed transform shows an element's back: the transformed normal's z is negative (Chromium's
 *  Transform::IsBackFaceVisible, cofactor33 × determinant < 0). A value this cannot read counts as turned away. */
function turnedAway(transform: string): boolean {
  const text = transform.trim();
  if (text === '' || text === 'none' || /^matrix\(/.test(text)) return false;
  const match = /^matrix3d\(([^)]*)\)$/.exec(text);
  if (match === null) return true;
  const v = match[1]!.split(',').map((part) => Number(part.trim()));
  if (v.length !== 16 || v.some((value) => !Number.isFinite(value))) return true;
  // matrix3d lists the matrix column by column: m(r, c) is v[c * 4 + r].
  const m = (r: number, c: number) => v[c * 4 + r]!;
  const det3 = (rows: readonly number[], cols: readonly number[]) => {
    const [r0, r1, r2] = rows as [number, number, number];
    const [c0, c1, c2] = cols as [number, number, number];
    return m(r0, c0) * (m(r1, c1) * m(r2, c2) - m(r1, c2) * m(r2, c1))
      - m(r0, c1) * (m(r1, c0) * m(r2, c2) - m(r1, c2) * m(r2, c0))
      + m(r0, c2) * (m(r1, c0) * m(r2, c1) - m(r1, c1) * m(r2, c0));
  };
  const cofactor22 = det3([0, 1, 3], [0, 1, 3]);
  let determinant = 0;
  for (let c = 0; c < 4; c += 1) {
    const others = [0, 1, 2, 3].filter((col) => col !== c);
    determinant += (c % 2 === 0 ? 1 : -1) * m(0, c) * det3([1, 2, 3], others);
  }
  if (determinant === 0) return false;
  return cofactor22 * determinant < -1e-9;
}

function walkVerdict(el: Element, cache: ScanCache): VisibilityRule | null {
  const facts = factsOf(el, cache);
  if (facts.hiddenBy !== null) return facts.hiddenBy;
  return outsideModal(el, cache) ? 'outside-modal' : null;
}

function isOpenModal(el: Element): boolean {
  if (el.localName !== 'dialog' || !el.hasAttribute('open')) return false;
  try {
    return el.matches(':modal');
  } catch {
    return false;
  }
}

/** True when the document shows an open modal dialog and `el` is not inside one: everything else is inert. */
function outsideModal(el: Element, cache: ScanCache): boolean {
  const doc = el.ownerDocument;
  const hasModal = cache.memo('has-modal', doc, () => {
    try {
      return doc.querySelector('dialog:modal') !== null;
    } catch {
      return false;
    }
  });
  return hasModal && !factsOf(el, cache).inModal;
}

/** The nearest ancestor-or-self that generates a box (not `display: contents`). */
function nearestBoxed(el: Element, cache: ScanCache): Element | null {
  for (let at: Element | null = el; at !== null; at = flatParent(at)) {
    if (styleOf(at, cache)?.display !== 'contents') return at;
  }
  return null;
}

function frameTooSmall(view: Window): boolean {
  return view.innerWidth < MIN_BOX_PX || view.innerHeight < MIN_BOX_PX;
}

// ── Boxes and positions ──────────────────────────────────────────────────────────────────────────────────────────

function boxOf(el: Element): ClientRect | null {
  if (el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** The union of a text node's glyph boxes, or null when it has none. */
function textBox(text: Text): ClientRect | null {
  const range = text.ownerDocument.createRange();
  range.selectNodeContents(text);
  let box: ClientRect | null = null;
  for (const r of Array.from(range.getClientRects())) {
    if (r.width <= 0 && r.height <= 0) continue;
    box = box === null ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      : { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right),
        bottom: Math.max(box.bottom, r.bottom) };
  }
  return box;
}

function overlap(start: number, end: number, from: number, to: number): number {
  return Math.min(end, to) - Math.max(start, from);
}

/** The box overlaps every rectangle by at least MIN_BOX_PX on both axes. */
function fitsAll(box: ClientRect, clips: readonly ClientRect[]): boolean {
  return clips.every((clip) => overlap(box.left, box.right, clip.left, clip.right) >= MIN_BOX_PX
    && overlap(box.top, box.bottom, clip.top, clip.bottom) >= MIN_BOX_PX);
}

/**
 * Rule 5: at least MIN_BOX_PX of the box lies in the reachable area. For an element fixed to the viewport, that is the
 * viewport. For a page element it is, downwards, the document from its origin to its scroll height (or to the
 * viewport's height when overflow-y is hidden or clip on html or body), so content below the fold still counts; and
 * across, the viewport's width only, at the document's origin or where the page is scrolled to now. A box placed far
 * to the right (left: 10000px) widens the page's scroll width itself, so the scroll width proves nothing (a honeypot
 * there was filled). Negative coordinates are never reachable.
 * The core pass of 2026-11-06 (jobs.workable.com's application dialog, fixtures/workable/jobs-salvo-apply.html: its
 * div.styles__content-region scrolls, overflow-y: auto, 791 px tall over 2,530 px of content, inside a position: fixed
 * wrapper): where a box scrolls with a container that a person can scroll, between it and its fixed ancestor (that
 * ancestor itself included), the reachable area is that container's scroll area, judged as the page's is (scrollIn);
 * the container's own visible part must be reachable in turn. A fixed container that does not scroll still holds its
 * content to the viewport: a box placed off-screen in one stays hidden.
 */
function onScreen(box: ClientRect, el: Element, cache: ScanCache): boolean {
  const view = viewOf(el)!;
  const doc = el.ownerDocument;
  // v5 p1-shell (the review's S5): the strip our sidebar covers at the window's right edge is no place a person sees.
  const width = view.innerWidth - (coveredRight.get(view) ?? 0);
  if (fixedToViewport(el, cache)) {
    const scroller = scrollerBelowFixed(el, cache);
    if (scroller !== null) return scrollIn(box, scroller, cache);
    return overlap(box.left, box.right, 0, width) >= MIN_BOX_PX
      && overlap(box.top, box.bottom, 0, view.innerHeight) >= MIN_BOX_PX;
  }
  const height = cache.memo('reachable-height', doc, () => reachableHeight(doc, view, cache));
  const left = box.left + view.scrollX;
  const top = box.top + view.scrollY;
  const across = overlap(left, left + (box.right - box.left), 0, width) >= MIN_BOX_PX
    || overlap(box.left, box.right, 0, width) >= MIN_BOX_PX;
  if (across && overlap(top, top + (box.bottom - box.top), 0, height) >= MIN_BOX_PX) return true;
  // jr7 ENGINE-7 E1 item 2 (UKGR-7): on a page that does not scroll itself (html or body at overflow hidden or clip), a
  // box that scrolls with a container a person can scroll is on screen within that container's scroll area, as one
  // under a fixed box is (scrollerBelowFixed); outside it, it stays off-screen. A page that scrolls is read as before.
  if (!cache.memo('page-clipped', doc, () => pageClipped(doc, cache))) return false;
  const scroller = scrollerAbove(el, cache);
  return scroller !== null && scrollIn(box, scroller, cache);
}

// ── jr7 ENGINE-7 E1 item 2 (UKGR-7) ──
/**
 * The nearest container a person can scroll down (scrollsDown) that `el`'s box moves with, along its containing blocks
 * (as scrollerBelowFixed follows them), html and body aside (the page's own scroll is rule 5's reachable height); null
 * when there is none. UKG Ready keeps html and body at overflow hidden and scrolls its steps inside
 * div.l-page-layout-content, overflow-y auto, 708 px tall over 1,430 px of content (snapshot7 secure7.saashr), so every
 * control below the fold read off-screen against the viewport's height alone.
 */
function scrollerAbove(el: Element, cache: ScanCache): Element | null {
  return cache.memo('scroller-above', el, (): Element | null => {
    const doc = el.ownerDocument;
    let at = containingBlockOf(el, cache);
    while (at !== null && at !== doc.body && at !== doc.documentElement) {
      if (scrollsDown(at, cache)) return at;
      at = containingBlockOf(at, cache);
    }
    return null;
  });
}
// ── end jr7 ENGINE-7 E1 item 2 ──

/** v5 p1-shell (the review's S5): how wide a strip at each window's right edge our sidebar covers while it is open. */
const coveredRight = new WeakMap<Window, number>();

/** v5 p1-shell (S5): the sidebar opened (`px`, its width) or closed (0) in `view`: rule 5 counts nothing in that strip
 *  as on screen while it is open. */
export function coverRight(view: Window, px: number): void {
  if (px > 0) coveredRight.set(view, px);
  else coveredRight.delete(view);
}

function reachableHeight(doc: Document, view: Window, cache: ScanCache): number {
  const root = doc.documentElement;
  const body = doc.body;
  return pageClipped(doc, cache) ? view.innerHeight : Math.max(root.scrollHeight, body?.scrollHeight ?? 0, view.innerHeight);
}

/** Whether the page does not scroll itself: html or body at overflow-y hidden or clip (rule 5). */
function pageClipped(doc: Document, cache: ScanCache): boolean {
  const styles = [styleOf(doc.documentElement, cache), doc.body ? styleOf(doc.body, cache) : null];
  return styles.some((style) => style !== null && (style.overflowY === 'hidden' || style.overflowY === 'clip'));
}

// ── The core pass of 2026-11-06: a scroll container inside a fixed box (rule 5) ──

/** Whether `el` is fixed to the viewport by its own position (followsItsField's boxes aside). */
function ownFixed(el: Element, cache: ScanCache): boolean {
  return styleOf(el, cache)?.position === 'fixed' && !FOLLOWING_FIELDS.has(el);
}

/** Whether a person can scroll `el` down to more content: overflow-y auto or scroll, more content than it shows, and a
 *  height a person can scroll in (MIN_BOX_PX, as rule 6 reads it). */
function scrollsDown(el: Element, cache: ScanCache): boolean {
  const style = styleOf(el, cache);
  if (style === null || !(style.overflowY === 'auto' || style.overflowY === 'scroll')) return false;
  return el.clientHeight >= MIN_BOX_PX && el.scrollHeight > el.clientHeight;
}

/**
 * The nearest container a person can scroll down (scrollsDown) that `el`'s box moves with, up to and including the
 * fixed box that holds it; null when there is none, or when `el` is that fixed box. It follows the containing blocks
 * (an absolutely positioned box moves with the scroller only when its containing block does), so a box positioned
 * against the fixed box past a scroller beside it never counts as that scroller's.
 */
function scrollerBelowFixed(el: Element, cache: ScanCache): Element | null {
  return cache.memo('scroller-below-fixed', el, (): Element | null => {
    if (ownFixed(el, cache)) return null;
    let at = containingBlockOf(el, cache);
    while (at !== null) {
      if (scrollsDown(at, cache)) return at;
      if (ownFixed(at, cache)) return null;
      at = containingBlockOf(at, cache);
    }
    return null;
  });
}

/** The element whose content box holds `el`'s: an absolute box's positioned ancestor, else its flat parent; null for a
 *  fixed box (the viewport, or a transformed ancestor, which scrollerBelowFixed never passes). */
function containingBlockOf(el: Element, cache: ScanCache): Element | null {
  const position = styleOf(el, cache)?.position;
  if (position === 'fixed') return null;
  return position === 'absolute' ? absoluteContainingBlock(el, cache) : flatParent(el);
}

/** Rule 5 inside a scroller (onScreen): downwards, its scroll area from its top to its scroll height; across, its own
 *  width, at its origin or where it is scrolled to now (the page's reading, held to the container); and the
 *  container's own visible part reachable where it stands. */
function scrollIn(box: ClientRect, scroller: Element, cache: ScanCache): boolean {
  const r = scroller.getBoundingClientRect();
  const left = r.left + scroller.clientLeft;
  const top = r.top + scroller.clientTop;
  const areaTop = top - scroller.scrollTop;
  const down = overlap(box.top, box.bottom, areaTop, areaTop + scroller.scrollHeight) >= MIN_BOX_PX;
  const inner = box.left - left + scroller.scrollLeft;
  const across = overlap(inner, inner + (box.right - box.left), 0, scroller.clientWidth) >= MIN_BOX_PX
    || overlap(box.left, box.right, left, left + scroller.clientWidth) >= MIN_BOX_PX;
  if (!down || !across) return false;
  const shown: ClientRect = { left, top, right: left + scroller.clientWidth, bottom: top + scroller.clientHeight };
  return onScreen(shown, scroller, cache);
}

// ── end of the core pass's block ──

/** True when `el` or an ancestor is `position: fixed`, so it stays put while the page scrolls; a fixed box that holds a
 *  declared widget's list drawn at its field's place (followsItsField) counts as its parent does. */
function fixedToViewport(el: Element, cache: ScanCache): boolean {
  return cache.memo('fixed', el, (): boolean => {
    if (styleOf(el, cache)?.position === 'fixed' && !FOLLOWING_FIELDS.has(el)) return true;
    const parent = flatParent(el);
    return parent !== null && fixedToViewport(parent, cache);
  });
}

/** Text-bearing elements: those with their own text, and text-like controls. The font rule applies only to them, so an
 *  icon or a checkbox under a `font-size: 0` wrapper is judged by its box. */
function rendersText(el: Element): boolean {
  const tag = el.localName;
  if (tag === 'textarea' || tag === 'select' || tag === 'button') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'file', 'hidden', 'range', 'color', 'image'].includes(type);
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

// ── Rule 6: clipping by overflow and paint containment, along the containing-block chain ─────────────────────────

/**
 * The clip rectangles that apply to `el`'s own box. An in-flow element is clipped by what clips its parent's content;
 * an absolutely positioned one by what clips its containing block's content, so it escapes an `overflow: hidden`
 * ancestor below that block, as it does on screen; a fixed one by nothing but a transformed ancestor's.
 */
function overflowClipsOf(el: Element, cache: ScanCache): ClientRect[] {
  return cache.memo('overflow-clips', el, (): ClientRect[] => {
    const position = styleOf(el, cache)?.position;
    const block = position === 'fixed' ? fixedContainingBlock(el, cache)
      : position === 'absolute' ? absoluteContainingBlock(el, cache) : flatParent(el);
    return block === null ? [] : contentClipsOf(block, cache);
  });
}

/** The clip rectangles that apply to the content of `el`: its own clips plus its own overflow clip. Content a person
 *  scrolls into view inside a fixed box (scrolledWithin) meets the clips above its scroller where the scroller shows
 *  it, not where it sits now. */
function contentClipsOf(el: Element, cache: ScanCache): ClientRect[] {
  return cache.memo('content-clips', el, (): ClientRect[] => {
    const inherited = scrolledWithin(el, overflowClipsOf(el, cache), cache);
    const own = ownOverflowClip(el, cache);
    return own === null ? inherited : [...inherited, own];
  });
}

/**
 * The core pass of 2026-11-06 (rule 5's scroller in a fixed box, onScreen): the clips above a container a person can
 * scroll down, inside a fixed box, as they apply to its content. Its content moves down and up through the
 * container's own visible part, so a clip above it cuts that content across (it does not scroll sideways) but not
 * downwards, wherever the container's visible part shows through that clip by MIN_BOX_PX or more (jobs.workable.com's
 * dialog: its div.styles__modal-content, overflow: hidden and as tall as the scrolling content region inside it, would
 * otherwise cut every field below the fold as the content sits now). A clip the visible part does not show through
 * still cuts it where it is. Any other element's clips stand as they are.
 * The security fix of 2026-11-06 (S1): a clip is lifted only where it shows the container's whole visible part
 * vertically (its top at or above the part's top and its bottom at or below the part's bottom, half a pixel either
 * way). A clip that shows only a slit of it (an overflow: hidden band 4 px tall over a 290 px scroller) shows a person
 * only that slit however far the content scrolls, so it still cuts the content where it is.
 */
function scrolledWithin(el: Element, clips: ClientRect[], cache: ScanCache): ClientRect[] {
  if (clips.length === 0 || !scrollsDown(el, cache) || !fixedToViewport(el, cache)) return clips;
  const r = el.getBoundingClientRect();
  const top = r.top + el.clientTop;
  const bottom = top + el.clientHeight;
  return clips.map((clip) => (clip.top <= top + 0.5 && clip.bottom >= bottom - 0.5
    ? { left: clip.left, right: clip.right, top: -Infinity, bottom: Infinity } : clip));
}

/**
 * The rectangle `el` clips its content to: its padding box on each axis whose overflow is hidden or clip, or both
 * axes under paint containment. A scroll or auto axis does not clip, because the person can scroll it, unless the
 * container is too small to scroll in (under MIN_BOX_PX). html and body are judged by rule 5 instead.
 */
function ownOverflowClip(el: Element, cache: ScanCache): ClientRect | null {
  const tag = el.localName;
  if (tag === 'html' || tag === 'body') return null;
  const style = styleOf(el, cache);
  if (style === null || style.display === 'inline' || style.display === 'contents') return null;
  const paint = /\b(?:paint|strict|content)\b/.test(style.contain);
  const clipX = paint || style.overflowX === 'hidden' || style.overflowX === 'clip';
  const clipY = paint || style.overflowY === 'hidden' || style.overflowY === 'clip';
  const scrollX = !clipX && (style.overflowX === 'auto' || style.overflowX === 'scroll');
  const scrollY = !clipY && (style.overflowY === 'auto' || style.overflowY === 'scroll');
  const onX = clipX || (scrollX && el.clientWidth < MIN_BOX_PX);
  const onY = clipY || (scrollY && el.clientHeight < MIN_BOX_PX);
  if (!onX && !onY) return null;
  const box = el.getBoundingClientRect();
  const left = box.left + el.clientLeft;
  const top = box.top + el.clientTop;
  return {
    left: onX ? left : -Infinity,
    right: onX ? left + el.clientWidth : Infinity,
    top: onY ? top : -Infinity,
    bottom: onY ? top + el.clientHeight : Infinity,
  };
}

const CONTAINS_LAYOUT = /\b(?:layout|paint|strict|content)\b/;
const WILL_CHANGE_BLOCK = /\b(?:transform|perspective|filter|translate|rotate|scale)\b/;

/** Does `el` contain fixed-position descendants (a transform, filter, perspective or containment)? */
function holdsFixed(style: CSSStyleDeclaration): boolean {
  return style.transform !== 'none' || style.perspective !== 'none' || style.filter !== 'none'
    || (style.backdropFilter !== undefined && style.backdropFilter !== 'none' && style.backdropFilter !== '')
    || CONTAINS_LAYOUT.test(style.contain) || WILL_CHANGE_BLOCK.test(style.willChange)
    || (style.translate !== undefined && style.translate !== 'none' && style.translate !== '')
    || (style.rotate !== undefined && style.rotate !== 'none' && style.rotate !== '')
    || (style.scale !== undefined && style.scale !== 'none' && style.scale !== '');
}

/** The containing block of an absolutely positioned element: the nearest positioned (or fixed-holding) ancestor.
 *  jr6 ENGINE E2: exported for dom/camouflage.ts heldUnder, whose overflow cuts follow the same blocks. */
export function absoluteContainingBlock(el: Element, cache: ScanCache): Element | null {
  return cache.memo('abs-block', el, (): Element | null => {
    const parent = flatParent(el);
    if (parent === null) return null;
    const style = styleOf(parent, cache);
    if (style !== null && (style.position !== 'static' || holdsFixed(style))) return parent;
    return absoluteContainingBlock(parent, cache);
  });
}

/** The containing block of a fixed element: the nearest ancestor that holds fixed descendants, else the viewport.
 *  jr6 ENGINE E2: exported for dom/camouflage.ts heldUnder, as absoluteContainingBlock is. */
export function fixedContainingBlock(el: Element, cache: ScanCache): Element | null {
  return cache.memo('fixed-block', el, (): Element | null => {
    const parent = flatParent(el);
    if (parent === null) return null;
    const style = styleOf(parent, cache);
    if (style !== null && holdsFixed(style)) return parent;
    return fixedContainingBlock(parent, cache);
  });
}

// ── Rule 8: clip and clip-path, along the whole ancestor chain ───────────────────────────────────────────────────

/** A region a clip or clip-path leaves, or 'unmeasurable' for a shape this code cannot measure (fails closed). */
interface PaintClip {
  rule: 'clip' | 'clip-path';
  region: ClientRect | 'unmeasurable';
}

function paintClipsOf(el: Element, cache: ScanCache): PaintClip[] {
  return cache.memo('paint-clips', el, (): PaintClip[] => {
    const parent = flatParent(el);
    const inherited = parent === null ? [] : paintClipsOf(parent, cache);
    const style = styleOf(el, cache);
    if (style === null) return inherited;
    const own: PaintClip[] = [];
    if ((style.position === 'absolute' || style.position === 'fixed') && style.clip !== '' && style.clip !== 'auto') {
      own.push({ rule: 'clip', region: clipRegion(style.clip, el) });
    }
    if (style.clipPath !== '' && style.clipPath !== 'none') {
      const region = clipPathRegion(style.clipPath, el);
      if (region !== null) own.push({ rule: 'clip-path', region });
    }
    return own.length === 0 ? inherited : [...inherited, ...own];
  });
}

function paintClipFailure(box: ClientRect, clips: readonly PaintClip[]): 'clip' | 'clip-path' | null {
  for (const clip of clips) {
    if (clip.region === 'unmeasurable' || !fitsAll(box, [clip.region])) return clip.rule;
  }
  return null;
}

/** `clip: rect(top, right, bottom, left)`, offsets from the element's border box, `auto` meaning that edge. */
function clipRegion(value: string, el: Element): ClientRect | 'unmeasurable' {
  const match = /^rect\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s)]+)\s*\)$/i.exec(value.trim());
  if (!match) return 'unmeasurable';
  const box = el.getBoundingClientRect();
  const read = (text: string | undefined, auto: number): number | null => {
    if (text === undefined) return null;
    if (text === 'auto') return auto;
    const px = /^(-?[\d.]+)px$/.exec(text);
    return px ? Number(px[1]) : text === '0' ? 0 : null;
  };
  const top = read(match[1], 0);
  const right = read(match[2], box.width);
  const bottom = read(match[3], box.height);
  const left = read(match[4], 0);
  if (top === null || right === null || bottom === null || left === null) return 'unmeasurable';
  return { left: box.left + left, top: box.top + top, right: box.left + right, bottom: box.top + bottom };
}

const BOX_KEYWORDS = /^(?:border-box|padding-box|content-box|margin-box|fill-box|stroke-box|view-box)$/;

/**
 * The region a computed clip-path leaves, in client coordinates, against the element's border box: inset(), circle()
 * and ellipse() as their bounding boxes (an empty box when a radius is under MIN_CLIP_RADIUS_PX), polygon() as the
 * bounding box of its points. A reference box alone clips nothing (null). Anything else (path(), url(), shape(),
 * calc() values) is 'unmeasurable', which counts as hidden.
 */
function clipPathRegion(value: string, el: Element): ClientRect | 'unmeasurable' | null {
  const text = value.trim().replace(/\s+(?:border-box|padding-box|content-box|margin-box|fill-box|stroke-box|view-box)$/, '');
  if (BOX_KEYWORDS.test(text)) return null;
  const shape = /^(inset|circle|ellipse|polygon)\((.*)\)$/i.exec(text);
  if (!shape) return 'unmeasurable';
  const box = el.getBoundingClientRect();
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const kind = shape[1]!.toLowerCase();
  const args = shape[2]!.trim();
  if (kind === 'inset') {
    const parts = args.split(/\s+round\s+/)[0]!.trim().split(/\s+/);
    if (parts.length === 0 || parts.length > 4) return 'unmeasurable';
    // The margin shorthand's expansion first, then each side against its own axis.
    const [p0 = '0', p1 = p0, p2 = p0, p3 = p1] = parts;
    const t = length(p0, height);
    const r = length(p1, width);
    const b = length(p2, height);
    const l = length(p3, width);
    if (t === null || r === null || b === null || l === null) return 'unmeasurable';
    return { left: box.left + l, top: box.top + t, right: box.right - r, bottom: box.bottom - b };
  }
  if (kind === 'polygon') {
    const points = args.replace(/^(?:nonzero|evenodd)\s*,\s*/, '').split(',').map((pair) => pair.trim().split(/\s+/));
    let region: ClientRect | null = null;
    for (const point of points) {
      if (point.length !== 2) return 'unmeasurable';
      const x = length(point[0]!, width);
      const y = length(point[1]!, height);
      if (x === null || y === null) return 'unmeasurable';
      const px = box.left + x;
      const py = box.top + y;
      region = region === null ? { left: px, top: py, right: px, bottom: py }
        : { left: Math.min(region.left, px), top: Math.min(region.top, py), right: Math.max(region.right, px),
          bottom: Math.max(region.bottom, py) };
    }
    return region ?? 'unmeasurable';
  }
  // circle() and ellipse(): radii, then an optional `at <x> <y>`.
  const [radiiText = '', atText] = args.split(/\s+at\s+|^at\s+/);
  const at = (atText ?? '50% 50%').trim().split(/\s+/);
  const cx = position(at[0] ?? '50%', width, 'x');
  const cy = position(at[1] ?? '50%', height, 'y');
  if (cx === null || cy === null) return 'unmeasurable';
  const sides = { closest: Math.min(cx, width - cx, cy, height - cy), farthest: Math.max(cx, width - cx, cy, height - cy) };
  const radius = (part: string | undefined, basis: number, closest: number, farthest: number): number | null => {
    if (part === undefined || part === '' || part === 'closest-side') return closest;
    if (part === 'farthest-side') return farthest;
    return length(part, basis);
  };
  const radii = radiiText.trim() === '' ? [] : radiiText.trim().split(/\s+/);
  let rx: number | null;
  let ry: number | null;
  if (kind === 'circle') {
    rx = radius(radii[0], Math.hypot(width, height) / Math.SQRT2, sides.closest, sides.farthest);
    ry = rx;
  } else {
    rx = radius(radii[0], width, Math.min(cx, width - cx), Math.max(cx, width - cx));
    ry = radius(radii[1], height, Math.min(cy, height - cy), Math.max(cy, height - cy));
  }
  if (rx === null || ry === null) return 'unmeasurable';
  if (rx < MIN_CLIP_RADIUS_PX || ry < MIN_CLIP_RADIUS_PX) {
    return { left: box.left + cx, top: box.top + cy, right: box.left + cx, bottom: box.top + cy };
  }
  return { left: box.left + cx - rx, top: box.top + cy - ry, right: box.left + cx + rx, bottom: box.top + cy + ry };
}

/** A computed length in px or a percentage of `basis`; null for anything else (calc(), em). */
function length(text: string, basis: number): number | null {
  if (text === '0') return 0;
  const px = /^(-?[\d.]+)px$/.exec(text);
  if (px) return Number(px[1]);
  const percent = /^(-?[\d.]+)%$/.exec(text);
  return percent ? (Number(percent[1]) / 100) * basis : null;
}

/** A position coordinate: a length, a percentage or a keyword. */
function position(text: string, basis: number, axis: 'x' | 'y'): number | null {
  const keyword: Record<string, number> = axis === 'x' ? { left: 0, center: 0.5, right: 1 }
    : { top: 0, center: 0.5, bottom: 1 };
  const share = keyword[text];
  return share === undefined ? length(text, basis) : share * basis;
}
