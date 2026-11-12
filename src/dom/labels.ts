/*
 * Field labels (docs/design/runtime.md §5.5; docs/ARCHITECTURE.md "Scanner"). A label is read only from the spec's
 * sources, and only as text a person can see (visibleText), so a hidden or camouflaged label never names a field.
 *
 * Order. A visible source always wins over aria-label: label[for], aria-labelledby (hidden targets dropped), the
 * wrapping <label> (minus the controls inside it), the fieldset's legend, the adapter's label (written from a
 * snapshot), then the visible placeholder, and only then aria-label alone. The spec lists aria-label third; it is read
 * after the visible sources because it is never shown, and a page could otherwise name a field one thing on screen and
 * another to us (an aria-label "Email" on a field shown as "Referrer's email"). An aria-label still drives the rules,
 * marked not visible unless the same words stand whole, in order, beside the control (DOM-11: a one-letter "e" is
 * found in any sentence); it never reaches an LLM.
 * The one exception (DOM-10, the lead's decision): when the visible placeholder is the only visible source and the
 * control also has an aria-label, the aria-label is the label's text (labelSource 'aria-label'), because a placeholder
 * is so often an example ("e.g. Jane", "https://") rather than a name, and the visible placeholder is what makes the
 * field fillable (visible true). A placeholder our own write hid counts only while the page still shows the text seen
 * at that write (heldPlaceholder, DOM-7). A trailing required mark ('*', or Lever's heavy asterisk) or "(required)" is
 * cut and sets `required`; "(optional)" is cut. jr6 ENGINE E2 (FIXPLAN §6.2 item 11, ADP-5): a label[for] or
 * aria-labelledby label that ends with a copy of the control's own validation message (its validationmessage or
 * validation-message attribute, or a widget host's around it: ADP writes "City is required" into City's label after a
 * refused Next) is read without it (withoutValidation).
 *
 * Groups (radios, checkbox groups) take their question from the container: its aria-labelledby, its legend, the
 * adapter's label, then its aria-label. Each member's own visible label is the option's label; jr6 ENGINE E2 (FIXPLAN
 * §6.2 item 8, ICIMS-14): where no label element holds it, the words its adapter reads after it (optionTextFor: iCIMS's
 * self-identification radios, each followed by its bare words), only while a person can see those words beside it.
 *
 * The adapter's label is the visible text of the element its labelFor names, with the words its labelSuffix adds for a
 * control that shares that element with others (Ashby's month and year lists under one "Start Date"). One inside the
 * control's own wrapping label that reads otherwise comes before that label's whole text (Workable's question beside
 * its required star in one <label>). An adapter's upload control (uploadWidgets: Workable's "Choose file", a
 * label[for] its input's aria-labelledby also names) never labels its input. Help text is the visible aria-describedby
 * targets, else the elements the adapter's descriptionFor names.
 */
import type { LabelSource } from '../core/enums';
import type { Adapter } from '../adapters/types';
import { capCodePoints, foldLetters, removeInvisibles } from '../core/text/fold';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import type { ScanCache } from './scan-cache';
import { MIN_ARIA_LABEL_CHARS, TEXT_CAP_DESCRIPTION, TEXT_CAP_LABEL } from './thresholds';
import { heldPlaceholder, readSelectOptions, visiblePlaceholder, visibleText, visibleTextWithout } from './visible-text';
import { isUserVisible } from './visibility';

/** What the scanner reads labels with. */
export interface LabelContext {
  cache: ScanCache;
  adapter: Adapter | null;
  /** Controls the extension wrote into while a visible placeholder showed, with that placeholder's text
   *  (ScanOptions.heldPlaceholders). */
  heldPlaceholders?: WeakMap<Element, string>;
  /** The scan's form root, which the adapter's repeatable blocks are asked of (explicitLabels); without it a
   *  label[for] is read as the browser ties it. */
  root?: Element;
}

