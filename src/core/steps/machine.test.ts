import { describe, expect, it } from 'vitest';
// The report's notice list, read here only to check that the machine's notices name its codes.
import { NOTICE_CODES } from '../../shared/report';
import type { FieldKey } from '../types/field';
import { RESUME_AUTO_MS, RUN_STATE_TTL_MS, RUN_STATUSES, type RunState, type RunStatus } from '../types/run';
import {
  ADVANCE_REFUSALS, autoAdvanceVerdict, autoSubmitVerdict, createRunState, SUBMIT_REFUSALS, MAX_FILLED_KEYS_PER_STEP, MAX_IDLE_TRANSITIONS, MAX_STEP_ATTEMPTS,
  MAX_STEPS,
  noticeOfPause, reduceRun, repeatableCounterKey, resumeMode, STEP_NOTICES, storedFieldKey, TRANSITION_CAP_MS,
  type RunContext, type RunEffect, type RunEvent, type StepFacts,
} from './machine';
import { stepSignature } from './signature';

const T0 = 1_800_000_000_000;
const APP = 'workday:0123456789abcdef';
const OFF: RunContext = { autoAdvance: false, now: T0 + 1000 };
const ON: RunContext = { autoAdvance: true, now: T0 + 1000 };

const SIG = [1, 2, 3, 4, 5].map((n) => stepSignature({ heading: `Step ${n}`, progress: `Step ${n} of 4`, anchors: [] }));
const [S1, S2, S3, S4] = SIG as [string, string, string, string];

const fresh = () => createRunState({ applicationKey: APP, platform: 'workday', now: T0 });
/** A state at `status` on step S1 (attempted `attempts` times), as the reducer would leave it. */
function at(status: RunStatus, patch: Partial<RunState> = {}, attempts = 1): RunState {
  return { ...fresh(), status, stepSignature: S1, stepAttempts: { [S1]: attempts }, ...patch };
}

const types = (effects: readonly RunEffect[]) => effects.map((effect) => effect.type);
const scanned = (signature: string, extra: Partial<Extract<RunEvent, { type: 'SCANNED' }>> = {}): RunEvent =>
  ({ type: 'SCANNED', signature, policyHits: 0, tripwireHits: 0, canaries: [], ...extra });
const filled = (counts: Partial<{ flagged: number; blocked: number; unresolved: number }> = {},
  keys: string[] = []): RunEvent => ({ type: 'FILLED', filledKeys: keys as FieldKey[], flagged: 0, blocked: 0,
  unresolved: 0, ...counts });
const facts = (patch: Partial<StepFacts> = {}): StepFacts =>
  ({ finality: 'not-final', nextVisible: true, settled: true, unconfirmedDrafts: 0, captchaUnsolved: false, ...patch });
const validated = (errors = 0, fixable = 0, step: Partial<StepFacts> = {}): RunEvent =>
  ({ type: 'VALIDATED', errors, fixable, step: facts(step) });
const CLEAN = { flagged: 0, blocked: 0, unresolved: 0 };

/** Runs the events in turn; answers the last state and every event's effects. */
function drive(state: RunState, events: readonly RunEvent[], ctx: RunContext = OFF) {
  let current = state;
  const effects: RunEffect[][] = [];
  for (const event of events) {
    const step = reduceRun(current, event, ctx);
    current = step.state;
    effects.push(step.effects);
  }
  return { state: current, effects };
}

describe('the step signature as RunState holds it', () => {
  it('is 16 hex, the form RunStateSchema checks', () => {
    for (const signature of SIG) expect(signature).toMatch(/^[a-f0-9]{16}$/);
    expect(new Set(SIG).size).toBe(SIG.length);
  });
});

describe('createRunState', () => {
  it('starts at detect with nothing counted, startedAt and updatedAt now', () => {
    expect(fresh()).toEqual({
      version: 1, applicationKey: APP, platform: 'workday', status: 'detect', resumeStatus: null, pauseReason: null,
      stepSignature: null, stepIndex: 0, stepAttempts: {}, filledFieldKeys: {}, repeatableCounters: {}, canarySet: [],
      tripwire: { triggered: false, hits: 0 }, policyDecision: null, revealEdges: [], aiTasks: {}, lastFill: null,
      startedAt: T0, updatedAt: T0,
    });
  });
});

