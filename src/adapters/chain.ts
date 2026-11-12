/*
 * The snapshot build of 2026-11-06 (core-x, items 7 and 14; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): pages whose address names no job but
 * that continue an application the same tab showed just before, read without the DOM. Pure and small: the worker
 * (background/chain.ts) and the content runtime both read it.
 * - SuccessFactors (the owner's snapshots [career8.successfactors.com] "Create an Account" and "Apply for ... (4984)"):
 *   the account page names the job (/career?company=<co>&login_ns=register&career_job_req_id=<id>); a post-back of
 *   /career with _s.crb and no job continues it. A top frame's page. The application form after the account, posted to
 *   /portalcareer?_s.crb=<token> (an address that names none: successfactors/url.ts), is no chain page (the behaviour
 *   review of 2026-11-06, minor 9): no fixture shows it and the adapter has no rules for it, so it stays unkeyed, and no
 *   run fills it, until one does.
 * - SmartRecruiters (the owner's snapshots [jobs.smartrecruiters.com] Xplor's posting, "Easy apply" and "Preliminary
 *   questions"): the posting (/<Company>/<id>-<slug>) links its "I'm interested" to the one-click application
 *   (/oneclick-ui/company/<Company>/publication/<uuid>, then .../screening), whose address names a publication, never the
 *   posting: so the one-click application, reached from its posting, takes the posting's application. A top frame's
 *   page, of the same company.
 * - iCIMS (the owner's IForm snapshots of careers-edgewaterit, uscareers-nyu and uscareers-rtiinc): the portal's IForm
 *   page (careers-<co>.icims.com/jobs/<id>/<slug>/form, an application page of its own) frames the form itself on
 *   <co>.icims.com/forms, whose address names no posting (icims/url.ts). A subframe's page, keyed by the application of
 *   the portal page that frames it.
 * A chain page takes the application of the same tab's claimed page it was reached from (background/chain.ts): a top
 * frame's by the browser's referrer, which must be that page's own address, a subframe's by the tab's one claimed portal
 * frame of its company (the worker's frame registry: no token and no message between frames, the security fix S4);
 * always on the same platform and the same family (chainFamilyOf), within CHAIN_MS. Any
 * other page, or any doubt, is no chain: it stays unkeyed (or keyed by its own address).
 * jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5):
 * - UKG Ready (UKGR-3, AUTO7-11; the owner's snapshot7 [secure7.saashr.com]): the posting
 *   /ta/<company>.careers?ShowJob=<digits> names its job; the applicant session after its start form
 *   (/ta/<company>.careers?…&ActiveSessionId=<…>, no ShowJob) names none, and every step, the review and the confirmation
 *   stay at that one address. The session is a top frame's chain page of the posting's family
 *   (ukgready:<host>:<company>), keyed by the browser's referrer as SmartRecruiters' one-click page is. Never a session
 *   value: the family reads the host and the company's number alone.
 * - Paycom (PC7-03; the owner's snapshot7 [www.paycomonline.net]): the posting …/portal/<client key>/jobs/<n> hands over,
 *   through its contact dialog's "Continue To Application", to …/portal/<client key>/applications#/applications/<m>, a
 *   new document whose number is never the posting's (6 of 6 captures). That page is a pair page (`pair`): it takes the
 *   application of the same tab's posting of the same client key whose latest press (its Apply, its sign-in step, its
 *   dialog) came within PAIR_MS (background/chain.ts notePair, inheritPair), once per press; never by its number, never
 *   by the referrer.
 * - iCIMS (ICIMS7-01; snapshot7 [arc-onesolutions.icims.com]): a portal whose forms host is not its own name's
 *   (arc-onesolutions frames its IForms from oneblood.icims.com) declares the forms frame's origin
 *   (Adapter.chainChildOrigins); declaredChildOrigin says which declared origins the worker may take: an https origin
 *   whose /forms page is a chain subframe page of the portal's platform.
 */
import type { Platform } from '../core/enums';
import { sha256Hex } from '../core/text/sha256';
import { parseIcimsUrl } from './icims/url';
import { parseSmartRecruitersUrl } from './smartrecruiters/url';
import { parseSuccessFactorsUrl } from './successfactors/url';

/** A page that continues an application (module header): its platform, whether a top frame or a subframe shows it, and
 *  its family. */
export interface ChainPage {
  platform: Platform;
  role: 'top' | 'frame';
  family: string;
  /** jr7 CHAIN-7 (PC7-03): a top page keyed by its tab's latest posting press of its family (background/chain.ts
   *  inheritPair), never by its referrer. */
  pair?: true;
}

