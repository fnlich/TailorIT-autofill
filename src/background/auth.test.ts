import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { AUTOFILL_API_VERSION } from '../contract/tailorit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { PAIRING_TTL_MS } from './auth';
import {
  connectPageSender,
  contentSender,
  GOLDEN_TOKEN,
  goldens,
  LEVER_KEY,
  ORIGIN,
  pageSender,
  startTestWorker,
  tokenRecord,
  type TestWorker,
} from './worker.testkit';

const CODE = 'K7QM-2XRD-9VHT-PA3C';

/** Starts pairing from the options page and answers the state the worker opened TailorIT's page with. */
async function startPairing(worker: TestWorker): Promise<{ state: string; answer: unknown }> {
  const answer = await worker.deliver({ v: 1, type: 'auth/startPairing' }, pageSender('options.html'));
  const tabs = await fakeBrowser.tabs.query({});
  const opened = tabs.map((tab) => tab.url).filter((url) => url?.startsWith(ORIGIN)).at(-1);
  const state = new URL(opened!).searchParams.get('state')!;
  return { state, answer };
}

const pair = (worker: TestWorker, state: string, sender = connectPageSender()) =>
  worker.deliverExternal({ v: 1, type: 'pair/complete', state, code: CODE }, sender);

/** Everything the extension stored, as text. */
async function storageDump(worker: TestWorker): Promise<string> {
  return JSON.stringify([await fakeBrowser.storage.local.get(null), await fakeBrowser.storage.session.get(null), worker.fakes.tabMessages]);
}

