/*
 * What the worker's Node tests share: a fake TailorIT (a scripted fetch that answers the contract's golden fixtures and
 * records every request), a fake core, a hand-driven clock and timers, and startTestWorker, which runs the real
 * worker over WXT's fake browser and the hand fakes. A testkit, not a test: nothing in the extension imports it, and
 * it imports no test runner, so it type-checks with the extension's own program.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import lookupGolden from '../contract/tailorit/v1/fixtures/AutofillLookupResponse/valid/golden.json';
import profileGolden from '../contract/tailorit/v1/fixtures/AutofillProfileEnvelope/valid/golden.json';
import redeemGolden from '../contract/tailorit/v1/fixtures/AutofillRedeemResponse/valid/golden.json';
import resumesGolden from '../contract/tailorit/v1/fixtures/AutofillResumeList/valid/golden.json';
import sensitiveGolden from '../contract/tailorit/v1/fixtures/AutofillSensitiveEnvelope/valid/golden.json';
import sessionGolden from '../contract/tailorit/v1/fixtures/AutofillSession/valid/golden.json';
import { AUTOFILL_API_VERSION, type AutofillProfile } from '../contract/tailorit';
import type { TiebreakItem } from '../core/matcher/types';
import type { PlanInput, PlanOutput } from '../core/plan/types';
import type { ClassifyItem } from '../core/resolver/classify';
import { sha256Hex as coreSha256Hex } from '../core/text/sha256';
import type { UntrustedText } from '../core/types/text';
import { attachResume } from '../core/profile/canonicalize';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { Profile } from '../core/types/profile';
import type { RunState } from '../core/types/run';
import type { Vocab } from '../core/vocab/types';
import { createWorkerPlatform } from '../platform/chrome';
import { installHandFakes, type FakePortPeer, type HandFakes, type RawSender, type TabMessage } from '../platform/fake';
import { createMemorySecrets } from '../platform/memory';
import type { FetchLike, WorkerPlatform } from '../platform/types';
import type { FrameReport } from '../shared/report';
import type { TokenRecord } from '../shared/stored';
import type { CoreFunctions } from './core';
import { startWorker, type WorkerState } from './index';
import { manualTimers } from './timers';

/** TailorIT's origin in the ext project (vitest.config.ts defines __TAILORIT_ORIGIN__ as this). */
export const ORIGIN = 'http://localhost:3100';
export const EXTENSION_ID = 'test-extension-id';
export const LEVER_URL = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply';
export const LEVER_KEY = 'lever:0123456789abcdef';
/** The golden redeem answer's token: the one the fake TailorIT hands out. */
export const GOLDEN_TOKEN = redeemGolden.token;
/** A clock start well past the golden token's issue and before its expiry (2027-01-20). */
export const START_MS = Date.UTC(2026, 9, 30, 12, 0, 0);

export const goldens = {
  lookup: lookupGolden,
  profile: profileGolden,
  redeem: redeemGolden,
  resumes: resumesGolden,
  sensitive: sensitiveGolden,
  session: sessionGolden,
};

/** A stored token record that expires long after START_MS. */
export function tokenRecord(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    token: GOLDEN_TOKEN,
    tokenId: redeemGolden.tokenId,
    expiresAt: Date.parse(redeemGolden.expiresAt),
    scopes: [...redeemGolden.scopes] as TokenRecord['scopes'],
    ...overrides,
  };
}

// ── The fake TailorIT ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RecordedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  init: RequestInit;
}

/** How the fake answers one request: a status with JSON or bytes, or a failure to answer at all. */
export type Reply =
  | { status?: number; json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> }
  | { fail: 'network' }
  /** Waits until the request's signal aborts (the client's timeout), then rejects with its reason. */
  | { fail: 'hang' };

export interface FakeTailorIT {
  fetch: FetchLike;
  requests: RecordedRequest[];
  /** Answers `METHOD /path` with `reply` from now on (`once`: for the next request only). */
  reply(route: string, reply: Reply | ((request: RecordedRequest) => Reply), options?: { once?: boolean }): void;
  /** How many requests went to `METHOD /path`. */
  count(route: string): number;
}

