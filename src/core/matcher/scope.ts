/*
 * One matchOne call's view of the intended value: its spellings normalized in the domain's context, its display, its
 * entity id, and the distinctive-token guard over them, with each option's guard words and verdict worked out once.
 * Spellings marked ambiguous (shared by several entities, or resting on an unresolved "st?") are left out: no stage
 * may rest on them. A yes or no has no spellings of its own, so the polarity entity's are used, its display ("Yes",
 * "No") counting as the primary spelling.
 *
 * A school whose only spellings are acronyms the vocabulary does not hold as that school's own ("UT", "OSU": only
 * curated acronyms are) is matched as those words alone: no stage may then rest on its id, so a form's spelled-out
 * options are never reached through a guess at what the acronym stands for, while an option that is the acronym
 * itself still matches. A value that also carries the school's names (intendedEntity's) rests on more than the
 * acronym: its id was given, or the person spelled the school out.
 */
import { keyWithBrackets, normalize, type Normalized } from '../text/normalize';
import type { IntendedValue, Surface, SurfaceTier } from '../types/intent';
import { isAcronymShaped, keyFor } from '../vocab/lookup';
import type { Vocab } from '../vocab/types';
import { entityGuard, guardSide, checkGuard, type EntityGuard, type GuardSide, type GuardVerdict } from './guardTokens';
import { domainContext } from './prepare';
import type { MatchDomain, MatchInput, PreparedOption } from './types';
import type { StagePlan } from './domains';

/** One spelling of the intended value, normalized. */
export interface IntendedSurface {
  text: string;
  tier: SurfaceTier;
  norm: Normalized;
  /** The key with bracketed words kept as main text (PreparedOption.fullKey). */
  fullKey: string;
}

/** What one call knows about the intended value. */
export interface Scope {
  input: MatchInput;
  vocab: Vocab;
  domain: MatchDomain;
  plan: StagePlan;
  /** The vocabulary entity the value is ('bool:true' for a yes), or null. */
  entityId: string | null;
  /** The canonical display: Other's free text and the LLM's intended value. */
  display: string;
  /** Unambiguous spellings, the person's own first. */
  surfaces: IntendedSurface[];
  /** The guard over the trusted spellings. */
  guard(): EntityGuard;
  /** A spelling's guard words. */
  surfaceSide(surface: IntendedSurface): GuardSide;
  /** An option's guard words. */
  optionSide(option: PreparedOption): GuardSide;
  /** The guard's verdict on an option. */
  verdict(option: PreparedOption): GuardVerdict;
}

/** The spellings the guard's rules rest on (§4.5): the person's own, the canonical names, the curated and generated
 *  aliases. */
const TRUSTED_TIERS: ReadonlySet<SurfaceTier> = new Set<SurfaceTier>(['raw', 'primary', 'curated', 'generated']);

/** A spelling normalized for the domain. */
export function intendedSurface(text: string, tier: SurfaceTier, domain: MatchDomain): IntendedSurface {
  const context = domainContext(domain);
  const norm = normalize(text, context);
  const fullKey = norm.qualifiers.length === 0 ? norm.key : keyWithBrackets(text, context);
  return { text, tier, norm, fullKey };
}

/**
 * A school's spellings when every one is an acronym the vocabulary does not hold as that school's (a short form other
 * schools answer to as well, or one it does not know): then those acronyms are all its identity rests on. Null when it
 * rests on more: a spelled-out name, or an acronym the vocabulary curates for the school.
 */
export function unconfirmedAcronyms(intended: Extract<IntendedValue, { kind: 'entity' }>, vocab: Vocab):
  Surface[] | null {
  if (intended.domain !== 'institution' || intended.id === null) return null;
  const spellings = intended.surfaces.filter((surface) => !surface.ambiguous && surface.text.trim() !== '');
  if (spellings.length === 0 || !spellings.every((surface) => isAcronymShaped(surface.text))) return null;
  const own = spellings.some((surface) => vocab.lookup('institution', keyFor(surface.text, 'institution'))
    .some((hit) => hit.id === intended.id && !hit.ambiguous && !hit.shortForm));
  return own ? null : spellings;
}

