/*
 * Every sentence the extension shows a person, in one place, so wording stays consistent and reviewable. It lives in
 * shared because the in-page UI (content), the side panel and the options page all show the same sentences.
 * - The plan's exact words: the tripwire, policy and couldn't-read notices, the options page's note on what never goes
 *   to the AI, and the reasons sensitive-not-shared and resume-format-unsupported. Keep them as they are.
 * - Everything else is a draft for the owner's review, the first-run disclosure above all (docs/PRIVACY.md quotes it,
 *   and src/shared/copy.test.ts keeps the two the same).
 * - Count sentences are small functions of the count. No sentence ever holds a field value: the report has none.
 * - The development build's capture tool has its own export, CAPTURE_COPY, so no production bundle carries its words.
 */
import type { ConsentCategory, FillStatus, MatcherStage, Platform, Provenance } from '../core/enums';
import type { ReasonCode } from '../core/types/fill';
import type { PauseReason, RunStatus } from '../core/types/run';
import type { FrameReport } from './report';

/** A report notice's code. */
type NoticeCode = FrameReport['notices'][number]['code'];

/** "1 form", "2 forms". */
const forms = (count: number) => (count === 1 ? 'the form' : `${count} forms`);

/** What each notice says. The first three are the plan's exact sentences. */
const NOTICES = {
  tripwire: 'This page contains text addressed to AI tools. It was ignored.',
  policy: 'This posting says AI-assisted applications are not allowed. Filling is your decision.',
  'policy-unreadable': "I couldn't read this posting to check whether it allows AI tools. Check it before you submit.",
  'attention-check': 'Some questions check that you read the form. They were left for you to answer.',
  'page-busy': 'The page is still busy. When it has settled, choose Continue.',
  auth: 'This step needs you to sign in or create an account. Do that yourself, then choose Continue.',
  captcha: 'This page asks you to prove you are human. Complete it yourself, then choose Continue.',
  validation: 'The form shows errors. The fields that need you are highlighted.',
  'needs-click': 'Some controls respond only to your own click. They are highlighted for you.',
  'posting-outside-frame': 'This form sits inside another site\'s page, which cannot be read, so that page\'s text was not checked.',
  'deferred-fields': 'Some fields were not rendered yet. Scroll to them and choose Fill again.',
  'step-retry-limit': 'This step was tried twice already, so nothing more is filled on it.',
  'policy-hidden-text': 'Text on this page that is not shown yet says AI-assisted applications may not be allowed. Read the whole posting before you submit.',
  'form-hidden': 'This form is hidden or out of view on its page, so nothing was filled. Scroll it into view, then choose Fill again.',
  // The step machine (Phase 5): final-unknown is the plan's exact sentence, max-steps the coordinator's (2026-10-30).
  'final-unknown': "I can't tell whether this is the last step, so I won't press anything.",
  'max-steps': 'This application has more steps than I can follow, so I stopped here. Please finish it yourself.',
} as const satisfies Record<NoticeCode, string>;

