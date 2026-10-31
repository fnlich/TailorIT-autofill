/*
 * The spec's anonymous telemetry: exactly five fields, closed lists and booleans only, no key, label, URL, account,
 * install id, time or version. Counted in storage.local only when the person opts in, shown and exportable on the
 * options page; nothing is sent (core/telemetry/events.ts derives them, background/telemetry.ts keeps the counts).
 */
import type { FieldKind, MatcherStage, Platform } from '../enums';

/** One field's outcome in one fill: the spec's five fields, and nothing else. */
export interface TelemetryEvent {
  platform: Platform;
  fieldKind: FieldKind;
  matcherStage: MatcherStage;
  outcome: 'success' | 'fail';
  tripwireTriggered: boolean;
}

/** How many times one combination of the five fields was counted. */
export interface TelemetryCount extends TelemetryEvent {
  count: number;
}
