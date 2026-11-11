/*
 * Option preparation (docs/design/core.md §4.0, §4.12). Every label has injected instructions cut first
 * (guard/injected.ts): from then on only the clean part is normalized, hashed, matched or sent to an LLM, and an
 * option with nothing left is unusable. Preparation also resolves each clean label in the vocabulary, reads the
 * answer lists (placeholder, other, exclusive, decline), parses degrees in the degree domain, and indexes the tokens
 * for the fuzzy stage's prefilter. A loading row ("Loading...", "Please wait": text/loading.ts) counts as a
 * placeholder, as the scanner's option-set hash counts it (dom/option-hash.ts). It runs once per option set, so
 * matchOne's budget (§4.13) covers matching only. Two things are read from the list as a whole: options that share a
 * main key and differ only in their brackets (whose brackets are then never redundant), and, in the country domain, a
 * phone picker's dial code beside the name ("Afghanistan+93"), which is left out of what is matched.
 */
import { cutInjected } from '../guard/injected';
import { parseDegree } from '../profile/degreeParse';
import { isLoadingRow } from '../text/loading';
import { keyWithBrackets, normalize, type NormContext } from '../text/normalize';
import type { Option } from '../types/field';
import type { VocabDomain } from '../types/intent';
import { DOMAIN_CONTEXT, type KeyHit, type PhraseSet, type Vocab } from '../vocab/types';
import { withoutDialCode } from './dialCode';
import { bracketsFitEntity, guardSide } from './guardTokens';
import type { MatchDomain, PreparedOption, PreparedOptions } from './types';

/** The normalization context of a domain; numbers are read as answers. */
export function domainContext(domain: MatchDomain): NormContext {
  return domain === 'number' ? 'answer' : DOMAIN_CONTEXT[domain];
}

/** Whether the domain has a vocabulary to resolve labels in. */
function vocabDomain(domain: MatchDomain): domain is VocabDomain {
  return domain !== 'number' && domain !== 'generic';
}

/** The EEO question of an eeo.* domain, whose own decline phrases join the generic ones. */
const EEO_QUESTION: Readonly<Partial<Record<MatchDomain, 'gender' | 'race' | 'hispanicLatino' | 'veteran' |
  'disability'>>> = {
  'eeo.gender': 'gender', 'eeo.race': 'race', 'eeo.hispanicLatino': 'hispanicLatino', 'eeo.veteran': 'veteran',
  'eeo.disability': 'disability',
};

/** The decline phrases a domain reads. */
function declinePhrases(domain: MatchDomain, vocab: Vocab): PhraseSet {
  const question = EEO_QUESTION[domain];
  return question === undefined ? vocab.answers.decline : vocab.answers.eeo[question].decline;
}

/** An option can be chosen: usable and enabled. */
export function chooseable(option: PreparedOption): boolean {
  return !option.unusable && !option.disabled;
}

/** An option names an answer of its own, not "Other", "None of the above" or a decline: fuzzy matching, the LLM and
 *  the degree rules consider only these. */
export function substantive(option: PreparedOption): boolean {
  return chooseable(option) && !option.other && !option.exclusive && !option.decline;
}

/** jr6 RULES (JZ-6, JazzHR's EEO list: fixtures invaluable-form, nucleussecurity-form): a race option's trailing
 *  ", not Hispanic or Latino" (", Hispanic or Latino"), which is the same answer to the Hispanic question as a bracket
 *  ("White (Not Hispanic or Latino)"). */
const HISPANIC_CLAUSE = /^(.*\S)\s*,\s*((?:(?:not|non)[\s-]*)?(?:hispanic|latin[aoxe])(?:\s*(?:or|and|\/)\s*latin[aoxe])?)\s*\.?$/i;

/** The text of a clean label that is matched: in the country domain, without a dial code; in the race domain, a
 *  trailing Hispanic clause read as its bracket. */
function matchedText(clean: string, domain: MatchDomain): string {
  if (domain === 'eeo.race') return clean.replace(HISPANIC_CLAUSE, '$1 ($2)');
  return domain === 'country' ? withoutDialCode(clean) : clean;
}

/** The ids of a list of hits, once each, in order. */
function idsOf(hits: readonly KeyHit[]): string[] {
  return [...new Set(hits.map((hit) => hit.id))];
}

/** jr6 fix (AD-R1, ADP:stage1-5): "TX - Texas" or "Texas - TX", a region's code and name around a dash (ADP's State /
 *  Territory rows, fixtures/adp/jr6-personal-us-*), as profile/entities.ts canonicalRegion reads a profile's value. */
const NAME_AND_CODE = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/;

/** The region a "code - name" label names: the hits of the half that names it best, when both halves name that one
 *  region and nothing else in common; none otherwise ("Texas - Austin", two regions). */
