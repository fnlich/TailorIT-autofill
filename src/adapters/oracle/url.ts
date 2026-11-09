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
 * same Candidate Experience on a company's own https domain, /<prefix>/CandidateExperience/<lang>/sites/<site>/..., read
 * alike (ORACLE_OWN_DOMAIN_PATH) on any host but Oracle's own domains and those shared/hosts.ts keeps the extension off
 * (no static match: shared/hosts.ts platformOfUrl names it, and the sentinel recognises it, dom/page-signals.ts); its
 * canonical address keeps its host and prefix. And .../jobs/preview/<id>, Jobright's other spelling of a posting, is read
 * as .../job/<id> is.
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
 *  /<prefix>/CandidateExperience/<lang>/sites/<site>/. */
export const ORACLE_OWN_DOMAIN_PATH =
  /^\/[A-Za-z0-9_-]{1,40}\/CandidateExperience\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/sites\/[A-Za-z0-9_-]{1,40}\//;
/** The domains no company's own Candidate Experience is read on: Oracle's own clouds (their tenants are HOST's), and
 *  those src/shared/hosts.ts keeps the extension off (isLinkedInHost, isHrHost, the CAPTCHA vendors), as it lists them
 *  (src/shared/hosts.test.ts holds the two readings to each other). */
export const ORACLE_REFUSED_DOMAINS: readonly string[] = ['oraclecloud.com', 'oraclegovcloud.com', 'linkedin.com',
  'linkedin.cn', 'lnkd.in', 'licdn.com', 'myworkday.com', 'sapsf.com', 'sapsf.eu', 'bamboohr.com', 'clearcompany.com',
  'dayforcehcm.com', 'ultipro.com', 'ukg.net', 'paylocity.com', 'paycor.com', 'rippling.com', 'hibob.com', 'adp.com',
  'paycomonline.net', 'careerplug.com', 'google.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com', 'arkoselabs.com',
  'funcaptcha.com', 'captcha-delivery.com', 'protechts.net', 'geetest.com'];
const ORACLE_DOMAINS = new RegExp(`(?:^|\\.)(?:${ORACLE_REFUSED_DOMAINS.map((domain) => domain.replace(/\./g, '\\.'))
  .join('|')})$`);

/** The path up to and with /CandidateExperience/ an address's candidate pages start with: ROOT on a tenant's host, the
 *  company's own prefix on its own domain (v5 p2-detect); null where the address is no candidate page. */
function rootOf(url: URL): string | null {
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  if (HOST.test(url.hostname)) return url.pathname.startsWith(ROOT) ? ROOT : null;
  if (ORACLE_DOMAINS.test(url.hostname) || !url.hostname.includes('.') || !ORACLE_OWN_DOMAIN_PATH.test(url.pathname)) {
    return null;
  }
  return url.pathname.slice(0, url.pathname.indexOf('/CandidateExperience/') + '/CandidateExperience/'.length);
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
