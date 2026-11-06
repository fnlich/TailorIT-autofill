/*
 * Phase 0's smoke suite: the extension loads, its worker starts with the fixed id, the content script injects on every
 * ATS host served at its real address (an embedded form's frame included, its company page not), the panel renders,
 * the worker reaches the mock, content scripts are refused storage.local, nothing announces the extension to the page
 * (and at a page that shows no posting, nothing of it reaches the page at all, not even a listener keyed to its id), and
 * the worker comes back after being stopped. Runs on the e2e build and on the production build.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page, Worker } from '@playwright/test';
import { expect, sessionStorage, test } from '../fixtures.ts';
import { spyRecord } from '../helpers/spies.ts';
import { readSession, stopWorker } from '../helpers/stop-worker.ts';
import { MOCK_ORIGIN, SMOKE_ROUTES } from '../routes.ts';

interface FrameEntry {
  tabId: number;
  frameId: number;
  origin: string;
  platform: string | null;
  isTop: boolean;
  hasForm: boolean;
  registeredAt: number;
}

/** The id Chrome derives from the committed public key: the first 32 hex digits of its SHA-256, mapped 0-f to a-p. */
function idFromKey(): string {
  const der = Buffer.from(readFileSync('keys/manifest-key.txt', 'utf8').trim(), 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

async function frames(worker: Worker): Promise<FrameEntry[]> {
  const stored = await sessionStorage(worker);
  return Object.entries(stored).filter(([key]) => key.startsWith('frames:')).map(([, value]) => value as FrameEntry);
}

const ATS_PAGES = Object.keys(SMOKE_ROUTES).filter((url) => !/tailorit-fixture\.example|example\.com|embed\/job_app/.test(url));

/** The types of every listener on the top document and its window, in every world of the top frame (the page's own and
 *  each isolated one, the content script's included: the debugger lists a world's own listeners only), sorted. */
async function listenerTypes(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const contexts: Array<{ id: number; auxData?: { frameId?: string } }> = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    // Enabling reports every context that exists already.
    await cdp.send('Runtime.enable');
    const top = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    const types: string[] = [];
    for (const context of contexts.filter((each) => each.auxData?.frameId === top)) {
      for (const expression of ['document', 'window']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression, contextId: context.id });
        if (result.objectId === undefined) continue;
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        types.push(...listeners.map((listener) => listener.type));
      }
    }
    return types.sort();
  } finally {
    await cdp.detach();
  }
}

