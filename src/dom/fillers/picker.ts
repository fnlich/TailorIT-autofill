/*
 * v5 p2-fill (PLAN decision 14; Jobright's file-picker interception, in our own design): a résumé control its adapter
 * declares (Adapter.uploadPickers: a button with no file input in the form, which opens the site's own file picker by
 * calling a file input's click() or showOpenFilePicker()) gets the run's chosen file instead of an OS dialog. The
 * page's side is page/picker.ts, among the page patches the worker runs in the frame once a run begins (dom/patches.ts):
 * 1. the control is armed (picker.arm, on the control): for this one press, the page's click() on a file input opens
 *    no picker and the patch tells which input it was (PICKED, its relatedTarget), and its showOpenFilePicker()
 *    waits for our answer;
 * 2. the control is pressed with an untrusted click(), through the never-submit door (not-submit.ts clickIfAllowed);
 * 3. what the page opened is waited for, PICKER_WAIT_MS at most (a page may open it after a promise: react-dropzone
 *    falls back to its input's click() once showOpenFilePicker refuses an untrusted press);
 * 4. a file input of this document is given the file as any file input is (file.ts fillFile: its accept list checked,
 *    the file set through a DataTransfer, input and change), and read back; a showOpenFilePicker() is answered with the
 *    file alone (SUPPLY, a detached input holding it: the page reads it from the handle it resolves with), never
 *    read back (upload-not-confirmed, flagged for the person, unless the adapter reads the page's own word);
 * 5. the control is disarmed (picker.disarm), whatever happened.
 * v5 p2-fill review (security 7c): the arm is made on the control's scope (Adapter.uploadPickerScope, else its parent),
 * and the page's side takes only a file input inside it (or one made at the press and never put in the page): a file
 * input of another upload is never given the résumé. The person's own pointer or key on the page during the wait (a
 * trusted pointerdown, mousedown, touchstart or keydown, heard first) disarms at once: their press is theirs.
 * Only the planned write's own file is ever supplied, only in answer to this one press. Nothing is pressed where no
 * patch answers the arm (no run began in the frame, or the page answered our probe itself): the field is needs-your-click, the person's to attach, as is
 * a press the page answered with no picker. Nothing here reads or logs a value.
 */
import type { Adapter } from '../../adapters/types';
import { PICKED, PICKED_FILE_SYSTEM, PICKED_INPUT, SUPPLY } from '../patch-protocol';
import { askPatches } from '../patches';
import { isInOwnUi } from '../own-ui';
import { deadline } from '../time';
import type { FillOutcome } from '../types';
import { setFiles, windowOf } from './events';
import { fillFile } from './file';
import { clickIfAllowed } from './not-submit';
import { mismatch, refused } from './outcome';

/** How long a press waits for the page to open its picker (page/picker.ts PICKER_ARM_MS holds the arm a little longer). */
export const PICKER_WAIT_MS = 1_500;

/** What the page opened for the press: a file input of its own, or its showOpenFilePicker. */
export type Picked = { kind: 'input'; input: HTMLInputElement } | { kind: 'file-system' };

/** What a press through the page's own picker came to: the fill's outcome, the input the file went into (null where the
 *  page took it through showOpenFilePicker, or nothing was given), and what the page opened. */
export interface PickerResult {
  outcome: FillOutcome;
  input: HTMLInputElement | null;
  picked: Picked['kind'] | null;
}

/** What a press needs besides the control and the file. */
export interface PickerContext {
  adapter: Adapter | null;
  root: Element | null;
  signal?: AbortSignal;
  waitMs?: number;
}

/** Whether the page's picked input is one the file may go into: a file input of the control's own document, never the
 *  extension's own UI, not disabled. */
function takesFile(input: Element | null, control: HTMLElement): input is HTMLInputElement {
  if (input === null) return false;
  const view = windowOf(control);
  return input instanceof view.HTMLInputElement && input.type === 'file' && input.ownerDocument === control.ownerDocument
    && !isInOwnUi(input) && !input.disabled;
}

