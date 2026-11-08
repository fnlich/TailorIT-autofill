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
 *
 * v3 Phase 3: a side panel's watch says it is the browser's side panel (`side`), and the tab it shows hears it
 * (sideShown: panel/side {open}), so the tab's launcher hides while a side panel shows it, and comes back when none does.
 * v2: every read and push also carries the tab's page state (frames.ts pageOfTab: a form found and its platform, frames
 * of ours with no form, or none), so the side panel says where the tab stands before any run. It is pushed again when a
 * frame says hello or a sweep forgets one (pageChanged), only to a watcher it changed for. Every push for a tab goes
 * through one queue per tab, reading the reports and the page inside it, so an older state is never posted last. A
 * change of connection or settings goes to every open panel port as panel/changed {what} (tellPanels), with nothing
 * else in it: the panel reads them again itself, and drops a card it read with the old connection.
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import { type ContentMessage, type PageState } from '../messaging/schemas';
import { PanelPortMessageSchema, type PANEL_CHANGES } from '../messaging/page-schemas';
import type { PortLike, StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { FrameReportSchema, type FrameReport } from '../shared/report';
import { framesOfTab, pageOfTab } from './frames';
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

type ReportPut = Extract<ContentMessage, { type: 'report/put' | 'report/live' }>;

/** The tab reports and the panels that follow them. */
export interface Reports {
  put(message: ReportPut, from: FrameRef & { incognito?: true }): Promise<Answer<Record<string, never>>>;
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
  /** The tab's page state (v2), from the frame registry. */
  page(tabId: number): Promise<PageState>;
  /** The tab's frames changed (a hello, a forgotten frame): watchers whose page state it changed get the tab again. */
  pageChanged(tabId: number): Promise<void>;
  /** The connection or the settings changed (v2): every open panel port is told what, and nothing more. */
  tellPanels(what: PanelChange): void;
  /** Whether a side panel shows the tab now (v3 Phase 3 review): a top frame's hello hears it, so a page reloaded or
   *  navigated beside an open side panel keeps its launcher hidden. */
  sideShows(tabId: number): boolean;
}

type PanelChange = (typeof PANEL_CHANGES)[number];

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
  /** v3 Phase 3: the browser's side panel began (or stopped) showing a tab, so its launcher hides while it does. Told
   *  once per change: when the first side panel watches the tab, and when the last one leaves it. */
  sideShown?(tabId: number, open: boolean): void;
  /** v3 Phase 4: where recording the tab's submitted application stands (submissions.ts), for its page state. */
  submitted?(tabId: number): Promise<PageState['submitted']> | PageState['submitted'];
  /** v3 Phase 8 (the review's B10): whether the company career sites act now (sites.ts). */
  sitesActive?(): Promise<boolean>;
}

