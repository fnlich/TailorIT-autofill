/*
 * Pairing the extension with the TailorIT mock, the way a person pairs it with TailorIT (docs/ARCHITECTURE.md
 * "Pairing"): the extension opens the connect page with its single-use state, the person clicks "Connect the
 * extension", and the page hands the code to the extension through externally_connectable. Behaviour specs share one
 * pairing per browser (the token outlives tests in IndexedDB) and pair again only when a test left the extension
 * disconnected; the pairing spec drives the options page itself, the code fallback included. Without a state in its
 * address the stand-in page shows the code instead (the fallback).
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_ORIGIN } from '../routes';
import type { Extension } from './extension';

/** The stand-in connect page's address (e2e/mock-server/connect-page.html). */
export const CONNECT_PAGE = `${MOCK_ORIGIN}/settings/autofill`;
/** The stand-in page's button and its sensitive box, in TailorIT's words (its sign-in box, API version 3, is left
 *  unticked). */
export const CONNECT_BUTTON = 'Connect the extension';
export const SENSITIVE_BOX = 'Let this browser read and change work authorization and self-identification answers';
/** The stand-in page's sign-in box (API version 3): ticked, the code grants credentials:read (v3 Phase 5's Sign-in
 *  Auto specs tick it). */
export const SIGN_IN_BOX = 'Let this browser sign in to job sites with my saved password';

/** What the stand-in page recorded: the extension's replies (value-free). */
export interface PairingRecord {
  replies: Array<{ ok: boolean; error: string | null } | null>;
}

/** Where the stand-in page got to: connected (hand-off), code-shown (fallback) or failed. */
export async function pairingState(page: Page): Promise<string | null> {
  return page.locator('html').getAttribute('data-pairing');
}

/** Waits for the connect page a pairing opened, and answers it once it has loaded. */
export async function nextConnectPage(context: BrowserContext): Promise<Page> {
  const page = await context.waitForEvent('page');
  await page.waitForURL((url) => url.href.startsWith(CONNECT_PAGE));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Clicks "Connect the extension" on a stand-in connect page (with the sensitive box as asked) and waits for the
 *  outcome. */
export async function connectOnPage(page: Page, options: { includeSensitive?: boolean; allowSignIn?: boolean } = {}):
  Promise<string> {
  const box = page.getByRole('checkbox', { name: SENSITIVE_BOX });
  if (options.includeSensitive === false) await box.uncheck();
  if (options.allowSignIn === true) await page.getByRole('checkbox', { name: SIGN_IN_BOX }).check();
  await page.getByRole('button', { name: CONNECT_BUTTON }).click();
  await expect(page.locator('html')).toHaveAttribute('data-pairing', /^(?:connected|code-shown|failed)$/);
  return (await pairingState(page))!;
}

/** Pairs through the hand-off: auth/startPairing (what the options page's Connect sends), then the person's click on
 *  the connect page it opens. Answers the connect page, left open. */
export async function pairThroughConnectPage(ext: Extension, options: { includeSensitive?: boolean; allowSignIn?: boolean } = {}):
  Promise<Page> {
  // The page messages go from is open first, so the next page to open is the connect page.
  await ext.page();
  const opened = nextConnectPage(ext.context);
  const started = await ext.send<{ expiresAt: number }>({ v: 1, type: 'auth/startPairing' });
  expect(started.ok, 'auth/startPairing was refused').toBe(true);
  const page = await opened;
  expect(await connectOnPage(page, options)).toBe('connected');
  return page;
}

/** Makes sure the extension is paired with the mock, pairing through the connect page when it is not. */
export async function ensureConnected(ext: Extension): Promise<void> {
  if ((await ext.authStatus()).connection === 'connected') return;
  const page = await pairThroughConnectPage(ext);
  await page.close();
  await expect.poll(async () => (await ext.authStatus()).connection).toBe('connected');
}
