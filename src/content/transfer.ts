/*
 * The resume transfer, the content script's side (docs/ARCHITECTURE.md "Resume transfer" and "Port resume";
 * docs/design/runtime.md §4.4). It runs only for a planned write to a file field.
 * - It opens the `resume` port and posts resume/request {runId}. The worker answers a header (name, type, size,
 *   SHA-256, chunk count), then 256 KiB base64 chunks, each sent only after the previous one's resume/ack, then
 *   resume/end. Each chunk is decoded straight into one buffer of the header's size; no base64 is kept.
 * - On resume/end the size and the SHA-256 (crypto.subtle) are checked, the File is built, and resume/done {ok: true}
 *   is posted. The buffer is zeroed as soon as the File holds the bytes.
 * - A DOCX header for an input that takes PDF only is answered resume/error {reason: 'pdf-only-input'}, before a single
 *   byte arrives, and the field is flagged pdf-only-input (a PDF for an input that refuses PDF: resume-format-unsupported).
 * - Any mismatch (size, hash, a chunk out of order or of the wrong length, bad base64, an unexpected message), a
 *   disconnect mid-way, or RESUME_IDLE_MS without a message discards the partial bytes and starts again from scratch,
 *   once; then the field is flagged resume-transfer-failed. A refusal from the worker (resume-unavailable,
 *   resume-format-unsupported) is final: asking again would get the same answer.
 * - The bytes are released when the caller is done with them (the input is set and verified), and at the latest
 *   RESUME_RELEASE_MS after the buffer was allocated. After that the File lives only in the page's FileList, which the
 *   upload needs. Nothing here is ever logged but codes and counts.
 * - Phase G: the same port carries the run's cover letter (ResumeRequest.document 'cover-letter', posted as the
 *   request's `document`), under every rule above; the worker sends only a PDF for it.
 */
import { DOCX_MIME } from '../dom/fillers';
import { monotonicNow, startDeadline, type Cancel } from '../dom/time';
import { RESUME_CHUNK_BYTES, RESUME_MAX_BYTES, ResumePortMessageSchema } from '../messaging/schemas';
import type { FileRef } from '../core/types/intent';
import type { ContentPlatform, PortLike } from '../platform/types';
import { log } from '../shared/log';

/** An attempt fails when the worker sends nothing for this long (its fetch alone may take up to 25 s). */
export const RESUME_IDLE_MS = 30_000;
/** The bytes are released at the latest this long after their buffer was allocated. */
export const RESUME_RELEASE_MS = 60_000;
/** A failed attempt is retried from scratch this many times. */
export const RESUME_RETRIES = 1;

/** The types the worker may send: a PDF, or a DOCX. */
const MIME_TYPES: ReadonlySet<string> = new Set(['application/pdf', DOCX_MIME]);

/** Why the resume could not be put into the field. */
export type ResumeFailure = 'resume-unavailable' | 'resume-transfer-failed' | 'resume-format-unsupported'
  | 'pdf-only-input';

/** A resume that arrived whole: the File, until it is released. */
export interface ReceivedResume {
  /** The File, or null once released. */
  readonly file: File | null;
  readonly released: boolean;
  /** Drops the bytes. Calling it again is harmless. */
  release(): void;
}

/** What a transfer needs. */
export interface ResumeRequest {
  runId: string;
  /** What the write takes: the run's resume (the default) or its cover letter (Phase G). */
  document?: FileRef;
  /** Whether the file input takes a file of this name and type (its accept list). */
  accepts(file: { name: string; type: string }): boolean;
  signal?: AbortSignal;
  /** Overrides, for tests. */
  idleMs?: number;
  releaseAfterMs?: number;
}

type Attempt = { ok: true; resume: ReceivedResume } | { ok: false; reason: ResumeFailure; final: boolean };

/** Receives the run's resume over the `resume` port, retrying once from scratch. */
export async function receiveResume(platform: ContentPlatform, request: ResumeRequest):
  Promise<{ ok: true; resume: ReceivedResume } | { ok: false; reason: ResumeFailure }> {
  for (let attempt = 0; attempt <= RESUME_RETRIES; attempt += 1) {
    if (request.signal?.aborted) return { ok: false, reason: 'resume-transfer-failed' };
    const result = await attemptTransfer(platform, request);
    if (result.ok) return result;
    if (result.final) return { ok: false, reason: result.reason };
    if (attempt < RESUME_RETRIES) log('content.resume-retried', { attempt: attempt + 1 });
  }
  log('content.resume-failed');
  return { ok: false, reason: 'resume-transfer-failed' };
}

/** The lower-case hex SHA-256 of `bytes`. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Decodes base64 into `target` at `offset`; answers how many bytes it wrote, or -1 for bad base64 or an overflow. */
function decodeInto(data: string, target: Uint8Array, offset: number): number {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return -1;
  }
  if (offset + binary.length > target.length) return -1;
  for (let i = 0; i < binary.length; i += 1) target[offset + i] = binary.charCodeAt(i);
  return binary.length;
}

