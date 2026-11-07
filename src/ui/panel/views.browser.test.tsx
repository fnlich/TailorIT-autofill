/*
 * v4 ui (the owner, 2026-11-07): the side panel's views over the scripted worker. The set-up view while the extension is
 * not connected (both steps) or the profile is not complete (only "Complete your profile details"), its GO pills (the
 * disclosure before Connect, then auth/startPairing and Waiting…; the profile editor), Start applying grey until both
 * are done; a panel that opens complete goes straight to the main view, one completed during the session shows both
 * ticks and Start applying. The Settings view in place of everything under the head: ✕ back, Save grey until something
 * changed, Save with its base, ✕ discarding, Autofill information opening the editor whose Back returns there.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import {
  authStatus, button, click, completeProfile, createFakeWorker, frameReport, mount, row, SEEN_AT_ONCE, settle, typeInto,
  unmountAll, type FakeWorker,
} from '../ui.testkit';
import { Panel } from './Panel';
import { profileGaps } from './profile-check';

const WORDS = COPY.setup;

async function open(worker: FakeWorker): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={SEEN_AT_ONCE} />);
  await settle();
  return root;
}

const viewOf = (root: ParentNode) => root.querySelector<HTMLElement>('main')?.dataset.view;
const stepsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-step]')]
  .map((step) => [step.dataset.step, step.dataset.stepState]);
const tipOf = (root: ParentNode, step: string) => root.querySelector(`[data-step="${step}"] [role="tooltip"]`)?.textContent;
const start = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[data-action="start-applying"]')!;

/** A profile with no phone and no city or country. */
const incomplete = () => completeProfile({ contact: { ...completeProfile().contact, phone: { number: '', country: null,
  extension: '' }, address: { ...completeProfile().contact.address, city: '', country: null } } });

describe('what makes the profile complete (v4 ui)', () => {
  it('needs a first and last name, an email (or the account’s), a phone, and a city or a country', () => {
    expect(profileGaps(completeProfile(), null)).toEqual([]);
    expect(profileGaps(incomplete(), null)).toEqual(['phone', 'place']);
    const noEmail = completeProfile({ contact: { ...completeProfile().contact, email: '' } });
    expect(profileGaps(noEmail, null)).toEqual(['email']);
    expect(profileGaps(noEmail, 'morgan@example.test')).toEqual([]);
    const countryOnly = completeProfile({ contact: { ...completeProfile().contact,
      address: { ...completeProfile().contact.address, city: ' ', country: 'CA' } } });
    expect(profileGaps(countryOnly, null)).toEqual([]);
    const nameless = completeProfile({ name: { ...completeProfile().name, first: '', last: '  ' } });
    expect(profileGaps(nameless, null)).toEqual(['first', 'last']);
  });
});

