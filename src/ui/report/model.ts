/*
 * What the report shows, worked out from the tab's frame reports: the notices of every frame once each, each frame's
 * rows by section, and the one run status that most needs the person. Plain functions over the reports, which hold
 * labels, codes and counts and never a value.
 */
import type { RunStatus } from '../../core/types/run';
import { NOTICE_CODES, type FrameReport } from '../../shared/report';

/** A report notice's code. */
export type NoticeCode = (typeof NOTICE_CODES)[number];
/** One report row (the core's FillResult, as the schema checked it). */
export type ReportRow = FrameReport['fields'][number];

/** The notices of every frame, each code once, in NOTICE_CODES order (the plan's three sentences first). */
export function combinedNotices(reports: readonly FrameReport[]): NoticeCode[] {
  const seen = new Set<NoticeCode>();
  for (const report of reports) for (const notice of report.notices) seen.add(notice.code);
  return NOTICE_CODES.filter((code) => seen.has(code));
}

/** Whether a frame's run has stopped before filling for the person's decision on the posting's AI policy. */
export function awaitsPolicyDecision(reports: readonly FrameReport[]): boolean {
  return reports.some((report) => report.status === 'policy-notice');
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
