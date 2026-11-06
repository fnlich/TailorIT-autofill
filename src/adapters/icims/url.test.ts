/*
 * iCIMS's URL parser on its own (v3 Phase 7b): which addresses are an iCIMS portal's, the posting, its wrapper's frame,
 * the email gate and the pages after it, as the public capture met them (docs/FIXTURES.md), and the canonical
 * application URL. src/adapters/url.test.ts holds the table shared with the other parsers and the contract's parseAtsUrl.
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

  it('reads no other page: "Log back in", the pages after the gate, the referral, a search, the portal', () => {
    for (const address of [`${PORTAL}/jobs/13634/credit-reviewer-ii/login?loginOnly=1&redirect=job&in_iframe=1&hashed=1`,
      // What follows the gate is not public: no word of it is read until the owner's snapshots name one (C11).
      `${PORTAL}/jobs/13634/credit-reviewer-ii/candidate?in_iframe=1`,
      `${PORTAL}/jobs/13634/credit-reviewer-ii/referral?in_iframe=1`, `${PORTAL}/jobs/search?ss=1`,
      `${PORTAL}/jobs/intro`, PORTAL, `${PORTAL}/jobs/13634/engineer`, `${PORTAL}/jobs/x/credit/job`,
      `${PORTAL}/jobs/13634/a/b/job`, `${PORTAL}/jobs/13634/credit-reviewer-ii/Job`]) {
      expect(parseIcimsUrl(at(address)), address).toBeNull();
    }
  });
});
