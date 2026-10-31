import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent } from './worker.testkit';

const OPTIONS = pageSender('options.html');
const CHOSEN = { ...DEFAULT_SETTINGS, panel: 'in-page' as const, autoAdvance: true, preapprovedConsent: ['privacy' as const],
  llm: { tiebreak: false, classify: true, drafts: true } };

describe('settings', () => {
  it('answers the cautious defaults until something is saved', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS } });
  });

  it('saves to storage.local and answers what it stored', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS)).toEqual({ ok: true, data: { settings: CHOSEN } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': CHOSEN });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: CHOSEN } });
  });

  it('refuses settings that do not parse, and keeps what was stored', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS);
    for (const settings of [
      { ...CHOSEN, panel: 'floating' },
      { ...CHOSEN, preapprovedConsent: ['i-did-not-use-ai'] },
      { ...CHOSEN, extra: true },
      { ...CHOSEN, version: 2 },
    ]) {
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings }, OPTIONS)).toEqual({ ok: false, error: 'bad_message' });
    }
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': CHOSEN });
  });

  it('reads stored settings that no longer parse as the defaults', async () => {
    const worker = await startTestWorker({
      before: async () => fakeBrowser.storage.local.set({ 'settings:v1': { version: 1, panel: 'sideways' } }),
    });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS } });
  });

  it('reach every frame with a form once saved, as its content settings, so a run reads auto-advance afresh (the Phase 5 review, C-S2)', async () => {
    const worker = await startTestWorker();
    const other = contentSender({ tab: { id: 8 }, frameId: 3, documentId: 'doc-3' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true }, other);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false },
      contentSender({ frameId: 5, documentId: 'doc-5' }));
    // One frame is gone: the save is answered all the same.
    worker.fakes.frameAnswers = ({ options }) => {
      if (options?.frameId === 3) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, data: {} };
    };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS))
      .toEqual({ ok: true, data: { settings: CHOSEN } });
    const pushed = sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'settings/changed')
      .sort((a, b) => a.tabId - b.tabId);
    const message = { v: 1, type: 'settings/changed', settings: { panel: 'in-page', autoAdvance: true, llm: CHOSEN.llm } };
    expect(pushed).toEqual([
      { tabId: 7, message, options: { frameId: 0, documentId: 'doc-1' } },
      { tabId: 8, message, options: { frameId: 3, documentId: 'doc-3' } },
    ]);
    // A save that does not parse tells no frame anything.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, panel: 'floating' } }, OPTIONS);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'settings/changed')).toHaveLength(2);
  });

  it('are read and written by extension pages only', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('reach a frame only as its content settings, with frame/hello\'s connection state', async () => {
    const offline = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': CHOSEN }) });
    expect(await offline.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender())).toEqual({
      ok: true,
      data: { frameId: 0, connected: false, settings: { panel: 'in-page', autoAdvance: true, llm: CHOSEN.llm } },
    });
    const connected = await startTestWorker({ token: tokenRecord() });
    expect(await connected.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false }, contentSender({ frameId: 2 })))
      .toMatchObject({ ok: true, data: { frameId: 2, connected: true } });
    // frame/hello reads no profile and asks TailorIT nothing.
    expect(connected.tailorit.requests).toHaveLength(0);
  });
});
