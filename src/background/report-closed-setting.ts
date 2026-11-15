/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §3.1): Options › "Report closed jobs
 * to TailorIT automatically", on unless the person turns it off.
 * - On: a closed sign the extension's check finds in a posting page the person opened (closed-check.ts), or the end of
 *   an auto-apply job whose posting is gone (the agent's, the Queue tab's), is reported to TailorIT by itself
 *   (closed-reports.ts). Off: nothing is sent by itself; the job card offers Report as closed, which is the person's own
 *   report and works whatever this says.
 * - Where it lives: storage.local's REPORT_CLOSED_KEY, a boolean; absent (or anything else) reads as on, as the v2.0
 *   close-tab setting does (close-tab.ts). It is not in the settings object, which the content script parses (its
 *   bundle must not change): only the worker and the options page (through reports/closedAuto) read and write it.
 */
import type { StorageArea } from '../platform/types';

/** storage.local: the switch (false: off; absent: on). */
export const REPORT_CLOSED_KEY = 'reports:closedAuto';

/** Whether closed postings are reported to TailorIT by themselves: on unless the person turned it off (a storage that
 *  cannot be read reads as on, the default). */
export async function reportClosedAutomatically(local: StorageArea): Promise<boolean> {
  try {
    return (await local.get(REPORT_CLOSED_KEY)) !== false;
  } catch {
    return true;
  }
}

/** The person's choice, kept; answers the switch as it reads after. */
export async function setReportClosedAutomatically(local: StorageArea, on: boolean): Promise<boolean> {
  await local.set({ [REPORT_CLOSED_KEY]: on });
  return reportClosedAutomatically(local);
}
