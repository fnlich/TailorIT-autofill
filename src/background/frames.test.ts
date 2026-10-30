import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { RawSender, TabMessage } from '../platform/fake';
import { FRAME_PROBE_GRACE_MS, FRAME_PROBE_TIMEOUT_MS } from './frames';
import {
  beginRun,
  contentSender,
  fieldSpec,
  frameReport,
  NO_RECEIVER,
  pageSender,
  startTestWorker,
  tokenRecord,
  typeOfSent,
  type TestWorker,
} from './worker.testkit';

const GH_EMBED = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1';
const GH_KEY = 'greenhouse:0123456789abcdef';
const top = (documentId: string) => contentSender({ frameId: 0, documentId });
const embed = (frameId: number, documentId: string) => contentSender({ frameId, documentId, url: GH_EMBED });

/** A tab whose frames answer frame/ping unless their document is in `gone`, as Chrome does for a replaced page. */
async function tab() {
  const worker = await startTestWorker({ token: tokenRecord() });
  const gone = new Set<string>();
  worker.fakes.frameAnswers = ({ options }) => {
    if (options?.documentId !== undefined && gone.has(options.documentId)) throw new Error(NO_RECEIVER);
    return { ok: true, data: { pong: true } };
  };
  return { worker, gone };
}

const hello = (worker: TestWorker, sender: RawSender) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true }, sender);

/** Begins a run in the frame and puts its report. */
async function reportFrom(worker: TestWorker, sender: RawSender) {
  const applicationKey = sender.url === GH_EMBED ? GH_KEY : undefined;
  const runId = await beginRun(worker, applicationKey ? { applicationKey } : {}, sender);
  const report = frameReport(runId, sender.frameId!, sender.url === GH_EMBED ? { platform: 'greenhouse', adapter: 'greenhouse' } : {});
  expect(await worker.deliver({ v: 1, type: 'report/put', runId, report }, sender)).toEqual({ ok: true, data: {} });
  return runId;
}

/** The tab's registered frames, as "frameId:documentId". */
async function registered(): Promise<string[]> {
  const stored = await fakeBrowser.storage.session.get(null);
  return Object.entries(stored).filter(([key]) => key.startsWith('frames:7:'))
    .map(([, entry]) => `${(entry as { frameId: number }).frameId}:${(entry as { documentId: string }).documentId}`).sort();
}

/** The frames of the tab that have a report. */
async function reported(): Promise<number[]> {
  const stored = await fakeBrowser.storage.session.get(null);
  return Object.keys(stored).filter((key) => key.startsWith('report:7:')).map((key) => Number(key.split(':')[2])).sort();
}

const pings = (worker: TestWorker): TabMessage[] => worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'frame/ping');

/** Lets the sweeps' grace pass, as often as needed, until `check` holds. */
async function afterGrace(worker: TestWorker, check: () => Promise<void>) {
  await vi.waitFor(async () => {
    worker.timers.advance(FRAME_PROBE_GRACE_MS);
    await check();
  });
}

