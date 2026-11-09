/*
 * v5 p2-detect: the network signs' protocol (dom/submit-net-protocol.ts), shared by the page-world submit watcher and the
 * isolated world: which request is which platform's sign (its method and address alone, on the page's own origin),
 * which answer makes it one, and the event's detail, read strictly.
 */
import { describe, expect, it } from 'vitest';
import {
  encodeNetSign, isNetPlatform, NET_DETAIL_MAX, NET_SEQUENCES, NET_SIGNS, netAnswered, netRequestOf, parseNetSign,
} from './submit-net-protocol';

const WORKDAY_PAGE = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually';
const FINALIZE = '/wday/cxs/acme/jobapplication/JA-0000001_abc/finalize';
const CC_PAGE = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const FORM = '11111111-2222-3333-4444-555555555555';
const JOB = '9485c936-3d5f-0a3b-27a4-708fe87203d8';
const CANDIDATE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RESPONSES = `/api/v1/careers/apply/form/${FORM}/${JOB}/responses/${CANDIDATE}`;
const COMPLETED = `/api/v1/careers/apply/form/${FORM}/message/completedMessage/en-US`;

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

  it('takes an answer of 200 alone, never a redirected one', () => {
    expect(netAnswered(200, false)).toBe(true);
    for (const [status, redirected] of [[200, true], [201, false], [204, false], [302, false], [400, false], [500, false],
      [0, false]] as const) {
      expect(netAnswered(status, redirected), `${status} ${redirected}`).toBe(false);
    }
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

  it("orders each platform's signs, and names only Workday and ClearCompany", () => {
    expect(NET_SEQUENCES).toEqual({ workday: ['workday-finalize'],
      clearcompany: ['clearcompany-responses', 'clearcompany-completed'] });
    expect([...new Set(Object.values(NET_SEQUENCES).flat())].sort()).toEqual([...NET_SIGNS].sort());
    expect(['workday', 'clearcompany'].every(isNetPlatform)).toBe(true);
    for (const platform of ['oracle', 'successfactors', 'greenhouse', 'site', '']) expect(isNetPlatform(platform)).toBe(false);
  });
});
