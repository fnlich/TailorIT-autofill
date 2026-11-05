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
    expect(platformOfUrl('https://apply.workable.com/acme/j/0123456789/apply/')).toBe('workable');
    // Workable's job-search site and the addresses that only redirect to its application host are not matched.
    expect(platformOfUrl('https://jobs.workable.com/view/abc/engineer')).toBeNull();
    expect(platformOfUrl('https://acme.workable.com/j/0123456789')).toBeNull();
    expect(platformOfUrl('https://evil.example/jobs.lever.co')).toBeNull();
    expect(platformOfUrl('http://jobs.lever.co/acme')).toBeNull();
  });

  it('matches through the manifest patterns for exactly the hosts it names', () => {
    const patterns = ATS_MATCHES.map((p) => new MatchPattern(p));
    for (const url of ['https://wlu.wd5.myworkdayjobs.com/x', 'https://jobs.lever.co/a/b/apply',
      'https://apply.workable.com/acme/j/0123456789/apply/']) {
      expect(patterns.some((p) => p.includes(url)), url).toBe(true);
    }
    expect(patterns.some((p) => p.includes('https://careers.example.com/jobs/1'))).toBe(false);
  });
});
