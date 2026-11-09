/*
 * v5 p2-fill (PLAN decision 14): the page patches, asked for once per document as the first run that writes begins
 * (runtime.ts startRun: page/patches, which the worker answers by running their bundle in this document's page world:
 * background/page-patches.ts). A write (pass.ts) waits for that answer, PAGE_PATCHES_WAIT_MS at most, before it holds
 * the page's dialogs or arms its picker; whatever the answer, the write goes on (without the patches nothing is held and
 * no picker control is pressed: dom/fillers/dialogs.ts, picker.ts). Nothing is kept but the one request per document.
 */
import { deadline } from '../dom/time';

/** How long a write waits for the patches' load at most (the worker's executeScript is a few tens of milliseconds). */
export const PAGE_PATCHES_WAIT_MS = 1_500;

/** Each document's one request, settled either way. */
const loads = new WeakMap<Document, Promise<void>>();

/** Asks for the patches in `doc` once (`ask`: the page/patches request); later calls answer the first request. */
export function loadPagePatches(doc: Document, ask: () => Promise<unknown>): Promise<void> {
  let held = loads.get(doc);
  if (held === undefined) {
    held = Promise.resolve().then(ask).then(() => undefined, () => undefined);
    loads.set(doc, held);
  }
  return held;
}

/** Waits for `doc`'s request to settle, PAGE_PATCHES_WAIT_MS at most; at once where none was made. */
export async function pagePatchesSettled(doc: Document, signal?: AbortSignal): Promise<void> {
  const held = loads.get(doc);
  if (held === undefined) return;
  await Promise.race([held, deadline(PAGE_PATCHES_WAIT_MS, signal)]);
}
