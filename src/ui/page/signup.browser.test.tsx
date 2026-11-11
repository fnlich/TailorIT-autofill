/*
 * jr6: Settings › Sign-up Information (ui/page/signup.tsx), as the options page's card and Chrome's side panel draw it,
 * and what the sidebar on the page draws of it:
 * - the email box starts with the profile's; the password box is masked, and Show and Hide reveal what is typed here;
 * - the rules' checklist follows the typing; Save is offered once every rule is met, and sends the email and password;
 *   once saved, the box is emptied, never filled back (no answer holds a saved password), and says "Saved";
 * - "Generate strong password" fills the box with one that meets every rule, shown at once;
 * - Delete asks first, then says when Sign-in went back to Manual;
 * - Import from TailorIT shows where offered, and says what came of it;
 * - Sign-in's Auto, in the same page, is offered only once a password is saved;
 * - the sidebar on the page shows whether one is saved and the settings page's card: never a password box, never the
 *   fields.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNUP_PASSWORD_RULES, signupPasswordValid } from '../../core/signup-password';
import { COPY } from '../../shared/copy';
import type { SidebarMount } from '../../shared/sidebar';
import { Options } from '../options/Options';
import { Panel } from '../panel/Panel';
import { createSidebarApp } from '../sidebar/mount';
import {
  authStatus, click, createFakeWorker, mount, SEEN_AT_ONCE, settle, signupStatus, typeInto, unmountAll, type FakeWorker,
} from '../ui.testkit';
import { renderSignUpFields, SignUpFields } from './signup';
import { SIGNUP_COPY as WORDS } from './signup-copy';
import { SignUpSlot } from './signup-slot';
import { adoptPageStyles } from './styles';

const PASSWORD = 'Typed-By-The-Test-2026!';

const sidebars: Array<{ host: HTMLElement; mounted: SidebarMount }> = [];
afterEach(() => {
  for (const { host, mounted } of sidebars.splice(0)) {
    act(() => mounted.unmount());
    host.remove();
  }
  unmountAll();
});

async function fields(worker: FakeWorker, onChanged = vi.fn()) {
  adoptPageStyles(document);
  const root = await mount(<SignUpFields platform={worker.platform} onChanged={onChanged} />);
  await settle();
  return { root, onChanged };
}

const emailBox = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[data-signup-email]')!;
const passwordBox = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[data-signup-password]')!;
const save = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[data-action="signup-save"]')!;
const met = (root: ParentNode) => Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-signup-rules] li')]
  .map((rule) => [rule.dataset.rule, rule.dataset.met]));
const noteOf = (root: ParentNode) => root.querySelector('[data-signup-note]')?.textContent ?? null;

describe('Sign-up Information’s fields (jr6)', () => {
  it('starts with the profile’s email, a masked empty password box, the rules unmet, and Save off', async () => {
    const worker = createFakeWorker();
    const { root } = await fields(worker);
    expect(root.querySelector<HTMLElement>('[data-signup]')?.dataset.signupState).toBe('not-set');
    expect(root.querySelector('[data-signup-status]')?.textContent).toBe(WORDS.notSet);
    expect(emailBox(root).value).toBe('morgan@example.test');
    expect(passwordBox(root).type).toBe('password');
    expect(passwordBox(root).value).toBe('');
    expect(passwordBox(root).autocomplete).toBe('new-password');
    expect(Object.values(met(root))).toEqual(SIGNUP_PASSWORD_RULES.map(() => 'false'));
    expect(save(root).disabled).toBe(true);
  });

  it('follows the rules as the password is typed, saves once every one is met, and empties the box', async () => {
    const worker = createFakeWorker();
    const { root, onChanged } = await fields(worker);
    await typeInto(passwordBox(root), 'short1A');
    expect(met(root)).toEqual({ length: 'false', upper: 'true', lower: 'true', digit: 'true', special: 'false',
      allowed: 'true' });
    expect(save(root).disabled).toBe(true);
    await typeInto(passwordBox(root), 'Has a space in it 1!');
    expect(met(root).allowed).toBe('false');
    expect(save(root).disabled).toBe(true);
    await typeInto(passwordBox(root), PASSWORD);
    expect(Object.values(met(root)).every((value) => value === 'true')).toBe(true);
    // Show and Hide.
    await click(root.querySelector('button[data-action="signup-show"]'));
    expect(passwordBox(root).type).toBe('text');
    await click(root.querySelector('button[data-action="signup-show"]'));
    expect(passwordBox(root).type).toBe('password');
    expect(save(root).disabled).toBe(false);
    await click(save(root));
    expect(worker.sentOfType('signup/save')).toEqual([{ v: 1, type: 'signup/save', email: 'morgan@example.test',
      password: PASSWORD }]);
    expect(noteOf(root)).toBe(WORDS.saved);
    expect(passwordBox(root).value).toBe('');
    expect(passwordBox(root).placeholder).toBe(WORDS.passwordSaved);
    expect(root.querySelector<HTMLElement>('[data-signup]')?.dataset.signupState).toBe('set');
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The page never holds the saved password again.
    expect(root.innerHTML).not.toContain(PASSWORD);
  });

  it('generates a strong password, shown at once, and changes the email alone with the password kept', async () => {
    const worker = createFakeWorker();
    const { root } = await fields(worker);
    await click(root.querySelector('button[data-action="signup-generate"]'));
    const generated = passwordBox(root).value;
    expect(generated).toHaveLength(20);
    expect(signupPasswordValid(generated)).toBe(true);
    expect(passwordBox(root).type).toBe('text');
    expect(noteOf(root)).toBe(WORDS.generated);
    await click(save(root));
    expect(worker.sentOfType('signup/save').at(-1)).toMatchObject({ password: generated });
    // The email alone, the saved password kept: no password sent.
    await typeInto(emailBox(root), 'morgan.lee@example.org');
    expect(save(root).disabled).toBe(false);
    await click(save(root));
    expect(worker.sentOfType('signup/save').at(-1)).toEqual({ v: 1, type: 'signup/save', email: 'morgan.lee@example.org' });
  });

  it('deletes after asking, and says when Sign-in went back to Manual', async () => {
    const worker = createFakeWorker();
    worker.script.signup = { ...worker.script.signup, ...signupStatus({ set: true, email: 'morgan@example.test',
      updatedAt: Date.UTC(2026, 10, 9), suggestedEmail: null }), reverted: true };
    const { root } = await fields(worker);
    expect(root.querySelector('[data-signup-status]')?.textContent).toContain('A password is saved in this browser');
    await click(root.querySelector('button[data-action="signup-delete"]'));
    expect(root.querySelector('[data-signup-confirm]')?.textContent).toContain(WORDS.removeConfirm);
    expect(worker.sentOfType('signup/delete')).toEqual([]);
    await click(root.querySelector('button[data-action="signup-delete-cancel"]'));
    expect(root.querySelector('[data-signup-confirm]')).toBeNull();
    await click(root.querySelector('button[data-action="signup-delete"]'));
    await click(root.querySelector('button[data-action="signup-delete-confirm"]'));
    expect(worker.sentOfType('signup/delete')).toHaveLength(1);
    expect(noteOf(root)).toBe(WORDS.reverted);
    expect(root.querySelector<HTMLElement>('[data-signup]')?.dataset.signupState).toBe('not-set');
  });

  it('offers Import from TailorIT where the worker says so, and says what came of it', async () => {
    for (const [importAs, said] of [['imported', WORDS.imported], ['weak', WORDS.importWeak], ['none', WORDS.importNone],
      ['unavailable', WORDS.importFailed]] as const) {
      const worker = createFakeWorker();
      worker.script.signup = { ...worker.script.signup, importable: true, importAs };
      const { root } = await fields(worker);
      await click(root.querySelector('button[data-action="signup-import"]'));
      expect(noteOf(root), importAs).toBe(said);
      unmountAll();
    }
    const none = createFakeWorker();
    const { root } = await fields(none);
    expect(root.querySelector('[data-signup-import]')).toBeNull();
  });

  it('is the options page’s card right after the connection, and Sign-in’s Auto waits for a saved password there', async () => {
    adoptPageStyles(document);
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ signUp: 'not-set' });
    const root = await mount(<Options platform={worker.platform} />);
    await settle();
    const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')].map((card) => card.dataset.card);
    expect(cards.slice(0, 3)).toEqual(['connection', 'signup', 'documents']);
    const card = root.querySelector<HTMLElement>('[data-card="signup"]')!;
    expect(card.id).toBe('settings-signup');
    expect(card.querySelector('.tia-card__title')?.textContent).toBe(WORDS.heading);
    expect(root.querySelector<HTMLInputElement>('input[data-setting="modes.signIn.auto"]')!.disabled).toBe(true);
    // Saved: the page reads the connection again, and Auto may be chosen.
    worker.script.auth = authStatus({ signUp: 'set' });
    await click(card.querySelector('button[data-action="signup-generate"]'));
    await click(save(card));
    await settle();
    expect(root.querySelector<HTMLInputElement>('input[data-setting="modes.signIn.auto"]')!.disabled).toBe(false);
  });

  it('reads the status again when the worker says it changed, and once more when a first read fails (the jr6 review, R15)', async () => {
    const worker = createFakeWorker();
    const statusNow = () => {
      const { importAs: _importAs, reverted: _reverted, ...status } = worker.script.signup;
      return status;
    };
    let failures = 1;
    worker.on('signup/status', () => (failures-- > 0 ? { ok: false, error: 'unavailable' } : { ok: true, data: statusNow() }));
    const { root } = await fields(worker);
    // The first read failed: tried once more, and drawn.
    expect(worker.sentOfType('signup/status')).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('[data-signup]')?.dataset.signupState).toBe('not-set');
    // A password saved on another page (the options page, while this side panel stays open): the worker says so.
    worker.script.signup = { ...worker.script.signup, set: true, email: 'morgan@example.test',
      updatedAt: Date.UTC(2026, 10, 11), suggestedEmail: null };
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'signup' }));
    await settle();
    expect(root.querySelector<HTMLElement>('[data-signup]')?.dataset.signupState).toBe('set');
    // Another change (the connection) is not this card's.
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(worker.sentOfType('signup/status')).toHaveLength(3);
  });

  it('masks what Show reveals again after a while, and at once when the page loses the focus (the jr6 review, sec-8)', async () => {
    adoptPageStyles(document);
    const worker = createFakeWorker();
    const root = await mount(<SignUpFields platform={worker.platform} remaskMs={300} />);
    await settle();
    await click(root.querySelector('button[data-action="signup-generate"]'));
    expect(passwordBox(root).type).toBe('text');
    await vi.waitFor(() => expect(passwordBox(root).type).toBe('password'), { timeout: 3_000 });
    // Shown again, then the person turns to another window (or the job site's page beside the side panel).
    await click(root.querySelector('button[data-action="signup-show"]'));
    expect(passwordBox(root).type).toBe('text');
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(passwordBox(root).type).toBe('password');
  });

  it('says beside Save that a saved password is not shown again, and what the worker did by itself (the jr6 review, R6, R12)', async () => {
    const worker = createFakeWorker();
    const { root } = await fields(worker);
    expect(root.querySelector('[data-signup-once]')?.textContent).toBe(WORDS.notShownAgain);
    expect(root.querySelector('[data-signup-notice]')).toBeNull();
    unmountAll();
    for (const notice of ['reverted', 'gone'] as const) {
      const told = createFakeWorker();
      told.script.signup = { ...told.script.signup, notice };
      const { root: card } = await fields(told);
      expect(card.querySelector<HTMLElement>('[data-signup-notice]')?.dataset.signupNotice).toBe(notice);
      expect(card.querySelector('[data-signup-notice]')?.textContent).toBe(WORDS.notices[notice]);
      unmountAll();
    }
  });

  it('is drawn in Chrome’s side panel’s Settings view, right after Autofill Information, where the page gives it', async () => {
    adoptPageStyles(document);
    const worker = createFakeWorker();
    const root = await mount(
      <SignUpSlot.Provider value={renderSignUpFields}>
        <Panel platform={worker.platform} pinnedTabId={5} seenClock={SEEN_AT_ONCE} />
      </SignUpSlot.Provider>,
    );
    await settle();
    await click(root.querySelector('button[data-panel-settings]'));
    const section = root.querySelector('[data-settings-section="signup"]')!;
    expect(section.querySelector('h3')?.textContent).toBe(COPY.settingsView.signUp);
    expect(section.querySelector('input[data-signup-password]')).not.toBeNull();
    expect(section.previousElementSibling?.getAttribute('data-settings-section')).toBe('autofill-info');
  });
});

describe('the sidebar on the page (jr6): the state and a link, never a password box', () => {
  async function sidebar(worker: FakeWorker) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    container.className = 'sidebar__app';
    shadow.append(container);
    const app = createSidebarApp(() => worker.platform);
    let mounted: SidebarMount | null = null;
    await act(async () => {
      mounted = app.mount({ container, tabId: 7, minimise: () => undefined });
    });
    sidebars.push({ host, mounted: mounted! });
    await settle();
    return container;
  }

  it('says whether a password is saved and links to the settings page’s card', async () => {
    for (const [signUp, said] of [['not-set', COPY.settingsView.signUpNotSet], ['set', COPY.settingsView.signUpSet]] as const) {
      const worker = createFakeWorker();
      worker.script.auth = authStatus({ signUp });
      const container = await sidebar(worker);
      await click(container.querySelector('button[data-panel-settings]'));
      const section = container.querySelector('[data-settings-section="signup"]')!;
      expect(section.querySelector<HTMLElement>('[data-signup-state]')?.dataset.signupState).toBe(signUp);
      expect(section.textContent).toContain(said);
      expect(section.querySelector('a[data-open-signup]')?.getAttribute('href'))
        .toBe('chrome-extension://memory-extension/options.html#settings-signup');
      // Never a password box anywhere in the sidebar, nor the fields' own words, nor a message about it.
      expect(container.querySelector('input[type="password"], input[data-signup-password], [data-signup]')).toBeNull();
      expect(container.textContent).not.toContain(WORDS.generate);
      expect(worker.sentOfType('signup/status')).toEqual([]);
      for (const { host, mounted } of sidebars.splice(0)) {
        act(() => mounted.unmount());
        host.remove();
      }
    }
  });

  it('cannot choose Sign-in’s Auto there, a password saved or not', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ signUp: 'set' });
    const container = await sidebar(worker);
    await click(container.querySelector('button[data-panel-settings]'));
    expect(container.querySelector<HTMLInputElement>('input[data-setting="modes.signIn.auto"]')!.disabled).toBe(true);
    expect(container.querySelector('[data-setting-group="modes.signIn"] [role="tooltip"]')?.textContent)
      .toContain(COPY.onPage.raise);
  });
});
