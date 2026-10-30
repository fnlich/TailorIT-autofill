/*
 * The vocabularies in their two shapes (docs/design/core.md §5): the raw JSON that scripts/vocab-build.ts writes into
 * src/core/vocab/data/, and the Vocab that createVocab builds from it for the matcher, the resolver and the entity
 * canonicalizers. Core code never imports the JSON: the worker parses it once and hands the objects to createVocab,
 * and tests load it through bundled.testkit.ts. The data files are compact on purpose (each has a size budget), so
 * their records use short field names; Vocab gives every one of them a documented name.
 */
import type { DegreeLevel, DegreeType, Proficiency } from '../enums';
import type { NormContext } from '../text/normalize';
import type { SurfaceTier, VocabDomain } from '../types/intent';

// ---------------------------------------------------------------------------------------------------------------
// The files

/** The generated files, by their key in RawVocab. */
export const VOCAB_FILES = {
  manifest: 'manifest.json',
  institutionsUs: 'institutions-us.json',
  institutionsGlobal: 'institutions-global.json',
  fields: 'fields.json',
  degrees: 'degrees.json',
  countries: 'countries.json',
  regions: 'regions.json',
  languages: 'languages.json',
  answers: 'answers.json',
  lexicon: 'lexicon.json',
} as const;
export type VocabFile = keyof typeof VOCAB_FILES;

/**
 * Each file's size budget in bytes (§5.1, in KiB): the build exits 1 when a file is larger. fields.json's is 430 KiB,
 * not the design's 150 KB, and waits for the owner's approval (core.md §5.1 still says 150 KB): CIP's codes for
 * credit programmes (about 2,500 once the non-credit families 32-37 are left out) with their stored keys measure about
 * 410 KiB, the 6-digit titles and keys alone over 200 KB, so the budget is that plus about 5%. Every file together
 * stays under the design's 2.2 MB total.
 */
export const VOCAB_BUDGETS: Readonly<Record<VocabFile, number>> = {
  manifest: 5 * 1024,
  institutionsUs: 700 * 1024,
  institutionsGlobal: 900 * 1024,
  fields: 430 * 1024,
  degrees: 30 * 1024,
  countries: 60 * 1024,
  regions: 15 * 1024,
  languages: 25 * 1024,
  answers: 60 * 1024,
  lexicon: 250 * 1024,
};

/** The normalization context each domain's keys are built in. A lookup key must be computed in the same one. */
export const DOMAIN_CONTEXT: Readonly<Record<VocabDomain, NormContext>> = {
  institution: 'institution',
  degree: 'degree',
  field: 'field',
  country: 'country',
  region: 'region',
  language: 'answer',
  proficiency: 'answer',
  referral: 'answer',
  'eeo.gender': 'answer',
  'eeo.race': 'answer',
  'eeo.hispanicLatino': 'answer',
  'eeo.veteran': 'answer',
  'eeo.disability': 'answer',
  polarity: 'answer',
  generic: 'answer',
};

// ---------------------------------------------------------------------------------------------------------------
// Raw data (what the build writes)

/** A surface's tier as the data files write it: primary, curated, vocab (from a source), generated, flagship. */
export const RAW_TIERS = ['p', 'c', 'v', 'g', 'f'] as const;
export type RawTier = (typeof RAW_TIERS)[number];

/**
 * One spelling of an entity: its text, its key (`normalize(text, DOMAIN_CONTEXT[domain]).key`), its tier, and a
 * trailing flag when the key is ambiguous: 1 when another entity of the domain shares it (inside the bundle or among
 * the ROR records the subset left out) or it holds the unresolved "st?" token, 2 when it is a short form or shared
 * name that more institutions answer to than hold it (an uncurated acronym, "U of M", "Trinity"). An entity's first
 * surface is its display name.
 */
export type RawSurface = [text: string, key: string, tier: RawTier]
  | [text: string, key: string, tier: RawTier, ambiguous: 1 | 2];

/** A phrase of an answer list (decline, exclusive, other, placeholder, yes, no): its text and its key. */
export type RawPhrase = [text: string, key: string];

