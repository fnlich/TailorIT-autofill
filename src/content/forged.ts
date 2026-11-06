/*
 * Forged WXT events (trap 11; docs/ARCHITECTURE.md "Isolation"). WXT's content-script context named two DOM events
 * after the extension's id and the entrypoint, and a page can dispatch either one. Since the v3 Phase 6/7b review's
 * round 2 (E1) the content script is an unlisted script with no such context at all (src/entrypoints/content-script.ts:
 * the context's own start-up event announced the extension to the page), so nothing of ours dispatches or answers
 * either event; they are only listened for, so a page's forgery is logged, and only where the page-world bridge
 * installs, decided once from the address the document was loaded at (runtime.ts loadedHref; round 3, X1, and round 4,
 * Y1): a listener that runs, or one a route of the page's own adds, is one a page can time.
 * - `<id>:content:wxt:content-script-started` on the document: WXT's context invalidates itself when it hears another
 *   instance of the script start. The runtime never uses that context, so a forgery stops nothing. The real event of
 *   a newer instance comes only after the extension was reloaded, and then the platform says the extension is gone;
 *   so the runtime asks the platform (isValid), and a forgery is only logged.
 * - `<id>:content:wxt:locationchange` on the window: WXT dispatches it only for a context that asked to watch the
 *   address, and this one never asks (location.ts reads location.href itself), so any such event is a forgery.
 * A forgery is logged under its own code (content.forged-wxt-event), never as a tripwire hit, and changes nothing.
 */

/** The entrypoint name WXT built the event names with (the content script's old WXT entry, content.ts). */
export const WXT_ENTRYPOINT = 'content';

/** Which WXT event arrived. */
export type WxtEventKind = 'started' | 'location-change';

/** The two event names for an extension id. */
export function wxtEventNames(extensionId: string): Record<WxtEventKind, string> {
  return {
    started: `${extensionId}:${WXT_ENTRYPOINT}:wxt:content-script-started`,
    'location-change': `${extensionId}:${WXT_ENTRYPOINT}:wxt:locationchange`,
  };
}

/** Listens for either WXT event until `signal` aborts. Nothing is read from the event: only that it came. */
export function watchWxtEvents(doc: Document, extensionId: string | undefined, onEvent: (kind: WxtEventKind) => void,
  signal: AbortSignal): void {
  if (extensionId === undefined || extensionId === '') return;
  const names = wxtEventNames(extensionId);
  doc.addEventListener(names.started, () => onEvent('started'), { signal });
  doc.defaultView?.addEventListener(names['location-change'], () => onEvent('location-change'), { signal });
}
