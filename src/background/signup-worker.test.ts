/*
 * jr6, Settings › Sign-up Information in the real worker (index.ts, signup.ts, signup-vault.ts, sign-in.ts), over WXT's
 * fake browser and a fake TailorIT:
 * - signup/status, signup/save, signup/delete and signup/import from the extension's own pages: the status never holds
 *   the password; a save takes a password that meets every rule; the email box starts with the profile's;
 * - Sign-in mode's guard: Auto is refused without a password saved (a page's base merged or not); deleting the password
 *   while on Auto sets it back to Manual, says so, and every frame hears it;
 * - the sidebar's channel (the tab's top frame of a content script) may neither read nor write it: no signup/* message is
 *   the sidebar's (SIDEBAR_PAGE_MESSAGES), and its settings/save may not raise Sign-in to Auto; auth/status tells it a
 *   word alone (signUp: 'set');
 * - "Import from TailorIT": once, with credentials:read, TailorIT's every-site sign-in when its password meets the
 *   rules;
 * - never logged, never sent: across a whole round (save, read for a sign-in, import refused, delete), no log line and no
 *   request to TailorIT holds the password, in any form, and no log line its length.
 * - the jr6 review: the email box starts with the TailorIT profile's email, read for it (R9); a save of Auto that met a
 *   delete, and a sign-in that found none under Auto, set Sign-in back (sec-9); the card says what the worker did by
 *   itself (R12); setting Sign-in back keeps a change saved meanwhile (R13); a claiming subframe of another origin is
 *   never answered, through the real claim-frame rule (sec-10).
 * - jr6 ifix SEC-3 (the jr6 integration review's SEC-3; the coordinator's decision: keep the fetch, fix the words): an
 *   email gate with no Sign-up Information saved is answered the TailorIT profile's contact email, read as any Autofill
 *   reads the profile: from the worker's memory, else fetched from TailorIT (GET /profile, with its saved answers), as
 *   after five idle minutes; with one saved, or not connected, no profile is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import profileGolden from '../contract/tailorit/v1/fixtures/AutofillProfileEnvelope/valid/golden.json';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { StorageArea } from '../platform/types';
import { SIDEBAR_PAGE_MESSAGES } from './senders';
import { PROFILE_IDLE_MS } from './profile-cache';
import { createSettingsStore } from './settings';
import { createSignup, SIGNUP_IMPORT_HOST } from './signup';
import { SIGNUP_RECORD_KEY, type SignupVault } from './signup-vault';
import {
  contentSender, pageSender, saveSignup, sentToFrames, SIGNUP_EMAIL, SIGNUP_PASSWORD, startTestWorker, tokenRecord,
  typeOfSent, type TestWorker,
} from './worker.testkit';

const OPTIONS = pageSender('options.html');
const WORKDAY = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually';
/** The tab's top frame on a Workday account page, as Chrome reports it: the sidebar's channel too. */
const top = (overrides: Record<string, unknown> = {}) => contentSender({ url: WORKDAY, tab: { id: 12, url: WORKDAY },
  documentId: 'doc-12', ...overrides });
const SIGNUP_TYPES = ['signup/status', 'signup/save', 'signup/delete', 'signup/import'] as const;

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const status = (worker: TestWorker) => worker.deliver({ v: 1, type: 'signup/status' }, OPTIONS);
const settingsWith = (signIn: 'auto' | 'manual') => ({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn } });
const ask = (worker: TestWorker, wall: 'sign-in' | 'create-account' = 'create-account') =>
  worker.deliver({ v: 1, type: 'signin/credential', wall }, top());
/** The settings the worker last told the tab's frames. */
const lastToFrames = (worker: TestWorker) => (sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'settings/changed')
  .at(-1)?.message as { settings: { modes: { signIn: string }; typeSignIn: boolean } } | undefined)?.settings;

/** The golden profile with its contact email changed (an applicant whose profile email is not the account's). */
const profileWithEmail = (email: string) => ({ ...profileGolden, profile: { ...profileGolden.profile,
  contact: { ...profileGolden.profile.contact, email } } });

