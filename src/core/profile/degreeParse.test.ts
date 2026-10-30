import { describe, expect, it } from 'vitest';
import type { DegreeLevel, DegreeType } from '../enums';
import { bundledVocab } from '../vocab/bundled.testkit';
import { canonicalDegree, DEGREE_LEVEL_RANK, parseDegree, type ParsedDegree } from './degreeParse';

const vocab = bundledVocab();

const parsed = (level: DegreeLevel | undefined, types: DegreeType[], extra: Partial<ParsedDegree> = {}): ParsedDegree => ({
  ...(level !== undefined ? { level } : {}), types, qualifierTypes: [], ...extra,
});

describe('parseDegree: the golden table’s degree values and options (§6.1, §6.2)', () => {
  it.each<[string, ParsedDegree]>([
    ['BSc', parsed('bachelor', ['BSc'])],
    ['B.S.', parsed('bachelor', ['BS'])],
    ['B.A.', parsed('bachelor', ['BA'])],
    ['M.S.', parsed('master', ['MS'])],
    ['Ph.D.', parsed('doctorate', ['PhD'])],
    ['PhD', parsed('doctorate', ['PhD'])],
    ['MSc', parsed('master', ['MSc'])],
    ['BA', parsed('bachelor', ['BA'])],
    ['BEng', parsed('bachelor', ['BEng'])],
    ['JD', parsed('professional', ['JD'])],
    ['MBA', parsed('professional', ['MBA'])],
    ['Bachelor of Arts', parsed('bachelor', ['BA'])],
    ['Bachelor of Science', parsed('bachelor', ['BS'])],
    ['Master of Science', parsed('master', ['MS'])],
    ['Doctor of Philosophy', parsed('doctorate', ['PhD'])],
    ['Bachelors', parsed('bachelor', [])],
    ['Bachelor', parsed('bachelor', [])],
    ["Bachelor's", parsed('bachelor', [])],
    ["Bachelor's Degree", parsed('bachelor', [])],
    ["Master's", parsed('master', [])],
    ["Master's Degree", parsed('master', [])],
    ['Master', parsed('master', [])],
    ['Doctorate', parsed('doctorate', [])],
    ["Associate's", parsed('associate', [])],
    ['Associate', parsed('associate', [])],
    ['Associate Degree', parsed('associate', [])],
    ['High School', parsed('highSchool', [])],
    ['High School Diploma', parsed('highSchool', ['HSD'])],
    ['High School Diploma or GED', parsed('highSchool', ['HSD', 'GED'])],
    ['BA/BS', parsed('bachelor', ['BA', 'BS'])],
    ['MA/MS', parsed('master', ['MA', 'MS'])],
    ['Doctorate (PhD, MD, JD)', parsed('doctorate', [], { qualifierTypes: ['PhD', 'MD', 'JD'] })],
    ['Other', parsed('other', [])],
  ])('%j', (text, expected) => {
    expect(parseDegree(text, vocab)).toEqual(expected);
  });
});

describe('parseDegree: punctuation-sensitive codes', () => {
  it.each<[string, DegreeType[]]>([
    ['M.Ed.', ['MEd']], ['MEd', ['MEd']], ['Med', ['MEd']], ['M. Ed.', ['MEd']], ['B.Sc.', ['BSc']],
    ['B.Sc', ['BSc']], ['Pharm.D.', ['PharmD']], ['LL.M.', ['LLM']], ['M.B.A.', ['MBA']], ['Ed.D.', ['EdD']],
    ['A.S.', ['AS']], ['AS', ['AS']], ['A.A.S.', ['AAS']], ['D.O.', ['DO']], ['DO', ['DO']], ['B.E.', ['BEng']],
    ['BE', ['BEng']], ['M.E.', ['MEng']], ['A.B.', ['BA']], ['S.B.', ['BS']], ['S.M.', ['MS']], ['DPhil', ['DPhil']],
  ])('%j reads as %j', (text, types) => {
    expect(parseDegree(text, vocab).types).toEqual(types);
  });

  it('never reads an English word as a code', () => {
    for (const text of ['as', 'do', 'be', 'me', 'am', 'ab', 'Medical', 'jobs', 'Some college']) {
      expect(parseDegree(text, vocab).types, text).toEqual([]);
    }
    expect(parseDegree('as soon as possible', vocab)).toEqual(parsed(undefined, []));
  });

  it('counts towards the 500-code-point cap only what is left once invisibles are deleted', () => {
    expect(parseDegree(`${'\u200B'.repeat(600)}B.S.`, vocab)).toEqual(parsed('bachelor', ['BS']));
    expect(parseDegree(`${'e\u0301'.repeat(400)} M.S.`, vocab).types).toEqual(['MS']);
  });

  it('lets the longest match win', () => {
    expect(parseDegree('Bachelor of Science in Nursing', vocab)).toEqual(parsed('bachelor', ['BSN']));
    expect(parseDegree('Associate of Applied Science', vocab).types).toEqual(['AAS']);
    expect(parseDegree('Master of Business Administration', vocab).types).toEqual(['MBA']);
    expect(parseDegree('Juris Doctor', vocab)).toEqual(parsed('professional', ['JD']));
    expect(parseDegree('Postgraduate Diploma', vocab)).toEqual(parsed('other', ['Diploma']));
  });
});

