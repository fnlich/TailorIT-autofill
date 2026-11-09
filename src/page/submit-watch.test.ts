/*
 * v5 p2-detect: the page-world submit watcher (page/submit-watch.ts) over a stand-in window: the page's own fetch,
 * XMLHttpRequest and SuccessFactors' applyJob run with exactly what the page gave them and hand back exactly what they
 * returned, and the watcher tells the document which sign it saw once the platform's request is answered as the sign
 * says (dom/submit-net-protocol.ts), and nothing else: never a field of a body (the bodies here hold a person's details
 * beside the one fact read), only the sign.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeNetSign, SUBMIT_NET_EVENT, type NetPlatform } from '../dom/submit-net-protocol';
import { installSubmitWatch } from './submit-watch';

const PAGE = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually';
const FINALIZE = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/jobapplication/JA-1/finalize';
const CC_PAGE = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const FORM = '11111111-2222-3333-4444-555555555555';
const RESPONSES = `/api/v1/careers/apply/form/${FORM}/9485c936-3d5f-0a3b-27a4-708fe87203d8/responses/`
  + 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?isInternalEdit=false&advanceToEnd=false';
const COMPLETED = `/api/v1/careers/apply/form/${FORM}/message/completedMessage/en-US`;
const ORACLE_PAGE = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/section/1';
const APPLICATIONS = 'https://elhr.fa.us2.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobApplications';
const SF_PAGE = 'https://career2.successfactors.eu/career?company=danfossas&career_job_req_id=48659&career_ns=job_application';

/** A person's details, as a body may hold them beside the one fact a sign reads: never told. */
const PERSON = { firstName: 'Alex', lastName: 'Rivera', email: 'alex@example.com' };
/** Oracle's two requests' bodies for the page's posting (12946), and their answers. */
const CREATE = JSON.stringify({ action: 'CREATE', requisitionNumber: '12946', candidateNumber: 300100, ...PERSON });
const CONFIRM = JSON.stringify({ Action: 'CONFIRM', requisitionNumber: 12946, candidateNumber: 300100 });
const CREATED = JSON.stringify({ submissionId: 98765, ...PERSON });
const CONFIRMED = JSON.stringify({ confirmedFlag: true, activeFlag: true, requisitionNumber: 12946, candidateNumber: 300100 });

/** A stand-in XMLHttpRequest: open and send record what they were given; the test answers it (`answer`). */
class FakeXhr extends EventTarget {
  status = 0;
  responseURL = '';
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  response: unknown = '';
  opened: unknown[] = [];
  sent: unknown[] = [];
  answer(status: number, responseURL: string, body = ''): void {
    this.status = status;
    this.responseURL = responseURL;
    this.responseText = body;
    this.response = this.responseType === 'json' ? JSON.parse(body || 'null') as unknown : body;
    this.dispatchEvent(new Event('loadend'));
  }
}
const ownOpen = vi.fn(function (this: FakeXhr, ...args: unknown[]) {
  this.opened = args;
});
const ownSend = vi.fn(function (this: FakeXhr, ...args: unknown[]) {
  this.sent = args;
});
(FakeXhr.prototype as unknown as { open: unknown }).open = ownOpen;
(FakeXhr.prototype as unknown as { send: unknown }).send = ownSend;
type Xhr = XMLHttpRequest & FakeXhr;

const PLATFORM_OF: Record<string, NetPlatform> = { [PAGE]: 'workday', [CC_PAGE]: 'clearcompany', [ORACLE_PAGE]: 'oracle',
  [SF_PAGE]: 'successfactors' };

/** A stand-in window: the page's own fetch (answering `response`), its XMLHttpRequest, timers, a form and a document
 *  that hears the watcher's events (`told`: each event's detail, as dispatched). */
function page(href = PAGE, more: Record<string, unknown> = {}) {
  const doc = new EventTarget() as EventTarget & { querySelector(selector: string): unknown };
  doc.querySelector = () => null;
  const told: unknown[] = [];
  doc.addEventListener(SUBMIT_NET_EVENT, (event) => told.push((event as CustomEvent<unknown>).detail));
  let response: Response | Promise<never> = new Response('{"id":"JA-1"}', { status: 200 });
  const ownFetch = vi.fn((..._args: unknown[]) => (response instanceof Response ? Promise.resolve(response) : response));
  const view = { document: doc, location: { href }, fetch: ownFetch, XMLHttpRequest: FakeXhr, CustomEvent, Request,
    HTMLInputElement: class {}, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, ...more };
  const remove = installSubmitWatch(view as unknown as Window & typeof globalThis, PLATFORM_OF[href]!, () => href);
  removers.push(remove);
  return { view: view as unknown as { fetch: typeof fetch } & Record<string, unknown>, ownFetch, told, remove,
    answer(next: Response | Promise<never>) {
      response = next;
    } };
}

