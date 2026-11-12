/*
 * UKG Ready's (Kronos Workforce Ready's) candidate addresses (jr7 FIX7PLAN §6.14 items 2 and 3; UKGR-3 with its
 * verifier's correction, UKGR-V3), read without the DOM. From the owner's snapshot7 [secure7.saashr.com], one
 * application captured from its posting to its confirmation (fixtures/ukgready/jr7-saashr-*.html, whose headers keep
 * each page's address):
 * - the posting, /ta/<company>.careers?lang=…&ein_id=<employer id>&ShowJob=<job id>&src=…: its choice ("Apply for Job")
 *   and its "Type it in myself" start form are drawn in place at that one address (jr7-saashr-posting, -choice,
 *   -start-filled);
 * - the applicant session after the start form's Continue, a new document at /ta/<company>.careers?rnd=…&Ext=careers
 *   &sft=…&ActiveSessionId=…#applicant/profile: every step, the review and the confirmation stay at that one address,
 *   which names no job (the other 18 cases).
 * What it reads:
 * - the posting (exactly one ShowJob, digits): page 'posting', board the company's number, jobId the ShowJob, its
 *   application keyed per job by https://<host>/ta/<company>.careers?ShowJob=<job id> alone (UKGR-V3: the key is
 *   ShowJob alone; lang, ein_id, src and every other parameter left out, so every spelling of one posting is one key);
 * - the session (an ActiveSessionId, no ShowJob): page 'application', never 'other' (UKGR-3 corrected: the agent and
 *   the Queue never read it as a closed posting), under the tenant's https://<host>/ta/<company>.careers. Reached from
 *   its posting in the same tab, it takes the posting's per-job key by the referrer chain (adapters/chain.ts, CHAIN-7:
 *   family ukgready:<host>:<company>); its own key is the tenant's only where no chain names it (Q7-1: the referrer).
 *   No session value (ActiveSessionId, sft, rnd) is ever read into a key, an address or a log: only whether one is
 *   there;
 * - anything else on the host (the careers search, /ta/<company>.careers with neither, a ShowJob that is no number or
 *   given twice, every other path: the employee system's /ta/<n>.login, .home and the rest, which shared/hosts.ts keeps
 *   off as an HR host): null.
 * Only https on the default port, with no credentials, on secure<n>.saashr.com (shared/hosts.ts names the same host);
 * the host is written in lower case. No snapshot shows the page after submitting at its own address (the success
 * screen is drawn in place at the session's), so no address reads as 'confirmation'.
 */
import type { ApplicationUrl } from '../application-key';

/** UKG Ready's candidate hosts, as src/shared/hosts.ts HOST_PLATFORMS reads them (only secure7 is captured). */
const HOST = /^secure\d{0,2}\.saashr\.com$/;
/** The careers page's path, the company's number in it (jr7-saashr-*: /ta/<7 digits>.careers). */
const PATH = /^\/ta\/(\d{3,10})\.careers$/;
/** A posting's ShowJob: digits only (jr7-saashr-posting: 9). */
const JOB = /^\d{1,15}$/;

/** Whether an address is on UKG Ready's candidate host, over https on the default port and without credentials. */
function plainHost(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname.toLowerCase());
}

/** The posting or the applicant session an address shows (module header), or null on every other page. */
export function parseUkgReadyUrl(url: URL): ApplicationUrl | null {
  if (!plainHost(url)) return null;
  const company = PATH.exec(url.pathname)?.[1];
  if (company === undefined) return null;
  const careers = `https://${url.hostname.toLowerCase()}/ta/${company}.careers`;
  const jobs = url.searchParams.getAll('ShowJob');
  if (jobs.length > 0) {
    const job = jobs[0]!;
    return jobs.length === 1 && JOB.test(job)
      ? { platform: 'ukgready', board: company, jobId: job, page: 'posting', applicationUrl: `${careers}?ShowJob=${job}` }
      : null;
  }
  // The session: whether an ActiveSessionId is there, never what it says.
  if ((url.searchParams.get('ActiveSessionId') ?? '') === '') return null;
  return { platform: 'ukgready', board: company, jobId: '', page: 'application', applicationUrl: careers };
}

/** The canonical application URL of an address: the session's (the tenant's careers page); null on the posting and on
 *  any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseUkgReadyUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
