/*
 * jr8 WORKDAY (the owner's rule of 2026-11-13: "after all required field is filled, click Next automatically. If there
 * is unfilled required field, can't continue to the next page"; and the panel's "Continue to the next page", enabled
 * only then): the one reading of whether a step's required questions are filled, as the page shows them, which Next
 * mode Auto (content/orchestrator.ts: the validation's requiredEmpty, the re-check right before its click, the fill's
 * flagged count at FILLED) and the panel's button (FrameReport.buttons.requiredLeft) both read.
 * - A required question a person can answer (shown, enabled, its label shown) is filled when the page shows an answer
 *   in it, whoever gave it: the run, the person, or the page (a Workday pill, an Ashby Yes/No pressed: a row the run
 *   marked the page's, detail.filledByYou, is one), or a box of several answers shows a chip;
 * - except a native select's or radio group's own default (the option or radio the page's markup chose, FIX7PLAN O-3:
 *   iCIMS's "Hr." beside an annual amount is the page's, not an answer) that neither the run wrote nor the person
 *   touched: it is filled only for a row the run could not decide by its own limits (ICIMS7-V4's HELD_BY_PAGE_REASONS:
 *   a question it could not tell, one it cannot write in the page's shape), whose page answer stands;
 * - each of the run's required rows left for the person whose field no scan reads answered (an upload the fill
 *   attached nothing to, a widget the scan cannot read), and each required upload the scan recognises no control of.
 * Pure over a scan and the rows; nothing here reads or keeps a value beyond whether one shows.
 */
import { baseKeyOf } from '../core/loop/bookkeeping';
import type { FillResult, ReasonCode } from '../core/types/fill';
import type { FieldTarget, ScanResult, ScannedField } from '../dom/types';
import { tagsShowChip } from '../dom/widgets/tag-chips';
import { notFilled, unfilledByRun } from '../shared/report';

/** The reasons of a row the run could not decide by its own limits, whose field the page may answer itself (ICIMS7-V4:
 *  content/orchestrator.ts heldIn). Never a question the run knows the person must answer. */
export const HELD_BY_PAGE_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['unknown-field', 'format-unsupported']);

/** The visibilities a person answers a field in (content/press.ts requiredLeftOf's). */
const ANSWERABLE: ReadonlySet<ScannedField['visibility']> = new Set(['visible', 'hidden-file-with-visible-control',
  'hidden-native-with-visible-label']);

/** Whether the person touched an element (the run's touch log: a trusted input, keydown, paste or drop). */
export type Touched = (el: Element) => boolean;

/** Whether a field's answer is empty as it reads now. */
function emptyNow(current: ScannedField['current']): boolean {
  switch (current.kind) {
    case 'empty':
      return true;
    case 'text':
      return current.text.trim() === '';
    case 'checked':
      return !current.checked;
    case 'selected':
      return current.labels.length === 0;
    case 'files':
      return current.count === 0;
  }
}

/** Whether a native select or radio group shows only the choice its markup made (its own default). */
function nativeDefault(target: FieldTarget): boolean {
  if (target.widget !== undefined) return false;
  const control = target.control;
  if (control.localName === 'select' && !(control as HTMLSelectElement).multiple) {
    const select = control as HTMLSelectElement;
    const options = Array.from(select.options);
    const marked = options.filter((option) => option.defaultSelected);
    const first = marked.length > 0 ? marked.at(-1)! : options[0];
    return first !== undefined && select.selectedIndex === first.index;
  }
  const radios = target.members.filter((member) => member.type === 'radio');
  return radios.length > 0 && radios.length === target.members.length
    && radios.some((radio) => radio.checked && radio.defaultChecked);
}

/** Whether a required field shows an answer as filled (module header): `row` is the run's row for it, if any. */
export function filledAsShown(scanned: ScanResult, field: ScannedField, row: FillResult | undefined,
  touched: Touched): boolean {
  if (row?.detail?.filledByYou === true) return true;
  const target = scanned.target(field.key);
  const tags = target?.widget?.tags;
  if (tags !== undefined && tagsShowChip(tags)) return true;
  if (emptyNow(field.current)) return false;
  if (target === null || !nativeDefault(target) || row?.wrote === true) return true;
  if ([target.control, ...target.members].some(touched)) return true;
  return row !== undefined && unfilledByRun(row) && HELD_BY_PAGE_REASONS.has(row.reason);
}

/** Whether a scanned field is a required question a person can answer now. */
function asked(field: ScannedField): boolean {
  return field.required && !field.disabled && ANSWERABLE.has(field.visibility)
    && (field.visibility !== 'visible' || field.labelVisible);
}

/** The run's row for a field: by its key, else by its base key. */
function rowFinder(rows: readonly FillResult[]): (field: ScannedField) => FillResult | undefined {
  const byKey = new Map<string, FillResult>(rows.map((row) => [row.key, row]));
  const byBase = new Map<string, FillResult>();
  for (const row of rows) if (!byBase.has(baseKeyOf(row.key))) byBase.set(baseKeyOf(row.key), row);
  return (field) => byKey.get(field.key) ?? byBase.get(field.baseKey);
}

/** The required questions of the step not filled as the page shows them (module header). `rows` are the step's;
 *  `skipRow` leaves out rows no field stands for (a required block's, which the adapter counts itself). */
export function requiredUnfilledOf(scanned: ScanResult, rows: readonly FillResult[], touched: Touched,
  skipRow: (row: FillResult) => boolean = () => false): number {
  const rowOf = rowFinder(rows);
  const left = new Set<string>();
  for (const field of scanned.fields) {
    if (asked(field) && !filledAsShown(scanned, field, rowOf(field), touched)) left.add(field.baseKey);
  }
  for (const row of rows) {
    if (!row.required || !notFilled(row) || skipRow(row)) continue;
    const field = scanned.fields.find((candidate) => candidate.key === row.key)
      ?? scanned.fields.find((candidate) => candidate.baseKey === baseKeyOf(row.key));
    if (field !== undefined && filledAsShown(scanned, field, row, touched)) continue;
    left.add(field?.baseKey ?? baseKeyOf(row.key));
  }
  for (const upload of scanned.unrecognisedUploads) if (upload.requiredEmpty) left.add(upload.baseKey);
  return left.size;
}

/** The rows as Next mode Auto counts them at FILLED (report.ts lastFillOf): an open required row whose field the page
 *  shows filled (filledAsShown) is the page's, marked so for the count alone. */
export function countedAsShown(scanned: ScanResult, rows: readonly FillResult[], touched: Touched): FillResult[] {
  const rowOf = rowFinder(rows);
  return rows.map((row) => {
    if (!row.required || !unfilledByRun(row) || row.detail?.filledByYou === true) return row;
    const field = scanned.fields.find((candidate) => candidate.key === row.key)
      ?? scanned.fields.find((candidate) => candidate.baseKey === baseKeyOf(row.key));
    if (field === undefined || rowOf(field) !== row || !filledAsShown(scanned, field, row, touched)) return row;
    return { ...row, detail: { ...row.detail, filledByYou: true } };
  });
}
