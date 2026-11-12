/*
 * Eightfold's addresses (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub that reads none, so the static content script
 * stays dormant on its candidate paths (<company>.eightfold.ai, /careers: src/shared/hosts.ts), as on any address its
 * platform's parser does not read (adapters/address.ts). JDEF-7 writes the reading (the posting, the form
 * /careers/apply?pid=<pid> and the success page, keyed alike: EFA-2, FIX7PLAN §6.15, Eightfold item 1) and owns this
 * folder from the tag jr7-engine-e0 on.
 */
import type { ApplicationUrl } from '../application-key';

/** The page of a posting an address shows: none yet (module header). */
export function parseEightfoldUrl(_url: URL): ApplicationUrl | null {
  return null;
}

/** The canonical application URL of an address: none yet (module header). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseEightfoldUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