describe('the transition table', () => {
  describe('detect', () => {
    it('DETECTED: scan-step, and the step is scanned', () => {
      const { state, effects } = reduceRun(fresh(), { type: 'DETECTED' }, OFF);
      expect(state.status).toBe('scan-step');
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'scan' }]);
      expect(state.updatedAt).toBe(OFF.now);
      expect(state.startedAt).toBe(T0);
    });

    it('NOT_AN_APPLICATION: stopped', () => {
      const { state, effects } = reduceRun(fresh(), { type: 'NOT_AN_APPLICATION' }, OFF);
      expect(state.status).toBe('stopped');
      expect(types(effects)).toEqual(['persist', 'report']);
    });

    it('takes DETECTED and NOT_AN_APPLICATION only at detect', () => {
      const scanning = at('scan-step');
      expect(reduceRun(scanning, { type: 'DETECTED' }, OFF)).toEqual({ state: scanning, effects: [] });
      expect(reduceRun(scanning, { type: 'NOT_AN_APPLICATION' }, OFF)).toEqual({ state: scanning, effects: [] });
    });
  });

  describe('auth and pauses', () => {
    it('AUTH: auth-needed, remembering where it came from, with no pause reason', () => {
      for (const wall of ['sign-in', 'create-account'] as const) {
        const { state, effects } = reduceRun(fresh(), { type: 'AUTH', wall }, OFF);
        expect(state).toMatchObject({ status: 'auth-needed', resumeStatus: 'detect', pauseReason: null });
        expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'pause', kind: 'auth' },
          { type: 'notify', notice: 'auth' }]);
      }
    });

    it('PAUSE from a working status: handoff with the reason, and where it came from', () => {
      const { state, effects } = reduceRun(at('fill-step'), { type: 'PAUSE', reason: 'captcha' }, OFF);
      expect(state).toMatchObject({ status: 'handoff', resumeStatus: 'fill-step', pauseReason: 'captcha' });
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'pause', kind: 'handoff' },
        { type: 'notify', notice: 'captcha' }]);
      for (const status of ['detect', 'scan-step', 'validate', 'advance', 'wait-transition'] as const) {
        expect(reduceRun(at(status), { type: 'PAUSE', reason: 'page-busy' }, OFF).state)
          .toMatchObject({ status: 'handoff', resumeStatus: status, pauseReason: 'page-busy' });
      }
    });

    it('asks only for notices the report has', () => {
      const codes: readonly string[] = NOTICE_CODES;
      expect(STEP_NOTICES.filter((notice) => !codes.includes(notice))).toEqual([]);
    });

    it('PAUSE words each reason as the content script\'s pauses do', () => {
      expect(noticeOfPause('captcha')).toBe('captcha');
      expect(noticeOfPause('bot-check')).toBe('captcha');
      expect(noticeOfPause('email-code')).toBe('auth');
      expect(noticeOfPause('entry-choice')).toBe('auth');
      expect(noticeOfPause('page-busy')).toBe('page-busy');
      expect(noticeOfPause('needs-click')).toBe('needs-click');
    });

    it('PAUSE while handed off takes the newer reason and keeps where it came from; the same reason is no change', () => {
      const handed = reduceRun(at('fill-step'), { type: 'PAUSE', reason: 'page-busy' }, OFF).state;
      const again = reduceRun(handed, { type: 'PAUSE', reason: 'captcha' }, OFF);
      expect(again.state).toMatchObject({ status: 'handoff', resumeStatus: 'fill-step', pauseReason: 'captcha' });
      expect(types(again.effects)).toEqual(['persist', 'report', 'pause', 'notify']);
      expect(reduceRun(again.state, { type: 'PAUSE', reason: 'captcha' }, OFF)).toEqual({ state: again.state, effects: [] });
    });

    it('PAUSE and AUTH are ignored where the extension is not working (review, the policy card, a sign-in wall)', () => {
      for (const status of ['review', 'policy-notice', 'auth-needed'] as const) {
        const state = at(status);
        expect(reduceRun(state, { type: 'PAUSE', reason: 'captcha' }, OFF)).toEqual({ state, effects: [] });
      }
      for (const status of ['review', 'policy-notice', 'auth-needed'] as const) {
        const state = at(status);
        expect(reduceRun(state, { type: 'AUTH', wall: 'sign-in' }, OFF)).toEqual({ state, effects: [] });
      }
    });

    it('AUTH while handed off: auth-needed, keeping where the handoff came from', () => {
      const handed = reduceRun(at('validate'), { type: 'PAUSE', reason: 'email-code' }, OFF).state;
      expect(reduceRun(handed, { type: 'AUTH', wall: 'sign-in' }, OFF).state)
        .toMatchObject({ status: 'auth-needed', resumeStatus: 'validate', pauseReason: null });
    });

    it('CONTINUE leaves a handoff or a sign-in wall to scan the step again, the pause cleared', () => {
      for (const status of ['handoff', 'auth-needed'] as const) {
        const paused = at(status, { resumeStatus: 'fill-step', pauseReason: status === 'handoff' ? 'captcha' : null });
        const { state, effects } = reduceRun(paused, { type: 'CONTINUE' }, OFF);
        expect(state).toMatchObject({ status: 'scan-step', resumeStatus: null, pauseReason: null });
        expect(types(effects)).toEqual(['persist', 'report', 'scan']);
      }
    });

    it('CONTINUE is ignored anywhere else, the policy card included (its own buttons decide)', () => {
      for (const status of ['detect', 'scan-step', 'fill-step', 'validate', 'advance', 'wait-transition', 'review',
        'policy-notice'] as const) {
        const state = at(status);
        expect(reduceRun(state, { type: 'CONTINUE' }, OFF)).toEqual({ state, effects: [] });
      }
    });
  });

  describe('scan-step', () => {
    const scanning = () => ({ ...fresh(), status: 'scan-step' as const });

    it('SCANNED, first visit: fill-step as attempt 1, the attempt stored before anything is written', () => {
      const { state, effects } = reduceRun(scanning(), scanned(S1), OFF);
      expect(state).toMatchObject({ status: 'fill-step', stepSignature: S1, stepIndex: 0, stepAttempts: { [S1]: 1 } });
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'fill-step', attempt: 1, fix: false }]);
    });

    it('SCANNED, one attempt before (a reload): attempt 2', () => {
      const { state, effects } = reduceRun(at('scan-step'), scanned(S1), OFF);
      expect(state.stepAttempts).toEqual({ [S1]: 2 });
      expect(effects.at(-1)).toEqual({ type: 'fill-step', attempt: 2, fix: false });
    });

    it('SCANNED after two attempts: review with step-retry-limit, nothing filled and nothing counted', () => {
      const { state, effects } = reduceRun(at('scan-step', {}, 2), scanned(S1), OFF);
      expect(state).toMatchObject({ status: 'review', stepAttempts: { [S1]: 2 } });
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'notify', notice: 'step-retry-limit' },
        { type: 'show-review', cause: 'step-retry-limit', reason: null }]);
      expect(types(effects)).not.toContain('fill-step');
    });

    it('SCANNED with another signature: a new step, its index one more', () => {
      const { state } = reduceRun(at('scan-step'), scanned(S2), OFF);
      expect(state).toMatchObject({ status: 'fill-step', stepSignature: S2, stepIndex: 1,
        stepAttempts: { [S1]: 1, [S2]: 1 } });
    });

    it('SCANNED past MAX_STEPS steps: review with the max-steps notice, nothing filled', () => {
      const many = Object.fromEntries(Array.from({ length: MAX_STEPS }, (_, n) =>
        [stepSignature({ heading: `Page ${n}`, anchors: [] }), 1]));
      const deep = { ...fresh(), status: 'scan-step' as const, stepAttempts: many };
      const { state, effects } = reduceRun(deep, scanned(S2), OFF);
      expect(state.status).toBe('review');
      expect(state.stepAttempts[S2]).toBeUndefined();
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'notify', notice: 'max-steps' },
        { type: 'show-review', cause: 'max-steps', reason: null }]);
    });

    it('SCANNED never records more than MAX_STEPS signatures (RunStateSchema\'s record cap)', () => {
      const many = Object.fromEntries(Array.from({ length: MAX_STEPS }, (_, n) =>
        [stepSignature({ heading: `Page ${n}`, anchors: [] }), 1]));
      const full = { ...fresh(), status: 'scan-step' as const, stepAttempts: many };
      const { state } = reduceRun(full, scanned(S1), OFF);
      expect(state.status).toBe('review');
      expect(Object.keys(state.stepAttempts)).toHaveLength(MAX_STEPS);
      // A step already counted may still be filled.
      const known = Object.keys(many)[3]!;
      expect(reduceRun({ ...full, stepSignature: known }, scanned(known), OFF).state.status).toBe('fill-step');
    });

    it('v4 (D6): SCANNED with a policy statement and no decision: filled all the same, never a card (the content script makes the run profile-only)', () => {
      const { state, effects } = reduceRun(scanning(), scanned(S1, { policyHits: 1 }), OFF);
      expect(state).toMatchObject({ status: 'fill-step', stepSignature: S1, stepAttempts: { [S1]: 1 } });
      expect(effects).not.toContainEqual(expect.objectContaining({ type: 'pause' }));
      expect(effects).not.toContainEqual({ type: 'notify', notice: 'policy' });
      expect(effects.at(-1)).toEqual({ type: 'fill-step', attempt: 1, fix: false });
    });

    it('SCANNED with a policy statement after Fill anyway: filled, the card not shown again', () => {
      const { state, effects } = reduceRun({ ...scanning(), policyDecision: 'accepted' }, scanned(S1, { policyHits: 2 }),
        OFF);
      expect(state.status).toBe('fill-step');
      expect(types(effects)).not.toContain('pause');
    });

    it('SCANNED with tripwire hits: the notice, counted once per step; canaries merged, nearest first, capped', () => {
      const first = reduceRun(scanning(), scanned(S1, { tripwireHits: 2, canaries: ['I am LLM', 'purple monkey'] }), OFF);
      expect(first.effects).toContainEqual({ type: 'notify', notice: 'tripwire' });
      expect(first.state.tripwire).toEqual({ triggered: true, hits: 2 });
      expect(first.state.canarySet).toEqual(['I am LLM', 'purple monkey']);
      // A reload's scan of the same step finds the same text: not counted again.
      const again = reduceRun({ ...first.state, status: 'scan-step' }, scanned(S1, { tripwireHits: 2,
        canaries: ['I am LLM'] }), OFF);
      expect(again.state.tripwire).toEqual({ triggered: true, hits: 2 });
      expect(again.state.canarySet).toEqual(['I am LLM', 'purple monkey']);
      // The next step's canaries come first; at most 32 are kept, none past 120 characters.
      const fresh40 = Array.from({ length: 40 }, (_, n) => `canary number ${n}`);
      const next = reduceRun({ ...first.state, status: 'scan-step' }, scanned(S2, { tripwireHits: 1,
        canaries: ['x'.repeat(121), ...fresh40] }), OFF);
      expect(next.state.canarySet).toHaveLength(32);
      expect(next.state.canarySet[0]).toBe('canary number 0');
      expect(next.state.canarySet.every((canary) => canary.length <= 120)).toBe(true);
      expect(next.state.tripwire.hits).toBe(3);
    });

    it('SCANNED with no hits says nothing of the tripwire', () => {
      expect(types(reduceRun(scanning(), scanned(S1), OFF).effects)).not.toContain('notify');
    });

    it('SCANNED with a malformed signature: review with internal-error, nothing stored under it', () => {
      const { state, effects } = reduceRun(scanning(), scanned('Step 1'), OFF);
      expect(state).toMatchObject({ status: 'review', stepSignature: null, stepAttempts: {} });
      expect(effects.at(-1)).toEqual({ type: 'show-review', cause: 'error', reason: 'internal-error' });
    });

    it('takes SCANNED only at scan-step', () => {
      for (const status of ['detect', 'fill-step', 'validate', 'wait-transition', 'review', 'handoff'] as const) {
        const state = at(status);
        expect(reduceRun(state, scanned(S2), OFF)).toEqual({ state, effects: [] });
      }
    });
  });

  describe('policy-notice (v4, D6: no card any more)', () => {
    it('a run stored at the old card is scanned again once resumed, by the load or the person', () => {
      const card = at('policy-notice');
      for (const by of ['load', 'person'] as const) {
        const { state, effects } = reduceRun(card, { type: 'RESUMED', by, sameTab: true }, OFF);
        expect(state.status).toBe('scan-step');
        expect(effects.at(-1)).toEqual({ type: 'scan' });
      }
    });
  });

  describe('fill-step', () => {
    it('FILLED: validate, the keys stored with their page text hashed, each once, and the counts kept', () => {
      const key = 'workday|my-information|legal-name|none|0';
      const { state, effects } = reduceRun(at('fill-step', { filledFieldKeys: { [S1]: [storedFieldKey(key as FieldKey)] } }),
        filled({ flagged: 1, blocked: 2, unresolved: 3 }, [key, 'workday|my-information|email|none|0']), OFF);
      expect(state.status).toBe('validate');
      expect(state.lastFill).toEqual({ flagged: 1, blocked: 2, unresolved: 3 });
      expect(state.filledFieldKeys[S1]).toEqual([storedFieldKey(key as FieldKey),
        storedFieldKey('workday|my-information|email|none|0' as FieldKey)]);
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'validate' }]);
    });

    it('FILLED keeps at most MAX_FILLED_KEYS_PER_STEP keys a step', () => {
      const keys = Array.from({ length: MAX_FILLED_KEYS_PER_STEP + 20 }, (_, n) => `workday|s|field-${n}|none|0`);
      expect(reduceRun(at('fill-step'), filled({}, keys), OFF).state.filledFieldKeys[S1]).toHaveLength(
        MAX_FILLED_KEYS_PER_STEP);
    });

    it('FILLED counts are whole and never negative', () => {
      expect(reduceRun(at('fill-step'), filled({ flagged: -1, blocked: 2.7, unresolved: Number.NaN }), OFF).state.lastFill)
        .toEqual({ flagged: 0, blocked: 2, unresolved: 0 });
    });

    it('REPEATABLE: the counters stored under the step and kind, with no report and nothing else changed', () => {
      const state = at('fill-step');
      const step = reduceRun(state, { type: 'REPEATABLE', kind: 'experience',
        counter: { profile: 2, rendered: 0, addClicks: 1 } }, OFF);
      expect(step.state).toEqual({ ...state, repeatableCounters: { [repeatableCounterKey(S1, 'experience')]:
        { profile: 2, rendered: 0, addClicks: 1 } }, updatedAt: OFF.now });
      expect(step.effects).toEqual([{ type: 'persist' }]);
      expect(repeatableCounterKey(S1, 'experience')).toBe(`${S1}:experience`);
    });

    it('REPEATABLE is ignored outside a fill, and for a kind no adapter declares', () => {
      const validating = at('validate');
      const counter = { profile: 1, rendered: 1, addClicks: 0 };
      expect(reduceRun(validating, { type: 'REPEATABLE', kind: 'education', counter }, OFF).effects).toEqual([]);
      const filling = at('fill-step');
      expect(reduceRun(filling, { type: 'REPEATABLE', kind: 'skills' as never, counter }, OFF).effects).toEqual([]);
    });

    it('takes FILLED only at fill-step', () => {
      const state = at('validate');
      expect(reduceRun(state, filled(), OFF)).toEqual({ state, effects: [] });
    });
  });

  describe('validate', () => {
    const ready = (patch: Partial<RunState> = {}, attempts = 1) => at('validate', { lastFill: CLEAN, ...patch }, attempts);

    it('no error, not final, auto-advance on and every check clear: advance, and Next is pressed', () => {
      const { state, effects } = reduceRun(ready(), validated(), ON);
      expect(state.status).toBe('advance');
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'press-next' }]);
    });

    it('no error, not final, auto-advance off: Next is the person\'s, awaited with no timer (nothing drawn)', () => {
      const { state, effects } = reduceRun(ready(), validated(), OFF);
      expect(state.status).toBe('wait-transition');
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' },
        { type: 'await-transition', from: S1, capMs: null }]);
    });

    it('no error, not final, a check failing: the same wait for the person', () => {
      const { state, effects } = reduceRun(ready({ lastFill: { ...CLEAN, flagged: 1 } }), validated(), ON);
      expect(state.status).toBe('wait-transition');
      expect(effects.at(-1)).toEqual({ type: 'await-transition', from: S1, capMs: null });
      expect(types(effects)).not.toContain('press-next');
    });

    it('no error, final: review, Submit the person\'s, never press-next, auto-advance or not', () => {
      for (const ctx of [OFF, ON]) {
        const { state, effects } = reduceRun(ready(), validated(0, 0, { finality: 'final' }), ctx);
        expect(state.status).toBe('review');
        expect(effects).toEqual([{ type: 'persist' }, { type: 'report' },
          { type: 'show-review', cause: 'final-step', reason: null }]);
      }
    });

    it('no error, finality unknown: treated as final, nothing pressed, the sentence only with auto-advance on', () => {
      const off = reduceRun(ready(), validated(0, 0, { finality: 'unknown' }), OFF);
      expect(off.state.status).toBe('review');
      expect(off.effects).toEqual([{ type: 'persist' }, { type: 'report' },
        { type: 'show-review', cause: 'final-unknown', reason: null }]);
      const on = reduceRun(ready(), validated(0, 0, { finality: 'unknown' }), ON);
      expect(on.effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'notify', notice: 'final-unknown' },
        { type: 'show-review', cause: 'final-unknown', reason: null }]);
    });

    it('errors a pass can fix, first attempt: one more pass (the fix), counted as attempt 2', () => {
      const { state, effects } = reduceRun(ready(), validated(2, 1), OFF);
      expect(state).toMatchObject({ status: 'fill-step', stepAttempts: { [S1]: 2 }, lastFill: CLEAN });
      expect(effects.at(-1)).toEqual({ type: 'fill-step', attempt: 2, fix: true });
    });

    it('errors a pass could fix, but the step had its two attempts: review, surfaced, never paused on', () => {
      const { state, effects } = reduceRun(ready({}, 2), validated(2, 1), ON);
      expect(state).toMatchObject({ status: 'review', pauseReason: null, stepAttempts: { [S1]: 2 } });
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'notify', notice: 'validation' },
        { type: 'notify', notice: 'step-retry-limit' }, { type: 'show-review', cause: 'step-retry-limit', reason: null }]);
    });

    it('errors no pass can fix: review with the errors surfaced, never paused on', () => {
      const { state, effects } = reduceRun(ready(), validated(3, 0), ON);
      expect(state).toMatchObject({ status: 'review', pauseReason: null });
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' }, { type: 'notify', notice: 'validation' },
        { type: 'show-review', cause: 'validation-errors', reason: null }]);
    });

    it('errors on a final step are fixed or surfaced the same way: never Next, never Submit', () => {
      const { effects } = reduceRun(ready(), validated(1, 0, { finality: 'final' }), ON);
      expect(types(effects)).not.toContain('press-next');
      expect(effects.at(-1)).not.toEqual({ type: 'show-review', cause: 'final-step', reason: null });
    });

    it('ADVANCED by the person before the extension decided: their transition awaited with no timer', () => {
      const { state, effects } = reduceRun(ready(), { type: 'ADVANCED', by: 'person' }, ON);
      expect(state.status).toBe('wait-transition');
      expect(effects.at(-1)).toEqual({ type: 'await-transition', from: S1, capMs: null });
      expect(reduceRun(ready(), { type: 'ADVANCED', by: 'extension' }, ON).effects).toEqual([]);
    });

    it('takes VALIDATED only at validate', () => {
      const state = at('fill-step');
      expect(reduceRun(state, validated(), ON)).toEqual({ state, effects: [] });
    });
  });

  describe('advance', () => {
    it('ADVANCED by the extension: the transition awaited at most TRANSITION_CAP_MS, or the adapter\'s cap', () => {
      const { state, effects } = reduceRun(at('advance'), { type: 'ADVANCED', by: 'extension' }, ON);
      expect(state.status).toBe('wait-transition');
      expect(effects).toEqual([{ type: 'persist' }, { type: 'report' },
        { type: 'await-transition', from: S1, capMs: TRANSITION_CAP_MS }]);
      expect(TRANSITION_CAP_MS).toBe(20_000);
      expect(reduceRun(at('advance'), { type: 'ADVANCED', by: 'extension' }, { ...ON, transitionCapMs: 30_000 })
        .effects.at(-1)).toEqual({ type: 'await-transition', from: S1, capMs: 30_000 });
    });

    it('ADVANCED by the person: no timer', () => {
      expect(reduceRun(at('advance'), { type: 'ADVANCED', by: 'person' }, ON).effects.at(-1))
        .toEqual({ type: 'await-transition', from: S1, capMs: null });
    });

    it('PAUSE needs-click when the click was refused or Next went: handoff', () => {
      expect(reduceRun(at('advance'), { type: 'PAUSE', reason: 'needs-click' }, ON).state)
        .toMatchObject({ status: 'handoff', resumeStatus: 'advance', pauseReason: 'needs-click' });
    });
  });

  describe('wait-transition', () => {
    const waiting = () => at('wait-transition', { lastFill: CLEAN });

    it('TRANSITIONED to another signature: scan-step, and the new step is scanned', () => {
      const { state, effects } = reduceRun(waiting(), { type: 'TRANSITIONED', signature: S2 }, OFF);
      expect(state.status).toBe('scan-step');
      expect(types(effects)).toEqual(['persist', 'report', 'scan']);
      // The step itself is counted by the scan that follows.
      expect(reduceRun(state, scanned(S2), OFF).state).toMatchObject({ stepIndex: 1, stepSignature: S2 });
    });

    it('TRANSITIONED to the same signature, or a malformed one, is no transition', () => {
      const state = waiting();
      expect(reduceRun(state, { type: 'TRANSITIONED', signature: S1 }, OFF)).toEqual({ state, effects: [] });
      expect(reduceRun(state, { type: 'TRANSITIONED', signature: 'next' }, OFF)).toEqual({ state, effects: [] });
    });

    it('v4 (D7): TIMED_OUT with the step unchanged: validated again, its lastFill cleared, never a hand-off', () => {
      const { state, effects } = reduceRun(waiting(), { type: 'TIMED_OUT', signature: S1 }, ON);
      expect(state).toMatchObject({ status: 'validate', pauseReason: null, lastFill: null });
      expect(effects.at(-1)).toEqual({ type: 'validate' });
      expect(effects).not.toContainEqual(expect.objectContaining({ type: 'pause' }));
    });

    it('v4 (D7): TIMED_OUT with the step changed but the page still busy: scanned as the new step, never a hand-off', () => {
      const { state, effects } = reduceRun(waiting(), { type: 'TIMED_OUT', signature: S2 }, ON);
      expect(state).toMatchObject({ status: 'scan-step', pauseReason: null });
      expect(effects.at(-1)).toEqual({ type: 'scan' });
    });

    it('v4 (D7): NEXT_WITHHELD not-pressable (no Next, or a click refused): the person\'s Next, silently', () => {
      const { state, effects } = reduceRun(at('advance', { stepSignature: S1 }),
        { type: 'NEXT_WITHHELD', reason: 'not-pressable' }, ON);
      expect(state.status).toBe('wait-transition');
      expect(effects.at(-1)).toEqual({ type: 'await-transition', from: S1, capMs: null });
      expect(effects).not.toContainEqual(expect.objectContaining({ type: 'notify' }));
    });

    it('STEP_UNCHANGED (the person\'s Next left errors): validate again', () => {
      const { state, effects } = reduceRun(waiting(), { type: 'STEP_UNCHANGED' }, OFF);
      expect(state.status).toBe('validate');
      expect(types(effects)).toEqual(['persist', 'report', 'validate']);
    });

    it('SUBMITTED: done', () => {
      expect(reduceRun(waiting(), { type: 'SUBMITTED' }, OFF).state.status).toBe('done');
    });

    it('ADVANCED by the person while waiting changes nothing', () => {
      const state = waiting();
      expect(reduceRun(state, { type: 'ADVANCED', by: 'person' }, OFF)).toEqual({ state, effects: [] });
    });

    it('takes TIMED_OUT and STEP_UNCHANGED only while waiting', () => {
      const state = at('review');
      expect(reduceRun(state, { type: 'TIMED_OUT', signature: S1 }, OFF)).toEqual({ state, effects: [] });
      expect(reduceRun(state, { type: 'STEP_UNCHANGED' }, OFF)).toEqual({ state, effects: [] });
    });
  });

  describe('review', () => {
    it('TRANSITIONED (the person went on from an unknown or limited step): scan-step', () => {
      const { state } = reduceRun(at('review'), { type: 'TRANSITIONED', signature: S2 }, OFF);
      expect(state.status).toBe('scan-step');
    });

    it('SUBMITTED: done', () => {
      expect(reduceRun(at('review'), { type: 'SUBMITTED' }, OFF).state.status).toBe('done');
    });

    it('TRANSITIONED also ends a fill, validation or advance the step changed under', () => {
      for (const status of ['fill-step', 'validate', 'advance'] as const) {
        expect(reduceRun(at(status), { type: 'TRANSITIONED', signature: S2 }, OFF).state.status).toBe('scan-step');
      }
      for (const status of ['detect', 'scan-step', 'handoff', 'auth-needed', 'policy-notice'] as const) {
        const state = at(status);
        expect(reduceRun(state, { type: 'TRANSITIONED', signature: S2 }, OFF)).toEqual({ state, effects: [] });
      }
    });
  });

  describe('any status', () => {
    const live = RUN_STATUSES.filter((status) => status !== 'done' && status !== 'stopped');

    it('USER_STOPPED: stopped, any pause cleared', () => {
      for (const status of live) {
        const state = reduceRun(at(status, status === 'handoff' ? { pauseReason: 'captcha', resumeStatus: 'fill-step' }
          : {}), { type: 'USER_STOPPED' }, OFF).state;
        expect(state).toMatchObject({ status: 'stopped', pauseReason: null, resumeStatus: null });
      }
    });

    it('ERROR: review with the reason', () => {
      for (const status of live) {
        const { state, effects } = reduceRun(at(status), { type: 'ERROR', reason: 'internal-error' }, OFF);
        expect(state.status).toBe('review');
        expect(effects.at(-1)).toEqual({ type: 'show-review', cause: 'error', reason: 'internal-error' });
      }
    });

    it('SUBMITTED: done from any status (the confirmation page may load in any new document)', () => {
      for (const status of live) expect(reduceRun(at(status), { type: 'SUBMITTED' }, OFF).state.status).toBe('done');
    });

    it('done and stopped take nothing at all', () => {
      const events: RunEvent[] = [{ type: 'DETECTED' }, { type: 'CONTINUE' }, scanned(S2), filled(), validated(),
        { type: 'ADVANCED', by: 'extension' }, { type: 'TRANSITIONED', signature: S2 }, { type: 'SUBMITTED' },
        { type: 'USER_STOPPED' }, { type: 'ERROR', reason: 'internal-error' }, { type: 'PAUSE', reason: 'captcha' },
        { type: 'RESUMED', by: 'person', sameTab: true }, { type: 'NEXT_WITHHELD', reason: 'setting-off' },
        { type: 'NEXT_WITHHELD', reason: 'captcha-unsolved' }, { type: 'NEXT_WITHHELD', reason: 'not-pressable' }];
      for (const status of ['done', 'stopped'] as const) {
        const state = at(status);
        for (const event of events) expect(reduceRun(state, event, ON)).toEqual({ state, effects: [] });
      }
    });
  });

  describe('RESUMED', () => {
    const later = (ms: number): RunContext => ({ autoAdvance: false, now: T0 + ms });
    const load: RunEvent = { type: 'RESUMED', by: 'load', sameTab: true };
    const person: RunEvent = { type: 'RESUMED', by: 'person', sameTab: true };

    it('by the load, within RESUME_AUTO_MS: the step scanned again, its attempts counted', () => {
      for (const status of ['detect', 'scan-step', 'fill-step', 'validate', 'advance', 'wait-transition'] as const) {
        const { state, effects } = reduceRun(at(status, { updatedAt: T0 }), load, later(RESUME_AUTO_MS));
        expect(state.status).toBe('scan-step');
        expect(types(effects)).toEqual(['persist', 'report', 'scan']);
      }
    });

    it('by the load at review, however soon: never filled again by itself, Continue is offered', () => {
      for (const cause of ['final-step', 'final-unknown', 'step-retry-limit'] as const) {
        const state = at('review', { updatedAt: T0 });
        expect(reduceRun(state, load, later(1)), cause).toEqual({ state,
          effects: [{ type: 'report' }, { type: 'offer-continue' }] });
      }
      // The person's Continue scans the step again.
      expect(reduceRun(at('review', { updatedAt: T0 }), person, later(1)).state.status).toBe('scan-step');
    });

    it('by the load with Autofill after page turn: Manually (v3 Phase 3): never filled by itself, Continue is offered', () => {
      const manual: RunContext = { ...later(1), fillAfterPageTurn: false };
      for (const status of ['detect', 'scan-step', 'fill-step', 'wait-transition'] as const) {
        const state = at(status, { updatedAt: T0 });
        expect(reduceRun(state, load, manual), status).toEqual({ state,
          effects: [{ type: 'report' }, { type: 'offer-continue' }] });
      }
      // The person's Continue fills it, as at review; and Automatically (the default) changes nothing of before.
      expect(reduceRun(at('fill-step', { updatedAt: T0 }), person, manual).state.status).toBe('scan-step');
      expect(reduceRun(at('fill-step', { updatedAt: T0 }), load, { ...later(1), fillAfterPageTurn: true }).state.status)
        .toBe('scan-step');
    });

    it('by the load, later than that: nothing changes and Continue is offered', () => {
      const state = at('fill-step', { updatedAt: T0 });
      expect(reduceRun(state, load, later(RESUME_AUTO_MS + 1))).toEqual({ state,
        effects: [{ type: 'report' }, { type: 'offer-continue' }] });
    });

    it('by the load, at a pause: the pause shown again, nothing changed (the person must act)', () => {
      const cases: Array<[RunState, RunEffect[]]> = [
        [at('auth-needed', { resumeStatus: 'scan-step' }), [{ type: 'pause', kind: 'auth' }, { type: 'notify', notice: 'auth' }]],
        [at('handoff', { pauseReason: 'email-code', resumeStatus: 'fill-step' }),
          [{ type: 'pause', kind: 'handoff' }, { type: 'notify', notice: 'auth' }]],
      ];
      for (const [state, shown] of cases) {
        expect(reduceRun({ ...state, updatedAt: T0 }, load, later(1000)))
          .toEqual({ state: { ...state, updatedAt: T0 }, effects: [{ type: 'report' }, ...shown] });
      }
    });

    it('by the person: the step scanned again however old (within the day), a pause ended, and (v4, D6) a run stored at the old policy card too', () => {
      const old = later(RUN_STATE_TTL_MS - 1);
      expect(reduceRun(at('wait-transition', { updatedAt: T0 }), person, old).state.status).toBe('scan-step');
      expect(reduceRun(at('handoff', { updatedAt: T0, pauseReason: 'captcha', resumeStatus: 'fill-step' }), person, old)
        .state).toMatchObject({ status: 'scan-step', pauseReason: null, resumeStatus: null });
      const card = at('policy-notice', { updatedAt: T0 });
      expect(reduceRun(card, person, old).state.status).toBe('scan-step');
    });

    it('never in another tab, never once expired', () => {
      const state = at('fill-step', { updatedAt: T0 });
      expect(reduceRun(state, { type: 'RESUMED', by: 'load', sameTab: false }, later(1))).toEqual({ state, effects: [] });
      expect(reduceRun(state, { type: 'RESUMED', by: 'person', sameTab: false }, later(1))).toEqual({ state, effects: [] });
      expect(reduceRun(state, person, later(RUN_STATE_TTL_MS))).toEqual({ state, effects: [] });
    });
  });
});

