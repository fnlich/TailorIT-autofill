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
import type {
  AsianSubgroup, ClearanceLevel, PhoneDeviceType, ReferralCategory, SexualOrientation,
} from '../core/types/profile';
import type { PauseReason, RunStatus } from '../core/types/run';
import type {
  AddJobOutcome, AgentBlock, AgentNote, AgentPause, AgentStatus, AskLength, AskOutcome, EntryRefusal, JobSearchRefusal, LetterOutcome,
  PressOutcome, ProfileSaveRefusal, SaveAnswerOutcome, SiteRequestOutcome, SubmittedState,
} from '../messaging/schemas';
import type { TailorFailure, TailorKind } from '../messaging/page-schemas'; // v1.4 F
import type { QueueBlock, QueueItemStatus, QueuePhase, QueueStop } from '../messaging/page-schemas'; // v1.5 QX
import { QUEUE_SUBMIT_PLATFORMS } from './queue-submit'; // jr7 INT-7
import type { FrameReport } from './report';

/** A report notice's code. */
type NoticeCode = FrameReport['notices'][number]['code'];

/** "1 form", "2 forms". */
const forms = (count: number) => (count === 1 ? 'the form' : `${count} forms`);

/** jr6 apply F1 fixer (the line P review, C2): where Autofill has no application to fill, and what to do there, said by
 *  the no-form strips (STRIP.noForm, STRIP.posting) and the "no form" modal (NO_FORM); written once (the sidebar's
 *  bundle carries every word of this file). */
const NO_FORM_HERE = 'No application form on this page';
const OPEN_A_JOB = "Open a job's application, then press Autofill.";

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
  // v3 Phase 5 (Sign-in mode Auto): drafts for the owner's review. The jr6 review (R3): the sign-in is the one saved in
  // Sign-up Information (this browser), no longer TailorIT's; (R16) kept short, for the sidebar's budget.
  'sign-in-auto': 'Sign-in is on Auto: signing you in with your Sign-up Information.',
  'sign-in-unavailable': "Sign-in is on Auto, but your Sign-up Information can't be used on this page. Sign in yourself, then choose Continue.",
  'sign-in-failed': "Signing in with your Sign-up Information didn't work, and it won't be tried again here. Sign in yourself, or use the site's Forgot password.",
  // The audit of 2026-11-06 (S-2, S-3): a draft for the owner's review.
  'bot-check': "A question checks that a person is filling in this form, so it was left for you. Next and Submit won't be pressed for you until you answer it.",
  // The snapshot build of 2026-11-06 (core-x, item 2): a draft for the owner's review.
  'account-left': "This form asks you to create a login for the site, which is left to you, so I won't press Next. Fill in your login and password, then press Next yourself.",
  // The behaviour review of 2026-11-06 (minor 7): a draft for the owner's review.
  'errors-on-load': 'The page showed these errors before anything was filled in (an entry of your profile on this site, for example). Fix them yourself, then continue.',
} as const satisfies Record<NoticeCode, string>;

// v5 p1-panel: words two blocks share, named once, so neither block reads the other's member at load: a bundler keeps
// a member read (it may run a getter), and with it the whole block it reads, in a bundle that needs neither (the
// content script's: OPTIONS read REASONS, PROFILE read JOB).
/** The plan's exact sentence (module header). */
const SENSITIVE_NOT_SHARED = "This browser may not read your work authorization and self-identification answers. To allow it, connect the extension again from TailorIT's Settings › Autofill with that box ticked.";
const ARRANGEMENTS = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' } as const satisfies Record<WorkArrangement, string>;
// end v5 p1-panel

/** Why a field ended as it did: one sentence per reason code, shown on its row. v4 run (the owner, 2026-11-07: "Never
 *  flag to the user"): each says what happened, never what the person should do. */
const REASONS = {
  // Done.
  ok: 'Filled as expected.',
  'filled-low-confidence': 'Filled with the closest answer.',
  'already-correct': 'It already held the right answer, so it was left as it was.',
  'prefill-kept': 'The site had already filled this in, and that was kept.',
  'prefill-conflict': "The site had filled this in differently, and your profile's answer was put in.",
  'llm-pick-needs-review': 'The AI picked this option from the list.',
  'llm-classified-needs-review': 'The AI worked out what this question asks, and it was filled from your profile.',
  'options-incomplete': 'Only part of this long list could be read, and the choice was made from that part.',
  'llm-draft-needs-confirmation': 'The AI drafted this answer.',
  'llm-draft-held': 'The AI drafted this answer, and this site saves each answer at once, so it was not put in.',
  'other-option-with-free-text': 'No option fit, so "Other" was chosen and your answer typed in.',
  'other-without-free-text': 'No option fit, so "Other" was chosen.',
  'option-label-had-injected-text': 'An option held words aimed at AI tools. They were ignored.',
  // Gaps in what could be resolved.
  'no-profile-value': 'Your profile has no answer for this.',
  'unknown-field': "It isn't clear what this question asks, so it was not filled.",
  'low-confidence': 'No answer was certain enough, so it was not filled.',
  'classification-conflict': 'The question could be read in more than one way.',
  'eeo-not-in-profile': 'Your profile has no self-identification answer for this, so it was not filled.',
  'legal-not-in-profile': "Your profile doesn't answer this legal question, so it was not filled.",
  'decline-option-missing': 'You chose not to answer this, and the form offers no way to decline, so it was not filled.',
  'work-auth-country-unknown': "The question doesn't say which country it means, so it was not filled.",
  'consent-requires-user': 'This agreement was not ticked.',
  'attention-check': 'This question checks that you read the form, so it was not filled.',
  'free-text-requires-user': 'This open question was not filled.',
  'drafts-disabled': 'Drafting open answers is off in Settings, so this was not filled.',
  'llm-disabled-for-category': 'The AI is never used for this kind of question, so it was not filled.',
  'llm-unavailable': 'The AI could not be reached, so this was not filled.',
  'llm-invalid-output': "The AI's answer could not be used, so this was not filled.",
  'llm-pick-rejected': 'The AI picked an option that failed a safety check, so nothing was chosen.',
  'saved-answer-not-allowed-for-category': 'Saved answers are never used for this kind of question, so it was not filled.',
  'end-date-not-applicable': 'You still work here, so the end date was left empty.',
  'sensitive-not-shared': SENSITIVE_NOT_SHARED, // v5 p1-panel: the same words, named once
  'sensitive-unavailable': 'Your work authorization and self-identification answers could not be read from TailorIT just now, so this was not filled.',
  'statement-not-affirmative': "This box isn't worded as a plain yes, so it was not ticked.",
  'criminal-not-covered': "Your answer about criminal convictions doesn't settle this question, so it was not filled.",
  // The matcher.
  'no-match': 'None of the options matched your profile.',
  'ambiguous-options': 'More than one option could match your answer, so none was chosen.',
  'distinctive-token-mismatch': 'The closest option names a different place or subject, so it was not chosen.',
  'waiting-for-options': "The list's options had not loaded yet.",
  'options-never-loaded': "The list's options never loaded.",
  'options-changed': "The list's options changed while filling.",
  'max-selections-reached': 'The question allows fewer choices than your profile has, so your first ones were chosen.',
  'partial-multi-select': 'Only some of your answers were found among the options.',
  'exclusive-conflict': 'An option like "None of the above" cannot go with your other answers, so nothing was chosen.',
  'preselected-left-untouched': 'Some options were already selected. Nothing was unticked.',
  // The Guard.
  honeypot: 'This field is hidden from people, so it was never touched.',
  'not-user-visible': "This field isn't visible, so it was not filled.",
  'no-visible-label': 'This field has no visible label, so it was not filled.',
  'canary-in-value': 'The answer held words that hidden page text asked AI tools to write, so it was blocked.',
  'canary-equals-profile-value': 'Hidden page text asked AI tools to write one of your own answers, so this field was blocked.',
  'missing-provenance': 'An answer arrived without saying where it came from, so it was blocked.',
  'policy-violation': 'This answer came from a source never used for this kind of question, so it was blocked.',
  'mark-all-aborted': 'Filling would have ticked every option, so nothing was ticked.',
  'exceeds-profile-set': 'Filling would have chosen more options than your profile has answers, so nothing was chosen.',
  'tripwire-in-label': "This question's own text addresses AI tools, so it was not filled.",
  'injected-option-only': 'The only matching option held words aimed at AI tools, so it was not chosen.',
  // Filling and checking.
  'verify-mismatch': 'The page shows this differently from what was filled in.',
  'widget-unsupported': "This kind of control can't be filled yet.",
  'needs-your-click': "This control takes only a person's own click, so it was not filled.",
  'unexpected-selection': 'This holds a selection your profile would not make, and it was left as the page has it.',
  'element-not-found': 'The field was gone before it could be filled.',
  // jr7 INT-7: also a required, empty field the page kept locked past the run's wait (ENGINE-7 E2 item 1, ADP7-2:
  // ADP's Address Line 1 until a Country is chosen), so the words say what the person can do, and hold for a field
  // that never opens.
  'disabled-or-readonly': 'The page kept this field locked, so it was not filled. If it opens after another answer, fill it in yourself.',
  'value-rejected-by-site': 'The site did not accept the answer.',
  'format-unsupported': 'The field asks for a format your answer cannot be written in.',
  'maxlength-exceeded': 'Your answer is longer than this field allows and was not cut short, so it was not filled.',
  'upload-control-not-recognized': "This upload control wasn't recognised, so nothing was attached.",
  'pdf-only-input': 'This upload takes PDF files only, and your resume is a Word file, so nothing was attached.',
  'resume-unavailable': 'Your resume could not be fetched from TailorIT.',
  'resume-transfer-failed': 'Your resume could not be attached.',
  'resume-format-unsupported': 'Your resume is an old Word file. Choose a PDF resume in TailorIT.',
  'upload-failed': 'The file was attached, but the site says it failed to upload.',
  'upload-not-confirmed': 'The file was attached, but the site never showed it uploaded.',
  // The fill loop and the steps.
  'field-disappeared': 'The field disappeared while filling.',
  'value-oscillated': 'The page kept changing this answer, so filling stopped here.',
  'reveal-cycle': 'Answers kept revealing and hiding each other, so filling stopped here.',
  'max-passes-reached': 'The form kept changing, so filling stopped after several passes.',
  'page-busy': 'The page was still busy, so this was not filled yet.',
  'step-retry-limit': 'This step was tried twice already, so nothing more was filled on it.',
  'auth-required': 'This step asks for a sign-in or an account.',
  'challenge-present': 'The page shows a human check, so filling waits for it.',
  'policy-declined': 'You chose not to fill this posting.',
  'user-stopped': 'You stopped the fill.',
  'options-oscillated': "The list's options kept changing, so filling stopped here.",
  'changed-by-you': 'You changed this after it was filled, so it was left as you set it.',
  'policy-notice': 'This posting says AI-assisted applications are not allowed.',
  'form-hidden': 'The page hid this form while it was being filled, so filling stopped here.',
  // Drafts (Phase 6): a draft that was not written, and why. Drafts for the owner's review.
  'draft-empty': 'Your resume and profile had nothing to draft this answer from, so it was not filled.',
  'draft-too-long': 'The AI draft was longer than this field allows, so it was not written.',
  'draft-ai-reference': 'The AI draft spoke of being an AI, so it was not written.',
  'draft-wrapper': 'The AI draft held text from its own instructions, so it was not written.',
  'draft-contact': 'The AI draft named a link, email or phone number that is not yours, so it was not written.',
  // The owner's amendments (docs/SPEC-AMENDMENTS.md): written by AI and accepted, or chosen for you; then what was left.
  // Drafts for the owner's review.
  'llm-draft-written': 'The AI wrote this answer from your resume.',
  'llm-answer-written': 'The AI answered this from your resume and profile.',
  'ai-guess': "Your resume and profile don't answer this, so the AI gave its best answer.",
  'eeo-decline-default': "You haven't answered this in TailorIT, so the form's option to decline was chosen.",
  'llm-no-answer': 'The AI had no answer for this, so it was not filled.',
  'ai-off-for-posting': "This posting doesn't allow AI, and only the AI could answer this, so it was not filled.",
  // Cover letters (Phase G): drafts for the owner's review.
  'cover-letter-attached': 'Your cover letter for this job was attached from TailorIT.',
  'cover-letter-written': "TailorIT's AI wrote this cover letter for the job from your resume.",
  'cover-letter-would-write': "You have no cover letter for this job, so a fill has TailorIT's AI write one from your resume.",
  'cover-letter-waiting': 'TailorIT is finding or writing your cover letter for this job.',
  'cover-letter-failed': "TailorIT couldn't write a cover letter for this job, so none was attached.",
  'cover-letter-none': 'You have no finished cover letter for this job in TailorIT, and its AI may not write one here, so none was attached.',
  'cover-letter-unavailable': 'Your cover letter could not be brought from TailorIT just now, so none was attached.',
  'cover-letter-timed-out': 'TailorIT took too long writing your cover letter, so none was attached.',
  'cover-letter-reconnect': "This connection can't attach cover letters, so none was attached.",
  // The owner's decisions of 2026-11-01 (docs/SPEC-AMENDMENTS.md §11): drafts for the owner's review.
  'consent-optional-unticked': "This box is optional and you haven't allowed it in Settings, so it was left unticked.",
  'ai-attestation-ai-used': "This fill used AI, so ticking that you didn't use AI would be untrue, and it was not ticked.",
  // v3 Phase 3: the side panel's Skip. A draft for the owner's review.
  'skipped-by-you': 'You skipped this field while it was being filled.',
  // v3 Phase 3b: drafts for the owner's review.
  'resume-not-attached': 'You chose to apply without a resume, so none was attached.',
  'resume-held-no-input': "The page shows a resume and gives no way to add yours, so yours wasn't uploaded.",
  'cover-letter-typed': 'Your cover letter for this job was typed in from TailorIT.',
  'cover-letter-too-long': "Your cover letter for this job is longer than this box allows, so it wasn't typed in or cut short.",
  // The Phase 7a review: a draft for the owner's review.
  'conditional-question': "This question follows up an answer above that doesn't call for it, so it was not filled.",
  // The audit of 2026-11-06 (S-2, S-3): a draft for the owner's review.
  'bot-check': 'This checks that a person is filling in the form, so it is never answered for you.',
  // The audit of 2026-11-06 (S-4): a draft for the owner's review.
  'how-application-made': 'This asks how your application was made, which an extension never answers, so it was not filled.',
  // v5 p2-stream review (security 5): a draft for the owner's review.
  'ai-reply-voided': "The AI's answer was put in as it arrived, and the rest of that reply was then found unreliable.",
  // v5 p2-stream review end
  // v5 p2-fill review (security 3): a draft for the owner's review.
  'hidden-text-in-box': "This box holds text you can't see, so it was not sent to the AI. Check it on the page.",
  // v1.3 B: a field filled from an application the person submitted before, and one whose earlier option is gone.
  'submitted-before': 'Filled with your answer from an application you submitted before.',
  'submitted-option-gone': "Your earlier answer to this is no longer one of its options, so it was left for you.",
  // v1.5 X (PLAN decision 4): a draft for the owner's review.
  'prebuilt-answer': 'Filled with the answer TailorIT prepared for this job ahead of time.',
  // A bug.
  'internal-error': 'Something went wrong in the extension, so this was not filled.',
} as const satisfies Record<ReasonCode, string>;