describe('the set-up view (v4 ui)', () => {
  afterEach(() => unmountAll());

  it('shows both steps when not connected, the disclosure before Connect, then Waiting… and the typed-code link', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const root = await open(worker);
    expect(viewOf(root)).toBe('setup');
    expect(root.querySelector('h2')?.textContent).toBe(WORDS.heading);
    expect(root.textContent).toContain(WORDS.intro);
    expect(stepsOf(root)).toEqual([['account', 'go'], ['profile', 'go']]);
    // Jobright has no gear here; and nothing of the main view.
    expect(root.querySelector('button[data-panel-settings], .tia-cta[data-main-action], [data-job-card]')).toBeNull();
    expect(start(root).disabled).toBe(true);
    // Step 2 waits for step 1.
    expect(root.querySelector<HTMLButtonElement>('button[data-step-action="profile"]')!.disabled).toBe(true);
    // The explanations are each step's "?".
    expect(tipOf(root, 'account')).toBe(WORDS.accountHelp);
    // GO shows what connecting means (the first-run disclosure) before anything is sent.
    const go = root.querySelector<HTMLButtonElement>('button[data-step-action="account"]')!;
    expect([go.textContent, go.getAttribute('aria-label')]).toEqual([WORDS.go, WORDS.goLabel(WORDS.account)]);
    await click(go);
    expect(worker.sentOfType('auth/startPairing')).toEqual([]);
    const consent = root.querySelector('[data-consent]')!;
    expect(consent.textContent).toContain(COPY.options.connection.disclosure[0]);
    expect(consent.textContent).toContain(COPY.options.connection.consentLine);
    await click(button(consent, COPY.options.connection.connect));
    expect(worker.sentOfType('auth/startPairing')).toEqual([{ v: 1, type: 'auth/startPairing' }]);
    await settle();
    expect(stepsOf(root)[0]).toEqual(['account', 'waiting']);
    expect(root.querySelector('[data-step="account"] .tia-step__pill')?.textContent).toBe(WORDS.waiting);
    expect(root.querySelector('a[data-open-settings="connect"]')?.getAttribute('href'))
      .toBe('chrome-extension://memory-extension/options.html#settings-connection');
  });

  it('shows only "Complete your profile details" when connected with a profile not complete, naming what is missing', async () => {
    const worker = createFakeWorker();
    worker.script.profile = incomplete();
    const root = await open(worker);
    expect(viewOf(root)).toBe('setup');
    expect(stepsOf(root)).toEqual([['profile', 'go']]);
    expect(root.querySelector('[data-step="profile"] .tia-step__number')?.textContent).toBe('1');
    expect(tipOf(root, 'profile')).toBe(`${WORDS.profileHelp} ${WORDS.profileMissing([WORDS.gaps.phone, WORDS.gaps.place])}`);
    expect(start(root).disabled).toBe(true);
  });

  it('goes straight to the main view when the panel opens complete, and to the set-up view when the connection goes', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    expect(viewOf(root)).toBe('main');
    // The profile alone is read for the check: never the sensitive part.
    expect(worker.sentOfType('panel/profile')).toEqual([{ v: 1, type: 'panel/profile', sensitive: false }]);
    expect(root.querySelector('button[data-panel-settings]')).not.toBeNull();
    expect(root.querySelector('[data-setup]')).toBeNull();
    worker.script.auth = authStatus({ connection: 'expired', account: null });
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(viewOf(root)).toBe('setup');
    expect(stepsOf(root)).toEqual([['account', 'go'], ['profile', 'go']]);
    expect(tipOf(root, 'account')).toBe(`${WORDS.accountHelp} ${WORDS.accountExpired}`);
  });

  it('shows the main view when the profile cannot be read: nothing locks the person out', async () => {
    const worker = createFakeWorker();
    worker.script.profile = null;
    expect(viewOf(await open(worker))).toBe('main');
  });

  it('completes the profile in the editor its GO opens: both done, then Start applying opens the main view', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    worker.script.profile = incomplete();
    worker.on('panel/saveProfile', (message) => {
      worker.script.profile = message.profile as ReturnType<typeof completeProfile>;
      return { ok: true, data: { outcome: 'saved', revision: 2, flaggedLines: [] } };
    });
    const root = await open(worker);
    // TailorIT's page connected this browser: the worker says so.
    worker.script.auth = authStatus();
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    // Step 1 stays, ticked; step 2 still waits.
    expect(stepsOf(root)).toEqual([['account', 'done'], ['profile', 'go']]);
    expect(root.querySelector('[data-step="account"] .tia-step__pill')?.getAttribute('aria-label'))
      .toBe(WORDS.doneLabel(WORDS.account));
    expect(start(root).disabled).toBe(true);
    await click(root.querySelector('button[data-step-action="profile"]'));
    expect(viewOf(root)).toBe('editor');
    await settle();
    const phone = [...root.querySelectorAll('label')].find((label) => label.textContent === COPY.profile.fields.phone)!;
    await typeInto(document.getElementById(phone.htmlFor) as HTMLInputElement, '+1 555 0100');
    const city = [...root.querySelectorAll('label')].find((label) => label.textContent === COPY.profile.fields.city)!;
    await typeInto(document.getElementById(city.htmlFor) as HTMLInputElement, 'Austin');
    await click(button(root, COPY.profile.save));
    await settle();
    await click(button(root, COPY.profile.back));
    await settle();
    expect(viewOf(root)).toBe('setup');
    expect(stepsOf(root)).toEqual([['account', 'done'], ['profile', 'done']]);
    expect(start(root).disabled).toBe(false);
    await click(start(root));
    expect(viewOf(root)).toBe('main');
  });

  it('opens Start applying once connected when the profile cannot be read, its "?" saying so (the v4 review, M-L6)', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    worker.script.profile = null;
    const root = await open(worker);
    expect(viewOf(root)).toBe('setup');
    expect(start(root).disabled).toBe(true);
    // TailorIT's page connected this browser; the profile then cannot be read.
    worker.script.auth = authStatus();
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(worker.sentOfType('panel/profile')).toEqual([{ v: 1, type: 'panel/profile', sensitive: false }]);
    // The view stays, step 1 ticked; step 2 a GO whose "?" says the profile could not be read; Start applying opens.
    expect(viewOf(root)).toBe('setup');
    expect(stepsOf(root)).toEqual([['account', 'done'], ['profile', 'go']]);
    expect(tipOf(root, 'profile')).toBe(`${WORDS.profileHelp} ${WORDS.profileUnreadable}`);
    expect(root.querySelector<HTMLButtonElement>('button[data-step-action="profile"]')!.disabled).toBe(false);
    expect(start(root).disabled).toBe(false);
    await click(start(root));
    expect(viewOf(root)).toBe('main');
  });
});