describe('resumeMode', () => {
  const state = (patch: Partial<RunState> = {}) => at('fill-step', { updatedAt: T0, ...patch });

  it('resumes by itself in the same tab within RESUME_AUTO_MS (30 minutes) of the last update', () => {
    expect(RESUME_AUTO_MS).toBe(30 * 60 * 1000);
    expect(resumeMode(state(), { now: T0, sameTab: true })).toBe('auto');
    expect(resumeMode(state(), { now: T0 + RESUME_AUTO_MS, sameTab: true })).toBe('auto');
    // A worker clock a little ahead of the page's is no reason to wait.
    expect(resumeMode(state(), { now: T0 - 5000, sameTab: true })).toBe('auto');
  });

  it('asks for Continue later than that, and for a paused run or one at review at any age', () => {
    expect(resumeMode(state(), { now: T0 + RESUME_AUTO_MS + 1, sameTab: true })).toBe('continue');
    expect(resumeMode(state(), { now: T0 + RUN_STATE_TTL_MS - 1, sameTab: true })).toBe('continue');
    for (const status of ['auth-needed', 'handoff', 'policy-notice', 'review'] as const) {
      expect(resumeMode(state({ status }), { now: T0 + 1, sameTab: true })).toBe('continue');
    }
  });

  it('never in another tab, never once expired (24 hours after the last update), never a finished run', () => {
    expect(resumeMode(null, { now: T0, sameTab: true })).toBe('none');
    expect(resumeMode(state(), { now: T0, sameTab: false })).toBe('none');
    expect(resumeMode(state(), { now: T0 + RUN_STATE_TTL_MS, sameTab: true })).toBe('none');
    expect(resumeMode(state({ status: 'done' }), { now: T0, sameTab: true })).toBe('none');
    expect(resumeMode(state({ status: 'stopped' }), { now: T0, sameTab: true })).toBe('none');
  });
});

