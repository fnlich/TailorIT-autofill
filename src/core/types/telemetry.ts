/*
 * The spec's anonymous telemetry: closed lists and booleans only, no key, label, URL, account or install id. Counted
 * in storage.local only when the person opts in, shown and exportable on the options page; nothing is sent.
 */
import type { FieldKind, MatcherStage, Platform } from '../enums';

export interface TelemetryEvent {
  v: 1;
  platform: Platform;
  fieldKind: FieldKind;
  matcherStage: MatcherStage;
  outcome: 'success' | 'fail';
  tripwireTriggered: boolean;
}
