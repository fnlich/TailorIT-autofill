/*
 * JazzHR's addresses (DESIGN-NEW-ATS §1 "JazzHR"; the owner's snapshots jazzhr-0 to -4, four tenants), read without the
 * DOM:
 * - https://<tenant>.applytojob.com/apply/<code>/<slug> is a posting and its application form on one page (all five:
 *   the form posts to its own address); <code> is 10 letters and digits as written, <slug> the posting's title words;
 * - https://<tenant>.applytojob.com/apply/ is the tenant's board ("View All Jobs"): no posting;
 * - no page after submitting is in the snapshots; v5 p2-detect (Jobright 1.25.2's record of JazzHR's page after
 *   submitting, its ats-submission-rules 'jazzhr-application-received', read as its behaviour): /apply/confirm/<code>,
 *   with no `c` in its query, is it: the confirmation of posting <code>. It names no slug, so its own key is not the
 *   form's; the worker takes it for the tab's Submit armed on the same tenant's posting <code> in the same frame
 *   (adapters/address.ts confirmsApplication, as Jobright matches the page to the application it was sent from).
 * The canonical application URL is the address the page itself names canonical (its link rel=canonical and og:url, on
 * the tenant's own host in jazzhr-2 to -4): https, the tenant's host, /apply/<code>/<slug> as written, with no query
 * (Jobright's jr_id came on four of the five) and no fragment.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A posting's code: 10 letters and digits (bopFMbElHx, Harslv6cNi, 1gBcKSF4Ek, igXTN9iwdO). */
const CODE = /^[A-Za-z0-9]{10}$/;

/** A JazzHR tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it. */
const HOST_PATTERN = /^(?!www\.)[a-z0-9-]+\.applytojob\.com$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/apply/';

/** Whether an address is on a JazzHR tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname) && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows, or null (the board, any other page). */
export function parseJazzhrUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [apply, code, slug, ...rest] = path.split('/').slice(1);
  const tenant = url.hostname.slice(0, -'.applytojob.com'.length);
  // v5 p2-detect: the page after submitting (module header), keyed by the posting it names.
  if (apply === 'apply' && code === 'confirm' && slug !== undefined && CODE.test(slug) && rest.length === 0
    && !url.searchParams.has('c')) {
    return { platform: 'jazzhr', board: tenant, jobId: slug, page: 'confirmation',
      applicationUrl: `https://${url.hostname}/apply/${slug}` };
  }
  if (apply !== 'apply' || code === undefined || !CODE.test(code) || slug === undefined || slug === ''
    || rest.length > 0) return null;
  return { platform: 'jazzhr', board: tenant, jobId: code, page: 'application',
    applicationUrl: `https://${url.hostname}/apply/${code}/${slug}` };
}

/** The canonical application URL (every posting page is its form), or null (v5 p2-detect: also on the page after
 *  submitting). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJazzhrUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