describe('auto-advance', () => {
  const ok = { errors: 0, step: facts() };
  const ready = at('validate', { lastFill: CLEAN });

  it('presses Next only when every rule holds', () => {
    expect(autoAdvanceVerdict(ready, ok, { autoAdvance: true })).toEqual({ advance: true });
  });

  it.each([
    ['setting-off', ready, ok, false],
    ['final', ready, { ...ok, step: facts({ finality: 'final' }) }, true],
    ['final-unknown', ready, { ...ok, step: facts({ finality: 'unknown' }) }, true],
    ['no-next', ready, { ...ok, step: facts({ nextVisible: false }) }, true],
    ['errors', ready, { ...ok, errors: 1 }, true],
    ['not-filled', at('validate', { lastFill: null }), ok, true],
    ['flagged', at('validate', { lastFill: { ...CLEAN, flagged: 1 } }), ok, true],
    ['blocked', at('validate', { lastFill: { ...CLEAN, blocked: 1 } }), ok, true],
    ['unresolved', at('validate', { lastFill: { ...CLEAN, unresolved: 1 } }), ok, true],
    ['unconfirmed-draft', ready, { ...ok, step: facts({ unconfirmedDrafts: 1 }) }, true],
    ['captcha-unsolved', ready, { ...ok, step: facts({ captchaUnsolved: true }) }, true],
    ['not-settled', ready, { ...ok, step: facts({ settled: false }) }, true],
    ['attempts', at('validate', { lastFill: CLEAN }, MAX_STEP_ATTEMPTS), ok, true],
    // core-x, item 2: the form's account section still has a required box empty.
    ['account-left', ready, { ...ok, step: facts({ accountLeft: 2 }) }, true],
  ] as const)('refuses with %s', (refusal, state, check, autoAdvance) => {
    expect(autoAdvanceVerdict(state, check, { autoAdvance })).toEqual({ advance: false, refusal });
    // The reducer never presses Next when the verdict refuses.
    const effects = reduceRun(state, { type: 'VALIDATED', errors: check.errors, fixable: 0, step: check.step },
      { autoAdvance, now: T0 + 1 }).effects;
    expect(types(effects)).not.toContain('press-next');
  });

  it('lists every refusal it can give', () => {
    expect([...ADVANCE_REFUSALS]).toEqual(['setting-off', 'final', 'final-unknown', 'no-next', 'errors', 'not-filled',
      'account-left', 'flagged', 'blocked', 'unresolved', 'unconfirmed-draft', 'captcha-unsolved', 'not-settled',
      'attempts']);
  });

  // core-x, item 2: an account section with a required box empty holds Next (a required field left empty), and an
  // empty count (or none) holds nothing. v4 (D9): silently, its notice gone.
  it('holds Next for an account section with a required box empty, silently (v4)', () => {
    const held = reduceRun(ready, { type: 'VALIDATED', errors: 0, fixable: 0, step: facts({ accountLeft: 1 }) },
      { autoAdvance: true, now: T0 + 1 });
    expect(types(held.effects)).not.toContain('press-next');
    expect(types(held.effects)).not.toContain('notify');
    expect(STEP_NOTICES).toContain('account-left');
    expect(autoAdvanceVerdict(ready, { errors: 0, step: facts({ accountLeft: 0 }) }, { autoAdvance: true }))
      .toEqual({ advance: true });
    // Before the rows: a step that also left fields for the person says why the account section holds Next.
    expect(autoAdvanceVerdict(at('validate', { lastFill: { ...CLEAN, flagged: 2 } }),
      { errors: 0, step: facts({ accountLeft: 1 }) }, { autoAdvance: true })).toEqual({ advance: false, refusal: 'account-left' });
  });
});