/** A small PDF: "%PDF-" then filler, `size` bytes in all. */
export function fakePdf(size = 1000): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  for (let i = 9; i < size; i += 1) bytes[i] = 0x41 + (i % 26);
  return bytes;
}

/** A small DOCX: the ZIP signature then filler. */
export function fakeDocx(size = 1000): Uint8Array {
  const bytes = fakePdf(size);
  bytes.set([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The resume file as TailorIT sends it: the bytes with their kind and SHA-256 headers. */
export async function fileReply(bytes: Uint8Array, kind = 'pdf', sha?: string): Promise<Reply> {
  return {
    status: 200,
    bytes,
    headers: {
      'Content-Type': kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      'X-TailorIT-File-Kind': kind,
      'X-TailorIT-Sha256': sha ?? (await sha256Hex(bytes)),
    },
  };
}

export function createFakeTailorIT(): FakeTailorIT {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, Array<{ reply: Reply | ((request: RecordedRequest) => Reply); once: boolean }>>();
  const defaults: Record<string, Reply> = {
    'POST /api/autofill/connect/redeem': { json: redeemGolden },
    'GET /api/autofill/session': { json: sessionGolden },
    'DELETE /api/autofill/session': { status: 204 },
    'GET /api/autofill/profile': { json: profileGolden },
    'GET /api/autofill/profile/sensitive': { json: sensitiveGolden },
    'POST /api/autofill/lookup': { json: lookupGolden },
    'GET /api/autofill/resumes': { json: resumesGolden },
    // Phase 6: no saved answer until a test scripts some.
    'GET /api/autofill/answers': { json: { items: [], total: 0, limit: 500 } },
  };
  const pdf = fakePdf();

  async function fetch(url: string, init: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)
      .map(([key, value]) => [key.toLowerCase(), value]));
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url,
      path: parsed.pathname,
      headers,
      body: typeof init.body === 'string' ? init.body : null,
      init,
    };
    requests.push(request);
    // A task's own path is scripted as its route (`GET /api/ai/tasks/:id`), whatever its id.
    const exact = `${request.method} ${request.path}`;
    const route = /^\/api\/ai\/tasks\/[^/]+$/.test(request.path) && !routes.has(exact)
      ? `${request.method} /api/ai/tasks/:id` : exact;
    const queue = routes.get(route) ?? [];
    const scripted = queue[0];
    if (scripted?.once) queue.shift();
    let reply: Reply | undefined = scripted
      ? typeof scripted.reply === 'function' ? scripted.reply(request) : scripted.reply
      : defaults[route] ?? AI_DEFAULTS[route]?.(request);
    if (!reply && /^GET \/api\/autofill\/resumes\/[a-z0-9-]+\/file$/.test(route)) reply = await fileReply(pdf);
    reply ??= { status: 404, json: { error: { code: 'not_found', message: 'Not found' } } };
    if ('fail' in reply) {
      if (reply.fail === 'network') throw new TypeError('Failed to fetch');
      const signal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const answerHeaders = new Headers(reply.headers ?? {});
    // TailorIT names its version on every answer to a request that presents an extension token.
    if (headers.authorization?.startsWith('Bearer tia_') && !answerHeaders.has('X-TailorIT-Autofill-Api')) {
      answerHeaders.set('X-TailorIT-Autofill-Api', String(AUTOFILL_API_VERSION));
    }
    const status = reply.status ?? 200;
    if (reply.bytes) {
      answerHeaders.set('Content-Length', String(reply.bytes.byteLength));
      return new Response(reply.bytes as Uint8Array<ArrayBuffer>, { status, headers: answerHeaders });
    }
    if (status === 204 || reply.json === undefined) return new Response(null, { status, headers: answerHeaders });
    answerHeaders.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(reply.json), { status, headers: answerHeaders });
  }

  return {
    fetch,
    requests,
    reply(route, reply, options = {}) {
      const queue = routes.get(route) ?? [];
      if (options.once) queue.unshift({ reply, once: true });
      else queue.splice(0, queue.length, { reply, once: false });
      routes.set(route, queue);
    },
    count: (route) => requests.filter((request) => `${request.method} ${request.path}` === route
      || (route.endsWith('/:id') && `${request.method} ${request.path}`.startsWith(route.slice(0, -3)))).length,
  };
}

