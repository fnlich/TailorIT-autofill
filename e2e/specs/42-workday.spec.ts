/*
 * v3 Phase 6 end to end: Sign-in mode Auto on a Workday tenant's account views (fixtures/synthetic/workday/account.html,
 * drawn with the markup of the public capture of 2026-11-04/05), against the mock's saved sign-in for that host and a
 * synthetic credential (nothing real is ever submitted: the page posts nothing, and routes.ts fails a test that reaches
 * /__submitted or any address it does not serve):
 * - from the landing, Sign-in Auto presses "Sign in with email" (its prelude), types the email and the password into
 *   Workday's form, which has no method and no action, presses the visible click_filter (never the aria-hidden button
 *   under it), never types into the beecatcher honeypot, and keeps the browser from sending the form itself as a GET
 *   while it watches; the run then fills the step that follows in the same flow page;
 * - on Create Account it types the password twice and ticks the account's own terms box, which the page marks required
 *   nowhere;
 * - Forgot Password is the person's: the run pauses there, types nothing and asks TailorIT for nothing, Auto or not;
 * - with Sign-in on Manual the landing is the person's, and nothing is asked.
 * The application's steps (the owner's signed-in snapshots of 2026-11-06; fixtures/synthetic/workday/steps.html, drawn
 * with their markup), Next on Auto:
 * - My Information: the Country dropdown chosen through its own list (its button's click, then the option's), the names
 *   and the address typed, then its Save and Continue pressed by the run, once;
 * - My Experience: "Add Another" pressed once for the profile's second position, both blocks filled and the current
 *   job's "I currently work here" ticked; its Next left to the person while the required From date (Workday's 1 px spin
 *   buttons, never written) is empty;
 * - Review, the bar's last step: the run rests at review, and its Submit is never pressed (Submit on Manual).
 */
import type { Page } from '@playwright/test';
import { applicationKey } from '../../src/adapters/application-key';
import { parseWorkdayUrl } from '../../src/adapters/workday/url';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { pairThroughConnectPage } from '../helpers/pairing.ts';
import { runAt } from '../helpers/wizard.ts';

const ACCOUNT_PAGE = 'fixtures/synthetic/workday/account.html';
const HOST = 'tailoritfixture.wd5.myworkdayjobs.com';
const ACCOUNT = `https://${HOST}/en-US/careers/job/x/Fixture-Engineer_JR-0000001/apply/applyManually`;
/** The sign-in the mock holds for the tenant's host: the fixture's own dummies. */
const DUMMY = { host: HOST, email: 'alex.rivera@example.com', password: 'e2e-dummy-password-not-real' };

const datasetOf = (page: Page, key: string) => page.evaluate((name) => document.body.dataset[name] ?? null, key);

/** Connects again with the sign-in box ticked (credentials:read), the mock holding the dummies' sign-in. */
async function withSignIn(ext: Extension, mode: 'auto' | 'manual' = 'auto'): Promise<void> {
  const page = await pairThroughConnectPage(ext, { allowSignIn: true });
  await page.close();
  await expect.poll(async () => (await ext.authStatus()).scopes).toContain('credentials:read');
  await mock.credentials([DUMMY]);
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, signIn: mode } } });
}

test.afterEach(async ({ ext }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  await ext.send({ v: 1, type: 'auth/disconnect' });
});

test.describe('Sign-in mode Auto on Workday (v3 Phase 6)', () => {
  test('signs in from the landing: "Sign in with email", the email and the password, the click_filter, never a GET; then fills the next step', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    const page = await extContext.newPage();
    routeLog.serve({ [ACCOUNT]: ACCOUNT_PAGE });
    await page.goto(ACCOUNT);
    const tabId = await ext.fill(page);
    await expect.poll(() => datasetOf(page, 'submits'), { timeout: 30_000 }).toBe('1');
    expect(await datasetOf(page, 'emailOk')).toBe('true');
    expect(await datasetOf(page, 'passwordOk')).toBe('true');
    expect(await datasetOf(page, 'beeEmpty')).toBe('true');
    await expect.poll(() => datasetOf(page, 'nativeGet')).toBe('prevented');
    // One read of the sign-in, for this page's own host.
    const reads = await mock.requestsTo('GET /api/autofill/credentials');
    expect(reads.map((read) => read.query)).toEqual([`?host=${HOST}`]);
    // The run goes on: the step that follows in the same flow page is filled.
    await expect.poll(async () => page.locator('#first').inputValue(), { timeout: 30_000 }).not.toBe('');
    const report = (await ext.reports(tabId)).find((each) => each.frameId === 0);
    expect(report?.notices.map((notice) => notice.code)).not.toContain('sign-in-failed');
    // Nothing of the password reached storage, the address or a request the routes did not serve.
    expect(JSON.stringify(await ext.storage())).not.toContain(DUMMY.password);
    expect(page.url()).toBe(ACCOUNT);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test('creates the account: the password twice, and the account’s own terms box ticked', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    const page = await extContext.newPage();
    const url = `${ACCOUNT}?view=create`;
    routeLog.serve({ [url]: ACCOUNT_PAGE });
    await page.goto(url);
    await ext.fill(page);
    await expect.poll(() => datasetOf(page, 'submits'), { timeout: 30_000 }).toBe('1');
    expect(await datasetOf(page, 'emailOk')).toBe('true');
    expect(await datasetOf(page, 'passwordOk')).toBe('true');
    expect(await datasetOf(page, 'confirmOk')).toBe('true');
    expect(await datasetOf(page, 'terms')).toBe('true');
    expect(await datasetOf(page, 'beeEmpty')).toBe('true');
    await expect.poll(() => datasetOf(page, 'nativeGet')).toBe('prevented');
    expect(routeLog.unexpected).toEqual([]);
  });

  test('pauses at Forgot Password for the person: nothing typed, nothing pressed, nothing asked', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    const page = await extContext.newPage();
    const url = `${ACCOUNT}?view=forgot`;
    routeLog.serve({ [url]: ACCOUNT_PAGE });
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('handoff');
    expect(report.pauseReason).toBe('forgot-password');
    expect(await page.locator('input[data-automation-id="email"]').inputValue()).toBe('');
    expect(await datasetOf(page, 'reset')).toBeNull();
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
  });

  test('with Sign-in on Manual leaves the landing to the person and asks TailorIT for no password', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext, 'manual');
    const page = await extContext.newPage();
    routeLog.serve({ [ACCOUNT]: ACCOUNT_PAGE });
    await page.goto(ACCOUNT);
    // A plain Autofill (the page's own launcher's): at this wall the side panel's button is Sign up & Autofill, which
    // would grant Sign-in Auto for the run (v4).
    const tabId = await ext.fill(page, { plain: true });
    const report = await ext.settled(tabId);
    expect(report.status).toBe('auth-needed');
    expect(report.notices.map((notice) => notice.code)).not.toContain('sign-in-auto');
    // The landing stays as it was: no prelude pressed, nothing asked.
    await expect(page.locator('button[data-automation-id="SignInWithEmailButton"]')).toBeVisible();
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
  });
});

