import { describe, expect, it } from 'vitest';
import { canonicalInstitution } from '../profile/entities';
import { intendedInstitution, intendedText } from './intended';
import { vocab } from './matcher.testkit';
import { typeaheadQueries } from './typeahead';

const institution = (name: string) => intendedInstitution(canonicalInstitution({ name }, vocab).value, vocab);

describe('typeaheadQueries (§4.11)', () => {
  it('tries the full name without "The", a curated spelling, then the name without its campus (s2 core-wd: three styles)', () => {
    expect(typeaheadQueries(institution('The University of Texas at Austin'), vocab))
      .toEqual(['University of Texas at Austin', 'UT Austin', 'University of Texas']);
  });

  it('never searches by a particle of another language ("Universidad de")', () => {
    expect(typeaheadQueries(institution('Universidad de Buenos Aires'), vocab)).toContain('Universidad Buenos');
    for (const name of ['Universidad de Buenos Aires', 'Universidad de los Andes', 'De La Salle University']) {
      const last = typeaheadQueries(institution(name), vocab).slice(1);
      expect(last.some((query) => /^(?:\S+ )?(?:de|la|los|del)$/i.test(query) || /^de la$/i.test(query)), name)
        .toBe(false);
    }
  });

  it('prefers a curated acronym as the alias', () => {
    expect(typeaheadQueries(institution('Massachusetts Institute of Technology'), vocab).slice(0, 2))
      .toEqual(['Massachusetts Institute of Technology', 'MIT']);
  });

  it('gives at most three distinct queries (s2 core-wd: MAX_STYLE_QUERIES), ignoring case, each at least three characters', () => {
    const names = ['The University of Texas at Austin', 'Georgia Institute of Technology', 'UCLA', 'Rice University'];
    for (const name of names) {
      const queries = typeaheadQueries(institution(name), vocab);
      expect(queries.length, name).toBeLessThanOrEqual(3);
      expect(new Set(queries.map((query) => query.toLowerCase())).size, name).toBe(queries.length);
      expect(queries.every((query) => query.length >= 3), name).toBe(true);
    }
  });

  it('types a text value as it is, and nothing for values no search holds', () => {
    expect(typeaheadQueries(intendedText('The Blue Team'), vocab)).toEqual(['The Blue Team', 'Blue Team']);
    expect(typeaheadQueries({ kind: 'boolean', value: true }, vocab)).toEqual([]);
  });

  it("types a place as written, then with its region's name, then by its city alone (s2 core-wd: three styles)", () => {
    // Greenhouse's Location lists only the geocoder's results whose label holds the typed text, and spells the region
    // out ("Austin, Texas, United States"), so "Austin, TX" lists nothing there (the live BeyondTrust form, 2026-11-01).
    const austin = { city: 'Austin', region: { code: 'TX', name: 'Texas' }, country: 'US' };
    expect(typeaheadQueries(intendedText('Austin, TX'), vocab, austin)).toEqual(['Austin, TX', 'Austin, Texas', 'Austin']);
    // A region the table does not hold keeps the name the person wrote; a place with no region gives its city alone.
    expect(typeaheadQueries(intendedText('Munich, Bavaria, Germany'), vocab,
      { city: 'Munich', region: { name: 'Bavaria' }, country: 'DE' }))
      .toEqual(['Munich, Bavaria, Germany', 'Munich, Bavaria', 'Munich']);
    expect(typeaheadQueries(intendedText('London, United Kingdom'), vocab, { city: 'London', country: 'GB' }))
      .toEqual(['London, United Kingdom', 'London']);
    // None repeated; a place with no city adds nothing.
    expect(typeaheadQueries(intendedText('The Woodlands, TX'), vocab,
      { city: 'The Woodlands', region: { code: 'TX', name: 'Texas' } }))
      .toEqual(['The Woodlands, TX', 'The Woodlands, Texas', 'The Woodlands']);
    expect(typeaheadQueries(intendedText('Texas'), vocab, { region: { code: 'TX', name: 'Texas' } })).toEqual(['Texas']);
  });
});