/** One IPEDS institution (institutions-us.json). */
export interface RawIpedsInstitution {
  /** UNITID. */
  id: string;
  /** Surfaces, the display name first. */
  s: RawSurface[];
  /** CITY. */
  city: string;
  /** STABBR: the USPS code of the state, district or territory. */
  st: string;
  /** ISO 3166-1 alpha-2 when `st` is a territory or freely associated state with its own code (PR, GU, ...);
   *  absent means 'US'. */
  cc?: string;
  /** The campus suffix of INSTNM ("Ann Arbor", "Upstate"), absent for "Main Campus" and names without one. */
  campus?: string;
  /** Index into RawInstitutionsUs.systems (F1SYSNAM). */
  sys?: number;
}

/** institutions-us.json: degree-granting, active, open institutions from IPEDS HD. */
export interface RawInstitutionsUs {
  /** The IPEDS release ('HD2024'). */
  release: string;
  /** System names (F1SYSNAM), sorted. */
  systems: string[];
  /** Sorted by UNITID. */
  institutions: RawIpedsInstitution[];
}

/** One ROR organization (institutions-global.json). */
export interface RawRorInstitution {
  /** The ROR id without the https://ror.org/ prefix. */
  id: string;
  /** Surfaces, the display name first. */
  s: RawSurface[];
  /** The first location's city. */
  city?: string;
  /** The first location's subdivision ("Ontario", "England"). */
  sub?: string;
  /** ISO 3166-1 alpha-2. */
  cc: string;
}

/** institutions-global.json: the ROR subset outside the US. */
export interface RawInstitutionsGlobal {
  /** The ROR release ('v2.15-2026-10-20'). */
  release: string;
  /** The country priority list the subset was filled from. */
  priority: string[];
  /** How many records each country contributed. */
  counts: Record<string, number>;
  /** Sorted by id. */
  institutions: RawRorInstitution[];
}

/** One CIP code (fields.json). */
export interface RawFieldCode {
  /** '11', '11.07' or '11.0701'. */
  cip: string;
  /** Surfaces, the display name first. */
  s: RawSurface[];
  /** 1 on the general program of a family (xx.0000 or xx.0101 titled "..., General", with its series): its title is
   *  also one of the family's surfaces. */
  general?: 1;
}

/** fields.json: CIP 2020 codes at all three levels, without deleted or moved ones. */
export interface RawFields {
  /** The CIP edition ('2020'). */
  release: string;
  /** Sorted by code, so a family comes before its series and codes. */
  codes: RawFieldCode[];
}

/** One degree type (degrees.json). */
export interface RawDegreeType {
  /** The type's id. */
  type: DegreeType;
  /** The level it is. */
  level: DegreeLevel;
  /** Levels a list without `level` may take it as, always flagged: MBA as master, JD or MD as doctorate. */
  also?: DegreeLevel[];
  /** Abbreviations written with their dots ("B.S.", "Ph.D."): parseDegree's regex table is built from them. */
  codes: string[];
  /** Codes whose undotted form is also an English word ("A.S.", "D.O."): undotted, they count only in upper case. */
  wordLike?: string[];
  /** Long names, undotted codes and the id, the display name first. */
  s: RawSurface[];
}

/** One degree level and its phrases ("Bachelor's", "4-year degree"). */
export interface RawDegreeLevel {
  /** The level. */
  level: DegreeLevel;
  /** Its phrases, the display name first. */
  s: RawSurface[];
}

/** degrees.json: types, levels and equivalence classes (§4.9). */
export interface RawDegrees {
  /** In DEGREE_TYPES order. */
  types: RawDegreeType[];
  /** In DEGREE_LEVELS order. */
  levels: RawDegreeLevel[];
  /** Types that are the same degree ({BS, BSc}, {MS, MSc}, {PhD, DPhil}); the first is the class's name. */
  classes: DegreeType[][];
}

