/*
 * The launcher at the page's right edge (v3 Phase 3; v5 p1-shell, PLAN decision 2: Jobright's launcher, read for
 * behaviour only, in TailorIT's look): a white horizontal pill fixed to the window's right edge, holding the launcher
 * (TailorIT's tile, launcher.ts) and a teal grip strip. Only the top frame draws it: a form embedded in another site's
 * page keeps its launcher at the form's corner, where it is also how the run knows the frame is seen on that page (S1).
 * - It sits EDGE_TUCK_PX past the window's edge and slides fully out while the pointer is over it or the focus is in
 *   it (a 2D move only: the visibility watch still judges it), and while its menu is open or it is dragged.
 * - A round "×" shows at its top-left only then; it opens the hide menu: Hide until next visit (this document only),
 *   Hide on this site, Hide everywhere, each a trusted click on a visible item. The menu opens upward when the pill is
 *   near the window's bottom; a keyboard's opening puts the focus on its first item, ArrowUp, ArrowDown, Home and End
 *   move it, Escape and Tab close it, and so does a trusted click anywhere outside it. The toolbar icon brings it back.
 * - The whole pill drags up and down (a trusted pointerdown on its visible launcher or grip, which takes the pointer,
 *   then the pointer's trusted moves; past EDGE_DRAG_PX it is a drag, and the launcher's click that ends it does nothing),
 *   kept within the window; ArrowUp and ArrowDown on the grip move it too. Where it was dropped goes to `placed` as a
 *   fraction of the window's height, once per drag and once per key press however long the key is held (its keyup, or
 *   the grip losing focus), which the worker keeps for the site.
 * - It hides while the person hid it, or while a panel of ours shows the tab (the sidebar, the in-page panel, or the
 *   browser's side panel, which the worker says).
 * Every control accepts trusted events only, and only once it has been seen without a break for CONTROL_SEEN_MS (`act`,
 * the page UI's visibility rule; the audit of 2026-11-06, S-1): a menu just opened takes its items' clicks 600 ms on, and
 * the "×" its click 600 ms after it showed. Nothing here reads or writes the page's own DOM; the pill lives in the closed
 * shadow root.
 */
import { PAGE_COPY } from '../../shared/copy';
import { ICONS } from '../../shared/icons';
import { svgOf } from './svg';

/** The pill's place when the person never moved it: 120 px from the window's top (Jobright's). */
export const EDGE_DEFAULT_TOP_PX = 120;
/** The pill keeps this far from the window's top and bottom. */
export const EDGE_MARGIN_PX = 8;
/** One arrow key's move of the grip. */
export const EDGE_KEY_STEP_PX = 24;
/** v5: how far the pill sits past the window's right edge until it slides out (Jobright's 24 px). */
export const EDGE_TUCK_PX = 24;
/** v5: how far a press must move before it is a drag rather than a click. */
export const EDGE_DRAG_PX = 4;

/** Where the person hid the pill from its menu. */
export type HideScope = 'next-visit' | 'site' | 'everywhere';

/** What the pill asks of the page UI. */
export interface EdgeHandlers {
  /** The pill was dropped at `top`, a fraction of the window's height. */
  placed(top: number): void;
  /** The person chose to hide the pill. */
  hide(scope: HideScope): void;
  /** Runs `action` when a trusted event on `control` counts: the control has been seen, without a break, for the page
   *  UI's CONTROL_SEEN_MS (the audit of 2026-11-06, S-1); decided at the event, never later. */
  act(control: Element, action: () => void): void;
  /** The pill's controls appeared or went (the menu or the "×" opened or closed): the visibility watch follows them. */
  controls(added: readonly Element[], removed: readonly Element[]): void;
}

/** The pill, drawn. */
export interface Edge {
  readonly el: HTMLElement;
  readonly grip: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  /** The hide menu's items, in order (next visit, site, everywhere), while it is open; [] otherwise. */
  readonly menuItems: readonly HTMLButtonElement[];
  readonly menuOpen: boolean;
  /** Whether the pill is slid out now (hovered, focused, its menu open or dragged). */
  readonly out: boolean;
  /** The saved place (a fraction of the window's height), or null for the default. */
  setTop(top: number | null): void;
  /** The pill's top now, in CSS pixels. */
  topPx(): number;
  /** Whether the launcher's click that just came ends a drag (and so does nothing); asked once per click. */
  endedDrag(): boolean;
  /** Lays the pill out again (the window was resized). */
  layout(): void;
  closeMenu(): void;
  destroy(): void;
}