describe('Sign-up Information’s messages (jr6)', () => {
  it('says none is saved, with the profile’s email for the box (the account’s where the profile has none), and saves one that meets the rules', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    // The jr6 review (R9): the TailorIT profile's email, read for it; here the profile holds none: the account's, once
    // the page's own auth/status read it.
    worker.tailorit.reply('GET /api/autofill/profile', { json: profileWithEmail('') });
    expect(await status(worker)).toEqual({ ok: true, data: { set: false, email: null, updatedAt: null,
      suggestedEmail: null, importable: true } });
    await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS);
    expect(await status(worker)).toEqual({ ok: true, data: { set: false, email: null, updatedAt: null,
      suggestedEmail: 'elena.ruiz@example.com', importable: true } });
    // The rules, checked by the worker too.
    for (const weak of ['short-1A!', 'nouppercase-but-long-1!', 'NoSpecialCharacters12345', 'Has space In It 123!']) {
      expect(await worker.deliver({ v: 1, type: 'signup/save', email: SIGNUP_EMAIL, password: weak }, OPTIONS), weak)
        .toEqual({ ok: false, error: 'bad_message' });
    }
    expect(await worker.deliver({ v: 1, type: 'signup/save', email: 'not-an-email', password: SIGNUP_PASSWORD }, OPTIONS))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'signup/save', email: SIGNUP_EMAIL }, OPTIONS))
      .toEqual({ ok: false, error: 'bad_message' });
    const saved = await worker.deliver({ v: 1, type: 'signup/save', email: SIGNUP_EMAIL, password: SIGNUP_PASSWORD },
      OPTIONS);
    expect(saved).toEqual({ ok: true, data: { set: true, email: SIGNUP_EMAIL, updatedAt: worker.clock.now,
      suggestedEmail: null, importable: false } });
    expect(JSON.stringify(saved)).not.toContain(SIGNUP_PASSWORD);
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { signUp: 'set' } });
    // An email changed alone keeps the password.
    expect(await worker.deliver({ v: 1, type: 'signup/save', email: 'alex.r@example.org' }, OPTIONS)).toMatchObject({
      ok: true, data: { set: true, email: 'alex.r@example.org' } });
    expect(await ask(worker)).toMatchObject({ ok: true, data: { email: 'alex.r@example.org', password: SIGNUP_PASSWORD } });
  });

  it('tells every frame a password may be typed once one is saved, and not once it is deleted', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top()))
      .toMatchObject({ ok: true, data: { settings: { typeSignIn: false } } });
    await saveSignup(worker);
    expect(lastToFrames(worker)).toMatchObject({ typeSignIn: true, modes: { signIn: 'manual' } });
    expect(await worker.deliver({ v: 1, type: 'signup/delete' }, OPTIONS)).toMatchObject({ ok: true,
      data: { status: { set: false }, reverted: false } });
    expect(lastToFrames(worker)).toMatchObject({ typeSignIn: false });
  });
});

