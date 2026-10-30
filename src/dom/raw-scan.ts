/*
 * The tripwire's raw scan (docs/design/runtime.md §5.4; docs/ARCHITECTURE.md "Guard"): page text regardless of
 * visibility, so text addressed to AI tools is noticed wherever a page hides it. It reads every text node (hidden and
 * camouflaged included), comments, template content, noscript text, JSON-LD (JobPosting descriptions), the
 * description metas and the attributes a page can write words into (aria-label, aria-description, aria-placeholder,
 * title, alt, placeholder and data-*), in open shadow roots too. It never reads a control's value.
 *
 * Its output is passages branded RawPageText: the tripwire's patterns and canary extraction (in the pure core) read
 * them, and the type system keeps them out of every LLM request builder. Text nodes are grouped into one passage per
 * block and visibility, so a camouflaged sentence inside a visible paragraph is its own hidden passage. The scan reads
 * at most RAW_SCAN_MAX_NODES nodes, in slices of about RAW_SCAN_SLICE_MS, yielding to the page between slices; it can
 * be run again on a subtree that a settle added.
 */
import { capCodePoints } from '../core/text/fold';
import type { RawPageText } from '../core/types/text';
import { isCamouflaged } from './camouflage';
import { isInOwnUi } from './own-ui';
import { type ScanCache, styleOf, newScanCache } from './scan-cache';
import { RAW_ATTRIBUTE_CAP, RAW_SCAN_MAX_NODES, RAW_SCAN_SLICE_MS, TEXT_CAP_PASSAGE } from './thresholds';
import { monotonicNow, yieldToPage } from './time';
import { isTextVisible } from './visibility';

/** Where a passage was found. */
export const RAW_ORIGINS = ['visible', 'hidden', 'comment', 'attribute', 'structured-data', 'meta', 'option'] as const;
export type RawOrigin = (typeof RAW_ORIGINS)[number];

/** One passage of page text, for the tripwire and canaries only. */
export interface RawPassage {
  text: RawPageText;
  origin: RawOrigin;
}

/** What a raw scan read. */
export interface RawScanResult {
  /** Deduplicated by origin and text, in document order. */
  passages: RawPassage[];
  /** Nodes read. */
  nodes: number;
  /** The node budget or the signal stopped the scan early. */
  truncated: boolean;
}

/** The raw scan's budget (nodes, slice length), its stop signal and the scan's cache. */
export interface RawScanOptions {
  maxNodes?: number;
  sliceMs?: number;
  signal?: AbortSignal;
  cache?: ScanCache;
}

/** The attributes a page can write words into. data-* attributes are read too. */
const ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-placeholder', 'title', 'alt', 'placeholder']);
/** Elements whose text is code, not page text, or a control's value. */
const NOT_TEXT = new Set(['style', 'textarea']);
const BLOCK_DISPLAY = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row', 'table-cell',
  'table-caption', 'flow-root', 'inline-block', 'inline-flex', 'inline-grid']);
/** Block-level tags, for text in documents that have no styles (template content). */
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'ul', 'ol', 'section', 'article', 'aside', 'header', 'footer', 'main',
  'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'tr', 'table', 'form', 'fieldset', 'legend', 'label',
  'blockquote', 'pre', 'dd', 'dt', 'dl', 'figure', 'figcaption', 'details', 'summary', 'dialog', 'body', 'option',
  'select', 'noscript', 'button']);

interface Frame {
  node: Node;
  /** Set inside template content, select lists and the like: every text node there has this origin. */
  forced: RawOrigin | null;
}

