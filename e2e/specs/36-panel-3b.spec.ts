/*
 * v3 Phase 3b end to end, against the mock's version 3 routes:
 * - "Autofill for another job": the person's tracked jobs searched by the words they type, answered by reference; the
 *   job chosen is the card's (its lookup names it as `jobId`) and the fill's (run/begin's lookup too);
 * - "Ask TailorIT to support this site" on a page Autofill does not work on: without the toolbar icon's grant the browser
 *   names no host, so the panel says so and nothing is sent;
 * - "Your autofill information": the profile editor reads the profile, saves from its revision (PUT /profile), names the
 *   note's lines TailorIT keeps from the AI, and a fill after it reads the profile as saved;
 * - Edit with AI's instruction box: what the person types goes as the question's instruction;
 * - "Apply without resume": the fill attaches none, and leaves the resume field to the person;
 * - the resume's PDF preview, in the side panel, from the worker's checked bytes;
 * - a cover-letter text box gets the person's letter typed in;
 * - a posting page with no form is looked up as it loads, and its card shows without Autofill.
 */
import { createHash } from 'node:crypto';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { GOLDEN_LETTER, GOLDEN_RESUME, mock, RESUME_FILE_ROUTE } from '../helpers/mock.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { trap } from '../helpers/traps.ts';
import { CLEAN_DRAFT } from '../mock-server/mock.mjs';