/** SuccessFactors' career sites (successfactors/url.ts HOST). */
const SF_HOST = /^career\d{0,3}\.successfactors\.(?:com|eu)$/;
/** An iCIMS portal's host as the IForm snapshots show it, careers-<co>, uscareers-<co> or us-careers-<co>, and the
 *  forms host <co>.icims.com that frames its IForms' own forms. jr6 ICIMS-27: the portal names' whole prefix family a
 *  forms host is the portal's host without, as Jobright strips it (a fact of ~core/icims-submit-request
 *  isIcimsPacketLeaf, written here in our own words): careers and careers1 to careers99, jobs, staff, faculty, main,
 *  uscareers, us-careers, internationalcareers, corporatecareers, securitycareers, external, non-clinical, retail,
 *  nationalalamo, nationalalamoca, us and pr. A longer name stands before a shorter one it starts with (us-careers
 *  before us, nationalalamoca before nationalalamo), so a company's name never takes a prefix's part. */
const ICIMS_PREFIX = `(?:${[/us-careers|uscareers|internationalcareers|corporatecareers|securitycareers/,
  /careers(?:[1-9]\d?)?|jobs|staff|faculty|main|external|non-clinical|retail|nationalalamoca|nationalalamo|us|pr/]
  .map((part) => part.source).join('|')})`;
const ICIMS_PORTAL = new RegExp(`^${ICIMS_PREFIX}-([a-z0-9-]+)\\.icims\\.com$`);
const ICIMS_FORMS = new RegExp(`^(?!(?:www|api|login|internal-|${ICIMS_PREFIX}-))([a-z0-9-]+)\\.icims\\.com$`);
// ── jr7 CHAIN-7 (module header): UKG Ready's and Paycom's addresses, as src/shared/hosts.ts registers them ──
/** UKG Ready's candidate host (secure<n>.saashr.com) and its careers page's path, the company's number in it. */
const UKGR_HOST = /^secure\d{0,2}\.saashr\.com$/;
const UKGR_PATH = /^\/ta\/(\d{3,10})\.careers$/;
/** A posting's ShowJob: digits only. */
const UKGR_JOB = /^\d{1,15}$/;
/** Paycom's candidate host and its portal's paths, the client key in them. */
const PAYCOM_HOST = 'www.paycomonline.net';
const PAYCOM_PATH = /^\/v4\/ats\/web\.php\/portal\/([A-Fa-f0-9]{32})\/(jobs\/\d+|applications)$/;
/** The application's route in a Paycom /applications page's fragment (its number is never read). */
const PAYCOM_ROUTE = /^#\/applications\/\d+(?:[/?].*)?$/;

/** UKG Ready's family (ukgready:<host>:<company>) and which of its pages an address shows: the posting (one ShowJob of
 *  digits) or the applicant session (an ActiveSessionId, no ShowJob); null for any other address. Reads no session
 *  value: only whether one is there. */
function ukgReadyPage(url: URL, host: string, path: string): { family: string; page: 'posting' | 'session' } | null {
  if (!UKGR_HOST.test(host)) return null;
  const company = UKGR_PATH.exec(path);
  if (company === null) return null;
  const family = `ukgready:${host}:${company[1]}`;
  const job = url.searchParams.getAll('ShowJob');
  if (job.length > 0) return job.length === 1 && UKGR_JOB.test(job[0]!) ? { family, page: 'posting' } : null;
  return (url.searchParams.get('ActiveSessionId') ?? '') !== '' ? { family, page: 'session' } : null;
}

/** Paycom's family (paycom:<client key>, lower case) and which of its pages an address shows: a posting (/jobs/<n>) or
 *  an application (/applications, its route in the fragment); null for any other address. */
function paycomPage(url: URL, host: string, path: string): { family: string; page: 'posting' | 'application' } | null {
  if (host !== PAYCOM_HOST) return null;
  const parts = PAYCOM_PATH.exec(path);
  if (parts === null) return null;
  const family = `paycom:${parts[1]!.toLowerCase()}`;
  if (parts[2] !== 'applications') return { family, page: 'posting' };
  return PAYCOM_ROUTE.test(url.hash) ? { family, page: 'application' } : null;
}

/** A path without its one trailing slash (the root aside). */
function trimmed(path: string): string {
  return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
}
// ── end jr7 CHAIN-7 ──

/** An https address on the default port, with no credentials. */
function plain(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '';
}

/** A SmartRecruiters company, as its posting's or its one-click application's address writes it, in lower case. */
function smartRecruitersCompany(url: URL): string | null {
  const parsed = parseSmartRecruitersUrl(url);
  return parsed === null ? null : parsed.board?.toLowerCase() ?? null;
}

/** The family an address belongs to, for a chain (module header): SuccessFactors' career host, SmartRecruiters'
 *  company, iCIMS's company (its portal's and its forms host's); null for any other address. */
