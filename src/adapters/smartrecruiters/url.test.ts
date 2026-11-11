/*
 * SmartRecruiters' URL parser on its own (the snapshot build of 2026-11-06): its postings and its one-click application
 * (the first page and the screening step) in the spellings the owner's snapshots show, and the canonical application
 * URL. src/adapters/url.test.ts holds the shared table.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseSmartRecruitersUrl } from './url';

const at = (address: string) => new URL(address);
const HOST = 'https://jobs.smartrecruiters.com';
/** The snapshots' addresses: [jobs.smartrecruiters.com] Xplor's posting, its one-click application and its screening. */
const XPLOR_POSTING = `${HOST}/Xplor/744000159905715-senior-site-reliability-engineer`;
const XPLOR_UUID = '189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const XPLOR_FORM = `${HOST}/oneclick-ui/company/Xplor/publication/${XPLOR_UUID}`;

describe('matchesUrl', () => {
  it.each([XPLOR_POSTING, `${XPLOR_FORM}?dcr_ci=Xplor`, `${HOST}/Xplor`])('takes %s', (address) =>
    expect(matchesUrl(at(address))).toBe(true));

  it.each(['https://careers.smartrecruiters.com/Xplor', 'https://www.smartr.me/oneclick-ui/company/Xplor/publication/x',
    `http://jobs.smartrecruiters.com/Xplor/744000159905715-x`, 'https://jobs.smartrecruiters.com:8443/Xplor/744000159905715',
    'https://jobs.smartrecruiters.com.example.com/Xplor/744000159905715'])('refuses %s', (address) =>
    expect(matchesUrl(at(address))).toBe(false));
});

describe('parseSmartRecruitersUrl', () => {
  it('reads a posting, keyed on its company and its id, its slug and its query dropped', () => {
    const posting = { platform: 'smartrecruiters', board: 'Xplor', jobId: '744000159905715', page: 'posting',
      applicationUrl: `${HOST}/Xplor/744000159905715` };
    for (const address of [XPLOR_POSTING, `${XPLOR_POSTING}/`, `${XPLOR_POSTING}?trid=7d1dcdfa-96a8-4e55-8f8e-000000000000`,
      `${HOST}/Xplor/744000159905715`]) {
      expect(parseSmartRecruitersUrl(at(address)), address).toEqual(posting);
      expect(canonicalApplicationUrl(at(address))).toBeNull();
    }
    // Bertelsmann's: a slug that starts with a hyphen.
    expect(parseSmartRecruitersUrl(at(`${HOST}/Bertelsmann-Jobs/744000159908317--senior-infrastructure-engineer-ai-ml`)))
      .toMatchObject({ board: 'Bertelsmann-Jobs', jobId: '744000159908317', page: 'posting' });
  });

  it('reads the one-click application and its screening step as one application', () => {
    const form = { platform: 'smartrecruiters', board: 'Xplor', jobId: XPLOR_UUID, page: 'application',
      applicationUrl: XPLOR_FORM };
    for (const address of [`${XPLOR_FORM}?dcr_ci=Xplor`, `${XPLOR_FORM}/screening?dcr_ci=Xplor`, XPLOR_FORM,
      `${XPLOR_FORM}/`, `${HOST}/oneclick-ui/company/Xplor/publication/${XPLOR_UUID.toUpperCase()}/screening#top`]) {
      expect(parseSmartRecruitersUrl(at(address)), address).toEqual(form);
      expect(canonicalApplicationUrl(at(address))).toBe(XPLOR_FORM);
    }
  });

  it('reads nothing no snapshot shows: a board, a referral, another one-click page, a malformed id', () => {
    for (const address of [`${HOST}/Xplor`, `${HOST}/`, `${HOST}/external-referrals/company/Xplor/publication/${XPLOR_UUID}`,
      `${XPLOR_FORM}/confirmation`, `${XPLOR_FORM}/screening/2`, `${HOST}/oneclick-ui/company/Xplor/publication/abc`,
      `${HOST}/oneclick-ui/company/Xplor`, `${HOST}/oneclick-ui/744000159905715`, `${HOST}/Xplor/senior-engineer`,
      `${HOST}/Xplor/744000159905715-x/apply`]) {
      expect(parseSmartRecruitersUrl(at(address)), address).toBeNull();
    }
  });
});

