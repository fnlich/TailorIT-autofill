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
import type {
  AutofillAgentFinishedState, AutofillAgentReason, AutofillFileKind, DegreeLevel, ExpectedSalaryPeriod, GenderIdentity,
  RaceCategory, ResumeChoiceReason, WorkArrangement, WorkStatus,
} from '../contract/tailorit';
import type { ConsentCategory, FieldKind, FillStatus, MatcherStage, Platform, Provenance } from '../core/enums';
import type { ReasonCode } from '../core/types/fill';
import type { PauseReason, RunStatus } from '../core/types/run';
import type {
  AddJobOutcome, AgentBlock, AgentStatus, AskLength, AskOutcome, JobSearchRefusal, LetterOutcome, PressOutcome,
  ProfileSaveRefusal, SaveAnswerOutcome, SiteRequestOutcome, SubmittedState,
} from '../messaging/schemas';
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
  validation: 'The form shows errors. The review lists the fields that need you.',
  'needs-click': 'Some controls respond only to your own click. The review lists them for you.',
  'posting-outside-frame': 'This form sits inside another site\'s page, which cannot be read, so that page\'s text was not checked.',
  'deferred-fields': 'Some fields were not rendered yet. Scroll to them and choose Autofill again.',
  'step-retry-limit': 'This step was tried twice already, so nothing more is filled on it.',
  'policy-hidden-text': 'Text on this page that is not shown yet says AI-assisted applications may not be allowed. Read the whole posting before you submit.',
  'form-hidden': 'This form is hidden or out of view on its page, so nothing was filled. Scroll it into view, then choose Autofill again.',
  // The step machine (Phase 5): final-unknown is the plan's exact sentence, max-steps the coordinator's (2026-10-30).
  'final-unknown': "I can't tell whether this is the last step, so I won't press anything.",
  'max-steps': 'This application has more steps than I can follow, so I stopped here. Please finish it yourself.',
  // The Phase 5 review (X-S8): a draft for the owner's review.
  'next-hidden': "This form went out of view on its page, so I didn't press Next. Scroll it into view, then press Next yourself or choose Continue.",
  'captcha-next': "This step still shows a check that you are human, so I won't press Next. Complete it, then press Next yourself.",
  // Phase 6: said under the policy sentence, in the page's card and the panel's alike.
  'policy-stored-copy': "This was found in TailorIT's saved copy of the posting.",
  // The owner's amendments (docs/SPEC-AMENDMENTS.md): a run filled from the profile only, with no AI request. Drafts
  // for the owner's review.
  'policy-profile-only': 'This posting says AI-assisted applications are not allowed, so only your TailorIT profile was used. Nothing was sent to the AI.',
  'ai-attestation': 'This form asks you to confirm you did not use AI, so only your TailorIT profile was used and nothing was sent to the AI. That box is left for you.',
  // v3 Phase 3 (Autofill after page turn: Manually): a draft for the owner's review.
  'page-turned': 'This is a new page of the application. Choose Continue to fill it.',
  // v3 Phase 4 (Submit mode Auto held the Submit back; a Submit no confirmation followed): drafts for the owner's review.
  'submit-held-required': 'Submit is on Auto, but required fields are still empty, so the Submit is yours. Fill them, then submit.',
  'submit-held-no-ai': 'Submit is on Auto, but this posting says AI-assisted applications are not allowed, so the Submit is yours.',
  'submit-held-guess': "Submit is on Auto, but a legal answer is the AI's guess, so the Submit is yours. Check it, then submit.",
  'submit-held-captcha': 'Submit is on Auto, but this page asks you to prove you are human, so the Submit is yours. Complete it, then submit.',
  'submit-held-check': "Submit is on Auto, but this page isn't ready to submit by itself (a draft to confirm, or the page still changing), so the Submit is yours.",
  // The Phase 7a review: a draft for the owner's review.
  'submit-held-attention': 'Submit is on Auto, but a question checks something only you can answer (an attention check, or a phrase the posting asked for), so the Submit is yours. Answer it, then submit.',
  'submit-held-entries': 'Submit is on Auto, but entries from your profile (education or experience) are still to add here, so the Submit is yours. Add them, then submit.',
  'submit-unconfirmed': "Submit was pressed, but the page didn't confirm the application. Check the page for errors, then submit again.",
  // The v3 Phase 4 review: the page refused a Submit (its errors, its failure message), and Submit mode Auto submitted
  // a posting whose AI rule couldn't be read. Drafts for the owner's review.
  'submit-errors': "Submit was pressed, but the page didn't accept the application: it shows what to fix. Fix it, then submit again.",
  'submit-auto-unchecked': "I couldn't read this posting to check whether it allows AI tools, and Submit is on Auto, so the application was submitted anyway.",
  // v3 Phase 5 (Sign-in mode Auto): drafts for the owner's review.
  'sign-in-auto': 'Sign-in is on Auto: signing you in with the job-site sign-in you saved in TailorIT.',
  'sign-in-unavailable': 'Sign-in is on Auto, but no job-site sign-in you saved in TailorIT can be used on this page. Sign in yourself, then choose Continue.',
  'sign-in-failed': "Signing in with your saved job-site sign-in didn't work, and it won't be tried again here. Check it in TailorIT's Settings › Autofill, then sign in yourself.",
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
  'llm-draft-held': 'The AI drafted this answer. This site saves each answer the moment it is filled in, so the draft goes in only when you confirm it.',
  'other-option-with-free-text': 'No option fit, so "Other" was chosen and your answer typed in. Check it.',
  'other-without-free-text': 'No option fit, so "Other" was chosen. Add any details the form asks for yourself.',
  'option-label-had-injected-text': 'An option held words aimed at AI tools. They were ignored, but check the choice.',
  // Gaps in what could be resolved.
  'no-profile-value': 'Your profile has no answer for this.',
  'unknown-field': "It isn't clear what this question asks, so it was left for you.",
  'low-confidence': 'No answer was certain enough to fill in, so it was left for you.',
  'classification-conflict': 'The question could be read in more than one way. Check this field.',
  'eeo-not-in-profile': 'Your profile has no self-identification answer for this, so it was left for you.',
  'legal-not-in-profile': "Your profile doesn't answer this legal question, so it was left for you. Answer it once in TailorIT's Settings › Autofill.",
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
  'criminal-not-covered': "Your answer about criminal convictions doesn't settle this question, so it was left for you.",
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
  'upload-failed': 'The file was attached, but the site says it failed to upload. Attach it again yourself.',
  'upload-not-confirmed': 'The file was attached, but the site never showed it uploaded. Check it before you submit.',
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
  // Drafts (Phase 6): a draft that was not written, and why. Drafts for the owner's review.
  'draft-empty': 'Your resume and profile had nothing to draft this answer from, so it was left for you.',
  'draft-too-long': 'The AI draft was longer than this field allows, so it was not written. Answer it yourself.',
  'draft-ai-reference': 'The AI draft spoke of being an AI, so it was not written. Answer it yourself.',
  'draft-wrapper': 'The AI draft held text from its own instructions, so it was not written. Answer it yourself.',
  'draft-contact': 'The AI draft named a link, email or phone number that is not yours, so it was not written.',
  // The owner's amendments (docs/SPEC-AMENDMENTS.md): written by AI and accepted, or chosen for you; then what was left.
  // Drafts for the owner's review.
  'llm-draft-written': 'The AI wrote this answer from your resume. Read it before you submit.',
  'llm-answer-written': 'The AI answered this from your resume and profile. Check it before you submit.',
  'ai-guess': "Your resume and profile don't answer this, so the AI gave its best guess. Check it before you submit.",
  'eeo-decline-default': "You haven't answered this in TailorIT, so the form's option to decline was chosen.",
  'llm-no-answer': 'The AI had no answer for this, so it was left for you.',
  'ai-off-for-posting': "This posting doesn't allow AI, and only the AI could answer this, so it was left for you.",
  // Cover letters (Phase G): drafts for the owner's review.
  'cover-letter-attached': 'Your cover letter for this job was attached from TailorIT.',
  'cover-letter-written': "TailorIT's AI wrote this cover letter for the job from your resume. Read it in TailorIT before you submit.",
  'cover-letter-would-write': "You have no cover letter for this job, so a fill has TailorIT's AI write one from your resume.",
  'cover-letter-waiting': 'TailorIT is finding or writing your cover letter for this job.',
  'cover-letter-failed': "TailorIT couldn't write a cover letter for this job, or yours isn't finished. Finish it in TailorIT, or attach one yourself.",
  'cover-letter-none': 'You have no finished cover letter for this job in TailorIT, and its AI may not write one here, so this was left for you.',
  'cover-letter-unavailable': 'Your cover letter could not be brought from TailorIT just now, so this was left for you.',
  'cover-letter-timed-out': 'TailorIT took too long writing your cover letter, so this was left for you. Check it in TailorIT, then attach it.',
  'cover-letter-reconnect': "This connection can't attach cover letters. Connect the extension again from TailorIT's Settings › Autofill.",
  // The owner's decisions of 2026-11-01 (docs/SPEC-AMENDMENTS.md §11): drafts for the owner's review.
  'consent-optional-unticked': "This box is optional and you haven't allowed it in Settings, so it was left unticked.",
  'ai-attestation-ai-used': "This fill used AI, so ticking that you didn't use AI would be untrue. It was left for you.",
  // v3 Phase 3: the side panel's Skip. A draft for the owner's review.
  'skipped-by-you': 'You skipped this field while it was being filled, so it was left for you.',
  // v3 Phase 3b: drafts for the owner's review.
  'resume-not-attached': 'You chose to apply without a resume, so none was attached. Attach one yourself if the form needs it.',
  'cover-letter-typed': 'Your cover letter for this job was typed in from TailorIT.',
  'cover-letter-too-long': "Your cover letter for this job is longer than this box allows, so it wasn't typed in or cut short. Shorten it in TailorIT, or write a shorter one here.",
  // The Phase 7a review: a draft for the owner's review.
  'conditional-question': "This question follows up an answer above that doesn't call for it, or that you haven't given yet, so it was left for you.",
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
  'llm-answer': 'AI answer',
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

