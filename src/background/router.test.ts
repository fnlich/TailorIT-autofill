import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installHandFakes } from '../platform/fake';
import { startWorker } from './index';
import { contentSender, fakeCore, pageSender, startTestWorker } from './worker.testkit';

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
