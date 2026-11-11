/*
 * A remote typeahead (Phase 4; docs/SPEC.md Requirement A.5; docs/design/core.md §4.11; docs/ARCHITECTURE.md
 * "Matcher"): a combobox whose options come from a server as the person types (a school search). The planner gives
 * its candidate answers (v4: core/matcher/candidates.ts, at most MAX_SEARCH_QUERIES, six); here they are tried one at a
 * time, never two at once, and no further one once the field's search has run SEARCH_FIELD_BUDGET_MS (checked before
 * each query after the first). The same search types a long list's candidates where the planner found no option of
 * its read to be the value (v4: content/pass.ts searchField, a combobox's query write). A search whose results no ARIA
 * names is acted on through the results list its adapter declared (WidgetDecl.results: Lever's location search), and
 * one that starts on a keydown gets its declared key after each query (WidgetDecl.queryKey) once the page has answered
 * typed text itself (a static page that ignores the input event gets none), its result chosen by the declared event
 * (results.choose: Lever's mousedown) instead of click(). s2 wd (snapshot round 2): Workday's prompts search on Enter
 * (queryKey 'Enter', their box's enterkeyhint="search"), answer typed text in the microtasks after the input event
 * (React: typeWatched waits for those, no timer), draw their results only while open (results.list the adapter's hook),
 * are chosen by a click on a result's label part (results.choose 'label'), and a result that only opens a list of its
 * own (a category) is read as one that cannot be chosen (results.unchoosable), so it never is:
 * 1. each query is a guarded write (hooks.guard: the DOM guard on a fresh scan, then guardWriteInFrame with provenance
 *    profile and transform typeahead.query), typed with the text filler's setter and its input event
 *    (insertReplacementText). No Enter follows it but a declared query key (s2 wd), and no change, focusout or blur
 *    follows it while results are awaited,
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
 *    the box's aria-activedescendant (on a widget its adapter says highlights its first result before anything is
 *    chosen, WidgetDecl.highlightIsNoChoice: Ashby's first result says aria-selected="true" as its list opens, a mark
 *    the result carried before the click is no answer), or closed its list. Without any of these the page ignored the
 *    click: the box gets back what it held and the field is needs-your-click. A search its adapter says answers
 *    "nothing" sooner than its cap (WidgetDecl.emptyAfterMs) is read as empty after that long quiet with no option. React first (docs/SPEC-AMENDMENTS.md §12): a widget its
 *    adapter declares for the page-world bridge has the chosen result, listed now, chosen by its own React code
 *    (interact.ts's bridgeChoose, the result's clean label as the frame read it), once per write: not when this write
 *    had its command already (ctx.bridgeTried: a long list's search after content/pass.ts tried it). The bridge's word
 *    is never taken. What the widget shows counts only once the page answered the choice itself, as a click's (the box
 *    no longer holds our query, or its list closed: R3); it is read back with one more bounded wait when it does not
 *    show yet. Shown: verified. Anything the frame can see changed but the result not shown (the page answered,
 *    or the widget shows another answer than before): chosen, not verified (verify-mismatch), and no click follows.
 *    Nothing changed (a forged answer): the click follows as before, the run's bridge goes off, and when the bridge had
 *    said it chose, that click's path never ends as "nothing chosen": written, not verified.
 * A widget whose page marks the rest of the form aria-hidden while its list is open (WidgetTarget.hidesFormWhileOpen:
 * Ashby's floating-ui lists) has its list closed before each later query's guard, whose fresh scan would otherwise
 * find no field but this one, labelled by its placeholder.
 * When no query finds a result to choose, the text box gets back what it held before our first query (the text
 * filler's events), its list is closed, and the field is left blank and flagged with the last results' reason (v4
 * review, finding 11: a declared results list whose page empties the box on a blur while it shows, Lever's, gets back
 * a text it held without the blur, and its list stays open: keepsListOpen). So it is
 * when the person's Skip ends a wait before anything was chosen (v3 Phase 3: interact.ts's skipTidyContext): the text
 * put back and the list closed on a fresh, short-capped signal; a result already clicked stands, its list closed the
 * same way. A page
 * that does not react at all to the first query (no mutation until the cap, and its list shows what it showed before:
 * react-select filters a local list inside our input event, before any wait watches it) ignores untrusted input: the
 * search stops there, needs-your-click, and is never tried another way. Values stay in memory.
 * searchForOption searches a long list its own text box filters (searchesList: Greenhouse's phone country) the same
 * way, for an option the planner chose already on the list's whole read: one query, the option's own words
 * (optionQuery: "Canada" for "Canada +1"), a guarded write as each of a typeahead's is, and of what the list then shows
 * the one result that is that option as the page shows it (searchedOption) is clicked; no worker matches the results.
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1, 2 and 3):
 * - a widget's text box may be one its adapter declares beside it (WidgetDecl.input: iCIMS's dropdown, whose anchor
 *   opens a container drawn next to it, whose search box takes the query, as Jobright's ~contents/sites/icims
 *   client-search-widget openIcimsSearchDropdown opens it and types into input.dropdown-search): the widget is opened
 *   first while that box is not shown, and the query is typed only into a box a person can see, enabled and writable;
 * - a query shorter than the widget's declared minimum (WidgetDecl.minQueryLength: SmartRecruiters' minquerylength) is
 *   never typed;
 * - a declared list's rows are read and pressed as its adapter declares them (WidgetResults.options, pressTarget).
 */
