/*
 * jr8 ICIMS (the owner's report of 2026-11-13, snapshot11: "currently icims is not working well. from `apply` button to
 * fill the content ... and also auto fill is stopped during the auto-fill"; SP\jr8\ICIMS-8.md), end to end in Chrome on
 * the owner's converted captures, an iCIMS portal's wrapper with its iframe#icims_content_iframe served at their own
 * addresses:
 * - R1: careers-healthedge's Candidate Profile with the product's own defaults (the sidebar open on the page): the
 *   portal pins its content at min-width 980px, so the page push leaves the frame under the sidebar, over its form's
 *   top-right corner where the frame's launcher sits. The claim frame's run fills (content/claim-seen.ts); it used to
 *   end "Stopped" with the form-hidden notice, nothing filled.
 * - R2: careers-ars's posting in its wrapper: Autofill presses Apply in the claim frame; iCIMS moves the top to /login,
 *   which reloads itself with its layout parameters (its own script stood in for: the first /login document holds no
 *   frame and loads the next 300 ms later), and draws the gate in the reloaded wrapper's frame (snapshot7's arc gate,
 *   the same portal markup, served at careers-ars's addresses). The gate's run starts (background/index.ts claimsWaiting):
 *   the email typed on Manual, Next never pressed. It used to start nothing there.
 * Sign-in stays on Manual; nothing is submitted (routes.ts fails a test that reaches /__submitted).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { SIDEBAR_WIDTH_PX } from '../../src/shared/sidebar';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { DEFAULT_SETTINGS, PRODUCT_SETTINGS } from '../helpers/settings.ts';
import { BETWEEN_STEPS } from '../helpers/wizard.ts';
import { routesFile } from '../routes.ts';

const HTML = 'text/html; charset=utf-8';

/** The tab's frame (other than its top) whose hello said it holds a form, by its id. */
async function formFrameOf(ext: Extension, tabId: number): Promise<number> {
  const held = { id: -1 };
  await expect.poll(async () => {
    const found = Object.entries(await ext.session()).find(([key, entry]) => key.startsWith(`frames:${tabId}:`)
      && key !== `frames:${tabId}:0` && (entry as { hasForm?: boolean }).hasForm === true);
    held.id = found === undefined ? -1 : Number(found[0].split(':')[2]);
    return held.id;
  }, { timeout: 20_000, message: 'no frame of the tab said hello with a form' }).toBeGreaterThan(0);
  return held.id;
}

/** A frame's report once its run rests or waits for the person's Next (BETWEEN_STEPS). */
async function rested(ext: Extension, tabId: number, frameId: number): Promise<FrameReport> {
  const held: { report: FrameReport | null } = { report: null };
  await expect.poll(async () => {
    const report = (await ext.reports(tabId)).find((candidate) => candidate.frameId === frameId) ?? null;
    held.report = report !== null && report.mode === 'fill' && (BETWEEN_STEPS as readonly string[]).includes(report.status)
      ? report : null;
    return held.report?.status ?? `not yet (${report === null ? 'no report' : `${report.mode} ${report.status}`})`;
  }, { timeout: 60_000, intervals: [200, 300, 500] }).toMatch(new RegExp(`^(?:${BETWEEN_STEPS.join('|')})$`));
  return held.report!;
}

/** What a page's stand-in script counted, kept in the tab's sessionStorage for its origin. */
const countsOf = (page: Page, key: string) => page.evaluate((name) =>
  JSON.parse(sessionStorage.getItem(name) ?? 'null') as Record<string, number> | null, key);

