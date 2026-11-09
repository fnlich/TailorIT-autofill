/*
 * The review report: presentational React, props in and callbacks out, with no messaging, no browser API and no
 * storage. The side panel mounts it, and so does the in-page panel (src/content/ui/panel.tsx) in the page's closed
 * shadow root, so nothing here touches the global document: the stylesheet is adopted into the root the report is
 * mounted in.
 *
 * Layout (v3 Phase 3, Jobright's sidebar in TailorIT's look): the notices on top (a policy card among them for each
 * frame whose run waits for that decision; its buttons decide for that frame alone), unless the container leaves them
 * out (`notices` false: the side panel, which since v4 shows no notice at all: D10's page notifications say what
 * remains for the person); then the progress, then the field lists.
 *
 * The progress: "Scanning the page…" with a moving bar while the form is read; "Autofilling… 78%" with Cancel while a
 * run fills; at rest "7/7 required fields filled | 100%" (shared/report.ts progressOf: the percent of the required
 * fields filled, of every field when none is required, one rule with the in-page panel and the launcher's badge). Its
 * line folds the lists (Minimized: folded at first). Under it, with several forms, or one embedded in its page, or a
 * run that stopped or waits, each form says where it stands (its run status and step); a dry run says it wrote nothing.
 *
 * The field lists (v4 ui, the owner's "never flag": D1, D6, D8): the repeatable sections ("Education · 2 of 3
 * added"), then "Required", then "Optional", each row a line: a teal tick when filled, an empty grey circle when not,
 * a spinner while it is written, and its label as a button that shows the field on the page (Show on page: scrolled
 * into view and focused, nothing drawn). No status chip, no reason sentence, no "AI"/"AI guess" mark, no alert or cross,
 * no "Needs you", no Save my answer; a row the run leaves out (shared/report.ts leftOut: a guard's refusal, a honeypot,
 * a field hidden from people, one with no visible label, one whose label addresses AI tools) is neither listed nor
 * counted (model.ts shownReports). The row being written scrolls into view, and after SKIP_AFTER_MS
 * on the same field it offers Skip, which gives up that one write (never a guard).
 *
 * The résumé and cover-letter rows (file.resume, file.coverLetter, freeText.coverLetter; v4 ui): on the right, Preview
 * (an eye) where the container says there is a file to preview (previewOf: the PDF the fill attached or would attach),
 * which unfolds the preview under the row (renderPreview, the container's; v1.4 F: or opens it elsewhere, openPreview:
 * the side panel's full-window preview page), Show, which shows the field on the page,
 * and the container's own tool where it has one (rowTool: the side panel's résumé Change after a run).
 *
 * Row actions, each drawn only when the container passes its callback (and, with actionsFrameId, only on that frame's
 * rows: the in-page panel acts on its own frame alone):
 * - Show on page (the label);
 * - the in-page panel's drawer (a chevron that unfolds Show on page, the closest options asked for when it opens, and
 *   Confirm draft on an AI draft that still waits for the person), only where the container passes describeField or
 *   onConfirmDraft; the side panel passes neither, so its rows are Jobright's plain lines;
 * - Skip, on the row being written (the side panel only).
 * Each row carries data-field-key, data-status, data-provenance, data-draft, data-layout and data-progress for tests.
 *
 * No value is ever shown: a report holds none, and a row renders only the fields named above, whatever else an object
 * might carry. The one page text beyond labels and progress lines is a row's suggested options, asked for when the
 * in-page panel's drawer is opened (describeField) and held in the open row's state only, never stored or logged: a
 * row that folds forgets them.
 *
 * v5 p1-panel (PLAN decisions 3 and 4, Jobright's progress sheet):
 * - The words are Title Case ("7/9 Required Fields Filled | 77%", "Scanning The Page").
 * - In the panel's sheet (`sheet`, ui/panel/Sheet.tsx) the header is the sheet's: it folds the sheet at rest (the
 *   panel's SheetControl) and has no fold while a run works; the bar, the scanning block, where each form stands and
 *   the lists scroll under it. The in-page panel's inline report is as before.
 * - The lists (model.ts sheetListsOf): Education and Work Experience fields in blocks of their sections are entries
 *   under their section's heading ("Education 1", "Education 2"), each with Go To (its first field shown on the page)
 *   and its fields as rows; the section's heading carries the run's count as a chip ("2/3 Added", Jobright's partial
 *   toggle, folding the entries) and the profile's entries the form shows no block for read "Not Added". Then the
 *   repeatable sections no entry lists ("Languages 1/2 Added"), then Required and Optional as before. The progress still
 *   counts every row.
 * - A run at its sign-in pause shows the account step (model.ts accountStepOf): "Signing In" or "Creating Account"
 *   (the tab's wall, `wall`), a spinner while Sign-in Auto signs in for it, when the header says so too.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PAGE_COPY } from '../../shared/copy';
import type { IconName } from '../../shared/icons';
import { noticeToneOf } from '../../shared/palette';
import type { FrameReport } from '../../shared/report';
import { Icon } from '../brand/Icon';
import { afterFrames, animationFrames, type FrameScheduler } from '../page/frames';
import {
  accountStepOf, awaitsDraftConfirmation, combinedNotices, framesAtPolicyCard, needsPerson, overallStatus, percent,
  policyFromStoredCopy, progressOf, progressStateOf, sheetListsOf, shownReports, stepText, stripToneOf, tallyOf,
  type EntryGroup, type ListRow, type ReportRow, type RowProgress,
} from './model';
import { StepDock, type PressAction } from './StepDock';
import { useShownFor } from '../panel/seen';
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

/** v4 ui: the file a résumé or cover-letter row previews. */
export type PreviewKind = 'resume' | 'coverLetter';

