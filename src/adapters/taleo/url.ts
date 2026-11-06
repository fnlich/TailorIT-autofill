/*
 * Taleo's addresses (Taleo Enterprise), read without the DOM: whether an address is Taleo's, which posting and which of
 * its pages it shows, and the canonical application URL the application key is hashed from. From the public capture of
 * 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture"; three portals):
 * - a company's portal is <co>.taleo.net; a career section's posting is /careersection/<cs>/jobdetail.ftl?job=<id>
 *   (with lang, tz and tzname in the query), server-rendered;
 * - its documented apply address, /careersection/<cs>/jobapply.ftl?job=<id>&lang=en, sends to the sign-in (or, on a
 *   portal that asks first, shows the Privacy Agreement at that same address); the posting's own "Apply Online" posts
 *   the page instead (a JSF post-back);
 * - the account pages sit under /careersection/iam/accessmanagement/ (login.jsf, forgotPasswordAccessCode.jsf,
 *   forgotUsername.jsf) and name the job they return to in redirectionURI (or TARGET): the jobapply.ftl address,
 *   percent-encoded or written plain (the forgot links write it plain, so its own &lang= becomes a parameter of the
 *   page, and so does its job= where lang= comes first);
 * - what follows the sign-in (flow.jsf, application.jss) is not public: such a page is read as the posting's application
 *   only when it names the job (job=), otherwise not at all until the owner's snapshots show its address.
 * The key is the host, the career section and the job id as written: the posting, its apply address, its account pages
 * and its flow share one. The career section's case is kept: no capture shows the server reading /careersection/EX/ as
 * /careersection/ex/, and folding it would make two sections' postings of one id one application. The canonical application URL is https://<host>/careersection/<cs>/jobapply.ftl?job=<id>&lang=en.
 * Taleo Business Edition (<co>.tbe.taleo.net) is another product and is not read. TailorIT's parseAtsUrl does not read
 * Taleo yet (PLATFORMS_AHEAD_OF_CONTRACT).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A company's portal: <co>.taleo.net, never www (src/shared/hosts.ts). */
const HOST = /^(?!www\.)[a-z0-9-]+\.taleo\.net$/;
const SECTION = /^[A-Za-z0-9_-]{1,40}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** A career section's pages, and the page each makes. */
const SECTION_PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['jobdetail.ftl', 'posting'],
  ['jobapply.ftl', 'application'], ['flow.jsf', 'application'], ['application.jss', 'application']]);
/** The folders of the account pages and the pre-sign-in agreement, which name their job in redirectionURI or TARGET. */
const ACCOUNT_FOLDERS = ['/careersection/iam/accessmanagement/', '/careersection/careersection/privacyagreement/'];

/** Whether an address is on a Taleo portal, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** A career section's page, by its path and its job parameter: its section, job and page, or null. */
function sectionPage(pathname: string, job: string | null): { section: string; job: string; page: ApplicationPage } | null {
  const parts = pathname.split('/').slice(1);
  if (parts.length !== 3 || parts[0] !== 'careersection' || !SECTION.test(parts[1]!)) return null;
  const page = SECTION_PAGES.get(parts[2]!);
  if (page === undefined || job === null || !JOB_ID.test(job)) return null;
  return { section: parts[1]!, job, page };
}

/** An address as an account page names it in its query (already decoded once): https, on `host`, its path and query. */
const NAMED = /^https:\/\/([^/?#]+)(\/[^?#]*)(?:\?([^#]*))?/;

/** The job an account page returns to: its redirectionURI's (or TARGET's) apply address on the same host, read as
 *  written (no address is fetched or resolved). */
function returnsTo(url: URL): { section: string; job: string } | null {
  for (const name of ['redirectionURI', 'TARGET']) {
    const written = url.searchParams.get(name);
    const match = written === null ? null : NAMED.exec(written);
    if (match === null || match[1]!.toLowerCase() !== url.hostname) continue;
    // The named address's own query: its job is the first job= there (decoded once more where it was encoded twice).
    // Written plain with its lang= first (jobapply.ftl?lang=en&job=N), its job= became the page's own parameter: that
    // one, then (the v3 Phase 6/7b review, C11).
    const job = /(?:^|&)job=([^&]*)/.exec(match[3] ?? '')?.[1] ?? null;
    let decoded: string | null = null;
    try {
      decoded = job === null ? url.searchParams.get('job') : decodeURIComponent(job);
    } catch {
      decoded = null;
    }
    const read = sectionPage(match[2]!, decoded);
    if (read !== null) return { section: read.section, job: read.job };
  }
  return null;
}

/** The posting an address shows and which page of it, or null when it shows none (the search, a flow page that names
 *  no job). */
export function parseTaleoUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  let read: { section: string; job: string; page: ApplicationPage } | null = null;
  if (ACCOUNT_FOLDERS.some((folder) => url.pathname.startsWith(folder)) && url.pathname.endsWith('.jsf')) {
    const named = returnsTo(url);
    read = named === null ? null : { ...named, page: 'application' };
  } else {
    read = sectionPage(url.pathname, url.searchParams.get('job'));
  }
  if (read === null) return null;
  const board = url.hostname.slice(0, -'.taleo.net'.length);
  return { platform: 'taleo', board, jobId: read.job, page: read.page,
    applicationUrl: `https://${url.hostname}/careersection/${read.section}/jobapply.ftl?job=${read.job}&lang=en` };
}

/** The canonical application URL when the address shows the application (its apply address, an account page, the
 *  flow); null on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseTaleoUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
