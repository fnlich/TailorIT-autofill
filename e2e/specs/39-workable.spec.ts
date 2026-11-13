/*
 * Workable's application form end to end (fixtures/synthetic/workable-widgets, bundled in memory by
 * helpers/workable-fixture.ts and served at Workable addresses, so the Workable adapter's hooks drive it), filled by the
 * real extension with the golden profile:
 * - the form is drawn 1.5 s after the page loads (.../0000000A01/apply/), as Workable's React draws it seconds after:
 *   the content script finds it as it appears (the adapter's formLateMs), so the side panel's Fill reaches it;
 * - the text boxes written and read back; the Address the page prefilled from "the visitor's IP" replaced by the
 *   profile's (prefill-conflict); the phone's country left as the page shows it (United States, the profile's) and the
 *   number written nationally, which the page draws "512-555-0147"; the Yes/No and the radio and checkbox groups
 *   answered with click() on their hidden inputs and read back by aria-checked; the dropdown "How did you hear about
 *   us?" opened by click() on its read-only box, read in place, closed with the declared Escape sent to its list, and
 *   its option chosen with a click; the GDPR consent ticked (Consent boxes: All agreements) and required; the resume put
 *   into the Resume input, never the Photo, after every other field, sent to the bucket and verified once the page
 *   shows it kept; the Address flagged prefill-conflict;
 * - Education and Experience: each entry added, filled and kept with its Update, one round after another, until the
 *   profile's school and two jobs are in;
 * - the date box: no answer in the profile, so never written, its calendar never opened by a focus or a click, and no
 *   Enter ever sent (the page counts both);
 * - every event untrusted, the fillers' or a declared key (a keydown and a keyup of Escape, and only Escape, on a
 *   dropdown's list, a phone list or a date box), never a mousedown, a mouseup, a pointer event or a focus; nothing
 *   beside the fields pressed ("Import resume from", Clear, "Choose file", the cookie banner); nothing submitted
 *   (assertTrapInvariants).
 * A dry run on the same page (.../0000000A02/apply/) writes nothing. After a fill, the side panel's "Submit
 * application" presses the page's Submit (v3 Phase 4), which shows Workable's [data-ui=successful-submit]: the trap
 * invariants hold before and after it (the panel's one Submit excused), the saved entries' rows stay verified, the
 * accepted matches the run's done stored are sealed, and the tracker is told it is Applied (TailorIT's API 4 knows
 * Workable). The overview (a posting's address without /apply/), drawn 1.5 s after the page
 * loads, is read once drawn: .../0000000A04/'s "Please do not use AI tools to apply." is recorded for the application,
 * and the person's press of its "Apply for this job" carries it into a profile-only fill. The review's cases: a resume
 * whose upload the bucket refuses (.../0000000A05/) is flagged upload-failed after every other field was written; a
 * salary is asked as a number (API 4's format) and goes in as 85000, "$85,000" being no answer of that layout, and a
 * profile's start date as MM/DD/YYYY; an entry the page's draft restored (.../0000000A06/) is matched by its summary
 * and never added again. The auto-apply agent takes a queued Workable job (API 4) and submits it. jr8 (the owner's live
 * run of 2026-11-13, snapshot9): the page draws each new editor at the top of its list and the saved entries
 * newest-added first, as live Workable does, and a profile of four jobs (the mock's profile-four-jobs) has all four
 * added, filled and kept, one a round.
 */
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import { pageValue, syntheticLabels } from '../helpers/reactive.ts';
import { spyRecords } from '../helpers/spies.ts';
import { WORKABLE_WIDGETS, WORKABLE_WIDGETS_EXPECTATIONS, workableWidgetRoutes } from '../helpers/workable-fixture.ts';
import type { RouteMap } from '../routes.ts';

const LABELS = syntheticLabels(WORKABLE_WIDGETS_EXPECTATIONS);
const IDS = { start: 'CA_3905', authorized: 'CA_3907', sponsorship: 'CA_3908', skills: 'QA_12058638', heard: 'QA_11713820' };
const SALARY = 'CA_21784';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';
const SKILLS = 'Which of these skills have you used?';
const HEARD = 'How did you hear about us?';
const CONSENT = 'I have read, understand and accept the content of the Privacy Notice and consent to the processing of my data as part of this application.';

