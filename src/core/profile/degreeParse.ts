/*
 * Degree parsing (docs/design/core.md §4.9) and the degree canonicalizer (§2.7). Degree codes are punctuation-
 * sensitive: normalizing first would turn "M.Ed." into "med" and "A.S." into the word "as". So parseDegree reads the
 * text with its punctuation and case, through a regex table built from the degree vocabulary: each dotted code
 * ("Ph.D.") gives a pattern that takes the dots as optional, except a code whose undotted form is an English word,
 * which counts undotted only in capitals ("AS", never "as"). Long names ("Bachelor of Science") and level phrases
 * ("Bachelor's", "4-year degree") are matched case-insensitively. The longest matches win, without overlaps.
 */
import type { DegreeLevel, DegreeType } from '../enums';
import { capCodePoints, FOLD_MAX_CODE_POINTS, foldLetters, removeInvisibles } from '../text/fold';
import { extractQualifiers } from '../text/qualifiers';
import type { Degree } from '../types/profile';
import type { DegreeTypeEntity, Vocab } from '../vocab/types';
import { canonicalField, type Canonical, type CanonicalizeIssue } from './entities';

/** What a degree text names. */
export interface ParsedDegree {
  /** The level: the highest one the main text names by a phrase or through its types. */
  level?: DegreeLevel;
  /** Types the main text names, in order ("BA/BS" gives BA, BS). Members of one class stay apart: BSc is BSc. */
  types: DegreeType[];
  /** Types named inside brackets ("Doctorate (PhD, MD, JD)"), for the degree-qualifier-types rule. */
  qualifierTypes: DegreeType[];
  /** The field of study named around the degree ("Bachelor of Science in Computer Science"), as written. */
  field?: string;
}

/** Levels from lowest to highest, for choosing the highest one a text names. 'other' ranks below every level. */
export const DEGREE_LEVEL_RANK: Readonly<Record<DegreeLevel, number>> = {
  other: 0, highSchool: 1, associate: 2, bachelor: 3, master: 4, professional: 5, doctorate: 6,
};

interface Pattern {
  re: RegExp;
  type?: DegreeType;
  level?: DegreeLevel;
}

interface Hit {
  start: number;
  end: number;
  type?: DegreeType;
  level?: DegreeLevel;
}

const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';
/** Words that take an optional possessive or plural in a phrase ("Bachelor's", "Bachelors", "Bachelor"). */
const LEVEL_WORDS = new Set(['bachelor', 'master', 'associate', 'doctorate']);
const SEPARATOR = '[\\s\\-\\u2013\\u2014,]+';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A dotted code's patterns: dots optional ("Ph.D." reads "PhD", "ph.d", "Ph. D."), or, for a word-like code, dots
 *  required, with the undotted form in capitals only. */
function codePatterns(code: string, wordLike: boolean): RegExp[] {
  const groups = code.split(/[.,]/).filter((group) => group !== '');
  if (!wordLike) return [new RegExp(`${BEFORE}${groups.map(escape).join('\\.?\\s?')}\\.?${AFTER}`, 'giu')];
  return [
    new RegExp(`${BEFORE}${groups.map(escape).join('\\.\\s?')}\\.?${AFTER}`, 'giu'),
    new RegExp(`${BEFORE}${groups.map((group) => escape(group.toUpperCase())).join('')}${AFTER}`, 'gu'),
  ];
}

/** A long name's or level phrase's pattern: any case, spaces or hyphens between words, an optional possessive or
 *  plural on level words, and an optional trailing "degree". */
