/*
 * The entity canonicalizers (docs/design/core.md §2.7): an institution, a field of study, a country and a region,
 * from the person's text and the vocabulary, as the canonical profile holds them. They never guess. What the
 * vocabulary cannot name for certain keeps the person's own spelling, and an issue says why; issues carry a path and
 * a code, never a value. canonicalizeProfile (Phase 2) calls them for every education entry and the address, and the
 * golden tests call them directly. Degrees are in degreeParse.ts.
 */
import type { VocabDomain } from '../types/intent';
import type { FieldOfStudy, Institution } from '../types/profile';
import { keyFor, normalizeFor, resolveKey, resolveText, type KeyResolution } from '../vocab/lookup';
import type {
  CountryEntity, FieldEntity, InstitutionEntity, KeyHit, RegionEntity, Vocab, VocabEntity,
} from '../vocab/types';

/** Why a value was kept as the person wrote it, or only partly understood. */
export const CANONICALIZE_ISSUE_CODES = ['institution-not-in-vocab', 'institution-ambiguous', 'institution-id-unknown',
  'degree-unparsed', 'field-not-in-vocab', 'field-ambiguous', 'country-unknown', 'region-unknown'] as const;
export type CanonicalizeIssueCode = (typeof CANONICALIZE_ISSUE_CODES)[number];

/** One issue: where (a profile path such as 'education[0].institution') and what. Never a value. */
export interface CanonicalizeIssue {
  path: string;
  code: CanonicalizeIssueCode;
}

/** A canonical value and the issues met on the way. */
export interface Canonical<T> {
  value: T;
  issues: CanonicalizeIssue[];
}

/** Where an education entry is, as the person gave it. */
export interface PlaceInput {
  city?: string;
  /** A state or province code ("TX", "ON"), or a region's name. */
  region?: string;
  /** ISO 3166-1 alpha-2, or a country's name. */
  country?: string;
}

/** An institution as TailorIT's profile holds it (AutofillEducation.institution plus the entry's location). */
export interface InstitutionInput {
  /** The person's canonical name for it, exactly as typed. */
  name: string;
  /** Other names the person gave ("UT Austin"). */
  aliases?: readonly string[];
  /** IPEDS UNITID (six digits) or ROR id (nine characters, without https://ror.org/). */
  ids?: { ipeds?: string; ror?: string };
  location?: PlaceInput;
}

/** A field of study as given: its text, and its CIP 2020 code when TailorIT knows it. */
export interface FieldInput {
  text: string;
  cip?: string;
}

