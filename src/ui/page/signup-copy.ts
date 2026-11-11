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
  help: "The email and password TailorIT Autofill types into job sites' own sign-in and create-account forms (Workday, iCIMS and others). They stay in this browser and are never sent to TailorIT. The password is encrypted: other extensions, exports, sync and the job sites' pages can't read it, but someone who can open this browser's files on this computer could. So use a password you keep for job sites alone, such as a generated one. Once saved, the password is not shown here again: note it somewhere safe, or let your browser save it when you sign in.",
  email: 'Job-site email',
  password: 'Job-site password',
  passwordSaved: 'Saved. Type a new one to replace it',
  show: 'Show',
  hide: 'Hide',
  showLabel: 'Show the password you typed',
  hideLabel: 'Hide the password',
  generate: 'Generate strong password',
  generated: 'A new password was made. Note it somewhere safe, then Save.',
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
  notShownAgain: 'Once saved, the password is not shown here again: note it somewhere safe first.',
  remove: 'Delete password',
  removeConfirm: 'Delete the saved password? Accounts you made with it will need "Forgot password" to sign in again.',
  removeYes: 'Delete',
  removeNo: 'Keep it',
  importOffer: 'If you saved a job-site sign-in for every site in TailorIT (Settings › Autofill), copy it into this browser once:',
  importButton: 'Import from TailorIT',
  setOn: (when: string) => `A password is saved in this browser (${when}).`,
  notSet: 'No password is saved yet. Sign-in Auto needs one.',
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
    gone: 'Your saved password could no longer be read in this browser and was removed. Save a new one here: Sign-in Auto needs one.',
    reverted: 'Sign-in is back on Manual: Auto needs a job-site password saved here (or Import from TailorIT).',
  } satisfies Record<SignupNotice, string>,
} as const;
