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
import { fireChange, fireInput, fireKey, fireLeave, setValue, type DeclaredKey } from './events';
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
