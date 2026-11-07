/*
 * What the UI's browser-mode tests share: a React root in the test page that each test mounts into, clicks and typing
 * as React hears them, a scripted worker for the memory page platform (answers by message type, the worker's end of
 * every `panel` port), and value-free reports, rows and statuses. A testkit, not a test: nothing in the extension
 * imports it, and it imports no test runner.
 *
 * The golden profile's sentinels (fixtures/profiles/alex-rivera.profile.json) are here too: tests feed them where a
 * value could slip in and check that none is ever drawn.
 */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { EMPTY_AUTOFILL_PROFILE, type AutofillProfile } from '../contract/tailorit';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import type { TelemetryCount } from '../core/types/telemetry';
import type {
  AgentStatus, AuthStatus, JobCard, LetterOutcome, PageState, PanelAskAnswer, ResumeListAnswer,
} from '../messaging/schemas';
import { createMemoryPagePlatform, type MemoryPagePlatform } from '../platform/memory';
import type { PortLike } from '../platform/types';
import type { FrameReport } from '../shared/report';

/** Values from the golden profile: none may ever appear in what the panel or the options page draws. */
export const PROFILE_SENTINELS = ['alex.rivera.f7q2@example.com', '+1 512 555 0147', '4417 Quillfeather Lane', 'Quillfeather Labs',
  'Marrowgate Systems', '78701'] as const;

/** One report row (FillResult), value-free like every row. */
export type Row = FrameReport['fields'][number];

export function row(key: string, overrides: Partial<Row> = {}): Row {
  return {
    key,
    label: `Label of ${key}`,
    kind: 'text',
    category: 'unknown',
    section: 'Contact',
    required: false,
    status: 'verified',
    provenance: 'profile',
    matcherStage: 'not-applicable',
    confidence: 1,
    reason: 'ok',
    wrote: true,
    verification: 'verified',
    needsUserAction: false,
    ...overrides,
  };
}

export function frameReport(frameId: number, overrides: Partial<FrameReport> = {}): FrameReport {
  return {
    v: 1,
    runId: `run-${frameId}`,
    frameId,
    platform: 'lever',
    adapter: 'lever',
    mode: 'fill',
    status: 'review',
    pauseReason: null,
    fields: [],
    notices: [],
    counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 },
    updatedAt: 1,
    ...overrides,
  };
}

/** A tab whose page holds a Lever form (v2's page state), as panel/reports and panel/update carry it. */
export function formPage(overrides: Partial<PageState> = {}): PageState {
  return { support: 'form', platform: 'lever', formKey: '0:doc-1', ...overrides };
}

/** The job card panel/job answers (v2): a found job with a tracked Saved entry, the resume it attaches and its match.
 *  Nothing of the golden profile (PROFILE_SENTINELS). */
export function jobCard(overrides: Partial<Extract<JobCard, { state: 'answered' }>> = {}): JobCard {
  return {
    state: 'answered',
    job: { title: 'Senior Backend Engineer', company: 'Northwind', location: 'Remote, US', closed: false,
      postedAt: Date.UTC(2026, 9, 29), salary: '$150k - $185k/yr', workArrangement: 'hybrid' },
    tracked: { status: 1, archived: false },
    resume: { label: 'Backend resume', fileKind: 'pdf', reason: 'application' },
    match: { state: 'ok', matchedCount: 9, total: 12, percentage: 75 },
    addable: true,
    ...overrides,
  };
}

/** v4 ui: a profile complete enough for the side panel's main view (a first and last name, an email, a phone, a city):
 *  panel/profile answers it by default. Nothing of the golden profile (PROFILE_SENTINELS). */
export function completeProfile(overrides: Partial<AutofillProfile> = {}): AutofillProfile {
  return {
    ...EMPTY_AUTOFILL_PROFILE,
    name: { ...EMPTY_AUTOFILL_PROFILE.name, first: 'Morgan', last: 'Lee' },
    contact: { ...EMPTY_AUTOFILL_PROFILE.contact, email: 'morgan@example.test',
      phone: { ...EMPTY_AUTOFILL_PROFILE.contact.phone, number: '+1 555 0100' },
      address: { ...EMPTY_AUTOFILL_PROFILE.contact.address, city: 'Austin', country: 'US' } },
    ...overrides,
  };
}

/** A connected status, as auth/status answers it. */
export function authStatus(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    connection: 'connected',
    account: { name: 'Morgan Lee', email: 'morgan@example.test' },
    scopes: ['profile:read', 'profile:sensitive', 'resumes:read', 'jobs:lookup', 'ai:run', 'answers:write'],
    expiresAt: Date.UTC(2027, 0, 20),
    storageAccess: 'restricted',
    versionMismatch: false,
    pairingExpiresAt: null,
    ...overrides,
  };
}

