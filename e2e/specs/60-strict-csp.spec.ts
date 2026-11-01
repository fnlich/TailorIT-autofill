/*
 * The in-page UI under a strict page CSP (docs/ARCHITECTURE.md, the register of unverified facts: "Styles survive a
 * strict page CSP in the closed shadow root"; docs/design/runtime.md §10.1). The same page is served twice, with
 * Content-Security-Policy: style-src 'none' and without it. The launcher's stylesheet is a constructable stylesheet
 * adopted by the closed root, or a <style> element in it as the fallback; its host's own styles are set through the
 * CSSOM. Either way the launcher must look the same on both pages, and the page must report no violation. The in-page
 * panel opens there too, styled as TailorIT's card, and its completion bar takes its width (set through the CSSOM, by
 * React's style property) under the policy.
 */
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
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

test("the launcher keeps its styles on a page whose CSP is style-src 'none'", async ({ extContext, connected: _ext, routeLog }) => {
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
  expect(looks[CONTROL]!.width).toBe('32px');
  expect(looks[CONTROL]!.height).toBe('32px');
  expect(looks[STRICT]).toEqual(looks[CONTROL]);
});

test("the in-page panel opens on that page in TailorIT's look, and its completion bar takes its width", async ({ extContext, connected: ext, routeLog }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'in-page' } });
  try {
    routeLog.serve({ [STRICT]: { file: PAGE_FILE, headers: { 'Content-Security-Policy': "style-src 'none'" } } });
    const page = await extContext.newPage();
    await page.goto(STRICT);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.launcher())?.shown ?? false, { message: 'the launcher never showed' }).toBe(true);
    // The person's click fills; at rest, the launcher's next click opens the review on the page.
    await ui.clickLauncher();
    expect((await ext.settled(tabId)).status).toBe('review');
    await expect.poll(async () => (await ui.launcher())?.attributes['data-state']).toBe('review');
    await ui.clickLauncher();
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"]'))[0]?.shown,
      { message: 'the in-page panel never opened' }).toBe(true);
    const [panel] = await ui.elements('[data-panel="in-page"]');
    expect(await ui.style(panel!, ['border-top-left-radius', 'background-color', 'width'])).toEqual({
      'border-top-left-radius': '20px', 'background-color': 'rgb(255, 255, 255)', width: '380px' });
    await expect.poll(async () => (await ui.elements('.tia-progress__fill')).length, { message: 'no completion bar' }).toBe(1);
    const [fill] = await ui.elements('.tia-progress__fill');
    const drawn = await ui.style(fill!, ['width', 'background-color']);
    expect(Number.parseFloat(drawn.width!)).toBeGreaterThan(0);
    expect(drawn['background-color']).toBe('rgb(20, 161, 192)');
    expect((await spyRecord(page.mainFrame())).cspViolations, 'violations the page reported').toEqual([]);
    await ui.clickButton(COPY.inPage.close);
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"]'))[0]?.shown).toBe(false);
    await ui.close();
    await page.close();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});
