/*
 * The candidate answers a search types (candidates.ts, v4): per kind, from TailorIT's own data only, in order, none
 * repeated, each long enough; s2 core-wd: one of each of three styles (the full name, a short form, a reduced form), at
 * most MAX_STYLE_QUERIES, a style with none giving its place to the next unused candidate.
 */
import { describe, expect, it } from 'vitest';
import { canonicalDegree } from '../profile/degreeParse';
import { canonicalField, canonicalInstitution } from '../profile/entities';
import { campusSplit, searchCandidates } from './candidates';
import {
  intendedCountry, intendedDegree, intendedEntity, intendedField, intendedInstitution, intendedText,
} from './intended';
import { vocab } from './matcher.testkit';
import { MAX_STYLE_QUERIES } from './searchLimits';

const institution = (name: string) => intendedInstitution(canonicalInstitution({ name }, vocab).value, vocab);
const degree = (text: string) => intendedDegree(canonicalDegree({ text }, vocab).value, vocab);
const field = (text: string) => intendedField(canonicalField({ text }, vocab).value, vocab);

describe('searchCandidates', () => {
  it('gives a school its full name without "The", a curated short form, then its name without its campus (s2 core-wd)', () => {
    expect(searchCandidates(institution('The University of Texas at Austin'), vocab)).toEqual([
      'University of Texas at Austin', 'UT Austin', 'University of Texas']);
    // The person's own text comes first, in the style it is: "UT Austin" is the short form, so the full name is typed
    // as well.
    expect(searchCandidates(institution('UT Austin'), vocab))
      .toEqual(['UT Austin', 'University of Texas at Austin', 'University of Texas']);
    expect(searchCandidates(institution('University of California, Berkeley'), vocab))
      .toEqual(['University of California, Berkeley', 'UC Berkeley', 'University of California']);
  });

  it('types a curated acronym as the short form', () => {
    expect(searchCandidates(institution('Massachusetts Institute of Technology'), vocab).slice(0, 2))
      .toEqual(['Massachusetts Institute of Technology', 'MIT']);
  });

  it('gives a style with no candidate its place to the next unused one, in order (s2 core-wd)', () => {
    // A school whose name has no campus and no weighty pair: its other spelling takes the reduced form's place.
    const georgia = searchCandidates(institution('Georgia Institute of Technology'), vocab);
    expect(georgia.slice(0, 2)).toEqual(['Georgia Institute of Technology', 'Georgia Tech']);
    expect(georgia).toHaveLength(3);
    // A text has only full forms: both are typed.
    expect(searchCandidates(intendedText('The Blue Team'), vocab)).toEqual(['The Blue Team', 'Blue Team']);
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

  it('gives a country its name and its other spellings of three letters or more', () => {
    const us = searchCandidates(intendedCountry('US', 'US', vocab), vocab);
    expect(us[0]).toBe('United States');
    expect(us).toContain('USA');
    // "US" is too short to type as a word.
    expect(us).not.toContain('US');
    expect(searchCandidates(intendedCountry('GB', 'GB', vocab), vocab)).toContain('United Kingdom');
  });

  it("types a phone country's dial code only when it is given, as a code of two characters or more", () => {
    expect(searchCandidates(intendedCountry('US', 'US', vocab), vocab)).not.toContain('+1');
    // s2 core-wd: the dial code is the reduced form, after the name and one other spelling.
    expect(searchCandidates(intendedCountry('US', 'US', vocab), vocab, undefined, { dialCode: '+1' }))
      .toEqual(['United States', 'USA', '+1']);
    expect(searchCandidates(intendedCountry('CA', 'CA', vocab), vocab, undefined, { dialCode: '+1' })).toContain('+1');
    expect(searchCandidates(intendedCountry('CA', 'CA', vocab), vocab, undefined, { dialCode: '1; DROP' }))
      .not.toContain('1; DROP');
  });

  it("gives a degree the person's text or its type's name, its code, and its level's name", () => {
    const bs = searchCandidates(degree('Bachelor of Science'), vocab);
    expect(bs).toEqual(['Bachelor of Science', 'B.S.', "Bachelor's"]);
    // The person's code is the short form: the type's name is the full one.
    expect(searchCandidates(degree('B.S.'), vocab)).toEqual(['B.S.', 'Bachelor of Science', "Bachelor's"]);
  });

  it("gives a field of study the person's text, the CIP title, its spellings and its parent's title", () => {
    const cs = searchCandidates(field('Computer Science'), vocab);
    expect(cs[0]).toBe('Computer Science');
    expect(cs).toContain('CompSci');
  });

  it("types a place as written, then with its region's code or name, then its city alone", () => {
    const austin = { city: 'Austin', region: { code: 'TX', name: 'Texas' }, country: 'US' };
    expect(searchCandidates(intendedText('Austin, TX'), vocab, austin)).toEqual(['Austin, TX', 'Austin, Texas', 'Austin']);
    expect(searchCandidates(intendedText('Austin, Texas, United States'), vocab, austin))
      .toEqual(['Austin, Texas, United States', 'Austin, TX', 'Austin']);
  });

  it("types a referral source's name, another spelling, then the kind of source it is (s2 core-wd)", () => {
    const linkedin = intendedEntity(vocab, 'referral', vocab.entity('ref:linkedin')!);
    expect(searchCandidates(linkedin, vocab, undefined, { kind: 'ref:social-media' }))
      .toEqual(['LinkedIn', 'LinkedIn Jobs', 'Social media']);
    // Without a kind, none is typed: the next spelling takes its place.
    expect(searchCandidates(linkedin, vocab)).toEqual(['LinkedIn', 'LinkedIn Jobs', 'LinkedIn job posting']);
  });

  it('never gives more than three, none repeated ignoring case, none shorter than three characters but a code', () => {
    for (const value of [institution('The University of Texas at Austin'), institution('Georgia Institute of Technology'),
      institution('UCLA'), intendedCountry('US', 'US', vocab), degree('Master of Business Administration'),
      field('Mechanical Engineering')]) {
      const queries = searchCandidates(value, vocab);
      expect(queries.length).toBeLessThanOrEqual(MAX_STYLE_QUERIES);
      expect(new Set(queries.map((query) => query.toLowerCase())).size).toBe(queries.length);
      expect(queries.every((query) => query.length >= 2)).toBe(true);
    }
  });

  it('gives nothing for a value no search holds', () => {
    expect(searchCandidates({ kind: 'boolean', value: true }, vocab)).toEqual([]);
    expect(searchCandidates({ kind: 'date', y: 2020 }, vocab)).toEqual([]);
  });
});
