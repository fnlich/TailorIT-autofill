/*
 * The audit of 2026-11-06 (m6): a frame whose document moves in place to an address no parser reads keeps the
 * application it showed only shortly after a Submit pressed in it (its confirmation drawn in place). A board the page
 * moves on to later is no application's, so "Application submitted" does not stay on it.
 */
import { describe, expect, it } from 'vitest';
import { applicationOf } from '../adapters';
import { KEEP_KEY_AFTER_PRESS_MS } from './index';
import { contentSender, goldens, LEVER_URL, pageSender, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
/** A board: an address no parser reads as an application. */
const BOARD = 'https://jobs.lever.co/acme';
const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());
const pageState = async (worker: TestWorker) =>
  ((await page(worker, { type: 'panel/reports', tabId: 7 })) as { data: { page?: Record<string, unknown> } }).data.page;

async function submitted(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async () => ({ ok: true, data: {} });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel' }, contentSender());
  return worker;
}

describe('an in-place move after a Submit (the audit, m6)', () => {
  it('to an address no parser reads, shortly after the press, is still the application: its sign counts there', async () => {
    const worker = await submitted();
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, nav: 1 },
      contentSender({ url: BOARD, tab: { id: 7, url: BOARD } }));
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      contentSender({ url: BOARD, tab: { id: 7, url: BOARD } }))).toEqual({ ok: true, data: {} });
    expect(await pageState(worker)).toMatchObject({ submitted: 'recorded' });
  });

  it('to a board later on is no application\'s: "Application submitted" goes', async () => {
    const worker = await submitted();
    await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      contentSender());
    expect(await pageState(worker)).toMatchObject({ submitted: 'recorded' });
    worker.clock.now += KEEP_KEY_AFTER_PRESS_MS + 1;
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, nav: 1 },
      contentSender({ url: BOARD, tab: { id: 7, url: BOARD } }));
    expect(await pageState(worker)).not.toHaveProperty('submitted');
  });
});
