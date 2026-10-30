/*
 * The text filler (docs/design/runtime.md §6): text inputs and textareas. The prototype value setter, then input
 * (insertReplacementText), change, focusout and blur, so React and Vue register the change and validation on leaving
 * the field runs. A value longer than maxLength is never cut: it is refused as maxlength-exceeded and flagged.
 */
import type { FillOutcome, ReadBackRule } from '../types';
import { fireChange, fireInput, fireLeave, setValue } from './events';
import { done, mismatch, refused } from './outcome';
import { sameText } from './verify';

/** Writes `text` into a text input or textarea and reads it back under `rule`. */
export function fillText(el: HTMLInputElement | HTMLTextAreaElement, text: string, rule: ReadBackRule): FillOutcome {
  // maxLength counts UTF-16 code units, as the browser does; -1 means no limit.
  if (el.maxLength > 0 && text.length > el.maxLength) return refused('maxlength-exceeded');
  const before = el.value;
  if (before === text) return done(false, 'already-correct');
  setValue(el, text);
  fireInput(el, 'text');
  fireChange(el);
  fireLeave(el);
  const after = el.value;
  if (sameText(after, text, rule)) return done(true, 'ok');
  // A controlled widget that ignored our events puts its old value back.
  if (after === before) return refused('needs-your-click');
  return mismatch(after === '' ? 'value-rejected-by-site' : 'verify-mismatch');
}
