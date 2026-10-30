/*
 * The review report: presentational React, props in and callbacks out, with no messaging, no browser API and no
 * storage. The side panel mounts it now; Phase 6's in-page panel will mount the same components in a closed shadow
 * root, so nothing here touches the global document: the stylesheet is adopted into the root the report is mounted in.
 *
 * Layout: the notices on top (the policy card among them while a run waits for that decision), then one block per
 * frame, its rows by section. A row shows the label, status, provenance, matcher stage, confidence and a reason
 * sentence (COPY), and carries data-field-key, data-status and data-provenance for tests.
 *
 * No value is ever shown: a report holds none, and a row renders only the fields named above, whatever else an object
 * might carry. The one page text beyond labels is a row's suggested options, asked for when the row is opened
 * (describeField) and held in the open row's state only, never stored or logged.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { awaitsPolicyDecision, combinedNotices, percent, sectionsOf, type ReportRow } from './model';
import { adoptReportStyles } from './styles';

/** The visible label of one suggested option, by its index among the field's options. */
export interface SuggestionLabel {
  index: number;
  label: string;
}

/** What a report's buttons ask the container to do. Each is optional: without it, its buttons are not drawn. */
export interface ReportActions {
  /** "Show on page" (the side panel sends panel/focus). */
  onShowField?(frameId: number, fieldKey: string): void;
  /** The labels of a row's suggested options, asked for when the row opens (the side panel sends panel/describe).
   *  Null when the page could not say. */
  describeField?(frameId: number, fieldKey: string): Promise<readonly SuggestionLabel[] | null>;
  /** The policy card's buttons: Fill anyway is 'continue', Cancel is 'cancel'. */
  onPolicyDecision?(decision: 'continue' | 'cancel'): void;
  /** While true, the policy card's buttons wait (a decision is on its way). */
  busy?: boolean;
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

/** Every frame's notices once each; the policy card leads while a run waits for the person's decision. */
function Notices({ reports, onPolicyDecision, busy }: {
  reports: readonly FrameReport[];
  onPolicyDecision: ReportActions['onPolicyDecision'];
  busy: boolean;
}) {
  const waiting = awaitsPolicyDecision(reports);
  const codes = combinedNotices(reports).filter((code) => !(waiting && code === 'policy'));
  if (!waiting && codes.length === 0) return null;
  return (
    <div className="tia-notices">
      {waiting && (
        <div className="tia-notice tia-notice--policy" data-notice="policy" role="alert">
          <p className="tia-notice__text">{COPY.notices.policy}</p>
          {onPolicyDecision && (
            <div className="tia-notice__actions">
              <button type="button" className="tia-button tia-button--primary" disabled={busy}
                onClick={() => onPolicyDecision('continue')}>{COPY.policyFillAnyway}</button>
              <button type="button" className="tia-button" disabled={busy}
                onClick={() => onPolicyDecision('cancel')}>{COPY.policyCancel}</button>
            </div>
          )}
        </div>
      )}
      {codes.map((code) => (
        <p key={code} className={`tia-notice tia-notice--${code}`} data-notice={code}
          role={code === 'tripwire' || code === 'policy' ? 'alert' : undefined}>
          {COPY.notices[code]}
        </p>
      ))}
    </div>
  );
}

/** One frame: what it is, where its run stands, then its rows by section. */
function Frame({ report, actions }: { report: FrameReport; actions: ReportActions }) {
  const titleId = useId();
  const platform = COPY.platforms[report.platform];
  return (
    <section className="tia-frame" data-frame-id={report.frameId} aria-labelledby={titleId}>
      <header className="tia-frame__head">
        <h2 className="tia-frame__name" id={titleId}>{COPY.report.frame(platform, report.frameId !== 0)}</h2>
        <span className="tia-frame__status" data-run-status={report.status}>
          {COPY.runStatuses[report.status]}
          {report.step && ` · ${COPY.report.step(report.step.index, report.step.of)}`}
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
            {rows.map((row) => <Row key={row.key} row={row} frameId={report.frameId} actions={actions} />)}
          </ul>
        </section>
      ))}
    </section>
  );
}

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
  const { describeField, onShowField } = actions;

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

  return (
    <li className="tia-row" data-field-key={row.key} data-status={row.status} data-provenance={row.provenance ?? 'none'}>
      <div className="tia-row__head">
        <span className="tia-row__label">
          {row.label || COPY.report.noLabel}
          {row.required && (
            <span className="tia-row__required" title={COPY.report.required} aria-label={COPY.report.required}>*</span>
          )}
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
      {(onShowField || (describeField && scores.length > 0)) && (
        <div className="tia-row__actions">
          {onShowField && (
            <button type="button" className="tia-button" onClick={() => onShowField(frameId, row.key)}>
              {COPY.report.showOnPage}
            </button>
          )}
          {describeField && scores.length > 0 && (
            <button type="button" className="tia-button" aria-expanded={suggestions.state !== 'closed'} aria-controls={panelId}
              onClick={toggle}>
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
