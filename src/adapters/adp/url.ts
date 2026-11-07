/*
 * ADP Workforce Now's recruitment addresses (DESIGN-NEW-ATS §1 "ADP Workforce Now"), read without the DOM: whether an
 * address is ADP's candidate page, which posting it shows, and the canonical application URL the application key is
 * hashed from. From the owner's snapshots of 2026-11-06 (adp-0 to adp-6, one application to one posting; converted as
 * fixtures/adp/*.html, whose headers keep each page's address):
 * - the guest identity page and its emailed-code dialog (adp-6, adp-0: fixtures/adp/guest.html, code-dialog.html) are
 *   https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=<uuid>&jobId=<digits>&ccId=<8
 *   digits>_<6 digits>;
 * - every step of the application behind the code (adp-1 to adp-5: personal.html, questions.html, self-id.html,
 *   self-attest.html) is one address, .../mascsr/applicant/mdf/recruitment/postLogin.html?cid=<uuid>&jobId=<digits>
 *   &ccId=<id>&jobId=<digits>&requisitionId=<id>&lang=en_US&params=jobId&OTP_login=true: jobId twice, the same both
 *   times.
 * Both are the posting's application (the guest page is filled from the profile as its first step), under one key:
 * the employer's cid (a uuid, lower case) and the posting's jobId, with the ccId the guest page carries. The canonical
 * application URL is the guest page's address with those three parameters alone, in the snapshot's order. The
 * posting's own page and the confirmation are in no snapshot, so no address is read as either; a recruitment page that
 * names no posting (no cid or no jobId), or two different jobIds, is none. Only these two paths are ADP's candidate
 * pages (src/shared/hosts.ts): the host also serves an employer's employee pages, which are no platform's.
 */
import type { ApplicationUrl } from '../application-key';

/** ADP Workforce Now's host, as src/shared/hosts.ts lists it. */
const HOST = 'workforcenow.adp.com';
/** The guest identity page (adp-6, adp-0) and the application's steps (adp-1 to adp-5). */
const GUEST_PATH = '/mascsr/default/mdf/recruitment/recruitment.html';
const STEPS_PATH = '/mascsr/applicant/mdf/recruitment/postLogin.html';
/** The candidate paths src/shared/hosts.ts scopes ADP's host to. */
const CANDIDATE_PATHS = ['/mascsr/default/mdf/recruitment/', '/mascsr/applicant/mdf/recruitment/'] as const;
/** The employer's client id (cid), a posting's id (jobId) and the client's ccId, as every snapshot writes them. */
const CID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^\d{1,15}$/;
const CC_ID = /^\d{8}_\d{6}$/;

/** Whether an address is on one of ADP's candidate paths, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST && CANDIDATE_PATHS.some((path) => url.pathname.startsWith(path));
}

/** The posting an address shows (see the header), or null on every other page of ADP's candidate paths. */
export function parseAdpUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url) || (url.pathname !== GUEST_PATH && url.pathname !== STEPS_PATH)) return null;
  const query = url.searchParams;
  const cid = query.get('cid') ?? '';
  const jobIds = [...new Set(query.getAll('jobId'))];
  const ccId = query.get('ccId');
  if (!CID.test(cid) || jobIds.length !== 1 || !JOB_ID.test(jobIds[0]!) || (ccId !== null && !CC_ID.test(ccId))) return null;
  const board = cid.toLowerCase();
  const jobId = jobIds[0]!;
  const tail = ccId === null ? '' : `&ccId=${ccId}`;
  return { platform: 'adp', board, jobId, page: 'application',
    applicationUrl: `https://${HOST}${GUEST_PATH}?cid=${board}&jobId=${jobId}${tail}` };
}

/** The canonical application URL on the guest page and every step (see the header); null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseAdpUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
