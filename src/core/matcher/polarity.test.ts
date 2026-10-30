import { describe, expect, it } from 'vitest';
import { intendedBoolean } from './intended';
import { doneMatch, inputOf, outcomeOf, prepared } from './matcher.testkit';
import { leadingPolarity, polarityHits } from './polarity';
import { vocab } from './matcher.testkit';

const answer = (value: boolean, labels: string[], legal = true, labelKey = 'question') =>
  doneMatch(outcomeOf(inputOf(intendedBoolean(value), labels, 'polarity', { policy: legal ? 'legal' : 'profile',
    labelKey }), true));

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

describe('the negation rule reads one statement and its denial, nothing else', () => {
  it('leaves an authorization question blank when the two options say different things', () => {
    const pairs = [
      ['I am authorized to work in the U.S. without sponsorship', 'I will require sponsorship to work in the U.S.'],
      ['Authorized to work without restrictions', 'Require visa sponsorship'],
      ['I have no restrictions on working in the US', 'I require sponsorship to work in the US'],
      ['None, I am a U.S. citizen', 'I hold an H-1B visa'],
      ['I can work without sponsorship', 'I can work with sponsorship'],
    ];
    for (const labels of pairs) {
      for (const value of [true, false]) {
        expect(answer(value, labels), `${value} ${labels.join(' / ')}`).toMatchObject({ stage: 'none',
          optionIndex: null });
      }
    }
  });

  it('leaves a pair about restrictions blank, since its negated option is the yes to an authorization question', () => {
    const pairs = [
      ['I have no work authorization restrictions', 'I have work authorization restrictions'],
      ['I have work restrictions', 'I do not have work restrictions'],
      ['There are limits on my right to work', 'There are not limits on my right to work'],
    ];
    for (const labels of pairs) {
      for (const value of [true, false]) {
        expect(answer(value, labels, true, 'are you legally authorized to work in the united states'),
          `${value} ${labels.join(' / ')}`).toMatchObject({ stage: 'none', optionIndex: null });
      }
    }
  });

  it('leaves a pair about the other legal topic blank', () => {
    const authorized = ['I am authorized to work in the US', 'I am not authorized to work in the US'];
    for (const value of [true, false]) {
      expect(answer(value, authorized, true, 'will you now or in the future require sponsorship'))
        .toMatchObject({ stage: 'none', optionIndex: null });
    }
    expect(answer(true, authorized, true, 'are you legally authorized to work in the united states'))
      .toMatchObject({ optionIndex: 0, rule: 'polarity' });
  });

  it('still answers a statement and its denial, auxiliaries aside', () => {
    const authorized = ['I am authorized to work in the US', 'I am not authorized to work in the US'];
    expect(answer(true, authorized)).toMatchObject({ optionIndex: 0, rule: 'polarity' });
    expect(answer(false, authorized)).toMatchObject({ optionIndex: 1, rule: 'polarity' });
    const sponsorship = ['I will require sponsorship', 'I do not require sponsorship'];
    expect(answer(true, sponsorship)).toMatchObject({ optionIndex: 0 });
    expect(answer(false, sponsorship)).toMatchObject({ optionIndex: 1 });
    const hispanic = ['Hispanic or Latino', 'Not Hispanic or Latino'];
    expect(answer(true, hispanic, false)).toMatchObject({ optionIndex: 0 });
    expect(answer(false, hispanic, false)).toMatchObject({ optionIndex: 1 });
  });
});
