import { describe, expect, it } from 'vitest';
import type { PlanInput } from '../core/plan/types';
import type { FieldSpec } from '../core/types/field';
import type { PlannedWrite } from '../core/types/fill';
import type { ProfilePath } from '../core/types/intent';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { PROFILE_IDLE_MS } from './profile-cache';
import {
  beginRun,
  contentSender,
  fieldSpec,
  goldens,
  pageSender,
  planOutput,
  restartTestWorker,
  skippedRow,
  startTestWorker,
  tokenRecord,
  type TestWorker,
} from './worker.testkit';

const SENSITIVE = 'GET /api/autofill/profile/sensitive';
const PROFILE = 'GET /api/autofill/profile';

function writeFor(input: PlanInput): PlannedWrite {
  return {
    key: input.specs[0]!.key,
    value: { kind: 'text', text: input.profile.identity.firstName },
    origin: { provenance: 'profile', path: 'identity.firstName' as ProfilePath },
    match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [], reason: 'ok' },
  };
}

/** A planner that writes the first name into the first field. */
const writingPlanner = (input: PlanInput) => planOutput({ writes: [writeFor(input)], results: input.specs.map(skippedRow) });

/** A planner that needs the sensitive part until it has it (or knows it cannot have it). */
const sensitivePlanner = (input: PlanInput) =>
  input.sensitiveState === 'not-loaded' ? planOutput({ needsSensitive: true }) : planOutput({ results: input.specs.map(skippedRow) });

/** plan/request over `extra.specs` (two text fields by default), planning every one of them unless `extra` names
 *  planKeys. */
const planRequest = (worker: TestWorker, runId: string, extra: Record<string, unknown> = {}, sender = contentSender()) => {
  const specs = (extra.specs as FieldSpec[] | undefined) ?? [fieldSpec(1), fieldSpec(2)];
  return worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
    canaries: ['I am LLM'], notices: [], ...extra }, sender);
};