describe('Sign-in mode’s guard: Auto needs a saved password (jr6, coordinator decision 1)', () => {
  it('refuses Auto without a password, whether the page names its base or not', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS))
      .toEqual({ ok: false, error: 'unavailable' });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto'), base: DEFAULT_SETTINGS },
      OPTIONS)).toEqual({ ok: false, error: 'unavailable' });
    // Any other change still saves.
    const next = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' as const } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: next }, OPTIONS)).toEqual({ ok: true,
      data: { settings: next } });
    await saveSignup(worker);
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'auto' } } } });
  });

  it('deleting the password while on Auto sets Sign-in back to Manual, says so, and tells the frames', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS);
    await saveSignup(worker);
    await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    const panel = worker.connect('panel', OPTIONS);
    const changed: unknown[] = [];
    panel.onMessage((message) => changed.push(message));
    expect(await worker.deliver({ v: 1, type: 'signup/delete' }, OPTIONS)).toEqual({ ok: true,
      data: { status: { set: false, email: null, updatedAt: null, suggestedEmail: 'elena.ruiz@example.com',
        importable: true }, reverted: true } });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true,
      data: { settings: { modes: { signIn: 'manual' } } } });
    expect(lastToFrames(worker)).toMatchObject({ modes: { signIn: 'manual' }, typeSignIn: false });
    await vi.waitFor(() => expect(changed).toEqual(expect.arrayContaining([
      { v: 1, type: 'panel/changed', what: 'signup' }, { v: 1, type: 'panel/changed', what: 'settings' }])));
    // Nothing of it is left: no record, no key, no sign-in to answer.
    expect(await fakeBrowser.storage.local.get(SIGNUP_RECORD_KEY)).toEqual({});
    expect(worker.signupKey.value).toBeUndefined();
    expect(await ask(worker)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('the sidebar on the page never reads or writes the password (jr6)', () => {
  it('names none of Sign-up Information’s messages among its own', () => {
    for (const type of SIGNUP_TYPES) expect(SIDEBAR_PAGE_MESSAGES.has(type), type).toBe(false);
  });

  it('is refused every Sign-up Information message from the tab’s top frame, and Sign-in Auto by its settings/save', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    const messages = [{ v: 1, type: 'signup/status' }, { v: 1, type: 'signup/delete' }, { v: 1, type: 'signup/import' },
      { v: 1, type: 'signup/save', email: 'mallory@example.com', password: 'Mallory-Chosen-Pass-99!' }];
    for (const message of messages) {
      expect(await worker.deliver(message, top()), message.type).toEqual({ ok: false, error: 'bad_sender' });
    }
    // Still the person's own, as saved on the extension's page.
    expect(await ask(worker)).toMatchObject({ ok: true, data: { email: SIGNUP_EMAIL, password: SIGNUP_PASSWORD } });
    // Its settings/save may not raise Sign-in to Auto (the review's S7), though a password is saved.
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, top()))
      .toEqual({ ok: false, error: 'bad_sender' });
    // Its auth/status says a word alone.
    const said = await worker.deliver({ v: 1, type: 'auth/status' }, top());
    expect(said).toMatchObject({ ok: true, data: { signUp: 'set' } });
    expect(JSON.stringify(said)).not.toContain(SIGNUP_PASSWORD);
    expect(JSON.stringify(said)).not.toContain(SIGNUP_EMAIL);
  });

  it('opens the settings page at Sign-up Information from the page, never anything of it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    expect(await worker.deliver({ v: 1, type: 'sidebar/options', section: 'settings-signup' }, top())).toEqual({ ok: true,
      data: {} });
    expect((await fakeBrowser.tabs.query({})).map((tab) => tab.url)).toContain(
      'chrome-extension://test-extension-id/options.html#settings-signup'.replace('test-extension-id', fakeBrowser.runtime.id));
    // A subframe that claims nothing may not.
    expect(await worker.deliver({ v: 1, type: 'sidebar/options', section: 'settings-signup' },
      top({ frameId: 3, documentId: 'doc-sub' }))).toEqual({ ok: false, error: 'bad_sender' });
  });
});

describe('"Import from TailorIT" (jr6)', () => {
  const credentialsReads = (worker: TestWorker) => worker.tailorit.requests
    .filter((request) => request.path === '/api/autofill/credentials')
    .map((request) => new URL(request.url).searchParams.get('host'));

  it('imports TailorIT’s every-site sign-in once, when its password meets the rules', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: '*', email: SIGNUP_EMAIL, password: SIGNUP_PASSWORD } });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toEqual({ ok: true, data: { outcome: 'imported',
      status: { set: true, email: SIGNUP_EMAIL, updatedAt: worker.clock.now, suggestedEmail: null, importable: false } } });
    expect(credentialsReads(worker)).toEqual([SIGNUP_IMPORT_HOST]);
    // Once: with one saved here it is not offered again.
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toEqual({ ok: false, error: 'unavailable' });
    expect(credentialsReads(worker)).toHaveLength(1);
    expect(await ask(worker)).toMatchObject({ ok: true, data: { password: SIGNUP_PASSWORD } });
  });

  it('saves nothing for a password that misses a rule, none for every site, or a sign-in of the import’s host itself', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: '*', email: SIGNUP_EMAIL, password: 'weak-password' } },
      { once: true });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toMatchObject({ ok: true,
      data: { outcome: 'weak', status: { set: false } } });
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 404, json: { error: { code: 'not_found',
      message: 'None.' } } }, { once: true });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toMatchObject({ ok: true,
      data: { outcome: 'none', status: { set: false } } });
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: SIGNUP_IMPORT_HOST, email: SIGNUP_EMAIL,
      password: SIGNUP_PASSWORD } }, { once: true });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toMatchObject({ ok: true,
      data: { outcome: 'none', status: { set: false } } });
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 503, json: { error: { code: 'unavailable',
      message: 'Down.' } } }, { once: true });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toEqual({ ok: false, error: 'unavailable' });
    expect(await fakeBrowser.storage.local.get(SIGNUP_RECORD_KEY)).toEqual({});
  });

  it('is not offered, and asks nothing, without credentials:read', async () => {
    const record = tokenRecord();
    const worker = await startTestWorker({ token: tokenRecord({ scopes: record.scopes.filter((scope) =>
      scope !== 'credentials:read') }) });
    expect(await status(worker)).toMatchObject({ ok: true, data: { importable: false } });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toEqual({ ok: false, error: 'unavailable' });
    expect(credentialsReads(worker)).toEqual([]);
  });
});

