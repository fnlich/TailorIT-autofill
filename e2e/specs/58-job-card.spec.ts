/*
 * The side panel's job card end to end (v2; docs/ARCHITECTURE.md "The job card" and "The custom question"), against the
 * mock's version 2 routes:
 * - before Autofill, the card shows the job, its match and the resume it attaches, from one lookup the form frame
 *   relayed (the page's own address, no posting text); Autofill then makes its own lookup and the card stays;
 * - the tracker's Applied (v4 ui: its badge alone), an unreadable resume (no score);
 * - a job TailorIT does not have: Add on the person's click (POST /jobs with the page's address), the added job then on
 *   the card; Add refused (closed, the ATS down), and no Add where TailorIT cannot add from the address;
 * - no Save to tracker for a job not tracked yet (v4 ui: submitting records it Applied);
 * - Change: the chosen resume goes with the lookup, and the résumé line names it;
 * - a single-page application's next posting in the same page: the card is read again for it (the Phase E review);
 * - a custom question answered from the card's resume, and a sensitive one never sent;
 * - a lookup that fails: the card says TailorIT could not say, and Autofill still works.
 * Nothing of the card is stored.
 */
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, type Extension } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import { CLEAN_DRAFT, example } from '../mock-server/mock.mjs';
import type { RouteLog } from '../routes.ts';

