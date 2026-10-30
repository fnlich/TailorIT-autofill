import { describe, expect, it } from 'vitest';
import { specOf } from '../plan/plan.testkit';
import type { SavedAnswer } from '../types/saved';
import { answerFitsKind, findSavedAnswer } from './saved';

const question = specOf('Have you worked with us before?', 'radio', { optionLabels: ['Yes', 'No'] });
const answer = (extra: Partial<SavedAnswer> = {}): SavedAnswer => ({ id: 'sa-1',
  labelKey: 'have you worked with us before', optionSetHash: question.optionSetHash, kind: 'radio',
  scope: { kind: 'global' }, question: 'Have you worked with us before?', answer: { kind: 'options', labels: ['No'] },
  updatedAt: 10, ...extra });

describe('findSavedAnswer (§8.1 step 4, §8.9)', () => {
  it('finds an answer by its exact key: the normalized label and the observed option-set hash', () => {
    expect(findSavedAnswer(question, [answer()], 'unknown')?.id).toBe('sa-1');
    expect(findSavedAnswer(question, [answer({ labelKey: 'worked with us' })], 'unknown')).toBeNull();
    expect(findSavedAnswer(question, [answer({ optionSetHash: '0123456789abcdef' as SavedAnswer['optionSetHash'] })],
      'unknown')).toBeNull();
    expect(findSavedAnswer({ ...question, optionSetHash: 'lazy' as SavedAnswer['optionSetHash'] }, [answer()], 'unknown'))
      .toBeNull();
  });

  it('applies only where the class’s policy allows: never for EEO, legal, sensitive, consent or attention', () => {
    for (const policy of ['eeo', 'legal', 'sensitive', 'consent', 'attention', 'file'] as const) {
      expect(findSavedAnswer(question, [answer()], policy), policy).toBeNull();
    }
    expect(findSavedAnswer(question, [answer()], 'profile')?.id).toBe('sa-1');
  });

  it('takes free text only from the answer saved for this company', () => {
    const why = specOf('Why do you want to work here?', 'textarea');
    const saved = answer({ labelKey: 'why do you want to work here', optionSetHash: why.optionSetHash, kind: 'textarea',
      scope: { kind: 'company', platform: 'lever', board: 'acme' }, answer: { kind: 'text', text: 'Because.' } });
    expect(findSavedAnswer(why, [saved], 'free-text', { platform: 'lever', board: 'acme' })?.id).toBe('sa-1');
    expect(findSavedAnswer(why, [saved], 'free-text', { platform: 'lever', board: 'globex' })).toBeNull();
    expect(findSavedAnswer(why, [saved], 'free-text')).toBeNull();
    expect(findSavedAnswer(why, [{ ...saved, scope: { kind: 'global' } }], 'free-text')).toBeNull();
  });

  it('takes the most recently updated of several, and only a shape the kind can take', () => {
    expect(findSavedAnswer(question, [answer({ id: 'old' }), answer({ id: 'new', updatedAt: 20 })], 'unknown')?.id)
      .toBe('new');
    expect(answerFitsKind({ kind: 'options', labels: ['A', 'B'] }, 'radio')).toBe(false);
    expect(answerFitsKind({ kind: 'options', labels: ['A', 'B'] }, 'checkbox-group')).toBe(true);
    expect(answerFitsKind({ kind: 'text', text: ' ' }, 'text')).toBe(false);
    expect(answerFitsKind({ kind: 'checked', checked: true }, 'checkbox')).toBe(true);
    expect(answerFitsKind({ kind: 'checked', checked: true }, 'radio')).toBe(false);
  });
});
