/*
 * Builds the matcher's vocabularies (docs/design/core.md §5.3). It reads the pinned public sources in vocab/.sources/
 * (checked against vocab/sources.json's SHA-256s; scripts/vocab-fetch.mjs is the only thing that downloads them) and
 * the hand-kept tables in vocab/curated/, and writes src/core/vocab/data/*.json, stable-stringified, with manifest.json
 * and the review report vocab/reports/collisions.txt. Keys come from src/core/text/normalize.ts, the runtime's own
 * normalizer, so build keys equal runtime keys. Nothing here touches the network or the clock, and every list is
 * sorted before it is written, so running it twice gives byte-identical files. It exits 1 on a missing or changed
 * source file, a curated table that does not validate or resolve, an unacknowledged curated collision, or a file over
 * its budget (§5.1). Sources are data: they are decoded and parsed, never run.
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
import { INSTITUTION_HEAD_NOUNS, NORM_CONTEXTS, NORMALIZER_VERSION, normalize, type NormContext } from '../src/core/text/normalize';
import { NOISE_QUALIFIERS } from '../src/core/text/qualifiers';
import { sha256Hex } from '../src/core/text/sha256';
import { DEGREE_LEVEL_PLURALS, STOPWORDS } from '../src/core/text/tokens';
import type { VocabDomain } from '../src/core/types/intent';
import { stableStringify } from '../src/core/vocab/createVocab';
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
    comment: Comment, direction: TextList, state: TextList, tech: TextList, discipline: TextList, level: TextList,
    campusPhrases: TextList, cities: TextList, campusIgnore: TextList,
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
  /** Rests on an unresolved "st?", or shares its key with another entity. */
  amb: boolean;
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
function addSurface(draft: Draft, rawText: string, tier: RawTier, context: NormContext): string {
  const text = clean(rawText);
  const normalized = normalize(text, context);
  const { key } = normalized;
  if (key === '') return key;
  const existing = draft.surfaces.find((surface) => surface.key === key);
  if (existing) {
    if (TIER_RANK[tier] < TIER_RANK[existing.tier]) existing.tier = tier;
    return key;
  }
  const tokens = [...new Set([...normalized.core, ...normalized.qualifiers.flatMap((q) => q.tokens)])];
  draft.surfaces.push({ text, key, tier, tokens, amb: normalized.ambiguous.length > 0 });
  return key;
}

/** A draft's surfaces as the data files write them. */
function rawSurfaces(draft: Draft): RawSurface[] {
  return draft.surfaces.map((surface) => surface.amb
    ? [surface.text, surface.key, surface.tier, 1] : [surface.text, surface.key, surface.tier]);
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
  aliasesDropped: [] as string[],
  rorAcronymsDropped: [] as string[],
  collisions: new Map<string, string[]>(),
  acknowledged: [] as string[],
  notes: [] as string[],
};

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

/** INSTNM split at its first '-' that follows an institution's name and precedes a capital: "University of
 *  Michigan-Ann Arbor" is "University of Michigan" at the campus "Ann Arbor". */
function splitCampus(name: string): { base: string; campus?: string } {
  const dash = /\s*[-\u2013]\s*/g;
  for (let match = dash.exec(name); match; match = dash.exec(name)) {
    const left = name.slice(0, match.index).trim();
    const right = name.slice(match.index + match[0].length).trim();
    if (left === '' || right === '' || !CAMPUS_LEFT.test(left) || !/^[A-Z0-9]/.test(right)) continue;
    return { base: left, campus: right };
  }
  return { base: name };
}

interface AliasContext {
  places: Set<string>;
  genericTokens: Set<string>;
  stateNames: Set<string>;
  countryNames: Set<string>;
}

const CORPORATE = /^(?:inc|llc|ltd|corp|corporation|co)\.?$/i;

