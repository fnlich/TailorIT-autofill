/*
 * Lookups over a Vocab that the entity canonicalizers, the resolver and the matcher share: the key a text has in a
 * domain, what one key names, and an entity's spellings as the matcher's Surface list. Every key is computed with the
 * domain's own normalization context (DOMAIN_CONTEXT), the one the build used, so a lookup never misses because of
 * a context mismatch.
 */
import { normalize, type Normalized } from '../text/normalize';
import type { Surface, VocabDomain } from '../types/intent';
import { DOMAIN_CONTEXT, type KeyHit, type Vocab, type VocabEntity, type VocabTier } from './types';

/** `text` normalized in the domain's context. */
export function normalizeFor(text: string, domain: VocabDomain): Normalized {
  return normalize(text, DOMAIN_CONTEXT[domain]);
}

/** The lookup key of `text` in a domain. */
export function keyFor(text: string, domain: VocabDomain): string {
  return normalizeFor(text, domain).key;
}

/** What one key names in a domain. */
export interface KeyResolution {
  /** The one entity the key names, or null. A CIP line of descent counts as one: its most specific code. */
  id: string | null;
  /** The tier of the surface that named it; null when `id` is null. */
  tier: VocabTier | null;
  /** Every entity with a surface of that key, best tier first. */
  hits: readonly KeyHit[];
  /** Several entities share the key (or it rests on an unresolved "st?"): it names none of them. */
  ambiguous: boolean;
}

/** What `key` names in a domain: one entity, several (ambiguous), or none. */
export function resolveKey(vocab: Vocab, domain: VocabDomain, key: string): KeyResolution {
  const hits = vocab.lookup(domain, key);
  if (hits.length === 0) return { id: null, tier: null, hits, ambiguous: false };
  if (hits.some((hit) => hit.ambiguous)) return { id: null, tier: null, hits, ambiguous: true };
  const ids = hits.map((hit) => hit.id);
  const id = domain === 'field' ? vocab.fields.mostSpecific(ids) : new Set(ids).size === 1 ? ids[0]! : null;
  if (id === null) return { id: null, tier: null, hits, ambiguous: true };
  return { id, tier: hits.find((hit) => hit.id === id)!.tier, hits, ambiguous: false };
}

/** What `text` names in a domain. */
export function resolveText(vocab: Vocab, domain: VocabDomain, text: string): KeyResolution {
  return resolveKey(vocab, domain, keyFor(text, domain));
}

/**
 * An entity's spellings as the matcher compares them: the person's own text first (tier 'raw'), then the entity's
 * surfaces in data order (the display name first). The raw spelling is left out when it is empty.
 */
export function surfacesOf(entity: VocabEntity, rawText?: string): Surface[] {
  const out: Surface[] = [];
  const raw = rawText?.trim() ?? '';
  if (raw !== '') out.push({ text: raw, tier: 'raw', ambiguous: false });
  for (const surface of entity.surfaces) out.push({ text: surface.text, tier: surface.tier, ambiguous: surface.ambiguous });
  return out;
}

/** An acronym as written: one word of capitals, digits or '&', 2 to 8 characters once dots are removed ("MIT",
 *  "U.C.L.A.", "A&M"). Typeahead tries a curated acronym before other aliases (§4.11). */
export function isAcronym(text: string): boolean {
  return /^[A-Z][A-Z0-9&]{1,7}$/.test(text.trim().replace(/\./g, ''));
}

/**
 * A short form written as one word, once dots are removed: 2 to 10 letters, digits or '&', either all capitals ("UT",
 * "U.N.H.", "SUNYIT") or at most six characters with two capitals or more ("UMich", "UConn"). Many institutions
 * answer to such a form, so an IPEDS or ROR alias of this shape names one institution only when a curated table
 * says so (§5.3), and a profile that gives only one keeps the person's text.
 */
export function isAcronymShaped(text: string): boolean {
  const word = text.trim().replace(/\./g, '');
  if (!/^[A-Za-z][A-Za-z0-9&]{1,9}$/.test(word)) return false;
  return !/[a-z]/.test(word) || (word.length <= 6 && word.replace(/[^A-Z]/g, '').length >= 2);
}
