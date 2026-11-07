/*
 * The DOM layer's own types: what a scan adds to the core's FieldSpec, and what settle() reports. The DOM layer works
 * from each element's ownerDocument and defaultView, never page globals, so it is correct inside any frame.
 *
 * Phase 2 added the scan's result (fields, counters, and re-finding a field by key), the filler's outcome, which maps
 * onto the review row's own fields, and the DOM half of the pre-write Guard's verdict. Phase 3 added what settle()
 * counts as busy, and the state and answer of a dependent option list (awaitOptions). Phase 4 added the ARIA widgets
 * the scanner recognises (WidgetTarget) and what opening one read (WidgetReading).
 */
import type { BaseKey, FieldDescriptor, FieldKey, OptionSetHash, ReasonCode, SectionRef } from '../core/types';

/** How a visually hidden native control qualified to be filled (the proxy rule): through its tied visible label, or
 *  through an element the adapter declared. Highlights point at this element, not the hidden input. */
export type ProxyKind = 'label' | 'adapter';

/** A scanned field as the content script holds it: the descriptor plus where its highlight goes. Whether a visible
 *  source names it (labelVisible) is the FieldSpec's own, so the worker plans nothing for a field the frame would
 *  refuse as no-visible-label. */
export interface ScannedField extends FieldDescriptor {
  proxy: ProxyKind | null;
  /** A text-like control drawn so it cannot be seen (no border, a background matching the page, no shadow, outline or
   *  visible placeholder). It is reported, but the DOM guard refuses to write it. */
  camouflaged: boolean;
}

/** What one scan of a form root found, besides its fields. Counts only: no text. */
export interface ScanCounters {
  hiddenControlsIgnored: number;
  /** Fields not rendered yet (content-visibility: auto); the notice asks the person to scroll to them. */
  deferredFields: number;
}

/** settle() ends on a DOM condition or its cap, never a fixed sleep. */
export type SettleResult = { settled: true; ms: number } | { settled: false; reason: 'page-still-busy' | 'aborted' };

/**
 * What keeps a page from settling (docs/design/runtime.md §7), each only while a person can see it:
 * - aria-busy: an element with aria-busy="true" in the form root, or the root or one of its ancestors with it;
 * - progressbar: an indeterminate progress bar (a role="progressbar" with no aria-valuenow, or a <progress> with no
 *   value);
 * - adapter: the adapter's isBusy (a platform's own spinner, from its snapshots);
 * - options-loading: an option list still loading: a select with an option whose text is a loading phrase
 *   ("Loading...", "Please wait"), or an aria-busy or progress bar inside the field container of one select. It
 *   counts only up to OPTIONS_CAP_MS: past that the list is awaitOptions' to flag, not a busy page.
 */
export const BUSY_SIGNS = ['aria-busy', 'progressbar', 'adapter', 'options-loading'] as const;
export type BusySign = (typeof BUSY_SIGNS)[number];

/**
 * Why a dependent option list is not ready (docs/design/runtime.md §7.1), in the order they are checked:
 * - gone: the list is no longer in the page;
 * - hidden: no person can see it;
 * - busy: it, or something in its field container, shows aria-busy or an indeterminate progress bar;
 * - loading: one of its options is a loading phrase;
 * - placeholders: it has no real option, only placeholders ("Select a state") or none at all;
 * - unchanged: its real options still have the option-set hash they had before its parent changed.
 */
export const OPTIONS_WAITING = ['gone', 'hidden', 'busy', 'loading', 'placeholders', 'unchanged'] as const;
export type OptionsWaiting = (typeof OPTIONS_WAITING)[number];

/** A dependent list's state right now: ready with the option-set hash of its real options (the hash the scanner gives
 *  the field), or what it is still waiting for. Value-free: it names a reason, never an option. */
export type OptionsState = { ready: true; optionSetHash: OptionSetHash } | { ready: false; waiting: OptionsWaiting };

/**
 * What awaitOptions answers. Every answer ends on a DOM condition or OPTIONS_CAP_MS, never a fixed sleep.
 * - ready: real options arrived, their hash differs from the one given, and the list has been quiet for
 *   OPTIONS_QUIET_MS; `optionSetHash` is the hash the next scan gives the field, `ms` how long it took;
 * - never-loaded: the cap passed first; the field is flagged options-never-loaded, and `waiting` says what it was
 *   still waiting for;
 * - gone: the list left the page and was not found again by the cap; the next scan rows it (field-disappeared);
 * - aborted: the run's signal aborted.
 */
export type AwaitOptionsResult =
  | { status: 'ready'; optionSetHash: OptionSetHash; ms: number }
  | { status: 'never-loaded'; reason: 'options-never-loaded'; waiting: OptionsWaiting }
  | { status: 'gone' }
  | { status: 'aborted' };

