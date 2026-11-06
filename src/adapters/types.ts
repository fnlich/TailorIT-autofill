/*
 * What an adapter may know about a platform: only its quirks (form root, sections, step identity, Next and Submit,
 * repeatable sections, busy hints, upload widgets, auth state). Phase 0 ships this interface only. The generic adapter
 * and the Lever and Greenhouse ones come in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5. Every DOM hook is
 * written from the owner's snapshots and names the snapshot it came from; no selector is ever guessed.
 */
import type { FieldFormat, Platform } from '../core/enums';
import type { ShownBlock } from '../core/steps/blocks';
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
   *  its element, or its list: keyTarget), never one it does not declare: Escape closes a list that ignores focusout
   *  and blur. */
  keys?: readonly DeclaredKey[];
  /** Where the declared keys go: 'list', the widget's open list itself (Workable's dropdowns move focus there when they
   *  open, and close on an Escape there, never on one to their text box). Without it, its text box, else its
   *  element. */
  keyTarget?: 'list';
  /** The widget's text box is read-only by design (Workable's select-only dropdowns: readonly="true", a click opens the
   *  list and the page writes the chosen option's label into the box): its readonly attribute does not make the field
   *  read-only. Its aria-readonly="true" still does, and the scanner's rule stands for every control no adapter
   *  declares so. */
  readOnlyBox?: true;
  /** The page draws the widget's open list `position: fixed` at its field's place on screen (Workable's dropdowns), so a
   *  field below the fold opens its list beyond the viewport: the list is judged reachable where its field is, as a
   *  page element below the fold is (dom/visibility.ts followsItsField), never as a fixed element off the viewport. */
  listFollowsField?: true;
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

/** A block that shows a saved entry's summary (Adapter.prefill.readEntries: Workable's folded entries), read into
 *  memory only so the planner finds the profile entry it holds by its fingerprint: its index among the section's
 *  blocks, and the summary's words by the category each names (core/steps/blocks.ts ShownBlock). */
export type PrefillEntryView = ShownBlock;

/** The account pages Sign-in mode Auto fills (v3 Phase 5): a sign-in, an account's creation, and (v3 Phase 7b) an
 *  email gate, the email-first identity step whose Next sends the person a code (Oracle Recruiting Cloud's) or leads on
 *  to their account (iCIMS's): the email alone is typed there, never a password. */
export type SignInWall = 'sign-in' | 'create-account' | 'email-gate';

/** A sign-in, create-account or email-gate form (v3 Phase 5, Sign-in mode Auto), as an adapter declares it, or as the
 *  standard rule reads one (dom/sign-in-form.ts standardSignInForm, which reads no email gate). Elements only: nothing
 *  is read from them here. */
