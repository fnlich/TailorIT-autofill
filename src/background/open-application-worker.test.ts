/*
 * v5 p2-fill (PLAN Phase 2, Jobright's "Open Application"), the worker's side:
 * - PageState.entry: a posting with no form whose site offers its own Apply, as the tab's application frame says it
 *   (frame/wall {entry}), kept while that document says hello again, gone with it, and never beside a wall or a choice;
 * - the panel's Open Application (a plain panel/fill) reaches that frame alone (run/start: it presses the Apply), and the
 *   tab's next form, of the same site and application, is started once it says hello.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent } from './worker.testkit';

const OPTIONS = pageSender('options.html');
const PANEL = pageSender();
/** A Lever posting (its parser reads it as a posting) and its application form. */
const POSTING = 'https://jobs.lever.co/acme/1b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';
const FORM = `${POSTING}/apply`;
const OTHER = 'https://jobs.lever.co/acme/2c8e1d4f-2b5a-4f9c-8b6e-6a7f4d3c2b11/apply';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const at = (url: string, documentId: string, extra: Record<string, unknown> = {}) => contentSender({ url,
  tab: { id: 12, url }, documentId, ...extra });

async function worker() {
  const started = await startTestWorker({ token: tokenRecord() });
  await started.deliver({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS }, OPTIONS);
  return started;
}

const pageOf = async (test: Awaited<ReturnType<typeof worker>>) => ((await test.deliver({ v: 1, type: 'panel/reports',
  tabId: 12 }, PANEL)) as { data: { page?: Record<string, unknown> } }).data.page;
const starts = (test: Awaited<ReturnType<typeof worker>>) => sentToFrames(test)
  .filter((sent) => typeOfSent(sent) === 'run/start');

describe('Open Application on a posting (v5 p2-fill)', () => {
  it('PageState.entry follows the posting frame\'s frame/wall {entry}, kept by its document, gone with it', async () => {
    const test = await worker();
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    expect(await pageOf(test)).toMatchObject({ support: 'no-form', posting: true });
    expect((await pageOf(test))?.entry).toBeUndefined();
    await test.deliver({ v: 1, type: 'frame/wall', wall: null, entry: true }, at(POSTING, 'doc-posting'));
    expect(await pageOf(test)).toMatchObject({ support: 'no-form', posting: true, entry: true });
    // The same document's hello again keeps it; another document's does not.
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    expect((await pageOf(test))?.entry).toBe(true);
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-again'));
    expect((await pageOf(test))?.entry).toBeUndefined();
  });

  it('is never kept beside a wall or a choice, nor from a subframe', async () => {
    const test = await worker();
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    await test.deliver({ v: 1, type: 'frame/wall', wall: 'sign-in', entry: true }, at(POSTING, 'doc-posting'));
    expect((await pageOf(test))?.entry).toBeUndefined();
    await test.deliver({ v: 1, type: 'frame/wall', wall: null, choice: true, entry: true }, at(POSTING, 'doc-posting'));
    expect((await pageOf(test))?.entry).toBeUndefined();
    await test.deliver({ v: 1, type: 'frame/wall', wall: null }, at(POSTING, 'doc-posting'));
    const sub = at(POSTING, 'doc-sub', { frameId: 3 });
    await test.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false }, sub);
    await test.deliver({ v: 1, type: 'frame/wall', wall: null, entry: true }, sub);
    expect((await pageOf(test))?.entry).toBeUndefined();
  });

  it('a panel/fill there reaches the posting frame, and starts the application form of that job once', async () => {
    const test = await worker();
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    await test.deliver({ v: 1, type: 'frame/wall', wall: null, entry: true }, at(POSTING, 'doc-posting'));
    expect(await test.deliver({ v: 1, type: 'panel/fill', tabId: 12, dryRun: false }, PANEL))
      .toEqual({ ok: true, data: { frames: 1 } });
    expect(starts(test).map((sent) => [sent.message, sent.options?.frameId])).toEqual([
      [{ v: 1, type: 'run/start', dryRun: false }, 0]]);
    // Another job's form is not started; this job's is, once.
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(OTHER, 'doc-other'));
    expect(starts(test)).toHaveLength(1);
    const again = await worker();
    await again.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    await again.deliver({ v: 1, type: 'frame/wall', wall: null, entry: true }, at(POSTING, 'doc-posting'));
    await again.deliver({ v: 1, type: 'panel/fill', tabId: 12, dryRun: false }, PANEL);
    await again.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(FORM, 'doc-form'));
    await vi.waitFor(() => expect(starts(again)).toHaveLength(2));
    expect(starts(again)[1]).toMatchObject({ message: { v: 1, type: 'run/start', dryRun: false },
      options: { frameId: 0, documentId: 'doc-form' } });
    await again.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(FORM, 'doc-form-2'));
    expect(starts(again)).toHaveLength(2);
  });

  it('without the entry a posting\'s panel/fill reaches no frame (undo proof for the panel\'s rule)', async () => {
    const test = await worker();
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, at(POSTING, 'doc-posting'));
    expect(await test.deliver({ v: 1, type: 'panel/fill', tabId: 12, dryRun: false }, PANEL))
      .toEqual({ ok: true, data: { frames: 0 } });
  });
});
