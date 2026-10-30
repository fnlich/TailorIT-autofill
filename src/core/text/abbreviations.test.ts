import { describe, expect, it } from 'vitest';
import {
  ABBREVIATIONS_ALL, ABBREVIATIONS_BY_CONTEXT, AMBIGUOUS_ST, expandAbbreviations, FIELD_WHOLE_VALUE, NEVER_EXPANDED,
  SAINT_NAMES, STATE_LIKE,
} from './abbreviations';
import { normalize, NORM_CONTEXTS, type NormContext } from './normalize';

const tokensOf = (text: string, context: NormContext) => normalize(text, context).tokens;

describe('abbreviations per context (§3.3)', () => {
  it.each<[NormContext, string, string[]]>([
    // Institution.
    ['institution', 'Univ of Michigan', ['university', 'of', 'michigan']],
    ['institution', 'Uni of Oxford', ['university', 'of', 'oxford']],
    ['institution', 'Unv. of Iowa', ['university', 'of', 'iowa']],
    ['institution', 'U of Michigan', ['university', 'of', 'michigan']],
    ['institution', 'U. of M.', ['university', 'of', 'm']],
    ['institution', 'U Mass', ['u', 'mass']],
    ['institution', 'Boston Coll', ['boston', 'college']],
    ['institution', 'Calif Inst of Tech', ['california', 'institute', 'of', 'technology']],
    ['institution', 'Sch of Visual Arts', ['school', 'of', 'visual', 'arts']],
    ['institution', 'Naval Acad', ['naval', 'academy']],
    ['institution', 'Georgia Tech', ['georgia', 'technology']],
    ['institution', 'Technological University Dublin', ['technology', 'university', 'dublin']],
    ['institution', 'Rensselaer Poly', ['rensselaer', 'polytechnic']],
    ['institution', 'Austin Cmty Coll', ['austin', 'community', 'college']],
    ['institution', 'Comm College', ['community', 'college']],
    ['institution', 'Jr. College', ['junior', 'college']],
    ['institution', 'Intl Univ', ['international', 'university']],
    ['institution', 'Natl Univ', ['national', 'university']],
    ['institution', 'Hlth Sci Ctr', ['health', 'science', 'center']],
    ['institution', 'Mt. Holyoke', ['mount', 'holyoke']],
    ['institution', 'Ft. Lewis College', ['fort', 'lewis', 'college']],
    ['institution', 'Mich State', ['michigan', 'state']],
    ['institution', 'Ariz State', ['arizona', 'state']],
    ['institution', 'Fla State', ['florida', 'state']],
    ['institution', 'Cal State', ['california', 'state']],
    ['institution', 'Cal Poly', ['california', 'polytechnic']],
    ['institution', 'Cal Polytechnic', ['california', 'polytechnic']],
    ['institution', 'Cal St', ['california', 'state']],
    ['institution', 'Cal Tech', ['cal', 'technology']],
    ['institution', 'Austin CC', ['austin', 'community', 'college']],
    ['institution', 'CC', ['cc']],
    ['institution', 'CC of Philadelphia', ['cc', 'of', 'philadelphia']],
    // Field.
    ['field', 'Comp Sci', ['computer', 'science']],
    ['field', 'Software Eng', ['software', 'engineering']],
    ['field', 'Civil Engg', ['civil', 'engineering']],
    ['field', 'Civil Engr', ['civil', 'engineering']],
    ['field', 'Mech Eng', ['mechanical', 'engineering']],
    ['field', 'Elec Eng', ['electrical', 'engineering']],
    ['field', 'Econ', ['economics']],
    ['field', 'Applied Math', ['applied', 'mathematics']],
    ['field', 'Maths', ['mathematics']],
    ['field', 'Stats', ['statistics']],
    ['field', 'Psych', ['psychology']],
    ['field', 'Marine Bio', ['marine', 'biology']],
    ['field', 'Biochem', ['biochemistry']],
    ['field', 'Business Mgmt', ['business', 'management']],
    ['field', 'Business Admin', ['business', 'administration']],
    ['field', 'Acct', ['accounting']],
    ['field', 'Fin', ['finance']],
    ['field', 'Mktg', ['marketing']],
    ['field', 'Info Sys', ['information', 'systems']],
    ['field', 'Chem Eng', ['chemical', 'engineering']],
    ['field', 'Chem. Engineering', ['chemical', 'engineering']],
    ['field', 'Chem', ['chemistry']],
    ['field', 'Organic Chem', ['organic', 'chemistry']],
    ['field', 'CS', ['computer', 'science']],
    ['field', 'C.S.', ['computer', 'science']],
    ['field', 'EE', ['electrical', 'engineering']],
    ['field', 'ECE', ['electrical', 'and', 'computer', 'engineering']],
    ['field', 'EECS', ['electrical', 'engineering', 'and', 'computer', 'science']],
    ['field', 'IT', ['information', 'technology']],
    ['field', 'PoliSci', ['political', 'science']],
    ['field', 'CS and Math', ['cs', 'and', 'mathematics']],
    ['field', 'IT Security', ['it', 'security']],
    // Address.
    ['address', '123 Main St', ['123', 'main', 'street']],
    ['address', 'St Paul Ave', ['st', 'paul', 'avenue']],
    ['address', 'Old Mill Rd', ['old', 'mill', 'road']],
    ['address', 'Sunset Blvd.', ['sunset', 'boulevard']],
    ['address', 'Apt 4B', ['apartment', '4b']],
    ['address', 'Ste 200', ['suite', '200']],
    // Each table stays in its context.
    ['field', 'Univ', ['univ']],
    ['institution', 'Comp', ['comp']],
    ['institution', 'Main Ave', ['main', 'ave']],
    ['label', 'St Paul St', ['st', 'paul', 'st']],
    ['answer', 'Tech', ['tech']],
  ])('%s: %j gives %j', (context, text, expected) => {
    expect(tokensOf(text, context)).toEqual(expected);
  });

  it.each(NORM_CONTEXTS)('%s reads the all-context spellings', (context) => {
    expect(tokensOf('Centre Programme Honours Organisation', context)).toEqual(['center', 'program', 'honors',
      'organization']);
  });
});