describe('frames of a page that is gone', () => {
  it('go when the top frame loads another document: entry, report and runs', async () => {
    const { worker, gone } = await tab();
    await hello(worker, top('doc-1'));
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, top('doc-1'));
    const embedRun = await reportFrom(worker, embed(3, 'doc-3'));
    const panel = worker.connect('panel', pageSender());
    panel.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await vi.waitFor(() => expect(panel.received).toHaveLength(1));

    // The top frame loads another page: its old document and the embed inside it are gone.
    gone.add('doc-1').add('doc-3');
    const answer = await hello(worker, top('doc-2'));
    expect(answer).toMatchObject({ ok: true, data: { frameId: 0 } });
    // The top frame's own old report went at once; the embed's goes once its document has been asked twice.
    expect(await reported()).toEqual([3]);
    await afterGrace(worker, async () => expect(await registered()).toEqual(['0:doc-2']));
    expect(await reported()).toEqual([]);
    // Asked at its own frame and document, at least twice (the panel's watch asked too).
    const asked = pings(worker).filter((sent) => sent.options?.documentId === 'doc-3');
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(asked).toEqual(Array(asked.length).fill({ tabId: 7, message: { v: 1, type: 'frame/ping' },
      options: { frameId: 3, documentId: 'doc-3' } }));
    // Its run went with it.
    expect(await worker.deliver({ v: 1, type: 'plan/request', runId: embedRun, pass: 0, specs: [fieldSpec(1)], canaries: [], notices: [] },
      embed(3, 'doc-3'))).toEqual({ ok: false, error: 'expired' });
    // The side panel was told.
    await vi.waitFor(() => expect((panel.received.at(-1) as { reports: unknown[] }).reports).toEqual([]));
  });

  it('keeps a subframe of the new page that said hello, and reported, before its top frame did', async () => {
    const { worker, gone } = await tab();
    await hello(worker, top('doc-1'));
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, embed(3, 'doc-3'));

    gone.add('doc-1').add('doc-3');
    // The new page's embed is first: its hello sets off a sweep of the old top frame and the old embed...
    await hello(worker, embed(4, 'doc-4'));
    await reportFrom(worker, embed(4, 'doc-4'));
    // ...and the new top frame says hello before that sweep's grace is over.
    await hello(worker, top('doc-2'));
    await afterGrace(worker, async () => expect(await registered()).toEqual(['0:doc-2', '4:doc-4']));
    expect(await reported()).toEqual([4]);
    // The new top frame stayed although the first sweep had found its old document gone.
    expect(pings(worker).some((sent) => sent.options?.frameId === 0 && sent.options.documentId === 'doc-1')).toBe(true);
  });

  it('drops nothing when the top frame says hello again from the same document', async () => {
    const { worker, gone } = await tab();
    await hello(worker, top('doc-1'));
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, top('doc-1'));
    await reportFrom(worker, embed(3, 'doc-3'));
    const before = pings(worker).length;

    // Even a frame that would not answer is never asked: a same-document navigation (an app's route change) is not
    // a new page.
    gone.add('doc-3');
    await hello(worker, top('doc-1'));
    worker.timers.advance(FRAME_PROBE_GRACE_MS * 3);
    await new Promise((resolve) => setImmediate(resolve));
    expect(pings(worker)).toHaveLength(before);
    expect(await registered()).toEqual(['0:doc-1', '3:doc-3']);
    expect(await reported()).toEqual([0, 3]);
  });

  it('keeps a frame whose listener was a moment late: it answers when asked again', async () => {
    const { worker, gone } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    gone.add('doc-3');
    await hello(worker, top('doc-1'));
    await vi.waitFor(() => expect(pings(worker)).toHaveLength(1));
    gone.delete('doc-3');
    worker.timers.advance(FRAME_PROBE_GRACE_MS);
    await vi.waitFor(() => expect(pings(worker)).toHaveLength(2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(await registered()).toEqual(['0:doc-1', '3:doc-3']);
  });

  it('keeps a frame that got the probe and gave no answer, or none in time, and still lets a gone one go', async () => {
    const { worker } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    await hello(worker, embed(5, 'doc-5'));
    await hello(worker, embed(8, 'doc-8'));
    await new Promise((resolve) => setImmediate(resolve));
    worker.fakes.frameAnswers = ({ options }) => {
      if (options?.frameId === 3) throw new Error(NO_RECEIVER);
      if (options?.frameId === 8) throw new Error('The message port closed before a response was received.');
      return new Promise(() => undefined);
    };
    await hello(worker, top('doc-1'));
    // Frame 5 never answers: its probe gives up after FRAME_PROBE_TIMEOUT_MS, and the sweep goes on without it.
    await afterGrace(worker, async () => expect(await registered()).toEqual(['0:doc-1', '5:doc-5', '8:doc-8']));
    expect(FRAME_PROBE_TIMEOUT_MS).toBeGreaterThan(FRAME_PROBE_GRACE_MS);
  });

  // W1: forgetting a frame's gone document took every run and report of that frame, the live document's included.
  it('keeps what a document restored from the back/forward cache began when a sweep forgets the one it replaced', async () => {
    const { worker, gone } = await tab();
    await hello(worker, top('doc-1'));
    await hello(worker, top('doc-2'));
    // Back: doc-1 comes out of the back/forward cache without a hello, so the registry still holds doc-2, and it fills.
    const runId = await reportFrom(worker, top('doc-1'));
    gone.add('doc-2');
    // A panel reads the tab: the check asks doc-2, which is gone, and forgets it...
    await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender());
    await afterGrace(worker, async () => expect(await registered()).toEqual([]));
    // ...but not doc-1's report or run.
    expect(await reported()).toEqual([0]);
    expect(await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], canaries: [], notices: [] },
      top('doc-1'))).toMatchObject({ ok: true });
  });

  it('forgets, at a hello from another document, only the document the frame left', async () => {
    const { worker } = await tab();
    await hello(worker, top('doc-1'));
    await hello(worker, top('doc-2'));
    await reportFrom(worker, top('doc-2'));
    // Back to doc-1, out of the back/forward cache: it begins a run before its hello reaches the worker.
    const runId = await beginRun(worker, {}, top('doc-1'));
    await hello(worker, top('doc-1'));
    expect(await registered()).toEqual(['0:doc-1']);
    // doc-2's report went (its run was replaced by doc-1's); doc-1's run stayed.
    expect(await reported()).toEqual([]);
    expect(await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], canaries: [], notices: [] },
      top('doc-1'))).toMatchObject({ ok: true });
    const report = frameReport(runId);
    expect(await worker.deliver({ v: 1, type: 'report/put', runId, report }, top('doc-1'))).toEqual({ ok: true, data: {} });
    // And a hello from doc-2 again (forward) takes doc-1's report and run with it.
    await hello(worker, top('doc-2'));
    expect(await reported()).toEqual([]);
    expect(await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [] }, top('doc-1'))).toEqual({ ok: false, error: 'expired' });
  });

  it('lets an old embed go when a new embed says hello in a tab whose top page has no content script', async () => {
    const { worker, gone } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, embed(3, 'doc-3'));
    // The person opens another company's job page in the same tab: only its embed says hello.
    gone.add('doc-3');
    await hello(worker, embed(6, 'doc-6'));
    await afterGrace(worker, async () => expect(await registered()).toEqual(['6:doc-6']));
    expect(await reported()).toEqual([]);
  });
});