import { searchedOption } from '../../core/matcher/listSearch';
import { MAX_SEARCH_QUERIES } from '../../core/matcher/searchLimits';
import type { ReasonCode } from '../../core/types/fill';
import { fireChange, fireInput, fireLeave, setValue, windowOf } from '../fillers/events';
import { isDisabled, isReadOnly } from '../kinds';
import { sameOptionLabel } from '../fillers/verify';
import { SEARCH_FIELD_BUDGET_MS, TYPEAHEAD_QUERY_CAP_MS } from '../thresholds';
import { monotonicNow } from '../time';
import type { FieldTarget, WidgetOptionRead } from '../types';
import { isUserVisible } from '../visibility';
import { isChosen, selectOnly } from './aria';
import { cleanOptionLabel } from '../option-hash';
import {
  activateAndAwait, afterAction, afterBridge, awaitList, bridgeChoose, chooseResult, closeList, closingContext,
  expandedState, openListOf, pressAllowed, pressQueryKey, skipTidyContext, type WidgetContext,
} from './interact';
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
  return listbox === null ? null : hashOfRead(shownOptions(listbox, undefined, widget.optionLabel, widget.results,
    widget.results?.unchoosable));
}

/** jr6 ENGINE E1 (FIXPLAN §6.2 item 2): whether a widget's text box is one its adapter declares beside it, outside its
 *  element (WidgetDecl.input: iCIMS's search box): typed into only once a person can see it. */
function boxBeside(widget: NonNullable<FieldTarget['widget']>): boolean {
  return widget.input !== null && selectOnly(widget);
}

/** jr6 ENGINE E1: whether a box beside its widget may take a query now: shown, enabled and writable. */
function boxTakes(box: HTMLInputElement | HTMLTextAreaElement): boolean {
  return box.isConnected && isUserVisible(box) && !isDisabled(box) && !isReadOnly(box);
}

/** Types one query (typeQuery) into a widget that declares a key to start its search (WidgetDecl.queryKey), and
 *  answers whether the page answered the typed text itself, at once: a change inside the form root while our input
 *  event ran (Lever shows its results' container in its own input listener), or (s2 wd) in the microtasks that event
 *  queued (React draws a controlled box's answer in a microtask after the event: Workday's prompts). A page whose
 *  script does not run there (a static snapshot) answers nothing, and gets no key (v4, drop). */
async function typeWatched(box: HTMLInputElement | HTMLTextAreaElement, query: string, root: Element): Promise<boolean> {
  const view = windowOf(root);
  const observer = new view.MutationObserver(() => undefined);
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  try {
    typeQuery(box, query);
    if (observer.takeRecords().length > 0) return true;
    // s2 wd: the microtasks our input event queued run before this one; no timer, no wait beyond them.
    await Promise.resolve();
    return observer.takeRecords().length > 0;
  } finally {
    observer.disconnect();
  }
}

/** A box's text as compared: white space collapsed, any case. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether a result is marked chosen now, or named as the box's active descendant: a page's highlight (Ashby's first
 *  result says aria-selected="true" before anything is chosen). */
function marked(widget: NonNullable<FieldTarget['widget']>, option: Element): boolean {
  if (option.isConnected && isChosen(option)) return true;
  const id = option.id;
  return id !== '' && [widget.input, widget.element].some((part) => part?.getAttribute('aria-activedescendant') === id);
}

/** Whether the page answered our click on a result itself: it changed the box's value from the query we typed, marked
 *  the result chosen or as the box's active descendant, or closed its list. On a widget whose list marks its first
 *  result before anything is chosen (WidgetTarget.highlightIsNoChoice: Ashby's), a mark the result carried before the
 *  click is that highlight, no answer. The query we typed is never a choice. */
function pageChose(widget: NonNullable<FieldTarget['widget']>, option: Element, typed: string, closed: boolean,
  markedBefore: boolean): boolean {
  const box = widget.input;
  if (box !== null && tidy(box.value) !== tidy(typed)) return true;
  if ((widget.highlightIsNoChoice !== true || !markedBefore) && marked(widget, option)) return true;
  return closed;
}

