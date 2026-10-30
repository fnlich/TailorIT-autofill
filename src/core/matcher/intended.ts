/*
 * Intended values from the canonical profile's entities (docs/design/core.md §2.4, §2.6): what the matcher compares
 * an option against. A vocabulary entity brings every spelling the vocabulary has, with the person's own text first
 * (tier 'raw', the first spelling tried). The person's other aliases join as curated spellings, marked ambiguous when
 * the vocabulary gives their key to another entity, so no exact or alias match may rest on them. A value the
 * vocabulary does not know keeps the person's text alone. The resolver builds its values with these, and the golden
 * tests build theirs from the profile strings through the Phase 1 canonicalizers.
 */
import type { Degree, FieldOfStudy, Institution } from '../types/profile';
import type { IntendedValue, Surface, VocabDomain } from '../types/intent';
import { keyFor, resolveText, surfacesOf } from '../vocab/lookup';
import type { Vocab, VocabEntity } from '../vocab/types';

/** Spellings without empty ones or repeats of a key already held. */
function addSpellings(out: Surface[], texts: readonly string[], domain: VocabDomain, vocab: Vocab,
  ownerId: string | null): void {
  const keys = new Set(out.map((surface) => keyFor(surface.text, domain)));
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ').trim();
    const key = keyFor(text, domain);
    if (text === '' || key === '' || keys.has(key)) continue;
    keys.add(key);
    const hits = domain === 'generic' ? [] : vocab.lookup(domain, key);
    const ambiguous = hits.some((hit) => hit.ambiguous || hit.id !== ownerId);
    out.push({ text, tier: 'curated', ambiguous });
  }
}

/** A vocabulary entity as an intended value: the person's text first, then its spellings, then the person's other
 *  aliases. */
export function intendedEntity(vocab: Vocab, domain: VocabDomain, entity: VocabEntity, userText?: string,
  aliases: readonly string[] = []): IntendedValue {
  const surfaces = surfacesOf(entity, userText);
  addSpellings(surfaces, aliases, domain, vocab, entity.id);
  return { kind: 'entity', domain, id: entity.id, display: entity.name, surfaces };
}

/** A value the vocabulary does not know: the person's text, then their aliases. */
export function intendedUnknown(domain: VocabDomain, text: string, aliases: readonly string[], vocab: Vocab):
  IntendedValue {
  const display = text.replace(/\s+/g, ' ').trim();
  const surfaces: Surface[] = display === '' ? [] : [{ text: display, tier: 'raw', ambiguous: false }];
  addSpellings(surfaces, aliases, domain, vocab, null);
  return { kind: 'entity', domain, id: null, display, surfaces };
}

/** An education entry's institution (canonicalInstitution's output). */
export function intendedInstitution(institution: Institution, vocab: Vocab): IntendedValue {
  const { ipeds, ror } = institution.ids;
  const id = ipeds ? `ipeds:${ipeds}` : ror ? `ror:${ror}` : null;
  const entity = institution.source === 'vocab' && id !== null ? vocab.entity(id) : undefined;
  if (entity) return intendedEntity(vocab, 'institution', entity, institution.userText, institution.aliases);
  const ownText = institution.userText.trim() === '' ? institution.canonicalName : institution.userText;
  return intendedUnknown('institution', ownText, [institution.canonicalName, ...institution.aliases], vocab);
}

/** A field of study (canonicalField's output). */
export function intendedField(field: FieldOfStudy, vocab: Vocab): IntendedValue {
  const entity = field.cip ? vocab.fields.byCode(field.cip) : undefined;
  if (entity) return intendedEntity(vocab, 'field', entity, field.userText, field.aliases);
  const ownText = field.userText.trim() === '' ? field.name : field.userText;
  return intendedUnknown('field', ownText, [field.name, ...field.aliases], vocab);
}

/** A degree (canonicalDegree's output): its type's names, then its level's, the person's text first. */
export function intendedDegree(degree: Degree, vocab: Vocab): IntendedValue {
  const type = degree.type ?? null;
  const typeEntity = type === null ? undefined : vocab.degrees.type(type);
  const levelEntity = vocab.degrees.level(degree.level);
  const surfaces: Surface[] = [];
  const own = degree.userText.trim();
  if (own !== '') surfaces.push({ text: own, tier: 'raw', ambiguous: false });
  for (const entity of [typeEntity, levelEntity]) {
    for (const surface of entity?.surfaces ?? []) {
      surfaces.push({ text: surface.text, tier: surface.tier, ambiguous: surface.ambiguous });
    }
  }
  return { kind: 'degree', level: degree.level, type, display: (typeEntity ?? levelEntity).name, surfaces };
}

/** A country, by its ISO alpha-2 code (canonicalCountry's output), with the person's text. */
export function intendedCountry(alpha2: string, userText: string, vocab: Vocab): IntendedValue {
  const entity = vocab.countries.byAlpha2(alpha2);
  return entity ? intendedEntity(vocab, 'country', entity, userText) : intendedUnknown('country', userText, [], vocab);
}

/** A region (canonicalRegion's output) in its country ('US' or 'CA'; both are tried without one). */
export function intendedRegion(region: { code?: string; name: string }, country: string | undefined, userText: string,
  vocab: Vocab): IntendedValue {
  const code = region.code;
  const { regions } = vocab;
  const entity = code === undefined ? undefined
    : country ? regions.byCode(country, code) : regions.byCode('US', code) ?? regions.byCode('CA', code);
  if (entity) return intendedEntity(vocab, 'region', entity, userText);
  return intendedUnknown('region', userText || region.name, [], vocab);
}

/** An answer named by its text in an answer vocabulary (a referral source, a language, a proficiency, an EEO answer):
 *  the entity the text names, else the text alone. */
export function intendedAnswer(domain: VocabDomain, text: string, vocab: Vocab): IntendedValue {
  const resolution = resolveText(vocab, domain, text);
  const entity = resolution.id === null ? undefined : vocab.entity(resolution.id);
  return entity ? intendedEntity(vocab, domain, entity, text) : intendedUnknown(domain, text, [], vocab);
}

/** A custom answer's text (a saved answer, a generic question): matched in the generic domain. */
export function intendedText(text: string): IntendedValue {
  return { kind: 'text', text };
}

/** A yes or no. */
export function intendedBoolean(value: boolean): IntendedValue {
  return { kind: 'boolean', value };
}

/** The person's explicit decline: the form's decline option. */
export function intendedDecline(domain: VocabDomain): IntendedValue {
  return { kind: 'decline', domain };
}