export interface SignInForm {
  /** The email or user-name box; null when the page asks for the password alone. An email gate always has one. */
  email: HTMLInputElement | null;
  /** v3 Phase 7b: on a create-account page an adapter declares, the email typed again (SuccessFactors' "Retype Email
   *  Address"); absent or null when the page asks for it once. Never on a form the standard rule reads. */
  confirmEmail?: HTMLInputElement | null;
  /** The password box; null on an email gate alone, which asks for none. */
  password: HTMLInputElement | null;
  /** On a create-account page, the password typed again; null when the page asks for it once. */
  confirm: HTMLInputElement | null;
  /** The account's required terms boxes still unticked: the form's required ones, or (v3 Phase 7b) the boxes the
   *  adapter declares the account's terms where the page marks none required (Workday's createAccountCheckbox). */
  terms: HTMLInputElement[];
  /** Sign in, Create account or Next: the one control pressed. A declared form's is named by an identity of its own
   *  in the snapshot (an id, its data-automation-id, its title or its words), never as "the form's one submit button";
   *  it may be the visible face the page draws over its own button (Workday's div[role=button] over an aria-hidden
   *  submit button), inside the form. */
  button: HTMLElement;
  /** v3 Phase 7b: on a form an adapter declares, the adapter's own <form> element, by its snapshot's markup: every box
   *  and the button must belong to it (the v3 Phase 6/7b review, S8). Required of a declared form. */
  form?: HTMLFormElement;
  /** v3 Phase 7b: set by dom/sign-in-form.ts signInFormOf on a form an adapter declares (never by the standard rule).
   *  Its terms are at most one box. */
  declared?: true;
  /** v3 Phase 7b, a declared form's per-box opt-out of the colour test alone (never a password box): the boxes the
   *  snapshot shows drawn in front of a background whose colours cannot be worked out (Oracle's gate email, over the
   *  flow's image), held to every other honeypot rule. Each must be one of the form's own boxes. */
  colourUnknown?: readonly HTMLInputElement[];
  /** v3 Phase 7b: on a declared form, the page enables its button only once the form is filled (Oracle's NEXT, iCIMS's
   *  Next behind its GDPR box): a button disabled when the form is read is taken, and the sign-in waits a moment,
   *  bounded, for it to be enabled after typing (content/sign-in.ts). Without this mark a disabled button refuses the
   *  form ('disabled'), as it does every form the standard rule reads. */
  enablesWhenFilled?: true;
  /** v3 Phase 7b: a declared form that asks for more than Sign-in Auto types (SuccessFactors' account creation: names, a
   *  phone, a country and a terms dialog, all the person's): its credential boxes are typed and its button is the
   *  person's to press. Sign-in Auto presses nothing there (its door refuses such a form) and answers 'continue', the run
   *  then pausing at the page for the rest. */
  personPresses?: true;
  /** v3 Phase 7b: the page's own script sends this form (a single-page application's sign-in: no method and no action
   *  written, Workday's and Oracle's), declared by the adapter alone, never by the standard rule. dom/sign-in-form.ts
   *  signInRefusal then takes a form with neither attribute on an https page of a host the every-site sign-in covers,
   *  and content/sign-in.ts keeps the browser from ever sending it itself as a GET while it signs in. */
  scriptSubmits?: true;
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
  /** An untrusted key the page needs on a text box around its text write (Workable's date masks take a written value
   *  only after a keydown, then open their calendar): sent as a keydown and a keyup to that box right before the
   *  value is written, and once more after its events, which closes what the page opened. One of DECLARED_KEYS, never
   *  Enter (a date mask reads Enter as today); null for any other control. */
  keyAroundWrite?(control: Element): DeclaredKey | null;
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
    /** The block's own Save, where the page keeps an entry only once it is pressed (Workable's Education and
     *  Experience editors: "Update", which folds the editor into the entry's summary); null when the block shows none
     *  (a saved entry). Pressed once after the step's fill, never in a dry run (content/repeatables.ts saveBlocks). */
    save?(block: Element): HTMLElement | null;
  }>;
  /** The blocks that show a saved entry's summary, with its words (PrefillEntryView): the planner finds the entry each
   *  holds by its fingerprint, never by its place (the Phase 7a review: Workable's saved Education and Experience). */
  prefill?: { readEntries?(kind: string, blocks: Element[]): PrefillEntryView[] };
  /** The account or choice page the document shows, where the platform's own markup says it (each named in its
   *  snapshot): a sign-in, an account's creation, an email gate (v3 Phase 7b: an email-first identity step, no
   *  password), an email code, a choice of how to apply, or (v3 Phase 7b) a password reset ('forgot-password': the
   *  person's alone; nothing is ever typed into its email box); null for none. */
  authState?(doc: Document): 'sign-in' | 'create-account' | 'email-gate' | 'email-code' | 'entry-choice'
    | 'forgot-password' | null;
  /** v3 Phase 5, Sign-in mode Auto: the platform's own sign-in, create-account or (v3 Phase 7b) email-gate form on this
   *  page, or null. Without this hook the standard rule reads it (autocomplete username/email and
   *  current-password/new-password, in one form with one submit button: dom/sign-in-form.ts). */
  signInForm?(doc: Document, wall: SignInWall): SignInForm | null;
  /** v3 Phase 7b, Sign-in mode Auto: on a wall whose form the page shows only after a first choice (Workday's landing:
   *  Apple, Google, or "Sign in with email"), the one control that shows it, or null once it shows (or none is
   *  declared). Pressed only by the sign-in prelude door of dom/fillers/not-submit.ts, for Sign-in Auto alone, and only
   *  while the page shows no form for the wall. */
  signInPrelude?(doc: Document, wall: SignInWall): HTMLElement | null;
  /** v3 Phase 5, the auto-apply agent: on a posting page that shows no form, the one control that opens the
   *  application (Greenhouse's and Lever's Apply, Ashby's Application tab), or null. Pressed only by
   *  the entry door of dom/fillers/not-submit.ts, for the agent alone. Where quirks.entryPresses allows it, a press
   *  that leaves the page in the same document is followed by the next control the hook answers then (v3 Phase 7b:
   *  Workday's Apply opens its choice in place, and the hook then answers its Apply Manually). */
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
    /** v3 Phase 7b: how long the agent's entry waits for this adapter's entry control to be drawn, where its page
     *  draws it later than most (Workday's Apply 6 to 11 s after load); content/press.ts ENTRY_WAIT_MS (8 s) when absent,
     *  held at its ENTRY_WAIT_CAP_MS. */
    entryWaitMs?: number;
    /** v3 Phase 7b: the entry controls the agent's one agent/enter may press in one document, one after the other
     *  (Workday's 2: its Apply draws the choice in place, whose Apply Manually entryControl answers then), held at
     *  content/press.ts ENTRY_MAX_PRESSES. 1 when absent. */
    entryPresses?: number;
    /** A failed upload can take the whole form down (Workable's page shows its error page in the form's place: the
     *  live check of 2026-11-02), so a pass writes its files after every other field. */
    filesLast?: true;
  };
}
