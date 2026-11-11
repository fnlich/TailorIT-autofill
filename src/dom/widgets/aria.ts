/*
 * ARIA widgets, by standard ARIA only (docs/design/runtime.md §5.6; WAI-ARIA 1.2 and its Authoring Practices): what a
 * widget is and where its parts are. Nothing here dispatches an event or changes the page; it reads roles, states and
 * id references. No class name and no platform's markup is ever read: a platform's own widget comes from its adapter
 * (widgetFor), written from a snapshot.
 * - A combobox: any element with role="combobox" (an input, as ARIA 1.2 draws it, or an element wrapping one, as ARIA
 *   1.1 did). Its list is the element its aria-controls names, else its aria-owns, a role="listbox" there or inside
 *   it, else a listbox inside the combobox. A list with aria-multiselectable="true" makes it a multiselect (a chips
 *   multiselect included); one that is not in the page until it opens is told apart when it is first opened.
 * - A listbox of its own (role="listbox", aria-multiselectable="true", no combobox's list): a multiselect.
 * - A radio group: role="radiogroup" whose options are role="radio" elements (buttons or others), with aria-checked;
 *   a radiogroup of native radios is the native scanner's.
 * - A Yes/No group of toggle buttons: a fieldset or role="group" holding two or more buttons, every one of them
 *   showing its state with aria-pressed, and no native field control.
 * A widget is a field only when its element is one of these; a native control inside a widget's list or inside an
 * ARIA 1.1 combobox is part of that widget, never a field of its own.
 * v4 (drop): a search whose results no ARIA names (Lever's location search) is acted on through the results list its
 * adapter declares from a capture (WidgetDecl.results: the list, the selector of one result): widgetListOf gives that
 * list where ARIA gives none, optionElementsOf its results, and isActionable accepts it. s2 wd (snapshot round 2): the
 * list may be the adapter's hook, asked each time (Workday's prompts draw theirs at the end of the body only while
 * open), and a result its adapter names as only opening a list of its own (a category) is one that cannot be chosen
 * (isUnchoosableResult).
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1 to 4 and 12):
 * - a declared list's rows are its selector's matches, or the rows its adapter's hook lists where no selector reaches
 *   them (WidgetResults.options: a slot's assigned elements); a choice presses the element its adapter names
 *   (WidgetResults.pressTarget), else the row's label part ('label'), else the row (pressTargetOf);
 * - a combobox or multiselect its adapter declares with a results list is acted on whatever ARIA its trigger carries
 *   (ADP's sdf-select-simple: a div[role=button] in a shadow root, no aria-controls; its list a portal at the end of
 *   the body);
 * - a combobox no adapter declares is refused before any click (widget-unsupported, never read as a remote search)
 *   where ARIA says its popup is a grid or a tree (Oracle's cx-select, aria-haspopup="grid"), or where ARIA can find no
 *   list for it at all and it holds no text box (iCIMS's a.dropdown-select anchors): refusedUndeclared.
 */
import { holdsComposed } from '../composed';
import { CONTROL_SELECTOR, isTextLike } from '../kinds';
import { WIDGET_SEARCH_MIN_OPTIONS } from '../thresholds';
import type { DeclaredRows, FieldTarget, WidgetKind, WidgetTarget } from '../types';

/** The roles a widget's element can carry, and the containers a toggle-button group can be. */
export const WIDGET_ROOT_SELECTOR = '[role], fieldset';

/** The first token of an element's role attribute, lower case; '' for none. */
export function roleOf(el: Element): string {
  return (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
}

function isTrue(el: Element, attribute: string): boolean {
  return (el.getAttribute(attribute) ?? '').trim().toLowerCase() === 'true';
}

/** The elements an id-reference attribute names, in the element's own tree, in order. */
function idTargets(el: Element, attribute: 'aria-controls' | 'aria-owns'): Element[] {
  const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.getElementById !== 'function') return [];
  return ids.map((id) => root.getElementById(id)).filter((found): found is HTMLElement => found !== null);
}

