import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { FakePortPeer } from '../platform/fake';
import { REPORT_PUT_LIMIT } from './reports';
import { beginRun, contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const EMBED = contentSender({ frameId: 3, documentId: 'doc-3', url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123' });

const putReport = (worker: TestWorker, runId: string, report: unknown, sender = contentSender()) =>
  worker.deliver({ v: 1, type: 'report/put', runId, report }, sender);

async function hello(worker: TestWorker, sender = contentSender(), hasForm = true) {
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm }, sender);
}

/** A side panel's port, watching `tabId`. */
function watch(worker: TestWorker, tabId: number): FakePortPeer {
  const port = worker.connect('panel', pageSender());
  port.post({ v: 1, type: 'panel/watch', tabId });
  return port;
}

const updates = (port: FakePortPeer) => port.received as Array<{ type: string; tabId: number; reports: Array<{ frameId: number }> }>;

describe('reports', () => {
  it('stores a frame\'s report per tab and frame', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await putReport(worker, runId, frameReport(runId))).toEqual({ ok: true, data: {} });
    expect(await fakeBrowser.storage.session.get('report:7:0')).toEqual({ 'report:7:0': frameReport(runId) });
  });

  it('accepts a report only from the frame whose run it is', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await putReport(worker, 'A'.repeat(22), frameReport('A'.repeat(22)))).toEqual({ ok: false, error: 'expired' });
    expect(await putReport(worker, runId, frameReport('B'.repeat(22)))).toEqual({ ok: false, error: 'bad_message' });
    expect(await putReport(worker, runId, frameReport(runId, 2))).toEqual({ ok: false, error: 'bad_message' });
    expect(await putReport(worker, runId, frameReport(runId), contentSender({ frameId: 2 }))).toEqual({ ok: false, error: 'expired' });
    expect(await fakeBrowser.storage.session.get(null)).not.toHaveProperty('report:7:0');
  });

  it('refuses a report with anything that could hold a value', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const report = frameReport(runId);
    expect(await putReport(worker, runId, { ...report, values: ['alex.rivera.f7q2@example.com'] })).toEqual({ ok: false, error: 'bad_message' });
    expect(await putReport(worker, runId, { ...report, fields: [{ ...report.fields[0], value: 'Alex' }] }))
      .toEqual({ ok: false, error: 'bad_message' });
  });

  it(`takes at most ${REPORT_PUT_LIMIT.count} reports a second from one frame`, async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    for (let index = 0; index < REPORT_PUT_LIMIT.count; index += 1) {
      expect(await putReport(worker, runId, frameReport(runId))).toEqual({ ok: true, data: {} });
    }
    expect(await putReport(worker, runId, frameReport(runId))).toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 1 });
    worker.clock.now += REPORT_PUT_LIMIT.windowMs;
    expect(await putReport(worker, runId, frameReport(runId))).toEqual({ ok: true, data: {} });
  });

  it('answers a tab\'s combined report, by frame', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const embedRun = await beginRun(worker, { applicationKey: 'greenhouse:0123456789abcdef' }, EMBED);
    const topRun = await beginRun(worker);
    await putReport(worker, embedRun, frameReport(embedRun, 3, { platform: 'greenhouse', adapter: 'greenhouse' }), EMBED);
    await putReport(worker, topRun, frameReport(topRun));
    const answer = (await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())) as {
      ok: true; data: { tabId: number; reports: Array<{ frameId: number }> } };
    expect(answer.data.tabId).toBe(7);
    expect(answer.data.reports.map((report) => report.frameId)).toEqual([0, 3]);
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 8 }, pageSender())).toEqual({ ok: true, data: { tabId: 8, reports: [] } });
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
  });

  describe('the panel port', () => {
    it('answers the watched tab at once and again on every change', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const runId = await beginRun(worker);
      const port = watch(worker, 7);
      await vi.waitFor(() => expect(port.received).toHaveLength(1));
      expect(port.received[0]).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [] });
      await putReport(worker, runId, frameReport(runId));
      await vi.waitFor(() => expect(port.received).toHaveLength(2));
      expect(port.received[1]).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [frameReport(runId)] });
    });

    it('follows one tab at a time, the latest watched', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const runId = await beginRun(worker);
      const port = watch(worker, 8);
      await vi.waitFor(() => expect(port.received).toHaveLength(1));
      await putReport(worker, runId, frameReport(runId));
      await new Promise((resolve) => setImmediate(resolve));
      expect(port.received).toHaveLength(1);
      port.post({ v: 1, type: 'panel/watch', tabId: 7 });
      await vi.waitFor(() => expect(port.received).toHaveLength(2));
      expect(updates(port)[1]).toMatchObject({ tabId: 7, reports: [{ frameId: 0 }] });
    });

    it('stops pushing to a port that disconnected', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const runId = await beginRun(worker);
      const port = watch(worker, 7);
      await vi.waitFor(() => expect(port.received).toHaveLength(1));
      port.disconnect();
      await new Promise((resolve) => setImmediate(resolve));
      expect(await putReport(worker, runId, frameReport(runId))).toEqual({ ok: true, data: {} });
      expect(port.received).toHaveLength(1);
    });

    it('is refused to a content script, and closed on a message it does not know', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const fromContent = worker.connect('panel', contentSender());
      await vi.waitFor(() => expect(fromContent.disconnectedByWorker).toBe(true));
      const port = worker.connect('panel', pageSender());
      port.post({ v: 1, type: 'panel/update', tabId: 7, reports: [] });
      await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    });
  });

  it('pushes the combined report to the reporting frames when the in-page panel is chosen', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker);
    const runId = await beginRun(worker);
    await putReport(worker, runId, frameReport(runId));
    expect(sentToFrames(worker)).toEqual([]);

    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'in-page' } }, pageSender('options.html'));
    await putReport(worker, runId, frameReport(runId, 0, { status: 'done' }));
    expect(sentToFrames(worker)).toEqual([{
      tabId: 7,
      message: { v: 1, type: 'report/update', reports: [frameReport(runId, 0, { status: 'done' })] },
      options: { frameId: 0, documentId: 'doc-1' },
    }]);
  });

  it('drops a tab\'s reports when it closes, and a frame\'s when it loads another document', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker);
    await hello(worker, EMBED);
    const topRun = await beginRun(worker);
    const embedRun = await beginRun(worker, { applicationKey: 'greenhouse:0123456789abcdef' }, EMBED);
    await putReport(worker, topRun, frameReport(topRun));
    await putReport(worker, embedRun, frameReport(embedRun, 3, { platform: 'greenhouse', adapter: 'greenhouse' }), EMBED);
    const port = watch(worker, 7);
    await vi.waitFor(() => expect(port.received).toHaveLength(1));

    await hello(worker, { ...EMBED, documentId: 'doc-4' });
    expect(Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith('report:'))).toEqual(['report:7:0']);
    await vi.waitFor(() => expect(port.received).toHaveLength(2));
    expect(updates(port)[1]!.reports.map((report) => report.frameId)).toEqual([0]);

    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await vi.waitFor(() => expect(port.received).toHaveLength(3));
    expect(updates(port)[2]).toMatchObject({ tabId: 7, reports: [] });
    const left = Object.keys(await fakeBrowser.storage.session.get(null));
    expect(left.filter((key) => key.startsWith('report:') || key.startsWith('frames:7:') || key.startsWith('runs:'))).toEqual([]);
  });
});