/**
 * IALIAS split into aliases: on '|', ';' and runs of two or more spaces, then on commas only where the comma
 * separates short aliases (each of at most four words, or a name with a head noun, or an acronym). A comma between a
 * name with a head noun and a place ("Trinity College, Hartford"), before an appositive name ("Rutgers, The State
 * University of New Jersey") or in an inverted name ("Incarnate Word, University of") stays inside the alias; a
 * trailing "Inc." is dropped. Every comma decision is logged in the report.
 */
function splitAliases(value: string, unitid: string, context: AliasContext): string[] {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-2' || trimmed === '.') return [];
  const out: string[] = [];
  for (const part of trimmed.split(/\s*[|;]\s*|\s{2,}/).map(clean).filter((p) => p !== '')) {
    if (!part.includes(',')) {
      out.push(part);
      continue;
    }
    const pieces = part.split(',').map(clean).filter((p) => p !== '' && !CORPORATE.test(p));
    if (pieces.length <= 1) {
      out.push(...pieces);
      continue;
    }
    if (pieces.length === 2 && /^(?:the\s+)?(?:university|college|institute|school)\s+of$/i.test(pieces[1]!)) {
      out.push(part);
      report.aliasSplits.push(`${unitid}: kept inverted "${part}"`);
      continue;
    }
    const merged = [pieces[0]!];
    for (const piece of pieces.slice(1)) {
      const before = merged[merged.length - 1]!;
      const isPlace = context.places.has(guardMember(piece)) || /^[A-Z]{2}$/.test(piece) || /^D\.?\s?C\.?$/.test(piece);
      const appositive = /^the\s/i.test(piece) && HEAD_NOUN.test(piece);
      if ((isPlace && HEAD_NOUN.test(before)) || appositive) merged[merged.length - 1] = `${before}, ${piece}`;
      else merged.push(piece);
    }
    const short = (piece: string) => piece.split(' ').length <= 4 || HEAD_NOUN.test(piece) || /^[A-Z0-9&.-]+$/.test(piece);
    if (merged.length === 1) {
      out.push(merged[0]!);
      report.aliasSplits.push(`${unitid}: kept "${part}" whole (place or appositive)`);
    } else if (merged.every(short)) {
      out.push(...merged);
      report.aliasSplits.push(`${unitid}: split "${part}" into ${merged.map((m) => `"${m}"`).join(', ')}`);
    } else {
      out.push(part);
      report.aliasSplits.push(`${unitid}: unsure, kept "${part}" whole`);
    }
  }
  return out;
}

/** Whether an IPEDS alias is worth a surface: not empty, not one generic word, a state's or a country's name. */
function aliasIsUseful(text: string, unitid: string, context: AliasContext): boolean {
  const core = normalize(text, 'institution').core;
  if (core.length === 0) return false;
  if (core.length > 1) return true;
  const token = core[0]!;
  const generic = token.length < 2 || context.genericTokens.has(token) || context.stateNames.has(token)
    || context.countryNames.has(token);
  if (generic) report.aliasesDropped.push(`${unitid}: "${text}"`);
  return !generic;
}