/** Whether a combobox names its list by ARIA: aria-controls or aria-owns, on it or on its text box. */
export function referencesList(el: Element, input: Element | null): boolean {
  return [el, input].some((part) => part !== null && (part.hasAttribute('aria-controls') || part.hasAttribute('aria-owns')));
}

/** A combobox's list now: the listbox its aria-controls (else aria-owns) names, on it or on its text box, or one
 *  inside the element named; else a listbox inside the combobox itself. Null while the page shows none. */
export function listOf(el: Element, input: Element | null = editableOf(el)): Element | null {
  if (roleOf(el) === 'listbox') return el;
  for (const part of [el, input]) {
    if (part === null) continue;
    for (const attribute of ['aria-controls', 'aria-owns'] as const) {
      for (const target of idTargets(part, attribute)) {
        if (roleOf(target) === 'listbox') return target;
        const inner = target.querySelector('[role~="listbox" i]');
        if (inner !== null) return inner;
      }
    }
  }
  return el.querySelector('[role~="listbox" i]');
}

/** The text box of a combobox: the combobox itself when it is a text input or textarea, else the first one inside it
 *  (ARIA 1.1); null for a select-only combobox. */
export function editableOf(el: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (isTextLike(el)) return el;
  for (const inner of Array.from(el.querySelectorAll('input, textarea'))) {
    if (isTextLike(inner)) return inner;
  }
  return null;
}

/** Whether typing into a combobox filters what it suggests: its text box (or it) says aria-autocomplete list or
 *  both. Such a combobox whose list shows nothing until something is typed is a remote search. */
export function filtersAsTyped(el: Element, input: Element | null): boolean {
  return [input, el].some((part) => part !== null
    && ['list', 'both'].includes((part.getAttribute('aria-autocomplete') ?? '').trim().toLowerCase()));
}

/** The option elements of a listbox: its role="option" descendants that belong to it, not to a list inside it; or,
 *  for a results list its adapter declared (v4: WidgetDecl.results), the elements inside it that the declared selector
 *  names. jr6 ENGINE E1 (FIXPLAN §6.2 item 3): or the rows the adapter's hook lists for it (WidgetResults.options: the
 *  options a slot of the list shows, which no selector run on the list reaches), in place of the selector's matches;
 *  a hook that fails lists none. */
export function optionElementsOf(listbox: Element, declared?: string | DeclaredRows): Element[] {
  if (declared === undefined) {
    return Array.from(listbox.querySelectorAll('[role~="option" i]'))
      .filter((option) => option.parentElement?.closest('[role~="listbox" i]') === listbox);
  }
  if (typeof declared === 'string') return Array.from(listbox.querySelectorAll(declared));
  if (declared.options === undefined) return Array.from(listbox.querySelectorAll(declared.option));
  try {
    const rows = declared.options(listbox);
    return [...new Set(Array.from(rows ?? []))].filter((row) => row?.nodeType === 1);
  } catch {
    return [];
  }
}

/**
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1 and 3): the element a choice of `option` presses: the one its adapter names
 * (WidgetResults.pressTarget: SmartRecruiters' spl-select-option chooses on a click of its inner .c-spl-dropdown-item,
 * inside its shadow trees, as Jobright's ~contents/sites/smartrecruiters operations fillSelectField presses it), where it
 * sits inside the row (across shadow roots); else, s2 wd, its label part where its adapter declares a click there
 * (results.choose 'label': Workday's promptOption inside the row's promptLeafNode, Oracle's
 * .cx-select__list-item--content, as Jobright's ~contents/sites/oraclecloud operations fillSelectField clicks it); else
 * the row itself. A hook that fails, or names an element outside the row, presses the row.
 */
export function pressTargetOf(widget: Pick<WidgetTarget, 'results' | 'optionLabel'>, option: Element): Element {
  const declared = widget.results?.pressTarget;
  if (declared !== undefined) {
    let target: Element | null = null;
    try {
      target = declared(option);
    } catch {
      target = null;
    }
    return target !== null && target !== undefined && holdsComposed(option, target) ? target : option;
  }
  if (widget.results?.choose !== 'label') return option;
  const part = widget.optionLabel?.(option) ?? null;
  return part !== null && part !== option && option.contains(part) ? part : option;
}

