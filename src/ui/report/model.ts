/*
 * What the report shows, worked out from the tab's frame reports: the notices of every frame once each, each frame's
 * rows by section, the one run status that most needs the person, the progress (v3 Phase 3, shared/report.ts
 * progressOf: the percent of the required fields filled, one rule for both panels and the launcher) and the field
 * lists (Required, then Optional, each row filled, missing or being filled). Plain functions over the reports, which
 * hold labels, codes and counts and never a value.
 */
import { FILL_STATUSES, type FillStatus } from '../../core/enums';
import { CLASS_POLICIES, policyClassOf } from '../../core/resolver/categories';
import type { RunStatus } from '../../core/types/run';
import { COPY } from '../../shared/copy';
import type { IconName } from '../../shared/icons';
import {
  filledByPerson, isReady, leftForPerson, needsPerson, NOTICE_CODES, progressOf, rowProgressOf, type FrameReport,
  type Progress, type RowProgress,
} from '../../shared/report';

export { isReady, needsPerson, progressOf, rowProgressOf, type Progress, type RowProgress };

/** A report notice's code. */
export type NoticeCode = (typeof NOTICE_CODES)[number];
/** One report row (the core's FillResult, as the schema checked it). */
export type ReportRow = FrameReport['fields'][number];

/** The notices of every frame, each code once, in NOTICE_CODES order (the plan's three sentences first). The
 *  stored-copy line is not one of them: it is said under the policy notice it belongs to. */
export function combinedNotices(reports: readonly FrameReport[]): NoticeCode[] {
  const seen = new Set<NoticeCode>();
  for (const report of reports) for (const notice of report.notices) seen.add(notice.code);
  return NOTICE_CODES.filter((code) => seen.has(code) && code !== 'policy-stored-copy');
}

/** The frames whose run has stopped before filling for the person's decision on the posting's AI policy, by frame id:
 *  each gets a policy card of its own, whose decision is for it alone. */
export function framesAtPolicyCard(reports: readonly FrameReport[]): FrameReport[] {
  return reports.filter((report) => report.status === 'policy-notice').sort((a, b) => a.frameId - b.frameId);
}

/** One frame's rows by section, sections in the order they first appear, rows in the order reported. */
export function sectionsOf(rows: readonly ReportRow[]): Array<{ section: string; rows: ReportRow[] }> {
  const sections = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const list = sections.get(row.section);
    if (list) list.push(row);
    else sections.set(row.section, [row]);
  }
  return [...sections].map(([section, list]) => ({ section, rows: list }));
}

/** A section's heading as the person reads it: the adapter's own words as they are, or a slug made readable
 *  ("submit-your-application" reads "Submit your application"); the form's main part when it has none. */
