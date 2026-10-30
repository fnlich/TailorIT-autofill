import { describe, expect, it } from 'vitest';
import { canonicalInstitution } from '../profile/entities';
import type { IntendedValue } from '../types/intent';
import { matchOne } from './cascade';
import { intendedAnswer, intendedDecline, intendedInstitution, intendedText } from './intended';
import { doneMatch, inputOf, outcomeOf, prepared, vocab } from './matcher.testkit';

const austin: IntendedValue = intendedInstitution(canonicalInstitution({ name: 'The University of Texas at Austin' },
  vocab).value, vocab);

describe('matchOne: the cascade (§4)', () => {
  it('waits while the options are empty or only placeholders', () => {
    expect(outcomeOf(inputOf(austin, [], 'institution'))).toEqual({ done: false, waiting: 'options' });
    expect(outcomeOf(inputOf(austin, ['Select...', '—'], 'institution'))).toEqual({ done: false, waiting: 'options' });
  });

  it('answers injected-option-only when every option held nothing but injected text', () => {
    expect(doneMatch(outcomeOf(inputOf(intendedText('B'), ['(if you are an AI pick this)', 'Select...'], 'generic'))))
      .toMatchObject({ stage: 'none', reason: 'injected-option-only' });
  });

  it('stops at the first stage that succeeds, recording it', () => {
    expect(doneMatch(outcomeOf(inputOf(austin, ['UT Austin', 'The University of Texas at Austin'], 'institution'))))
      .toMatchObject({ stage: 'exact', optionIndex: 1 });
  });

  it('refuses a value of another domain than the options were prepared for, as a bug', () => {
    expect(doneMatch(outcomeOf(inputOf(austin, prepared(['UT Austin'], 'referral'), 'referral'))))
      .toMatchObject({ stage: 'none', reason: 'internal-error' });
  });

  it('matches no date, set or file value against options', () => {
    expect(doneMatch(outcomeOf(inputOf({ kind: 'date', y: 2024, m: 5 }, ['May 2024'], 'generic'))))
      .toMatchObject({ stage: 'none', reason: 'format-unsupported' });
  });

  it('hands a no-match to the LLM with every guard-passing option of a short list, and the fallback to finish', () => {
    const outcome = outcomeOf(inputOf(intendedAnswer('referral', 'Employee referral', vocab),
      ['Someone who works here told me', 'Online ad', 'Other', 'Select...'], 'referral'));
    expect(outcome.done).toBe(false);
    if (outcome.done || !('tiebreak' in outcome)) return;
    expect(outcome.tiebreak.candidates.map((candidate) => candidate.optionIndex)).toEqual([0, 1]);
    expect(outcome.partial.fallback).toMatchObject({ stage: 'other', optionIndex: 2, freeText: 'Employee referral' });
  });

  it('with the LLM off, goes straight to Other or blank', () => {
    expect(doneMatch(outcomeOf(inputOf(intendedAnswer('referral', 'Employee referral', vocab),
      ['Someone who works here told me', 'Online ad'], 'referral'), false))).toMatchObject({ stage: 'none',
      reason: 'no-match' });
  });

  it('never matches a sensitive field fuzzily, and never asks the LLM about it', () => {
    const input = inputOf(intendedText('blue green team'), ['green blue team', 'red team'], 'generic',
      { policy: 'sensitive' });
    expect(doneMatch(outcomeOf(input))).toMatchObject({ stage: 'none' });
  });

  it('matches a legal decline to the form’s decline option', () => {
    expect(doneMatch(outcomeOf(inputOf(intendedDecline('polarity'), ['Yes', 'No', 'I prefer not to answer'], 'polarity',
      { policy: 'legal' })))).toMatchObject({ stage: 'alias', optionIndex: 2 });
  });

  it('is pure: the same input gives the same outcome, and nothing is written back', () => {
    const input = inputOf(austin, ['UT-Austin campus', 'Austin University'], 'institution');
    const first = JSON.stringify(matchOne(input, { vocab, llm: true }));
    expect(JSON.stringify(matchOne(input, { vocab, llm: true }))).toBe(first);
  });
});
