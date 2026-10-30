/*
 * The in-page UI under a strict page CSP (docs/ARCHITECTURE.md, the register of unverified facts: "Styles survive a
 * strict page CSP in the closed shadow root"; docs/design/runtime.md §10.1). The same page is served twice, with
 * Content-Security-Policy: style-src 'none' and without it. The launcher's stylesheet is a constructable stylesheet
 * adopted by the closed root, or a <style> element in it as the fallback; its host's own styles are set through the
 * CSSOM. Either way the launcher must look the same on both pages, and the page must report no violation.
 */
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
