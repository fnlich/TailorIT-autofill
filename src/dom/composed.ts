/*
 * The composed tree: containment and document order across open shadow roots, as the scanner's own collection reads a
 * page (a host, then its shadow tree, then its own children). Node.contains stops at a shadow root, and Chromium's
 * compareDocumentPosition orders nodes of two trees by no rule (it compares the trees themselves, so the answer may
 * differ from one load to the next), so neither is used across a shadow boundary.
 * Moved here from dom/scan.ts by core pass Z2 of 2026-11-06, so the section finder (dom/sections.ts) orders a heading
 * and a field in a shadow root the same way: SmartRecruiters' screening questions in sr-screening-questions-form's
 * shadow root (fixtures/smartrecruiters/xplor-screening.html) fell now under "Preliminary questions", now under none.
 */

/** Whether `el` is `container` or inside it, open shadow roots crossed (Node.contains stops at a shadow root). */
export function holdsComposed(container: Element, el: Element): boolean {
  let at: Node | null = el;
  while (at !== null) {
    if (at === container) return true;
    const parent: Node | null = at.parentNode;
    // A shadow root's parent is its host (a document fragment of any other kind has none).
    const host: Element | null = parent !== null && parent.nodeType === 11 ? (parent as Partial<ShadowRoot>).host ?? null : null;
    at = host ?? parent;
  }
  return false;
}

/** A node's ancestry from the top of its composed tree: each shadow root between its host and what it holds. */
function composedAncestry(node: Node): Node[] {
  const path: Node[] = [];
  for (let at: Node | null = node; at !== null;) {
    path.push(at);
    at = at.nodeType === 11 ? (at as Partial<ShadowRoot>).host ?? null : at.parentNode;
  }
  return path.reverse();
}

/** Composed document order: below the last ancestor two nodes share, a shadow root comes before its host's own
 *  children, and two nodes of one tree by their place in it; an ancestor before what it holds. */
export function composedOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  const left = composedAncestry(a);
  const right = composedAncestry(b);
  let at = 0;
  while (at < left.length && at < right.length && left[at] === right[at]) at += 1;
  const x = left[at];
  const y = right[at];
  if (x === undefined) return -1;
  if (y === undefined) return 1;
  if (x.nodeType === 11) return -1;
  if (y.nodeType === 11) return 1;
  return (x.compareDocumentPosition(y) & FOLLOWING) !== 0 ? -1 : 1;
}

/** Node.DOCUMENT_POSITION_FOLLOWING, without reaching for a page global. */
const FOLLOWING = 4;
