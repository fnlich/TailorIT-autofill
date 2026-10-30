/*
 * settleRow: the content script's last word on a field's row after it has tried to fill it (docs/ARCHITECTURE.md
 * "Filler" › Statuses, and the status rules of docs/design/core.md §2.5). planFrame gives each planned write the row its
 * fill produces when the value reads back as planned (wrote false, verification 'not-checked'); after the fill and the
 * pass's settle, the content script settles that row from what happened, with no profile and no value:
 * - verified: written and read back equivalent. The row keeps its status, so a fill-and-flag field that read back
 *   correctly stays flagged (wrote true, verification 'verified');
 * - mismatch: written, but it reads back differently: 'filled' (flagged stays flagged), verify-mismatch;
 * - blocked: the DOM check refused the write (not visible any more, a canary, its provenance): blocked, nothing
 *   written;
 * - not-written: the write could not happen (needs-your-click, element-not-found, disabled-or-readonly,
 *   value-rejected-by-site, resume-unavailable, ...): flagged, nothing written;
 * - dry-run: nothing is written by design; the row is the status the fill would produce, wrote false and verification
 *   'not-checked'.
 * When several statuses apply, the stronger wins: blocked > flagged > verified > filled > skipped. Provenance is null
 * exactly when nothing was written (a dry run's rows keep the planned one, which is the point of the dry run), and a
 * row needs the person's action when it is flagged, blocked, or filled with a value that did not stick.
 */
import { FILL_STATUSES, type FillStatus } from '../enums';
import type { FillResult, ReasonCode } from '../types/fill';

/** How a planned write ended, as the content script saw it. */
export type FillOutcome =
  | { kind: 'verified' }
  | { kind: 'mismatch' }
  | { kind: 'blocked'; reason: ReasonCode }
  | { kind: 'not-written'; reason: ReasonCode }
  | { kind: 'dry-run' };

/** The statuses from the weakest to the strongest: skipped < filled < verified < flagged < blocked. */
const STATUS_RANK: Readonly<Record<FillStatus, number>> = { skipped: 0, filled: 1, verified: 2, flagged: 3, blocked: 4 };

/** The stronger of two statuses (blocked > flagged > verified > filled > skipped). */
export function strongerStatus(a: FillStatus, b: FillStatus): FillStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** The statuses in precedence order, strongest first. */
export const STATUS_PRECEDENCE: readonly FillStatus[] = [...FILL_STATUSES].sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a]);

/** A field's row once its fill has happened (or a dry run skipped it). `planned` is planFrame's row for the field. */
export function settleRow(planned: FillResult, outcome: FillOutcome): FillResult {
  switch (outcome.kind) {
    case 'verified': {
      const status = strongerStatus(planned.status, 'verified');
      return { ...planned, status, wrote: true, verification: 'verified',
        needsUserAction: status === 'flagged' || status === 'blocked' };
    }
    case 'mismatch': {
      // A row planned as verified becomes filled; flagged and blocked are stronger and stay.
      const status = planned.status === 'verified' ? 'filled' : strongerStatus(planned.status, 'filled');
      return { ...planned, status, reason: 'verify-mismatch', wrote: true, verification: 'mismatch',
        needsUserAction: true };
    }
    case 'blocked':
      return { ...planned, status: 'blocked', provenance: null, reason: outcome.reason, wrote: false,
        verification: 'not-applicable', needsUserAction: true };
    case 'not-written': {
      const status: FillStatus = planned.status === 'blocked' ? 'blocked' : 'flagged';
      return { ...planned, status, provenance: null, reason: outcome.reason, wrote: false,
        verification: 'not-applicable', needsUserAction: true };
    }
    case 'dry-run':
      return { ...planned, wrote: false, verification: 'not-checked',
        needsUserAction: planned.status === 'flagged' || planned.status === 'blocked' };
  }
}
