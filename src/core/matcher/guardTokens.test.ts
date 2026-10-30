import { describe, expect, it } from 'vitest';
import { canonicalInstitution } from '../profile/entities';
import { normalize } from '../text/normalize';
import { buildScope } from './scope';
import { stagePlan } from './domains';
import {
  bracketsAgree, checkGuard, distinctiveWord, entityGuard, guardFamily, guardSide, type GuardVerdict,
} from './guardTokens';
import { intendedInstitution, intendedText } from './intended';
import { inputOf, prepared, vocab } from './matcher.testkit';
import type { MatchDomain } from './types';

const side = (text: string, domain: MatchDomain = 'institution') =>
  guardSide(normalize(text, domain === 'number' ? 'answer' : domain === 'institution' ? 'institution'
    : domain === 'field' ? 'field' : 'answer'), domain, vocab);

/** The guard's verdict on `option` for the institution the person typed as `profile`. */
function verdict(profile: string, option: string): GuardVerdict {
  const intended = intendedInstitution(canonicalInstitution({ name: profile }, vocab).value, vocab);
  const input = inputOf(intended, [option], 'institution');
  const scope = buildScope(input, vocab, stagePlan('institution', 'profile', true))!;
  return scope.verdict(input.options.list[0]!);
}

describe('guard words (§4.5)', () => {
  it('joins multi-word lexicon names (step 15) and marks the presence words', () => {
    const words = side('University of Michigan - Ann Arbor');
    expect([...words.tokens]).toEqual(['university', 'michigan', 'ann_arbor']);
    expect([...words.presence].sort()).toEqual(['ann_arbor', 'michigan']);
    expect(words.head).toEqual({ noun: 'university', form: 'pre' });
    expect([...side('Washington University in St. Louis').presence].sort()).toEqual(['saint_louis', 'washington']);
  });

  it('counts the classes of each kind: city, region, country, campus, direction, state, tech, discipline, level', () => {
    const presence = (text: string) => [...side(text).presence].sort();
    expect(presence('Austin Community College')).toEqual(['austin', 'community']);
    expect(presence('Georgia Institute of Technology')).toEqual(['georgia', 'technology']);
    expect(presence('Texas State University')).toEqual(['state', 'texas']);
    expect(presence('Northeastern University')).toEqual(['northeastern']);
    expect(presence('USC Upstate')).toEqual(['upstate']);
    expect(presence('Health Science Center')).toEqual(['health_science_center']);
    expect(presence('Texas A&M University')).toEqual(['a&m', 'texas']);
  });

  it('counts USPS codes only inside brackets', () => {
    expect(side('MA Institute').presence.has('ma')).toBe(false);
    const bracketed = side('Massachusetts Institute of Technology (Cambridge, MA)');
    expect([...bracketed.bracketPresence].sort()).toEqual(['cambridge', 'ma']);
  });

  it('reads a discipline’s plural as its singular', () => {
    expect(side('Computer Sciences', 'field').tokens.has('science')).toBe(true);
    expect(side('School of the Arts').tokens.has('art')).toBe(true);
  });

  it('uses the place and institution classes for institutions, the discipline ones for fields, directions and places'
    + ' for countries and regions, and only the acronym-like class elsewhere', () => {
    expect(guardFamily('institution')).toBe('institution');
    expect(guardFamily('field')).toBe('field');
    expect(guardFamily('region')).toBe('place');
    expect(guardFamily('referral')).toBe('basic');
    expect(side('Online ad', 'referral').presence.size).toBe(0);
    expect(side('Online', 'institution').presence.has('online')).toBe(true);
    expect([...side('Option A', 'generic').presence]).toEqual(['a']);
    expect([...side('Plan 2', 'generic').presence]).toEqual(['2']);
  });

  it('never takes an article or a pronoun for a letter ("A friend told me", "I am a veteran")', () => {
    expect(side('A friend told me', 'referral').presence.size).toBe(0);
    expect(side('I am a veteran', 'generic').presence.size).toBe(0);
    expect([...side('Group A', 'generic').presence]).toEqual(['a']);
  });

  it('tells the fuzzy stage which words are distinctive', () => {
    expect(distinctiveWord('northwestern', 'institution', vocab)).toBe(true);
    expect(distinctiveWord('university', 'institution', vocab)).toBe(true);
    expect(distinctiveWord('mellon', 'institution', vocab)).toBe(false);
    expect(distinctiveWord('engineering', 'field', vocab)).toBe(true);
    expect(distinctiveWord('dallas', 'referral', vocab)).toBe(false);
    expect(distinctiveWord('b', 'generic', vocab)).toBe(true);
  });
});

