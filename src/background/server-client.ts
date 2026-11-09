/*
 * The worker's only way to TailorIT. It calls nothing but `<origin>/api/autofill/*` and GET on
 * `<origin>/api/ai/tasks/<uuid>` (never a DELETE: TailorIT gives callers that ask the same one task, and prunes it
 * itself; the Phase 4 review, T-F2), each with no cookie (credentials 'omit'), no redirect, no cache and a 25-second
 * timeout (Chrome may stop a worker whose fetch waits 30 s). Every request carries the API version header; versions
 * differ only when an answer's header says so, never because of a status. Every answer is parsed with the contract's
 * schema, so drift fails here, loudly, as 'bad-answer'. It logs statuses and timings only: never a URL, a header or a
 * body.
 * v5 p2-stream (Jobright parity, Phase 2): GET `<origin>/api/ai/tasks/<uuid>/stream` too, a task's streamed view
 * (aiTaskStream): its headers within the same 25 s, then read for as long as the caller's signal allows, ended by
 * TailorIT after the finished task, or here after AI_STREAM_IDLE_MS with no byte (its heartbeat is every 10 s), past
 * AI_STREAM_MAX_BYTES, or at the first message that breaks the contract. An AI route asked with `async` carries
 * `Prefer: respond-async` and is answered 202 at once by a TailorIT that streams.
 */
import { z } from 'zod';
import {
  AutofillAddJobResponseSchema,
  AutofillAgentIdSchema,
  AutofillAgentNextSchema,
  type AutofillAgentNext,
  type AutofillAgentResultBody,
  AutofillCredentialQuerySchema,
  AutofillCredentialSchema,
  type AutofillCredential,
  type AutofillAppliedRequest,
  AUTOFILL_COVER_LETTER_MAX_BYTES,
  AutofillCoverLetterTextSchema,
  type AutofillCoverLetterText,
  AutofillJobSearchResponseSchema,
  type AutofillJobSearchResponse,
  AUTOFILL_JOB_SEARCH_QUERY_MAX,
  PutAutofillProfileResponseSchema,
  type PutAutofillProfileBody,
  type PutAutofillProfileResponse,
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
  AutofillTaskStreamEventSchema,
  AutofillTaskViewSchema,
  AUTOFILL_AI_RESPOND_ASYNC,
  AUTOFILL_AI_STREAM_HEARTBEAT_MS,
  type AutofillTaskStreamEvent,
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
  // v1.3 B
  AutofillFormsKnownResponseSchema,
  AutofillSubmissionResponseSchema,
  type AutofillFormsKnownRequest,
  type AutofillFormsKnownResponse,
  type AutofillSubmissionRequest,
  type AutofillSubmissionResponse,
} from '../contract/tailorit';
// The snapshot build of 2026-11-06 (core-x, item 6): every address named to TailorIT goes through tailoritAddressOf, which
// keeps v3 Phase 8's company-page rule (addressForTailorIT) and names iCIMS's, SmartRecruiters' and jobs.workable.com's
// pages by their posting's canonical address.
import { tailoritAddressOf } from '../adapters/tailorit-address';
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

// v5 p2-stream
/** How an AI route is asked: `async` asks TailorIT to answer 202 at once (Prefer: respond-async), for a caller that
 *  reads the task's stream. */
export interface AiSubmitOptions {
  async?: boolean;
}
/** A task's stream gives up after this long with no byte: TailorIT sends a comment line every 10 s. */
export const AI_STREAM_IDLE_MS = Math.round(AUTOFILL_AI_STREAM_HEARTBEAT_MS * 2.5);
/** A task's stream is read up to this many bytes (ten answers, three drafts of 5,000 characters and the task again
 *  are far less). */
export const AI_STREAM_MAX_BYTES = 2 * 1024 * 1024;
/** What reading a task's stream needs: where its items go, and the signal that ends it (the run went, the task's
 *  cap). */
