/*
 * The side panel's job card through the real worker (v2; job-cards.ts): read through the tab's form frame, which relays
 * the worker's job/refresh as job/lookup or job/add with nothing in either answer; kept in memory per document; Add and
 * Save to tracker; the resume the person chose; and what a token change takes with it. jobCardOf, the card a lookup
 * gives, is checked on its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AutofillLookupResponse } from '../contract/tailorit';
import { JOB_CARD_FAILED_TTL_MS, JOB_CARD_TTL_MS, JOB_RELAY_LIMIT, jobCardOf } from './job-cards';
import {
  beginRun,
  contentSender,
  goldens,
  LEVER_KEY,
  LEVER_URL,
  pageSender,
  sentToFrames,
  startTestWorker,
  tokenRecord,
  typeOfSent,
  type TestWorker,
} from './worker.testkit';

const LOOKUP = 'POST /api/autofill/lookup';
const ADD = 'POST /api/autofill/jobs';
const golden = goldens.lookup as unknown as AutofillLookupResponse;

/** A connected worker whose tab 7 shows a Lever form in frame 0, document doc-1, that relays job/refresh. */
async function withForm(options: { relay?: boolean } = {}): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  relayFrom(worker, options.relay ?? true);
  return worker;
}

/** The frame's side of the relay, as job-relay.ts answers: it sends job/lookup or job/add, then answers {}. */
function relayFrom(worker: TestWorker, relay: boolean, sender = contentSender()): void {
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string; action?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    if (!relay) return { ok: false, error: 'not_implemented' };
    const answer = (await worker.deliver({ v: 1, type: message.action === 'add' ? 'job/add' : 'job/lookup' }, sender)) as {
      ok: boolean };
    return answer.ok ? { ok: true, data: {} } : answer;
  };
}

