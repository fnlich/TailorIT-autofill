/*
 * What the content runtime's browser tests share: a test content platform (the in-memory one, with the worker's
 * messages deliverable from any sender), and a fake worker that answers the content messages the way the real one
 * does, planning with the real core: planFrame over the golden "Alex Rivera" profile (canonicalized with its sensitive
 * part and the golden resume attached) and the bundled vocabulary. It serves the resume port with a resume given as
 * bytes, and records every message, report, RunState and port message it sees, so a test can check that none carries a
 * value. A testkit, not a test: nothing in the extension imports it, and it loads the vocabulary (about 2 MB) for the
 * tests only; the content script never does.
 */
import type { AutofillProfile, AutofillSensitive } from '../contract/tailorit';
import { DOCX_MIME } from '../dom/fillers';
import { planFrame } from '../core/plan/frame';
import type { PlanOutput } from '../core/plan/types';
import { attachResume, canonicalizeProfile } from '../core/profile/canonicalize';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { Profile, Ymd } from '../core/types/profile';
import type { RunState } from '../core/types/run';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { createVocab } from '../core/vocab/createVocab';
import type { RawVocab, Vocab } from '../core/vocab/types';
import answers from '../core/vocab/data/answers.json?raw';
import countries from '../core/vocab/data/countries.json?raw';
import degrees from '../core/vocab/data/degrees.json?raw';
import fields from '../core/vocab/data/fields.json?raw';
import institutionsGlobal from '../core/vocab/data/institutions-global.json?raw';
import institutionsUs from '../core/vocab/data/institutions-us.json?raw';
import languages from '../core/vocab/data/languages.json?raw';
import lexicon from '../core/vocab/data/lexicon.json?raw';
import manifest from '../core/vocab/data/manifest.json?raw';
import regions from '../core/vocab/data/regions.json?raw';
import { RESUME_CHUNK_BYTES, ResumePortMessageSchema, type ContentMessage } from '../messaging/schemas';
import { createMemoryContentPlatform } from '../platform/memory';
import type { ContentPlatform, Handler, PortLike, Sender } from '../platform/types';
import type { FrameReport } from '../shared/report';
import profileJson from '../../fixtures/profiles/alex-rivera.profile.json';
import sensitiveJson from '../../fixtures/profiles/alex-rivera.sensitive.json';

/** The day the fake worker plans on. */
export const NOW: Ymd = { y: 2026, m: 10, d: 30 };

/** The trap fixtures' address: the generic adapter handles them on Lever's host. */
export const trapUrl = (id: string) => `https://jobs.lever.co/tailorit-fixture/trap-${id}/apply`;

let vocab: Vocab | null = null;
/** The bundled vocabulary, built once per test file. */
export function testVocab(): Vocab {
  vocab ??= createVocab({
    manifest: JSON.parse(manifest), institutionsUs: JSON.parse(institutionsUs),
    institutionsGlobal: JSON.parse(institutionsGlobal), fields: JSON.parse(fields), degrees: JSON.parse(degrees),
    countries: JSON.parse(countries), regions: JSON.parse(regions), languages: JSON.parse(languages),
    answers: JSON.parse(answers), lexicon: JSON.parse(lexicon),
  } as RawVocab);
  return vocab;
}

/** The golden resume, as the lookup names it. */
export const GOLDEN_RESUME = { id: 'resume-alex-rivera', fileName: 'Alex Rivera Resume.pdf', fileKind: 'pdf' } as const;

let golden: Profile | null = null;
/** The golden profile, canonicalized with its sensitive part, the golden resume attached. */
export function goldenProfile(): Profile {
  golden ??= attachResume(canonicalizeProfile(profileJson as unknown as AutofillProfile,
    sensitiveJson as unknown as AutofillSensitive, testVocab(), NOW).profile, GOLDEN_RESUME, 48_213);
  return golden;
}

/** The golden profile with a self-described gender in the person's own `words`, for the EEO self-describe follow-up
 *  (the golden part declines to say). */
export function selfDescribedProfile(words: string): Profile {
  const sensitive = sensitiveJson as unknown as AutofillSensitive;
  const described = { ...sensitive, eeo: { ...sensitive.eeo, gender: { state: 'value' as const,
    value: { identity: 'self-describe' as const, selfDescribed: words } } } } as AutofillSensitive;
  return attachResume(canonicalizeProfile(profileJson as unknown as AutofillProfile, described, testVocab(), NOW).profile,
    GOLDEN_RESUME, 48_213);
}

