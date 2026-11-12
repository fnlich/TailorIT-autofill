/*
 * The snapshot build of 2026-11-06 end to end (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): SmartRecruiters' one-click application, the
 * owner's snapshot of Xplor's first page converted as fixtures/smartrecruiters/xplor-one-click.html (its form drawn in
 * open shadow roots, kept as declarative ones), served at its real address on jobs.smartrecruiters.com:
 * - the content script runs there and the SmartRecruiters adapter claims <oc-oneclick-form>;
 * - a fill writes the golden profile's names and email into the boxes inside the shadow roots (each spl-input's own
 *   input), and nothing into the "Easy Apply" drop zone, which sends a resume for SmartRecruiters to parse (excluded),
 *   then waits for the page to turn (its Next is the person's: the run's status is 'wait-transition');
 * - it presses nothing: not Next, not "Apply With Indeed" or "Apply with SEEK", and nothing reaches a request the
 *   routes do not serve (the LinkedIn widget's frame is answered by the third-party stand-in, where nothing of ours
 *   runs).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../fixtures.ts';
import { GOLDEN } from '../helpers/golden.ts';
import type { RouteMap } from '../routes.ts';

const FORM = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1?dcr_ci=Xplor';
const ROUTES = JSON.parse(readFileSync(resolve('fixtures/smartrecruiters/xplor-one-click.routes.json'), 'utf8')) as RouteMap;

test.describe("SmartRecruiters' one-click application (the snapshot build of 2026-11-06)", () => {
  test('fills the boxes inside its shadow roots, keeps out of Easy Apply, and presses nothing', async ({ extContext, connected: ext, routeLog }) => {
    routeLog.serve(ROUTES);
    const page = await extContext.newPage();
    await page.goto(FORM);
    // Playwright's CSS reaches into open shadow roots: each spl-input's own input.
    const box = (id: string) => page.locator(`spl-input#${id} input`);
    await expect(box('first-name-input')).toBeVisible();
    const clicks: string[] = [];
    await page.exposeFunction('__srClick', (what: string) => clicks.push(what));
    await page.evaluate(() => {
      document.addEventListener('click', (event) => {
        const target = event.composedPath()[0] as Element;
        (globalThis as unknown as { __srClick(what: string): void }).__srClick(
          `${target.localName}.${String(target.className).trim().split(/\s+/)[0] ?? ''}`);
      }, true);
    });
    const tabId = await ext.fill(page);
    // The first page has a Next (nextButton, isFinalStep 'not-final'): the run fills it and waits for the page to turn,
    // which is the person's to do.
    await expect.poll(async () => (await ext.reports(tabId)).find((report) => report.frameId === 0)?.status,
      { timeout: 45_000 }).toBe('wait-transition');
    await expect(box('first-name-input')).toHaveValue(GOLDEN.first);
    await expect(box('last-name-input')).toHaveValue(GOLDEN.last);
    await expect(box('email-input')).toHaveValue(GOLDEN.email);
    // The Easy Apply drop zone (SmartRecruiters' own resume parsing) holds no file.
    const easyApplyFiles = await page.locator('spl-dropzone[data-test="apply-with-resume-container"] input[type="file"]')
      .evaluate((input) => (input as HTMLInputElement).files?.length ?? 0);
    expect(easyApplyFiles).toBe(0);
    // Nothing was pressed: no button, no Next, no external provider. jr6 SR-6: the phone's country list is a widget the
    // adapter declares, opened by its own button (button.c-spl-select-field) to be read or chosen: no press.
    expect(clicks.filter((what) => what.startsWith('button.') && what !== 'button.c-spl-select-field')).toEqual([]);
    expect(page.url()).toBe(FORM);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });
});
