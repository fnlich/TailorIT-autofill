/*
 * What the report shows, worked out from the tab's frame reports: the notices of every frame once each, each frame's
 * rows by section, the one run status that most needs the person, the progress (v3 Phase 3, shared/report.ts
 * progressOf: the percent of the required fields filled, one rule for both panels and the launcher) and the field
 * lists (Required, then Optional, each row filled, missing or being filled). Plain functions over the reports, which
 * hold labels, codes and counts and never a value. v4 ui (the owner's "never flag", D1/D6/D8): no AI marks; rows the
 * run leaves out (shared/report.ts leftOut) are neither listed nor counted (shownReports).
 */
import { FILL_STATUSES, type FillStatus } from '../../core/enums';
import { CLASS_POLICIES, policyClassOf } from '../../core/resolver/categories';
import type { RunStatus } from '../../core/types/run';
import { PAGE_COPY } from '../../shared/copy';
import type { IconName } from '../../shared/icons';
import {
  filledByPerson, isReady, leftForPerson, leftOut, needsPerson, NOTICE_CODES, progressOf, rowProgressOf, type FrameReport,
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
  return words === '' ? PAGE_COPY.report.untitledSection : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
  return step.progress ?? PAGE_COPY.report.step(step.index, step.of);
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

/** v4 ui (D8): the reports as the person is shown them and counted: every row but one the run leaves out
 *  (shared/report.ts leftOut: a guard's refusal, a honeypot or a canary, and a field hidden from people, named by no
 *  visible label, or whose label addresses AI tools), which is never filled and is none of the person's business. One
 *  rule with the progress, so the lists and the counts agree (the v4 review, L-M7). A report with no such row is
 *  passed as it is. */
export function shownReports<T extends Pick<FrameReport, 'fields'>>(reports: readonly T[]): T[] {
  return reports.map((report) => (report.fields.some(leftOut)
    ? { ...report, fields: report.fields.filter((row) => !leftOut(row)) } : report));
}

/** The field lists (v3 Phase 3, Jobright's): the required rows, then the optional ones, each frame's in its report's
 *  order (the form's), frames by id; no row left out (v4 ui, D8: shownReports). */
export function fieldListsOf(reports: readonly FrameReport[]): { required: ListRow[]; optional: ListRow[] } {
  const rows = shownReports([...reports].sort((a, b) => a.frameId - b.frameId)).flatMap((report) => report.fields.map((row) => ({
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

// ── v5 p1-panel: the progress sheet's groups (PLAN decision 4; Jobright's Education and Employment entries, its
// partial "n/m" toggles and its account step rows, from what a report holds: labels, categories, section keys and
// counts, never a value) ──

/** The repeatable sections whose entries the sheet lists one by one, by their rows' categories. */
export const ENTRY_KINDS = ['education', 'experience'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** A section key's block (core/text/keys.ts sectionKey: "education[1]" for a repeatable section's second block), or
 *  null for a section that is not a block. */
export function blockOf(section: string): number | null {
  const match = /\[(\d{1,3})\]$/.exec(section);
  return match === null ? null : Number(match[1]);
}

/** The entry kind a row belongs to: an education or work experience field in a block of its section; null for any
 *  other row (it stays in the Required and Optional lists). */
export function entryKindOf(row: Pick<ReportRow, 'category' | 'section'>): EntryKind | null {
  if (blockOf(row.section) === null) return null;
  const family = row.category.slice(0, row.category.indexOf('.'));
  return (ENTRY_KINDS as readonly string[]).includes(family) ? family as EntryKind : null;
}

/** Where a set of rows stands as one: being written while any is, filled when every counted one is, not filled when
 *  any is; 'none' when none counts. */
export function progressOfRows(rows: readonly ListRow[]): RowProgress {
  const counted = rows.filter((entry) => entry.progress !== 'none');
  if (counted.length === 0) return 'none';
  if (counted.some((entry) => entry.progress === 'working')) return 'working';
  return counted.every((entry) => entry.progress === 'filled') ? 'filled' : 'missing';
}

/** One entry of a section on the form: its block, its place among the section's entries (from 1), its rows. */
export interface SheetEntry {
  block: number;
  place: number;
  rows: ListRow[];
  progress: RowProgress;
}

/** A frame's section of entries (Education, Work Experience): its entries in block order, the run's count of the
 *  profile's entries the form shows a block for (null when the run counted none), and the places of the profile's
 *  entries the form shows no block for ("Not Added"). */
export interface EntryGroup {
  frameId: number;
  kind: EntryKind;
  entries: SheetEntry[];
  count: { added: number; of: number } | null;
  notAdded: number[];
  progress: RowProgress;
}

/** What the sheet lists: the sections of entries, the counts of repeatable sections it has no rows for (Languages,
 *  or a section whose blocks hold no row yet), then the Required and Optional rows not in an entry. */
export interface SheetLists {
  groups: EntryGroup[];
  counts: ReturnType<typeof repeatablesOf>;
  required: ListRow[];
  optional: ListRow[];
}

/** The sheet's lists (SheetLists), from fieldListsOf's rows: the shown rows only (D8), each frame's in its report's
 *  order. Every row stays counted by the progress as before; only where it is listed changes. */
export function sheetListsOf(reports: readonly FrameReport[]): SheetLists {
  const lists = fieldListsOf(reports);
  const all = [...lists.required, ...lists.optional].sort((a, b) => a.frameId - b.frameId);
  const counts = repeatablesOf(reports);
  const groups: EntryGroup[] = [];
  const inEntry = new Set<ListRow>();
  for (const entry of all) {
    const kind = entryKindOf(entry.row);
    if (kind === null) continue;
    let group = groups.find((each) => each.frameId === entry.frameId && each.kind === kind);
    if (group === undefined) {
      const counted = counts.find((count) => count.frameId === entry.frameId && count.kind === kind);
      group = { frameId: entry.frameId, kind, entries: [], count: counted === undefined ? null
        : { added: counted.added, of: counted.of }, notAdded: [], progress: 'none' };
      groups.push(group);
    }
    const block = blockOf(entry.row.section)!;
    let held = group.entries.find((each) => each.block === block);
    if (held === undefined) {
      held = { block, place: 0, rows: [], progress: 'none' };
      group.entries.push(held);
    }
    held.rows.push(entry);
    inEntry.add(entry);
  }
  for (const group of groups) {
    // The form's order: blocks by their index, each numbered from 1 as the person reads them.
    group.entries.sort((a, b) => a.block - b.block);
    group.entries.forEach((entry, at) => {
      entry.place = at + 1;
      entry.progress = progressOfRows(entry.rows);
    });
    const shown = group.entries.length;
    const of = group.count?.of ?? 0;
    for (let place = Math.max(shown, group.count?.added ?? 0) + 1; place <= of; place += 1) group.notAdded.push(place);
    group.progress = group.notAdded.length > 0 && progressOfRows(group.entries.flatMap((entry) => entry.rows)) !== 'working'
      ? 'missing' : progressOfRows(group.entries.flatMap((entry) => entry.rows));
  }
  return {
    groups,
    counts: counts.filter((count) => !groups.some((group) => group.frameId === count.frameId && group.kind === count.kind)),
    required: lists.required.filter((entry) => !inEntry.has(entry)),
    optional: lists.optional.filter((entry) => !inEntry.has(entry)),
  };
}

/** The account step of a run at its sign-in pause (Jobright's "Signing in" and "Creating account" rows): signing in
 *  or creating the account for the run now (Sign-in Auto, or Sign up & Autofill: the 'sign-in-auto' notice), or
 *  waiting for the person (the page's toast says what). `wall` is the tab's page state's (PageState.wall): a create-
 *  account page reads "Creating Account". Null when no run rests at a sign-in. */
export function accountStepOf(reports: readonly FrameReport[], wall?: 'sign-in' | 'create-account' | 'email-gate' | null):
  { kind: 'sign-in' | 'create-account'; progress: RowProgress } | null {
  const at = reports.filter((report) => report.status === 'auth-needed');
  if (at.length === 0) return null;
  const signing = at.some((report) => report.notices.some((notice) => notice.code === 'sign-in-auto'));
  return { kind: wall === 'create-account' ? 'create-account' : 'sign-in', progress: signing ? 'working' : 'missing' };
}
// ── end v5 p1-panel ──
