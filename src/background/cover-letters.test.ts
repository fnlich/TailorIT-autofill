/*
 * Cover letters in the worker (Phase G; cover-letters.ts, planner.ts, resume-transfer.ts): what asking TailorIT sends
 * and how its answers end (ready, written now, failed, none, refused, the cap), one ask per run with the lookup's job
 * held in the worker's memory, the letter planned again once settled, its PDF sent over the resume port as a resume is
 * (PDF only, its hash checked), nothing generated in a dry run or a profile-only run, the side panel's row (panel/letter),
 * and no letter id, job id or word of a letter in any message to a frame or any log line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOFILL_COVER_LETTER_LIMITS } from '../contract/tailorit';
import type { FieldKey, FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { RESUME_CHUNK_BYTES } from '../messaging/schemas';
import type { FakePortPeer } from '../platform/fake';
import { fetchLetter, letterRequestOf, LETTER_CAP_MS, LETTER_POLL_MS, type LetterAsk } from './cover-letters';
import { dispositionName, type ServerResult } from './server-client';
import { manualTimers } from './timers';
import {
  beginRun, contentSender, fakePdf, fieldSpec, fileReply, frameReport, goldens, letterCore, pageSender, restartTestWorker,
  sha256Hex, startTestWorker, tokenRecord, type TestWorker,
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
function scriptedServer(posts: Array<Reply<{ letterId: string; state: 'ready' | 'generating' | 'failed' }>>,
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
const refused = (failure: 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'server-error' | 'timeout',
  extra: { code?: string; retryAfterSeconds?: number; status?: number } = {}): ServerResult<never> => ({ ok: false, failure,
  ...extra });

const ASK: LetterAsk = { jobId: 4821, company: 'Northwind', jobTitle: 'Senior Backend Engineer', jobText: POSTING,
  resumeId: RESUME_ID, generate: true, canaries: ['I am LLM', 'x'] };

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

  it('takes a ready letter as it is: the person’s own', async () => {
    const server = scriptedServer([ok({ letterId: LETTER_ID, state: 'ready' })]);
    expect(await asked(server)).toEqual({ state: 'ready', letterId: LETTER_ID, aiWritten: false });
    expect(server.polled).toBe(0);
  });

  it('polls a letter being written until it is ready: the AI’s, written during this run', async () => {
    const onWriting = vi.fn();
    const server = scriptedServer([ok({ letterId: LETTER_ID, state: 'generating' })],
      [ok({ state: 'generating' }), refused('server-error'), ok({ state: 'ready' })]);
    expect(await asked(server, ASK, { onWriting })).toEqual({ state: 'ready', letterId: LETTER_ID, aiWritten: true });
    expect(server.polled).toBe(3);
    expect(onWriting).toHaveBeenCalledOnce();
  });

  it('marks a ready letter as the AI’s when this run had TailorIT start writing it (a worker that restarted)', async () => {
    const server = scriptedServer([ok({ letterId: LETTER_ID, state: 'ready' })]);
    expect(await asked(server, { ...ASK, written: true })).toMatchObject({ state: 'ready', aiWritten: true });
  });

  it('ends with why there is none', async () => {
    expect(await asked(scriptedServer([ok({ letterId: LETTER_ID, state: 'failed' })])))
      .toEqual({ state: 'none', reason: 'cover-letter-failed' });
    expect(await asked(scriptedServer([ok({ letterId: LETTER_ID, state: 'generating' })], [ok({ state: 'failed' })])))
      .toEqual({ state: 'none', reason: 'cover-letter-failed' });
    expect(await asked(scriptedServer([refused('not-found')]), { ...ASK, generate: false }))
      .toEqual({ state: 'none', reason: 'cover-letter-none' });
    // With generate, a 404 is a job or a resume that is not there.
    expect(await asked(scriptedServer([refused('not-found')]))).toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    expect(await asked(scriptedServer([refused('forbidden')]))).toEqual({ state: 'none', reason: 'cover-letter-reconnect' });
    expect(await asked(scriptedServer([refused('server-error', { code: 'ai_unavailable', status: 503 })])))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
    // generating answered to generate false breaks the contract: never taken as the person's.
    expect(await asked(scriptedServer([ok({ letterId: LETTER_ID, state: 'generating' })]), { ...ASK, generate: false }))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
  });

  it('asks again past ai_busy and a 429, within the cap', async () => {
    const server = scriptedServer([refused('conflict', { code: 'ai_busy' }), refused('rate-limited', { retryAfterSeconds: 3 }),
      ok({ letterId: LETTER_ID, state: 'ready' })]);
    expect(await asked(server)).toMatchObject({ state: 'ready' });
    expect(server.sent).toHaveLength(3);
    // The side panel would rather say so than wait.
    expect(await asked(scriptedServer([refused('rate-limited')]), ASK, { waitOnLimit: false }))
      .toEqual({ state: 'none', reason: 'cover-letter-unavailable', limited: true });
  });

  it(`gives a letter still being written up after ${LETTER_CAP_MS / 1000} s`, async () => {
    const server = scriptedServer([ok({ letterId: LETTER_ID, state: 'generating' })], [ok({ state: 'generating' })]);
    expect(await asked(server)).toEqual({ state: 'none', reason: 'cover-letter-timed-out' });
    expect(server.polled).toBeLessThanOrEqual(LETTER_CAP_MS / LETTER_POLL_MS);
    expect(server.polled).toBeGreaterThan(LETTER_CAP_MS / LETTER_POLL_MS - 3);
  });

  it('asks nothing without a resume, or for a posting TailorIT lacks whose page names nothing', async () => {
    const server = scriptedServer([ok({ letterId: LETTER_ID, state: 'ready' })]);
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

/** A worker whose TailorIT writes the letter (generating, then ready at the first poll) and sends `pdf` for it. */
async function writingWorker(pdf = fakePdf(RESUME_CHUNK_BYTES + 500)): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
  worker.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'generating' } });
  worker.tailorit.reply(STATE, { json: { state: 'ready' } });
  const file = await fileReply(pdf);
  worker.tailorit.reply(FILE, { ...file, headers: { ...('headers' in file ? file.headers : {}),
    'Content-Disposition': `attachment; filename="Cover Letter - Northwind.pdf"; filename*=UTF-8''Cover%20Letter%20-%20Northwind.pdf` } });
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

