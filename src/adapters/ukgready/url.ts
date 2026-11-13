/*
 * UKG Ready's addresses (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub that reads none, so the static content script
 * stays dormant on its candidate paths (secure<n>.saashr.com, /ta/<company>.careers: src/shared/hosts.ts), as on any
 * address its platform's parser does not read (adapters/address.ts). UKGREADY-7 writes the reading (the posting
 * /ta/<company>.careers?ShowJob=<digits> and the application session: UKGR-3, FIX7PLAN §6.14 item 2) and owns this
 * folder from the tag jr7-engine-e0 on.
 */
import type { ApplicationUrl } from '../application-key';

/** The page of a posting an address shows: none yet (module header). */
export function parseUkgReadyUrl(_url: URL): ApplicationUrl | null {
  return null;
}

/** The canonical application URL of an address: none yet (module header). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseUkgReadyUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