const card = (worker: TestWorker, tabId = 7) => worker.deliver({ v: 1, type: 'panel/job', tabId }, pageSender());
const add = (worker: TestWorker, tabId = 7) => worker.deliver({ v: 1, type: 'panel/addJob', tabId }, pageSender());
const bodyOf = (worker: TestWorker, route: string) =>
  worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === route)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe('the job card (v2)', () => {
  it("answers the job behind the tab's form, looked up through its frame with the frame's own address", async () => {
    const worker = await withForm();
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: {
      state: 'answered',
      job: { title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA', closed: false,
        postedAt: Date.parse('2026-10-18T15:20:00.000Z'), salary: '$150k - $185k/yr', workArrangement: 'hybrid' },
      tracked: { status: 1, archived: false },
      resume: { label: 'Senior Software Engineer', fileKind: 'pdf', reason: 'application' },
      match: { state: 'ok', matchedCount: 9, total: 12, percentage: 75 },
      addable: true,
    } } });
    expect(bodyOf(worker, LOOKUP)).toEqual([{ url: LEVER_URL, includePostingText: false }]);
    // The frame was asked to relay, and nothing it was sent holds what TailorIT said.
    const toFrames = sentToFrames(worker);
    expect(toFrames.map((sent) => sent.message)).toEqual([{ v: 1, type: 'job/refresh', action: 'lookup' }]);
    expect(toFrames[0]!.options).toEqual({ frameId: 0, documentId: 'doc-1' });
    expect(JSON.stringify(worker.fakes.tabMessages)).not.toContain('Northwind');
  });

  it('answers the same document from memory, merges reads in flight, and reads again after ten minutes', async () => {
    const worker = await withForm();
    const [first, second] = await Promise.all([card(worker), card(worker)]);
    expect(first).toEqual(second);
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    worker.clock.now += JOB_CARD_TTL_MS;
    await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(2);
  });

  it('asks TailorIT nothing without a form in the tab or a connection, and shows no card', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    relayFrom(worker, true);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, contentSender());
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: null } });
    expect(await card(worker, 9)).toEqual({ ok: true, data: { tabId: 9, card: null } });
    const offline = await startTestWorker();
    relayFrom(offline, true);
    await offline.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    expect(await card(offline)).toEqual({ ok: true, data: { tabId: 7, card: null } });
    expect(worker.tailorit.count(LOOKUP) + offline.tailorit.count(LOOKUP)).toBe(0);
    expect(sentToFrames(offline)).toEqual([]);
  });

  it('says unavailable when the frame does not relay or TailorIT fails, keeping a failure for a minute only', async () => {
    const silent = await withForm({ relay: false });
    expect(await card(silent)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(silent.tailorit.count(LOOKUP)).toBe(0);
    const worker = await withForm();
    worker.tailorit.reply(LOOKUP, { status: 500, json: { error: { code: 'internal', message: 'x' } } }, { once: true });
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    worker.clock.now += JOB_CARD_FAILED_TTL_MS;
    expect((await card(worker) as { data: { card: { state: string } } }).data.card.state).toBe('answered');
    expect(worker.tailorit.count(LOOKUP)).toBe(2);
    // A fill's own lookup replaces a failure at once.
    const failing = await withForm();
    failing.tailorit.reply(LOOKUP, { status: 500, json: { error: { code: 'internal', message: 'x' } } }, { once: true });
    await card(failing);
    await beginRun(failing);
    expect((await card(failing) as { data: { card: { state: string } } }).data.card.state).toBe('answered');
    expect(failing.tailorit.count(LOOKUP)).toBe(2);
  });

  it('takes a job/lookup or job/add only while a refresh asked that document, at most six a minute per frame', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    for (const type of ['job/lookup', 'job/add']) {
      expect(await worker.deliver({ v: 1, type }, contentSender())).toEqual({ ok: false, error: 'expired' });
    }
    expect(worker.tailorit.count(LOOKUP) + worker.tailorit.count(ADD)).toBe(0);
    // Another document of the frame cannot answer this one's refresh.
    relayFrom(worker, true, contentSender({ documentId: 'doc-2' }));
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    for (let i = 0; i < JOB_RELAY_LIMIT.count + 2; i += 1) {
      await worker.deliver({ v: 1, type: 'job/lookup' }, contentSender({ frameId: 3 }));
    }
    expect(await worker.deliver({ v: 1, type: 'job/lookup' }, contentSender({ frameId: 3 })))
      .toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('is a page message and a content message apart: a frame cannot read a card, a page cannot relay', async () => {
    const worker = await withForm();
    expect(await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'job/lookup' }, pageSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'job/lookup', url: 'https://example.com' }, contentSender()))
      .toEqual({ ok: false, error: 'bad_message' });
  });

  it("drops a match that breaks the contract and keeps the rest of the lookup", async () => {
    const worker = await withForm();
    worker.tailorit.reply(LOOKUP, { json: { ...golden, match: { ...golden.match, percentage: 74.5 } } });
    const answer = (await card(worker)) as { data: { card: { job: unknown; match: unknown } } };
    expect(answer.data.card.match).toBeNull();
    expect(answer.data.card.job).toMatchObject({ title: 'Senior Backend Engineer' });
  });

  it("becomes run/begin's lookup without asking again, and never holds its posting text", async () => {
    const worker = await withForm();
    worker.tailorit.reply(LOOKUP, { json: { ...golden, job: { ...golden.job, postingText: 'Please do not use AI tools.' } } });
    await beginRun(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    const answer = await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    expect(JSON.stringify(answer)).not.toContain('do not use AI');
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh')).toEqual([]);
  });

  it("reads the card again after the frame's address changes in the same document, never the old posting's", async () => {
    const worker = await withForm();
    const port = worker.connect('panel', pageSender());
    port.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await card(worker);
    // A single-page application shows the next posting in the same document: the frame says hello with a new count.
    // Chrome still gives the document's first address as sender.url; the tab's address (sender.tab.url) is the new one.
    const next = LEVER_URL.replace('5f6e3c2b1a00', '5f6e3c2b1a01');
    const moved = contentSender({ tab: { id: 7, url: next } });
    relayFrom(worker, true, moved);
    worker.tailorit.reply(LOOKUP, { json: { ...golden, job: { ...golden.job, companyName: 'Contoso', title: 'Platform Engineer' } } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 1 }, moved);
    // The panel hears of it as a new page key (a count, never the address), so it reads the card again.
    await vi.waitFor(() => expect(port.received.some((message) =>
      (message as { page?: { formKey?: string } }).page?.formKey === '0:doc-1#1')).toBe(true));
    expect(JSON.stringify(port.received)).not.toContain('5f6e3c2b1a01');
    const answer = (await card(worker)) as { data: { card: { job: { company: string; title: string } } } };
    expect(answer.data.card.job).toMatchObject({ company: 'Contoso', title: 'Platform Engineer' });
    expect(bodyOf(worker, LOOKUP).map((body) => body.url)).toEqual([LEVER_URL, next]);
    // The same count again (a hello that changes nothing): the card is answered from memory.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 1 }, moved);
    await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(2);
    // The frame's registry entry holds the count, never the address.
    expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).not.toContain('5f6e3c2b1a01');
    // A tab address on another origin is never taken for the frame's; and the document's first address, which the page
    // has left, is not looked up either.
    const elsewhere = contentSender({ tab: { id: 7, url: 'https://boards.greenhouse.io/acme/jobs/123' } });
    relayFrom(worker, true, elsewhere);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 2 }, elsewhere);
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(worker.tailorit.count(LOOKUP)).toBe(2);
  });

  it('shows unavailable, never the previous posting, for a subframe a single-page application moved', async () => {
    // A form in a subframe: Chrome gives no tab address for it, and its sender.url is the document's first one.
    const frame = contentSender({ frameId: 3 });
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true }, frame);
    relayFrom(worker, true, frame);
    expect(((await card(worker)) as { data: { card: { state: string } } }).data.card.state).toBe('answered');
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, nav: 1 }, frame);
    expect(await card(worker)).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    // A fill there begins with no lookup either (as one that failed), never the previous posting's.
    await beginRun(worker, {}, frame);
    expect(worker.tailorit.count(LOOKUP)).toBe(1);
    expect(worker.tailorit.count(ADD)).toBe(0);
  });

  it('keeps no card for a lookup answered after its tab closed, from the card or from run/begin', async () => {
    for (const read of ['card', 'run/begin'] as const) {
      const worker = await withForm();
      const closeTab = () => void fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
      // TailorIT answers once the tab is gone: what it says must not become a card for whatever registers next.
      worker.tailorit.reply(LOOKUP, () => {
        closeTab();
        return { json: golden };
      }, { once: true });
      if (read === 'card') expect(await card(worker), read).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
      else await beginRun(worker);
      await vi.waitFor(async () => expect(Object.keys(await fakeBrowser.storage.session.get(null))
        .filter((key) => key.startsWith('frames:7:'))).toEqual([]));
      await withFrame(worker);
      await card(worker);
      expect(worker.tailorit.count(LOOKUP), read).toBe(2);
    }
  });

  it('forgets a document that is gone, and reads the new one', async () => {
    const worker = await withForm();
    await card(worker);
    relayFrom(worker, true, contentSender({ documentId: 'doc-2' }));
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ documentId: 'doc-2' }));
    await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(2);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh').map((sent) => sent.options))
      .toEqual([{ frameId: 0, documentId: 'doc-1' }, { frameId: 0, documentId: 'doc-2' }]);
  });
});