/** v4 ui: the rows that offer Preview and Show: the résumé's, and the cover letter's (an upload or a text box). */
export const FILE_ROWS: ReadonlySet<ReportRow['category']> = new Set<ReportRow['category']>(['file.resume',
  'file.coverLetter', 'freeText.coverLetter']);

/** What a report's buttons ask the container to do. Each is optional: without it, its buttons are not drawn. */
export interface ReportActions {
  /** "Show on page" (the side panel sends panel/focus). */
  onShowField?(frameId: number, fieldKey: string): void;
  /** The labels of a row's suggested options, asked for when its drawer opens (the in-page panel's). Null when the page
   *  could not say. With it, a row has the drawer. */
  describeField?(frameId: number, fieldKey: string): Promise<readonly SuggestionLabel[] | null>;
  /** "Confirm draft" on an AI draft that waits for the person, in the row's drawer (the in-page panel's). With it, a
   *  row has the drawer. Since v4 (D6) no draft waits, so it is not drawn in practice. */
  onConfirmDraft?(frameId: number, fieldKey: string): void;
  /** Not drawn since v4 (D6: Save my answer is not offered); kept so a container that passes it still fits. */
  onSaveAnswer?(frameId: number, fieldKey: string): void;
  /** A policy card's buttons, for the frame whose run waits at it: Fill anyway is 'fill', Cancel is 'cancel' (the side
   *  panel sends panel/policyDecision for that frame). */
  onPolicyDecision?(frameId: number, decision: PolicyCardDecision): void;
  /** Cancel on the progress line while a run works (the side panel sends panel/cancel). */
  onCancel?(): void;
  /** v5 p1-panel (the Phase 1 review, F4): Continue on the progress line while the run waits for the person's word (a
   *  hand-off, a sign-in: the container passes it only then), since the sheet lies over the main button that sends it.
   *  It takes no click until shown CONTROL_SEEN_MS on `clock`, as the main button. */
  onContinue?(): void;
  /** Skip on the field being written, after SKIP_AFTER_MS on it (the side panel sends panel/skip). It may answer
   *  whether the run took it: false (the frame no longer writes that field, 'expired') offers the button again (the
   *  audit of 2026-11-06, m5). */
  onSkip?(frameId: number, fieldKey: string): void | Promise<boolean>;
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
  /** v4 ui: which file a résumé or cover-letter row previews (the PDF the fill attached or would attach), or null for
   *  none; absent: no Preview anywhere. */
  previewOf?(row: ReportRow): PreviewKind | null;
  /** v4 ui: the preview itself, drawn under its row; `close` folds it. Without it (and without openPreview), no
   *  Preview. */
  renderPreview?(kind: PreviewKind, label: string, close: () => void): ReactNode;
  /** v1.4 F (PLAN decision 17): Preview opens the file elsewhere (the side panel's full-window preview page), in place
   *  of unfolding it under the row. */
  openPreview?(kind: PreviewKind): void;
  /** v1.5 X (PLAN decision 3, the owner: "`show` right of preview should be `edit`"): the résumé row's Edit, in place
   *  of its Show: TailorIT's editor for the resume a fill attaches (the worker's, with its confirm for an upload).
   *  Absent: Show as before. Every other row keeps Show. */
  openEdit?(kind: PreviewKind): void;
  /** v4 ui: a résumé or cover-letter row's own tool beside Preview and Show (the side panel's résumé Change after a
   *  run): its button's words, its data-action, and what it unfolds under the row; null for none. */
  rowTool?(row: ReportRow): { label: string; action: string; render(close: () => void): ReactNode } | null;
  /** s2 profile (settings version 7): the page's TailorIT notifications may not be there (`modes.notifications` other
   *  than 'until-closed': timed, they go while the run still waits; 'off', none is drawn), so the line of a frame whose
   *  run paused says what it waits for (its pause reason), as the page's toast would have. */
  saysWaits?: boolean;
}

