/*
 * v5 p2-detect: the page-world submit watcher (page/submit-watch.ts) over a stand-in window: the page's own fetch and
 * XMLHttpRequest run with exactly what the page gave them and hand back exactly what they returned, and the watcher
 * tells the document which sign it saw once a sign's request is answered 200 and not redirected, and nothing else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNetSign, SUBMIT_NET_EVENT, type NetSign } from '../dom/submit-net-protocol';
import { installSubmitWatch } from './submit-watch';

const PAGE = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually';
const FINALIZE = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/jobapplication/JA-1/finalize';
const CC_PAGE = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const FORM = '11111111-2222-3333-4444-555555555555';
const RESPONSES = `/api/v1/careers/apply/form/${FORM}/9485c936-3d5f-0a3b-27a4-708fe87203d8/responses/`
  + 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?isInternalEdit=false&advanceToEnd=false';
const COMPLETED = `/api/v1/careers/apply/form/${FORM}/message/completedMessage/en-US`;

/** A stand-in XMLHttpRequest: open and send record what they were given; the test answers it (`answer`). */
class FakeXhr extends EventTarget {
  status = 0;
  responseURL = '';
  opened: unknown[] = [];
  sent: unknown[] = [];
  answer(status: number, responseURL: string): void {
    this.status = status;
    this.responseURL = responseURL;
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

/** A stand-in window: the page's own fetch (answering `response`), its XMLHttpRequest, and a document that hears the
 *  watcher's event. */
function page(href = PAGE) {
  const doc = new EventTarget();
  const told: Array<NetSign | null> = [];
  doc.addEventListener(SUBMIT_NET_EVENT, (event) => told.push(parseNetSign((event as CustomEvent<unknown>).detail)));
  let response: Response | Promise<never> = new Response('{}', { status: 200 });
  const ownFetch = vi.fn((..._args: unknown[]) => (response instanceof Response ? Promise.resolve(response) : response));
  const view = { document: doc, location: { href }, fetch: ownFetch, XMLHttpRequest: FakeXhr, CustomEvent, Request };
  const remove = installSubmitWatch(view as unknown as Window & typeof globalThis, href === PAGE ? 'workday' : 'clearcompany',
    () => href);
  removers.push(remove);
  return { view: view as unknown as { fetch: typeof fetch }, ownFetch, told, remove,
    answer(next: Response | Promise<never>) {
      response = next;
    } };
}

/** A response as fetch hands it back after a redirect (Response.redirected is read-only). */
function redirected(status: number): Response {
  const answer = new Response('{}', { status });
  Object.defineProperty(answer, 'redirected', { value: true });
  return answer;
}

/** Lets the answer's handlers run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const removers: Array<() => void> = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  ownOpen.mockClear();
  ownSend.mockClear();
});

describe('the page-world submit watcher (v5 p2-detect)', () => {
  it("tells Workday's finalize answered 200, handing the page its own call's answer, untouched", async () => {
    const { view, ownFetch, told } = page();
    const init = { method: 'POST', body: '{"anything":"the page sends"}', headers: { 'content-type': 'application/json' } };
    const answer = view.fetch(FINALIZE, init);
    // The page's own fetch ran with exactly what the page gave it, at once.
    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(ownFetch.mock.calls[0]![0]).toBe(FINALIZE);
    expect(ownFetch.mock.calls[0]![1]).toBe(init);
    const response = await answer;
    expect(response.status).toBe(200);
    // Its body is the page's to read: the watcher never read it.
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('{}');
    await settle();
    expect(told).toEqual(['workday-finalize']);
  });

  it('reads a Request the page passes, by its own method and address', async () => {
    const { view, told } = page();
    const request = new Request(FINALIZE, { method: 'POST', body: 'x' });
    await view.fetch(request);
    await settle();
    expect(told).toEqual(['workday-finalize']);
    expect(request.bodyUsed).toBe(false);
  });

  it('tells nothing for another answer, a redirect, another request, or a failure the page sees as its own', async () => {
    const { view, told, answer } = page();
    answer(new Response('{"errors":[]}', { status: 400 }));
    await view.fetch(FINALIZE, { method: 'POST' });
    answer(redirected(200));
    await view.fetch(FINALIZE, { method: 'POST' });
    answer(new Response('{}', { status: 200 }));
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
    const xhr = new FakeXhr() as unknown as XMLHttpRequest & FakeXhr;
    xhr.open('POST', '/wday/cxs/acme/jobapplication/JA-1/finalize', true);
    const body = '{"anything":"the page sends"}';
    xhr.send(body);
    expect(xhr.opened).toEqual(['POST', '/wday/cxs/acme/jobapplication/JA-1/finalize', true]);
    expect(xhr.sent[0]).toBe(body);
    expect(ownOpen).toHaveBeenCalledTimes(1);
    expect(ownSend).toHaveBeenCalledTimes(1);
    expect(told).toEqual([]);
    xhr.answer(200, FINALIZE);
    expect(told).toEqual(['workday-finalize']);
  });

  it('tells nothing for an XMLHttpRequest answered otherwise, redirected elsewhere, or not a sign', () => {
    const { told } = page();
    const failed = new FakeXhr() as unknown as XMLHttpRequest & FakeXhr;
    failed.open('POST', FINALIZE);
    failed.send();
    failed.answer(500, FINALIZE);
    const moved = new FakeXhr() as unknown as XMLHttpRequest & FakeXhr;
    moved.open('POST', FINALIZE);
    moved.send();
    moved.answer(200, 'https://acme.wd5.myworkdayjobs.com/en-US/External/login');
    const other = new FakeXhr() as unknown as XMLHttpRequest & FakeXhr;
    other.open('GET', FINALIZE);
    other.send();
    other.answer(200, FINALIZE);
    // Opened as a sign, then opened again as something else before its send: no sign.
    const reopened = new FakeXhr() as unknown as XMLHttpRequest & FakeXhr;
    reopened.open('POST', FINALIZE);
    reopened.open('GET', '/en-US/External');
    reopened.send();
    reopened.answer(200, FINALIZE);
    expect(told).toEqual([]);
  });

  it("tells ClearCompany's last answers and completed message, each as it is answered", async () => {
    const { view, told } = page(CC_PAGE);
    await view.fetch(RESPONSES, { method: 'POST', body: '{}' });
    await view.fetch(COMPLETED);
    await settle();
    expect(told).toEqual(['clearcompany-responses', 'clearcompany-completed']);
  });

  it("is removed whole, the page's own fetch, open and send put back", () => {
    const { view, ownFetch, remove } = page();
    expect(view.fetch).not.toBe(ownFetch);
    expect((FakeXhr.prototype as unknown as { open: unknown }).open).not.toBe(ownOpen);
    remove();
    expect(view.fetch).toBe(ownFetch);
    expect((FakeXhr.prototype as unknown as { open: unknown }).open).toBe(ownOpen);
    expect((FakeXhr.prototype as unknown as { send: unknown }).send).toBe(ownSend);
  });
});