/** Why a field ended as it did: one sentence per reason code, shown on its row. */
const REASONS = {
  // Done, possibly needing a look.
  ok: 'Filled as expected.',
  'filled-low-confidence': 'Filled, but the match was not certain. Check it.',
  'already-correct': 'It already held the right answer, so it was left as it was.',
  'prefill-kept': 'The site had already filled this in, and that was kept.',
  'prefill-conflict': 'The site had filled this in differently from your profile. Check which is right.',
  'llm-pick-needs-review': 'The AI picked this option from the list. Check it.',
  'llm-classified-needs-review': 'The AI worked out what this question asks, and it was filled from your profile. Check it.',
  'options-incomplete': 'Only part of this long list could be read, so check the choice, or choose it yourself.',
  'llm-draft-needs-confirmation': 'The AI drafted this answer. Edit or confirm it before you submit.',
  'other-option-with-free-text': 'No option fit, so "Other" was chosen and your answer typed in. Check it.',
  'other-without-free-text': 'No option fit, so "Other" was chosen. Add any details the form asks for yourself.',
  'option-label-had-injected-text': 'An option held words aimed at AI tools. They were ignored, but check the choice.',
  // Gaps in what could be resolved.
  'no-profile-value': 'Your profile has no answer for this.',
  'unknown-field': "It isn't clear what this question asks, so it was left for you.",
  'low-confidence': 'No answer was certain enough to fill in, so it was left for you.',
  'classification-conflict': 'The question could be read in more than one way. Check this field.',
  'eeo-not-in-profile': 'Your profile has no self-identification answer for this, so it was left for you.',
  'legal-not-in-profile': "Your profile doesn't answer this legal question, so it was left for you.",
  'decline-option-missing': 'You chose not to answer this, but the form offers no way to decline. It was left for you.',
  'work-auth-country-unknown': "The question doesn't say which country it means, so it was left for you.",
  'consent-requires-user': 'Agreeing is your decision, so this was left for you.',
  'attention-check': 'This question checks that you read the form. Answer it yourself.',
  'free-text-requires-user': 'Open questions are left for you to answer.',
  'drafts-disabled': 'Drafting open answers is off in Settings, so this was left for you.',
  'llm-disabled-for-category': 'The AI is never used for this kind of question, so it was left for you.',
  'llm-unavailable': 'The AI could not be reached, so this was left for you.',
  'llm-invalid-output': "The AI's answer could not be used, so this was left for you.",
  'llm-pick-rejected': 'The AI picked an option that failed a safety check, so nothing was chosen.',
  'saved-answer-not-allowed-for-category': 'Saved answers are never used for this kind of question, so it was left for you.',
  'end-date-not-applicable': 'You still work here, so the end date was left empty.',
  'sensitive-not-shared': "This browser may not read your work authorization and self-identification answers. To allow it, connect the extension again from TailorIT's Settings › Autofill with that box ticked.",
  'sensitive-unavailable': 'Your work authorization and self-identification answers could not be read from TailorIT just now, so this was left for you.',
  'statement-not-affirmative': "This box isn't worded as a plain yes, so whether to tick it was left for you.",
  // The matcher.
  'no-match': 'None of the options matched your profile.',
  'ambiguous-options': 'More than one option could match your answer, so none was chosen.',
  'distinctive-token-mismatch': 'The closest option names a different place or subject, so it was not chosen.',
  'waiting-for-options': "The list's options had not loaded yet.",
  'options-never-loaded': "The list's options never loaded.",
  'options-changed': "The list's options changed while filling. Check the choice.",
  'max-selections-reached': 'The question allows fewer choices than your profile has, so your first ones were chosen.',
  'partial-multi-select': 'Only some of your answers were found among the options.',
  'exclusive-conflict': 'An option like "None of the above" cannot go with your other answers, so this was left for you.',
  'preselected-left-untouched': 'Some options were already selected. Nothing was unticked.',
  // The Guard.
  honeypot: 'This field is hidden from people, so it was never touched.',
  'not-user-visible': "This field isn't visible, so it was not filled.",
  'no-visible-label': 'This field has no visible label, so it was not filled.',
  'canary-in-value': 'The answer held words that hidden page text asked AI tools to write, so it was blocked.',
  'canary-equals-profile-value': 'Hidden page text asked AI tools to write one of your own answers, so this field was blocked. Fill it yourself if the answer is right.',
  'missing-provenance': 'An answer arrived without saying where it came from, so it was blocked.',
  'policy-violation': 'This answer came from a source never used for this kind of question, so it was blocked.',
  'mark-all-aborted': 'Filling would have ticked every option, so nothing was ticked.',
  'exceeds-profile-set': 'Filling would have chosen more options than your profile has answers, so nothing was chosen.',
  'tripwire-in-label': "This question's own text addresses AI tools, so it was left for you.",
  'injected-option-only': 'The only matching option held words aimed at AI tools, so it was not chosen.',
  // Filling and checking.
  'verify-mismatch': 'The page shows something different from what was filled in. Check it.',
  'widget-unsupported': "This kind of control can't be filled yet.",
  'needs-your-click': 'This control responds only to your own click.',
  'unexpected-selection': 'This holds a selection that should not be there. Remove it yourself.',
  'element-not-found': 'The field was gone before it could be filled.',
  'disabled-or-readonly': 'The field cannot be changed: it is disabled or read-only.',
  'value-rejected-by-site': 'The site did not accept the answer.',
  'format-unsupported': 'The field asks for a format your answer cannot be written in.',
  'maxlength-exceeded': 'Your answer is longer than this field allows, and it was not cut short. Shorten it yourself.',
  'upload-control-not-recognized': "This upload control wasn't recognised, so nothing was attached.",
  'pdf-only-input': 'This upload takes PDF files only, and your resume is a Word file. Choose a PDF resume in TailorIT.',
  'resume-unavailable': 'Your resume could not be fetched from TailorIT.',
  'resume-transfer-failed': 'Your resume could not be attached. Attach it yourself.',
  'resume-format-unsupported': 'Your resume is an old Word file. Choose a PDF resume in TailorIT.',
  // The fill loop and the steps.
  'field-disappeared': 'The field disappeared while filling.',
  'value-oscillated': 'The page kept changing this answer, so filling stopped here.',
  'reveal-cycle': 'Answers kept revealing and hiding each other, so filling stopped here.',
  'max-passes-reached': 'The form kept changing, so filling stopped after several passes.',
  'page-busy': 'The page was still busy, so this was not filled yet.',
  'step-retry-limit': 'This step was tried twice already, so nothing more was filled on it.',
  'auth-required': 'This step needs you to sign in or create an account.',
  'challenge-present': 'The page asks you to prove you are human, so filling paused for you.',
  'policy-declined': 'You chose not to fill this posting.',
  'user-stopped': 'You stopped the fill.',
  'options-oscillated': "The list's options kept changing, so filling stopped here.",
  'changed-by-you': 'You changed this after it was filled, so it was left as you set it.',
  'policy-notice': 'This posting says AI-assisted applications are not allowed, so filling stopped here until you choose.',
  'form-hidden': 'The page hid this form while it was being filled, so filling stopped here.',
  // A bug.
  'internal-error': 'Something went wrong in the extension, so this was left for you.',
} as const satisfies Record<ReasonCode, string>;

