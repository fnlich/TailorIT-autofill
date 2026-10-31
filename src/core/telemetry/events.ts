/*
 * The spec's anonymous counters (Requirement F: "platform, field kind, matcher stage, success/fail, tripwire-triggered
 * yes/no ... and contain no values"), derived from a report's rows. Pure: the worker (background/telemetry.ts) decides
 * which rows to count and keeps the counts in storage.local, only when the person opted in; nothing is ever sent.
 * - An event has exactly the five fields, each from a closed list or a boolean. It is built field by field, never
 *   spread from a row, so nothing a row carries besides them (its key, label, section, reason) can ride along.
 * - Outcome: a written field (filled, verified) is a success; one left for the person (flagged, blocked) a fail. A
 *   skipped field (no profile answer, a hidden one, a honeypot) was never attempted and counts as neither.
 * - An AI draft that waits for the person's confirmation (Phase 6) is not counted yet: its outcome is the person's to
 *   give. Once confirmed it is a success (verified), once they edited it a fail (changed-by-you); a saved answer counts
 *   as any written field, by its status.
 * - The counts are one entry per combination of the five, so at most MAX_TELEMETRY_COUNTS entries exist.
 */
import { FIELD_KINDS, MATCHER_STAGES, PLATFORMS, type FillStatus, type Platform } from '../enums';
import type { FillResult } from '../types/fill';
import type { TelemetryCount, TelemetryEvent } from '../types/telemetry';

/** The five fields of an event, in the order the options page lists and exports them. */
export const TELEMETRY_FIELDS = ['platform', 'fieldKind', 'matcherStage', 'outcome', 'tripwireTriggered'] as const;
/** An event's outcome. */
export const TELEMETRY_OUTCOMES = ['success', 'fail'] as const;
/** Every combination of the five fields: the most entries the counts can hold. */
export const MAX_TELEMETRY_COUNTS = PLATFORMS.length * FIELD_KINDS.length * MATCHER_STAGES.length
  * TELEMETRY_OUTCOMES.length * 2;

/** What a row's status says about the field: written (success), left for the person (fail), or never attempted. */
export function outcomeOf(status: FillStatus): TelemetryEvent['outcome'] | null {
  switch (status) {
    case 'filled':
    case 'verified':
      return 'success';
    case 'flagged':
    case 'blocked':
      return 'fail';
    case 'skipped':
      return null;
  }
}

/** Whether a row's outcome is known yet: every row but an AI draft that waits for the person's confirmation. */
export function outcomeKnown(row: Pick<FillResult, 'provenance' | 'needsUserAction'>): boolean {
  return !(row.provenance === 'llm-draft' && row.needsUserAction);
}

/** One event per row that was attempted (outcomeOf not null) and whose outcome is known (outcomeKnown), with the
 *  frame's platform and whether its page addressed AI tools. Nothing of a row but its kind, matcher stage, status,
 *  provenance and whether it needs the person is read; only the first three reach the event. */
export function telemetryEventsOf(input: {
  platform: Platform;
  tripwireTriggered: boolean;
  rows: ReadonlyArray<Pick<FillResult, 'kind' | 'matcherStage' | 'status' | 'provenance' | 'needsUserAction'>>;
}): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  for (const row of input.rows) {
    const outcome = outcomeOf(row.status);
    if (outcome === null || !outcomeKnown(row)) continue;
    events.push({ platform: input.platform, fieldKind: row.kind, matcherStage: row.matcherStage, outcome,
      tripwireTriggered: input.tripwireTriggered });
  }
  return events;
}

const has = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);

/** Whether `value` is an event: an object with exactly the five fields, each within its closed list. */
export function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== TELEMETRY_FIELDS.length || !TELEMETRY_FIELDS.every((key) => keys.includes(key))) return false;
  const event = value as Record<string, unknown>;
  return has(PLATFORMS, event.platform) && has(FIELD_KINDS, event.fieldKind) && has(MATCHER_STAGES, event.matcherStage)
    && has(TELEMETRY_OUTCOMES, event.outcome) && typeof event.tripwireTriggered === 'boolean';
}

/** Whether `value` is one count: the five fields and a positive whole count, nothing else. */
export function isTelemetryCount(value: unknown): value is TelemetryCount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { count, ...event } = value as Record<string, unknown>;
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && isTelemetryEvent(event);
}

/** The five fields as one key, for adding up. */
function tupleOf(event: TelemetryEvent): string {
  return [event.platform, event.fieldKind, event.matcherStage, event.outcome, event.tripwireTriggered ? 'yes' : 'no']
    .join('|');
}

/** Rank of each closed value, for a stable order. */
const rank = (list: readonly string[], value: string) => list.indexOf(value);

/** Orders counts by platform, field kind, matcher stage, outcome, then tripwire (no before yes). */
function compare(a: TelemetryCount, b: TelemetryCount): number {
  return rank(PLATFORMS, a.platform) - rank(PLATFORMS, b.platform)
    || rank(FIELD_KINDS, a.fieldKind) - rank(FIELD_KINDS, b.fieldKind)
    || rank(MATCHER_STAGES, a.matcherStage) - rank(MATCHER_STAGES, b.matcherStage)
    || rank(TELEMETRY_OUTCOMES, a.outcome) - rank(TELEMETRY_OUTCOMES, b.outcome)
    || Number(a.tripwireTriggered) - Number(b.tripwireTriggered);
}

/**
 * `counts` with `events` added: one entry per combination of the five fields, in a stable order. Anything in either
 * that is not a count or an event is dropped, and each entry is rebuilt from its five fields, so nothing else survives.
 * A count stops at Number.MAX_SAFE_INTEGER.
 */
export function addEvents(counts: readonly unknown[], events: readonly unknown[]): TelemetryCount[] {
  const totals = new Map<string, TelemetryCount>();
  const add = (event: TelemetryEvent, by: number) => {
    const key = tupleOf(event);
    const before = totals.get(key)?.count ?? 0;
    totals.set(key, { platform: event.platform, fieldKind: event.fieldKind, matcherStage: event.matcherStage,
      outcome: event.outcome, tripwireTriggered: event.tripwireTriggered,
      count: Math.min(Number.MAX_SAFE_INTEGER, before + by) });
  };
  for (const entry of counts) if (isTelemetryCount(entry)) add(entry, entry.count);
  for (const event of events) if (isTelemetryEvent(event)) add(event, 1);
  return [...totals.values()].sort(compare);
}
