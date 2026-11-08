/*
 * v4 ui (the owner, 2026-11-07): whether the person's autofill information is complete enough for the side panel's
 * main view, as data. Complete: a first name, a last name, an email (the profile's, or the account's sign-in address an
 * empty one stands for), a phone number, and a city or a country. The set-up view's second step lists what is missing.
 *
 * v5 p1-panel (PLAN decision 6, Jobright's resume check): the same check says whether the profile holds no work
 * experience or no education (`history`, the kinds missing), so the main view's Autofill can say so in a modal before it
 * fills, as Jobright's "missing key info" popup does.
 *
 * The Phase 1 review (S6): the panel runs in the page's process too (the on-page sidebar), so the profile never comes
 * here for the check: panel/profileCheck asks the worker, which reads the profile (never its sensitive part), works the
 * check out there (shared/profile-gaps.ts) and answers the names of what is missing alone. It is asked while the
 * extension is connected, once per connection key (every new token, every connection change the worker announced) and
 * again when the panel asks (after the editor saved). A check refused or failed counts as unreadable: the panel then
 * shows its main view rather than lock the person out (the fill reads the profile itself).
 */
import { useCallback, useEffect, useState } from 'react';
import type { PagePlatform } from '../../platform/types';
import {
  HISTORY_KINDS, historyGaps, PROFILE_GAPS, profileGaps, type HistoryGap, type ProfileGap,
} from '../../shared/profile-gaps';
import { request } from '../page/request';

export { HISTORY_KINDS, historyGaps, PROFILE_GAPS, profileGaps, type HistoryGap, type ProfileGap };

/** Where the profile check stands: not asked (not connected), being read, read (its gaps), or unreadable. */
export type ProfileCheck =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'read'; gaps: readonly ProfileGap[]; history: readonly HistoryGap[] }
  | { state: 'unreadable' };

/**
 * The profile check for the panel (module header). `key` is null while not connected (nothing is asked), and otherwise
 * changes with the connection. `recheck()` asks again.
 */
export function useProfileCheck(platform: PagePlatform, key: string | null): { check: ProfileCheck; recheck(): void } {
  const [reads, setReads] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; reads: number; check: ProfileCheck } | null>(null);

  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    // The worker's check: names of what is missing, never the profile (S6).
    void request(platform, { v: 1, type: 'panel/profileCheck' }).then((reply) => {
      if (!live) return;
      const check: ProfileCheck = reply.ok ? { state: 'read', gaps: reply.data.gaps, history: reply.data.history }
        : { state: 'unreadable' };
      setAnswer({ key, reads, check });
    });
    return () => {
      live = false;
    };
  }, [platform, key, reads]);

  const recheck = useCallback(() => setReads((count) => count + 1), []);
  if (key === null) return { check: { state: 'idle' }, recheck };
  // The answer for this key (a newer read of the same key keeps the last answer on show until it lands).
  if (answer !== null && answer.key === key) return { check: answer.check, recheck };
  return { check: { state: 'reading' }, recheck };
}
