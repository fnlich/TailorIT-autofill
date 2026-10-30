/*
 * The extension under test: Playwright's bundled Chromium (branded Chrome and Edge no longer side-load extensions from
 * the command line) in a persistent, headless context with the built extension loaded. Every request is routed
 * (routes.ts), so nothing leaves the machine. Tests only read the extension's data, through its own pages.
 * - One context per Playwright worker, with its console recorded from the start (helpers/console.ts).
 * - Each test: its routes and the page spies; the strict-mode check that nothing unrouted was requested and nothing
 *   submitted; the pages it opened closed afterwards.
 * - `tailorit` resets the mock (e2e build only: its TailorIT origin is the mock); `connected` makes sure the extension
 *   is paired with it, through the real hand-off, pairing again only when an earlier test left it disconnected.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { ConsoleLog, type ConsoleEntry } from './helpers/console.ts';
import { Extension } from './helpers/extension.ts';
import { mock } from './helpers/mock.ts';
import { ensureConnected } from './helpers/pairing.ts';
import { installSpies } from './helpers/spies.ts';
import { installRoutes, type RouteLog } from './routes.ts';

export interface ExtensionOptions {
  extensionPath: string;
  build: 'e2e' | 'production';
}

interface WorkerFixtures extends ExtensionOptions {
  extContext: BrowserContext;
  extensionId: string;
  consoleLog: ConsoleLog;
}

interface TestFixtures {
  worker: Worker;
  routeLog: RouteLog;
  /** This test's console messages so far: pages, content scripts, the worker and extension pages. */
  logs: () => ConsoleEntry[];
  /** The extension's own pages, for page messages and reading its data. */
  ext: Extension;
  /** The TailorIT mock, reset for this test. */
  tailorit: typeof mock;
  /** The extension, paired with the mock. */
  connected: Extension;
  /** Closes the pages a test opened (the context outlives it). */
  closePages: void;
}

/** A browser of its own with the built extension loaded, in a fresh profile; close() removes the profile. */
export async function launchExtension(extensionPath: string): Promise<{ context: BrowserContext; close(): Promise<void> }> {
  const dir = resolve(extensionPath);
  const profile = mkdtempSync(join(tmpdir(), 'tailorit-autofill-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  return {
    context,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** The extension's id in a context: its service worker's host. */
export async function extensionIdIn(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionPath: ['.output-e2e/chrome-mv3', { option: true, scope: 'worker' }],
  build: ['e2e', { option: true, scope: 'worker' }],
  extContext: [
    async ({ extensionPath }, use) => {
      const launched = await launchExtension(extensionPath);
      await use(launched.context);
      await launched.close();
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ extContext }, use) => {
      await use(await extensionIdIn(extContext));
    },
    { scope: 'worker' },
  ],
  consoleLog: [
    async ({ extContext }, use) => {
      await use(await ConsoleLog.install(extContext));
    },
    { scope: 'worker' },
  ],
  // Automatic: no test may ever reach the network, whether or not it looks at the log.
  routeLog: [
    async ({ extContext }, use) => {
      const log = await installRoutes(extContext);
      await installSpies(extContext);
      await use(log);
      await extContext.unrouteAll({ behavior: 'ignoreErrors' });
      expect(log.unexpected, 'requests no route answers (strict mode)').toEqual([]);
      expect(log.submitted, 'form submissions').toEqual([]);
    },
    { auto: true },
  ],
  closePages: [
    async ({ extContext }, use) => {
      const before = new Set(extContext.pages());
      await use();
      await Promise.all(extContext.pages().filter((page) => !before.has(page)).map((page) => page.close().catch(() => undefined)));
    },
    { auto: true },
  ],
  logs: async ({ consoleLog }, use) => {
    const mark = consoleLog.mark();
    await use(() => consoleLog.since(mark));
  },
  worker: async ({ extContext, extensionId }, use) => {
    const current = () => extContext.serviceWorkers().find((w) => new URL(w.url()).host === extensionId);
    const worker = current() ?? (await extContext.waitForEvent('serviceworker'));
    await use(worker);
  },
  ext: async ({ extContext, extensionId }, use) => {
    const ext = new Extension(extContext, extensionId);
    await use(ext);
    await ext.close();
  },
  tailorit: async ({ build }, use) => {
    if (build !== 'e2e') throw new Error('only the e2e build has the mock as its TailorIT');
    await mock.reset();
    await use(mock);
  },
  connected: async ({ ext, tailorit }, use) => {
    expect(tailorit).toBe(mock);
    await ensureConnected(ext);
    await use(ext);
  },
});

export { expect } from '@playwright/test';

/** Every entry the worker holds in storage.session (frames, reports, test events). */
export async function sessionStorage(worker: Worker): Promise<Record<string, unknown>> {
  return worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { get(keys: null): Promise<Record<string, unknown>> } } } }).chrome.storage.session.get(null),
  );
}
