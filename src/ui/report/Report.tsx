/*
 * The review report: presentational React, props in and callbacks out, with no messaging, no browser API and no
 * storage. The side panel mounts it, and so does the in-page panel (src/content/ui/panel.tsx) in the page's closed
 * shadow root, so nothing here touches the global document: the stylesheet is adopted into the root the report is
 * mounted in.
 *
 * Layout: the notices on top (a policy card among them for each frame whose run waits for that decision; its buttons
 * decide for that frame alone, so another frame's pause or card is never answered by them; under its sentence, the
 * line saying when only TailorIT's saved copy of the posting said it, as the page's own card says), then one block
 * per frame, with its run status and step (the adapter's progress line where the report has one), then its rows by
 * section. A row shows the label, status, provenance, matcher stage, confidence and a reason sentence (COPY), and
 * carries data-field-key, data-status, data-provenance and data-draft for tests.
 *
 * Row actions, each drawn only when the container passes its callback (and, with actionsFrameId, only on that frame's
 * rows: the in-page panel acts on its own frame alone):
 * - Show on page;
 * - the closest options, asked for when the row opens;
 * - Confirm draft, on an AI draft that still waits for the person (Phase 6 wave 2 wires what it does);
 * - Save my answer, only on a row the run left flagged that the person then changed with their own input
 *   (detail.userEdited), and never on a question a saved answer may not answer (model.ts offersSave).
 *
 * No value is ever shown: a report holds none, and a row renders only the fields named above, whatever else an object
 * might carry. The one page text beyond labels and progress lines is a row's suggested options, asked for when the row
 * is opened (describeField) and held in the open row's state only, never stored or logged.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import {
  awaitsDraftConfirmation, combinedNotices, framesAtPolicyCard, offersSave, overallStatus, percent, policyFromStoredCopy,
  sectionsOf, stepText, type ReportRow,
} from './model';
import { adoptReportStyles } from './styles';

/** The visible label of one suggested option, by its index among the field's options. */
export interface SuggestionLabel {
  index: number;
  label: string;
}

/** The person's choice at a policy card: 'fill' is Fill anyway, 'cancel' is Cancel. */
export type PolicyCardDecision = 'fill' | 'cancel';

/** What a report's buttons ask the container to do. Each is optional: without it, its buttons are not drawn. */
export interface ReportActions {
  /** "Show on page" (the side panel sends panel/focus). */
  onShowField?(frameId: number, fieldKey: string): void;
  /** The labels of a row's suggested options, asked for when the row opens (the side panel sends panel/describe).
   *  Null when the page could not say. */
  describeField?(frameId: number, fieldKey: string): Promise<readonly SuggestionLabel[] | null>;
  /** "Confirm draft" on an AI draft that waits for the person (the side panel sends panel/confirmDraft). */
  onConfirmDraft?(frameId: number, fieldKey: string): void;
  /** "Save my answer" on a flagged row the person fixed themselves (the side panel sends panel/saveAnswer). */
  onSaveAnswer?(frameId: number, fieldKey: string): void;
  /** A policy card's buttons, for the frame whose run waits at it: Fill anyway is 'fill', Cancel is 'cancel' (the side
   *  panel sends panel/policyDecision for that frame). */
  onPolicyDecision?(frameId: number, decision: PolicyCardDecision): void;
  /** While true, the policy card's and the rows' buttons that change something wait (a request is on its way). */
  busy?: boolean;
  /** When set, the row actions apply to this frame's rows only (the in-page panel can act on its own frame alone). */
  actionsFrameId?: number;
}

export interface ReportProps extends ReportActions {
  /** The tab's reports, one per frame. */
  reports: readonly FrameReport[];
}

/** The whole report: notices, then each frame's rows. */
export function Report({ reports, ...actions }: ReportProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) adoptReportStyles(root.current.getRootNode());
  }, []);
  const frames = [...reports].sort((a, b) => a.frameId - b.frameId);
  return (
    <div className="tia-report" ref={root}>
      <Notices reports={frames} onPolicyDecision={actions.onPolicyDecision} busy={actions.busy ?? false} />
      {frames.length === 0 ? (
        <p className="tia-empty">{COPY.panelEmpty}</p>
      ) : (
        frames.map((report) => <Frame key={report.frameId} report={report} actions={actions} />)
      )}
    </div>
  );
}

/** The run status that most needs the person across the tab's frames, with its step ("Ready for your review · Step 2
 *  of 4"); nothing without a report. The side panel and the in-page panel show it above the report. */