/** countries.json: ISO 3166-1 with CLDR English names and curated aliases. */
export interface RawCountries {
  /** The CLDR release ('49.0.0'). */
  release: string;
  /** Sorted by alpha-2: each country's alpha-2 and alpha-3 codes and its surfaces, CLDR's name first. */
  countries: Array<{ a2: string; a3: string; s: RawSurface[] }>;
}

/** What a region is: a US state, district, territory, freely associated state or military "state", or a Canadian
 *  province or territory. */
export const REGION_KINDS = ['state', 'district', 'territory', 'freely-associated', 'military', 'province'] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

/** regions.json: USPS Publication 28 and Canada Post codes with names and curated aliases. */
export interface RawRegions {
  /** Sorted by country, then code: the country ('US' for every USPS code, 'CA'), the code, the kind and the
   *  surfaces, the name first. */
  regions: Array<{ cc: string; code: string; kind: RegionKind; s: RawSurface[] }>;
}

/** languages.json: ISO 639-1 (plus a few curated codes) with CLDR English names, and proficiency phrases. */
export interface RawLanguages {
  /** The CLDR release. */
  release: string;
  /** Sorted by code: each language's code and surfaces, CLDR's name first. */
  languages: Array<{ code: string; s: RawSurface[] }>;
  /** In PROFICIENCIES order. ILR names are curated; CEFR levels are a crosswalk, stored at the generated tier so a
   *  match through them is filled and flagged. */
  proficiency: Array<{ id: Proficiency; s: RawSurface[] }>;
}

/** The EEO questions with answer vocabularies. Sexual orientation and transgender identity have decline phrases only:
 *  the profile holds no answer for them. */
export const EEO_QUESTIONS = ['gender', 'race', 'hispanicLatino', 'veteran', 'disability', 'sexualOrientation',
  'transgender'] as const;
export type EeoQuestion = (typeof EEO_QUESTIONS)[number];

/** answers.json: the curated answer vocabularies. */
export interface RawAnswers {
  /** "How did you hear about us": `m` holds the keys of the phrases the mention rule looks for. */
  referral: Array<{ id: string; s: RawSurface[]; m?: string[]; p?: string[] }>;
  /** Per question: answer values (`derived` marks one the profile never stores, such as "Two or More Races") and the
   *  question's own decline phrases. */
  eeo: Record<EeoQuestion, { values: Array<{ id: string; s: RawSurface[]; derived?: 1 }>; decline: RawPhrase[] }>;
  /** Yes and no phrases, and the negating words (normalized, apostrophes gone: "dont"). */
  polarity: { yes: RawPhrase[]; no: RawPhrase[]; negators: string[] };
  /** Decline phrases for any question ("Prefer not to say"). */
  decline: RawPhrase[];
  /** Options that exclude every other choice ("None of the above"); decline phrases are exclusive too. */
  exclusive: RawPhrase[];
  /** "Other" options ("Other (please specify)", "My school is not listed"). */
  other: RawPhrase[];
  /** Placeholder options ("Select...", "Choose one"). */
  placeholders: RawPhrase[];
}

/** The classes of the distinctive-token guard (§4.5). Multi-word members are stored joined with '_'. */
export const GUARD_CLASSES = ['city', 'region', 'regionCode', 'country', 'campus', 'direction', 'state', 'tech',
  'discipline', 'level', 'headNoun'] as const;
export type GuardClass = (typeof GUARD_CLASSES)[number];

/** lexicon.json: the guard's classes, document frequencies, flagships, system patterns, and a snapshot of the
 *  normalizer's tables the keys were built with. */
