/*
 * CareerPlug's addresses (DESIGN-NEW-ATS §1 "CareerPlug"; the owner's snapshots careerplug-0 and -1, two tenants), read
 * without the DOM:
 * - https://<tenant>.careerplug.com/jobs/<id>/apps/new is a posting and its application form on one page (both), <id>
 *   its number; ?loc=es is the same page in Spanish ("Español");
 * - the posting's page alone (/jobs/<id>), the job list (/jobs) and the page after submitting are not in the
 *   snapshots, so none is read.
 * The canonical application URL is that address: https, the tenant's host, /jobs/<id>/apps/new, no query and no
 * fragment, so the Spanish page shares its key.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A posting's number (3677935, 3481777). */
const ID = /^\d+$/;

/** A CareerPlug tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it: never app.careerplug.com, CareerPlug's
 *  employers' host (the security fix of 2026-11-06, S5). */
const HOST_PATTERN = /^(?!app\.)[a-z0-9-]+\.careerplug\.com$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/jobs/';

/** Whether an address is on a CareerPlug tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST_PATTERN.test(url.hostname) && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows, or null. */
export function parseCareerPlugUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [jobs, id, apps, isNew, ...rest] = path.split('/').slice(1);
  if (jobs !== 'jobs' || id === undefined || !ID.test(id) || apps !== 'apps' || isNew !== 'new' || rest.length > 0) {
    return null;
  }
  const tenant = url.hostname.slice(0, -'.careerplug.com'.length);
  return { platform: 'careerplug', board: tenant, jobId: id, page: 'application',
    applicationUrl: `https://${url.hostname}/jobs/${id}/apps/new` };
}

/** The canonical application URL, or null. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parseCareerPlugUrl(url)?.applicationUrl ?? null;
}
