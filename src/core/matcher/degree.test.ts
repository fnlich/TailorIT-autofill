import { describe, expect, it } from 'vitest';
import { canonicalDegree, parseDegree } from '../profile/degreeParse';
import { canonicalField } from '../profile/entities';
import type { IntendedValue } from '../types/intent';
import { degreeConflict, degreeHits, detectDegreeGranularity, type DegreeIntent } from './degree';
import { intendedDegree } from './intended';
import { doneMatch, finalMatch, inputOf, outcomeOf, prepared, vocab } from './matcher.testkit';

const degree = (text: string): IntendedValue => intendedDegree(canonicalDegree({ text }, vocab).value, vocab);
const match = (text: string, labels: string[]) => doneMatch(outcomeOf(inputOf(degree(text), labels, 'degree'), false));

describe('detectDegreeGranularity (§4.9)', () => {
  it.each([
    [['B.S. in Computer Science', 'B.A. in Economics', 'M.S. in Physics'], 'combined'],
    [['B.A.', 'B.S.', 'M.S.', 'Ph.D.'], 'types'],
    [["Bachelor's Degree", "Master's Degree", 'Doctorate'], 'levels'],
    [['High School', 'BA/BS', 'MA/MS', 'PhD'], 'types'],
    [['B.S.', 'M.S.', "Bachelor's", "Master's", 'Some college'], 'mixed'],
    [['Some college', 'Bootcamp', 'Self-taught'], 'unknown'],
  ] as const)('%j is %s', (labels, granularity) => {
    expect(detectDegreeGranularity(prepared(labels, 'degree').list)).toBe(granularity);
  });

  it('leaves Other, placeholder and decline options out of the shares', () => {
    expect(detectDegreeGranularity(prepared(["Bachelor's", "Master's", 'Other', 'Select...', 'Prefer not to say'],
      'degree').list)).toBe('levels');
  });
});

describe('degree matching by granularity (§4.9)', () => {
  it('maps a type onto a list of types by its class, never BA to BS', () => {
    expect(match('BSc', ['B.A.', 'B.S.', 'M.S.']))
      .toMatchObject({ optionIndex: 1, rule: 'degree-type', confidence: 0.97 });
    expect(match('BA', ['B.S.', 'M.S.']).optionIndex).toBeNull();
    expect(match('BEng', ['B.A.', 'B.S.']).optionIndex).toBeNull();
  });

  it('prefers the exact type to a class-mate, and a pure option to a mixed one', () => {
    expect(match('Bachelor of Science', ['BSc', 'B.S.'])).toMatchObject({ optionIndex: 1, rule: 'degree-type',
      flags: ['same-entity-duplicates'] });
    expect(match('B.S.', ['BA/BS', 'B.S.'])).toMatchObject({ optionIndex: 1 });
  });

  it('maps a level-only degree onto a list of types only when exactly one option is of that level', () => {
    expect(match("Bachelor's Degree", ['High School', 'BA/BS', 'MA/MS', 'PhD']))
      .toMatchObject({ optionIndex: 1, rule: 'degree-level' });
    expect(match("Bachelor's Degree", ['B.A.', 'B.S.', 'M.S.']).optionIndex).toBeNull();
  });

  it('maps by level on a list of levels', () => {
    expect(match('PhD', ["Bachelor's", "Master's", 'Doctorate'])).toMatchObject({ optionIndex: 2, rule: 'degree-level' });
    expect(match("Master's", ["Bachelor's", 'Doctorate']).optionIndex).toBeNull();
  });

  it('falls back from MBA to Master’s at 0.85 and from JD or MD to Doctorate at 0.75, both flagged', () => {
    expect(match('MBA', ['Associate', 'Bachelor', 'Master', 'Doctorate']))
      .toMatchObject({ optionIndex: 2, rule: 'degree-level-fallback', confidence: 0.85, flags: ['level-fallback'] });
    expect(match('JD', ["Bachelor's", "Master's", 'Doctorate']))
      .toMatchObject({ optionIndex: 2, rule: 'degree-level-fallback', confidence: 0.75, flags: ['level-fallback'] });
    expect(match('MD', ["Bachelor's", "Master's", 'Doctorate', 'Professional degree']))
      .toMatchObject({ optionIndex: 3, rule: 'degree-level', confidence: 0.97 });
  });

  it('takes a doctorate that lists the type in its brackets at 0.97', () => {
    expect(match('JD', ["Bachelor's", "Master's", 'Doctorate (PhD, MD, JD)', 'Other']))
      .toMatchObject({ optionIndex: 2, rule: 'degree-qualifier-types', confidence: 0.97 });
  });

  it('on a mixed list, takes the type first, else a level-only option of the same level', () => {
    const labels = ['B.S.', 'M.S.', "Bachelor's", "Master's", 'Some college'];
    expect(match('Bachelor of Science', labels)).toMatchObject({ optionIndex: 0, rule: 'degree-type' });
    expect(match('BA', labels)).toMatchObject({ optionIndex: 2, rule: 'degree-level' });
  });

  it('needs the type and the field to agree on a combined list', () => {
    const intent: DegreeIntent = { level: 'bachelor', type: 'BS' };
    const cs = canonicalField({ text: 'Computer Science' }, vocab).value;
    const options = prepared(['B.S. in Computer Science', 'B.S. in Economics', 'B.A. in Computer Science'], 'degree');
    expect(degreeHits(intent, options, vocab, cs).map((hit) => hit.option.index)).toEqual([0]);
    expect(degreeHits(intent, options, vocab)).toEqual([]);
  });

  it('takes no option of another field, whatever the list’s granularity', () => {
    const bs = degree('BS');
    const labels = ['B.S. Computer Science', 'B.S. Mathematics', "Master's", 'PhD', "Associate's"];
    const withField = (text: string) => doneMatch(outcomeOf(inputOf(bs, labels, 'degree',
      { degreeField: canonicalField({ text }, vocab).value }), false));
    expect(withField('Mathematics')).toMatchObject({ stage: 'alias', optionIndex: 1, rule: 'degree-type', flags: [] });
    expect(withField('Computer Science')).toMatchObject({ optionIndex: 0, flags: [] });
    expect(withField('Physics')).toMatchObject({ stage: 'none', optionIndex: null });
    const types = ['B.S. Computer Science', 'B.S.', 'M.S.', 'Ph.D.', 'B.A.'];
    expect(doneMatch(outcomeOf(inputOf(bs, types, 'degree'), false))).toMatchObject({ optionIndex: 1 });
  });

  it('takes no level option whose bracketed types are of another class, in any order', () => {
    expect(match('PhD', ['Doctorate (EdD)', 'Doctorate (PhD)', "Master's"])).toMatchObject({ optionIndex: 1 });
    expect(match('MS', ["Master's (MBA)", "Master's (MS)", "Bachelor's"])).toMatchObject({ optionIndex: 1 });
    expect(match('MBA', ["Master's (MS)", "Master's (MBA)", "Bachelor's"])).toMatchObject({ optionIndex: 1 });
    expect(match('PhD', ['Doctorate (EdD)', "Master's"]).optionIndex).toBeNull();
  });

  it('leaves a level-only degree blank between options its bracketed types tell apart', () => {
    for (const text of ['Doctorate', 'Doctoral degree']) {
      expect(match(text, ['Doctorate (PhD)', 'Doctorate (EdD)', "Master's"]), text)
        .toMatchObject({ stage: 'none', optionIndex: null });
      expect(match(text, ['Doctorate (EdD)', 'Doctorate', 'Doctorate (PhD)']), text).toMatchObject({ optionIndex: 1 });
    }
  });

  it('leaves an unknown list to the exact stage', () => {
    expect(match('Bootcamp', ['Some college', 'Bootcamp', 'Self-taught'])).toMatchObject({ stage: 'exact',
      optionIndex: 1 });
    expect(degreeHits({ level: 'bachelor', type: null }, prepared(['Some college', 'Bootcamp'], 'degree'), vocab))
      .toEqual([]);
  });
});