/**
 * The golden profile's free-text values, which must never appear in a report, a RunState, a log or a policy hit
 * (docs/ARCHITECTURE.md, assertTrapInvariants). The skills (TypeScript, PostgreSQL, Kubernetes) and the city (Austin)
 * are also page text on some traps, as option labels or a canary, so they are checked separately where that is so.
 */
export const VALUE_SENTINELS = ['alex', 'rivera', 'f7q2', '512 555 0147', '5125550147', '4417', 'quillfeather',
  'marrowgate', '78701', 'senior software engineer', 'university of texas'] as const;
export const PAGE_TEXT_SENTINELS = ['typescript', 'postgresql', 'kubernetes', 'austin'] as const;

/** The golden profile's free text a follow-up box takes: its referral source (it declines to self-describe, so it has
 *  no self-description). Page text on some pages (a "LinkedIn" option, a "LinkedIn profile" label), so it is looked
 *  for where no page text goes, and in reports with each row's label and label slug set aside (withoutPageLabels). */
export const FREE_TEXT_SENTINELS = ['linkedin'] as const;

/** A report with what is page text set aside: each row's label, and the label slug in its key and in its parent's;
 *  and its category, a closed enum that names the question, never its answer ("links.linkedin"). */
export function withoutPageLabels(report: FrameReport): unknown {
  const slugless = (key: string) => {
    const parts = key.split('|');
    if (parts.length === 4 || parts.length === 5) parts[2] = '<label>';
    return parts.join('|');
  };
  return { ...report, fields: report.fields.map(({ label: _label, category: _category, ...row }) => ({ ...row,
    key: slugless(row.key),
    ...(row.detail ? { detail: { ...row.detail, ...(row.detail.revealedBy !== undefined
      ? { revealedBy: slugless(row.detail.revealedBy) } : {}) } } : {}) })) };
}

/** The sentinels `text` holds, case-insensitively. */
export function sentinelsIn(text: string, sentinels: readonly string[] = VALUE_SENTINELS): string[] {
  const folded = text.toLowerCase();
  return sentinels.filter((sentinel) => folded.includes(sentinel));
}

/** A content platform for tests: the in-memory one, whose handler can be called as any sender. */
export interface TestPlatform extends ContentPlatform {
  readonly sent: unknown[];
  /** Delivers a worker message as the worker (this extension, no tab). */
  deliver(message: unknown): Promise<unknown>;
  /** Delivers a message as `sender`. */
  deliverFrom(message: unknown, sender: Sender): Promise<unknown>;
  /** Makes the platform say the extension is gone (isValid false, sends fail as context-invalidated). */
  invalidate(): void;
  readonly handlerRegistered: boolean;
}

/**
 * Two linked port ends with Chrome's ordering: a message reaches the other end asynchronously, and one posted just
 * before a disconnect still arrives, before the other end's onDisconnect (the worker posts resume/error and disconnects,
 * and so may the content script). A closed end cannot post; one that disconnected receives nothing more.
 */
export function orderedPortPair(name: string, sender?: Sender): [PortLike, PortLike] {
  const listeners: [Array<(message: unknown) => void>, Array<(message: unknown) => void>] = [[], []];
  const disconnects: [Array<() => void>, Array<() => void>] = [[], []];
  const left: [boolean, boolean] = [false, false];
  let closed = false;
  const end = (self: 0 | 1): PortLike => {
    const other = self === 0 ? 1 : 0;
    return {
      name,
      sender: self === 1 ? sender : undefined,
      post(message) {
        if (closed) throw new Error('Attempting to use a disconnected port object');
        const copy = JSON.parse(JSON.stringify(message)) as unknown;
        queueMicrotask(() => {
          if (!left[other]) for (const cb of [...listeners[other]]) cb(copy);
        });
      },
      onMessage(cb) {
        listeners[self].push(cb);
        return () => void listeners[self].splice(listeners[self].indexOf(cb), 1);
      },
      onDisconnect(cb) {
        disconnects[self].push(cb);
        return () => void disconnects[self].splice(disconnects[self].indexOf(cb), 1);
      },
      disconnect() {
        if (closed) return;
        closed = true;
        left[self] = true;
        queueMicrotask(() => {
          for (const cb of [...disconnects[other]]) cb();
        });
      },
    };
  };
  return [end(0), end(1)];
}

