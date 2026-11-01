/*
 * The `resume` port (runtime.md §4.4, ARCHITECTURE "Resume transfer"). A content script opens it only when a planned
 * write targets a file field, and posts resume/request {runId, document?}: the run's resume, or (Phase G) its cover
 * letter, which travels the same way under the same rules (below the resume's). The worker sends the resume the run chose
 * (resume-choice.ts, shared with the planner; asked when the file is written, so a Change since counts), refuses a legacy .doc before any fetch, fetches GET /resumes/:id/file (at most 10 MiB),
 * checks the bytes (a PDF starts with %PDF-; a DOCX has the ZIP signature and X-TailorIT-File-Kind: docx) and their
 * SHA-256 against X-TailorIT-Sha256, then sends a header and 256 KiB base64 chunks, each acknowledged before the next,
 * and resume/end. The bytes are released on resume/done, on an error or a disconnect, and at the latest 60 seconds
 * after the fetch; they are never stored or cached between transfers. A failed or timed-out fetch is
 * resume-unavailable.
 *
 * The cover letter (Phase G): the run's letter, once TailorIT has it ready (cover-letters.ts; its id in the run's memory,
 * never in a message), is fetched from GET /cover-letters/:id/file (at most AUTOFILL_COVER_LETTER_MAX_BYTES, 10 MiB),
 * accepted only as a PDF (X-TailorIT-File-Kind pdf and %PDF-) whose SHA-256 is X-TailorIT-Sha256, named as TailorIT's
 * Download names it (its Content-Disposition, cleaned by uploadName), and sent and released exactly as a resume is. No
 * letter ready (a dry run, a run that has none) is resume-unavailable before any fetch. A worker that restarted since
 * the plan, or whose token changed, holds no letter for the run: it checks TailorIT again for the person's own letter
 * for the run's job (checkLetter: generate false, so nothing is written and no AI letter is answered; the lookup read
 * again from the frame's address), and sends that one, or answers resume-unavailable (the Phase G review, MINOR 7).
 */
import { AUTOFILL_COVER_LETTER_MAX_BYTES, AUTOFILL_FILE_MIME_TYPES, AUTOFILL_RESUME_MAX_BYTES } from '../contract/tailorit';
import { RESUME_CHUNK_BYTES, ResumePortMessageSchema } from '../messaging/schemas';
import type { PortLike } from '../platform/types';
import { log } from '../shared/log';
import { PDF_SIGNATURE, startsWith, toBase64, ZIP_SIGNATURE } from './bytes';
import { checkLetter, type LetterDeps } from './cover-letters';
import type { ProfileCache } from './profile-cache';
import { createResumeChooser, type ResumeChoice, type ResumeChooser } from './resume-choice';
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
  /** The chooser the planner uses (index.ts), which follows the token's generation and the tab's resume choice; one
   *  of this port's own by default. */
  choose?: ResumeChooser;
  /** What the planner asks for a run's cover letter with (index.ts): a run that holds no letter (a worker that
   *  restarted) checks for the person's own again. Absent: it answers resume-unavailable. */
  letters?: LetterDeps;
}

/** The name the file is uploaded under: no path or control characters, the kind's extension, at most 255 characters;
 *  `fallback` when nothing is left (a resume's 'Resume', a cover letter's 'Cover Letter'). */
