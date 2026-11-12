/*
 * JobDiva's candidate portal addresses (jr7 FIX7PLAN §6.15, JobDiva items 1 and 2: JDV-2 with the verifier's JDV-V4),
 * read without the DOM, from the owner's snapshot7 captures jobdiva1 and jobdiva2 (two staffing agencies' portals, on
 * www1 and www2.jobdiva.com; fixtures/jobdiva/jr7-jobdiva{1,2}-*):
 * - https://www<n>.jobdiva.com/portal/?a=<portal key>#/jobs/<job id> is one job of one agency's portal: its posting
 *   and, in dialogs the portal draws in place at that one address, the choice of how to apply, the Quick Apply form,
 *   the two EEO steps after "Submit Application" and the "Thank you!" (jobdiva2, start to confirmation). The posting
 *   and the form share the address, so it reads as the application;
 * - the agency is named by `a` alone (a 64-character key in both captures, the two agencies' apart), the job by the
 *   fragment's route `#/jobs/<id>`. The route's own query (`?jobtitle=…`, jobdiva2) and a later number (Jobright
 *   1.25.2's JobDiva confirmation route, isAtsSubmissionConfirmationUrl, reads `#/jobs/<n>(/<n>)?`) are no part of
 *   the job;
 * - JDV-V4: jobdiva2's address also carries an older link's query (SearchString, StatesString, source, compid and `id`,
 *   the fragment's own job id). Where the fragment names no route at all, the query's `id` names the job; and the
 *   legacy job page /candidates/myjobs/openjob.jsp?a=<key>&id=<id> (a link in that form, which TailorIT may hold as
 *   a job's address) names that job's posting. A fragment naming another route (the job list `#/`, `#/login`,
 *   `#/signup`: the portal header's links) is no job, whatever the query says;
 * - every other address of the domain (the employers' pages, the portal's list) shows no job: null.
 * The canonical application URL is https://<host>/portal/?a=<key>#/jobs/<id>: the host and the key as written, the
 * fragment kept, since the job lives only there. The legacy page reads as the posting (no form of ours shows there;
 * src/shared/hosts.ts matches /portal/ alone, so no content script runs on it). So a posting and its application keep
 * one application key, and two jobs or two agencies' portals never share one.
 */
import type { ApplicationUrl } from '../application-key';

/** JobDiva's candidate hosts, as src/shared/hosts.ts lists them (www, www1, www2 …). */
const HOST = /^www\d{0,2}\.jobdiva\.com$/;
/** An agency's portal key (64 letters and digits in both captures): letters and digits, generous bounds. */
const KEY = /^[0-9A-Za-z]{16,128}$/;
/** A job's id: digits (8 in both captures). */
const JOB_ID = /^\d{1,12}$/;
/** The fragment's job route (module header): `#/jobs/<id>`, a later number and a query of its own allowed. */
const JOB_ROUTE = /^#\/jobs\/(\d{1,12})(?:\/\d{1,12})?\/?(?:\?.*)?$/;
/** The legacy job page's path (JDV-V4). */
const LEGACY_PATH = '/candidates/myjobs/openjob.jsp';

/** Whether an address is on a JobDiva candidate host, over https on the default port and without credentials. */
function onHost(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The one value of a query parameter, or null where it is absent or given more than once. */
function only(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0]! : null;
}

/** The job a portal address names (module header): the fragment's job route; with no route at all, the query's
 *  `id`; null where the fragment routes elsewhere or nothing names a job. */
function portalJobOf(url: URL): string | null {
  if (url.hash !== '') return JOB_ROUTE.exec(url.hash)?.[1] ?? null;
  return only(url, 'id');
}

/** The job an address shows (module header), or null. */
export function parseJobDivaUrl(url: URL): ApplicationUrl | null {
  if (!onHost(url)) return null;
  const portal = url.pathname === '/portal/' || url.pathname === '/portal';
  if (!portal && url.pathname !== LEGACY_PATH) return null;
  const key = only(url, 'a');
  if (key === null || !KEY.test(key)) return null;
  const jobId = portal ? portalJobOf(url) : only(url, 'id');
  if (jobId === null || !JOB_ID.test(jobId)) return null;
  return { platform: 'jobdiva', board: key, jobId, page: portal ? 'application' : 'posting',
    applicationUrl: `https://${url.hostname}/portal/?a=${key}#/jobs/${jobId}` };
}

/** The canonical application URL when the address shows a job of the portal; null on every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJobDivaUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
