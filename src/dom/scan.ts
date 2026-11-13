/*
 * The scanner (docs/design/runtime.md §5; docs/ARCHITECTURE.md "Scanner"): a frame's form root becomes the FieldSpecs
 * the planner reads, built only from what a person can see.
 * - Every native control is judged by isUserVisible. A hidden radio, checkbox or file input may still be a field
 *   through the proxy rule; any other hidden control is a honeypot and is only counted (hiddenControlsIgnored).
 * - A visible control with no visible label, visible placeholder or adapter label is still reported, with
 *   labelSource 'none', so the planner can skip it as no-visible-label (a visible honeypot marked autocomplete="email"
 *   included).
 * - Password and one-time-code controls are never fields; they mean the step is an auth pause.
 * - ARIA widgets (Phase 4, widgets/aria.ts: standard ARIA only): a combobox (a text input with role="combobox", as
 *   react-select draws one, or any other element with that role), a multiselect (a combobox whose list takes several,
 *   or a listbox of its own with aria-multiselectable), a radio group of role="radio" members, and a Yes/No group of
 *   toggle buttons (aria-pressed). So is a control the adapter declares a widget for (widgetFor), as the declared
 *   kind. A widget is never grouped and gets its labels by the same visible-label rules. Its options are 'lazy'
 *   (option-set hash 'lazy') until it is opened, unless its list is already shown whole; once the run has opened it
 *   (the loop's waiting path), ScanOptions.widgetReadings gives the field what it read, by base key, and the key
 *   carries their hash; a combobox read as a remote search is a 'typeahead-remote' with no options (hash 'none'). s2
 *   lists: a combobox its adapter names a stored list for (WidgetDecl.storedList, the list given by
 *   ScanOptions.storedLists), or a select-only dropdown drawn whole whose list this host showed before
 *   (ScanOptions.learnedLists), takes that list as its options while the run
 *   has no reading of it, so it is planned on the first pass (widgets/known.ts). A
 *   group's options are its members. A native control inside a widget's list, or the text box inside an ARIA 1.1
 *   combobox, is part of the widget and never a field of its own. Only the widget helpers (widgets/) write a widget.
 * - An adapter may name more widget candidates (widgetRoots: Ashby's Yes/No, a div of toggle buttons beside a hidden
 *   checkbox), each asked of widgetFor as any candidate is; the native controls a declaration names as its own (its
 *   parts: the Yes/No's display:none checkbox), inside its element, are that widget's and never fields. It may name
 *   parts of the form root that hold none of the application's questions (excluded: Ashby's "Autofill from resume"
 *   uploader): nothing inside one, an open shadow root of it included, is a field or a flagged upload row. Both are
 *   still counted among the hidden controls ignored. The generic adapter names neither, so no trap page changes.
 * - What an adapter reads where no attribute says it: a group's question (labelFor, on a fieldset no legend names),
 *   which also lets a fieldset of checkboxes it labels be one checkbox group; a mark drawn after a label (requiredFor);
 *   help text no aria-describedby names (descriptionFor); a date box's layout (formatFor); whether an opacity-0 radio or
 *   checkbox shows chosen (checkedOf, kept on the field's target for the fillers' read-back).
 * - s2 wd: a date its page draws in parts, each a hidden control behind the digits it displays, is one field of kind
 *   'date' where its adapter declares it (Adapter.dateFor: Workday's date input), its control the element around the
 *   parts (FieldTarget.dateParts), its layout the parts', what it holds the parts' displays (fillers/date-parts.ts); the
 *   parts' controls are still hidden ones the scan ignored.
 * - v5 p2-fill: a rich-text box, an editing host by the HTML standard (kinds.ts isEditingHost: contenteditable "",
 *   "true" or "plaintext-only", editable now, its parent not), is a text field of its own ('textarea', or 'text' where
 *   it says aria-multiline="false"), labelled and judged visible by the same rules, its text what it shows
 *   (values.ts editableVisibleText, v5 p2-fill review: only the text a person can see of it, by visibleText's rules;
 *   innerText is our own write's read-back alone); one a person cannot see is a honeypot, only counted; an editable element inside another
 *   box is that box's content. Nothing but the standard attribute is read.
 * - v5 p2-fill: a résumé control its adapter declares to open the site's own file picker (Adapter.uploadPickers: a
 *   button with no file input in the form) is a 'file' field of its own while a person can see it, its target marked
 *   `picker`, holding nothing the scan can read; its file goes in through the page's own picker (fillers/picker.ts).
 * - jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a widget its adapter declares a box of several answers
 *   (WidgetDecl.tags: Workday's Skills prompt, UltiPro's review Skills) is one field of kind 'text' with no options,
 *   holding what its text box holds (widgets/tag-chips.ts); its chips are the tags filler's to read.
 * - Keys come from the core's keys.ts (labelSlug, optionSetHash, assignOrdinals, baseKey, fieldKey), so the worker and
 *   every frame build the same strings.
 * - A field's element is never cached across a write: ScanResult.rescan() scans afresh and target(key) finds the
 *   field's live elements in that scan.
 */
import type { Adapter, DatePartsDecl, WidgetDecl } from '../adapters/types';
import type { FieldFormat, FieldKind, FieldVisibility, Platform } from '../core/enums';
import { statesNoAiUse } from '../core/resolver/classifyRules';
import { assignOrdinals, baseKey, fieldKey, labelSlug, OPTION_SET_LAZY, OPTION_SET_NONE } from '../core/text/keys';
import { capCodePoints } from '../core/text/fold';
import type { BaseKey, Constraints, CurrentValue, FieldKey, FieldSpec, Option, SectionRef } from '../core/types/field';
import { isControlCamouflaged } from './camouflage';
import { composedOrder, holdsComposed } from './composed';
import { constraintsOf } from './constraints';
import { datePartsValue, formatOfParts } from './fillers/date-parts';
import {
  ariaReadOnly, autocompleteTokens, CONTROL_SELECTOR, EDITABLE_SELECTOR, editableKind, inputModeFormatOf, isDisabled,
  isEditingHost, isReadOnly, isTextLike, kindOf, typeFormatOf, type NativeKind,
} from './kinds';
import {
  adapterLabelOf, descriptionOf, labelOfControl, labelOfGroup, legendOf, optionLabelOf, type LabelContext,
  type ResolvedLabel,
} from './labels';
import { hashOfOptions, isUsableOption } from './option-hash';
import { isInOwnUi } from './own-ui';
import { isCaptchaResponseField } from './pause-detect';
import { proxyOf, type Proxy, unrecognisedUploadControl } from './proxy';
import { markShownByBox } from './box-shown';
import { newScanCache, styleOf, type ScanCache } from './scan-cache';
import { sectionFinder } from './sections';
import {
  MAX_AUTOCOMPLETE_TOKENS, MAX_SCAN_FIELDS, MAX_WIDGET_OPTIONS, MIN_BOX_PX, MIN_OPACITY, TEXT_CAP_ATTRIBUTE,
  TEXT_CAP_AUTOCOMPLETE_TOKEN, TEXT_CAP_LABEL, TEXT_CAP_PATTERN,
} from './thresholds';
import type {
  DatePartsTarget, FieldTarget, ScanCounters, ScannedField, ScanResult, UnrecognisedUpload, WidgetKind, WidgetReading,
  WidgetTarget,
} from './types';
import { currentValueOf, type SelectableOption } from './values';
import { readSelectOptions, visiblePlaceholder, visibleText, type VisibleOption } from './visible-text';
import { isSubtreeHidden, isUserVisible, visibilityOf, type VisibilityVerdict } from './visibility';
import {
  ariaWidgetKind, editableOf, isChosen, isMultiselectable, isUnavailable, isWidgetPart, listOf, membersOf, roleOf,
  WIDGET_ROOT_SELECTOR, widgetListOf,
} from './widgets/aria';
import { keepReading } from './widgets/fill';
import { learnable, learnedListKey } from './widgets/known';
import { declaredTags, tagsBoxValue } from './widgets/tag-chips';
import type { StoredListId } from '../shared/learned-lists';
import { chosenLabels, memberLabel, readShownList, scrolls } from './widgets/options';