/** What the scripted worker answers and keeps. Tests change it as they go. */
export interface WorkerScript {
  auth: AuthStatus;
  settings: Settings;
  /** Each tab's reports, as panel/reports and a watch answer them. */
  reports: Map<number, FrameReport[]>;
  /** How many frames panel/fill, panel/continue and panel/cancel reach. */
  frames: number;
  /** The anonymous counts telemetry/get answers (telemetry/clear empties them). */
  counts: TelemetryCount[];
  /** Each tab's page state (v2), as panel/reports and a watch carry it; none by default (an older worker's answer). */
  pages: Map<number, PageState>;
  /** Each tab's job card (v2), as panel/job answers it; null (no card) by default. */
  cards: Map<number, JobCard | null>;
  /** What panel/addJob answers (v2). */
  addOutcome: 'added' | 'saved' | 'closed' | 'unsupported' | 'not-allowed' | 'rate-limited' | 'not-connected' | 'unavailable';
  /** The resumes panel/resumes lists (v2). */
  resumes: ResumeListAnswer['items'];
  /** What panel/ask answers (v2). */
  askAnswer: PanelAskAnswer;
  /** What panel/letter answers (Phase G): asked whether there is one (`check`), and Write it now (`write`). */
  letter: { check: LetterOutcome; write: LetterOutcome };
  /** Where panel/launcher says the launcher is hidden (v3 Phase 3); panel/showLauncher sets it back to 'none'. */
  launcherHidden: 'none' | 'visit' | 'site' | 'everywhere';
  /** The auto-apply agent's status (v3 Phase 5), as agent/status answers it; agent/set and agent/stop change it. */
  agent: AgentStatus;
  /** v4 ui: the profile panel/profile answers (complete by default; null: refused as unavailable). */
  profile: AutofillProfile | null;
}

export interface FakeWorker {
  script: WorkerScript;
  platform: MemoryPagePlatform;
  /** Replaces the answer to one message type (the default answers are the catalogue's, from `script`). */
  on(type: string, reply: (message: Record<string, unknown>) => unknown): void;
  /** The worker's end of each `panel` port the page opened, oldest first. */
  ports: PortLike[];
  /** Every message the page posted on a `panel` port. */
  posted: unknown[];
  /** The messages the page sent, by type. */
  sentOfType(type: string): Array<Record<string, unknown>>;
  /** Posts on the newest port, as the worker pushes a change. */
  push(message: unknown): void;
}

/** A worker double over the memory page platform. With `answerWatches`, each panel/watch is answered at once, as the
 *  real worker does, with the tab's reports. */
export function createFakeWorker(options: { activeTabId?: number | null; answerWatches?: boolean } = {}): FakeWorker {
  const script: WorkerScript = { auth: authStatus(), settings: structuredClone(DEFAULT_SETTINGS), reports: new Map(), frames: 1,
    counts: [], pages: new Map(), cards: new Map(), addOutcome: 'added',
    resumes: [{ id: 'resume-1', label: 'Backend resume', fileKind: 'pdf', kind: 'built', current: true },
      { id: 'resume-2', label: 'Platform resume', fileKind: 'docx', kind: 'uploaded', current: false }],
    askAnswer: { outcome: 'answered', text: 'I like building the systems Northwind runs on.', resumeLabel: 'Backend resume',
      policy: false },
    letter: { check: 'none', write: 'written' }, launcherHidden: 'none',
    agent: { on: false, confirmed: false, phase: 'off', blocked: null, allowed: true, pending: false, job: null,
      doneToday: 0, last: null }, profile: completeProfile() };
  /** A tab's page state, when the script names one (an older worker sends none). */
  const pageOf = (tabId: number) => (script.pages.has(tabId) ? { page: script.pages.get(tabId) } : {});
  const replies = new Map<string, (message: Record<string, unknown>) => unknown>();
  const ports: PortLike[] = [];
  const posted: unknown[] = [];
  const answerWatches = options.answerWatches ?? true;
  const ok = (data: unknown) => ({ ok: true, data });
  const defaults: Record<string, (message: Record<string, unknown>) => unknown> = {
    ping: () => ok({ pong: true }),
    'auth/status': () => ok(script.auth),
    'panel/reports': (message) => ok({ tabId: message.tabId, reports: script.reports.get(message.tabId as number) ?? [],
      ...pageOf(message.tabId as number) }),
    'panel/job': (message) => ok({ tabId: message.tabId, card: script.cards.get(message.tabId as number) ?? null }),
    'panel/addJob': () => ok({ outcome: script.addOutcome }),
    'panel/resumes': () => ok({ items: script.resumes }),
    'panel/setResume': () => ok({}),
    'panel/ask': () => ok(script.askAnswer),
    'panel/letter': (message) => ok({ outcome: message.write === true ? script.letter.write : script.letter.check }),
    'panel/fill': () => ok({ frames: script.frames }),
    'panel/continue': () => ok({ frames: script.frames }),
    'panel/cancel': () => ok({ frames: script.frames }),
    'panel/policyDecision': () => ok({}),
    'panel/focus': () => ok({}),
    'panel/describe': () => ok({ options: [] }),
    'panel/skip': () => ok({}),
    'panel/launcher': () => ok({ hidden: script.launcherHidden }),
    'panel/showLauncher': () => {
      script.launcherHidden = 'none';
      return ok({});
    },
    'settings/get': () => ok({ settings: script.settings }),
    'settings/save': (message) => {
      script.settings = message.settings as Settings;
      return ok({ settings: script.settings });
    },
    'runs/clear': () => ok({ cleared: 0 }),
    'agent/status': () => ok(script.agent),
    'agent/set': (message) => {
      const confirmed = script.agent.confirmed || message.confirmed === true;
      const on = message.on === true && script.agent.allowed && confirmed;
      script.agent = { ...script.agent, on, confirmed, phase: on ? 'waiting' : 'off' };
      return ok(script.agent);
    },
    'agent/stop': () => {
      script.agent = { ...script.agent, on: false, phase: 'off', job: null };
      return ok(script.agent);
    },
    'panel/profile': () => (script.profile === null ? { ok: false, error: 'unavailable' }
      : ok({ revision: 1, profile: script.profile, flaggedLines: [], canWrite: true, sensitive: { state: 'not-shared' } })),
    'auth/startPairing': () => {
      script.auth = { ...script.auth, pairingExpiresAt: Date.now() + 600_000 };
      return ok({ expiresAt: script.auth.pairingExpiresAt });
    },
    'telemetry/get': () => ok({ counts: script.counts }),
    'telemetry/clear': () => {
      script.counts = [];
      return ok({ counts: [] });
    },
  };
  const platform = createMemoryPagePlatform(
    async (message) => {
      const type = String((message as { type?: unknown }).type);
      const reply = replies.get(type) ?? defaults[type];
      return reply ? reply(message as Record<string, unknown>) : { ok: false, error: 'not_implemented' };
    },
    {
      activeTabId: options.activeTabId ?? null,
      connectWorker(port) {
        ports.push(port);
        port.onMessage((message) => {
          posted.push(message);
          const watch = message as { type?: unknown; tabId?: unknown };
          if (answerWatches && watch.type === 'panel/watch' && typeof watch.tabId === 'number') {
            port.post({ v: 1, type: 'panel/update', tabId: watch.tabId, reports: script.reports.get(watch.tabId) ?? [],
              ...pageOf(watch.tabId) });
          }
        });
      },
    },
  );
  return {
    script,
    platform,
    on: (type, reply) => void replies.set(type, reply),
    ports,
    posted,
    sentOfType: (type) =>
      platform.sent.filter((message) => (message as { type?: unknown }).type === type) as Array<Record<string, unknown>>,
    push: (message) => ports.at(-1)?.post(message),
  };
}

