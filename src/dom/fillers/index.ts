/*
 * fill(): one planned write into one field (docs/design/runtime.md §6), dispatched by the field's kind and the value's
 * kind. The caller has re-found the field and run the Guard (the DOM half in dom/guard.ts, the core's provenance and
 * canary checks); this repeats the cheap checks that keep a write impossible on a gone, disabled or camouflaged control,
 * then writes with untrusted DOM events only and reads back at once. The pass's settle and verifyAfterSettle
 * (verify.ts) decide verified for the report.
 *
 * Each kind takes its own value: text and textarea a text, select and radio an option, multiselect and checkbox-group
 * options, a lone checkbox a check, date a date and file the resume. Any other pairing, or an options value without
 * one clean label per index, is a planner bug (internal-error); an ARIA widget is the widget helpers' (dom/widgets),
 * so fill() refuses it (widget-unsupported). A choice whose option no longer reads as planned is refused as
 * options-changed, with nothing written. A text box its adapter declares a key for around the write
 * (Adapter.keyAroundWrite) gets it from the text filler, once assertNotSubmit allows the box.
 */
import type { Adapter } from '../../adapters/types';
import type { WriteValue } from '../../core/types/intent';
import { isDisabled, isEditingHost, isReadOnly } from '../kinds';
import type { FieldTarget, FillOutcome, ReadBackRule } from '../types';
import { fillCheckbox, fillCheckboxGroup, fillRadio } from './choice';
import { fillDate } from './date';
import { WIDGET_KEYS, type WidgetKey } from './events';
import { fillFile } from './file';
import { assertNotSubmit } from './not-submit';
import { refused } from './outcome';
import { fillMultiSelect, fillSelect } from './select';
import { fillEditable, fillText } from './text';
import { readBackRuleOf } from './verify';

/** What a fill needs besides the field and the value. */
export interface FillContext {
  adapter: Adapter | null;
  /** The form root, where the adapter's Submit button is looked up for assertNotSubmit. */
  root: Element | null;
  /** The resume, rebuilt by the content script from the transfer, for a file write. */
  file?: File;
  /** How the text read-back is compared; by default from the field's format (digits for tel, case-folded for email).
   *  The content script passes 'digits' for a phone and 'casefold' for an email from the planned row's category. */
  readBack?: ReadBackRule;
}

/** The key a text box's adapter declares around its write (Adapter.keyAroundWrite), one of WIDGET_KEYS; null when it
 *  declares none, or its hook fails. */
function keyAroundWrite(control: Element, adapter: Adapter | null): WidgetKey | null {
  let key: WidgetKey | null | undefined;
  try {
    key = adapter?.keyAroundWrite?.(control);
  } catch {
    key = null;
  }
  return key !== null && key !== undefined && (WIDGET_KEYS as readonly string[]).includes(key) ? key : null;
}

/** Writes one planned value into a field just re-found, and reads it back. */
export function fill(target: FieldTarget, value: WriteValue, ctx: FillContext): FillOutcome {
  const { field, control } = target;
  if (!control.isConnected) return refused('element-not-found');
  if (field.camouflaged) return refused('not-user-visible');
  if (field.kind !== 'radio' && field.kind !== 'checkbox-group' && (isDisabled(control) || isReadOnly(control))) {
    return refused('disabled-or-readonly');
  }
  // An ARIA widget, or one the adapter declares, and options that exist only once a widget is opened: the widget
  // helpers (dom/widgets) fill those, asynchronously, never the native fillers.
  if (target.widget !== undefined || field.options === 'lazy') return refused('widget-unsupported');
  // s2 wd: a date drawn in parts is date-parts.ts's (fillDateParts, awaited by content/pass.ts), never fillDate's.
  if (target.dateParts !== undefined) return refused('widget-unsupported');
  // v5 p2-fill: a picker control's file goes through the page's own picker (picker.ts, awaited by content/pass.ts).
  if (target.picker === true) return refused('widget-unsupported');
  if (value.kind === 'options' && value.cleanLabels.length !== value.indices.length) return refused('internal-error');
  const clicks = { adapter: ctx.adapter, root: ctx.root };
  switch (field.kind) {
    case 'text':
    case 'textarea': {
      if (value.kind !== 'text') return refused(value.kind === 'date' ? 'format-unsupported' : 'internal-error');
      // The key its adapter declares around the write (Workable's date masks), only to a box assertNotSubmit allows.
      const key = keyAroundWrite(control, ctx.adapter);
      if (key !== null && !assertNotSubmit(control, clicks).ok) return refused('needs-your-click');
      // v5 p2-fill: a rich-text box (contenteditable) takes the browser's own insert (text.ts fillEditable), never a key.
      if (isEditingHost(control)) return fillEditable(control, value.text, ctx.readBack ?? readBackRuleOf(field));
      return fillText(control as HTMLInputElement | HTMLTextAreaElement, value.text,
        ctx.readBack ?? readBackRuleOf(field), key);
    }
    case 'select':
      return value.kind === 'option' ? fillSelect(target, value.index, value.cleanLabel) : refused('internal-error');
    case 'multiselect':
      return value.kind === 'options' ? fillMultiSelect(target, value) : refused('internal-error');
    case 'radio':
      return value.kind === 'option' ? fillRadio(target, value.index, value.cleanLabel, clicks) : refused('internal-error');
    case 'checkbox':
      return value.kind === 'check' ? fillCheckbox(target, clicks) : refused('internal-error');
    case 'checkbox-group':
      return value.kind === 'options' ? fillCheckboxGroup(target, value, clicks) : refused('internal-error');
    case 'date':
      return value.kind === 'date' ? fillDate(control as HTMLInputElement, value.iso) : refused('internal-error');
    case 'file':
      return value.kind === 'file' ? fillFile(control as HTMLInputElement, ctx.file) : refused('internal-error');
    default:
      return refused('widget-unsupported');
  }
}

export { assertNotSubmit, clickIfAllowed, SUBMIT_WORDS, CLICK_REFUSALS, type ClickRefusal, type NotSubmitContext } from './not-submit';
export { holds, markedInvalid, readBackRuleOf, sameText, verifyAfterSettle } from './verify';
export { acceptTokens, DOCX_MIME } from './file';
export { accepts } from '../../core/accept';
export { dateValueFor } from './date';
export { ALLOWED_EVENTS } from './events';