/** A field's label as read. */
export interface ResolvedLabel {
  /** The cleaned label, at most 300 characters; '' when none. */
  text: string;
  source: LabelSource;
  /** Read from text a person can see. False for an aria-label whose words are not visible beside the control, and for
   *  'none'. */
  visible: boolean;
  /** A trailing required mark or "(required)" was cut. */
  required: boolean;
  /** The element the label was read from (a label, a labelledby target, a legend, the adapter's label); null for
   *  aria-label, placeholder and none. Highlights point at it. */
  element: Element | null;
  /** The core pass of 2026-11-06: the whole label as read (white space collapsed, at most TEXT_CAP_DESCRIPTION), set
   *  only where `text` cut it at TEXT_CAP_LABEL. Memory only: the scan reads an attestation past the cut from it
   *  (FieldSpec.statesNoAi). */
  whole?: string;
}

const NONE: ResolvedLabel = { text: '', source: 'none', visible: false, required: false, element: null };

/** The core pass of 2026-11-06: the whole label as read, where cleanLabel cut it at TEXT_CAP_LABEL (ResolvedLabel.whole). */
function wholeOf(raw: string, cut: string): { whole?: string } {
  const whole = raw.replace(/\s+/g, ' ').trim();
  return [...whole].length > TEXT_CAP_LABEL && [...cut].length >= TEXT_CAP_LABEL ? { whole } : {};
}

/** A trailing required mark: '*', Lever's heavy asterisk '\u{2731}' (its span.required, the only sign that Lever's
 *  Resume/CV is required), and the asterisk operator and full-width asterisk that other forms draw instead. */
const REQUIRED_MARK = /\s*[*\u{2731}\u{2217}\u{FF0A}]+$/u;

/** Collapses white space and cuts trailing required and optional marks (and a trailing colon). */
export function cleanLabel(raw: string): { text: string; required: boolean } {
  let text = raw.replace(/\s+/g, ' ').trim();
  let required = false;
  for (let changed = true; changed;) {
    const before = text;
    text = text.replace(/[\s:]+$/, '');
    if (REQUIRED_MARK.test(text)) {
      text = text.replace(REQUIRED_MARK, '');
      required = true;
    }
    if (/\(\s*required\s*\)$/i.test(text)) {
      text = text.replace(/\s*\(\s*required\s*\)$/i, '');
      required = true;
    }
    text = text.replace(/\s*\(\s*optional\s*\)$/i, '');
    changed = text !== before;
  }
  return { text: capCodePoints(text, TEXT_CAP_LABEL), required };
}

function fromText(raw: string, source: LabelSource, element: Element | null, visible = true): ResolvedLabel | null {
  const { text, required } = cleanLabel(raw);
  // The whole label only where a person can see it (never an aria-label nobody sees beside the control).
  return text === '' ? null : { text, source, visible, required, element, ...(visible ? wholeOf(raw, text) : {}) };
}

/** The visible text of an element on one line ('' when it is hidden). */
function textOf(el: Element, ctx: LabelContext): string {
  return visibleText(el, { singleLine: true, cap: TEXT_CAP_DESCRIPTION, cache: ctx.cache });
}

/** The labels tied to a control: explicit ones (label[for]) and the wrapping one, as the browser associates them. */
export function tiedLabels(control: Element): { explicit: HTMLLabelElement[]; wrapping: HTMLLabelElement[] } {
  const labels = (control as HTMLInputElement).labels;
  const all = labels ? Array.from(labels) : [];
  return {
    explicit: all.filter((label) => label.hasAttribute('for')),
    wrapping: all.filter((label) => !label.hasAttribute('for')),
  };
}

/**
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 28): a control's label[for] elements, read within its own repeatable
 * block where its id repeats in the page. ClearCompany draws each repeated row with the first row's ids
 * (fixtures/clearcompany/ferrilli-page2.html: four Employment History rows, each with label[for="87977d19-..."] "Company
 * Name" and an input of that id), and the browser ties every row's label to the first row's control, which then read
 * "Company Name Company Name Company Name Company Name" while the other rows' controls had none. Inside one of the
 * adapter's repeatable blocks (Adapter.repeatables, asked of the scan's root), such a control's label[for] elements are
 * the block's own that name its id; anywhere else, or where its id is the page's only one, the browser's.
 */
