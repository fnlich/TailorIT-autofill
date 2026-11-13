/*
 * The configured-adapter layer's config (DESIGN-NEW-ATS §3, Phase 0): one AtsConfig per platform, read from its
 * snapshots, which ./index.ts turns into an Adapter (configuredAdapter) or into the same hooks for a full adapter to
 * compose (configuredHooks). Pure types: nothing here runs. Every rule carries `from`, the snapshot id or fixture case
 * it was read from (`jazzhr-0`), so a selector always names the markup it relies on; a rule no snapshot shows is left
 * out, never guessed. Every selector is static code: no rule is ever fetched or changed at run time.
 * jr7 INT-7 (the content script's budget): `from` and AtsConfig.snapshots are provenance, written as
 * `...(__PROVENANCE__ && { from: '…' })`. Vitest defines __PROVENANCE__ true, so configProblems and every test read
 * them all; every extension build (chrome, edge, e2e) defines it false, so the bundles hold none of them, which
 * scripts/check-build.mjs asserts. Nothing at run time reads them. Optional in the types for that reason alone: a rule
 * without its `from` is still a configProblems failure.
 *
 * What each rule becomes (./index.ts says how, hook by hook):
 * - parse: matchesUrl, canonicalApplicationUrl (the platform's own url.ts, also adapters/address.ts URL_PARSERS);
 * - states: detect (a state's own root, or none), authState, signInForm, nextButton, isFinalStep, entryControl,
 *   stepSignature;
 * - root: detect; questions: labelFor, descriptionFor, groupOf; required: requiredFor; sections: sections;
 * - widgets: widgetRoots, widgetFor; checked: checkedOf; proxies: proxyFor; uploads: uploadWidgets, uploadState;
 * - repeatables: repeatables; steps: stepSignature, nextButton, isFinalStep; submit: submitButton, isFinalStep;
 * - neverPress, excluded, errors, busy: the hooks of those names; success: content/submitted.ts, through ATS_CONFIGS;
 * - posting: postingText, entryControl; quirks, autosaves: as named;
 * - code: hooks no rule can say, each naming its snapshot in a comment, spread over the rule-built ones (code wins).
 *   jr7 ENGINE-7 E0 (FIX7PLAN §3.1): the shared contract's new hooks have no rule of their own
 *   (chainChildOrigins, confirmationAfter, successSigns, requiredBlocksLeft, uploadPrompt, editorOpener, notCodeBox,
 *   identityHosts, handOver, tailoritAddress: ../types.ts): a configured platform declares each in `code`, which
 *   ./index.ts passes through as written.
 */
import type { Platform } from '../../core/enums';
import type { ApplicationUrl } from '../application-key';
import type { SuccessRule } from '../success';
import type { Adapter, WidgetDecl } from '../types';

/** A CSS selector, read from a snapshot. */
export type Css = string;
/** The snapshot id(s) a rule was read from (`jazzhr-0`, `adp-4, adp-5`), or the fixture case. Required on every rule
 *  (configProblems); provenance, so absent from the builds (the header). */
export type From = string;

/** The hooks a config builds: an Adapter without its identity and address reading. */
export type ConfiguredHooks = Omit<Adapter, 'id' | 'matchesUrl' | 'canonicalApplicationUrl'>;

