/*
 * The worker's only way to TailorIT. It calls nothing but `<origin>/api/autofill/*` and GET on
 * `<origin>/api/ai/tasks/<uuid>` (never a DELETE: TailorIT gives callers that ask the same one task, and prunes it
 * itself; the Phase 4 review, T-F2), each with no cookie (credentials 'omit'), no redirect, no cache and a 25-second
 * timeout (Chrome may stop a worker whose fetch waits 30 s). Every request carries the API version header; versions
 * differ only when an answer's header says so, never because of a status. Every answer is parsed with the contract's
 * schema, so drift fails here, loudly, as 'bad-answer'. It logs statuses and timings only: never a URL, a header or a
 * body.
 */
import { z } from 'zod';
import {
  AutofillAddJobResponseSchema,
  AUTOFILL_COVER_LETTER_MAX_BYTES,
  AutofillCoverLetterIdSchema,
  AutofillCoverLetterResponseSchema,
  AutofillCoverLetterStatusSchema,
  type AutofillCoverLetterRequest,
  type AutofillCoverLetterResponse,
  type AutofillCoverLetterStatus,
  AutofillLookupMatchSchema,
  type AutofillAddJobRequest,
  type AutofillAddJobResponse,
  AUTOFILL_API_HEADER,
  AUTOFILL_API_VERSION,
  AUTOFILL_FILE_KIND_HEADER,
  AUTOFILL_FILE_SHA256_HEADER,
  AUTOFILL_RESUME_MAX_BYTES,
  AutofillAnswerTaskSchema,
  AutofillClassifyTaskSchema,
  AutofillDraftTaskSchema,
  AutofillErrorBodySchema,
  AutofillLookupResponseSchema,
  AutofillPickTaskSchema,
  AutofillProfileEnvelopeSchema,
  AutofillRedeemResponseSchema,
  AutofillResumeListSchema,
  AutofillSavedAnswerListSchema,
  AutofillSavedAnswerSchema,
  AutofillSensitiveEnvelopeSchema,
  AutofillSessionSchema,
  AutofillTaskAcceptedSchema,
  AutofillTaskIdSchema,
  AutofillTaskViewSchema,
  type AutofillAnswerRequest,
  type AutofillAnswerTask,
  type AutofillClassifyRequest,
  type AutofillClassifyTask,
  type AutofillDraftRequest,
  type AutofillDraftTask,
  type AutofillLookupRequest,
  type AutofillPickRequest,
  type AutofillPickTask,
  type AutofillTaskView,
  type AutofillLookupResponse,
  type AutofillProfileEnvelope,
  type AutofillRedeemBody,
  type AutofillRedeemResponse,
  type AutofillResumeList,
  type AutofillSavedAnswer,
  type AutofillSavedAnswerList,
  type AutofillSensitiveEnvelope,
  type PutAutofillSavedAnswerBody,
  type AutofillSession,
} from '../contract/tailorit';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';

/** Every request's limit: under the 30 s after which Chrome may stop a worker that waits on a fetch. */
export const SERVER_TIMEOUT_MS = 25_000;

/** Why a call gave no answer. 'unauthorized' on a token request means the token was dropped (401). */
export const SERVER_FAILURES = ['not-connected', 'unauthorized', 'forbidden', 'not-found', 'version-mismatch',
  'conflict', 'too-large', 'rate-limited', 'bad-request', 'server-error', 'unreachable', 'timeout', 'bad-answer',
  'refused-path'] as const;
/** One of SERVER_FAILURES. */
export type ServerFailure = (typeof SERVER_FAILURES)[number];

/** A call's answer: its parsed value, or why there is none. */
export type ServerResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      failure: ServerFailure;
      /** The HTTP status, when there was one. */
      status?: number;
      /** TailorIT's error code ('ai_busy', 'not_signed_in', ...), for decisions only: never logged or shown. */
      code?: string;
      retryAfterSeconds?: number;
    };

/** An AI route's answer (Phase 4): its task, finished within TailorIT's wait (200), or the id to poll (202). */
export type AiSubmitted<T> = { done: true; task: T } | { done: false; taskId: string };

/** The resume file as GET /resumes/:id/file sent it: the bytes and the headers that describe them. */
export interface ResumeFile {
  bytes: Uint8Array;
  /** X-TailorIT-File-Kind, as sent ('pdf', 'docx' or 'doc'); null when absent. */
  kind: string | null;
  /** X-TailorIT-Sha256, as sent; null when absent. */
  sha256: string | null;
}

