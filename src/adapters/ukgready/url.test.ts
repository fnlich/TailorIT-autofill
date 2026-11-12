/*
 * UKG Ready's address reader on its own (jr7 FIX7PLAN §6.14 items 2 and 3; UKGR-3, UKGR-V3), with the registry's
 * readings of its pages: the posting keyed per job (ShowJob alone), the applicant session an application under the
 * tenant (the referrer chain gives it the posting's key: adapters/chain.ts, CHAIN-7), every other page none, the
 * employee pages off (shared/hosts.ts: the HR rule), and the address TailorIT is asked with. The shapes are snapshot7's
 * [secure7.saashr.com] (fixtures/ukgready/jr7-saashr-*), with made-up company, employer and job numbers.
 */
import { describe, expect, it } from 'vitest';
import { platformOfUrl, isHrHost } from '../../shared/hosts';
import { postingAddressOf } from '../address';
import { applicationKey } from '../application-key';
import { applicationOf } from '../index';
import { tailoritAddressOf } from '../tailorit-address';
import { ukgReadyAdapter } from './index';
import { canonicalApplicationUrl, parseUkgReadyUrl } from './url';

const HOST = 'https://secure7.saashr.com';
const CAREERS = `${HOST}/ta/1234567.careers`;
/** jr7-saashr-posting's address, as its header writes it, with made-up numbers and source. */
const POSTING = `${CAREERS}?lang=en-US&ein_id=987654321&ShowJob=123456789&src=JobBoard`;
/** jr7-saashr-contact's (and every later step's) address, its session values made up. */
const SESSION = `${CAREERS}?rnd=ABC&Ext=careers&sft=QWERTYUIOP&ActiveSessionId=11122233344#applicant/profile`;
const at = (address: string) => new URL(address);