/** jr6 ENGINE E1: whether a widget is select-only as a person meets it, so its opener toggles its list: it has no text
 *  box of its own inside it (none, or the one its adapter declares beside it: iCIMS's search box, in a container drawn
 *  next to its anchor, WidgetDecl.input). */
export function selectOnly(widget: Pick<WidgetTarget, 'element' | 'input'>): boolean {
  return widget.input === null || !holdsComposed(widget.element, widget.input);
}

/** A widget's list now (v4, drop): the results list its adapter declared (WidgetDecl.results), while it is in the page,
 *  else the list standard ARIA names (listOf). s2 wd: a declared list the page draws only while open is found anew by its
 *  adapter's hook (Workday's prompts), each time it is asked for; a hook that fails finds none. */
export function widgetListOf(widget: Pick<WidgetTarget, 'element' | 'input' | 'results'>): Element | null {
  const declared = declaredListOf(widget);
  if (declared !== null && declared.isConnected) return declared;
  return listOf(widget.element, widget.input);
}

/** s2 wd: the results list its adapter declares for a widget now: the element, or what its hook finds; null for none. */
function declaredListOf(widget: Pick<WidgetTarget, 'results'>): Element | null {
  const list = widget.results?.list;
  if (list === undefined) return null;
  if (typeof list !== 'function') return list;
  try {
    return list();
  } catch {
    return null;
  }
}

/** s2 wd: whether a result its adapter declares cannot be chosen, since it only opens a list of its own
 *  (WidgetDecl.results.unchoosable: Workday's category rows); false for any other, or a selector the page rejects. */
export function isUnchoosableResult(option: Element, unchoosable: string | undefined): boolean {
  if (unchoosable === undefined) return false;
  try {
    return option.matches(unchoosable);
  } catch {
    return false;
  }
}

/** The selector of a widget's results, where its adapter declared its list (v4, drop): none for an ARIA list. */
export function declaredOption(widget: Pick<WidgetTarget, 'results'>): string | undefined {
  return widget.results?.option;
}

/** An option, radio or toggle button that is chosen now: aria-selected, aria-checked or aria-pressed "true". */
export function isChosen(el: Element): boolean {
  return isTrue(el, 'aria-selected') || isTrue(el, 'aria-checked') || isTrue(el, 'aria-pressed');
}

/** An option or member that cannot be chosen: aria-disabled="true", or a disabled button. */
export function isUnavailable(el: Element): boolean {
  if (isTrue(el, 'aria-disabled')) return true;
  return el.localName === 'button' && (el as HTMLButtonElement).disabled;
}

/** Whether a listbox takes several options. */
export function isMultiselectable(listbox: Element | null): boolean {
  return listbox !== null && isTrue(listbox, 'aria-multiselectable');
}

/** The members of a radio group or a toggle-button group, in document order. */
export function membersOf(group: Element): HTMLElement[] {
  if (roleOf(group) === 'radiogroup') {
    return Array.from(group.querySelectorAll<HTMLElement>('[role~="radio" i]'))
      .filter((member) => member.localName !== 'input');
  }
  return Array.from(group.querySelectorAll<HTMLElement>('button, [role~="button" i]'));
}

/** Whether an element holds a native control the scanner makes a field of. */
function holdsNativeField(el: Element): boolean {
  return Array.from(el.querySelectorAll(CONTROL_SELECTOR)).some((control) =>
    control.localName !== 'input' || !['hidden', 'submit', 'button', 'reset', 'image'].includes((control as HTMLInputElement).type));
}

/**
 * The kind of ARIA widget `el` is (see the header), or null when it is none. A combobox inside another, a listbox that
 * is a combobox's list (`lists`: every combobox's list in the scan), a radiogroup of native radios and a group whose
 * buttons do not all show aria-pressed are none.
 */
