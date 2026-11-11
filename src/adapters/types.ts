/*
 * What an adapter may know about a platform: only its quirks (form root, sections, step identity, Next and Submit,
 * repeatable sections, busy hints, upload widgets, auth state). Phase 0 ships this interface only. The generic adapter
 * and the Lever and Greenhouse ones come in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5. Every DOM hook is
 * written from the owner's snapshots and names the snapshot it came from; no selector is ever guessed.
 */
import type { FieldFormat, Platform } from '../core/enums';
import type { ShownBlock } from '../core/steps/blocks';
import type { QueryKey, WidgetKey } from '../dom/fillers/events';
import type { StoredListId } from '../shared/learned-lists';

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
  keys?: readonly WidgetKey[];
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
  // ── v4 (drop) ──
  /** A search's results list that no ARIA names (Lever's location search: a div of divs, the live capture of
   *  2026-11-07), as its adapter read it from a capture: the element that holds the results, the selector of one result
   *  inside it, and the one event that chooses a result where click() does not ('mousedown': Lever chooses on it). The
   *  widget helpers read, choose from and close this list as they do a listbox (dom/widgets/aria.ts widgetListOf). */
  results?: WidgetResults;
  /** A declared key sent, as a keydown and a keyup, to the text box after each typed query, for a search that starts
   *  on a keydown and never on the input event (Lever's location search: any key but its arrows and Enter starts it). */
  queryKey?: QueryKey;
  // ── s2 lists (snapshot round 2, decision 1: stored lists, chosen at once) ──
  /** The id of the combobox's whole list as the extension stores it from the snapshots (shared/learned-lists.ts
   *  STORED_LIST_IDS; the labels live in the worker, background/stored-lists.ts, never in the content script): every
   *  option's label as a whole read takes it (Workday's "Select One" first included), in the list's order, served by
   *  lists/known before a step's loop (ScanOptions.storedLists). It is the field's reading at scan time, so the planner
   *  plans it on its first pass and its list is never opened to be read. Its choice opens the list once, finds the
   *  planned option by its label at its place, clicks it and reads it back; a list the page shows otherwise is read
   *  whole as before (options-changed), and that read is the field's reading from then on. A scan without the list
   *  (none served) reads the widget as lazy, as before. */
  storedList?: StoredListId;
  /** The review of round 2, L2: the value of the field this dropdown's list depends on, as the page shows it now
   *  (Workday's State: the country its Country shows), where it has one: a list learned for it is kept and offered
   *  under its label with this value, so another country's States are never offered for it. Page text, hashed into
   *  the key (dom/widgets/known.ts learnedListKey). */
  learnContext?: string;
  /** The page draws the widget's whole list at once, every option in the DOM (Workday's dropdowns: 250 country rows in
   *  a box 200 px high), never a part at a time: a read of it scrolls through it without waiting for rows to be drawn,
   *  each view read at once, and an option is shown again the same way. */
  drawnWhole?: true;
  // ── end s2 lists ──
  // ── jr6 ENGINE E0 (FIXPLAN §3.1 items 1 to 5): declared by platform widget hooks; types only until E1 and E3 ──
  /** jr6 FIXPLAN §3.1 item 1 (ICIMS-01 and icims-new-1; every iCIMS Candidate Profile: fixtures/icims/githubinc-profile
   *  .frame-1.html, and snapshot6 icims1 and icims2's jr6 cases jr6-sentinel-profile.frame-1, jr6-ars-profile and
   *  jr6-ars-profile-address): the widget's own text box where it sits outside the widget's element (iCIMS's dropdown:
   *  its anchor opens a container beside it, whose search box takes the query). It is the widget's part, never a field
   *  nor a control the scan counts, and a search types into it. Read from ENGINE E1 on (FIXPLAN §6.2 item 2). */
  input?: HTMLInputElement;
  /** jr6 FIXPLAN §3.1 item 2 (SR-2; SmartRecruiters' City search on fixtures/smartrecruiters/xplor-one-click.html and
   *  the jr6 case jr6-wiser-one-click): a query shorter than this many characters is never typed (the page's own
   *  minimum, its minquerylength). Read from ENGINE E1 on (FIXPLAN §6.2 item 3). */
  minQueryLength?: number;
  /** jr6 FIXPLAN §3.1 item 3 (U-04; UltiPro's School Name on fixtures/ultipro/resume-review.html): a search whose typed
   *  text stands as the answer where no result matches it: the box keeps the typed text (checked by its value) instead
   *  of being put back. Read from ENGINE E1 on (FIXPLAN §6.2 item 5). */
  freeText?: true;
  /** jr6 FIXPLAN §3.1 item 4 (SR-1; the screening step's required dropdowns on fixtures/smartrecruiters/xplor-screening
   *  .html, whose options the page publishes in its questions' definition): the whole list as the page publishes it,
   *  every option's label in the page's order. It is the field's reading at scan time, as a storedList is (never
   *  'lazy'): its choice opens the list, finds the planned option by its label and reads it back. Read from ENGINE E1
   *  on (FIXPLAN §6.2 item 3). */
  knownOptions?: readonly string[];
  /** jr6 FIXPLAN §3.1 item 5 (WD-18: Workday's "Type to Add Skills" on fixtures/workday/resolvetech-my-experience.html
   *  and s2-exelixis-my-experience.html; U-05: UltiPro's Skills on fixtures/ultipro/resume-review.html): a box that
   *  takes several answers one at a time (WidgetTags). Read from ENGINE E3 on (FIXPLAN §6.2 item 13). */
  tags?: WidgetTags;
  // ── end jr6 ENGINE E0 ──
  /** The snapshot this declaration was written from. */
  snapshot: string;
}

