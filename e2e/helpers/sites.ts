/*
 * v3 Phase 8's browser: the e2e build with its optional host permission already held, as after the person turned
 * "Company career sites" on in Options. Chrome asks for an optional host permission in a dialog of its own, which no
 * automation can answer (a headless request never resolves), so the profile is seeded instead: the extension is loaded
 * once from a copy whose manifest asks for https://*\/* as a required host (Chrome grants an unpacked extension's
 * required hosts at load, and keeps them in the profile under the extension's id, which its fixed key makes the same),
 * then the real e2e build is loaded in that profile, where https://*\/* stays granted as its optional one. Turning a
 * place on in Options then asks Chrome for nothing new, so the request resolves at once on the test's click, as it does
 * for a person who granted it before. Nothing else differs from fixtures.ts's launch.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { noNetwork } from '../fixtures.ts';

/** A browser with the built extension loaded and its optional host permissions granted; close() removes its folders. */
export async function launchWithSites(extensionPath: string, build: 'e2e' | 'production'):
  Promise<{ context: BrowserContext; close(): Promise<void> }> {
  const dir = resolve(extensionPath);
  const seed = mkdtempSync(join(tmpdir(), 'tailorit-autofill-seed-'));
  cpSync(dir, seed, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(seed, 'manifest.json'), 'utf8')) as Record<string, string[]>;
  manifest.host_permissions = [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
  writeFileSync(join(seed, 'manifest.json'), JSON.stringify(manifest));
  const profile = mkdtempSync(join(tmpdir(), 'tailorit-autofill-e2e-'));
  const launch = (extension: string) => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...noNetwork(build)] });
  const first = await launch(seed);
  if (first.serviceWorkers().length === 0) await first.waitForEvent('serviceworker');
  await first.close();
  const context = await launch(dir);
  return {
    context,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
      rmSync(seed, { recursive: true, force: true });
    },
  };
}

/** What the extension runs in the top frame's own worlds (the isolated worlds Chrome names by the extension's origin;
 *  never the page's, nor Playwright's own utility world): each world's listeners on the document and the window, as
 *  DevTools lists them. No world: nothing of the extension runs in the frame. */
export async function extensionWorlds(page: Page): Promise<string[][]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const contexts: Array<{ id: number; origin: string; auxData?: { frameId?: string } }> = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    await cdp.send('Runtime.enable');
    const top = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    const worlds: string[][] = [];
    for (const context of contexts.filter((each) => each.auxData?.frameId === top && each.origin.startsWith('chrome-extension://'))) {
      const types: string[] = [];
      for (const expression of ['document', 'window']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression, contextId: context.id });
        if (result.objectId === undefined) continue;
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        types.push(...listeners.map((listener) => listener.type));
      }
      worlds.push(types.sort());
    }
    return worlds;
  } finally {
    await cdp.detach();
  }
}

/** Whether the page-world bridge answers a well-formed command on the frame's document (it acknowledges any): a
 *  frame where it is installed does, any other does not. */
export async function bridgeAnswers(frame: Pick<Page, 'evaluate'>): Promise<boolean> {
  return frame.evaluate(() => {
    let answered = false;
    const listen = () => {
      answered = true;
    };
    document.addEventListener('tailorit:bridge-result', listen, true);
    document.body.dispatchEvent(new CustomEvent('tailorit:bridge', { bubbles: true, composed: true,
      detail: JSON.stringify({ v: 1, id: 'probe-0001', op: 'react.field' }) }));
    document.removeEventListener('tailorit:bridge-result', listen, true);
    return answered;
  });
}
