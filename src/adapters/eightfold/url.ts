/*
 * Eightfold AI's candidate addresses (jr7 FIX7PLAN §6.15, Eightfold item 1: EFA-2), read without the DOM, from the
 * owner's snapshot7 capture twillio (one company's PCSX career site on <company>.eightfold.ai; fixtures/eightfold/
 * jr7-twillio-*):
 * - https://<company>.eightfold.ai/careers?…pid=<id>… is the job list with that posting's details pane, its "Apply Now"
 *   link to the form (jr7-twillio-posting: start, sort_by and pid in its query): the posting;
 * - https://<company>.eightfold.ai/careers/apply?pid=<id> is the application, one page (jr7-twillio-apply, -apply-2);
 * - https://<company>.eightfold.ai/careers/apply/success?domain=<company's domain>&pid=<id> is the page after
 *   submitting it (jr7-twillio-success), as Jobright 1.25.2's Eightfold rule names it (its ats-submission rule's route
 *   /careers/apply/success; isAtsSubmissionConfirmationUrl("eightfold"): the same one numeric pid);
 * - https://<company>.eightfold.ai/careers/job/<id> is a posting by Jobright's site list (SITE_REGISTRY.eightfold);
 *   no capture shows it (the verifier: an unverified shape), so it reads as the posting alone.
 * The posting is named by its one numeric `pid` (13 digits in the capture); an address with none, or with two, names
 * none (the job list alone, the dashboard, the profile, the recruiters' app. and the employees' /careerhub/, which
 * src/shared/hosts.ts keeps off). All three pages share one key: the canonical application URL is
 * https://<company>.eightfold.ai/careers/apply?pid=<id>, the form's address as the posting's Apply Now links to it (the
 * agent can open it directly: Jobright's entry adapter, eightfoldEntryAdapter, accepts it as is).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A company's Eightfold host, as src/shared/hosts.ts lists it: never the recruiters' app. nor www. */
const HOST = /^(?!(?:app|www)\.)[a-z0-9-]+\.eightfold\.ai$/;
/** A posting's id: digits (13 in the capture). */
const PID = /^\d{1,20}$/;
/** The paths of a posting's pages, and the page each one is. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['/careers', 'posting'], ['/careers/apply', 'application'],
  ['/careers/apply/success', 'confirmation']]);
/** The posting's own page by its path (module header: Jobright's site list, no capture). */
const JOB_PATH = /^\/careers\/job\/(\d{1,20})$/;

/** Whether an address is on a company's Eightfold host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The posting an address shows and which page of it (module header), or null. */
export function parseEightfoldUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  let page = PAGES.get(path);
  let pid: string | null = null;
  if (page !== undefined) {
    const pids = url.searchParams.getAll('pid');
    pid = pids.length === 1 ? pids[0]! : null;
  } else {
    const job = JOB_PATH.exec(path);
    if (job !== null) {
      page = 'posting';
      pid = job[1]!;
    }
  }
  if (page === undefined || pid === null || !PID.test(pid)) return null;
  const company = url.hostname.slice(0, -'.eightfold.ai'.length);
  return { platform: 'eightfold', board: company, jobId: pid, page,
    applicationUrl: `https://${url.hostname}/careers/apply?pid=${pid}` };
}

/** The canonical application URL when the address shows the form; null on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseEightfoldUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
