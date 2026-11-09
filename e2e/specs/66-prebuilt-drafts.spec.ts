/*
 * v1.5 X (PLAN decision 4) end to end, against the mock's `form-drafts` scenario (TailorIT v1.5's forms/known
 * `drafts`): a fill takes the person's ready prebuilt draft answer for a question no profile answers (provenance
 * prebuilt), with no AI request about it; a not-ready one is left to the fill's own AI path, as before.
 */
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';

const FIXTURE = 'fixtures/synthetic/submit/greenhouse-questions.html';
const HIKING = 'Do you enjoy hiking on weekends?';
const ANSWER = 'POST /api/autofill/ai/answer';
const asked = async () => (await mock.requestsTo(ANSWER)).some((request) => request.body.includes('hiking'));

test.describe('prebuilt draft answers (v1.5 X)', () => {
  test('fills a question from its ready draft, provenance prebuilt, with no AI request about it', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('form-drafts', { value: [{ label: HIKING, kind: 'radio', options: ['Yes', 'No'],
      answer: { kind: 'options', labels: ['Yes'] } }] });
    const url = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/6601';
    routeLog.serve({ [url]: FIXTURE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, HIKING)).toMatchObject({ provenance: 'prebuilt', reason: 'prebuilt-answer', wrote: true });
    await expect(page.getByLabel('Yes', { exact: true })).toBeChecked();
    expect(await asked()).toBe(false);
  });

  test('leaves a not-ready draft to the fill’s own AI path', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('form-drafts', { value: [{ label: HIKING, kind: 'radio', options: ['Yes', 'No'],
      answer: null }] });
    const url = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/6602';
    routeLog.serve({ [url]: FIXTURE });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, HIKING).provenance).not.toBe('prebuilt');
    expect(await asked()).toBe(true);
  });
});