/** jr6 FIXPLAN §3.1 item 5 (WD-18, U-05): a box that takes several answers one at a time, each shown as a chip once it
 *  is added (WidgetDecl.tags). It is scanned as one field of kind 'text'. Its filler (ENGINE E3) splits the planned
 *  text on MANY_SEPARATOR (core/resolver/values.ts, RULES R0: the separator manyValues joins a text box's values with),
 *  skips a value the chips already show (case-insensitive), adds each other one, stops at `cap` and verifies by the
 *  chips; it never removes a chip the run did not add. */
export interface WidgetTags {
  /** The chips the box shows now, one per answer it holds. */
  chips(): readonly Element[];
  /** The control that adds the typed value (UltiPro's Add beside its Skills box), or null while none shows. */
  add?(): HTMLElement | null;
  /** The typed value is added by choosing the result that matches it exactly (Workday's Skills prompt). */
  search?: true;
  /** The most chips the box takes. */
  cap?: number;
}

/** A search's results list that no ARIA names (WidgetDecl.results). */
export interface WidgetResults {
  /** The element that holds the results: open while a person can see it. s2 wd: or the hook that finds it now, for a
   *  page that draws the list only while it is open, at the end of the body (Workday's prompts: the
   *  responsiveMonikerPrompt whose data-associated-widget names the prompt, fixtures/workday/s2-verily-field-of-study-
   *  open.html); null while the page shows none. */
  list: Element | (() => Element | null);
  /** A CSS selector for one result inside `list`. */
  option: string;
  /** The one event that chooses a result instead of click() on it: 'mousedown' (Lever's), or, s2 wd, 'label': click()
   *  on the result's label part (WidgetDecl.optionLabel), so the click goes through the page's own row element inside
   *  the result to the result itself (Workday's promptOption inside its promptLeafNode inside the menuItem). */
  choose?: 'mousedown' | 'label';
  /** s2 wd: a CSS selector a result matches when it only opens a list of its own, a category and no answer (Workday's
   *  2-level source list: a row with a chevron and no radio, fixtures/workday/s2-verily-source-open.html): read as a
   *  result that cannot be chosen, so it is never chosen. */
  unchoosable?: string;
  // ── jr6 ENGINE E0 (FIXPLAN §3.1 items 6 and 7): declared by SmartRecruiters; types only until E1 ──
  /** jr6 FIXPLAN §3.1 item 6 (SR-1: the screening dropdowns on fixtures/smartrecruiters/xplor-screening.html; SR-6: the
   *  phone's country on fixtures/smartrecruiters/xplor-one-click.html): the results as the page draws them, where
   *  `option` cannot reach them from `list` (options slotted into the list or drawn in another shadow tree: a slot's
   *  assigned elements). Read in place of `option`'s matches from ENGINE E1 on (FIXPLAN §6.2 items 1 and 3). */
  options?(list: Element): readonly Element[];
  /** jr6 FIXPLAN §3.1 item 7 (SR-1, fixtures/smartrecruiters/xplor-screening.html: the inner .c-spl-dropdown-item of
   *  each spl-select-option): the element a choice of `option` clicks, where a click on the result itself chooses
   *  nothing; null: the result itself. Read from ENGINE E1 on (FIXPLAN §6.2 items 1 and 3). */
  pressTarget?(option: Element): HTMLElement | null;
  // ── end jr6 ENGINE E0 ──
}