export function ariaWidgetKind(el: Element, lists: ReadonlySet<Element> = new Set()): WidgetKind | null {
  const role = roleOf(el);
  if (el.localName === 'select' || el.localName === 'textarea' || el.localName === 'option') return null;
  if (role === 'combobox') {
    if (el.localName === 'input' && !isTextLike(el)) return null;
    if (el.parentElement?.closest('[role~="combobox" i]') != null) return null;
    return isMultiselectable(listOf(el)) ? 'multiselect' : 'combobox';
  }
  if (role === 'listbox') {
    if (lists.has(el) || el.closest('[role~="combobox" i]') !== null) return null;
    return isMultiselectable(el) ? 'multiselect' : null;
  }
  if (role === 'radiogroup') {
    if (el.querySelector('input[type="radio" i]') !== null) return null;
    return membersOf(el).length >= 2 ? 'radio' : null;
  }
  if (role === 'group' || (el.localName === 'fieldset' && (role === '' || role === 'group'))) {
    if (holdsNativeField(el)) return null;
    const buttons = membersOf(el);
    if (buttons.length < 2 || !buttons.every((button) => button.hasAttribute('aria-pressed'))) return null;
    // A group inside another group of the same buttons is that group's part.
    const outer = el.parentElement?.closest('fieldset, [role~="group" i], [role~="radiogroup" i]') ?? null;
    if (outer !== null && membersOf(outer).length === buttons.length) return null;
    return 'radio';
  }
  return null;
}

/**
 * A widget's own box: the outermost ancestor of its element (inside the form) that holds no other field, native or
 * ARIA, besides its own text box and list. Its chips and busy signs are looked for there; the element itself when even
 * its parent holds another field.
 */
export function widgetBox(el: Element, input: Element | null, list: Element | null): Element {
  let box = el;
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'body' || at.localName === 'html' || at.localName === 'form') break;
    const others = Array.from(at.querySelectorAll(`${CONTROL_SELECTOR}, [role~="combobox" i], [role~="listbox" i], `
      + '[role~="radiogroup" i]')).some((other) => other !== el && other !== input && other !== list
      && !el.contains(other) && !(list?.contains(other) ?? false) && isFieldLike(other));
    if (others) break;
    box = at;
  }
  return box;
}

/** A native control that can be a field (not a hidden, button or submit input), or an ARIA widget's element. */
function isFieldLike(el: Element): boolean {
  if (el.localName === 'input') return !['hidden', 'submit', 'button', 'reset', 'image'].includes((el as HTMLInputElement).type);
  return true;
}

/** Whether a native control is part of a widget: inside a list or an option, or the text box of an ARIA 1.1
 *  combobox (one inside an element with role="combobox"). */
export function isWidgetPart(control: Element): boolean {
  if (control.closest('[role~="listbox" i], [role~="option" i]') !== null) return true;
  return control.parentElement?.closest('[role~="combobox" i]') != null;
}

/** Whether standard ARIA tells where a widget's list is, or its members' state: the helpers act on nothing else. */
export function isActionable(widget: WidgetTarget): boolean {
  if (widget.kind === 'checkbox') return false;
  if (widget.kind === 'radio') return widget.members.length > 0;
  // v4 (drop): a search whose results list its adapter declared from a capture (WidgetDecl.results), with a text box
  // (jr6 ENGINE E1, FIXPLAN §6.2 item 2: its own, or the one its adapter declares beside it, WidgetDecl.input).
  if (widget.declared && widget.kind === 'typeahead-remote' && widget.input !== null && widget.results !== undefined) {
    return true;
  }
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 4: ADP-2, ADP-3): a combobox or multiselect its adapter declares with a results list
  // is acted on through that list, whatever its trigger says: ADP's sdf-select-simple opens on a div[role=button] in its
  // shadow root that names no list, and draws its list as a portal at the end of the body (Jobright's
  // ~contents/sites/adp-workforcenow operations: the newest [role=listbox] a person can see after the press).
  if (widget.declared && (widget.kind === 'combobox' || widget.kind === 'multiselect') && widget.results !== undefined) {
    return true;
  }
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 12): refused before any click.
  if (!widget.declared && refusedUndeclared(widget)) return false;
  const roles = [roleOf(widget.element), widget.input === null ? '' : roleOf(widget.input)];
  return roles.includes('combobox') || roles.includes('listbox') || referencesList(widget.element, widget.input)
    || opensListbox(widget);
}

