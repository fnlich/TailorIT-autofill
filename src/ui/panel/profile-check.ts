/*
 * v4 ui (the owner, 2026-11-07): whether the person's autofill information is complete enough for the side panel's
 * main view, as data. Complete: a first name, a last name, an email (the profile's, or the account's sign-in address an
 * empty one stands for), a phone number, and a city or a country. The set-up view's second step lists what is missing.
 *
 * It reads panel/profile {sensitive: false} (the editor's read without the sensitive part: the person's own profile,
 * from their TailorIT, through the worker) while
 * the extension is connected, once per connection key (every new token, every connection change the worker announced)
 * and again when the panel asks (after the editor saved). It keeps only which of the five are missing: never a value,
 * and the profile itself is dropped the moment the gaps are worked out. A read refused or failed counts as unreadable:
 * the panel then shows its main view rather than lock the person out (the fill reads the profile itself).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AutofillProfile } from '../../contract/tailorit';
import type { PagePlatform } from '../../platform/types';
import { request } from '../page/request';

/** What a complete profile holds, in the order the set-up view names what is missing. */
export const PROFILE_GAPS = ['first', 'last', 'email', 'phone', 'place'] as const;
export type ProfileGap = (typeof PROFILE_GAPS)[number];

/** What is missing from `profile` (none: complete). `accountEmail` is the account's sign-in address, which an empty
 *  email stands for (TailorIT's rule); null when not known. */
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

/** Where the profile check stands: not asked (not connected), being read, read (its gaps), or unreadable. */
export type ProfileCheck =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'read'; gaps: readonly ProfileGap[] }
  | { state: 'unreadable' };

/**
 * The profile check for the panel (module header). `key` is null while not connected (nothing is read), and otherwise
 * changes with the connection; `accountEmail` the account's sign-in address. `recheck()` reads it again.
 */
export function useProfileCheck(platform: PagePlatform, key: string | null, accountEmail: string | null):
  { check: ProfileCheck; recheck(): void } {
  const [reads, setReads] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; reads: number; check: ProfileCheck } | null>(null);

  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    // The profile alone: the sensitive part has nothing the check needs, so it is never read for it.
    void request(platform, { v: 1, type: 'panel/profile', sensitive: false }).then((reply) => {
      if (!live) return;
      // Only the gaps are kept: the profile goes with this closure.
      const check: ProfileCheck = reply.ok ? { state: 'read', gaps: profileGaps(reply.data.profile, accountEmail) }
        : { state: 'unreadable' };
      setAnswer({ key, reads, check });
    });
    return () => {
      live = false;
    };
  }, [platform, key, reads, accountEmail]);

  const recheck = useCallback(() => setReads((count) => count + 1), []);
  if (key === null) return { check: { state: 'idle' }, recheck };
  // The answer for this key (a newer read of the same key keeps the last answer on show until it lands).
  if (answer !== null && answer.key === key) return { check: answer.check, recheck };
  return { check: { state: 'reading' }, recheck };
}