export function chainFamilyOf(url: URL): string | null {
  if (!plain(url)) return null;
  const host = url.hostname.toLowerCase();
  if (SF_HOST.test(host)) return `successfactors:${host}`;
  if (host === 'jobs.smartrecruiters.com') {
    const company = smartRecruitersCompany(url);
    return company === null ? null : `smartrecruiters:${company}`;
  }
  const path = trimmed(url.pathname); // jr7 CHAIN-7
  const own = ukgReadyPage(url, host, path) ?? paycomPage(url, host, path); // jr7 CHAIN-7: UKG Ready's, Paycom's
  if (own !== null) return own.family; // jr7 CHAIN-7
  const portal = ICIMS_PORTAL.exec(host);
  if (portal !== null) return `icims:${portal[1]}`;
  const forms = ICIMS_FORMS.exec(host);
  return forms === null ? null : `icims:${forms[1]}`;
}

/** Whether an address is a chain page (module header), and how; null otherwise. */
export function chainPageOf(url: URL): ChainPage | null {
  if (!plain(url)) return null;
  const host = url.hostname.toLowerCase();
  const path = trimmed(url.pathname); // jr7 CHAIN-7: the one trailing slash, as before
  if (SF_HOST.test(host)) {
    // The behaviour review of 2026-11-06 (minor 9): /portalcareer, the application form after the account, is no chain
    // page until a fixture shows it and the adapter has its rules: chained, the generic adapter filled its whole form.
    const postBack = path === '/career' && url.searchParams.has('_s.crb');
    return postBack && parseSuccessFactorsUrl(url) === null
      ? { platform: 'successfactors', role: 'top', family: `successfactors:${host}` } : null;
  }
  if (host === 'jobs.smartrecruiters.com') {
    const parsed = parseSmartRecruitersUrl(url);
    const company = smartRecruitersCompany(url);
    return parsed !== null && parsed.page === 'application' && company !== null
      ? { platform: 'smartrecruiters', role: 'top', family: `smartrecruiters:${company}` } : null;
  }
  const forms = ICIMS_FORMS.exec(host);
  if (forms !== null && path === '/forms' && parseIcimsUrl(url) === null) {
    return { platform: 'icims', role: 'frame', family: `icims:${forms[1]}` };
  }
  // ── jr7 CHAIN-7 (module header): UKG Ready's applicant session; Paycom's application, a pair page ──
  const ukg = ukgReadyPage(url, host, path);
  if (ukg !== null) return ukg.page === 'session' ? { platform: 'ukgready', role: 'top', family: ukg.family } : null;
  const paycom = paycomPage(url, host, path);
  if (paycom !== null) {
    return paycom.page === 'application' ? { platform: 'paycom', role: 'top', family: paycom.family, pair: true } : null;
  }
  // ── end jr7 CHAIN-7 ──
  return null;
}

// ── jr7 CHAIN-7 (module header) ──
/** ICIMS7-01: whether a portal page may declare `origin` as the origin of the chain subframes it frames
 *  (Adapter.chainChildOrigins, said in its hello): an https origin on the default port, nothing but an origin, whose
 *  /forms page is a chain subframe page (chainPageOf, role 'frame') of `platform`. The worker takes no other. */
export function declaredChildOrigin(origin: string, platform: Platform): boolean {
  let url: URL;
  try {
    url = new URL(`${origin}/forms`);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.href !== `${origin}/forms` || !plain(url)) return false;
  const page = chainPageOf(url);
  return page !== null && page.role === 'frame' && page.platform === platform;
}

/** PC7-03: the family of a posting whose press a pair page of that family takes (Paycom's …/jobs/<n>); null for any other
 *  address. */
export function pairPostingFamilyOf(url: URL): string | null {
  if (!plain(url)) return null;
  const paycom = paycomPage(url, url.hostname.toLowerCase(), trimmed(url.pathname));
  return paycom !== null && paycom.page === 'posting' ? paycom.family : null;
}
// ── end jr7 CHAIN-7 ──

/** The origin of the chain subframes an application page frames (iCIMS's IForm page: https://<co>.icims.com for
 *  careers-<co>.icims.com), or null where its pages frame none. */
export function chainChildOrigin(url: URL): string | null {
  if (!plain(url)) return null;
  const portal = ICIMS_PORTAL.exec(url.hostname.toLowerCase());
  return portal === null ? null : `https://${portal[1]}.icims.com`;
}

/** The hash an address is compared by (a top frame's referrer against the claimed page's own address): the first 16
 *  hex digits of the SHA-256 of the address without its fragment. Never the address. Null for an empty or unreadable
 *  one. */
export function hrefHash(href: string): string | null {
  if (href === '') return null;
  try {
    const url = new URL(href);
    url.hash = '';
    return sha256Hex(url.href).slice(0, 16);
  } catch {
    return null;
  }
}
