/*
 * Cover letters in the worker (Phase G; cover-letters.ts, planner.ts, resume-transfer.ts): what asking TailorIT sends
 * (a check first, then the ask that may write) and how its answers end (ready, written now, failed, none, refused, busy,
 * limited, the cap), who wrote the letter (TailorIT's word), one ask per run with the lookup's job held in the worker's
 * memory, the letter planned again once settled, its PDF sent over the resume port as a resume is (PDF only, its hash
 * checked; checked for again after a restart), nothing generated in a dry run or a profile-only run, the side panel's
 * row (panel/letter), and no letter id, job id or word of a letter in any message to a frame or any log line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOFILL_COVER_LETTER_LIMITS } from '../contract/tailorit';
import type { FieldKey, FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { RESUME_CHUNK_BYTES } from '../messaging/schemas';
import type { FakePortPeer } from '../platform/fake';
import {
  createRunLetter, fetchLetter, letterRequestOf, LETTER_BUSY_MS, LETTER_CAP_MS, LETTER_POLL_MS, type LetterAsk,
} from './cover-letters';
import { dispositionName, type ServerResult } from './server-client';
import { manualTimers } from './timers';
import {
  beginRun, contentSender, fakePdf, fieldSpec, fileReply, frameReport, goldens, letterCore, pageSender, restartTestWorker,
  sha256Hex, startTestWorker, tokenRecord, type RecordedRequest, type Reply as FakeReply, type TestWorker,
} from './worker.testkit';

const LETTER_ID = '9b2d4f6a-1c3e-4a5b-8d7f-0e2c4a6b8d10';
const POST = 'POST /api/autofill/cover-letters';
const STATE = `GET /api/autofill/cover-letters/${LETTER_ID}`;
const FILE = `GET /api/autofill/cover-letters/${LETTER_ID}/file`;
const RESUME_ID = goldens.lookup.suggestedResume.id;
const POSTING = 'Northwind is hiring a Senior Backend Engineer. VISIBLE-MARKER-01';

const LETTER = fieldSpec(1, { kind: 'file', label: 'Cover letter', key: 'lever|main|cover-letter|none|0' as FieldKey });

afterEach(() => vi.restoreAllMocks());

// ── Asking (fetchLetter) ──────────────────────────────────────────────────────────────────────────────────────────

type Reply<T> = ServerResult<T> | (() => ServerResult<T>);

/** A server that answers the POST and each state read from its scripts, in order (the last one repeats). */
function scriptedServer(posts: Array<Reply<{ letterId: string; state: 'ready' | 'generating' | 'failed'; aiWritten: boolean }>>,
  states: Array<Reply<{ state: 'ready' | 'generating' | 'failed' }>> = []) {
  const sent: unknown[] = [];
  let polled = 0;
  const next = <T>(list: Array<Reply<T>>, at: number): ServerResult<T> => {
    const reply = list[Math.min(at, list.length - 1)]!;
    return typeof reply === 'function' ? reply() : reply;
  };
  return {
    sent,
    get polled() {
      return polled;
    },
    coverLetter: async (body: unknown) => {
      sent.push(body);
      return next(posts, sent.length - 1);
    },
    coverLetterState: async () => next(states, polled++),
  };
}

const ok = <T>(value: T): ServerResult<T> => ({ ok: true, value });
/** POST's answer: the letter, where it stands, and whether TailorIT's AI wrote it (the person's by default). */
const letter = (state: 'ready' | 'generating' | 'failed', aiWritten = state === 'generating') =>
  ok({ letterId: LETTER_ID, state, aiWritten });
const refused = (failure: 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'server-error' | 'timeout',
  extra: { code?: string; retryAfterSeconds?: number; status?: number } = {}): ServerResult<never> => ({ ok: false, failure,
  ...extra });

const ASK: LetterAsk = { jobId: 4821, company: 'Northwind', jobTitle: 'Senior Backend Engineer', jobText: POSTING,
  resumeId: RESUME_ID, generate: true, canaries: ['I am LLM', 'x'] };

/** The check (generate false, no page text) that comes before an ask that may write. */
const CHECK = { jobId: 4821, company: 'Northwind', jobTitle: 'Senior Backend Engineer', resumeId: RESUME_ID, generate: false };
const NOT_FOUND = refused('not-found', { status: 404 });

/** Runs fetchLetter over a script, the timers advanced as it waits. */
async function asked(server: ReturnType<typeof scriptedServer>, ask: LetterAsk = ASK, options: { waitOnLimit?: boolean;
  onWriting?(): void } = {}) {
  const timers = manualTimers();
  const pending = fetchLetter({ server, timers, now: () => 0 }, ask, () => true, options);
  let result: Awaited<typeof pending> | null = null;
  void pending.then((value) => {
    result = value;
  });
  for (let step = 0; step < 200 && result === null; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    timers.advance(LETTER_POLL_MS);
  }
  return (await pending);
}

