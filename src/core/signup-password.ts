/*
 * The job-site password's rules (jr6, the owner's words of 2026-11-10: "password should be stronger (16 letter above,
 * include special, and uppercase letter so that can pass on myworkday)"). The person keeps one password for the job
 * sites' own accounts in Settings › Sign-up Information (background/signup-vault.ts keeps it, encrypted, in this browser);
 * it must pass every rule below to be saved, and "Generate strong password" makes one that does.
 * - 16 to 64 characters;
 * - at least one uppercase letter, one lowercase letter, one digit and one special character;
 * - only ASCII letters, digits and the specials ! @ # $ % ^ & * ( ) - _ = + ? (no space, quote, backslash, < or >, which
 *   some applicant-tracking sites refuse or escape).
 * Workday's create-account page lists its tenant's own rules ("A minimum of 8 characters", "An uppercase character", "A
 * lowercase character", "A numeric character", "A special character", "An alphabetic character":
 * fixtures/workday/workday-create-account.html, salesforce-create-account.html, s2-verily-create-account.html); every
 * password these rules take passes them.
 * Jobright 1.25.2 (read for behaviour only: its ~utils/workday-signup-password, validateWorkdayPassword) asks for at
 * least 12 characters, an uppercase and a lowercase letter, a number and a special character from a wider set (any
 * ASCII punctuation, quotes and backslash included). Ours is stricter on both counts: four more characters, a 64 cap, and
 * the narrower set of specials, so a password typed into any of the sites never meets a character the site refuses.
 * Pure: the generator's randomness is passed in (the extension pages pass crypto.getRandomValues).
 */

/** The fewest characters a saved password has. */
export const SIGNUP_PASSWORD_MIN = 16;
/** The most characters a saved password has. */
export const SIGNUP_PASSWORD_MAX = 64;
/** How long "Generate strong password" makes one. */
export const SIGNUP_PASSWORD_GENERATED = 20;
/** The special characters a password may hold (and must hold one of). */
export const SIGNUP_SPECIALS = '!@#$%^&*()-_=+?';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
/** Every character a password may hold. */
const ALPHABET = `${UPPER}${LOWER}${DIGITS}${SIGNUP_SPECIALS}`;

/** The rules, in the order the settings' checklist shows them. */
export const SIGNUP_PASSWORD_RULES = ['length', 'upper', 'lower', 'digit', 'special', 'allowed'] as const;
export type SignupPasswordRule = (typeof SIGNUP_PASSWORD_RULES)[number];

/** Which rules `password` meets (the checklist). An empty password meets none but `allowed`. */
export function signupPasswordChecks(password: string): Record<SignupPasswordRule, boolean> {
  const chars = Array.from(password);
  const has = (set: string) => chars.some((char) => set.includes(char));
  return {
    length: chars.length >= SIGNUP_PASSWORD_MIN && chars.length <= SIGNUP_PASSWORD_MAX,
    upper: has(UPPER),
    lower: has(LOWER),
    digit: has(DIGITS),
    special: has(SIGNUP_SPECIALS),
    allowed: chars.every((char) => ALPHABET.includes(char)),
  };
}

/** Whether `password` meets every rule. */
export function signupPasswordValid(password: string): boolean {
  const checks = signupPasswordChecks(password);
  return SIGNUP_PASSWORD_RULES.every((rule) => checks[rule]);
}

/** Random bytes, `count` of them (crypto.getRandomValues on the extension's pages). */
export type RandomBytes = (count: number) => Uint8Array;

/** A uniform index below `size` (at most 256), from `random`'s bytes by rejection: a byte at or past the largest
 *  multiple of `size` is drawn again, so no index is likelier than another. */
function indexBelow(size: number, random: RandomBytes): number {
  const limit = 256 - (256 % size);
  for (;;) {
    const bytes = random(16);
    for (const byte of bytes) if (byte < limit) return byte % size;
  }
}

/** A character of `set`, uniformly. */
const pick = (set: string, random: RandomBytes) => set.charAt(indexBelow(set.length, random));

/**
 * "Generate strong password" (module header): SIGNUP_PASSWORD_GENERATED characters, one of each required kind placed
 * at a random position and the rest drawn uniformly from every allowed character, so each password meets every rule.
 */
export function generateSignupPassword(random: RandomBytes, length = SIGNUP_PASSWORD_GENERATED): string {
  const size = Math.min(SIGNUP_PASSWORD_MAX, Math.max(SIGNUP_PASSWORD_MIN, Math.floor(length)));
  const chars = [pick(UPPER, random), pick(LOWER, random), pick(DIGITS, random), pick(SIGNUP_SPECIALS, random)];
  while (chars.length < size) chars.push(pick(ALPHABET, random));
  // Fisher-Yates, so the required kinds sit anywhere.
  for (let at = chars.length - 1; at > 0; at -= 1) {
    const other = indexBelow(at + 1, random);
    [chars[at], chars[other]] = [chars[other]!, chars[at]!];
  }
  return chars.join('');
}
