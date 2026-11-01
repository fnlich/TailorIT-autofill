/*
 * Edit with AI (the owner's amendments, docs/SPEC-AMENDMENTS.md; the plan's Phase F "Edit with AI button"): one button
 * in each text box the run offers it on, drawn in the closed shadow root over the box's bottom-left corner, inside its
 * box. It is TailorIT's 24 px mark, which widens to say "Edit with AI" on hover and on keyboard focus (a display
 * change: no transform, opacity, filter or will-change, which IntersectionObserver v2 would read as unseen). Its name
 * is "Edit with AI" (aria-label), and the layer is not hidden from assistive technology.
 * - The run decides which boxes get one (the core's aiEditable, while the run rests, not in a dry run or a
 *   profile-only run); this file draws them, re-measured on scroll and resize, at most MAX_AI_EDITS.
 * - A click counts only when it is trusted (event.isTrusted) and the button is visible where it is drawn: the page UI
 *   watches each button with IntersectionObserver v2 (visible.ts), so a page layer drawn over it that lets clicks
 *   through makes it not visible and the click does nothing. The click stops at the button: it is outside the page's
 *   form, in the closed root, and presses nothing of the page's.
 * - While its rewrite is on its way the button is disabled and says so (aria-busy); one rewrite at a time is the run's
 *   rule (orchestrator.ts rewriteField).
 * The page's own DOM is never annotated: no attribute, class or style is set on a page element.
 */
import { COPY } from '../../shared/copy';
import { LOGO_MARK } from '../../shared/icons';
import { svgOf } from './svg';

/** At most this many buttons are drawn. */
export const MAX_AI_EDITS = 100;

/** The mark's size, and its inset inside the box's bottom-left corner. */
export const AI_EDIT_PX = 24;
const INSET_PX = 4;

/** One text box to draw the button in. */
export interface AiEditItem {
  key: string;
  /** The box's own control (its rectangle places the button). Disconnected ones are left out when drawing. */
  elements: readonly Element[];
  /** Its rewrite is on its way. */
  busy?: boolean;
}

/** The Edit with AI layer. */
export interface AiEdits {
  set(items: readonly AiEditItem[]): void;
  /** Re-measures every button against the host's rectangle. */
  render(hostRect: DOMRect): void;
  /** The buttons drawn now (for tests and the visibility watch). */
  readonly buttons: readonly HTMLButtonElement[];
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

/**
 * Creates the layer's buttons inside `layer`. `onClick` is called for a trusted click on a button, with the field's key
 * and the button (the page UI checks it was visible). `onButtons` hears the buttons drawn and removed, for the
 * visibility watch.
 */
export function createAiEdits(doc: Document, layer: HTMLElement, onClick: (key: string, button: HTMLButtonElement) => void,
  onButtons: (added: readonly HTMLButtonElement[], removed: readonly HTMLButtonElement[]) => void): AiEdits {
  /** The buttons drawn, by field key, kept across redraws so a button under the pointer or the focus stays itself. */
  let drawn = new Map<string, { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }>();

  function buttonFor(key: string): { button: HTMLButtonElement; label: HTMLSpanElement } {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ai-edit';
    button.setAttribute('aria-label', COPY.editWithAi);
    button.title = COPY.editWithAi;
    const label = doc.createElement('span');
    label.className = 'ai-edit__label';
    label.setAttribute('aria-hidden', 'true');
    button.append(svgOf(doc, LOGO_MARK, AI_EDIT_PX, 'mark'), label);
    button.hidden = true;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted || button.disabled) return;
      onClick(key, button);
    });
    return { button, label };
  }

  /** A button's state for its item: busy while its rewrite is on its way. */
  function update(entry: { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }): void {
    const busy = entry.item.busy === true;
    entry.button.disabled = busy;
    entry.button.setAttribute('aria-busy', busy ? 'true' : 'false');
    entry.label.textContent = busy ? COPY.editingWithAi : COPY.editWithAi;
  }

  return {
    set(items) {
      const next = new Map<string, { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }>();
      const added: HTMLButtonElement[] = [];
      for (const item of items.slice(0, MAX_AI_EDITS)) {
        if (next.has(item.key)) continue;
        const kept = drawn.get(item.key);
        const entry = kept === undefined ? { item, ...buttonFor(item.key) } : { ...kept, item };
        if (kept === undefined) {
          layer.append(entry.button);
          added.push(entry.button);
        }
        update(entry);
        next.set(item.key, entry);
      }
      const removed = [...drawn].filter(([key]) => !next.has(key)).map(([, entry]) => entry.button);
      for (const button of removed) button.remove();
      drawn = next;
      if (added.length > 0 || removed.length > 0) onButtons(added, removed);
    },
    render(hostRect) {
      for (const { item, button } of drawn.values()) {
        const box = unionOf(item.elements);
        if (box === null) {
          button.hidden = true;
          continue;
        }
        button.hidden = false;
        const height = box.bottom - box.top;
        // Inside the box's bottom-left corner; a box too low for it has it centred on its height.
        const top = height >= AI_EDIT_PX + INSET_PX * 2 ? box.bottom - AI_EDIT_PX - INSET_PX
          : box.top + (height - AI_EDIT_PX) / 2;
        button.style.left = `${box.left - hostRect.left + INSET_PX}px`;
        button.style.top = `${top - hostRect.top}px`;
      }
    },
    get buttons() {
      return [...drawn.values()].map((entry) => entry.button);
    },
  };
}