/** What a scan needs besides the root and the adapter. */
export interface ScanOptions {
  /** The platform of the frame's host (shared/hosts.ts), even when the generic adapter handles the page. */
  platform: Platform;
  /** The frame's id, as the worker knows it; 0 for the top frame. */
  frameId?: number;
  /**
   * The controls the extension wrote into while a visible placeholder showed, each with that placeholder's text. A
   * value hides a placeholder, so a field it labelled (or made fillable, beside an aria-label) would lose its label,
   * and its key, to our own write, and the read-back after the settle would not find it. In this map it keeps that
   * label (heldPlaceholder), while the page still shows the same text (DOM-7); the pass adds a control as it writes
   * it, and its rescans, which reuse these options, see it. A node the page replaces is not in it.
   */
  heldPlaceholders?: WeakMap<Element, string>;
  /**
   * What the run has read of its lazy widgets, by their fields' base keys (Phase 4): the loop's waiting path opens a
   * widget the planner needs the options of and keeps what it showed here, and a scan that sees a widget's list shown
   * whole keeps that too. A widget with a reading is given its options (and the key their hash) while its list is
   * closed.
   */
  widgetReadings?: Map<BaseKey, WidgetReading>;
  // ── s2 lists ──
  /** The lists this host's dropdowns showed the run before (background/learned-lists.ts, by their label slug's key,
   *  widgets/known.ts learnedListKey): a select-only dropdown its adapter draws whole (WidgetDecl.drawnWhole) and
   *  stores no list for is given the list learned for its label as its options while nothing of this run replaces
   *  them, so it is planned on the first pass; its choice opens it once and checks the planned option at its place
   *  (widgets/fill.ts chooseKnown). Option labels only. */
  learnedLists?: ReadonlyMap<string, readonly string[]>;
  /** The stored lists the worker served the run (lists/known, background/stored-lists.ts), by id: a combobox whose
   *  adapter names one (WidgetDecl.storedList) is given it as its options while nothing of this run replaces them. A
   *  list not given leaves the widget lazy, as before. Option labels only. */
  storedLists?: ReadonlyMap<StoredListId, readonly string[]>;
}

/** A control that may become (part of) a field. */
interface Candidate {
  el: Element;
  /** Its native kind, or the kind of the widget the adapter declares for it. */
  kind: NativeKind | FieldKind;
  format: FieldFormat | undefined;
  visibility: FieldVisibility;
  proxy: Proxy | null;
  /** The adapter declared a widget for this control (widgetFor): it is its own field, of the declared kind. */
  declared: boolean;
  /** An ARIA widget's parts, or the declared widget's: it is its own field, never grouped. */
  widget: WidgetTarget | null;
  /** s2 wd: a date drawn in parts its adapter declares (Adapter.dateFor): its own field of kind 'date'. */
  dateParts?: DatePartsTarget;
  /** v5 p2-fill: a résumé control that opens the site's own file picker (Adapter.uploadPickers): a file field. */
  picker?: true;
}

/** A field before its key: one control, or a radio or checkbox group. */
interface Draft {
  kind: FieldKind;
  control: Element;
  members: HTMLInputElement[];
  selectOptions: HTMLOptionElement[];
  container: Element | null;
  label: ResolvedLabel;
  /** null for a kind without options; 'lazy' for a combobox, whose options exist only once it is opened. */
  options: Option[] | 'lazy' | null;
  selectable: SelectableOption[];
  section: SectionRef;
  description: string;
  constraints: Constraints;
  visibility: FieldVisibility;
  proxy: Proxy | null;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  camouflaged: boolean;
  nameAttr: string;
  idAttr: string;
  autocomplete: string[];
  /** An ARIA or declared widget's parts. */
  widget: WidgetTarget | null;
  /** A widget's options were read only in part: a cap stopped the read before the list's end. */
  optionsPartial?: true;
  /** s2 wd: a date drawn in parts (Candidate.dateParts). */
  dateParts?: DatePartsTarget;
  /** v5 p2-fill: a résumé control that opens the site's own file picker (Candidate.picker). */
  picker?: true;
}

