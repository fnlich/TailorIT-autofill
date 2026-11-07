/*
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), in the content script:
 * - core-x, item 3: whether this subframe claims the tab's application for its wrapper (claimsApplication): its parent
 *   is the tab's top frame, of its own origin (so its document and its frame element can be read), whose adapter names
 *   this very frame element its application frame (Adapter.applicationFrame: iCIMS's iframe#icims_content_iframe), at
 *   the same application (both addresses read to one key). Such a frame says so in its hello (`claimed`), and the worker
 *   checks it against its registry (background/frames.ts claimFrameOf). Any other subframe claims nothing.
 * - core-x, items 7 and 14, a subframe's chain (background/chain.ts): the security fix of 2026-11-06 (S4) dropped the
 *   token a claimed frame handed its chain child frames through postMessage, and the child's ask of its parent window:
 *   that ask told any page framing an iCIMS forms address that the extension is there. A chain subframe now says only,
 *   in its hello, that it is one, and the worker keys it from its frame registry. Nothing here posts a message to a page
 *   or a window, nor reads or sends a value.
 */
import type { ApplicationRef } from '../adapters';
import { applicationOf } from '../adapters';
import type { Adapter } from '../adapters/types';

/** The wrapper this frame's window sits directly below, when it can be read (its parent is the top frame, of this
 *  frame's own origin): its document, its address and this frame's element in it. Null otherwise. */
export function wrapperOf(view: Window | null): { doc: Document; href: string; frame: Element | null } | null {
  if (view === null) return null;
  try {
    if (view.parent === view || view.parent !== view.top) return null;
    const doc = view.parent.document;
    return { doc, href: view.parent.location.href, frame: view.frameElement };
  } catch {
    return null;
  }
}

/** Whether this subframe claims the tab's application for its wrapper (module header, item 3). */
export function claimsApplication(app: ApplicationRef | null, wrapper: { doc: Document; href: string;
  frame: Element | null } | null, adapters: (url: URL) => Adapter[]): boolean {
  if (app === null || wrapper === null || wrapper.frame === null) return false;
  let url: URL;
  try {
    url = new URL(wrapper.href);
  } catch {
    return false;
  }
  if (applicationOf(url)?.applicationKey !== app.applicationKey) return false;
  return adapters(url).some((adapter) => {
    try {
      return adapter.applicationFrame?.(wrapper.doc) === wrapper.frame;
    } catch {
      return false;
    }
  });
}

/** Whether this top frame is a company's wrapper that draws the application in a frame of its own (its adapter names
 *  one: Adapter.applicationFrame). */
export function wrapsApplication(doc: Document, url: URL | null, adapters: (url: URL) => Adapter[]): boolean {
  if (url === null) return false;
  return adapters(url).some((adapter) => {
    try {
      return (adapter.applicationFrame?.(doc) ?? null) !== null;
    } catch {
      return false;
    }
  });
}
