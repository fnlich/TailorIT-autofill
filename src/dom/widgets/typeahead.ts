/*
 * A remote typeahead (Phase 4; docs/SPEC.md Requirement A.5; docs/design/core.md §4.11; docs/ARCHITECTURE.md
 * "Matcher"): a combobox whose options come from a server as the person types (a school search). The planner gives
 * at most four queries in typeaheadQueries' order; here they are tried one at a time, never two at once:
 * 1. each query is a guarded write (hooks.guard: the DOM guard on a fresh scan, then guardWriteInFrame with provenance
 *    profile and transform typeahead.query), typed with the text filler's setter and its input event
 *    (insertReplacementText). It is never Enter, and no change, focusout or blur follows it while results are awaited,
 *    since those close a widget's list. A widget that says it is closed (WidgetDecl.expanded) is opened first, with its
 *    one declared activation, and its first answer awaited (Greenhouse's School loads its first page then): a closed
 *    react-select shows no results, and its School search sends nothing;
 * 2. the page's answer is awaited (awaitList: the list's own busy signs cleared and one quiet window, capped at
 *    TYPEAHEAD_QUERY_CAP_MS), then the list is read whole;
 * 3. the results go to the worker, which matches them (hooks.match: the cascade, as for any list); a result is chosen
 *    only in the fill band, so an injected one (its clean part at 0.84 at most, always flagged) never is;
 * 4. the chosen result is clicked through assertNotSubmit, the list closed, and the widget's shown value read back.
 *    The text box holds our own query, so what it shows counts as the page's choice only when the page answered the
 *    click itself (the Phase 4 review, R3): it changed the box's value, marked the result aria-selected, named it as
 *    the box's aria-activedescendant, or closed its list. Without any of these the page ignored the click: the box gets
 *    back what it held and the field is needs-your-click.
 * When no query finds a result to choose, the text box gets back what it held before our first query (the text
 * filler's events), its list is closed, and the field is left blank and flagged with the last results' reason. A page
 * that does not react at all to the first query (no mutation until the cap, and its list shows what it showed before:
 * react-select filters a local list inside our input event, before any wait watches it) ignores untrusted input: the
 * search stops there, needs-your-click, and is never tried another way. Values stay in memory.
 * searchForOption searches a long list its own text box filters (searchesList: Greenhouse's phone country) the same
 * way, for an option the planner chose already on the list's whole read: one query, the option's own words
 * (optionQuery: "Canada" for "Canada +1"), a guarded write as each of a typeahead's is, and of what the list then shows
 * the one result that is that option as the page shows it (searchedOption) is clicked; no worker matches the results.
 */
import { TYPEAHEAD_MAX_QUERIES } from '../../core/confidence';
import { searchedOption } from '../../core/matcher/listSearch';
import type { ReasonCode } from '../../core/types/fill';
import { fireChange, fireInput, fireLeave, setValue } from '../fillers/events';
import { assertNotSubmit } from '../fillers/not-submit';
import { sameOptionLabel } from '../fillers/verify';
import { TYPEAHEAD_QUERY_CAP_MS } from '../thresholds';
import type { FieldTarget, WidgetOptionRead } from '../types';
import { isChosen } from './aria';
import { activateAndAwait, afterAction, awaitList, closeList, expandedState, openListOf, type WidgetContext } from './interact';
import { chosenLabels, hashOfRead, readList, revealOption, shownOptions } from './options';

/** What a search needs from the run: each query's Guard, and the worker's match of each result list. */
export interface TypeaheadHooks {
  /** Right before a query is typed: the field found again on a fresh scan and the Guard's verdict on typing it. */
  guard(query: string): Promise<{ ok: true; target: FieldTarget } | { ok: false; reason: ReasonCode; blocked: boolean }>;
  /** The worker's match of one query's results: the result to choose (only in the fill band, and already passed by the
   *  frame's Guard), or why none is chosen (`blocked`: the Guard refused the one the worker chose). `complete` is false
   *  when a cap cut the results' read short: they are matched as a partial list. */
  match(results: readonly WidgetOptionRead[], target: FieldTarget, complete: boolean):
    Promise<{ choose: { index: number; cleanLabel: string } } | { choose: null; reason: ReasonCode; blocked: boolean }>;
}

/** How a search ended. */
export interface TypeaheadResult {
  /** The result chosen: its index among the results it was one of, its clean label, and those results. */
  chosen: { index: number; cleanLabel: string; results: WidgetOptionRead[] } | null;
  /** The chosen result reads back as the widget's value. */
  verified: boolean;
  /** Why nothing was chosen, or why the choice did not read back ('ok' when it did). */
  reason: ReasonCode;
  /** A Guard refused a query or a result: the field is blocked, not merely flagged. */
  blocked: boolean;
  /** The queries typed. */
  typed: number;
}

/** Types one query into the text box: the prototype setter, then the input event a replacement of the whole value
 *  produces. */
function typeQuery(input: HTMLInputElement | HTMLTextAreaElement, query: string): void {
  setValue(input, query);
  fireInput(input, 'text');
}

/** The option-set hash of what the widget's list shows now, or null when it shows no list. */
function shownHash(widget: NonNullable<FieldTarget['widget']>): ReturnType<typeof hashOfRead> | null {
  const listbox = openListOf(widget);
  return listbox === null ? null : hashOfRead(shownOptions(listbox));
}

/** A box's text as compared: white space collapsed, any case. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether the page answered our click on a result itself: it changed the box's value from the query we typed, marked
 *  the result chosen or as the box's active descendant, or closed its list. The query we typed is never a choice. */
