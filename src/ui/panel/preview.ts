/*
 * The resume's preview, the extension page's side (v3 Phase 3b; docs/PRIVACY.md "The resume's preview"; since v1.4 F
 * the full-window preview page's, ui/preview/PreviewPage.tsx, in place of the side panel's): the `preview`
 * port, an extension page's, posts preview/request {tabId}; the worker sends the resume a fill of the tab would attach
 * as the resume port sends it to a form (a header, 256 KiB base64 chunks each acknowledged, resume/end), checked the
 * same way here (the header's size and chunk count, each chunk's length, the SHA-256), and the panel answers
 * resume/done. The bytes become a Blob the panel shows from a blob: address of its own origin, in its own page: never a
 * job page's, never stored, and the address is revoked when the preview closes.
 * v4 ui: the cover letter's too (preview/request {tabId, kind: 'coverLetter'}): the letter the tab's fill attached or
 * would attach, a PDF only, over the same port and checks.
 */
import { RESUME_CHUNK_BYTES, RESUME_MAX_BYTES, ResumePortMessageSchema } from '../../messaging/schemas';
import type { PagePlatform, PortLike } from '../../platform/types';
import type { PreviewKind } from '../report/Report';

/** Why there is no preview: none to show (no resume, or none could be fetched), not a PDF, or the transfer failed. */
export type PreviewFailure = 'unavailable' | 'not-pdf' | 'failed';

/** The preview's bytes as a PDF Blob, or why there are none. */
export type PreviewResult = { ok: true; blob: Blob } | { ok: false; reason: PreviewFailure };

/** The lower-case hex SHA-256 of `bytes`. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Receives the tab's resume (or, v4 ui, its cover letter: `kind`) over the preview port (module header). The worker
 *  always ends the transfer (its fetch's time-out, its release within 60 s), so the panel keeps no clock of its own.
 *  `signal` (the review): the preview went (closed, another resume or tab) before the bytes came: the port is
 *  disconnected and nothing is kept. */
export function receivePreview(platform: PagePlatform, tabId: number, signal?: AbortSignal,
  kind: PreviewKind = 'resume'): Promise<PreviewResult> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve({ ok: false, reason: 'failed' });
      return;
    }
    let port: PortLike;
    try {
      port = platform.runtime.connect('preview');
    } catch {
      resolve({ ok: false, reason: 'failed' });
      return;
    }
    let settled = false;
    let header: { size: number; sha256: string; chunkCount: number } | null = null;
    let buffer: Uint8Array<ArrayBuffer> | null = null;
    let next = 0;
    const finish = (result: PreviewResult, farewell?: unknown) => {
      if (settled) return;
      settled = true;
      if (!result.ok) buffer?.fill(0);
      buffer = null;
      try {
        if (farewell !== undefined) port.post(farewell);
        port.disconnect();
      } catch {
        // Already gone.
      }
      resolve(result);
    };
    const failed = () => finish({ ok: false, reason: 'failed' }, { v: 1, type: 'resume/error', reason: 'resume-transfer-failed' });
    port.onMessage((raw) => {
      if (settled) return;
      const parsed = ResumePortMessageSchema.safeParse(raw);
      if (!parsed.success) return failed();
      const message = parsed.data;
      if (message.type === 'resume/error') {
        return finish({ ok: false, reason: message.reason === 'resume-format-unsupported' ? 'not-pdf'
          : message.reason === 'resume-unavailable' ? 'unavailable' : 'failed' });
      }
      if (message.type === 'resume/header') {
        if (header !== null || message.mime !== 'application/pdf' || message.size === 0 || message.size > RESUME_MAX_BYTES
          || message.chunkCount !== Math.ceil(message.size / RESUME_CHUNK_BYTES)) return failed();
        header = { size: message.size, sha256: message.sha256, chunkCount: message.chunkCount };
        buffer = new Uint8Array(message.size);
        return;
      }
      if (message.type === 'resume/chunk') {
        if (header === null || buffer === null || message.index !== next) return failed();
        const offset = message.index * RESUME_CHUNK_BYTES;
        let binary: string;
        try {
          binary = atob(message.data);
        } catch {
          return failed();
        }
        if (binary.length !== Math.min(RESUME_CHUNK_BYTES, header.size - offset)) return failed();
        for (let i = 0; i < binary.length; i += 1) buffer[offset + i] = binary.charCodeAt(i);
        next += 1;
        port.post({ v: 1, type: 'resume/ack', index: message.index });
        return;
      }
      if (message.type === 'resume/end') {
        if (header === null || buffer === null || next !== header.chunkCount) return failed();
        const bytes = buffer;
        const own = header;
        void sha256Hex(bytes).then((digest) => {
          if (digest !== own.sha256) return failed();
          finish({ ok: true, blob: new Blob([bytes], { type: 'application/pdf' }) }, { v: 1, type: 'resume/done', ok: true });
        }, failed);
        return;
      }
      failed();
    });
    port.onDisconnect(() => {
      if (!settled) finish({ ok: false, reason: 'failed' });
    });
    signal?.addEventListener('abort', () => finish({ ok: false, reason: 'failed' }), { once: true });
    try {
      port.post({ v: 1, type: 'preview/request', tabId, ...(kind === 'coverLetter' ? { kind } : {}) });
    } catch {
      finish({ ok: false, reason: 'failed' });
    }
  });
}
