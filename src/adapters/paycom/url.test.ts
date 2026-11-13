/*
 * Paycom's address reading (./url.ts; jr7 FIX7PLAN §6.11 Paycom item 2, PC7-03's url half): the posting and the
 * tenant's application page on the shapes of the owner's snapshot7 paycomonline1 captures, every client key and number
 * made up; the application's number never read (D-10); every other address none. The candidate paths agree with
 * src/shared/hosts.ts (the platform's registration), so the parser reads exactly the pages the static script runs on.
 */
import { describe, expect, it } from 'vitest';
import { applicationKey } from '../application-key';
import { platformOfUrl } from '../../shared/hosts';
import { canonicalApplicationUrl, matchesUrl, parsePaycomUrl } from './url';

const KEY = '0123456789ABCDEF0123456789ABCDEF';
const PORTAL = `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}`;
const read = (href: string) => parsePaycomUrl(new URL(href));

describe('Paycom addresses (paycom/url.ts)', () => {
  it('reads the posting by its client key and id, its canonical application address its own', () => {
    for (const href of [`${PORTAL}/jobs/53000`, `${PORTAL}/jobs/53000/`, `${PORTAL}/jobs/53000?source=x#top`]) {
      expect(read(href), href).toEqual({ platform: 'paycom', board: KEY, jobId: '53000', page: 'posting',
        applicationUrl: `${PORTAL}/jobs/53000` });
      expect(canonicalApplicationUrl(new URL(href)), href).toBeNull();
      expect(platformOfUrl(href), href).toBe('paycom');
    }
  });

  it('reads /applications with its route as the tenant\'s application page, never its number (D-10)', () => {
    const pages = [`${PORTAL}/applications#/applications/98765`, `${PORTAL}/applications/#/applications/98765`,
      `${PORTAL}/applications#/applications/11111/questions`, `${PORTAL}/applications?x=1#/applications/22222`];
    for (const href of pages) {
      const parsed = read(href);
      expect(parsed, href).toEqual({ platform: 'paycom', board: KEY, jobId: '', page: 'application',
        applicationUrl: `${PORTAL}/applications` });
      expect(canonicalApplicationUrl(new URL(href)), href).toBe(`${PORTAL}/applications`);
      expect(JSON.stringify(parsed), href).not.toMatch(/98765|11111|22222/);
      expect(platformOfUrl(href), href).toBe('paycom');
    }
    // Two applications of the tenant read one page: its own key is never a person's application (the posting press
    // keys it: CHAIN-7's pair page); the posting's key is another.
    const keys = new Set(pages.map((href) => applicationKey('paycom', read(href)!.applicationUrl)));
    expect(keys.size).toBe(1);
    expect(keys.has(applicationKey('paycom', read(`${PORTAL}/jobs/53000`)!.applicationUrl))).toBe(false);
  });

  it('keeps the client key as written (as CHAIN-7\'s stand-in reads it)', () => {
    const lower = KEY.toLowerCase();
    expect(read(`https://www.paycomonline.net/v4/ats/web.php/portal/${lower}/jobs/7`)?.board).toBe(lower);
  });

  it('reads no other address: no route, another path, the employee pages, another host or scheme', () => {
    for (const href of [
      `${PORTAL}/applications`, // no route: no application
      `${PORTAL}/applications#/`,
      `${PORTAL}/applications#/applications/`,
      `${PORTAL}/applications#/applications/12x`,
      `${PORTAL}/applications#applications/98765`,
      `${PORTAL}/jobs`,
      `${PORTAL}/jobs/12x`,
      `${PORTAL}/jobs/1/apply`,
      `${PORTAL}/career-page`,
      `${PORTAL}`,
      'https://www.paycomonline.net/v4/ats/web.php/portal/x/career-page',
      'https://www.paycomonline.net/v4/ats/web.php/portal/0123/jobs/1', // a key of another shape
      'https://www.paycomonline.net/v4/ee/web.php/app/login',
      `https://www.paycomonline.net/v4/cl/web.php/portal/${KEY}/jobs/1`,
      `https://www.paycomonline.com/v4/ats/web.php/portal/${KEY}/jobs/1`, // waits for a capture
      `https://paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1`,
      `http://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1`,
      `https://www.paycomonline.net:8443/v4/ats/web.php/portal/${KEY}/jobs/1`,
      `https://u:p@www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1`,
      `https://www.paycomonline.net.example.com/v4/ats/web.php/portal/${KEY}/jobs/1`,
    ]) {
      expect(read(href), href).toBeNull();
      expect(canonicalApplicationUrl(new URL(href)), href).toBeNull();
    }
    expect(matchesUrl(new URL(`http://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/1`))).toBe(false);
  });

  it('reads a page wherever hosts.ts registers the candidate path, and none where it does not', () => {
    // The static script runs on the portal's paths (ATS_MATCHES); the platform is Paycom's on the two candidate forms
    // only (HOST_PLATFORMS pathPattern): the parser reads no page the platform is not Paycom's on.
    for (const href of [`${PORTAL}/career-page`, `${PORTAL}/jobs`, 'https://www.paycomonline.net/v4/ee/web.php/app/login']) {
      expect(platformOfUrl(href), href).not.toBe('paycom');
      expect(read(href), href).toBeNull();
    }
  });

  // jr7 DFPC-7 P2: CHAIN-7's worker tests (src/background/chain-jr7.test.ts) stand in for this parser; their reading,
  // restated here, is this parser's on their addresses (and their 20 tests pass with the real parser in its place).
  it('reads CHAIN-7\'s addresses as its worker tests\' stand-in does', () => {
    const standIn = (href: string) => {
      const url = new URL(href);
      const parts = url.protocol === 'https:' && url.hostname === 'www.paycomonline.net'
        ? /^\/v4\/ats\/web\.php\/portal\/([A-Fa-f0-9]{32})\/(?:jobs\/(\d+)|applications)\/?$/.exec(url.pathname) : null;
      if (parts === null) return null;
      const portal = `https://www.paycomonline.net/v4/ats/web.php/portal/${parts[1]}`;
      if (parts[2] !== undefined) {
        return { platform: 'paycom', board: parts[1], jobId: parts[2], page: 'posting',
          applicationUrl: `${portal}/jobs/${parts[2]}` };
      }
      return /^#\/applications\/\d+/.test(url.hash)
        ? { platform: 'paycom', board: parts[1], jobId: '', page: 'application', applicationUrl: `${portal}/applications` }
        : null;
    };
    const other = 'FEDCBA9876543210FEDCBA9876543210';
    for (const href of [`${PORTAL}/jobs/4321`, `${PORTAL}/applications#/applications/98765`,
      `${PORTAL}/applications#/applications/98765/questions`,
      `https://www.paycomonline.net/v4/ats/web.php/portal/${other}/applications#/applications/98765`,
      `${PORTAL}/applications`, `${PORTAL}/career-page`]) {
      expect(read(href), href).toEqual(standIn(href));
    }
  });
});
