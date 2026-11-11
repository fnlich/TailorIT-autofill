import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { RUN_BEGIN_LIMIT } from './run-begin';
import {
  beginRun,
  contentSender,
  fieldSpec,
  goldens,
  LEVER_KEY,
  LEVER_POSTING_URL,
  LEVER_URL,
  pageSender,
  runState,
  startTestWorker,
  tokenRecord,
  type TestWorker,
} from './worker.testkit';

const begin = (worker: TestWorker, overrides: Record<string, unknown> = {}, sender = contentSender()) =>
  worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false, ...overrides }, sender);
const policyHit = (worker: TestWorker, patternId: string | null, applicationKey = LEVER_KEY, sender = contentSender()) =>
  worker.deliver({ v: 1, type: 'policy/hit', applicationKey, patternId }, sender);
const CONTENT_SETTINGS = { panel: DEFAULT_SETTINGS.panel, view: DEFAULT_SETTINGS.view, llm: DEFAULT_SETTINGS.llm,
  modes: { next: DEFAULT_SETTINGS.modes.next, afterPageTurn: DEFAULT_SETTINGS.modes.afterPageTurn,
    submit: DEFAULT_SETTINGS.modes.submit, agentSkip: DEFAULT_SETTINGS.modes.agentSkip,
    signIn: DEFAULT_SETTINGS.modes.signIn, noMatch: DEFAULT_SETTINGS.modes.noMatch,
    notifications: DEFAULT_SETTINGS.modes.notifications },
  offerToSaveAnswers: DEFAULT_SETTINGS.offerToSaveAnswers,
  // jr6: no job-site password saved in this browser: nothing is typed at a sign-in.
  typeSignIn: false };
const withPosting = (postingText: string) => ({ json: { ...goldens.lookup, job: { ...goldens.lookup.job, postingText } } });