describe('the guard rules, by the design’s examples (§4.5)', () => {
  it('rule 1: every presence word of the option is in a spelling or a fact', () => {
    expect(verdict('Massachusetts Institute of Technology', 'Massachusetts Institute of Technology (Cambridge, MA)'))
      .toEqual({ pass: true });
    expect(verdict('The University of Texas at Austin', 'The University of Texas at Dallas'))
      .toEqual({ pass: false, hard: true, rule: 'presence-extra' });
    expect(verdict('Georgia Institute of Technology', 'Georgia State University'))
      .toEqual({ pass: false, hard: true, rule: 'presence-extra' });
    expect(verdict('Northwestern University', 'Northeastern University'))
      .toEqual({ pass: false, hard: true, rule: 'presence-extra' });
  });

  it('rule 2: the option holds the presence words of the person’s spelling or a canonical name', () => {
    expect(verdict('UT Dallas', 'University of Texas')).toEqual({ pass: false, hard: false, rule: 'presence-missing' });
    expect(verdict('Georgia State University', 'University of Georgia').pass).toBe(false);
    expect(verdict('UT Dallas', 'University of Texas at Dallas')).toEqual({ pass: true });
  });

  it('rule 3: head nouns must be equal when both sides have one', () => {
    expect(verdict('Boston University', 'Boston College')).toEqual({ pass: false, hard: true, rule: 'head-noun' });
    expect(verdict('Carnegie Mellon University', 'Carnegie Mellon')).toEqual({ pass: true });
  });

  it('rule 4: "University of X" is not "X University"', () => {
    expect(verdict('University of Washington', 'Washington University')).toEqual({ pass: false, hard: true,
      rule: 'of-form' });
    expect(verdict('University of Miami', 'Miami University')).toEqual({ pass: false, hard: true, rule: 'of-form' });
  });

  it('accepts an unresolved "st?" against saint or state, but never against a side that has both', () => {
    const entity = (texts: string[]) => entityGuard(texts.map((text) => side(text)), texts.map((text) => side(text)),
      new Set());
    const ambiguous = side('St Hill College');
    expect(ambiguous.tokens.has('st?')).toBe(true);
    expect(checkGuard(entity(['Saint Hill College']), ambiguous)).toEqual({ pass: true });
    expect(checkGuard(entity(['Hill College']), ambiguous).pass).toBe(false);
    expect(checkGuard(entity(['Saint Hill State College']), ambiguous).pass).toBe(false);
  });

  it('letters are presence words in every domain ("Option A" is not "Option D")', () => {
    const input = inputOf(intendedText('Option D'), ['Option A', 'Option D (morning)'], 'generic');
    const scope = buildScope(input, vocab, stagePlan('generic', 'profile', true))!;
    expect(scope.verdict(input.options.list[0]!)).toEqual({ pass: false, hard: true, rule: 'presence-extra' });
    expect(scope.verdict(input.options.list[1]!)).toEqual({ pass: true });
  });
});

describe('bracketsAgree', () => {
  it('needs the option’s bracketed places in the entity, and the spelling’s in the option', () => {
    const intended = intendedInstitution(canonicalInstitution({ name: 'The University of Texas at Austin' }, vocab).value,
      vocab);
    const input = inputOf(intended, prepared(['University of Texas (Dallas)'], 'institution'), 'institution');
    const scope = buildScope(input, vocab, stagePlan('institution', 'profile', true))!;
    const option = scope.optionSide(input.options.list[0]!);
    expect(bracketsAgree(scope.guard(), side('University of Texas'), option)).toBe(false);
    expect(bracketsAgree(scope.guard(), side('University of Texas'), side('University of Texas (Austin, TX)'))).toBe(true);
    expect(bracketsAgree(scope.guard(), side('University of Texas (Austin)'), side('University of Texas'))).toBe(false);
  });
});
