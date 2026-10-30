/*
 * The mention rule (docs/design/core.md §4.3): an option that is not a spelling of the intended value but names it
 * inside a longer label ("Job Board - LinkedIn"). It holds only when the option mentions the intended entity, no
 * other option mentions it, and the option mentions no other entity of the domain. Mentions are the vocabulary's
 * phrases (for referral sources, only their curated mention phrases), read left to right, longest first, without
 * overlaps. Bracketed words count: "X (formerly Twitter)" mentions Twitter. Only options that are answers of their
 * own take part: a decline, "Other" or exclusive option may mention the entity ("I do not wish to self-identify my
 * veteran status"), but it is never the entity's answer.
 */
import { MATCH_MENTION } from '../confidence';
import type { VocabDomain } from '../types/intent';
import type { Vocab } from '../vocab/types';
import { INTENDED } from './exact';
import { substantive } from './prepare';
import { stageHit, type StageHit } from './rank';
import type { PreparedOption, PreparedOptions } from './types';

/** The entities an option's label mentions, by the domain's phrases. */
export function mentionedIds(option: PreparedOption, domain: VocabDomain, vocab: Vocab): Set<string> {
  const ids = new Set<string>();
  const tokens = option.fullKey === '' ? [] : option.fullKey.split(' ');
  const phrases = vocab.phrases(domain);
  let at = 0;
  while (at < tokens.length) {
    let length = 0;
    for (const phrase of phrases.get(tokens[at]!) ?? []) {
      if (length > 0 && phrase.tokens.length < length) break;
      if (phrase.tokens.length > tokens.length - at) continue;
      if (!phrase.tokens.every((token, offset) => tokens[at + offset] === token)) continue;
      length = phrase.tokens.length;
      ids.add(phrase.id);
    }
    at += length > 0 ? length : 1;
  }
  return ids;
}

/** The mention rule's hit: the one option that mentions the intended entity and nothing else. */
export function mentionHits(entityId: string, options: PreparedOptions, domain: VocabDomain, vocab: Vocab): StageHit[] {
  const mentioning: Array<{ option: PreparedOption; ids: Set<string> }> = [];
  for (const option of options.list) {
    if (!substantive(option)) continue;
    const ids = mentionedIds(option, domain, vocab);
    if (ids.has(entityId)) mentioning.push({ option, ids });
  }
  if (mentioning.length !== 1) return [];
  const [{ option, ids }] = mentioning as [{ option: PreparedOption; ids: Set<string> }];
  if (ids.size !== 1) return [];
  return [stageHit(option, 'alias', 'mention', MATCH_MENTION, INTENDED)];
}