export interface AtsConfig {
  /** core/enums.ts PLATFORMS; listed in TailorIT's ATS_KINDS (every configured platform is, since its API 6), except
   *  jr7's new ones (ukgready, paycom, jobdiva, eightfold), ahead of the contract until its API 7
   *  (PLATFORMS_AHEAD_OF_CONTRACT). */
  readonly platform: Platform;
  /** The fixture cases the config was read from (fixtures/<platform>/<case>.html). Provenance (the header). */
  readonly snapshots?: readonly string[];
  /** The platform's pure address reading (its url.ts): posting, application or confirmation, and the canonical
   *  application URL the key is hashed from; null for any other page of the host (the content script stays dormant). */
  readonly parse: (url: URL) => ApplicationUrl | null;
  /** The platform's own url.ts matchesUrl, where it reads more than shared/hosts.ts platformOfUrl (the default: the
   *  address is this platform's candidate host and path). */
  readonly matchesUrl?: (url: URL) => boolean;
  /** Page states, in order: the first whose `when` matches an element a person can see decides what the page is (a
   *  consent gate, an emailed code, an account step, a résumé review). A page no state names is the application
   *  (`root`). */
  readonly states?: readonly PageState[];
  /** The application's form root: the first element (document-wide) a person can see that matches `css` and holds
   *  `holds`, when given. An element, not necessarily a <form> (ADP, Paylocity, UltiPro, HiBob, Dayforce have no single
   *  form). Waited for up to quirks.formLateMs. */
  readonly root: { readonly css: Css; readonly holds?: Css; readonly from?: From };
  /** Questions the page does not tie to their control. The first rule whose container holds the control wins. */
  readonly questions?: readonly QuestionRule[];
  /** Required where no attribute says it: a mark inside the question's title or container, or a class on them. */
  readonly required?: readonly RequiredRule[];
  readonly sections?: readonly SectionRule[];
  readonly widgets?: readonly WidgetRule[];
  /** Native radios and checkboxes whose chosen state the page draws elsewhere (Adapter.checkedOf). */
  readonly checked?: readonly CheckedRule[];
  /** Hidden native radios or checkboxes a visible element stands for, where no tied label qualifies (proxyFor): the
   *  first `proxy` inside the input's nearest `scope` ancestor (absent: the input's nearest `proxy` ancestor, else one
   *  inside its parent). */
  readonly proxies?: readonly { readonly input: Css; readonly proxy: Css; readonly scope?: Css; readonly from?: From }[];
  readonly uploads?: readonly UploadRule[];
  readonly repeatables?: readonly RepeatableRule[];
  /** Absent: a one-page form, final when Submit shows. */
  readonly steps?: StepRule;
  /** The Submit control, document-wide (BambooHR's and Dayforce's sit outside their roots). Identified so the fill
   *  never presses it; pressed only through the existing gates (the panel's Submit door, the modes, a challenge check). */
  readonly submit?: { readonly css: Css; readonly from?: From };
  /** Document-wide never-press controls (résumé parsers, Apply with LinkedIn/Indeed, Finish later, cookie buttons).
   *  Every entry control (posting.entry, a state's entry) and steps.back are never pressed by a run either, without
   *  being listed here. */
  readonly neverPress?: readonly { readonly css: Css; readonly from?: From }[];
  /** Parts of the root that hold no question (Adapter.excluded): résumé parsers, paste editors, review summaries. */
  readonly excluded?: readonly { readonly css: Css; readonly from?: From }[];
  /** Field errors shown by the page inside the root (besides aria-invalid, which the generic reading keeps). */
  readonly errors?: { readonly css: Css; readonly from?: From };
  /** The page's own busy signs (Adapter.isBusy): ClearCompany's "Saving...", Dayforce's loading Next. */
  readonly busy?: readonly { readonly css: Css; readonly from?: From }[];
  /** What the page shows once an application was sent, drawn in the form's place (a confirmation page the parse reads
   *  as 'confirmation' needs no sign). Read only after a Submit was pressed (content/submitted.ts, unchanged rules:
   *  new, shown where the form was, never inside the posting text). v5 p2-detect: a SuccessRule (adapters/success.ts),
   *  its words and a companion beside it read too where the rule names them. */
  readonly success?: SuccessRule;
  /** The posting's own text (postingText) and, on a posting page with no form, the one control that opens the
   *  application (entryControl), pressed only by the agent's entry door, never by a run (entryNeverPressed). */
  readonly posting?: { readonly text?: Css; readonly entry?: Css; readonly from?: From };
  /** The page saves each change before Submit (Adapter.autosaves). */
  readonly autosaves?: boolean;
  readonly quirks?: Adapter['quirks'];
  /** Hooks no rule can say, each naming its snapshot in a comment; spread over the hooks the rules build. jr7 ENGINE-7
   *  E0: every hook of FIX7PLAN §3.1 (the module header's list) is declared here. */
  readonly code?: Partial<ConfiguredHooks>;
}

/** The auth states a page state may name (Adapter.authState). */
export type StateAuth = NonNullable<ReturnType<NonNullable<Adapter['authState']>>>;

