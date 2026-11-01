/*
 * Pairing end to end (docs/ARCHITECTURE.md "Pairing"; docs/design/tailorit.md §2.3), each test in a browser of its
 * own, since the shared one is already paired. The options page's Connect opens the mock's stand-in connect page with
 * a single-use state; the person's click there mints a code and hands it to the extension through
 * externally_connectable; the worker redeems it with no cookie and no Authorization header, keeps the token in its
 * own IndexedDB and reads the session. The fallback: the code the page shows, typed on the options page. The token
 * never reaches a page, and a hand-off with any other state is refused.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { AUTOFILL_API_VERSION } from '../../src/contract/tailorit';
import { COPY } from '../../src/shared/copy';
import { expect, extensionIdIn, launchExtension, test } from '../fixtures.ts';
import { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { CONNECT_PAGE, connectOnPage, nextConnectPage, type PairingRecord } from '../helpers/pairing.ts';
import { installSpies, spyRecord } from '../helpers/spies.ts';
import { installRoutes, type RouteLog } from '../routes.ts';
import { example } from '../mock-server/mock.mjs';

const ACCOUNT = (example('AutofillSession') as { account: { name: string; email: string } }).account;
const ALL_SCOPES = (example('AutofillRedeemResponse') as { scopes: string[] }).scopes;
const NO_SENSITIVE = (example('AutofillRedeemResponse', 'without-sensitive') as { scopes: string[] }).scopes;

interface Fresh {
  context: BrowserContext;
  ext: Extension;
  options: Page;
  routes: RouteLog;
  close(): Promise<void>;
}

/** A browser of its own with the extension not yet connected, its options page open. */
async function freshExtension(extensionPath: string): Promise<Fresh> {
  const launched = await launchExtension(extensionPath);
  const routes = await installRoutes(launched.context);
  await installSpies(launched.context);
  const ext = new Extension(launched.context, await extensionIdIn(launched.context));
  const options = await launched.context.newPage();
  await options.goto(ext.url('options.html'));
  return { context: launched.context, ext, options, routes, close: launched.close };
}

/** The token record the worker keeps in its IndexedDB, read from an extension page (scopes and expiry, and whether a
 *  token is there). */
async function tokenRecord(page: Page): Promise<{ hasToken: boolean; scopes: string[]; expiresAt: number } | null> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('tailorit');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('secrets')) return resolve(null);
      const read = db.transaction('secrets').objectStore('secrets').get('auth');
      read.onsuccess = () => {
        const record = read.result as { token?: string; scopes?: string[]; expiresAt?: number } | undefined;
        resolve(record === undefined ? null : { hasToken: /^tia_/.test(record.token ?? ''), scopes: record.scopes ?? [],
          expiresAt: record.expiresAt ?? 0 });
      };
      read.onerror = () => reject(read.error);
    };
  }));
}