describe('asking TailorIT for the letter', () => {
  it('sends the job, the page’s text and canaries only when TailorIT may write it, never a stored copy', () => {
    expect(letterRequestOf(ASK)).toEqual({ jobId: 4821, company: 'Northwind', jobTitle: 'Senior Backend Engineer',
      jobText: POSTING, resumeId: RESUME_ID, generate: true, canaries: ['I am LLM'] });
    // generate false: only a letter the person wrote is wanted, so no page text goes.
    expect(letterRequestOf({ ...ASK, generate: false })).toEqual({ jobId: 4821, company: 'Northwind',
      jobTitle: 'Senior Backend Engineer', resumeId: RESUME_ID, generate: false });
    // A posting TailorIT does not have: the page's names, both needed.
    expect(letterRequestOf({ ...ASK, jobId: null, jobText: '' })).toEqual({ company: 'Northwind',
      jobTitle: 'Senior Backend Engineer', resumeId: RESUME_ID, generate: true, canaries: ['I am LLM'] });
    expect(letterRequestOf({ ...ASK, jobId: null, company: ' ' })).toBeNull();
    expect(letterRequestOf({ ...ASK, resumeId: null })).toBeNull();
    // Within TailorIT's caps.
    const long = letterRequestOf({ ...ASK, jobText: 'word '.repeat(10_000), company: 'Co '.repeat(100),
      canaries: Array.from({ length: 80 }, (_, at) => `canary-${at}`) })!;
    expect(long.jobText!.length).toBeLessThanOrEqual(AUTOFILL_COVER_LETTER_LIMITS.jobText);
    expect(long.company.length).toBeLessThanOrEqual(AUTOFILL_COVER_LETTER_LIMITS.company);
    expect(long.canaries).toHaveLength(AUTOFILL_COVER_LETTER_LIMITS.canaries);
  });

  it('checks first for the person’s own letter, which uses up none of the letters that may be written', async () => {
    const server = scriptedServer([letter('ready')]);
    expect(await asked(server)).toEqual({ state: 'ready', letterId: LETTER_ID, aiWritten: false });
    // One POST, a check: no page text, no canaries.
    expect(server.sent).toEqual([CHECK]);
    expect(server.polled).toBe(0);
  });

  it('asks with generate true only when the check finds none to use: none (404), or one not ready', async () => {
    for (const first of [NOT_FOUND, letter('failed')]) {
      const server = scriptedServer([first, letter('ready', true)]);
      expect(await asked(server)).toEqual({ state: 'ready', letterId: LETTER_ID, aiWritten: true });
      expect(server.sent).toEqual([CHECK, letterRequestOf(ASK)]);
    }
  });

  it('takes TailorIT’s word for who wrote it: a letter the AI wrote before this run is the AI’s', async () => {
    // Written earlier (the side panel's Write it now, or the letter editor's Generate), never edited: the check does
    // not answer it, and the ask that may write answers it ready, as the AI's.
    expect(await asked(scriptedServer([NOT_FOUND, letter('ready', true)]))).toMatchObject({ state: 'ready', aiWritten: true });
    // The person's own, as TailorIT says.
    expect(await asked(scriptedServer([NOT_FOUND, letter('ready', false)]))).toMatchObject({ state: 'ready', aiWritten: false });
  });

  it('polls a letter being written until it is ready: the AI’s, written during this run', async () => {
    const onWriting = vi.fn();
    const server = scriptedServer([NOT_FOUND, letter('generating')],
      [ok({ state: 'generating' }), refused('server-error'), ok({ state: 'ready' })]);
    expect(await asked(server, ASK, { onWriting })).toEqual({ state: 'ready', letterId: LETTER_ID, aiWritten: true });
    expect(server.polled).toBe(3);
    expect(onWriting).toHaveBeenCalledOnce();
  });

  it('marks a ready letter as the AI’s when this run had TailorIT start writing it (a worker that restarted)', async () => {
    const server = scriptedServer([letter('ready')]);
    expect(await asked(server, { ...ASK, written: true })).toMatchObject({ state: 'ready', aiWritten: true });
  });

  it('ends with why there is none', async () => {
    expect(await asked(scriptedServer([letter('failed')]))).toEqual({ state: 'none', reason: 'cover-letter-failed' });
    expect(await asked(scriptedServer([NOT_FOUND, letter('generating')], [ok({ state: 'failed' })])))
      .toEqual({ state: 'none', reason: 'cover-letter-failed' });
    const none = scriptedServer([NOT_FOUND]);
    expect(await asked(none, { ...ASK, generate: false })).toEqual({ state: 'none', reason: 'cover-letter-none' });
    expect(none.sent).toEqual([CHECK]);
    // With generate, a 404 to the ask that may write is a job or a resume that is not there.
    expect(await asked(scriptedServer([NOT_FOUND]))).toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    expect(await asked(scriptedServer([refused('forbidden')]))).toEqual({ state: 'none', reason: 'cover-letter-reconnect' });
    expect(await asked(scriptedServer([NOT_FOUND, refused('server-error', { code: 'ai_unavailable', status: 503 })])))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    // generating answered to a check breaks the contract: never taken as the person's, nothing more asked.
    for (const ask of [ASK, { ...ASK, generate: false }]) {
      const broken = scriptedServer([letter('generating')]);
      expect(await asked(broken, ask)).toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
      expect(broken.sent).toEqual([CHECK]);
    }
  });

  it('asks again past ai_busy and a 429, within the cap', async () => {
    const server = scriptedServer([NOT_FOUND, refused('conflict', { code: 'ai_busy' }),
      refused('rate-limited', { retryAfterSeconds: 3 }), letter('ready')]);
    expect(await asked(server)).toMatchObject({ state: 'ready' });
    expect(server.sent).toHaveLength(4);
    // The side panel would rather say so than wait.
    expect(await asked(scriptedServer([refused('rate-limited')]), ASK, { waitOnLimit: false }))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable', limited: true });
  });

  it('backs off a persistent ai_busy: at most 5 asks that may write within the cap', async () => {
    const server = scriptedServer([NOT_FOUND, refused('conflict', { code: 'ai_busy' })]);
    expect(await asked(server)).toEqual({ state: 'none', reason: 'cover-letter-timed-out' });
    const writes = server.sent.filter((body) => (body as { generate: boolean }).generate);
    // At 0, 15, 45, 105 and 165 s: TailorIT's 10 a minute and 60 an hour are never what runs out.
    expect(LETTER_BUSY_MS).toEqual([15_000, 30_000, 60_000]);
    expect(writes).toHaveLength(5);
    expect(server.sent).toHaveLength(6);
  });

  it('answers TailorIT’s limit, not a time-out, when a 429’s hint goes past the cap', async () => {
    const posted = scriptedServer([NOT_FOUND, refused('rate-limited', { retryAfterSeconds: LETTER_CAP_MS / 1000 + 1 })]);
    expect(await asked(posted)).toEqual({ state: 'none', reason: 'cover-letter-unavailable', limited: true });
    expect(posted.sent).toHaveLength(2);
    // The same while it is polled.
    const polled = scriptedServer([NOT_FOUND, letter('generating')],
      [refused('rate-limited', { retryAfterSeconds: LETTER_CAP_MS / 1000 + 1 })]);
    expect(await asked(polled)).toEqual({ state: 'none', reason: 'cover-letter-unavailable', limited: true });
    expect(polled.polled).toBe(1);
  });

  it(`gives a letter still being written up after ${LETTER_CAP_MS / 1000} s`, async () => {
    const server = scriptedServer([NOT_FOUND, letter('generating')], [ok({ state: 'generating' })]);
    expect(await asked(server)).toEqual({ state: 'none', reason: 'cover-letter-timed-out' });
    expect(server.polled).toBeLessThanOrEqual(LETTER_CAP_MS / LETTER_POLL_MS);
    expect(server.polled).toBeGreaterThan(LETTER_CAP_MS / LETTER_POLL_MS - 3);
  });

  it('asks nothing without a resume, or for a posting TailorIT lacks whose page names nothing', async () => {
    const server = scriptedServer([letter('ready')]);
    expect(await asked(server, { ...ASK, resumeId: null })).toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    expect(await asked(server, { ...ASK, jobId: null, company: '', jobTitle: '' }))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    expect(server.sent).toEqual([]);
  });

  it('reads the name a Content-Disposition gives', () => {
    expect(dispositionName(`attachment; filename="Cover Letter.pdf"; filename*=UTF-8''Cover%20Letter%20%E2%80%93%20Nw.pdf`))
      .toBe('Cover Letter – Nw.pdf');
    expect(dispositionName('attachment; filename="Letter.pdf"')).toBe('Letter.pdf');
    expect(dispositionName('attachment; filename=Letter.pdf')).toBe('Letter.pdf');
    expect(dispositionName(`attachment; filename*=UTF-8''%E0%A4%A`)).toBeNull();
    expect(dispositionName('attachment')).toBeNull();
    expect(dispositionName(null)).toBeNull();
  });
});

