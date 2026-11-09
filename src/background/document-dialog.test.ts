/*
 * v1.5 X (PLAN decisions 2 and 3): the worker's side of the documents' dialogs over the page (document-dialog.ts,
 * index.ts openDocument): Preview asks the tab's top frame to show the dialog, with a grant, the dialog's tabs and the
 * resume's file name, and falls back to the full-window preview page (at the extension's own address) when no frame
 * of ours answers, it refuses or says nothing in time; the preview page embedded in that dialog (a framed extension
 * page) receives its own tab's documents only with a live grant naming them, and sends no message; the dialog's "Open
 * In A New Tab" works only while its grant stands, from the top frame; Edit of a built resume opens TailorIT's editor,
 * of an upload its editable copy (`/resumes/<id>/edit`) after the confirm, over the page (its Continue naming its
 * grant, once) or the panel's own, unless "Don't show this again" (settings version 10) was chosen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { RawSender } from '../platform/fake';
import { DIALOG_ASK_MS, EDIT_GRANT_TTL_MS, PREVIEW_GRANT_TTL_MS } from './document-dialog';
import {
  contentSender, EXTENSION_ID, goldens, NO_RECEIVER, ORIGIN, pageSender, sentToFrames, startTestWorker, tokenRecord,
  typeOfSent, type TestWorker,
} from './worker.testkit';

type Answer = { ok: boolean; data?: Record<string, unknown>; error?: string };
const RESUME = goldens.resumes.items[0]!;
const UPLOAD = goldens.resumes.items[1]!;

/** A connected worker whose tab 7 shows a Lever form in its top frame, which answers the dialogs' messages `shown`. */
async function withForm(shown: boolean | 'throws' | 'silent' = true): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    if (message.type === 'preview/show' || message.type === 'edit/confirm') {
      if (shown === 'throws') throw new Error(NO_RECEIVER);
      if (shown === 'silent') return new Promise(() => undefined);
      return { ok: true, data: { shown } };
    }
    return { ok: true, data: {} };
  };
  await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender());
  return worker;
}

const open = (worker: TestWorker, message: Record<string, unknown>, sender: RawSender = pageSender()) =>
  worker.deliver({ v: 1, type: 'panel/openDocument', tabId: 7, ...message }, sender) as Promise<Answer>;
const tabs = async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url);
const dialogsSent = (worker: TestWorker, type: string) => sentToFrames(worker)
  .filter((sent) => typeOfSent(sent) === type);
/** The grant the worker gave the last dialog of `type`. */
const grantOf = (worker: TestWorker, type = 'preview/show') =>
  (dialogsSent(worker, type).at(-1)?.message as { grant: string }).grant;
