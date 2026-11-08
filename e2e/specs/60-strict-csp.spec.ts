/*
 * The in-page UI under a strict page CSP (docs/ARCHITECTURE.md, the register of unverified facts: "Styles survive a
 * strict page CSP in the closed shadow root"; docs/design/runtime.md §10.1). The same page is served twice, with
 * Content-Security-Policy: style-src 'none' and without it. The launcher's stylesheet is a constructable stylesheet
 * adopted by the closed root, or a <style> element in it as the fallback; its host's own styles are set through the
 * CSSOM. Either way the launcher must look the same on both pages, and the page must report no violation. v5 p1-shell:
 * the sidebar opens there by itself, styled (its frame, and the views its bundle brings, adopted by the closed root), the
 * page pushed through an adopted document stylesheet the policy does not govern, Inter added from the bundle's bytes,
 * and the page reports no violation. And the page-world bridge (docs/SPEC-AMENDMENTS.md §12), a MAIN-world
 * content script the browser injects whatever the page's policy, is there on a page whose CSP is script-src 'none':
 * a command a page script sends is acknowledged and answered.
 */
import { DEFAULT_SETTINGS, PRODUCT_SETTINGS } from '../helpers/settings.ts';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { PageUi, type UiElement } from '../helpers/page-ui.ts';
import { spyRecord } from '../helpers/spies.ts';

const PAGE_FILE = 'fixtures/synthetic/strict-csp.html';
const STRICT = 'https://jobs.lever.co/tailorit-fixture/strict-csp/apply';
const CONTROL = 'https://jobs.lever.co/tailorit-fixture/strict-csp-control/apply';
/** What the stylesheet sets on the launcher (src/content/ui/styles.ts), and the box it draws. */
const LOOK = ['width', 'height', 'display', 'position', 'background-color', 'color', 'border-radius', 'border-top-width',
  'font-size', 'font-weight', 'cursor', 'box-shadow'] as const;

test("the launcher keeps its styles on a page whose CSP is style-src 'none'", async ({ extContext, connected: ext, routeLog }) => {
  // Minimized: the pill shows, and nothing opens by itself (v5 p1-shell).
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, view: 'minimized' } });
  try {
    routeLog.serve({
      [STRICT]: { file: PAGE_FILE, headers: { 'Content-Security-Policy': "style-src 'none'" } },
      [CONTROL]: PAGE_FILE,
    });
    const looks: Record<string, Record<string, string>> = {};
    for (const url of [CONTROL, STRICT]) {
      const page = await extContext.newPage();
      await page.goto(url);
      const ui = await PageUi.of(page);
      await expect.poll(async () => (await ui.launcher())?.shown ?? false, { message: `no launcher on ${url}` }).toBe(true);
      const launcher = (await ui.launcher()) as UiElement;
      looks[url] = await ui.style(launcher, LOOK);
      if (url === STRICT) {
        expect((await spyRecord(page.mainFrame())).cspViolations, 'violations the page reported').toEqual([]);
        // Record which way the styles went in, for the register: adopted, or the <style> fallback.
        test.info().annotations.push({ type: 'style mode', description: (await ui.hasStyleElement()) ? 'style-element' : 'adopted' });
      }
      await ui.close();
      await page.close();
    }
    // v5 p1-shell: the pill's 40 px tile.
    expect(looks[CONTROL]!.width).toBe('40px');
    expect(looks[CONTROL]!.height).toBe('40px');
    expect(looks[STRICT]).toEqual(looks[CONTROL]);
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});

test("the sidebar opens on that page in TailorIT's look and pushes it, with no violation (v5 p1-shell)", async ({ extContext, connected: ext, routeLog }) => {
  // The product's own defaults: the sidebar opens by itself.
  await ext.data({ v: 1, type: 'settings/save', settings: PRODUCT_SETTINGS });
  routeLog.serve({ [STRICT]: { file: PAGE_FILE, headers: { 'Content-Security-Policy': "style-src 'none'" } } });
  const page = await extContext.newPage();
  await page.goto(STRICT);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  await page.bringToFront();
  const ui = await PageUi.of(page);
  await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown ?? false,
    { message: 'the sidebar never opened' }).toBe(true);
  await expect.poll(async () => (await ui.elements('[data-sidebar] main.tia-panel')).length).toBe(1);
  const [frame] = await ui.elements('[data-sidebar]');
  expect(await ui.style(frame!, ['width', 'background-color'])).toEqual({ width: '384px',
    'background-color': 'rgb(255, 255, 255)' });
  // The views' own sheets: the panel's head laid out as a row.
  const [head] = await ui.elements('[data-sidebar] .tia-panel__head');
  expect(await ui.style(head!, ['display', 'justify-content'])).toEqual({ display: 'flex',
    'justify-content': 'space-between' });
  // The page pushed under the policy, and Inter added from the bundle's own bytes.
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe('384px');
  expect(await page.evaluate(() => [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'TailorIT Inter')))
    .toBe(true);
  expect((await spyRecord(page.mainFrame())).cspViolations, 'violations the page reported').toEqual([]);
  await ui.clickButton(COPY.sidebar.minimise);
  await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown).toBe(false);
  await ui.close();
  await page.close();
});

test("the page-world bridge is in a page whose CSP is script-src 'none', and answers a command there", async ({ extContext, connected: _ext, routeLog }) => {
  routeLog.serve({ [STRICT]: { file: PAGE_FILE, headers: { 'Content-Security-Policy': "script-src 'none'; style-src 'none'" } } });
  const page = await extContext.newPage();
  await page.goto(STRICT);
  // Asked as any page script could ask (Playwright evaluates in the page's own world, past its policy): the field
  // reading of a text box no React drew, which the bridge answers 'no-react'.
  const ask = () => page.evaluate(() => {
    const box = document.getElementById('name')!;
    let detail: string | null = null;
    box.addEventListener('tailorit:bridge-result', (event) => {
      detail = String((event as CustomEvent).detail);
    }, { once: true });
    const handled = !box.dispatchEvent(new CustomEvent('tailorit:bridge', { cancelable: true,
      detail: JSON.stringify({ v: 1, id: 'csp-probe-0001', op: 'react.field' }) }));
    return { handled, answer: detail === null ? null : JSON.parse(detail) as unknown };
  });
  await expect.poll(async () => (await ask()).handled, { message: 'the bridge never answered' }).toBe(true);
  expect(await ask()).toEqual({ handled: true, answer: { v: 1, id: 'csp-probe-0001', ok: false, reason: 'no-react' } });
  expect((await spyRecord(page.mainFrame())).cspViolations, 'violations the page reported').toEqual([]);
  await page.close();
});
