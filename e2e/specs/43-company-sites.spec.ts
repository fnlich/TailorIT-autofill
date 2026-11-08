/*
 * v3 Phase 8 end to end: company career sites (docs/SPEC-AMENDMENTS.md §12 Decision 13), in a browser whose profile
 * holds the optional host permission (helpers/sites.ts: Chrome's permission dialog answers no automation), on
 * synthetic pages and the mock TailorIT. LinkedIn is deferred to v5 by the owner (2026-11-06).
 * - Options › "Where Autofill works" › Company career sites: the toggle, and the sentinel's registration it makes and
 *   takes back (every https page, the ATS hosts, LinkedIn and the employee HR systems excluded, the top frame only);
 * - a company page embedding a Greenhouse form beside a talent-community form of its own (the Phase 8 review, B3): not
 *   recognised by its embed, nothing injected in its top frame, the form's own frame registered and filled as before,
 *   the company's own form left as it was, no page-world bridge on the company's page;
 * - a company page's own application form: recognised by the score, the top frame claiming it as the site, a dry run
 *   reading its fields;
 * - an ordinary site: the sentinel says nothing, and nothing of the extension shows or listens there;
 * - LinkedIn: nothing of the extension runs there, even with every https page granted and an application form shown.
 * v5 p1-rules (PLAN decisions 9 and 10, like Jobright): every https and http page is granted at install and the career
 * sites are on by default, so the registration is there before any click; turning them off keeps Chrome's permission
 * (a required host now), and the registration excludes the CAPTCHA and anti-bot vendors' own pages.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test as base } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { bridgeAnswers, extensionWorlds, launchWithSites } from '../helpers/sites.ts';
import type { RouteLog } from '../routes.ts';

const test = base.extend({
  extContext: [
    async ({ extensionPath, build }, use) => {
      const launched = await launchWithSites(extensionPath, build);
      await use(launched.context);
      await launched.close();
    },
    { scope: 'worker' },
  ],
});

const EMBED = 'https://careers.tailorit-fixture.example/positions/1/?gh_jid=1';
const APPLY = 'https://careers.fixture-corp.example/jobs/42/apply';
const ORDINARY = 'https://www.ordinary-fixture.example/';
const LINKEDIN = ['https://www.linkedin.com/jobs/view/4012345678/', 'https://uk.linkedin.com/jobs/view/4012345678/'];

const ROUTES = {
  [EMBED]: 'fixtures/synthetic/sites/embed-talent.html',
  [APPLY]: 'fixtures/synthetic/sites/apply.html',
  [ORDINARY]: 'fixtures/synthetic/sites/ordinary.html',
  ...Object.fromEntries(LINKEDIN.map((url) => [url, 'fixtures/synthetic/sites/apply.html'])),
};

/** How long a page may take to be recognised: the sentinel runs once the page and its frames are idle. */
const RECOGNISED_WITHIN_MS = 15_000;

type E2eEvent = { type: string; tabId?: number; reason?: string; injected?: boolean };
const events = async (ext: Extension) => ((await ext.session())['e2e:events'] as E2eEvent[] | undefined) ?? [];

/** Turns the company career sites on in Options, as the person does: a click on the toggle. */
async function turnOn(ext: Extension): Promise<void> {
  const options = await ext.page();
  await options.reload();
  const toggle = options.locator('input[data-setting="sites.on"]');
  await expect(toggle).toBeEnabled();
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
}

/** Chrome's registrations, as the options page reads them. */
async function registrations(ext: Extension): Promise<Array<{ id: string; matches: string[]; excludeMatches?: string[];
  allFrames: boolean; js: string[] }>> {
  return (await ext.page()).evaluate(() => (globalThis as unknown as { chrome: { scripting: {
    getRegisteredContentScripts(): Promise<Array<{ id: string; matches: string[]; excludeMatches?: string[]; allFrames: boolean;
      js: string[] }>> } } }).chrome.scripting.getRegisteredContentScripts());
}

