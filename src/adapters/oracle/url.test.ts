/*
 * Oracle Recruiting Cloud's URL parser on its own (v3 Phase 7b): which addresses are a tenant's candidate pages, the
 * posting and its application (the email gate and what follows) in the spellings the public capture met
 * (docs/FIXTURES.md), and the canonical application URL. src/adapters/url.test.ts holds the shared table.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, isOracleEmailGate, matchesUrl, parseOracleUrl } from './url';

const at = (address: string) => new URL(address);
const ELHR = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience';
const POSTING = `${ELHR}/en/sites/CX_1001/job/12946`;
const JPMC = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210734835';
/** A tenant on Oracle's government cloud: the owner's snapshot of 2026-11-06 ([iaaxmg.fa.ocs.oraclegovcloud.com]). */
const GOV = 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551';

describe('matchesUrl', () => {
  it.each([POSTING, JPMC, 'https://fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1',
    GOV, `${GOV}/apply/section/1`])(
    "takes a tenant's candidate page: %s", (address) => expect(matchesUrl(at(address))).toBe(true));

  it.each(['https://elhr.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x',
    'https://www.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', `http://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/x`,
    'https://elhr.fa.us2.oraclecloud.com:8443/hcmUI/CandidateExperience/x', 'https://elhr.oraclecloud.com/hcmUI/CandidateExperience/x',
    // The government cloud: only a tenant's fa.ocs host (the snapshot's), never another of its hosts or a look-alike.
    'https://iaaxmg.fa.oraclegovcloud.com/hcmUI/CandidateExperience/x', 'https://iaaxmg.fa.us2.oraclegovcloud.com/hcmUI/CandidateExperience/x',
    'https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome', 'https://iaaxmg.fa.ocs.oraclegovcloud.com.example.com/hcmUI/CandidateExperience/x'])(
    'refuses %s', (address) => expect(matchesUrl(at(address))).toBe(false));
});

describe('parseOracleUrl', () => {
  const posting = { platform: 'oracle', board: 'CX_1001', jobId: '12946', applicationUrl: POSTING };

  it('reads the posting and every page of its application as one posting, the language and the site case folded', () => {
    for (const address of [POSTING, `${POSTING}/`, `${ELHR}/fr/sites/cx_1001/job/12946`, `${ELHR}/en/sites/CX_1001/requisitions/preview/12946`,
      `${POSTING}?utm_medium=jobshare`]) {
      expect(parseOracleUrl(at(address)), address).toEqual({ ...posting, page: 'posting' });
    }
    for (const address of [`${POSTING}/apply/email`, `${POSTING}/apply/section/1`, `${POSTING}/apply`,
      // The quick apply's address (v3 Phase 6/7b review, C11).
      `${POSTING}/easy-apply`, `${POSTING}/easy-apply/`]) {
      expect(parseOracleUrl(at(address)), address).toEqual({ ...posting, page: 'application' });
      expect(canonicalApplicationUrl(at(address))).toBe(POSTING);
    }
    expect(parseOracleUrl(at(JPMC))).toMatchObject({ board: 'CX_1001', jobId: '210734835', page: 'posting' });
    // The government cloud's tenant: its section page is the posting's application, keyed on its own host.
    expect(parseOracleUrl(at(`${GOV}/apply/section/1`))).toEqual({ platform: 'oracle', board: 'CX_2001', jobId: '11551',
      page: 'application', applicationUrl: GOV });
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it('names the email gate by its address alone (v3 Phase 6/7b review, S2)', () => {
    for (const address of [`${POSTING}/apply/email`, `${POSTING}/apply/email/`, `${ELHR}/en/sites/CX_1001/requisitions/preview/12946/apply/email`]) {
      expect(isOracleEmailGate(at(address)), address).toBe(true);
    }
    for (const address of [POSTING, `${POSTING}/apply`, `${POSTING}/apply/section/1`, `${POSTING}/easy-apply`,
      `${POSTING}/apply/email/x`, `${ELHR}/en/sites/CX_1001/my-profile/sign-in`, 'https://example.com/apply/email']) {
      expect(isOracleEmailGate(at(address)), address).toBe(false);
    }
  });

  it('reads no page that names no posting: the profile sign-in, the search, the site', () => {
    for (const address of [`${ELHR}/en/sites/CX_1001/my-profile/sign-in`, `${ELHR}/en/sites/CX_1001/requisitions`,
      `${ELHR}/en/sites/CX_1001`, `${ELHR}/en/sites/CX_1001/job/abc`, `${ELHR}/en/sites/CX_1001/job/12946/share`,
      `${ELHR}/en/CX_1001/job/12946`]) {
      expect(parseOracleUrl(at(address)), address).toBeNull();
    }
  });
});