/** The spec's five statuses, as a row's chip shows them. v4 run: a flagged row is one the run did not fill (a fill in
 *  the flag band is verified). */
const STATUSES = {
  filled: 'Filled',
  verified: 'Verified',
  skipped: 'Skipped',
  flagged: 'Not filled',
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
  // v1.3 B
  'submitted-before': 'Your earlier application',
  // v1.5 X
  prebuilt: 'Prepared by TailorIT',
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
  // v4 run: what the page waits for, never "you".
  'auth-needed': 'Waiting for a sign-in on the page',
  handoff: 'Waiting for the check on the page',
  'policy-notice': 'Paused',
  'scan-step': 'Reading the form',
  'fill-step': 'Filling',
  validate: 'Checking the form',
  advance: 'Going to the next step',
  'wait-transition': 'Waiting for the next step',
  review: 'Ready for your review',
  done: 'Done',
  stopped: 'Stopped',
} as const satisfies Record<RunStatus, string>;

/** What a paused run waits for. v4 run: the run carries on by itself once the page no longer shows it. */
const PAUSE_REASONS = {
  captcha: 'Waiting for the check on the page.',
  'email-code': 'Waiting for the code the site sent.',
  'bot-check': 'Waiting for the check on the page.',
  'entry-choice': 'The page asks how to apply.',
  'page-busy': 'The page is still busy.',
  'needs-click': 'The page waits for a click.',
  'forgot-password': 'This page resets a password.',
} as const satisfies Record<PauseReason, string>;

/** v3 Phases 6 and 7b: a site whose sign-in and posting pages Autofill knows, its application forms not yet. */
const SIGN_IN_AND_POSTING = 'Sign-in and posting pages; its application forms are coming.';

// ── snapshot build 2026-11-06 (core-x, item 9): Workday's application steps are read (docs/ARCHITECTURE.md) ──
/** Workday's application steps, read from the owner's snapshots of 2026-11-06: filled, with its dates and its search
 *  lists (How Did You Hear, Phone Code, School, Skills) left to the person, since no snapshot shows how they take an
 *  answer. A draft for the owner. */
const WORKDAY_STEPS = 'Its application steps are filled, dates and search lists included.';

// ── snapshot build 2026-11-06 (the docs pass, core-x's item 9 left to it): iCIMS's and Oracle's forms are read ──
/** iCIMS's application steps after the email gate (the Candidate Profile, the questions, EEO), read from the owner's
 *  snapshots of 2026-11-06: filled, with iCIMS's own dropdowns (their lists load from its server; no snapshot shows one
 *  open) left to the person. A draft for the owner. */
const ICIMS_STEPS = 'Its application steps are filled; its own dropdowns are left to you.';
/** Oracle Recruiting Cloud's one-page application (`/apply/section/<n>`), read from the owner's snapshots of
 *  2026-11-06: filled, with its lists (Country, the dates' Month and Year, School: no snapshot shows one open) left to
 *  the person. A draft for the owner. */
const ORACLE_FORM = 'Its application form is filled; its lists are left to you.';

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
  icims: 'iCIMS',
  taleo: 'Taleo',
  successfactors: 'SuccessFactors',
  oracle: 'Oracle Recruiting Cloud',
  // ── New ATSs (DESIGN-NEW-ATS Phase 0) ──
  jobvite: 'Jobvite',
  jazzhr: 'JazzHR',
  bamboohr: 'BambooHR',
  rippling: 'Rippling',
  breezy: 'Breezy HR',
  careerplug: 'CareerPlug',
  pinpoint: 'Pinpoint',
  paycor: 'Paycor',
  hibob: 'HiBob',
  ultipro: 'UltiPro (UKG Pro)',
  dayforce: 'Dayforce',
  paylocity: 'Paylocity',
  dice: 'Dice',
  clearcompany: 'ClearCompany',
  adp: 'ADP Workforce Now',
  // ── end New ATSs ──
  site: 'Company site',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): the new platform's name, as the report and the panel show it ──
  smartrecruiters: 'SmartRecruiters',
  // ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 2): the snapshot7 platforms' names ──
  ukgready: 'UKG Ready',
  paycom: 'Paycom',
  jobdiva: 'JobDiva',
  eightfold: 'Eightfold',
  jibe: 'Jibe',
  // ── end jr7 ENGINE-7 E0 ──
} as const satisfies Record<Platform, string>;

/** jr7 INT-7: platforms' names as a sentence lists them: "A, B and C". */
const namesOf = (platforms: readonly Platform[]): string => {
  const names = platforms.map((platform) => PLATFORM_NAMES[platform]);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
};
/** jr7 INT-7: "Record applications I submit myself"'s help, naming the sites whose confirmation it reads. */
const recordOwnHelp = (platforms: readonly Platform[]): string => `On: when you submit an application yourself, without Autofill, on a site where it reads that the application went through (today ${namesOf(platforms)}), your TailorIT tracker marks the job Applied. Off: only applications Autofill filled are recorded.`;