describe('Add this job to TailorIT and Save to tracker (v2)', () => {
  it("adds the frame's posting with its own address; its lookup becomes the card", async () => {
    const worker = await withForm();
    worker.tailorit.reply(ADD, { json: { created: true, lookup: { ...golden, job: { ...golden.job, title: 'Added job' } } } });
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'added' } });
    expect(bodyOf(worker, ADD)).toEqual([{ url: LEVER_URL }]);
    expect(((await card(worker)) as { data: { card: { job: { title: string } } } }).data.card.job.title).toBe('Added job');
    expect(worker.tailorit.count(LOOKUP)).toBe(0);
    worker.tailorit.reply(ADD, { json: { created: false, lookup: golden } });
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'saved' } });
  });

  it("says why TailorIT did not add it: closed, can't add, connect again, too many, unavailable", async () => {
    const worker = await withForm();
    const refusal = (status: number, code: string) => ({ status, json: { error: { code, message: 'x' } } });
    for (const [reply, outcome] of [[refusal(404, 'not_found'), 'closed'], [refusal(400, 'unsupported'), 'unsupported'],
      [refusal(403, 'forbidden'), 'not-allowed'], [refusal(429, 'rate_limited'), 'rate-limited'],
      [refusal(503, 'ats_unavailable'), 'unavailable'], [refusal(502, 'ats_failed'), 'unavailable'],
      [refusal(500, 'internal'), 'unavailable']] as const) {
      worker.tailorit.reply(ADD, reply, { once: true });
      worker.clock.now += 60_000;
      expect(await add(worker), outcome).toEqual({ ok: true, data: { outcome } });
    }
  });

  it('never sends an address TailorIT cannot add from', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const page = contentSender({ url: 'https://boards.greenhouse.io/embed/job_app?token=123' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, page);
    relayFrom(worker, true, page);
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'unsupported' } });
    expect(worker.tailorit.count(ADD)).toBe(0);
    expect(((await card(worker)) as { data: { card: { addable: boolean } } }).data.card.addable).toBe(false);
  });

  it('says too many when the frame relayed more than six a minute', async () => {
    const worker = await withForm();
    for (let i = 0; i < JOB_RELAY_LIMIT.count; i += 1) await add(worker);
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'rate-limited' } });
    expect(worker.tailorit.count(ADD)).toBe(JOB_RELAY_LIMIT.count);
  });

  it('answers not-connected or unavailable without a connection or a form', async () => {
    const offline = await startTestWorker();
    expect(await add(offline)).toEqual({ ok: true, data: { outcome: 'not-connected' } });
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(await add(worker)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    expect(worker.tailorit.count(ADD)).toBe(0);
  });
});

