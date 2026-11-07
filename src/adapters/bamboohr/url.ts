/*
 * BambooHR's candidate addresses (DESIGN-NEW-ATS §1 "BambooHR"; the owner's snapshots bamboohr-0 to -2), read without
 * the DOM:
 * - https://<tenant>.bamboohr.com/careers/<id> is a posting's application form (all three; its og:url and twitter:url
 *   write it with no query), <id> its number; the posting's description is behind a button on the same page;
 * - https://<tenant>.bamboohr.com/careers is the tenant's job list ("Job Openings"): no posting;
 * - no page after submitting is seen, so none is read. Every other path of the host is BambooHR's employee system,
 *   which src/shared/hosts.ts never matches (paths /careers/ only) and HR_HOST_MATCHES keeps the sentinel off.
 * The canonical application URL is that address: https, the tenant's host, /careers/<id>, no query (Jobright's jr_id
 * came on all three) and no fragment. TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A posting's number (1122). */
const ID = /^\d+$/;

/** A BambooHR tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it. */
const HOST_PATTERN = /^[a-z0-9-]+\.bamboohr\.com$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/careers/';

/** Whether an address is on a BambooHR tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname) && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows, or null (the job list, the employee system, any other page). */
export function parseBambooHrUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [careers, id, ...rest] = path.split('/').slice(1);
  if (careers !== 'careers' || id === undefined || !ID.test(id) || rest.length > 0) return null;
  const tenant = url.hostname.slice(0, -'.bamboohr.com'.length);
  return { platform: 'bamboohr', board: tenant, jobId: id, page: 'application',
    applicationUrl: `https://${url.hostname}/careers/${id}` };
}

/** The canonical application URL, or null. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parseBambooHrUrl(url)?.applicationUrl ?? null;
}