export function uploadName(fileName: string, kind: 'pdf' | 'docx', fallback = 'Resume'): string {
  const extension = `.${kind}`;
  let base = fileName.replace(/[\p{Cc}\p{Cf}\\/:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (base.toLowerCase().endsWith(extension)) base = base.slice(0, -extension.length).trim();
  base = base.replace(/[. ]+$/, '');
  return `${(base || fallback).slice(0, 255 - extension.length)}${extension}`;
}

/** A cover letter's name when TailorIT names none (TailorIT's own fallback for a Download). */
const LETTER_NAME = 'Cover Letter';

/** The `resume` port's server: accept() serves one port. */
export function createResumeTransfer(deps: ResumeTransferDeps) {
  /** Which resume this run attaches: the one the planner attached, read from the run's memo (resume-choice.ts), or the
   *  one the person has chosen for the tab since (v2: a Change applies to every file not uploaded yet). */
  const choose = deps.choose ?? createResumeChooser(deps);

  /** The person's own letter for a run whose letter this worker does not hold (module header): its id, or null. */
  async function recheckLetter(runId: string, written: boolean, url: string, active: () => boolean):
    Promise<string | null> {
    if (deps.letters === undefined) return null;
    const choice = await choose(runId, url);
    const job = deps.runs.memo(runId).lookup?.job ?? null;
    if (job === null || !active()) return null;
    return checkLetter(deps.letters, { jobId: job.id, company: job.companyName, jobTitle: job.title,
      resumeId: choice?.id ?? null, written }, active);
  }

  /** Fetches and checks the run's cover letter (Phase G): a PDF only, whose bytes hash to TailorIT's header. */
  async function fetchLetter(letterId: string): Promise<{ bytes: Uint8Array; name: string; sha256: string } | Refusal> {
    const answer = await deps.server.coverLetterFile(letterId, AUTOFILL_COVER_LETTER_MAX_BYTES);
    if (!answer.ok) return 'resume-unavailable';
    const { bytes, kind, sha256: sentSha, fileName } = answer.value;
    if (kind !== 'pdf' || !startsWith(bytes, PDF_SIGNATURE) || bytes.byteLength === 0) return 'resume-unavailable';
    if (sentSha === null || !/^[a-f0-9]{64}$/.test(sentSha)) return 'resume-unavailable';
    const sha256 = await deps.sha256(bytes);
    if (sha256 !== sentSha) return 'resume-unavailable';
    return { bytes, name: uploadName(fileName ?? LETTER_NAME, 'pdf', LETTER_NAME), sha256 };
  }

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

    /** Sends the header and the first chunk of checked bytes, holding them until the transfer ends or the release. */
    function begin(checked: { bytes: Uint8Array; name: string; mime: string; sha256: string }): void {
      bytes = checked.bytes;
      cancelRelease = deps.timers.after(RESUME_RELEASE_MS, () => close('resume-transfer-failed'));
      chunkCount = Math.ceil(checked.bytes.byteLength / RESUME_CHUNK_BYTES);
      phase = 'sending';
      send({ v: 1, type: 'resume/header', name: checked.name, mime: checked.mime, size: checked.bytes.byteLength,
        sha256: checked.sha256, chunkCount });
      if (phase === 'sending') sendChunk(0);
    }

    async function start(runId: string, document: 'resume' | 'cover-letter'): Promise<void> {
      phase = 'preparing';
      await ready();
      if (phase !== 'preparing') return;
      const run = await deps.runs.find(runId, from);
      if (phase !== 'preparing') return;
      if (run === null || run.dryRun) {
        log('resume.refused', { run: run !== null });
        return close('resume-unavailable');
      }
      if (document === 'cover-letter') {
        // The run's letter, ready: its id never left the worker's memory (Phase G); or, where the worker holds no letter
        // for the run (it restarted since the plan), the person's own, checked for again.
        const held = deps.runs.memo(run.runId).letter;
        const letterId = held !== undefined ? held.readyId() : await recheckLetter(run.runId, run.letterWritten === true,
          from.url, () => phase === 'preparing');
        if (phase !== 'preparing') return;
        if (letterId === null) {
          log('resume.refused', { letter: false });
          return close('resume-unavailable');
        }
        const letter = await fetchLetter(letterId);
        if (phase !== 'preparing') return;
        if (typeof letter === 'string') {
          log('resume.refused', { letter: true, fetched: false });
          return close(letter);
        }
        return begin({ ...letter, mime: AUTOFILL_FILE_MIME_TYPES.pdf });
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
      begin({ bytes: fetched.bytes, name: uploadName(choice.fileName, fetched.kind),
        mime: AUTOFILL_FILE_MIME_TYPES[fetched.kind], sha256: fetched.sha256 });
    }

    port.onMessage((raw) => {
      const parsed = ResumePortMessageSchema.safeParse(raw);
      const message = parsed.success ? parsed.data : null;
      if (message?.type === 'resume/error') return close();
      if (phase === 'request' && message?.type === 'resume/request') {
        void start(message.runId, message.document ?? 'resume').catch(() => close('resume-unavailable'));
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
