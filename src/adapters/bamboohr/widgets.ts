/*
 * BambooHR's Fabric dropdown list, which no rule of the configured layer can declare (WidgetRule has no results list),
 * jr7 RBP-7 (RBP7-14; FIX7PLAN §6.12, as its verifier found it), read from snapshot7 bamboohr1's filled capture, where
 * State's menu is open (fixtures/bamboohr/jr7-bamboohr1-form-filled), and from the behaviour of Jobright 1.25.2's BambooHR
 * filler (its getSelectOptionList and fillCustomSelectField in helper-app.js: the toggle clicked, the menu found by
 * document.getElementById of the toggle's data-menu-id, its .fab-MenuOption rows), as cited facts and never its code.
 * The toggle (button.fab-SelectToggle, aria-haspopup="true") names its menu by data-menu-id, and by aria-controls only
 * while open; the menu (div[role=menu].fab-MenuList, at the end of the body) holds its options as div[role=menuitem]
 * .fab-MenuOption rows (60 on State's). The rule-built declaration (config.ts's widget rule: the combobox, its toggle,
 * its hidden native select) gets that list: the element the toggle's data-menu-id names, else the one its aria-controls
 * names; its options [role=menuitem] or .fab-MenuOption. The legacy div[data-fabric-component="Menu"][data-helium-id]
 * Jobright also knows is in no capture, so it is not read.
 */
import type { WidgetDecl } from '../types';

/** The capture the list was read from (State's menu open). */
export const BAMBOOHR_MENU_CAPTURE = 'jr7-bamboohr1-form-filled';

/** One option of a Fabric menu (module header). */
const MENU_OPTION = '[role="menuitem"], .fab-MenuOption';

/** The menu a Fabric toggle names now (module header): by its data-menu-id, else its aria-controls; null while neither
 *  is in its document. */
function menuOf(toggle: Element): Element | null {
  const doc = toggle.ownerDocument;
  const ids = [toggle.getAttribute('data-menu-id') ?? '',
    ...(toggle.getAttribute('aria-controls') ?? '').split(/\s+/)].filter((id) => id !== '');
  for (const id of ids) {
    const found = doc.getElementById(id);
    if (found !== null) return found;
  }
  return null;
}

/** The rule-built declaration of a Fabric dropdown with its menu as its results list (module header); any other
 *  declaration (none today) as it was. */
export function withFabricMenu(decl: WidgetDecl | null): WidgetDecl | null {
  if (decl === null || decl.kind !== 'combobox' || !decl.opener.matches('button[data-menu-id]')) return decl;
  const toggle = decl.opener;
  // fixtures/bamboohr/jr7-bamboohr1-form-filled.html: <button data-menu-id="fab-menu55" aria-expanded="true"
  // aria-haspopup="true" aria-controls="fab-menu55" class="fab-SelectToggle …"> and, at the body's end, <div
  // id="fab-menu55" role="menu" class="fab-MenuList">…<div class="fab-MenuOption …" role="menuitem">.
  return { ...decl, snapshot: `${decl.snapshot}; ${BAMBOOHR_MENU_CAPTURE}`,
    results: { list: () => menuOf(toggle), option: MENU_OPTION } };
}
