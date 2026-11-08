/*
 * Recording "applied" (submissions.ts) across a stopped worker and a token change, through the real worker against
 * the fake TailorIT (the audit of 2026-11-06): the run's job and resume named after Chrome stopped the idle worker
 * (M6), Try again after it (m4), the side panel told where recording stands, and a token change that drops the arms
 * and the page states together (m4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import {
  beginRun, contentSender, fieldSpec, goldens, LEVER_URL, pageSender, restartTestWorker, startTestWorker, tokenRecord,
  type TestWorker,
} from './worker.testkit';

const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());
const bodyOf = (worker: TestWorker, route: string) =>
  worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === route)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);

/** A connected worker whose tab 7 shows a Lever form in frame 0. */
async function withForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    return { ok: true, data: {} };
  };
  return worker;
}

afterEach(() => vi.restoreAllMocks());

describe('a Submit after the worker was stopped, and a token change (the audit of 2026-11-06)', () => {
  const detected = (worker: TestWorker) => worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY,
    evidence: 'success-message' }, contentSender());
  const reportsOf = async (worker: TestWorker) =>
    ((await page(worker, { type: 'panel/reports', tabId: 7 })) as { data: { page: Record<string, unknown> } }).data.page;

  it('names the run’s job and the resume it attached when the worker was stopped before the Submit (M6)', async () => {
    const worker = await withForm();
    const runId = await beginRun(worker, { applicationKey: KEY });
    const upload = fieldSpec(1, { kind: 'file' });
    await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [upload], planKeys: [upload.key],
      canaries: [], notices: [] }, contentSender());
    // The person reviews for a while: Chrome stops the idle worker, and its memory goes.
    const restarted = await restartTestWorker(worker, { token: tokenRecord() });
    restarted.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    expect(await restarted.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel', runId, resume: true },
      contentSender())).toEqual({ ok: true, data: {} });
    expect(await detected(restarted)).toEqual({ ok: true, data: {} });
    expect(bodyOf(restarted, 'POST /api/autofill/applied')).toEqual([{ jobId: goldens.lookup.job.id,
      resumeId: goldens.lookup.suggestedResume.id }]);
    // The record holds ids, never an address or a name.
    const runs = JSON.stringify(Object.entries(await fakeBrowser.storage.session.get(null))
      .filter(([key]) => key.startsWith('runs:')));
    expect(runs).not.toContain('lever.co');
    expect(runs).not.toContain(goldens.lookup.suggestedResume.fileName);
  });

  it('Try again after the worker was stopped still records, by the posting’s address (m4)', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 503, json: { error: { code: 'unavailable',
      message: 'x' } } }, { once: true });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    expect(await reportsOf(worker)).toMatchObject({ submitted: 'not-recorded' });
    const restarted = await restartTestWorker(worker, { token: tokenRecord() });
    restarted.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    expect(await page(restarted, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: true, data: {} });
    // The first ask (503), then Try again's, with the posting's canonical address the arm kept.
    expect(bodyOf(restarted, 'POST /api/autofill/applied')).toEqual([1, 2].map(() => ({
      url: 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00' })));
    expect(await reportsOf(restarted)).toMatchObject({ submitted: 'recorded' });
  });

  it('tells a side panel watching the tab where recording stands (the panel told of recording)', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    const port = worker.connect('panel', pageSender());
    port.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThan(0));
    const before = port.received.length;
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    await vi.waitFor(() => expect(port.received.slice(before).some((message) =>
      (message as { page?: { submitted?: string } }).page?.submitted === 'recorded')).toBe(true));
  });

  it('a token change drops the arms and the page states together: nothing recorded, no Try again offered (m4)', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 503, json: { error: { code: 'unavailable',
      message: 'x' } } });
    // One Submit whose recording failed (Try again offered), and one armed whose sign has not come yet.
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    expect(await reportsOf(worker)).toMatchObject({ submitted: 'not-recorded' });
    const other = 'https://jobs.lever.co/tailorit-fixture/11111111-2222-4333-8444-555555555555/apply';
    const otherKey = applicationOf(new URL(other))!.applicationKey;
    const tab8 = contentSender({ url: other, tab: { id: 8, url: other } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, tab8);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: otherKey, by: 'page' }, tab8))
      .toEqual({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    await vi.waitFor(async () => expect(Object.keys(await fakeBrowser.storage.session.get(null))
      .filter((key) => key.startsWith('submit-arm:') || key.startsWith('submitted:'))).toEqual([]));
    const sent = worker.tailorit.count('POST /api/autofill/applied');
    // The old connection's Submit is neither offered again nor recorded under the new one.
    expect(await reportsOf(worker)).not.toHaveProperty('submitted');
    expect(await page(worker, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: false, error: 'expired' });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: otherKey, evidence: 'success-message' },
      tab8)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(sent);
  });
});

// v5 p1-panel (PLAN decision 5): the page's "Application Submitted!" window.
describe('the applied popup: the tab’s top frame told once TailorIT recorded the application', () => {
  const detected = (worker: TestWorker) => worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY,
    evidence: 'success-message' }, contentSender());
  const popups = (worker: TestWorker) => worker.fakes.tabMessages.filter((sent) =>
    (sent.message as { type?: string }).type === 'applied/popup');

  it('tells the top frame once, when the tracker recorded it, and never again for the same sign', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    await vi.waitFor(() => expect(popups(worker)).toHaveLength(1));
    const [sent] = popups(worker);
    expect(sent!.message).toEqual({ v: 1, type: 'applied/popup' });
    expect([sent!.tabId, sent!.options?.frameId]).toEqual([7, 0]);
    // A second sign of the same Submit records nothing more, and shows nothing more.
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    expect(popups(worker)).toHaveLength(1);
  });

  it('says nothing while the tracker could not be told, and tells the top frame once Try again recorded it', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 503, json: { error: { code: 'unavailable',
      message: 'x' } } }, { once: true });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    expect(popups(worker)).toEqual([]);
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    expect(await page(worker, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(popups(worker)).toHaveLength(1));
  });

  it('says nothing when TailorIT refused it for good', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 403, json: { error: { code: 'forbidden',
      message: 'x' } } });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(worker);
    expect(popups(worker)).toEqual([]);
  });
});