/** A cover letter's file as GET /cover-letters/:id/file sent it (Phase G): the bytes, the headers that describe them,
 *  and the name it is downloaded under (Content-Disposition's, null when absent). */
export interface CoverLetterFile extends ResumeFile {
  fileName: string | null;
}

/** The name a Content-Disposition gives (RFC 6266): `filename*` (UTF-8, percent-encoded) first, else `filename`; null
 *  when it names none or does not decode. */
export function dispositionName(header: string | null): string | null {
  if (header === null) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended !== null) {
    try {
      return decodeURIComponent(extended[1]!.trim());
    } catch {
      return null;
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  const name = plain?.[1]?.trim() ?? '';
  return name === '' ? null : name;
}

/** The routes the worker calls, one method each. */
export interface ServerClient {
  /** POST /connect/redeem: no Authorization header, no cookie. */
  redeem(body: AutofillRedeemBody): Promise<ServerResult<AutofillRedeemResponse>>;
  /** GET /session, with the current token or the one given. */
  session(token?: string): Promise<ServerResult<AutofillSession>>;
  /** DELETE /session: revokes the current token or the one given. */
  endSession(token?: string): Promise<ServerResult<null>>;
  profile(): Promise<ServerResult<AutofillProfileEnvelope>>;
  sensitive(): Promise<ServerResult<AutofillSensitiveEnvelope>>;
  /** POST /lookup. A `match` that breaks the contract drops only the match (null), never the lookup: the job, the
   *  tracker entry and the stored copy's policy check do not hang on it. */
  lookup(body: AutofillLookupRequest): Promise<ServerResult<AutofillLookupResponse>>;
  /** POST /jobs (v2): adds the page's posting to TailorIT's jobs and the person's tracker; its lookup is read as
   *  lookup()'s. A refusal's code (`unsupported`, `not_found`, `ats_unavailable`, ...) is in `code`. */
  addJob(body: AutofillAddJobRequest): Promise<ServerResult<AutofillAddJobResponse>>;
  resumes(): Promise<ServerResult<AutofillResumeList>>;
  /** GET /resumes/:id/file, refused above `maxBytes` (TailorIT's 10 MiB cap) before or while reading. */
  resumeFile(id: string, maxBytes?: number): Promise<ServerResult<ResumeFile>>;
  /** POST /ai/pick (Phase 4): the finished task, or its id to poll. A 409 `ai_busy` is a conflict with that code. */
  aiPick(body: AutofillPickRequest): Promise<ServerResult<AiSubmitted<AutofillPickTask>>>;
  /** POST /ai/classify (Phase 4), as aiPick. */
  aiClassify(body: AutofillClassifyRequest): Promise<ServerResult<AiSubmitted<AutofillClassifyTask>>>;
  /** POST /ai/draft (Phase 6), as aiPick. */
  aiDraft(body: AutofillDraftRequest): Promise<ServerResult<AiSubmitted<AutofillDraftTask>>>;
  /** POST /ai/answer (version 2: the owner's amendments), as aiPick. */
  aiAnswer(body: AutofillAnswerRequest): Promise<ServerResult<AiSubmitted<AutofillAnswerTask>>>;
  /** GET /answers (Phase 6): the account's saved answers, read with the profile. */
  answers(): Promise<ServerResult<AutofillSavedAnswerList>>;
  /** PUT /answers (Phase 6): saves one answer the person asked to save, as TailorIT then keeps it. A refusal's 400
   *  (a question TailorIT never keeps) is bad-request, its 409 (the account's limit) conflict. */
  putAnswer(body: PutAutofillSavedAnswerBody): Promise<ServerResult<AutofillSavedAnswer>>;
  /** GET /api/ai/tasks/:id: the task as it is now. An id that is not a task id is refused before any request. No
   *  task is ever cancelled from here: another caller may share it. */
  aiTask(id: string): Promise<ServerResult<AutofillTaskView>>;
  /** POST /cover-letters (Phase G): the person's letter for this application, written now by TailorIT's AI when
   *  `generate` and there is none. A refusal's code (`not_found`, `ai_busy`, ...) is in `code`. */
  coverLetter(body: AutofillCoverLetterRequest): Promise<ServerResult<AutofillCoverLetterResponse>>;
  /** GET /cover-letters/:id: where the letter stands. An id that is not a letter id is refused before any request. */
  coverLetterState(id: string): Promise<ServerResult<AutofillCoverLetterStatus>>;
  /** GET /cover-letters/:id/file: the letter's PDF, refused above `maxBytes` (TailorIT's 10 MiB cap) before or while
   *  reading; a letter not ready yet is a conflict (409). */
  coverLetterFile(id: string, maxBytes?: number): Promise<ServerResult<CoverLetterFile>>;
}

/** What the server client needs. */
export interface ServerClientDeps {
  /** TailorIT's origin, fixed per build (__TAILORIT_ORIGIN__). */
  origin: string;
  platform: Pick<WorkerPlatform, 'fetch' | 'timeout' | 'now'>;
  /** The current token, or null when not connected. */
  token(): Promise<string | null>;
  /** TailorIT answered 401 to a request that carried `token`: that token no longer works. */
  onUnauthorized(token: string): Promise<void>;
  /** An answer to a token request named a version: true when it is this extension's. */
  onVersion(matches: boolean): void;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** TailorIT's own token routes (its tokenScope), anchored and case-sensitive: no dot segments, no encoding. */
const AUTOFILL_PATH = /^\/api\/autofill\/[a-z0-9/-]+$/;
const AI_TASK_PATH = /^\/api\/ai\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What a resume id may be to become part of a path. */
const RESUME_ID = /^[a-z0-9-]{1,64}$/;

/** Whether the worker may make this request at all: the autofill routes, and polling an AI task (never cancelling
 *  one). */
export function isAllowedRequest(method: string, path: string): boolean {
  if (path.includes('//')) return false;
  if (AUTOFILL_PATH.test(path)) return (METHODS as readonly string[]).includes(method);
  if (AI_TASK_PATH.test(path)) return method === 'GET';
  return false;
}

type Body = { kind: 'json'; schema: z.ZodType } | { kind: 'none' } | { kind: 'bytes'; maxBytes: number }
  /** An AI route's: the finished task's schema for a 200, AutofillTaskAccepted for a 202. */
  | { kind: 'task'; schema: z.ZodType };

interface Call {
  method: Method;
  path: string;
  /** 'current': the stored token; a string: that token; null: none (redeem). */
  token: 'current' | string | null;
  json?: unknown;
  answer: Body;
}

type Raw = { ok: true; value: unknown; response: Response } | Extract<ServerResult<never>, { ok: false }>;

const failure = (reason: ServerFailure, extra: { status?: number; code?: string; retryAfterSeconds?: number } = {}) =>
  ({ ok: false as const, failure: reason, ...extra });

function failureOfStatus(status: number): ServerFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'bad-request';
  return 'server-error';
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** The body's bytes, refused once they pass `max` (from Content-Length first, then while reading). */
async function readCapped(response: Response, max: number): Promise<Uint8Array | 'too-large'> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    return 'too-large';
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer());
    return whole.byteLength > max ? 'too-large' : whole;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return 'too-large';
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** A lookup as the wire may carry it, its match read apart (lookupOf): a cosmetic field never decides whether the rest,
 *  the stored copy's policy check among it, is read (the v2 review, M1). */
const LookupWireSchema = AutofillLookupResponseSchema.extend({ match: z.unknown().optional() });
const AddJobWireSchema = AutofillAddJobResponseSchema.extend({ lookup: LookupWireSchema });

/** The lookup with its match checked on its own: absent stays absent (a TailorIT older than the field), and one that
 *  breaks the contract becomes null, logged as a code. */
function lookupOf(wire: z.infer<typeof LookupWireSchema>): AutofillLookupResponse {
  const { match, ...rest } = wire;
  if (match === undefined) return rest;
  const parsed = AutofillLookupMatchSchema.nullable().safeParse(match);
  if (!parsed.success) log('server.lookup-match-dropped');
  return { ...rest, match: parsed.success ? parsed.data : null };
}

/** TailorIT's error body, when it sent one: its code and retry hint only. */
async function errorOf(response: Response): Promise<{ code?: string; retryAfterSeconds?: number }> {
  let parsed: ReturnType<typeof AutofillErrorBodySchema.safeParse> | null = null;
  try {
    parsed = AutofillErrorBodySchema.safeParse(await response.json());
  } catch {
    parsed = null;
  }
  const header = Number(response.headers.get('retry-after') ?? '');
  const fromHeader = Number.isInteger(header) && header >= 0 ? header : undefined;
  if (!parsed?.success) return fromHeader === undefined ? {} : { retryAfterSeconds: fromHeader };
  const retry = parsed.data.error.retryAfterSeconds ?? fromHeader;
  return retry === undefined ? { code: parsed.data.error.code } : { code: parsed.data.error.code, retryAfterSeconds: retry };
}

/** The client for one origin. */
export function createServerClient(deps: ServerClientDeps): ServerClient {
  async function send(call: Call): Promise<Raw> {
    if (!isAllowedRequest(call.method, call.path)) {
      log('server.path-refused');
      return failure('refused-path');
    }
    const token = call.token === 'current' ? await deps.token() : call.token;
    if (call.token !== null && token === null) return failure('not-connected');

    const headers: Record<string, string> = { [AUTOFILL_API_HEADER]: String(AUTOFILL_API_VERSION) };
    if (call.answer.kind === 'json' || call.answer.kind === 'task') headers.Accept = 'application/json';
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (call.json !== undefined) headers['Content-Type'] = 'application/json';
    const init: RequestInit = {
      method: call.method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: deps.platform.timeout(SERVER_TIMEOUT_MS),
    };
    if (call.json !== undefined) init.body = JSON.stringify(call.json);

    const started = deps.platform.now();
    let response: Response;
    try {
      response = await deps.platform.fetch(`${deps.origin}${call.path}`, init);
    } catch (error) {
      if (isTimeout(error)) {
        log('server.timeout');
        return failure('timeout');
      }
      log('server.unreachable');
      return failure('unreachable');
    }

    try {
      const version = response.headers.get(AUTOFILL_API_HEADER);
      if (version !== null) {
        const matches = version === String(AUTOFILL_API_VERSION);
        deps.onVersion(matches);
        if (!matches) {
          log('server.version-mismatch', { status: response.status });
          await response.body?.cancel().catch(() => undefined);
          return failure('version-mismatch', { status: response.status });
        }
      }

      if (!response.ok) {
        const detail = await errorOf(response);
        log('server.refused', { status: response.status });
        if (response.status === 401 && token !== null) await deps.onUnauthorized(token);
        return failure(failureOfStatus(response.status), { status: response.status, ...detail });
      }

      let value: unknown = null;
      if (call.answer.kind === 'task') {
        const accepted = response.status === 202;
        const parsed = (accepted ? AutofillTaskAcceptedSchema : call.answer.schema).safeParse(await response.json());
        if (!parsed.success || (!accepted && response.status !== 200)) {
          log('server.bad-answer', { status: response.status });
          return failure('bad-answer', { status: response.status });
        }
        value = accepted ? { done: false, taskId: (parsed.data as { taskId: string }).taskId }
          : { done: true, task: parsed.data };
      } else if (call.answer.kind === 'json') {
        const parsed = call.answer.schema.safeParse(await response.json());
        if (!parsed.success) {
          log('server.bad-answer', { status: response.status });
          return failure('bad-answer', { status: response.status });
        }
        value = parsed.data;
      } else if (call.answer.kind === 'bytes') {
        const bytes = await readCapped(response, call.answer.maxBytes);
        if (bytes === 'too-large') {
          log('server.too-large');
          return failure('too-large', { status: response.status });
        }
        value = bytes;
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      log('server.answered', { status: response.status, ms: deps.platform.now() - started });
      return { ok: true, value, response };
    } catch (error) {
      if (isTimeout(error)) {
        log('server.timeout');
        return failure('timeout');
      }
      log('server.bad-answer', { status: response.status });
      return failure('bad-answer', { status: response.status });
    }
  }

  async function json<T>(call: Omit<Call, 'answer'>, schema: z.ZodType<T>): Promise<ServerResult<T>> {
    const raw = await send({ ...call, answer: { kind: 'json', schema } });
    return raw.ok ? { ok: true, value: raw.value as T } : raw;
  }

  async function submit<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<ServerResult<AiSubmitted<T>>> {
    const raw = await send({ method: 'POST', path, token: 'current', json: body, answer: { kind: 'task', schema } });
    return raw.ok ? { ok: true, value: raw.value as AiSubmitted<T> } : raw;
  }

  /** GET on one task, its id checked before it becomes part of a path. */
  async function task(id: string): Promise<ServerResult<AutofillTaskView>> {
    if (!AutofillTaskIdSchema.safeParse(id).success) {
      log('server.path-refused');
      return failure('refused-path');
    }
    return json({ method: 'GET', path: `/api/ai/tasks/${id}`, token: 'current' }, AutofillTaskViewSchema);
  }

  return {
    redeem: (body) => json({ method: 'POST', path: '/api/autofill/connect/redeem', token: null, json: body }, AutofillRedeemResponseSchema),
    session: (token) => json({ method: 'GET', path: '/api/autofill/session', token: token ?? 'current' }, AutofillSessionSchema),
    async endSession(token) {
      const raw = await send({ method: 'DELETE', path: '/api/autofill/session', token: token ?? 'current', answer: { kind: 'none' } });
      return raw.ok ? { ok: true, value: null } : raw;
    },
    profile: () => json({ method: 'GET', path: '/api/autofill/profile', token: 'current' }, AutofillProfileEnvelopeSchema),
    sensitive: () =>
      json({ method: 'GET', path: '/api/autofill/profile/sensitive', token: 'current' }, AutofillSensitiveEnvelopeSchema),
    async lookup(body) {
      const raw = await json({ method: 'POST', path: '/api/autofill/lookup', token: 'current', json: body }, LookupWireSchema);
      return raw.ok ? { ok: true, value: lookupOf(raw.value) } : raw;
    },
    async addJob(body) {
      const raw = await json({ method: 'POST', path: '/api/autofill/jobs', token: 'current', json: body }, AddJobWireSchema);
      return raw.ok ? { ok: true, value: { created: raw.value.created, lookup: lookupOf(raw.value.lookup) } } : raw;
    },
    resumes: () => json({ method: 'GET', path: '/api/autofill/resumes', token: 'current' }, AutofillResumeListSchema),
    async resumeFile(id, maxBytes = AUTOFILL_RESUME_MAX_BYTES) {
      if (!RESUME_ID.test(id)) {
        log('server.path-refused');
        return failure('refused-path');
      }
      const raw = await send({
        method: 'GET',
        path: `/api/autofill/resumes/${id}/file`,
        token: 'current',
        answer: { kind: 'bytes', maxBytes },
      });
      if (!raw.ok) return raw;
      return {
        ok: true,
        value: {
          bytes: raw.value as Uint8Array,
          kind: raw.response.headers.get(AUTOFILL_FILE_KIND_HEADER),
          sha256: raw.response.headers.get(AUTOFILL_FILE_SHA256_HEADER),
        },
      };
    },
    aiPick: (body) => submit('/api/autofill/ai/pick', body, AutofillPickTaskSchema),
    aiClassify: (body) => submit('/api/autofill/ai/classify', body, AutofillClassifyTaskSchema),
    aiDraft: (body) => submit('/api/autofill/ai/draft', body, AutofillDraftTaskSchema),
    aiAnswer: (body) => submit('/api/autofill/ai/answer', body, AutofillAnswerTaskSchema),
    answers: () => json({ method: 'GET', path: '/api/autofill/answers', token: 'current' }, AutofillSavedAnswerListSchema),
    putAnswer: (body) =>
      json({ method: 'PUT', path: '/api/autofill/answers', token: 'current', json: body }, AutofillSavedAnswerSchema),
    aiTask: (id) => task(id),
    coverLetter: (body) =>
      json({ method: 'POST', path: '/api/autofill/cover-letters', token: 'current', json: body }, AutofillCoverLetterResponseSchema),
    coverLetterState(id) {
      if (!AutofillCoverLetterIdSchema.safeParse(id).success) {
        log('server.path-refused');
        return Promise.resolve(failure('refused-path'));
      }
      return json({ method: 'GET', path: `/api/autofill/cover-letters/${id}`, token: 'current' }, AutofillCoverLetterStatusSchema);
    },
    async coverLetterFile(id, maxBytes = AUTOFILL_COVER_LETTER_MAX_BYTES) {
      if (!AutofillCoverLetterIdSchema.safeParse(id).success) {
        log('server.path-refused');
        return failure('refused-path');
      }
      const raw = await send({ method: 'GET', path: `/api/autofill/cover-letters/${id}/file`, token: 'current',
        answer: { kind: 'bytes', maxBytes } });
      if (!raw.ok) return raw;
      return {
        ok: true,
        value: {
          bytes: raw.value as Uint8Array,
          kind: raw.response.headers.get(AUTOFILL_FILE_KIND_HEADER),
          sha256: raw.response.headers.get(AUTOFILL_FILE_SHA256_HEADER),
          fileName: dispositionName(raw.response.headers.get('content-disposition')),
        },
      };
    },
  };
}
