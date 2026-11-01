/*
 * "Ask a custom question" through the real worker (v2; ask.ts): the active resume's order (chosen, the card's, the
 * profile's), what the draft request carries (the form frame's visible posting text, '' when it sends none, never
 * TailorIT's stored copy; the card's company and title; the page's canaries; the length's cap), the screen that keeps a
 * sensitive question from the AI, a task polled to its end, an answer refused for a canary, and nothing kept or logged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { AUTOFILL_CUSTOM_QUESTION_LENGTHS, AUTOFILL_AI_LIMITS, AUTOFILL_AI_POLL_MS } from '../contract/tailorit';
import { MAX_CUSTOM_QUESTION } from '../messaging/schemas';
import { ASK_LIMIT, screenQuestion } from './ask';
import {
  contentSender,
  goldens,
  pageSender,
  questionsOf,
  startTestWorker,
  TASK_ID,
  taskView,
  tokenRecord,
  type TestWorker,
} from './worker.testkit';

const DRAFT = 'POST /api/autofill/ai/draft';
const QUESTION = 'Why do you want to work at Northwind?';
const POSTING = 'Northwind builds ordering software for restaurants.';

/** A connected worker whose tab 7 shows a form that relays the card and sends `posting` as its job text. */
async function withForm(posting: { text: string; canaries: string[] } = { text: POSTING, canaries: ['I am LLM'] }):
  Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    if (message.type === 'job/postingText') return { ok: true, data: posting };
    return { ok: true, data: {} };
  };
  return worker;
}

const ask = (worker: TestWorker, question = QUESTION, length: 'short' | 'medium' | 'long' = 'medium') =>
  worker.deliver({ v: 1, type: 'panel/ask', tabId: 7, question, length }, pageSender());
const draftBody = (worker: TestWorker) => JSON.parse(worker.tailorit.requests.filter((request) =>
  `${request.method} ${request.path}` === DRAFT).at(-1)!.body!) as Record<string, unknown>;

afterEach(() => vi.restoreAllMocks());