/** One attempt at the whole transfer. */
function attemptTransfer(platform: ContentPlatform, request: ResumeRequest): Promise<Attempt> {
  return new Promise((resolve) => {
    let port: PortLike;
    try {
      port = platform.runtime.connect('resume');
    } catch {
      resolve({ ok: false, reason: 'resume-transfer-failed', final: false });
      return;
    }
    let settled = false;
    let header: { name: string; mime: string; size: number; sha256: string; chunkCount: number } | null = null;
    let buffer: Uint8Array<ArrayBuffer> | null = null;
    let next = 0;
    let received = 0;
    let allocatedAt = 0;
    let checking = false;
    let cancelIdle: Cancel = () => undefined;
    let cancelRelease: Cancel = () => undefined;
    const unlisten: Array<() => void> = [];

    const discard = () => {
      buffer?.fill(0);
      buffer = null;
    };
    const finish = (result: Attempt, farewell?: unknown) => {
      if (settled) return;
      settled = true;
      cancelIdle();
      if (!result.ok) {
        cancelRelease();
        discard();
      }
      for (const stop of unlisten) stop();
      request.signal?.removeEventListener('abort', onAbort);
      try {
        if (farewell !== undefined) port.post(farewell);
      } catch {
        // The worker has already gone.
      }
      try {
        port.disconnect();
      } catch {
        // Already disconnected.
      }
      resolve(result);
    };
    const fail = (reason: ResumeFailure, final: boolean, farewell?: unknown) => finish({ ok: false, reason, final }, farewell);
    const protocolError = () => fail('resume-transfer-failed', false,
      { v: 1, type: 'resume/error', reason: 'resume-transfer-failed' });
    const idle = () => {
      cancelIdle();
      cancelIdle = startDeadline(request.idleMs ?? RESUME_IDLE_MS, () => fail('resume-transfer-failed', false),
        request.signal);
    };
    const onAbort = () => fail('resume-transfer-failed', true, { v: 1, type: 'resume/error', reason: 'resume-transfer-failed' });

    unlisten.push(port.onMessage((raw) => {
      if (settled || checking) return;
      idle();
      const parsed = ResumePortMessageSchema.safeParse(raw);
      if (!parsed.success) return protocolError();
      const message = parsed.data;
      switch (message.type) {
        case 'resume/header': {
          if (header !== null) return protocolError();
          const chunks = Math.ceil(message.size / RESUME_CHUNK_BYTES);
          if (message.size === 0 || message.size > RESUME_MAX_BYTES || message.chunkCount !== chunks
            || !MIME_TYPES.has(message.mime)) return protocolError();
          if (!request.accepts({ name: message.name, type: message.mime })) {
            const reason = message.mime === DOCX_MIME ? 'pdf-only-input' : 'resume-format-unsupported';
            return fail(reason, true, { v: 1, type: 'resume/error', reason });
          }
          header = { name: message.name, mime: message.mime, size: message.size, sha256: message.sha256,
            chunkCount: message.chunkCount };
          buffer = new Uint8Array(message.size);
          allocatedAt = monotonicNow();
          cancelRelease = startDeadline(request.releaseAfterMs ?? RESUME_RELEASE_MS,
            () => fail('resume-transfer-failed', false), request.signal);
          return;
        }
        case 'resume/chunk': {
          if (header === null || buffer === null || message.index !== next) return protocolError();
          const offset = message.index * RESUME_CHUNK_BYTES;
          const expected = Math.min(RESUME_CHUNK_BYTES, header.size - offset);
          if (decodeInto(message.data, buffer, offset) !== expected) return protocolError();
          received += expected;
          next += 1;
          try {
            port.post({ v: 1, type: 'resume/ack', index: message.index });
          } catch {
            fail('resume-transfer-failed', false);
          }
          return;
        }
        case 'resume/end': {
          if (header === null || buffer === null || next !== header.chunkCount || received !== header.size) {
            return protocolError();
          }
          checking = true;
          const own = header;
          const bytes = buffer;
          void sha256Hex(bytes).then((digest) => {
            checking = false;
            if (settled) return;
            if (digest !== own.sha256) {
              fail('resume-transfer-failed', false, { v: 1, type: 'resume/done', ok: false });
              return;
            }
            const file = new File([bytes], own.name, { type: own.mime });
            discard();
            cancelRelease();
            const left = (request.releaseAfterMs ?? RESUME_RELEASE_MS) - (monotonicNow() - allocatedAt);
            finish({ ok: true, resume: holdResume(file, left) }, { v: 1, type: 'resume/done', ok: true });
          }, () => {
            checking = false;
            fail('resume-transfer-failed', false, { v: 1, type: 'resume/done', ok: false });
          });
          return;
        }
        case 'resume/error':
          // The worker's refusals are final; a transfer it gave up on (an ack out of order, its 60 s release) is not.
          return fail(message.reason, message.reason !== 'resume-transfer-failed');
        default:
          return protocolError();
      }
    }));
    unlisten.push(port.onDisconnect(() => {
      if (!settled) fail('resume-transfer-failed', false);
    }));
    request.signal?.addEventListener('abort', onAbort, { once: true });
    idle();
    try {
      port.post({ v: 1, type: 'resume/request', runId: request.runId,
        ...(request.document === 'cover-letter' ? { document: 'cover-letter' as const } : {}) });
    } catch {
      fail('resume-transfer-failed', false);
    }
  });
}

/** The File, held until the caller releases it, or until what is left of the release deadline (counted from the
 *  buffer's allocation) runs out. */
function holdResume(file: File, leftMs: number): ReceivedResume {
  let held: File | null = file;
  let cancel: Cancel = () => undefined;
  const release = () => {
    if (held === null) return;
    held = null;
    cancel();
    log('content.resume-released');
  };
  cancel = startDeadline(Math.max(0, leftMs), release);
  return {
    get file() {
      return held;
    },
    get released() {
      return held === null;
    },
    release,
  };
}
