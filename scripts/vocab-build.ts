/*
 * Builds the matcher's vocabularies (docs/design/core.md §5.3). It reads the pinned public sources in vocab/.sources/
 * (checked against vocab/sources.json's SHA-256s; scripts/vocab-fetch.mjs is the only thing that downloads them) and
 * the hand-kept tables in vocab/curated/, and writes src/core/vocab/data/*.json, stable-stringified, with manifest.json
 * and two review reports: vocab/reports/collisions.txt, and vocab/reports/ambiguous-surfaces.json, which says why each
 * bundled institution spelling the bundle alone does not show to be shared is ambiguous (the vocabulary test checks
 * every flag against it). Which institution names are ambiguous is decided over every IPEDS institution and every ROR
 * candidate before the ROR subset is taken, so a name the subset leaves a namesake of out is still shared, and short
 * forms and names that more institutions answer to than hold them (uncurated acronyms, "U of M", "Trinity") are
 * marked so that no location settles them. Keys come from src/core/text/normalize.ts, the runtime's own normalizer, so
 * build keys equal runtime keys. Nothing here touches the network or the clock, and every list is sorted before it is
 * written, so running it twice gives byte-identical files. It exits 1 on a missing or changed source file, a curated
 * table that does not validate or resolve, an unacknowledged curated collision, or a file over its budget (§5.1).
 * Sources are data: they are decoded and parsed, never run.
 *
 *   npm run vocab:build
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEGREE_LEVELS, DEGREE_TYPES, GENDERS, PROFICIENCIES, RACES, type DegreeLevel, type DegreeType } from '../src/core/enums';
import {
  ABBREVIATIONS_ALL, ABBREVIATIONS_BY_CONTEXT, FIELD_WHOLE_VALUE, NEVER_EXPANDED, SAINT_NAMES, STATE_LIKE,
} from '../src/core/text/abbreviations';
import { removeInvisibles } from '../src/core/text/fold';
import { jaroWinkler } from '../src/core/text/similarity';
import { INSTITUTION_HEAD_NOUNS, NORM_CONTEXTS, NORMALIZER_VERSION, normalize, type NormContext } from '../src/core/text/normalize';
import { NOISE_QUALIFIERS } from '../src/core/text/qualifiers';
import { sha256Hex } from '../src/core/text/sha256';
import { DEGREE_LEVEL_PLURALS, STOPWORDS } from '../src/core/text/tokens';
import type { VocabDomain } from '../src/core/types/intent';
import { stableStringify } from '../src/core/vocab/createVocab';
import { isAcronymShaped } from '../src/core/vocab/lookup';
import {
  DOMAIN_CONTEXT, EEO_QUESTIONS, GUARD_CLASSES, REGION_KINDS, VOCAB_BUDGETS, VOCAB_FILES, type EeoQuestion,
  type GuardClass, type RawAnswers, type RawCountries, type RawDegrees, type RawFields, type RawInstitutionsGlobal,
  type RawInstitutionsUs, type RawLanguages, type RawLexicon, type RawManifest, type RawPhrase, type RawRegions,
  type RawSurface, type RawTier, type RegionKind, type VocabFile,
} from '../src/core/vocab/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES_JSON = join(ROOT, 'vocab', 'sources.json');
const SOURCES_DIR = join(ROOT, 'vocab', '.sources');
const CURATED_DIR = join(ROOT, 'vocab', 'curated');
const REPORT_FILE = join(ROOT, 'vocab', 'reports', 'collisions.txt');
const AMBIGUITY_FILE = join(ROOT, 'vocab', 'reports', 'ambiguous-surfaces.json');
const OUT_DIR = join(ROOT, 'src', 'core', 'vocab', 'data');

/** A build failure with a sentence for the person running it. */
class BuildError extends Error {}
function fail(message: string): never {
  throw new BuildError(message);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The pinned sources, checked by SHA-256

const SourcesSchema = z.strictObject({
  comment: z.string(),
  sources: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string(),
    publisher: z.string(),
    release: z.string().min(1),
    url: z.string(),
    archive: z.string().nullable(),
    licence: z.string().min(1),
    files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
    archiveSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })),
});
type Source = z.infer<typeof SourcesSchema>['sources'][number];

function readSources(): { sources: Source[]; bytes: Map<string, Buffer> } {
  const parsed = SourcesSchema.safeParse(JSON.parse(readFileSync(SOURCES_JSON, 'utf8')));
  if (!parsed.success) fail(`vocab/sources.json is not valid:\n${z.prettifyError(parsed.error)}`);
  const bytes = new Map<string, Buffer>();
  for (const source of parsed.data.sources) {
    for (const [file, expected] of Object.entries(source.files)) {
      const path = join(SOURCES_DIR, source.id, file);
      const where = `vocab/.sources/${source.id}/${file}`;
      if (!existsSync(path)) {
        fail(`${where} is missing. Run npm run vocab:fetch, which downloads ${source.url} and puts ${file} in `
          + `vocab/.sources/${source.id}/, or put the file there yourself.`);
      }
      const content = readFileSync(path);
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== expected) {
        fail(`${where} has SHA-256 ${actual}, but vocab/sources.json pins ${expected}. Download ${source.url} again `
          + `(npm run vocab:fetch) and put ${file} in vocab/.sources/${source.id}/.`);
      }
      bytes.set(`${source.id}/${file}`, content);
    }
  }
  return { sources: parsed.data.sources, bytes };
}

function sourceFile(bytes: Map<string, Buffer>, id: string, file: string): Buffer {
  const content = bytes.get(`${id}/${file}`);
  if (!content) fail(`vocab/sources.json lists no file ${file} for the source ${id}.`);
  return content;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Decoding and parsing

/**
 * A CSV's text. IPEDS releases have been windows-1252, and HD2024 is UTF-8 with a byte-order mark: a file that starts
 * with the mark is decoded as strict UTF-8, any other as windows-1252. Either way a U+FFFD or a C1 control (a byte
 * windows-1252 leaves undefined) fails the build, because it means the guess was wrong.
 */
function decodeText(content: Buffer, where: string): string {
  let text: string;
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content.subarray(3));
    } catch {
      fail(`${where} starts with a UTF-8 byte-order mark but is not valid UTF-8.`);
    }
  } else {
    text = new TextDecoder('windows-1252').decode(content);
  }
  const bad = text.search(/[\uFFFD\u0080-\u009F]/);
  if (bad >= 0) fail(`${where} decodes with an invalid character at offset ${bad}: its encoding is not the one assumed.`);
  return text;
}

/**
 * RFC 4180 rows. A quote inside an unquoted field opens a quoted run, as spreadsheets write CIP's ="01.0101" codes,
 * so that field reads =01.0101. CRLF and LF both end a row.
 */
function parseCsv(text: string, where: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) fail(`${where} ends inside a quoted field.`);
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

/** CSV rows as records keyed by header, with the named columns required. */
function csvRecords(text: string, where: string, columns: readonly string[]): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text, where);
  if (!header) fail(`${where} is empty.`);
  for (const column of columns) {
    if (!header.includes(column)) fail(`${where} has no ${column} column.`);
  }
  return rows.map((cells, n) => {
    if (cells.length !== header.length) fail(`${where} row ${n + 2} has ${cells.length} fields, not ${header.length}.`);
    return Object.fromEntries(header.map((name, i) => [name, cells[i]!]));
  });
}

/** ROR's schema v2 records, as far as the build reads them. */
interface RorRecord {
  id: string;
  status: string;
  types: string[];
  names: Array<{ value: string; types: string[]; lang: string | null }>;
  locations: Array<{ geonames_details?: { country_code?: string; name?: string; country_subdivision_name?: string } }>;
  links?: Array<{ type: string; value: string }>;
}

function isRorRecord(value: unknown): value is RorRecord {
  const record = value as RorRecord;
  return typeof record === 'object' && record !== null && typeof record.id === 'string'
    && typeof record.status === 'string' && Array.isArray(record.types) && Array.isArray(record.names)
    && Array.isArray(record.locations)
    && record.names.every((name) => typeof name.value === 'string' && Array.isArray(name.types));
}

/** Calls `visit` with each element of the dump's top-level array, parsed on its own, so the 330 MB file is never one
 *  JSON.parse. */
function eachRorRecord(content: Buffer, where: string, visit: (record: RorRecord) => void): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let count = 0;
  for (let i = 0; i < content.length; i += 1) {
    const byte = content[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      if (depth === 2 && byte === 0x7b) start = i;
    } else if (byte === 0x7d || byte === 0x5d) {
      if (depth === 2 && byte === 0x7d) {
        const record: unknown = JSON.parse(content.toString('utf8', start, i + 1));
        if (!isRorRecord(record)) fail(`${where} holds a record the build cannot read near byte ${start}.`);
        visit(record);
        count += 1;
      }
      depth -= 1;
    }
  }
  if (depth !== 0 || inString) fail(`${where} is not one complete JSON array.`);
  return count;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. The curated tables, validated

const Text = z.string().trim().min(1);
const TextList = z.array(Text);
const Comment = z.string().optional();
/** One EEO question's values and its own decline phrases. */
const EeoQuestionSchema = z.strictObject({
  values: z.array(z.strictObject({ id: z.string().regex(/^[a-z-]+$/), derived: z.boolean().optional(), labels: TextList.min(1) })),
  decline: TextList,
});

const CURATED = {
  institutionAliases: ['institution-aliases.json', z.strictObject({
    comment: Comment, institutions: z.array(z.strictObject({ name: Text, aliases: TextList.min(1) })),
  })],
  flagships: ['institution-flagships.json', z.strictObject({
    comment: Comment, flagships: z.array(z.strictObject({ bare: Text, name: Text })),
  })],
  sharedNames: ['institution-shared-names.json', z.strictObject({
    comment: Comment, names: z.array(z.strictObject({ name: Text, reason: Text })).min(1),
  })],
  systemPatterns: ['system-patterns.json', z.strictObject({
    comment: Comment,
    patterns: z.array(z.strictObject({ from: Text.regex(/\{X\}$/), to: z.array(Text.regex(/\{X\}/)).min(1) })),
  })],
  fieldAliases: ['field-aliases.json', z.strictObject({
    comment: Comment, fields: z.array(z.strictObject({ cip: z.string().regex(/^\d{2}(\.\d{2}(\d{2})?)?$/), aliases: TextList.min(1) })),
  })],
  degrees: ['degrees.json', z.strictObject({
    comment: Comment,
    types: z.array(z.strictObject({
      type: z.enum(DEGREE_TYPES), level: z.enum(DEGREE_LEVELS), also: z.array(z.enum(DEGREE_LEVELS)).optional(),
      codes: z.array(Text.regex(/^[A-Za-z.,]+$/)), wordLike: z.array(Text).optional(), names: TextList,
    })),
    levels: z.array(z.strictObject({ level: z.enum(DEGREE_LEVELS), names: TextList.min(1) })),
    classes: z.array(z.array(z.enum(DEGREE_TYPES)).min(2)),
  })],
  countries: ['countries.aliases.json', z.strictObject({
    comment: Comment, notIso: z.array(z.string().regex(/^[A-Z]{2}$/)),
    countries: z.array(z.strictObject({ code: z.string().regex(/^[A-Z]{2}$/), aliases: TextList.min(1) })),
  })],
  regions: ['regions.json', z.strictObject({
    comment: Comment,
    regions: z.array(z.strictObject({
      country: z.enum(['US', 'CA']), code: z.string().regex(/^[A-Z]{2}$/), kind: z.enum(REGION_KINDS), name: Text,
      aliases: TextList,
    })),
  })],
  languages: ['languages.aliases.json', z.strictObject({
    comment: Comment, extraCodes: z.array(z.string().regex(/^[a-z]{3}$/)),
    languages: z.array(z.strictObject({ code: z.string().regex(/^[a-z]{2,3}$/), aliases: TextList.min(1) })),
    proficiency: z.array(z.strictObject({ id: z.enum(PROFICIENCIES), names: TextList.min(1), crosswalk: TextList })),
  })],
  referral: ['referral-sources.json', z.strictObject({
    comment: Comment,
    sources: z.array(z.strictObject({
      id: z.string().regex(/^[a-z0-9-]+$/), display: Text, names: TextList, aliases: TextList, mentions: TextList,
      parents: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
    })),
  })],
  eeo: ['eeo.json', z.strictObject({
    comment: Comment,
    questions: z.strictObject({
      gender: EeoQuestionSchema, race: EeoQuestionSchema, hispanicLatino: EeoQuestionSchema, veteran: EeoQuestionSchema,
      disability: EeoQuestionSchema, sexualOrientation: EeoQuestionSchema, transgender: EeoQuestionSchema,
    } satisfies Record<EeoQuestion, typeof EeoQuestionSchema>),
  })],
  polarity: ['polarity.json', z.strictObject({ comment: Comment, yes: TextList.min(1), no: TextList.min(1), negators: TextList })],
  decline: ['decline.json', z.strictObject({ comment: Comment, phrases: TextList.min(1) })],
  exclusive: ['exclusive.json', z.strictObject({ comment: Comment, phrases: TextList.min(1) })],
  other: ['other-options.json', z.strictObject({ comment: Comment, phrases: TextList.min(1) })],
  placeholders: ['placeholders.json', z.strictObject({ comment: Comment, phrases: z.array(z.string()).min(1) })],
  ambiguousOk: ['ambiguous-ok.json', z.strictObject({
    comment: Comment, collisions: z.array(z.strictObject({ domain: z.string(), key: z.string(), reason: Text })),
  })],
  guard: ['guard.json', z.strictObject({
    comment: Comment, direction: TextList, state: TextList, tech: TextList, discipline: TextList,
    disciplineIgnore: TextList, level: TextList, campusPhrases: TextList, cities: TextList, campusIgnore: TextList,
  })],
  rorCountries: ['ror-countries.json', z.strictObject({
    comment: Comment, priority: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  })],
} as const;

