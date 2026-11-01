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

/** The reasons of a row whose value the AI wrote and that needs nothing of the person (the owner's amendments; Phase
 *  G: a cover letter TailorIT's AI wrote during this run). */
const AI_WRITTEN: ReadonlySet<FillResult['reason']> = new Set<FillResult['reason']>(['llm-draft-written',
  'llm-answer-written', 'cover-letter-written']);

/** How a row's outline marks the AI (the owner's amendments): 'guess' for an answer with nothing to go on ("AI
 *  guess"), 'written' for a draft or an answer the AI wrote, read back as written ("AI"); absent otherwise (a draft
 *  the person confirmed shows its status, and a row that needs the person shows its status). */
export function aiMarkOf(row: Pick<FillResult, 'provenance' | 'reason' | 'wrote' | 'status'>): HighlightItem['ai'] {
  if (!row.wrote || row.status !== 'verified') return undefined;
  if (row.reason === 'ai-guess') return 'guess';
  return AI_WRITTEN.has(row.reason) ? 'written' : undefined;
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
    const ai = aiMarkOf(row);
    items.push({ key, status: row.status, draft, ...(draft && !row.needsUserAction ? { draftConfirmed: true } : {}),
      ...(ai === undefined ? {} : { ai }), removeSelection: removeSelection.has(key), elements: elementsOf(target) });
  }
  return items;
}
