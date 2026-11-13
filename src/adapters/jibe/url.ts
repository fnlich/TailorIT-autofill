/*
 * Jibe's addresses (iCIMS's candidate front; jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub that reads none, so the
 * static content script stays dormant on its candidate paths (<customer>.jibeapply.com, /jobs/: src/shared/hosts.ts),
 * as on any address its platform's parser does not read (adapters/address.ts). ICIMS-7 writes the reading (the posting
 * /jobs/<id>, whose application is on iCIMS: ICIMS7-11, FIX7PLAN §6.7 item 4) and owns this folder from the tag
 * jr7-engine-e0 on.
 */
import type { ApplicationUrl } from '../application-key';

/** The page of a posting an address shows: none yet (module header). */
export function parseJibeUrl(_url: URL): ApplicationUrl | null {
  return null;
}

/** The canonical application URL of an address: none yet (module header). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJibeUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