type CuratedKey = keyof typeof CURATED;
type Curated = { [K in CuratedKey]: z.infer<(typeof CURATED)[K][1]> };

function readCurated(): Curated {
  const out: Partial<Record<CuratedKey, unknown>> = {};
  for (const key of Object.keys(CURATED) as CuratedKey[]) {
    const [file, schema] = CURATED[key] as readonly [string, z.ZodType];
    const path = join(CURATED_DIR, file);
    if (!existsSync(path)) fail(`vocab/curated/${file} is missing.`);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      fail(`vocab/curated/${file} is not JSON: ${(error as Error).message}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) fail(`vocab/curated/${file} is not valid:\n${z.prettifyError(parsed.error)}`);
    out[key] = parsed.data;
  }
  return out as Curated;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Entities under construction

const TIER_RANK: Readonly<Record<RawTier, number>> = { p: 0, c: 1, v: 2, g: 3, f: 4 };

interface DraftSurface {
  text: string;
  key: string;
  tier: RawTier;
  /** Core and qualifier tokens, for document frequencies. */
  tokens: string[];
  /** 0, or how it is ambiguous (RawSurface's flag): 1 when it rests on an unresolved "st?" or shares its key with
   *  another entity, 2 when it is a short form or shared name that more institutions use than hold it. */
  amb: 0 | 1 | 2;
  /** An acronym-shaped spelling from IPEDS IALIAS or a ROR alias, or a ROR acronym: unique only when curated. */
  shortForm: boolean;
  /** Written in brackets, which the key leaves out. */
  bracketed: boolean;
}

/** One entity as it is being built: its prefixed id and its surfaces, one per key, the display name first. */
interface Draft {
  id: string;
  surfaces: DraftSurface[];
}

/** Invisible characters removed, whitespace collapsed and trimmed: how every source text is stored. */
function clean(text: string): string {
  return removeInvisibles(text).replace(/\s+/g, ' ').trim();
}

/**
 * Adds a spelling to a draft in a domain's context. A spelling whose key is empty is dropped; one whose key the
 * draft already has only raises that surface's tier, so the display name keeps its place. Returns the key.
 */
function addSurface(draft: Draft, rawText: string, tier: RawTier, context: NormContext,
  options: { shortForm?: boolean } = {}): string {
  const text = clean(rawText);
  const normalized = normalize(text, context);
  const { key } = normalized;
  if (key === '') return key;
  const shortForm = options.shortForm === true;
  const bracketed = normalized.qualifiers.length > 0;
  const existing = draft.surfaces.find((surface) => surface.key === key);
  if (existing) {
    if (TIER_RANK[tier] < TIER_RANK[existing.tier]) existing.tier = tier;
    existing.shortForm &&= shortForm;
    existing.bracketed &&= bracketed;
    return key;
  }
  const tokens = [...new Set([...normalized.core, ...normalized.qualifiers.flatMap((q) => q.tokens)])];
  draft.surfaces.push({ text, key, tier, tokens, amb: normalized.ambiguous.length > 0 ? 1 : 0, shortForm, bracketed });
  return key;
}

/** Marks a surface ambiguous: the stronger flag wins. */
function markAmbiguous(surface: DraftSurface, level: 1 | 2): void {
  if (level > surface.amb) surface.amb = level;
}

/** A draft's surfaces as the data files write them. */
function rawSurfaces(draft: Draft): RawSurface[] {
  return draft.surfaces.map((surface) => surface.amb === 0
    ? [surface.text, surface.key, surface.tier] : [surface.text, surface.key, surface.tier, surface.amb]);
}

/** Phrases with their keys, the first of each key kept. */
function rawPhrases(texts: readonly string[], context: NormContext): RawPhrase[] {
  const seen = new Set<string>();
  const out: RawPhrase[] = [];
  for (const raw of texts) {
    const text = clean(raw);
    const key = normalize(text, context).key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([text, key]);
  }
  return out;
}

/** Normalized core tokens joined with '_': a guard member. */
function guardMember(text: string): string {
  return normalize(text, 'institution').core.join('_');
}

/** Step 15 at build time: multi-word members joined, longest first (the same rule as createVocab's join). */
function makeJoiner(members: Iterable<string>): (tokens: readonly string[]) => string[] {
  const starts = new Map<string, string[][]>();
  for (const member of members) {
    if (!member.includes('_')) continue;
    const tokens = member.split('_');
    const list = starts.get(tokens[0]!) ?? [];
    list.push(tokens);
    starts.set(tokens[0]!, list);
  }
  for (const list of starts.values()) list.sort((a, b) => b.length - a.length);
  return (tokens) => {
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      const phrase = (starts.get(tokens[i]!) ?? []).find((candidate) => candidate.length <= tokens.length - i
        && candidate.every((token, j) => tokens[i + j] === token));
      const length = phrase?.length ?? 1;
      out.push(length === 1 ? tokens[i]! : tokens.slice(i, i + length).join('_'));
      i += length;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The report

const report = {
  aliasSplits: [] as string[],
  /** "<id> "<alias>": <reason>", IPEDS's and ROR's. */
  aliasesDropped: [] as string[],
  /** ROR acronyms a US institution owns, by "<id> "<acronym>"", with their record (reported if it is bundled). */
  rorAcronymsDropped: new Map<string, Draft>(),
  /** CIP readings that name no one line of codes. */
  readingsDropped: [] as string[],
  collisions: new Map<string, Collision[]>(),
  acknowledged: [] as string[],
  notes: [] as string[],
  /** Institution surfaces marked ambiguous for a reason the bundle alone does not show, by reason: "<id> <key>". */
  ambiguity: new Map<AmbiguityReason, Set<string>>(),
  /** Per shared-name key, the institutions holding it. */
  sharedNames: [] as string[],
  /** Curated acronyms kept as one institution's, and what else the full sources spell that way. */
  curatedAcronyms: [] as string[],
  /** City members the bundled sources alone would not give that occur in a bundled institution's name. */
  newCities: [] as string[],
};

/** Why an institution surface is ambiguous beyond sharing its key inside the bundle (vocab/reports/
 *  ambiguous-surfaces.json lists each one, and the vocabulary test checks every flag against it). */
const AMBIGUITY_REASONS = ['outside-subset', 'campus-base', 'acronym', 'shared-name', 'contained', 'bracket'] as const;
type AmbiguityReason = (typeof AMBIGUITY_REASONS)[number];

/** The flag each reason sets: 1 lets the entry's location settle the key (two full names), 2 never does. */
const AMBIGUITY_LEVEL: Readonly<Record<AmbiguityReason, 1 | 2>> = {
  'outside-subset': 1, 'campus-base': 1, acronym: 2, 'shared-name': 2, contained: 2, bracket: 2,
};

/** Marks an institution surface ambiguous for a reason and records it. */
function markFor(draft: Draft, surface: DraftSurface, reason: AmbiguityReason): void {
  markAmbiguous(surface, AMBIGUITY_LEVEL[reason]);
  const list = report.ambiguity.get(reason) ?? new Set<string>();
  list.add(`${draft.id} ${surface.key}`);
  report.ambiguity.set(reason, list);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Institutions: IPEDS

/** STABBR values that are ISO 3166-1 countries of their own; their institutions are IPEDS's, never ROR's. */
const TERRITORY_COUNTRY: Readonly<Record<string, string>> = {
  PR: 'PR', GU: 'GU', VI: 'VI', AS: 'AS', MP: 'MP', FM: 'FM', MH: 'MH', PW: 'PW',
};
const IPEDS_COUNTRIES = new Set(['US', ...Object.values(TERRITORY_COUNTRY)]);

/** Words that make the text before a '-' an institution's name, so what follows is a campus. */
const CAMPUS_LEFT = /\b(?:university|universities|college|colleges|institute|institutes|school|schools|academy|seminary|conservatory|universidad|instituto|colegio|escuela|conservatorio|yeshiva|law|tech|inc|center|centre)\b/i;
const HEAD_NOUN = /\b(?:university|college|institute|school|academy|seminary|conservatory)\b/i;

/** What tells a campus suffix from the rest of an IPEDS name. */
interface CampusContext {
  /** The system patterns' base names in lower case ("university of wisconsin" from "University of Wisconsin-{X}"). */
  bases: ReadonlySet<string>;
  /** The keys of the names that come before a dash in two or more IPEDS names ("University of Pittsburgh"). */
  sharedBases: ReadonlySet<string>;
  /** The campus phrases' keys (guard.json's campusPhrases: "twin cities", "upstate"). */
  phrases: readonly string[];
  /** City guard members and every IPEDS row's city: the place names a dash may join into one ("Urbana-Champaign"). */
  cities: ReadonlySet<string>;
  /** State and province guard members: a state before a dash names the system, not half of a place. */
  regions: ReadonlySet<string>;
  /** A USPS code's state name. */
  stateNames: ReadonlyMap<string, string>;
}

/** The institution-context key of a text. */
const institutionKey = (text: string) => normalize(text, 'institution').key;

/** Each '-' of an INSTNM that follows an institution's name and precedes a capital: where a campus may begin. */
function campusDashes(name: string): Array<{ left: string; right: string }> {
  const out: Array<{ left: string; right: string }> = [];
  for (const match of name.matchAll(/\s*[-\u2013]\s*/g)) {
    const left = name.slice(0, match.index).trim();
    const right = name.slice(match.index + match[0].length).trim();
    if (left !== '' && right !== '' && CAMPUS_LEFT.test(left) && /^[A-Z0-9]/.test(right)) out.push({ left, right });
  }
  return out;
}

/**
 * INSTNM split into a name and a campus at the first such '-' that names a campus: after a name that two or more
 * IPEDS names put before a dash, or a system pattern's base ("University of Pittsburgh-Bradford", "Pennsylvania State
 * University-Penn State Erie-Behrend College"); otherwise before "Main Campus", a campus phrase, the record's own
 * city or state ("University of Michigan-Ann Arbor", "DeVry University-California") or a name ending in "Campus",
 * unless the dash joins two place names ("University of Illinois Urbana-Champaign"). A dash inside a name
 * ("University of Mary Hardin-Baylor", "Hebrew Union College-Jewish Institute of Religion") is not a campus.
 */
function splitCampus(name: string, city: string, state: string, context: CampusContext):
  { base: string; campus?: string } {
  const cityKey = institutionKey(city);
  const stateKey = institutionKey(context.stateNames.get(state) ?? '');
  for (const { left, right } of campusDashes(name)) {
    if (context.sharedBases.has(institutionKey(left)) || context.bases.has(left.toLowerCase().replace(/^the\s+/, ''))) {
      return { base: left, campus: right };
    }
    // Two place names around the dash ("Urbana-Champaign"); a head noun before it ("University", which is also a
    // town in Mississippi) is no place here.
    const beforeWord = left.split(' ').pop()!;
    const before = guardMember(beforeWord);
    const after = guardMember(right.split(' ')[0]!);
    if (!CAMPUS_LEFT.test(beforeWord) && context.cities.has(before) && !context.regions.has(before)
      && context.cities.has(after)) continue;
    const rightKey = institutionKey(right);
    const named = /^main campus$/i.test(right) || /\bcampus(?:es)?$/i.test(right)
      || (cityKey !== '' && (rightKey === cityKey || rightKey.startsWith(`${cityKey} `)))
      || (stateKey !== '' && rightKey === stateKey)
      || context.phrases.some((phrase) => ` ${rightKey} `.includes(` ${phrase} `));
    if (named) return { base: left, campus: right };
  }
  return { base: name };
}

/** What the alias filters need to know. */
interface AliasContext {
  /** Place names (cities and states, as guard members): a comma before one keeps a name and its place together. */
  places: Set<string>;
  /** Words an alias of one word must not be: head nouns, stopwords, markers, directions, levels, disciplines, cities,
   *  states and countries. */
  generic: Set<string>;
  /** Every IPEDS INSTNM in lower case, for spotting an alias that lists several institutions. */
  allNames: readonly string[];
  /** The discipline class: what a college or school inside an institution is "of". */
  disciplines: ReadonlySet<string>;
  /** Words CIP titles use beside the disciplines ("professions", "studies"): they may stand in such a subject too. */
  subjectWords: ReadonlySet<string>;
}

/** The longest alias kept, in code points: anything longer is a list, not a name. */
const MAX_ALIAS_CODE_POINTS = 200;

const CORPORATE = /^(?:inc|llc|ltd|corp|corporation|co)\.?$/i;
/** A former or trade name's marker: what follows is an alias of its own ("formerly Caldwell College", "d/b/a ...",
 *  "(old name:Thomas Edison State College)"). */
const NAME_MARKER = new RegExp(String.raw`\s*\(?\s*\b(?:formerly(?:\s+known\s+as)?|previously(?:\s+known\s+as)?`
  + String.raw`|d\/b\/a|dba|(?:old|former)\s+(?:name|abbreviation))\b[\s:-]*`, 'gi');
/** Words that join two aliases in one IALIAS part: "MSU Moorhead or MSUM", "Philadelphia University + Thomas
 *  Jefferson University". */
const ALIAS_JOINER = /\s+(?:or|\+)\s+/;
/** A personal suffix after a comma belongs to the name before it ("The David Ranken, Jr. School of ..."). */
const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv)\b\.?/i;

/**
 * IALIAS split into aliases: on '|', ';', runs of two or more spaces, the markers of a former or trade name (a
 * bracket around a whole alias dropped), and " or " and " + " between two names; then on commas only where the comma
 * separates short aliases (each of at most four words, or a name with a head noun, or an acronym); then on slashes.
 * A comma before a place ("Trinity College, Hartford", "Rutgers, Camden"), before an appositive name ("Rutgers, The
 * State University of New Jersey"), before "Jr." or in an inverted name ("Incarnate Word, University of") stays
 * inside the alias; a trailing "Inc." is dropped. A slash splits where a space stands
 * beside it ("UH Hilo / UHH") and in a list of three or more ("Regis/Regis College/RU"); two names joined by one bare
 * slash ("Otis/Parsons", "Yuma/LaPaz Community College District") stay whole. Every comma and slash decision is
 * logged in the report.
 */
function splitAliases(value: string, unitid: string, context: AliasContext): string[] {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-2' || trimmed === '.') return [];
  const out: string[] = [];
  const unbracket = (part: string) => part.replace(/^\((.*)\)$/, '$1').replace(/^\(([^)]*)$/, '$1')
    .replace(/^([^(]*)\)$/, '$1');
  const parts = trimmed.split(/\s*[|;]\s*|\s{2,}/).flatMap((part) => part.split(NAME_MARKER))
    .map((part) => unbracket(clean(part).replace(/^[\s,-]+|[\s,-]+$/g, '')))
    .flatMap((part) => part.split(ALIAS_JOINER)).map(clean).filter((p) => p !== '');
  for (const part of parts) {
    for (const piece of splitCommas(part, unitid, context)) out.push(...splitSlashes(piece, unitid));
  }
  return out;
}

function splitCommas(part: string, unitid: string, context: AliasContext): string[] {
  if (!part.includes(',')) return [part];
  const pieces = part.split(',').map(clean).filter((p) => p !== '' && !CORPORATE.test(p));
  if (pieces.length <= 1) return pieces;
  if (pieces.length === 2 && /^(?:the\s+)?(?:university|college|institute|school)\s+of$/i.test(pieces[1]!)) {
    report.aliasSplits.push(`${unitid}: kept inverted "${part}"`);
    return [part];
  }
  const isPlace = (piece: string) => context.places.has(guardMember(piece)) || /^[A-Z]{2}$/.test(piece)
    || /^D\.?\s?C\.?$/.test(piece);
  const merged = [pieces[0]!];
  for (const piece of pieces.slice(1)) {
    const before = merged[merged.length - 1]!;
    const appositive = /^the\s/i.test(piece) && HEAD_NOUN.test(piece);
    // A place after a name: always after a head noun, and after any other name when the two are the whole alias
    // ("Rutgers, Camden"), not one item of a list ("Penn, U of P, Pennsylvania, UPenn").
    const placed = isPlace(piece) && !isPlace(before) && (HEAD_NOUN.test(before) || pieces.length === 2);
    if (placed || appositive || NAME_SUFFIX.test(piece)) {
      merged[merged.length - 1] = `${before}, ${piece}`;
    } else merged.push(piece);
  }
  const short = (piece: string) => piece.split(' ').length <= 4 || HEAD_NOUN.test(piece) || /^[A-Z0-9&.-]+$/.test(piece);
  if (merged.length === 1) {
    report.aliasSplits.push(`${unitid}: kept "${part}" whole (place, appositive or suffix)`);
    return merged;
  }
  if (merged.every(short)) {
    report.aliasSplits.push(`${unitid}: split "${part}" into ${merged.map((m) => `"${m}"`).join(', ')}`);
    return merged;
  }
  report.aliasSplits.push(`${unitid}: unsure, kept "${part}" whole`);
  return [part];
}

function splitSlashes(text: string, unitid: string): string[] {
  const piece = text.replace(/^[\s/]+|[\s/]+$/g, '');
  if (!piece.includes('/')) return piece === '' ? [] : [piece];
  const out: string[] = [];
  for (const spaced of piece.split(/\s+\/\s*|\s*\/\s+/).map(clean).filter((p) => p !== '')) {
    const bare = spaced.split('/').map(clean).filter((p) => p !== '');
    if (bare.length >= 3) out.push(...bare);
    else {
      out.push(spaced);
      if (bare.length === 2) report.aliasSplits.push(`${unitid}: kept "${spaced}" whole (two names, one bare slash)`);
    }
  }
  if (out.length > 1) {
    report.aliasSplits.push(`${unitid}: split "${piece}" at its slashes into ${out.map((m) => `"${m}"`).join(', ')}`);
  }
  return out;
}

/** The institution's own name words, for telling a nickname from a team name or a sub-unit. */
interface OwnName {
  /** The base name before any campus ("DeVry University"). */
  base: string;
  /** Core tokens of the institution's primary names. */
  tokens: ReadonlySet<string>;
}

/** Plurals that end place and institution names, not teams ("Clear Creek Springs", "Valley Training Centers"). */
const NOT_TEAM_WORDS = new Set(['services', 'centers', 'centres', 'schools', 'colleges', 'institutes', 'programs',
  'programmes', 'studies', 'sciences', 'arts', 'systems', 'campuses', 'springs', 'heights', 'hills', 'falls', 'woods',
  'lakes', 'plains', 'islands', 'rapids', 'shoals', 'pines', 'oaks', 'gardens', 'grounds']);

/**
 * A team name: one to three words of letters ending in a plural of five letters or more that the institution's own
 * name does not hold, is no place and no misspelling of a word of the name ("Griffins", "Utah Griffins", "FAMU
 * Rattlers", "HILLTOPPERS"). Acronyms ("NOBTS"), compounds with capitals inside ("CalArts", "LASDallas"), shorter
 * words ("Ole Miss"), misspellings ("Ilinois") and place-like plurals ("Springs", "Centers") are not teams.
 */
function isTeamName(text: string, own: OwnName, context: AliasContext): boolean {
  const words = text.split(' ');
  if (words.length > 3 || words.some((word) => !/^[A-Za-z]+$/.test(word))) return false;
  const last = words[words.length - 1]!;
  const word = last.toLowerCase();
  if (word.length < 5 || !/[^su]s$/.test(word) || isAcronymShaped(last)) return false;
  if (/[a-z][A-Z]|[A-Z]{2}[a-z]/.test(last)) return false;
  if (own.tokens.has(word) || NOT_TEAM_WORDS.has(word) || context.generic.has(word)) return false;
  if (context.places.has(word)) return false;
  return ![...own.tokens].some((token) => token.length >= 4 && jaroWinkler(token, word) >= 0.9);
}

/**
 * A college or school inside the institution, sharing no word with its name: "College of" or "School of" a subject,
 * every word of which is a discipline word ("College of Education", "College of Arts and Sciences"), or, for a
 * university, a named college or school of such a subject ("Anderson College of Business", "Rueckert-Hartman College
 * for Health Professions"), whose head noun the guard would otherwise take for the university's. "College of
 * Engineering Pune" and "College of St. Albert the Great" are names.
 */
function isSubUnit(text: string, core: readonly string[], own: OwnName, context: AliasContext): boolean {
  if (core.some((token) => own.tokens.has(token))) return false;
  const leading = /^(?:the\s+)?(?:college|school|department|division|faculty|center|centre)\s+of\s+(.+)$/i.exec(text);
  const named = own.tokens.has('university') ? /\b(?:college|school)\s+(?:of|for)\s+(.+)$/i.exec(text) : null;
  const unit = leading ?? named;
  if (!unit) return false;
  const subject = normalize(unit[1]!, 'institution').core;
  return subject.length > 0 && subject.every((token) => context.disciplines.has(token) || context.subjectWords.has(token))
    && subject.some((token) => context.disciplines.has(token));
}

/**
 * Why an IPEDS or ROR alias is not worth a surface, or null when it is. Dropped: one that is empty or over 200 code
 * points; one generic word, city, state or country ("Boston", "Campus", "SCH", which the normalizer reads as
 * "school"); a run-together list (one that repeats the base name or an acronym, glues words together, or names three
 * or more institutions); a college or school inside the institution ("College of Education"); a team name.
 */
function aliasDropReason(text: string, own: OwnName, context: AliasContext): string | null {
  if ([...text].length > MAX_ALIAS_CODE_POINTS) return `over ${MAX_ALIAS_CODE_POINTS} characters`;
  const core = normalize(text, 'institution').core;
  if (core.length === 0) return 'nothing left once normalized';
  if (core.length === 1 && (core[0]!.length < 2 || context.generic.has(core[0]!))) {
    return 'one generic word, city, state or country';
  }
  const lower = text.toLowerCase();
  const base = own.base.toLowerCase();
  const repeats = base.length >= 6 && lower.split(base).length > 2;
  const glued = text.split(' ').length >= 3 && /[a-z]{4,}[A-Z][a-z]{3,}/.test(text);
  if (repeats || /([A-Z]{3,}).*\1/.test(text) || glued) return 'a run-together list';
  if (text.length >= 60 && context.allNames.filter((name) => name.length >= 12 && lower.includes(name)).length >= 3) {
    return 'a list of several institutions';
  }
  if (isSubUnit(text, core, own, context)) return 'a college or school of the institution';
  if (isTeamName(text, own, context)) return 'a team name';
  return null;
}

interface IpedsDraft extends Draft {
  unitid: string;
  instnm: string;
  /** INSTNM before its campus suffix ("University of Michigan" for "University of Michigan-Ann Arbor"). */
  base: string;
  city: string;
  st: string;
  campus?: string;
  system?: string;
}

interface SystemPattern {
  regex: RegExp;
  to: string[];
}

function compilePatterns(patterns: Curated['systemPatterns']['patterns']): SystemPattern[] {
  return patterns.map(({ from, to }) => {
    const body = from.replace(/^The /, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{X\\}', '(.+)');
    return { regex: new RegExp(`^(?:The )?${body}$`), to };
  });
}

const IPEDS_FILE = 'vocab/.sources/ipeds-hd/HD2024.csv';

/** HD2024's rows, decoded and parsed once, every value trimmed. */
function readIpeds(content: Buffer): Array<Record<string, string>> {
  return csvRecords(decodeText(content, IPEDS_FILE), IPEDS_FILE,
    ['UNITID', 'INSTNM', 'IALIAS', 'CITY', 'STABBR', 'F1SYSNAM', 'CYACTIVE', 'DEGGRANT', 'CLOSEDAT', 'SECTOR', 'ACT',
      'DEATHYR'])
    .map((record) => Object.fromEntries(Object.entries(record).map(([column, value]) => [column, value.trim()])));
}

/**
 * Whether an IPEDS row is an institution someone attends that the vocabulary keeps (§5.1): active this year,
 * degree-granting and not closed, and not an administrative unit (SECTOR 0: the system, district and board offices
 * that IPEDS also marks degree-granting, whose aliases would own names such as "Minnesota State"). ACT 'M' and a
 * DEATHYR are a closure within the year.
 */
function ipedsKept(record: Readonly<Record<string, string>>): boolean {
  return record.CYACTIVE === '1' && record.DEGGRANT === '1' && record.CLOSEDAT === '-2' && record.SECTOR !== '0'
    && record.ACT !== 'M' && record.DEATHYR === '-2';
}

/** An alias as a surface: a short form (acronym-shaped) is marked so that the collision step can make it ambiguous
 *  unless a curated table vouches for it. */
function addAlias(draft: Draft, text: string, tier: RawTier): void {
  addSurface(draft, text, tier, 'institution', { shortForm: isAcronymShaped(text) });
}

function buildIpeds(records: ReadonlyArray<Record<string, string>>, patterns: SystemPattern[], context: AliasContext,
  campusContext: CampusContext): IpedsDraft[] {
  const where = IPEDS_FILE;
  const drafts: IpedsDraft[] = [];
  for (const record of records) {
    if (!ipedsKept(record)) continue;
    const unitid = record.UNITID!;
    if (!/^\d{6}$/.test(unitid)) fail(`${where} has the UNITID "${unitid}", which is not six digits.`);
    const instnm = clean(record.INSTNM!);
    const city = clean(record.CITY!);
    const { base, campus } = splitCampus(instnm, city, record.STABBR!, campusContext);
    const mainCampus = campus !== undefined && /^main campus$/i.test(campus);
    const system = clean(record.F1SYSNAM!);
    const draft: IpedsDraft = {
      id: `ipeds:${unitid}`, surfaces: [], unitid, instnm, base, city, st: record.STABBR!,
      campus: mainCampus ? undefined : campus, system: system === '-2' || system === '' ? undefined : system,
    };
    addSurface(draft, mainCampus ? base : instnm, 'p', 'institution');
    addSurface(draft, instnm, 'p', 'institution');
    const own: OwnName = { base, tokens: new Set(draft.surfaces.flatMap((surface) => surface.key.split(' '))) };
    for (const alias of splitAliases(record.IALIAS!, unitid, context)) {
      const reason = aliasDropReason(alias, own, context);
      if (reason === null) addAlias(draft, alias, 'v');
      else report.aliasesDropped.push(`${draft.id} "${alias}": ${reason}`);
    }
    const pattern = patterns.find((candidate) => candidate.regex.test(instnm));
    const rest = pattern ? pattern.regex.exec(instnm)![1]! : undefined;
    if (pattern && rest !== undefined && !/^main campus$/i.test(rest)) {
      for (const template of pattern.to) addSurface(draft, template.replace('{X}', rest), 'g', 'institution');
    }
    drafts.push(draft);
  }
  return drafts.sort((a, b) => (a.unitid < b.unitid ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Institutions: ROR

interface RorDraft extends Draft {
  rorId: string;
  city?: string;
  sub?: string;
  cc: string;
  wiki: boolean;
  /** ROR's aliases and acronyms, Latin script, added as surfaces once the alias filters' word lists are known. */
  aliases: string[];
  acronyms: string[];
}

const LATIN = /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u;
const isLatin = (text: string) => LATIN.test(text) && /\p{Script=Latin}/u.test(text);

/** A ROR candidate's aliases as surfaces, through the same filters as IPEDS's; every acronym is a short form. An
 *  acronym whose key a US institution holds outside the shared-name list is dropped and reported: the US institution
 *  owns it. */
function addRorAliases(draft: RorDraft, context: AliasContext, usKeys: ReadonlySet<string>,
  shared: ReadonlySet<string>): void {
  const own: OwnName = { base: draft.surfaces[0]!.text,
    tokens: new Set(draft.surfaces.flatMap((surface) => surface.key.split(' '))) };
  const keep = (text: string) => {
    const reason = aliasDropReason(text, own, context);
    if (reason !== null) report.aliasesDropped.push(`${draft.id} "${text}": ${reason}`);
    return reason === null;
  };
  for (const alias of draft.aliases) if (keep(alias)) addAlias(draft, alias, 'v');
  for (const acronym of draft.acronyms) {
    const key = normalize(acronym, 'institution').key;
    if (key.length < 2 || !keep(acronym)) continue;
    if (usKeys.has(key) && !shared.has(key)) report.rorAcronymsDropped.set(`${draft.id} "${acronym}"`, draft);
    else addSurface(draft, acronym, 'v', 'institution', { shortForm: true });
  }
}

function buildRorCandidates(content: Buffer): { drafts: RorDraft[]; total: number } {
  const where = 'vocab/.sources/ror/v2.15-2026-10-20-ror-data.json';
  const drafts: RorDraft[] = [];
  const total = eachRorRecord(content, where, (record) => {
    if (record.status !== 'active' || !record.types.includes('education')) return;
    const location = record.locations[0]?.geonames_details;
    const cc = location?.country_code;
    if (typeof cc !== 'string' || !/^[A-Z]{2}$/.test(cc) || IPEDS_COUNTRIES.has(cc)) return;
    const match = /^https:\/\/ror\.org\/(0[a-z0-9]{8})$/.exec(record.id);
    if (!match) fail(`${where} has the id "${record.id}", which is not a ROR id.`);
    const display = record.names.find((name) => name.types.includes('ror_display'));
    const english = record.names.find((name) => name.types.includes('label') && name.lang === 'en');
    const name = display && isLatin(display.value) ? display.value : english?.value;
    if (name === undefined || !isLatin(name)) return;
    const draft: RorDraft = {
      id: `ror:${match[1]!}`, surfaces: [], rorId: match[1]!, cc,
      city: typeof location?.name === 'string' && isLatin(location.name) ? clean(location.name) : undefined,
      sub: typeof location?.country_subdivision_name === 'string' && isLatin(location.country_subdivision_name)
        ? clean(location.country_subdivision_name) : undefined,
      wiki: (record.links ?? []).some((link) => link.type === 'wikipedia'), aliases: [], acronyms: [],
    };
    if (addSurface(draft, name, 'p', 'institution') === '') return;
    for (const entry of record.names) {
      if (!isLatin(entry.value)) continue;
      if (entry.types.includes('ror_display') || (entry.types.includes('label') && entry.lang === 'en')) {
        addSurface(draft, entry.value, 'p', 'institution');
      } else if (entry.types.includes('alias')) draft.aliases.push(clean(entry.value));
      else if (entry.types.includes('acronym')) draft.acronyms.push(clean(entry.value));
    }
    drafts.push(draft);
  });
  return { drafts: drafts.sort((a, b) => (a.rorId < b.rorId ? -1 : 1)), total };
}

/** A record as institutions-global.json writes it. */
function rorRecord(draft: RorDraft) {
  return { id: draft.rorId, s: rawSurfaces(draft), city: draft.city, sub: draft.sub, cc: draft.cc };
}

/** Compact JSON with sorted keys: what stableStringify writes for a record inside a file's list. */
function compactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${compactJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A campus-suffix word held by more institution surfaces than this is an ordinary word, not a campus's name. */
const CAMPUS_MAX_DF = 10;

/** Bytes kept free in institutions-global.json for the file's own fields (release, priority list, counts). The
 *  ambiguity flags are marked before the subset is taken, so each record's size is final when it is counted. */
const ROR_RESERVE = 4 * 1024;

/**
 * The ROR records institutions-global.json holds (§5.3 step 5): the curated tables' records first, then two passes
 * over the country priority list, the records with a Wikipedia link of every listed country first and the rest after,
 * each country's records by ROR id, until the first record that does not fit. The order decides coverage only: which
 * keys are ambiguous was settled over every candidate before (step 4).
 */
function subsetRor(candidates: RorDraft[], priority: readonly string[], forced: ReadonlySet<string>): RorDraft[] {
  const limit = VOCAB_BUDGETS.institutionsGlobal - ROR_RESERVE;
  const chosen = new Map<string, RorDraft>();
  let bytes = 0;
  const take = (draft: RorDraft) => {
    const size = Buffer.byteLength(compactJson(rorRecord(draft))) + 2;
    if (bytes + size > limit) return false;
    bytes += size;
    chosen.set(draft.id, draft);
    return true;
  };
  for (const draft of candidates) if (forced.has(draft.id)) take(draft);
  const byCountry = new Map<string, RorDraft[]>();
  for (const draft of candidates) {
    const list = byCountry.get(draft.cc) ?? [];
    list.push(draft);
    byCountry.set(draft.cc, list);
  }
  fill: for (const notable of [true, false]) {
    for (const country of priority) {
      for (const draft of byCountry.get(country) ?? []) {
        if (draft.wiki !== notable || chosen.has(draft.id)) continue;
        if (!take(draft)) break fill;
      }
    }
  }
  return [...chosen.values()].sort((a, b) => (a.rorId < b.rorId ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Fields of study: CIP 2020

interface FieldDraft extends Draft {
  cip: string;
  general: boolean;
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'or', 'to', 'a', 'an', 'at', 'by', 'on', 'with', 'as']);

/** A CIP family's capitals in title case: "COMPUTER AND INFORMATION SCIENCES" is "Computer and Information Sciences". */
function titleCase(text: string): string {
  return text.toLowerCase().replace(/[a-z]+/g, (word, offset: number) => {
    const startsWord = offset === 0 || /[\s/(-]$/.test(text.slice(0, offset));
    if (!startsWord) return word;
    return offset > 0 && SMALL_WORDS.has(word) ? word : word[0]!.toUpperCase() + word.slice(1);
  });
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/** CIP families of non-credit activities (basic skills, citizenship, health-related knowledge, interpersonal skills,
 *  leisure, personal awareness): nobody takes a degree in them, and their titles ("Art", "Theater", "Music") would
 *  otherwise make leisure activities of academic fields. */
const NON_CREDIT_FAMILIES: ReadonlySet<string> = new Set(['32', '33', '34', '35', '36', '37']);

/** Words of the tail two slashed names share ("American Indian/Native American Studies" is American Indian Studies
 *  too, "High School/Secondary Diploma Programs" is High School Diploma Programs). */
const SHARED_TAIL = new Set(['studies', 'study', 'program', 'programs', 'residency', 'fellowship', 'diploma',
  'diplomas', 'certificate', 'certificates', 'teacher', 'education']);
/** A last word that only says what kind of field the word before it is: "Biology/Biological Sciences" is Biology. */
const KIND_WORD = new Set(['sciences', 'science', 'studies', 'arts']);

/** A title's words with a word that repeats the one before it dropped ("Salon Salon Management" is Salon
 *  Management). */
function withoutRepeats(title: string): string {
  return title.split(' ').filter((word, i, all) => i === 0 || word.toLowerCase() !== all[i - 1]!.toLowerCase()).join(' ');
}

/**
 * The alternatives a CIP title's slashes name, read as CIP writes them. A bracket at the end ("Technology/Technician
 * (HVAC)") and a combined programme ("Pediatrics/Psychiatry Combined Specialty Program", one programme, not either) give
 * nothing of their own. Then:
 * - single words throughout are each a title ("Business/Commerce");
 * - two names of several words are both titles ("Criminal Justice/Police Science"), and the first also takes the
 *   tail the second ends in: a tail of one word as well as the name alone ("Mass Communication/Media Studies"), a
 *   longer one instead of it ("High School/Secondary Diploma Programs" is not High School). When the second is only
 *   such a tail, the slash joins two words ("Nurse Practitioner Residency/Fellowship Program"); when the first ends in
 *   a kind word that comes again in the second, what follows it is shared ("Family and Consumer Sciences/Human
 *   Sciences Business Services");
 * - several words, then one: the last word swapped ("Information Science/Studies" is Information Studies), unless the
 *   one word begins as the first does ("Surveying Technology/Surveying", "Fire Science/Fire-fighting");
 * - one word, then several: the first word swapped ("Fine/Studio Arts", "Cell/Cellular Biology and Histology", "Gene/
 *   Genetic Therapy"); the word with the last one when it is the first word again ("Environmental/Environmental Health
 *   Engineering" is Environmental Engineering, "Marketing/Marketing Management" is Marketing too); and the word alone
 *   when it only shares a stem with the next ("Biology/Biological Sciences", "Geometry/Geometric Analysis");
 * - three or more pieces of mixed lengths are read word by word, a repeated word dropped ("Salon/Beauty Salon
 *   Management/Manager" gives Salon Management), so no lone word comes out.
 */
function slashAlternatives(raw: string): string[] {
  // A reading of nothing but words for a kind of programme ("Fellowship Program") names no field.
  const named = (reading: string) => !reading.toLowerCase().split(' ')
    .every((word) => PROGRAM_WORDS.has(word) || SMALL_WORDS.has(word));
  return [...new Set(readSlashes(raw).map(withoutRepeats))].filter(named);
}

/** Words that say what kind of programme a title is, never what it is about. */
const PROGRAM_WORDS = new Set(['program', 'programs', 'residency', 'fellowship', 'certificate', 'certificates',
  'diploma', 'diplomas', 'studies', 'study']);

function readSlashes(raw: string): string[] {
  const head = clean(raw.replace(/\s*\([^()]*\)$/, ''));
  if (!head.includes('/') || /\bcombined\b/i.test(head)) return [];
  const pieces = head.split('/').map(clean).filter((piece) => piece !== '');
  if (pieces.length < 2) return [];
  const words = pieces.map((piece) => piece.split(' '));
  const multi = words.map((list) => list.length > 1);
  const lower = (text: string) => text.toLowerCase();
  if (multi.every(Boolean) || !multi.some(Boolean)) {
    if (pieces.length > 2 || !multi[0]) return pieces;
    const [first, second] = words as [string[], string[]];
    if (second.every((word) => SHARED_TAIL.has(lower(word)))) {
      return [[...first, ...second.slice(1)].join(' '), [...first.slice(0, -1), ...second].join(' ')];
    }
    // "Family and Consumer Sciences/Human Sciences Business Services": the first name ends in a kind word that comes
    // again in the second, and what follows it is shared.
    const kind = lower(first[first.length - 1]!);
    const again = KIND_WORD.has(kind) ? second.findIndex((word, i) => i > 0 && lower(word) === kind) : -1;
    if (again > 0 && again < second.length - 1) return [[...first, ...second.slice(again + 1)].join(' '), pieces[1]!];
    let tail = second.length;
    while (tail > 1 && SHARED_TAIL.has(lower(second[tail - 1]!))) tail -= 1;
    const shared = second.slice(tail);
    if (shared.length === 0 || SHARED_TAIL.has(lower(first[first.length - 1]!))) return pieces;
    // A tail of one word may be left off the first name ("Mass Communication/Media Studies" is Mass Communication);
    // a longer one may not ("High School/Secondary Diploma Programs" is not High School).
    const withTail = [...first, ...shared].join(' ');
    return shared.length === 1 ? [...pieces, withTail] : [withTail, pieces[1]!];
  }
  if (pieces.length > 2) {
    let titles = [''];
    for (const word of head.split(' ')) {
      const options = word.split('/').filter((option) => option !== '');
      titles = titles.flatMap((title) => options.map((option) => (title === '' ? option : `${title} ${option}`)));
      if (titles.length > 8) return pieces.filter((_, i) => multi[i]);
    }
    return [...new Set(titles.map(withoutRepeats))];
  }
  const [a, b] = pieces as [string, string];
  if (multi[0]) {
    const first = words[0]!;
    return lower(b).startsWith(lower(first[0]!)) ? [a, b] : [a, [...first.slice(0, -1), b].join(' ')];
  }
  const second = words[1]!;
  if (lower(a) === lower(second[0]!)) return second.length > 2 ? [`${a} ${second[second.length - 1]!}`, b] : [a, b];
  // The one word is the name the several end in: "Pathology/Experimental Pathology", "E-Commerce/Electronic
  // Commerce".
  if (lower(a).endsWith(lower(second[second.length - 1]!))) return [a, b];
  // The one word as a modifier of the next: "Cell/Cellular Biology", "Gene/Genetic Therapy". A different word that
  // only shares a stem is a field of its own: "Biology/Biological Sciences", "Geometry/Geometric Analysis",
  // "Agribusiness/Agricultural Business Operations".
  if (lower(second[0]!).startsWith(lower(a))) return [[a, ...second.slice(1)].join(' '), b];
  if (commonPrefix(lower(a), lower(second[0]!)) >= 4) return [a, b];
  return [[a, ...second.slice(1)].join(' '), b];
}

/** Whether CIP codes lie on one line of descent (each is the deepest one or above it). */
function oneLine(codes: readonly string[]): boolean {
  const deepest = codes.reduce((a, b) => (a.length >= b.length ? a : b));
  return codes.every((code) => deepest.startsWith(code));
}

/**
 * Generated readings that do not name one line of CIP codes are dropped, logged in the report: a reading another
 * line also gives ("Criminal Justice" from three sibling titles) names none of them, and one that another code has
 * as its title or a curated alias ("Geospatial Intelligence") is that code's.
 */
function dropSharedReadings(drafts: readonly FieldDraft[]): void {
  const holders = new Map<string, FieldDraft[]>();
  for (const draft of drafts) {
    for (const surface of draft.surfaces) holders.set(surface.key, [...(holders.get(surface.key) ?? []), draft]);
  }
  for (const [key, list] of holders) {
    if (oneLine(list.map((draft) => draft.cip))) continue;
    for (const draft of list) {
      const surface = draft.surfaces.find((candidate) => candidate.key === key)!;
      if (surface.tier !== 'g') continue;
      draft.surfaces.splice(draft.surfaces.indexOf(surface), 1);
      report.readingsDropped.push(`${draft.id} "${surface.text}": also ${list.filter((other) => other !== draft)
        .map((other) => other.id).join(', ')}`);
    }
  }
}

/** A title without its final period, ", General" split off. */
function splitTitle(raw: string, family: boolean): { display: string; general: boolean; head: string; suffix: string } {
  const title = clean(family ? titleCase(raw) : raw).replace(/\.$/, '');
  const general = /, General$/.test(title);
  const other = /, Other$/.exec(title);
  const head = title.replace(/, (?:General|Other)$/, '');
  return { display: general ? head : title, general, head, suffix: other ? ', Other' : '' };
}

function buildFields(content: Buffer, aliases: Curated['fieldAliases']['fields']): FieldDraft[] {
  const where = 'vocab/.sources/cip/CIPCode2020.csv';
  const records = csvRecords(decodeText(content, where), where, ['CIPCode', 'Action', 'CIPTitle']);
  const drafts = new Map<string, FieldDraft>();
  const titles = new Map<string, { display: string; general: boolean; pieces: string[] }>();
  for (const record of records) {
    const cip = record.CIPCode!.trim().replace(/^=/, '');
    if (!/^\d{2}(\.\d{2}(\d{2})?)?$/.test(cip)) fail(`${where} has the code "${record.CIPCode}", which is not a CIP code.`);
    const action = record.Action!.trim();
    if (action === 'Moved to' || action === 'Deleted') continue;
    const raw = clean(record.CIPTitle!);
    if (/^reserved\.?$/i.test(raw) || NON_CREDIT_FAMILIES.has(cip.slice(0, 2))) continue;
    if (drafts.has(cip)) fail(`${where} lists the code ${cip} twice.`);
    const { display, general, head, suffix } = splitTitle(raw, cip.length === 2);
    const draft: FieldDraft = { id: `cip:${cip}`, surfaces: [], cip, general: false };
    addSurface(draft, display, 'p', 'field');
    const pieces = slashAlternatives(head).map((piece) => `${piece}${suffix}`);
    for (const piece of pieces) addSurface(draft, piece, 'g', 'field');
    titles.set(cip, { display, general, pieces });
    drafts.set(cip, draft);
  }
  // A family's general program is xx.0000 (with its series xx.00) when CIP titles it "..., General", else xx.0101
  // (with xx.01): its title names the whole family, so the family takes it as a generated surface.
  for (const family of [...drafts.keys()].filter((cip) => cip.length === 2)) {
    const pair = [[`${family}.0000`, `${family}.00`], [`${family}.0101`, `${family}.01`]]
      .find(([code]) => titles.get(code!)?.general === true);
    if (!pair) continue;
    for (const code of pair) {
      const title = titles.get(code!);
      if (!title?.general) continue;
      drafts.get(code!)!.general = true;
      for (const text of [title.display, ...title.pieces]) addSurface(drafts.get(family)!, text, 'g', 'field');
    }
  }
  for (const { cip, aliases: list } of aliases) {
    const draft = drafts.get(cip);
    if (!draft) fail(`vocab/curated/field-aliases.json names the code ${cip}, which CIP 2020 does not have (or moved).`);
    for (const alias of list) addSurface(draft, alias, 'c', 'field');
  }
  const sorted = [...drafts.values()].sort((a, b) => (a.cip < b.cip ? -1 : 1));
  dropSharedReadings(sorted);
  return sorted;
}

/**
 * The discipline class of the guard (§4.5): the words of CIP's family and series titles (2 and 4 digits, without the
 * non-credit families), minus stopwords, the words guard.json's disciplineIgnore lists (studies, general, other,
 * services and the like) and the words another fixed class holds, plus guard.json's own discipline words. So
 * "mechanical", "electrical", "physics" and "accounting" tell fields and schools apart as "engineering" does.
 */
function disciplineWords(fields: readonly FieldDraft[], curated: Curated['guard'], taken: ReadonlySet<string>):
  Set<string> {
  const ignore = new Set(curated.disciplineIgnore.map((word) => guardMember(word)));
  const words = new Set<string>();
  for (const draft of fields) {
    if (draft.cip.length > 5) continue;
    for (const token of normalize(draft.surfaces[0]!.text, 'institution').core) {
      if (token.length < 3 || /\d/.test(token) || ignore.has(token) || taken.has(token)) continue;
      words.add(token);
    }
  }
  for (const word of curated.discipline) words.add(guardMember(word));
  return words;
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Degrees, countries, regions, languages and answers

interface DegreeDrafts {
  types: Array<Draft & { type: DegreeType; level: DegreeLevel; also?: DegreeLevel[]; codes: string[]; wordLike?: string[] }>;
  levels: Array<Draft & { level: DegreeLevel }>;
  classes: DegreeType[][];
}

function buildDegrees(curated: Curated['degrees']): DegreeDrafts {
  const byType = new Map(curated.types.map((entry) => [entry.type, entry]));
  if (byType.size !== curated.types.length) fail('vocab/curated/degrees.json lists a degree type twice.');
  const types = DEGREE_TYPES.map((type) => {
    const entry = byType.get(type);
    if (!entry) fail(`vocab/curated/degrees.json has no entry for the degree type ${type}.`);
    for (const code of entry.wordLike ?? []) {
      if (!entry.codes.includes(code)) fail(`vocab/curated/degrees.json: ${type}'s wordLike code ${code} is not one of its codes.`);
    }
    const draft = { id: `deg:type:${type}`, surfaces: [] as DraftSurface[], type, level: entry.level, also: entry.also,
      codes: entry.codes, wordLike: entry.wordLike };
    const undotted = entry.codes.map((code) => code.replace(/[.,]/g, ''));
    for (const text of [...entry.names, ...undotted, type]) addSurface(draft, text, 'v', 'degree');
    return draft;
  });
  const byLevel = new Map(curated.levels.map((entry) => [entry.level, entry]));
  const levels = DEGREE_LEVELS.map((level) => {
    const entry = byLevel.get(level);
    if (!entry) fail(`vocab/curated/degrees.json has no phrases for the degree level ${level}.`);
    const draft = { id: `deg:level:${level}`, surfaces: [] as DraftSurface[], level };
    for (const text of entry.names) addSurface(draft, text, 'v', 'degree');
    return draft;
  });
  const classed = curated.classes.flat();
  if (new Set(classed).size !== classed.length) fail('vocab/curated/degrees.json puts a degree type in two classes.');
  return { types, levels, classes: curated.classes };
}

