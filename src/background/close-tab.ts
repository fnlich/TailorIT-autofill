/*
 * v2.0 P9 (A20; docs/design/v2.0/09-extension-api8.md "Close the application tab when it is submitted"): Options ›
 * Auto-apply › "Close the application tab when it's submitted", on unless the person turns it off.
 * - It applies only to tabs auto-apply opened: the agent's own window's tab (agent.ts finishRun) and the Queue tab's tabs
 *   (queue-runner.ts submitted), once the platform confirmed the job's submission. The person's own tabs (their Autofill
 *   on a page they opened) are never closed, whatever it says, and neither is a tab kept for the person (a code, a
 *   check or a step after the Submit that is theirs).
 * - Off: such a tab is let go of (its run cancelled, the person's own settings told) and left open.
 * - Where it lives: storage.local's CLOSE_TAB_KEY, a boolean; absent (or anything else) reads as on. It is not in the
 *   settings object, which the content script parses (its bundle must not grow): only the worker and the options page
 *   (through autoApply/closeTab) read and write it.
 */
import type { StorageArea } from '../platform/types';

/** storage.local: the switch (false: off; absent: on). */
export const CLOSE_TAB_KEY = 'autoApply:closeTab';

/** Whether a tab auto-apply opened closes once its application is submitted: on unless the person turned it off (a
 *  storage that cannot be read reads as on, the default). */
export async function closeTabOnSubmit(local: StorageArea): Promise<boolean> {
  try {
    return (await local.get(CLOSE_TAB_KEY)) !== false;
  } catch {
    return true;
  }
}

/** The person's choice, kept; answers the switch as it reads after. */
export async function setCloseTabOnSubmit(local: StorageArea, on: boolean): Promise<boolean> {
  await local.set({ [CLOSE_TAB_KEY]: on });
  return closeTabOnSubmit(local);
}