export interface RawLexicon {
  /** The normalizer's tables at build time, each as its module exports it; the vocabulary test compares them with
   *  the code, so a table edited without a NORMALIZER_VERSION bump is caught. */
  normalizer: {
    /** NORMALIZER_VERSION. */
    version: number;
    /** STOPWORDS, per context, sorted. */
    stopwords: Record<NormContext, string[]>;
    /** ABBREVIATIONS_ALL. */
    abbreviationsAll: Record<string, string>;
    /** ABBREVIATIONS_BY_CONTEXT. */
    abbreviations: Record<string, Record<string, string>>;
    /** FIELD_WHOLE_VALUE. */
    fieldWholeValue: Record<string, string[]>;
    /** NEVER_EXPANDED. */
    neverExpanded: string[];
    /** SAINT_NAMES. */
    saintNames: string[];
    /** STATE_LIKE. */
    stateLike: string[];
    /** NOISE_QUALIFIERS. */
    noiseQualifiers: string[];
    /** INSTITUTION_HEAD_NOUNS. */
    headNouns: string[];
    /** DEGREE_LEVEL_PLURALS. */
    degreeLevelPlurals: Record<string, string>;
  };
  /** Members of each guard class: normalized in the institution context, stopwords dropped, words joined by '_'. */
  guard: Record<GuardClass, string[]>;
  /** Per domain: `n` surfaces, and `t` the number of surfaces holding each token, for tokens held by at least 3. */
  df: Partial<Record<VocabDomain, { n: number; t: Record<string, number> }>>;
  /** Bare system names that map to one campus (§5.2): the name as curated, its key and the campus's entity id. */
  flagships: Array<{ bare: string; key: string; id: string }>;
  /** The system patterns the generated aliases came from (§5.2). */
  systemPatterns: Array<{ from: string; to: string[] }>;
}

/** manifest.json: what the build wrote and from what. */
export interface RawManifest {
  /** NORMALIZER_VERSION at build time: createVocab refuses data built by another. */
  normalizerVersion: number;
  /** Per file: SHA-256 (hex) of its stable string, its size and budget in bytes, and how many records it holds. */
  files: Record<string, { sha256: string; bytes: number; budget: number; count: number }>;
  /** Per source id: its release, licence and the SHA-256 of each file it was read from. */
  sources: Record<string, { release: string; licence: string; files: Record<string, string> }>;
}

/** Every generated file, parsed: createVocab's input. Each member is the file VOCAB_FILES names for it. */
export interface RawVocab {
  /** manifest.json. */
  manifest: RawManifest;
  /** institutions-us.json. */
  institutionsUs: RawInstitutionsUs;
  /** institutions-global.json. */
  institutionsGlobal: RawInstitutionsGlobal;
  /** fields.json. */
  fields: RawFields;
  /** degrees.json. */
  degrees: RawDegrees;
  /** countries.json. */
  countries: RawCountries;
  /** regions.json. */
  regions: RawRegions;
  /** languages.json. */
  languages: RawLanguages;
  /** answers.json. */
  answers: RawAnswers;
  /** lexicon.json. */
  lexicon: RawLexicon;
}

// ---------------------------------------------------------------------------------------------------------------
// Runtime (what createVocab builds)

/** A vocabulary tier: every surface tier but 'raw', which is only ever the person's own text. */
export type VocabTier = Exclude<SurfaceTier, 'raw'>;

/** One spelling of an entity. */
export interface VocabSurface {
  /** As the source or the curated table writes it. */
  readonly text: string;
  /** normalize(text, DOMAIN_CONTEXT[domain]).key. */
  readonly key: string;
  /** Where the spelling comes from, which sets an alias match's confidence (§4.3). */
  readonly tier: VocabTier;
  /** Shared by another entity of the domain, or dependent on an unresolved "st?", or a short form: no exact or alias
   *  match may rest on it. */
  readonly ambiguous: boolean;
  /** A short form or shared name more institutions answer to than the vocabulary lists (RawSurface's flag 2): an
   *  entry's location never settles it. */
  readonly shortForm: boolean;
}

/** What every entity has. */
interface EntityBase {
  /** Prefixed by kind: 'ipeds:228778', 'ror:02d439m40', 'cip:11.0701', 'iso:US', 'usps:TX', 'capost:ON', 'lang:en',
   *  'prof:native', 'deg:type:BS', 'deg:level:bachelor', 'ref:linkedin', 'eeo.gender:female', 'bool:true'. */
  readonly id: string;
  /** The display name: the first surface's text. */
  readonly name: string;
  /** Every spelling, the display name first, one per key. */
  readonly surfaces: readonly VocabSurface[];
}

