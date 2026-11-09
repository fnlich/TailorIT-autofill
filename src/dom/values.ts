/*
 * What a field holds when it is scanned (docs/design/runtime.md §5.10): a prefill (a resume parse, browser autofill,
 * "use my last application") or our earlier write. It is held in memory only: it travels to the worker inside the
 * FieldSpec for reconciliation and is never logged, stored or reported. A selection is read as the labels of the
 * selected options a person can see; a placeholder ("Select...") selected by default counts as empty.
 */
import type { FieldKind } from '../core/enums';
import type { CurrentValue } from '../core/types/field';
import { capCodePoints } from '../core/text/fold';
import { isEditingHost } from './kinds';
import { cleanOptionLabel, isPlaceholderOption } from './option-hash';
import { MAX_SELECTED_LABELS, TEXT_CAP_CURRENT } from './thresholds';

// ── v5 p2-fill: rich-text boxes (contenteditable) ──
/** What a rich-text box (kinds.ts isEditingHost) shows as its text: its rendered text (innerText: a paragraph or a
 *  line break is a new line, what CSS hides is left out, a placeholder drawn by ::before is no text), non-breaking
 *  spaces as spaces, trailing white space dropped, and '' for a box that shows only white space (an empty editor
 *  keeps an empty paragraph). Memory only. */
export function editableText(el: HTMLElement): string {
  const text = (typeof el.innerText === 'string' ? el.innerText : el.textContent ?? '').replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n');
  return text.trim() === '' ? '' : text.replace(/\s+$/, '');
}

/** A text-like control's text: an input's or a textarea's value, a rich-text box's text (editableText). */
export function textOfControl(control: Element): string {
  if (isEditingHost(control)) return editableText(control);
  const value = (control as HTMLInputElement | HTMLTextAreaElement).value;
  return typeof value === 'string' ? value : '';
}
// ── end v5 p2-fill ──

/** One option of a scanned field, as values.ts needs it: its label and whether it is selected now. */
export interface SelectableOption {
  label: string;
  selected: boolean;
}

/** The current value of a field. `control` is the control (or a group's first member); `options` are its visible
 *  options with their selection read now (select options, or a group's members); `checked` reads whether a lone
 *  checkbox shows ticked (its adapter's reading, else its own checked). */
export function currentValueOf(kind: FieldKind, control: Element, options: readonly SelectableOption[],
  checked: (input: HTMLInputElement) => boolean = (input) => input.checked): CurrentValue {
  switch (kind) {
    case 'text':
    case 'textarea':
    case 'date': {
      // v5 p2-fill: a rich-text box's text too.
      const value = textOfControl(control);
      return value === '' ? { kind: 'empty' } : { kind: 'text', text: capCodePoints(value, TEXT_CAP_CURRENT) };
    }
    case 'checkbox':
      return { kind: 'checked', checked: checked(control as HTMLInputElement) };
    case 'file': {
      const count = (control as HTMLInputElement).files?.length ?? 0;
      return count === 0 ? { kind: 'empty' } : { kind: 'files', count };
    }
    default: {
      const labels = options.filter((option) => option.selected)
        .map((option) => option.label)
        .filter((label) => {
          const clean = cleanOptionLabel(label);
          return clean !== '' && !isPlaceholderOption(clean);
        })
        .slice(0, MAX_SELECTED_LABELS);
      return labels.length === 0 ? { kind: 'empty' } : { kind: 'selected', labels };
    }
  }
}