function explicitLabels(control: Element, tied: HTMLLabelElement[], ctx: LabelContext): HTMLLabelElement[] {
  const id = control.id;
  const root = ctx.root;
  if (id === '' || root === undefined || ctx.adapter?.repeatables === undefined) return tied;
  const tree = control.getRootNode() as Document | ShadowRoot;
  if (typeof tree.querySelectorAll !== 'function') return tied;
  const counts = ctx.cache.memo('id-counts', tree, () => {
    const seen = new Map<string, number>();
    for (const el of Array.from(tree.querySelectorAll('[id]'))) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return seen;
  });
  if ((counts.get(id) ?? 0) < 2) return tied;
  const blocks = ctx.cache.memo('repeat-blocks', root, (): Element[] => {
    try {
      return (ctx.adapter?.repeatables?.(root) ?? []).flatMap((section) => section.blocks());
    } catch {
      return [];
    }
  });
  const block = blocks.find((each) => each !== control && each.contains(control));
  if (block === undefined) return tied;
  return Array.from(block.querySelectorAll<HTMLLabelElement>('label[for]')).filter((label) => label.htmlFor === id);
}

/** The joined visible text of a list of elements ('' when none of them shows any), leaving out the text of
 *  `excluded` elements inside them. */
function joinedText(elements: readonly Element[], ctx: LabelContext, excluded: readonly Element[] = []):
  { text: string; first: Element | null } {
  let first: Element | null = null;
  const parts: string[] = [];
  for (const el of elements) {
    const inside = excluded.filter((other) => el.contains(other));
    const text = inside.length === 0 ? textOf(el, ctx)
      : visibleTextWithout(el, inside, { singleLine: true, cap: TEXT_CAP_DESCRIPTION, cache: ctx.cache });
    if (text === '') continue;
    // jr7 ENGINE-7 E1 item 7 (RBP7-21, as its verifier corrected it: Pinpoint draws its job-preference block twice with
    // the same ids, snapshot7 pinpointhq1, so the first control of each id takes both label[for] and read "Locations
    // Locations"): labels of one control that say the same words count once.
    if (parts.some((part) => foldedWords(part) === foldedWords(text))) continue;
    first ??= el;
    parts.push(text);
  }
  return { text: parts.join(' '), first };
}

/**
 * The visible controls of the adapter's upload widgets that sit inside these wrapping labels. A wrapping label's text
 * leaves them out: Lever wraps its resume question in a <label> that also holds the widget's "ATTACH RESUME/CV" link
 * (fixtures/lever/*.html), and the question is the label's own "Resume/CV" and its required mark (the heavy asterisk,
 * the only sign Lever's resume is required). The widgets are asked of the labels' form, the root an adapter's hooks
 * read.
 */
function uploadControlsIn(labels: readonly Element[], ctx: LabelContext): Element[] {
  const first = labels[0];
  if (first === undefined || ctx.adapter?.uploadWidgets === undefined) return [];
  const scope = first.closest('form') ?? first.ownerDocument.body ?? first;
  const widgets = ctx.cache.memo('upload-widgets', scope, () => ctx.adapter?.uploadWidgets?.(scope) ?? []);
  return widgets.map((widget) => widget.control).filter((control) => labels.some((label) => label.contains(control)));
}

/** The elements an aria-labelledby or aria-describedby attribute names, in its own tree. */
export function referenced(el: Element, attribute: 'aria-labelledby' | 'aria-describedby'): Element[] {
  const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.getElementById !== 'function') return [];
  return ids.map((id) => root.getElementById(id)).filter((target): target is HTMLElement => target !== null);
}

