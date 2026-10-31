import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installHandFakes } from '../platform/fake';
import { startWorker } from './index';
import { contentSender, fakeCore, fieldSpec, frameReport, LEVER_KEY, pageSender, runState, startTestWorker,
  tokenRecord } from './worker.testkit';

afterEach(() => vi.restoreAllMocks());

describe('the worker router', () => {
  it('answers ping from a content script on an ATS page and from an extension page', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'ping' }, contentSender())).toEqual({ ok: true, data: { pong: true } });
    expect(await worker.deliver({ v: 1, type: 'ping' }, pageSender())).toEqual({ ok: true, data: { pong: true } });
  });

  it('refuses a sender that is not this extension', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'ping' }, contentSender({ id: 'someone-else' }))).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('refuses a content message from a page that is not an ATS host, or from a document that is not active', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'ping' }, contentSender({ url: 'https://example.com/' }))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'ping' }, contentSender({ documentLifecycle: 'prerender' })))
      .toEqual({ ok: false, error: 'bad_sender' });
  });

  it('refuses a malformed message and an unknown field', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: 'yes' }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'ping', extra: true }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver('ping', contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 2, type: 'ping' }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
  });

  it('refuses a known type on the wrong channel', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'runstate/clear', applicationKey: 'lever:0123456789abcdef' }, pageSender()))
      .toEqual({ ok: false, error: 'bad_sender' });
  });

  it('answers not_implemented for a known message whose handler arrives in a later phase', async () => {
    const worker = await startTestWorker();
    const answer = await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: 'k' }, pageSender());
    expect(answer).toEqual({ ok: false, error: 'not_implemented' });
  });

  it('answers internal when a handler fails, and nothing more', async () => {
    const worker = await startTestWorker();
    vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValueOnce(new Error('storage is gone'));
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()))
      .toEqual({ ok: false, error: 'internal' });
  });

  it('registers a frame by its origin and platform, never its full address', async () => {
    const worker = await startTestWorker();
    const answer = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    expect(answer).toMatchObject({ ok: true, data: { frameId: 0, connected: false } });
    const stored = await fakeBrowser.storage.session.get(null);
    expect(stored['frames:7:0']).toMatchObject({ origin: 'https://jobs.lever.co', platform: 'lever', isTop: true, hasForm: true });
    expect(JSON.stringify(stored)).not.toContain('/apply');
  });

  it('keeps storage.local away from content scripts, and records when Chrome refuses', async () => {
    const worker = await startTestWorker();
    expect(worker.state.storageAccess).toBe('restricted');
    expect(worker.fakes.accessLevels.local).toBe('TRUSTED_CONTEXTS');

    const refused = await startTestWorker({ before: (fakes) => fakes.refuseAccessLevel(true) });
    expect(refused.state.storageAccess).toBe('refused');
  });

  // W6: no test held the access level pending (startTestWorker waits for the worker's start-up).
  it('holds every content message but ping and panel/open until Chrome answers the storage access level', async () => {
    let release: () => void = () => undefined;
    const worker = await startTestWorker({ token: tokenRecord(), awaitStartUp: false,
      before: (fakes) => {
        release = fakes.holdAccessLevel();
      } });
    expect(worker.state.storageAccess).toBe('pending');
    const runId = 'A'.repeat(22);
    const messages = [
      { v: 1, type: 'ping' },
      { v: 1, type: 'panel/open' },
      { v: 1, type: 'frame/hello', isTop: true, hasForm: true },
      { v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      { v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], planKeys: [fieldSpec(1).key], canaries: [],
        notices: [] },
      { v: 1, type: 'plan/poll', runId, keys: [] },
      { v: 1, type: 'runstate/get', applicationKey: LEVER_KEY },
      { v: 1, type: 'runstate/put', runState: runState() },
      { v: 1, type: 'runstate/clear', applicationKey: LEVER_KEY },
      { v: 1, type: 'report/put', runId, report: frameReport(runId) },
      { v: 1, type: 'policy/hit', applicationKey: LEVER_KEY, patternId: null },
    ];
    const answered = new Map<string, unknown>();
    for (const message of messages) {
      void worker.deliver(message, contentSender()).then((answer) => answered.set(message.type, answer));
    }

    await vi.waitFor(() => expect([...answered.keys()].sort()).toEqual(['panel/open', 'ping']));
    // Long enough for any handler that did not wait to have answered (each needs a few storage reads).
    for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    expect([...answered.keys()].sort()).toEqual(['panel/open', 'ping']);
    expect(answered.get('ping')).toEqual({ ok: true, data: { pong: true } });
    expect(worker.fakes.sidePanelCalls.map((call) => call.method)).toEqual(['open']);
    expect(Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith('frames:'))).toEqual([]);

    release();
    await vi.waitFor(() => expect(answered.size).toBe(messages.length));
    expect(worker.state.storageAccess).toBe('restricted');
    expect(answered.get('frame/hello')).toMatchObject({ ok: true, data: { frameId: 0 } });
    expect(answered.get('run/begin')).toMatchObject({ ok: true });
  });

  it('starts over the real platform, with every listener registered before anything is awaited', () => {
    fakeBrowser.reset();
    installHandFakes();
    const state = startWorker({ core: fakeCore() });
    expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(true);
    expect(fakeBrowser.runtime.onInstalled.hasListeners()).toBe(true);
    expect(fakeBrowser.tabs.onRemoved.hasListeners()).toBe(true);
    expect(state.storageAccess).toBe('pending');
  });
});