interface Log {
  values: Record<string, unknown>;
  entries: Record<string, Array<Record<string, unknown>>>;
  pressed: string[];
  opened: Record<string, number>;
  calendars: number;
  typedCalendars: number;
  calendarOpen: boolean;
  enters: number;
  refusedWrites: number;
  files: Array<{ field: string; name: string }>;
  uploads: Array<{ field: string; name: string; ok: boolean }>;
  crashed: boolean;
  adds: number;
  refused: string[][];
  submitted: number;
  drawnAt: number | null;
}

let routes: RouteMap;
test.beforeAll(async () => {
  routes = await workableWidgetRoutes();
});

/** The spies' untrusted events of these types, on any control: "<type> <target>", a key's key after it. */
async function ourEvents(page: Page, types: readonly string[]): Promise<string[]> {
  const records = await spyRecords(page);
  return records.flatMap((record) => record.events).filter((event) => !event.trusted && types.includes(event.type))
    .map((event) => `${event.type} ${event.target}${event.key === undefined ? '' : ` ${event.key}`}`);
}

async function openForm(ext: Extension, page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.locator('#firstname')).toBeVisible();
  expect(ext).toBeDefined();
}

test.describe("Workable's application form", () => {
  test('a form drawn late, filled: text, phone, Yes/No, groups, a read-only dropdown and the GDPR consent verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await page.goto(WORKABLE_WIDGETS.late);
    // The form is not there yet: the content script finds it as React draws it.
    expect(await page.locator('form[data-ui="application-form"]').count()).toBe(0);
    await expect(page.locator('#firstname')).toBeVisible({ timeout: 10_000 });
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__workable');
    const verified = { status: 'verified', wrote: true, verification: 'verified' };

    expect(row(report, 'First name')).toMatchObject(verified);
    expect(log.values.firstname).toBe(GOLDEN.first);
    expect(row(report, 'Last name')).toMatchObject(verified);
    expect(row(report, 'Email')).toMatchObject(verified);
    expect(log.values.email).toBe(GOLDEN.email);
    // The phone: its country already the profile's, the number written nationally and drawn so by the page.
    expect(row(report, 'Phone country code')).toMatchObject({ kind: 'combobox', category: 'contact.phoneCountry', wrote: false });
    expect(row(report, 'Phone')).toMatchObject({ ...verified, category: 'contact.phone' });
    await expect(page.locator('#input_phone')).toHaveValue('512-555-0147');
    expect(log.values.phone).toBe(GOLDEN.phoneDigits.slice(1));
    // The Address the page guessed from the IP is replaced by the profile's, and flagged for a look.
    expect(row(report, 'Address')).toMatchObject({ status: 'flagged', reason: 'prefill-conflict', wrote: true,
      verification: 'verified', category: 'location.current' });
    expect(await page.locator('#address').inputValue()).toContain(GOLDEN.city);

    // The resume in Resume, never in Photo.
    expect(row(report, 'Resume')).toMatchObject({ ...verified, category: 'file.resume' });
    expect(row(report, 'Photo')).toMatchObject({ wrote: false });
    expect(log.files).toEqual([{ field: 'resume', name: GOLDEN_RESUME.fileName }]);
    // Sent to the bucket at once (its POST, answered by the routes), and verified only once the page shows it kept.
    expect(log.uploads).toEqual([{ field: 'resume', name: GOLDEN_RESUME.fileName, ok: true }]);
    await expect(page.locator('[data-role="dropzone"] .wk-file-name')).toHaveText(GOLDEN_RESUME.fileName);

    // The Yes/No questions: one click on a hidden radio each, read back by aria-checked.
    expect(row(report, AUTHORIZED)).toMatchObject({ ...verified, kind: 'radio', category: 'workAuth.authorized' });
    expect(log.values[IDS.authorized]).toBe(true);
    expect(row(report, SPONSORSHIP)).toMatchObject({ wrote: true, verification: 'verified', category: 'workAuth.sponsorship' });
    expect(log.values[IDS.sponsorship]).toBe(false);
    expect(row(report, SKILLS)).toMatchObject({ kind: 'checkbox-group', category: 'skills.list', wrote: true,
      verification: 'verified' });
    expect(log.values[IDS.skills]).toEqual(['TypeScript', 'Kubernetes', 'PostgreSQL']);

    // The dropdown: opened by click() on its read-only box, read in place, chosen with a click on its option.
    expect(row(report, HEARD)).toMatchObject({ ...verified, kind: 'combobox' });
    await expect(page.locator(`#input_${IDS.heard}_input`)).toHaveValue('LinkedIn');
    expect(log.opened[IDS.heard]).toBeGreaterThanOrEqual(1);
    expect(await page.locator(`#input_${IDS.heard}_listbox`).count()).toBe(0);

    // The GDPR consent: required, and ticked (Consent boxes: All agreements, the default).
    expect(row(report, CONSENT)).toMatchObject({ ...verified, kind: 'checkbox' });
    expect(log.values.gdpr).toBe(true);

    // The date: nothing in the profile to write; its calendar never opened by us, and no Enter.
    expect(row(report, 'Earliest Start Date')).toMatchObject({ wrote: false });
    expect(log).toMatchObject({ calendars: 0, enters: 0, calendarOpen: false });

    // Education and Experience: "+ Add" (the page disables it while its editor is open), the editor filled from the
    // entry (its MM/YYYY dates with the keys around them; a current job's End date left, its box ticked), its Update
    // pressed, so the page keeps the entry; then the next round adds, fills and saves the next entry, until the
    // profile's are in: one school, two jobs (the Phase 7a review).
    expect(log.adds).toBe(3);
    expect(log.entries.education).toEqual([{ school: 'The University of Texas at Austin', field_of_study: expect.any(String),
      degree: expect.any(String), start_date: '08/2015', end_date: '05/2019' }]);
    expect(log.entries.experience).toEqual([
      expect.objectContaining({ title: 'Senior Software Engineer', company: 'Quillfeather Labs', start_date: '06/2021',
        current: true }),
      expect.objectContaining({ title: 'Software Engineer', company: 'Marrowgate Systems', start_date: '07/2019',
        end_date: '05/2021' })]);
    // jr8: the page draws its saved entries newest-added first, as live Workable does (snapshot9), so the job kept
    // second shows first.
    await expect(page.locator('[data-ui="experience"] dd[data-ui="company"]')).toHaveText(['Marrowgate Systems',
      'Quillfeather Labs']);
    for (const label of ['School', 'Title', 'Company']) expect(row(report, label)).toMatchObject(verified);
    // A saved block's rows are those its round left (its fields folded away), listed after the fields still shown.
    expect(report.fields.filter((field) => field.label === 'Start date').map((field) => `${field.section} ${field.status}`)
      .sort()).toEqual(['education[0] verified', 'experience[0] verified', 'experience[1] verified']);
    expect(report.notices.map((notice) => notice.code)).not.toContain('needs-click');
    expect(report.repeatables).toEqual(expect.arrayContaining([{ kind: 'experience', added: 2, of: 2 }]));
    // Nothing beside the fields pressed (Cancel, Edit and Delete included), nothing submitted.
    expect(log.pressed).toEqual([]);
    expect(log.submitted).toBe(0);
    // No mouse, pointer or focus event; the only keys a keydown and a keyup of Escape on a dropdown's or a phone's
    // list, or a date box: never Enter, nor any other key.
    expect(await ourEvents(page, ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'focus', 'focusin'])).toEqual([]);
    const keys = await ourEvents(page, ['keydown', 'keyup']);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((event) => /(?:listbox|CA_3905|start_date|end_date) Escape$/.test(event)), keys.join(', ')).toBe(true);
    expect(log.enters).toBe(0);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(WORKABLE_WIDGETS.late), activation: ['keydown', 'keyup'] });
  });

  test('a dry run writes nothing: no answer kept, nothing pressed', async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(120_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.now);
    const tabId = await ext.fill(page, { dryRun: true });
    const report = await ext.settled(tabId, { mode: 'dry-run', timeout: 90_000 });
    expect(report.fields.filter((field) => field.wrote)).toEqual([]);
    const log = await pageValue<Log>(page, '__workable');
    expect(log.values).toEqual({});
    expect(log.pressed).toEqual([]);
    expect(log.opened).toEqual({});
    expect(row(report, HEARD).kind).toBe('combobox');
    expect(row(report, 'Phone country code').kind).toBe('combobox');
  });

  test("the panel's Submit presses the page's Submit after a fill, and Workable's panel says it was sent", async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.submit);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(report.status).toBe('review');
    expect(report.buttons).toMatchObject({ final: 'final', submit: true });
    // Nothing was pressed by the fill.
    expect((await pageValue<Log>(page, '__workable')).submitted).toBe(0);
    const run = { page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(WORKABLE_WIDGETS.submit), activation: ['keydown', 'keyup'] };
    await assertTrapInvariants(run);
    const panel = await ext.reportPage(tabId);
    const submit = panel.locator('button[data-step-action="submit"]');
    await expect(submit).toHaveText(COPY.panel.step.submit);
    await submit.click();
    await expect(page.locator('[data-ui="successful-submit"]')).toBeVisible();
    const log = await pageValue<Log>(page, '__workable');
    expect(log).toMatchObject({ submitted: 1, refused: [] });
    // The saved entries' fields folded away at their Update: the look before leaving never reads them as changed, so
    // nothing asked "Submit anyway?" and their rows stay verified.
    expect(await panel.locator('.tia-dock__question').count()).toBe(0);
    const after = (await ext.reports(tabId)).find((one) => one.fields.some((field) => field.label === 'School'))!;
    for (const label of ['School', 'Title', 'Company']) {
      expect(row(after, label), label).toMatchObject({ status: 'verified', verification: 'verified' });
    }
    // TailorIT's API 4 knows Workable: its lookup found the job, so the tracker is told it is Applied by its id.
    await expect(panel.locator('[data-submitted="recorded"]')).toBeVisible();
    const applied = await mock.requestsTo('POST /api/autofill/applied');
    expect(applied).toHaveLength(1);
    expect(JSON.parse(applied[0]!.body)).toMatchObject({ jobId: expect.any(Number) });
    expect(routeLog.submitted).toEqual([]);
    // The run reached done, and what its done stored (the accepted matches, sealed) holds no profile value.
    await expect.poll(async () => (await ext.runState(run.applicationKey!))?.status).toBe('done');
    await expect.poll(async () => ((await ext.session()).matchcache as { entries?: unknown[] } | undefined)?.entries?.length ?? 0)
      .toBeGreaterThan(0);
    await assertTrapInvariants({ ...run, console: logs(), panelSubmitted: true });
  });

  test('an overview drawn late is read once drawn: its "do not use AI" is recorded, and its Apply carries it into the fill', async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await page.goto(WORKABLE_WIDGETS.noAiOverview);
    const key = applicationKeyOf(WORKABLE_WIDGETS.noAi)!;
    expect(applicationKeyOf(WORKABLE_WIDGETS.noAiOverview)).toBe(key);
    await expect(page.locator('[data-ui="job-description"]')).toContainText('Please do not use AI tools');
    await expect.poll(async () => (await ext.session())[`policy:${key}`], { timeout: 15_000 })
      .toEqual({ hits: ['do-not-use-ai'], clear: false });
    // A clean overview drawn as late is a clean reading.
    const clean = await extContext.newPage();
    await clean.goto(WORKABLE_WIDGETS.overview);
    await expect.poll(async () => (await ext.session())[`policy:${applicationKeyOf(WORKABLE_WIDGETS.late)!}`],
      { timeout: 15_000 }).toEqual({ hits: [], clear: true });
    // The person presses "Apply for this job" on the overview: the form it opens is filled from the profile only (the
    // posting's reading carried into the fill, though the form shows none of it), and nothing goes to the AI.
    await page.getByRole('button', { name: 'Apply for this job' }).click();
    await page.waitForURL(WORKABLE_WIDGETS.noAi);
    await expect(page.locator('#firstname')).toBeVisible({ timeout: 10_000 });
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(report.notices.map((notice) => notice.code)).toContain('policy-profile-only');
    expect(row(report, 'First name')).toMatchObject({ status: 'verified' });
    for (const route of ['POST /api/autofill/ai/answer', 'POST /api/autofill/ai/draft', 'POST /api/autofill/ai/classify']) {
      expect(await mock.requestsTo(route), route).toEqual([]);
    }
    expect(routeLog.unexpected).toEqual([]);
  });

  test('a resume whose upload the bucket refuses is flagged upload-failed, written after every other field', async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.uploadFails);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(row(report, 'Resume')).toMatchObject({ status: 'flagged', reason: 'upload-failed', wrote: true,
      verification: 'mismatch', needsUserAction: true });
    // The page fell over at the failed upload (its error screen in the form's place), after the rest was written: the
    // file goes last (quirks.filesLast).
    await expect(page.locator('.wk-crash')).toBeVisible();
    const log = await pageValue<Log>(page, '__workable');
    expect(log).toMatchObject({ crashed: true, uploads: [{ field: 'resume', name: GOLDEN_RESUME.fileName, ok: false }] });
    expect(log.values).toMatchObject({ firstname: GOLDEN.first, email: GOLDEN.email, gdpr: true });
    expect(log.pressed).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test("a salary is asked as a number (API 4's format) and goes in as one, and a start date in the box's own MM/DD/YYYY", async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(240_000);
    routeLog.serve(routes);
    await mock.scenario('ai-answer');
    await mock.scenario('profile-start-date');
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.now);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    const log = await pageValue<Log>(page, '__workable');
    // The box asked with its layout, and its answer written as one number.
    const asked = (await mock.requestsTo('POST /api/autofill/ai/answer'))
      .flatMap((request) => (JSON.parse(request.body) as { items: Array<{ question: string; format?: string | null }> }).items);
    expect(asked.find((item) => item.question === 'Desired salary')).toMatchObject({ format: 'number' });
    expect(row(report, 'Desired salary')).toMatchObject({ wrote: true, verification: 'verified' });
    expect(log.values[SALARY]).toBe(85000);
    await expect(page.locator(`input[name="${SALARY}"]`)).toHaveValue('85,000');
    expect(row(report, 'Earliest Start Date')).toMatchObject({ status: 'verified', wrote: true });
    expect(log.values[IDS.start]).toBe('01/04/2027');
    // Escape around the write, never Enter; the calendar the page opened after the typed date closed again.
    expect(log).toMatchObject({ enters: 0, refusedWrites: 0, calendarOpen: false });

    // An AI that writes "$85,000" gives no one value of the layout: TailorIT (here the mock) answers it invalid, and
    // the box is left as it was.
    await mock.scenario('ai-answer-amount');
    const again = await extContext.newPage();
    await openForm(ext, again, WORKABLE_WIDGETS.late);
    const second = await ext.fill(again);
    const left = await ext.settled(second, { timeout: 120_000 });
    expect(row(left, 'Desired salary')).toMatchObject({ wrote: false, reason: 'llm-invalid-output' });
    expect((await pageValue<Log>(again, '__workable')).values[SALARY]).toBeUndefined();
  });

  test("the auto-apply agent takes a queued Workable job (API 4): opens its form, fills it, submits it and reports it", async ({ connected: ext, routeLog }) => {
    test.setTimeout(240_000);
    routeLog.serve(routes);
    const id = '00000009-aaaa-4bbb-8ccc-000000003909';
    await mock.queueAgent([{ id, jobId: 3909, url: WORKABLE_WIDGETS.now, company: 'Northwind', title: 'Data Engineer',
      resumeId: null }]);
    const opened = ext.context.waitForEvent('page', { predicate: (page) => page.url().startsWith(WORKABLE_WIDGETS.now)
      || page.url() === 'about:blank', timeout: 30_000 });
    try {
      const on = await ext.data<{ on: boolean }>({ v: 1, type: 'agent/set', on: true, confirmed: true });
      expect(on.on).toBe(true);
      const page = await opened;
      await page.waitForURL((address) => address.href.startsWith(WORKABLE_WIDGETS.now), { timeout: 30_000 });
      await expect.poll(async () => (await mock.agent()).results.length, { timeout: 90_000 }).toBe(1);
      expect((await mock.agent()).results[0]).toMatchObject({ id, body: { state: 'submitted', reason: null } });
      await expect.poll(() => page.isClosed(), { timeout: 15_000 }).toBe(true);
      // TailorIT marks it Applied with the result: the extension never calls POST /applied for the agent's job.
      expect(await mock.requestsTo('POST /api/autofill/applied')).toEqual([]);
      expect(routeLog.submitted).toEqual([]);
    } finally {
      await ext.send({ v: 1, type: 'agent/set', on: false });
    }
  });

  test("an entry the page's draft restored is matched by its summary, never added again", async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.restored);
    await expect(page.locator('[data-ui="experience"] dd[data-ui="company"]')).toHaveText(['Marrowgate Systems']);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    const log = await pageValue<Log>(page, '__workable');
    // The restored job is the profile's second: only the first is added (one Add for Experience, one for Education).
    expect(log.adds).toBe(2);
    // jr8: the job added now shows above the restored one, newest-added first, as live Workable draws them (snapshot9).
    await expect(page.locator('[data-ui="experience"] dd[data-ui="company"]')).toHaveText(['Quillfeather Labs',
      'Marrowgate Systems']);
    expect(log.entries.experience).toEqual([expect.objectContaining({ company: 'Marrowgate Systems' }),
      expect.objectContaining({ company: 'Quillfeather Labs', title: 'Senior Software Engineer', current: true })]);
    expect(report.notices.map((notice) => notice.code)).not.toContain('needs-click');
    expect(log.pressed).toEqual([]);
  });

  test('four jobs, one a round: each added, filled and kept with the editor drawn at the top of its list (jr8)', async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(240_000);
    routeLog.serve(routes);
    // The golden profile with two synthetic jobs after its two (the owner's live run of 2026-11-13 kept two of four).
    await mock.scenario('profile-four-jobs');
    const page = await extContext.newPage();
    await openForm(ext, page, WORKABLE_WIDGETS.now);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 180_000 });
    const log = await pageValue<Log>(page, '__workable');
    // One Add for the school, four for the jobs: each round adds, fills and keeps one, as the page draws the new editor
    // at the top of its list, where the entry kept the round before was.
    expect(log.adds).toBe(5);
    expect(log.entries.experience).toEqual([
      expect.objectContaining({ title: 'Senior Software Engineer', company: 'Quillfeather Labs', start_date: '06/2021',
        current: true }),
      expect.objectContaining({ title: 'Software Engineer', company: 'Marrowgate Systems', start_date: '07/2019',
        end_date: '05/2021' }),
      expect.objectContaining({ title: 'Platform Engineer', company: 'Larkspur Analytics', start_date: '03/2017',
        end_date: '06/2019' }),
      expect.objectContaining({ title: 'Junior Developer', company: 'Tidewater Works', start_date: '06/2015',
        end_date: '02/2017' })]);
    expect(log.entries.experience![0]).not.toHaveProperty('end_date');
    await expect(page.locator('[data-ui="experience"] [data-ui="editor"]')).toHaveCount(0);
    await expect(page.locator('[data-ui="experience"] dd[data-ui="company"]')).toHaveText(['Tidewater Works',
      'Larkspur Analytics', 'Marrowgate Systems', 'Quillfeather Labs']);
    expect(report.repeatables).toEqual(expect.arrayContaining([{ kind: 'experience', added: 4, of: 4 }]));
    expect(report.notices.map((notice) => notice.code)).not.toContain('needs-click');
    expect(report.fields.filter((field) => field.reason === 'value-oscillated')).toEqual([]);
    expect(log.pressed).toEqual([]);
    expect(log.submitted).toBe(0);
  });
});
