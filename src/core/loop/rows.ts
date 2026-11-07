/*
 * The rows the reactive loop reports (Requirement D: "if a field disappears, drop its recorded answer and report";
 * "after loop: report anything still unresolved"). The loop keeps each field's latest row by base key
 * (bookkeeping.ts); at the end these turn its books into the report's rows, value-free like every row:
 * - a field that disappeared: field-disappeared. One we wrote is settled as a write that did not read back (filled, a
 *   flagged row stays flagged, for the person to check: a hidden field may still hold our value), exactly as the
 *   verification after the settle rows a written field that is gone; one we did not write is skipped, with nothing to
 *   do;
 * - a field left unresolved: flagged with the loop's reason (max-passes-reached, options-never-loaded,
 *   value-oscillated, options-oscillated, reveal-cycle, page-busy, user-stopped, and a pause, a policy notice or a
 *   hidden frame that cut the loop), under the key the field has now. A blocked row keeps its status and reason: the
 *   Guard's word stands;
 * - a field the person changed after our write (changed-by-you): flagged, and nothing of ours stands in it, so it has
 *   no provenance and wrote nothing (the final Guard then treats its value as the person's, never as ours);
 * - a field the loop never planned (it appeared at the last scan): a flagged row of its own, category unknown, since
 *   nothing classified it;
 * - a field another's write revealed names that writer (detail.revealedBy).
 */
import type { FieldKind } from '../enums';
import { settleRow } from '../plan/settle';
import type { FillResult, ReasonCode } from '../types/fill';
import { isStopped, type LoopState, type LoopVerdict, type TrackedField } from './bookkeeping';

/** The kinds whose rows name a matcher stage ('none' when nothing was matched). */
const OPTION_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'checkbox-group', 'combobox',
  'multiselect', 'typeahead-remote']);

/** The row of a field that disappeared after it was planned or written. A file whose upload the page said failed keeps
 *  that word (the Phase 7a review: Workable's page falls over at a failed upload, taking the field with it). */
export function disappearedRow(row: FillResult): FillResult {
  if (row.reason === 'field-disappeared' || row.reason === 'upload-failed') return row;
  if (row.wrote) {
    return { ...settleRow(row, { kind: 'mismatch' }), reason: 'field-disappeared', verification: 'not-checked' };
  }
  return { ...row, status: 'skipped', provenance: null, reason: 'field-disappeared', verification: 'not-applicable',
    needsUserAction: false };
}

/** The row of a field the loop left unresolved, under the key it has now (`key`, when its options changed since the
 *  row was made). */
export function unresolvedRow(row: FillResult, reason: ReasonCode, key: FillResult['key'] = row.key): FillResult {
  if (row.status === 'blocked') return { ...row, key };
  if (reason === 'changed-by-you') {
    // The value there is the person's: nothing of ours stands in it.
    return { ...row, key, status: 'flagged', reason, provenance: null, wrote: false, verification: 'not-applicable',
      needsUserAction: true };
  }
  return { ...row, key, status: 'flagged', reason, needsUserAction: true,
    verification: row.wrote ? 'not-checked' : row.verification };
}

/** The row of a field the loop never planned. */
export function unplannedRow(field: TrackedField, reason: ReasonCode): FillResult {
  return {
    key: field.key, label: field.label, kind: field.kind, category: 'unknown', section: field.section,
    required: field.required, status: 'flagged', provenance: null,
    matcherStage: OPTION_KINDS.has(field.kind) ? 'none' : 'not-applicable', confidence: 0, reason, wrote: false,
    verification: 'not-applicable', needsUserAction: true,
  };
}

/** A row with the writer that revealed its field. */
function withRevealer(row: FillResult, field: TrackedField): FillResult {
  if (field.revealedBy === null) return row;
  return { ...row, detail: { ...row.detail, revealedBy: field.revealedBy } };
}

/**
 * The loop's rows: the fields present at the last scan in DOM order, then those that disappeared. Every planned field
 * has one; a field never planned has one only when the verdict leaves it unresolved (it appeared at the last scan), and
 * a field that disappeared before it was planned has none. Pass the final verdict; mid-loop, the rows so far.
 */
export function loopRows(state: LoopState, verdict: LoopVerdict): FillResult[] {
  const reasons = new Map(verdict.unresolved.map((left) => [left.baseKey, left.reason]));
  const fields = [...state.fields.values()].sort((a, b) =>
    Number(b.present) - Number(a.present) || a.domOrder - b.domOrder || a.firstSeenPass - b.firstSeenPass);
  const rows: FillResult[] = [];
  for (const field of fields) {
    const own = isStopped(field) || field.status === 'unresolvable' ? field.reason ?? undefined : undefined;
    const reason = field.present ? reasons.get(field.baseKey) ?? own : undefined;
    if (reason !== undefined) {
      rows.push(withRevealer(field.row === null ? unplannedRow(field, reason)
        : unresolvedRow(field.row, reason, field.key), field));
    } else if (field.row !== null) {
      // A stopped field that went keeps its own reason; a frozen one still holding our value went like any other. An
      // upload the page took with its input (TrackedField.taken, the core pass of 2026-11-06) keeps its row.
      const row = field.present || field.taken === true ? field.row
        : field.status === 'disappeared' || field.reason === null ? disappearedRow(field.row)
          : unresolvedRow(field.row, field.reason);
      rows.push(withRevealer(row, field));
    }
  }
  return rows;
}
