/*
 * Rippling's widgets no rule of the configured layer can declare (WidgetRule has no results list), jr7 RBP-7 (RBP7-05,
 * RBP7-06; FIX7PLAN §6.12, as its verifier corrected them), read from snapshot7 rippling1 and rippling2
 * (fixtures/rippling/jr7-rippling{1,2}-apply-*) and from the behaviour of Jobright 1.25.2's Rippling filler (its class
 * Rippling in helper-app.js: the list lookup W(), the location operation and fillResolvedLocationInput), as cited facts
 * and never its code:
 * - Pebble's select controller ([data-testid="select-controller"]): the phone's country code, every custom question
 *   (rippling1: the four required Yes/No ones; rippling2: two) and the EEO questions. Its combobox is a div[role=combobox]
 *   or an input[role=combobox] (a search), aria-haspopup=listbox, and none of the 16 in the two blank forms names a list
 *   while closed (no aria-controls). Its list, once open, is found as Jobright's W() finds it: the element aria-controls
 *   names, else the element whose id is the combobox's id and "-list", else the one ul[role=listbox] a person can see in
 *   a [data-testid="popper"]; its options li[role=option] (Jobright's option rows). Declared a combobox with that list, so
 *   the widget helpers act on it whatever its trigger's ARIA says (dom/widgets/aria.ts isActionable).
 * - The Location ([data-testid="location"] input, required on both: aria-autocomplete=list, aria-haspopup=listbox, no
 *   role, no aria-controls; a [data-testid="externalPlaceId"] beside it, empty in blank and filled captures alike): a
 *   remote search over places. Jobright types the place, clicks the exact li[role=option] of the input's list, waits for
 *   the commit, and clears the box when no option matches it: a typed place alone may leave Apply disabled. Declared a
 *   remote typeahead whose results are the list aria-controls names, else the one shown popper listbox, options
 *   li[role=option]: the search's suggestion matching the profile's place is chosen and read back (dom/widgets/
 *   typeahead.ts), never a free text.
 * No capture shows either list open: whether Rippling names it by aria-controls once open, and how its options read, is
 * the owner's live check (FIX7PLAN §9 Q7-1).
 */
import { isUserVisible } from '../../dom/visibility';
import type { WidgetDecl } from '../types';

/** The captures these declarations were read from. */
export const RIPPLING_WIDGETS_CAPTURE = 'jr7-rippling1-apply-blank, jr7-rippling2-apply-blank';

/** Pebble's select controller around a select combobox (module header). */
const SELECT_CONTROLLER = '[data-testid="select-controller"]';
/** The Location's field (module header). */
const LOCATION = '[data-testid="location"]';
/** An open list drawn in Rippling's popper (Jobright's W(), its last lookup). */
const POPPER_LIST = '[data-testid="popper"] ul[role="listbox"]';
/** One option of a list (Jobright's W() and its option rows). */
const OPTION = 'li[role="option"]';

/** The element `el`'s aria-controls names first, in its own document; null where it names none there. */
function controlled(el: Element): Element | null {
  for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
    if (id === '') continue;
    const found = el.ownerDocument.getElementById(id);
    if (found !== null) return found;
  }
  return null;
}

/** The one list a person can see in a popper, or null where none or several show. */
function shownPopperList(doc: Document): Element | null {
  const shown = Array.from(doc.querySelectorAll(POPPER_LIST)).filter((list) => isUserVisible(list));
  return shown.length === 1 ? shown[0]! : null;
}

/** A select combobox's list now (module header): aria-controls, else its id and "-list", else the one shown popper list. */
function selectList(combobox: Element): Element | null {
  const doc = combobox.ownerDocument;
  return controlled(combobox) ?? (combobox.id === '' ? null : doc.getElementById(`${combobox.id}-list`))
    ?? shownPopperList(doc);
}

/** Rippling's declared widgets (module header), or null for any other control. */
export function ripplingWidgetFor(control: Element): WidgetDecl | null {
  // fixtures/rippling/jr7-rippling1-apply-blank.html: <div data-testid="select-controller">…<div id="field-56"
  // role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-label="Select"
  // aria-required="true">, and the phone's code <div data-testid="select-search-input"><input id="field-27"
  // role="combobox" aria-label="Search" aria-haspopup="listbox" aria-expanded="false">.
  if (control.matches('[role="combobox"]') && control.closest(SELECT_CONTROLLER) !== null) {
    return { kind: 'combobox', opener: control as HTMLElement, expanded: control, snapshot: RIPPLING_WIDGETS_CAPTURE,
      results: { list: () => selectList(control), option: OPTION } };
  }
  // fixtures/rippling/jr7-rippling1-apply-blank.html: <div data-testid="location">…<input id="field-35"
  // aria-required="true" autocomplete="off" aria-labelledby="field-35-label" aria-autocomplete="list"
  // aria-haspopup="listbox">.
  if (control.localName === 'input' && control.closest(LOCATION) !== null) {
    return { kind: 'typeahead-remote', opener: control as HTMLElement, snapshot: RIPPLING_WIDGETS_CAPTURE,
      results: { list: () => controlled(control) ?? shownPopperList(control.ownerDocument), option: OPTION } };
  }
  return null;
}
