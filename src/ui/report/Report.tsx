/*
 * The review report: presentational React, props in and callbacks out, with no messaging, no browser API and no
 * storage. The side panel mounts it, and so does the in-page panel (src/content/ui/panel.tsx) in the page's closed
 * shadow root, so nothing here touches the global document: the stylesheet is adopted into the root the report is
 * mounted in.
 *
 * Layout (v3 Phase 3, Jobright's sidebar in TailorIT's look): the notices on top (a policy card among them for each
 * frame whose run waits for that decision; its buttons decide for that frame alone, so another frame's pause or card is
 * never answered by them; under its sentence, the line saying when only TailorIT's saved copy of the posting said it,
 * as the page's own card says), unless the container draws them itself (ReportNotices: the side panel puts them above
 * its main button); then the progress, then the field lists.
 *
 * The progress: "Scanning the page…" with a moving bar while the form is read; "Autofilling… 78%" with Cancel while a
 * run fills; at rest "9 of 12 required fields filled · 75%" (shared/report.ts progressOf: the percent of the required
 * fields filled, of every field when none is required, one rule with the in-page panel and the launcher's badge). Its
 * line folds the lists (Minimized: folded at first). Under it, where a run waits for the person, its status and why
 * (the pause's sentence); a dry run says it wrote nothing; with several forms, or one embedded in its page, each says
 * where it stands.
 *
 * The field lists: the repeatable sections ("Education · 2 of 3 added"), then "Required", then "Optional", each row a
 * line: its state's icon (filled, needs you, being filled with a spinner, left alone), its label as a button that shows
 * the field on the page (Show on page: scrolled into view and focused, nothing drawn), the AI's marks, and a chevron
 * that unfolds the detail: its status chip, the reason sentence (COPY), its provenance, matcher stage and confidence,
 * then its actions. Every row is folded at first, its icon and label shown (Jobright's list); an optional field left
 * empty shows a grey dash, a required one the alert. The row being written scrolls into view, and
 * after SKIP_AFTER_MS on the same field it offers Skip, which gives up that one write (never a guard).
 *
 * Row actions, each drawn only when the container passes its callback (and, with actionsFrameId, only on that frame's
 * rows: the in-page panel acts on its own frame alone):
 * - Show on page (the label, and a button in the detail);
 * - the closest options, asked for when the row opens;
 * - Confirm draft, on an AI draft that still waits for the person;
 * - Save my answer, only on a row the run left flagged that the person then changed with their own input
 *   (detail.userEdited), and never on a question a saved answer may not answer (model.ts offersSave);
 * - Skip, on the row being written (the side panel only).
 * Each row carries data-field-key, data-status, data-provenance, data-draft, data-layout and data-progress for tests.
 *
 * No value is ever shown: a report holds none, and a row renders only the fields named above, whatever else an object
 * might carry. The one page text beyond labels and progress lines is a row's suggested options, asked for when the row
 * is opened (describeField) and held in the open row's state only, never stored or logged: a row that folds forgets
 * them.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { COPY } from '../../shared/copy';
import type { IconName } from '../../shared/icons';
import { noticeToneOf } from '../../shared/palette';
import type { FrameReport } from '../../shared/report';
import { Icon } from '../brand/Icon';
import { afterFrames, animationFrames, type FrameScheduler } from '../page/frames';
import {
  aiCountsOf, aiMarkOf, awaitsDraftConfirmation, combinedNotices, fieldListsOf, framesAtPolicyCard, needsPerson,
  offersSave, overallStatus, percent, policyFromStoredCopy, progressOf, progressStateOf, repeatablesOf, stepText,
  stripToneOf, tallyOf, type ListRow, type ReportRow, type RowProgress,
} from './model';
import { StepDock, type PressAction } from './StepDock';
import { adoptReportStyles } from './styles';

/** Brings a row into view where the report is drawn: on an extension page of its own (the side panel), as the page
 *  scrolls; inside a shadow root (the in-page panel on the site's page), only within its nearest scrolling ancestor in
 *  that root, so the site's page never moves. */
function reveal(el: HTMLElement): void {
  const root = el.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    el.scrollIntoView?.({ block: 'nearest' });
    return;
  }
  const view = el.ownerDocument.defaultView;
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const overflow = view?.getComputedStyle(at).overflowY ?? 'visible';
    if ((overflow !== 'auto' && overflow !== 'scroll') || at.scrollHeight <= at.clientHeight) continue;
    const box = el.getBoundingClientRect();
    const port = at.getBoundingClientRect();
    if (box.top < port.top) at.scrollTop -= port.top - box.top;
    else if (box.bottom > port.bottom) at.scrollTop += box.bottom - port.bottom;
    return;
  }
}