test.describe('pairing', () => {
  let fresh: Fresh;
  test.beforeEach(async ({ extensionPath, tailorit }) => {
    expect(tailorit).toBe(mock);
    fresh = await freshExtension(extensionPath);
  });
  test.afterEach(async () => {
    expect(fresh.routes.unexpected, 'requests no route answers').toEqual([]);
    await fresh.close();
  });

  test('through the stand-in connect page: Connect, the person’s click, and the hand-off', async () => {
    const { ext, options, context } = fresh;
    await expect(options.getByText(COPY.options.connection.disclosureHeading)).toBeVisible();
    const opened = nextConnectPage(context);
    await options.getByRole('button', { name: COPY.options.connection.connect }).click();
    const connect = await opened;
    const address = new URL(connect.url());
    expect(`${address.origin}${address.pathname}`).toBe(CONNECT_PAGE);
    expect(address.searchParams.get('tab')).toBe('extension');
    expect(address.searchParams.get('connect')).toBe('1');
    expect(address.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await ext.authStatus()).pairingExpiresAt).not.toBeNull();

    expect(await connectOnPage(connect)).toBe('connected');
    await expect(connect.getByRole('status')).toHaveText('Extension connected');
    expect((await connect.evaluate(() => (window as unknown as { __pairing: PairingRecord }).__pairing)).replies)
      .toEqual([{ ok: true, error: null }]);
    // The person comes back to the options page, which reads the connection again when it becomes visible or takes the
    // focus. Headless Chromium keeps every page visible and focused, so neither ever fires: the page is opened again,
    // which reads it on load.
    await options.reload();
    await expect(options.getByText(COPY.options.connection.connectedAs(ACCOUNT.name, ACCOUNT.email))).toBeVisible();
    expect(await ext.authStatus()).toMatchObject({ connection: 'connected', account: ACCOUNT, scopes: ALL_SCOPES,
      pairingExpiresAt: null, versionMismatch: false });
    expect(await tokenRecord(options)).toMatchObject({ hasToken: true, scopes: ALL_SCOPES });
    // The state was used once.
    expect((await ext.session()).pairing).toBeUndefined();

    // Redeemed with no cookie and no Authorization header, from the extension's own origin; then the session read
    // with the token.
    const [redeem] = await mock.requestsTo('POST /api/autofill/connect/redeem');
    expect(redeem).toBeDefined();
    expect(redeem!.headers.authorization).toBeUndefined();
    expect(redeem!.headers.cookie).toBeUndefined();
    expect([undefined, `chrome-extension://${ext.id}`]).toContain(redeem!.headers.origin);
    const [session] = await mock.requestsTo('GET /api/autofill/session');
    expect(session?.headers).toMatchObject({ authorization: 'REDACTED', 'x-tailorit-autofill-api': String(AUTOFILL_API_VERSION) });
    // The token never reached a page: not the connect page's DOM, messages or log, nor the options page's DOM.
    expect(await connect.content()).not.toContain('tia_');
    expect((await spyRecord(connect.mainFrame())).messages.filter((message) => message.includes('tia_'))).toEqual([]);
    expect(await options.content()).not.toContain('tia_');

    // Disconnect forgets the token at once and revokes it on TailorIT.
    await options.getByRole('button', { name: COPY.options.connection.disconnect }).click();
    await expect.poll(async () => (await ext.authStatus()).connection).toBe('not-connected');
    expect(await tokenRecord(options)).toBeNull();
    expect(await mock.requestsTo('DELETE /api/autofill/session')).toHaveLength(1);
  });

  test('a hand-off with another state is refused, and the pending pairing stays', async () => {
    const { ext, context } = fresh;
    // The page messages go from is open first, so the next page to open is the connect page.
    await ext.page();
    const opened = nextConnectPage(context);
    expect((await ext.send({ v: 1, type: 'auth/startPairing' })).ok).toBe(true);
    const genuine = await opened;
    const forged = await context.newPage();
    await forged.goto(`${CONNECT_PAGE}?tab=extension&state=${'A'.repeat(43)}`);
    expect(await connectOnPage(forged)).toBe('code-shown');
    expect((await forged.evaluate(() => (window as unknown as { __pairing: PairingRecord }).__pairing)).replies)
      .toEqual([{ ok: false, error: 'bad_sender' }]);
    expect(await ext.authStatus()).toMatchObject({ connection: 'not-connected' });
    expect((await ext.authStatus()).pairingExpiresAt).not.toBeNull();
    expect(await mock.requestsTo('POST /api/autofill/connect/redeem')).toEqual([]);
    // The genuine page still completes it.
    expect(await connectOnPage(genuine)).toBe('connected');
    expect((await ext.authStatus()).connection).toBe('connected');
  });

  test('through the code fallback: the code TailorIT shows, typed on the options page, with the sensitive box unticked', async () => {
    const { ext, options, context } = fresh;
    const page = await context.newPage();
    await page.goto(`${CONNECT_PAGE}?tab=extension`);
    expect(await connectOnPage(page, { includeSensitive: false })).toBe('code-shown');
    const code = ((await page.locator('#code').textContent()) ?? '').trim();
    expect(code).toMatch(/^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}$/);
    await options.bringToFront();
    await options.getByLabel(COPY.options.connection.codeLabel).fill(code);
    await options.getByRole('button', { name: COPY.options.connection.codeSubmit }).click();
    await expect(options.getByText(COPY.options.connection.connectedAs(ACCOUNT.name, ACCOUNT.email))).toBeVisible();
    expect(await ext.authStatus()).toMatchObject({ connection: 'connected', scopes: NO_SENSITIVE });
    await expect(options.getByText(COPY.options.connection.sensitiveNotShared)).toBeVisible();
    const [redeem] = await mock.requestsTo('POST /api/autofill/connect/redeem');
    expect((JSON.parse(redeem!.body) as { code: string }).code.replace(/-/g, '')).toBe(code.replace(/-/g, ''));
  });

  test('a code TailorIT does not know is refused with its reason', async () => {
    const { ext, options } = fresh;
    await options.getByLabel(COPY.options.connection.codeLabel).fill('K7QM-2XRD-9VHT-PA3C');
    await options.getByRole('button', { name: COPY.options.connection.codeSubmit }).click();
    await expect(options.getByText(COPY.options.connection.codeRefused)).toBeVisible();
    expect((await ext.authStatus()).connection).toBe('not-connected');
  });
});