function pageChose(widget: NonNullable<FieldTarget['widget']>, option: Element, typed: string, closed: boolean): boolean {
  const box = widget.input;
  if (box !== null && tidy(box.value) !== tidy(typed)) return true;
  if (option.isConnected && isChosen(option)) return true;
  const id = option.id;
  if (id !== '' && [box, widget.element].some((part) => part?.getAttribute('aria-activedescendant') === id)) return true;
  return closed;
}

/** Puts back what the text box held before our first query, with the text filler's events, if it holds another text. */
function restore(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  if (input.value === text) return;
  setValue(input, text);
  fireInput(input, 'text');
  fireChange(input);
  fireLeave(input);
}

/** Searches a remote typeahead with the planner's queries (see the header). */
export async function searchTypeahead(target: FieldTarget, queries: readonly string[], ctx: WidgetContext,
  hooks: TypeaheadHooks): Promise<TypeaheadResult> {
  const input = target.widget?.input ?? null;
  let typed = 0;
  const none = (reason: ReasonCode, blocked = false): TypeaheadResult =>
    ({ chosen: null, verified: false, reason, blocked, typed });
  if (target.widget === undefined || input === null) return none('widget-unsupported');
  const before = input.value;
  let reacted = false;
  let reason: ReasonCode = 'no-match';
  let current = target;
  const giveUp = async (why: ReasonCode, blocked = false): Promise<TypeaheadResult> => {
    const widget = current.widget!;
    if (typed > 0) {
      restore(widget.input ?? input, before);
      await afterAction(widget, ctx);
    }
    await closeList(widget, ctx, { activated: false });
    return none(why, blocked);
  };

  for (const query of queries.slice(0, TYPEAHEAD_MAX_QUERIES)) {
    if (ctx.signal?.aborted) return none('internal-error');
    const guarded = await hooks.guard(query);
    if (!guarded.ok) return giveUp(guarded.reason, guarded.blocked);
    current = guarded.target;
    const widget = current.widget;
    const box = widget?.input ?? null;
    if (widget === undefined || box === null) return giveUp('element-not-found');
    // A query longer than the box takes is never cut: the next one is tried.
    if (box.maxLength >= 0 && query.length > box.maxLength) continue;
    if (expandedState(widget) === false) {
      const opened = await activateAndAwait(widget, ctx);
      if (opened.status === 'aborted') return none('internal-error');
      if (opened.status === 'gone') return giveUp('element-not-found');
      if (opened.status !== 'answered') return giveUp('needs-your-click');
    }
    const prevHash = shownHash(widget);
    typeQuery(box, query);
    typed += 1;
    const wait = await awaitList(widget, ctx, { prevHash, capMs: TYPEAHEAD_QUERY_CAP_MS });
    if (wait.status === 'aborted') return none('internal-error');
    // A page that does not react at all to a query ignores untrusted input: it is never tried another way. A list the
    // page filters at once, inside our input event, has changed before the wait watched it: that is an answer too.
    if (!wait.mutated && !reacted && shownHash(widget) === prevHash) return giveUp('needs-your-click');
    reacted = true;
    const listbox = openListOf(widget);
    if (wait.status !== 'ready' || listbox === null) continue;
    const read = await readList(listbox, { signal: ctx.signal });
    const results: WidgetOptionRead[] = read.options.map((option) => ({ label: option.label, disabled: option.disabled }));
    if (results.length === 0) continue;
    const verdict = await hooks.match(results, current, read.complete);
    if (verdict.choose === null) {
      if (verdict.blocked) return giveUp(verdict.reason, true);
      reason = verdict.reason;
      continue;
    }
    const choice = verdict.choose;
    const picked = read.options[choice.index];
    if (picked === undefined || picked.disabled || !sameOptionLabel(picked.label, choice.cleanLabel)) {
      return giveUp('options-changed');
    }
    const option = await revealOption(listbox, picked, { signal: ctx.signal });
    if (option === null) return giveUp('options-changed');
    if (!assertNotSubmit(option.el, ctx).ok) return giveUp('needs-your-click');
    const typedNow = box.value;
    (option.el as HTMLElement).click();
    await afterAction(widget, ctx);
    const closed = openListOf(widget) === null;
    if (!pageChose(widget, option.el, typedNow, closed)) return giveUp('needs-your-click');
    await closeList(widget, ctx, { activated: false });
    const shows = chosenLabels(widget, results.map((result) => result.label))
      .some((label) => sameOptionLabel(label, choice.cleanLabel));
    return { chosen: { ...choice, results }, verified: shows, reason: shows ? 'ok' : 'verify-mismatch', blocked: false,
      typed };
  }
  return giveUp(reason);
}

/** Searches a long list for the option planned on it (see the header): `query` typed through `guard`, as a typeahead's
 *  queries are, and the one result whose label reads as the planned option's `label` clicked, read back as `cleanLabel`.
 *  Nothing is chosen when no result is that option (no-match). */
export async function searchForOption(target: FieldTarget, planned: { label: string; cleanLabel: string },
  query: string, ctx: WidgetContext, guard: TypeaheadHooks['guard']): Promise<TypeaheadResult> {
  return searchTypeahead(target, [query], ctx, {
    guard,
    match: async (results) => {
      const index = searchedOption(results, planned.label);
      return index === null ? { choose: null, reason: 'no-match', blocked: false }
        : { choose: { index, cleanLabel: planned.cleanLabel } };
    },
  });
}
