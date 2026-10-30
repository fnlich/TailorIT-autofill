/*
 * What a field allows, from its attributes (docs/design/runtime.md §5.8): maxlength, the format its type or inputmode
 * gives, min and max on numbers, accept on file inputs, and a display pattern read from a visible placeholder
 * ("MM/YYYY"), which shapes formatting and never supplies a value. Selection hints in the label text ("choose up to 2",
 * "select all that apply") are the pure core's to parse (multiselect hints), from the label and description the
 * FieldSpec already carries, so they are not read here.
 */
import type { FieldFormat } from '../core/enums';
import type { Constraints } from '../core/types/field';
import { capCodePoints } from '../core/text/fold';
import { MAX_ACCEPT_TOKENS, TEXT_CAP_ACCEPT_TOKEN, TEXT_CAP_PATTERN } from './thresholds';

/** A date mask in a placeholder: MM/DD/YYYY, DD.MM.YYYY, YYYY-MM-DD, MM/YYYY, YYYY. */
const DATE_MASK = /^(?:MM|DD|YYYY|YY|M|D)(?:\s?[/\-.]\s?(?:MM|DD|YYYY|YY|M|D)){0,2}$/i;
/** A phone mask: digits stood for by #, 9, X or 0, with the usual separators. */
const PHONE_MASK = /^\+?[\s()#9X0.-]{7,24}$/i;

/** The constraints of a control. `format` is the one its type or inputmode gives; `placeholder` is its visible
 *  placeholder, if any. */
export function constraintsOf(el: Element, format: FieldFormat | undefined, placeholder: string | null): Constraints {
  const constraints: Constraints = {};
  const tag = el.localName;
  if (tag === 'input' || tag === 'textarea') {
    // -1 means no maxlength; 0 is a limit too, which nothing fits (DOM-13).
    const maxLength = (el as HTMLInputElement).maxLength;
    if (Number.isInteger(maxLength) && maxLength >= 0) constraints.maxLength = maxLength;
  }
  let shaped = format;
  if (placeholder !== null) {
    const mask = placeholder.trim();
    if (DATE_MASK.test(mask) && /y/i.test(mask)) {
      constraints.pattern = capCodePoints(mask, TEXT_CAP_PATTERN);
      shaped ??= /d/i.test(mask) ? 'date' : /m/i.test(mask) ? 'month-year' : 'year';
    } else if (PHONE_MASK.test(mask) && (mask.match(/[#9X0]/gi)?.length ?? 0) >= 7) {
      constraints.pattern = capCodePoints(mask, TEXT_CAP_PATTERN);
      shaped ??= 'tel';
    }
  }
  if (shaped !== undefined) constraints.format = shaped;
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'number') {
      const min = Number.parseFloat(input.min);
      const max = Number.parseFloat(input.max);
      if (Number.isFinite(min)) constraints.min = min;
      if (Number.isFinite(max)) constraints.max = max;
      if (input.step !== '' && input.step !== 'any' && Number.isInteger(Number(input.step))
        && constraints.format === 'number') constraints.format = 'integer';
    }
    if (input.type === 'file') {
      const accept = input.accept.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token !== '')
        .slice(0, MAX_ACCEPT_TOKENS).map((token) => capCodePoints(token, TEXT_CAP_ACCEPT_TOKEN));
      if (accept.length > 0) constraints.accept = accept;
    }
  }
  return constraints;
}