/** A task id the fake TailorIT hands out. */
export const TASK_ID = '3f6a2d1e-8b4c-4e7a-9d05-1c2b3a4f5e60';

/** A task view, as TailorIT's AiTaskView shows one. */
export function taskView(kind: 'autofill_pick' | 'autofill_classify' | 'autofill_draft' | 'autofill_answer',
  status: 'queued' | 'running' | 'succeeded'
  | 'failed' | 'cancelled', result: unknown = null, id = TASK_ID): Record<string, unknown> {
  const finished = status !== 'queued' && status !== 'running';
  return { id, kind, status, result: status === 'succeeded' ? result : null,
    error: status === 'failed' ? { code: 'ai_failed', message: 'The AI request failed.' } : null,
    createdAt: '2026-10-30T12:00:00.000Z', startedAt: status === 'queued' ? null : '2026-10-30T12:00:00.100Z',
    finishedAt: finished ? '2026-10-30T12:00:04.000Z' : null };
}

/** The items a recorded AI request asked about. */
export function itemsOf(request: RecordedRequest): Array<Record<string, unknown>> {
  return (JSON.parse(request.body ?? '{}') as { items?: Array<Record<string, unknown>> }).items ?? [];
}

/** The fake TailorIT's AI answers when a test scripts none: every pick no_match, every classification unknown, every
 *  draft DRAFT_TEXT, at once (200); a task id it never handed out is not found. And (Phase 6) a saved answer PUT is kept
 *  as sent. */
