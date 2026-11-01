/*
 * The review report: presentational React, props in and callbacks out, with no messaging, no browser API and no
 * storage. The side panel mounts it, and so does the in-page panel (src/content/ui/panel.tsx) in the page's closed
 * shadow root, so nothing here touches the global document: the stylesheet is adopted into the root the report is
 * mounted in.
 *
 * Layout: the notices on top (a policy card among them for each frame whose run waits for that decision; its buttons
 * decide for that frame alone, so another frame's pause or card is never answered by them; under its sentence, the
 * line saying when only TailorIT's saved copy of the posting said it, as the page's own card says), unless the
 * container draws them itself (ReportNotices: the side panel puts them above its main button); then the completion
 * (the rows ready of those ready or waiting for the person, as counts and never a percent, the required ones, a count
 * per status, and a line saying nothing needs the person only when no run works and no notice stands); then one block
 * per frame, with its run status and step (the adapter's progress line where the report has one), then its rows by
 * section, in report order.
 *
 * A row that needs the person (needsPerson: it asks for them, or it is flagged or blocked) is an open card: its label,
 * status, a reason sentence (COPY), its provenance, matcher stage and confidence, then its actions. Every other row
 * folds into one line (details/summary) that keeps its label, provenance and status in view, the rest a click away;
 * an AI draft keeps its mark and its dashed edge either way. No button ever sits in a summary. Each row carries
 * data-field-key, data-status, data-provenance, data-draft and data-layout for tests.
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
 * is opened (describeField) and held in the open row's state only, never stored or logged: a folded row that closes
 * forgets them.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '../../shared/copy';
import { noticeToneOf } from '../../shared/palette';
import type { FrameReport } from '../../shared/report';
import { Icon } from '../brand/Icon';
import {
  aiCountsOf, aiMarkOf, awaitsDraftConfirmation, combinedNotices, framesAtPolicyCard, needsPerson, offersSave, overallStatus,
  percent, policyFromStoredCopy, rowIconOf, sectionName, sectionsOf, stepText, stripToneOf, tallyOf, type ReportRow,
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
  /** Whether the report draws the notices on top (the default). The side panel draws them itself, above its main
   *  button, with ReportNotices. */
  notices?: boolean;
}

/** The whole report: notices, the completion, then each frame's rows. */
export function Report({ reports, notices = true, ...actions }: ReportProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) adoptReportStyles(root.current.getRootNode());
  }, []);
  const frames = [...reports].sort((a, b) => a.frameId - b.frameId);
  return (
    <div className="tia-report" ref={root}>
      {notices && <ReportNotices reports={frames} onPolicyDecision={actions.onPolicyDecision} busy={actions.busy ?? false} />}
      {frames.length === 0 ? (
        <p className="tia-empty">{COPY.panelEmpty}</p>
      ) : (
        <>
          <Completion reports={frames} />
          {frames.map((report) => <Frame key={report.frameId} report={report} actions={actions} />)}
        </>
      )}
    </div>
  );
}

/** The run status that most needs the person across the tab's frames, with its step ("Ready for your review · Step 2
 *  of 4"), as a strip toned by where the run stands; nothing without a report. The side panel and the in-page panel
 *  show it above the report. Its dot is drawn by the stylesheet, so its text is exactly the status and step. */
export function RunStatusLine({ reports, className = 'tia-status' }: { reports: readonly FrameReport[]; className?: string }) {
  const status = overallStatus(reports);
  if (status === null) return null;
  // The step of a frame at that status that tells steps apart (a frame whose adapter cannot has none).
  const step = reports.find((report) => report.status === status && report.step !== undefined)?.step;
  return (
    <p className={`${className} tia-strip`} data-run-status={status}
      data-tone={stripToneOf(status, tallyOf(reports)?.needsYou ?? 0)}>
      {COPY.runStatuses[status]}
      {step && ` · ${stepText(step)}`}
    </p>
  );
}