// jr6 SR-14 (FIXPLAN §6.9 item 6): the one-click application opened by its job (Jobright's submission matcher accepts
// /oneclick-ui/company/<c>/job/<id>, its screening step too). No capture shows one: the ids are Xplor's posting's, and a
// made-up UUID.
describe('parseSmartRecruitersUrl: the one-click application by its job (SR-14)', () => {
  const XPLOR_JOB = `${HOST}/oneclick-ui/company/Xplor/job/744000159905715`;
  const JOB_UUID = '3f2a6c1e-0000-4000-8000-00000000abcd';

  it('reads it and its screening step as one application, keyed on its own canonical address', () => {
    const form = { platform: 'smartrecruiters', board: 'Xplor', jobId: '744000159905715', page: 'application',
      applicationUrl: XPLOR_JOB };
    for (const address of [XPLOR_JOB, `${XPLOR_JOB}/`, `${XPLOR_JOB}?dcr_ci=Xplor`, `${XPLOR_JOB}/screening`,
      `${XPLOR_JOB}/screening?dcr_ci=Xplor#top`]) {
      expect(parseSmartRecruitersUrl(at(address)), address).toEqual(form);
      expect(canonicalApplicationUrl(at(address)), address).toBe(XPLOR_JOB);
    }
    // A UUID in either case, written in lower case.
    const byUuid = `${HOST}/oneclick-ui/company/WiserSolutions/job/${JOB_UUID}`;
    expect(parseSmartRecruitersUrl(at(`${HOST}/oneclick-ui/company/WiserSolutions/job/${JOB_UUID.toUpperCase()}/screening`)))
      .toEqual({ platform: 'smartrecruiters', board: 'WiserSolutions', jobId: JOB_UUID, page: 'application',
        applicationUrl: byUuid });
  });

  it('keys it apart from its posting and from a publication of the same company', () => {
    const job = parseSmartRecruitersUrl(at(XPLOR_JOB))!;
    expect(job.applicationUrl).not.toBe(parseSmartRecruitersUrl(at(XPLOR_POSTING))!.applicationUrl);
    expect(job.applicationUrl).not.toBe(parseSmartRecruitersUrl(at(XPLOR_FORM))!.applicationUrl);
    expect(parseSmartRecruitersUrl(at(XPLOR_POSTING))!.page).toBe('posting');
  });

  it('reads nothing else under a job: its page after Submit (no capture), other steps, a malformed id or company', () => {
    for (const address of [`${XPLOR_JOB}/success`, `${XPLOR_JOB}/screening/success`, `${XPLOR_JOB}/screening/2`,
      `${XPLOR_JOB}/confirmation`, `${HOST}/oneclick-ui/company/Xplor/job/abc`, `${HOST}/oneclick-ui/company/Xplor/job/12345`,
      `${HOST}/oneclick-ui/company/Xplor/job/744000159905715-senior-engineer`, `${HOST}/oneclick-ui/company/Xplor/job`,
      `${HOST}/oneclick-ui/company/-Xplor/job/744000159905715`, `${HOST}/oneclick-ui/company/Xplor/jobs/744000159905715`,
      `${HOST}/oneclick-ui/firm/Xplor/job/744000159905715`]) {
      expect(parseSmartRecruitersUrl(at(address)), address).toBeNull();
      expect(canonicalApplicationUrl(at(address)), address).toBeNull();
    }
    // Another host is never read.
    expect(parseSmartRecruitersUrl(at('https://www.smartr.me/oneclick-ui/company/Xplor/job/744000159905715'))).toBeNull();
  });
});