export function RunStatusLine({ reports, className = 'tia-status' }: { reports: readonly FrameReport[]; className?: string }) {
  const status = overallStatus(reports);
  if (status === null) return null;
  // The step of a frame at that status that tells steps apart (a frame whose adapter cannot has none).
  const step = reports.find((report) => report.status === status && report.step !== undefined)?.step;
  return (
    <p className={className} data-run-status={status}>
      {COPY.runStatuses[status]}
      {step && ` · ${stepText(step)}`}
    </p>
  );
}

/** Every frame's notices once each; the policy cards lead, one per frame whose run waits for the person's decision.
 *  When several wait, each card names its frame. */
function Notices({ reports, onPolicyDecision, busy }: {
  reports: readonly FrameReport[];
  onPolicyDecision: ReportActions['onPolicyDecision'];
  busy: boolean;
}) {
  const waiting = framesAtPolicyCard(reports);
  const codes = combinedNotices(reports).filter((code) => !(waiting.length > 0 && code === 'policy'));
  if (waiting.length === 0 && codes.length === 0) return null;
  // Past the card: the policy notice says where it was found when every frame that reported it found it only in the
  // saved copy.
  const policyFrames = reports.filter((report) => report.notices.some((notice) => notice.code === 'policy'));
  const storedOnly = policyFrames.length > 0 && policyFrames.every(policyFromStoredCopy);
  return (
    <div className="tia-notices">
      {waiting.map((report) => (
        <div key={report.frameId} className="tia-notice tia-notice--policy" data-notice="policy"
          data-policy-frame={report.frameId} role="alert">
          <p className="tia-notice__text">{COPY.notices.policy}</p>
          {policyFromStoredCopy(report) && (
            <p className="tia-notice__source" data-notice-source="stored-copy">{COPY.policyFromStoredCopy}</p>
          )}
          {waiting.length > 1 && (
            <p className="tia-notice__text">{COPY.report.frame(COPY.platforms[report.platform], report.frameId !== 0)}</p>
          )}
          {onPolicyDecision && (
            <div className="tia-notice__actions">
              <button type="button" className="tia-button tia-button--primary" disabled={busy}
                onClick={() => onPolicyDecision(report.frameId, 'fill')}>{COPY.policyFillAnyway}</button>
              <button type="button" className="tia-button" disabled={busy}
                onClick={() => onPolicyDecision(report.frameId, 'cancel')}>{COPY.policyCancel}</button>
            </div>
          )}
        </div>
      ))}
      {codes.map((code) => (code === 'policy' ? (
        <div key={code} className="tia-notice tia-notice--policy" data-notice={code} role="alert">
          <p className="tia-notice__text">{COPY.notices.policy}</p>
          {storedOnly && <p className="tia-notice__source" data-notice-source="stored-copy">{COPY.policyFromStoredCopy}</p>}
        </div>
      ) : (
        <p key={code} className={`tia-notice tia-notice--${code}`} data-notice={code}
          role={code === 'tripwire' ? 'alert' : undefined}>
          {COPY.notices[code]}
        </p>
      )))}
    </div>
  );
}

/** One frame: what it is, where its run stands, then its rows by section. */
function Frame({ report, actions }: { report: FrameReport; actions: ReportActions }) {
  const titleId = useId();
  const platform = COPY.platforms[report.platform];
  const acts = actions.actionsFrameId === undefined || actions.actionsFrameId === report.frameId;
  return (
    <section className="tia-frame" data-frame-id={report.frameId} aria-labelledby={titleId}>
      <header className="tia-frame__head">
        <h2 className="tia-frame__name" id={titleId}>{COPY.report.frame(platform, report.frameId !== 0)}</h2>
        <span className="tia-frame__status" data-run-status={report.status}>
          {COPY.runStatuses[report.status]}
          {report.step && ` · ${stepText(report.step)}`}
        </span>
      </header>
      {report.status === 'handoff' && report.pauseReason !== null && (
        <p className="tia-frame__note">{COPY.pauseReasons[report.pauseReason]}</p>
      )}
      {report.mode === 'dry-run' && <p className="tia-frame__note">{COPY.report.dryRun}</p>}
      {report.counters.hiddenControlsIgnored > 0 && (
        <p className="tia-frame__note">{COPY.report.hiddenIgnored(report.counters.hiddenControlsIgnored)}</p>
      )}
      {sectionsOf(report.fields).map(({ section, rows }) => (
        <section className="tia-section" key={section}>
          <h3 className="tia-section__name">{section || COPY.report.untitledSection}</h3>
          <ul className="tia-rows">
            {rows.map((row) => <Row key={row.key} row={row} frameId={report.frameId} actions={acts ? actions : NO_ACTIONS} />)}
          </ul>
        </section>
      ))}
    </section>
  );
}

const NO_ACTIONS: ReportActions = {};

/** A row's suggested options: closed, being asked for, unavailable, or shown (held while the row is open, nowhere else). */
type Suggestions =
  | { state: 'closed' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'shown'; labels: readonly SuggestionLabel[] };

