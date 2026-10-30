/*
 * The extension's own in-page UI (the launcher, highlights, notices and the in-page panel live in one host element with
 * a closed shadow root). The DOM layer never scans, reads or writes inside it. The host is registered here from the
 * isolated world, so a page cannot forge the mark: an attribute could be copied onto a page element, a module-private
 * WeakSet cannot be reached from the page.
 */
import { flatParent } from './scan-cache';

const hosts = new WeakSet<Element>();

/** Registers the content script's UI host; called once when the host is created. */
export function registerOwnUiHost(host: Element): void {
  hosts.add(host);
}

/** True when `node` is the extension's UI host or sits inside it (shadow roots crossed through their hosts). */
export function isInOwnUi(node: Node): boolean {
  for (let at: Node | null = node; at !== null; at = flatParent(at)) {
    if (at.nodeType === 1 && hosts.has(at as Element)) return true;
  }
  return false;
}
