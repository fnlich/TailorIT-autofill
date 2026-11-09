/*
 * v3 Phase 5 in the real worker (index.ts, agent.ts, sign-in.ts, settings.ts, submissions.ts), over WXT's fake browser,
 * the hand fakes and a fake TailorIT:
 * - Run auto-apply: agent/status and agent/set from the extension's pages only; on, it takes the queued job, opens it in
 *   its own window, starts the agent's run in that window's form (run/start {agent}), answers that tab's run/begin and
 *   hello with Next and Submit on Auto; run/begin {trigger: 'agent'} from any other tab, or for another application
 *   than the task's, is refused; the platform's sign after the agent's Submit reports the job submitted (never POST
 *   /applied); the agent lets go of its tab (run/cancel and the person's own settings to its frames) and closes that
 *   tab alone, never a window.
 * - Sign-in Auto's credential: only with Sign-in on Auto, credentials:read and the disclosure acknowledged; only to a
 *   tab's top frame on https, never in a private tab; for the sender's own host (Chrome's address, not the message's);
 *   once per tab, wall and host, counted only once TailorIT answered one (TailorIT down, or none saved, may be asked
 *   again); a sign-in for another host is refused; and the password is never logged or stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { WorkerPlatform } from '../platform/types';
import { AGENT_RUN_KEY } from './agent';
import {
  contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const OPTIONS = pageSender('options.html');
const GREENHOUSE = 'https://job-boards.greenhouse.io/northwind/jobs/5512345002';
const TASK = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a64', jobId: 1042, url: GREENHOUSE, company: 'Northwind',
  title: 'Senior Backend Engineer', resumeId: null };
const AGENT_TAB = 41;
const WORKDAY = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/login';
const PASSWORD = 'dummy-password-not-real';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Windows that open one tab each, as Chrome's do; the agent closes its tab alone. */
function windows(): WorkerPlatform['windows'] & { opened: string[]; closed: number[] } {
  const tabs = new Set<number>();
  const made = { opened: [] as string[], closed: [] as number[] };
  return {
    ...made,
    async open() {
      tabs.add(AGENT_TAB);
      return { windowId: 4, tabId: AGENT_TAB };
    },
    async navigate(tabId, url) {
      made.opened.push(url);
      return tabs.has(tabId);
    },
    async closeTab(tabId) {
      made.closed.push(tabId);
      tabs.delete(tabId);
    },
    tabExists: async (tabId) => tabs.has(tabId),
    othersOpen: async () => true,
    get opened() {
      return made.opened;
    },
    get closed() {
      return made.closed;
    },
  };
}

