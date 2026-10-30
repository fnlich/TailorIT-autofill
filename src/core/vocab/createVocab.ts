/*
 * Builds the read-only Vocab from the parsed data files (docs/design/core.md §5). It is pure: the worker reads the
 * JSON and passes it in, and nothing here touches the network or the disk. The worker builds it on every wake, so
 * each domain's entities and key index are made the first time that domain is asked for, and the institution facts
 * as guard tokens are made per institution on first use. stableStringify is the one serialization of the data: the
 * build writes the files with it and the vocabulary test re-hashes them through it.
 */
import type { DegreeType } from '../enums';
import { normalize, NORMALIZER_VERSION } from '../text/normalize';
import type { VocabDomain } from '../types/intent';
import {
  EEO_QUESTIONS, GUARD_CLASSES, type AnswerTables, type CountryEntity, type CountryTables, type DegreeLevelEntity,
  type DegreeTables, type DegreeTypeEntity, type EeoAnswers, type EeoEntity, type EeoQuestion, type FieldEntity,
  type FieldTables, type Flagship, type GuardClass, type GuardLexicon, type InstitutionEntity, type KeyHit,
  type LanguageEntity, type LanguageTables, type Phrase, type PhraseSet, type PolarityEntity, type ProficiencyEntity,
  type RawPhrase, type RawSurface, type RawTier, type RawVocab, type ReferralEntity, type RegionEntity,
  type RegionTables, type Vocab, type VocabEntity, type VocabSurface, type VocabTier,
} from './types';

// ---------------------------------------------------------------------------------------------------------------
// Stable serialization

/** Containers at this depth or shallower put each item on its own line (one record per line in every data file);
 *  deeper ones are written compact. */
const LINE_DEPTH = 2;

/**
 * JSON with object keys sorted (UTF-16 order), no spaces, LF line ends and a final LF: the same value always gives
 * the same text, so its SHA-256 identifies it. Undefined object members are left out, as JSON.stringify does; any
 * other value JSON cannot hold (undefined in an array, a function, a non-finite number) throws.
 */
export function stableStringify(value: unknown): string {
  return `${writeValue(value, 0)}\n`;
}

function writeValue(value: unknown, depth: number): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`stableStringify cannot write the number ${String(value)}.`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error(`stableStringify cannot write a ${typeof value}.`);
  const lines = depth < LINE_DEPTH;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item: unknown) => writeValue(item, depth + 1));
    return lines ? `[\n${items.join(',\n')}\n]` : `[${items.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  if (keys.length === 0) return '{}';
  const items = keys.map((key) => `${JSON.stringify(key)}:${writeValue(record[key], depth + 1)}`);
  return lines ? `{\n${items.join(',\n')}\n}` : `{${items.join(',')}}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers

const TIER_OF: Readonly<Record<RawTier, VocabTier>> = {
  p: 'primary', c: 'curated', v: 'vocab', g: 'generated', f: 'flagship',
};
/** Best first: the order of SURFACE_TIERS without 'raw'. */
const TIER_RANK: Readonly<Record<VocabTier, number>> = {
  primary: 0, curated: 1, vocab: 2, generated: 3, flagship: 4,
};

function toSurface(raw: RawSurface): VocabSurface {
  return { text: raw[0], key: raw[1], tier: TIER_OF[raw[2]], ambiguous: raw[3] === 1 };
}

function toSurfaces(raw: readonly RawSurface[]): VocabSurface[] {
  return raw.map(toSurface);
}

function phraseSet(phrases: readonly RawPhrase[]): PhraseSet {
  const list = phrases.map(([text, key]) => ({ text, key }));
  const keys = new Set(list.map((phrase) => phrase.key));
  return { phrases: list, has: (key) => keys.has(key) };
}

/** Curated phrase lists become surfaces of one entity (the yes and no entities of the polarity domain). */
function phraseSurfaces(phrases: readonly RawPhrase[]): VocabSurface[] {
  return phrases.map(([text, key]) => ({ text, key, tier: 'curated', ambiguous: false }));
}

const EMPTY_TOKENS: ReadonlySet<string> = new Set();

/** The lookup domain of each EEO question that has answer values. */
const EEO_DOMAIN: Readonly<Partial<Record<EeoQuestion, VocabDomain>>> = {
  gender: 'eeo.gender', race: 'eeo.race', hispanicLatino: 'eeo.hispanicLatino', veteran: 'eeo.veteran',
  disability: 'eeo.disability',
};

