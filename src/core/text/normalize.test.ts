import { describe, expect, it } from 'vitest';
import {
  keyWithBrackets, normalize, normalizeLabel, NORM_CONTEXTS, NORMALIZER_VERSION, type NormContext,
} from './normalize';

describe('normalize: the result (§3.2)', () => {
  it('is version 3, over the design’s contexts', () => {
    expect(NORMALIZER_VERSION).toBe(3);
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
    // The head noun before "at", or first in the name, is the "University of X" form too.
    ['University at Buffalo', 'institution', 'pre'],
    ['The University at Albany', 'institution', 'pre'],
    ['College at Brockport', 'institution', 'pre'],
    ['University College London', 'institution', 'pre'],
    ['SUNY Buffalo State University', 'institution', 'post'],
    ['Albany State University', 'institution', 'post'],
  ])('%j (%s) is %s', (text, context, headForm) => {
    expect(normalize(text, context).headForm).toBe(headForm);
  });
});

describe('keys that keep apart names a symbol, a particle or a place code tells apart', () => {
  it.each<[NormContext, string, string]>([
    ['answer', 'C++', 'C'],
    ['answer', 'C#', 'C'],
    ['answer', 'C++', 'C#'],
    ['answer', 'F#', 'F'],
    ['answer', 'A+', 'A'],
    ['answer', 'A-', 'A'],
    ['answer', 'A+', 'A-'],
    ['label', 'Years of C++ experience', 'Years of C experience'],
    ['label', 'Years of C# experience', 'Years of C++ experience'],
    ['institution', 'De La Salle University', 'La Salle University'],
    ['institution', 'Cal State LA', 'Cal State'],
    ['institution', 'DA-IICT', 'IICT'],
    ['institution', 'Southeastern LA University', 'Southeastern University'],
    ['institution', 'West LA College', 'West College'],
    ['institution', 'Babu Banarasi Das University', 'Babu Banarasi University'],
    ['institution', 'Western University, London ON', 'Western University, London'],
  ])('%s: %j and %j keep different keys', (context, a, b) => {
    expect(normalize(a, context).key).not.toBe(normalize(b, context).key);
  });

  it('reads an institution’s trailing ", IN" as a bracketed place, out of the key but in the full key', () => {
    for (const text of ['Purdue University Fort Wayne, IN', 'PURDUE UNIVERSITY FORT WAYNE, IN',
      'Purdue University Fort Wayne - IN']) {
      const norm = normalize(text, 'institution');
      expect(norm.key, text).toBe('purdue university fort wayne');
      expect(norm.qualifiers, text).toEqual([{ text: 'in', tokens: ['in'] }]);
      expect(keyWithBrackets(text, 'institution'), text).toBe('purdue university fort wayne in');
    }
    expect(keyWithBrackets('University of Toronto, ON', 'institution')).toBe('university toronto on');
    expect(keyWithBrackets('Purdue University Fort Wayne', 'institution')).toBe('purdue university fort wayne');
    // Lower case is a word, and a code that is not last, or not after a comma or dash, is no trailing place.
    expect(normalize('College of Arts, in Paris', 'institution').qualifiers).toEqual([]);
    expect(normalize('University of NJ', 'institution').qualifiers).toEqual([]);
    expect(normalize('Purdue University Fort Wayne, IN', 'answer').qualifiers).toEqual([]);
  });

  it('keeps a place code only when it is written in capitals among lower-case letters', () => {
    expect(normalize('Western University, London ON', 'institution').core).toContain('on');
    expect(normalize('WESTERN UNIVERSITY, LONDON ON', 'institution').core).not.toContain('on');
    expect(normalize('Washington University In St. Louis', 'institution').key)
      .toBe(normalize('Washington University in St. Louis', 'institution').key);
    expect(normalize('Purdue University Fort Wayne, IN', 'answer').core).toContain('in');
  });

  it.each([
    'Bachelor`s', 'Bachelor\u00B4s', 'Bachelor\u2018s', 'Bachelor\u2019s', 'Bachelor\u201Bs', 'Bachelor\u02B9s',
    'Bachelor\u02BBs', 'Bachelor\u02BCs', 'Bachelor\u2032s', 'Bachelor\uFF07s',
  ])('reads the mark in %j as the apostrophe of "Bachelor\'s"', (text) => {
    expect(normalize(text, 'degree').key).toBe(normalize("Bachelor's", 'degree').key);
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