/**
 * The visible controls of the adapter's upload widgets among these elements (Workable's "Choose file", a label[for]
 * with role=button that its file input also names in its aria-labelledby): such a control is the widget's button, never
 * its input's question, so neither a label[for] nor an aria-labelledby target that is one names the input.
 */
function uploadControlsAmong(elements: readonly Element[], ctx: LabelContext): Set<Element> {
  const first = elements[0];
  if (first === undefined || ctx.adapter?.uploadWidgets === undefined) return new Set();
  const scope = first.closest('form') ?? first.ownerDocument.body ?? first;
  const widgets = ctx.cache.memo('upload-widgets', scope, () => ctx.adapter?.uploadWidgets?.(scope) ?? []);
  const controls = new Set(widgets.map((widget) => widget.control));
  return new Set(elements.filter((el) => controls.has(el)));
}

/** The label of a single control (a text field, a select, a lone checkbox, a file input). */
export function labelOfControl(control: Element, ctx: LabelContext): ResolvedLabel {
  // Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 28): the adapter's own label first, where it says so
  // (Adapter.labelFirst: Jobvite's signature pairs, whose label[for] alone reads as a name).
  if (labelsFirst(control, ctx)) {
    const first = adapterLabelOf(control, ctx);
    if (first !== null) return first;
  }
  const tied = tiedLabels(control);
  const explicit = explicitLabels(control, tied.explicit, ctx);
  const { wrapping } = tied;
  const ownFor = uploadControlsAmong(explicit, ctx);
  const forLabel = joinedText(explicit.filter((label) => !ownFor.has(label)), ctx);
  const byFor = fromText(forLabel.text, 'for', forLabel.first);
  if (byFor) return withoutValidation(byFor, control); // jr6 ENGINE
  const targets = referenced(control, 'aria-labelledby');
  const ownTargets = uploadControlsAmong(targets, ctx);
  const labelledBy = joinedText(targets.filter((target) => !ownTargets.has(target)), ctx);
  const byLabelledBy = fromText(labelledBy.text, 'aria-labelledby', labelledBy.first);
  if (byLabelledBy) return withoutValidation(byLabelledBy, control); // jr6 ENGINE
  const wrap = joinedText(wrapping, ctx, uploadControlsIn(wrapping, ctx));
  const byWrapping = fromText(wrap.text, 'wrapping-label', wrap.first);
  // The adapter's label inside the control's own wrapping label, where the two read differently, is that label's
  // question without the label's other parts (Workable draws its required star before the question in the same
  // <label>, and its consent box sits in two nested labels, whose texts would join twice). Where they read alike the
  // wrapping label stands (Lever's resume question).
  const inner = byWrapping === null ? null : adapterLabelOf(control, ctx);
  if (inner !== null && inner.element !== null && inner.text !== byWrapping!.text
    && wrapping.some((label) => label.contains(inner.element!))) return inner;
  if (byWrapping) return byWrapping;
  const legend = soleFieldLegend(control, ctx);
  if (legend) return legend;
  const byAdapter = adapterLabelOf(control, ctx);
  if (byAdapter) return byAdapter;
  // A control we wrote into keeps the placeholder that showed then, while the page still shows the same text: our own
  // write hid it, and the field, with its key, is the same one. Any other filled control's placeholder is out of sight
  // and names nothing.
  const held = ctx.heldPlaceholders?.get(control);
  const placeholder = visiblePlaceholder(control, ctx.cache)
    ?? (held === undefined ? null : heldPlaceholder(control, held, ctx.cache));
  // Core pass Z2 of 2026-11-06: a select's prompt (selectPrompt) that shows its aria-label's own words is its visible
  // placeholder for DOM-10 alone: the aria-label names it, the prompt a person sees makes it fillable. A prompt in
  // other words ("Select...", "Choose...") shows nothing of the aria-label, which stays unseen (DOM-11).
  if (placeholder === null && ariaLabelOf(control) !== '') {
    const prompt = selectPrompt(control, ctx);
    const named = prompt !== null && sameWords(prompt, ariaLabelOf(control)) ? ariaLabel(control, ctx) : null;
    if (named !== null) return { ...named, visible: true };
  }
  if (placeholder !== null) {
    // DOM-10: the aria-label names the field, the visible placeholder makes it fillable.
    const named = ariaLabel(control, ctx);
    if (named !== null) return { ...named, visible: true, required: named.required || cleanLabel(placeholder).required };
    const byPlaceholder = fromText(placeholder, 'placeholder', null);
    if (byPlaceholder) return byPlaceholder;
  }
  return ariaLabel(control, ctx) ?? NONE;
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 11, ADP-5): a validation message the page writes into a label ──
/** The attributes a control, or the widget host around it, carries its validation message in (ADP's
 *  <input validationmessage=" is required"> and <wfn-dropdown-list validation-message=" is required">: the jr6 ADP
 *  audit's jr6-personal-us-errors, after a refused Next). */
