/*
 * The candidate answers a search types (candidates.ts, v4): per kind, from TailorIT's own data only, in order, none
 * repeated, each long enough, at most MAX_SEARCH_QUERIES.
 */
import { describe, expect, it } from 'vitest';
import { canonicalDegree } from '../profile/degreeParse';
import { canonicalField, canonicalInstitution } from '../profile/entities';
import { campusSplit, searchCandidates } from './candidates';
import { intendedCountry, intendedDegree, intendedField, intendedInstitution, intendedText } from './intended';
import { vocab } from './matcher.testkit';
import { MAX_SEARCH_QUERIES } from './searchLimits';

const institution = (name: string) => intendedInstitution(canonicalInstitution({ name }, vocab).value, vocab);
const degree = (text: string) => intendedDegree(canonicalDegree({ text }, vocab).value, vocab);
const field = (text: string) => intendedField(canonicalField({ text }, vocab).value, vocab);

describe('searchCandidates', () => {
  it('gives a school its name, without "The", its curated spellings, its name without its campus, and its weighty words', () => {
    expect(searchCandidates(institution('The University of Texas at Austin'), vocab)).toEqual([
      'The University of Texas at Austin', 'University of Texas at Austin', 'UT Austin', 'UTexas', 'University of Texas',
      'Texas Austin']);
    // The person's own text comes first.
    expect(searchCandidates(institution('UT Austin'), vocab).slice(0, 3))
      .toEqual(['UT Austin', 'The University of Texas at Austin', 'University of Texas at Austin']);
    expect(searchCandidates(institution('UT Austin'), vocab)).toContain('University of Texas');
  });

  it('types a curated acronym before the other spellings', () => {
    expect(searchCandidates(institution('Massachusetts Institute of Technology'), vocab).slice(0, 2))
      .toEqual(['Massachusetts Institute of Technology', 'MIT']);
  });

  it("splits a school's campus off its name", () => {
    expect(campusSplit('The University of Texas at Austin')).toBe('University of Texas');
    expect(campusSplit('University of California, Berkeley')).toBe('University of California');
    expect(campusSplit('University of California-Berkeley', 'Berkeley')).toBe('University of California');
    expect(campusSplit('Penn State - Erie')).toBe('Penn State');
    expect(campusSplit('Rice University')).toBe('');
    // Nothing of fewer than two words is left as a school's name.
    expect(campusSplit('Tech at Austin')).toBe('');
    const berkeley = searchCandidates(institution('University of California, Berkeley'), vocab);
    expect(berkeley).toContain('University of California');
  });

  it('gives a country its name, its other spellings of three letters or more, and its alpha-3 code', () => {
    const us = searchCandidates(intendedCountry('US', 'US', vocab), vocab);
    expect(us[0]).toBe('United States');
    expect(us).toContain('United States of America');
    expect(us).toContain('USA');
    // "US" is too short to type as a word.
    expect(us).not.toContain('US');
    expect(searchCandidates(intendedCountry('GB', 'GB', vocab), vocab)).toContain('United Kingdom');
  });

  it("types a phone country's dial code only when it is given, as a code of two characters or more", () => {
    expect(searchCandidates(intendedCountry('US', 'US', vocab), vocab)).not.toContain('+1');
    expect(searchCandidates(intendedCountry('CA', 'CA', vocab), vocab, undefined, { dialCode: '+1' })).toContain('+1');
    expect(searchCandidates(intendedCountry('CA', 'CA', vocab), vocab, undefined, { dialCode: '1; DROP' }))
      .not.toContain('1; DROP');
  });

  it("gives a degree the person's text, its type's name and codes, and its level's name", () => {
    const bs = searchCandidates(degree('Bachelor of Science'), vocab);
    expect(bs).toEqual(['Bachelor of Science', 'B.S.', 'BS', "Bachelor's", "Bachelor's degree"]);
    expect(searchCandidates(degree('B.S.'), vocab).slice(0, 2)).toEqual(['B.S.', 'Bachelor of Science']);
  });

  it("gives a field of study the person's text, the CIP title, its spellings and its parent's title", () => {
    const cs = searchCandidates(field('Computer Science'), vocab);
    expect(cs[0]).toBe('Computer Science');
    expect(cs).toContain('CompSci');
  });

  it("types a place as written, then with its region's code and name, its country's name, then its city alone", () => {
    const austin = { city: 'Austin', region: { code: 'TX', name: 'Texas' }, country: 'US' };
    expect(searchCandidates(intendedText('Austin, TX'), vocab, austin))
      .toEqual(['Austin, TX', 'Austin, Texas', 'Austin, United States', 'Austin']);
    expect(searchCandidates(intendedText('Austin, Texas, United States'), vocab, austin))
      .toEqual(['Austin, Texas, United States', 'Austin, TX', 'Austin, Texas', 'Austin, United States', 'Austin']);
  });

  it('never gives more than six, none repeated ignoring case, none shorter than three characters but a code', () => {
    for (const value of [institution('The University of Texas at Austin'), institution('Georgia Institute of Technology'),
      institution('UCLA'), intendedCountry('US', 'US', vocab), degree('Master of Business Administration'),
      field('Mechanical Engineering')]) {
      const queries = searchCandidates(value, vocab);
      expect(queries.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES);
      expect(new Set(queries.map((query) => query.toLowerCase())).size).toBe(queries.length);
      expect(queries.every((query) => query.length >= 2)).toBe(true);
    }
  });

  it('gives nothing for a value no search holds', () => {
    expect(searchCandidates({ kind: 'boolean', value: true }, vocab)).toEqual([]);
    expect(searchCandidates({ kind: 'date', y: 2020 }, vocab)).toEqual([]);
  });
});