/** Answers the page's showOpenFilePicker with `file` alone: a detached file input holding it, on the armed element
 *  (v5 p2-fill review: the control's scope). */
function supply(control: HTMLElement, file: File): void {
  const view = windowOf(control);
  const carrier = control.ownerDocument.createElement('input');
  carrier.type = 'file';
  setFiles(carrier, file);
  control.dispatchEvent(new view.FocusEvent(SUPPLY, { relatedTarget: carrier, bubbles: false, cancelable: false,
    composed: false }));
}

/** v5 p2-fill review (security 7c): the person's own actions that disarm a press's wait. */
const PERSON_ACTIONS = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const;

/** v5 p2-fill review (security 7c): where a press of `control` may open the file input it is given to (header). */
export function pickerScopeOf(control: HTMLElement, adapter: Adapter | null): Element {
  let declared: Element | null = null;
  try {
    declared = adapter?.uploadPickerScope?.(control) ?? null;
  } catch {
    declared = null;
  }
  return declared !== null && declared.isConnected && declared.ownerDocument === control.ownerDocument ? declared
    : control.parentElement ?? control;
}

/** Presses `control` with the page's own picker armed and gives `file` to what the page opens (see the header). */
export async function fillThroughPicker(control: HTMLElement, file: File | undefined, ctx: PickerContext):
  Promise<PickerResult> {
  if (file === undefined) return { outcome: refused('resume-unavailable'), input: null, picked: null };
  // v5 p2-fill review (security 7c): armed on the control's scope; what the page opens is told there.
  const scope = pickerScopeOf(control, ctx.adapter);
  const doc = control.ownerDocument;
  let personActed = false;
  let picked: Picked | null = null;
  let wake: () => void = () => undefined;
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const onPicked = (event: Event): void => {
    if (picked !== null || personActed || event.target !== scope) return;
    const detail = (event as UIEvent).detail;
    const related = (event as FocusEvent).relatedTarget as Element | null;
    if (detail === PICKED_INPUT && takesFile(related, control)) picked = { kind: 'input', input: related };
    else if (detail === PICKED_FILE_SYSTEM && related === null) {
      picked = { kind: 'file-system' };
      supply(scope as HTMLElement, file);
    }
    if (picked !== null) wake();
  };
  // v5 p2-fill review (security 7c): the person's own press during the wait is theirs: disarmed at once.
  const onPerson = (event: Event): void => {
    if (!event.isTrusted || picked !== null) return;
    personActed = true;
    if (scope.isConnected) askPatches(scope, 'picker.disarm');
    wake();
  };
  scope.addEventListener(PICKED, onPicked);
  for (const type of PERSON_ACTIONS) doc.addEventListener(type, onPerson, true);
  try {
    const armed = askPatches(scope, 'picker.arm', ctx.signal);
    if (armed?.ok !== true) return { outcome: refused('needs-your-click'), input: null, picked: null };
    if (!clickIfAllowed(control, { adapter: ctx.adapter, root: ctx.root })) {
      return { outcome: refused('needs-your-click'), input: null, picked: null };
    }
    if (picked === null) await Promise.race([woken, deadline(ctx.waitMs ?? PICKER_WAIT_MS, ctx.signal)]);
  } finally {
    scope.removeEventListener(PICKED, onPicked);
    for (const type of PERSON_ACTIONS) doc.removeEventListener(type, onPerson, true);
    if (scope.isConnected) askPatches(scope, 'picker.disarm');
  }
  const now = picked as Picked | null;
  if (now === null) return { outcome: refused('needs-your-click'), input: null, picked: null };
  // Given through the page's showOpenFilePicker: the page holds it, and nothing of ours can read it back.
  if (now.kind === 'file-system') return { outcome: mismatch('upload-not-confirmed'), input: null, picked: now.kind };
  return { outcome: fillFile(now.input, file), input: now.input, picked: now.kind };
}