/** A field's live elements in one scan, for the guard and the fillers to act on at once. Never kept across a write:
 *  the page may replace them (React does), so the next write re-finds them by key. */
export interface FieldTarget {
  readonly field: ScannedField;
  /** The control, or a group's first member. */
  readonly control: Element;
  /** A radio or checkbox group's members in option order: members[i] is field.options[i]. [] otherwise. */
  readonly members: readonly HTMLInputElement[];
  /** A select's visible options in option order: options[i] is field.options[i]. [] otherwise. */
  readonly options: readonly HTMLOptionElement[];
  /** Where the highlight goes for a hidden control: its label or the adapter's widget. */
  readonly proxy: Element | null;
  /** An ARIA widget's parts (Phase 4), which only the widget helpers act on; absent for a native control. */
  readonly widget?: WidgetTarget;
  /** Whether a native radio or checkbox of the field shows chosen, as its adapter reads it (Adapter.checkedOf: Ashby
   *  draws the answer beside an opacity-0 input); absent: its own checked property. */
  readonly checkedOf?: (input: HTMLInputElement) => boolean;
}

/** The widget kinds a scan can report (Phase 4), as their fields' kinds: the first four from standard ARIA, and a
 *  'checkbox' only as an adapter declares one (WidgetDecl), which no helper fills yet (widget-unsupported). */
