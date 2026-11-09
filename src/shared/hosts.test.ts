import { describe, expect, it } from 'vitest';
import { MatchPattern } from 'wxt/utils/match-patterns';
import {
  ALL_SITES_HOST_PERMISSIONS, ATS_MATCHES, CAPTCHA_VENDOR_MATCHES, careerSiteOf, HR_HOST_MATCHES, isCaptchaVendorUrl,
  isCompanySiteUrl, isHrHost, isLinkedInHost, onAtsMatch, onOwnOrigin, platformOfUrl, registrationsFor, SITES_MATCH,
  // v5 p2-detect
  LINKEDIN_HOST_MATCHES, ORACLE_REFUSED_DOMAINS, oracleOwnDomain, staticPlatformOfUrl, SUBMIT_WATCH_MATCHES,
} from './hosts';
import { ORACLE_REFUSED_DOMAINS as PARSER_REFUSED } from '../adapters/oracle/url';

describe('the ATS host list', () => {
  it('names the platform of each host, nested Workday subdomains included', () => {
    expect(platformOfUrl('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(platformOfUrl('https://boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(platformOfUrl('https://jobs.eu.lever.co/acme/x/apply')).toBe('lever');
    expect(platformOfUrl('https://jobs.ashbyhq.com/acme/x/application')).toBe('ashby');
    expect(platformOfUrl('https://wlu.wd5.myworkdayjobs.com/en-US/careers/job/x_R1')).toBe('workday');
    expect(platformOfUrl('https://wd5.myworkdaysite.com/recruiting/acme/careers')).toBe('workday');
    // The hosts workday/url.ts reads: a tenant's own, with or without wd<n>, and the shared one (v3 Phase 6/7b, C1).
    expect(platformOfUrl('https://acme.myworkdayjobs.com/External/job/x_R1')).toBe('workday');
    for (const url of ['https://wd5.myworkdayjobs.com/x', 'https://www.myworkdayjobs.com/x',
      'https://a.b.wd5.myworkdayjobs.com/x', 'https://acme.myworkdaysite.com/x']) {
      expect(platformOfUrl(url), url).toBeNull();
    }
    expect(platformOfUrl('https://apply.workable.com/acme/j/0123456789/apply/')).toBe('workable');
    // Workable's job-search site and the addresses that only redirect to its application host are not matched.
    // Snapshot build, boards (the owner's captures of 2026-11-06): Workable's job-search site is Workable's.
    expect(platformOfUrl('https://jobs.workable.com/view/abc/engineer')).toBe('workable');
    expect(platformOfUrl('https://acme.workable.com/j/0123456789')).toBeNull();
    expect(platformOfUrl('https://evil.example/jobs.lever.co')).toBeNull();
    expect(platformOfUrl('http://jobs.lever.co/acme')).toBeNull();
  });

  it('names the v3 Phase 7b candidate hosts alone, never their domains\' other hosts', () => {
    expect(platformOfUrl('https://careers-eastwestbank.icims.com/jobs/13634/x/job')).toBe('icims');
    expect(platformOfUrl('https://acme.icims.com/jobs/1/job')).toBe('icims');
    expect(platformOfUrl('https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=1')).toBe('taleo');
    expect(platformOfUrl('https://career2.successfactors.eu/career?company=x')).toBe('successfactors');
    expect(platformOfUrl('https://career10.successfactors.com/career')).toBe('successfactors');
    expect(platformOfUrl('https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1')).toBe('oracle');
    expect(platformOfUrl('https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1')).toBe('oracle');
    for (const url of ['https://login.icims.com/u/login', 'https://www.icims.com/', 'https://api.icims.com/x',
      'https://internal-acme.icims.com/jobs/1/job', 'https://www.taleo.net/', 'https://acme.tbe.taleo.net/x',
      'https://performancemanager4.successfactors.com/login', 'https://api.successfactors.eu/x',
      'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x', 'https://www.oraclecloud.com/',
      // A tenant's pages beside its candidate pages (an employee's Fusion applications: v3 Phase 6/7b review, S10).
      'https://elhr.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://elhr.fa.us2.oraclecloud.com/',
      'https://elhr.fa.us2.oraclecloud.com/hcmUI/faces/FndOverview', 'https://elhr.fa.us2.oraclecloud.com?x=/hcmUI/CandidateExperience/']) {
      expect(platformOfUrl(url), url).toBeNull();
    }
  });

  it('matches through the manifest patterns for exactly the hosts it names', () => {
    const patterns = ATS_MATCHES.map((p) => new MatchPattern(p));
    for (const url of ['https://wlu.wd5.myworkdayjobs.com/x', 'https://jobs.lever.co/a/b/apply',
      'https://apply.workable.com/acme/j/0123456789/apply/',
      // Snapshot build, boards (the owner's captures of 2026-11-06).
      'https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN/remote-expert-rag-engineer']) {
      expect(patterns.some((p) => p.includes(url)), url).toBe(true);
    }
    expect(patterns.some((p) => p.includes('https://careers.example.com/jobs/1'))).toBe(false);
    // v3 Phase 7b: each domain by its pattern, Oracle's by its candidate pages' path alone.
    for (const url of ['https://careers-acme.icims.com/jobs/1/x/job', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl',
      'https://career2.successfactors.eu/career', 'https://career10.successfactors.com/career',
      'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1']) {
      expect(patterns.some((p) => p.includes(url)), url).toBe(true);
    }
    expect(patterns.some((p) => p.includes('https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome'))).toBe(false);
    // A domain pattern takes the bare domain too: the script stays dormant there, a host with no platform.
    expect(patterns.some((p) => p.includes('https://icims.com/x'))).toBe(true);
    expect(platformOfUrl('https://icims.com/x')).toBeNull();
  });

  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  it("names Oracle's government cloud tenants by their candidate pages, and SmartRecruiters' jobs host", () => {
    const patterns = ATS_MATCHES.map((p) => new MatchPattern(p));
    // [iaaxmg.fa.ocs.oraclegovcloud.com]: the same Candidate Experience application, by its path alone.
    const gov = 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1';
    expect(platformOfUrl(gov)).toBe('oracle');
    expect(patterns.some((p) => p.includes(gov))).toBe(true);
    for (const url of ['https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome',
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/', 'https://iaaxmg.fa.us2.oraclegovcloud.com/hcmUI/CandidateExperience/en/x',
      'https://www.oraclegovcloud.com/hcmUI/CandidateExperience/en/x']) {
      expect(platformOfUrl(url), url).toBeNull();
    }
    expect(patterns.some((p) => p.includes('https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome'))).toBe(false);
    expect(patterns.some((p) => p.includes('https://www.oraclegovcloud.com/hcmUI/CandidateExperience/en/x'))).toBe(false);
    // [jobs.smartrecruiters.com]: a posting and the one-click application; no other SmartRecruiters host.
    for (const url of ['https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer',
      'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1/screening']) {
      expect(platformOfUrl(url), url).toBe('smartrecruiters');
      expect(patterns.some((p) => p.includes(url)), url).toBe(true);
    }
    for (const url of ['https://careers.smartrecruiters.com/Xplor', 'https://www.smartrecruiters.com/',
      'https://jobs.smartrecruiters.com.evil.example/x', 'http://jobs.smartrecruiters.com/Xplor/1']) {
      expect(platformOfUrl(url), url).toBeNull();
      expect(patterns.some((p) => p.includes(url)), url).toBe(false);
    }
  });

  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0) ──
  /** Each new platform's candidate addresses (the snapshots' shapes, made up ids), and addresses of the same host or
   *  domain off its candidate paths, which are no platform's. */
  const NEW_ATS: Array<[string, string[], string[]]> = [
    ['jobvite', ['https://jobs.jobvite.com/acme/job/oAbC1dEf', 'https://jobs.jobvite.com/acme/job/oAbC1dEf/apply'],
      ['https://www.jobvite.com/support/job-seeker-support/', 'https://app.jobvite.com/x']],
    ['jazzhr', ['https://acme.applytojob.com/apply/AbCdEf1234/Senior-Engineer'],
      ['https://acme.applytojob.com/', 'https://acme.applytojob.com/careers', 'https://www.applytojob.com/apply/x']],
    ['rippling', ['https://ats.rippling.com/acme/jobs/00000000-0000-4000-8000-000000000001',
      'https://ats.rippling.com/acme/jobs/00000000-0000-4000-8000-000000000001/apply?step=application'],
    ['https://app.rippling.com/login', 'https://www.rippling.com/']],
    ['breezy', ['https://acme.breezy.hr/p/0123456789ab-senior-engineer', 'https://acme.breezy.hr/p/0123456789ab-senior-engineer/apply'],
      ['https://acme.breezy.hr/', 'https://app.breezy.hr/signin']],
    ['careerplug', ['https://acme.careerplug.com/jobs/1234567/apps/new'],
      ['https://acme.careerplug.com/account/sign_in', 'https://acme.careerplug.com/',
        // The security fix of 2026-11-06 (S5): CareerPlug's employers' host is no tenant's.
        'https://app.careerplug.com/jobs/1234567/apps/new']],
    ['pinpoint', ['https://acme.pinpointhq.com/en/postings/00000000-0000-4000-8000-000000000001',
      'https://acme.pinpointhq.com/en/postings/00000000-0000-4000-8000-000000000001/applications/new'],
    // v5 p2-detect: another locale's postings, or none, are Pinpoint's too (fr/postings/x was none before).
    ['https://app.pinpointhq.com/en/postings/x', 'https://acme.pinpointhq.com/', 'https://acme.pinpointhq.com/a/b/postings/x',
      'https://acme.pinpointhq.com/english/postings/x']],
    ['paycor', ['https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=x&id=y'],
      ['https://recruitingbypaycor.com/', 'https://www.recruitingbypaycor.com/career/x']],
    ['hibob', ['https://acme.careers.hibob.com/jobs/00000000-0000-4000-8000-000000000001'],
      ['https://app.hibob.com/home', 'https://careers.hibob.com/x']],
    ['ultipro', ['https://recruiting.ultipro.com/ACM1000ACME/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityApply?opportunityId=x'],
      ['https://acme.ultipro.com/login', 'https://www.ultipro.com/']],
    ['dayforce', ['https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/1234/apply'],
      ['https://www.dayforcehcm.com/', 'https://acme.dayforcehcm.com/x']],
    // v5 p2-detect: /recruiting/ in lower case is Paylocity's too (it was none before).
    ['paylocity', ['https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1234567',
      'https://recruiting.paylocity.com/recruiting/Jobs/Apply/1234567'],
    ['https://recruiting.paylocity.com/RECRUITING/Jobs/Apply/1234567', 'https://access.paylocity.com/',
      'https://recruiting.paylocity.com/']],
    ['dice', ['https://www.dice.com/job-applications/00000000-0000-4000-8000-000000000001/wizard'],
      ['https://www.dice.com/job-detail/00000000-0000-4000-8000-000000000001', 'https://www.dice.com/dashboard/login', 'https://dice.com/job-applications/x']],
    ['clearcompany', ['https://acme.clearcompany.com/careers/jobs/00000000-0000-4000-8000-000000000001/apply'],
      ['https://acme.clearcompany.com/blank/page', 'https://acme.clearcompany.com/app/home', 'https://cc-app-static.clearcompany.com/careers/x']],
    ['adp', ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x&ccId=y&jobId=1',
      'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/recruitment.html?cid=x'],
    ['https://workforcenow.adp.com/theme/index.html', 'https://workforcenow.adp.com/mascsr/default/mdf/x.html', 'https://online.adp.com/signin']],
    ['bamboohr', ['https://acme.bamboohr.com/careers/123', 'https://acme.bamboohr.com/careers/123?source=x'],
      ['https://acme.bamboohr.com/home', 'https://acme.bamboohr.com/employees/', 'https://www.bamboohr.com/']],
  ];

  it('names the new ATSs on their candidate hosts and paths alone (DESIGN-NEW-ATS §4)', () => {
    for (const [platform, inside, outside] of NEW_ATS) {
      for (const url of inside) expect(platformOfUrl(url), url).toBe(platform);
      for (const url of outside) expect(platformOfUrl(url), url).toBeNull();
    }
    // Paycom waits for its snapshots and DFIN stays a company's own host: neither is an ATS host.
    expect(platformOfUrl('https://www.paycomonline.net/v4/ats/web.php/portal/x/career-page')).toBeNull();
    expect(platformOfUrl('https://jobs.dfinsolutions.com/job/x/1/')).toBeNull();
    // A path-scoped host's path is compared as written, as Chrome's match pattern compares it.
    expect(platformOfUrl('https://acme.bamboohr.com/Careers/123')).toBeNull();
  });

  it("matches the new ATSs through the manifest patterns on their candidate paths, and stays off their hosts' other paths", () => {
    const patterns = ATS_MATCHES.map((p) => new MatchPattern(p));
    for (const [, inside, outside] of NEW_ATS) {
      for (const url of inside) {
        expect(patterns.some((p) => p.includes(url)), url).toBe(true);
        expect(onAtsMatch(url), url).toBe(true);
      }
      for (const url of outside) {
        expect(onAtsMatch(url), url).toBe(patterns.some((p) => p.includes(url)));
        // The static script may match a domain pattern's other host (dormant there, no platform), never a candidate
        // path's other paths.
        if (onAtsMatch(url)) expect(platformOfUrl(url), url).toBeNull();
      }
    }
    for (const url of ['https://acme.bamboohr.com/home', 'https://workforcenow.adp.com/theme/index.html',
      'https://acme.clearcompany.com/blank/page', 'https://www.dice.com/dashboard/login', 'https://acme.applytojob.com/',
      'https://www.paycomonline.net/v4/ee/web.php/app/login']) {
      expect(onAtsMatch(url), url).toBe(false);
    }
  });
  // ── end New ATSs ──
});

