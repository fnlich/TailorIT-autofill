/*
 * visibleText (docs/design/runtime.md §5.3; docs/ARCHITECTURE.md "Visibility"): the only producer of the VisibleText
 * brand, so the only way page text can ever become LLM input. It walks the flat tree (open shadow roots and slots
 * included) and keeps a text node only when a person could see it: its parent's subtree is rendered, its own glyph
 * boxes pass isUserVisible's rules, and its colour is 'clear' against what is behind it. Scripts, styles, templates,
 * comments, other documents, drawings, controls and editable regions are never read; a control's value never is.
 * v5 p2-fill review (security 3): one exception, asked for by name (VisibleTextOptions.editable): a rich-text box's
 * own content, read by the same rules from its editing host down, is that box's `current` (dom/values.ts
 * editableVisibleText), the only reading of it the planner and the AI get; text in it a person cannot see (off-screen,
 * clipped, see-through, tiny) is left out like any page text, and a box holding any is never rewritten.
 *
 * Two readers sit beside it, with the plan's rules:
 * - the native <option> reader: an option counts only when its select is visible, neither it nor its optgroup is
 *   hidden or display: none, its colour is clear in the select's list, and its displayed text is not empty. An option
 *   may hold elements (a customizable select's markup), and option.label reads all their text, shown or not: a select
 *   with an option whose elements are not plainly drawn lists no option at all, so the field is flagged (DOM-2);
 * - the placeholder reader: a placeholder counts only when the control is empty, Chromium's computed `::placeholder`
 *   style passes the opacity, font and camouflage checks with the colour its glyphs are painted in (the fill colour
 *   when set), and the control's content box, inside its padding, has room for the glyphs where its text-indent puts
 *   them (DOM-5, S4). The Phase 2 smoke test showed Chromium reports that style, so the plan's fallback is not
 *   needed. heldPlaceholder is the one exception, for a control the extension itself has just written into: see its
 *   comment.
 */
import { capCodePoints } from '../core/text/fold';
import { shownByBox } from './box-shown';
import type { VisibleText } from '../core/types/text';
import { inkAgainst, isCamouflaged, optionBackdrop, optionCamouflage, textAgainstBackground } from './camouflage';
import { fade, over, parseColor } from './color';
import { isInOwnUi } from './own-ui';
import { flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import { MAX_OPTIONS, MIN_BOX_PX, MIN_FONT_PX, MIN_OPACITY, TEXT_CAP_LABEL, TEXT_CAP_PASSAGE } from './thresholds';
import {
  filterOpacity, isContentHidden, isMasked, isSubtreeHidden, isTextVisible, isUserVisible, opacityOf,
} from './visibility';

/** Elements whose subtree is never read: non-content, other documents and drawings, controls and their values. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'iframe', 'frame',
  'object', 'embed', 'canvas', 'svg', 'math', 'input', 'textarea', 'select', 'datalist', 'option', 'optgroup']);
/** Display values that end a line. */
const BLOCK = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row', 'table-caption', 'flow-root',
  'table-row-group', 'table-header-group', 'table-footer-group', 'ruby-base-container']);
