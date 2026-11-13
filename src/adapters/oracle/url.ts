/*
 * Oracle Recruiting Cloud's addresses (its Candidate Experience), read without the DOM: whether an address is Oracle's,
 * which posting and which of its pages it shows, and the canonical application URL the application key is hashed from.
 * From the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; two tenants, one with no region in its host):
 * - a tenant's host is <tenant>.fa.<region>.oraclecloud.com, or <tenant>.fa.oraclecloud.com (JPMC);
 * - the posting is /hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id>, a single-page application that writes the
 *   language and the site as it reads them (fr became en, cx_1001 became CX_1001) and drops a trailing slash;
 *   /requisitions/preview/<id> is rewritten to /job/<id>;
 * - APPLY NOW changes the address in place to .../job/<id>/apply/email, the email gate; what follows the emailed code
 *   (.../apply/section/<n>, Jobright's reading) is not public: every address under .../job/<id>/apply is read as the
 *   posting's application, and so is .../job/<id>/easy-apply, the quick apply's (the v3 Phase 6/7b review, C11);
 * - .../sites/<site>/my-profile/sign-in ("Manage Your Profile") names no job: no application.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): Oracle's government cloud serves the same application
 * on <tenant>.fa.ocs.oraclegovcloud.com (the owner's snapshots of a tenant's .../job/<id>/apply/section/1, a step after
 * the emailed code, read as the posting's application as every address under .../apply is).
 * The key is the host, the site in upper case (as the application writes it) and the posting's id, the language
 * dropped. The canonical application URL is https://<host>/hcmUI/CandidateExperience/en/sites/<SITE>/job/<id>. The content
 * script runs on these candidate pages alone (src/shared/hosts.ts). TailorIT's parseAtsUrl reads the same posting since
 * its API 5 (src/adapters/url.test.ts).
 * v5 p2-detect (the owner, 2026-11-08: "Jobright is sample, and it works perfectly. you can use it"; Jobright 1.25.2's
 * site registry: any host's .../CandidateExperience/.../sites/.../job/... and its jobs/preview form, read as its behaviour): the
 * same Candidate Experience on a company's own https domain, /hcmUI/CandidateExperience/<lang>/sites/<site>/..., read
 * alike (ORACLE_OWN_DOMAIN_PATH; the P2 review's security 1: the hcmUI prefix alone, the one every fixture shows) on any
 * host but Oracle's own domains and those shared/hosts.ts keeps the extension off (no static match: shared/hosts.ts
 * platformOfUrl names it by its address, and the sentinel and the adapters' choice take it only with its Oracle markup,
 * dom/page-signals.ts oracleCandidateExperienceShown); its canonical address keeps its host. And .../jobs/preview/<id>,
 * Jobright's other spelling of a posting, is read as .../job/<id> is.
 */
import type { ApplicationUrl } from '../application-key';

/** A Fusion Applications tenant: <tenant>.fa.<region>.oraclecloud.com or <tenant>.fa.oraclecloud.com; and (the snapshot
 *  build of 2026-11-06) one on Oracle's government cloud, <tenant>.fa.ocs.oraclegovcloud.com. */
const HOST = /^[a-z0-9-]+\.fa(?:(?:\.[a-z0-9-]+)?\.oraclecloud|\.ocs\.oraclegovcloud)\.com$/;
const ROOT = '/hcmUI/CandidateExperience/';
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const SITE = /^[A-Za-z0-9_-]{1,40}$/;
const POSTING_ID = /^\d{1,15}$/;

/** v5 p2-detect: Oracle's Candidate Experience on a company's own domain (module header), as shared/hosts.ts reads it:
 *  /hcmUI/CandidateExperience/<lang>/sites/<site>/ (the P2 review's security 1: hcmUI alone). */
export const ORACLE_OWN_DOMAIN_PATH =
  /^\/hcmUI\/CandidateExperience\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/sites\/[A-Za-z0-9_-]{1,40}\//;
/** The domains no company's own Candidate Experience is read on: Oracle's own clouds (their tenants are HOST's), and
 *  those src/shared/hosts.ts keeps the extension off (isLinkedInHost, isHrHost, the CAPTCHA vendors), as it lists them
 *  (src/shared/hosts.test.ts holds the two readings to each other). */
export const ORACLE_REFUSED_DOMAINS: readonly string[] = ['oraclecloud.com', 'oraclegovcloud.com', 'linkedin.com',
  'linkedin.cn', 'lnkd.in', 'licdn.com', 'myworkday.com', 'sapsf.com', 'sapsf.eu', 'bamboohr.com', 'clearcompany.com',
  'dayforcehcm.com', 'ultipro.com', 'ukg.net', 'paylocity.com', 'paycor.com', 'rippling.com', 'hibob.com', 'adp.com',
  // The P2 review (security 2)
  'ultipro.ca',
  'paycomonline.net', 'careerplug.com', 'google.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com', 'arkoselabs.com',
  'funcaptcha.com', 'captcha-delivery.com', 'protechts.net', 'geetest.com', 'saashr.com', 'jobdiva.com', 'eightfold.ai',
  'jibeapply.com'];
const ORACLE_DOMAINS = new RegExp(`(?:^|\\.)(?:${ORACLE_REFUSED_DOMAINS.map((domain) => domain.replace(/\./g, '\\.'))
  .join('|')})$`);

/** The path up to and with /CandidateExperience/ an address's candidate pages start with (ROOT, on a tenant's host or,
 *  v5 p2-detect, a company's own domain); null where the address is no candidate page. */
