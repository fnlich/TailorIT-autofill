/*
 * Read-back (docs/ARCHITECTURE.md "Filler › Statuses"): after every write the DOM is read again, and again after the
 * pass's settle in a fresh scan. A value counts as verified when it reads back equivalent: digits for phones,
 * case-folded for emails, as a number for amounts, with collapsed white space for other text, the option's identity
 * (its place among the visible options and its clean label) for choices, and the file's name and size for uploads.
 * A multi-option write is read back the same way: every planned place selected and still carrying its planned clean
 * label, so a list re-ordered or re-labelled under our write never verifies.
 * A page that reformats a value equivalently still verifies; one that rejects it (an empty value, aria-invalid) does not.
 */
import { qualifiedLabel } from '../../core/text/keys';
import type { FieldKey } from '../../core/types/field';
import type { WriteValue } from '../../core/types/intent';
import { isDisabled, isReadOnly } from '../kinds';
import { cleanOptionLabel } from '../option-hash';
import type { FieldTarget, FillOutcome, ReadBackRule, ScannedField, ScanResult } from '../types';
import { dateValueFor } from './date';

/** The read-back rule a field's own type gives: digits for tel, case-folded for email, numeric for number. */
export function readBackRuleOf(field: ScannedField): ReadBackRule {
  switch (field.constraints.format) {
    case 'tel':
      return 'digits';
    case 'email':
      return 'casefold';
    case 'number':
    case 'integer':
    case 'currency':
      return 'numeric';
    default:
      return 'text';
  }
}

/** Do two texts read the same under a rule? */
export function sameText(actual: string, expected: string, rule: ReadBackRule): boolean {
  switch (rule) {
    case 'exact':
      return actual === expected;
    case 'digits': {
      const digits = expected.replace(/\D/g, '');
      return digits !== '' && actual.replace(/\D/g, '') === digits;
    }
    case 'casefold':
      return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    case 'numeric': {
      const a = numberIn(actual);
      const b = numberIn(expected);
      return a !== null && a === b;
    }
    default:
      return collapse(actual) === collapse(expected);
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function numberIn(text: string): number | null {
  const cleaned = text.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Two clean option labels name the same option (compared as the option-set hash compares them). */
export function sameOptionLabel(label: string, cleanLabel: string): boolean {
  return qualifiedLabel(cleanOptionLabel(label)) === qualifiedLabel(cleanLabel);
}

/** Does the target hold `value` now? */
export function holds(target: FieldTarget, value: WriteValue, rule: ReadBackRule, file?: { name: string; size: number }):
  boolean {
  const { field, control } = target;
  switch (value.kind) {
    case 'text':
      return sameText((control as HTMLInputElement).value, value.text, rule);
    case 'date': {
      const expected = dateValueFor(control as HTMLInputElement, value.iso);
      return expected !== null && (control as HTMLInputElement).value === expected;
    }
    case 'check':
      return (control as HTMLInputElement).checked;
    case 'option': {
      const option = field.options === 'lazy' ? undefined : field.options[value.index];
      if (option === undefined || !sameOptionLabel(option.label, value.cleanLabel)) return false;
      if (field.kind === 'radio') return target.members[value.index]?.checked ?? false;
      return target.options[value.index]?.selected ?? false;
    }
    case 'options': {
      const options = field.options === 'lazy' ? [] : field.options;
      return value.indices.length === value.cleanLabels.length && value.indices.every((index, at) => {
        const option = options[index];
        if (option === undefined || !sameOptionLabel(option.label, value.cleanLabels[at]!)) return false;
        return (field.kind === 'checkbox-group' ? target.members[index]?.checked : target.options[index]?.selected) ?? false;
      });
    }
    case 'file': {
      const held = (control as HTMLInputElement).files?.[0];
      return held !== undefined && file !== undefined && held.name === file.name && held.size === file.size;
    }
    default:
      return false;
  }
}

/** True when the page marked the field invalid: aria-invalid="true" on the control or a group member. */
export function markedInvalid(target: FieldTarget): boolean {
  const elements: Element[] = [target.control, ...target.members];
  return elements.some((el) => (el.getAttribute('aria-invalid') ?? '').trim().toLowerCase() === 'true');
}

/**
 * The verification after the pass's settle: the field found again by key in `fresh` (a new scan), still enabled,
 * holding the value, and not marked invalid by the page. A field that cannot be found is not checked.
 */
export function verifyAfterSettle(fresh: ScanResult, key: FieldKey, value: WriteValue,
  options: { rule?: ReadBackRule; file?: { name: string; size: number } } = {}):
  Pick<FillOutcome, 'verification' | 'reason'> {
  const target = fresh.target(key);
  if (target === null) return { verification: 'not-checked', reason: 'element-not-found' };
  if (isDisabled(target.control) || isReadOnly(target.control)) {
    return { verification: 'mismatch', reason: 'disabled-or-readonly' };
  }
  const rule = options.rule ?? readBackRuleOf(target.field);
  if (!holds(target, value, rule, options.file)) return { verification: 'mismatch', reason: 'verify-mismatch' };
  if (markedInvalid(target)) return { verification: 'mismatch', reason: 'value-rejected-by-site' };
  return { verification: 'verified', reason: 'ok' };
}
