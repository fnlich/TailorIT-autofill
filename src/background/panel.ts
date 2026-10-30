/*
 * What the review panel asks of a tab's frames. panel/fill starts every registered frame of the tab that has a form;
 * continue and cancel reach the frames that reported; focus and describe go to the one frame that holds the field.
 * describe's option labels pass straight through to the panel: never stored, never logged. panel/open, sent from a
 * content script's trusted launcher click, opens the side panel for that tab (see openSidePanel).
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import { FieldDescribeAnswerSchema, type PageMessage } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { framesOfTab, type FrameEntry } from './frames';
import type { Reports } from './reports';

type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;
type FieldDescription = { options: Array<{ index: number; label: string }> };

/** What the panel's handlers need. */
export interface PanelDeps {
  platform: Pick<WorkerPlatform, 'tabs' | 'sidePanel' | 'storage'>;
  reports: Reports;
  connected(): Promise<boolean>;
  /** Checks, in the background, that the tab's frames are still there; what it removes reaches the panel port. */
  check?(tabId: number): void;
}

const targetOf = (frame: FrameEntry) =>
  frame.documentId === null ? { frameId: frame.frameId } : { frameId: frame.frameId, documentId: frame.documentId };

/**
 * Opens the side panel for the tab whose launcher was clicked. It calls sidePanel.open before anything is awaited,
 * because the browser counts the click as the person's gesture only until the handler first yields.
 */
export function openSidePanel(platform: Pick<WorkerPlatform, 'sidePanel'>, tabId: number): Promise<Answer<Record<string, never>>> {
  const opening = platform.sidePanel.open(tabId);
  return opening.then(
    () => {
      log('panel.opened');
      return ok({});
    },
    () => {
      log('panel.open-failed');
      return refuse('unavailable');
    },
  );
}

/** The handlers of the panel/* page messages. */
export function createPanelHandlers(deps: PanelDeps) {
  const { platform } = deps;

  /** Sends one message to each frame; answers how many it reached. */
  async function sendTo(tabId: number, frames: FrameEntry[], message: unknown): Promise<number> {
    const reached = await Promise.all(frames.map(async (frame) => {
      try {
        await platform.tabs.sendToFrame(tabId, message, targetOf(frame));
        return true;
      } catch {
        log('frame.unreachable');
        return false;
      }
    }));
    const count = reached.filter(Boolean).length;
    log('panel.sent', { frames: count });
    return count;
  }

  /** The tab's frames that sent a report: the ones running a fill. */
  async function reportingFrames(tabId: number): Promise<FrameEntry[]> {
    const reporting = new Set((await deps.reports.ofTab(tabId)).map((report) => report.frameId));
    return (await framesOfTab(platform.storage.session, tabId)).filter((frame) => reporting.has(frame.frameId));
  }

  async function frameOf(tabId: number, frameId: number): Promise<FrameEntry | null> {
    return (await framesOfTab(platform.storage.session, tabId)).find((frame) => frame.frameId === frameId) ?? null;
  }

  return {
    async fill(message: Of<'panel/fill'>): Promise<Answer<{ frames: number }>> {
      if (!(await deps.connected())) return refuse('not_connected');
      const frames = (await framesOfTab(platform.storage.session, message.tabId)).filter((frame) => frame.hasForm);
      return ok({ frames: await sendTo(message.tabId, frames, { v: 1, type: 'run/start', dryRun: message.dryRun }) });
    },
    async continue(message: Of<'panel/continue'>): Promise<Answer<{ frames: number }>> {
      return ok({ frames: await sendTo(message.tabId, await reportingFrames(message.tabId), { v: 1, type: 'run/continue' }) });
    },
    async cancel(message: Of<'panel/cancel'>): Promise<Answer<{ frames: number }>> {
      return ok({ frames: await sendTo(message.tabId, await reportingFrames(message.tabId), { v: 1, type: 'run/cancel' }) });
    },
    async focus(message: Of<'panel/focus'>): Promise<Answer<Record<string, never>>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      const reached = await sendTo(message.tabId, [frame], { v: 1, type: 'field/focus', fieldKey: message.fieldKey });
      return reached === 1 ? ok({}) : refuse('unavailable');
    },
    async describe(message: Of<'panel/describe'>): Promise<Answer<FieldDescription>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      let answer: unknown;
      try {
        answer = await platform.tabs.sendToFrame(message.tabId, { v: 1, type: 'field/describe', fieldKey: message.fieldKey },
          targetOf(frame));
      } catch {
        log('frame.unreachable');
        return refuse('unavailable');
      }
      // The frame answers in the envelope; its labels are page text, checked and passed on, never kept.
      const data = (answer as { ok?: unknown; data?: unknown } | undefined)?.ok === true ? (answer as { data: unknown }).data : null;
      const parsed = FieldDescribeAnswerSchema.safeParse(data);
      return parsed.success ? ok(parsed.data) : refuse('unavailable');
    },
    /** Answers at once from what is known; the frame check it sets off pushes the pruned state on the panel port. */
    async reports(message: Of<'panel/reports'>) {
      deps.check?.(message.tabId);
      return ok({ tabId: message.tabId, reports: await deps.reports.ofTab(message.tabId) });
    },
  };
}

/** The panel/* handlers, as index.ts wires them. */
export type PanelHandlers = ReturnType<typeof createPanelHandlers>;