describe('pairing', () => {
  it('opens TailorIT\'s connect page with a single-use state of 32 random bytes, kept 10 minutes', async () => {
    const worker = await startTestWorker();
    const { state, answer } = await startPairing(worker);
    expect(answer).toEqual({ ok: true, data: { expiresAt: worker.clock.now + PAIRING_TTL_MS } });
    expect(PAIRING_TTL_MS).toBe(10 * 60 * 1000);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const tabs = await fakeBrowser.tabs.query({});
    expect(tabs.map((tab) => tab.url)).toContain(`${ORIGIN}/settings/autofill?tab=extension&connect=1&state=${state}`);
    expect(await fakeBrowser.storage.session.get('pairing')).toEqual({ pairing: { state, expiresAt: worker.clock.now + PAIRING_TTL_MS } });
    // The state goes to TailorIT's page in its address, never back to the extension page that asked.
    expect(JSON.stringify(answer)).not.toContain(state);
    // Starting again replaces the pending state: only the newest page can complete.
    const second = await startPairing(worker);
    expect(second.state).not.toBe(state);
    expect(await pair(worker, state)).toEqual({ ok: false, error: 'bad_sender' });
    expect(await pair(worker, second.state)).toEqual({ ok: true, data: {} });
  });

  it('completes from TailorIT\'s page: redeems with no token, stores the token, reads the session, answers ok', async () => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    const answer = await pair(worker, state);
    expect(answer).toEqual({ ok: true, data: {} });
    expect(worker.tailorit.requests.map((request) => `${request.method} ${request.path}`))
      .toEqual(['POST /api/autofill/connect/redeem', 'GET /api/autofill/session']);
    const [redeem, session] = worker.tailorit.requests;
    expect(redeem!.headers.authorization).toBeUndefined();
    expect(redeem!.init.credentials).toBe('omit');
    expect(JSON.parse(redeem!.body!)).toEqual({ code: 'K7QM2XRD9VHTPA3C', client: { browser: 'other', extensionVersion: '0.0.0', os: 'windows' } });
    expect(session!.headers.authorization).toBe(`Bearer ${GOLDEN_TOKEN}`);
    expect(worker.secrets.value).toEqual(tokenRecord());
    expect(await fakeBrowser.storage.session.get('pairing')).toEqual({});
    const status = await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html'));
    expect(status).toMatchObject({ ok: true, data: { connection: 'connected', account: goldens.session.account, pairingExpiresAt: null } });
  });

  it.each([
    ['another port', { origin: 'http://localhost:3101', url: 'http://localhost:3101/settings/autofill' }],
    ['another scheme', { origin: 'https://localhost:3100', url: 'https://localhost:3100/settings/autofill' }],
    ['another page of TailorIT', { url: `${ORIGIN}/settings/profile?state=x` }],
    ['a look-alike path', { url: `${ORIGIN}/settings/autofillx` }],
    ['no origin at all', { origin: undefined }],
    ['an address that disagrees with its origin', { url: 'https://evil.example/settings/autofill' }],
  ])('refuses pair/complete from %s, and redeems nothing', async (_name, overrides) => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    expect(await pair(worker, state, connectPageSender(overrides))).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.tailorit.requests).toHaveLength(0);
    // The pending state is still there for TailorIT's real page.
    expect(await pair(worker, state)).toEqual({ ok: true, data: {} });
  });

  it('refuses a state that is not the pending one, and keeps the pending one', async () => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    const forged = `${state.slice(0, 42)}${state.endsWith('A') ? 'B' : 'A'}`;
    expect(await pair(worker, forged)).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.tailorit.requests).toHaveLength(0);
    expect(await pair(worker, state)).toEqual({ ok: true, data: {} });
  });

  it('refuses pair/complete when no pairing is pending', async () => {
    const worker = await startTestWorker();
    expect(await pair(worker, 'A'.repeat(43))).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it('uses a state once, even when the redeem fails', async () => {
    const worker = await startTestWorker();
    worker.tailorit.reply('POST /api/autofill/connect/redeem', { status: 401, json: { error: { code: 'not_signed_in', message: 'x' } } },
      { once: true });
    const { state } = await startPairing(worker);
    expect(await pair(worker, state)).toEqual({ ok: false, error: 'expired' });
    expect(await pair(worker, state)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/connect/redeem')).toBe(1);
    expect(worker.secrets.value).toBeUndefined();
  });

  it('lets only one of two pair/complete messages that arrive together take the state', async () => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    const answers = await Promise.all([pair(worker, state), pair(worker, state)]);
    expect(answers).toContainEqual({ ok: true, data: {} });
    expect(answers).toContainEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/connect/redeem')).toBe(1);
  });

  it('lets a pairing lapse after 10 minutes', async () => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    worker.clock.now += PAIRING_TTL_MS;
    expect(await pair(worker, state)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it('accepts pair/complete only on the external channel', async () => {
    const worker = await startTestWorker();
    const { state } = await startPairing(worker);
    const message = { v: 1, type: 'pair/complete', state, code: CODE };
    expect(await worker.deliver(message, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver(message, pageSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it('puts the token in no answer, no storage area and no message to a frame', async () => {
    const worker = await startTestWorker();
    const answers: unknown[] = [];
    const { state, answer } = await startPairing(worker);
    answers.push(answer, await pair(worker, state));
    answers.push(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html')));
    answers.push(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()));
    answers.push(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      contentSender()));
    answers.push(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: CODE }, pageSender('options.html')));
    answers.push(await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html')));
    expect((answers[4] as { ok: boolean }).ok).toBe(true);
    const seen = `${JSON.stringify(answers)}${await storageDump(worker)}`;
    expect(seen).not.toContain(GOLDEN_TOKEN);
    expect(seen).not.toContain('tia_');
  });
});

describe('the connect-code fallback (auth/redeemCode)', () => {
  it('redeems a typed code, as the person typed it, and answers the connection', async () => {
    const worker = await startTestWorker();
    const answer = await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'k7qm 2xrd 9vht pa3c' }, pageSender('options.html'));
    expect(answer).toMatchObject({ ok: true, data: { connection: 'connected', account: goldens.session.account,
      scopes: goldens.redeem.scopes, expiresAt: Date.parse(goldens.redeem.expiresAt) } });
    expect(JSON.parse(worker.tailorit.requests[0]!.body!).code).toBe('K7QM2XRD9VHTPA3C');
  });

  it('refuses what cannot be a code without asking TailorIT', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'UUUU-UUUU-UUUU-UUUU' }, pageSender('options.html')))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it.each([
    [401, { error: { code: 'not_signed_in', message: 'x' } }, { ok: false, error: 'expired' }],
    [429, { error: { code: 'rate_limited', message: 'x', retryAfterSeconds: 40 } }, { ok: false, error: 'rate_limited', retryAfterSeconds: 40 }],
    [400, { error: { code: 'validation_failed', message: 'x' } }, { ok: false, error: 'bad_message' }],
    [503, { error: { code: 'unavailable', message: 'x' } }, { ok: false, error: 'unavailable' }],
  ])('maps a %s from redeem', async (status, json, expected) => {
    const worker = await startTestWorker();
    worker.tailorit.reply('POST /api/autofill/connect/redeem', { status, json });
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: CODE }, pageSender('options.html'))).toEqual(expected);
    expect(worker.secrets.value).toBeUndefined();
  });

  it('refuses auth messages from a content script', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: CODE }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, contentSender({ frameId: 2, documentId: 'doc-2' }))).toEqual({ ok: false, error: 'bad_sender' });
    // v5 p1-shell: the code is the settings page's alone, never the sidebar's, even from the top frame.
    expect(await worker.deliver({ v: 1, type: 'auth/disconnect' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
  });
});

