/*
 * The extension under test: Playwright's bundled Chromium (branded Chrome and Edge no longer side-load extensions from
 * the command line) in a persistent, headless context with the built extension loaded. Every request is routed
 * (routes.ts), so nothing leaves the machine. Tests only read the extension's data, through its worker.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { installRoutes, type RouteLog } from './routes.ts';
import { installSpies } from './helpers/spies.ts';

export interface ExtensionOptions {
  extensionPath: string;
  build: 'e2e' | 'production';
}

interface WorkerFixtures extends ExtensionOptions {
  extContext: BrowserContext;
  extensionId: string;
}

interface TestFixtures {
  worker: Worker;
  routeLog: RouteLog;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionPath: ['.output-e2e/chrome-mv3', { option: true, scope: 'worker' }],
  build: ['e2e', { option: true, scope: 'worker' }],
  extContext: [
    async ({ extensionPath }, use) => {
      const dir = resolve(extensionPath);
      const profile = mkdtempSync(join(tmpdir(), 'tailorit-autofill-e2e-'));
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
      });
      await use(context);
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ extContext }, use) => {
      const worker = extContext.serviceWorkers()[0] ?? (await extContext.waitForEvent('serviceworker'));
      await use(new URL(worker.url()).host);
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
    },
    { auto: true },
  ],
  worker: async ({ extContext, extensionId }, use) => {
    const current = () => extContext.serviceWorkers().find((w) => new URL(w.url()).host === extensionId);
    const worker = current() ?? (await extContext.waitForEvent('serviceworker'));
    await use(worker);
  },
});

export { expect } from '@playwright/test';

/** Every entry the worker holds in storage.session (frames, reports, test events). */
export async function sessionStorage(worker: Worker): Promise<Record<string, unknown>> {
  return worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { get(keys: null): Promise<Record<string, unknown>> } } } }).chrome.storage.session.get(null),
  );
}
