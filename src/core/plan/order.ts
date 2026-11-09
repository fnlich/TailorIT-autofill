/*
 * v5 p2-fill: the order of a pass's writes where the page parses the résumé (Adapter.quirks.resumeParse, PLAN Phase 2:
 * "the résumé uploaded before the other answers where the site parses it"). Jobright uploads the résumé before it fills
 * the rest so the platform's own parser pre-fills the form and its answers then go over the parse; ours does the same
 * only where the adapter names the parse from a snapshot (Rippling, iCIMS). The résumé's write (a file write of the
 * person's résumé, never a cover letter) moves to the front, every other write keeping its order; with no résumé write
 * the order stands. The wait for the parse itself is the content script's (dom/resume-parse.ts). Pure.
 */
import type { PlannedWrite } from '../types/fill';

/** A write as the pass queues it, as far as this order reads one. */
export interface OrderedWrite {
  write: Pick<PlannedWrite, 'value'>;
}

/** Whether a queued write puts the person's résumé into a file field. */
export function isResumeWrite(item: OrderedWrite): boolean {
  const value = item.write.value;
  return value.kind === 'file' && value.ref === 'resume';
}

/** The queue with its résumé writes first, each part keeping its order (see the header). */
export function resumeFirst<T extends OrderedWrite>(queue: readonly T[]): T[] {
  const resume = queue.filter(isResumeWrite);
  return resume.length === 0 ? [...queue] : [...resume, ...queue.filter((item) => !isResumeWrite(item))];
}
