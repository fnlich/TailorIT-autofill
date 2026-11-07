/*
 * iCIMS's addresses, read without the DOM: whether an address is iCIMS's, which posting and which of its pages it shows,
 * and the canonical application URL the application key is hashed from. From the public capture of 2026-11-04/05
 * (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture"; three portals) and the owner's
 * snapshots of 2026-11-06 (ten portals, signed in: the pages after the gate; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - a company's portal is careers-<co>.icims.com (or <co>.icims.com, us-careers-<co>, uscareers-<co>); the posting is
 *   /jobs/<id>/<slug>/job, the slug free (/jobs/<id>/x/job and /jobs/<id>/job load the same posting). The top page is
 *   the company's wrapper and reloads itself with layout parameters (?mobile=false&width=...&needsRedirect=false&
 *   jan1offset=...); the page itself is the same address with ?in_iframe=1, in the wrapper's iframe#icims_content_iframe
 *   on the same host. Some portals serve the page as the top document itself, with no wrapper (careers-aaalife's and
 *   careers-ars's ?mobile=true, and every step of theirs): the same addresses without in_iframe;
 * - the posting's "Apply for this job online" (/job?mode=apply&apply=yes&in_iframe=1&hashed=<n>) moves the top to
 *   /jobs/<id>/<slug>/login and its frame to .../login?in_iframe=1: the email gate ("Enter Your Information"), whose
 *   Next posts .../login?step=email, which answers "Please verify your email account" (uscareers-nyu's "Login" (1));
 *   "Log back in" (.../login?loginOnly=1...) sends the top to login.icims.com, iCIMS's own Auth0 sign-in, which names
 *   the company but no job: no host of a portal, no application;
 * - the pages after the gate, each a word of its own under the posting and a document of its own (the owner's
 *   snapshots): /candidate, the Candidate Profile (?from=login&eem=...&code=..., the email's link; ?from=login&csrf=...&
 *   hashed=...; with &uploadResume=... once a resume was read); /questions, the Candidate Questions (?global=1) and the
 *   Job Specific Questions (no global; ?back=&global=&csrf=...&hashed=... after its Submit found an error); /eeo
 *   (?back=..., "EEO" or "Voluntary Information"); /form (?form=<the form's name>&step=<n>&...: an "IForm", whose form
 *   is framed a level deeper, below); and /job?mode=submit_apply, the posting shown again with "Your application has
 *   been submitted successfully." (uscareers-nyu's), the page after submitting (APPLICATION_WORDS, SUBMITTED_MODE);
 * - an IForm's form itself is <co>.icims.com/forms?module=Forms&action=showForm&...&form=<name>&user=...&item=...&
 *   token=...&csrf=...&in_iframe=1&step=<n>&aid=..., and after its own Submit .../forms?token=...&selected=<name>&
 *   in_iframe=1&step=<n>: another origin than the portal's, framed by the portal's /form page. Its address names no
 *   posting (no job id: item and aid are not the posting's number, and user is the person's), and iCIMS's Forms module
 *   is not only the applicant's, so it is read as no application here (one path segment, not under /jobs): its form
 *   waits for a way to key it by the portal page that frames it (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06);
 * - every other page under /jobs/<id>/ (the posting's "Email this job to a friend", .../referral) is no application.
 * The key is the host and the posting's id: the slug and the query (in_iframe, hashed, csrf, eem, code, the wrapper's
 * layout) are dropped, so the wrapper, its frame, the gate and every page after it share one. The canonical application
 * URL is https://<host>/jobs/<id>/job. TailorIT's parseAtsUrl reads the posting and the gate since its API 5
 * (src/adapters/url.test.ts); and since its API 6 the pages after the gate too.
 */
import type { ApplicationUrl } from '../application-key';

/** A company's portal: careers-<co>.icims.com or <co>.icims.com, never iCIMS's own www, api or login hosts, nor an
 *  employees' internal-<co> portal (src/shared/hosts.ts). */
const HOST = /^(?!(?:www|api|login)\.)(?!internal-)[a-z0-9-]+\.icims\.com$/;
const POSTING_ID = /^\d{1,12}$/;
/** The words under /jobs/<id>/[<slug>/] read as the posting's application (module header): the gate, and (the owner's
 *  snapshots of 2026-11-06) the Candidate Profile, the Candidate and Job Specific Questions, EEO and the IForm page. */
const APPLICATION_WORDS: ReadonlySet<string> = new Set(['login', 'candidate', 'questions', 'eeo', 'form']);
/** /job?mode=submit_apply: the posting again after the last step's Submit, with its success message (module header). */
const SUBMITTED_MODE = 'submit_apply';

/** Whether an address is on an iCIMS portal, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The posting an address shows and which page of it, or null when it shows none (a search, the portal's home). */
export function parseIcimsUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.split('/').slice(1);
  if (parts.length < 3 || parts.length > 4 || parts[0] !== 'jobs' || !POSTING_ID.test(parts[1]!)) return null;
  const name = parts.at(-1)!;
  if (name !== 'job' && !APPLICATION_WORDS.has(name)) return null;
  // "Log back in" (.../login?loginOnly=1): iCIMS's own sign-in, which names no job.
  if (name === 'login' && url.searchParams.get('loginOnly') === '1') return null;
  const jobId = parts[1]!;
  const board = url.hostname.slice(0, -'.icims.com'.length);
  const page = name !== 'job' ? 'application'
    : url.searchParams.get('mode') === SUBMITTED_MODE ? 'confirmation' : 'posting';
  return { platform: 'icims', board, jobId, page, applicationUrl: `https://${url.hostname}/jobs/${jobId}/job` };
}

/** The canonical application URL when the address shows the application (the gate, the pages after it); null on the
 *  posting, the page after submitting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseIcimsUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
