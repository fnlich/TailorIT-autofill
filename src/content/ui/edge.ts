/*
 * The launcher's tab at the page's right edge (v3 Phase 3, Jobright's floating launcher, in TailorIT's look): a white
 * tab fixed to the window's right edge holding a close button ("×"), the launcher (TailorIT's tile, launcher.ts) and a
 * grip. Only the top frame draws it: a form embedded in another site's page keeps its launcher at the form's corner,
 * where it is also how the run knows the frame is seen on that page (S1).
 * - The grip drags the tab up and down only (a trusted pointerdown on the visible grip, then the pointer's trusted moves,
 *   captured by the grip), kept within the window; ArrowUp and ArrowDown on it move it too. Where it was dropped goes
 *   to `placed` as a fraction of the window's height, once per drag and once per key press however long the key is
 *   held (its keyup, or the grip losing focus), which the worker keeps for the site.
 * - The "×" opens the hide menu: Hide until next visit (this document only), Hide on this site, Hide everywhere, each
 *   a trusted click on a visible item. It opens upward when the tab is near the window's bottom; a keyboard's opening
 *   puts the focus on its first item, ArrowUp, ArrowDown, Home and End move it, Escape and Tab close it, and so does a
 *   trusted click anywhere outside it. The toolbar icon brings it back (the side panel's "Show the TailorIT button
 *   again").
 * - The tab hides while the person hid it, or while a panel of ours shows the tab (the in-page panel, or the browser's
 *   side panel, which the worker says).
 * Every control accepts trusted events only, and only while it can be seen (`act`, the page UI's visibility rule).
 * Nothing here reads or writes the page's own DOM; the tab lives in the closed shadow root.
 */
import { COPY } from '../../shared/copy';
import { ICONS } from '../../shared/icons';
import { svgOf } from './svg';

/** The tab's place when the person never moved it: 120 px from the window's top (Jobright's). */
export const EDGE_DEFAULT_TOP_PX = 120;
/** The tab keeps this far from the window's top and bottom. */
export const EDGE_MARGIN_PX = 8;
/** One arrow key's move of the grip. */
export const EDGE_KEY_STEP_PX = 24;

/** Where the person hid the tab from its menu. */
export type HideScope = 'next-visit' | 'site' | 'everywhere';

/** What the tab asks of the page UI. */
export interface EdgeHandlers {
  /** The tab was dropped at `top`, a fraction of the window's height. */
  placed(top: number): void;
  /** The person chose to hide the tab. */
  hide(scope: HideScope): void;
  /** Runs `action` when a trusted event on `control` counts: the control is visible now (the page UI's rule). `now`:
   *  the event needs an answer at once (a drag's start); otherwise it may wait for the visibility watch's first word. */
  act(control: Element, action: () => void, now: boolean): void;
  /** The tab's controls appeared or went (the menu opened or closed): the visibility watch follows them. */
  controls(added: readonly Element[], removed: readonly Element[]): void;
}

/** The tab, drawn. */
export interface Edge {
  readonly el: HTMLElement;
  readonly grip: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  /** The hide menu's items, in order (next visit, site, everywhere), while it is open; [] otherwise. */
  readonly menuItems: readonly HTMLButtonElement[];
  readonly menuOpen: boolean;
  /** The saved place (a fraction of the window's height), or null for the default. */
  setTop(top: number | null): void;
  /** The tab's top now, in CSS pixels. */
  topPx(): number;
  /** Lays the tab out again (the window was resized). */
  layout(): void;
  closeMenu(): void;
  destroy(): void;
}

