/*
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 13; §3.1 item 5: U-05, WD-18): the tags filler. A box that takes several answers one
 * at a time, each shown as a chip once it is added, as its adapter declares it (WidgetDecl.tags: Workday's "Type to Add
 * Skills" prompt, whose pills are its chips and whose answers are its search's results; UltiPro's review Skills, typed
 * and added by the Add beside it) is one field of kind 'text' (dom/scan.ts), planned as the person's values joined with
 * MANY_SEPARATOR (core/resolver/values.ts manyValues, RULES R0). fillTags writes them:
 * - the planned text is split on MANY_SEPARATOR again (tag-chips.ts tagValues);
 * - a value the chips show already is skipped (in any case): the run adds only what is missing, and never removes a
 *   chip, its own or the page's;
 * - each other value, in order, is a guarded write of its own (hooks.guard: the field found again on a fresh scan, the
 *   Guard's verdict on that one value), then:
 *   - search (WD-18): searched for as a remote typeahead's query is (typeahead.ts searchTypeahead: its declared results
 *     list, its declared query key, the result clicked through assertNotSubmit), and only a result whose shown words are
 *     the value itself is chosen (Jobright 1.25.2's MyWorkDay fillSkills searches each profile skill and picks its own
 *     result); a value no result is: left, and the next one tried;
 *   - add (U-05): typed into the text box with the text filler's setter and its input event, the page given its answer
 *     (one quiet window), then its declared Add (WidgetTags.add) pressed with an untrusted click through assertNotSubmit
 *     while a person can see it enabled (Jobright 1.25.2's UltiPro fillSkills types each skill missing from the chips
 *     and presses its row's Add); an Add that does not show, or that is refused, gets the box back as it was, and the
 *     field is the person's (needs-your-click);
 *   then the chips are awaited until they show the value (TAGS_ADD_CAP_MS: quiet windows on the form root, never a
 *   fixed sleep);
 * - it stops once the box holds its `cap` of chips (the values past it: max-selections-reached), once the field's adds
 *   have run TAGS_FIELD_BUDGET_MS, at a Guard's refusal or a page that does not answer, and at the person's Skip or the
 *   run's end;
 * - it is verified by the chips: every planned value shows as one (tag-chips.ts holdsTags).
 * Values stay in memory: nothing here logs or sends one.
 */
import type { WidgetTags } from '../../adapters/types';
import type { ReasonCode } from '../../core/types/fill';
import { fireChange, fireInput, setValue, windowOf } from '../fillers/events';
import { clickIfAllowed } from '../fillers/not-submit';
import { isDisabled, isReadOnly } from '../kinds';
import { cleanOptionLabel } from '../option-hash';
import { quietWait } from '../settle';
import { SEARCH_FIELD_BUDGET_MS, TAGS_ADD_CAP_MS, TAGS_FIELD_BUDGET_MS, WIDGET_QUIET_MS } from '../thresholds';
import { monotonicNow } from '../time';
import type { FieldTarget, WidgetOptionRead } from '../types';
import { isUserVisible } from '../visibility';
import { afterAction, type WidgetContext } from './interact';
import { chipWords, declaredTags, shownAsChip, tagIdentity, tagsCap, tagValues, chipsOf } from './tag-chips';
import { searchTypeahead } from './typeahead';

/** What the tags filler needs from the run: each value's Guard. */
export interface TagsHooks {
  /** Right before a value is typed: the field found again on a fresh scan and the Guard's verdict on typing it. */
  guard(value: string): Promise<{ ok: true; target: FieldTarget } | { ok: false; reason: ReasonCode; blocked: boolean }>;
}

/** How a tags write ended. Memory only (no value). */
export interface TagsResult {
  /** How many values the run added (each a chip the box shows now). */
  added: number;
  /** Every planned value shows as a chip now. */
  verified: boolean;
  /** 'ok' or 'already-correct' when verified; else why a value is missing ('max-selections-reached' at the cap). */
  reason: ReasonCode;
  /** A Guard refused a value: the field is blocked, not merely flagged. */
  blocked: boolean;
}

