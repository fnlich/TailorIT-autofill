/*
 * SuccessFactors' URL parser on its own (v3 Phase 7b): which addresses are a classic career site's, the posting and its
 * account pages, told apart by the query as the public capture met them (docs/FIXTURES.md), the per-load tokens dropped,
 * and the canonical application URL. src/adapters/url.test.ts holds the shared table.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseSuccessFactorsUrl } from './url';

const at = (address: string) => new URL(address);
const SITE = 'https://career2.successfactors.eu/career';
const POSTING = `${SITE}?career_job_req_id=48659&career_ns=job_listing&company=danfossas`;
const CANONICAL = `${SITE}?company=danfossas&career_job_req_id=48659&career_ns=job_listing`;

describe('matchesUrl', () => {
  it.each([POSTING, 'https://career10.successfactors.com/career?company=x', 'https://career.successfactors.com/career',
    'https://career012.successfactors.eu/career'])('takes a career site: %s', (address) => expect(matchesUrl(at(address))).toBe(true));

  it.each(['https://performancemanager4.successfactors.com/login', 'https://api.successfactors.eu/x',
    'https://www.successfactors.com/', `http://career2.successfactors.eu/career`, 'https://career2.successfactors.eu:8443/career',
    'https://career2.sapsf.eu/career', 'https://jobs.voith.com/job/Strategic-Account-Manager/78142-en_US'])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseSuccessFactorsUrl', () => {
  const posting = { platform: 'successfactors', board: 'danfossas', jobId: '48659', applicationUrl: CANONICAL };

  it('reads the posting, and its sign-in, account and password help as its application, the tokens dropped', () => {
    expect(parseSuccessFactorsUrl(at(POSTING))).toEqual({ ...posting, page: 'posting' });
    expect(parseSuccessFactorsUrl(at(`${POSTING}&lang=en_GB&selected_lang=en_GB`))).toEqual({ ...posting, page: 'posting' });
    for (const address of [
      `${SITE}?career_company=danfossas&lang=en_GB&company=danfossas&site=&loginFlowRequired=true&career_job_req_id=48659&_s.crb=abc%3d`,
      `${SITE}?company=danfossas&site=&lang=en_GB&requestParams=xyz&login_ns=register&career_job_req_id=48659&_s.crb=abc`,
      `${SITE}?company=danfossas&site=&lang=en_GB&requestParams=xyz&login_ns=forgot_pwd&career_job_req_id=48659`,
      `${SITE}?company=danfossas&career_ns=job_application&career_job_req_id=48659`]) {
      expect(parseSuccessFactorsUrl(at(address)), address).toEqual({ ...posting, page: 'application' });
      expect(canonicalApplicationUrl(at(address))).toBe(CANONICAL);
    }
    expect(canonicalApplicationUrl(at(POSTING))).toBeNull();
  });

  it('reads no page that names no job or no company', () => {
    for (const address of [`${SITE}?_s.crb=izbeQB%252bI5p`, `${SITE}?company=danfossas&career_ns=job_listing`,
      `${SITE}?career_job_req_id=48659&career_ns=job_listing`, `${SITE}?company=dan%20foss&career_job_req_id=48659`,
      'https://career2.successfactors.eu/careers?company=danfossas&career_job_req_id=48659']) {
      expect(parseSuccessFactorsUrl(at(address)), address).toBeNull();
    }
  });
});
