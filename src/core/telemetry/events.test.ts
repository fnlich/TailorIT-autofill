import { describe, expect, it } from 'vitest';
import { FIELD_KINDS, MATCHER_STAGES, PLATFORMS } from '../enums';
import type { FillResult } from '../types/fill';
import {
  addEvents, isTelemetryCount, isTelemetryEvent, MAX_TELEMETRY_COUNTS, outcomeOf, TELEMETRY_FIELDS, telemetryEventsOf,
} from './events';

/** A full report row, carrying everything a row may carry: only three of its fields may reach an event. */
function row(overrides: Partial<FillResult> = {}): FillResult {
  return {
    key: 'lever|contact|email|none|0' as FillResult['key'], label: 'Email', kind: 'text', category: 'contact.email',
    section: 'contact', required: true, status: 'verified', provenance: 'profile', matcherStage: 'not-applicable',
    confidence: 1, reason: 'ok', wrote: true, verification: 'verified', needsUserAction: false,
    detail: { suggestions: [{ index: 2, score: 0.9 }] },
    ...overrides,
  };
}

describe('the anonymous counters', () => {
  it('derive exactly the five fields from a row, and nothing else it carries', () => {
    const events = telemetryEventsOf({ platform: 'lever', tripwireTriggered: true, rows: [
      row(),
      row({ kind: 'select', matcherStage: 'alias', status: 'flagged', reason: 'filled-low-confidence' }),
    ] });
    expect(events).toEqual([
      { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: true },
      { platform: 'lever', fieldKind: 'select', matcherStage: 'alias', outcome: 'fail', tripwireTriggered: true },
    ]);
    for (const event of events) expect(Object.keys(event).sort()).toEqual([...TELEMETRY_FIELDS].sort());
    const text = JSON.stringify(events);
    for (const carried of ['Email', 'email', 'key', 'label', 'section', 'category', 'reason', 'provenance', 'confidence',
      'suggestions', '0.9', 'required', 'wrote']) {
      expect(text, carried).not.toContain(carried);
    }
  });

  it('count a written field as a success, one left for the person as a fail, and a skipped one not at all', () => {
    expect([outcomeOf('filled'), outcomeOf('verified'), outcomeOf('flagged'), outcomeOf('blocked'), outcomeOf('skipped')])
      .toEqual(['success', 'success', 'fail', 'fail', null]);
    expect(telemetryEventsOf({ platform: 'greenhouse', tripwireTriggered: false,
      rows: [row({ status: 'skipped', reason: 'no-profile-value' })] })).toEqual([]);
  });

  it('accept an event only with exactly the five fields, each in its closed list', () => {
    const event = { platform: 'ashby', fieldKind: 'radio', matcherStage: 'exact', outcome: 'success', tripwireTriggered: false };
    expect(isTelemetryEvent(event)).toBe(true);
    expect(isTelemetryEvent({ ...event, v: 1 })).toBe(false);
    expect(isTelemetryEvent({ ...event, label: 'Email' })).toBe(false);
    expect(isTelemetryEvent({ ...event, platform: 'workable' })).toBe(false);
    expect(isTelemetryEvent({ ...event, fieldKind: 'password' })).toBe(false);
    expect(isTelemetryEvent({ ...event, outcome: 'maybe' })).toBe(false);
    expect(isTelemetryEvent({ ...event, tripwireTriggered: 'no' })).toBe(false);
    const { matcherStage: _dropped, ...four } = event;
    expect(isTelemetryEvent(four)).toBe(false);
    expect(isTelemetryEvent(null)).toBe(false);
    expect(isTelemetryEvent([event])).toBe(false);
    expect(isTelemetryCount({ ...event, count: 3 })).toBe(true);
    expect(isTelemetryCount({ ...event, count: 0 })).toBe(false);
    expect(isTelemetryCount({ ...event, count: 1.5 })).toBe(false);
    expect(isTelemetryCount({ ...event, count: 2, note: 'x' })).toBe(false);
  });

  it('add up one entry per combination, in a stable order, dropping anything else', () => {
    const a = { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: false } as const;
    const b = { platform: 'greenhouse', fieldKind: 'select', matcherStage: 'fuzzy', outcome: 'fail', tripwireTriggered: true } as const;
    const counts = addEvents([{ ...a, count: 2 }, { ...b, count: 1, extra: 'x' }, 'junk'], [a, b, b, { ...a, label: 'Email' }]);
    expect(counts).toEqual([{ ...b, count: 2 }, { ...a, count: 3 }]);
    for (const count of counts) expect(Object.keys(count).sort()).toEqual([...TELEMETRY_FIELDS, 'count'].sort());
    expect(addEvents([{ ...a, count: Number.MAX_SAFE_INTEGER }], [a])).toEqual([{ ...a, count: Number.MAX_SAFE_INTEGER }]);
  });

  it('can never hold more entries than there are combinations', () => {
    expect(MAX_TELEMETRY_COUNTS).toBe(PLATFORMS.length * FIELD_KINDS.length * MATCHER_STAGES.length * 2 * 2);
    const events = PLATFORMS.flatMap((platform) => FIELD_KINDS.flatMap((fieldKind) => MATCHER_STAGES.flatMap((matcherStage) =>
      (['success', 'fail'] as const).flatMap((outcome) => [false, true].map((tripwireTriggered) =>
        ({ platform, fieldKind, matcherStage, outcome, tripwireTriggered }))))));
    const counts = addEvents([], [...events, ...events]);
    expect(counts).toHaveLength(MAX_TELEMETRY_COUNTS);
    expect(counts.every((count) => count.count === 2)).toBe(true);
  });
});