/** v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' own frames, as the pages that draw them load them. */
const VENDOR_FRAMES = ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal',
  'https://www.google.com/recaptcha/api2/bframe?hl=en&k=x', 'https://www.google.com/recaptcha/enterprise/anchor?k=x',
  'https://recaptcha.google.com/recaptcha/api2/anchor?k=x', 'https://www.recaptcha.net/recaptcha/api2/anchor?k=x',
  'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox', 'https://hcaptcha.com/',
  'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/x/light/normal',
  'https://client-api.arkoselabs.com/fc/gc/?token=x', 'https://acme-api.arkoselabs.com/v2/x/enforcement.html',
  'https://client-api.funcaptcha.com/fc/gc/?token=x', 'https://geo.captcha-delivery.com/captcha/?initialCid=x',
  'https://li.protechts.net/index.html', 'https://static.geetest.com/static/js/gt.0.4.9.js'];

describe('the CAPTCHA and anti-bot vendors (v5 p1-rules, PLAN decision 9)', () => {
  it("names each vendor's frames, and no page of anyone else's", () => {
    for (const url of VENDOR_FRAMES) {
      expect(isCaptchaVendorUrl(new URL(url)), url).toBe(true);
      expect(CAPTCHA_VENDOR_MATCHES.some((pattern) => new MatchPattern(pattern).includes(url)), url).toBe(true);
      expect(isCompanySiteUrl(url), url).toBe(false);
    }
    for (const url of ['https://www.google.com/about/careers/applications/jobs/results/1', 'https://www.google.com/search?q=recaptcha',
      'https://nothcaptcha.com/', 'https://hcaptcha.com.example/', 'https://cloudflare.com/', 'https://dash.cloudflare.com/',
      'https://careers.acme.example/recaptcha/', 'https://geetest.com.example/']) {
      expect(isCaptchaVendorUrl(new URL(url)), url).toBe(false);
      expect(CAPTCHA_VENDOR_MATCHES.some((pattern) => new MatchPattern(pattern).includes(url)), url).toBe(false);
    }
  });

  it('keeps the static content scripts off every vendor frame (the ATS hosts are none of them)', () => {
    for (const url of VENDOR_FRAMES) {
      expect(ATS_MATCHES.some((pattern) => new MatchPattern(pattern).includes(url)), url).toBe(false);
      expect(onAtsMatch(url), url).toBe(false);
    }
  });
});

