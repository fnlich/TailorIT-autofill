/*
 * Oracle Recruiting Cloud's addresses (its Candidate Experience), read without the DOM: whether an address is Oracle's,
 * which posting and which of its pages it shows, and the canonical application URL the application key is hashed from.
 * From the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; two tenants, one with no region in its host):
 * - a tenant's host is <tenant>.fa.<region>.oraclecloud.com, or <tenant>.fa.oraclecloud.com (JPMC);
 * - the posting is /hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id>, a single-page application that writes the
 *   language and the site as it reads them (fr became en, cx_1001 became CX_1001) and drops a trailing slash;
 *   /requisitions/preview/<id> is rewritten to /job/<id>;
 * - APPLY NOW changes the address in place to .../job/<id>/apply/email, the email gate; what follows the emailed code
 *   (.../apply/section/<n>, Jobright's reading) is not public: every address under .../job/<id>/apply is read as the
 *   posting's application, and so is .../job/<id>/easy-apply, the quick apply's (the v3 Phase 6/7b review, C11);
 * - .../sites/<site>/my-profile/sign-in ("Manage Your Profile") names no job: no application.
 * The key is the host, the site in upper case (as the application writes it) and the posting's id, the language
 * dropped. The canonical application URL is https://<host>/hcmUI/CandidateExperience/en/sites/<SITE>/job/<id>. The content
 * script runs on these candidate pages alone (src/shared/hosts.ts). TailorIT's parseAtsUrl reads the same posting since
 * its API 5 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A Fusion Applications tenant: <tenant>.fa.<region>.oraclecloud.com or <tenant>.fa.oraclecloud.com. */
const HOST = /^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/;
const ROOT = '/hcmUI/CandidateExperience/';
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const SITE = /^[A-Za-z0-9_-]{1,40}$/;
const POSTING_ID = /^\d{1,15}$/;

/** Whether an address is a candidate page of an Oracle Recruiting Cloud tenant, over https on the default port and
 *  without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname) && url.pathname.startsWith(ROOT);
}

/** The pages after a posting's id that are its application: the apply flow, and the quick apply's. */
const APPLY_TAILS: ReadonlySet<string> = new Set(['apply', 'easy-apply']);

/** The posting's id and what follows it in an address of a tenant's site, or null. */
function postingPath(url: URL): { site: string; id: string; tail: string[] } | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [language, sites, site, ...rest] = path.slice(ROOT.length).split('/');
  if (language === undefined || !LANGUAGE.test(language) || sites !== 'sites' || site === undefined
    || !SITE.test(site)) return null;
  let at = 0;
  if (rest[0] === 'job') at = 1;
  else if (rest[0] === 'requisitions' && rest[1] === 'preview') at = 2;
  else return null;
  const id = rest[at];
  return id === undefined || !POSTING_ID.test(id) ? null : { site, id, tail: rest.slice(at + 1) };
}

/** Whether an address is a posting's email gate, .../job/<id>/apply/email (the v3 Phase 6/7b review, S2: the adapter
 *  reads the gate by its address, then by the markup only the gate has). */
export function isOracleEmailGate(url: URL): boolean {
  const read = postingPath(url);
  return read !== null && read.tail.length === 2 && read.tail[0] === 'apply' && read.tail[1] === 'email';
}

/** The posting an address shows and which page of it, or null when it shows none (the site's search, the profile). */
export function parseOracleUrl(url: URL): ApplicationUrl | null {
  const read = postingPath(url);
  if (read === null || (read.tail.length > 0 && !APPLY_TAILS.has(read.tail[0]!))) return null;
  const board = read.site.toUpperCase();
  return { platform: 'oracle', board, jobId: read.id, page: read.tail.length === 0 ? 'posting' : 'application',
    applicationUrl: `https://${url.hostname}${ROOT}en/sites/${board}/job/${read.id}` };
}

/** The canonical application URL when the address shows the application (the email gate, the steps after it); null
 *  on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseOracleUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