/** Scans a frame's form root. */
export function scan(root: Element, adapter: Adapter | null, options: ScanOptions): ScanResult {
  const cache = newScanCache();
  const ctx: LabelContext = { cache, adapter, root,
    ...(options.heldPlaceholders ? { heldPlaceholders: options.heldPlaceholders } : {}) };
  const counters: ScanCounters = { hiddenControlsIgnored: 0, deferredFields: 0 };
  let authFields = 0;
  const candidates: Candidate[] = [];
  const unrecognised: Array<{ input: HTMLInputElement; control: Element }> = [];

  const excluded = adapterParts(adapter?.excluded, root);
  const outside = (el: Element) => excluded.some((part) => holdsComposed(part, el));
  const extraRoots = adapterParts(adapter?.widgetRoots, root).filter((el) => !outside(el));
  // v5 p2-fill: the résumé controls that open the site's own file picker, as its adapter declares them.
  const pickers = new Set(adapterParts(adapter?.uploadPickers, root).filter((el) => !outside(el)));
  const collected = collectFields(root);
  const all = extraRoots.length === 0 && pickers.size === 0 ? collected
    : inDocumentOrder([...collected, ...extraRoots, ...pickers]);
  // jr6 ENGINE E1 (FIXPLAN §6.2 items 2 and 4): every declaration read once, before any control is judged, so what a
  // declaration names as its widget's own is known wherever it stands in the page (declarationsOf):
  // - the native controls it names as its parts (WidgetDecl.parts: the Yes/No's display:none checkbox; ADP's lists'
  //   filter box in its shadow tree), inside its element across shadow roots, never fields, counted among the hidden
  //   controls the scan ignored, as before for a widget root's;
  // - the text box it declares (WidgetDecl.input), beside its element (iCIMS's search box, "— Type to Search —", in the
  //   container its anchor opens) or inside it across shadow roots (a host whose box sits in a nested shadow tree, which
  //   no light-DOM rule makes its part): the widget's part, never a field nor a control the scan counts.
  const declarations = declarationsOf(all, adapter, pickers);
  const absorbed = new Set<Element>();
  const boxes = new Set<Element>();
  for (const [el, declared] of declarations) {
    if (declared === null || outside(el)) continue;
    for (const part of declared.parts ?? []) {
      if (part !== el && holdsComposed(el, part) && part.matches(CONTROL_SELECTOR)) absorbed.add(part);
    }
    const box = declaredBox(el, declared);
    if (box !== null && box !== el) boxes.add(box);
  }
  const found = excluded.length === 0 && absorbed.size === 0 && boxes.size === 0 ? all : all.filter((el) => {
    if (boxes.has(el)) return false;
    if (!outside(el) && !absorbed.has(el)) return true;
    // A control the adapter keeps out of the fields is still one the scan ignored.
    if (el.matches(CONTROL_SELECTOR) && kindOf(el, adapter).field) counters.hiddenControlsIgnored += 1;
    return false;
  });
  // Every combobox's list, so a listbox that is one is not taken for a field of its own (jr6 ENGINE E1: a declared box's
  // too, though the box itself is no field).
  const lists = new Set([...found, ...boxes].filter((el) => roleOf(el) === 'combobox').map((el) => listOf(el))
    .filter((list): list is Element => list !== null));
  for (const el of found) {
    // v5 p2-fill: a declared picker control a person can see is a file field; one they cannot is none.
    if (pickers.has(el)) {
      const shown = visibilityOf(el, cache);
      if (shown.visible) {
        candidates.push({ el, kind: 'file', format: undefined, visibility: 'visible', proxy: null, declared: true,
          widget: null, picker: true });
      } else if (shown.deferred) counters.deferredFields += 1;
      continue;
    }
    const native = el.matches(CONTROL_SELECTOR);
    // A native control inside a widget's list, or an ARIA 1.1 combobox's text box, is that widget's.
    if (native && isWidgetPart(el)) continue;
    // The behaviour review of 2026-11-06 (M6): a CAPTCHA vendor's response field is the widget's, shown or not (a fill
    // now goes on beside a checkbox widget): never a field. A field kind is counted with the hidden controls ignored, as
    // it was while hidden (Turnstile's hidden input never was).
    if (native && isCaptchaResponseField(el)) {
      if (kindOf(el, adapter).field) counters.hiddenControlsIgnored += 1;
      continue;
    }
    // jr7 ENGINE-7 E1 item 4 (EFA-3): read with the adapter, whose notCodeBox may name a one-time-code box no code box.
    const kind = native ? kindOf(el, adapter) : { field: false as const, auth: false };
    if (native && !kind.field) {
      if (kind.auth && isUserVisible(el, cache)) authFields += 1;
      continue;
    }
    // A widget the adapter declares for this control (Lever's location search on its text input) is reported as that
    // widget, never as the native control it is built on; else an ARIA widget, by its role (widgets/aria.ts). jr6
    // ENGINE E1: as the declarations read before the loop found it (declarationsOf).
    const cached = declarations.get(el);
    const declared = cached !== undefined ? cached : adapter?.widgetFor?.(el) ?? null;
    const aria = declared !== null ? null : !native || (kind.field && kind.kind === 'combobox')
      ? ariaWidgetKind(el, lists) : null;
    // s2 wd: a date drawn in parts its adapter declares (Adapter.dateFor: Workday's dateInputWrapper), one field of kind
    // 'date' whose control is the element around its parts; its parts' own controls stay hidden ones, counted below.
    const dated = !native && declared === null && aria === null ? datePartsOf(el, adapter) : null;
    if (dated !== null) {
      const shown = visibilityOf(el, cache);
      if (shown.visible) {
        candidates.push({ el, kind: 'date', format: formatOfParts(dated.parts), visibility: 'visible', proxy: null,
          declared: true, widget: null, dateParts: dated });
      } else if (shown.deferred) counters.deferredFields += 1;
      continue;
    }
    // v5 p2-fill: a rich-text box (an editing host by the HTML standard: kinds.ts isEditingHost) is a text field of its
    // own, judged by the same visibility rules; one a person cannot see is a honeypot, only counted (never a proxy).
    if (!native && declared === null && aria === null && isEditingHost(el)) {
      const shown = visibilityOf(el, cache);
      if (shown.visible) {
        candidates.push({ el, kind: editableKind(el), format: undefined, visibility: 'visible', proxy: null,
          declared: false, widget: null });
      } else if (shown.deferred) counters.deferredFields += 1;
      else counters.hiddenControlsIgnored += 1;
      continue;
    }
    if (!native && declared === null && aria === null) continue;
    const widget = declared !== null ? anatomyOf(el, declared.kind as WidgetKind, declared, options.storedLists)
      : aria !== null ? anatomyOf(el, aria, null) : null;
    const verdict = widgetVisibility(el, declared, cache);
    if (!native) {
      // An ARIA widget a person cannot see is no field, and no native control to count.
      if (verdict.visible && widget !== null) {
        candidates.push({ el, kind: widget.kind, format: undefined, visibility: 'visible', proxy: null,
          declared: declared !== null, widget });
      } else if (verdict.deferred) counters.deferredFields += 1;
      continue;
    }
    if (!kind.field) continue;
    if (el.localName === 'select') markShownByBox(el, false); // jr7 ENGINE-7 E1 item 1: set afresh by this scan
    if (verdict.visible) {
      candidates.push({ el, kind: widget?.kind ?? kind.kind, format: widget === null ? kind.format : undefined,
        visibility: 'visible', proxy: null, declared: declared !== null, widget });
      continue;
    }
    if (verdict.deferred) {
      counters.deferredFields += 1;
      continue;
    }
    // jr7 ENGINE-7 E1 item 1 (UKGR-6): a native select hidden only by its own opacity, inside the box its adapter
    // declares around it (Adapter.controlBox), which a person can see, is that select shown: written natively, read
    // back by its value (selectInDeclaredBox).
    const boxed = widget === null && (kind.kind === 'select' || kind.kind === 'multiselect')
      && selectInDeclaredBox(el, adapter, cache);
    markShownByBox(el, boxed); // dom/box-shown.ts: its options read as a shown select's
    if (boxed) {
      candidates.push({ el, kind: kind.kind, format: kind.format, visibility: 'visible', proxy: null, declared: false,
        widget: null });
      continue;
    }
    if (widget === null && (kind.kind === 'radio' || kind.kind === 'checkbox' || kind.kind === 'file')) {
      const input = el as HTMLInputElement;
      const proxy = proxyOf(input, adapter, root, cache);
      if (proxy !== null) {
        candidates.push({ el, kind: kind.kind, format: kind.format, proxy, declared: false, widget: null,
          visibility: kind.kind === 'file' ? 'hidden-file-with-visible-control' : 'hidden-native-with-visible-label' });
        continue;
      }
      if (kind.kind === 'file') {
        const control = unrecognisedUploadControl(input, cache);
        if (control !== null) unrecognised.push({ input, control });
      }
    }
    counters.hiddenControlsIgnored += 1;
  }

  const sections = sectionFinder(root, adapter, cache);
  const drafts = group(candidates, root, ctx).map((entry) => draftOf(entry, ctx, cache, sections));
  const checkedOf = checkedReader(adapter);
  const truncated = drafts.length > MAX_SCAN_FIELDS;
  const kept = drafts.slice(0, MAX_SCAN_FIELDS);
  const frameId = options.frameId ?? 0;
  const slugs = kept.map((draft) => labelSlug({ label: draft.label.text, kind: draft.kind, nameAttr: draft.nameAttr,
    idAttr: draft.idAttr }));
  const ordinals = assignOrdinals(kept.map((draft, i) => ({ platform: options.platform, section: draft.section,
    labelSlug: slugs[i]! })));
  const targets = new Map<FieldKey, FieldTarget>();
  const fields = kept.map((scanned, i): ScannedField => {
    const parts = { platform: options.platform, section: scanned.section, labelSlug: slugs[i]!, ordinal: ordinals[i]! };
    const base = baseKey(parts);
    const learned = scanned.widget !== null && options.learnedLists !== undefined && learnable(scanned.widget)
      ? options.learnedLists.get(learnedListKey(slugs[i]!, scanned.widget.learnContext)) : undefined;
    // jr6 ENGINE E3: a box of several answers is no list: nothing the run read of a list is its.
    const draft = scanned.widget === null || scanned.widget.tags !== undefined ? scanned
      : withReading(scanned, base, options.widgetReadings, learned);
    const optionSetHash = draft.options === null ? OPTION_SET_NONE : draft.options === 'lazy' ? OPTION_SET_LAZY
      : draft.kind === 'typeahead-remote' && draft.options.length === 0 ? OPTION_SET_NONE
        : hashOfOptions(draft.options.map((option) => option.label));
    const key = fieldKey({ ...parts, optionSetHash });
    // v5 p2-fill: a picker control holds no file the scan can read (the page's own input is made at its press).
    const current: CurrentValue = draft.widget !== null ? widgetCurrent(draft, cache)
      : draft.dateParts !== undefined ? datePartsValue(draft.dateParts)
        : draft.picker === true ? { kind: 'empty' }
          : heldFile(draft.kind, draft.control, adapter, currentValueOf(draft.kind, draft.control, draft.selectable,
            checkedOf));
    const field: ScannedField = {
      key, baseKey: base, platform: options.platform, section: draft.section, kind: draft.kind,
      label: draft.label.text, labelSource: draft.label.source, labelVisible: draft.label.visible,
      description: draft.description, required: draft.required, options: draft.options ?? [], optionSetHash,
      ...(draft.optionsPartial ? { optionsPartial: true as const } : {}),
      // The core pass of 2026-11-06: an "I did not use AI" statement past the label's 300 characters (Dropzone's).
      // jr6 ifix C-1 (SR-3, RULES item 22, RULES' hand-off edit 2): read with the field's kind, so "in your own words"
      // over a box of prose is an instruction here too; only a box or a choice affirms it.
      ...(draft.label.whole !== undefined
        && statesNoAiUse({ label: draft.label.whole, description: '', kind: draft.kind })
        ? { statesNoAi: true as const } : {}),
      constraints: draft.constraints, autocomplete: draft.autocomplete, nameAttr: draft.nameAttr, idAttr: draft.idAttr,
      ordinal: ordinals[i]!, domOrder: i, visibility: draft.visibility, disabled: draft.disabled,
      readOnly: draft.readOnly, current,
      el: { key, frameId }, proxy: draft.proxy?.kind ?? null, camouflaged: draft.camouflaged,
    };
    targets.set(key, { field, control: draft.control, members: draft.members, options: draft.selectOptions,
      proxy: draft.proxy?.el ?? null, ...(draft.widget !== null ? { widget: draft.widget } : {}),
      ...(adapter?.checkedOf !== undefined ? { checkedOf } : {}),
      ...(draft.dateParts !== undefined ? { dateParts: draft.dateParts } : {}),
      ...(draft.picker === true ? { picker: true as const } : {}) });
    return field;
  });

  return {
    fields,
    counters,
    authFields,
    truncated,
    unrecognisedUploads: unrecognisedRows(unrecognised, fields, ctx, sections, options.platform),
    target: (key) => {
      const found = targets.get(key) ?? null;
      return found !== null && found.control.isConnected ? found : null;
    },
    rescan: () => scan(root, adapter, options),
    adapter, // jr7 ENGINE-7 E1 item 4
  };
}

/** Scans `root` afresh and returns the live elements of the field with this key, or null. */
export function findField(root: Element, adapter: Adapter | null, options: ScanOptions, key: FieldKey):
  FieldTarget | null {
  return scan(root, adapter, options).target(key);
}

/** The field's FieldSpec as the worker receives it: the DOM-only parts (the handle, the proxy and the camouflage flag)
 *  left out, so it passes the strict plan/request schema. Whether a visible source names the field (labelVisible)
 *  goes with it: the worker plans no write for a field the frame would refuse as no-visible-label, and never fetches
 *  the sensitive part for one. */
