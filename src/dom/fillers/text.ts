/*
 * The text filler (docs/design/runtime.md §6): text inputs and textareas. The prototype value setter, then input
 * (insertReplacementText), change, focusout and blur, so React and Vue register the change and validation on leaving
 * the field runs. A value longer than maxLength is never cut: it is refused as maxlength-exceeded and flagged. A text box
 * its adapter declares a key for (Adapter.keyAroundWrite: Workable's date masks, which take a written value only after
 * a keydown and then open their calendar) gets that key, a keydown and a keyup, right before the value is set and once
 * more after the events; only when the value is not there already, and never Enter. A number box (read back as
 * numbers) that drops a write and keeps what it held rejected the value (value-rejected-by-site: Workable's salary box
 * drops anything but digits); any other box that puts its old value back ignored our events (needs-your-click).
 */
import type { FillOutcome, ReadBackRule } from '../types';
import { editableText } from '../values';
import { fireChange, fireInput, fireKey, fireLeave, setValue, windowOf, type DeclaredKey } from './events';
import { done, mismatch, refused } from './outcome';
import { sameText } from './verify';

/** Writes `text` into a text input or textarea and reads it back under `rule`; `key`, when given, is sent around the
 *  write (see the header). */
export function fillText(el: HTMLInputElement | HTMLTextAreaElement, text: string, rule: ReadBackRule,
  key: DeclaredKey | null = null): FillOutcome {
  // maxLength counts UTF-16 code units, as the browser does; -1 means no limit, and 0 is a limit nobody can type within
  // (DOM-13).
  if (el.maxLength >= 0 && text.length > el.maxLength) return refused('maxlength-exceeded');
  const before = el.value;
  if (before === text) return done(false, 'already-correct');
  if (key !== null) fireKey(el, key);
  setValue(el, text);
  fireInput(el, 'text');
  fireChange(el);
  fireLeave(el);
  if (key !== null) fireKey(el, key);
  const after = el.value;
  if (sameText(after, text, rule)) return done(true, 'ok');
  // A number box that dropped what is no number; else a controlled widget that ignored our events puts its old value
  // back.
  if (after === before) return rule === 'numeric' && text.trim() !== '' ? mismatch('value-rejected-by-site')
    : refused('needs-your-click');
  return mismatch(after === '' ? 'value-rejected-by-site' : 'verify-mismatch');
}