describe('parseUkgReadyUrl', () => {
  it('reads the posting as its job, keyed by ShowJob alone (UKGR-V3)', () => {
    expect(parseUkgReadyUrl(at(POSTING))).toEqual({ platform: 'ukgready', board: '1234567', jobId: '123456789',
      page: 'posting', applicationUrl: `${CAREERS}?ShowJob=123456789` });
    // Every spelling of one posting is one application: ein_id, lang, src, the order, the host's case, a fragment.
    const spellings = [POSTING, `${CAREERS}?ShowJob=123456789`, `${CAREERS}?ShowJob=123456789&ein_id=987654321`,
      `${CAREERS}?src=Other&ShowJob=123456789&lang=fr-CA`, 'https://SECURE7.SAASHR.COM/ta/1234567.careers?ShowJob=123456789',
      `${CAREERS}?ShowJob=123456789#top`];
    expect(new Set(spellings.map((address) => parseUkgReadyUrl(at(address))?.applicationUrl)))
      .toEqual(new Set([`${CAREERS}?ShowJob=123456789`]));
    // Another job of the tenant is another application.
    expect(parseUkgReadyUrl(at(`${CAREERS}?ShowJob=123456790`))?.applicationUrl).toBe(`${CAREERS}?ShowJob=123456790`);
  });

  it('reads the applicant session as an application of the tenant, never by a session value (UKGR-3)', () => {
    expect(parseUkgReadyUrl(at(SESSION))).toEqual({ platform: 'ukgready', board: '1234567', jobId: '', page: 'application',
      applicationUrl: CAREERS });
    expect(canonicalApplicationUrl(at(SESSION))).toBe(CAREERS);
    // Another session of the tenant reads the same: no session value is in the reading.
    expect(parseUkgReadyUrl(at(`${CAREERS}?ActiveSessionId=99988877766&sft=Z&rnd=Q`))).toEqual(parseUkgReadyUrl(at(SESSION)));
    expect(JSON.stringify(parseUkgReadyUrl(at(SESSION)))).not.toMatch(/11122233344|QWERTYUIOP|ABC|sft|rnd/);
    // A posting's canonical application URL is none: its form is drawn in place, under the posting's own key.
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it.each([
    // The careers search, and the careers page with neither a posting nor a session.
    CAREERS, `${CAREERS}?lang=en-US`, `${CAREERS}?ActiveSessionId=`, `${CAREERS}?ShowJob=`,
    // A ShowJob that is no number, or two of them.
    `${CAREERS}?ShowJob=abc`, `${CAREERS}?ShowJob=1234567890123456`, `${CAREERS}?ShowJob=1&ShowJob=2`,
    // The employee system's pages (the HR rule keeps them off), another path, a company number of another shape.
    `${HOST}/ta/1234567.login`, `${HOST}/ta/1234567.home`, `${HOST}/ta/1234567.login?ShowJob=123456789`,
    `${HOST}/ta/1234567.careers/x?ShowJob=1`, `${HOST}/ta/12.careers?ShowJob=1`, `${HOST}/ta/acme.careers?ShowJob=1`,
    `${HOST}/?ShowJob=1`,
    // Not UKG Ready's candidate host, or not plainly it.
    'http://secure7.saashr.com/ta/1234567.careers?ShowJob=1', 'https://secure7.saashr.com:8443/ta/1234567.careers?ShowJob=1',
    'https://someone@secure7.saashr.com/ta/1234567.careers?ShowJob=1', 'https://secure123.saashr.com/ta/1234567.careers?ShowJob=1',
    'https://secure7.saashr.com.example/ta/1234567.careers?ShowJob=1', 'https://www.saashr.com/ta/1234567.careers?ShowJob=1',
    'https://jobs.lever.co/ta/1234567.careers?ShowJob=1',
  ])('reads nothing at %s', (address) => {
    expect(parseUkgReadyUrl(at(address))).toBeNull();
    expect(canonicalApplicationUrl(at(address))).toBeNull();
  });

  it("takes the data centres' other hosts as secure7's (shared/hosts.ts names secure<n>)", () => {
    for (const host of ['secure', 'secure4', 'secure12']) {
      expect(parseUkgReadyUrl(at(`https://${host}.saashr.com/ta/1234567.careers?ShowJob=5`))?.applicationUrl)
        .toBe(`https://${host}.saashr.com/ta/1234567.careers?ShowJob=5`);
    }
  });
});

describe("the registry's reading of UKG Ready's pages", () => {
  it('names the posting and the session as UKG Ready pages, and the employee pages as none (the HR rule)', () => {
    expect(postingAddressOf(at(POSTING))).toEqual({ platform: 'ukgready', page: 'posting',
      applicationUrl: `${CAREERS}?ShowJob=123456789` });
    expect(postingAddressOf(at(SESSION))).toEqual({ platform: 'ukgready', page: 'application', applicationUrl: CAREERS });
    expect(applicationOf(at(POSTING))?.applicationKey).toBe(applicationKey('ukgready', `${CAREERS}?ShowJob=123456789`));
    expect(applicationOf(at(SESSION))?.applicationKey).toBe(applicationKey('ukgready', CAREERS));
    // Two postings of one tenant are two applications (UKGR-3: no longer one key per employer).
    expect(applicationOf(at(`${CAREERS}?ShowJob=1`))?.applicationKey)
      .not.toBe(applicationOf(at(`${CAREERS}?ShowJob=2`))?.applicationKey);
    for (const address of [`${HOST}/ta/1234567.login`, `${HOST}/ta/1234567.home`]) {
      expect(platformOfUrl(address), address).toBeNull();
      expect(isHrHost(new URL(address).hostname), address).toBe(true);
      expect(applicationOf(at(address)), address).toBeNull();
    }
    expect(ukgReadyAdapter.matchesUrl(at(POSTING))).toBe(true);
    expect(ukgReadyAdapter.matchesUrl(at(SESSION))).toBe(true);
    expect(ukgReadyAdapter.matchesUrl(at(`${HOST}/ta/1234567.login`))).toBe(false);
    expect(ukgReadyAdapter.canonicalApplicationUrl(at(SESSION))).toBe(CAREERS);
  });

  it('asks TailorIT by the posting with ShowJob alone, and by the tenant from the session: never a session value', () => {
    expect(tailoritAddressOf(POSTING)).toBe(`${CAREERS}?ShowJob=123456789`);
    expect(tailoritAddressOf(SESSION)).toBe(CAREERS);
  });
});