function phrasePattern(phrase: string): RegExp {
  const words = foldLetters(phrase).toLowerCase().split(/[\s\-\u2013\u2014]+/).map((word) => word.replace(/[,;:]$/, ''))
    .filter((word) => word !== '');
  const optionalDegree = words.length > 1 && words[words.length - 1] === 'degree';
  if (optionalDegree) words.pop();
  const body = words.map((word) => {
    const stem = word.replace(/['\u2019]s$/, '');
    return stem !== word || LEVEL_WORDS.has(stem) ? `${escape(stem)}(?:['\u2019]?s)?` : escape(word);
  }).join(SEPARATOR);
  return new RegExp(`${BEFORE}${body}${optionalDegree ? `(?:${SEPARATOR}degree)?` : ''}${AFTER}`, 'giu');
}

const TABLES = new WeakMap<Vocab, Pattern[]>();

/** The regex table of a vocabulary's degrees, built once per Vocab. */
function patternTable(vocab: Vocab): Pattern[] {
  const cached = TABLES.get(vocab);
  if (cached) return cached;
  const table: Pattern[] = [];
  for (const entry of vocab.degrees.types) {
    for (const code of entry.codes) {
      for (const re of codePatterns(code, entry.wordLikeCodes.includes(code))) table.push({ re, type: entry.type });
    }
    for (const name of longNames(entry)) table.push({ re: phrasePattern(name), type: entry.type });
  }
  for (const entry of vocab.degrees.levels) {
    for (const surface of entry.surfaces) table.push({ re: phrasePattern(surface.text), level: entry.level });
  }
  TABLES.set(vocab, table);
  return table;
}

/** A degree type's names that are not one of its codes written without dots, nor its id ("Bachelor of Science"). */
function longNames(entry: DegreeTypeEntity): string[] {
  const codes = new Set([entry.type, ...entry.codes.map((code) => code.replace(/[.,]/g, ''))]);
  return entry.surfaces.map((surface) => surface.text).filter((text) => !codes.has(text));
}

/** Every pattern's matches, longest first, kept when they overlap no longer one; returned in text order. */
function scan(text: string, table: readonly Pattern[]): Hit[] {
  const found: Hit[] = [];
  for (const pattern of table) {
    pattern.re.lastIndex = 0;
    for (let match = pattern.re.exec(text); match; match = pattern.re.exec(text)) {
      if (match[0] !== '') found.push({ start: match.index, end: match.index + match[0].length, type: pattern.type,
        level: pattern.level });
      if (match[0] === '') pattern.re.lastIndex += 1;
    }
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: Hit[] = [];
  for (const hit of found) {
    if (kept.every((other) => hit.end <= other.start || hit.start >= other.end)) kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Separators and connecting words around a field ("in", "of", "-", "degree", "major"). */
const LEADING = /^(?:[\s,;:/&()\-\u2013\u2014]|\b(?:in|of|with|degree|major|majoring|concentration|focus)\b)+/i;
const TRAILING = /(?:[\s,;:/&()\-\u2013\u2014]|\b(?:in|of|with|degree|major)\b)+$/i;
/** Words that, alone, name no field ("High School Diploma or GED" leaves "or"). */
const NOT_A_FIELD = /^(?:or|and|equivalent|higher|above|degree|program|programme|studies)$/i;

function fieldText(text: string): string | undefined {
  const field = text.replace(LEADING, '').replace(TRAILING, '').replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(field) || NOT_A_FIELD.test(field)) return undefined;
  return field;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/**
 * Parses a degree text (§4.9) into its level, the types it names in its main text and in brackets, and the field it
 * names around the degree: the text after the last degree match ("B.S. in Computer Science"), else before the first
 * ("Computer Science, B.S."), else, when only brackets name a degree, the main text ("Computer Science (B.S.)").
 * The level is the highest one the main text names by a phrase or through its types; when the main text names
 * neither, the bracketed types give it. Nothing found gives no level and no types.
 */
export function parseDegree(text: string, vocab: Vocab): ParsedDegree {
  const table = patternTable(vocab);
  const read = foldLetters(removeInvisibles(capCodePoints(text, FOLD_MAX_CODE_POINTS)));
  const { main, qualifiers } = extractQualifiers(read);
  const hits = scan(main, table);
  const types = unique(hits.flatMap((hit) => (hit.type ? [hit.type] : [])));
  const qualifierTypes = unique(qualifiers.flatMap((qualifier) => scan(qualifier, table))
    .flatMap((hit) => (hit.type ? [hit.type] : [])));
  const levelOf = (type: DegreeType) => vocab.degrees.type(type).level;
  const mainLevels = hits.map((hit) => hit.level ?? levelOf(hit.type!));
  const levels = mainLevels.length > 0 ? mainLevels : qualifierTypes.map(levelOf);
  const level = levels.length === 0 ? undefined
    : levels.reduce((best, candidate) => (DEGREE_LEVEL_RANK[candidate] > DEGREE_LEVEL_RANK[best] ? candidate : best));
  let field: string | undefined;
  if (hits.length > 0) field = fieldText(main.slice(hits[hits.length - 1]!.end)) ?? fieldText(main.slice(0, hits[0]!.start));
  else if (qualifierTypes.length > 0) field = fieldText(main);
  return { ...(level !== undefined ? { level } : {}), types, qualifierTypes, ...(field !== undefined ? { field } : {}) };
}

/** The one type a parse names: its only type, or its first when all are one class ("BS/BSc"); else its only
 *  bracketed type. */
function singleType(parsed: ParsedDegree, vocab: Vocab): DegreeType | undefined {
  const pick = (types: DegreeType[]) => types.length > 0
    && types.every((type) => vocab.degrees.classOf(type) === vocab.degrees.classOf(types[0]!)) ? types[0] : undefined;
  return pick(parsed.types) ?? pick(parsed.qualifierTypes);
}

/** A degree as given: free text, or TailorIT's parts (a level, a type such as "BS" or "B.S.", a field, a CIP code). */
export interface DegreeInput {
  text?: string;
  level?: DegreeLevel;
  type?: string;
  field?: string;
  cip?: string;
}

/**
 * The canonical degree (§2.7): a given level and type win ('other' counts as no level), the type read through the
 * degree vocabulary; otherwise parseDegree(text) gives them, the level following the type when only a type is
 * known. Nothing understood gives level 'other' with `degree-unparsed`, as does a type text that names no type. The
 * field is the given one, else the one the text names after "in" or "of", through canonicalField (CIP).
 */
export function canonicalDegree(input: DegreeInput, vocab: Vocab, path = 'degree'): Canonical<Degree> {
  const issues: CanonicalizeIssue[] = [];
  const text = input.text?.trim() ? input.text : undefined;
  const parsed = text === undefined ? undefined : parseDegree(text, vocab);
  let type: DegreeType | undefined;
  const typeText = input.type?.trim();
  if (typeText) {
    const exact = vocab.degrees.types.find((entry) => entry.type.toLowerCase() === typeText.toLowerCase());
    type = exact?.type ?? singleType(parseDegree(typeText, vocab), vocab);
    if (type === undefined) issues.push({ path: `${path}.type`, code: 'degree-unparsed' });
  } else if (parsed) {
    type = singleType(parsed, vocab);
  }
  let level: DegreeLevel | undefined = input.level !== undefined && input.level !== 'other' ? input.level
    : parsed?.level ?? (type !== undefined ? vocab.degrees.type(type).level : undefined);
  if (level === undefined) {
    if (input.level !== 'other') issues.push({ path, code: 'degree-unparsed' });
    level = 'other';
  }
  const fieldText = input.field?.trim() ? input.field : parsed?.field;
  let field: Degree['field'];
  if (fieldText !== undefined || input.cip?.trim()) {
    const result = canonicalField({ text: fieldText ?? '', cip: input.cip }, vocab, `${path}.field`);
    field = result.value;
    issues.push(...result.issues);
  }
  return {
    value: { level, ...(type !== undefined ? { type } : {}), ...(field !== undefined ? { field } : {}),
      userText: input.text ?? input.type ?? '' },
    issues,
  };
}
