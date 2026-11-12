/*
 * jr7 ICIMS-7 (ICIMS7-04 (1); FIX7PLAN §6.7 item 2): iCIMS's Assessments step, /jobs/<id>/<slug>/assessment, the step
 * after the last form's Submit (the owner's snapshot7 of 2026-11-11, icims3: careers-quartzbenefits, its wrapper and its
 * frame, fixtures/icims/jr7-icims3-assessment), is a page of the application: it keeps the application's key, as the
 * gate and every step after it do, so the page after it (/job?mode=submit_apply&from=assessment) confirms the same
 * application. TailorIT's contract (src/contract/tailorit/lookup.ts ICIMS_PAGES) does not read the word until TAILORIT-7's
 * 7a is pulled (FIX7PLAN §0.6): the row is held here ahead of the contract, and the address the extension names the page
 * to TailorIT by (tailorit-address.ts: the posting's canonical address) is one TailorIT reads today. INT-7 moves it into
 * src/adapters/url.test.ts once the contract reads it. Made-up job ids in the captured shapes.
 */
import { describe, expect, it } from 'vitest';
import { parseAtsUrl } from '../../contract/tailorit/lookup';
import { applicationKey } from '../application-key';
import { tailoritAddressOf } from '../tailorit-address';
import { canonicalApplicationUrl, parseIcimsUrl } from './url';

const PORTAL = 'https://careers-acme.icims.com';
const BASE = `${PORTAL}/jobs/2446/technical-delivery-specialist`;
const CANONICAL = `${PORTAL}/jobs/2446/job`;

/** The Assessments step as snapshot7's icims3 addresses it: the wrapper's top, its frame, the recovery link's target. */
const ASSESSMENT = [`${BASE}/assessment`, `${BASE}/assessment?in_iframe=1`, `${BASE}/assessment?i=1`,
  `${PORTAL}/jobs/2446/assessment`];

describe('iCIMS’s Assessments step (jr7 ICIMS7-04 (1))', () => {
  it.each(ASSESSMENT)('%s reads as the application, under the posting’s key', (address) => {
    const read = parseIcimsUrl(new URL(address));
    expect(read).toEqual({ platform: 'icims', board: 'careers-acme', jobId: '2446', page: 'application',
      applicationUrl: CANONICAL });
    expect(canonicalApplicationUrl(new URL(address))).toBe(CANONICAL);
    // The same key as the gate's and the page after submitting's (its own key is the application's).
    const gate = parseIcimsUrl(new URL(`${BASE}/login?in_iframe=1`))!;
    const done = parseIcimsUrl(new URL(`${BASE}/job?mode=submit_apply&from=assessment&in_iframe=1`))!;
    expect(done.page).toBe('confirmation');
    expect(applicationKey('icims', read!.applicationUrl)).toBe(applicationKey('icims', gate.applicationUrl));
    expect(applicationKey('icims', read!.applicationUrl)).toBe(applicationKey('icims', done.applicationUrl));
  });

  it('is ahead of TailorIT’s contract, and named to TailorIT by the posting’s address, which TailorIT reads', () => {
    for (const address of ASSESSMENT) {
      // TAILORIT-7's 7a adds the word to ICIMS_PAGES; until its pull the contract reads the page as none.
      expect(parseAtsUrl(address), address).toBeNull();
      expect(tailoritAddressOf(address), address).toBe(CANONICAL);
      expect(parseAtsUrl(tailoritAddressOf(address)), address)
        .toMatchObject({ kind: 'icims', board: 'careers-acme', externalId: '2446' });
    }
  });

  it('reads no other word after the posting as the application (the referral, a made-up step, a deeper path)', () => {
    for (const address of [`${BASE}/referral`, `${BASE}/assessments`, `${BASE}/assessment/x`, `${BASE}/Assessment`]) {
      expect(parseIcimsUrl(new URL(address)), address).toBeNull();
    }
  });
});
