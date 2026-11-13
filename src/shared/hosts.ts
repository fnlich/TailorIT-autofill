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
 * Paycom waited for its snapshots (no match, only its HR exclusion; matched since jr7, below) and DFIN (a company's
 * own host) stays a career site. Chrome reads a host permission without its path, so the path-scoped hosts'
 * permission covers the whole host, as Oracle's does (docs/PRIVACY.md).
 * v5 p2-detect (the engine audit's gap 1a; each from Jobright's site list, read as its behaviour, never its code): the
 * address variants of platforms already here, each read by that platform's own url.ts: a Workday tenant's
 * implementation host (<tenant>[.wd<n>].myworkdayjobs-impl.com); Pinpoint's postings under any locale or none
 * (PINPOINT_PATH); Paylocity's /recruiting/ in lower case; UKG's other recruiting hosts, recruiting2.ultipro.com and
 * recruiting.ultipro.ca (whole, as recruiting.ultipro.com) and <x>.rec.pro.ukg.net, on its job boards' paths alone
 * (/<tenant>/JobBoard/, ULTIPRO_BOARD_PATH; the P2 review's security 2: never another <n>.ultipro.com or ultipro.ca host,
 * an employer's UKG Pro for its staff, and never any other ukg.net host:
 * each of those domains also serves an employee HR system, which stays no platform's, and HR_HOST_MATCHES keeps the
 * sentinel off all of them); and CareerPlug's partner domains, sfagentjobs.com, sfagentcareers.com and
 * apscareerportal.com (CAREERPLUG_PARTNER_HOST), under /jobs/. A `*` inside a pattern's path is read as Chrome reads it
 * (onAtsMatch). Not added, each for its reason (the phase notes): Workday's myworkday.com and SuccessFactors' sapsf.com
 * (employee systems; sapsf.com's career hosts are in no capture), Oracle on a company's own domain (a static match on
 * every host's /hcmUI/CandidateExperience/ would reach LinkedIn's, which no static script may), rippling-ats.com
 * (HiringThing's white-label, not Rippling's application), Breezy's other /apply paths, ADP MyJobs and
 * recruiting.adp.com, Dayforce's sign-in pages, ClearCompany's hrmdirect.com and smartr.me (other applications or
 * redirects, none in any snapshot). SUBMIT_WATCH_MATCHES names where the page-world submit watcher runs.
 * jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3; the owner's snapshot7 of 2026-11-11, each from its verified audit spec): UKG
 * Ready (UKGR-2, corrected), Paycom (PC7-02), JobDiva and Eightfold (JDEF-12) and Jibe (ICIMS7-11), each a static match
 * on its candidate paths alone, its platform null on every other path of the host, so the content script stays dormant
 * there. Four of them serve employees beside candidates, so their domains (UKG Ready's saashr.com, JobDiva's
 * jobdiva.com, Eightfold's eightfold.ai: its recruiters' app. host and every company's /careerhub/, employees' internal
 * mobility) or host (Paycom's www.paycomonline.net, there already) join HR_HOST_MATCHES and isHrHost: the sentinel and
 * a company page's content script never reach them; only the static match runs, on the candidate paths. Jibe is iCIMS's
 * candidate front, no employee system: its pages off /jobs/ stay company pages. paycomonline.com and Eightfold on an
 * employer's own domain (EFA-14) wait for captures.
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
  // ── v5 p2-detect: address variants of platforms already here (the engine audit's gap 1a; module header) ──
  'https://*.myworkdayjobs-impl.com/*',
  'https://*.pinpointhq.com/*/postings/*',
  'https://*.pinpointhq.com/postings/*',
  'https://recruiting.paylocity.com/recruiting/*',
  // The P2 review (security 2): UKG's recruiting hosts by name, never <n>.ultipro.com or ultipro.ca's employee portals.
  'https://recruiting2.ultipro.com/*',
  'https://recruiting.ultipro.ca/*',
  'https://*.rec.pro.ukg.net/*/JobBoard/*',
  'https://*.sfagentjobs.com/jobs/*',
  'https://*.sfagentcareers.com/jobs/*',
  'https://*.apscareerportal.com/jobs/*',
  // ── end v5 p2-detect ──
  // ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3): the snapshot7 platforms' candidate paths (module header) ──
  // UKG Ready (UKGR-2): a company's careers page, /ta/<company>.careers (its postings ?ShowJob=, its application session
  // ?ActiveSessionId=), never /ta/<company>.login or .home, the employee system's.
  'https://*.saashr.com/ta/*.careers*',
  // Paycom (PC7-02): the candidate portal under its client key, never /v4/ee/ (employees) or /v4/cl/ (clients).
  'https://www.paycomonline.net/v4/ats/web.php/portal/*',
  // JobDiva (JDEF-12, the jdef audit §6.1): its candidate portal, /portal/ (Jobright's pattern).
  'https://*.jobdiva.com/portal/*',
  // Eightfold (JDEF-12, §7.1): a company's careers site, /careers (its postings, /careers/apply, the success page).
  'https://*.eightfold.ai/careers*',
  // Jibe (ICIMS7-11): a customer's posting, /jobs/<id>.
  'https://*.jibeapply.com/jobs/*',
  // ── end jr7 ENGINE-7 E0 ──
] as const;

// ── v5 p2-detect: the page-world submit watcher's hosts (entrypoints/submit-watch.content.ts, PLAN decision 14) ──
/** Where the submit watcher's script is matched (world MAIN, from document_start): Workday's, ClearCompany's, Oracle
 *  Recruiting Cloud's and SuccessFactors' candidate hosts as ATS_MATCHES names them, and no other; it installs only
 *  where the page-world bridge would (adapters/bridge-address.ts) and on those platforms' pages
 *  (dom/submit-net-protocol.ts NET_PLATFORMS). */
export const SUBMIT_WATCH_MATCHES = ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*',
  'https://*.myworkdayjobs-impl.com/*', 'https://*.clearcompany.com/careers/*',
  'https://*.oraclecloud.com/hcmUI/CandidateExperience/*',
  'https://*.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/*', 'https://*.successfactors.com/*',
  'https://*.successfactors.eu/*'] as const;

