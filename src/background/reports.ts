/*
 * The reports the review panel shows. A frame's report (statuses, labels and reasons, never a value) is stored in
 * storage.session per tab and frame (`report:<tabId>:<frameId>`) and dropped when the tab closes, or when the document
 * it came from is gone (its frame loaded another one, or the frame check found it gone). A report's document is its
 * run's: a report whose run belongs to another document of the frame stays, and one whose run is no longer known goes
 * with any document of its frame. The tab's combined report is pushed to every side
 * panel watching that tab (the `panel` port) and, when the person chose the in-page panel, to the one frame of the tab
 * that shows it (`report/update`). A watch starts with what is known at once, and the frame check it sets off reaches
 * the panel as one more change when it removes something.
 *
 * Phase 6:
 * - Which frame shows the in-page panel is that frame's own word, panel/shown {open}, sent on the person's trusted
 *   click (`panel-frame:<tabId>`: its frame id and document, never more). report/update goes to that frame alone, and
 *   only while the frame's document is still the registered one; the record goes with the document, the tab, or the
 *   frame's panel/shown {open: false}. Before Phase 6 every reporting frame received it, so a frame of one ATS saw the
 *   labels another frame of the tab reported; now only the frame the person opened the panel in does.
 * - Each report/put also feeds the anonymous counters (telemetry.ts), with the report it replaces, so a row is counted
 *   once per run.
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PanelPortMessageSchema, type ContentMessage } from '../messaging/schemas';
import type { PortLike, StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { FrameReportSchema, type FrameReport } from '../shared/report';
import { framesOfTab } from './frames';
import { createKeyedQueue, type createRateLimit } from './locks';
import type { FrameRef, RunRegistry } from './runs';
import type { SettingsStore } from './settings';
import type { Telemetry } from './telemetry';

/** report/put's limit per frame (runtime.md §4.1). */
export const REPORT_PUT_LIMIT = { count: 4, windowMs: 1000 } as const;
/** The most frames a tab's combined report holds. */
export const MAX_FRAME_REPORTS = 20;

const REPORT_PREFIX = 'report:';
const keyOf = (tabId: number, frameId: number) => `${REPORT_PREFIX}${tabId}:${frameId}`;
/** Which frame of a tab shows the in-page panel. */
const PANEL_FRAME_PREFIX = 'panel-frame:';
const panelKeyOf = (tabId: number) => `${PANEL_FRAME_PREFIX}${tabId}`;

/** panel/shown's limit per frame: it is sent from the person's clicks, so a frame that sends more is not a person. */
export const PANEL_SHOWN_LIMIT = { count: 10, windowMs: 10_000 } as const;

/** The frame that shows a tab's in-page panel, as stored: ids only. */
interface PanelFrame {
  frameId: number;
  documentId: string | null;
}

type ReportPut = Extract<ContentMessage, { type: 'report/put' }>;

/** The tab reports and the panels that follow them. */
export interface Reports {
  put(message: ReportPut, from: FrameRef): Promise<Answer<Record<string, never>>>;
  /** The tab's reports, one per frame, by frame id. */
  ofTab(tabId: number): Promise<FrameReport[]>;
  /** Drops the frame's report when it came from this document (null: one Chrome gave no id), or when its run is no
   *  longer known; a report another document of the frame sent stays. */
  forgetDocument(tabId: number, frameId: number, documentId: string | null): Promise<void>;
  forgetTab(tabId: number): Promise<void>;
  /** A side panel's `panel` port: it posts panel/watch {tabId} and receives panel/update now and on every change. */
  watch(port: PortLike): void;
  /** panel/shown: the frame opened (or closed) its in-page panel. An opened one gets the tab's report at once. */
  panelShown(from: FrameRef, open: boolean): Promise<Answer<Record<string, never>>>;
}

/** What the reports need. */
export interface ReportsDeps {
  session: StorageArea;
  tabs: WorkerPlatform['tabs'];
  runs: RunRegistry;
  settings: SettingsStore;
  limit: ReturnType<typeof createRateLimit>;
  /** panel/shown's limit, per frame (PANEL_SHOWN_LIMIT). */
  shownLimit?: ReturnType<typeof createRateLimit>;
  /** The anonymous counters each stored report feeds (counted only while the person opted in). */
  telemetry?: Pick<Telemetry, 'record'>;
  /** Checks, in the background, that the tab's frames are still there (the frame sweep); a report it removes is
   *  pushed to the watchers like any other change. */
  check?(tabId: number): void;
}