describe('runs end to end', () => {
  /** A step filled clean and validated with these facts. */
  const step = (signature: string, finality: StepFacts['finality']): RunEvent[] =>
    [scanned(signature), filled(), validated(0, 0, { finality })];

  it('auto-advance off: every step waits for the person\'s own Next, and nothing is ever pressed', () => {
    const { state, effects } = drive(reduceRun(fresh(), { type: 'DETECTED' }, OFF).state, [
      ...step(S1, 'not-final'), { type: 'TRANSITIONED', signature: S2 },
      ...step(S2, 'not-final'), { type: 'TRANSITIONED', signature: S3 },
      ...step(S3, 'not-final'), { type: 'TRANSITIONED', signature: S4 },
      ...step(S4, 'final'), { type: 'SUBMITTED' },
    ], OFF);
    const all = effects.flat();
    expect(types(all)).not.toContain('press-next');
    expect(all.filter((effect) => effect.type === 'await-transition'))
      .toEqual([S1, S2, S3].map((from) => ({ type: 'await-transition', from, capMs: null })));
    expect(state).toMatchObject({ status: 'done', stepIndex: 3, stepAttempts: { [S1]: 1, [S2]: 1, [S3]: 1, [S4]: 1 } });
  });

  it('auto-advance on: Next pressed on the steps declared not final only, the review step never advanced', () => {
    const { state, effects } = drive(reduceRun(fresh(), { type: 'DETECTED' }, ON).state, [
      ...step(S1, 'not-final'), { type: 'ADVANCED', by: 'extension' }, { type: 'TRANSITIONED', signature: S2 },
      ...step(S2, 'not-final'), { type: 'ADVANCED', by: 'extension' }, { type: 'TRANSITIONED', signature: S3 },
      ...step(S3, 'not-final'), { type: 'ADVANCED', by: 'extension' }, { type: 'TRANSITIONED', signature: S4 },
      ...step(S4, 'final'),
    ], ON);
    const presses = effects.map((list, at) => (list.some((effect) => effect.type === 'press-next') ? at : -1))
      .filter((at) => at >= 0);
    expect(presses).toHaveLength(3);
    expect(state.status).toBe('review');
    expect(effects.at(-1)).toContainEqual({ type: 'show-review', cause: 'final-step', reason: null });
  });

  it('across reloads: the first visit is attempt 1, a reload attempt 2, and the next reload stops at the limit', () => {
    const reload: RunEvent = { type: 'RESUMED', by: 'load', sameTab: true };
    const first = drive(reduceRun(fresh(), { type: 'DETECTED' }, OFF).state, [...step(S2, 'not-final')], OFF);
    expect(first.state.stepAttempts[S2]).toBe(1);
    const second = drive(first.state, [reload, ...step(S2, 'not-final')], OFF);
    expect(second.state.stepAttempts[S2]).toBe(2);
    expect(second.effects[1]).toContainEqual({ type: 'fill-step', attempt: 2, fix: false });
    const third = drive(second.state, [reload, scanned(S2)], OFF);
    expect(third.state).toMatchObject({ status: 'review', stepAttempts: { [S2]: 2 } });
    expect(types(third.effects.flat())).not.toContain('fill-step');
    expect(third.effects[1]).toContainEqual({ type: 'show-review', cause: 'step-retry-limit', reason: null });
  });

  it('auto-advance needs fewer than two attempts: a reloaded step is left for the person\'s Next', () => {
    const once = drive(reduceRun(fresh(), { type: 'DETECTED' }, ON).state, [scanned(S1)], ON).state;
    const reloaded = drive(once, [{ type: 'RESUMED', by: 'load', sameTab: true }, ...step(S1, 'not-final')], ON);
    expect(reloaded.state.status).toBe('wait-transition');
    expect(types(reloaded.effects.flat())).not.toContain('press-next');
  });

  it('v4 (D7): an ignored auto-advance click rests for the person\'s own Next, never a hand-off; their Next moves it on', () => {
    const { state } = drive(reduceRun(fresh(), { type: 'DETECTED' }, ON).state, [
      ...step(S1, 'not-final'), { type: 'ADVANCED', by: 'extension' }, { type: 'TIMED_OUT', signature: S1 },
      validated(),
    ], ON);
    // Validated again with its lastFill cleared: Next is never pressed again by itself.
    expect(state).toMatchObject({ status: 'wait-transition', pauseReason: null, lastFill: null });
    // They pressed Next themselves: the new step is counted and filled.
    const after = drive(state, [{ type: 'TRANSITIONED', signature: S2 }, scanned(S2)], ON).state;
    expect(after).toMatchObject({ status: 'fill-step', stepIndex: 1, stepSignature: S2 });
  });
});