/** The preview page embedded in tab 7's dialog: a framed extension page. */
const framed = (overrides: Partial<RawSender> = {}): RawSender => ({ id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/preview.html?tabId=7&kind=resume`, tab: { id: 7 }, frameId: 5,
  documentId: 'doc-preview', documentLifecycle: 'active', ...overrides });
/** Asks for a document over a preview port opened by `sender`; its first answer. */
async function ask(worker: TestWorker, sender: RawSender, request: Record<string, unknown>): Promise<unknown> {
  const port = worker.connect('preview', sender);
  port.post({ v: 1, type: 'preview/request', tabId: 7, ...request });
  await vi.waitFor(() => expect(port.received.length + (port.disconnectedByWorker ? 1 : 0)).toBeGreaterThan(0));
  return port.received[0] ?? 'disconnected';
}
const settle = async () => {
  for (let step = 0; step < 10; step += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('Preview over the page (v1.5 X, PLAN decision 2)', () => {
  it('asks the tab’s top frame to show the dialog, with a fresh grant, its tabs, the resume’s file name and the preview page’s address, and opens no tab', async () => {
    const worker = await withForm();
    const before = await tabs();
    expect(await open(worker, { kind: 'resume', how: 'preview', kinds: ['resume', 'coverLetter'] }))
      .toEqual({ ok: true, data: { opened: true, onPage: true } });
    const [sent] = dialogsSent(worker, 'preview/show');
    expect(sent?.tabId).toBe(7);
    expect(sent?.options).toEqual({ frameId: 0 });
    expect(sent?.message).toEqual({ v: 1, type: 'preview/show', tabId: 7, kind: 'resume', kinds: ['resume', 'coverLetter'],
      grant: expect.stringMatching(/^[0-9a-f]{32}$/), names: { resume: RESUME.fileName },
      page: `chrome-extension://${EXTENSION_ID}/preview.html` });
    expect(await tabs()).toEqual(before);
    // A new Preview, a new grant: the one before stands no more.
    const first = grantOf(worker);
    await open(worker, { kind: 'coverLetter', how: 'preview' });
    expect(grantOf(worker)).not.toBe(first);
    expect(dialogsSent(worker, 'preview/show').at(-1)?.message).toMatchObject({ kind: 'coverLetter', kinds: ['coverLetter'],
      names: {} });
    expect(await ask(worker, framed(), { grant: first })).toEqual({ v: 1, type: 'resume/error',
      reason: 'resume-unavailable' });
  });

  it('falls back to the full-window preview page, at the extension’s own address, where the page shows no dialog: no frame of ours, a refusal, no answer in time', async () => {
    for (const shown of ['throws', false, 'silent'] as const) {
      const worker = await withForm(shown);
      const answer = open(worker, { kind: 'coverLetter', how: 'preview', kinds: ['resume', 'coverLetter'] });
      if (shown === 'silent') {
        await settle();
        worker.timers.advance(DIALOG_ASK_MS);
      }
      expect(await answer, String(shown)).toEqual({ ok: true, data: { opened: true } });
      expect((await tabs()).at(-1), String(shown))
        .toBe(`chrome-extension://${EXTENSION_ID}/preview.html?tabId=7&kind=coverLetter`);
      // The grant went with the dialog that never showed.
      expect(await ask(worker, framed(), { grant: grantOf(worker) })).toEqual({ v: 1, type: 'resume/error',
        reason: 'resume-unavailable' });
    }
  });

  it('serves the embedded preview page its own tab’s documents with the dialog’s grant alone', async () => {
    const worker = await withForm();
    await open(worker, { kind: 'resume', how: 'preview', kinds: ['resume'] });
    const grant = grantOf(worker);
    // The grant: the resume's transfer starts.
    expect(await ask(worker, framed(), { grant })).toMatchObject({ type: 'resume/header', mime: 'application/pdf' });
    // No grant, another one, another tab, a document the grant does not name: nothing.
    const refused = { v: 1, type: 'resume/error', reason: 'resume-unavailable' };
    expect(await ask(worker, framed(), {})).toEqual(refused);
    expect(await ask(worker, framed(), { grant: 'f'.repeat(32) })).toEqual(refused);
    expect(await ask(worker, framed({ tab: { id: 9 } }), { grant })).toEqual(refused);
    expect(await ask(worker, framed(), { grant, tabId: 9 })).toEqual(refused);
    expect(await ask(worker, framed(), { grant, kind: 'coverLetter' })).toEqual(refused);
    // Past its time.
    worker.clock.now += PREVIEW_GRANT_TTL_MS;
    expect(await ask(worker, framed(), { grant })).toEqual(refused);
  });

  it('takes no message from a framed extension page, and no preview port without a grant, while the same page in a tab of its own is served as before', async () => {
    const worker = await withForm();
    for (const message of [{ v: 1, type: 'settings/get' }, { v: 1, type: 'auth/status' },
      { v: 1, type: 'panel/openDocument', tabId: 7, kind: 'resume', how: 'preview' }]) {
      expect(await worker.deliver(message, framed())).toEqual({ ok: false, error: 'bad_sender' });
    }
    const panel = worker.connect('panel', framed());
    expect(panel.disconnectedByWorker).toBe(true);
    // The full-window page (frame 0 of its own tab) needs no grant.
    expect(await ask(worker, framed({ frameId: 0, tab: { id: 12 } }), {})).toMatchObject({ type: 'resume/header' });
  });

  it('opens the full-window page from the dialog’s Open In A New Tab while its grant stands, from the tab’s top frame alone', async () => {
    const worker = await withForm();
    const openTab = (kind: string, sender = contentSender()) =>
      worker.deliver({ v: 1, type: 'preview/openTab', kind }, sender) as Promise<Answer>;
    // No dialog yet.
    expect(await openTab('resume')).toEqual({ ok: false, error: 'bad_sender' });
    await open(worker, { kind: 'resume', how: 'preview', kinds: ['resume'] });
    expect(await openTab('coverLetter')).toEqual({ ok: false, error: 'bad_sender' });
    expect(await openTab('resume', contentSender({ frameId: 2, documentId: 'doc-2' })))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await openTab('resume')).toEqual({ ok: true, data: {} });
    expect((await tabs()).at(-1)).toBe(`chrome-extension://${EXTENSION_ID}/preview.html?tabId=7&kind=resume`);
    // An extension page cannot send it (a content script's message).
    expect(await worker.deliver({ v: 1, type: 'preview/openTab', kind: 'resume' }, pageSender()))
      .toEqual({ ok: false, error: 'bad_sender' });
  });

  it('refuses a Preview whose tabs leave out the document it shows, or that is confirmed', async () => {
    const worker = await withForm();
    expect(await open(worker, { kind: 'resume', how: 'preview', kinds: ['coverLetter'] }))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await open(worker, { kind: 'resume', how: 'preview', confirmed: true }))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(dialogsSent(worker, 'preview/show')).toEqual([]);
  });
});

