/*
 * v1.4 F end to end, against the mock's tailoring routes (the contract of TailorIT builder D's 32900ee): the side
 * panel's "Tailor Resume For This Job" starts TailorIT's tailoring for the tab's job (the lookup's job id and the
 * resume the card attaches), its step shows while it runs, and once done the card names the tailored resume; the
 * next Autofill attaches that resume (its file, under its own name). Preview (v1.5 X) shows it in a dialog over the job
 * page, in a frame of the extension's own, with the PDF from that frame's own blob: address.
 */
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import { fileHeld } from '../helpers/page-state.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { dialogOn, previewFrameOn, shownDigest } from '../helpers/document-dialog.ts';
import { example, TAILOR_LINE, TAILORED_RESUME } from '../mock-server/mock.mjs';

const PAGE_FILE = 'fixtures/synthetic/resume-upload.html';
const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const JOB_ID = (example('AutofillLookupResponse') as { job: { id: number } }).job.id;

test.describe('tailoring on the job card (v1.4 F)', () => {
  test('Tailor resume for this job, done, then Autofill attaches the tailored resume; Preview over the page (v1.5 X)', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    // One running read past the first, so the step shows.
    await tailorit.scenario('tailor-slow', { times: 1, value: 2 });
    const url = at('tailor-resume');
    routeLog.serve({ [url]: PAGE_FILE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await expect(panel.locator('[data-job-resume] [data-resume-label]')).toHaveText(GOLDEN_RESUME.label);
    const start = panel.locator('button[data-tailor-action="resume"]');
    await expect(start).toHaveText(COPY.tailor.start.resume);
    // Held until shown CONTROL_SEEN_MS, then the person's click.
    await expect(start).toBeEnabled();
    await start.click();
    await expect(panel.locator('[data-tailor="resume"] [data-tailor-step]')).toHaveText(TAILOR_LINE, { timeout: 15_000 });
    await expect(panel.locator('[data-tailor="resume"] [data-tailor-done]')).toContainText(TAILORED_RESUME.label,
      { timeout: 20_000 });
    // The lookup's job and the attached resume; no page text, no templates (the profile's), no letter.
    const posted = (await mock.requestsTo('POST /api/autofill/tailor')).map((request) => JSON.parse(request.body) as unknown);
    expect(posted).toEqual([{ jobId: JOB_ID, resumeId: GOLDEN_RESUME.id, coverLetter: false }]);
    // The card names the tailored resume: the tab's choice now.
    await expect(panel.locator('[data-job-resume] [data-resume-label]')).toHaveText(TAILORED_RESUME.label);

    // Preview (v1.5 X): the dialog over the job page, the tailored resume drawn in the extension's own frame from the
    // worker's checked bytes, under its own file name; no tab opened, and no frame the page's scripts can reach.
    const tabs = extContext.pages().length;
    await panel.locator('[data-job-resume] button[data-job-action="preview"]').click();
    const ui = await PageUi.of(page);
    await dialogOn(ui, 'preview');
    expect((await ui.elements('[data-document-file]'))[0]?.text).toBe(TAILORED_RESUME.fileName);
    expect((await ui.elements('[role="tab"][aria-selected="true"]'))[0]?.text).toBe(COPY.documentDialog.tabs.resume);
    expect((await shownDigest(await previewFrameOn(page, 'resume'))).src).toMatch(/^blob:chrome-extension:\/\//);
    expect(extContext.pages()).toHaveLength(tabs);
    expect(await page.locator('iframe').count()).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await ui.elements('dialog[data-document-dialog]')).length).toBe(0);
    await ui.close();

    // The next Autofill attaches the tailored resume.
    await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Resume')).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true });
    expect((await fileHeld(page, '#resume'))?.name).toBe(TAILORED_RESUME.fileName);
    const files = await mock.requestsTo('GET /api/autofill/resumes/*');
    expect(files.at(-1)?.path).toBe(`/api/autofill/resumes/${TAILORED_RESUME.id}/file`);
  });

  test('an upload with no editable copy says so, with the way to make one in TailorIT', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('tailor-needs-copy', { times: 1 });
    const url = at('tailor-copy');
    routeLog.serve({ [url]: PAGE_FILE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    const start = panel.locator('button[data-tailor-action="resume"]');
    await expect(start).toBeEnabled();
    await start.click();
    const failed = panel.locator('[data-tailor-failed="needs-copy"]');
    await expect(failed).toContainText(COPY.tailor.failures['needs-copy']);
    await expect(failed.locator('a[data-tailor-copy]')).toHaveAttribute('href', /\/documents$/);
    // Nothing changed: the card attaches the same resume.
    await expect(panel.locator('[data-job-resume] [data-resume-label]')).toHaveText(GOLDEN_RESUME.label);
  });
});