/** Every frame's notices once each, each with its tone's icon; the policy cards lead, one per frame whose run waits
 *  for the person's decision. When several wait, each card names its frame. */
export function ReportNotices({ reports, onPolicyDecision, busy = false }: {
  reports: readonly FrameReport[];
  onPolicyDecision?: ReportActions['onPolicyDecision'];
  busy?: boolean;
}) {
  const frames = [...reports].sort((a, b) => a.frameId - b.frameId);
  const waiting = framesAtPolicyCard(frames);
  const codes = combinedNotices(frames).filter((code) => !(waiting.length > 0 && code === 'policy'));
  if (waiting.length === 0 && codes.length === 0) return null;
  // Past the card, and in profile-only mode (the owner's amendments): the notice says where the statement was found
  // when every frame that reported that notice found it only in the saved copy.
  const storedOnly = (code: 'policy' | 'policy-profile-only') => {
    const said = frames.filter((report) => report.notices.some((notice) => notice.code === code));
    return said.length > 0 && said.every(policyFromStoredCopy);
  };
  return (
    <div className="tia-notices">
      {waiting.map((report) => (
        <div key={report.frameId} className="tia-notice tia-notice--policy" data-notice="policy" data-tone="warning"
          data-policy-frame={report.frameId} role="alert">
          <Icon name="alert" size={18} className="tia-icon tia-notice__icon" />
          <div className="tia-notice__body">
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
        </div>
      ))}
      {codes.map((code) => (code === 'policy' ? (
        <div key={code} className="tia-notice tia-notice--policy" data-notice={code} data-tone="warning" role="alert">
          <Icon name="alert" size={18} className="tia-icon tia-notice__icon" />
          <div className="tia-notice__body">
            <p className="tia-notice__text">{COPY.notices.policy}</p>
            {storedOnly(code) && <p className="tia-notice__source" data-notice-source="stored-copy">{COPY.policyFromStoredCopy}</p>}
          </div>
        </div>
      ) : code === 'policy-profile-only' && storedOnly(code) ? (
        <div key={code} className={`tia-notice tia-notice--${code}`} data-notice={code} data-tone={noticeToneOf(code)}>
          <Icon name={noticeToneOf(code) === 'info' ? 'info' : 'alert'} size={18} className="tia-icon tia-notice__icon" />
          <div className="tia-notice__body">
            <p className="tia-notice__text">{COPY.notices[code]}</p>
            <p className="tia-notice__source" data-notice-source="stored-copy">{COPY.policyFromStoredCopy}</p>
          </div>
        </div>
      ) : (
        <p key={code} className={`tia-notice tia-notice--${code}`} data-notice={code} data-tone={noticeToneOf(code)}
          role={code === 'tripwire' ? 'alert' : undefined}>
          <Icon name={noticeToneOf(code) === 'info' ? 'info' : 'alert'} size={18} className="tia-icon tia-notice__icon" />
          {COPY.notices[code]}
        </p>
      )))}
    </div>
  );
}

/**
 * How far the tab's forms are: the rows ready of those ready or waiting for the person, as counts and a bar; how many
 * wait; the required ones; a count per status. "Nothing needs you" only when nothing waits, something is ready, no run
 * still works and no notice stands (a notice can ask the person to check something, such as a posting the extension
 * could not read), and never in a dry run, which wrote nothing.
 */