describe('the password is never logged and never sent (jr6)', () => {
  it('holds it in no log line and no request to TailorIT across a whole round, nor its length in a log line', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    // An import that finds none (TailorIT asked once), before the person sets one.
    worker.tailorit.reply('GET /api/autofill/credentials', { status: 404, json: { error: { code: 'not_found',
      message: 'None.' } } });
    expect(await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS)).toMatchObject({ ok: true,
      data: { outcome: 'none' } });
    await saveSignup(worker);
    await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS);
    await worker.deliver({ v: 1, type: 'run/begin', applicationKey: 'k', trigger: 'launcher', dryRun: false }, top());
    expect(await ask(worker)).toMatchObject({ ok: true, data: { password: SIGNUP_PASSWORD, press: true } });
    expect(await ask(worker, 'sign-in')).toMatchObject({ ok: true });
    await worker.deliver({ v: 1, type: 'signup/import' }, OPTIONS);
    await worker.deliver({ v: 1, type: 'signup/save', email: 'alex.r@example.org' }, OPTIONS);
    await worker.deliver({ v: 1, type: 'signup/delete' }, OPTIONS);

    const forms = [SIGNUP_PASSWORD, encodeURIComponent(SIGNUP_PASSWORD), btoa(SIGNUP_PASSWORD),
      JSON.stringify(SIGNUP_PASSWORD).slice(1, -1)];
    const logged = JSON.stringify(logs.mock.calls);
    expect(logs.mock.calls.length).toBeGreaterThan(5);
    for (const form of forms) expect(logged).not.toContain(form);
    const numbers = logs.mock.calls.flatMap((call) => Object.values((call[1] ?? {}) as Record<string, unknown>))
      .filter((value) => typeof value === 'number');
    expect(numbers).not.toContain(SIGNUP_PASSWORD.length);
    expect(worker.tailorit.requests.length).toBeGreaterThan(0);
    for (const request of worker.tailorit.requests) {
      // The address as sent and as read back (a query's form encoding: `!` as %21), its headers and its body.
      const sent = JSON.stringify([request.url, decodeURIComponent(request.url), request.headers, request.body]);
      for (const form of forms) expect(sent, request.path).not.toContain(form);
    }
    // And no message the worker sent a frame, nor anything stored, holds it.
    const told = JSON.stringify(sentToFrames(worker));
    for (const form of forms) expect(told).not.toContain(form);
    const stored = JSON.stringify([await fakeBrowser.storage.local.get(null), await fakeBrowser.storage.session.get(null)]);
    for (const form of forms) expect(stored).not.toContain(form);
  });
});

// ── The jr6 review ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A storage area in memory (createSignup's and the settings store's, on their own). */
function memoryArea(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => data.get(key),
    getMany: async (prefix) => Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix))),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

/** Sign-up Information's status, its `notice` among it when there is one. */
const statusData = async (worker: TestWorker) => ((await status(worker)) as { data: Record<string, unknown> }).data;

