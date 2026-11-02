/*
 * Ashby's URL parser on its own: which addresses are Ashby's, the overview, the form and the embed's spelling of one
 * posting, and the canonical application URL. src/adapters/url.test.ts holds the table shared with Lever, Greenhouse
 * and the contract's parseAtsUrl, and the application key.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseAshbyUrl } from './url';

const OPENAI = 'https://jobs.ashbyhq.com/openai/d4780eac-03ad-4dae-861f-99af22b4287e';
const EMBED_ID = '7458d4e9-da2e-47bd-98cb-adfda43d42b2';
const at = (address: string) => new URL(address);

describe('matchesUrl', () => {
  it.each([
    `${OPENAI}/application`, OPENAI, 'https://jobs.ashbyhq.com/openai', 'https://jobs.ashbyhq.com/',
    `https://jobs.ashbyhq.com/Ashby/${EMBED_ID}?embed=js`, 'https://JOBS.ASHBYHQ.COM/x', 'https://jobs.ashbyhq.com:443/x',
    'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting',
  ])('takes every page on Ashby\'s board host: %s', (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each([
    `http://jobs.ashbyhq.com/openai/d4780eac-03ad-4dae-861f-99af22b4287e/application`,
    `https://www.ashbyhq.com/careers?ashby_jid=${EMBED_ID}`, 'https://api.ashbyhq.com/posting-api/job-board/openai',
    'https://app.ashbyhq.com/openai', 'https://ashbyhq.com/openai', 'https://jobs.ashbyhq.com.tailorit-fixture.example/x',
    'https://jobs.ashbyhq.com:8443/openai', 'https://someone@jobs.ashbyhq.com/openai', 'https://jobs.lever.co/spotify',
  ])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseAshbyUrl', () => {
  it('reads the form and the overview as one posting, with one application URL', () => {
    const posting = { platform: 'ashby', board: 'openai', jobId: 'd4780eac-03ad-4dae-861f-99af22b4287e',
      applicationUrl: `${OPENAI}/application` };
    expect(parseAshbyUrl(at(`${OPENAI}/application`))).toEqual({ ...posting, page: 'application' });
    expect(parseAshbyUrl(at(OPENAI))).toEqual({ ...posting, page: 'posting' });
  });

  it("reads the embed's addresses, its org as the company writes it, as the hosted posting's", () => {
    const applicationUrl = `https://jobs.ashbyhq.com/ashby/${EMBED_ID}/application`;
    expect(parseAshbyUrl(at(`https://jobs.ashbyhq.com/Ashby/${EMBED_ID}?embed=js`))).toEqual({ platform: 'ashby',
      board: 'Ashby', jobId: EMBED_ID, page: 'posting', applicationUrl });
    expect(parseAshbyUrl(at(`https://jobs.ashbyhq.com/Ashby/${EMBED_ID}/application?embed=js`))).toEqual({
      platform: 'ashby', board: 'Ashby', jobId: EMBED_ID, page: 'application', applicationUrl });
  });

  it('ignores the query, the fragment and one trailing slash, and folds the org and the id', () => {
    for (const address of [`${OPENAI}/application?utm_source=LinkedIn`, `${OPENAI}/application#form`,
      `${OPENAI}/application/`, 'https://jobs.ashbyhq.com/OpenAI/D4780EAC-03AD-4DAE-861F-99AF22B4287E/application',
      `${OPENAI}/application?embed=js`]) {
      expect(parseAshbyUrl(at(address))?.applicationUrl, address).toBe(`${OPENAI}/application`);
    }
    expect(parseAshbyUrl(at('https://jobs.ashbyhq.com/OpenAI/d4780eac-03ad-4dae-861f-99af22b4287e'))?.board).toBe('OpenAI');
  });

  it.each([
    'https://jobs.ashbyhq.com/openai', 'https://jobs.ashbyhq.com/openai/embed?version=2',
    'https://jobs.ashbyhq.com/openai/not-a-uuid/application', `${OPENAI}/APPLICATION`, `${OPENAI}/apply`,
    `${OPENAI}/application/thanks`, 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting',
    'https://jobs.ashbyhq.com/open%2Fai/d4780eac-03ad-4dae-861f-99af22b4287e/application'.replace('%2F', '/'),
    'https://jobs.ashbyhq.com/open:ai/d4780eac-03ad-4dae-861f-99af22b4287e', `https://www.ashbyhq.com/careers?ashby_jid=${EMBED_ID}`,
  ])('reads no posting from %s', (address) => {
    expect(parseAshbyUrl(at(address))).toBeNull();
  });
});

describe('canonicalApplicationUrl', () => {
  it('is the form\'s address on the form, and null on the overview and elsewhere', () => {
    expect(canonicalApplicationUrl(at(`${OPENAI}/application?embed=js`))).toBe(`${OPENAI}/application`);
    expect(canonicalApplicationUrl(at(OPENAI))).toBeNull();
    expect(canonicalApplicationUrl(at('https://jobs.ashbyhq.com/openai'))).toBeNull();
  });
});
