/*
 * The scanner (docs/design/runtime.md §5; docs/ARCHITECTURE.md "Scanner"): a frame's form root becomes the FieldSpecs
 * the planner reads, built only from what a person can see.
 * - Every native control is judged by isUserVisible. A hidden radio, checkbox or file input may still be a field
 *   through the proxy rule; any other hidden control is a honeypot and is only counted (hiddenControlsIgnored).
 * - A visible control with no visible label, visible placeholder or adapter label is still reported, with
 *   labelSource 'none', so the planner can skip it as no-visible-label (a visible honeypot marked autocomplete="email"
 *   included).
 * - Password and one-time-code controls are never fields; they mean the step is an auth pause.
 * - A text input with role="combobox" (react-select) is a 'combobox' with options 'lazy' and option-set hash 'lazy':
 *   ARIA widgets are filled from Phase 4, so until then the filler refuses it as widget-unsupported. So is a control
 *   the adapter declares a widget for (widgetFor): it is reported as the declared kind with options 'lazy', and never
 *   grouped, so the core plans no write for it (waiting for options) and nothing types into it.
 * - Keys come from the core's keys.ts (labelSlug, optionSetHash, assignOrdinals, baseKey, fieldKey), so the worker and
 *   every frame build the same strings.
 * - A field's element is never cached across a write: ScanResult.rescan() scans afresh and target(key) finds the
 *   field's live elements in that scan.
 */
import type { Adapter } from '../adapters/types';
import type { FieldFormat, FieldKind, FieldVisibility, Platform } from '../core/enums';
import { assignOrdinals, baseKey, fieldKey, labelSlug, OPTION_SET_LAZY, OPTION_SET_NONE } from '../core/text/keys';
import { capCodePoints } from '../core/text/fold';
import type { Constraints, FieldKey, FieldSpec, Option, SectionRef } from '../core/types/field';
import { isControlCamouflaged } from './camouflage';
import { constraintsOf } from './constraints';
import {
  autocompleteTokens, CONTROL_SELECTOR, isDisabled, isReadOnly, isTextLike, kindOf, type NativeKind,
} from './kinds';
import {
  descriptionOf, labelOfControl, labelOfGroup, legendOf, optionLabelOf, type LabelContext, type ResolvedLabel,
} from './labels';
import { hashOfOptions } from './option-hash';
import { isInOwnUi } from './own-ui';
import { proxyOf, type Proxy, unrecognisedUploadControl } from './proxy';
import { newScanCache, type ScanCache } from './scan-cache';
import { sectionFinder } from './sections';
import {
  MAX_AUTOCOMPLETE_TOKENS, MAX_SCAN_FIELDS, TEXT_CAP_ATTRIBUTE, TEXT_CAP_AUTOCOMPLETE_TOKEN, TEXT_CAP_LABEL,
} from './thresholds';
import type { FieldTarget, ScanCounters, ScannedField, ScanResult, UnrecognisedUpload } from './types';
import { currentValueOf, type SelectableOption } from './values';
import { readSelectOptions, visiblePlaceholder, visibleText, type VisibleOption } from './visible-text';
import { visibilityOf, isUserVisible } from './visibility';

/** What a scan needs besides the root and the adapter. */
export interface ScanOptions {
  /** The platform of the frame's host (shared/hosts.ts), even when the generic adapter handles the page. */
  platform: Platform;
  /** The frame's id, as the worker knows it; 0 for the top frame. */
  frameId?: number;
  /**
   * The controls the extension wrote into while their visible placeholder labelled them. A value hides a placeholder,
   * so a field labelled only by one would lose its label, and its key, to our own write, and the read-back after the
   * settle would not find it. In this set it keeps that label (heldPlaceholder); the pass adds a control as it writes
   * it, and its rescans, which reuse these options, see it. A node the page replaces is not in it.
   */
  heldPlaceholders?: WeakSet<Element>;
}

/** A control that may become (part of) a field. */
interface Candidate {
  el: Element;
  /** Its native kind, or the kind of the widget the adapter declares for it. */
  kind: NativeKind | FieldKind;
  format: FieldFormat | undefined;
  visibility: FieldVisibility;
  proxy: Proxy | null;
  /** The adapter declared a widget for this control (widgetFor): it is its own field, of the declared kind, with
   *  options 'lazy', and nothing fills it before Phase 4. */
  declared: boolean;
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
}