// ── v5 p2-detect: the address variants' own readings (each platform's url.ts reads the same) ──
/** Pinpoint's posting paths: /<locale>/postings/ (en, de, fr-ca...) or /postings/. */
export const PINPOINT_PATH = /^\/(?:[A-Za-z]{2}(?:[-_][A-Za-z]{2})?\/)?postings\//;
/** A UKG job board's paths on <x>.rec.pro.ukg.net: /<tenant>/JobBoard/. */
export const ULTIPRO_BOARD_PATH = /^\/[A-Za-z0-9_-]{1,64}\/JobBoard\//;
/** CareerPlug's partner domains, each host under them (Jobright reads them as CareerPlug's). */
export const CAREERPLUG_PARTNER_HOST = /^(?:[a-z0-9-]+\.)*(?:sfagentjobs|sfagentcareers|apscareerportal)\.com$/;
// ── end v5 p2-detect ──

/** A platform's candidate host; on a host that also serves other pages, its candidate pages by their paths (`paths`:
 *  the path must start with one of them, else the address is no platform's). */
interface HostPlatform {
  host: RegExp;
  platform: Platform;
  paths?: readonly string[];
  /** v5 p2-detect: a candidate path no prefix can say (a locale or a tenant before it), read as written. */
  pathPattern?: RegExp;
}

/** The candidate hosts of each platform the page-world bridge can install on (jr7: every platform but those of
 *  UNBRIDGED_HOST_PLATFORMS, below). */