describe('the company career sites (v3 Phase 8)', () => {
  /** Whether a registration reaches an address, as Chrome reads its matches and exclusions. */
  const reaches = (registration: { matches: string[]; excludeMatches?: string[] }, url: string) =>
    registration.matches.some((pattern) => new MatchPattern(pattern).includes(url))
    && !(registration.excludeMatches ?? []).some((pattern) => new MatchPattern(pattern).includes(url));

  it("registers the sentinel while on alone, in the top frame only, inside the host permissions", () => {
    // v5 p1-rules (PLAN decision 10): every https and http page at install; the sentinel on the https ones.
    expect(ALL_SITES_HOST_PERMISSIONS).toEqual(['https://*/*', 'http://*/*']);
    expect(registrationsFor({ sites: false })).toEqual([]);
    expect(registrationsFor({ sites: true })).toEqual([{ id: 'tailorit-sites', js: ['sentinel.js'], matches: [SITES_MATCH],
      excludeMatches: [...ATS_MATCHES, 'https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*',
        'https://*.licdn.com/*', 'https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*',
        'https://*.sapsf.eu/*',
        // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
        'https://*.oraclegovcloud.com/*',
        // ── New ATSs ──
        'https://workforcenow.adp.com/*', 'https://*.bamboohr.com/*', 'https://www.paycomonline.net/*',
        'https://*.clearcompany.com/*',
        // ── The security fix of 2026-11-06 (S5) ──
        'https://*.dayforcehcm.com/*', 'https://*.ultipro.com/*', 'https://*.ukg.net/*', 'https://*.paylocity.com/*',
        'https://*.paycor.com/*', 'https://*.rippling.com/*', 'https://*.hibob.com/*', 'https://*.adp.com/*',
        'https://app.careerplug.com/*',
        // The P2 review (security 2): UKG Pro Canada's employee hosts.
        'https://*.ultipro.ca/*',
        // ── v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' own pages ──
        '*://*.google.com/recaptcha/*', '*://*.recaptcha.net/*', '*://*.hcaptcha.com/*', '*://challenges.cloudflare.com/*',
        '*://*.arkoselabs.com/*', '*://*.funcaptcha.com/*', '*://*.captcha-delivery.com/*', '*://*.protechts.net/*',
        '*://*.geetest.com/*'], allFrames: false, runAt: 'document_idle', persistAcrossSessions: true,
      world: 'ISOLATED' }]);
    // The P2 review (security 2): UKG Pro Canada's employee hosts, the 19th.
    expect(HR_HOST_MATCHES).toHaveLength(19);
  });

  // Every address the registration reaches is one isCompanySiteUrl takes, and the other way round.
  const addresses = ['https://careers.acme.example/jobs/1', 'https://www.amazon.jobs/en/jobs/1/x', 'https://www.linkedin.com/jobs/view/4012345678/',
    'https://linkedin.com/jobs/view/4012345678/', 'https://uk.linkedin.com/jobs/search/?currentJobId=4012345678',
    'https://www.linkedin.cn/jobs/1', 'https://lnkd.in/abc', 'https://media.licdn.com/x.js', 'https://job-boards.greenhouse.io/acme/jobs/1',
    'https://login.icims.com/u/login', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/x',
    'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/x', 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x',
    'https://oraclecloud.com/', 'https://acme.myworkday.com/acme/d/home.htmld', 'https://wd5.myworkday.com/acme/login.htmld',
    'https://performancemanager4.sapsf.com/sf/home', 'https://hcm.sapsf.eu/sf/home', 'https://career5.successfactors.eu/career?x=1',
    'https://acme.wd5.myworkdayjobs.com/x', 'http://careers.acme.example/jobs/1',
    // ── snapshot build 2026-11-06 (oracle-sf-sr): a government cloud tenant's pages, SmartRecruiters' jobs host ──
    'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/x', 'https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/x',
    'https://jobs.smartrecruiters.com/Xplor/744000159905715-x',
    // New ATSs (DESIGN-NEW-ATS §4): their candidate paths are ATS matches, their employee pages HR systems', and the
    // other hosts of their vendors (no snapshot names them an HR system) company pages.
    'https://jobs.jobvite.com/acme/job/x/apply', 'https://acme.bamboohr.com/careers/1', 'https://acme.bamboohr.com/home',
    'https://bamboohr.com/', 'https://workforcenow.adp.com/theme/index.html',
    'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html', 'https://www.paycomonline.net/v4/ee/web.php/app/login',
    'https://www.paycomonline.net/v4/ats/web.php/portal/x/career-page', 'https://acme.clearcompany.com/app/home',
    'https://acme.clearcompany.com/careers/jobs/1/apply', 'https://cc-app-static.clearcompany.com/x.css',
    'https://acme.applytojob.com/', 'https://app.rippling.com/login', 'https://jobs.dfinsolutions.com/job/x/1/',
    // ── The security fix of 2026-11-06 (S5): the new ATS vendors' employee systems (the review's probe), never reached;
    // their candidate hosts stay ATS matches ──
    'https://www.dayforcehcm.com/mydayforce/login.aspx', 'https://n12.ultipro.com/default.aspx', 'https://acme.ukg.net/',
    'https://access.paylocity.com/', 'https://secure.paycor.com/Accounts/Signin', 'https://app.rippling.com/dashboard',
    'https://app.hibob.com/home', 'https://my.adp.com/', 'https://app.careerplug.com/jobs/1/apps/new',
    'https://app.careerplug.com/login', 'https://jobs.dayforcehcm.com/en-US/acme/candidateportal/jobs/1',
    'https://recruiting.ultipro.com/ACME/JobBoard/abc/OpportunityDetail?opportunityId=1',
    'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1', 'https://ats.rippling.com/acme/jobs/1',
    'https://acme.careers.hibob.com/jobs/1', 'https://acme.careerplug.com/jobs/1/apps/new',
    // ── v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' frames, never reached; Google's careers pages
    // are company pages still ──
    ...VENDOR_FRAMES, 'https://www.google.com/about/careers/applications/jobs/results/123-engineer'];

  it('reaches a company page, and never LinkedIn (deferred to v5), an employee HR system, an ATS host or an http page', () => {
    const [sites] = registrationsFor({ sites: true });
    const reached = addresses.filter((url) => reaches(sites!, url));
    expect(reached).toEqual(['https://careers.acme.example/jobs/1', 'https://www.amazon.jobs/en/jobs/1/x',
      'https://acme.applytojob.com/', 'https://jobs.dfinsolutions.com/job/x/1/',
      'https://www.google.com/about/careers/applications/jobs/results/123-engineer']);
    for (const url of addresses) expect(isCompanySiteUrl(url), url).toBe(reached.includes(url));
  });

  it("never reaches TailorIT's own https pages (v5 p1-shell, the review's S11)", () => {
    const [own] = registrationsFor({ sites: true, own: 'https://app.tailorit.example:8443' });
    expect(own!.excludeMatches).toContain('https://app.tailorit.example/*');
    expect(reaches(own!, 'https://app.tailorit.example/settings/autofill')).toBe(false);
    expect(reaches(own!, 'https://careers.acme.example/jobs/1')).toBe(true);
    // An http origin (the development and e2e TailorIT) adds nothing: the sentinel reaches no http page anyway.
    expect(registrationsFor({ sites: true, own: 'http://localhost:3100' })).toEqual(registrationsFor({ sites: true }));
    expect(onOwnOrigin('https://app.tailorit.example:8443/tracker', 'https://app.tailorit.example:8443')).toBe(true);
    expect(onOwnOrigin('https://app.tailorit.example/tracker', 'https://app.tailorit.example:8443')).toBe(false);
    expect(onOwnOrigin('https://careers.acme.example/', undefined)).toBe(false);
  });

  it("knows the employee HR systems' hosts (the Phase 8 review, B4)", () => {
    for (const host of ['acme.fa.us2.oraclecloud.com', 'oraclecloud.com', 'acme.myworkday.com', 'hcm.sapsf.com', 'hcm.sapsf.eu',
      'X.SAPSF.COM.',
      // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud ──
      'iaaxmg.fa.ocs.oraclegovcloud.com', 'oraclegovcloud.com',
      // ── New ATSs ──
      'workforcenow.adp.com', 'WorkforceNow.ADP.com.', 'acme.bamboohr.com', 'bamboohr.com',
      'www.paycomonline.net', 'acme.clearcompany.com', 'cc-app-static.clearcompany.com',
      // ── The security fix of 2026-11-06 (S5) ──
      'www.dayforcehcm.com', 'jobs.dayforcehcm.com', 'n12.ultipro.com', 'recruiting.ultipro.com', 'acme.ukg.net',
      'access.paylocity.com', 'secure.paycor.com', 'app.rippling.com', 'ats.rippling.com', 'app.hibob.com', 'my.adp.com',
      'x.workforcenow.adp.com', 'online.adp.com', 'adp.com', 'app.careerplug.com', 'APP.CareerPlug.com.']) {
      expect(isHrHost(host), host).toBe(true);
    }
    for (const host of ['acme.wd5.myworkdayjobs.com', 'sapsf.com.evil.example', 'notoraclecloud.com', 'careers.acme.example',
      'notoraclegovcloud.com',
      // HR_HOST_MATCHES names these hosts alone, never one under or beside them.
      'paycomonline.net', 'x.www.paycomonline.net', 'x.app.careerplug.com', 'acme.careerplug.com', 'careerplug.com',
      'bamboohr.com.evil.example', 'jobs.jobvite.com', 'adp.com.evil.example', 'notrippling.com']) {
      expect(isHrHost(host), host).toBe(false);
    }
  });

  it("knows LinkedIn's hosts", () => {
    for (const host of ['www.linkedin.com', 'linkedin.com', 'uk.linkedin.com', 'WWW.LINKEDIN.COM.', 'lnkd.in', 'media.licdn.com',
      'www.linkedin.cn']) {
      expect(isLinkedInHost(host), host).toBe(true);
    }
    for (const host of ['linkedin.com.evil.example', 'notlinkedin.com', 'careers.example.com']) expect(isLinkedInHost(host), host).toBe(false);
  });

  it("knows where the static content script runs (as Chrome reads ATS_MATCHES), an ATS domain's other hosts included", () => {
    const urls = ['https://job-boards.greenhouse.io/acme/jobs/1', 'https://login.icims.com/u/login', 'https://icims.com/x',
      'https://performancemanager4.successfactors.com/sf/home', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/x',
      'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/x', 'https://acme.wd5.myworkdayjobs.com/x', 'https://www.taleo.net/',
      'https://careers.acme.example/jobs/1', 'https://www.linkedin.com/jobs/view/1/', 'http://jobs.lever.co/acme/x',
      'https://notgreenhouse.io/x', 'https://jobs.lever.co.evil.example/x'];
    const patterns = ATS_MATCHES.map((pattern) => new MatchPattern(pattern));
    for (const url of urls) expect(onAtsMatch(url), url).toBe(patterns.some((pattern) => pattern.includes(url)));
  });

  it('reads the career sites by host and posting or application path only', () => {
    const cases: Array<[string, string | null]> = [
      ['https://www.amazon.jobs/en/jobs/10386857/software-engineer', 'amazon'],
      ['https://www.amazon.jobs/applicant/jobs/10386857/apply', 'amazon'],
      ['https://www.amazon.jobs/en/search?base_query=x', null],
      ['https://jobs.apple.com/en-us/details/200612345/engineer', 'apple'],
      ['https://jobs.apple.com/app/en-us/apply/200612345', 'apple'],
      ['https://www.google.com/about/careers/applications/jobs/results/123456789', 'google'],
      ['https://www.google.com/about/careers/applications/apply?jobId=x', 'google'],
      ['https://www.google.com/search?q=jobs', null],
      ['https://www.metacareers.com/profile/job_details/123', 'meta'],
      ['https://careers.walmart.com/us/en/jobs/R-1075582', 'walmart'],
      ['https://careers.walmart.com/us/en/jobs/contact-details?from=x', 'walmart'],
      ['https://lifeattiktok.com/search/7401234', 'tiktok'],
      ['https://careers.tiktok.com/resume/7401234/apply', 'tiktok'],
      ['https://www.tesla.com/careers/search/job/engineer-12345', 'tesla'],
      ['https://www.tesla.com/model3', null],
      ['http://www.amazon.jobs/en/jobs/1', null],
    ];
    for (const [url, site] of cases) expect(careerSiteOf(url)?.name ?? null, url).toBe(site);
  });
});