const FORM = 'fixtures/synthetic/policy-apply.html';
/** A Lever posting TailorIT can add from (its id is a posting id). */
const at = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000058${id}/apply`;
// The snapshot build of 2026-11-06 (core pass Z1, item 37): TailorIT is asked with the posting's canonical address,
// its own (adapters/tailorit-address.ts): a Lever application form's posting page.
const postingOf = (url: string) => url.replace(/\/apply$/, '');
const LOOKUP = 'POST /api/autofill/lookup';
const ADD = 'POST /api/autofill/jobs';
const DRAFT = 'POST /api/autofill/ai/draft';
const GOLDEN = example('AutofillLookupResponse') as { job: { title: string; companyName: string; location: string } };
const RESUMES = (example('AutofillResumeList') as { items: Array<{ id: string; label: string }> }).items;

const bodies = async (route: string) => (await mock.requestsTo(route)).map((request) => JSON.parse(request.body) as Record<string, unknown>);

/** The page at `url` and the side panel following its tab (the report page), once the form frame said hello. */
async function openPanel(ext: Extension, page: Page, routeLog: RouteLog, url: string) {
  routeLog.serve({ [url]: FORM });
  await page.goto(url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await ext.reportPage(tabId);
  return { tabId, panel, card: panel.locator('[data-job-card]') };
}

test.describe('the job card', () => {
  test('before Autofill shows the job, "75% match", its keywords and the resume, from one relayed lookup; Autofill adds its own', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = at('a1');
    const page = await extContext.newPage();
    const { tabId, panel, card } = await openPanel(ext, page, routeLog, url);
    // v3 Phase 3: the card says more than the "form found" strip, which goes; the page's own load looked it up.
    await expect(card).toHaveAttribute('data-job-state', 'found');
    await expect(panel.locator('[data-strip="form"]')).toHaveCount(0);
    await expect(card.locator('.tia-job__company')).toHaveText(GOLDEN.job.companyName);
    await expect(card.locator('.tia-job__title')).toHaveText(GOLDEN.job.title);
    await expect(card.getByRole('img', { name: COPY.job.matchLabel(75, COPY.job.bands.good) })).toBeVisible();
    // Its tip says what the score counts (v4 ui: the black bubble).
    await expect(card.locator('[data-match-tip]')).toHaveText(COPY.job.matchTip(9, 12));
    // v4 ui: the meta line "N days ago · location"; the resume is the résumé line's, under Autofill.
    await expect(card.locator('[data-job-meta]')).toContainText(GOLDEN.job.location);
    await expect(panel.locator('[data-job-resume]')).toContainText(GOLDEN_RESUME.label);
    // One lookup: the page's own load asked (with the posting's canonical address, no /apply and no query string: v3
    // Phase 3 review), or, once this run's lookups on load are used up (four a minute across every tab), the panel did
    // (with the page's address).
    const looked = await bodies(LOOKUP);
    expect(looked).toHaveLength(1);
    expect(looked[0]).toMatchObject({ includePostingText: false });
    expect([url, url.replace(/\/apply$/, '')]).toContain(looked[0]!.url);

    await ext.fill(page);
    expect((await ext.settled(tabId)).status).toBe('review');
    await expect.poll(async () => (await bodies(LOOKUP)).map((body) => body.includePostingText)).toEqual([false, true]);
    await expect(card).toHaveAttribute('data-job-state', 'found');
    // Nothing of the card is kept.
    const kept = JSON.stringify(await ext.storage());
    for (const text of [GOLDEN.job.title, GOLDEN.job.companyName, GOLDEN_RESUME.label, url]) expect(kept).not.toContain(text);
    await page.bringToFront();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: SYNTHETIC_LABELS['policy-apply'], applicationKey: applicationKeyOf(url) });
  });

  test('marks a posting the tracker holds as Applied with its badge alone, and no score for an unreadable resume (v4 ui)', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-applied');
    const { card } = await openPanel(ext, await extContext.newPage(), routeLog, at('a2'));
    await expect(card.locator('[data-job-applied]')).toHaveText(COPY.job.applied);
    // D1: no warning sentence, no chips.
    await expect(card.locator('[data-job-warning], .tia-job__chip')).toHaveCount(0);
    await expect(card.locator('[data-job-match]')).toHaveCount(0);
    await expect(card).not.toContainText(COPY.job.unreadable);
  });

  test('adds a job TailorIT does not have on the person’s click, and then shows it', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-not-found', { times: 1 });
    const url = at('a3');
    const { panel, card } = await openPanel(ext, await extContext.newPage(), routeLog, url);
    await expect(card).toHaveAttribute('data-job-state', 'not-found');
    await expect(card.locator('.tia-job__company')).toHaveText(COPY.job.notFound);
    await expect(card.locator('.tia-job__tile')).toHaveText('?');
    expect(await mock.requestsTo(ADD)).toEqual([]);
    await panel.getByRole('button', { name: COPY.mainView.addJob, exact: true }).click();
    await expect(card.locator('[data-job-outcome]')).toHaveText(COPY.job.addOutcomes.added);
    await expect(card).toHaveAttribute('data-job-state', 'found');
    await expect(card.locator('.tia-job__title')).toHaveText('Staff Platform Engineer');
    expect(await bodies(ADD)).toEqual([{ url: postingOf(url) }]);
    // The add's own lookup became the card: no lookup after it.
    expect(await mock.requestsTo(LOOKUP)).toHaveLength(1);
  });

  test('says why Add did not work, and offers no Add where TailorIT cannot add from the address', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-not-found');
    await tailorit.scenario('add-job-closed', { times: 1 });
    await tailorit.scenario('add-job-ats-down', { times: 1 });
    const { panel, card } = await openPanel(ext, await extContext.newPage(), routeLog, at('a4'));
    const add = panel.getByRole('button', { name: COPY.mainView.addJob, exact: true });
    await add.click();
    await expect(card.locator('[data-job-outcome]')).toHaveText(COPY.job.addOutcomes.closed);
    await add.click();
    await expect(card.locator('[data-job-outcome]')).toHaveText(COPY.job.addOutcomes.unavailable);
    expect(await mock.requestsTo(ADD)).toHaveLength(2);

    const elsewhere = await openPanel(ext, await extContext.newPage(), routeLog,
      'https://jobs.lever.co/tailorit-fixture/job-card-elsewhere/apply');
    await expect(elsewhere.card).toHaveAttribute('data-job-state', 'not-found');
    await expect(elsewhere.panel.getByRole('button', { name: COPY.mainView.addJob, exact: true })).toHaveCount(0);
    expect(await mock.requestsTo(ADD)).toHaveLength(2);
  });

  test('offers no Save to tracker for a job not tracked yet: submitting records it Applied (v4 ui)', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-untracked', { times: 1 });
    const url = at('a5');
    const { panel, card } = await openPanel(ext, await extContext.newPage(), routeLog, url);
    await expect(card).toHaveAttribute('data-job-state', 'found');
    await expect(panel.getByRole('button', { name: COPY.job.save, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: COPY.mainView.addJob, exact: true })).toHaveCount(0);
    expect(await bodies(ADD)).toEqual([]);
  });

  test('Change: the chosen resume goes with the lookup, and the résumé line names it', async ({ extContext, connected: ext, routeLog }) => {
    const { panel } = await openPanel(ext, await extContext.newPage(), routeLog, at('a6'));
    const line = panel.locator('[data-job-resume]');
    await expect(line.locator('[data-resume-label]')).toHaveText(GOLDEN_RESUME.label);
    await line.getByRole('button', { name: COPY.job.change, exact: true }).click();
    // v1.5 X (PLAN decision 6): in folders, by how TailorIT made each; the attached one's folder open, the others
    // folded until the person opens them.
    const folders = panel.locator('[data-resume-folder]');
    await expect(folders).toHaveCount(3);
    for (const folder of await folders.all()) {
      const head = folder.locator('.tia-folder__head');
      if (await head.isEnabled() && await head.getAttribute('aria-expanded') === 'false') await head.click();
    }
    const choices = panel.locator('[data-resume-choice=""]');
    await expect(choices).toHaveCount(RESUMES.length);
    const other = RESUMES.find((resume) => resume.id !== GOLDEN_RESUME.id)!;
    await choices.filter({ hasText: other.label }).click();
    await expect(line.locator('[data-resume-label]')).toHaveText(other.label);
    await expect.poll(async () => (await bodies(LOOKUP)).at(-1)?.resumeId).toBe(other.id);
  });

  test('reads the card again when a single-page application shows another posting in the same page, never the old one', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    const first = at('b1');
    const page = await extContext.newPage();
    const { card } = await openPanel(ext, page, routeLog, first);
    await expect(card).toHaveAttribute('data-job-state', 'found');
    await expect(card.locator('.tia-job__title')).toHaveText(GOLDEN.job.title);
    // The page moves to the next posting without loading (history.pushState): its card is read for the new address.
    await tailorit.scenario('lookup-not-found', { times: 1 });
    const second = at('b2');
    await page.evaluate((next) => history.pushState({}, '', next), second);
    await expect(card).toHaveAttribute('data-job-state', 'not-found');
    // The first may be the page's own load's, with its posting's canonical address (no /apply).
    const posting = (address: unknown) => String(address).replace(/\/apply$/, '');
    expect((await bodies(LOOKUP)).map((body) => [posting(body.url), body.includePostingText]))
      .toEqual([[posting(first), false], [posting(second), false]]);
    // The count that told the worker is no address: neither one is kept.
    const kept = JSON.stringify(await ext.storage());
    for (const url of [first, second]) expect(kept).not.toContain(url);
  });

  test('answers a custom question from the card’s resume, and never sends a sensitive one', async ({ extContext, connected: ext, routeLog }) => {
    const { panel } = await openPanel(ext, await extContext.newPage(), routeLog, at('a7'));
    await expect(panel.locator('[data-job-card]')).toHaveAttribute('data-job-state', 'found');
    await panel.getByRole('button', { name: COPY.mainView.ask, exact: true }).click();
    const box = panel.getByLabel(COPY.ask.label);
    await box.fill('Why do you want to work at Northwind?');
    await panel.getByRole('button', { name: COPY.ask.submit, exact: true }).click();
    const answer = panel.locator('[data-ask-answer]');
    await expect(answer).toContainText(COPY.ask.writtenFrom(GOLDEN_RESUME.label));
    await expect(answer).toContainText(CLEAN_DRAFT.slice(0, 40));
    const [draft] = await bodies(DRAFT);
    expect(draft).toMatchObject({ questions: [{ key: 'custom-question', question: 'Why do you want to work at Northwind?',
      maxLength: 1500 }], resumeId: GOLDEN_RESUME.id, company: GOLDEN.job.companyName, jobTitle: GOLDEN.job.title });
    expect(String(draft!.jobText)).toContain('Platform Engineer');

    await box.fill('Will you now or in the future require visa sponsorship?');
    await panel.getByRole('button', { name: COPY.ask.submit, exact: true }).click();
    await expect(panel.locator('[data-ask-refused]')).toHaveText(COPY.ask.outcomes.sensitive);
    expect(await mock.requestsTo(DRAFT)).toHaveLength(1);
    expect(JSON.stringify(await ext.storage())).not.toContain('Northwind?');
  });

  test('says TailorIT could not say which job it is when the lookup fails, and Autofill still works', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-fails');
    const page = await extContext.newPage();
    const { tabId, card } = await openPanel(ext, page, routeLog, at('a8'));
    await expect(card).toHaveAttribute('data-job-state', 'unavailable');
    await expect(card.locator('.tia-job')).toHaveText(COPY.job.unavailable);
    await ext.fill(page);
    expect((await ext.settled(tabId)).status).toBe('review');
  });
});