export function toFieldSpec(field: ScannedField): FieldSpec {
  return {
    key: field.key, baseKey: field.baseKey, platform: field.platform, section: field.section, kind: field.kind,
    label: field.label, labelSource: field.labelSource, labelVisible: field.labelVisible,
    description: field.description, required: field.required,
    options: field.options, optionSetHash: field.optionSetHash, constraints: field.constraints,
    autocomplete: field.autocomplete, nameAttr: field.nameAttr, idAttr: field.idAttr, ordinal: field.ordinal,
    domOrder: field.domOrder, visibility: field.visibility, disabled: field.disabled, readOnly: field.readOnly,
    current: field.current, ...(field.optionsPartial ? { optionsPartial: true as const } : {}),
    ...(field.statesNoAi === true ? { statesNoAi: true as const } : {}),
  };
}

/** How many field controls in `root` a person can see: the generic adapter picks the form with the most. */
export function countVisibleControls(root: Element, cache: ScanCache = newScanCache()): number {
  return collectControls(root).filter((el) => kindOf(el).field && isUserVisible(el, cache)).length;
}

// ── Collecting and grouping ──────────────────────────────────────────────────────────────────────────────────────

/** Every element under `root` matching `selector`, in document order, open shadow roots included, the extension's UI
 *  excluded. */
function collect(root: Element, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (scope: Element | ShadowRoot) => {
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  if (root.matches(selector)) found.push(root);
  if (root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return found.filter((el) => !isInOwnUi(el));
}

/** Every native control under `root`. */
function collectControls(root: Element): Element[] {
  return collect(root, CONTROL_SELECTOR);
}

/** Every native control and every element that may be an ARIA widget's (widgets/aria.ts) or (v5 p2-fill) a rich-text
 *  box (kinds.ts EDITABLE_SELECTOR), in document order. */
function collectFields(root: Element): Element[] {
  return collect(root, `${CONTROL_SELECTOR}, ${WIDGET_ROOT_SELECTOR}, ${EDITABLE_SELECTOR}`);
}

/** The elements an adapter's hook names inside the form root (its widget roots, its excluded parts), the extension's
 *  own UI left out; none when it names none or its hook fails. Inside counts across open shadow roots, as the scan's
 *  own collection reads them (the core pass of 2026-11-06: SmartRecruiters' screening Yes/No groups, spl-radio-group in
 *  sr-screening-questions-form's shadow root, fixtures/smartrecruiters/xplor-screening.html; Node.contains stops at a
 *  shadow root). */
function adapterParts(hook: ((root: Element) => Element[]) | undefined, root: Element): Element[] {
  if (hook === undefined) return [];
  let parts: Element[];
  try {
    parts = hook(root);
  } catch {
    return [];
  }
  return [...new Set(parts)].filter((el) => holdsComposed(root, el) && !isInOwnUi(el));
}

/** Elements without repeats, in document order: the order collect() reads them in, open shadow roots included (a
 *  host, then its shadow tree, then its own children). compareDocumentPosition orders nodes of two trees by no rule,
 *  so it is used only between nodes of one tree (the core pass of 2026-11-06: a widget root in a shadow root;
 *  holdsComposed and composedOrder live in ./composed since core pass Z2, shared with the section finder). */
function inDocumentOrder(elements: readonly Element[]): Element[] {
  return [...new Set(elements)].sort(composedOrder);
}

/** Whether a native radio or checkbox shows chosen: as its adapter reads it (checkedOf), else its own checked. A hook
 *  that fails reads as the input's own state. */
export function checkedReader(adapter: Adapter | null): (input: HTMLInputElement) => boolean {
  return (input) => {
    let shown: boolean | null | undefined;
    try {
      shown = adapter?.checkedOf?.(input);
    } catch {
      shown = null;
    }
    return typeof shown === 'boolean' ? shown : input.checked;
  };
}

interface Entry {
  kind: FieldKind;
  members: Candidate[];
  container: Element | null;
}

/**
 * Radios are grouped by form and name (nameless ones by their fieldset or radiogroup). Checkboxes form a group when
 * two or more share a form and name, or when two or more sit in one fieldset (or role=group) that has a label and
 * holds no other kind of field; any other checkbox is a lone checkbox. A fieldset with no legend that its adapter
 * labels groups its own boxes before any name does, and makes its only box a lone checkbox (Ashby's). Each group sits
 * at its first member's place. DESIGN-NEW-ATS Phase 0: the element the adapter names one question's group
 * (Adapter.groupOf: JazzHR's div.form-group around two Yes/No boxes with different names) stands where a fieldset
 * would, for a checkbox or a nameless radio, before any fieldset or group around it.
 */
function group(candidates: readonly Candidate[], root: Element, ctx: LabelContext): Entry[] {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const ids = new Map<object | null, number>();
  const idOf = (item: object | null) => {
    if (!ids.has(item)) ids.set(item, ids.size);
    return ids.get(item)!;
  };
  // Workday's snapshots of 2026-11-06 (src/adapters/workday): each Work Experience block's "I currently work here" is
  // a lone box named currentlyWorkHere, the same name in every block and no form: boxes that share a name are one
  // question only inside one repeatable block (or outside them all).
  const blockOf = repeatableBlockOf(root, ctx.adapter);
  const nameCount = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'checkbox' || candidate.widget !== null) continue;
    const input = candidate.el as HTMLInputElement;
    if (input.name === '') continue;
    const id = `${idOf(input.form)}|${blockOf(input)}|${input.name}`;
    nameCount.set(id, (nameCount.get(id) ?? 0) + 1);
  }
  const boxContainers = new Map<Element, number>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'checkbox' || candidate.widget !== null) continue;
    const container = checkboxContainer(candidate.el, root, ctx);
    if (container !== null) boxContainers.set(container, (boxContainers.get(container) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    const input = candidate.el as HTMLInputElement;
    let id: string | null = null;
    let kind: FieldKind = candidate.kind;
    if (candidate.widget !== null) {
      // A widget, declared or ARIA, is never grouped: it is its own field.
      entries.push({ kind, members: [candidate], container: null });
      continue;
    }
    if (candidate.kind === 'radio') {
      const box = input.name !== '' ? null
        : adapterGroupOf(input, root, ctx) ?? input.closest('fieldset, [role="radiogroup"]');
      id = input.name !== '' ? `radio|${idOf(input.form)}|${input.name}` : `radio-box|${idOf(box)}`;
      if (input.name === '' && box === null) id = null;
    } else if (candidate.kind === 'checkbox') {
      const named = input.name === '' ? 0 : nameCount.get(`${idOf(input.form)}|${blockOf(input)}|${input.name}`) ?? 0;
      const container = checkboxContainer(input, root, ctx);
      const boxed = container !== null && (boxContainers.get(container) ?? 0) >= 2;
      // A fieldset its adapter labels is one question, whatever its boxes are named, and its only box a question of
      // its own: Ashby names each box by its option's label, so one "Prefer not to say" in each of three questions, or
      // one "I agree" in each of two one-box questions, with no form, would be one name.
      if (container !== null && legendOf(container) === null && adapterLabelOf(container, ctx) !== null) {
        id = boxed ? `checkbox-box|${idOf(container)}` : null;
      } else if (named >= 2) id = `checkbox|${idOf(input.form)}|${blockOf(input)}|${input.name}`;
      else if (boxed) id = `checkbox-box|${idOf(container)}`;
      kind = id === null ? 'checkbox' : 'checkbox-group';
    }
    if (id === null) {
      entries.push({ kind, members: [candidate], container: null });
      continue;
    }
    const existing = byKey.get(id);
    if (existing) {
      existing.members.push(candidate);
      continue;
    }
    const entry: Entry = { kind, members: [candidate], container: null };
    byKey.set(id, entry);
    entries.push(entry);
  }
  for (const entry of entries) {
    if (entry.kind === 'radio' || entry.kind === 'checkbox-group') entry.container = groupContainer(entry.members, root, ctx);
  }
  return entries;
}

/** Which of the adapter's repeatable blocks holds an element, as "<kind>:<index>", '' outside them all (or when the
 *  adapter names none or its hook fails): checkboxes that share a name group only inside one block (group()). */
function repeatableBlockOf(root: Element, adapter: Adapter | null): (el: Element) => string {
  let blocks: Array<{ kind: string; el: Element; index: number }> = [];
  try {
    blocks = (adapter?.repeatables?.(root) ?? []).flatMap((section) => section.blocks()
      .map((el, index) => ({ kind: section.kind, el, index })));
  } catch {
    blocks = [];
  }
  if (blocks.length === 0) return () => '';
  return (el) => {
    const block = blocks.find((each) => each.el.contains(el));
    return block === undefined ? '' : `${block.kind}:${block.index}`;
  };
}

/** The element the adapter names a control's group (Adapter.groupOf), when it holds the control inside the form root;
 *  null without the hook, or where it names none (a hook that throws names none). */
