/*
 * What an adapter may know about a platform: only its quirks (form root, sections, step identity, Next and Submit,
 * repeatable sections, busy hints, upload widgets, auth state). Phase 0 ships this interface only. The generic adapter
 * and the Lever and Greenhouse ones come in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5. Every DOM hook is
 * written from the owner's snapshots and names the snapshot it came from; no selector is ever guessed.
 */
import type { FieldFormat, Platform } from '../core/enums';
import type { DeclaredKey } from '../dom/fillers/events';

export type AdapterId = Platform | 'generic';

/** A single activation event a widget hook may declare instead of click() (docs/ARCHITECTURE.md "Filler"). */
export type WidgetActivation = 'mousedown' | 'mouseup' | 'focus';

/** The page-world bridge's widget code a widget hook may declare (docs/SPEC-AMENDMENTS.md §12): its choice is made by
 *  the widget's own React code first, and read back; the declared events are the fallback. */
export type WidgetBridge = 'react-select';

/** A custom widget the adapter recognises (Phase 4). */
export interface WidgetDecl {
  kind: 'combobox' | 'typeahead-remote' | 'multiselect' | 'radio' | 'checkbox';
  /** The element that opens the widget's list. */
  opener: HTMLElement;
  /** Single activation events this widget needs beyond click() (for example one mousedown), each named in the snapshot. */
  activation?: WidgetActivation[];
  /** The page-world bridge's code for this widget (docs/SPEC-AMENDMENTS.md §12): 'react-select', whose own selectOption
   *  chooses a planned option (a remote search's only once its typed query lists it), read back, before any event. */
  bridge?: WidgetBridge;
  /** Untrusted keys this widget needs (docs/SPEC-AMENDMENTS.md §12), each a keydown and a keyup on its text box (else
   *  its element), never one it does not declare: Escape closes a list that ignores focusout and blur. */
  keys?: readonly DeclaredKey[];
  /** The element whose aria-expanded says whether the widget's list is open. Its declared activation toggles the list,
   *  so it is sent only while this says "false" (a second one would close it). */
  expanded?: Element;
  /** What a person sees as the widget (react-select's control). The widget is visible when its element is, or when its
   *  element sits inside this box, hidden only by its own opacity or by its own width (drawn wholly inside the box), and
   *  this box is visible: react-select draws its text box transparent while it shows an answer, and sizes an empty one
   *  to a space of the page's font, under 4 px wide in a narrow font. */
  box?: Element;
  /** CSS selectors of the widget's own busy signs, looked for in its own box and its list (a "Loading..." notice, a
   *  spinner): while one shows, its list is still loading. */
  busy?: readonly string[];
  /** The option a widget shows chosen when its own text does not name it (a flag and "+1" for "Canada +1"): one of
   *  `known`, else a label the page does not offer, else null when it shows none. */
  shownAnswer?: (known: readonly string[]) => string | null;
  /** A 'radio' widget's members, in option order, for a group of toggle buttons standard ARIA does not make one
   *  (Ashby's Yes/No: two buttons with aria-pressed in a div beside a hidden checkbox). Each is pressed with click()
   *  and read back by its aria-pressed or aria-checked, as an ARIA group's members are. */
  members?: readonly HTMLElement[];
  /** Native controls that are this widget's own (Ashby's Yes/No's display:none checkbox): never a field, and counted
   *  among the hidden controls the scan ignored. Each must sit inside the widget's element. */
  parts?: readonly Element[];
  /** The page marks the rest of the form aria-hidden while this widget's list is open (floating-ui's markOthers: Ashby's
   *  lists), so a scan then finds no other field, and this one by its placeholder: a search closes its list before
   *  each later query is guarded, which scans the form afresh. */
  hidesFormWhileOpen?: boolean;
  /** The part of one option of this widget's list that is its label, where the option shows more than the answer it
   *  stands for (Ashby's School: its name beside its country and its domain, while the box then holds the name alone):
   *  that element's visible text is the option's label, as it is matched and read back. Null: the whole option. */
  optionLabel?: (option: Element) => Element | null;
  /** A search whose list shows no option, no busy sign and no change this long after a query is taken to have found
   *  nothing (Ashby's "No results", which also shows while its search runs, about 0.8 s): sooner than the query's
   *  cap. */
  emptyAfterMs?: number;
  /** The list marks its first result aria-selected (or names it as the box's active descendant) as soon as it shows,
   *  before anything is chosen (Ashby's): a result's mark counts as the page's answer to a click only when the click
   *  set it. */
  highlightIsNoChoice?: boolean;
  /** The snapshot this declaration was written from. */
  snapshot: string;
}

/** What the page shows of a file the extension put into a file input (Adapter.uploadState). */
export type UploadState = 'confirmed' | 'failed' | 'pending';

/** A prefilled repeatable block, read into memory only for reconciliation. */
export interface PrefillEntryView {
  fingerprint: string;
  filled: boolean;
}

/** The account pages Sign-in mode Auto fills (v3 Phase 5). */
export type SignInWall = 'sign-in' | 'create-account';

/** A sign-in or create-account form (v3 Phase 5, Sign-in mode Auto), as an adapter declares it, or as the standard
 *  rule reads one (dom/sign-in-form.ts standardSignInForm). Elements only: nothing is read from them here. */
export interface SignInForm {
  /** The email or user-name box; null when the page asks for the password alone. */
  email: HTMLInputElement | null;
  password: HTMLInputElement;
  /** On a create-account page, the password typed again; null when the page asks for it once. */
  confirm: HTMLInputElement | null;
  /** The account's required terms boxes still unticked. */
  terms: HTMLInputElement[];
  /** Sign in, or Create account: the one control pressed. */
  button: HTMLElement;
}