const VALIDATION_ATTRIBUTES = ['validationmessage', 'validation-message'] as const;

/** How many shadow hosts above a control are read as its widget's hosts. */
const VALIDATION_HOST_DEPTH = 4;

/** Text as compared for a validation message: runs of white space as one space, trimmed, lower case. */
const foldedWords = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The validation messages a control carries (VALIDATION_ATTRIBUTES), on itself and on the hosts of the shadow trees it
 *  sits in (a widget host), each folded; none empty. */
function validationMessagesOf(control: Element): string[] {
  const messages = new Set<string>();
  let at: Element | null = control;
  for (let depth = 0; at !== null && depth <= VALIDATION_HOST_DEPTH; depth += 1) {
    for (const name of VALIDATION_ATTRIBUTES) {
      const message = foldedWords(at.getAttribute(name) ?? '');
      if (message !== '') messages.add(message);
    }
    // A shadow root of the control's own frame (instanceof would read another window's as none).
    const tree = at.getRootNode();
    at = tree.nodeType === 11 && 'host' in tree ? (tree as ShadowRoot).host : null;
  }
  return [...messages];
}

/**
 * The label without a trailing copy of the control's own validation message (validationMessagesOf): ADP rewrites a
 * label's text to "<label> is required" (class mdf-label-error) while the input carries validationmessage=" is
 * required", so "City is required" reads "City" again (the jr6 ADP audit's ADP-5; Jobright's ADP answer module strips
 * the same suffix from its phone labels, normalizeAdpWorkforceNowPhoneLabel). Only a message the control (or its widget
 * host) carries, only at the end, and only where words are left; a required mark the page draws after it is cut first
 * (cleanLabel). Any other label is returned as it is.
 */
function withoutValidation(label: ResolvedLabel, control: Element): ResolvedLabel {
  const messages = validationMessagesOf(control);
  if (messages.length === 0) return label;
  const cut = (text: string): { text: string; required: boolean } | null => {
    const words = text.replace(/\s+/g, ' ').trim();
    const message = messages.find((each) => words.toLowerCase().endsWith(` ${each}`));
    if (message === undefined) return null;
    const left = cleanLabel(words.slice(0, words.length - message.length - 1));
    return left.text === '' ? null : left;
  };
  // A label that ends with the message was not cut at TEXT_CAP_LABEL, so it holds no `whole` to cut as well.
  const shorter = cut(label.text);
  return shorter === null ? label : { ...label, text: shorter.text, required: label.required || shorter.required };
}
// ── end jr6 ENGINE E2 item 11 ──

/** Whether two texts are the same words in the same order, a word and its plural "s" alike (CareerPlug's prompt
 *  "State" for its aria-label "States"), and at least MIN_ARIA_LABEL_CHARS letters or digits in all. */
function sameWords(a: string, b: string): boolean {
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (left.length === 0 || left.length !== right.length || left.join('').length < MIN_ARIA_LABEL_CHARS) return false;
  return left.every((word, at) => {
    const other = right[at]!;
    return word === other || word === `${other}s` || other === `${word}s`;
  });
}

