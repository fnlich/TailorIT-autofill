/*
 * jr6 ifix SEC-1 (the jr6 integration review's SEC-1): the page's own password rules as signin/credential carries them
 * (sign-in-rules.ts signInRulesOf): read on an account's creation alone, as the frame's own check reads them (fail open),
 * the boxes' smallest maxlength on a sign-in too, nothing at an email gate; numbers and closed words alone, held to the
 * schema's bounds, so what is built always parses.
 */
import { describe, expect, it, vi } from 'vitest';
import { AUTOFILL_SIGN_IN_LIMITS } from '../contract/tailorit/credentials';
import { ContentMessageSchema, SignInRulesSchema } from './schemas';
import { signInRulesOf } from './sign-in-rules';

/** A form's password boxes as far as the rules go (the DOM's -1: no maxlength set). */
const form = (password: number | null = -1, confirm: number | null = -1) => ({
  password: password === null ? null : { maxLength: password },
  confirm: confirm === null ? null : { maxLength: confirm },
});
const reading = (rules: unknown) => ({ passwordRules: vi.fn(() => rules) });

describe('the page’s own password rules for the ask (jr6 ifix SEC-1)', () => {
  it('reads the page’s rules on an account’s creation, with its boxes’ smallest maxlength', () => {
    const adapter = reading({ minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'], notLogin: true });
    expect(signInRulesOf('create-account', form(128, 60), adapter)).toEqual({ minLength: 8,
      requires: ['upper', 'lower', 'digit', 'special', 'alpha'], notLogin: true, maxLength: 60 });
  });

  it('on a sign-in reads the boxes alone, never the page’s rules; at an email gate nothing', () => {
    const adapter = reading({ minLength: 8 });
    expect(signInRulesOf('sign-in', form(60, null), adapter)).toEqual({ maxLength: 60 });
    expect(signInRulesOf('sign-in', form(), adapter)).toBeNull();
    expect(signInRulesOf('email-gate', form(60, 60), adapter)).toBeNull();
    expect(adapter.passwordRules).not.toHaveBeenCalled();
  });

  it('fails open as the frame’s own check does: no hook, a hook that throws, none read, a shape it does not know', () => {
    expect(signInRulesOf('create-account', form(), {})).toBeNull();
    expect(signInRulesOf('create-account', form(), { passwordRules: () => {
      throw new Error('unreadable');
    } })).toBeNull();
    for (const odd of [null, 'eight', 8, [], { minLength: '8' }, { minLength: 0 }, { minLength: 7.5 },
      { minLength: Number.NaN }, { requires: 'upper' }, { requires: ['symbol', 3] }, { notLogin: 'yes' }]) {
      expect(signInRulesOf('create-account', form(), reading(odd)), JSON.stringify(odd)).toBeNull();
    }
    // A box with no maxlength (-1), or 0, sets none.
    expect(signInRulesOf('create-account', form(0, -1), reading(null))).toBeNull();
  });

  it('keeps the page’s order of classes, each once, and holds the numbers to the password’s cap', () => {
    const cap = AUTOFILL_SIGN_IN_LIMITS.password;
    expect(signInRulesOf('create-account', form(524_288, null),
      reading({ minLength: 1_000, requires: ['alpha', 'symbol', 'upper', 'alpha'] })))
      .toEqual({ minLength: cap, requires: ['alpha', 'upper'], maxLength: cap });
  });

  it('builds only what the ask’s schema takes', () => {
    const cases = [
      signInRulesOf('create-account', form(128, 128), reading({ minLength: 10, requires: ['alpha', 'lower', 'upper',
        'digit', 'special'], notLogin: true })),
      signInRulesOf('create-account', form(Number.MAX_SAFE_INTEGER, 1), reading({ minLength: Number.MAX_SAFE_INTEGER })),
      signInRulesOf('sign-in', form(60, null), reading(null)),
    ];
    for (const rules of cases) {
      expect(SignInRulesSchema.safeParse(rules).success, JSON.stringify(rules)).toBe(true);
      expect(ContentMessageSchema.safeParse({ v: 1, type: 'signin/credential', wall: 'create-account', rules }).success)
        .toBe(true);
    }
    // The schema refuses anything else: a value, an unknown class, a number past the cap.
    for (const bad of [{ password: 'x' }, { requires: ['symbol'] }, { minLength: 257 }, { maxLength: 0 }, { requires: [] }]) {
      expect(ContentMessageSchema.safeParse({ v: 1, type: 'signin/credential', wall: 'sign-in', rules: bad }).success,
        JSON.stringify(bad)).toBe(false);
    }
  });
});
