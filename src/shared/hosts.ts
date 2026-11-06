/*
 * The one list of applicant-tracking hosts the extension works on. The manifest's content script and host permissions,
 * the worker's sender check and the frame registry all read it, so a host can never be matched in one place and missed
 * in another. Greenhouse's EU hosts are added once a real posting confirms them; SmartRecruiters later. Workable's
 * application host joined in v3 Phase 7a; its job-search site (jobs.workable.com) and the addresses that only redirect
 * to the application host (<account>.workable.com/j/..., www.workable.com/j/...) are not matched.
 * v3 Phase 7b (the public capture of 2026-11-04/05, docs/FIXTURES.md): iCIMS, Taleo, SuccessFactors and Oracle Recruiting
 * Cloud. v3 Phase 8 adds the company career sites at the end, never as a static match (the optional host permission
 * and the sentinel's registration), LinkedIn excluded. A Chrome match pattern can wildcard only a host's first labels
 * (never "careers-*" or "career*"), so each is matched by its domain, and HOST_PLATFORMS names the platform of the candidate
 * hosts alone; on every other host of those domains the content script stays dormant (no platform, so no application,
 * no launcher and no run):
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

/** Whether the manifest's static content script runs at an address (one of ATS_MATCHES matches it: a host as written
 *  or under a `*.` domain, the path's prefix), whatever its platform: v3 Phase 8's company pages are every other https
 *  page, so an ATS domain's other hosts (an employee's SuccessFactors, iCIMS's login) stay as dormant as before. */
export function onAtsMatch(url: string): boolean {
  const match = /^https:\/\/([^/?#:]+)(?::443)?(\/[^?#]*)?/i.exec(url);
  if (!match) return false;
  const host = match[1]!.toLowerCase();
  const path = match[2] ?? '/';
  return ATS_MATCHES.some((pattern) => {
    const [, patternHost, patternPath] = /^https:\/\/([^/]+)(\/.*)$/.exec(pattern)!;
    const hostFits = patternHost!.startsWith('*.') ? host === patternHost!.slice(2) || host.endsWith(patternHost!.slice(1))
      : host === patternHost;
    return hostFits && path.startsWith(patternPath!.replace(/\*$/, ''));
  });
}

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

// ── v3 Phase 8: company career sites (docs/SPEC-AMENDMENTS.md §12 Decision 13) ─────────────────────────────────────
// Nothing below is a static match: the manifest asks for none of these hosts. The person turns "Company career sites"
// on in Options, which asks Chrome for the optional host permission on their click; the worker then registers a
// dormant sentinel (src/entrypoints/sentinel.ts) with chrome.scripting.registerContentScripts, in the top frame only,
// and injects the content script into a frame the sentinel recognised, once it has checked the frame's address again
// itself. LinkedIn is deferred to v5 by the owner (2026-11-06): nothing of the extension runs on any LinkedIn host,
// even with every https page granted, nor on an employee HR system's (HR_HOST_MATCHES).

/** Every https page: the company career sites' registration, the ATS hosts, LinkedIn and the HR systems excluded. */
export const SITES_MATCH = 'https://*/*';
/** The manifest's optional host permissions (never <all_urls>: http, file and TailorIT's own http origin stay out). */
export const OPTIONAL_HOST_PERMISSIONS = [SITES_MATCH] as const;
/** LinkedIn's hosts, which the career sites' registration excludes: linkedin.com and every host under it (`*.` covers
 *  linkedin.com itself), its China site and its short-link and static hosts. */
export const LINKEDIN_HOST_MATCHES = ['https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*',
  'https://*.licdn.com/*'] as const;
/** The sentinel's bundle (src/entrypoints/sentinel.ts, an unlisted script WXT writes at the build's root). */
export const SENTINEL_FILE = 'sentinel.js';
/** The content script's bundle (src/entrypoints/content-script.ts, likewise): the manifest's static script on the ATS
 *  hosts, and the one the worker injects into a frame the sentinel recognised. */
export const CONTENT_SCRIPT_FILE = 'content-script.js';
/** The sentinel's registration's id. */
export const SITES_REGISTRATION_ID = 'tailorit-sites';

/** One dynamic content script, as chrome.scripting.registerContentScripts takes it. */
export interface SiteRegistration {
  id: string;
  js: string[];
  matches: string[];
  excludeMatches?: string[];
  allFrames: false;
  runAt: 'document_idle';
  persistAcrossSessions: true;
  world: 'ISOLATED';
}

/** The sentinel's registrations (pure: the worker reconciles Chrome's to these, and check-build holds them): none while
 *  the company career sites are off; while on, one, on every https page but the ATS hosts (whose own content script
 *  runs there), LinkedIn's and the employee HR systems', in the top frame only (never an ad's or an anti-bot frame),
 *  once the page is loaded. */
export function registrationsFor(on: { sites: boolean }): SiteRegistration[] {
  if (!on.sites) return [];
  return [{ id: SITES_REGISTRATION_ID, js: [SENTINEL_FILE], matches: [SITES_MATCH],
    excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES], allFrames: false, runAt: 'document_idle',
    persistAcrossSessions: true, world: 'ISOLATED' }];
}

/** Whether a host is `domain` or under it, in lower case and with trailing dots dropped. */
function under(host: string, domains: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.+$/, '');
  return domains.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** Whether a host is LinkedIn's (linkedin.com and every host under it, linkedin.cn, lnkd.in, licdn.com: the hosts
 *  LINKEDIN_HOST_MATCHES excludes), in lower case and with trailing dots dropped. Nothing of the extension runs there. */
