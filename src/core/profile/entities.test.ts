import { describe, expect, it } from 'vitest';
import { bundledVocab } from '../vocab/bundled.testkit';
import {
  CANONICALIZE_ISSUE_CODES, canonicalCountry, canonicalField, canonicalInstitution, canonicalRegion,
} from './entities';

const vocab = bundledVocab();

describe('canonicalCountry', () => {
  it.each<[string, string]>([
    ['United States', 'US'], ['USA', 'US'], ['U.S.', 'US'], ['us', 'US'], ['United States of America', 'US'],
    ['America', 'US'], ['UK', 'GB'], ['U.K.', 'GB'], ['GBR', 'GB'], ['United Kingdom', 'GB'], ['Britain', 'GB'],
    ['South Korea', 'KR'], ['Korea, Republic of', 'KR'], ["Korea, Democratic People's Republic of", 'KP'],
    ['Turkey', 'TR'], ['Türkiye', 'TR'], ['Ivory Coast', 'CI'], ["Côte d'Ivoire", 'CI'], ['Niger', 'NE'],
    ['Nigeria', 'NG'], ['Dominica', 'DM'], ['Dominican Republic', 'DO'], ['  canada ', 'CA'], ['IN', 'IN'],
  ])('%j is %s', (text, code) => {
    expect(canonicalCountry(text, vocab)).toEqual({ value: code, issues: [] });
  });

  it('keeps an unknown or ambiguous name as written, with country-unknown', () => {
    expect(canonicalCountry('Atlantis', vocab, 'address.country'))
      .toEqual({ value: 'Atlantis', issues: [{ path: 'address.country', code: 'country-unknown' }] });
    expect(canonicalCountry('Congo', vocab).issues).toEqual([{ path: 'country', code: 'country-unknown' }]);
    expect(canonicalCountry('Kosovo', vocab).value).toBe('Kosovo');
  });

  it('gives nothing for empty text', () => {
    expect(canonicalCountry('   ', vocab)).toEqual({ value: '', issues: [] });
  });
});

describe('canonicalRegion', () => {
  it.each<[string, string | undefined, string, string]>([
    ['Texas', 'US', 'TX', 'Texas'], ['TX', 'US', 'TX', 'Texas'], ['tx', undefined, 'TX', 'Texas'],
    ['Tex.', 'US', 'TX', 'Texas'], ['Washington, D.C.', 'US', 'DC', 'District of Columbia'],
    ['Washington DC', 'United States', 'DC', 'District of Columbia'], ['Washington', 'US', 'WA', 'Washington'],
    ['Puerto Rico', 'US', 'PR', 'Puerto Rico'], ['ON', 'CA', 'ON', 'Ontario'], ['Québec', 'Canada', 'QC', 'Quebec'],
    ['Ontario', undefined, 'ON', 'Ontario'],
  ])('%j in %s is %s', (text, country, code, name) => {
    expect(canonicalRegion(text, country, vocab)).toEqual({ value: { code, name }, issues: [] });
  });

  it('looks only within the given country, and keeps anything else as written', () => {
    expect(canonicalRegion('Ontario', 'US', vocab, 'address.region'))
      .toEqual({ value: { name: 'Ontario' }, issues: [{ path: 'address.region', code: 'region-unknown' }] });
    expect(canonicalRegion('Bavaria', 'DE', vocab).value).toEqual({ name: 'Bavaria' });
    expect(canonicalRegion('Nowhere', undefined, vocab).issues).toHaveLength(1);
    expect(canonicalRegion('', 'US', vocab)).toEqual({ value: { name: '' }, issues: [] });
  });
});