/** Where an institution is, for the distinctive-token guard (§4.5) and for location disambiguation. */
export interface InstitutionFacts {
  /** IPEDS CITY, or the ROR location's city. */
  readonly city?: string;
  /** USPS code (IPEDS only). */
  readonly regionCode?: string;
  /** The state's name (IPEDS) or the subdivision's (ROR). */
  readonly regionName?: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  /** The campus suffix of the IPEDS name ("Ann Arbor", "Upstate"). */
  readonly campus?: string;
  /** The IPEDS system name (F1SYSNAM). */
  readonly system?: string;
}

/** An institution from IPEDS or ROR. */
export interface InstitutionEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'institution';
  /** Which source it comes from (the id's prefix). */
  readonly source: 'ipeds' | 'ror';
  /** Where it is. */
  readonly facts: InstitutionFacts;
}

/** A CIP 2020 code: a family (2 digits), a series (4) or a program (6). */
export interface FieldEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'field';
  /** '11', '11.07' or '11.0701'. */
  readonly cip: string;
  /** How deep the code is. */
  readonly digits: 2 | 4 | 6;
  /** The nearest code above that the vocabulary holds; null for a family. */
  readonly parent: string | null;
  /** The family's general program: its title names the whole family. */
  readonly general: boolean;
}

/** An ISO 3166-1 country. */
export interface CountryEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'country';
  /** ISO 3166-1 alpha-2, upper case. */
  readonly alpha2: string;
  /** ISO 3166-1 alpha-3, upper case. */
  readonly alpha3: string;
}

/** A US or Canadian region. */
export interface RegionEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'region';
  /** USPS or Canada Post code. */
  readonly code: string;
  /** ISO 3166-1 alpha-2 of the country whose list it belongs to ('US' for every USPS code, 'CA'). */
  readonly country: string;
  /** What it is. */
  readonly regionKind: RegionKind;
}

/** A language. */
export interface LanguageEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'language';
  /** ISO 639-1, or a curated longer code ('yue', 'fil', 'ase'). */
  readonly code: string;
}

/** One of TailorIT's five proficiency values and its phrases. */
export interface ProficiencyEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'proficiency';
  /** The value. */
  readonly proficiency: Proficiency;
}

/** A degree type. */
export interface DegreeTypeEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'degree-type';
  /** The type's id. */
  readonly type: DegreeType;
  /** The level it is. */
  readonly level: DegreeLevel;
  /** Levels a list without `level` may take it as, flagged. */
  readonly alsoCountsAs: readonly DegreeLevel[];
  /** Dotted abbreviations ("B.S."). */
  readonly codes: readonly string[];
  /** The codes that are English words when undotted. */
  readonly wordLikeCodes: readonly string[];
  /** The class representative: 'BS' for BSc, the type itself for a type in no class. */
  readonly degreeClass: DegreeType;
}

/** A degree level and its phrases. */
export interface DegreeLevelEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'degree-level';
  /** The level. */
  readonly level: DegreeLevel;
}

/** A "How did you hear about us" source. */
export interface ReferralEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'referral';
  /** The id the profile stores ('linkedin'). */
  readonly answerId: string;
  /** Phrases the mention rule looks for inside an option, as token lists ("Job Board - LinkedIn"). */
  readonly mentions: readonly (readonly string[])[];
  /** The ids of the kinds of source it is one of ('ref:job-board' for Indeed): the same answer, less precisely. */
  readonly parents: readonly string[];
}

/** One answer to an EEO question. */
export interface EeoEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'eeo';
  /** The question it answers. */
  readonly question: EeoQuestion;
  /** 'female', 'asian', 'yes', 'protected-veteran', ... */
  readonly answerId: string;
  /** A value the profile never stores ("Two or More Races", "Hispanic or Latino" on a race list): chosen only by a
   *  rule the owner turns on. */
  readonly derived: boolean;
}

/** Yes or no. */
export interface PolarityEntity extends EntityBase {
  /** The discriminant. */
  readonly kind: 'polarity';
  /** True for the yes phrases. */
  readonly value: boolean;
}

