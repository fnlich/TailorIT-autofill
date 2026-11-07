/*
 * The one list of applicant-tracking hosts the extension works on. The manifest's content script and host permissions,
 * the worker's sender check and the frame registry all read it, so a host can never be matched in one place and missed
 * in another. Greenhouse's EU hosts are added once a real posting confirms them; SmartRecruiters joined with the
 * owner's snapshots of 2026-11-06 (below). Workable's
 * application host joined in v3 Phase 7a; the addresses that only redirect to it (<account>.workable.com/j/...,
 * www.workable.com/j/...) are not matched. Its job-search site, jobs.workable.com, joined with the owner's captures of
 * 2026-11-06 (snapshot build, boards: its /view/<id>/<slug> pages show the application form in a dialog; workable/url.ts).
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
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - Oracle Recruiting Cloud on Oracle's government cloud: the owner's snapshots of a tenant on
 *   <tenant>.fa.ocs.oraclegovcloud.com show the same Candidate Experience application (its /hcmUI/CandidateExperience/
 *   path, its apply flow, its Knockout and Oracle JET markup), matched by path as the commercial cloud's is, by
 *   https://*.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/* (whose host permission Chrome reads as every host
 *   under fa.ocs.oraclegovcloud.com); the rest of oraclegovcloud.com is an employee HR system (HR_HOST_MATCHES);
 * - SmartRecruiters: https://jobs.smartrecruiters.com/*, its postings and its one-click application; its companies'
 *   careers.smartrecruiters.com is not matched (no snapshot shows a posting or an application there).
 * The new ATSs of the owner's snapshots of 2026-11-06 (DESIGN-NEW-ATS §4, Phase 0): a static match each, path-scoped
 * wherever the host serves anything but candidate pages (HOST_PLATFORMS' `paths`: the platform is null on the host's
 * other paths, so the content script stays dormant there). The paths are the ones the snapshots show and no wider.
 * Paycom waits for its snapshots (no match, only its HR exclusion) and DFIN (a company's own host) stays a career
 * site. Chrome reads a host permission without its path, so the path-scoped hosts' permission covers the whole host,
 * as Oracle's does (docs/PRIVACY.md).
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
  // Snapshot build, boards (2026-11-06): Workable's job-search site, whose posting pages hold the form.
  'https://jobs.workable.com/*',
  'https://*.icims.com/*',
  'https://*.taleo.net/*',
  'https://*.successfactors.com/*',
  'https://*.successfactors.eu/*',
  'https://*.oraclecloud.com/hcmUI/CandidateExperience/*',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud, SmartRecruiters ──
  'https://*.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/*',
  'https://jobs.smartrecruiters.com/*',
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0): each snapshot's host, by its candidate paths where the host is shared ──
  'https://jobs.jobvite.com/*',
  'https://*.applytojob.com/apply/*',
  'https://ats.rippling.com/*',
  'https://*.breezy.hr/p/*',
  'https://*.careerplug.com/jobs/*',
  'https://*.pinpointhq.com/en/postings/*',
  'https://recruitingbypaycor.com/career/*',
  'https://*.careers.hibob.com/*',
  'https://recruiting.ultipro.com/*',
  'https://jobs.dayforcehcm.com/*',
  'https://recruiting.paylocity.com/Recruiting/*',
  'https://www.dice.com/job-applications/*',
  'https://*.clearcompany.com/careers/*',
  'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/*',
  'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/*',
  'https://*.bamboohr.com/careers/*',
  // ── end New ATSs ──
] as const;

/** The candidate hosts of each platform; on a host that also serves other pages, its candidate pages by their paths
 *  (`paths`: the path must start with one of them, else the address is no platform's). */