const HOST_PLATFORMS: readonly HostPlatform[] = [
  { host: /^(?:job-)?boards\.greenhouse\.io$/, platform: 'greenhouse' },
  { host: /^jobs\.(?:eu\.)?lever\.co$/, platform: 'lever' },
  { host: /^jobs\.ashbyhq\.com$/, platform: 'ashby' },
  // A tenant's own host, <tenant>.wd<n>.myworkdayjobs.com or <tenant>.myworkdayjobs.com, and the shared
  // wd<n>.myworkdaysite.com: the hosts workday/url.ts reads (the v3 Phase 6/7b review, C1).
  // v5 p2-detect: a tenant's implementation (pre-production) host, <tenant>[.wd<n>].myworkdayjobs-impl.com, alike
  // (Jobright's site list names the domain).
  { host: /^(?:(?!(?:www|wd\d{1,3})\.)[a-z0-9-]+\.(?:wd\d{1,3}\.)?myworkdayjobs(?:-impl)?|wd\d{1,3}\.myworkdaysite)\.com$/,
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
  // v5 p2-detect: a posting under any locale, or none (Jobright's site list: /*/postings/* and /postings/*).
  { host: /^(?!app\.)[a-z0-9-]+\.pinpointhq\.com$/, platform: 'pinpoint', pathPattern: PINPOINT_PATH },
  { host: /^recruitingbypaycor\.com$/, platform: 'paycor', paths: ['/career/'] },
  { host: /^[a-z0-9-]+\.careers\.hibob\.com$/, platform: 'hibob' },
  { host: /^recruiting\.ultipro\.com$/, platform: 'ultipro' },
  // v5 p2-detect: UKG's other recruiting hosts (recruiting2.ultipro.com, recruiting.ultipro.ca, <x>.rec.pro.ukg.net:
  // Jobright's site list), their job boards' paths alone: each domain also serves an employee HR system.
  // The P2 review (security 2): recruiting2.ultipro.com and recruiting.ultipro.ca whole (candidate-only, as
  // recruiting.ultipro.com), <x>.rec.pro.ukg.net by its job boards' paths.
  { host: /^recruiting2\.ultipro\.com$|^recruiting\.ultipro\.ca$/, platform: 'ultipro' },
  { host: /^[a-z0-9-]+\.rec\.pro\.ukg\.net$/, platform: 'ultipro', pathPattern: ULTIPRO_BOARD_PATH },
  { host: /^jobs\.dayforcehcm\.com$/, platform: 'dayforce' },
  // v5 p2-detect: /recruiting/ in lower case too (Jobright's site list and its page after submitting).
  { host: /^recruiting\.paylocity\.com$/, platform: 'paylocity', paths: ['/Recruiting/', '/recruiting/'] },
  { host: /^www\.dice\.com$/, platform: 'dice', paths: ['/job-applications/'] },
  { host: /^(?!cc-)[a-z0-9-]+\.clearcompany\.com$/, platform: 'clearcompany', paths: ['/careers/'] },
  { host: /^workforcenow\.adp\.com$/, platform: 'adp',
    paths: ['/mascsr/default/mdf/recruitment/', '/mascsr/applicant/mdf/recruitment/'] },
  { host: /^[a-z0-9-]+\.bamboohr\.com$/, platform: 'bamboohr', paths: ['/careers/'] },
  // ── end New ATSs ──
  // ── v5 p2-detect: CareerPlug's partner domains (Jobright's site list: State Farm agents' and APS's career portals) ──
  { host: CAREERPLUG_PARTNER_HOST, platform: 'careerplug', paths: ['/jobs/'] },
];

// ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3; the coordinator's decision of 2026-11-11 on the bridge's budget) ──
/** The snapshot7 platforms' candidate hosts, each by its candidate paths alone, read by platformOfUrl after
 *  HOST_PLATFORMS (no host of theirs is one of HOST_PLATFORMS'). The page-world bridge installs on none of their hosts:
 *  none is a public job host, and adapters/bridge-address.ts SHARED_DOMAIN_PARSERS holds no parser of theirs. So the
 *  page-world scripts' own lookup (bridgePlatformOfUrl) leaves this table out, and their bundles never hold it. A
 *  platform whose parser joins SHARED_DOMAIN_PARSERS moves its entry to HOST_PLATFORMS. */
const UNBRIDGED_HOST_PLATFORMS: readonly HostPlatform[] = [
  // UKG Ready (UKGR-2, corrected): secure<n>.saashr.com (secure7 in snapshot7), its careers page alone, the company part
  // the one shape seen (digits); any other path (.login, .home, a company part of another shape) is no platform's.
  { host: /^secure\d{0,2}\.saashr\.com$/, platform: 'ukgready', pathPattern: /^\/ta\/\d{3,10}\.careers$/ },
  // Paycom (PC7-02): a posting, /jobs/<n>, or the application, /applications, under the 32-hex client key; any other
  // portal path (a career page's job list) is no platform's.
  { host: /^www\.paycomonline\.net$/, platform: 'paycom',
    pathPattern: /^\/v4\/ats\/web\.php\/portal\/[A-Fa-f0-9]{32}\/(?:jobs\/\d+|applications)\/?$/ },
  // JobDiva (JDEF-12): www1 and www2 seen; the candidate portal alone.
  { host: /^www\d{0,2}\.jobdiva\.com$/, platform: 'jobdiva', paths: ['/portal/'] },
  // Eightfold (JDEF-12): a company's own <company>.eightfold.ai, never app. (recruiters) or www.; /careers alone.
  { host: /^(?!(?:app|www)\.)[a-z0-9-]+\.eightfold\.ai$/, platform: 'eightfold', paths: ['/careers'] },
  // Jibe (ICIMS7-11): a customer's <customer>.jibeapply.com, its postings alone.
  { host: /^[a-z0-9-]+\.jibeapply\.com$/, platform: 'jibe', paths: ['/jobs/'] },
];
/** The platforms of UNBRIDGED_HOST_PLATFORMS, in its order (src/adapters/jr7-bridge-lookup.test.ts holds the two
 *  lookups to them). */
export const UNBRIDGED_PLATFORMS: readonly Platform[] = ['ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe'];
// ── end jr7 ENGINE-7 E0 ──

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
    // v5 p2-detect: a `*` inside the path (Pinpoint's locale, UKG's tenant) matches any characters, as Chrome's does.
    return hostFits && globPath(patternPath!).test(path);
  });
}

