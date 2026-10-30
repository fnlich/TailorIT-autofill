import { describe, expect, it } from 'vitest';
import { intendedBoolean } from './intended';
import { doneMatch, inputOf, outcomeOf, prepared } from './matcher.testkit';
import { leadingPolarity, polarityHits } from './polarity';
import { vocab } from './matcher.testkit';

const answer = (value: boolean, labels: string[], legal = true) =>
  doneMatch(outcomeOf(inputOf(intendedBoolean(value), labels, 'polarity', { policy: legal ? 'legal' : 'profile' }), true));

describe('the polarity rule (§4.3)', () => {
  it('reads a leading yes or no', () => {
    const list = prepared(['Yes, I am authorized', 'No - I am not', 'Y', 'I am'], 'polarity').list;
    expect(list.map(leadingPolarity)).toEqual([true, false, true, null]);
  });

  it('matches "Yes" and "No" exactly, then other yes/no phrases by spelling', () => {
    expect(answer(true, ['Yes', 'No'])).toMatchObject({ stage: 'exact', optionIndex: 0, confidence: 1 });
    expect(answer(false, ['Yes, I do', 'No, I do not'])).toMatchObject({ stage: 'alias', optionIndex: 1,
      rule: 'curated-alias' });
  });

  it('chooses by the leading word at 0.93', () => {
    expect(answer(true, ['Yes, I am legally authorized to work in the US', 'No, I am not legally authorized']))
      .toMatchObject({ stage: 'alias', optionIndex: 0, rule: 'polarity', confidence: 0.93 });
  });

  it('chooses between exactly one positive and one negated option at 0.85', () => {
    const labels = ['I will require sponsorship', 'I will not require sponsorship', 'Prefer not to say'];
    expect(answer(true, labels)).toMatchObject({ optionIndex: 0, rule: 'polarity', confidence: 0.85 });
    expect(answer(false, labels)).toMatchObject({ optionIndex: 1, rule: 'polarity', confidence: 0.85 });
  });

  it('leaves the field blank when two options start with the same word', () => {
    expect(answer(true, ['Yes, with sponsorship', 'Yes, without sponsorship', 'No'])).toMatchObject({ stage: 'none',
      reason: 'ambiguous-options' });
    expect(polarityHits(true, prepared(['Maybe', 'Not sure', 'Later'], 'polarity'), vocab)).toEqual([]);
  });
});
