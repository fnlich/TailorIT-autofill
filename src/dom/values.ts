/*
 * What a field holds when it is scanned (docs/design/runtime.md §5.10): a prefill (a resume parse, browser autofill,
 * "use my last application") or our earlier write. It is held in memory only: it travels to the worker inside the
 * FieldSpec for reconciliation and is never logged, stored or reported. A selection is read as the labels of the
 * selected options a person can see; a placeholder ("Select...") selected by default counts as empty.
 */
import type { FieldKind } from '../core/enums';
import type { CurrentValue } from '../core/types/field';
import { capCodePoints } from '../core/text/fold';
import { cleanOptionLabel, isPlaceholderOption } from './option-hash';
import { MAX_SELECTED_LABELS, TEXT_CAP_CURRENT } from './thresholds';

/** One option of a scanned field, as values.ts needs it: its label and whether it is selected now. */
export interface SelectableOption {
  label: string;
  selected: boolean;
}

/** The current value of a field. `control` is the control (or a group's first member); `options` are its visible
 *  options with their selection read now (select options, or a group's members). */
export function currentValueOf(kind: FieldKind, control: Element, options: readonly SelectableOption[]): CurrentValue {
  switch (kind) {
    case 'text':
    case 'textarea':
    case 'date': {
      const value = (control as HTMLInputElement | HTMLTextAreaElement).value;
      return value === '' ? { kind: 'empty' } : { kind: 'text', text: capCodePoints(value, TEXT_CAP_CURRENT) };
    }
    case 'checkbox':
      return { kind: 'checked', checked: (control as HTMLInputElement).checked };
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