function adapterGroupOf(control: Element, root: Element, ctx: LabelContext): Element | null {
  const adapter = ctx.adapter;
  if (adapter?.groupOf === undefined) return null;
  let found: Element | null;
  try {
    found = adapter.groupOf(control);
  } catch {
    found = null;
  }
  return found !== null && found !== control && found.contains(control) && root.contains(found) ? found : null;
}

/** The fieldset or role=group around a checkbox (or the element its adapter names its group: groupOf) that can hold a
 *  checkbox group: it has a label (its legend, an ARIA label, or the adapter's visible label for it: Ashby's question
 *  title) and holds no field of another kind. */
function checkboxContainer(input: Element, root: Element, ctx: LabelContext): Element | null {
  const container = adapterGroupOf(input, root, ctx) ?? input.closest('fieldset, [role="group"]');
  if (container === null || !root.contains(container)) return null;
  const labelled = legendOf(container) !== null || container.hasAttribute('aria-labelledby')
    || container.hasAttribute('aria-label') || adapterLabelOf(container, ctx) !== null;
  if (!labelled) return null;
  const fields = Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter((el) => kindOf(el).field);
  return fields.every((el) => el.localName === 'input' && (el as HTMLInputElement).type === 'checkbox') ? container : null;
}

/** The element the adapter names the group's (groupOf) when it holds every member, else the nearest fieldset,
 *  radiogroup or group that does, inside the form root. */
function groupContainer(members: readonly Candidate[], root: Element, ctx: LabelContext): Element | null {
  const first = members[0]?.el;
  if (first === undefined) return null;
  const declared = adapterGroupOf(first, root, ctx);
  if (declared !== null && members.every((member) => declared.contains(member.el))) return declared;
  for (let at = first.closest('fieldset, [role="radiogroup"], [role="group"]'); at !== null;
    at = at.parentElement?.closest('fieldset, [role="radiogroup"], [role="group"]') ?? null) {
    if (!root.contains(at) && at !== root) return null;
    if (members.every((member) => at!.contains(member.el))) return at;
  }
  return null;
}

// ── Building a field ─────────────────────────────────────────────────────────────────────────────────────────────

function draftOf(entry: Entry, ctx: LabelContext, cache: ScanCache, sections: ReturnType<typeof sectionFinder>):
  Draft {
  const first = entry.members[0]!;
  const control = first.el;
  if (first.widget !== null) return widgetDraft(first, first.widget, ctx, cache, sections);
  if (entry.kind === 'radio' || entry.kind === 'checkbox-group') {
    return groupDraft(entry, ctx, sections);
  }
  const label = labelOfControl(control, ctx);
  const placeholder = isTextLike(control) ? visiblePlaceholder(control, cache) : null;
  let options: Option[] | 'lazy' | null = null;
  let selectable: SelectableOption[] = [];
  let selectOptions: HTMLOptionElement[] = [];
  if (entry.kind === 'select' || entry.kind === 'multiselect') {
    const read: VisibleOption[] = readSelectOptions(control as HTMLSelectElement, cache);
    options = read.map((option, index) => optionOf(index, option.label, option.value, option.disabled,
      option.selected, option.group));
    selectable = read.map((option) => ({ label: option.label, selected: option.selected }));
    selectOptions = read.map((option) => option.el);
  }
  const format = first.format;
  // s2 wd: a date drawn in parts (Candidate.dateParts) is required, disabled or read-only as its parts all are too.
  const parts = first.dateParts?.parts.map((part) => part.input) ?? [];
  return {
    kind: entry.kind, control, members: [], selectOptions, container: null, label, options, selectable,
    section: sections.sectionOf(control, label.element),
    description: descriptionOf(control, ctx),
    constraints: entry.kind === 'select' || entry.kind === 'multiselect' ? {}
      : withAdapterFormat(constraintsOf(control, format, placeholder), control, ctx.adapter),
    visibility: first.visibility, proxy: first.proxy,
    required: label.required || isRequired(control) || adapterRequires(control, ctx.adapter)
      || (parts.length > 0 && parts.every(isRequired)),
    disabled: isDisabled(control) || (parts.length > 0 && parts.every(isDisabled)),
    readOnly: isReadOnly(control) || (parts.length > 0 && parts.every(isReadOnly)),
    // jr6 ENGINE E2 (FIXPLAN §6.2 item 7, O4): the adapter's declared box (Adapter.controlBox) may draw it.
    camouflaged: first.visibility === 'visible'
      && isControlCamouflaged(control, placeholder !== null, cache, ctx.adapter),
    nameAttr: attribute(control, 'name'), idAttr: attribute(control, 'id'),
    autocomplete: autocompleteTokens(control).slice(0, MAX_AUTOCOMPLETE_TOKENS)
      .map((token) => capCodePoints(token, TEXT_CAP_AUTOCOMPLETE_TOKEN)),
    widget: null,
    ...(first.dateParts !== undefined ? { dateParts: first.dateParts } : {}),
    ...(first.picker === true ? { picker: true as const } : {}),
  };
}

/** s2 wd: the date drawn in parts the adapter declares for an element (Adapter.dateFor), each part a native input
 *  inside it, none the extension's own, in a layout formatOfParts names; null without the hook, for an element it
 *  declares none for, or when the hook fails. */
function datePartsOf(el: Element, adapter: Adapter | null): DatePartsTarget | null {
  let declared: DatePartsDecl | null | undefined;
  try {
    declared = adapter?.dateFor?.(el);
  } catch {
    declared = null;
  }
  if (declared === null || declared === undefined || declared.parts.length === 0) return null;
  const parts = declared.parts.filter((part) => part.input !== el && part.input.localName === 'input'
    && holdsComposed(el, part.input) && !isInOwnUi(part.input)
    && (part.display === null || holdsComposed(el, part.display)));
  if (parts.length !== declared.parts.length || formatOfParts(parts) === undefined) return null;
  return { parts: parts.map((part) => ({ part: part.part, input: part.input, display: part.display })),
    digits: declared.keys === 'digits', ...(declared.alert === undefined ? {} : { alert: declared.alert }) };
}

// ── Widgets (Phase 4) ────────────────────────────────────────────────────────────────────────────────────────────

/** jr6 ENGINE E1: the adapter's widget declaration of each element the scan's loop asks about (a native control that can
 *  be a field and is no widget's part nor a CAPTCHA's response field, or any other collected element; never a picker
 *  control), read once before the loop (scan: what a declaration names as its own must be known wherever it stands).
 *  Empty when the adapter declares no widgets. */
function declarationsOf(all: readonly Element[], adapter: Adapter | null, pickers: ReadonlySet<Element>):
  Map<Element, WidgetDecl | null> {
  const declarations = new Map<Element, WidgetDecl | null>();
  if (adapter?.widgetFor === undefined) return declarations;
  for (const el of all) {
    if (pickers.has(el)) continue;
    if (el.matches(CONTROL_SELECTOR) && (isWidgetPart(el) || isCaptchaResponseField(el) || !kindOf(el).field)) continue;
    declarations.set(el, adapter.widgetFor(el) ?? null);
  }
  return declarations;
}

/** jr6 ENGINE E1 (FIXPLAN §6.2 item 2): the text box a declaration names as its widget's own (WidgetDecl.input: iCIMS's
 *  search box beside its anchor), when it is one: a text input in the page, not the extension's own; else null. */
function declaredBox(el: Element, declared: WidgetDecl): HTMLInputElement | null {
  const box = declared.input;
  if (box === undefined || box === null || box.localName !== 'input' || !isTextLike(box)) return null;
  if (!box.isConnected || box.ownerDocument !== el.ownerDocument || isInOwnUi(box)) return null;
  return box;
}

/** jr6 ENGINE E1 (FIXPLAN §6.2 item 3, SR-1): the whole list a page publishes for its widget (WidgetDecl.knownOptions), as
 *  its field's options: page text, untrusted as every option label is, each cut to TEXT_CAP_LABEL and the list to
 *  MAX_WIDGET_OPTIONS; empty labels dropped. Undefined when it gives none. */
function pageList(declared: WidgetDecl | null): readonly string[] | undefined {
  const given = declared?.knownOptions;
  if (given === undefined || !Array.isArray(given)) return undefined;
  const labels = given.filter((label): label is string => typeof label === 'string')
    .map((label) => capCodePoints(label.replace(/\s+/g, ' ').trim(), TEXT_CAP_LABEL)).filter((label) => label !== '')
    .slice(0, MAX_WIDGET_OPTIONS);
  return labels.length > 0 ? labels : undefined;
}