/** The kinds of field, as the options page's counters name them. */
const FIELD_KIND_NAMES = {
  text: 'Text',
  textarea: 'Text box',
  select: 'List',
  radio: 'Choice',
  checkbox: 'Checkbox',
  'checkbox-group': 'Checkboxes',
  combobox: 'Dropdown',
  multiselect: 'Multiple choice list',
  'typeahead-remote': 'Search box',
  date: 'Date',
  file: 'File upload',
} as const satisfies Record<FieldKind, string>;

const PLATFORM_NAMES = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  workable: 'Workable',
} as const satisfies Record<Platform, string>;

/** The report's own words (src/ui/report), shared by the side panel and the in-page panel. */
const REPORT = {
  noLabel: '(no visible label)',
  required: 'Required',
  untitledSection: 'Form',
  source: 'Source',
  noSource: 'Nothing written',
  /** Phase G: a cover-letter upload's source, the person's letters in TailorIT. */
  coverLetterSource: "Your TailorIT cover letters",
  /** The v3 Phase 4 review: a cover letter longer than its text box takes, in characters. */
  letterLength: (length: number, limit: number) => `Your letter is ${length} characters; this box takes ${limit}.`,
  match: 'Match',
  confidence: 'Confidence',
  showOnPage: 'Show on page',
  /** Phase 6: an AI draft waits for the person (wave 2 wires what it does). */
  confirmDraft: 'Confirm draft',
  draftMark: 'AI draft',
  /** The completion's line on the AI's answers: "3 answers written by AI · 1 is a guess". */
  aiAnswers: (written: number, guesses: number) => `${written === 1 ? '1 answer' : `${written} answers`} written by AI${
    guesses === 0 ? '' : guesses === 1 ? ' · 1 is a guess' : ` · ${guesses} are guesses`}`,
  /** Phase 6: offered only after the person fixed a flagged field themselves (Requirement F; wave 2 wires the save). */
  saveAnswer: 'Save my answer',
  showSuggestions: (count: number) => (count === 1 ? 'Show the closest option' : `Show the ${count} closest options`),
  hideSuggestions: 'Hide the options',
  suggestionsHeading: 'Closest options on the page',
  suggestionsLoading: 'Asking the page…',
  suggestionsFailed: 'The page could not show the options. Is the form still open?',
  frame: (platform: string, embedded: boolean) => (embedded ? `${platform} form, embedded in this page` : `${platform} form`),
  step: (index: number, of?: number) => (of === undefined ? `Step ${index + 1}` : `Step ${index + 1} of ${of}`),
  dryRun: 'Dry run: nothing was written.',
  hiddenIgnored: (count: number) => (count === 1 ? '1 hidden field was left alone.' : `${count} hidden fields were left alone.`),
  // The progress (v3 Phase 3, the owner's choice of Jobright's percent; it was counts only): "Scanning the page…" while
  // the form is read, "Autofilling… 78%" while it fills, then "9 of 12 required fields filled · 75%". The percent is of
  // the required fields filled (shared/report.ts progressOf), of every field when none is required. Drafts for the
  // owner's review.
  scanning: 'Scanning the page',
  scanningTitle: 'Reading the form',
  scanningHelp: 'TailorIT is checking this page for what the application asks.',
  autofilling: 'Autofilling',
  percent: (value: number) => `${value}%`,
  progressFilled: (filled: number, of: number, requiredOnly: boolean) =>
    `${filled} of ${of} ${requiredOnly ? 'required fields' : 'fields'} filled`,
  progressDryRun: (filled: number, of: number, requiredOnly: boolean) =>
    `${filled} of ${of} ${requiredOnly ? 'required fields' : 'fields'} would be filled`,
  progressLabel: 'Progress',
  progressText: (filled: number, of: number, requiredOnly: boolean, percent: number) =>
    `${filled} of ${of} ${requiredOnly ? 'required fields' : 'fields'} filled, ${percent}%`,
  progressWorking: (percent: number, requiredOnly: boolean) =>
    `Autofilling, ${percent}% of the ${requiredOnly ? 'required ' : ''}fields filled`,
  /** The progress line's toggle: the field lists shown or folded. */
  showFields: 'Show the fields',
  hideFields: 'Hide the fields',
  /** The field lists' two groups, as Jobright names them. */
  requiredGroup: 'Required',
  optionalGroup: 'Optional',
  /** A row's state, said to a screen reader beside its icon. */
  rowStates: { filled: 'Filled', missing: 'Needs you', working: 'Being filled', none: 'Left alone' },
  /** The row's label is a button that shows the field on the page; its chevron folds the details. */
  goTo: (label: string) => `Show "${label}" on the page`,
  details: (label: string) => `Details of "${label}"`,
  /** What the run left aside, under the lists (v3 Phase 3 review): the hidden fields left alone. */
  moreDetails: 'More details',
  /** Skip, offered on the field being filled after 2 s on it. */
  skip: 'Skip',
  skipLabel: (label: string) => `Skip "${label}"`,
  /** A repeatable section's row: "Education · 2 of 3 added". */
  sectionAdded: (name: string, added: number, of: number) => `${name} · ${added} of ${of} added`,
  repeatables: { experience: 'Work experience', education: 'Education', language: 'Languages' },
  /** Worded apart from the launcher's "Review: N fields need you", which also counts the Add buttons left. */
  needsYou: (count: number) => (count === 1 ? '1 field is left for you' : `${count} fields are left for you`),
  needsYouDryRun: (count: number) => (count === 1 ? '1 field would be left for you' : `${count} fields would be left for you`),
  allClear: 'Nothing needs you. Check the form, then submit it yourself.',
  /** A form among several, under its own name, when the tab holds more than one or one embedded in its page. */
  frameLine: (name: string, status: string) => `${name} · ${status}`,
} as const;