/** The spec's five statuses, as a row's chip shows them. */
const STATUSES = {
  filled: 'Filled',
  verified: 'Verified',
  skipped: 'Skipped',
  flagged: 'Flagged',
  blocked: 'Blocked',
} as const satisfies Record<FillStatus, string>;

/** Where a written value came from. */
const PROVENANCES = {
  profile: 'Your profile',
  saved: 'A saved answer',
  rule: 'A rule',
  'llm-pick': 'AI pick',
  'llm-draft': 'AI draft',
} as const satisfies Record<Provenance, string>;

/** Which stage of the matcher chose the option. */
const STAGES = {
  cache: 'Remembered match',
  exact: 'Exact match',
  alias: 'Known alias',
  fuzzy: 'Close match',
  llm: 'AI tiebreak',
  other: '"Other" option',
  none: 'No match',
  'not-applicable': 'No options',
} as const satisfies Record<MatcherStage, string>;

/** A frame's run, in a few words. */
const RUN_STATUSES = {
  detect: 'Looking at the page',
  'auth-needed': 'Waiting for you to sign in',
  handoff: 'Waiting for you',
  'policy-notice': 'Waiting for your decision',
  'scan-step': 'Reading the form',
  'fill-step': 'Filling',
  validate: 'Checking the form',
  advance: 'Going to the next step',
  'wait-transition': 'Waiting for the next step',
  review: 'Ready for your review',
  done: 'Done',
  stopped: 'Stopped',
} as const satisfies Record<RunStatus, string>;

/** What a paused run waits for. */
const PAUSE_REASONS = {
  captcha: 'Complete the human check on the page yourself, then choose Continue.',
  'email-code': 'Enter the code the site sent you, then choose Continue.',
  'bot-check': 'The site is checking that you are human. When it lets you through, choose Continue.',
  'entry-choice': 'Choose on the page how you want to apply, then choose Continue.',
  'page-busy': 'The page is still busy. When it has settled, choose Continue.',
  'needs-click': 'The page needs your own click to go on. Make it, then choose Continue.',
} as const satisfies Record<PauseReason, string>;

const PLATFORM_NAMES = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
} as const satisfies Record<Platform, string>;

/** The in-page highlight's chip for each status that gets a highlight ('skipped' gets none). */
const CHIPS = {
  verified: 'Filled and checked',
  filled: 'Filled: please check',
  flagged: 'Needs you',
  blocked: 'Blocked',
} as const satisfies Record<Exclude<FillStatus, 'skipped'>, string>;

