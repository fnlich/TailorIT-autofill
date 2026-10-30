/*
 * Canaries (docs/design/core.md §7.3-7.5): extracted only from passages a tripwire matched, scanned for in every
 * outgoing value, and never stored when one equals a profile value.
 * A stub until the Phase 2 core work replaces it; nothing calls it before then.
 */
import type { Profile } from '../types/profile';

/** The canaries the worker may keep in RunState: every one that equals a profile value is dropped (§7.4). */
export function persistableCanaries(_canaries: readonly string[], _profile: Profile): string[] {
  throw new Error('persistableCanaries is not built yet');
}