describe('the jr6 review: Sign-up Information', () => {
  it('R9: the email box starts with the TailorIT profile’s email, read for it once, not the account’s', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/profile', { json: profileWithEmail('elena.applies@example.org') });
    await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS);
    expect(await status(worker)).toMatchObject({ ok: true, data: { set: false, suggestedEmail: 'elena.applies@example.org' } });
    expect(await status(worker)).toMatchObject({ ok: true, data: { suggestedEmail: 'elena.applies@example.org' } });
    // One read of the profile: the worker's cache's after.
    expect(worker.tailorit.count('GET /api/autofill/profile')).toBe(1);
    // With one saved, its own email, and nothing read for it.
    await saveSignup(worker);
    expect(await status(worker)).toMatchObject({ ok: true, data: { set: true, email: SIGNUP_EMAIL, suggestedEmail: null } });
    expect(worker.tailorit.count('GET /api/autofill/profile')).toBe(1);
  });

  it('sec-9: a save of Auto that meets a delete on its way is set back to Manual at once', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    // The delete lands between settings/save's check and its write: the record goes as the settings are written.
    const local = fakeBrowser.storage.local;
    const write = local.set.bind(local);
    const writes = vi.spyOn(local, 'set').mockImplementation(async (items) => {
      const modes = (items as Record<string, { modes?: { signIn?: string } } | undefined>)['settings:v1']?.modes;
      if (modes?.signIn === 'auto') await local.remove(SIGNUP_RECORD_KEY);
      return write(items);
    });
    const saved = await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS);
    writes.mockRestore();
    expect(saved).toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'manual' } } } });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true,
      data: { settings: { modes: { signIn: 'manual' } } } });
    expect(await statusData(worker)).toMatchObject({ set: false, notice: 'reverted' });
  });

  it('sec-9: a sign-in that finds none saved under Auto sets Sign-in back to Manual, and the card says so', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    await worker.deliver({ v: 1, type: 'settings/save', settings: settingsWith('auto') }, OPTIONS);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, top());
    // Auto left with no password (a delete that met a save in another page).
    await fakeBrowser.storage.local.remove(SIGNUP_RECORD_KEY);
    expect(await ask(worker)).toEqual({ ok: false, error: 'not_found' });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true,
      data: { settings: { modes: { signIn: 'manual' } } } });
    expect(await statusData(worker)).toMatchObject({ notice: 'reverted' });
    expect(lastToFrames(worker)).toMatchObject({ modes: { signIn: 'manual' }, typeSignIn: false });
  });

  it('R12: Auto set back at start-up is said on the card until a password is saved', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), before: async () => {
      await fakeBrowser.storage.local.set({ 'settings:v1': settingsWith('auto') });
    } });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true,
      data: { settings: { modes: { signIn: 'manual' } } } });
    expect(await statusData(worker)).toMatchObject({ set: false, notice: 'reverted' });
    await saveSignup(worker);
    expect(await statusData(worker)).not.toHaveProperty('notice');
  });

  it('R12: a password that could no longer be read is said on the card, until another is saved', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    await worker.signupKey.clear();
    expect(await ask(worker)).toEqual({ ok: false, error: 'unavailable' });
    expect(await statusData(worker)).toMatchObject({ set: false, notice: 'gone' });
    await saveSignup(worker);
    expect(await statusData(worker)).not.toHaveProperty('notice');
    // The card's own Delete says it itself: no notice after it.
    await worker.deliver({ v: 1, type: 'signup/delete' }, OPTIONS);
    expect(await statusData(worker)).not.toHaveProperty('notice');
  });

  it('R13: setting Sign-in back to Manual keeps what another page saved meanwhile', async () => {
    const local = memoryArea();
    const store = createSettingsStore(local);
    await store.save(settingsWith('auto'));
    // Another page's save of the Next mode lands between keepModeHonest's read and its write.
    const settings = {
      get: async () => {
        const read = await store.get();
        await store.save({ ...read, modes: { ...read.modes, next: 'auto' } });
        return read;
      },
      save: (next: Parameters<typeof store.save>[0], base?: Parameters<typeof store.save>[1]) => store.save(next, base),
    };
    const signup = createSignup({ vault: { has: async () => false } as unknown as SignupVault, settings, local,
      server: { credential: async () => ({ ok: false, failure: 'unavailable' }) } as never,
      scopes: async () => [], suggestedEmail: async () => null, changed: async () => undefined });
    expect(await signup.keepModeHonest('startup')).toBe(true);
    expect((await store.get()).modes).toMatchObject({ signIn: 'manual', next: 'auto' });
  });

  it('sec-10: a subframe of another origin that says it claims the application is never answered', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    const WRAPPER = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1';
    const at = (url: string, frameId: number, documentId: string) => contentSender({ url, tab: { id: 21, url: WRAPPER },
      frameId, documentId });
    const hello = (sender: ReturnType<typeof at>, extra: Record<string, unknown>) =>
      worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender);
    await hello(at(WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
    // A tenant's frame on another iCIMS origin claims the wrapper's application: never the claim frame.
    const stranger = at(`https://careers-mallory.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1&in_iframe=1`,
      3, 'doc-stranger');
    await hello(stranger, { isTop: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'create-account' }, stranger))
      .toEqual({ ok: false, error: 'bad_sender' });
    // The wrapper's own origin's frame, alone in claiming it, is answered (Sign-in on Manual: to type, never pressed).
    const portal = at(`${WRAPPER}&in_iframe=1`, 4, 'doc-portal');
    await hello(portal, { isTop: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'create-account', typing: true }, portal))
      .toMatchObject({ ok: true, data: { password: SIGNUP_PASSWORD, press: false } });
  });
});