export function sectionName(section: string): string {
  const trimmed = section.trim();
  if (/\s|[A-Z]/.test(trimmed)) return trimmed;
  const words = trimmed.replace(/[-_]+/g, ' ').trim();
  return words === '' ? COPY.report.untitledSection : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The reasons of an answer the AI wrote and the run accepted (the owner's amendments; Phase G: a cover letter
 *  TailorIT's AI wrote, during this run or before it, that the person never edited). */
const AI_WRITTEN: ReadonlySet<ReportRow['reason']> = new Set<ReportRow['reason']>(['llm-draft-written', 'llm-answer-written',
  'cover-letter-written']);

/**
 * How a row marks the AI, by E1's rule (the review is the one place the marks are shown: nothing is drawn over the
 * page's fields since the owner's decision of 2026-11-01): 'guess' for an answer with nothing to go on ("AI guess"),
 * 'written' for a draft or an answer the AI wrote, verified as written ("AI"); undefined otherwise (a row that needs
 * the person shows its status).
 */
export function aiMarkOf(row: Pick<ReportRow, 'reason' | 'wrote' | 'status'>): 'written' | 'guess' | undefined {
  if (!row.wrote || row.status !== 'verified') return undefined;
  if (row.reason === 'ai-guess') return 'guess';
  return AI_WRITTEN.has(row.reason) ? 'written' : undefined;
}

/** The answers the AI wrote across the tab's frames (aiMarkOf), and how many of them were its guesses. */
export function aiCountsOf(reports: readonly FrameReport[]): { written: number; guesses: number } {
  const marks = reports.flatMap((report) => report.fields).map(aiMarkOf).filter((mark) => mark !== undefined);
  return { written: marks.length, guesses: marks.filter((mark) => mark === 'guess').length };
}

/** Run statuses, the one that most needs the person first: a decision, a sign-in, a hand-off, then work in progress. */
const URGENCY: readonly RunStatus[] = ['policy-notice', 'auth-needed', 'handoff', 'detect', 'scan-step', 'fill-step', 'validate',
  'advance', 'wait-transition', 'review', 'done', 'stopped'];

/** The status of the tab's runs that most needs the person, or null without a report. */
export function overallStatus(reports: readonly FrameReport[]): RunStatus | null {
  let best: RunStatus | null = null;
  for (const report of reports) {
    if (best === null || URGENCY.indexOf(report.status) < URGENCY.indexOf(best)) best = report.status;
  }
  return best;
}

/** A confidence or score between 0 and 1 as a whole percent ("87%"). */
export function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

/** A step as the person reads it: the adapter's progress line where the report has one ("Step 2 of 4"), else the
 *  step's index ("Step 2", counting from 1). */
export function stepText(step: NonNullable<FrameReport['step']>): string {
  return step.progress ?? COPY.report.step(step.index, step.of);
}

/** Whether a row is an AI draft that still waits for the person to edit or confirm it. */
export function awaitsDraftConfirmation(row: ReportRow): boolean {
  return row.provenance === 'llm-draft' && row.needsUserAction;
}

/**
 * Whether "Save my answer" may be offered on a row (Requirement F): the run left it flagged, the person then changed it
 * with their own input (detail.userEdited, which the content runtime sets), and its kind of question may ever take a
 * saved answer: never a file, nor a self-identification, legal, sensitive, consent or attention-check question.
 */
export function offersSave(row: ReportRow): boolean {
  return row.status === 'flagged' && row.detail?.userEdited === true && row.kind !== 'file'
    && CLASS_POLICIES[policyClassOf(row.category)].savedAnswers !== 'never';
}

/** Whether a frame's policy notice came only from TailorIT's saved copy of the posting. */
export function policyFromStoredCopy(report: FrameReport): boolean {
  return report.notices.some((notice) => notice.code === 'policy-stored-copy');
}

/** The run statuses of a run still at work: the strip pulses and the main button spins. */
export const WORKING_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['detect', 'scan-step', 'fill-step', 'validate',
  'advance', 'wait-transition']);

/** Whether a frame's run works now: a working status, unless it rests there (FrameReport.resting: at wait-transition,
 *  waiting for the person's own Next). */
export function isWorking(report: Pick<FrameReport, 'status' | 'resting'>): boolean {
  return WORKING_STATUSES.has(report.status) && report.resting !== true;
}

/** The tab's rows counted: per status, ready, needing the person, the required ones among both, and whether every
 *  frame is a dry run and whether any run still works. */
export interface Tally {
  byStatus: Readonly<Record<FillStatus, number>>;
  ready: number;
  needsYou: number;
  required: { ready: number; of: number };
  dryRun: boolean;
  working: boolean;
}

/** The completion across every frame of the tab: ready / (ready + needing the person), skipped rows that needed nothing
 *  left out. Null without a row. */
export function tallyOf(reports: readonly FrameReport[]): Tally | null {
  const rows = reports.flatMap((report) => report.fields);
  if (rows.length === 0) return null;
  const byStatus = Object.fromEntries(FILL_STATUSES.map((status) => [status, 0])) as Record<FillStatus, number>;
  let ready = 0;
  let needsYou = 0;
  const required = { ready: 0, of: 0 };
  for (const row of rows) {
    byStatus[row.status] += 1;
    const done = isReady(row) || filledByPerson(row);
    const waiting = leftForPerson(row);
    if (done) ready += 1;
    if (waiting) needsYou += 1;
    if (row.required && (done || waiting)) {
      required.of += 1;
      if (done) required.ready += 1;
    }
  }
  return { byStatus, ready, needsYou, required, dryRun: reports.every((report) => report.mode === 'dry-run'),
    working: reports.some(isWorking) };
}

/** A strip's tone: its tint, and the colour of its dot. */
export type StripTone = 'brand' | 'working' | 'attention' | 'done' | 'neutral' | 'problem';

/** The run status line's tone: at work, waiting for the person, ready (with something left for them, or nothing), or
 *  stopped. */
export function stripToneOf(status: RunStatus, needsYou: number): StripTone {
  if (WORKING_STATUSES.has(status)) return 'working';
  if (status === 'policy-notice' || status === 'auth-needed' || status === 'handoff') return 'attention';
  if (status === 'review') return needsYou > 0 ? 'attention' : 'done';
  if (status === 'done') return 'done';
  return 'neutral';
}

/** A row's icon: an alert or a cross on a row that needs the person; a filled tick for verified, a ringed tick for
 *  filled or a question that needed nothing, a dash for any other skip. */
export function rowIconOf(row: ReportRow): IconName {
  if (needsPerson(row)) return row.status === 'blocked' ? 'x-circle' : 'alert';
  if (row.status === 'verified') return 'check-circle';
  if (row.status === 'filled' || isReady(row)) return 'check';
  return 'minus-circle';
}

/** Where the progress stands (v3 Phase 3): no report; a run reading the form (no row counted yet, "Scanning the
 *  page"); a run filling ("Autofilling… 78%"); or every run at rest ("9 of 12 required fields filled · 75%"). */
export type ProgressState = 'empty' | 'scanning' | 'filling' | 'rest';

export function progressStateOf(reports: readonly FrameReport[]): ProgressState {
  if (reports.length === 0) return 'empty';
  if (!reports.some(isWorking)) return 'rest';
  return progressOf(reports).of === 0 ? 'scanning' : 'filling';
}

/** One row of the field lists: its frame, its row, where it stands, and whether it is being written now. */
export interface ListRow {
  frameId: number;
  row: ReportRow;
  progress: RowProgress;
  current: boolean;
}

/** The field lists (v3 Phase 3, Jobright's): the required rows, then the optional ones, each frame's in its report's
 *  order (the form's), frames by id. */
export function fieldListsOf(reports: readonly FrameReport[]): { required: ListRow[]; optional: ListRow[] } {
  const rows = [...reports].sort((a, b) => a.frameId - b.frameId).flatMap((report) => report.fields.map((row) => ({
    frameId: report.frameId, row, progress: rowProgressOf(row, report.filling),
    current: report.filling?.current === row.key })));
  return { required: rows.filter((entry) => entry.row.required), optional: rows.filter((entry) => !entry.row.required) };
}

/** The field being written now across the tab's frames (its frame and key), or null. */
export function currentFieldOf(reports: readonly FrameReport[]): { frameId: number; key: string } | null {
  for (const report of reports) {
    const key = report.filling?.current ?? null;
    if (key !== null) return { frameId: report.frameId, key };
  }
  return null;
}

/** The repeatable sections' counts across the tab's frames ("Education · 2 of 3 added"). */
export function repeatablesOf(reports: readonly FrameReport[]): Array<NonNullable<FrameReport['repeatables']>[number] & {
  frameId: number }> {
  return reports.flatMap((report) => (report.repeatables ?? []).map((count) => ({ ...count, frameId: report.frameId })));
}
