/*
 * s2 core-wd: "When a list has no match" (the owner, 2026-11-07: "if there is no matched thing, write the other one.
 * there is no matched after with 3 different style value, last will be other or don't write (user can set on setting
 * it)"; docs/ARCHITECTURE.md, snapshot round 2). settings.modes.noMatch, stored since settings
 * version 7:
 * - 'other' (the default): a search for an entity of the profile's (a school, a field of study, an employer, a place,
 *   how the person heard of the job, a phone country by its name) that found nothing with its three styles
 *   (core/matcher/candidates.ts) types "Other" once more, and the list's own "Other" among what it lists is chosen
 *   (core/matcher/other.ts noMatchOtherMatch), the person's own text kept for the box it may reveal;
 * - 'leave': nothing more is typed, and nothing is chosen: the field stays empty. Stage e's "Other" on a list read whole
 *   (other.ts otherMatch) is left unchosen too.
 * Never for a self-identification (EEO), legal, consent or yes/no question, nor for an answer that is not the
 * profile's own (an AI pick or answer, a saved answer): there "Other" could state something false.
 */
import type { FieldCategory } from '../types/intent';
import type { Resolution } from '../types/match';
import type { Settings } from '../types/settings';

/** The entity searches whose list's own "Other" may be chosen when nothing else is (see the header). */
export const NO_MATCH_OTHER_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['education.school',
  'education.field', 'experience.company', 'experience.currentCompany', 'location.current', 'experience.location',
  'referral.source', 'contact.phoneCountry',
  // jr6 RULES R3 (ICIMS-19): how the person heard, specified further.
  'referral.detail']);

/** jr6 RULES R3 (ICIMS-19, ICIMS-20): the referral lists whose answer is the profile's source by an exact or alias match
 *  alone; where none is, the list's own "Other" (noMatchOtherAllowed), never an LLM tiebreak or a weak match. */
export const REFERRAL_LISTS: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['referral.source',
  'referral.detail']);

/** The person's setting (stored since settings version 7; 'other' by default). A settings object that names none (one
 *  built before version 7, or a test's) reads as the default too. */
export function noMatchMode(settings: Settings): 'other' | 'leave' {
  return settings.modes.noMatch ?? 'other';
}

/** Whether a field's search may end on the list's own "Other" (see the header): the setting says 'other', the field is
 *  one of NO_MATCH_OTHER_CATEGORIES, and its value is the profile's. */
export function noMatchOtherAllowed(resolution: Resolution, settings: Settings): boolean {
  return noMatchMode(settings) === 'other' && NO_MATCH_OTHER_CATEGORIES.has(resolution.category)
    && resolution.policy === 'profile' && resolution.origin?.provenance === 'profile';
}