// ── v5 p2-detect: Oracle Recruiting Cloud on a company's own domain (adapters/oracle/url.ts reads the same) ──
/** Its Candidate Experience's paths: /hcmUI/CandidateExperience/<lang>/sites/<site>/ (Jobright 1.25.2's site registry,
 *  read as its behaviour; adapters/oracle/url.ts ORACLE_OWN_DOMAIN_PATH). The P2 review (security 1): the hcmUI prefix
 *  alone, the one every Oracle fixture shows; and the address alone never makes a page Oracle's to fill or press:
 *  the sentinel and the adapters' choice also need the page's own Oracle markup (dom/page-signals.ts
 *  oracleCandidateExperienceShown), and its "applied" a confirmation in the page beside its network signs. */
export const ORACLE_OWN_DOMAIN_PATH =
  /^\/hcmUI\/CandidateExperience\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\/sites\/[A-Za-z0-9_-]{1,40}\//;
/** The P2 review (security 1, M3): the path every page of Oracle's Candidate Experience app sits under (Oracle's own
 *  tenants' and, recognised by its markup, an employer's own domain's), where the submit watcher installs. */
export const ORACLE_CANDIDATE_APP = '/hcmUI/CandidateExperience/';

/** Whether a host and path are Oracle's Candidate Experience on a company's own domain: never a static match (no ATS
 *  host of ours), never Oracle's own domains (their tenants are HOST_PLATFORMS'), LinkedIn's, an employee HR system's
 *  or a CAPTCHA vendor's: the page the sentinel recognises (dom/page-signals.ts) and the worker injects into, where the
 *  Oracle adapter then reads it. */
export function oracleOwnDomain(host: string, path: string): boolean {
  return host.includes('.') && ORACLE_OWN_DOMAIN_PATH.test(path) && !under(host, ORACLE_REFUSED_DOMAINS)
    && !isLinkedInHost(host) && !isHrHost(host) && !CAPTCHA_VENDOR_HOST.test(host);
}

/** The domains no company's own Candidate Experience is read on, written whole (adapters/oracle/url.ts reads the same
 *  list: src/shared/hosts.test.ts holds them equal): Oracle's own clouds (their tenants are HOST_PLATFORMS'), and every
 *  domain this file keeps the extension off (LinkedIn's, the employee HR systems', the CAPTCHA vendors'). */