describe('plan/request', () => {
  it('plans the frame\'s fields with the canonical profile, and answers its writes and rows', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: writingPlanner } });
    const runId = await beginRun(worker);
    const answer = await planRequest(worker, runId);
    expect(answer).toEqual({
      ok: true,
      data: {
        writes: [writeFor(worker.core.calls.planFrame[0]!)],
        results: [skippedRow(fieldSpec(1)), skippedRow(fieldSpec(2))],
        awaiting: [],
        persistableCanaries: [],
      },
    });
    const input = worker.core.calls.planFrame[0]!;
    expect(input.specs).toEqual([fieldSpec(1), fieldSpec(2)]);
    expect(input.canaries).toEqual(['I am LLM']);
    expect(input.profile.identity.firstName).toBe(goldens.profile.profile.name.first);
    expect(input.sensitiveState).toBe('not-loaded');
    expect(input.savedAnswers).toEqual([]);
    expect(input.settings).toEqual(DEFAULT_SETTINGS);
    expect(input.dryRun).toBe(false);
    expect(input.now).toEqual({ y: 2026, m: 10, d: 30 });
    // The profile was fetched once, at run/begin.
    expect(worker.tailorit.count(PROFILE)).toBe(1);
  });

  it('hands the core the whole scan and the keys to plan, and refuses a key that is not among the specs (LC-2)',
    async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      const runId = await beginRun(worker);
      expect(await planRequest(worker, runId, { planKeys: [fieldSpec(2).key] })).toMatchObject({ ok: true });
      const input = worker.core.calls.planFrame[0]!;
      expect(input.specs).toEqual([fieldSpec(1), fieldSpec(2)]);
      expect(input.planKeys).toEqual([fieldSpec(2).key]);
      expect(await planRequest(worker, runId, { planKeys: [fieldSpec(9).key] }))
        .toEqual({ ok: false, error: 'bad_message' });
      expect(worker.core.calls.planFrame).toHaveLength(1);
    });

  it('plans with the settings as saved', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const settings = { ...DEFAULT_SETTINGS, autoAdvance: true, preapprovedConsent: ['privacy'] };
    await worker.deliver({ v: 1, type: 'settings/save', settings }, pageSender('options.html'));
    await planRequest(worker, await beginRun(worker));
    expect(worker.core.calls.planFrame[0]!.settings).toEqual(settings);
  });

  it('never sends a write in a dry run, whatever the core planned', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: writingPlanner } });
    const runId = await beginRun(worker, { dryRun: true });
    const answer = (await planRequest(worker, runId)) as { ok: true; data: { writes: unknown[]; results: unknown[] } };
    expect(worker.core.calls.planFrame[0]!.dryRun).toBe(true);
    expect(answer.data.writes).toEqual([]);
    expect(answer.data.results).toHaveLength(2);
  });

  describe('the sensitive part', () => {
    it('is fetched once per run, when a plan needs it, and the plan runs again with it', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: sensitivePlanner } });
      const runId = await beginRun(worker);
      expect(worker.tailorit.count(SENSITIVE)).toBe(0);
      expect(await planRequest(worker, runId)).toMatchObject({ ok: true, data: { results: [{}, {}] } });
      expect(worker.tailorit.count(SENSITIVE)).toBe(1);
      expect(worker.core.calls.planFrame.map((input) => input.sensitiveState)).toEqual(['not-loaded', 'loaded']);
      expect(worker.core.calls.canonicalize.at(-1)).toEqual({ sensitive: true });
      await planRequest(worker, runId);
      expect(worker.tailorit.count(SENSITIVE)).toBe(1);
      expect(worker.core.calls.planFrame.at(-1)!.sensitiveState).toBe('loaded');
    });

    it('is not fetched when no field needs it', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await planRequest(worker, await beginRun(worker));
      expect(worker.tailorit.count(SENSITIVE)).toBe(0);
    });

    it('is not-shared after a 403, and is not asked for again', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: sensitivePlanner } });
      worker.tailorit.reply(SENSITIVE, { status: 403, json: { error: { code: 'forbidden', message: 'x' } } });
      const runId = await beginRun(worker);
      expect(await planRequest(worker, runId)).toMatchObject({ ok: true });
      expect(worker.core.calls.planFrame.map((input) => input.sensitiveState)).toEqual(['not-loaded', 'not-shared']);
      await planRequest(worker, runId);
      await planRequest(worker, await beginRun(worker));
      expect(worker.tailorit.count(SENSITIVE)).toBe(1);
      expect(worker.core.calls.planFrame.at(-1)!.sensitiveState).toBe('not-shared');
    });

    it('is unavailable after any other failure: not retried in that run, tried again in the next', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: sensitivePlanner } });
      worker.tailorit.reply(SENSITIVE, { status: 503, json: { error: { code: 'unavailable', message: 'x' } } });
      const runId = await beginRun(worker);
      await planRequest(worker, runId);
      expect(worker.core.calls.planFrame.map((input) => input.sensitiveState)).toEqual(['not-loaded', 'unavailable']);
      await planRequest(worker, runId);
      expect(worker.tailorit.count(SENSITIVE)).toBe(1);
      expect(worker.core.calls.planFrame.at(-1)!.sensitiveState).toBe('unavailable');
      worker.tailorit.reply(SENSITIVE, { json: goldens.sensitive });
      await planRequest(worker, await beginRun(worker));
      expect(worker.tailorit.count(SENSITIVE)).toBe(2);
      expect(worker.core.calls.planFrame.at(-1)!.sensitiveState).toBe('loaded');
    });

    it('is unavailable after a timeout', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: sensitivePlanner } });
      worker.tailorit.reply(SENSITIVE, { fail: 'hang' });
      const runId = await beginRun(worker);
      const pending = planRequest(worker, runId);
      await expect.poll(() => worker.tailorit.count(SENSITIVE)).toBe(1);
      worker.timeouts.at(-1)!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      expect(await pending).toMatchObject({ ok: true });
      expect(worker.core.calls.planFrame.at(-1)!.sensitiveState).toBe('unavailable');
    });

    it('is kept for the next run of the same profile revision', async () => {
      const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: sensitivePlanner } });
      await planRequest(worker, await beginRun(worker));
      await planRequest(worker, await beginRun(worker));
      expect(worker.tailorit.count(SENSITIVE)).toBe(1);
      // A new revision of the profile makes it stale.
      worker.tailorit.reply(PROFILE, { json: { ...goldens.profile, revision: goldens.profile.revision + 1 } });
      await planRequest(worker, await beginRun(worker));
      expect(worker.tailorit.count(SENSITIVE)).toBe(2);
    });
  });

  it('refuses a run it does not know, or one another frame began', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await planRequest(worker, 'A'.repeat(22))).toEqual({ ok: false, error: 'expired' });
    expect(await planRequest(worker, runId, {}, contentSender({ frameId: 2 }))).toEqual({ ok: false, error: 'expired' });
    expect(await planRequest(worker, runId, {}, contentSender({ documentId: 'doc-2' }))).toEqual({ ok: false, error: 'expired' });
    expect(await planRequest(worker, runId, {}, contentSender({ tab: { id: 8 } }))).toEqual({ ok: false, error: 'expired' });
    expect(worker.core.calls.planFrame).toHaveLength(0);
  });

  it('answers not_connected once the token is gone', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    expect(await planRequest(worker, runId)).toEqual({ ok: false, error: 'not_connected' });
  });

  it('fetches the profile again after 5 idle minutes, and keeps it while it is used', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    worker.timers.advance(PROFILE_IDLE_MS - 1);
    await planRequest(worker, runId);
    worker.timers.advance(PROFILE_IDLE_MS - 1);
    await planRequest(worker, runId);
    expect(worker.tailorit.count(PROFILE)).toBe(1);
    worker.timers.advance(PROFILE_IDLE_MS);
    await planRequest(worker, runId);
    expect(worker.tailorit.count(PROFILE)).toBe(2);
    expect(PROFILE_IDLE_MS).toBe(5 * 60 * 1000);
  });

  it('plans for a run begun before the worker was stopped', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const restarted = await restartTestWorker(worker);
    expect(await planRequest(restarted, runId)).toMatchObject({ ok: true });
    expect(restarted.tailorit.count(PROFILE)).toBe(2);
  });

  it('answers internal when the core fails or plans something the frame could not take', async () => {
    const throwing = await startTestWorker({ token: tokenRecord(), core: { planFrame: () => { throw new Error('bug'); } } });
    expect(await planRequest(throwing, await beginRun(throwing))).toEqual({ ok: false, error: 'internal' });

    const malformed = await startTestWorker({
      token: tokenRecord(),
      core: { planFrame: (input) => planOutput({ writes: [{ ...writeFor(input), origin: undefined } as unknown as PlannedWrite] }) },
    });
    expect(await planRequest(malformed, await beginRun(malformed))).toEqual({ ok: false, error: 'internal' });

    const stuck = await startTestWorker({ token: tokenRecord(), core: { planFrame: () => planOutput({ needsSensitive: true }) } });
    expect(await planRequest(stuck, await beginRun(stuck))).toEqual({ ok: false, error: 'internal' });
  });

  it('refuses fields the schema caps out', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await planRequest(worker, runId, { specs: Array.from({ length: 501 }, (_, index) => fieldSpec(index)) }))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await planRequest(worker, runId, { canaries: Array(33).fill('canary') })).toEqual({ ok: false, error: 'bad_message' });
  });
});

