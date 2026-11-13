/*
 * The panel's "Continue to the next page" and "Submit application" (v3 Phase 4; docs/SPEC-AMENDMENTS.md §12 Decision 6;
 * Jobright's docked button), drawn under the field lists by the side panel and the in-page panel alike. Presentational:
 * the report says what the step offers (FrameReport.buttons, read by the run at rest) and the container presses
 * (ReportActions.onPress: the side panel's panel/press, the in-page panel's own run, each on the person's trusted
 * click). It shows only while no run works, for the first frame (or, with actionsFrameId, the frame) whose step offers
 * a button: Next on a step the adapter says is not the last, Submit on the last. A Submit the frame answers
 * 'required-empty' asks "N required fields are still empty. Submit anyway?" and presses again only on the person's
 * Submit anyway. A Submit pressed reads "Submitting…" until the report says more, also while the page disables its
 * own Submit as it sends (the review). A press the page did not accept says so, with how many fields it marked. Once
 * the platform confirmed the application (`submitted`, the tab's page state), the button reads "Submitted" and presses
 * nothing more (Jobright's "Submitted!"). The dock stays at the bottom of the panel's view (sticky). Nothing here is a
 * page's: a page can neither draw nor press it.
 *
 * jr8 WORKDAY (the owner's request of 2026-11-13): "Continue to the next page" shows on every step the adapter says is
 * not the last, whether or not it can be pressed now: enabled only when the page's own Next is there to press and no
 * required field of the step is empty (FrameReport.buttons.requiredLeft, the run's one reading with Next mode Auto:
 * content/required-left.ts), else disabled with why as its tooltip. It presses Next alone, never Submit.
 *
 * v5 p1-panel (the Phase 1 review, S2): what the dock's button means follows the page (Continue on a step not final,
 * Submit on the last, "Submit Anyway" once the frame said required fields are empty), so whenever that meaning changes
 * (its frame, its target, or the question) its button is disabled until the new words have been shown CONTROL_SEEN_MS
 * (ui/panel/seen.ts, as the main button): a click aimed at Continue never presses a Submit drawn under the pointer, and
 * a double-click on Submit never answers the question it raised with Submit Anyway. Time is the container's clock.
 */