// ── v5 p2-fill: rich-text boxes (contenteditable) ──
/** A text's lines, whatever its line breaks. */
function lineList(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** A text as a rich-text box would show it once written (values.ts editableText): one kind of line break, non-breaking
 *  spaces as spaces, no trailing white space. */
function asShown(text: string): string {
  const lines = text.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
  return lines.trim() === '' ? '' : lines.replace(/\s+$/, '');
}

/**
 * Writes `text` into a rich-text box (dom/kinds.ts isEditingHost: a contenteditable editing host, PLAN Phase 2) and
 * reads it back under `rule`. No value setter reaches what an editor holds (ProseMirror, Quill, Lexical, Slate, Draft
 * and the rest keep their own model and draw the box from it), so the box is written as a person's typing writes it:
 * the box takes the focus (no scroll), its whole content is selected (the selection is the box's own content alone),
 * and its text is replaced one line at a time, insertText for a line and insertParagraph between lines, as Enter
 * makes them. Each insert is first offered as an untrusted, cancelable beforeinput naming it (EDITING_EVENTS), which an
 * editor keeping its own model takes and cancels (Jobright offers the same event); where none cancels it, the browser's
 * own editing makes it (document.execCommand), with the browser's own input event and DOM change, which every editor
 * reads as typing: a trusted-equivalent insert, with no key pressed and no page script called. Then the box loses the
 * focus (blur), so validation on leaving runs, and the selection is cleared. A box that took nothing (no insert taken
 * and its text unchanged) ignored the write (needs-your-click); one whose editor took an insert but shows nothing yet
 * (Lexical draws on a microtask) reads as written and not verified, and the pass's verification after its settle has
 * the last word.
 * v5 p2-fill review (L6): an editor that takes its selection from the document's selectionchange (Lexical, and others
 * that sync it on a task) would insert at the caret it last saw, not over the box's content, were the insert offered at
 * once: so a run selects the box first (selectEditable) and waits until the editor can have seen that selection (past
 * the document's next selectionchange and one task more, at most SELECTION_SEEN_MS); fillEditable then keeps a
 * selection that is the box's whole content already, and makes it only where it is not.
 */
export function fillEditable(el: HTMLElement, text: string, rule: ReadBackRule): FillOutcome {
  const before = editableText(el);
  if (before === asShown(text)) return done(false, 'already-correct');
  const view = windowOf(el);
  const doc = el.ownerDocument;
  const selection = view.getSelection();
  if (selection === null || typeof doc.execCommand !== 'function') return refused('needs-your-click');
  el.focus({ preventScroll: true });
  const tree = el.getRootNode() as Document | ShadowRoot;
  if (tree.activeElement !== el) return refused('needs-your-click');
  // v5 p2-fill review (L6): selected already by selectEditable, its editor past the change: kept as it is.
  if (!selectsAll(selection, el)) selectAll(selection, el);
  let taken = false;
  /** One insert: offered to the box's editor first, else the browser's own command. Answers whether it was made. */
  const insert = (inputType: 'insertText' | 'insertParagraph' | 'deleteContentBackward', data: string | null): boolean => {
    const offered = new view.InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true,
      composed: true });
    if (!el.dispatchEvent(offered)) {
      taken = true;
      return true;
    }
    if (!el.isConnected) return false;
    const command = inputType === 'deleteContentBackward' ? 'delete' : inputType;
    const made = data === null ? doc.execCommand(command, false) : doc.execCommand(command, false, data);
    if (made) taken = true;
    return made;
  };
  if (asShown(text) === '') insert('deleteContentBackward', null);
  else {
    for (const [at, line] of lineList(text).entries()) {
      if (at > 0 && !insert('insertParagraph', null)) break;
      if (line !== '' && !insert('insertText', line)) break;
    }
  }
  el.blur();
  selection.removeAllRanges();
  const after = editableText(el);
  if (sameText(after, text, rule)) return done(true, 'ok');
  if (after === before) return taken ? mismatch('verify-mismatch') : refused('needs-your-click');
  return mismatch(after === '' ? 'value-rejected-by-site' : 'verify-mismatch');
}

// v5 p2-fill review (L6)
/** The longest the writer waits for a rich-text box's editor to see its selection. */
export const SELECTION_SEEN_MS = 100;

/** Selects the whole content of `el`. */
function selectAll(selection: Selection, el: HTMLElement): void {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Whether the selection is the whole content of `el`, as selectAll makes it. */
function selectsAll(selection: Selection, el: HTMLElement): boolean {
  if (selection.rangeCount !== 1) return false;
  const range = selection.getRangeAt(0);
  const whole = el.ownerDocument.createRange();
  whole.selectNodeContents(el);
  try {
    return range.compareBoundaryPoints(whole.START_TO_START, whole) === 0
      && range.compareBoundaryPoints(whole.END_TO_END, whole) === 0;
  } catch {
    // Another tree than the box's (a shadow root's selection, as the document reports it).
    return false;
  }
}

/**
 * Selects the whole content of a rich-text box, as fillEditable would (the box takes the focus, no scroll), and waits
 * until its editor can have seen that selection: past the document's next selectionchange and one task more (an editor
 * that syncs on a microtask or a task, as Lexical does), at most `capMs` (SELECTION_SEEN_MS), and no longer than the
 * run. Nothing is inserted; a box that does not take the focus is left as it is (fillEditable then refuses it).
 */
export async function selectEditable(el: HTMLElement, signal?: AbortSignal, capMs = SELECTION_SEEN_MS): Promise<void> {
  const view = windowOf(el);
  const doc = el.ownerDocument;
  const selection = view.getSelection();
  if (selection === null || signal?.aborted === true) return;
  el.focus({ preventScroll: true });
  if ((el.getRootNode() as Document | ShadowRoot).activeElement !== el) return;
  await new Promise<void>((resolve) => {
    let timer = 0;
    const finish = (): void => {
      doc.removeEventListener('selectionchange', seen);
      signal?.removeEventListener('abort', finish);
      view.clearTimeout(timer);
      resolve();
    };
    const seen = (): void => {
      view.clearTimeout(timer);
      timer = view.setTimeout(finish, 0);
    };
    doc.addEventListener('selectionchange', seen);
    signal?.addEventListener('abort', finish, { once: true });
    timer = view.setTimeout(finish, capMs);
    selectAll(selection, el);
  });
}
// ── end v5 p2-fill ──