/** Builds the pill around `launcher` (the launcher's own button). */
export function createEdge(doc: Document, launcher: HTMLElement, handlers: EdgeHandlers): Edge {
  const view = doc.defaultView;
  const lifetime = new AbortController();
  const el = doc.createElement('div');
  el.className = 'edge';
  el.dataset.edge = '';

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'edge__close';
  close.setAttribute('aria-label', PAGE_COPY.launcherHide.open);
  close.title = PAGE_COPY.launcherHide.open;
  close.setAttribute('aria-haspopup', 'menu');
  close.setAttribute('aria-expanded', 'false');
  close.append(svgOf(doc, ICONS.close, 10));

  const grip = doc.createElement('button');
  grip.type = 'button';
  grip.className = 'edge__grip';
  grip.setAttribute('aria-label', PAGE_COPY.launcherMove);
  grip.title = PAGE_COPY.launcherMove;
  grip.append(svgOf(doc, ICONS.grip, 14));

  const menu = doc.createElement('div');
  menu.className = 'edge__menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', PAGE_COPY.launcherHide.open);
  menu.hidden = true;
  const words = PAGE_COPY.launcherHide;
  const scopes: Array<{ scope: HideScope; text: string }> = [
    { scope: 'next-visit', text: words.nextVisit }, { scope: 'site', text: words.site },
    { scope: 'everywhere', text: words.everywhere }];
  const items = scopes.map(({ scope, text }) => {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'edge__item';
    item.setAttribute('role', 'menuitem');
    item.dataset.hide = scope;
    item.textContent = text;
    item.addEventListener('click', (event) => {
      if (!event.isTrusted || menu.hidden) return;
      handlers.act(item, () => {
        if (menu.hidden) return;
        closeMenu();
        handlers.hide(scope);
      });
    }, { signal: lifetime.signal });
    return item;
  });
  const note = doc.createElement('p');
  note.className = 'edge__note';
  note.textContent = words.note;
  menu.append(...items, note);

  el.append(close, launcher, grip, menu);

  /** The saved place, as a fraction of the window's height; null: the default. */
  let saved: number | null = null;
  /** Where it is drawn now (CSS pixels from the window's top). */
  let top = EDGE_DEFAULT_TOP_PX;

  const height = () => Math.max(1, view?.innerHeight ?? 1);
  /** `px` kept within the window, the pill's own height under it. */
  const clamp = (px: number) => {
    const box = el.getBoundingClientRect().height || 56;
    return Math.round(Math.min(Math.max(EDGE_MARGIN_PX, px), Math.max(EDGE_MARGIN_PX, height() - box - EDGE_MARGIN_PX)));
  };
  const draw = (px: number) => {
    top = clamp(px);
    el.style.top = `${top}px`;
  };
  const layout = () => draw(saved === null ? EDGE_DEFAULT_TOP_PX : saved * height());
  const drop = () => handlers.placed(Math.min(1, Math.max(0, top / height())));

  // ── Out or tucked: the pointer over it or the focus in it, its menu open, a drag; the "×" shows only then. ──
  let hovered = false;
  let focused = false;
  let dragging: { pointerId: number; from: number; top: number; moved: boolean } | null = null;
  let closeShown = false;
  function showOut(): void {
    const out = hovered || focused || !menu.hidden || (dragging?.moved ?? false);
    if (out) el.dataset.out = '';
    else delete el.dataset.out;
    // The "×" is a control while it shows: the visibility watch follows it, and its click counts CONTROL_SEEN_MS on.
    if (out !== closeShown) {
      closeShown = out;
      handlers.controls(out ? [close] : [], out ? [] : [close]);
    }
  }
  el.addEventListener('pointerenter', (event) => {
    if (!event.isTrusted) return;
    hovered = true;
    showOut();
  }, { signal: lifetime.signal });
  el.addEventListener('pointerleave', (event) => {
    if (!event.isTrusted) return;
    hovered = false;
    showOut();
  }, { signal: lifetime.signal });
  el.addEventListener('focusin', (event) => {
    if (!event.isTrusted) return;
    focused = true;
    showOut();
  }, { signal: lifetime.signal });
  el.addEventListener('focusout', (event) => {
    if (!event.isTrusted) return;
    const next = (event as FocusEvent).relatedTarget as Node | null;
    focused = next !== null && el.contains(next);
    showOut();
  }, { signal: lifetime.signal });

  function openMenu(byKeyboard: boolean): void {
    menu.hidden = false;
    close.setAttribute('aria-expanded', 'true');
    // Near the window's bottom it opens upward, so every item stays in the window.
    delete menu.dataset.up;
    if (menu.getBoundingClientRect().bottom > height() - EDGE_MARGIN_PX) menu.dataset.up = '';
    handlers.controls(items, []);
    showOut();
    if (byKeyboard) items[0]?.focus();
  }

  function closeMenu(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    close.setAttribute('aria-expanded', 'false');
    handlers.controls([], items);
    showOut();
  }

  close.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    // A click the keyboard made (Enter or Space: no pointer, detail 0) moves the focus into the menu.
    const byKeyboard = event.detail === 0;
    handlers.act(close, () => (menu.hidden ? openMenu(byKeyboard) : closeMenu()));
  }, { signal: lifetime.signal });

  el.addEventListener('keydown', (event) => {
    if (!event.isTrusted || menu.hidden) return;
    if (event.key === 'Escape') {
      closeMenu();
      close.focus();
      return;
    }
    const at = items.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const to = event.key === 'ArrowDown' ? (at + 1) % items.length : event.key === 'ArrowUp'
      ? (at - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (to !== null) {
      event.preventDefault();
      items[to]!.focus();
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  }, { signal: lifetime.signal });

  // A trusted press outside the pill closes the menu (the page's own events never do). The pill hears its own press
  // first, as it bubbles out of the closed root (whose path the document cannot see into), and forgets it once that
  // event is over, whether or not it reached the document.
  let pressedInside = false;
  el.addEventListener('pointerdown', () => {
    pressedInside = true;
    queueMicrotask(() => {
      pressedInside = false;
    });
  }, { signal: lifetime.signal });
  doc.addEventListener('pointerdown', (event) => {
    if (event.isTrusted && !menu.hidden && !pressedInside) closeMenu();
  }, { signal: lifetime.signal });

  // ── The drag: the whole pill, from a trusted press on its seen launcher or grip; a drag once past EDGE_DRAG_PX. ──
  /** A click on the launcher that ends a drag does nothing (endedDrag). */
  let dragEnded = false;
  el.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    dragEnded = false;
    const path = event.composedPath();
    const control = path.includes(grip) ? grip : path.includes(launcher) ? launcher : null;
    if (control === null) return;
    handlers.act(control, () => {
      dragging = { pointerId: event.pointerId, from: event.clientY, top, moved: false };
      // The pressed control takes the pointer, so the moves follow it however the pill moves, and a press that ends
      // where it began is still that control's click.
      try {
        control.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag follows the moves that still reach the pill.
      }
    });
  }, { signal: lifetime.signal });
  el.addEventListener('pointermove', (event) => {
    if (!event.isTrusted || dragging === null || event.pointerId !== dragging.pointerId) return;
    if (!dragging.moved && Math.abs(event.clientY - dragging.from) < EDGE_DRAG_PX) return;
    if (!dragging.moved) {
      // A drag now, not a click.
      dragging.moved = true;
      el.dataset.dragging = '';
      showOut();
    }
    draw(dragging.top + event.clientY - dragging.from);
  }, { signal: lifetime.signal });
  const end = (event: PointerEvent) => {
    if (!event.isTrusted || dragging === null || event.pointerId !== dragging.pointerId) return;
    const was = dragging;
    dragging = null;
    delete el.dataset.dragging;
    if (was.moved) {
      dragEnded = true;
      if (top !== was.top) drop();
    }
    showOut();
  };
  el.addEventListener('pointerup', end, { signal: lifetime.signal });
  el.addEventListener('pointercancel', end, { signal: lifetime.signal });
  // The arrow keys move it at once; where it ends goes to the worker once, at the key's release (or when the grip
  // loses the focus), however long the key was held.
  let keyMoved = false;
  grip.addEventListener('keydown', (event) => {
    if (!event.isTrusted || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    handlers.act(grip, () => {
      draw(top + (event.key === 'ArrowUp' ? -EDGE_KEY_STEP_PX : EDGE_KEY_STEP_PX));
      keyMoved = true;
    });
  }, { signal: lifetime.signal });
  const keyDone = (event: Event) => {
    if (!event.isTrusted || !keyMoved) return;
    if (event instanceof KeyboardEvent && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    keyMoved = false;
    drop();
  };
  grip.addEventListener('keyup', keyDone, { signal: lifetime.signal });
  grip.addEventListener('blur', keyDone, { signal: lifetime.signal });

  layout();

  return {
    el,
    grip,
    close,
    get menuItems() {
      return menu.hidden ? [] : items;
    },
    get menuOpen() {
      return !menu.hidden;
    },
    get out() {
      return el.dataset.out !== undefined;
    },
    setTop(next) {
      saved = next;
      if (dragging === null) layout();
    },
    topPx: () => top,
    endedDrag() {
      const ended = dragEnded;
      dragEnded = false;
      return ended;
    },
    layout() {
      if (dragging === null) layout();
    },
    closeMenu,
    destroy() {
      lifetime.abort();
    },
  };
}
