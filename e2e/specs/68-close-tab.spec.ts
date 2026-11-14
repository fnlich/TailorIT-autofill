/*
 * v2.0 P9 (A20; docs/design/v2.0/09-extension-api8.md "Close the application tab when it is submitted") end to end, on
 * synthetic pages only, against the mock's queue (nothing real is ever submitted):
 * - Options › Auto-apply's switch "Close the application tab when it's submitted" is on by default: a queued job filled
 *   and submitted by itself (Submit Auto) is told submitted, and its tab closes a few seconds after the platform's
 *   confirmation, though the person is looking at it;
 * - turned off there, the tab stays open after the confirmation.
 */
import type { Page } from '@playwright/test';
import { API8_COPY } from '../../src/ui/options/copy-api8';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';

const GREENHOUSE = 'fixtures/synthetic/submit/greenhouse.html';
const greenhouseAt = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/6868${id}`;

/** A queued job, as TailorIT's opened route hands it out. */
function task(n: number, title: string) {
  return { id: `0000000${n}-eeee-4bbb-8ccc-00000006868${n}`, jobId: 68680 + n, url: greenhouseAt(`0${n}`),
    company: 'Northwind', title, resumeId: null };
}

/** The queue opening at once and filling by itself, Next and Submit on Auto. */
async function settingsForQueue(ext: Extension): Promise<void> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto', next: 'auto' },
    queue: { ...DEFAULT_SETTINGS.queue, durationSec: 1, accelerationSec: 0, autofillOnOpen: 'auto' } } });
}

/** The page the queue opens for `url`. */
async function queuedPage(ext: Extension, url: string): Promise<Page> {
  const page = await ext.context.waitForEvent('page', { predicate: (opened) => opened.url().startsWith(url)
    || opened.url() === 'about:blank', timeout: 30_000 });
  await page.waitForURL((address) => address.href.startsWith(url), { timeout: 30_000 });
  return page;
}

/** The job submitted (the platform's confirmation, told to TailorIT). */
async function submitted(id: string): Promise<void> {
  await expect.poll(async () => (await mock.agent()).results, { timeout: 60_000 }).toEqual([{ id,
    body: { state: 'submitted', reason: null, aiGuesses: expect.any(Number), submitPressed: true } }]);
}

test.afterEach(async ({ ext }) => {
  await ext.send({ v: 1, type: 'queue/stop' });
  await ext.data({ v: 1, type: 'autoApply/closeTab', on: true });
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('"Close the application tab when it’s submitted" (v2.0 P9, A20)', () => {
  test('on by default: a submitted queued tab closes a few seconds after its confirmation, even in front', async ({ connected: ext, routeLog }) => {
    routeLog.serve({ [greenhouseAt('01')]: GREENHOUSE });
    await mock.queueAgent([task(1, 'Senior Backend Engineer')]);
    await settingsForQueue(ext);
    expect(await ext.data<{ on: boolean }>({ v: 1, type: 'autoApply/closeTab' })).toEqual({ on: true });
    const opening = queuedPage(ext, greenhouseAt('01'));
    await ext.data({ v: 1, type: 'queue/start' });
    const page = await opening;
    await page.bringToFront();
    await submitted(task(1, '').id);
    const told = Date.now();
    // Open long enough to see the confirmation, then closed.
    expect(page.isClosed()).toBe(false);
    await expect.poll(() => page.isClosed(), { timeout: 15_000 }).toBe(true);
    expect(Date.now() - told).toBeGreaterThanOrEqual(3_000);
    expect(routeLog.submitted).toEqual([]);
  });

  test('turned off in Options: the submitted queued tab stays open', async ({ connected: ext, routeLog }) => {
    // The person turns it off on the options page.
    const options = await ext.page();
    await options.goto(ext.url('options.html'));
    const card = options.locator('[data-card="agent"]');
    const close = card.locator('input[data-setting="autoApply.closeTab"]');
    await expect(close).toBeChecked();
    await expect(card).toContainText(API8_COPY.closeTab);
    await close.click();
    await expect(close).not.toBeChecked();
    expect(await ext.data<{ on: boolean }>({ v: 1, type: 'autoApply/closeTab' })).toEqual({ on: false });
    await options.close();

    routeLog.serve({ [greenhouseAt('02')]: GREENHOUSE });
    await mock.queueAgent([task(2, 'Platform Engineer')]);
    await settingsForQueue(ext);
    const opening = queuedPage(ext, greenhouseAt('02'));
    await ext.data({ v: 1, type: 'queue/start' });
    const page = await opening;
    await submitted(task(2, '').id);
    await new Promise((done) => setTimeout(done, 9_000));
    expect(page.isClosed()).toBe(false);
    await expect.poll(async () => (await ext.data<{ items: Array<{ status: string }> }>({ v: 1, type: 'queue/list',
      offset: 0 })).items[0]?.status, { timeout: 15_000 }).toBe('submitted');
    expect(routeLog.submitted).toEqual([]);
  });
});
