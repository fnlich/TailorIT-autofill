/*
 * The auto-apply agent's entry controls (v3 Phase 5; Adapter.entryControl): on a posting page that shows no form, the
 * one control that opens the posting's application. Lever's and Ashby's are links, found here by the address they open
 * (the platform's own url.ts reads it as this posting's application form), never by a class name: no snapshot shows
 * Lever's posting page, and Ashby's capture shows its Application tab as such a link. Only the
 * entry door of dom/fillers/not-submit.ts presses one, for the agent alone.
 */
import { newScanCache } from '../dom/scan-cache';
import { isUserVisible } from '../dom/visibility';
import type { ApplicationUrl } from './application-key';

/** The first link a person can see, outside any form, matching `selector`, whose address `parse` reads as the
 *  application form of the posting the document's own address shows; null when the document is no posting page of
 *  that platform, or shows no such link. */
export function applicationLinkOf(doc: Document, parse: (url: URL) => ApplicationUrl | null, selector = 'a[href]'):
  HTMLElement | null {
  let here: ApplicationUrl | null = null;
  try {
    here = parse(new URL(doc.location.href));
  } catch {
    return null;
  }
  if (here === null || here.page !== 'posting') return null;
  const cache = newScanCache();
  for (const link of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
    if (link.localName !== 'a' || link.closest('form') !== null) continue;
    let target: ApplicationUrl | null = null;
    try {
      target = parse(new URL(link.getAttribute('href') ?? '', doc.baseURI));
    } catch {
      continue;
    }
    if (target?.page === 'application' && target.applicationUrl === here.applicationUrl && isUserVisible(link, cache)) {
      return link;
    }
  }
  return null;
}
