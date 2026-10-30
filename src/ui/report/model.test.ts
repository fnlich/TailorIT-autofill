import { describe, expect, it } from 'vitest';
import type { FrameReport } from '../../shared/report';
import { combinedNotices, framesAtPolicyCard, overallStatus, percent, sectionsOf, type ReportRow } from './model';

function row(key: string, section: string): ReportRow {
  return { key, label: key, kind: 'text', category: 'unknown', section, required: false, status: 'skipped', provenance: null,
    matcherStage: 'not-applicable', confidence: 0, reason: 'no-profile-value', wrote: false, verification: 'not-applicable',
    needsUserAction: false };
}

function report(frameId: number, overrides: Partial<FrameReport> = {}): FrameReport {
  return { v: 1, runId: `run-${frameId}`, frameId, platform: 'lever', adapter: 'lever', mode: 'fill', status: 'review',
    pauseReason: null, fields: [], notices: [], counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 },
    updatedAt: 0, ...overrides };
}

describe('the report model', () => {
  it("lists every frame's notices once each, the plan's three sentences first", () => {
    const reports = [
      report(0, { notices: [{ code: 'validation' }, { code: 'tripwire', count: 2 }] }),
      report(3, { notices: [{ code: 'policy-unreadable' }, { code: 'tripwire' }] }),
    ];
    expect(combinedNotices(reports)).toEqual(['tripwire', 'policy-unreadable', 'validation']);
    expect(combinedNotices([])).toEqual([]);
  });

  it('groups a frame\'s rows by section, in the order the sections first appear', () => {
    const rows = [row('a', 'Contact'), row('b', 'Education'), row('c', 'Contact'), row('d', '')];
    expect(sectionsOf(rows).map(({ section, rows: list }) => [section, list.map((each) => each.key)]))
      .toEqual([['Contact', ['a', 'c']], ['Education', ['b']], ['', ['d']]]);
  });

  it('finds the status that most needs the person, and the policy decision a run waits for', () => {
    expect(overallStatus([])).toBeNull();
    expect(overallStatus([report(0, { status: 'review' }), report(2, { status: 'fill-step' })])).toBe('fill-step');
    expect(overallStatus([report(0, { status: 'handoff', pauseReason: 'captcha' }), report(2, { status: 'policy-notice' })]))
      .toBe('policy-notice');
    // Each frame that waits at the policy card, by frame id: a CAPTCHA pause beside one is not one of them.
    expect(framesAtPolicyCard([report(3, { status: 'policy-notice' }), report(0, { status: 'handoff', pauseReason: 'captcha' }),
      report(2, { status: 'policy-notice' })]).map((each) => each.frameId)).toEqual([2, 3]);
    expect(framesAtPolicyCard([report(0)])).toEqual([]);
  });

  it('shows a confidence as a whole percent, inside 0 to 100', () => {
    expect([percent(0), percent(0.854), percent(1), percent(1.2), percent(-1)]).toEqual(['0%', '85%', '100%', '100%', '0%']);
  });
});
