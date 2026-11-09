/*
 * v1.3 B: a submitted form's questions and answers in the real worker (submissions.ts, settings.ts, index.ts) against
 * the fake TailorIT: held for the arm alone, sent only once the site confirmed that Submit (after POST /applied for a
 * job TailorIT has; in its place, with the page's posting, for one it has not, POST /applied after a 400), the answers
 * only while "Keep my submitted answers in TailorIT" is on, nothing for another frame's or document's arm, and nothing
 * after a token change. Undo proofs: each `it` names the rule whose removal fails it.
 */
import { describe, expect, it } from 'vitest';
import { applicationOf } from '../adapters';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { CapturedField } from '../messaging/schemas';
import {
  beginRun, contentSender, fieldSpec, goldens, LEVER_URL, pageSender, startTestWorker, tokenRecord, type TestWorker,
} from './worker.testkit';

const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
const OPTIONS = pageSender('options.html');
const bodyOf = (worker: TestWorker, route: string) =>
  worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === route)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);
const routesOf = (worker: TestWorker) => worker.tailorit.requests.map((request) => `${request.method} ${request.path}`)
  .filter((route) => route === 'POST /api/autofill/applied' || route === 'POST /api/autofill/submissions');
const SUBMISSION_OK = { json: { lookup: goldens.lookup, job: 'shared', questionsAdded: 2, questionsKnown: 2,
  answersKept: 2 } };

const FIELDS: CapturedField[] = [
  { spec: fieldSpec(1, { label: 'Do you enjoy hiking?' }) as unknown as CapturedField['spec'], step: 0,
    answer: { kind: 'text', text: 'Yes, every weekend.' } },
  { spec: fieldSpec(2, { label: 'Resume', kind: 'file' }) as unknown as CapturedField['spec'], step: 0,
    answer: { kind: 'file', fileName: 'resume.pdf' } },
];
const POSTING = { title: 'Engineer', company: 'Northwind', description: 'We build things.' };
const form = (worker: TestWorker, sender = contentSender(), extra: Record<string, unknown> = {}) => worker.deliver({ v: 1,
  type: 'submit/form', applicationKey: KEY, fields: FIELDS, posting: POSTING, ...extra }, sender);
const detected = (worker: TestWorker, sender = contentSender()) => worker.deliver({ v: 1, type: 'submit/detected',
  applicationKey: KEY, evidence: 'success-message' }, sender);

async function withForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async () => ({ ok: true, data: {} });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  worker.tailorit.reply('POST /api/autofill/submissions', SUBMISSION_OK);
  return worker;
}

