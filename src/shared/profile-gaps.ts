/*
 * What the panel's checks need to know of the person's autofill information, worked out where the profile is: in the
 * worker (background/profile-editor.ts `check`, panel/profileCheck), never in a page. The Phase 1 review (S6): the
 * on-page sidebar runs in the page's process, so the profile itself must not travel there for a check; the answer is
 * which items are missing and which kinds of history hold no entry, names from closed lists and nothing else.
 * - Complete (v4 ui, the set-up view's second step): a first name, a last name, an email (the profile's, or the
 *   account's sign-in address an empty one stands for: TailorIT's rule), a phone number, and a city or a country.
 * - History (v5 p1-panel, Jobright's resume check before Autofill): at least one work experience and one education.
 * Pure: the profile in, names out.
 */
import type { AutofillProfile } from '../contract/tailorit';

/** What a complete profile holds, in the order the set-up view names what is missing. */
export const PROFILE_GAPS = ['first', 'last', 'email', 'phone', 'place'] as const;
export type ProfileGap = (typeof PROFILE_GAPS)[number];

/** The history Autofill checks before it fills. */
export const HISTORY_KINDS = ['experience', 'education'] as const;
export type HistoryGap = (typeof HISTORY_KINDS)[number];

/** What is missing from `profile` (none: complete). `accountEmail` is the account's sign-in address, which an empty
 *  email stands for; null when not known. */
export function profileGaps(profile: AutofillProfile, accountEmail: string | null): ProfileGap[] {
  const has = (text: string | null | undefined) => (text ?? '').trim() !== '';
  const { address } = profile.contact;
  const present: Record<ProfileGap, boolean> = {
    first: has(profile.name.first),
    last: has(profile.name.last),
    email: has(profile.contact.email) || has(accountEmail),
    phone: has(profile.contact.phone.number),
    place: has(address.city) || address.country !== null,
  };
  return PROFILE_GAPS.filter((gap) => !present[gap]);
}

/** The kinds of history `profile` holds no entry of (none: both are there). Entries are counted, never read. */
export function historyGaps(profile: Pick<AutofillProfile, HistoryGap>): HistoryGap[] {
  return HISTORY_KINDS.filter((kind) => profile[kind].length === 0);
}