/** Any vocabulary entity. */
export type VocabEntity = InstitutionEntity | FieldEntity | CountryEntity | RegionEntity | LanguageEntity
  | ProficiencyEntity | DegreeTypeEntity | DegreeLevelEntity | ReferralEntity | EeoEntity | PolarityEntity;

/** An entity whose surface has the looked-up key. */
export interface KeyHit {
  /** The entity. */
  readonly id: string;
  /** The best tier among the entity's surfaces with this key. */
  readonly tier: VocabTier;
  /** The key is ambiguous (VocabSurface.ambiguous). */
  readonly ambiguous: boolean;
  /** The key is a short form or shared name (VocabSurface.shortForm). */
  readonly shortForm: boolean;
}

/** A vocabulary phrase as a token list, for the mention rule. */
export interface Phrase {
  /** The phrase's key, split on spaces. */
  readonly tokens: readonly string[];
  /** The entity it names. */
  readonly id: string;
  /** The tier of the surface it comes from ('curated' for a referral mention). */
  readonly tier: VocabTier;
  /** Another entity has the same phrase. */
  readonly ambiguous: boolean;
}

/** A list of answer phrases matched by key. */
export interface PhraseSet {
  /** Every phrase, as written and as its key. */
  readonly phrases: ReadonlyArray<{ readonly text: string; readonly key: string }>;
  /** Whether a normalized key ('answer' context) is one of the phrases. */
  has(key: string): boolean;
}

/** The distinctive-token guard's lexicon (§4.5, step 15 of §3.1). */
export interface GuardLexicon {
  /** The classes a token (joined or not) belongs to; empty when none. */
  classesOf(token: string): readonly GuardClass[];
  /** Whether a token belongs to a class. */
  has(guardClass: GuardClass, token: string): boolean;
  /** A class's members. */
  members(guardClass: GuardClass): ReadonlySet<string>;
  /**
   * Step 15: multi-word members of any class joined into one token, longest first, left to right
   * (["university", "michigan", "ann", "arbor"] gives ["university", "michigan", "ann_arbor"]). Give it tokens
   * without the institution context's stopwords (a Normalized's `core`), because members were built that way.
   */
  join(tokens: readonly string[]): string[];
}

/** A bare system name and the campus it means ("University of Texas" is UT Austin). */
export interface Flagship {
  /** The bare name, as curated. */
  readonly bare: string;
  /** Its key in the institution context. */
  readonly key: string;
  /** The campus's entity id. */
  readonly id: string;
}

/** Degree types, levels and classes (§4.9). */
export interface DegreeTables {
  /** In DEGREE_TYPES order. */
  readonly types: readonly DegreeTypeEntity[];
  /** In DEGREE_LEVELS order. */
  readonly levels: readonly DegreeLevelEntity[];
  /** A type's entry. */
  type(type: DegreeType): DegreeTypeEntity;
  /** A level's entry. */
  level(level: DegreeLevel): DegreeLevelEntity;
  /** The class representative ('BS' for 'BSc'). Types in no class are their own. */
  classOf(type: DegreeType): DegreeType;
}

/** The CIP hierarchy. */
export interface FieldTables {
  /** The entity of a code ('11.0701'), or undefined when it is not in the vocabulary. */
  byCode(cip: string): FieldEntity | undefined;
  /** The parent's entity id ('cip:11.07' for 'cip:11.0701'), null for a family or an unknown id. */
  parentOf(id: string): string | null;
  /** The ids above `id`, nearest first ('cip:11.07', then 'cip:11'). */
  ancestorsOf(id: string): string[];
  /** Whether `a` is `b` or one of its ancestors. */
  isSameOrAncestor(a: string, b: string): boolean;
  /** The most specific id when every id lies on one line of descent, else null (an empty list gives null). */
  mostSpecific(ids: readonly string[]): string | null;
}

/** ISO 3166-1 lookups. */
export interface CountryTables {
  /** By alpha-2, any case. */
  byAlpha2(code: string): CountryEntity | undefined;
  /** By alpha-3, any case. */
  byAlpha3(code: string): CountryEntity | undefined;
}