/** Scans a frame's form root. */
export function scan(root: Element, adapter: Adapter | null, options: ScanOptions): ScanResult {
  const cache = newScanCache();
  const ctx: LabelContext = { cache, adapter, ...(options.heldPlaceholders ? { heldPlaceholders: options.heldPlaceholders } : {}) };
  const counters: ScanCounters = { hiddenControlsIgnored: 0, deferredFields: 0 };
  let authFields = 0;
  const candidates: Candidate[] = [];
  const unrecognised: Array<{ input: HTMLInputElement; control: Element }> = [];

  for (const el of collectControls(root)) {
    const kind = kindOf(el);
    if (!kind.field) {
      if (kind.auth && isUserVisible(el, cache)) authFields += 1;
      continue;
    }
    // A widget the adapter declares for this control (Lever's location search on its text input) is reported as that
    // widget, never as the native control it is built on.
    const widget = adapter?.widgetFor?.(el) ?? null;
    const verdict = visibilityOf(el, cache);
    if (verdict.visible) {
      candidates.push({ el, kind: widget?.kind ?? kind.kind, format: widget === null ? kind.format : undefined,
        visibility: 'visible', proxy: null, declared: widget !== null });
      continue;
    }
    if (verdict.deferred) {
      counters.deferredFields += 1;
      continue;
    }
    if (widget === null && (kind.kind === 'radio' || kind.kind === 'checkbox' || kind.kind === 'file')) {
      const input = el as HTMLInputElement;
      const proxy = proxyOf(input, adapter, root, cache);
      if (proxy !== null) {
        candidates.push({ el, kind: kind.kind, format: kind.format, proxy, declared: false,
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
  const drafts = group(candidates, root).map((entry) => draftOf(entry, ctx, cache, sections));
  const truncated = drafts.length > MAX_SCAN_FIELDS;
  const kept = drafts.slice(0, MAX_SCAN_FIELDS);
  const frameId = options.frameId ?? 0;
  const slugs = kept.map((draft) => labelSlug({ label: draft.label.text, kind: draft.kind, nameAttr: draft.nameAttr,
    idAttr: draft.idAttr }));
  const ordinals = assignOrdinals(kept.map((draft, i) => ({ platform: options.platform, section: draft.section,
    labelSlug: slugs[i]! })));
  const targets = new Map<FieldKey, FieldTarget>();
  const fields = kept.map((draft, i): ScannedField => {
    const optionSetHash = draft.options === null ? OPTION_SET_NONE : draft.options === 'lazy' ? OPTION_SET_LAZY
      : hashOfOptions(draft.options.map((option) => option.label));
    const parts = { platform: options.platform, section: draft.section, labelSlug: slugs[i]!, ordinal: ordinals[i]! };
    const key = fieldKey({ ...parts, optionSetHash });
    const field: ScannedField = {
      key, baseKey: baseKey(parts), platform: options.platform, section: draft.section, kind: draft.kind,
      label: draft.label.text, labelSource: draft.label.source, labelVisible: draft.label.visible,
      description: draft.description, required: draft.required, options: draft.options ?? [], optionSetHash,
      constraints: draft.constraints, autocomplete: draft.autocomplete, nameAttr: draft.nameAttr, idAttr: draft.idAttr,
      ordinal: ordinals[i]!, domOrder: i, visibility: draft.visibility, disabled: draft.disabled,
      readOnly: draft.readOnly, current: currentValueOf(draft.kind, draft.control, draft.selectable),
      el: { key, frameId }, proxy: draft.proxy?.kind ?? null, camouflaged: draft.camouflaged,
    };
    targets.set(key, { field, control: draft.control, members: draft.members, options: draft.selectOptions,
      proxy: draft.proxy?.el ?? null });
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
    current: field.current,
  };
}

/** How many field controls in `root` a person can see: the generic adapter picks the form with the most. */
export function countVisibleControls(root: Element, cache: ScanCache = newScanCache()): number {
  return collectControls(root).filter((el) => kindOf(el).field && isUserVisible(el, cache)).length;
}

// ── Collecting and grouping ──────────────────────────────────────────────────────────────────────────────────────

/** Every native control under `root` in document order, open shadow roots included, the extension's UI excluded. */
function collectControls(root: Element): Element[] {
  const found: Element[] = [];
  const visit = (scope: Element | ShadowRoot) => {
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (el.matches(CONTROL_SELECTOR)) found.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  if (root.matches(CONTROL_SELECTOR)) found.push(root);
  if (root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return found.filter((el) => !isInOwnUi(el));
}

interface Entry {
  kind: FieldKind;
  members: Candidate[];
  container: Element | null;
}

/**
 * Radios are grouped by form and name (nameless ones by their fieldset or radiogroup). Checkboxes form a group when
 * two or more share a form and name, or when two or more sit in one fieldset (or role=group) that has a label and
 * holds no other kind of field; any other checkbox is a lone checkbox. Each group sits at its first member's place.
 */
function group(candidates: readonly Candidate[], root: Element): Entry[] {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const ids = new Map<object | null, number>();
  const idOf = (item: object | null) => {
    if (!ids.has(item)) ids.set(item, ids.size);
    return ids.get(item)!;
  };
  const nameCount = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'checkbox' || candidate.declared) continue;
    const input = candidate.el as HTMLInputElement;
    if (input.name === '') continue;
    const id = `${idOf(input.form)}|${input.name}`;
    nameCount.set(id, (nameCount.get(id) ?? 0) + 1);
  }
  const boxContainers = new Map<Element, number>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'checkbox' || candidate.declared) continue;
    const container = checkboxContainer(candidate.el, root);
    if (container !== null) boxContainers.set(container, (boxContainers.get(container) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    const input = candidate.el as HTMLInputElement;
    let id: string | null = null;
    let kind: FieldKind = candidate.kind;
    if (candidate.declared) {
      // A declared widget is never grouped: it is its own field.
      entries.push({ kind, members: [candidate], container: null });
      continue;
    }
    if (candidate.kind === 'radio') {
      id = input.name !== '' ? `radio|${idOf(input.form)}|${input.name}`
        : `radio-box|${idOf(input.closest('fieldset, [role="radiogroup"]'))}`;
      if (input.name === '' && input.closest('fieldset, [role="radiogroup"]') === null) id = null;
    } else if (candidate.kind === 'checkbox') {
      const named = input.name === '' ? 0 : nameCount.get(`${idOf(input.form)}|${input.name}`) ?? 0;
      const container = checkboxContainer(input, root);
      if (named >= 2) id = `checkbox|${idOf(input.form)}|${input.name}`;
      else if (container !== null && (boxContainers.get(container) ?? 0) >= 2) id = `checkbox-box|${idOf(container)}`;
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
    if (entry.kind === 'radio' || entry.kind === 'checkbox-group') entry.container = groupContainer(entry.members, root);
  }
  return entries;
}

/** The fieldset or role=group around a checkbox that can hold a checkbox group: it has a label and holds no field of
 *  another kind. */
function checkboxContainer(input: Element, root: Element): Element | null {
  const container = input.closest('fieldset, [role="group"]');
  if (container === null || !root.contains(container)) return null;
  const labelled = legendOf(container) !== null || container.hasAttribute('aria-labelledby')
    || container.hasAttribute('aria-label');
  if (!labelled) return null;
  const fields = Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter((el) => kindOf(el).field);
  return fields.every((el) => el.localName === 'input' && (el as HTMLInputElement).type === 'checkbox') ? container : null;
}

/** The nearest fieldset, radiogroup or group that holds every member of a group, inside the form root. */
function groupContainer(members: readonly Candidate[], root: Element): Element | null {
  const first = members[0]?.el;
  if (first === undefined) return null;
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
  if (!first.declared && (entry.kind === 'radio' || entry.kind === 'checkbox-group')) {
    return groupDraft(entry, ctx, sections);
  }
  const label = labelOfControl(control, ctx);
  const placeholder = isTextLike(control) ? visiblePlaceholder(control, cache) : null;
  // A combobox input, or a widget the adapter declares: its options exist only once it is opened (Phase 4).
  const combobox = entry.kind === 'combobox' || first.declared;
  let options: Option[] | 'lazy' | null = combobox ? 'lazy' : null;
  let selectable: SelectableOption[] = [];
  let selectOptions: HTMLOptionElement[] = [];
  if (!combobox && (entry.kind === 'select' || entry.kind === 'multiselect')) {
    const read: VisibleOption[] = readSelectOptions(control as HTMLSelectElement, cache);
    options = read.map((option, index) => optionOf(index, option.label, option.value, option.disabled,
      option.selected, option.group));
    selectable = read.map((option) => ({ label: option.label, selected: option.selected }));
    selectOptions = read.map((option) => option.el);
  }
  const format = first.format;
  return {
    kind: entry.kind, control, members: [], selectOptions, container: null, label, options, selectable,
    section: sections.sectionOf(control, label.element),
    description: descriptionOf(control, ctx),
    constraints: entry.kind === 'select' || entry.kind === 'multiselect' || combobox ? {}
      : constraintsOf(control, format, placeholder),
    visibility: first.visibility, proxy: first.proxy,
    required: label.required || isRequired(control),
    disabled: isDisabled(control), readOnly: isReadOnly(control),
    // A combobox's input is drawn borderless inside the widget's own box, so it is not judged on its own.
    camouflaged: !combobox && first.visibility === 'visible' && isControlCamouflaged(control, placeholder !== null, cache),
    nameAttr: attribute(control, 'name'), idAttr: attribute(control, 'id'),
    autocomplete: autocompleteTokens(control).slice(0, MAX_AUTOCOMPLETE_TOKENS)
      .map((token) => capCodePoints(token, TEXT_CAP_AUTOCOMPLETE_TOKEN)),
  };
}

/** A radio or checkbox group: the question from its container, an option per member that shows a label. */
function groupDraft(entry: Entry, ctx: LabelContext, sections: ReturnType<typeof sectionFinder>): Draft {
  const all = entry.members.map((member) => member.el as HTMLInputElement);
  const label = labelOfGroup(all, entry.container, ctx);
  const members: HTMLInputElement[] = [];
  const options: Option[] = [];
  const selectable: SelectableOption[] = [];
  let proxy: Proxy | null = null;
  for (const member of entry.members) {
    const input = member.el as HTMLInputElement;
    const shown = optionLabelOf(input, ctx);
    if (shown.text === '') continue;
    members.push(input);
    options.push(optionOf(options.length, shown.text, input.value, isDisabled(input), input.checked));
    selectable.push({ label: shown.text, selected: input.checked });
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
    required: label.required || all.some(isRequired) || (entry.container !== null && isRequired(entry.container)),
    disabled: all.every(isDisabled), readOnly: false, camouflaged: false,
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
    return { key: fieldKey({ ...parts, optionSetHash: OPTION_SET_NONE }), baseKey: baseKey(parts), label, section };
  });
}