/** Whether two readings of what a widget shows chosen are the same labels, in the same order. */
const sameLabels = (a: readonly string[], b: readonly string[]) => a.length === b.length
  && a.every((label, at) => label === b[at]);

/** Puts back what the text box held before our first query, with the text filler's events, if it holds another text.
 *  `leave` false: no focusout or blur follows (keepsListOpen). */
function restore(input: HTMLInputElement | HTMLTextAreaElement, text: string, leave = true): void {
  if (input.value === text) return;
  setValue(input, text);
  fireInput(input, 'text');
  fireChange(input);
  if (leave) fireLeave(input);
}

/** v4 review (finding 11): whether a search that gives up puts back the text its box held without leaving the box, and
 *  leaves its list open: a widget whose results list its adapter declared (WidgetDecl.results: Lever's location search,
 *  whose own script empties the box, and the hidden record of its place, on a blur while its list shows, and closes
 *  that list on nothing else but a chosen result; adapters/lever) that held a text before our first query. Leaving the
 *  box, closeList's way, would empty what the person had. An empty box loses nothing to it: its list is closed. */
function keepsListOpen(widget: NonNullable<FieldTarget['widget']>, before: string): boolean {
  return widget.results !== undefined && before !== '';
}

/** Searches a remote typeahead with the planner's queries (see the header); `budgetMs` is the time after which no
 *  further query is typed (SEARCH_FIELD_BUDGET_MS). */
