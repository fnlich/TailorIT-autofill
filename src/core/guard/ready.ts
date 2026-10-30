/*
 * guardReady (docs/design/core.md §7.12, docs/ARCHITECTURE.md "What may be written, and when"): the last check before
 * the panel says the form is ready for the person's review. Nothing is ever submitted; this only decides what the
 * person is told. It reads back every value in the form, ours and the person's own typing alike:
 * - a value holding a canary is an issue: one the extension wrote is blocked (the content script sets a text back to
 *   its earlier value, and leaves a choice selected but blocked with "Remove this selection"); one the person typed is
 *   only flagged, never overwritten;
 * - every draft must be confirmed by the person (llm-draft-needs-confirmation until then);
 * - every blocked field is listed.
 * The form is ready only when there is no issue at all.
 */
import type { Provenance } from '../enums';
import type { FieldKey } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import { canariesIn, collidesWithProfile, type ProfileIndex } from './canary';

/** One field's value as read back from the page: in memory only. */
export interface ReadBackValue {
  key: FieldKey;
  /** The provenance of the extension's write, or null when the extension wrote nothing there (the person's typing,
   *  or the page's prefill). */
  provenance: Provenance | null;
  /** The text the field holds, or the labels of the options it has selected, joined. */
  text: string;
  /** For a draft: the person has edited it or confirmed it in the panel. */
  draftConfirmed?: boolean;
}

/** One reason the form is not ready. */
export interface ReadyIssue {
  key: FieldKey;
  reason: ReasonCode;
  /** The extension wrote the value: it is blocked. False for the person's own typing, which is only flagged. */
  ours: boolean;
}

/** What guardReady reads besides the values: the page's canaries, and in the worker the profile's collision index. */
export interface ReadyContext {
  canaries: readonly string[];
  profileIndex?: ProfileIndex;
}

/** The final check before "ready for your review" (§7.12): canaries in any read-back value, unconfirmed drafts and
 *  blocked fields, each listed once per field and reason. */
export function guardReady(readBack: readonly ReadBackValue[], results: readonly FillResult[], ctx: ReadyContext):
  { ready: boolean; issues: ReadyIssue[] } {
  const issues: ReadyIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: ReadyIssue) => {
    const id = `${issue.key}\u001f${issue.reason}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push(issue);
  };
  for (const value of readBack) {
    const hits = canariesIn([value.text], ctx.canaries);
    if (hits.length > 0) {
      const index = ctx.profileIndex;
      const equalsProfile = index !== undefined && hits.some((canary) => collidesWithProfile(canary, index));
      add({ key: value.key, reason: equalsProfile ? 'canary-equals-profile-value' : 'canary-in-value',
        ours: value.provenance !== null });
    }
    if (value.provenance === 'llm-draft' && value.draftConfirmed !== true) {
      add({ key: value.key, reason: 'llm-draft-needs-confirmation', ours: true });
    }
  }
  for (const row of results) {
    if (row.status === 'blocked') add({ key: row.key, reason: row.reason, ours: row.wrote });
  }
  return { ready: issues.length === 0, issues };
}
