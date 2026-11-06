/*
 * Workday's URL parser on its own (v3 Phase 6): which addresses are Workday's, the posting, its choice and its
 * application in every spelling the public capture's address probes met (docs/FIXTURES.md), and the canonical
 * application URL. src/adapters/url.test.ts holds the table shared with the other parsers and the contract's parseAtsUrl.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseWorkdayUrl } from './url';

const at = (address: string) => new URL(address);
const HOST = 'https://workday.wd5.myworkdayjobs.com';
const SLUG = 'Senior-Product-Manager--Technical_JR-0110787';
const POSTING = `${HOST}/en-US/Workday/job/USA-CA-Pleasanton/${SLUG}`;
const CANONICAL = `${HOST}/workday/job/x/${SLUG}/apply/applyManually`;
const SNAP = 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/Los-Angeles-California/Ad-Product-Quality-Analyst-I_R0047453-1';
const SNAP_CANONICAL = 'https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/x/Ad-Product-Quality-Analyst-I_R0047453-1/apply/applyManually';

describe('matchesUrl', () => {
  it.each([POSTING, SNAP, `${HOST}/en-US/Workday/login`, 'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site',
    'https://wd103.myworkdaysite.com/recruiting/acme/careers'])('takes a candidate host: %s', (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each([`http://workday.wd5.myworkdayjobs.com/en-US/Workday/job/x/${SLUG}`, 'https://www.myworkdayjobs.com/x',
    'https://myworkdayjobs.com/x', 'https://wd5.myworkdayjobs.com/x', 'https://acme.wd5.myworkdaysite.com/x',
    'https://workday.wd5.myworkdayjobs.com:8443/x', 'https://someone@workday.wd5.myworkdayjobs.com/x',
    'https://workday.wd5.myworkdayjobs.com.evil.example/x', 'https://jobs.lever.co/x'])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseWorkdayUrl', () => {
  const posting = { platform: 'workday', board: 'workday', jobId: 'JR-0110787', applicationUrl: CANONICAL };

  it('reads the posting, its choice and its application as one posting, with one application URL', () => {
    expect(parseWorkdayUrl(at(POSTING))).toEqual({ ...posting, page: 'posting' });
    expect(parseWorkdayUrl(at(`${POSTING}/apply`))).toEqual({ ...posting, page: 'posting' });
    expect(parseWorkdayUrl(at(`${POSTING}/apply/applyManually`))).toEqual({ ...posting, page: 'application' });
    expect(canonicalApplicationUrl(at(`${POSTING}/apply/applyManually`))).toBe(CANONICAL);
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it('drops the locale, the free-text location, the query and the fragment, and folds the site to lower case', () => {
    for (const address of [`${HOST}/Workday/job/Anywhere/${SLUG}`, `${HOST}/workday/job/x/${SLUG}/`,
      `${HOST}/en-US/WORKDAY/job/USA%2C-CA%2C-Pleasanton/${SLUG}?source=LinkedIn#top`, `${HOST}/en-US/Workday/job/x/${SLUG}/apply/`]) {
      expect(parseWorkdayUrl(at(address))?.applicationUrl, address).toBe(CANONICAL);
    }
  });

  it('reads the requisition id after the last underscore, and folds the slug’s percent-encoding', () => {
    expect(parseWorkdayUrl(at('https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/California---San-Francisco/Senior-Executive-Assistant_JR337145')))
      .toMatchObject({ board: 'salesforce', jobId: 'JR337145', page: 'posting',
        applicationUrl: 'https://salesforce.wd12.myworkdayjobs.com/external_career_site/job/x/Senior-Executive-Assistant_JR337145/apply/applyManually' });
    expect(parseWorkdayUrl(at(`${HOST}/Workday/job/x/A%2CB_JR1`))?.applicationUrl)
      .toBe(parseWorkdayUrl(at(`${HOST}/Workday/job/x/A,B_JR1`))?.applicationUrl);
  });

  it('reads myworkdaysite.com, its tenant in the path', () => {
    expect(parseWorkdayUrl(at(SNAP))).toEqual({ platform: 'workday', board: 'snapchat', jobId: 'R0047453-1', page: 'posting',
      applicationUrl: SNAP_CANONICAL });
    expect(parseWorkdayUrl(at(`${SNAP}/apply/applyManually`))?.page).toBe('application');
  });

  it("reads the choice's other ways as the application, under its key: the person's own choice (v3 Phase 6/7b, C1)", () => {
    for (const way of ['autofillWithResume', 'useMyLastApplication']) {
      expect(parseWorkdayUrl(at(`${POSTING}/apply/${way}`))).toEqual({ platform: 'workday', board: 'workday',
        jobId: 'JR-0110787', page: 'application', applicationUrl: CANONICAL });
    }
  });

  it('reads a locale in any case, of a language and a region or script, only where a site follows it', () => {
    for (const locale of ['en-us', 'EN-US', 'fr', 'fr-CA', 'zh-Hans', 'fil-PH']) {
      expect(parseWorkdayUrl(at(`${HOST}/${locale}/Workday/job/x/${SLUG}`))?.applicationUrl, locale).toBe(CANONICAL);
    }
    // A site whose name is shaped like a locale is the site.
    expect(parseWorkdayUrl(at(`${HOST}/ext/job/x/${SLUG}`))?.applicationUrl)
      .toBe(`${HOST}/ext/job/x/${SLUG}/apply/applyManually`);
    expect(parseWorkdayUrl(at('https://wd1.myworkdaysite.com/fr-fr/recruiting/snapchat/snap/job/x/A_R1'))?.board)
      .toBe('snapchat');
  });

  it('reads a tenant host with no wd<n>, as shared/hosts.ts names it', () => {
    expect(parseWorkdayUrl(at(`https://acme.myworkdayjobs.com/en-US/External/job/x/${SLUG}`))).toEqual({
      platform: 'workday', board: 'acme', jobId: 'JR-0110787', page: 'posting',
      applicationUrl: `https://acme.myworkdayjobs.com/external/job/x/${SLUG}/apply/applyManually` });
  });

  it('reads no other page: the sign-in, a search, the board', () => {
    for (const address of [`${HOST}/en-US/Workday/login`, `${HOST}/en-US/Workday/userHome`, `${HOST}/en-US/Workday/details/${SLUG}`,
      `${HOST}/en-US/Workday`, `${HOST}/en-US/Workday/job/x/no-requisition`, `${HOST}/en-US/Workday/job/x/_JR1`,
      `${HOST}/en-US/Workday/job/x/${SLUG}/apply/applyManually/extra`, 'https://wd1.myworkdaysite.com/en-US/snap/job/x/A_R1',
      `${HOST}/en-US/Workday/job/x/%E0%A4%A_R1`]) {
      expect(parseWorkdayUrl(at(address)), address).toBeNull();
    }
  });
});
