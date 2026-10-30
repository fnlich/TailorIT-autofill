/*
 * Policy notices (docs/design/core.md §7.10): "do not use AI" and its kin, read on the posting wherever it can be read:
 * the posting page, the form frame's visible description, or TailorIT's stored copy from the lookup.
 * A stub until the Phase 2 core work replaces it; nothing calls it before then.
 */
import type { StoredPostingText, VisibleText } from '../types/text';

/** The ids of the policy patterns the text matches, in pattern order; empty when none does. */
export function policyHits(_text: VisibleText | StoredPostingText): string[] {
  throw new Error('policyHits is not built yet');
}