/** v5 p1-panel: the progress sheet (PLAN decision 4): the panel's sheet holds the report's header and its lists, and
 *  folds them itself. */
export interface SheetControl {
  /** Whether the sheet is up (its lists shown) or folded to its header's strip. */
  open: boolean;
  /** The header's click at rest: up or folded (absent: the header does not fold it, as while a run works). */
  onToggle?(): void;
}

export interface ReportProps extends ReportActions {
  /** The tab's reports, one per frame. */
  reports: readonly FrameReport[];
  /** Whether the report draws the notices on top (the default). The side panel draws them itself, above its main
   *  button, with ReportNotices. */
  notices?: boolean;
  /** The field lists folded at first, the progress line alone in view (the person's default view: Minimized). */
  minimized?: boolean;
  /** v5 p1-panel: drawn in the panel's progress sheet: the header is the sheet's own (it folds the sheet, not the lists),
   *  and what is under it scrolls inside the sheet. Absent: the in-page panel's inline report, as before. */
  sheet?: SheetControl;
  /** v5 p1-panel: the account wall the tab's page shows (PageState.wall), so a run signing in there reads "Signing In"
   *  or "Creating Account" (Jobright's step rows). */
  wall?: 'sign-in' | 'create-account' | 'email-gate' | null;
}

