import { describe, expect, it } from 'vitest';
import { NORM_CONTEXTS, type NormContext } from './normalize';
import { DEGREE_LEVEL_PLURALS, removeStopwords, STOPWORDS, tokenize } from './tokens';

describe('tokenize: normalization steps 7 to 12', () => {
  it.each([
    // Step 7: dotted abbreviations; a dot between letters goes, a dot between digits stays.
    ['b.s.', ['bs']],
    ['ph.d.', ['phd']],
    ['u.s.a.', ['usa']],
    ['u. s. a.', ['usa']],
    ['gpa 3.85', ['gpa', '3.85']],
    ['m.b.a.', ['mba']],
    ['b.sc. (hons)', ['bsc', 'hons']],
    ['e.g. i.e.', ['eg', 'ie']],
    ['washington, d.c.', ['washington', 'dc']],
    ['ph.d. m.d.', ['phd', 'md']],
    ['b.s. m.s.', ['bs', 'ms']],
    ['j. k. rowling', ['jk', 'rowling']],
    ['node.js', ['nodejs']],
    // Step 8: apostrophes.
    ["bachelor's", ['bachelors']],
    ["st. john's", ['st', 'johns']],
    ['master’s ‘quoted’ hawaiʼi', ['masters', 'quoted', 'hawaii']],
    // Steps 9 and 10: ampersands.
    ['a & m', ['a&m']],
    ['a&t', ['a&t']],
    ['texas a & m university', ['texas', 'a&m', 'university']],
    ['a & b & c', ['a&b&c']],
    ['arts & sciences', ['arts', 'and', 'sciences']],
    ['at&t', ['at', 'and', 't']],
    ['r&d/qa', ['r&d', 'qa']],
    // Step 11: punctuation and symbols.
    ['ut-austin', ['ut', 'austin']],
    ['ut – austin — tx', ['ut', 'austin', 'tx']],
    ['c++ / c#', ['c', 'c']],
    ['$100,000', ['100', '000']],
    ['first_name*', ['first', 'name']],
    ['why? because!', ['why', 'because']],
    // Step 12: spaces.
    ['  many   spaces\n\there ', ['many', 'spaces', 'here']],
    ['control\u0001char', ['control', 'char']],
    ['', []],
    ['--', []],
  ])('%j gives %j', (input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });
});

describe('removeStopwords: normalization step 14', () => {
  it.each<[NormContext, string[], string[]]>([
    ['institution', ['the', 'university', 'of', 'texas', 'at', 'austin'], ['university', 'texas', 'austin']],
    ['institution', ['universidad', 'de', 'los', 'andes'], ['universidad', 'andes']],
    ['institution', ['universidade', 'do', 'porto'], ['universidade', 'porto']],
    ['institution', ['ecole', 'des', 'ponts'], ['ecole', 'ponts']],
    ['field', ['arts', 'and', 'sciences'], ['arts', 'sciences']],
    ['field', ['science', 'in', 'engineering'], ['science', 'engineering']],
    ['degree', ['bachelor', 'of', 'science', 'in', 'nursing'], ['bachelor', 'science', 'nursing']],
    ['degree', ['masters', 'degree'], ['master']],
    ['degree', ['bachelors'], ['bachelor']],
    ['degree', ['associates'], ['associate']],
    ['degree', ['doctorates'], ['doctorate']],
    ['country', ['the', 'bahamas'], ['bahamas']],
    ['country', ['korea', 'republic', 'of'], ['korea', 'republic']],
    ['country', ['bosnia', 'and', 'herzegovina'], ['bosnia', 'herzegovina']],
    ['region', ['district', 'of', 'columbia'], ['district', 'columbia']],
    ['answer', ['the', 'company', 'website'], ['company', 'website']],
    ['answer', ['of', 'course'], ['of', 'course']],
    ['label', ['the', 'name', 'of', 'the', 'school'], ['the', 'name', 'of', 'the', 'school']],
    ['address', ['the', 'mall'], ['the', 'mall']],
  ])('%s: %j gives %j', (context, tokens, expected) => {
    expect(removeStopwords(tokens, context)).toEqual(expected);
  });

  it.each<[NormContext, string[]]>([['institution', ['the']], ['degree', ['degree']], ['country', ['the', 'of']],
    ['answer', ['the']]])('%s keeps %j when removal would leave nothing', (context, tokens) => {
    expect(removeStopwords(tokens, context)).toEqual(tokens);
  });

  it('has the design’s stopword lists for every context', () => {
    expect(Object.keys(STOPWORDS).sort()).toEqual([...NORM_CONTEXTS].sort());
    expect([...STOPWORDS.institution]).toEqual(['the', 'of', 'at', 'and', 'in', 'for', 'a', 'an', 'on', 'de', 'del',
      'della', 'des', 'di', 'du', 'da', 'do', 'dos', 'das', 'la', 'le', 'les', 'el', 'los', 'und', 'y']);
    expect([...STOPWORDS.field]).toEqual([...STOPWORDS.institution]);
    expect([...STOPWORDS.degree]).toEqual(['the', 'of', 'in', 'and', 'a', 'an', 'degree']);
    expect([...STOPWORDS.country]).toEqual(['the', 'of', 'and']);
    expect([...STOPWORDS.region]).toEqual(['the', 'of', 'and']);
    expect([...STOPWORDS.answer]).toEqual(['the']);
    expect(STOPWORDS.label.size).toBe(0);
    expect([...DEGREE_LEVEL_PLURALS.keys()]).toEqual(['associates', 'bachelors', 'masters', 'doctorates']);
  });
});
