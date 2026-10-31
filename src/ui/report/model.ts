/*
 * What the report shows, worked out from the tab's frame reports: the notices of every frame once each, each frame's
 * rows by section, and the one run status that most needs the person. Plain functions over the reports, which hold
 * labels, codes and counts and never a value.
 */
import { CLASS_POLICIES, policyClassOf } from '../../core/resolver/categories';
import type { RunStatus } from '../../core/types/run';
import { COPY } from '../../shared/copy';
import { NOTICE_CODES, type FrameReport } from '../../shared/report';

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