const AI_DEFAULTS: Record<string, (request: RecordedRequest) => Reply> = {
  'POST /api/autofill/ai/pick': (request) => ({ json: taskView('autofill_pick', 'succeeded', { picks: itemsOf(request)
    .map((item) => ({ key: item.key, optionSetHash: item.optionSetHash, index: null, reason: 'no_match' })) }) }),
  'POST /api/autofill/ai/classify': (request) => ({ json: taskView('autofill_classify', 'succeeded', { items: itemsOf(request)
    .map((item) => ({ key: item.key, category: null, reason: 'unknown' })) }) }),
  // Phase 6: a saved answer as TailorIT keeps it (its category dropped).
  'PUT /api/autofill/answers': (request) => {
    const { category: _category, ...body } = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    return { json: { id: '8c1e5b3a-2d7f-4a9e-b6c4-0f3d8e2a7b15', ...body, createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z' } };
  },
  // Phase 6: every question drafted with DRAFT_TEXT.
  'POST /api/autofill/ai/draft': (request) => ({ json: taskView('autofill_draft', 'succeeded', { drafts: questionsOf(request)
    .map((question) => ({ key: question.key, text: DRAFT_TEXT, reason: 'drafted' })) }) }),
  // The owner's amendments: every choice answered with its first option, every text with ANSWER_TEXT, as guesses.
  'POST /api/autofill/ai/answer': (request) => ({ json: taskView('autofill_answer', 'succeeded', { answers: itemsOf(request)
    .map((item) => (item.shape === 'choice'
      ? { key: item.key, optionSetHash: item.optionSetHash, index: (item.options as Array<{ index: number }>)[0]!.index,
        text: null, basis: 'guess', reason: 'answered' }
      : { key: item.key, optionSetHash: null, index: null, text: ANSWER_TEXT, basis: 'guess', reason: 'answered' })) }) }),
};

/** The fake TailorIT's text answer when a test scripts none (the owner's amendments). */
export const ANSWER_TEXT = 'Four years';

/** The fake TailorIT's draft when a test scripts none (Phase 6). */
export const DRAFT_TEXT = 'I have built ordering platforms for four years, and I would like to bring that here.';

/** The questions a recorded draft request asked (Phase 6). */
export function questionsOf(request: RecordedRequest): Array<Record<string, unknown>> {
  return (JSON.parse(request.body ?? '{}') as { questions?: Array<Record<string, unknown>> }).questions ?? [];
}

// ── The fake core ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A canonical profile with just what the worker's tests read: names, email, city, skills. */
export function fakeProfile(wire: AutofillProfile): Profile {
  return {
    identity: {
      fullName: `${wire.name.first} ${wire.name.last}`,
      firstName: wire.name.first,
      lastName: wire.name.last,
      nameSplitDerived: false,
    },
    contact: { email: wire.contact.email },
    address: { city: wire.contact.address.city },
    links: { other: [] },
    workAuthorization: [],
    eeo: {},
    screening: {},
    education: [],
    experience: [],
    languages: [],
    skills: [...wire.skills],
    preferences: {},
  };
}

/** Every string a fake profile holds, folded: the fake persistableCanaries drops any canary equal to one. */
function profileStrings(profile: Profile): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') found.add(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(profile);
  return found;
}

/** A row for a field the fake planner leaves alone. */
export function skippedRow(spec: FieldSpec): FillResult {
  return {
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    category: 'unknown',
    section: spec.section.id,
    required: spec.required,
    status: 'skipped',
    provenance: null,
    matcherStage: 'not-applicable',
    confidence: 0,
    reason: 'unknown-field',
    wrote: false,
    verification: 'not-checked',
    needsUserAction: false,
  };
}

export interface FakeCore extends CoreFunctions {
  calls: { planFrame: PlanInput[]; canonicalize: Array<{ sensitive: boolean }>; persistable: string[][]; policy: string[] };
}

/** A core that plans nothing (every field skipped), unless a test passes its own functions. */
export function fakeCore(overrides: Partial<CoreFunctions> = {}): FakeCore {
  const calls: FakeCore['calls'] = { planFrame: [], canonicalize: [], persistable: [], policy: [] };
  const vocab = {} as Vocab;
  const core: CoreFunctions = {
    planFrame: (input) => ({
      writes: [],
      results: input.specs.map(skippedRow),
      awaiting: [],
      needsSensitive: false,
      persistableCanaries: [],
    }),
    canonicalizeProfile: (profile, sensitive) => ({
      profile: fakeProfile(profile),
      issues: [],
      sensitiveState: sensitive ? 'loaded' : 'not-loaded',
    }),
    // The real one: it only sets or drops `resume`, so tests can read what a plan attached.
    attachResume: (profile, choice) => attachResume(profile, choice),
    persistableCanaries: (canaries, profile) => {
      const values = profileStrings(profile);
      return canaries.filter((canary) => !values.has(canary.toLowerCase()));
    },
    policyHits: (text) => (/do not use ai/i.test(text) ? ['no-ai-tools'] : []),
    vocab: () => vocab,
    ...overrides,
  };
  return {
    calls,
    planFrame(input) {
      calls.planFrame.push(input);
      return core.planFrame(input);
    },
    canonicalizeProfile(profile, sensitive, vocabulary, now) {
      calls.canonicalize.push({ sensitive: sensitive !== null });
      return core.canonicalizeProfile(profile, sensitive, vocabulary, now);
    },
    persistableCanaries(canaries, profile) {
      calls.persistable.push([...canaries]);
      return core.persistableCanaries(canaries, profile);
    },
    policyHits(text) {
      calls.policy.push(text);
      return core.policyHits(text);
    },
    attachResume: core.attachResume,
    vocab: core.vocab,
  };
}

// ── The worker under test ─────────────────────────────────────────────────────────────────────────────────────────

export interface TestWorker {
  state: WorkerState;
  fakes: HandFakes;
  tailorit: FakeTailorIT;
  core: FakeCore;
  secrets: ReturnType<typeof createMemorySecrets>;
  timers: ReturnType<typeof manualTimers>;
  /** Every timeout signal the server client asked for, with its length; abort one to time its request out. */
  timeouts: Array<{ ms: number; controller: AbortController }>;
  clock: { now: number };
  platform: WorkerPlatform;
  /** Delivers a one-shot message with an explicit sender (the fake's own sendMessage sends an empty one). */
  deliver(message: unknown, sender: RawSender): Promise<unknown>;
  /** Delivers an external message, as TailorIT's page would send one. */
  deliverExternal(message: unknown, sender: RawSender): Promise<unknown>;
  connect(name: string, sender: RawSender): FakePortPeer;
}

export interface TestWorkerOptions {
  /** A token already stored when the worker starts; none by default. */
  token?: TokenRecord | null;
  core?: Partial<CoreFunctions>;
  tailorit?: FakeTailorIT;
  /** Runs after the fakes are installed and before the worker starts (to refuse an API, or seed storage). */
  before?(fakes: HandFakes): void | Promise<void>;
  /** false: answer as soon as the worker's listeners are registered, without waiting for its start-up (the storage
   *  access level, then the prune), so a test can deliver while Chrome has not answered. True by default. */
  awaitStartUp?: boolean;
}

/** Resets the fake browser, installs the hand fakes and starts the real worker over them. */
export async function startTestWorker(options: TestWorkerOptions = {}): Promise<TestWorker> {
  const secrets = createMemorySecrets();
  if (options.token) await secrets.set(options.token);
  return launch(options, { secrets, clock: { now: START_MS }, tailorit: options.tailorit ?? createFakeTailorIT() });
}

/**
 * Stops `previous` as the browser stops an idle worker and starts a new one: memory (the profile, the token's copy,
 * the runs' lookups, the timers) is gone, while storage.local, storage.session, IndexedDB and TailorIT stay.
 */
export async function restartTestWorker(previous: TestWorker, options: TestWorkerOptions = {}): Promise<TestWorker> {
  const local = await fakeBrowser.storage.local.get(null);
  const session = await fakeBrowser.storage.session.get(null);
  return launch(
    {
      ...options,
      before: async (fakes) => {
        await fakeBrowser.storage.local.set(local);
        await fakeBrowser.storage.session.set(session);
        await options.before?.(fakes);
      },
    },
    { secrets: previous.secrets, clock: previous.clock, tailorit: previous.tailorit },
  );
}

async function launch(
  options: TestWorkerOptions,
  kept: { secrets: ReturnType<typeof createMemorySecrets>; clock: { now: number }; tailorit: FakeTailorIT },
): Promise<TestWorker> {
  fakeBrowser.reset();
  const fakes = installHandFakes();
  await options.before?.(fakes);
  const { tailorit, secrets, clock } = kept;
  const timers = manualTimers();
  const timeouts: TestWorker['timeouts'] = [];
  const core = fakeCore(options.core);
  const platform: WorkerPlatform = {
    ...createWorkerPlatform(),
    secrets,
    fetch: tailorit.fetch,
    timeout: (ms) => {
      const controller = new AbortController();
      timeouts.push({ ms, controller });
      return controller.signal;
    },
    now: () => clock.now,
  };
  const state = startWorker({ platform, core, timers, origin: ORIGIN });
  if (options.awaitStartUp !== false) await state.ready;
  const answerOf = (event: { trigger(...args: never[]): unknown }, message: unknown, sender: RawSender) =>
    new Promise<unknown>((resolve) => {
      (event.trigger as (m: unknown, s: unknown, r: (a: unknown) => void) => unknown)(message, sender, resolve);
    });
  return {
    state,
    fakes,
    tailorit,
    core,
    secrets,
    timers,
    timeouts,
    clock,
    platform,
    deliver: (message, sender) => answerOf(fakeBrowser.runtime.onMessage as never, message, sender),
    deliverExternal: (message, sender) => answerOf(fakes.onMessageExternal as never, message, sender),
    connect: (name, sender) => fakes.connect(name, sender),
  };
}

// ── Senders and messages ──────────────────────────────────────────────────────────────────────────────────────────

/** A content script in a Lever application frame. */
export function contentSender(overrides: Partial<RawSender> = {}): RawSender {
  return { id: EXTENSION_ID, url: LEVER_URL, tab: { id: 7 }, frameId: 0, documentId: 'doc-1', documentLifecycle: 'active', ...overrides };
}

/** One of the extension's own pages (the side panel). */
export function pageSender(path = 'sidepanel.html'): RawSender {
  return { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/${path}` };
}

/** TailorIT's connect page, as Chrome describes it to onMessageExternal. */
export function connectPageSender(overrides: Partial<RawSender> = {}): RawSender {
  return { url: `${ORIGIN}/settings/autofill?tab=extension&connect=1`, origin: ORIGIN, tab: { id: 3 }, frameId: 0, ...overrides };
}

/** The type of a message the worker sent to a frame. */
export const typeOfSent = (sent: TabMessage) => (sent.message as { type?: unknown } | undefined)?.type;

/** What the worker sent to frames, leaving out the frame/ping probes a new document sets off in the background. */
export function sentToFrames(worker: TestWorker): TabMessage[] {
  return worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) !== 'frame/ping');
}

/** Chrome's sentence for a message nothing received: what a frame whose document is gone answers. */
export const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

/** A field as a frame's scan would send it. */
export function fieldSpec(index: number, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return {
    key: `lever|main|field-${index}|none|0` as FieldKey,
    baseKey: `lever|main|field-${index}|0` as FieldSpec['baseKey'],
    platform: 'lever',
    section: { id: 'main' },
    kind: 'text',
    label: `Field ${index}`,
    labelSource: 'for',
    labelVisible: true,
    description: '',
    required: false,
    options: [],
    optionSetHash: 'none' as FieldSpec['optionSetHash'],
    constraints: {},
    autocomplete: [],
    nameAttr: `field${index}`,
    idAttr: `field${index}`,
    ordinal: 0,
    domOrder: index,
    visibility: 'visible',
    disabled: false,
    readOnly: false,
    current: { kind: 'empty' },
    ...overrides,
  };
}

/** A RunState for LEVER_KEY with no canaries. */
export function runState(overrides: Partial<RunState> = {}): RunState {
  return {
    version: 1,
    applicationKey: LEVER_KEY,
    platform: 'lever',
    status: 'review',
    resumeStatus: null,
    pauseReason: null,
    stepSignature: null,
    stepIndex: 0,
    stepAttempts: {},
    filledFieldKeys: {},
    repeatableCounters: {},
    canarySet: [],
    tripwire: { triggered: false, hits: 0 },
    policyDecision: null,
    revealEdges: [],
    aiTasks: {},
    lastFill: null,
    startedAt: START_MS,
    updatedAt: START_MS,
    ...overrides,
  };
}

/** A frame's report with one row. */
export function frameReport(runId: string, frameId = 0, overrides: Partial<FrameReport> = {}): FrameReport {
  const row = skippedRow(fieldSpec(1));
  return {
    v: 1,
    runId,
    frameId,
    platform: 'lever',
    adapter: 'lever',
    mode: 'fill',
    status: 'review',
    pauseReason: null,
    fields: [row],
    notices: [],
    counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 },
    updatedAt: START_MS,
    ...overrides,
  };
}

/** Begins a run for the default content sender and answers its id. */
export async function beginRun(worker: TestWorker, overrides: Record<string, unknown> = {}, sender = contentSender()):
  Promise<string> {
  const answer = (await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false,
    ...overrides }, sender)) as { ok: boolean; data?: { runId: string } };
  if (!answer.ok || !answer.data) throw new Error(`run/begin was refused: ${JSON.stringify(answer)}`);
  return answer.data.runId;
}

/** A plan output for tests that script the planner. */
export function planOutput(overrides: Partial<PlanOutput> = {}): PlanOutput {
  return { writes: [], results: [], awaiting: [], needsSensitive: false, persistableCanaries: [], ...overrides };
}

// ── A core that asks the LLM ──────────────────────────────────────────────────────────────────────────────────────

/** The tiebreak item the asking core builds for a field with options: every option a candidate, the clean label
 *  hashed as the real core hashes it; an option whose label starts with '!' is the tainted one (injected). */
export function tiebreakItemOf(spec: FieldSpec): TiebreakItem {
  const options = spec.options === 'lazy' ? [] : spec.options;
  return {
    id: spec.key,
    category: 'referral_source',
    fieldLabel: spec.label as UntrustedText,
    optionSetHash: spec.optionSetHash,
    intended: 'LinkedIn',
    aliases: ['LinkedIn Jobs'],
    candidates: options.map((option) => {
      const label = option.label.replace(/^!/, '') as UntrustedText;
      return { optionIndex: option.index, label, labelHash: coreSha256Hex(label), hardConflict: false,
        injected: option.label.startsWith('!') };
    }),
  };
}

/** The classify item the asking core builds for a field with no options. */
export function classifyItemFor(spec: FieldSpec): ClassifyItem {
  return { key: spec.key, platform: spec.platform, kind: spec.kind, label: spec.label as UntrustedText,
    hint: '' as UntrustedText, section: '' as UntrustedText, options: [] };
}

/**
 * planFrame, scripted for the worker's AI tests: every planned field it has no answer for waits for the LLM (a field
 * with options as a tiebreak of them, any other as a classification); an answered one gets the row the real planner
 * gives it, and a valid pick its llm-pick write. The real planner is tested on its own (src/core/plan/llm.test.ts).
 */
export function askingCore(): Pick<CoreFunctions, 'planFrame'> {
  return {
    planFrame(input) {
      const wanted = input.planKeys === undefined ? null : new Set<string>(input.planKeys);
      const specs = input.specs.filter((spec) => wanted === null || wanted.has(spec.key));
      const output: PlanOutput = { writes: [], results: [], awaiting: [], needsSensitive: false, persistableCanaries: [] };
      const tiebreaks: TiebreakItem[] = [];
      const classify: ClassifyItem[] = [];
      for (const spec of specs) {
        const row = skippedRow(spec);
        const options = spec.options !== 'lazy' && spec.options.length > 0;
        if (options) {
          const answered = input.ai?.verdicts.get(spec.key);
          const item = tiebreakItemOf(spec);
          if (answered === undefined) {
            tiebreaks.push(item);
            output.awaiting.push(spec.key);
            output.results.push({ ...row, status: 'flagged', reason: 'ambiguous-options', needsUserAction: true });
            continue;
          }
          const { verdict, taskId } = answered;
          const candidate = verdict.picked === null ? undefined : item.candidates[verdict.picked];
          if (candidate === undefined || verdict.why !== 'ok') {
            output.results.push({ ...row, status: 'flagged', reason: verdict.why === 'ok' ? 'no-match' : verdict.why,
              needsUserAction: true });
            continue;
          }
          output.writes.push({ key: spec.key, value: { kind: 'option', index: candidate.optionIndex, cleanLabel: candidate.label },
            origin: { provenance: 'llm-pick', taskId, pickedCandidate: verdict.picked!, labelHash: candidate.labelHash },
            match: { stage: 'llm', optionIndex: candidate.optionIndex, rule: 'llm-index', confidence: 0.75, flags: [],
              suggestions: [], reason: 'llm-pick-needs-review' } });
          output.results.push({ ...row, status: 'flagged', provenance: 'llm-pick', matcherStage: 'llm', confidence: 0.69,
            reason: 'llm-pick-needs-review', needsUserAction: true });
          continue;
        }
        const classified = input.ai?.classifications.get(spec.key);
        if (classified === undefined) {
          classify.push(classifyItemFor(spec));
          output.awaiting.push(spec.key);
          output.results.push(row);
          continue;
        }
        output.results.push(classified.category === null
          ? { ...row, reason: classified.why === 'unknown-field' ? 'unknown-field' : classified.why }
          : { ...row, category: 'experience.currentCompany', status: 'flagged', reason: 'llm-classified-needs-review' });
      }
      if (output.awaiting.length > 0) output.ask = { tiebreaks, classify };
      return output;
    },
  };
}