// ── The run's letter, through the worker ──────────────────────────────────────────────────────────────────────────

type PlanReply = { ok: boolean; error?: string; data?: { writes: Array<{ key: string; value: unknown; origin: unknown }>;
  results: Array<{ key: string; reason: string; status: string }>; awaiting: string[] } };

async function plan(worker: TestWorker, runId: string, specs: FieldSpec[] = [LETTER], extra: Record<string, unknown> = {}) {
  return (await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
    canaries: ['I am LLM'], notices: [], postingText: POSTING, ...extra }, contentSender())) as PlanReply;
}

async function poll(worker: TestWorker, runId: string, keys: string[] = [LETTER.key]) {
  return (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys }, contentSender())) as PlanReply;
}

/** Lets the worker's promises run, then moves its timers past one poll. */
async function tick(worker: TestWorker, ms = LETTER_POLL_MS): Promise<void> {
  for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
  worker.timers.advance(ms);
  for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
}

const posted = (worker: TestWorker) => worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === POST)
  .map((request) => JSON.parse(request.body!) as Record<string, unknown>);

const NONE_REPLY: FakeReply = { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } };
/** POST's answer as JSON: the letter, where it stands, and whether TailorIT's AI wrote it. */
const letterJson = (state: 'ready' | 'generating' | 'failed', aiWritten = state === 'generating'): FakeReply =>
  ({ json: { letterId: LETTER_ID, state, aiWritten } });
