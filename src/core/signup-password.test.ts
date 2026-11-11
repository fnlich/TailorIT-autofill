/*
 * jr6: the job-site password's rules and its generator (signup-password.ts): each rule on its own, the edges of the
 * length, the characters refused, and a property test of "Generate strong password": a thousand passwords made with
 * the browser's own randomness all meet every rule, at the length asked, and do not repeat.
 */
import { describe, expect, it } from 'vitest';
import {
  generateSignupPassword, SIGNUP_PASSWORD_GENERATED, SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_MIN, SIGNUP_PASSWORD_RULES,
  SIGNUP_SPECIALS, signupPasswordChecks, signupPasswordValid,
} from './signup-password';

const random = (count: number) => globalThis.crypto.getRandomValues(new Uint8Array(count));

describe('the job-site password rules', () => {
  it('takes a password of 16 to 64 characters with an uppercase, a lowercase, a digit and a special', () => {
    for (const password of ['Abcdefghijklm1!x', 'Q7#wR2$eT9^yU4&iO0*pA5(sD8)fG3-hJ6_kL1=zX4+cV7?bN2Mq'.slice(0, 64),
      'aaaaaaaaaaaaaaA1-', `${'a'.repeat(60)}B2!c`]) {
      expect(signupPasswordValid(password), password).toBe(true);
    }
  });

  it('names each rule a password misses', () => {
    expect(signupPasswordChecks('')).toEqual({ length: false, upper: false, lower: false, digit: false, special: false,
      allowed: true });
    expect(signupPasswordChecks('Short1!a')).toMatchObject({ length: false, upper: true, lower: true, digit: true,
      special: true, allowed: true });
    expect(signupPasswordChecks('alllowercase1234!')).toMatchObject({ upper: false });
    expect(signupPasswordChecks('ALLUPPERCASE1234!')).toMatchObject({ lower: false });
    expect(signupPasswordChecks('NoDigitsInHere!!x')).toMatchObject({ digit: false });
    expect(signupPasswordChecks('NoSpecials12345ab')).toMatchObject({ special: false });
  });

  it('holds the length to 16..64 characters exactly', () => {
    const at = (length: number) => `Aa1!${'b'.repeat(length - 4)}`;
    expect(signupPasswordValid(at(SIGNUP_PASSWORD_MIN - 1))).toBe(false);
    expect(signupPasswordValid(at(SIGNUP_PASSWORD_MIN))).toBe(true);
    expect(signupPasswordValid(at(SIGNUP_PASSWORD_MAX))).toBe(true);
    expect(signupPasswordValid(at(SIGNUP_PASSWORD_MAX + 1))).toBe(false);
  });

  it('refuses a space, a quote, a backslash, < and >, and anything outside ASCII letters, digits and the specials', () => {
    for (const bad of [' ', '"', "'", '`', '\\', '<', '>', '/', '.', ',', ';', ':', '[', ']', '{', '}', '|', '~', 'é',
      'ü', '\t', '\n']) {
      const password = `Abcdefgh12345!x${bad}`;
      expect(signupPasswordChecks(password).allowed, JSON.stringify(bad)).toBe(false);
      expect(signupPasswordValid(password), JSON.stringify(bad)).toBe(false);
    }
    for (const special of SIGNUP_SPECIALS) {
      expect(signupPasswordValid(`Abcdefgh12345x${special}y`), special).toBe(true);
    }
  });
});

describe('"Generate strong password"', () => {
  it('makes 1,000 passwords that all meet every rule, at 20 characters, none twice', () => {
    const seen = new Set<string>();
    for (let run = 0; run < 1_000; run += 1) {
      const password = generateSignupPassword(random);
      expect(password).toHaveLength(SIGNUP_PASSWORD_GENERATED);
      const checks = signupPasswordChecks(password);
      for (const rule of SIGNUP_PASSWORD_RULES) expect(checks[rule], `${rule} in run ${run}`).toBe(true);
      // The jr6 review (R14): a special any site counts (a site that finds one with \W never counts `_`).
      expect(/[^A-Za-z0-9_]/.test(password), `a special but _ in run ${run}`).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(1_000);
  });

  it('never makes `_` its one required special (the jr6 review, R14)', () => {
    // Bytes that pick the first uppercase, lowercase and digit, then index 11 of the required special's draw (`_` in
    // SIGNUP_SPECIALS), then letters alone: `_` would be the password's only special.
    let call = 0;
    const steered = (count: number) => {
      call += 1;
      return Uint8Array.from({ length: count }, () => (call === 4 ? 11 : 0));
    };
    const password = generateSignupPassword(steered);
    expect(signupPasswordValid(password)).toBe(true);
    expect(password).not.toContain('_');
    expect(/[^A-Za-z0-9_]/.test(password)).toBe(true);
  });

  it('draws every allowed character, and places the required kinds anywhere', () => {
    const counts = new Map<string, number>();
    const firsts = new Set<string>();
    for (let run = 0; run < 2_000; run += 1) {
      const password = generateSignupPassword(random);
      firsts.add(/[A-Z]/.test(password[0]!) ? 'upper' : /[a-z]/.test(password[0]!) ? 'lower'
        : /\d/.test(password[0]!) ? 'digit' : 'special');
      for (const char of password) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    // 26 + 26 + 10 + 15 characters, every one of them drawn over 40,000.
    expect(counts.size).toBe(77);
    expect(firsts).toEqual(new Set(['upper', 'lower', 'digit', 'special']));
  });

  it('keeps an asked length within 16..64', () => {
    expect(generateSignupPassword(random, 8)).toHaveLength(SIGNUP_PASSWORD_MIN);
    expect(generateSignupPassword(random, 32)).toHaveLength(32);
    expect(generateSignupPassword(random, 500)).toHaveLength(SIGNUP_PASSWORD_MAX);
    expect(signupPasswordValid(generateSignupPassword(random, 8))).toBe(true);
  });

  it('uses only the bytes it is given: the same bytes make the same password', () => {
    const fixed = () => {
      let next = 0;
      return (count: number) => Uint8Array.from({ length: count }, () => {
        next = (next * 73 + 41) % 251;
        return next;
      });
    };
    expect(generateSignupPassword(fixed())).toBe(generateSignupPassword(fixed()));
    expect(signupPasswordValid(generateSignupPassword(fixed()))).toBe(true);
  });
});