import { useId, useState } from 'react';
import type { PressAnswer, StepTarget } from '../../messaging/schemas';
import { PAGE_COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { Icon } from '../brand/Icon';
import { BROWSER_SEEN_CLOCK, useShownFor, type SeenClock } from '../panel/seen';
import { isWorking } from './model';

/** The press the container makes for a frame: the frame's answer, or null when it could not be asked. */
export type PressAction = (frameId: number, target: StepTarget, confirmed: boolean) => Promise<PressAnswer | null>;

/** The frame and button the dock offers now, or null. */
export function dockOf(reports: readonly FrameReport[], actionsFrameId?: number):
  { frameId: number; target: StepTarget; pressed: boolean; held?: string } | null {
  if (reports.some(isWorking)) return null;
  for (const report of [...reports].sort((a, b) => a.frameId - b.frameId)) {
    if (actionsFrameId !== undefined && report.frameId !== actionsFrameId) continue;
    const buttons = report.buttons;
    if (buttons === undefined || report.mode === 'dry-run') continue;
    // A Submit pressed keeps its dock while the page disables its own button as it sends.
    if (buttons.final === 'final' && (buttons.submit || buttons.pressed === 'submit')) {
      return { frameId: report.frameId, target: 'submit', pressed: buttons.pressed === 'submit' };
    }
    // jr8 WORKDAY: on every step before the last, held (with why) while it may not be pressed.
    if (buttons.final === 'not-final') {
      const left = buttons.requiredLeft ?? 0;
      const held = left > 0 ? PAGE_COPY.panel.step.nextHeld(left) : buttons.next ? undefined
        : PAGE_COPY.panel.step.nextUnready;
      return { frameId: report.frameId, target: 'next', pressed: false, ...(held === undefined ? {} : { held }) };
    }
  }
  return null;
}

export function StepDock({ reports, onPress, actionsFrameId, submitted = false, clock = BROWSER_SEEN_CLOCK }: {
  reports: readonly FrameReport[]; onPress: PressAction; actionsFrameId?: number; submitted?: boolean;
  /** v5 p1-panel: the clock the hold is timed on (the container's; the browser's by default). */
  clock?: SeenClock }) {
  const dock = dockOf(reports, actionsFrameId);
  const questionId = useId();
  const heldId = useId(); // jr8 WORKDAY
  const [busy, setBusy] = useState(false);
  /** The required fields still empty, when the frame asked for the person's word (null: not asked). */
  const [confirming, setConfirming] = useState<{ frameId: number; count: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // v5 p1-panel (module header, S2): what the dock's button means now, held CONTROL_SEEN_MS before it takes a click.
  const askingNow = dock !== null && confirming !== null && confirming.frameId === dock.frameId && dock.target === 'submit'
    && !dock.pressed;
  const seen = useShownFor(dock === null || submitted ? 'none'
    : `${dock.frameId}|${dock.target}|${askingNow ? 'confirm' : 'press'}`, clock);
  if (submitted) {
    return (
      <section className="tia-dock" data-step-dock="submitted" aria-label={PAGE_COPY.panel.step.submitted}>
        <button type="button" className="tia-dock__button tia-dock__button--done" disabled data-step-action="submitted">
          <Icon name="check-circle" size={18} className="tia-icon" />
          {PAGE_COPY.panel.step.submitted}
        </button>
      </section>
    );
  }
  if (dock === null) return null;

  const press = async (confirmed: boolean) => {
    // Decided at the click, on what this render shows: a meaning not shown long enough is never acted on.
    if (!seen || dock.held !== undefined) return; // jr8 WORKDAY: a held Continue presses nothing
    setBusy(true);
    setSaid(null);
    const answer = await onPress(dock.frameId, dock.target, confirmed);
    setBusy(false);
    if (answer === null) {
      setSaid(PAGE_COPY.panel.failed);
      return;
    }
    // jr8 WORKDAY: only a Submit asks to go on anyway; a Continue the frame held says why.
    if (answer.outcome === 'required-empty' && !confirmed && dock.target === 'submit') {
      setConfirming({ frameId: dock.frameId, count: answer.count ?? 1 });
      return;
    }
    setConfirming(null);
    if (answer.outcome === 'not-accepted') setSaid(PAGE_COPY.panel.step.notAccepted(answer.count ?? 1));
    else if (answer.outcome !== 'pressed') setSaid(PAGE_COPY.panel.step.outcomes[answer.outcome]);
  };

  const submit = dock.target === 'submit';
  const waiting = submit && dock.pressed;
  const asking = askingNow;
  return (
    <section className="tia-dock" data-step-dock={dock.target} aria-label={submit ? PAGE_COPY.panel.step.submit : PAGE_COPY.panel.step.next}>
      {asking ? (
        <div className="tia-dock__confirm" role="alertdialog" aria-labelledby={questionId} data-step-confirm="">
          <p className="tia-dock__question" id={questionId}>{PAGE_COPY.panel.step.confirmEmpty(confirming.count)}</p>
          <div className="tia-dock__actions">
            <button type="button" className="tia-button tia-button--primary" disabled={busy || !seen}
              data-step-action="confirm" onClick={() => void press(true)}>{PAGE_COPY.panel.step.submitAnyway}</button>
            <button type="button" className="tia-button tia-button--quiet" disabled={busy}
              onClick={() => setConfirming(null)}>{PAGE_COPY.panel.step.keepEditing}</button>
          </div>
        </div>
      ) : (
        // jr8 WORKDAY: a Continue held says why on hover (its title, on the wrapper: a disabled button takes no pointer)
        // and to a screen reader (aria-describedby).
        <span className="tia-dock__hold" title={dock.held} data-step-held={dock.held === undefined ? undefined : ''}>
          <button type="button" className="tia-dock__button" disabled={busy || waiting || !seen || dock.held !== undefined}
            data-step-action={dock.target} aria-busy={busy || waiting ? 'true' : undefined}
            aria-describedby={dock.held === undefined ? undefined : heldId} onClick={() => void press(false)}>
            {(busy || waiting) && <Icon name="spinner" size={18} className="tia-icon tia-spin" />}
            {waiting ? PAGE_COPY.panel.step.submitting : submit ? PAGE_COPY.panel.step.submit : PAGE_COPY.panel.step.next}
            {!submit && !busy && <Icon name="chevron-right" size={18} className="tia-icon" />}
          </button>
          {dock.held !== undefined && <span className="tia-visually-hidden" id={heldId}>{dock.held}</span>}
        </span>
      )}
      {said !== null && <p className="tia-dock__said" role="status" data-step-said="">{said}</p>}
    </section>
  );
}
