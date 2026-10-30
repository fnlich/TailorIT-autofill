/*
 * Verifying a multi-select after the fill (docs/design/core.md §9 step 7; Requirement B: "Verify the final selected
 * set after filling"). The selection read back must be exactly what the plan expected: an option missing from it means
 * the site dropped or ignored a click (verify-mismatch), and one that appeared unplanned means the site toggled
 * something (unexpected-selection, flagged, never unticked). It works on option indices, which the frame scanned and
 * the plan names, so the content script can check its own write without the worker: what was selected before plus
 * what it added.
 */
import type { ReasonCode } from '../types/fill';

/** What the read-back selection says about a multi-select write. */
export interface MultiSelectCheck {
  ok: boolean;
  /** Expected and not selected. */
  missing: number[];
  /** Selected and not expected. */
  unexpected: number[];
  /** 'ok', 'verify-mismatch' when something is missing, else 'unexpected-selection'. */
  reason: ReasonCode;
}

/** Compares the selection read back with the expected final set (MultiSelectPlan.expectedFinal). */
export function verifyMultiSelect(expectedFinal: Iterable<number>, after: Iterable<number>): MultiSelectCheck {
  const expected = new Set(expectedFinal);
  const actual = new Set(after);
  const missing = [...expected].filter((index) => !actual.has(index)).sort((a, b) => a - b);
  const unexpected = [...actual].filter((index) => !expected.has(index)).sort((a, b) => a - b);
  const reason: ReasonCode = missing.length > 0 ? 'verify-mismatch' : unexpected.length > 0 ? 'unexpected-selection' : 'ok';
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected, reason };
}

/** The frame's own check of an options write: the selection before it plus the indices it added must be exactly the
 *  selection after. */
export function verifyOptionsWrite(before: Iterable<number>, added: Iterable<number>, after: Iterable<number>):
  MultiSelectCheck {
  return verifyMultiSelect([...before, ...added], after);
}
