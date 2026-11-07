/*
 * ClearCompany's addresses, read without the DOM (DESIGN-NEW-ATS §1 "ClearCompany", the owner's snapshots of
 * 2026-11-06 on three tenants; fixtures/clearcompany):
 * - https://<tenant>.clearcompany.com/careers/jobs/<uuid>/apply is the application's account step, its personal
 *   information form (vafb-account, clearcompany-8);
 * - https://<tenant>.clearcompany.com/careers/jobs/<uuid>/apply/<application uuid>[?source=...] is every numbered page
 *   of the same application after it (vafb-uploads, vafb-page2, vafb-page3, ferrilli-page2, atlas-*): the second uuid
 *   is the application the account step made, the page number is not in the address.
 * Both are one application: its canonical URL is the job's /apply, the query (atlas's ?source), the application's own
 * uuid, a trailing slash and the fragment dropped, so the account step and its pages share one key. No snapshot shows
 * a posting or the page after Submit, so neither is read. The tenant and the uuids are kept as written (every snapshot
 * writes the uuids in lower case). Only /careers/ is the platform's (src/shared/hosts.ts): the tenant host's other
 * pages, its /blank/page frame included, are no platform's.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** A uuid as the snapshots write it. */
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** A tenant's host as src/shared/hosts.ts reads it: never ClearCompany's cc-app-static and cc-client-cdn file hosts. */
const TENANT_HOST = /^(?!cc-)[a-z0-9-]+\.clearcompany\.com$/;
/** The one path src/shared/hosts.ts matches on a tenant's host, compared as written. */
const PATH = '/careers/';

/** Whether an address is on a ClearCompany tenant's /careers/ path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts matches it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && TENANT_HOST.test(url.hostname) && url.pathname.startsWith(PATH);
}

/** The application an address shows, or null for any other page of the path. */
export function parseClearCompanyUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [careers, jobs, id, apply, application, ...rest] = path.split('/').slice(1);
  if (careers !== 'careers' || jobs !== 'jobs' || !id || !UUID.test(id) || apply !== 'apply' || rest.length > 0
    || (application !== undefined && !UUID.test(application))) return null;
  const tenant = url.hostname.split('.')[0]!;
  return { platform: 'clearcompany', board: tenant, jobId: id, page: 'application',
    applicationUrl: `https://${url.hostname}/careers/jobs/${id}/apply` };
}

/** The canonical application URL of the account step and of every numbered page; null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parseClearCompanyUrl(url)?.applicationUrl ?? null;
}
