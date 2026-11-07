/*
 * v4 ui: the side panel's cover-letter preview over the `preview` port (preview/request {tabId, kind: 'coverLetter'};
 * resume-transfer.ts acceptPreview, index.ts previewLetterOf). It sends the letter the tab's fill attached (a run of the
 * tab whose letter is ready: no new ask) or would attach (the person's own letter for the tab's job, checked for with
 * generate false: nothing is written), as the resume port sends a letter: a PDF whose SHA-256 is TailorIT's, in
 * acknowledged chunks, to an extension page only; none is resume-unavailable. The letter's id never leaves the worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldKey } from '../core/types/field';
import type { FieldSpec } from '../core/types/field';
import type { FakePortPeer } from '../platform/fake';
import { LETTER_POLL_MS } from './cover-letters';
import {
  beginRun, contentSender, fakePdf, fieldSpec, fileReply, frameReport, goldens, letterCore, pageSender, sha256Hex,
  startTestWorker, tokenRecord, type RecordedRequest, type Reply, type TestWorker,
} from './worker.testkit';

const LETTER_ID = '9b2d4f6a-1c3e-4a5b-8d7f-0e2c4a6b8d10';
const POST = 'POST /api/autofill/cover-letters';
const STATE = `GET /api/autofill/cover-letters/${LETTER_ID}`;
const FILE = `GET /api/autofill/cover-letters/${LETTER_ID}/file`;
const LETTER = fieldSpec(1, { kind: 'file', label: 'Cover letter', key: 'lever|main|cover-letter|none|0' as FieldKey });
const NONE: Reply = { status: 404, json: { error: { code: 'not_found', message: 'Not found.' } } };
const letterJson = (state: 'ready' | 'generating', aiWritten: boolean): Reply => ({ json: { letterId: LETTER_ID, state, aiWritten } });
const generateOf = (request: RecordedRequest) => (JSON.parse(request.body!) as { generate: boolean }).generate;
const posted = (worker: TestWorker) => worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === POST);

afterEach(() => vi.restoreAllMocks());

/** A connected worker whose tab 7 shows a Lever form in frame 0, its card read (panel/job). */
async function withForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    return (await worker.deliver({ v: 1, type: 'job/lookup' }, contentSender())) as { ok: boolean; data: unknown };
  };
  await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender());
  return worker;
}

/** Opens the side panel's preview port and asks for the tab's cover letter. */
function askLetter(worker: TestWorker): FakePortPeer {
  const port = worker.connect('preview', pageSender());
  port.post({ v: 1, type: 'preview/request', tabId: 7, kind: 'coverLetter' });
  return port;
}

/** Receives a whole file over the port, acknowledging each chunk; the header and the bytes. */
async function receive(port: FakePortPeer): Promise<{ header: Record<string, unknown>; bytes: Uint8Array }> {
  await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(1));
  const header = port.received[0] as Record<string, unknown>;
  expect(header.type).toBe('resume/header');
  const parts: Uint8Array[] = [];
  for (let index = 0; index < (header.chunkCount as number); index += 1) {
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(2 + index));
    parts.push(Uint8Array.from(atob((port.received[1 + index] as { data: string }).data), (character) => character.charCodeAt(0)));
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

describe('the cover letter’s preview (v4 ui)', () => {
  it('sends the person’s own letter a fill would attach, checked with generate false, as a PDF in acknowledged chunks', async () => {
    const worker = await withForm();
    const pdf = fakePdf(1500);
    worker.tailorit.reply(POST, letterJson('ready', false));
    worker.tailorit.reply(FILE, await fileReply(pdf));
    const { header, bytes } = await receive(askLetter(worker));
    expect(header).toMatchObject({ mime: 'application/pdf', size: pdf.byteLength, sha256: await sha256Hex(pdf) });
    expect(bytes.every((byte, at) => byte === pdf[at])).toBe(true);
    // Only a check: nothing is written for a preview.
    expect(posted(worker).map(generateOf)).toEqual([false]);
    expect(JSON.parse(posted(worker)[0]!.body!)).toMatchObject({ jobId: goldens.lookup.job.id, generate: false });
    // A content script can never ask for it.
    expect(worker.connect('preview', contentSender()).disconnectedByWorker).toBe(true);
  });

  it('answers resume-unavailable when there is no letter, and refuses one that is not TailorIT’s PDF', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, NONE);
    const none = askLetter(worker);
    await vi.waitFor(() => expect(none.received).toContainEqual({ v: 1, type: 'resume/error', reason: 'resume-unavailable' }));
    worker.tailorit.reply(POST, letterJson('ready', false));
    worker.tailorit.reply(FILE, await fileReply(fakePdf(900), 'pdf', 'a'.repeat(64)));
    const forged = askLetter(worker);
    await vi.waitFor(() => expect(forged.received).toContainEqual({ v: 1, type: 'resume/error', reason: 'resume-unavailable' }));
    expect(JSON.stringify([none.received, forged.received])).not.toContain(LETTER_ID);
  });

  it('sends the letter a run of the tab attached, without asking TailorIT again', async () => {
    const worker = await withForm();
    const pdf = fakePdf(1200);
    // TailorIT has none of the person's, writes one for the run, ready at the first poll.
    worker.tailorit.reply(POST, (request) => (generateOf(request) ? letterJson('generating', true) : NONE));
    worker.tailorit.reply(STATE, { json: { state: 'ready' } });
    worker.tailorit.reply(FILE, await fileReply(pdf));
    const runId = await beginRun(worker);
    const specs: FieldSpec[] = [LETTER];
    const plan = () => worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
      canaries: [], notices: [], postingText: 'Northwind is hiring.' }, contentSender());
    await plan();
    await vi.waitFor(() => expect(posted(worker)).toHaveLength(2));
    for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
    worker.timers.advance(LETTER_POLL_MS);
    for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
    await vi.waitFor(async () => expect(((await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [LETTER.key] },
      contentSender())) as { data: { awaiting: string[] } }).data.awaiting).toEqual([]));
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { fields: [] }) }, contentSender());
    const asked = posted(worker).length;
    const { bytes } = await receive(askLetter(worker));
    expect(bytes.every((byte, at) => byte === pdf[at])).toBe(true);
    expect(posted(worker)).toHaveLength(asked);
  });
});
