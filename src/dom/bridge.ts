/*
 * The isolated world's side of the page-world bridge (docs/SPEC-AMENDMENTS.md §12; docs/ARCHITECTURE.md "Isolation";
 * the protocol is bridge-protocol.ts's, the bridge page/bridge.ts). One command is sent as a CustomEvent on the element
 * it is about, built with that element's window, composed so it reaches the bridge's listener on the document from
 * inside an open shadow root, and its answer is taken on the same element, inside the dispatch:
 * - the bridge acknowledges a command and answers it inside the dispatch, synchronously, so its answer is there when
 *   dispatchEvent returns;
 * - a command nothing acknowledged (no bridge in this frame, or a page that stopped the event before it) is null;
 * - so is one acknowledged but not answered by then: something on the page took it, and it is never waited for (a
 *   page cannot hold a run with commands it swallows).
 * Nothing here can end a run: a throw (a page's own event constructor, a document gone) is null too, and the caller
 * falls back to its events. The id is random (crypto.getRandomValues, which every context has; randomUUID needs a
 * secure one, which an https form embedded in an http page is not).
 * The first answer with the command's id that the protocol accepts is kept. It is a claim of the page's world, which
 * any page script can forge, so it is never trusted: the caller reads the widget back itself. Only the request (its op,
 * an option's label as the frame read it, whether a multi-select's) and the id are sent; nothing is logged.
 */
import {
  BRIDGE_COMMAND, BRIDGE_RESULT, encodeCommand, parseAnswer, type BridgeAnswer, type BridgeRequest,
} from './bridge-protocol';
import { windowOf } from './fillers/events';

/** A random command id: 16 bytes as 32 hex digits. */
function newId(view: Window & typeof globalThis): string {
  return Array.from(view.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Sends one command about `el` to the page-world bridge (see the header): its answer, or null when none came. */
export function askBridge(el: Element, request: BridgeRequest, signal?: AbortSignal): BridgeAnswer | null {
  if (signal?.aborted || !el.isConnected) return null;
  const kept: { answer: BridgeAnswer | null } = { answer: null };
  let onResult: ((event: Event) => void) | null = null;
  try {
    const view = windowOf(el);
    const id = newId(view);
    onResult = (event: Event) => {
      if (kept.answer !== null || event.target !== el) return;
      kept.answer = parseAnswer((event as CustomEvent<unknown>).detail, id);
    };
    el.addEventListener(BRIDGE_RESULT, onResult);
    const detail = encodeCommand({ v: 1, id, ...request });
    const command = new view.CustomEvent(BRIDGE_COMMAND, { detail, bubbles: false, cancelable: true, composed: true });
    const acknowledged = !el.dispatchEvent(command);
    return acknowledged ? kept.answer : null;
  } catch {
    return null;
  } finally {
    if (onResult !== null) el.removeEventListener(BRIDGE_RESULT, onResult);
  }
}
