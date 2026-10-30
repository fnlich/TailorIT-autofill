import { describe, expect, it } from 'vitest';
import { canonicalDegree } from '../profile/degreeParse';
import { canonicalField, canonicalInstitution } from '../profile/entities';
import {
  intendedAnswer, intendedCountry, intendedDegree, intendedField, intendedInstitution, intendedRegion,
} from './intended';
import { vocab } from './matcher.testkit';

describe('intended values from canonical entities', () => {
  it('puts the person’s own text first, then the vocabulary’s spellings', () => {
    const value = intendedInstitution(canonicalInstitution({ name: 'UT Austin' }, vocab).value, vocab);
    expect(value).toMatchObject({ kind: 'entity', domain: 'institution', id: 'ipeds:228778',
      display: 'The University of Texas at Austin' });
    if (value.kind !== 'entity') return;
    expect(value.surfaces[0]).toEqual({ text: 'UT Austin', tier: 'raw', ambiguous: false });
    expect(value.surfaces.map((surface) => surface.tier)).toContain('flagship');
  });

  it('adds the person’s aliases as curated spellings, ambiguous when the vocabulary gives them elsewhere', () => {
    const value = intendedInstitution(canonicalInstitution({ name: 'The University of Texas at Austin',
      aliases: ['Longhorn U', 'UT Dallas'] }, vocab).value, vocab);
    if (value.kind !== 'entity') throw new Error('entity expected');
    expect(value.surfaces.find((surface) => surface.text === 'Longhorn U')).toEqual({ text: 'Longhorn U', tier: 'curated',
      ambiguous: false });
    expect(value.surfaces.find((surface) => surface.text === 'UT Dallas')!.ambiguous).toBe(true);
  });

  it('keeps an unknown institution as the person wrote it', () => {
    expect(intendedInstitution(canonicalInstitution({ name: 'Zzyzx Institute' }, vocab).value, vocab)).toEqual({
      kind: 'entity', domain: 'institution', id: null, display: 'Zzyzx Institute',
      surfaces: [{ text: 'Zzyzx Institute', tier: 'raw', ambiguous: false }] });
  });

  it('builds fields, degrees, countries, regions and answers', () => {
    expect(intendedField(canonicalField({ text: 'CS' }, vocab).value, vocab)).toMatchObject({ id: 'cip:11.0701',
      display: 'Computer Science' });
    const degree = intendedDegree(canonicalDegree({ text: 'B.S.' }, vocab).value, vocab);
    expect(degree).toMatchObject({ kind: 'degree', level: 'bachelor', type: 'BS', display: 'Bachelor of Science' });
    if (degree.kind === 'degree') expect(degree.surfaces[0]).toEqual({ text: 'B.S.', tier: 'raw', ambiguous: false });
    expect(intendedDegree(canonicalDegree({ text: 'Bachelors' }, vocab).value, vocab))
      .toMatchObject({ type: null, display: "Bachelor's degree" });
    expect(intendedCountry('US', 'USA', vocab)).toMatchObject({ id: 'iso:US', display: 'United States' });
    expect(intendedRegion({ code: 'ON', name: 'Ontario' }, undefined, 'ON', vocab)).toMatchObject({ id: 'capost:ON' });
    expect(intendedAnswer('referral', 'Referral', vocab)).toMatchObject({ id: 'ref:employee-referral' });
    expect(intendedAnswer('referral', 'A podcast I like', vocab)).toMatchObject({ id: null });
  });
});
