/*
 * Which page elements stand for a field when the person is shown it: its control, or for a visually hidden native
 * control its proxy (the visible label tied to it, or the adapter's widget), and for a radio or checkbox group each
 * visible member with its option labels. The in-page UI draws over these; it never changes them.
 */
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { FieldTarget, ScanResult } from '../dom/types';
import type { HighlightItem } from './ui/highlights';

/** The elements an outline of this field covers. */
export function elementsOf(target: FieldTarget): Element[] {
  if (target.members.length > 0) {
    const shown = target.field.visibility === 'visible';
    return target.members.flatMap((member) => [...(shown ? [member] : []), ...Array.from(member.labels ?? [])]);
  }
  return [target.proxy ?? target.control];
}

/** The highlights of a run's rows over a fresh scan: every row but the skipped ones, on the fields found again. */
export function highlightItems(fresh: ScanResult, rows: ReadonlyMap<FieldKey, FillResult>,
  removeSelection: ReadonlySet<FieldKey>): HighlightItem[] {
  const items: HighlightItem[] = [];
  for (const [key, row] of rows) {
    if (row.status === 'skipped') continue;
    const target = fresh.target(key);
    if (target === null) continue;
    const draft = row.provenance === 'llm-draft';
    items.push({ key, status: row.status, draft, ...(draft && !row.needsUserAction ? { draftConfirmed: true } : {}),
      removeSelection: removeSelection.has(key), elements: elementsOf(target) });
  }
  return items;
}
