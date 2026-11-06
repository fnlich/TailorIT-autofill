/*
 * iCIMS's addresses, read without the DOM: whether an address is iCIMS's, which posting and which of its pages it shows,
 * and the canonical application URL the application key is hashed from. From the public capture of 2026-11-04/05
 * (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture"; three portals):
 * - a company's portal is careers-<co>.icims.com (or <co>.icims.com); the posting is /jobs/<id>/<slug>/job, the slug
 *   free (/jobs/<id>/x/job and /jobs/<id>/job load the same posting). The top page is the company's wrapper and reloads
 *   itself with layout parameters (?mobile=false&width=...&needsRedirect=false&jan1offset=...); the posting itself is
 *   the same address with ?in_iframe=1, in the wrapper's iframe#icims_content_iframe on the same host;
 * - the posting's "Apply for this job online" (/job?mode=apply&apply=yes&in_iframe=1&hashed=<n>) moves the top to
 *   /jobs/<id>/<slug>/login and its frame to .../login?in_iframe=1: the email gate ("Enter Your Information"), whose
 *   Next posts .../login?step=email; "Log back in" (.../login?loginOnly=1...) sends the top to login.icims.com, iCIMS's
 *   own Auth0 sign-in, which names the company but no job: no host of a portal, no application;
 * - what follows the gate (the candidate's profile, its questions) is not public, so only the words the capture shows
 *   are read (the v3 Phase 6/7b review, C11): /job the posting, /login the gate (never "Log back in",
 *   .../login?loginOnly=1, which sends to login.icims.com); every other page under /jobs/<id>/ (the posting's "Email
 *   this job to a friend", .../referral, and the pages after the gate) is no application until the owner's snapshots
 *   name its word (APPLICATION_WORDS).
 * The key is the host and the posting's id: the slug and the query (in_iframe, hashed, the wrapper's layout) are
 * dropped, so the wrapper, its frame, the gate and the pages after it share one. The canonical application URL is
 * https://<host>/jobs/<id>/job. TailorIT's parseAtsUrl does not read iCIMS yet (PLATFORMS_AHEAD_OF_CONTRACT).
 */
import type { ApplicationUrl } from '../application-key';

/** A company's portal: careers-<co>.icims.com or <co>.icims.com, never iCIMS's own www, api or login hosts, nor an
 *  employees' internal-<co> portal (src/shared/hosts.ts). */
const HOST = /^(?!(?:www|api|login)\.)(?!internal-)[a-z0-9-]+\.icims\.com$/;
const POSTING_ID = /^\d{1,12}$/;
/** The words under /jobs/<id>/[<slug>/] read as the posting's application (module header): the gate alone, so far. */
const APPLICATION_WORDS: ReadonlySet<string> = new Set(['login']);

/** Whether an address is on an iCIMS portal, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The posting an address shows and which page of it, or null when it shows none (a search, the portal's home). */
export function parseIcimsUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.split('/').slice(1);
  if (parts.length < 3 || parts.length > 4 || parts[0] !== 'jobs' || !POSTING_ID.test(parts[1]!)) return null;
  const name = parts.at(-1)!;
  if (name !== 'job' && !APPLICATION_WORDS.has(name)) return null;
  // "Log back in" (.../login?loginOnly=1): iCIMS's own sign-in, which names no job.
  if (name === 'login' && url.searchParams.get('loginOnly') === '1') return null;
  const jobId = parts[1]!;
  const board = url.hostname.slice(0, -'.icims.com'.length);
  return { platform: 'icims', board, jobId, page: name === 'job' ? 'posting' : 'application',
    applicationUrl: `https://${url.hostname}/jobs/${jobId}/job` };
}

/** The canonical application URL when the address shows the application (the gate, the pages after it); null on the
 *  posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseIcimsUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
