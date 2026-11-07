/*
 * Jobvite's addresses, read without the DOM (DESIGN-NEW-ATS §1 "Jobvite", the owner's snapshots of 2026-11-06, one
 * company's career site on jobs.jobvite.com; fixtures/jobvite):
 * - https://jobs.jobvite.com/<company>/job/<id> is the posting, with no form (ninjaone-posting, jobvite-6; its only
 *   query was Jobright's jr_id);
 * - https://jobs.jobvite.com/<company>/job/<id>/apply is the application: the Data Consent gate first, then the three
 *   steps, all at this one address with no query (ninjaone-consent-empty, ninjaone-consent, ninjaone-step1..3;
 *   jobvite-0..5, -7);
 * - https://jobs.jobvite.com/<company>/jobs, the company's list, shows no posting (the header's link on every page).
 * No snapshot shows the page after Send Application, so no address is read as the confirmation. The company and the
 * id are kept as written (the id is mixed case, "o5b1AfwB"; whether either is read case-insensitively is not shown),
 * and the canonical URL drops a trailing slash, the query and the fragment: the posting and its application share one
 * application key. TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** Jobvite's candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'jobs.jobvite.com';
/** A company as the snapshots' addresses write it ("ninjaone"): letters, digits and '-'. */
const COMPANY = /^[A-Za-z0-9-]+$/;
/** A posting's id as the snapshots write it ("o5b1AfwB"): letters and digits. */
const JOB_ID = /^[A-Za-z0-9]+$/;

/** Whether an address is on Jobvite's candidate host, over https on the default port and without credentials, as
 *  src/shared/hosts.ts matches it: every page there is Jobvite's adapter's, a posting or not. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && url.hostname === HOST;
}

/** The posting an address shows and which page of it, or null when it shows none (the company's list, any other page). */
export function parseJobviteUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [company, job, id, ...rest] = path.split('/').slice(1);
  if (!company || job !== 'job' || !id || !COMPANY.test(company) || !JOB_ID.test(id)) return null;
  const tail = rest.join('/');
  if (tail !== '' && tail !== 'apply') return null;
  const applicationUrl = `https://${HOST}/${company}/job/${id}/apply`;
  return { platform: 'jobvite', board: company, jobId: id, page: tail === '' ? 'posting' : 'application', applicationUrl };
}

/** The canonical application URL when the address shows the application (its consent gate included); null on the
 *  posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJobviteUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
