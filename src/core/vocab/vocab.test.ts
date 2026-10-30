import { describe, expect, it } from 'vitest';
import { DEGREE_LEVELS, DEGREE_TYPES, PROFICIENCIES } from '../enums';
import {
  ABBREVIATIONS_ALL, ABBREVIATIONS_BY_CONTEXT, FIELD_WHOLE_VALUE, NEVER_EXPANDED, SAINT_NAMES, STATE_LIKE,
} from '../text/abbreviations';
import { INSTITUTION_HEAD_NOUNS, NORM_CONTEXTS, NORMALIZER_VERSION, normalize } from '../text/normalize';
import { NOISE_QUALIFIERS } from '../text/qualifiers';
import { sha256Hex } from '../text/sha256';
import { DEGREE_LEVEL_PLURALS, STOPWORDS } from '../text/tokens';
import { VOCAB_DOMAINS, type VocabDomain } from '../types/intent';
import { bundledVocab, loadRawVocab, readVocabFile } from './bundled.testkit';
import { createVocab, stableStringify } from './createVocab';
import { isAcronym, keyFor, resolveKey, resolveText, surfacesOf } from './lookup';
import { DOMAIN_CONTEXT, VOCAB_BUDGETS, VOCAB_FILES, type VocabFile } from './types';

const vocab = bundledVocab();
const raw = loadRawVocab();
const DATA_FILES = (Object.keys(VOCAB_FILES) as VocabFile[]).filter((file) => file !== 'manifest');

describe('stableStringify', () => {
  it('sorts keys, drops undefined members, puts the first two levels one item per line and ends with LF', () => {
    expect(stableStringify({ b: [{ z: 1, a: [2, 'x'] }], a: undefined, c: 'é' }))
      .toBe('{\n"b":[\n{"a":[2,"x"],"z":1}\n],\n"c":"é"\n}\n');
    expect(stableStringify([])).toBe('[]\n');
    expect(stableStringify({ a: {} })).toBe('{\n"a":{}\n}\n');
  });

  it('gives one text for one value, whatever the key order', () => {
    expect(stableStringify({ x: 1, y: { q: [1], p: 2 } })).toBe(stableStringify({ y: { p: 2, q: [1] }, x: 1 }));
  });

  it('refuses what JSON cannot hold', () => {
    expect(() => stableStringify(Number.NaN)).toThrow();
    expect(() => stableStringify([undefined])).toThrow();
    expect(() => stableStringify({ f: () => 1 })).toThrow();
  });
});

describe('the generated files (§5.3)', () => {
  it.each(DATA_FILES)('%s is its own stable string, hashed and sized as manifest.json says', (file) => {
    const text = readVocabFile(file);
    expect(stableStringify(JSON.parse(text))).toBe(text);
    const entry = raw.manifest.files[VOCAB_FILES[file]];
    expect(entry, `manifest.json lists ${VOCAB_FILES[file]}`).toBeDefined();
    expect(sha256Hex(text)).toBe(entry!.sha256);
    expect(Buffer.byteLength(text)).toBe(entry!.bytes);
    expect(entry!.budget).toBe(VOCAB_BUDGETS[file]);
    expect(entry!.bytes).toBeLessThanOrEqual(VOCAB_BUDGETS[file]);
  });

  it('manifest.json is stable, within its budget, and lists exactly the data files and the six sources', () => {
    const text = readVocabFile('manifest');
    expect(stableStringify(JSON.parse(text))).toBe(text);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(VOCAB_BUDGETS.manifest);
    expect(Object.keys(raw.manifest.files).sort()).toEqual(DATA_FILES.map((file) => VOCAB_FILES[file]).sort());
    expect(Object.keys(raw.manifest.sources).sort()).toEqual(['cip', 'cldr-code-mappings', 'cldr-languages',
      'cldr-territories', 'ipeds-hd', 'ror']);
    expect(vocab.releases).toMatchObject({ 'ipeds-hd': 'HD2024', cip: '2020', ror: 'v2.15-2026-10-20' });
  });
});