/** Skip shows on the field being written once the run has been on it this long (Jobright's 2 s). */
export const SKIP_AFTER_MS = 2_000;

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
  /** Cancel on the progress line while a run works (the side panel sends panel/cancel). */
  onCancel?(): void;
  /** Skip on the field being written, after SKIP_AFTER_MS on it (the side panel sends panel/skip). */
  onSkip?(frameId: number, fieldKey: string): void;
  /** v3 Phase 4: the dock's "Continue to the next page" and "Submit application" (StepDock.tsx), for the frame whose
   *  step offers it (the side panel sends panel/press; the in-page panel presses its own run). */
  onPress?: PressAction;
  /** The review: the platform confirmed the tab's application (PageState.submitted): the dock reads "Submitted", and
   *  the progress line's Cancel and Skip are not drawn. */
  submitted?: boolean;
  /** While true, the policy card's and the rows' buttons that change something wait (a request is on its way). */
  busy?: boolean;
  /** When set, the row actions apply to this frame's rows only (the in-page panel can act on its own frame alone). */
  actionsFrameId?: number;
  /** Skip's clock: the time (ms) and the frames it is checked on; the browser's by default (tests pass their own). */
  clock?: { now(): number; frames: FrameScheduler };
}

export interface ReportProps extends ReportActions {
  /** The tab's reports, one per frame. */
  reports: readonly FrameReport[];
  /** Whether the report draws the notices on top (the default). The side panel draws them itself, above its main
   *  button, with ReportNotices. */
  notices?: boolean;
  /** The field lists folded at first, the progress line alone in view (the person's default view: Minimized). */
  minimized?: boolean;
}

/** The whole report: notices, the progress, then the field lists. */
export function Report({ reports, notices = true, minimized = false, ...actions }: ReportProps) {
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
        <Progress reports={frames} actions={actions} minimized={minimized} />
      )}
      {actions.onPress !== undefined && (
        <StepDock reports={frames} onPress={actions.onPress} submitted={actions.submitted === true}
          {...(actions.actionsFrameId === undefined ? {} : { actionsFrameId: actions.actionsFrameId })} />
      )}
    </div>
  );
}

/** The run status that most needs the person across the tab's frames, with its step ("Ready for your review · Step 2
 *  of 4"), as a strip toned by where the run stands; nothing without a report. The in-page panel shows it above the
 *  report. Its dot is drawn by the stylesheet, so its text is exactly the status and step. */
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

/** The run statuses whose frame line says more than the progress does: a decision, a sign-in, a pause, a stop. */
const TELLING_STATUSES: ReadonlySet<FrameReport['status']> = new Set<FrameReport['status']>(['policy-notice',
  'auth-needed', 'handoff', 'stopped']);

/**
 * How far the tab's forms are (module header): the line ("Scanning the page…", "Autofilling… 78%", "9 of 12 required
 * fields filled · 75%"), its bar, Cancel while a run works, what each frame waits for, then the field lists, which the
 * line folds, and under them what needs the person, the AI's answers, and "Nothing needs you" only when nothing waits,
 * something is ready, no run works and no notice stands (never in a dry run, which wrote nothing).
 */