describe('Edit (v1.5 X, PLAN decision 3)', () => {
  const chooseUpload = (worker: TestWorker) => worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7,
    resumeId: UPLOAD.id }, pageSender());
  const confirmed = (worker: TestWorker, grant: string, skip = false, sender = contentSender()) =>
    worker.deliver({ v: 1, type: 'edit/confirmed', grant, skip }, sender) as Promise<Answer>;

  it('opens a built resume in TailorIT’s editor at once, with no confirm', async () => {
    const worker = await withForm();
    expect(await open(worker, { kind: 'resume', how: 'edit' })).toEqual({ ok: true, data: { opened: true } });
    expect((await tabs()).at(-1)).toBe(`${ORIGIN}/resumes/${RESUME.id}`);
    expect(dialogsSent(worker, 'edit/confirm')).toEqual([]);
  });

  it('confirms an upload over the page first; its Continue opens the editable copy once, the id never sent to the page', async () => {
    const worker = await withForm();
    await chooseUpload(worker);
    const before = await tabs();
    expect(await open(worker, { kind: 'resume', how: 'edit' })).toEqual({ ok: true, data: { opened: false, confirm: 'page' } });
    expect(await tabs()).toEqual(before);
    const [sent] = dialogsSent(worker, 'edit/confirm');
    expect(sent?.options).toEqual({ frameId: 0 });
    expect(sent?.message).toEqual({ v: 1, type: 'edit/confirm', grant: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(JSON.stringify(sentToFrames(worker))).not.toContain(UPLOAD.id);
    const grant = grantOf(worker, 'edit/confirm');
    // Not from a subframe, nor with another grant.
    expect(await confirmed(worker, grant, false, contentSender({ frameId: 2, documentId: 'doc-2' })))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await confirmed(worker, 'e'.repeat(32))).toEqual({ ok: false, error: 'expired' });
    expect(await confirmed(worker, grant)).toEqual({ ok: true, data: {} });
    expect((await tabs()).at(-1)).toBe(`${ORIGIN}/resumes/${UPLOAD.id}/edit`);
    // Once.
    expect(await confirmed(worker, grant)).toEqual({ ok: false, error: 'expired' });
    // The setting stays as it was: the confirm shows again.
    expect(await open(worker, { kind: 'resume', how: 'edit' })).toEqual({ ok: true, data: { opened: false, confirm: 'page' } });
    // A grant past its time opens nothing.
    worker.clock.now += EDIT_GRANT_TTL_MS;
    expect(await confirmed(worker, grantOf(worker, 'edit/confirm'))).toEqual({ ok: false, error: 'expired' });
  });

  it('keeps "Don’t show this again" (settings version 10), and opens the editable copy at once from then on', async () => {
    const worker = await withForm();
    await chooseUpload(worker);
    await open(worker, { kind: 'resume', how: 'edit' });
    expect(await confirmed(worker, grantOf(worker, 'edit/confirm'), true)).toEqual({ ok: true, data: {} });
    expect((await worker.deliver({ v: 1, type: 'settings/get' }, pageSender())) as Answer).toMatchObject({ ok: true,
      data: { settings: { version: 10, ui: { skipUploadEditConfirm: true } } } });
    expect(await open(worker, { kind: 'resume', how: 'edit' })).toEqual({ ok: true, data: { opened: true } });
    expect((await tabs()).at(-1)).toBe(`${ORIGIN}/resumes/${UPLOAD.id}/edit`);
    expect(dialogsSent(worker, 'edit/confirm')).toHaveLength(1);
  });

  it('leaves the confirm to the panel where the page shows none, and its Continue (with Don’t show this again) opens the copy', async () => {
    for (const shown of ['throws', false] as const) {
      const worker = await withForm(shown);
      await chooseUpload(worker);
      expect(await open(worker, { kind: 'resume', how: 'edit' }), String(shown))
        .toEqual({ ok: true, data: { opened: false, confirm: 'panel' } });
      expect(await open(worker, { kind: 'resume', how: 'edit', confirmed: true, skipConfirm: shown === false }))
        .toEqual({ ok: true, data: { opened: true } });
      expect((await tabs()).at(-1)).toBe(`${ORIGIN}/resumes/${UPLOAD.id}/edit`);
      expect(((await worker.deliver({ v: 1, type: 'settings/get' }, pageSender())) as { data: { settings: {
        ui: { skipUploadEditConfirm: boolean } } } }).data.settings.ui.skipUploadEditConfirm).toBe(shown === false);
    }
  });

  it('refuses an Edit while not connected, and a Continue after the connection went', async () => {
    const worker = await withForm();
    await chooseUpload(worker);
    await open(worker, { kind: 'resume', how: 'edit' });
    const grant = grantOf(worker, 'edit/confirm');
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    expect(await confirmed(worker, grant)).toEqual({ ok: false, error: 'not_connected' });
    expect(await open(worker, { kind: 'resume', how: 'edit' })).toEqual({ ok: false, error: 'not_connected' });
  });
});