async function withAgent(): Promise<{ worker: TestWorker; win: ReturnType<typeof windows> }> {
  const win = windows();
  const worker = await startTestWorker({ token: tokenRecord(), windows: win });
  worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: TASK } });
  worker.tailorit.reply('POST /api/autofill/agent/:id/result', { status: 204 });
  worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/result`, { status: 204 });
  return { worker, win };
}

describe('Run auto-apply in the worker (v3 Phase 5)', () => {
  it('is read and switched by the extension’s pages only, and is off at first', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { on: false, phase: 'off', allowed: true } });
    expect(await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, contentSender()))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, contentSender({ frameId: 2, documentId: 'doc-2' }))).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('opens the queued job in its own window, runs the agent there with Next and Submit on Auto, and reports its submission', async () => {
    const { worker, win } = await withAgent();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS))
      .toMatchObject({ ok: true, data: { on: true } });
    // Its first look at the queue: at once (the worker's timers, driven by hand here).
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    const hello = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    expect(hello).toMatchObject({ ok: true, data: { settings: { modes: { next: 'auto', submit: 'auto',
      afterPageTurn: 'auto' } } } });
    await vi.waitFor(() => expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start'))
      .toEqual([{ tabId: AGENT_TAB, message: { v: 1, type: 'run/start', dryRun: false, agent: true },
        options: { frameId: 0, documentId: 'doc-a' } }]));
    // The agent's run/begin: its tab's, with the agent's settings; from any other tab, refused.
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame) as { ok: boolean; data: { runId: string; settings: { modes: { submit: string } } } };
    expect(begun).toMatchObject({ ok: true, data: { settings: { modes: { submit: 'auto', next: 'auto' } } } });
    const other = contentSender({ url: GREENHOUSE, tab: { id: 9, url: GREENHOUSE }, documentId: 'doc-b' });
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false }, other))
      .toEqual({ ok: false, error: 'bad_message' });
    // In the agent's tab, another posting's page: not the task's application, refused too.
    const elsewhere = 'https://job-boards.greenhouse.io/northwind/jobs/5512345999';
    const otherKey = applicationOf(new URL(elsewhere))!.applicationKey;
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: otherKey, trigger: 'agent', dryRun: false },
      contentSender({ url: elsewhere, tab: { id: AGENT_TAB, url: elsewhere }, documentId: 'doc-c' })))
      .toEqual({ ok: false, error: 'bad_message' });
    // Another tab's frames keep the person's own settings.
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, other))
      .toMatchObject({ ok: true, data: { settings: { modes: { submit: 'manual', next: 'manual' } } } });
    // Submit mode Auto's press, then the platform's sign: the job is reported submitted, never POST /applied.
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto', runId: begun.data.runId },
      agentFrame)).toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'success-message' },
      agentFrame)).toEqual({ ok: true, data: {} });
    const results = worker.tailorit.requests.filter((request) => request.path === `/api/autofill/agent/${TASK.id}/result`);
    expect(results.map((request) => JSON.parse(request.body!))).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    // Its tab let go of (its frame's run cancelled, the person's own settings back), then that tab closed.
    const toTab = sentToFrames(worker).filter((sent) => sent.tabId === AGENT_TAB).map(typeOfSent);
    expect(toTab.slice(-2)).toEqual(['run/cancel', 'settings/changed']);
    expect(sentToFrames(worker).filter((sent) => sent.tabId === AGENT_TAB).at(-1)!.message).toMatchObject({
      settings: { modes: { submit: 'manual', next: 'manual' } } });
    expect(win.closed).toEqual([AGENT_TAB]);
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { doneToday: 1, last: { state: 'submitted', reason: null }, pending: false } });
  });

  // v1.3 B: the agent's own Submit sends its form's questions and answers once its result recorded the job. Undo proof:
  // drop sendForm from submissions.ts record()'s agent branch and nothing is sent.
  it('sends the agent’s submitted form to TailorIT by the task’s job, once its result recorded it (v1.3 B)', async () => {
    const { worker, win } = await withAgent();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    worker.tailorit.reply('POST /api/autofill/submissions', { json: { lookup: { ats: null, job: null, application: null,
      suggestedResume: null }, job: 'shared', questionsAdded: 1, questionsKnown: 1, answersKept: 1 } });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame) as { ok: boolean; data: { runId: string } };
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto', runId: begun.data.runId },
      agentFrame);
    const spec = { key: 'greenhouse|main|notes|none|0', baseKey: 'greenhouse|main|notes|0', platform: 'greenhouse',
      section: { id: 'main' }, kind: 'text', label: 'Notes', labelSource: 'for', labelVisible: true, description: '',
      required: false, options: [], optionSetHash: 'none', constraints: {}, autocomplete: [], nameAttr: '', idAttr: '',
      ordinal: 0, domOrder: 0, visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' } };
    expect(await worker.deliver({ v: 1, type: 'submit/form', applicationKey: key, fields: [{ spec, step: 0,
      answer: { kind: 'text', text: 'Hello' } }] }, agentFrame)).toEqual({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'success-message' }, agentFrame);
    const sent = worker.tailorit.requests.filter((request) => request.path === '/api/autofill/submissions')
      .map((request) => JSON.parse(request.body!) as Record<string, unknown>);
    expect(sent).toEqual([expect.objectContaining({ jobId: TASK.jobId, questions: [expect.objectContaining({
      ref: spec.key, questionKey: 'notes' })], answers: [expect.objectContaining({ answer: { kind: 'text', text: 'Hello' } })] })]);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
  });

  // v1.5 X (PLAN decision 4): the agent's run reads the person's prebuilt draft answers as any fill does (run/begin's
  // known form), the ready ones handed to its plans marked draft, a not-ready one left to its AI path. Undo proof:
  // leave draftAnswersOf out of known-forms.ts read() and no draft reaches the agent's plan.
  it('hands the agent’s plans the person’s ready prebuilt draft answers, as any fill’s (v1.5 X)', async () => {
    const { worker, win } = await withAgent();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    const question = { id: 81, questionKey: 'notes', label: 'Notes', kind: 'text', options: [], optionSetHash: '',
      section: 'main', required: false, step: 0, position: 0, source: 'submission',
      firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z' };
    const draft = (questionId: number, ready: boolean) => ({ match: 'draft', questionId, questionKey: 'notes',
      optionSetHash: '', questionLabel: 'Notes', fieldKind: 'text', status: ready ? 'ready' : 'not_ready',
      answer: ready ? { kind: 'text', text: 'Prepared ahead.' } : null, provenance: 'server-ai',
      preparedAt: '2026-11-08T00:00:00.000Z' });
    worker.tailorit.reply('POST /api/autofill/forms/known', { json: { jobId: TASK.jobId,
      questions: [question, { ...question, id: 82, questionKey: 'more', label: 'More' }], answers: [],
      drafts: [draft(81, true), { ...draft(82, false), questionKey: 'more', questionLabel: 'More' }] } });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame) as { ok: boolean; data: { runId: string } };
    expect(begun.ok).toBe(true);
    const spec = { key: 'greenhouse|main|notes|none|0', baseKey: 'greenhouse|main|notes|0', platform: 'greenhouse',
      section: { id: 'main' }, kind: 'text', label: 'Notes', labelSource: 'for', labelVisible: true, description: '',
      required: false, options: [], optionSetHash: 'none', constraints: {}, autocomplete: [], nameAttr: '', idAttr: '',
      ordinal: 0, domOrder: 0, visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' } };
    await worker.deliver({ v: 1, type: 'plan/request', runId: begun.data.runId, pass: 0, specs: [spec],
      planKeys: [spec.key], canaries: [], notices: [] }, agentFrame);
    const drafts = (worker.core.calls.planFrame.at(-1)?.submittedAnswers ?? []).filter((answer) => answer.draft === true);
    expect(drafts).toEqual([expect.objectContaining({ labelKey: 'notes', optionSetHash: 'none', sameJob: true,
      questionId: 81, answer: { kind: 'text', text: 'Prepared ahead.' } })]);
  });

  it('takes the entry’s note of its press from the agent’s tab’s top frame alone (round 3 of the v3 Phase 6/7b review, X8)',
    async () => {
      const { worker, win } = await withAgent();
      // The frame's answer to agent/enter never comes back as 'pressed' (its document went with the press).
      worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
      await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
      worker.timers.advance(1);
      await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
      await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
        .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
      const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
      await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, agentFrame);
      await vi.waitFor(() => expect(sentToFrames(worker).map(typeOfSent)).toContain('agent/enter'));
      const pressedEntryAt = async () => ((await fakeBrowser.storage.local.get(AGENT_RUN_KEY))[AGENT_RUN_KEY] as
        { pressedEntryAt?: number | null }).pressedEntryAt ?? null;
      await vi.waitFor(async () => expect(await pressedEntryAt()).toBeNull());
      const subframe = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, frameId: 3,
        documentId: 'doc-a' });
      expect(await worker.deliver({ v: 1, type: 'agent/entered' }, subframe)).toEqual({ ok: false, error: 'bad_sender' });
      expect(await pressedEntryAt()).toBeNull();
      expect(await worker.deliver({ v: 1, type: 'agent/entered' }, agentFrame)).toEqual({ ok: true, data: {} });
      expect(await pressedEntryAt()).not.toBeNull();
    });

  it('reports a report’s stop: a CAPTCHA leaves the job for the person and closes its window', async () => {
    const { worker, win } = await withAgent();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toHaveLength(1));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: applicationOf(new URL(GREENHOUSE))!
      .applicationKey, trigger: 'agent', dryRun: false }, agentFrame) as { data: { runId: string } };
    await worker.deliver({ v: 1, type: 'report/put', runId: begun.data.runId, report: frameReport(begun.data.runId, 0,
      { platform: 'greenhouse', adapter: 'greenhouse', status: 'handoff', pauseReason: 'captcha' }) }, agentFrame);
    await vi.waitFor(() => expect(worker.tailorit.requests.filter((request) => request.path.endsWith('/result'))
      .map((request) => JSON.parse(request.body!))).toEqual([{ state: 'needs-you', reason: 'captcha', aiGuesses: 0 }]));
    expect(win.closed).toEqual([AGENT_TAB]);
  });

  it('after the job’s Submit, gives any other document of its tab Submit on Manual and starts no run there', async () => {
    const { worker, win } = await withAgent();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toHaveLength(1));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame) as { data: { runId: string } };
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto', runId: begun.data.runId },
      agentFrame)).toEqual({ ok: true, data: {} });
    // The page loaded again (a new document) before any sign: Next on Auto, Submit on Manual, no run started.
    const reloaded = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a2' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, reloaded))
      .toMatchObject({ ok: true, data: { settings: { modes: { next: 'auto', submit: 'manual' } } } });
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { heldAt: expect.any(Number) } }));
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start')).toHaveLength(1);
  });

  it('names the task’s job and resume for its tab: run/begin’s lookup asks with them', async () => {
    const win = windows();
    const worker = await startTestWorker({ token: tokenRecord(), windows: win });
    worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: { ...TASK, resumeId: 'resume-77' } } });
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame)).toMatchObject({ ok: true });
    const lookups = worker.tailorit.requests.filter((request) => request.path === '/api/autofill/lookup')
      .map((request) => JSON.parse(request.body!) as Record<string, unknown>);
    expect(lookups.at(-1)).toMatchObject({ jobId: TASK.jobId, resumeId: 'resume-77' });
  });

  it('turns Run auto-apply off when the connection goes, its confirmation asked again', async () => {
    const { worker } = await withAgent();
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ data: { on: true } });
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, OPTIONS);
    await vi.waitFor(async () => expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS))
      .toMatchObject({ data: { on: false, confirmed: false } }));
  });
});

describe('Sign-in Auto’s credential in the worker (v3 Phase 5)', () => {
  const top = (overrides = {}) => contentSender({ url: WORKDAY, tab: { id: 12, url: WORKDAY }, documentId: 'doc-w',
    ...overrides });
  const ask = (worker: TestWorker, sender = top(), wall: 'sign-in' | 'create-account' | 'email-gate' = 'sign-in') =>
    worker.deliver({ v: 1, type: 'signin/credential', wall }, sender);
  async function signInWorker(options: { mode?: 'auto' | 'manual'; scopes?: boolean; disclosure?: number } = {}) {
    const record = tokenRecord();
    const scopes = options.scopes === false ? record.scopes.filter((scope) => scope !== 'credentials:read') : record.scopes;
    const worker = await startTestWorker({ token: tokenRecord({ scopes }),
      ...(options.disclosure === undefined ? {} : { disclosure: options.disclosure }) });
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: options.mode ?? 'auto' } } }, OPTIONS);
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'acme.wd5.myworkdayjobs.com',
      email: 'alex.rivera@example.com', password: PASSWORD } });
    return worker;
  }

  it('answers the sender’s own host’s sign-in to its top frame, once per tab, wall and host', async () => {
    const worker = await signInWorker();
    expect(await ask(worker)).toEqual({ ok: true, data: { host: 'acme.wd5.myworkdayjobs.com',
      email: 'alex.rivera@example.com', password: PASSWORD } });
    const reads = worker.tailorit.requests.filter((request) => request.path === '/api/autofill/credentials');
    expect(reads.map((request) => new URL(request.url).searchParams.get('host'))).toEqual(['acme.wd5.myworkdayjobs.com']);
    // The same tab and wall again (the site did not take it): never read again.
    expect(await ask(worker)).toEqual({ ok: false, error: 'expired' });
    // The other wall once, then another tab once.
    expect(await ask(worker, top(), 'create-account')).toMatchObject({ ok: true });
    expect(await ask(worker, top({ tab: { id: 13, url: WORKDAY } }))).toMatchObject({ ok: true });
    expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(3);
    // The same tab and wall on another host (the tab went on to another employer's site): that host's, once.
    const other = 'https://globex.wd1.myworkdayjobs.com/en-US/careers/login';
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'globex.wd1.myworkdayjobs.com',
      email: 'alex.rivera@example.com', password: PASSWORD } });
    expect(await ask(worker, top({ url: other, tab: { id: 12, url: other } }))).toMatchObject({ ok: true,
      data: { host: 'globex.wd1.myworkdayjobs.com' } });
    // Never logged, never stored.
    expect(JSON.stringify(logs.mock.calls)).not.toContain(PASSWORD);
    const stored = JSON.stringify([await fakeBrowser.storage.local.get(null), await fakeBrowser.storage.session.get(null)]);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain('alex.rivera@example.com');
  });

  it('answers an email gate the email alone, never the password, once per tab and host (v3 Phase 7b)', async () => {
    const worker = await signInWorker();
    expect(await ask(worker, top(), 'email-gate')).toEqual({ ok: true, data: { host: 'acme.wd5.myworkdayjobs.com',
      email: 'alex.rivera@example.com' } });
    expect(await ask(worker, top(), 'email-gate')).toEqual({ ok: false, error: 'expired' });
    // The gate's answer is its own wall: the tab's sign-in is still answered once.
    expect(await ask(worker)).toMatchObject({ ok: true, data: { password: PASSWORD } });
  });

  it('refuses with Sign-in Manual, without credentials:read, or before the disclosure was acknowledged', async () => {
    for (const options of [{ mode: 'manual' as const }, { scopes: false }, { disclosure: 2 }]) {
      const worker = await signInWorker(options);
      expect(await ask(worker), JSON.stringify(options)).toEqual({ ok: false, error: 'unavailable' });
      expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(0);
    }
  });

  it('refuses a subframe and a private tab, asking TailorIT nothing', async () => {
    const worker = await signInWorker();
    expect(await ask(worker, top({ frameId: 2 }))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await ask(worker, top({ tab: { id: 14, url: WORKDAY, incognito: true } }))).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(0);
  });

  it('answers sign-in-unavailable while TailorIT is down, not_found while it has none, and asks again later (only an answer counts)', async () => {
    const worker = await signInWorker();
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 503, json: { error: { code: 'unavailable',
      message: 'Down.' } } }, { once: true });
    expect(await ask(worker)).toEqual({ ok: false, error: 'unavailable' });
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 404, json: { error: { code: 'not_found',
      message: 'None.' } } }, { once: true });
    // The v4 review (M5): none saved is told apart, so the page says to add one.
    expect(await ask(worker)).toEqual({ ok: false, error: 'not_found' });
    // TailorIT back, with the sign-in saved meanwhile: answered, once.
    expect(await ask(worker)).toMatchObject({ ok: true, data: { password: PASSWORD } });
    expect(await ask(worker)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('GET /api/autofill/credentials')).toBe(3);
  });

  it('refuses a sign-in TailorIT answered for another host, and one it has none for', async () => {
    const worker = await signInWorker();
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'other.wd5.myworkdayjobs.com',
      email: 'alex.rivera@example.com', password: PASSWORD } }, { once: true });
    // The v4 review (M5): none for this host is saved: not_found, as TailorIT's own 404.
    expect(await ask(worker)).toEqual({ ok: false, error: 'not_found' });
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 404, json: { error: { code: 'not_found',
      message: 'None.' } } });
    expect(await ask(worker, top({ tab: { id: 15, url: WORKDAY } }))).toEqual({ ok: false, error: 'not_found' });
  });

  // ── snapshot build 2026-11-06 (contract6): TailorIT's API 6, the every-site sign-in by the page's path ──
  describe('on the hosts the every-site sign-in covers by their candidate paths (TailorIT’s API 6)', () => {
    /** The owner's snapshots' pages (fixtures/adp guest and personal, fixtures/clearcompany vafb-account), as Chrome
     *  reports their frames: their queries included, which never reach TailorIT. */
    const ADP_GUEST = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196&ccId=19000101_000001';
    const ADP_STEPS = 'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196&OTP_login=true';
    const CC = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
    const everySite = async () => {
      const worker = await signInWorker();
      worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: '*', email: 'alex.rivera@example.com',
        password: PASSWORD } });
      return worker;
    };
    const queries = (worker: TestWorker) => worker.tailorit.requests
      .filter((request) => request.path === '/api/autofill/credentials')
      .map((request) => [...new URL(request.url).searchParams]);
    const at = (url: string, id: number) => top({ url, tab: { id, url }, documentId: `doc-${id}` });

    it('answers the every-site sign-in at a candidate path, the frame’s pathname sent with its host, never its query',
      async () => {
        const worker = await everySite();
        expect(await ask(worker, at(ADP_GUEST, 21), 'email-gate')).toEqual({ ok: true,
          data: { host: '*', email: 'alex.rivera@example.com' } });
        expect(await ask(worker, at(ADP_STEPS, 22))).toMatchObject({ ok: true, data: { host: '*', password: PASSWORD } });
        expect(await ask(worker, at(CC, 23), 'create-account')).toMatchObject({ ok: true, data: { host: '*' } });
        expect(queries(worker)).toEqual([
          [['host', 'workforcenow.adp.com'], ['path', '/mascsr/default/mdf/recruitment/recruitment.html']],
          [['host', 'workforcenow.adp.com'], ['path', '/mascsr/applicant/mdf/recruitment/postLogin.html']],
          [['host', 'vafb.clearcompany.com'], ['path', '/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply']]]);
        for (const request of worker.tailorit.requests) {
          expect(request.url).not.toContain('cid=');
          expect(request.url).not.toContain('OTP_login');
        }
      });

    it('sends no path where it decides nothing, and takes `*` on no page it does not cover', async () => {
      const worker = await everySite();
      // A host covered by its name alone (Workday): its own sign-in, or `*`, asked by the host alone.
      expect(await ask(worker)).toMatchObject({ ok: true, data: { host: '*' } });
      // ClearCompany's own www host serves /careers/ too (the extension's match pattern), but no tenant's candidate page.
      // The v4 review (M5): the every-site one may not be used here, so none for the page is saved: not_found.
      expect(await ask(worker, at('https://www.clearcompany.com/careers/jobs/1/apply', 24))).toEqual({ ok: false,
        error: 'not_found' });
      expect(queries(worker)).toEqual([[['host', 'acme.wd5.myworkdayjobs.com']], [['host', 'www.clearcompany.com']]]);
    });

    it('takes the path from Chrome’s address for the frame, never from the message', async () => {
      const worker = await everySite();
      const answer = await worker.deliver({ v: 1, type: 'signin/credential', wall: 'sign-in',
        path: '/mascsr/default/mdf/recruitment/recruitment.html' }, at('https://www.clearcompany.com/careers/x', 25));
      expect(answer).toMatchObject({ ok: false });
      expect(queries(worker)).toEqual([]);
    });
  });
  // ── end contract6 ──
});