describe('the normalizer the keys were built with', () => {
  it('is this code’s version', () => {
    expect(raw.manifest.normalizerVersion).toBe(NORMALIZER_VERSION);
    expect(vocab.normalizerVersion).toBe(NORMALIZER_VERSION);
    expect(raw.lexicon.normalizer.version).toBe(NORMALIZER_VERSION);
  });

  it('had the tables the code has now (a table edited without a version bump fails here)', () => {
    const snapshot = raw.lexicon.normalizer;
    for (const context of NORM_CONTEXTS) expect(snapshot.stopwords[context]).toEqual([...STOPWORDS[context]].sort());
    expect(snapshot.abbreviationsAll).toEqual(Object.fromEntries(ABBREVIATIONS_ALL));
    expect(snapshot.abbreviations).toEqual(Object.fromEntries([...ABBREVIATIONS_BY_CONTEXT]
      .map(([context, table]) => [context, Object.fromEntries(table)])));
    expect(snapshot.fieldWholeValue).toEqual(Object.fromEntries([...FIELD_WHOLE_VALUE].map(([k, v]) => [k, [...v]])));
    expect(snapshot.neverExpanded).toEqual([...NEVER_EXPANDED]);
    expect(snapshot.saintNames).toEqual([...SAINT_NAMES]);
    expect(snapshot.stateLike).toEqual([...STATE_LIKE]);
    expect(snapshot.noiseQualifiers).toEqual([...NOISE_QUALIFIERS]);
    expect(snapshot.headNouns).toEqual([...INSTITUTION_HEAD_NOUNS]);
    expect(snapshot.degreeLevelPlurals).toEqual(Object.fromEntries(DEGREE_LEVEL_PLURALS));
  });

  it.each(VOCAB_DOMAINS)('every stored key in %s is what normalize gives now', (domain) => {
    const context = DOMAIN_CONTEXT[domain];
    const wrong: string[] = [];
    for (const entity of vocab.entities(domain)) {
      for (const surface of entity.surfaces) {
        if (normalize(surface.text, context).key !== surface.key) wrong.push(`${entity.id} ${JSON.stringify(surface.text)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every answer phrase key is what normalize gives now', () => {
    const phrases = [...raw.answers.decline, ...raw.answers.exclusive, ...raw.answers.other, ...raw.answers.placeholders,
      ...raw.answers.polarity.yes, ...raw.answers.polarity.no,
      ...Object.values(raw.answers.eeo).flatMap((question) => question.decline)];
    expect(phrases.filter(([text, key]) => normalize(text, 'answer').key !== key)).toEqual([]);
  });
});

describe('invariants', () => {
  it('every id is unique, prefixed by its kind, and found by entity()', () => {
    const seen = new Set<string>();
    for (const domain of VOCAB_DOMAINS) {
      for (const entity of vocab.entities(domain)) {
        expect(seen.has(entity.id), entity.id).toBe(false);
        seen.add(entity.id);
        expect(vocab.entity(entity.id)).toBe(entity);
      }
    }
    expect(seen.size).toBeGreaterThan(10_000);
    expect(vocab.entity('nope:1')).toBeUndefined();
    expect(vocab.entity('ipeds:000000')).toBeUndefined();
  });

  it('every entity has a display name and only non-empty, distinct keys', () => {
    for (const domain of VOCAB_DOMAINS) {
      for (const entity of vocab.entities(domain)) {
        expect(entity.surfaces.length, entity.id).toBeGreaterThan(0);
        expect(entity.name).toBe(entity.surfaces[0]!.text);
        const keys = entity.surfaces.map((surface) => surface.key);
        expect(keys.every((key) => key !== ''), entity.id).toBe(true);
        expect(new Set(keys).size, entity.id).toBe(keys.length);
      }
    }
  });

  it.each(VOCAB_DOMAINS)('%s: a key shared by entities is marked ambiguous on every one, and only then', (domain) => {
    const owners = new Map<string, string[]>();
    for (const entity of vocab.entities(domain)) {
      for (const surface of entity.surfaces) owners.set(surface.key, [...(owners.get(surface.key) ?? []), entity.id]);
    }
    const lineage = (ids: string[]) => domain === 'field' && vocab.fields.mostSpecific(ids) !== null;
    const unmarked: string[] = [];
    const spurious: string[] = [];
    for (const entity of vocab.entities(domain)) {
      for (const surface of entity.surfaces) {
        const ids = owners.get(surface.key)!;
        const shared = ids.length > 1 && !lineage(ids);
        const st = surface.key.split(' ').includes('st?');
        if (shared && !surface.ambiguous) unmarked.push(`${entity.id} "${surface.key}"`);
        if (surface.ambiguous && !shared && !st) spurious.push(`${entity.id} "${surface.key}"`);
      }
    }
    expect(unmarked).toEqual([]);
    expect(spurious).toEqual([]);
  });

  it('covers ISO 3166-1, the USPS and Canada Post lists, ISO 639-1 and the closed value lists', () => {
    expect(vocab.entities('country')).toHaveLength(249);
    expect(vocab.regions.ofCountry('US')).toHaveLength(62);
    expect(vocab.regions.ofCountry('CA')).toHaveLength(13);
    expect(vocab.entities('language').length).toBeGreaterThanOrEqual(184);
    expect(vocab.degrees.types.map((entry) => entry.type)).toEqual([...DEGREE_TYPES]);
    expect(vocab.degrees.levels.map((entry) => entry.level)).toEqual([...DEGREE_LEVELS]);
    expect(vocab.entities('proficiency').map((entry) => entry.id)).toEqual(PROFICIENCIES.map((id) => `prof:${id}`));
    expect(vocab.entities('generic')).toEqual([]);
  });

  it('keeps the domains’ document frequencies, only for tokens held by at least 3 surfaces', () => {
    expect(vocab.docCount('institution')).toBeGreaterThan(10_000);
    expect(vocab.df('institution', 'university')).toBeGreaterThan(1_000);
    expect(vocab.df('institution', 'zzqx')).toBe(0);
    for (const table of Object.values(raw.lexicon.df)) {
      expect(Object.values(table!.t).every((count) => count >= 3)).toBe(true);
    }
    expect(vocab.docCount('generic')).toBe(0);
  });
});

/** What a golden-table spelling must resolve to: an id, or a set of ids it is ambiguous between. */
type Expect = string | { ambiguousWith: string[] };

const GOLDEN: ReadonlyArray<[VocabDomain, string, Expect]> = [
  // §6.1 and §6.2, institutions: every profile value, and the options whose entity matters.
  ['institution', 'The University of Texas at Austin', 'ipeds:228778'],
  ['institution', 'University of Texas - Austin', 'ipeds:228778'],
  ['institution', 'UT Austin', 'ipeds:228778'],
  ['institution', 'UT-Austin', 'ipeds:228778'],
  ['institution', 'Texas at Austin, University of', 'ipeds:228778'],
  ['institution', 'University of Texas at Austin (UT Austin)', 'ipeds:228778'],
  ['institution', 'University of Texas', 'ipeds:228778'],
  ['institution', 'UT Dallas', 'ipeds:228787'],
  ['institution', 'UT-Dallas', 'ipeds:228787'],
  ['institution', 'The University of Texas at Dallas', 'ipeds:228787'],
  ['institution', 'Texas at Dallas, University of', 'ipeds:228787'],
  ['institution', 'University of Texas at Arlington', 'ipeds:228769'],
  ['institution', 'Texas State University', 'ipeds:228459'],
  ['institution', 'Texas A&M University', 'ipeds:228723'],
  ['institution', 'Texas A & M University', 'ipeds:228723'],
  ['institution', 'Texas Tech University', 'ipeds:229115'],
  ['institution', 'Austin College', 'ipeds:222983'],
  ['institution', 'Georgia Institute of Technology', 'ipeds:139755'],
  ['institution', 'Georgia Tech', 'ipeds:139755'],
  ['institution', 'Georgia State University', 'ipeds:139940'],
  ['institution', 'University of Georgia', 'ipeds:139959'],
  ['institution', 'Georgia Southern University', 'ipeds:139931'],
  ['institution', 'Massachusetts Institute of Technology', 'ipeds:166683'],
  ['institution', 'MIT', 'ipeds:166683'],
  ['institution', 'Harvard University', 'ipeds:166027'],
  ['institution', 'University of Washington', 'ipeds:236948'],
  ['institution', 'Washington University in St. Louis', 'ipeds:179867'],
  ['institution', 'Washington University in St Louis', 'ipeds:179867'],
  ['institution', 'Washington State University', 'ipeds:236939'],
  ['institution', 'Ohio State University', 'ipeds:204796'],
  ['institution', 'The Ohio State University', 'ipeds:204796'],
  ['institution', 'Ohio St. University', 'ipeds:204796'],
  ['institution', 'Ohio University', 'ipeds:204857'],
  ['institution', 'University of California, Los Angeles', 'ipeds:110662'],
  ['institution', 'UCLA', 'ipeds:110662'],
  ['institution', 'UC Berkeley', 'ipeds:110635'],
  ['institution', 'USC', { ambiguousWith: ['ipeds:123961'] }],
  ['institution', 'Carnegie Mellon University', 'ipeds:211440'],
  ['institution', 'Case Western Reserve University', 'ipeds:201645'],
  ['institution', 'University of Michigan', 'ipeds:170976'],
  ['institution', 'University of Michigan - Ann Arbor', 'ipeds:170976'],
  ['institution', 'Michigan State University', 'ipeds:171100'],
  ['institution', 'Northeastern University', { ambiguousWith: ['ipeds:167358'] }],
  ['institution', 'Northwestern University', 'ipeds:147767'],
  ['institution', 'Northern Illinois University', 'ipeds:147703'],
  ['institution', 'Boston University', 'ipeds:164988'],
  ['institution', 'Boston College', 'ipeds:164924'],
  ['institution', 'University of Massachusetts Boston', 'ipeds:166638'],
  ['institution', 'University of Miami', 'ipeds:135726'],
  ['institution', 'Florida International University', 'ipeds:133951'],
  ['institution', 'University of Southern California', 'ipeds:123961'],
  ['institution', 'University of Arizona', 'ipeds:104179'],
  ['institution', 'Arizona State University', 'ipeds:104151'],
  ['institution', 'Northern Arizona University', 'ipeds:105330'],
  ['institution', 'Penn State', 'ipeds:214777'],
  ['institution', 'University of Pennsylvania', 'ipeds:215062'],
  ['institution', 'Penn State Erie, The Behrend College', 'ipeds:214591'],
  // Fields of study.
  ['field', 'Computer Science', 'cip:11.0701'],
  ['field', 'CS', 'cip:11.0701'],
  ['field', 'Computer Engineering', 'cip:14.0901'],
  ['field', 'Cognitive Science', 'cip:30.2501'],
  ['field', 'Biology', 'cip:26.0101'],
  ['field', 'Biological Sciences', 'cip:26.0101'],
  ['field', 'Chemistry', 'cip:40.0501'],
  ['field', 'Business', 'cip:52.0101'],
  ['field', 'Computer and Information Sciences', 'cip:11.0101'],
  ['field', 'Engineering', 'cip:14.0101'],
  ['field', 'Economics', 'cip:45.0601'],
  ['field', 'Business Economics', 'cip:52.0601'],
  ['field', 'Finance', 'cip:52.0801'],
  ['field', 'Accounting', 'cip:52.0301'],
  ['field', 'Mechanical Engineering', 'cip:14.1901'],
  ['field', 'Mech. Engineering', 'cip:14.1901'],
  ['field', 'Civil Engineering', 'cip:14.0801'],
  ['field', 'Electrical Engineering', 'cip:14.1001'],
  // Countries.
  ['country', 'United States', 'iso:US'],
  ['country', 'USA', 'iso:US'],
  ['country', 'U.S.', 'iso:US'],
  ['country', 'United States of America', 'iso:US'],
  ['country', 'Canada', 'iso:CA'],
  ['country', 'Mexico', 'iso:MX'],
  ['country', 'UK', 'iso:GB'],
  ['country', 'U.K.', 'iso:GB'],
  ['country', 'United Kingdom', 'iso:GB'],
  ['country', 'South Korea', 'iso:KR'],
  ['country', 'Korea, Republic of', 'iso:KR'],
  ['country', "Korea, Democratic People's Republic of", 'iso:KP'],
  ['country', 'Turkey', 'iso:TR'],
  ['country', 'Türkiye', 'iso:TR'],
  ['country', 'Greece', 'iso:GR'],
  ['country', 'Niger', 'iso:NE'],
  ['country', 'Nigeria', 'iso:NG'],
  ['country', 'Chad', 'iso:TD'],
  ['country', 'Dominica', 'iso:DM'],
  ['country', 'Dominican Republic', 'iso:DO'],
  ['country', 'Jamaica', 'iso:JM'],
  // US states and the district.
  ['region', 'Texas', 'usps:TX'],
  ['region', 'TX', 'usps:TX'],
  ['region', 'OK', 'usps:OK'],
  ['region', 'Oklahoma', 'usps:OK'],
  ['region', 'NM', 'usps:NM'],
  ['region', 'New York', 'usps:NY'],
  ['region', 'NY', 'usps:NY'],
  ['region', 'NJ', 'usps:NJ'],
  ['region', 'Washington, D.C.', 'usps:DC'],
  ['region', 'District of Columbia', 'usps:DC'],
  ['region', 'Washington', 'usps:WA'],
  ['region', 'Puerto Rico', 'usps:PR'],
  ['region', 'PR', 'usps:PR'],
  ['region', 'Virginia', 'usps:VA'],
  ['region', 'West Virginia', 'usps:WV'],
  ['region', 'Maryland', 'usps:MD'],
  ['region', 'Oregon', 'usps:OR'],
  ['region', 'Kansas', 'usps:KS'],
  ['region', 'Arkansas', 'usps:AR'],
  ['region', 'Missouri', 'usps:MO'],
  // How did you hear about us.
  ['referral', 'LinkedIn', 'ref:linkedin'],
  ['referral', 'Indeed', 'ref:indeed'],
  ['referral', 'Glassdoor', 'ref:glassdoor'],
  ['referral', 'Twitter', 'ref:twitter'],
  ['referral', 'X (formerly Twitter)', 'ref:twitter'],
  ['referral', 'Facebook', 'ref:facebook'],
  ['referral', 'Company website', 'ref:company-website'],
  ['referral', 'Company Careers Page', 'ref:company-website'],
  ['referral', 'Referral', 'ref:employee-referral'],
  ['referral', 'Employee Referral', 'ref:employee-referral'],
  ['referral', 'Employee referral', 'ref:employee-referral'],
  ['referral', 'Recruiter', 'ref:recruiter'],
  ['referral', 'Online ad', 'ref:online-ad'],
  ['referral', 'Career fair', 'ref:career-fair'],
  // Degrees: the types and levels the degree cases name.
  ['degree', 'BSc', 'deg:type:BSc'],
  ['degree', 'B.S.', 'deg:type:BS'],
  ['degree', 'Bachelor of Science', 'deg:type:BS'],
  ['degree', 'Bachelor of Arts', 'deg:type:BA'],
  ['degree', 'BEng', 'deg:type:BEng'],
  ['degree', 'Ph.D.', 'deg:type:PhD'],
  ['degree', 'Doctor of Philosophy', 'deg:type:PhD'],
  ['degree', 'JD', 'deg:type:JD'],
  ['degree', 'MBA', 'deg:type:MBA'],
  ['degree', 'High School Diploma', 'deg:type:HSD'],
  ['degree', "Bachelor's Degree", 'deg:level:bachelor'],
  ['degree', 'Bachelors', 'deg:level:bachelor'],
  ['degree', "Master's", 'deg:level:master'],
  ['degree', 'Doctorate', 'deg:level:doctorate'],
  ['degree', 'High School', 'deg:level:highSchool'],
  ['degree', "Associate's", 'deg:level:associate'],
  ['degree', 'Associate Degree', 'deg:level:associate'],
  // Yes and no.
  ['polarity', 'Yes', 'bool:true'],
  ['polarity', 'No', 'bool:false'],
];

describe('every entity the golden table (§6.1, §6.2) needs is present', () => {
  it.each(GOLDEN)('%s %j resolves', (domain, text, expected) => {
    const resolution = resolveText(vocab, domain, text);
    if (typeof expected === 'string') {
      expect(resolution.id).toBe(expected);
      expect(resolution.ambiguous).toBe(false);
    } else {
      expect(resolution.id).toBeNull();
      expect(resolution.ambiguous).toBe(true);
      expect(resolution.hits.map((hit) => hit.id)).toEqual(expect.arrayContaining(expected.ambiguousWith));
    }
  });

  it('resolves the tiers the stages rest on', () => {
    const tier = (domain: VocabDomain, text: string) => resolveText(vocab, domain, text).tier;
    expect(tier('institution', 'UT Austin')).toBe('curated');
    expect(tier('institution', 'University of Texas')).toBe('flagship');
    expect(tier('institution', 'Penn State')).toBe('flagship');
    expect(tier('institution', 'The University of Texas at Dallas')).toBe('primary');
    expect(tier('country', 'USA')).toBe('curated');
    expect(tier('country', 'United Kingdom')).toBe('primary');
    expect(tier('region', 'TX')).toBe('vocab');
    expect(tier('region', 'Texas')).toBe('primary');
    expect(tier('referral', 'Employee Referral')).toBe('curated');
  });

  it('keeps out what the golden table leaves to later stages', () => {
    expect(resolveText(vocab, 'referral', 'Someone who works here told me').hits).toEqual([]);
    expect(resolveText(vocab, 'institution', 'Carnegie Melon University').hits).toEqual([]);
    expect(resolveText(vocab, 'field', 'Financial Engineering').hits).toEqual([]);
    expect(resolveText(vocab, 'country', 'Congo').ambiguous).toBe(true);
  });

  it('knows the answer phrases the golden table uses', () => {
    const { other, placeholders, decline, exclusive, polarity } = vocab.answers;
    for (const text of ['Other', 'Other (please specify)', 'Other - please specify', 'My school is not listed']) {
      expect(other.has(keyFor(text, 'referral')), text).toBe(true);
    }
    for (const text of ['Select...', '-- Select --', 'Please select', 'Choose one', '\u2014']) {
      expect(placeholders.has(keyFor(text, 'referral')), text).toBe(true);
    }
    for (const text of ["I don't wish to answer", 'Decline to self-identify', 'Prefer not to say', 'I do not want to answer']) {
      expect(decline.has(keyFor(text, 'referral')), text).toBe(true);
      expect(exclusive.has(keyFor(text, 'referral')), text).toBe(true);
    }
    expect(exclusive.has(keyFor('None of the above', 'referral'))).toBe(true);
    expect(polarity.yes.has('yes') && polarity.no.has('no')).toBe(true);
    expect(polarity.negators.has('not') && polarity.negators.has('dont')).toBe(true);
  });

  it('holds the EEO answer vocabularies, with each question’s decline phrases', () => {
    const { eeo } = vocab.answers;
    expect(eeo.gender.values.map((value) => value.answerId)).toEqual(['female', 'male', 'non-binary', 'self-describe']);
    expect(eeo.race.values.filter((value) => !value.derived).map((value) => value.answerId)).toEqual([
      'american-indian-alaska-native', 'asian', 'black-african-american', 'middle-eastern-north-african',
      'native-hawaiian-pacific-islander', 'white']);
    expect(eeo.race.values.filter((value) => value.derived).map((value) => value.answerId))
      .toEqual(['two-or-more-races', 'hispanic-latino']);
    expect(resolveText(vocab, 'eeo.race', 'Black or African American').id).toBe('eeo.race:black-african-american');
    expect(resolveText(vocab, 'eeo.hispanicLatino', 'Not Hispanic or Latino').id).toBe('eeo.hispanicLatino:no');
    expect(resolveText(vocab, 'eeo.veteran', 'I am not a protected veteran').id).toBe('eeo.veteran:not-protected-veteran');
    expect(resolveText(vocab, 'eeo.disability', 'Yes, I have a disability (or previously had a disability)').id)
      .toBe('eeo.disability:yes');
    expect(eeo.sexualOrientation.values).toEqual([]);
    expect(eeo.transgender.decline.has(keyFor("I don't wish to answer", 'eeo.gender'))).toBe(true);
    expect(eeo.sexualOrientation.decline.has(keyFor('I prefer not to disclose my sexual orientation', 'eeo.gender')))
      .toBe(true);
  });
});

describe('the guard lexicon (§4.5)', () => {
  it('classes the tokens the golden negatives rest on', () => {
    const { guard } = vocab;
    expect(guard.classesOf('dallas')).toContain('city');
    expect(guard.classesOf('austin')).toContain('city');
    expect(guard.classesOf('erie')).toContain('city');
    expect(guard.classesOf('saint_louis')).toContain('city');
    expect(guard.classesOf('upstate')).toContain('campus');
    expect(guard.classesOf('texas')).toContain('region');
    expect(guard.classesOf('california')).toContain('region');
    expect(guard.classesOf('georgia')).toEqual(expect.arrayContaining(['region', 'country']));
    expect(guard.classesOf('tx')).toEqual(['regionCode']);
    expect(guard.classesOf('northwestern')).toEqual(['direction']);
    expect(guard.classesOf('southern')).toEqual(['direction']);
    expect(guard.classesOf('state')).toEqual(['state']);
    expect(guard.classesOf('technology')).toEqual(['tech']);
    expect(guard.classesOf('engineering')).toEqual(['discipline']);
    expect(guard.classesOf('community')).toEqual(['level']);
    expect(guard.classesOf('university')).toEqual(['headNoun']);
    expect(guard.classesOf('the')).toEqual([]);
    expect(guard.members('headNoun')).toEqual(new Set(INSTITUTION_HEAD_NOUNS));
  });

  it('joins multi-word members, longest first', () => {
    expect(vocab.guard.join(['university', 'michigan', 'ann', 'arbor'])).toEqual(['university', 'michigan', 'ann_arbor']);
    expect(vocab.guard.join(['texas', 'a&m', 'university', 'college', 'station']))
      .toEqual(['texas', 'a&m', 'university', 'college_station']);
    expect(vocab.guard.join(['washington', 'university', 'saint', 'louis'])).toEqual(['washington', 'university', 'saint_louis']);
    expect(vocab.guard.join(['university', 'north', 'carolina', 'chapel', 'hill']))
      .toEqual(['university', 'north_carolina', 'chapel_hill']);
    expect(vocab.guard.join([])).toEqual([]);
  });

  it('gives an institution’s facts as guard tokens', () => {
    const mit = vocab.factTokens('ipeds:166683');
    for (const token of ['cambridge', 'ma', 'massachusetts', 'united_states', 'usa']) expect(mit.has(token), token).toBe(true);
    const utAustin = vocab.factTokens('ipeds:228778');
    expect(utAustin.has('austin') && utAustin.has('texas') && utAustin.has('tx')).toBe(true);
    expect(utAustin.has('dallas')).toBe(false);
    expect(vocab.factTokens('ipeds:218742').has('upstate')).toBe(true);
    expect(vocab.factTokens('cip:11.0701').size).toBe(0);
    const toronto = resolveText(vocab, 'institution', 'University of Toronto').id!;
    expect([...vocab.factTokens(toronto)]).toEqual(expect.arrayContaining(['toronto', 'ontario', 'canada']));
  });

  it('lists the flagships', () => {
    expect(vocab.flagships.map((flagship) => [flagship.bare, flagship.id])).toEqual(expect.arrayContaining([
      ['University of Texas', 'ipeds:228778'], ['University of Michigan', 'ipeds:170976'],
      ['University of Washington', 'ipeds:236948'], ['Penn State', 'ipeds:214777'],
      ['Texas A&M University', 'ipeds:228723']]));
  });
});

describe('the tables', () => {
  it('walks the CIP hierarchy', () => {
    const { fields } = vocab;
    expect(fields.byCode('11.0701')?.name).toBe('Computer Science');
    expect(fields.parentOf('cip:11.0701')).toBe('cip:11.07');
    expect(fields.ancestorsOf('cip:11.0701')).toEqual(['cip:11.07', 'cip:11']);
    expect(fields.isSameOrAncestor('cip:11', 'cip:11.0701')).toBe(true);
    expect(fields.isSameOrAncestor('cip:14', 'cip:11.0701')).toBe(false);
    expect(fields.mostSpecific(['cip:11', 'cip:11.0701', 'cip:11.07'])).toBe('cip:11.0701');
    expect(fields.mostSpecific(['cip:11.0701', 'cip:14.0901'])).toBeNull();
    expect(fields.mostSpecific([])).toBeNull();
    expect(fields.byCode('11')?.digits).toBe(2);
    expect(fields.byCode('11.0101')?.general).toBe(true);
    expect(fields.byCode('11.0701')?.general).toBe(false);
    // A family's general title names the family too, so "Computer and Information Sciences" reaches cip:11.
    const hits = vocab.lookup('field', keyFor('Computer and Information Sciences', 'field')).map((hit) => hit.id);
    expect(hits).toEqual(expect.arrayContaining(['cip:11.0101', 'cip:11.01', 'cip:11']));
  });

  it('looks countries, regions and languages up by code', () => {
    expect(vocab.countries.byAlpha2('us')?.alpha3).toBe('USA');
    expect(vocab.countries.byAlpha3('GBR')?.alpha2).toBe('GB');
    expect(vocab.countries.byAlpha2('XK')).toBeUndefined();
    expect(vocab.regions.byCode('US', 'tx')?.name).toBe('Texas');
    expect(vocab.regions.byCode('CA', 'ON')?.id).toBe('capost:ON');
    expect(vocab.regions.byCode('US', 'ON')).toBeUndefined();
    expect(vocab.regions.ofCountry('FR')).toEqual([]);
    expect(vocab.languages.byCode('EN')?.name).toBe('English');
    expect(vocab.languages.byCode('yue')?.name).toBe('Cantonese');
    expect(resolveText(vocab, 'language', 'Farsi').id).toBe('lang:fa');
    expect(resolveText(vocab, 'language', 'Mandarin').id).toBe('lang:zh');
    expect(resolveText(vocab, 'proficiency', 'Native or bilingual proficiency').id).toBe('prof:native');
    expect(resolveText(vocab, 'proficiency', 'B2').tier).toBe('generated');
  });

  it('knows the degree classes, levels and fallbacks', () => {
    const { degrees } = vocab;
    expect(degrees.classOf('BSc')).toBe('BS');
    expect(degrees.classOf('BS')).toBe('BS');
    expect(degrees.classOf('DPhil')).toBe('PhD');
    expect(degrees.classOf('BA')).toBe('BA');
    expect(degrees.classOf('BEng')).not.toBe(degrees.classOf('BS'));
    expect(degrees.type('MBA')).toMatchObject({ level: 'professional', alsoCountsAs: ['master'] });
    expect(degrees.type('JD')).toMatchObject({ level: 'professional', alsoCountsAs: ['doctorate'] });
    expect(degrees.type('MEd').codes).toEqual(['M.Ed.']);
    expect(degrees.type('AS').wordLikeCodes).toEqual(['A.S.']);
    expect(degrees.level('bachelor').name).toBe("Bachelor's degree");
  });

  it('gives the referral sources’ mention phrases and nothing generic', () => {
    const phrases = vocab.phrases('referral');
    expect(phrases.get('linkedin')?.map((phrase) => phrase.id)).toEqual(['ref:linkedin']);
    expect(phrases.get('linked')?.[0]?.tokens).toEqual(['linked', 'in']);
    expect(phrases.has('job')).toBe(false);
    const countries = vocab.phrases('country').get('united') ?? [];
    expect(countries[0]!.tokens.length).toBeGreaterThanOrEqual(countries[countries.length - 1]!.tokens.length);
  });
});

describe('lookup.ts', () => {
  it('resolveKey: one entity, a line of descent, a shared key, or nothing', () => {
    expect(resolveKey(vocab, 'institution', 'mit')).toMatchObject({ id: 'ipeds:166683', tier: 'curated', ambiguous: false });
    expect(resolveKey(vocab, 'field', 'computer science')).toMatchObject({ id: 'cip:11.0701', ambiguous: false });
    expect(resolveKey(vocab, 'field', 'computer science').hits.length).toBe(2);
    expect(resolveKey(vocab, 'institution', 'usc')).toMatchObject({ id: null, tier: null, ambiguous: true });
    expect(resolveKey(vocab, 'institution', 'no such school at all')).toEqual({ id: null, tier: null, hits: [],
      ambiguous: false });
    expect(resolveKey(vocab, 'generic', 'option b').hits).toEqual([]);
  });

  it('lists hits best tier first', () => {
    const hits = vocab.lookup('institution', 'ut austin');
    expect(hits).toEqual([{ id: 'ipeds:228778', tier: 'curated', ambiguous: false }]);
  });

  it('surfacesOf puts the person’s spelling first', () => {
    const entity = vocab.entity('ipeds:228778')!;
    const surfaces = surfacesOf(entity, ' UT Austin ');
    expect(surfaces[0]).toEqual({ text: 'UT Austin', tier: 'raw', ambiguous: false });
    expect(surfaces[1]).toEqual({ text: 'The University of Texas at Austin', tier: 'primary', ambiguous: false });
    expect(surfacesOf(entity, '').length).toBe(entity.surfaces.length);
  });

  it('isAcronym', () => {
    for (const text of ['MIT', 'UCLA', 'U.C.L.A.', 'A&M', 'CS50']) expect(isAcronym(text), text).toBe(true);
    for (const text of ['UMich', 'Georgia Tech', 'M', 'TOOLONGNAME']) expect(isAcronym(text), text).toBe(false);
  });
});

describe('createVocab', () => {
  it('refuses data built by another normalizer version', () => {
    const stale = { ...raw, manifest: { ...raw.manifest, normalizerVersion: NORMALIZER_VERSION + 1 } };
    expect(() => createVocab(stale)).toThrow(/normalizer version/);
  });

  it('builds a domain only when it is first asked for, and quickly', () => {
    const started = process.hrtime.bigint();
    const fresh = createVocab(raw);
    fresh.lookup('institution', 'mit');
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(fresh.entity('ipeds:166683')?.name).toBe('Massachusetts Institute of Technology');
    expect(ms).toBeLessThan(1_000);
  });
});
