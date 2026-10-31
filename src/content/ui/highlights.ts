/*
 * Highlights (docs/design/runtime.md §10.1): outlines drawn in the closed shadow root over the fields' rectangles, one
 * colour and chip per status (verified, filled, flagged, blocked; skipped fields get none; the colours are the
 * report's, src/shared/palette.ts), dashed for AI drafts, whose chip asks for the person's confirmation until it is
 * given. They
 * take no pointer events, and the page's own DOM is never annotated: no attribute, class or style is ever set on a page
 * element. A hidden radio or file input is outlined on its proxy (its visible label or the adapter's widget), which the
 * caller passes as the field's elements. At most MAX_HIGHLIGHTS are drawn, the ones that need the person first.
 * Rectangles are measured relative to the host, so they are document coordinates whatever the page's scroll; the page
 * UI re-measures them in an animation frame on scroll and resize.
 */
import type { FillStatus } from '../../core/enums';
import { COPY } from '../../shared/copy';

/** At most this many highlights are drawn. */
export const MAX_HIGHLIGHTS = 200;

/** A status that gets a highlight. */
export type HighlightStatus = Exclude<FillStatus, 'skipped'>;

/** One field to outline. */
export interface HighlightItem {
  key: string;
  status: HighlightStatus;
  /** An AI draft: dashed. */
  draft: boolean;
  /** An AI draft the person already edited or confirmed: still dashed, with its status's chip. */
  draftConfirmed?: boolean;
  /** A selection the final check refused, which the person removes. */
  removeSelection?: boolean;
  /** The visible elements the outline covers (their union). Disconnected ones are left out when drawing. */
  elements: readonly Element[];
}

/** Which statuses are drawn first when there are more than MAX_HIGHLIGHTS. */
const PRIORITY: Readonly<Record<HighlightStatus, number>> = { blocked: 0, flagged: 1, filled: 2, verified: 3 };

/** The highlights layer. */
export interface Highlights {
  set(items: readonly HighlightItem[]): void;
  /** Outlines the field shown on request (field/focus), whatever its status; null removes it. */
  showFocus(elements: readonly Element[] | null): void;
  /** Re-measures every outline against the host's rectangle. */
  render(hostRect: DOMRect): void;
  /** The items drawn now (for tests: never more than MAX_HIGHLIGHTS). */
  readonly count: number;
  /** Whether the focus outline is drawn (for tests). */
  readonly focusShown: boolean;
}

/** The union of the boxes of the connected elements, or null when none has a box. */
function unionOf(elements: readonly Element[]): { left: number; top: number; right: number; bottom: number } | null {
  let box: { left: number; top: number; right: number; bottom: number } | null = null;
  for (const el of elements) {
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    box = box === null ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right),
        bottom: Math.max(box.bottom, rect.bottom) };
  }
  return box;
}

/** Places an outline over a box measured against the host. */
function place(el: HTMLElement, box: { left: number; top: number; right: number; bottom: number }, hostRect: DOMRect):
  void {
  const pad = 3;
  el.hidden = false;
  el.style.left = `${box.left - hostRect.left - pad}px`;
  el.style.top = `${box.top - hostRect.top - pad}px`;
  el.style.width = `${box.right - box.left + pad * 2}px`;
  el.style.height = `${box.bottom - box.top + pad * 2}px`;
}

/** Creates the highlights inside `layer`. */
export function createHighlights(doc: Document, layer: HTMLElement): Highlights {
  let drawn: Array<{ item: HighlightItem; el: HTMLElement }> = [];
  let focusElements: readonly Element[] | null = null;
  const focusEl = doc.createElement('div');
  focusEl.className = 'hl focus';
  focusEl.hidden = true;
  layer.append(focusEl);

  function set(items: readonly HighlightItem[]): void {
    for (const entry of drawn) entry.el.remove();
    const chosen = [...items].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]).slice(0, MAX_HIGHLIGHTS);
    drawn = chosen.map((item) => {
      const el = doc.createElement('div');
      el.className = 'hl';
      el.dataset.status = item.status;
      el.dataset.draft = item.draft ? 'true' : 'false';
      const chip = doc.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.removeSelection ? COPY.removeSelection
        : item.draft && item.draftConfirmed !== true ? COPY.draftChip : COPY.chips[item.status];
      el.append(chip);
      el.hidden = true;
      layer.insertBefore(el, focusEl);
      return { item, el };
    });
  }

  function render(hostRect: DOMRect): void {
    for (const { item, el } of drawn) {
      const box = unionOf(item.elements);
      if (box === null) el.hidden = true;
      else place(el, box, hostRect);
    }
    const box = focusElements === null ? null : unionOf(focusElements);
    if (box === null) focusEl.hidden = true;
    else place(focusEl, box, hostRect);
  }

  return {
    set,
    showFocus(elements) {
      focusElements = elements;
      if (elements === null) focusEl.hidden = true;
    },
    render,
    get count() {
      return drawn.length;
    },
    get focusShown() {
      return !focusEl.hidden;
    },
  };
}