/** A control's aria-label attribute, trimmed. */
function ariaLabelOf(el: Element): string {
  return (el.getAttribute('aria-label') ?? '').trim();
}

/**
 * Core pass Z2 of 2026-11-06: the prompt a select shows where nothing is chosen, as an input shows its placeholder: a
 * single-choice select's (no multiple, no list size) first option, of empty value, listed with words (readSelectOptions:
 * a person can see the select and the option reads clear in its list). It stays in the list once an answer is chosen,
 * so the field keeps its visible name across our own write (as a held placeholder does, DOM-7); it makes the aria-label
 * visible only where it shows the aria-label's own words (sameWords). CareerPlug's State select
 * (fixtures/careerplug/cloudscouts-form.html, eitacies-uploaded.html): <select id="app_applicant_attributes_state"
 * aria-label="States" ...><option value="">State</option> ..., its label[for] "States" drawn out of sight
 * (fieldset.placeholder label { display: none }), as the Address and City inputs beside it show their placeholders.
 * Null for any other control.
 */
function selectPrompt(control: Element, ctx: LabelContext): string | null {
  if (control.localName !== 'select') return null;
  const select = control as HTMLSelectElement;
  if (select.multiple || select.size > 1) return null;
  const first = select.options[0];
  if (first === undefined || first.getAttribute('value') !== '') return null;
  const shown = readSelectOptions(select, ctx.cache)[0];
  return shown !== undefined && shown.el === first && shown.label.trim() !== '' ? shown.label : null;
}

/** The question of a radio or checkbox group: from its container, then the adapter, then the container's aria-label. */
export function labelOfGroup(members: readonly HTMLInputElement[], container: Element | null, ctx: LabelContext):
  ResolvedLabel {
  if (container !== null) {
    const labelledBy = joinedText(referenced(container, 'aria-labelledby'), ctx);
    const byLabelledBy = fromText(labelledBy.text, 'aria-labelledby', labelledBy.first);
    if (byLabelledBy) return byLabelledBy;
    const legend = legendOf(container);
    if (legend) {
      const byLegend = fromText(textOf(legend, ctx), 'legend', legend);
      if (byLegend) return byLegend;
    }
  }
  const first = members[0];
  const byAdapter = (container ? adapterLabelOf(container, ctx) : null) ?? (first ? adapterLabelOf(first, ctx) : null);
  if (byAdapter) return byAdapter;
  return (container ? ariaLabel(container, ctx) : null) ?? NONE;
}

/** The visible label of one radio or checkbox as an option of its group: its label[for], else its wrapping label, else
 *  the adapter's, else (jr6 ENGINE E2) the words its adapter reads after it (adapterOptionText). '' when it shows
 *  none. */
export function optionLabelOf(input: HTMLInputElement, ctx: LabelContext): { text: string; element: Element | null } {
  const tied = tiedLabels(input);
  const explicit = explicitLabels(input, tied.explicit, ctx);
  const { wrapping } = tied;
  for (const list of [explicit, wrapping]) {
    const joined = joinedText(list, ctx);
    const { text } = cleanLabel(joined.text);
    if (text !== '') return { text, element: joined.first };
  }
  const adapter = adapterLabelOf(input, ctx);
  if (adapter) return { text: adapter.text, element: adapter.element };
  const words = adapterOptionText(input, ctx); // jr6 ENGINE
  return { text: words ?? '', element: null };
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 8, ICIMS-14): an option's words that no label element holds ──
/** How many ancestors above a radio or checkbox the words its adapter reads for it are looked for in. */
const OPTION_TEXT_DEPTH = 4;

