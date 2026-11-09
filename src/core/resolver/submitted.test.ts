/*
 * v1.3 B: the person's own answers from applications they submitted before (submitted.ts, resolve.ts, the Guard).
 * Undo proofs: each `it` names the rule whose removal fails it.
 */
import { describe, expect, it } from 'vitest';
import { checkProvenance } from '../guard/provenance';
import { fieldOf, goldenProfile, inputOf, planOf, specOf } from '../plan/plan.testkit';
import { planFrame } from '../plan/frame';
import { normalizeLabel } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { SubmittedAnswer } from '../types/submitted';
import { findSubmittedAnswer, submittedFitsKind } from './submitted';

const hiking = specOf('Do you enjoy hiking on weekends?', 'radio', { optionLabels: ['Yes', 'No'] });
const answerOf = (spec: FieldSpec, extra: Partial<SubmittedAnswer> = {}): SubmittedAnswer => ({ id: 'r1.s0',
  labelKey: normalizeLabel(spec.label), optionSetHash: spec.optionSetHash, kind: spec.kind,
  answer: { kind: 'options', labels: ['No'] }, sameJob: false, submittedAt: 10, ...extra });
const open = { policy: 'unknown', screened: false, sensitiveReady: true } as const;

describe('findSubmittedAnswer', () => {
  it('takes another job’s answer only by the same normalized label and option set', () => {
    expect(findSubmittedAnswer(hiking, [answerOf(hiking)], open)?.answer.id).toBe('r1.s0');
    const changed = specOf('Do you enjoy hiking on weekends?', 'radio', { optionLabels: ['Yes', 'No', 'Sometimes'] });
    expect(findSubmittedAnswer(changed, [answerOf(hiking)], open)).toBeNull();
    expect(findSubmittedAnswer(hiking, [answerOf(hiking, { labelKey: 'do you enjoy running' })], open)).toBeNull();
  });

  it('ranks this job’s answer first, then the newest', () => {
    const found = findSubmittedAnswer(hiking, [answerOf(hiking, { id: 'other', submittedAt: 99 }),
      answerOf(hiking, { id: 'own', sameJob: true, answer: { kind: 'options', labels: ['Yes'] } })], open);
    expect(found?.answer.id).toBe('own');
    expect(findSubmittedAnswer(hiking, [answerOf(hiking, { id: 'a' }), answerOf(hiking, { id: 'b', submittedAt: 20 })],
      open)?.answer.id).toBe('b');
  });

  // Undo proof: drop stillOffered and `gone` is false.
  it('flags this job’s option answer that the form no longer offers (gone), and takes one it still offers', () => {
    const changed = specOf('Do you enjoy hiking on weekends?', 'radio', { optionLabels: ['Yes', 'Sometimes'] });
    const own = answerOf(hiking, { sameJob: true });
    expect(findSubmittedAnswer(changed, [own], open)).toEqual({ answer: own, gone: true });
    const kept = specOf('Do you enjoy hiking on weekends?', 'radio', { optionLabels: ['No', 'Maybe'] });
    expect(findSubmittedAnswer(kept, [own], open)).toEqual({ answer: own, gone: false });
    // A list not read yet: planned as a choice, so the loop reads it.
    expect(findSubmittedAnswer({ ...hiking, options: 'lazy', optionSetHash: 'lazy' as FieldSpec['optionSetHash'] }, [own],
      open)).toEqual({ answer: own, gone: false });
  });

  // Undo proof: let OTHER_JOB_CLASSES take 'eeo', 'legal', 'sensitive' or 'free-text', or drop `screened`.
  it('never takes another job’s answer for a sensitive question, a screened one or free text', () => {
    for (const policy of ['eeo', 'legal', 'sensitive', 'free-text'] as const) {
      expect(findSubmittedAnswer(hiking, [answerOf(hiking)], { ...open, policy }), policy).toBeNull();
    }
    expect(findSubmittedAnswer(hiking, [answerOf(hiking)], { ...open, screened: true })).toBeNull();
    expect(findSubmittedAnswer(hiking, [answerOf(hiking)], { ...open, policy: 'profile' })).not.toBeNull();
  });

  // Undo proof: drop the sensitiveReady check and the not-loaded line fails.
  it('takes this job’s answer to a sensitive question only while the sensitive part is loaded', () => {
    const own = answerOf(hiking, { sameJob: true });
    for (const policy of ['eeo', 'legal', 'sensitive'] as const) {
      expect(findSubmittedAnswer(hiking, [own], { ...open, policy })?.answer.id, policy).toBe('r1.s0');
      expect(findSubmittedAnswer(hiking, [own], { ...open, policy, sensitiveReady: false }), policy).toBeNull();
    }
  });

  it('never fills a consent, an attention check or an upload, whoever’s', () => {
    const own = answerOf(hiking, { sameJob: true });
    for (const policy of ['consent', 'attention', 'file'] as const) {
      expect(findSubmittedAnswer(hiking, [own, answerOf(hiking)], { ...open, policy }), policy).toBeNull();
    }
  });

  it('tells this job’s same-labelled questions apart by section, then by place', () => {
    const school = specOf('Notes', 'text', { section: { id: 'education', block: 1 }, ordinal: 0 });
    const text = (value: string, extra: Partial<SubmittedAnswer>) => answerOf(school, { sameJob: true,
      answer: { kind: 'text', text: value }, ...extra });
    const answers = [text('first', { id: 'a', questionId: 1, section: 'education[0]', order: 3 }),
      text('second', { id: 'b', questionId: 2, section: 'education[1]', order: 7 })];
    expect(findSubmittedAnswer(school, answers, open)?.answer.id).toBe('b');
    const twice = [text('one', { id: 'a', questionId: 1, section: 'main', order: 3 }),
      text('two', { id: 'b', questionId: 2, section: 'main', order: 9 })];
    expect(findSubmittedAnswer(specOf('Notes', 'text', { ordinal: 1 }), twice, open)?.answer.id).toBe('b');
    expect(findSubmittedAnswer(specOf('Notes', 'text', { ordinal: 0 }), twice, open)?.answer.id).toBe('a');
  });

  it('fits only a shape the kind can take', () => {
    expect(submittedFitsKind({ kind: 'options', labels: ['A', 'B'] }, 'radio')).toBe(false);
    expect(submittedFitsKind({ kind: 'options', labels: ['A'] }, 'typeahead-remote')).toBe(true);
    expect(submittedFitsKind({ kind: 'text', text: 'x' }, 'date')).toBe(false);
    expect(submittedFitsKind({ kind: 'checked', checked: true }, 'checkbox')).toBe(true);
  });
});

