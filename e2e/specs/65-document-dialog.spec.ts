/*
 * v1.5 X (PLAN decisions 2 and 3) end to end, against the mock:
 * - Preview from the side panel's page (the side panel's own code, in a tab here) shows the dialog over the job page,
 *   on a page whose CSP is `default-src 'self'; frame-src 'none'` too: the extension's own frame loads there (a page's
 *   policy does not govern the extension's pages), its scripts and styles from the extension's origin, with no violation
 *   reported, and its Open In A New Tab opens the full-window page;
 * - a tab with no frame of ours (a page off the applicant-tracking hosts here) gets the full-window preview page;
 * - a web page cannot load preview.html at the extension's fixed address (the dynamic one alone is web-accessible);
 * - Edit on an uploaded resume shows the confirm over the page; Continue, with "Don't show this again", opens
 *   TailorIT's /resumes/<id>/edit, and from then on Edit opens it at once.
 */
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { dialogOn, previewFrameOn, shownDigest } from '../helpers/document-dialog.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { spyRecord } from '../helpers/spies.ts';
import { example } from '../mock-server/mock.mjs';
import { MOCK_ORIGIN } from '../routes.ts';

const PAGE_FILE = 'fixtures/synthetic/resume-upload.html';
const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const STRICT = { 'Content-Security-Policy': "default-src 'self'; frame-src 'none'" };
const UPLOAD = (example('AutofillResumeList') as { items: Array<{ id: string; kind: string }> }).items
  .find((item) => item.kind === 'uploaded')!;
const WORDS = COPY.documentDialog;

test.describe('the documents’ dialogs over the page (v1.5 X)', () => {
  test("shows the preview over a page whose CSP forbids every frame, with no violation, and opens the full window from it", async ({ extContext, connected: ext, routeLog }) => {
    const url = at('dialog-strict-csp');
    routeLog.serve({ [url]: { file: PAGE_FILE, headers: STRICT } });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('[data-job-resume] button[data-job-action="preview"]').click();
    const ui = await PageUi.of(page);
    await dialogOn(ui, 'preview');
    const frame = await previewFrameOn(page, 'resume');
    expect((await shownDigest(frame)).digest).toBe(GOLDEN_RESUME.sha256);
    // The embedded page drew itself from the extension's own scripts and styles: its sheet applies.
    expect(await frame.evaluate(() => getComputedStyle(document.body).margin)).toBe('0px');
    // The page's policy refuses the fixture's own inline style and script; nothing of ours is refused.
    expect((await spyRecord(page.mainFrame())).cspViolations.filter((violation) => /^(?:frame|child|default)-src/
      .test(violation.directive) || violation.blocked.includes('extension')), 'violations of ours').toEqual([]);
    // Open In A New Tab: the full-window page, at the extension's own address, and the dialog goes.
    const opened = extContext.waitForEvent('page');
    await ui.clickButton(WORDS.openTab);
    const full = await opened;
    expect(full.url()).toBe(ext.url(`preview.html?tabId=${tabId}&kind=resume`));
    await expect(full.locator('iframe[data-preview-frame]')).toBeVisible();
    await expect.poll(async () => (await ui.elements('dialog[data-document-dialog]')).length).toBe(0);
    await full.close();
    await ui.close();
  });

  test('opens the full-window preview page for a tab with no frame of ours', async ({ extContext, connected: ext, routeLog }) => {
    // A page off the applicant-tracking hosts that no script of ours recognises: no frame of ours answers there.
    const url = 'https://example.com/no-form';
    routeLog.serve({ [url]: { body: '<!doctype html><title>Nothing here</title><p>Nothing to apply to.</p>',
      contentType: 'text/html; charset=utf-8' } });
    const blank = await extContext.newPage();
    await blank.goto(url);
    const tabId = await ext.tabIdOf(blank);
    const opened = extContext.waitForEvent('page');
    expect(await ext.data({ v: 1, type: 'panel/openDocument', tabId, kind: 'resume', how: 'preview' }))
      .toEqual({ opened: true });
    const full = await opened;
    expect(full.url()).toBe(ext.url(`preview.html?tabId=${tabId}&kind=resume`));
    await full.close();
  });

  test('a web page cannot load the preview page at the extension’s fixed address', async ({ extContext, connected: ext, routeLog }) => {
    const url = at('dialog-probe');
    routeLog.serve({ [url]: PAGE_FILE });
    const page = await extContext.newPage();
    await page.goto(url);
    const fixed = ext.url('preview.html');
    expect(await page.evaluate(async (address) => {
      try {
        await fetch(address);
        return 'loaded';
      } catch {
        return 'refused';
      }
    }, fixed)).toBe('refused');
    // Nor a frame of it: Chrome shows its own error page in place of ours.
    await page.evaluate((address) => {
      const frame = document.createElement('iframe');
      frame.src = address;
      document.body.append(frame);
    }, fixed);
    await expect.poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-error://'))).toBe(true);
    expect(page.frames().some((frame) => frame.url() === fixed)).toBe(false);
  });

  test('confirms Edit on an uploaded resume over the page; Continue with Don’t show this again opens its editable copy, and Edit opens it at once from then on', async ({ extContext, connected: ext, routeLog }) => {
    const url = at('dialog-edit');
    routeLog.serve({ [url]: PAGE_FILE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await expect(panel.locator('[data-job-resume] button[data-job-action="edit"]')).toBeVisible();
    await ext.data({ v: 1, type: 'panel/setResume', tabId, resumeId: UPLOAD.id });
    await panel.locator('[data-job-resume] button[data-job-action="edit"]').click();
    const ui = await PageUi.of(page);
    await dialogOn(ui, 'confirm');
    expect((await ui.elements('dialog[data-document-dialog="confirm"] .text'))[0]?.text).toBe(WORDS.editText);
    const [box] = await ui.elements('[data-dialog-setting="dont-show"]');
    await ui.click(box!);
    const opened = extContext.waitForEvent('page');
    await ui.clickButton(WORDS.continue);
    const editor = await opened;
    expect(editor.url()).toBe(`${MOCK_ORIGIN}/resumes/${UPLOAD.id}/edit`);
    await editor.close();
    expect((await ext.data<{ settings: { ui: unknown } }>({ v: 1, type: 'settings/get' })).settings.ui)
      .toEqual({ skipUploadEditConfirm: true });
    // From then on: at once, no confirm.
    const again = extContext.waitForEvent('page');
    await panel.locator('[data-job-resume] button[data-job-action="edit"]').click();
    expect((await again).url()).toBe(`${MOCK_ORIGIN}/resumes/${UPLOAD.id}/edit`);
    expect(await ui.elements('dialog[data-document-dialog]')).toEqual([]);
    await ui.close();
  });
});