// ── s2 wd: a date drawn in parts ──
/** A date its page draws as separate parts, each a control a person cannot see behind the digits it displays (Workday's
 *  date input: per part an aria-hidden display over a 1 px spin button, fixtures/workday/s2-exelixis-my-experience
 *  .html), declared by its adapter (Adapter.dateFor) as one field of kind 'date' whose control is the element around
 *  the parts. Its layout is the parts' (month and year: month-year; a year alone: year; month, day and year: date). */
export interface DatePartsDecl {
  /** The parts in the order the page draws them; each control must sit inside the declared element. */
  parts: ReadonlyArray<{ part: 'month' | 'day' | 'year'; input: HTMLInputElement; display: Element | null }>;
  /** The digits are typed, one key each, into a part whose value setter's write the page did not take. */
  keys?: 'digits';
  /** The fix of 2026-11-08: the alert the page shows for this date when it judged it wrong, or null while it shows
   *  none (Workday's field alert under the date, snapshot5): a date that holds the planned value but shows its alert
   *  (left before it was whole) is left once more, so the page validates it again. */
  alert?: () => Element | null;
  /** The snapshot this declaration was written from. */
  snapshot: string;
}
// ── end s2 wd ──

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
   *  and the button must belong to it (the v3 Phase 6/7b review, S8). Required of a declared form, but a container's. */
  form?: HTMLFormElement;
  /** The snapshot build of 2026-11-06 (core pass Z1, item 24): a declared sign-in container (Adapter.signInContainer)
   *  in place of `form`, the adapter's own element around the account part (ADP's div.guest-login-container, no <form>;
   *  UltiPro's form#registrationDetailsForm, its Create account outside it). Every box inside it, none of them a password
   *  box (a password goes only into an adapter's own <form>); its button the one the adapter names, in its document. */
  container?: Element;
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

// ── jr6 ENGINE E0 (FIXPLAN §3.1 items 12, 13 and 15): the account pages' and the IForm chain's facts, types only ──
/** jr6 FIXPLAN §3.1 item 12 (WD-02, ICIMS-07): a character class a page's password rules require; 'alpha' is a letter
 *  of either case. */
export type PagePasswordClass = 'upper' | 'lower' | 'digit' | 'special' | 'alpha';

/** jr6 FIXPLAN §3.1 item 12 (WD-02: Workday's Create Account, fixtures/workday/workday-create-account.html and
 *  s2-verily-create-account.html; ICIMS-07: iCIMS's "Create a login", fixtures/icims/githubinc-profile.frame-1.html and
 *  the jr6 case jr6-sentinel-basic-info.frame-1): a create-account page's own password rules, as the page shows them
 *  beside its password box (Adapter.passwordRules). Read fail open: a rule the adapter cannot read with certainty is
 *  left out. The page's words only, never a value. */
export interface PagePasswordRules {
  /** The fewest characters the page takes ("A minimum of N characters", "at least: N characters"). */
  minLength?: number;
  /** The character classes the page requires. */
  requires?: readonly PagePasswordClass[];
  /** The password may not be the same as the login. */
  notLogin?: true;
}