/** One field's row. It renders only the fields it names: never a value, whatever the object carries. */
function Row({ row, frameId, actions }: { row: ReportRow; frameId: number; actions: ReportActions }) {
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'closed' });
  const asked = useRef(0);
  const panelId = useId();
  const scores = row.detail?.suggestions ?? [];
  const { describeField, onShowField, onConfirmDraft, onSaveAnswer } = actions;
  const busy = actions.busy ?? false;
  const draft = row.provenance === 'llm-draft';
  const describe = describeField !== undefined && scores.length > 0;

  const toggle = () => {
    asked.current += 1;
    if (suggestions.state !== 'closed') {
      // Closing forgets the labels: they live only while the row is open.
      setSuggestions({ state: 'closed' });
      return;
    }
    if (!describeField) return;
    const ask = asked.current;
    setSuggestions({ state: 'loading' });
    describeField(frameId, row.key).then(
      (labels) => {
        if (asked.current === ask) setSuggestions(labels === null ? { state: 'failed' } : { state: 'shown', labels });
      },
      () => {
        if (asked.current === ask) setSuggestions({ state: 'failed' });
      },
    );
  };

  const confirmButton = onConfirmDraft !== undefined && awaitsDraftConfirmation(row) && (
    <button type="button" className="tia-button tia-button--primary" data-action="confirm-draft" disabled={busy}
      onClick={() => onConfirmDraft(frameId, row.key)}>
      {COPY.report.confirmDraft}
    </button>
  );
  const saveButton = onSaveAnswer !== undefined && offersSave(row) && (
    <button type="button" className="tia-button tia-button--primary" data-action="save-answer" disabled={busy}
      onClick={() => onSaveAnswer(frameId, row.key)}>
      {COPY.report.saveAnswer}
    </button>
  );

  return (
    <li className="tia-row" data-field-key={row.key} data-status={row.status} data-provenance={row.provenance ?? 'none'}
      data-draft={draft ? 'true' : 'false'}>
      <div className="tia-row__head">
        <span className="tia-row__label">
          {row.label || COPY.report.noLabel}
          {row.required && (
            <>
              <span className="tia-row__required" aria-hidden="true">*</span>
              <span className="tia-visually-hidden">{` (${COPY.report.required})`}</span>
            </>
          )}
          {draft && <span className="tia-row__draft">{COPY.report.draftMark}</span>}
        </span>
        <span className={`tia-chip tia-chip--${row.status}`}>{COPY.statuses[row.status]}</span>
      </div>
      <p className="tia-row__reason">{COPY.reasons[row.reason]}</p>
      <dl className="tia-row__facts">
        <div className="tia-row__fact">
          <dt>{COPY.report.source}</dt>
          <dd>{row.provenance === null ? COPY.report.noSource : COPY.provenances[row.provenance]}</dd>
        </div>
        <div className="tia-row__fact">
          <dt>{COPY.report.match}</dt>
          <dd>{COPY.stages[row.matcherStage]}</dd>
        </div>
        <div className="tia-row__fact">
          <dt>{COPY.report.confidence}</dt>
          <dd>{percent(row.confidence)}</dd>
        </div>
      </dl>
      {(onShowField || describe || confirmButton || saveButton) && (
        <div className="tia-row__actions">
          {confirmButton}
          {saveButton}
          {onShowField && (
            <button type="button" className="tia-button" data-action="show-field" onClick={() => onShowField(frameId, row.key)}>
              {COPY.report.showOnPage}
            </button>
          )}
          {describe && (
            <button type="button" className="tia-button" data-action="suggestions" aria-expanded={suggestions.state !== 'closed'}
              aria-controls={panelId} onClick={toggle}>
              {suggestions.state === 'closed' ? COPY.report.showSuggestions(scores.length) : COPY.report.hideSuggestions}
            </button>
          )}
        </div>
      )}
      {suggestions.state !== 'closed' && (
        <div className="tia-suggestions" id={panelId}>
          {suggestions.state === 'loading' && <p className="tia-suggestions__heading">{COPY.report.suggestionsLoading}</p>}
          {suggestions.state === 'failed' && <p className="tia-suggestions__heading">{COPY.report.suggestionsFailed}</p>}
          {suggestions.state === 'shown' && (
            <>
              <p className="tia-suggestions__heading">{COPY.report.suggestionsHeading}</p>
              <ol className="tia-suggestions__list">
                {suggestions.labels.map((option) => {
                  const score = scores.find((suggestion) => suggestion.index === option.index)?.score;
                  return (
                    <li key={option.index} data-option-index={option.index}>
                      {option.label}
                      {score !== undefined && <span className="tia-suggestions__score">{` (${percent(score)})`}</span>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </li>
  );
}
