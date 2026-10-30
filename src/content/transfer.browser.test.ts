import { describe, expect, it } from 'vitest';
import { deadline } from '../dom/time';
import { RESUME_CHUNK_BYTES } from '../messaging/schemas';
import { createFakeWorker, DOCX, fakePdf, sha256Of } from './content.testkit';
import { receiveResume } from './transfer';

const PDF_ONLY = (file: { name: string; type: string }) => file.type === 'application/pdf';
const ANYTHING = () => true;

describe('the resume transfer, the content side', () => {
  it('takes the header and every chunk in order, acknowledging each, and builds the File', async () => {
    const bytes = fakePdf(RESUME_CHUNK_BYTES * 2 + 1234);
    const worker = createFakeWorker({ resume: { bytes, name: 'Alex Rivera Resume.pdf', mime: 'application/pdf' } });
    const got = await receiveResume(worker.platform, { runId: 'run-1', accepts: PDF_ONLY });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const file = got.resume.file!;
    expect([file.name, file.type, file.size]).toEqual(['Alex Rivera Resume.pdf', 'application/pdf', bytes.length]);
    expect(await sha256Of(new Uint8Array(await file.arrayBuffer()))).toBe(await sha256Of(bytes));
    const fromContent = worker.portLog.filter((entry) => entry.from === 'content').map((entry) => entry.message);
    expect(fromContent).toEqual([
      { v: 1, type: 'resume/request', runId: 'run-1' },
      { v: 1, type: 'resume/ack', index: 0 },
      { v: 1, type: 'resume/ack', index: 1 },
      { v: 1, type: 'resume/ack', index: 2 },
      { v: 1, type: 'resume/done', ok: true },
    ]);
    got.resume.release();
  });

  it('starts again from scratch once when the hash does not match, and gives up after a second mismatch', async () => {
    const bytes = fakePdf(RESUME_CHUNK_BYTES + 10);
    const once = createFakeWorker({ resume: { bytes, name: 'r.pdf', mime: 'application/pdf', corrupt: 1 } });
    const retried = await receiveResume(once.platform, { runId: 'run-1', accepts: PDF_ONLY });
    expect(retried.ok).toBe(true);
    const requests = once.portLog.filter((entry) => entry.message.type === 'resume/request');
    expect(requests).toHaveLength(2);
    expect(once.portLog.filter((entry) => entry.from === 'content' && entry.message.type === 'resume/done')
      .map((entry) => entry.message.ok)).toEqual([false, true]);
    if (retried.ok) retried.resume.release();

    const always = createFakeWorker({ resume: { bytes, name: 'r.pdf', mime: 'application/pdf', corrupt: 5 } });
    expect(await receiveResume(always.platform, { runId: 'run-1', accepts: PDF_ONLY }))
      .toEqual({ ok: false, reason: 'resume-transfer-failed' });
    expect(always.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(2);
  });

  it('starts again when the worker goes away mid-way (a stopped worker)', async () => {
    const bytes = fakePdf(RESUME_CHUNK_BYTES * 3);
    const worker = createFakeWorker({ resume: { bytes, name: 'r.pdf', mime: 'application/pdf', dropAfterChunks: 2 } });
    const got = await receiveResume(worker.platform, { runId: 'run-1', accepts: PDF_ONLY });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.resume.file!.size).toBe(bytes.length);
    expect(worker.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(2);
  });

  it('answers a DOCX header for an input that takes PDF only with pdf-only-input, before any byte arrives', async () => {
    const worker = createFakeWorker({ resume: { bytes: fakePdf(RESUME_CHUNK_BYTES + 1), name: 'r.docx', mime: DOCX } });
    expect(await receiveResume(worker.platform, { runId: 'run-1', accepts: PDF_ONLY }))
      .toEqual({ ok: false, reason: 'pdf-only-input' });
    const fromContent = worker.portLog.filter((entry) => entry.from === 'content').map((entry) => entry.message);
    expect(fromContent).toEqual([{ v: 1, type: 'resume/request', runId: 'run-1' },
      { v: 1, type: 'resume/error', reason: 'pdf-only-input' }]);
  });

  it('takes the worker’s refusal as final', async () => {
    const worker = createFakeWorker({ resume: { bytes: fakePdf(10), name: 'r.pdf', mime: 'application/pdf',
      refuse: 'resume-unavailable' } });
    expect(await receiveResume(worker.platform, { runId: 'run-1', accepts: ANYTHING }))
      .toEqual({ ok: false, reason: 'resume-unavailable' });
    expect(worker.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(1);
  });

  it('releases the bytes when asked, and by itself once the release deadline passes', async () => {
    const worker = createFakeWorker({ resume: { bytes: fakePdf(2048), name: 'r.pdf', mime: 'application/pdf' } });
    const asked = await receiveResume(worker.platform, { runId: 'run-1', accepts: PDF_ONLY });
    if (!asked.ok) throw new Error('the transfer failed');
    expect(asked.resume.released).toBe(false);
    asked.resume.release();
    expect([asked.resume.released, asked.resume.file]).toEqual([true, null]);

    const unused = await receiveResume(worker.platform, { runId: 'run-1', accepts: PDF_ONLY, releaseAfterMs: 50 });
    if (!unused.ok) throw new Error('the transfer failed');
    expect(unused.resume.file).not.toBeNull();
    await deadline(120);
    expect([unused.resume.released, unused.resume.file]).toEqual([true, null]);
  });

  it('fails an attempt the worker leaves silent, and stops when the run is aborted', async () => {
    const silent = createFakeWorker({ resume: { bytes: fakePdf(10), name: 'r.pdf', mime: 'application/pdf' } });
    // A worker that never answers the request: each attempt times out, and the transfer fails after the retry.
    silent.platform.runtime.connect = () => {
      const port = { name: 'resume', post: () => undefined, onMessage: () => () => undefined,
        onDisconnect: () => () => undefined, disconnect: () => undefined };
      return port;
    };
    expect(await receiveResume(silent.platform, { runId: 'run-1', accepts: PDF_ONLY, idleMs: 20 }))
      .toEqual({ ok: false, reason: 'resume-transfer-failed' });

    const controller = new AbortController();
    const pending = receiveResume(silent.platform, { runId: 'run-1', accepts: PDF_ONLY, signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'resume-transfer-failed' });
  });
});