const HOST_PLATFORMS: ReadonlyArray<{ host: RegExp; platform: Platform; paths?: readonly string[] }> = [
  { host: /^(?:job-)?boards\.greenhouse\.io$/, platform: 'greenhouse' },
  { host: /^jobs\.(?:eu\.)?lever\.co$/, platform: 'lever' },
  { host: /^jobs\.ashbyhq\.com$/, platform: 'ashby' },
  // A tenant's own host, <tenant>.wd<n>.myworkdayjobs.com or <tenant>.myworkdayjobs.com, and the shared
  // wd<n>.myworkdaysite.com: the hosts workday/url.ts reads (the v3 Phase 6/7b review, C1).
  { host: /^(?:(?!(?:www|wd\d{1,3})\.)[a-z0-9-]+\.(?:wd\d{1,3}\.)?myworkdayjobs|wd\d{1,3}\.myworkdaysite)\.com$/,
    platform: 'workday' },
  // Snapshot build, boards (2026-11-06): jobs.workable.com beside apply.workable.com.
  { host: /^(?:apply|jobs)\.workable\.com$/, platform: 'workable' },
  { host: /^(?!(?:www|api|login)\.)(?!internal-)[a-z0-9-]+\.icims\.com$/, platform: 'icims' },
  { host: /^(?!www\.)[a-z0-9-]+\.taleo\.net$/, platform: 'taleo' },
  { host: /^career\d{0,3}\.successfactors\.(?:com|eu)$/, platform: 'successfactors' },
  // Every Oracle Recruiting Cloud candidate page is under /hcmUI/CandidateExperience/ (its content script's match): a
  // tenant's other pages (an employee's Fusion applications, /fscmUI/...) are no platform's (the v3 Phase 6/7b review,
  // S10).
  { host: /^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/, platform: 'oracle', paths: ['/hcmUI/CandidateExperience/'] },
  // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud, SmartRecruiters ──
  { host: /^[a-z0-9-]+\.fa\.ocs\.oraclegovcloud\.com$/, platform: 'oracle',
    paths: ['/hcmUI/CandidateExperience/'] },
  { host: /^jobs\.smartrecruiters\.com$/, platform: 'smartrecruiters' },
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0): the snapshots' hosts (jobvite-0..7, jazzhr-0..4, rippling-0..4,
  // breezy-0..1, careerplug-0..1, pinpoint-0..2, paycor-0, hibob-0, ultipro-0..2, dayforce-0..2, paylocity-0..2,
  // dice-0..8, clearcompany-0..8, adp-0..6, bamboohr-0..2), each path the snapshots show and no wider. Pinpoint's app.
  // host serves its own sign-in images, ClearCompany's cc-app-static. and cc-client-cdn. its files.
  { host: /^jobs\.jobvite\.com$/, platform: 'jobvite' },
  { host: /^(?!www\.)[a-z0-9-]+\.applytojob\.com$/, platform: 'jazzhr', paths: ['/apply/'] },
  { host: /^ats\.rippling\.com$/, platform: 'rippling' },
  { host: /^[a-z0-9-]+\.breezy\.hr$/, platform: 'breezy', paths: ['/p/'] },
  // The security fix of 2026-11-06 (S5): app.careerplug.com is CareerPlug's employers' host (HR_HOST_MATCHES), no
  // tenant's candidate host.
  { host: /^(?!app\.)[a-z0-9-]+\.careerplug\.com$/, platform: 'careerplug', paths: ['/jobs/'] },
  { host: /^(?!app\.)[a-z0-9-]+\.pinpointhq\.com$/, platform: 'pinpoint', paths: ['/en/postings/'] },
  { host: /^recruitingbypaycor\.com$/, platform: 'paycor', paths: ['/career/'] },
  { host: /^[a-z0-9-]+\.careers\.hibob\.com$/, platform: 'hibob' },
  { host: /^recruiting\.ultipro\.com$/, platform: 'ultipro' },
  { host: /^jobs\.dayforcehcm\.com$/, platform: 'dayforce' },
  { host: /^recruiting\.paylocity\.com$/, platform: 'paylocity', paths: ['/Recruiting/'] },
  { host: /^www\.dice\.com$/, platform: 'dice', paths: ['/job-applications/'] },
  { host: /^(?!cc-)[a-z0-9-]+\.clearcompany\.com$/, platform: 'clearcompany', paths: ['/careers/'] },
  { host: /^workforcenow\.adp\.com$/, platform: 'adp',
    paths: ['/mascsr/default/mdf/recruitment/', '/mascsr/applicant/mdf/recruitment/'] },
  { host: /^[a-z0-9-]+\.bamboohr\.com$/, platform: 'bamboohr', paths: ['/careers/'] },
  // ── end New ATSs ──
];

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