// ── v5 p2-detect: the address variants of platforms already here (the engine audit's gap 1a; Jobright's site list) ──
describe('the address variants (v5 p2-detect)', () => {
  const VARIANTS: Array<[string, string]> = [
    ['https://acme.wd5.myworkdayjobs-impl.com/en-US/External/job/Remote/Engineer_JR-1', 'workday'],
    ['https://acme.myworkdayjobs-impl.com/External', 'workday'],
    ['https://acme.pinpointhq.com/de/postings/00000000-0000-4000-8000-000000000001', 'pinpoint'],
    ['https://acme.pinpointhq.com/fr-ca/postings/00000000-0000-4000-8000-000000000001/applications/new', 'pinpoint'],
    ['https://acme.pinpointhq.com/postings/00000000-0000-4000-8000-000000000001', 'pinpoint'],
    ['https://recruiting.paylocity.com/recruiting/jobs/success/1234567', 'paylocity'],
    ['https://recruiting2.ultipro.com/ACM1000ACME/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityApply?opportunityId=x',
      'ultipro'],
    ['https://recruiting.ultipro.ca/ACM1000/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityDetail', 'ultipro'],
    ['https://acme.rec.pro.ukg.net/ACM1000/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityApply', 'ultipro'],
    ['https://smith-agency.sfagentjobs.com/jobs/1234567/apps/new', 'careerplug'],
    ['https://sfagentcareers.com/jobs/1234567/apps/new', 'careerplug'],
    ['https://www.apscareerportal.com/jobs/1234567/apps/new', 'careerplug'],
  ];
  /** Their hosts' other pages: the employee systems on UKG's domains among them (the P2 review's security 2: an
   *  employer's own UKG Pro host's job board, for its staff, too). */
  const OFF = ['https://n12.ultipro.com/default.aspx', 'https://n12.ultipro.com/pages/login.aspx?JobBoard=1',
    'https://n12.ultipro.com/ACM1000/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityDetail?opportunityId=x',
    'https://n12.ultipro.ca/ACM1000/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityDetail?opportunityId=x',
    'https://acme.ukg.net/ACM1000/JobBoard/x',
    'https://acme.rec.pro.ukg.net/', 'https://acme.pinpointhq.com/a/b/postings/x', 'https://smith-agency.sfagentjobs.com/about',
    'https://wd5.myworkdayjobs-impl.com/x', 'https://recruiting.paylocity.com/RECRUITING/x'];

  it('names each variant its platform, through the manifest patterns and onAtsMatch alike, and the sentinel never', () => {
    const patterns = ATS_MATCHES.map((p) => new MatchPattern(p));
    for (const [url, platform] of VARIANTS) {
      expect(platformOfUrl(url), url).toBe(platform);
      expect(patterns.some((p) => p.includes(url)), url).toBe(true);
      expect(onAtsMatch(url), url).toBe(true);
      expect(isCompanySiteUrl(url), url).toBe(false);
    }
    for (const url of OFF) {
      expect(platformOfUrl(url), url).toBeNull();
      // onAtsMatch reads a `*` inside a pattern's path as Chrome does.
      expect(onAtsMatch(url), url).toBe(patterns.some((p) => p.includes(url)));
    }
    // The P2 review (security 2): an employer's own UKG Pro host is no static match and no company page: no content
    // script, no bridge, no sentinel.
    for (const url of OFF.filter((each) => /^https:\/\/n12\.ultipro\.(?:com|ca)\//.test(each))) {
      expect(patterns.some((p) => p.includes(url)), url).toBe(false);
      expect(isCompanySiteUrl(url), url).toBe(false);
    }
    // recruiting2.ultipro.com and recruiting.ultipro.ca are candidate-only and whole, as recruiting.ultipro.com.
    expect(onAtsMatch('https://recruiting2.ultipro.com/ACM1000ACME/AuthCode/Register')).toBe(true);
  });

  it('reads a pattern with a `*` inside its path exactly as Chrome does', () => {
    // UKG's <x>.rec.pro.ukg.net job boards and Pinpoint's localised postings are the static matches with one.
    const glob = ['https://*.rec.pro.ukg.net/*/JobBoard/*', 'https://*.pinpointhq.com/*/postings/*'].map((p) => new MatchPattern(p));
    for (const url of ['https://a.rec.pro.ukg.net/T/JobBoard/x', 'https://a.rec.pro.ukg.net/T/U/JobBoard/x',
      'https://a.rec.pro.ukg.net/JobBoard/x', 'https://a.rec.pro.ukg.net//JobBoard/x', 'https://a.rec.pro.ukg.net/T/jobboard/x',
      'https://a.ultipro.com/T/JobBoard/x', 'https://a.pinpointhq.com/en/postings/x',
      'https://a.pinpointhq.com/postings/x', 'https://a.pinpointhq.com/xpostings/x', 'https://a.pinpointhq.com/en/postings']) {
      expect(onAtsMatch(url), url).toBe(patterns(url, glob) || patterns(url, ATS_MATCHES.map((p) => new MatchPattern(p))));
    }
  });

  it("matches the submit watcher on Workday's, ClearCompany's, Oracle's and SuccessFactors' candidate hosts alone, each an ATS match", () => {
    expect([...SUBMIT_WATCH_MATCHES].every((pattern) => (ATS_MATCHES as readonly string[]).includes(pattern))).toBe(true);
    const watch = SUBMIT_WATCH_MATCHES.map((p) => new MatchPattern(p));
    for (const url of ['https://acme.wd5.myworkdayjobs.com/x', 'https://wd5.myworkdaysite.com/recruiting/acme/x',
      'https://acme.myworkdayjobs-impl.com/x', 'https://vafb.clearcompany.com/careers/jobs/x/apply',
      // The owner's word of 2026-11-08: Oracle's and SuccessFactors' signs too.
      'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', 'https://career2.successfactors.eu/career',
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1']) {
      expect(watch.some((p) => p.includes(url)), url).toBe(true);
      expect(['workday', 'clearcompany', 'oracle', 'successfactors', null]).toContain(platformOfUrl(url));
    }
    for (const url of ['https://job-boards.greenhouse.io/acme/jobs/1', 'https://acme.icims.com/jobs/1/job',
      'https://vafb.clearcompany.com/app/home', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl',
      'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345']) {
      expect(watch.some((p) => p.includes(url)), url).toBe(false);
    }
  });
});

/** Whether any of `list` takes `url`. */
function patterns(url: string, list: MatchPattern[]): boolean {
  return list.some((p) => p.includes(url));
}
// ── end v5 p2-detect ──

// ── v5 p2-detect: Oracle's Candidate Experience on a company's own domain (the owner's word of 2026-11-08) ──
describe("Oracle's Candidate Experience on a company's own domain (v5 p2-detect)", () => {
  const OWN = 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply/section/1';

  it('names it Oracle by its address alone, never a static match: the sentinel reaches it as a company page', () => {
    for (const url of [OWN, 'https://jobs.acme.example/hcmUI/CandidateExperience/fr-CA/sites/External/job/7',
      'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/jobs/preview/12345',
      // The P2 review (M3): the app's job list, under the same prefix.
      'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/requisitions']) {
      expect(platformOfUrl(url), url).toBe('oracle');
      expect(onAtsMatch(url), url).toBe(false);
      expect(isCompanySiteUrl(url), url).toBe(true);
      expect(ATS_MATCHES.some((pattern) => new MatchPattern(pattern).includes(url)), url).toBe(false);
    }
    for (const url of ['https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites', 'https://careers.acme-corp.example/',
      'https://careers.acme-corp.example/CandidateExperience/en/sites/CX_1/job/1', 'https://localhost/hcmUI/CandidateExperience/en/sites/X/job/1',
      'http://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345',
      // The P2 review (security 1): the /hcmUI/ prefix alone, never another first segment.
      'https://jobs.acme.example/careers/CandidateExperience/fr-CA/sites/External/job/7',
      'https://acme.github.io/x/CandidateExperience/en/sites/CX_1/job/12345']) {
      expect(platformOfUrl(url), url).toBeNull();
    }
    // The P2 review (L3): the static reading names none of them.
    expect(staticPlatformOfUrl(OWN)).toBeNull();
    expect(staticPlatformOfUrl('https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1')).toBe('oracle');
  });

  it('never on LinkedIn, an employee HR system, a CAPTCHA vendor or Oracle\'s own domains\' other hosts', () => {
    for (const host of ['www.linkedin.com', 'acme.paylocity.com', 'n12.ultipro.com', 'acme.bamboohr.com', 'wd5.myworkday.com',
      'www.google.com', 'challenges.cloudflare.com', 'objectstorage.us-ashburn-1.oraclecloud.com', 'www.oraclegovcloud.com',
      'workforcenow.adp.com', 'www.paycomonline.net', 'app.careerplug.com', 'newassets.hcaptcha.com']) {
      const url = `https://${host}/hcmUI/CandidateExperience/en/sites/CX_1/job/12345`;
      expect(platformOfUrl(url), url).not.toBe('oracle');
      expect(oracleOwnDomain(host, '/hcmUI/CandidateExperience/en/sites/CX_1/job/12345'), host).toBe(false);
    }
  });

  it("keeps the same refused domains as Oracle's own parser", () => {
    expect([...ORACLE_REFUSED_DOMAINS]).toEqual([...PARSER_REFUSED]);
    // Every HR system's and LinkedIn's domain this file keeps the extension off is among them.
    for (const pattern of [...HR_HOST_MATCHES, ...LINKEDIN_HOST_MATCHES]) {
      const domain = /^https:\/\/(?:\*\.)?([^/]+)\//.exec(pattern)![1]!;
      expect(ORACLE_REFUSED_DOMAINS.some((each) => domain === each || domain.endsWith(`.${each}`)), domain).toBe(true);
    }
  });
});
// ── end v5 p2-detect ──
