import { describe, expect, it } from 'vitest';
import type { FieldKey } from '../types/field';
import type { FillResult } from '../types/fill';
import { settleRow, STATUS_PRECEDENCE, strongerStatus } from './settle';

/** A planned row, as planFrame gives it to a field with a write. */
const planned = (status: 'verified' | 'flagged', extra: Partial<FillResult> = {}): FillResult => ({
  key: 'lever|main|email|none|0' as FieldKey, label: 'Email', kind: 'text', category: 'contact.email', section: 'main',
  required: true, status, provenance: 'profile', matcherStage: 'not-applicable', confidence: 0.99,
  reason: status === 'verified' ? 'ok' : 'filled-low-confidence', wrote: false, verification: 'not-checked',
  needsUserAction: status === 'flagged', ...extra,
});

describe('the status precedence', () => {
  it('is blocked > flagged > verified > filled > skipped', () => {
    expect(STATUS_PRECEDENCE).toEqual(['blocked', 'flagged', 'verified', 'filled', 'skipped']);
    expect(strongerStatus('verified', 'filled')).toBe('verified');
    expect(strongerStatus('skipped', 'blocked')).toBe('blocked');
    expect(strongerStatus('flagged', 'verified')).toBe('flagged');
  });
});

describe('settleRow', () => {
  it('marks a value that read back as planned verified, and keeps a fill-and-flag row flagged', () => {
    expect(settleRow(planned('verified'), { kind: 'verified' })).toMatchObject({ status: 'verified', wrote: true,
      verification: 'verified', provenance: 'profile', reason: 'ok', needsUserAction: false });
    expect(settleRow(planned('flagged'), { kind: 'verified' })).toMatchObject({ status: 'flagged', wrote: true,
      verification: 'verified', reason: 'filled-low-confidence', needsUserAction: true });
  });

  it('marks a value that read back differently filled, flagged staying flagged, for the person to check', () => {
    expect(settleRow(planned('verified'), { kind: 'mismatch' })).toMatchObject({ status: 'filled', wrote: true,
      verification: 'mismatch', reason: 'verify-mismatch', provenance: 'profile', needsUserAction: true });
    expect(settleRow(planned('flagged'), { kind: 'mismatch' })).toMatchObject({ status: 'flagged',
      verification: 'mismatch' });
  });

  it('blocks a write the DOM check refused, with nothing written and no provenance', () => {
    expect(settleRow(planned('verified'), { kind: 'blocked', reason: 'canary-in-value' })).toMatchObject({
      status: 'blocked', reason: 'canary-in-value', wrote: false, provenance: null, verification: 'not-applicable',
      needsUserAction: true });
  });

  it('flags a write that could not happen, with its reason', () => {
    for (const reason of ['needs-your-click', 'element-not-found', 'resume-transfer-failed'] as const) {
      expect(settleRow(planned('verified'), { kind: 'not-written', reason }), reason).toMatchObject({ status: 'flagged',
        reason, wrote: false, provenance: null, verification: 'not-applicable', needsUserAction: true });
    }
    expect(settleRow(planned('verified', { status: 'blocked' as never }), { kind: 'not-written',
      reason: 'needs-your-click' }).status).toBe('blocked');
  });

  it('keeps a dry run’s row as the status the fill would produce, written by nobody', () => {
    expect(settleRow(planned('verified'), { kind: 'dry-run' })).toEqual(planned('verified'));
    expect(settleRow(planned('flagged'), { kind: 'dry-run' })).toMatchObject({ status: 'flagged', wrote: false,
      verification: 'not-checked', provenance: 'profile', needsUserAction: true });
  });
});
