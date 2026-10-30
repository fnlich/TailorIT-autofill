import { describe, expect, it } from 'vitest';
import { FILL_AT, LABEL_RULE_CONFIDENCE } from '../confidence';
import { intendedAnswer, intendedBoolean, intendedDecline, intendedField, intendedInstitution } from '../matcher/intended';
import { finalMatch, inputOf, vocab } from '../matcher/matcher.testkit';
import type { MatchDomain, TiebreakRequest } from '../matcher/types';
import { canonicalField, canonicalInstitution, type PlaceInput } from '../profile/entities';
import type { IntendedValue } from '../types/intent';

// The vocabulary's names, end to end through the canonicalizers and the matcher: a short form or a name several
// institutions answer to never fills one of them, a bare system name fills its campus only as a flagged flagship,
// the guard's place and discipline words keep look-alike schools and fields apart, and a decline is a decline.

const institution = (name: string, location?: PlaceInput): IntendedValue =>
  intendedInstitution(canonicalInstitution({ name, ...(location ? { location } : {}) }, vocab).value, vocab);
/** An LLM stub that picks the first candidate of every item: a hard conflict must never reach it. */
const pickFirst = (request: TiebreakRequest) => ({ answers: request.items.map((item) => ({ id: item.id, index: 0 })) });
const run = (intended: IntendedValue, labels: string[], domain: MatchDomain = 'institution',
  stub?: (request: TiebreakRequest) => unknown) => finalMatch(inputOf(intended, labels, domain), stub);

describe('a short form or shared name fills no institution by itself', () => {
  it.each<[string, string[]]>([
    ['UNH', ['University of New Hampshire-Main Campus', 'University of New Haven', 'Southern New Hampshire University']],
    ['UT', ['The University of Texas at Austin', 'Utah Tech University', 'University of Utah']],
    ['EMU', ['Eastern Michigan University', 'Eastern Mennonite University', 'Emory University']],
    ['OSU', ['The Ohio State University', 'Oregon State University', 'Olabisi Onabanjo University']],
    ['U of M', ['University of Minnesota-Twin Cities', 'University of Michigan-Ann Arbor']],
    ['U of D', ['University of Delaware', 'University of Dayton', 'University of Detroit Mercy']],
    ['U of P', ['University of Portland', 'University of the Pacific', 'University of Pennsylvania']],
    ['Cal Poly', ['California State Polytechnic University-Pomona', 'California Polytechnic State University-San Luis Obispo',
      'Cal Poly Humboldt']],
    ['CMU', ['Central Michigan University', 'Carnegie Mellon University']],
    ['UMD', ['University of Minnesota-Duluth', 'University of Maryland-College Park']],
    ['Southern University', ['Southern University and A&M College', 'Southern University Bangladesh',
      'Georgia Southern University']],
    ['Indian Institute of Technology (Bombay)', ['Indian Institute of Technology Delhi', 'Indian Institute of Technology BHU',
      'Indian Institute of Technology Madras']],
    ['National Institute of Technology', ['National Institute of Technology Tiruchirappalli',
      'Maulana Azad National Institute of Technology', 'National Institute of Technology Karnataka']],
    ['Central Florida', ['University of Central Florida', 'College of Central Florida', 'Florida State University']],
    ['Concordia University', ['Concordia University-Irvine', 'Concordia University (Montreal)', 'Concordia University-Chicago']],
    ['Minnesota State', ['Minnesota State University-Mankato', 'Minnesota State University Moorhead',
      'Minnesota State Colleges and Universities System Office']],
  ])('%j over %j', async (name, labels) => {
    const { match } = await run(institution(name), labels);
    expect(match).toMatchObject({ stage: 'none', optionIndex: null });
  });

  it('fills a short form the person spelled out in an alias', async () => {
    const intended = intendedInstitution(canonicalInstitution({ name: 'UT', aliases: ['The University of Texas at Austin'] },
      vocab).value, vocab);
    const { match } = await run(intended, ['The University of Texas at Austin', 'Utah Tech University']);
    expect(match).toMatchObject({ optionIndex: 0, stage: 'exact' });
  });
});

describe('a name a ROR record outside the subset shares waits for the location', () => {
  const labels = ['Heidelberg University (Ohio)', 'Heidelberg University (Germany)'];

  it('fills nothing without one, or with a location the bundled school is not in', async () => {
    for (const location of [undefined, { country: 'DE' }]) {
      const { match } = await run(institution('Heidelberg University', location), labels);
      expect(match.optionIndex, JSON.stringify(location)).toBeNull();
    }
  });

  it('fills the school the location names', async () => {
    const { match } = await run(institution('Heidelberg University', { region: 'OH', country: 'US' }), labels);
    expect(match).toMatchObject({ optionIndex: 0, stage: 'exact' });
  });
});