/**
 * Whether a school rests on acronyms alone: no entity id (the vocabulary left the acronym ambiguous or never knew it,
 * or holds it as no school's own) and every spelling an acronym with no presence word ("OSU", "BU"). Guard rule 1 then
 * rules out every option that names a place, a state or a discipline, which are usually the schools the acronym
 * stands for ("The Ohio State University", "Oregon State University"), so the options it leaves are not the plausible
 * answers, and no LLM pick may rest on them: the field is left blank with suggestions (§4.6).
 */
export function restsOnAcronymsAlone(scope: Scope): boolean {
  if (scope.domain !== 'institution' || scope.entityId !== null || scope.surfaces.length === 0) return false;
  return scope.surfaces.every((surface) => isAcronymShaped(surface.text)
    && scope.surfaceSide(surface).presence.size === 0);
}

/** The spellings of an intended value, the person's own first; null for a kind the matcher cannot match. */
function spellingsOf(intended: IntendedValue, vocab: Vocab):
  { entityId: string | null; display: string; surfaces: Array<{ text: string; tier: SurfaceTier }> } | null {
  switch (intended.kind) {
    case 'entity': {
      const acronyms = unconfirmedAcronyms(intended, vocab);
      if (acronyms) return { entityId: null, display: acronyms[0]!.text, surfaces: acronyms };
      return { entityId: intended.id, display: intended.display,
        surfaces: intended.surfaces.filter((surface) => !surface.ambiguous) };
    }
    case 'degree':
      return { entityId: null, display: intended.display,
        surfaces: intended.surfaces.filter((surface) => !surface.ambiguous) };
    case 'boolean': {
      const entity = vocab.entity(intended.value ? 'bool:true' : 'bool:false');
      if (!entity) return null;
      return { entityId: entity.id, display: entity.name, surfaces: entity.surfaces.map((surface, at) => ({
        text: surface.text, tier: at === 0 ? 'primary' : surface.tier })) };
    }
    case 'text':
      return { entityId: null, display: intended.text, surfaces: [{ text: intended.text, tier: 'raw' }] };
    case 'decline':
    case 'number':
      return { entityId: null, display: '', surfaces: [] };
    default:
      return null;
  }
}

const EMPTY: ReadonlySet<string> = new Set();

/** The scope of one call, or null when the intended value is of a kind no option list can hold (a date, a set, a
 *  file: the multi-select planner matches a set's values one by one). */
export function buildScope(input: MatchInput, vocab: Vocab, plan: StagePlan): Scope | null {
  const domain = input.options.domain;
  const spellings = spellingsOf(input.intended, vocab);
  if (!spellings) return null;
  const surfaces = spellings.surfaces.filter((surface) => surface.text.trim() !== '')
    .map((surface) => intendedSurface(surface.text, surface.tier, domain));
  const sides = new Map<IntendedSurface, GuardSide>();
  const optionSides = new Map<PreparedOption, GuardSide>();
  const verdicts = new Map<PreparedOption, GuardVerdict>();
  let guard: EntityGuard | null = null;
  const scope: Scope = {
    input,
    vocab,
    domain,
    plan,
    entityId: spellings.entityId,
    display: spellings.display,
    surfaces,
    surfaceSide(surface) {
      let side = sides.get(surface);
      if (!side) sides.set(surface, side = guardSide(surface.norm, domain, vocab));
      return side;
    },
    guard() {
      if (guard) return guard;
      // Every rule rests on the person's own spelling, the canonical names and the curated or generated aliases ("UT
      // Austin"), never on a source's loose aliases or a flagship's bare name: a phrase such as "4-year degree"
      // would demand a word nobody else writes, and a former or system name ("State University of New York at
      // Buffalo") would excuse a word that names another campus. For rule 2, spellings without presence words (an
      // acronym such as "UTD") never count, so they cannot excuse a missing "dallas".
      const trusted = surfaces.filter((surface) => TRUSTED_TIERS.has(surface.tier))
        .map((surface) => scope.surfaceSide(surface));
      const { entityId } = spellings;
      const facts = entityId !== null && domain === 'institution' ? vocab.factTokens(entityId) : EMPTY;
      guard = entityGuard(trusted, facts);
      return guard;
    },
    optionSide(option) {
      let side = optionSides.get(option);
      if (!side) optionSides.set(option, side = guardSide(option.norm, domain, vocab));
      return side;
    },
    verdict(option) {
      let verdict = verdicts.get(option);
      if (!verdict) verdicts.set(option, verdict = checkGuard(scope.guard(), scope.optionSide(option)));
      return verdict;
    },
  };
  return scope;
}