interface CountryDraft extends Draft {
  a2: string;
  a3: string;
}

function buildCountries(territoriesContent: Buffer, mappingsContent: Buffer, curated: Curated['countries']): CountryDraft[] {
  const territories = (JSON.parse(territoriesContent.toString('utf8')) as {
    main: { en: { localeDisplayNames: { territories: Record<string, string> } } } }).main.en.localeDisplayNames.territories;
  const mappings = (JSON.parse(mappingsContent.toString('utf8')) as {
    supplemental: { codeMappings: Record<string, { _alpha3?: string }> } }).supplemental.codeMappings;
  const notIso = new Set(curated.notIso);
  const codes = Object.keys(territories).filter((code) => /^[A-Z]{2}$/.test(code) && !notIso.has(code)).sort();
  if (codes.length !== 249) fail(`CLDR gives ${codes.length} ISO 3166-1 codes once notIso is removed, not 249.`);
  const drafts = new Map<string, CountryDraft>();
  for (const code of codes) {
    const a3 = mappings[code]?._alpha3;
    if (!a3 || !/^[A-Z]{3}$/.test(a3)) fail(`CLDR's codeMappings.json has no alpha-3 code for ${code}.`);
    const draft: CountryDraft = { id: `iso:${code}`, surfaces: [], a2: code, a3 };
    addSurface(draft, territories[code]!, 'p', 'country');
    for (const alt of Object.keys(territories).filter((key) => key.startsWith(`${code}-alt-`)).sort()) {
      addSurface(draft, territories[alt]!, 'v', 'country');
    }
    drafts.set(code, draft);
  }
  for (const { code, aliases } of curated.countries) {
    const draft = drafts.get(code);
    if (!draft) fail(`vocab/curated/countries.aliases.json names ${code}, which is not an ISO 3166-1 code here.`);
    for (const alias of aliases) addSurface(draft, alias, 'c', 'country');
  }
  return [...drafts.values()];
}

