// Turns a page capture (.mhtml, from Chrome's "Save page as > Webpage, Single File" or the dev build's capture hotkey)
// into a test fixture under fixtures/<platform>/: one self-contained HTML file per frame the extension runs in, a page
// standing in for every third-party frame (a CAPTCHA, an API proxy), and a route map that serves them at their real
// addresses. Chromium (Playwright's, JavaScript off) opens the capture itself, so its own MHTML loader resolves the
// archived parts; the converter's MIME reader supplies the stylesheet text and image bytes it inlines.
//
// What it does to each converted frame, in the page:
// - inlines every stylesheet as a <style> element (visibility depends on CSS) and every image as a data: URI; an image
//   over IMAGE_INLINE_MAX bytes becomes a grey SVG of the same size; a reference missing from the archive becomes
//   "data:,", so a fixture never makes a request;
// - removes scripts, noscript, on* attributes, javascript: URLs, <base>, meta http-equiv (refresh and CSP included),
//   object, embed and srcdoc; every form posts to /__submitted, which the e2e harness records as a failure;
// - redacts: typed values are cleared (text inputs, textareas, contenteditable, a widget's value mirror), checked and
//   selected are dropped, hidden-input values and the text of listbox and combobox triggers and chips become REDACTED;
//   emails, phone numbers and every string in the --redact file become REDACTED.
// - Ashby (--platform ashby): the per-load ids are normalised (normaliseAshby), so a fixture is the same whenever its
//   page was captured: each form's render id, which prefixes every data-field-entry-id and every radio's and checkbox's
//   id, name and for, becomes 00000000-0000-4000-8000-00000000000N in the order the page first names it, and the
//   per-load CSP nonce of meta[name=csp-nonce] becomes REDACTED.
// - Workable (--platform workable): the ids its React draws afresh on every render (normaliseWorkable: the radios' and
//   checkboxes' own ids, wrapper_<id>, <id>_label, input_<id>, checkbox_label_<id>, radio_label_<id>, svg_<id>,
//   input_files_input_<id>, description_input_<id>, <id>_dropdown and an open list's <id>_<option>) become
//   wk000000000000N (16 characters, as Workable's are) in the order the page first names them, wherever they stand.
// - Workday, iCIMS, Taleo, SuccessFactors and Oracle (v3 Phases 6 and 7b; normaliseTokens): the per-load values the
//   public capture of 2026-11-04/05 met become fixed ones: Workday's input-<n> ids (in the order the page first names
//   them) and its beecatcher's UUID; iCIMS's hashed=<n> and Auth0's state=; SuccessFactors' _s.crb=, requestParams= and
//   jobSecKey; Oracle's primary-email-<n> and honey-pot-<n>; the hCaptcha site keys on iCIMS and Oracle (public, but
//   dropped), in data-sitekey and in its frames' addresses (sitekey=), and each hCaptcha widget's id (its
//   data-hcaptcha-widget-id and the id= of its frames' addresses: the v3 Phase 6/7b review, S9). Taleo's JSF state is
//   in hidden inputs, which are redacted anyway.
// - iCIMS, Taleo, SuccessFactors and Oracle (the v3 Phase 6/7b review, C10), and the platforms the snapshot build added
//   to PRUNED_CSS_PLATFORMS (SmartRecruiters and the new ATSs): the style rules no element of the frame matches are
//   dropped (pruneCssInPage), their sheets being most of each capture's weight. A rule is kept wherever its
//   selector, read without its dynamic pseudo-classes (:hover, :focus, :checked, :disabled, ...) and its pseudo-elements,
//   names an element, and wherever the browser cannot read it so; every at-rule but @media, @supports, @container and
//   @layer blocks (whose own rules are pruned the same way) is kept whole. The reload's visibility check below holds the
//   result. Workday's sheets are kept whole: its tests stage one capture's view inside another's page (the choice in the
//   posting, the landing in the Sign In page), whose rules the page itself would not keep.
// - The snapshot build of 2026-11-06 (the owner's captures, taken signed in and filled in, with other extensions
//   active; docs/FIXTURES.md, the owner's snapshots of 2026-11-06), on every platform, in this order:
//   - before anything is measured: what is not the site's page goes (stripInjectedInPage): other extensions' UI
//     (INJECTED_UI), an overlay's shadow host on <body> that holds no control where the platform does not keep shadow
//     roots, and the per-load values of PER_LOAD_PARAMS (REDACTED); and the choices a page mirrors are cleared
//     (clearChoicesInPage: aria-checked, aria-pressed and data-checked, a chosen phone country's flag and button, and
//     the chosen marks of the new ATSs' drawn controls and lists, CHOSEN_MARKS, with (s2 wd) any aria-activedescendant
//     that names an option it unselected);
//   - each frame is converted before the frame that holds it (a parent's conversion points its frames at their real
//     addresses, which navigates them away from the document measured: iCIMS's IForm, a company page's embed);
//   - the applicant's own text the redaction list may not hold becomes REDACTED where the markup shows it
//     (redactApplicantTextInPage): an upload's file name, wherever the frame repeats it (FILE_NAME_PLACES), a resume's
//     entries shown as text (ENTRY_SUMMARY_PLACES), chosen answers drawn outside a native control (CHOSEN_PLACES), the
//     account's and the profile's own text (PROFILE_PLACES), the controls that name a file or an entry, a custom
//     element's value and default-value, data-date-value and data-gtm-form-interact-*, a searchable Ant select's open
//     list (UltiPro's Race row is drawn open before the measure: jr7 OPENED_ROWS), and (s2 wd) a search's results that
//     list the applicant's answer (SEARCH_RESULT_PLACES: Greenhouse's and Lever's location results), inside an option
//     too;
//   - a tel: or sms: link's number becomes REDACTED whatever its spelling, and so does a per-visitor id a script wrote
//     into a stylesheet (--sa-uid, Dice's) once the sheet is inlined (transformInPage);
//   - another extension's parameters (INJECTED_PARAMS: Jobright's jr_id, Simplify's utm_source) leave every address and
//     each frame's written text by one rule (stripInjectedParams), plain, as &amp; entities or percent-encoded once or
//     twice; a file that still names jr_id anywhere is refused;
//   - a sign-in token (SIGN_IN_TOKEN_SOURCES: an OpenID id_token, a JWT whose claims name the account, and a
//     silent-callback page's one-time code=; UltiPro's signed-in pages) becomes REDACTED by one rule
//     (redactSignInTokens) in every address and each frame's written text, plain, after &amp; or percent-encoded once
//     or twice; a file that still holds one is refused;
//   - --folder <name> writes a case beside others of its kind (fixtures/sites: a company page around an ATS frame,
//     pruned as iCIMS's are), the platform still deciding how its frames are normalised.
// - Per platform (PLATFORM_REDACTIONS, dispatched by --platform), what the generic passes miss there:
//   - Workday's application steps (docs/OWNER-QUESTIONS.md 93), before the transformation (redactWorkdayInPage): the
//     Review step's value cells, read-only summaries and the account menu, an upload's announcement and delete label,
//     any word ending in a document's extension, a dropdown's chosen option id and aria-label, a prompt's "1 item
//     selected, <answer>" and its pill's labels and (s2 wd) its pill's id, an open list's chosen option, an exclusive
//     group's disabled boxes, and a date's displayed digits and help text, back to MM/DD/YYYY. Counts go in the header
//     (redacted.workday).
//   - iCIMS's signed-in pages, after it (icimsRedactInPage): the header's name, a current file's name, and iCIMS's
//     dropdowns' chosen options, results and searched lists; normaliseTokens adds their per-person address values.
//   - Oracle and SmartRecruiters, after it (redactPlatformInPage): Oracle's apply flow's personal text (its work and
//     education timeline's titles, employers, schools, dates and year axis, an attached file's name, the submission
//     checklist's greeting by first name) and its chosen answer pills; SmartRecruiters' form elements' value attributes,
//     a select's chosen value on its trigger, and its phone field's 245 country flags, each a grey SVG of its own size.
// - Shadow roots (the snapshot build of 2026-11-06: oracle-sf-sr's, and the new ATSs' DESIGN-NEW-ATS §6.2): Chrome's
//   serializer saves an open shadow root as <template shadowmode="open"> and its MHTML loader attaches it again. For the
//   platforms of SHADOW_ROOT_PLATFORMS (SmartRecruiters, whose one-click application is drawn in them, and the new ATSs:
//   ADP's, Dice's and UltiPro's pages) the converter keeps them all: deepenInPage makes every query and walk of the
//   passes above, the visibility check and the rescan reach into each open shadow root, nested ones too, and
//   serializeDeepInPage writes them as declarative shadow roots (<template shadowrootmode="open">), which the HTML parser
//   attaches when the fixture loads. A platform whose pages draw in shadow roots joins by adding its name there. Every
//   other platform's page loses its form-less overlays on <body> (above) and is refused for any other shadow root. A
//   shadow tree's styles are lost in the capture already (Chrome drops adoptedStyleSheets), so it shows unstyled in the
//   capture and in the fixture alike. A closed shadow root (Cloudflare Turnstile's on UltiPro's account page), which no
//   page code can read and no fixture keep, is stood in on every platform by its host's own box (markClosedShadowHosts,
//   through the DevTools protocol, and transformInPage), as a large image is by a same-size placeholder.
// - Every animation and transition is settled before each visibility measurement (measureInPage), on both sides.
// - The new ATSs (DESIGN-NEW-ATS §6, Phase 0): their hosts and candidate paths (NEW_ATS_HOSTS), and their per-load
//   values made fixed (normaliseNewAts), beside normaliseTokens' of the v3 Phase 6/7b platforms; a per-session value
//   that also stands in addresses becomes REDACTED there and in the page (redactNewAtsAddress, by platform:
//   NEW_ATS_ADDRESS_VALUES: ClearCompany's xdChannel, Pinpoint's and CareerPlug's csrf-token and csp-nonce metas,
//   Pinpoint's confirmation token and per-render link keys).
// - jr6 (the owner's snapshot6 of 2026-11-10; FIXPLAN 6.1, TOOLING), on every platform:
//   - ADP's places (adp-new-4), keyed by markup and reached inside shadow roots: the signed-in avatar (its button, every
//     sdf-avatar, the account menu's name heading), the Review step's summary, the posting's applied date
//     (PROFILE_PLACES); the uploaded résumé's name (FILE_NAME_PLACES) and its Remove button's label (FILE_LINK_PLACES);
//     sdf-select-simple's chosen label and live region (CHOSEN_PLACES, by :host()), its list's chosen sdf-select-item
//     (CHOSEN_MARKS) and react-select's chip label (CHOSEN_PLACES);
//   - SmartRecruiters' (SR-8): the saved experience and education entries and their buttons' labels, spl-avatar, a drop
//     zone's file names (the places), and in its own pass the avatar's name attributes and spl-dropzone's files JSON;
//   - Jobvite's drawn choices (JV-10): the chosen row's class, its icon swapped for the unchosen one (a CHOSEN_MARKS
//     `swap`), its aria-selected and aria-checked; and AngularJS's state classes on every control and ng-model or
//     ng-form element (jobvite-new-4: validity, emptiness and touch, which mark a clicked option or a ticked box);
//   - iCIMS's pnumber= and ccode= (ICIMS-28: the phone gate's phone and country code, encrypted) with its per-person
//     values;
//   - --replace-text <css>=<file> (jobvite-new-2, repeatable): before anything is measured, every element the selector
//     names in a converted frame gets the file's synthetic text: a select's options become one per non-blank line (a
//     first option with an empty value kept before them); a meta element's content becomes its lines on one line; an
//     element holding no form control keeps only that text; any other element keeps its controls, its first text run
//     taking the text and the others emptied. Its title, aria-label and label, and an option's value, where present,
//     take the text's first line. The same capture and file always give the same fixture; the header counts what each
//     replacement took (replacedText), never its text.
//   It refuses a page where (jobvite-new-2) the redaction list matched the page's own text inside an <option> (or a
//   role=option), a <label>, a <legend>, or a posting's description or its copy in the page's description metadata
//   (POSTING_TEXT_PLACES): a REDACTED there tells the value by elimination, so such an element is replaced with
//   --replace-text first (an option whose whole list ends REDACTED or empty, as iCIMS's server-loaded dropdowns are,
//   tells nothing and passes); and (JV-10) a page where the option rows of one choice group (CHOICE_ROWS) still differ
//   after clearing, beyond their text, ids, names and values.
// - jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b: an open SmartRecruiters City list kept each row's value and data-sr-id,
//   which spelled the city and state typed, while the row's words were redacted), on every platform:
//   - each open list's rows (LIST_ROWS: an ARIA option, a grid popup's row, a menu's or a tree's item, a native option,
//     spl-select-option, sdf-select-item, Lever's location result) are read before any redaction (noteListRowsInPage),
//     with the lists that hold a typed query's results: TYPED_LISTS (Workday's prompt search, SmartRecruiters' City
//     search), the popups of TYPED_LIST_BOXES (Oracle's searching cx-select, iCIMS's searched dropdown) and the popup of
//     any text box holding typed text (its aria-controls, aria-owns or ariacontrols, or its aria-activedescendant's
//     list);
//   - once every other redaction ran (redactListRowsInPage): a typed query's result (but FIXED_ROWS, the site's own
//     rows), and any row whose text a redaction made REDACTED, loses its words whole and what names it: its word
//     attributes (ROW_WORD_ATTRIBUTES: value, data-value, label, aria-label, title, ...) become REDACTED and its id
//     attributes (ROW_ID_ATTRIBUTES: id, name, href, data-*-id, data-*-key) are normalised, each value, word or opaque
//     token naming the row REDACTED and the rest kept, a renamed id unique and every reference to it following;
//   - a listed string respelled in any attribute (respelledSources: joined, camel-cased, its separators changed or
//     percent-encoded) becomes REDACTED there (transformInPage), and in the page's and its frames' addresses
//     (respelledAddress: their path, query and fragment, so a frame's src, the route map and the header agree; an
//     iCIMS IForm's or a Workday application's address spells its posting's title); a frame's src is otherwise left as
//     written, its route answering it;
//   and it refuses a file where a listed string survives in any attribute, as written or respelled (respelledIn: a
//   frame's host, say).
// - jr6 fixes (TOOLING; the line W reviews of 2026-11-11), on every platform, before anything is measured
//   (clearChoicesInPage):
//   - PRIV-2, REVC-4: a custom control's reflected checked or selected (any element but an input or an option: the
//     chosen spl-radio's checked="true"), the name SmartRecruiters gives its chosen spl-radio alone, Angular's state
//     classes on any element but a form (ANGULAR_STATE_ELEMENTS: a reactive form's components and groups), ADP's
//     toggled radio svg, and the parts a widget draws on its chosen row alone (CHOSEN_DRAWINGS: ADP's radio dot and
//     list check mark, removed) go; a widget's roving tab stop (tabindex="0") on a row but its first moves to the first
//     row, as an unanswered widget draws it (ROVING_ROLES and ROVING_TAGS rows in ROVING_GROUP_ROLES or
//     ROVING_GROUP_TAGS widgets); and CHOICE_ROWS reads SmartRecruiters' spl-radio and spl-select-option and ADP's
//     sdf-radio-button and sdf-select-item groups too, a row's shadow root and its tab stop included;
//   and it refuses a file that still holds any of them (chosenMarksIn, CHOSEN_MARK_LABELS).
//   - PRIV-4: where the person came to the posting from (REFERRAL_PARAMS: iCIMS's iis and iisn, ADP's and Workday's
//     source, Jobvite's __jvst and __jvsd, Greenhouse's gh_src, Lever's lever-source; every utm_*) is a per-visit value:
//     REDACTED in every address the converter writes (the header's source, the route map, the frames' src: by
//     withoutInjectedParams) and in each frame's written links and text (redactReferralParams), plain, after &amp; or
//     percent-encoded once or twice; the header counts them (redacted.referral) and the final check refuses one left
//     (referralNeedles).
//   - PRIV-6: a listed string respelled in the page's text is REDACTED too, as in attributes (header
//     redacted.respelledText), and the final check refuses one left in a page's text (respelledIn's `text`).
//   - PRIV-7: the elimination refusal (listedPlacesInPage) reads every list row (LIST_ROWS, the outermost, through
//     shadow roots' hosts) in its list (LISTED_LISTS), the site's own rows (FIXED_ROWS) and a native placeholder aside;
//     REVC-4: the committed-fixture sweep reads the written lists alike (eliminatedListsIn).
// - jr6 PRIVACY-FIX (SP\jr6\leakscan\VERDICTS-3.md), on every platform:
//   - a JSON copy of the posting in an attribute (POSTING_COPY_ATTRIBUTES: Breezy's data-position) is a posting place:
//     a listed or respelled string met in its title or description fields is redacted there, as in any attribute, and
//     the elimination refusal asks for synthetic text, which --replace-text '<css>@<attribute>=<file>' gives (each
//     title field the file's first line, each description field its other lines);
//   - a list row's id normalisation leaves the words of Workday's data-automation-id alone (ROW_ID_WORDS_KEPT: a chosen
//     pill's DELETE_charm names the component, not the row), its opaque tokens and the row's values still taken.
// - jr7 TOOLING-7 (the owner's snapshot7 of 2026-11-11; SP\jr7\FIX7PLAN.md §6.1), on every platform but where named:
//   - the platforms jr7 adds (FIXTURE_PLATFORMS, NEW_ATS_PLATFORMS, NEW_ATS_HOSTS, a whole candidate path by
//     pathPattern): ukgready (secure<n>.saashr.com/ta/<company>.careers), paycom (www.paycomonline.net's portal posting
//     and applications paths), jobdiva (www<n>.jobdiva.com/portal/), eightfold (<tenant>.eightfold.ai/careers) and jibe
//     (<tenant>.jibeapply.com/jobs/);
//   - before anything is measured: UltiPro's Race row drawn open (OPENED_ROWS, UP7-14); a chosen uiLib icon drawn as a
//     copy of the page's own unchosen twin (CHOSEN_ICONS, T7-01: none to copy is refused) and its uiLib marks
//     (CHOSEN_MARKS); every canvas kept at the box it draws with scripting on (standInCanvasesInPage, T7-01: the capture
//     is opened with scripting off, where a canvas is an inline box for its fallback content); with --style-order live,
//     the cid: sheets Blink's serializer hoisted above the head's own <link> sheets moved back after them
//     (liveStyleOrderInPage, JDEF-V1; jobdiva's default, STYLE_ORDER_DEFAULTS);
//   - places (UKGR-20, T7-02, JDEF-16): UKG Ready's value mirror, review values, entry metadata and avatar; Dayforce's
//     Personal Information read view, its chosen source included; JobDiva's file card; Paycom's tooltip anchors'
//     spelled text (SPELLED_IDS); Oracle's profile tile summaries and every My Applications tile but the one
//     --keep-application names (jr7-O5); a searched iCIMS list's result keeping a REDACTED in each text run, so its
//     bolded query keeps its box (ICIMS7-15);
//   - values: UKG Ready's ActiveSessionId, sft, rnd and file-service ticket (PER_LOAD_PARAMS), a phone-shaped listed
//     string in an address (respelledSources' phones), Eightfold's _csrf meta, Paycom's hCaptcha (redactHcaptchaIn),
//     Jobvite's __jvsc (REFERRAL_PARAMS);
//   - --frame-src gives a frame the capture saved unloaded its public vendor address, a third party's (RBP7-V2 a);
//   and it also refuses a widget's shown text spelled in an id (spelledIdsIn) and, in the inlined stylesheets, what
//   the token and referral needles find there (checkedStyleForms).
// It then reloads the result as the e2e harness serves it and refuses to write anything if a listed string, a found
// email or a found file name remains (also percent- or entity-encoded), if jr_id, another extension's parameter or UI,
// an unredacted per-load token, a sign-in token or any JWT remains, if the page still finds an email or phone number,
// if the page requests anything the route map does not answer, or if any element's visibility changed. Leftover
// suspicious tokens are printed for review. Counts are printed, never values.
//
// Usage: node scripts/mhtml-to-fixture.mjs <file.mhtml> --platform <greenhouse|lever|ashby|workday|workable|icims|taleo|
//          successfactors|oracle|smartrecruiters|jobvite|jazzhr|bamboohr|rippling|breezy|careerplug|pinpoint|paycor|hibob|
//          ultipro|dayforce|paylocity|dice|clearcompany|adp|ukgready|paycom|jobdiva|eightfold|jibe> --case <name>
//          [--redact <file>] [--out <folder>] [--folder <name>] [--replace-text <css>[@<attribute>]=<file>]...
//          [--style-order archive|live] [--keep-application <job id>] [--frame-src <css>=<https address>]...
// The redact file holds one string per line (blank lines and lines starting with # are skipped); a string that looks
// like a phone number matches whatever its punctuation. --out defaults to fixtures/. Each --replace-text names a CSS
// selector and, after its last "=", a UTF-8 file of synthetic text (made up, never a person's); a selector that names
// no element in any converted frame is refused, by its position among the --replace-text options. A selector ending in
// @<attribute> names a posting copy's attribute (POSTING_COPY_ATTRIBUTES) on those elements; any other is refused.
// (UltiPro's education editor, jr7 UP7-14: its Major and Minor lists hold the field-of-study list a listed field meets,
// so they take synthetic lines: --replace-text 'select[data-automation="major-dropdown"],
// select[data-automation="minor-dropdown"]=<file>'.)
// jr7 TOOLING-7: --style-order keeps the archive's cascade order (archive, the default but for jobdiva) or the live one
// (live). --keep-application (Oracle only) names the captured posting's job id, whose My Applications tile a my-profile
// page keeps; it is refused where no tile names it. Each --frame-src names, before its address's "=https://", the frames
// the capture saved unloaded that take that public https address of a third party's (no credentials, no site key):
// refused where it names no such frame, or a frame with an address of its own.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL, URLSearchParams } from 'node:url';
import { TextDecoder } from 'node:util';
import { chromium } from 'playwright';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** The platforms a fixture can belong to (src/core/enums.ts PLATFORMS). */
export const FIXTURE_PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workday', 'workable', 'icims', 'taleo', 'successfactors',
  'oracle',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
  'smartrecruiters',
  // ── New ATSs (DESIGN-NEW-ATS §6.1, Phase 0) ──
  'jobvite', 'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint', 'paycor', 'hibob', 'ultipro', 'dayforce',
  'paylocity', 'dice', 'clearcompany', 'adp',
  // ── end New ATSs ──
  // ── jr7 TOOLING-7 (FIX7PLAN §3.2, §6.1 items 4, 5, 7; UKGR-20, T7-01, JDEF-16): the platforms jr7 adds, in
  // src/core/enums.ts PLATFORMS' order: UKG Ready (secure<n>.saashr.com), Paycom, JobDiva, Eightfold and Jibe (iCIMS's
  // front end, ICIMS7-11) ──
  'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe',
  // ── end jr7 TOOLING-7 ──
];

/** The hosts the extension runs on (src/shared/hosts.ts, the one list): only frames on these are converted. */
const ATS_HOST = new RegExp('^(?:(?:job-)?boards\\.greenhouse\\.io|jobs\\.(?:eu\\.)?lever\\.co|jobs\\.ashbyhq\\.com'
  + '|(?!(?:www|wd\\d{1,3})\\.)[a-z0-9-]+\\.(?:wd\\d{1,3}\\.)?myworkdayjobs\\.com|wd\\d{1,3}\\.myworkdaysite\\.com'
  // Snapshot build, boards (2026-11-06): jobs.workable.com beside apply.workable.com.
  + '|(?:apply|jobs)\\.workable\\.com'
  // v3 Phase 7b: the candidate hosts of src/shared/hosts.ts's HOST_PLATFORMS.
  + '|(?!(?:www|api|login)\\.)(?!internal-)[a-z0-9-]+\\.icims\\.com|(?!www\\.)[a-z0-9-]+\\.taleo\\.net'
  + '|career\\d{0,3}\\.successfactors\\.(?:com|eu)|[a-z0-9-]+\\.fa(?:\\.[a-z0-9-]+)?\\.oraclecloud\\.com'
  // ── snapshot build 2026-11-06 (oracle-sf-sr): Oracle's government cloud, SmartRecruiters ──
  + '|[a-z0-9-]+\\.fa\\.ocs\\.oraclegovcloud\\.com|jobs\\.smartrecruiters\\.com)$');

// ── New ATSs (DESIGN-NEW-ATS §6.1, Phase 0) ──
/** The new ATSs' candidate hosts, as src/shared/hosts.ts HOST_PLATFORMS reads them, each by its candidate paths where
 *  the host serves other pages too: a frame on such a host off those paths (ClearCompany's /blank/page) is a
 *  third-party stand-in, one on them (UltiPro's RelyingPartyIframe) is converted.
 *  @type {Array<{ host: RegExp; paths?: string[]; pathPattern?: RegExp }>} */
export const NEW_ATS_HOSTS = [
  { host: /^jobs\.jobvite\.com$/ },
  { host: /^(?!www\.)[a-z0-9-]+\.applytojob\.com$/, paths: ['/apply/'] },
  { host: /^ats\.rippling\.com$/ },
  { host: /^[a-z0-9-]+\.breezy\.hr$/, paths: ['/p/'] },
  { host: /^[a-z0-9-]+\.careerplug\.com$/, paths: ['/jobs/'] },
  { host: /^(?!app\.)[a-z0-9-]+\.pinpointhq\.com$/, paths: ['/en/postings/'] },
  { host: /^recruitingbypaycor\.com$/, paths: ['/career/'] },
  { host: /^[a-z0-9-]+\.careers\.hibob\.com$/ },
  { host: /^recruiting\.ultipro\.com$/ },
  { host: /^jobs\.dayforcehcm\.com$/ },
  { host: /^recruiting\.paylocity\.com$/, paths: ['/Recruiting/'] },
  { host: /^www\.dice\.com$/, paths: ['/job-applications/'] },
  { host: /^(?!cc-)[a-z0-9-]+\.clearcompany\.com$/, paths: ['/careers/'] },
  { host: /^workforcenow\.adp\.com$/, paths: ['/mascsr/default/mdf/recruitment/', '/mascsr/applicant/mdf/recruitment/'] },
  { host: /^[a-z0-9-]+\.bamboohr\.com$/, paths: ['/careers/'] },
  // ── jr7 TOOLING-7 (FIX7PLAN §3.2, the verified specs; as src/shared/hosts.ts HOST_PLATFORMS reads them once ENGINE-7 E0
  // registers them): a candidate path only, never an employee page of the same host. `pathPattern` is a whole path the
  // candidate pages have (UKG Ready's /ta/<company>.careers, Paycom's /v4/ats/web.php/portal/<client key>/jobs/<id> and
  // .../applications); `paths` are prefixes as above. ──
  { host: /^secure\d{0,2}\.saashr\.com$/, pathPattern: /^\/ta\/\d{3,10}\.careers$/ }, // ukgready (UKGR-2)
  { host: /^www\.paycomonline\.net$/,
    pathPattern: /^\/v4\/ats\/web\.php\/portal\/[A-Fa-f0-9]{32}\/(?:jobs\/\d+|applications)\/?$/ }, // paycom (PC7-02)
  { host: /^www\d{0,2}\.jobdiva\.com$/, paths: ['/portal/'] }, // jobdiva (JDEF-12)
  { host: /^(?!(?:app|www)\.)[a-z0-9-]+\.eightfold\.ai$/, paths: ['/careers'] }, // eightfold (JDEF-12)
  { host: /^[a-z0-9-]+\.jibeapply\.com$/, paths: ['/jobs/'] }, // jibe (ICIMS7-11)
  // ── end jr7 TOOLING-7 ──
];
/** The new ATSs' fixture platforms (normaliseNewAts). jr7 TOOLING-7: and jr7's five, which keep their shadow roots and
 *  have their unused style rules pruned as the new ATSs' do (the auditors converted them as `hibob`, a new ATS with no
 *  normalisation of its own, and the Jibe page as `icims`, pruned too). */
export const NEW_ATS_PLATFORMS = ['jobvite', 'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint', 'paycor',
  'hibob', 'ultipro', 'dayforce', 'paylocity', 'dice', 'clearcompany', 'adp',
  // jr7 TOOLING-7
  'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe'];
// ── end New ATSs ──

/** The platforms whose fixtures keep only the style rules their own elements match (pruneCssInPage). */
export const PRUNED_CSS_PLATFORMS = ['icims', 'taleo', 'successfactors', 'oracle',
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  'smartrecruiters',
  // ── New ATSs (DESIGN-NEW-ATS §5), their sheets most of each capture's weight; an open shadow root's own <style>s are
  // left whole (pruneCssInPage reads the document's) ──
  // Builder A: ADP's, Dayforce's and UltiPro's (3.3 MB of adp-6's 3.5 MB).
  'adp', 'dayforce', 'ultipro',
  // Builder B: ClearCompany's (a whole icon font's rules and more, about 0.6 MB of style a page: clearcompany-*).
  'clearcompany',
  // Builder C: JazzHR's, BambooHR's, Rippling's, Breezy's, CareerPlug's, Pinpoint's, Paycor's and HiBob's (Pinpoint's
  // 2.8 MB a page, Breezy's, HiBob's and BambooHR's over 1.3 MB); the icon fonts' unused rules hold class names that read
  // as words of the redaction list (Font Awesome's star icon in breezy-0, careerplug-0 and -1, pinpoint-0 to -2).
  'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint', 'paycor', 'hibob',
  // ── end New ATSs ──
  // jr7 TOOLING-7: UKG Ready's, Paycom's, JobDiva's, Eightfold's and Jibe's.
  'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe',
];

/** The platforms whose pages keep their open shadow roots (the snapshot build of 2026-11-06: SmartRecruiters, oracle-sf-sr,
 *  and the new ATSs, DESIGN-NEW-ATS §6.2): every query and walk reaches into them (deepenInPage) and they are written as
 *  declarative shadow roots (serializeDeepInPage). Any other platform's page loses the overlays stripInjectedInPage
 *  drops and is refused for any other shadow root. A platform whose pages draw in shadow roots joins by adding its name
 *  here (keepsShadowRoots). */
export const SHADOW_ROOT_PLATFORMS = ['smartrecruiters', ...NEW_ATS_PLATFORMS];

/** Whether a platform's fixtures keep their open shadow roots (SHADOW_ROOT_PLATFORMS). @param {string} platform */
export const keepsShadowRoots = (platform) => SHADOW_ROOT_PLATFORMS.includes(platform);

// ── The snapshot build of 2026-11-06 (the owner's captures): what the owner's own browser added to a page, and an
// upload's file name. Each rule names the capture it was read from; every platform runs them. ────────────────────────
/** Other extensions' UI the owner's browser drew into a captured page, never the site's: Jobright's
 *  <plasmo-csui id="jobright-helper-plugin"> and Swooped's <div id="swooped-extension-root">, both shadow hosts on
 *  <body> ([jobs.ashbyhq.com] Security Engineer @ Blueberry Pediatrics.mht). Removed before anything is measured or
 *  serialized (stripInjectedInPage), so a fixture holds the site's page alone and none of their markup. */
export const INJECTED_UI = ['plasmo-csui#jobright-helper-plugin', '#swooped-extension-root',
  // s2 wd (snapshot5, [pureinsurance.wd5.myworkdayjobs.com] Senior Security Analyst – Cloud Security.mht): Jobright's
  // "Edit with AI" hosts, <div class="jr-edit-ai-host"> each with its open shadow root, drawn beside the page's text
  // areas inside the form.
  '.jr-edit-ai-host'];
/** Query parameters an extension added to a page's address and its links: Jobright's jr_id (a per-person tracking
 *  value; [job-boards.greenhouse.io] ... Cloud Administrator at Nuvem.mht holds it in the page's own address and in
 *  its links, [jobs.ashbyhq.com] Security Operations Engineer @ Critical Loop.mht likewise; Workday's links repeat it,
 *  plain, as an &amp; entity, or percent-encoded inside /login?redirect=), and Simplify's utm_source=Simplify, an entry
 *  "name=value" dropped with that value alone ([apply.workable.com] Infrastructure Engineer - Raydar - Application.mht's
 *  own address). One rule for every platform (stripInjectedParams): dropped from every address (the page's and its
 *  frames', the header, the route map) and from each frame's written text, and refused if any remains. */
export const INJECTED_PARAMS = ['jr_id', 'utm_source=Simplify'];

/** The pattern source of INJECTED_PARAMS entries (`entries`), wherever an address holds one: its separator before (?, &,
 *  &amp;, or percent-encoded once or twice inside another address: %3F, %26, %253F, %2526), its name, = (or %3D,
 *  %253D), its value (a name alone: any value up to the next separator; name=value: that value alone) and the
 *  separator after it, if any. Groups: 1 the separator before, 2 the one after. @param {string[]} entries */
const injectedParamSource = (entries) => `(\\?|&amp;|&|%3F|%26|%253F|%2526)(?:${entries.map((entry) => {
  const [name = '', value] = entry.split('=');
  return value === undefined ? `${escapeSource(name)}(?:=|%3D|%253D)(?:(?!%26|%23|%2526|%2523)[^&#"'\\s<])*`
    : `${escapeSource(name)}(?:=|%3D|%253D)${escapeSource(value)}(?![\\w-])`;
}).join('|')})((?:&amp;|&|%26|%2526)?)`;

/** Escapes a string for a RegExp source (escapeRegExp, which is declared further down). @param {string} text */
function escapeSource(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The one rule that drops another extension's parameters (INJECTED_PARAMS, or the `entries` given) from a text: an
 * address, an attribute or a frame's whole serialized HTML, on every platform. Each goes with its separator and the
 * rest of the query stays: "?jr_id=x&y=1" keeps "?y=1", "?jr_id=x" and "&jr_id=x" leave nothing, "&jr_id=x&y=1" keeps
 * "&y=1", and the same with &amp; or percent-encoded separators, once or twice (a share link's address inside another).
 * Words that only name a parameter ("jr_id stays in words") stay here; the conversion refuses a file that still names
 * jr_id. Answers the text and each parameter dropped (its name and value, kept in memory so the suspicious-token list
 * leaves them out; never printed or written).
 * @param {string} text @param {string[]} [entries]
 * @returns {{ text: string; removed: Array<{ name: string; value: string }> }}
 */
export function stripInjectedParams(text, entries = INJECTED_PARAMS) {
  /** @type {Array<{ name: string; value: string }>} */
  const removed = [];
  const pattern = new RegExp(injectedParamSource(entries), 'gi');
  const names = entries.map((entry) => entry.split('=')[0] ?? entry);
  let out = text;
  // Again until nothing changes: "?jr_id=1&jr_id=2&b=3" needs two passes.
  for (let previous = ''; previous !== out;) {
    previous = out;
    out = out.replace(pattern, (whole, before, after) => {
      const body = whole.slice(before.length, whole.length - after.length);
      const name = names.find((each) => body.toLowerCase().startsWith(each.toLowerCase())) ?? body;
      removed.push({ name, value: body.slice(name.length).replace(/^(?:=|%253D|%3D)/i, '') });
      return /^(?:\?|%3F|%253F)$/i.test(before) ? (after === '' ? '' : before) : after;
    });
  }
  return { text: out, removed };
}

/** Jobright's jr_id alone, by the one rule (stripInjectedParams): the text and how many it stripped (the new ATSs'
 *  DESIGN-NEW-ATS §6.5 reading). @param {string} text @returns {{ text: string; stripped: number }} */
export function stripJrId(text) {
  const { text: out, removed } = stripInjectedParams(text, ['jr_id']);
  return { text: out, stripped: removed.length };
}

/** Where an upload widget shows the applicant's own file's name (the owner's resumes are named after them): its text
 *  becomes REDACTED as a chosen widget value's does, and the name (the place's whole text) wherever else the page
 *  repeats it (redactApplicantTextInPage, every platform). Greenhouse: <div class="file-upload__filename"><svg/><p
 *  class="body body__secondary">NAME</p><button aria-label="Remove file"> ([job-boards.greenhouse.io] ... at Axle
 *  (1).mht); Ashby: <p class="... ashby-application-form-input-file-item-name"><svg/><span>NAME</span></p>
 *  ([jobs.ashbyhq.com] ... @ Owner.com.mht); Workable: <div data-id="filename"><span>HEAD</span><span>TAIL</span></div>
 *  in the drop zone ([apply.workable.com] Infrastructure Engineer - Raydar - Application.mht); Workday: the upload's
 *  preview, [data-automation-id="file-upload-item-name"], whose name the page repeats in "<name> successfully
 *  uploaded", "Delete <name>" and "Category for <name>" (web.wd1's My Experience, "Additional Attachments"). */
export const FILE_NAME_PLACES = ['.file-upload__filename', '.ashby-application-form-input-file-item-name',
  '[data-role="dropzone"] [data-id="filename"]', '[data-automation-id="file-upload-item-name"]',
  // The new ATSs (DESIGN-NEW-ATS §6.4): each element's text and title, the name of a file the applicant attached.
  'ul.jv-file-list .jv-file > span:not(.jv-spinner)', // jobvite-2: the résumé's name beside "remove"
  '[data-fabric-component="FileUploadList"] span[class*="-name"]', // bamboohr-0..2
  'a[ng-if*="file_name"] > span:not(.fa)', // breezy-0, -1: a.bzyLinkColor beside its paperclip
  '.filename', // careerplug-1 (div.file-result-area), paycor-0 (#resumeDropped), hibob-0 (b-file)
  '[data-testid="chip"] [id$="-content"]', // rippling-0, -1, -3: the chip's name (its "Preview file" label repeats it)
  'tr.file-row td.file-name', // clearcompany-0
  '.ant-upload-list-item-name', // dayforce-2: its text and its title
  '[data-automation="file-row"] [data-automation="file-name"]', // ultipro-0: span#FileName<N>
  '[data-automation-id*="_uploaded"]', // paylocity-1: its data-automation-id is built from the name too
  'div:has(> button[aria-label="File options"]) > div.min-w-0', // dice-2, -8: the résumé card
  '[data-test-id="sc-resume"] > .text-font-light', // dice-1, -4, -6, -7: the review step's résumé
  // jr6 (adp-new-4; SP\jr6\audit\adp.md section 2): ADP's Resume step, snapshot6 adp2's uploaded résumé row,
  // <div class="fileDetails"><i class="fa fa-file-text"></i><span class="fileName">NAME</span><button
  // id="recruitment_afterResumeUpload_remove_0" aria-label="Remove,NAME,Resume">. (The success banner beside it is a
  // span.fileName too, holding ADP's own words: not this place.)
  '.fileDetails span.fileName',
  // jr6 (SR-8): SmartRecruiters' drop zone lists the attached file inside its shadow root (snapshot capture 5, the
  // one-click page: <span class="c-spl-file-list-item-name">NAME</span>, its delete spl-button's splarialabel repeating
  // the name).
  '.c-spl-file-list-item-name',
  // jr7 TOOLING-7 (JDEF-16; SP\jr7\audit\jobdiva-eightfold.md, snapshot7 jobdiva2's Quick Apply): JobDiva's drop zone
  // shows the attached résumé as <div class="jd-dropzone-filecard"><span>NAME</span><span><svg/></span></div> (its
  // remove icon beside it), a name the redaction list only caught by chance.
  '.jd-dropzone-filecard > span:first-child',
];
/** Chosen answers drawn outside a native control (a select's shown value, a chip; the new ATSs, DESIGN-NEW-ATS §6.4):
 *  cleared, their words (aria-label, title, alt) and all, a list's own options kept (redactApplicantTextInPage). */
export const CHOSEN_PLACES = [
  'button.fab-SelectToggle', // bamboohr-0..2: Fabric selects, their shown value and their aria-label
  'button[aria-haspopup="dialog"][aria-label^="Pick a date"]', // bamboohr-0..2: "The current value is <date>."
  '[data-testid="screen-reader-only"][role="status"]', // rippling-0, -1, -3: the announced choice or upload
  '.ant-select-selection-item', // dayforce-2: Ant selects (text and title)
  '.rw-input', // paylocity-0: react-widgets
  '[data-automation-id*="-tag-item-"]', // paylocity-0: input-select chips, with their Dismiss labels
  '.rrui__select__button', // adp-6, -0, -1: the phone country's aria-label, its flag's alt and title
  'b-single-select .bfe-input', // hibob-0: the chosen country
  '[data-automation="selected-item"]', // ultipro-0, -1: skill chips and their Remove labels (option texts kept)
  // Builder B, dice-0, -3, -5: the React Aria select's shown option (span#<valueId> div.ListItemTemplate) repeats the
  // chosen option's label in its title, beside the text the trigger's rule clears.
  'button[aria-haspopup="listbox"] .ListItemTemplate',
  // s2 wd (the eeo study's converter findings, snapshot round 2): react-select's chip remove button names the chosen
  // answer, <div role="button" class="select__multi-value__remove" aria-label="Remove <answer>"> (s2-pie-eeo-0, -1;
  // fixtures/sites/seatgeek-greenhouse-embed.frame-1.html); its live region says the choice and the typed search term,
  // <span id="aria-selection">option <answer>, selected.</span>, <span id="aria-focused">, <span id="aria-results">
  // (s2-lightning-0..2). Their words become REDACTED (the guidance, span#aria-guidance, is react-select's own).
  '.select__multi-value__remove[aria-label]',
  'span[id="aria-selection"], span[id="aria-focused"], span[id="aria-results"]',
  // jr6 (adp-new-4; adp.md section 2): ADP's sdf-select-simple draws its chosen option inside its shadow root, its
  // trigger's <span id="selected-label" part="selected-label"><span>ANSWER</span></span> (a blank one draws
  // span#select-placeholder instead) and the live region beside it, <div role="status" class="sr-only">ANSWER</div>
  // (snapshot6 adp1's State / Territory, adp2's Questions lists). :host() keeps both to that element's own tree, where
  // the deep walk of SHADOW_ROOT_PLATFORMS reaches them.
  ':host(sdf-select-simple) #selected-label[part="selected-label"]',
  ':host(sdf-select-simple) [role="status"].sr-only',
  // jr6 (adp-new-4): ADP's react-select (classNamePrefix MDFSelectBox) names the chosen chip in its remove button,
  // aria-label="Remove ANSWER" (adp2's multi-select questions).
  '.MDFSelectBox__multi-value__remove[aria-label]',
  // jr7 TOOLING-7 (UKGR-20; SP\jr7\audit\ukgready.md, snapshot7 secure7.saashr): UKG Ready's value mirror, <span
  // class="c-form-control__value--<hash>" aria-hidden="true"> beside each select and box of a span.c-form-control,
  // which repeats the chosen option or the typed value once the control itself is cleared (an address, a salary, the
  // questionnaire's answers); empty while nothing is chosen.
  '[class*="c-form-control__value"]',
];
/** s2 wd (the eeo study's converter findings): a search's results that list the applicant's own answer, an option of
 *  the list or not: each result's text, title and aria-label become REDACTED, inside a role=option too (redactApplicant-
 *  TextInPage). Greenhouse's location search (s2-lightning-2: <div class="select__option" role="option"
 *  id="react-select-candidate-location-option-0">) and Lever's (s2-ahead-0: <div class="... dropdown-location"
 *  id="location-0">). */
export const SEARCH_RESULT_PLACES = ['[id^="react-select-candidate-location-option-"]', '.dropdown-location'];

// ── jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b, the gap SMARTRECRUITERS P1 found): the names an open list's rows carry ──
/** The rows of an open list or of a search's results, by markup, on every platform (noteListRowsInPage,
 *  redactListRowsInPage): an ARIA option (react-select's .select__option, iCIMS's li.dropdown-result, Workday's
 *  menuItem, Ant's rows), a grid popup's row (Oracle's cx-select: div[role=row] > div[role=gridcell], SP\jr6\audit\
 *  oracle.md), a menu's or a tree's item, a native <option>, and the rows that carry no role on themselves:
 *  SmartRecruiters' <spl-select-option value data-sr-id> (its role=option is inside its shadow root; the Wiser one-click
 *  capture's City results), ADP's <sdf-select-item role=option value aria-label> (snapshot6 adp2's lists) and Lever's
 *  location result (.dropdown-location). A row inside another row is read with the outer one. */
export const LIST_ROWS = ['[role="option" i]', '[role="row" i]', '[role="menuitem" i]', '[role="menuitemradio" i]',
  '[role="menuitemcheckbox" i]', '[role="treeitem" i]', 'option', 'spl-select-option', 'sdf-select-item',
  '.dropdown-location'];
/** The lists that hold a typed query's results, by their own markup. Beside these, any list a text box holding typed
 *  text names (its aria-controls, aria-owns or Lit's ariacontrols, on it or on its role=combobox wrapper, or the list
 *  of the row its aria-activedescendant names), and the popups of TYPED_LIST_BOXES. */
export const TYPED_LISTS = [
  // Workday's prompt search (s2 wd, snapshot4's School search): <div data-uxi-widget-type="multiselectlist"
  // data-uxi-multiselectlist-issearch="true">, its rows' ids naming each result by Workday's id (menuItem-<id>).
  '[data-uxi-multiselectlist-issearch="true" i]',
  // SmartRecruiters' City search (jr6 SMARTRECRUITERS P1, [jobs.smartrecruiters.com] Easy apply - Senior Machine
  // Learning Engineer - Wiser Solutions.mht): <div slot="menu" role="listbox" data-sr-id="location-autocomplete-search-
  // menu">, each result an <spl-select-option value="<place id>" data-sr-id="location-autocomplete-search-option-<place
  // id>"> whose place id spells the city and state typed.
  '[data-sr-id="location-autocomplete-search-menu"]',
];
/** The boxes whose popup always lists a typed query's results: Oracle's cx-select that searches
 *  (input.cx-select-input--auto-suggest, its role=grid popup named by aria-controls; SP\jr6\audit\oracle.md, read from
 *  Jobright's reading, no capture yet) and iCIMS's searched dropdown (select[icimsdropdown-search="1"], its results
 *  ul#<id>_dropdown-results; icimsRedactInPage redacts their words). */
export const TYPED_LIST_BOXES = ['input.cx-select-input--auto-suggest', 'select[icimsdropdown-search="1"]'];
/** The rows of a typed query's list that are the site's own, never a result: SmartRecruiters' manual-location row
 *  (<spl-select-option value="goToManualLocationMode">, the Wiser capture; its adapter declares it unchoosable). */
export const FIXED_ROWS = ['spl-select-option[value="goToManualLocationMode"]'];
/** jr6 fixes (PRIV-7, REVC-4): the lists whose rows (LIST_ROWS) the elimination refusal reads together (listedPlacesInPage)
 *  and the committed-fixture sweep reads alike (eliminatedListsIn): a native select or datalist, and an ARIA listbox,
 *  grid, tree or menu. */
export const LISTED_LISTS = 'select, datalist, [role="listbox" i], [role="grid" i], [role="treegrid" i], [role="tree" i], '
  + '[role="menu" i], [role="menubar" i]';
/** The attributes that say a row's words (or its value): they become REDACTED with the row's words. Beside these, every
 *  data- attribute ROW_WORD_DATA_SOURCE names (Workday's data-automation-label). jr7 TOOLING-7 (r2; snapshot7
 *  smartrecruiter1's screening lists): and a tooltip's content, SmartRecruiters' <spl-tooltip content="<the row's
 *  words>"> inside each row's spl-truncate (a typed result's row loses it with its words; the uneven-rows check reads
 *  it by its presence, as a title). */
export const ROW_WORD_ATTRIBUTES = ['value', 'data-value', 'label', 'aria-label', 'title', 'alt', 'aria-description',
  'aria-valuetext', 'splarialabel',
  // jr7 TOOLING-7 (r2)
  'content'];
/** The data- attributes that say a row's words. */
export const ROW_WORD_DATA_SOURCE = '^data-[\\w-]*(?:label|name|text|title|value|caption|display)$';
/** The attributes that identify a row (its id, a name, an address, a data- id or key): normalised, so what names the
 *  row in them becomes REDACTED and the rest stays (redactListRowsInPage). Beside these, every data- attribute
 *  ROW_ID_DATA_SOURCE names (SmartRecruiters' data-sr-id, Workday's data-automation-id and data-uxi-multiselect-id). */
export const ROW_ID_ATTRIBUTES = ['id', 'name', 'href', 'data-id', 'data-key'];
/** The data- attributes that identify a row. */
export const ROW_ID_DATA_SOURCE = '^data-[\\w-]+-(?:id|key)$';
/** The attributes that name an element by its id, renamed with it (Lit's unhyphenated spellings too: SmartRecruiters'
 *  spl-input ariacontrols). */
export const ID_REFERENCES = ['aria-activedescendant', 'aria-controls', 'aria-owns', 'aria-labelledby',
  'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'for', 'headers', 'list', 'ariacontrols',
  'ariaactivedescendant', 'arialabelledby', 'ariadescribedby'];
// ── end jr6 round 2 ──

// ── jr6 PRIVACY-FIX ──
/** The id attributes whose words a row's id normalisation leaves alone (redactListRowsInPage): Workday's
 *  data-automation-id is built from Workday's own vocabulary and names the component's kind (a chosen pill's
 *  DELETE_charm, promptOption, selectedItem), so a word the row's own label also says (the pill's "press delete to clear
 *  value") is no name of the row there; an opaque token in it and a value the row gave are still made REDACTED. */
export const ROW_ID_WORDS_KEPT = ['data-automation-id'];
/** The attributes that hold a JSON copy of the posting (Breezy's data-position on div.body-wrapper: the posting's name,
 *  its description's HTML, its address, its company), each with its title and description fields (top-level keys). A
 *  listed or respelled string met in those fields is redacted there, as in any attribute, and noted as a posting place,
 *  so the elimination refusal (listedPlacesInPage) asks for synthetic text; --replace-text '<css>@<attribute>=<file>'
 *  gives it: each title field the file's first line, each description field its other lines (all of them if it has
 *  one). Another platform's copy is one more entry. */
export const POSTING_COPY_ATTRIBUTES = [{ attribute: 'data-position', title: ['name'], description: ['description'] }];
// ── end jr6 PRIVACY-FIX ──

/** jr6 (jobvite-new-2): a posting's description, where the redaction list may meet the page's own words (a town, a
 *  school, an employer the posting names): each adapter's posting text (src/adapters/<platform> postingText or its
 *  config's posting.text), and ADP's (BUILD.md section 4, E-ADP). A REDACTED there would tell the listed value by
 *  elimination, so the conversion refuses it until the element is replaced (--replace-text). */
export const POSTING_TEXT_PLACES = [
  '[data-automation-id="jobPostingDescription"]', // workday
  '.iCIMS_JobContent', // icims
  '.job-details__description-content', // oracle
  'main.jobad-main .job-sections', // smartrecruiters
  '[data-ui="job-description"]', '[data-ui="job-requirements"]', '[data-ui="job-benefits"]', // workable
  '.editablesection', // taleo
  '.joqReqDescription', // successfactors
  '.ashby-job-posting-description', // ashby
  'div.jv-job-detail-description', // jobvite
  '#job-description', '#resumator-job-description', // jazzhr (the Bootstrap boards; the classic board, jr6 JAZZHR P1)
  'div.job-description-container', // careerplug
  '#external-jobs-show-description', // pinpoint
  'div.ATS_htmlPreview', // rippling
  'div.job-description-data', // adp
  // The page's description metadata, a copy of the posting's text (the owner's Workday postings of 2026-11-06:
  // <meta name="description" content="...">; iCIMS's og:description and twitter:description beside it).
  'meta[name="description" i]', 'meta[property="og:description" i]', 'meta[name="twitter:description" i]',
  'meta[property="twitter:description" i]',
];

/** How a refusal names each kind of place listedPlacesInPage counts. @type {Record<string, string>} */
const LISTED_PLACE_WORDS = { option: 'options (an <option> or a role=option)', label: 'labels', legend: 'legends',
  posting: 'posting descriptions (POSTING_TEXT_PLACES)' };

// ── The security fix of 2026-11-06 (S2, S3, S10): chosen marks keyed by markup, cleared and refused ──
/** A CSS module's chosen class, whatever its hash (Ashby's `_checked_132c8_44`). */
export const MODULE_CHOSEN_SOURCE = '^_(?:checked|selected|active)_[A-Za-z0-9_-]+$';
/** MUI's chosen and focus classes. */
export const MUI_CHOSEN = ['Mui-checked', 'Mui-selected', 'Mui-focusVisible'];
/** A BEM modifier that marks an option or a choice chosen, highlighted or active. */
export const BEM_CHOSEN_SOURCE = '^[\\w-]+--(?:checked|selected|is-selected|is-focused|is-checked|active|is-active)$';
/** The roles of an option or a choice. */
export const CHOICE_ROLES = ['option', 'radio', 'checkbox', 'switch', 'menuitem', 'menuitemradio', 'menuitemcheckbox'];
/** The words of a class that names an option or a choice. */
export const CHOICE_CLASS_SOURCE = 'option|choice|radio|checkbox';
/** An option or a choice: its role says so, or a class names one. */
export const CHOICE_ELEMENTS = [...CHOICE_ROLES.map((role) => `[role="${role}" i]`),
  ...CHOICE_CLASS_SOURCE.split('|').map((word) => `[class*="${word}" i]`)].join(', ');
/** The roles whose aria-selected="true" is a chosen value: an option, a calendar's day, a tree's item. */
export const CHOSEN_OPTION_ROLES = ['option', 'gridcell', 'treeitem'];
/** Those, but Workday's own "Select One" (data-value=""), which is no answer. */
export const CHOSEN_OPTIONS = CHOSEN_OPTION_ROLES.map((role) => `[role="${role}" i]:not([data-value=""])`).join(', ');
// ── end of the security fix's block ──

// ── jr6 fixes (TOOLING; the line W reviews, PRIV-2 and REVC-4): a chosen row told by its roving tab stop, by a custom
// control's reflected state or name, by Angular's state classes on its components, and by a part only it draws ──
/** The rows that can hold a widget's one roving tab stop (WAI-ARIA's roving tabindex: tabindex="0" on the chosen or
 *  last-focused row, "-1" on the others): an ARIA option, radio, box, switch, menu item, tree item, grid cell or grid row
 *  (by its role's first word), and the rows that carry no such role: a native option, SmartRecruiters' spl-select-option
 *  (its role=option is inside its own shadow root). A tab (role=tab) is no answer: the open tab keeps its stop. Snapshot6
 *  adp1's State list and adp2's Questions lists (ADP's sdf-select-item, role=option: the chosen row tabindex="0", every
 *  other "-1"; the blank pages' lists hold the stop on their first row) and the Wiser screening capture's Yes/No
 *  (SmartRecruiters' spl-radio, role=radio: likewise; an unanswered group, xplor-screening.html, on its first radio). */
export const ROVING_ROLES = ['option', 'radio', 'checkbox', 'switch', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
  'treeitem', 'gridcell', 'row'];
/** The rows ROVING_ROLES does not reach by role. */
export const ROVING_TAGS = ['option', 'spl-select-option', 'sdf-select-item'];
/** The widget a row's tab stop roves in: its nearest ancestor (a shadow root's host included) with one of these roles or
 *  tags, else the nearest ancestor that holds another row of the row's kind (its role, else its tag). */
export const ROVING_GROUP_ROLES = ['listbox', 'grid', 'treegrid', 'tree', 'radiogroup', 'menu', 'menubar'];
/** The widgets ROVING_GROUP_ROLES does not reach by role. */
export const ROVING_GROUP_TAGS = ['select', 'datalist'];
/** The parts a widget draws, inside its shadow root, on its chosen row alone, removed before anything is measured
 *  (clearChoicesInPage), so the visibility check compares the page without them; refused where they stay
 *  (chosenMarksIn). Found while building REVC-4's row check on the line W fixtures: ADP's sdf-radio-button draws its dot
 *  (svg.toggled > circle.radio-dot) on the chosen radio alone, a radio the page chooses by default included (snapshot6
 *  adp2's Questions and its salary basis, adp's Resume choice), and ADP's sdf-select-item a check mark
 *  (div#checked-icon > sdf-icon) on the chosen item alone (adp1's State list, adp2's Questions lists). Each names the
 *  host whose tree draws it and the part by its tag, id or class (jr7 TOOLING-7: or its slot). jr7 TOOLING-7 (r2,
 *  BOARDS-7's finding on snapshot7 smartrecruiter1's screening page, filled): SmartRecruiters' spl-dropdown-item draws
 *  a check icon on its chosen row alone, <spl-icon slot="suffix"> in its light tree (the Gender and Race/Ethnicity
 *  lists; the phone country list of the one-click pages too). @type {Array<{ host: string; tag?: string; id?: string;
 *  className?: string; slot?: string }>} */
export const CHOSEN_DRAWINGS = [
  { host: 'sdf-radio-button', tag: 'circle', className: 'radio-dot' },
  { host: 'sdf-select-item', id: 'checked-icon' },
  // jr7 TOOLING-7 (r2)
  { host: 'spl-dropdown-item', tag: 'spl-icon', slot: 'suffix' },
];
/** A CHOSEN_DRAWINGS part as a selector, in its host's light tree or its shadow root (deepenInPage reaches both).
 *  @param {{ host: string; tag?: string; id?: string; className?: string; slot?: string }} part */
const drawingSelector = ({ host, tag = '', id, className, slot }) => {
  const own = `${tag}${id === undefined ? '' : `#${id}`}${className === undefined ? '' : `.${className}`}`
    + `${slot === undefined ? '' : `[slot="${slot}"]`}`;
  return `${host} ${own}, :host(${host}) ${own}`;
};
/** jr6 fixes (PRIV-1's value mirror, found by the ADP fixer): an attribute in which a widget repeats its group's chosen
 *  value on each row, blanked on every conversion (clearChoicesInPage; an unanswered group draws it empty) and refused
 *  where it stays (chosenMarksIn): ADP's <wfn-radio-button value="..." radio-group-value="<the chosen row's value>">
 *  (snapshot6 adp2's Questions Yes/No and the guest sign-in's code choice; adp/jr6-questions2-blank draws it ""). A
 *  scan of every committed fixture (jr6-forms and jr6-adp, custom elements' attributes equal to a row's value, and
 *  value-like attributes on custom lists and groups) found no other such mirror.
 *  @type {Array<{ tag: string; attribute: string }>} */
export const VALUE_MIRRORS = [{ tag: 'wfn-radio-button', attribute: 'radio-group-value' }];
/** What clearChoicesInPage reads beside CHOSEN_MARKS on every conversion: the roving rows and their widgets, the
 *  CHOSEN_DRAWINGS parts and the VALUE_MIRRORS. */
/** jr7 TOOLING-7 (UP7-14; SP\jr7\audit\ultipro.md, snapshot7 ultipro1 and ultipro2): a row a page opens or closes by
 *  the person's answer, drawn open (`className` added) by clearChoicesInPage before anything is measured, as before any
 *  answer, so the row's state tells nothing and the visibility measured is the fixture's. UltiPro's self-identification
 *  survey opens its Race row unless the Hispanic-origin answer is "No" (<div class="row collapse" data-bind="collapse:
 *  isHispanic() != 'No'">; Bootstrap's collapse shows it with "in"): open in ultipro-0, closed in ultipro-1 and in all 19
 *  of snapshot7's application captures, which the converter refused ("visibility changed for 9 elements") while it opened
 *  the row only after the measure (redactApplicantTextInPage).
 *  @type {Array<{ selector: string; className: string }>} */
export const OPENED_ROWS = [{ selector: '.collapse[data-bind*="isHispanic()"]', className: 'in' }];
export const CLEAR_CHOICE_INPUT = {
  roving: { roles: ROVING_ROLES, tags: ROVING_TAGS, groupRoles: ROVING_GROUP_ROLES, groupTags: ROVING_GROUP_TAGS },
  drawings: CHOSEN_DRAWINGS.map(drawingSelector),
  mirrors: VALUE_MIRRORS,
  // jr7 TOOLING-7 (UP7-14)
  opened: OPENED_ROWS,
};
// ── end jr6 fixes ──

/** jr6 (jobvite-new-4): AngularJS's (and Angular's) state classes, which a filled capture leaves on its controls: an
 *  answered or clicked control's validity (ng-valid, ng-invalid, ng-pending and each ng-valid-<rule> and
 *  ng-invalid-<rule>: ng-valid-required beside an answer, ng-valid-parse on a clicked radio), its emptiness (ng-empty,
 *  ng-not-empty: a ticked box) and its touch (ng-pristine, ng-dirty, ng-untouched, ng-touched: the radio clicked).
 *  Snapshot6 jobvite1 (6), (7) and jobvite2 (5): the clicked radio alone ng-dirty, a ticked box alone ng-not-empty. */
export const ANGULAR_STATE_SOURCE =
  '^ng-(?:(?:valid|invalid|pending)(?:-[\\w-]+)?|not-empty|empty|dirty|pristine|touched|untouched)$';
/** The elements that carry them. jobvite-new-4 read every control and every element bound by ng-model or grouping them
 *  by ng-form; jr6 fixes (PRIV-2): every element but a form, since Angular (2+) puts them on its reactive forms' custom
 *  controls and their groups too, where no attribute need say so (SmartRecruiters' one-click pages: oc-input,
 *  spl-input, spl-checkbox, spl-autocomplete, spl-phone-field and the sections around them, the required box's
 *  ng-valid telling it ticked; HiBob's b-input, b-checkbox, b-single-select). A <form> keeps its own: Breezy's adapter
 *  test reads its root's validity. */
export const ANGULAR_STATE_ELEMENTS = '[class*="ng-"]:not(form)';

/** The marks a drawn control or a list shows on the chosen answer, beside the input whose checked or selected state is
 *  dropped (the new ATSs, keyed by markup): every element `selector` names loses `classes` and the classes `patterns`
 *  match, and the attributes `attributes` names; each class `swap` names is replaced by its unchosen twin (jr6, JV-10);
 *  and, unless `aria` is false, its aria-selected="true" becomes "false" (clearChoicesInPage, before anything is
 *  measured). The security fix of 2026-11-06 (S2, S3, S10) adds the generic marks of every platform; chosenMarksIn
 *  refuses a written fixture that still holds one.
 *  @type {Array<{ selector: string; classes?: string[]; patterns?: string[]; attributes?: string[]; aria?: boolean;
 *    swap?: Record<string, string> }>} */
export const CHOSEN_MARKS = [
  // Builder A: Ant Design's drawn radios and boxes, chosen by their wrapper's and span's classes (dayforce-0: the
  // questionnaire's answers; dayforce-1: the acknowledgement).
  { selector: '.ant-radio-wrapper-checked, .ant-radio-checked, .ant-checkbox-wrapper-checked, .ant-checkbox-checked',
    classes: ['ant-radio-wrapper-checked', 'ant-radio-checked', 'ant-checkbox-wrapper-checked', 'ant-checkbox-checked'] },
  // Builder A: an Ant select's list, drawn at the end of the body once it was opened (dayforce-2): its options' chosen
  // and active marks (a searchable select's option words are redactApplicantTextInPage's).
  { selector: '.ant-select-dropdown [role="option"], .ant-select-dropdown .ant-select-item-option',
    classes: ['ant-select-item-option-selected', 'ant-select-item-option-active'] },
  // Builder B: a react-widgets list, kept hidden in its widget once opened (paylocity-0, -1), marks the chosen option.
  { selector: 'li.rw-list-option[role="option"]', classes: ['rw-state-selected'] },
  // Core pass Z1, item 36: HiBob's drawn radios (hibob-0: <b-radio-button><div role="radiogroup"><div class="flx min-w-0
  // selected"><input type="radio" class="brd-input"><label class="... brd-label min-w-0 selected">), the chosen one's
  // wrapper and label marked selected: the applicant's answer to a screening question.
  { selector: 'b-radio-button [role="radiogroup" i] .selected', classes: ['selected'] },
  // ── The security fix of 2026-11-06 (S2, S3, S10): the chosen marks of every platform, keyed by markup ──
  // CSS modules' chosen classes, whatever the module's hash: Ashby's (rivian-submitting: a chosen radio's or box's
  // label and span `_checked_<hash>`, a Yes/No's pressed button and the open tab `_active_<hash>`).
  { selector: '[class*="_checked_"], [class*="_selected_"], [class*="_active_"]', patterns: [MODULE_CHOSEN_SOURCE],
    aria: false },
  // MUI's (swyfft-form: a chosen radio's span Mui-checked; Mui-selected and Mui-focusVisible likewise).
  { selector: MUI_CHOSEN.map((name) => `.${name}`).join(', '), classes: [...MUI_CHOSEN], aria: false },
  // BEM modifiers on an option or a choice (CHOICE_ELEMENTS): Oracle's apply-flow-input-checkbox__button--checked
  // (hjf-apply-section), react-select's select__option--is-selected and --is-focused (Greenhouse), BambooHR's
  // fab-MenuOption--active menu items (swyfft-form).
  { selector: CHOICE_ELEMENTS, patterns: [BEM_CHOSEN_SOURCE], aria: false },
  // An open list's chosen or highlighted option and a calendar's chosen day (role option, gridcell or treeitem):
  // aria-selected="true" becomes "false" (SmartRecruiters' phone country, xplor-one-click; Greenhouse's, Workday's and
  // Workable's lists). Workday's own "Select One" (data-value="") is no answer (redactWorkdayInPage keeps it).
  { selector: CHOSEN_OPTIONS, classes: [] },
  // SmartRecruiters' chosen list item (xplor-one-click: <spl-dropdown-item selected>, its option's aria-selected inside
  // its shadow root).
  { selector: 'spl-dropdown-item[selected]', attributes: ['selected'], aria: false },
  // ── end of the security fix's block ──
  // ── jr6 (JV-10, adopted from the Jobvite audit's converter change in wt-s2gh): Jobvite's drawn radios and boxes
  // (snapshot6 jobvite1 (6), (7) and jobvite2 (5)). Each option is <label class="jv-input-group-row ...
  // jv-input-group-row-active"><i class="icon icon-radio-checked" role="radio" aria-selected="true"> beside its native
  // input; an unchosen one draws icon-radio-empty and aria-selected="false" (a box: icon-checkbox-checked and
  // icon-checkbox-blank). The chosen row's class goes; its icon is swapped for the unchosen one (removing it alone would
  // still single the row out) and its aria-selected becomes "false"; a drawn box's aria-checked ("" until touched,
  // "true" ticked, which the generic pass makes "false") goes from every box, as untouched. ──
  { selector: 'label.jv-input-group-row', classes: ['jv-input-group-row-active'], aria: false },
  { selector: 'label.jv-input-group-row i[role="radio"], label.jv-input-group-row i[role="checkbox"]',
    swap: { 'icon-radio-checked': 'icon-radio-empty', 'icon-checkbox-checked': 'icon-checkbox-blank' },
    attributes: ['aria-checked'] },
  // jr6 (jobvite-new-4): AngularJS's state classes, from every control and every ng-model or ng-form element alike (the
  // audit's change cleared them on Jobvite's radios and boxes; the verifier found them on every control). jr6 fixes
  // (PRIV-2): and Angular's, from every element but a form (ANGULAR_STATE_ELEMENTS).
  { selector: ANGULAR_STATE_ELEMENTS, patterns: [ANGULAR_STATE_SOURCE], aria: false },
  // jr6 (adp-new-4; adp.md section 2): ADP's sdf-select-simple list marks its chosen <sdf-select-item role="option"
  // class="... selected" aria-selected="true"> inside its shadow root (snapshot6 adp2's Questions lists).
  { selector: 'sdf-select-item.selected, sdf-select-item[aria-selected="true" i]', classes: ['selected'] },
  // ── end jr6 ──
  // ── jr6 fixes (the line W reviews: PRIV-2, REVC-4) ──
  // A custom control's reflected state: SmartRecruiters' chosen spl-radio says checked="true" (the Wiser screening
  // capture); any element but an input or an option (whose own state transformInPage drops) that says it is checked or
  // selected says the answer.
  { selector: '[checked]:not(input, option), [selected]:not(input, option)', attributes: ['checked', 'selected'],
    aria: false },
  // SmartRecruiters names the chosen spl-radio alone (name="<the question's>"; the Wiser screening capture): an
  // unanswered group's radios carry no name (xplor-screening.html).
  { selector: 'spl-radio[name]', attributes: ['name'], aria: false },
  // ADP's chosen sdf-radio-button draws its dot's svg toggled (the dot itself is a CHOSEN_DRAWINGS part).
  { selector: 'sdf-radio-button svg.toggled, :host(sdf-radio-button) svg.toggled', classes: ['toggled'], aria: false },
  // ── end jr6 fixes ──
  // ── jr7 TOOLING-7 (T7-01; SP\jr7\audit\dayforce-paycom.md, snapshot7 paycomonline1): Paycom's uiLib marks the chosen
  // radio's wrapper (<div class="uiLibRadio ui-radio-lg ui-radio-checked">) and the ticked box's label (<label
  // class="uiLibCheckbox ui-checkbox-checked">); their icons are CHOSEN_ICONS'. ──
  { selector: '.ui-radio-checked, .ui-checkbox-checked', classes: ['ui-radio-checked', 'ui-checkbox-checked'] },
  // jr7 TOOLING-7 (r2, BOARDS-7's finding; snapshot7 smartrecruiter1's screening page, filled): SmartRecruiters'
  // spl-dropdown-item draws, inside its shadow root, <div class="c-spl-dropdown-item c-spl-dropdown-item--with-suffix"
  // role="option"> on the chosen row alone (its suffix icon is a CHOSEN_DRAWINGS part), and "active" on the row its focus
  // stands on (the first, or the chosen one): both go from every row, so no row reads apart. ("active" is read by its
  // pattern on these rows alone: a tab's or a menu's own "active" elsewhere is no answer, and chosenMarksIn names it not.)
  { selector: '.c-spl-dropdown-item.active, .c-spl-dropdown-item--with-suffix', classes: ['c-spl-dropdown-item--with-suffix'],
    patterns: ['^active$'], aria: false },
];

/** jr7 TOOLING-7 (T7-01; snapshot7 paycomonline1's application steps): an icon a widget draws for its chosen state, which
 *  clearChoicesInPage replaces with a copy of the page's own unchosen twin (`twin`: the first in the document), as the
 *  page draws an unchosen row; the conversion refuses a file where one stays (`testid`: chosenMarksIn reads it, a page
 *  with no twin to copy among them). Paycom's uiLib radio, <span class="uiLibRadioIcon"><svg
 *  data-testid="uiLibRadioIconcheckedNoColorPassed" aria-label="radio button checked" color="..."><path/><path/></svg>
 *  (unchosen: uiLibRadioIconUncheckedNoColorPassed, "radio button unchecked"), and its box, <button
 *  class="uiLibCheckboxButton"><svg data-testid="Checked Checkbox-icon" aria-label="Checked Checkbox"> (unchosen:
 *  "Unchecked Checkbox-icon"): each svg's paths, colour, test id and label tell the answer.
 *  @type {Array<{ chosen: string; twin: string; testid: string }>} */
export const CHOSEN_ICONS = [
  { chosen: '.uiLibRadioIcon > svg[data-testid^="uiLibRadioIconchecked"]',
    twin: '.uiLibRadioIcon > svg[data-testid^="uiLibRadioIconUnchecked"]', testid: '^uiLibRadioIconchecked' },
  { chosen: '.uiLibCheckboxButton svg[data-testid="Checked Checkbox-icon"]',
    twin: '.uiLibCheckboxButton svg[data-testid="Unchecked Checkbox-icon"]', testid: '^Checked Checkbox-icon$' },
];

/** jr7 TOOLING-7 (T7-01): attributes in which a widget spells the text it shows, each value's middle (group 2 of
 *  `source`) made REDACTED on every conversion (redactApplicantTextInPage) and refused where it stays (spelledIdsIn):
 *  Paycom's uiLib names every tooltip anchor after the text it shows, data-testid="anchor-for-<text>-tooltip" (395 in
 *  snapshot7 paycomonline1's eight captures: an email, a phone, cities, employers, job titles and a salary among the
 *  page's own labels); an empty one (anchor-for--tooltip) is left as drawn.
 *  @type {Array<{ attribute: string; source: string }>} */
export const SPELLED_IDS = [{ attribute: 'data-testid', source: '^(anchor-for-)(.+)(-tooltip)$' }];

/** jr6 (JV-10): the option rows of a choice group, which hold no answer once cleared, so every row of one group must
 *  read alike but for its text, ids, names, values and labels (unevenChoiceRowsInPage refuses a page where they do
 *  not: a chosen mark CHOSEN_MARKS does not know yet). Each entry names a group and its rows by markup, and (`own`) any
 *  attribute of the row element itself that names its option there, read by its presence alone.
 *  @type {Array<{ group: string; row: string; from: string; own?: string[] }>} */
export const CHOICE_ROWS = [
  { group: 'fieldset.jv-input-group', row: 'label.jv-input-group-row',
    from: 'snapshot6 jobvite1 (6), (7), jobvite2 (5): Jobvite\'s radio and box groups' },
  // ── jr6 fixes (PRIV-2, REVC-4): the widgets whose chosen row the line W reviews found told by a mark the converter did
  // not know (a roving tab stop, a reflected checked, a name, a drawn dot or check mark) ──
  { group: 'spl-radio-group', row: 'spl-radio', from: 'the Wiser screening capture: SmartRecruiters\' Yes/No' },
  { group: 'sdf-radio-group', row: 'sdf-radio-button', own: ['class'],
    from: 'snapshot6 adp2\'s Questions: ADP\'s Yes/No and salary basis (each radio\'s own class names its option)' },
  { group: '[role="listbox" i]', row: 'sdf-select-item', from: 'snapshot6 adp1\'s State list, adp2\'s Questions lists' },
  { group: '[role="listbox" i]', row: 'spl-select-option',
    from: 'SmartRecruiters\' lists (the Wiser capture\'s City results; the site\'s own rows, FIXED_ROWS, aside)' },
];
/** What unevenChoiceRowsInPage reads beside CHOICE_ROWS (jr6 fixes): a row's own naming attributes, read by their
 *  presence alone in every element of the row (its ids, names, values and labels, as redactListRowsInPage reads them),
 *  and the site's own rows, left out. */
export const CHOICE_ROW_INPUT = {
  own: [...new Set(['id', 'for', 'name', 'value', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-label',
    'title', ...ROW_ID_ATTRIBUTES, ...ROW_WORD_ATTRIBUTES])],
  ownData: [ROW_ID_DATA_SOURCE, ROW_WORD_DATA_SOURCE],
  fixed: FIXED_ROWS.join(', '),
  // jr7 TOOLING-7 (r2): the roles whose roving tab stop the first row's own tree may hold (SmartRecruiters'
  // div[role=option] inside its spl-dropdown-item's shadow root).
  roving: ROVING_ROLES,
};

/** The account's and the profile's own text (the new ATSs, DESIGN-NEW-ATS §6.4): a welcome line, an account menu, a
 *  signature's date stamp, read-only summaries of what was entered or parsed. Cleared, words and all. */
export const PROFILE_PLACES = [
  'div.welcome-alert-message-box', // adp-1: "Welcome! <first name>,"
  '.self-review-signature-label > div', // adp-4, -5: the e-signature's date-time stamp
  'nav[aria-label="Account"] button[aria-haspopup]', // dice-0..8: the account holder's name and initials
  'nav[aria-label="Account"] [role="menu"] > div:first-child', // dice-0..8: the account menu's header
  '#profile-button-menu', // ultipro-0, -1: the name, in its text and its shadow root's button label
  ['title-and-company', 'location', 'date-range', 'description', 'degree-major-minor', 'school']
    .map((label) => `[data-automation="panel-list-item"] [data-automation="${label}-label"]`).join(', '), // ultipro-0
  'form[test-id$="-record"] [test-id*="-read-"]', // dayforce-2: the education and employment record cards
  '#pcty-wr-preview-jobapplication .no-wrap-value, #pcty-wr-preview-jobapplication h3[id^="info."]', // paylocity-1
  'careers-ui-experience-display-item .b-heading, careers-ui-experience-display-item .b-bold-body', // hibob-0
  '[data-automation="global-notification"] [data-bind*="message"]', // ultipro-1: the résumé pre-fill notice
  '[data-test-id^="sc-"] > .text-font-light', // dice-1, -4, -6, -7: the review step's answers
  'tr.file-row td.file-created-date', // clearcompany-0: when the file was uploaded
  // ── jr6 (adp-new-4; SP\jr6\audit\adp.md section 2, snapshot6 adp1 and adp2, signed in) ──
  // The signed-in shell's account: the avatar button, <div class="logged-in-user"><div class="avatar-button"
  // aria-label="<initials>, Show user menu">, every <sdf-avatar aria-label="<name>"> (its initials the text of its
  // shadow root), and the account menu's header naming the person (<div class="avatar-menu avatar-menu-header">
  // <sdf-avatar></sdf-avatar><h2>NAME</h2>, also shown on the confirmation page).
  '.logged-in-user .avatar-button', 'sdf-avatar', '.avatar-menu-header > h2',
  // The Review step's summary (adp1's Review your application): each personal-information line (<div
  // class="self-review-content-personalInfo"><sdf-icon icon="user"></sdf-icon><span>LINE</span>), the résumé's name and
  // preview (span.self-review-content-resume-content, its aria-label the same words), the additional documents' line and
  // each answer (<label class="self-review-content-question-answer">ANSWER</label>).
  '.self-review-content-personalInfo > span', '.self-review-content-resume-content',
  '.self-review-content-additionaldocs > span', 'label.self-review-content-question-answer',
  // The posting page signed in: the applicant's own date (<span class="job-description-applied-date">).
  'span.job-description-applied-date',
  // ── jr6 (SR-8; SP\jr6\audit\smartrecruiters.md SR-8, snapshot captures 4 and 5): SmartRecruiters' one-click page ──
  // Each saved entry, <oc-experience-entry data-test="experience-entry"> and <oc-education-entry>: its title, company or
  // institution, dates, degree, major and description (data-test="experience-entry-title", ...) and its Edit and Delete
  // spl-buttons, whose splarialabel (and their shadow button's aria-label) names the entry; and spl-avatar, the typed
  // name in its aria-label and the initials in its shadow root (its firstname and lastname attributes are
  // redactPlatformInPage's).
  'oc-experience-entry [data-test^="experience-entry-"]', 'oc-education-entry [data-test^="education-entry-"]',
  'spl-avatar',
  // ── jr7 TOOLING-7 (UKGR-20; SP\jr7\audit\ukgready.md, snapshot7 secure7.saashr, signed in to the applicant session) ──
  // The review's values (step 8/9: <div class="c-profile-summary-container"> ... <span
  // class="c-one-column-layout__value">), each saved entry's metadata (a work or education entry, a reference: <div
  // class="c-fat-item__body"><span class="c-metadata__text">: its place, its dates) and the avatar's initials (<span
  // class="c-user-picture__abbr" title="<name>">, too short for any list; and its button, <button
  // class="c-user-picture-button" title="<name>" aria-label="<name>">, which names the person whatever the list holds).
  '.c-profile-summary-container .c-one-column-layout__value', '.c-fat-item__body .c-metadata__text',
  'span.c-user-picture__abbr', 'button.c-user-picture-button',
  // ── jr7 TOOLING-7 (T7-02; SP\jr7\audit\dayforce-paycom.md, snapshot7 dayforce1 captures 5 to 8): Dayforce's Personal
  // Information read view once Update is pressed, outside any form[test-id$="-record"]: the name (a middle name too),
  // address, city, state and zip, country, the preferred contact (personal-info-read-listed-items), the phone and the
  // email, each a [test-id^="personal-info-read-"]; its labels end in "-label" ("Mobile Phone:", "Email:", the question
  // "How did you hear about this job?") and stay. One "-label" is the answer itself: personal-info-read-candidate-source-
  // label holds the source the person chose (no colon or question mark, no option of the form's), the fact FIXPLAN §0
  // protects, so it goes too.
  '[test-id^="personal-info-read-"]:not([test-id$="-label"])', '[test-id="personal-info-read-candidate-source-label"]',
];

/** The controls beside an uploaded file that name it, and link to it: Workable's <a data-action="view" href="<the
 *  file's signed storage address>" aria-label="view NAME"> and <button data-action="delete" aria-label="delete NAME">
 *  (the Raydar capture). Their aria-label and title become "<their data-action> REDACTED", their address "#". One with
 *  neither a data-action nor a title keeps its label's own words around a file name the page showed
 *  (FILE_NAME_PLACES), the name REDACTED; any other label becomes REDACTED whole. */
export const FILE_LINK_PLACES = ['[data-role="dropzone"] [role="menu"] [data-action]',
  // jr6 (adp-new-4; adp.md section 2): ADP's Remove beside the uploaded résumé, aria-label="Remove,NAME,Resume"
  // (snapshot6 adp1's Resume step).
  'button[id^="recruitment_afterResumeUpload_remove_"]'];
/** Where a page shows an entry it read from the applicant's resume, as text: Workable's saved Education and Experience
 *  entries, <li><div data-ui="group"><dl><dt>School</dt><dd data-ui="school"><span>NAME</span></dd></dl> ... <dd
 *  data-ui="period"> ... (and title, company, summary, field_of_study, degree), filled by its "Import resume from"
 *  ([apply.workable.com] Infrastructure Engineer - Raydar - Application.mht): every dd's text becomes REDACTED. */
export const ENTRY_SUMMARY_PLACES = ['[data-ui="education"] li [data-ui="group"] dd',
  '[data-ui="experience"] li [data-ui="group"] dd'];
/** The controls beside such an entry that name it: Workable's <a data-ui="edit-section" title="Edit" aria-label="Edit
 *  NAME"> and <a data-ui="remove-section" title="Delete" aria-label="Delete NAME"> (the Raydar capture): their
 *  aria-label becomes "<their title> REDACTED". */
export const ENTRY_SUMMARY_CONTROLS = ['[data-ui="education"] li [data-ui$="-section"]',
  '[data-ui="experience"] li [data-ui$="-section"]'];
/** Query parameters whose value is a token made for one page load, or a visitor's tracking id, in a frame's address or
 *  a link: the value becomes REDACTED wherever it stands, in the page, its frames' addresses, the header and the route
 *  map alike (so a frame's src still finds its route). Greenhouse's embed, validityToken= (job-boards.greenhouse.io/
 *  embed/job_app?for=<board>&validityToken=<token>&token=<id>, the frame of [abclegal.com] ABC Legal - Job Openings
 *  (1).mht and of [seatgeek.com] ...SeatGeek.mht; /embed/job_board?for=<board>&validityToken=<token> in [weka.io]
 *  ...WEKA.mht); reCAPTCHA's challenge frame, bft= (recaptcha.net/recaptcha/enterprise/bframe in [jobs.ashbyhq.com]
 *  Head of Technology Foundations @ Rivian ....mht; and Dayforce's, google.com/recaptcha/api2/bframe in dayforce-0 to -2);
 *  HubSpot's visitor ids in a company page's links, hsutk=, __hstc=, __hssc=, __hsfp= (the ABC Legal capture).
 *  jr7 TOOLING-7 (UKGR-20; SP\jr7\audit\ukgready.md, snapshot7 secure7.saashr): UKG Ready's applicant session in every
 *  address of the application, ActiveSessionId= (11 digits), sft= and rnd=; and its file service's ticket=, a JWT that
 *  opens the applicant's uploaded document (/ta/fs?ticket=<JWT>). */
export const PER_LOAD_PARAMS = ['validityToken', 'bft', 'hsutk', '__hstc', '__hssc', '__hsfp',
  // jr7 TOOLING-7 (UKGR-20)
  'ActiveSessionId', 'sft', 'rnd', 'ticket'];

/** The pattern source of a PER_LOAD_PARAMS value in an address (group 1: its separator, name and =), as
 *  withoutInjectedParams and stripInjectedInPage read it. */
const PER_LOAD_SOURCE = `([?&](?:${PER_LOAD_PARAMS.join('|')})=)[^&#]*`;

// ── jr6 fixes (TOOLING; the line W privacy review, PRIV-4): where the person came to the posting from ──
/** Query parameters that say how the person arrived at a posting: a job board's or a campaign's tag, which is the very
 *  fact FIXPLAN §0 protects as the owner's answer to ADP's "How did you learn about this position?". A per-visit value:
 *  it becomes REDACTED in every address the converter writes (the header's source, the route map, the frames' src) and
 *  in every link and text of the page (redactReferralParams), on every platform. iCIMS's iis and iisn (snapshot6 icims1:
 *  careers-sentinel's posting, its frame, links and route map), ADP's source (snapshot6 adp1 and adp2: every address of
 *  the application), and for the same reason Workday's source, Jobvite's __jvst and __jvsd, Greenhouse's gh_src and
 *  Lever's lever-source; every REFERRAL_PREFIXES parameter too. Simplify's utm_source=Simplify stays INJECTED_PARAMS'
 *  (dropped whole). jr7 TOOLING-7 (SP\jr6\build\INT-2.md §5, the leftover BUILD7 hands TOOLING-7): and Jobvite's third
 *  source tag, __jvsc (the channel), beside __jvst and __jvsd: in a person's address it says how they came; on a
 *  posting's own share buttons it names the network (judged public in the three committed fixtures converted before it,
 *  which the referral sweeps read by name and value: test/mhtml-to-fixture.test.ts JOBVITE_SHARE_CHANNELS).
 *  @type {string[]} */
export const REFERRAL_PARAMS = ['iis', 'iisn', 'source', '__jvst', '__jvsd', 'gh_src', 'lever-source',
  // jr7 TOOLING-7
  '__jvsc'];
/** The prefixes of referral parameters: every utm_* (utm_source, utm_medium, utm_campaign, utm_term, utm_content...;
 *  careers-sentinel's address and frame, a company's own links). */
export const REFERRAL_PREFIXES = ['utm_'];
/** The pattern source (flags gi) of a referral parameter's value wherever an address holds one: its separator before
 *  (?, &, &amp;, or percent-encoded once or twice inside another address), its name and = (or %3D, %253D) in group 1,
 *  kept; its value up to the next separator, plain or percent-encoded (an INJECTED_PARAMS value is left for
 *  stripInjectedParams, which drops it whole). */
// jr6 PRIVACY-FIX: "&amp;amp;" too, an address escaped twice (Jobvite's LinkedIn share widget writes the page's own
// address into data-lnkd-debug with its "&amp;" escaped again: jobvite/ninjaone-posting's __jvsd).
export const REFERRAL_SOURCE = `((?:\\?|&amp;amp;|&amp;|&|%3F|%26|%253F|%2526)(?:${[...REFERRAL_PARAMS.map(escapeSource),
  ...REFERRAL_PREFIXES.map((prefix) => `${escapeSource(prefix)}[A-Za-z0-9_]+`)].join('|')})(?:=|%3D|%253D))`
  + `(?!(?:${INJECTED_PARAMS.flatMap((entry) => (entry.includes('=') ? [escapeSource(entry.split('=')[1] ?? '')] : []))
    .join('|')})(?![\\w-]))(?:(?!%26|%23|%2526|%2523)[^&#"'\\s<>])*`;

/**
 * jr6 fixes (PRIV-4): a text (an address, an attribute, a frame's whole serialized HTML) with each referral parameter's
 * value REDACTED (REFERRAL_SOURCE); the values replaced go into `values` (kept in memory so the suspicious-token list
 * leaves them out; never printed or written). Answers the text and how many it replaced.
 * @param {string} text @param {string[]} [values] @returns {{ text: string; count: number }}
 */
export function redactReferralParams(text, values = []) {
  let count = 0;
  const out = text.replace(new RegExp(REFERRAL_SOURCE, 'gi'), (whole, key) => {
    const value = whole.slice(key.length);
    if (value === REDACTED || value === '') return whole;
    values.push(value);
    count += 1;
    return `${key}${REDACTED}`;
  });
  return { text: out, count };
}
// ── end jr6 fixes (PRIV-4) ──

/** An address with the INJECTED_PARAMS dropped from its query (stripInjectedParams), the PER_LOAD_PARAMS' values and
 *  its sign-in tokens REDACTED (redactSignInTokens; a relative address too), the rest as written. jr6 fixes (PRIV-4):
 *  and its referral parameters' values (redactReferralParams), so the header, the route map and the frames' src agree.
 *  @param {string} url */
export function withoutInjectedParams(url) {
  return redactReferralParams(redactSignInTokens(stripInjectedParams(url).text
    .replace(new RegExp(PER_LOAD_SOURCE, 'g'), `$1${REDACTED}`))).text;
}

/** Sign-in tokens an address carries, which no other check reads, being base64: an OpenID Connect id_token, a JWT whose
 *  claims hold the account's name, email and ids (the new ATSs, builder A: UltiPro's hidden iframe#rp,
 *  RelyingPartyIframe?id_token=<JWT>, ultipro-0 and -1), and the one-time sign-in code= of an OpenID silent-callback
 *  page (UltiPro's silent-callback.html?code=, the same captures); another code= is the page's own. One rule for every
 *  platform (redactSignInTokens): each value becomes REDACTED wherever it stands, plain, after an &amp; entity or
 *  percent-encoded once or twice, in each frame's written text, its frames' addresses, the header and the route map,
 *  and the conversion refuses a file that still holds one. Group 1 is what stands before the value, group 2 the value. */
export const SIGN_IN_TOKEN_SOURCES = [
  '((?:[?&;#]|%3F|%26|%23|%253F|%2526|%2523)id_token(?:=|%3D|%253D))([A-Za-z0-9_.-]+)',
  '(silent-callback\\.html(?:\\?|%3F|%253F)code(?:=|%3D|%253D))([A-Za-z0-9_-]+)',
];

/** A text (an address, or a frame's whole written HTML) with its sign-in tokens REDACTED (SIGN_IN_TOKEN_SOURCES), on
 *  every platform; the values replaced go into `ids` (kept in memory so the suspicious-token list leaves them out; never
 *  printed or written). @param {string} text @param {string[]} [ids] */
export function redactSignInTokens(text, ids = []) {
  return SIGN_IN_TOKEN_SOURCES.reduce((out, source) => out.replace(new RegExp(source, 'gi'), (whole, key, value) => {
    if (value === REDACTED) return whole;
    ids.push(value);
    return `${key}${REDACTED}`;
  }), text);
}

/** Images larger than this become a same-size placeholder: the box is what visibility needs, not the pixels. */
export const IMAGE_INLINE_MAX = 100 * 1024;

/** What every redacted value, hidden-input value, widget text, email and phone number becomes. */
export const REDACTED = 'REDACTED';

/** The viewport both renderings use, the DOM tests' own. */
const VIEWPORT = { width: 1280, height: 900 };

/** An email address; image names such as logo@2x.png are filtered out after matching. */
export const EMAIL_SOURCE =
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\\.[A-Za-z]{2,24}(?![A-Za-z0-9-])';
/**
 * A phone number written with a + or with separators: "+1 (555) 123-4567", "555.123.4567", "+15551234567". A bare
 * run of digits is an id far more often than a phone number, so it is left alone; the redact file catches the owner's
 * own number in any spelling. Digit counts are checked after matching (PHONE_DIGITS).
 */
export const PHONE_SOURCE =
  '(?<![\\w+/.-])(?:\\+\\d{8,15}|(?:\\+\\d{1,3}[ .-]?)?(?:\\(\\d{1,4}\\)[ .-]?)?\\d{1,4}(?:[ .-]\\d{1,4}){1,5})(?![\\w:/-])';
/** How many digits a phone-number match must hold: at least 10, or 8 after a +. */
export const PHONE_DIGITS = { min: 10, minWithPlus: 8, max: 15 };
/** The only attributes searched for phone numbers: the ones that carry words, not geometry, styles or ids. */
export const PHONE_ATTRIBUTES = ['value', 'placeholder', 'title', 'alt', 'aria-label', 'aria-description',
  'aria-placeholder', 'aria-valuetext', 'aria-roledescription', 'content', 'label'];
/** File extensions an email-looking match may end in when it is really an image name (logo@2x.png). */
export const NOT_EMAIL_SOURCE = '\\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js)$';

/** A form render id of Ashby's: a UUID new on every load, before "_<path>" in each data-field-entry-id. */
const ASHBY_RENDER_ID = /\bdata-field-entry-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/g;

/** The fixed id Ashby's `index`-th form render id (0-based, in the order the page first names it) becomes.
 *  @param {number} index */
export const ashbyRenderId = (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

/**
 * Ashby's per-load ids, normalised in a converted frame's HTML (see the header): every render id a data-field-entry-id
 * names is replaced wherever it stands (the radios' and checkboxes' id, name and for embed it), and the CSP nonce's
 * content becomes REDACTED. Answers the text, the ids replaced (never their values) and the nonces redacted.
 * @param {string} html @returns {{ text: string; renderIds: string[]; nonces: number }}
 */
export function normaliseAshby(html) {
  /** @type {string[]} */
  const renderIds = [];
  for (const match of html.matchAll(ASHBY_RENDER_ID)) {
    const id = match[1] ?? '';
    if (!renderIds.includes(id)) renderIds.push(id);
  }
  let text = html;
  renderIds.forEach((id, index) => {
    text = text.split(id).join(ashbyRenderId(index));
  });
  let nonces = 0;
  text = text.replace(/<meta\b[^>]*\bname="csp-nonce"[^>]*>/gi, (meta) => meta.replace(/\bcontent="[^"]*"/i, () => {
    nonces += 1;
    return `content="${REDACTED}"`;
  }));
  return { text, renderIds, nonces };
}

/** Where Workable's per-render ids stand (the capture of 2026-11-02, its snapshot-ids log): an element's own 16-character
 *  id, or one with Workable's prefix or suffix. Each names the id in its first group. */
const WORKABLE_IDS = [
  /\bid="([A-Za-z0-9]{16})"/g,
  /\bid="(?:wrapper|radio_label|checkbox_label|svg|input|input_files_input|description_input)_([A-Za-z0-9]{16})"/g,
  /\bid="([A-Za-z0-9]{16})_(?:label|dropdown|\d+)"/g,
];

/** The fixed id Workable's `index`-th per-render id (0-based, in the order the page first names it) becomes: 16
 *  characters, as Workable's own are. @param {number} index */
export const workableRenderId = (index) => `wk${String(index + 1).padStart(14, '0')}`;

/**
 * Workable's per-render ids, normalised in a converted frame's HTML (see the header): every id one of WORKABLE_IDS
 * names is replaced wherever it stands (the aria-labelledby, aria-describedby, aria-controls, for and
 * aria-activedescendant references that name it embed it). Answers the text and the ids replaced (never their values).
 * @param {string} html @returns {{ text: string; renderIds: string[] }}
 */
export function normaliseWorkable(html) {
  /** @type {Array<{ id: string; at: number }>} */
  const seen = [];
  for (const pattern of WORKABLE_IDS) {
    for (const match of html.matchAll(pattern)) seen.push({ id: match[1] ?? '', at: match.index ?? 0 });
  }
  /** @type {string[]} */
  const renderIds = [];
  for (const { id } of seen.sort((a, b) => a.at - b.at)) {
    // Only an id with a digit or both cases: a 16-letter word ("characteristics") is no render id.
    if (id === '' || renderIds.includes(id) || !/\d|[a-z].*[A-Z]|[A-Z].*[a-z]/.test(id)) continue;
    renderIds.push(id);
  }
  let text = html;
  renderIds.forEach((id, index) => {
    text = text.split(id).join(workableRenderId(index));
  });
  return { text, renderIds };
}

/**
 * hCaptcha's site key in its frames' addresses (sitekey=), and each widget's id, wherever it stands: in its
 * data-hcaptcha-widget-id and as the id= of its frames' hcaptcha.com addresses (the v3 Phase 6/7b review, S9: iCIMS and
 * Oracle, normaliseTokens; jr7 TOOLING-7, PC7-08's markers: Paycom's contact dialog, normaliseNewAts). Each value
 * becomes REDACTED and goes into `ids` (never printed). @param {string} html @param {string[]} ids @returns {string}
 */
function redactHcaptchaIn(html, ids) {
  let text = html.replace(/[?&#;]sitekey=([^&"'\s<#]+)/g, (whole, value) => {
    if (value === REDACTED) return whole;
    ids.push(value);
    return whole.replace(value, REDACTED);
  });
  /** @type {Set<string>} */
  const widgets = new Set();
  for (const match of text.matchAll(/\bdata-hcaptcha-widget-id="([^"]+)"/g)) widgets.add(match[1] ?? '');
  for (const match of text.matchAll(/hcaptcha\.com\/[^"'\s<]*?[#&;]id=([A-Za-z0-9_-]+)/g)) widgets.add(match[1] ?? '');
  for (const id of widgets) {
    if (id === '' || id === REDACTED) continue;
    ids.push(id);
    text = text.split(id).join(REDACTED);
  }
  return text;
}

/**
 * The per-load values of the v3 Phase 6 and 7b platforms (see the header), each kind of token replaced by a fixed one
 * wherever it stands: a numbered id becomes its kind's own numbering in the order the page first names it, an opaque
 * token becomes REDACTED. Answers the text and the values replaced (never their values). Other platforms: unchanged.
 * @param {string} platform @param {string} html @returns {{ text: string; renderIds: string[] }}
 */
export function normaliseTokens(platform, html) {
  /** @type {string[]} */
  const renderIds = [];
  let text = html;
  /** Renumbers `pattern`'s numbered ids (its first group the prefix, its second the number) in first-seen order, each
   *  prefix counted on its own. @param {RegExp} pattern @param {(prefix: string, index: number) => string} fixed */
  const renumber = (pattern, fixed) => {
    /** @type {Map<string, string>} */
    const seen = new Map();
    /** @type {Map<string, number>} */
    const counts = new Map();
    text = text.replace(pattern, (whole, prefix) => {
      if (!seen.has(whole)) {
        const index = counts.get(prefix) ?? 0;
        counts.set(prefix, index + 1);
        seen.set(whole, fixed(prefix, index));
        renderIds.push(whole);
      }
      return seen.get(whole) ?? whole;
    });
  };
  /** Replaces each value of `pattern`'s first group with REDACTED. @param {RegExp} pattern */
  const redactValue = (pattern) => {
    text = text.replace(pattern, (whole, value) => {
      if (value === REDACTED) return whole;
      renderIds.push(value);
      return whole.replace(value, REDACTED);
    });
  };
  /** hCaptcha's site key in its frames' addresses and each widget's id (redactHcaptchaIn). */
  const redactCaptcha = () => {
    text = redactHcaptchaIn(text, renderIds);
  };
  if (platform === 'workday') {
    renumber(/\b(input)-(\d+)\b/g, (prefix, index) => `${prefix}-${index + 1}`);
    renumber(/()\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (_prefix, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    // (Jobright's jr_id, which Workday's links repeat, goes by the one rule every platform runs: stripInjectedParams.)
  } else if (platform === 'icims') {
    redactValue(/\bdata-sitekey="([^"]+)"/g);
    redactValue(/\bhashed=(-?\d+)/g);
    redactValue(/\bstate=([^&"'\s<]+)/g);
    redactCaptcha();
    // --- iCIMS, the owner's snapshots of 2026-11-06 (signed in, the pages after the gate) ---------------------------
    // The addresses' per-person and per-load values: the profile's link from the email (eem=, an encrypted email, and
    // code=), each step's csrf=, an IForm frame's token=, user= (the person's id), item=, aid= and applicationStartId=,
    // and the analytics ids a portal's links carry (_ga=, ga=, _gl=, _sp=, _jsqid=); each select's hash="..." and the
    // hCaptcha response a frame holds (data-hcaptcha-response).
    // jr6 (ICIMS-28, adopted from the iCIMS audit's change in wt-s2cwd): careers-ars's profile link from the phone gate
    // also carries pnumber= and ccode= (snapshot6 icims2: the gate's phone and its country code, encrypted).
    redactValue(/\b(?:csrf|eem|code|token|user|item|aid|applicationStartId|pnumber|ccode)=([^&"'\s<]+)/g);
    redactValue(/\b(?:_ga|ga|_gl|_sp|_jsqid)=([^&"'\s<]+)/g);
    redactValue(/\bhash="([^"]+)"/g);
    redactValue(/\bdata-hcaptcha-response="([^"]+)"/g);
    // (Jobright's jr_id, wherever a page copied it into an address, goes by the one rule every platform runs:
    // stripInjectedParams.)
    // --- end iCIMS --------------------------------------------------------------------------------------------------
  } else if (platform === 'successfactors') {
    redactValue(/\b_s\.crb=([^&"'\s<]+)/g);
    redactValue(/\brequestParams=([^&"'\s<]+)/g);
    redactValue(/\bjobSecKey(?:'|&quot;|"|%27)?\s*[:=]\s*(?:'|&quot;|"|%27)?([A-Za-z0-9%+/=_-]{8,})/g);
  } else if (platform === 'oracle') {
    redactValue(/\bdata-sitekey="([^"]+)"/g);
    redactCaptcha();
    renumber(/\b(primary-email|honey-pot)-(\d+)\b/g, (prefix, index) => `${prefix}-${index}`);
  }
  return { text, renderIds };
}

// --- iCIMS, the owner's snapshots of 2026-11-06 ----------------------------------------------------------------------
/**
 * What a signed-in iCIMS page shows of the person beyond its typed values, redacted in the page (run after
 * transformInPage, before serialisation, on iCIMS frames only): the header's name (.iCIMS_userMenuName, beside
 * "Dashboard | Logout"); a file field's current file name (.iCIMS_CurrentFile's span: the resume's, the cover
 * letter's); and iCIMS's own dropdowns (a select marked icimsdropdown-enabled="1", drawn as a.dropdown-select with its
 * list ul.dropdown-results): the select holds only the option the person chose (its list loads from the server:
 * icimsdropdown-ajax="1"), so its options' text and values become REDACTED; its anchor's aria-activedescendant names the
 * chosen result; a result's aria-selected and its result-focus or result-selected class mark it; and a list that is
 * searched (icimsdropdown-search="1") shows what the person's search found, so its results' text, title and aria-label
 * become REDACTED. Elements stay (visibility is compared after); only text and attributes change. Counts only.
 * @param {string} redacted @returns {{ names: number; files: number; options: number; choices: number; results: number }}
 */
export function icimsRedactInPage(redacted) {
  const doc = globalThis.document;
  const counts = { names: 0, files: 0, options: 0, choices: 0, results: 0 };
  /** Its text nodes' words become one REDACTED, every element inside kept (the visibility check counts them). jr7
   *  TOOLING-7 (ICIMS7-15): with `each`, every text run keeps a REDACTED of its own (the white space around it kept), so
   *  no element that held words loses its box: a searched list's result bolds the typed query in a <b> of its own
   *  (snapshot7 iCIMS1's profile saves (4) and (5), an open School search), which an emptied run collapsed, and the
   *  visibility check refused the page. @param {Element} el @param {boolean} [each] */
  const blank = (el, each = false) => {
    if ((el.textContent ?? '').trim() === '' || (el.textContent ?? '').trim() === redacted) return false;
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    let first = true;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      if (text.trim() === '') continue;
      node.nodeValue = each ? text.replace(/\S(?:[\s\S]*\S)?/, redacted) : first ? redacted : '';
      first = false;
    }
    return true;
  };
  for (const name of doc.querySelectorAll('.iCIMS_userMenuName')) if (blank(name)) counts.names += 1;
  for (const file of doc.querySelectorAll('.iCIMS_CurrentFile > span')) if (blank(file)) counts.files += 1;
  // A dropdown's trigger shows the chosen value (a.dropdown-select > span.dropdown-text, its fakeSelected span), with or
  // without the role the converter's widget rule reads.
  for (const shownValue of doc.querySelectorAll('.dropdown-select .dropdown-text')) if (blank(shownValue)) counts.choices += 1;
  // Every select's icimsdropdown-selected names the option chosen (a native one's too: icimsdropdown-enabled="0",
  // careers-githubinc's Job Specific Questions held an answer there), and its aria-activedescendant the result.
  for (const select of doc.querySelectorAll('select[icimsdropdown-selected], select[aria-activedescendant]')) {
    for (const attribute of ['icimsdropdown-selected', 'aria-activedescendant']) {
      if ((select.getAttribute(attribute) ?? '') === '') continue;
      select.setAttribute(attribute, redacted);
      counts.choices += 1;
    }
  }
  for (const select of doc.querySelectorAll('select[icimsdropdown-enabled="1"]')) {
    for (const option of select.querySelectorAll('option')) {
      if (blank(option)) counts.options += 1;
      if (option.hasAttribute('value')) option.setAttribute('value', redacted);
      if (option.hasAttribute('label')) option.setAttribute('label', redacted);
    }
    const id = select.id;
    const anchor = id === '' ? null : doc.getElementById(`${id}_icimsDropdown`);
    if (anchor !== null && anchor.hasAttribute('aria-activedescendant')) {
      anchor.setAttribute('aria-activedescendant', redacted);
      counts.choices += 1;
    }
    const list = id === '' ? null : doc.getElementById(`${id}_dropdown-results`);
    if (list === null) continue;
    const searched = select.getAttribute('icimsdropdown-search') === '1';
    for (const result of list.querySelectorAll('li')) {
      if (result.hasAttribute('aria-selected') || result.classList.contains('result-focus')
        || result.classList.contains('result-selected')) {
        result.removeAttribute('aria-selected');
        result.classList.remove('result-focus', 'result-selected');
        counts.choices += 1;
      }
      if (!searched) continue;
      // jr7 TOOLING-7 (ICIMS7-15): each run of a result keeps a REDACTED, so a bolded query's box stays.
      if (blank(result, true)) counts.results += 1;
      for (const attribute of ['title', 'aria-label']) {
        if (result.hasAttribute(attribute)) result.setAttribute(attribute, redacted);
      }
    }
  }
  return counts;
}
// --- end iCIMS -------------------------------------------------------------------------------------------------------

// ── New ATSs (DESIGN-NEW-ATS §6.6, Phase 0) ──
/** Renumbers `pattern`'s matches in `text` in first-seen order (its first group the prefix, each prefix counted on its
 *  own), each replaced by `fixed(prefix, index)`; the values replaced go into `ids`.
 *  @param {string} text @param {RegExp} pattern @param {(prefix: string, index: number) => string} fixed
 *  @param {string[]} ids */
function renumberIn(text, pattern, fixed, ids) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  /** @type {Map<string, number>} */
  const counts = new Map();
  return text.replace(pattern, (whole, prefix) => {
    if (!seen.has(whole)) {
      const index = counts.get(prefix) ?? 0;
      counts.set(prefix, index + 1);
      seen.set(whole, fixed(prefix, index));
      ids.push(whole);
    }
    return seen.get(whole) ?? whole;
  });
}

/** `index + 1`, padded with zeros to `width`. @param {number} index @param {number} width */
const pad = (index, width) => String(index + 1).padStart(width, '0');

/**
 * The new ATSs' per-load values (§6.6), each from a two-load comparison of the owner's snapshots, made fixed: every new
 * platform's reCAPTCHA frame names (a-<12>, c-<12>: jazzhr-0 vs -1; bamboohr-0 vs -2), BambooHR's FabricTextField-<n>
 * and fab-select<n> (bamboohr-0 vs -2), Rippling's per-load input names (rippling-0 vs -1), ADP's MDFContentPane-,
 * react-select-instance-, emptyFocusDivId- and MDFSimpleHelpIcon-<uuid>, checkbox_<21> and sdf-radio-group-<n>
 * (adp-4 vs -5, adp-6 vs -0; builder A: adp-1's nanoid), UltiPro's ukg-<part>-id-<22>, FileUpload_<10>, cf-chl-widget-<5>
 * (ultipro-0 vs -1) and its name inputs' autocomplete GUIDs, Dayforce's header-menu ids (dayforce-0 to -2),
 * Dice's react-aria<10 digits>, _R_<x>_ and batBeacon<12> (dice-*), ClearCompany's subscriberid views and form<n> names
 * (clearcompany-*) and the LinkedIn frame's xdChannel (REDACTED, also in addresses: redactNewAtsAddress). Another
 * platform's page is unchanged. Answers the text and the values replaced (never printed).
 * @param {string} platform @param {string} html @returns {{ text: string; renderIds: string[] }}
 */
export function normaliseNewAts(platform, html) {
  /** @type {string[]} */
  const renderIds = [];
  if (!NEW_ATS_PLATFORMS.includes(platform)) return { text: html, renderIds };
  let text = redactNewAtsAddress(platform, html, renderIds);
  text = renumberIn(text, /\bname="([ac])-[a-z0-9]{12}"/g, (prefix, index) => `name="${prefix}-${pad(index, 12)}"`, renderIds);
  if (platform === 'bamboohr') {
    text = renumberIn(text, /\b(FabricTextField-)\d+\b/g, (prefix, index) => `${prefix}${index + 1}`, renderIds);
    text = renumberIn(text, /\b(fab-select)\d+\b/g, (prefix, index) => `${prefix}${index + 1}`, renderIds);
  } else if (platform === 'rippling') {
    // Each text and combobox input's name, drawn afresh on every load (rippling-0 vs -1: name="<9 or 10 characters>"
    // with a digit or both cases); a word like sms_opt_in stays.
    text = text.replace(/(<(?:input|select|textarea)\b[^>]*?\sname=")([A-Za-z0-9_-]{9,10})(")/g, (whole, before, name, after) => {
      if (!/\d|[a-z].*[A-Z]|[A-Z].*[a-z]/.test(name)) return whole;
      renderIds.push(name);
      return `${before}${REDACTED}${after}`;
    });
  } else if (platform === 'adp') {
    text = renumberIn(text, /\b(MDFContentPane-|react-select-instance-|emptyFocusDivId-|MDFSimpleHelpIcon-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
      (prefix, index) => `${prefix}00000000-0000-4000-8000-${pad(index, 12)}`, renderIds);
    // checkbox_<21>: a nanoid, whose alphabet holds '-' and '_' too (builder A: adp-1's preferred-name box).
    text = renumberIn(text, /\b(checkbox_)[A-Za-z0-9_-]{21}(?![A-Za-z0-9_-])/g, (prefix, index) => `${prefix}${pad(index, 21)}`,
      renderIds);
    text = renumberIn(text, /\b(sdf-radio-group-)\d+\b/g, (prefix, index) => `${prefix}${index + 1}`, renderIds);
  } else if (platform === 'ultipro') {
    // The signed-in candidate's account id in the documents panel's Knockout params (ultipro-1: currentUserId).
    text = text.replace(/\b(currentUserId:\s*(?:&quot;|"))([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g,
      (_whole, key, value) => {
        renderIds.push(value);
        return `${key}${REDACTED}`;
      });
    text = renumberIn(text, /\b(ukg-[a-z0-9-]+?-id-)[A-Za-z0-9]{9}\d{13}\b/g, (prefix, index) => `${prefix}${pad(index, 22)}`,
      renderIds);
    text = renumberIn(text, /\b(FileUpload_)[A-Za-z0-9]{10}\b/g, (prefix, index) => `${prefix}${pad(index, 10)}`, renderIds);
    text = renumberIn(text, /\b(cf-chl-widget-)[a-z0-9]{5}\b/g, (prefix, index) => `${prefix}${pad(index, 5)}`, renderIds);
    // Builder A: autocomplete="<uuid>-ukg-no-autocomplete-<token>" on the name inputs (ultipro-0, -1: a GUID whose source
    // no snapshot tells, the account's or the load's).
    text = renumberIn(text, /\b()[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=-ukg-no-autocomplete-)/g,
      (_prefix, index) => `00000000-0000-4000-8000-${pad(index, 12)}`, renderIds);
  } else if (platform === 'dayforce') {
    // Builder A: the header menu's data-menu-id="rc-menu-uuid-<n>-<n>-<item>" (a session counter, the same in dayforce-0
    // to -2).
    text = renumberIn(text, /\b(rc-menu-uuid-)\d+-\d+(?=-)/g, (prefix) => `${prefix}00000-0`, renderIds);
  } else if (platform === 'dice') {
    text = renumberIn(text, /\b(react-aria)\d{10}(?=-)/g, (prefix, index) => `${prefix}${pad(index, 10)}`, renderIds);
    text = renumberIn(text, /(?<![\w-])(_R_)[A-Za-z0-9]+_/g, (prefix, index) => `${prefix}${index + 1}_`, renderIds);
    text = renumberIn(text, /\b(batBeacon)\d{12}\b/g, (prefix, index) => `${prefix}${pad(index, 12)}`, renderIds);
  } else if (platform === 'clearcompany') {
    // Core pass Z1, item 35: Backbone's view names are camelCase too (clearcompany-*: formFieldView-view<N>,
    // formSectionView-view<N>, appView-view<N>), so the name takes either case.
    text = renumberIn(text, /\b(subscriberid="[A-Za-z-]+-view)\d+"/g, (prefix, index) => `${prefix}${index + 1}"`, renderIds);
    text = renumberIn(text, /\b(name="form)\d+"/g, (prefix, index) => `${prefix}${index + 1}"`, renderIds);
  } else if (platform === 'paycom') {
    // jr7 TOOLING-7 (T7-01, PC7-08's markers; snapshot7 paycomonline1's contact dialog): its invisible hCaptcha, as iCIMS's
    // and Oracle's are (normaliseTokens): the widget's site key, its id wherever it stands, and a response it holds.
    for (const pattern of [/\bdata-sitekey="([^"]+)"/g, /\bdata-hcaptcha-response="([^"]+)"/g]) {
      text = text.replace(pattern, (whole, value) => {
        if (value === REDACTED) return whole;
        renderIds.push(value);
        return whole.replace(value, REDACTED);
      });
    }
    text = redactHcaptchaIn(text, renderIds);
  }
  return { text, renderIds };
}

/** A session's secrets a Rails page writes in its head (builder C: Pinpoint's, pinpoint-0 to -2, and CareerPlug's,
 *  careerplug-0, -1): the csrf-token and csp-nonce metas' content. */
const SESSION_METAS = /(<meta\b[^>]*?\bname="(?:csrf-token|csp-nonce)"[^>]*?\bcontent=")([^"]+)(")/g;

/** The new ATSs' per-session values that also stand in addresses, by platform, each REDACTED wherever it stands (so a
 *  page, the header's source and the frame address its route map serves stay alike; redactNewAtsAddress). Group 1 is
 *  what stands before the value, group 2 the value, group 3 what follows it (empty where nothing does). (UltiPro's
 *  sign-in tokens are every platform's rule, redactSignInTokens; Dayforce's reCAPTCHA bft= is a PER_LOAD_PARAMS one.)
 *  @type {Record<string, RegExp[]>} */
const NEW_ATS_ADDRESS_VALUES = {
  // ClearCompany's LinkedIn frame's xdChannel (clearcompany-*).
  clearcompany: [/(\bxdChannel(?:=|%3D|&quot;:&quot;|":"))([A-Za-z0-9_-]+)()/g],
  // Builder C: Pinpoint's session metas; the token of its confirmation address (/applications/thanks?token=<24>,
  // pinpoint-2, also in its og:url), which names the applicant's own application; its per-render link keys: the "Apply
  // with LinkedIn" link's cache_key (pinpoint-0) and the og:image's presigned X-Amz-Credential and X-Amz-Signature
  // (pinpoint-0 to -2).
  pinpoint: [SESSION_METAS, /(\/applications\/thanks\?(?:[^"'\s<>#]*?(?:&amp;|&))?token=|[?&;]cache_key=|\bX-Amz-(?:Credential|Signature)=)([A-Za-z0-9_%-]+)()/g],
  // Builder C: CareerPlug's session metas.
  careerplug: [SESSION_METAS],
  // jr7 TOOLING-7 (JDEF-16; snapshot7 twillio, twilio.eightfold.ai): Eightfold's per-session CSRF token in its head,
  // <meta name="_csrf" content="<token>"> (its _csrf_header names the header and stays).
  eightfold: [/(<meta\b[^>]*?\bname="_csrf"[^>]*?\bcontent=")([^"]+)(")/g],
};

/** The new ATSs' per-session values (NEW_ATS_ADDRESS_VALUES) REDACTED in a page or an address; the values replaced go
 *  into `ids`. Another platform's text is unchanged. @param {string} platform @param {string} text @param {string[]} [ids] */
export function redactNewAtsAddress(platform, text, ids = []) {
  return (NEW_ATS_ADDRESS_VALUES[platform] ?? []).reduce((out, pattern) => out.replace(pattern,
    (whole, before, value, after) => {
      if (value === REDACTED) return whole;
      ids.push(value);
      return `${before}${REDACTED}${after}`;
    }), text);
}
// ── end New ATSs ──

/** @param {string} message @returns {never} */
function fail(message) {
  throw new ConversionError([message]);
}

/** Why a capture was not converted: each reason names a check, never a value. */
export class ConversionError extends Error {
  /** @param {string[]} reasons */
  constructor(reasons) {
    super(reasons.join('\n'));
    this.name = 'ConversionError';
    this.reasons = reasons;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The capture's MIME parts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ contentType: string; charset: string | null; contentId: string | null; location: string | null;
 *   body: Buffer }} MimePart
 * @typedef {{ snapshotUrl: string | null; date: string | null; parts: MimePart[] }} Mhtml
 */

/** A MIME header block, folded lines joined, names in lower case. @param {string} block */
function readHeaders(block) {
  /** @type {Map<string, string>} */
  const headers = new Map();
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/** A header parameter such as boundary="…" or charset=utf-8. @param {string} header @param {string} name */
function headerParam(header, name) {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** Quoted-printable text (a latin1 string, one character per byte) to bytes. @param {string} text */
function decodeQuotedPrintable(text) {
  const joined = text.replace(/=\r?\n/g, '');
  return Buffer.from(joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
}

/**
 * Reads an MHTML archive into its parts: each one's type, Content-ID, Content-Location and decoded bytes.
 * @param {Buffer} bytes @returns {Mhtml}
 */
export function parseMhtml(bytes) {
  const text = bytes.toString('latin1');
  const headerEnd = text.search(/\r?\n\r?\n/);
  if (headerEnd < 0) fail('not an MHTML file: no header block');
  const top = readHeaders(text.slice(0, headerEnd));
  const type = top.get('content-type') ?? '';
  const boundary = headerParam(type, 'boundary');
  if (!/^multipart\/related/i.test(type) || !boundary) fail('not an MHTML file: no multipart/related boundary');
  /** @type {MimePart[]} */
  const parts = [];
  const chunks = text.slice(headerEnd).split(`--${boundary}`);
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith('--')) break;
    const body = chunk.replace(/^\r?\n/, '');
    const end = body.search(/\r?\n\r?\n/);
    if (end < 0) continue;
    const headers = readHeaders(body.slice(0, end));
    const raw = body.slice(end).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '');
    const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
    const decoded = encoding === 'quoted-printable' ? decodeQuotedPrintable(raw)
      : encoding === 'base64' ? Buffer.from(raw.replace(/\s+/g, ''), 'base64')
        : Buffer.from(raw, 'latin1');
    const partType = headers.get('content-type') ?? '';
    const id = headers.get('content-id') ?? null;
    parts.push({
      contentType: (partType.split(';')[0] ?? '').trim().toLowerCase(),
      charset: headerParam(partType, 'charset'),
      contentId: id ? `cid:${id.replace(/^<|>$/g, '')}` : null,
      location: headers.get('content-location') ?? null,
      body: decoded,
    });
  }
  if (parts.length === 0) fail('the MHTML file holds no parts');
  return { snapshotUrl: top.get('snapshot-content-location') ?? null, date: top.get('date') ?? null, parts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resources: stylesheet text and images, keyed by every address a page may use for them
// ---------------------------------------------------------------------------------------------------------------------

/** The image type from its first bytes, else null. @param {Buffer} bytes */
function sniffImageType(bytes) {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 512)).trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/**
 * An image's pixel size from its header (PNG, GIF, JPEG, WebP), else null.
 * @param {Buffer} bytes @returns {{ width: number; height: number } | null}
 */
export function imageSize(bytes) {
  const type = sniffImageType(bytes);
  if (type === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (type === 'image/jpeg') {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      const length = bytes.readUInt16BE(at + 2);
      // Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** A grey SVG with the image's own size, so layout and visibility stay as they were. @param {{ width: number; height: number }} size */
function placeholderImage({ width, height }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#d0d0d0"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** A stylesheet part as text, in the charset its @charset rule or Content-Type names, with LF line ends (the archive's
 *  CRLF would otherwise reach the fixture, which git stores with LF). @param {MimePart} part */
function cssText(part) {
  const declared = /^@charset\s+"([^"]+)"/i.exec(part.body.toString('latin1', 0, 64))?.[1] ?? part.charset ?? 'utf-8';
  let text;
  try {
    text = new TextDecoder(declared).decode(part.body);
  } catch {
    text = new TextDecoder('utf-8').decode(part.body);
  }
  return text.replace(/\r\n?/g, '\n');
}

/**
 * @typedef {{ css?: { text: string; base: string }; dataUri?: string; placeholder?: boolean }} Resource
 */

/**
 * Every stylesheet and image in the archive, under its Content-Location and its cid: address.
 * @param {Mhtml} mhtml @returns {Record<string, Resource>}
 */
function resourcesOf(mhtml) {
  /** @type {Record<string, Resource>} */
  const resources = {};
  for (const part of mhtml.parts) {
    /** @type {Resource | null} */
    let resource = null;
    const base = part.location ?? part.contentId ?? '';
    if (part.contentType === 'text/css') {
      resource = { css: { text: cssText(part), base } };
    } else if (part.contentType.startsWith('image/') || part.contentType === 'application/octet-stream') {
      const type = sniffImageType(part.body) ?? (part.contentType.startsWith('image/') ? part.contentType : null);
      if (type === null) continue;
      const size = part.body.length > IMAGE_INLINE_MAX ? imageSize(part.body) : null;
      resource = size
        ? { dataUri: placeholderImage(size), placeholder: true }
        : { dataUri: `data:${type};base64,${part.body.toString('base64')}`, placeholder: false };
    }
    if (resource === null) continue;
    for (const key of [part.location, part.contentId]) if (key && !(key in resources)) resources[key] = resource;
  }
  return resources;
}

// ---------------------------------------------------------------------------------------------------------------------
// Redaction patterns, built in Node and handed to the page as sources
// ---------------------------------------------------------------------------------------------------------------------

/** The redact file's strings: one per line, # comments and blank lines skipped. @param {string} text */
export function readRedactList(text) {
  const strings = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const [index, entry] of strings.entries()) {
    if (entry.length < 3) fail(`redact file: entry ${index + 1} is shorter than 3 characters, which would redact too much`);
  }
  return strings;
}

/** Escapes a string for use inside a RegExp. @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A letter or digit, Latin scripts included, as a class that needs no `u` flag (the patterns are built with 'gi'). */
const WORD_CHAR = '[A-Za-z0-9\\u00C0-\\u024F]';

/**
 * Each redact string as a case-insensitive pattern source. One that looks like a phone number (digits and phone
 * punctuation only, at least 7 digits) matches its digits with any punctuation between them. One that starts or ends
 * with a letter or digit matches only where no letter or digit adjoins it there (a whole word: a name "Ann" never
 * takes the "ann" of "Announcement"), so a short name or an employer's name redacts that name and not the page's words
 * around it; list a name's joined spellings ("JaneRoe", "Jane_Roe") as entries of their own.
 * @param {string[]} strings @returns {string[]}
 */
export function redactSources(strings) {
  return strings.map((entry) => {
    const digits = entry.replace(/\D/g, '');
    if (/^[\d\s().+-]+$/.test(entry) && digits.length >= 7) {
      return `(?<!\\d)${[...digits].join('[\\s().+-]*')}(?!\\d)`;
    }
    const before = new RegExp(`^${WORD_CHAR}`).test(entry) ? `(?<!${WORD_CHAR})` : '';
    const after = new RegExp(`${WORD_CHAR}$`).test(entry) ? `(?!${WORD_CHAR})` : '';
    return `${before}${escapeRegExp(entry)}${after}`;
  });
}

// ── jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b): a listed string respelled ──
/** A letter or digit as respelledSources reads one (WORD_CHAR's class, without its brackets). */
const RESPELL_CHAR = 'A-Za-z0-9\\u00C0-\\u024F';

/**
 * jr6 round 2: each redact string as it may stand respelled inside an attribute (an id or a value built from it): its
 * letter-and-digit runs in order, case-insensitive, with up to four separators (any other character, or a
 * percent-encoded one) between them or none: "Jane Roe" also matches "jane-roe", "JaneRoe", "jane_roe", "jane%20roe"
 * and "janeroe". A match counts only where it starts and ends at a word's edge (respelledEdge: an end of the text, a
 * separator, a lower-case letter followed by a capital, a letter beside a digit), so "JaneRoe" in "optionJaneRoe" counts
 * and "Roe" in "Roebuck" does not. A string that looks like a phone number is left to redactSources' own rule, which
 * matches its digits with any punctuation. Answers each string's position in the list (from 1) and its pattern source.
 * jr7 TOOLING-7 (UKGR-20): with `phones`, a string that looks like a phone number is read too, as redactSources reads
 * it (its digits in order, never inside a longer run of digits) with its punctuation also percent-encoded between them:
 * the addresses (respelledAddress) take it so, where the exact rule never runs (UKG Ready's 11-digit applicant session,
 * listed, in the header's source and the route map).
 * @param {string[]} strings @param {{ phones?: boolean }} [options] @returns {Array<{ index: number; source: string }>}
 */
export function respelledSources(strings, options = {}) {
  return strings.flatMap((entry, at) => {
    if (/^[\d\s().+-]+$/.test(entry) && entry.replace(/\D/g, '').length >= 7) {
      if (options.phones !== true) return [];
      return [{ index: at + 1, source: `(?<!\\d)${[...entry.replace(/\D/g, '')].join('(?:[\\s().+-]|%[0-9A-Fa-f]{2}){0,4}')}(?!\\d)` }];
    }
    const runs = entry.match(new RegExp(`[${RESPELL_CHAR}]+`, 'g')) ?? [];
    if (runs.join('').length < 3) return [];
    const separators = `(?:[^${RESPELL_CHAR}]|%[0-9A-Fa-f]{2}){0,4}`;
    return [{ index: at + 1, source: runs.map(escapeRegExp).join(separators) }];
  });
}

/** Whether `at` is a word's edge in `text` (respelledSources): an end of the text, a character that is no letter or
 *  digit on either side, a lower-case letter followed by a capital, or a letter beside a digit. @param {string} text
 *  @param {number} at */
export function respelledEdge(text, at) {
  if (at <= 0 || at >= text.length) return true;
  const before = text[at - 1] ?? '';
  const after = text[at] ?? '';
  const word = new RegExp(`^[${RESPELL_CHAR}]$`);
  if (!word.test(before) || !word.test(after)) return true;
  if (/\d/.test(before) !== /\d/.test(after)) return true;
  return before !== before.toUpperCase() && after !== after.toLowerCase();
}

/**
 * An address with each listed string respelled in its path, query or fragment made REDACTED (respelledSources; its
 * scheme and host kept, so it is still served at the same host): the page's and its frames' addresses, which the frames'
 * src, the route map and the header all take from here, so they still agree (an iCIMS IForm's address spells its
 * posting's title, which the list may hold). Anything that is no absolute address is answered as given.
 * @param {string} url @param {Array<{ index: number; source: string }>} sources
 */
export function respelledAddress(url, sources) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const origin = parsed.origin === 'null' ? '' : parsed.origin;
  if (origin === '' || !url.startsWith(origin)) return url;
  let rest = url.slice(origin.length);
  for (const { source } of sources) {
    for (const [start, end] of respelledSpans(rest, source).reverse()) rest = `${rest.slice(0, start)}${REDACTED}${rest.slice(end)}`;
  }
  return `${origin}${rest}`;
}

/** The spans of `text` a respelledSources pattern matches at words' edges. @param {string} text @param {string} source
 *  @returns {Array<[number, number]>} */
export function respelledSpans(text, source) {
  /** @type {Array<[number, number]>} */
  const spans = [];
  const pattern = new RegExp(source, 'gi');
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const end = match.index + match[0].length;
    if (match[0] !== '' && respelledEdge(text, match.index) && respelledEdge(text, end)) {
      spans.push([match.index, end]);
      pattern.lastIndex = end;
    } else {
      pattern.lastIndex = match.index + 1;
    }
  }
  return spans;
}
// ── end jr6 round 2 ──

// ---------------------------------------------------------------------------------------------------------------------
// Code that runs in the page. Each function is serialized by Playwright, so it may use nothing from this module: what
// it needs comes in through its one argument.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The snapshot build of 2026-11-06 (boards): takes out of the frame, before anything is measured, what is not the site's
 * page (INJECTED_UI), so the visibility check compares the site's own elements, on every platform:
 * - every element INJECTED_UI names (another extension's UI);
 * - where the platform does not keep shadow roots (`dropOverlays`; SHADOW_ROOT_PLATFORMS keep them all, written as
 *   declarative ones), a shadow host that is a child of <body> and whose open shadow tree holds no form control, form,
 *   frame or nested shadow root: an overlay a page or an extension draws over itself, whose shadow content the
 *   serializer would lose (an accessibility widget, [abclegal.com] ABC Legal - Job Openings.mht's four
 *   <access-widget-ui>; a cookie banner, [seatgeek.com] ...SeatGeek.mht's <aside class="dg-consent-banner">; a route
 *   announcer, [weka.io] ...WEKA.mht's <next-route-announcer>). Any other shadow root is still refused there;
 * - s2 wd, on every platform: a shadow host that is a child of <html> beside <head> and <body> (no page draws one
 *   there) whose shadow tree is closed (`closedMark`: markClosedShadowHosts's mark) or holds no form control: an
 *   extension's own UI, TailorIT's included (content/ui/shadow.ts mounts its closed root on <html>: snapshot5's
 *   [pureinsurance.wd5.myworkdayjobs.com] captures); and, where overlays go (`dropOverlays`), a closed shadow host on
 *   <body>, where the HTML parser puts what was drawn after it;
 * - the PER_LOAD_PARAMS' values (REDACTED) in every attribute that holds them (`perLoad`: PER_LOAD_SOURCE).
 * Another extension's parameters (INJECTED_PARAMS) go from the frame's written text by the one rule, stripInjectedParams.
 * Returns how many of each it took (never what they held).
 * @param {{ selectors: string[]; perLoad: string; dropOverlays: boolean; redacted: string; closedMark?: string }} input
 * @returns {{ injected: number; shadowOverlays: number; injectedParams: number }}
 */
export function stripInjectedInPage(input) {
  const doc = globalThis.document;
  const counts = { injected: 0, shadowOverlays: 0, injectedParams: 0 };
  for (const element of doc.querySelectorAll(input.selectors.join(', '))) {
    element.remove();
    counts.injected += 1;
  }
  // s2 wd: an extension's own UI host on <html>, beside <head> and <body> (see the header).
  for (const host of [...(doc.documentElement?.children ?? [])]) {
    if (host.localName === 'head' || host.localName === 'body') continue;
    const closed = input.closedMark !== undefined && host.hasAttribute(input.closedMark);
    const open = host.shadowRoot !== null
      && host.shadowRoot.querySelector('input, select, textarea, form, iframe, frame, object, embed') === null;
    if (!closed && !open) continue;
    host.remove();
    counts.shadowOverlays += 1;
  }
  for (const host of input.dropOverlays ? [...(doc.body?.children ?? [])] : []) {
    // s2 wd: a closed shadow host on <body> (markClosedShadowHosts's mark): no page code reads it, and no control of the
    // form is in it (the HTML parser puts what TailorIT draws after <body> into <body>: snapshot5).
    if (input.closedMark !== undefined && host.hasAttribute(input.closedMark)) {
      host.remove();
      counts.shadowOverlays += 1;
      continue;
    }
    const shadow = host.shadowRoot;
    if (!shadow || shadow.querySelector('input, select, textarea, form, iframe, frame, object, embed')
      || [...shadow.querySelectorAll('*')].some((element) => element.shadowRoot)) continue;
    host.remove();
    counts.shadowOverlays += 1;
  }
  const perLoad = new RegExp(input.perLoad, 'g');
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const text = attribute.value.replace(perLoad, `$1${input.redacted}`);
      if (text === attribute.value) continue;
      element.setAttribute(attribute.name, text);
      counts.injectedParams += 1;
    }
  }
  return counts;
}

/**
 * The snapshot build of 2026-11-06: the choices a page shows besides a control's own checked and selected state,
 * cleared on every platform before anything is measured, since a person's real answers are the applicant's data (the
 * owner's captures were taken filled in). The one generic pass for choice mirrors; a platform's own widgets add theirs
 * (PLATFORM_REDACTIONS: Workday's exclusive groups and open lists, iCIMS's dropdown results, Oracle's pills):
 * - aria-checked="true" and aria-pressed="true" become "false" (Workable's role=radio and role=checkbox, Ashby's Yes/No
 *   buttons, Workday's radios and boxes, SmartRecruiters' spl-radio and spl-checkbox inside their shadow roots), and
 *   data-checked="true" becomes "false" while a bare data-checked (Ashby's span beside a chosen radio or box) goes;
 * - a chosen value's flag (intl-tel-input's iti__<region> class inside a widget's chosen value: Greenhouse's phone
 *   country, [job-boards.greenhouse.io] ...at Axle (1).mht) loses its region;
 * - intl-tel-input's country button names the chosen country in its title and aria-label, beside its flag and dial code
 *   (Workable's phone, the Raydar and Salvo captures): they become REDACTED, the flag's region dropped;
 * - the marks `marks` names (CHOSEN_MARKS: the new ATSs' drawn controls and lists) lose their chosen classes (jr6,
 *   JV-10: or have them swapped for their unchosen twins), and an option's aria-selected="true" becomes "false" (s2 wd:
 *   and an aria-activedescendant naming that option goes);
 * - jr6 fixes (PRIV-2, REVC-4): the parts a widget draws on its chosen row alone (`drawings`: CHOSEN_DRAWINGS) go; and a
 *   widget's roving tab stop (`roving`: ROVING_ROLES and ROVING_TAGS rows, in their ROVING_GROUP_ROLES or
 *   ROVING_GROUP_TAGS widget, else in the nearest ancestor holding another row of their kind) that stands on a row but
 *   the widget's first, every other row of its kind "-1" or without a tabindex, moves to the first row, the two rows
 *   swapping their tabindex: the stop an unanswered widget draws (ADP's blank lists, SmartRecruiters' and Workable's
 *   unanswered radios), so a page converted again where nothing was chosen stays as it was;
 * - jr7 TOOLING-7 (T7-01): an icon drawn for the chosen state (`icons`: CHOSEN_ICONS) becomes a copy of the page's own
 *   unchosen twin (none in the page: it stays, and the conversion refuses it);
 * - jr7 TOOLING-7 (UP7-14): a row a page opens or closes by an answer (`opened`: OPENED_ROWS, UltiPro's Race row) is
 *   drawn open, as before any answer, so the visibility measured is the fixture's.
 * Returns how many it cleared.
 * @param {{ redacted: string; marks?: Array<{ selector: string; classes?: string[]; patterns?: string[];
 *   attributes?: string[]; aria?: boolean; swap?: Record<string, string> }>; drawings?: string[];
 *   roving?: { roles: string[]; tags: string[]; groupRoles: string[]; groupTags: string[] };
 *   mirrors?: Array<{ tag: string; attribute: string }>; icons?: Array<{ chosen: string; twin: string }>;
 *   opened?: Array<{ selector: string; className: string }> }} input
 * @returns {{ choices: number }}
 */
export function clearChoicesInPage(input) {
  const doc = globalThis.document;
  let choices = 0;
  for (const element of doc.querySelectorAll('[aria-checked="true" i], [aria-pressed="true" i]')) {
    for (const name of ['aria-checked', 'aria-pressed']) {
      if ((element.getAttribute(name) ?? '').trim().toLowerCase() === 'true') element.setAttribute(name, 'false');
    }
    choices += 1;
  }
  for (const element of doc.querySelectorAll('[data-checked]')) {
    const value = (element.getAttribute('data-checked') ?? '').trim().toLowerCase();
    if (value === '') element.removeAttribute('data-checked');
    else if (value === 'true') element.setAttribute('data-checked', 'false');
    else continue;
    choices += 1;
  }
  // The marks a drawn control or a list shows on the chosen answer (CHOSEN_MARKS): their classes and attributes go, and
  // an option's aria-selected="true" becomes "false".
  /** The ids of the options unselected here. @type {Set<string>} */
  const unselected = new Set();
  for (const { selector, classes = [], patterns = [], attributes = [], aria = true, swap = {} } of input.marks ?? []) {
    const matchers = patterns.map((source) => new RegExp(source));
    for (const element of doc.querySelectorAll(selector)) {
      const named = [...element.classList].filter((name) => classes.includes(name)
        || matchers.some((matcher) => matcher.test(name)));
      const held = attributes.filter((name) => element.hasAttribute(name));
      const selected = aria && (element.getAttribute('aria-selected') ?? '').trim().toLowerCase() === 'true';
      if (selected) element.setAttribute('aria-selected', 'false');
      if (selected && element.id !== '') unselected.add(element.id);
      if (named.length > 0) element.classList.remove(...named);
      for (const name of held) element.removeAttribute(name);
      // jr6 (JV-10): a chosen class swapped for its unchosen twin, as the page draws an unchosen option.
      const swapped = Object.entries(swap).filter(([from]) => element.classList.contains(from));
      for (const [from, to] of swapped) element.classList.replace(from, to);
      if (selected || named.length > 0 || held.length > 0 || swapped.length > 0) choices += 1;
    }
  }
  // s2 wd (the wd study's converter finding 1): an aria-activedescendant that names an option unselected above names the
  // chosen answer still (the exelixis capture of Workday's Country list open: its ul[role=listbox] named the chosen
  // country's row by its Workday id), so it goes, as Workday's own redaction drops it where it unselects an option itself
  // (redactWorkdayInPage, which runs after this and so never met that option chosen).
  if (unselected.size > 0) {
    for (const element of doc.querySelectorAll('[aria-activedescendant]')) {
      if (!unselected.has((element.getAttribute('aria-activedescendant') ?? '').trim())) continue;
      element.removeAttribute('aria-activedescendant');
      choices += 1;
    }
  }
  // jr6 fixes (PRIV-2, REVC-4): the parts a widget draws on its chosen row alone (CHOSEN_DRAWINGS).
  for (const part of (input.drawings ?? []).length > 0 ? doc.querySelectorAll((input.drawings ?? []).join(', ')) : []) {
    part.remove();
    choices += 1;
  }
  // jr7 TOOLING-7 (UP7-14): a row a page opens or closes by an answer (`opened`: OPENED_ROWS, UltiPro's Race row) is
  // drawn open, as before any answer.
  for (const { selector, className } of input.opened ?? []) {
    for (const row of doc.querySelectorAll(selector)) {
      if (row.classList.contains(className)) continue;
      row.classList.add(className);
      choices += 1;
    }
  }
  // jr7 TOOLING-7 (T7-01): an icon drawn for the chosen state (`icons`: CHOSEN_ICONS, Paycom's uiLib radios and boxes)
  // becomes a copy of the page's own unchosen twin; with no twin in the page it stays, and the conversion refuses it.
  for (const { chosen, twin } of input.icons ?? []) {
    const model = doc.querySelector(twin);
    if (model === null) continue;
    for (const icon of doc.querySelectorAll(chosen)) {
      icon.replaceWith(model.cloneNode(true));
      choices += 1;
    }
  }
  // jr6 fixes (PRIV-1's value mirror, from the ADP fixer): a group's chosen value repeated on each of its rows
  // (`mirrors`: VALUE_MIRRORS, ADP's wfn-radio-button radio-group-value) is blanked, as an unanswered group draws it.
  for (const { tag, attribute } of input.mirrors ?? []) {
    for (const element of doc.querySelectorAll(`${tag}[${attribute}]`)) {
      if ((element.getAttribute(attribute) ?? '') === '') continue;
      element.setAttribute(attribute, '');
      choices += 1;
    }
  }
  // jr6 fixes (PRIV-2 a, REVC-4): a widget's roving tab stop on a row but its first moves to its first row (see above).
  // The rows are read in the order the page is written (a shadow root's before its host's children, as the deep
  // serializer writes them, and chosenMarksIn reads them back), each standing in its parent or, at a shadow root's top,
  // in its host.
  if (input.roving !== undefined) {
    const { roles, tags, groupRoles, groupTags } = input.roving;
    /** @type {Element[]} */
    const order = [];
    /** @type {Map<Element, Element | null>} */
    const parents = new Map();
    /** @param {ParentNode} scope @param {Element | null} parent */
    const visit = (scope, parent) => {
      for (const child of Array.from(scope.children)) {
        order.push(child);
        parents.set(child, parent);
        if (child.shadowRoot) visit(child.shadowRoot, child);
        visit(child, child);
      }
    };
    visit(doc, null);
    /** @param {Element} element */
    const roleOf = (element) => (element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    /** A row's kind (its role, else its tag), or null for no row. @param {Element} element */
    const kindOf = (element) => {
      const role = roleOf(element);
      return roles.includes(role) ? role : tags.includes(element.localName) ? element.localName : null;
    };
    /** @param {Element} element */
    const isWidget = (element) => groupRoles.includes(roleOf(element)) || groupTags.includes(element.localName);
    /** @param {Element} element */
    const stopOf = (element) => element.getAttribute('tabindex')?.trim() ?? null;
    const rows = order.filter((element) => kindOf(element) !== null);
    if (rows.some((row) => stopOf(row) === '0')) {
      /** How many rows of each kind each ancestor holds, up to the rows' widget. @type {Map<Element, Map<string, number>>} */
      const held = new Map();
      for (const row of rows) {
        const kind = kindOf(row) ?? '';
        for (let at = parents.get(row) ?? null; at !== null; at = parents.get(at) ?? null) {
          const counts = held.get(at) ?? new Map();
          counts.set(kind, (counts.get(kind) ?? 0) + 1);
          held.set(at, counts);
          if (isWidget(at)) break;
        }
      }
      /** Each widget's rows, by kind, in order. @type {Map<Element, Map<string, Element[]>>} */
      const widgets = new Map();
      for (const row of rows) {
        const kind = kindOf(row) ?? '';
        let widget = null;
        for (let at = parents.get(row) ?? null; at !== null && widget === null; at = parents.get(at) ?? null) {
          if (isWidget(at) || (held.get(at)?.get(kind) ?? 0) >= 2) widget = at;
        }
        if (widget === null) continue;
        const kinds = widgets.get(widget) ?? new Map();
        const members = kinds.get(kind) ?? [];
        members.push(row);
        kinds.set(kind, members);
        widgets.set(widget, kinds);
      }
      for (const kinds of widgets.values()) {
        for (const members of kinds.values()) {
          const stops = members.flatMap((row, at) => (stopOf(row) === '0' ? [at] : []));
          if (members.length < 2 || stops.length !== 1 || stops[0] === 0) continue;
          if (!members.every((row, at) => at === stops[0] || [null, '-1'].includes(stopOf(row)))) continue;
          const [first] = members;
          const stop = members[stops[0] ?? 0];
          if (first === undefined || stop === undefined) continue;
          const was = first.getAttribute('tabindex');
          first.setAttribute('tabindex', '0');
          if (was === null) stop.removeAttribute('tabindex');
          else stop.setAttribute('tabindex', was);
          choices += 1;
        }
      }
    }
  }
  const region = /^iti__[a-z]{2}$/;
  const chosen = '[class*="single-value" i], [class*="singlevalue" i], [class*="multi-value" i], [class*="multivalue" i], '
    + '.iti__selected-country';
  for (const flag of doc.querySelectorAll('[class*="iti__"]')) {
    if (!flag.closest(chosen)) continue;
    const regions = [...flag.classList].filter((name) => region.test(name));
    if (regions.length === 0) continue;
    flag.classList.remove(...regions);
    choices += 1;
  }
  for (const button of doc.querySelectorAll('.iti__selected-country')) {
    for (const name of ['title', 'aria-label']) if (button.getAttribute(name)) button.setAttribute(name, input.redacted);
    for (const code of button.querySelectorAll('.iti__selected-dial-code')) {
      if ((code.textContent ?? '').trim() !== '') code.textContent = input.redacted;
    }
    choices += 1;
  }
  return { choices };
}

/**
 * The applicant's own text the redaction list may not hold, cleared where the markup shows it, on every platform after
 * the visibility is measured and before transformInPage: the one generic pass for an upload's file name and the texts
 * a page shows of a person's answers (the snapshot build of 2026-11-06: boards' and Workday's places, and the new ATSs'
 * DESIGN-NEW-ATS §6.4). Each place is keyed by its markup, never by a value, and its list names the snapshot it was read
 * from (FILE_NAME_PLACES, ENTRY_SUMMARY_PLACES, CHOSEN_PLACES, PROFILE_PLACES, FILE_LINK_PLACES, ENTRY_SUMMARY_CONTROLS);
 * a platform adds its own (PLATFORM_REDACTIONS: Workday's announcement and Review cells, iCIMS's current file, Oracle's
 * timeline):
 * - each file-name place's text becomes REDACTED (every element kept; an option's, a list's and a stylesheet's text
 *   kept), and every name it held (its whole text, each text and title in it) wherever else the frame repeats it, as
 *   written and percent-encoded, in text, comments and attributes (Workday's "<name> successfully uploaded", "Delete
 *   <name>", "Category for <name>"; a link's address), and a data-automation-id built from the name (paylocity-1). The
 *   names are answered, so the reload, the rescan and the written files are checked for them as for a found email;
 * - each entry summary's text becomes REDACTED; each chosen or profile place's text, and its aria-label, title and alt
 *   words, in it and its descendants (an open shadow root's too, where the platform keeps them);
 * - an open searchable Ant select's options' words and titles (dayforce-2) (UltiPro's Race row, which this pass drew
 *   open after the measure, is clearChoicesInPage's since jr7 TOOLING-7, UP7-14: OPENED_ROWS);
 * - each file or entry control keeps the words before the name that say what it does (its data-action, or its title,
 *   which names nothing else) in its aria-label and title, the rest REDACTED (jr6: one with neither keeps its label's
 *   words around a file name the page showed, the name REDACTED); its address becomes "#" and its download name
 *   REDACTED;
 * - a custom element's typed or chosen value and default-value (ukg-input, an answered sdf-radio-group; never an
 *   option's own element: -button, -option, -item, -radio, -checkbox, -tab), a date widget's data-date-value, and the
 *   data-gtm-form-interact-* attributes a tag manager adds once a form is typed into;
 * - s2 wd: each search result place's (`results`: SEARCH_RESULT_PLACES) text, title and aria-label, a role=option's too;
 * - jr7 TOOLING-7 (T7-01): the shown text a widget spells in an attribute (`spelled`: SPELLED_IDS, Paycom's tooltip
 *   anchors' data-testid), REDACTED inside its frame of words.
 * Returns how many places and repeats it cleared, and the file names (kept in memory, never printed or written).
 * @param {{ fileNames: string[]; entries: string[]; chosen: string[]; profile: string[]; links: string[];
 *   results?: string[]; redacted: string; spelled?: Array<{ attribute: string; source: string }> }} input
 * @returns {{ applicantText: number; names: string[] }}
 */
export function redactApplicantTextInPage(input) {
  const doc = globalThis.document;
  const { redacted } = input;
  let applicantText = 0;
  // s2 wd: a search's results that list the applicant's own answer (SEARCH_RESULT_PLACES), whole, inside an option too.
  for (const result of input.results === undefined || input.results.length === 0 ? []
    : doc.querySelectorAll(input.results.join(', '))) {
    let cleared = false;
    const walker = doc.createTreeWalker(result, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || node.nodeValue === redacted || node.parentElement?.closest('style')) continue;
      node.nodeValue = redacted;
      cleared = true;
    }
    for (const element of [result, ...result.querySelectorAll('*')]) {
      for (const name of ['aria-label', 'title']) {
        const value = element.getAttribute(name);
        if (value === null || value.trim() === '' || value === redacted) continue;
        element.setAttribute(name, redacted);
        cleared = true;
      }
    }
    if (cleared) applicantText += 1;
  }
  /** Clears a place: each of its text nodes becomes REDACTED (an option's, a list's and a stylesheet's kept), and with
   *  `words` its aria-label, title and alt, in it and its descendants. Answers the texts and titles it held.
   *  @param {Element} place @param {boolean} words */
  const clearPlace = (place, words) => {
    /** @type {string[]} */
    const held = [];
    const walker = doc.createTreeWalker(place, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.trim() ?? '';
      if (text === '' || text === redacted || node.parentElement?.closest('option, style, [role="option"], [role="listbox"]')) {
        continue;
      }
      held.push(text);
      node.nodeValue = redacted;
    }
    for (const element of [place, ...place.querySelectorAll('*')]) {
      const title = element.getAttribute('title');
      if (title !== null && title.trim() !== '' && title !== redacted) held.push(title.trim());
      if (!words) continue;
      // jr6 (SR-8): SmartRecruiters' spl-button names what it acts on in its splarialabel (an entry's Edit and Delete).
      for (const name of ['aria-label', 'title', 'alt', 'splarialabel']) {
        const value = element.getAttribute(name);
        if (value !== null && value.trim() !== '' && value !== redacted) element.setAttribute(name, redacted);
      }
    }
    if (held.length > 0) applicantText += 1;
    return held;
  };
  /** Every element `selectors` names (none for an empty list). @param {string[]} selectors */
  const placesOf = (selectors) => (selectors.length > 0 ? Array.from(doc.querySelectorAll(selectors.join(', '))) : []);

  /** @type {Set<string>} */
  const names = new Set();
  for (const place of placesOf(input.fileNames)) {
    const whole = (place.textContent ?? '').trim();
    for (const text of [whole, ...clearPlace(place, false)]) if (text.length >= 3 && text !== redacted) names.add(text);
    // Paylocity builds the uploaded file's data-automation-id from its name (paylocity-1: "<name>_uploaded").
    const id = place.getAttribute('data-automation-id');
    if (id !== null && id.includes('_uploaded')) {
      place.setAttribute('data-automation-id', id.replace(/^("?)[\s\S]*?(_uploaded"?)$/, `$1${redacted}$2`));
    }
  }
  // Builder B, clearcompany-0: an uploaded file's row names the file's id on the site's server (tr.file-row[data-id]).
  for (const row of doc.querySelectorAll('tr.file-row[data-id]')) {
    if (row.getAttribute('data-id') === redacted) continue;
    row.setAttribute('data-id', redacted);
    applicantText += 1;
  }
  for (const place of placesOf(input.entries)) clearPlace(place, false);
  for (const place of placesOf([...input.chosen, ...input.profile])) clearPlace(place, true);
  // The new ATSs, builder A: an open Ant select's list (dayforce-2), whose chosen marks clearChoicesInPage took. A
  // searchable select's (Country, State/Province, the dial codes: its .ant-select carries ant-select-show-search) holds
  // only what its search matched, the applicant's answer among it, so its options' words and titles go too; a
  // select-only list is the page's own words, whole: kept.
  for (const option of doc.querySelectorAll('.ant-select-dropdown [role="option"]')) {
    const list = option.closest('[role="listbox"][id$="_list"]');
    const control = list === null ? null : doc.getElementById(list.id.slice(0, -'_list'.length));
    if (!control?.closest('.ant-select')?.classList.contains('ant-select-show-search')) continue;
    const walker = doc.createTreeWalker(option, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue?.trim()) node.nodeValue = redacted;
    }
    for (const element of [option, ...option.querySelectorAll('*')]) {
      if (element.hasAttribute('title')) element.setAttribute('title', redacted);
    }
    applicantText += 1;
  }
  // (The new ATSs, builder A: UltiPro's Race row, drawn open in every fixture, as before any answer. jr7 TOOLING-7,
  // UP7-14: clearChoicesInPage opens it now, before the measure: OPENED_ROWS.)
  for (const control of placesOf(input.links)) {
    for (const element of [control, ...control.querySelectorAll('*')]) {
      // The words before the name that say what the control does ("view", "delete": its data-action; "Edit", "Delete":
      // its title, which names nothing else) stay.
      const action = (element.getAttribute('data-action') ?? '').trim() || (element.getAttribute('title') ?? '').trim();
      for (const name of ['aria-label', 'title']) {
        const value = element.getAttribute(name);
        if (!value || (name === 'title' && value.trim() === action && !element.hasAttribute('data-action'))) continue;
        // jr6 (adp-new-4): a control with no word of its own to keep (ADP's Remove, aria-label="Remove,NAME,Resume")
        // keeps its label's words around a file name the page showed, the name REDACTED; any other label goes whole.
        const shown = action === '' ? [...names].filter((each) => value.includes(each)) : [];
        if (shown.length > 0) {
          element.setAttribute(name, shown.sort((a, b) => b.length - a.length)
            .reduce((out, each) => out.split(each).join(redacted), value));
          continue;
        }
        const kept = action !== '' && value.toLowerCase().startsWith(`${action.toLowerCase()} `) ? value.slice(0, action.length + 1) : '';
        element.setAttribute(name, `${kept}${redacted}`);
      }
      for (const name of ['href', 'src', 'download']) if (element.hasAttribute(name)) element.setAttribute(name, name === 'download' ? redacted : '#');
    }
    applicantText += 1;
  }
  // A custom element's typed or chosen value and its default (ukg-input, ukg-date-input-text: ultipro-0..2; an
  // answered sdf-radio-group: adp-2), never an option's own (sdf-radio-button, wfn-radio-button), and a date widget's
  // data-date-value (ultipro-0, -1); the attributes a tag manager adds once a form is typed into (data-gtm-form-interact-*).
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.localName;
    for (const name of ['value', 'default-value']) {
      if (tag.includes('-') && element.hasAttribute(name) && !/-(?:button|option|item|radio|checkbox|tab)$/.test(tag)
        && element.getAttribute(name) !== '') {
        element.setAttribute(name, '');
        applicantText += 1;
      }
    }
    if (element.getAttribute('data-date-value')) {
      element.setAttribute('data-date-value', '');
      applicantText += 1;
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith('data-gtm-form-interact')) element.removeAttribute(attribute.name);
    }
    // jr7 TOOLING-7 (T7-01): an attribute in which a widget spells the text it shows (`spelled`: SPELLED_IDS, Paycom's
    // uiLib data-testid="anchor-for-<text>-tooltip") keeps its frame, the text REDACTED; an empty one stays as drawn.
    for (const { attribute, source } of input.spelled ?? []) {
      const value = element.getAttribute(attribute);
      const parts = value === null ? null : new RegExp(source).exec(value);
      if (parts === null || parts[2] === redacted) continue;
      element.setAttribute(attribute, `${parts[1] ?? ''}${redacted}${parts[3] ?? ''}`);
      applicantText += 1;
    }
  }
  // Each file name wherever else the frame repeats it, longest first, as written and percent-encoded.
  const variants = [...names].sort((a, b) => b.length - a.length)
    .flatMap((name) => [...new Set([name, encodeURIComponent(name)])]);
  if (variants.length > 0) {
    /** @param {string} text */
    const scrub = (text) => variants.reduce((out, name) => out.split(name).join(redacted), text);
    const walker = doc.createTreeWalker(doc, 4 | 128 /* NodeFilter.SHOW_TEXT | SHOW_COMMENT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const clean = scrub(node.nodeValue ?? '');
      if (clean === node.nodeValue) continue;
      node.nodeValue = clean;
      applicantText += 1;
    }
    for (const element of doc.querySelectorAll('*')) {
      for (const attribute of [...element.attributes]) {
        const clean = scrub(attribute.value);
        if (clean === attribute.value) continue;
        element.setAttribute(attribute.name, clean);
        applicantText += 1;
      }
    }
  }
  return { applicantText, names: [...names] };
}

/**
 * Each body element's tag and whether Chromium shows it: checkVisibility (display, visibility, opacity,
 * content-visibility) and a box of at least 4 by 4 pixels. Elements the converter removes are left out on both sides,
 * so the two lists line up element for element.
 * First the page's CSS animations and transitions are settled (the integration of 2026-11-06), so the capture and the
 * reloaded fixture are compared in the same state however long after loading each is measured: a finite one jumps to
 * its end, an endless one (a spinner, a pulse) is held at its start. Without it the comparison depended on timing:
 * oracle/jpmc-posting's similar-jobs tiles (job-event-tile-slide-up, 0.8 s) measured shown or hidden by how soon the
 * capture was measured after loading, and the converter refused it under load once passes ran before the measure.
 * @returns {string[]}
 */
export function measureInPage() {
  const doc = globalThis.document;
  const skip = 'script, noscript, template, style, link, meta, base, object, embed, applet, source, track';
  /** @type {string[]} */
  const states = [];
  if (!doc.body) return states;
  for (const animation of doc.getAnimations?.() ?? []) {
    try {
      if (animation.effect?.getComputedTiming().endTime === Infinity) {
        animation.pause();
        animation.currentTime = 0;
      } else {
        animation.finish();
      }
    } catch {
      // An animation that cannot be settled (no effect, a zero playback rate) is measured as it stands.
    }
  }
  for (const element of doc.body.querySelectorAll('*')) {
    if (element.closest(skip)) continue;
    const rect = element.getBoundingClientRect();
    const shown = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true,
      opacityProperty: true, visibilityProperty: true }) && rect.width >= 4 && rect.height >= 4;
    states.push(`${element.tagName.toLowerCase()}${shown ? '+' : '-'}`);
  }
  return states;
}

/** jr7 TOOLING-7 (JDEF-V1): the style orders a conversion can keep (--style-order): `archive`, the order the capture
 *  holds; `live`, the order the live page had where Blink's MHTML serializer is known to invert it (below). */
export const STYLE_ORDERS = ['archive', 'live'];
/** jr7 TOOLING-7 (JDEF-V1): each platform's default style order where it is not `archive` (JobDiva's: the verifier
 *  measured its form's text boxes drawn with no edge in the archived order, none in the live one). */
export const STYLE_ORDER_DEFAULTS = { jobdiva: 'live' };

/**
 * jr7 TOOLING-7 (JDEF-V1; SP\jr7\audit\jobdiva-eightfold-verify.md §2.1): the live cascade order, put back. Blink's MHTML
 * serializer writes every <style> element (the page's own and the ones its scripts append at run time) as a
 * <link rel="stylesheet" href="cid:css-<id>@mhtml.blink"> at the top of <head>, above the head's own <link> sheets (the
 * verifier's experiment: a page with <link a.css> and a <style> appended by its script, border 1px live, 0px from the
 * archive; JobDiva's captures: 33 cid sheets, then <title>, ..., bootstrap.min.css, a.css). Where the two conflict, the
 * archive inverts the live page: JobDiva's .jd-form edge lost under a.css's .form-control { border: 0 }, its own error
 * edge too. With --style-order live, before anything is measured, those cid sheets move, in their order, to just after
 * the head's last <link> sheet that is no cid: (each loaded again from the archive: the conversion waits for them,
 * sheetsLoadedInPage, before it measures), and transformInPage inlines every sheet where it then stands. Answers how many
 * it moved (none where the head links no sheet of its own). (Synchronous: the page runs no script, so no event or timer
 * of its fires; the conversion polls from outside.)
 * @returns {number}
 */
export function liveStyleOrderInPage() {
  const doc = globalThis.document;
  const head = doc.head;
  if (!head) return 0;
  /** @param {Element} link */
  const isSheet = (link) => (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
  const links = Array.from(head.querySelectorAll('link')).filter(isSheet);
  const archived = links.filter((link) => /^cid:css-/i.test(link.getAttribute('href') ?? ''));
  const own = links.filter((link) => !archived.includes(link));
  const last = own[own.length - 1];
  if (last === undefined || archived.length === 0) return 0;
  const moved = archived.filter((link) => (last.compareDocumentPosition(link) & 2 /* PRECEDING */) !== 0);
  last.after(...moved);
  return moved.length;
}

/** jr7 TOOLING-7 (JDEF-V1): whether every stylesheet <link> of the head whose cid: sheet the archive holds (`held`) has
 *  its sheet again, after liveStyleOrderInPage moved it (one the archive lacks never loads, and is not waited for).
 *  @param {string[]} held @returns {boolean} */
export function sheetsLoadedInPage(held) {
  return Array.from(globalThis.document.head?.querySelectorAll('link') ?? []).every((link) => {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    return !rel.includes('stylesheet') || !held.includes(link.getAttribute('href') ?? '')
      || /** @type {HTMLLinkElement} */ (link).sheet !== null;
  });
}

/**
 * jr7 TOOLING-7 (T7-01; snapshot7 paycomonline1's signature step, capture 7): a canvas stood in by the box it draws.
 * The capture is opened with scripting off, where a <canvas> is no picture but an inline box for its fallback content
 * (HTML: "when scripting is disabled, the canvas represents its fallback content"), measured hidden (Paycom's signature
 * pad: 1 by 17 pixels); the fixture is served with scripting on, where it is a picture of its own size, shown (476 by 93
 * inside its 480 by 96 pad), so the visibility check refused the page. Before anything is measured, every canvas, on
 * every platform, keeps the box it draws with scripting on in both settings: display inline-block, at least its width
 * and height attributes' pixels (300 by 150 without them, as HTML defaults them), its page's own sizing left on top.
 * It draws nothing: a capture keeps no drawing of a canvas. Answers how many it stood in.
 * @returns {number}
 */
export function standInCanvasesInPage() {
  const doc = globalThis.document;
  let count = 0;
  for (const canvas of doc.querySelectorAll('canvas')) {
    const size = (/** @type {string} */ name, /** @type {number} */ fallback) => {
      const value = Number.parseInt(canvas.getAttribute(name) ?? '', 10);
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    };
    const style = (canvas.getAttribute('style') ?? '').trim();
    canvas.setAttribute('style', [...(style === '' ? [] : [style.endsWith(';') ? style : `${style};`]),
      `display: inline-block; min-width: ${size('width', 300)}px; min-height: ${size('height', 150)}px;`].join(' '));
    count += 1;
  }
  return count;
}

// --- Workday's application steps (the owner's snapshots of 2026-11-06; docs/OWNER-QUESTIONS.md 93) ------------------

/**
 * What the generic redaction misses on Workday's application steps, done in the page after the generic file-name pass
 * (redactApplicantTextInPage, which takes an upload's preview, [data-automation-id=file-upload-item-name], and its name
 * wherever the page repeats it) and before transformInPage (PLATFORM_REDACTIONS.workday). Every value Workday shows
 * outside an input's own value, as the owner's snapshots of 2026-11-06 hold it, becomes REDACTED or the empty state
 * Workday draws:
 * - the Review step: every text in [data-automation-id=applyFlowReviewPage] outside a label, a legend, a heading and a
 *   button (its value cells: <label for="jobTitle">Job Title</label> <span id="jobTitle">...</span>, the address and
 *   the phone under an h4, a role's description, the attachments' names);
 * - any other read-only summary: an element that is no control, named by a label[for] (My Information's signed-in
 *   address, <span id="emailAddress">), and the header's account menu ([data-automation-id=
 *   utilityButtonAccountTasksMenu], which names the signed-in person), its words and labels;
 * - an upload's announcement and controls, after Workday took a resume or read it ("Autofill with Resume", My
 *   Experience's Resume/CV): the polite announcement [data-automation-id^=ariaLive] ("<file name> successfully
 *   uploaded") and the delete button's aria-label ("Delete <file name>"), and any other word ending in a document's
 *   extension, in text and labelling attributes (never an address);
 * - a dropdown (button[aria-haspopup=listbox]) that holds an answer: its words, its value (the chosen option's id) and
 *   its aria-label ("<question> <answer> Required");
 * - a multiselect prompt's answer: its pill's words ([data-automation-id=selectedItem], a role=option the generic rule
 *   leaves alone), aria-label and title, its promptOption's data-automation-label, and [data-automation-id=
 *   promptAriaInstruction] ("1 item selected, <answer>"); (s2 wd) its pill's id ("pill-<the option's id>") and its
 *   list's aria-activedescendant naming it, pill-REDACTED;
 * - an open dropdown's list: a chosen option's aria-selected and the list's aria-activedescendant naming it, and (s2 wd)
 *   the class that draws it apart (every answer row takes the class most of them have); an open prompt's list: a chosen
 *   row's data-automation-selected, data-automation-checked, isselected and "<label> checked"; a prompt's search
 *   results (data-uxi-multiselectlist-issearch="true": what the applicant typed found them), their words REDACTED;
 * - in an exclusive group (Self Identify's disability status: the other boxes disabled once one is ticked, their labels
 *   cursor "default"), those boxes enabled and their labels "pointer" again, as Workday draws the group before an
 *   answer (a radio's or checkbox's aria-checked="true" is the generic pass's, clearChoicesInPage);
 * - a date input's parts: each display's digits, each spin button's aria-valuetext and aria-valuenow, and the hidden help
 *   "current value is 11/6/2026", back to the placeholders (MM, DD, YYYY) Workday draws while it holds nothing;
 * - s2 wd (snapshot5, [pureinsurance.wd5.myworkdayjobs.com] Senior Security Analyst – Cloud Security.mht): an error's
 *   words that repeat what a field held, a field's alert (div[data-automation-id=inputAlert] "Error: Invalid Date: 09/")
 *   and the "Errors Found" summary's entries ([data-automation-id=errorHeading] ... <div id="hint618">Invalid Date: 09/
 *   </div>): every run of digits in them becomes REDACTED ("Invalid Date: REDACTED/"), their other words kept.
 * Returns counts, never values.
 * @param {{ redacted: string }} input
 */
export function redactWorkdayInPage(input) {
  const doc = globalThis.document;
  const { redacted } = input;
  // The placeholder each part of Workday's date input shows while it holds nothing (the empty My Experience of
  // "[resolvetech.wd1.myworkdayjobs.com] Devops Engineer (4)": dateSectionMonth-display "MM", dateSectionYear-display
  // "YYYY"; the Self Identify step's Day, "DD"), by the part's data-automation-id prefix. In the function: it runs in
  // the page.
  /** @type {Record<string, string>} */
  const WORKDAY_DATE_PARTS = { dateSectionMonth: 'MM', dateSectionDay: 'DD', dateSectionYear: 'YYYY' };
  const counts = { reviewCells: 0, summaries: 0, account: 0, uploads: 0, dropdowns: 0, prompts: 0, options: 0, choices: 0,
    dates: 0 };
  /** Every non-blank text node under `root` outside the elements `keep` names becomes REDACTED; answers how many.
   *  @param {Element} root @param {string} keep */
  const redactText = (root, keep) => {
    let changed = 0;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || node.nodeValue === redacted) continue;
      if (keep !== '' && node.parentElement?.closest(keep)) continue;
      node.nodeValue = redacted;
      changed += 1;
    }
    return changed;
  };
  for (const page of doc.querySelectorAll('[data-automation-id="applyFlowReviewPage"]')) {
    counts.reviewCells += redactText(page, 'label, legend, h1, h2, h3, h4, h5, h6, button, style');
  }
  // A read-only summary anywhere else: an element no control is, named by a label[for] (My Information's
  // <label for="emailAddress"></label> <span id="emailAddress">...</span>, the signed-in account's address).
  for (const label of doc.querySelectorAll('label[for]')) {
    const id = label.getAttribute('for') ?? '';
    const shown = id === '' ? null : doc.getElementById(id);
    if (shown === null || shown.matches('input, select, textarea, button, [role]')) continue;
    counts.summaries += redactText(shown, 'style');
  }
  // The header's account menu, which names the signed-in person: <div data-automation-id="utilityButtonAccountTasksMenu">
  // <button data-automation-id="utilityMenuButton" ...><span>...</span></button> (every signed-in snapshot).
  for (const menu of doc.querySelectorAll('[data-automation-id="utilityButtonAccountTasksMenu"]')) {
    counts.account += redactText(menu, 'style');
    for (const element of [menu, ...menu.querySelectorAll('*')]) {
      for (const name of ['aria-label', 'title', 'value']) {
        if (!element.hasAttribute(name) || element.getAttribute(name) === '' || element.getAttribute(name) === redacted) continue;
        element.setAttribute(name, redacted);
        counts.account += 1;
      }
    }
  }
  // Any other file's name the page shows (a chip or a list Workday draws otherwise): a word ending in a document's
  // extension, in text and in labelling attributes (never in an address: a tenant links its own PDFs).
  const fileLike = /[^\s"'<>/\\|:]+\.(?:pdf|docx?|rtf|odt|txt|pages)\b/gi;
  const textWalker = doc.createTreeWalker(doc, 4 | 128 /* NodeFilter.SHOW_TEXT | SHOW_COMMENT */);
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    if (node.parentElement?.closest('style')) continue;
    const clean = (node.nodeValue ?? '').replace(fileLike, () => redacted);
    if (clean === node.nodeValue) continue;
    node.nodeValue = clean;
    counts.uploads += 1;
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!['aria-label', 'title', 'alt', 'value', 'placeholder'].includes(name) && !name.startsWith('data-')) continue;
      const clean = attribute.value.replace(fileLike, () => redacted);
      if (clean === attribute.value) continue;
      element.setAttribute(attribute.name, clean);
      counts.uploads += 1;
    }
  }
  for (const preview of doc.querySelectorAll('[data-automation-id^="ariaLive"]')) {
    counts.uploads += redactText(preview, 'style');
  }
  for (const remove of doc.querySelectorAll('[data-automation-id="delete-file"][aria-label]')) {
    if (remove.getAttribute('aria-label') === redacted) continue;
    remove.setAttribute('aria-label', redacted);
    counts.uploads += 1;
  }
  for (const button of doc.querySelectorAll('button[aria-haspopup="listbox" i]')) {
    if ((button.getAttribute('value') ?? '') === '') continue;
    // The chosen option's words on the button itself, here too (the generic rule's, wherever that rule's ARIA test
    // stands), its id and its "<question> <answer> Required".
    redactText(button, 'style');
    button.setAttribute('value', redacted);
    if (button.hasAttribute('aria-label')) button.setAttribute('aria-label', redacted);
    counts.dropdowns += 1;
  }
  for (const element of doc.querySelectorAll('[data-automation-id="promptAriaInstruction"]')) {
    counts.prompts += redactText(element, 'style');
  }
  for (const pill of doc.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-label]')) {
    // The pill's own words: the generic rule leaves every text inside a role=option alone (a list's own options), and
    // Workday's pill is a role=option in its selectedItemList.
    if (pill.matches('[data-automation-id="selectedItem"]')) counts.prompts += redactText(pill, 'style');
    for (const name of ['aria-label', 'title', 'data-automation-label']) {
      if (!pill.hasAttribute(name) || pill.getAttribute(name) === '') continue;
      pill.setAttribute(name, redacted);
      counts.prompts += 1;
    }
  }
  // s2 wd (the wd study's converter finding 2): a pill's id names the chosen option by its Workday id (s2-verily-my-
  // information: <div role="option" data-automation-id="selectedItem" id="pill-<id>">), and so does its list's
  // aria-activedescendant (<ul data-automation-id="selectedItemList" aria-activedescendant="pill-<id>">): both become
  // pill-REDACTED.
  for (const pill of doc.querySelectorAll('[data-automation-id="selectedItem"][id^="pill-"]')) {
    if (pill.id === `pill-${redacted}`) continue;
    pill.id = `pill-${redacted}`;
    counts.prompts += 1;
  }
  for (const list of doc.querySelectorAll('[aria-activedescendant^="pill-"]')) {
    if (list.getAttribute('aria-activedescendant') === `pill-${redacted}`) continue;
    list.setAttribute('aria-activedescendant', `pill-${redacted}`);
    counts.prompts += 1;
  }
  for (const list of doc.querySelectorAll('[role="listbox" i]:not([data-automation-id="selectedItemList"])')) {
    for (const option of list.querySelectorAll('[role="option" i][aria-selected="true" i]')) {
      // Workday's own "Select One" (data-value="") is no answer.
      if ((option.getAttribute('data-value') ?? '') === '') continue;
      option.setAttribute('aria-selected', 'false');
      if (option.id !== '' && list.getAttribute('aria-activedescendant') === option.id) {
        list.removeAttribute('aria-activedescendant');
      }
      counts.options += 1;
    }
    // s2 wd: an open dropdown's chosen row is drawn apart, besides its aria-selected (the exelixis capture of the Country
    // list open: its rows <li data-value="<id>" role="option" id="<id>" class="css-1dq1u4">, the chosen one alone with
    // aria-selected and the class that draws it highlighted). Every answer row (data-value not "") is drawn as most of
    // them are: the chosen one's aria-selected goes and it takes their class.
    const rows = Array.from(list.querySelectorAll(':scope li[role="option" i][data-value]'))
      .filter((row) => (row.getAttribute('data-value') ?? '') !== '');
    /** @type {Map<string, number>} */
    const classes = new Map();
    for (const row of rows) classes.set(row.className, (classes.get(row.className) ?? 0) + 1);
    const common = [...classes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (rows.length >= 3 && common !== undefined && common[1] > rows.length / 2) {
      for (const row of rows) {
        if (row.className === common[0] && !row.hasAttribute('aria-selected')) continue;
        row.className = common[0];
        row.removeAttribute('aria-selected');
        counts.options += 1;
      }
    }
  }
  // s2 wd: an open prompt's list (div[data-automation-id=activeListContainer], s2-verily-field-of-study-open) marks a
  // chosen row in its own words besides aria-selected: <div role="option" data-automation-id="menuItem"
  // aria-label="<label> checked" data-automation-selected="true"><div data-automation-id="promptLeafNode"
  // data-automation-checked="Checked" data-uxi-multiselectlistitem-isselected="true">. Each is drawn as before an answer.
  for (const row of doc.querySelectorAll('[data-automation-id="activeListContainer"] [role="option" i]')) {
    let cleared = false;
    for (const element of [row, ...row.querySelectorAll('*')]) {
      if (element.getAttribute('data-automation-selected') === 'true') {
        element.setAttribute('data-automation-selected', 'false');
        cleared = true;
      }
      if (element.getAttribute('data-automation-checked') === 'Checked') {
        element.setAttribute('data-automation-checked', 'Not Checked');
        cleared = true;
      }
      if (element.getAttribute('data-uxi-multiselectlistitem-isselected') === 'true') {
        element.setAttribute('data-uxi-multiselectlistitem-isselected', 'false');
        cleared = true;
      }
    }
    const label = row.getAttribute('aria-label') ?? '';
    if (/ checked$/.test(label) && !/ not checked$/.test(label)) {
      row.setAttribute('aria-label', label.replace(/ checked$/, ' not checked'));
      cleared = true;
    }
    if (cleared) counts.options += 1;
  }
  // s2 wd (snapshot4, the owner's School search of 2026-11-07): an open prompt's search results list what the applicant
  // typed, <div data-uxi-widget-type="multiselectlist" data-uxi-multiselectlist-issearch="true"> under a "Search Results
  // (17)" header, its rows <div role="option" data-automation-id="menuItem" aria-label="<result> not checked"> ...
  // <div data-automation-id="promptOption">result</div>: each row's words become REDACTED, its aria-label "REDACTED not
  // checked" (a browse list, issearch="false", is the tenant's own list: kept).
  for (const results of doc.querySelectorAll('[data-uxi-multiselectlist-issearch="true" i]')) {
    for (const row of results.querySelectorAll('[role="option" i]')) {
      counts.prompts += redactText(row, 'style');
      const label = row.getAttribute('aria-label') ?? '';
      const state = / (not checked|checked)$/.exec(label);
      const words = `${redacted}${state === null ? '' : ` ${state[1]}`}`;
      if (label !== '' && label !== words) {
        row.setAttribute('aria-label', words);
        counts.prompts += 1;
      }
      for (const element of [row, ...row.querySelectorAll('[title]')]) {
        if (element.hasAttribute('title') && element.getAttribute('title') !== redacted) element.setAttribute('title', redacted);
      }
    }
  }
  for (const group of doc.querySelectorAll('[data-automation-id$="-CheckboxGroup"]')) {
    if (group.querySelector('input[disabled]') === null) continue;
    for (const disabled of group.querySelectorAll('input[disabled], div[disabled]')) disabled.removeAttribute('disabled');
    for (const label of group.querySelectorAll('label[cursor]')) label.setAttribute('cursor', 'pointer');
    counts.choices += 1;
  }
  // s2 wd (snapshot5): an error's digits, which repeat what a field held (see the header).
  for (const place of doc.querySelectorAll('[data-automation-id="inputAlert"], [data-automation-id="errorHeading"]')) {
    const walker = doc.createTreeWalker(place, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').replace(/\d+/g, redacted);
      if (text === node.nodeValue) continue;
      node.nodeValue = text;
      counts.dates += 1;
    }
  }
  for (const wrapper of doc.querySelectorAll('[data-automation-id="dateInputWrapper"]')) {
    /** @type {string[]} */
    const shown = [];
    for (const [part, placeholder] of Object.entries(WORKDAY_DATE_PARTS)) {
      const display = wrapper.querySelector(`[data-automation-id="${part}-display"]`);
      const spin = wrapper.querySelector(`[data-automation-id="${part}-input"]`);
      if (display === null && spin === null) continue;
      shown.push(placeholder);
      if (display !== null && (display.textContent ?? '') !== placeholder) {
        display.textContent = placeholder;
        counts.dates += 1;
      }
      if (spin !== null) {
        spin.setAttribute('aria-valuetext', placeholder);
        spin.removeAttribute('aria-valuenow');
      }
    }
    // <div aria-hidden="true" id="helpText-<field id>">current value is MM/YYYY</div>, the wrapper's id its field's.
    const help = wrapper.id === '' ? null : doc.getElementById(`helpText-${wrapper.id}`);
    // The parts in the order the page shows them.
    const ordered = Array.from(wrapper.querySelectorAll('[data-automation-id$="-display"]'))
      .map((display) => WORKDAY_DATE_PARTS[(display.getAttribute('data-automation-id') ?? '').replace(/-display$/, '')])
      .filter((part) => part !== undefined);
    if (help !== null) help.textContent = `current value is ${(ordered.length > 0 ? ordered : shown).join('/')}`;
  }
  return counts;
}

// --- end Workday -------------------------------------------------------------------------------------------------------

/**
 * Turns the frame's document into a fixture in place: inlining, removal, form actions and redaction. Returns counts,
 * the emails and phone numbers it found (kept in memory for the final check, never printed or written) and the
 * suspicious tokens left over. jr6 (jobvite-new-2): each place where a listed string met the page's own text (an
 * option, a label, a legend, a posting's description: `postingPlaces`) is kept in the page for listedPlacesInPage.
 * jr6 round 2 (TOOLING; BUILD.md 4b): a listed string respelled in an attribute (`respelled`, respelledSources: joined,
 * camel-cased, its separators changed or percent-encoded, as SmartRecruiters' location rows spell a typed city in their
 * value and data-sr-id) becomes REDACTED there too, at words' edges (respelledEdge's rule, written again here: this
 * runs in the page); a frame's src is left as it is (its route must still answer it: its address already lost them,
 * respelledAddress, but in its host, which the final check refuses).
 * @param {{ resources: Record<string, Resource>; frameUrls: Record<string, string | null>; frameUrl: string;
 *   redact: string[]; email: string; notEmail: string; phone: string;
 *   phoneDigits: { min: number; minWithPlus: number; max: number }; phoneAttributes: string[]; redacted: string;
 *   postingPlaces?: string; respelled?: Array<{ index: number; source: string }>; listRows?: string;
 *   postingCopies?: Array<{ attribute: string; title: string[]; description: string[] }>;
 *   frameSrc?: Array<{ selector: string; url: string }> }} input
 */
export function transformInPage(input) {
  const doc = globalThis.document;
  const { resources, frameUrls, frameUrl, redacted } = input;
  const counts = {
    typedValues: 0, checked: 0, selected: 0, hiddenValues: 0, widgetText: 0, emails: 0, phones: 0, listed: 0,
    // jr6 round 2: the listed strings respelled in attributes; jr6 fixes (PRIV-6): and in text.
    respelled: 0, respelledText: 0,
    scripts: 0, eventHandlers: 0, javascriptUrls: 0, bases: 0, metaHttpEquiv: 0, metaRefresh: 0, embeds: 0,
    links: 0, srcdoc: 0, stylesheets: 0, images: 0, placeholders: 0, missing: 0, forms: 0, frames: 0,
    framesDropped: 0, shadowRoots: 0,
    // The new ATSs (DESIGN-NEW-ATS §6.2): the closed shadow roots stood in by their hosts' boxes.
    closedRoots: 0,
  };
  /** @type {Set<string>} */
  const found = new Set();
  const notes = [];

  /** An address resolved against the frame's original URL, or null. @param {string} ref @param {string} base */
  const resolveUrl = (ref, base) => {
    try {
      return new URL(ref, base).href;
    } catch {
      try {
        return new URL(ref, frameUrl).href;
      } catch {
        return null;
      }
    }
  };
  /** A data: URI for an archived image, or "data:," when the archive lacks it. @param {string | null} url */
  const imageFor = (url) => {
    const resource = url ? resources[url] ?? resources[url.split('#')[0] ?? ''] : undefined;
    if (resource?.dataUri) {
      counts.images += 1;
      if (resource.placeholder) counts.placeholders += 1;
      return resource.dataUri;
    }
    counts.missing += 1;
    return 'data:,';
  };

  /**
   * Stylesheet text with @charset dropped, @import inlined from the archive and every url() a data: URI.
   * @param {string} text @param {string} base @param {number} depth @returns {string}
   */
  const rewriteCss = (text, base, depth) => {
    let css = text.replace(/@charset\s+(?:"[^"]*"|'[^']*')\s*;/gi, '');
    css = css.replace(/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi,
      (_match, a, b, c, d, e, condition) => {
        const url = resolveUrl(a ?? b ?? c ?? d ?? e ?? '', base);
        const sheet = url ? resources[url]?.css : undefined;
        if (!sheet || depth > 4) {
          counts.missing += 1;
          return '';
        }
        const inner = rewriteCss(sheet.text, sheet.base, depth + 1);
        const media = String(condition).trim();
        if (media && !/^(?:layer|supports)\b/i.test(media)) return `@media ${media} {\n${inner}\n}`;
        if (media) notes.push('an @import with layer() or supports() was inlined without its condition');
        return inner;
      });
    return css.replace(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\s\\'"]|\\.)*))\s*\)/gi,
      (match, a, b, c) => {
        const ref = String(a ?? b ?? c ?? '').replace(/\\(.)/g, '$1').trim();
        if (!ref || ref.startsWith('#') || /^data:/i.test(ref)) return match;
        return `url("${imageFor(resolveUrl(ref, base))}")`;
      });
  };

  // Open shadow roots: kept where the platform keeps them (SHADOW_ROOT_PLATFORMS, deepenInPage), refused elsewhere rather
  // than dropped silently; counted here either way.
  for (const element of doc.querySelectorAll('*')) if (element.shadowRoot) counts.shadowRoots += 1;
  // The new ATSs (DESIGN-NEW-ATS §6.2), every platform: a closed shadow root's host (marked by markClosedShadowHosts)
  // keeps its box, its root being one no page code can read or write.
  for (const host of doc.querySelectorAll('[data-fixture-closed-root]')) {
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = (host.getAttribute('style') ?? '').trim();
    host.setAttribute('style', [...(style === '' ? [] : [style.endsWith(';') ? style : `${style};`]),
      `box-sizing: border-box; min-width: ${rect.width}px; min-height: ${rect.height}px;`].join(' '));
    counts.closedRoots += 1;
  }

  // Active content.
  for (const element of doc.querySelectorAll('script, noscript')) {
    element.remove();
    counts.scripts += 1;
  }
  for (const element of doc.querySelectorAll('object, embed, applet')) {
    element.remove();
    counts.embeds += 1;
  }
  for (const element of doc.querySelectorAll('base')) {
    element.remove();
    counts.bases += 1;
  }
  for (const element of doc.querySelectorAll('meta[http-equiv]')) {
    if ((element.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') counts.metaRefresh += 1;
    else counts.metaHttpEquiv += 1;
    element.remove();
  }
  for (const element of doc.querySelectorAll('[srcdoc]')) {
    element.removeAttribute('srcdoc');
    counts.srcdoc += 1;
  }
  const urlAttributes = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'ping'];
  /** An address as a URL parser reads it: tabs and newlines removed, leading spaces and controls ignored. */
  const asParsed = (/** @type {string} */ value) => {
    const compact = value.replace(/[\t\n\r]/g, '');
    let start = 0;
    while (start < compact.length && compact.charCodeAt(start) <= 0x20) start += 1;
    return compact.slice(start);
  };
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        counts.eventHandlers += 1;
      } else if (urlAttributes.includes(name) && /^javascript:/i.test(asParsed(attribute.value))) {
        if (name === 'href') element.setAttribute(attribute.name, '#');
        else element.removeAttribute(attribute.name);
        counts.javascriptUrls += 1;
      }
    }
  }

  // Stylesheets: the page's own <style> elements first, then each <link> becomes a <style> in its place, so the
  // cascade order is kept. A "</style" inside the text would end the element when the fixture is parsed again.
  for (const style of doc.querySelectorAll('style')) {
    if (/url\(|@import/i.test(style.textContent ?? '')) style.textContent = rewriteCss(style.textContent ?? '', frameUrl, 0);
  }
  for (const link of doc.querySelectorAll('link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet') && !rel.includes('alternate')) {
      const sheet = resources[link.href]?.css;
      if (!sheet) {
        counts.missing += 1;
        link.remove();
        continue;
      }
      const style = doc.createElement('style');
      const media = link.getAttribute('media');
      if (media && media.trim().toLowerCase() !== 'all') style.setAttribute('media', media);
      style.textContent = rewriteCss(sheet.text, sheet.base, 0);
      link.replaceWith(style);
      counts.stylesheets += 1;
    } else if (!rel.includes('canonical')) {
      link.remove();
      counts.links += 1;
    }
  }
  // The new ATSs, builder B (dice-2, -7, -8): a per-visitor id a script writes into a stylesheet
  // (:root { --sa-uid: '<base64 of a uuid>' }), which the capture keeps as a sheet of its own: read once inlined.
  const visitor = new RegExp(`(--sa-uid:\\s*['"])(?!${redacted}['"])[^'"]*(['"])`, 'g');
  for (const style of doc.querySelectorAll('style')) {
    let text = (style.textContent ?? '').replace(visitor, `$1${redacted}$2`);
    if (/<\/style/i.test(text)) text = text.replace(/<\/style/gi, '<\\/style');
    if (text !== style.textContent) style.textContent = text;
  }
  for (const element of doc.querySelectorAll('[style]')) {
    const value = element.getAttribute('style') ?? '';
    if (/url\(/i.test(value)) element.setAttribute('style', rewriteCss(value, frameUrl, 0));
  }

  // Images and other fetched media.
  for (const image of doc.querySelectorAll('img')) {
    image.setAttribute('src', imageFor(image.currentSrc || resolveUrl(image.getAttribute('src') ?? '', frameUrl)));
    for (const name of ['srcset', 'sizes', 'loading']) image.removeAttribute(name);
  }
  for (const source of doc.querySelectorAll('picture source, video source, audio source, track')) source.remove();
  for (const media of doc.querySelectorAll('video, audio')) {
    media.removeAttribute('src');
    media.removeAttribute('poster');
  }
  for (const input of doc.querySelectorAll('input[type="image" i][src]')) {
    input.setAttribute('src', imageFor(resolveUrl(input.getAttribute('src') ?? '', frameUrl)));
  }
  for (const element of doc.querySelectorAll('[background]')) {
    element.setAttribute('background', imageFor(resolveUrl(element.getAttribute('background') ?? '', frameUrl)));
  }
  for (const element of doc.querySelectorAll('image, feImage, use')) {
    for (const name of ['href', 'xlink:href']) {
      const value = element.getAttribute(name);
      if (value === null || value.startsWith('#') || value.startsWith('data:')) continue;
      if (element.localName === 'use') element.removeAttribute(name);
      else element.setAttribute(name, imageFor(resolveUrl(value, frameUrl)));
    }
  }

  // Frames: an archived frame's cid: address becomes its own URL (served from the route map); one without a web
  // address is left blank, and so is any other address but a web one (a data: frame would run its own scripts). A web
  // address the archive lacks stays, and the final check refuses the request it makes.
  /** @type {string[]} */
  const linkedFrames = [];
  // jr7 TOOLING-7 (RBP7-V2 a): --frame-src gives a frame the capture saved unloaded (no web address) the public vendor
  // address its selector names, served by the third-party stand-in; one that names a frame with an address of its own
  // changes nothing and is counted, so the conversion refuses it. `given[n]`, `refused[n]`: per entry.
  const frameSrc = input.frameSrc ?? [];
  const given = frameSrc.map(() => 0);
  const refused = frameSrc.map(() => 0);
  /** The --frame-src entry a frame matches, by position, or -1. @param {Element} frame */
  const entryOf = (frame) => frameSrc.findIndex(({ selector }) => {
    try {
      return frame.matches(selector);
    } catch {
      return false;
    }
  });
  /** Gives an unloaded frame its entry's address; answers whether it did. @param {Element} frame */
  const giveAddress = (frame) => {
    const at = entryOf(frame);
    const url = frameSrc[at]?.url;
    if (url === undefined) return false;
    frame.setAttribute('src', url);
    linkedFrames.push(url);
    given[at] = (given[at] ?? 0) + 1;
    return true;
  };
  for (const frame of doc.querySelectorAll('iframe[src], frame[src]')) {
    const src = frame.getAttribute('src') ?? '';
    if (!src.startsWith('cid:')) {
      if (!/^https?:/i.test(src.trim())) {
        if (giveAddress(frame)) continue;
        frame.removeAttribute('src');
        counts.framesDropped += 1;
      } else if (entryOf(frame) >= 0) {
        refused[entryOf(frame)] = (refused[entryOf(frame)] ?? 0) + 1;
      }
      continue;
    }
    const url = frameUrls[src] ?? null;
    if (url) {
      if (entryOf(frame) >= 0) refused[entryOf(frame)] = (refused[entryOf(frame)] ?? 0) + 1;
      frame.setAttribute('src', url);
      linkedFrames.push(url);
      counts.frames += 1;
    } else if (!giveAddress(frame)) {
      frame.removeAttribute('src');
      counts.framesDropped += 1;
    }
  }
  // jr7 TOOLING-7 (RBP7-V2 a): a frame saved with no address at all.
  for (const frame of frameSrc.length > 0 ? doc.querySelectorAll('iframe:not([src]), frame:not([src])') : []) {
    giveAddress(frame);
  }

  // Forms never reach the site: the e2e harness records any request to /__submitted as a failure.
  for (const form of doc.querySelectorAll('form')) {
    form.setAttribute('action', '/__submitted');
    form.setAttribute('method', 'post');
    counts.forms += 1;
  }
  for (const control of doc.querySelectorAll('[formaction]')) control.setAttribute('formaction', '/__submitted');
  for (const control of doc.querySelectorAll('[formmethod]')) control.removeAttribute('formmethod');

  // Typed values, choices and hidden values.
  const keepValue = ['checkbox', 'radio', 'submit', 'button', 'reset', 'image'];
  for (const input of doc.querySelectorAll('input')) {
    const type = (input.getAttribute('type') ?? 'text').trim().toLowerCase();
    if (type === 'hidden') {
      if (input.getAttribute('value')) {
        input.setAttribute('value', redacted);
        counts.hiddenValues += 1;
      }
    } else if (type === 'checkbox' || type === 'radio') {
      if (input.hasAttribute('checked')) {
        input.removeAttribute('checked');
        counts.checked += 1;
      }
    } else if (type === 'file') {
      input.removeAttribute('value');
    } else if (!keepValue.includes(type) && input.hasAttribute('value')) {
      if (input.getAttribute('value') !== '') counts.typedValues += 1;
      input.setAttribute('value', '');
      // A widget's mirror of what was typed (react-select keeps it in data-value on the input's container).
      const mirror = input.parentElement?.closest('[data-value]');
      if (mirror && mirror.getAttribute('data-value') !== '') {
        mirror.setAttribute('data-value', '');
        counts.typedValues += 1;
      }
    }
  }
  for (const textarea of doc.querySelectorAll('textarea')) {
    if (textarea.textContent) {
      textarea.textContent = '';
      counts.typedValues += 1;
    }
  }
  for (const option of doc.querySelectorAll('option[selected]')) {
    option.removeAttribute('selected');
    counts.selected += 1;
  }
  for (const editable of doc.querySelectorAll('[contenteditable]:not([contenteditable="false" i])')) {
    if (editable.textContent?.trim()) {
      editable.replaceChildren();
      counts.typedValues += 1;
    }
  }

  // The text a listbox or combobox trigger shows is the chosen value, and so is a chip's: both become REDACTED.
  const widgetValues = [
    '[role="combobox"]:not(input, select, textarea)', '[aria-haspopup="listbox" i]:not(input, select, textarea)',
    '[class*="singlevalue" i]', '[class*="single-value" i]', '[class*="multivalue" i]', '[class*="multi-value" i]',
    '[class*="chip" i]', '[data-automation-id="selectedItem"]',
  ].join(', ');
  for (const widget of doc.querySelectorAll(widgetValues)) {
    // A chip's label inside the chip is the same value: the outermost match redacts it once.
    if (widget.parentElement?.closest(widgetValues)) continue;
    // Every text node becomes REDACTED rather than empty, so no box collapses and visibility stays as it was.
    const walker = doc.createTreeWalker(widget, 4 /* NodeFilter.SHOW_TEXT */);
    let changed = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || node.parentElement?.closest('[role="listbox"], [role="option"], style')) continue;
      node.nodeValue = redacted;
      changed = true;
    }
    if (changed) counts.widgetText += 1;
  }

  // (An upload widget's file name and a resume's entries were redacted before, by redactApplicantTextInPage.)
  // Snapshot build, boards: a tel: or sms: link names a phone number whatever its spelling, percent-encoded too
  // (<a href="tel:+1(NNN)%20NNN-NNNN"> in [abclegal.com] ABC Legal - Job Openings (1).mht, which the phone pattern below
  // reads only unencoded): one whose address holds 7 digits or more becomes tel:REDACTED.
  for (const link of doc.querySelectorAll('[href]')) {
    const href = (link.getAttribute('href') ?? '').trim();
    const scheme = /^(tel|sms):/i.exec(href)?.[1];
    if (scheme === undefined || href.slice(scheme.length + 1) === redacted) continue;
    let address = href;
    try {
      address = decodeURIComponent(href);
    } catch {
      address = href;
    }
    if (address.replace(/\D/g, '').length < 7) continue;
    link.setAttribute('href', `${scheme.toLowerCase()}:${redacted}`);
    counts.phones += 1;
  }

  // Emails, phone numbers and the listed strings, in text, comments and attributes.
  const listed = input.redact.map((source) => new RegExp(source, 'gi'));
  const email = new RegExp(input.email, 'g');
  const notEmail = new RegExp(input.notEmail, 'i');
  const phone = new RegExp(input.phone, 'g');
  /** @param {string} match */
  const phoneDigitsOk = (match) => {
    const digits = match.replace(/\D/g, '').length;
    const min = match.trimStart().startsWith('+') ? input.phoneDigits.minWithPlus : input.phoneDigits.min;
    return digits >= min && digits <= input.phoneDigits.max;
  };
  // jr6 (jobvite-new-2): the kinds of the page's own text where a listed string tells its value by elimination, and the
  // places a listed string met there (read by listedPlacesInPage once the platform's own redactions ran).
  // jr6 fixes (PRIV-7): an option is any list row (`listRows`: LIST_ROWS), the outermost one, read through the shadow
  // roots' hosts (SmartRecruiters' spl-select-option draws its role=option inside its own shadow root).
  /** @type {Array<[string, string]>} */
  const placeKinds = [['option', input.listRows ?? 'option, [role="option" i]'], ['label', 'label'], ['legend', 'legend'],
    ['posting', input.postingPlaces ?? '']];
  /** @type {Array<{ element: Element; kind: string }>} */
  const listedAt = [];
  /** The outermost element at or above `start` that `selector` names, a shadow root's host included (jr6 fixes, PRIV-7).
   *  @param {Element} start @param {string} selector @returns {Element | null} */
  const outermostRow = (start, selector) => {
    /** @type {Element | null} */
    let found = null;
    /** @type {any} */
    let at = start;
    while (at) {
      if (at.matches(selector)) found = at;
      const parent = at.parentNode;
      at = at.parentElement ?? (parent?.nodeType === 11 ? parent.host ?? null : null);
    }
    return found;
  };
  /** @param {Element | null | undefined} at */
  const noteListed = (at) => {
    if (!at) return;
    for (const [kind, selector] of placeKinds) {
      const place = selector === '' ? null : kind === 'option' ? outermostRow(at, selector) : at.closest(selector);
      if (place === null) continue;
      listedAt.push({ element: place, kind });
      return;
    }
  };
  /** A text node's element, or its shadow root's host at a shadow root's top (jr6 fixes, PRIV-7). @param {Node} node */
  const holderOf = (node) => node.parentElement
    ?? (node.parentNode?.nodeType === 11 ? /** @type {any} */ (node.parentNode).host ?? null : null);
  /** @param {string} text @param {boolean} phones @param {Element | null} [at] */
  const scrub = (text, phones, at) => {
    let out = text;
    for (const pattern of listed) {
      out = out.replace(pattern, () => {
        counts.listed += 1;
        noteListed(at);
        return redacted;
      });
    }
    out = out.replace(email, (match) => {
      if (notEmail.test(match)) return match;
      counts.emails += 1;
      found.add(match);
      return redacted;
    });
    if (phones) {
      out = out.replace(phone, (match) => {
        if (!phoneDigitsOk(match)) return match;
        counts.phones += 1;
        found.add(match.trim());
        return redacted;
      });
    }
    return out;
  };
  const walker = doc.createTreeWalker(doc, 4 | 128 /* NodeFilter.SHOW_TEXT | SHOW_COMMENT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3 && node.parentElement?.closest('style')) continue;
    const value = node.nodeValue ?? '';
    const clean = scrub(value, true, holderOf(node));
    if (clean !== value) node.nodeValue = clean;
  }
  // jr6 round 2 (TOOLING; BUILD.md 4b): a listed string respelled in an attribute (respelledSources' patterns), at
  // words' edges (respelledEdge's rule: an end, a separator, a lower-case letter then a capital, a letter beside a digit).
  const respelled = (input.respelled ?? []).map(({ source }) => new RegExp(source, 'gi'));
  const wordChar = /^[A-Za-z0-9\u00c0-\u024f]$/;
  /** @param {string} text @param {number} at */
  const edge = (text, at) => {
    if (at <= 0 || at >= text.length) return true;
    const before = text[at - 1] ?? '';
    const after = text[at] ?? '';
    if (!wordChar.test(before) || !wordChar.test(after)) return true;
    if (/\d/.test(before) !== /\d/.test(after)) return true;
    return before !== before.toUpperCase() && after !== after.toLowerCase();
  };
  /** @param {string} text @param {'respelled' | 'respelledText'} [counted] what it counts in (jr6 fixes, PRIV-6: text
   *  runs apart) */
  const respell = (text, counted = 'respelled') => {
    if (/;base64,/i.test(text)) return text;
    let out = text;
    for (const pattern of respelled) {
      /** @type {Array<[number, number]>} */
      const spans = [];
      pattern.lastIndex = 0;
      for (let match = pattern.exec(out); match !== null; match = pattern.exec(out)) {
        const end = match.index + match[0].length;
        if (match[0] !== '' && edge(out, match.index) && edge(out, end)) {
          spans.push([match.index, end]);
          pattern.lastIndex = end;
        } else {
          pattern.lastIndex = match.index + 1;
        }
      }
      for (const [start, end] of spans.reverse()) {
        out = `${out.slice(0, start)}${redacted}${out.slice(end)}`;
        counts[counted] += 1;
      }
    }
    return out;
  };
  // jr6 PRIVACY-FIX: whether a posting copy's title or description fields (POSTING_COPY_ATTRIBUTES) read otherwise in
  // two JSON texts of the attribute; a text that is no JSON object is the copy whole.
  /** @param {{ title: string[]; description: string[] }} copy @param {string} before @param {string} after */
  const postingFieldsDiffer = (copy, before, after) => {
    try {
      const was = JSON.parse(before);
      const now = JSON.parse(after);
      if (was === null || typeof was !== 'object' || now === null || typeof now !== 'object') return before !== after;
      return [...copy.title, ...copy.description].some((field) => was[field] !== now[field]);
    } catch {
      return before !== after;
    }
  };
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^\s*data:/i.test(attribute.value)) continue;
      const name = attribute.name.toLowerCase();
      const lowerValue = attribute.value.trim().toLowerCase();
      const phones = input.phoneAttributes.includes(name) || name.startsWith('data-') ||
        (name === 'href' && (lowerValue.startsWith('tel:') || lowerValue.startsWith('sms:')));
      const listedBefore = counts.listed + counts.respelled;
      const scrubbed = scrub(attribute.value, phones, element);
      // A frame's address keeps its spelling here (its route answers it as written; respelledAddress already took what
      // its path and query spelled); what stays (its host) the final check refuses.
      const framed = name === 'src' && (element.localName === 'iframe' || element.localName === 'frame');
      const clean = framed ? scrubbed : respell(scrubbed);
      // jr6 fixes (G.3, the coordinator's decision): a listed string respelled in an attribute that holds words (a
      // description meta's content, an option's value) is noted where the elimination refusal reads, as the exact rule
      // notes it, so a REDACTED gap in a public description or list asks for synthetic text (--replace-text). An address
      // is no such place (a posting's own Apply link inside its description's container spells its title in its slug).
      const address = urlAttributes.includes(name) || name === 'srcset'
        || /^\s*(?:https?:|mailto:|tel:|\/\/|\/(?!\s))/i.test(attribute.value);
      if (clean !== scrubbed && !address) noteListed(element);
      // jr6 PRIVACY-FIX: a JSON copy of the posting in an attribute (POSTING_COPY_ATTRIBUTES: Breezy's data-position)
      // whose title or description fields a listed or respelled string met is a posting place, as a posting's own text
      // is: its REDACTED gaps tell the value by elimination, so the refusal asks for --replace-text '<css>@<attribute>'.
      const copy = (input.postingCopies ?? []).find((each) => each.attribute === name);
      if (copy !== undefined && counts.listed + counts.respelled > listedBefore
        && postingFieldsDiffer(copy, attribute.value, clean)) listedAt.push({ element, kind: 'posting' });
      if (clean !== attribute.value) element.setAttribute(attribute.name, clean);
    }
  }
  // jr6 fixes (PRIV-6): a listed string respelled in the page's text too, as in attributes (a résumé's file name joined
  // with underscores where FILE_NAME_PLACES does not look, a name written joined in a sentence); where it met an
  // option, a label, a legend or a posting, the place is noted as the exact rule notes it (listedPlacesInPage).
  const textWalker = doc.createTreeWalker(doc, 4 | 128 /* NodeFilter.SHOW_TEXT | SHOW_COMMENT */);
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    if (node.nodeType === 3 && node.parentElement?.closest('style')) continue;
    const value = node.nodeValue ?? '';
    const clean = respell(value, 'respelledText');
    if (clean === value) continue;
    node.nodeValue = clean;
    noteListed(holderOf(node));
  }
  const view = /** @type {any} */ (globalThis);
  view.__fixtureListed = listedAt;

  // The fixture is written as UTF-8.
  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  for (const meta of doc.querySelectorAll('meta[charset]')) meta.remove();
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.prepend(charset);

  // Long random-looking strings that survived, for a person to look at.
  const ignored = new Set(['class', 'style', 'id', 'for', 'name', 'd', 'points', 'viewbox', 'transform', 'srcset',
    'aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage',
    'headers', 'list', 'form']);
  /** @type {Map<string, string>} */
  const tokens = new Map();
  /** @param {string} text @param {string} where */
  const collect = (text, where) => {
    for (const match of text.matchAll(/[A-Za-z0-9+/_=.~-]{24,}/g)) {
      const token = match[0];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) continue;
      const digits = token.replace(/\D/g, '').length;
      const letters = token.replace(/[^A-Za-z]/g, '').length;
      if (digits < 2 || letters < 2 || new Set(token).size < 10 || /^https?:/i.test(token)) continue;
      if (!tokens.has(token)) tokens.set(token, where);
    }
  };
  const tokenWalker = doc.createTreeWalker(doc, 4 | 128);
  for (let node = tokenWalker.nextNode(); node; node = tokenWalker.nextNode()) {
    if (node.parentElement?.closest('style')) continue;
    collect(node.nodeValue ?? '', node.nodeType === 8 ? 'comment' : `text in <${node.parentElement?.localName ?? '?'}>`);
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (ignored.has(name) || /^\s*data:/i.test(attribute.value)) continue;
      // In an address only the query and fragment can carry a token; its path is the site's own.
      const isUrl = urlAttributes.includes(name) || /^\s*(?:https?:)?\/\//i.test(attribute.value);
      const value = isUrl ? attribute.value.replace(/^[^?#]*/, '').split(/[?&=#]/).join(' ') : attribute.value;
      collect(value, `${attribute.name} on <${element.localName}>`);
    }
  }

  return { counts, found: [...found], tokens: [...tokens].map(([token, where]) => ({ token, where })), notes,
    linkedFrames, frameSrc: { given, refused } };
}

/**
 * The v3 Phase 6/7b review, C10 (see the header): drops each style rule of the frame's <style> elements that no element
 * of the frame matches, read without its dynamic pseudo-classes and its pseudo-elements; a selector the browser cannot
 * read so is kept, and so is every at-rule but a block of rules (@media, @supports, @container, @layer), pruned in turn
 * and dropped once empty. Each sheet is written back from the rules kept. Returns how many rules it kept and dropped.
 * @returns {{ kept: number; dropped: number }}
 */
export function pruneCssInPage() {
  const doc = globalThis.document;
  const view = /** @type {any} */ (doc.defaultView);
  const pseudoElements = /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|cue|file-selector-button|-webkit-[a-z-]+|-moz-[a-z-]+|-ms-[a-z-]+)(?![\w-])/gi;
  const dynamic = /:(?:hover|focus|focus-within|focus-visible|active|visited|link|any-link|checked|disabled|enabled|invalid|valid|user-invalid|user-valid|required|optional|placeholder-shown|indeterminate|default|target|read-only|read-write|autofill|in-range|out-of-range|empty|open|closed|modal|popover-open|fullscreen|defined|playing|paused)(?![\w-])/gi;
  let kept = 0;
  let dropped = 0;
  /** @param {string} selector */
  const used = (selector) => {
    if (/::?(?:slotted|part|host)\b/i.test(selector)) return true;
    let read = selector.replace(pseudoElements, '').replace(dynamic, '').trim();
    if (read === '') return true;
    if (/[>+~]$/.test(read)) read += ' *';
    try {
      return doc.querySelector(read) !== null;
    } catch {
      return true;
    }
  };
  /** @param {any} holder */
  const prune = (holder) => {
    const rules = holder.cssRules;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule instanceof view.CSSStyleRule) {
        if (used(rule.selectorText)) kept += 1;
        else {
          holder.deleteRule(index);
          dropped += 1;
        }
      } else if (rule instanceof view.CSSMediaRule || rule instanceof view.CSSSupportsRule
        || (view.CSSContainerRule && rule instanceof view.CSSContainerRule)
        || (view.CSSLayerBlockRule && rule instanceof view.CSSLayerBlockRule)) {
        prune(rule);
        if (rule.cssRules.length === 0) holder.deleteRule(index);
      } else {
        kept += 1;
      }
    }
  };
  for (const style of doc.querySelectorAll('style')) {
    const sheet = /** @type {HTMLStyleElement} */ (style).sheet;
    if (!sheet) continue;
    const before = dropped;
    try {
      prune(sheet);
    } catch {
      continue;
    }
    if (dropped === before) continue;
    const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
    style.textContent = /<\/style/i.test(text) ? text.replace(/<\/style/gi, '<\\/style') : text;
  }
  return { kept, dropped };
}

// ── snapshot build 2026-11-06 (oracle-sf-sr): shadow roots, and the per-platform redactions ──────────────────────────

/**
 * For SHADOW_ROOT_PLATFORMS (see the header): makes the frame's querySelectorAll and createTreeWalker reach into every
 * open shadow root below the element or document they start from, nested ones included, each root's matches after its
 * tree's own, in the order the roots are found; so transformInPage, measureInPage and rescanInPage read, redact and
 * compare a shadow tree as they do the document. Run once per frame, before the first of them. Answers how many open
 * shadow roots the frame holds.
 * @returns {number}
 */
export function deepenInPage() {
  const view = /** @type {any} */ (globalThis);
  const doc = view.document;
  if (view.__deepened) return view.__deepened.roots(doc).length;
  const all = { doc: view.Document.prototype.querySelectorAll, el: view.Element.prototype.querySelectorAll,
    frag: view.DocumentFragment.prototype.querySelectorAll };
  const walker = view.Document.prototype.createTreeWalker;
  /** The native querySelectorAll of a scope. @param {any} scope @param {string} selector */
  const native = (scope, selector) => (scope.nodeType === 9 ? all.doc : scope.nodeType === 11 ? all.frag : all.el)
    .call(scope, selector);
  /** Every open shadow root below a scope, nested ones included. @param {any} scope @returns {any[]} */
  const roots = (scope) => {
    const found = [];
    const visit = (/** @type {any} */ at) => {
      for (const element of native(at, '*')) {
        if (element.shadowRoot) {
          found.push(element.shadowRoot);
          visit(element.shadowRoot);
        }
      }
    };
    if (scope.shadowRoot) {
      found.push(scope.shadowRoot);
      visit(scope.shadowRoot);
    }
    visit(scope);
    return found;
  };
  /** @this {any} @param {string} selector */
  function deepAll(selector) {
    const found = [...native(this, selector)];
    for (const root of roots(this)) found.push(...all.frag.call(root, selector));
    return found;
  }
  view.Document.prototype.querySelectorAll = deepAll;
  view.Element.prototype.querySelectorAll = deepAll;
  view.DocumentFragment.prototype.querySelectorAll = deepAll;
  /** @this {any} @param {any} root @param {number} what @param {any} filter */
  view.Document.prototype.createTreeWalker = function deepWalker(root, what, filter) {
    /** @type {any[]} */
    const nodes = [];
    for (const scope of [root, ...(root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11 ? roots(root) : [])]) {
      const inner = walker.call(this, scope, what, filter);
      for (let node = inner.nextNode(); node; node = inner.nextNode()) nodes.push(node);
    }
    let at = -1;
    return { nextNode: () => (at + 1 < nodes.length ? nodes[(at += 1)] : null), get currentNode() { return nodes[at] ?? root; } };
  };
  view.__deepened = { roots };
  return roots(doc).length;
}

/** For SHADOW_ROOT_PLATFORMS: the frame's document as text with its open shadow roots written as declarative ones
 *  (<template shadowrootmode="open">), its doctype first if it had one. @returns {string} */
export function serializeDeepInPage() {
  const view = /** @type {any} */ (globalThis);
  const doc = view.document;
  const type = doc.doctype;
  let doctype = '';
  if (type) {
    const ids = type.publicId ? ` PUBLIC "${type.publicId}"${type.systemId ? ` "${type.systemId}"` : ''}`
      : type.systemId ? ` SYSTEM "${type.systemId}"` : '';
    doctype = `<!DOCTYPE ${type.name}${ids}>`;
  }
  const roots = view.__deepened ? view.__deepened.roots(doc) : [];
  const shell = doc.documentElement.cloneNode(false).outerHTML;
  const close = `</${doc.documentElement.localName}>`;
  const inner = doc.documentElement.getHTML({ serializableShadowRoots: false, shadowRoots: roots });
  return JSON.stringify({ doctype, html: `${shell.slice(0, shell.length - close.length)}${inner}${close}` });
}

/**
 * The per-platform redactions (see the header), after transformInPage: each named element's text becomes REDACTED (its
 * box kept), and a chosen answer the page draws on a button or a custom element is unchosen. Answers counts (never
 * values) to add to the frame's own. jr7 TOOLING-7 (jr7-O5): Oracle's profile tiles and its My Applications tiles
 * (`keepApplication`: the captured posting's job id, whose tile stays), counted in `applications` (tiles redacted) and
 * `keptApplications`.
 * @param {{ platform: string; redacted: string; keepApplication?: string }} input
 * @returns {{ widgetText: number; checked: number; typedValues: number; placeholders: number; applications: number;
 *   keptApplications: number }}
 */
export function redactPlatformInPage(input) {
  const doc = globalThis.document;
  const counts = { widgetText: 0, checked: 0, typedValues: 0, placeholders: 0, applications: 0, keptApplications: 0 };
  /** Every non-blank text node inside `element` becomes REDACTED. @param {Element} element */
  const redactText = (element) => {
    const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    let changed = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || node.nodeValue === input.redacted) continue;
      node.nodeValue = input.redacted;
      changed = true;
    }
    if (changed) counts.widgetText += 1;
  };
  if (input.platform === 'oracle') {
    // [iaaxmg.fa.ocs.oraclegovcloud.com] apply/section/1: the Work and Education History timeline's tiles (each title,
    // its employer or school, and the hidden "From <month year> to <month year>"), the attached resume's file name
    // (<button class="attachment-upload-button__download">) and the submission checklist's greeting by first name
    // (<h1 class="standard-apply-flow-dialog__header">, drawn hidden until Submit).
    // The timeline's year axis (<span class="beautiful-timeline__year-title">) is drawn from the applicant's own dates.
    for (const element of doc.querySelectorAll('.beautiful-timeline-item__info, .attachment-upload-button__download, '
      + '.standard-apply-flow-dialog__header, .beautiful-timeline__year-title')) redactText(element);
    for (const element of doc.querySelectorAll('.attachment-upload-button__download[title], .attachment-upload-button__download[aria-label]')) {
      for (const name of ['title', 'aria-label']) if (element.hasAttribute(name)) element.setAttribute(name, input.redacted);
    }
    // The answer pills (<ul role="radiogroup" class="cx-select-pills-container"><button role="radio" aria-checked="true"
    // class="cx-select-pill-section cx-select-pill-section--selected">): every one unchosen.
    for (const pill of doc.querySelectorAll('.cx-select-pill-section')) {
      if (pill.getAttribute('aria-checked') === 'true' || pill.classList.contains('cx-select-pill-section--selected')) {
        counts.checked += 1;
      }
      pill.setAttribute('aria-checked', 'false');
      pill.classList.remove('cx-select-pill-section--selected');
    }
    // jr7 TOOLING-7 (jr7-O5; SP\jr7\audit\oracle.md, snapshot7 oraclecloud1's step 1 filled, captures 4 to 8): the newer
    // layout's profile tiles, <article class="apply-flow-profile-item-tile"><div class="apply-flow-profile-item-tile__summary"
    // aria-label="<the entry's words>"><div class="...__summary-content"><div class="...__summary-title"><span>TITLE</span>
    // </div><div class="...__summary-subtitle">...</div><div class="...__summary-validation">...</div></div>, each an
    // education or work entry or a skill of the person's: the summary's and its parts' text runs and the aria-label and
    // title of each element in them, but the tile's actions (<div class="...__actions-container">: its Edit and Delete
    // buttons, named generically), which stay.
    const actions = '[class*="apply-flow-profile-item-tile__actions"]';
    for (const summary of doc.querySelectorAll('[class*="apply-flow-profile-item-tile__summary"]')) {
      let changed = false;
      const walker = doc.createTreeWalker(summary, 4 /* NodeFilter.SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue?.trim() || node.nodeValue === input.redacted || node.parentElement?.closest(actions)) continue;
        node.nodeValue = input.redacted;
        changed = true;
      }
      for (const element of [summary, ...summary.querySelectorAll('*')]) {
        if (element.closest(actions)) continue;
        for (const name of ['aria-label', 'title']) {
          if ((element.getAttribute(name) ?? '').trim() === '' || element.getAttribute(name) === input.redacted) continue;
          element.setAttribute(name, input.redacted);
          changed = true;
        }
      }
      if (changed) counts.widgetText += 1;
    }
    // jr7 TOOLING-7 (jr7-O5, the verifier's addition; oraclecloud1's confirmation at <site>/my-profile): "My Applications"
    // lists every application the person has, in its active, drafts and resolved containers (<li class="cs-application-tile">,
    // its <a class="cs-job-info__title" href="<site>/job/<id>">): their job-search history. Every tile but the captured
    // posting's (`keepApplication`, --keep-application <job id>: the one its title link names /job/<id>) loses its words,
    // its labels and its links' addresses; with no job named, every tile does.
    for (const tile of doc.querySelectorAll('.cs-application-tile')) {
      const named = input.keepApplication === undefined ? false : [...tile.querySelectorAll('a.cs-job-info__title[href]')]
        .some((link) => new RegExp(`/job/${input.keepApplication}(?:[/?#]|$)`).test(link.getAttribute('href') ?? ''));
      if (named) {
        counts.keptApplications += 1;
        continue;
      }
      redactText(tile);
      for (const element of [tile, ...tile.querySelectorAll('*')]) {
        for (const name of ['aria-label', 'title', 'alt']) {
          if ((element.getAttribute(name) ?? '').trim() !== '') element.setAttribute(name, input.redacted);
        }
        if (element.hasAttribute('href')) element.setAttribute('href', '#');
      }
      counts.applications += 1;
    }
  } else if (input.platform === 'smartrecruiters') {
    // [jobs.smartrecruiters.com] the one-click application: its form elements carry what was typed or chosen in their
    // value attribute (<spl-input ... value>, <spl-phone-field value='{"country":"US"}'>, <spl-radio-group value="0">,
    // <spl-checkbox value="false">); an option's own value (spl-radio, spl-select-option) is kept. A custom element's
    // value is the generic pass's (redactApplicantTextInPage), which keeps a -checkbox element's as an option's: the box's
    // own spl-checkbox value, its chosen state, is cleared here.
    for (const field of doc.querySelectorAll('spl-checkbox[value]')) {
      if ((field.getAttribute('value') ?? '') !== '') counts.typedValues += 1;
      field.setAttribute('value', '');
    }
    // (A chosen spl-radio's or spl-checkbox's aria-checked="true" is the generic pass's, clearChoicesInPage.)
    // The phone field's country list draws a flag per country (<spl-country-flag ...><img class="c-spl-country-flag"
    // width="24" height="18" src="...">, 245 of them, nearly all of the one-click page's weight): each becomes a grey
    // SVG of its own size, as an image over IMAGE_INLINE_MAX does, so its box is unchanged.
    for (const flag of doc.querySelectorAll('img.c-spl-country-flag')) {
      const width = Number(flag.getAttribute('width')) || /** @type {HTMLImageElement} */ (flag).naturalWidth;
      const height = Number(flag.getAttribute('height')) || /** @type {HTMLImageElement} */ (flag).naturalHeight;
      if (!width || !height) continue;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + '<rect width="100%" height="100%" fill="#d0d0d0"/></svg>';
      flag.setAttribute('src', `data:image/svg+xml;base64,${globalThis.btoa(svg)}`);
      counts.placeholders += 1;
    }
    // A select's chosen value as its trigger shows it (<div slot="triggerPrefix" class="c-spl-phone-field-selected">: the
    // phone's country, its flag's alt and code and its dialling code): its words and the attributes that name it.
    for (const chosen of doc.querySelectorAll('[slot="triggerPrefix"]')) {
      redactText(chosen);
      for (const element of [chosen, ...chosen.querySelectorAll('*')]) {
        for (const name of ['alt', 'title', 'aria-label', 'countryisocode', 'label']) {
          if (element.hasAttribute(name) && element.getAttribute(name) !== '') element.setAttribute(name, input.redacted);
        }
      }
    }
    // jr6 (SR-8; snapshot capture 5): the avatar names the person in its firstname and lastname attributes (its text and
    // aria-label are PROFILE_PLACES'), and a drop zone holding a file lists it, its name, size, type and time, in its
    // files JSON: <spl-dropzone files='[{"name":"...","size":...}]'>, an empty one files="[]", which it becomes.
    for (const avatar of doc.querySelectorAll('spl-avatar')) {
      for (const name of ['firstname', 'lastname']) {
        if (!avatar.hasAttribute(name) || ['', input.redacted].includes(avatar.getAttribute(name) ?? '')) continue;
        avatar.setAttribute(name, input.redacted);
        counts.typedValues += 1;
      }
    }
    for (const zone of doc.querySelectorAll('spl-dropzone[files]')) {
      if ((zone.getAttribute('files') ?? '').trim() === '[]') continue;
      zone.setAttribute('files', '[]');
      counts.typedValues += 1;
    }
  }
  return counts;
}

/**
 * jr6 (jobvite-new-2): where the redaction list met the page's own text, as transformInPage noted each place, read once
 * the platform's own redactions ran: an <option> or a role=option, a <label>, a <legend>, or a posting's description
 * (POSTING_TEXT_PLACES). A REDACTED there tells the listed value by elimination (a county among the page's 1950, a town
 * the posting names), so the conversion refuses it until the element is replaced (--replace-text). An option whose
 * whole list ends REDACTED or empty (iCIMS's server-loaded dropdowns, which icimsRedactInPage blanks whole) tells
 * nothing and is left out. Answers how many places of each kind, never a value.
 * jr6 fixes (PRIV-7, REVC-4): an option is any list row (`rows`: LIST_ROWS, as transformInPage noted it: the outermost,
 * through shadow roots' hosts), in its list (`lists`: LISTED_LISTS, the nearest above it, a shadow root's host
 * included), whose rows are read deep (open shadow roots too, where deepenInPage reached them), the outermost ones,
 * the site's own rows (`fixed`: FIXED_ROWS) left out; a row is blank when its words, its shadow roots' included, are
 * REDACTED or nothing (a typed query's results, whose words went whole, are blank). A string argument is the old form
 * (`redacted` alone: native options and role=option in a select, datalist or listbox).
 * @param {string | { redacted: string; rows?: string; fixed?: string; lists?: string }} input
 * @returns {{ option: number; label: number; legend: number; posting: number }}
 */
export function listedPlacesInPage(input) {
  const { redacted, rows = 'option, [role="option" i]', fixed = '', lists = 'select, datalist, [role="listbox" i]' } =
    typeof input === 'string' ? { redacted: input } : input;
  const view = /** @type {any} */ (globalThis);
  /** @type {Array<{ element: Element; kind: 'option' | 'label' | 'legend' | 'posting' }>} */
  const noted = view.__fixtureListed ?? [];
  view.__fixtureListed = [];
  const counts = { option: 0, label: 0, legend: 0, posting: 0 };
  /** A node's words, its open shadow root's included. @param {Node} node @returns {string} */
  const wordsOf = (node) => (node.nodeType === 3 ? node.nodeValue ?? ''
    : [...(/** @type {any} */ (node).shadowRoot?.childNodes ?? []), ...node.childNodes].map(wordsOf).join(' '));
  /** A native placeholder (value="": "Select...") is no candidate either. @param {Element} option */
  const blank = (option) => (option.localName === 'option' && option.getAttribute('value') === '')
    || wordsOf(option).split(redacted).join('').trim() === '';
  /** The element above, a shadow root's host where a shadow root's top stands. @param {Element} element
   *  @returns {Element | null} */
  const up = (element) => element.parentElement
    ?? (element.parentNode?.nodeType === 11 ? /** @type {any} */ (element.parentNode).host ?? null : null);
  /** @param {Element} element @returns {Element | null} */
  const listOf = (element) => {
    for (let at = up(element); at !== null; at = up(at)) if (at.matches(lists)) return at;
    return null;
  };
  /** Whether another row stands above this one (it is read with the outer row). @param {Element} row */
  const nested = (row) => {
    for (let at = up(row); at !== null; at = up(at)) if (at.matches(rows)) return true;
    return false;
  };
  /** @type {Set<Element>} */
  const seen = new Set();
  for (const { element, kind } of noted) {
    if (!element.isConnected || seen.has(element)) continue;
    seen.add(element);
    if (kind === 'option') {
      const list = listOf(element);
      const options = (list === null ? [element] : Array.from(list.querySelectorAll(rows)).filter((row) => !nested(row)))
        .filter((row) => fixed === '' || !row.matches(fixed));
      if (options.every(blank)) continue;
    }
    counts[kind] += 1;
  }
  return counts;
}

// ── jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b, the gap SMARTRECRUITERS P1 found) ──
/**
 * Reads each open list's rows (`rows`: LIST_ROWS, the outermost of nested ones, inside open shadow roots where the
 * platform keeps them) before anything is redacted, on every platform: each row's own words (its text, its shadow
 * roots' included, and its own tree's label attributes' words, three letters or more) and the values its own tree's word
 * attributes give (`words`, `wordData`: ROW_WORD_ATTRIBUTES and ROW_WORD_DATA_SOURCE, and its whole text), kept in the
 * page for redactListRowsInPage and never answered;
 * and the lists that hold a typed query's results: those `typedLists` names (TYPED_LISTS), the popup of each box
 * `typedBoxes` names (TYPED_LIST_BOXES: an input's aria-controls list, an iCIMS select's #<id>_dropdown-results), and
 * the popup of any text box (a text-like input, or a custom element) that is neither read-only nor disabled and holds
 * typed text (its value attribute, or its shadow root's input's): the list its aria-controls, aria-owns or Lit's
 * ariacontrols names, on it or on its role=combobox wrapper, or the list of the row its aria-activedescendant names.
 * Answers how many rows and typed lists it read.
 * @param {{ rows: string[]; typedLists: string[]; typedBoxes: string[]; words: string[]; wordData: string }} input
 * @returns {{ rows: number; typedLists: number }}
 */
export function noteListRowsInPage(input) {
  const doc = globalThis.document;
  const view = /** @type {any} */ (globalThis);
  const wordData = new RegExp(input.wordData, 'i');
  /** An element's parent, across a shadow root to its host. @param {Element} element @returns {Element | null} */
  const parentOf = (element) => element.parentElement ?? /** @type {any} */ (element.parentNode)?.host ?? null;
  const lists = '[role="listbox" i], [role="grid" i], [role="menu" i], [role="tree" i], select, datalist, ul, ol';
  /** The list a row stands in: its nearest ancestor with a list's role or tag, else its parent. @param {Element} row */
  const listOf = (row) => {
    for (let at = parentOf(row); at !== null; at = parentOf(at)) if (at.matches(lists)) return at;
    return parentOf(row);
  };
  /** The words and tokens of a list's own id, class and data- attributes (its structure, which a row's id may repeat:
   *  Greenhouse's react-select-candidate-location-option-0 in react-select-candidate-location-listbox, iCIMS's field id
   *  in result-selectable_-1_PersonProfileFields.<field>_<n> and -1_PersonProfileFields.<field>_dropdown-results),
   *  lower-cased: each letter-and-digit run whole, and its camel-case and letter-digit parts. @param {Element | null} list */
  const structureOf = (list) => {
    if (list === null) return [];
    const text = Array.from(list.attributes).filter((attribute) => ['id', 'class'].includes(attribute.name.toLowerCase())
      || attribute.name.toLowerCase().startsWith('data-')).map((attribute) => attribute.value).join(' ');
    const runs = text.match(/[A-Za-z0-9\u00c0-\u024f]+/g) ?? [];
    const parts = runs.flatMap((run) => run.split(/(?<=[a-z\u00df-\u00ff])(?=[A-Z\u00c0-\u00de])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/));
    return [...new Set([...runs, ...parts].map((token) => token.toLowerCase()))];
  };
  const found = new Set(doc.querySelectorAll(input.rows.join(', ')));
  /** @type {Map<Element, { words: string[]; values: string[]; structure: string[] }>} */
  const records = new Map();
  for (const row of found) {
    let outer = false;
    for (let at = parentOf(row); at !== null && !outer; at = parentOf(at)) outer = found.has(at);
    if (outer) continue;
    /** @type {string[]} */
    const texts = [];
    const walker = doc.createTreeWalker(row, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (text !== '' && !node.parentElement?.closest('style, script')) texts.push(text);
    }
    /** @type {string[]} */
    const labels = [];
    /** @type {string[]} */
    const values = [];
    // The word attributes of the row's own tree (its slotted children's among them); a component's own label inside a
    // shadow root (SmartRecruiters' spl-tooltip, aria-label="Tooltip", in the Wiser capture's City row) is no word of the
    // row's.
    const tree = row.getRootNode();
    for (const element of [row, ...row.querySelectorAll('*')]) {
      if (element.getRootNode() !== tree) continue;
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if ((!input.words.includes(name) && !wordData.test(name)) || value === '' || /^data:/i.test(value)) continue;
        values.push(value);
        if (!['value', 'data-value'].includes(name)) labels.push(value);
      }
    }
    const whole = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (whole !== '') values.push(whole);
    const words = `${texts.join(' ')} ${labels.join(' ')}`.toLowerCase().match(/[a-z\u00c0-\u024f]{3,}/g) ?? [];
    records.set(row, { words: [...new Set(words)], values: [...new Set(values)], structure: structureOf(listOf(row)) });
  }
  /** @type {Set<Element>} */
  const typed = new Set(input.typedLists.length > 0 ? doc.querySelectorAll(input.typedLists.join(', ')) : []);
  /** The element an id names, in `from`'s own tree first. @param {Element} from @param {string} id */
  const byId = (from, id) => {
    const root = /** @type {any} */ (from.getRootNode());
    return (typeof root.getElementById === 'function' ? root.getElementById(id) : null) ?? doc.getElementById(id);
  };
  /** Adds the popups `holder` names by `names`; with `listsOnly`, only an element with a list's role or tag (a text
   *  box's aria-controls may name a region holding a form's own selects). @param {Element} holder
   *  @param {string[]} names @param {boolean} [listsOnly] */
  const named = (holder, names, listsOnly = false) => {
    for (const name of names) {
      for (const id of (holder.getAttribute(name) ?? '').split(/\s+/).filter((each) => each !== '')) {
        const list = byId(holder, id);
        if (list !== null && (!listsOnly || list.matches(lists))) typed.add(list);
      }
    }
  };
  for (const box of input.typedBoxes.length > 0 ? doc.querySelectorAll(input.typedBoxes.join(', ')) : []) {
    if (box.localName === 'select') {
      const list = box.id === '' ? null : doc.getElementById(`${box.id}_dropdown-results`);
      if (list !== null) typed.add(list);
    } else {
      named(box, ['aria-controls', 'aria-owns']);
    }
  }
  const textLike = /^(?:|text|search|email|tel|url)$/;
  for (const box of doc.querySelectorAll('input, [ariacontrols], [ariaautocomplete], [aria-autocomplete]')) {
    if (box.hasAttribute('readonly') || box.hasAttribute('disabled')) continue;
    if (box.localName === 'input' ? !textLike.test((box.getAttribute('type') ?? '').trim().toLowerCase())
      : !box.localName.includes('-') && !box.matches('[role="combobox" i]')) continue;
    const inner = box.shadowRoot ? Array.from(box.shadowRoot.querySelectorAll('input'))[0] ?? null : null;
    if (![box, inner].some((each) => each !== null && (each.getAttribute('value') ?? '').trim() !== '')) continue;
    const wrapper = box.parentElement?.closest('[role="combobox" i]') ?? null;
    for (const holder of wrapper === null ? [box] : [box, wrapper]) {
      named(holder, ['aria-controls', 'aria-owns', 'ariacontrols'], true);
    }
    for (const name of ['aria-activedescendant', 'ariaactivedescendant']) {
      const id = (box.getAttribute(name) ?? '').trim();
      const row = id === '' ? null : byId(box, id);
      const list = row === null ? null : listOf(row);
      if (list !== null) typed.add(list);
    }
  }
  view.__fixtureRows = { records, typed };
  return { rows: records.size, typedLists: typed.size };
}

/**
 * Redacts what names an open list's rows (noteListRowsInPage read them), on every platform, once every other redaction
 * ran (the platform's own included) and before the page is written:
 * - a row of a typed query's list (a noted typed list holds it, or it is a SEARCH_RESULT_PLACES result: `results`),
 *   but the site's own rows (`fixed`: FIXED_ROWS), is a result;
 * - a result, and any row whose text some redaction made REDACTED (a word attribute alone tells nothing: Workday's own
 *   rule blanks every data-automation-label, a browse list's public rows' too), loses its words whole (each text, in
 *   its shadow root too, as SEARCH_RESULT_PLACES' do: a word left beside a REDACTED one still tells part of it; each
 *   text keeps the white space around it) and what names it besides them: each word attribute (`words`, `wordData`:
 *   its value, data-value, label, aria-label, title, ...) becomes REDACTED (one that is REDACTED already but for
 *   Workday's "not checked" or "checked" is kept; inside a shadow root of the row's, only one that repeats the row's
 *   words or held a listed string: a component's own label there stays); each id
 *   attribute (`ids`, `idData`: id, name, href, data-id, data-key, data-sr-id, data-automation-id, ...) is normalised:
 *   each value or whole text the row gave, as written or with its separators changed (SmartRecruiters' location id
 *   spelling the city its words named), each opaque token (five characters or more with three digits, or eight or
 *   more with one: Workday's menuItem-<id>), and each word of the row's own (three letters or more), become REDACTED,
 *   the rest (a structural prefix, a position, and any token or word its list's own id, class or data- attributes
 *   hold: iCIMS's field id) staying; runs of REDACTED become one. A renamed id stays unique (-2, -3, ...) and every
 *   reference to it follows (`references`: ID_REFERENCES, and an href="#<id>").
 * Answers counts, never a value.
 * @param {{ redacted: string; fixed: string[]; results: string[]; words: string[]; wordData: string; ids: string[];
 *   idData: string; references: string[]; wordsKept?: string[] }} input
 * @returns {{ rows: number; words: number; names: number; ids: number }}
 */
export function redactListRowsInPage(input) {
  const doc = globalThis.document;
  const view = /** @type {any} */ (globalThis);
  /** @type {{ records: Map<Element, { words: string[]; values: string[]; structure: string[] }>; typed: Set<Element> }} */
  const { records, typed } = view.__fixtureRows ?? { records: new Map(), typed: new Set() };
  view.__fixtureRows = undefined;
  const { redacted } = input;
  const counts = { rows: 0, words: 0, names: 0, ids: 0 };
  const wordData = new RegExp(input.wordData, 'i');
  const idData = new RegExp(input.idData, 'i');
  const char = 'A-Za-z0-9\\u00C0-\\u024F';
  const wordChar = new RegExp(`^[${char}]$`);
  /** respelledEdge's rule (written again: this runs in the page). @param {string} text @param {number} at */
  const edge = (text, at) => {
    if (at <= 0 || at >= text.length) return true;
    const before = text[at - 1] ?? '';
    const after = text[at] ?? '';
    if (!wordChar.test(before) || !wordChar.test(after)) return true;
    if (/\d/.test(before) !== /\d/.test(after)) return true;
    return before !== before.toUpperCase() && after !== after.toLowerCase();
  };
  /** @param {string} text */
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** An element's parent, across a shadow root to its host. @param {Element} element @returns {Element | null} */
  const parentOf = (element) => element.parentElement ?? /** @type {any} */ (element.parentNode)?.host ?? null;
  /** Whether a word attribute still says something besides REDACTED (and the state Workday's rows add to it).
   *  @param {string} value */
  const says = (value) => {
    const rest = value.split(redacted).join(' ');
    return rest.trim() !== '' && !(value.includes(redacted) && /^(?:\s|not|checked)*$/i.test(rest));
  };
  /** An id with what names its row made REDACTED (see above). jr6 PRIVACY-FIX: `wordsToo` false (ROW_ID_WORDS_KEPT:
   *  Workday's data-automation-id) leaves the row's own words alone there, its values and opaque tokens still taken.
   *  @param {string} value @param {{ words: string[]; values: string[]; structure: string[] }} record
   *  @param {boolean} [wordsToo] */
  const normalise = (value, record, wordsToo = true) => {
    let out = value;
    for (const given of [...record.values].sort((a, b) => b.length - a.length)) {
      const runs = given.match(new RegExp(`[${char}]+`, 'g')) ?? [];
      if (runs.join('').length < 2) continue;
      const pattern = new RegExp(runs.map(escape).join(`(?:[^${char}]|%[0-9A-Fa-f]{2}){0,4}`), 'gi');
      /** @type {Array<[number, number]>} */
      const spans = [];
      for (let match = pattern.exec(out); match !== null; match = pattern.exec(out)) {
        const end = match.index + match[0].length;
        if (match[0] !== '' && edge(out, match.index) && edge(out, end)) {
          spans.push([match.index, end]);
          pattern.lastIndex = end;
        } else {
          pattern.lastIndex = match.index + 1;
        }
      }
      for (const [start, end] of spans.reverse()) out = `${out.slice(0, start)}${redacted}${out.slice(end)}`;
    }
    // The row's own words and opaque tokens, but its list's (a structural word or id the row's id repeats: "location"
    // in Greenhouse's react-select-candidate-location-option-0 when a result's words hold it too, iCIMS's field id).
    const structure = new Set(record.structure);
    const words = new Set(record.words.filter((word) => !structure.has(word)));
    out = out.replace(new RegExp(`[${char}]+`, 'g'), (run) => {
      if (run === redacted || structure.has(run.toLowerCase())) return run;
      // An opaque token: five characters or more with three digits, or eight or more with one (a database or Workday
      // id); a design token such as "body1" is no row's name.
      const digits = run.replace(/\D/g, '').length;
      if ((run.length >= 5 && digits >= 3) || (run.length >= 8 && digits >= 1)) return redacted;
      if (!wordsToo) return run;
      return run.split(/(?<=[a-z\u00df-\u00ff])(?=[A-Z\u00c0-\u00de])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)
        .map((part) => (words.has(part.toLowerCase()) ? redacted : part)).join('');
    });
    return out.replace(new RegExp(`${redacted}(?:[^${char}]{0,3}${redacted})+`, 'g'), redacted);
  };
  const fixed = input.fixed.length > 0 ? input.fixed.join(', ') : '';
  const results = input.results.length > 0 ? input.results.join(', ') : '';
  /** @type {Set<string>} */
  const taken = new Set(Array.from(doc.querySelectorAll('[id]'), (element) => element.id));
  /** @type {Map<string, string>} */
  const renamed = new Map();
  for (const [row, record] of records) {
    if (!row.isConnected) continue;
    let inTyped = results !== '' && row.matches(results);
    for (let at = /** @type {Element | null} */ (row); at !== null && !inTyped; at = parentOf(at)) inTyped = typed.has(at);
    if (inTyped && fixed !== '' && row.matches(fixed)) continue;
    const elements = [row, ...row.querySelectorAll('*')];
    // Its words went where its text did (Workday's own rule blanks every data-automation-label, a browse list's public
    // rows' too, so a word attribute alone tells nothing).
    let wordsGone = inTyped;
    const seen = doc.createTreeWalker(row, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = seen.nextNode(); node && !wordsGone; node = seen.nextNode()) {
      wordsGone = (node.nodeValue ?? '').includes(redacted) && !node.parentElement?.closest('style');
    }
    if (!wordsGone) continue;
    counts.rows += 1;
    // A result's words go whole, and so do a row's words left beside a REDACTED one ("REDACTED, NJ" still tells part),
    // each text keeping the white space around it.
    const walker = doc.createTreeWalker(row, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      if (text.trim() === '' || text.trim() === redacted || node.parentElement?.closest('style')) continue;
      node.nodeValue = text.replace(/\S(?:[\s\S]*\S)?/, redacted);
      counts.words += 1;
    }
    const tree = row.getRootNode();
    const words = new Set(record.words);
    for (const element of elements) {
      // A word attribute inside a shadow root of the row's goes where it repeats the row's words or held a listed one;
      // a component's own label there (spl-tooltip's "Tooltip") stays.
      const own = element.getRootNode() === tree;
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (value.trim() === '' || /^\s*data:/i.test(value)) continue;
        if (input.words.includes(name) || wordData.test(name)) {
          if (!says(value)) continue;
          if (!own && !value.includes(redacted)
            && !(value.toLowerCase().match(/[a-zÀ-ɏ]{3,}/g) ?? []).some((word) => words.has(word))) continue;
          element.setAttribute(attribute.name, redacted);
          counts.names += 1;
        } else if ((input.ids.includes(name) || idData.test(name)) && !(name === 'href' && value.trim().startsWith('#'))) {
          let next = normalise(value, record, !(input.wordsKept ?? []).includes(name));
          if (next === value) continue;
          if (name === 'id') {
            let unique = next;
            for (let n = 2; taken.has(unique); n += 1) unique = `${next}-${n}`;
            next = unique;
            taken.add(next);
            renamed.set(value, next);
          }
          element.setAttribute(attribute.name, next);
          counts.ids += 1;
        }
      }
    }
  }
  if (renamed.size > 0) {
    for (const element of doc.querySelectorAll('*')) {
      for (const name of input.references) {
        const value = element.getAttribute(name);
        if (value === null) continue;
        const next = value.split(/(\s+)/).map((token) => renamed.get(token) ?? token).join('');
        if (next !== value) element.setAttribute(name, next);
      }
      const href = element.getAttribute('href');
      if (href !== null && href.startsWith('#') && renamed.has(href.slice(1))) {
        element.setAttribute('href', `#${renamed.get(href.slice(1))}`);
      }
    }
  }
  return counts;
}
// ── end jr6 round 2 ──

/**
 * jr6 (JV-10): the option rows of each choice group CHOICE_ROWS names, compared once every mark is cleared: in one
 * group every row's shape (its tags and attributes, nested, read without text and comments, digits read alike) must be
 * the same; a row that reads apart still tells the chosen option, by a mark CHOSEN_MARKS does not know. The attributes
 * that name the option itself (id, for, name, value, aria-labelledby, aria-describedby, aria-controls, aria-label,
 * title) are left out. jr6 fixes (PRIV-2, REVC-4): they, the other attributes a row names itself by (`own`, `ownData`:
 * CHOICE_ROW_INPUT) and an entry's `own` attributes of the row element itself are read by their presence alone (a name
 * on the chosen row alone tells it: SmartRecruiters' spl-radio); a row's shadow root is read before its children (ADP's
 * chosen sdf-radio-button and sdf-select-item draw their marks there); a class that only says where a row stands
 * (…-first, …-last, …-only) reads alike; the first row's roving tab stop (tabindex="0") reads as its siblings' tabindex,
 * an unanswered group's own, so the tab stop counts in the shape; the site's own rows (`fixed`: FIXED_ROWS) are left out.
 * jr7 TOOLING-7 (r2): and a roving tab stop on an element of the first row's own tree (a `roving` role's, inside its
 * shadow roots too: SmartRecruiters' div[role=option] in spl-dropdown-item's) reads as the tabindex its siblings' such
 * elements most often hold: the stop an unanswered list draws on its first row (snapshot7 smartrecruiter1's
 * Race/Ethnicity list: the first row "active" with tabindex="0", the chosen row elsewhere), which clearChoicesInPage
 * moves there from any other row and chosenMarksIn refuses anywhere else.
 * Answers, per entry, how many groups it read and how many held rows apart; never a value.
 * @param {{ rows: Array<{ group: string; row: string; own?: string[] }>; own?: string[]; ownData?: string[];
 *   fixed?: string; roving?: string[] }} input
 * @returns {Array<{ groups: number; uneven: number }>}
 */
export function unevenChoiceRowsInPage(input) {
  const doc = globalThis.document;
  const own = new Set(['id', 'for', 'name', 'value', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-label',
    'title', ...(input.own ?? [])]);
  const ownData = (input.ownData ?? []).map((source) => new RegExp(source, 'i'));
  const position = /(?:^|[-_])(?:first|last|only)(?:-(?:child|of-type))?$/i;
  const rovingRoles = input.roving ?? [];
  /** Whether an element is a roving row (by its role's first word). @param {Element} element */
  const isRoving = (element) => rovingRoles.includes((element.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '');
  /** @param {Element} element @param {string[]} named the row element's own attributes (CHOICE_ROWS' `own`)
   *  @param {string | null | undefined} stop the first row's tabindex read as its siblings' (null: none)
   *  @param {string | null | undefined} inner jr7 TOOLING-7 (r2): the first row's inner roving stop read as its
   *  siblings' (null: none) @returns {string} */
  const shape = (element, named = [], stop = undefined, inner = undefined, top = true) => {
    // (The row element's own stop is `stop`'s; `inner` reads its descendants', shadow roots' included.)
    const innerStop = !top && inner !== undefined && isRoving(element) && element.getAttribute('tabindex')?.trim() === '0';
    const attributes = Array.from(element.attributes).flatMap((attribute) => {
      const name = attribute.name.toLowerCase();
      if (own.has(name) || named.includes(name) || ownData.some((pattern) => pattern.test(name))) return [name];
      if (name === 'tabindex' && (stop === null || (innerStop && inner === null))) return [];
      const value = name === 'tabindex' && stop !== undefined && stop !== null ? stop
        : name === 'tabindex' && innerStop && inner !== undefined && inner !== null ? inner
          : name === 'class' ? attribute.value.split(/\s+/).filter((token) => token !== '' && !position.test(token)).sort().join(' ')
            : attribute.value;
      return [`${name}=${value.replace(/\d+/g, '#')}`];
    }).sort().join(' ');
    const children = [...Array.from(element.shadowRoot?.children ?? []), ...Array.from(element.children)];
    return `<${element.localName} ${attributes}>${children.map((child) => shape(child, [], undefined, inner, false)).join('')}</>`;
  };
  /** jr7 TOOLING-7 (r2): the tabindex the roving elements inside rows' own trees (but the first row's) most often hold
   *  (null: none), or undefined where those trees hold no roving element. @param {Element[]} rows
   *  @returns {string | null | undefined} */
  const innerCommonOf = (rows) => {
    /** @type {Map<string | null, number>} */
    const tally = new Map();
    /** @param {Element} element */
    const visit = (element) => {
      if (isRoving(element)) {
        const value = element.getAttribute('tabindex')?.trim() ?? null;
        tally.set(value, (tally.get(value) ?? 0) + 1);
      }
      for (const child of [...Array.from(element.shadowRoot?.children ?? []), ...Array.from(element.children)]) visit(child);
    };
    for (const row of rows.slice(1)) {
      for (const child of [...Array.from(row.shadowRoot?.children ?? []), ...Array.from(row.children)]) visit(child);
    }
    if (tally.size === 0) return undefined;
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return input.rows.map(({ group, row, own: named = [] }) => {
    let groups = 0;
    let uneven = 0;
    for (const holder of doc.querySelectorAll(group)) {
      const rows = Array.from(holder.querySelectorAll(row))
        .filter((each) => input.fixed === undefined || input.fixed === '' || !each.matches(input.fixed));
      if (rows.length < 2) continue;
      groups += 1;
      // The siblings' most common tabindex (null: none), which an unanswered group's first row would read as.
      /** @type {Map<string | null, number>} */
      const tally = new Map();
      for (const each of rows.slice(1)) {
        const value = each.getAttribute('tabindex')?.trim() ?? null;
        tally.set(value, (tally.get(value) ?? 0) + 1);
      }
      const common = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const first = rows[0]?.getAttribute('tabindex')?.trim() === '0' ? common : undefined;
      // jr7 TOOLING-7 (r2): the first row's inner roving stop, read as its siblings' inner roving elements' tabindex.
      const inner = rovingRoles.length > 0 ? innerCommonOf(rows) : undefined;
      if (new Set(rows.map((each, at) => shape(each, named, at === 0 ? first : undefined, at === 0 ? inner : undefined)))
        .size > 1) uneven += 1;
    }
    return { groups, uneven };
  });
}

/**
 * jr6 (jobvite-new-2): --replace-text, run before anything is measured: every element each replacement's selector names
 * gets that replacement's synthetic text (see the header): a select's options become one per non-blank line (a first
 * option whose value is empty, its placeholder, kept before them); a meta element's content becomes the text's lines
 * on one line; an element holding no form control keeps only the text; any other element keeps its controls, its first
 * text run taking the text and its other runs emptied. Its title, aria-label and label, and an option's or an input's
 * value, where present, take the text's first line.
 * jr6 PRIVACY-FIX: a replacement with an `attribute` (--replace-text '<css>@<attribute>=<file>') rewrites only that
 * attribute's JSON copy of the posting (`copies`: POSTING_COPY_ATTRIBUTES) on each element the selector names: each
 * title field takes the text's first line, each description field its other lines (all of them if it has one); the
 * copy's other fields and the element itself are left as they are. It counts the elements whose copy it rewrote.
 * Answers how many elements each replacement took, in order: -1 for a selector the page cannot read.
 * @param {{ replacements: Array<{ selector: string; text: string; attribute?: string }>;
 *   copies?: Array<{ attribute: string; title: string[]; description: string[] }> }} input
 * @returns {number[]}
 */
export function replaceTextInPage(input) {
  const doc = globalThis.document;
  const controls = 'input, select, textarea, button';
  return input.replacements.map(({ selector, text, attribute }) => {
    /** @type {Element[]} */
    let elements;
    try {
      elements = Array.from(doc.querySelectorAll(selector));
    } catch {
      return -1;
    }
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const first = lines[0] ?? '';
    if (attribute !== undefined) {
      const copy = (input.copies ?? []).find((each) => each.attribute === attribute);
      if (copy === undefined) return -1;
      const rest = lines.length > 1 ? lines.slice(1).join(' ') : first;
      let rewritten = 0;
      for (const element of elements) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        /** @type {any} */
        let data;
        try {
          data = JSON.parse(value);
        } catch {
          continue;
        }
        if (data === null || typeof data !== 'object' || Array.isArray(data)) continue;
        for (const field of copy.title) if (typeof data[field] === 'string') data[field] = first;
        for (const field of copy.description) if (typeof data[field] === 'string') data[field] = rest;
        element.setAttribute(attribute, JSON.stringify(data));
        rewritten += 1;
      }
      return rewritten;
    }
    for (const element of elements) {
      // A meta element's words are its content (a description copied into the page's metadata), on one line.
      if (element.localName === 'meta') {
        element.setAttribute('content', lines.join(' '));
        continue;
      }
      if (element.localName === 'select') {
        const placeholder = element.querySelector('option');
        const kept = placeholder !== null && placeholder.getAttribute('value') === '' ? [placeholder] : [];
        element.replaceChildren(...kept, ...lines.map((line) => {
          const option = doc.createElement('option');
          option.setAttribute('value', line);
          option.textContent = line;
          return option;
        }));
        continue;
      }
      if (element.querySelectorAll(controls).length === 0) {
        element.replaceChildren(doc.createTextNode(text));
      } else {
        const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
        /** @type {Node[]} */
        const runs = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeValue?.trim() && !node.parentElement?.closest('style, script, select, textarea')) runs.push(node);
        }
        runs.forEach((node, index) => {
          node.nodeValue = index === 0 ? text : '';
        });
        if (runs.length === 0) element.append(doc.createTextNode(text));
      }
      for (const name of ['title', 'aria-label', 'label']) if (element.hasAttribute(name)) element.setAttribute(name, first);
      if (['option', 'input'].includes(element.localName) && element.hasAttribute('value')) {
        element.setAttribute('value', first);
      }
    }
    return elements.length;
  });
}

/** The frame's document as text: its doctype, if it had one, then the root element. @returns {string} */
export function serializeInPage() {
  const doc = globalThis.document;
  const type = doc.doctype;
  let doctype = '';
  if (type) {
    const ids = type.publicId ? ` PUBLIC "${type.publicId}"${type.systemId ? ` "${type.systemId}"` : ''}`
      : type.systemId ? ` SYSTEM "${type.systemId}"` : '';
    doctype = `<!DOCTYPE ${type.name}${ids}>`;
  }
  return JSON.stringify({ doctype, html: doc.documentElement.outerHTML });
}

/**
 * Searches the loaded fixture the way the redaction did: text, comments and attributes, for emails, phone numbers and
 * the listed strings, and the file names the page showed (redactApplicantTextInPage). Returns how many of each it found,
 * never the values.
 * @param {{ redact: string[]; email: string; notEmail: string; phone: string;
 *   phoneDigits: { min: number; minWithPlus: number; max: number }; phoneAttributes: string[]; found: string[];
 *   fileNames?: string[] }} input
 */
export function rescanInPage(input) {
  const doc = globalThis.document;
  const listed = input.redact.map((source) => new RegExp(source, 'i'));
  const email = new RegExp(input.email, 'g');
  const notEmail = new RegExp(input.notEmail, 'i');
  const phone = new RegExp(input.phone, 'g');
  const foundEmails = input.found.filter((text) => text.includes('@')).map((text) => text.toLowerCase());
  const foundPhones = input.found.filter((text) => !text.includes('@'));
  const hits = { emails: 0, phones: 0, listed: 0, found: 0 };
  /** @param {string} text @param {boolean} phones */
  const check = (text, phones) => {
    if (listed.some((pattern) => pattern.test(text))) hits.listed += 1;
    if ((input.fileNames ?? []).some((name) => text.includes(name))) hits.found += 1;
    const lower = text.toLowerCase();
    if (foundEmails.some((value) => lower.includes(value)) || (phones && foundPhones.some((value) => text.includes(value)))) {
      hits.found += 1;
    }
    for (const match of text.matchAll(email)) if (!notEmail.test(match[0])) hits.emails += 1;
    if (!phones) return;
    for (const match of text.matchAll(phone)) {
      const digits = match[0].replace(/\D/g, '').length;
      const min = match[0].trimStart().startsWith('+') ? input.phoneDigits.minWithPlus : input.phoneDigits.min;
      if (digits >= min && digits <= input.phoneDigits.max) hits.phones += 1;
    }
  };
  const walker = doc.createTreeWalker(doc, 4 | 128);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3 && node.parentElement?.closest('style')) continue;
    check(node.nodeValue ?? '', true);
  }
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^\s*data:/i.test(attribute.value)) continue;
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      check(attribute.value, input.phoneAttributes.includes(name) || name.startsWith('data-') ||
        (name === 'href' && (value.startsWith('tel:') || value.startsWith('sms:'))));
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks on the written text
// ---------------------------------------------------------------------------------------------------------------------

/** Decodes the HTML entities a serializer writes (named basics and numeric). @param {string} text */
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    const lower = String(name).toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return /** @type {Record<string, string>} */ (named)[lower] ?? match;
  });
}

/** Percent-decodes every %XX run that decodes as UTF-8, leaving the rest. @param {string} text */
function decodePercents(text) {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The written text as the final check reads it: base64 payloads and the inlined stylesheets (page assets, not page
 * text) masked out, then the text as written, with entities decoded, and percent-decoded, all in lower case.
 * @param {string} text @returns {string[]}
 */
export function checkedForms(text) {
  const masked = text
    .replace(/(data:[^,"'\s)]*;base64,)[A-Za-z0-9+/=\s]+/gi, '$1')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
  const entities = decodeEntities(masked);
  return [masked, entities, decodePercents(entities)].map((form) => form.toLowerCase());
}

/**
 * jr7 TOOLING-7 (the jr6 leftover, SP\jr6\build\INT-2.md §6 item 3: "inlined stylesheets are never checked"): the
 * written file's inlined stylesheets, which checkedForms masks as page assets, as the final check reads them for the
 * needles no stylesheet may hold either (tokenNeedles: jr_id, another extension's parameter or UI, a per-load token, a
 * sign-in token, a JWT; referralNeedles: a referral parameter's value): each <style>'s text (a declarative shadow root's
 * too) with base64 payloads masked, as written and percent-decoded, in lower case. (The listed strings are not read
 * here: a page's own class names and icon rules may spell a listed word, which leakcount and the leak gate judge.)
 * redactReferralParams already runs over the whole written text, a stylesheet's included (an injected content blocker's
 * filter list spells link addresses with their utm_ tags: INT-2 §4), so this check proves it ran.
 * @param {string} text @returns {string[]}
 */
export function checkedStyleForms(text) {
  const styles = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => (match[1] ?? '').replace(/(data:[^,"'\s)]*;base64,)[A-Za-z0-9+/=\s]+/gi, '$1'));
  return styles.flatMap((style) => [style, decodePercents(style)]).map((form) => form.toLowerCase());
}

// ── snapshot build 2026-11-06 (core pass Z1, item 38): the token checks, one list for the conversion and the sweep ──
/**
 * The final check's needles that read no owner's list: Jobright's jr_id anywhere (DESIGN-NEW-ATS §6.4, §6.5); and (the
 * snapshot build of 2026-11-06, every platform) no other extension's parameter or UI and no per-load token
 * (INJECTED_PARAMS, after any separator, plain or percent-encoded; INJECTED_UI's ids; PER_LOAD_PARAMS, whose value must
 * be REDACTED and nothing after it: a token's percent-encoded padding left behind is refused), no sign-in token
 * (SIGN_IN_TOKEN_SOURCES) and no JWT under any name. Each is read over checkedForms' forms. The conversion adds the
 * owner's strings, the emails and the file names it found; test/mhtml-to-fixture.test.ts sweeps every committed
 * fixture with these. @returns {Array<{ label: string; pattern: RegExp }>}
 */
export function tokenNeedles() {
  return [
    { label: 'jr_id', pattern: /jr_id/i },
    { label: 'another extension\'s parameter', pattern: new RegExp(`(?:[?&;]|%3F|%26)(?:${INJECTED_PARAMS.map((entry) => {
      const [name = '', value] = entry.split('=');
      return `${escapeSource(name)}(?:=|%3D)${value === undefined ? '' : `${escapeSource(value)}(?![\\w-])`}`;
    }).join('|')})`, 'i') },
    { label: 'another extension\'s UI',
      pattern: new RegExp(INJECTED_UI.map((selector) => escapeSource(selector.split('#').pop() ?? selector)).join('|'), 'i') },
    // (checkedForms lower-cases what it decodes, so REDACTED is compared in any case.)
    { label: 'a per-load token', pattern: new RegExp(`[?&;](?:${PER_LOAD_PARAMS.join('|')})=(?!${REDACTED}(?:[&#"'\\s<]|$))`, 'i') },
    // Every platform: no sign-in token (SIGN_IN_TOKEN_SOURCES), plain or percent-encoded.
    { label: 'a sign-in token', pattern: new RegExp(`(?:[?&;#]|%3F|%26|%23)id_token(?:=|%3D)(?!${REDACTED}(?![\\w.-]))`
      + `|silent-callback\\.html(?:\\?|%3F)code(?:=|%3D)(?!${REDACTED}(?![\\w-]))`, 'i') },
    // Every platform: no JWT under any name (its header and claims base64url JSON, each starting "eyJ": UltiPro's
    // id_token named the account in its claims), outside an inlined image or stylesheet.
    { label: 'a JWT', pattern: /(?<![\w-])eyj[\w-]{8,}\.eyj[\w-]{8,}\./i },
  ];
}
// ── end core pass Z1, item 38 ──

/**
 * jr6 fixes (PRIV-4): the final check's needle for a referral parameter (REFERRAL_PARAMS, REFERRAL_PREFIXES) whose value
 * is not REDACTED, read over checkedForms' forms (so percent-encoded once too). Only a conversion reads it: committed
 * fixtures converted before it carry public links' utm_* values (a company's footer), which the sweep leaves alone.
 * @returns {Array<{ label: string; pattern: RegExp }>}
 */
export function referralNeedles() {
  const names = [...REFERRAL_PARAMS.map(escapeSource), ...REFERRAL_PREFIXES.map((prefix) => `${escapeSource(prefix)}[a-z0-9_]+`)];
  return [{ label: 'a referral-source parameter',
    pattern: new RegExp(`[?&;](?:${names.join('|')})=(?!${REDACTED}(?:[&#"'\\s<]|$))(?=[^&#"'\\s<])`, 'i') }];
}

// ── The security fix of 2026-11-06 (S2, S3, S10): the chosen marks a written fixture may not hold ──
/** The attributes of a start tag's text: name (lower case) to value, entities as written (none of the checks need them
 *  decoded). @param {string} text @returns {Map<string, string>} */
function attributesOf(text) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  for (const [, name = '', double, single, bare] of text.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(name.toLowerCase(), double ?? single ?? bare ?? '');
  }
  return attributes;
}

/** Elements that hold nothing a closing tag ends. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track',
  'wbr', 'param', 'keygen']);

/**
 * jr6 fixes (PRIV-2, REVC-4): a written file's elements in order, read from its markup (stylesheets, scripts and comments
 * aside), for the checks that need to know what holds what: each element's tag, its attributes (names in lower case,
 * values as written), the element it stands in (`parent`, -1 for none; a declarative shadow root's top elements stand in
 * its host, as the page draws them and clearChoicesInPage reads them), the last element inside it (`end`: its
 * descendants are the elements after it up to there), and the text written directly inside it (`text`, entities
 * decoded).
 * @param {string} text
 * @returns {Array<{ tag: string; attributes: Map<string, string>; parent: number; end: number; text: string }>}
 */
export function markupElements(text) {
  const markup = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  /** @type {Array<{ tag: string; attributes: Map<string, string>; parent: number; end: number; text: string }>} */
  const nodes = [];
  /** The open elements, outermost first. @type {number[]} */
  const open = [];
  /** Closes the open elements from `at` on. @param {number} at */
  const close = (at) => {
    for (const index of open.splice(at)) {
      const node = nodes[index];
      if (node !== undefined) node.end = nodes.length - 1;
    }
  };
  for (const [whole, slash, name = '', rest = '', run] of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s[^<>]*?)?)\/?>|([^<]+)/g)) {
    if (run !== undefined) {
      const holder = nodes[open.at(-1) ?? -1];
      if (holder !== undefined) holder.text += decodeEntities(run);
      continue;
    }
    const tag = name.toLowerCase();
    if (slash === '/') {
      const at = open.findLastIndex((index) => nodes[index]?.tag === tag);
      if (at >= 0) close(at);
      continue;
    }
    const holderAt = open.at(-1) ?? -1;
    const holder = nodes[holderAt];
    const parent = holder !== undefined && holder.tag === 'template' && holder.attributes.has('shadowrootmode')
      ? holder.parent : holderAt;
    nodes.push({ tag, attributes: attributesOf(rest), parent, end: nodes.length, text: '' });
    if (!VOID_TAGS.has(tag) && !whole.endsWith('/>')) open.push(nodes.length - 1);
  }
  close(0);
  return nodes;
}

/** A simple selector list (LIST_ROWS, LISTED_LISTS, FIXED_ROWS: tags, roles, classes and one [attr="value"]) read as
 *  tests over markupElements' nodes. @param {string[]} selectors */
const markupMatcher = (selectors) => {
  const tests = selectors.map((selector) => {
    const role = /^\[role="([\w-]+)"(?: i)?\]$/.exec(selector)?.[1];
    if (role !== undefined) return (/** @type {{ tag: string; attributes: Map<string, string> }} */ node) =>
      (node.attributes.get('role') ?? '').trim().toLowerCase().split(/\s+/)[0] === role;
    const className = /^\.([\w-]+)$/.exec(selector)?.[1];
    if (className !== undefined) return (/** @type {{ tag: string; attributes: Map<string, string> }} */ node) =>
      (node.attributes.get('class') ?? '').split(/\s+/).includes(className);
    const [, tag = '', name, value] = /^([\w-]+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(selector) ?? [];
    return (/** @type {{ tag: string; attributes: Map<string, string> }} */ node) => node.tag === tag
      && (name === undefined || decodeEntities(node.attributes.get(name) ?? '') === value);
  });
  return (/** @type {{ tag: string; attributes: Map<string, string> }} */ node) => tests.some((test) => test(node));
};

/**
 * jr6 fixes (REVC-4 b): the lists of a written file (LISTED_LISTS) that hold a row (LIST_ROWS, the outermost, the site's
 * own FIXED_ROWS aside) whose words hold REDACTED beside a row whose words are public: the REDACTED row tells the
 * listed value by elimination (UltiPro's field-of-study select of 270 options, one REDACTED). A list whose rows all read
 * REDACTED, nothing or a native placeholder (a typed query's results, iCIMS's blanked dropdowns, UltiPro's résumé
 * picker: its REDACTED file and "Select") tells nothing. Read over markupElements
 * (declarative shadow roots included); the committed-fixture sweep reads it. Answers how many such lists, never a row.
 * @param {string} text @returns {number}
 */
export function eliminatedListsIn(text) {
  const nodes = markupElements(text);
  const isRow = markupMatcher(LIST_ROWS);
  const isList = markupMatcher(LISTED_LISTS.split(/,\s*/));
  const isFixed = markupMatcher(FIXED_ROWS);
  /** @param {number} at */
  const above = (at) => nodes[at]?.parent ?? -1;
  /** @type {Map<number, { redacted: number; public: number }>} */
  const lists = new Map();
  for (const [at, node] of nodes.entries()) {
    if (!isRow(node) || isFixed(node)) continue;
    let list = -1;
    let nested = false;
    for (let up = above(at); up >= 0; up = above(up)) {
      const holder = nodes[up];
      if (holder === undefined) break;
      if (isRow(holder)) nested = true;
      if (isList(holder)) {
        list = up;
        break;
      }
    }
    if (nested || list < 0) continue;
    const words = nodes.slice(at, node.end + 1).map((each) => each.text).join(' ');
    const tally = lists.get(list) ?? { redacted: 0, public: 0 };
    // A native placeholder (value="": "Select...") is no candidate.
    const placeholder = node.tag === 'option' && node.attributes.has('value')
      && decodeEntities(node.attributes.get('value') ?? '') === '';
    if (words.includes(REDACTED)) tally.redacted += 1;
    else if (words.trim() !== '' && !placeholder) tally.public += 1;
    lists.set(list, tally);
  }
  return [...lists.values()].filter((tally) => tally.redacted > 0 && tally.public > 0).length;
}

/**
 * jr6 fixes (PRIV-2 a, REVC-4): the widgets of a written file whose roving tab stop stands on a row but their first
 * (clearChoicesInPage's rule, read back over markupElements): their rows (ROVING_ROLES, ROVING_TAGS), each in its
 * ROVING_GROUP_ROLES or ROVING_GROUP_TAGS widget, else in its nearest ancestor holding another row of its kind; one row
 * with tabindex="0", not the first, every other "-1" or none. Answers each such widget's row kind, never which row.
 * @param {ReturnType<typeof markupElements>} nodes @returns {string[]}
 */
function rovingStopsOffFirst(nodes) {
  /** @param {number} at */
  const roleOf = (at) => (nodes[at]?.attributes.get('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  /** A row's kind (its role, else its tag), or null for no row. @param {number} at */
  const kindOf = (at) => {
    const role = roleOf(at);
    const tag = nodes[at]?.tag ?? '';
    return ROVING_ROLES.includes(role) ? role : ROVING_TAGS.includes(tag) ? tag : null;
  };
  /** @param {number} at */
  const isWidget = (at) => ROVING_GROUP_ROLES.includes(roleOf(at)) || ROVING_GROUP_TAGS.includes(nodes[at]?.tag ?? '');
  /** @param {number} at */
  const stopOf = (at) => nodes[at]?.attributes.get('tabindex')?.trim() ?? null;
  /** @param {number} at */
  const parentOf = (at) => nodes[at]?.parent ?? -1;
  const rows = nodes.flatMap((_node, at) => (kindOf(at) === null ? [] : [at]));
  if (!rows.some((at) => stopOf(at) === '0')) return [];
  /** How many rows of each kind each ancestor holds, up to the rows' widget. @type {Map<string, number>} */
  const held = new Map();
  for (const at of rows) {
    const kind = kindOf(at);
    for (let up = parentOf(at); up >= 0; up = parentOf(up)) {
      held.set(`${up} ${kind}`, (held.get(`${up} ${kind}`) ?? 0) + 1);
      if (isWidget(up)) break;
    }
  }
  /** Each widget's rows of one kind, in order. @type {Map<string, number[]>} */
  const widgets = new Map();
  for (const at of rows) {
    const kind = kindOf(at);
    let widget = -1;
    for (let up = parentOf(at); up >= 0 && widget < 0; up = parentOf(up)) {
      if (isWidget(up) || (held.get(`${up} ${kind}`) ?? 0) >= 2) widget = up;
    }
    if (widget < 0) continue;
    const members = widgets.get(`${widget} ${kind}`) ?? [];
    members.push(at);
    widgets.set(`${widget} ${kind}`, members);
  }
  /** @type {Set<string>} */
  const found = new Set();
  for (const [key, members] of widgets) {
    const stops = members.flatMap((at, index) => (stopOf(at) === '0' ? [index] : []));
    if (members.length < 2 || stops.length !== 1 || stops[0] === 0) continue;
    if (!members.every((at, index) => index === stops[0] || [null, '-1'].includes(stopOf(at)))) continue;
    found.add(key.slice(key.indexOf(' ') + 1));
  }
  return [...found];
}

/** What chosenMarksIn names jr6 fixes' marks by (PRIV-2, REVC-4). */
export const CHOSEN_MARK_LABELS = {
  angularComponent: 'an Angular state class on a component or a group',
  reflected: 'a custom control that says it is checked or selected (checked, selected)',
  roving: "a widget's roving tab stop on a row but its first (tabindex)",
  drawing: 'a part a widget draws on its chosen row alone (CHOSEN_DRAWINGS)',
  mirrored: "a radio group's chosen value mirrored on its rows (VALUE_MIRRORS: radio-group-value)",
  // jr7 TOOLING-7 (T7-01)
  icon: "an icon drawn for a chosen row with no unchosen twin in the page to copy (CHOSEN_ICONS: Paycom's uiLib)",
};

/**
 * The kinds of chosen mark a written fixture still holds (the security fix of 2026-11-06, S2, S3, S10), by their
 * labels alone (never a value): the conversion refuses a file that holds one, as it refuses jr_id, and
 * test/mhtml-to-fixture.test.ts sweeps every committed fixture with it. Read over the markup, stylesheets, scripts and
 * comments aside:
 * - a CSS module's chosen class (MODULE_CHOSEN_SOURCE), MUI's (MUI_CHOSEN), a CHOSEN_MARKS class of its own name (Ant's,
 *   react-widgets');
 * - a BEM chosen modifier (BEM_CHOSEN_SOURCE) on an option or a choice (CHOICE_ROLES, or a class naming one);
 * - aria-selected="true" on an option, a calendar's day or a tree's item (CHOSEN_OPTION_ROLES; Workday's own
 *   data-value="" "Select One" aside);
 * - aria-checked="true", aria-pressed="true", data-checked="true" or a bare data-checked;
 * - a custom list item or option that says it is selected (<spl-dropdown-item selected>; jr6: or by its class,
 *   <sdf-select-item class="selected">), and a radio or box input that says it is checked;
 * - jr6 (JV-10): a chosen class CHOSEN_MARKS swaps for its twin (Jobvite's icon-radio-checked);
 * - jr6 (jobvite-new-4): an AngularJS state class (ANGULAR_STATE_SOURCE) on a control or an ng-model or ng-form element;
 * - jr6 fixes (PRIV-2, REVC-4; CHOSEN_MARK_LABELS): an Angular state class on any other element but a form; a checked or
 *   selected attribute on an element but an input or an option (a custom list item's selected keeps its own label); a
 *   widget's roving tab stop on a row but its first (rovingStopsOffFirst); a CHOSEN_DRAWINGS part inside its host;
 * - jr6 fixes (PRIV-1's value mirror): a VALUE_MIRRORS attribute that is not empty (ADP's radio-group-value);
 * - jr7 TOOLING-7 (T7-01): an icon CHOSEN_ICONS names by its test id (Paycom's uiLib chosen radio and box).
 * @param {string} text @returns {string[]}
 */
export function chosenMarksIn(text) {
  const markup = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const module = new RegExp(MODULE_CHOSEN_SOURCE);
  const bem = new RegExp(BEM_CHOSEN_SOURCE);
  const choiceClass = new RegExp(CHOICE_CLASS_SOURCE, 'i');
  const angular = new RegExp(ANGULAR_STATE_SOURCE);
  const named = new Set(CHOSEN_MARKS.flatMap((mark) => [...(mark.classes ?? []), ...Object.keys(mark.swap ?? {})])
    .filter((name) => name !== 'selected' && !MUI_CHOSEN.includes(name)));
  /** @type {Set<string>} */
  const found = new Set();
  for (const [, tag = '', rest = ''] of markup.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    const name = tag.toLowerCase();
    const attributes = attributesOf(rest);
    const classes = (attributes.get('class') ?? '').split(/\s+/).filter((each) => each !== '');
    const role = (attributes.get('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const is = (/** @type {string} */ attribute) => (attributes.get(attribute) ?? '').trim().toLowerCase() === 'true';
    if (classes.some((each) => module.test(each))) found.add("a CSS module's chosen class");
    if (classes.some((each) => MUI_CHOSEN.includes(each))) found.add("MUI's chosen class");
    if (classes.some((each) => named.has(each))) found.add('a chosen class CHOSEN_MARKS names');
    const choice = CHOICE_ROLES.includes(role) || classes.some((each) => choiceClass.test(each));
    if (choice && classes.some((each) => bem.test(each))) found.add("an option's or a choice's chosen modifier");
    if (CHOSEN_OPTION_ROLES.includes(role) && is('aria-selected') && attributes.get('data-value') !== '') {
      found.add('a chosen option (aria-selected)');
    }
    if (is('aria-checked') || is('aria-pressed')) found.add('a ticked or pressed control (aria-checked, aria-pressed)');
    const dataChecked = attributes.get('data-checked');
    if (dataChecked !== undefined && ['', 'true'].includes(dataChecked.trim().toLowerCase())) {
      found.add('a ticked control (data-checked)');
    }
    const listItem = name.includes('-') && /(?:item|option)$/.test(name)
      && (attributes.has('selected') || classes.includes('selected'));
    if (listItem) found.add('a list item that says it is selected');
    if (name === 'input' && attributes.has('checked') && /^(?:radio|checkbox)$/i.test(attributes.get('type') ?? '')) {
      found.add('a radio or box input that says it is checked');
    }
    // jr6 fixes (PRIV-2 b, REVC-4): a custom control's reflected state (SmartRecruiters' spl-radio checked="true").
    if (!['input', 'option'].includes(name) && (attributes.has('checked') || (attributes.has('selected') && !listItem))) {
      found.add(CHOSEN_MARK_LABELS.reflected);
    }
    // jr6 fixes (PRIV-1's value mirror): a group's chosen value repeated on a row (ADP's radio-group-value).
    if (VALUE_MIRRORS.some(({ tag: mirror, attribute }) => name === mirror
      && decodeEntities(attributes.get(attribute) ?? '').trim() !== '')) {
      found.add(CHOSEN_MARK_LABELS.mirrored);
    }
    // jr7 TOOLING-7 (T7-01): an icon drawn for a chosen row (Paycom's uiLib), which no twin replaced.
    const testid = decodeEntities(attributes.get('data-testid') ?? '');
    if (testid !== '' && CHOSEN_ICONS.some((icon) => new RegExp(icon.testid).test(testid))) found.add(CHOSEN_MARK_LABELS.icon);
    const angularElement = ['input', 'select', 'textarea', 'ng-form'].includes(name)
      || ['ng-model', 'data-ng-model', 'ng-form', 'data-ng-form'].some((attribute) => attributes.has(attribute));
    if (classes.some((each) => angular.test(each))) {
      if (angularElement) found.add('an AngularJS state class on a control');
      // jr6 fixes (PRIV-2 c): Angular's, on a reactive form's component or group (a <form> keeps its own).
      else if (name !== 'form') found.add(CHOSEN_MARK_LABELS.angularComponent);
    }
  }
  // jr6 fixes (PRIV-2 a, REVC-4): what holds what: a roving tab stop on a row but its widget's first, and a part only a
  // chosen row draws.
  const nodes = markupElements(text);
  if (rovingStopsOffFirst(nodes).length > 0) found.add(CHOSEN_MARK_LABELS.roving);
  const drawn = nodes.some((node, at) => CHOSEN_DRAWINGS.some(({ host, tag, id, className, slot }) => {
    if ((tag !== undefined && node.tag !== tag) || (id !== undefined && node.attributes.get('id') !== id)) return false;
    // jr7 TOOLING-7 (r2): a part named by its slot.
    if (slot !== undefined && node.attributes.get('slot') !== slot) return false;
    if (className !== undefined && !(node.attributes.get('class') ?? '').split(/\s+/).includes(className)) return false;
    for (let up = nodes[at]?.parent ?? -1; up >= 0; up = nodes[up]?.parent ?? -1) if (nodes[up]?.tag === host) return true;
    return false;
  }));
  if (drawn) found.add(CHOSEN_MARK_LABELS.drawing);
  return [...found];
}
// ── end of the security fix's block ──

/**
 * jr7 TOOLING-7 (T7-01): each attribute SPELLED_IDS names that still spells a widget's shown text (Paycom's uiLib
 * data-testid="anchor-for-<text>-tooltip", its text neither REDACTED nor empty), by the attribute's name and its
 * element's tag, never a value: the conversion refuses such a file, and test/mhtml-to-fixture.test.ts sweeps every
 * committed fixture with it. Read over the markup, stylesheets, scripts and comments aside.
 * @param {string} text @returns {string[]}
 */
export function spelledIdsIn(text) {
  const markup = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  /** @type {Set<string>} */
  const found = new Set();
  for (const [, tag = '', rest = ''] of markup.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    const attributes = attributesOf(rest);
    for (const { attribute, source } of SPELLED_IDS) {
      const middle = new RegExp(source).exec(decodeEntities(attributes.get(attribute) ?? ''))?.[2];
      if (middle !== undefined && middle !== REDACTED) {
        found.add(`a widget's shown text spelled in its ${attribute} (on <${tag.toLowerCase()}>; SPELLED_IDS)`);
      }
    }
  }
  return [...found];
}

/**
 * jr6 round 2 (TOOLING; SP\jr6\BUILD.md 4b): each redaction-list entry that survives in an attribute of a written file,
 * as written or respelled (respelledSources: joined, camel-cased, its separators changed or percent-encoded, at words'
 * edges), by the entry's position, the attribute's name and its element's tag, never a value: the conversion refuses
 * a file that holds one (a frame's src, which the scrub leaves for its route, among them). Read over the markup's start
 * tags, the declarative shadow roots' included, stylesheets, scripts and comments aside; a data: or base64 value is a
 * payload, not words. jr6 fixes (PRIV-6): with `text`, the page's text too (each run between tags, entities decoded:
 * "survives in the page's text"), which the conversion reads in every page it writes (a run the page's own redaction
 * could not reach, a <template>'s, among them).
 * @param {string} text @param {Array<{ index: number; source: string }>} sources
 * @param {{ text?: boolean }} [options] @returns {string[]}
 */
export function respelledIn(text, sources, options = {}) {
  if (sources.length === 0) return [];
  const markup = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  /** @type {Set<string>} */
  const found = new Set();
  for (const [, tag = '', rest = ''] of markup.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    for (const [name, raw] of attributesOf(rest)) {
      if (raw.trim() === '' || /^\s*data:/i.test(raw) || /;base64,/i.test(raw)) continue;
      const value = decodeEntities(raw);
      for (const { index, source } of sources) {
        if (respelledSpans(value, source).length > 0) {
          found.add(`redact entry ${index} survives in an attribute (${name} on <${tag.toLowerCase()}>)`);
        }
      }
    }
  }
  if (options.text === true) {
    for (const run of markup.split(/<(?:[^<>"']|"[^"]*"|'[^']*')*>/)) {
      if (run.trim() === '') continue;
      const value = decodeEntities(run);
      for (const { index, source } of sources) {
        if (respelledSpans(value, source).length > 0) found.add(`redact entry ${index} survives in the page's text`);
      }
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ when: 'before' | 'after'; run: (arg: any) => Record<string, number>; arg: (platform: string) => unknown;
 *   counts: 'header' | 'frame' | 'none' }} PlatformRedaction
 */

/**
 * The in-page redactions a platform adds to the generic passes (stripInjectedInPage, clearChoicesInPage,
 * redactApplicantTextInPage and transformInPage), dispatched by --platform: each runs in every converted frame, `before` or
 * `after` transformInPage, given what `arg` builds. Its counts go under redacted.<platform> in the fixture's header
 * ('header'), are added to the frame's own counts ('frame'), or are not recorded ('none').
 * @type {Record<string, PlatformRedaction>}
 */
const PLATFORM_REDACTIONS = {
  // Workday's application steps (the owner's snapshots of 2026-11-06): what the generic redaction misses there.
  workday: { when: 'before', run: redactWorkdayInPage, arg: () => ({ redacted: REDACTED }), counts: 'header' },
  // iCIMS's signed-in pages (the owner's snapshots of 2026-11-06): the header's name, a current file, its dropdowns.
  icims: { when: 'after', run: icimsRedactInPage, arg: () => REDACTED, counts: 'none' },
  // Oracle's apply flow and SmartRecruiters' one-click application (the snapshot build of 2026-11-06, oracle-sf-sr).
  oracle: { when: 'after', run: redactPlatformInPage, arg: (platform) => ({ platform, redacted: REDACTED }), counts: 'frame' },
  smartrecruiters: { when: 'after', run: redactPlatformInPage, arg: (platform) => ({ platform, redacted: REDACTED }),
    counts: 'frame' },
};

/** The URL without its fragment, as a request carries it. @param {string} url */
const withoutFragment = (url) => {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
};

// ── New ATSs (DESIGN-NEW-ATS §6.2, Phase 0) ──
/** The attribute that marks the host of a closed shadow root in the capture (Cloudflare Turnstile's, ultipro-2). */
export const CLOSED_ROOT_MARK = 'data-fixture-closed-root';

/**
 * Marks every host of a closed shadow root in the capture's frames (CLOSED_ROOT_MARK), read through the DevTools
 * protocol, the only reader of a closed root. Page code cannot read such a root and the fixture cannot keep it, so
 * transformInPage stands its host in by its box (as a large image is by a same-size placeholder), which keeps the
 * layout around it, and the visibility check, as the capture rendered them. Answers how many it marked.
 * @param {import('playwright').BrowserContext} context @param {import('playwright').Page} page
 */
async function markClosedShadowHosts(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    /** @type {number[]} */
    const hosts = [];
    /** @param {any} node */
    const walk = (node) => {
      for (const shadow of node.shadowRoots ?? []) {
        if (shadow.shadowRootType === 'closed') hosts.push(node.nodeId);
        walk(shadow);
      }
      for (const child of node.children ?? []) walk(child);
      if (node.contentDocument) walk(node.contentDocument);
    };
    walk(root);
    for (const nodeId of hosts) await session.send('DOM.setAttributeValue', { nodeId, name: CLOSED_ROOT_MARK, value: '' });
    return hosts.length;
  } finally {
    await session.detach();
  }
}
// ── end New ATSs ──

/** Whether an address is on a host the extension runs on (https only, as the manifest matches). @param {string} url */
export function onAtsHost(url) {
  try {
    const parsed = new URL(url);
    // Oracle's candidate pages by their path too, as src/shared/hosts.ts platformOfUrl reads them.
    if ((parsed.hostname.endsWith('.oraclecloud.com') || parsed.hostname.endsWith('.oraclegovcloud.com'))
      && !parsed.pathname.startsWith('/hcmUI/CandidateExperience/')) {
      return false;
    }
    // ── New ATSs (DESIGN-NEW-ATS §6.1): their hosts, path-scoped as src/shared/hosts.ts reads them ──
    const host = parsed.hostname.toLowerCase();
    // jr7 TOOLING-7: an entry's pathPattern is a whole candidate path (UKG Ready's, Paycom's).
    if (parsed.protocol === 'https:' && NEW_ATS_HOSTS.some((entry) => entry.host.test(host)
      && (entry.paths === undefined || entry.paths.some((path) => parsed.pathname.startsWith(path)))
      && (entry.pathPattern === undefined || entry.pathPattern.test(parsed.pathname)))) return true;
    // ── end New ATSs ──
    return parsed.protocol === 'https:' && ATS_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** A JSON value that can sit inside an HTML comment: "--" never appears. @param {unknown} value */
const commentJson = (value) => JSON.stringify(value).replace(/--/g, '-\\u002d');

/**
 * @typedef {{ path: string; text: string }} OutputFile
 * @typedef {{ files: OutputFile[]; routes: Record<string, string>; chrome: string; tokens: Array<{ token: string;
 *   where: string; file: string }>; notes: string[]; counts: Record<string, Record<string, number>> }} Conversion
 */

/**
 * Converts a capture into fixture files, in memory: nothing is written. Throws a ConversionError, naming each failed
 * check, when the result would leak a listed string, an email or a phone number, when it would make a request, or when
 * visibility changed. jr6: `replaceText` (--replace-text) gives each element its selector names synthetic text before
 * anything is measured (replaceTextInPage); a listed string met in the page's own text where it tells its value by
 * elimination (listedPlacesInPage), or choice rows that differ after clearing (unevenChoiceRowsInPage), are refused.
 * jr7 TOOLING-7 (jr7-O5): `keepApplication` (--keep-application <job id>, Oracle only) names the captured posting, whose
 * My Applications tile a my-profile page keeps (redactPlatformInPage); a page whose tiles name none of it is refused.
 * jr7 TOOLING-7 (JDEF-V1): `styleOrder` (--style-order archive|live; default STYLE_ORDER_DEFAULTS[platform], else
 * archive): with live, the cid: sheets Blink hoisted go after the head's own linked sheets before anything is measured
 * (liveStyleOrderInPage); the header records styleOrder and the sheets moved.
 * jr7 TOOLING-7 (RBP7-V2 a): `frameSrc` (--frame-src <css>=<https address>, repeatable) gives each frame the capture
 * saved unloaded (no web address) that the selector names the public vendor address, served by the third-party
 * stand-in (readFrameSrcOption checks the address: https, a third party's, no credentials, no site key); an entry that
 * names no such frame, or names a frame with an address of its own, is refused.
 * @param {{ file: string; platform: string; caseName: string; redact?: string[]; outDir?: string; folderName?: string;
 *   replaceText?: Array<{ selector: string; text: string }>; keepApplication?: string; styleOrder?: string;
 *   frameSrc?: Array<{ selector: string; url: string }> }} options
 * @returns {Promise<Conversion>}
 */
export async function convertMhtml({ file, platform, caseName, redact = [], outDir = join(ROOT, 'fixtures'),
  folderName = platform, replaceText = [], keepApplication, styleOrder: styleOrderOption, frameSrc = [] }) {
  if (!FIXTURE_PLATFORMS.includes(platform)) fail(`--platform must be one of ${FIXTURE_PLATFORMS.join(', ')}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseName)) fail('--case must be lower-case words joined by hyphens');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folderName)) fail('--folder must be lower-case words joined by hyphens');
  if (!/\.mht(?:ml)?$/i.test(file)) fail('the capture must be an .mhtml file');
  // jr7 TOOLING-7 (RBP7-V2 a): each --frame-src entry's address is a third party's public one.
  for (const [index, { selector, url }] of frameSrc.entries()) readFrameSrcOption(`${selector}=${url}`, index + 1);
  // jr7 TOOLING-7 (JDEF-V1): the style order kept, given or the platform's default.
  const styleOrder = styleOrderOption
    ?? /** @type {Record<string, string>} */ (STYLE_ORDER_DEFAULTS)[platform] ?? 'archive';
  if (!STYLE_ORDERS.includes(styleOrder)) fail(`--style-order must be one of ${STYLE_ORDERS.join(', ')}`);
  // jr7 TOOLING-7 (jr7-O5): the captured posting's job id, whose My Applications tile stays (Oracle's my-profile).
  if (keepApplication !== undefined) {
    if (platform !== 'oracle') fail('--keep-application is for --platform oracle (its My Applications tiles) alone');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(keepApplication)) fail('--keep-application must be a job id (letters, digits, - or _)');
  }
  // jr6 (jobvite-new-2): each replacement names an element and the synthetic text it takes; named by position, never by
  // its selector or text, in what is printed.
  for (const [index, { selector, text }] of replaceText.entries()) {
    if (selector.trim() === '' || text.trim() === '') fail(`--replace-text #${index + 1} needs a selector and a non-empty file`);
  }
  // jr6 PRIVACY-FIX: <css>@<attribute> names a JSON copy of the posting in that attribute (POSTING_COPY_ATTRIBUTES).
  const replacements = replaceText.map(({ selector, text }) => {
    const copy = /^(.*\S)@([A-Za-z][\w-]*)$/.exec(selector.trim());
    return { selector: copy === null ? selector.trim() : copy[1] ?? '', attribute: copy?.[2]?.toLowerCase(),
      text: text.replace(/\r\n?/g, '\n').trim() };
  });
  for (const [index, { attribute }] of replacements.entries()) {
    if (attribute !== undefined && !POSTING_COPY_ATTRIBUTES.some((each) => each.attribute === attribute)) {
      fail(`--replace-text #${index + 1} names an attribute that holds no copy of the posting (POSTING_COPY_ATTRIBUTES)`);
    }
  }
  const mhtml = parseMhtml(readFileSync(file));
  const htmlParts = mhtml.parts.filter((part) => part.contentType === 'text/html');
  const main = htmlParts[0];
  // jr6 round 2 (TOOLING; BUILD.md 4b): the listed strings as they may stand respelled in an attribute or an address;
  // the page's and its frames' addresses lose them (respelledAddress), the frames' src, route map and header alike.
  const respelled = respelledSources(redact);
  // jr7 TOOLING-7 (UKGR-20): the addresses read the phone-shaped strings too (the exact rule never runs on them).
  const addressSources = respelledSources(redact, { phones: true });
  const capturedUrl = main?.location ?? mhtml.snapshotUrl;
  const mainUrl = capturedUrl ? respelledAddress(capturedUrl, addressSources) : capturedUrl;
  if (!main || !mainUrl || !/^https?:/i.test(mainUrl)) fail('the capture names no web address for its page');
  const captured = mhtml.date && !Number.isNaN(Date.parse(mhtml.date)) ? new Date(mhtml.date).toISOString() : null;

  // Snapshot build, boards: --folder puts a case beside others of its kind (fixtures/sites: a company's page and the
  // ATS frame it embeds), its header named so; the platform still decides how the frames are normalised.
  const folder = join(outDir, folderName);
  /** A frame's address as its fixture is served and named: its per-load tokens normalised as the page's are (the
   *  frames' src attributes hold the same), so the header and the route map keep none (v3 Phase 7b). */
  const addressOf = (/** @type {string} */ url) => redactNewAtsAddress(platform,
    normaliseTokens(platform, withoutInjectedParams(url)).text);
  /** A third-party frame's address as the page's src now writes it (another extension's parameters dropped, a sign-in
   *  token or a new ATS's per-load token redacted: DESIGN-NEW-ATS §6.5, §6.6), so the route map answers the address the
   *  fixture asks for. */
  const thirdPartyAddressOf = (/** @type {string} */ url) => redactNewAtsAddress(platform,
    redactSignInTokens(stripInjectedParams(url).text));
  /** The path a route map gives for a file: repo-relative with forward slashes, or absolute outside the repo. */
  const routePath = (/** @type {string} */ path) => {
    const rel = relative(ROOT, path);
    return rel.startsWith('..') || isAbsolute(rel) ? path.split('\\').join('/') : rel.split('\\').join('/');
  };

  // cid: address of each archived frame -> its own URL (fragment kept), or null without a web address.
  /** @type {Record<string, string | null>} */
  const frameUrls = {};
  for (const part of htmlParts.slice(1)) {
    // Snapshot build, boards: a frame's address without another extension's parameters (INJECTED_PARAMS).
    if (part.contentId) {
      frameUrls[part.contentId] = part.location && /^https?:/i.test(part.location)
        ? respelledAddress(withoutInjectedParams(part.location), addressSources) : null;
    }
  }
  const resources = resourcesOf(mhtml);
  const patterns = { redact: redactSources(redact), email: EMAIL_SOURCE, notEmail: NOT_EMAIL_SOURCE, phone: PHONE_SOURCE,
    phoneDigits: PHONE_DIGITS, phoneAttributes: PHONE_ATTRIBUTES };
  // The snapshot build of 2026-11-06: a platform keeping shadow roots (oracle-sf-sr), and the platform's own redactions.
  const deep = keepsShadowRoots(platform);
  const own = PLATFORM_REDACTIONS[platform];

  const browser = await chromium.launch({ headless: true });
  try {
    const chrome = browser.version();
    // The capture renders from its own parts, without the page's CSP (the fixture drops it, and a CSP meta would block
    // the archive's own cid: sheets and frames); nothing may reach the network.
    const context = await browser.newContext({ javaScriptEnabled: false, bypassCSP: true, viewport: VIEWPORT });
    await context.route(/^https?:/i, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'load' });
    // The new ATSs (DESIGN-NEW-ATS §6.2), every platform: each closed shadow root's host, marked for its stand-in.
    await markClosedShadowHosts(context, page);

    // The frames to convert: the page, and each frame on an ATS host inside a converted frame.
    /** @type {Array<{ frame: import('playwright').Frame; url: string; path: string }>} */
    const converted = [{ frame: page.mainFrame(), url: mainUrl, path: join(folder, `${caseName}.html`) }];
    for (let index = 0; index < converted.length; index += 1) {
      const parent = converted[index];
      if (!parent) break;
      for (const child of parent.frame.childFrames()) {
        const url = frameUrls[child.url()] ?? null;
        if (url !== null && onAtsHost(url)) {
          converted.push({ frame: child, url, path: join(folder, `${caseName}.frame-${converted.length}.html`) });
        }
      }
    }

    /** @type {Conversion} */
    const result = { files: [], routes: {}, chrome, tokens: [], notes: [], counts: {} };
    /** @type {string[]} */
    const reasons = [];
    /** Every third-party frame a converted frame links to: each is answered by the stand-in page. */
    /** @type {Set<string>} */
    const thirdParty = new Set();
    /** @type {string[][]} */
    const before = [];
    // Before anything is measured, on every platform: a shadow-root platform's frames are read with their shadow trees
    // (deepenInPage, oracle-sf-sr); then what is not the site's page goes (stripInjectedInPage: another extension's UI,
    // an overlay's shadow host where shadow roots are not kept, per-load values) and the choices a page mirrors are
    // cleared (clearChoicesInPage), so the visibility check compares the site's own page (the snapshot build, boards).
    /** @type {Array<{ injected: number; shadowOverlays: number; injectedParams: number; choices: number }>} */
    const stripped = [];
    // jr6 (jobvite-new-2): what each frame's --replace-text took (replaceTextInPage), before it is measured, so the
    // visibility check compares the page as the replacements left it.
    /** @type {number[][]} */
    const replaced = [];
    // jr7 TOOLING-7 (T7-01): each frame's canvases stood in by the box they draw with scripting on (standInCanvasesInPage).
    /** @type {number[]} */
    const canvases = [];
    // jr7 TOOLING-7 (RBP7-V2 a): the frames each --frame-src entry gave an address, and those it would not.
    /** @type {number[]} */
    const framesGiven = frameSrc.map(() => 0);
    /** @type {number[]} */
    const framesRefused = frameSrc.map(() => 0);
    // jr7 TOOLING-7 (JDEF-V1): the cid: sheets each frame's live style order moved (liveStyleOrderInPage).
    /** @type {number[]} */
    const restyled = [];
    const heldSheets = Object.keys(resources).filter((key) => key.startsWith('cid:') && resources[key]?.css !== undefined);
    for (const { frame } of converted) {
      if (deep) await frame.evaluate(deepenInPage);
      stripped.push({ ...await frame.evaluate(stripInjectedInPage, { selectors: INJECTED_UI, perLoad: PER_LOAD_SOURCE,
        dropOverlays: !deep, redacted: REDACTED, closedMark: CLOSED_ROOT_MARK }),
        ...await frame.evaluate(clearChoicesInPage, { redacted: REDACTED,
        marks: CHOSEN_MARKS, ...CLEAR_CHOICE_INPUT, icons: CHOSEN_ICONS }) });
      canvases.push(await frame.evaluate(standInCanvasesInPage));
      // jr7 TOOLING-7 (JDEF-V1): the live style order, each moved sheet loaded again before the measure (the page runs no
      // script, so the conversion polls; one the archive lacks is not waited for).
      const moved = styleOrder === 'live' ? await frame.evaluate(liveStyleOrderInPage) : 0;
      for (let tries = 0; moved > 0 && tries < 100 && !await frame.evaluate(sheetsLoadedInPage, heldSheets); tries += 1) {
        await new Promise((done) => setTimeout(done, 50));
      }
      restyled.push(moved);
      replaced.push(replacements.length === 0 ? [] : await frame.evaluate(replaceTextInPage, { replacements,
        copies: POSTING_COPY_ATTRIBUTES }));
    }
    for (const [index] of replacements.entries()) {
      if (replaced.some((counts) => counts[index] === -1)) fail(`--replace-text #${index + 1} is not a selector the page can read`);
      if (replaced.every((counts) => (counts[index] ?? 0) === 0)) {
        fail(`--replace-text #${index + 1} names no element in any converted frame`);
      }
    }
    for (const { frame } of converted) before.push(await frame.evaluate(measureInPage));

    /** @type {Set<string>} */
    const found = new Set();
    /** The file names the pages showed (redactApplicantTextInPage), checked for as the found emails are.
     *  @type {Set<string>} */
    const fileNames = new Set();
    const thirdPartyPath = join(folder, `${caseName}.third-party-frame.html`);
    // Each frame is converted before the frame that holds it (the reverse of the order they were found in), on every
    // platform. A parent's conversion points its frames' src at their real addresses, which navigates them (from the
    // archive when it holds that address, else nowhere: the route aborts it, or a per-load token REDACTED in it), so a
    // frame converted after its parent would be another document than the one measured, and a frame inside it detached:
    // iCIMS's IForm frames its form a level deeper (<co>.icims.com/forms inside the portal's iframe#icims_formFrame,
    // "Frame was detached" on every IForm snapshot), and a company page's Greenhouse embed carries a validityToken.
    /** @type {OutputFile[]} */
    const written = [];
    for (const [index, { frame, url, path }] of [...converted.entries()].reverse()) {
      // jr6 round 2 (TOOLING; BUILD.md 4b): each open list's rows and the lists a typed query filled, read before any
      // redaction (noteListRowsInPage); what names them goes once every redaction ran (redactListRowsInPage, below).
      await frame.evaluate(noteListRowsInPage, { rows: LIST_ROWS, typedLists: TYPED_LISTS, typedBoxes: TYPED_LIST_BOXES,
        words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE });
      // The generic applicant-text pass, then the platform's own redactions around the transformation
      // (PLATFORM_REDACTIONS).
      const applicant = await frame.evaluate(redactApplicantTextInPage, { fileNames: FILE_NAME_PLACES,
        entries: ENTRY_SUMMARY_PLACES, chosen: CHOSEN_PLACES, profile: PROFILE_PLACES,
        links: [...FILE_LINK_PLACES, ...ENTRY_SUMMARY_CONTROLS], results: SEARCH_RESULT_PLACES, redacted: REDACTED,
        spelled: SPELLED_IDS });
      for (const name of applicant.names) fileNames.add(name);
      // jr7 TOOLING-7 (jr7-O5): Oracle's own pass also takes the captured posting's job id (--keep-application).
      const ownArg = own === undefined ? null : platform === 'oracle' && keepApplication !== undefined
        ? { .../** @type {object} */ (own.arg(platform)), keepApplication } : own.arg(platform);
      const ownBefore = own?.when === 'before' ? await frame.evaluate(own.run, ownArg) : null;
      const outcome = await frame.evaluate(transformInPage, { resources, frameUrls, frameUrl: url, redacted: REDACTED,
        ...patterns, postingPlaces: POSTING_TEXT_PLACES.join(', '), respelled, listRows: LIST_ROWS.join(', '),
        postingCopies: POSTING_COPY_ATTRIBUTES, frameSrc });
      // jr7 TOOLING-7 (RBP7-V2 a): what each --frame-src entry did in this frame.
      for (const [at] of frameSrc.entries()) {
        framesGiven[at] = (framesGiven[at] ?? 0) + (outcome.frameSrc.given[at] ?? 0);
        framesRefused[at] = (framesRefused[at] ?? 0) + (outcome.frameSrc.refused[at] ?? 0);
      }
      const ownAfter = own?.when === 'after' ? await frame.evaluate(own.run, ownArg) : null;
      const ownCounts = ownBefore ?? ownAfter;
      // jr6 round 2: a typed query's results lose their words, and every row whose words went loses what names it.
      const rowNames = await frame.evaluate(redactListRowsInPage, { redacted: REDACTED, fixed: FIXED_ROWS,
        results: SEARCH_RESULT_PLACES, words: ROW_WORD_ATTRIBUTES, wordData: ROW_WORD_DATA_SOURCE, ids: ROW_ID_ATTRIBUTES,
        idData: ROW_ID_DATA_SOURCE, references: ID_REFERENCES, wordsKept: ROW_ID_WORDS_KEPT });
      if (own?.counts === 'frame' && ownCounts !== null) {
        for (const [key, count] of Object.entries(ownCounts)) {
          // jr7 TOOLING-7 (jr7-O5): a count of the platform's own (Oracle's applications) starts at 0.
          const counted = /** @type {Record<string, number>} */ (outcome.counts);
          counted[key] = (counted[key] ?? 0) + count;
        }
      }
      // jr6 (jobvite-new-2): a listed string met in the page's own text where a REDACTED tells it by elimination; (JV-10)
      // choice rows that still read apart once cleared. Counts only, never a value.
      const listedIn = await frame.evaluate(listedPlacesInPage, { redacted: REDACTED, rows: LIST_ROWS.join(', '),
        fixed: FIXED_ROWS.join(', '), lists: LISTED_LISTS });
      for (const [kind, count] of Object.entries(listedIn)) {
        if (count > 0) {
          reasons.push(`${basename(path)}: ${LISTED_PLACE_WORDS[kind]} whose page text the redaction list met: ${count}, `
            + 'where a REDACTED tells the value by elimination; give each synthetic text with --replace-text');
        }
      }
      const rows = await frame.evaluate(unevenChoiceRowsInPage, { rows: CHOICE_ROWS, ...CHOICE_ROW_INPUT });
      for (const [at, { uneven }] of rows.entries()) {
        if (uneven > 0) {
          reasons.push(`${basename(path)}: choice groups (${CHOICE_ROWS[at]?.group}) whose option rows still differ once `
            + `cleared: ${uneven}, a chosen mark the converter does not know`);
        }
      }
      // A company's page (--folder sites, the snapshot build: boards) is pruned too, its sheets being most of its weight.
      const pruned = PRUNED_CSS_PLATFORMS.includes(platform) || folderName === 'sites'
        ? await frame.evaluate(pruneCssInPage) : null;
      if (outcome.counts.shadowRoots > 0 && !deep) fail(`${basename(path)}: the page has shadow roots, which the converter cannot keep yet`);
      for (const link of outcome.linkedFrames) {
        if (!onAtsHost(link)) thirdParty.add(link);
        else if (!converted.some((entry) => entry.url === link)) {
          reasons.push(`${basename(path)}: its frame on ${new URL(link).host} did not render from the capture, so it could not be converted`);
        }
      }
      for (const value of outcome.found) found.add(value);
      result.notes.push(...outcome.notes.map((note) => `${basename(path)}: ${note}`));
      const serialized = JSON.parse(await frame.evaluate(deep ? serializeDeepInPage : serializeInPage));
      const { doctype } = serialized;
      // Another extension's parameters leave the frame's text by the one rule, wherever they stand (stripInjectedParams),
      // and so do its sign-in tokens (redactSignInTokens), on every platform.
      const injected = stripInjectedParams(serialized.html);
      // jr6 fixes (PRIV-4): the referral parameters' values, in every link, frame address and text the frame writes
      // (redactReferralParams), its shadow roots' included; the header's source and the route map read them from
      // addressOf, which withoutInjectedParams gives the same rule.
      /** @type {string[]} */
      const referralValues = [];
      const referred = redactReferralParams(injected.text, referralValues);
      /** @type {string[]} */
      const signInTokens = [];
      const pageText = redactSignInTokens(referred.text, signInTokens);
      const normalised = platform === 'ashby' ? normaliseAshby(pageText)
        : platform === 'workable' ? { ...normaliseWorkable(pageText), nonces: 0 }
          : ['workday', 'icims', 'taleo', 'successfactors', 'oracle'].includes(platform)
            ? { ...normaliseTokens(platform, pageText), nonces: 0 }
            // The new ATSs' per-load values (DESIGN-NEW-ATS §6.6).
            : NEW_ATS_PLATFORMS.includes(platform) ? { ...normaliseNewAts(platform, pageText), nonces: 0 } : null;
      const html = normalised?.text ?? pageText;
      // A token the normalisation replaced (a render id, the CSP nonce), another extension's parameter dropped or a
      // sign-in token redacted is gone from the files: it is not listed.
      result.tokens.push(...outcome.tokens.filter(({ token }) => !injected.removed.some(({ value }) => value !== ''
        && token.includes(value)) && !signInTokens.some((value) => token.includes(value))
        && !referralValues.some((value) => token.includes(value))
        && (normalised === null || !normalised.renderIds.some((id) => token.includes(id))
        && !(normalised.nonces > 0 && !html.includes(token))))
        .map((token) => ({ ...token, file: basename(path) })));
      const { counts } = outcome;
      const { choices = 0, ...took } = stripped[index] ?? { injected: 0, shadowOverlays: 0, injectedParams: 0 };
      took.injectedParams += injected.removed.length;
      // Jobright's jr_id among them, counted as the new ATSs' header names it (removed.jrIds).
      const jrIds = injected.removed.filter(({ name }) => name === 'jr_id').length;
      const header = {
        fixture: `${folderName}/${basename(path, '.html')}`,
        source: addressOf(url),
        captured,
        chrome,
        redacted: { typedValues: counts.typedValues, checked: counts.checked, selected: counts.selected,
          hiddenValues: counts.hiddenValues, widgetText: counts.widgetText, emails: counts.emails, phones: counts.phones,
          listed: counts.listed, ...(applicant.applicantText > 0 ? { applicantText: applicant.applicantText } : {}),
          // jr6 round 2: the listed strings respelled in attributes, and the rows whose names went (each only when
          // there was one, so a page neither touches is written as before).
          ...(counts.respelled > 0 ? { respelled: counts.respelled } : {}),
          // jr6 fixes (PRIV-6): and in the page's text.
          ...(counts.respelledText > 0 ? { respelledText: counts.respelledText } : {}),
          ...(rowNames.rows > 0 ? { listRows: rowNames } : {}),
          ...(signInTokens.length > 0 ? { signInTokens: signInTokens.length } : {}),
          // jr6 fixes (PRIV-4): the referral parameters' values redacted in the frame's text (only when there was one).
          ...(referred.count > 0 ? { referral: referred.count } : {}),
          ...(own?.counts === 'header' && ownCounts !== null ? { [platform]: ownCounts } : {}),
          // jr7 TOOLING-7 (jr7-O5): Oracle's My Applications tiles redacted, and the captured posting's kept (each only
          // when there was one).
          ...(((/** @type {Record<string, number>} */ (counts)).applications ?? 0) > 0
            ? { applications: /** @type {Record<string, number>} */ (counts).applications } : {}),
          ...(((/** @type {Record<string, number>} */ (counts)).keptApplications ?? 0) > 0
            ? { keptApplications: /** @type {Record<string, number>} */ (counts).keptApplications } : {}) },
        removed: { scripts: counts.scripts, eventHandlers: counts.eventHandlers, javascriptUrls: counts.javascriptUrls,
          bases: counts.bases, metaRefresh: counts.metaRefresh, metaHttpEquiv: counts.metaHttpEquiv,
          embeds: counts.embeds, links: counts.links, srcdoc: counts.srcdoc, ...(jrIds > 0 ? { jrIds } : {}) },
        inlined: { stylesheets: counts.stylesheets, images: counts.images, placeholders: counts.placeholders,
          missing: counts.missing },
        ...(pruned === null ? {} : { pruned: { rulesKept: pruned.kept, rulesDropped: pruned.dropped } }),
        frames: { linked: counts.frames, blanked: counts.framesDropped,
          // jr7 TOOLING-7 (RBP7-V2 a): the unloaded frames --frame-src gave their public address.
          ...(outcome.frameSrc.given.some((count) => count > 0)
            ? { given: outcome.frameSrc.given.reduce((sum, count) => sum + count, 0) } : {}) },
        forms: counts.forms,
        ...(normalised === null ? {} : { normalised: { renderIds: normalised.renderIds.length, nonces: normalised.nonces } }),
        // The open shadow roots kept, written as declarative ones (SHADOW_ROOT_PLATFORMS).
        ...(deep ? { shadowRoots: counts.shadowRoots } : {}),
        // The closed shadow roots stood in by their hosts' boxes (DESIGN-NEW-ATS §6.2).
        ...(counts.closedRoots > 0 ? { closedShadowRoots: counts.closedRoots } : {}),
        // jr7 TOOLING-7 (T7-01): the canvases stood in by the box they draw (standInCanvasesInPage).
        ...((canvases[index] ?? 0) > 0 ? { canvasStandIns: canvases[index] } : {}),
        // jr7 TOOLING-7 (JDEF-V1): the live style order, and the cid: sheets it moved (only when it is not archive's).
        ...(styleOrder === 'archive' ? {} : { styleOrder, styleSheetsMoved: restyled[index] ?? 0 }),
        // What was taken as not the site's (another extension's UI and parameters, overlays, per-load values) and the
        // choices cleared, each named only when there was something.
        ...(Object.values(took).some((count) => count > 0) ? { injected: took } : {}),
        ...(choices > 0 ? { cleared: { choices } } : {}),
        // jr6 (jobvite-new-2): the elements each --replace-text gave synthetic text in this frame, by position.
        ...((replaced[index] ?? []).some((count) => count > 0) ? { replacedText: replaced[index] } : {}),
      };
      result.counts[basename(path)] = { ...counts, ...took, choices, applicantText: applicant.applicantText, jrIds,
        referral: referred.count,
        listRows: rowNames.rows, rowWords: rowNames.words, rowNames: rowNames.names, rowIds: rowNames.ids };
      const comment = `<!-- TailorIT fixture, converted by scripts/mhtml-to-fixture.mjs: convert the capture again ` +
        `rather than editing it.\n${commentJson(header)} -->`;
      // LF line ends throughout: HTML parsing treats CR LF as LF anyway, and git stores the fixture with LF.
      written[index] = { path, text: `${doctype ? `${doctype}\n` : ''}${comment}\n${html.replace(/\r\n?/g, '\n')}\n` };
    }
    for (const [index, { url, path }] of converted.entries()) {
      const file = written[index];
      if (file !== undefined) result.files.push(file);
      if (index > 0 && withoutFragment(addressOf(url)) in result.routes) {
        result.notes.push(`${basename(path)}: another frame has the same address, so the route map serves the first`);
      } else {
        result.routes[withoutFragment(addressOf(url))] = routePath(path);
      }
    }
    if (thirdParty.size > 0) {
      const header = { fixture: `${folderName}/${caseName}.third-party-frame`, source: 'a stand-in for third-party frames',
        captured, chrome, hosts: [...new Set([...thirdParty].map((url) => new URL(url).hostname))].sort() };
      result.files.push({ path: thirdPartyPath, text: `<!DOCTYPE html>\n<!-- TailorIT fixture: the extension never runs ` +
        `in a third-party frame, so its content is not kept.\n${commentJson(header)} -->\n<html><head><meta ` +
        `charset="utf-8"><title>Third-party frame</title></head><body></body></html>\n` });
      for (const url of thirdParty) {
        const key = withoutFragment(thirdPartyAddressOf(url));
        if (!(key in result.routes)) result.routes[key] = routePath(thirdPartyPath);
      }
    }
    await context.close();

    // Reload the result as the e2e harness serves it, JavaScript on, and check it.
    const served = new Map(Object.entries(result.routes).map(([url, path]) => [url,
      result.files.find((output) => routePath(output.path) === path)?.text ?? '']));
    const check = await browser.newContext({ viewport: VIEWPORT });
    /** @type {string[]} */
    const requests = [];
    await check.route('**/*', (route) => {
      const url = route.request().url();
      const body = served.get(url);
      if (body !== undefined) return route.fulfill({ status: 200, contentType: 'text/html', body });
      // The browser asks for a favicon on its own, as the e2e harness also allows.
      if (!url.startsWith('data:') && new URL(url).pathname !== '/favicon.ico') requests.push(url);
      return route.abort();
    });
    const reloaded = await check.newPage();
    await reloaded.goto(withoutFragment(addressOf(mainUrl)), { waitUntil: 'load' });
    for (const [index, { url, path }] of converted.entries()) {
      const frame = index === 0 ? reloaded.mainFrame()
        : reloaded.frames().find((candidate) => withoutFragment(candidate.url()) === withoutFragment(addressOf(url)));
      if (!frame) {
        reasons.push(`${basename(path)}: the frame did not load from the route map`);
        continue;
      }
      if (deep) await frame.evaluate(deepenInPage);
      const after = await frame.evaluate(measureInPage);
      const was = before[index] ?? [];
      result.notes.push(`${basename(path)}: visibility compared for ${was.length} elements ` +
        `(${was.filter((state) => state.endsWith('+')).length} shown)`);
      if (after.length !== was.length) {
        reasons.push(`${basename(path)}: ${was.length} elements before conversion, ${after.length} after`);
      } else {
        const changed = after.flatMap((state, at) => (state === was[at] ? [] : [`#${at} ${was[at]} -> ${state}`]));
        if (changed.length > 0) reasons.push(`${basename(path)}: visibility changed for ${changed.length} elements (${changed.slice(0, 5).join(', ')})`);
      }
      const hits = await frame.evaluate(rescanInPage, { ...patterns, found: [...found], fileNames: [...fileNames] });
      for (const [kind, count] of Object.entries(hits)) {
        if (count > 0) reasons.push(`${basename(path)}: ${count} ${kind === 'found' ? 'redacted values' : kind} still in the page`);
      }
    }
    await check.close();
    if (requests.length > 0) reasons.push(`the fixture requests ${requests.length} addresses the route map does not answer: ${[...new Set(requests.map((url) => new URL(url).host))].join(', ')}`);

    // The written text itself, with encodings undone: no listed string and no found email may remain.
    const needles = [...redact.map((entry, index) => ({ label: `redact entry ${index + 1}`, pattern: new RegExp(redactSources([entry])[0] ?? '', 'i') })),
      ...[...found].filter((value) => value.includes('@')).map((value) => ({ label: 'a redacted email', pattern: new RegExp(escapeRegExp(value), 'i') })),
      // A file name the page showed (redactApplicantTextInPage), and Jobright's jr_id anywhere (DESIGN-NEW-ATS §6.4, §6.5).
      ...[...fileNames].map((value) => ({ label: 'a redacted file name', pattern: new RegExp(escapeRegExp(value), 'i') })),
      ...tokenNeedles(), ...referralNeedles()];
    for (const output of [...result.files, { path: join(folder, `${caseName}.routes.json`), text: JSON.stringify(result.routes) }]) {
      const forms = checkedForms(output.text);
      for (const { label, pattern } of needles) {
        if (forms.some((form) => pattern.test(form))) reasons.push(`${basename(output.path)}: ${label} is still in the file`);
      }
      // jr7 TOOLING-7 (the jr6 leftover, INT-2 §6 item 3): and the inlined stylesheets, for the token and referral needles.
      const styleForms = checkedStyleForms(output.text);
      for (const { label, pattern } of [...tokenNeedles(), ...referralNeedles()]) {
        if (styleForms.some((form) => pattern.test(form))) {
          reasons.push(`${basename(output.path)}: ${label} is still in an inlined stylesheet`);
        }
      }
      // The security fix of 2026-11-06 (S2): no chosen mark (an answer drawn on a control or a list) is written.
      for (const label of chosenMarksIn(output.text)) reasons.push(`${basename(output.path)}: ${label} is still in the file`);
      // jr7 TOOLING-7 (T7-01): no widget's shown text spelled in an id (SPELLED_IDS).
      for (const label of spelledIdsIn(output.text)) reasons.push(`${basename(output.path)}: ${label} is still in the file`);
      // jr6 round 2 (TOOLING; BUILD.md 4b): no listed string in any attribute, as written or respelled.
      // jr6 fixes (PRIV-6): and none in a page's text either.
      for (const label of respelledIn(output.text, respelled, { text: output.path.endsWith('.html') })) {
        reasons.push(`${basename(output.path)}: ${label}`);
      }
    }
    // jr7 TOOLING-7 (RBP7-V2 a): each --frame-src entry gave a frame the capture saved unloaded, and no other.
    for (const [at] of frameSrc.entries()) {
      if ((framesRefused[at] ?? 0) > 0) reasons.push(`--frame-src #${at + 1} names a frame with an address of its own`);
      else if ((framesGiven[at] ?? 0) === 0) reasons.push(`--frame-src #${at + 1} names no frame the capture saved unloaded`);
    }
    // jr7 TOOLING-7 (jr7-O5): --keep-application must name a tile the page shows.
    if (keepApplication !== undefined && !Object.values(result.counts).some((each) => (each.keptApplications ?? 0) > 0)) {
      reasons.push('--keep-application names no My Applications tile of the page (a.cs-job-info__title to /job/<id>)');
    }
    if (reasons.length > 0) throw new ConversionError(reasons);
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Writes a conversion: its files, then the route map, replacing an earlier conversion of the same case. An earlier
 * conversion's frames and third-party stand-in go; the hand-written expectations (<case>.frame-<n>.expect.json among
 * them) stay.
 * @param {Conversion} conversion @param {string} folder @param {string} caseName @returns {string[]}
 */
export function writeConversion(conversion, folder, caseName) {
  mkdirSync(folder, { recursive: true });
  for (const name of readdirSync(folder)) {
    const frame = name.startsWith(`${caseName}.frame-`) && /^\.frame-\d+\.html$/.test(name.slice(caseName.length));
    if (frame || name === `${caseName}.third-party-frame.html`) rmSync(join(folder, name));
  }
  const written = [];
  for (const output of conversion.files) {
    writeFileSync(output.path, output.text, 'utf8');
    written.push(output.path);
  }
  const routes = join(folder, `${caseName}.routes.json`);
  writeFileSync(routes, `${JSON.stringify(conversion.routes, null, 2)}\n`, 'utf8');
  written.push(routes);
  return written;
}

// ---------------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------------

/**
 * jr6 (jobvite-new-2): a --replace-text value, <css>=<file>, split at its last "=" (a selector may hold "=" in an
 * attribute test; a path does not). @param {string} value @param {number} position
 * @returns {{ selector: string; file: string }}
 */
export function readReplaceOption(value, position) {
  const at = value.lastIndexOf('=');
  const selector = at < 0 ? '' : value.slice(0, at).trim();
  const file = at < 0 ? '' : value.slice(at + 1).trim();
  if (selector === '' || file === '') fail(`--replace-text #${position} must be <css>=<file>`);
  return { selector, file };
}

/**
 * jr7 TOOLING-7 (RBP7-V2 a): a --frame-src value, <css>=<https address>, split where its address starts (the last
 * "=https://"; a selector and an address may both hold "="). The address must be an absolute https one on no host the
 * extension runs on (a third party's: reCAPTCHA's anchor, say), with no credentials and no site key (k=, sitekey=,
 * render=): a public vendor path only, as a live page's frame element names it before it loads.
 * @param {string} value @param {number} position @returns {{ selector: string; url: string }}
 */
export function readFrameSrcOption(value, position) {
  const at = value.lastIndexOf('=https://');
  const selector = at < 0 ? '' : value.slice(0, at).trim();
  const url = at < 0 ? '' : value.slice(at + 1).trim();
  if (selector === '' || url === '') fail(`--frame-src #${position} must be <css>=<https address>`);
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`--frame-src #${position} is no address`);
  }
  if (parsed.username !== '' || parsed.password !== '') fail(`--frame-src #${position} holds credentials`);
  if (onAtsHost(url)) fail(`--frame-src #${position} names a host the extension runs on, not a third party's`);
  if ([...parsed.searchParams.keys(), ...new URLSearchParams(parsed.hash.slice(1)).keys()]
    .some((key) => ['k', 'sitekey', 'render'].includes(key.toLowerCase()))) {
    fail(`--frame-src #${position} holds a site key (k=, sitekey=, render=)`);
  }
  return { selector, url };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  /** @type {Array<{ selector: string; file: string }>} */
  const replaceText = [];
  /** @type {Array<{ selector: string; url: string }>} */
  const frameSrc = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (['--platform', '--case', '--redact', '--out', '--folder', '--replace-text', '--keep-application', '--style-order',
      '--frame-src'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      if (arg === '--replace-text') replaceText.push(readReplaceOption(value, replaceText.length + 1));
      else if (arg === '--frame-src') frameSrc.push(readFrameSrcOption(value, frameSrc.length + 1));
      else options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || !options.platform || !options.case) {
    fail('usage: node scripts/mhtml-to-fixture.mjs <file.mhtml> --platform <platform> --case <name> [--redact <file>] [--out <folder>] [--folder <name>] [--replace-text <css>=<file>]... [--style-order archive|live] [--keep-application <job id>] [--frame-src <css>=<https address>]...');
  }
  return { file: positional[0] ?? '', platform: options.platform, caseName: options.case, redactFile: options.redact,
    outDir: options.out ? resolve(options.out) : join(ROOT, 'fixtures'), folderName: options.folder ?? options.platform,
    replaceText, keepApplication: options['keep-application'], styleOrder: options['style-order'], frameSrc };
}

async function main() {
  try {
    const { file, platform, caseName, redactFile, outDir, folderName, replaceText: replaceFiles, keepApplication,
      styleOrder, frameSrc } = parseArgs(process.argv.slice(2));
    if (!existsSync(file)) fail(`${file} does not exist`);
    if (redactFile !== undefined && !existsSync(redactFile)) fail(`${redactFile} does not exist`);
    const redact = redactFile === undefined ? [] : readRedactList(readFileSync(redactFile, 'utf8'));
    const replaceText = replaceFiles.map(({ selector, file: textFile }, index) => {
      if (!existsSync(textFile)) fail(`--replace-text #${index + 1}: its file does not exist`);
      return { selector, text: readFileSync(textFile, 'utf8') };
    });
    const conversion = await convertMhtml({ file, platform, caseName, redact, outDir, folderName, replaceText,
      keepApplication, styleOrder, frameSrc });
    const written = writeConversion(conversion, join(outDir, folderName), caseName);
    console.log(paint('green', `✓ ${basename(file)} -> ${platform}/${caseName} (Chromium ${conversion.chrome})`));
    for (const path of written) {
      console.log(`  ${relative(ROOT, path).split('\\').join('/')}  ${(statSync(path).size / 1024).toFixed(1)} KiB`);
    }
    for (const [name, counts] of Object.entries(conversion.counts)) {
      const shown = Object.entries(counts).filter(([, count]) => count > 0).map(([key, count]) => `${key} ${count}`);
      console.log(paint('gray', `  ${name}: ${shown.join(', ')}`));
    }
    for (const note of conversion.notes) console.log(paint('yellow', `  note: ${note}`));
    if (conversion.tokens.length > 0) {
      console.log(paint('yellow', `  ${conversion.tokens.length} suspicious tokens left; add any that is personal to a redact file:`));
      for (const { token, where, file: name } of conversion.tokens.slice(0, 60)) {
        console.log(`    ${token.length > 72 ? `${token.slice(0, 72)}…` : token}  (${name}, ${where})`);
      }
      if (conversion.tokens.length > 60) console.log(`    … and ${conversion.tokens.length - 60} more`);
    }
  } catch (error) {
    const reasons = error instanceof ConversionError ? error.reasons : [String(error instanceof Error ? error.stack : error)];
    console.error(paint('red', '✗ mhtml-to-fixture: nothing was written'));
    for (const reason of reasons) console.error(paint('red', `  ${reason}`));
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