function Completion({ reports }: { reports: readonly FrameReport[] }) {
  const labelId = useId();
  const tally = tallyOf(reports);
  if (tally === null) return null;
  const { ready, needsYou, required, dryRun, working } = tally;
  const of = ready + needsYou;
  const words = COPY.report;
  const ai = aiCountsOf(reports);
  const allClear = needsYou === 0 && ready > 0 && !working && !dryRun && combinedNotices(reports).length === 0
    && framesAtPolicyCard(reports).length === 0;
  return (
    <div className="tia-completion" data-completion="" data-ready={ready} data-needs={needsYou}>
      {of > 0 && (
        <>
          <div className="tia-completion__head">
            <span className="tia-completion__label" id={labelId}>{words.completion}</span>
            <span className="tia-completion__value">
              {dryRun ? words.completionValueDryRun(ready, of) : words.completionValue(ready, of)}
            </span>
          </div>
          <div className="tia-progress" role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={of}
            aria-valuenow={ready} aria-valuetext={dryRun ? words.completionTextDryRun(ready, of) : words.completionText(ready, of)}>
            {/* The width goes through the CSSOM (React's style property), which a page's style-src does not govern. */}
            <div className="tia-progress__fill" style={{ width: `${(ready / of) * 100}%` }} />
          </div>
        </>
      )}
      {needsYou > 0 && (
        <p className="tia-completion__needs">
          <Icon name="alert" size={16} />
          {dryRun ? words.needsYouDryRun(needsYou) : words.needsYou(needsYou)}
        </p>
      )}
      {ai.written > 0 && (
        <p className="tia-completion__ai" data-ai-answers={ai.written} data-ai-guesses={ai.guesses}>
          <Icon name="sparkle" size={14} />
          {words.aiAnswers(ai.written, ai.guesses)}
        </p>
      )}
      {allClear && (
        <p className="tia-allclear">
          <Icon name="check-circle" size={16} />
          {words.allClear}
        </p>
      )}
      {required.of > 0 && (
        <p className="tia-completion__required">
          {dryRun ? words.requiredReadyDryRun(required.ready, required.of) : words.requiredReady(required.ready, required.of)}
        </p>
      )}
      <ul className="tia-tally">
        {TALLY_ORDER.filter((status) => tally.byStatus[status] > 0).map((status) => (
          <li key={status} className={`tia-tag tia-tag--${status}`} data-tally={status}>
            {words.tally(tally.byStatus[status], COPY.statuses[status])}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The tally's order: what is done, then what waits, then what was left alone. */
const TALLY_ORDER = ['verified', 'filled', 'flagged', 'blocked', 'skipped'] as const;

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
        <p className="tia-frame__note tia-frame__note--pause">{COPY.pauseReasons[report.pauseReason]}</p>
      )}
      {report.mode === 'dry-run' && <p className="tia-frame__note tia-frame__note--dry-run">{COPY.report.dryRun}</p>}
      {report.counters.hiddenControlsIgnored > 0 && (
        <p className="tia-frame__note">{COPY.report.hiddenIgnored(report.counters.hiddenControlsIgnored)}</p>
      )}
      {sectionsOf(report.fields).map(({ section, rows }) => (
        <section className="tia-section" key={section}>
          <h3 className="tia-section__name">{sectionName(section)}</h3>
          <ul className="tia-rows">
            {/* Keyed by layout too: a row that turns from a card into a line starts afresh, its suggestions forgotten. */}
            {rows.map((row) => (
              <Row key={`${row.key}:${needsPerson(row) ? 'card' : 'line'}`} row={row} frameId={report.frameId}
                actions={acts ? actions : NO_ACTIONS} />
            ))}
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

/**
 * One field's row: an open card when it needs the person, else folded into a line. It renders only the fields it
 * names: never a value, whatever the object carries.
 */
function Row({ row, frameId, actions }: { row: ReportRow; frameId: number; actions: ReportActions }) {
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'closed' });
  const asked = useRef(0);
  const panelId = useId();
  const scores = row.detail?.suggestions ?? [];
  const { describeField, onShowField, onConfirmDraft, onSaveAnswer } = actions;
  const busy = actions.busy ?? false;
  const draft = row.provenance === 'llm-draft';
  const describe = describeField !== undefined && scores.length > 0;

  /** Forgets the labels: they live only while the row is open (a folded row's line too). */
  const forget = () => {
    asked.current += 1;
    setSuggestions({ state: 'closed' });
  };

  const toggle = () => {
    if (suggestions.state !== 'closed') {
      forget();
      return;
    }
    asked.current += 1;
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

  const label = (
    <span className="tia-row__label">
      {row.label || COPY.report.noLabel}
      {row.required && (
        <>
          <span className="tia-row__required" aria-hidden="true">*</span>
          <span className="tia-visually-hidden">{` (${COPY.report.required})`}</span>
        </>
      )}
    </span>
  );
  const draftMark = draft && (
    <span className="tia-row__draft">
      <Icon name="sparkle" size={12} />
      {COPY.report.draftMark}
    </span>
  );
  // The owner's amendments: an answer the AI wrote is marked "AI" (a draft keeps its own mark); one it guessed with
  // nothing to go on, "AI guess" (E1's rule and words; the review is the one place they show).
  const mark = aiMarkOf(row);
  const aiMark = mark === 'guess' ? (
    <span className="tia-row__ai tia-row__ai--guess" data-ai-mark="guess">
      <Icon name="sparkle" size={12} />
      {COPY.aiGuessChip}
    </span>
  ) : mark === 'written' && !draft ? (
    <span className="tia-row__ai" data-ai-mark="ai">
      <Icon name="sparkle" size={12} />
      {COPY.aiChip}
    </span>
  ) : null;
  const chip = <span className={`tia-chip tia-chip--${row.status}`}>{COPY.statuses[row.status]}</span>;
  const icon = <Icon name={rowIconOf(row)} size={18} className={`tia-icon tia-row__icon tia-row__icon--${row.status}`} />;
  // A cover letter (Phase G) comes from the person's TailorIT letters, whoever wrote it (the AI's has its mark).
  const source = row.provenance === null ? COPY.report.noSource
    : row.category === 'file.coverLetter' ? COPY.report.coverLetterSource : COPY.provenances[row.provenance];

  const body: ReactNode = (
    <div className="tia-row__body">
      <p className="tia-row__reason">{COPY.reasons[row.reason]}</p>
      <dl className="tia-row__facts">
        <div className="tia-row__fact">
          <dt>{COPY.report.source}</dt>
          <dd>{source}</dd>
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
            <button type="button" className="tia-button tia-button--quiet" data-action="show-field"
              onClick={() => onShowField(frameId, row.key)}>
              {COPY.report.showOnPage}
            </button>
          )}
          {describe && (
            <button type="button" className="tia-button tia-button--quiet" data-action="suggestions"
              aria-expanded={suggestions.state !== 'closed'} aria-controls={panelId} onClick={toggle}>
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
    </div>
  );

  const hooks = { 'data-field-key': row.key, 'data-status': row.status, 'data-provenance': row.provenance ?? 'none',
    'data-draft': draft ? 'true' : 'false' };
  if (needsPerson(row)) {
    return (
      <li className={`tia-row tia-row--card tia-row--${row.status}`} {...hooks} data-layout="card">
        <div className="tia-row__head">
          {icon}
          <span className="tia-row__title">
            {label}
            {draftMark}
            {aiMark}
          </span>
          {chip}
        </div>
        {body}
      </li>
    );
  }
  return (
    <li className={`tia-row tia-row--line tia-row--${row.status}`} {...hooks} data-layout="line">
      <details className="tia-row__more" onToggle={(event) => {
        // Folded again, the row forgets the options it asked for.
        if (!event.currentTarget.open && suggestions.state !== 'closed') forget();
      }}>
        <summary className="tia-row__line">
          {icon}
          <span className="tia-row__title">
            {label}
            {draftMark}
            {aiMark}
            <span className="tia-row__source">{source}</span>
          </span>
          {chip}
          <span className="tia-row__chevron">
            <Icon name="chevron-down" size={16} className="tia-icon tia-chevron tia-chevron--down" />
            <Icon name="chevron-up" size={16} className="tia-icon tia-chevron tia-chevron--up" />
          </span>
        </summary>
        {body}
      </details>
    </li>
  );
}