/** TailorIT's two answers: to a check (generate false), and to an ask that may write. */
const byGenerate = (check: FakeReply, write: FakeReply) => (request: RecordedRequest): FakeReply =>
  ((JSON.parse(request.body!) as { generate: boolean }).generate ? write : check);

/** The run's letter as the worker sent it (no page text), the check before it, and the person's resume. */
const JOB_ASK = { jobId: goldens.lookup.job.id, company: goldens.lookup.job.companyName, jobTitle: goldens.lookup.job.title,
  resumeId: RESUME_ID };

/** Answers the cover letter's file with `pdf`, under TailorIT's Download name. */
async function sendsFile(worker: TestWorker, pdf: Uint8Array): Promise<void> {
  const file = await fileReply(pdf);
  worker.tailorit.reply(FILE, { ...file, headers: { ...('headers' in file ? file.headers : {}),
    'Content-Disposition': `attachment; filename="Cover Letter - Northwind.pdf"; filename*=UTF-8''Cover%20Letter%20-%20Northwind.pdf` } });
}

/** A worker whose TailorIT has no letter of the person's (the check: 404), writes one (generating, then ready at the
 *  first poll) and sends `pdf` for it. */
async function writingWorker(pdf = fakePdf(RESUME_CHUNK_BYTES + 500)): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
  worker.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('generating')));
  worker.tailorit.reply(STATE, { json: { state: 'ready' } });
  await sendsFile(worker, pdf);
  return worker;
}

/** Receives a whole file over the resume port; the header and the bytes. */
async function receive(port: FakePortPeer): Promise<{ header: Record<string, unknown>; bytes: Uint8Array }> {
  await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(1));
  const header = port.received[0] as Record<string, unknown>;
  expect(header.type).toBe('resume/header');
  const parts: Uint8Array[] = [];
  for (let index = 0; index < (header.chunkCount as number); index += 1) {
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(2 + index));
    const chunk = port.received[1 + index] as { data: string };
    parts.push(Uint8Array.from(atob(chunk.data), (character) => character.charCodeAt(0)));
    port.post({ v: 1, type: 'resume/ack', index });
  }
  await vi.waitFor(() => expect(port.received.at(-1)).toEqual({ v: 1, type: 'resume/end' }));
  port.post({ v: 1, type: 'resume/done', ok: true });
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { header, bytes };
}

describe('the run’s cover letter’s words, for a cover-letter text box (v3 Phase 3b review)', () => {
  const WORDS = 'Dear Northwind team, I would like to apply.';
  /** A run letter over a server whose letter is ready at once, and whose text reads answer from `texts` in order (the
   *  last one repeats); `states` answers the state check before the retry. */
  async function wordsOf(texts: Array<ServerResult<{ text: string }>>, states: Array<ServerResult<{ state: 'ready'
    | 'generating' | 'failed' }>> = [ok({ state: 'ready' })]) {
    const timers = manualTimers();
    let reads = 0;
    let checks = 0;
    const server = {
      coverLetter: async () => letter('ready', false),
      coverLetterState: async () => states[Math.min(checks++, states.length - 1)]!,
      coverLetterText: async () => texts[Math.min(reads++, texts.length - 1)]!,
    };
    const run = createRunLetter({ server, timers, now: () => 0 });
    run.ask({ ...ASK, generate: false });
    run.wait(['box' as FieldKey], {} as never, true);
    for (let step = 0; step < 20; step += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      timers.advance(LETTER_POLL_MS);
    }
    await run.idle();
    return { input: run.input(), reads, checks, state: run.state('box' as FieldKey) };
  }

  it('reads them once when the letter is ready', async () => {
    const read = await wordsOf([ok({ text: WORDS })]);
    expect(read).toMatchObject({ reads: 1, checks: 0, state: 'done', input: { state: 'ready', text: WORDS } });
    expect(read.input).not.toHaveProperty('textUnavailable');
  });

  it('reads them once more after a 409 or a failure, once the letter is ready again', async () => {
    for (const failed of [refused('conflict', { status: 409 }), refused('server-error', { status: 503 }),
      refused('timeout')]) {
      const read = await wordsOf([failed, ok({ text: WORDS })]);
      expect(read, failed.ok ? '' : failed.failure).toMatchObject({ reads: 2, checks: 1, state: 'done',
        input: { state: 'ready', text: WORDS } });
    }
  });

  it('gives up after the one retry, or when the letter is not ready again, or on a refusal no retry changes', async () => {
    const twice = await wordsOf([refused('conflict', { status: 409 })]);
    expect(twice).toMatchObject({ reads: 2, input: { textUnavailable: true } });
    const notReady = await wordsOf([refused('conflict', { status: 409 })], [ok({ state: 'generating' })]);
    expect(notReady).toMatchObject({ reads: 1, checks: 1, input: { textUnavailable: true } });
    const forbidden = await wordsOf([refused('forbidden', { status: 403 })]);
    expect(forbidden).toMatchObject({ reads: 1, checks: 0, input: { textUnavailable: true } });
  });
});

