/*
 * After the pass's settle (docs/ARCHITECTURE.md "Filler › Statuses", "Orchestrator › Before ready"):
 * - verifyWritten: each written field is found again by key in a fresh scan and read back (verifyAfterSettle: digits
 *   for phones, case-folded email, the option's identity, the file's name and size, no aria-invalid). A multi-select's
 *   selection must also be exactly what it held before plus what we added (verifyOptionsWrite): a missing option is
 *   verify-mismatch, one the site added is unexpected-selection, and nothing is ever unticked. A field that is gone is
 *   field-disappeared.
 * - finalGuard: guardReady reads back every value in the form, ours and the person's own alike, before the run says it
 *   is ready for review. A value holding a canary that we wrote is blocked: a text is set back to what it held before
 *   our write (a write with provenance rule guard.revert, through both Guards, cleared to empty if that earlier value
 *   holds a canary too), and a choice keeps its selection, blocked, highlighted with "Remove this selection". A value
 *   the person typed, or the page prefilled, is only flagged, never overwritten. An unconfirmed draft is flagged.
 * Read-back values stay in memory; nothing here sends or logs one.
 */
import type { Adapter } from '../adapters/types';
import { canariesIn } from '../core/guard/canary';
import { guardReady, type ReadBackValue } from '../core/guard/ready';
import { guardWriteInFrame } from '../core/guard/write';
import { verifyOptionsWrite } from '../core/multiselect/verify';
import { settleRow } from '../core/plan/settle';
import type { FieldKey } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import { fill, verifyAfterSettle } from '../dom/fillers';
import { domGuardBeforeWrite } from '../dom/guard';
import { toFieldSpec } from '../dom/scan';
import type { ScannedField, ScanResult } from '../dom/types';
import { mismatchRow, selectedOf, type WrittenField } from './pass';

/** Reasons the final Guard gives a value holding a canary. */
const CANARY_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['canary-in-value', 'canary-equals-profile-value']);

/** A written field's row after the settle, from a fresh scan. */
export function verifyWritten(fresh: ScanResult, written: WrittenField): FillResult {
  const options = { ...(written.rule ? { rule: written.rule } : {}), ...(written.file ? { file: written.file } : {}) };
  const verdict = verifyAfterSettle(fresh, written.key, written.value, options);
  if (verdict.verification === 'verified') {
    if (written.value.kind === 'options') {
      const after = selectedOf(fresh.target(written.key)?.field);
      const check = verifyOptionsWrite(written.selectedBefore, written.value.indices, after);
      if (!check.ok) return mismatchRow(written.planned, check.reason);
    }
    return settleRow(written.planned, { kind: 'verified' });
  }
  if (verdict.verification === 'mismatch') return mismatchRow(written.planned, verdict.reason);
  return { ...settleRow(written.planned, { kind: 'mismatch' }), reason: 'field-disappeared',
    verification: 'not-checked' };
}

/** The texts a field holds now, as guardReady reads them: its text, each selected option's label, or a ticked lone
 *  box's own label (ticking it chose that option). Memory only. */
function readBackTexts(field: ScannedField): string[] {
  const current = field.current;
  switch (current.kind) {
    case 'text':
      return current.text === '' ? [] : [current.text];
    case 'selected':
      return current.labels.filter((label) => label !== '');
    case 'checked':
      return current.checked && field.label !== '' ? [field.label] : [];
    default:
      return [];
  }
}

/** What the final Guard needs besides the scan and the rows. */
export interface FinalGuardEnv {
  adapter: Adapter;
  root: Element;
  canaries: readonly string[];
}

/** The final Guard's result: the rows it changed, and the selections the person is asked to remove. */
export interface FinalGuardResult {
  rows: Map<FieldKey, FillResult>;
  removeSelection: Set<FieldKey>;
  /** The keys whose text was set back to its earlier value. */
  reverted: Set<FieldKey>;
}

/** Sets a text we wrote back to what it held before, through both Guards. Answers whether it did. */
function revert(env: FinalGuardEnv, fresh: ScanResult, written: WrittenField): boolean {
  if (written.textBefore === null) return false;
  const verdict = domGuardBeforeWrite(fresh, written.field);
  if (!verdict.ok) return false;
  const before = canariesIn([written.textBefore], env.canaries).length === 0 ? written.textBefore : '';
  const write: PlannedWrite = {
    key: written.key,
    value: { kind: 'text', text: before },
    origin: { provenance: 'rule', ruleId: 'guard.revert' },
    match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [],
      reason: 'ok' },
  };
  if (!guardWriteInFrame(write, toFieldSpec(verdict.target.field), env.canaries).ok) return false;
  return fill(verdict.target, write.value, { adapter: env.adapter, root: env.root }).verification === 'verified';
}

/** The final Guard over a fresh scan (guardReady), applied to the rows. */
export function finalGuard(env: FinalGuardEnv, fresh: ScanResult, rows: Map<FieldKey, FillResult>,
  written: readonly WrittenField[]): FinalGuardResult {
  const out = new Map(rows);
  const removeSelection = new Set<FieldKey>();
  const reverted = new Set<FieldKey>();
  const readBack: ReadBackValue[] = [];
  for (const field of fresh.fields) {
    const row = out.get(field.key);
    const provenance = row !== undefined && row.wrote ? row.provenance : null;
    for (const text of readBackTexts(field)) readBack.push({ key: field.key, provenance, text });
  }
  const { issues } = guardReady(readBack, [...out.values()], { canaries: env.canaries });
  for (const issue of issues) {
    const row = out.get(issue.key);
    if (row === undefined) continue;
    if (CANARY_REASONS.has(issue.reason)) {
      if (!issue.ours) {
        // The person's own value (or the page's): flagged, never overwritten.
        if (row.status !== 'blocked') out.set(issue.key, { ...row, status: 'flagged', reason: issue.reason,
          needsUserAction: true });
        continue;
      }
      const ours = written.find((entry) => entry.key === issue.key);
      const textLike = row.kind === 'text' || row.kind === 'textarea';
      if (ours !== undefined && textLike && revert(env, fresh, ours)) {
        reverted.add(issue.key);
        out.set(issue.key, settleRow(row, { kind: 'blocked', reason: issue.reason }));
      } else {
        // A choice is never unticked or deselected: it stays, blocked, for the person to remove.
        if (!textLike) removeSelection.add(issue.key);
        out.set(issue.key, { ...row, status: 'blocked', reason: issue.reason, needsUserAction: true });
      }
      continue;
    }
    if (issue.reason === 'llm-draft-needs-confirmation' && row.status !== 'blocked') {
      out.set(issue.key, { ...row, status: 'flagged', reason: issue.reason, needsUserAction: true });
    }
  }
  return { rows: out, removeSelection, reverted };
}