export async function searchTypeahead(target: FieldTarget, queries: readonly string[], ctx: WidgetContext,
  hooks: TypeaheadHooks, budgetMs: number = SEARCH_FIELD_BUDGET_MS): Promise<TypeaheadResult> {
  const input = target.widget?.input ?? null;
  const started = monotonicNow();
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
    const closing = closingContext(ctx);
    const keepOpen = keepsListOpen(widget, before);
    if (typed > 0) {
      restore(widget.input ?? input, before, !keepOpen);
      await afterAction(widget, closing);
    }
    if (!keepOpen) await closeList(widget, closing, { activated: false });
    return none(why, blocked);
  };
  // A wait ended early: by the person's Skip, what was typed is put back and the list closed (giveUp on its tidy
  // context); by the run's own end, nothing more is done.
  const ended = (): Promise<TypeaheadResult> => (skipTidyContext(ctx) === null ? Promise.resolve(none('internal-error'))
    : giveUp('internal-error'));

  for (const [at, query] of queries.slice(0, MAX_SEARCH_QUERIES).entries()) {
    if (ctx.signal?.aborted) return ended();
    // v4 (drop): the field's time budget, checked before each query after the first.
    if (at > 0 && monotonicNow() - started >= budgetMs) break;
    // jr6 ENGINE E1 (FIXPLAN §6.2 item 3, SR-2): a query shorter than the page's own minimum is never typed
    // (WidgetDecl.minQueryLength: SmartRecruiters' minquerylength); the next one is tried.
    const minimum = current.widget?.minQueryLength;
    if (minimum !== undefined && query.length < minimum) continue;
    // The page hid the rest of the form behind the last query's open list: it is closed before the guard scans.
    if (typed > 0 && current.widget?.hidesFormWhileOpen === true) {
      await closeList(current.widget, ctx, { activated: false });
      if (ctx.signal?.aborted) return ended();
    }
    const guarded = await hooks.guard(query);
    if (ctx.signal?.aborted) return ended();
    if (!guarded.ok) return giveUp(guarded.reason, guarded.blocked);
    current = guarded.target;
    const widget = current.widget;
    const box = widget?.input ?? null;
    if (widget === undefined || box === null) return giveUp('element-not-found');
    // A query longer than the box takes is never cut: the next one is tried.
    if (box.maxLength >= 0 && query.length > box.maxLength) continue;
    // jr6 ENGINE E1 (FIXPLAN §6.2 item 2): a box its adapter declares beside the widget (WidgetDecl.input: iCIMS's
    // search box, in the container its anchor opens) is shown by opening the widget first, as a closed one is.
    const beside = boxBeside(widget);
    const shut = expandedState(widget) === false;
    if (shut || (beside && !boxTakes(box) && expandedState(widget) !== true)) {
      const opened = await activateAndAwait(widget, ctx);
      if (opened.status === 'aborted') return ended();
      if (opened.status === 'gone') return giveUp('element-not-found');
      if (opened.status !== 'answered') return giveUp('needs-your-click');
    }
    // Never typed into a box beside the widget that a person cannot see, or that takes no text.
    if (beside && !boxTakes(box)) return giveUp('needs-your-click');
    const prevHash = shownHash(widget);
    // v4 (drop): a search that starts on a keydown gets its declared key (WidgetDecl.queryKey: Lever's), once the page
    // has answered typed text itself (this query, at once, or an earlier one): a page that ignores the input event gets
    // no key, and the search stops there as below.
    if (widget.queryKey === undefined) {
      typeQuery(box, query);
    } else if (await typeWatched(box, query, ctx.root) || reacted) {
      pressQueryKey(widget, ctx);
    }
    typed += 1;
    // A search its adapter says answers "nothing" sooner than the cap (WidgetDecl.emptyAfterMs: Ashby's "No results")
    // ends there.
    const wait = await awaitList(widget, ctx, { prevHash, capMs: TYPEAHEAD_QUERY_CAP_MS,
      ...(widget.emptyAfterMs === undefined ? {} : { emptyAfterMs: widget.emptyAfterMs }) });
    if (wait.status === 'aborted') return ended();
    // A page that does not react at all to a query ignores untrusted input: it is never tried another way. A list the
    // page filters at once, inside our input event, has changed before the wait watched it: that is an answer too.
    if (!wait.mutated && !reacted && shownHash(widget) === prevHash) return giveUp('needs-your-click');
    reacted = true;
    const listbox = openListOf(widget);
    if (wait.status !== 'ready' || listbox === null) continue;
    // jr6 ENGINE E1 (FIXPLAN §6.2 item 1): the declared rows whole (WidgetResults.options too).
    const read = await readList(listbox, { signal: ctx.signal, labelOf: widget.optionLabel,
      ...(widget.results === undefined ? {} : { option: widget.results }),
      // s2 wd: a result that only opens a list of its own is read as one that cannot be chosen.
      ...(widget.results?.unchoosable === undefined ? {} : { unchoosable: widget.results.unchoosable }) });
    if (ctx.signal?.aborted) return ended();
    const results: WidgetOptionRead[] = read.options.map((option) => ({ label: option.label, disabled: option.disabled }));
    if (results.length === 0) continue;
    const verdict = await hooks.match(results, current, read.complete);
    // The worker's match can take a while (an AI pick): a Skip meanwhile ends the search as any wait's does.
    if (ctx.signal?.aborted) return ended();
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
    const typedNow = box.value;
    const known = results.map((result) => result.label);
    const shows = () => chosenLabels(widget, known).some((label) => sameOptionLabel(label, choice.cleanLabel));
    const chosenOf = (verified: boolean): TypeaheadResult => ({ chosen: { ...choice, results }, verified,
      reason: verified ? 'ok' : 'verify-mismatch', blocked: false, typed });
    // React first, once per write (see the header).
    let sent = false;
    if (ctx.bridgeTried === undefined) {
      const before = chosenLabels(widget, known);
      const bridged = await bridgeChoose(widget, { label: cleanOptionLabel(picked.label), shown: picked.label }, false,
        ctx);
      if (bridged.status === 'sent' || bridged.status === 'chosen') {
        sent = true;
        const answered = () => tidy(box.value) !== tidy(typedNow) || openListOf(widget) === null;
        const held = await afterBridge(widget, ctx, () => answered() && shows());
        const changed = answered() || !sameLabels(chosenLabels(widget, known), before);
        if (held || changed) {
          await closeList(widget, closingContext(ctx), { activated: false });
          return chosenOf(held && shows());
        }
        // A Skip during the bridge's wait: React may hold the choice, so it is written, not verified.
        if (ctx.signal?.aborted) {
          await closeList(widget, closingContext(ctx), { activated: false });
          return chosenOf(false);
        }
      }
    }
    // After a choice the bridge said it made, nothing ends as "nothing chosen": React may hold it.
    const stop = (why: ReasonCode) => (sent ? Promise.resolve(chosenOf(false)) : giveUp(why));
    const option = await revealOption(listbox, picked, { signal: ctx.signal, labelOf: widget.optionLabel,
      ...(widget.results === undefined ? {} : { option: widget.results, unchoosable: widget.results.unchoosable }) });
    if (ctx.signal?.aborted) return sent ? stop('internal-error') : ended();
    if (option === null || option.disabled) return stop('options-changed');
    if (!pressAllowed(widget, option.el, ctx)) return stop('needs-your-click');
    const markedBefore = marked(widget, option.el);
    chooseResult(widget, option.el);
    await afterAction(widget, ctx);
    // The person's Skip cut the wait for the page's answer short: the click was made, so it stands, read back as it
    // shows now, and the list is closed.
    if (ctx.signal?.aborted && skipTidyContext(ctx) !== null) {
      await closeList(widget, closingContext(ctx), { activated: false });
      return chosenOf(shows());
    }
    const closed = openListOf(widget) === null;
    if (!pageChose(widget, option.el, typedNow, closed, markedBefore)) return stop('needs-your-click');
    // Clicked and answered: the choice stands.
    await closeList(widget, closingContext(ctx), { activated: false });
    const verified = shows();
    return { chosen: { ...choice, results }, verified, reason: verified ? 'ok' : 'verify-mismatch', blocked: false,
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
