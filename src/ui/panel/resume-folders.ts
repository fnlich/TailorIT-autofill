/*
 * v1.5 X (PLAN decision 6; the owner, 2026-11-09: "list of resume will be shown as folder directory style. (uploaded
 * resumes, Edited resume folder (all edited resume will be shown on this folder), and Tailored Resume folder ...)"):
 * Change's list of resumes in three folders, as TailorIT's Documents › Resumes shows them, by how TailorIT made each
 * (GET /api/autofill/resumes' `madeBy`, through panel/resumes):
 * - Uploaded: the person's own files (`upload`);
 * - Edited: built resumes that are not tailored (`editor`, and an upload's editable copy, `copy`);
 * - Tailored: those a tailoring wrote (`tailor`), under one heading per day they were made, newest first.
 * A TailorIT before v1.5 names neither: an uploaded resume is then Uploaded, a built one Edited. Pure.
 */
import type { ResumeListAnswer } from '../../messaging/schemas';

type Item = ResumeListAnswer['items'][number];

/** The folders, in the order they show. */
export const RESUME_FOLDERS = ['uploaded', 'edited', 'tailored'] as const;
export type ResumeFolder = (typeof RESUME_FOLDERS)[number];

/** A day's tailored resumes: its local date (`YYYY-MM-DD`, null when the item names none) and its items. */
export interface DayGroup {
  day: string | null;
  items: Item[];
}

export interface FolderGroup {
  folder: ResumeFolder;
  items: Item[];
  /** Tailored's days, newest first (an undated group last); empty for the other two. */
  days: DayGroup[];
}

/** The folder an item belongs in (module header). */
export function folderOf(item: Pick<Item, 'kind' | 'madeBy'>): ResumeFolder {
  switch (item.madeBy) {
    case 'tailor':
      return 'tailored';
    case 'editor':
    case 'copy':
      return 'edited';
    case 'upload':
      return 'uploaded';
    default:
      return item.kind === 'uploaded' ? 'uploaded' : 'edited';
  }
}

/** The ms of an item's `createdAt`, or null. */
function msOf(item: Item): number | null {
  if (item.createdAt === undefined) return null;
  const ms = Date.parse(item.createdAt);
  return Number.isFinite(ms) ? ms : null;
}

/** The local day of an instant (`YYYY-MM-DD`). */
export function dayOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The list in its three folders (module header), each in the list's own order but Tailored, newest first by day and
 *  within a day. */
export function foldersOf(items: readonly Item[]): FolderGroup[] {
  return RESUME_FOLDERS.map((folder) => {
    const mine = items.filter((item) => folderOf(item) === folder);
    if (folder !== 'tailored') return { folder, items: mine, days: [] };
    const sorted = [...mine].sort((a, b) => (msOf(b) ?? Number.NEGATIVE_INFINITY) - (msOf(a) ?? Number.NEGATIVE_INFINITY));
    const days: DayGroup[] = [];
    for (const item of sorted) {
      const ms = msOf(item);
      const day = ms === null ? null : dayOf(ms);
      const last = days.at(-1);
      if (last !== undefined && last.day === day) last.items.push(item);
      else days.push({ day, items: [item] });
    }
    return { folder, items: sorted, days };
  });
}

/** A day's heading ("Nov 9, 2026"), in the person's own time zone. */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