/** A widget's parts as this scan finds them: by ARIA, or as the adapter declared them. */
function anatomyOf(el: Element, kind: WidgetKind, declared: WidgetDecl | null,
  storedLists?: ReadonlyMap<StoredListId, readonly string[]>): WidgetTarget {
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 3): the list the page publishes (WidgetDecl.knownOptions) is the field's reading at
  // scan time, before a stored list (the page's own word, given again on every run; ENGINE E0's handoff suggestion); a
  // combobox's or a multiselect's. A stored list is a combobox's only, as before.
  const page = kind === 'combobox' || kind === 'multiselect' ? pageList(declared) : undefined;
  const stored = page !== undefined || declared?.storedList === undefined || kind !== 'combobox' ? undefined
    : storedLists?.get(declared.storedList);
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 2): the text box its adapter declares (WidgetDecl.input), beside its element or in
  // it; else ARIA's (editableOf).
  const box = declared === null ? null : declaredBox(el, declared);
  // A group: an ARIA radio group or Yes/No group, or a 'radio' its adapter declares with its members, each inside its
  // element and none the extension's own. Inside counts across open shadow roots (core pass Z2 of 2026-11-06: ADP's
  // referral radios, sdf-radio-button[role=radio] in each wfn-radio-button's shadow root, fixtures/adp/questions.html;
  // Node.contains stops at a shadow root, as adapterParts' did).
  const group = kind === 'radio' && (declared === null || declared.members !== undefined);
  const members = declared?.members === undefined ? membersOf(el)
    : declared.members.filter((member) => member !== el && holdsComposed(el, member) && !isInOwnUi(member));
  return {
    kind, element: el, input: group ? null : box ?? editableOf(el),
    opener: group || roleOf(el) === 'listbox' ? null : declared?.opener ?? (el as HTMLElement),
    members: group ? [...members] : [], activation: declared?.activation ?? [],
    declared: declared !== null,
    ...(declared === null ? {} : { expanded: declared.expanded ?? null, box: declared.box ?? null,
      busy: declared.busy ?? [], bridge: declared.bridge ?? null, keys: declared.keys ?? [],
      ...(declared.keyTarget === 'list' ? { keyTarget: 'list' as const } : {}),
      ...(declared.readOnlyBox === true ? { readOnlyBox: true as const } : {}),
      ...(declared.listFollowsField === true ? { listFollowsField: true as const } : {}),
      ...(declared.shownAnswer ? { shownAnswer: declared.shownAnswer } : {}),
      ...(declared.hidesFormWhileOpen === true ? { hidesFormWhileOpen: true } : {}),
      ...(declared.optionLabel ? { optionLabel: declared.optionLabel } : {}),
      ...(declared.emptyAfterMs !== undefined ? { emptyAfterMs: declared.emptyAfterMs } : {}),
      ...(declared.highlightIsNoChoice === true ? { highlightIsNoChoice: true } : {}),
      // v4 (drop): a results list no ARIA names, and the key that starts a search. jr6 ENGINE E1: with its declared rows
      // (WidgetResults.options) and the element a choice presses (WidgetResults.pressTarget).
      ...(declared.results !== undefined ? { results: declared.results } : {}),
      ...(declared.queryKey !== undefined ? { queryKey: declared.queryKey } : {}),
      ...(declared.choosesOnQuery === true && kind === 'typeahead-remote' ? { choosesOnQuery: true as const } : {}), // jr8 WORKDAY
      // jr6 ENGINE E1 (FIXPLAN §6.2 items 3 and 5): the page's shortest query, and a search whose typed text stands.
      ...(Number.isInteger(declared.minQueryLength) && declared.minQueryLength! > 0
        ? { minQueryLength: declared.minQueryLength! } : {}),
      ...(declared.freeText === true && kind === 'typeahead-remote' ? { freeText: true as const } : {}),
      // s2 lists: a list its adapter stored (a combobox's only), and a list drawn whole.
      // s2 lists: the stored list its adapter names (a combobox's only), when the worker served it.
      ...(declared.storedList !== undefined && kind === 'combobox' ? { storedList: declared.storedList } : {}),
      ...(declared.learnContext !== undefined ? { learnContext: declared.learnContext } : {}),
      ...(page !== undefined ? { knownOptions: page, knownFrom: 'page' as const }
        : stored !== undefined && stored.length > 0 ? { knownOptions: stored, knownFrom: 'adapter' as const } : {}),
      ...(declared.drawnWhole === true ? { drawnWhole: true as const } : {}),
      // jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a box of several answers (WidgetDecl.tags), a text box's.
      ...(kind !== 'radio' && kind !== 'checkbox' && declaredTags(declared.tags) !== undefined
        ? { tags: declaredTags(declared.tags)! } : {}) }),
  };
}

/**
 * Whether a control is visible, as isUserVisible judges it, with one exception for a widget the adapter declares with
 * the box a person sees as it (WidgetDecl.box): its element sits inside that box, is hidden by nothing but its own
 * opacity (transparentByItself) or its own narrow width (narrowWithin), and the box is visible. react-select draws its
 * text box transparent while it shows an answer (the Greenhouse capture of 2026-11-01, which
 * fixtures/synthetic/greenhouse-widgets reproduces), and sizes an empty one to a space of the page's font: 3.97 px in
 * Roboto at 16 px, under MIN_BOX_PX, so every select of the live BeyondTrust form (fixtures/greenhouse/beyondtrust-job,
 * 2026-11-01) was taken for a hidden control. Any other hidden control is judged as it always is, and stays a honeypot.
 */
function widgetVisibility(el: Element, declared: WidgetDecl | null, cache: ScanCache): VisibilityVerdict {
  const own = visibilityOf(el, cache);
  const box = declared?.box ?? null;
  if (own.visible || own.deferred || box === null || box === el || !box.contains(el)) return own;
  return transparentByItself(el, cache) || narrowWithin(el, own, box) ? visibilityOf(box, cache) : own;
}

/** An element hidden only by its own width: every rule before the box's size passed (nothing hides it or an ancestor,
 *  its opacity product and visibility kept), it stands at least MIN_BOX_PX tall and is some width wide, and its box
 *  lies wholly inside `box`'s, so it is drawn where the box shows, which every visibility rule then judges (a narrow
 *  element moved off the page, or out of its box, stays hidden). */
function narrowWithin(el: Element, own: VisibilityVerdict, box: Element): boolean {
  if (own.rule !== 'box-size' || el.getClientRects().length === 0) return false;
  const inner = el.getBoundingClientRect();
  const outer = box.getBoundingClientRect();
  return inner.width > 0 && inner.height >= MIN_BOX_PX && inner.left >= outer.left && inner.right <= outer.right
    && inner.top >= outer.top && inner.bottom <= outer.bottom;
}

// ── jr7 ENGINE-7 E1 item 1 (UKGR-6, as its verifier corrected it) ──
/**
 * Whether a native select a person cannot see is drawn by the box its adapter declares around it (Adapter.controlBox):
 * UKG Ready draws every select at opacity 0, z-index 2, over its c-form-control box, which shows the chosen option
 * (snapshot7 secure7.saashr: the EEO, questionnaire, Country and editors' selects). Only a select hidden by nothing but
 * its own opacity (transparentByItself, the rule widgetVisibility applies to a declared widget's box), wholly inside
 * the declared box (which is not the select, holds it and encloses its box), and only while a person can see that box.
 * A box that is hidden is no box; one that draws nothing makes the field camouflaged (dom/camouflage.ts
 * drawnByDeclaredBox), which no write passes. None declared, or a hook that throws: false.
 */
function selectInDeclaredBox(el: Element, adapter: Adapter | null, cache: ScanCache): boolean {
  if (el.localName !== 'select' || adapter?.controlBox === undefined) return false;
  let box: Element | null;
  try {
    box = adapter.controlBox(el) ?? null;
  } catch {
    return false;
  }
  if (box === null || box === el || !holdsComposed(box, el) || !transparentByItself(el, cache)) return false;
  const inner = el.getBoundingClientRect();
  const outer = box.getBoundingClientRect();
  if (inner.width <= 0 || inner.height <= 0 || inner.left < outer.left - BOX_SLACK_PX || inner.right > outer.right
    + BOX_SLACK_PX || inner.top < outer.top - BOX_SLACK_PX || inner.bottom > outer.bottom + BOX_SLACK_PX) return false;
  return visibilityOf(box, cache).visible;
}

/** How far a select's box may stand past its declared box's on a side (sub-pixel rounding). */
const BOX_SLACK_PX = 1;
// ── end jr7 ENGINE-7 E1 item 1 ──

/** An element hidden only by its own opacity: its parent shown (no hiding rule, its opacity product kept), and the
 *  element itself not display: none, visibility: hidden, hidden, inert or aria-hidden. */
function transparentByItself(el: Element, cache: ScanCache): boolean {
  const parent = el.parentElement;
  const style = styleOf(el, cache);
  if (parent === null || style === null || isSubtreeHidden(parent, cache)) return false;
  if (el.hasAttribute('hidden') || el.hasAttribute('inert')
    || (el.getAttribute('aria-hidden') ?? '').trim().toLowerCase() === 'true') return false;
  if (style.display === 'none' || style.visibility !== 'visible' || style.filter !== 'none') return false;
  const opacity = Number(style.opacity);
  return Number.isFinite(opacity) && opacity < MIN_OPACITY;
}

