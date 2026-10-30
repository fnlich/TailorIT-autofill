import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESUME_CHUNK_BYTES, RESUME_MAX_BYTES } from '../messaging/schemas';
import type { FakePortPeer } from '../platform/fake';
import { RESUME_RELEASE_MS, uploadName } from './resume-transfer';
import {
  beginRun,
  contentSender,
  fakeDocx,
  fakePdf,
  fileReply,
  goldens,
  LEVER_KEY,
  restartTestWorker,
  sha256Hex,
  startTestWorker,
  tokenRecord,
  type TestWorker,
} from './worker.testkit';

const RESUME_ID = goldens.lookup.suggestedResume.id;
const FILE_ROUTE = `GET /api/autofill/resumes/${RESUME_ID}/file`;
const DOCX_ID = '7d9f2b14-3e6a-4f80-b2c5-91e3a7d4f650';

type PortMessage = { type: string; [key: string]: unknown };

/** Begins a run, opens the resume port from the same frame and asks for the resume. */
async function request(worker: TestWorker, options: { dryRun?: boolean; runId?: string } = {}): Promise<FakePortPeer> {
  const runId = options.runId ?? (await beginRun(worker, { dryRun: options.dryRun ?? false }));
  const port = worker.connect('resume', contentSender());
  port.post({ v: 1, type: 'resume/request', runId });
  return port;
}

/** Waits until the worker has posted `count` messages on the port. */
async function received(port: FakePortPeer, count: number): Promise<PortMessage[]> {
  await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(count));
  return port.received as PortMessage[];
}

/** Lets queued port messages and promises settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Acknowledges every chunk as it comes, then confirms; answers the bytes the chunks carried. */
async function receiveAll(port: FakePortPeer): Promise<{ header: PortMessage; bytes: Uint8Array }> {
  const [header] = await received(port, 1);
  expect(header!.type).toBe('resume/header');
  const count = header!.chunkCount as number;
  const parts: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const messages = await received(port, 2 + index);
    const chunk = messages[1 + index]!;
    expect(chunk).toMatchObject({ type: 'resume/chunk', index });
    parts.push(Uint8Array.from(atob(chunk.data as string), (character) => character.charCodeAt(0)));
    port.post({ v: 1, type: 'resume/ack', index });
  }
  const messages = await received(port, 2 + count);
  expect(messages[1 + count]).toEqual({ v: 1, type: 'resume/end' });
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { header: header!, bytes };
}

afterEach(() => vi.restoreAllMocks());

