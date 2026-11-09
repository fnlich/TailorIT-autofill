/*
 * v5 p2-detect: the network signs' protocol (dom/submit-net-protocol.ts), shared by the page-world submit watcher and the
 * isolated world: which request is which platform's sign (its method and address alone, on the page's own origin),
 * which answer makes it one, and the event's detail, read strictly.
 */
import { describe, expect, it } from 'vitest';
import {
  bodyJson, encodeNetSign, isNetPlatform, NET_BODY_MAX, NET_DETAIL_MAX, NET_SEQUENCES, NET_SIGNS, netRequestOf,
  netSignOf, oracleActionOf, oraclePostingOf, parseNetSign, readsAnswerBody, readsRequestBody, successFactorsApplied,
  successFactorsApplyOf, successFactorsJobOf,
} from './submit-net-protocol';

const WORKDAY_PAGE = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually';
const FINALIZE = '/wday/cxs/acme/jobapplication/JA-0000001_abc/finalize';
const CC_PAGE = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const FORM = '11111111-2222-3333-4444-555555555555';
const JOB = '9485c936-3d5f-0a3b-27a4-708fe87203d8';
const CANDIDATE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RESPONSES = `/api/v1/careers/apply/form/${FORM}/${JOB}/responses/${CANDIDATE}`;
const COMPLETED = `/api/v1/careers/apply/form/${FORM}/message/completedMessage/en-US`;
const ORACLE_PAGE = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/section/1';
const APPLICATIONS = '/hcmRestApi/resources/11.13.18.05/recruitingCEJobApplications';