interface IpedsDraft extends Draft {
  unitid: string;
  instnm: string;
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

/** HD2024's rows, decoded and parsed once. */
function readIpeds(content: Buffer): Array<Record<string, string>> {
  return csvRecords(decodeText(content, IPEDS_FILE), IPEDS_FILE,
    ['UNITID', 'INSTNM', 'IALIAS', 'CITY', 'STABBR', 'F1SYSNAM', 'CYACTIVE', 'DEGGRANT', 'CLOSEDAT']);
}

function buildIpeds(records: ReadonlyArray<Record<string, string>>, patterns: SystemPattern[], context: AliasContext):
  IpedsDraft[] {
  const where = IPEDS_FILE;
  const drafts: IpedsDraft[] = [];
  for (const record of records) {
    if (record.CYACTIVE!.trim() !== '1' || record.DEGGRANT!.trim() !== '1' || record.CLOSEDAT!.trim() !== '-2') continue;
    const unitid = record.UNITID!.trim();
    if (!/^\d{6}$/.test(unitid)) fail(`${where} has the UNITID "${unitid}", which is not six digits.`);
    const instnm = clean(record.INSTNM!);
    const { base, campus } = splitCampus(instnm);
    const mainCampus = campus !== undefined && /^main campus$/i.test(campus);
    const system = clean(record.F1SYSNAM!);
    const draft: IpedsDraft = {
      id: `ipeds:${unitid}`, surfaces: [], unitid, instnm, city: clean(record.CITY!), st: record.STABBR!.trim(),
      campus: mainCampus ? undefined : campus, system: system === '-2' || system === '' ? undefined : system,
    };
    addSurface(draft, mainCampus ? base : instnm, 'p', 'institution');
    addSurface(draft, instnm, 'p', 'institution');
    for (const alias of splitAliases(record.IALIAS!, unitid, context)) {
      if (aliasIsUseful(alias, unitid, context)) addSurface(draft, alias, 'v', 'institution');
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
  acronyms: string[];
}

const LATIN = /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u;
const isLatin = (text: string) => LATIN.test(text) && /\p{Script=Latin}/u.test(text);

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
      wiki: (record.links ?? []).some((link) => link.type === 'wikipedia'), acronyms: [],
    };
    if (addSurface(draft, name, 'p', 'institution') === '') return;
    for (const entry of record.names) {
      if (!isLatin(entry.value)) continue;
      if (entry.types.includes('ror_display') || (entry.types.includes('label') && entry.lang === 'en')) {
        addSurface(draft, entry.value, 'p', 'institution');
      } else if (entry.types.includes('alias')) addSurface(draft, entry.value, 'v', 'institution');
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

/** Bytes kept free in institutions-global.json for the file's own fields and the ambiguity flags marked afterwards. */
const ROR_RESERVE = 16 * 1024;

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

/**
 * The alternatives a CIP title's slashes name. Whole pieces when each has two or more words ("Health Services/Allied
 * Health") or all are single words ("Business/Commerce"); the last word swapped when only the first piece has several
 * words ("Information Science/Studies" is also "Information Studies"); the first word swapped when only the last has
 * several, unless the single words merely restate it ("Fine/Studio Arts" is "Fine Arts" and "Studio Arts", but
 * "Biology/Biological Sciences" is "Biology" and "Biological Sciences"). Three or more pieces of mixed lengths are read
 * word by word ("Maternal/Child Health and Neonatal Nurse/Nursing" gives four titles), so no lone word comes out.
 */
function slashAlternatives(head: string): string[] {
  const pieces = head.split('/').map(clean).filter((piece) => piece !== '');
  if (pieces.length < 2) return [];
  const words = pieces.map((piece) => piece.split(' '));
  const multi = words.map((list) => list.length > 1);
  const first = words[0]!;
  const last = words[words.length - 1]!;
  if (multi.every(Boolean) || !multi.some(Boolean)) return pieces;
  if (pieces.length > 2) {
    let titles = [''];
    for (const word of clean(head).split(' ')) {
      const options = word.split('/').filter((option) => option !== '');
      titles = titles.flatMap((title) => options.map((option) => (title === '' ? option : `${title} ${option}`)));
      if (titles.length > 8) return pieces.filter((_, i) => multi[i]);
    }
    return titles;
  }
  if (multi[0] && multi.slice(1).every((m) => !m)) {
    return [pieces[0]!, ...pieces.slice(1).map((piece) => [...first.slice(0, -1), piece].join(' '))];
  }
  if (multi[multi.length - 1] && multi.slice(0, -1).every((m) => !m)) {
    const restates = pieces.slice(0, -1).every((piece) => commonPrefix(piece.toLowerCase(), last[0]!.toLowerCase()) >= 4);
    if (restates) return pieces;
    return [...pieces.slice(0, -1).map((piece) => [piece, ...last.slice(1)].join(' ')), pieces[pieces.length - 1]!];
  }
  return pieces;
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
    if (/^reserved\.?$/i.test(raw)) continue;
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
  return [...drafts.values()].sort((a, b) => (a.cip < b.cip ? -1 : 1));
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
  referral: Array<Draft & { answerId: string; mentions: string[] }>;
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
    const draft = { id: `ref:${entry.id}`, surfaces: [] as DraftSurface[], answerId: entry.id, mentions: [] as string[] };
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
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [key, list] of [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (list.length < 2) continue;
    if (options.lineage) {
      const codes = list.map((draft) => draft.id.slice(4));
      const deepest = codes.reduce((a, b) => (a.length >= b.length ? a : b));
      if (codes.every((code) => deepest.startsWith(code))) continue;
    }
    const tiers: string[] = [];
    let curated = false;
    for (const draft of list) {
      const surface = draft.surfaces.find((candidate) => candidate.key === key)!;
      surface.amb = true;
      if (surface.tier === 'c' || surface.tier === 'f') curated = true;
      tiers.push(`${draft.id} (${surface.tier}) ${options.names(draft)}`);
    }
    lines.push(`"${key}": ${tiers.join('; ')}`);
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
  report.collisions.set(options.domain, lines);
  if (failures.length > 0) {
    fail(`Curated or flagship aliases collide (list each in vocab/curated/ambiguous-ok.json only if it is meant, `
      + `otherwise remove the alias):\n  ${failures.join('\n  ')}`);
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

  // Countries and regions first: the IPEDS alias filter needs their names.
  const countries = buildCountries(sourceFile(bytes, 'cldr-territories', 'territories.json'),
    sourceFile(bytes, 'cldr-code-mappings', 'codeMappings.json'), curated.countries);
  const regions = buildRegions(curated.regions);
  const stateNames = new Set(regions.map((region) => guardMember(region.surfaces[0]!.text)));
  const countryNames = new Set(countries.flatMap((country) => country.surfaces.map((surface) => guardMember(surface.text))));

  // Institutions: IPEDS, then the ROR candidates, then the curated aliases and flagships on both.
  const ipedsRecords = readIpeds(sourceFile(bytes, 'ipeds-hd', 'HD2024.csv'));
  const cityNames = new Set(ipedsRecords.map((record) => guardMember(record.CITY!)));
  const aliasContext: AliasContext = {
    places: new Set([...cityNames, ...stateNames]),
    genericTokens: new Set([...reserved, ...guardWords.direction, 'u']),
    stateNames,
    countryNames,
  };
  const ipeds = buildIpeds(ipedsRecords, compilePatterns(curated.systemPatterns.patterns), aliasContext);
  const { drafts: rorCandidates, total: rorTotal } = buildRorCandidates(sourceFile(bytes, 'ror', 'v2.15-2026-10-20-ror-data.json'));
  report.notes.push(`IPEDS: ${ipeds.length} institutions (CYACTIVE=1, DEGGRANT=1, not closed). ROR: ${rorTotal} records, `
    + `${rorCandidates.length} active education organizations outside the US and its territories with a Latin-script name.`);

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
    const key = addSurface(draft, bare, 'f', 'institution');
    flagships.push({ bare: clean(bare), key, id: draft.id });
  }

  // ROR acronyms: a US institution (IPEDS or curated) owns its acronym, so ROR's "MIT" or "UCLA" is dropped.
  const usKeys = new Set(ipeds.flatMap((draft) => draft.surfaces.map((surface) => surface.key)));
  const droppedAcronyms = new Map<string, string[]>();
  for (const draft of rorCandidates) {
    for (const acronym of draft.acronyms) {
      const key = normalize(acronym, 'institution').key;
      if (key.length < 2) continue;
      if (usKeys.has(key)) droppedAcronyms.set(draft.id, [...(droppedAcronyms.get(draft.id) ?? []), acronym]);
      else addSurface(draft, acronym, 'v', 'institution');
    }
  }
  const ror = subsetRor(rorCandidates, curated.rorCountries.priority, forced);
  for (const draft of ror) {
    for (const acronym of droppedAcronyms.get(draft.id) ?? []) {
      report.rorAcronymsDropped.push(`${draft.id} "${acronym}" (${draft.surfaces[0]!.text})`);
    }
  }
  const rorCounts: Record<string, number> = {};
  for (const draft of ror) rorCounts[draft.cc] = (rorCounts[draft.cc] ?? 0) + 1;
  report.notes.push(`ROR subset: ${ror.length} institutions within the budget, by country: `
    + `${curated.rorCountries.priority.filter((cc) => rorCounts[cc]).map((cc) => `${cc} ${rorCounts[cc]}`).join(', ')}.`);

  // Everything else.
  const fields = buildFields(sourceFile(bytes, 'cip', 'CIPCode2020.csv'), curated.fieldAliases.fields);
  const degrees = buildDegrees(curated.degrees);
  const languages = buildLanguages(sourceFile(bytes, 'cldr-languages', 'languages.json'), curated.languages);
  const answers = buildAnswers(curated);

  // Collisions, domain by domain.
  const acknowledged = new Map(curated.ambiguousOk.collisions.map((entry) => [`${entry.domain}\u001f${entry.key}`, entry.reason]));
  const used = new Set<string>();
  const nameOf = (draft: Draft) => draft.surfaces[0]!.text;
  const check = (domain: string, drafts: readonly Draft[], lineage = false) =>
    markCollisions(drafts, { domain, lineage, acknowledged, names: nameOf }, used);
  check('institution', [...ipeds, ...ror]);
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
  for (const draft of ipeds) addMember('city', draft.city);
  for (const draft of ror) if (draft.city) addMember('city', draft.city);
  for (const city of guardWords.cities) addMember('city', city);
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
  for (const word of guardWords.discipline) guard.discipline.add(word);
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
      m: draft.mentions.length > 0 ? draft.mentions : undefined })),
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

  writeReport(sources);
  const over = [...texts].filter(([file, text]) => Buffer.byteLength(text) > VOCAB_BUDGETS[file])
    .map(([file, text]) => `${VOCAB_FILES[file]} is ${Buffer.byteLength(text)} bytes, over its ${VOCAB_BUDGETS[file]}`);
  if (over.length > 0) fail(`Files over budget (nothing was written but the report):\n  ${over.join('\n  ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, text] of texts) writeFileSync(join(OUT_DIR, VOCAB_FILES[file]), text);
  for (const [file, text] of texts) {
    console.log(`  ${VOCAB_FILES[file].padEnd(26)} ${String(Buffer.byteLength(text)).padStart(8)} of ${VOCAB_BUDGETS[file]} bytes`);
  }
  console.log(`vocab:build wrote ${texts.size} files to src/core/vocab/data and vocab/reports/collisions.txt.`);
}

function writeReport(sources: readonly Source[]): void {
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
  ];
  for (const [domain, collisions] of report.collisions) {
    lines.push('', `### ${domain}: ${collisions.length}`, ...collisions);
  }
  lines.push('', `## Acknowledged curated collisions (vocab/curated/ambiguous-ok.json): ${report.acknowledged.length}`,
    ...report.acknowledged);
  lines.push('', `## ROR acronyms dropped because a US institution has the same key: ${report.rorAcronymsDropped.length}`,
    ...[...report.rorAcronymsDropped].sort());
  lines.push('', `## IPEDS aliases with commas: how each was split (${report.aliasSplits.length})`, ...report.aliasSplits);
  lines.push('', `## IPEDS aliases dropped as one generic word, state or country (${report.aliasesDropped.length})`,
    ...report.aliasesDropped);
  mkdirSync(join(ROOT, 'vocab', 'reports'), { recursive: true });
  writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
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