/** The domain an entity id belongs to, from its prefix. */
function domainOfId(id: string): VocabDomain | null {
  const colon = id.indexOf(':');
  if (colon < 0) return null;
  const prefix = id.slice(0, colon);
  switch (prefix) {
    case 'ipeds':
    case 'ror':
      return 'institution';
    case 'cip':
      return 'field';
    case 'iso':
      return 'country';
    case 'usps':
    case 'capost':
      return 'region';
    case 'lang':
      return 'language';
    case 'prof':
      return 'proficiency';
    case 'deg':
      return 'degree';
    case 'ref':
      return 'referral';
    case 'bool':
      return 'polarity';
    case 'eeo.gender':
    case 'eeo.race':
    case 'eeo.hispanicLatino':
    case 'eeo.veteran':
    case 'eeo.disability':
      return prefix;
    default:
      return null;
  }
}

/** The code above a CIP code that the data holds: '11.0701' gives '11.07' (or '11' when '11.07' is missing). */
function parentCode(cip: string, known: ReadonlySet<string>): string | null {
  const candidates = cip.length === 7 ? [cip.slice(0, 5), cip.slice(0, 2)] : cip.length === 5 ? [cip.slice(0, 2)] : [];
  return candidates.find((code) => known.has(code)) ?? null;
}

interface DomainData {
  entities: VocabEntity[];
  byId: Map<string, VocabEntity>;
  index: Map<string, KeyHit[]>;
  phrases: Map<string, Phrase[]> | null;
}

// ---------------------------------------------------------------------------------------------------------------
// createVocab

/**
 * The Vocab over the parsed data files. Throws when the data was built by another normalizer version: its keys
 * would not equal the keys computed now, so every lookup would silently miss.
 */
