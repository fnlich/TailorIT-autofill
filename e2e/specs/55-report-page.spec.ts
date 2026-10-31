/*
 * The report page (the side panel opened as a tab, sidepanel.html?tabId=N: docs/ARCHITECTURE.md "UI") after a trap run
 * (Phase 6): every row the worker holds is drawn, by frame and section, with its status, provenance, matcher stage,
 * confidence and reason sentence, the notices on top in the plan's words, and no value anywhere on the page: not a
 * profile value, not a hidden marker, not a canary.
 */
import { COPY } from '../../src/shared/copy';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { GOLDEN, profileSentinels } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { trap } from '../helpers/traps.ts';

type Row = FrameReport['fields'][number];

/** "87%", as the report draws a confidence. */
const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

test('the report page shows a trap run’s rows as the worker holds them, its notices on top, and no value', async ({ extContext, connected: ext, routeLog, logs }) => {
  const served = trap('01');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.fill(page);
  const report = await ext.settled(tabId);
  expect(report.status).toBe('review');

  const panel = await ext.reportPage(tabId);
  await panel.bringToFront();
  const rows = panel.locator('li[data-field-key]');
  await expect(rows).toHaveCount(report.fields.length);
  await expect(panel.locator('[data-run-status]').first()).toHaveText(COPY.runStatuses.review);

  // Each row in the report's order within its section, with the report's own words.
  const sections = [...new Set(report.fields.map((each) => each.section))];
  const ordered: Row[] = sections.flatMap((section) => report.fields.filter((each) => each.section === section));
  for (const [index, expected] of ordered.entries()) {
    const drawn = rows.nth(index);
    await expect(drawn).toHaveAttribute('data-field-key', expected.key);
    await expect(drawn).toHaveAttribute('data-status', expected.status);
    await expect(drawn).toHaveAttribute('data-provenance', expected.provenance ?? 'none');
    const text = (await drawn.textContent()) ?? '';
    for (const word of [expected.label || COPY.report.noLabel, COPY.statuses[expected.status], COPY.reasons[expected.reason],
      COPY.stages[expected.matcherStage], percent(expected.confidence),
      expected.provenance === null ? COPY.report.noSource : COPY.provenances[expected.provenance]]) {
      expect(text, `${expected.label}: ${word}`).toContain(word);
    }
  }
  const frame = panel.locator(`[data-frame-id="${report.frameId}"]`);
  await expect(frame.locator('h2')).toHaveText(COPY.report.frame(COPY.platforms[report.platform], false));

  // The trap's tripwire notice, in the plan's exact words, above every row.
  const notice = panel.locator('[data-notice="tripwire"]');
  await expect(notice).toHaveText(COPY.notices.tripwire);
  expect(await notice.evaluate((el, first) => Boolean(el.compareDocumentPosition(document.querySelector(first)!)
    & Node.DOCUMENT_POSITION_FOLLOWING), 'li[data-field-key]')).toBe(true);

  // No value: the page shows labels and words of its own, never what was typed, hidden or asked for by the trap.
  const shown = (await panel.locator('main').innerText()).toLowerCase();
  for (const value of [GOLDEN.email, GOLDEN.first, GOLDEN.last, ...profileSentinels()]) {
    expect(shown, 'a profile value on the report page').not.toContain(value.toLowerCase());
  }
  for (const hidden of [...served.markers, ...served.canaries]) expect(shown).not.toContain(hidden.toLowerCase());

  await page.bringToFront();
  await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers, canaries: served.canaries,
    labels: served.labels, applicationKey: applicationKeyOf(served.url) });
});