/** The report's own words (src/ui/report), shared by the side panel and, later, the in-page panel. */
const REPORT = {
  noLabel: '(no visible label)',
  required: 'Required',
  untitledSection: 'Form',
  source: 'Source',
  noSource: 'Nothing written',
  match: 'Match',
  confidence: 'Confidence',
  showOnPage: 'Show on page',
  showSuggestions: (count: number) => (count === 1 ? 'Show the closest option' : `Show the ${count} closest options`),
  hideSuggestions: 'Hide the options',
  suggestionsHeading: 'Closest options on the page',
  suggestionsLoading: 'Asking the page…',
  suggestionsFailed: 'The page could not show the options. Is the form still open?',
  frame: (platform: string, embedded: boolean) => (embedded ? `${platform} form, embedded in this page` : `${platform} form`),
  step: (index: number, of?: number) => (of === undefined ? `Step ${index + 1}` : `Step ${index + 1} of ${of}`),
  dryRun: 'Dry run: nothing was written.',
  hiddenIgnored: (count: number) => (count === 1 ? '1 hidden field was left alone.' : `${count} hidden fields were left alone.`),
} as const;

/** The side panel (src/ui/panel). */
const PANEL = {
  fill: 'Fill',
  dryRun: 'Dry run',
  continue: 'Continue',
  cancel: 'Cancel',
  noTab: 'No tab to follow. Open a job application in this window.',
  connectedAs: (name: string) => `Connected as ${name}`,
  connected: 'Connected to TailorIT',
  notConnected: 'Not connected to TailorIT.',
  expired: 'Your connection to TailorIT expired.',
  revoked: "TailorIT no longer accepts this browser's connection.",
  openSettings: 'Open settings',
  versionMismatch: 'This extension and your TailorIT use different versions, so nothing is filled until one of them is updated.',
  storageRefused: "Filling is blocked: this browser would not keep the extension's storage away from web pages. Update it to Chrome or Edge 144 or later.",
  started: (count: number) => (count === 0 ? 'No application form was found in this tab.' : `Filling ${forms(count)}.`),
  dryRunStarted: (count: number) =>
    (count === 0 ? 'No application form was found in this tab.' : `Dry run on ${forms(count)}: nothing will be written.`),
  continued: (count: number) => (count === 0 ? 'No form in this tab is waiting.' : `Continuing ${forms(count)}.`),
  cancelled: (count: number) => (count === 0 ? 'No form in this tab is running.' : `Stopped ${forms(count)}.`),
  needsConnection: 'Connect to TailorIT in the settings first.',
  rateLimited: 'Too many fills in a minute. Wait a little, then try again.',
  noAnswer: 'The extension did not answer. Close the panel and open it again.',
  failed: 'That did not work. Try again.',
  focusFailed: 'That field could not be shown. The page may have changed: choose Fill again.',
  linkLost: 'The panel lost its link to the extension, so it is not updating.',
  reconnect: 'Reconnect',
  extensionGone: 'The extension was updated or removed. Close this panel and open it again.',
} as const;

/** What the person pre-approves on the options page: one entry per consent category, the core's closed list. */
const CONSENT = {
  privacy: { name: 'Privacy notices', help: "Boxes saying you have read the employer's privacy notice or policy." },
  terms: { name: 'Terms and conditions', help: "Boxes accepting the site's terms of use or of service." },
  certify: { name: 'Accuracy statements', help: 'Boxes certifying that your application is true and complete.' },
  dataRetention: { name: 'Keeping your application on file', help: 'Boxes letting the employer keep your details for future openings.' },
  marketing: { name: 'News and job alerts', help: 'Boxes signing you up for newsletters, updates or job alerts.' },
  sms: { name: 'Text messages', help: 'Boxes agreeing to receive text messages.' },
  backgroundCheck: { name: 'Background checks', help: 'Boxes consenting to a background check or a consumer report.' },
  signature: { name: 'Signatures', help: 'Fields that ask you to type your full name as a signature: your profile\'s full name is typed.' },
} as const satisfies Record<ConsentCategory, { name: string; help: string }>;

