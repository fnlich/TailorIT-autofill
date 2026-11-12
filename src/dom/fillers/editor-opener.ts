/*
 * jr7 ENGINE-7 E2 item 5 (FIX7PLAN §6.2; UKGR-9): the editor-opener door. Before a step's fill, each control the
 * adapter names as opening a single-entry editor the run must fill (Adapter.editorOpener: UKG Ready's Contact Edit
 * while its summary says "Missing Information", snapshot7 secure7.saashr) is pressed once per document, through
 * not-submit.ts clickEditorOpener (every never-press rule held there); nothing else. The fill then reads the editor's
 * fields as any step's. Only src/content/orchestrator.ts calls openEditors (test/allow-submit.test.ts).
 */
import type { Adapter } from '../../adapters/types';
import { clickEditorOpener } from './not-submit';

/** Presses each editor opener the adapter names in `root` (module header); answers how many it pressed. A hook that
 *  throws names none. */
export function openEditors(adapter: Adapter, doc: Document, root: Element): number {
  if (adapter.editorOpener === undefined) return 0;
  let controls: HTMLElement[];
  try {
    controls = adapter.editorOpener(root);
  } catch {
    return 0;
  }
  let pressed = 0;
  for (const control of controls) if (clickEditorOpener(adapter, doc, control) !== null) pressed += 1;
  return pressed;
}
