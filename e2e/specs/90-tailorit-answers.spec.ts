/*
 * What the extension does with TailorIT's other answers (docs/CONTRACT.md "How the extension calls it"), through the
 * mock's scripted answers:
 * - a 401 drops the token: the extension is disconnected, and nothing is filled;
 * - another API version (409, its header naming 2): nothing is filled until one side is updated, and the token stays;
 * - a lookup that never answers in time, or fails: the run carries on without it (no stored copy, so the couldn't-read
 *   notice; no suggested resume, and the profile names none, so the upload is resume-unavailable);
 * - the sensitive part, fetched once when a plan meets a legal or EEO question: answered from its explicit values; and
 *   when TailorIT refuses it (403), the legal questions are left blank with sensitive-not-shared and the EEO question
 *   takes the form's decline option (docs/SPEC-AMENDMENTS.md §5), none of them sent to an AI. TailorIT refuses it to a
 *   token whose connection was made with the sensitive box unticked (a token's scopes never change), so that spec
 *   pairs that way first, and the worker, which keeps a sensitive part it read for the same token and revision, starts
 *   afresh with the new token; it pairs with the box ticked again afterwards.
 * A later test pairs again where one leaves the extension disconnected (the `connected` fixture).
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { AUTHORIZED, SPONSORSHIP, SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { mock, RESUME_FILE_ROUTE } from '../helpers/mock.ts';
import { checked, writeEvents } from '../helpers/page-state.ts';
import { pairThroughConnectPage } from '../helpers/pairing.ts';

const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const FORM = 'fixtures/synthetic/policy-apply.html';
const UPLOAD = 'fixtures/synthetic/resume-upload.html';
const SENSITIVE = 'fixtures/synthetic/sensitive-questions.html';

test.describe("TailorIT's answers", () => {
  test('a 401 drops the token: the extension is disconnected and nothing is filled', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    const url = at('answer-401');
    routeLog.serve({ [url]: FORM });
    await tailorit.scenario('unauthorized');
    const page = await extContext.newPage();
    await page.goto(url);
    await ext.fill(page);
    await expect.poll(async () => (await ext.authStatus()).connection).toBe('revoked');
    expect((await ext.authStatus()).account).toBeNull();
    expect(await writeEvents(page)).toEqual([]);
    for (const id of ['#name', '#email', '#phone']) await expect(page.locator(id)).toHaveValue('');
  });

  test('another API version stops filling until one side is updated, and keeps the token', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    const url = at('answer-version');
    routeLog.serve({ [url]: FORM });
    await tailorit.scenario('version-mismatch');
    const page = await extContext.newPage();
    await page.goto(url);
    await ext.fill(page);
    await expect.poll(async () => (await ext.authStatus()).versionMismatch).toBe(true);
    expect((await ext.authStatus()).connection).toBe('connected');
    await expect.poll(async () => (await mock.requestsTo('GET /api/autofill/profile')).map((request) => request.status))
      .toContain(409);
    expect(await writeEvents(page)).toEqual([]);
    for (const id of ['#name', '#email', '#phone']) await expect(page.locator(id)).toHaveValue('');
  });

  test('a lookup that never answers in time: the run fills without it', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    test.setTimeout(90_000);
    const url = at('answer-slow-lookup');
    routeLog.serve({ [url]: FORM });
    // Past the worker's 25 s limit on every TailorIT call.
    await tailorit.scenario('lookup-slow', { delayMs: 30_000 });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 60_000 });
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'policy-unreadable')).toBe(1);
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    // The worker gave up on both (v2: the side panel's job card asked first): the mock never got to answer either.
    expect((await mock.requestsTo('POST /api/autofill/lookup')).map((request) => request.status)).toEqual([0, 0]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: SYNTHETIC_LABELS['policy-apply'], applicationKey: applicationKeyOf(url) });
  });

  test('a lookup that fails: the run fills without it, and has no resume to attach', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    const url = at('answer-failed-lookup');
    routeLog.serve({ [url]: UPLOAD });
    await tailorit.scenario('lookup-fails');
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'policy-unreadable')).toBe(1);
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(row(report, 'Resume')).toMatchObject({ reason: 'resume-unavailable', wrote: false });
    expect(await mock.requestsTo(RESUME_FILE_ROUTE)).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: SYNTHETIC_LABELS['resume-upload'], applicationKey: applicationKeyOf(url) });
  });

  test('the sensitive part answers legal and EEO questions from its explicit values, fetched once', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = at('sensitive');
    routeLog.serve({ [url]: SENSITIVE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(row(report, AUTHORIZED)).toMatchObject({ category: 'workAuth.authorized', status: 'verified', provenance: 'profile' });
    expect(await checked(page, 'authorized')).toEqual(['yes']);
    expect(row(report, SPONSORSHIP)).toMatchObject({ category: 'workAuth.sponsorship', status: 'verified' });
    expect(['profile', 'rule']).toContain(row(report, SPONSORSHIP).provenance);
    expect(await checked(page, 'sponsorship')).toEqual(['no']);
    // The golden profile declined to state its gender: the form's decline option, by the decline rule.
    expect(row(report, 'Gender')).toMatchObject({ category: 'eeo.gender', status: 'verified', provenance: 'rule' });
    await expect(page.locator('#gender')).toHaveValue('decline');
    expect(await mock.requestsTo('GET /api/autofill/profile/sensitive')).toHaveLength(1);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: SYNTHETIC_LABELS['sensitive-questions'], applicationKey: applicationKeyOf(url) });
  });

  test('when this browser may not read the sensitive part, the legal questions are left blank (sensitive-not-shared) and the EEO one declined', async ({ extContext, connected: ext, routeLog, logs }) => {
    // Connected with the sensitive box unticked: the token lacks profile:sensitive, and TailorIT answers it 403.
    await (await pairThroughConnectPage(ext, { includeSensitive: false })).close();
    expect((await ext.authStatus()).scopes).not.toContain('profile:sensitive');
    try {
      const url = at('sensitive-forbidden');
      routeLog.serve({ [url]: SENSITIVE });
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId);
      expect(report.status).toBe('review');
      for (const label of [AUTHORIZED, SPONSORSHIP]) {
        expect(row(report, label), label).toMatchObject({ reason: 'sensitive-not-shared', wrote: false, provenance: null });
      }
      expect(await checked(page, 'authorized')).toEqual([]);
      expect(await checked(page, 'sponsorship')).toEqual([]);
      // The owner's amendments (docs/SPEC-AMENDMENTS.md §5): an EEO question asked while the sensitive part is not
      // shared takes the form's decline option, by the decline rule; a decline is no guess, and reads nothing.
      expect(row(report, 'Gender')).toMatchObject({ category: 'eeo.gender', status: 'verified', provenance: 'rule',
        reason: 'eeo-decline-default', wrote: true });
      await expect(page.locator('#gender')).toHaveValue('decline');
      expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
      // Refused once, and not asked again in the run.
      const sensitive = await mock.requestsTo('GET /api/autofill/profile/sensitive');
      expect(sensitive.map((request) => request.status)).toEqual([403]);
      // None of the three questions reached TailorIT's AI.
      for (const request of await mock.requestsTo('POST /api/autofill/ai/*')) {
        for (const label of [AUTHORIZED, SPONSORSHIP, 'Gender']) expect(request.body, label).not.toContain(label);
      }
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
        labels: SYNTHETIC_LABELS['sensitive-questions'], applicationKey: applicationKeyOf(url) });
    } finally {
      // Back to a connection that may read it, as the other specs expect.
      await (await pairThroughConnectPage(ext)).close();
    }
  });
});