/** A response as fetch hands it back after a redirect (Response.redirected is read-only). */
function redirected(status: number, body = '{"id":"JA-1"}'): Response {
  const answer = new Response(body, { status });
  Object.defineProperty(answer, 'redirected', { value: true });
  return answer;
}

/** Lets the answer's handlers run. */
const settle = async () => {
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};
const sign = encodeNetSign;

const removers: Array<() => void> = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  ownOpen.mockClear();
  ownSend.mockClear();
  vi.useRealTimers();
});

describe('the page-world submit watcher (v5 p2-detect)', () => {
  it("tells Workday's finalize answered 200 naming the application, handing the page its own call's answer, untouched", async () => {
    const { view, ownFetch, told, answer } = page();
    answer(new Response(JSON.stringify({ id: 'JA-1', applicant: PERSON }), { status: 200 }));
    const init = { method: 'POST', body: '{"anything":"the page sends"}', headers: { 'content-type': 'application/json' } };
    const sent = view.fetch(FINALIZE, init);
    // The page's own fetch ran with exactly what the page gave it, at once.
    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(ownFetch.mock.calls[0]![0]).toBe(FINALIZE);
    expect(ownFetch.mock.calls[0]![1]).toBe(init);
    const response = await sent;
    expect(response.status).toBe(200);
    // Its body is the page's to read: the watcher read a copy of it.
    expect(response.bodyUsed).toBe(false);
    expect(JSON.parse(await response.text())).toEqual({ id: 'JA-1', applicant: PERSON });
    await settle();
    // The sign alone: nothing of the answer.
    expect(told).toEqual([sign('workday-finalize')]);
  });

  it("tells nothing for Workday's finalize answered 200 with no application id, or with errors (Jobright's reading)", async () => {
    const { view, told, answer } = page();
    for (const body of ['{}', '{"id":""}', '{"id":"JA-1","errors":[{"message":"x"}]}', '{"id":"JA-1","error":"x"}', 'not json',
      '[{"id":"JA-1"}]']) {
      answer(new Response(body, { status: 200 }));
      await view.fetch(FINALIZE, { method: 'POST' });
    }
    await settle();
    expect(told).toEqual([]);
  });

  it('reads a Request the page passes, by its own method and address', async () => {
    const { view, told } = page();
    const request = new Request(FINALIZE, { method: 'POST', body: 'x' });
    await view.fetch(request);
    await settle();
    expect(told).toEqual([sign('workday-finalize')]);
    expect(request.bodyUsed).toBe(false);
  });

  it('tells nothing for another answer, a redirect, another request, or a failure the page sees as its own', async () => {
    const { view, told, answer } = page();
    answer(new Response('{"errors":[]}', { status: 400 }));
    await view.fetch(FINALIZE, { method: 'POST' });
    answer(redirected(200));
    await view.fetch(FINALIZE, { method: 'POST' });
    answer(new Response('{"id":"JA-1"}', { status: 200 }));
    await view.fetch(FINALIZE);
    await view.fetch('https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs', { method: 'POST' });
    await view.fetch(`https://evil.example${new URL(FINALIZE).pathname}`, { method: 'POST' });
    const failure = new TypeError('Failed to fetch');
    answer(Promise.reject(failure));
    await expect(view.fetch(FINALIZE, { method: 'POST' })).rejects.toBe(failure);
    await settle();
    expect(told).toEqual([]);
  });

  it("tells an XMLHttpRequest's sign on its loadend, its own open and send called with what the page gave", () => {
    const { told } = page();
    const xhr = new FakeXhr() as Xhr;
    xhr.open('POST', '/wday/cxs/acme/jobapplication/JA-1/finalize', true);
    const body = '{"anything":"the page sends"}';
    xhr.send(body);
    expect(xhr.opened).toEqual(['POST', '/wday/cxs/acme/jobapplication/JA-1/finalize', true]);
    expect(xhr.sent[0]).toBe(body);
    expect(ownOpen).toHaveBeenCalledTimes(1);
    expect(ownSend).toHaveBeenCalledTimes(1);
    expect(told).toEqual([]);
    xhr.answer(200, FINALIZE, JSON.stringify({ id: 'JA-1', ...PERSON }));
    const json = new FakeXhr() as Xhr;
    json.responseType = 'json';
    json.open('POST', FINALIZE);
    json.send();
    json.answer(200, FINALIZE, '{"id":"JA-2"}');
    expect(told).toEqual([sign('workday-finalize'), sign('workday-finalize')]);
  });

  it('tells nothing for an XMLHttpRequest answered otherwise, redirected elsewhere, with no id, or not a sign', () => {
    const { told } = page();
    const failed = new FakeXhr() as Xhr;
    failed.open('POST', FINALIZE);
    failed.send();
    failed.answer(500, FINALIZE, '{"id":"JA-1"}');
    const moved = new FakeXhr() as Xhr;
    moved.open('POST', FINALIZE);
    moved.send();
    moved.answer(200, 'https://acme.wd5.myworkdayjobs.com/en-US/External/login', '{"id":"JA-1"}');
    const nameless = new FakeXhr() as Xhr;
    nameless.open('POST', FINALIZE);
    nameless.send();
    nameless.answer(200, FINALIZE, '{"errors":["x"]}');
    const other = new FakeXhr() as Xhr;
    other.open('GET', FINALIZE);
    other.send();
    other.answer(200, FINALIZE, '{"id":"JA-1"}');
    // Opened as a sign, then opened again as something else before its send: no sign.
    const reopened = new FakeXhr() as Xhr;
    reopened.open('POST', FINALIZE);
    reopened.open('GET', '/en-US/External');
    reopened.send();
    reopened.answer(200, FINALIZE, '{"id":"JA-1"}');
    expect(told).toEqual([]);
  });

  it("tells ClearCompany's last answers and completed message as each is answered, never reading a body", async () => {
    const { view, told, answer } = page(CC_PAGE);
    const response = new Response(JSON.stringify({ ResponseType: 'WorkflowEnded', ...PERSON }), { status: 200 });
    const clone = vi.spyOn(response, 'clone');
    answer(response);
    await view.fetch(RESPONSES, { method: 'POST', body: '{}' });
    await view.fetch(COMPLETED);
    await settle();
    expect(told).toEqual([sign('clearcompany-responses'), sign('clearcompany-completed')]);
    expect(clone).not.toHaveBeenCalled();
  });

  it("tells Oracle's CREATE and CONFIRM for the page's posting, from the request's own action and the answers' flags", async () => {
    const { view, told, answer } = page(ORACLE_PAGE);
    answer(new Response(CREATED, { status: 201 }));
    await view.fetch(APPLICATIONS, { method: 'POST', body: CREATE });
    answer(new Response(CONFIRMED, { status: 200 }));
    // A Request the page builds itself: its body read from a copy, the page's own left unread.
    const request = new Request(APPLICATIONS, { method: 'POST', body: CONFIRM });
    await view.fetch(request);
    await settle();
    expect(told).toEqual([sign('oracle-created'), sign('oracle-confirmed')]);
    expect(request.bodyUsed).toBe(false);
  });

  it("tells nothing for Oracle's other calls: another posting, another action, no submissionId, flags not set, a failure", async () => {
    const { view, told, answer } = page(ORACLE_PAGE);
    const other = JSON.stringify({ action: 'CREATE', requisitionNumber: 55555, candidateNumber: 300100 });
    const draft = JSON.stringify({ action: 'UPDATE', requisitionNumber: 12946, candidateNumber: 300100 });
    answer(new Response(CREATED, { status: 201 }));
    await view.fetch(APPLICATIONS, { method: 'POST', body: other });
    await view.fetch(APPLICATIONS, { method: 'POST', body: draft });
    await view.fetch(APPLICATIONS, { method: 'GET' });
    await view.fetch(`${APPLICATIONS}?q=1`, { method: 'POST', body: CREATE });
    answer(new Response('{"status":"pending"}', { status: 201 }));
    await view.fetch(APPLICATIONS, { method: 'POST', body: CREATE });
    answer(new Response(JSON.stringify({ confirmedFlag: true, activeFlag: false, requisitionNumber: 12946 }), { status: 200 }));
    await view.fetch(APPLICATIONS, { method: 'POST', body: CONFIRM });
    answer(new Response(CREATED, { status: 400 }));
    await view.fetch(APPLICATIONS, { method: 'POST', body: CREATE });
    await settle();
    expect(told).toEqual([]);
  });

  it("tells Oracle's sign from an XMLHttpRequest, the body the page sends read for its action alone", () => {
    const { told } = page(ORACLE_PAGE);
    const xhr = new FakeXhr() as Xhr;
    xhr.open('POST', APPLICATIONS);
    xhr.send(CREATE);
    expect(xhr.sent[0]).toBe(CREATE);
    xhr.answer(201, APPLICATIONS, CREATED);
    expect(told).toEqual([sign('oracle-created')]);
  });

  it("tells SuccessFactors' new application once its applyJob's callback says it was taken, calling the page's own", () => {
    const own = vi.fn((...args: unknown[]) => {
      (args[4] as { callback(result: unknown): void }).callback({ success: true, jobApplicationActionResponse: { id: 1 },
        applicant: PERSON });
      return 'own';
    });
    const proxy = { applyJob: own };
    const { told } = page(SF_PAGE, { rcmHybridJobApplicationControllerASProxy: proxy });
    expect(proxy.applyJob).not.toBe(own);
    const callback = vi.fn();
    const options = { callback, errorHandler: () => undefined };
    const request = { jobReqId: '48659', appId: -1, viewApplicationMode: false, answers: PERSON };
    expect(proxy.applyJob('a', request, 'c', 'd', options)).toBe('own');
    // The page's own applyJob and callback got what they were given: the callback DWR's own result.
    expect(own.mock.calls[0]!.slice(0, 4)).toEqual(['a', request, 'c', 'd']);
    expect(own.mock.calls[0]![4]).toMatchObject({ errorHandler: options.errorHandler });
    expect(callback).toHaveBeenCalledWith({ success: true, jobApplicationActionResponse: { id: 1 }, applicant: PERSON });
    expect(told).toEqual([sign('successfactors-applied')]);
  });

  it("tells nothing for SuccessFactors' other calls: another posting, an edit, a failed result", () => {
    let result: unknown = { success: false, jobApplicationActionResponse: {} };
    const proxy = { applyJob: (...args: unknown[]) => (args[4] as { callback(value: unknown): void }).callback(result) };
    const { told } = page(SF_PAGE, { rcmHybridJobApplicationControllerASProxy: proxy });
    const options = () => ({ callback: () => undefined });
    proxy.applyJob(0, { jobReqId: '48659', appId: -1, viewApplicationMode: false }, 0, 0, options());
    result = { success: true, jobApplicationActionResponse: {} };
    proxy.applyJob(0, { jobReqId: '11111', appId: -1, viewApplicationMode: false }, 0, 0, options());
    proxy.applyJob(0, { jobReqId: '48659', appId: 77, viewApplicationMode: false }, 0, 0, options());
    proxy.applyJob(0, { jobReqId: '48659', appId: -1, viewApplicationMode: true }, 0, 0, options());
    result = { success: true };
    proxy.applyJob(0, { jobReqId: '48659', appId: -1, viewApplicationMode: false }, 0, 0, options());
    expect(told).toEqual([]);
  });

  it("finds SuccessFactors' proxy the page makes after the watcher, looking every 250 ms for a minute at most", () => {
    vi.useFakeTimers();
    const holder: Record<string, unknown> = {};
    const { view, told } = page(SF_PAGE, holder);
    const apply = vi.fn((...args: unknown[]) => (args[4] as { callback(value: unknown): void })
      .callback({ success: true, jobApplicationActionResponse: {} }));
    view.rcmHybridJobApplicationControllerASProxy = { applyJob: apply };
    vi.advanceTimersByTime(250);
    const proxy = view.rcmHybridJobApplicationControllerASProxy as { applyJob(...args: unknown[]): void };
    expect(proxy.applyJob).not.toBe(apply);
    proxy.applyJob(0, { jobReqId: 48659, appId: '-1', viewApplicationMode: false }, 0, 0, { callback: () => undefined });
    expect(told).toEqual([sign('successfactors-applied')]);
    // A page that never makes it: the looking stops after a minute.
    const late = page(SF_PAGE, {});
    vi.advanceTimersByTime(60_000);
    late.view.rcmHybridJobApplicationControllerASProxy = { applyJob: apply };
    vi.advanceTimersByTime(1_000);
    expect((late.view.rcmHybridJobApplicationControllerASProxy as { applyJob: unknown }).applyJob).toBe(apply);
  });

  it("is removed whole, the page's own fetch, open, send and applyJob put back", () => {
    const { view, ownFetch, remove } = page();
    expect(view.fetch).not.toBe(ownFetch);
    expect((FakeXhr.prototype as unknown as { open: unknown }).open).not.toBe(ownOpen);
    remove();
    expect(view.fetch).toBe(ownFetch);
    expect((FakeXhr.prototype as unknown as { open: unknown }).open).toBe(ownOpen);
    expect((FakeXhr.prototype as unknown as { send: unknown }).send).toBe(ownSend);
    const apply = () => undefined;
    const proxy = { applyJob: apply };
    const sf = page(SF_PAGE, { rcmHybridJobApplicationControllerASProxy: proxy });
    expect(proxy.applyJob).not.toBe(apply);
    sf.remove();
    expect(proxy.applyJob).toBe(apply);
  });
});
