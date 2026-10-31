/*
 * The anonymous counters (docs/ARCHITECTURE.md "Telemetry"; SPEC Requirement F), kept in storage.local under
 * `telemetry:v1` and only while the person has opted in (Settings.telemetry.optIn, off by default). Nothing is ever
 * sent: no message, port or request carries them anywhere but the options page, which shows and exports them.
 * - The worker derives them from the rows of each report/put (core/telemetry/events.ts): one event per field that was
 *   attempted, with exactly the five fields. A dry run counts nothing: it writes nothing.
 * - A row is counted once per run: a report that replaces the frame's earlier one for the same run counts only the
 *   keys the earlier one did not count (a run reports again at every rest, and after a validation pass). An AI draft
 *   that waits for the person is not counted until they confirm or edit it (core/telemetry/events.ts outcomeKnown).
 * - The stored counts are checked on the way in and out (addEvents keeps only well-formed counts, rebuilt from their
 *   five fields), so a stored entry with anything more, or a corrupt one, is dropped.
 * Writes are serialised, so two reports at once never lose a count.
 */
import { addEvents, outcomeKnown, telemetryEventsOf } from '../core/telemetry/events';
import type { TelemetryCount } from '../core/types/telemetry';
import type { StorageArea } from '../platform/types';
import type { FrameReport } from '../shared/report';
import { log } from '../shared/log';
import { createKeyedQueue } from './locks';
import type { SettingsStore } from './settings';

/** Where the counts are kept. */
export const TELEMETRY_KEY = 'telemetry:v1';

/** The counters, as the worker keeps them. */
export interface Telemetry {
  /** Counts `report`'s rows that `previous` (the frame's report it replaces) did not already count for the same run,
   *  when the person opted in. Answers how many events were added. */
  record(report: FrameReport, previous: FrameReport | null): Promise<number>;
  /** The counts, one per combination of the five fields. */
  read(): Promise<TelemetryCount[]>;
  /** Removes every count. */
  clear(): Promise<void>;
}

/** The counters over storage.local, gated on the person's opt-in. */
export function createTelemetry(deps: { local: StorageArea; settings: Pick<SettingsStore, 'get'> }): Telemetry {
  const { local } = deps;
  const queue = createKeyedQueue();

  async function stored(): Promise<TelemetryCount[]> {
    const value = await local.get(TELEMETRY_KEY);
    const counts = (value as { counts?: unknown } | undefined)?.counts;
    return addEvents(Array.isArray(counts) ? counts : [], []);
  }

  return {
    async record(report, previous) {
      if (report.mode !== 'fill' || !(await deps.settings.get()).telemetry.optIn) return 0;
      const counted = new Set(previous !== null && previous.runId === report.runId
        ? previous.fields.filter(outcomeKnown).map((row) => row.key) : []);
      const events = telemetryEventsOf({
        platform: report.platform,
        tripwireTriggered: report.notices.some((notice) => notice.code === 'tripwire'),
        rows: report.fields.filter((row) => !counted.has(row.key)),
      });
      if (events.length === 0) return 0;
      await queue.run(TELEMETRY_KEY, async () => {
        await local.set({ [TELEMETRY_KEY]: { counts: addEvents(await stored(), events) } });
      });
      log('telemetry.counted', { events: events.length });
      return events.length;
    },
    read: () => queue.run(TELEMETRY_KEY, stored),
    clear: () => queue.run(TELEMETRY_KEY, async () => {
      await local.remove([TELEMETRY_KEY]);
      log('telemetry.cleared');
    }),
  };
}