describe('the run’s cover letter', () => {
  it('is asked once, with the lookup’s job and the frame’s posting text, then planned again and sent as a PDF', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const pdf = fakePdf(RESUME_CHUNK_BYTES + 500);
    const worker = await writingWorker(pdf);
    const runId = await beginRun(worker);
    const first = await plan(worker, runId);
    expect(first).toMatchObject({ ok: true, data: { writes: [], awaiting: [LETTER.key],
      results: [{ key: LETTER.key, reason: 'cover-letter-waiting' }] } });
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(2));
    // The check first, then the ask that may write, with the frame's posting text and canaries.
    expect(posted(worker)).toEqual([{ ...JOB_ASK, generate: false },
      { ...JOB_ASK, jobText: POSTING, generate: true, canaries: ['I am LLM'] }]);
    // Still written: the key waits.
    expect(await poll(worker, runId)).toMatchObject({ ok: true, data: { writes: [], awaiting: [LETTER.key] } });
    await tick(worker);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data).toMatchObject({ awaiting: [],
      writes: [{ key: LETTER.key, value: { kind: 'file', ref: 'cover-letter' }, origin: { provenance: 'profile',
        path: 'coverLetter' } }], results: [{ key: LETTER.key, reason: 'cover-letter-written', status: 'verified' }] }));
    // A later plan of the run asks TailorIT nothing more.
    await plan(worker, runId);
    expect(posted(worker)).toHaveLength(2);

    const port = worker.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
    const { header, bytes } = await receive(port);
    expect(header).toEqual({ v: 1, type: 'resume/header', name: 'Cover Letter - Northwind.pdf', mime: 'application/pdf',
      size: pdf.byteLength, sha256: await sha256Hex(pdf), chunkCount: 2 });
    expect(bytes.byteLength === pdf.byteLength && bytes.every((byte, at) => byte === pdf[at])).toBe(true);
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    // Its id and the job's never left the worker: not in an answer to the frame, not in a log line.
    const toFrame = JSON.stringify([first, await poll(worker, runId), port.received]);
    expect(toFrame).not.toContain(LETTER_ID);
    expect(toFrame).not.toContain(String(goldens.lookup.job.id));
    expect(JSON.stringify(info.mock.calls)).not.toContain(LETTER_ID);
    expect(info.mock.calls.map((call) => call[0])).toContain('[tailorit-autofill] letter.ready');
  });

  it('marks the run’s record when TailorIT starts writing it, so a new worker still marks it as the AI’s', async () => {
    const worker = await writingWorker();
    const runId = await beginRun(worker);
    await plan(worker, runId);
    await vi.waitFor(async () => expect((await worker.platform.storage.session.get(`runs:${runId}`)) as Record<string, unknown>)
      .toMatchObject({ letterWritten: true }));
    // A new worker forgot the letter: the poll is expired, the frame plans it again, and TailorIT has it ready by now.
    const next = await restartTestWorker(worker, { core: letterCore() });
    next.tailorit.reply(POST, letterJson('ready', false));
    expect(await poll(next, runId)).toMatchObject({ ok: false, error: 'expired' });
    await plan(next, runId);
    await vi.waitFor(async () => expect((await poll(next, runId)).data?.results).toEqual([expect.objectContaining({
      reason: 'cover-letter-written' })]));
  });

  it('is never written by TailorIT’s AI in a profile-only run or a dry run, which ask for the person’s own', async () => {
    for (const [extra, dryRun] of [[{ noAi: true }, false], [{}, true]] as const) {
      const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
      worker.tailorit.reply(POST, { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } });
      const runId = await beginRun(worker, { dryRun });
      await plan(worker, runId, [LETTER], dryRun ? { postingText: undefined } : extra);
      await vi.waitFor(() => expect(posted(worker)).toHaveLength(1));
      // Only a letter the person wrote is wanted: no page text, no canaries go.
      expect(posted(worker)[0]).toEqual({ jobId: goldens.lookup.job.id, company: goldens.lookup.job.companyName,
        jobTitle: goldens.lookup.job.title, resumeId: RESUME_ID, generate: false });
      await vi.waitFor(async () => expect((await poll(worker, runId)).data?.results).toEqual([expect.objectContaining({
        reason: 'cover-letter-none' })]));
    }
  });

  it('is asked for a posting TailorIT does not have with the page’s own names, and not at all without them', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: null, application: null, match: null } });
    worker.tailorit.reply(POST, letterJson('ready', false));
    const runId = await beginRun(worker);
    await plan(worker, runId, [LETTER], { posting: { company: 'Fabrikam', title: 'Site Reliability Engineer' } });
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(1));
    expect(posted(worker)[0]).toEqual({ company: 'Fabrikam', jobTitle: 'Site Reliability Engineer', resumeId: RESUME_ID,
      generate: false });

    const bare = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    bare.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: null, application: null, match: null } });
    const bareRun = await beginRun(bare);
    await plan(bare, bareRun);
    await vi.waitFor(async () => expect((await poll(bare, bareRun)).data?.results).toEqual([expect.objectContaining({
      reason: 'cover-letter-unavailable' })]));
    expect(posted(bare)).toEqual([]);
  });

  it('leaves the field flagged with why: failed, refused, past the cap', async () => {
    const failed = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    failed.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('generating')));
    failed.tailorit.reply(STATE, { json: { state: 'failed' } });
    const failedRun = await beginRun(failed);
    await plan(failed, failedRun);
    await tick(failed);
    await vi.waitFor(async () => expect((await poll(failed, failedRun)).data?.results).toEqual([expect.objectContaining({
      reason: 'cover-letter-failed' })]));

    const old = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    old.tailorit.reply(POST, { status: 403, json: { error: { code: 'forbidden', message: 'Connect the extension again.' } } });
    const oldRun = await beginRun(old);
    await plan(old, oldRun);
    await vi.waitFor(async () => expect((await poll(old, oldRun)).data?.results).toEqual([expect.objectContaining({
      reason: 'cover-letter-reconnect' })]));

    const slow = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    slow.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('generating')));
    slow.tailorit.reply(STATE, { json: { state: 'generating' } });
    const slowRun = await beginRun(slow);
    await plan(slow, slowRun);
    for (let waited = 0; waited <= LETTER_CAP_MS; waited += LETTER_POLL_MS) await tick(slow);
    await vi.waitFor(async () => expect((await poll(slow, slowRun)).data?.results).toEqual([expect.objectContaining({
      reason: 'cover-letter-timed-out' })]));
  });

  it('sends its file only once it is ready, as a PDF whose hash is TailorIT’s, and never in a dry run', async () => {
    const worker = await writingWorker();
    const runId = await beginRun(worker);
    const early = worker.connect('resume', contentSender());
    early.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
    await vi.waitFor(() => expect(early.received).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]));
    await plan(worker, runId);
    await tick(worker);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data?.writes).toHaveLength(1));
    // Bytes whose hash is not TailorIT's, and a file TailorIT does not call a PDF, are refused.
    for (const reply of [await fileReply(fakePdf(900), 'pdf', 'a'.repeat(64)), await fileReply(fakePdf(900), 'docx')]) {
      worker.tailorit.reply(FILE, reply, { once: true });
      const port = worker.connect('resume', contentSender());
      port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
      await vi.waitFor(() => expect(port.received).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]));
    }

    const dry = await writingWorker();
    const dryRun = await beginRun(dry, { dryRun: true });
    const port = dry.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId: dryRun, document: 'cover-letter' });
    await vi.waitFor(() => expect(port.received).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]));
    expect(dry.tailorit.count(FILE)).toBe(0);
  });

  it('goes with the token: a letter asked for with the old one is never sent', async () => {
    const worker = await writingWorker();
    const runId = await beginRun(worker);
    await plan(worker, runId);
    await tick(worker);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data?.writes).toHaveLength(1));
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender());
    const port = worker.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
    await vi.waitFor(() => expect(port.received).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]));
    expect(worker.tailorit.count(FILE)).toBe(0);
  });
});

