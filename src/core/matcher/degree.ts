/*
 * Degree granularity (docs/design/core.md §4.9): how a degree is matched depends on what the list offers. A list of
 * levels ("Bachelor's Degree") is matched by level; a list of types ("B.S.") by type class, never BA to BS; a list
 * that pairs types with fields ("B.S. in Computer Science") needs both to agree. MBA reaches Master's, and JD or MD
 * Doctorate, only as flagged fallbacks, unless the doctorate option lists the type in its brackets ("Doctorate (PhD,
 * MD, JD)"). The same rules decide which options the LLM may see: a different level or type class is a conflict no
 * stage may overrule, and so is a field of study other than the entry's, on any list ("B.S. Mathematics" is not a
 * B.S. in Computer Science, and an entry without a field takes no option that names one), and so are bracketed types
 * of another class ("Doctorate (EdD)" is no PhD). Options of one level whose bracketed types differ are variants, not
 * duplicates: a level-only entry cannot choose between "Doctorate (PhD)" and "Doctorate (EdD)". Options are parsed
 * once, by prepareOptions, with parseDegree.
 */
import {
  DEGREE_COMBINED_SHARE, DEGREE_LEVELS_SHARE, DEGREE_MIXED_SHARE, DEGREE_TYPES_SHARE,
  MATCH_DEGREE, MATCH_DEGREE_DOCTORATE_FALLBACK, MATCH_DEGREE_LEVEL_FALLBACK,
} from '../confidence';
import type { DegreeLevel, DegreeType } from '../enums';
import { canonicalField } from '../profile/entities';
import type { ParsedDegree } from '../profile/degreeParse';
import type { FieldOfStudy } from '../types/profile';
import { keyFor } from '../vocab/lookup';
import type { Vocab } from '../vocab/types';
import { substantive } from './prepare';
import { stageHit, type StageHit } from './rank';
import type { PreparedOption, PreparedOptions } from './types';

/** How a list offers degrees (§4.9's table). */
export const DEGREE_GRANULARITIES = ['combined', 'types', 'levels', 'mixed', 'unknown'] as const;
export type DegreeGranularity = (typeof DEGREE_GRANULARITIES)[number];

/** The degree a value means. */
export interface DegreeIntent {
  level: DegreeLevel;
  type: DegreeType | null;
}

/** The options that describe a degree: substantive and parsed. */
function degreeOptions(options: readonly PreparedOption[]): Array<PreparedOption & { degree: ParsedDegree }> {
  return options.filter((option): option is PreparedOption & { degree: ParsedDegree } =>
    substantive(option) && option.degree !== undefined);
}

/** A parse that names a level and no type ("Bachelor's", "Doctorate (PhD, MD, JD)"). */
function levelOnly(parsed: ParsedDegree): boolean {
  return parsed.types.length === 0 && parsed.level !== undefined && parsed.level !== 'other';
}

/** How the usable options offer degrees (§4.9), by the shares in confidence.ts. */
export function detectDegreeGranularity(options: readonly PreparedOption[]): DegreeGranularity {
  const list = degreeOptions(options);
  const total = list.length;
  if (total === 0) return 'unknown';
  const typed = list.filter((option) => option.degree.types.length > 0).length;
  const combined = list.filter((option) => option.degree.types.length > 0 && option.degree.field !== undefined).length;
  const levels = list.filter((option) => levelOnly(option.degree)).length;
  if (combined / total >= DEGREE_COMBINED_SHARE) return 'combined';
  if (typed / total >= DEGREE_TYPES_SHARE) return 'types';
  if (levels / total >= DEGREE_LEVELS_SHARE) return 'levels';
  if ((typed + levels) / total >= DEGREE_MIXED_SHARE) return 'mixed';
  return 'unknown';
}

/** The levels a type may stand for on a list without its own level (MBA as master, JD or MD as doctorate). */
function alsoLevels(intent: DegreeIntent, vocab: Vocab): readonly DegreeLevel[] {
  return intent.type === null ? [] : vocab.degrees.type(intent.type).alsoCountsAs;
}

/** How closely an option's types match the intended type: 3 the type alone, 2 its class alone, 1 the class among
 *  others ("BA/BS"), 0 not at all. */
function typeFit(intent: DegreeIntent, parsed: ParsedDegree, vocab: Vocab): number {
  if (intent.type === null || parsed.types.length === 0) return 0;
  const wanted = vocab.degrees.classOf(intent.type);
  const inClass = parsed.types.filter((type) => vocab.degrees.classOf(type) === wanted);
  if (inClass.length === 0) return 0;
  if (inClass.length < parsed.types.length) return 1;
  return parsed.types.length === 1 && parsed.types[0] === intent.type ? 3 : 2;
}

/**
 * Whether an option's field of study is the entry's, as a conflict reads it: the same CIP code or one on its line of
 * descent ("Computer and Information Sciences" for Computer Science), else the same key as the entry's name or its
 * own text. False when the entry has no field.
 */
export function fieldAgrees(text: string, field: FieldOfStudy | undefined, vocab: Vocab): boolean {
  if (field === undefined) return false;
  const option = canonicalField({ text }, vocab).value;
  if (field.cip !== undefined && option.cip !== undefined) {
    const [a, b] = [`cip:${option.cip}`, `cip:${field.cip}`];
    return vocab.fields.isSameOrAncestor(a, b) || vocab.fields.isSameOrAncestor(b, a);
  }
  const key = keyFor(option.name, 'field');
  return key !== '' && [field.name, field.userText].some((name) => keyFor(name, 'field') === key);
}