describe('degreeConflict: what no stage, the LLM included, may choose', () => {
  it('rules out bracketed types of another class', () => {
    const phd: DegreeIntent = { level: 'doctorate', type: 'PhD' };
    expect(degreeConflict(phd, parseDegree('Doctorate (EdD)', vocab), vocab)).toBe(true);
    expect(degreeConflict(phd, parseDegree('Doctorate (PhD, MD, JD)', vocab), vocab)).toBe(false);
    expect(degreeConflict(phd, parseDegree('Doctorate', vocab), vocab)).toBe(false);
  });

  it('rules out another field of study, and any field for an entry without one', () => {
    const bs: DegreeIntent = { level: 'bachelor', type: 'BS' };
    const cs = canonicalField({ text: 'Computer Science' }, vocab).value;
    expect(degreeConflict(bs, parseDegree('B.S. in Mathematics', vocab), vocab, cs)).toBe(true);
    expect(degreeConflict(bs, parseDegree('B.S. in Computer Science', vocab), vocab, cs)).toBe(false);
    expect(degreeConflict(bs, parseDegree('B.S. in Computer Science', vocab), vocab)).toBe(true);
    expect(degreeConflict(bs, parseDegree('Bachelor of Science', vocab), vocab)).toBe(false);
  });

  it('rules out another level, unless the type may stand for it, and types of another class', () => {
    const bs: DegreeIntent = { level: 'bachelor', type: 'BS' };
    const jd: DegreeIntent = { level: 'professional', type: 'JD' };
    expect(degreeConflict(bs, parseDegree('B.A.', vocab), vocab)).toBe(true);
    expect(degreeConflict(bs, parseDegree('M.S.', vocab), vocab)).toBe(true);
    expect(degreeConflict(bs, parseDegree('BSc', vocab), vocab)).toBe(false);
    expect(degreeConflict(bs, parseDegree("Bachelor's", vocab), vocab)).toBe(false);
    expect(degreeConflict(jd, parseDegree('Doctorate', vocab), vocab)).toBe(false);
    expect(degreeConflict(jd, parseDegree("Master's", vocab), vocab)).toBe(true);
    expect(degreeConflict(bs, parseDegree('Some college', vocab), vocab)).toBe(false);
  });

  it('keeps conflicting options from the LLM entirely', async () => {
    const { match: result, requests } = await finalMatch(inputOf(degree('BA'), ['B.S.', 'M.S.', 'Some college'],
      'degree'));
    expect(result.optionIndex).toBeNull();
    expect(requests.flatMap((request) => request.items[0]!.candidates.map((candidate) => candidate.label)))
      .toEqual(['Some college']);
  });
});