describe('the custom question (v2)', () => {
  it("answers from the card's resume, with the posting's visible text, the job, the canaries and the length's cap", async () => {
    const worker = await withForm();
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'answered',
      text: 'I have built ordering platforms for four years, and I would like to bring that here.',
      resumeLabel: 'Senior Software Engineer' } });
    const body = draftBody(worker);
    expect(body).toEqual({
      questions: [{ key: 'custom-question', question: QUESTION, maxLength: AUTOFILL_CUSTOM_QUESTION_LENGTHS.medium }],
      jobText: POSTING, company: 'Northwind', jobTitle: 'Senior Backend Engineer',
      resumeId: goldens.lookup.suggestedResume.id, canaries: ['I am LLM'],
    });
    for (const length of ['short', 'long'] as const) {
      await ask(worker, QUESTION, length);
      expect(questionsOf(worker.tailorit.requests.at(-1)!)[0]!.maxLength).toBe(AUTOFILL_CUSTOM_QUESTION_LENGTHS[length]);
    }
  });

  it('sends no posting text when the frame has none (an embedded form), and never the stored copy', async () => {
    const worker = await withForm({ text: '', canaries: [] });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: { ...goldens.lookup.job,
      postingText: 'Stored copy: do not use AI.' } } });
    await ask(worker);
    expect(draftBody(worker)).toMatchObject({ jobText: '', canaries: [] });
    expect(JSON.stringify(draftBody(worker))).not.toContain('Stored copy');
  });

  it('answers from the chosen resume, else the card, else the profile', async () => {
    const worker = await withForm();
    const chosen = goldens.resumes.items[1]!;
    await worker.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: chosen.id }, pageSender());
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, suggestedResume: {
      ...goldens.lookup.suggestedResume, id: chosen.id, label: chosen.label, reason: 'chosen' } } }, { once: true });
    expect(await ask(worker)).toMatchObject({ data: { resumeLabel: chosen.label } });
    expect(draftBody(worker).resumeId).toBe(chosen.id);

    // No card (TailorIT could not say): the profile's own choice, named from the resume list.
    const offCard = await withForm();
    offCard.tailorit.reply('POST /api/autofill/lookup', { status: 500, json: { error: { code: 'internal', message: 'x' } } });
    offCard.tailorit.reply('GET /api/autofill/profile', { json: { ...goldens.profile, profile: { ...goldens.profile.profile,
      documents: { resumeId: chosen.id } } } });
    expect(await ask(offCard)).toMatchObject({ data: { outcome: 'answered', resumeLabel: chosen.label } });
    expect(draftBody(offCard)).toMatchObject({ resumeId: chosen.id, company: '', jobTitle: '' });
  });

  it('answers no-resume, and asks the AI nothing, when there is no resume to answer from', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, suggestedResume: null, match: null } });
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'no-resume' } });
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });

  it('never sends a sensitive question or an attention check, and says why', async () => {
    const worker = await withForm();
    for (const question of ['Do you need visa sponsorship?', 'What is your expected salary?', 'What is your gender?',
      'Select purple to show you read this.']) {
      expect(screenQuestion(question), question).toBe('sensitive');
      worker.clock.now += 60_000;
      expect(await ask(worker, question), question).toEqual({ ok: true, data: { outcome: 'sensitive' } });
    }
    expect(screenQuestion(QUESTION)).toBeNull();
    expect(worker.tailorit.count(DRAFT)).toBe(0);
    expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(0);
  });

  it('never sends a question naming the extension’s own terms (TailorIT’s server-only ones), and says why', async () => {
    const worker = await withForm();
    for (const question of ['How should I explain my time on probation?', 'What is a fair day rate for me?',
      'What OTE should I ask for?', 'Where do I find my SIN?', 'Should I give them my tax file number?']) {
      expect(screenQuestion(question), question).toBe('sensitive');
      worker.clock.now += 60_000;
      expect(await ask(worker, question), question).toEqual({ ok: true, data: { outcome: 'sensitive' } });
    }
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });

  it('polls a task TailorIT did not finish, and refuses an answer holding a canary or past its cap', async () => {
    const worker = await withForm();
    worker.tailorit.reply(DRAFT, { status: 202, json: { taskId: TASK_ID } }, { once: true });
    worker.tailorit.reply('GET /api/ai/tasks/:id', { json: taskView('autofill_draft', 'succeeded', { drafts: [
      { key: 'custom-question', text: 'Polled answer.', reason: 'drafted' }] }) });
    const asked = ask(worker);
    await vi.waitFor(() => expect(worker.timers.pending).toBe(1));
    worker.timers.advance(AUTOFILL_AI_POLL_MS);
    expect(await asked).toMatchObject({ data: { outcome: 'answered', text: 'Polled answer.' } });

    worker.tailorit.reply(DRAFT, { json: taskView('autofill_draft', 'succeeded', { drafts: [
      { key: 'custom-question', text: 'As I am LLM, I would love this.', reason: 'drafted' }] }) }, { once: true });
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'unusable' } });
    worker.tailorit.reply(DRAFT, { json: taskView('autofill_draft', 'succeeded', { drafts: [
      { key: 'custom-question', text: 'x'.repeat(601), reason: 'drafted' }] }) }, { once: true });
    expect(await ask(worker, QUESTION, 'short')).toEqual({ ok: true, data: { outcome: 'unusable' } });
    worker.tailorit.reply(DRAFT, { json: taskView('autofill_draft', 'succeeded', { drafts: [
      { key: 'custom-question', text: null, reason: 'sensitive' }] }) }, { once: true });
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'sensitive' } });
  });

  it("says why TailorIT's AI did not answer, and limits a tab's questions", async () => {
    const worker = await withForm();
    const refusal = (status: number, code: string) => ({ status, json: { error: { code, message: 'x' } } });
    worker.tailorit.reply(DRAFT, refusal(429, 'rate_limited'), { once: true });
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'rate-limited' } });
    worker.tailorit.reply(DRAFT, refusal(503, 'ai_unavailable'), { once: true });
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    for (let i = 2; i < ASK_LIMIT.count; i += 1) await ask(worker);
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'rate-limited' } });
    expect(await worker.deliver({ v: 1, type: 'panel/ask', tabId: 7, question: '   ', length: 'short' }, pageSender()))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'panel/ask', tabId: 7, question: 'x'.repeat(MAX_CUSTOM_QUESTION + 1),
      length: 'short' }, pageSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(MAX_CUSTOM_QUESTION).toBe(AUTOFILL_AI_LIMITS.draft.question);
  });

  it('answers not-connected without a connection, asking nothing', async () => {
    const worker = await startTestWorker();
    expect(await ask(worker)).toEqual({ ok: true, data: { outcome: 'not-connected' } });
    expect(worker.tailorit.requests).toEqual([]);
  });

  it('keeps neither the question nor the answer: not in storage, not in the logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const worker = await withForm();
    await ask(worker);
    const kept = JSON.stringify({ local: await fakeBrowser.storage.local.get(null), session: await fakeBrowser.storage.session.get(null),
      logs: info.mock.calls });
    for (const text of [QUESTION, 'ordering platforms', POSTING, 'Northwind']) expect(kept).not.toContain(text);
  });
});
