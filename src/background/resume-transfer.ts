/*
 * The `resume` port (runtime.md §4.4, ARCHITECTURE "Resume transfer"). A content script opens it only when a planned
 * write targets a file field, and posts resume/request {runId}. The worker sends the resume the run chose
 * (resume-choice.ts, shared with the planner), refuses a legacy .doc before any fetch, fetches GET /resumes/:id/file (at most 10 MiB),
 * checks the bytes (a PDF starts with %PDF-; a DOCX has the ZIP signature and X-TailorIT-File-Kind: docx) and their
 * SHA-256 against X-TailorIT-Sha256, then sends a header and 256 KiB base64 chunks, each acknowledged before the next,
 * and resume/end. The bytes are released on resume/done, on an error or a disconnect, and at the latest 60 seconds
 * after the fetch; they are never stored or cached between transfers. A failed or timed-out fetch is
 * resume-unavailable.
 */
import { AUTOFILL_FILE_MIME_TYPES, AUTOFILL_RESUME_MAX_BYTES } from '../contract/tailorit';
import { RESUME_CHUNK_BYTES, ResumePortMessageSchema } from '../messaging/schemas';
import type { PortLike } from '../platform/types';
import { log } from '../shared/log';
import { PDF_SIGNATURE, startsWith, toBase64, ZIP_SIGNATURE } from './bytes';
import type { ProfileCache } from './profile-cache';
import { createResumeChooser, type ResumeChoice } from './resume-choice';
import type { FrameRef, RunRegistry } from './runs';
import type { ServerClient } from './server-client';
import type { Timers } from './timers';

/** The bytes are released at the latest this long after the fetch. */
export const RESUME_RELEASE_MS = 60_000;

type Refusal = 'resume-unavailable' | 'resume-transfer-failed' | 'resume-format-unsupported';

/** What the resume transfer needs. */
export interface ResumeTransferDeps {
  runs: RunRegistry;
  server: ServerClient;
  profiles: ProfileCache;
  timers: Timers;
  sha256(bytes: Uint8Array): Promise<string>;
}

