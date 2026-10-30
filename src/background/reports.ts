/*
 * The reports the review panel shows. A frame's report (statuses, labels and reasons, never a value) is stored in
 * storage.session per tab and frame (`report:<tabId>:<frameId>`) and dropped when the tab closes, the frame loads
 * another document, or the frame check finds its document gone. The tab's combined report is pushed to every side
 * panel watching that tab (the `panel` port) and, when the person chose the in-page panel, to the tab's reporting
 * frames (`report/update`), which show it. A watch starts with what is known at once, and the frame check it sets off
 * reaches the panel as one more change when it removes something.
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PanelPortMessageSchema, type ContentMessage } from '../messaging/schemas';
import type { PortLike, StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { FrameReportSchema, type FrameReport } from '../shared/report';
import { framesOfTab } from './frames';
import type { createRateLimit } from './locks';
import type { FrameRef, RunRegistry } from './runs';
import type { SettingsStore } from './settings';

/** report/put's limit per frame (runtime.md §4.1). */
export const REPORT_PUT_LIMIT = { count: 4, windowMs: 1000 } as const;
/** The most frames a tab's combined report holds. */
export const MAX_FRAME_REPORTS = 20;

const REPORT_PREFIX = 'report:';
const keyOf = (tabId: number, frameId: number) => `${REPORT_PREFIX}${tabId}:${frameId}`;

type ReportPut = Extract<ContentMessage, { type: 'report/put' }>;

/** The tab reports and the panels that follow them. */
export interface Reports {
  put(message: ReportPut, from: FrameRef): Promise<Answer<Record<string, never>>>;
  /** The tab's reports, one per frame, by frame id. */
  ofTab(tabId: number): Promise<FrameReport[]>;
  forgetFrame(tabId: number, frameId: number): Promise<void>;
  forgetTab(tabId: number): Promise<void>;
  /** A side panel's `panel` port: it posts panel/watch {tabId} and receives panel/update now and on every change. */
  watch(port: PortLike): void;
}

/** What the reports need. */
export interface ReportsDeps {
  session: StorageArea;
  tabs: WorkerPlatform['tabs'];
  runs: RunRegistry;
  settings: SettingsStore;
  limit: ReturnType<typeof createRateLimit>;
  /** Checks, in the background, that the tab's frames are still there (the frame sweep); a report it removes is
   *  pushed to the watchers like any other change. */
  check?(tabId: number): void;
}

/** The reports over storage.session, with no panel watching yet. */
export function createReports(deps: ReportsDeps): Reports {
  const { session } = deps;
  /** Each watching port and the tab it follows. */
  const watchers = new Map<PortLike, number>();

  async function ofTab(tabId: number): Promise<FrameReport[]> {
    const stored = await session.getMany(`${REPORT_PREFIX}${tabId}:`);
    const reports: FrameReport[] = [];
    for (const value of Object.values(stored)) {
      const parsed = FrameReportSchema.safeParse(value);
      if (parsed.success) reports.push(parsed.data);
    }
    return reports.sort((a, b) => a.frameId - b.frameId).slice(0, MAX_FRAME_REPORTS);
  }

  function post(port: PortLike, tabId: number, reports: FrameReport[]): void {
    try {
      port.post({ v: 1, type: 'panel/update', tabId, reports });
    } catch {
      watchers.delete(port);
    }
  }

  /** Pushes the tab's combined report to its watchers and, with the in-page panel chosen, to its reporting frames. */
  async function changed(tabId: number): Promise<void> {
    const reports = await ofTab(tabId);
    for (const [port, watched] of watchers) if (watched === tabId) post(port, tabId, reports);
    if ((await deps.settings.get()).panel !== 'in-page' || reports.length === 0) return;
    const frames = await framesOfTab(session, tabId);
    const reporting = new Set(reports.map((report) => report.frameId));
    await Promise.all(frames.filter((frame) => reporting.has(frame.frameId)).map(async (frame) => {
      try {
        await deps.tabs.sendToFrame(tabId, { v: 1, type: 'report/update', reports },
          frame.documentId === null ? { frameId: frame.frameId } : { frameId: frame.frameId, documentId: frame.documentId });
      } catch {
        log('frame.unreachable');
      }
    }));
  }

  async function remove(tabId: number, frameIds: number[] | 'all'): Promise<void> {
    const stored = Object.keys(await session.getMany(`${REPORT_PREFIX}${tabId}:`));
    const keys = frameIds === 'all' ? stored : stored.filter((key) => frameIds.some((frameId) => key === keyOf(tabId, frameId)));
    if (keys.length === 0) return;
    await session.remove(keys);
    await changed(tabId);
  }

  return {
    async put(message, from) {
      const retry = deps.limit.take(`${from.tabId}/${from.frameId}`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      if (message.report.runId !== message.runId || message.report.frameId !== from.frameId) {
        log('report.refused');
        return refuse('bad_message');
      }
      await session.set({ [keyOf(from.tabId, from.frameId)]: message.report });
      log('report.stored', { fields: message.report.fields.length, notices: message.report.notices.length });
      await changed(from.tabId);
      return ok({});
    },
    ofTab,
    forgetFrame: (tabId, frameId) => remove(tabId, [frameId]),
    forgetTab: (tabId) => remove(tabId, 'all'),
    watch(port) {
      port.onMessage((raw) => {
        const parsed = PanelPortMessageSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type !== 'panel/watch') {
          log('port.refused');
          watchers.delete(port);
          port.disconnect();
          return;
        }
        const tabId = parsed.data.tabId;
        watchers.set(port, tabId);
        void ofTab(tabId).then((reports) => {
          if (watchers.get(port) === tabId) post(port, tabId, reports);
        });
        deps.check?.(tabId);
      });
      port.onDisconnect(() => void watchers.delete(port));
    },
  };
}
