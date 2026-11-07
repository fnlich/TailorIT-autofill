/*
 * iCIMS's URL parser on its own (v3 Phase 7b): which addresses are an iCIMS portal's, the posting, its wrapper's frame,
 * the email gate and the pages after it, as the public capture met them (docs/FIXTURES.md) and the owner's snapshots of
 * 2026-11-06 showed them (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06: the Candidate Profile, the questions, EEO, the IForm page and the page
 * after submitting, each in a wrapper or on its own), and the canonical application URL. src/adapters/url.test.ts holds
 * the table shared with the other parsers and the contract's parseAtsUrl.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseIcimsUrl } from './url';

const at = (address: string) => new URL(address);
const PORTAL = 'https://careers-eastwestbank.icims.com';
const POSTING = `${PORTAL}/jobs/13634/credit-reviewer-ii/job`;
const CANONICAL = `${PORTAL}/jobs/13634/job`;

describe('matchesUrl', () => {
  it.each([POSTING, 'https://careers-emcorgroup.icims.com/jobs/54460/x/job', 'https://acme.icims.com/jobs/1/job'])(
    'takes a company portal: %s', (address) => expect(matchesUrl(at(address))).toBe(true));

  it.each(['https://login.icims.com/u/login/identifier?state=x', 'https://www.icims.com/', 'https://api.icims.com/x',
    'https://internal-acme.icims.com/jobs/1/job', `http://careers-eastwestbank.icims.com/jobs/13634/x/job`,
    'https://careers-eastwestbank.icims.com:8443/jobs/1/job', 'https://icims.com/jobs/1/job',
    'https://careers-eastwestbank.icims.com.evil.example/jobs/1/job'])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseIcimsUrl', () => {
  const posting = { platform: 'icims', board: 'careers-eastwestbank', jobId: '13634', applicationUrl: CANONICAL };

  it('reads the wrapper, its frame, the apply link, the gate and its post as one posting', () => {
    for (const address of [POSTING, `${POSTING}?mobile=false&width=1270&height=500&bga=true&needsRedirect=false`,
      `${POSTING}?in_iframe=1`, `${POSTING}?mode=apply&apply=yes&in_iframe=1&hashed=-336056110`, `${PORTAL}/jobs/13634/x/job`,
      `${PORTAL}/jobs/13634/job`]) {
      expect(parseIcimsUrl(at(address)), address).toEqual({ ...posting, page: 'posting' });
    }
    for (const address of [`${PORTAL}/jobs/13634/credit-reviewer-ii/login`, `${PORTAL}/jobs/13634/credit-reviewer-ii/login?in_iframe=1`,
      `${PORTAL}/jobs/13634/credit-reviewer-ii/login?step=email&in_iframe=1&hashed=1`, `${PORTAL}/jobs/13634/login`]) {
      expect(parseIcimsUrl(at(address)), address).toEqual({ ...posting, page: 'application' });
    }
    expect(canonicalApplicationUrl(at(`${PORTAL}/jobs/13634/x/login`))).toBe(CANONICAL);
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it('reads the pages after the gate as the application, each as the owner’s snapshots address it', () => {
    // The owner's snapshots of 2026-11-06, their query values replaced: the profile from the email's link and from the
    // gate, after a resume was read, both questions pages and the one after an error, EEO, an IForm page; in a wrapper
    // and in its frame (in_iframe=1), or on their own (careers-aaalife's, careers-ars's).
    const slug = 'continual-service-improvement-manager%2c-global-infrastructure-and-operations';
    const nyu = { platform: 'icims', board: 'uscareers-nyu', jobId: '16462',
      applicationUrl: 'https://uscareers-nyu.icims.com/jobs/16462/job' };
    for (const address of [`https://uscareers-nyu.icims.com/jobs/16462/${slug}/candidate?from=login&eem=E&code=C`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/candidate?from=login&eem=E&code=C&in_iframe=1`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/login?step=email&in_iframe=1&hashed=1`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/eeo?back=&in_iframe=1`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/form?form=US_Employment_Application&step=2&type=x&hashed=1&in_iframe=1`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/form?form=jsf-1793623031081-16462&step=7&isPacket=1&type=x&hashed=1`]) {
      expect(parseIcimsUrl(at(address)), address).toEqual({ ...nyu, page: 'application' });
      expect(canonicalApplicationUrl(at(address)), address).toBe(nyu.applicationUrl);
    }
    const github = 'https://careers-githubinc.icims.com/jobs/6961/senior-software-engineer%2c-compute-platform';
    for (const address of [`${github}/candidate?from=login&csrf=X&hashed=1&uploadResume=1&uploadResume=1`,
      `${github}/questions?global=1&in_iframe=1`, `${github}/questions?back=&global=&csrf=X&in_iframe=1&hashed=1`,
      'https://careers-aaalife.icims.com/jobs/2227/engineering-manager%2c-devops/questions?global=1',
      'https://careers-ars.icims.com/jobs/69503/azure-infrastructure-engineer/eeo?back=']) {
      expect(parseIcimsUrl(at(address))?.page, address).toBe('application');
    }
  });

  it('reads /job?mode=submit_apply as the page after submitting, never the application', () => {
    const slug = 'continual-service-improvement-manager%2c-global-infrastructure-and-operations';
    for (const address of [`https://uscareers-nyu.icims.com/jobs/16462/${slug}/job?mode=submit_apply`,
      `https://uscareers-nyu.icims.com/jobs/16462/${slug}/job?mode=submit_apply&in_iframe=1`]) {
      expect(parseIcimsUrl(at(address)), address).toEqual({ platform: 'icims', board: 'uscareers-nyu', jobId: '16462',
        page: 'confirmation', applicationUrl: 'https://uscareers-nyu.icims.com/jobs/16462/job' });
      expect(canonicalApplicationUrl(at(address)), address).toBeNull();
    }
    // The posting's own modes stay the posting.
    expect(parseIcimsUrl(at(`${POSTING}?mode=apply&apply=yes&in_iframe=1`))?.page).toBe('posting');
    expect(parseIcimsUrl(at(`${POSTING}?mode=submit&in_iframe=1`))?.page).toBe('posting');
  });

  it('reads no IForm’s own form frame (<co>.icims.com/forms): it names no posting', () => {
    for (const address of ['https://nyu.icims.com/forms?module=Forms&action=showForm&brandtype=ccc&portalid=85&form=US_Employment_Application&user=1&item=2&token=T&csrf=C&in_iframe=1&step=2&aid=3',
      'https://nyu.icims.com/forms?token=T&isPacket=1&brandtype=ccc&portalid=85&selected=Reasonable_Accommodation_Notice&in_iframe=1&step=6',
      'https://edgewaterit.icims.com/forms?module=Forms&action=showForm&form=Voluntary_Self_Identification_Forms&in_iframe=1&step=6']) {
      expect(parseIcimsUrl(at(address)), address).toBeNull();
    }
  });

  it('reads no other page: "Log back in", the referral, a search, the portal', () => {
    for (const address of [`${PORTAL}/jobs/13634/credit-reviewer-ii/login?loginOnly=1&redirect=job&in_iframe=1&hashed=1`,
      `${PORTAL}/jobs/13634/credit-reviewer-ii/referral?in_iframe=1`, `${PORTAL}/jobs/search?ss=1`,
      `${PORTAL}/jobs/13634/credit-reviewer-ii/Candidate`, `${PORTAL}/jobs/13634/credit-reviewer-ii/forms`,
      `${PORTAL}/jobs/intro`, PORTAL, `${PORTAL}/jobs/13634/engineer`, `${PORTAL}/jobs/x/credit/job`,
      `${PORTAL}/jobs/13634/a/b/job`, `${PORTAL}/jobs/13634/credit-reviewer-ii/Job`]) {
      expect(parseIcimsUrl(at(address)), address).toBeNull();
    }
  });
});
