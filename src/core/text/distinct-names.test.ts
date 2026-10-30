import { describe, expect, it } from 'vitest';
import { intendedInstitution, intendedText } from '../matcher/intended';
import { finalMatch, inputOf, vocab } from '../matcher/matcher.testkit';
import type { TiebreakRequest } from '../matcher/types';
import { canonicalInstitution } from '../profile/entities';
import type { IntendedValue } from '../types/intent';

// Names that one symbol, one particle or the head noun's place tells apart keep different keys (normalize.ts), so the
// matcher never fills one for the other at the exact stage, and the vocabulary never resolves one to the other.

const institution = (name: string): IntendedValue =>
  intendedInstitution(canonicalInstitution({ name }, vocab).value, vocab);
/** An LLM stub that picks `index` for every item. */
const picks = (index: number) => (request: TiebreakRequest) => ({
  answers: request.items.map((item) => ({ id: item.id, index })) });

describe('a closing "+", "#" or one-letter "-" tells answers apart', () => {
  it.each([
    ['C++', ['C', 'Java', 'Python']],
    ['C#', ['C', 'Java', 'Go']],
    ['C', ['C++', 'Java', 'Python']],
    ['F#', ['F', 'Haskell']],
    ['A+', ['A', 'B', 'C']],
    ['A-', ['A+', 'A', 'B']],
  ])('%j over %j fills nothing', async (value, labels) => {
    const { match } = await finalMatch(inputOf(intendedText(value), labels, 'generic'));
    expect(match).toMatchObject({ stage: 'none', optionIndex: null });
  });

  it('fills the option with the same symbol when the list has all three', async () => {
    const { match } = await finalMatch(inputOf(intendedText('C++'), ['C', 'C#', 'C++', 'Java'], 'generic'));
    expect(match).toMatchObject({ stage: 'exact', optionIndex: 2, confidence: 1, flags: [] });
    const minus = await finalMatch(inputOf(intendedText('A-'), ['A+', 'A', 'A-', 'B'], 'generic'));
    expect(minus.match).toMatchObject({ stage: 'exact', optionIndex: 2, confidence: 1 });
  });
});

describe('a name particle of another language tells schools apart', () => {
  it.each([
    ['De La Salle University', 'La Salle University'],
    ['Cal State', 'California State University-Los Angeles'],
    ['IICT', 'Dhirubhai Ambani University'],
    ['Southeastern LA University', 'Southeastern University'],
    ['Valley College', 'Los Angeles Valley College'],
    ['West College', 'West Los Angeles College'],
    ['Film School', 'Los Angeles Film School'],
    ['University of Monroe', 'University of Louisiana at Monroe'],
  ])('%j does not resolve to %j', (name, other) => {
    const { value, issues } = canonicalInstitution({ name }, vocab);
    expect(value.canonicalName).not.toBe(other);
    expect(value).toMatchObject({ source: 'user', canonicalName: name });
    expect(issues.map((issue) => issue.code)).toEqual(['institution-not-in-vocab']);
  });

  it('still resolves the spellings that do name a school', () => {
    expect(canonicalInstitution({ name: 'Cal State LA' }, vocab).value.canonicalName)
      .toBe('California State University-Los Angeles');
    // Other schools outside the bundled subset share the bare name (vocab-build's collisions), so it needs a place.
    expect(canonicalInstitution({ name: 'La Salle University', location: { region: 'PA', country: 'US' } }, vocab)
      .value.ids).toEqual({ ipeds: '213367' });
    const bare = canonicalInstitution({ name: 'La Salle University' }, vocab);
    expect(bare.value).toMatchObject({ source: 'user', ids: {} });
    expect(bare.issues.map((issue) => issue.code)).toEqual(['institution-ambiguous']);
    expect(canonicalInstitution({ name: 'Dhirubhai Ambani Institute of Information and Communication Technology' },
      vocab).value.canonicalName).toBe('Dhirubhai Ambani University');
    // An acronym only ROR gives is never settled by itself (S1a), so DA-IICT keeps the person's own text.
    const acronym = canonicalInstitution({ name: 'DA-IICT' }, vocab);
    expect(acronym.value).toMatchObject({ source: 'user', canonicalName: 'DA-IICT' });
    expect(acronym.issues.map((issue) => issue.code)).toEqual(['institution-ambiguous']);
    expect(canonicalInstitution({ name: 'LA Tech' }, vocab).value.canonicalName).toBe('Louisiana Tech University');
  });

  it.each<[string, string[]]>([
    ['De La Salle University', ['La Salle University', 'Ateneo de Manila University',
      'University of the Philippines Diliman']],
    ['La Salle University', ['De La Salle University', 'Ateneo de Manila University',
      'University of the Philippines Diliman']],
    ['IICT', ['Dhirubhai Ambani University', 'Indian Institute of Chemical Technology', 'Osmania University']],
    ['Southeastern LA University', ['Southeastern University', 'Southeastern Louisiana University',
      'Louisiana State University']],
    ['Cal State', ['California State University-Los Angeles', 'California State University-Fullerton',
      'California State University-Long Beach']],
  ])('%j over %j fills nothing by itself', async (name, labels) => {
    const { match } = await finalMatch(inputOf(institution(name), labels, 'institution'));
    expect(match).toMatchObject({ stage: 'none', optionIndex: null });
  });
});

describe('"University at X" is the "University of X" form', () => {
  it.each([
    ['University at Buffalo', ['SUNY Buffalo State University']],
    ['University at Albany', ['Albany State University']],
  ])('%j never takes %j, not even from the LLM', async (name, labels) => {
    const { match, requests } = await finalMatch(inputOf(institution(name), labels, 'institution'), picks(0));
    expect(match).toMatchObject({ stage: 'none', optionIndex: null, reason: 'distinctive-token-mismatch' });
    expect(requests).toEqual([]);
  });

  it('still fills its own name', async () => {
    const { match } = await finalMatch(inputOf(institution('University at Buffalo'),
      ['SUNY Buffalo State University', 'University at Buffalo'], 'institution'));
    expect(match).toMatchObject({ stage: 'exact', optionIndex: 1, confidence: 1 });
  });
});