describe('parseDegree: fields and levels', () => {
  it.each<[string, DegreeType[], string]>([
    ['Bachelor of Science in Computer Science', ['BS'], 'Computer Science'],
    ['B.S. in Computer Science', ['BS'], 'Computer Science'],
    ['B.S. Computer Science', ['BS'], 'Computer Science'],
    ['BS - Computer Science', ['BS'], 'Computer Science'],
    ['Computer Science, B.S.', ['BS'], 'Computer Science'],
    ['MS in CS', ['MS'], 'CS'],
    ['Master of Arts in Teaching', ['MA'], 'Teaching'],
    ['Bachelor of Science in Computer Science and Engineering (Honours)', ['BS'], 'Computer Science and Engineering'],
  ])('%j names %j in %j', (text, types, field) => {
    const result = parseDegree(text, vocab);
    expect(result.types).toEqual(types);
    expect(result.field).toBe(field);
  });

  it('takes the field from the main text when only brackets name the degree', () => {
    expect(parseDegree('Computer Science (B.S.)', vocab))
      .toEqual({ level: 'bachelor', types: [], qualifierTypes: ['BS'], field: 'Computer Science' });
  });

  it('names a level-only degree with a field', () => {
    expect(parseDegree("Master's in Finance", vocab)).toEqual(parsed('master', [], { field: 'Finance' }));
    expect(parseDegree('MBA (Online)', vocab)).toEqual(parsed('professional', ['MBA']));
    expect(parseDegree("Bachelor's Degree", vocab).field).toBeUndefined();
  });

  it('gives the highest level a text names', () => {
    expect(parseDegree('BS/MS', vocab).level).toBe('master');
    expect(parseDegree('JD/PhD', vocab).level).toBe('doctorate');
    expect(DEGREE_LEVEL_RANK.doctorate).toBeGreaterThan(DEGREE_LEVEL_RANK.professional);
    expect(DEGREE_LEVEL_RANK.other).toBeLessThan(DEGREE_LEVEL_RANK.highSchool);
  });

  it('keeps the equivalence classes apart from the types (§4.9)', () => {
    expect(vocab.degrees.classOf('BSc')).toBe(vocab.degrees.classOf('BS'));
    expect(vocab.degrees.classOf('MSc')).toBe(vocab.degrees.classOf('MS'));
    expect(vocab.degrees.classOf('DPhil')).toBe(vocab.degrees.classOf('PhD'));
    expect(vocab.degrees.classOf('BA')).not.toBe(vocab.degrees.classOf('BS'));
    expect(vocab.degrees.classOf('BEng')).not.toBe(vocab.degrees.classOf('BS'));
  });
});

describe('canonicalDegree (§2.7)', () => {
  it.each<[string, DegreeLevel, DegreeType | undefined]>([
    ['BSc', 'bachelor', 'BSc'], ['B.S.', 'bachelor', 'BS'], ['Bachelor of Science', 'bachelor', 'BS'],
    ['Bachelors', 'bachelor', undefined], ["Bachelor's Degree", 'bachelor', undefined], ['BEng', 'bachelor', 'BEng'],
    ['PhD', 'doctorate', 'PhD'], ['Doctor of Philosophy', 'doctorate', 'PhD'], ['JD', 'professional', 'JD'],
    ['MBA', 'professional', 'MBA'], ['High School Diploma', 'highSchool', 'HSD'], ['BA', 'bachelor', 'BA'],
    ["Master's", 'master', undefined], ['Computer Science (B.S.)', 'bachelor', 'BS'],
  ])('the golden profile value %j is %s %s', (text, level, type) => {
    const { value, issues } = canonicalDegree({ text }, vocab);
    expect(value.level).toBe(level);
    expect(value.type).toBe(type);
    expect(value.userText).toBe(text);
    expect(issues).toEqual([]);
  });

  it('takes the field after "in" through CIP', () => {
    const { value, issues } = canonicalDegree({ text: 'B.S. in Computer Science' }, vocab);
    expect(value).toMatchObject({ level: 'bachelor', type: 'BS', field: { name: 'Computer Science', cip: '11.0701' } });
    expect(issues).toEqual([]);
  });

  it('prefers TailorIT’s level and type, read through the degree vocabulary', () => {
    expect(canonicalDegree({ level: 'master', type: 'MS', field: 'Computer Science', cip: '11.0701' }, vocab).value)
      .toEqual({ level: 'master', type: 'MS', field: expect.objectContaining({ cip: '11.0701' }), userText: 'MS' });
    expect(canonicalDegree({ level: 'bachelor', type: 'B.Sc.' }, vocab).value.type).toBe('BSc');
    expect(canonicalDegree({ type: 'bsc' }, vocab).value).toMatchObject({ level: 'bachelor', type: 'BSc' });
    expect(canonicalDegree({ level: 'other', type: 'MBA' }, vocab).value.level).toBe('professional');
    expect(canonicalDegree({ level: 'doctorate' }, vocab)).toEqual({ value: { level: 'doctorate', userText: '' }, issues: [] });
  });

  it('gives level other with degree-unparsed when nothing is understood', () => {
    expect(canonicalDegree({ text: 'Some college' }, vocab, 'education[1].degree')).toEqual({
      value: { level: 'other', userText: 'Some college' },
      issues: [{ path: 'education[1].degree', code: 'degree-unparsed' }],
    });
    expect(canonicalDegree({ level: 'other' }, vocab).issues).toEqual([]);
    expect(canonicalDegree({ level: 'master', type: 'Masters of Wizardry' }, vocab).issues)
      .toEqual([{ path: 'degree.type', code: 'degree-unparsed' }]);
  });

  it('reports a field the vocabulary does not know, with the field’s path', () => {
    const { value, issues } = canonicalDegree({ text: 'BA in Underwater Basket Weaving' }, vocab, 'education[0].degree');
    expect(value).toMatchObject({ level: 'bachelor', type: 'BA', field: { name: 'Underwater Basket Weaving', aliases: [] } });
    expect(issues).toEqual([{ path: 'education[0].degree.field', code: 'field-not-in-vocab' }]);
  });
});
