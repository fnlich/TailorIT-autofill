/*
 * v5 p2-fill (PLAN decision 14): the page's alert and confirm held through one write, the isolated world's side (the
 * page's is page/dialogs.ts, through the page-world bridge: dom/bridge.ts). A write (content/pass.ts) holds them right
 * before its own events and releases them right after (and after an upload's wait for the page's word), so a dialog
 * the write itself brought (a page's "File uploaded", an "Are you sure?" on a change) never stops the run; one that
 * follows the person's own click or key shows as always (the page's side reads the browser's user activation). The
 * commands go to the document's root element, which is no field: nothing of the write is named, and a field the page
 * replaces meanwhile cannot leave a hold standing. Without a bridge in the frame (a company page, a host it does not
 * install on) nothing is held, and the page's dialogs show as before. Counts come back, never a dialog's words.
 */
import { askBridge } from '../bridge';
import type { HeldDialogs } from '../bridge-protocol';

/** One hold of the page's dialogs. */
export interface DialogsHeld {
  /** Ends the hold; answers what it held back, or null where no bridge held anything. Calling it again answers null. */
  release(): HeldDialogs | null;
}

/** Holds `doc`'s dialogs (see the header). */
export function holdDialogs(doc: Document): DialogsHeld {
  const root = doc.documentElement;
  const held = root === null ? null : askBridge(root, { op: 'dialogs.hold' });
  if (held?.ok !== true) return { release: () => null };
  let done = false;
  return {
    release() {
      if (done) return null;
      done = true;
      const ended = doc.documentElement === null ? null : askBridge(doc.documentElement, { op: 'dialogs.release' });
      return ended?.ok === true ? ended.dialogs ?? { alerts: 0, confirms: 0 } : null;
    },
  };
}

/** Runs `work` with `doc`'s dialogs held (holdDialogs), and tells `heard` what the hold held back, when anything. */
export function withDialogsHeld<T>(doc: Document, work: () => T, heard: (held: HeldDialogs) => void): T {
  const hold = holdDialogs(doc);
  try {
    return work();
  } finally {
    const held = hold.release();
    if (held !== null && (held.alerts > 0 || held.confirms > 0)) heard(held);
  }
}

/** withDialogsHeld for work that waits (an upload's confirmation). */
export async function withDialogsHeldWhile<T>(doc: Document, work: () => Promise<T>,
  heard: (held: HeldDialogs) => void): Promise<T> {
  const hold = holdDialogs(doc);
  try {
    return await work();
  } finally {
    const held = hold.release();
    if (held !== null && (held.alerts > 0 || held.confirms > 0)) heard(held);
  }
}
