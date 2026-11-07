/*
 * What the review panel asks of a tab's frames. panel/fill starts every registered frame of the tab that has a form;
 * the toolbar's continue and cancel reach the frames that reported; focus and describe go to the one frame that holds
 * the field. describe's option labels pass straight through to the panel: never stored, never logged. panel/open, sent
 * from a content script's trusted launcher click, opens the side panel for that tab (see openSidePanel).
 *
 * v3 Phase 3: Skip (panel/skip) goes to the one frame that holds the field, as run/skip, and that frame gives up the
 * write it is making of that field, if it is; a key, never a value.
 *
 * v3 Phase 4: the side panel's "Continue to the next page" and "Submit application" (panel/press, sent from the
 * person's click in the side panel, an extension page no page can script) go to the one frame whose report offers that
 * button, as run/press; the frame presses its adapter's own Next or Submit, and nothing else, if its step still offers
 * it (src/content/press.ts). Never to a frame whose report does not offer it: a report the run sent at rest says what
 * its step offers (FrameReport.buttons). The frame's answer (its outcome) passes through.
 *
 * v4 (docs/_v4/run.md): panel/fill {signIn: true} is "Sign up & Autofill": the tab is granted Sign-in Auto for one run
 * (background/sign-up.ts, PanelDeps.signUp) before its frames hear run/start {signIn: true}. Where no frame of the tab
 * has a form but its application frame shows an account wall or a choice of how to apply (frames.ts wallFrameOf), that
 * frame hears run/start (it signs in there, or presses the adapter's declared entry), and the tab's next form is
 * started once it says hello. A plain panel/fill ends any grant the tab held. The v4 review (M1): the grant is given for
 * the tab's application frame as it is now (wallFrameOf: its origin, and its application key where it has one), so it
 * holds for that site alone (sign-up.ts).
 * The policy card's decision has its own message, addressed to one frame: panel/policyDecision becomes
 * run/policyDecision for that frame only, and only while its report says its run waits at policy-notice. Continue
 * never stands in for Fill anyway: with one frame at the policy card and another at a CAPTCHA pause, the toolbar's
 * Continue resumes the pause and leaves the card waiting for the person's own decision.
 */
