/*
 * canonicalizeProfile (docs/design/core.md §2.7): TailorIT's two wire parts in, the canonical Profile out. Pure; its
 * issues carry a path and a code, never a value.
 * A stub until the Phase 2 core work replaces it; nothing calls it before then.
 */
import type { AutofillProfile, AutofillSensitive } from '../../contract/tailorit';
import type { Profile, SensitiveState, Ymd } from '../types/profile';
import type { Vocab } from '../vocab/types';
import type { CanonicalizeIssue } from './entities';

export interface CanonicalizeResult {
  profile: Profile;
  issues: CanonicalizeIssue[];
  /** 'loaded' when the sensitive part was given, else 'not-loaded'. Only the worker knows 'not-shared' (a 403). */
  sensitiveState: SensitiveState;
}

export function canonicalizeProfile(
  _profile: AutofillProfile,
  _sensitive: AutofillSensitive | null,
  _vocab: Vocab,
  _now: Ymd,
): CanonicalizeResult {
  throw new Error('canonicalizeProfile is not built yet');
}
