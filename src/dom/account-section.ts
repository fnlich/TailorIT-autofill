/*
 * The snapshot build of 2026-11-06 (core-x, item 2; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): a create-account part inside an application
 * form (Adapter.accountSection: iCIMS's Candidate Profile, whose "Create a login" asks a login, a password and the
 * password again beside the profile's own questions, all sent by "Submit Profile"). It is a section of the form, never a
 * page of its own:
 * - its password boxes never make the page an account's creation (dom/pause-detect.ts), so the rest of the form fills;
 * - nothing in it is filled from the profile (the adapter excludes it from the fields);
 * - it follows Sign-in mode: Auto types the person's saved job-site sign-in into its boxes through content/sign-in.ts
 *   (the adapter's declared create-account form, whose button is the person's: personPresses), Manual leaves it to the
 *   person;
 * - while one of its required boxes is empty, Next and Submit hold for the person (accountLeft), as for any required
 *   field.
 * The section counts only where the adapter declares it inside the form root and its declared create-account form
 * (signInForm 'create-account') has a password box and every box inside it: anything else is no section, and the page
 * reads as before. Nothing here reads a box's value but whether it is empty; nothing is kept or logged.
 *
 * jr6 ENGINE E0 (FIXPLAN §3.1 item 11, ICIMS-04): where no single element holds the part alone, the adapter declares
 * its rows (Adapter.accountRows: careers-sentinel's Login, Password and Re-enter rows). accountRowsOf reads either
 * declaration as one list. Until ENGINE E2 (FIXPLAN §6.2 item 6) a list of one is read as the section was, and several
 * rows are no section: the page reads as before.
 */
import type { Adapter, SignInForm } from '../adapters/types';
import { isUserVisible } from './visibility';

/** The adapter's declared create-account form, when every one of its boxes sits inside `section` and it has a password
 *  box; null otherwise (or when a hook throws). */
function declaredFormIn(adapter: Adapter, doc: Document, section: Element): SignInForm | null {
  const form = adapter.signInForm?.(doc, 'create-account') ?? null;
  if (form === null || form.password === null) return null;
  const boxes = boxesOf(form);
  return boxes.every((box) => section.contains(box)) ? form : null;
}

/** The boxes of a declared create-account form: its email, its email again, its password and the password again. */
function boxesOf(form: SignInForm): HTMLInputElement[] {
  return [form.email, form.confirmEmail ?? null, form.password, form.confirm]
    .filter((box): box is HTMLInputElement => box !== null);
}

/** jr6 FIXPLAN §3.1 item 11 (module header): the account part the adapter declares in the form root `form`, as one
 *  list: its rows (Adapter.accountRows) where it answers some, else its one section (Adapter.accountSection) as a list
 *  of one; empty where it declares neither. A hook that throws throws here: the callers catch. */
function accountRowsOf(adapter: Adapter, form: Element): readonly Element[] {
  const rows = adapter.accountRows?.(form) ?? null;
  if (rows !== null && rows.length > 0) return rows;
  const section = adapter.accountSection?.(form) ?? null;
  return section === null ? [] : [section];
}

/** The form root's account section (module header), or null. `root`: the form root (null: the adapter's own detect()
 *  finds it). jr6 E0: only a declared list of one (accountRowsOf) can be a section. */
export function accountSectionOf(adapter: Adapter | null, doc: Document, root: Element | null): Element | null {
  if (adapter === null || (adapter.accountSection === undefined && adapter.accountRows === undefined)) return null;
  try {
    const form = root ?? adapter.detect(doc)?.formRoot ?? null;
    if (form === null) return null;
    const rows = accountRowsOf(adapter, form);
    const [section] = rows;
    if (rows.length !== 1 || section === undefined || section === form || !form.contains(section)) return null;
    return declaredFormIn(adapter, doc, section) === null ? null : section;
  } catch {
    return null;
  }
}

/** The account section's declared create-account form (module header), or null where the form root holds no section. */
export function accountFormOf(adapter: Adapter, doc: Document, root: Element | null): SignInForm | null {
  const section = accountSectionOf(adapter, doc, root);
  if (section === null) return null;
  try {
    return declaredFormIn(adapter, doc, section);
  } catch {
    return null;
  }
}

/** How many of the account section's required boxes a person can see are still empty (module header): Next and Submit
 *  hold while it is more than 0. 0 where the form root holds no section. */
export function accountLeft(adapter: Adapter, doc: Document, root: Element | null): number {
  const form = accountFormOf(adapter, doc, root);
  if (form === null) return 0;
  return boxesOf(form).filter((box) => (box.required || box.getAttribute('aria-required') === 'true')
    && box.value === '' && box.isConnected && isUserVisible(box)).length;
}
