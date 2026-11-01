/*
 * What the report shows, worked out from the tab's frame reports: the notices of every frame once each, each frame's
 * rows by section, the one run status that most needs the person, and the completion: how many rows are ready and how
 * many need the person. Plain functions over the reports, which hold labels, codes and counts and never a value.
 */
import { FILL_STATUSES, type FillStatus } from '../../core/enums';
import { CLASS_POLICIES, policyClassOf } from '../../core/resolver/categories';
import type { RunStatus } from '../../core/types/run';
import { COPY } from '../../shared/copy';
import type { IconName } from '../../shared/icons';
import { needsPerson, NOTICE_CODES, type FrameReport } from '../../shared/report';

export { needsPerson };

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
 * How a row marks the AI, by E1's rule (src/content/targets.ts aiMarkOf, which the page's highlights use; the UI may not
 * import the content script, so it is mirrored here): 'guess' for an answer with nothing to go on ("AI guess"),
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

/** Whether a row is done for the person: written (verified or filled), or a question that already held its answer or
 *  needed none (an end date for a job they still hold). A row that needs the person never is. */
export function isReady(row: ReportRow): boolean {
  if (needsPerson(row)) return false;
  return row.status === 'verified' || row.status === 'filled' || row.reason === 'already-correct'
    || row.reason === 'end-date-not-applicable';
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
    const done = isReady(row);
    const waiting = needsPerson(row);
    if (done) ready += 1;
    if (waiting) needsYou += 1;
    if (row.required && (done || waiting)) {
      required.of += 1;
      if (done) required.ready += 1;
    }
  }
  return { byStatus, ready, needsYou, required, dryRun: reports.every((report) => report.mode === 'dry-run'),
    working: reports.some((report) => WORKING_STATUSES.has(report.status)) };
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