function Progress({ reports, actions, minimized }: { reports: readonly FrameReport[]; actions: ReportActions;
  minimized: boolean }) {
  const titleId = useId();
  const listsId = useId();
  const [open, setOpen] = useState(!minimized);
  // The view chosen in the gear's menu applies at once, with no new report (the report is never mounted again for it).
  const lastView = useRef(minimized);
  useEffect(() => {
    if (lastView.current === minimized) return;
    lastView.current = minimized;
    setOpen(!minimized);
  }, [minimized]);
  const state = progressStateOf(reports);
  const progress = progressOf(reports);
  const tally = tallyOf(reports);
  const dryRun = reports.every((report) => report.mode === 'dry-run');
  const working = state === 'scanning' || state === 'filling';
  const words = COPY.report;
  const lists = fieldListsOf(reports);
  const sections = repeatablesOf(reports);
  const hasRows = lists.required.length + lists.optional.length + sections.length > 0;
  // What is left for the person is said once the run rests: while it works, a field may still be on its way.
  const needsYou = working ? 0 : tally?.needsYou ?? 0;
  const ai = aiCountsOf(reports);
  const allClear = !working && needsYou === 0 && (tally?.ready ?? 0) > 0 && !dryRun
    && combinedNotices(reports).length === 0 && framesAtPolicyCard(reports).length === 0;
  const title = state === 'scanning' ? words.scanning : state === 'filling' ? words.autofilling
    : dryRun ? words.progressDryRun(progress.filled, progress.of, progress.requiredOnly)
      : words.progressFilled(progress.filled, progress.of, progress.requiredOnly);
  const head = (
    <>
      <span className="tia-progress-line__title" id={titleId}>
        {title}
        {working && <span className="tia-dots" aria-hidden="true"><span /><span /><span /></span>}
      </span>
      {state !== 'scanning' && (
        <>
          <span className="tia-progress-line__rule" aria-hidden="true" />
          <span className="tia-progress-line__percent" data-percent={progress.percent}>{words.percent(progress.percent)}</span>
        </>
      )}
    </>
  );
  const named = reports.length > 1 || reports.some((report) => report.frameId !== 0);
  // The hidden fields left alone are no part of the lists: a detail under them (v3 Phase 3 review).
  const hidden = reports.reduce((sum, report) => sum + report.counters.hiddenControlsIgnored, 0);
  // A run at rest with nothing counted and no row (a new step it has not read: page-turned) says no "0 of 0 · 0%":
  // only what each frame waits for, and the notices above.
  const counted = state !== 'rest' || progress.of > 0 || hasRows;
  return (
    <section className="tia-progress-block" data-progress={state} data-filled={progress.filled} data-of={progress.of}
      {...(counted ? { 'aria-labelledby': titleId } : { 'aria-label': words.progressLabel })}>
      {counted && (
        <>
          <div className="tia-progress-line">
            {hasRows ? (
              <button type="button" className="tia-progress-line__toggle" aria-expanded={open} aria-controls={listsId}
                data-action="toggle-fields" title={open ? words.hideFields : words.showFields}
                onClick={() => setOpen((was) => !was)}>
                {head}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="tia-icon tia-progress-line__chevron" />
              </button>
            ) : (
              <p className="tia-progress-line__toggle tia-progress-line__static">{head}</p>
            )}
            {working && actions.onCancel && (
              <button type="button" className="tia-linkbutton" data-action="cancel" onClick={actions.onCancel}>
                {COPY.panel.cancel}
              </button>
            )}
          </div>
          <div className="tia-progress" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100}
            data-indeterminate={state === 'scanning' ? '' : undefined}
            {...(state === 'scanning' ? {} : { 'aria-valuenow': progress.percent,
              'aria-valuetext': working ? words.progressWorking(progress.percent, progress.requiredOnly)
                : words.progressText(progress.filled, progress.of, progress.requiredOnly, progress.percent) })}>
            {/* The width goes through the CSSOM (React's style property), which a page's style-src does not govern. */}
            <div className="tia-progress__fill" style={state === 'scanning' ? undefined : { width: `${progress.percent}%` }} />
          </div>
        </>
      )}
      {state === 'scanning' && (
        <div className="tia-scanning">
          <Icon name="sparkle" size={28} className="tia-icon tia-scanning__icon" />
          <p className="tia-scanning__title">{words.scanningTitle}</p>
          <p className="tia-scanning__help">{words.scanningHelp}</p>
        </div>
      )}
      <FrameLines reports={reports} named={named} />
      {hasRows && open && (
        <div className="tia-lists" id={listsId}>
          {sections.length > 0 && (
            <ul className="tia-rows tia-rows--sections">
              {sections.map((section) => {
                const done = section.added >= section.of ? 'filled' : 'missing';
                return (
                  <li key={`${section.frameId}:${section.kind}`} className="tia-row tia-row--section"
                    data-section-kind={section.kind} data-progress={done}>
                    <div className="tia-row__line">
                      <StateIcon progress={done} />
                      <span className="tia-row__go tia-row__go--static">
                        {words.sectionAdded(words.repeatables[section.kind], section.added, section.of)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldGroup name={words.requiredGroup} group="required" rows={lists.required} actions={actions} />
          <FieldGroup name={words.optionalGroup} group="optional" rows={lists.optional} actions={actions} />
        </div>
      )}
      {hidden > 0 && (
        <details className="tia-progress-details" data-progress-details="">
          <summary className="tia-progress-details__summary">{words.moreDetails}</summary>
          <p className="tia-progress-details__line" data-hidden-ignored={hidden}>{words.hiddenIgnored(hidden)}</p>
        </details>
      )}
      {(needsYou > 0 || ai.written > 0 || allClear) && (
        <div className="tia-progress-notes">
          {needsYou > 0 && (
            <p className="tia-progress-notes__needs" data-needs={needsYou}>
              <Icon name="alert" size={16} />
              {dryRun ? words.needsYouDryRun(needsYou) : words.needsYou(needsYou)}
            </p>
          )}
          {ai.written > 0 && (
            <p className="tia-progress-notes__ai" data-ai-answers={ai.written} data-ai-guesses={ai.guesses}>
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
        </div>
      )}
    </section>
  );
}

/** What each frame waits for, when that says more than the progress: a decision, a sign-in, a pause and why, a stop, a
 *  step; that a dry run wrote nothing; hidden fields left alone. With several forms, or one embedded in its page, each
 *  names its form, its own run status beside it. */
function FrameLines({ reports, named }: { reports: readonly FrameReport[]; named: boolean }) {
  const lines = reports.map((report) => {
    const status = `${COPY.runStatuses[report.status]}${report.step ? ` · ${stepText(report.step)}` : ''}`;
    const notes: Array<{ key: string; text: string; tone: string }> = [];
    if (report.status === 'handoff' && report.pauseReason !== null) {
      notes.push({ key: 'pause', text: COPY.pauseReasons[report.pauseReason], tone: 'pause' });
    }
    if (report.mode === 'dry-run') notes.push({ key: 'dry-run', text: COPY.report.dryRun, tone: 'dry-run' });
    return { report, status, notes, telling: TELLING_STATUSES.has(report.status) || report.step !== undefined };
  }).filter((line) => named || line.telling || line.notes.length > 0);
  if (lines.length === 0) return null;
  return (
    <div className="tia-frames">
      {lines.map(({ report, status, notes, telling }) => (
        <section key={report.frameId} className="tia-frame" data-frame-id={report.frameId}>
          {(named || telling) && (
            <p className="tia-frame__head">
              {named && <span className="tia-frame__name">{COPY.report.frame(COPY.platforms[report.platform],
                report.frameId !== 0)}</span>}
              <span className="tia-frame__status" data-run-status={report.status}>{status}</span>
            </p>
          )}
          {notes.map((note) => (
            <p key={note.key} className={`tia-frame__note tia-frame__note--${note.tone}`}>{note.text}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** One of the two lists: its heading and its rows; nothing when it has none. */
function FieldGroup({ name, group, rows, actions }: { name: string; group: 'required' | 'optional';
  rows: readonly ListRow[]; actions: ReportActions }) {
  const headingId = useId();
  if (rows.length === 0) return null;
  return (
    <section className="tia-group" data-group={group} aria-labelledby={headingId}>
      <h3 className="tia-group__name" id={headingId}>{name}</h3>
      <ul className="tia-rows">
        {/* Keyed by layout too: a row that turns from a card into a line starts afresh, its suggestions forgotten. */}
        {rows.map((entry) => {
          const acts = actions.actionsFrameId === undefined || actions.actionsFrameId === entry.frameId;
          return (
            <Row key={`${entry.frameId}:${entry.row.key}:${needsPerson(entry.row) ? 'card' : 'line'}`} entry={entry}
              actions={acts ? actions : NO_ACTIONS} />
          );
        })}
      </ul>
    </section>
  );
}

const NO_ACTIONS: ReportActions = {};

/** A row's state icon (Jobright's three, and a dash for a question left alone), with its words for a screen reader. */
function StateIcon({ progress, required = true }: { progress: RowProgress; required?: boolean }) {
  // An optional field left for the person is no alarm: a grey dash, as Jobright's list draws it (v3 Phase 3 review).
  const optionalLeft = progress === 'missing' && !required;
  const icon: IconName = progress === 'filled' ? 'check-circle' : optionalLeft ? 'dash' : progress === 'missing' ? 'alert'
    : progress === 'working' ? 'spinner' : 'minus-circle';
  return (
    <span className={`tia-row__state tia-row__state--${optionalLeft ? 'optional' : progress}`}>
      <Icon name={icon} size={18} className={`tia-icon${progress === 'working' ? ' tia-spin' : ''}`} />
      <span className="tia-visually-hidden">{COPY.report.rowStates[progress]}</span>
    </span>
  );
}

/** A row's suggested options: closed, being asked for, unavailable, or shown (held while the row is open, nowhere else). */
type Suggestions =
  | { state: 'closed' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'shown'; labels: readonly SuggestionLabel[] };

/**
 * One field's row (module header): folded at first, its icon and label shown. It renders only the fields it names:
 * never a value, whatever the object carries.
 */
function Row({ entry, actions }: { entry: ListRow; actions: ReportActions }) {
  const { row, frameId, progress, current } = entry;
  const card = needsPerson(row);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'closed' });
  const asked = useRef(0);
  const item = useRef<HTMLLIElement>(null);
  const bodyId = useId();
  const panelId = useId();
  const scores = row.detail?.suggestions ?? [];
  const { describeField, onShowField, onConfirmDraft, onSaveAnswer } = actions;
  const busy = actions.busy ?? false;
  const draft = row.provenance === 'llm-draft';
  const describe = describeField !== undefined && scores.length > 0;
  const label = row.label || COPY.report.noLabel;

  // The row being written comes into view (Jobright's list follows the fill): in the side panel, its own page; in the
  // in-page panel, only the panel's own scrolling list, never the page around it (v3 Phase 3 review).
  useEffect(() => {
    if (current && item.current !== null) reveal(item.current);
  }, [current]);

  /** Forgets the labels: they live only while the row is open. */
  const forget = () => {
    asked.current += 1;
    setSuggestions({ state: 'closed' });
  };

  const fold = () => {
    if (open && suggestions.state !== 'closed') forget();
    setOpen((was) => !was);
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
  // A cover letter (Phase G) comes from the person's TailorIT letters, whoever wrote it (the AI's has its mark).
  const source = row.provenance === null ? COPY.report.noSource
    : row.category === 'file.coverLetter' ? COPY.report.coverLetterSource : COPY.provenances[row.provenance];
  const title = (
    <>
      <span className="tia-row__label">{label}</span>
      {draftMark}
      {aiMark}
    </>
  );

  const body: ReactNode = (
    <div className="tia-row__body" id={bodyId}>
      <p className="tia-row__reason">
        <span className={`tia-chip tia-chip--${row.status}`}>{COPY.statuses[row.status]}</span>
        {' '}
        {COPY.reasons[row.reason]}
        {row.detail?.letterLength !== undefined && (
          <> {COPY.report.letterLength(row.detail.letterLength.length, row.detail.letterLength.limit)}</>
        )}
      </p>
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

  return (
    <li ref={item} className={`tia-row tia-row--${card ? 'card' : 'line'} tia-row--${row.status}`}
      data-field-key={row.key} data-status={row.status} data-provenance={row.provenance ?? 'none'}
      data-draft={draft ? 'true' : 'false'} data-layout={card ? 'card' : 'line'} data-progress={progress}
      data-current={current ? 'true' : undefined}>
      <div className="tia-row__line">
        <StateIcon progress={progress} required={row.required} />
        {onShowField ? (
          <button type="button" className="tia-row__go" title={COPY.report.goTo(label)}
            onClick={() => onShowField(frameId, row.key)}>
            {title}
          </button>
        ) : (
          <span className="tia-row__go tia-row__go--static">{title}</span>
        )}
        {current && actions.onSkip !== undefined && (
          <SkipButton frameId={frameId} row={row} onSkip={actions.onSkip} clock={actions.clock ?? BROWSER_CLOCK} />
        )}
        <button type="button" className="tia-row__toggle" aria-expanded={open} aria-controls={bodyId}
          aria-label={COPY.report.details(label)} title={COPY.report.details(label)} onClick={fold}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="tia-icon" />
        </button>
      </div>
      {open && body}
    </li>
  );
}

/** The browser's clock for Skip: the time and its animation frames, which run only while the panel is visible. */
const BROWSER_CLOCK = { now: () => Date.now(), frames: animationFrames };

/** Skip on the field being written, once the run has been on it SKIP_AFTER_MS (Jobright's 2 s): it gives up that one
 *  write. Its clock starts with the row's turn (the button is mounted only on the current row), and starts afresh for
 *  the next field; it ticks on animation frames, never a timer. */
function SkipButton({ frameId, row, onSkip, clock }: { frameId: number; row: ReportRow;
  onSkip(frameId: number, key: string): void; clock: NonNullable<ReportActions['clock']> }) {
  const [shown, setShown] = useState(false);
  const [sent, setSent] = useState(false);
  const { now, frames } = clock;
  useEffect(() => afterFrames(SKIP_AFTER_MS, () => setShown(true), now, frames), [now, frames]);
  if (!shown) return null;
  const label = row.label || COPY.report.noLabel;
  return (
    <button type="button" className="tia-linkbutton tia-row__skip" data-action="skip" disabled={sent}
      aria-label={COPY.report.skipLabel(label)} onClick={() => {
        setSent(true);
        onSkip(frameId, row.key);
      }}>
      {COPY.report.skip}
    </button>
  );
}
