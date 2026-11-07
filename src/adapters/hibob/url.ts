/*
 * HiBob's careers addresses (DESIGN-NEW-ATS §1 "HiBob"; the owner's snapshot hibob-0), read without the DOM:
 * - https://<tenant>.careers.hibob.com/jobs/<uuid>/apply is a posting's "Application" tab, its form (hibob-0);
 * - the "Overview" tab's address, the job list's and the page after submitting are not in the snapshot (its navbar
 *   links are router links with no href), so none is read.
 * The canonical application URL is that address: https, the tenant's host, /jobs/<uuid>/apply, no query and no
 * fragment. TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A posting's id: a lower-case uuid, as the address writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A HiBob tenant's careers host, as src/shared/hosts.ts HOST_PLATFORMS lists it. */
const HOST_PATTERN = /^[a-z0-9-]+\.careers\.hibob\.com$/;

/** Whether an address is on a HiBob tenant's careers candidate host, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname);
}

/** The posting an address shows, or null. */
export function parseHiBobUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [jobs, id, apply, ...rest] = path.split('/').slice(1);
  if (jobs !== 'jobs' || id === undefined || !UUID.test(id) || apply !== 'apply' || rest.length > 0) return null;
  const tenant = url.hostname.slice(0, -'.careers.hibob.com'.length);
  return { platform: 'hibob', board: tenant, jobId: id, page: 'application',
    applicationUrl: `https://${url.hostname}/jobs/${id}/apply` };
}

/** The canonical application URL, or null. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parseHiBobUrl(url)?.applicationUrl ?? null;
}
