/*
 * Every sentence the extension shows a person, in one place, so wording stays consistent and reviewable. It lives in
 * shared because the in-page UI (content), the side panel and the options page all show the same sentences. The
 * tripwire, policy and couldn't-read notices are the plan's exact words; the other notices are drafts for the owner's
 * review. The reason sentence for each code arrives with the review panel.
 */
import type { FrameReport } from './report';

/** A report notice's code. */
type NoticeCode = FrameReport['notices'][number]['code'];

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
} as const satisfies Record<NoticeCode, string>;

export const COPY = {
  appName: 'TailorIT Autofill',
  panelTitle: 'Review',
  panelEmpty: 'Nothing to review yet. Open a job application and choose Fill.',
  optionsTitle: 'TailorIT Autofill settings',
  optionsSoon: 'Connecting to TailorIT and the filling settings arrive in the next phases.',
  tripwire: NOTICES.tripwire,
  notices: NOTICES,
  /** The policy card's two buttons (in the page and in the side panel). */
  policyFillAnyway: 'Fill anyway',
  policyCancel: 'Cancel',
} as const;