// ── Mounting and driving React ────────────────────────────────────────────────────────────────────────────────────

const mounted: Array<() => void> = [];

/** Renders `node` into a fresh container in the test page, inside act, so effects and first answers have run. */
export async function mount(node: ReactNode): Promise<HTMLElement> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

/** Unmounts everything mount() rendered (call it in afterEach). */
export function unmountAll(): void {
  for (const unmount of mounted.splice(0)) unmount();
}

/** Lets pending answers and React's updates run. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

/** Clicks as the person would (an untrusted click is all React needs), then lets the answers land. */
export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to click');
  await act(async () => (element as HTMLElement).click());
  await settle();
}

/** Unfolds every row of the field lists, or the row of `key`: rows are folded at first, their icon and label shown
 *  (v3 Phase 3 review). */
export async function unfoldRows(root: ParentNode, key?: string): Promise<void> {
  const rows = key === undefined ? 'li[data-field-key]' : `li[data-field-key="${key}"]`;
  for (const toggle of [...root.querySelectorAll<HTMLButtonElement>(`${rows} button.tia-row__toggle[aria-expanded="false"]`)]) {
    await click(toggle);
  }
}

/** Types into an input or a textarea as React hears it: the prototype's value setter, then an input event. */
export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The button whose text is `text`, exactly, under `root`. */
export function button(root: ParentNode, text: string): HTMLButtonElement | null {
  return [...root.querySelectorAll('button')].find((each) => each.textContent?.trim() === text) ?? null;
}

// ── The side panel's main button clock (the v4 review, L4: panel/seen.ts) ─────────────────────────────────────────

/** A clock on which every meaning of the main button has been shown long enough by its first check: each read is a
 *  minute on from the last, and frames run at once. For tests about anything but the CONTROL_SEEN_MS rule itself. */
export const SEEN_AT_ONCE: { now(): number; frames(callback: () => void): () => void } = (() => {
  let time = 0;
  return {
    now: () => {
      time += 60_000;
      return time;
    },
    frames: (callback: () => void) => {
      callback();
      return () => undefined;
    },
  };
})();

/** A clock the test moves by hand: `at` is the time (ms), and frames wait until `flush()` runs them (inside act). */
export function manualClock(): { now(): number; frames(callback: () => void): () => void; at: number; flush(): Promise<void> } {
  let queued: Array<() => void> = [];
  const clock = {
    at: 0,
    now: () => clock.at,
    frames: (callback: () => void) => {
      queued.push(callback);
      return () => {
        queued = queued.filter((each) => each !== callback);
      };
    },
    async flush() {
      await act(async () => {
        const due = queued;
        queued = [];
        for (const callback of due) callback();
      });
    },
  };
  return clock;
}