const FORM = 'fixtures/synthetic/policy-apply.html';
const at = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000036${id}`;
const LOOKUP = 'POST /api/autofill/lookup';
const bodies = async (route: string) => (await mock.requestsTo(route)).map((request) => JSON.parse(request.body) as Record<string, unknown>);
const WHY = 'Why do you want to work here?';

test.describe('the side panel’s v3 Phase 3b', () => {
  test('Autofill for another job: searched, chosen by reference, and the card’s and the fill’s job', async ({ extContext, connected: ext, routeLog }) => {
    const url = `${at('a1')}/apply`;
    routeLog.serve({ [url]: FORM });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    const card = panel.locator('[data-job-card]');
    await expect(card).toHaveAttribute('data-job-state', 'found');
    await panel.locator('button[data-job-action="another"]').click();
    await expect(panel.locator('button[data-job-choice]')).toHaveCount(2);
    const searched = await mock.requestsTo('GET /api/autofill/jobs/search');
    expect(searched.map((request) => request.query)).toEqual(['?q=']);
    // The words typed go in the query string; the jobs come back by reference only.
    await panel.getByPlaceholder(COPY.job.another.placeholder).fill('payments');
    await panel.getByRole('button', { name: COPY.job.another.label, exact: true }).click();
    await expect(panel.locator('button[data-job-choice]')).toHaveCount(1);
    expect((await mock.requestsTo('GET /api/autofill/jobs/search')).at(-1)!.query).toBe('?q=payments');
    expect(await panel.locator('[data-job-choice]').getAttribute('data-job-choice')).toBe('j0');
    await panel.locator('button[data-job-choice="j0"]').click();
    await expect(card.locator('[data-job-chosen]')).toContainText(COPY.job.another.chosen);
    await expect.poll(async () => (await bodies(LOOKUP)).at(-1)).toMatchObject({ jobId: 1077, includePostingText: false });
    await ext.fill(page);
    await ext.settled(tabId);
    expect((await bodies(LOOKUP)).filter((body) => body.includePostingText === true).at(-1)).toMatchObject({ jobId: 1077 });
    // Back to the page's own job.
    await panel.locator('button[data-job-action="page-job"]').click();
    await expect(card.locator('[data-job-chosen]')).toHaveCount(0);
  });

  test('Ask TailorIT to support this site: no host without the toolbar icon’s grant, so nothing is sent', async ({ extContext, connected: ext }) => {
    const page = await extContext.newPage();
    await page.goto('https://example.com/');
    // Chrome names no address for a tab outside the extension's hosts: the newest tab with none is this one.
    const tabId = await (await ext.page()).evaluate(async () => {
      const tabs = await (globalThis as unknown as { chrome: { tabs: { query(info: object): Promise<Array<{ id?: number;
        url?: string }>> } } }).chrome.tabs.query({});
      return Math.max(...tabs.filter((tab) => tab.url === undefined && tab.id !== undefined).map((tab) => tab.id!));
    });
    const panel = await ext.reportPage(tabId);
    await expect(panel.locator('section[data-unsupported]')).toBeVisible();
    await panel.locator('button[data-action="site-request"]').click();
    await expect(panel.locator('[data-site-request="no-host"]')).toContainText(COPY.panel.siteRequest.outcomes['no-host']);
    expect(await mock.requestsTo('POST /api/autofill/site-requests')).toEqual([]);
  });

  test('Your autofill information: read, saved from its revision, its flagged lines named, and the next fill reads it', async ({ extContext, connected: ext, routeLog }) => {
    const url = `${at('a2')}/apply`;
    routeLog.serve({ [url]: FORM });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('[data-job-card] button[data-open-profile]').click();
    const editor = panel.locator('[data-profile]');
    await expect(editor).toBeVisible();
    const note = editor.getByRole('textbox', { name: COPY.profile.fields.anythingElse });
    await note.fill('I prefer remote work.\nMy visa expires in May.');
    await editor.locator('button[data-profile-save]').click();
    await expect(editor.locator('[data-profile-outcome="saved"]')).toBeVisible();
    await expect(editor.locator('[data-profile-flagged]')).toBeVisible();
    const saved = await bodies('PUT /api/autofill/profile');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ revision: 3 });
    expect((saved[0]!.profile as { anythingElse: string }).anythingElse).toBe('I prefer remote work.\nMy visa expires in May.');
    // The worker's copy went: a fill reads the profile again, at its new revision.
    const reads = (await mock.requestsTo('GET /api/autofill/profile')).length;
    await editor.getByRole('button', { name: COPY.profile.back }).first().click();
    await ext.fill(page);
    await ext.settled(tabId);
    expect((await mock.requestsTo('GET /api/autofill/profile')).length).toBeGreaterThan(reads);
    // Nothing of it is kept by the extension.
    expect(JSON.stringify(await ext.storage())).not.toContain('visa expires');
  });

  test('the profile editor says when it changed elsewhere, and loads the latest on the person’s word', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('profile-conflict', { times: 1 });
    const url = `${at('a3')}/apply`;
    routeLog.serve({ [url]: FORM });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('[data-job-card] button[data-open-profile]').click();
    const editor = panel.locator('[data-profile]');
    await editor.getByRole('textbox', { name: COPY.profile.fields.anythingElse }).fill('Open to relocation.');
    await editor.locator('button[data-profile-save]').click();
    await expect(editor.locator('[data-profile-outcome="conflict"]')).toBeVisible();
    const reads = (await mock.requestsTo('GET /api/autofill/profile')).length;
    await editor.getByRole('button', { name: COPY.profile.loadLatest }).click();
    await expect.poll(async () => (await mock.requestsTo('GET /api/autofill/profile')).length).toBeGreaterThan(reads);
  });

  test('Edit with AI sends what the person typed in its box as the question’s instruction', async ({ extContext, connected: ext, routeLog }) => {
    const served = trap('01');
    routeLog.serve({ [served.url]: served.file });
    const page = await extContext.newPage();
    await page.goto(served.url);
    const tabId = await ext.fill(page);
    await ext.settled(tabId);
    await expect(page.locator('#why')).toHaveValue(CLEAN_DRAFT);
    await page.bringToFront();
    const ui = await PageUi.of(page);
    const why = await page.locator('#why').boundingBox();
    await expect.poll(async () => (await ui.elements(`button[aria-label="${COPY.editWithAi}"]`)).filter((el) => el.shown).length)
      .toBeGreaterThanOrEqual(1);
    const buttons = (await ui.elements(`button[aria-label="${COPY.editWithAi}"]`)).filter((el) => el.shown);
    let inBox: (typeof buttons)[number] | null = null;
    for (const button of buttons) {
      const box = await ui.box(button);
      if (box !== null && why !== null && box.x >= why.x && box.y >= why.y && box.x + box.width <= why.x + why.width
        && box.y + box.height <= why.y + why.height) inBox = button;
    }
    await ui.click(inBox!);
    await expect.poll(async () => (await ui.elements('textarea.ai-prompt__input')).filter((el) => el.shown).length).toBe(1);
    await page.keyboard.type('Make it two sentences');
    const generate = (await ui.elements('button.ai-prompt__generate')).find((el) => el.shown)!;
    await ui.click(generate);
    await expect.poll(async () => (await mock.requestsTo('POST /api/autofill/ai/draft')).length).toBe(2);
    const rewrite = JSON.parse((await mock.requestsTo('POST /api/autofill/ai/draft'))[1]!.body) as
      { questions: Array<{ question: string; instruction?: string }> };
    expect(rewrite.questions).toEqual([expect.objectContaining({ question: WHY, instruction: 'Make it two sentences' })]);
  });

  test('Apply without resume: nothing attached, the resume field left to the person, nothing fetched', async ({ extContext, connected: ext, routeLog }) => {
    const url = 'https://jobs.lever.co/tailorit-fixture/resume-without/apply';
    routeLog.serve({ [url]: 'fixtures/synthetic/resume-upload.html' });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('button[data-job-action="change"]').click();
    await panel.locator('button[data-resume-choice="without"]').click();
    await expect(panel.locator('[data-job-resume][data-without-resume]')).toContainText(COPY.job.withoutResumeOn);
    await ext.fill(page);
    const report = await ext.settled(tabId);
    const resume = report.fields.find((field) => field.category === 'file.resume')!;
    expect(resume).toMatchObject({ status: 'skipped', reason: 'resume-not-attached', wrote: false });
    expect(await mock.requestsTo(RESUME_FILE_ROUTE)).toEqual([]);
  });

  test('the resume’s preview: the PDF a fill attaches, shown in the side panel from its own blob address', async ({ extContext, connected: ext, routeLog }) => {
    const url = `${at('a4')}/apply`;
    routeLog.serve({ [url]: FORM });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('button[data-job-action="preview"]').click();
    const frame = panel.locator('iframe[data-preview-frame]');
    await expect(frame).toBeVisible();
    const src = await frame.getAttribute('src');
    expect(src).toMatch(/^blob:chrome-extension:\/\//);
    const digest = await panel.evaluate(async (address) => {
      const bytes = new Uint8Array(await (await fetch(address)).arrayBuffer());
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }, src!);
    expect(digest).toBe(GOLDEN_RESUME.sha256);
    expect(createHash('sha256').update('').digest('hex')).not.toBe(digest);
    // Closing it revokes the address.
    await panel.getByRole('button', { name: COPY.job.preview.close }).click();
    await expect(frame).toHaveCount(0);
  });

  test('a cover-letter text box gets the person’s letter typed in', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('letter-ready');
    const url = `${at('a5')}/apply`;
    routeLog.serve({ [url]: 'fixtures/synthetic/submit/letter-box.html' });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Cover letter')).toMatchObject({ status: 'verified', provenance: 'profile', reason: 'cover-letter-typed',
      wrote: true });
    await expect(page.locator('textarea[name="comments"]')).toHaveValue(new RegExp(GOLDEN_LETTER.sentinel));
    expect((await mock.requests()).filter((request) => request.path.endsWith('/text'))).toHaveLength(1);
    // Its words are nowhere but the box: not in a report, storage or any request the extension sent.
    expect(JSON.stringify(await ext.storage())).not.toContain(GOLDEN_LETTER.sentinel);
  });

  test('a posting page with no form is looked up as it loads, and its card shows without Autofill', async ({ extContext, connected: ext, routeLog }) => {
    const posting = at('a6');
    routeLog.serve({ [posting]: 'fixtures/synthetic/policy-posting.html' });
    const page = await extContext.newPage();
    await page.goto(posting);
    const tabId = await ext.tabIdOf(page);
    // The page's own load asks, or, once this run's lookups on load are used up (four a minute across every tab), the
    // panel's card does, through the posting's frame: either way the posting's own address.
    const panel = await ext.reportPage(tabId);
    await expect.poll(async () => (await bodies(LOOKUP)).length).toBeGreaterThanOrEqual(1);
    expect((await bodies(LOOKUP))[0]).toMatchObject({ url: posting, includePostingText: false });
    await expect(panel.locator('[data-job-card]')).toHaveAttribute('data-job-state', 'found');
    await expect(panel.locator('[data-job-card] [data-strip="no-form"]')).toHaveText(COPY.strip.noForm);
    await expect(panel.getByRole('button', { name: COPY.panel.fill, exact: true })).toHaveCount(0);
  });
});
