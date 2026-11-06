/*
 * The audit of 2026-11-06 (M1, m9): the side panel's choices for a tab (the resume chosen with Change, "Apply without
 * resume", the job chosen for "Autofill for another job" and the search it came from) survive Chrome stopping the idle
 * worker, each for the application it was made for, and go with the tab and the token.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import { JOB_CHOICE_PREFIX } from '../shared/stored';
import {
  beginRun, contentSender, fieldSpec, goldens, LEVER_URL, pageSender, restartTestWorker, startTestWorker, tokenRecord,
  type TestWorker,
} from './worker.testkit';

const LOOKUP = 'POST /api/autofill/lookup';
const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
/** Another posting on the same board: another application in the same tab. */
const OTHER_URL = 'https://jobs.lever.co/tailorit-fixture/7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f/apply';
const OTHER_KEY = applicationOf(new URL(OTHER_URL))!.applicationKey;
const SEARCH = { items: [{ jobId: 1042, title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA' },
  { jobId: 1077, title: 'Backend Engineer, Payments', company: 'Northwind', location: '' }] };

const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());
const bodyOf = (worker: TestWorker, route: string) =>
  worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === route)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);

/** The frame relays the card's refresh as job/lookup or job/add, as a content script does. */
function relay(worker: TestWorker, url = LEVER_URL): void {
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string; action?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    const answer = (await worker.deliver({ v: 1, type: message.action === 'add' ? 'job/add' : 'job/lookup' },
      contentSender({ url }))) as { ok: boolean };
    return answer.ok ? { ok: true, data: {} } : answer;
  };
}

async function withForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  relay(worker);
  return worker;
}

async function restarted(worker: TestWorker): Promise<TestWorker> {
  const next = await restartTestWorker(worker, { token: tokenRecord() });
  relay(next);
  return next;
}

describe('the side panel\'s choices survive the idle worker (the audit, M1)', () => {
  it('"Apply without resume": the plan after a restart still attaches none', async () => {
    const worker = await withForm();
    await page(worker, { type: 'panel/withoutResume', tabId: 7, without: true });
    const next = await restarted(worker);
    const runId = await beginRun(next, { applicationKey: KEY });
    const upload = fieldSpec(1, { kind: 'file' });
    await next.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [upload], planKeys: [upload.key],
      canaries: [], notices: [] }, contentSender());
    expect(next.core.calls.planFrame.at(-1)).toHaveProperty('withoutResume', true);
    // And the card says so.
    expect(await page(next, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true,
      data: { card: { withoutResume: true } } });
  });

  it('the resume chosen with Change: run/begin after a restart looks up with it', async () => {
    const worker = await withForm();
    const other = goldens.resumes.items[1]!.id;
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: other });
    const next = await restarted(worker);
    await beginRun(next, { applicationKey: KEY });
    expect(bodyOf(next, LOOKUP).at(-1)).toMatchObject({ resumeId: other });
  });

  it('the job chosen, and the search it came from, survive: run/begin asks for that job', async () => {
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    await page(worker, { type: 'panel/jobSearch', tabId: 7, query: 'payments' });
    const second = await restarted(worker);
    // The search made before the restart still names its jobs: the person's choice of its second one counts.
    expect(await page(second, { type: 'panel/chooseJob', tabId: 7, ref: 'j1' })).toEqual({ ok: true, data: {} });
    const third = await restarted(second);
    await beginRun(third, { applicationKey: KEY });
    expect(bodyOf(third, LOOKUP).at(-1)).toMatchObject({ jobId: 1077 });
  });

  it('a choice made while the stored ones are read back is kept over them', async () => {
    const worker = await withForm();
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id });
    const next = await restarted(worker);
    await page(next, { type: 'panel/setResume', tabId: 7, resumeId: null });
    await beginRun(next, { applicationKey: KEY });
    expect(bodyOf(next, LOOKUP).at(-1)).not.toHaveProperty('resumeId');
  });

  it('ids and keys only, and gone with the tab and with the token', async () => {
    const worker = await withForm();
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id });
    await page(worker, { type: 'panel/withoutResume', tabId: 7, without: true });
    const stored = await fakeBrowser.storage.session.get(null);
    const record = stored[`${JOB_CHOICE_PREFIX}7`];
    expect(record).toEqual({ resume: { app: KEY, id: goldens.resumes.items[1]!.id }, without: KEY });
    expect(JSON.stringify(record)).not.toContain('lever.co');
    // A token change takes them, stored too.
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id });
    await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    await expect.poll(async () => (await fakeBrowser.storage.session.get(null))[`${JOB_CHOICE_PREFIX}7`]).toBeUndefined();
    const next = await restarted(worker);
    await beginRun(next, { applicationKey: KEY });
    expect(bodyOf(next, LOOKUP).at(-1)).not.toHaveProperty('resumeId');
    // A closed tab takes them too.
    await page(next, { type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id });
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await expect.poll(async () => (await fakeBrowser.storage.session.get(null))[`${JOB_CHOICE_PREFIX}7`]).toBeUndefined();
  });
});

describe('the resume chosen with Change belongs to its application (the audit, m9)', () => {
  it('is not attached to another posting the tab shows next', async () => {
    const worker = await withForm();
    const other = goldens.resumes.items[1]!.id;
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: other });
    // The same tab moves on to another posting (a new document at another application's address).
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true },
      contentSender({ url: OTHER_URL, documentId: 'doc-2' }));
    relay(worker, OTHER_URL);
    await beginRun(worker, { applicationKey: OTHER_KEY }, contentSender({ url: OTHER_URL, documentId: 'doc-2' }));
    expect(bodyOf(worker, LOOKUP).at(-1)).not.toHaveProperty('resumeId');
  });

  it('stays with its own application across its pages (its posting, then its form)', async () => {
    const worker = await withForm();
    const other = goldens.resumes.items[1]!.id;
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: other });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ documentId: 'doc-2' }));
    await beginRun(worker, { applicationKey: KEY }, contentSender({ documentId: 'doc-2' }));
    expect(bodyOf(worker, LOOKUP).at(-1)).toMatchObject({ resumeId: other });
  });
});