const STEPS_PAGE = 'fixtures/synthetic/workday/steps.html';
const STEPS = `https://${HOST}/en-US/careers/job/x/Fixture-Steps_JR-0000002/apply/applyManually`;

/** What the synthetic steps page records (its header). */
interface StepsRecord {
  step: number;
  next: Array<{ step: number; trusted: boolean }>;
  add: Array<{ step: number; trusted: boolean }>;
  submit: Array<{ step: number; trusted: boolean }>;
  values: Record<string, Record<string, string | boolean>>;
}
const stepsRecord = (page: Page) => page.evaluate(() =>
  JSON.parse(JSON.stringify((window as unknown as { __wd: unknown }).__wd)) as StepsRecord);

test.describe('the Workday application steps (the owner’s snapshots of 2026-11-06)', () => {
  test('Next on Auto: My Information filled and advanced, My Experience filled and left to the person while a required date is empty, Review never submitted', async ({ extContext, connected: ext, routeLog }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' } } });
    const page = await extContext.newPage();
    routeLog.serve({ [STEPS]: STEPS_PAGE });
    await page.goto(STEPS);
    // The key the extension files a Workday application under (the Workday parser's canonical address).
    const key = applicationKey('workday', parseWorkdayUrl(new URL(STEPS))!.applicationUrl);
    const tabId = await ext.fill(page);

    // My Information: filled from the dummy profile, then its Save and Continue pressed by the run, once.
    await expect.poll(async () => (await stepsRecord(page)).step, { timeout: 45_000 }).toBe(2);
    let record = await stepsRecord(page);
    expect(record.next).toEqual([{ step: 1, trusted: false }]);
    expect(record.values['1']).toMatchObject({ 'country--country': 'United States of America',
      'name--legalName--firstName': 'Alex', 'name--legalName--lastName': 'Rivera', 'address--city': 'Austin',
      'address--postalCode': '78701' });

    // My Experience: both positions, the run's own Add once, and its Next left to the person (the date is empty). v5
    // review (T1): the run rests there for the person's Next, its step filled; never the brief wait-transition of its own
    // Next on My Information, which passed while My Experience was still being filled.
    await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (state) => state.stepIndex === 1 && state.lastFill !== null });
    await expect.poll(async () => page.locator('input[id="workExperience-62--companyName"]').inputValue(), { timeout: 30_000 })
      .not.toBe('');
    expect(await page.locator('input[id="workExperience-61--jobTitle"]').inputValue()).toBe('Senior Software Engineer');
    expect(await page.locator('input[id="workExperience-61--companyName"]').inputValue()).toBe('Quillfeather Labs');
    expect(await page.locator('input[id="workExperience-62--companyName"]').inputValue()).toBe('Marrowgate Systems');
    expect(await page.locator('input[id="workExperience-61--currentlyWorkHere"]').isChecked()).toBe(true);
    record = await stepsRecord(page);
    expect(record.add).toEqual([{ step: 2, trusted: false }]);
    expect(record.next.filter((press) => press.step === 2)).toEqual([]);
    // The date was never written: the person's.
    for (const part of await page.locator('input[role="spinbutton"]').all()) expect(await part.inputValue()).toBe('');
    const report = (await ext.reports(tabId)).find((each) => each.frameId === 0);
    expect(report?.step?.progress).toBe('current step 2 of 3');

    // The person writes the dates and presses Save and Continue: Review, the final step, where the run rests.
    await page.evaluate(() => {
      for (const part of Array.from(document.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]'))) {
        part.value = part.getAttribute('aria-label') === 'Month' ? '06' : '2021';
      }
    });
    await page.locator('[data-automation-id="pageFooterNextButton"]').click();
    await expect.poll(async () => (await ext.runState(key))?.status, { timeout: 45_000 }).toBe('review');
    record = await stepsRecord(page);
    expect(record.step).toBe(3);
    expect(record.next.filter((press) => press.step === 2)).toEqual([{ step: 2, trusted: true }]);
    expect(record.submit).toEqual([]);
    expect(page.url()).toBe(STEPS);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });
});
