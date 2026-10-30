/*
 * The distinctive-token guard (docs/design/core.md §4.5). Words that tell entities apart (a city, a state, a campus,
 * a direction, "state", "tech", a discipline, a level marker, a single letter or a number) must agree on both sides,
 * so "UT Austin" never matches "University of Texas at Dallas" and "Georgia Tech" never matches "Georgia State". The
 * rules read the intended value as a whole, its trusted spellings together (the person's own, the canonical names,
 * the curated and generated aliases), because a bare acronym ("UTD") says nothing about the campus while the full
 * name does. A source's loose aliases (former names, system names) never count: "State University of New York at
 * Buffalo" must not let "state" through to "SUNY Buffalo State", another campus.
 * 1. every presence word of the option is in one of the entity's trusted spellings or facts (city, region, campus,
 *    country);
 * 2. the option holds every presence word of one of the trusted spellings; only spellings that have presence words
 *    count, so an acronym ("UTD") cannot excuse a missing "dallas";
 * 3. an option's head noun ("university", "college") is one the trusted spellings use;
 * 4. in the form they use it: "University of X" is not "X University".
 * Rules 1, 3 and 4 are hard: no later stage, the LLM included, may choose such an option. Rule 2 alone stops fuzzy
 * matching and keeps the option from the LLM.
 *
 * Which words count depends on the domain. Institutions use every class; fields of study use the discipline-like
 * ones (a field never names a city: "Commerce" is a city and a field); countries and regions use place names and
 * directions ("West Virginia" is not Virginia); every other domain uses only the acronym-like class, as §4.5 says
 * for all domains, because the place and level classes hold ordinary words ("online", "career") that referral and
 * custom answers use freely. Languages add country names inside brackets ("Portuguese (Brazil)" is a variety the
 * person did not name). The degree domain adds its own type and level rules (degree.ts). USPS codes count only inside
 * brackets. Step 15 of §3.1, joining multi-word lexicon names ("ann arbor", "saint louis"), happens here,
 * through the vocabulary's lexicon.
 */
import { AMBIGUOUS_ST } from '../text/abbreviations';
import { INSTITUTION_HEAD_NOUNS, type Normalized, type Qualifier } from '../text/normalize';
import { isNoiseQualifier } from '../text/qualifiers';
import { removeStopwords } from '../text/tokens';
import { normalizeFor } from '../vocab/lookup';
import { DOMAIN_CONTEXT, type GuardClass, type Vocab, type VocabEntity } from '../vocab/types';
import type { MatchDomain } from './types';

/** How a domain reads distinctive words. */
export const GUARD_FAMILIES = ['institution', 'field', 'place', 'language', 'basic'] as const;
export type GuardFamily = (typeof GUARD_FAMILIES)[number];

/** The lexicon classes whose members are presence words, per family. The acronym-like class applies to all. */
export const PRESENCE_CLASSES: Readonly<Record<GuardFamily, readonly GuardClass[]>> = {
  institution: ['city', 'region', 'country', 'campus', 'direction', 'state', 'tech', 'discipline', 'level'],
  field: ['discipline', 'tech', 'direction'],
  place: ['region', 'country', 'direction'],
  language: [],
  basic: [],
};

/** The lexicon classes whose members are presence words inside brackets only, per family: USPS codes after a school
 *  ("(Cambridge, MA)"), country names after a language ("(Brazil)"). */
export const BRACKET_PRESENCE_CLASSES: Readonly<Partial<Record<GuardFamily, readonly GuardClass[]>>> = {
  institution: ['regionCode'],
  language: ['country'],
};

/** The guard family of a domain. */
export function guardFamily(domain: MatchDomain): GuardFamily {
  if (domain === 'institution' || domain === 'field' || domain === 'language') return domain;
  return domain === 'country' || domain === 'region' ? 'place' : 'basic';
}

/** One side's distinctive words: an option, or one spelling of the intended value. */
export interface GuardSide {
  /** Every word, multi-word names joined: the main text's core and the non-noise brackets. */
  readonly tokens: ReadonlySet<string>;
  /** The words that must agree. */
  readonly presence: ReadonlySet<string>;
  /** The presence words that come from brackets ("(Cambridge, MA)"). */
  readonly bracketPresence: ReadonlySet<string>;
  /** The institution head noun and where it stands: 'pre' for "University of X", 'post' for "X University". */
  readonly head: { readonly noun: string; readonly form: 'pre' | 'post' } | null;
}

const HEAD_NOUNS = new Set<string>(INSTITUTION_HEAD_NOUNS);
const DIGITS = /^\d+(?:\.\d+)?$/;
const LETTER = /^[a-z]$/;