/** The report's own words (src/ui/report), shared by the side panel and the in-page panel. */
const REPORT = {
  noLabel: '(no visible label)',
  required: 'Required',
  untitledSection: 'Form',
  source: 'Source',
  noSource: 'Nothing written',
  /** The v3 Phase 4 review: a cover letter longer than its text box takes, in characters. */
  letterLength: (length: number, limit: number) => `Your letter is ${length} characters; this box takes ${limit}.`,
  match: 'Match',
  confidence: 'Confidence',
  showOnPage: 'Show on page',
  /** Phase 6: an AI draft waits for the person (wave 2 wires what it does). */
  confirmDraft: 'Confirm draft',
  draftMark: 'AI draft',
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
  // The progress (v3 Phase 3, the owner's choice of Jobright's percent; it was counts only): "Scanning the page…" while
  // the form is read, "Autofilling… 78%" while it fills, then "9 of 12 required fields filled · 75%". The percent is of
  // the required fields filled (shared/report.ts progressOf), of every field when none is required. Drafts for the
  // owner's review.
  // v5 p1-panel: Title Case headings (PLAN decision 3): the progress sheet's header and its scanning block.
  scanning: 'Scanning The Page',
  scanningTitle: 'Reading The Form',
  scanningHelp: 'TailorIT is checking this page for what the application asks.',
  autofilling: 'Autofilling',
  percent: (value: number) => `${value}%`,
  // v4 ui: Jobright's "7/7 required fields filled" (the owner's screenshot 4); v5 p1-panel: in Title Case.
  progressFilled: (filled: number, of: number, requiredOnly: boolean) =>
    `${filled}/${of} ${requiredOnly ? 'Required Fields' : 'Fields'} Filled`,
  progressDryRun: (filled: number, of: number, requiredOnly: boolean) =>
    `${filled}/${of} ${requiredOnly ? 'Required Fields' : 'Fields'} Would Be Filled`,
  // end v5 p1-panel
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
  /** A row's state, said to a screen reader beside its icon. v4 ui (D1): a field the run did not fill is "Not filled",
   *  never "Needs you". */
  rowStates: { filled: 'Filled', missing: 'Not filled', working: 'Being filled', none: 'Not filled' },
  /** The row's label is a button that shows the field on the page; its chevron folds the details. */
  goTo: (label: string) => `Show "${label}" on the page`,
  details: (label: string) => `Details of "${label}"`,
  /** Skip, offered on the field being filled after 2 s on it. */
  skip: 'Skip',
  skipLabel: (label: string) => `Skip "${label}"`,
  /** A repeatable section's row: "Education · 2 of 3 added". */
  sectionAdded: (name: string, added: number, of: number) => `${name} · ${added} of ${of} added`,
  // v5 p1-panel: Title Case section names (they head the sheet's entry groups).
  repeatables: { experience: 'Work Experience', education: 'Education', language: 'Languages' },
  // ── v5 p1-panel: the progress sheet (PLAN decision 4, Jobright's sheet in our own words). Drafts for the owner. ──
  /** The sheet's header while Sign-in Auto (or Sign up & Autofill) signs in, or creates the account, for the run. */
  signingIn: 'Signing In',
  creatingAccount: 'Creating Account',
  /** A section's count chip: of the entries the profile has, those the form shows a block for. */
  partial: (added: number, of: number) => `${added}/${of} Added`,
  partialLabel: (name: string, added: number, of: number) => `${name}: ${added} of ${of} added. Show or hide the entries`,
  /** A section with no count: its entries shown or folded. */
  sectionToggle: (name: string) => `Show or hide the ${name} entries`,
  /** One entry of a section, by its place (from 1): "Education 2". */
  entry: (name: string, place: number) => `${name} ${place}`,
  /** An entry's button that shows its first field on the page. */
  goToButton: 'Go To',
  goToEntry: (entry: string) => `Go to ${entry} on the page`,
  /** An entry of the profile the form shows no block for. */
  notAdded: 'Not Added',
  /** The sheet's header folds it down to its strip, or brings it up. */
  showSheet: 'Show the autofill progress',
  hideSheet: 'Hide the autofill progress',
  // ── end v5 p1-panel ──
  /** Worded apart from the launcher's "Review: N fields need you", which also counts the Add buttons left. */
  needsYou: (count: number) => (count === 1 ? '1 field is left for you' : `${count} fields are left for you`),
  allClear: 'Nothing needs you. Check the form, then submit it yourself.',
  // ── v4 ui: the résumé and cover-letter rows' Preview and Show (the owner, 2026-11-07). Drafts for the owner. ──
  preview: 'Preview',
  previewLabel: (label: string) => `Preview "${label}"`,
  show: 'Show',
  showLabel: (label: string) => `Show "${label}" on the page`,
  // v1.5 X (PLAN decision 3): the résumé row's Edit, in Show's place.
  edit: 'Edit',
  editLabel: (label: string) => `Edit "${label}" in TailorIT`,
  // ── end v4 ui ──
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
    // v5 p1-panel: Title Case headings.
    heading: "Autofill Isn't Supported On This Page",
    intro: 'TailorIT Autofill fills job applications on these sites:',
    // v3 Phases 6 and 7b: Workday, iCIMS, Taleo, SuccessFactors and Oracle Recruiting Cloud, their sign-in and posting
    // pages known. The owner's snapshots of 2026-11-06 showed the application forms of Workday, iCIMS and Oracle (each
    // note says what is left to the person) and added SmartRecruiters and Workable's job-search site; Taleo's and
    // SuccessFactors' application forms still wait for snapshots.
    sites: [
      { name: 'Greenhouse', hosts: 'job-boards.greenhouse.io, boards.greenhouse.io', note: null },
      { name: 'Lever', hosts: 'jobs.lever.co', note: null },
      { name: 'Ashby', hosts: 'jobs.ashbyhq.com', note: null },
      { name: 'Workable', hosts: 'apply.workable.com, jobs.workable.com', note: null },
      { name: 'Workday', hosts: 'myworkdayjobs.com, myworkdaysite.com', note: WORKDAY_STEPS },
      { name: 'iCIMS', hosts: 'careers-<company>.icims.com', note: ICIMS_STEPS },
      { name: 'Taleo', hosts: '<company>.taleo.net', note: SIGN_IN_AND_POSTING },
      { name: 'SuccessFactors', hosts: 'career<n>.successfactors.com, .eu', note: SIGN_IN_AND_POSTING },
      { name: 'Oracle Recruiting Cloud', hosts: '<company>.fa.<region>.oraclecloud.com, <company>.fa.ocs.oraclegovcloud.com',
        note: ORACLE_FORM },
      { name: 'SmartRecruiters', hosts: 'jobs.smartrecruiters.com', note: null },
      // ── New ATSs (DESIGN-NEW-ATS Phase 0): their candidate pages, as src/shared/hosts.ts matches them ──
      { name: 'Jobvite', hosts: 'jobs.jobvite.com', note: null },
      { name: 'JazzHR', hosts: '<company>.applytojob.com', note: null },
      { name: 'BambooHR', hosts: '<company>.bamboohr.com/careers', note: null },
      { name: 'Rippling', hosts: 'ats.rippling.com', note: null },
      { name: 'Breezy HR', hosts: '<company>.breezy.hr', note: null },
      { name: 'CareerPlug', hosts: '<company>.careerplug.com', note: null },
      { name: 'Pinpoint', hosts: '<company>.pinpointhq.com', note: null },
      { name: 'Paycor', hosts: 'recruitingbypaycor.com', note: null },
      { name: 'HiBob', hosts: '<company>.careers.hibob.com', note: null },
      { name: 'UltiPro (UKG Pro)', hosts: 'recruiting.ultipro.com', note: null },
      { name: 'Dayforce', hosts: 'jobs.dayforcehcm.com', note: null },
      { name: 'Paylocity', hosts: 'recruiting.paylocity.com', note: null },
      { name: 'Dice', hosts: 'dice.com (its job applications)', note: null },
      { name: 'ClearCompany', hosts: '<company>.clearcompany.com/careers', note: null },
      { name: 'ADP Workforce Now', hosts: 'workforcenow.adp.com (its recruitment pages)', note: null },
      // ── end New ATSs ──
      // ── jr7 INT-7 (BUILD7: the coordinator's decision; ENGINE-7 E0's platforms, as src/shared/hosts.ts matches their
      // candidate pages). Jibe is iCIMS's front: its application is on iCIMS, so it is not listed (as COPY.strip.none). ──
      { name: 'UKG Ready', hosts: 'secure<n>.saashr.com (its careers pages)', note: null },
      { name: 'Paycom', hosts: 'www.paycomonline.net (its job portal)', note: null },
      { name: 'JobDiva', hosts: 'www<n>.jobdiva.com/portal', note: null },
      { name: 'Eightfold', hosts: '<company>.eightfold.ai/careers', note: null },
      // ── end jr7 INT-7 ──
    ],
    embedded: 'A company page that shows one of these forms inside it works too.',
    /** v3 Phase 8 review (B10): the company career sites, off or not reaching this page. v5 p1-rules (PLAN decision 10):
     *  on by default. */
    companySites: "On employers' own careers sites, it works while Company career sites is on in its settings (Where Autofill works), as it is unless you turned it off. It never works on LinkedIn or on an employer's HR system.",
    /** A page on one of those sites that opened before the extension could read it (installed or updated since). */
    reloadHeading: 'Reload This Page To Use Autofill', // v5 p1-panel
    reloadIntro: 'This page opened before TailorIT Autofill could read it. Reload it, and Autofill works here.',
    /** v3 Phase 8 review (B10): a company's own page while Company career sites is on, with no frame of ours on it. */
    reloadSiteHeading: 'No Application Form Found Here Yet', // v5 p1-panel
    reloadSiteIntro: "Company career sites is on. Autofill reads an employer's careers page as it loads, so if this page shows a job application and opened before you turned it on, reload it.",
  },
  /** v3 Phase 3b: "Ask TailorIT to support this site", on a page Autofill does not work on. Drafts for the owner. */
  siteRequest: {
    ask: 'Ask TailorIT To Support This Site', // v5 p1-panel
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
    // v5 p1-panel: Title Case buttons.
    next: 'Continue To The Next Page',
    submit: 'Submit Application',
    submitting: 'Submitting…',
    confirmEmpty: (count: number) => (count === 1 ? '1 required field is still empty. Submit anyway?'
      : `${count} required fields are still empty. Submit anyway?`),
    submitAnyway: 'Submit Anyway', // v5 p1-panel
    keepEditing: 'Not Yet', // v5 p1-panel
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
    submitted: 'Submitted!', // v5 p1-panel: Jobright's dock word
  },
  /** v3 Phase 4: after the platform confirmed the application. Drafts for the owner's review. */
  submitted: {
    title: 'Application Submitted', // v5 p1-panel
    openTracker: 'Open Job Tracker',
    /** The job the application was for, when the card names it. */
    job: (title: string, company: string) => (company === '' ? title : title === '' ? company : `${title} at ${company}`),
    states: {
      recording: 'Adding it to your Job Tracker…',
      recorded: 'Added to your Job Tracker as Applied.',
      'not-recorded': "Your Job Tracker couldn't be told. Try again, or mark it Applied in TailorIT.",
      'not-allowed': "This connection can't change your Job Tracker. Connect the extension again from TailorIT's Settings › Autofill.",
    } satisfies Record<SubmittedState, string>,
    tryAgain: 'Try Again', // v5 p1-panel
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
  // jr6 apply F1 fixer (the line P review, C2): a page of ours with no form that is no posting (a list of jobs, a page
  // no frame of ours is on) promises no Apply; a posting (`posting`) says Autofill presses its Apply first.
  noForm: `${NO_FORM_HERE}. ${OPEN_A_JOB}`,
  posting: `${NO_FORM_HERE} yet. Autofill presses the site's Apply first.`, // jr6 apply F1
  // DESIGN-NEW-ATS Phase 0: the new ATSs too. jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 2): and the four ATSs of snapshot7
  // (Jibe is iCIMS's front, whose application is on iCIMS).
  none: 'Open a job application on Greenhouse, Lever, Ashby, Workable, Workday, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany, ADP Workforce Now, UKG Ready, Paycom, JobDiva or Eightfold to use Autofill.',
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
  // v5 p1-panel: Title Case buttons.
  add: 'Add This Job To TailorIT',
  save: 'Save To Tracker',
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
  matchLabel: (percentage: number, band: string) => `${percentage}% match: ${band}`,
  matchTip: (matched: number, total: number) =>
    `${matched} of ${total} keywords in this posting are in your resume. The score is how well your resume covers what the job asks for.`,
  keywords: (matched: number, total: number) => `${matched} of ${total} keywords`,
  /** The badge on a job the tracker holds as Applied or later. */
  applied: 'Applied',
  /** The documents box (v3 Phase 3, Jobright's "Your Autofill Information" box). */
  documents: 'What the fill uses',
  autofillInfo: 'Your autofill information',
  noKeywords: 'This posting names no keywords to match.',
  unreadable: "This resume's text couldn't be read, so it has no match score.",
  attaches: 'Attaches',
  change: 'Change',
  noResume: 'No resume to attach. Add one in TailorIT.',
  closed: 'Closed',
  archived: 'Archived',
  /** The tracker chip of a status code TailorIT added after this version. */
  tracked: 'In your tracker',
  posted,
  alreadyApplied: (status: string | null) => (status === null ? 'Already in your tracker. Check before you apply again.'
    : `Already in your tracker as ${status}. Check before you apply again.`),
  arrangements: ARRANGEMENTS, // v5 p1-panel: named once
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
    profileOnly: "This posting doesn't allow AI, so only a letter you wrote is attached.",
    aiOff: 'AI-written answers are off, so only a letter you wrote is attached.',
    failed: "Your letter for this job isn't finished. Finish it in TailorIT's Cover Letters.",
    write: 'Write It Now', // v5 p1-panel
    writing: 'Writing…',
    ready: 'Ready',
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
    // v5 p1-panel: Title Case button and heading.
    open: 'Autofill For Another Job',
    heading: 'Autofill For Another Job',
    help: 'Fill this form for a job in your TailorIT tracker: its match, its resume and its details are used.',
    label: 'Search your tracked jobs',
    placeholder: 'Job title or company',
    searching: 'Searching…',
    none: 'No job in your tracker matches.',
    use: 'Use This Job', // v5 p1-panel
    pageJob: "Use This Page's Own Job", // v5 p1-panel
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
  withoutResume: 'Apply Without Resume', // v5 p1-panel
  /** The review: Apply without resume could not be kept (no form or posting of ours in the tab now). */
  withoutFailed: "That couldn't be changed: the page changed. Try again.",
  preview: {
    open: 'Preview',
    title: (label: string) => `Preview of ${label}`,
    loading: 'Loading the resume…',
    unavailable: "This resume's preview couldn't be shown.",
    notPdf: 'Only a PDF resume has a preview.',
  },
  picker: {
    heading: 'Choose The Resume To Attach', // v5 p1-panel
    loading: 'Reading your resumes…',
    failed: "Your resumes couldn't be read. Try again.",
    empty: 'You have no resume to attach. Add one in TailorIT.',
    current: 'Attached now',
    suggested: "Use TailorIT's Choice", // v5 p1-panel
    cancel: 'Cancel',
    kinds: { built: 'Built in TailorIT', uploaded: 'Uploaded' },
    // v1.5 X (PLAN decision 6): the list in folders, as TailorIT's Documents › Resumes shows them.
    folders: { uploaded: 'Uploaded Resumes', edited: 'Edited Resumes', tailored: 'Tailored Resumes' },
    folderLabel: (name: string, count: number) => `${name}, ${count} ${count === 1 ? 'resume' : 'resumes'}`,
    undated: 'No date',
  },
} as const;