describe('canonicalInstitution (§2.7)', () => {
  it('resolves the golden table’s spellings to their institution, keeping exactly what the person typed', () => {
    const cases: Array<[string, string, string]> = [
      ['The University of Texas at Austin', 'ipeds', '228778'], ['UT Austin', 'ipeds', '228778'],
      ['UT-Austin', 'ipeds', '228778'], ['UT Dallas', 'ipeds', '228787'], ['Georgia Tech', 'ipeds', '139755'],
      ['Georgia State University', 'ipeds', '139940'], ['Massachusetts Institute of Technology', 'ipeds', '166683'],
      ['Texas A&M University', 'ipeds', '228723'], ['University of Washington', 'ipeds', '236948'],
      ['Washington University in St. Louis', 'ipeds', '179867'], ['Ohio State University', 'ipeds', '204796'],
      ['University of California, Los Angeles', 'ipeds', '110662'], ['Carnegie Mellon University', 'ipeds', '211440'],
      ['University of Michigan', 'ipeds', '170976'], ['Northwestern University', 'ipeds', '147767'],
      ['Boston University', 'ipeds', '164988'], ['University of Miami', 'ipeds', '135726'],
      ['University of Southern California', 'ipeds', '123961'], ['University of Arizona', 'ipeds', '104179'],
      ['Penn State', 'ipeds', '214777'], ['Texas at Austin, University of', 'ipeds', '228778'],
    ];
    for (const [name, kind, id] of cases) {
      const { value, issues } = canonicalInstitution({ name }, vocab);
      expect(value.source, name).toBe('vocab');
      expect(value.ids[kind as 'ipeds'], name).toBe(id);
      expect(value.userText).toBe(name);
      expect(issues).toEqual([]);
    }
  });

  it('fills the canonical name, the facts and the aliases, the person’s first', () => {
    const { value } = canonicalInstitution({ name: '  UT  Austin ', aliases: ['Texas', 'UT-Austin', 'UTexas', ''] }, vocab);
    expect(value).toMatchObject({
      canonicalName: 'The University of Texas at Austin', ids: { ipeds: '228778' }, city: 'Austin', region: 'TX',
      country: 'US', source: 'vocab', userText: '  UT  Austin ',
    });
    expect(value.aliases.slice(0, 2)).toEqual(['Texas', 'UTexas']);
    expect(value.aliases).toContain('University of Texas');
    expect(value.aliases).not.toContain('UT-Austin');
    expect(canonicalInstitution({ name: 'University of Michigan' }, vocab).value)
      .toMatchObject({ canonicalName: 'University of Michigan-Ann Arbor', campus: 'Ann Arbor', region: 'MI' });
  });

  it('takes the ids first, and reports an id the vocabulary lacks', () => {
    expect(canonicalInstitution({ name: 'Some other text', ids: { ipeds: '166683' } }, vocab).value)
      .toMatchObject({ canonicalName: 'Massachusetts Institute of Technology', source: 'vocab' });
    const toronto = canonicalInstitution({ name: 'U of T', ids: { ror: '03dbr7087' } }, vocab).value;
    expect(toronto).toMatchObject({ canonicalName: 'University of Toronto', country: 'CA', ids: { ror: '03dbr7087' } });
    const unknown = canonicalInstitution({ name: 'MIT', ids: { ipeds: '999999' } }, vocab);
    expect(unknown.value).toMatchObject({ source: 'vocab', ids: { ipeds: '166683' } });
    expect(unknown.issues).toEqual([{ path: 'institution.ids', code: 'institution-id-unknown' }]);
  });

  it('falls back to the person’s aliases when the name names nothing', () => {
    const { value, issues } = canonicalInstitution({ name: 'The Institute in Cambridge', aliases: ['MIT'] }, vocab);
    expect(value.ids.ipeds).toBe('166683');
    expect(issues).toEqual([]);
  });

  it('settles a shared key by the entry’s location, and keeps the text when it cannot', () => {
    const name = 'Northeastern University';
    const ambiguous = canonicalInstitution({ name }, vocab, 'education[0].institution');
    expect(ambiguous.value).toMatchObject({ canonicalName: name, source: 'user', aliases: [] });
    expect(ambiguous.issues).toEqual([{ path: 'education[0].institution', code: 'institution-ambiguous' }]);
    expect(canonicalInstitution({ name, location: { city: 'Boston', region: 'MA', country: 'US' } }, vocab).value.ids)
      .toEqual({ ipeds: '167358' });
    expect(canonicalInstitution({ name, location: { country: 'United States' } }, vocab).value.ids.ipeds).toBe('167358');
    expect(canonicalInstitution({ name, location: { country: 'CN' } }, vocab).value)
      .toMatchObject({ source: 'vocab', country: 'CN' });
    expect(canonicalInstitution({ name, location: { country: 'FR' } }, vocab).issues[0]!.code).toBe('institution-ambiguous');
  });

  it('keeps an unknown institution as written, with the entry’s location', () => {
    const { value, issues } = canonicalInstitution({ name: 'Hogwarts School', aliases: ['Hogwarts', 'hogwarts school'],
      location: { city: 'Highlands', region: 'Tex.', country: 'USA' } }, vocab);
    expect(value).toEqual({ canonicalName: 'Hogwarts School', aliases: ['Hogwarts'], ids: {}, city: 'Highlands',
      region: 'TX', country: 'US', source: 'user', userText: 'Hogwarts School' });
    expect(issues).toEqual([{ path: 'institution', code: 'institution-not-in-vocab' }]);
  });

  it('never resolves a key that rests on an unresolved "st"', () => {
    expect(canonicalInstitution({ name: 'Wichita St' }, vocab).value.source).toBe('user');
  });
});

