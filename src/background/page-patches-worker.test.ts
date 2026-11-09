/*
 * v5 p2-fill (PLAN decision 14), the worker's part of the page patches (background/page-patches.ts): page/patches from a
 * frame of ours that said hello with a form, for that same document, runs the patches' bundle in that one document in
 * the page's own world (world MAIN), and nowhere else: not for a frame with no form, not for another document of the
 * frame, not from an extension page, not past its rate; Chrome's refusal answers unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PAGE_PATCHES_FILE, PAGE_PATCHES_LIMIT } from './page-patches';
import { contentSender, pageSender, startTestWorker } from './worker.testkit';

const TOP = contentSender();

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

describe('page/patches (v5 p2-fill)', () => {
  it('runs the patches in the asking frame\'s own document, in the page\'s world, once it said hello with a form', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, TOP);
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, TOP)).toEqual({ ok: true, data: {} });
    expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-1'] }, files: [PAGE_PATCHES_FILE],
      world: 'MAIN' }]);
  });

  it('runs nothing for a frame with no form, another document, or an extension page', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, TOP);
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, TOP)).toEqual({ ok: false, error: 'expired' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, TOP);
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, contentSender({ documentId: 'doc-other' })))
      .toEqual({ ok: false, error: 'expired' });
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, pageSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.fakes.injections).toEqual([]);
  });

  it('answers unavailable where Chrome would not run them, and holds a stream of asks', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, TOP);
    worker.fakes.injectAnswer = () => {
      throw new Error('Cannot access contents of the page.');
    };
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, TOP)).toEqual({ ok: false, error: 'unavailable' });
    worker.fakes.injectAnswer = () => undefined;
    for (let index = 1; index < PAGE_PATCHES_LIMIT.count; index += 1) {
      expect(await worker.deliver({ v: 1, type: 'page/patches' }, TOP)).toMatchObject({ ok: true });
    }
    expect(await worker.deliver({ v: 1, type: 'page/patches' }, TOP)).toMatchObject({ ok: false, error: 'rate_limited' });
  });
});