export interface PageState {
  readonly name: string;
  /** Shown in the document: the state holds while an element matching it is one a person can see. */
  readonly when: Css;
  /** Adapter.authState while this state shows, which makes the step a pause (nothing filled; dom/pause-detect.ts):
   *  'email-code' (ADP's verification dialog), 'entry-choice' (Jobvite's Data Consent: its entry is the agent's to
   *  press), 'create-account' or 'email-gate' (an account's creation, a code-sending Continue: pressed by Sign-in Auto
   *  alone through `signIn`, else the person's), 'sign-in', 'forgot-password' (the person's). */
  readonly auth?: StateAuth;
  /** The state's own root, returned by detect while it shows (a state with no auth is filled like a step: Jobvite's
   *  residence select before its consent shows); absent: no root, nothing filled. Never with auth 'entry-choice': the
   *  agent's entry presses only where no form shows. */
  readonly root?: Css;
  /** Its Next (document-wide): the state is 'not-final' while it shows; absent: the state is final 'unknown' (nothing
   *  pressed), unless its signInContainer and that container's button show ('not-final': the behaviour review of
   *  2026-11-06, minor 2). */
  readonly next?: Css;
  /** auth 'entry-choice': the control the agent's entry door presses (Jobvite's "I Accept"), never a run. */
  readonly entry?: Css;
  /** auth 'sign-in', 'create-account' or 'email-gate': the form Sign-in mode Auto reads (Adapter.signInForm). A
   *  configured adapter always declares its sign-in forms: without one, Sign-in Auto reads none on its pages (never the
   *  standard form, dom/sign-in-form.ts), and the pause is the person's (Dice's own sign-in, unseen, included). */
  readonly signIn?: SignInRule;
  // ── snapshot build 2026-11-06 (core pass Z1, items 24 and 27) ──
  /** Core pass Z1, item 27, auth 'entry-choice' with an `entry` that submits a form: the consent form it submits
   *  (Adapter.entryConsentForm; Jobvite's form[name=consentForm]) and the selects that form holds beside the consent
   *  choice (its residence select). The entry door submits it only while it holds nothing else. */
  readonly entrySubmits?: { readonly form: Css; readonly selects?: Css };
  /** Core pass Z1, item 24, a state with no auth (filled like a step): its account or code-sending part, whose button
   *  follows Sign-in mode (Adapter.signInContainer; ADP's guest Continue, UltiPro's Create account). */
  readonly signInContainer?: SignInContainerRule;
  // ── end core pass Z1, items 24 and 27 ──
  readonly from?: From;
}

/** Core pass Z1, item 24: a state's sign-in container (SignInForm.container), each slot a selector: `container` and
 *  `button` document-wide (the button may sit outside the container, never in another document), the boxes inside the
 *  container. No password box: a password goes only into an adapter's own <form> (SignInRule). */
export interface SignInContainerRule {
  readonly container: Css;
  /** The email box Sign-in Auto types the saved sign-in's email into; absent: it types nothing (the step's own fields,
   *  filled from the profile, are the account's). */
  readonly email?: Css;
  /** At most one terms box, inside the container. */
  readonly terms?: Css;
  /** The one control pressed (Continue, Create account), named by an identity of its own in the snapshot. */
  readonly button: Css;
}

/** A state's account form, as Adapter.signInForm declares it: each slot a selector inside `form` (the adapter's own
 *  <form>, which holds every box and the button). */
export interface SignInRule {
  readonly form: Css;
  readonly email?: Css;
  readonly confirmEmail?: Css;
  readonly password?: Css;
  readonly confirm?: Css;
  /** At most one terms box (a declared form's). */
  readonly terms?: Css;
  /** The one control pressed (Create account, Continue), named by an identity of its own in the snapshot. */
  readonly button: Css;
  readonly colourUnknown?: readonly Css[];
  readonly enablesWhenFilled?: true;
  readonly personPresses?: true;
  readonly scriptSubmits?: true;
}

export interface QuestionRule {
  /** One question's container, found by closest() from the control (the control's own match included). */
  readonly container: Css;
  /** Its title inside the container (labelFor): the first match that does not hold the control and is no nested
   *  container's; else `titleBefore`: the nearest preceding element matching it among the container's previous
   *  siblings, up to another container (Breezy's h3, Rippling's custom-question p, Paycom's title column). */
  readonly title?: Css;
  readonly titleBefore?: Css;
  /** Help text inside the container (descriptionFor). */
  readonly help?: Css;
  /** The container is one question's checkbox (or nameless radio) group: Adapter.groupOf. */
  readonly group?: true;
  readonly from?: From;
}

export interface RequiredRule {
  /** A mark a person sees inside the question's title, its container or the control's own labels (`i.asterisk`,
   *  `span.required-indicator`). */
  readonly mark?: Css;
  /** The question's title or container, the control's own labels, or an ancestor of the control, itself says required
   *  (`label.Mui-required`, `div.form-group.form-required`). */
  readonly is?: Css;
  readonly from?: From;
}

export interface SectionRule {
  readonly container: Css;
  /** Its heading: the first match inside the container that is no nested container's. */
  readonly heading: Css;
  readonly kind?: 'experience' | 'education' | 'language';
  readonly from?: From;
}

/** A widget the scanner does not find by standard ARIA, or finds without what it needs. Maps to WidgetDecl. Every
 *  relative selector is looked up from the match: the match itself, else its first descendant, else its nearest
 *  ancestor. */