export interface AiStreamOptions {
  onEvent(event: Exclude<AutofillTaskStreamEvent, { type: 'task' }>): void;
  signal: AbortSignal;
}
// v5 p2-stream end

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
  /** POST /ai/pick (Phase 4): the finished task, or its id to poll. A 409 `ai_busy` is a conflict with that code.
   *  v5 p2-stream: `async` asks for the 202 at once (AiSubmitOptions). */
  aiPick(body: AutofillPickRequest, options?: AiSubmitOptions): Promise<ServerResult<AiSubmitted<AutofillPickTask>>>;
  /** POST /ai/classify (Phase 4), as aiPick. */
  aiClassify(body: AutofillClassifyRequest, options?: AiSubmitOptions):
    Promise<ServerResult<AiSubmitted<AutofillClassifyTask>>>;
  /** POST /ai/draft (Phase 6), as aiPick. */
  aiDraft(body: AutofillDraftRequest, options?: AiSubmitOptions): Promise<ServerResult<AiSubmitted<AutofillDraftTask>>>;
  /** POST /ai/answer (version 2: the owner's amendments), as aiPick. */
  aiAnswer(body: AutofillAnswerRequest, options?: AiSubmitOptions):
    Promise<ServerResult<AiSubmitted<AutofillAnswerTask>>>;
  /**
   * v5 p2-stream: GET /api/ai/tasks/:id/stream, read to its end: each answer or draft goes to `onEvent` as it comes,
   * and the answer is the finished task (null when the stream ended without it: the caller polls). A TailorIT older
   * than the stream answers not-found (404), as does a task that is gone. An id that is not a task id is refused
   * before any request. Nothing of what streams is logged.
   */
  aiTaskStream(id: string, options: AiStreamOptions): Promise<ServerResult<AutofillTaskView | null>>;
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
  /** GET /cover-letters/:id/text (version 3): a ready letter's words, for a cover-letter text box. A letter not ready
   *  yet is a conflict (409). The words are never logged. */
  coverLetterText(id: string): Promise<ServerResult<AutofillCoverLetterText>>;
  /** GET /jobs/search?q= (version 3): at most 10 of the person's tracked jobs whose title or company holds every word
   *  of `query` ("Autofill for another job"). The query goes in the query string only, URL-encoded. */
  searchJobs(query: string): Promise<ServerResult<AutofillJobSearchResponse>>;
  /** POST /applied (version 3, scope tracker:write): the job is marked Applied in the tracker; answers the lookup. */
  applied(body: AutofillAppliedRequest): Promise<ServerResult<AutofillLookupResponse>>;
  /** POST /site-requests (version 3): "Ask TailorIT to support this site", a host name alone. */
  siteRequest(host: string): Promise<ServerResult<null>>;
  /** v1.3 B: POST /submissions (scope tracker:write), once the site confirmed a Submit: what POST /applied does, and
   *  the form's questions (and, unless the person turned it off, their answers) kept in TailorIT; answers the lookup
   *  with what happened. A 400 changed nothing: POST /applied then. The body is never logged. */
  submissions(body: AutofillSubmissionRequest): Promise<ServerResult<AutofillSubmissionResponse>>;
  /** v1.3 B: POST /forms/known (scope jobs:lookup; the answers profile:read): the job's known questions and the
   *  person's earlier answers. */
  knownForm(body: AutofillFormsKnownRequest): Promise<ServerResult<AutofillFormsKnownResponse>>;
  /** PUT /profile (version 3, scope profile:write; its `sensitive` only with profile:sensitive): the side panel's
   *  "Your autofill information". A stale revision is a conflict (409 `revision_conflict`), a body TailorIT refuses
   *  bad-request (400), a token without the scope forbidden (403). */
  putProfile(body: PutAutofillProfileBody): Promise<ServerResult<PutAutofillProfileResponse>>;
  /** GET /agent/next (version 3, scope agent:run, v3 Phase 5): this browser's own running job again (after a worker
   *  restart), else the next queued one, now running for this browser; `item` null: nothing to do. */
  agentNext(): Promise<ServerResult<AutofillAgentNext>>;
  /** POST /agent/:id/result (version 3, scope agent:run): how a run went (204). A row of another account, or removed
   *  since, is not-found (404); a result the row no longer takes is a conflict (409). An id that is not a queue id is
   *  refused before any request. */
  agentResult(id: string, body: AutofillAgentResultBody): Promise<ServerResult<null>>;
  /** GET /credentials?host= (version 3, scope credentials:read, v3 Phase 5): the job-site sign-in for that host, else
   *  the one for every site on a host signInHostCovered covers; none is not-found (404). The answer holds a password:
   *  it is never logged, and a host that is not a host name is refused before any request. Version 6 (the snapshot
   *  build of 2026-11-06, contract6): `path`, the page's pathname alone, goes as &path= where the caller names one (a
   *  host the every-site sign-in covers by its candidate paths: ADP Workforce Now, ClearCompany); one the contract's
   *  query would refuse (a query, a fragment, a space, no leading '/', too long) is never sent: the host is asked
   *  alone, which still finds the sign-in saved for it. */
  credential(host: string, path?: string): Promise<ServerResult<AutofillCredential>>;
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
/** v5 p2-stream: a task's streamed view, GET only. */
const AI_TASK_STREAM_PATH =
  /^\/api\/ai\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/stream$/;
