/*
 * v1.5 X (PLAN decision 4) end to end, against the mock's `form-drafts` scenario (TailorIT v1.5's forms/known
 * `drafts`): a fill takes the person's ready prepared draft answer for a question no profile answers (the extension's
 * own provenance `prebuilt`), with no AI request about it; a not-ready one is left to the fill's own AI path, as before.
 * v2.0 P9 (API 8; renamed from 66-prebuilt-drafts): the person's Submit then names that answer `prepared` to TailorIT
 * (POST /submissions), the wire's name since API 8, which the mock refuses `prebuilt` in.
 */
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';

const FIXTURE = 'fixtures/synthetic/submit/greenhouse-questions.html';
const HIKING = 'Do you enjoy hiking on weekends?';
const ANSWER = 'POST /api/autofill/ai/answer';
const SUBMISSIONS = 'POST /api/autofill/submissions';
const asked = async () => (await mock.requestsTo(ANSWER)).some((request) => request.body.includes('hiking'));

test.describe('prepared draft answers (v1.5 X, API 8)', () => {
  test('fills a question from its ready draft, with no AI request about it, and names it prepared on Submit', async ({ extContext, connected: ext, routeLog, tailorit }) => {
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
    // v2.0 P9 (API 8): the person's Submit names the prepared answer `prepared` to TailorIT, never `prebuilt`.
    await page.bringToFront();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect.poll(async () => (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId }))
      .page?.submitted).toBe('recorded');
    await expect.poll(async () => (await mock.requestsTo(SUBMISSIONS)).length).toBe(1);
    const [sent] = await mock.requestsTo(SUBMISSIONS);
    const body = JSON.parse(sent!.body) as { questions: Array<{ ref: string; label: string }>;
      answers: Array<{ ref: string; provenance: string | null }> };
    const hiking = body.questions.find((question) => question.label === HIKING)!;
    expect(body.answers.find((answer) => answer.ref === hiking.ref)?.provenance).toBe('prepared');
    expect(sent!.body).not.toContain('prebuilt');
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
