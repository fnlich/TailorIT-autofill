/*
 * CareerPlug's addresses (DESIGN-NEW-ATS §1 "CareerPlug"; the owner's snapshots careerplug-0 and -1, two tenants), read
 * without the DOM:
 * - https://<tenant>.careerplug.com/jobs/<id>/apps/new is a posting and its application form on one page (both), <id>
 *   its number; ?loc=es is the same page in Spanish ("Español");
 * - the posting's page alone (/jobs/<id>), the job list (/jobs) and the page after submitting are not in the
 *   snapshots, so none is read.
 * The canonical application URL is that address: https, the tenant's host, /jobs/<id>/apps/new, no query and no
 * fragment, so the Spanish page shares its key.
 * v5 p2-detect (the engine audit's gap 1a; Jobright's site list and its record of CareerPlug's page after submitting,
 * read as its behaviour, never its code):
 * - CareerPlug's partner domains, sfagentjobs.com, sfagentcareers.com and apscareerportal.com (each host under them,
 *   src/shared/hosts.ts CAREERPLUG_PARTNER_HOST), are read as CareerPlug's own hosts, under /jobs/; their board is the
 *   host's first label after any www. (the domain's own name on the bare domain);
 * - /jobs/<id>/apps/<n>, the application <n> the form's Submit made, is its page after submitting: the confirmation,
 *   under the form's key.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A posting's number (3677935, 3481777). */
const ID = /^\d+$/;

/** A CareerPlug tenant's host, as src/shared/hosts.ts HOST_PLATFORMS lists it: never app.careerplug.com, CareerPlug's
 *  employers' host (the security fix of 2026-11-06, S5). */
const HOST_PATTERN = /^(?!app\.)[a-z0-9-]+\.careerplug\.com$/;
/** v5 p2-detect: CareerPlug's partner domains, as src/shared/hosts.ts CAREERPLUG_PARTNER_HOST lists them. */
const PARTNER_HOST = /^(?:[a-z0-9-]+\.)*(?:sfagentjobs|sfagentcareers|apscareerportal)\.com$/;
/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/jobs/';

/** Whether an address is on a CareerPlug tenant's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && (HOST_PATTERN.test(url.hostname) || PARTNER_HOST.test(url.hostname))
    && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The board an address's host names: a CareerPlug tenant's own label, or (v5 p2-detect) a partner host's first label. */
function boardOf(host: string): string {
  if (HOST_PATTERN.test(host)) return host.slice(0, -'.careerplug.com'.length);
  return host.replace(/^www\./, '').split('.')[0]!;
}

/** The posting an address shows, or null. */
export function parseCareerPlugUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [jobs, id, apps, tail, ...rest] = path.split('/').slice(1);
  // v5 p2-detect: apps/<n>, the application the Submit made (module header), is the page after submitting.
  const page: ApplicationPage | null = tail === 'new' ? 'application' : tail !== undefined && ID.test(tail)
    ? 'confirmation' : null;
  if (jobs !== 'jobs' || id === undefined || !ID.test(id) || apps !== 'apps' || page === null || rest.length > 0) {
    return null;
  }
  return { platform: 'careerplug', board: boardOf(url.hostname), jobId: id, page,
    applicationUrl: `https://${url.hostname}/jobs/${id}/apps/new` };
}

/** The canonical application URL, or null. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseCareerPlugUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