describe('run/begin', () => {
  it('mints a run, loads the profile, looks the frame up, and answers the run id, settings and policy states', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const answer = await begin(worker);
    expect(answer).toEqual({
      ok: true,
      data: {
        runId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        settings: CONTENT_SETTINGS,
        policy: { postingPage: 'unseen', storedCopy: 'unavailable' },
      },
    });
    const routes = worker.tailorit.requests.map((request) => `${request.method} ${request.path}`).sort();
    // The saved answers are read with the profile (Phase 6); v1.3 B: the job's known form, once the lookup names it.
    expect(routes).toEqual(['GET /api/autofill/answers', 'GET /api/autofill/profile', 'POST /api/autofill/forms/known',
      'POST /api/autofill/lookup']);
    const lookup = worker.tailorit.requests.find((request) => request.path === '/api/autofill/lookup')!;
    expect(JSON.parse(lookup.body!)).toEqual({ url: LEVER_POSTING_URL, includePostingText: true });
    const known = worker.tailorit.requests.find((request) => request.path === '/api/autofill/forms/known')!;
    expect(JSON.parse(known.body!)).toEqual({ jobId: goldens.lookup.job.id });
  });

  it('answers neither the profile nor the lookup, and stores the run without its address', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/lookup', withPosting('Northwind is hiring.'));
    const answer = JSON.stringify(await begin(worker));
    for (const text of ['Elena', 'Ruiz', 'Northwind', 'Senior', 'Resume', goldens.lookup.suggestedResume.id]) {
      expect(answer).not.toContain(text);
    }
    const session = JSON.stringify(await fakeBrowser.storage.session.get(null));
    expect(session).not.toContain('jobs.lever.co');
    expect(session).not.toContain('Elena');
    const [record] = Object.entries(await fakeBrowser.storage.session.get(null)).filter(([key]) => key.startsWith('runs:'));
    expect(record![1]).toEqual({
      runId: expect.any(String), tabId: 7, frameId: 0, documentId: 'doc-1', applicationKey: LEVER_KEY, dryRun: false,
      sensitive: 'untried', startedAt: worker.clock.now,
      // The audit of 2026-11-06 (M6): the lookup's job, by its id alone.
      jobId: goldens.lookup.job.id,
    });
  });

  describe('the stored copy\'s policy state', () => {
    it('is hit when TailorIT\'s stored posting text matches a policy pattern', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/lookup', withPosting('Please do not use AI tools to write your answers.'));
      expect(await begin(worker)).toMatchObject({ ok: true, data: { policy: { storedCopy: 'hit' } } });
      expect(worker.core.calls.policy).toEqual(['Please do not use AI tools to write your answers.']);
    });

    it('is clear when the stored text matches none', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/lookup', withPosting('We build payments in TypeScript.'));
      expect(await begin(worker)).toMatchObject({ ok: true, data: { policy: { storedCopy: 'clear' } } });
    });

    it.each([
      ['the job has no stored text', { json: goldens.lookup }],
      ['TailorIT has no such job', { json: { ats: null, job: null, application: null, suggestedResume: null } }],
      ['the lookup fails', { status: 503, json: { error: { code: 'unavailable', message: 'x' } } }],
      ['the lookup cannot reach TailorIT', { fail: 'network' as const }],
    ])('is unavailable when %s, and the run still begins', async (_name, reply) => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/lookup', reply);
      expect(await begin(worker)).toMatchObject({ ok: true, data: { policy: { storedCopy: 'unavailable' } } });
    });

    it('is unavailable, with no lookup at all, for an address too long to send', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const long = `${LEVER_URL}?ref=${'x'.repeat(2100)}`;
      expect(await begin(worker, {}, contentSender({ url: long }))).toMatchObject({ ok: true, data: { policy: { storedCopy: 'unavailable' } } });
      expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(0);
    });

    it('is unavailable when the policy check itself fails', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { policyHits: () => { throw new Error('bug'); } } });
      worker.tailorit.reply('POST /api/autofill/lookup', withPosting('Please do not use AI.'));
      expect(await begin(worker)).toMatchObject({ ok: true, data: { policy: { storedCopy: 'unavailable' } } });
    });
  });

  describe('the posting page\'s policy state', () => {
    it('is unseen, then clear, then hit, and a hit is never cleared', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      expect(await begin(worker)).toMatchObject({ data: { policy: { postingPage: 'unseen' } } });
      expect(await policyHit(worker, null)).toEqual({ ok: true, data: {} });
      expect(await begin(worker)).toMatchObject({ data: { policy: { postingPage: 'clear' } } });
      expect(await policyHit(worker, 'no-ai-tools')).toEqual({ ok: true, data: {} });
      expect(await begin(worker)).toMatchObject({ data: { policy: { postingPage: 'hit' } } });
      await policyHit(worker, null);
      expect(await begin(worker)).toMatchObject({ data: { policy: { postingPage: 'hit' } } });
      expect(await fakeBrowser.storage.session.get(`policy:${LEVER_KEY}`)).toEqual({
        [`policy:${LEVER_KEY}`]: { hits: ['no-ai-tools'], clear: true },
      });
    });

    it('belongs to its application only', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await policyHit(worker, 'no-ai-tools', 'lever:ffffffffffffffff');
      expect(await begin(worker)).toMatchObject({ data: { policy: { postingPage: 'unseen' } } });
    });

    it('stores pattern ids only: anything else a frame sends is refused', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      expect(await policyHit(worker, 'Do Not Use AI!')).toEqual({ ok: false, error: 'bad_message' });
      expect(await policyHit(worker, 'x'.repeat(41))).toEqual({ ok: false, error: 'bad_message' });
      expect(await policyHit(worker, 'no-ai', 'greenhouse:0123456789abcdef')).toEqual({ ok: false, error: 'bad_message' });
      expect(await policyHit(worker, 'no-ai', 'not-a-key')).toEqual({ ok: false, error: 'bad_message' });
      expect(Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith('policy:'))).toEqual([]);
    });

    it('is recorded for a posting page even when not connected', async () => {
      const worker = await startTestWorker();
      expect(await policyHit(worker, 'no-ai-tools')).toEqual({ ok: true, data: {} });
    });
  });

  it('answers not_connected without a token, and asks TailorIT nothing', async () => {
    const worker = await startTestWorker();
    expect(await begin(worker)).toEqual({ ok: false, error: 'not_connected' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it('answers not_connected when TailorIT refuses the token, and unavailable when it cannot answer', async () => {
    const refused = await startTestWorker({ token: tokenRecord() });
    refused.tailorit.reply('GET /api/autofill/profile', { status: 401, json: { error: { code: 'not_signed_in', message: 'x' } } });
    expect(await begin(refused)).toEqual({ ok: false, error: 'not_connected' });
    expect(refused.secrets.value).toBeUndefined();

    const down = await startTestWorker({ token: tokenRecord() });
    down.tailorit.reply('GET /api/autofill/profile', { status: 500, json: { error: { code: 'internal', message: 'x' } } });
    expect(await begin(down)).toEqual({ ok: false, error: 'unavailable' });

    const broken = await startTestWorker({ token: tokenRecord(), core: { canonicalizeProfile: () => { throw new Error('bug'); } } });
    expect(await begin(broken)).toEqual({ ok: false, error: 'internal' });
  });

  it('refuses an application key that does not fit the frame', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(await begin(worker, { applicationKey: 'greenhouse:0123456789abcdef' })).toEqual({ ok: false, error: 'bad_message' });
    expect(await begin(worker, { applicationKey: 'lever:0123' })).toEqual({ ok: false, error: 'bad_message' });
    expect(await begin(worker, { applicationKey: 'LEVER:0123456789ABCDEF' })).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  describe('the resume trigger', () => {
    it('is accepted only while this tab holds an unfinished RunState for the application', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      expect(await begin(worker, { trigger: 'resume' })).toEqual({ ok: false, error: 'expired' });
      await worker.deliver({ v: 1, type: 'runstate/put', runState: runState({ status: 'fill-step' }) }, contentSender());
      expect(await begin(worker, { trigger: 'resume' })).toMatchObject({ ok: true });
      expect(await begin(worker, { trigger: 'resume' }, contentSender({ tab: { id: 9 } }))).toEqual({ ok: false, error: 'expired' });
      await worker.deliver({ v: 1, type: 'runstate/put', runState: runState({ status: 'done' }) }, contentSender());
      expect(await begin(worker, { trigger: 'resume' })).toEqual({ ok: false, error: 'expired' });
    });
  });

  it(`is limited to ${RUN_BEGIN_LIMIT.count} a minute per tab`, async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    for (let index = 0; index < RUN_BEGIN_LIMIT.count; index += 1) expect(await begin(worker)).toMatchObject({ ok: true });
    expect(await begin(worker)).toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 60 });
    expect(await begin(worker, {}, contentSender({ tab: { id: 8 } }))).toMatchObject({ ok: true });
    worker.clock.now += RUN_BEGIN_LIMIT.windowMs;
    expect(await begin(worker)).toMatchObject({ ok: true });
  });

  it('forgets a closed tab\'s count', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const tab70 = contentSender({ tab: { id: 70 } });
    for (let index = 0; index < RUN_BEGIN_LIMIT.count; index += 1) {
      await begin(worker);
      await begin(worker, {}, tab70);
    }
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    expect(await begin(worker)).toMatchObject({ ok: true });
    // Tab 70's count is its own: closing tab 7 did not touch it.
    expect(await begin(worker, {}, tab70)).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('replaces the frame\'s earlier run: its id no longer plans', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const first = await beginRun(worker);
    const second = await beginRun(worker);
    const plan = (runId: string) => worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)],
      planKeys: [fieldSpec(1).key], canaries: [], notices: [] }, contentSender());
    expect(await plan(first)).toEqual({ ok: false, error: 'expired' });
    expect(await plan(second)).toMatchObject({ ok: true });
  });

  it('forgets a frame\'s runs when it loads another document, and a tab\'s when it closes', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    const runId = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ documentId: 'doc-2' }));
    const runs = async () => Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith('runs:'));
    expect(await runs()).toEqual([]);
    expect(runId).toBeTruthy();
    await beginRun(worker, {}, contentSender({ documentId: 'doc-2' }));
    expect(await runs()).toHaveLength(1);
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await expect.poll(runs).toEqual([]);
  });

  it('answers the content settings as saved', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const modes = { ...DEFAULT_SETTINGS.modes, next: 'auto' as const, afterPageTurn: 'manual' as const };
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'side', modes } },
      pageSender('options.html'));
    // The frame hears only the modes it acts on (v3 Phase 3 review; v3 Phase 4: Submit and its skip rules).
    expect(await begin(worker)).toMatchObject({ ok: true, data: { settings: { panel: 'side', view: 'expanded',
      modes: { next: 'auto', afterPageTurn: 'manual', submit: 'manual', agentSkip: DEFAULT_SETTINGS.modes.agentSkip,
        signIn: 'manual' },
      llm: DEFAULT_SETTINGS.llm } } });
  });
});
