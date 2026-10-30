import { describe, expect, it } from 'vitest';
import { intendedAnswer } from './intended';
import { doneMatch, inputOf, outcomeOf, prepared, vocab } from './matcher.testkit';
import { mentionedIds, mentionHits } from './mention';

const linkedin = intendedAnswer('referral', 'LinkedIn', vocab);

describe('the mention rule (§4.3)', () => {
  it('finds the vocabulary phrases a label mentions, longest first, without overlaps', () => {
    const [one, two, none] = prepared(['Job Board - LinkedIn', 'LinkedIn or Indeed', 'A friend'], 'referral').list;
    expect([...mentionedIds(one!, 'referral', vocab)]).toEqual(['ref:linkedin']);
    expect([...mentionedIds(two!, 'referral', vocab)].sort()).toEqual(['ref:indeed', 'ref:linkedin']);
    expect(mentionedIds(none!, 'referral', vocab).size).toBe(0);
  });

  it('chooses the one option that mentions the intended source and nothing else, at 0.93', () => {
    expect(doneMatch(outcomeOf(inputOf(linkedin, ['Job Board - Indeed', 'Job Board - LinkedIn', 'Other'], 'referral'),
      false))).toMatchObject({ stage: 'alias', optionIndex: 1, rule: 'mention', confidence: 0.93 });
  });

  it('refuses when two options mention it, or the option mentions another source too', () => {
    expect(mentionHits('ref:linkedin', prepared(['LinkedIn post', 'LinkedIn ad'], 'referral'), 'referral', vocab))
      .toEqual([]);
    expect(mentionHits('ref:linkedin', prepared(['LinkedIn or Indeed', 'Glassdoor'], 'referral'), 'referral', vocab))
      .toEqual([]);
  });

  it('reads bracketed words ("X (formerly Twitter)")', () => {
    const [option] = prepared(['Social media (Twitter)'], 'referral').list;
    expect([...mentionedIds(option!, 'referral', vocab)]).toEqual(['ref:twitter']);
  });
});