/** A test platform over a scripted worker. */
export function createTestPlatform(worker: (message: unknown) => Promise<unknown>,
  connectWorker?: (port: PortLike) => void, options: { id?: string } = {}): TestPlatform {
  const memory = createMemoryContentPlatform(worker);
  const id = options.id ?? memory.runtime.id ?? 'memory-extension';
  let handler: Handler | null = null;
  let valid = true;
  return {
    sent: memory.sent,
    runtime: {
      get id() {
        return valid ? id : undefined;
      },
      async send(message) {
        if (!valid) throw 'context-invalidated';
        return memory.runtime.send(message);
      },
      connect(name) {
        const [content, workerEnd] = orderedPortPair(name, { id });
        if (connectWorker) connectWorker(workerEnd);
        else workerEnd.disconnect();
        return content;
      },
      onMessage(next) {
        handler = next;
        memory.runtime.onMessage(next);
      },
      isValid: () => valid,
    },
    now: () => 0,
    deliver: (message) => (handler ? handler(message, { id }) : Promise.resolve(undefined)),
    deliverFrom: (message, sender) => (handler ? handler(message, sender) : Promise.resolve(undefined)),
    invalidate() {
      valid = false;
    },
    get handlerRegistered() {
      return handler !== null;
    },
  };
}

/** A resume the fake worker serves. */
export interface FakeResume {
  bytes: Uint8Array;
  name: string;
  mime: string;
  /** Spoils a byte of the first chunk of the first `count` transfers, so their hash does not match. */
  corrupt?: number;
  /** Refuses every request with this reason. */
  refuse?: 'resume-unavailable' | 'resume-format-unsupported';
  /** Disconnects after sending this many chunks of the first transfer, as a stopped worker would. */
  dropAfterChunks?: number;
}

/** A PDF of `size` bytes (it starts with %PDF-). */
export function fakePdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const head = '%PDF-1.7\n% golden resume\n';
  for (let i = 0; i < size; i += 1) bytes[i] = i < head.length ? head.charCodeAt(i) : (i * 31 + 7) % 251;
  return bytes;
}