export function createVocab(raw: RawVocab): Vocab {
  if (raw.manifest.normalizerVersion !== NORMALIZER_VERSION) {
    throw new Error(`The vocabulary was built with normalizer version ${raw.manifest.normalizerVersion}, but this `
      + `code is version ${NORMALIZER_VERSION}. Run npm run vocab:build.`);
  }

  const domains = new Map<VocabDomain, DomainData>();

  function build(domain: VocabDomain): VocabEntity[] {
    switch (domain) {
      case 'institution':
        return institutions();
      case 'field':
        return fieldCodes();
      case 'country':
        return raw.countries.countries.map((country): CountryEntity => ({
          kind: 'country', id: `iso:${country.a2}`, name: country.s[0]![0], surfaces: toSurfaces(country.s),
          alpha2: country.a2, alpha3: country.a3,
        }));
      case 'region':
        return raw.regions.regions.map((region): RegionEntity => ({
          kind: 'region', id: `${region.cc === 'US' ? 'usps' : 'capost'}:${region.code}`, name: region.s[0]![0],
          surfaces: toSurfaces(region.s), code: region.code, country: region.cc, regionKind: region.kind,
        }));
      case 'language':
        return raw.languages.languages.map((language): LanguageEntity => ({
          kind: 'language', id: `lang:${language.code}`, name: language.s[0]![0], surfaces: toSurfaces(language.s),
          code: language.code,
        }));
      case 'proficiency':
        return raw.languages.proficiency.map((entry): ProficiencyEntity => ({
          kind: 'proficiency', id: `prof:${entry.id}`, name: entry.s[0]![0], surfaces: toSurfaces(entry.s),
          proficiency: entry.id,
        }));
      case 'degree':
        return [...degreeTypes(), ...degreeLevels()];
      case 'referral':
        return raw.answers.referral.map((entry): ReferralEntity => ({
          kind: 'referral', id: `ref:${entry.id}`, name: entry.s[0]![0], surfaces: toSurfaces(entry.s),
          answerId: entry.id, mentions: (entry.m ?? []).map((key) => key.split(' ')),
        }));
      case 'eeo.gender':
      case 'eeo.race':
      case 'eeo.hispanicLatino':
      case 'eeo.veteran':
      case 'eeo.disability':
        return eeoValues(domain.slice(4) as EeoQuestion);
      case 'polarity':
        return [
          { kind: 'polarity', id: 'bool:true', name: raw.answers.polarity.yes[0]![0],
            surfaces: phraseSurfaces(raw.answers.polarity.yes), value: true },
          { kind: 'polarity', id: 'bool:false', name: raw.answers.polarity.no[0]![0],
            surfaces: phraseSurfaces(raw.answers.polarity.no), value: false },
        ] satisfies PolarityEntity[];
      case 'generic':
        return [];
    }
  }

  function institutions(): InstitutionEntity[] {
    const us = raw.institutionsUs;
    const usRegions = new Map(raw.regions.regions.filter((region) => region.cc === 'US')
      .map((region) => [region.code, region.s[0]![0]]));
    const list: InstitutionEntity[] = us.institutions.map((entry) => ({
      kind: 'institution',
      id: `ipeds:${entry.id}`,
      name: entry.s[0]![0],
      surfaces: toSurfaces(entry.s),
      source: 'ipeds',
      facts: {
        city: entry.city,
        regionCode: entry.st,
        regionName: usRegions.get(entry.st),
        country: entry.cc ?? 'US',
        campus: entry.campus,
        system: entry.sys === undefined ? undefined : us.systems[entry.sys],
      },
    }));
    for (const entry of raw.institutionsGlobal.institutions) {
      list.push({
        kind: 'institution', id: `ror:${entry.id}`, name: entry.s[0]![0], surfaces: toSurfaces(entry.s), source: 'ror',
        facts: { city: entry.city, regionName: entry.sub, country: entry.cc },
      });
    }
    return list;
  }

  function fieldCodes(): FieldEntity[] {
    const known = new Set(raw.fields.codes.map((code) => code.cip));
    return raw.fields.codes.map((code) => {
      const parent = parentCode(code.cip, known);
      return {
        kind: 'field', id: `cip:${code.cip}`, name: code.s[0]![0], surfaces: toSurfaces(code.s), cip: code.cip,
        digits: code.cip.length === 2 ? 2 : code.cip.length === 5 ? 4 : 6,
        parent: parent === null ? null : `cip:${parent}`, general: code.general === 1,
      };
    });
  }

  function degreeTypes(): DegreeTypeEntity[] {
    const classOf = degreeClassMap();
    return raw.degrees.types.map((entry) => ({
      kind: 'degree-type', id: `deg:type:${entry.type}`, name: entry.s[0]![0], surfaces: toSurfaces(entry.s),
      type: entry.type, level: entry.level, alsoCountsAs: entry.also ?? [], codes: entry.codes,
      wordLikeCodes: entry.wordLike ?? [], degreeClass: classOf.get(entry.type) ?? entry.type,
    }));
  }

  function degreeLevels(): DegreeLevelEntity[] {
    return raw.degrees.levels.map((entry) => ({
      kind: 'degree-level', id: `deg:level:${entry.level}`, name: entry.s[0]![0], surfaces: toSurfaces(entry.s),
      level: entry.level,
    }));
  }

  let classMap: Map<DegreeType, DegreeType> | null = null;
  function degreeClassMap(): Map<DegreeType, DegreeType> {
    if (classMap) return classMap;
    classMap = new Map();
    for (const members of raw.degrees.classes) {
      for (const member of members) classMap.set(member, members[0]!);
    }
    return classMap;
  }

  function eeoValues(question: EeoQuestion): EeoEntity[] {
    return raw.answers.eeo[question].values.map((value) => ({
      kind: 'eeo', id: `eeo.${question}:${value.id}`, name: value.s[0]![0], surfaces: toSurfaces(value.s), question,
      answerId: value.id, derived: value.derived === 1,
    }));
  }

  function data(domain: VocabDomain): DomainData {
    const existing = domains.get(domain);
    if (existing) return existing;
    const entities = build(domain);
    const byId = new Map<string, VocabEntity>();
    const index = new Map<string, KeyHit[]>();
    for (const entity of entities) {
      byId.set(entity.id, entity);
      for (const surface of entity.surfaces) {
        let hits = index.get(surface.key);
        if (!hits) index.set(surface.key, hits = []);
        const same = hits.findIndex((hit) => hit.id === entity.id);
        const hit: KeyHit = { id: entity.id, tier: surface.tier, ambiguous: surface.ambiguous };
        if (same < 0) hits.push(hit);
        else if (TIER_RANK[surface.tier] < TIER_RANK[hits[same]!.tier]) hits[same] = hit;
      }
    }
    for (const hits of index.values()) {
      if (hits.length > 1) hits.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
    }
    const made: DomainData = { entities, byId, index, phrases: null };
    domains.set(domain, made);
    return made;
  }

  function phrases(domain: VocabDomain): Map<string, Phrase[]> {
    const domainData = data(domain);
    if (domainData.phrases) return domainData.phrases;
    const list: Phrase[] = [];
    if (domain === 'referral') {
      const owners = new Map<string, Set<string>>();
      for (const entity of domainData.entities as ReferralEntity[]) {
        for (const tokens of entity.mentions) {
          const key = tokens.join(' ');
          if (!owners.has(key)) owners.set(key, new Set());
          owners.get(key)!.add(entity.id);
        }
      }
      for (const entity of domainData.entities as ReferralEntity[]) {
        for (const tokens of entity.mentions) {
          list.push({ tokens, id: entity.id, tier: 'curated', ambiguous: owners.get(tokens.join(' '))!.size > 1 });
        }
      }
    } else {
      for (const entity of domainData.entities) {
        for (const surface of entity.surfaces) {
          if (surface.key === '') continue;
          list.push({ tokens: surface.key.split(' '), id: entity.id, tier: surface.tier, ambiguous: surface.ambiguous });
        }
      }
    }
    const byFirst = new Map<string, Phrase[]>();
    for (const phrase of list) {
      const first = phrase.tokens[0]!;
      if (!byFirst.has(first)) byFirst.set(first, []);
      byFirst.get(first)!.push(phrase);
    }
    for (const group of byFirst.values()) group.sort((a, b) => b.tokens.length - a.tokens.length);
    domainData.phrases = byFirst;
    return byFirst;
  }

  function entity(id: string): VocabEntity | undefined {
    const domain = domainOfId(id);
    return domain === null ? undefined : data(domain).byId.get(id);
  }

  // The guard's lexicon.
  const classMembers = new Map<GuardClass, Set<string>>();
  const tokenClasses = new Map<string, GuardClass[]>();
  const phraseStarts = new Map<string, string[][]>();
  for (const guardClass of GUARD_CLASSES) {
    const members = new Set(raw.lexicon.guard[guardClass]);
    classMembers.set(guardClass, members);
    for (const member of members) {
      const classes = tokenClasses.get(member);
      if (classes) classes.push(guardClass);
      else tokenClasses.set(member, [guardClass]);
      if (!member.includes('_')) continue;
      const tokens = member.split('_');
      const starts = phraseStarts.get(tokens[0]!);
      if (!starts) phraseStarts.set(tokens[0]!, [tokens]);
      else if (!starts.some((known) => known.join('_') === member)) starts.push(tokens);
    }
  }
  for (const starts of phraseStarts.values()) starts.sort((a, b) => b.length - a.length);
  const guard: GuardLexicon = {
    classesOf: (token) => tokenClasses.get(token) ?? [],
    has: (guardClass, token) => classMembers.get(guardClass)!.has(token),
    members: (guardClass) => classMembers.get(guardClass)!,
    join(tokens) {
      const out: string[] = [];
      let i = 0;
      while (i < tokens.length) {
        let length = 1;
        for (const phrase of phraseStarts.get(tokens[i]!) ?? []) {
          if (phrase.length <= tokens.length - i && phrase.every((token, j) => tokens[i + j] === token)) {
            length = phrase.length;
            break;
          }
        }
        out.push(length === 1 ? tokens[i]! : tokens.slice(i, i + length).join('_'));
        i += length;
      }
      return out;
    },
  };

  // Lookup tables over the domains.
  const fields: FieldTables = {
    byCode: (cip) => entity(`cip:${cip}`) as FieldEntity | undefined,
    parentOf: (id) => (entity(id) as FieldEntity | undefined)?.parent ?? null,
    ancestorsOf(id) {
      const out: string[] = [];
      for (let parent = fields.parentOf(id); parent !== null; parent = fields.parentOf(parent)) out.push(parent);
      return out;
    },
    isSameOrAncestor: (a, b) => a === b || fields.ancestorsOf(b).includes(a),
    mostSpecific(ids) {
      const unique = [...new Set(ids)];
      return unique.find((candidate) => unique.every((id) => fields.isSameOrAncestor(id, candidate))) ?? null;
    },
  };

  let countryCodes: { a2: Map<string, CountryEntity>; a3: Map<string, CountryEntity> } | null = null;
  const countryMaps = () => {
    if (!countryCodes) {
      const list = data('country').entities as CountryEntity[];
      countryCodes = { a2: new Map(list.map((c) => [c.alpha2, c])), a3: new Map(list.map((c) => [c.alpha3, c])) };
    }
    return countryCodes;
  };
  const countries: CountryTables = {
    byAlpha2: (code) => countryMaps().a2.get(code.toUpperCase()),
    byAlpha3: (code) => countryMaps().a3.get(code.toUpperCase()),
  };

  const regions: RegionTables = {
    ofCountry: (country) => (data('region').entities as RegionEntity[])
      .filter((region) => region.country === country.toUpperCase()),
    byCode: (country, code) => (data('region').entities as RegionEntity[])
      .find((region) => region.country === country.toUpperCase() && region.code === code.toUpperCase()),
  };

  const languages: LanguageTables = {
    byCode: (code) => entity(`lang:${code.toLowerCase()}`) as LanguageEntity | undefined,
  };

  const degrees: DegreeTables = {
    get types() {
      return data('degree').entities.filter((e): e is DegreeTypeEntity => e.kind === 'degree-type');
    },
    get levels() {
      return data('degree').entities.filter((e): e is DegreeLevelEntity => e.kind === 'degree-level');
    },
    type: (type) => entity(`deg:type:${type}`) as DegreeTypeEntity,
    level: (level) => entity(`deg:level:${level}`) as DegreeLevelEntity,
    classOf: (type) => degreeClassMap().get(type) ?? type,
  };

  const genericDecline = phraseSet(raw.answers.decline);
  const eeoTables = {} as Record<EeoQuestion, EeoAnswers>;
  for (const question of EEO_QUESTIONS) {
    const own = raw.answers.eeo[question];
    const seen = new Set(raw.answers.decline.map(([, key]) => key));
    const extra = own.decline.filter(([, key]) => !seen.has(key));
    eeoTables[question] = {
      get values() {
        const domain = EEO_DOMAIN[question];
        return domain === undefined ? [] : data(domain).entities as EeoEntity[];
      },
      decline: phraseSet([...raw.answers.decline, ...extra]),
    };
  }
  const answers: AnswerTables = {
    get referral() {
      return data('referral').entities as ReferralEntity[];
    },
    eeo: eeoTables,
    polarity: {
      yes: phraseSet(raw.answers.polarity.yes),
      no: phraseSet(raw.answers.polarity.no),
      negators: new Set(raw.answers.polarity.negators),
    },
    decline: genericDecline,
    exclusive: phraseSet(raw.answers.exclusive),
    other: phraseSet(raw.answers.other),
    placeholders: phraseSet(raw.answers.placeholders),
  };

  // Facts as guard tokens, per institution, on first use.
  const factCache = new Map<string, ReadonlySet<string>>();
  function factTokens(id: string): ReadonlySet<string> {
    const cached = factCache.get(id);
    if (cached) return cached;
    const found = entity(id);
    if (!found || found.kind !== 'institution') return EMPTY_TOKENS;
    const tokens = new Set<string>();
    const add = (text: string | undefined) => {
      if (text) for (const token of guard.join(normalize(text, 'institution').core)) tokens.add(token);
    };
    const { city, campus, regionCode, regionName, country } = found.facts;
    add(city);
    add(campus);
    add(regionName);
    if (regionCode) {
      tokens.add(regionCode.toLowerCase());
      for (const surface of regions.byCode('US', regionCode)?.surfaces ?? []) add(surface.text);
    }
    for (const surface of countries.byAlpha2(country)?.surfaces ?? []) add(surface.text);
    factCache.set(id, tokens);
    return tokens;
  }

  const flagships: readonly Flagship[] = raw.lexicon.flagships.map((entry) => ({ ...entry }));
  const releases: Record<string, string> = {};
  for (const [source, info] of Object.entries(raw.manifest.sources)) releases[source] = info.release;

  return {
    normalizerVersion: raw.manifest.normalizerVersion,
    releases,
    entity,
    entities: (domain) => data(domain).entities,
    lookup: (domain, key) => data(domain).index.get(key) ?? [],
    phrases,
    df: (domain, token) => raw.lexicon.df[domain]?.t[token] ?? 0,
    docCount: (domain) => raw.lexicon.df[domain]?.n ?? 0,
    guard,
    factTokens,
    flagships,
    degrees,
    fields,
    countries,
    regions,
    languages,
    answers,
  };
}