describe('a bare system name fills a campus only as a flagged flagship', () => {
  it.each<[string, string[], number]>([
    ['University of Michigan-Ann Arbor', ['University of Michigan', 'University of Michigan-Dearborn',
      'Michigan State University'], 0],
    ['Texas A&M University-College Station', ['Texas A&M University', 'Texas A&M University-Kingsville'], 0],
    ['The University of Texas at Austin', ['University of Texas', 'Texas State University'], 0],
  ])('%j over %j takes the flagship at 0.90, flagged', async (name, labels, index) => {
    const { match } = await run(institution(name), labels);
    expect(match).toMatchObject({ optionIndex: index, stage: 'alias', rule: 'flagship', confidence: 0.9 });
    expect(LABEL_RULE_CONFIDENCE.normal * match.confidence).toBeLessThan(FILL_AT);
  });

  it.each<[string, string[]]>([
    ['University of Colorado', ['University of Colorado Boulder', 'University of Colorado Denver/Anschutz Medical Campus']],
    ['Louisiana State University', ['Louisiana State University and Agricultural & Mechanical College',
      'Louisiana State University-Shreveport']],
    ['University of Oklahoma', ['University of Oklahoma-Norman Campus', 'University of Oklahoma-Health Sciences Center']],
    ['Arizona State University', ['Arizona State University Campus Immersion', 'Arizona State University Digital Immersion']],
    ['Texas A&M', ['Texas A&M University-College Station', 'Texas A&M University-Kingsville']],
  ])('%j, no flagship, fills none of %j', async (name, labels) => {
    const { match } = await run(institution(name), labels);
    expect(match.optionIndex).toBeNull();
  });
});

describe('the guard keeps look-alike names apart, even from an LLM that would pick them', () => {
  it.each<[string, string[]]>([
    // A state's other spellings ("New York State", "Washington State") are no fact of its schools.
    ['University at Albany', ['Albany State University']],
    ['Gonzaga University', ['Washington State University']],
    ['University of Washington', ['Washington State']],
    ['Cornell University', ['Penn State University']],
    // Cities of every ROR candidate, and the exonyms, are place words.
    ['Universidad Autonoma de Madrid', ['Universidad Autonoma de Barcelona', 'Universidad Autonoma de Guadalajara']],
    ['Kyoto University', ['Osaka University', 'Nagoya University']],
    ['University of Zurich', ['University of Basel']],
    ['University of Toronto', ['University of Toronto (Mississauga)', 'University of Toronto (Scarborough)']],
    ['Technical University of Munich', ['Technical University of Munich (Heilbronn)']],
    // A run-together alias list no longer lends Regis University another school's head noun or words.
    ['Regis University', ['Regis College', 'Colorado Business College']],
  ])('%j picks none of %j', async (name, labels) => {
    const { match, requests } = await run(institution(name), labels, 'institution', pickFirst);
    expect(match.optionIndex).toBeNull();
    expect(requests).toEqual([]);
  });

  it('still lets an institution\'s facts explain its own place in a bracket', async () => {
    const { match } = await run(institution('Georgetown University'), ['Georgetown University (Washington, D.C.)']);
    expect(match).toMatchObject({ optionIndex: 0, stage: 'exact', confidence: 1 });
  });

  it.each<[string, string[]]>([
    ['Rhode Island School of Design', ['Rhode Island School of Design', 'Rhode Island College']],
    ['Colorado School of Mines', ['Colorado School of Mines', 'Colorado State University']],
    ['University of Illinois Urbana-Champaign', ['University of Illinois Urbana-Champaign', 'University of Illinois Chicago']],
  ])('a name holding discipline or place words still matches its own spelling: %j', async (name, labels) => {
    const { match } = await run(institution(name), labels);
    expect(match).toMatchObject({ optionIndex: 0, stage: 'exact' });
  });
});

describe('fields of study', () => {
  const field = (text: string) => intendedField(canonicalField({ text }, vocab).value, vocab);

  it.each<[string, string[]]>([
    ['Mechanical Engineering', ['Electrical Engineering', 'Civil Engineering', 'Chemical Engineering']],
    ['Physics', ['Mathematics', 'Chemistry']],
    ['Accounting', ['Finance', 'Economics']],
    ['Psychology', ['Biology', 'Sociology']],
  ])('%j picks none of %j: their discipline words differ', async (text, labels) => {
    const { match, requests } = await run(field(text), labels, 'field', pickFirst);
    expect(match.optionIndex).toBeNull();
    expect(requests).toEqual([]);
  });

  it('never reads an academic field as a leisure activity', async () => {
    const labels = ['Visual and Performing Arts', 'Leisure and Recreational Activities'];
    for (const text of ['Art', 'Theater', 'Dancing', 'Reading']) {
      const { match } = await run(field(text), labels, 'field');
      expect(match.optionIndex === null ? null : labels[match.optionIndex], text).not.toBe(labels[1]);
    }
  });
});

describe('answers', () => {
  it('takes a decline wording forms print as the decline option', async () => {
    const { match } = await run(intendedDecline('eeo.gender'), ['Male', 'Female', 'Prefer not to state'], 'eeo.gender');
    expect(match).toMatchObject({ optionIndex: 2, stage: 'alias' });
  });

  it('never reads a decline option as the negated answer of a yes-or-no question', async () => {
    const { match } = await run(intendedBoolean(false), ['Hispanic or Latino', 'Prefer not to state'], 'polarity');
    expect(match.optionIndex).toBeNull();
  });

  it('finds the native speaker on a scale that writes "Native / Bilingual"', async () => {
    const labels = ['Elementary', 'Limited Working', 'Professional Working', 'Full Professional', 'Native / Bilingual'];
    const { match, requests } = await run(intendedAnswer('proficiency', 'Native or bilingual proficiency', vocab), labels,
      'proficiency');
    expect(match).toMatchObject({ optionIndex: 4, stage: 'alias' });
    expect(requests).toEqual([]);
  });
});
