/*
 * jr6: Settings › Sign-up Information's words (ui/page/signup.tsx). Kept apart from shared/copy.ts's COPY, which the
 * sidebar on the page carries whole: this card is drawn on the extension's own pages alone (the options page and
 * Chrome's side panel), so the sidebar's bundle, at its budget, never holds its words. Drafts for the owner's review.
 */
import { SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_MIN, type SignupPasswordRule } from '../../core/signup-password';

export const SIGNUP_COPY = {
  heading: 'Sign-up Information',
  help: "The email and password TailorIT Autofill types into job sites' own sign-in and create-account forms (Workday, iCIMS and others). They stay in this browser, the password encrypted, and are never sent to TailorIT. Once saved, the password is not shown here again: note it somewhere safe, or let your browser save it when you sign in.",
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
  remove: 'Delete password',
  removeConfirm: 'Delete the saved password? Accounts you made with it will need "Forgot password" to sign in again.',
  removeYes: 'Delete',
  removeNo: 'Keep it',
  importOffer: "TailorIT keeps a job-site sign-in for every site (Settings › Autofill). Copy it into this browser once:",
  importButton: 'Import from TailorIT',
  setOn: (when: string) => `A password is saved in this browser (${when}).`,
  notSet: 'No password is saved yet. Sign-in Auto needs one.',
  saved: 'Saved in this browser.',
  notSaved: 'Not saved. Check the email and the rules, then try again.',
  removed: 'Deleted.',
  reverted: 'Deleted. Sign-in is back on Manual: Auto needs a saved password.',
  imported: 'Imported from TailorIT and saved in this browser.',
  importNone: 'TailorIT holds no job-site sign-in for every site.',
  importWeak: "The password saved in TailorIT doesn't meet these rules. Generate a new one here, and change it on the job sites where you use it.",
  importFailed: "TailorIT couldn't be reached. Try again in a moment.",
  unreadable: "Sign-up Information couldn't be read. Reload this page.",
} as const;
