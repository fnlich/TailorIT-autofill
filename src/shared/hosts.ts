/*
 * The one list of applicant-tracking hosts the extension works on. The manifest's content script and host permissions,
 * the worker's sender check and the frame registry all read it, so a host can never be matched in one place and missed
 * in another. Greenhouse's EU hosts are added once a real posting confirms them; SmartRecruiters later. Workable's
 * application host joined in v3 Phase 7a; its job-search site (jobs.workable.com) and the addresses that only redirect
 * to the application host (<account>.workable.com/j/..., www.workable.com/j/...) are not matched.
 * v3 Phase 7b (the public capture of 2026-11-04/05, docs/FIXTURES.md): iCIMS, Taleo, SuccessFactors and Oracle Recruiting
 * Cloud. A Chrome match pattern can wildcard only a host's first labels (never "careers-*" or "career*"), so each is
 * matched by its domain, and HOST_PLATFORMS names the platform of the candidate hosts alone; on every other host of
 * those domains the content script stays dormant (no platform, so no application, no launcher and no run):
 * - iCIMS: https://*.icims.com/*; the platform of a company's portal (careers-<co>.icims.com, <co>.icims.com), never
 *   www, api, login (iCIMS's own Auth0 sign-in, which names no job) or an employees' internal-<co> portal;
 * - Taleo: https://*.taleo.net/*; the platform of a company's portal, <co>.taleo.net, never www, and never Taleo
 *   Business Edition (<co>.tbe.taleo.net, another product, not studied);
 * - SuccessFactors: https://*.successfactors.com/* and .eu; the platform of the career sites alone, career<n>
 *   (performancemanager<n>, api and the rest are not); its Career Site Builder domains and sapsf.com wait for Phase 8;
 * - Oracle Recruiting Cloud: a content script matched by path, https://*.oraclecloud.com/hcmUI/CandidateExperience/*,
 *   whose host permission Chrome reads as all of oraclecloud.com (Chrome drops a host permission's path: docs/PRIVACY.md
 *   says so); the platform of a Fusion Applications tenant's candidate pages, <tenant>.fa.<region>.oraclecloud.com and
 *   the region-less <tenant>.fa.oraclecloud.com under /hcmUI/CandidateExperience/, never the tenant's other pages (an
 *   employee's Fusion applications), Object Storage or another Oracle Cloud service.
 */
import type { Platform } from '../core/enums';

/** Chrome match patterns, one per ATS host (Oracle's by its candidate pages' path). */
export const ATS_MATCHES = [
  'https://job-boards.greenhouse.io/*',
  'https://boards.greenhouse.io/*',
  'https://jobs.lever.co/*',
  'https://jobs.eu.lever.co/*',
  'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkdaysite.com/*',
  'https://apply.workable.com/*',
  'https://*.icims.com/*',
  'https://*.taleo.net/*',
  'https://*.successfactors.com/*',
  'https://*.successfactors.eu/*',
  'https://*.oraclecloud.com/hcmUI/CandidateExperience/*',
] as const;

/** The candidate hosts of each platform; Oracle's candidate pages also by their path (ORACLE_CANDIDATE_PATH). */
const HOST_PLATFORMS: ReadonlyArray<{ host: RegExp; platform: Platform }> = [
  { host: /^(?:job-)?boards\.greenhouse\.io$/, platform: 'greenhouse' },
  { host: /^jobs\.(?:eu\.)?lever\.co$/, platform: 'lever' },
  { host: /^jobs\.ashbyhq\.com$/, platform: 'ashby' },
  // A tenant's own host, <tenant>.wd<n>.myworkdayjobs.com or <tenant>.myworkdayjobs.com, and the shared
  // wd<n>.myworkdaysite.com: the hosts workday/url.ts reads (the v3 Phase 6/7b review, C1).
  { host: /^(?:(?!(?:www|wd\d{1,3})\.)[a-z0-9-]+\.(?:wd\d{1,3}\.)?myworkdayjobs|wd\d{1,3}\.myworkdaysite)\.com$/,
    platform: 'workday' },
  { host: /^apply\.workable\.com$/, platform: 'workable' },
  { host: /^(?!(?:www|api|login)\.)(?!internal-)[a-z0-9-]+\.icims\.com$/, platform: 'icims' },
  { host: /^(?!www\.)[a-z0-9-]+\.taleo\.net$/, platform: 'taleo' },
  { host: /^career\d{0,3}\.successfactors\.(?:com|eu)$/, platform: 'successfactors' },
  { host: /^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/, platform: 'oracle' },
];

/** The path every Oracle Recruiting Cloud candidate page is under (its content script's match): a tenant's other
 *  pages (an employee's Fusion applications, /fscmUI/...) are no platform's (the v3 Phase 6/7b review, S10). */
const ORACLE_CANDIDATE_PATH = '/hcmUI/CandidateExperience/';

/** The platform of an https address on one of the ATS hosts (Oracle's under its candidate pages' path), else null. */
export function platformOfUrl(url: string): Platform | null {
  const match = /^https:\/\/([^/?#:]+)(?::443)?([/?#].*)?$/is.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const platform = HOST_PLATFORMS.find((entry) => entry.host.test(host))?.platform ?? null;
  if (platform !== 'oracle') return platform;
  const path = (match[2] ?? '').split(/[?#]/, 1)[0]!;
  return path.startsWith(ORACLE_CANDIDATE_PATH) ? platform : null;
}