test.afterEach(async ({ ext }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('iCIMS portals: Apply to the gate, and the Candidate Profile under the sidebar (e2e 71, jr8 ICIMS)', () => {
  test('R1: careers-healthedge’s Candidate Profile under the open sidebar fills; its run never ends Stopped', async ({ extContext, connected: ext, routeLog }) => {
    // The product's own defaults: the sidebar opens by itself, on the page.
    await ext.data({ v: 1, type: 'settings/save', settings: PRODUCT_SETTINGS });
    const routes = routesFile('fixtures/icims/jr8-healthedge-profile.routes.json');
    routeLog.serve(routes);
    const TOP = Object.entries(routes).find(([, path]) => path === 'fixtures/icims/jr8-healthedge-profile.html')![0];
    const page = await extContext.newPage();
    await page.goto(TOP);
    await page.bringToFront();
    const tabId = await ext.tabIdOf(page);
    const frameId = await formFrameOf(ext, tabId);
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.elements('[data-sidebar] button[data-main-action="fill"]'))[0]
      ?.attributes.disabled === undefined, { timeout: 20_000, message: 'no Autofill in the sidebar' }).toBe(true);
    // The page is pushed, and the portal's frame still reaches under the sidebar.
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe(`${SIDEBAR_WIDTH_PX}px`);
    const edge = await page.evaluate(() => ({ right: document.querySelector('iframe#icims_content_iframe')!
      .getBoundingClientRect().right, width: document.documentElement.clientWidth }));
    expect(edge.right).toBeGreaterThan(edge.width - SIDEBAR_WIDTH_PX);
    // The sidebar's controls count a person's click only once seen, steady, CONTROL_SEEN_MS (its slide-in included).
    await page.waitForTimeout(1_500);
    const [main] = await ui.elements('[data-sidebar] button[data-main-action="fill"]');
    await ui.click(main!);
    const report = await rested(ext, tabId, frameId);
    expect(report.status).not.toBe('stopped');
    expect(report.notices.map((notice) => notice.code)).not.toContain('form-hidden');
    expect(report.fields.filter((row) => row.wrote).length).toBeGreaterThan(3);
    const frame = page.frames().find((each) => each.url().includes('/candidate?') && each.url().includes('in_iframe=1'))!;
    await expect(frame.locator('input[id="PersonProfileFields.FirstName"]')).toHaveValue(GOLDEN.first);
    await expect(frame.locator('input[id="PersonProfileFields.Email"]')).toHaveValue(GOLDEN.email);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test('R2: careers-ars’s Apply, iCIMS’s /login reloading itself; the gate’s run starts in the reloaded wrapper’s frame, its email typed, nothing pressed', async ({ extContext, connected: ext, routeLog }) => {
    const routes = routesFile('fixtures/icims/jr8-ars-posting.routes.json');
    const TOP = Object.entries(routes).find(([, path]) => path === 'fixtures/icims/jr8-ars-posting.html')![0];
    const origin = new URL(TOP).origin;
    // The frame's Apply, as the capture holds it (the converter blanked its token).
    const APPLY = /href="([^"]*mode=apply[^"]*)"/.exec(readFileSync('fixtures/icims/jr8-ars-posting.frame-1.html', 'utf8'))![1]!
      .replaceAll('&amp;', '&');
    expect(new URL(APPLY).searchParams.get('in_iframe')).toBe('1');
    const slug = new URL(APPLY).pathname.replace(/\/job$/, '');
    const LAYOUT = 'mobile=false&width=1280&height=500&bga=true&needsRedirect=false&jan1offset=-480&jun1offset=-420';
    const LOGIN_FIRST = `${origin}${slug}/login`;
    const LOGIN_TOP = `${LOGIN_FIRST}?${LAYOUT}`;
    const LOGIN_FRAME = `${LOGIN_FIRST}?in_iframe=1&${LAYOUT}`;
    // iCIMS's scripts stood in for: the in-frame Apply moves the top to /login; its first document reloads itself with
    // the layout parameters; the reloaded wrapper frames the gate.
    const wrapper = readFileSync('fixtures/icims/jr7-icims1-login.html', 'utf8')
      .replace(/(<iframe[^>]*id="icims_content_iframe"[^>]*src=")[^"]*"/, `$1${LOGIN_FRAME.replaceAll('&', '&amp;')}"`);
    expect(wrapper).toContain(LOGIN_FRAME.replaceAll('&', '&amp;'));
    const gate = readFileSync('fixtures/icims/jr7-icims1-login.frame-1.html', 'utf8');
    const at = gate.lastIndexOf('</body>');
    const counted = `${gate.slice(0, at)}<script>(() => {
      const KEY = 'tia71-icims';
      const counts = { next: 0 };
      sessionStorage.setItem(KEY, JSON.stringify(counts));
      document.addEventListener('click', (event) => {
        if (event.target.closest('#enterEmailSubmitButton')) counts.next += 1;
        sessionStorage.setItem(KEY, JSON.stringify(counts));
      }, true);
    })();</script>${gate.slice(at)}`;
    let applied = 0;
    extContext.on('request', (request) => {
      if (request.url() === APPLY) applied += 1;
    });
    routeLog.serve({ ...routes,
      [APPLY]: { body: `<!doctype html><meta charset="utf-8"><title>Redirecting</title><script>top.location.replace(${
        JSON.stringify(LOGIN_FIRST)})</script>`, contentType: HTML },
      [LOGIN_FIRST]: { body: `<!doctype html><meta charset="utf-8"><title>Login</title><body><script>setTimeout(() =>
        location.replace(${JSON.stringify(LOGIN_TOP)}), 300)</script></body>`, contentType: HTML },
      [LOGIN_TOP]: { body: wrapper, contentType: HTML },
      [LOGIN_FRAME]: { body: counted, contentType: HTML } });
    const page = await extContext.newPage();
    await page.goto(TOP);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toHaveText('Autofill', { timeout: 20_000 });
    await expect(button).toBeEnabled();
    await button.click();
    await page.bringToFront();
    await page.waitForURL(LOGIN_TOP, { timeout: 30_000 });
    expect(applied).toBe(1);
    const frameId = await formFrameOf(ext, tabId);
    const report = await rested(ext, tabId, frameId);
    expect(report.status).toBe('auth-needed');
    const frame = page.frames().find((each) => each.url() === LOGIN_FRAME)!;
    // jr6 SHELL-A: the gate's email is typed in every Sign-in mode (the profile's: none saved in Sign-up Information).
    await expect(frame.locator('input#email')).toHaveValue(GOLDEN.email, { timeout: 15_000 });
    await page.waitForTimeout(1_500);
    expect(await countsOf(page, 'tia71-icims')).toEqual({ next: 0 });
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });
});
