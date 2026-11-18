/*
 * jr6: Settings › Sign-up Information's words (ui/page/signup.tsx). Kept apart from shared/copy.ts's COPY, which the
 * sidebar on the page carries whole: this card is drawn on the extension's own pages alone (the options page and
 * Chrome's side panel), so the sidebar's bundle, at its budget, never holds its words. Drafts for the owner's review.
 * The jr6 review: what the encryption keeps the password from, and what it does not (sec-7); that a saved password is
 * not shown again, said beside Save (R6); the import offered only for a sign-in TailorIT keeps for every site (R10);
 * what the worker did by itself (R12).
 */
import type { SignupNotice } from '../../messaging/schemas';
import { SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_MIN, type SignupPasswordRule } from '../../core/signup-password';

export const SIGNUP_COPY = {
  heading: 'Sign-up Information',
  // v3.2 EXT (E5): one sentence; what the encryption does not keep it from (the jr6 review's sec-7) stays in its words.
  help: "Typed into job sites' sign-in forms; kept encrypted in this browser only, but readable from its files, so use a job-sites-only password.",
  email: 'Job-site email',
  password: 'Job-site password',
  passwordSaved: 'Saved. Type a new one to replace it',
  show: 'Show',
  hide: 'Hide',
  showLabel: 'Show the password you typed',
  hideLabel: 'Hide the password',
  generate: 'Generate strong password',
  generated: 'New password made: note it somewhere safe, then Save.',
  rulesHeading: 'The password needs',
  rules: {
    length: `${SIGNUP_PASSWORD_MIN} to ${SIGNUP_PASSWORD_MAX} characters`,
    upper: 'An uppercase letter',
    lower: 'A lowercase letter',
    digit: 'A number',
    special: 'A special character: ! @ # $ % ^ & * ( ) - _ = + ?',
    allowed: 'No spaces, quotes or other symbols',
  } satisfies Record<SignupPasswordRule, string>,
  met: 'done',
  unmet: 'not yet',
  save: 'Save',
  saving: 'Saving…',
  /** The jr6 review (R6): said beside Save, not only in the card's "?". */
  notShownAgain: 'Not shown again once saved: note it first.',
  remove: 'Delete password',
  removeConfirm: 'Delete the saved password? Accounts you made with it will need "Forgot password" to sign in again.',
  removeYes: 'Delete',
  removeNo: 'Keep it',
  // v3.2 EXT (E5): the Import button's "?" (it was a line before it).
  importOffer: "Copies the job-site sign-in you saved for every site in TailorIT's Settings › Autofill into this browser, once.",
  importButton: 'Import from TailorIT',
  setOn: (when: string) => `A password is saved in this browser (${when}).`,
  notSet: 'No password saved yet; Sign-in Auto needs one.',
  saved: 'Saved in this browser.',
  notSaved: 'Not saved. Check the email and the rules, then try again.',
  removed: 'Deleted.',
  reverted: 'Deleted. Sign-in is back on Manual: Auto needs a saved password.',
  imported: 'Imported from TailorIT and saved in this browser.',
  importNone: "TailorIT holds no job-site sign-in for every site (sign-ins saved for one site aren't imported).",
  importWeak: "The password saved in TailorIT doesn't meet these rules. Generate a new one here, and change it on the job sites where you use it.",
  importFailed: "TailorIT couldn't be reached. Try again in a moment.",
  unreadable: "Sign-up Information couldn't be read. Reload this page.",
  /** The jr6 review (R12): what the worker did by itself, said until the person next saves, imports or deletes one. */
  notices: {
    gone: 'Your saved password could no longer be read here and was removed. Save a new one.',
    reverted: 'Sign-in is back on Manual: Auto needs a job-site password saved here.',
  } satisfies Record<SignupNotice, string>,
} as const;