/** The name the file is uploaded under: no path or control characters, the kind's extension, at most 255 characters. */
export function uploadName(fileName: string, kind: 'pdf' | 'docx'): string {
  const extension = `.${kind}`;
  let base = fileName.replace(/[\p{Cc}\p{Cf}\\/:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (base.toLowerCase().endsWith(extension)) base = base.slice(0, -extension.length).trim();
  base = base.replace(/[. ]+$/, '');
  return `${(base || 'Resume').slice(0, 255 - extension.length)}${extension}`;
}

/** The `resume` port's server: accept() serves one port. */
export function createResumeTransfer(deps: ResumeTransferDeps) {
  /** Which resume this run attaches: the one the planner attached, read from the run's memo (resume-choice.ts). */
  const choose = createResumeChooser(deps);

  /** Fetches and checks the file; the bytes, or why there are none. */
  async function fetchChecked(choice: ResumeChoice): Promise<{ bytes: Uint8Array; kind: 'pdf' | 'docx'; sha256: string } | Refusal> {
    const answer = await deps.server.resumeFile(choice.id, AUTOFILL_RESUME_MAX_BYTES);
    if (!answer.ok) return 'resume-unavailable';
    const { bytes, kind: sentKind, sha256: sentSha } = answer.value;
    const kind = sentKind ?? choice.fileKind;
    if (kind === 'doc') return 'resume-format-unsupported';
    const isPdf = kind === 'pdf' && startsWith(bytes, PDF_SIGNATURE);
    const isDocx = kind === 'docx' && sentKind === 'docx' && startsWith(bytes, ZIP_SIGNATURE);
    if ((!isPdf && !isDocx) || bytes.byteLength === 0) return 'resume-unavailable';
    if (sentSha === null || !/^[a-f0-9]{64}$/.test(sentSha)) return 'resume-unavailable';
    const sha256 = await deps.sha256(bytes);
    if (sha256 !== sentSha) return 'resume-unavailable';
    return { bytes, kind: isPdf ? 'pdf' : 'docx', sha256 };
  }

  /** Serves one port from a content script whose sender the caller checked; its request waits for `ready` first. */
  function accept(port: PortLike, from: FrameRef & { url: string }, ready: () => Promise<void> = () => Promise.resolve()): void {
    let phase: 'request' | 'preparing' | 'sending' | 'ending' | 'closed' = 'request';
    let bytes: Uint8Array | null = null;
    let next = 0;
    let chunkCount = 0;
    let cancelRelease: (() => void) | null = null;

    function release(): void {
      if (bytes !== null) log('resume.released');
      bytes = null;
      cancelRelease?.();
      cancelRelease = null;
    }

    function close(reason?: Refusal): void {
      if (phase === 'closed') return;
      phase = 'closed';
      release();
      try {
        if (reason) port.post({ v: 1, type: 'resume/error', reason });
        port.disconnect();
      } catch {
        // Already disconnected by the other side.
      }
    }

    /** Posts on the port; a port the other side has just closed ends the transfer instead of throwing. */
    function send(message: unknown): void {
      try {
        port.post(message);
      } catch {
        phase = 'closed';
        release();
      }
    }

    function sendChunk(index: number): void {
      if (bytes === null) return close('resume-transfer-failed');
      const data = toBase64(bytes.subarray(index * RESUME_CHUNK_BYTES, (index + 1) * RESUME_CHUNK_BYTES));
      send({ v: 1, type: 'resume/chunk', index, data });
    }

    async function start(runId: string): Promise<void> {
      phase = 'preparing';
      await ready();
      if (phase !== 'preparing') return;
      const run = await deps.runs.find(runId, from);
      if (phase !== 'preparing') return;
      if (run === null || run.dryRun) {
        log('resume.refused', { run: run !== null });
        return close('resume-unavailable');
      }
      const choice = await choose(run.runId, from.url);
      if (phase !== 'preparing') return;
      if (choice === null) {
        log('resume.refused', { choice: false });
        return close('resume-unavailable');
      }
      // A legacy Word file is refused before anything is fetched.
      if (choice.fileKind === 'doc') {
        log('resume.refused', { doc: true });
        return close('resume-format-unsupported');
      }
      const fetched = await fetchChecked(choice);
      if (phase !== 'preparing') return;
      if (typeof fetched === 'string') {
        log('resume.refused', { fetched: false });
        return close(fetched);
      }
      bytes = fetched.bytes;
      cancelRelease = deps.timers.after(RESUME_RELEASE_MS, () => close('resume-transfer-failed'));
      chunkCount = Math.ceil(fetched.bytes.byteLength / RESUME_CHUNK_BYTES);
      phase = 'sending';
      send({
        v: 1,
        type: 'resume/header',
        name: uploadName(choice.fileName, fetched.kind),
        mime: AUTOFILL_FILE_MIME_TYPES[fetched.kind],
        size: fetched.bytes.byteLength,
        sha256: fetched.sha256,
        chunkCount,
      });
      if (phase === 'sending') sendChunk(0);
    }

    port.onMessage((raw) => {
      const parsed = ResumePortMessageSchema.safeParse(raw);
      const message = parsed.success ? parsed.data : null;
      if (message?.type === 'resume/error') return close();
      if (phase === 'request' && message?.type === 'resume/request') {
        void start(message.runId).catch(() => close('resume-unavailable'));
        return;
      }
      if (phase === 'sending' && message?.type === 'resume/ack' && message.index === next) {
        next += 1;
        if (next < chunkCount) return sendChunk(next);
        phase = 'ending';
        send({ v: 1, type: 'resume/end' });
        return;
      }
      if (phase === 'ending' && message?.type === 'resume/done') {
        log('resume.sent', { chunks: chunkCount, ok: message.ok });
        return close();
      }
      log('resume.protocol-error');
      close('resume-transfer-failed');
    });
    port.onDisconnect(() => {
      if (phase === 'closed') return;
      phase = 'closed';
      release();
    });
  }

  return { accept };
}

/** The resume transfer, as index.ts wires it. */
export type ResumeTransfer = ReturnType<typeof createResumeTransfer>;
