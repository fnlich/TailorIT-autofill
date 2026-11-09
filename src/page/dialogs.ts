/*
 * v5 p2-fill (PLAN decision 14, Jobright's alert suppressor in our own design): the page's alert and confirm, held
 * through one write of the run, in the page's own world (page/patches.ts makes this hold only once first asked).
 * - dialogs.hold, sent by the isolated world right before a write's own events (and an upload's wait for the page's
 *   word: content/pass.ts, dom/fillers/dialogs.ts), puts the page's window.alert and window.confirm behind wrappers;
 *   dialogs.release, right after, puts them back as they were (the page's own descriptor; a replacement the page made
 *   meanwhile is kept) and answers how many of each the hold held back. Nothing else is patched, nothing outside a hold.
 * - A held alert returns as one dismissed does (undefined); a held confirm returns false, the answer of its Cancel,
 *   which commits the person to nothing (the write's read-back then says whether the page kept it).
 * - Only a dialog the write brought is held: the isolated world holds the dialogs only through the write's own
 *   synchronous events and an upload's wait, and ends a hold at once at the person's own pointer or key on the page
 *   (fillers/dialogs.ts), before the page's handlers of that action run. (The browser's user activation cannot tell: the
 *   person's click on the panel in the page, which starts the fill, gives the page activation for seconds.)
 * - It holds no data: counts of the dialogs held back, never their words. A hold the isolated world never releases
 *   (its document gone, the extension updated) ends by itself after DIALOGS_HOLD_MS.
 * The page fully controls this world: it can see the wrappers, call the originals it kept, and forge a hold; a forged
 * hold only keeps its own dialogs from showing, which the page could do itself.
 */
import { DIALOGS_COUNT_MAX, DIALOGS_HOLD_MS, type HeldDialogs } from '../dom/patch-protocol';

/** The page's dialogs' hold, for one document's window. */
export interface DialogHold {
  /** Holds the page's alert and confirm (a hold within a hold deepens it). */
  hold(): void;
  /** Ends one hold; answers what the holds held back since the first (counts reset once the last hold ends). */
  release(): HeldDialogs;
  /** Ends every hold at once. */
  clear(): void;
}

type Dialog = 'alert' | 'confirm';

/** The hold of `view`'s dialogs (see the header). */
export function dialogHold(view: Window & typeof globalThis): DialogHold {
  let depth = 0;
  let counts: HeldDialogs = { alerts: 0, confirms: 0 };
  let restore: (() => void) | null = null;
  let timer: number | null = null;

  const patch = (): (() => void) => {
    const record = view as unknown as Record<Dialog, unknown>;
    const undo: Array<() => void> = [];
    for (const name of ['alert', 'confirm'] as const) {
      const own = Object.getOwnPropertyDescriptor(view, name);
      const original = record[name];
      if (typeof original !== 'function') continue;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        if (depth > 0) {
          if (name === 'alert') counts = { ...counts, alerts: Math.min(DIALOGS_COUNT_MAX, counts.alerts + 1) };
          else counts = { ...counts, confirms: Math.min(DIALOGS_COUNT_MAX, counts.confirms + 1) };
          return name === 'confirm' ? false : undefined;
        }
        return Reflect.apply(original as (...a: unknown[]) => unknown, this, args);
      };
      try {
        Object.defineProperty(view, name, { configurable: true, enumerable: true, writable: true, value: wrapper });
      } catch {
        continue;
      }
      undo.push(() => {
        // The page's own replacement since the hold stands; ours goes.
        if (record[name] !== wrapper) return;
        try {
          if (own === undefined) delete record[name];
          else Object.defineProperty(view, name, own);
        } catch {
          // Left as it is: the wrapper calls the original once no hold stands.
        }
      });
    }
    return () => undo.forEach((step) => step());
  };

  const end = (): HeldDialogs => {
    const held = counts;
    depth = 0;
    counts = { alerts: 0, confirms: 0 };
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    restore?.();
    restore = null;
    return held;
  };

  return {
    hold() {
      depth += 1;
      if (restore === null) restore = patch();
      if (timer !== null) view.clearTimeout(timer);
      timer = view.setTimeout(() => {
        end();
      }, DIALOGS_HOLD_MS);
    },
    release() {
      if (depth <= 1) return end();
      depth -= 1;
      return counts;
    },
    clear() {
      end();
    },
  };
}
