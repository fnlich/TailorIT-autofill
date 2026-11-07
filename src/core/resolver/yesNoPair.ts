/*
 * A Yes/No question asked with two checkboxes (core pass Z2 of 2026-11-06, CORE-BLOCKERS item 29). JazzHR asks its
 * checkbox questions with two boxes named apart, "Yes" and "No", under one title that names no element
 * (fixtures/jazzhr/*-form.html, the jazzhr-3 and -4 snapshots: <input type="checkbox" name="resumator-checkbox-<n>-1"
 * value="Yes">Yes, ...-2 value="No">No), which the scanner reads as one checkbox group (its adapter's groupOf). A yes/no
 * category is answered through a select, radios, a combobox or a lone box (categories.ts YES_NO), never a set, so such a
 * question was left to the person. Now a checkbox group of exactly two options, one whose first word is "yes" and one
 * whose first word is "no", is classified and answered as a Yes/No radio (askedAs): its answer is the one box that
 * matches (the plan's set of that box, frame.ts), the other left as it is; a box already ticked against the answer is
 * the person's (the plan writes a legal or EEO set only where nothing else is chosen), and the read-back holds both
 * boxes (dom/fillers/verify.ts: the planned box ticked, the other not). Any other checkbox group is read as before.
 */
import type { FieldSpec } from '../types/field';

/** The first word of an option's label, folded to lower case; '' for none. */
function firstWord(label: string): string {
  return label.toLowerCase().split(/[^\p{L}\p{N}]+/u).find((word) => word !== '') ?? '';
}

/** Whether a field is a checkbox group of two options, one Yes and one No, by their first words. */
export function isYesNoPair(spec: Pick<FieldSpec, 'kind' | 'options'>): boolean {
  if (spec.kind !== 'checkbox-group' || spec.options === 'lazy' || spec.options.length !== 2) return false;
  const words = spec.options.map((option) => firstWord(option.label)).sort();
  return words[0] === 'no' && words[1] === 'yes';
}

/** The field as its question is asked: a Yes/No pair of checkboxes (isYesNoPair) as a Yes/No radio, for its
 *  classification and its value; any other field as it is. */
export function askedAs(spec: FieldSpec): FieldSpec {
  return isYesNoPair(spec) ? { ...spec, kind: 'radio' } : spec;
}