/** Whether a box may take a value now: shown, enabled and writable. */
function boxTakes(box: HTMLInputElement | HTMLTextAreaElement): boolean {
  return box.isConnected && isUserVisible(box) && !isDisabled(box) && !isReadOnly(box);
}

/** Whether a control can be pressed by a person now: shown, and not disabled. */
function pressable(el: HTMLElement): boolean {
  return el.isConnected && isUserVisible(el) && (el as HTMLButtonElement).disabled !== true
    && (el.getAttribute('aria-disabled') ?? '').trim().toLowerCase() !== 'true';
}

/** The declared Add now, or null (none declared, none shown, or a hook that throws). */
function addOf(tags: WidgetTags): HTMLElement | null {
  try {
    return tags.add?.() ?? null;
  } catch {
    return null;
  }
}

/** Waits until the box shows `value` as a chip: quiet windows on the form root, at most TAGS_ADD_CAP_MS. True when it
 *  does; false at the cap or when the run's signal ends the wait. */
async function chipShown(tags: WidgetTags, value: string, ctx: WidgetContext): Promise<boolean> {
  if (shownAsChip(chipWords(tags), value)) return true;
  const wait = quietWait<boolean>({ view: windowOf(ctx.root), quietMs: WIDGET_QUIET_MS, capMs: TAGS_ADD_CAP_MS,
    signal: ctx.signal, aborted: false, atQuiet: () => (shownAsChip(chipWords(tags), value) ? true : null),
    atCap: () => shownAsChip(chipWords(tags), value) });
  wait.observe(ctx.root);
  // A box drawn outside the form root (a dialog at the end of the body) is watched too.
  for (const chip of chipsOf(tags)) if (chip.parentElement !== null) wait.observe(chip.parentElement);
  return wait.done;
}

/** One value added through the box's search (see the header): the field's own target after its Guard, and how it went. */
async function searchOne(target: FieldTarget, value: string, ctx: WidgetContext, hooks: TagsHooks, budgetMs: number):
  Promise<{ ok: boolean; reason: ReasonCode; blocked: boolean; stop: boolean; target: FieldTarget }> {
  let current = target;
  const result = await searchTypeahead(target, [value], ctx, {
    guard: async (query) => {
      const verdict = await hooks.guard(query);
      if (verdict.ok) current = verdict.target;
      return verdict;
    },
    // Only a result whose shown words are the value itself is chosen (WidgetDecl.tags.search: Workday's pills).
    match: async (results: readonly WidgetOptionRead[]) => {
      const index = results.findIndex((result) => !result.disabled && tagIdentity(result.label) === tagIdentity(value));
      return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
        : { choose: { index, cleanLabel: cleanOptionLabel(results[index]!.label) } };
    },
  }, budgetMs, { freeText: false });
  if (result.chosen === null) {
    // No result is the value: the next one is tried; the page's silence, a Guard's word or the run's end stop the box.
    const stop = result.blocked || result.reason !== 'no-match';
    return { ok: false, reason: result.reason, blocked: result.blocked, stop, target: current };
  }
  const tags = current.widget?.tags ?? target.widget!.tags!;
  const shown = await chipShown(tags, value, ctx);
  return { ok: shown, reason: shown ? 'ok' : 'verify-mismatch', blocked: false, stop: false, target: current };
}