/** The side panel (src/ui/panel). */
const PANEL = {
  fill: 'Autofill',
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
  versionMismatch: 'This extension and your TailorIT use different versions, so nothing is filled. Update the older one, then connect again in the settings.',
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
  focusFailed: 'That field could not be shown. The page may have changed: choose Autofill again.',
  linkLost: 'The panel lost its link to the extension, so it is not updating.',
  reconnect: 'Reconnect',
  extensionGone: 'The extension was updated or removed. Close this panel and open it again.',
  /** The header's gear: the extension's own settings. */
  settings: 'Settings',
  /** The gear's menu (v3 Phase 3): the modes, then a link to every setting. Drafts for the owner's review. */
  menu: 'Settings and modes',
  modes: 'Modes',
  allSettings: 'All settings',
  /** The launcher hidden by the person (v3 Phase 3): the toolbar icon opens this panel, which shows it again. */
  launcherHidden: {
    visit: 'The TailorIT button is hidden on this page until you visit it again.',
    site: 'The TailorIT button is hidden on this site.',
    everywhere: 'The TailorIT button is hidden on every site.',
  },
  showLauncher: 'Show the TailorIT button again',
  /** After Show: the report page (a tab of its own) has it back at once; the browser's side panel keeps it hidden on
   *  the page it shows until the panel closes. */
  launcherShown: 'The TailorIT button is back on the page.',
  launcherShownAfterPanel: 'The TailorIT button shows on the page again once you close this panel.',
  /** A page Autofill does not work on (v3 Phase 3). Drafts for the owner's review. */
  unsupported: {
    heading: "Autofill isn't supported on this page",
    intro: 'TailorIT Autofill fills job applications on these sites:',
    // Workday joins the list once it has an adapter of its own (v3 Phase 3 review).
    sites: [
      { name: 'Greenhouse', hosts: 'job-boards.greenhouse.io, boards.greenhouse.io' },
      { name: 'Lever', hosts: 'jobs.lever.co' },
      { name: 'Ashby', hosts: 'jobs.ashbyhq.com' },
      { name: 'Workable', hosts: 'apply.workable.com' },
    ],
    embedded: 'A company page that shows one of these forms inside it works too.',
    /** A page on one of those sites that opened before the extension could read it (installed or updated since). */
    reloadHeading: 'Reload this page to use Autofill',
    reloadIntro: 'This page opened before TailorIT Autofill could read it. Reload it, and Autofill works here.',
  },
  /** v3 Phase 3b: "Ask TailorIT to support this site", on a page Autofill does not work on. Drafts for the owner. */
  siteRequest: {
    ask: 'Ask TailorIT to support this site',
    asking: 'Sending…',
    help: 'Only the site\'s name (like careers.example.com) goes to your TailorIT, which lists it in Settings › Autofill.',
    outcomes: {
      sent: 'Sent. TailorIT lists this site in Settings › Autofill.',
      'no-host': "The browser didn't say which site this is. Open this panel with the TailorIT Autofill icon in the toolbar while this page shows, then ask again.",
      'not-allowed': "This connection can't send requests. Connect the extension again from TailorIT's Settings › Autofill.",
      'not-connected': 'Connect to TailorIT in the settings first.',
      'rate-limited': 'Too many requests in a minute. Wait a little, then try again.',
      unavailable: "TailorIT couldn't be reached just now. Try again.",
    } satisfies Record<SiteRequestOutcome, string>,
  },
  /** v3 Phase 4: the panel's buttons for the page's own Next and Submit, and what came of a press. Drafts. */
  step: {
    next: 'Continue to the next page',
    submit: 'Submit application',
    submitting: 'Submitting…',
    confirmEmpty: (count: number) => (count === 1 ? '1 required field is still empty. Submit anyway?'
      : `${count} required fields are still empty. Submit anyway?`),
    submitAnyway: 'Submit anyway',
    keepEditing: 'Not yet',
    outcomes: {
      pressed: 'Pressed on the page.',
      'required-empty': 'Required fields are still empty.',
      'not-offered': 'The page no longer shows that button. Check the page.',
      blocked: 'The page asks you to do something first (a check that you are human, a sign-in or a code).',
      refused: "That button can't be pressed for you. Press it on the page yourself.",
      busy: 'Autofill is still working on this page. Wait for it to finish.',
      gone: 'The form is no longer there. Reload the page.',
      'not-accepted': "The page didn't accept it. It shows what to fix.",
    } satisfies Record<PressOutcome, string>,
    /** The review: the page's own checks refused a press, `count` fields marked. */
    notAccepted: (count: number) => (count === 1 ? "The page didn't accept it: 1 field shows an error. Fix it, then try again."
      : `The page didn't accept it: ${count} fields show an error. Fix them, then try again.`),
    /** The review (Jobright's "Submitted!"): the dock's button once the platform confirmed the application. */
    submitted: 'Submitted',
  },
  /** v3 Phase 4: after the platform confirmed the application. Drafts for the owner's review. */
  submitted: {
    title: 'Application submitted',
    openTracker: 'Open Job Tracker',
    /** The job the application was for, when the card names it. */
    job: (title: string, company: string) => (company === '' ? title : title === '' ? company : `${title} at ${company}`),
    states: {
      recording: 'Adding it to your Job Tracker…',
      recorded: 'Added to your Job Tracker as Applied.',
      'not-recorded': "Your Job Tracker couldn't be told. Try again, or mark it Applied in TailorIT.",
      'not-allowed': "This connection can't change your Job Tracker. Connect the extension again from TailorIT's Settings › Autofill.",
    } satisfies Record<SubmittedState, string>,
    tryAgain: 'Try again',
  },
  /** The v3 Phase 4 review: the disclosure changed since the person connected. Drafts for the owner's review. */
  disclosureChanged: {
    heading: 'What TailorIT Autofill does has changed',
    intro: 'Read what changed before Autofill submits for you, signs in for you, applies by itself or tells your TailorIT about pages as they load.',
    understand: 'I understand',
    held: 'Until you choose I understand, Submit and Sign-in stay Manual, auto-apply stays off, submitted applications are not recorded, and pages are looked up only when you open the side panel.',
  },
  /** The links at the panel's foot, to the person's TailorIT. */
  autofillInfo: 'Your autofill information',
  openJobs: 'Open TailorIT Jobs',
  // Phase 6: the rows' Confirm draft and Save my answer.
  draftConfirmed: 'Draft confirmed.',
  confirmFailed: 'The draft could not be confirmed. Is the form still open?',
  answerSaved: 'Your answer was saved in TailorIT.',
  saveFailed: 'Your answer could not be saved. Try again.',
  /** Phase 6, wave 2: what came of Save my answer, by its outcome. Drafts for the owner's review. */
  saveOutcomes: {
    saved: 'Your answer was saved in TailorIT.',
    sensitive: "This answer wasn't saved: TailorIT never keeps answers to self-identification, work authorization, pay, consent or attention-check questions.",
    limit: "This answer wasn't saved: you have saved as many answers as TailorIT keeps. Remove some in TailorIT's Settings › Autofill › Saved answers.",
    unsupported: "This answer can't be saved: it is empty, or this kind of question takes no saved answer.",
    'company-unknown': "This answer wasn't saved: it would be kept for this company only, and this form's address doesn't say which company it is.",
    canary: "This answer wasn't saved: it holds words that hidden page text asked AI tools to write.",
    'not-allowed': "This answer wasn't saved: this browser's connection may not save answers. Connect it again from TailorIT's Settings › Autofill.",
  } satisfies Record<SaveAnswerOutcome, string>,
} as const;