// ── jr7 ENGINE-7 E1 item 6 (RBP7-20, as its verifier corrected it) ──
/** Whether `part` is react-select's DummyInput inside a widget its adapter declares with the react-select bridge:
 *  the input a non-searchable react-select draws (Pinpoint's EEO selects, snapshot7 pinpointhq1), which says
 *  aria-readonly="true" and inputmode="none" because a person cannot type into it, not because its answer cannot
 *  change: the bridge chooses its option. Only its native readonly then makes it read-only. Any other aria-readonly box,
 *  a plain one or a declared widget's without the bridge or without inputmode none, stays read-only. */
function reactSelectDummy(part: Element, widget: WidgetTarget): boolean {
  return widget.bridge === 'react-select' && part.localName === 'input' && ariaReadOnly(part)
    && (part.getAttribute('inputmode') ?? '').trim().toLowerCase() === 'none';
}
// ── end jr7 ENGINE-7 E1 item 6 ──

/** A widget as a field: its label by the same visible-label rules (a group's from its container), its options a
 *  group's members, or its list's when it is shown whole now (else 'lazy' until it is read), and its constraints none
 *  but required. */
function widgetDraft(first: Candidate, widget: WidgetTarget, ctx: LabelContext, cache: ScanCache,
  sections: ReturnType<typeof sectionFinder>): Draft {
  const el = widget.element;
  const groupLike = widget.kind === 'radio' && widget.members.length > 0;
  // jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a box of several answers its adapter declares (WidgetDecl.tags)
  // is one field of kind 'text', holding what its text box holds (widgets/tag-chips.ts), with no options: the planner
  // gives it the person's values joined (core/resolver/values.ts manyValues), and the tags filler adds each.
  const tagged = widget.tags !== undefined;
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 2): the field's text box, where it is the widget's own (inside its element, an
  // ARIA 1.1 combobox's): a box its adapter declares beside the element (WidgetDecl.input: iCIMS's search box, labelled
  // "— Type to Search —") names, requires, disables and names nothing of the field, which is the element's.
  const own = widget.input !== null && holdsComposed(el, widget.input) ? widget.input : null;
  let label = groupLike ? labelOfGroup([], el, ctx) : labelOfControl(el, ctx);
  if (label.source === 'none' && own !== null && own !== el) label = labelOfControl(own, ctx);
  let options: Option[] | 'lazy' = 'lazy';
  let partial = false;
  let members = widget.members;
  if (groupLike) {
    // A member that shows no label is no option.
    const shown = widget.members.map((member) => ({ member, text: memberLabel(member) })).filter((item) => item.text !== '');
    members = shown.map((item) => item.member);
    options = shown.map((item, index) => optionOf(index, item.text, '', isUnavailable(item.member),
      isChosen(item.member)));
  } else if (!tagged && widget.kind !== 'typeahead-remote' && widget.kind !== 'checkbox') {
    // A list shown whole is read as it is, exactly as a whole read takes it (readShownList: the Phase 4 review, R2);
    // one that scrolls (perhaps drawn a part at a time) waits to be read whole. jr6 ENGINE E1 (FIXPLAN §6.2 item 1): a
    // list its adapter declares is read there by its declared rows, as a whole read takes it.
    const list = widget.results !== undefined ? widgetListOf(widget) : listOf(el, widget.input);
    if (list !== null && isUserVisible(list, cache) && !scrolls(list)) {
      const shown = readShownList(list, cache, widget.optionLabel, widget.results);
      if (shown.options.length > 0) {
        options = shown.options.map((option, index) => optionOf(index, option.label, '', option.disabled, false));
        partial = !shown.complete;
      }
    }
  }
  const required = label.required || isRequired(el) || (own !== null && isRequired(own))
    || adapterRequires(el, ctx.adapter);
  return {
    kind: tagged ? 'text' : widget.kind, control: el, members: [], selectOptions: [], container: null, label,
    options: tagged ? null : options, selectable: [],
    section: sections.sectionOf(el, label.element), description: descriptionOf(el, ctx), constraints: {},
    visibility: first.visibility, proxy: null, required,
    disabled: groupLike ? members.every(isUnavailable) : isDisabled(el) || (own !== null && isDisabled(own)),
    // A text box its adapter declares read-only by design (WidgetDecl.readOnlyBox: a select-only dropdown) is read-only
    // only by its aria-readonly; any other widget by the scanner's rule. jr7 ENGINE-7 E1 item 6 (RBP7-20): never by
    // the aria-readonly of a declared react-select's DummyInput (reactSelectDummy).
    readOnly: widget.readOnlyBox === true
      ? [el, own].some((part) => part !== null && ariaReadOnly(part) && !reactSelectDummy(part, widget))
      : [el, own].some((part) => part !== null && (reactSelectDummy(part, widget)
        ? (part as HTMLInputElement).readOnly : isReadOnly(part))),
    // A widget's text box is drawn inside the widget's own box, so it is not judged on its own.
    camouflaged: false,
    nameAttr: attribute(own ?? el, 'name'), idAttr: attribute(el, 'id'),
    autocomplete: own === null ? [] : autocompleteTokens(own).slice(0, MAX_AUTOCOMPLETE_TOKENS)
      .map((token) => capCodePoints(token, TEXT_CAP_AUTOCOMPLETE_TOKEN)),
    widget: members === widget.members ? widget : { ...widget, members },
    ...(partial ? { optionsPartial: true as const } : {}),
  };
}

/** A widget's draft with what the run read of it (ScanOptions.widgetReadings): a list's options while it is closed,
 *  a remote search as a typeahead with no options. A list this scan read whole is kept as the field's reading, with
 *  any option of the earlier reading it no longer shows but the widget shows chosen kept in place (keepReading). A
 *  reading a cap stopped makes the field's options partial. s2 lists: a combobox the run has no reading of, whose list
 *  is not shown, takes its stored list as its options (WidgetDecl.storedList's, else `learned`: the list this host's
 *  dropdown of the same label showed before), whole; a reading, or a list shown now, always comes first. */
function withReading(draft: Draft, base: BaseKey, readings: Map<BaseKey, WidgetReading> | undefined,
  learned?: readonly string[]): Draft {
  const stored = draft.widget!;
  if (stored.kind === 'radio' || stored.kind === 'checkbox') return draft;
  // The stored list is the field's only while nothing the run read, or the page shows now, replaces it.
  const { knownOptions: known, knownFrom: from, ...plain } = stored;
  const widget: WidgetTarget = plain;
  const reading = readings?.get(base);
  if (reading?.kind === 'remote') {
    // A search's results, shown while it types, are no options of the field. A combobox its adapter declared stays
    // one, however its list answered (a Greenhouse Yes/No filters as typed too).
    if (widget.kind !== 'typeahead-remote' && (widget.kind !== 'combobox' || widget.declared)) return { ...draft, widget };
    return { ...draft, kind: 'typeahead-remote', options: [], widget: { ...widget, kind: 'typeahead-remote' } };
  }
  const read = (kept: WidgetReading & { kind: 'options' }, kind: WidgetKind): Draft => {
    const { optionsPartial: _, ...rest } = draft;
    return { ...rest, kind, options: kept.options.map((option, index) => optionOf(index, option.label, '',
      option.disabled, false)), widget: kind === widget.kind ? widget : { ...widget, kind },
      ...(kept.complete ? {} : { optionsPartial: true as const }) };
  };
  if (Array.isArray(draft.options)) {
    const kept = keepReading(readings, base, widget, draft.options.map((option) => ({ label: option.label,
      disabled: option.disabled })), isMultiselectable(listOf(widget.element, widget.input)), draft.optionsPartial !== true);
    return read(kept as WidgetReading & { kind: 'options' }, widget.kind);
  }
  if (reading === undefined) {
    const list = known ?? learned;
    // jr6 ENGINE E1: a list the page publishes (WidgetDecl.knownOptions) is a multiselect's reading too.
    const kinds = known !== undefined && from === 'page' ? ['combobox', 'multiselect'] : ['combobox'];
    if (list === undefined || list.length === 0 || !kinds.includes(widget.kind)) return { ...draft, widget };
    // s2 lists: the stored list, whole, in its order; a placeholder ("Select One") is no option to choose.
    const { optionsPartial: _, ...whole } = draft;
    return { ...whole, options: list.map((label, index) => optionOf(index, label, '', !isUsableOption(label), false)),
      widget: { ...widget, knownOptions: list, knownFrom: known !== undefined ? from ?? 'adapter' : 'learned' } };
  }
  return read(reading, widget.kind === 'combobox' && reading.multiselectable ? 'multiselect' : widget.kind);
}

