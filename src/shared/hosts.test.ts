import { describe, expect, it } from 'vitest';
import { MatchPattern } from 'wxt/utils/match-patterns';
import { ATS_MATCHES, platformOfUrl } from './hosts';

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
