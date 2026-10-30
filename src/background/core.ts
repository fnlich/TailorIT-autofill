/*
 * The pure core as the worker uses it, taken as one injected set: index.ts passes the real functions, and the worker's
 * tests pass fakes, so the worker is tested on its own and the core on its own (the core's tests pin its behaviour).
 */
import type { AutofillProfile, AutofillResumeChoice, AutofillSensitive } from '../contract/tailorit';
import type { PlanInput, PlanOutput } from '../core/plan/types';
import type { CanonicalizeResult } from '../core/profile/canonicalize';
import type { Profile, Ymd } from '../core/types/profile';
import type { StoredPostingText } from '../core/types/text';
import type { Vocab } from '../core/vocab/types';

/** The core functions the worker calls, injected so its tests can pass fakes. */
export interface CoreFunctions {
  /** One plan/request: resolve, match, guard and plan this frame's fields (core/plan/frame.ts). */
  planFrame(input: PlanInput): PlanOutput;
  /** TailorIT's two wire parts in, the canonical Profile out (core/profile/canonicalize.ts). */
  canonicalizeProfile(
    profile: AutofillProfile,
    sensitive: AutofillSensitive | null,
    vocab: Vocab,
    now: Ymd,
  ): CanonicalizeResult;
  /** The profile with the resume the run attaches, or with none (core/profile/canonicalize.ts). */
  attachResume(profile: Profile, choice: Pick<AutofillResumeChoice, 'id' | 'fileName' | 'fileKind'> | null): Profile;
  /** The canaries RunState may keep: none that equals a profile value (core/guard/canary.ts). */
  persistableCanaries(canaries: readonly string[], profile: Profile): string[];
  /** The policy patterns TailorIT's stored copy of a posting matches (core/guard/policy.ts). */
  policyHits(text: StoredPostingText): string[];
  /** The bundled vocabulary, built on first use and kept for the worker's life. */
  vocab(): Vocab;
}

/** The calendar day of `ms` in the browser's own time zone: the core's `now`. */
export function ymdOf(ms: number): Ymd {
  const date = new Date(ms);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}
