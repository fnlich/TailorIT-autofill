/*
 * v5 p2-fill (PLAN decision 14): the page patches, in a frame's own world. No content script: the worker runs their
 * bundle (src/entrypoints/page-patches.ts) in one frame's document, world MAIN, only when a run begins there
 * (content/runtime.ts asks page/patches; background/page-patches.ts), so a page where nothing is filled holds none of
 * it, not even a listener. Installed, they keep one capture listener on the document for their command
 * (dom/patch-protocol.ts) and patch nothing until a write asks:
 * - dialogs.hold / dialogs.release: the page's alert and confirm held through one write (page/dialogs.ts);
 *   dialogs.hold-alerts: its alert alone, through a wait (v5 p2-fill review, security 4);
 * - picker.arm / picker.disarm: the page's own file picker armed for one press of a résumé control (page/picker.ts).
 * A second run of the bundle in the same document finds the first listener answering and adds none (a command the
 * page itself answered is no install of ours: the patches are then simply not there, and every write goes on without
 * them). It holds no data and adds no global: the page's world is the page's.
 */
import { encodePatchAnswer, parsePatchCommand, PATCH_COMMAND, PATCH_RESULT, type PatchAnswer } from '../dom/patch-protocol';
import { dialogHold, type DialogHold } from './dialogs';
import { pickerArm, type PickerArm } from './picker';

/** The probe id a second run sends to find a first install (any answer from the document's listener). */
const PROBE_ID = 'tailorit-install-probe';

/** Installs the patches' listener on a document, unless one answers already; answers its removal (the tests remove
 *  it). */
export function installPatches(doc: Document): () => void {
  const view = doc.defaultView;
  const root = doc.documentElement;
  if (view === null || root === null) return () => undefined;
  // A first install answers a disarm (which changes nothing) inside its dispatch: then there is nothing to add.
  const probe = new view.CustomEvent(PATCH_COMMAND, { detail: JSON.stringify({ v: 1, id: PROBE_ID, op: 'picker.disarm' }),
    bubbles: false, cancelable: true, composed: true });
  if (!root.dispatchEvent(probe)) return () => undefined;

  let dialogs: DialogHold | null = null;
  let picker: PickerArm | null = null;
  const listener = (event: Event): void => {
    // The element itself, inside an open shadow root too.
    const target = event.composedPath()[0] as Element | undefined;
    if (target === undefined || target.nodeType !== 1 || target.ownerDocument !== doc || !target.isConnected) return;
    const command = parsePatchCommand((event as CustomEvent<unknown>).detail);
    if (command === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    let outcome: Pick<PatchAnswer, 'ok' | 'reason' | 'dialogs'>;
    try {
      switch (command.op) {
        case 'dialogs.hold':
        case 'dialogs.hold-alerts':
          dialogs ??= dialogHold(view);
          dialogs.hold(command.op === 'dialogs.hold-alerts');
          outcome = { ok: true, reason: 'ok' };
          break;
        case 'dialogs.release':
          outcome = { ok: true, reason: 'ok', dialogs: dialogs?.release() ?? { alerts: 0, confirms: 0 } };
          break;
        case 'picker.arm':
          picker ??= pickerArm(doc, view);
          outcome = picker.arm(target) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'failed' };
          break;
        default:
          picker?.disarm();
          outcome = { ok: true, reason: 'ok' };
      }
    } catch {
      outcome = { ok: false, reason: 'failed' };
    }
    target.dispatchEvent(new view.CustomEvent(PATCH_RESULT, { detail: encodePatchAnswer({ v: 1, id: command.id,
      ...outcome }), bubbles: false, cancelable: false, composed: false }));
  };
  doc.addEventListener(PATCH_COMMAND, listener, true);
  return () => {
    doc.removeEventListener(PATCH_COMMAND, listener, true);
    picker?.disarm();
    dialogs?.clear();
  };
}