describe('the st rule (§3.3)', () => {
  it.each([
    ['Ohio St. University', ['ohio', 'state', 'university'], []],
    ['Ohio St', ['ohio', 'state'], []],
    ['Penn St', ['penn', 'state'], []],
    ['Mich St Univ', ['michigan', 'state', 'university'], []],
    ['New York St College', ['new', 'york', 'state', 'college'], []],
    ["St. John's University", ['saint', 'johns', 'university'], []],
    ['Washington University in St. Louis', ['washington', 'university', 'in', 'saint', 'louis'], []],
    ['St. Cloud State University', ['saint', 'cloud', 'state', 'university'], []],
    ["Mount St. Mary's", ['mount', 'saint', 'marys'], []],
    ['Boise St', ['boise', AMBIGUOUS_ST], [AMBIGUOUS_ST]],
    ['St. Augustine’s', [AMBIGUOUS_ST, 'augustines'], [AMBIGUOUS_ST]],
    ['Ohio St Buckeyes', ['ohio', AMBIGUOUS_ST, 'buckeyes'], [AMBIGUOUS_ST]],
  ])('%j gives %j', (text, tokens, ambiguous) => {
    const normalized = normalize(text, 'institution');
    expect(normalized.tokens).toEqual(tokens);
    expect(normalized.ambiguous).toEqual(ambiguous);
  });

  it('reads the saint names and state-like words from the design’s static lists', () => {
    expect(SAINT_NAMES).toHaveLength(59);
    expect(new Set(SAINT_NAMES).size).toBe(59);
    expect(SAINT_NAMES).toContain('louis');
    expect(STATE_LIKE).toHaveLength(49);
    for (const word of ['ohio', 'york', 'jersey', 'carolina', 'dakota', 'hampshire', 'mexico', 'virginia', 'island',
      'penn', 'cal']) expect(STATE_LIKE).toContain(word);
  });
});

describe('acronyms that collide are never expanded', () => {
  it.each(NORM_CONTEXTS)('%s leaves every one alone', (context) => {
    for (const acronym of NEVER_EXPANDED) {
      expect(expandAbbreviations([acronym], context).tokens, acronym).toEqual([acronym]);
      expect(expandAbbreviations(['x', acronym, 'y'], context).tokens, acronym).toEqual(['x', acronym, 'y']);
    }
  });

  it('keeps them out of every table', () => {
    const keys = [...ABBREVIATIONS_ALL.keys(), ...FIELD_WHOLE_VALUE.keys(),
      ...[...ABBREVIATIONS_BY_CONTEXT.values()].flatMap((table) => [...table.keys()])];
    for (const acronym of NEVER_EXPANDED) expect(keys, acronym).not.toContain(acronym);
  });

  it('marks the trailing cc as a generated spelling, and nothing else', () => {
    expect(expandAbbreviations(['austin', 'cc'], 'institution').generated).toBe(true);
    expect(expandAbbreviations(['cc'], 'institution').generated).toBe(false);
    expect(expandAbbreviations(['cc', 'austin'], 'institution').generated).toBe(false);
    expect(expandAbbreviations(['austin', 'cc'], 'field').generated).toBe(false);
  });
});