/** The platform of an https address on one of the ATS hosts (a path-scoped host's under one of its candidate paths,
 *  as written: Chrome's match patterns compare paths case-sensitively), else null. */
export function platformOfUrl(url: string): Platform | null {
  const match = /^https:\/\/([^/?#:]+)(?::443)?([/?#].*)?$/is.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const entry = HOST_PLATFORMS.find((each) => each.host.test(host));
  if (entry === undefined) return null;
  if (entry.paths === undefined) return entry.platform;
  const path = (match[2] ?? '').split(/[?#]/, 1)[0]!;
  return entry.paths.some((prefix) => path.startsWith(prefix)) ? entry.platform : null;
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
 *  DESIGN-NEW-ATS §4 (Phase 0): ADP Workforce Now's host, BambooHR's and ClearCompany's tenant hosts, and Paycom's,
 *  each of which serves employees beside its candidate paths (those paths are static ATS matches; Paycom's waits for
 *  its snapshots). The snapshot build of 2026-11-06 (oracle-sf-sr): Oracle Fusion on Oracle's government cloud too
 *  (all of oraclegovcloud.com; its candidate pages are an ATS match, as the commercial cloud's are).
 *  The security fix of 2026-11-06 (S5): the new ATS vendors' own domains, each of which serves an employee HR system
 *  (Dayforce's www.dayforcehcm.com/mydayforce, UKG Pro's <n>.ultipro.com and ukg.net, Paylocity's access., Paycor's
 *  secure., Rippling's app., HiBob's app. and ADP's my.), and CareerPlug's employers' host app.careerplug.com. Their
 *  candidate hosts (jobs.dayforcehcm.com, recruiting.ultipro.com, recruiting.paylocity.com, ats.rippling.com,
 *  <co>.careers.hibob.com, workforcenow.adp.com's recruitment paths) stay static ATS matches: a static content script
 *  has no exclusions (scripts/check-build.mjs refuses exclude_matches), so this list keeps only the sentinel off them.
 *  The principle: a system where a person works for their employer never gets the sentinel, nor the content script. */
export const HR_HOST_MATCHES = ['https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*',
  'https://*.sapsf.eu/*',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud ──
  'https://*.oraclegovcloud.com/*',
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0) ──
  'https://workforcenow.adp.com/*', 'https://*.bamboohr.com/*', 'https://www.paycomonline.net/*',
  'https://*.clearcompany.com/*',
  // ── end New ATSs ──
  // ── The security fix of 2026-11-06 (S5): the new ATS vendors' employee systems ──
  'https://*.dayforcehcm.com/*', 'https://*.ultipro.com/*', 'https://*.ukg.net/*', 'https://*.paylocity.com/*',
  'https://*.paycor.com/*', 'https://*.rippling.com/*', 'https://*.hibob.com/*', 'https://*.adp.com/*',
  'https://app.careerplug.com/*',
  // ── end of the security fix's block (S5) ──
] as const;

/** The HR_HOST_MATCHES written for one host (no `*.`): that host alone, never one under it. */
const HR_HOSTS_EXACT: readonly string[] = ['workforcenow.adp.com', 'www.paycomonline.net',
  // ── The security fix of 2026-11-06 (S5) ──
  'app.careerplug.com'];

/** Whether a host is an employee HR system's (HR_HOST_MATCHES), in lower case and with trailing dots dropped. */
export function isHrHost(host: string): boolean {
  return under(host, ['oraclecloud.com', 'myworkday.com', 'sapsf.com', 'sapsf.eu', 'bamboohr.com', 'clearcompany.com',
    // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
    'oraclegovcloud.com',
    // ── The security fix of 2026-11-06 (S5) ──
    'dayforcehcm.com', 'ultipro.com', 'ukg.net', 'paylocity.com', 'paycor.com', 'rippling.com', 'hibob.com', 'adp.com'])
    || HR_HOSTS_EXACT.includes(host.toLowerCase().replace(/\.+$/, ''));
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