describe('RunState holds no value', () => {
  /** Profile strings that must never reach RunState: names, contact, the company, a school. */
  const SENTINELS = ['alex', 'rivera', 'alex.rivera@example.com', '5125550123', 'initech', 'austin'];

  it('after a whole run, its JSON holds none of the profile\'s strings, only keys, hashes, counts and the page\'s canaries', () => {
    const echoing = ['workday|my-information|preferred-name-if-not-alex-rivera|none|0',
      'workday|my-experience[0]|company-initech-or-other|none|0',
      'workday|my-information-alex-rivera|email|none|0'];
    const { state } = drive(reduceRun(fresh(), { type: 'DETECTED' }, ON).state, [
      scanned(S1, { tripwireHits: 1, canaries: ['I am LLM'] }),
      { type: 'REPEATABLE', kind: 'experience', counter: { profile: 2, rendered: 1, addClicks: 1 } },
      filled({}, echoing), validated(), { type: 'ADVANCED', by: 'extension' }, { type: 'TRANSITIONED', signature: S2 },
      scanned(S2), filled({ flagged: 1 }, echoing), validated(1, 1), filled(), validated(),
    ], ON);
    const json = JSON.stringify(state).toLowerCase();
    for (const sentinel of SENTINELS) expect(json).not.toContain(sentinel);
    expect(state.canarySet).toEqual(['I am LLM']);
    for (const keys of Object.values(state.filledFieldKeys)) {
      for (const key of keys) expect(key).toMatch(/^workday\|[a-f0-9]{16}\|[a-f0-9]{16}\|none\|0$/);
    }
  });

  it('storedFieldKey hashes the section and label slug and keeps the platform, option-set hash and ordinal', () => {
    const key = 'lever|education[1]|school|0123456789abcdef|2' as FieldKey;
    const stored = storedFieldKey(key);
    expect(stored).toMatch(/^lever\|[a-f0-9]{16}\|[a-f0-9]{16}\|0123456789abcdef\|2$/);
    expect(storedFieldKey(key)).toBe(stored);
    expect(storedFieldKey('odd key' as FieldKey)).toMatch(/^[a-f0-9]{16}$/);
  });

  it('every transition keeps exactly RunState\'s fields, its invariants and its caps (a seeded walk)', () => {
    const keys = Object.keys(fresh()).sort();
    const events: RunEvent[] = [{ type: 'DETECTED' }, { type: 'NOT_AN_APPLICATION' }, { type: 'AUTH', wall: 'sign-in' },
      { type: 'PAUSE', reason: 'captcha' }, { type: 'PAUSE', reason: 'page-busy' }, { type: 'CONTINUE' },
      scanned(S1), scanned(S2, { policyHits: 1, tripwireHits: 1, canaries: ['a canary text'] }), scanned(S3),
      { type: 'NEXT_WITHHELD', reason: 'not-pressable' },
      { type: 'NEXT_WITHHELD', reason: 'setting-off' }, { type: 'NEXT_WITHHELD', reason: 'captcha-unsolved' },
      validated(0, 0, { captchaUnsolved: true }),
      filled({}, ['workday|s|a|none|0']), filled({ flagged: 1 }),
      validated(), validated(1, 1), validated(1, 0), validated(0, 0, { finality: 'final' }),
      validated(0, 0, { finality: 'unknown' }), { type: 'ADVANCED', by: 'extension' }, { type: 'ADVANCED', by: 'person' },
      { type: 'TRANSITIONED', signature: S2 }, { type: 'TRANSITIONED', signature: S4 }, { type: 'STEP_UNCHANGED' },
      { type: 'TIMED_OUT', signature: S1 }, { type: 'TIMED_OUT', signature: S3 }, { type: 'RESUMED', by: 'load', sameTab: true },
      { type: 'RESUMED', by: 'person', sameTab: true },
      { type: 'REPEATABLE', kind: 'language', counter: { profile: 1, rendered: 0, addClicks: 1 } },
      { type: 'ERROR', reason: 'internal-error' }, { type: 'SUBMITTED' }, { type: 'USER_STOPPED' }];
    let seed = 7;
    const next = () => {
      // A 32-bit linear congruential generator, exact in integers; its high bits are the random ones.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    const visited = new Set<RunStatus>();
    let pressed = 0;
    for (let walk = 0; walk < 200; walk += 1) {
      let state = fresh();
      let previous: RunEffect[] = [];
      for (let step = 0; step < 60; step += 1) {
        // Done and stopped take nothing, so a walk that ends there starts again.
        if (state.status === 'done' || state.status === 'stopped') state = fresh();
        const ctx = { autoAdvance: next() % 2 === 0, now: T0 + step * 1000 };
        // Mostly an event the status takes, so the walk gets past the first steps; sometimes one it ignores.
        let event = events[next() % events.length]!;
        let result = reduceRun(state, event, ctx);
        for (let tries = 0; tries < 8 && result.effects.length === 0; tries += 1) {
          event = events[next() % events.length]!;
          result = reduceRun(state, event, ctx);
        }
        if (result.effects.some((effect) => effect.type === 'press-next')) {
          pressed += 1;
          // Next is pressed only from validation, on a step declared not final, with auto-advance on.
          expect(event.type).toBe('VALIDATED');
          expect(ctx.autoAdvance).toBe(true);
          expect(event.type === 'VALIDATED' && event.step.finality).toBe('not-final');
        }
        state = result.state;
        previous = result.effects;
        visited.add(state.status);
        expect(Object.keys(state).sort()).toEqual(keys);
        expect(state.pauseReason !== null).toBe(state.status === 'handoff');
        if (state.status !== 'handoff' && state.status !== 'auth-needed') expect(state.resumeStatus).toBeNull();
        expect(Object.values(state.stepAttempts).every((count) => count >= 1 && count <= MAX_STEP_ATTEMPTS)).toBe(true);
        expect(Object.keys(state.stepAttempts).length).toBeLessThanOrEqual(MAX_STEPS);
        expect(Object.keys(state.filledFieldKeys).every((signature) => signature in state.stepAttempts)).toBe(true);
        expect(state.canarySet.length).toBeLessThanOrEqual(32);
        if (state.stepSignature !== null) expect(state.stepSignature).toMatch(/^[a-f0-9]{16}$/);
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
        if (previous.length > 0 && previous[0]!.type !== 'report') expect(previous[0]).toEqual({ type: 'persist' });
      }
    }
    // The walk went everywhere (but the old policy card: v4, D6, no transition leads there), and pressed Next sometimes.
    expect([...visited].sort()).toEqual(RUN_STATUSES.filter((status) => status !== 'policy-notice').sort());
    expect(pressed).toBeGreaterThan(0);
  });
});

describe('the Phase 5 review', () => {
  /** A step filled clean and validated with these facts. */
  const step = (signature: string, finality: StepFacts['finality'] = 'not-final'): RunEvent[] =>
    [scanned(signature), filled(), validated(0, 0, { finality })];

  it('C-S4, v4 (D6): a run reloaded at the old policy card scans the step first (tripwire, canaries), then fills', () => {
    // A RunState a version before v4 stored at the card: the new document resumes it, and the scan comes before any
    // write; the scan's statement no longer stops anything.
    const card = at('policy-notice', { stepSignature: S1, stepAttempts: {} }, 0);
    const resumed = reduceRun(card, { type: 'RESUMED', by: 'load', sameTab: true }, OFF);
    expect(resumed.state).toMatchObject({ status: 'scan-step', stepAttempts: {} });
    expect(types(resumed.effects)).toEqual(['persist', 'report', 'scan']);
    const scannedAgain = reduceRun(resumed.state, scanned(S1, { policyHits: 1, tripwireHits: 1, canaries: ['Austin'] }),
      OFF);
    expect(scannedAgain.state).toMatchObject({ status: 'fill-step', canarySet: ['Austin'], stepAttempts: { [S1]: 1 } });
    expect(scannedAgain.effects).toContainEqual({ type: 'notify', notice: 'tripwire' });
  });

  it('X-S2: a validation after the person\'s Next never presses Next; the step must be filled again first', () => {
    // The person pressed Next on a clean step and the page, slow, still shows it: validate again, with auto-advance on.
    const waiting = at('wait-transition', { lastFill: CLEAN });
    const unchanged = reduceRun(waiting, { type: 'STEP_UNCHANGED' }, ON);
    expect(unchanged.state).toMatchObject({ status: 'validate', lastFill: null });
    const judged = reduceRun(unchanged.state, validated(), ON);
    expect(types(judged.effects)).not.toContain('press-next');
    expect(judged.state.status).toBe('wait-transition');
    expect(judged.effects.slice(-1)).toEqual([{ type: 'await-transition', from: S1, capMs: null }]);
    expect(autoAdvanceVerdict(unchanged.state, { errors: 0, step: facts() }, ON))
      .toEqual({ advance: false, refusal: 'not-filled' });
  });

  it('C-S2: NEXT_WITHHELD (auto-advance turned off before the click) leaves Next to the person, with no timer', () => {
    const { state, effects } = reduceRun(at('advance', { lastFill: CLEAN }), { type: 'NEXT_WITHHELD', reason: 'setting-off' },
      OFF);
    expect(state.status).toBe('wait-transition');
    expect(effects).toEqual([{ type: 'persist' }, { type: 'report' },
      { type: 'await-transition', from: S1, capMs: null }]);
    for (const status of ['validate', 'wait-transition', 'review', 'fill-step', 'handoff'] as const) {
      const other = at(status);
      expect(reduceRun(other, { type: 'NEXT_WITHHELD', reason: 'setting-off' }, ON)).toEqual({ state: other, effects: [] });
    }
  });

  it('C-S8: a step\'s index is its place among the steps seen, so Back and forth never counts a step twice', () => {
    let { state } = drive(reduceRun(fresh(), { type: 'DETECTED' }, OFF).state, [...step(S1),
      { type: 'TRANSITIONED', signature: S2 }, ...step(S2), { type: 'TRANSITIONED', signature: S1 }, scanned(S1)], OFF);
    expect(state).toMatchObject({ stepSignature: S1, stepIndex: 0 });
    ({ state } = drive(state, [filled(), validated(), { type: 'TRANSITIONED', signature: S2 }, scanned(S2)], OFF));
    expect(state).toMatchObject({ stepSignature: S2, stepIndex: 1 });
    ({ state } = drive(state, [filled(), validated(), { type: 'TRANSITIONED', signature: S3 }, scanned(S3)], OFF));
    expect(state).toMatchObject({ stepSignature: S3, stepIndex: 2 });
    // However often the person goes back and forth, max-steps counts distinct steps only.
    const notices: RunEffect[] = [];
    for (let flip = 0; flip < 2 * MAX_STEPS; flip += 1) {
      const next = drive(state, [{ type: 'TRANSITIONED', signature: flip % 2 === 0 ? S1 : S3 },
        scanned(flip % 2 === 0 ? S1 : S3)], OFF);
      state = next.state.status === 'review' ? next.state : drive(next.state, [filled(), validated()], OFF).state;
      notices.push(...next.effects.flat().filter((effect) => effect.type === 'notify'));
      expect(state.stepIndex).toBeLessThanOrEqual(2);
    }
    expect(notices).not.toContainEqual({ type: 'notify', notice: 'max-steps' });
    expect(Object.keys(state.stepAttempts)).toEqual([S1, S2, S3]);
  });

  it('X-S5: at review, a step change to a step already at its limit is ignored: nothing counted, stored or reported', () => {
    const limited = at('review', { stepAttempts: { [S1]: MAX_STEP_ATTEMPTS, [S2]: MAX_STEP_ATTEMPTS }, lastFill: CLEAN },
      MAX_STEP_ATTEMPTS);
    const state = { ...limited, stepAttempts: { [S1]: MAX_STEP_ATTEMPTS, [S2]: MAX_STEP_ATTEMPTS } };
    expect(reduceRun(state, { type: 'TRANSITIONED', signature: S2 }, OFF)).toEqual({ state, effects: [] });
    // So is one past the step guard.
    const many = Object.fromEntries(Array.from({ length: MAX_STEPS }, (_, n) =>
      [stepSignature({ heading: `Page ${n}`, anchors: [] }), MAX_STEP_ATTEMPTS]));
    const full = { ...state, stepAttempts: many, stepSignature: Object.keys(many)[0]! };
    expect(reduceRun(full, { type: 'TRANSITIONED', signature: S3 }, OFF)).toEqual({ state: full, effects: [] });
    // A step with an attempt left is still followed; and from any other status the limited step is scanned (to review).
    expect(reduceRun(state, { type: 'TRANSITIONED', signature: S3 }, OFF).state.status).toBe('scan-step');
    expect(reduceRun({ ...state, status: 'wait-transition' }, { type: 'TRANSITIONED', signature: S2 }, OFF).state.status)
      .toBe('scan-step');
    expect(MAX_IDLE_TRANSITIONS).toBeGreaterThan(0);
  });

  it('X-S4, tightened: Next is never pressed on a step whose CAPTCHA is not known solved', () => {
    // At validation: the person's Next, with the notice that says so.
    const ready = at('validate', { lastFill: CLEAN });
    const judged = reduceRun(ready, validated(0, 0, { captchaUnsolved: true }), ON);
    expect(types(judged.effects)).not.toContain('press-next');
    expect(judged.state.status).toBe('wait-transition');
    expect(judged.effects.slice(2)).toEqual([{ type: 'notify', notice: 'captcha-next' },
      { type: 'await-transition', from: S1, capMs: null }]);
    // With auto-advance off nothing would be pressed anyway: no notice.
    expect(reduceRun(ready, validated(0, 0, { captchaUnsolved: true }), OFF).effects)
      .not.toContainEqual({ type: 'notify', notice: 'captcha-next' });
    // Right before the click: the same.
    const withheld = reduceRun(at('advance', { lastFill: CLEAN }), { type: 'NEXT_WITHHELD', reason: 'captcha-unsolved' },
      ON);
    expect(withheld.state.status).toBe('wait-transition');
    expect(withheld.effects.slice(2)).toEqual([{ type: 'notify', notice: 'captcha-next' },
      { type: 'await-transition', from: S1, capMs: null }]);
    expect(STEP_NOTICES).toContain('captcha-next');
  });
});

describe('Submit mode Auto (v3 Phase 4)', () => {
  const RULES = { requiredEmpty: true, noAi: true, legalGuess: false };
  /** Every skip rule off. */
  const lenient0 = () => ({ ...OFF, autoSubmit: { requiredEmpty: false, noAi: false, legalGuess: false } });
  const AUTO: RunContext = { ...OFF, autoSubmit: RULES };
  const finalStep = (patch: Partial<StepFacts> = {}) => facts({ finality: 'final', nextVisible: false, submitVisible: true,
    requiredEmpty: 0, noAi: false, legalGuess: false, ...patch });
  const validatedState = at('validate', { lastFill: CLEAN });

  it('presses Submit after the review only on a clean final step, with Submit on Auto', () => {
    const step = reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep() }, AUTO);
    expect(step.state.status).toBe('review');
    expect(types(step.effects)).toEqual(['persist', 'report', 'show-review', 'press-submit']);
    // Manual (the default): the review, and the person submits.
    expect(types(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep() }, OFF).effects))
      .toEqual(['persist', 'report', 'show-review']);
    // A dry run's context carries no Auto, and a step not final is never submitted (auto-advance's, or the person's).
    for (const finality of ['not-final', 'unknown'] as const) {
      const effects = reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0,
        step: finalStep({ finality }) }, { ...AUTO, autoAdvance: true }).effects;
      expect(types(effects)).not.toContain('press-submit');
    }
  });

  it('holds the Submit back for the skip rules and the step’s state, saying why', () => {
    const cases: Array<[Partial<StepFacts>, string]> = [
      [{ requiredEmpty: 2 }, 'submit-held-required'],
      [{ noAi: true }, 'submit-held-no-ai'],
      [{ captchaUnsolved: true }, 'submit-held-captcha'],
      [{ unconfirmedDrafts: 1 }, 'submit-held-check'],
      [{ settled: false }, 'submit-held-check'],
      [{ submitVisible: false }, 'submit-held-check'],
    ];
    for (const [patch, notice] of cases) {
      const step = reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep(patch) }, AUTO);
      expect(types(step.effects)).not.toContain('press-submit');
      expect(step.effects).toContainEqual(patch.requiredEmpty === 2 ? { type: 'notify', notice, count: 2 }
        : { type: 'notify', notice });
      expect(step.state.status).toBe('review');
    }
    // A legal answer the AI guessed holds it back only with that rule on (off by default).
    expect(types(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep({ legalGuess: true }) },
      AUTO).effects)).toContain('press-submit');
    const strict = { ...OFF, autoSubmit: { ...RULES, legalGuess: true } };
    expect(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep({ legalGuess: true }) },
      strict).effects).toContainEqual({ type: 'notify', notice: 'submit-held-guess' });
    // An attention check only the person can answer always holds it back, whatever the rules (the Phase 7a review); v4
    // (D1): entries the run could not add hold nothing, the run decided what it could.
    for (const rules of [AUTO, lenient0()]) {
      expect(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep({ attentionLeft: true }) },
        rules).effects).toContainEqual({ type: 'notify', notice: 'submit-held-attention' });
      expect(types(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0,
        step: finalStep({ entriesLeft: 1 }) }, rules).effects)).toContain('press-submit');
    }
    // With the empty-field rule off, required fields left empty do not hold it back.
    const lenient = { ...OFF, autoSubmit: { ...RULES, requiredEmpty: false } };
    expect(types(reduceRun(validatedState, { type: 'VALIDATED', errors: 0, fixable: 0, step: finalStep({ requiredEmpty: 3 }) },
      lenient).effects)).toContain('press-submit');
  });

  it('reads its rules in order, the first that fails being the refusal', () => {
    const state = at('validate', { lastFill: CLEAN });
    expect(autoSubmitVerdict(state, { errors: 0, step: finalStep() }, { autoSubmit: null }))
      .toEqual({ submit: false, refusal: 'setting-off' });
    expect(autoSubmitVerdict(state, { errors: 1, step: finalStep() }, AUTO)).toEqual({ submit: false, refusal: 'errors' });
    expect(autoSubmitVerdict(at('validate', { lastFill: null }), { errors: 0, step: finalStep() }, AUTO))
      .toEqual({ submit: false, refusal: 'not-filled' });
    expect(autoSubmitVerdict(state, { errors: 0, step: finalStep({ requiredEmpty: 1, captchaUnsolved: true }) }, AUTO))
      .toEqual({ submit: false, refusal: 'required-empty' });
    expect(autoSubmitVerdict(state, { errors: 0, step: finalStep() }, AUTO)).toEqual({ submit: true });
    expect(SUBMIT_REFUSALS[0]).toBe('setting-off');
    for (const notice of ['submit-held-required', 'submit-held-no-ai', 'submit-held-guess', 'submit-held-captcha',
      'submit-held-check', 'submit-held-attention', 'submit-held-entries'] as const) {
      expect(STEP_NOTICES).toContain(notice);
      expect(NOTICE_CODES).toContain(notice);
    }
  });

  it('is done once the platform’s confirmation is seen after the Submit (SUBMITTED), from review', () => {
    expect(reduceRun(at('review'), { type: 'SUBMITTED' }, OFF).state.status).toBe('done');
  });
});
