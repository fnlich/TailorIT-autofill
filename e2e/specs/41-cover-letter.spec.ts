/*
 * Cover letters end to end (Phase G; docs/ARCHITECTURE.md "Cover letters"), against the mock's three routes: the worker
 * asks TailorIT for the job's letter (the lookup's job, the page's visible text, the resume the fill attaches), polls
 * it while TailorIT writes it, and sends its PDF over the resume port; the content script puts it into the
 * cover-letter upload. Checked from the page: the file's name, type and size, and a SHA-256 computed in the page.
 * - TailorIT's AI writes it during the fill: attached, its row marked as the AI's.
 * - A posting that forbids AI (profile only, the default): only a letter the person wrote is asked for and attached;
 *   with none, the field is flagged and nothing is written.
 * - A letter TailorIT could not write: flagged, the input untouched, no file asked for.
 * - A dry run: nothing generated or written; the row says a fill would have TailorIT's AI write one.
 * - The side panel's job card says whose letter a fill attaches.
 * - Privacy: no word of the letter in a report, RunState, the extension's storage, a console message or any request
 *   the extension made; it is only in the bytes the input holds (assertTrapInvariants, besides).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row, type Extension } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { GOLDEN_LETTER, GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import { eventsOn, fileHeld } from '../helpers/page-state.ts';
import { example } from '../mock-server/mock.mjs';
import type { ConsoleEntry } from '../helpers/console.ts';
import type { RouteLog } from '../routes.ts';

const PAGE_FILE = 'fixtures/synthetic/cover-letter-upload.html';
const LABELS = SYNTHETIC_LABELS['cover-letter-upload'];
const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const POST = 'POST /api/autofill/cover-letters';
const STATE = 'GET /api/autofill/cover-letters/*';
const GOLDEN_JOB = (example('AutofillLookupResponse') as { job: { id: number; title: string; companyName: string } }).job;
const LETTER_FILE = { count: 1, name: GOLDEN_LETTER.fileName, type: GOLDEN_LETTER.mime, size: GOLDEN_LETTER.size,
  sha256: GOLDEN_LETTER.sha256 };
const NO_AI = '<p>Please do not use AI tools to apply.</p>';

const bodies = async () => (await mock.requestsTo(POST)).map((request) => JSON.parse(request.body) as Record<string, unknown>);
/** The bodies, each kind once: the side panel's card asks too (generate false), as the fill opens it. */
const kinds = async () => [...new Set((await bodies()).map((body) => JSON.stringify(body)))]
  .map((text) => JSON.parse(text) as Record<string, unknown>);
/** What the card's own check, and any ask that may not write, sends: the job and the resume, nothing of the page. */
const OWN_ONLY = { jobId: GOLDEN_JOB.id, company: GOLDEN_JOB.companyName, jobTitle: GOLDEN_JOB.title,
  resumeId: GOLDEN_RESUME.id, generate: false };
const fileRequests = async () => (await mock.requestsTo(STATE)).filter((request) => request.path.endsWith('/file'));

/** The page at its own address, with `policy` in place of its POLICY comment. */
async function open(page: Page, routeLog: RouteLog, name: string, policy = ''): Promise<string> {
  const url = at(name);
  routeLog.serve({ [url]: { body: readFileSync(PAGE_FILE, 'utf8').replace('<!--POLICY-->', policy),
    contentType: 'text/html; charset=utf-8' } });
  await page.goto(url);
  return url;
}

/** No word of the letter outside the bytes the input holds: reports, storage, the console, the extension's requests. */
async function letterKeptToTheInput(ext: Extension, tabId: number, console: readonly ConsoleEntry[]): Promise<void> {
  const requests = (await mock.requests()).map((request) => `${request.path} ${request.body}`).join('\n');
  const places = { reports: JSON.stringify(await ext.reports(tabId)), storage: JSON.stringify(await ext.storage()),
    console: console.map((entry) => entry.text).join('\n'), requests };
  for (const [where, text] of Object.entries(places)) {
    expect(text.includes(GOLDEN_LETTER.sentinel), `the letter's words in ${where}`).toBe(false);
    expect(text.includes('Dear Northwind hiring team'), `the letter's words in ${where}`).toBe(false);
  }
}

