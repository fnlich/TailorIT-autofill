/*
 * Building a filler's outcome (types.ts, FillOutcome). Three shapes: done (verified, written or already right),
 * mismatch (written, reads back differently) and refused (nothing written, with the reason). needs-your-click always
 * asks the person to act.
 */
import type { FillOutcome, FillOutcomeReason } from '../types';

/** Verified: written now (`wrote`) or already right. */
export function done(wrote: boolean, reason: Extract<FillOutcomeReason, 'ok' | 'already-correct'>): FillOutcome {
  return { wrote, verification: 'verified', reason, needsUserAction: false };
}

/** Written, but it reads back differently: the row is filled, not verified. */
export function mismatch(reason: Extract<FillOutcomeReason, 'verify-mismatch' | 'unexpected-selection'
  | 'value-rejected-by-site'>): FillOutcome {
  return { wrote: true, verification: 'mismatch', reason, needsUserAction: false };
}

/** Nothing was written. needs-your-click (the page ignored our events, or a click was refused) asks the person. */
export function refused(reason: FillOutcomeReason): FillOutcome {
  return { wrote: false, verification: 'not-checked', reason, needsUserAction: reason === 'needs-your-click' };
}
