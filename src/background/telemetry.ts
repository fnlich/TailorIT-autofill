/*
 * The anonymous counters (docs/ARCHITECTURE.md "Telemetry"; SPEC Requirement F), kept in storage.local under
 * `telemetry:v1` and only while the person has opted in (Settings.telemetry.optIn, off by default). Nothing is ever
 * sent: no message, port or request carries them anywhere but the options page, which shows and exports them.
 * - The worker derives them from the rows of each report/put (core/telemetry/events.ts): one event per field that was
 *   attempted, with exactly the five fields. A dry run counts nothing: it writes nothing.
 * - A row is counted once per run: a report counts only the keys its run has not counted yet (a run reports again at
 *   every rest, after a validation pass, and for a step the person comes Back to). The keys each run counted are kept
 *   in storage.session (`telemetry:counted`, keys only, the latest MAX_COUNTED_RUNS runs, at most MAX_COUNTED_KEYS
 *   each), so neither a step that comes back nor a worker restart counts a row twice (the Phase 6 review, E8); the
 *   frame's earlier report for the same run is read as well. An AI draft that waits for the person is not counted
 *   until they confirm or edit it (core/telemetry/events.ts outcomeKnown).
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
/** Where the keys each run counted are kept (storage.session), and how many runs and keys a run it holds. */
export const TELEMETRY_COUNTED_KEY = 'telemetry:counted';
export const MAX_COUNTED_RUNS = 20;
export const MAX_COUNTED_KEYS = 2000;

/** The keys each run counted, the oldest run first. */
type Counted = Array<[string, string[]]>;

/** The stored record, or nothing when it is not one. */
function countedOf(value: unknown): Counted {
  const runs = (value as { runs?: unknown } | undefined)?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.filter((entry): entry is [string, string[]] => Array.isArray(entry) && entry.length === 2
    && typeof entry[0] === 'string' && Array.isArray(entry[1]) && entry[1].every((key) => typeof key === 'string'))
    .slice(-MAX_COUNTED_RUNS);
}

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

/** The counters over storage.local, gated on the person's opt-in; the keys each run counted in storage.session. */
export function createTelemetry(deps: { local: StorageArea; session: StorageArea; settings: Pick<SettingsStore, 'get'> }):
  Telemetry {
  const { local, session } = deps;
  const queue = createKeyedQueue();

  async function stored(): Promise<TelemetryCount[]> {
    const value = await local.get(TELEMETRY_KEY);
    const counts = (value as { counts?: unknown } | undefined)?.counts;
    return addEvents(Array.isArray(counts) ? counts : [], []);
  }

  return {
    async record(report, previous) {
      if (report.mode !== 'fill' || !(await deps.settings.get()).telemetry.optIn) return 0;
      const tripwireTriggered = report.notices.some((notice) => notice.code === 'tripwire');
      const events = await queue.run(TELEMETRY_KEY, async () => {
        const runs = countedOf(await session.get(TELEMETRY_COUNTED_KEY));
        const ofRun = runs.find(([runId]) => runId === report.runId)?.[1] ?? [];
        const counted = new Set([...ofRun, ...(previous !== null && previous.runId === report.runId
          ? previous.fields.filter(outcomeKnown).map((row) => row.key) : [])]);
        const fresh = report.fields.filter((row) => !counted.has(row.key) && telemetryEventsOf({ platform: report.platform,
          tripwireTriggered, rows: [row] }).length > 0);
        if (fresh.length === 0) return [];
        const found = telemetryEventsOf({ platform: report.platform, tripwireTriggered, rows: fresh });
        await local.set({ [TELEMETRY_KEY]: { counts: addEvents(await stored(), found) } });
        const keys = [...ofRun, ...fresh.map((row) => row.key)].slice(-MAX_COUNTED_KEYS);
        await session.set({ [TELEMETRY_COUNTED_KEY]: { runs: [...runs.filter(([runId]) => runId !== report.runId),
          [report.runId, keys]].slice(-MAX_COUNTED_RUNS) } });
        return found;
      });
      if (events.length === 0) return 0;
      log('telemetry.counted', { events: events.length });
      return events.length;
    },
    read: () => queue.run(TELEMETRY_KEY, stored),
    clear: () => queue.run(TELEMETRY_KEY, async () => {
      await local.remove([TELEMETRY_KEY]);
      await session.remove([TELEMETRY_COUNTED_KEY]);
      log('telemetry.cleared');
    }),
  };
}