/**
 * The words of a radio's or a checkbox's option that its adapter reads where no label element holds them
 * (Adapter.optionTextFor: iCIMS's self-identification IForms, <span class="... iCIMS_Forms_RadioGroup ..."><input
 * type="radio" ...></span> followed by the option's bare words up to a <br>: fixtures/icims/edgewater-self-id-veteran
 * .frame-2.html, nyu-self-id-disability.frame-2.html), cleaned and cut as a label is; null where the adapter reads none
 * (or its hook throws), for any other control, and where a person cannot see those words beside it: they must stand
 * whole and in order (at least MIN_ARIA_LABEL_CHARS letters or digits), as the page shows them, in the visible text of
 * one of the control's nearest OPTION_TEXT_DEPTH ancestors below its form, as an aria-label's words must (DOM-11), so a
 * page can never name an option one thing on screen and another to us.
 */
function adapterOptionText(input: HTMLInputElement, ctx: LabelContext): string | null {
  if (ctx.adapter?.optionTextFor === undefined || (input.type !== 'radio' && input.type !== 'checkbox')) return null;
  let raw: string | null;
  try {
    raw = ctx.adapter.optionTextFor(input) ?? null;
  } catch {
    return null;
  }
  const { text } = cleanLabel(raw ?? '');
  if (text === '') return null;
  // The words uncut: a label's cut (TEXT_CAP_LABEL) may fall inside a word.
  const wanted = wordsOf(raw ?? '');
  let depth = 0;
  for (let at = input.parentElement; at !== null && depth < OPTION_TEXT_DEPTH; at = at.parentElement, depth += 1) {
    if (at.localName === 'form' || at.localName === 'body' || at.localName === 'html') break;
    if (containsWords(wordsOf(textOf(at, ctx)), wanted)) return text;
  }
  return hiddenOwnLabelSays(input, wanted, ctx) ? text : null; // jr7 ENGINE-7 E1 item 5
}
// ── end jr6 ENGINE E2 item 8 ──

// ── jr7 ENGINE-7 E1 item 5 (EFA-4, as its verifier corrected it) ──
/**
 * Whether the option's words its adapter reads (`wanted`) are painted inside a label[for] of that very input that the
 * page marks aria-hidden, where a person sees them while the visible-text reading skips them: Eightfold's radio
 * questions (snapshot7 twillio: each radio at opacity 0, its own label[for] aria-hidden="true" drawing "No" or "Yes",
 * the input's aria-label "No, <the question>"). Only for an input of a proxy its adapter declares (Adapter.proxyFor
 * answers one), only where the input's own aria-label starts with those words, and only a label of its own: drawn
 * (it has a box), naming its id, holding the words whole. Never a label of another control.
 */
function hiddenOwnLabelSays(input: HTMLInputElement, wanted: readonly string[], ctx: LabelContext): boolean {
  if (input.id === '' || ctx.adapter?.proxyFor === undefined) return false;
  try {
    if (ctx.adapter.proxyFor(input) === null) return false;
  } catch {
    return false;
  }
  const own = wordsOf(ariaLabelOf(input));
  if (wanted.length === 0 || own.length < wanted.length || !wanted.every((word, at) => own[at] === word)) return false;
  return tiedLabels(input).explicit.some((label) => label.htmlFor === input.id
    && label.closest('[aria-hidden="true" i]') !== null && label.getClientRects().length > 0
    && containsWords(wordsOf(label.textContent ?? ''), wanted));
}
// ── end jr7 ENGINE-7 E1 item 5 ──

/** Visible help text: the aria-describedby targets a person can see, joined; else the adapter's (descriptionFor). */
export function descriptionOf(el: Element, ctx: LabelContext): string {
  let text = joinedText(referenced(el, 'aria-describedby'), ctx).text;
  if (text === '' && ctx.adapter?.descriptionFor !== undefined) {
    let declared: Element[];
    try {
      declared = ctx.adapter.descriptionFor(el);
    } catch {
      declared = [];
    }
    text = joinedText(declared, ctx).text;
  }
  return capCodePoints(text.replace(/\s+/g, ' ').trim(), TEXT_CAP_DESCRIPTION);
}