describe('the Settings view (v4 ui)', () => {
  afterEach(() => unmountAll());

  it('replaces everything under the head; ✕ returns to the main view', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('a')] })]);
    const root = await open(worker);
    const gear = root.querySelector<HTMLButtonElement>('button[data-panel-settings]')!;
    expect(gear.getAttribute('aria-label')).toBe(COPY.mainView.settings);
    await click(gear);
    expect(viewOf(root)).toBe('settings');
    expect(root.querySelector('.tia-settings__heading')?.textContent).toBe(COPY.settingsView.heading);
    expect(root.querySelector('li[data-field-key], .tia-cta[data-main-action], [data-ask]')).toBeNull();
    // Jobright's groups, each title with its "?" holding its explanation.
    const titles = [...root.querySelectorAll('.tia-mode__name')].map((name) => name.textContent);
    expect(titles.slice(0, 2)).toEqual([COPY.options.modes.afterPageTurn.name, COPY.options.modes.view.name]);
    const afterPageTurn = root.querySelector('[data-setting-group="modes.afterPageTurn"]')!;
    expect(afterPageTurn.querySelector('[role="tooltip"]')?.textContent).toBe(COPY.options.modes.afterPageTurn.help);
    expect(afterPageTurn.getAttribute('role')).toBe('radiogroup');
    await click(root.querySelector('button[data-action="close-settings"]'));
    expect(viewOf(root)).toBe('main');
    expect(root.querySelector('li[data-field-key="a"]')).not.toBeNull();
  });

  it('keeps Save grey until something changed, saves with its base, and shows what the worker stored', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('a')] })]);
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    const save = () => root.querySelector<HTMLButtonElement>('button[data-action="save-settings"]')!;
    expect([save().textContent, save().disabled]).toEqual([COPY.settingsView.save, true]);
    const base = structuredClone(worker.script.settings);
    await click(root.querySelector('input[data-setting="view.minimized"]'));
    await click(root.querySelector('input[data-setting="modes.afterPageTurn.manual"]'));
    expect(save().disabled).toBe(false);
    // Nothing is sent before Save.
    expect(worker.sentOfType('settings/save')).toEqual([]);
    await click(save());
    const sent = worker.sentOfType('settings/save');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.base).toEqual(base);
    expect(sent[0]!.settings).toMatchObject({ view: 'minimized', modes: { afterPageTurn: 'manual' } });
    expect(root.querySelector('.tia-settings__note')?.textContent).toBe(COPY.settingsView.saved);
    expect(save().disabled).toBe(true);
    // The main view follows what was saved: the Minimized view folds the lists.
    await click(root.querySelector('button[data-action="close-settings"]'));
    expect(root.querySelector('li[data-field-key="a"]')).toBeNull();
  });

  it('discards an unsaved change on ✕', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    await click(root.querySelector('input[data-setting="modes.next.auto"]'));
    expect(root.querySelector<HTMLInputElement>('input[data-setting="modes.next.auto"]')!.checked).toBe(true);
    await click(root.querySelector('button[data-action="close-settings"]'));
    await click(root.querySelector('button[data-panel-settings]'));
    expect(root.querySelector<HTMLInputElement>('input[data-setting="modes.next.manual"]')!.checked).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[data-action="save-settings"]')!.disabled).toBe(true);
    expect(worker.sentOfType('settings/save')).toEqual([]);
  });

  it('opens Autofill information in the editor, whose Back returns to the Settings view', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    const row = root.querySelector<HTMLButtonElement>('.tia-settings button[data-open-profile]')!;
    expect(row.textContent).toBe(COPY.settingsView.autofillInfo);
    await click(row);
    expect(viewOf(root)).toBe('editor');
    await settle();
    await click(button(root, COPY.profile.back));
    expect(viewOf(root)).toBe('settings');
    expect(root.querySelector('a[data-open-settings]')?.getAttribute('href')).toBe('chrome-extension://memory-extension/options.html');
  });

  it('holds Sign-in Auto disabled, saying why in its "?", and offers no "Ask me" and no draft confirmation', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    const signIn = root.querySelector('[data-setting-group="modes.signIn"]')!;
    expect(signIn.querySelector<HTMLInputElement>('input[data-setting="modes.signIn.auto"]')!.disabled).toBe(true);
    expect(signIn.querySelector('[role="tooltip"]')?.textContent)
      .toBe(`${COPY.options.modes.signIn.help} ${COPY.options.modes.signIn.needsScope}`);
    expect(root.querySelector('[data-setting^="llm."], [data-setting="offerToSaveAnswers"]')).toBeNull();
    expect(root.textContent).not.toContain(COPY.options.ai.whenForbidden.ask);
    expect(root.textContent).not.toContain(COPY.options.ai.confirmDrafts);
  });
});