function pairedRegionHits(text: string, context: NormContext, vocab: Vocab): readonly KeyHit[] {
  const pair = NAME_AND_CODE.exec(text);
  if (pair === null) return [];
  const halves = [pair[1]!, pair[2]!].map((half) => vocab.lookup('region', normalize(half, context).key)
    .filter((hit) => !hit.ambiguous));
  const shared = idsOf(halves[0]!).filter((id) => halves[1]!.some((hit) => hit.id === id));
  if (shared.length !== 1) return [];
  const hits = halves.flat().filter((hit) => hit.id === shared[0]);
  return [hits.find((hit) => hit.tier === 'primary') ?? hits[0]!];
}

/** The parts a label joins with slashes: two to four, each of one to four words. */
const SLASH = /\s*\/\s*/;

/** The keys of a slash-joined label's parts (PreparedOption.slashParts), in `context`. */
function slashPartsOf(clean: string, domain: MatchDomain, context: NormContext): string[] {
  if (domain === 'degree' || domain.startsWith('eeo.') || !clean.includes('/')) return [];
  const parts = clean.split(SLASH).map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => part === '' || part.split(/\s+/).length > 4)) {
    return [];
  }
  return [...new Set(parts.map((part) => normalize(matchedText(part, domain), context).key).filter((key) => key !== ''))];
}

/** Prepares a field's options for one domain (§4.0). */
export function prepareOptions(options: readonly Option[], domain: MatchDomain, vocab: Vocab): PreparedOptions {
  const context = domainContext(domain);
  const decline = declinePhrases(domain, vocab);
  const { placeholders, other, exclusive } = vocab.answers;
  const list = options.map((option): PreparedOption => {
    const cut = cutInjected(option.label);
    const clean = cut.clean;
    const text = matchedText(clean, domain);
    const norm = normalize(text, context);
    const fullKey = norm.qualifiers.length === 0 ? norm.key : keyWithBrackets(text, context);
    const answerKey = context === 'answer' ? norm.key : normalize(text, 'answer').key;
    // An option that held only injected text is not a placeholder: it is unusable, as injected-option-only. A loading
    // row ("Loading...") is one: a list that shows nothing else waits for its options (matchOne), never a no-match.
    const placeholder = !(cut.injected && clean === '')
      && (placeholders.has(answerKey) || isLoadingRow(text, answerKey));
    let entityHits: readonly KeyHit[] = [];
    if (vocabDomain(domain) && clean !== '') {
      const whole = fullKey === norm.key ? [] : vocab.lookup(domain, fullKey);
      if (whole.length > 0) {
        entityHits = whole;
      } else {
        entityHits = vocab.lookup(domain, norm.key);
        if (entityHits.length > 0 && norm.qualifiers.length > 0) {
          const side = guardSide(norm, domain, vocab);
          entityHits = entityHits.filter((hit) => {
            const entity = vocab.entity(hit.id);
            return entity !== undefined && bracketsFitEntity(side, entity, domain, vocab);
          });
        }
      }
      if (entityHits.length === 0 && domain === 'region') entityHits = pairedRegionHits(text, context, vocab);
    }
    const unusable = placeholder || clean === '';
    return {
      index: option.index,
      label: option.label,
      clean,
      norm,
      fullKey,
      answerKey,
      entityIds: idsOf(entityHits),
      entityHits,
      placeholder,
      disabled: option.disabled,
      selected: option.selected,
      injected: cut.injected,
      unusable,
      exclusive: !unusable && exclusive.has(answerKey),
      decline: !unusable && decline.has(answerKey),
      other: !unusable && other.has(answerKey),
      ...(domain === 'degree' && !unusable ? { degree: parseDegree(clean, vocab) } : {}),
      bracketSiblings: false,
      slashParts: unusable ? [] : slashPartsOf(clean, domain, context),
    };
  });
  // Options of one main key whose full keys differ are told apart by their brackets alone.
  const fullKeys = new Map<string, Set<string>>();
  for (const option of list) {
    if (option.unusable || option.norm.key === '') continue;
    const known = fullKeys.get(option.norm.key);
    if (known) known.add(option.fullKey);
    else fullKeys.set(option.norm.key, new Set([option.fullKey]));
  }
  for (const option of list) {
    if (option.norm.qualifiers.length > 0) option.bracketSiblings = (fullKeys.get(option.norm.key)?.size ?? 0) > 1;
  }
  const byToken = new Map<string, number[]>();
  list.forEach((option, position) => {
    if (option.unusable) return;
    const tokens = new Set(option.norm.core);
    for (const qualifier of option.norm.qualifiers) for (const token of qualifier.tokens) tokens.add(token);
    for (const token of tokens) {
      const positions = byToken.get(token);
      if (positions) positions.push(position);
      else byToken.set(token, [position]);
    }
  });
  return { domain, list, byToken };
}