/** The whole report: notices, the progress, then the field lists. */
export function Report({ reports, notices = true, minimized = false, sheet, wall = null, ...actions }: ReportProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) adoptReportStyles(root.current.getRootNode());
  }, []);
  const frames = [...reports].sort((a, b) => a.frameId - b.frameId);
  return (
    <div className={sheet === undefined ? 'tia-report' : 'tia-report tia-report--sheet'} ref={root}>
      {notices && <ReportNotices reports={frames} onPolicyDecision={actions.onPolicyDecision} busy={actions.busy ?? false} />}
      {frames.length === 0 ? (
        <p className="tia-empty">{PAGE_COPY.panelEmpty}</p>
      ) : (
        <Progress reports={frames} actions={actions} minimized={minimized} sheet={sheet} wall={wall} />
      )}
      {actions.onPress !== undefined && (
        <StepDock reports={frames} onPress={actions.onPress} submitted={actions.submitted === true}
          clock={actions.clock ?? BROWSER_CLOCK}
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
      {PAGE_COPY.runStatuses[status]}
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
            <p className="tia-notice__text">{PAGE_COPY.notices.policy}</p>
            {policyFromStoredCopy(report) && (
              <p className="tia-notice__source" data-notice-source="stored-copy">{PAGE_COPY.policyFromStoredCopy}</p>
            )}
            {waiting.length > 1 && (
              <p className="tia-notice__text">{PAGE_COPY.report.frame(PAGE_COPY.platforms[report.platform], report.frameId !== 0)}</p>
            )}
            {onPolicyDecision && (
              <div className="tia-notice__actions">
                <button type="button" className="tia-button tia-button--primary" disabled={busy}
                  onClick={() => onPolicyDecision(report.frameId, 'fill')}>{PAGE_COPY.policyFillAnyway}</button>
                <button type="button" className="tia-button" disabled={busy}
                  onClick={() => onPolicyDecision(report.frameId, 'cancel')}>{PAGE_COPY.policyCancel}</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {codes.map((code) => (code === 'policy' ? (
        <div key={code} className="tia-notice tia-notice--policy" data-notice={code} data-tone="warning" role="alert">
          <Icon name="alert" size={18} className="tia-icon tia-notice__icon" />
          <div className="tia-notice__body">
            <p className="tia-notice__text">{PAGE_COPY.notices.policy}</p>
            {storedOnly(code) && <p className="tia-notice__source" data-notice-source="stored-copy">{PAGE_COPY.policyFromStoredCopy}</p>}
          </div>
        </div>
      ) : code === 'policy-profile-only' && storedOnly(code) ? (
        <div key={code} className={`tia-notice tia-notice--${code}`} data-notice={code} data-tone={noticeToneOf(code)}>
          <Icon name={noticeToneOf(code) === 'info' ? 'info' : 'alert'} size={18} className="tia-icon tia-notice__icon" />
          <div className="tia-notice__body">
            <p className="tia-notice__text">{PAGE_COPY.notices[code]}</p>
            <p className="tia-notice__source" data-notice-source="stored-copy">{PAGE_COPY.policyFromStoredCopy}</p>
          </div>
        </div>
      ) : (
        <p key={code} className={`tia-notice tia-notice--${code}`} data-notice={code} data-tone={noticeToneOf(code)}
          role={code === 'tripwire' ? 'alert' : undefined}>
          <Icon name={noticeToneOf(code) === 'info' ? 'info' : 'alert'} size={18} className="tia-icon tia-notice__icon" />
          {PAGE_COPY.notices[code]}
        </p>
      )))}
    </div>
  );
}

/** The run statuses whose frame line says more than the progress does: a decision, a sign-in, a pause, a stop. */
const TELLING_STATUSES: ReadonlySet<FrameReport['status']> = new Set<FrameReport['status']>(['policy-notice',
  'auth-needed', 'handoff', 'stopped']);

/**
 * How far the tab's forms are (module header): the line ("Scanning the page…", "Autofilling… 78%", "7/7 required
 * fields filled | 100%"), its bar, Cancel while a run works, where each form stands when that says more, then the field
 * lists, which the line folds. Blocked rows are neither counted nor listed (v4 ui, D8). Nothing under the lists: no
 * "fields left for you", no AI count, no "Nothing needs you", no hidden-field note (v4 ui, D1, D6, D8).
 */
function Progress({ reports, actions, minimized, sheet, wall }: { reports: readonly FrameReport[];
  actions: ReportActions; minimized: boolean; sheet: SheetControl | undefined; wall: ReportProps['wall'] }) {
  const titleId = useId();
  const listsId = useId();
  const [openHere, setOpenHere] = useState(!minimized);
  // The view chosen in the settings applies at once, with no new report (the report is never mounted again for it).
  const lastView = useRef(minimized);
  useEffect(() => {
    if (lastView.current === minimized) return;
    lastView.current = minimized;
    setOpenHere(!minimized);
  }, [minimized]);
  // v5 p1-panel: in the panel's sheet, the sheet is what folds (SheetControl), not the lists inside it.
  const open = sheet === undefined ? openHere : sheet.open;
  const fold = sheet === undefined ? () => setOpenHere((was) => !was) : sheet.onToggle;
  const shown = shownReports(reports);
  const state = progressStateOf(shown);
  const progress = progressOf(shown);
  const dryRun = reports.every((report) => report.mode === 'dry-run');
  const words = PAGE_COPY.report;
  // v5 p1-panel: the sheet's lists: the sections of entries, then the Required and Optional rows (model.ts sheetListsOf),
  // and the account step of a run at its sign-in (accountStepOf).
  const lists = sheetListsOf(reports);
  const account = accountStepOf(reports, wall);
  const signing = account !== null && account.progress === 'working';
  const working = state === 'scanning' || state === 'filling' || signing;
  const hasRows = lists.required.length + lists.optional.length + lists.groups.length + lists.counts.length > 0
    || account !== null;
  const status = overallStatus(reports);
  // A run at rest with nothing counted and no row (a new step it has not read, after a page turn) says no "0/0 · 0%": only
  // where each form stands; the sheet's header then says where the run stands.
  const counted = state !== 'rest' || progress.of > 0 || hasRows;
  const title = signing ? (account.kind === 'create-account' ? words.creatingAccount : words.signingIn)
    : state === 'scanning' ? words.scanning : state === 'filling' ? words.autofilling
      : !counted && status !== null ? PAGE_COPY.runStatuses[status]
        : dryRun ? words.progressDryRun(progress.filled, progress.of, progress.requiredOnly)
          : words.progressFilled(progress.filled, progress.of, progress.requiredOnly);
  const head = (
    <>
      <span className="tia-progress-line__title" id={titleId}>
        {title}
        {working && <span className="tia-dots" aria-hidden="true"><span /><span /><span /></span>}
      </span>
      {state !== 'scanning' && !signing && counted && (
        <>
          <span className="tia-progress-line__rule" aria-hidden="true" />
          <span className="tia-progress-line__percent" data-percent={progress.percent}>{words.percent(progress.percent)}</span>
        </>
      )}
    </>
  );
  const named = reports.length > 1 || reports.some((report) => report.frameId !== 0);
  // The header folds: the inline report's lists (when it has rows), or the sheet (at rest, when the panel lets it).
  const folds = sheet === undefined ? hasRows : fold !== undefined;
  const line = (counted || sheet !== undefined) && (
    <div className="tia-progress-line">
      {folds ? (
        <button type="button" className="tia-progress-line__toggle" aria-expanded={open}
          aria-controls={sheet === undefined ? listsId : `${listsId}-body`}
          data-action={sheet === undefined ? 'toggle-fields' : 'toggle-sheet'}
          title={sheet === undefined ? (open ? words.hideFields : words.showFields) : open ? words.hideSheet : words.showSheet}
          onClick={() => fold?.()}>
          {head}
          <Icon name={open ? (sheet === undefined ? 'chevron-up' : 'chevron-down') : (sheet === undefined ? 'chevron-down'
            : 'chevron-up')} size={18} className="tia-icon tia-progress-line__chevron" />
        </button>
      ) : (
        <p className="tia-progress-line__toggle tia-progress-line__static">{head}</p>
      )}
      {working && actions.onCancel && (
        <button type="button" className="tia-linkbutton" data-action="cancel" onClick={actions.onCancel}>
          {PAGE_COPY.panel.cancel}
        </button>
      )}
      {!working && actions.onContinue !== undefined && (
        <ContinueButton onContinue={actions.onContinue} clock={actions.clock ?? BROWSER_CLOCK} />
      )}
    </div>
  );
  const bar = counted && (
    <div className="tia-progress" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100}
      data-indeterminate={state === 'scanning' ? '' : undefined}
      {...(state === 'scanning' ? {} : { 'aria-valuenow': progress.percent,
        'aria-valuetext': working ? words.progressWorking(progress.percent, progress.requiredOnly)
          : words.progressText(progress.filled, progress.of, progress.requiredOnly, progress.percent) })}>
      {/* The width goes through the CSSOM (React's style property), which a page's style-src does not govern. */}
      <div className="tia-progress__fill" style={state === 'scanning' ? undefined : { width: `${progress.percent}%` }} />
    </div>
  );
  const scanning = state === 'scanning' && (
    <div className="tia-scanning">
      <Icon name="sparkle" size={28} className="tia-icon tia-scanning__icon" />
      <p className="tia-scanning__title">{words.scanningTitle}</p>
      <p className="tia-scanning__help">{words.scanningHelp}</p>
    </div>
  );
  const listed = hasRows && open && (
    <div className="tia-lists" id={listsId}>
      {account !== null && <AccountStep kind={account.kind} progress={account.progress} />}
      {lists.groups.map((group) => (
        <EntryGroupView key={`${group.frameId}:${group.kind}`} group={group}
          actions={actions.actionsFrameId === undefined || actions.actionsFrameId === group.frameId ? actions : NO_ACTIONS} />
      ))}
      {lists.counts.length > 0 && (
        <ul className="tia-rows tia-rows--sections">
          {lists.counts.map((section) => {
            const done = section.added >= section.of ? 'filled' : 'missing';
            return (
              <li key={`${section.frameId}:${section.kind}`} className="tia-row tia-row--section"
                data-section-kind={section.kind} data-progress={done}>
                <div className="tia-row__line">
                  <StateIcon progress={done} />
                  <span className="tia-row__go tia-row__go--static">{words.repeatables[section.kind]}</span>
                  <span className="tia-entries__count">{words.partial(section.added, section.of)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <FieldGroup name={words.requiredGroup} group="required" rows={lists.required} actions={actions} />
      <FieldGroup name={words.optionalGroup} group="optional" rows={lists.optional} actions={actions} />
    </div>
  );
  const blockProps = {
    'data-progress': state, 'data-filled': progress.filled, 'data-of': progress.of,
    ...(counted || sheet !== undefined ? { 'aria-labelledby': titleId } : { 'aria-label': words.progressLabel }),
  };
  if (sheet !== undefined) {
    // v5 p1-panel (PLAN decision 4): the header stays at the sheet's top, its strip all that shows while folded; the bar,
    // the scanning block, where each form stands and the lists scroll under it while it is up.
    return (
      <section className="tia-progress-block tia-progress-block--sheet" data-open={open ? '' : undefined} {...blockProps}>
        {line}
        {open && (
          <div className="tia-sheet__body" id={`${listsId}-body`}>
            {bar}
            {scanning}
            <FrameLines reports={reports} named={named} saysWaits={actions.saysWaits === true} />
            {listed}
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="tia-progress-block" {...blockProps}>
      {counted && line}
      {bar}
      {scanning}
      <FrameLines reports={reports} named={named} saysWaits={actions.saysWaits === true} />
      {listed}
    </section>
  );
}

/** v5 p1-panel: the account step of a run at its sign-in pause (model.ts accountStepOf; Jobright's "Signing in" and
 *  "Creating account" rows): a spinner while Sign-in Auto signs in for the run, an empty circle while the page waits
 *  for the person (its toast says what). */
function AccountStep({ kind, progress }: { kind: 'sign-in' | 'create-account'; progress: RowProgress }) {
  const words = PAGE_COPY.report;
  return (
    <ul className="tia-rows tia-rows--steps">
      <li className="tia-row tia-row--step" data-account-step={kind} data-progress={progress}>
        <div className="tia-row__line">
          <StateIcon progress={progress} />
          <span className="tia-row__go tia-row__go--static">
            <span className="tia-row__label">{kind === 'create-account' ? words.creatingAccount : words.signingIn}</span>
          </span>
        </div>
      </li>
    </ul>
  );
}

/**
 * v5 p1-panel: a section of entries (model.ts EntryGroup; Jobright's Education and Employment results): its heading
 * with its state, the run's count as a chip ("2/3 Added", Jobright's partial toggle) and a chevron, unfolded at first;
 * then each entry ("Education 1") with Go To, which shows its first field on the page, and its fields as rows; then the
 * profile's entries the form shows no block for, "Not Added". Labels and counts only: an entry is named by its place,
 * never by what it holds.
 */
function EntryGroupView({ group, actions }: { group: EntryGroup; actions: ReportActions }) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const words = PAGE_COPY.report;
  const name = words.repeatables[group.kind];
  const { onShowField } = actions;
  return (
    <section className="tia-entries" data-section-kind={group.kind} data-progress={group.progress}
      aria-label={name}>
      <div className="tia-entries__head">
        <StateIcon progress={group.progress === 'none' ? 'missing' : group.progress} />
        <span className="tia-entries__name">{name}</span>
        <button type="button" className="tia-entries__toggle" aria-expanded={open} aria-controls={listId}
          data-action="toggle-entries" aria-label={group.count === null ? words.sectionToggle(name)
            : words.partialLabel(name, group.count.added, group.count.of)} onClick={() => setOpen((was) => !was)}>
          {group.count !== null && (
            <span className="tia-entries__count" data-added={group.count.added} data-of={group.count.of}>
              {words.partial(group.count.added, group.count.of)}
            </span>
          )}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="tia-icon" />
        </button>
      </div>
      {open && (
        <ol className="tia-entries__list" id={listId}>
          {group.entries.map((entry) => {
            const entryName = words.entry(name, entry.place);
            const first = entry.rows[0];
            return (
              <li key={entry.block} className="tia-entry" data-entry-place={entry.place} data-progress={entry.progress}>
                <div className="tia-entry__head">
                  <StateIcon progress={entry.progress === 'none' ? 'missing' : entry.progress} />
                  <span className="tia-entry__name">{entryName}</span>
                  {onShowField && first !== undefined && (
                    <button type="button" className="tia-entry__go" data-action="go-to-entry"
                      aria-label={words.goToEntry(entryName)} onClick={() => onShowField(first.frameId, first.row.key)}>
                      {words.goToButton}
                    </button>
                  )}
                </div>
                <ul className="tia-rows tia-entry__rows">
                  {entry.rows.map((each) => (
                    <Row key={`${each.frameId}:${each.row.key}:${needsPerson(each.row) ? 'open' : 'done'}`} entry={each}
                      actions={actions} />
                  ))}
                </ul>
              </li>
            );
          })}
          {group.notAdded.map((place) => (
            <li key={`not-${place}`} className="tia-entry tia-entry--not-added" data-entry-place={place}
              data-progress="missing" data-not-added="">
              <div className="tia-entry__head">
                <StateIcon progress="missing" />
                <span className="tia-entry__name">{words.entry(name, place)}</span>
                <span className="tia-entry__note">{words.notAdded}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Where each form stands, when that says more than the progress: a decision, a sign-in, a pause, a stop, a step; that
 *  a dry run wrote nothing. With several forms, or one embedded in its page, each names its form, its own run status
 *  beside it. What a paused run waits for is said on the page (v4 ui, D10), not here, unless the page's notification
 *  may not be there (`saysWaits`, s2 profile): then its pause reason is said under its line. */
function FrameLines({ reports, named, saysWaits }: { reports: readonly FrameReport[]; named: boolean;
  saysWaits: boolean }) {
  const lines = reports.map((report) => {
    const status = `${PAGE_COPY.runStatuses[report.status]}${report.step ? ` · ${stepText(report.step)}` : ''}`;
    const notes: Array<{ key: string; text: string; tone: string }> = [];
    if (report.mode === 'dry-run') notes.push({ key: 'dry-run', text: PAGE_COPY.report.dryRun, tone: 'dry-run' });
    const waits = report.status === 'handoff' && report.pauseReason !== null
      ? PAGE_COPY.pauseReasons[report.pauseReason] : null;
    // Said once: a check on the page is the status's own words already.
    if (saysWaits && waits !== null && waits.replace(/\.$/, '') !== PAGE_COPY.runStatuses[report.status]) {
      notes.push({ key: 'pause', text: waits, tone: 'pause' });
    }
    return { report, status, notes, telling: TELLING_STATUSES.has(report.status) || report.step !== undefined };
  }).filter((line) => named || line.telling || line.notes.length > 0);
  if (lines.length === 0) return null;
  return (
    <div className="tia-frames">
      {lines.map(({ report, status, notes, telling }) => (
        <section key={report.frameId} className="tia-frame" data-frame-id={report.frameId}>
          {(named || telling) && (
            <p className="tia-frame__head">
              {named && <span className="tia-frame__name">{PAGE_COPY.report.frame(PAGE_COPY.platforms[report.platform],
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
        {rows.map((entry) => {
          const acts = actions.actionsFrameId === undefined || actions.actionsFrameId === entry.frameId;
          // Keyed by whether the row still waits too: one that is done starts afresh, its drawer's options forgotten.
          return <Row key={`${entry.frameId}:${entry.row.key}:${needsPerson(entry.row) ? 'open' : 'done'}`} entry={entry}
            actions={acts ? actions : NO_ACTIONS} />;
        })}
      </ul>
    </section>
  );
}

const NO_ACTIONS: ReportActions = {};

/** A row's state icon (v4 ui, Jobright's list): a teal tick when filled, a spinner while it is written, an empty grey
 *  circle otherwise (D1: "not filled", never an alert), with its words for a screen reader. */
function StateIcon({ progress }: { progress: RowProgress }) {
  const icon: IconName = progress === 'filled' ? 'check-circle' : progress === 'working' ? 'spinner' : 'circle';
  const tone = progress === 'filled' || progress === 'working' ? progress : 'empty';
  return (
    <span className={`tia-row__state tia-row__state--${tone}`}>
      <Icon name={icon} size={18} className={`tia-icon${progress === 'working' ? ' tia-spin' : ''}`} />
      <span className="tia-visually-hidden">{PAGE_COPY.report.rowStates[progress]}</span>
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
 * One field's row (module header): its icon and its label, Skip on the row being written, Preview and Show on a
 * résumé or cover-letter row, and the in-page panel's drawer where it has one. It renders only the fields it names:
 * never a value, whatever the object carries.
 */
function Row({ entry, actions }: { entry: ListRow; actions: ReportActions }) {
  const { row, frameId, progress, current } = entry;
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [tooling, setTooling] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions>({ state: 'closed' });
  const asked = useRef(0);
  const item = useRef<HTMLLIElement>(null);
  const bodyId = useId();
  const panelId = useId();
  const previewId = useId();
  const toolId = useId();
  const scores = row.detail?.suggestions ?? [];
  const { describeField, onShowField, onConfirmDraft, previewOf, renderPreview, openPreview, openEdit } = actions;
  const busy = actions.busy ?? false;
  const draft = row.provenance === 'llm-draft';
  const describe = describeField !== undefined && scores.length > 0;
  const drawer = describeField !== undefined || onConfirmDraft !== undefined;
  const label = row.label || PAGE_COPY.report.noLabel;
  const file = FILE_ROWS.has(row.category);
  const kind = file && (renderPreview !== undefined || openPreview !== undefined) ? previewOf?.(row) ?? null : null;
  const tool = file ? actions.rowTool?.(row) ?? null : null;
  // v1.5 X: the résumé row's Edit, in Show's place.
  const edit = row.category === 'file.resume' && openEdit !== undefined;

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
      {PAGE_COPY.report.confirmDraft}
    </button>
  );

  // The in-page panel's drawer: its actions only (v4 ui: no status chip, no reason, no provenance or confidence).
  const body: ReactNode = (
    <div className="tia-row__body" id={bodyId}>
      {(onShowField || describe || confirmButton) && (
        <div className="tia-row__actions">
          {confirmButton}
          {onShowField && (
            <button type="button" className="tia-button tia-button--quiet" data-action="show-field"
              onClick={() => onShowField(frameId, row.key)}>
              {PAGE_COPY.report.showOnPage}
            </button>
          )}
          {describe && (
            <button type="button" className="tia-button tia-button--quiet" data-action="suggestions"
              aria-expanded={suggestions.state !== 'closed'} aria-controls={panelId} onClick={toggle}>
              {suggestions.state === 'closed' ? PAGE_COPY.report.showSuggestions(scores.length) : PAGE_COPY.report.hideSuggestions}
            </button>
          )}
        </div>
      )}
      {suggestions.state !== 'closed' && (
        <div className="tia-suggestions" id={panelId}>
          {suggestions.state === 'loading' && <p className="tia-suggestions__heading">{PAGE_COPY.report.suggestionsLoading}</p>}
          {suggestions.state === 'failed' && <p className="tia-suggestions__heading">{PAGE_COPY.report.suggestionsFailed}</p>}
          {suggestions.state === 'shown' && (
            <>
              <p className="tia-suggestions__heading">{PAGE_COPY.report.suggestionsHeading}</p>
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
    <li ref={item} className={`tia-row tia-row--line tia-row--${row.status}`}
      data-field-key={row.key} data-status={row.status} data-provenance={row.provenance ?? 'none'}
      data-draft={draft ? 'true' : 'false'} data-layout="line" data-progress={progress}
      data-current={current ? 'true' : undefined} data-file={kind ?? undefined} data-category={row.category}>
      <div className="tia-row__line">
        <StateIcon progress={progress} />
        {onShowField ? (
          <button type="button" className="tia-row__go" title={PAGE_COPY.report.goTo(label)}
            onClick={() => onShowField(frameId, row.key)}>
            <span className="tia-row__label">{label}</span>
          </button>
        ) : (
          <span className="tia-row__go tia-row__go--static"><span className="tia-row__label">{label}</span></span>
        )}
        {current && actions.onSkip !== undefined && (
          <SkipButton frameId={frameId} row={row} onSkip={actions.onSkip} clock={actions.clock ?? BROWSER_CLOCK} />
        )}
        {file && (kind !== null || onShowField || tool !== null || edit) && (
          <span className="tia-row__files">
            {kind !== null && (
              <button type="button" className="tia-row__file" data-action="preview"
                aria-expanded={openPreview === undefined ? previewing : undefined}
                aria-controls={openPreview === undefined ? previewId : undefined}
                aria-label={PAGE_COPY.report.previewLabel(label)}
                onClick={() => (openPreview !== undefined ? openPreview(kind) : setPreviewing((shown) => !shown))}>
                <Icon name="eye" size={15} className="tia-icon" />
                {PAGE_COPY.report.preview}
              </button>
            )}
            {edit ? (
              <button type="button" className="tia-row__file" data-action="edit-file"
                aria-label={PAGE_COPY.report.editLabel(label)} onClick={() => openEdit('resume')}>
                {PAGE_COPY.report.edit}
              </button>
            ) : onShowField && (
              <button type="button" className="tia-row__file" data-action="show-file"
                aria-label={PAGE_COPY.report.showLabel(label)} onClick={() => onShowField(frameId, row.key)}>
                {PAGE_COPY.report.show}
              </button>
            )}
            {tool !== null && (
              <button type="button" className="tia-row__file" data-action={tool.action} aria-expanded={tooling}
                aria-controls={toolId} onClick={() => setTooling((shown) => !shown)}>
                {tool.label}
              </button>
            )}
          </span>
        )}
        {drawer && (
          <button type="button" className="tia-row__toggle" aria-expanded={open} aria-controls={bodyId}
            aria-label={PAGE_COPY.report.details(label)} title={PAGE_COPY.report.details(label)} onClick={fold}>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="tia-icon" />
          </button>
        )}
      </div>
      {kind !== null && previewing && renderPreview !== undefined && openPreview === undefined && (
        <div className="tia-row__preview" id={previewId} data-row-preview={kind}>
          {renderPreview(kind, label, () => setPreviewing(false))}
        </div>
      )}
      {tool !== null && tooling && (
        <div className="tia-row__preview" id={toolId} data-row-tool={tool.action}>{tool.render(() => setTooling(false))}</div>
      )}
      {drawer && open && body}
    </li>
  );
}

/** v5 p1-panel (F4): Continue on the progress line (ReportActions.onContinue), disabled until shown CONTROL_SEEN_MS
 *  (a control newly drawn: ui/panel/seen.ts, as the main button). */
function ContinueButton({ onContinue, clock }: { onContinue(): void; clock: NonNullable<ReportActions['clock']> }) {
  const seen = useShownFor('continue', clock);
  return (
    <button type="button" className="tia-progress-line__continue" data-action="continue" disabled={!seen}
      onClick={() => {
        if (seen) onContinue();
      }}>
      {PAGE_COPY.panel.continue}
    </button>
  );
}

/** The browser's clock for Skip: the time and its animation frames, which run only while the panel is visible. */
const BROWSER_CLOCK = { now: () => Date.now(), frames: animationFrames };

/** Skip on the field being written, once the run has been on it SKIP_AFTER_MS (Jobright's 2 s): it gives up that one
 *  write. Its clock starts with the row's turn (the button is mounted only on the current row), and starts afresh for
 *  the next field; it ticks on animation frames, never a timer. */
function SkipButton({ frameId, row, onSkip, clock }: { frameId: number; row: ReportRow;
  onSkip(frameId: number, key: string): void | Promise<boolean>; clock: NonNullable<ReportActions['clock']> }) {
  const [shown, setShown] = useState(false);
  const [sent, setSent] = useState(false);
  const { now, frames } = clock;
  useEffect(() => afterFrames(SKIP_AFTER_MS, () => setShown(true), now, frames), [now, frames]);
  if (!shown) return null;
  const label = row.label || PAGE_COPY.report.noLabel;
  return (
    <button type="button" className="tia-linkbutton tia-row__skip" data-action="skip" disabled={sent}
      aria-label={PAGE_COPY.report.skipLabel(label)} onClick={() => {
        setSent(true);
        // A Skip the run did not take (m5): offered again, so the person's word is never lost silently.
        void Promise.resolve(onSkip(frameId, row.key)).then((taken) => {
          if (taken === false) setSent(false);
        }, () => setSent(false));
      }}>
      {PAGE_COPY.report.skip}
    </button>
  );
}
