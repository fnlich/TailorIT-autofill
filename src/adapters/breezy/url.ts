/*
 * Breezy HR's addresses (DESIGN-NEW-ATS §1 "Breezy"; the owner's snapshots breezy-0 and -1, one tenant), read without
 * the DOM:
 * - https://<tenant>.breezy.hr/p/<id>-<slug>/apply is a posting's application form (both), <id> 12 hex characters;
 * - https://<tenant>.breezy.hr/p/<id>-<slug> is the posting (the form's breadcrumb links it; its page is not in the
 *   snapshots, so it is read as the posting only by its address);
 * - https://<tenant>.breezy.hr/ is the tenant's job list ("Job Openings"), off the matched path;
 * - the confirmation is drawn on the form's own page (div.confirmation-container): no address after submitting.
 * The canonical application URL is the form's address: https, the tenant's host, /p/<id>-<slug>/apply as written, no
 * query and no fragment. TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A posting's segment: its 12 hex characters, then its slug (4362758f2795-<slug>). */
const POSITION = /^([0-9a-f]{12})-[^/]+$/;
/** What follows the posting's segment, and the page it makes. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['apply', 'application']]);

/** A Breezy tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it. */
const HOST_PATTERN = /^[a-z0-9-]+\.breezy\.hr$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/p/';

/** Whether an address is on a Breezy tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname) && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows and which page of it, or null. */
export function parseBreezyUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [p, position, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  const match = position === undefined ? null : POSITION.exec(position);
  if (p !== 'p' || match === null || page === undefined) return null;
  const tenant = url.hostname.slice(0, -'.breezy.hr'.length);
  return { platform: 'breezy', board: tenant, jobId: match[1]!, page,
    applicationUrl: `https://${url.hostname}/p/${position!}/apply` };
}

/** The canonical application URL when the address shows the form; null on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseBreezyUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
