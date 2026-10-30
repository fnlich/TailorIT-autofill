import { describe, expect, it } from 'vitest';
import { canonicalInstitution } from '../profile/entities';
import type { IntendedValue } from '../types/intent';
import { matchOne } from './cascade';
import { intendedAnswer, intendedDecline, intendedInstitution, intendedText } from './intended';
import { doneMatch, finalMatch, inputOf, outcomeOf, prepared, vocab } from './matcher.testkit';
import type { TiebreakRequest } from './types';

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
    // "Online ad" is another referral source the vocabulary knows: a hard conflict, never offered.
    const outcome = outcomeOf(inputOf(intendedAnswer('referral', 'Employee referral', vocab),
      ['Someone who works here told me', 'A friend of mine works there', 'Online ad', 'Other', 'Select...'],
      'referral'));
    expect(outcome.done).toBe(false);
    if (outcome.done || !('tiebreak' in outcome)) return;
    expect(outcome.tiebreak.candidates.map((candidate) => candidate.optionIndex)).toEqual([0, 1]);
    expect(outcome.partial.fallback).toMatchObject({ stage: 'other', optionIndex: 3, freeText: 'Employee referral' });
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

describe('a school known only by an acronym the vocabulary does not hold as its own', () => {
  /** Real schools that answer to each acronym, the first the one a person most likely means. */
  const ROWS = [
    ['UT', ['The University of Texas at Austin', 'Utah Tech University', 'University of Utah']],
    ['OSU', ['The Ohio State University', 'Oregon State University', 'Olabisi Onabanjo University']],
    ['UNH', ['University of New Hampshire-Main Campus', 'University of New Haven',
      'Southern New Hampshire University']],
    ['EMU', ['Eastern Michigan University', 'Eastern Mennonite University', 'Emory University']],
  ] as const;
  const answering = (index: number) => (request: TiebreakRequest) =>
    ({ answers: request.items.map((item) => ({ id: item.id, index })) });

  it('chooses none of the schools it might stand for', async () => {
    for (const [profile, labels] of ROWS) {
      const intended = intendedInstitution(canonicalInstitution({ name: profile }, vocab).value, vocab);
      expect((await finalMatch(inputOf(intended, [...labels], 'institution'))).match.optionIndex, profile).toBeNull();
    }
  });

  /** A school's id with the person's acronym as its only spelling. */
  const acronymOnly = (text: string, id: string): IntendedValue =>
    ({ kind: 'entity', domain: 'institution', id, display: text, surfaces: [{ text, tier: 'raw', ambiguous: false }] });

  it('never reaches a spelled-out option through the id when an unconfirmed acronym is its only spelling', async () => {
    const ut = acronymOnly('UT', 'ipeds:230171');
    expect(prepared(['Utah Tech University'], 'institution').list[0]!.entityIds).toEqual(['ipeds:230171']);
    expect((await finalMatch(inputOf(ut, [...ROWS[0][1]], 'institution'))).match.optionIndex).toBeNull();
    expect((await finalMatch(inputOf(ut, ['Utah Tech University', 'Rice University'], 'institution'))).match
      .optionIndex).toBeNull();
    expect(doneMatch(outcomeOf(inputOf(ut, ['UT', 'Utah Tech University'], 'institution'), false)))
      .toMatchObject({ stage: 'exact', optionIndex: 0, rule: 'raw' });
    // A curated acronym is the school's own: the id may carry it.
    expect(doneMatch(outcomeOf(inputOf(acronymOnly('MIT', 'ipeds:166683'), ['Massachusetts Institute of Technology',
      'Harvard University'], 'institution'), false))).toMatchObject({ stage: 'alias', optionIndex: 0,
      rule: 'entity-id' });
  });

  it('still fills a school the person spelled out, or one its id names with its names', () => {
    const spelled = intendedInstitution(canonicalInstitution({ name: 'UT',
      aliases: ['The University of Texas at Austin'] }, vocab).value, vocab);
    expect(doneMatch(outcomeOf(inputOf(spelled, [...ROWS[0][1]], 'institution'), false)))
      .toMatchObject({ stage: 'exact', optionIndex: 0 });
  });

  it('never asks the LLM, so fills nothing, whatever the LLM would answer', async () => {
    const lists = [...ROWS.map(([, labels]) => [...labels]), ['Boston University', 'Baylor University',
      'Bucknell University'], ['Carnegie Mellon University', 'Central Michigan University']];
    const values = [
      ...[...ROWS.map(([profile]) => profile), 'BU', 'CMU']
        .map((profile) => intendedInstitution(canonicalInstitution({ name: profile }, vocab).value, vocab)),
      acronymOnly('OSU', 'ipeds:204796'), acronymOnly('UT', 'ipeds:230171'),
    ];
    for (const intended of values) {
      for (const labels of lists) {
        for (let index = 0; index < labels.length; index += 1) {
          const { match, requests } = await finalMatch(inputOf(intended, labels, 'institution'), answering(index));
          expect(match.optionIndex, `${JSON.stringify(intended)} ${labels.join(', ')} ${index}`).toBeNull();
          expect(requests).toEqual([]);
        }
      }
    }
  });
});