describe('canonicalField (§2.7)', () => {
  it.each<[string, string, string]>([
    ['Computer Science', '11.0701', 'Computer Science'], ['CS', '11.0701', 'Computer Science'],
    ['Comp Sci', '11.0701', 'Computer Science'], ['Biology', '26.0101', 'Biology/Biological Sciences'],
    ['Biological Sciences', '26.0101', 'Biology/Biological Sciences'], ['Economics', '45.0601', 'Economics'],
    ['Mech. Engineering', '14.1901', 'Mechanical Engineering'], ['EE', '14.1001', 'Electrical and Electronics Engineering'],
    ['Electrical Engineering', '14.1001', 'Electrical and Electronics Engineering'], ['Engineering', '14.0101', 'Engineering'],
  ])('%j is CIP %s', (text, cip, name) => {
    const { value, issues } = canonicalField({ text }, vocab);
    expect(value).toMatchObject({ name, cip, userText: text });
    expect(issues).toEqual([]);
  });

  it('takes a known CIP code first, and gives the code’s other spellings as aliases', () => {
    const { value } = canonicalField({ text: 'whatever I studied', cip: '11.0701' }, vocab);
    expect(value).toMatchObject({ name: 'Computer Science', cip: '11.0701', userText: 'whatever I studied' });
    expect(value.aliases).toEqual(expect.arrayContaining(['CompSci']));
    expect(value.aliases).not.toContain('Computer Science');
  });

  it('keeps an unknown or ambiguous field as written', () => {
    expect(canonicalField({ text: 'Underwater Basket Weaving' }, vocab, 'education[0].degree.field')).toEqual({
      value: { name: 'Underwater Basket Weaving', aliases: [], userText: 'Underwater Basket Weaving' },
      issues: [{ path: 'education[0].degree.field', code: 'field-not-in-vocab' }],
    });
    expect(canonicalField({ text: 'Music' }, vocab).issues).toEqual([{ path: 'field', code: 'field-ambiguous' }]);
    expect(canonicalField({ text: 'Lost Art', cip: '99.9999' }, vocab).value).toMatchObject({ cip: '99.9999' });
  });
});

describe('issues', () => {
  it('carry a path and a code from the closed list, never a value', () => {
    const issues = [
      ...canonicalInstitution({ name: 'Hogwarts', ids: { ipeds: '000001' }, location: { region: 'Narnia' } }, vocab).issues,
      ...canonicalField({ text: 'Alchemy' }, vocab).issues, ...canonicalCountry('Atlantis', vocab).issues,
      ...canonicalRegion('Narnia', 'US', vocab).issues,
    ];
    expect(issues.length).toBeGreaterThanOrEqual(5);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'path']);
      expect(CANONICALIZE_ISSUE_CODES).toContain(issue.code);
      expect(JSON.stringify(issue)).not.toMatch(/Hogwarts|Narnia|Alchemy|Atlantis/);
    }
  });
});