/** The options page (src/ui/options). */
const OPTIONS = {
  saved: 'Saved.',
  notSaved: 'Not saved: the extension did not accept the change. Try again.',
  loading: 'Loading…',
  unreadable: 'The settings could not be read. Close this tab and open the settings again.',
  connection: {
    heading: 'Connection',
    /** The first-run disclosure, shown before Connect (the store's "prominent disclosure"). A draft for the owner. */
    disclosureHeading: 'Before you connect',
    disclosure: [
      'TailorIT Autofill fills job applications on Greenhouse, Lever, Ashby and Workday from the profile you keep in your own TailorIT. It reads the job pages you open on those sites, fills what it is sure of and lists the rest for you to review. It never submits an application: you do.',
      'When you choose Fill, it fetches your profile from TailorIT, and your resume when the form asks for one. It keeps them in memory only, never on disk: your profile until five minutes after its last use, and the resume only for the seconds it takes to attach it. This browser keeps your settings and notes on each application\'s progress, never your answers.',
      'Its AI help sends the visible text of a question and its visible options, with the answer from your profile it is trying to match, to your TailorIT, which asks Claude. Picking from lists and working out unusual questions are on unless you turn them off below. Drafting open answers is off unless you turn it on; it also gives Claude the posting\'s visible text and your profile to write from. Your self-identification, work authorization, sponsorship, pay and consent answers never go to the AI. The extension talks only to your TailorIT.',
    ],
    consentLine: 'Choosing Connect means you agree to this.',
    connect: 'Connect to TailorIT',
    connectedAs: (name: string, email: string) => `Connected as ${name} (${email}).`,
    connectedNoAccount: 'Connected to TailorIT.',
    sensitiveShared: 'This browser may read your work authorization and self-identification answers.',
    sensitiveNotShared: REASONS['sensitive-not-shared'],
    lastsUntil: (date: string) => `The connection lasts until ${date}.`,
    disconnect: 'Disconnect',
    disconnected: "Disconnected. TailorIT was asked to revoke this browser's connection too.",
    expired: 'Your connection expired: connections last 90 days. Connect again to keep filling.',
    revoked: "TailorIT stopped accepting this browser's connection: it was revoked in TailorIT, or the account was disabled. Connect again to keep filling.",
    versionMismatch: 'This version of the extension and your TailorIT use different versions of their connection, so nothing is filled until one of them is updated.',
    storageRefused: "Filling is blocked. This browser would not keep the extension's storage away from web pages, which needs Chrome or Edge 144 or later. Update the browser, then open these settings again.",
    waiting: 'Waiting for TailorIT. On the page that opened, choose "Connect the extension".',
    endsIn: (time: string) => `This request ends in ${time}.`,
    lapsed: 'The request timed out. Choose Connect to try again.',
    codeLabel: 'Or type the code TailorIT shows',
    codeHelp: '16 letters and digits, from Settings › Autofill in TailorIT.',
    codeSubmit: 'Connect with this code',
    codeInvalid: 'That is not a connect code. It has 16 letters and digits.',
    codeRefused: "TailorIT did not accept that code: it is wrong, already used or expired. Get a new one in TailorIT's Settings › Autofill.",
    rateLimited: (seconds?: number) =>
      (seconds === undefined ? 'Too many tries. Wait a minute, then try again.' : `Too many tries. Wait ${seconds} seconds, then try again.`),
    unreachable: 'TailorIT could not be reached. Check that it is running, then try again.',
    openFailed: "TailorIT's page could not be opened. Try again.",
  },
  panel: {
    heading: 'Review panel',
    intro: 'Where the list of filled and flagged fields appears.',
    side: "The browser's side panel",
    inPage: 'A panel on the application page',
    inPageLater: 'The panel on the page arrives in a later version. Until then the side panel shows the review, whichever you choose.',
  },
  filling: {
    heading: 'Filling',
    autoAdvance: 'Go to the next step for me',
    autoAdvanceHelp: 'On applications with several steps, press Next once a step is complete, settled and has nothing flagged. The final Submit is never pressed: you always submit yourself.',
  },
  consent: {
    heading: 'Consent boxes',
    intro: 'A consent box is ticked for you only when you pre-approve its kind here, and every kind starts off. A box that names several kinds is ticked only when you approved them all.',
    categories: CONSENT,
    certifyWarning: 'Certifying states that everything in an application is true and complete. Turn this on only if you check every application before you submit it.',
    never: 'Statements that you did not use AI, and consent the extension does not recognise, are always left for you.',
  },
  ai: {
    heading: 'AI help',
    intro: 'Through your TailorIT, which asks Claude. An answer the AI helped with is always flagged for you to check.',
    tiebreak: 'Pick from a list when unsure',
    tiebreakHelp: 'When your answer could match more than one option, the AI picks among the visible options.',
    classify: 'Work out unusual questions',
    classifyHelp: 'When no rule recognises a question, the AI says what it asks, so your profile can answer it.',
    drafts: 'Draft open answers',
    draftsHelp: 'Drafts answers to questions like "Why this company?" from your resume and the posting. A draft is highlighted and waits for you to edit or confirm it.',
    never: 'Your EEO, authorization and sponsorship answers never go to the AI, and questions that look like them are not sent to it.',
  },
  interpretations: {
    heading: 'Interpretations',
    intro: 'Two readings that go further than the rules say. Each is off until you turn it on.',
    postingCountryForLegal: 'Answer work authorization questions that name no country',
    postingCountryForLegalHelp: 'Uses your answer for the country of the posting. The field stays flagged for you to check.',
    twoOrMoreRaces: 'Answer "Two or More Races"',
    twoOrMoreRacesHelp: 'When you gave several races and the question takes one answer. The field stays flagged for you to check.',
  },
  data: {
    heading: 'Saved runs',
    intro: 'So that an application with several steps can continue after a reload, the extension keeps notes on each run for 24 hours: steps, field keys and counts, never your answers.',
    clear: 'Clear saved runs',
    cleared: (count: number) =>
      (count === 0 ? 'There were no saved runs.' : count === 1 ? 'Cleared 1 saved run.' : `Cleared ${count} saved runs.`),
    failed: 'The saved runs could not be cleared. Try again.',
  },
} as const;

