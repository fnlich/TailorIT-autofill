/*
 * SuccessFactors' addresses (its classic career sites), read without the DOM: whether an address is SuccessFactors',
 * which posting and which of its pages it shows, and the canonical application URL the application key is hashed from.
 * From the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; two sites, on career2.successfactors.eu and career10.successfactors.com):
 * - every page is /career, told apart by its query: the posting is
 *   ?career_job_req_id=<id>&career_ns=job_listing&company=<co> (with lang, rcm_site_locale or selected_lang);
 * - its Sign In link keeps the job: ?career_company=<co>&company=<co>&loginFlowRequired=true&career_job_req_id=<id>;
 *   Create an account and Forgot your password are ?company=<co>&login_ns=register (or forgot_pwd)&career_job_req_id=<id>,
 *   each with per-load tokens (_s.crb, requestParams) that name nothing a key needs;
 * - Apply, and every view's own button, post the page (/career?_s.crb=<token>), whose address then names no job: such a
 *   page is no application of ours. What follows the sign-in (career_ns=job_application, Jobright's reading) is not
 *   public: an address that names the job and is no posting is read as its application.
 * The key is the host, the company as written and the requisition id: the posting, its account pages and its form share
 * one; the tokens (_s.crb, requestParams, jobSecKey), the language and the site are dropped. The canonical application
 * URL is https://<host>/career?company=<co>&career_job_req_id=<id>&career_ns=job_listing. The Career Site Builder's own
 * domains (jobs.<co>.com) and sapsf.com wait for Phase 8. TailorIT's parseAtsUrl reads the same posting since its
 * API 5 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** The career sites alone: career<n>.successfactors.com or .eu (src/shared/hosts.ts). */
const HOST = /^career\d{0,3}\.successfactors\.(?:com|eu)$/;
const COMPANY = /^[A-Za-z0-9_-]{1,60}$/;
const REQ_ID = /^\d{1,12}$/;

/** Whether an address is on a SuccessFactors career site, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && HOST.test(url.hostname);
}

/** The posting an address shows and which page of it, or null when it shows none (a list, a page after a post). */
export function parseSuccessFactorsUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url) || (url.pathname !== '/career' && url.pathname !== '/career/')) return null;
  const query = url.searchParams;
  const company = query.get('company') ?? query.get('career_company');
  const id = query.get('career_job_req_id');
  if (company === null || id === null || !COMPANY.test(company) || !REQ_ID.test(id)) return null;
  const login = (query.get('login_ns') ?? '') !== '' || query.get('loginFlowRequired') === 'true';
  const posting = query.get('career_ns') === 'job_listing' && !login;
  return { platform: 'successfactors', board: company, jobId: id, page: posting ? 'posting' : 'application',
    applicationUrl: `https://${url.hostname}/career?company=${company}&career_job_req_id=${id}&career_ns=job_listing` };
}

/** The canonical application URL when the address shows the application (an account page, the form); null on the
 *  posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseSuccessFactorsUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
