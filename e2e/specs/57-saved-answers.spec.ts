/*
 * Saved answers and drafts end to end against the mock (Phase 6, wave 2; SPEC Requirement F; docs/ARCHITECTURE.md
 * "Actions per row"). fixtures/synthetic/saved-answers.html's header says what the page holds.
 * - Save my answer: a required question no rule knows is left flagged; the person answers it by hand (Playwright's
 *   trusted key presses), the review then offers Save my answer on that row alone, the person clicks it on the report
 *   page, and the worker reads the answer from the frame and PUTs it to TailorIT at once, never keeping it. The next
 *   form asking the same question is filled from it (provenance saved).
 * - Confirm draft: with drafts on and the confirmation setting on, trap 1's free-text question gets the clean draft,
 *   flagged; the person's Confirm draft on the report page makes it verified, an AI draft still.
 * Each case then runs assertTrapInvariants on a page the person did not type into.
 */
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, rowOf } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { mock } from '../helpers/mock.ts';
import { fixtureAddress } from '../helpers/reactive.ts';
import { trap } from '../helpers/traps.ts';
import { CLEAN_DRAFT } from '../mock-server/mock.mjs';

const SAVED = { file: 'fixtures/synthetic/saved-answers.html', url: fixtureAddress('saved-answers'),
  again: fixtureAddress('saved-answers-again') } as const;
const QUESTION = 'Which of our offices would you visit first?';
const ANSWER = 'The Lisbon office';
const LABELS = ['First name', 'Email', QUESTION];

test.describe('saved answers and drafts', () => {
  test('a flagged field the person answers by hand is saved, and the next form asking it is filled from that answer', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [SAVED.url]: SAVED.file, [SAVED.again]: SAVED.file });
    const page = await extContext.newPage();
    await page.goto(SAVED.url);
    const tabId = await ext.fill(page);
    const first = await ext.settled(tabId);
    expect(row(first, QUESTION)).toMatchObject({ category: 'unknown', status: 'flagged', provenance: null, wrote: false });
    expect(row(first, QUESTION).detail?.userEdited).toBeUndefined();

    // The person answers it themselves, with their own key presses.
    await page.bringToFront();
    await page.locator('#office').click();
    await page.keyboard.type(ANSWER);
    const fixed = await ext.settled(tabId, { until: (report) => rowOf(report, QUESTION)?.detail?.userEdited === true });
    expect(fixed.fields.filter((each) => each.detail?.userEdited === true).map((each) => each.label)).toEqual([QUESTION]);

    // v4 ui (D6): the review offers no Save my answer; the save itself stays the worker's (panel/saveAnswer), asked
    // here as the panel's page message.
    const panel = await ext.reportPage(tabId);
    await panel.bringToFront();
    const fixedRow = panel.locator(`li[data-field-key="${row(fixed, QUESTION).key}"]`);
    await expect(fixedRow).toBeVisible();
    await expect(panel.locator('[data-action="save-answer"]')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: COPY.report.saveAnswer })).toHaveCount(0);
    expect(await ext.data({ v: 1, type: 'panel/saveAnswer', tabId, frameId: 0, fieldKey: row(fixed, QUESTION).key }))
      .toEqual({ outcome: 'saved' });

    // What went to TailorIT: the question's key, no option set, every company, the answer as the person typed it.
    const puts = await mock.requestsTo('PUT /api/autofill/answers');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0]!.body)).toEqual({ questionKey: 'which of our offices would you visit first', optionSetHash: '',
      scope: '', fieldKind: 'text', questionLabel: QUESTION, platform: 'lever', answer: { kind: 'text', text: ANSWER },
      category: null });
    // The extension keeps none of it.
    expect(JSON.stringify(await ext.storage())).not.toContain('Lisbon');

    // The next form asking the same question: read back with the profile, and filled from the saved answer.
    const next = await extContext.newPage();
    await next.goto(SAVED.again);
    const nextTab = await ext.fill(next);
    const second = await ext.settled(nextTab);
    expect(row(second, QUESTION)).toMatchObject({ category: 'unknown', status: 'verified', provenance: 'saved', wrote: true,
      verification: 'verified' });
    await expect(next.locator('#office')).toHaveValue(ANSWER);
    expect((await mock.requestsTo('GET /api/autofill/answers')).length).toBeGreaterThanOrEqual(2);
    await assertTrapInvariants({ page: next, ext, tabId: nextTab, routeLog, console: logs(), markers: [], canaries: [],
      labels: LABELS, applicationKey: applicationKeyOf(SAVED.again) });
  });

  test('a draft the person confirms is theirs: verified, an AI draft still (v4 ui: no button in the review)', async ({ extContext, connected: ext, routeLog, logs }) => {
    // Drafts wait for the person only with "Wait for me to confirm each draft" on (the owner's amendments).
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: true, confirmDrafts: true } } });
    try {
      const served = trap('01');
      routeLog.serve({ [served.url]: served.file });
      const page = await extContext.newPage();
      await page.goto(served.url);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId);
      const why = row(report, 'Why do you want to work here?');
      expect(why).toMatchObject({ status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation' });

      // v4 ui (D6): the review offers no Confirm draft; the confirmation stays the worker's (panel/confirmDraft).
      const panel = await ext.reportPage(tabId);
      await panel.bringToFront();
      await expect(panel.locator(`li[data-field-key="${why.key}"]`)).toBeVisible();
      await expect(panel.locator('[data-action="confirm-draft"]')).toHaveCount(0);
      expect(await ext.data({ v: 1, type: 'panel/confirmDraft', tabId, frameId: 0, fieldKey: why.key })).toEqual({});
      const confirmed = await ext.settled(tabId, { until: (each) => rowOf(each, why.label)?.status === 'verified' });
      expect(row(confirmed, why.label)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'ok',
        needsUserAction: false });
      await expect(panel.locator(`li[data-field-key="${why.key}"] [data-action="confirm-draft"]`)).toHaveCount(0);
      await page.bringToFront();
      await expect(page.locator('#why')).toHaveValue(CLEAN_DRAFT);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers,
        canaries: served.canaries, labels: served.labels, applicationKey: applicationKeyOf(served.url) });
    } finally {
      await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
    }
  });
});