/** The first legend child of a fieldset. */
export function legendOf(container: Element): Element | null {
  if (container.localName !== 'fieldset') return null;
  for (const child of Array.from(container.children)) {
    if (child.localName === 'legend') return child;
  }
  return null;
}

/** A fieldset's legend labels a single control only when that control is the fieldset's only field. */
function soleFieldLegend(control: Element, ctx: LabelContext): ResolvedLabel | null {
  const fieldset = control.closest('fieldset');
  if (fieldset === null) return null;
  const legend = legendOf(fieldset);
  if (legend === null) return null;
  const fields = Array.from(fieldset.querySelectorAll(CONTROL_SELECTOR)).filter((el) => kindOf(el, ctx.adapter).field);
  if (fields.length !== 1 || fields[0] !== control) return null;
  return fromText(textOf(legend, ctx), 'legend', legend);
}

/** Whether the adapter reads its label before the control's own (Adapter.labelFirst); false when its hook fails. */
function labelsFirst(control: Element, ctx: LabelContext): boolean {
  try {
    return ctx.adapter?.labelFirst?.(control) === true;
  } catch {
    return false;
  }
}

/** The adapter's visible label for a control or a group's container (labelFor, with its labelSuffix), or null. */
export function adapterLabelOf(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const labelEl = ctx.adapter?.labelFor?.(el) ?? null;
  if (labelEl === null || !isUserVisible(labelEl, ctx.cache)) return null;
  const raw = textOf(labelEl, ctx);
  const cleaned = cleanLabel(raw);
  if (cleaned.text === '') return null;
  const suffix = (ctx.adapter?.labelSuffix?.(el) ?? '').replace(/\s+/g, ' ').trim();
  const text = suffix === '' ? cleaned.text : capCodePoints(`${cleaned.text} ${suffix}`, TEXT_CAP_LABEL);
  return { text, source: 'adapter', visible: true, required: cleaned.required, element: labelEl,
    ...wholeOf(raw, cleaned.text) };
}

/** An aria-label: it may drive the rules, and counts as visible only when its words are visible beside the control
 *  (in the control's field container): all of them, whole and in order, and at least MIN_ARIA_LABEL_CHARS letters or
 *  digits in all (DOM-11). */
function ariaLabel(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const raw = el.getAttribute('aria-label') ?? '';
  const label = fromText(raw, 'aria-label', null, false);
  if (label === null) return null;
  const container = fieldContainer(el);
  if (container !== null && containsWords(wordsOf(textOf(container, ctx)), wordsOf(label.text))) label.visible = true;
  return label;
}

/** A text's words, folded (invisibles deleted, diacritics and case folded) and split at anything but a letter or a
 *  digit. */
function wordsOf(text: string): string[] {
  return foldLetters(removeInvisibles(text)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
}

/** Whether `words` holds `wanted` as one run of whole words, and `wanted` has at least MIN_ARIA_LABEL_CHARS letters
 *  or digits. */
function containsWords(words: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.join('').length < MIN_ARIA_LABEL_CHARS) return false;
  for (let at = 0; at + wanted.length <= words.length; at += 1) {
    if (wanted.every((word, i) => words[at + i] === word)) return true;
  }
  return false;
}

/** Whether `el` is a control the scanner could make a field of (or an auth field). Buttons are not. */
function isFieldControl(el: Element): boolean {
  const kind = kindOf(el);
  return kind.field || kind.auth;
}

/**
 * The field container of a control: the outermost ancestor that holds no other field control (buttons do not
 * count). Null when even the parent holds another control.
 */
export function fieldContainer(control: Element): Element | null {
  let container: Element | null = null;
  for (let at = control.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'body' || at.localName === 'html' || at.localName === 'form') break;
    const others = Array.from(at.querySelectorAll(CONTROL_SELECTOR))
      .some((other) => other !== control && isFieldControl(other));
    if (others) break;
    container = at;
  }
  return container;
}
