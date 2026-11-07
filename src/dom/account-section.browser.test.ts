/*
 * The behaviour review of 2026-11-06 (M9, core-x item 2's guards): an account section counts only where the adapter
 * declares it inside the form root, as a part of it (never the root itself, never outside it), and its declared
 * create-account form has a password box and every box inside the section (dom/account-section.ts). Anything else is
 * no section: the page reads as before, its password boxes an account's creation (dom/pause-detect.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter, SignInForm } from '../adapters/types';
import { accountFormOf, accountLeft, accountSectionOf } from './account-section';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { detectPause } from './pause-detect';

afterEach(() => removeFixtures(document));

/** A profile form (form#app) with its "Create a login" part (div#login: a login, a password, the password again). */
const PAGE = `<!doctype html><html><head><style>input { display: block; width: 300px; }</style></head><body>
  <form id="app" method="post">
    <label for="first">First Name</label><input id="first" required>
    <div id="login" role="group"><h3>Create a login</h3>
      <label for="user">Login</label><input id="user" type="email" required>
      <label for="pw">Password</label><input id="pw" type="password" required>
      <label for="pw2">Confirm Password</label><input id="pw2" type="password" required>
    </div>
    <label for="elsewhere">Elsewhere</label><input id="elsewhere" type="password">
    <button id="submit-profile" type="submit">Submit Profile</button>
  </form></body></html>`;

/** An adapter declaring `section` as the form's account section and `form` as its create-account form. */
function adapter(section: (root: Element) => Element | null, form: (doc: Document) => Partial<SignInForm> = () => ({}))
  : Adapter {
  return { ...genericAdapter, id: 'generic',
    detect: (doc) => ({ formRoot: doc.getElementById('app')! }),
    accountSection: section,
    signInForm: (doc, wall) => (wall !== 'create-account' ? null : {
      email: doc.getElementById('user') as HTMLInputElement, password: doc.getElementById('pw') as HTMLInputElement,
      confirm: doc.getElementById('pw2') as HTMLInputElement, terms: [],
      button: doc.getElementById('submit-profile')!, form: doc.getElementById('app') as HTMLFormElement,
      declared: true, personPresses: true, ...form(doc) }) };
}

const login = (root: Element) => root.ownerDocument.getElementById('login');

async function read(declared: Adapter, change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, PAGE);
  change?.(fixture.doc);
  const root = fixture.doc.getElementById('app')!;
  return { doc: fixture.doc, section: accountSectionOf(declared, fixture.doc, root),
    form: accountFormOf(declared, fixture.doc, root), left: accountLeft(declared, fixture.doc, root),
    pause: detectPause(fixture.doc, root, declared)?.kind ?? null };
}

describe('an account section inside the application form (M9: A2a, A2b, A2c)', () => {
  it('control: a declared part of the form, its create-account form inside it, is a section', async () => {
    const { doc, section, form, left, pause } = await read(adapter(login),
      (page) => page.getElementById('elsewhere')!.remove());
    expect(section).toBe(doc.getElementById('login'));
    expect(form?.password).toBe(doc.getElementById('pw'));
    // Its three required boxes, empty; its password boxes no account page.
    expect(left).toBe(3);
    expect(pause).toBeNull();
  });

  it('is no section where a box of its create-account form sits outside it (A2a)', async () => {
    const { section, form, left, pause } = await read(adapter(login, (doc) => ({
      confirm: doc.getElementById('elsewhere') as HTMLInputElement })));
    expect([section, form, left]).toEqual([null, null, 0]);
    expect(pause).toBe('create-account');
  });

  it('is no section where its create-account form has no password box (A2b)', async () => {
    const { section, form, left } = await read(adapter(login, () => ({ password: null, confirm: null })),
      (page) => page.getElementById('elsewhere')!.remove());
    expect([section, form, left]).toEqual([null, null, 0]);
  });

  it('is no section where the adapter names the form root itself, or a part outside it (A2c)', async () => {
    const whole = await read(adapter((root) => root), (page) => page.getElementById('elsewhere')!.remove());
    expect([whole.section, whole.form, whole.left, whole.pause]).toEqual([null, null, 0, 'create-account']);
    removeFixtures(document);
    const outside = await read(adapter((root) => root.ownerDocument.getElementById('away')), (page) => {
      page.getElementById('elsewhere')!.remove();
      const away = page.createElement('div');
      away.id = 'away';
      away.append(page.getElementById('login')!);
      page.body.append(away);
    });
    expect([outside.section, outside.form, outside.left]).toEqual([null, null, 0]);
  });
});
