import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installHandFakes, type HandFakes } from '../platform/fake';
import { startWorker } from './index';

const ID = 'test-extension-id';
const LEVER = 'https://jobs.lever.co/tailorit-fixture/0000/apply';

/** Delivers a message to the worker's listener as Chrome would, with an explicit sender (the fake's own sendMessage
 *  sends an empty one, which every sender check refuses). */
async function deliver(message: unknown, sender: Record<string, unknown>): Promise<unknown> {
  const sendResponse = vi.fn();
  await fakeBrowser.runtime.onMessage.trigger(message, sender as never, sendResponse);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  return sendResponse.mock.calls[0]![0];
}

const contentSender = { id: ID, url: LEVER, tab: { id: 7 }, frameId: 0, documentId: 'doc-1', documentLifecycle: 'active' };

describe('the worker router', () => {
  let fakes: HandFakes;

  beforeEach(() => {
    fakeBrowser.reset();
    fakes = installHandFakes();
  });

  it('answers ping from a content script on an ATS page', async () => {
    startWorker();
    expect(await deliver({ v: 1, type: 'ping' }, contentSender)).toEqual({ ok: true, data: { pong: true } });
  });

  it('refuses a sender that is not this extension', async () => {
    startWorker();
    expect(await deliver({ v: 1, type: 'ping' }, { ...contentSender, id: 'someone-else' })).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('refuses a content message from a page that is not an ATS host', async () => {
    startWorker();
    expect(await deliver({ v: 1, type: 'ping' }, { ...contentSender, url: 'https://example.com/' })).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('refuses a malformed message and an unknown field', async () => {
    startWorker();
    expect(await deliver({ v: 1, type: 'frame/hello', isTop: 'yes' }, contentSender)).toEqual({ ok: false, error: 'bad_message' });
    expect(await deliver({ v: 1, type: 'ping', extra: true }, contentSender)).toEqual({ ok: false, error: 'bad_message' });
    expect(await deliver('ping', contentSender)).toEqual({ ok: false, error: 'bad_message' });
  });

  it('refuses a page-channel message sent from a content script', async () => {
    startWorker();
    expect(await deliver({ v: 1, type: 'settings/get' }, contentSender)).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('answers not_implemented for a known message whose handler arrives in a later phase', async () => {
    startWorker();
    const answer = await deliver({ v: 1, type: 'run/begin', applicationKey: 'lever:0123456789abcdef', trigger: 'launcher', dryRun: false }, contentSender);
    expect(answer).toEqual({ ok: false, error: 'not_implemented' });
  });

  it('registers a frame by its origin and platform, never its full address', async () => {
    startWorker();
    const answer = await deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender);
    expect(answer).toMatchObject({ ok: true, data: { frameId: 0, connected: false } });
    const stored = await fakeBrowser.storage.session.get(null);
    expect(stored['frames:7:0']).toMatchObject({ origin: 'https://jobs.lever.co', platform: 'lever', isTop: true, hasForm: true });
    expect(JSON.stringify(stored)).not.toContain('/apply');
  });

  it('keeps storage.local away from content scripts, and records when Chrome refuses', async () => {
    const state = startWorker();
    await vi.waitFor(() => expect(state.storageAccess).toBe('restricted'));
    expect(fakes.accessLevels.local).toBe('TRUSTED_CONTEXTS');

    fakeBrowser.reset();
    fakes = installHandFakes();
    fakes.refuseAccessLevel(true);
    const refused = startWorker();
    await vi.waitFor(() => expect(refused.storageAccess).toBe('refused'));
  });
});
