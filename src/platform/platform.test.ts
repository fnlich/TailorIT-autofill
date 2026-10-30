import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createPagePlatform, createWorkerPlatform } from './chrome';
import { installHandFakes, type HandFakes } from './fake';
import { createMemoryContentPlatform, createMemorySecrets, memoryPortPair } from './memory';
import type { PortLike } from './types';

describe('the worker platform over the browser', () => {
  let fakes: HandFakes;
  beforeEach(() => {
    fakeBrowser.reset();
    fakes = installHandFakes();
  });

  it('sends to one frame, naming its document only when it has one', async () => {
    const platform = createWorkerPlatform();
    fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await platform.tabs.sendToFrame(7, { v: 1, type: 'run/cancel' }, { frameId: 2, documentId: 'doc' })).toEqual({ ok: true, data: {} });
    await platform.tabs.sendToFrame(7, { v: 1, type: 'run/cancel' }, { frameId: 0 });
    expect(fakes.tabMessages.map((sent) => sent.options)).toEqual([{ frameId: 2, documentId: 'doc' }, { frameId: 0 }]);
  });

  it.each([
    ['Could not establish connection. Receiving end does not exist.', 'gone'],
    ['No frame with id 4 in tab 7.', 'gone'],
    ['No tab with id: 7.', 'gone'],
    ['Invalid document id', 'gone'],
    ['The message port closed before a response was received.', 'unanswered'],
    ['A listener indicated an asynchronous response by returning true, but the message channel closed', 'unanswered'],
  ])('sorts a failed send to a frame: "%s" is %s', async (sentence, failure) => {
    const platform = createWorkerPlatform();
    fakes.frameAnswers = () => {
      throw new Error(sentence);
    };
    await expect(platform.tabs.sendToFrame(7, { v: 1, type: 'frame/ping' }, { frameId: 4, documentId: 'd' })).rejects.toBe(failure);
  });

  it('names the client from the browser\'s brands and platform', async () => {
    const platform = createWorkerPlatform();
    expect(await platform.runtime.clientInfo()).toEqual({ browser: 'other', os: 'windows' });
    vi.stubGlobal('navigator', { userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] } });
    expect((await platform.runtime.clientInfo()).browser).toBe('edge');
    vi.stubGlobal('navigator', { userAgentData: { brands: [{ brand: 'Google Chrome' }] } });
    expect((await platform.runtime.clientInfo()).browser).toBe('chrome');
    vi.unstubAllGlobals();
    (fakeBrowser.runtime as unknown as Record<string, unknown>).getPlatformInfo = async () => { throw new Error('no'); };
    expect(await platform.runtime.clientInfo()).toEqual({ browser: 'other', os: 'other' });
  });

  it('hashes with crypto.subtle, in lower-case hex', async () => {
    const platform = createWorkerPlatform();
    expect(await platform.sha256(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('times requests out with AbortSignal.timeout', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    createWorkerPlatform().timeout(25_000);
    expect(timeout).toHaveBeenCalledWith(25_000);
    timeout.mockRestore();
  });

  it('hands a port the worker accepts its sender', async () => {
    const platform = createWorkerPlatform();
    const accepted: PortLike[] = [];
    platform.runtime.onConnect((port) => accepted.push(port));
    const peer = fakes.connect('resume', { id: 'x', url: 'https://jobs.lever.co/a', tab: { id: 4 }, frameId: 1, documentId: 'd' });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.name).toBe('resume');
    expect(accepted[0]!.sender).toMatchObject({ id: 'x', tabId: 4, frameId: 1, documentId: 'd' });
    const seen: unknown[] = [];
    accepted[0]!.onMessage((message) => seen.push(message));
    peer.post({ v: 1, type: 'resume/request', runId: 'r' });
    await vi.waitFor(() => expect(seen).toEqual([{ v: 1, type: 'resume/request', runId: 'r' }]));
    accepted[0]!.post({ v: 1, type: 'resume/end' });
    await vi.waitFor(() => expect(peer.received).toEqual([{ v: 1, type: 'resume/end' }]));
    accepted[0]!.disconnect();
    expect(peer.disconnectedByWorker).toBe(true);
    expect(() => accepted[0]!.post({})).toThrow(/disconnected/);
  });

  it('follows the active tab for an extension page', async () => {
    const page = createPagePlatform();
    const window = (await fakeBrowser.windows.create({ focused: true }))!;
    const tab = await fakeBrowser.tabs.create({ url: 'https://jobs.lever.co/a', active: true, windowId: window.id });
    expect(await page.activeTabId()).toBe(tab.id);
    const seen: number[] = [];
    const stop = page.onActiveTabChanged((tabId) => seen.push(tabId));
    const other = await fakeBrowser.tabs.create({ url: 'https://jobs.lever.co/b', active: true, windowId: window.id });
    stop();
    await fakeBrowser.tabs.create({ url: 'https://jobs.lever.co/c', active: true, windowId: window.id });
    expect(seen).toEqual([other.id]);
  });
});

describe('the in-memory doubles', () => {
  it('link two port ends: messages arrive copied and asynchronously, a disconnect reaches the other end', async () => {
    const [a, b] = memoryPortPair('resume', { id: 'ext', tabId: 3 });
    const atB: unknown[] = [];
    let closedAtA = false;
    b.onMessage((message) => atB.push(message));
    a.onDisconnect(() => {
      closedAtA = true;
    });
    const message = { v: 1, nested: { n: 1 } };
    a.post(message);
    expect(atB).toEqual([]);
    message.nested.n = 2;
    await vi.waitFor(() => expect(atB).toEqual([{ v: 1, nested: { n: 1 } }]));
    expect(b.sender).toEqual({ id: 'ext', tabId: 3 });
    b.disconnect();
    await vi.waitFor(() => expect(closedAtA).toBe(true));
    expect(() => a.post({})).toThrow(/disconnected/);
  });

  it('hand a content script\'s port to the worker double, or close it when there is none', async () => {
    let workerEnd: PortLike | null = null;
    const platform = createMemoryContentPlatform(async () => ({ ok: true, data: {} }), (port) => {
      workerEnd = port;
    });
    const content = platform.runtime.connect('resume');
    const seen: unknown[] = [];
    workerEnd!.onMessage((message) => seen.push(message));
    content.post({ v: 1, type: 'resume/request', runId: 'r' });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    const lonely = createMemoryContentPlatform(async () => undefined).runtime.connect('resume');
    let closed = false;
    lonely.onDisconnect(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it('keep a copy of the secret, and forget it on clear', async () => {
    const secrets = createMemorySecrets();
    const record = { token: 't' };
    await secrets.set(record);
    record.token = 'changed';
    expect(await secrets.get()).toEqual({ token: 't' });
    await secrets.clear();
    expect(await secrets.get()).toBeUndefined();
  });
});
