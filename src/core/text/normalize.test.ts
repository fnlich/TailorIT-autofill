import { describe, expect, it } from 'vitest';
import { normalize, normalizeLabel, NORM_CONTEXTS, NORMALIZER_VERSION, type NormContext } from './normalize';

describe('normalize: the result (§3.2)', () => {
  it('is version 1, over the design’s contexts', () => {
    expect(NORMALIZER_VERSION).toBe(1);
    expect(NORM_CONTEXTS).toEqual(['institution', 'degree', 'field', 'country', 'region', 'answer', 'label',
      'address']);
  });

  it('fills every field', () => {
    expect(normalize('The University of Texas at Austin (Main Campus)', 'institution')).toEqual({
      folded: 'the university of texas at austin',
      tokens: ['the', 'university', 'of', 'texas', 'at', 'austin'],
      core: ['university', 'texas', 'austin'],
      key: 'university texas austin',
      compact: 'universitytexasaustin',
      qualifiers: [{ text: 'main campus', tokens: ['main', 'campus'] }],
      ambiguous: [],
      headForm: 'pre',
      generated: false,
    });
  });

  it.each(NORM_CONTEXTS)('%s: key is core joined, compact drops its spaces, core is never emptied', (context) => {
    for (const text of ['The', 'Degree', 'Of the', 'Linked In', 'University of Texas at Austin', '', '(optional)']) {
      const normalized = normalize(text, context);
      expect(normalized.key).toBe(normalized.core.join(' '));
      expect(normalized.compact).toBe(normalized.key.replace(/ /g, ''));
      if (normalized.tokens.length > 0) expect(normalized.core.length).toBeGreaterThan(0);
    }
  });
});

describe('normalize: the steps of §3.1, by the design’s examples', () => {
  it.each<[string, NormContext, string]>([
    ['UT\u200B Austin', 'institution', 'ut austin'],
    ['Łódź', 'region', 'lodz'],
    ['Montréal', 'region', 'montreal'],
    ['Texas at Austin, University of', 'institution', 'university of texas at austin'],
    ['Texas at Austin, The University of', 'institution', 'university of texas at austin'],
    ['Charleston, College of', 'institution', 'college of charleston'],
    ['Computer Science (B.S.)', 'field', 'computer science'],
    ['B.S.', 'degree', 'bs'],
    ['Ph.D.', 'degree', 'phd'],
    ['U.S.A.', 'country', 'usa'],
    ['GPA 3.85', 'label', 'gpa 3.85'],
    ["Bachelor's", 'degree', 'bachelors'],
    ["St. John's", 'label', 'st johns'],
    ['A & M', 'institution', 'a&m'],
    ['A&T', 'institution', 'a&t'],
    ['Arts & Sciences', 'field', 'arts and sciences'],
    ['UT-Austin', 'institution', 'ut austin'],
  ])('%j (%s) folds to %j', (text, context, folded) => {
    expect(normalize(text, context).folded).toBe(folded);
  });

  it('inverts only in the institution context', () => {
    expect(normalize('Texas at Austin, University of', 'label').folded).toBe('texas at austin university of');
    expect(normalize('University of California, Los Angeles', 'institution').folded)
      .toBe('university of california los angeles');
  });

  it('removes stopwords from core: "the university of texas at austin" is "university texas austin"', () => {
    expect(normalize('the university of texas at austin', 'institution').core)
      .toEqual(['university', 'texas', 'austin']);
  });
});

describe('parentheticals are qualifiers, kept out of the key (§3.4)', () => {
  it.each<[string, NormContext, string, Array<{ text: string; tokens: string[] }>]>([
    ['Computer Science (B.S.)', 'field', 'computer science', [{ text: 'b.s.', tokens: ['bs'] }]],
    ['University of Texas (Austin)', 'institution', 'university texas', [{ text: 'austin', tokens: ['austin'] }]],
    ['University of Texas (Dallas)', 'institution', 'university texas', [{ text: 'dallas', tokens: ['dallas'] }]],
    ['Doctorate (PhD, MD, JD)', 'degree', 'doctorate', [{ text: 'phd, md, jd', tokens: ['phd', 'md', 'jd'] }]],
    ['Penn State (Main Campus)', 'institution', 'penn state', [{ text: 'main campus', tokens: ['main', 'campus'] }]],
    ['MBA (Online)', 'degree', 'mba', [{ text: 'online', tokens: ['online'] }]],
    ['Other (please specify)', 'answer', 'other', [{ text: 'please specify', tokens: ['please', 'specify'] }]],
    ['University of Texas at Austin (UT Austin)', 'institution', 'university texas austin',
      [{ text: 'ut austin', tokens: ['ut', 'austin'] }]],
    ['Washington University (St. Louis)', 'institution', 'washington university',
      [{ text: 'st. louis', tokens: ['saint', 'louis'] }]],
    ['Austin [CC]', 'institution', 'austin', [{ text: 'cc', tokens: ['cc'] }]],
    ['Option (-)', 'answer', 'option', []],
  ])('%j (%s): key %j, qualifiers %j', (text, context, key, qualifiers) => {
    const normalized = normalize(text, context);
    expect(normalized.key).toBe(key);
    expect(normalized.qualifiers).toEqual(qualifiers);
  });
});

