/*
 * The progress rule (v3 Phase 3, src/shared/report.ts progressOf): one rule for the side panel, the in-page panel and
 * the launcher's badge. The percent is the required rows filled of the required rows counted, or of every counted row
 * when none is required; a row the run still writes counts and is not filled; a row left alone needing nothing does
 * not count; rounded down, so 100% means every one is filled.
 */
import { describe, expect, it } from 'vitest';
import { progressStateOf } from '../ui/report/model';
import { frameReport, row } from '../ui/ui.testkit';
import { isReady, progressOf, rowProgressOf } from './report';

const filled = (key: string, required = true) => row(key, { required });
const missing = (key: string, required = true) => row(key, { required, status: 'flagged', provenance: null,
  reason: 'no-profile-value', wrote: false, verification: 'not-applicable', needsUserAction: true });
const leftAlone = (key: string, required = false) => row(key, { required, status: 'skipped', provenance: null,
  reason: 'consent-optional-unticked', wrote: false, verification: 'not-applicable' });
const planned = (key: string, required = true) => row(key, { required, wrote: false, verification: 'not-checked' });

describe('the progress rule', () => {
  it('counts the required rows filled of the required rows, Jobright’s "9 of 12 required fields filled · 75%"', () => {
    const fields = [...Array.from({ length: 9 }, (_, at) => filled(`f${at}`)), missing('m1'), missing('m2'), missing('m3'),
      filled('optional', false), leftAlone('marketing')];
    expect(progressOf([frameReport(0, { fields })])).toEqual({ filled: 9, of: 12, requiredOnly: true, percent: 75 });
  });

  it('counts every row when none is required ("fields filled"), and leaves out a question left alone that needed nothing', () => {
    expect(progressOf([frameReport(0, { fields: [filled('a', false), missing('b', false), leftAlone('c')] })]))
      .toEqual({ filled: 1, of: 2, requiredOnly: false, percent: 50 });
    expect(progressOf([frameReport(0, { fields: [leftAlone('c')] })])).toEqual({ filled: 0, of: 0, requiredOnly: false,
      percent: 0 });
    expect(progressOf([])).toEqual({ filled: 0, of: 0, requiredOnly: false, percent: 0 });
  });

  it('rounds down, so 100% means every required field is filled', () => {
    const fields = [...Array.from({ length: 199 }, (_, at) => filled(`f${at}`)), missing('last')];
    expect(progressOf([frameReport(0, { fields })]).percent).toBe(99);
    expect(progressOf([frameReport(0, { fields: [filled('only')] })]).percent).toBe(100);
  });

  it('counts a row the run still writes as not filled: the field written now and those to come (`filling`)', () => {
    const fields = [filled('done'), planned('now'), planned('next'), missing('left')];
    const report = frameReport(0, { status: 'fill-step', fields, filling: { current: 'now', pending: ['now', 'next'] } });
    expect(progressOf([report])).toEqual({ filled: 1, of: 4, requiredOnly: true, percent: 25 });
    expect(fields.map((each) => rowProgressOf(each, report.filling))).toEqual(['working', 'working', 'working', 'missing']
      .map((state, at) => (at === 0 ? 'filled' : state)));
    // Once written, the same row is filled: the rule reads the rows, never a value.
    expect(progressOf([frameReport(0, { fields: [filled('done'), filled('now'), planned('next'), missing('left')],
      filling: { current: 'next', pending: ['next'] } })]).filled).toBe(2);
  });

  it('counts a row waiting for the AI as being filled while the run lists it as to come, never as left for the person', () => {
    // The row that stands until the AI's answer: blank and flagged (core/plan/frame.ts). The loop lists the fields
    // waiting for the AI, or for a list's options, among those still to come (v3 Phase 3 review).
    const waiting = missing('source');
    const report = frameReport(0, { status: 'fill-step', fields: [filled('first'), waiting],
      filling: { current: null, pending: ['source'] } });
    expect(rowProgressOf(waiting, report.filling)).toBe('working');
    expect(progressOf([report])).toEqual({ filled: 1, of: 2, requiredOnly: true, percent: 50 });
    expect(progressStateOf([report])).toBe('filling');
  });

  it('reads a run resting at wait-transition, waiting for the person’s own Next, as at rest (resting)', () => {
    const resting = frameReport(0, { status: 'wait-transition', fields: [filled('a'), missing('b')], resting: true });
    expect(progressStateOf([resting])).toBe('rest');
    const { resting: _, ...moving } = resting;
    expect(progressStateOf([moving])).toBe('filling');
  });

  it('adds up every frame of the tab, each by its own live progress', () => {
    const top = frameReport(0, { fields: [filled('a'), missing('b')] });
    const embedded = frameReport(3, { status: 'fill-step', fields: [planned('a'), filled('c')],
      filling: { current: 'a', pending: ['a'] } });
    expect(progressOf([top, embedded])).toEqual({ filled: 2, of: 4, requiredOnly: true, percent: 50 });
  });

  it('treats a flagged row whose value was written as filled: it only says "check it" (SPEC-AMENDMENTS §11)', () => {
    const checkIt = row('phone', { required: true, status: 'flagged', reason: 'filled-low-confidence', wrote: true });
    expect([isReady(checkIt), rowProgressOf(checkIt)]).toEqual([true, 'filled']);
    const draftWaiting = row('why', { required: true, status: 'flagged', provenance: 'llm-draft',
      reason: 'llm-draft-needs-confirmation', wrote: true, needsUserAction: true });
    expect([isReady(draftWaiting), rowProgressOf(draftWaiting)]).toEqual([false, 'missing']);
  });

  it('says where the progress stands: nothing yet, scanning, filling or at rest', () => {
    expect(progressStateOf([])).toBe('empty');
    expect(progressStateOf([frameReport(0, { status: 'scan-step', filling: { current: null, pending: [] } })])).toBe('scanning');
    expect(progressStateOf([frameReport(0, { status: 'fill-step', fields: [planned('a')],
      filling: { current: 'a', pending: ['a'] } })])).toBe('filling');
    expect(progressStateOf([frameReport(0, { fields: [filled('a')] })])).toBe('rest');
    // One frame at work makes the tab's progress work.
    expect(progressStateOf([frameReport(0, { fields: [filled('a')] }), frameReport(2, { status: 'detect' })])).toBe('filling');
  });
});