export const WIDGET_KINDS = ['combobox', 'typeahead-remote', 'multiselect', 'radio', 'checkbox'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/**
 * An ARIA widget as one scan found it (Phase 4, docs/design/runtime.md §5.6): standard ARIA only, or what the adapter
 * declared (widgetFor). Its elements are live and never kept across a write: the next write finds them again by key.
 */
export interface WidgetTarget {
  kind: WidgetKind;
  /** The element with the widget's role: the combobox, the listbox, the radiogroup or the group of toggle buttons. */
  readonly element: Element;
  /** The text box a person types into: an input combobox, or the one inside an ARIA 1.1 combobox; null otherwise. */
  readonly input: HTMLInputElement | HTMLTextAreaElement | null;
  /** What opens its list: the adapter's declared opener, else the combobox itself; null for a listbox or a group. */
  readonly opener: HTMLElement | null;
  /** A group's option elements in option order (buttons or role=radio): members[i] is field.options[i]. */
  readonly members: readonly HTMLElement[];
  /** The single activation event the adapter declared for opening it, instead of click(); [] for none. */
  readonly activation: readonly ('mousedown' | 'mouseup' | 'focus')[];
  /** The page-world bridge's code the adapter declared for it (WidgetDecl.bridge), tried before any event. */
  readonly bridge?: 'react-select' | null;
  /** The untrusted keys the adapter declared for it (WidgetDecl.keys); none for any other widget. */
  readonly keys?: readonly ('Escape' | 'ArrowDown')[];
  /** Where its declared keys go (WidgetDecl.keyTarget): 'list', its open list; absent, its text box, else its element. */
  readonly keyTarget?: 'list';
  /** Its text box is read-only by design (WidgetDecl.readOnlyBox): that box's readonly does not make it read-only. */
  readonly readOnlyBox?: true;
  /** Its list is drawn fixed at its field's place (WidgetDecl.listFollowsField): judged where its field is. */
  readonly listFollowsField?: true;
  /** The adapter declared it, from a snapshot. */
  readonly declared: boolean;
  /** The element whose aria-expanded says whether its list is open (WidgetDecl.expanded): its declared activation
   *  toggles the list, so it is sent only while this says "false". Absent: open means its list is shown. */
  readonly expanded?: Element | null;
  /** What a person sees as the widget, when the adapter names it (WidgetDecl.box). */
  readonly box?: Element | null;
  /** The adapter's selectors for the widget's own busy signs (WidgetDecl.busy). */
  readonly busy?: readonly string[];
  /** The option it shows chosen when its own text does not name it (WidgetDecl.shownAnswer). */
  readonly shownAnswer?: (known: readonly string[]) => string | null;
  /** The page hides the rest of the form while its list is open (WidgetDecl.hidesFormWhileOpen). */
  readonly hidesFormWhileOpen?: boolean;
  /** The part of an option that is its label (WidgetDecl.optionLabel). */
  readonly optionLabel?: OptionLabel;
  /** A search's list found nothing after this long quiet with no option (WidgetDecl.emptyAfterMs). */
  readonly emptyAfterMs?: number;
  /** The list's first result carries its mark before anything is chosen (WidgetDecl.highlightIsNoChoice). */
  readonly highlightIsNoChoice?: boolean;
  /** v4 (drop): its results list that no ARIA names, as its adapter declared it (WidgetDecl.results). */
  readonly results?: { readonly list: Element; readonly option: string; readonly choose?: 'mousedown' };
  /** v4 (drop): the declared key sent after each typed query (WidgetDecl.queryKey). */
  readonly queryKey?: 'Escape' | 'ArrowDown';
}

/** The part of a list's option that is its label, or null for the whole option (WidgetDecl.optionLabel). */
export type OptionLabel = (option: Element) => Element | null;

/** One option of a widget's list as it was read: its visible label and whether it can be chosen. */
export interface WidgetOptionRead {
  label: string;
  disabled: boolean;
}

/**
 * What opening a lazy widget read (Phase 4), kept for the run by its field's base key, so every later scan of the run
 * gives the field these options (and the key their hash) while the list itself is closed:
 * - options: the options its list showed (read whole, a virtualized list scrolled through), whether the list takes
 *   several, and whether the read reached the list's end (`complete` false: a cap stopped it, and the field is planned
 *   as a partial list, FieldSpec.optionsPartial);
 * - remote: it showed none until something is typed, so it is a remote search (typeahead-remote).
 */
export type WidgetReading =
  | { kind: 'options'; options: readonly WidgetOptionRead[]; multiselectable: boolean; complete: boolean }
  | { kind: 'remote' };

/** A hidden file input that did not qualify, beside a visible upload control: it gets a flagged row with reason
 *  upload-control-not-recognized, and is never written, focused or sent an event. */
export interface UnrecognisedUpload {
  key: FieldKey;
  baseKey: BaseKey;
  /** The upload control's visible text (at most 300 characters). */
  label: string;
  section: SectionRef;
}

/** One scan of a form root. */
export interface ScanResult {
  /** The fields, in DOM order (at most MAX_SCAN_FIELDS). */
  readonly fields: readonly ScannedField[];
  readonly counters: ScanCounters;
  /** Visible password and one-time-code controls: never fields. A step that has one is an auth pause. */
  readonly authFields: number;
  readonly unrecognisedUploads: readonly UnrecognisedUpload[];
  /** The form had more fields than MAX_SCAN_FIELDS; the rest were left out. */
  readonly truncated: boolean;
  /** This scan's elements for a field. Use them at once: after any write, rescan. */
  target(key: FieldKey): FieldTarget | null;
  /** A fresh scan of the same root, with the same adapter and options: how a field is re-found by key on every use. */
  rescan(): ScanResult;
}

/** The reason codes a filler can end with. */
export const FILL_OUTCOME_REASONS = ['ok', 'already-correct', 'verify-mismatch', 'needs-your-click',
  'unexpected-selection', 'element-not-found', 'disabled-or-readonly', 'not-user-visible', 'maxlength-exceeded',
  'pdf-only-input', 'resume-format-unsupported', 'resume-unavailable', 'format-unsupported', 'value-rejected-by-site',
  'options-changed', 'widget-unsupported', 'max-selections-reached', 'llm-pick-rejected', 'internal-error',
  'upload-failed', 'upload-not-confirmed',
] as const satisfies readonly ReasonCode[];
export type FillOutcomeReason = (typeof FILL_OUTCOME_REASONS)[number];

/**
 * What one filler call did, for the core's row-settling helper. Its fields are the review row's own (FillResult's
 * wrote, verification, reason and needsUserAction), so settling a planned row is a merge. It never carries a value.
 * - verified: written (or already right) and read back equivalent: 'ok' or 'already-correct';
 * - mismatch: written, but it reads back differently ('verify-mismatch', 'unexpected-selection',
 *   'value-rejected-by-site'): the row is filled, not verified;
 * - not-checked: nothing was written, for the reason given ('needs-your-click' when the page ignored our events or a
 *   click was refused; 'maxlength-exceeded', 'pdf-only-input', 'disabled-or-readonly', ...).
 */
export interface FillOutcome {
  /** The control changed state because of us: a setter ran and stuck, or a click toggled it. */
  wrote: boolean;
  verification: 'verified' | 'mismatch' | 'not-checked';
  reason: FillOutcomeReason;
  /** The person must act: the site ignored untrusted events, or a click was refused as one that could submit. */
  needsUserAction: boolean;
}

/** How a read-back is compared with what was written: digits for phones, case-folded for emails, as numbers for
 *  amounts, with collapsed white space for other text, or exactly. */
export const READ_BACK_RULES = ['text', 'digits', 'casefold', 'numeric', 'exact'] as const;
export type ReadBackRule = (typeof READ_BACK_RULES)[number];

/** The reason codes the DOM half of the pre-write Guard can refuse a write with. */
export const DOM_GUARD_REASONS = ['element-not-found', 'options-changed', 'not-user-visible', 'disabled-or-readonly',
  'no-visible-label', 'auth-required', 'internal-error'] as const satisfies readonly ReasonCode[];
export type DomGuardReason = (typeof DOM_GUARD_REASONS)[number];

/** The DOM half of the pre-write Guard: the field re-found now, or why it may not be written. */
export type DomGuardVerdict = { ok: true; target: FieldTarget } | { ok: false; reason: DomGuardReason };
