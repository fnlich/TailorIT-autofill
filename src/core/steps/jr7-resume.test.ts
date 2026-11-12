/*
 * jr7 ENGINE-7 E2 item 2 (FIX7PLAN §6.2, ADP7-7): a run paused at an email code or a sign-in wall resumes by itself when
 * the same application's next document, in the same tab, shows a form within RESUME_AUTO_MS (ADP: the code, then the
 * Personal Information form at a new document). Nothing else resumes so: another pause, a pause handed off from review,
 * another application's form, no form, an older run, or Autofill after page turn set to Manually.
 */
import { describe, expect, it } from 'vitest';
import { RESUME_AUTO_MS, type RunState, type RunStatus } from '../types/run';
import { createRunState, reduceRun, resumeMode, type RunContext, type RunEvent } from './machine';

const T0 = 1_800_000_000_000;
const APP = 'adp:0123456789abcdef';
const OTHER = 'adp:fedcba9876543210';

function at(status: RunStatus, patch: Partial<RunState> = {}): RunState {
  return { ...createRunState({ applicationKey: APP, platform: 'adp', now: T0 }), status, stepSignature: 'a1b2c3d4e5f60718',
    stepAttempts: { a1b2c3d4e5f60718: 1 }, resumeStatus: 'fill-step', ...patch };
}
const code = (patch: Partial<RunState> = {}) => at('handoff', { pauseReason: 'email-code', ...patch });
const signIn = (patch: Partial<RunState> = {}) => at('auth-needed', { pauseReason: null, ...patch });
const load = (formOf?: string): RunEvent => ({ type: 'RESUMED', by: 'load', sameTab: true,
  ...(formOf === undefined ? {} : { formOf }) });
const ctx = (patch: Partial<RunContext> = {}): RunContext => ({ autoAdvance: false, now: T0 + 1000, ...patch });

describe('jr7 ENGINE-7 E2 item 2 (ADP7-7): past an email code or a sign-in wall', () => {
  it('resumeMode answers auto for the application\'s form shown in the same tab within RESUME_AUTO_MS', () => {
    for (const state of [code(), signIn()]) {
      expect(resumeMode(state, { now: T0 + 1000, sameTab: true, formOf: APP })).toBe('auto');
      expect(resumeMode(state, { now: T0 + RESUME_AUTO_MS, sameTab: true, formOf: APP })).toBe('auto');
    }
  });

  it('and continue otherwise: no form, another application, later, another pause, from review, or another tab', () => {
    expect(resumeMode(code(), { now: T0 + 1000, sameTab: true })).toBe('continue');
    expect(resumeMode(code(), { now: T0 + 1000, sameTab: true, formOf: OTHER })).toBe('continue');
    expect(resumeMode(code(), { now: T0 + RESUME_AUTO_MS + 1, sameTab: true, formOf: APP })).toBe('continue');
    for (const reason of ['captcha', 'bot-check', 'entry-choice', 'page-busy', 'needs-click', 'forgot-password'] as const) {
      expect(resumeMode(code({ pauseReason: reason }), { now: T0 + 1000, sameTab: true, formOf: APP }), reason)
        .toBe('continue');
    }
    expect(resumeMode(code({ resumeStatus: 'review' }), { now: T0 + 1000, sameTab: true, formOf: APP })).toBe('continue');
    expect(resumeMode(at('policy-notice'), { now: T0 + 1000, sameTab: true, formOf: APP })).toBe('continue');
    expect(resumeMode(code(), { now: T0 + 1000, sameTab: false, formOf: APP })).toBe('none');
  });

  it('RESUMED by the load with the form scans the step: the pause is left, its attempts kept', () => {
    for (const state of [code(), signIn()]) {
      const { state: next, effects } = reduceRun(state, load(APP), ctx());
      expect(next).toMatchObject({ status: 'scan-step', pauseReason: null, resumeStatus: null,
        stepAttempts: state.stepAttempts });
      expect(effects.map((effect) => effect.type)).toEqual(['persist', 'report', 'scan']);
    }
  });

  it('shows the pause again without the form, for another application, from review, later, or after page turn Manually',
    () => {
      const cases: Array<[RunState, RunEvent, RunContext]> = [
        [code(), load(), ctx()],
        [code(), load(OTHER), ctx()],
        [code({ resumeStatus: 'review' }), load(APP), ctx()],
        [code(), load(APP), ctx({ now: T0 + RESUME_AUTO_MS + 1 })],
        [code(), load(APP), ctx({ fillAfterPageTurn: false })],
        [code({ pauseReason: 'captcha' }), load(APP), ctx()],
        [signIn(), load(), ctx()],
      ];
      for (const [state, event, context] of cases) {
        const { state: next, effects } = reduceRun(state, event, context);
        expect(next.status).toBe(state.status);
        expect(effects.map((effect) => effect.type)).toContain('pause');
      }
    });
});