/** The reports over storage.session, with no panel watching yet. */
export function createReports(deps: ReportsDeps): Reports {
  const { session } = deps;
  /** Each watching port and the tab it follows. */
  const watchers = new Map<PortLike, number>();
  /** One queue per report key: a put and a document's forget never interleave. */
  const writes = createKeyedQueue();

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

  /** The frame that shows the tab's in-page panel, while its document is still the one registered; else null. */
  async function panelFrame(tabId: number): Promise<PanelFrame | null> {
    const stored = (await session.get(panelKeyOf(tabId))) as PanelFrame | undefined;
    if (stored === undefined) return null;
    const frame = (await framesOfTab(session, tabId)).find((entry) => entry.frameId === stored.frameId);
    return frame !== undefined && frame.documentId === stored.documentId ? stored : null;
  }

  /** report/update to the frame that shows the tab's in-page panel, when the person chose the in-page panel. */
  async function pushToPanelFrame(tabId: number, reports: FrameReport[]): Promise<void> {
    if ((await deps.settings.get()).panel !== 'in-page') return;
    const frame = await panelFrame(tabId);
    if (frame === null) return;
    try {
      await deps.tabs.sendToFrame(tabId, { v: 1, type: 'report/update', reports },
        frame.documentId === null ? { frameId: frame.frameId } : { frameId: frame.frameId, documentId: frame.documentId });
      log('panel.updated', { reports: reports.length });
    } catch {
      log('frame.unreachable');
    }
  }

  /** Pushes the tab's combined report to its watchers and to the frame that shows its in-page panel. */
  async function changed(tabId: number): Promise<void> {
    const reports = await ofTab(tabId);
    for (const [port, watched] of watchers) if (watched === tabId) post(port, tabId, reports);
    await pushToPanelFrame(tabId, reports);
  }

  /** Forgets the tab's panel frame when it is this frame's (and, given one, this document's). */
  async function forgetPanelFrame(tabId: number, frameId: number, documentId?: string | null): Promise<void> {
    const stored = (await session.get(panelKeyOf(tabId))) as PanelFrame | undefined;
    if (stored === undefined || stored.frameId !== frameId) return;
    if (documentId !== undefined && stored.documentId !== documentId) return;
    await session.remove([panelKeyOf(tabId)]);
  }

  /** Whether the frame's stored report goes with this document: it came from it, or it cannot say (it no longer
   *  parses, or its run is not known). Removed under the report's own queue, so a report/put never lands between the
   *  read and the removal. */
  function removeIfFrom(tabId: number, frameId: number, documentId: string | null): Promise<boolean> {
    const key = keyOf(tabId, frameId);
    return writes.run(key, async () => {
      const stored = await session.get(key);
      if (stored === undefined) return false;
      const parsed = FrameReportSchema.safeParse(stored);
      const from = parsed.success ? await deps.runs.documentOf(parsed.data.runId) : undefined;
      if (from !== undefined && from !== documentId) return false;
      await session.remove([key]);
      return true;
    });
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
      const key = keyOf(from.tabId, from.frameId);
      const previous = await writes.run(key, async () => {
        const before = FrameReportSchema.safeParse(await session.get(key));
        await session.set({ [key]: message.report });
        return before.success ? before.data : null;
      });
      log('report.stored', { fields: message.report.fields.length, notices: message.report.notices.length });
      await deps.telemetry?.record(message.report, previous).catch(() => undefined);
      await changed(from.tabId);
      return ok({});
    },
    ofTab,
    async forgetDocument(tabId, frameId, documentId) {
      await forgetPanelFrame(tabId, frameId, documentId);
      if (await removeIfFrom(tabId, frameId, documentId)) await changed(tabId);
    },
    async forgetTab(tabId) {
      await session.remove([panelKeyOf(tabId)]);
      const keys = Object.keys(await session.getMany(`${REPORT_PREFIX}${tabId}:`));
      if (keys.length === 0) return;
      await session.remove(keys);
      await changed(tabId);
    },
    async panelShown(from, open) {
      const retry = deps.shownLimit?.take(`${from.tabId}/${from.frameId}`) ?? null;
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (!open) {
        await forgetPanelFrame(from.tabId, from.frameId);
        log('panel.shown', { open: false });
        return ok({});
      }
      const record: PanelFrame = { frameId: from.frameId, documentId: from.documentId ?? null };
      await session.set({ [panelKeyOf(from.tabId)]: record });
      log('panel.shown', { open: true });
      await pushToPanelFrame(from.tabId, await ofTab(from.tabId));
      return ok({});
    },
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