/** The side panel's "Ask a custom question" (v2, src/ui/panel/Ask.tsx). Drafts for the owner's review. */
const ASK = {
  heading: 'Ask A Custom Question', // v5 p1-panel
  label: 'Your question',
  placeholder: 'e.g. Why do you want to work at Northwind?',
  length: 'Length',
  lengths: { short: 'Short', medium: 'Medium', long: 'Long' } satisfies Record<AskLength, string>,
  submit: 'Get Answer', // v5 p1-panel
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
  heading: 'Your Autofill Information', // v5 p1-panel
  intro: 'What TailorIT fills applications with. Your changes are saved to your TailorIT.',
  back: 'Back',
  loading: 'Loading your autofill information…',
  /** Why panel/profile gave no profile: by the worker's refusal. */
  loadFailed: {
    notConnected: 'Connect to TailorIT in the settings first.',
    rateLimited: 'Too many reads in a minute. Wait a little, then try again.',
    unavailable: "Your autofill information couldn't be read just now.",
  },
  retry: 'Try Again', // v5 p1-panel
  readOnly: "This connection can read your autofill information but not change it. To edit it here, connect the extension again from TailorIT's Settings › Autofill.",
  openInTailorit: 'Open In TailorIT', // v5 p1-panel
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  fixFirst: (count: number) => (count === 1 ? 'Fix 1 thing before saving:' : `Fix ${count} things before saving:`),
  conflict: 'Your autofill information changed elsewhere since you opened it.',
  conflictHelp: 'Load the latest to see it. Your changes here are kept on it, for you to check before you save.',
  loadLatest: 'Load The Latest', // v5 p1-panel
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
    // v5 p1-panel: Title Case section headings.
    experience: 'Work Experience',
    skills: 'Skills',
    preferences: 'Preferences',
    anythingElse: 'Anything Else We Should Know?',
    sensitive: 'Work Authorization And Self-Identification',
    // s2 profile (snapshot round 2)
    certifications: 'Certifications',
  },
  /** An entry of a list, by its place (from 1). */
  entry: {
    education: (place: number) => `Education ${place}`,
    experience: (place: number) => `Work Experience ${place}`, // v5 p1-panel
    workAuthorization: (place: number) => `Country ${place}`,
    // s2 profile (snapshot round 2)
    certification: (place: number) => `Certification ${place}`,
  },
  // v5 p1-panel: Title Case buttons.
  add: { education: 'Add Education', experience: 'Add Work Experience', workAuthorization: 'Add A Country',
    // s2 profile (snapshot round 2)
    certification: 'Add A Certification', place: 'Add A Place', relative: 'Add A Company',
    citizenship: 'Add A Citizenship' },
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
    // ── s2 profile (snapshot round 2, 2026-11-07): TailorIT's new profile values ──
    phoneType: 'Phone type',
    x: 'X (Twitter)',
    telegram: 'Telegram',
    referralSourceCategory: 'What kind of source that is',
    relocationPlaces: 'Places you would relocate to or work from',
    place: 'Place',
    name: 'Certification',
    issuer: 'Issued by',
    year: 'Year',
    raceSubgroups: 'Asian: which apply',
    raceSelfDescribed: 'Your race in your words',
    activeDuty: 'I serve in the U.S. armed forces now (active duty)',
    sexualOrientation: 'Sexual orientation',
    transgender: 'Identify as transgender',
    restrictiveAgreement: 'Bound by a non-compete or similar agreement',
    essentialFunctions: "Can perform a role's essential functions",
    governmentService: 'U.S. armed forces or government service',
    military: 'I served in the U.S. armed forces',
    militaryEndYear: 'Year your service ended',
    government: 'I worked for a U.S. federal, state or local government',
    governmentEndYear: 'Year that work ended',
    relativesAt: 'Companies where a relative of yours works',
    relative: 'Company',
    clearance: 'Security clearance',
    clearanceLevel: 'Clearance level',
    clearanceActive: 'Clearance status',
    polygraph: 'Polygraph',
    citizenships: 'Citizenship',
  },
  placeholders: { month: 'YYYY-MM', country: 'US', currency: 'USD', skills: 'TypeScript, PostgreSQL, Leadership' },
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
  arrangements: ARRANGEMENTS, // v5 p1-panel: named once, not read off JOB
  // ── s2 profile (snapshot round 2, 2026-11-07): the new values' choices and help. Drafts for the owner's review ──
  phoneTypes: { mobile: 'Mobile', home: 'Home', work: 'Work' } satisfies Record<PhoneDeviceType, string>,
  referralCategories: {
    'job-board': 'A job board or job site', 'company-website': "The company's website",
    'employee-referral': 'An employee referral', recruiter: 'A recruiter', 'social-media': 'Social media',
    event: 'An event or job fair', other: 'Something else',
  } satisfies Record<ReferralCategory, string>,
  asianSubgroups: {
    'east-asian': 'East Asian', 'south-asian': 'South Asian', 'southeast-asian': 'Southeast Asian',
  } satisfies Record<AsianSubgroup, string>,
  orientations: {
    asexual: 'Asexual', 'bisexual-pansexual': 'Bisexual or pansexual', gay: 'Gay', heterosexual: 'Heterosexual',
    lesbian: 'Lesbian', queer: 'Queer', 'self-describe': 'In my own words',
  } satisfies Record<SexualOrientation, string>,
  clearanceLevels: {
    none: 'None', 'public-trust': 'Public Trust', confidential: 'Confidential', secret: 'Secret',
    'top-secret': 'Top Secret', 'ts-sci': 'Top Secret / SCI',
  } satisfies Record<ClearanceLevel, string>,
  polygraphs: { none: 'No polygraph', ci: 'Counterintelligence polygraph', 'full-scope': 'Full-scope polygraph' },
  clearanceActive: { yes: 'Active now', no: 'Not active' },
  /** A citizenship's select, by its place (from 1): the first is a "Country of Origin". */
  citizenship: (place: number) => (place === 1 ? 'Citizenship (your country of origin)' : 'Another citizenship'),
  socialHelp: 'The address, or your @handle.',
  relocationHelp: 'For "Where would you relocate?" and "Which of these locations could you work from?"',
  relativesHelp: "None listed: no relative of yours works at a company you apply to. No relative's name is kept.",
  serviceYearHelp: 'Empty: you serve now.',
  raceSelfDescribedHelp: 'For a form\'s "I prefer to self-describe". Empty: that choice is never taken.',
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
    /** The first-run disclosure, shown before Connect (the store's "prominent disclosure"). A draft for the owner.
     *  v5 p1-rules: version 10 (shared/stored.ts DISCLOSURE_VERSION), all of v5 Phase 1; v5 p2-docs: version 11, all of
     *  v5 Phase 2; v13-docs: version 12, v1.3's submitted answers and known questions (the third paragraph, the agent's
     *  sentence, the run-start batch) and v1.4's tailoring, full-window preview and templates (docs/PRIVACY.md);
     *  v15-docs: version 13, v1.5's previews over the page in the extension's own frame, its one page web pages could
     *  load, Edit of an uploaded resume, and the answers TailorIT prepared ahead of time (Prebuild); v15b-docs:
     *  version 14, v1.5 part 2's Queue tab (the jobs queued in TailorIT opened one by one in new tabs on the person's
     *  timer, filled and submitted as their settings say, TailorIT told of each opening and result; never beside Run
     *  auto-apply); jr6: version 15; jr7 INT-7: version 16 (stored.ts says what each changed). */
    disclosureHeading: 'Before you connect',
    disclosure: [
      'TailorIT Autofill fills job applications on Greenhouse, Lever, Ashby, Workable, Workday, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany, ADP Workforce Now, UKG Ready, Paycom, JobDiva and Eightfold from the profile you keep in your own TailorIT (on Taleo and SuccessFactors it knows the sign-in and posting pages so far; their application forms get its standard rules). It reads the job pages you open on those sites, fills every field it can answer, deciding for itself rather than asking you, and lists what it filled and what it left empty. Where such a site also holds an employer\'s own pages for its staff (ADP Workforce Now, BambooHR, ClearCompany, Oracle Recruiting Cloud, UKG Ready\'s saashr.com, Paycom, JobDiva, Eightfold and others), it runs only on the job pages, though Chrome\'s prompt names the whole site. Unless you turn off Company career sites in its settings, it also looks at each https page you open (never LinkedIn, an employer\'s HR system or the frame of a check that you are human) for an application form on an employer\'s own careers site, says and sends nothing about a page it does not recognise, and fills a form it recognises as it does on those sites, telling your TailorIT that page\'s address, without its other query parameters, when its panel opens there (by itself, or because you open it) or you choose Autofill. This, and its panel showing on the sites you visit, is why Chrome says when you install it that it can read and change all your data on all websites (every https and http page). It submits an application only when you choose Submit application in its panel, set Submit to Auto under Modes, or turn on Run auto-apply; once the site confirms it, it tells your TailorIT tracker the job is Applied. On the candidate pages of Workday, ClearCompany, Oracle Recruiting Cloud (on Oracle\'s site, or on an employer\'s own once Oracle\'s application form shows there) and SuccessFactors, a small script of its own runs in the page\'s own context, beside the site\'s own scripts, and watches for the site\'s own request that sends the application, to learn only whether it went through: it tells that request from the page\'s others by its address, notes its answer\'s status and, on Workday, Oracle Recruiting Cloud and SuccessFactors, reads from the request or its answer only whether the site says it took the application. That yes or no is all that reaches the extension, which counts it only after a Submit in that page; nothing else of what the page sends or receives is kept or sent. Once a fill starts on a page, a second small script of its own runs in that page\'s context too. It holds back any alert the page shows in answer to its writes or while an upload it made finishes (as if closed), and any confirm the page shows in answer to its own typing or choosing (as if you chose Cancel), never a confirm the page asks while it waits and never one that follows your own click or key; TailorIT Autofill then shows you on the page how many were held back, never their words (unless you set its notifications on the page to Never show them). Where a site\'s resume button opens the site\'s own file picker, the script may answer that picker with the resume you chose, for that one upload, giving it only to a file input that belongs to that button (in its own part of the page, or made by that press) or to the file picker that press opens. The site\'s scripts can tell either script is there. It types into rich-text boxes with the browser\'s own editing, which the page sees as typing. On a job page that shows no application form, Autofill in its panel first presses the site\'s own Apply when you choose it, and the steps the site shows on the way (such as Workday\'s Apply Manually, a dialog\'s "Apply manually" or "Continue as guest", Jobvite\'s and Taleo\'s "I Accept", or Consent & Continue on ADP Workforce Now\'s privacy notice, never its Decline), then fills the application it opens in the same tab on that site. Where the site\'s Apply would open a new tab or lead to another site, it presses nothing and tells you why; where it would download a file, it presses nothing and says it found no Apply it could press; if a press takes the tab to another site, it does not go on there by itself. With Run auto-apply on, it takes the jobs you queue in TailorIT one at a time, opens each in a window of its own while this browser is open, fills it, and submits it without you watching, AI guesses included, unless the rules under Modes leave it for you; it tells your TailorIT how each one went, and, as for any application you submit, its questions and your answers. Run auto-apply takes only the jobs on sites whose application it can walk to the end by itself and whose confirmation it can read, never a site that shows a check that you are human or sends you a code: TailorIT marks a job on any other site Queue tab only, and it waits for the Queue tab. When a site asks for a code or a check after it pressed Submit, it leaves that tab open for you and tells your TailorIT the job needs you. When you choose Start in its panel\'s Queue tab, it opens the jobs you queued in TailorIT (on any site it fills, Queue tab only jobs included) one by one in new tabs of this browser, on the timer you set: the seconds between tabs, growing by the seconds you add each time, with no more unfinished queued tabs open at once than you allow. It fills and submits each as your settings say: it fills each tab by itself unless you set Autofill when a queued tab opens to Manually, and it submits only with Submit set to Auto under Modes, the rules under Modes still leaving a job for you. On a job page it presses the site\'s own Apply first. On a site where it cannot read that an application went through, it leaves Submit to you in that tab, whatever Submit is set to. The list of queued jobs comes from your TailorIT, which it tells as it opens each job and how each one went; a submitted job\'s tab closes a few seconds after the site confirms it, unless it is the tab its window shows. Run auto-apply and the queue never run at the same time: starting one stops the other. The job-site email and password you set under Sign-up Information in its settings are kept in this browser, the password encrypted, and are never sent to TailorIT. The encryption keeps the password from other extensions, websites, sync and exports, but not from someone who can read this browser\'s files on this computer, so use a password you keep for job sites alone. It types them only into a job site\'s own sign-in or new-account form (ticking the new account\'s terms box), never anywhere else. With Sign-in on Auto, or for one Autofill when you choose Sign Up & Autofill, it also presses that form\'s Sign In or Create Account, once per page in ten minutes. On Manual, when Autofill reaches a sign-in or new-account form in a tab you are looking at, it types them with no further click (first pressing a button that only shows the form, like Workday\'s "Sign in with email"), leaves the press to you, and keeps what it typed there until you press, Autofill stops or you leave the page (three minutes at most after a press the site refused; in an application form\'s own account section, until you submit the form); it never types them in the auto-apply window on Manual. It decrypts the password only to type it, and keeps it in memory only for that sign-in. Import from TailorIT, on your click, copies the job-site sign-in you saved in TailorIT for every site into this browser once. Where a site asks for your email first (iCIMS, Oracle Recruiting Cloud, ADP Workforce Now), it types your email there (on iCIMS also the phone and country code it asks for, from your profile), ticking its terms as Consent boxes says, in either Sign-in mode, and presses its Next only on Auto or with Sign Up & Autofill, never where the step asks for more; a code the site then emails you is yours. Checks that you are human, password resets and email codes stay yours. It never ticks an "I\'m not a robot" box or solves any other check that you are human. Where a form shows such a box you have not ticked yet, it fills the form and still presses Next, Submit, sign-in or Apply as it otherwise would, and the site decides; if the site asks you to complete the check, it waits until you have, then carries on by itself (a sign-in it typed stays in the form for you to press, for three minutes at most). A check that pops up over the page pauses it until you are done. Unless you choose Required only under Modes, it ticks every agreement box a form shows, news, job alerts and text messages included (and agrees to a privacy notice a site shows before a resume upload), except a binding clause the form does not require (an arbitration agreement, say) and a box saying you did not use AI, which it ticks only when the fill used no AI. Some sites (Ashby) send a text message consent to the employer the moment it is ticked. Some sites keep what is filled before you submit: Ashby saves answers and files as they go in; Workable uploads an attached file at once and keeps the answers in this browser for an hour.',
      'When an application page or a job posting on those sites loads, and again while its panel shows one, it tells your TailorIT which job page you are on, so TailorIT can name the job, your tracker entry for it and your match before you open the panel; it does so again when you choose Autofill, add the job or change the resume. TailorIT does not keep the page\'s address unless you add the job, or mark it Applied after you submit. When a page names no job (a form reached from its posting), it takes the job of the tab\'s page before it: this browser keeps which job the tab\'s recent pages were until you close the tab, and TailorIT hears that job\'s posting address, never the page\'s own. On an iCIMS Jibe job page it tells your TailorIT the job\'s iCIMS address, read from that page\'s Apply link. Its panel can show and change your autofill information in your TailorIT, the templates TailorIT writes a tailored resume and cover letter on included, and preview the resume and the cover letter it attaches over the page you are on, inside a frame of the extension\'s own that the page\'s scripts cannot read (from Chrome\'s side panel too; in a full window of the extension\'s own when you choose Open In A New Tab or the page cannot show it), or open them in TailorIT to edit them (a resume you uploaded opens as an editable copy that your TailorIT\'s AI makes from your file, or one it made before; it asks you first unless you chose Don\'t show this again). For that preview the extension has one page that web pages could load, at an address that changes each browser session; loaded by any other page, it shows none of your files. The panel shows on the page you are on, at its right edge, unless you choose Chrome\'s side panel in its settings: it opens by itself on an application page (or shows only its button, if you choose that), moves the page aside to make room, changing the page\'s layout but never its content, and keeps what it shows, your autofill information included, in a part of the page the site\'s own scripts cannot read. While it shows, the site\'s scripts can tell that it does: it marks the page and the parts it moves, and adds its own stylesheet and its own copy of the Inter font (carried in the extension, never fetched), all taken away when it closes. What you type into it, your autofill information or a question of your own, reaches the page\'s own key and input listeners as typing anywhere on the page does. Chrome\'s side panel keeps both from the site, though a preview, and the question before editing a resume you uploaded, still open over the page. The toolbar icon opens the panel too, on any https page but those it never runs on, where Chrome\'s side panel opens instead. When you choose Autofill, it fetches your profile from TailorIT, and your resume and your cover letter for the job when the form asks for them. It keeps them in memory only, never on disk: your profile until five minutes after its last use, and the files only for the seconds it takes to attach them, or while you preview them. This browser keeps your settings, where you put or hid its button on each site, which of the panel\'s notes you closed, notes on each application\'s progress, the options some sites\' dropdown lists offer (so it can choose from them at once next time; never what you chose) and, until you close the browser, a sealed record of the list options you submitted, which it can match again but never read: never your answers.',
      'When a site confirms an application you submitted (with TailorIT Autofill, or on your own while Record applications I submit myself is on), TailorIT Autofill sends that application\'s questions to your TailorIT, and your answers too unless you turn off Keep my submitted answers in TailorIT under Modes. Your TailorIT keeps the questions for everyone who uses it, never showing them on its Jobs page, and keeps your answers for you alone: you see them in the Tracker, and they answer the same questions for you later where your profile does not, before any AI is asked. For that, the extension asks your TailorIT for the job\'s questions and your earlier answers as a job page loads (when your TailorIT says it keeps some) and when it fills a form, naming the job and, for questions your profile leaves open, only their wording and a fingerprint of their options. With them come the answers your TailorIT prepared for the job ahead of time, if you used Prebuild there (written by its AI or by your own AI through TailorIT): a ready one fills its question where your profile and your earlier answer to that job do not, before your answers to other jobs and before any AI is asked, never for a self-identification, legal, pay, consent or attention-check question or a file. If the job is not yet among those your TailorIT shares with everyone who uses it, it is added there; on some sites the extension sends the posting\'s visible text, company and title for that. Passwords, checks that you are human, hidden fields and what your files contain are never sent: for a file, only that one was attached and its name. Your answers to self-identification, work authorization, sponsorship, criminal history and pay questions go to your TailorIT too, and your TailorIT gives none of these answers to the AI. This browser keeps none of it.',
      'Its AI help sends the visible text of a question and its visible options, with the answer from your profile it is trying to match, to your TailorIT, which asks Claude. Your TailorIT sends the answers back as a stream, each as soon as it is ready, and the extension fills each in as it arrives. Picking from lists, working out unusual questions, drafting open answers (a cover letter too, when the form asks for one and you have none for the job) and answering the questions your profile does not are on unless you turn them off below; drafts, cover letters and answers also give Claude the posting\'s visible text, and TailorIT gives it your resume and profile to write from. Where your TailorIT already keeps a job\'s questions, those your profile, earlier answers and prepared answers leave open go to the AI together as a fill starts, for every step of the form at once. When you choose Tailor Resume For This Job or Generate Cover Letter in its panel, your TailorIT asks Claude to write a resume tailored to the job, and with Generate Cover Letter a cover letter beside it, from the resume it would attach and the posting (the job TailorIT has, or the posting\'s visible text, company and title when it has none), on the templates you chose; your TailorIT keeps them and links them to the job in your tracker, and the extension attaches them from then on. An answer with nothing to go on is the AI\'s best guess. On a posting that says AI is not allowed, nothing goes to the AI unless you choose otherwise below, or ask a question of your own in its panel. That question, Edit with AI in a text box and tailoring go to the AI only when you ask, and only while AI-written answers (Draft open answers, below) are on. Unless you choose Profile only for AI answers under Modes, questions about work authorization, sponsorship, a visa, a clearance, government service, military training, age, criminal history, a non-compete, relatives or pay that your profile does not answer, and attention checks, get the AI\'s best guess too, from the question and its options alone. Your self-identification (sexual orientation included), work authorization, sponsorship, citizenship, clearance, criminal record, non-compete, government service, relatives, essential functions, pay and consent answers never go to the AI. The extension talks only to your TailorIT.',
    ],
    consentLine: 'Choosing Connect means you agree to this.',
    connect: 'Connect to TailorIT',
    connectedAs: (name: string, email: string) => `Connected as ${name} (${email}).`,
    connectedNoAccount: 'Connected to TailorIT.',
    sensitiveShared: 'This browser may read your work authorization and self-identification answers.',
    sensitiveNotShared: SENSITIVE_NOT_SHARED, // v5 p1-panel: named once, not read off REASONS
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
      help: 'Auto presses Next once a page of the application is filled and settled. The last page\'s Submit is the Submit mode\'s.',
    },
    submit: {
      name: 'Submit',
      manual: 'Manual',
      auto: 'Auto',
      help: 'Auto presses Submit once the last page of the application is filled and checked, unless a required field is still empty, the posting says AI is not allowed, or the page asks you to prove you are human: then a TailorIT notice on the page says why, and you submit. Manual: you submit, on the page or with Submit application in the side panel.',
    },
    signIn: {
      name: 'Sign-in',
      manual: 'Manual',
      auto: 'Auto',
      // jr6: the password is the one saved in this browser's Sign-up Information (TailorIT's Job-site sign-in before).
      // The jr6 review (R16): kept short, for the sidebar's budget.
      help: 'Auto signs in, or creates your account, on job sites that ask (Workday, iCIMS and others) with your Sign-up Information, and presses the button. Manual types it and leaves the button to you. Human checks and email codes stay yours.',
      /** Why Auto cannot be chosen now. */
      needsPassword: 'Sign-in Auto needs a job-site password saved in Sign-up Information.',
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
      // jr7 INT-7: the sites named from the platforms whose confirmation it reads (shared/queue-submit.ts); one pure
      // call, so a bundle that never shows the options' words (the content script) drops it and the list.
      help: /* @__PURE__ */ recordOwnHelp(QUEUE_SUBMIT_PLATFORMS),
    },
    // v1.3 B (settings version 9): the answers of an application the person submits, kept in their own TailorIT.
    keepAnswers: {
      name: 'Keep my submitted answers in TailorIT',
      on: 'On',
      off: 'Off',
      help: "On: when a site confirms an application you submitted, its questions and your answers go to your TailorIT. The questions are kept for everyone who uses your TailorIT, never shown on Jobs; your answers are yours alone, shown in the Tracker's Submitted answers, and fill the same questions for you next time. Off: only the questions go. Never sent: passwords, CAPTCHAs, hidden fields, or what your files contain (only that a file was attached, and its name).",
    },
    afterPageTurn: {
      name: 'Autofill after page turn',
      auto: 'Automatically',
      manual: 'Manually',
      help: 'On applications with several pages (Workday and others), fill each new page as it appears, or wait until you choose Autofill again on it.',
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
      // jr6 integration (RULES revD-01 and revD-04, owner question 435): a non-compete, relatives and military training
      // too, always marked an AI guess (GUESS_ONLY_CATEGORIES); never a job's essential functions.
      help: 'All lets the AI answer work authorization, sponsorship, visa, clearance, age, criminal history, pay, non-compete, relatives, military training and "select PURPLE to show you read this" questions your profile doesn\'t answer, with its best guess unless your resume settles it (always marked an AI guess for a non-compete, relatives or military training): only the question and its options are sent. Profile only answers them from your profile, and leaves the rest empty. It acts while "Answer the questions my profile does not" is on.',
    },
    /** The behaviour review of 2026-11-06 (M2), the owner's setting: a résumé the page already shows. */
    resumeOnPage: {
      name: 'Résumé already on the page',
      keep: 'Keep it',
      upload: 'Upload mine again',
      help: "When the site already shows a résumé in its résumé field: Keep it leaves that file as your résumé there. Upload mine again uploads the résumé you chose in TailorIT into that field through the site's own upload, which replaces the file or adds yours beside it. Neither presses the site's Remove or Delete; where the site gives no way to add a file, the field is left to you.",
    },
    // v5 p1-shell (settings version 8): the view's new meaning, and where the panel shows.
    view: {
      name: 'Default view',
      expanded: 'Expanded',
      minimized: 'Minimized',
      help: "Expanded opens the TailorIT panel by itself on a job application or posting. Minimized shows only the TailorIT button at the page's edge, which opens it. With Chrome's side panel, the panel opens from the button or the toolbar icon either way.",
    },
    panel: {
      name: 'Where the panel shows',
      page: 'On the page',
      side: "Chrome's side panel",
      help: "On the page: a panel at the page's right edge, which pushes the page left. Chrome's side panel: Chrome's own panel beside the page.",
    },
    // ── s2 profile (snapshot round 2, settings version 7): drafts for the owner's review ──
    noMatch: {
      name: 'When a list has no match',
      other: 'Choose its Other',
      leave: 'Leave it empty',
      help: "When a list you search (a school, a field of study, a place, how you heard about the job) shows no match after three differently written answers: Choose its Other picks the list's own \"Other\" or \"Not listed\". Leave it empty leaves the field to you. Never for self-identification, legal, consent or yes-or-no questions.",
    },
    notifications: {
      name: 'TailorIT notifications on the page',
      'until-closed': 'Until I close them',
      '30s': '30 seconds',
      '10s': '10 seconds',
      '5s': '5 seconds',
      off: 'Never show them',
      help: "How long TailorIT's notifications stay on the application page (a check to solve, a sign-in, Submit held back, the end of a run). Each still goes once its cause is gone. Autofill still waits and carries on by itself whatever you choose, and unless they stay until you close them, the side panel says what it waits for. The notice that a page holds text addressed to AI tools always shows.",
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
      // The audit of 2026-11-06 (M5): a draft for the owner's review.
      offline: 'Auto-apply waits until this browser is back online.',
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
    intro: 'Through your TailorIT, which asks Claude. When nothing in your resume or profile settles a question, the AI gives its best guess.',
    tiebreak: 'Pick from a list when unsure',
    tiebreakHelp: 'When your answer could match more than one option, the AI picks among the visible options.',
    classify: 'Work out unusual questions',
    classifyHelp: 'When no rule recognises a question, the AI says what it asks, so your profile can answer it.',
    drafts: 'Draft open answers',
    draftsHelp: 'Drafts answers to questions like "Why this company?" from your resume and the posting, and writes them in.',
    answers: 'Answer the questions my profile does not',
    answersHelp: 'Questions like "How many years of Go have you used?" or "Are you open to travel?" are answered from your resume and profile. When nothing settles one, the AI gives its best guess.',
    confirmDrafts: 'Wait for me to confirm each draft',
    whenForbidden: {
      heading: 'When a posting says AI is not allowed',
      'profile-only': 'Fill from my profile only',
      'profile-onlyHelp': 'Nothing is sent to the AI for that posting, and questions only the AI could answer are left for you. The same goes for a form that asks you to confirm you did not use AI.',
      ask: 'Ask me each time',
      'use-ai': 'Use AI anyway',
      'use-aiHelp': 'The notice is shown, and filling goes on with the AI.',
    },
    never: 'Your EEO, authorization, sponsorship, criminal record and pay answers never go to the AI. Self-identification and consent questions are never sent to it.',
  },
  interpretations: {
    heading: 'Interpretations',
    intro: 'Readings that go further than the rules say. Each is on unless you turn it off.',
    postingCountryForLegal: 'Answer work authorization questions that name no country',
    postingCountryForLegalHelp: 'Uses your answer for the country of the posting, or for your only country when the posting names none.',
    twoOrMoreRaces: 'Answer "Two or More Races"',
    twoOrMoreRacesHelp: 'When you gave several races and the question takes one answer.',
    eeoDeclineByDefault: 'Decline self-identification questions I have not answered',
    eeoDeclineByDefaultHelp: 'Chooses the form\'s "Decline to self-identify" option when TailorIT holds no answer of yours. With no such option, the question is left empty.',
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
      platform: 'the site: Greenhouse, Lever, Ashby, Workday, Workable, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany, ADP Workforce Now, UKG Ready, Paycom, JobDiva, Eightfold or a company\'s own careers site;',
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
  /** v3 Phase 8: Options › "Where Autofill works". Drafts for the owner's review. */
  sites: {
    heading: 'Where Autofill works',
    intro: "Autofill always works on Greenhouse, Lever, Ashby, Workable, Workday, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany, ADP Workforce Now, UKG Ready, Paycom, JobDiva and Eightfold. With this on, as it is unless you turn it off, it works on employers' own careers sites too. Chrome gave it the permission when you installed it.",
    // v5 p1-rules (PLAN decision 10): the intro above, on by default with the permission held from install.
    toggle: 'Company career sites',
    hint: "On employers' own careers pages, Autofill recognises an application form (a resume upload, or your name, email and phone on a job page) and fills it as it fills any form. Chrome calls this reading your data on all websites: the extension's watcher reads each https page you open, and says and does nothing until it recognises one. It never runs on LinkedIn or on an employer's HR system (Workday, SAP SuccessFactors, Oracle, and the employee pages of ADP Workforce Now, BambooHR, Paycom and ClearCompany).",
    needsPermission: "Chrome's permission is off, so this does nothing. Turn it on again to give it back.",
    refused: "Chrome didn't give the permission, so this stays off.",
    failed: "This couldn't be changed just now. Try again.",
  },
  // ── v1.5 QX (settings version 11): the sequential auto-apply's settings. Drafts for the owner's review. ──
  queue: {
    heading: 'Queue',
    intro: "How the panel's Queue tab opens the jobs you queue in TailorIT: one new tab after another, each the job's application, at most so many at once.",
    durationSec: {
      name: 'Seconds between tabs',
      help: 'How long after a queued tab opens the next one opens. 1 to 600 seconds.',
    },
    accelerationSec: {
      name: 'Seconds added each time',
      help: 'Added to the wait after every tab, so the waits grow: with 8 and 0.5 they are 8, 8.5, 9, 9.5 seconds and so on. 0 to 60 seconds.',
    },
    autofillOnOpen: {
      name: 'Autofill when a queued tab opens',
      auto: 'Automatically',
      manual: 'Manually',
      help: 'Automatically fills each queued application as its tab opens, as Autofill would. Manually waits until you choose Autofill in that tab. Either way Submit follows the Submit mode below, and a check that you are human, a sign-in or a field it cannot fill waits for you.',
    },
    maxOpenTabs: {
      name: 'Queued tabs open at once',
      help: 'At most this many queued tabs are open and not done. While they are, the timer waits; a tab submitted or closed makes room. 1 to 10.',
    },
    seconds: 'seconds',
    tabs: 'tabs',
    /** "Waits: 8 s, 8.5 s, 9 s, 9.5 s …" */
    preview: (waits: readonly string[]) => `Waits: ${waits.map((wait) => `${wait} s`).join(', ')} …`,
    invalid: {
      durationSec: 'Enter 1 to 600 seconds, to a tenth at most.',
      accelerationSec: 'Enter 0 to 60 seconds, to a tenth at most.',
      maxOpenTabs: 'Enter a whole number from 1 to 10.',
    },
  },
  // ── end v1.5 QX ──
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
/** The audit of 2026-11-06 (M5, m14): why the agent paused itself, Run auto-apply off until the person turns it on
 *  again. Drafts for the owner's review. */
const AGENT_PAUSE_WORDS = {
  'no-window': "Chrome didn't open a window for the next job",
  'page-errors': "several pages in a row didn't load",
  'window-closed': 'you closed its window',
} as const satisfies Record<AgentPause, string>;

// ── jr7 AUTO-7 (ICIMS7-04; FIX7PLAN §6.4 items 3 and 14): the agent's and the Queue tab's own words beside the
// contract's reasons. Drafts for the owner's review (Q7-15). ──
const AGENT_NOTE_WORDS = {
  assessment: 'This application continues with an assessment',
  // jr7 INT-7's words (UP7-07, gated Q7-8): a site's dialog after the Submit asking whether to save the application's
  // documents to the person's profile on that site (UltiPro's the first; any adapter's 'documents' hand-over, so the
  // site is not named). Read after "Needs you (" in the agent's line and as a queued job's note.
  documents: 'This site asks whether to save your documents to your profile there',
} as const satisfies Record<AgentNote, string>;
// ── end jr7 AUTO-7 ──

const AGENT = {
  label: 'Auto-apply',
  stop: 'Stop',
  open: 'Open Auto-apply in TailorIT',
  states: AGENT_STATES,
  reasons: AGENT_REASONS,
  pauses: AGENT_PAUSE_WORDS,
  /** "Auto-apply: running Senior Backend Engineer at Northwind · 2 done today · last: Needs you (a check that you are
   *  human)". */
  line(status: Pick<AgentStatus, 'phase' | 'job' | 'doneToday' | 'last'>
    & Partial<Pick<AgentStatus, 'pending' | 'paused'>>): string {
    const job = status.job === null ? '' : status.job.company === '' ? status.job.title
      : status.job.title === '' ? status.job.company : `${status.job.title} at ${status.job.company}`;
    // The agent paused itself (M5, m14): why, and that the person turns it on again.
    const paused = status.phase === 'off' && status.paused != null
      ? `paused because ${AGENT_PAUSE_WORDS[status.paused]}; turn Run auto-apply on to go on` : null;
    const phase = status.phase === 'running' ? (job === '' ? 'running' : `running ${job}`)
      : status.phase === 'waiting' ? 'waiting for a job' : status.phase === 'blocked' ? 'paused' : paused ?? 'off';
    // jr7 AUTO-7 (ICIMS7-04): the extension's own words, where the result has them, in place of the reason's.
    const why = status.last?.note !== undefined ? AGENT_NOTE_WORDS[status.last.note]
      : status.last?.reason == null ? null : AGENT_REASONS[status.last.reason];
    const last = status.last === null ? '' : ` · last: ${AGENT_STATES[status.last.state]}${why === null ? '' : ` (${why})`}`;
    const pending = status.pending === true ? ' · a result not yet told TailorIT' : '';
    return `Auto-apply: ${phase} · ${status.doneToday} done today${last}${pending}`;
  },
} as const;

// ── v1.5 QX: the panel's tab bar and its Queue tab (PLAN decisions 7 and 9). Drafts for the owner's review. ──
/** A queued job's status chip. */
const QUEUE_STATUS_WORDS = {
  queued: 'Queued', opening: 'Opening', opened: 'Opened', filling: 'Filling', ready: 'Ready for you',
  submitted: 'Submitted', skipped: 'Skipped', failed: 'Failed',
} as const satisfies Record<QueueItemStatus, string>;

/** Seconds as the Queue tab says them: one decimal under ten, whole above ("8.5", "12"). */
const secondsOf = (ms: number) => {
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 10 ? (Math.ceil(seconds * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.ceil(seconds));
};

const QUEUE = {
  tabs: { label: 'TailorIT panel', autofill: 'Autofill', queue: 'Queue' },
  heading: 'Auto-apply Queue',
  /** The progress bar's "3 of 12", and its accessible name. */
  progress: (opened: number, total: number) => `${opened} of ${total}`,
  progressLabel: 'Queued jobs opened',
  seconds: secondsOf,
  next: (ms: number) => `Next tab in ${secondsOf(ms)}s`,
  held: {
    cap: (open: number, ms: number) => `${open} queued ${open === 1 ? 'tab is' : 'tabs are'} open. The next opens ${secondsOf(ms)}s after one is done or closed.`,
    offline: 'Waiting until this browser is back online.',
    server: (ms: number) => `TailorIT didn't answer. Trying again in ${secondsOf(ms)}s.`,
  },
  paused: (ms: number | null) => (ms === null ? 'Paused.' : `Paused · the next tab opens ${secondsOf(ms)}s after Resume`),
  allOpened: (open: number) => (open === 1 ? 'Every job is open · 1 tab still waits for you or fills'
    : `Every job is open · ${open} tabs still wait for you or fill`),
  finished: 'Every queued job is done.',
  idle: (count: number) => (count === 1 ? '1 job is queued. Start opens it in a new tab.'
    : `${count} jobs are queued. Start opens them one by one in new tabs.`),
  stopped: {
    person: 'Stopped. The tabs it opened stay open for you.',
    agent: 'Stopped: Run auto-apply was turned on in the settings. The two never run together.',
    connection: "Stopped: this browser's connection to TailorIT changed.",
    disclosure: 'Stopped: choose I understand on the updated notice, then Start again.',
    'no-tab': "Stopped: Chrome didn't open a tab for the next job.",
  } satisfies Record<QueueStop, string>,
  agentStopped: 'Run auto-apply was turned off, so it never runs beside the queue.',
  agentOn: 'Run auto-apply is on. Start turns it off: the two never run together.',
  blocked: {
    'not-connected': 'Connect this browser to TailorIT to use the queue.',
    'no-scope': "This browser's connection was made before auto-apply. Disconnect, then connect again.",
    disclosure: 'Choose I understand on the updated notice to use the queue.',
  } satisfies Record<QueueBlock, string>,
  start: 'Start',
  stop: 'Stop',
  pause: 'Pause',
  resume: 'Resume',
  /** What Start does, by the settings as they act now. */
  startHelp: (autofill: 'auto' | 'manual', submit: 'auto' | 'manual') => `Start opens your queued jobs one by one in new tabs, in the background. ${autofill === 'auto' ? 'Each fills by itself as it opens' : 'Each waits for you to choose Autofill in it'}, and ${submit === 'auto' ? 'Submit mode Auto submits it unless a rule leaves it for you' : 'you press Submit in each (Submit mode Manual)'}. Change this in Settings.`,
  statuses: QUEUE_STATUS_WORDS,
  reasons: AGENT_REASONS,
  // ── jr7 AUTO-7 ──
  /** AUTO7-01 (FIX7PLAN D-4): a job on a site where the extension cannot read that an application went through. */
  submitYours: 'Submit is yours on this site',
  /** ICIMS7-04: why a job rests with the person, in the extension's words. */
  notes: AGENT_NOTE_WORDS,
  // ── end jr7 AUTO-7 ──
  /** A row's button: its title, company and status, and that it goes to its tab. */
  row: (title: string, company: string, status: string, tab: boolean) =>
    `${title}${company === '' ? '' : `, ${company}`}: ${status}${tab ? '. Go to its tab' : ''}`,
  listLabel: 'Queued jobs',
  /** What a screen reader hears as the queue moves on (never the seconds). */
  live: (phase: QueuePhase, opened: number, total: number) => (phase === 'idle' ? ''
    : `Queue ${{ running: 'running', paused: 'paused', finished: 'done', stopped: 'stopped' }[phase]}: ${opened} of ${total} opened.`),
  more: 'Show More',
  empty: 'No jobs are queued. Queue jobs in TailorIT: Jobs or Job Tracker › Auto-apply.',
  readFailed: "The queue couldn't be read. Try again in a moment.",
  tryAgain: 'Try Again',
  open: 'Open Auto-apply in TailorIT',
  pending: 'A result TailorIT has not taken yet is sent again.',
  /** "Submitted 3 · Ready for you 1 · Failed 1": the statuses past Opening that have a count. */
  counts: (counts: Readonly<Record<QueueItemStatus, number>>) => (['filling', 'ready', 'submitted', 'skipped', 'failed'] as const)
    .filter((status) => counts[status] > 0).map((status) => `${QUEUE_STATUS_WORDS[status]} ${counts[status]}`).join(' · '),
} as const;
// ── end v1.5 QX ──

/**
 * The words of the in-page UI (src/content/ui) and the review (src/ui/report), which the content script shows: it
 * imports these alone, so the words only the options page and the side panel show (COPY's job card, Ask, profile
 * editor, settings and agent) stay out of its bundle, which has a size budget (scripts/check-build.mjs; the integration
 * of 2026-11-06 took about 34 KB of those words out of it). Every page but the content script reads COPY, which holds
 * these too.
 */
export const PAGE_COPY = {
  appName: 'TailorIT Autofill',
  /** The name as the headers draw it: "Tailor", then "IT" in TailorIT's ink, then the product's word. */
  brand: { name: ['Tailor', 'IT'], product: 'Autofill', settings: 'Autofill settings' },
  panelTitle: 'Review',
  panelEmpty: 'Nothing to review yet. Open a job application and choose Autofill.',
  // jr7 ENGINE-7 E1 item 10 (jr7-O7): the review's row for a required block that holds no entry yet (Oracle's Skills),
  // `block` its title as the page shows it. jr7 INT-7's words: they hold for a block of entries (Oracle's Skills) and for
  // a required pad the person draws in (Paycom's Signature), where "add at least one" read oddly.
  requiredBlockLeft: (block: string) => `${block}: required, still empty`,
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
  // ── v4 run (D11): the launcher shows progress only. Drafts for the owner's review. ──
  launcherNeedsYou: 'Autofill is waiting for this page. Choose to continue.',
  launcherPolicy: 'This posting says AI-assisted applications are not allowed.',
  launcherReview: (percent?: number) => (percent === undefined || percent >= 100 ? 'Autofill is done. Open the review'
    // The percent is of the required fields, or of every field when none is required (progressOf): "filled" says both.
    : `Autofill is done: ${percent}% filled. Open the review`),
  launcherError: 'Something went wrong. Choose to try again.',
  launcherNotConnected: 'Connect TailorIT Autofill to TailorIT in its settings, then try again.',
  /** The launcher at the page's right edge (v3 Phase 3): its progress while it fills, its grip and its hide menu.
   *  Drafts for the owner's review. */
  launcherFilling: (percent: number) => `Autofilling, ${percent}%`,
  launcherMove: 'Drag up or down to move the TailorIT button',
  // ── v5 p1-shell (PLAN decisions 2 and 3): the hide menu's items in Title Case, Jobright's. ──
  launcherHide: {
    open: 'Hide the TailorIT button',
    nextVisit: 'Hide Until Next Visit',
    site: 'Hide on This Site',
    everywhere: 'Hide Everywhere',
    note: 'The TailorIT Autofill icon in the toolbar brings it back.',
  },
  // ── v5 p1-shell (PLAN decisions 1, 2 and 8): the sidebar on the page, its launcher and its header. Drafts for the
  // owner's review. ──
  sidebar: {
    region: 'TailorIT Autofill',
    open: 'Open TailorIT Autofill',
    minimise: 'Minimize',
    workdayNote: 'Please stay on this page while Autofill fills the form.',
    closeNote: 'Close',
  },
  dismiss: 'Dismiss',
  // ── v4 run (D10): the branded toasts on the page (content/ui/toasts.ts). Drafts for the owner's review. ──
  toasts: {
    region: 'TailorIT notifications',
    challenge: 'Solve the check on this page and Autofill carries on.',
    signIn: 'Sign in or create an account on this page, or use Sign Up & Autofill in the TailorIT panel.',
    signInFailed: "Your saved job-site sign-in didn't work here. Sign in or create an account on this page, and Autofill carries on.",
    // jr6: the job-site password is saved in this browser's Sign-up Information; the jr6 review (R5): then pressed. The jr6
    // integration fixes (DOC-11): never "again", since Sign-in Auto shows it too, where the person never chose the button.
    noSignIn: 'Save a job-site password in TailorIT Autofill › Settings › Sign-up Information, then choose Sign Up & Autofill.',
    signInTyped: 'Your job-site email and password are filled in. Press the page\'s Sign In or Create Account, and Autofill carries on.',
    // ── jr6 SHELL-A (FIXPLAN §6.12 items 1, 4 and 5; APPLYPLAN G, BUILD D-d). Our own words, drafts for the owner's
    // review (password-docs.md owner question 7). ──
    // Item 1: the saved password was not typed, as the site's own rules refuse it; the rule, never the password.
    passwordRule: (rule: 'length' | 'upper' | 'lower' | 'digit' | 'special' | 'alpha' | 'login', minLength = 0) =>
      `Your saved job-site password doesn't meet this site's rules: ${rule === 'length' ? `it needs at least ${minLength} characters`
        : rule === 'login' ? "it can't be the same as your email" : `it needs ${{ upper: 'an uppercase letter',
          lower: 'a lowercase letter', digit: 'a number', special: 'a special character', alpha: 'a letter' }[rule]}`
      }. Autofill typed nothing. Save one that fits in Sign-up Information, or create the account here yourself.`,
    // Item 4: the kind of account error the site shows (on arrival, or after its button was pressed). The jr6
    // integration fixes (DOC-12, owner question 436): Sign-up Information keeps one password for every job site (owner
    // question 384), so a reset or a refused password says so before it points there.
    account: {
      'verify-email': 'This site wants you to confirm your email first. Open the message it sent you, then sign in here, and Autofill carries on.',
      'reset-password': "This site asks for a new password: set one with the page's Forgot password. Sign-up Information keeps one password for every job site, so change it there only if the new one is for all of them.",
      'wrong-credentials': "This site didn't accept your saved email and password. If you made an account here before with another password, sign in with it, or reset it here to the one in Sign-up Information, which Autofill uses on every job site.",
    },
    // Item 5 (WD-04): no password saved yet; the run waits for one, then tries the page again by itself.
    noSignInWaiting: 'Save a job-site password in TailorIT Autofill › Settings › Sign-up Information in the next 5 minutes, and Autofill carries on here by itself.',
    // D-d: an email gate (a site that asks for your email first): typed in either Sign-in mode, its Next Auto's alone.
    gateTyped: 'Your email is filled in. Check the page and press its Next; a code the site sends you is yours to enter.',
    gate: 'Enter your email on this page and press its Next, or use Sign Up & Autofill in the TailorIT panel. A code the site sends you is yours to enter.',
    // ── end jr6 SHELL-A ──
    open: 'Open',
    submitHeld: {
      required: 'Submit is on Auto, and a required field is still empty, so the application was not submitted.',
      'no-ai': 'Submit is on Auto, and this posting says AI is not allowed, so the application was not submitted.',
      guess: "Submit is on Auto, and a legal answer is the AI's best guess, so the application was not submitted.",
      attention: 'Submit is on Auto, and a question only you can answer is empty, so the application was not submitted.',
      check: "Submit is on Auto, and the page isn't ready to submit by itself, so the application was not submitted.",
    },
    submitErrors: "The page didn't accept the application: it shows what to fix.",
    validation: "The page shows errors Autofill couldn't fix on this step.",
    // The v4 review (L8): "required fields" only when the count is of the required ones (progressOf's requiredOnly).
    complete: (filled: number, of: number, requiredOnly: boolean) =>
      `Autofill complete · ${filled}/${of} ${requiredOnly ? 'required fields' : 'fields'} filled`,
    // v5 p2-fill review (security 4): the page's alerts and confirms the run's writes held back, as counts only (never
    // the page's words). Drafts for the owner's review.
    dialogs: (alerts: number, confirms: number) => {
      const many = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
      const what = [alerts > 0 ? `showed ${many(alerts, 'message')}` : '',
        confirms > 0 ? `asked ${many(confirms, 'question')}` : ''].filter((part) => part !== '').join(' and ');
      const did = [alerts > 0 ? (alerts === 1 ? 'closed it' : 'closed them') : '',
        confirms > 0 ? 'answered Cancel' : ''].filter((part) => part !== '').join(' and ');
      return `The page ${what} while Autofill filled it. Autofill ${did}; check the page.`;
    },
    // end v5 p2-fill review
  },
  /** The review's marks of a field the AI wrote, and of one it answered with nothing to go on (the owner's
   *  amendments): its chips beside the row's status. */
  aiChip: 'AI',
  aiGuessChip: 'AI guess',
  /** The button in a text box that asks the AI to rewrite what it holds (its accessible name), and its state while the
   *  rewrite is on its way. */
  // v5 p1-panel: Title Case, and Jobright's word while it works (PLAN decision 7).
  editWithAi: 'Edit With AI',
  editingWithAi: 'Generating…',
  /** v3 Phase 3b: Edit with AI's instruction box, and what came of a rewrite. Drafts for the owner's review. */
  aiEdit: {
    label: 'What should change? (optional)',
    placeholder: 'Tell me what to add, change or improve',
    count: (length: number) => `${length}/750`,
    cancel: 'Cancel',
    generate: 'Generate',
    // v5 p1-panel: the button's red state when a rewrite did not come (Jobright's "click to retry", our words): its
    // visible word, and its name with why; a click opens the box again, which says why too.
    retry: 'Try Again',
    retryLabel: (why: string) => `Edit with AI didn't rewrite this box. ${why} Choose to try again.`,
    // end v5 p1-panel
    outcomes: {
      sensitive: "Not rewritten: questions and instructions about self-identification, work authorization, pay, contact details or consent never go to the AI. Reword it, or write this one yourself.",
      unchanged: 'The AI wrote the same text this box holds already.',
      failed: "It couldn't be rewritten just now. Try again.",
      refused: "This box can't be rewritten now: the page changed, or something on it needs you first.",
      // v5 p2-fill review (security 3): a draft for the owner's review.
      hidden: "Not rewritten: this box holds text you can't see, and that never goes to the AI. Check the box on the page.",
    },
  },
  // ── v5 p1-panel: the page's "Application Submitted!" window after a confirmed submission (PLAN decision 5; content/
  // ui/applied.ts). Drafts for the owner's review. ──
  applied: {
    title: 'Application Submitted!',
    body: 'This job was added to your TailorIT tracker.',
    tracker: 'Go To Application Tracker',
    close: 'Close the Application Submitted window',
  },
  // ── end v5 p1-panel ──
  // ── v1.5 X: the documents' dialogs over the page (PLAN decisions 2 and 3; content/ui/document-dialog.ts), and the
  // panel's own confirm where the page cannot show it. Drafts for the owner's review. ──
  documentDialog: {
    titles: { resume: 'Your Resume', coverLetter: 'Your Cover Letter' },
    tabs: { resume: 'Résumé', coverLetter: 'Cover Letter' },
    tabsLabel: 'Documents',
    frames: { resume: 'Your resume, as a PDF', coverLetter: 'Your cover letter, as a PDF' },
    openTab: 'Open In A New Tab',
    close: 'Close',
    editTitle: 'Edit An Uploaded Resume',
    editText: "Editing an uploaded resume needs an editable copy. TailorIT's AI reads your file to make it, which can take a little while. Continue?",
    dontShow: "Don't show this again",
    continue: 'Continue',
    cancel: 'Cancel',
  },
  // ── end v1.5 X ──
  // v5 p1-panel: the reason, status, provenance and stage words moved to COPY (below): no page UI draws them since v4
  // (D1), and the content script's bundle stays within its budget with the v5 sheet and the applied window in it.
  runStatuses: RUN_STATUSES,
  pauseReasons: PAUSE_REASONS,
  platforms: PLATFORM_NAMES,
  report: REPORT,
  panel: PANEL,
  inPage: IN_PAGE,
} as const;

// ── v4 ui: the side panel in Jobright's layout (the owner, 2026-11-07): the set-up view, the main view's new parts,
// the Settings view and the tooltips. Only the extension's pages show them, so they stay out of PAGE_COPY (the content
// script's bundle). Drafts for the owner's review. ──

/** "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
}

/** The "?" buttons (HelpTip): what each explains, as its accessible name. */
const HELP = {
  about: (topic: string) => `About ${topic}`,
} as const;

/** What a complete profile holds, for the set-up view's second step (src/ui/panel/profile-check.ts PROFILE_GAPS). */
const PROFILE_GAP_WORDS = {
  first: 'your first name',
  last: 'your last name',
  email: 'an email',
  phone: 'a phone number',
  place: 'a city or a country',
} as const;

/** The set-up view (Setup.tsx): shown while the extension is not connected, or the profile is not complete. */
const SETUP = {
  heading: 'Autofill With TailorIT', // v5 p1-panel
  intro: 'Complete your setup to start autofilling applications in one click.',
  steps: 'Setup steps',
  account: 'Set Up Your TailorIT Account', // v5 p1-panel
  accountHelp: 'Opens TailorIT, where you sign in, or sign up if you are new, and connect this browser. Your autofill information and resumes come from there.',
  /** Why step 1 shows GO again (its tooltip), after the general help. */
  accountExpired: 'Your connection expired: connections last 90 days. Choose GO to connect again.',
  accountRevoked: "TailorIT stopped accepting this browser's connection. Choose GO to connect again.",
  accountDone: (name: string | null) => (name === null ? 'This browser is connected to TailorIT.'
    : `This browser is connected to TailorIT as ${name}.`),
  profile: 'Complete Your Profile Details', // v5 p1-panel
  profileHelp: 'Autofill needs your first and last name, an email, a phone number, and a city or a country. Add them here; they are saved to your TailorIT.',
  profileMissing: (items: readonly string[]) => `Still missing: ${listed(items)}.`,
  gaps: PROFILE_GAP_WORDS,
  profileDone: 'Your autofill information has what Autofill needs.',
  // v4 review (fix B): step 2's "?" when the profile could not be read; Start applying stays open.
  profileUnreadable: "TailorIT couldn't read your autofill information just now, so it can't say what is missing. You can start applying: Autofill reads it again as it fills.",
  go: 'GO',
  /** The pills' accessible names: the step, then what the pill does or says. */
  goLabel: (step: string) => `${step}: go`,
  doneLabel: (step: string) => `${step}: done`,
  waitingLabel: (step: string) => `${step}: waiting for TailorIT`,
  waiting: 'Waiting…',
  typeCode: 'Have a connect code? Type it in the settings',
  start: 'Start Applying', // v5 p1-panel
  /** Step 1's GO shows what connecting means before it connects (docs/PRIVACY.md "First-run disclosure"). */
  notNow: 'Not Now', // v5 p1-panel
} as const;

/** jr6 apply F1: no application form and no Apply on the page: the entry's refusal 'none' and the "no form" modal.
 *  jr6 apply merge (F2's door): 'none' is also said, before any press, for an Apply that downloads a file, so the words
 *  say no Apply that opens a form, never that the page shows no Apply. The F1 fixer (the line P review, C2): nor that
 *  no Apply opens one (a list of jobs shows several, none Autofill's to choose), nor that Autofill looked (a click that
 *  reached no frame of ours, on a page no frame of ours is on, opens this modal too). */
const NO_FORM = `${NO_FORM_HERE}, and no Apply that Autofill could press. ${OPEN_A_JOB}`;

/** The main view's new parts (Panel.tsx, JobCard.tsx). */
const MAIN_VIEW = {
  settings: 'Settings',
  signUpFill: 'Sign Up & Autofill', // v5 p1-panel
  // The jr6 review (R3, R5): the email and password saved in Sign-up Information; none saved, the "?" says so.
  signUpHelp: 'This site asks you to sign in or create an account first. Sign Up & Autofill does it with your Sign-up Information, then fills the application.',
  signUpNeedsPassword: 'Save a job-site password in Settings › Sign-up Information first.',
  // v5 p1-panel: Title Case buttons.
  ask: 'Ask Custom Question',
  addJob: 'Add This Job In One Click',
  notThisJob: 'Not This Job?', // v5 p1-panel
  // ── jr6 apply F1 (the owner, 2026-11-10: "`Autofill` word will be kept"; APPLYPLAN F1 item 5, OQ10's drafts): on a
  // page whose site offers its own Apply the main button reads Autofill (PANEL.fill); its "?", and why an entry was
  // refused, in one line each (Panel.tsx; 'none' is also the "no form" modal's, MODALS.errors). Drafts for the owner. ──
  entryHelp: "This page shows the job. Autofill presses the site's own Apply first, then fills the application it opens.",
  // The F1 fixer (the line P review, C4): the panel's status for a screen reader while the frame presses or waits.
  entering: "Autofill is pressing the site's Apply.",
  // jr6 SHELL-A (APPLY-MERGE round 2 §8 item 10): the same status while the frame does a wall's sign-in step (its
  // PageState says the wall and `entering`). Our own words, a draft for the owner's review.
  signingIn: "Autofill is filling in the site's sign-in.",
  entryRefused: {
    none: NO_FORM,
    ambiguous: 'This page shows more than one Apply. Press the one you want, then press Autofill on the application.',
    blocked: "Something on the page needs you first, such as a check that you're human or a code. Finish it, then press Autofill.",
    'new-tab': 'This site opens its application in a new tab. Press Apply on the page, then press Autofill in that tab.',
    // jr6 apply merge: said before any press (F2's door: the declared Apply links to another site, nothing pressed) and
    // after one (F3a: the press took the tab to another site), so the words claim no press and no move.
    elsewhere: "This job's Apply leads to another site, where Autofill doesn't go on by itself. Open the application there, then press Autofill if TailorIT supports that site.",
    'nothing-followed': 'Autofill pressed Apply, but no application opened. Press Apply on the page yourself, then press Autofill.',
  } satisfies Record<EntryRefusal, string>,
  // ── end jr6 apply F1 ──
  // jr7 INT-7 (ICIMS-7's item; FIX7PLAN D-6, ICIMS7-11): the 'elsewhere' line on a Jibe job page, whose Apply leads to
  // the job's iCIMS application (the cross-origin press stays refused, OQ4 / Q7-13): it names iCIMS instead of "another
  // site", and claims no press and no move, as entryRefused.elsewhere does.
  elsewhereIcims: "This job's application continues on iCIMS. Press Apply on the page, then press Autofill there.",
  resume: 'Résumé:',
  noResume: 'none',
  withoutResume: 'none, by your choice',
  /** The card's meta line: "2 days ago · Austin, TX". */
  ago: (days: number) => {
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  },
  /** A page Autofill does not work on: its explanations, the "?" beside its heading. */
  unsupportedHelp: `${PANEL.unsupported.embedded} ${PANEL.unsupported.companySites}`,
  /** The cover letter's preview (the résumé's words are COPY.job.preview). */
  letterPreview: {
    loading: 'Loading the cover letter…',
    unavailable: "This cover letter's preview couldn't be shown.",
    title: (label: string) => `Preview of ${label}`,
  },
} as const;

/** The Settings view (SettingsView.tsx): the gear's, in place of the main view. */
const SETTINGS_VIEW = {
  heading: 'Settings',
  close: 'Close the settings',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  notSaved: 'Not saved: the extension did not accept the change. Try again.',
  loading: 'Loading…',
  autofillInfo: 'Autofill Information', // v5 p1-panel
  allSettings: 'All Settings', // v5 p1-panel
  // v1.5 QX (PLAN decision 10): the sections, in the owner's order.
  notConnected: 'Not connected to TailorIT',
  queue: 'Queue Settings',
  autofill: 'Autofill Settings',
  // jr6: Sign-up Information, after Autofill Information (the sidebar on the page shows its state and a link alone).
  signUp: 'Sign-up Information',
  signUpSet: 'A job-site password is saved.',
  signUpNotSet: 'No job-site password saved yet.',
  signUpManage: 'Manage on the settings page',
} as const;
// ── end v4 ui ──

// ── v5 p1-panel: the panel's modals (PLAN decision 6, Jobright's error modals and its resume check in our own words).
// Drafts for the owner's review. ──

/** The parts of the autofill information Autofill checks before it fills (ui/panel/profile-check.ts HISTORY_KINDS). */
const HISTORY_WORDS = { experience: 'work experience', education: 'education' } as const;

/** The modals over the panel's main view (ui/panel/Modals.tsx): what stopped Autofill, and the autofill information's
 *  check. */
const MODALS = {
  /** Why Autofill did not start, by what the worker answered (Jobright's four reasons). */
  errors: {
    'no-form': NO_FORM, // jr6 apply F1
    unavailable: "Autofill can't reach this page's form right now. Reload the page, then try again.",
    failed: "Autofill didn't work this time. Try again in a moment.",
    updated: 'TailorIT Autofill was updated. Refresh this page to use it again.',
  },
  tryAgain: 'Try Again',
  refresh: 'Refresh Page',
  cancel: 'Cancel',
  /** The autofill information has no work experience, or no education (Jobright's resume check). */
  history: {
    text: (missing: ReadonlyArray<keyof typeof HISTORY_WORDS>) =>
      `Your autofill information has no ${listed(missing.map((kind) => HISTORY_WORDS[kind])).replace(' and ', ' or ')}. Add ${missing.length === 1 ? 'it' : 'them'} before you autofill, so applications that ask for ${missing.length === 1 ? 'it' : 'them'} are filled.`,
    edit: 'Edit Autofill Information',
    anyway: 'Autofill Anyway',
  },
} as const;
// ── end v5 p1-panel ──

// ── v1.4 F (PLAN decisions 16-18): tailoring on the job card, the preview page, the templates. Drafts for the owner's
// review. ──

/** The job card's tailoring (ui/panel/tailor.tsx), its Preview and Edit. */
const TAILOR = {
  start: { resume: 'Tailor Resume For This Job', coverLetter: 'Generate Cover Letter' } satisfies Record<TailorKind, string>,
  help: {
    resume: 'TailorIT writes a new resume for this job from the one attached, on the template chosen in your settings, and links it to this job in your tracker. Autofill attaches it from then on.',
    coverLetter: 'TailorIT writes a resume for this job and a cover letter beside it, on the templates chosen in your settings, and links both to this job in your tracker. Autofill attaches them from then on.',
  } satisfies Record<TailorKind, string>,
  /** TailorIT's steps, when it sends no line of its own (TAILOR_STEPS). */
  steps: { waiting: 'Waiting for TailorIT…', analyzing: 'Reading the job…', writing: 'Writing…',
    revising: 'Checking the ATS score…', saving: 'Saving…' },
  working: 'Tailoring…',
  done: (title: string) => `Tailored for this job: ${title}`,
  score: (before: number | null, after: number) => (before === null ? `ATS score ${after}` : `ATS score ${before} → ${after}`),
  letterWritten: 'Its cover letter is ready too.',
  failures: {
    'needs-copy': 'This resume is an upload. Make an editable copy of it in TailorIT first.',
    'rate-limited': 'Too many tailorings for now. Wait a little, then try again.',
    'ai-off': "Nothing was written: AI-written answers are off, or this posting doesn't allow AI.",
    'ai-unavailable': "TailorIT's AI is off right now. Try again later.",
    busy: 'TailorIT is already tailoring two documents. Try again in a minute.',
    'no-job': "TailorIT doesn't know this job yet. Add it, then try again.",
    'not-allowed': "This connection can't use TailorIT's AI. Connect the extension again from TailorIT's Settings › Autofill.",
    'not-connected': 'Connect to TailorIT in the settings first.',
    failed: "TailorIT couldn't tailor it this time. Try again.",
    unavailable: "TailorIT couldn't be reached just now. Try again.",
  } satisfies Record<TailorFailure, string>,
  makeCopy: 'Make An Editable Copy In TailorIT',
  edit: 'Edit',
  editLabel: (what: string) => `Edit ${what} in TailorIT`,
  previewLabel: (what: string) => `Preview ${what} in a full window`,
  nothingToOpen: 'There is nothing to open yet.',
  /** The card's cover-letter line (the form asks for one). */
  letter: { label: 'Cover letter:', yours: 'yours', written: 'written by TailorIT', none: 'none yet', checking: 'checking…',
    tailored: 'written for this job' },
  kinds: { resume: 'the resume', coverLetter: 'the cover letter' } satisfies Record<TailorKind, string>,
} as const;

/** The full-window preview page (preview.html, ui/preview/PreviewPage.tsx). */
const PREVIEW_PAGE = {
  title: 'TailorIT Preview',
  tabs: { resume: 'Résumé', coverLetter: 'Cover Letter' } satisfies Record<TailorKind, string>,
  edit: 'Edit In TailorIT',
  close: 'Close',
  noTab: 'This preview names no tab. Open it again from the panel.',
} as const;

/** The templates a tailored resume and its letter are written on (Options' Documents card, the Settings view, the
 *  profile editor's Documents section: ui/page/documents.tsx). */
const DOCUMENTS = {
  title: 'Documents',
  help: 'The templates TailorIT writes a tailored resume and its cover letter on. They are kept in your TailorIT profile.',
  resumeTemplate: 'Resume template',
  letterTemplate: 'Cover letter template',
  ownTemplate: "Resume's own template",
  noTemplate: 'No template',
  missing: 'A template TailorIT no longer has',
  system: (name: string) => `${name} (TailorIT)`,
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  loading: 'Reading your templates…',
  readOnly: "This connection can't change your templates. Connect the extension again from TailorIT's Settings › Autofill.",
  tryAgain: 'Try Again',
  // v1.5 X (PLAN decision 3): settings version 10's ui.skipUploadEditConfirm, shown the other way round.
  askBeforeUploadEdit: 'Ask before editing an uploaded resume',
  askBeforeUploadEditHelp: "Edit on an uploaded resume opens an editable copy that TailorIT's AI makes from your file. With this on, the extension asks first; \"Don't show this again\" turns it off.",
  refusals: {
    conflict: 'Your profile changed elsewhere meanwhile. Try again.',
    invalid: "TailorIT doesn't have that template any more. Choose another.",
    'not-allowed': "This connection can't read or change your templates. Connect the extension again from TailorIT's Settings › Autofill.",
    'not-connected': 'Connect to TailorIT to choose your templates.',
    'rate-limited': 'Too many changes in a minute. Wait a little, then try again.',
    unavailable: "Your templates couldn't be read just now. Try again.",
  } satisfies Record<ProfileSaveRefusal, string>,
} as const;
// ── end v1.4 F ──

/** Every sentence: the in-page UI's (PAGE_COPY) and those only the options page and the side panel show. */
export const COPY = {
  ...PAGE_COPY,
  fieldKinds: FIELD_KIND_NAMES,
  strip: STRIP,
  job: JOB,
  ask: ASK,
  profile: PROFILE,
  options: OPTIONS,
  agent: AGENT,
  // v4 ui
  help: HELP,
  setup: SETUP,
  mainView: MAIN_VIEW,
  settingsView: SETTINGS_VIEW,
  modals: MODALS, // v5 p1-panel
  queue: QUEUE, // v1.5 QX
  // v1.4 F
  tailor: TAILOR,
  previewPage: PREVIEW_PAGE,
  documents: DOCUMENTS,
  // v5 p1-shell (the review's S6 and S7): what the sidebar on the page leaves to the extension's own pages. Drafts for
  // the owner's review.
  onPage: {
    openSidePanel: "Open Chrome's Side Panel",
    sensitive: "Your self-identification, legal, pay and consent answers are edited in Chrome's side panel, not on the job page.",
    disclosure: "Choose I Understand in Chrome's side panel: the job page's own scripts can see what happens here.",
    raise: "Auto is chosen on the settings page or in Chrome's side panel, not on the job page.",
  },
  // v5 p1-panel: moved from PAGE_COPY (no page UI draws them since v4): one sentence per reason code, and the words of
  // the statuses, the provenances and the matcher's stages (the options page's counters).
  reasons: REASONS,
  statuses: STATUSES,
  provenances: PROVENANCES,
  stages: STAGES,
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