/** ARIA's popup types whose items are no options (WAI-ARIA 1.2 combobox: aria-haspopup grid or tree): a list of rows
 *  or tree items no reader here reads. A dialog may hold a listbox (listOf finds it), so it is not one of them. */
const NO_OPTION_POPUPS: ReadonlySet<string> = new Set(['grid', 'tree']);

/**
 * jr6 ENGINE E1 (FIXPLAN §6.2 item 12: icims-new-2, O10): whether a combobox no adapter declares is one the helpers
 * refuse before any click, so it is widget-unsupported and never read as a remote search:
 * - its text box (or it) says its popup is a grid or a tree (Oracle's cx-select, input[role=combobox]
 *   [aria-haspopup="grid"][aria-controls="<id>-listbox"] whose rows are role=row > gridcell, fixtures/oracle/
 *   hjf-apply-section.html): the rows are no options, and its filtering box (aria-autocomplete="list") would otherwise
 *   be typed into, up to six times, with nothing ever read (O10);
 * - ARIA can find no list for it at all (no aria-controls or aria-owns on it or its text box, no listbox it is or holds,
 *   no aria-haspopup="listbox" that names one once open as Workday's buttons do) and it holds no text box (iCIMS's
 *   a.dropdown-select[role=combobox] anchors, whose list is named only by the search box of a container drawn beside
 *   them, fixtures/icims/githubinc-profile.frame-1.html): a click opens what no reader finds.
 * A radio group, a listbox of its own and any widget its adapter declares are never refused here.
 */
export function refusedUndeclared(widget: Pick<WidgetTarget, 'kind' | 'element' | 'input'>): boolean {
  if (widget.kind === 'radio' || widget.kind === 'checkbox') return false;
  const popup = (part: Element | null) => (part?.getAttribute('aria-haspopup') ?? '').trim().toLowerCase();
  if ([widget.input, widget.element].some((part) => part !== null && NO_OPTION_POPUPS.has(popup(part)))) return true;
  if (widget.input !== null) return false;
  if (referencesList(widget.element, null) || popup(widget.element) === 'listbox') return false;
  return listOf(widget.element, null) === null;
}

/** Whether a combobox's list is searched rather than chosen from whole (dom/widgets' header): its adapter declared it,
 *  ARIA says where its list is, its text box filters the list as typed (aria-autocomplete list or both), and its list
 *  is long (WIDGET_SEARCH_MIN_OPTIONS options or more) or was read only in part. A search's planned option is found by
 *  its words (searchForOption), and a value no option of the read is, by its candidate answers (v4: the planner's
 *  query write, content/pass.ts searchField). */
export function searchesList(target: FieldTarget): boolean {
  const { widget, field } = target;
  if (widget === undefined || !widget.declared || widget.kind !== 'combobox' || widget.input === null) return false;
  if (!isActionable(widget) || !filtersAsTyped(widget.element, widget.input) || field.options === 'lazy') return false;
  return field.options.length >= WIDGET_SEARCH_MIN_OPTIONS || field.optionsPartial === true;
}

/** A select-only combobox its adapter declares on a button that says it pops up a listbox (aria-haspopup="listbox"),
 *  which names its list by aria-controls only once it is open: Workday's dropdowns (the owner's snapshots of
 *  2026-11-06, "[resolvetech.wd1.myworkdayjobs.com] Devops Engineer (3)": <button aria-haspopup="listbox"
 *  aria-expanded="true" aria-controls="..."> while open, neither attribute while closed). Its list is still found by
 *  ARIA alone once it shows (listOf); one that never names it is 'no-list', so widget-unsupported, as any other. */
function opensListbox(widget: WidgetTarget): boolean {
  const opener = widget.opener;
  return widget.declared && widget.kind === 'combobox' && opener !== null && opener === widget.element
    && opener.localName === 'button' && (opener.getAttribute('aria-haspopup') ?? '').trim().toLowerCase() === 'listbox';
}