describe('the run’s cover letter: who wrote it, and a worker that restarted (the Phase G review)', () => {
  it('is the AI’s when TailorIT says so, though written before the run: never attached once the run is profile-only',
    async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
      // An untouched letter the AI wrote earlier: the check does not answer it, the ask that may write answers it ready.
      worker.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('ready', true)));
      await sendsFile(worker, fakePdf(900));
      const runId = await beginRun(worker);
      await plan(worker, runId);
      await vi.waitFor(() => expect(posted(worker)).toHaveLength(2));
      // The run turned profile-only meanwhile (its form holds an "I did not use AI" statement): its next plan and the
      // poll of the key that waited flag the field, and nothing is attached.
      const later = await plan(worker, runId, [LETTER], { noAi: true });
      expect(later.data).toMatchObject({ writes: [], results: [{ key: LETTER.key, reason: 'ai-off-for-posting',
        status: 'flagged' }] });
      expect((await poll(worker, runId)).data).toMatchObject({ writes: [], awaiting: [],
        results: [{ key: LETTER.key, reason: 'ai-off-for-posting', status: 'flagged' }] });
      expect(posted(worker)).toHaveLength(2);
      expect(worker.tailorit.count(FILE)).toBe(0);
    });

  it('checks again for the person’s own letter after a restart between the plan and the upload, and sends it',
    async () => {
      const pdf = fakePdf(900);
      const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
      worker.tailorit.reply(POST, letterJson('ready', false));
      await sendsFile(worker, pdf);
      const runId = await beginRun(worker);
      await plan(worker, runId);
      await vi.waitFor(async () => expect((await poll(worker, runId)).data?.results).toEqual([expect.objectContaining({
        reason: 'cover-letter-attached' })]));
      // The worker is stopped before the frame asks for the file: its memory, the letter's id with it, is gone.
      const next = await restartTestWorker(worker, { core: letterCore() });
      const port = next.connect('resume', contentSender());
      port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
      const { header, bytes } = await receive(port);
      expect(header).toMatchObject({ type: 'resume/header', name: 'Cover Letter - Northwind.pdf', size: pdf.byteLength });
      expect(bytes.byteLength).toBe(pdf.byteLength);
      // Only checks: generate false, no page text, nothing written.
      expect(posted(next)).toEqual([{ ...JOB_ASK, generate: false }, { ...JOB_ASK, generate: false }]);
    });

  it('never writes one after a restart: a letter the AI wrote is not the person’s, so the upload has none', async () => {
    const worker = await writingWorker();
    const runId = await beginRun(worker);
    await plan(worker, runId);
    await tick(worker);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data?.writes).toHaveLength(1));
    const next = await restartTestWorker(worker, { core: letterCore() });
    const port = next.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
    await vi.waitFor(() => expect(port.received).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]));
    expect(posted(next).slice(2)).toEqual([{ ...JOB_ASK, generate: false }]);
    expect(next.tailorit.count(FILE)).toBe(0);
  });
});

