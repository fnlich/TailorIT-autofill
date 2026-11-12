/*
 * jr7 ENGINE-7 E1 (FIX7PLAN §6.2), the content half: item 8 (UP7-04, as its verifier corrected it). A declared sign-in
 * container's account term may be a declared ARIA checkbox (UltiPro's Register privacy box, a ukg-checkbox[role=checkbox]
 * with no native input, snapshot7 ultipro1): signInRefusal takes it inside the container, Sign-in Auto clicks it while
 * it says aria-checked="false" (in container mode, an email gate, only where the page marks it required: any other is
 * the run's plan's, per the Consents mode) and reads "true" back before the press. A synthetic page of the framework's
 * own markup; every value synthetic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { signInContainerOf, signInRefusal } from '../dom/sign-in-form';
import { signIn, type SignInContext } from './sign-in';

afterEach(() => removeFixtures(document));

const HOST = 'acme.wd5.myworkdayjobs.com';
const HREF = `https://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually`;

/** A Register step the run fills like a step: names in div#register, the privacy box an ARIA checkbox (`required`:
 *  aria-required="true"; `inert`: a click changes nothing, and Create account is enabled from the start), drawn a
 *  moment after its click as a custom element draws its state, and Create account, enabled once the box is ticked,
 *  which replaces the step when pressed. */
function registerPage(options: { required?: boolean; inert?: boolean; outside?: boolean } = {}): string {
  const box = `<span id="privacy" role="checkbox" aria-checked="false" tabindex="0"
    ${options.required === false ? '' : 'aria-required="true"'}
    style="display:inline-block;padding:4px;border:1px solid #333">I have read and agree to the Privacy Policy</span>`;
  return `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
    #create { padding: 6px 12px; border: 1px solid #333; }
  </style></head><body><main>
  <div id="register"><h1>Create your account</h1>
    <label for="first">First name</label><input id="first" type="text">
    ${options.outside === true ? '' : box}
    <button id="create" type="button" ${options.inert === true ? '' : 'disabled'}>Create account</button>
  </div>${options.outside === true ? box : ''}</main>
  <script>
    window.presses = 0;
    const privacy = document.getElementById('privacy');
    const create = document.getElementById('create');
    privacy.addEventListener('click', () => {
      if (${options.inert === true}) return;
      setTimeout(() => {
        privacy.setAttribute('aria-checked', 'true');
        create.disabled = false;
      }, 60);
    });
    create.addEventListener('click', () => {
      window.presses += 1;
      document.getElementById('register').replaceWith(Object.assign(document.createElement('p'), { textContent: 'Welcome' }));
    });
  </script></body></html>`;
}

/** The adapter ULTIPRO-7 declares on that step: div#register its sign-in container, the privacy box its one term,
 *  Create account its button, enabled once the form is filled. */
const register: Adapter = { ...genericAdapter, id: 'generic',
  detect: (doc) => {
    const root = doc.getElementById('register');
    return root === null ? null : { formRoot: root };
  },
  signInContainer(doc) {
    const container = doc.getElementById('register');
    const button = doc.getElementById('create');
    const privacy = doc.getElementById('privacy');
    return container === null || button === null ? null : { email: null, password: null, confirm: null,
      terms: privacy === null ? [] : [privacy], button, container, enablesWhenFilled: true };
  } };

const presses = (fixture: Fixture) => (fixture.view as unknown as { presses?: number }).presses ?? 0;
const checked = (fixture: Fixture) => fixture.doc.getElementById('privacy')?.getAttribute('aria-checked') ?? null;

async function pressRegister(fixture: Fixture) {
  const channel = { request: async () => ({ ok: true, data: { host: HOST, email: 'alex.rivera@example.com', press: true } }) };
  return signIn({ doc: fixture.doc, adapter: register, channel: channel as SignInContext['channel'], href: () => HREF,
    isTop: true, container: true, signal: new AbortController().signal, settleMs: 1_500 });
}

describe('item 8 (UP7-04): a declared ARIA checkbox among a sign-in container\'s terms', () => {
  it('is taken inside the container, ticked while it says false, read back true, and the button pressed once', async () => {
    const fixture = await loadFixture(document, registerPage(), { width: 1100, height: 900 });
    expect(signInRefusal(signInContainerOf(register, fixture.doc)!, new URL(HREF))).toBeNull();
    expect(await pressRegister(fixture)).toBe('continue');
    expect(presses(fixture)).toBe(1);
  });

  it('presses nothing when the page takes no tick, its button enabled or not', async () => {
    const fixture = await loadFixture(document, registerPage({ inert: true }), { width: 1100, height: 900 });
    expect(await pressRegister(fixture)).toBe('failed');
    expect([checked(fixture), presses(fixture)]).toEqual(['false', 0]);
  });

  it('leaves a term the page does not mark required to the run\'s plan, per the Consents mode', async () => {
    const fixture = await loadFixture(document, registerPage({ required: false }), { width: 1100, height: 900 });
    expect(await pressRegister(fixture)).toBe('failed');
    expect([checked(fixture), presses(fixture)]).toEqual(['false', 0]);
  });

  it('refuses one outside the container, or on a form no container declares', async () => {
    const outside = await loadFixture(document, registerPage({ outside: true }), { width: 1100, height: 900 });
    expect(signInRefusal(signInContainerOf(register, outside.doc)!, new URL(HREF))).toBe('shape');
    removeFixtures(document);
    const fixture = await loadFixture(document, registerPage(), { width: 1100, height: 900 });
    const declared = signInContainerOf(register, fixture.doc)!;
    expect(signInRefusal({ ...declared, container: undefined }, new URL(HREF))).toBe('shape');
  });
});
