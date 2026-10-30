/*
 * Lever's URL parser on its own: which addresses are Lever's, the form, posting and confirmation pages of one posting,
 * and the canonical application URL. src/adapters/url.test.ts holds the table shared with Greenhouse and the
 * contract's parseAtsUrl, and the application key.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseLeverUrl } from './url';

const SPOTIFY = 'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b';
const ZOOX = 'https://jobs.lever.co/zoox/e8a190f0-7a89-4c11-a6a0-452ff6234749';
const at = (address: string) => new URL(address);

describe('matchesUrl', () => {
  it.each([
    `${SPOTIFY}/apply`, SPOTIFY, `${SPOTIFY}/apply/thanks`, 'https://jobs.lever.co/spotify', 'https://jobs.lever.co/',
    'https://jobs.eu.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply', 'https://JOBS.LEVER.CO/x',
    'https://jobs.lever.co:443/spotify',
  ])('takes every page on a Lever host: %s', (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each([
    `http://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply`,
    'https://lever.co/spotify', 'https://hire.lever.co/spotify', 'https://api.lever.co/v0/postings/spotify',
    'https://jobs.lever.co.tailorit-fixture.example/spotify', 'https://tailorit-fixture.example/jobs.lever.co/spotify',
    'https://jobs.lever.co:8443/spotify', 'https://someone@jobs.lever.co/spotify', 'https://job-boards.greenhouse.io/gitlab',
  ])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseLeverUrl', () => {
  it('reads the form, the posting page and the page after submitting as one posting', () => {
    const posting = { platform: 'lever', board: 'spotify', jobId: '2a55d6c9-c564-443a-be3e-a3851db5a93b',
      applicationUrl: `${SPOTIFY}/apply` };
    expect(parseLeverUrl(at(`${SPOTIFY}/apply`))).toEqual({ ...posting, page: 'application' });
    expect(parseLeverUrl(at(SPOTIFY))).toEqual({ ...posting, page: 'posting' });
    expect(parseLeverUrl(at(`${SPOTIFY}/apply/thanks`))).toEqual({ ...posting, page: 'confirmation' });
    expect(parseLeverUrl(at(`${SPOTIFY}/thanks`))).toEqual({ ...posting, page: 'confirmation' });
  });

  it('ignores the query, the fragment and one trailing slash', () => {
    for (const address of [`${ZOOX}/apply?lever-source=LinkedIn&lever-origin=applied`, `${ZOOX}/apply#application`,
      `${ZOOX}/apply/`]) {
      expect(parseLeverUrl(at(address))?.applicationUrl, address).toBe(`${ZOOX}/apply`);
    }
  });

  it('keeps the site as written but folds its case, and the UUID, in the application URL', () => {
    expect(parseLeverUrl(at('https://JOBS.LEVER.CO/Spotify/2A55D6C9-C564-443A-BE3E-A3851DB5A93B/apply'))).toEqual({
      platform: 'lever', board: 'Spotify', jobId: '2a55d6c9-c564-443a-be3e-a3851db5a93b', page: 'application',
      applicationUrl: `${SPOTIFY}/apply` });
  });

  it('keeps the EU host in the application URL', () => {
    const eu = 'https://jobs.eu.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001';
    expect(parseLeverUrl(at(`${eu}/apply`))?.applicationUrl).toBe(`${eu}/apply`);
  });

  it.each([
    'https://jobs.lever.co/spotify', 'https://jobs.lever.co/', 'https://jobs.lever.co/spotify/not-a-uuid/apply',
    `${SPOTIFY}/APPLY`, `${SPOTIFY}/apply/extra`, `${SPOTIFY}/apply//`, `${SPOTIFY}/constructor`,
    'https://jobs.lever.co//2a55d6c9-c564-443a-be3e-a3851db5a93b/apply',
    'https://jobs.lever.co/spo%20tify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply',
    'https://jobs.lever.co/spotify/2a55d6c9c564443abe3ea3851db5a93b/apply',
    `http://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply`,
  ])('reads no posting from %s', (address) => {
    expect(parseLeverUrl(at(address))).toBeNull();
  });
});

describe('canonicalApplicationUrl', () => {
  it('is the form address on the form, and null on the posting page and after submitting', () => {
    expect(canonicalApplicationUrl(at(`${SPOTIFY}/apply?lever-source=LinkedIn`))).toBe(`${SPOTIFY}/apply`);
    expect(canonicalApplicationUrl(at(SPOTIFY))).toBeNull();
    expect(canonicalApplicationUrl(at(`${SPOTIFY}/apply/thanks`))).toBeNull();
    expect(canonicalApplicationUrl(at('https://jobs.lever.co/spotify'))).toBeNull();
  });
});