/** USPS and Canada Post lookups. */
export interface RegionTables {
  /** The regions of a country ('US', 'CA'); empty for any other. */
  ofCountry(country: string): readonly RegionEntity[];
  /** By country and code, any case ('US', 'tx'). */
  byCode(country: string, code: string): RegionEntity | undefined;
}

/** ISO 639 lookups. */
export interface LanguageTables {
  /** By code, any case ('en', 'yue'). */
  byCode(code: string): LanguageEntity | undefined;
}

/** One EEO question's vocabulary. */
export interface EeoAnswers {
  /** Its answers; empty for sexual orientation and transgender identity. */
  readonly values: readonly EeoEntity[];
  /** The generic decline phrases plus the question's own. */
  readonly decline: PhraseSet;
}

/** The answer vocabularies. */
export interface AnswerTables {
  /** "How did you hear about us" sources, in curated order. */
  readonly referral: readonly ReferralEntity[];
  /** Per EEO question. */
  readonly eeo: Readonly<Record<EeoQuestion, EeoAnswers>>;
  /** Yes and no. */
  readonly polarity: {
    /** Yes phrases ("Yes", "Yes, I am"). */
    readonly yes: PhraseSet;
    /** No phrases ("No", "I do not"). */
    readonly no: PhraseSet;
    /** Negating words, normalized ("not", "dont", "never"). */
    readonly negators: ReadonlySet<string>;
  };
  /** Decline phrases for any question. */
  readonly decline: PhraseSet;
  /** "None of the above" and every decline phrase. */
  readonly exclusive: PhraseSet;
  /** "Other" options. */
  readonly other: PhraseSet;
  /** Placeholder options. */
  readonly placeholders: PhraseSet;
}

/** Everything the matcher, the resolver and the canonicalizers read of the vocabularies. Pure and read-only. */
export interface Vocab {
  /** The NORMALIZER_VERSION the keys were built with; createVocab refuses any other. */
  readonly normalizerVersion: number;
  /** Source releases by source id ('ipeds-hd': 'HD2024'). */
  readonly releases: Readonly<Record<string, string>>;
  /** An entity by id, or undefined. */
  entity(id: string): VocabEntity | undefined;
  /** Every entity of a domain, in data order; empty for 'generic'. */
  entities(domain: VocabDomain): readonly VocabEntity[];
  /** The entities with a surface whose key is `key`, best tier first; empty for an unknown key or 'generic'. */
  lookup(domain: VocabDomain, key: string): readonly KeyHit[];
  /** The domain's phrases by first token, longest first, for the mention rule. Referral sources give only their
   *  curated mention phrases; every other domain gives all its surfaces. */
  phrases(domain: VocabDomain): ReadonlyMap<string, readonly Phrase[]>;
  /** How many of the domain's surfaces hold `token`; 0 when fewer than 3 do (the token is rare). */
  df(domain: VocabDomain, token: string): number;
  /** How many surfaces the domain has: N in the IDF weight. */
  docCount(domain: VocabDomain): number;
  /** The distinctive-token guard's lexicon. */
  readonly guard: GuardLexicon;
  /**
   * An institution's facts as guard tokens: its city, region name, code and other spellings, campus, and every
   * spelling of its country, each normalized in the institution context with members joined. The region's and the
   * country's spellings bring only their place words: no "state" from "New York State", no direction from "Korea,
   * South", no single letter. Empty for any other id.
   */
  factTokens(id: string): ReadonlySet<string>;
  /** Bare system names that map to one campus. */
  readonly flagships: readonly Flagship[];
  /** Degree types, levels and classes. */
  readonly degrees: DegreeTables;
  /** The CIP hierarchy. */
  readonly fields: FieldTables;
  /** Country codes. */
  readonly countries: CountryTables;
  /** Region codes per country. */
  readonly regions: RegionTables;
  /** Language codes. */
  readonly languages: LanguageTables;
  /** The answer vocabularies. */
  readonly answers: AnswerTables;
}