describe('the resume transfer', () => {
  it('sends a header, then 256 KiB base64 chunks, each only after the last one was acknowledged', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const pdf = fakePdf(2 * RESUME_CHUNK_BYTES + 75_000);
    worker.tailorit.reply(FILE_ROUTE, await fileReply(pdf));
    const port = await request(worker);
    const [header, first] = await received(port, 2);
    expect(header).toEqual({
      v: 1,
      type: 'resume/header',
      name: goldens.lookup.suggestedResume.fileName,
      mime: 'application/pdf',
      size: pdf.byteLength,
      sha256: await sha256Hex(pdf),
      chunkCount: 3,
    });
    expect(first).toMatchObject({ type: 'resume/chunk', index: 0 });
    expect(atob(first!.data as string)).toHaveLength(RESUME_CHUNK_BYTES);
    // Nothing more until chunk 0 is acknowledged.
    await settle();
    await settle();
    expect(port.received).toHaveLength(2);
    port.post({ v: 1, type: 'resume/ack', index: 0 });
    const third = await received(port, 3);
    expect(third[2]).toMatchObject({ type: 'resume/chunk', index: 1 });
  });

  it('delivers the exact bytes, and releases them on resume/done', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const worker = await startTestWorker({ token: tokenRecord() });
    const pdf = fakePdf(RESUME_CHUNK_BYTES + 10);
    worker.tailorit.reply(FILE_ROUTE, await fileReply(pdf));
    const pendingBefore = worker.timers.pending;
    const port = await request(worker);
    const { bytes } = await receiveAll(port);
    expect([...bytes]).toEqual([...pdf]);
    // The 60-second release is armed while the worker holds the bytes...
    expect(worker.timers.pending).toBe(pendingBefore + 2);
    port.post({ v: 1, type: 'resume/done', ok: true });
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    // ...and cancelled once they are released.
    expect(worker.timers.pending).toBe(pendingBefore + 1);
    expect(info.mock.calls.map((call) => call[0])).toContain('[tailorit-autofill] resume.released');
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('Elena');
    expect(logged).not.toContain(await sha256Hex(pdf));
  });

  it('releases the bytes 60 seconds after the fetch at the latest', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(RESUME_CHUNK_BYTES * 2)));
    const port = await request(worker);
    await received(port, 2);
    worker.timers.advance(RESUME_RELEASE_MS - 1);
    expect(port.disconnectedByWorker).toBe(false);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    expect(port.received.at(-1)).toEqual({ v: 1, type: 'resume/error', reason: 'resume-transfer-failed' });
    expect(RESUME_RELEASE_MS).toBe(60_000);
  });

  it('releases the bytes when the content script disconnects or reports an error', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(RESUME_CHUNK_BYTES * 2)));
    const pending = worker.timers.pending;
    const gone = await request(worker);
    await received(gone, 2);
    gone.disconnect();
    await vi.waitFor(() => expect(worker.timers.pending).toBe(pending + 1));

    const refused = await request(worker);
    await received(refused, 2);
    refused.post({ v: 1, type: 'resume/error', reason: 'pdf-only-input' });
    await vi.waitFor(() => expect(refused.disconnectedByWorker).toBe(true));
    expect(worker.timers.pending).toBe(pending + 1);
  });

  it('ends the transfer on an acknowledgement out of order', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(RESUME_CHUNK_BYTES * 2)));
    const port = await request(worker);
    await received(port, 2);
    port.post({ v: 1, type: 'resume/ack', index: 1 });
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    expect(port.received.at(-1)).toEqual({ v: 1, type: 'resume/error', reason: 'resume-transfer-failed' });
  });

  it('refuses bytes whose SHA-256 is not the one TailorIT sent', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(), 'pdf', 'a'.repeat(64)));
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
  });

  it('refuses a legacy .doc before anything is fetched', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/lookup', {
      json: { ...goldens.lookup, suggestedResume: { ...goldens.lookup.suggestedResume, fileKind: 'doc', fileName: 'Old.doc' } },
    });
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-format-unsupported' }]);
    expect(worker.tailorit.count(FILE_ROUTE)).toBe(0);
  });

  it('refuses a file TailorIT itself sends as a .doc', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, await fileReply(fakeDocx(), 'doc'));
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-format-unsupported' }]);
  });

  it.each([
    ['a "PDF" that does not start with %PDF-', async () => fileReply(fakeDocx(), 'pdf')],
    ['a "DOCX" without the ZIP signature', async () => fileReply(fakePdf(), 'docx')],
    ['a DOCX without its kind header', async () => {
      const reply = await fileReply(fakeDocx(), 'docx');
      if ('headers' in reply && reply.headers) delete reply.headers['X-TailorIT-File-Kind'];
      return reply;
    }],
    ['an empty file', async () => fileReply(new Uint8Array(0), 'pdf')],
    ['a file without its SHA-256 header', async () => {
      const reply = await fileReply(fakePdf(), 'pdf');
      if ('headers' in reply && reply.headers) delete reply.headers['X-TailorIT-Sha256'];
      return reply;
    }],
  ])('refuses %s', async (name, reply) => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/lookup', {
      json: { ...goldens.lookup, suggestedResume: { ...goldens.lookup.suggestedResume, fileKind: name.includes('DOCX') ? 'docx' : 'pdf' } },
    });
    worker.tailorit.reply(FILE_ROUTE, await reply());
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
  });

  it('sends a DOCX with the ZIP signature and its kind header, under its Word name and type', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const docx = fakeDocx(5000);
    worker.tailorit.reply('POST /api/autofill/lookup', {
      json: { ...goldens.lookup, suggestedResume: { ...goldens.lookup.suggestedResume, id: DOCX_ID, fileKind: 'docx', fileName: 'Elena_Ruiz_CV.docx' } },
    });
    worker.tailorit.reply(`GET /api/autofill/resumes/${DOCX_ID}/file`, await fileReply(docx, 'docx'));
    const port = await request(worker);
    const { header, bytes } = await receiveAll(port);
    expect(header).toMatchObject({ name: 'Elena_Ruiz_CV.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 5000, chunkCount: 1 });
    expect([...bytes]).toEqual([...docx]);
  });

  it('refuses a file over 10 MiB, and sends one of exactly 10 MiB in 40 chunks', async () => {
    const over = await startTestWorker({ token: tokenRecord() });
    over.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(RESUME_MAX_BYTES + 1)));
    const refused = await request(over);
    expect(await received(refused, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);

    const exact = await startTestWorker({ token: tokenRecord() });
    exact.tailorit.reply(FILE_ROUTE, await fileReply(fakePdf(RESUME_MAX_BYTES)));
    const sent = await request(exact);
    const [header] = await received(sent, 1);
    expect(header).toMatchObject({ type: 'resume/header', size: RESUME_MAX_BYTES, chunkCount: 40 });
    sent.disconnect();
  });

  it.each([
    ['TailorIT fails', { status: 503, json: { error: { code: 'browser_unavailable', message: 'x' } } }],
    ['the network fails', { fail: 'network' as const }],
  ])('answers resume-unavailable when %s', async (_name, reply) => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, reply);
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
  });

  it('answers resume-unavailable when the fetch times out', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(FILE_ROUTE, { fail: 'hang' });
    const port = await request(worker);
    await vi.waitFor(() => expect(worker.tailorit.count(FILE_ROUTE)).toBe(1));
    worker.timeouts.at(-1)!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
  });

  it('attaches the profile\'s own resume when the lookup suggests none', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ats: null, job: null, application: null, suggestedResume: null } });
    worker.tailorit.reply('GET /api/autofill/profile', {
      json: { ...goldens.profile, profile: { ...goldens.profile.profile, documents: { resumeId: DOCX_ID } } },
    });
    const docx = fakeDocx(800);
    worker.tailorit.reply(`GET /api/autofill/resumes/${DOCX_ID}/file`, await fileReply(docx, 'docx'));
    const port = await request(worker);
    const { header } = await receiveAll(port);
    expect(header).toMatchObject({ name: 'Elena_Ruiz_CV.docx', size: 800 });
    expect(worker.tailorit.count('GET /api/autofill/resumes')).toBe(1);
  });

  it('answers resume-unavailable when there is no resume to attach', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ats: null, job: null, application: null, suggestedResume: null } });
    const port = await request(worker);
    expect(await received(port, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
    expect(worker.tailorit.requests.some((entry) => entry.path.endsWith('/file'))).toBe(false);
  });

  it('serves only the frame that began the run, and never a dry run', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const other = worker.connect('resume', contentSender({ frameId: 3 }));
    other.post({ v: 1, type: 'resume/request', runId });
    expect(await received(other, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
    const unknown = await request(worker, { runId: 'A'.repeat(22) });
    expect(await received(unknown, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
    const dry = await request(worker, { dryRun: true });
    expect(await received(dry, 1)).toEqual([{ v: 1, type: 'resume/error', reason: 'resume-unavailable' }]);
    expect(worker.tailorit.requests.some((entry) => entry.path.endsWith('/file'))).toBe(false);
  });

  it('still serves a run after the worker was stopped, looking the page up again', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const pdf = fakePdf(3000);
    worker.tailorit.reply(FILE_ROUTE, await fileReply(pdf));
    const runId = await beginRun(worker);
    expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(1);
    // The run's record survives in storage.session; its lookup was in the old worker's memory.
    const restarted = await restartTestWorker(worker);
    const port = await request(restarted, { runId });
    const { bytes } = await receiveAll(port);
    expect([...bytes]).toEqual([...pdf]);
    expect(restarted.tailorit.count('POST /api/autofill/lookup')).toBe(2);
    const relookup = restarted.tailorit.requests.filter((entry) => entry.path === '/api/autofill/lookup').at(-1)!;
    expect(JSON.parse(relookup.body!)).toEqual({ url: contentSender().url, includePostingText: false });
  });

  it('refuses a port from a page that is not an ATS frame, and any other port name', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const foreign = worker.connect('resume', contentSender({ url: 'https://example.com/apply' }));
    const misnamed = worker.connect('ai', contentSender());
    await vi.waitFor(() => expect(foreign.disconnectedByWorker && misnamed.disconnectedByWorker).toBe(true));
    expect(foreign.received).toEqual([]);
    expect(LEVER_KEY).toBe('lever:0123456789abcdef');
  });
});

describe('the upload name', () => {
  it.each([
    ['Elena Ruiz Resume.pdf', 'pdf', 'Elena Ruiz Resume.pdf'],
    ['Elena Ruiz Resume', 'pdf', 'Elena Ruiz Resume.pdf'],
    ['..\\..\\evil/name:?.pdf', 'pdf', '.. .. evil name.pdf'],
    ['CV.PDF', 'pdf', 'CV.pdf'],
    ['', 'docx', 'Resume.docx'],
    // A NUL and a right-to-left override, built at run time so no raw control character sits in the source.
    [`a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c.docx`, 'docx', 'a b c.docx'],
    [`${'x'.repeat(400)}.pdf`, 'pdf', `${'x'.repeat(251)}.pdf`],
  ] as const)('%j as %s is %j', (name, kind, expected) => {
    expect(uploadName(name, kind)).toBe(expected);
  });
});