/** What a resume id may be to become part of a path. */
const RESUME_ID = /^[a-z0-9-]{1,64}$/;

/** Whether the worker may make this request at all: the autofill routes, and polling an AI task (never cancelling
 *  one). */
export function isAllowedRequest(method: string, path: string): boolean {
  if (path.includes('//')) return false;
  if (AUTOFILL_PATH.test(path)) return (METHODS as readonly string[]).includes(method);
  if (AI_TASK_PATH.test(path)) return method === 'GET';
  // v5 p2-stream: a task's streamed view.
  if (AI_TASK_STREAM_PATH.test(path)) return method === 'GET';
  return false;
}

type Body = { kind: 'json'; schema: z.ZodType } | { kind: 'none' } | { kind: 'bytes'; maxBytes: number }
  /** An AI route's: the finished task's schema for a 200, AutofillTaskAccepted for a 202. */
  | { kind: 'task'; schema: z.ZodType };

interface Call {
  method: Method;
  path: string;
  /** The query string's parameters (GET /jobs/search's `q`), encoded by URLSearchParams: the path alone is checked
   *  against the allow-list, and the query never names a route. */
  query?: Record<string, string>;
  /** 'current': the stored token; a string: that token; null: none (redeem). */
  token: 'current' | string | null;
  json?: unknown;
  answer: Body;
  /** v5 p2-stream: an AI route asked to answer 202 at once (Prefer: respond-async). */
  async?: boolean;
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
    if (call.async === true) headers.Prefer = AUTOFILL_AI_RESPOND_ASYNC;
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
      const query = call.query === undefined ? '' : `?${new URLSearchParams(call.query).toString()}`;
      response = await deps.platform.fetch(`${deps.origin}${call.path}${query}`, init);
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

  async function submit<T>(path: string, body: unknown, schema: z.ZodType<T>, options: AiSubmitOptions = {}):
    Promise<ServerResult<AiSubmitted<T>>> {
    const raw = await send({ method: 'POST', path, token: 'current', json: body, answer: { kind: 'task', schema },
      ...(options.async === true ? { async: true } : {}) });
    return raw.ok ? { ok: true, value: raw.value as AiSubmitted<T> } : raw;
  }

