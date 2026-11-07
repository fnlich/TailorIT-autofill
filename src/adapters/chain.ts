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
}

/** SuccessFactors' career sites (successfactors/url.ts HOST). */
const SF_HOST = /^career\d{0,3}\.successfactors\.(?:com|eu)$/;
/** An iCIMS portal's host as the IForm snapshots show it, careers-<co>, uscareers-<co> or us-careers-<co>, and the
 *  forms host <co>.icims.com that frames its IForms' own forms. */
const ICIMS_PORTAL = /^(?:careers|uscareers|us-careers)-([a-z0-9-]+)\.icims\.com$/;
const ICIMS_FORMS = /^(?!(?:www|api|login|careers-|uscareers-|us-careers-|internal-))([a-z0-9-]+)\.icims\.com$/;

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
  const portal = ICIMS_PORTAL.exec(host);
  if (portal !== null) return `icims:${portal[1]}`;
  const forms = ICIMS_FORMS.exec(host);
  return forms === null ? null : `icims:${forms[1]}`;
}

/** Whether an address is a chain page (module header), and how; null otherwise. */
export function chainPageOf(url: URL): ChainPage | null {
  if (!plain(url)) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname.slice(0, -1) : url.pathname;
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
  return null;
}

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
