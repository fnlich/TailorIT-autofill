/*
 * Jibe's addresses (iCIMS's candidate front; jr7 ICIMS-7, ICIMS7-11, FIX7PLAN §5 D-6 and §6.7 item 4), read without the
 * DOM, from the owner's snapshot7 of 2026-11-11 (F:\Develop\Refer\snapshot7\icims2: oneblood.jibeapply.com, converted as
 * fixtures/jibe/jr7-icims2-jibe-posting.html, and the iCIMS gate its Apply leads to, fixtures/icims/jr7-icims2-login):
 * - a customer's Jibe site is <customer>.jibeapply.com (an Angular job search and posting site that also serves the
 *   customer's own pages: src/shared/hosts.ts takes only /jobs/ as Jibe's); a posting is /jobs/<id> (?lang=en-us on its
 *   canonical link), <id> the iCIMS job's own number. Its Apply, a#link-apply, is a plain same-tab link to that job's
 *   email gate on the customer's iCIMS portal, https://<portal>.icims.com/jobs/<id>/login, whose host the Jibe address
 *   does not name (oneblood.jibeapply.com → arc-onesolutions.icims.com). The application is never on Jibe;
 * - so a Jibe posting is read as a posting alone (page 'posting'), keyed by its own host and id, with no application
 *   form of its own (canonicalApplicationUrl null); every other address of the host (its home, its search, the
 *   customer's pages) is none;
 * - the job reaches TailorIT as its iCIMS posting (D-6, owner question Q7-13 by default): icimsPostingOf builds
 *   https://<portal>.icims.com/jobs/<id>/job from the parts of the Apply link a Jibe posting shows, only where that link
 *   is the same job's iCIMS gate; checkedIcimsPosting is the worker's re-check of what a page gives (FIX7PLAN §6.4
 *   item 20). Jobright reads such a page the same way (its ~core/icims-branded readIcimsBrandedJob: an https /jobs/<id>
 *   page whose job names iCIMS, its slug the path's id, its apply address https://<x>.icims.com/jobs/<id>/login with no
 *   credentials, port or hash; cited as its behaviour).
 * Nothing here reads a person's value: the addresses are the postings' public ones.
 */
import type { ApplicationUrl } from '../application-key';
import { parseIcimsUrl } from '../icims/url';

/** A customer's Jibe site (src/shared/hosts.ts names the same hosts, with /jobs/ as their candidate path). */
const HOST = /^[a-z0-9-]+\.jibeapply\.com$/;
/** An iCIMS job's number, as iCIMS's own addresses write it (icims/url.ts). */
const POSTING_ID = /^\d{1,12}$/;

/** Whether an address is on a Jibe site, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The posting a Jibe address shows (/jobs/<id>, one trailing slash and any query aside): page 'posting', its
 *  application address the posting's own https://<host>/jobs/<id>; null for any other address (module header). */
export function parseJibeUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.split('/').slice(1);
  if (parts.length !== 2 || parts[0] !== 'jobs' || !POSTING_ID.test(parts[1]!)) return null;
  const jobId = parts[1]!;
  const board = url.hostname.slice(0, -'.jibeapply.com'.length);
  return { platform: 'jibe', board, jobId, page: 'posting', applicationUrl: `https://${url.hostname}/jobs/${jobId}` };
}

/** The canonical application URL of an address: none, a Jibe site holding no application form (module header). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJibeUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}

/** The iCIMS posting a Jibe posting's Apply leads to (module header): `apply` must be the same job's iCIMS email gate,
 *  https://<company>.icims.com/jobs/<the Jibe page's id>/login exactly (icims/url.ts parseIcimsUrl: https, the default
 *  port, no credentials, a company's portal, never "Log back in"), with no fragment; its query is never read. Answers
 *  https://<company>.icims.com/jobs/<id>/job, built from those parts; null where `here` is no Jibe posting or `apply`
 *  no such gate. */
export function icimsPostingOf(here: URL, apply: URL): string | null {
  const jibe = parseJibeUrl(here);
  if (jibe === null || apply.hash !== '' || apply.pathname !== `/jobs/${jibe.jobId}/login`) return null;
  // Its path names the same job's gate, so iCIMS's reading (an application, never "Log back in") is that job's.
  return parseIcimsUrl(apply)?.applicationUrl ?? null;
}

/** The worker's re-check of an address a Jibe page gives TailorIT instead of its own (FIX7PLAN §6.4 item 20,
 *  Adapter.tailoritAddress; the worker parses the address it was given): `address` must read as an iCIMS posting or its
 *  application (icims/url.ts) of the Jibe posting `here`'s job id, over https with no credentials, and is answered as
 *  the posting's canonical address, built from its parts (https://<company>.icims.com/jobs/<id>/job); null for anything
 *  else, so the page's own address goes. */
export function checkedIcimsPosting(here: URL, address: URL): string | null {
  const jibe = parseJibeUrl(here);
  if (jibe === null) return null;
  const icims = parseIcimsUrl(address);
  return icims !== null && (icims.page === 'posting' || icims.page === 'application') && icims.jobId === jibe.jobId
    ? icims.applicationUrl : null;
}
