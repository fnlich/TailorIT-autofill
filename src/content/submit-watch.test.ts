/*
 * The audit of 2026-11-06 (m10): the form's own document watches for its platform's sign, quietly, for as long as the
 * worker keeps the tab's arm, so a sign it still sees is one the worker still takes.
 */
import { describe, expect, it } from 'vitest';
import { SUBMIT_ARM_MS } from '../background/submissions';
import { SUBMIT_CONFIRM_MS, SUBMIT_WATCH_MS } from './submitted';

describe('the Submit watch', () => {
  it('lasts as long as the worker’s arm, past the review’s wait', () => {
    expect(SUBMIT_WATCH_MS).toBe(SUBMIT_ARM_MS);
    expect(SUBMIT_WATCH_MS).toBeGreaterThan(SUBMIT_CONFIRM_MS);
  });
});