export const COPY = {
  appName: 'TailorIT Autofill',
  panelTitle: 'Review',
  panelEmpty: 'Nothing to review yet. Open a job application and choose Fill.',
  optionsTitle: 'TailorIT Autofill settings',
  tripwire: NOTICES.tripwire,
  notices: NOTICES,
  /** The policy card's two buttons (in the page and in the side panel). */
  policyFillAnyway: 'Fill anyway',
  policyCancel: 'Cancel',
  /** Under the page's policy card when only TailorIT's saved copy of the posting said it. */
  policyFromStoredCopy: "This was found in TailorIT's saved copy of the posting.",
  // The in-page UI (src/content/ui): the launcher's name in each state (its tooltip and accessible name), a notice's
  // dismiss button, and the highlights' chips. Drafts from the content runtime, for the owner's review.
  launcherFill: 'Fill this application with TailorIT',
  launcherRunning: 'Filling the application',
  launcherNeedsYou: 'This needs you. Choose to continue.',
  launcherPolicy: 'This posting says AI-assisted applications are not allowed. See the notice.',
  launcherReview: (count: number) => (count === 1 ? 'Review: 1 field needs you' : `Review: ${count} fields need you`),
  launcherError: 'Something went wrong. Choose to try again.',
  launcherNotConnected: 'Connect TailorIT Autofill to TailorIT in its settings, then try again.',
  dismiss: 'Dismiss',
  /** The chip of a selection the final check refused, which the extension never unticks (the plan's words). */
  removeSelection: 'Remove this selection',
  /** The chip of an AI draft that waits for the person. */
  draftChip: 'AI draft: please confirm',
  chips: CHIPS,
  /** One sentence per reason code. */
  reasons: REASONS,
  statuses: STATUSES,
  provenances: PROVENANCES,
  stages: STAGES,
  runStatuses: RUN_STATUSES,
  pauseReasons: PAUSE_REASONS,
  platforms: PLATFORM_NAMES,
  report: REPORT,
  panel: PANEL,
  options: OPTIONS,
} as const;

/**
 * The development build's capture tool (docs/FIXTURES.md): its keyboard commands and its page. A separate export, so
 * the production bundles, which never import it, carry none of it.
 */
export const CAPTURE_COPY = {
  commandNow: 'Save this page for a test fixture (development build)',
  commandLater: 'Save this page for a test fixture in 3 seconds (development build)',
  title: 'Page snapshot (development build)',
  saving: 'Saving the page…',
  saved: (size: string) => `Saved the page and every frame in it (${size}).`,
  save: (name: string) => `Save ${name}`,
  next: 'Put the file in fixtures/_incoming/ and convert it with scripts/mhtml-to-fixture.mjs (docs/FIXTURES.md). It may hold personal data: it stays out of git.',
  failed: 'This tab could not be saved. It may have closed, or it is a browser page that cannot be saved.',
  noTab: 'No tab to save. Press the hotkey on the page you want to capture.',
} as const;
