/*
 * Forged WXT events (trap 11; docs/ARCHITECTURE.md "Isolation"). WXT's content-script context is the one thing a page
 * can reach: it names two DOM events after the extension's id and the entrypoint, and a page can dispatch either one.
 * - `<id>:content:wxt:content-script-started` on the document: WXT's context invalidates itself when it hears another
 *   instance of the script start. The runtime never uses that context, so a forgery stops nothing. The real event of
 *   a newer instance comes only after the extension was reloaded, and then the platform says the extension is gone;
 *   so the runtime asks the platform (isValid), and a forgery is only logged.
 * - `<id>:content:wxt:locationchange` on the window: WXT dispatches it only for a context that asked to watch the
 *   address, and this one never asks (location.ts reads location.href itself), so any such event is a forgery.
 * A forgery is logged under its own code (content.forged-wxt-event), never as a tripwire hit, and changes nothing.
 */

/** The content script's entrypoint name, as WXT builds the event names (src/entrypoints/content.ts). */
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