describe('the resume the person chose (v2)', () => {
  it('lists the resumes with the one the card attaches marked, never a file name', async () => {
    const worker = await withForm();
    await card(worker);
    const answer = await worker.deliver({ v: 1, type: 'panel/resumes', tabId: 7 }, pageSender());
    expect(answer).toEqual({ ok: true, data: { items: [
      { id: goldens.resumes.items[0]!.id, label: 'Senior Software Engineer', fileKind: 'pdf', kind: 'built', current: true },
      { id: goldens.resumes.items[1]!.id, label: 'Elena Ruiz CV', fileKind: 'docx', kind: 'uploaded', current: false },
    ] } });
    expect(JSON.stringify(answer)).not.toContain('.pdf');
  });

  it("goes with the card's lookup, run/begin and Add, and a card read for another choice is not shown", async () => {
    const worker = await withForm();
    const other = goldens.resumes.items[1]!.id;
    await card(worker);
    expect(await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: other }, pageSender()))
      .toEqual({ ok: true, data: {} });
    await card(worker);
    await beginRun(worker);
    await add(worker);
    expect(bodyOf(worker, LOOKUP).map((body) => body.resumeId)).toEqual([undefined, other, other]);
    expect(bodyOf(worker, ADD).map((body) => body.resumeId)).toEqual([other]);
    // Back to TailorIT's own choice: the next read asks without one.
    await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: null }, pageSender());
    await card(worker);
    expect(bodyOf(worker, LOOKUP).at(-1)!.resumeId).toBeUndefined();
  });

  it('applies a Change made while a fill runs to every file the fill has not uploaded yet', async () => {
    const worker = await withForm();
    const runId = await beginRun(worker);
    const files = () => worker.tailorit.requests.filter((request) => request.path.endsWith('/file')).map((request) => request.path);
    const upload = async (count: number) => {
      const port = worker.connect('resume', contentSender());
      port.post({ v: 1, type: 'resume/request', runId });
      await vi.waitFor(() => expect(files()).toHaveLength(count));
    };
    await upload(1);
    expect(files()).toEqual([`/api/autofill/resumes/${golden.suggestedResume!.id}/file`]);
    // The person chooses another resume mid-run: the next file the run uploads is that one, as TailorIT names it.
    const other = goldens.resumes.items[1]!;
    await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: other.id }, pageSender());
    worker.tailorit.reply(LOOKUP, { json: { ...golden, suggestedResume: { id: other.id, label: other.label, kind: other.kind,
      fileKind: other.fileKind, fileName: other.fileName, reason: 'chosen' } } });
    await upload(2);
    expect(files()[1]).toBe(`/api/autofill/resumes/${other.id}/file`);
    expect(bodyOf(worker, LOOKUP).at(-1)).toEqual({ url: LEVER_URL, includePostingText: false, resumeId: other.id });
  });
});

describe('a token change (v2, token hygiene)', () => {
  it('takes every card, choice and run lookup with it, and reads them again with the new one', async () => {
    const worker = await withForm();
    await card(worker);
    await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id }, pageSender());
    await beginRun(worker);
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html')))
      .toMatchObject({ ok: true });
    const before = worker.tailorit.count(LOOKUP);
    await card(worker);
    expect(worker.tailorit.count(LOOKUP)).toBe(before + 1);
    expect(bodyOf(worker, LOOKUP).at(-1)!.resumeId).toBeUndefined();
  });

  it('shows no card for a lookup that was in flight when the token changed', async () => {
    const worker = await withForm();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      await held;
      return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    };
    // The token changes while the frame has not relayed yet: the relay that then comes sends nothing under the new one.
    const reading = card(worker);
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    release();
    expect(await reading).toEqual({ ok: true, data: { tabId: 7, card: { state: 'unavailable' } } });
    expect(worker.tailorit.count(LOOKUP)).toBe(0);
  });

  it('tells every open side panel when the connection or the settings change, and nothing more', async () => {
    const worker = await withForm();
    // One panel follows the tab, another has not watched any yet (a window with no tab of ours).
    const watching = worker.connect('panel', pageSender());
    watching.post({ v: 1, type: 'panel/watch', tabId: 7 });
    const idle = worker.connect('panel', pageSender());
    const changes = (port: typeof idle) => port.received.filter((message) => (message as { type?: string }).type === 'panel/changed');
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    for (const port of [watching, idle]) {
      expect(changes(port)).toEqual([{ v: 1, type: 'panel/changed', what: 'connection' },
        { v: 1, type: 'panel/changed', what: 'connection' }]);
    }
    await worker.deliver({ v: 1, type: 'settings/save', settings: (await worker.deliver({ v: 1, type: 'settings/get' },
      pageSender('options.html')) as { data: { settings: unknown } }).data.settings }, pageSender('options.html'));
    expect(changes(idle).at(-1)).toEqual({ v: 1, type: 'panel/changed', what: 'settings' });
  });

  it('sends no Add that was asked for before the token changed, and says to connect', async () => {
    const worker = await withForm();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      await held;
      return worker.deliver({ v: 1, type: 'job/add' }, contentSender());
    };
    const adding = add(worker);
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    release();
    expect(await adding).toEqual({ ok: true, data: { outcome: 'not-connected' } });
    expect(worker.tailorit.count(ADD)).toBe(0);
  });

  it('keeps nothing of the card in storage or the logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const worker = await withForm();
    await card(worker);
    await add(worker);
    const kept = JSON.stringify({ local: await fakeBrowser.storage.local.get(null), session: await fakeBrowser.storage.session.get(null),
      logs: info.mock.calls });
    for (const text of ['Northwind', 'Senior Backend Engineer', 'Senior Software Engineer', 'Austin', goldens.lookup.application.id,
      'tailorit-fixture']) expect(kept).not.toContain(text);
  });
});