describe('the resume a plan attaches', () => {
  const LOOKUP = 'POST /api/autofill/lookup';
  const RESUMES = 'GET /api/autofill/resumes';
  const fileSpec = () => fieldSpec(3, { kind: 'file', label: 'Resume' });
  const suggested = goldens.lookup.suggestedResume;

  it('is the lookup\'s suggestion, for a pass with a file field', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await planRequest(worker, runId, { specs: [fieldSpec(1), fileSpec()] })).toMatchObject({ ok: true });
    expect(worker.core.calls.planFrame[0]!.profile.resume)
      .toEqual({ id: suggested.id, fileName: suggested.fileName, mime: 'application/pdf', sizeBytes: 0 });
  });

  it('is none for a pass that only carries a file field as context, not planning it (LC-2)', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const lookups = worker.tailorit.count(LOOKUP);
    expect(await planRequest(worker, runId, { specs: [fieldSpec(1), fileSpec()], planKeys: [fieldSpec(1).key] }))
      .toMatchObject({ ok: true });
    expect(worker.core.calls.planFrame[0]!.profile.resume).toBeUndefined();
    expect(worker.tailorit.count(LOOKUP)).toBe(lookups);
  });

  it('is none for a pass without one, and TailorIT is asked nothing more', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    const lookups = worker.tailorit.count(LOOKUP);
    expect(await planRequest(worker, runId)).toMatchObject({ ok: true });
    expect(worker.core.calls.planFrame[0]!.profile.resume).toBeUndefined();
    expect(worker.tailorit.count(LOOKUP)).toBe(lookups);
    expect(worker.tailorit.count(RESUMES)).toBe(0);
  });

  it('is chosen once per run, and again from the frame\'s own address after the worker was stopped', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    await planRequest(worker, runId, { specs: [fileSpec()] });
    await planRequest(worker, runId, { specs: [fileSpec()] });
    const lookups = worker.tailorit.count(LOOKUP);
    expect(lookups).toBe(1);

    const restarted = await restartTestWorker(worker);
    expect(await planRequest(restarted, runId, { specs: [fileSpec()] })).toMatchObject({ ok: true });
    expect(restarted.tailorit.count(LOOKUP)).toBe(lookups + 1);
    expect(restarted.core.calls.planFrame.at(-1)!.profile.resume?.id).toBe(suggested.id);
  });

  it('falls back to the profile\'s own choice when the lookup failed', async () => {
    // Not the lookup's suggestion, so the test tells the two apart.
    const own = goldens.resumes.items[1]!;
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(PROFILE,
      { json: { ...goldens.profile, profile: { ...goldens.profile.profile, documents: { resumeId: own.id } } } });
    worker.tailorit.reply(LOOKUP, { status: 503 }, { once: true });
    const runId = await beginRun(worker);
    expect(await planRequest(worker, runId, { specs: [fileSpec()] })).toMatchObject({ ok: true });
    expect(worker.core.calls.planFrame[0]!.profile.resume).toEqual({ id: own.id, fileName: own.fileName,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 0 });
    expect(worker.tailorit.count(RESUMES)).toBe(1);
  });

  it('is none when the lookup failed and the profile names no resume', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply(LOOKUP, { status: 503 }, { once: true });
    const runId = await beginRun(worker);
    expect(await planRequest(worker, runId, { specs: [fileSpec()] })).toMatchObject({ ok: true });
    expect(worker.core.calls.planFrame[0]!.profile.resume).toBeUndefined();
    expect(worker.tailorit.count(RESUMES)).toBe(0);
  });
});

describe('plan/poll', () => {
  it('answers expired for a run it knows when none of the keys waits there (a worker that restarted forgot them)', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const runId = await beginRun(worker);
    expect(await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [fieldSpec(1).key] }, contentSender()))
      .toEqual({ ok: false, error: 'expired' });
  });

  it('answers expired for a run it does not know, so the frame plans again', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(await worker.deliver({ v: 1, type: 'plan/poll', runId: 'B'.repeat(22), keys: [] }, contentSender()))
      .toEqual({ ok: false, error: 'expired' });
  });
});