describe('the network signs (v5 p2-detect)', () => {
  it("reads Workday's finalize, POST on the page's own origin, with no query or the agency one, and nothing else", () => {
    expect(netRequestOf('workday', WORKDAY_PAGE, 'POST', FINALIZE)).toBe('workday-finalize');
    expect(netRequestOf('workday', WORKDAY_PAGE, 'post', `https://acme.wd5.myworkdayjobs.com${FINALIZE}`))
      .toBe('workday-finalize');
    expect(netRequestOf('workday', WORKDAY_PAGE, 'POST', `${FINALIZE}?type=completeAgencySubmission`))
      .toBe('workday-finalize');
    for (const [method, address] of [['GET', FINALIZE], ['PUT', FINALIZE], ['POST', `${FINALIZE}?type=draft`],
      ['POST', `${FINALIZE}?x=1`], ['POST', `${FINALIZE}?type=completeAgencySubmission&type=completeAgencySubmission`],
      ['POST', `${FINALIZE}#top`], ['POST', `https://evil.example${FINALIZE}`],
      ['POST', `https://other.wd5.myworkdayjobs.com${FINALIZE}`], ['POST', `http://acme.wd5.myworkdayjobs.com${FINALIZE}`],
      ['POST', `https://user:pw@acme.wd5.myworkdayjobs.com${FINALIZE}`],
      ['POST', '/wday/cxs/acme/jobapplication/JA-1/finalize/x'], ['POST', '/wday/cxs/acme/jobapplication/JA-1'],
      ['POST', '/wday/cxs/acme/External/jobs'], ['POST', '/wday/cxs/a b/jobapplication/JA-1/finalize'],
      ['POST', 'not a url with spaces://'], ['POST', RESPONSES]] as const) {
      expect(netRequestOf('workday', WORKDAY_PAGE, method, address), `${method} ${address}`).toBeNull();
    }
    expect(netRequestOf('workday', 'not an address', 'POST', FINALIZE)).toBeNull();
  });

  it("reads ClearCompany's last answers and its completed message, each in its own shape, and nothing else", () => {
    expect(netRequestOf('clearcompany', CC_PAGE, 'POST', `${RESPONSES}?isInternalEdit=false&advanceToEnd=false`))
      .toBe('clearcompany-responses');
    expect(netRequestOf('clearcompany', CC_PAGE, 'POST', `${RESPONSES}?advanceToEnd=false&isInternalEdit=false&pageNumber=3`))
      .toBe('clearcompany-responses');
    expect(netRequestOf('clearcompany', CC_PAGE, 'GET', COMPLETED)).toBe('clearcompany-completed');
    expect(netRequestOf('clearcompany', CC_PAGE, 'GET', `${COMPLETED}?reqId=${JOB}&candidateId=${CANDIDATE}&_=1730000000000`))
      .toBe('clearcompany-completed');
    expect(netRequestOf('clearcompany', CC_PAGE, 'GET', `/api/v1/careers/apply/form/${FORM}/message/completedMessage/fr`))
      .toBe('clearcompany-completed');
    for (const [method, address] of [['POST', RESPONSES], ['POST', `${RESPONSES}?isInternalEdit=true&advanceToEnd=false`],
      ['POST', `${RESPONSES}?isInternalEdit=false&advanceToEnd=true`],
      ['POST', `${RESPONSES}?isInternalEdit=false&advanceToEnd=false&pageNumber=x`],
      ['POST', `${RESPONSES}?isInternalEdit=false&advanceToEnd=false&other=1`],
      ['GET', `${RESPONSES}?isInternalEdit=false&advanceToEnd=false`], ['POST', COMPLETED],
      ['GET', `${COMPLETED}?_=abc`], ['GET', `${COMPLETED}?reqId=1&reqId=2`], ['GET', `${COMPLETED}?other=1`],
      ['GET', `/api/v1/careers/apply/form/${FORM}/message/startMessage/en-US`],
      ['GET', `/api/v1/careers/apply/form/not-a-uuid/message/completedMessage/en-US`],
      ['GET', `https://atlas-tech.clearcompany.com${COMPLETED}`], ['POST', FINALIZE]] as const) {
      expect(netRequestOf('clearcompany', CC_PAGE, method, address), `${method} ${address}`).toBeNull();
    }
  });

  it("makes ClearCompany's sign of an answer of 200 alone, never a redirected one, its body unread", () => {
    for (const request of ['clearcompany-responses', 'clearcompany-completed'] as const) {
      expect(readsAnswerBody(request)).toBe(false);
      expect(readsRequestBody(request)).toBe(false);
      expect(netSignOf(request, { status: 200, redirected: false })).toBe(request);
      for (const [status, redirected] of [[200, true], [201, false], [204, false], [302, false], [400, false], [500, false],
        [0, false]] as const) {
        expect(netSignOf(request, { status, redirected }), `${status} ${redirected}`).toBeNull();
      }
    }
  });

  it("makes Workday's sign of an answer of 200 naming the application and holding no error (Jobright's reading)", () => {
    expect(readsAnswerBody('workday-finalize')).toBe(true);
    expect(readsRequestBody('workday-finalize')).toBe(false);
    expect(netSignOf('workday-finalize', { status: 200, redirected: false, answer: '{"id":"JA-1","name":"A Person"}' }))
      .toBe('workday-finalize');
    expect(netSignOf('workday-finalize', { status: 200, redirected: false, answer: { id: 'JA-1' } })).toBe('workday-finalize');
    for (const [status, redirected, answer] of [[200, false, '{}'], [200, false, '{"id":" "}'], [200, false, '{"id":7}'],
      [200, false, '{"id":"JA-1","errors":[]}'], [200, false, '{"id":"JA-1","error":null}'], [200, false, undefined],
      [200, false, 'not json'], [200, false, '["JA-1"]'], [201, false, '{"id":"JA-1"}'], [200, true, '{"id":"JA-1"}'],
      [400, false, '{"id":"JA-1"}']] as const) {
      expect(netSignOf('workday-finalize', { status, redirected, answer }), `${status} ${String(answer)}`).toBeNull();
    }
  });

  it("reads Oracle's action from its request's body, for the page's posting alone, and its answers' flags", () => {
    expect(oraclePostingOf(ORACLE_PAGE)).toBe('12946');
    expect(oraclePostingOf('https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs/preview/77/apply'))
      .toBe('77');
    expect(oraclePostingOf('https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/my-profile')).toBeNull();
    expect(netRequestOf('oracle', ORACLE_PAGE, 'POST', APPLICATIONS)).toBe('oracle-application');
    expect(netRequestOf('oracle', ORACLE_PAGE, 'POST', '/hcmRestApi/resources/latest/recruitingCEJobApplications/'))
      .toBe('oracle-application');
    for (const [method, address] of [['GET', APPLICATIONS], ['POST', `${APPLICATIONS}?onlyData=true`],
      ['POST', '/hcmRestApi/resources/latest/recruitingCEJobApplicationDrafts'],
      ['POST', `https://other.fa.us2.oraclecloud.com${APPLICATIONS}`]] as const) {
      expect(netRequestOf('oracle', ORACLE_PAGE, method, address), `${method} ${address}`).toBeNull();
    }
    expect(readsRequestBody('oracle-application')).toBe(true);
    expect(readsAnswerBody('oracle-application')).toBe(true);
    expect(oracleActionOf(ORACLE_PAGE, '{"action":"CREATE","requisitionNumber":"12946","candidateNumber":300100}'))
      .toBe('CREATE');
    expect(oracleActionOf(ORACLE_PAGE, '{"Action":"CONFIRM","RequisitionNumber":12946,"CandidateNumber":"300100"}'))
      .toBe('CONFIRM');
    for (const body of ['{"action":"UPDATE","requisitionNumber":12946,"candidateNumber":1}',
      '{"action":"CREATE","requisitionNumber":12947,"candidateNumber":1}', '{"action":"CREATE","requisitionNumber":12946}',
      '{"action":"CREATE","requisitionNumber":12946,"candidateNumber":-1}', 'action=CREATE', undefined, 12946,
      `{"action":"CREATE","requisitionNumber":12946,"candidateNumber":1,"x":"${'a'.repeat(NET_BODY_MAX)}"}`]) {
      expect(oracleActionOf(ORACLE_PAGE, body), String(body).slice(0, 60)).toBeNull();
    }
    expect(oracleActionOf('https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/my-profile',
      '{"action":"CREATE","requisitionNumber":12946,"candidateNumber":1}')).toBeNull();
    const answered = (status: number, action: 'CREATE' | 'CONFIRM' | null, answer: string) =>
      netSignOf('oracle-application', { status, redirected: false, action, answer, pageHref: ORACLE_PAGE });
    expect(answered(201, 'CREATE', '{"submissionId":98765,"email":"a@example.com"}')).toBe('oracle-created');
    expect(answered(200, 'CREATE', '{"SubmissionId":"S-1"}')).toBe('oracle-created');
    expect(answered(200, 'CONFIRM', '{"confirmedFlag":true,"activeFlag":true,"requisitionNumber":12946}'))
      .toBe('oracle-confirmed');
    for (const [status, action, answer] of [[201, 'CREATE', '{}'], [201, 'CREATE', '{"submissionId":0}'],
      [400, 'CREATE', '{"submissionId":1}'], [201, null, '{"submissionId":1}'],
      [200, 'CONFIRM', '{"confirmedFlag":true,"activeFlag":false,"requisitionNumber":12946}'],
      [200, 'CONFIRM', '{"confirmedFlag":"true","activeFlag":true,"requisitionNumber":12946}'],
      [200, 'CONFIRM', '{"confirmedFlag":true,"activeFlag":true,"requisitionNumber":1}'],
      [200, 'CREATE', '{"confirmedFlag":true,"activeFlag":true,"requisitionNumber":12946}']] as const) {
      expect(answered(status, action, answer), `${status} ${action} ${answer}`).toBeNull();
    }
  });

  it("reads SuccessFactors' new application of the page's posting, and its callback's result, yes or no", () => {
    expect(successFactorsJobOf('https://career2.successfactors.eu/career?company=x&career_job_req_id=48659')).toBe('48659');
    expect(successFactorsJobOf('https://career2.successfactors.eu/career?company=x&jobReqId=48659')).toBe('48659');
    expect(successFactorsJobOf('https://career2.successfactors.eu/portalcareer?_s.crb=x')).toBeNull();
    expect(successFactorsJobOf('https://career2.successfactors.eu/career?career_job_req_id=0x1')).toBeNull();
    expect(successFactorsApplyOf('48659', { jobReqId: '48659', appId: -1, viewApplicationMode: false })).toBe(true);
    expect(successFactorsApplyOf('48659', { jobReqId: 48659, appId: '-1', viewApplicationMode: false })).toBe(true);
    for (const request of [{ jobReqId: '1', appId: -1, viewApplicationMode: false },
      { jobReqId: '48659', appId: 3, viewApplicationMode: false }, { jobReqId: '48659', appId: -1, viewApplicationMode: true },
      { jobReqId: '48659', appId: -1 }, null, 'x']) {
      expect(successFactorsApplyOf('48659', request), JSON.stringify(request)).toBe(false);
    }
    expect(successFactorsApplyOf(null, { jobReqId: '48659', appId: -1, viewApplicationMode: false })).toBe(false);
    expect(successFactorsApplied({ success: true, jobApplicationActionResponse: {} })).toBe(true);
    for (const result of [{ success: true }, { success: 'true', jobApplicationActionResponse: {} },
      { success: true, jobApplicationActionResponse: null }, { success: true, jobApplicationActionResponse: [] }, null,
      { success: false, jobApplicationActionResponse: {} }]) {
      expect(successFactorsApplied(result), JSON.stringify(result)).toBe(false);
    }
  });

  it('reads a body only up to NET_BODY_MAX characters, as JSON', () => {
    expect(bodyJson('{"a":1}')).toEqual({ a: 1 });
    expect(bodyJson(`"${'a'.repeat(NET_BODY_MAX)}"`)).toBeUndefined();
    expect(bodyJson('{')).toBeUndefined();
    expect(bodyJson(1)).toBeUndefined();
  });

  it('writes each sign as {v: 1, sign} and reads exactly that back, nothing else', () => {
    for (const sign of NET_SIGNS) expect(parseNetSign(encodeNetSign(sign))).toBe(sign);
    for (const detail of [undefined, null, 1, {}, { v: 1, sign: 'workday-finalize' }, '', 'workday-finalize', '{',
      '{"v":2,"sign":"workday-finalize"}', '{"v":1,"sign":"greenhouse-confirmation"}', '{"v":1}',
      '{"v":1,"sign":"workday-finalize","x":1}', '[1,"workday-finalize"]', '{"sign":"workday-finalize","v":"1"}',
      `{"v":1,"sign":"workday-finalize"${' '.repeat(NET_DETAIL_MAX)}}`]) {
      expect(parseNetSign(detail), JSON.stringify(detail)).toBeNull();
    }
    expect(parseNetSign('{"sign":"clearcompany-completed","v":1}')).toBe('clearcompany-completed');
  });

  it("orders each platform's signs, and names only Workday, ClearCompany, Oracle and SuccessFactors", () => {
    expect(NET_SEQUENCES).toEqual({ workday: ['workday-finalize'],
      clearcompany: ['clearcompany-responses', 'clearcompany-completed'], oracle: ['oracle-created', 'oracle-confirmed'],
      successfactors: ['successfactors-applied'] });
    expect([...new Set(Object.values(NET_SEQUENCES).flat())].sort()).toEqual([...NET_SIGNS].sort());
    expect(['workday', 'clearcompany', 'oracle', 'successfactors'].every(isNetPlatform)).toBe(true);
    for (const platform of ['taleo', 'greenhouse', 'site', '']) expect(isNetPlatform(platform)).toBe(false);
  });
});
