/*
 * The resume transfer end to end (docs/ARCHITECTURE.md "Resume transfer" and "Port resume"). The worker fetches the
 * golden PDF from the mock, checks its SHA-256 against X-TailorIT-Sha256, and sends it over the `resume` port; the
 * content script rebuilds the File and puts it into the input with DataTransfer. Checked from the page: the file's
 * name, type and size, and a SHA-256 computed in the page.
 * - The worker stopped in the middle (stop-worker.ts) while it waits on the file: the port drops, the content script
 *   starts again from scratch once, a new worker (the run is still known from storage.session) reads the lookup again
 *   and sends the file, and the field ends verified. (v2: the side panel's job card made one lookup of its own, through
 *   the form frame, before the fill.)
 * - A digest that does not match, and a lookup that suggests no resume: the worker refuses (resume-unavailable), which
 *   is final, and the input is never touched.
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { GOLDEN_RESUME, mock, RESUME_FILE_ROUTE } from '../helpers/mock.ts';
import { eventsOn, fileHeld } from '../helpers/page-state.ts';
import { stopWorker } from '../helpers/stop-worker.ts';

const PAGE_FILE = 'fixtures/synthetic/resume-upload.html';
const LABELS = SYNTHETIC_LABELS['resume-upload'];
const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const GOLDEN_FILE = { count: 1, name: GOLDEN_RESUME.fileName, type: GOLDEN_RESUME.mime, size: GOLDEN_RESUME.size,
  sha256: GOLDEN_RESUME.sha256 };

test.describe('the resume transfer', () => {
  test('survives the worker being stopped in the middle: one retry from scratch, and the file arrives whole', async ({ extContext, extensionId, connected: ext, routeLog, logs, tailorit }) => {
    const url = at('resume-upload');
    routeLog.serve({ [url]: PAGE_FILE });
    // The first file request waits, so the worker is still fetching when it is stopped.
    await tailorit.scenario('resume-slow', { times: 1, delayMs: 15_000 });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    // The report page's panel port would start the worker again the moment it stops: close it, so the stop holds.
    await ext.closeReportPages();
    await expect.poll(async () => (await mock.requestsTo(RESUME_FILE_ROUTE)).length, { timeout: 20_000 }).toBe(1);
    await stopWorker(extContext, await ext.page(), extensionId);
    // Nothing of the extension's is asked until the content script's own retry has reached a new worker, which
    // fetches the file again (the mock is asked, not the extension).
    await expect.poll(async () => (await mock.requestsTo(RESUME_FILE_ROUTE)).length, { timeout: 30_000 }).toBe(2);

    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(row(report, 'Resume')).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true });
    expect(await fileHeld(page, '#resume')).toEqual(GOLDEN_FILE);
    await expect(page.locator('#resume-name')).toHaveText(GOLDEN_RESUME.fileName);
    await expect(page.locator('#resume-digest')).toHaveText(GOLDEN_RESUME.sha256);
    expect(await page.evaluate(() => (window as unknown as { __resumeChanges: number }).__resumeChanges)).toBe(1);
    // The first fetch died with its worker; the retry fetched again, from a worker that read the lookup afresh.
    const files = await mock.requestsTo(RESUME_FILE_ROUTE);
    expect(files.map((request) => request.status)).toEqual([0, 200]);
    // The card's lookup (v2) and the new worker's ask without the posting text; run/begin's with it.
    const lookups = (await mock.requestsTo('POST /api/autofill/lookup'))
      .map((request) => (JSON.parse(request.body) as { includePostingText: boolean }).includePostingText);
    expect(lookups.filter((withText) => withText)).toHaveLength(1);
    expect(lookups.filter((withText) => !withText)).toHaveLength(2);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test("refuses bytes whose SHA-256 is not TailorIT's, and never touches the input", async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    const url = at('resume-hash');
    routeLog.serve({ [url]: PAGE_FILE });
    await tailorit.scenario('resume-hash-mismatch');
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Resume')).toMatchObject({ reason: 'resume-unavailable', wrote: false });
    expect(['flagged', 'blocked']).toContain(row(report, 'Resume').status);
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(await fileHeld(page, '#resume')).toBeNull();
    expect(await eventsOn(page, '#resume')).toEqual([]);
    // A refusal is final: the file was fetched once.
    expect((await mock.requestsTo(RESUME_FILE_ROUTE)).length).toBe(1);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('has nothing to attach when TailorIT suggests no resume and the profile names none', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    const url = at('resume-none');
    routeLog.serve({ [url]: PAGE_FILE });
    await tailorit.scenario('lookup-no-resume');
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Resume')).toMatchObject({ reason: 'resume-unavailable', wrote: false });
    expect(await fileHeld(page, '#resume')).toBeNull();
    expect(await eventsOn(page, '#resume')).toEqual([]);
    expect(await mock.requestsTo(RESUME_FILE_ROUTE)).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });
});
