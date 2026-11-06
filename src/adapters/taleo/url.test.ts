/*
 * Taleo's URL parser on its own (v3 Phase 7b): which addresses are a Taleo portal's, the posting, its apply address and
 * its account pages (which name their job in redirectionURI, encoded or not), as the public capture met them
 * (docs/FIXTURES.md), and the canonical application URL. src/adapters/url.test.ts holds the shared table.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseTaleoUrl } from './url';

const at = (address: string) => new URL(address);
const HDR = 'https://hdr.taleo.net';
const POSTING = `${HDR}/careersection/ex/jobdetail.ftl?job=197675&lang=en`;
const APPLY = `${HDR}/careersection/ex/jobapply.ftl?job=197675&lang=en`;
const ENCODED = encodeURIComponent(APPLY);

describe('matchesUrl', () => {
  it.each([POSTING, 'https://cpsk12il.taleo.net/careersection/3/jobdetail.ftl?job=P177162&lang=en', `${HDR}/careersection/ex/jobsearch.ftl`])(
    'takes a company portal: %s', (address) => expect(matchesUrl(at(address))).toBe(true));

  it.each(['https://www.taleo.net/', 'https://acme.tbe.taleo.net/careersection/ex/jobdetail.ftl?job=1', `http://hdr.taleo.net/x`,
    'https://taleo.net/x', 'https://hdr.taleo.net:8443/x', 'https://hdr.taleo.net.evil.example/x'])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseTaleoUrl', () => {
  const posting = { platform: 'taleo', board: 'hdr', jobId: '197675', applicationUrl: APPLY };

  it('reads the posting and its apply address as one posting', () => {
    expect(parseTaleoUrl(at(POSTING))).toEqual({ ...posting, page: 'posting' });
    expect(parseTaleoUrl(at(`${HDR}/careersection/ex/jobdetail.ftl?job=197675&tz=GMT-05%3A00&tzname=America%2FChicago&lang=en`)))
      .toEqual({ ...posting, page: 'posting' });
    expect(parseTaleoUrl(at(APPLY))).toEqual({ ...posting, page: 'application' });
    expect(parseTaleoUrl(at(`${HDR}/careersection/ex/jobapply.ftl?lang=en&job=197675`)))
      .toEqual({ ...posting, page: 'application' });
    expect(canonicalApplicationUrl(at(APPLY))).toBe(APPLY);
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it('reads an account page by the job its redirectionURI or TARGET names, encoded or written plain', () => {
    for (const address of [`${HDR}/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=${ENCODED}&TARGET=${ENCODED}`,
      `${HDR}/careersection/iam/accessmanagement/login.jsf?TARGET=${ENCODED}`,
      `${HDR}/careersection/iam/accessmanagement/forgotPasswordAccessCode.jsf?redirectionURI=${ENCODED}`,
      `${HDR}/careersection/iam/accessmanagement/forgotPasswordAccessCode.jsf?forgotUsername=null&userEmail=null&portal=null&userName=null&redirectionURI=https://hdr.taleo.net/careersection/ex/jobapply.ftl?job=197675&lang=en`,
      `${HDR}/careersection/iam/accessmanagement/forgotUsername.jsf?redirectionURI=${ENCODED}`,
      `${HDR}/careersection/careersection/privacyagreement/statementBeforeAuthentification.jsf?redirectionURI=${ENCODED}`,
      // Its lang= first (v3 Phase 6/7b review, C11): encoded, and written plain, whose job= is then the page's own.
      `${HDR}/careersection/iam/accessmanagement/login.jsf?redirectionURI=${encodeURIComponent(`${HDR}/careersection/ex/jobapply.ftl?lang=en&job=197675`)}`,
      `${HDR}/careersection/iam/accessmanagement/login.jsf?redirectionURI=${HDR}/careersection/ex/jobapply.ftl?lang=en&job=197675`]) {
      expect(parseTaleoUrl(at(address)), address).toEqual({ ...posting, page: 'application' });
    }
  });

  it('reads a flow page only where it names the job, and nothing else', () => {
    expect(parseTaleoUrl(at(`${HDR}/careersection/ex/flow.jsf?job=197675&lang=en`))).toEqual({ ...posting, page: 'application' });
    for (const address of [`${HDR}/careersection/ex/flow.jsf?lang=en`, `${HDR}/careersection/ex/jobsearch.ftl`,
      `${HDR}/careersection/ex/jobdetail.ftl`, `${HDR}/careersection/iam/accessmanagement/login.jsf`,
      // Another host's apply address, or one over http, is no job of this page.
      `${HDR}/careersection/iam/accessmanagement/login.jsf?redirectionURI=${encodeURIComponent('https://evil.taleo.net/careersection/ex/jobapply.ftl?job=1')}`,
      `${HDR}/careersection/iam/accessmanagement/login.jsf?redirectionURI=${encodeURIComponent('http://hdr.taleo.net/careersection/ex/jobapply.ftl?job=1')}`,
      `${HDR}/careersection/ex/jobdetail.ftl?job=a%20b`, `${HDR}/careersection/a/b/jobdetail.ftl?job=1`]) {
      expect(parseTaleoUrl(at(address)), address).toBeNull();
    }
  });
});
