/*
 * The report page (the side panel opened as a tab, sidepanel.html?tabId=N: docs/ARCHITECTURE.md "UI") after a trap run
 * (Phase 6): every row the worker holds is drawn, Required then Optional (v3 Phase 3, Jobright's lists), with its status,
 * provenance, matcher stage, confidence and reason sentence folded under it, the progress as a percent, the notices on
 * top in the plan's words, and no value anywhere on the page: not a profile value, not a hidden marker, not a canary.
 */
import { COPY } from '../../src/shared/copy';
import { progressOf, type FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { example } from '../mock-server/mock.mjs';
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
  await expect(panel.locator('section[data-progress]')).toHaveAttribute('data-progress', 'rest');
  // The percent the run's report gives, by the panels' one rule.
  await expect(panel.locator('.tia-progress-line__percent')).toHaveText(COPY.report.percent(progressOf([report]).percent));

  // Each row in the report's order, the required ones first, with the report's own words once its detail unfolds.
  const ordered: Row[] = [...report.fields.filter((each) => each.required), ...report.fields.filter((each) => !each.required)];
  for (const [index, expected] of ordered.entries()) {
    const drawn = rows.nth(index);
    await expect(drawn).toHaveAttribute('data-field-key', expected.key);
    await expect(drawn).toHaveAttribute('data-status', expected.status);
    await expect(drawn).toHaveAttribute('data-provenance', expected.provenance ?? 'none');
    const fold = drawn.locator('button.tia-row__toggle');
    if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
    const text = (await drawn.textContent()) ?? '';
    for (const word of [expected.label || COPY.report.noLabel, COPY.statuses[expected.status], COPY.reasons[expected.reason],
      COPY.stages[expected.matcherStage], percent(expected.confidence),
      expected.provenance === null ? COPY.report.noSource : COPY.provenances[expected.provenance]]) {
      expect(text, `${expected.label}: ${word}`).toContain(word);
    }
  }
  // One form on its own page: no form's name to tell it from another.
  await expect(panel.locator('.tia-frame__name')).toHaveCount(0);

  // The trap's tripwire notice, in the plan's exact words, above every row.
  const notice = panel.locator('[data-notice="tripwire"]');
  await expect(notice).toHaveText(COPY.notices.tripwire);
  expect(await notice.evaluate((el, first) => Boolean(el.compareDocumentPosition(document.querySelector(first)!)
    & Node.DOCUMENT_POSITION_FOLLOWING), 'li[data-field-key]')).toBe(true);

  // No value: the page shows labels and words of its own, never what was typed, hidden or asked for by the trap. Every
  // folded row counts (its textContent: innerText skips a closed fold). The job card (v2) is read on its own below: it
  // says what TailorIT's lookup said, whose words can hold a profile value ("Austin, TX, USA"; a resume titled as the
  // profile's job title).
  const shown = (await panel.locator('main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelector('[data-job-card]')?.remove();
    return copy.textContent ?? '';
  })).toLowerCase();
  for (const value of [GOLDEN.email, GOLDEN.first, GOLDEN.last, ...profileSentinels()]) {
    expect(shown, 'a profile value on the report page').not.toContain(value.toLowerCase());
  }
  for (const hidden of [...served.markers, ...served.canaries]) expect(shown).not.toContain(hidden.toLowerCase());

  // The card: the lookup's own words, a profile value only inside them, and nothing the trap hid.
  const card = panel.locator('[data-job-card]');
  await expect(card).toHaveAttribute('data-job-state', 'found');
  const cardText = ((await card.textContent()) ?? '').toLowerCase();
  const lookup = example('AutofillLookupResponse') as { job: { title: string; companyName: string; location: string } };
  const said = [lookup.job.title, lookup.job.companyName, lookup.job.location, GOLDEN_RESUME.label, COPY.job.keywords(9, 12),
    '75%', COPY.job.bands.good, COPY.job.matchTip(9, 12)].map((word) => word.toLowerCase());
  for (const word of said) expect(cardText, `the card's ${word}`).toContain(word);
  for (const value of [GOLDEN.email, GOLDEN.first, GOLDEN.last, ...profileSentinels()].map((each) => each.toLowerCase())) {
    if (cardText.includes(value)) expect(said.some((word) => word.includes(value)), `${value} on the card`).toBe(true);
  }
  for (const hidden of [...served.markers, ...served.canaries]) expect(cardText).not.toContain(hidden.toLowerCase());

  await page.bringToFront();
  await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers, canaries: served.canaries,
    labels: served.labels, applicationKey: applicationKeyOf(served.url) });
});
