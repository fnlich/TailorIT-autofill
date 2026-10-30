/*
 * The per-scan memo and the few tree helpers every DOM module shares. A scan reads each element's computed style and
 * each ancestor's visibility facts once, so one pass over a form is linear in its nodes. A cache lives for one scan
 * (or one check) only: the page changes between passes, so nothing here is kept across them. Everything is reached
 * through the node's own document and its defaultView, never page globals, so it works the same inside any frame.
 */

/** A memo keyed by node, in named tables; it lives for one scan or one check. */
export class ScanCache {
  private readonly tables = new Map<string, WeakMap<object, unknown>>();

  /** The value of `compute` for `key` in `table`, computed once per cache. */
  memo<V>(table: string, key: object, compute: () => V): V {
    let map = this.tables.get(table);
    if (map === undefined) {
      map = new WeakMap<object, unknown>();
      this.tables.set(table, map);
    }
    if (map.has(key)) return map.get(key) as V;
    const value = compute();
    map.set(key, value);
    return value;
  }
}

/** A fresh cache, for one scan or one check. */
export function newScanCache(): ScanCache {
  return new ScanCache();
}

/** The window a node renders in, or null when its document has none (a detached or inert document). */
export function viewOf(node: Node): (Window & typeof globalThis) | null {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return (doc?.defaultView ?? null) as (Window & typeof globalThis) | null;
}

/** The computed style of an element, read once per cache; null when it has no window. */
export function styleOf(el: Element, cache: ScanCache): CSSStyleDeclaration | null {
  return cache.memo('style', el, () => viewOf(el)?.getComputedStyle(el) ?? null);
}

/** The parent of a node in the flat tree: its slot when slotted, else its parent element, else the host of the shadow
 *  root it sits in. Visibility follows this chain, because that is how the node is rendered. */
export function flatParent(node: Node): Element | null {
  const slotted = (node as Partial<Element>).assignedSlot;
  if (slotted) return slotted;
  if (node.parentElement) return node.parentElement;
  const parent = node.parentNode;
  if (parent && parent.nodeType === 11 && 'host' in parent) return (parent as ShadowRoot).host;
  return null;
}

/** True when `ancestor` is `node` or contains it in the flat tree (shadow roots crossed through their hosts). */
export function flatContains(ancestor: Element, node: Node): boolean {
  for (let at: Node | null = node; at !== null; at = flatParent(at)) {
    if (at === ancestor) return true;
  }
  return false;
}

/** The element's tag name in lower case (namespaced elements keep their local name). */
export function tagOf(el: Element): string {
  return el.localName;
}
