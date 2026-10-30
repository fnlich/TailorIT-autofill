import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beginRun, contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const FORM_FRAME = contentSender({ frameId: 4, documentId: 'doc-4', url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1' });
const PLAIN_FRAME = contentSender({ frameId: 5, documentId: 'doc-5', url: 'https://jobs.lever.co/acme' });
const KEY = 'fieldkey|main|first-name|none|0';

async function hello(worker: TestWorker, sender: ReturnType<typeof contentSender>, hasForm: boolean) {
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm }, sender);
}

/** The top frame and one embedded form frame have forms; one more frame has none. */
async function tabWithFrames(worker: TestWorker) {
  await hello(worker, contentSender(), true);
  await hello(worker, FORM_FRAME, true);
  await hello(worker, PLAIN_FRAME, false);
}

const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());

describe('the panel\'s messages', () => {
  it('panel/fill starts every registered frame of the tab that has a form', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    expect(await page(worker, { type: 'panel/fill', tabId: 7, dryRun: true })).toEqual({ ok: true, data: { frames: 2 } });
    expect(sentToFrames(worker)).toEqual([
      { tabId: 7, message: { v: 1, type: 'run/start', dryRun: true }, options: { frameId: 0, documentId: 'doc-1' } },
      { tabId: 7, message: { v: 1, type: 'run/start', dryRun: true }, options: { frameId: 4, documentId: 'doc-4' } },
    ]);
  });

  it('panel/fill counts only the frames that answered, and needs a connection', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    worker.fakes.frameAnswers = ({ options }) => {
      if (options?.frameId === 4) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, data: {} };
    };
    expect(await page(worker, { type: 'panel/fill', tabId: 7, dryRun: false })).toEqual({ ok: true, data: { frames: 1 } });

    const offline = await startTestWorker();
    await tabWithFrames(offline);
    expect(await page(offline, { type: 'panel/fill', tabId: 7, dryRun: false })).toEqual({ ok: false, error: 'not_connected' });
    expect(sentToFrames(offline)).toEqual([]);
  });

  it('panel/continue and panel/cancel reach the frames that reported', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    const runId = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId) }, contentSender());
    expect(await page(worker, { type: 'panel/continue', tabId: 7 })).toEqual({ ok: true, data: { frames: 1 } });
    expect(await page(worker, { type: 'panel/cancel', tabId: 7 })).toEqual({ ok: true, data: { frames: 1 } });
    expect(sentToFrames(worker).map((sent) => sent.message)).toEqual([{ v: 1, type: 'run/continue' }, { v: 1, type: 'run/cancel' }]);
    expect(sentToFrames(worker).every((sent) => sent.options?.frameId === 0)).toBe(true);
    expect(await page(worker, { type: 'panel/cancel', tabId: 8 })).toEqual({ ok: true, data: { frames: 0 } });
  });

  it('panel/focus goes to the frame that holds the field', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    expect(await page(worker, { type: 'panel/focus', tabId: 7, frameId: 4, fieldKey: KEY })).toEqual({ ok: true, data: {} });
    expect(sentToFrames(worker)).toEqual([
      { tabId: 7, message: { v: 1, type: 'field/focus', fieldKey: KEY }, options: { frameId: 4, documentId: 'doc-4' } },
    ]);
    expect(await page(worker, { type: 'panel/focus', tabId: 7, frameId: 9, fieldKey: KEY })).toEqual({ ok: false, error: 'expired' });
  });

  it('panel/describe passes the frame\'s option labels through, checked and never stored', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    const labels = { options: [{ index: 2, label: 'The University of Texas at Austin' }, { index: 7, label: 'UT Dallas' }] };
    worker.fakes.frameAnswers = () => ({ ok: true, data: labels });
    expect(await page(worker, { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: KEY })).toEqual({ ok: true, data: labels });
    expect(sentToFrames(worker).at(-1)).toEqual({ tabId: 7, message: { v: 1, type: 'field/describe', fieldKey: KEY },
      options: { frameId: 0, documentId: 'doc-1' } });
    const stored = JSON.stringify([await fakeBrowser.storage.local.get(null), await fakeBrowser.storage.session.get(null)]);
    expect(stored).not.toContain('Texas');

    worker.fakes.frameAnswers = () => ({ ok: true, data: { options: [{ index: 1, label: 'x'.repeat(301) }] } });
    expect(await page(worker, { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: KEY })).toEqual({ ok: false, error: 'unavailable' });
    worker.fakes.frameAnswers = () => ({ ok: false, error: 'expired' });
    expect(await page(worker, { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: KEY })).toEqual({ ok: false, error: 'unavailable' });
    worker.fakes.frameAnswers = () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    expect(await page(worker, { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: KEY })).toEqual({ ok: false, error: 'unavailable' });
  });

  it('panel/confirmDraft and panel/saveAnswer wait for Phase 6', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await tabWithFrames(worker);
    for (const type of ['panel/confirmDraft', 'panel/saveAnswer']) {
      expect(await page(worker, { type, tabId: 7, frameId: 0, fieldKey: KEY })).toEqual({ ok: false, error: 'not_implemented' });
    }
    expect(sentToFrames(worker)).toEqual([]);
  });
});

describe('panel/open', () => {
  it('opens the side panel for the launcher\'s tab before anything is awaited', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const answer = worker.deliver({ v: 1, type: 'panel/open' }, contentSender());
    // Still inside the click's turn: the call has been made synchronously.
    expect(worker.fakes.sidePanelCalls).toContainEqual({ method: 'open', args: { tabId: 7 } });
    expect(await answer).toEqual({ ok: true, data: {} });
  });

  it('answers unavailable when the browser refuses (the toolbar button remains)', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), before: (fakes) => fakes.refuseSidePanel(true) });
    expect(await worker.deliver({ v: 1, type: 'panel/open' }, contentSender())).toEqual({ ok: false, error: 'unavailable' });
  });

  it('is a content message: an extension page cannot send it', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'panel/open' }, pageSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([]);
  });

  it('keeps the toolbar button opening the panel', async () => {
    const worker = await startTestWorker();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(worker.fakes.sidePanelCalls).toContainEqual({ method: 'setPanelBehavior', args: { openPanelOnActionClick: true } });
  });
});