describe('a submitted form (v1.3 B)', () => {
  it('for a job TailorIT has: POST /applied first, then its questions and answers by the job\'s id', async () => {
    const worker = await withForm();
    const runId = await beginRun(worker, { applicationKey: KEY });
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel', runId }, contentSender()))
      .toEqual({ ok: true, data: {} });
    expect(await form(worker)).toEqual({ ok: true, data: {} });
    expect(await detected(worker)).toEqual({ ok: true, data: {} });
    expect(routesOf(worker)).toEqual(['POST /api/autofill/applied', 'POST /api/autofill/submissions']);
    const [body] = bodyOf(worker, 'POST /api/autofill/submissions');
    expect(body).toMatchObject({ jobId: goldens.lookup.job.id, questions: [
      { ref: FIELDS[0]!.spec.key, questionKey: 'do you enjoy hiking', label: 'Do you enjoy hiking?', kind: 'text' },
      { ref: FIELDS[1]!.spec.key, questionKey: 'resume', kind: 'file' }],
    answers: [{ ref: FIELDS[0]!.spec.key, answer: { kind: 'text', text: 'Yes, every weekend.' } },
      { ref: FIELDS[1]!.spec.key, answer: { kind: 'file', fileName: 'resume.pdf' } }] });
    // A job TailorIT has: no posting text.
    expect(body).not.toHaveProperty('posting');
    expect(body).not.toHaveProperty('url');
  });

  // Undo proof: send the form from the submit/form handler (or from the arm) and the first expectation fails.
  it('sends nothing without the site\'s confirmation of that very Submit', async () => {
    const worker = await withForm();
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(worker);
    expect(routesOf(worker)).toEqual([]);
    // A form with no arm records and sends nothing, whatever sign follows.
    const bare = await withForm();
    await form(bare);
    expect(await detected(bare)).toEqual({ ok: false, error: 'expired' });
    expect(routesOf(bare)).toEqual([]);
    // The form of another document than the arm's is not that Submit's.
    const elsewhere = await withForm();
    await elsewhere.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(elsewhere, contentSender({ documentId: 'doc-9' }));
    await detected(elsewhere);
    expect(routesOf(elsewhere)).toEqual(['POST /api/autofill/applied']);
  });

  // Undo proof: drop `...(ctx.keepAnswers ? { answers } : {})`'s condition and `answers` is sent.
  it('sends the questions only while "Keep my submitted answers in TailorIT" is off', async () => {
    const worker = await withForm();
    const off = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, keepAnswers: 'off' as const } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: off }, OPTIONS)).toMatchObject({ ok: true });
    const runId = await beginRun(worker, { applicationKey: KEY });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel', runId }, contentSender());
    await form(worker);
    await detected(worker);
    const [body] = bodyOf(worker, 'POST /api/autofill/submissions');
    expect(body!.questions).toHaveLength(2);
    expect(body).not.toHaveProperty('answers');
  });

  it('for a posting TailorIT has no job of: POST /submissions in place of /applied, with the page\'s posting', async () => {
    const worker = await withForm();
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(worker);
    await detected(worker);
    expect(routesOf(worker)).toEqual(['POST /api/autofill/submissions']);
    expect(bodyOf(worker, 'POST /api/autofill/submissions')[0]).toMatchObject({
      url: 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00', posting: POSTING });
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });
  });

  // Undo proof: drop the bad-request fallback and nothing records the application.
  it('records with POST /applied when TailorIT refused the body (its 400 changed nothing)', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/submissions', { status: 400, json: { error: {
      code: 'validation_failed', message: 'x' } } }, { once: true });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(worker);
    await detected(worker);
    expect(routesOf(worker)).toEqual(['POST /api/autofill/submissions', 'POST /api/autofill/applied']);
    expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });
  });

  it('keeps the form for Try again after TailorIT failed, and drops it with a token change', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/submissions', { status: 503, json: { error: { code: 'unavailable',
      message: 'x' } } }, { once: true });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(worker);
    await detected(worker);
    expect(await worker.deliver({ v: 1, type: 'panel/retryApplied', tabId: 7 }, pageSender())).toEqual({ ok: true, data: {} });
    expect(routesOf(worker)).toEqual(['POST /api/autofill/submissions', 'POST /api/autofill/submissions']);
    expect(bodyOf(worker, 'POST /api/autofill/submissions')[1]).toMatchObject({ questions: [{}, {}] });
    // A token change: a form held for an arm is never sent under the next connection.
    const next = await withForm();
    await next.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await form(next);
    await next.deliver({ v: 1, type: 'auth/disconnect' }, OPTIONS);
    await next.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, OPTIONS);
    await next.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender());
    await detected(next);
    expect(routesOf(next)).toEqual(['POST /api/autofill/applied']);
  });

  it('refuses a form for another application than the frame\'s, a private tab\'s, or one with a value in a question', async () => {
    const worker = await withForm();
    expect(await form(worker, contentSender(), { applicationKey: 'lever:00000000000000ff' }))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await form(worker, contentSender({ tab: { id: 7, incognito: true } }))).toMatchObject({ ok: false });
    const valued = [{ ...FIELDS[0]!, spec: { ...FIELDS[0]!.spec, current: { kind: 'text', text: 'x' } } }];
    expect(await form(worker, contentSender(), { fields: valued })).toMatchObject({ ok: false, error: 'bad_message' });
  });
});
