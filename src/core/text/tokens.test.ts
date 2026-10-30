import { describe, expect, it } from 'vitest';
import { NORM_CONTEXTS, type NormContext } from './normalize';
import {
  DEGREE_LEVEL_PLURALS, NAME_PARTICLES, PLACE_CODE_STOPWORDS, removeStopwords, STOPWORDS, tokenize,
} from './tokens';

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
    ['bachelor`s', ['bachelors']],
    ['bachelor\u00B4s bachelor\u201Bs bachelor\u02B9s', ['bachelors', 'bachelors', 'bachelors']],
    ['hawai\u02BBi bachelor\u2032s bachelor\uFF07s', ['hawaii', 'bachelors', 'bachelors']],
    ['master’s ‘quoted’ hawai\u02BCi', ['masters', 'quoted', 'hawaii']],
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
    // Step 11: a word's closing "+" or "#", and a one-letter word's closing "-", stay in the word.
    ['c++ / c#', ['c++', 'c#']],
    ['f# and c', ['f#', 'and', 'c']],
    ['notepad++', ['notepad++']],
    ['grade a+ or a-', ['grade', 'a+', 'or', 'a-']],
    ['a-/b+', ['a-', 'b+']],
    ['c#.net', ['c#', 'net']],
    // ...but not inside a word, after a digit, standing alone, or with a space before the hyphen.
    ['java+spring', ['java', 'spring']],
    ['10+ years', ['10', 'years']],
    ['+1 555 0100', ['1', '555', '0100']],
    ['#1 choice', ['1', 'choice']],
    ['apt#5', ['apt', '5']],
    ['c++11', ['c', '11']],
    ['c+++x', ['c', 'x']],
    ['option a - other', ['option', 'a', 'other']],
    ['option a-other', ['option', 'a', 'other']],
    ['type-a', ['type', 'a']],
    ['pre- and post-', ['pre', 'and', 'post']],
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
    // The particles that begin names in other languages are part of the name: "De La Salle" is not "La Salle".
    ['institution', ['de', 'la', 'salle', 'university'], ['de', 'la', 'salle', 'university']],
    ['institution', ['universidad', 'de', 'los', 'andes'], ['universidad', 'de', 'los', 'andes']],
    ['institution', ['universidade', 'do', 'porto'], ['universidade', 'do', 'porto']],
    ['institution', ['babu', 'banarasi', 'das', 'university'], ['babu', 'banarasi', 'das', 'university']],
    ['institution', ['the', 'university', 'of', 'da', 'nang'], ['university', 'da', 'nang']],
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

  it('never removes a token it is told to keep', () => {
    expect(removeStopwords(['purdue', 'university', 'fort', 'wayne', 'in'], 'institution', new Set(['in'])))
      .toEqual(['purdue', 'university', 'fort', 'wayne', 'in']);
    expect(removeStopwords(['purdue', 'university', 'fort', 'wayne', 'in'], 'institution'))
      .toEqual(['purdue', 'university', 'fort', 'wayne']);
    expect(PLACE_CODE_STOPWORDS.every((word) => STOPWORDS.institution.has(word))).toBe(true);
  });

  it('has the design’s stopword lists for every context', () => {
    expect(Object.keys(STOPWORDS).sort()).toEqual([...NORM_CONTEXTS].sort());
    expect([...STOPWORDS.institution]).toEqual(['the', 'of', 'at', 'and', 'in', 'for', 'a', 'an', 'on']);
    expect(PLACE_CODE_STOPWORDS).toEqual(['in', 'on']);
    expect([...STOPWORDS.field]).toEqual([...STOPWORDS.institution]);
    expect([...STOPWORDS.degree]).toEqual(['the', 'of', 'in', 'and', 'a', 'an', 'degree']);
    expect([...STOPWORDS.country]).toEqual(['the', 'of', 'and']);
    expect([...STOPWORDS.region]).toEqual(['the', 'of', 'and']);
    expect([...STOPWORDS.answer]).toEqual(['the']);
    expect(STOPWORDS.label.size).toBe(0);
    expect([...DEGREE_LEVEL_PLURALS.keys()]).toEqual(['associates', 'bachelors', 'masters', 'doctorates']);
  });

  it('lists the name particles it keeps, none of them a stopword in any context', () => {
    expect(NAME_PARTICLES).toEqual(['de', 'del', 'della', 'des', 'di', 'du', 'da', 'do', 'dos', 'das', 'la', 'le', 'les',
      'el', 'los', 'und', 'y']);
    for (const context of NORM_CONTEXTS) {
      expect(NAME_PARTICLES.filter((particle) => STOPWORDS[context].has(particle)), context).toEqual([]);
    }
  });
});