/** A discipline's plural reads as its singular ("sciences" is "science"), so a plural never conflicts. */
function canonical(token: string, vocab: Vocab): string {
  return token.endsWith('s') && token.length > 3 && vocab.guard.has('discipline', token.slice(0, -1))
    ? token.slice(0, -1) : token;
}

/**
 * The acronym-like class (§4.5): a single letter, a number, or a token with '&' ("a&m"). In the answer context,
 * where articles survive normalization, "a" and "i" count only as the last word ("Option A"), never as an article or
 * a pronoun ("A friend told me", "I am a veteran").
 */
function acronymLike(token: string, position: number, count: number, answer: boolean): boolean {
  if (DIGITS.test(token) || token.includes('&')) return true;
  if (!LETTER.test(token)) return false;
  return !(answer && (token === 'a' || token === 'i') && position < count - 1);
}

function presenceClass(token: string, family: GuardFamily, inBrackets: boolean, vocab: Vocab): boolean {
  if (token === AMBIGUOUS_ST) return family === 'institution';
  if (PRESENCE_CLASSES[family].some((guardClass) => vocab.guard.has(guardClass, token))) return true;
  if (!inBrackets) return false;
  return (BRACKET_PRESENCE_CLASSES[family] ?? []).some((guardClass) => vocab.guard.has(guardClass, token));
}

/** Whether a single word is distinctive in a domain: a presence word, an acronym-like one, or an institution head
 *  noun. The fuzzy stage never pairs a distinctive word with a different one ("northwestern" is not "northeastern"). */
export function distinctiveWord(token: string, domain: MatchDomain, vocab: Vocab): boolean {
  const family = guardFamily(domain);
  if (DIGITS.test(token) || LETTER.test(token) || token.includes('&')) return true;
  if (family === 'institution' && HEAD_NOUNS.has(token)) return true;
  return presenceClass(canonical(token, vocab), family, false, vocab);
}

/** A bracket's words, multi-word names joined, each marked when it is a presence word. */
export function bracketWords(qualifier: Qualifier, domain: MatchDomain, vocab: Vocab):
  Array<{ token: string; presence: boolean }> {
  const family = guardFamily(domain);
  const context = domain === 'number' ? 'answer' : DOMAIN_CONTEXT[domain];
  return vocab.guard.join(removeStopwords(qualifier.tokens, context)).map((joined) => {
    const token = canonical(joined, vocab);
    return { token, presence: presenceClass(token, family, true, vocab) || acronymLike(token, 0, 1, false) };
  });
}

/** One side's distinctive words, from a text normalized in the domain's context. */
export function guardSide(norm: Normalized, domain: MatchDomain, vocab: Vocab): GuardSide {
  const family = guardFamily(domain);
  const answer = (domain === 'number' ? 'answer' : DOMAIN_CONTEXT[domain]) === 'answer';
  const tokens = new Set<string>();
  const presence = new Set<string>();
  const bracketPresence = new Set<string>();
  const main = vocab.guard.join(norm.core);
  main.forEach((joined, position) => {
    const token = canonical(joined, vocab);
    tokens.add(token);
    if (presenceClass(token, family, false, vocab) || acronymLike(token, position, main.length, answer)) {
      presence.add(token);
    }
  });
  for (const qualifier of norm.qualifiers) {
    if (isNoiseQualifier(qualifier)) continue;
    for (const { token, presence: isPresence } of bracketWords(qualifier, domain, vocab)) {
      tokens.add(token);
      if (isPresence) {
        presence.add(token);
        bracketPresence.add(token);
      }
    }
  }
  let head: GuardSide['head'] = null;
  if (family === 'institution' && norm.headForm !== 'none') {
    const noun = norm.tokens.find((token) => HEAD_NOUNS.has(token));
    if (noun !== undefined) head = { noun, form: norm.headForm };
  }
  return { tokens, presence, bracketPresence, head };
}

/** The intended value's distinctive words, over its trusted spellings. */
export interface EntityGuard {
  /** What explains an option's presence word (rule 1): the trusted spellings' words and the entity's facts. */
  readonly explains: ReadonlySet<string>;
  /** Rule 2: the presence sets of the trusted spellings that have any; an option must hold one of them whole. Empty
   *  when no trusted spelling has a presence word. */
  readonly required: ReadonlyArray<ReadonlySet<string>>;
  /** Rules 3 and 4: the head nouns the trusted spellings use, and in which forms. */
  readonly heads: ReadonlyMap<string, ReadonlySet<'pre' | 'post'>>;
}

/**
 * The guard over the intended value: `trusted` are the spellings every rule rests on (the person's own, the canonical
 * names, the curated and generated aliases, never a source's loose aliases), and `facts` the entity's facts as guard
 * words (Vocab.factTokens).
 */