/** jr6 FIXPLAN §3.1 item 13 (WD-05; Workday's Sign In after Create Account, fixtures/workday/verily-sign-in-verify
 *  .html): the kind of an account error a page shows (Adapter.accountErrorKind): 'verify-email', the account waits for
 *  the person to verify their email; 'reset-password', the page asks for the password to be reset; 'wrong-credentials',
 *  the email or the password is wrong, or the account is locked. */
export type AccountErrorKind = 'verify-email' | 'reset-password' | 'wrong-credentials';

/** jr6 FIXPLAN §3.1 item 15 (ICIMS-17; iCIMS's IForm steps, the jr6 cases jr6-nyu-iform-signature, jr6-nyu-iform-offer
 *  and jr6-sentinel-iform-selfid, each a portal frame-1 and a leaf frame-2): what a portal frame's step bar says, for
 *  the IForm leaf frame inside it, which shows no bar of its own and, on another origin, cannot read the portal's
 *  (Adapter.chainStepFacts). Page structure only, never a value. */
export interface ChainStepFacts {
  /** The current step's id, as the bar names it. */
  stepId: string;
  /** The current step is the bar's last. */
  lastStep: boolean;
  /** The step's packet counter, "( n/m )" in its title: the nth form of m; null where the title shows none. */
  packet: { n: number; m: number } | null;
  /** How many packet counters the page shows (more than one: the facts cannot say which form is the leaf's). */
  counters: number;
}
// ── end jr6 ENGINE E0 ──

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
  /** Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 28): the adapter's label (labelFor, with its labelSuffix) is read
   *  before the control's label[for], aria-labelledby and wrapping label, where this says so (Jobvite's signature
   *  name and date pairs: their own label[for] with the words that make it a signature). A visible label only: where
   *  the adapter's label is hidden or empty, the standard order stands. */
  labelFirst?(control: Element): boolean;
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
   *  value is written, and once more after its events, which closes what the page opened. One of WIDGET_KEYS, never
   *  Enter (a date mask reads Enter as today); null for any other control. */
  keyAroundWrite?(control: Element): WidgetKey | null;
  /** DESIGN-NEW-ATS Phase 0: the element that holds one question's options where the page draws no fieldset,
   *  radiogroup or group around them (JazzHR's Yes/No checkbox questions: two boxes with different names in a
   *  div.form-group, the question a label whose for names nothing), for a checkbox, or a radio with no name; null where
   *  the page's own markup decides. The scanner asks it before closest('fieldset, [role=group]') (dom/scan.ts
   *  checkboxContainer, groupContainer): its boxes form one checkbox group when the adapter labels that element
   *  (labelFor), its only box a lone checkbox, as a legend-less fieldset the adapter labels does (Ashby's). */
  groupOf?(control: Element): Element | null;
  /** Whether the page shows a native radio or checkbox chosen, where its own checked property may not say it (Ashby
   *  draws the answer on the span beside an opacity-0 input, and setting .checked changes only the input); null for
   *  the input's own state. */
  checkedOf?(input: HTMLInputElement): boolean | null;
  /** jr6 FIXPLAN §3.1 item 8 (ICIMS-14; the self-identification IForms: fixtures/icims/edgewater-self-id-veteran
   *  .frame-2.html, nyu-self-id-disability.frame-2.html and the jr6 case jr6-sentinel-iform-selfid.frame-2): the words
   *  of a radio's or a checkbox's option where no label element holds them, read from the text run the page draws after
   *  it; null where the page's own labels decide. Read by the scanner from ENGINE E2 on (FIXPLAN §6.2 item 8). */
  optionTextFor?(input: HTMLInputElement): string | null;
  /** jr6 FIXPLAN §3.1 item 9 (O4; Oracle's phone number on fixtures/oracle/hjf-apply-section.html and hjf-after-submit
   *  .html, a box with no border or background of its own inside a bordered group beside its country code): the element
   *  that draws a borderless control's box, or null. dom/camouflage.ts takes it as the control's drawn box where it is
   *  visible, encloses the control and shows a border or a background (ENGINE E2, FIXPLAN §6.2 item 7). */
  controlBox?(control: Element): Element | null;
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
  /** jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4; JazzHR's classic layout, snapshot6 applytojob, the jr6 case
   *  jr6-centroid-form, whose #resumator-resume-value sits hidden until "Attach resume" is pressed): for a file input
   *  its adapter shows only through a link (configured UploadRule.reveal: #resumator-choose-upload), that link inside
   *  the upload's area and the area (either null where the page shows none: the input is then the person's); null for
   *  an input whose adapter declares no reveal. Pressed by one door alone, the upload filler's reveal door
   *  (dom/fillers/not-submit.ts, through dom/fillers/upload.ts revealUpload), at most once per document, while the
   *  input is hidden; the link stays in neverPress for every other path. */
  uploadReveal?(input: HTMLInputElement): { reveal: HTMLElement | null; area: Element | null } | null;
  /** The core pass of 2026-11-06: whether the page shows `input`'s field already holding a file it took (its upload
   *  shown done), whatever the file's name, while the input itself may hold none. Read by every scan, so before any
   *  upload is planned: such a field holds a file (CurrentValue 'files'), which the planner keeps (prefill-kept) and
   *  never uploads again. Workday's My Experience shows the resume Workday read at "Autofill with Resume" so
   *  (fixtures/workday/web-my-experience.html). Absent or false: the input's own files decide. */
  uploadHeld?(input: HTMLInputElement): boolean;
  /** The integration of 2026-11-06: the names the page shows beside the files of uploadHeld, as a person reads them
   *  (CurrentValue `names`). Under "Résumé already on the page: Upload mine again" a field showing a file named as the
   *  person's chosen résumé keeps it, since a field that takes several files (Workday's) would otherwise hold it twice.
   *  Absent, or no name read: a file the page shows is replaced as the setting says. */
  uploadHeldNames?(input: HTMLInputElement): string[];
  /** The element that shows the posting's own text (its description), or null while the page shows none. With this
   *  hook a posting page is read once it shows it (a page that draws it late), and on a page with a form only it counts
   *  as the posting read there: the rest of the page (a pane of facts, a header) is no posting. */
  postingText?(doc: Document): Element | null;
  /** The visible element standing in for a hidden native radio or checkbox. */
  proxyFor?(input: HTMLInputElement): Element | null;
  uploadWidgets?(root: Element): Array<{ control: Element; input: HTMLInputElement }>;
  // ── v5 p2-fill (PLAN decision 14) ──
  /** Résumé controls that open the site's own file picker: a button the person presses to attach a file, with no file
   *  input of the form behind it (the page makes one, or calls showOpenFilePicker, when it is pressed), each written
   *  from a snapshot or a read-only public capture of the control before an upload. Each one a person can see is a file
   *  field of its own (FieldTarget.picker), its file given through the page's own picker armed for one press
   *  (dom/fillers/picker.ts, page/picker.ts). None is declared yet: no snapshot shows one (docs/OWNER-QUESTIONS.md). */
  uploadPickers?(root: Element): HTMLElement[];
  /** v5 p2-fill review (security 7c): where a press of such a control opens its file input, from the same snapshot (a
   *  page that keeps the input apart from its button: Dropzone's under the body); absent: the control's parent. A file
   *  input the page clicks during the press is taken only inside it (or made at the press and never put in the page). */
  uploadPickerScope?(control: HTMLElement): Element | null;
  // ── end v5 p2-fill ──
  widgetFor?(control: Element): WidgetDecl | null;
  /** jr6 FIXPLAN §3.1 item 10 (ICIMS-02: State after Country, the jr6 cases jr6-ars-profile and
   *  jr6-ars-profile-address; ADP-2: "State / Territory" after Country, the jr6 case jr6-personal-us-state; O3:
   *  Oracle's address block, fixtures/oracle/hjf-apply-section.html; ICIMS-19: "Please specify" after "How did you
   *  hear about us?", the jr6 case jr6-ars-profile-filled): the control whose write resets this one (a parent whose
   *  answer redraws, reloads or enables it), or null. A pass writes the parent first and lets the dependent settle, and
   *  a dependent whose parent was written is planned again (ENGINE E3, FIXPLAN §6.2 item 14). */
  dependsOn?(control: Element): Element | null;
  /** s2 wd: a date drawn in parts (DatePartsDecl), asked of each element the scanner reads as no field and no widget
   *  (Workday's div[role=group][data-automation-id=dateInputWrapper]); null for any other. */
  dateFor?(control: Element): DatePartsDecl | null;
  isBusy?(doc: Document): boolean;
  stepSignature?(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] };
  /** jr6 FIXPLAN §3.1 item 16 (ICIMS-17), here and on isFinalStep and stepSubmitNext.laterStep: `facts`, the step
   *  facts its portal frame's bar gives an IForm leaf frame (ChainStepFacts), which SHELL passes (FIXPLAN §6.12
   *  item 2); absent or null elsewhere. No adapter reads them yet. */
  nextButton?(root: Element, facts?: ChainStepFacts | null): HTMLElement | null;
  /** Identified so it is never clicked. */
  submitButton?(root: Element): HTMLElement | null;
  /** Buttons beside the fields that do something else (fill the form from another service, locate the person, clear an
   *  answer, import a file from a drive): identified so they are never clicked, as Submit is not. */
  neverPress?(root: Element): Element[];
  /** 'unknown' is treated as final: nothing is pressed. jr6 FIXPLAN §3.1 item 16: `facts` as for nextButton. */
  isFinalStep?(doc: Document, facts?: ChainStepFacts | null): 'final' | 'not-final' | 'unknown';
  // ── snapshot build 2026-11-06 (core-x, items 1 and 2) ──
  /** The platform's step buttons whose words say Submit on every step, the last one's or not (iCIMS's "Submit Profile"
   *  and "Submit": docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), and the page's own step bar. Only on a step isFinalStep reads 'not-final' is
   *  such a button the step machine's Next (dom/fillers/not-submit.ts), and only when it is the adapter's nextButton
   *  itself, matches one of `buttons` (CSS selectors, each naming one step's button by its own id: never "the form's
   *  submit button") and `laterStep` answers the bar's item after the current one, which a person can see. On 'final' or
   *  'unknown' it is the application's Submit, under every Submit gate. */
  stepSubmitNext?: {
    buttons: readonly string[];
    /** The step bar's item after the current one, a person can see; null when the bar shows none (the last step, no
     *  bar, a bar the adapter cannot read with certainty). jr6 FIXPLAN §3.1 item 16: `facts` as for nextButton. */
    laterStep(doc: Document, facts?: ChainStepFacts | null): Element | null;
  };
  /** jr6 FIXPLAN §3.1 item 15 (ICIMS-17; ChainStepFacts names its snapshots): on a portal frame that draws the step bar
   *  around an IForm leaf frame, what the bar says (its current step, whether it is the last, the packet counter); null
   *  on any other page. Read in the portal frame; SHELL relays them to the leaf (FIXPLAN §6.12 item 2). */
  chainStepFacts?(doc: Document): ChainStepFacts | null;
  /** The create-account part an application form holds inside one of its steps (iCIMS's Candidate Profile, "Create a
   *  login": Login, Password, Password (Re-enter)), an element inside the form root that holds the adapter's declared
   *  create-account form (signInForm 'create-account') and nothing else of the application; null where the step shows
   *  none. Its password boxes never make the page an account's creation (dom/pause-detect.ts): the rest of the form
   *  fills as usual. Nothing in it is filled from the profile (the adapter excludes it from the fields); it follows
   *  Sign-in mode (Auto types the saved job-site sign-in into it, its button the person's; Manual leaves it to the
   *  person), and Next and Submit hold while one of its required boxes is empty (dom/account-section.ts). jr6: where no
   *  single element holds that part alone, the adapter declares its rows instead (accountRows). */
  accountSection?(root: Element): Element | null;
  /** jr6 FIXPLAN §3.1 item 11 (ICIMS-04; snapshot6 icims1, careers-sentinel's Basic Information, the jr6 case
   *  jr6-sentinel-basic-info.frame-1): the create-account part as rows, where no single element holds it alone (the
   *  Login, Password and Re-enter rows of a pane that also asks the person's name and email); null where the step
   *  shows none. Rows, where a page answers some, are read in place of accountSection's answer. The plan widens
   *  accountSection's answer to a list; it is a hook of its own instead, so accountSection's answer stays one element
   *  for the code and tests that read it as one (icims-core.browser.test.ts). dom/account-section.ts accountRowsOf
   *  reads both as one list; until ENGINE E2 (FIXPLAN §6.2 item 6) only a list of one is a section. */
  accountRows?(root: Element): readonly Element[] | null;
  /** core-x, item 3: on a company's wrapper page (never a root), the frame of the same host it draws the application
   *  in (iCIMS's iframe#icims_content_iframe, at the posting's own address with ?in_iframe=1); null on any other page.
   *  The agent's presses, Next, Submit, the success read and Sign-in Auto act in that frame (content/runtime.ts
   *  claimsApplication, background/frames.ts claimFrameOf), never in the wrapper. */
  applicationFrame?(doc: Document): HTMLIFrameElement | null;
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
    /** jr6 FIXPLAN §3.1 item 17 (WD-07: Workday's My Experience after "Autofill with Resume", fixtures/workday/
     *  s2-exelixis-my-experience.html; ICIMS-22: iCIMS's profile after its résumé parse, the jr6 case
     *  jr6-nyu-profile-parsed.frame-1): the block's own Delete, or null where it shows none. Never pressed by a run:
     *  only ENGINE's gated door may press it, after owner question Q1 (FIXPLAN §6.2 item 16). */
    removeButton?(block: Element): HTMLElement | null;
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
  // ── jr6 ENGINE E0 (FIXPLAN §3.1 items 12 to 14): declared by Workday and iCIMS, read by SHELL; types only ──
  /** jr6 FIXPLAN §3.1 item 12 (WD-02, ICIMS-07; PagePasswordRules names their snapshots): the password rules the page
   *  shows for `form`, a create-account form of its own (signInForm 'create-account', or its account section's), read
   *  fail open: null where it shows none the adapter can read. SHELL checks the saved password against them before
   *  typing it (FIXPLAN §6.12 item 1). */
  passwordRules?(form: SignInForm): PagePasswordRules | null;
  /** jr6 FIXPLAN §3.1 item 13 (WD-05; AccountErrorKind names its snapshot): the kind of the account error `el` shows,
   *  `el` one of the errors the adapter reads on its sign-in or create-account page (errors: Workday's alerts above its
   *  form); null where its words name none of the kinds. SHELL tells the person what to do by it (FIXPLAN §6.12
   *  item 4). */
  accountErrorKind?(el: Element): AccountErrorKind | null;
  /** jr6 FIXPLAN §3.1 item 14 (WD-03; Workday's Sign In page of a tenant where the person has no account,
   *  fixtures/workday/workday-sign-in.html, workday-landing.html and the jr6 case jr6-brookfield-sign-in): its "Create
   *  Account" link while it shows, or null. Never pressed by a run: only SHELL's gated door may press it, after owner
   *  question Q4 (FIXPLAN §6.12 item 8). */
  createAccountSwitch?(doc: Document): HTMLElement | null;
  // ── end jr6 ENGINE E0 ──
  /** v3 Phase 5, the auto-apply agent: on a posting page that shows no form, the one control that opens the
   *  application (Greenhouse's and Lever's Apply, Ashby's Application tab), or null. Pressed only by
   *  the entry door of dom/fillers/not-submit.ts, for the agent alone, and (v5 p2-fill) for the person's Open
   *  Application (the panel's main button on such a page: content/runtime.ts atWall). Where quirks.entryPresses allows it, a press
   *  that leaves the page in the same document is followed by the next control the hook answers then (v3 Phase 7b:
   *  Workday's Apply opens its choice in place, and the hook then answers its Apply Manually). */
  entryControl?(doc: Document): HTMLElement | null;
  /** v3 Phase 5 review: the entry control is one of this adapter's own never-pressed controls (neverPress: Ashby's
   *  Application tab, which no run presses), and the entry door may press that one element, nothing beside it. Without
   *  this mark an entry control neverPress lists, holds or sits in is refused. */
  entryNeverPressed?: true;
  // ── snapshot build 2026-11-06 (core pass Z1, items 24 and 27) ──
  /** Core pass Z1, item 27: on an entry-choice consent state (authState 'entry-choice'), the consent form its entry
   *  control submits (Jobvite's form[name=consentForm], whose "I Accept" is a type=submit button) and the selects that
   *  form holds beside the consent choice (its residence select); null on any other page. The agent's entry door
   *  (dom/fillers/not-submit.ts) may submit that form only, by the entry control alone, and only while
   *  it holds no control but that one and those selects: nothing else is submitted. */
  entryConsentForm?(doc: Document): { form: HTMLFormElement; selects: readonly Element[] } | null;
  /** Core pass Z1, item 24: on a page the run fills like a step (no pause), its account or code-sending part (ADP's
   *  guest page, whose Continue mails a code; UltiPro's account step, whose Create account makes the account), declared
   *  as a SignInForm whose `container` stands for the adapter's own <form>: its boxes inside the container, its button
   *  one the adapter names, in the container's document, inside the container or not. Its button follows Sign-in mode:
   *  Auto presses it once the step is filled and rests (content/sign-in.ts, container mode, every Sign-in Auto guard
   *  held), Manual leaves it to the person. Null on any other page. */
  signInContainer?(doc: Document): SignInForm | null;
  // ── end core pass Z1, items 24 and 27 ──
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
    // ── v5 p2-fill ──
    /** The page reads the résumé put into its form and fills the application's fields from it (Rippling's "The résumé
     *  will be parsed to fill in the application details", iCIMS's "Parsing resume, please wait..."), each named in its
     *  adapter from a snapshot: a pass writes the résumé before every other field and waits for the page's parse
     *  (dom/resume-parse.ts) before it writes the rest over it (Jobright uploads the résumé first for the same reason). */
    resumeParse?: true;
    // ── end v5 p2-fill ──
    /** jr6 FIXPLAN §3.1 item 18 (U-06; UltiPro's résumé parser on fixtures/ultipro/application.html): the longest a
     *  pass waits for this page's parse (resumeParse), in place of dom/resume-parse.ts PARSE_CAP_MS (20 s), for a page
     *  whose parse takes longer. ENGINE reads it after owner question Q3 (FIXPLAN §6.2 item 17); nothing does yet. */
    resumeParseCapMs?: number;
    // ── jr6 APPLYPLAN A0 item 3 (decision D5): types only; APPLYPLAN F2 builds the behaviour ──
    /** jr6 APPLYPLAN D5 (B5; verily's steps at …/apply, snapshot1 and snapshot4, fixtures/workday/
     *  s2-verily-my-information.html): its application can be drawn at an address its parser reads as the posting
     *  (Workday's `…/apply`, verily): the runtime lets this adapter (never the generic one) claim the page there, and
     *  its late-form watch runs there. */
    formAtPosting?: true;
    /** jr6 APPLYPLAN D5 (B4: ADP's guest view, drawn after its job details' Consent & Continue, snapshot6 adp1 and
     *  adp2; C6: Workable's job site, whose form opens in a dialog, awaiting a capture): the platform draws its
     *  application in place, at one address, at any time (ADP's guest view after its job details; Workable's job site's
     *  dialog): the document is watched for its form for its life (the company-page watch's cheap way), and only the
     *  platform's own adapter may claim it. */
    formInPlace?: true;
    // ── end jr6 APPLYPLAN A0 item 3 ──
  };
}