interface RegionDraft extends Draft {
  cc: string;
  code: string;
  kind: RegionKind;
}

function buildRegions(curated: Curated['regions']): RegionDraft[] {
  const seen = new Set<string>();
  const drafts = curated.regions.map((entry) => {
    const id = `${entry.country === 'US' ? 'usps' : 'capost'}:${entry.code}`;
    if (seen.has(id)) fail(`vocab/curated/regions.json lists ${entry.country} ${entry.code} twice.`);
    seen.add(id);
    const draft: RegionDraft = { id, surfaces: [], cc: entry.country, code: entry.code, kind: entry.kind };
    addSurface(draft, entry.name, 'p', 'region');
    addSurface(draft, entry.code, 'v', 'region');
    for (const alias of entry.aliases) addSurface(draft, alias, 'c', 'region');
    return draft;
  });
  return drafts.sort((a, b) => (a.cc === b.cc ? (a.code < b.code ? -1 : 1) : a.cc < b.cc ? -1 : 1));
}

interface LanguageDrafts {
  languages: Array<Draft & { code: string }>;
  proficiency: Array<Draft & { proficiency: (typeof PROFICIENCIES)[number] }>;
}

function buildLanguages(content: Buffer, curated: Curated['languages']): LanguageDrafts {
  const names = (JSON.parse(content.toString('utf8')) as {
    main: { en: { localeDisplayNames: { languages: Record<string, string> } } } }).main.en.localeDisplayNames.languages;
  const codes = [...Object.keys(names).filter((code) => /^[a-z]{2}$/.test(code)), ...curated.extraCodes].sort();
  const drafts = new Map<string, Draft & { code: string }>();
  for (const code of codes) {
    const name = names[code];
    if (!name) fail(`CLDR has no English name for the language code ${code}.`);
    const draft = { id: `lang:${code}`, surfaces: [] as DraftSurface[], code };
    addSurface(draft, name, 'p', 'answer');
    const variant = new RegExp(`^${code}-(?:[A-Z]{2}|\\d{3}|[A-Z][a-z]{3}|alt-[a-z]+)$`);
    for (const key of Object.keys(names).filter((candidate) => variant.test(candidate)).sort()) {
      addSurface(draft, names[key]!, 'v', 'answer');
    }
    drafts.set(code, draft);
  }
  for (const { code, aliases } of curated.languages) {
    const draft = drafts.get(code);
    if (!draft) fail(`vocab/curated/languages.aliases.json names the language ${code}, which is not in the list.`);
    for (const alias of aliases) addSurface(draft, alias, 'c', 'answer');
  }
  const byId = new Map(curated.proficiency.map((entry) => [entry.id, entry]));
  const proficiency = PROFICIENCIES.map((id) => {
    const entry = byId.get(id);
    if (!entry) fail(`vocab/curated/languages.aliases.json has no proficiency phrases for ${id}.`);
    const draft = { id: `prof:${id}`, surfaces: [] as DraftSurface[], proficiency: id };
    for (const text of entry.names) addSurface(draft, text, 'c', 'answer');
    for (const text of entry.crosswalk) addSurface(draft, text, 'g', 'answer');
    return draft;
  });
  return { languages: [...drafts.values()], proficiency };
}