test.describe('cover letters', () => {
  test('TailorIT writes the letter during the fill: polled, sent whole and attached, marked as the AI’s', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('letter-generating-then-ready', { times: 1, delayMs: 4_000 });
    const page = await extContext.newPage();
    const url = await open(page, routeLog, 'cover-letter-written');
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(row(report, 'Cover letter')).toMatchObject({ category: 'file.coverLetter', status: 'verified',
      provenance: 'profile', reason: 'cover-letter-written', wrote: true });
    expect(await fileHeld(page, '#cover_letter')).toEqual(LETTER_FILE);
    await expect(page.locator('#cover-letter-name')).toHaveText(GOLDEN_LETTER.fileName);
    await expect(page.locator('#cover-letter-digest')).toHaveText(GOLDEN_LETTER.sha256);
    expect(await page.evaluate(() => (window as unknown as { __uploadChanges: Record<string, number> }).__uploadChanges))
      .toEqual({ resume: 1, cover_letter: 1 });
    // The resume is the resume.
    expect(await fileHeld(page, '#resume')).toMatchObject({ name: GOLDEN_RESUME.fileName, sha256: GOLDEN_RESUME.sha256 });

    // The fill asked once: the lookup's job, the page's visible text, the resume the fill attaches, TailorIT's AI
    // allowed. The side panel's card only asked whether the person has one.
    const [asked, ...more] = (await bodies()).filter((body) => body.generate === true);
    expect(more).toEqual([]);
    expect((await bodies()).filter((body) => body.generate !== true)).toEqual([OWN_ONLY]);
    expect(asked).toMatchObject({ jobId: GOLDEN_JOB.id, company: GOLDEN_JOB.companyName, jobTitle: GOLDEN_JOB.title,
      resumeId: GOLDEN_RESUME.id, generate: true });
    expect(String(asked!.jobText)).toContain('Northwind builds ordering software for restaurants.');
    expect(String(asked!.jobText)).not.toContain('Full name');
    // Polled while written (every 2 s, under TailorIT's 120 a minute), and its file asked for once.
    const polls = (await mock.requestsTo(STATE)).filter((request) => !request.path.endsWith('/file'));
    expect(polls.length).toBeGreaterThanOrEqual(2);
    expect(polls.length).toBeLessThanOrEqual(10);
    expect((await fileRequests()).map((request) => request.status)).toEqual([200]);
    await letterKeptToTheInput(ext, tabId, logs());
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('a posting that forbids AI: only the person’s own letter is asked for, and attached as theirs', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('letter-ready');
    const page = await extContext.newPage();
    const url = await open(page, routeLog, 'cover-letter-own', NO_AI);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(noticeCount(report, 'policy-profile-only')).toBe(1);
    expect(row(report, 'Cover letter')).toMatchObject({ status: 'verified', reason: 'cover-letter-attached', wrote: true });
    expect(await fileHeld(page, '#cover_letter')).toEqual(LETTER_FILE);
    // generate false, and no page text or canaries sent with it (the card's check and the fill's alike); no AI
    // request either.
    expect(await kinds()).toEqual([OWN_ONLY]);
    expect(await mock.requestsTo('POST /api/autofill/ai/*'), 'an AI request').toEqual([]);
    await letterKeptToTheInput(ext, tabId, logs());
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('a posting that forbids AI, and no letter of the person’s: the field is flagged and nothing is written', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('letter-none');
    const page = await extContext.newPage();
    const url = await open(page, routeLog, 'cover-letter-none', NO_AI);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Cover letter')).toMatchObject({ status: 'flagged', reason: 'cover-letter-none', wrote: false,
      provenance: null });
    expect(await fileHeld(page, '#cover_letter')).toBeNull();
    expect(await eventsOn(page, '#cover_letter')).toEqual([]);
    expect(await kinds()).toEqual([OWN_ONLY]);
    expect(await fileRequests()).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('a letter TailorIT could not write: flagged with why, the input untouched', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('letter-failed');
    const page = await extContext.newPage();
    const url = await open(page, routeLog, 'cover-letter-failed');
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'Cover letter')).toMatchObject({ status: 'flagged', reason: 'cover-letter-failed', wrote: false });
    expect(await fileHeld(page, '#cover_letter')).toBeNull();
    expect(await eventsOn(page, '#cover_letter')).toEqual([]);
    expect(await fileRequests()).toEqual([]);
    // The rest of the form fills as ever.
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('a dry run generates and writes nothing, and says a fill would have TailorIT’s AI write one', async ({ extContext, connected: ext, routeLog, logs }) => {
    const page = await extContext.newPage();
    const url = await open(page, routeLog, 'cover-letter-dry');
    const tabId = await ext.fill(page, { dryRun: true });
    const report = await ext.settled(tabId, { mode: 'dry-run' });
    expect(row(report, 'Cover letter')).toMatchObject({ status: 'verified', reason: 'cover-letter-would-write',
      wrote: false, verification: 'not-checked' });
    expect(await fileHeld(page, '#cover_letter')).toBeNull();
    expect(await eventsOn(page, '#cover_letter')).toEqual([]);
    // Only asked whether the person has one: nothing written, no page text sent, no file asked for.
    expect(await kinds()).toEqual([OWN_ONLY]);
    expect(await mock.requestsTo(STATE)).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('the side panel’s job card says whose letter a fill attaches, and writes one on Write it now', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    await open(page, routeLog, 'cover-letter-card');
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    const letter = panel.locator('[data-job-letter]');
    await expect(letter).toHaveAttribute('data-letter-outcome', 'none');
    await expect(letter).toContainText(COPY.job.letter.whenAsked);
    expect(await bodies()).toEqual([OWN_ONLY]);
    await letter.getByRole('button', { name: COPY.job.letter.write }).click();
    await expect(letter).toHaveAttribute('data-letter-outcome', 'written', { timeout: 15_000 });
    await expect(letter.locator('[role="status"]')).toHaveText(COPY.job.letter.ready);
    const [, written] = await bodies();
    expect(written).toMatchObject({ generate: true, jobId: GOLDEN_JOB.id });
    expect(String(written!.jobText)).toContain('Northwind builds ordering software for restaurants.');
    // Nothing of the letter on the card but its state.
    await expect(letter).not.toContainText(GOLDEN_LETTER.id);
  });
});