describe('the connection', () => {
  it('disconnects: revokes on TailorIT (best effort) and forgets the token', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const answer = await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    expect(answer).toMatchObject({ ok: true, data: { connection: 'not-connected', account: null, scopes: [], expiresAt: null } });
    const revoke = worker.tailorit.requests.find((request) => request.method === 'DELETE');
    expect(revoke).toMatchObject({ path: '/api/autofill/session', headers: { authorization: `Bearer ${GOLDEN_TOKEN}` } });
    expect(worker.secrets.value).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      contentSender())).toEqual({ ok: false, error: 'not_connected' });
  });

  it('forgets the token even when TailorIT cannot be reached to revoke it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('DELETE /api/autofill/session', { fail: 'network' });
    expect(await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html')))
      .toMatchObject({ ok: true, data: { connection: 'not-connected' } });
    expect(worker.secrets.value).toBeUndefined();
  });

  it('drops the token when TailorIT answers 401, and says it was revoked', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/session', { status: 401, json: { error: { code: 'not_signed_in', message: 'x' } } });
    const answer = await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html'));
    expect(answer).toMatchObject({ ok: true, data: { connection: 'revoked', account: null } });
    expect(worker.secrets.value).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()))
      .toMatchObject({ ok: true, data: { connected: false } });
  });

  it('treats a stored token past its expiry as gone', async () => {
    const worker = await startTestWorker({ token: tokenRecord({ expiresAt: Date.UTC(2026, 0, 1) }) });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html')))
      .toMatchObject({ ok: true, data: { connection: 'expired' } });
    expect(worker.secrets.value).toBeUndefined();
    expect(worker.tailorit.requests).toHaveLength(0);
  });

  it('treats an unreadable stored record as no token', async () => {
    const worker = await startTestWorker({ token: { ...tokenRecord(), token: 'not-a-token' } });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html')))
      .toMatchObject({ ok: true, data: { connection: 'not-connected' } });
    expect(worker.secrets.value).toBeUndefined();
  });

  it('reports the storage access, the version and the pending pairing', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/session', { status: 409, json: { error: { code: 'conflict', message: 'x' } },
      headers: { 'X-TailorIT-Autofill-Api': String(AUTOFILL_API_VERSION + 1) } });
    await worker.deliver({ v: 1, type: 'auth/startPairing' }, pageSender('options.html'));
    const answer = await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html'));
    expect(answer).toEqual({
      ok: true,
      data: {
        connection: 'connected',
        account: null,
        scopes: goldens.redeem.scopes,
        expiresAt: Date.parse(goldens.redeem.expiresAt),
        storageAccess: 'restricted',
        versionMismatch: true,
        pairingExpiresAt: worker.clock.now + PAIRING_TTL_MS,
        disclosure: 'current',
        // jr6: whether a job-site password is saved in this browser (a word, never the password).
        signUp: 'not-set',
      },
    });
  });

  it('says when the disclosure changed since the person connected, and keeps what it governs off until I understand (the v3 Phase 4 review)', async () => {
    // A connection made before the disclosure's version was kept: it read version 1.
    const worker = await startTestWorker({ token: tokenRecord(), disclosure: null, lookupOnLoad: true });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender())).toMatchObject({ ok: true,
      data: { connection: 'connected', disclosure: 'changed' } });
    // Submit mode Auto is held Manual in what a frame is told, and a form is not looked up as it loads.
    const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
    await worker.deliver({ v: 1, type: 'settings/save', settings: auto }, pageSender('options.html'));
    const hello = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()) as {
      data: { settings: { modes: { submit: string } } } };
    expect(hello.data.settings.modes.submit).toBe('manual');
    await Promise.resolve();
    expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(0);
    // I understand: it is kept, and Submit mode acts as chosen.
    expect(await worker.deliver({ v: 1, type: 'auth/acknowledgeDisclosure' }, pageSender())).toMatchObject({ ok: true,
      data: { disclosure: 'current' } });
    const again = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true },
      contentSender({ documentId: 'doc-2' })) as { data: { settings: { modes: { submit: string } } } };
    expect(again.data.settings.modes.submit).toBe('auto');
    // A content script may not acknowledge it.
    expect(await worker.deliver({ v: 1, type: 'auth/acknowledgeDisclosure' }, contentSender({ frameId: 2, documentId: 'doc-2' }))).toMatchObject({ ok: false });
  });

  it('keeps the disclosure acknowledged when the person connects: pairing shows it', async () => {
    const worker = await startTestWorker({ disclosure: null });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender())).toMatchObject({ ok: true,
      data: { connection: 'not-connected' } });
    expect(((await worker.deliver({ v: 1, type: 'auth/status' }, pageSender())) as { data: object }).data)
      .not.toHaveProperty('disclosure');
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: CODE }, pageSender('options.html')))
      .toMatchObject({ ok: true, data: { connection: 'connected', disclosure: 'current' } });
  });

  it('reports storage access refused, and refuses to fill', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), before: (fakes) => fakes.refuseAccessLevel(true) });
    expect(await worker.deliver({ v: 1, type: 'auth/status' }, pageSender('options.html')))
      .toMatchObject({ ok: true, data: { storageAccess: 'refused' } });
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      contentSender())).toEqual({ ok: false, error: 'unavailable' });
  });

  it('replaces an older connection on a new pairing, revoking the older token', async () => {
    const older = tokenRecord({ token: `tia_${'Z'.repeat(43)}`, tokenId: 'older' });
    const worker = await startTestWorker({ token: older });
    const { state } = await startPairing(worker);
    expect(await pair(worker, state)).toEqual({ ok: true, data: {} });
    expect(worker.secrets.value).toEqual(tokenRecord());
    const revoke = worker.tailorit.requests.find((request) => request.method === 'DELETE');
    expect(revoke?.headers.authorization).toBe(`Bearer ${older.token}`);
  });
});