function rootOf(url: URL): string | null {
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  if (HOST.test(url.hostname)) return url.pathname.startsWith(ROOT) ? ROOT : null;
  if (ORACLE_DOMAINS.test(url.hostname) || !url.hostname.includes('.') || !ORACLE_OWN_DOMAIN_PATH.test(url.pathname)) {
    return null;
  }
  return ROOT;
}

/** Whether an address is a candidate page of an Oracle Recruiting Cloud tenant (v5 p2-detect: or of its Candidate
 *  Experience on a company's own domain), over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return rootOf(url) !== null;
}

/** The pages after a posting's id that are its application: the apply flow, and the quick apply's. */
const APPLY_TAILS: ReadonlySet<string> = new Set(['apply', 'easy-apply']);

/** The posting's id and what follows it in an address of a tenant's site, or null. */
function postingPath(url: URL): { root: string; site: string; id: string; tail: string[] } | null {
  const root = rootOf(url);
  if (root === null) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [language, sites, site, ...rest] = path.slice(root.length).split('/');
  if (language === undefined || !LANGUAGE.test(language) || sites !== 'sites' || site === undefined
    || !SITE.test(site)) return null;
  let at = 0;
  if (rest[0] === 'job') at = 1;
  // v5 p2-detect: jobs/preview/<id>, Jobright's other spelling of a posting (module header).
  else if ((rest[0] === 'requisitions' || rest[0] === 'jobs') && rest[1] === 'preview') at = 2;
  else return null;
  const id = rest[at];
  return id === undefined || !POSTING_ID.test(id) ? null : { root, site, id, tail: rest.slice(at + 1) };
}

/** Whether an address is a posting's email gate, .../job/<id>/apply/email (the v3 Phase 6/7b review, S2: the adapter
 *  reads the gate by its address, then by the markup only the gate has). */
export function isOracleEmailGate(url: URL): boolean {
  const read = postingPath(url);
  return read !== null && read.tail.length === 2 && read.tail[0] === 'apply' && read.tail[1] === 'email';
}

/** jr6 O8: the section an address of a posting's apply flow shows, .../job/<id>/apply/section/<n> (hjf-apply-section's
 *  section/1; Jobright 1.25.2's getOracleCloudStepState reads the number there too), as its number; null for any other
 *  address (the gate, the posting, the quick apply's, which no snapshot shows). */
export function oracleApplySection(url: URL): number | null {
  const read = postingPath(url);
  if (read === null || read.tail.length !== 3 || read.tail[0] !== 'apply' || read.tail[1] !== 'section') return null;
  const section = read.tail[2]!;
  return /^[1-9]\d{0,2}$/.test(section) ? Number(section) : null;
}

/** The posting an address shows and which page of it, or null when it shows none (the site's search, the profile). */
export function parseOracleUrl(url: URL): ApplicationUrl | null {
  const read = postingPath(url);
  if (read === null || (read.tail.length > 0 && !APPLY_TAILS.has(read.tail[0]!))) return null;
  const board = read.site.toUpperCase();
  return { platform: 'oracle', board, jobId: read.id, page: read.tail.length === 0 ? 'posting' : 'application',
    applicationUrl: `https://${url.hostname}${read.root}en/sites/${board}/job/${read.id}` };
}

/** The canonical application URL when the address shows the application (the email gate, the steps after it); null
 *  on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseOracleUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 2, jr7-O2): the page after submitting ─────────────────────────────────────────

/** jr7-O2: the site an address is the candidate's own "My Applications" page of, .../sites/<site>/my-profile (snapshot7
 *  oraclecloud1's page after its Submit and the emailed code, reached by a route change in the same document:
 *  fixtures/oracle/jr7-oraclecloud1-confirmation.html, at .../sites/CX_1/my-profile), as the application writes it in
 *  upper case; null for every other address (the profile's own pages below it, such as its sign-in; a posting; another
 *  site's page). It names no job and no person: nothing of it is read into a key (FIX7PLAN §5 D-10). Jobright 1.25.2's
 *  isOraclecloudSubmissionConfirmationUrl (~core/ats-submission-sites) takes <site>/my-profile as the page an Oracle
 *  application ends on, read as its behaviour. */
export function oracleMyProfileSite(url: URL): string | null {
  const root = rootOf(url);
  if (root === null) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.slice(root.length).split('/');
  if (parts.length !== 4) return null;
  const [language, sites, site, page] = parts as [string, string, string, string];
  return LANGUAGE.test(language) && sites === 'sites' && SITE.test(site) && page === 'my-profile'
    ? site.toUpperCase() : null;
}

/** jr7-O2 (FIX7PLAN §3.1 confirmationAfter): whether `here` is the page after submitting the application whose Submit
 *  was armed at `armed`: `armed` is that application's (its posting or a page of its apply flow, as parseOracleUrl reads
 *  it), and `here` is the same site's my-profile (oracleMyProfileSite) on the same origin. The language may differ (the
 *  canonical address writes en). Pure: the addresses' parts alone, no id of a person (D-10). The application that page
 *  lists is the success sign's to match (index.ts successSigns: the tile keyed to the armed application). */
export function oracleConfirmationAfter(armed: URL, here: URL): boolean {
  const application = parseOracleUrl(armed);
  const site = oracleMyProfileSite(here);
  return application !== null && site !== null && armed.origin === here.origin && application.board === site;
}
// ── end jr7 ORACLE-7 ──