describe('what the golden table needs from normalization (§6)', () => {
  it.each<[NormContext, string, string]>([
    ['institution', 'The University of Texas at Austin', 'University of Texas - Austin'],
    ['institution', 'The University of Texas at Austin', 'Texas at Austin, University of'],
    ['institution', 'UT Austin', 'UT-Austin'],
    ['institution', 'University of Texas at Austin (UT Austin)', 'University of Texas at Austin'],
    ['institution', 'Texas A&M University', 'Texas A & M University'],
    ['institution', 'Washington University in St. Louis', 'Washington University in St Louis'],
    ['institution', 'Ohio State University', 'The Ohio State University'],
    ['institution', 'Ohio State University', 'Ohio St. University'],
    ['degree', 'Bachelors', "Bachelor's"],
    ['degree', "Bachelor's", "Bachelor's Degree"],
    ['degree', "Master's Degree", 'Masters'],
    ['field', 'CS', 'Computer Science'],
    ['field', 'Mech. Engineering', 'Mechanical Engineering'],
    ['country', 'United States', 'the United States'],
  ])('%s: %j has the key of %j', (context, a, b) => {
    expect(normalize(a, context).key).toBe(normalize(b, context).key);
  });

  it.each<[NormContext, string, string]>([
    ['institution', 'Northeastern University', 'Northwestern University'],
    ['institution', 'The University of Texas at Austin', 'The University of Texas at Dallas'],
    ['institution', 'Georgia State University', 'Georgia Institute of Technology'],
    ['institution', 'Boston University', 'Boston College'],
    ['institution', 'Texas A&M University', 'Texas State University'],
    ['answer', 'Option B', 'Option A'],
    ['region', 'Washington', 'Washington, D.C.'],
    ['region', 'Virginia', 'West Virginia'],
    ['country', 'Niger', 'Nigeria'],
  ])('%s: %j and %j keep different keys', (context, a, b) => {
    expect(normalize(a, context).key).not.toBe(normalize(b, context).key);
  });

  it('gives "Linked In" and "LinkedIn" one compact form', () => {
    expect(normalize('Linked In', 'answer').compact).toBe(normalize('LinkedIn', 'answer').compact);
  });
});

describe('the institution head noun (§4.5)', () => {
  it.each<[string, NormContext, 'pre' | 'post' | 'none']>([
    ['University of Washington', 'institution', 'pre'],
    ['Washington University in St. Louis', 'institution', 'post'],
    ['University of Miami', 'institution', 'pre'],
    ['Miami University', 'institution', 'post'],
    ['Boston University', 'institution', 'post'],
    ['University of Massachusetts Boston', 'institution', 'pre'],
    ['Texas at Austin, University of', 'institution', 'pre'],
    ['Massachusetts Institute of Technology', 'institution', 'pre'],
    ['Boston College', 'institution', 'post'],
    ['Univ of Michigan', 'institution', 'pre'],
    ['Georgia Tech', 'institution', 'none'],
    ['UT Austin', 'institution', 'none'],
    ['University of Washington', 'label', 'none'],
  ])('%j (%s) is %s', (text, context, headForm) => {
    expect(normalize(text, context).headForm).toBe(headForm);
  });
});

describe('normalizeLabel', () => {
  it.each([
    ['First name (required)', 'first name'],
    ['First Name *', 'first name'],
    ['Email Address', 'email address'],
    ['E-mail', 'e mail'],
    ['LinkedIn Profile URL', 'linkedin profile url'],
    ['Are you legally authorized to work in the U.S.?', 'are you legally authorized to work in the us'],
    ['Will you require H-1B sponsorship?', 'will you require h 1b sponsorship'],
    ['The name of your Organisation', 'the name of your organization'],
    ['How did you hear about us? (select one)', 'how did you hear about us'],
    ['Zip/Postal Code', 'zip postal code'],
    ['', ''],
  ])('%j gives %j', (label, expected) => {
    expect(normalizeLabel(label)).toBe(expected);
  });
});