/** An option the degree rules rule out: another level (not one the type may stand for), types or bracketed types
 *  none of which is in the intended type's class, or a field of study that is not the entry's `field` (any field,
 *  when the entry has none). No stage, the LLM included, may choose it. */
export function degreeConflict(intent: DegreeIntent, parsed: ParsedDegree | undefined, vocab: Vocab,
  field?: FieldOfStudy): boolean {
  if (!parsed) return false;
  if (parsed.field !== undefined && !fieldAgrees(parsed.field, field, vocab)) return true;
  if (intent.type !== null && parsed.types.length > 0 && typeFit(intent, parsed, vocab) === 0) return true;
  if (intent.type !== null && parsed.qualifierTypes.length > 0) {
    const wanted = vocab.degrees.classOf(intent.type);
    if (!parsed.qualifierTypes.some((type) => vocab.degrees.classOf(type) === wanted)) return true;
  }
  if (intent.level === 'other' || parsed.level === undefined || parsed.level === 'other') return false;
  return parsed.level !== intent.level && !alsoLevels(intent, vocab).includes(parsed.level);
}

/** What an option names as a degree: one identity per level, or per set of type classes. */
function identityOf(parsed: ParsedDegree, vocab: Vocab): string {
  if (parsed.types.length === 0) return `level:${parsed.level ?? 'none'}`;
  return `types:${[...new Set(parsed.types.map((type) => vocab.degrees.classOf(type)))].sort().join('+')}`;
}

/** Whether an option's field names the entry's field (the same CIP code, else the same key). */
function sameField(text: string | undefined, field: FieldOfStudy | undefined, vocab: Vocab): boolean {
  if (text === undefined || field === undefined) return false;
  const option = canonicalField({ text }, vocab).value;
  if (field.cip !== undefined && option.cip !== undefined) return option.cip === field.cip;
  return keyFor(option.name, 'field') === keyFor(field.name, 'field');
}

function byType(intent: DegreeIntent, list: ReadonlyArray<PreparedOption & { degree: ParsedDegree }>, vocab: Vocab):
  StageHit[] {
  return list.flatMap((option) => {
    const fit = typeFit(intent, option.degree, vocab);
    if (fit === 0) return [];
    return [stageHit(option, 'alias', 'degree-type', MATCH_DEGREE, identityOf(option.degree, vocab), [], fit)];
  });
}

/** What an option's bracketed types add to its level ("PhD" for "Doctorate (PhD)"): its variant among the options of
 *  that level. */
function typesVariant(parsed: ParsedDegree, vocab: Vocab): string {
  return [...new Set(parsed.qualifierTypes.map((type) => vocab.degrees.classOf(type)))].sort().join('+');
}

/**
 * The degree rules' hits for a list (§4.9). `field` is the entry's field of study, needed for a combined list. An
 * option the degree rules rule out is no hit, whatever the list's granularity: a list of types may hold "B.S.
 * Computer Science" among plain types, and a list of levels "Doctorate (EdD)".
 */
export function degreeHits(intent: DegreeIntent, options: PreparedOptions, vocab: Vocab, field?: FieldOfStudy):
  StageHit[] {
  const list = degreeOptions(options.list).filter((option) => !degreeConflict(intent, option.degree, vocab, field));
  const granularity = detectDegreeGranularity(options.list);
  const ofLevel = (level: DegreeLevel) => list.filter((option) => option.degree.level === level);
  // Matched by level, every option of the level names the same answer: duplicates, never a tie, unless their
  // bracketed types tell them apart.
  const byLevel = (level: DegreeLevel, only: boolean) => list
    .filter((option) => option.degree.level === level && (!only || levelOnly(option.degree)))
    .map((option) => ({ ...stageHit(option, 'alias', 'degree-level', MATCH_DEGREE, `level:${level}`),
      variant: typesVariant(option.degree, vocab) }));
  switch (granularity) {
    case 'combined':
      return byType(intent, list, vocab).filter((hit) => sameField(hit.option.degree?.field, field, vocab));
    case 'types': {
      if (intent.type !== null) {
        // The fix of 2026-11-08 (snapshot5, Workday's Degree list on pureinsurance: "High School" among "Bachelor of
        // Science (B.S)", "GED", ...): a type the list does not offer takes a level-only option of its level, as on a
        // mixed list.
        const typed = byType(intent, list, vocab);
        return typed.length > 0 ? typed : byLevel(intent.level, true);
      }
      // A level-only profile maps onto a list of types only when exactly one option is of that level.
      const same = ofLevel(intent.level);
      if (same.length !== 1) return [];
      return [stageHit(same[0]!, 'alias', 'degree-level', MATCH_DEGREE, `level:${intent.level}`)];
    }
    case 'levels': {
      const direct = byLevel(intent.level, false);
      if (direct.length > 0) return direct;
      const hits: StageHit[] = [];
      for (const level of alsoLevels(intent, vocab)) {
        for (const option of ofLevel(level)) {
          const listed = intent.type !== null && option.degree.qualifierTypes
            .some((type) => vocab.degrees.classOf(type) === vocab.degrees.classOf(intent.type!));
          hits.push(listed
            ? stageHit(option, 'alias', 'degree-qualifier-types', MATCH_DEGREE, `level:${level}`)
            : stageHit(option, 'alias', 'degree-level-fallback',
              level === 'master' ? MATCH_DEGREE_LEVEL_FALLBACK : MATCH_DEGREE_DOCTORATE_FALLBACK,
              `level:${level}`, ['level-fallback']));
        }
      }
      return hits;
    }
    case 'mixed': {
      const typed = intent.type === null ? [] : byType(intent, list, vocab);
      return typed.length > 0 ? typed : byLevel(intent.level, true);
    }
    case 'unknown':
      return [];
  }
}
