/*
 * Ashby's application form end to end (fixtures/synthetic/ashby-widgets, bundled in memory by helpers/ashby-fixture.ts
 * and served at Ashby addresses, so the Ashby adapter's hooks drive it), filled by the real extension with the golden
 * profile:
 * - the form is drawn 1.5 s after the page loads (.../a5b1), as Ashby's React draws it seconds after: the content
 *   script finds it as it appears (the adapter's formLateMs), so the side panel's Fill reaches it;
 * - the text boxes, the phone and LinkedIn written and read back; the Yes/No questions answered with one click() on a
 *   button and read back by aria-pressed (authorized Yes; sponsorship No, the profile's answer for the posting's
 *   country, so filled and flagged for a look); the radio and checkbox groups ticked with click() on their opacity-0
 *   inputs and read back by Ashby's own span; the ValueSelect of 10 options opened by its toggle, read in its portal,
 *   closed with the declared Escape and chosen with a click on its option; Location searched with "Austin, TX" (which
 *   lists nothing: the page lists only the places holding the typed text), then "Austin, Texas", and Austin in Texas
 *   chosen; the profile's school searched (its results labelled by their names alone) and chosen, and its Education
 *   block's text boxes and month and year lists written from the entry (each month before its year); the EEO answers
 *   the profile gave;
 * - the resume uploaded by the page (its ApiCreateFileUploadHandle) and verified once Ashby shows it uploaded;
 * - every change saved by the page (its ApiSetFormValue), the date's calendar never opened, nothing Ashby shows beside
 *   the fields pressed (Submit, the uploads, Delete, the autofill uploader, the tabs); the SMS consent beside the phone
 *   never touched, so its ApiSubmitCandidateTextingConsent is never sent (one click saves it at once; Phase 3's
 *   Consents: All mode is the one that will tick it, deliberately);
 * - every event untrusted, the fillers' or the declared Escape (a keydown and a keyup on a combobox's input only), never
 *   a mousedown, a pointer event or a focus; nothing submitted (assertTrapInvariants).
 * A dry run on the same page (.../a5b2) writes nothing: the page saves nothing, and every row is planned only.
 * A posting whose every upload fails (.../a5b3): the resume is flagged upload-failed, written and never verified (the
 * page's "failed to upload" toast). The overview (a posting's address without /application), drawn 1.5 s after the
 * page loads as Ashby draws it, is read once drawn: .../a5b4's "Please do not use AI tools to apply." is recorded for
 * the application before its form is opened.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { ASHBY_API, ASHBY_WIDGETS, ASHBY_WIDGETS_EXPECTATIONS, ashbyWidgetRoutes } from '../helpers/ashby-fixture.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { pageValue, syntheticLabels } from '../helpers/reactive.ts';
import { spyRecords } from '../helpers/spies.ts';
import type { RouteMap } from '../routes.ts';

const LABELS = syntheticLabels(ASHBY_WIDGETS_EXPECTATIONS);
const PATHS = {
  authorized: '6f1b584f-0001-4000-8000-000000000001', sponsorship: '6f1b584f-0002-4000-8000-000000000002',
  heard: '6f1b584f-0003-4000-8000-000000000003', skills: '6f1b584f-0004-4000-8000-000000000004',
  degree: '6f1b584f-0005-4000-8000-000000000005', phone: '6f1b584f-0006-4000-8000-000000000006',
  linkedin: '6f1b584f-0007-4000-8000-000000000007',
} as const;
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';
const LOCATION = 'Where are you currently located?';
const HEARD = 'How did you hear about us?';
const SKILLS = 'Which of these skills have you used?';
const DEGREE = 'What is the highest level of education you have completed?';

interface Log {
  values: Record<string, unknown>;
  saves: Array<{ op: string; path: string }>;
  pressed: string[];
  places: string[];
  schools: string[];
  typed: Record<string, string[]>;
  opened: Record<string, number>;
  calendars: number;
  drawnAt: number | null;
  uploads: Array<{ name: string; ok: boolean }>;
}

/** Every operation the page asks Ashby's API, in order, from the moment it is called. */
function apiOps(page: Page): string[] {
  const ops: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${ASHBY_API}?`)) ops.push(new URL(request.url()).searchParams.get('op') ?? '');
  });
  return ops;
}

let routes: RouteMap;
test.beforeAll(async () => {
  routes = await ashbyWidgetRoutes();
});

/** The spies' untrusted events of these types, on any control. */
async function ourEvents(page: Page, types: readonly string[]): Promise<string[]> {
  const records = await spyRecords(page);
  return records.flatMap((record) => record.events).filter((event) => !event.trusted && types.includes(event.type))
    .map((event) => `${event.type} ${event.control}`);
}

async function openForm(ext: Extension, page: Page, address: string): Promise<void> {
  await page.goto(address);
  await expect(page.locator('#_systemfield_name')).toBeVisible();
  expect(ext).toBeDefined();
}

test.describe("Ashby's application form", () => {
  test('a form drawn late, filled: its text, Yes/No, groups, ValueSelect, Location, School and EEO answers verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(180_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    const ops = apiOps(page);
    await page.goto(ASHBY_WIDGETS.late);
    // The form is not there yet: the content script finds it as React draws it.
    expect(await page.locator('#form [data-field-path]').count()).toBe(0);
    await expect(page.locator('#_systemfield_name')).toBeVisible({ timeout: 10_000 });
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__ashby');
    const verified = { status: 'verified', wrote: true, verification: 'verified' };

    expect(row(report, 'Name')).toMatchObject(verified);
    expect(log.values._systemfield_name).toBe(GOLDEN.full);
    expect(row(report, 'Email')).toMatchObject(verified);
    expect(log.values._systemfield_email).toBe(GOLDEN.email);
    expect(row(report, 'Phone Number')).toMatchObject(verified);
    expect(row(report, 'LinkedIn')).toMatchObject(verified);

    // The resume: uploaded by the page, verified once Ashby shows it uploaded.
    expect(row(report, 'Resume')).toMatchObject({ ...verified, category: 'file.resume' });
    expect(log.uploads).toEqual([{ name: GOLDEN_RESUME.fileName, ok: true }]);
    expect(ops).toContain('ApiCreateFileUploadHandle');

    // The Yes/No questions: one click on a button each, read back by aria-pressed; React's true and false.
    expect(row(report, AUTHORIZED)).toMatchObject({ ...verified, kind: 'radio', category: 'workAuth.authorized' });
    expect(log.values[PATHS.authorized]).toBe(true);
    expect(row(report, SPONSORSHIP)).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence', wrote: true,
      verification: 'verified', category: 'workAuth.sponsorship' });
    expect(log.values[PATHS.sponsorship]).toBe(false);

    // The radio and checkbox groups, ticked on their opacity-0 inputs, read back by Ashby's span.
    expect(row(report, HEARD)).toMatchObject({ ...verified, kind: 'radio' });
    expect(log.values[PATHS.heard]).toBe('LinkedIn');
    expect(row(report, SKILLS)).toMatchObject({ kind: 'checkbox-group', category: 'skills.list', wrote: true,
      verification: 'verified' });
    expect([...(log.values[PATHS.skills] as string[])].sort()).toEqual(['Kubernetes', 'PostgreSQL', 'TypeScript']);

    // The ValueSelect of 10 options: opened by its toggle to read it, then chosen; nothing typed into it.
    expect(row(report, DEGREE)).toMatchObject({ ...verified, kind: 'combobox', category: 'education.highestLevel' });
    expect(log.values[PATHS.degree]).toBe("Bachelor's Degree");
    expect(log.typed[PATHS.degree]).toBeUndefined();

    // Location: "Austin, TX" lists nothing; "Austin, Texas" lists Austin in Texas, which is chosen.
    expect(row(report, LOCATION)).toMatchObject({ ...verified, kind: 'typeahead-remote', category: 'location.current' });
    expect(log.places).toEqual(['Austin, TX', 'Austin, Texas']);
    expect(log.values._systemfield_location).toBe('Austin, Texas, United States');

    // School: searched, its results labelled by their names alone, chosen and read back by its name; the block's text
    // boxes; its month and year lists from the entry's dates, each month before its year.
    expect(row(report, 'School')).toMatchObject({ ...verified, kind: 'typeahead-remote', category: 'education.school' });
    expect(log.values['_systemfield_education_history[0].school']).toBe('The University of Texas at Austin');
    expect(log.schools[0]).toBe('The University of Texas at Austin');
    expect(row(report, 'Degree')).toMatchObject({ ...verified, category: 'education.degree' });
    expect(row(report, 'Field of Study')).toMatchObject({ ...verified, category: 'education.field' });
    for (const label of ['Start Date month', 'Start Date year', 'End Date month', 'End Date year']) {
      expect(row(report, label), label).toMatchObject({ ...verified, kind: 'select' });
    }
    expect(log.values['_systemfield_education_history[0].startDate']).toEqual({ m: '8', y: '2015' });
    expect(log.values['_systemfield_education_history[0].endDate']).toEqual({ m: '5', y: '2019' });

    // The EEO survey: the decline option for the gender the profile declined, the veteran answer it gave.
    expect(row(report, 'Gender')).toMatchObject({ ...verified, category: 'eeo.gender' });
    expect(log.values._systemfield_eeoc_gender).toBe('Decline to self-identify');
    expect(row(report, 'Veteran Status')).toMatchObject({ ...verified, category: 'eeo.veteran' });
    expect(log.values._systemfield_eeoc_veteran_status).toBe('I am not a protected veteran');

    // Every answer reached Ashby's autosave; the calendar never opened; nothing beside the fields was pressed.
    const saved = new Set(log.saves.map((save) => save.path));
    for (const path of ['_systemfield_name', '_systemfield_email', PATHS.authorized, PATHS.sponsorship, PATHS.heard,
      PATHS.skills, PATHS.degree, '_systemfield_location', '_systemfield_eeoc_gender']) {
      expect(saved.has(path), path).toBe(true);
    }
    expect(log.calendars).toBe(0);
    expect(log.pressed).toEqual([]);
    // The SMS consent: never touched, so never sent (a click saves it on Ashby's server at once).
    expect(ops).not.toContain('ApiSubmitCandidateTextingConsent');
    expect(log.saves.filter((save) => save.op === 'ApiSubmitCandidateTextingConsent')).toEqual([]);
    expect(log.values.communicationConsent).toBeUndefined();

    // No mouse, pointer or focus event; the only keys a keydown and a keyup on a combobox's input (Escape).
    expect(await ourEvents(page, ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'focus', 'focusin'])).toEqual([]);
    const keys = await ourEvents(page, ['keydown', 'keyup']);
    expect(keys.every((event) => event.endsWith(' input')), keys.join(', ')).toBe(true);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(ASHBY_WIDGETS.late), activation: ['keydown', 'keyup'] });
  });

  test('a dry run writes nothing: no answer saved, nothing pressed', async ({ extContext, connected: ext, routeLog }) => {
    test.setTimeout(120_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, ASHBY_WIDGETS.now);
    const tabId = await ext.fill(page, { dryRun: true });
    const report = await ext.settled(tabId, { mode: 'dry-run', timeout: 90_000 });
    expect(report.fields.filter((field) => field.wrote)).toEqual([]);
    const log = await pageValue<Log>(page, '__ashby');
    expect(log.saves).toEqual([]);
    expect(log.pressed).toEqual([]);
    expect(Object.values(log.values).filter((value) => value !== null && value !== '')).toEqual([]);
    expect(row(report, AUTHORIZED).kind).toBe('radio');
    expect(row(report, LOCATION).kind).toBe('typeahead-remote');
  });

  test('a resume Ashby says failed to upload is flagged upload-failed: written, never verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(150_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await openForm(ext, page, ASHBY_WIDGETS.uploadFails);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 120_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__ashby');
    expect(log.uploads).toEqual([{ name: GOLDEN_RESUME.fileName, ok: false }]);
    await expect(page.locator('[class*="_toast_"]')).toHaveText(`Error${GOLDEN_RESUME.fileName} failed to upload`);
    expect(row(report, 'Resume')).toMatchObject({ category: 'file.resume', status: 'flagged', reason: 'upload-failed',
      wrote: true, verification: 'mismatch', needsUserAction: true });
    expect(row(report, 'Name')).toMatchObject({ status: 'verified' });
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(ASHBY_WIDGETS.uploadFails), activation: ['keydown', 'keyup'] });
  });

  test('an overview drawn late is read once drawn: its "do not use AI" is recorded for the application', async ({ extContext, connected: ext, routeLog }) => {
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await page.goto(ASHBY_WIDGETS.noAiOverview);
    const key = applicationKeyOf(ASHBY_WIDGETS.noAi)!;
    expect(applicationKeyOf(ASHBY_WIDGETS.noAiOverview)).toBe(key);
    await expect(page.locator('#overview .ashby-job-posting-description')).toContainText('Please do not use AI tools');
    await expect.poll(async () => (await ext.session())[`policy:${key}`], { timeout: 15_000 })
      .toEqual({ hits: ['do-not-use-ai'], clear: false });
    // A clean overview drawn as late is a clean reading.
    const clean = await extContext.newPage();
    await clean.goto(ASHBY_WIDGETS.overview);
    await expect.poll(async () => (await ext.session())[`policy:${applicationKeyOf(ASHBY_WIDGETS.late)!}`],
      { timeout: 15_000 }).toEqual({ hits: [], clear: true });
    expect(routeLog.unexpected).toEqual([]);
  });
});
