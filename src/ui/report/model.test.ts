import { describe, expect, it } from 'vitest';
import type { FrameReport } from '../../shared/report';
import {
  awaitsDraftConfirmation, combinedNotices, framesAtPolicyCard, offersSave, overallStatus, percent, policyFromStoredCopy,
  sectionsOf, stepText, type ReportRow,
} from './model';

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

describe('the report model (Phase 6)', () => {
  const flagged = (overrides: Partial<ReportRow> = {}): ReportRow => ({ ...row('k', 'Contact'), status: 'flagged',
    category: 'screening.other', needsUserAction: true, detail: { userEdited: true }, ...overrides });

  it('reads a step as the adapter’s progress line where the report has one, else by its number', () => {
    expect(stepText({ index: 1, progress: 'Step 2 of 4: Experience' })).toBe('Step 2 of 4: Experience');
    expect(stepText({ index: 1 })).toBe('Step 2');
    expect(stepText({ index: 0, of: 6 })).toBe('Step 1 of 6');
  });

  it('offers Save my answer only on a flagged field the person changed, of a kind a saved answer may answer', () => {
    expect(offersSave(flagged())).toBe(true);
    expect(offersSave(flagged({ category: 'freeText.whyCompany', kind: 'textarea' }))).toBe(true);
    expect(offersSave(flagged({ detail: {} }))).toBe(false);
    expect(offersSave(flagged({ status: 'verified' }))).toBe(false);
    expect(offersSave(flagged({ status: 'blocked' }))).toBe(false);
    for (const category of ['eeo.gender', 'workAuth.sponsorship', 'consent.privacy', 'attentionCheck', 'file.resume'] as const) {
      expect(offersSave(flagged({ category })), category).toBe(false);
    }
    expect(offersSave(flagged({ kind: 'file' }))).toBe(false);
  });

  it('knows an AI draft that waits for the person, and a policy notice from the saved copy alone', () => {
    expect(awaitsDraftConfirmation({ ...row('d', ''), provenance: 'llm-draft', needsUserAction: true })).toBe(true);
    expect(awaitsDraftConfirmation({ ...row('d', ''), provenance: 'llm-draft', needsUserAction: false })).toBe(false);
    expect(awaitsDraftConfirmation({ ...row('d', ''), provenance: 'profile', needsUserAction: true })).toBe(false);
    expect(policyFromStoredCopy(report(0, { notices: [{ code: 'policy' }, { code: 'policy-stored-copy' }] }))).toBe(true);
    expect(policyFromStoredCopy(report(0, { notices: [{ code: 'policy' }] }))).toBe(false);
    // The stored-copy line is said under the policy notice, never as one of its own.
    expect(combinedNotices([report(0, { notices: [{ code: 'policy' }, { code: 'policy-stored-copy' }] })])).toEqual(['policy']);
  });
});