/** The side panel's strip before any run (v2): what the tab's page holds. */
const STRIP = {
  form: (platform: string | null) => (platform === null ? 'Application form found' : `${platform} application form found`),
  noForm: 'No application form on this page. Open its application to use Autofill.',
  none: 'Open a job application on Greenhouse, Lever, Ashby, Workday or Workable to use Autofill.',
} as const;

/** "Posted 2 days ago", from whole days since it was posted. */
function posted(days: number): string {
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 14) return `Posted ${days} days ago`;
  if (days < 60) return `Posted ${Math.floor(days / 7)} weeks ago`;
  return `Posted ${Math.floor(days / 30)} months ago`;
}

/** The side panel's job card (v2, src/ui/panel/JobCard.tsx): what TailorIT knows of the job, before and during a fill.
 *  Drafts for the owner's review. */
const JOB = {
  region: 'This job',
  loading: 'Reading what TailorIT knows of this job…',
  unavailable: "TailorIT couldn't say which job this is. Autofill still works.",
  disconnected: 'Connect to TailorIT to see this job, your match and the resume it attaches.',
  notFound: 'Not in your TailorIT jobs',
  notFoundHelp: 'Autofill still works. Add the job to TailorIT to track it and see your match.',
  cannotAdd: "TailorIT can't add jobs from this site yet. Autofill still works.",
  add: 'Add this job to TailorIT',
  save: 'Save to tracker',
  adding: 'Adding…',
  addOutcomes: {
    added: 'Added to your TailorIT jobs, and to your tracker as Saved.',
    saved: 'Saved to your tracker.',
    closed: "This posting has closed, so TailorIT couldn't add it.",
    unsupported: "TailorIT can't add jobs from this site yet.",
    'not-allowed': "This browser's connection can't add jobs. Connect it again from TailorIT's Settings › Autofill.",
    'rate-limited': 'Too many jobs added in a minute. Wait a little, then try again.',
    'not-connected': 'Connect to TailorIT in the settings first.',
    unavailable: "TailorIT couldn't add the job just now. Try again.",
  } satisfies Record<AddJobOutcome, string>,
  via: (platform: string) => `${platform} application`,
  /** The match's band by its percentage (v3 Phase 3, Jobright's wording): MATCH_BANDS. Drafts for the owner's review. */
  bands: { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' },
  bandLine: { excellent: 'Excellent match', good: 'Good match', fair: 'Fair match', poor: 'Low match' },
  matchLabel: (percentage: number, band: string) => `${percentage}% match: ${band}`,
  matchTip: (matched: number, total: number) =>
    `${matched} of ${total} keywords in this posting are in your resume. The score is how well your resume covers what the job asks for.`,
  matchTipLabel: 'About the match score',
  keywords: (matched: number, total: number) => `${matched} of ${total} keywords`,
  /** The badge on a job the tracker holds as Applied or later. */
  applied: 'Applied',
  /** The documents box (v3 Phase 3, Jobright's "Your Autofill Information" box). */
  documents: 'What the fill uses',
  autofillInfo: 'Your autofill information',
  noKeywords: 'This posting names no keywords to match.',
  unreadable: "This resume's text couldn't be read, so it has no match score.",
  attaches: 'Attaches',
  wouldAttach: 'Would attach',
  change: 'Change',
  noResume: 'No resume to attach. Add one in TailorIT.',
  closed: 'Closed',
  archived: 'Archived',
  /** The tracker chip of a status code TailorIT added after this version. */
  tracked: 'In your tracker',
  posted,
  alreadyApplied: (status: string | null) => (status === null ? 'Already in your tracker. Check before you apply again.'
    : `Already in your tracker as ${status}. Check before you apply again.`),
  arrangements: { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' } satisfies Record<WorkArrangement, string>,
  resumeReasons: {
    chosen: 'Chosen by you',
    application: 'Linked to this job',
    profile: 'Chosen in your profile',
    best_match: 'Your best match for this job',
    only_resume: 'Your only resume',
    default: 'Your default resume',
    latest: 'Your latest resume',
  } satisfies Record<ResumeChoiceReason, string>,
  fileKinds: { pdf: 'PDF', docx: 'Word', doc: 'Word' } satisfies Record<AutofillFileKind, string>,
  /** Phase G: the card's cover-letter row, below the resume. Drafts for the owner's review. */
  letter: {
    label: 'Cover letter',
    checking: 'Checking TailorIT for your letter…',
    yours: 'Your letter for this job',
    written: "Your letter for this job, written by TailorIT's AI just now",
    whenAsked: 'Written by AI when the form asks for one',
    profileOnly: "This posting doesn't allow AI, so only a letter you wrote is attached.",
    aiOff: 'AI-written answers are off, so only a letter you wrote is attached.',
    failed: "Your letter for this job isn't finished. Finish it in TailorIT's Cover Letters.",
    notAllowed: "This connection can't attach cover letters. Connect it again from TailorIT's Settings › Autofill.",
    write: 'Write it now',
    writing: 'Writing…',
    ready: 'Ready',
    couldNot: "Couldn't write it",
    outcomes: {
      yours: 'Ready',
      written: 'Ready',
      none: "Couldn't write it",
      failed: "Couldn't write it",
      'ai-off': "Couldn't write it: AI-written answers are off, or this posting doesn't allow AI.",
      'not-allowed': "Couldn't write it: connect the extension again from TailorIT's Settings › Autofill.",
      'rate-limited': "Couldn't write it: too many requests in a minute. Wait a little, then try again.",
      'not-connected': 'Connect to TailorIT in the settings first.',
      unavailable: "Couldn't write it: TailorIT couldn't be reached just now. Try again.",
    } satisfies Record<LetterOutcome, string>,
  },
  /** v3 Phase 3b: "Autofill for another job". Drafts for the owner's review. */
  another: {
    open: 'Autofill for another job',
    heading: 'Autofill for another job',
    help: 'Fill this form for a job in your TailorIT tracker: its match, its resume and its details are used.',
    label: 'Search your tracked jobs',
    placeholder: 'Job title or company',
    searching: 'Searching…',
    none: 'No job in your tracker matches.',
    use: 'Use this job',
    pageJob: "Use this page's own job",
    close: 'Close',
    chosen: 'Chosen by you for this page',
    /** The review: the choice could not be kept (the page changed, or the search is gone). */
    failed: "That job couldn't be chosen: the page changed. Search again.",
    outcomes: {
      'not-allowed': "This connection can't search your jobs. Connect the extension again from TailorIT's Settings › Autofill.",
      'not-connected': 'Connect to TailorIT in the settings first.',
      'rate-limited': 'Too many searches in a minute. Wait a little, then try again.',
      unavailable: "Your jobs couldn't be searched just now. Try again.",
    } satisfies Record<JobSearchRefusal, string>,
  },
  /** v3 Phase 3b: Change's "Apply without resume" and the resume's preview. Drafts for the owner's review. */
  withoutResume: 'Apply without resume',
  withoutResumeHelp: 'No resume will be uploaded. Autofill uses your autofill information.',
  withoutResumeOn: 'No resume will be attached',
  /** The review: Apply without resume could not be kept (no form or posting of ours in the tab now). */
  withoutFailed: "That couldn't be changed: the page changed. Try again.",
  preview: {
    open: 'Preview',
    close: 'Close the preview',
    title: (label: string) => `Preview of ${label}`,
    loading: 'Loading the resume…',
    unavailable: "This resume's preview couldn't be shown.",
    notPdf: 'Only a PDF resume has a preview.',
    openTab: 'Open it larger',
  },
  picker: {
    heading: 'Choose the resume to attach',
    loading: 'Reading your resumes…',
    failed: "Your resumes couldn't be read. Try again.",
    empty: 'You have no resume to attach. Add one in TailorIT.',
    current: 'Attached now',
    suggested: "Use TailorIT's choice",
    cancel: 'Cancel',
    kinds: { built: 'Built in TailorIT', uploaded: 'Uploaded' },
  },
} as const;

/** The side panel's "Ask a custom question" (v2, src/ui/panel/Ask.tsx). Drafts for the owner's review. */
const ASK = {
  heading: 'Ask a custom question',
  label: 'Your question',
  placeholder: 'e.g. Why do you want to work at Northwind?',
  length: 'Length',
  lengths: { short: 'Short', medium: 'Medium', long: 'Long' } satisfies Record<AskLength, string>,
  submit: 'Get answer',
  working: 'Writing your answer…',
  writtenFrom: (label: string) => `Written from your resume: ${label}`,
  copy: 'Copy',
  copied: 'Copied.',
  copyFailed: 'It could not be copied. Select the text and copy it yourself.',
  regenerate: 'Regenerate',
  notConnected: 'Connect to TailorIT to ask a question.',
  policy: 'This posting says AI-assisted applications are not allowed. An answer you ask for here is still written by AI.',
  outcomes: {
    'no-resume': 'You have no resume to answer from. Add one in TailorIT.',
    sensitive: "This question wasn't sent: questions about self-identification, work authorization, pay or consent, and checks that you read the form, never go to the AI.",
    unusable: "The AI's answer couldn't be used. Reword the question or try again.",
    'rate-limited': 'Too many questions in a minute. Wait a little, then try again.',
    'not-connected': 'Connect to TailorIT in the settings first.',
    unavailable: "TailorIT's AI couldn't answer just now. Try again.",
    'ai-off': 'AI-written answers are turned off in Options.',
  } satisfies Record<Exclude<AskOutcome, 'answered'>, string>,
} as const;

/** The side panel's "Your autofill information" editor (v3 Phase 3b, src/ui/panel/Profile.tsx). Drafts for the
 *  owner's review. */
const PROFILE = {
  heading: 'Your autofill information',
  intro: 'What TailorIT fills applications with. Your changes are saved to your TailorIT.',
  back: 'Back',
  loading: 'Loading your autofill information…',
  /** Why panel/profile gave no profile: by the worker's refusal. */
  loadFailed: {
    notConnected: 'Connect to TailorIT in the settings first.',
    rateLimited: 'Too many reads in a minute. Wait a little, then try again.',
    unavailable: "Your autofill information couldn't be read just now.",
  },
  retry: 'Try again',
  readOnly: "This connection can read your autofill information but not change it. To edit it here, connect the extension again from TailorIT's Settings › Autofill.",
  openInTailorit: 'Open in TailorIT',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  fixFirst: (count: number) => (count === 1 ? 'Fix 1 thing before saving:' : `Fix ${count} things before saving:`),
  conflict: 'Your autofill information changed elsewhere since you opened it.',
  conflictHelp: 'Load the latest to see it. Your changes here are kept on it, for you to check before you save.',
  loadLatest: 'Load the latest',
  loadingLatest: 'Loading the latest…',
  /** Load the latest kept the person's edits on what TailorIT holds now (the review of v3 Phase 3b). */
  merged: 'Loaded the latest from TailorIT, with your changes kept on it. Check them, then save.',
  mergedBoth: (fields: string) => `Also changed elsewhere, with your version kept: ${fields}.`,
  sensitiveDropped: "Your changes to work authorization and self-identification couldn't be kept: this browser may no longer read them.",
  outcomes: {
    conflict: 'Your autofill information changed elsewhere since you opened it.',
    invalid: "TailorIT didn't accept a value. Check the fields, then save again.",
    'not-allowed': "This connection can't change your autofill information. Connect the extension again from TailorIT's Settings › Autofill.",
    'not-connected': 'Connect to TailorIT in the settings first.',
    'rate-limited': 'Too many saves in a minute. Wait a little, then try again.',
    unavailable: "Your changes couldn't be saved just now. Try again.",
  } satisfies Record<ProfileSaveRefusal, string>,
  sections: {
    personal: 'Personal',
    links: 'Links',
    education: 'Education',
    experience: 'Work experience',
    skills: 'Skills',
    preferences: 'Preferences',
    anythingElse: 'Anything else we should know?',
    sensitive: 'Work authorization and self-identification',
  },
  /** An entry of a list, by its place (from 1). */
  entry: {
    education: (place: number) => `Education ${place}`,
    experience: (place: number) => `Work experience ${place}`,
    workAuthorization: (place: number) => `Country ${place}`,
  },
  add: { education: 'Add education', experience: 'Add work experience', workAuthorization: 'Add a country' },
  remove: (name: string) => `Remove ${name}`,
  removeShort: 'Remove',
  fields: {
    first: 'First name',
    middle: 'Middle name',
    last: 'Last name',
    preferred: 'Preferred first name',
    suffix: 'Suffix',
    email: 'Email',
    phone: 'Phone',
    phoneCountry: 'Phone country',
    phoneExtension: 'Extension',
    line1: 'Address',
    line2: 'Address line 2',
    city: 'City',
    region: 'State or region',
    postalCode: 'Postal code',
    country: 'Country',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    portfolio: 'Portfolio',
    website: 'Website',
    school: 'School',
    degreeLevel: 'Degree level',
    degreeType: 'Degree',
    fieldOfStudy: 'Field of study',
    startDate: 'Start',
    endDate: 'End',
    studyingNow: 'I study here now',
    company: 'Company',
    title: 'Title',
    workingNow: 'I work here now',
    description: 'Description',
    skills: 'Skills',
    earliestStartDate: 'Earliest start date',
    noticePeriodWeeks: 'Notice period (weeks)',
    willingToRelocate: 'Willing to relocate',
    workArrangements: 'Work arrangements',
    travelPercent: 'Travel (% of the time)',
    referralSource: 'How you usually hear about jobs',
    anythingElse: 'Anything else we should know?',
    authorized: 'Authorized to work there',
    sponsorshipNow: 'Needs sponsorship now',
    sponsorshipFuture: 'Needs sponsorship in the future',
    workStatus: 'Status',
    gender: 'Gender',
    selfDescribed: 'In your words',
    hispanicOrLatino: 'Hispanic or Latino',
    races: 'Race',
    veteran: 'Veteran status',
    disability: 'Disability',
    pronouns: 'Pronouns',
    atLeast18: '18 or older',
    criminalRecord: 'Ever convicted of a crime',
    expectedSalary: 'Expected pay',
    salaryMin: 'Minimum',
    salaryMax: 'Maximum',
    currency: 'Currency',
    period: 'Per',
  },
  placeholders: { month: 'YYYY-MM', country: 'US', currency: 'USD', skills: 'TypeScript, PostgreSQL, Leadership' },
  monthHelp: 'As YYYY-MM.',
  /** An entry's date TailorIT holds as a year alone, which a month picker cannot show. */
  yearOnly: (year: string) => `Saved as ${year}, without a month. Choose one to change it.`,
  /** An empty email is the account's sign-in address (TailorIT's rule), named here. */
  emailHelp: (email: string) => `Leave it empty to use your TailorIT sign-in email, ${email}.`,
  /** An expected pay of 0 or less. */
  salaryAboveZero: { min: 'Enter an amount above 0, or choose Not provided.', max: 'Enter an amount above 0, or leave it empty.' },
  skillsHelp: 'Separate them with commas.',
  anythingElseHelp: "Add any details you want TailorIT's AI to consider when it answers applications for you.",
  /** The note's lines TailorIT keeps from the AI (its anythingElseFlaggedLines, from 0), named from 1. */
  flagged: (lines: readonly number[]) => {
    const named = lines.map((line) => line + 1);
    const list = named.length === 1 ? `Line ${named[0]}`
      : `Lines ${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    return `${list} ${named.length === 1 ? 'states' : 'state'} a sensitive answer (a visa, a salary, an age…). ${named.length === 1 ? 'It is saved, but never reaches' : 'They are saved, but never reach'} the AI: put those answers in the sections for them.`;
  },
  sensitiveHelp: 'These answers fill the questions that ask for them, and never go to the AI.',
  sensitiveNotShared: 'This browser may not read your work authorization and self-identification answers. Edit them in TailorIT.',
  sensitiveUnavailable: "Your work authorization and self-identification answers couldn't be read just now.",
  choices: {
    notProvided: 'Not provided',
    declined: 'Prefer not to say',
    answer: 'Answer',
    yes: 'Yes',
    no: 'No',
    unset: 'Not set',
  },
  degreeLevels: {
    highSchool: 'High school', associate: 'Associate', bachelor: "Bachelor's", master: "Master's", doctorate: 'Doctorate',
    professional: 'Professional (MBA, JD, MD)', other: 'Other',
  } satisfies Record<DegreeLevel, string>,
  workStatuses: {
    citizen: 'Citizen', 'permanent-resident': 'Permanent resident', 'work-visa': 'Work visa', 'student-visa': 'Student visa',
    other: 'Other',
  } satisfies Record<WorkStatus, string>,
  genders: {
    female: 'Woman', male: 'Man', 'non-binary': 'Non-binary', 'self-describe': 'In my own words',
  } satisfies Record<GenderIdentity, string>,
  races: {
    'american-indian-alaska-native': 'American Indian or Alaska Native', asian: 'Asian',
    'black-african-american': 'Black or African American', 'middle-eastern-north-african': 'Middle Eastern or North African',
    'native-hawaiian-pacific-islander': 'Native Hawaiian or Pacific Islander', white: 'White',
  } satisfies Record<RaceCategory, string>,
  veteran: { none: 'Not a veteran', veteran: 'Veteran', protected: 'Protected veteran' },
  periods: { year: 'Year', month: 'Month', hour: 'Hour' } satisfies Record<ExpectedSalaryPeriod, string>,
  arrangements: JOB.arrangements,
} as const;

/** The in-page review panel (src/content/ui/panel.tsx): the same report, in the page's closed root. */
const IN_PAGE = {
  region: 'TailorIT Autofill review',
  close: 'Close the review',
  loading: 'Loading the review…',
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
      'TailorIT Autofill fills job applications on Greenhouse, Lever, Ashby, Workday and Workable from the profile you keep in your own TailorIT. It reads the job pages you open on those sites, fills what it is sure of and lists the rest for you to review. It submits an application only when you choose Submit application in its side panel, set Submit to Auto under Modes, or turn on Run auto-apply; once the site confirms it, it tells your TailorIT tracker the job is Applied. With Run auto-apply on, it takes the jobs you queue in TailorIT one at a time, opens each in a window of its own while this browser is open, fills it, and submits it without you watching, AI guesses included, unless the rules under Modes leave it for you; it tells your TailorIT how each one went, never what it filled in. With Sign-in on Auto (only if you allowed it when connecting), it reads the job-site email and password you saved in TailorIT for the site you are on, types them into that site\'s own sign-in or new-account form, and keeps them in memory only for that sign-in; checks that you are human and email codes stay yours. Unless you choose Required only under Modes, it ticks every agreement box a form shows, news, job alerts and text messages included, except a binding clause the form does not require (an arbitration agreement, say) and a box saying you did not use AI, which it ticks only when the fill used no AI. Some sites (Ashby) send a text message consent to the employer the moment it is ticked. Some sites keep what is filled before you submit: Ashby saves answers and files as they go in; Workable uploads an attached file at once and keeps the answers in this browser for an hour.',
      'When an application page or a job posting on those sites loads, and again while its side panel shows one, it tells your TailorIT which job page you are on, so TailorIT can name the job, your tracker entry for it and your match before you open the panel; it does so again when you choose Autofill or Dry run, add the job or change the resume. TailorIT does not keep the page\'s address unless you add the job, or mark it Applied after you submit. Its side panel can show and change your autofill information in your TailorIT, and preview the resume it attaches. When you choose Autofill, it fetches your profile from TailorIT, and your resume and your cover letter for the job when the form asks for them. It keeps them in memory only, never on disk: your profile until five minutes after its last use, and the files only for the seconds it takes to attach them. This browser keeps your settings, where you put or hid its button on each site, notes on each application\'s progress and, until you close the browser, a sealed record of the list options you submitted, which it can match again but never read: never your answers.',
      'Its AI help sends the visible text of a question and its visible options, with the answer from your profile it is trying to match, to your TailorIT, which asks Claude. Picking from lists, working out unusual questions, drafting open answers (a cover letter too, when the form asks for one and you have none for the job) and answering the questions your profile does not are on unless you turn them off below; drafts, cover letters and answers also give Claude the posting\'s visible text, and TailorIT gives it your resume and profile to write from. An answer with nothing to go on is marked "AI guess". On a posting that says AI is not allowed, nothing goes to the AI unless you choose otherwise below, or ask a question of your own in the side panel. That question, and Edit with AI in a text box, go to the AI only when you ask, and only while AI-written answers (Draft open answers, below) are on. Unless you choose Profile only for AI answers under Modes, questions about work authorization, sponsorship, a visa, a clearance, age, criminal history or pay that your profile does not answer, and attention checks, get the AI\'s best guess too, from the question and its options alone. Your self-identification, work authorization, sponsorship, criminal record, pay and consent answers never go to the AI. The extension talks only to your TailorIT.',
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
    versionMismatch: 'This version of the extension and your TailorIT use different versions of their connection, so nothing is filled. Update the older one, then connect again here.',
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
    inPageHelp: "The panel on the page opens from the launcher beside the form. On a form inside another site's page that is too small for it, the side panel opens instead.",
  },
  /** Options › Modes (v3 Phase 3): each behaviour the person chooses, also in the side panel's gear menu. Sign-in and
   *  the agent's skip rules are stored and shown once they exist (Phase 5); Submit since v3 Phase 4. Drafts for the
   *  owner's review. */
  modes: {
    heading: 'Modes',
    intro: 'How much TailorIT Autofill does by itself. The gear in the side panel shows these too.',
    next: {
      name: 'Next page',
      manual: 'Manual',
      auto: 'Auto',
      help: 'Auto presses Next once a page of the application is filled, settled and has nothing flagged. The last page\'s Submit is the Submit mode\'s, below.',
    },
    submit: {
      name: 'Submit',
      manual: 'Manual',
      auto: 'Auto',
      help: 'Auto presses Submit once the last page of the application is filled and checked, unless a required field is still empty, the posting says AI is not allowed, or the page asks you to prove you are human: then the review says why, and you submit. Manual: you submit, on the page or with Submit application in the side panel.',
    },
    signIn: {
      name: 'Sign-in',
      manual: 'Manual',
      auto: 'Auto',
      help: "Auto signs in to a job site that asks you to (Workday and others), or creates your account there, with the email and password you saved in TailorIT's Settings › Autofill › Job-site sign-in, then presses Sign in or Create account. A check that you are human and an email code stay yours, and a password the site does not take is not tried again. Manual: you sign in.",
      /** Why Auto cannot be chosen now. */
      needsScope: "Sign-in Auto needs this browser's permission to read your saved job-site sign-in. Disconnect, then connect again with \"Let this browser sign in to job sites with my saved password\" ticked on TailorIT's page.",
      needsDisclosure: 'Sign-in Auto can be chosen once you choose I understand on the updated notice.',
      needsConnection: 'Sign-in Auto can be chosen once this browser is connected to TailorIT.',
    },
    agentSkip: {
      name: 'Auto-apply leaves a job for you when',
      help: 'Auto-apply and Submit on Auto leave the application unsubmitted, and auto-apply lists it for you in TailorIT, when one of these is true. A check that you are human, a sign-in it cannot do and an email code always stop it.',
      requiredEmpty: 'A required field is still empty',
      noAi: 'The posting says AI-assisted applications are not allowed',
      legalGuess: "A work authorization, sponsorship or other legal answer is the AI's guess",
    },
    recordOwn: {
      name: 'Record applications I submit myself',
      on: 'On',
      off: 'Off',
      help: 'On: when you submit an application on Greenhouse, Lever, Ashby or Workable yourself, without Autofill, and the site confirms it, your TailorIT tracker marks the job Applied. Off: only applications Autofill filled are recorded.',
    },
    afterPageTurn: {
      name: 'Autofill after page turn',
      auto: 'Automatically',
      manual: 'Manually',
      help: 'On applications with several pages, fill each new page as it appears, or wait until you choose Continue on it.',
    },
    consents: {
      name: 'Consent boxes',
      all: 'All agreements',
      required: 'Required only',
      help: 'All ticks every agreement box the form shows: privacy, terms, accuracy, keeping your application on file and future jobs, background checks, news and job alerts, and text messages. Required only ticks a box the form requires, and an optional one only when you pre-approve its kind on the options page, under Consent boxes. A box saying you did not use AI is ticked only when the fill used no AI, in either.',
    },
    ai: {
      name: 'AI answers',
      all: 'All',
      profile: 'Profile only',
      help: 'All lets the AI answer work authorization, sponsorship, visa, clearance, age, criminal history, pay and "select PURPLE to show you read this" questions your profile doesn\'t answer, marked "AI guess" unless your resume settles it: only the question and its options are sent. Profile only answers them from your profile, and leaves the rest for you. It acts while "Answer the questions my profile does not" is on.',
    },
    view: {
      name: 'Side panel view',
      expanded: 'Expanded',
      minimized: 'Minimized',
      help: 'Minimized folds the review to its progress line: choose the line to see the fields.',
    },
  },
  /** v3 Phase 5: Options › Auto-apply. Drafts for the owner's review. */
  agent: {
    heading: 'Auto-apply',
    intro: 'Auto-apply applies to the jobs you queue in TailorIT (Jobs or Job Tracker › Auto-apply), one at a time, in a window of its own, while this browser is open. It fills each application, presses Next and Submit by itself, and tells your TailorIT how each one went. Jobs it leaves for you stay listed there.',
    run: 'Run auto-apply',
    runHelp: 'Off until you turn it on. Leave the window it opens alone: closing it leaves that job for you.',
    confirmHeading: 'Submit applications without you?',
    confirm: 'With auto-apply on, applications are submitted without you watching, with the answers Autofill fills in, the AI\'s guesses included, unless the rules under Modes leave a job for you. You can stop it at any time.',
    confirmYes: 'Turn on auto-apply',
    confirmNo: 'Cancel',
    open: 'Open Auto-apply in TailorIT',
    blocked: {
      'not-connected': 'Connect to TailorIT to use auto-apply.',
      'no-scope': "This browser's connection was made before auto-apply. Disconnect, then connect again.",
      disclosure: 'Choose I understand on the updated notice to use auto-apply.',
      'no-window': 'Auto-apply waits until a browser window of yours is open.',
    } satisfies Record<AgentBlock, string>,
  },
  consent: {
    heading: 'Consent boxes',
    intro: 'Under Consent boxes: Required only (Modes, above), a box the form requires is ticked for you, since you cannot apply without it, and an optional box only when you pre-approve its kind here; the usual ones start on, marketing and text messages start off. Under All agreements every kind is ticked.',
    allMode: 'Consent boxes is set to All agreements, so every kind below is ticked. To choose kind by kind, set Consent boxes to Required only under Modes, above.',
    categories: CONSENT,
    certifyWarning: 'Certifying states that everything in an application is true and complete. Turn this on only if you check every application before you submit it.',
    never: 'A statement that you did not use AI is ticked only when the fill used no AI at all, so it is true. Otherwise it is left for you.',
  },
  ai: {
    heading: 'AI help',
    intro: 'Through your TailorIT, which asks Claude. Everything the AI writes is marked in the review, and an answer with nothing to go on is marked "AI guess".',
    tiebreak: 'Pick from a list when unsure',
    tiebreakHelp: 'When your answer could match more than one option, the AI picks among the visible options.',
    classify: 'Work out unusual questions',
    classifyHelp: 'When no rule recognises a question, the AI says what it asks, so your profile can answer it.',
    drafts: 'Draft open answers',
    draftsHelp: 'Drafts answers to questions like "Why this company?" from your resume and the posting, and writes them in.',
    answers: 'Answer the questions my profile does not',
    answersHelp: 'Questions like "How many years of Go have you used?" or "Are you open to travel?" are answered from your resume and profile. When nothing settles one, the AI gives its best guess, marked "AI guess".',
    confirmDrafts: 'Wait for me to confirm each draft',
    confirmDraftsHelp: 'A draft waits in the review until you edit or confirm it, and the form is not ready until you have.',
    whenForbidden: {
      heading: 'When a posting says AI is not allowed',
      'profile-only': 'Fill from my profile only',
      'profile-onlyHelp': 'Nothing is sent to the AI for that posting, and questions only the AI could answer are left for you. The same goes for a form that asks you to confirm you did not use AI.',
      ask: 'Ask me each time',
      askHelp: 'Filling stops at a notice until you choose Fill anyway or Cancel.',
      'use-ai': 'Use AI anyway',
      'use-aiHelp': 'The notice is shown, and filling goes on with the AI.',
    },
    never: 'Your EEO, authorization, sponsorship, criminal record and pay answers never go to the AI. Self-identification and consent questions are never sent to it.',
  },
  interpretations: {
    heading: 'Interpretations',
    intro: 'Readings that go further than the rules say. Each is on unless you turn it off.',
    postingCountryForLegal: 'Answer work authorization questions that name no country',
    postingCountryForLegalHelp: 'Uses your answer for the country of the posting, or for your only country when the posting names none. The field stays flagged for you to check.',
    twoOrMoreRaces: 'Answer "Two or More Races"',
    twoOrMoreRacesHelp: 'When you gave several races and the question takes one answer. The field stays flagged for you to check.',
    eeoDeclineByDefault: 'Decline self-identification questions I have not answered',
    eeoDeclineByDefaultHelp: 'Chooses the form\'s "Decline to self-identify" option when TailorIT holds no answer of yours. With no such option, the question is left for you.',
  },
  answers: {
    heading: 'Your fixes',
    offer: 'Offer to save my fixes',
    offerHelp: 'When you fill or fix a flagged field yourself, the review offers to save your answer in TailorIT, so the same question is answered for you next time. Self-identification, work authorization, sponsorship, pay and consent answers are never saved.',
  },
  telemetry: {
    heading: 'Anonymous counters',
    intro: 'Counts of how well filling works, kept only in this browser. They are never sent anywhere.',
    optIn: 'Keep anonymous counters',
    optInHelp: 'Each field the extension fills, or leaves for you, adds one to a count of these five things, and nothing else:',
    fields: {
      platform: 'the site: Greenhouse, Lever, Ashby, Workday or Workable;',
      fieldKind: 'the kind of field: a text box, a list, a checkbox and so on;',
      matcherStage: 'how its answer was matched: exactly, by a known alias, by a close match and so on;',
      outcome: 'whether it was filled or left for you;',
      tripwireTriggered: 'whether the page held text addressed to AI tools.',
    },
    never: 'No question, answer, address, account, time or version is counted.',
    caption: 'Counts so far',
    columns: { platform: 'Site', fieldKind: 'Field kind', matcherStage: 'Match', outcome: 'Outcome', tripwireTriggered: 'Text for AI tools', count: 'Count' },
    outcomes: { success: 'Filled', fail: 'Left for you' },
    yes: 'Yes',
    no: 'No',
    empty: 'Nothing has been counted.',
    loading: 'Reading the counters…',
    unreadable: 'The counters could not be read. Close this tab and open the settings again.',
    export: 'Export as JSON',
    exportName: 'tailorit-autofill-counters.json',
    clear: 'Clear the counters',
    cleared: 'The counters were cleared.',
    clearFailed: 'The counters could not be cleared. Try again.',
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

/** v3 Phase 5: the auto-apply agent's status line, in the side panel and the options page. Drafts for the owner's
 *  review. Value-free: the job's title and company as TailorIT named them, counts, states and reasons. */
const AGENT_STATES = {
  submitted: 'Submitted', skipped: 'Skipped', 'needs-you': 'Needs you', failed: 'Failed',
} as const satisfies Record<AutofillAgentFinishedState, string>;
const AGENT_REASONS = {
  required_field_empty: 'a required field was empty',
  posting_forbids_ai: 'the posting forbids AI',
  ai_guess_legal: "a legal answer was the AI's guess",
  captcha: 'a check that you are human',
  sign_in: 'a sign-in',
  sign_in_failed: 'the sign-in failed',
  email_code: 'an email code',
  validation_error: 'the page showed errors',
  unsupported_site: "a page Autofill can't finish",
  posting_closed: 'the posting closed',
  page_error: "the page didn't load",
  timed_out: 'it took too long',
  already_applied: 'already applied',
  cancelled: 'stopped',
  other: 'something to check',
} as const satisfies Record<AutofillAgentReason, string>;

const AGENT = {
  label: 'Auto-apply',
  stop: 'Stop',
  open: 'Open Auto-apply in TailorIT',
  states: AGENT_STATES,
  reasons: AGENT_REASONS,
  /** "Auto-apply: running Senior Backend Engineer at Northwind · 2 done today · last: Needs you (a check that you are
   *  human)". */
  line(status: Pick<AgentStatus, 'phase' | 'job' | 'doneToday' | 'last'> & Partial<Pick<AgentStatus, 'pending'>>): string {
    const job = status.job === null ? '' : status.job.company === '' ? status.job.title
      : status.job.title === '' ? status.job.company : `${status.job.title} at ${status.job.company}`;
    const phase = status.phase === 'running' ? (job === '' ? 'running' : `running ${job}`)
      : status.phase === 'waiting' ? 'waiting for a job' : status.phase === 'blocked' ? 'paused' : 'off';
    const last = status.last === null ? '' : ` · last: ${AGENT_STATES[status.last.state]}${status.last.reason === null
      ? '' : ` (${AGENT_REASONS[status.last.reason]})`}`;
    const pending = status.pending === true ? ' · a result not yet told TailorIT' : '';
    return `Auto-apply: ${phase} · ${status.doneToday} done today${last}${pending}`;
  },
} as const;

export const COPY = {
  appName: 'TailorIT Autofill',
  /** The name as the headers draw it: "Tailor", then "IT" in TailorIT's ink, then the product's word. */
  brand: { name: ['Tailor', 'IT'], product: 'Autofill', settings: 'Autofill settings' },
  panelTitle: 'Review',
  panelEmpty: 'Nothing to review yet. Open a job application and choose Autofill.',
  optionsTitle: 'TailorIT Autofill settings',
  tripwire: NOTICES.tripwire,
  notices: NOTICES,
  /** The policy card's two buttons (in the page and in the side panel). */
  policyFillAnyway: 'Fill anyway',
  policyCancel: 'Cancel',
  /** Under the policy sentence when only TailorIT's saved copy of the posting said it (the page's card and the panel's). */
  policyFromStoredCopy: NOTICES['policy-stored-copy'],
  // The in-page UI (src/content/ui): the launcher's name in each state (its tooltip and accessible name) and a
  // notice's dismiss button. Drafts from the content runtime, for the owner's review.
  launcherFill: 'Autofill this application with TailorIT',
  launcherRunning: 'Filling the application',
  launcherNeedsYou: 'This needs you. Choose to continue.',
  launcherPolicy: 'This posting says AI-assisted applications are not allowed. See the notice.',
  launcherReview: (count: number) => (count === 1 ? 'Review: 1 field needs you' : `Review: ${count} fields need you`),
  launcherError: 'Something went wrong. Choose to try again.',
  launcherNotConnected: 'Connect TailorIT Autofill to TailorIT in its settings, then try again.',
  /** The launcher at the page's right edge (v3 Phase 3): its progress while it fills, its grip and its hide menu.
   *  Drafts for the owner's review. */
  launcherFilling: (percent: number) => `Autofilling, ${percent}%`,
  launcherMove: 'Drag up or down to move the TailorIT button',
  launcherHide: {
    open: 'Hide the TailorIT button',
    nextVisit: 'Hide until next visit',
    site: 'Hide on this site',
    everywhere: 'Hide everywhere',
    note: 'The TailorIT Autofill icon in the toolbar brings it back.',
  },
  dismiss: 'Dismiss',
  /** The review's marks of a field the AI wrote, and of one it answered with nothing to go on (the owner's
   *  amendments): its chips beside the row's status. */
  aiChip: 'AI',
  aiGuessChip: 'AI guess',
  /** The button in a text box that asks the AI to rewrite what it holds (its accessible name), and its state while the
   *  rewrite is on its way. */
  editWithAi: 'Edit with AI',
  editingWithAi: 'Rewriting…',
  /** v3 Phase 3b: Edit with AI's instruction box, and what came of a rewrite. Drafts for the owner's review. */
  aiEdit: {
    label: 'What should change? (optional)',
    placeholder: 'Tell me what to add, change or improve',
    count: (length: number) => `${length}/750`,
    cancel: 'Cancel',
    generate: 'Generate',
    outcomes: {
      sensitive: "Not rewritten: questions and instructions about self-identification, work authorization, pay, contact details or consent never go to the AI. Reword it, or write this one yourself.",
      unchanged: 'The AI wrote the same text this box holds already.',
      failed: "It couldn't be rewritten just now. Try again.",
      refused: "This box can't be rewritten now: the page changed, or something on it needs you first.",
    },
  },
  /** One sentence per reason code. */
  reasons: REASONS,
  statuses: STATUSES,
  provenances: PROVENANCES,
  stages: STAGES,
  runStatuses: RUN_STATUSES,
  pauseReasons: PAUSE_REASONS,
  platforms: PLATFORM_NAMES,
  fieldKinds: FIELD_KIND_NAMES,
  report: REPORT,
  panel: PANEL,
  strip: STRIP,
  job: JOB,
  ask: ASK,
  profile: PROFILE,
  inPage: IN_PAGE,
  options: OPTIONS,
  agent: AGENT,
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