export interface Adapter {
  id: AdapterId;
  /** Pure (url.ts): does this adapter handle this address? */
  matchesUrl(url: URL): boolean;
  /** Pure (url.ts): the canonical application URL, whose hash is the RunState's applicationKey; null when this page is
   *  not an application. */
  canonicalApplicationUrl(url: URL): string | null;
  /** The form root, from DOM anchors seen in snapshots. */
  detect(doc: Document): { formRoot: Element } | null;
  sections?(root: Element): Array<{ el: Element; label: string; kind?: 'experience' | 'education' | 'language' }>;
  labelFor?(control: Element): Element | null;
  /** Words added after the adapter's label (labelFor) for a control that shares its label element with others
   *  (Ashby's month and year lists under one "Start Date"): "month", "year". */
  labelSuffix?(control: Element): string | null;
  /** The visible help text of a control, or of a group's container, that no aria-describedby names. */
  descriptionFor?(control: Element): Element[];
  /** Whether the page marks a control, or a group's container, required where no attribute says so (a mark drawn by
   *  CSS after its label). */
  requiredFor?(control: Element): boolean;
  /** The layout the page reads a text control's value in, where neither its type nor a visible placeholder says it
   *  (Ashby's date box, whose placeholder is "Pick date..."): the core lays a date out by it. */
  formatFor?(control: Element): { format: FieldFormat; pattern?: string } | null;
  /** Whether the page shows a native radio or checkbox chosen, where its own checked property may not say it (Ashby
   *  draws the answer on the span beside an opacity-0 input, and setting .checked changes only the input); null for
   *  the input's own state. */
  checkedOf?(input: HTMLInputElement): boolean | null;
  /** Elements the scanner takes as widget candidates besides its own ARIA roles (Ashby's Yes/No groups), each asked of
   *  widgetFor; a native control inside one widgetFor declares is that widget's part, never a field nor a hidden
   *  control counted. */
  widgetRoots?(root: Element): Element[];
  /** Parts of the form root that hold none of the application's questions (Ashby's "Autofill from resume" uploader,
   *  which rewrites the form on Ashby's server): nothing inside one is a field, a flagged row or a counted control
   *  (still counted among the hidden controls the scan ignored). */
  excluded?(root: Element): Element[];
  /** The page saves every change to its own server as it is made, before Submit (Ashby's, about 0.5 s after each
   *  write): an AI draft is then held back until the person confirms it, while their setting asks for that. */
  autosaves?: boolean;
  /** Whether the page's own upload of the file named `fileName`, which the extension put into `input`, is done, failed
   *  or still under way, as the page shows it; null when the adapter reads no upload for this input (the input's own
   *  files decide, as for any page). */
  uploadState?(input: HTMLInputElement, fileName: string): UploadState | null;
  /** The element that shows the posting's own text (its description), or null while the page shows none. With this
   *  hook a posting page is read once it shows it (a page that draws it late), and on a page with a form only it counts
   *  as the posting read there: the rest of the page (a pane of facts, a header) is no posting. */
  postingText?(doc: Document): Element | null;
  /** The visible element standing in for a hidden native radio or checkbox. */
  proxyFor?(input: HTMLInputElement): Element | null;
  uploadWidgets?(root: Element): Array<{ control: Element; input: HTMLInputElement }>;
  widgetFor?(control: Element): WidgetDecl | null;
  isBusy?(doc: Document): boolean;
  stepSignature?(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] };
  nextButton?(root: Element): HTMLElement | null;
  /** Identified so it is never clicked. */
  submitButton?(root: Element): HTMLElement | null;
  /** Buttons beside the fields that do something else (fill the form from another service, locate the person, clear an
   *  answer, import a file from a drive): identified so they are never clicked, as Submit is not. */
  neverPress?(root: Element): Element[];
  /** 'unknown' is treated as final: nothing is pressed. */
  isFinalStep?(doc: Document): 'final' | 'not-final' | 'unknown';
  errors?(root: Element): Array<{ el: Element; fieldKeyHint?: string }>;
  repeatables?(root: Element): Array<{
    kind: 'experience' | 'education' | 'language';
    blocks(): Element[];
    addButton(): HTMLElement | null;
    currentlyHere?(block: Element): HTMLInputElement | null;
  }>;
  prefill?: { readEntries?(kind: string, blocks: Element[]): PrefillEntryView[] };
  authState?(doc: Document): 'sign-in' | 'create-account' | 'email-code' | 'entry-choice' | null;
  /** v3 Phase 5, Sign-in mode Auto: the platform's own sign-in or create-account form on this page, or null. Without
   *  this hook the standard rule reads it (autocomplete username/email and current-password/new-password, in one form
   *  with one submit button: dom/sign-in-form.ts). */
  signInForm?(doc: Document, wall: SignInWall): SignInForm | null;
  /** v3 Phase 5, the auto-apply agent: on a posting page that shows no form, the one control that opens the
   *  application (Greenhouse's and Lever's Apply, Ashby's Application tab), or null. Pressed only by
   *  the entry door of dom/fillers/not-submit.ts, for the agent alone. */
  entryControl?(doc: Document): HTMLElement | null;
  /** v3 Phase 5 review: the entry control is one of this adapter's own never-pressed controls (neverPress: Ashby's
   *  Application tab, which no run presses), and the entry door may press that one element, nothing beside it. Without
   *  this mark an entry control neverPress lists, holds or sits in is refused. */
  entryNeverPressed?: true;
  quirks?: {
    settleCapMs?: number;
    transitionCapMs?: number;
    /** The form root is drawn by the page's own script this long after the page loads, or after an address change,
     *  at most (Ashby's: 4.8 to 6.8 s live): the content runtime looks for it again as the page changes until then. */
    formLateMs?: number;
  };
}