// ── The side panel's row ──────────────────────────────────────────────────────────────────────────────────────────

/** A connected worker whose tab 7 shows a form that relays the card and sends `posting` as its job text. */
async function withForm(posting: { text: string; canaries: string[]; policy?: boolean; attestation?: true;
  names?: { company: string; title: string } } | null = { text: POSTING, canaries: ['I am LLM'] },
options: { core?: ReturnType<typeof letterCore> } = {}): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), ...options });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    // null: the frame cannot answer (its page is gone, or it is busy).
    if (message.type === 'job/postingText') return posting === null ? { ok: false, error: 'expired' }
      : { ok: true, data: { policy: false, ...posting } };
    return { ok: true, data: {} };
  };
  return worker;
}

const row = (worker: TestWorker, write = false) =>
  worker.deliver({ v: 1, type: 'panel/letter', tabId: 7, write }, pageSender()) as Promise<{ ok: boolean;
    data?: { outcome: string } }>;
const sentToFrame = (worker: TestWorker, type: string) => worker.fakes.tabMessages
  .filter((sent) => (sent.message as { type?: string }).type === type);

describe('the job card’s cover-letter row (panel/letter)', () => {
  it('says whether the person has a letter for the job, writes nothing, and asks once per card', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, letterJson('ready', false));
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'yours' } });
    expect(posted(worker)).toEqual([{ jobId: goldens.lookup.job.id, company: goldens.lookup.job.companyName,
      jobTitle: goldens.lookup.job.title, resumeId: RESUME_ID, generate: false }]);
    // A job TailorIT has needs no page text to ask.
    expect(sentToFrame(worker, 'job/postingText')).toEqual([]);
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'yours' } });
    expect(posted(worker)).toHaveLength(1);

    const none = await withForm();
    none.tailorit.reply(POST, { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } });
    expect(await row(none)).toEqual({ ok: true, data: { outcome: 'none' } });
  });

  it('writes one now with the posting’s visible text and canaries: Writing… then written', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('generating')));
    worker.tailorit.reply(STATE, { json: { state: 'ready' } });
    const pending = row(worker, true);
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(2));
    expect(posted(worker)).toEqual([{ ...JOB_ASK, generate: false },
      { ...JOB_ASK, jobText: POSTING, generate: true, canaries: ['I am LLM'] }]);
    await tick(worker);
    expect(await pending).toEqual({ ok: true, data: { outcome: 'written' } });
    // Kept for the card: the row reads it back with nothing asked.
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'written' } });
    expect(posted(worker)).toHaveLength(2);
  });

  it('Write it now, then a fill: the fill attaches that letter as the AI’s (cover-letter-written)', async () => {
    const worker = await withForm(undefined, { core: letterCore() });
    let written = false;
    worker.tailorit.reply(POST, (request) => {
      if ((JSON.parse(request.body!) as { generate: boolean }).generate !== true) return NONE_REPLY;
      // TailorIT writes it on the first ask that may write; from then on it is the AI's letter, ready, never edited.
      const reply = letterJson(written ? 'ready' : 'generating', true);
      written = true;
      return reply;
    });
    worker.tailorit.reply(STATE, { json: { state: 'ready' } });
    const pending = row(worker, true);
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(2));
    await tick(worker);
    expect(await pending).toEqual({ ok: true, data: { outcome: 'written' } });

    const runId = await beginRun(worker);
    await plan(worker, runId);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data).toMatchObject({ awaiting: [],
      writes: [{ key: LETTER.key, value: { kind: 'file', ref: 'cover-letter' } }],
      results: [{ key: LETTER.key, reason: 'cover-letter-written', status: 'verified' }] }));
    // The fill's check found none of the person's; its ask answered the letter written above, writing nothing more.
    expect(posted(worker).slice(2).map((body) => body.generate)).toEqual([false, true]);
    expect(worker.tailorit.count(STATE)).toBe(1);
  });

  it('writes nothing with AI-written answers off, or where the posting forbids AI in profile-only mode', async () => {
    const off = await withForm();
    await off.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false } } }, pageSender());
    expect(await row(off, true)).toEqual({ ok: true, data: { outcome: 'ai-off' } });
    const forbidden = await withForm({ text: POSTING, canaries: [], policy: true });
    expect(await row(forbidden, true)).toEqual({ ok: true, data: { outcome: 'ai-off' } });
    // A run of the tab that went profile-only says so too, whatever the page reads now.
    const ranProfileOnly = await withForm();
    const runId = await beginRun(ranProfileOnly);
    await ranProfileOnly.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0,
      { notices: [{ code: 'policy-profile-only' }] }) }, contentSender());
    expect(await row(ranProfileOnly, true)).toEqual({ ok: true, data: { outcome: 'ai-off' } });
    expect([...posted(off), ...posted(forbidden), ...posted(ranProfileOnly)]).toEqual([]);
  });

  it('writes nothing where the form states “I did not use AI”, unless the setting is to use the AI anyway', async () => {
    const attested = await withForm({ text: POSTING, canaries: [], attestation: true });
    expect(await row(attested, true)).toEqual({ ok: true, data: { outcome: 'ai-off' } });
    expect(posted(attested)).toEqual([]);
    const anyway = await withForm({ text: POSTING, canaries: [], attestation: true });
    await anyway.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, whenForbidden: 'use-ai' } } }, pageSender());
    anyway.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('ready', true)));
    expect(await row(anyway, true)).toEqual({ ok: true, data: { outcome: 'written' } });
  });

  it('writes nothing where the form’s page cannot be read, nor in the tab’s dry run', async () => {
    const unread = await withForm(null);
    expect(await row(unread, true)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    expect(posted(unread)).toEqual([]);
    // A dry run writes nothing: its card offers no Write it now, and one that comes anyway is refused.
    const dry = await withForm();
    dry.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('generating')));
    const runId = await beginRun(dry, { dryRun: true });
    await dry.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { mode: 'dry-run' }) },
      contentSender());
    expect(await row(dry, true)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    expect(posted(dry).filter((body) => body.generate === true)).toEqual([]);
    // Its check for the person's own letter still answers.
    expect(await row(dry)).toEqual({ ok: true, data: { outcome: 'none' } });
  });

  it('leaves Write it now to the person under "Ask me each time", and writes under "Use AI anyway"', async () => {
    for (const whenForbidden of ['ask', 'use-ai'] as const) {
      const worker = await withForm({ text: POSTING, canaries: [], policy: true });
      await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
        llm: { ...DEFAULT_SETTINGS.llm, whenForbidden } } }, pageSender());
      worker.tailorit.reply(POST, byGenerate(NONE_REPLY, letterJson('ready', false)));
      expect(await row(worker, true), whenForbidden).toEqual({ ok: true, data: { outcome: 'yours' } });
      expect(posted(worker).map((body) => body.generate), whenForbidden).toEqual([false, true]);
    }
  });

  it('asks for a posting TailorIT lacks with the page’s own names', async () => {
    const worker = await withForm({ text: POSTING, canaries: [], names: { company: 'Fabrikam', title: 'SRE' } });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: null, application: null, match: null } });
    worker.tailorit.reply(POST, { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } });
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'none' } });
    expect(posted(worker)).toEqual([{ company: 'Fabrikam', jobTitle: 'SRE', resumeId: RESUME_ID, generate: false }]);
  });

  it('says not-connected, rate-limited and unavailable as such, and never an id', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, { status: 429, json: { error: { code: 'rate_limited', message: 'Slow down.' } } });
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'rate-limited' } });
    worker.tailorit.reply(POST, { status: 503, json: { error: { code: 'ai_unavailable', message: 'Off.' } } });
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'unavailable' } });
    const disconnected = await startTestWorker();
    expect(await row(disconnected)).toEqual({ ok: true, data: { outcome: 'not-connected' } });
  });
});
