import { describe, expect, it } from 'vitest';
import { verifyMultiSelect, verifyOptionsWrite } from './verify';

describe('verifyMultiSelect (§9 step 7)', () => {
  it('passes a selection that is exactly the expected one', () => {
    expect(verifyMultiSelect([0, 2, 4], [4, 2, 0])).toEqual({ ok: true, missing: [], unexpected: [], reason: 'ok' });
  });

  it('names what the site dropped and what it toggled on its own', () => {
    expect(verifyMultiSelect([0, 2, 4], [0, 4])).toEqual({ ok: false, missing: [2], unexpected: [],
      reason: 'verify-mismatch' });
    expect(verifyMultiSelect([0, 2], [0, 2, 7])).toEqual({ ok: false, missing: [], unexpected: [7],
      reason: 'unexpected-selection' });
  });

  it('lets the frame check its own write: what was selected before plus what it added', () => {
    expect(verifyOptionsWrite([2], [0, 4], [0, 2, 4]).ok).toBe(true);
    expect(verifyOptionsWrite([2], [0, 4], [0, 4])).toMatchObject({ ok: false, missing: [2] });
  });
});