describe('jobCardOf', () => {
  it('drops a match that scores another resume, and an ok match whose counts disagree', () => {
    expect(jobCardOf({ ...golden, match: { ...golden.match!, resumeId: 'another' } }, true)).toMatchObject({ match: null });
    expect(jobCardOf({ ...golden, match: { state: 'ok', resumeId: golden.suggestedResume!.id, matchedCount: 13, total: 12,
      percentage: 100 } }, true)).toMatchObject({ match: null });
    expect(jobCardOf({ ...golden, match: { state: 'no_keywords', resumeId: golden.suggestedResume!.id } }, true))
      .toMatchObject({ match: { state: 'no-keywords' } });
    expect(jobCardOf({ ...golden, suggestedResume: null }, true)).toMatchObject({ resume: null, match: null });
  });

  it('carries no id, address, posting text or file name, and cuts long text at a word', () => {
    const long = `${'Senior '.repeat(60)}Engineer`;
    const shown = jobCardOf({ ...golden, job: { ...golden.job!, title: long, postingText: 'Do not use AI.' } }, false);
    const text = JSON.stringify(shown);
    for (const hidden of [String(golden.job!.id), golden.application!.id, golden.suggestedResume!.id, golden.suggestedResume!.fileName,
      'Do not use AI', 'northwind', '5512345002']) expect(text).not.toContain(hidden);
    expect((shown as { job: { title: string } }).job.title.length).toBeLessThanOrEqual(300);
    expect((shown as { job: { title: string } }).job.title.endsWith(' ')).toBe(false);
  });
});

describe('a lookup a fill reads (v2)', () => {
  it("keeps the stored copy's policy hit when the lookup's match cannot be read, dropping only the match", async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(LOOKUP, { json: { ...golden, match: { ...golden.match, percentage: 74.5 },
      job: { ...golden.job, postingText: 'Please do not use AI tools to write your answers.' } } });
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      contentSender())).toMatchObject({ ok: true, data: { policy: { storedCopy: 'hit' } } });
  });

  it('keeps a lookup whose match breaks the contract, and drops only the match (the server client)', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(LOOKUP, { json: { ...golden, match: { state: 'perfect' } } });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await withFrame(worker);
    const answer = (await card(worker)) as { data: { card: { job: { title: string }; match: unknown } } };
    expect(answer.data.card).toMatchObject({ job: { title: 'Senior Backend Engineer' }, match: null });
    expect(info.mock.calls.some(([line]) => String(line).includes('server.lookup-match-dropped'))).toBe(true);
  });

  it('chooses the resume again after the token changes, and asks for the chosen one', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const other = goldens.resumes.items[1]!.id;
    await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: other }, pageSender());
    const runId = await beginRun(worker);
    expect(bodyOf(worker, LOOKUP).at(-1)!.resumeId).toBe(other);
    // A new connection: the run's lookup, resume and choice are gone; the resume port reads them again without the choice.
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    const port = worker.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(1));
    const lookups = bodyOf(worker, LOOKUP);
    expect(lookups).toHaveLength(2);
    expect(lookups[1]).toEqual({ url: LEVER_URL, includePostingText: false });
  });
});

async function withFrame(worker: TestWorker): Promise<void> {
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  relayFrom(worker, true);
}
