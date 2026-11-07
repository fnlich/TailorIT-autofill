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
 */
import { useId, useState } from 'react';
import type { PressAnswer, StepTarget } from '../../messaging/schemas';
import { PAGE_COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { Icon } from '../brand/Icon';
import { isWorking } from './model';

/** The press the container makes for a frame: the frame's answer, or null when it could not be asked. */
export type PressAction = (frameId: number, target: StepTarget, confirmed: boolean) => Promise<PressAnswer | null>;

/** The frame and button the dock offers now, or null. */
export function dockOf(reports: readonly FrameReport[], actionsFrameId?: number):
  { frameId: number; target: StepTarget; pressed: boolean } | null {
  if (reports.some(isWorking)) return null;
  for (const report of [...reports].sort((a, b) => a.frameId - b.frameId)) {
    if (actionsFrameId !== undefined && report.frameId !== actionsFrameId) continue;
    const buttons = report.buttons;
    if (buttons === undefined || report.mode === 'dry-run') continue;
    // A Submit pressed keeps its dock while the page disables its own button as it sends.
    if (buttons.final === 'final' && (buttons.submit || buttons.pressed === 'submit')) {
      return { frameId: report.frameId, target: 'submit', pressed: buttons.pressed === 'submit' };
    }
    if (buttons.final === 'not-final' && buttons.next) return { frameId: report.frameId, target: 'next', pressed: false };
  }
  return null;
}

export function StepDock({ reports, onPress, actionsFrameId, submitted = false }: { reports: readonly FrameReport[];
  onPress: PressAction; actionsFrameId?: number; submitted?: boolean }) {
  const dock = dockOf(reports, actionsFrameId);
  const questionId = useId();
  const [busy, setBusy] = useState(false);
  /** The required fields still empty, when the frame asked for the person's word (null: not asked). */
  const [confirming, setConfirming] = useState<{ frameId: number; count: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
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
    setBusy(true);
    setSaid(null);
    const answer = await onPress(dock.frameId, dock.target, confirmed);
    setBusy(false);
    if (answer === null) {
      setSaid(PAGE_COPY.panel.failed);
      return;
    }
    if (answer.outcome === 'required-empty' && !confirmed) {
      setConfirming({ frameId: dock.frameId, count: answer.count ?? 1 });
      return;
    }
    setConfirming(null);
    if (answer.outcome === 'not-accepted') setSaid(PAGE_COPY.panel.step.notAccepted(answer.count ?? 1));
    else if (answer.outcome !== 'pressed') setSaid(PAGE_COPY.panel.step.outcomes[answer.outcome]);
  };

  const submit = dock.target === 'submit';
  const waiting = submit && dock.pressed;
  const asking = confirming !== null && confirming.frameId === dock.frameId && submit && !waiting;
  return (
    <section className="tia-dock" data-step-dock={dock.target} aria-label={submit ? PAGE_COPY.panel.step.submit : PAGE_COPY.panel.step.next}>
      {asking ? (
        <div className="tia-dock__confirm" role="alertdialog" aria-labelledby={questionId} data-step-confirm="">
          <p className="tia-dock__question" id={questionId}>{PAGE_COPY.panel.step.confirmEmpty(confirming.count)}</p>
          <div className="tia-dock__actions">
            <button type="button" className="tia-button tia-button--primary" disabled={busy} data-step-action="confirm"
              onClick={() => void press(true)}>{PAGE_COPY.panel.step.submitAnyway}</button>
            <button type="button" className="tia-button tia-button--quiet" disabled={busy}
              onClick={() => setConfirming(null)}>{PAGE_COPY.panel.step.keepEditing}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="tia-dock__button" disabled={busy || waiting}
          data-step-action={dock.target} aria-busy={busy || waiting ? 'true' : undefined} onClick={() => void press(false)}>
          {(busy || waiting) && <Icon name="spinner" size={18} className="tia-icon tia-spin" />}
          {waiting ? PAGE_COPY.panel.step.submitting : submit ? PAGE_COPY.panel.step.submit : PAGE_COPY.panel.step.next}
          {!submit && !busy && <Icon name="chevron-right" size={18} className="tia-icon" />}
        </button>
      )}
      {said !== null && <p className="tia-dock__said" role="status" data-step-said="">{said}</p>}
    </section>
  );
}