/** Reads the raw text of `root` (a document, an element, or a subtree a settle added). */
export async function rawScan(root: Node, options: RawScanOptions = {}): Promise<RawScanResult> {
  const cache = options.cache ?? newScanCache();
  const maxNodes = options.maxNodes ?? RAW_SCAN_MAX_NODES;
  const sliceMs = options.sliceMs ?? RAW_SCAN_SLICE_MS;
  const passages: RawPassage[] = [];
  const seen = new Set<string>();
  const add = (text: string, origin: RawOrigin, cap: number) => {
    const clean = capCodePoints(text.replace(/\s+/g, ' ').trim(), cap);
    if (clean === '') return;
    const id = `${origin}\x1f${clean}`;
    if (seen.has(id)) return;
    seen.add(id);
    passages.push({ text: clean as RawPageText, origin });
  };
  let open: { block: Node | null; origin: RawOrigin; parts: string[] } | null = null;
  const flush = () => {
    if (open !== null) add(open.parts.join(''), open.origin, TEXT_CAP_PASSAGE);
    open = null;
  };

  const start = root.nodeType === 9 ? (root as Document).documentElement : root;
  const stack: Frame[] = start === null ? [] : [{ node: start, forced: null }];
  let nodes = 0;
  let truncated = false;
  let sliceStart = monotonicNow();
  while (stack.length > 0) {
    if (options.signal?.aborted || nodes >= maxNodes) {
      truncated = true;
      break;
    }
    if (monotonicNow() - sliceStart >= sliceMs) {
      await yieldToPage();
      sliceStart = monotonicNow();
    }
    const { node, forced } = stack.pop()!;
    nodes += 1;
    if (node.nodeType === 8) {
      flush();
      add((node as Comment).data, 'comment', TEXT_CAP_PASSAGE);
      continue;
    }
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.data.trim() === '') {
        open?.parts.push(' ');
        continue;
      }
      const origin = forced ?? textOrigin(text, cache);
      const block = blockOf(text, cache);
      if (open === null || open.block !== block || open.origin !== origin) {
        flush();
        open = { block, origin, parts: [] };
      }
      open.parts.push(text.data);
      continue;
    }
    if (node.nodeType === 11) {
      pushChildren(stack, node.childNodes, forced);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (isInOwnUi(el)) continue;
    flushAtBlock(el);
    readAttributes(el, add);
    const tag = el.localName;
    if (tag === 'script') {
      const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
      if (type === 'application/ld+json') add(el.textContent ?? '', 'structured-data', TEXT_CAP_PASSAGE);
      continue;
    }
    if (NOT_TEXT.has(tag)) continue;
    if (tag === 'meta') {
      const name = (el.getAttribute('name') ?? el.getAttribute('property') ?? '').trim().toLowerCase();
      if (name === 'description' || name === 'og:description') add(el.getAttribute('content') ?? '', 'meta', RAW_ATTRIBUTE_CAP);
      continue;
    }
    if (tag === 'template') {
      pushChildren(stack, (el as HTMLTemplateElement).content.childNodes, 'hidden');
      continue;
    }
    const inner = tag === 'select' || tag === 'datalist' ? 'option' : forced;
    pushChildren(stack, el.childNodes, inner);
    if (el.shadowRoot) pushChildren(stack, el.shadowRoot.childNodes, inner);
  }
  flush();
  return { passages, nodes, truncated };

  /** A block element starts a new passage, so two paragraphs never run together. */
  function flushAtBlock(el: Element): void {
    const display = styleOf(el, cache)?.display;
    if (display === undefined ? BLOCK_TAGS.has(el.localName) : BLOCK_DISPLAY.has(display) || display === 'none') flush();
  }
}

function pushChildren(stack: Frame[], children: NodeListOf<ChildNode>, forced: RawOrigin | null): void {
  for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i]!, forced });
}

function readAttributes(el: Element, add: (text: string, origin: RawOrigin, cap: number) => void): void {
  for (const attribute of Array.from(el.attributes)) {
    const name = attribute.name.toLowerCase();
    if (ATTRIBUTES.has(name) || name.startsWith('data-')) add(attribute.value, 'attribute', RAW_ATTRIBUTE_CAP);
  }
}

/** 'visible' when a person could read the text node, else 'hidden' (camouflaged text included). */
function textOrigin(text: Text, cache: ScanCache): RawOrigin {
  const parent = text.parentElement;
  if (parent === null) return 'hidden';
  return isTextVisible(text, cache) && isCamouflaged(parent, cache) === 'clear' ? 'visible' : 'hidden';
}

/** The nearest block-level ancestor of a text node: its passage boundary. */
function blockOf(text: Text, cache: ScanCache): Node | null {
  for (let at = text.parentElement; at !== null; at = at.parentElement) {
    const display = styleOf(at, cache)?.display;
    if (display === undefined ? BLOCK_TAGS.has(at.localName) : BLOCK_DISPLAY.has(display) || display === 'none') {
      return at;
    }
  }
  return text.getRootNode();
}
