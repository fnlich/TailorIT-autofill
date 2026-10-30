/*
 * Lever's addresses, read without the DOM: whether an address is Lever's, which posting and which of its pages it
 * shows, and the canonical application URL the application key is hashed from. From the owner's samples (the captures
 * listed in docs/FIXTURES.md):
 * - jobs.lever.co/<site>/<posting UUID>/apply is the application form;
 * - jobs.lever.co/<site>/<posting UUID> is the posting page, which has no form (the policy check reads it);
 * - /thanks, after /apply or alone, is the page after submitting.
 * jobs.eu.lever.co is the same service in the EU (src/shared/hosts.ts lists both). A posting's UUID is unique across
 * sites, so the canonical URL folds the site's case, and a query string, a fragment or one trailing slash never
 * matters. The posting page and its form share one application URL. The contract's parseAtsUrl (TailorIT's reading of
 * the same addresses) is never called here: src/adapters/url.test.ts runs both over one table so they agree.
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** Lever's hosts, as src/shared/hosts.ts lists them. */
const HOSTS: ReadonlySet<string> = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);
const SITE = /^[A-Za-z0-9_.-]+$/;
const POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What follows the posting id, and the page it makes. Compared as written: Lever's paths are lower case. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([
  ['', 'posting'],
  ['apply', 'application'],
  ['thanks', 'confirmation'],
  ['apply/thanks', 'confirmation'],
]);

/** Whether an address is on a Lever host, over https on the default port and without credentials: every page there is
 *  the Lever adapter's, a posting or not. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
    HOSTS.has(url.hostname);
}

/** The posting an address shows and which page of it, or null when it shows no posting (a site's list of jobs). */
export function parseLeverUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [site, posting, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  if (!site || !posting || page === undefined || !SITE.test(site) || !POSTING_ID.test(posting)) return null;
  const jobId = posting.toLowerCase();
  return { platform: 'lever', board: site, jobId, page,
    applicationUrl: `https://${url.hostname}/${site.toLowerCase()}/${jobId}/apply` };
}

/** The canonical application URL when the address shows the application form; null on the posting page, the page
 *  after submitting, and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseLeverUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
