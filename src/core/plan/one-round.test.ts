/*
 * v5 p2-stream (one round; the coordinator's follow-up): a question nothing classified, which the AI would answer once
 * classified unknown, asks its category and its answer in one task (PlanInput.oneRound: AnswerItem.classify) instead
 * of a classification first. The category, once in, decides as before: a category the profile fills takes the
 * profile's value, never the AI's answer; a sensitive, self-identification, legal or consent category is the person's
 * (the answer dropped); a legal question the `all` scope opens is asked again under that scope; unknown takes the
 * answer. Where the answer would not be used (AI answers off, a dry run, oneRound absent), a classification first, as
 * before.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../text/sha256';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { ClassifyVerdict } from '../resolver/classify';
import type { AnswerVerdict } from './answers';
import { fieldOf, goldenProfile, planOf, settingsWith, specOf } from './plan.testkit';
import type { PlanAi } from './types';

const TASK = 'c3e5a7b9-2d4f-4b6c-8e0a-1f3b5d7e9a20';
/** An unknown question no rule classifies, on a radio group. */
const KUBERNETES = specOf('Do you have hands-on experience running Kubernetes in production?', 'radio',
  { optionLabels: ['Yes', 'No', 'Some'] });
/** A text box no rule classifies, which the classifier would name the person's current employer. */
const WHERE = specOf('Where do you spend your working days at the moment?', 'text');
const NO_ANSWERS = settingsWith({ llm: { ...DEFAULT_SETTINGS.llm, answers: false } });

const ai = (classification: ClassifyVerdict | null, answer: AnswerVerdict): PlanAi => ({ verdicts: new Map(),
  classifications: new Map(classification === null ? [] : [[classification.key as string, classification]]),
  answers: new Map([[answer.key as string, answer]]) });
const chose = (key: string, scope: 'standard' | 'all' = 'standard'): AnswerVerdict => ({ key: key as never,
  kind: 'choice', optionSetHash: KUBERNETES.optionSetHash as string, index: 0,
  labelHash: sha256Hex('Yes'), basis: 'guess', taskId: TASK, oneRound: scope });
const said = (key: string, text: string): AnswerVerdict => ({ key: key as never, kind: 'text', text, basis: 'guess',
  taskId: TASK, oneRound: 'standard' });

describe('one round: a question nothing classified (v5 p2-stream)', () => {
  it('asks its category with its answer, on its platform, and no classification', () => {
    const out = planOf([KUBERNETES], { oneRound: true });
    expect(out.ask?.classify).toEqual([]);
    expect(out.ask?.answers).toEqual([expect.objectContaining({ key: KUBERNETES.key, scope: 'standard',
      shape: 'choice', classify: true, platform: KUBERNETES.platform })]);
    expect(out.awaiting).toEqual([KUBERNETES.key]);
    expect(out.writes).toEqual([]);
  });

  it('classifies first, as before, where the answer would not be used: AI answers off, a dry run, oneRound absent', () => {
    for (const [name, extra] of [['answers off', { oneRound: true, settings: NO_ANSWERS }],
      ['a dry run', { oneRound: true, dryRun: true }], ['oneRound absent', {}]] as const) {
      const out = planOf([KUBERNETES], extra);
      expect(out.ask?.classify?.map((item) => item.key), name).toEqual([KUBERNETES.key]);
      expect(out.ask?.answers ?? [], name).toEqual([]);
    }
  });

  it('classifies first, as before, a field the answer step would not ask (a list of one option)', () => {
    const badge = specOf('Which colour badge would you like?', 'select', { optionLabels: ['Blue'] });
    const out = planOf([badge], { oneRound: true });
    expect(out.ask?.classify?.map((item) => item.key)).toEqual([badge.key]);
    expect(out.ask?.answers ?? []).toEqual([]);
  });

  it('takes the answer when the category came back unknown', () => {
    const out = planOf([KUBERNETES], { oneRound: true, ai: ai({ key: KUBERNETES.key, category: null,
      why: 'unknown-field' }, chose(KUBERNETES.key)) });
    expect(out.awaiting).toEqual([]);
    expect(fieldOf(out, KUBERNETES).write).toMatchObject({ value: { kind: 'option', index: 0 },
      origin: { provenance: 'llm-pick' } });
  });

  it('takes the profile’s value, never the AI’s answer, for a category the profile fills', () => {
    const profile = goldenProfile();
    const employer = profile.experience.find((entry) => entry.current)?.company ?? profile.experience[0]!.company;
    const out = planOf([WHERE], { oneRound: true, profile, ai: ai({ key: WHERE.key, category: 'current_employer',
      why: 'ok' }, said(WHERE.key, 'Somewhere the AI made up')) });
    const { write } = fieldOf(out, WHERE);
    expect(write?.value).toEqual({ kind: 'text', text: employer });
    expect(write?.origin.provenance).not.toBe('llm-answer');
    expect(JSON.stringify(out.writes)).not.toContain('Somewhere the AI made up');
  });

  it('drops the AI’s answer for a self-identification, legal, pay or consent category, as today’s rules do', () => {
    for (const category of ['sensitive_eeo', 'sensitive_legal', 'sensitive_compensation', 'consent'] as const) {
      const out = planOf([KUBERNETES], { oneRound: true, settings: settingsWith({ modes: { ...DEFAULT_SETTINGS.modes,
        ai: 'profile' } }), ai: ai({ key: KUBERNETES.key, category, why: 'ok' }, chose(KUBERNETES.key)) });
      expect(fieldOf(out, KUBERNETES).write, category).toBeUndefined();
      expect(out.ask?.answers ?? [], category).toEqual([]);
    }
  });

  it('asks again, under its own scope, where the category opens the question to another one than it was asked in', () => {
    // An answer asked under the standard scope never stands for one the `all` scope would ask.
    const out = planOf([KUBERNETES], { oneRound: true, ai: ai({ key: KUBERNETES.key, category: null,
      why: 'unknown-field' }, chose(KUBERNETES.key, 'all')) });
    expect(fieldOf(out, KUBERNETES).write).toBeUndefined();
    expect(out.ask?.answers?.map((item) => [item.key, item.scope, item.classify])).toEqual([
      [KUBERNETES.key, 'standard', undefined]]);
  });
});
