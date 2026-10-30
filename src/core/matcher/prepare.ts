/*
 * Option preparation (docs/design/core.md §4.0, §4.12). Every label has injected instructions cut first
 * (guard/injected.ts): from then on only the clean part is normalized, hashed, matched or sent to an LLM, and an
 * option with nothing left is unusable. Preparation also resolves each clean label in the vocabulary, reads the
 * answer lists (placeholder, other, exclusive, decline), parses degrees in the degree domain, and indexes the tokens
 * for the fuzzy stage's prefilter. It runs once per option set, so matchOne's budget (§4.13) covers matching only.
 */
import { cutInjected } from '../guard/injected';
import { parseDegree } from '../profile/degreeParse';
import { normalize, type NormContext } from '../text/normalize';
import type { Option } from '../types/field';
import type { VocabDomain } from '../types/intent';
import { DOMAIN_CONTEXT, type KeyHit, type PhraseSet, type Vocab } from '../vocab/types';
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

/** Brackets become spaces, so their words join the main text. */
const BRACKETS = /[()[\]]/g;

/** The ids of a list of hits, once each, in order. */
function idsOf(hits: readonly KeyHit[]): string[] {
  return [...new Set(hits.map((hit) => hit.id))];
}

/** Prepares a field's options for one domain (§4.0). */
export function prepareOptions(options: readonly Option[], domain: MatchDomain, vocab: Vocab): PreparedOptions {
  const context = domainContext(domain);
  const decline = declinePhrases(domain, vocab);
  const { placeholders, other, exclusive } = vocab.answers;
  const list = options.map((option): PreparedOption => {
    const cut = cutInjected(option.label);
    const clean = cut.clean;
    const norm = normalize(clean, context);
    const fullKey = norm.qualifiers.length === 0 ? norm.key : normalize(clean.replace(BRACKETS, ' '), context).key;
    const answerKey = context === 'answer' ? norm.key : normalize(clean, 'answer').key;
    // An option that held only injected text is not a placeholder: it is unusable, as injected-option-only.
    const placeholder = !(cut.injected && clean === '') && placeholders.has(answerKey);
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
    };
  });
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