/** Display values that separate words without ending a line. */
const SPACED = new Set(['table-cell', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table']);

/** One visible text node, with the element that holds it. */
export interface VisibleSegment {
  text: string;
  parent: Element;
}

/** visibleText's text with what it was built from. */
export interface VisibleTextResult {
  text: VisibleText;
  /** Each accepted text node, in reading order. */
  segments: VisibleSegment[];
  /** Text nodes refused one by one, by their own glyph boxes or their colour (camouflaged). A whole hidden subtree
   *  (display: none, hidden, aria-hidden, ...) is skipped without being counted. */
  dropped: number;
  /** The cap cut the text. */
  truncated: boolean;
}

/** How visibleText reads: its cap, one line or many, and the scan's cache. */
export interface VisibleTextOptions {
  /** At most this many code points (default TEXT_CAP_PASSAGE, 20,000). */
  cap?: number;
  /** One line: line breaks become spaces (labels and options). */
  singleLine?: boolean;
  cache?: ScanCache;
  /** v5 p2-fill review (security 3): the root is a rich-text box's editing host, whose own (editable) content is read;
   *  without it an editable region is never read. */
  editable?: boolean;
}

/** The text a person can see in `root`, as one VisibleText. */
export function visibleText(root: Node, options: VisibleTextOptions = {}): VisibleText {
  return readVisibleText(root, options).text;
}

/** visibleText with its segments and counts. */
export function readVisibleText(root: Node, options: VisibleTextOptions = {}): VisibleTextResult {
  return walk(root, options, null);
}

/** The text a person can see in `root`, leaving out what `excluded` and its subtrees show: a label's text without
 *  the upload control it wraps (labels.ts). */
export function visibleTextWithout(root: Node, excluded: readonly Element[], options: VisibleTextOptions = {}):
  VisibleText {
  return walk(root, options, excluded.length === 0 ? null : new Set(excluded)).text;
}

function walk(root: Node, options: VisibleTextOptions, excluded: ReadonlySet<Element> | null): VisibleTextResult {
  const cache = options.cache ?? newScanCache();
  const parts: string[] = [];
  const segments: VisibleSegment[] = [];
  let dropped = 0;
  const start = root.nodeType === 9 ? (root as Document).documentElement : root;
  if (start === null || (start.nodeType === 1 && (isSubtreeHidden(start as Element, cache)
    || SKIPPED.has((start as Element).localName)))) {
    return { text: '' as VisibleText, segments, dropped, truncated: false };
  }
  // An explicit stack instead of recursion, so a deep page cannot overflow it. A string entry is a separator to emit
  // when an element's subtree is done.
  const stack: Array<Node | string> = [start];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (entry.nodeType === 3) {
      const text = entry as Text;
      const data = text.data;
      if (data.trim() === '') {
        parts.push(' ');
        continue;
      }
      const parent = flatParent(text);
      if (parent !== null && isTextVisible(text, cache) && isCamouflaged(parent, cache) === 'clear') {
        parts.push(data);
        segments.push({ text: data, parent });
      } else {
        dropped += 1;
      }
      continue;
    }
    if (entry.nodeType === 11) {
      pushChildren(stack, Array.from(entry.childNodes));
      continue;
    }
    if (entry.nodeType !== 1) continue;
    const el = entry as Element;
    if (el !== start && (SKIPPED.has(el.localName) || isSubtreeHidden(el, cache))) continue;
    if (isInOwnUi(el) || (isEditable(el) && options.editable !== true) || excluded?.has(el)) continue;
    if (el.localName === 'br') {
      parts.push('\n');
      continue;
    }
    const display = styleOf(el, cache)?.display ?? 'inline';
    const separator = BLOCK.has(display) ? '\n' : SPACED.has(display) ? ' ' : '';
    if (separator !== '') parts.push(separator);
    if (separator !== '') stack.push(separator);
    if (isContentHidden(el, cache)) continue;
    pushChildren(stack, renderedChildren(el));
  }
  return assemble(parts, segments, dropped, options);
}

function pushChildren(stack: Array<Node | string>, children: Node[]): void {
  for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
}

/** The children an element renders: its open shadow root's, a slot's assigned nodes (or its fallback), else its own. */
function renderedChildren(el: Element): Node[] {
  if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
  if (el.localName === 'slot') {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return Array.from(el.childNodes);
}

/** A contenteditable region holds the person's typing, not page text. */
function isEditable(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

function assemble(parts: string[], segments: VisibleSegment[], dropped: number, options: VisibleTextOptions):
  VisibleTextResult {
  const cap = options.cap ?? TEXT_CAP_PASSAGE;
  const lines = parts.join('').replace(/[^\S\n]+/g, ' ').split('\n').map((line) => line.trim())
    .filter((line) => line !== '');
  const joined = lines.join(options.singleLine ? ' ' : '\n');
  const text = capCodePoints(joined, cap);
  return { text: text as VisibleText, segments, dropped, truncated: text.length < joined.length };
}

/** Collapses whitespace and caps a short page string (an option label, an attribute). */
export function oneLine(text: string, cap: number = TEXT_CAP_LABEL): string {
  return capCodePoints(text.replace(/\s+/g, ' ').trim(), cap);
}

// ── The native <option> reader ───────────────────────────────────────────────────────────────────────────────────

/** One option a person can see in a native select's list. Page content: untrusted. */
export interface VisibleOption {
  el: HTMLOptionElement;
  /** The displayed text (`option.label`), whitespace collapsed, at most 300 characters. */
  label: string;
  /** The native value, for the filler only. */
  value: string;
  /** The optgroup's label. */
  group?: string;
  /** Listed, never chosen. */
  disabled: boolean;
  selected: boolean;
}

/** The options of `select` a person can see, in list order; [] when the select itself is not visible, and [] when an
 *  option it would list holds elements that are not plainly drawn (optionShowsAllItsText). */
export function readSelectOptions(select: HTMLSelectElement, cache: ScanCache = newScanCache()): VisibleOption[] {
  // jr7 ENGINE-7 E1 item 1 (UKGR-6): or one the last scan found drawn by its adapter's declared box (dom/box-shown.ts).
  if (!isUserVisible(select, cache) && !shownByBox(select)) return [];
  const result: VisibleOption[] = [];
  for (const option of Array.from(select.options)) {
    if (result.length >= MAX_OPTIONS) break;
    const group = option.parentElement?.localName === 'optgroup' ? option.parentElement as HTMLOptGroupElement : null;
    if (option.hidden || group?.hidden) continue;
    if (styleOf(option, cache)?.display === 'none' || (group && styleOf(group, cache)?.display === 'none')) continue;
    if (optionCamouflage(option, select, cache) !== 'clear') continue;
    // Its label would carry text a person may not see: no option of this select is trusted, so none is listed.
    if (!optionShowsAllItsText(option, select, cache)) return [];
    const label = oneLine(option.label);
    if (label === '') continue;
    const read: VisibleOption = {
      el: option, label, value: oneLine(option.value), disabled: option.disabled || (group?.disabled ?? false),
      selected: option.selected,
    };
    const groupLabel = group === null ? '' : oneLine(group.label);
    if (groupLabel !== '') read.group = groupLabel;
    result.push(read);
  }
  return result;
}

/** Display values with no box of their own that could clip or move text. */
const INLINE_DISPLAY = new Set(['inline', 'contents']);

/** An element that makes a box of its own (a customizable select's option is a flex container, so the elements in
 *  it are blockified) is plain only when that box cannot hide its text: no overflow clip, no text-indent, and no
 *  margin pulling it away. */
function boxKeepsItsText(style: CSSStyleDeclaration): boolean {
  if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return false;
  if (!/^0(?:px)?$/.test(style.textIndent.trim())) return false;
  return [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]
    .every((margin) => /^-?[\d.]+px$/.test(margin.trim()) && parseFloat(margin) > -MIN_BOX_PX);
}

/**
 * Whether every element inside an option is plainly drawn, so option.label (all the text inside, shown or not) is
 * what a person reads in the list (DOM-2). An option with no element inside is plain. Otherwise each element inside
 * it must be inline (or display: contents, or a box that cannot hide its text: boxKeepsItsText), statically placed,
 * untransformed, unclipped and unmasked, with no filter but opacity(), no blend mode, no text of its own from ::before
 * or ::after, a font of at least MIN_FONT_PX, an opacity (down from the option) of at least MIN_OPACITY, and its text
 * colour clear against the list's background behind it. The hidden attribute, display: none and visibility: hidden
 * fail too. Anything else fails closed: the list may be drawn natively, where none of these elements has a box to
 * measure.
 */
function optionShowsAllItsText(option: HTMLOptionElement, select: HTMLSelectElement, cache: ScanCache): boolean {
  const inside = Array.from(option.querySelectorAll('*'));
  if (inside.length === 0) return true;
  const view = viewOf(option);
  if (view === null) return false;
  const doc = option.ownerDocument;
  const behindOption = optionBackdrop(option, select, cache);
  if (behindOption === null) return false;
  for (const el of inside) {
    if (el.hasAttribute('hidden')) return false;
    const style = styleOf(el, cache);
    if (style === null || style.display === 'none' || style.visibility !== 'visible') return false;
    if (!INLINE_DISPLAY.has(style.display) && !boxKeepsItsText(style)) return false;
    if (style.position !== 'static' || style.transform !== 'none' || (style.clipPath !== '' && style.clipPath !== 'none')
      || isMasked(style) || (style.mixBlendMode !== '' && style.mixBlendMode !== 'normal')) return false;
    if (style.filter !== '' && style.filter !== 'none' && !/^(?:opacity\([^)]*\)\s*)+$/.test(style.filter.trim())) return false;
    if (parseFloat(style.fontSize) < MIN_FONT_PX) return false;
    for (const pseudo of ['::before', '::after'] as const) {
      const content = view.getComputedStyle(el, pseudo).content;
      if (content !== '' && content !== 'none' && content !== 'normal') return false;
    }
    // The opacity and the backgrounds from the option down to this element.
    let opacity = 1;
    let behind = behindOption;
    const chain: Element[] = [];
    for (let at: Element | null = el; at !== null && at !== option; at = at.parentElement) chain.unshift(at);
    for (const layer of chain) {
      const layerStyle = styleOf(layer, cache);
      if (layerStyle === null) return false;
      opacity *= (Number(layerStyle.opacity) || 0) * filterOpacity(layerStyle.filter);
      const bg = parseColor(layerStyle.backgroundColor, doc);
      if (bg === null || (layerStyle.backgroundImage !== '' && layerStyle.backgroundImage !== 'none')) return false;
      behind = over(fade(bg, opacity), behind);
    }
    if (opacity < MIN_OPACITY) return false;
    const ink = parseColor(style.webkitTextFillColor || style.color, doc);
    if (ink === null || ink.a * opacity < MIN_OPACITY) return false;
    if (inkAgainst(fade(ink, opacity), behind) !== 'clear') return false;
  }
  return true;
}

// ── The placeholder reader ───────────────────────────────────────────────────────────────────────────────────────

/** The placeholder a person can see in an empty text-like control, or null. */
export function visiblePlaceholder(control: Element, cache: ScanCache = newScanCache()): string | null {
  const tag = control.localName;
  if (tag !== 'input' && tag !== 'textarea') return null;
  if ((control as HTMLInputElement | HTMLTextAreaElement).value !== '') return null;
  return placeholderInView(control, cache);
}

/**
 * The placeholder that labelled a control before the extension's own write hid it: the same checks as
 * visiblePlaceholder, but for what the value changes. Chromium hides a filled control's placeholder (its computed
 * `::placeholder` display is none), and here that is our own value's doing: the control was held only because its
 * placeholder showed when we wrote. Only a scan told which controls we wrote into (ScanOptions.heldPlaceholders)
 * reads it, so the field we filled keeps its label, and with it its key, for the read-back. It counts only while the
 * page still shows the text `seen` when we wrote (DOM-7): a page that renames a field it no longer shows a
 * placeholder for (our first write turning "First name" into "Last name") would otherwise redirect the next write.
 * Any other filled control's placeholder is out of sight and names nothing.
 */
export function heldPlaceholder(control: Element, seen: string, cache: ScanCache = newScanCache()): string | null {
  const tag = control.localName;
  if (tag !== 'input' && tag !== 'textarea') return null;
  const text = placeholderInView(control, cache, true);
  return text !== null && text === seen ? text : null;
}

/** A text-like control's placeholder when its `::placeholder` style lets a person see it; `filled`: the control holds
 *  our value, which hides the placeholder (display none), so only the other checks apply. */
function placeholderInView(control: Element, cache: ScanCache, filled = false): string | null {
  const text = oneLine(control.getAttribute('placeholder') ?? '');
  if (text === '') return null;
  const view = viewOf(control);
  if (view === null) return null;
  const pseudo = view.getComputedStyle(control, '::placeholder');
  if ((!filled && pseudo.display === 'none') || pseudo.visibility === 'hidden' || pseudo.visibility === 'collapse') return null;
  if (parseFloat(pseudo.fontSize) < MIN_FONT_PX) return null;
  if (!roomForGlyphs(control, pseudo, cache)) return null;
  const opacity = (Number(pseudo.opacity) || 0) * opacityOf(control, cache);
  const doc = control.ownerDocument;
  // The glyphs are painted in the fill colour, which defaults to the colour; a transparent one, set on ::placeholder
  // or inherited from the control, hides them whatever the colour says (S4).
  const glyph = (pseudo.webkitTextFillColor ? parseColor(pseudo.webkitTextFillColor, doc) : null)
    ?? parseColor(pseudo.color, doc);
  if (glyph === null || glyph.a * opacity < MIN_OPACITY) return null;
  return textAgainstBackground(fade(glyph, opacity), control, cache) === 'clear' ? text : null;
}

/**
 * Whether a control's content box (inside its padding) has at least MIN_BOX_PX on each axis, and the placeholder's
 * text-indent starts its glyphs inside that box, MIN_BOX_PX before its far edge. A negative indent (text-indent:
 * -9999px), or padding wider than the box, pushes them out of sight (DOM-5, S4). A length this cannot read fails.
 */
function roomForGlyphs(control: Element, pseudo: CSSStyleDeclaration, cache: ScanCache): boolean {
  const style = styleOf(control, cache);
  if (style === null) return false;
  const box = control as HTMLElement;
  const width = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (!(width >= MIN_BOX_PX) || !(height >= MIN_BOX_PX)) return false;
  const indentText = (pseudo.textIndent || style.textIndent || '0px').trim().split(/\s+/)[0]!;
  const px = /^(-?[\d.]+)px$/.exec(indentText);
  const percent = /^(-?[\d.]+)%$/.exec(indentText);
  const indent = px ? Number(px[1]) : percent ? (Number(percent[1]) / 100) * width : indentText === '0' ? 0 : Number.NaN;
  return Number.isFinite(indent) && indent >= 0 && indent <= width - MIN_BOX_PX;
}
