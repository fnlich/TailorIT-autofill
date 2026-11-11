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
 * declaration as one list.
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 6, ICIMS-04; snapshot6 icims1, careers-sentinel's Basic Information, whose "Create
 * your profile" pane asks the person's name and email beside the Login, Password and Re-enter rows): several rows are
 * the account part too (accountRowsIn), read as the section is: every box of the declared create-account form inside
 * one of the rows, and nothing else of the application in a row (no field control but those boxes; each row holds one
 * of them; no row the form root, outside it, or inside another row). Their password boxes never make the page an
 * account's creation (dom/pause-detect.ts reads "inside one of the rows"); accountFormOf and accountLeft read them with
 * their signatures unchanged; accountSectionOf still answers the one element of a list of one, and null for several
 * rows (no single element holds them). The scan leaves the rows out through the adapter's own `excluded`, as it does
 * the section.
 */
import type { Adapter, SignInForm } from '../adapters/types';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import { isUserVisible } from './visibility';

/** The adapter's declared create-account form, when every one of its boxes sits inside one of `rows` (a section: a
 *  list of one) and it has a password box; null otherwise (or when a hook throws). jr6 ENGINE E2 (FIXPLAN §6.2 item 6):
 *  several rows hold nothing else of the application (onlyBoxesIn). */
function declaredFormIn(adapter: Adapter, doc: Document, rows: readonly Element[]): SignInForm | null {
  const form = adapter.signInForm?.(doc, 'create-account') ?? null;
  if (form === null || form.password === null) return null;
  const boxes = boxesOf(form);
  if (!boxes.every((box) => rows.some((row) => row.contains(box)))) return null;
  return rows.length === 1 || onlyBoxesIn(rows, boxes) ? form : null;
}

// jr6 ENGINE E2 (FIXPLAN §6.2 item 6, ICIMS-04)
/** Whether each of several rows holds one of the declared form's boxes and no other field control (a hidden input, a
 *  button or words beside them are no field): rows that hold any other question of the application are no account
 *  part, and the page reads as before (its password boxes an account's creation). */
function onlyBoxesIn(rows: readonly Element[], boxes: readonly HTMLInputElement[]): boolean {
  return rows.every((row) => boxes.some((box) => row.contains(box))
    && Array.from(row.querySelectorAll(CONTROL_SELECTOR)).every((control) => boxes.includes(control as HTMLInputElement)
      || noField(control)));
}

/** Whether a native control is no field and no auth field (a hidden input, a button input). */
function noField(control: Element): boolean {
  const kind = kindOf(control);
  return !kind.field && !kind.auth;
}

/** The declared account part as checked rows (module header): its rows and its create-account form, or null where the
 *  adapter declares none, the rows are not parts of the form root (the root itself, outside it, the same row twice, a
 *  row inside another) or its form does not sit in them. A hook that throws: null. */
function accountPartOf(adapter: Adapter | null, doc: Document, root: Element | null):
  { rows: readonly Element[]; form: SignInForm } | null {
  if (adapter === null || (adapter.accountSection === undefined && adapter.accountRows === undefined)) return null;
  try {
    const formRoot = root ?? adapter.detect(doc)?.formRoot ?? null;
    if (formRoot === null) return null;
    const rows = accountRowsOf(adapter, formRoot);
    if (rows.length === 0 || new Set(rows).size !== rows.length) return null;
    if (rows.some((row) => row === formRoot || !formRoot.contains(row)
      || rows.some((other) => other !== row && other.contains(row)))) return null;
    const form = declaredFormIn(adapter, doc, rows);
    return form === null ? null : { rows, form };
  } catch {
    return null;
  }
}

/** The form root's account part as rows (module header): the section as a list of one, or its several rows; none where
 *  the form root holds none. Elements only, never what they hold. */
export function accountRowsIn(adapter: Adapter | null, doc: Document, root: Element | null): readonly Element[] {
  return accountPartOf(adapter, doc, root)?.rows ?? [];
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
 *  finds it). jr6 ENGINE E2: the one element of a list of one; null for several rows (accountRowsIn reads them). */
export function accountSectionOf(adapter: Adapter | null, doc: Document, root: Element | null): Element | null {
  const part = accountPartOf(adapter, doc, root);
  return part === null || part.rows.length !== 1 ? null : part.rows[0]!;
}

/** The account part's declared create-account form (module header), or null where the form root holds no section and
 *  no rows. */
export function accountFormOf(adapter: Adapter, doc: Document, root: Element | null): SignInForm | null {
  return accountPartOf(adapter, doc, root)?.form ?? null;
}

/** How many of the account part's required boxes a person can see are still empty (module header): Next and Submit
 *  hold while it is more than 0. 0 where the form root holds no section and no rows. */
export function accountLeft(adapter: Adapter, doc: Document, root: Element | null): number {
  const form = accountFormOf(adapter, doc, root);
  if (form === null) return 0;
  return boxesOf(form).filter((box) => (box.required || box.getAttribute('aria-required') === 'true')
    && box.value === '' && box.isConnected && isUserVisible(box)).length;
}
