/*
 * v5 p2-fill (PLAN decision 14): the isolated world's side of the page patches (the protocol is patch-protocol.ts, the
 * patches page/patches.ts, which the worker runs in the frame's own world once a run begins there). One command is a
 * CustomEvent on the element it is about, built with that element's window, composed, its answer taken on the same
 * element inside the dispatch, as dom/bridge.ts sends the bridge's:
 * - a command nothing acknowledged (no patches in this frame yet, or a page that stopped it) is null, and so is one
 *   acknowledged but unanswered when the dispatch returns: nothing is ever waited for;
 * - an answer is a claim of the page's world, which any page script can forge: the caller never trusts it beyond
 *   whether to go on (a hold, an arm), and reads back what it wrote itself.
 * Only the op and a random id are sent; nothing is logged.
 */
import { windowOf } from './fillers/events';
import { encodePatchCommand, parsePatchAnswer, PATCH_COMMAND, PATCH_RESULT, type PatchAnswer, type PatchOp } from './patch-protocol';

/** A random command id: 16 bytes as 32 hex digits. */
function newId(view: Window & typeof globalThis): string {
  return Array.from(view.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Sends one command about `el` to the page patches (see the header): their answer, or null when none came. */
export function askPatches(el: Element, op: PatchOp, signal?: AbortSignal): PatchAnswer | null {
  if (signal?.aborted || !el.isConnected) return null;
  const kept: { answer: PatchAnswer | null } = { answer: null };
  let onResult: ((event: Event) => void) | null = null;
  try {
    const view = windowOf(el);
    const id = newId(view);
    onResult = (event: Event) => {
      if (kept.answer !== null || event.target !== el) return;
      kept.answer = parsePatchAnswer((event as CustomEvent<unknown>).detail, id);
    };
    el.addEventListener(PATCH_RESULT, onResult);
    const command = new view.CustomEvent(PATCH_COMMAND, { detail: encodePatchCommand({ v: 1, id, op }), bubbles: false,
      cancelable: true, composed: true });
    const acknowledged = !el.dispatchEvent(command);
    return acknowledged ? kept.answer : null;
  } catch {
    return null;
  } finally {
    if (onResult !== null) el.removeEventListener(PATCH_RESULT, onResult);
  }
}
