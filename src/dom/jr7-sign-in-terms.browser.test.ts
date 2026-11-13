/*
 * jr7 ENGINE-7 E0 (FIX7PLAN §3.1; UP7-04, UltiPro's Register privacy box drawn as an ARIA checkbox): SignInForm.terms
 * may hold a declared ARIA checkbox (role="checkbox", no native input) beside native boxes. jr7 ENGINE-7 E1 item 8:
 * dom/sign-in-form.ts signInRefusal takes one inside a declared container (it refused every one at E0), and reads a
 * native terms box as before (src/content/jr7-engine-e1.browser.test.ts holds the rest). A synthetic page of the
 * framework's own markup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SignInForm } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { signInRefusal } from './sign-in-form';

/** A declared account container (no <form>: UltiPro's Register is a container): an email box, an ARIA checkbox and a
 *  native one with their own visible words, and the container's Create account. */
const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  input[type="email"] { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  #create { padding: 6px 12px; border: 1px solid #333; }
</style></head><body><main>
  <div id="register"><h1>Create your account</h1>
    <label for="em">Email</label><input id="em" type="email">
    <p><span id="aria-terms" role="checkbox" aria-checked="false" tabindex="0">I agree to the privacy policy</span></p>
    <p><span id="no-state" role="checkbox" tabindex="0">I agree to the cookie policy</span></p>
    <p><input id="native-terms" type="checkbox"><label for="native-terms">I agree to the terms of use</label></p>
    <button id="create" type="button">Create account</button>
  </div>
</main></body></html>`;

const ADDRESS = new URL('https://recruiting.ultipro.com/ACME1000/JobBoard/00000000-0000-4000-8000-000000000001/Register');

afterEach(() => removeFixtures(document));

describe('a declared ARIA checkbox among the account terms (jr7 ENGINE-7 E0, FIX7PLAN §3.1)', () => {
  it('takes it inside a declared container, refuses one that shows no state, and reads a native terms box as before',
    async () => {
    const { doc } = await loadFixture(document, PAGE, { width: 1100, height: 800 });
    const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
    const form = (terms: SignInForm['terms']): SignInForm => ({ email: byId<HTMLInputElement>('em'), password: null,
      confirm: null, terms, button: byId('create'), container: byId('register'), declared: true });
    expect(signInRefusal(form([]), ADDRESS)).toBeNull();
    expect(signInRefusal(form([byId<HTMLInputElement>('native-terms')]), ADDRESS)).toBeNull();
    expect(signInRefusal(form([byId('aria-terms')]), ADDRESS)).toBeNull();
    expect(signInRefusal(form([byId('no-state')]), ADDRESS)).toBe('shape');
    expect(signInRefusal({ ...form([byId('aria-terms')]), declared: undefined }, ADDRESS)).toBe('shape');
  });
});