/** One value typed and added by the box's declared Add (see the header). */
async function addOne(target: FieldTarget, value: string, ctx: WidgetContext, hooks: TagsHooks):
  Promise<{ ok: boolean; reason: ReasonCode; blocked: boolean; stop: boolean; target: FieldTarget }> {
  const verdict = await hooks.guard(value);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, blocked: verdict.blocked, stop: true, target };
  const current = verdict.target;
  const widget = current.widget;
  const tags = widget?.tags;
  const box = widget?.input ?? null;
  if (widget === undefined || tags === undefined || box === null) {
    return { ok: false, reason: 'element-not-found', blocked: false, stop: true, target: current };
  }
  if (!boxTakes(box)) return { ok: false, reason: 'needs-your-click', blocked: false, stop: true, target: current };
  const before = box.value;
  // A query longer than the box takes is never cut: the value is left, the next one tried.
  if (box.maxLength >= 0 && value.length > box.maxLength) {
    return { ok: false, reason: 'maxlength-exceeded', blocked: false, stop: false, target: current };
  }
  const putBack = () => {
    if (!box.isConnected || box.value === before) return;
    setValue(box, before);
    fireInput(box, 'text');
    fireChange(box);
  };
  setValue(box, value);
  fireInput(box, 'text');
  // The page enables its Add once text is typed (UltiPro's, disabled until then): its answer awaited.
  const answer = await afterAction(widget, ctx);
  if (answer.aborted) {
    putBack();
    return { ok: false, reason: 'internal-error', blocked: false, stop: true, target: current };
  }
  const add = addOf(tags);
  if (add === null || !pressable(add) || !clickIfAllowed(add, { adapter: ctx.adapter, root: ctx.root })) {
    putBack();
    return { ok: false, reason: 'needs-your-click', blocked: false, stop: true, target: current };
  }
  const shown = await chipShown(tags, value, ctx);
  // A value the page took nothing of is put back where the box still holds it.
  if (!shown && box.value === value) putBack();
  return { ok: shown, reason: shown ? 'ok' : 'verify-mismatch', blocked: false, stop: false, target: current };
}

/** Writes a planned text into a box of several answers and reads it back by its chips (see the header). */
export async function fillTags(target: FieldTarget, text: string, ctx: WidgetContext, hooks: TagsHooks):
  Promise<TagsResult> {
  const none = (reason: ReasonCode, blocked = false): TagsResult => ({ added: 0, verified: false, reason, blocked });
  const widget = target.widget;
  const tags = declaredTags(widget?.tags);
  if (widget === undefined || tags === undefined || widget.input === null) return none('widget-unsupported');
  // A box that declares neither how a value is added nor a search for it is never typed into.
  if (tags.add === undefined && tags.search !== true) return none('widget-unsupported');
  if (target.field.disabled || target.field.readOnly) return none('disabled-or-readonly');
  const values = tagValues(text);
  if (values.length === 0) return none('internal-error');
  const missing = () => {
    const chips = chipWords(tags);
    return values.filter((value) => !shownAsChip(chips, value));
  };
  if (missing().length === 0) return { added: 0, verified: true, reason: 'already-correct', blocked: false };
  const cap = tagsCap(tags);
  const started = monotonicNow();
  let current = target;
  let added = 0;
  let reason: ReasonCode = 'ok';
  let blocked = false;
  let capped = false;
  for (const value of missing()) {
    if (ctx.signal?.aborted) break;
    if (added > 0 && monotonicNow() - started >= TAGS_FIELD_BUDGET_MS) break;
    const now = current.widget?.tags ?? tags;
    const chips = chipWords(now);
    // The page may have added it meanwhile; a box at its cap takes no more.
    if (shownAsChip(chips, value)) continue;
    if (cap !== null && chipsOf(now).length >= cap) {
      capped = true;
      break;
    }
    // A box that declares its Add is added by it; one that declares only a search, by its result.
    const step = now.add === undefined
      ? await searchOne(current, value, ctx, hooks, SEARCH_FIELD_BUDGET_MS)
      : await addOne(current, value, ctx, hooks);
    current = step.target;
    if (step.ok) {
      added += 1;
      continue;
    }
    reason = step.reason;
    blocked = step.blocked;
    if (step.stop) break;
  }
  const left = missing();
  if (left.length === 0) return { added, verified: true, reason: added > 0 ? 'ok' : 'already-correct', blocked: false };
  const full = cap !== null && chipsOf(current.widget?.tags ?? tags).length >= cap;
  return { added, verified: false, reason: capped || (full && !blocked) ? 'max-selections-reached'
    : reason === 'ok' ? 'verify-mismatch' : reason, blocked };
}