/** Builds the tab around `launcher` (the launcher's own button). */
export function createEdge(doc: Document, launcher: HTMLElement, handlers: EdgeHandlers): Edge {
  const view = doc.defaultView;
  const lifetime = new AbortController();
  const el = doc.createElement('div');
  el.className = 'edge';
  el.dataset.edge = '';

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'edge__close';
  close.setAttribute('aria-label', COPY.launcherHide.open);
  close.title = COPY.launcherHide.open;
  close.setAttribute('aria-haspopup', 'menu');
  close.setAttribute('aria-expanded', 'false');
  close.append(svgOf(doc, ICONS.close, 12));

  const grip = doc.createElement('button');
  grip.type = 'button';
  grip.className = 'edge__grip';
  grip.setAttribute('aria-label', COPY.launcherMove);
  grip.title = COPY.launcherMove;
  grip.append(svgOf(doc, ICONS.grip, 14));

  const menu = doc.createElement('div');
  menu.className = 'edge__menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', COPY.launcherHide.open);
  menu.hidden = true;
  const words = COPY.launcherHide;
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
      }, false);
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
  /** `px` kept within the window, the tab's own height under it. */
  const clamp = (px: number) => {
    const box = el.getBoundingClientRect().height || 96;
    return Math.round(Math.min(Math.max(EDGE_MARGIN_PX, px), Math.max(EDGE_MARGIN_PX, height() - box - EDGE_MARGIN_PX)));
  };
  const draw = (px: number) => {
    top = clamp(px);
    el.style.top = `${top}px`;
  };
  const layout = () => draw(saved === null ? EDGE_DEFAULT_TOP_PX : saved * height());
  const drop = () => handlers.placed(Math.min(1, Math.max(0, top / height())));

  function openMenu(byKeyboard: boolean): void {
    menu.hidden = false;
    close.setAttribute('aria-expanded', 'true');
    // Near the window's bottom it opens upward, so every item stays in the window.
    delete menu.dataset.up;
    if (menu.getBoundingClientRect().bottom > height() - EDGE_MARGIN_PX) menu.dataset.up = '';
    handlers.controls(items, []);
    if (byKeyboard) items[0]?.focus();
  }

  function closeMenu(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    close.setAttribute('aria-expanded', 'false');
    handlers.controls([], items);
  }

  close.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    // A click the keyboard made (Enter or Space: no pointer, detail 0) moves the focus into the menu.
    const byKeyboard = event.detail === 0;
    handlers.act(close, () => (menu.hidden ? openMenu(byKeyboard) : closeMenu()), false);
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

  // A trusted press outside the tab closes the menu (the page's own events never do). The tab hears its own press
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

  // The drag: the grip's trusted pointerdown, while it is seen; then its captured trusted moves, up and down only.
  let dragging: { pointerId: number; from: number; top: number } | null = null;
  grip.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    handlers.act(grip, () => {
      dragging = { pointerId: event.pointerId, from: event.clientY, top };
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag follows the moves that still reach the grip.
      }
      el.dataset.dragging = '';
    }, true);
  }, { signal: lifetime.signal });
  grip.addEventListener('pointermove', (event) => {
    if (!event.isTrusted || dragging === null || event.pointerId !== dragging.pointerId) return;
    draw(dragging.top + event.clientY - dragging.from);
  }, { signal: lifetime.signal });
  const end = (event: PointerEvent) => {
    if (!event.isTrusted || dragging === null || event.pointerId !== dragging.pointerId) return;
    const moved = top !== dragging.top;
    dragging = null;
    delete el.dataset.dragging;
    if (moved) drop();
  };
  grip.addEventListener('pointerup', end, { signal: lifetime.signal });
  grip.addEventListener('pointercancel', end, { signal: lifetime.signal });
  // The arrow keys move it at once; where it ends goes to the worker once, at the key's release (or when the grip
  // loses the focus), however long the key was held.
  let keyMoved = false;
  grip.addEventListener('keydown', (event) => {
    if (!event.isTrusted || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    handlers.act(grip, () => {
      draw(top + (event.key === 'ArrowUp' ? -EDGE_KEY_STEP_PX : EDGE_KEY_STEP_PX));
      keyMoved = true;
    }, true);
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
    setTop(next) {
      saved = next;
      if (dragging === null) layout();
    },
    topPx: () => top,
    layout() {
      if (dragging === null) layout();
    },
    closeMenu,
    destroy() {
      lifetime.abort();
    },
  };
}
