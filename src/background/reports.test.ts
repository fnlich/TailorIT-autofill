import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { FakePortPeer } from '../platform/fake';
import { PANEL_SHOWN_LIMIT, REPORT_PUT_LIMIT } from './reports';
import {
  beginRun, contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

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
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 8 }, pageSender()))
      .toEqual({ ok: true, data: { tabId: 8, reports: [], page: { support: 'none', platform: null, formKey: null } } });
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, contentSender({ frameId: 2, documentId: 'doc-2' }))).toEqual({ ok: false, error: 'bad_sender' });
  });

  describe('the panel port', () => {
    it('answers the watched tab at once and again on every change', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const runId = await beginRun(worker);
      const port = watch(worker, 7);
      await vi.waitFor(() => expect(port.received).toHaveLength(1));
      expect(port.received[0]).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [], page: { support: 'none', platform: null, formKey: null } });
      await putReport(worker, runId, frameReport(runId));
      await vi.waitFor(() => expect(port.received).toHaveLength(2));
      expect(port.received[1]).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [frameReport(runId)], page: { support: 'none', platform: null, formKey: null } });
    });

    it("answers and pushes what the tab's page holds: a form with its platform, frames without one, none of ours (v2)", async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const read = async (tabId: number) => ((await worker.deliver({ v: 1, type: 'panel/reports', tabId }, pageSender())) as {
        data: { page: unknown } }).data.page;
      expect(await read(7)).toEqual({ support: 'none', platform: null, formKey: null });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, contentSender());
      expect(await read(7)).toEqual({ support: 'no-form', platform: null, formKey: null });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true }, EMBED);
      expect(await read(7)).toEqual({ support: 'form', platform: 'greenhouse', formKey: '3:doc-3' });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
      // The lowest frame with a form names the page.
      expect(await read(7)).toEqual({ support: 'form', platform: 'lever', formKey: '0:doc-1' });
    });

    it('pushes the page state again on a hello, only to a watcher it changed for (v2)', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const port = watch(worker, 7);
      await vi.waitFor(() => expect(port.received).toHaveLength(1));
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
      await vi.waitFor(() => expect(port.received).toHaveLength(2));
      expect(port.received[1]).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [],
        page: { support: 'form', platform: 'lever', formKey: '0:doc-1' } });
      // The same document says hello again (a page back from the cache): nothing changed, nothing is pushed.
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
      await new Promise((resolve) => setImmediate(resolve));
      expect(port.received).toHaveLength(2);
      // Another document in the frame: a new key, pushed.
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ documentId: 'doc-9' }));
      await vi.waitFor(() => expect(port.received).toHaveLength(3));
      expect((port.received[2] as { page: { formKey: string } }).page.formKey).toBe('0:doc-9');
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
      const fromContent = worker.connect('panel', contentSender({ frameId: 2, documentId: 'doc-2' }));
      await vi.waitFor(() => expect(fromContent.disconnectedByWorker).toBe(true));
      const port = worker.connect('panel', pageSender());
      port.post({ v: 1, type: 'panel/update', tabId: 7, reports: [] });
      await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    });
  });

  describe('the in-page panel (panel/shown)', () => {
    const inPage = (worker: TestWorker) =>
      worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'page' } }, pageSender('options.html'));
    const shown = (worker: TestWorker, open: boolean, sender = contentSender()) =>
      worker.deliver({ v: 1, type: 'panel/shown', open }, sender);
    const reportUpdates = (worker: TestWorker) => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'report/update');

    it('sends the tab\'s combined report to the one frame that shows the panel, at once and on every change', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      await hello(worker, EMBED);
      await inPage(worker);
      const topRun = await beginRun(worker);
      const embedRun = await beginRun(worker, { applicationKey: 'greenhouse:0123456789abcdef' }, EMBED);
      await putReport(worker, topRun, frameReport(topRun));
      // Both frames reported, and neither shows the panel: no frame hears the other's labels.
      await putReport(worker, embedRun, frameReport(embedRun, 3, { platform: 'greenhouse', adapter: 'greenhouse' }), EMBED);
      expect(reportUpdates(worker)).toEqual([]);

      expect(await shown(worker, true, EMBED)).toEqual({ ok: true, data: {} });
      const both = [frameReport(topRun), frameReport(embedRun, 3, { platform: 'greenhouse', adapter: 'greenhouse' })];
      expect(reportUpdates(worker)).toEqual([{ tabId: 7, message: { v: 1, type: 'report/update', reports: both },
        options: { frameId: 3, documentId: 'doc-3' } }]);

      await putReport(worker, topRun, frameReport(topRun, 0, { status: 'done' }));
      expect(reportUpdates(worker)).toHaveLength(2);
      expect(reportUpdates(worker).map((sent) => sent.options)).toEqual([{ frameId: 3, documentId: 'doc-3' },
        { frameId: 3, documentId: 'doc-3' }]);

      // Closed: nothing more goes to it. Another frame's close changes nothing.
      expect(await shown(worker, false, contentSender())).toEqual({ ok: true, data: {} });
      await putReport(worker, topRun, frameReport(topRun, 0, { status: 'stopped' }));
      expect(reportUpdates(worker)).toHaveLength(3);
      expect(await shown(worker, false, EMBED)).toEqual({ ok: true, data: {} });
      await putReport(worker, embedRun, frameReport(embedRun, 3, { platform: 'greenhouse', adapter: 'greenhouse', status: 'done' }), EMBED);
      expect(reportUpdates(worker)).toHaveLength(3);
    });

    it('sends nothing while the person chose the side panel, and only to the frame that opened it last', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      // v5 p1-shell: the panel shows on the page by default; the person chose Chrome's side panel.
      await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'side' } },
        pageSender('options.html'));
      await hello(worker);
      await hello(worker, EMBED);
      const runId = await beginRun(worker);
      await shown(worker, true);
      await putReport(worker, runId, frameReport(runId));
      expect(reportUpdates(worker)).toEqual([]);

      await inPage(worker);
      await shown(worker, true, EMBED);
      await putReport(worker, runId, frameReport(runId, 0, { status: 'done' }));
      expect(reportUpdates(worker).map((sent) => sent.options?.frameId)).toEqual([3, 3]);
    });

    it('forgets the frame once its document is gone, or its tab closes', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      await hello(worker, EMBED);
      await inPage(worker);
      const runId = await beginRun(worker);
      await shown(worker, true, EMBED);
      expect(await fakeBrowser.storage.session.get('panel-frame:7')).toEqual({ 'panel-frame:7': { frameId: 3, documentId: 'doc-3' } });
      // The embedded frame loads another document: its panel went with the old one.
      await hello(worker, { ...EMBED, documentId: 'doc-4' });
      await vi.waitFor(async () => expect(await fakeBrowser.storage.session.get(null)).not.toHaveProperty('panel-frame:7'));
      const before = reportUpdates(worker).length;
      await putReport(worker, runId, frameReport(runId));
      expect(reportUpdates(worker)).toHaveLength(before);

      await shown(worker, true);
      await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
      await vi.waitFor(async () => expect(await fakeBrowser.storage.session.get(null)).not.toHaveProperty('panel-frame:7'));
    });

    it('is a content message only, strict, and limited per frame', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      expect(await worker.deliver({ v: 1, type: 'panel/shown', open: true }, pageSender())).toEqual({ ok: false, error: 'bad_sender' });
      expect(await worker.deliver({ v: 1, type: 'panel/shown', open: 'yes' }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
      expect(await worker.deliver({ v: 1, type: 'panel/shown', open: true, frameId: 3 }, contentSender()))
        .toEqual({ ok: false, error: 'bad_message' });
      for (let index = 0; index < PANEL_SHOWN_LIMIT.count; index += 1) {
        expect(await shown(worker, index % 2 === 0)).toEqual({ ok: true, data: {} });
      }
      expect(await shown(worker, true)).toMatchObject({ ok: false, error: 'rate_limited' });
    });
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

describe('a live report against the stored one (the audit of 2026-11-06)', () => {
  it('never replaces the run’s own report of the same moment, but replaces a live one of that moment', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const final = frameReport(runId);
    const keys = final.fields.map((field) => field.key);
    const live = { ...final, status: 'fill-step' as const, filling: { current: keys[0], pending: keys } };
    const live2 = { ...live, filling: { current: keys[0], pending: keys.slice(0, 1) } };
    // The run's own report first, then a live one built at the same moment (on its way while the report went): kept.
    expect(await putReport(worker, runId, final)).toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'report/live', runId, report: live }, contentSender()))
      .toEqual({ ok: true, data: {} });
    expect(await fakeBrowser.storage.session.get('report:7:0')).toEqual({ 'report:7:0': final });
    // A live report stored, then another live one of the same moment: the newer word.
    const other = await startTestWorker({ token: tokenRecord() });
    const run2 = await beginRun(other);
    await other.deliver({ v: 1, type: 'report/live', runId: run2, report: { ...live, runId: run2 } }, contentSender());
    await other.deliver({ v: 1, type: 'report/live', runId: run2, report: { ...live2, runId: run2 } }, contentSender());
    expect(await fakeBrowser.storage.session.get('report:7:0')).toEqual({ 'report:7:0': { ...live2, runId: run2 } });
  });
});
