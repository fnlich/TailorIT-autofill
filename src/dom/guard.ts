/*
 * The DOM half of the pre-write Guard (docs/design/runtime.md §6 "Before every write"; docs/ARCHITECTURE.md "Guard").
 * Right before each write the field is re-found by key in a fresh scan, never from a cached node, and refused unless:
 * - it is still there, as the same kind, with the same visible label it was planned with (a field whose options
 *   changed is told apart as options-changed);
 * - it is still visible, or still qualified by the proxy rule (the fresh scan only returns such fields), and not
 *   drawn camouflaged;
 * - it shows a visible label (labelSource 'none' or a not-visible aria-label is never written);
 * - it is enabled and not read-only;
 * - it is not inside the extension's own UI and is not an auth field, and the step shows no password or one-time-code
 *   field (on an auth step nothing is filled, not even the email).
 * The content script composes this with the core's provenance and canary checks; a refusal blocks the field with the
 * reason given.
 */
import type { FieldKind } from '../core/enums';
import type { BaseKey, FieldKey } from '../core/types/field';
import { isDisabled, isReadOnly, kindOf } from './kinds';
import { isInOwnUi } from './own-ui';
import type { DomGuardVerdict, ScanResult } from './types';
import { isUserVisible } from './visibility';

/** What the planner saw of the field: the guard checks the page still shows the same thing. */
export interface PlannedField {
  key: FieldKey;
  baseKey: BaseKey;
  label: string;
  kind: FieldKind;
}

/** Re-finds a planned field in a fresh scan and checks it may be written now. `last` is any earlier scan of the same
 *  form root; it is only used to scan again. */
export function domGuardBeforeWrite(last: ScanResult, planned: PlannedField): DomGuardVerdict {
  const fresh = last.rescan();
  if (fresh.authFields > 0) return { ok: false, reason: 'auth-required' };
  const target = fresh.target(planned.key);
  if (target === null) {
    const sameBase = fresh.fields.find((field) => field.baseKey === planned.baseKey);
    if (sameBase !== undefined && sameBase.key !== planned.key) return { ok: false, reason: 'options-changed' };
    // Only to say why: the control the earlier scan found, if it is still in the page, is now hidden. It is never
    // written through.
    const earlier = last.target(planned.key)?.control ?? null;
    return { ok: false, reason: earlier !== null && !isUserVisible(earlier) ? 'not-user-visible' : 'element-not-found' };
  }
  const { field, control } = target;
  if (field.kind !== planned.kind || field.label !== planned.label) return { ok: false, reason: 'element-not-found' };
  const elements: Element[] = [control, ...target.members, ...(target.widget?.members ?? [])];
  if (elements.some(isInOwnUi)) return { ok: false, reason: 'internal-error' };
  // A native control that is no field now is an auth field (or the page changed its type); a widget's element is no
  // native control, so only its text box is asked; s2 wd: nor is a date drawn in parts' wrapper, so its parts are.
  const natives = target.dateParts !== undefined ? target.dateParts.parts.map((part) => part.input)
    : target.widget === undefined ? elements : target.widget.input === null ? [] : [target.widget.input];
  if (natives.some((el) => kindOf(el).field === false)) return { ok: false, reason: 'auth-required' };
  if (field.labelSource === 'none' || !field.labelVisible) return { ok: false, reason: 'no-visible-label' };
  if (field.camouflaged) return { ok: false, reason: 'not-user-visible' };
  const disabled = target.widget !== undefined || target.dateParts !== undefined ? field.disabled || field.readOnly
    : field.kind === 'radio' || field.kind === 'checkbox-group' ? field.disabled
      : isDisabled(control) || isReadOnly(control);
  if (disabled) return { ok: false, reason: 'disabled-or-readonly' };
  return { ok: true, target };
}