test.describe('smoke', () => {
  test('the worker starts with the id the manifest key fixes', async ({ extensionId }) => {
    expect(extensionId).toBe(idFromKey());
  });

  test('the content script injects on every ATS host served at its real address', async ({ extContext, worker, routeLog }) => {
    for (const url of ATS_PAGES) {
      const page = await extContext.newPage();
      await page.goto(url);
      const origin = new URL(url).origin;
      await expect
        .poll(async () => (await frames(worker)).some((frame) => frame.origin === origin && frame.isTop && frame.hasForm), { message: url })
        .toBe(true);
      await page.close();
    }
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test("an embedded Greenhouse form registers its own frame, and the company page does not", async ({ extContext, worker }) => {
    const page = await extContext.newPage();
    await page.goto('https://careers.tailorit-fixture.example/jobs/1');
    await expect
      .poll(async () => (await frames(worker)).some((f) => f.origin === 'https://job-boards.greenhouse.io' && f.frameId > 0 && !f.isTop))
      .toBe(true);
    expect((await frames(worker)).some((f) => f.origin.includes('tailorit-fixture.example'))).toBe(false);
    await page.close();
  });

  test('a host outside the list gets no content script', async ({ extContext, worker }) => {
    const outside = await extContext.newPage();
    await outside.goto('https://example.com/');
    // A matched page registered after it proves the worker has handled every frame that announced itself.
    const matched = await extContext.newPage();
    await matched.goto(ATS_PAGES[0]!);
    await expect.poll(async () => (await frames(worker)).some((f) => f.origin === new URL(ATS_PAGES[0]!).origin)).toBe(true);
    expect((await frames(worker)).some((f) => f.origin === 'https://example.com')).toBe(false);
    await outside.close();
    await matched.close();
  });

  test('the panel page renders as a normal tab', async ({ extContext, extensionId }) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=1`);
    // v3 Phase 3 (Jobright's layout): the brand heads it; the review shows once a run reports.
    await expect(page.getByRole('heading', { name: 'TailorIT Autofill', level: 1 })).toBeVisible();
    await page.close();
  });

  test('nothing announces the extension or its id to the page', async ({ extContext, extensionId, worker }) => {
    const startedAt = Date.now();
    const page = await extContext.newPage();
    await page.goto(ATS_PAGES[0]!);
    // The content script has run once its hello has registered the frame.
    const origin = new URL(ATS_PAGES[0]!).origin;
    await expect.poll(async () => (await frames(worker)).some((f) => f.origin === origin && f.registeredAt >= startedAt)).toBe(true);
    const record = await spyRecord(page.mainFrame());
    expect(record.messages.filter((data) => data.includes(extensionId))).toEqual([]);
    await page.close();
  });

  test('at a page that shows no posting, nothing of the extension reaches the page: no event, message or DOM change',
    async ({ extContext, extensionId, ext, routeLog, build }) => {
      test.skip(build !== 'e2e', "the content script's settled probe is compiled into the e2e build only");
      // The v3 Phase 6/7b review's round 2 (E1): an employer's own pages on an ATS domain, and a board. The page's own
      // spy listens from before any script for WXT's started event (the old content-script context's announcement,
      // which a page could listen for since the id is fixed), the bridge's command, window messages and, once the
      // page is parsed, every change to its DOM.
      const pages = ['https://internal-acme.icims.com/jobs/1/engineer/job', 'https://performancemanager4.successfactors.com/sf/home',
        'https://jobs.lever.co/acme'];
      routeLog.serve(Object.fromEntries(pages.map((url) => [url, 'fixtures/smoke/form.html'])));
      for (const url of pages) {
        const page = await extContext.newPage();
        await page.addInitScript((id) => {
          const seen: string[] = [];
          (window as unknown as { __seen: string[] }).__seen = seen;
          for (const entry of ['content', 'content-script']) {
            document.addEventListener(`${id}:${entry}:wxt:content-script-started`, () => seen.push(`event:${entry}`), true);
          }
          document.addEventListener('tailorit:bridge', () => seen.push('event:bridge'), true);
          window.addEventListener('message', () => seen.push('message'));
          document.addEventListener('DOMContentLoaded', () => new MutationObserver((records) => {
            for (const record of records) seen.push(`mutation:${record.type}:${record.target.nodeName}`);
          }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }));
        }, extensionId);
        await page.goto(url);
        const tabId = await ext.tabIdOf(page);
        // The content script has finished its start-up there (the e2e build's probe), and said nothing to the page.
        await expect.poll(async () => (((await ext.session())['e2e:events'] as Array<{ type: string; tabId?: number }>
          | undefined) ?? []).some((event) => event.type === 'content-settled' && event.tabId === tabId), { message: url })
          .toBe(true);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen), url).toEqual([]);
        // The spy hears the event when it comes (its own dispatch, here).
        await page.evaluate((id) => document.dispatchEvent(new CustomEvent(`${id}:content:wxt:content-script-started`)),
          extensionId);
        expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen), url).toEqual(['event:content']);
        await page.close();
      }
    });

  test('at an ATS domain page that shows no posting, no listener keyed to the extension is on the page',
    async ({ extContext, extensionId, ext, routeLog, build }) => {
      test.skip(build !== 'e2e', "the content script's settled probe is compiled into the e2e build only");
      // The v3 Phase 6/7b review's round 3 (X1): a page timing its own dispatch of an event named after the fixed id
      // learnt the extension was there when our listener ran. On an employer's own pages on a shared ATS domain no
      // such listener is on the document or the window, nor one for any name of the extension's own (a colon in it);
      // on a host of public job postings the bridge's own is, and so are the forged WXT events' two (so the debugger is
      // seen to list the content script's listeners). Round 4 (Y1): it is decided once, at load, as the bridge's is, so
      // the page's own pushState to a posting address on its origin adds none either.
      const pages: Array<[string, boolean, string?]> = [['https://internal-acme.icims.com/jobs/1/engineer/job', false],
        ['https://performancemanager4.successfactors.com/sf/home', false],
        ['https://acme.taleo.net/careersection/2/jobsearch.ftl', false, '/careersection/ex/jobdetail.ftl?job=1&lang=en'],
        ['https://wd5.myworkdaysite.com/recruiting/acme/External', false, '/recruiting/acme/External/job/Remote/Engineer_JR-1'],
        ['https://jobs.lever.co/acme', true]];
      routeLog.serve(Object.fromEntries(pages.map(([url]) => [url, 'fixtures/smoke/form.html'])));
      const keyed = async (page: Page) => (await listenerTypes(page))
        .filter((type) => type.includes(extensionId) || type.includes(':'));
      for (const [url, listens, route] of pages) {
        const page = await extContext.newPage();
        await page.goto(url);
        const tabId = await ext.tabIdOf(page);
        await expect.poll(async () => (((await ext.session())['e2e:events'] as Array<{ type: string; tabId?: number }>
          | undefined) ?? []).some((event) => event.type === 'content-settled' && event.tabId === tabId), { message: url })
          .toBe(true);
        expect(await keyed(page), url).toEqual(listens ? [`${extensionId}:content:wxt:content-script-started`,
          `${extensionId}:content:wxt:locationchange`, 'tailorit:bridge'] : []);
        if (route !== undefined) {
          await page.evaluate((to) => history.pushState(null, '', to), route);
          // The reviewer's probe waited a second after its pushState before timing its dispatches.
          await page.waitForTimeout(1_000);
          expect(await keyed(page), `${url} -> ${route}`).toEqual([]);
        }
        await page.close();
      }
      // A pushState made before the content script starts (it runs once the page is idle) moves nothing either: the
      // address it decides by is the one the document was loaded at (its navigation entry).
      const early = await extContext.newPage();
      await early.addInitScript(() => history.pushState(null, '', '/careersection/ex/jobdetail.ftl?job=1&lang=en'));
      await early.goto(pages[2]![0]);
      const earlyTab = await ext.tabIdOf(early);
      await expect.poll(async () => (((await ext.session())['e2e:events'] as Array<{ type: string; tabId?: number }>
        | undefined) ?? []).some((event) => event.type === 'content-settled' && event.tabId === earlyTab)).toBe(true);
      expect(new URL(early.url()).pathname).toBe('/careersection/ex/jobdetail.ftl');
      expect((await listenerTypes(early)).filter((type) => type.includes(extensionId))).toEqual([]);
      await early.close();
    });

  test('the worker reaches the TailorIT mock with Local Network Access on', async ({ worker, build }) => {
    test.skip(build !== 'e2e', 'only the e2e build has the mock as its TailorIT origin');
    const status = await worker.evaluate(async (origin) => (await fetch(`${origin}/__mock/health`)).status, MOCK_ORIGIN);
    expect(status).toBe(200);
  });

  test('the browser resolves no name the routes do not answer: on the production build not even localhost', async ({
    worker, build }) => {
    // The production build's TailorIT origin is http://localhost:3100, the owner's own TailorIT: its browser resolves
    // localhost to nothing (fixtures.ts noNetwork), probed here at the mock's port, never at 3100. The e2e build's
    // localhost is the mock's 127.0.0.1. The worker's requests are the ones Playwright's routes never see.
    const probe = await worker.evaluate(async (url) => fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(() => 'reached', () => 'unreachable'), `${MOCK_ORIGIN}/__mock/health`);
    expect(probe).toBe(build === 'e2e' ? 'reached' : 'unreachable');
  });

  test('a content script is refused storage.local', async ({ extContext, worker, build }) => {
    test.skip(build !== 'e2e', 'the probe is compiled into the e2e build only');
    const page = await extContext.newPage();
    await page.goto(ATS_PAGES[2]!);
    await expect
      .poll(async () => ((await sessionStorage(worker))['e2e:events'] as Array<{ type: string; result: string }> | undefined) ?? [])
      .toContainEqual({ type: 'storage-local-probe', result: 'refused' });
    await page.close();
  });

  // Last in the file: afterwards the worker fixture's handle is stale (stop-worker.ts explains why).
  test('the worker comes back after it is stopped, woken by a frame', async ({ extContext, extensionId }) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await stopWorker(extContext, page, extensionId);
    const stoppedAt = Date.now();
    const ats = await extContext.newPage();
    await ats.goto(ATS_PAGES[3]!);
    const origin = new URL(ATS_PAGES[3]!).origin;
    // Only a restarted worker can have registered this frame: its hello woke it.
    await expect
      .poll(async () =>
        Object.values(await readSession(page)).some((value) => {
          const frame = value as Partial<FrameEntry>;
          return frame.origin === origin && (frame.registeredAt ?? 0) >= stoppedAt;
        }),
      )
      .toBe(true);
    await page.close();
    await ats.close();
  });
});
