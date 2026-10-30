/*
 * visibleText (docs/design/runtime.md §5.3; docs/ARCHITECTURE.md "Visibility"): the only producer of the VisibleText
 * brand, so the only way page text can ever become LLM input. It walks the flat tree (open shadow roots and slots
 * included) and keeps a text node only when a person could see it: its parent's subtree is rendered, its own glyph
 * boxes pass isUserVisible's rules, and its colour is 'clear' against what is behind it. Scripts, styles, templates,
 * comments, other documents, drawings, controls and editable regions are never read; a control's value never is.
 *
 * Two readers sit beside it, with the plan's rules:
 * - the native <option> reader: an option counts only when its select is visible, neither it nor its optgroup is
 *   hidden or display: none, its colour is clear in the select's list, and its displayed text is not empty;
 * - the placeholder reader: a placeholder counts only when the control is empty and Chromium's computed
 *   `::placeholder` style passes the opacity, font and camouflage checks (the Phase 2 smoke test showed Chromium
 *   reports that style, so the plan's fallback is not needed).
 */
import { capCodePoints } from '../core/text/fold';
import type { VisibleText } from '../core/types/text';
import { isCamouflaged, optionCamouflage, textAgainstBackground } from './camouflage';
import { fade, parseColor } from './color';
import { isInOwnUi } from './own-ui';
import { flatParent, type ScanCache, styleOf, viewOf, newScanCache } from './scan-cache';
import { MAX_OPTIONS, MIN_FONT_PX, MIN_OPACITY, TEXT_CAP_LABEL, TEXT_CAP_PASSAGE } from './thresholds';
import { isContentHidden, isSubtreeHidden, isTextVisible, isUserVisible, opacityOf } from './visibility';

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
}

/** The text a person can see in `root`, as one VisibleText. */
export function visibleText(root: Node, options: VisibleTextOptions = {}): VisibleText {
  return readVisibleText(root, options).text;
}

/** visibleText with its segments and counts. */
export function readVisibleText(root: Node, options: VisibleTextOptions = {}): VisibleTextResult {
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
    if (isInOwnUi(el) || isEditable(el)) continue;
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

/** The options of `select` a person can see, in list order; [] when the select itself is not visible. */
export function readSelectOptions(select: HTMLSelectElement, cache: ScanCache = newScanCache()): VisibleOption[] {
  if (!isUserVisible(select, cache)) return [];
  const result: VisibleOption[] = [];
  for (const option of Array.from(select.options)) {
    if (result.length >= MAX_OPTIONS) break;
    const group = option.parentElement?.localName === 'optgroup' ? option.parentElement as HTMLOptGroupElement : null;
    if (option.hidden || group?.hidden) continue;
    if (styleOf(option, cache)?.display === 'none' || (group && styleOf(group, cache)?.display === 'none')) continue;
    if (optionCamouflage(option, select, cache) !== 'clear') continue;
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

// ── The placeholder reader ───────────────────────────────────────────────────────────────────────────────────────

/** The placeholder a person can see in an empty text-like control, or null. */
export function visiblePlaceholder(control: Element, cache: ScanCache = newScanCache()): string | null {
  const tag = control.localName;
  if (tag !== 'input' && tag !== 'textarea') return null;
  const input = control as HTMLInputElement | HTMLTextAreaElement;
  const text = oneLine(input.getAttribute('placeholder') ?? '');
  if (text === '' || input.value !== '') return null;
  const view = viewOf(control);
  if (view === null) return null;
  const pseudo = view.getComputedStyle(control, '::placeholder');
  if (pseudo.display === 'none' || pseudo.visibility === 'hidden' || pseudo.visibility === 'collapse') return null;
  if (parseFloat(pseudo.fontSize) < MIN_FONT_PX) return null;
  const opacity = (Number(pseudo.opacity) || 0) * opacityOf(control, cache);
  const colour = parseColor(pseudo.color, control.ownerDocument);
  if (colour === null || colour.a * opacity < MIN_OPACITY) return null;
  return textAgainstBackground(fade(colour, opacity), control, cache) === 'clear' ? text : null;
}
