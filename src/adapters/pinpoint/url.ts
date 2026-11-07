/*
 * Pinpoint's addresses (DESIGN-NEW-ATS §1 "Pinpoint"; the owner's snapshots pinpoint-0 to -2, one tenant), read without
 * the DOM:
 * - https://<tenant>.pinpointhq.com/en/postings/<uuid> is a posting, with "Apply Now" and no form (pinpoint-1);
 * - .../en/postings/<uuid>/applications/new is its application form (pinpoint-0);
 * - .../en/postings/<uuid>/applications/thanks?token=<...> is the page after submitting (pinpoint-2), the only
 *   confirmation address any of the new ATSs' snapshots shows;
 * - /en is the only locale seen (src/shared/hosts.ts matches /en/postings/ alone).
 * The canonical application URL is the form's address: https, the tenant's host, /en/postings/<uuid>/applications/new,
 * no query and no fragment; the posting and the confirmation name it too.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A posting's id: a lower-case uuid, as the addresses write it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What follows the uuid, and the page it makes. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['applications/new', 'application'],
  ['applications/thanks', 'confirmation']]);

/** A Pinpoint tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it. */
const HOST_PATTERN = /^(?!app\.)[a-z0-9-]+\.pinpointhq\.com$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/en/postings/';

/** Whether an address is on a Pinpoint tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname) && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows and which page of it, or null. */
export function parsePinpointUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [locale, postings, id, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  if (locale !== 'en' || postings !== 'postings' || id === undefined || !UUID.test(id) || page === undefined) {
    return null;
  }
  const tenant = url.hostname.slice(0, -'.pinpointhq.com'.length);
  return { platform: 'pinpoint', board: tenant, jobId: id, page,
    applicationUrl: `https://${url.hostname}/en/postings/${id}/applications/new` };
}

/** The canonical application URL when the address shows the form; null on the posting, the confirmation and any other
 *  page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parsePinpointUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