import { answerSchema, ok, refuse, type Answer } from '../messaging/envelope';
import {
  DoneAnswerSchema, FieldDescribeAnswerSchema, PressAnswerSchema, type PageMessage, type PressAnswer,
} from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { framesOfTab, wallFrameOf, type FrameEntry } from './frames';
import type { Grant, GrantPlace } from './sign-up';
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
  /** v4: grants the tab Sign up & Autofill and/or the start of its next form (sign-up.ts), for the frame `place` names
   *  (the v4 review, M1: the tab's application frame now), its frames told the settings as they act then; a grant of
   *  nothing, or with no place, ends the tab's grant. */
  signUp?(tabId: number, grant: Grant, place: GrantPlace | null): Promise<void>;
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
    // Each button then checks the tab's frames (v2): a tab that moved on to a page without our script says no hello,
    // and the check is what tells the panel its strip is stale.
    async fill(message: Of<'panel/fill'>): Promise<Answer<{ frames: number }>> {
      if (!(await deps.connected())) return refuse('not_connected');
      const all = await framesOfTab(platform.storage.session, message.tabId);
      const forms = all.filter((frame) => frame.hasForm);
      // v4: a page with no form whose application frame shows a wall or a choice of how to apply: that frame alone, and
      // the tab's next form is started once it shows (module header).
      const application = wallFrameOf(all);
      const wall = forms.length === 0 ? application : null;
      const atWall = wall !== null && (wall.wall !== undefined || wall.choice === true);
      const signIn = message.signIn === true && !message.dryRun;
      // The v4 review (M1): the grant is for the tab's application frame as it is now, its origin and application.
      await deps.signUp?.(message.tabId, { signIn, fill: atWall && !message.dryRun }, application === null ? null
        : { origin: application.origin, applicationKey: application.applicationKey });
      const reached = await sendTo(message.tabId, atWall ? [wall] : forms, { v: 1, type: 'run/start',
        dryRun: message.dryRun, ...(signIn ? { signIn: true as const } : {}) });
      deps.check?.(message.tabId);
      return ok({ frames: reached });
    },
    async continue(message: Of<'panel/continue'>): Promise<Answer<{ frames: number }>> {
      const reached = await sendTo(message.tabId, await reportingFrames(message.tabId), { v: 1, type: 'run/continue' });
      deps.check?.(message.tabId);
      return ok({ frames: reached });
    },
    async cancel(message: Of<'panel/cancel'>): Promise<Answer<{ frames: number }>> {
      const reached = await sendTo(message.tabId, await reportingFrames(message.tabId), { v: 1, type: 'run/cancel' });
      deps.check?.(message.tabId);
      return ok({ frames: reached });
    },
    /** The side panel's policy card: the decision for the one named frame, while its report waits at policy-notice.
     *  `expired`: that frame is not registered, its run is not at the card, or the frame says nothing waits there.
     *  `unavailable`: it did not answer, or its answer fails the schema. */
    async policyDecision(message: Of<'panel/policyDecision'>): Promise<Answer<Record<string, never>>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      const waiting = (await deps.reports.ofTab(message.tabId))
        .some((report) => report.frameId === message.frameId && report.status === 'policy-notice');
      if (!waiting) return refuse('expired');
      let answer: unknown;
      try {
        answer = await platform.tabs.sendToFrame(message.tabId,
          { v: 1, type: 'run/policyDecision', decision: message.decision }, targetOf(frame));
      } catch {
        log('frame.unreachable');
        return refuse('unavailable');
      }
      const parsed = answerSchema(DoneAnswerSchema).safeParse(answer);
      if (!parsed.success) return refuse('unavailable');
      log('panel.sent', { frames: parsed.data.ok ? 1 : 0 });
      if (parsed.data.ok) return ok({});
      return refuse(parsed.data.error === 'expired' ? 'expired' : 'unavailable');
    },
    /** v3 Phase 3: Skip on the field one frame's run writes now (the side panel's, after 2 s on it): run/skip to that
     *  frame alone, which gives that one write up. `expired`: the frame is gone, or writes another field, or none. */
    async skip(message: Of<'panel/skip'>): Promise<Answer<Record<string, never>>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      let answer: unknown;
      try {
        answer = await platform.tabs.sendToFrame(message.tabId, { v: 1, type: 'run/skip', fieldKey: message.fieldKey },
          targetOf(frame));
      } catch {
        log('frame.unreachable');
        return refuse('unavailable');
      }
      const parsed = answerSchema(DoneAnswerSchema).safeParse(answer);
      log('panel.skip-sent', { reached: parsed.success && parsed.data.ok });
      if (!parsed.success) return refuse('unavailable');
      return parsed.data.ok ? ok({}) : refuse('expired');
    },
    /** v3 Phase 4: the panel's Next or Submit for one frame (module header), while that frame's report offers it. */
    async press(message: Of<'panel/press'>): Promise<Answer<PressAnswer>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return ok({ outcome: 'gone' });
      const report = (await deps.reports.ofTab(message.tabId)).find((candidate) => candidate.frameId === message.frameId);
      const buttons = report?.buttons;
      const offered = buttons !== undefined && (message.target === 'next'
        ? buttons.final === 'not-final' && buttons.next : buttons.final === 'final' && buttons.submit);
      if (!offered) return ok({ outcome: 'not-offered' });
      let answer: unknown;
      try {
        answer = await platform.tabs.sendToFrame(message.tabId, { v: 1, type: 'run/press', target: message.target,
          confirmed: message.confirmed }, targetOf(frame));
      } catch {
        log('frame.unreachable');
        return ok({ outcome: 'gone' });
      }
      const parsed = answerSchema(PressAnswerSchema).safeParse(answer);
      if (!parsed.success) return refuse('unavailable');
      if (!parsed.data.ok) return ok({ outcome: parsed.data.error === 'expired' ? 'gone' : 'refused' });
      return ok(parsed.data.data);
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
    /** Answers at once from what is known, with the tab's page state; the frame check it sets off pushes the pruned
     *  state on the panel port. */
    async reports(message: Of<'panel/reports'>) {
      deps.check?.(message.tabId);
      const [reports, page] = await Promise.all([deps.reports.ofTab(message.tabId), deps.reports.page(message.tabId)]);
      return ok({ tabId: message.tabId, reports, page });
    },
  };
}

/** The panel/* handlers, as index.ts wires them. */
export type PanelHandlers = ReturnType<typeof createPanelHandlers>;