/** A page at `url`, its routes served. */
async function open(extContext: BrowserContext, routeLog: RouteLog, url: string): Promise<Page> {
  routeLog.serve(ROUTES);
  const page = await extContext.newPage();
  await page.goto(url);
  return page;
}

test.describe('company career sites', () => {
  test("leaves a company page's Greenhouse embed to its own frame: nothing injected, only the Greenhouse form filled (B3)",
    async ({ extContext, connected: ext, routeLog }) => {
      await turnOn(ext);
      const page = await open(extContext, routeLog, EMBED);
      const tabId = await ext.tabIdOf(page);
      // The embedded form's own frame says hello with its form, as it always did.
      await expect.poll(async () => Object.entries(await ext.session()).filter(([key, entry]) => key.startsWith(`frames:${tabId}:`)
        && (entry as { hasForm?: boolean }).hasForm === true).map(([key]) => key), { timeout: RECOGNISED_WITHIN_MS }).toHaveLength(1);
      // The sentinel had its readings: the page is not recognised by its embed, and its top frame gets nothing.
      await page.waitForTimeout(2_000);
      expect((await events(ext)).filter((event) => event.type === 'page-recognised' && event.tabId === tabId)).toEqual([]);
      expect((await ext.session())[`frames:${tabId}:0`]).toBeUndefined();
      const formKey = Object.keys(await ext.session()).find((key) => key.startsWith(`frames:${tabId}:`))!;
      const formFrameId = Number(formKey.split(':')[2]);
      // Autofill (the side panel's Fill, the person's click) fills the Greenhouse form, and nothing of the company's own
      // talent-community form.
      const panel = await ext.reportPage(tabId);
      const fill = panel.getByRole('button', { name: COPY.panel.fill, exact: true });
      await expect(fill).toBeEnabled();
      await fill.click();
      await page.bringToFront();
      await ext.settled(tabId, { frameId: formFrameId });
      const formFrame = page.frames().find((frame) => frame.url().startsWith('https://job-boards.greenhouse.io/'))!;
      expect(await formFrame.locator('#first').inputValue()).not.toBe('');
      for (const id of ['tc-first', 'tc-email', 'tc-phone']) expect(await page.locator(`#${id}`).inputValue(), id).toBe('');
      // The page-world bridge answers in the form's frame (an ATS host), never on the company's page.
      expect(await bridgeAnswers(formFrame)).toBe(true);
      expect(await bridgeAnswers(page)).toBe(false);
      // The company page holds the dormant sentinel alone, listening for nothing on the page.
      expect(await extensionWorlds(page)).toEqual([[]]);
    });

  test("claims a company page's own application form by the score, and a dry run reads it as the site's", async ({
    extContext, connected: ext, routeLog }) => {
    await turnOn(ext);
    const page = await open(extContext, routeLog, APPLY);
    const tabId = await ext.tabIdOf(page);
    await expect.poll(async () => (await events(ext)).filter((event) => event.type === 'page-recognised' && event.tabId === tabId)
      .map((event) => event.reason), { timeout: RECOGNISED_WITHIN_MS }).toEqual(['application-form']);
    await ext.frameWithForm(tabId);
    expect((await ext.session())[`frames:${tabId}:0`]).toMatchObject({ platform: 'site', hasForm: true,
      applicationKey: expect.stringMatching(/^site:[0-9a-f]{16}$/) as unknown as string });
    await ext.fill(page, { dryRun: true });
    const report = await ext.settled(tabId, { mode: 'dry-run' });
    expect(report.platform).toBe('site');
    expect(report.fields.map((row) => row.label)).toEqual(expect.arrayContaining(['First name', 'Last name', 'Email', 'Phone']));
    expect(await bridgeAnswers(page)).toBe(false);
  });

  test('stays silent on an ordinary site: no message, no UI, no listener', async ({ extContext, connected: ext, routeLog }) => {
    await turnOn(ext);
    const page = await open(extContext, routeLog, ORDINARY);
    const tabId = await ext.tabIdOf(page);
    await page.waitForTimeout(2_000);
    expect((await events(ext)).filter((event) => event.tabId === tabId)).toEqual([]);
    expect(Object.keys(await ext.session()).filter((key) => key.includes(`:${tabId}:`))).toEqual([]);
    const ui = await PageUi.of(page);
    expect(await ui.mounted()).toBe(false);
    await ui.close();
    // The dormant sentinel is there, and listens for nothing on the page.
    expect(await extensionWorlds(page)).toEqual([[]]);
  });

  test('runs nothing on LinkedIn, even with every https page granted and an application form shown', async ({
    extContext, connected: ext, routeLog }) => {
    await turnOn(ext);
    for (const url of LINKEDIN) {
      const page = await open(extContext, routeLog, url);
      const tabId = await ext.tabIdOf(page);
      await page.waitForTimeout(2_000);
      expect((await events(ext)).filter((event) => event.tabId === tabId), url).toEqual([]);
      expect(Object.keys(await ext.session()).filter((key) => key.includes(`:${tabId}:`)), url).toEqual([]);
      const ui = await PageUi.of(page);
      expect(await ui.mounted(), url).toBe(false);
      await ui.close();
      // Not even the sentinel: no world of the extension's in the frame.
      expect(await extensionWorlds(page), url).toEqual([]);
      await page.close();
    }
  });
  test('Options turns them on and off, the worker registering the sentinel for every https page but the ATS hosts, LinkedIn and '
    + "the HR systems, and turning them off ends every page it injected (P1/B8)", async ({ extContext, connected: ext, routeLog }) => {
      // v5 p1-rules (PLAN decision 10): on by default, registered with nothing chosen in Options.
      await expect.poll(async () => (await registrations(ext)).map((each) => each.id)).toEqual(['tailorit-sites']);
      await turnOn(ext);
      // A company page the worker injected, its launcher shown.
      const page = await open(extContext, routeLog, APPLY);
      const tabId = await ext.tabIdOf(page);
      await ext.frameWithForm(tabId);
      const ui = await PageUi.of(page);
      await expect.poll(() => ui.mounted()).toBe(true);
      await expect.poll(async () => (await registrations(ext)).map((each) => each.id)).toEqual(['tailorit-sites']);
      const [sites] = await registrations(ext);
      expect(sites).toMatchObject({ matches: ['https://*/*'], allFrames: false, js: ['sentinel.js'] });
      expect(sites!.excludeMatches).toEqual(expect.arrayContaining(['https://*.linkedin.com/*', 'https://job-boards.greenhouse.io/*',
        'https://*.myworkdayjobs.com/*', 'https://*.oraclecloud.com/*', 'https://*.myworkday.com/*', 'https://*.sapsf.com/*',
        // v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' own pages.
        '*://*.google.com/recaptcha/*', '*://*.hcaptcha.com/*', '*://challenges.cloudflare.com/*']));
      // Off: the registration goes; Chrome's permission stays, the install's own (v5 p1-rules, PLAN decision 10). This
      // test comes last all the same.
      const options = await ext.page();
      await options.locator('input[data-setting="sites.on"]').click();
      await expect.poll(async () => (await registrations(ext)).map((each) => each.id)).toEqual([]);
      expect(await options.evaluate(() => (globalThis as unknown as { chrome: { permissions: {
        contains(query: { origins: string[] }): Promise<boolean> } } }).chrome.permissions.contains({ origins: ['https://*/*',
        'http://*/*'] }))).toBe(true);
      // The page it injected: its UI gone, its document forgotten by the worker.
      await expect.poll(() => ui.mounted()).toBe(false);
      await ui.close();
      expect(Object.keys(await ext.session()).filter((key) => key.startsWith(`injected:${tabId}:`))).toEqual([]);
    });
});