  // v5 p2-stream
  /** A read of the stream's body that gives up once `signal` aborts. */
  function readOrAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal):
    Promise<ReadableStreamReadResult<Uint8Array> | 'aborted'> {
    if (signal.aborted) return Promise.resolve('aborted');
    return new Promise((resolve, reject) => {
      const onAbort = () => resolve('aborted');
      signal.addEventListener('abort', onAbort, { once: true });
      reader.read().then((result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      }, (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
    });
  }

  /** One server-sent event's name and its data lines joined, or null for a message with no data (a comment). */
  function sseMessage(message: string): { name: string; data: string } | null {
    let name = 'message';
    const data: string[] = [];
    for (const line of message.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') name = value;
      else if (field === 'data') data.push(value);
    }
    return data.length === 0 ? null : { name, data: data.join('\n') };
  }

  /** GET /api/ai/tasks/:id/stream (ServerClient.aiTaskStream). */
  async function taskStream(id: string, options: AiStreamOptions): Promise<ServerResult<AutofillTaskView | null>> {
    const path = `/api/ai/tasks/${id}/stream`;
    if (!AutofillTaskIdSchema.safeParse(id).success || !isAllowedRequest('GET', path)) {
      log('server.path-refused');
      return failure('refused-path');
    }
    const token = await deps.token();
    if (token === null) return failure('not-connected');
    const started = deps.platform.now();
    // The headers within the usual 25 s; the body as long as the caller's signal allows (each read within the idle
    // limit, below): the 25 s timeout ends the request only while its headers have not come.
    const request = new AbortController();
    let answered = false;
    const end = () => request.abort();
    const headersLate = deps.platform.timeout(SERVER_TIMEOUT_MS);
    headersLate.addEventListener('abort', () => {
      if (!answered) request.abort(headersLate.reason);
    }, { once: true });
    if (options.signal.aborted) request.abort();
    else options.signal.addEventListener('abort', end, { once: true });
    let response: Response;
    try {
      response = await deps.platform.fetch(`${deps.origin}${path}`, {
        method: 'GET',
        headers: { [AUTOFILL_API_HEADER]: String(AUTOFILL_API_VERSION), Accept: 'text/event-stream',
          Authorization: `Bearer ${token}` },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: request.signal,
      });
      answered = true;
    } catch (error) {
      if (isTimeout(error)) {
        log('server.timeout', { stream: true });
        return failure('timeout');
      }
      log('server.unreachable', { stream: true });
      return failure('unreachable');
    }
    const version = response.headers.get(AUTOFILL_API_HEADER);
    if (version !== null) {
      const matches = version === String(AUTOFILL_API_VERSION);
      deps.onVersion(matches);
      if (!matches) {
        log('server.version-mismatch', { status: response.status, stream: true });
        await response.body?.cancel().catch(() => undefined);
        return failure('version-mismatch', { status: response.status });
      }
    }
    if (!response.ok) {
      const detail = await errorOf(response);
      log('server.refused', { status: response.status, stream: true });
      if (response.status === 401) await deps.onUnauthorized(token);
      return failure(failureOfStatus(response.status), { status: response.status, ...detail });
    }
    const reader = response.body?.getReader();
    if (!(response.headers.get('content-type') ?? '').startsWith('text/event-stream') || reader === undefined) {
      log('server.bad-answer', { status: response.status, stream: true });
      await response.body?.cancel().catch(() => undefined);
      return failure('bad-answer', { status: response.status });
    }
    const decoder = new TextDecoder();
    let buffer = '';
    /** The P2 review (security 7a, L2): a CR ending a chunk, held until the next one says whether an LF follows. */
    let carry = '';
    let bytes = 0;
    let items = 0;
    /** The stream's end: its reader let go, and one log line of counts. */
    const done = (result: ServerResult<AutofillTaskView | null>, why: string): ServerResult<AutofillTaskView | null> => {
      void reader.cancel().catch(() => undefined);
      log('server.stream-ended', { status: response.status, items, ms: deps.platform.now() - started,
        task: result.ok && result.value !== null, [why]: true });
      return result;
    };
    try {
      for (;;) {
        const read = await readOrAbort(reader,
          AbortSignal.any([options.signal, deps.platform.timeout(AI_STREAM_IDLE_MS)]));
        if (read === 'aborted') return done({ ok: true, value: null }, options.signal.aborted ? 'stopped' : 'idle');
        if (read.done) return done({ ok: true, value: null }, 'closed');
        bytes += read.value.byteLength;
        if (bytes > AI_STREAM_MAX_BYTES) return done(failure('too-large'), 'tooLarge');
        // Line ends are made LF across chunks: a CR LF split between two chunks stays one line end.
        const text = carry + decoder.decode(read.value, { stream: true });
        carry = text.endsWith('\r') ? '\r' : '';
        buffer += (carry === '' ? text : text.slice(0, -1)).replace(/\r\n?/g, '\n');
        for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
          const message = sseMessage(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
          if (message === null) continue;
          let json: unknown;
          try {
            json = JSON.parse(message.data);
          } catch {
            return done(failure('bad-answer', { status: response.status }), 'badAnswer');
          }
          const parsed = AutofillTaskStreamEventSchema.safeParse(json);
          if (!parsed.success || parsed.data.type !== message.name) {
            return done(failure('bad-answer', { status: response.status }), 'badAnswer');
          }
          if (parsed.data.type === 'task') return done({ ok: true, value: parsed.data.task }, 'finished');
          items += 1;
          options.onEvent(parsed.data);
        }
      }
    } catch (error) {
      return done({ ok: true, value: null }, isTimeout(error) ? 'idle' : 'broken');
    }
  }
  // v5 p2-stream end

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
      // v3 Phase 8 (the review's P3): a company's own page is named by its origin and path (and a gh_jid or ashby_jid)
      // alone, whichever lookup asks: the side panel's, a run's, the resume choice's.
      const raw = await json({ method: 'POST', path: '/api/autofill/lookup', token: 'current',
        json: { ...body, url: tailoritAddressOf(body.url) } }, LookupWireSchema);
      return raw.ok ? { ok: true, value: lookupOf(raw.value) } : raw;
    },
    async addJob(body) {
      const raw = await json({ method: 'POST', path: '/api/autofill/jobs', token: 'current',
        json: { ...body, url: tailoritAddressOf(body.url) } }, AddJobWireSchema);
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
    aiPick: (body, options) => submit('/api/autofill/ai/pick', body, AutofillPickTaskSchema, options),
    aiClassify: (body, options) => submit('/api/autofill/ai/classify', body, AutofillClassifyTaskSchema, options),
    aiDraft: (body, options) => submit('/api/autofill/ai/draft', body, AutofillDraftTaskSchema, options),
    aiAnswer: (body, options) => submit('/api/autofill/ai/answer', body, AutofillAnswerTaskSchema, options),
    aiTaskStream: (id, options) => taskStream(id, options),
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
    coverLetterText(id) {
      if (!AutofillCoverLetterIdSchema.safeParse(id).success) {
        log('server.path-refused');
        return Promise.resolve(failure('refused-path'));
      }
      return json({ method: 'GET', path: `/api/autofill/cover-letters/${id}/text`, token: 'current' },
        AutofillCoverLetterTextSchema);
    },
    searchJobs: (query) => json({ method: 'GET', path: '/api/autofill/jobs/search', token: 'current',
      query: { q: [...query].slice(0, AUTOFILL_JOB_SEARCH_QUERY_MAX).join('') } }, AutofillJobSearchResponseSchema),
    async applied(body) {
      const raw = await json({ method: 'POST', path: '/api/autofill/applied', token: 'current',
        json: body.url === undefined ? body : { ...body, url: tailoritAddressOf(body.url) } }, LookupWireSchema);
      return raw.ok ? { ok: true, value: lookupOf(raw.value) } : raw;
    },
    // v1.3 B
    async submissions(body) {
      const raw = await json({ method: 'POST', path: '/api/autofill/submissions', token: 'current',
        json: body.url === undefined ? body : { ...body, url: tailoritAddressOf(body.url) } },
      AutofillSubmissionResponseSchema.extend({ lookup: LookupWireSchema }));
      return raw.ok ? { ok: true, value: { ...raw.value, lookup: lookupOf(raw.value.lookup) } } : raw;
    },
    knownForm: (body) => json({ method: 'POST', path: '/api/autofill/forms/known', token: 'current',
      json: body.url === undefined ? body : { ...body, url: tailoritAddressOf(body.url) } },
    AutofillFormsKnownResponseSchema),
    async siteRequest(host) {
      const raw = await send({ method: 'POST', path: '/api/autofill/site-requests', token: 'current', json: { host },
        answer: { kind: 'none' } });
      return raw.ok ? { ok: true, value: null } : raw;
    },
    putProfile: (body) =>
      json({ method: 'PUT', path: '/api/autofill/profile', token: 'current', json: body }, PutAutofillProfileResponseSchema),
    agentNext: () => json({ method: 'GET', path: '/api/autofill/agent/next', token: 'current' }, AutofillAgentNextSchema),
    async agentResult(id, body) {
      if (!AutofillAgentIdSchema.safeParse(id).success) {
        log('server.path-refused');
        return failure('refused-path');
      }
      const raw = await send({ method: 'POST', path: `/api/autofill/agent/${id}/result`, token: 'current', json: body,
        answer: { kind: 'none' } });
      return raw.ok ? { ok: true, value: null } : raw;
    },
    credential(host, path) {
      if (!AutofillCredentialQuerySchema.safeParse({ host }).success) {
        log('server.path-refused');
        return Promise.resolve(failure('refused-path'));
      }
      // Version 6 (contract6): the page's pathname, only as the contract's query takes it (method header).
      const named = path !== undefined && AutofillCredentialQuerySchema.safeParse({ host, path }).success ? path : null;
      return json({ method: 'GET', path: '/api/autofill/credentials', token: 'current',
        query: named === null ? { host } : { host, path: named } }, AutofillCredentialSchema);
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