/** What a widget field holds now (widgets/options.ts), its options marked chosen accordingly. */
function widgetCurrent(draft: Draft, cache: ScanCache): CurrentValue {
  // jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers holds what its text box holds.
  if (draft.widget!.tags !== undefined) return tagsBoxValue(draft.widget!);
  const known = Array.isArray(draft.options) ? draft.options.map((option) => option.label) : [];
  const chosen = chosenLabels(draft.widget!, known, cache);
  if (Array.isArray(draft.options)) {
    for (const option of draft.options) option.selected = chosen.some((label) => label === option.label);
  }
  return chosen.length === 0 ? { kind: 'empty' } : { kind: 'selected', labels: chosen };
}

/** A radio or checkbox group: the question from its container, an option per member that shows a label. */
function groupDraft(entry: Entry, ctx: LabelContext, sections: ReturnType<typeof sectionFinder>): Draft {
  const all = entry.members.map((member) => member.el as HTMLInputElement);
  const label = labelOfGroup(all, entry.container, ctx);
  const checked = checkedReader(ctx.adapter);
  const members: HTMLInputElement[] = [];
  const options: Option[] = [];
  const selectable: SelectableOption[] = [];
  let proxy: Proxy | null = null;
  for (const member of entry.members) {
    const input = member.el as HTMLInputElement;
    const shown = optionLabelOf(input, ctx);
    if (shown.text === '') continue;
    members.push(input);
    options.push(optionOf(options.length, shown.text, input.value, isDisabled(input), checked(input)));
    selectable.push({ label: shown.text, selected: checked(input) });
    proxy ??= member.proxy;
  }
  const first = all[0]!;
  const target = entry.container ?? first;
  const hiddenMember = entry.members.some((member) => member.visibility !== 'visible');
  return {
    kind: entry.kind, control: members[0] ?? first, members, selectOptions: [], container: entry.container, label,
    options, selectable,
    section: sections.sectionOf(target, label.element),
    description: descriptionOf(target, ctx) || descriptionOf(first, ctx),
    constraints: {},
    visibility: hiddenMember ? 'hidden-native-with-visible-label' : 'visible',
    proxy,
    required: label.required || all.some(isRequired) || (entry.container !== null && isRequired(entry.container))
      || adapterRequires(entry.container ?? first, ctx.adapter),
    disabled: all.every(isDisabled), readOnly: false, camouflaged: false, widget: null,
    nameAttr: attribute(first, 'name'), idAttr: attribute(entry.container ?? first, 'id'),
    autocomplete: [],
  };
}

function optionOf(index: number, label: string, value: string, disabled: boolean, selected: boolean, group?: string):
  Option {
  const option: Option = { index, label: capCodePoints(label, TEXT_CAP_LABEL), disabled, selected };
  if (value !== '') option.value = capCodePoints(value, TEXT_CAP_LABEL);
  if (group !== undefined && group !== '') option.group = capCodePoints(group, TEXT_CAP_LABEL);
  return option;
}

function isRequired(el: Element): boolean {
  if ((el as HTMLInputElement).required === true) return true;
  return (el.getAttribute('aria-required') ?? '').trim().toLowerCase() === 'true';
}

/** The most file names a held field's value carries (heldFile; messaging/schemas.ts CurrentValueSchema's cap). */
const MAX_HELD_NAMES = 20;

/** The core pass of 2026-11-06: an empty file input whose field the page shows holding a file it took
 *  (Adapter.uploadHeld: Workday's resume read at "Autofill with Resume") holds that file, marked `held` (the behaviour
 *  review of 2026-11-06, M2), so no upload is planned for it unless the person's "Résumé already on the page" setting
 *  says to upload theirs again; any other value stands, as does every field when the hook fails. The names the page
 *  shows beside those files (Adapter.uploadHeldNames, the integration of 2026-11-06) go with it, at most 20, each whole
 *  (a longer one than a label's cap could never be a file's name, so it is left out), so the planner never puts the
 *  person's résumé in beside a file of its name. */
function heldFile(kind: FieldKind, control: Element, adapter: Adapter | null, current: CurrentValue): CurrentValue {
  if (kind !== 'file' || current.kind !== 'empty' || adapter?.uploadHeld === undefined) return current;
  try {
    if (!adapter.uploadHeld(control as HTMLInputElement)) return current;
    const names = (adapter.uploadHeldNames?.(control as HTMLInputElement) ?? [])
      .filter((name) => name.length <= TEXT_CAP_LABEL).slice(0, MAX_HELD_NAMES);
    return { kind: 'files', count: 1, held: true, ...(names.length > 0 ? { names } : {}) };
  } catch {
    return current;
  }
}

/** Whether the adapter reads a required mark the page draws for this control (requiredFor); false when its hook
 *  fails. */
function adapterRequires(el: Element, adapter: Adapter | null): boolean {
  try {
    return adapter?.requiredFor?.(el) === true;
  } catch {
    return false;
  }
}

/** A text control's constraints with the layout its adapter reads (formatFor), where neither its type nor a visible
 *  placeholder gave one: a format the control's own type gives, or a placeholder's pattern, stands. A format its
 *  inputmode alone gave is the keyboard a phone shows, not a layout: the adapter's declared format takes its place
 *  (Workable's date masks say inputmode="tel" over "MM/DD/YYYY"), its placeholder's pattern still standing. jr6 ENGINE
 *  E3 (the ULTIPRO package's U-16): a format its type alone gave, with no pattern from the page, takes the pattern its
 *  adapter declares for that same format (UltiPro's type="tel" phones, a ten-digit national number); a declared other
 *  format, or one with no pattern, leaves it as it is. */
function withAdapterFormat(constraints: Constraints, control: Element, adapter: Adapter | null): Constraints {
  const keyboardOnly = typeFormatOf(control) === undefined && inputModeFormatOf(control) !== undefined;
  // jr6 ENGINE (ULTIPRO U-16): a format its type alone gave takes the adapter's pattern for that same format.
  const typeOnly = constraints.pattern === undefined && constraints.format !== undefined
    && typeFormatOf(control) === constraints.format;
  if (!keyboardOnly && !typeOnly // jr6 ENGINE
    && (constraints.format !== undefined || constraints.pattern !== undefined)) return constraints;
  let declared: ReturnType<NonNullable<Adapter['formatFor']>> | undefined;
  try {
    declared = adapter?.formatFor?.(control);
  } catch {
    declared = null;
  }
  if (declared === null || declared === undefined) return constraints;
  // jr6 ENGINE (ULTIPRO U-16): only the same format, and only a pattern.
  if (typeOnly && (declared.format !== constraints.format || declared.pattern === undefined)) return constraints;
  const pattern = constraints.pattern ?? declared.pattern;
  return { ...constraints, format: declared.format,
    ...(pattern !== undefined ? { pattern: capCodePoints(pattern, TEXT_CAP_PATTERN) } : {}) };
}

function attribute(el: Element, name: 'name' | 'id'): string {
  return capCodePoints((el.getAttribute(name) ?? '').trim(), TEXT_CAP_ATTRIBUTE);
}

/** The flagged rows for hidden file inputs beside a visible upload control. Their ordinals continue after the
 *  fields', so a row's key never equals a field's. */
function unrecognisedRows(found: ReadonlyArray<{ input: HTMLInputElement; control: Element }>,
  fields: readonly ScannedField[], ctx: LabelContext, sections: ReturnType<typeof sectionFinder>,
  platform: Platform): UnrecognisedUpload[] {
  const taken = new Map<string, number>();
  const identity = (section: SectionRef, slug: string) => `${section.id}[${section.block ?? ''}]|${slug}`;
  for (const field of fields) {
    const slug = labelSlug(field);
    const id = identity(field.section, slug);
    taken.set(id, (taken.get(id) ?? 0) + 1);
  }
  return found.map(({ input, control }) => {
    const text = control.localName === 'input' ? (control as HTMLInputElement).value
      : visibleText(control, { singleLine: true, cache: ctx.cache });
    const label = capCodePoints(text.replace(/\s+/g, ' ').trim(), TEXT_CAP_LABEL);
    const section = sections.sectionOf(control, null);
    const slug = labelSlug({ label, kind: 'file', nameAttr: attribute(input, 'name'), idAttr: attribute(input, 'id') });
    const id = identity(section, slug);
    const ordinal = taken.get(id) ?? 0;
    taken.set(id, ordinal + 1);
    const parts = { platform, section, labelSlug: slug, ordinal };
    // jr7 ENGINE-7 E1 item 9 (RBP7-V3): a required upload no rule recognises holds Submit until a file is in.
    const required = isRequired(input) || adapterRequires(input, ctx.adapter) || adapterRequires(control, ctx.adapter);
    return { key: fieldKey({ ...parts, optionSetHash: OPTION_SET_NONE }), baseKey: baseKey(parts), label, section,
      requiredEmpty: required && (input.files?.length ?? 0) === 0 };
  });
}
