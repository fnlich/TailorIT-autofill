/*
 * jr7 ENGINE-7 E1 item 1 (UKGR-6): the native selects the last scan of their document found drawn by the box their
 * adapter declares around them (dom/scan.ts selectInDeclaredBox: UKG Ready's selects at opacity 0 over their
 * c-form-control box, snapshot7 secure7.saashr). A person sees such a select's options in the browser's own list when it
 * opens, so its options are read (dom/visible-text.ts readSelectOptions) as a shown select's are. Each scan sets a
 * select's mark afresh, before it judges it, so a select whose box went out of sight, or that shows by itself, holds no
 * mark from an earlier scan. Elements only: nothing is read from them here.
 */

const shown = new WeakSet<Element>();

/** Sets whether the scan found `select` drawn by its adapter's declared box. */
export function markShownByBox(select: Element, on: boolean): void {
  if (on) shown.add(select);
  else shown.delete(select);
}

/** Whether the last scan of its document found `select` drawn by its adapter's declared box. */
export function shownByBox(select: Element): boolean {
  return shown.has(select);
}
