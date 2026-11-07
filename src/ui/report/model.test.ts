import { describe, expect, it } from 'vitest';
import type { FrameReport } from '../../shared/report';
import {
  awaitsDraftConfirmation, combinedNotices, framesAtPolicyCard, isReady, needsPerson, offersSave, overallStatus, percent,
  policyFromStoredCopy, rowIconOf, sectionsOf, shownReports, fieldListsOf, stepText, stripToneOf, tallyOf, type ReportRow,
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

describe('the report model (the completion)', () => {
  let made = 0;
  const at = (status: ReportRow['status'], overrides: Partial<ReportRow> = {}): ReportRow => {
    made += 1;
    return { ...row(`${status}-${made}`, 'Contact'), status, ...overrides };
  };

  it('needs the person for a flagged, blocked or asking row, whatever its status', () => {
    expect(needsPerson(at('flagged'))).toBe(true);
    // A blocked row may come without needsUserAction (core/plan/frame.ts): it still needs the person.
    expect(needsPerson(at('blocked', { needsUserAction: false }))).toBe(true);
    expect(needsPerson(at('filled', { provenance: 'llm-draft', needsUserAction: true }))).toBe(true);
    expect(needsPerson(at('verified'))).toBe(false);
    expect(needsPerson(at('skipped'))).toBe(false);
    expect([rowIconOf(at('flagged')), rowIconOf(at('blocked')), rowIconOf(at('verified')), rowIconOf(at('filled')),
      rowIconOf(at('skipped')), rowIconOf(at('skipped', { reason: 'already-correct' }))])
      .toEqual(['alert', 'x-circle', 'check-circle', 'check', 'minus-circle', 'check']);
  });

  it('counts ready, needing and required rows across frames; a field that held its answer is ready', () => {
    const reports = [
      report(0, { fields: [at('verified', { required: true }), at('filled'), at('flagged', { required: true, needsUserAction: true }),
        at('skipped', { reason: 'already-correct', required: true }), at('skipped')] }),
      report(4, { mode: 'fill', status: 'fill-step', fields: [at('blocked'), at('skipped', { reason: 'end-date-not-applicable' })] }),
    ];
    expect(isReady(at('skipped', { reason: 'already-correct' }))).toBe(true);
    expect(isReady(at('verified', { needsUserAction: true }))).toBe(false);
    expect(tallyOf(reports)).toEqual({
      byStatus: { verified: 1, filled: 1, skipped: 3, flagged: 1, blocked: 1 },
      ready: 4,
      needsYou: 2,
      required: { ready: 2, of: 3 },
      dryRun: false,
      working: true,
    });
    expect(tallyOf([report(0, { mode: 'dry-run', fields: [at('verified')] })])).toMatchObject({ dryRun: true, working: false });
  });

  it('has no tally without a row', () => {
    expect(tallyOf([])).toBeNull();
    expect(tallyOf([report(0), report(2)])).toBeNull();
  });

  it('tones the strip by run status and what needs the person', () => {
    expect(['detect', 'fill-step', 'wait-transition'].map((status) => stripToneOf(status as never, 0)))
      .toEqual(['working', 'working', 'working']);
    expect([stripToneOf('policy-notice', 0), stripToneOf('auth-needed', 0), stripToneOf('handoff', 0)])
      .toEqual(['attention', 'attention', 'attention']);
    expect([stripToneOf('review', 2), stripToneOf('review', 0), stripToneOf('done', 0), stripToneOf('stopped', 3)])
      .toEqual(['attention', 'done', 'done', 'neutral']);
  });
});

describe('the report model (v4 ui, D8)', () => {
  it('leaves blocked rows out of what the person is shown and counted, and passes a report with none as it is', () => {
    const blocked = { ...row('trap', 'Contact'), status: 'blocked' as const, required: true };
    const kept = { ...row('name', 'Contact'), status: 'verified' as const, wrote: true, required: true };
    const clean = report(2, { fields: [kept] });
    const shown = shownReports([report(0, { fields: [kept, blocked] }), clean]);
    expect(shown.map((each) => each.fields.map((field) => field.key))).toEqual([['name'], ['name']]);
    expect(shown[1]).toBe(clean);
    expect(fieldListsOf([report(0, { fields: [kept, blocked] })]).required.map((entry) => entry.row.key)).toEqual(['name']);
  });
});