describe('a panel that reads or follows a tab', () => {
  type Reports = { ok: true; data: { tabId: number; reports: Array<{ frameId: number }> } };
  const readReports = async (worker: TestWorker) =>
    ((await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())) as Reports).data.reports.map((r) => r.frameId);

  it('shows nothing of an embed whose page is gone: panel/reports answers at once, then the check prunes it', async () => {
    const { worker, gone } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, embed(3, 'doc-3'));
    // The company page goes to a page that holds none of our frames: nothing says hello.
    gone.add('doc-3');
    // The answer is prompt, from what is known; the check it set off asks the embed's document.
    expect(await readReports(worker)).toEqual([3]);
    await vi.waitFor(() => expect(pings(worker).some((sent) => sent.options?.documentId === 'doc-3')).toBe(true));
    await afterGrace(worker, async () => expect(await registered()).toEqual([]));
    expect(await readReports(worker)).toEqual([]);
    expect(await reported()).toEqual([]);
  });

  it('shows nothing of it on the panel port either: the watch\'s check pushes the pruned state', async () => {
    const { worker, gone } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, embed(3, 'doc-3'));
    gone.add('doc-3');
    const port = worker.connect('panel', pageSender());
    port.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await vi.waitFor(() => expect(port.received).toHaveLength(1));
    await afterGrace(worker, async () => expect(port.received.at(-1)).toEqual({ v: 1, type: 'panel/update', tabId: 7, reports: [] }));
    expect(await registered()).toEqual([]);
  });

  it('keeps a frame that answers', async () => {
    const { worker } = await tab();
    await hello(worker, embed(3, 'doc-3'));
    await reportFrom(worker, embed(3, 'doc-3'));
    await new Promise((resolve) => setImmediate(resolve));
    const before = pings(worker).length;
    expect(await readReports(worker)).toEqual([3]);
    expect(await readReports(worker)).toEqual([3]);
    await vi.waitFor(() => expect(pings(worker).length).toBeGreaterThan(before));
    worker.timers.advance(FRAME_PROBE_GRACE_MS * 2);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await registered()).toEqual(['3:doc-3']);
    expect(await reported()).toEqual([3]);
  });
});