export function isLinkedInHost(host: string): boolean {
  return under(host, ['linkedin.com', 'linkedin.cn', 'lnkd.in', 'licdn.com']);
}

/** The employee HR systems' hosts, which the career sites' registration excludes too (the Phase 8 review, B4): an
 *  employer's own Oracle Fusion (all of oraclecloud.com: its candidate pages, /hcmUI/CandidateExperience/, are an ATS
 *  match served by the static content script), Workday's employee tenants (myworkday.com; candidates are on
 *  myworkdayjobs.com) and SAP SuccessFactors' employee hosts (sapsf.com, sapsf.eu; successfactors.eu is an ATS match).
 *  The principle: a system where a person works for their employer never gets the sentinel, nor the content script. */
export const HR_HOST_MATCHES = ['https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*',
  'https://*.sapsf.eu/*'] as const;

/** Whether a host is an employee HR system's (HR_HOST_MATCHES), in lower case and with trailing dots dropped. */
export function isHrHost(host: string): boolean {
  return under(host, ['oraclecloud.com', 'myworkday.com', 'sapsf.com', 'sapsf.eu']);
}

/** A company's own page as the career sites reach it: https, where the static content script never runs (no ATS match:
 *  an ATS domain's other hosts stay dormant), and neither LinkedIn's nor an employee HR system's. The sentinel's
 *  recognition, the worker's check before it injects and the site adapter all read this one rule. */
export function isCompanySiteUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && !onAtsMatch(parsed.href) && !isLinkedInHost(parsed.hostname)
    && !isHrHost(parsed.hostname);
}

/** A company's own careers site, read by its host and the paths of its postings and application pages (the read-only
 *  capture of 2026-11-04): a recognition signal for the sentinel only, never a match. Tesla's (Akamai answered 403)
 *  is read from its public addresses alone, unverified. */
export interface CareerSite {
  name: string;
  host: RegExp;
  paths: readonly RegExp[];
}

export const CAREER_SITES: readonly CareerSite[] = [
  // amazon.jobs/en/jobs/<id>; /applicant/jobs/<id>/apply (then Amazon's sign-in).
  { name: 'amazon', host: /^(?:www\.)?amazon\.jobs$/, paths: [/^\/[a-z]{2}(?:-[a-z]{2})?\/jobs\/\d+/i,
    /^\/applicant\/jobs\/\d+\/apply/] },
  // jobs.apple.com/en-us/details/<id>; /app/en-us/apply/<id> (then an Apple ID sign-in).
  { name: 'apple', host: /^jobs\.apple\.com$/, paths: [/^\/[a-z]{2}-[a-z]{2}\/details\/[\w-]+/i,
    /^\/app\/[a-z]{2}-[a-z]{2}\/apply\/[\w-]+/i] },
  // google.com/about/careers/applications/jobs/results/<id>; /about/careers/applications/apply?jobId=.
  { name: 'google', host: /^(?:www\.)?google\.com$/, paths: [/^\/about\/careers\/applications\/jobs\/results\/\d+/,
    /^\/about\/careers\/applications\/apply/] },
  // metacareers.com/profile/job_details/<id>; /profile/create_application/<id>.
  { name: 'meta', host: /^(?:www\.)?metacareers\.com$/, paths: [/^\/profile\/job_details\/\d+/,
    /^\/profile\/create_application\/\d+/, /^\/jobs\/\d+/] },
  // careers.walmart.com/us/en/jobs/R-<n>; its apply and contact-details (email gate) screens.
  { name: 'walmart', host: /^careers\.walmart\.com$/, paths: [/^\/(?:[a-z]{2}\/[a-z]{2}\/)?jobs\/(?:R-\d+|apply|contact-details)/i] },
  // lifeattiktok.com/search/<id>; careers.tiktok.com/resume/<id>/apply.
  { name: 'tiktok', host: /^(?:lifeattiktok\.com|careers\.tiktok\.com)$/, paths: [/^\/search\/\d+/, /^\/resume\/\d+\/apply/] },
  // tesla.com/careers/search/job/<slug>-<id> and /careers/search/job/apply/<id> (unverified).
  { name: 'tesla', host: /^(?:www\.)?tesla\.com$/, paths: [/^\/(?:[a-z]{2}_[a-z]{2}\/)?careers\/search\/job\/[\w-]+/i] },
];

/** The career site whose posting or application page an https address shows, else null. */
export function careerSiteOf(url: string): CareerSite | null {
  const match = /^https:\/\/([^/?#:]+)(?::443)?(\/[^?#]*)?/i.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const path = match[2] ?? '/';
  return CAREER_SITES.find((site) => site.host.test(host) && site.paths.some((pattern) => pattern.test(path))) ?? null;
}
