/*
 * The owner's amendments end to end against the mock (docs/SPEC-AMENDMENTS.md "Fill everything"): with version 2's
 * defaults, a question nothing on the extension's side settles is answered through TailorIT's answer route and marked
 * "AI guess", from visible text only; a free-text question's draft is written and accepted; and Edit with AI, on the
 * person's trusted click on the button in the box, asks TailorIT to rewrite what the box holds (the draft request's
 * currentAnswer) and writes the rewrite (the mock's CLEAN_REWRITE, never the box's text) over the draft. A legal question
 * in a section of open ones (Greenhouse's layout) closes neither of them (the Phase E review, M1). Each case then runs
 * assertTrapInvariants.
 */
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { mock } from '../helpers/mock.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { fixtureAddress } from '../helpers/reactive.ts';
import { trap } from '../helpers/traps.ts';
import { CLEAN_ANSWER, CLEAN_DRAFT, CLEAN_REWRITE } from '../mock-server/mock.mjs';

const SAVED = { file: 'fixtures/synthetic/saved-answers.html', url: fixtureAddress('fill-all-answers') } as const;
/** One section holding a legal question beside open ones, as Greenhouse lays a form out (the Phase E review, M1). */
const SECTION = { file: 'fixtures/synthetic/fill-all-section.html', url: fixtureAddress('fill-all-section') } as const;
const LEGAL = 'Are you legally authorized to work in the United States?';
const QUESTION = 'Which of our offices would you visit first?';
const LABELS = ['First name', 'Email', QUESTION];
const WHY = 'Why do you want to work here?';

test.describe('fill everything (the owner’s amendments)', () => {
  test('a question nothing settles is answered by the AI, marked "AI guess", from the question’s visible text only', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    routeLog.serve({ [SAVED.url]: SAVED.file });
    await tailorit.scenario('ai-answer');
    const page = await extContext.newPage();
    await page.goto(SAVED.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(row(report, QUESTION)).toMatchObject({ category: 'unknown', status: 'verified', provenance: 'llm-answer',
      reason: 'ai-guess', wrote: true, verification: 'verified', needsUserAction: false });
    await expect(page.locator('#office')).toHaveValue(CLEAN_ANSWER);
    // Classified first (no category), then answered: the question's visible text, never the profile's.
    const [answer, ...more] = await mock.requestsTo('POST /api/autofill/ai/answer');
    expect(more).toEqual([]);
    const body = JSON.parse(answer!.body) as { items: Array<Record<string, unknown>> };
    expect(body.items).toEqual([expect.objectContaining({ shape: 'text', kind: 'text', question: QUESTION, options: [] })]);
    for (const value of [GOLDEN.first, GOLDEN.last, GOLDEN.email]) expect(answer!.body).not.toContain(value);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(SAVED.url) });
  });

  test('a legal question in a section of open ones closes neither: the question is answered and the box drafted (M1)', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    routeLog.serve({ [SECTION.url]: SECTION.file });
    await tailorit.scenario('ai-answer');
    const page = await extContext.newPage();
    await page.goto(SECTION.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    // The legal question is the profile's.
    expect(row(report, LEGAL)).toMatchObject({ provenance: 'profile', wrote: true });
    // The open questions beside it: answered and drafted, each needing nothing of the person.
    expect(row(report, QUESTION)).toMatchObject({ status: 'verified', provenance: 'llm-answer', reason: 'ai-guess',
      wrote: true, needsUserAction: false });
    await expect(page.locator('#office')).toHaveValue(CLEAN_ANSWER);
    expect(row(report, WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'llm-draft-written',
      wrote: true, needsUserAction: false });
    await expect(page.locator('#why')).toHaveValue(CLEAN_DRAFT);
    const sent = await mock.requestsTo('POST /api/autofill/ai/*');
    expect(sent.map((request) => request.path)).toEqual(expect.arrayContaining(['/api/autofill/ai/answer',
      '/api/autofill/ai/draft']));
    // Never the legal question, nor its options.
    for (const request of sent) expect(request.body, request.path).not.toContain('legally authorized');
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: ['First name', 'Email', LEGAL, QUESTION, WHY], applicationKey: applicationKeyOf(SECTION.url) });
  });

  test('Edit with AI rewrites a box on the person’s click: the draft request carries what it holds, and the rewrite is written', async ({ extContext, connected: ext, routeLog, logs }) => {
    const served = trap('01');
    routeLog.serve({ [served.url]: served.file });
    const page = await extContext.newPage();
    await page.goto(served.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    // The draft, written and accepted by default.
    expect(row(report, WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'llm-draft-written',
      wrote: true, needsUserAction: false });
    await expect(page.locator('#why')).toHaveValue(CLEAN_DRAFT);
    expect(await mock.requestsTo('POST /api/autofill/ai/draft')).toHaveLength(1);

    // The button sits in the box: the person clicks it.
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.elements(`button[aria-label="${COPY.editWithAi}"]`))
      .filter((el) => el.shown).length).toBeGreaterThanOrEqual(1);
    const why = await page.locator('#why').boundingBox();
    const buttons = (await ui.elements(`button[aria-label="${COPY.editWithAi}"]`)).filter((el) => el.shown);
    let inBox: (typeof buttons)[number] | null = null;
    for (const button of buttons) {
      const box = await ui.box(button);
      if (box !== null && why !== null && box.x >= why.x && box.y >= why.y && box.x + box.width <= why.x + why.width
        && box.y + box.height <= why.y + why.height) inBox = button;
    }
    expect(inBox, 'an Edit with AI button inside the box').not.toBeNull();
    await ui.click(inBox!);
    // v3 Phase 3b: the button opens its instruction box (optional); nothing is asked until Generate.
    await expect.poll(async () => (await ui.elements('button.ai-prompt__generate')).filter((el) => el.shown).length).toBe(1);
    expect(await mock.requestsTo('POST /api/autofill/ai/draft')).toHaveLength(1);
    await ui.click((await ui.elements('button.ai-prompt__generate')).find((el) => el.shown)!);
    await expect.poll(async () => (await mock.requestsTo('POST /api/autofill/ai/draft')).length).toBe(2);
    const rewrite = JSON.parse((await mock.requestsTo('POST /api/autofill/ai/draft'))[1]!.body) as
      { questions: Array<{ question: string; currentAnswer?: string }>; canaries: string[] };
    expect(rewrite.questions).toEqual([expect.objectContaining({ question: WHY, currentAnswer: CLEAN_DRAFT })]);
    // No instruction typed: none is sent.
    expect(rewrite.questions[0]).not.toHaveProperty('instruction');
    expect(rewrite.canaries.map((canary) => canary.toLowerCase())).toContain('i am llm');
    // The rewrite is written over the draft, an accepted draft still.
    await expect(page.locator('#why')).toHaveValue(CLEAN_REWRITE);
    const rewritten = await ext.settled(tabId, { until: (each) => each.updatedAt > report.updatedAt });
    expect(row(rewritten, WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'llm-draft-written',
      wrote: true });
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers,
      canaries: served.canaries, labels: served.labels, applicationKey: applicationKeyOf(served.url) });
  });
});