/** The values each EEO question may hold: the profile's lists, plus the derived ones. */
const EEO_IDS: Readonly<Record<EeoQuestion, readonly string[]>> = {
  gender: GENDERS,
  race: [...RACES, 'two-or-more-races', 'hispanic-latino'],
  hispanicLatino: ['yes', 'no'],
  veteran: ['protected-veteran', 'not-protected-veteran', 'veteran', 'not-veteran'],
  disability: ['yes', 'no'],
  sexualOrientation: [],
  transgender: [],
};

interface AnswerDrafts {
  referral: Array<Draft & { answerId: string; mentions: string[]; parents: string[] }>;
  eeo: Record<EeoQuestion, { values: Array<Draft & { answerId: string; derived: boolean }>; decline: RawPhrase[] }>;
  raw: Omit<RawAnswers, 'referral' | 'eeo'>;
}

function buildAnswers(curated: Curated): AnswerDrafts {
  const ids = new Set<string>();
  const referral = curated.referral.sources.map((entry) => {
    if (ids.has(entry.id)) fail(`vocab/curated/referral-sources.json lists ${entry.id} twice.`);
    ids.add(entry.id);
    const inNames = entry.names.includes(entry.display);
    if (!inNames && !entry.aliases.includes(entry.display)) {
      fail(`vocab/curated/referral-sources.json: ${entry.id}'s display "${entry.display}" is neither a name nor an alias.`);
    }
    const draft = { id: `ref:${entry.id}`, surfaces: [] as DraftSurface[], answerId: entry.id, mentions: [] as string[],
      parents: [...new Set(entry.parents ?? [])] };
    addSurface(draft, entry.display, inNames ? 'p' : 'c', 'answer');
    for (const name of entry.names) addSurface(draft, name, 'p', 'answer');
    for (const alias of entry.aliases) addSurface(draft, alias, 'c', 'answer');
    for (const mention of entry.mentions) {
      const key = normalize(mention, 'answer').key;
      if (key === '') fail(`vocab/curated/referral-sources.json: ${entry.id}'s mention "${mention}" normalizes to nothing.`);
      if (!draft.mentions.includes(key)) draft.mentions.push(key);
    }
    return draft;
  });
  for (const draft of referral) {
    for (const parent of draft.parents) {
      if (parent === draft.answerId || !ids.has(parent)) {
        fail(`vocab/curated/referral-sources.json: ${draft.answerId}'s parent "${parent}" is not another source.`);
      }
    }
  }
  const eeo = {} as AnswerDrafts['eeo'];
  for (const question of EEO_QUESTIONS) {
    const entry = curated.eeo.questions[question];
    const allowed = new Set(EEO_IDS[question]);
    const values = entry.values.map((value) => {
      if (!allowed.has(value.id)) fail(`vocab/curated/eeo.json: ${question} has the value ${value.id}, which is not one of its ids.`);
      const draft = { id: `eeo.${question}:${value.id}`, surfaces: [] as DraftSurface[], answerId: value.id,
        derived: value.derived === true };
      for (const label of value.labels) addSurface(draft, label, 'c', 'answer');
      return draft;
    });
    eeo[question] = { values, decline: rawPhrases(entry.decline, 'answer') };
  }
  for (const negator of curated.polarity.negators) {
    if (normalize(negator, 'answer').key !== negator) fail(`vocab/curated/polarity.json: the negator "${negator}" is not normalized.`);
  }
  const decline = rawPhrases(curated.decline.phrases, 'answer');
  return {
    referral,
    eeo,
    raw: {
      polarity: { yes: rawPhrases(curated.polarity.yes, 'answer'), no: rawPhrases(curated.polarity.no, 'answer'),
        negators: [...curated.polarity.negators] },
      decline,
      exclusive: rawPhrases([...curated.exclusive.phrases, ...decline.map(([text]) => text)], 'answer'),
      other: rawPhrases(curated.other.phrases, 'answer'),
      placeholders: rawPhrases(curated.placeholders.phrases, 'answer'),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Collisions

interface CollisionOptions {
  domain: string;
  /** For CIP: keys shared only along one line of descent are no collision. */
  lineage?: boolean;
  acknowledged: Map<string, string>;
  names: (draft: Draft) => string;
}

/** One key two or more entities share, for the report. */
interface Collision {
  key: string;
  holders: Array<{ draft: Draft; tier: RawTier }>;
}

/**
 * Marks every surface whose key two or more entities of the domain share as ambiguous (amb: 1 on every one) and
 * records the collision. A collision that involves a curated or flagship surface fails the build unless
 * ambiguous-ok.json lists it.
 */
function markCollisions(drafts: readonly Draft[], options: CollisionOptions, used: Set<string>): void {
  const owners = new Map<string, Draft[]>();
  for (const draft of drafts) {
    for (const surface of draft.surfaces) {
      const list = owners.get(surface.key) ?? [];
      if (!list.includes(draft)) list.push(draft);
      owners.set(surface.key, list);
    }
  }
  const collisions: Collision[] = [];
  const failures: string[] = [];
  for (const [key, list] of [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (list.length < 2) continue;
    if (options.lineage && oneLine(list.map((draft) => draft.id.slice(4)))) continue;
    const holders: Collision['holders'] = [];
    let curated = false;
    for (const draft of list) {
      const surface = draft.surfaces.find((candidate) => candidate.key === key)!;
      markAmbiguous(surface, 1);
      if (surface.tier === 'c' || surface.tier === 'f') curated = true;
      holders.push({ draft, tier: surface.tier });
    }
    collisions.push({ key, holders });
    const acknowledgedKey = `${options.domain}\u001f${key}`;
    if (curated) {
      if (options.acknowledged.has(acknowledgedKey)) {
        used.add(acknowledgedKey);
        report.acknowledged.push(`${options.domain} "${key}": ${options.acknowledged.get(acknowledgedKey)!}`);
      } else {
        failures.push(`${options.domain} "${key}" is shared by ${list.map((draft) => draft.id).join(', ')}`);
      }
    }
  }
  report.collisions.set(options.domain, collisions);
  if (failures.length > 0) {
    fail(`Curated or flagship aliases collide (list each in vocab/curated/ambiguous-ok.json only if it is meant, `
      + `otherwise remove the alias):\n  ${failures.join('\n  ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 9b. Institution names that name more institutions than hold them

/**
 * A flagship's bare name as a surface at the flagship tier, whatever tier its key had before: IPEDS's IALIAS already
 * holds "U of Michigan" and "Texas A&M University", and a flagship is the only way a bare system name names a campus,
 * always flagged (§4.5). Fails when the bare name is the campus's own name.
 */
function addFlagship(draft: Draft, bare: string): string {
  const key = addSurface(draft, bare, 'f', 'institution');
  const surface = draft.surfaces.find((candidate) => candidate.key === key);
  if (!surface) fail(`vocab/curated/institution-flagships.json: "${bare}" normalizes to nothing.`);
  if (surface.tier === 'p') fail(`vocab/curated/institution-flagships.json: "${bare}" is ${draft.id}'s own name.`);
  surface.tier = 'f';
  surface.text = clean(bare);
  surface.shortForm = false;
  return key;
}

/** The longest uncurated alias, in tokens, that the contained-name rule tests: a longer one says enough to be one
 *  institution's. */
const CONTAINED_MAX_TOKENS = 3;
/** "U of" and one letter, as the institution normalizer keys it: "U of M" names Michigan, Minnesota, Memphis, ... */
const U_OF_LETTER = /^university [a-z]$/;

/** The contiguous runs of one to CONTAINED_MAX_TOKENS tokens in a key. */
function runsOf(key: string): string[] {
  const tokens = key.split(' ');
  const out: string[] = [];
  for (let n = 1; n <= Math.min(CONTAINED_MAX_TOKENS, tokens.length); n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * Marks, over every candidate, the institution surfaces that more institutions answer to than the vocabulary can
 * list (flag 2: no entry's location settles them):
 * - a shared name (institution-shared-names.json, and every "U of" with one letter) on every holder, curated ones too;
 * - an uncurated short form: an acronym-shaped IPEDS or ROR alias, or a ROR acronym ("UT", "OSU", "UNH");
 * - an uncurated alias of at most three words that runs, whole, inside another institution's name ("Trinity",
 *   "Southern University", "Cal State", "Indian Institute of Technology");
 * - an uncurated alias whose key leaves a bracket out and that no bracket-free spelling of its institution shares.
 * And an IPEDS base name before a campus ("Concordia University" of "Concordia University-Irvine"): an institution
 * outside the campuses sharing that base holds the key as flag 1, so only the entry's location can settle it.
 * Flagships and the campuses' own names keep their keys.
 */
function markShortAndSharedNames(candidates: readonly Draft[], ipeds: readonly IpedsDraft[],
  shared: ReadonlyMap<string, string>): void {
  const holdersOfRun = new Map<string, Draft[]>();
  for (const draft of candidates) {
    for (const surface of draft.surfaces) {
      if (surface.tier !== 'p') continue;
      for (const run of runsOf(surface.key)) {
        const list = holdersOfRun.get(run) ?? [];
        if (list.length < 2 && !list.includes(draft)) list.push(draft);
        holdersOfRun.set(run, list);
      }
    }
  }
  const groups = new Map<string, Set<Draft>>();
  for (const draft of ipeds) {
    if (draft.base === draft.instnm) continue;
    const key = institutionKey(draft.base);
    groups.set(key, (groups.get(key) ?? new Set<Draft>()).add(draft));
  }
  for (const draft of candidates) {
    for (const surface of draft.surfaces) {
      if (shared.has(surface.key) || U_OF_LETTER.test(surface.key)) markFor(draft, surface, 'shared-name');
      const group = groups.get(surface.key);
      if (group && !group.has(draft) && surface.tier !== 'f') markFor(draft, surface, 'campus-base');
      if (surface.tier !== 'v') continue;
      if (surface.shortForm) markFor(draft, surface, 'acronym');
      if (surface.bracketed) markFor(draft, surface, 'bracket');
      const others = (holdersOfRun.get(surface.key) ?? []).filter((other) => other !== draft);
      if (surface.key.split(' ').length <= CONTAINED_MAX_TOKENS && others.length > 0) {
        markFor(draft, surface, 'contained');
      }
    }
  }
}

/** Records the bundled surfaces that the equal-key collisions marked only because a record outside the subset
 *  shares their key: the bundle alone would not show why they are ambiguous. */
function recordOutsideSubset(bundled: ReadonlySet<Draft>): void {
  for (const { key, holders } of report.collisions.get('institution') ?? []) {
    const inside = holders.filter(({ draft }) => bundled.has(draft));
    if (inside.length !== 1 || holders.length < 2) continue;
    const { draft } = inside[0]!;
    markFor(draft, draft.surfaces.find((surface) => surface.key === key)!, 'outside-subset');
  }
}

/** A name's initials, small words left out ("Carnegie Mellon University" is CMU). */
function initialsOf(name: string): string {
  return name.split(/[\s,/-]+/)
    .filter((word) => /^[A-Za-z]/.test(word) && !/^(?:of|the|at|and|in|for|a|an|on)$/i.test(word))
    .map((word) => word[0]!.toUpperCase()).join('');
}

/** The report's institution sections: the shared names and their holders, and the curated acronyms with what else
 *  the full sources (every IPEDS row, every ROR candidate) spell the same way, by acronym or by initials. */
function reportInstitutions(bundled: ReadonlySet<Draft>, candidates: readonly Draft[],
  shared: ReadonlyMap<string, string>, ipedsRecords: ReadonlyArray<Record<string, string>>,
  rorCandidates: readonly RorDraft[]): void {
  const byId = new Map(candidates.map((draft) => [draft.id, draft]));
  const nameOf = (draft: Draft) => `${draft.id} ${draft.surfaces[0]!.text}${bundled.has(draft) ? '' : ' [not bundled]'}`;
  const holders = new Map<string, Draft[]>();
  for (const entry of report.ambiguity.get('shared-name') ?? []) {
    const space = entry.indexOf(' ');
    const key = entry.slice(space + 1);
    holders.set(key, [...(holders.get(key) ?? []), byId.get(entry.slice(0, space))!]);
  }
  for (const [key, list] of [...holders].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const why = shared.get(key) ?? '"U of" and one letter';
    report.sharedNames.push(`"${key}" (${why}): ${list.map(nameOf).join('; ')}`);
  }
  for (const key of [...shared.keys()].filter((key) => !holders.has(key)).sort()) {
    report.sharedNames.push(`"${key}" (${shared.get(key)!}): held by no institution`);
  }
  const spelled = new Map<string, Set<string>>();
  const spell = (letters: string, who: string) => {
    const key = letters.toUpperCase();
    if (key.length >= 2) spelled.set(key, (spelled.get(key) ?? new Set<string>()).add(who));
  };
  for (const record of ipedsRecords) {
    const who = `ipeds:${record.UNITID!} ${clean(record.INSTNM!)}`;
    spell(initialsOf(clean(record.INSTNM!)), who);
    for (const alias of record.IALIAS!.split(/[|;,/]|\s{2,}/)) {
      if (isAcronymShaped(alias)) spell(alias.replace(/\./g, '').trim(), who);
    }
  }
  for (const draft of rorCandidates) {
    const who = `${draft.id} ${draft.surfaces[0]!.text}`;
    spell(initialsOf(draft.surfaces[0]!.text), who);
    for (const acronym of draft.acronyms) spell(acronym.replace(/\./g, ''), who);
  }
  for (const draft of bundled) {
    for (const surface of draft.surfaces) {
      if (surface.tier !== 'c' || surface.amb !== 0 || !isAcronymShaped(surface.text)) continue;
      const own = `${draft.id} ${draft.surfaces[0]!.text}`;
      const others = [...(spelled.get(surface.text.replace(/\./g, '').toUpperCase()) ?? [])].filter((who) => who !== own);
      report.curatedAcronyms.push(`${surface.text} (${own}): ${others.length === 0 ? 'no other institution'
        : `also ${others.length}: ${others.slice(0, 6).join('; ')}${others.length > 6 ? '; ...' : ''}`}`);
    }
  }
  report.curatedAcronyms.sort();
}

/** The city members that the bundled records alone would not give (they come from ROR records outside the subset or
 *  from guard.json) and that occur in a bundled institution's name, for review: each makes the guard stricter. */
function reportNewCities(guard: Record<GuardClass, Set<string>>, bundled: readonly Draft[],
  bundledCities: ReadonlySet<string>): void {
  const join = makeJoiner([...guard.city, ...guard.region, ...guard.country, ...guard.campus]);
  const fresh = new Set([...guard.city].filter((city) => !bundledCities.has(city)));
  const where = new Map<string, string[]>();
  for (const draft of bundled) {
    for (const token of new Set(join(normalize(draft.surfaces[0]!.text, 'institution').core))) {
      if (fresh.has(token)) where.set(token, [...(where.get(token) ?? []), draft.surfaces[0]!.text]);
    }
  }
  for (const [city, names] of [...where].sort(([a], [b]) => (a < b ? -1 : 1))) {
    report.newCities.push(`${city}: ${names.length} (${names.slice(0, 3).join('; ')}${names.length > 3 ? '; ...' : ''})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Document frequencies

function documentFrequencies(drafts: readonly Draft[]): { n: number; t: Record<string, number> } {
  const counts = new Map<string, number>();
  let n = 0;
  for (const draft of drafts) {
    for (const surface of draft.surfaces) {
      n += 1;
      for (const token of surface.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const t: Record<string, number> = {};
  for (const [token, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) if (count >= 3) t[token] = count;
  return { n, t };
}

// ---------------------------------------------------------------------------------------------------------------
// 11. The build

function main(): void {
  const { sources, bytes } = readSources();
  const curated = readCurated();
  const release = (id: string) => sources.find((source) => source.id === id)?.release ?? fail(`No source ${id}.`);

  const guardWords = curated.guard;
  const headNouns = new Set<string>(INSTITUTION_HEAD_NOUNS);
  const reserved = new Set<string>([...headNouns, ...guardWords.state, ...guardWords.tech, ...STOPWORDS.institution]);

  // Countries, regions and fields of study first: the alias filters and the campus split need their words.
  const countries = buildCountries(sourceFile(bytes, 'cldr-territories', 'territories.json'),
    sourceFile(bytes, 'cldr-code-mappings', 'codeMappings.json'), curated.countries);
  const regions = buildRegions(curated.regions);
  const stateNames = new Set(regions.map((region) => guardMember(region.surfaces[0]!.text)));
  const countryNames = new Set(countries.flatMap((country) => country.surfaces.map((surface) => guardMember(surface.text))));
  const fields = buildFields(sourceFile(bytes, 'cip', 'CIPCode2020.csv'), curated.fieldAliases.fields);
  const fixedWords = new Set([...reserved, ...guardWords.direction, ...guardWords.level].map(guardMember));
  const discipline = disciplineWords(fields, guardWords, fixedWords);

  // Institutions: IPEDS and the ROR candidates. Cities come from every candidate's place, not only the bundled ones,
  // so a school whose city the subset leaves out still tells its campuses apart (§4.5).
  const ipedsRecords = readIpeds(sourceFile(bytes, 'ipeds-hd', 'HD2024.csv'));
  const { drafts: rorCandidates, total: rorTotal } = buildRorCandidates(sourceFile(bytes, 'ror', 'v2.15-2026-10-20-ror-data.json'));
  const cities = new Set<string>();
  const addCity = (text: string) => {
    const member = guardMember(text);
    if (member.length >= 2 && !reserved.has(member)) cities.add(member);
  };
  for (const record of ipedsRecords) if (ipedsKept(record)) addCity(clean(record.CITY!));
  for (const draft of rorCandidates) if (draft.city) addCity(draft.city);
  for (const city of guardWords.cities) addCity(city);
  const aliasContext: AliasContext = {
    places: new Set([...ipedsRecords.map((record) => guardMember(clean(record.CITY!))), ...stateNames]),
    generic: new Set([...reserved, ...fixedWords, 'u', ...discipline, ...cities, ...stateNames, ...countryNames,
      ...guardWords.campusPhrases.map(guardMember)]),
    allNames: ipedsRecords.map((record) => clean(record.INSTNM!).toLowerCase()),
    disciplines: discipline,
    subjectWords: new Set(guardWords.disciplineIgnore.map(guardMember)),
  };
  const namesBefore = new Map<string, Set<string>>();
  for (const record of ipedsRecords) {
    if (!ipedsKept(record)) continue;
    for (const { left } of campusDashes(clean(record.INSTNM!))) {
      const key = institutionKey(left);
      namesBefore.set(key, (namesBefore.get(key) ?? new Set<string>()).add(record.UNITID!));
    }
  }
  const campusContext: CampusContext = {
    bases: new Set(curated.systemPatterns.patterns.map(({ from }) => from.replace(/^The /, ''))
      .filter((from) => from.endsWith('-{X}')).map((from) => from.slice(0, -'-{X}'.length).toLowerCase())),
    sharedBases: new Set([...namesBefore].filter(([, ids]) => ids.size >= 2).map(([key]) => key)),
    phrases: guardWords.campusPhrases.map(institutionKey),
    cities: new Set([...cities, ...ipedsRecords.map((record) => guardMember(clean(record.CITY!)))]),
    regions: stateNames,
    stateNames: new Map(curated.regions.regions.filter((region) => region.country === 'US')
      .map((region) => [region.code, region.name])),
  };
  const ipeds = buildIpeds(ipedsRecords, compilePatterns(curated.systemPatterns.patterns), aliasContext, campusContext);
  report.notes.push(`IPEDS: ${ipeds.length} institutions (CYACTIVE=1, DEGGRANT=1, not closed, not an administrative `
    + `unit). ROR: ${rorTotal} records, ${rorCandidates.length} active education organizations outside the US and its `
    + 'territories with a Latin-script name.');

  // The curated aliases and flagships, on both sources.
  const byName = new Map<string, Draft[]>();
  for (const draft of ipeds) byName.set(draft.instnm, [...(byName.get(draft.instnm) ?? []), draft]);
  for (const draft of rorCandidates) {
    const name = draft.surfaces[0]!.text;
    byName.set(name, [...(byName.get(name) ?? []), draft]);
  }
  const resolveName = (name: string, file: string): Draft => {
    const found = byName.get(name) ?? [];
    if (found.length !== 1) {
      fail(`vocab/curated/${file} names "${name}", which ${found.length === 0 ? 'no' : `${found.length}`} IPEDS or ROR `
        + `institution${found.length === 1 ? ' has' : 's have'} as its exact name.`);
    }
    return found[0]!;
  };
  const forced = new Set<string>();
  for (const { name, aliases } of curated.institutionAliases.institutions) {
    const draft = resolveName(name, 'institution-aliases.json');
    for (const alias of aliases) addSurface(draft, alias, 'c', 'institution');
    if (draft.id.startsWith('ror:')) forced.add(draft.id);
  }
  const flagships: RawLexicon['flagships'] = [];
  for (const { bare, name } of curated.flagships.flagships) {
    const draft = resolveName(name, 'institution-flagships.json');
    if (draft.id.startsWith('ror:')) fail(`vocab/curated/institution-flagships.json: "${name}" is not an IPEDS institution.`);
    flagships.push({ bare: clean(bare), key: addFlagship(draft, bare), id: draft.id });
  }

  // ROR's aliases and acronyms: a US institution owns an acronym of its own key, so ROR's "MIT" or "UCLA" is dropped,
  // unless the key is a shared name, whose every holder must stay visible.
  const sharedKeys = new Map(curated.sharedNames.names.map(({ name, reason }) => [institutionKey(name), reason]));
  const usKeys = new Set(ipeds.flatMap((draft) => draft.surfaces.map((surface) => surface.key)));
  for (const draft of rorCandidates) addRorAliases(draft, aliasContext, usKeys, new Set(sharedKeys.keys()));

  // Which institution keys are ambiguous, decided over every candidate before the subset is taken (§5.3 step 4).
  const acknowledged = new Map(curated.ambiguousOk.collisions.map((entry) => [`${entry.domain}\u001f${entry.key}`, entry.reason]));
  const used = new Set<string>();
  const nameOf = (draft: Draft) => draft.surfaces[0]!.text;
  const check = (domain: string, drafts: readonly Draft[], lineage = false) =>
    markCollisions(drafts, { domain, lineage, acknowledged, names: nameOf }, used);
  const candidates: Draft[] = [...ipeds, ...rorCandidates];
  check('institution', candidates);
  markShortAndSharedNames(candidates, ipeds, sharedKeys);

  const ror = subsetRor(rorCandidates, curated.rorCountries.priority, forced);
  const bundled = new Set<Draft>([...ipeds, ...ror]);
  recordOutsideSubset(bundled);
  reportInstitutions(bundled, candidates, sharedKeys, ipedsRecords, rorCandidates);
  const rorCounts: Record<string, number> = {};
  for (const draft of ror) rorCounts[draft.cc] = (rorCounts[draft.cc] ?? 0) + 1;
  report.notes.push(`ROR subset: ${ror.length} institutions within the budget, by country: `
    + `${curated.rorCountries.priority.filter((cc) => rorCounts[cc]).map((cc) => `${cc} ${rorCounts[cc]}`).join(', ')}.`);

  // Everything else.
  const degrees = buildDegrees(curated.degrees);
  const languages = buildLanguages(sourceFile(bytes, 'cldr-languages', 'languages.json'), curated.languages);
  const answers = buildAnswers(curated);

  // Collisions, domain by domain.
  check('field', fields, true);
  check('degree', [...degrees.types, ...degrees.levels]);
  check('country', countries);
  check('region', regions);
  check('language', languages.languages);
  check('proficiency', languages.proficiency);
  check('referral', answers.referral);
  for (const question of EEO_QUESTIONS) check(`eeo.${question}`, answers.eeo[question].values);
  const stale = [...acknowledged.keys()].filter((key) => !used.has(key));
  if (stale.length > 0) {
    fail(`vocab/curated/ambiguous-ok.json lists collisions that no longer happen: ${stale.map((key) => key.replace('\u001f', ' ')).join(', ')}.`);
  }

  // The guard's classes.
  const guard: Record<GuardClass, Set<string>> = Object.fromEntries(GUARD_CLASSES.map((c) => [c, new Set<string>()])) as Record<GuardClass, Set<string>>;
  const addMember = (guardClass: GuardClass, text: string) => {
    const member = guardMember(text);
    if (member === '' || member.length < 2 || reserved.has(member)) return;
    guard[guardClass].add(member);
  };
  for (const city of cities) guard.city.add(city);
  // Regions: names and the undotted aliases that carry no marker word. Dotted abbreviations ("Penn.", "Mass.",
  // "Wash.") would make ordinary words presence tokens, and "Washington State" would swallow the state marker.
  const markerWords = new Set([...guardWords.state, ...guardWords.tech]);
  for (const region of curated.regions.regions) {
    const code = region.code.toLowerCase();
    guard.regionCode.add(code);
    for (const text of [region.name, ...region.aliases]) {
      if (text.includes('.') || guardMember(text) === code) continue;
      if (normalize(text, 'institution').core.some((token) => markerWords.has(token))) continue;
      addMember('region', text);
    }
  }
  for (const country of countries) for (const surface of country.surfaces) addMember('country', surface.text);
  for (const word of guardWords.direction) guard.direction.add(word);
  for (const word of guardWords.state) guard.state.add(word);
  for (const word of guardWords.tech) guard.tech.add(word);
  for (const word of discipline) guard.discipline.add(word);
  for (const word of guardWords.level) guard.level.add(word);
  for (const noun of INSTITUTION_HEAD_NOUNS) guard.headNoun.add(noun);
  // Campuses: the curated phrases, and the words of IPEDS campus suffixes that no other class has and that are rare
  // among all institution spellings (at most CAMPUS_MAX_DF surfaces hold them), so "behrend" and "upstate" are
  // campuses while "new", "national" or "graduate" are not.
  for (const phrase of guardWords.campusPhrases) addMember('campus', phrase);
  const institutionDf = new Map<string, number>();
  for (const draft of [...ipeds, ...ror]) {
    for (const surface of draft.surfaces) {
      for (const token of surface.tokens) institutionDf.set(token, (institutionDf.get(token) ?? 0) + 1);
    }
  }
  const joinPhrases = makeJoiner([...guard.city, ...guard.region, ...guard.country, ...guard.campus]);
  const ignore = new Set(guardWords.campusIgnore);
  for (const draft of ipeds) {
    if (!draft.campus) continue;
    for (const token of joinPhrases(normalize(draft.campus, 'institution').core)) {
      if (token.length < 3 || /^\d+$/.test(token) || ignore.has(token) || reserved.has(token)) continue;
      if (GUARD_CLASSES.some((guardClass) => guard[guardClass].has(token))) continue;
      if ((institutionDf.get(token) ?? 0) <= CAMPUS_MAX_DF) guard.campus.add(token);
    }
  }
  reportNewCities(guard, [...ipeds, ...ror], new Set([...ipeds.map((draft) => guardMember(draft.city)),
    ...ror.flatMap((draft) => (draft.city ? [guardMember(draft.city)] : []))]));

  // The files.
  const allInstitutions: Draft[] = [...ipeds, ...ror];
  const systems = [...new Set(ipeds.flatMap((draft) => (draft.system ? [draft.system] : [])))].sort();
  const institutionsUs: RawInstitutionsUs = {
    release: release('ipeds-hd'),
    systems,
    institutions: ipeds.map((draft) => ({
      id: draft.unitid, s: rawSurfaces(draft), city: draft.city, st: draft.st, cc: TERRITORY_COUNTRY[draft.st],
      campus: draft.campus, sys: draft.system === undefined ? undefined : systems.indexOf(draft.system),
    })),
  };
  const institutionsGlobal: RawInstitutionsGlobal = {
    release: release('ror'),
    priority: [...curated.rorCountries.priority],
    counts: rorCounts,
    institutions: ror.map(rorRecord),
  };
  const fieldsFile: RawFields = {
    release: release('cip'),
    codes: fields.map((draft) => ({ cip: draft.cip, s: rawSurfaces(draft), general: draft.general ? 1 : undefined })),
  };
  const degreesFile: RawDegrees = {
    types: degrees.types.map((draft) => ({ type: draft.type, level: draft.level, also: draft.also, codes: draft.codes,
      wordLike: draft.wordLike, s: rawSurfaces(draft) })),
    levels: degrees.levels.map((draft) => ({ level: draft.level, s: rawSurfaces(draft) })),
    classes: degrees.classes,
  };
  const countriesFile: RawCountries = {
    release: release('cldr-territories'),
    countries: countries.map((draft) => ({ a2: draft.a2, a3: draft.a3, s: rawSurfaces(draft) })),
  };
  const regionsFile: RawRegions = {
    regions: regions.map((draft) => ({ cc: draft.cc, code: draft.code, kind: draft.kind, s: rawSurfaces(draft) })),
  };
  const languagesFile: RawLanguages = {
    release: release('cldr-languages'),
    languages: languages.languages.map((draft) => ({ code: draft.code, s: rawSurfaces(draft) })),
    proficiency: languages.proficiency.map((draft) => ({ id: draft.proficiency, s: rawSurfaces(draft) })),
  };
  const answersFile: RawAnswers = {
    referral: answers.referral.map((draft) => ({ id: draft.answerId, s: rawSurfaces(draft),
      m: draft.mentions.length > 0 ? draft.mentions : undefined, p: draft.parents.length > 0 ? draft.parents : undefined })),
    eeo: Object.fromEntries(EEO_QUESTIONS.map((question) => [question, {
      values: answers.eeo[question].values.map((draft) => ({ id: draft.answerId, s: rawSurfaces(draft),
        derived: draft.derived ? 1 as const : undefined })),
      decline: answers.eeo[question].decline,
    }])) as RawAnswers['eeo'],
    ...answers.raw,
  };
  const dfDomains: Array<[VocabDomain, readonly Draft[]]> = [
    ['institution', allInstitutions], ['field', fields], ['degree', [...degrees.types, ...degrees.levels]],
    ['country', countries], ['region', regions], ['language', languages.languages],
    ['proficiency', languages.proficiency], ['referral', answers.referral],
    ...EEO_QUESTIONS.filter((q) => answers.eeo[q].values.length > 0)
      .map((q): [VocabDomain, readonly Draft[]] => [`eeo.${q}` as VocabDomain, answers.eeo[q].values]),
  ];
  for (const [domain] of dfDomains) {
    if (!(domain in DOMAIN_CONTEXT)) fail(`The build computes frequencies for ${domain}, which is not a vocabulary domain.`);
  }
  const lexicon: RawLexicon = {
    normalizer: {
      version: NORMALIZER_VERSION,
      stopwords: Object.fromEntries(NORM_CONTEXTS.map((context) => [context, [...STOPWORDS[context]].sort()])) as RawLexicon['normalizer']['stopwords'],
      abbreviationsAll: Object.fromEntries(ABBREVIATIONS_ALL),
      abbreviations: Object.fromEntries([...ABBREVIATIONS_BY_CONTEXT].map(([context, table]) => [context, Object.fromEntries(table)])),
      fieldWholeValue: Object.fromEntries([...FIELD_WHOLE_VALUE].map(([key, value]) => [key, [...value]])),
      neverExpanded: [...NEVER_EXPANDED],
      saintNames: [...SAINT_NAMES],
      stateLike: [...STATE_LIKE],
      noiseQualifiers: [...NOISE_QUALIFIERS],
      headNouns: [...INSTITUTION_HEAD_NOUNS],
      degreeLevelPlurals: Object.fromEntries(DEGREE_LEVEL_PLURALS),
    },
    guard: Object.fromEntries(GUARD_CLASSES.map((guardClass) => [guardClass, [...guard[guardClass]].sort()])) as RawLexicon['guard'],
    df: Object.fromEntries(dfDomains.map(([domain, drafts]) => [domain, documentFrequencies(drafts)])),
    flagships: flagships.sort((a, b) => (a.key < b.key ? -1 : 1)),
    systemPatterns: curated.systemPatterns.patterns.map(({ from, to }) => ({ from, to: [...to] })),
  };

  const files: Array<[VocabFile, unknown, number]> = [
    ['institutionsUs', institutionsUs, institutionsUs.institutions.length],
    ['institutionsGlobal', institutionsGlobal, institutionsGlobal.institutions.length],
    ['fields', fieldsFile, fieldsFile.codes.length],
    ['degrees', degreesFile, degreesFile.types.length + degreesFile.levels.length],
    ['countries', countriesFile, countriesFile.countries.length],
    ['regions', regionsFile, regionsFile.regions.length],
    ['languages', languagesFile, languagesFile.languages.length + languagesFile.proficiency.length],
    ['answers', answersFile, answersFile.referral.length + EEO_QUESTIONS.reduce((n, q) => n + answersFile.eeo[q].values.length, 0)],
    ['lexicon', lexicon, GUARD_CLASSES.reduce((n, guardClass) => n + lexicon.guard[guardClass].length, 0)],
  ];
  const texts = new Map<VocabFile, string>();
  const manifest: RawManifest = { normalizerVersion: NORMALIZER_VERSION, files: {}, sources: {} };
  for (const [file, value, count] of files) {
    const text = stableStringify(value);
    texts.set(file, text);
    manifest.files[VOCAB_FILES[file]] = { sha256: sha256Hex(text), bytes: Buffer.byteLength(text), budget: VOCAB_BUDGETS[file], count };
  }
  for (const source of sources) {
    manifest.sources[source.id] = { release: source.release, licence: source.licence, files: { ...source.files } };
  }
  const manifestText = stableStringify(manifest);
  texts.set('manifest', manifestText);

  writeReport(sources, bundled);
  const over = [...texts].filter(([file, text]) => Buffer.byteLength(text) > VOCAB_BUDGETS[file])
    .map(([file, text]) => `${VOCAB_FILES[file]} is ${Buffer.byteLength(text)} bytes, over its ${VOCAB_BUDGETS[file]}`);
  if (over.length > 0) fail(`Files over budget (nothing was written but the report):\n  ${over.join('\n  ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, text] of texts) writeFileSync(join(OUT_DIR, VOCAB_FILES[file]), text);
  for (const [file, text] of texts) {
    console.log(`  ${VOCAB_FILES[file].padEnd(26)} ${String(Buffer.byteLength(text)).padStart(8)} of ${VOCAB_BUDGETS[file]} bytes`);
  }
  console.log(`vocab:build wrote ${texts.size} files to src/core/vocab/data, and vocab/reports/collisions.txt and `
    + 'ambiguous-surfaces.json.');
}

/** What each reason in ambiguous-surfaces.json means, for the file's own comment. */
const AMBIGUITY_NOTE = 'Bundled institution surfaces marked ambiguous for a reason the bundle alone does not show, '
  + 'as "<entity id> <key>": "<reasons>". Flag 1 (the entry\'s location may settle the key): outside-subset, a ROR '
  + 'record outside the subset shares the key; campus-base, the key is an IPEDS base name before a campus that this '
  + 'institution does not share. Flag 2 (nothing settles it): acronym, an uncurated short form; shared-name, '
  + 'institution-shared-names.json or "U of" and one letter; contained, an uncurated alias of at most three words '
  + 'inside another institution\'s name; bracket, an uncurated alias whose key leaves its bracket out. Keys shared '
  + 'inside the bundle, and keys on an unresolved "st?", are not listed: the bundle shows them. Generated by npm run '
  + 'vocab:build; src/core/vocab/vocab.test.ts checks every flag against it.';

function writeReport(sources: readonly Source[], bundled: ReadonlySet<Draft>): void {
  const lines = [
    '# Vocabulary collisions and review notes',
    '# Generated by npm run vocab:build (scripts/vocab-build.ts). Committed so every change to the vocabularies is reviewed.',
    `# Normalizer version ${NORMALIZER_VERSION}. Sources: ${sources.map((source) => `${source.id} ${source.release}`).join(', ')}.`,
    '',
    '## Notes',
    ...report.notes,
    '',
    '## Keys shared by several entities',
    'Each surface below is marked ambiguous (amb: 1): no exact or alias match may rest on it, and the canonicalizers',
    'resolve such a key only through the entry\'s location. Tiers: p primary, c curated, v vocab, g generated, f flagship.',
    'Institutions are checked against every ROR candidate, so a record outside the subset ("[not bundled]") counts;',
    'only keys a bundled institution holds are listed.',
  ];
  for (const [domain, collisions] of report.collisions) {
    const listed = domain === 'institution'
      ? collisions.filter(({ holders }) => holders.some(({ draft }) => bundled.has(draft))) : collisions;
    lines.push('', `### ${domain}: ${listed.length}`, ...listed.map(({ key, holders }) => `"${key}": ${holders
      .map(({ draft, tier }) => `${draft.id} (${tier}) ${draft.surfaces[0]!.text}${domain === 'institution'
        && !bundled.has(draft) ? ' [not bundled]' : ''}`).join('; ')}`));
  }
  /** A section: its title with the number of entries, its explanation, then the entries. */
  const section = (title: string, entries: readonly string[], ...explanation: string[]) =>
    lines.push('', `## ${title}: ${entries.length}`, ...explanation, ...entries);
  section('Acknowledged curated collisions (vocab/curated/ambiguous-ok.json)', report.acknowledged);
  section('Shared names (vocab/curated/institution-shared-names.json, and "U of" with one letter)', report.sharedNames,
    'Every holder is ambiguous and no location settles them: a profile with only such a name keeps the person\'s text.');
  section('Curated acronyms kept as one institution\'s', report.curatedAcronyms,
    'Each resolves to its institution although the full sources (every IPEDS row, every ROR candidate) give other',
    'institutions the same letters, as an acronym or as initials. Review each: move it to institution-shared-names.json',
    'to make it ambiguous.');
  const reasons = new Map<string, string[]>();
  for (const [reason, entries] of report.ambiguity) {
    for (const entry of entries) reasons.set(entry, [...(reasons.get(entry) ?? []), reason]);
  }
  const byId = new Map([...bundled].map((draft) => [draft.id, draft]));
  const idOf = (entry: string) => entry.slice(0, entry.indexOf(' '));
  const listed = [...reasons].filter(([entry]) => byId.has(idOf(entry)));
  const counts = AMBIGUITY_REASONS.map((reason) =>
    `${reason} ${listed.filter(([, list]) => list.includes(reason)).length}`);
  lines.push('', `## Bundled institution surfaces ambiguous beyond the bundle's own collisions: ${listed.length}`,
    `By reason (a surface may have several): ${counts.join(', ')}.`,
    'Each is listed in vocab/reports/ambiguous-surfaces.json.');
  const wordy = new Set(['contained', 'bracket']);
  const named = listed.filter(([, list]) => list.some((reason) => wordy.has(reason))).map(([entry, list]) => {
    const draft = byId.get(idOf(entry))!;
    const surface = draft.surfaces.find((candidate) => candidate.key === entry.slice(entry.indexOf(' ') + 1))!;
    return `${draft.id} "${surface.text}" (${draft.surfaces[0]!.text}): ${list.filter((reason) => wordy.has(reason))
      .join(', ')}`;
  }).sort();
  section('Uncurated aliases another institution\'s name holds whole, or that leave a bracket out', named,
    'Each is ambiguous for good. To keep one for its institution, add it to institution-aliases.json after review; the',
    'curated collision check then applies to it.');
  section('ROR acronyms dropped because a US institution has the same key', [...report.rorAcronymsDropped]
    .filter(([, draft]) => bundled.has(draft)).map(([entry, draft]) => `${entry} (${draft.surfaces[0]!.text})`).sort());
  section('City members from outside the bundled records that occur in bundled names', report.newCities,
    'They come from ROR records outside the subset or from guard.json; each makes the guard stricter for these names.');
  section('IPEDS aliases: how each comma and slash was split', report.aliasSplits);
  section('Bundled institutions\' aliases dropped, and why',
    report.aliasesDropped.filter((entry) => byId.has(idOf(entry))).sort());
  section('CIP readings dropped because they name no one line of codes', report.readingsDropped);
  mkdirSync(join(ROOT, 'vocab', 'reports'), { recursive: true });
  writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
  writeFileSync(AMBIGUITY_FILE, stableStringify({ comment: AMBIGUITY_NOTE,
    surfaces: Object.fromEntries(listed.map(([entry, list]) => [entry, [...list].sort().join(' ')])) }));
}

try {
  main();
} catch (error) {
  if (error instanceof BuildError) {
    console.error(`vocab:build failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
