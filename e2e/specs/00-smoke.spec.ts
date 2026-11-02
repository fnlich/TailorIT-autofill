/*
 * Phase 0's smoke suite: the extension loads, its worker starts with the fixed id, the content script injects on every
 * ATS host served at its real address (an embedded form's frame included, its company page not), the panel renders,
 * the worker reaches the mock, content scripts are refused storage.local, nothing announces the extension to the page,
 * and the worker comes back after being stopped. Runs on the e2e build and on the production build.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Worker } from '@playwright/test';
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