/** The hex SHA-256 of bytes. */
export async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** What the fake worker answers and does. */
export interface FakeWorkerOptions {
  policy?: { postingPage: 'hit' | 'clear' | 'unseen'; storedCopy: 'hit' | 'clear' | 'unavailable' };
  /** Changes a plan before it is answered (trap 8's draft). */
  editPlan?(plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput;
  /** Answers for these message types, used up in order before the default ones. */
  script?: Partial<Record<ContentMessage['type'], unknown[]>>;
  resume?: FakeResume;
  connected?: boolean;
  /** Called when a message arrives, before it is answered. */
  onMessage?(message: { type: string }): void;
  /** The profile it plans with (the golden one by default). */
  profile?: Profile;
  /** The platform's extension id. */
  id?: string;
}

/** The fake worker, its platform and what it saw. */
export interface FakeWorker {
  platform: TestPlatform;
  /** Every message, in order. */
  readonly messages: Array<{ type: string } & Record<string, unknown>>;
  readonly reports: FrameReport[];
  readonly runStates: RunState[];
  /** Every message posted on a resume port, both ways. */
  readonly portLog: Array<{ from: 'content' | 'worker'; message: { type: string } & Record<string, unknown> }>;
  /** The messages of one type. */
  of(type: string): Array<{ type: string } & Record<string, unknown>>;
}

/** A fake worker whose plans come from the real planFrame and the golden profile. */
export function createFakeWorker(options: FakeWorkerOptions = {}): FakeWorker {
  const messages: FakeWorker['messages'] = [];
  const reports: FrameReport[] = [];
  const runStates: RunState[] = [];
  const portLog: FakeWorker['portLog'] = [];
  const runs = new Map<string, { dryRun: boolean }>();
  let nextRun = 1;
  let transfers = 0;
  const settings = { panel: 'side' as const, autoAdvance: false, llm: { tiebreak: true, classify: true, drafts: false } };

  const scripted = (type: string): unknown => {
    const queue = options.script?.[type as ContentMessage['type']];
    return queue && queue.length > 0 ? queue.shift() : undefined;
  };

  async function answer(raw: unknown): Promise<unknown> {
    const message = raw as { type: string } & Record<string, unknown>;
    messages.push(message);
    options.onMessage?.(message);
    const script = scripted(message.type);
    if (script !== undefined) return script;
    switch (message.type) {
      case 'frame/hello':
        return { ok: true, data: { frameId: 0, connected: options.connected ?? true, settings } };
      case 'run/begin': {
        if (options.connected === false) return { ok: false, error: 'not_connected' };
        const runId = `run-${nextRun++}`;
        runs.set(runId, { dryRun: message.dryRun === true });
        return { ok: true, data: { runId, settings,
          policy: options.policy ?? { postingPage: 'unseen', storedCopy: 'clear' } } };
      }
      case 'plan/request': {
        const run = runs.get(message.runId as string);
        if (run === undefined) return { ok: false, error: 'expired' };
        const specs = message.specs as FieldSpec[];
        const planKeys = message.planKeys as FieldKey[] | undefined;
        let plan = planFrame({ specs, ...(planKeys === undefined ? {} : { planKeys }), canaries: message.canaries as string[],
          profile: options.profile ?? goldenProfile(),
          sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: run.dryRun,
          now: NOW });
        if (options.editPlan) plan = options.editPlan(plan, specs);
        return { ok: true, data: { writes: run.dryRun ? [] : plan.writes, results: plan.results, awaiting: plan.awaiting,
          persistableCanaries: plan.persistableCanaries } };
      }
      case 'plan/poll':
        return runs.has(message.runId as string)
          ? { ok: true, data: { writes: [], results: [], awaiting: [], persistableCanaries: [] } }
          : { ok: false, error: 'expired' };
      case 'report/put':
        if (!runs.has(message.runId as string)) return { ok: false, error: 'expired' };
        reports.push(message.report as FrameReport);
        return { ok: true, data: {} };
      case 'runstate/put':
        runStates.push(message.runState as RunState);
        return { ok: true, data: { updatedAt: 0 } };
      case 'runstate/get':
        return { ok: true, data: { runState: null } };
      case 'policy/hit':
      case 'panel/open':
      case 'runstate/clear':
        return { ok: true, data: {} };
      case 'ping':
        return { ok: true, data: { pong: true } };
      default:
        return { ok: false, error: 'bad_message' };
    }
  }

  function serveResume(port: PortLike): void {
    const resume = options.resume;
    const transfer = transfers++;
    let chunks: string[] = [];
    let sha = '';
    const post = (message: { type: string } & Record<string, unknown>) => {
      portLog.push({ from: 'worker', message });
      try {
        port.post(message);
      } catch {
        // The content script has gone.
      }
    };
    port.onMessage((raw) => {
      const parsed = ResumePortMessageSchema.safeParse(raw);
      const message = (parsed.success ? parsed.data : { type: 'unparsed' }) as { type: string } & Record<string, unknown>;
      portLog.push({ from: 'content', message });
      if (message.type === 'resume/request') {
        if (resume === undefined || resume.refuse !== undefined) {
          post({ v: 1, type: 'resume/error', reason: resume?.refuse ?? 'resume-unavailable' });
          port.disconnect();
          return;
        }
        void sha256Of(resume.bytes).then((digest) => {
          sha = digest;
          const sent = new Uint8Array(resume.bytes);
          if (transfer < (resume.corrupt ?? 0)) sent[7] = (sent[7] ?? 0) ^ 0xff;
          chunks = [];
          for (let at = 0; at < sent.length; at += RESUME_CHUNK_BYTES) {
            chunks.push(base64Of(sent.subarray(at, at + RESUME_CHUNK_BYTES)));
          }
          post({ v: 1, type: 'resume/header', name: resume.name, mime: resume.mime, size: resume.bytes.length, sha256: sha,
            chunkCount: chunks.length });
          post({ v: 1, type: 'resume/chunk', index: 0, data: chunks[0]! });
        });
        return;
      }
      if (message.type === 'resume/ack') {
        const next = (message.index as number) + 1;
        if (transfer === 0 && resume?.dropAfterChunks !== undefined && next >= resume.dropAfterChunks) {
          port.disconnect();
          return;
        }
        if (next < chunks.length) post({ v: 1, type: 'resume/chunk', index: next, data: chunks[next]! });
        else post({ v: 1, type: 'resume/end' });
        return;
      }
      if (message.type === 'resume/done' || message.type === 'resume/error') port.disconnect();
    });
  }

  const platform = createTestPlatform(answer, serveResume, options.id ? { id: options.id } : {});
  return {
    platform,
    messages,
    reports,
    runStates,
    portLog,
    of: (type) => messages.filter((message) => message.type === type),
  };
}

/** The DOCX MIME type, for a test resume. */
export const DOCX = DOCX_MIME;
