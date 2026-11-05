import { describe, expect, it } from 'vitest';
import { answerWords, antecedentOf, conditionHolds, conditionOf } from './conditional';
import { fieldOf, inOrder, planOf, specOf } from './plan.testkit';
import type { PlanAi } from './types';

// Conditional follow-ups (the Phase 7a review; conditional.ts): never drafted or guessed while optional; a required one
// only once the answer above, as written, is the one it follows. The labels are the live Workable capture's.

describe('conditionOf: what a follow-up waits for', () => {
  it.each([
    ['If you answered no to the question above, please explain', { kind: 'no' }],
    ['If yes, please mention your CloudFactory email address', { kind: 'yes' }],
    ['If so, when did you leave?', { kind: 'yes' }],
    ['If no, please tell us why', { kind: 'no' }],
    ['If you answered "yes" to previously working for AVANGRID, please list where', { kind: 'yes' }],
    ['If you answered "I am represented by an external agency", name the agency', { kind: 'words',
      words: 'i am represented by an external agency' }],
    ['If you selected Other, please specify', { kind: 'words', words: 'other' }],
    ['If you answered the question above, add anything else', { kind: 'words', words: 'the question' }],
  ])('%s', (label, condition) => {
    expect(conditionOf(label)).toEqual(condition);
  });

  it('is null for a question that is no follow-up', () => {
    for (const label of ['If applicable, your portfolio link', 'Why do you want to work here?', 'Life is good if so',
      'Iffy question', 'What if you answered no?']) {
      expect(conditionOf(label), label).toBeNull();
    }
  });
});

describe('the answer above, as written', () => {
  const asked = specOf('Are you currently working as a CloudWorker?', 'radio', { optionLabels: ['Yes', 'No'] });
  const follow = specOf('If yes, please mention your CloudFactory email address', 'text');
  const other = specOf('Phone', 'text', { section: { id: 'contact' } });

  it('is the nearest earlier field of the section that is no follow-up itself', () => {
    const [first, second, third, fourth] = inOrder([asked, other, follow,
      specOf('If yes, how long?', 'text', { ordinal: 1 })]);
    expect(antecedentOf(third!, [first!, second!, third!, fourth!])?.key).toBe(asked.key);
    expect(antecedentOf(fourth!, [first!, second!, third!, fourth!])?.key).toBe(asked.key);
    expect(antecedentOf(first!, [first!, second!, third!])).toBeNull();
  });

  it('reads what this plan writes, else what the page shows', () => {
    expect(answerWords(asked, { kind: 'option', index: 0, cleanLabel: 'Yes' })).toEqual(['Yes']);
    expect(answerWords({ ...asked, current: { kind: 'selected', labels: ['No'] } }, undefined)).toEqual(['No']);
    expect(answerWords(asked, undefined)).toBeNull();
    expect(answerWords({ ...asked, kind: 'checkbox', current: { kind: 'checked', checked: true } }, undefined))
      .toEqual(['yes']);
  });

  it('holds only for the answer the follow-up waits for', () => {
    expect(conditionHolds({ kind: 'yes' }, ['Yes'])).toBe(true);
    expect(conditionHolds({ kind: 'yes' }, ['No'])).toBe(false);
    expect(conditionHolds({ kind: 'no' }, ['None of the above'])).toBe(false);
    expect(conditionHolds({ kind: 'no' }, ['No, I have not'])).toBe(true);
    expect(conditionHolds({ kind: 'words', words: 'other' }, ['Other'])).toBe(true);
    expect(conditionHolds({ kind: 'words', words: 'i am represented by an external agency' },
      ['I am represented by an external agency or recruiter'])).toBe(true);
    expect(conditionHolds({ kind: 'yes' }, null)).toBe(false);
    expect(conditionHolds({ kind: 'unknown' }, ['Yes'])).toBe(false);
  });
});

describe('planFrame and a follow-up', () => {
  const asked = specOf('Are you currently working as a CloudWorker?', 'radio', { optionLabels: ['Yes', 'No'],
    required: true });
  const optional = specOf('If you answered no to the question above, please explain', 'textarea');
  const required = specOf('If yes, how many months have you worked as a CloudWorker?', 'text', { required: true });
  const asks = (out: ReturnType<typeof planOf>) => [...(out.ask?.drafts ?? []), ...(out.ask?.answers ?? [])]
    .map((item) => item.key);
  /** The classifier's word on the follow-ups: no category it knows (so they would be asked of the answer route next). */
  const ai: PlanAi = { verdicts: new Map(), classifications: new Map([optional, required].map((spec) =>
    [spec.key as string, { key: spec.key, category: null, why: 'unknown-field' as const }])) };

  it('never drafts or guesses an optional one, whatever the answer above', () => {
    for (const current of [{ kind: 'empty' as const }, { kind: 'selected' as const, labels: ['No'] },
      { kind: 'selected' as const, labels: ['Yes'] }]) {
      const out = planOf([{ ...asked, current }, optional], { ai });
      expect(asks(out)).not.toContain(optional.key);
      expect(fieldOf(out, optional)).toMatchObject({ write: undefined, row: { status: 'skipped',
        reason: 'conditional-question', needsUserAction: false } });
    }
  });

  it('leaves a required one for the person until the answer above is the one it follows', () => {
    for (const current of [{ kind: 'empty' as const }, { kind: 'selected' as const, labels: ['No'] }]) {
      const out = planOf([{ ...asked, current }, required], { ai });
      expect(asks(out)).not.toContain(required.key);
      expect(fieldOf(out, required)).toMatchObject({ write: undefined, row: { status: 'flagged',
        reason: 'conditional-question', needsUserAction: true } });
    }
    // The page shows Yes above: it is asked as any question nothing else settles.
    const yes = planOf([{ ...asked, current: { kind: 'selected', labels: ['Yes'] } }, required], { ai });
    expect(asks(yes)).toContain(required.key);
  });

  it('reads the answer above from what the same plan writes into it', () => {
    // The profile answers a sponsorship Yes/No; its follow-up waits for "no".
    const sponsorship = specOf('Will you now or in the future require sponsorship for employment visa status?', 'radio',
      { optionLabels: ['Yes', 'No'], required: true });
    const why = specOf('If no, how many months is your current work authorization valid for?', 'text',
      { required: true });
    const both: PlanAi = { verdicts: new Map(), classifications: new Map([[why.key as string, { key: why.key,
      category: null, why: 'unknown-field' as const }]]) };
    const out = planOf([sponsorship, why], { ai: both });
    expect(fieldOf(out, sponsorship).write?.value).toMatchObject({ kind: 'option', cleanLabel: 'No' });
    expect(asks(out)).toContain(why.key);
  });
});