describe('the run’s cover letter', () => {
  it('is asked once, with the lookup’s job and the frame’s posting text, then planned again and sent as a PDF', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const pdf = fakePdf(RESUME_CHUNK_BYTES + 500);
    const worker = await writingWorker(pdf);
    const runId = await beginRun(worker);
    const first = await plan(worker, runId);
    expect(first).toMatchObject({ ok: true, data: { writes: [], awaiting: [LETTER.key],
      results: [{ key: LETTER.key, reason: 'cover-letter-waiting' }] } });
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(1));
    expect(posted(worker)[0]).toEqual({ jobId: goldens.lookup.job.id, company: goldens.lookup.job.companyName,
      jobTitle: goldens.lookup.job.title, jobText: POSTING, resumeId: RESUME_ID, generate: true, canaries: ['I am LLM'] });
    // Still written: the key waits.
    expect(await poll(worker, runId)).toMatchObject({ ok: true, data: { writes: [], awaiting: [LETTER.key] } });
    await tick(worker);
    await vi.waitFor(async () => expect((await poll(worker, runId)).data).toMatchObject({ awaiting: [],
      writes: [{ key: LETTER.key, value: { kind: 'file', ref: 'cover-letter' }, origin: { provenance: 'profile',
        path: 'coverLetter' } }], results: [{ key: LETTER.key, reason: 'cover-letter-written', status: 'verified' }] }));
    // A later plan of the run asks TailorIT nothing more.
    await plan(worker, runId);
    expect(posted(worker)).toHaveLength(1);

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
    next.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'ready' } });
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
    worker.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'ready' } });
    const runId = await beginRun(worker);
    await plan(worker, runId, [LETTER], { posting: { company: 'Fabrikam', title: 'Site Reliability Engineer' } });
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(1));
    expect(posted(worker)[0]).toMatchObject({ company: 'Fabrikam', jobTitle: 'Site Reliability Engineer', generate: true });
    expect(posted(worker)[0]).not.toHaveProperty('jobId');

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
    failed.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'generating' } });
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
    slow.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'generating' } });
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

// ── The side panel's row ──────────────────────────────────────────────────────────────────────────────────────────

/** A connected worker whose tab 7 shows a form that relays the card and sends `posting` as its job text. */
async function withForm(posting: { text: string; canaries: string[]; policy?: boolean;
  names?: { company: string; title: string } } = { text: POSTING, canaries: ['I am LLM'] }): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    if (message.type === 'job/postingText') return { ok: true, data: { policy: false, ...posting } };
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
    worker.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'ready' } });
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
    worker.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'generating' } });
    worker.tailorit.reply(STATE, { json: { state: 'ready' } });
    const pending = row(worker, true);
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(1));
    expect(posted(worker)[0]).toEqual({ jobId: goldens.lookup.job.id, company: goldens.lookup.job.companyName,
      jobTitle: goldens.lookup.job.title, jobText: POSTING, resumeId: RESUME_ID, generate: true, canaries: ['I am LLM'] });
    await tick(worker);
    expect(await pending).toEqual({ ok: true, data: { outcome: 'written' } });
    // Kept for the card: the row reads it back with nothing asked.
    expect(await row(worker)).toEqual({ ok: true, data: { outcome: 'written' } });
    expect(posted(worker)).toHaveLength(1);
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

  it('leaves Write it now to the person under "Ask me each time", and writes under "Use AI anyway"', async () => {
    for (const whenForbidden of ['ask', 'use-ai'] as const) {
      const worker = await withForm({ text: POSTING, canaries: [], policy: true });
      await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
        llm: { ...DEFAULT_SETTINGS.llm, whenForbidden } } }, pageSender());
      worker.tailorit.reply(POST, { json: { letterId: LETTER_ID, state: 'ready' } });
      expect(await row(worker, true), whenForbidden).toEqual({ ok: true, data: { outcome: 'yours' } });
      expect(posted(worker)[0], whenForbidden).toMatchObject({ generate: true });
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