export interface WidgetRule {
  /** The control the scanner meets (or, with `root`, an element added to widgetRoots). */
  readonly match: Css;
  readonly root?: true;
  readonly kind: WidgetDecl['kind'];
  /** Absent: the match itself. */
  readonly opener?: Css;
  readonly expanded?: Css;
  /** What a person sees as the widget, when the match itself is drawn at opacity 0 (Ant's and react-select's text
   *  boxes once chosen). */
  readonly box?: Css;
  /** A 'radio' widget's option elements inside the match (drawn radios with no native input: ADP's
   *  sdf-radio-button). */
  readonly members?: Css;
  /** Native controls inside the match that are the widget's own (never fields). */
  readonly parts?: Css;
  /** The part of one option that is its label (WidgetDecl.optionLabel), inside the option. */
  readonly optionLabel?: Css;
  readonly busy?: readonly Css[];
  readonly activation?: WidgetDecl['activation'];
  readonly keys?: WidgetDecl['keys'];
  readonly keyTarget?: WidgetDecl['keyTarget'];
  readonly readOnlyBox?: true;
  readonly listFollowsField?: true;
  readonly highlightIsNoChoice?: true;
  readonly hidesFormWhileOpen?: boolean;
  readonly emptyAfterMs?: number;
  readonly bridge?: WidgetDecl['bridge'];
  readonly from?: From;
}

export interface CheckedRule {
  readonly input: Css;
  /** The element around the input that shows the state, and the selector it matches while chosen
   *  (`label.ant-radio-wrapper` / `.ant-radio-wrapper-checked`; `label.brd-label` / `.selected`). */
  readonly holder: Css;
  readonly chosen: Css;
  readonly from?: From;
}

export interface UploadRule {
  /** The file input (document-wide: Jobvite's sit in body-level popovers). */
  readonly input: Css;
  /** Its visible control (uploadWidgets), never pressed by a run: the first match inside the input's `area`, else
   *  inside its nearest ancestor that holds one (Breezy's opener sits outside the résumé's own area). */
  readonly control: Css;
  /** The question's container around the input, where the control and the signs below are looked for. */
  readonly area?: Css;
  /** Shown once the page took the file (uploadState 'confirmed'), while uploading ('pending'), on failure ('failed');
   *  none declared: uploadState is null (the input's own files decide). A `done` sign shown in the area while the input
   *  itself holds no file is a file the page holds already (Adapter.uploadHeld; the behaviour review of 2026-11-06,
   *  M2). */
  readonly done?: Css;
  readonly pending?: Css;
  readonly failed?: Css;
  // ── behaviour review 2026-11-06 (M2) ──
  /** The file's name as the page shows it, in a shown `done` sign (the sign itself or inside it): uploadState is then
   *  'confirmed' only while one shows the written file's name, never on an older file's sign; and a sign naming no file
   *  holds none (uploadHeld). Absent: any shown `done` sign confirms. */
  readonly name?: Css;
  // ── end behaviour review (M2) ──
  /** jr6 FIXPLAN §3.1 item 19 (JZ-4; JazzHR's classic layout, snapshot6 applytojob, the jr6 case jr6-centroid-form):
   *  the link that shows the hidden file input (JazzHR's #resumator-choose-upload). Pressed at most once per document,
   *  by ENGINE's reveal door alone (dom/fillers/not-submit.ts, FIXPLAN §6.2 item 9), while the input is hidden and the
   *  link shows inside the rule's area; it stays in neverPress for every other path. Types only until ENGINE E2. */
  readonly reveal?: Css;
  readonly from?: From;
}

export interface RepeatableRule {
  readonly kind: 'experience' | 'education' | 'language';
  readonly section: Css;
  /** One entry's block inside the section. */
  readonly block: Css;
  /** The section's Add, outside every block. */
  readonly add: Css;
  /** A block's own Save, where the page keeps an entry only once it is pressed. */
  readonly save?: Css;
  readonly currentlyHere?: Css;
  readonly from?: From;
}

export interface StepRule {
  /** The shown step's heading, progress text and anchors (stepSignature: page text and markup only, never a value): an
   *  anchor is its first shown match's attribute `attr`, else whether one shows, by its place in the list
   *  (`<index>:shown`). */
  readonly heading?: Css;
  readonly progress?: Css;
  readonly anchors?: readonly { readonly css: Css; readonly attr?: string }[];
  readonly urlPart?: 'path' | 'hash' | { readonly query: string };
  /** Next, document-wide. isFinalStep: 'final' when Submit shows and Next does not, 'not-final' when Next shows and
   *  Submit does not, else 'unknown' (nothing pressed). */
  readonly next: Css;
  /** Back: never pressed. */
  readonly back?: Css;
  readonly from?: From;
}