/** The reports over storage.session, with no panel watching yet. */
export function createReports(deps: ReportsDeps): Reports {
  const { session } = deps;
  /** Each watching port, the tab it follows and the page state it was last sent (as JSON). */
  const watchers = new Map<PortLike, { tabId: number; page: string | null }>();
  /** The side panels (not the report page) and the tab each shows (v3 Phase 3). */
  const sides = new Map<PortLike, number>();

  /** The tab's page state (pageOfTab), and, where no frame of ours said hello: a page on an applicant-tracking host
   *  whose address the content script says hello at (a posting, its form) waits for a reload; any other page there (a
   *  board, a sign-in that names no job, an employer's own pages, where the content script says nothing: the v3 Phase
   *  6/7b review's S3) shows no application form, as it did when every page said hello (round 2, K1). */
  async function pageNow(tabId: number): Promise<PageState> {
    const read = await pageOfTab(session, tabId);
    const submitted = await deps.submitted?.(tabId);
    const page = submitted === undefined ? read : { ...read, submitted };
    if (page.support !== 'none') return page;
    if (deps.tabs.atsPageOf !== undefined) {
      const shown = await deps.tabs.atsPageOf(tabId).catch(() => null);
      if (shown !== null) {
        return shown.page === 'posting' ? { ...page, reload: true } : { ...page, support: 'no-form' };
      }
    } else if (deps.tabs.onAtsHost !== undefined && await deps.tabs.onAtsHost(tabId).catch(() => false)) {
      return { ...page, reload: true };
    }
    // v3 Phase 8 (the review's B10): while the company career sites act, a company's own https page no frame of ours
    // is on (one opened before they were turned on, or one the sentinel has not recognised) offers a reload.
    if (deps.sitesActive !== undefined && deps.tabs.companySite !== undefined
      && await deps.sitesActive().catch(() => false) && await deps.tabs.companySite(tabId).catch(() => false)) {
      return { ...page, reload: true, site: true };
    }
    return page;
  }

  /** A side panel shows `tabId` now (or nothing): the tab it left and the tab it shows hear of it when that changes
   *  whether any side panel shows them. */
  function sideMoved(port: PortLike, tabId: number | null): void {
    const before = sides.get(port) ?? null;
    if (before === tabId) return;
    if (tabId === null) sides.delete(port);
    else sides.set(port, tabId);
    const showing = (tab: number) => [...sides.values()].includes(tab);
    if (before !== null && !showing(before)) deps.sideShown?.(before, false);
    if (tabId !== null && [...sides.entries()].filter(([, tab]) => tab === tabId).length === 1) deps.sideShown?.(tabId, true);
  }
  /** Every open panel port, watching a tab or not yet (v2: told of a connection or settings change). */
  const ports = new Set<PortLike>();
  /** One queue per report key: a put and a document's forget never interleave. */
  const writes = createKeyedQueue();
  /** One queue per tab for what is pushed to its watchers, so pushes land in the order their states were read. */
  const pushes = createKeyedQueue();

  async function ofTab(tabId: number): Promise<FrameReport[]> {
    const stored = await session.getMany(`${REPORT_PREFIX}${tabId}:`);
    const reports: FrameReport[] = [];
    for (const value of Object.values(stored)) {
      const parsed = FrameReportSchema.safeParse(value);
      if (parsed.success) reports.push(parsed.data);
    }
    return reports.sort((a, b) => a.frameId - b.frameId).slice(0, MAX_FRAME_REPORTS);
  }

  function post(port: PortLike, tabId: number, reports: FrameReport[], page: PageState): void {
    try {
      port.post({ v: 1, type: 'panel/update', tabId, reports, page });
      const watching = watchers.get(port);
      if (watching !== undefined && watching.tabId === tabId) watching.page = JSON.stringify(page);
    } catch {
      watchers.delete(port);
    }
  }

  /** Runs a push for a tab after the ones before it, reading its reports and page state inside. */
  function push(tabId: number, task: (reports: FrameReport[], page: PageState) => Promise<void> | void): Promise<void> {
    return pushes.run(`push:${tabId}`, async () => {
      const [reports, page] = await Promise.all([ofTab(tabId), pageNow(tabId)]);
      await task(reports, page);
    });
  }

  /** The frame that shows the tab's in-page panel, while its document is still the one registered; else null. */
  async function panelFrame(tabId: number): Promise<PanelFrame | null> {
    const stored = (await session.get(panelKeyOf(tabId))) as PanelFrame | undefined;
    if (stored === undefined) return null;
    const frame = (await framesOfTab(session, tabId)).find((entry) => entry.frameId === stored.frameId);
    return frame !== undefined && frame.documentId === stored.documentId ? stored : null;
  }

  /** report/update to the frame that shows the tab's in-page panel, when the person chose the panel on the page (v5:
   *  'page', whose embedded frames keep the in-page card; the top frame's sidebar watches the `panel` port instead). */
  async function pushToPanelFrame(tabId: number, reports: FrameReport[]): Promise<void> {
    if ((await deps.settings.get()).panel !== 'page') return;
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
  function changed(tabId: number): Promise<void> {
    return push(tabId, async (reports, page) => {
      for (const [port, watched] of watchers) if (watched.tabId === tabId) post(port, tabId, reports, page);
      await pushToPanelFrame(tabId, reports);
    });
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
      // A live report (v3 Phase 3) has its own budget, so a run's progress never holds back the report it rests with.
      const retry = deps.limit.take(`${from.tabId}/${from.frameId}${message.type === 'report/live' ? '/live' : ''}`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      if (message.report.runId !== message.runId || message.report.frameId !== from.frameId) {
        log('report.refused');
        return refuse('bad_message');
      }
      const key = keyOf(from.tabId, from.frameId);
      const live = message.type === 'report/live';
      const stored = await writes.run(key, async () => {
        const before = FrameReportSchema.safeParse(await session.get(key));
        const held = before.success ? before.data : null;
        // A live report built before the one stored (it was on its way while the run's own report went) never
        // replaces it: the review would go back to "Autofilling" (v3 Phase 3 review).
        if (live && held !== null && (message.report.updatedAt < held.updatedAt
          || (message.report.updatedAt === held.updatedAt && held.filling === undefined))) {
          return { previous: held, kept: true };
        }
        await session.set({ [key]: message.report });
        return { previous: held, kept: false };
      });
      if (stored.kept) {
        log('report.stale-live');
        return ok({});
      }
      const previous = stored.previous;
      log('report.stored', { fields: message.report.fields.length, notices: message.report.notices.length });
      // A live report (v3 Phase 3: report/live) is the panels' alone: its rows may still wait for their writes, so it
      // counts nothing, and a report after it is counted against the run's own bookkeeping, never against it.
      if (!live) {
        // A private (incognito) tab's report counts nothing (the audit of 2026-11-06, S-6: telemetry.ts).
        await deps.telemetry?.record(message.report, previous?.filling === undefined ? previous : null,
          { incognito: from.incognito === true }).catch(() => undefined);
      }
      await changed(from.tabId);
      return ok({});
    },
    ofTab,
    sideShows: (tabId) => [...sides.values()].includes(tabId),
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
    page: (tabId) => pageNow(tabId),
    pageChanged(tabId) {
      return push(tabId, (reports, page) => {
        const now = JSON.stringify(page);
        for (const [port, watched] of watchers) {
          if (watched.tabId === tabId && watched.page !== now) post(port, tabId, reports, page);
        }
      });
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
    tellPanels(what) {
      for (const port of [...ports]) {
        try {
          port.post({ v: 1, type: 'panel/changed', what });
        } catch {
          ports.delete(port);
          watchers.delete(port);
        }
      }
    },
    watch(port) {
      ports.add(port);
      port.onMessage((raw) => {
        const parsed = PanelPortMessageSchema.safeParse(raw);
        if (!parsed.success || parsed.data.type !== 'panel/watch') {
          log('port.refused');
          watchers.delete(port);
          ports.delete(port);
          port.disconnect();
          return;
        }
        const tabId = parsed.data.tabId;
        watchers.set(port, { tabId, page: null });
        if (parsed.data.side === true) sideMoved(port, tabId);
        void push(tabId, (reports, page) => {
          if (watchers.get(port)?.tabId === tabId) post(port, tabId, reports, page);
        }).catch(() => undefined);
        deps.check?.(tabId);
      });
      port.onDisconnect(() => {
        watchers.delete(port);
        ports.delete(port);
        sideMoved(port, null);
      });
    },
  };
}
