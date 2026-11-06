import { describe, expect, it } from 'vitest';
import { MatchPattern } from 'wxt/utils/match-patterns';
import {
  ATS_MATCHES, careerSiteOf, isCompanySiteUrl, isHrHost, isLinkedInHost, onAtsMatch, OPTIONAL_HOST_PERMISSIONS, platformOfUrl,
  registrationsFor, SITES_MATCH,
} from './hosts';

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
    expect(platformOfUrl('https://jobs.workable.com/view/abc/engineer')).toBeNull();
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
      'https://apply.workable.com/acme/j/0123456789/apply/']) {
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
});

describe('the company career sites (v3 Phase 8)', () => {
  /** Whether a registration reaches an address, as Chrome reads its matches and exclusions. */
  const reaches = (registration: { matches: string[]; excludeMatches?: string[] }, url: string) =>
    registration.matches.some((pattern) => new MatchPattern(pattern).includes(url))
    && !(registration.excludeMatches ?? []).some((pattern) => new MatchPattern(pattern).includes(url));

  it("registers the sentinel while on alone, in the top frame only, inside the optional host permission", () => {
    expect(OPTIONAL_HOST_PERMISSIONS).toEqual(['https://*/*']);
    expect(registrationsFor({ sites: false })).toEqual([]);
    expect(registrationsFor({ sites: true })).toEqual([{ id: 'tailorit-sites', js: ['sentinel.js'], matches: [SITES_MATCH],
      excludeMatches: [...ATS_MATCHES, 'https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*',
        'https://*.licdn.com/*', 'https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*',
        'https://*.sapsf.eu/*'], allFrames: false, runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED' }]);
  });

  // Every address the registration reaches is one isCompanySiteUrl takes, and the other way round.
  const addresses = ['https://careers.acme.example/jobs/1', 'https://www.amazon.jobs/en/jobs/1/x', 'https://www.linkedin.com/jobs/view/4012345678/',
    'https://linkedin.com/jobs/view/4012345678/', 'https://uk.linkedin.com/jobs/search/?currentJobId=4012345678',
    'https://www.linkedin.cn/jobs/1', 'https://lnkd.in/abc', 'https://media.licdn.com/x.js', 'https://job-boards.greenhouse.io/acme/jobs/1',
    'https://login.icims.com/u/login', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/x',
    'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/x', 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x',
    'https://oraclecloud.com/', 'https://acme.myworkday.com/acme/d/home.htmld', 'https://wd5.myworkday.com/acme/login.htmld',
    'https://performancemanager4.sapsf.com/sf/home', 'https://hcm.sapsf.eu/sf/home', 'https://career5.successfactors.eu/career?x=1',
    'https://acme.wd5.myworkdayjobs.com/x', 'http://careers.acme.example/jobs/1'];

  it('reaches a company page, and never LinkedIn (deferred to v5), an employee HR system, an ATS host or an http page', () => {
    const [sites] = registrationsFor({ sites: true });
    const reached = addresses.filter((url) => reaches(sites!, url));
    expect(reached).toEqual(['https://careers.acme.example/jobs/1', 'https://www.amazon.jobs/en/jobs/1/x']);
    for (const url of addresses) expect(isCompanySiteUrl(url), url).toBe(reached.includes(url));
  });

  it("knows the employee HR systems' hosts (the Phase 8 review, B4)", () => {
    for (const host of ['acme.fa.us2.oraclecloud.com', 'oraclecloud.com', 'acme.myworkday.com', 'hcm.sapsf.com', 'hcm.sapsf.eu',
      'X.SAPSF.COM.']) {
      expect(isHrHost(host), host).toBe(true);
    }
    for (const host of ['acme.wd5.myworkdayjobs.com', 'sapsf.com.evil.example', 'notoraclecloud.com', 'careers.acme.example']) {
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