describe('the resolver step before any AI (planFrame)', () => {
  // Undo proof: remove the v1.3 B block of resolveField and the question waits for the AI instead.
  it('fills an unknown question from another job’s answer: provenance submitted-before, no AI asked', () => {
    const answer = answerOf(hiking);
    const output = planOf([hiking], { submittedAnswers: [answer] });
    const { write, row } = fieldOf(output, hiking);
    expect(write?.origin).toEqual({ provenance: 'submitted-before', submittedId: 'r1.s0', sameJob: false });
    expect(write?.value).toMatchObject({ kind: 'option', index: 1 });
    expect(row).toMatchObject({ status: 'verified', provenance: 'submitted-before', reason: 'submitted-before' });
    expect(output.awaiting).toEqual([]);
    expect(output.ask).toBeUndefined();
    // Without it, the same question waits for TailorIT's AI.
    expect(planOf([hiking]).awaiting).toEqual([hiking.key]);
  });

  // Undo proof: let the step run before the profile (or for a result.ok value) and the profile's email loses.
  it('lets the profile win over an earlier answer for a profile question (module header)', () => {
    const email = specOf('Email', 'text', { autocomplete: ['email'] });
    const earlier = answerOf(email, { sameJob: true, answer: { kind: 'text', text: 'old@example.com' } });
    const { write } = fieldOf(planOf([email], { submittedAnswers: [earlier] }), email);
    expect(write?.origin.provenance).toBe('profile');
    expect(write?.value).toEqual({ kind: 'text', text: goldenProfile().contact.email });
  });

  // Undo proof: drop `gone`'s flagged return and the field is written or asked of the AI.
  it('flags, never writes and never asks the AI for, this job’s answer whose option is gone', () => {
    const changed = specOf('Do you enjoy hiking on weekends?', 'radio', { optionLabels: ['Yes', 'Sometimes'] });
    const output = planOf([changed], { submittedAnswers: [answerOf(hiking, { sameJob: true })] });
    const { write, row } = fieldOf(output, changed);
    expect(write).toBeUndefined();
    expect(row).toMatchObject({ status: 'flagged', reason: 'submitted-option-gone' });
    expect(output.awaiting).toEqual([]);
  });

  // Undo proof: let another job's answer through for an EEO question and the decline default is replaced.
  it('fills an EEO question from this job’s answer (sensitive part loaded), never from another job’s', () => {
    const gender = specOf('Gender', 'select', { optionLabels: ['Male', 'Female', 'Decline To Self Identify'] });
    const own = answerOf(gender, { sameJob: true, answer: { kind: 'options', labels: ['Female'] } });
    const profile = { ...goldenProfile(), eeo: { ...goldenProfile().eeo, gender: undefined } } as ReturnType<typeof goldenProfile>;
    const mine = fieldOf(planFrame(inputOf([gender], { profile, submittedAnswers: [own] })), gender);
    expect(mine.write?.origin).toEqual({ provenance: 'submitted-before', submittedId: 'r1.s0', sameJob: true });
    const theirs = fieldOf(planFrame(inputOf([gender], { profile, submittedAnswers: [{ ...own, sameJob: false }] })), gender);
    expect(theirs.write?.origin.provenance).not.toBe('submitted-before');
    // Not loaded: this job's answer waits too.
    const notLoaded = fieldOf(planFrame(inputOf([gender], { profile, sensitiveState: 'not-shared',
      submittedAnswers: [own] })), gender);
    expect(notLoaded.write?.origin.provenance).not.toBe('submitted-before');
  });

  it('the Guard checks the earlier answer is the run’s, for this question, and whose it says it is', () => {
    const answer = answerOf(hiking);
    const write = fieldOf(planOf([hiking], { submittedAnswers: [answer] }), hiking).write!;
    const ctx = { profile: goldenProfile(), savedAnswers: [], submittedAnswers: [answer] };
    expect(checkProvenance(write, hiking, 'unknown', ctx)).toEqual({ ok: true });
    expect(checkProvenance(write, hiking, 'unknown', { ...ctx, submittedAnswers: [] }).ok).toBe(false);
    expect(checkProvenance({ ...write, origin: { ...write.origin, sameJob: true } as typeof write.origin }, hiking,
      'unknown', ctx).ok).toBe(false);
    const other = specOf('Do you like camping?', 'radio', { optionLabels: ['Yes', 'No'] });
    expect(checkProvenance(write, other, 'unknown', ctx).ok).toBe(false);
  });
});
