/*
 * v1.3 B end to end (docs/SPEC-AMENDMENTS.md §16), on a synthetic Greenhouse form (fixtures/synthetic/submit/
 * greenhouse-questions.html) against the mock's v1.3 routes:
 * - a fill, the person's own answer to a question no profile answers, a password box the site added, then the
 *   person's own Submit: once the site confirms it, POST /applied records it and POST /submissions sends the form's
 *   questions and answers (the resume by its file's name alone), never the password or the file's content;
 * - the same job filled again: TailorIT's known form is read, and the question the person answered before takes their
 *   earlier answer (provenance submitted-before), with no AI request about it.
 */
import { expect, test } from '../fixtures.ts';
import { GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import { row } from '../helpers/extension.ts';

const FIXTURE = 'fixtures/synthetic/submit/greenhouse-questions.html';
const HIKING = 'Do you enjoy hiking on weekends?';
const PASSWORD = 'Secret-Pa55-not-real';
const SUBMISSIONS = 'POST /api/autofill/submissions';
const ANSWER = 'POST /api/autofill/ai/answer';
const url = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/6401';

test('a submitted form\'s questions and answers reach TailorIT, and fill the same job again with no AI (v1.3 B)', async ({ extContext, connected: ext, routeLog }) => {
  routeLog.serve({ [url]: FIXTURE });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.fill(page);
  const first = await ext.settled(tabId);
  expect(row(first, HIKING).provenance).not.toBe('submitted-before');
  expect(row(first, 'Resume/CV')).toMatchObject({ wrote: true });
  // TailorIT's AI was asked about the question no profile answers (the mock answers nothing).
  const askedFirst = (await mock.requestsTo(ANSWER)).length;
  expect((await mock.requestsTo(ANSWER)).some((request) => request.body.includes('hiking'))).toBe(true);
  // The person answers it, the site adds a password box, and the person submits.
  await page.bringToFront();
  await page.getByLabel('Yes', { exact: true }).check();
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field-wrapper';
    wrapper.innerHTML = '<label for="password">Create a password</label><input id="password" type="password">';
    document.querySelector('.application--submit')!.before(wrapper);
  });
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect.poll(async () => (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId }))
    .page?.submitted).toBe('recorded');
  // Once, whatever signs of the confirmation the page gave.
  await expect.poll(async () => (await mock.requestsTo(SUBMISSIONS)).length).toBe(1);
  const [sent] = await mock.requestsTo(SUBMISSIONS);
  expect(sent!.body).not.toContain(PASSWORD);
  expect(sent!.body).not.toContain('%PDF');
  const body = JSON.parse(sent!.body) as { jobId?: number; questions: Array<{ ref: string; label: string }>;
    answers: Array<{ ref: string; answer: Record<string, unknown> }> };
  expect(body.jobId).toEqual(expect.any(Number));
  expect(body.questions.map((question) => question.label)).toEqual(['First Name', 'Last Name', 'Email', 'Resume/CV',
    HIKING]);
  const answerTo = (label: string) => body.answers.find((answer) => answer.ref === body.questions
    .find((question) => question.label === label)!.ref)?.answer;
  expect(answerTo(HIKING)).toEqual({ kind: 'options', labels: ['Yes'] });
  expect(answerTo('Resume/CV')).toEqual({ kind: 'file', fileName: GOLDEN_RESUME.fileName });
  // The mock keeps the form by the job.
  const [kept] = await mock.forms();
  expect(kept!.questions.map((question) => question.label)).toContain(HIKING);

  // The same job again: the earlier answer fills the question, and the AI is asked nothing about it.
  const again = await extContext.newPage();
  await again.goto(url);
  const second = await ext.settled(await ext.fill(again));
  expect(row(second, HIKING)).toMatchObject({ provenance: 'submitted-before', reason: 'submitted-before', wrote: true });
  expect(await again.getByLabel('Yes', { exact: true }).isChecked()).toBe(true);
  // The profile still fills its own questions.
  expect(row(second, 'First Name').provenance).toBe('profile');
  const askedAfter = (await mock.requestsTo(ANSWER)).slice(askedFirst);
  expect(askedAfter.filter((request) => request.body.includes('hiking'))).toEqual([]);
  expect((await mock.requestsTo('POST /api/autofill/forms/known')).length).toBeGreaterThan(0);
});
