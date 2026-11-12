/*
 * jr6 ifix SEC-1 (the jr6 integration review's SEC-1): the page's own password rules as signin/credential carries them
 * (schemas.ts SignInRulesSchema). The frame reads them before it asks (content/sign-in.ts): on an account's creation
 * what the adapter reads of the page's rules (Adapter.passwordRules: its minimum, its required classes, "not the
 * login"), and on a sign-in or an account's creation the smallest maxlength of its password boxes. The worker checks the
 * saved password against them before it marks a press or decrypts anything (background/signup-vault.ts reveal), so a
 * password they refuse never leaves the worker, and the tab's press is not used up by an ask that typed nothing.
 * Numbers and closed words alone, never a value. What the adapter gives is read as the frame's own check reads it
 * (content/sign-in.ts brokenRule: fail open, a hook that throws or a shape it does not know is no rule), and held to the
 * schema's bounds, so an odd page never gets the ask itself refused: a number over the password's cap is sent as the
 * cap, which every saved password (at most 64 characters) meets or misses alike.
 */
import { AUTOFILL_SIGN_IN_LIMITS } from '../contract/tailorit/credentials';
import { SIGN_IN_PASSWORD_CLASSES, type SignInPasswordClass, type SignInRules, type SignInWall } from './schemas';

/** A password box as far as its rules go: its own maxlength (the DOM's -1 where none is set). */
interface PasswordBox {
  readonly maxLength: number;
}

/** The form the frame asks for, as far as its rules go (adapters/types.ts SignInForm). */
interface RuledForm {
  readonly password: PasswordBox | null;
  readonly confirm: PasswordBox | null;
}

/** A whole number of 1 or more, held to the password's cap; null for anything else. */
function bounded(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, AUTOFILL_SIGN_IN_LIMITS.password) : null;
}

const isClass = (value: unknown): value is SignInPasswordClass =>
  typeof value === 'string' && (SIGN_IN_PASSWORD_CLASSES as readonly string[]).includes(value);

/**
 * The rules the ask for `wall` carries, or null where the page states none (module header). `adapter.passwordRules` is
 * read on an account's creation alone, as the frame's own check reads it; an email gate asks for no password and gets
 * none.
 */
export function signInRulesOf<F extends RuledForm>(wall: SignInWall, form: F,
  adapter: { passwordRules?(form: F): unknown }): SignInRules | null {
  if (wall === 'email-gate') return null;
  let page: unknown = null;
  if (wall === 'create-account') {
    try {
      page = adapter.passwordRules?.(form) ?? null;
    } catch {
      page = null;
    }
  }
  const rules: { minLength?: number; requires?: SignInPasswordClass[]; notLogin?: true; maxLength?: number } = {};
  if (page !== null && typeof page === 'object') {
    const { minLength, requires, notLogin } = page as Record<string, unknown>;
    const least = bounded(minLength);
    if (least !== null) rules.minLength = least;
    // The page's own order, each class once (the first one the saved password misses is the one said).
    const classes = Array.isArray(requires) ? [...new Set(requires.filter(isClass))] : [];
    if (classes.length > 0) rules.requires = classes;
    if (notLogin === true) rules.notLogin = true;
  }
  const most = [form.password, form.confirm].map((box) => (box === null ? null : bounded(box.maxLength)))
    .filter((max): max is number => max !== null);
  if (most.length > 0) rules.maxLength = Math.min(...most);
  return Object.keys(rules).length === 0 ? null : rules;
}