/** Spaces collapsed and trimmed: how a kept spelling is stored. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Texts without empty ones or repeats of a key already seen (the seen keys are added to). */
function distinctByKey(texts: readonly string[], keyOf: (text: string) => string, seen: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of texts) {
    const text = tidy(raw);
    const key = keyOf(text);
    if (text === '' || key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** An entity's spellings after its display name, without ambiguous ones. */
function entityAliases(entity: VocabEntity): string[] {
  return entity.surfaces.slice(1).filter((surface) => !surface.ambiguous).map((surface) => surface.text);
}

/** Brackets become spaces, so their words join the name. */
const BRACKETS = /[()[\]]/g;

/** The keys a text is looked up by, as the matcher reads an option (prepare.ts): its brackets' words as part of the
 *  name first ("Korea (South)" is Korea South), then without them ("University of Texas at Austin (UT Austin)"). */
function lookupKeys(text: string, domain: VocabDomain): string[] {
  const norm = normalizeFor(text, domain);
  return norm.qualifiers.length === 0 ? [norm.key] : [keyFor(text.replace(BRACKETS, ' '), domain), norm.key];
}

/** What a text names in a domain: the first of its lookup keys that any entity holds. */
function resolveName(vocab: Vocab, domain: VocabDomain, text: string): KeyResolution {
  const keys = lookupKeys(text, domain);
  for (const key of keys.slice(0, -1)) {
    const whole = resolveKey(vocab, domain, key);
    if (whole.hits.length > 0) return whole;
  }
  return resolveKey(vocab, domain, keys[keys.length - 1]!);
}

// ---------------------------------------------------------------------------------------------------------------
// Countries and regions

/**
 * A country as ISO 3166-1 alpha-2: an alpha-2 or alpha-3 code in any case ("us", "GBR"), else the key of a name or
 * alias ("United States of America", "U.K.", "Korea, Republic of", "Korea (South)"). An unknown or ambiguous name
 * ("Congo") is kept as written, with `country-unknown`. Empty text gives '' and no issue.
 */
export function canonicalCountry(text: string, vocab: Vocab, path = 'country'): Canonical<string> {
  const trimmed = tidy(text);
  if (trimmed === '') return { value: '', issues: [] };
  const byCode = /^[A-Za-z]{2}$/.test(trimmed) ? vocab.countries.byAlpha2(trimmed)
    : /^[A-Za-z]{3}$/.test(trimmed) ? vocab.countries.byAlpha3(trimmed) : undefined;
  if (byCode) return { value: byCode.alpha2, issues: [] };
  const resolution = resolveName(vocab, 'country', trimmed);
  if (resolution.id !== null) return { value: (vocab.entity(resolution.id) as CountryEntity).alpha2, issues: [] };
  return { value: trimmed, issues: [{ path, code: 'country-unknown' }] };
}

/** The one region a text names among a country's regions (all, without a country), or null. */
function oneRegion(text: string, countryCode: string | undefined, vocab: Vocab): RegionEntity | null {
  for (const key of lookupKeys(text, 'region')) {
    const hits = vocab.lookup('region', key)
      .map((hit) => ({ hit, region: vocab.entity(hit.id) as RegionEntity }))
      .filter(({ region }) => countryCode === undefined || region.country === countryCode);
    if (hits.length === 0) continue;
    return hits.length === 1 && !hits[0]!.hit.ambiguous ? hits[0]!.region : null;
  }
  return null;
}

/** "TX - Texas" or "Texas - TX": a name and its code around a dash. */
const NAME_AND_CODE = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/;

/**
 * A region within its country: a USPS or Canada Post code, a name or an alias ("Tex.", "Washington, D.C.", "Armed
 * Forces (AA)"), looked up only among the given country's regions ("Ontario" is no region of the US); a name and a
 * code around a dash ("TX - Texas") only when both name the same region. Without a country, the US and Canada
 * together. Anything else is kept as written, with `region-unknown`. Empty text gives an empty name and no issue.
 */
export function canonicalRegion(text: string, country: string | undefined, vocab: Vocab, path = 'region'):
  Canonical<{ code?: string; name: string }> {
  const trimmed = tidy(text);
  if (trimmed === '') return { value: { name: '' }, issues: [] };
  const countryCode = country === undefined || tidy(country) === '' ? undefined
    : canonicalCountry(country, vocab, `${path}.country`).value.toUpperCase();
  let region = oneRegion(trimmed, countryCode, vocab);
  const pair = region === null ? NAME_AND_CODE.exec(trimmed) : null;
  if (pair) {
    const left = oneRegion(pair[1]!, countryCode, vocab);
    if (left !== null && left === oneRegion(pair[2]!, countryCode, vocab)) region = left;
  }
  if (region !== null) return { value: { code: region.code, name: region.name }, issues: [] };
  return { value: { name: trimmed }, issues: [{ path, code: 'region-unknown' }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Institutions

/** Normalized for comparing places (the institution context, as the vocabulary's cities were read). */
const placeKey = (text: string) => keyFor(text, 'institution');

/**
 * The one candidate whose facts agree with every part of the entry's location the person gave (country, then region
 * by code or name, then city), or null when the location is absent or leaves none or several.
 */
function byLocation(ids: readonly string[], location: PlaceInput | undefined, vocab: Vocab): string | null {
  if (!location) return null;
  const country = location.country && tidy(location.country) !== ''
    ? canonicalCountry(location.country, vocab).value.toUpperCase() : undefined;
  const regionText = location.region && tidy(location.region) !== '' ? tidy(location.region) : undefined;
  const region = regionText === undefined ? undefined : canonicalRegion(regionText, country, vocab).value;
  const city = location.city && tidy(location.city) !== '' ? placeKey(location.city) : undefined;
  if (country === undefined && region === undefined && city === undefined) return null;
  const matching = ids.filter((id) => {
    const entity = vocab.entity(id) as InstitutionEntity | undefined;
    if (!entity) return false;
    const { facts } = entity;
    if (country !== undefined && facts.country !== country) return false;
    if (region !== undefined) {
      const sameCode = region.code !== undefined && facts.regionCode === region.code;
      const sameName = facts.regionName !== undefined && placeKey(facts.regionName) === placeKey(region.name);
      if (!sameCode && !sameName) return false;
    }
    if (city !== undefined && (facts.city === undefined || placeKey(facts.city) !== city)) return false;
    return true;
  });
  return matching.length === 1 ? matching[0]! : null;
}

/** The entity an IPEDS or ROR id names, when the vocabulary has it. */
function byIds(ids: InstitutionInput['ids'], vocab: Vocab): InstitutionEntity | undefined {
  const ipeds = ids?.ipeds?.trim();
  const ror = ids?.ror?.trim();
  const found = (ipeds ? vocab.entity(`ipeds:${ipeds}`) : undefined) ?? (ror ? vocab.entity(`ror:${ror}`) : undefined);
  return found?.kind === 'institution' ? found : undefined;
}

/** Whether the entry's location may choose among the institutions sharing a key: only when the key is no short form
 *  or shared name, which more institutions answer to than hold it ("UT", "U of M", "Trinity"). */
function locationMaySettle(hits: readonly KeyHit[]): boolean {
  return !hits.some((hit) => hit.shortForm);
}

/**
 * The canonical institution (§2.7): by IPEDS or ROR id first; then by the key of the name, then, when the name names
 * no single institution, of the person's aliases, over unambiguous surfaces only; when the key is a name several
 * institutions hold, by the entry's location. A short form or shared name ("UT", "U of M", "Trinity", an uncurated
 * acronym) is never settled by location: more institutions answer to it than the vocabulary lists. When none of that
 * names exactly one institution, the person's text is kept (`source: 'user'`) with `institution-not-in-vocab` or
 * `institution-ambiguous`; an id the vocabulary does not hold adds `institution-id-unknown`. The person's aliases
 * always come first among the aliases; `userText` is the name exactly as typed.
 */
export function canonicalInstitution(input: InstitutionInput, vocab: Vocab, path = 'institution'): Canonical<Institution> {
  const issues: CanonicalizeIssue[] = [];
  const name = tidy(input.name);
  const nameKey = placeKey(name);
  const ownAliases = distinctByKey(input.aliases ?? [], placeKey, new Set([nameKey]));
  const givenIds = { ...(input.ids?.ipeds ? { ipeds: input.ids.ipeds.trim() } : {}),
    ...(input.ids?.ror ? { ror: input.ids.ror.trim() } : {}) };

  let entity = byIds(input.ids, vocab);
  if (!entity && (givenIds.ipeds || givenIds.ror)) issues.push({ path: `${path}.ids`, code: 'institution-id-unknown' });

  let shared: { ids: string[]; settles: boolean } | null = null;
  if (!entity) {
    const fromName = resolveName(vocab, 'institution', name);
    let id = fromName.id;
    if (fromName.ambiguous) {
      shared = { ids: fromName.hits.map((hit) => hit.id), settles: locationMaySettle(fromName.hits) };
    }
    if (id === null) {
      const fromAliases = new Set<string>();
      for (const alias of ownAliases) {
        const resolution = resolveName(vocab, 'institution', alias);
        if (resolution.id !== null) fromAliases.add(resolution.id);
      }
      // An alias may name the school a short form only hints at, but never one that a full name shared by others rules
      // out ("Northeastern University" with an alias of a third school names none of them).
      const only = fromAliases.size === 1 ? [...fromAliases][0]! : null;
      if (only !== null && (shared === null || !shared.settles || shared.ids.includes(only))) id = only;
      else if (fromAliases.size > 1 && shared === null) shared = { ids: [...fromAliases], settles: true };
    }
    if (id === null && shared?.settles) id = byLocation(shared.ids, input.location, vocab);
    if (id !== null) entity = vocab.entity(id) as InstitutionEntity;
  }

  if (!entity) {
    issues.push({ path, code: shared !== null ? 'institution-ambiguous' : 'institution-not-in-vocab' });
    const location = input.location;
    const country = location?.country ? canonicalCountry(location.country, vocab, `${path}.country`) : undefined;
    const region = location?.region
      ? canonicalRegion(location.region, country?.value || undefined, vocab, `${path}.region`) : undefined;
    const city = location?.city ? tidy(location.city) : '';
    return {
      value: {
        canonicalName: name, aliases: ownAliases, ids: givenIds,
        ...(city !== '' ? { city } : {}),
        ...(region && region.value.name !== '' ? { region: region.value.code ?? region.value.name } : {}),
        ...(country && country.value !== '' ? { country: country.value } : {}),
        source: 'user', userText: input.name,
      },
      issues: [...issues, ...(country?.issues ?? []), ...(region?.issues ?? [])],
    };
  }

  const { facts } = entity;
  const seen = new Set([placeKey(entity.name)]);
  const aliases = [...distinctByKey(ownAliases, placeKey, seen), ...distinctByKey(entityAliases(entity), placeKey, seen)];
  // The resolved id replaces a given one of its own kind (an unknown id was reported above); the other kind is kept.
  const ids: Institution['ids'] = entity.source === 'ipeds' ? { ...givenIds, ipeds: entity.id.slice('ipeds:'.length) }
    : { ...givenIds, ror: entity.id.slice('ror:'.length) };
  return {
    value: {
      canonicalName: entity.name, aliases, ids,
      ...(facts.city !== undefined ? { city: facts.city } : {}),
      ...(facts.regionCode ?? facts.regionName ? { region: facts.regionCode ?? facts.regionName } : {}),
      country: facts.country,
      ...(facts.campus !== undefined ? { campus: facts.campus } : {}),
      source: 'vocab', userText: input.name,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fields of study

function fieldFromEntity(entity: FieldEntity, userText: string): FieldOfStudy {
  const seen = new Set([keyFor(entity.name, 'field')]);
  return { name: entity.name, cip: entity.cip, aliases: distinctByKey(entityAliases(entity), (t) => keyFor(t, 'field'), seen),
    userText };
}

/**
 * The canonical field of study (§2.7): by its CIP code when the vocabulary holds it; else by the key of the text over
 * CIP titles, their slash alternatives, family titles and curated aliases, taking the most specific code of one line
 * of descent ("Computer Science" is 11.0701, not its series 11.07). Anything else keeps the text, with
 * `field-not-in-vocab`, or `field-ambiguous` when the key names unrelated codes; a CIP code given with it is kept.
 */
export function canonicalField(input: FieldInput, vocab: Vocab, path = 'field'): Canonical<FieldOfStudy> {
  const cip = input.cip?.trim();
  const known = cip ? vocab.fields.byCode(cip) : undefined;
  if (known) return { value: fieldFromEntity(known, input.text), issues: [] };
  const text = tidy(input.text);
  const resolution = text === '' ? null : resolveText(vocab, 'field', text);
  if (resolution?.id) return { value: fieldFromEntity(vocab.entity(resolution.id) as FieldEntity, input.text), issues: [] };
  return {
    value: { name: text, ...(cip ? { cip } : {}), aliases: [], userText: input.text },
    issues: [{ path, code: resolution?.ambiguous ? 'field-ambiguous' : 'field-not-in-vocab' }],
  };
}
