/*
 * v5 p2-fill (PLAN decision 14): the page's alert and confirm held through one write, the isolated world's side (the
 * page's is page/dialogs.ts, among the page patches the worker runs in the frame once a run begins: dom/patches.ts).
 * A write (content/pass.ts) holds them right before its own events and releases them right after (and after an
 * upload's wait for the page's word), so a dialog the write itself brought (a page's "File uploaded", an "Are you
 * sure?" on a change) never stops the run:
 * - through the write's own events (withDialogsHeld) nothing of the person's can come between: those events are
 *   dispatched and answered synchronously;
 * - through a wait (withDialogsHeldWhile), the person's own pointer or key on the page (a trusted pointerdown,
 *   mousedown, touchstart or keydown anywhere in the document, heard first, in the capture phase) ends the hold at
 *   once, before the page's handlers of that action run, so the dialog their action brings shows as always.
 * The commands go to the document's root element, which is no field: nothing of the write is named, and a field the
 * page replaces meanwhile cannot leave a hold standing. Without the patches in the frame (a run not begun, a page that
 * answered our probe itself) nothing is held, and the page's dialogs show as before. Counts come back, never words.
 */
import type { HeldDialogs } from '../patch-protocol';
import { askPatches } from '../patches';

/** One hold of the page's dialogs. */
export interface DialogsHeld {
  /** Ends the hold; answers what it held back, or null where nothing was held. Calling it again answers null. */
  release(): HeldDialogs | null;
}

/** The person's own actions that end a hold made through a wait. */
const PERSON_ACTIONS = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const;

/** Holds `doc`'s dialogs (see the header). */
export function holdDialogs(doc: Document): DialogsHeld {
  const root = doc.documentElement;
  const held = root === null ? null : askPatches(root, 'dialogs.hold');
  if (held?.ok !== true) return { release: () => null };
  let done = false;
  return {
    release() {
      if (done) return null;
      done = true;
      const ended = doc.documentElement === null ? null : askPatches(doc.documentElement, 'dialogs.release');
      return ended?.ok === true ? ended.dialogs ?? { alerts: 0, confirms: 0 } : null;
    },
  };
}

/** Tells `heard` what a hold held back, when anything. */
function tell(held: HeldDialogs | null, heard: (held: HeldDialogs) => void): void {
  if (held !== null && (held.alerts > 0 || held.confirms > 0)) heard(held);
}

/** Runs `work` (a write's own synchronous events) with `doc`'s dialogs held (holdDialogs), and tells `heard` what the
 *  hold held back, when anything. */
export function withDialogsHeld<T>(doc: Document, work: () => T, heard: (held: HeldDialogs) => void): T {
  const hold = holdDialogs(doc);
  try {
    return work();
  } finally {
    tell(hold.release(), heard);
  }
}

/** withDialogsHeld for work that waits (an upload's confirmation, a picker's press): the person's own pointer or key
 *  on the page ends the hold at once (see the header). */
export async function withDialogsHeldWhile<T>(doc: Document, work: () => Promise<T>,
  heard: (held: HeldDialogs) => void): Promise<T> {
  const hold = holdDialogs(doc);
  let early: HeldDialogs | null = null;
  const onPerson = (event: Event): void => {
    if (!event.isTrusted) return;
    early = hold.release();
    for (const type of PERSON_ACTIONS) doc.removeEventListener(type, onPerson, true);
  };
  for (const type of PERSON_ACTIONS) doc.addEventListener(type, onPerson, true);
  try {
    return await work();
  } finally {
    for (const type of PERSON_ACTIONS) doc.removeEventListener(type, onPerson, true);
    tell(hold.release() ?? early, heard);
  }
}