export const ORACLE_REFUSED_DOMAINS: readonly string[] = ['oraclecloud.com', 'oraclegovcloud.com', 'linkedin.com',
  'linkedin.cn', 'lnkd.in', 'licdn.com', 'myworkday.com', 'sapsf.com', 'sapsf.eu', 'bamboohr.com', 'clearcompany.com',
  'dayforcehcm.com', 'ultipro.com', 'ukg.net', 'paylocity.com', 'paycor.com', 'rippling.com', 'hibob.com', 'adp.com',
  // The P2 review (security 2)
  'ultipro.ca',
  'paycomonline.net', 'careerplug.com', 'google.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com', 'arkoselabs.com',
  'funcaptcha.com', 'captcha-delivery.com', 'protechts.net', 'geetest.com',
  // jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3): the snapshot7 HR domains (HR_HOST_MATCHES), and Jibe's, iCIMS's candidate
  // front: an ATS vendor's domain, never an employer's own. So no host of UNBRIDGED_HOST_PLATFORMS is read as Oracle's
  // own domain, and bridgePlatformOfUrl reads none of them as any platform's.
  'saashr.com', 'jobdiva.com', 'eightfold.ai', 'jibeapply.com'];
// ── end v5 p2-detect ──

/** A match pattern's path as Chrome reads it: each `*` any run of characters, the rest as written, from the start. */
function globPath(path: string): RegExp {
  const parts = path.split('*').map((part) => part.replace(/[.+?^$|()[\]{}\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.*')}`);
}

/** The P2 review (L3): the platform of an address the manifest's static content script runs at (onAtsMatch), else null:
 *  never an employer's own domain platformOfUrl names by its address alone (Oracle's Candidate Experience there), whose
 *  pages only the sentinel's path reaches. The launcher's per-site key, the agent's addresses and the reload offer
 *  read this one. */
export function staticPlatformOfUrl(url: string): Platform | null {
  return onAtsMatch(url) ? platformOfUrl(url) : null;
}

/** The platform of an https address on one of the ATS hosts (a path-scoped host's under one of its candidate paths,
 *  as written: Chrome's match patterns compare paths case-sensitively), else null. */
export function platformOfUrl(url: string): Platform | null {
  return platformAmong(url, [HOST_PLATFORMS, UNBRIDGED_HOST_PLATFORMS]);
}

// ── jr7 ENGINE-7 E0 (the coordinator's decision of 2026-11-11) ──
/** platformOfUrl as the page-world scripts read it (adapters/bridge-address.ts: the bridge and the submit watcher):
 *  over HOST_PLATFORMS alone, so their bundles never hold UNBRIDGED_HOST_PLATFORMS. It is platformOfUrl's answer on
 *  every address, but null where that answer is one of UNBRIDGED_PLATFORMS (their hosts are all under
 *  ORACLE_REFUSED_DOMAINS): the bridge installs on none of their hosts either way. */
export function bridgePlatformOfUrl(url: string): Platform | null {
  return platformAmong(url, [HOST_PLATFORMS]);
}

/** The platform of an address by the first of `tables` that names its host (each table read whole before the next),
 *  else Oracle's on a company's own domain (oracleOwnDomain), else null. */
function platformAmong(url: string, tables: ReadonlyArray<readonly HostPlatform[]>): Platform | null {
  const match = /^https:\/\/([^/?#:]+)(?::443)?([/?#].*)?$/is.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  let entry: HostPlatform | undefined;
  for (const table of tables) {
    entry = table.find((each) => each.host.test(host));
    if (entry !== undefined) break;
  }
  if (entry === undefined) return oracleOwnDomain(host, (match[2] ?? '').split(/[?#]/, 1)[0]!) ? 'oracle' : null;
  if (entry.paths === undefined && entry.pathPattern === undefined) return entry.platform;
  const path = (match[2] ?? '').split(/[?#]/, 1)[0]!;
  return (entry.paths ?? []).some((prefix) => path.startsWith(prefix)) || entry.pathPattern?.test(path) === true
    ? entry.platform : null;
}
// ── end jr7 ENGINE-7 E0 ──

// ── v3 Phase 8: company career sites (docs/SPEC-AMENDMENTS.md §12 Decision 13) ─────────────────────────────────────
// Nothing below is a static match. The worker registers a dormant sentinel (src/entrypoints/sentinel.ts) with
// chrome.scripting.registerContentScripts, in the top frame only, and injects the content script into a frame the
// sentinel recognised, once it has checked the frame's address again itself. LinkedIn is deferred to v5 by the owner
// (2026-11-06): nothing of the extension runs on any LinkedIn host, nor on an employee HR system's (HR_HOST_MATCHES).
// v5 p1-rules (PLAN decision 10, the owner's "Implement like jobright. I approved all", 2026-11-08): every site at
// install, as Jobright asks: the manifest's required host permissions are every https and http page
// (ALL_SITES_HOST_PERMISSIONS), so no click in Options asks Chrome for anything, and "Company career sites" is on unless
// the person turns it off (background/sites.ts). The sentinel and a company page's fill stay on https pages: a company's
// http form would send the person's answers unencrypted (the owner may widen it; docs: p1-rules). And (decision 9) no
// script of the extension ever runs in a CAPTCHA or anti-bot vendor's own frame (CAPTCHA_VENDOR_MATCHES).

/** Every https page: the company career sites' registration, the ATS hosts, LinkedIn and the HR systems excluded. */
export const SITES_MATCH = 'https://*/*';
/** v5 p1-rules (PLAN decision 10): the manifest's required host permissions beside TailorIT's origin: every https and
 *  every http page, at install (Chrome's prompt: "Read and change all your data on all websites"). Never <all_urls>:
 *  file pages, ftp and websockets stay out. */
export const ALL_SITES_HOST_PERMISSIONS = [SITES_MATCH, 'http://*/*'] as const;
/** v5 p1-rules (PLAN decision 9, like Jobright's manifest): the CAPTCHA and anti-bot vendors' own frames, which no script
 *  of the extension may run in: reCAPTCHA's (google.com and recaptcha.net), hCaptcha's, Cloudflare Turnstile's
 *  challenges, Arkose Labs' (and FunCaptcha's legacy host), DataDome's, PerimeterX/HUMAN's and GeeTest's. As Chrome
 *  match patterns of either scheme; the registration excludes them, and isCompanySiteUrl refuses them
 *  (isCaptchaVendorUrl). The static content scripts' ATS hosts are none of them (scripts/check-build.mjs). */
export const CAPTCHA_VENDOR_MATCHES = ['*://*.google.com/recaptcha/*', '*://*.recaptcha.net/*', '*://*.hcaptcha.com/*',
  '*://challenges.cloudflare.com/*', '*://*.arkoselabs.com/*', '*://*.funcaptcha.com/*', '*://*.captcha-delivery.com/*',
  '*://*.protechts.net/*', '*://*.geetest.com/*'] as const;
/** The vendors' hosts of CAPTCHA_VENDOR_MATCHES whose every path is theirs. */
const CAPTCHA_VENDOR_HOST = /(?:^|\.)(?:recaptcha\.net|hcaptcha\.com|arkoselabs\.com|funcaptcha\.com|captcha-delivery\.com|protechts\.net|geetest\.com)$|^challenges\.cloudflare\.com$/;

/** Whether an address is a CAPTCHA or anti-bot vendor's own page (CAPTCHA_VENDOR_MATCHES): reCAPTCHA under google.com's
 *  /recaptcha/ path, every page of the other vendors' hosts. */
export function isCaptchaVendorUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'google.com' || host.endsWith('.google.com')) return url.pathname.startsWith('/recaptcha/');
  return CAPTCHA_VENDOR_HOST.test(host);
}
/** LinkedIn's hosts, which the career sites' registration excludes: linkedin.com and every host under it (`*.` covers
 *  linkedin.com itself), its China site and its short-link and static hosts. */
export const LINKEDIN_HOST_MATCHES = ['https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*',
  'https://*.licdn.com/*'] as const;
/** The sentinel's bundle (src/entrypoints/sentinel.ts, an unlisted script WXT writes at the build's root). */
export const SENTINEL_FILE = 'sentinel.js';
// ── v1.5 X (PLAN decision 2) ──
/** The extension's one web-accessible resource: the preview page (src/entrypoints/preview), which the dialog over a
 *  tab's page embeds (content/ui/document-dialog.ts). Declared at its dynamic address alone (`use_dynamic_url`: a new
 *  address each browser session, so a page cannot tell the extension is installed by loading it at its fixed id), on
 *  the pages the sidebar runs on (ALL_SITES_HOST_PERMISSIONS); its scripts, styles and fonts load from the extension's
 *  own origin, so nothing else is listed (scripts/check-build.mjs holds the manifest to exactly this). */
export const WEB_ACCESSIBLE_PAGE = 'preview.html';
// ── end v1.5 X ──
/** The content script's bundle (src/entrypoints/content-script.ts, likewise): the manifest's static script on the ATS
 *  hosts, and the one the worker injects into a frame the sentinel recognised. */
export const CONTENT_SCRIPT_FILE = 'content-script.js';
/** v5 p2-detect: the page-world submit watcher's bundle (src/entrypoints/submit-watch.content.ts, as WXT writes it): the
 *  manifest's static script on its hosts, and the one the worker runs in the page's own world of a company's own page
 *  that shows Oracle's Candidate Experience (background/sites.ts). */
export const SUBMIT_WATCH_FILE = 'content-scripts/submit-watch.js';
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
 *  runs there), LinkedIn's, the employee HR systems' and (v5 p1-rules) the CAPTCHA and anti-bot vendors' own pages, in
 *  the top frame only (never an ad's or an anti-bot frame), once the page is loaded. v5 p1-shell (the review's S11):
 *  nor TailorIT's own pages (`own`, its origin, where it is an https one). */
export function registrationsFor(on: { sites: boolean; own?: string }): SiteRegistration[] {
  if (!on.sites) return [];
  const own = ownOriginMatch(on.own);
  return [{ id: SITES_REGISTRATION_ID, js: [SENTINEL_FILE], matches: [SITES_MATCH],
    excludeMatches: [...ATS_MATCHES, ...LINKEDIN_HOST_MATCHES, ...HR_HOST_MATCHES, ...CAPTCHA_VENDOR_MATCHES,
      ...(own === null ? [] : [own])],
    allFrames: false, runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED' }];
}

/** v5 p1-shell (S11): TailorIT's https origin as a match pattern (`https://host/*`; a port is not part of a pattern),
 *  else null (none given, not https, or unreadable). */
function ownOriginMatch(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' ? `https://${url.hostname}/*` : null;
  } catch {
    return null;
  }
}

/** v5 p1-shell (S11): whether `url` is on TailorIT's own origin (`own`), which the career sites never reach. */
export function onOwnOrigin(url: string, own: string | undefined): boolean {
  if (own === undefined) return false;
  try {
    return new URL(url).origin === new URL(own).origin;
  } catch {
    return false;
  }
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
 *  jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3; the module header): UKG Ready's saashr.com, JobDiva's jobdiva.com and
 *  Eightfold's eightfold.ai likewise, Paycom's candidate portal now a static match beside its HR host.
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
  // The P2 review (security 2): UKG Pro Canada's employee hosts (<n>.ultipro.ca), as <n>.ultipro.com's.
  'https://*.ultipro.ca/*',
  // ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3; module header): UKG Ready's employee system (/ta/<company>.login, .home:
  // UKGR-2), JobDiva's every page but its portal (JDEF-12) and Eightfold's recruiters' app.eightfold.ai and its
  // employees' /careerhub/ on every company's host (JDEF-12), each by its whole domain as the S5 vendor domains are;
  // Paycom's www.paycomonline.net is here already (PC7-02). Their candidate paths stay static ATS matches. ──
  'https://*.saashr.com/*', 'https://*.jobdiva.com/*', 'https://*.eightfold.ai/*',
  // ── end jr7 ENGINE-7 E0 ──
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
    'dayforcehcm.com', 'ultipro.com', 'ukg.net', 'paylocity.com', 'paycor.com', 'rippling.com', 'hibob.com', 'adp.com',
    // The P2 review (security 2)
    'ultipro.ca',
    // jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 3)
    'saashr.com', 'jobdiva.com', 'eightfold.ai'])
    || HR_HOSTS_EXACT.includes(host.toLowerCase().replace(/\.+$/, ''));
}

/** A company's own page as the career sites reach it: https, where the static content script never runs (no ATS match:
 *  an ATS domain's other hosts stay dormant), and neither LinkedIn's nor an employee HR system's, nor (v5 p1-rules) a
 *  CAPTCHA or anti-bot vendor's own page. The sentinel's recognition, the worker's check before it injects and the site
 *  adapter all read this one rule. */
export function isCompanySiteUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && !onAtsMatch(parsed.href) && !isLinkedInHost(parsed.hostname)
    && !isHrHost(parsed.hostname) && !isCaptchaVendorUrl(parsed);
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
