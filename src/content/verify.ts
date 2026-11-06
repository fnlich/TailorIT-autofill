/*
 * After the pass's settle (docs/ARCHITECTURE.md "Filler › Statuses", "Orchestrator › Before ready"):
 * - verifyWritten: each written field is found again by key in a fresh scan and read back (verifyAfterSettle: digits
 *   for phones, case-folded email, the option's identity, the file's name and size, no aria-invalid). A multi-select's
 *   selection must also be exactly what it held before plus what we added (verifyOptionsWrite): a missing option is
 *   verify-mismatch, one the site added is unexpected-selection, and nothing is ever unticked. A field that is gone is
 *   field-disappeared; a list whose options changed during the settle is found by its base key (LC-9), and its
 *   planned option read back at its place in the list as it is now: the one option that shows exactly the label it
 *   showed at the write (Ashby's start year, whose years end at the end year chosen after it). A file input that read
 *   back our file at the fill and is empty now was emptied by its upload widget, which took the file: verified, and
 *   never written again (the Phase 3 review, LC-3; a widget's text chips that clear themselves are Phase 4's). A file
 *   whose page says its upload failed (Adapter.uploadState, waited for at the write and read again now) is
 *   upload-failed, one it never showed done upload-not-confirmed: written, never verified. One still pending at the
 *   write that the page shows done by the read-back is read back as any file is (the audit of 2026-11-06, m2).
 * - finalGuard: guardReady reads back every value in the form, ours and the person's own alike, before the run says it
 *   is ready for review. A value holding a canary that we wrote is blocked: a text is set back to what it held before
 *   our write (a write with provenance rule guard.revert, through both Guards, cleared to empty if that earlier value
 *   holds a canary too, and read back exactly), and a choice keeps its selection, blocked, for the person to remove
 *   (the review's row says so; nothing is drawn on the page). Both rows are settleRow's blocked row (no provenance,
 *   nothing verified), whatever the revert did.
 *   A value the person typed, or the page prefilled, is only flagged, never overwritten. An unconfirmed draft is
 *   flagged; one the person confirmed (Phase 6: FinalGuardEnv.confirmedDrafts) reads back as confirmed.
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
import { shownIdentity } from '../dom/widgets/options';
import { mismatchRow, selectedOf, uploadRow, type WrittenField } from './pass';

/** Reasons the final Guard gives a value holding a canary. */
const CANARY_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['canary-in-value', 'canary-equals-profile-value']);

/** A written field's row after the settle, from a fresh scan. */
export function verifyWritten(fresh: ScanResult, written: WrittenField): FillResult {
  if (written.value.kind === 'file' && written.upload !== null) {
    const now = written.uploadNow?.() ?? written.upload;
    if (written.upload === 'failed' || now === 'failed') return uploadRow(written.planned, 'failed');
    // Pending at the write and shown done since (the audit of 2026-11-06, m2): read back as any file is, below.
    if (written.upload === 'pending' && now !== 'confirmed') return uploadRow(written.planned, 'pending');
  }
  if (written.value.kind === 'file' && written.readBackVerified) {
    // Upload widgets empty their input once they have the file: the upload taken, not a mismatch (LC-3).
    const now = fresh.target(written.key)?.field.current;
    if (now !== undefined && (now.kind === 'empty' || (now.kind === 'files' && now.count === 0))) {
      return settleRow(written.planned, { kind: 'verified' });
    }
  }
  const options = { ...(written.rule ? { rule: written.rule } : {}), ...(written.file ? { file: written.file } : {}) };
  // A list whose options changed during the settle has a new key: it is the same field by its base key, and the
  // read-back checks the chosen option's place and label (LC-9).
  const key = fresh.target(written.key) !== null ? written.key
    : fresh.fields.find((field) => field.baseKey === written.field.baseKey)?.key ?? written.key;
  const verdict = verifyAfterSettle(fresh, key, movedOption(fresh, key, written), options);
  if (verdict.verification === 'verified') {
    if (written.value.kind === 'options') {
      const after = selectedOf(fresh.target(key)?.field);
      const check = verifyOptionsWrite(written.selectedBefore, written.value.indices, after);
      if (!check.ok) return mismatchRow(written.planned, check.reason);
    }
    return settleRow(written.planned, { kind: 'verified' });
  }
  if (verdict.verification === 'mismatch') return mismatchRow(written.planned, verdict.reason);
  return { ...settleRow(written.planned, { kind: 'mismatch' }), reason: 'field-disappeared',
    verification: 'not-checked' };
}

/** A native list's single write as it reads back in the list as it is now: when the list's options changed during the
 *  settle (a new key), its planned option is at the place of the one option that shows exactly the label it showed at
 *  the write; the write as it was otherwise (no such option, or two). */
function movedOption(fresh: ScanResult, key: FieldKey, written: WrittenField): WrittenField['value'] {
  const value = written.value;
  if (key === written.key || value.kind !== 'option' || written.optionShown === null) return value;
  const options = fresh.target(key)?.field.options;
  if (options === undefined || options === 'lazy') return value;
  const shown = shownIdentity(written.optionShown);
  const places = options.flatMap((option, index) => (shownIdentity(option.label) === shown ? [index] : []));
  return places.length === 1 ? { ...value, index: places[0]! } : value;
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
  /** Every canary the frame holds in memory (tripwire.allCanaries), not only the 32 that are sent (CORE-15). */
  canaries: readonly string[];
  /** The drafts the person confirmed, by their key now (Phase 6): guardReady reads them as confirmed. */
  confirmedDrafts?: ReadonlySet<FieldKey>;
}

/** The final Guard's result: the rows it changed. */
export interface FinalGuardResult {
  rows: Map<FieldKey, FillResult>;
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
  // Read back exactly: under the field's own rule an empty phone or number never reads as equal to empty (DOM-14).
  return fill(verdict.target, write.value, { adapter: env.adapter, root: env.root, readBack: 'exact' })
    .verification === 'verified';
}

/** The final Guard over a fresh scan (guardReady), applied to the rows. */
export function finalGuard(env: FinalGuardEnv, fresh: ScanResult, rows: Map<FieldKey, FillResult>,
  written: readonly WrittenField[]): FinalGuardResult {
  const out = new Map(rows);
  const reverted = new Set<FieldKey>();
  const readBack: ReadBackValue[] = [];
  for (const field of fresh.fields) {
    const row = out.get(field.key);
    const provenance = row !== undefined && row.wrote ? row.provenance : null;
    // A draft the person confirmed, or one accepted as written (the owner's amendments: llm-draft-written).
    const confirmed = provenance === 'llm-draft' && (env.confirmedDrafts?.has(field.key) === true
      || row?.reason === 'llm-draft-written');
    for (const text of readBackTexts(field)) {
      readBack.push({ key: field.key, provenance, text, ...(confirmed ? { draftConfirmed: true } : {}) });
    }
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
      // A choice is never unticked or deselected: it stays, blocked, for the person to remove.
      if (ours !== undefined && textLike && revert(env, fresh, ours)) reverted.add(issue.key);
      // Either way the row is the blocked one settleRow makes: never verified, with no provenance (DOM-14).
      out.set(issue.key, settleRow(row, { kind: 'blocked', reason: issue.reason }));
      continue;
    }
    if (issue.reason === 'llm-draft-needs-confirmation' && row.status !== 'blocked') {
      out.set(issue.key, { ...row, status: 'flagged', reason: issue.reason, needsUserAction: true });
    }
  }
  return { rows: out, reverted };
}