// ── jr6 ifix SEC-3 (the jr6 integration review's SEC-3) ──
describe('an email gate’s email with none saved in Sign-up Information: the profile’s, read as any Autofill reads it '
  + '(jr6 ifix SEC-3)', () => {
  const GATE = 'https://careers-acme.icims.com/jobs/1234/engineer/login';
  const PROFILE_EMAIL = profileGolden.profile.contact.email;
  /** The gate's ask, from the tab's top frame, as a run on Manual sends it (index.ts's real wiring answers it). */
  const askGate = (worker: TestWorker) => worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate',
    typing: true }, contentSender({ url: GATE, tab: { id: 31, url: GATE }, documentId: 'doc-gate' }));
  const profileReads = (worker: TestWorker) => worker.tailorit.count('GET /api/autofill/profile');

  it('with no profile in the worker’s memory, fetches it (GET /profile and its answers) and answers its contact email; '
    + 'held, asks again for nothing; after five idle minutes, fetches it again', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    expect(profileReads(worker)).toBe(0);
    logs.mockClear();
    expect(await askGate(worker)).toEqual({ ok: true, data: { host: '*', email: PROFILE_EMAIL, press: false } });
    expect([profileReads(worker), worker.tailorit.count('GET /api/autofill/answers')]).toEqual([1, 1]);
    // The reads name nothing of the gate: no address, no host, no body.
    const reads = worker.tailorit.requests.filter((request) => request.path.startsWith('/api/autofill/'));
    expect(reads.map((request) => [request.method, request.url.replace(/^https?:\/\/[^/]+/, ''), request.body]))
      .toEqual([['GET', '/api/autofill/profile', null], ['GET', '/api/autofill/answers', null]]);
    // Held now: the next gate reads nothing.
    expect(await askGate(worker)).toMatchObject({ ok: true, data: { email: PROFILE_EMAIL } });
    expect(profileReads(worker)).toBe(1);
    // Five idle minutes on, the worker holds none (profile-cache.ts PROFILE_IDLE_MS): fetched again.
    worker.timers.advance(PROFILE_IDLE_MS);
    expect(await askGate(worker)).toMatchObject({ ok: true, data: { email: PROFILE_EMAIL } });
    expect(profileReads(worker)).toBe(2);
    // The log says the profile's email was used, never the email.
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] signin.credential',
      { found: true, press: false, again: false, gate: true, profile: true }]);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(PROFILE_EMAIL);
  });

  it('with Sign-up Information saved, answers its email and reads no profile', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await saveSignup(worker);
    expect(await askGate(worker)).toEqual({ ok: true, data: { host: '*', email: SIGNUP_EMAIL, press: false } });
    expect(profileReads(worker)).toBe(0);
  });

  it('not connected: no profile is read from TailorIT, and the gate is the person’s', async () => {
    const worker = await startTestWorker();
    expect(await askGate(worker)).toEqual({ ok: false, error: 'unavailable' });
    expect(worker.tailorit.requests).toEqual([]);
  });
});
// ── end jr6 ifix SEC-3 ──