export function entityGuard(trusted: readonly GuardSide[], facts: ReadonlySet<string>): EntityGuard {
  const explains = new Set<string>(facts);
  const heads = new Map<string, Set<'pre' | 'post'>>();
  for (const side of trusted) {
    for (const token of side.tokens) explains.add(token);
    if (side.head) {
      const forms = heads.get(side.head.noun) ?? new Set<'pre' | 'post'>();
      forms.add(side.head.form);
      heads.set(side.head.noun, forms);
    }
  }
  return { explains, required: trusted.filter((side) => side.presence.size > 0).map((side) => side.presence), heads };
}

const isSaint = (token: string) => token === 'saint' || token.startsWith('saint_');
const hasSaint = (tokens: ReadonlySet<string>) => [...tokens].some(isSaint);

/**
 * Whether `known` (the entity's words, or an option's) accounts for the presence word `word` of `other` (the other
 * side's words). An unresolved "st?" stands for Saint or State: it is accepted against one of them, never against a
 * side that has both (§3.3).
 */
function accounts(known: ReadonlySet<string>, word: string, other: ReadonlySet<string>): boolean {
  if (known.has(word)) return true;
  if (word === AMBIGUOUS_ST) return known.has('state') !== hasSaint(known);
  if (!known.has(AMBIGUOUS_ST)) return false;
  if (word === 'state') return !hasSaint(other);
  if (isSaint(word)) {
    if (other.has('state')) return false;
    return word === 'saint' || word.slice('saint_'.length).split('_').every((part) => known.has(part));
  }
  return false;
}

/** The guard rules, by what failed. */
export const GUARD_RULES = ['presence-extra', 'presence-missing', 'head-noun', 'of-form'] as const;
export type GuardRule = (typeof GUARD_RULES)[number];

/** An option against the intended value. */
export type GuardVerdict =
  | { pass: true }
  | { pass: false; hard: boolean; rule: GuardRule };

/** The guard's verdict on one option: hard failures (rules 1, 3, 4) first, then rule 2. */
export function checkGuard(entity: EntityGuard, option: GuardSide): GuardVerdict {
  for (const word of option.presence) {
    if (!accounts(entity.explains, word, option.tokens)) return { pass: false, hard: true, rule: 'presence-extra' };
  }
  if (option.head && entity.heads.size > 0) {
    const forms = entity.heads.get(option.head.noun);
    if (!forms) return { pass: false, hard: true, rule: 'head-noun' };
    if (!forms.has(option.head.form)) return { pass: false, hard: true, rule: 'of-form' };
  }
  if (entity.required.length > 0
    && !entity.required.some((words) => [...words].every((word) => accounts(option.tokens, word, entity.explains)))) {
    return { pass: false, hard: false, rule: 'presence-missing' };
  }
  return { pass: true };
}

/**
 * Brackets must not contradict an exact or alias match (§4.2): every presence word in the option's brackets is
 * explained by the entity ("Massachusetts Institute of Technology (Cambridge, MA)"), and every one in the
 * spelling's brackets is in the option. "University of Texas (Dallas)" is therefore never the Austin flagship.
 */
export function bracketsAgree(entity: EntityGuard, surface: GuardSide, option: GuardSide): boolean {
  for (const word of option.bracketPresence) if (!accounts(entity.explains, word, option.tokens)) return false;
  for (const word of surface.bracketPresence) if (!accounts(option.tokens, word, entity.explains)) return false;
  return true;
}

const ENTITY_GUARDS = new WeakMap<Vocab, Map<string, EntityGuard>>();

/** The guard over a vocabulary entity's own spellings and facts, built once per entity. */
export function guardOfEntity(entity: VocabEntity, domain: MatchDomain, vocab: Vocab): EntityGuard {
  let byId = ENTITY_GUARDS.get(vocab);
  if (!byId) ENTITY_GUARDS.set(vocab, byId = new Map());
  const known = byId.get(entity.id);
  if (known) return known;
  const trusted = entity.surfaces
    .filter((surface) => !surface.ambiguous
      && (surface.tier === 'primary' || surface.tier === 'curated' || surface.tier === 'generated'))
    .map((surface) => guardSide(normalizeFor(surface.text, domain === 'number' ? 'generic' : domain), domain, vocab));
  const made = entityGuard(trusted, vocab.factTokens(entity.id));
  byId.set(entity.id, made);
  return made;
}

/** Whether an option's bracketed presence words fit an entity: "University of Texas (Dallas)" does not fit the
 *  Austin campus, so its key's flagship hit is dropped. */
export function bracketsFitEntity(option: GuardSide, entity: VocabEntity, domain: MatchDomain, vocab: Vocab): boolean {
  if (option.bracketPresence.size === 0) return true;
  const guard = guardOfEntity(entity, domain, vocab);
  return [...option.bracketPresence].every((word) => accounts(guard.explains, word, option.tokens));
}
