/*
 * The report page (the side panel opened as a tab, sidepanel.html?tabId=N: docs/ARCHITECTURE.md "UI") after a trap run
 * (Phase 6): every row the worker holds but a blocked one is drawn (v4 ui, D8), Required then Optional (v3 Phase 3,
 * Jobright's lists), each its icon and its label alone (v4 ui, D1: no status, reason, source, stage or confidence), the
 * progress as a percent, no notice (D10: the page's own notifications say what is left), and no value anywhere on the
 * page: not a profile value, not a hidden marker, not a canary.
 */
import { COPY } from '../../src/shared/copy';
import { progressOf, type FrameReport } from '../../src/shared/report';
import { shownReports } from '../../src/ui/report/model';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { example } from '../mock-server/mock.mjs';
import { GOLDEN, profileSentinels } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { trap } from '../helpers/traps.ts';

type Row = FrameReport['fields'][number];

/** "87%", as the old report drew a confidence (v4 ui: never drawn). */
const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

test('the report page shows a trap run’s rows as the worker holds them, blocked ones left out, no notice and no value', async ({ extContext, connected: ext, routeLog, logs }) => {
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
  // v4 ui (D8): a blocked row (a honeypot, a field with no visible label) is neither drawn nor counted.
  const [shownReport] = shownReports([report]);
  await expect(rows).toHaveCount(shownReport!.fields.length);
  await expect(panel.locator('section[data-progress]')).toHaveAttribute('data-progress', 'rest');
  // The percent the run's report gives, by the panels' one rule, over the rows shown.
  await expect(panel.locator('.tia-progress-line__percent')).toHaveText(COPY.report.percent(progressOf([shownReport!]).percent));

  // Each row in the report's order, the required ones first: its label alone, none of the report's own words.
  const ordered: Row[] = [...shownReport!.fields.filter((each) => each.required),
    ...shownReport!.fields.filter((each) => !each.required)];
  for (const [index, expected] of ordered.entries()) {
    const drawn = rows.nth(index);
    await expect(drawn).toHaveAttribute('data-field-key', expected.key);
    await expect(drawn).toHaveAttribute('data-status', expected.status);
    await expect(drawn).toHaveAttribute('data-provenance', expected.provenance ?? 'none');
    await expect(drawn.locator('button.tia-row__toggle')).toHaveCount(0);
    const text = (await drawn.locator('.tia-row__line').textContent()) ?? '';
    expect(text, expected.label).toContain(expected.label || COPY.report.noLabel);
    for (const word of [COPY.reasons[expected.reason], percent(expected.confidence)]) {
      expect(text, `${expected.label}: ${word}`).not.toContain(word);
    }
  }
  // One form on its own page: no form's name to tell it from another.
  await expect(panel.locator('.tia-frame__name')).toHaveCount(0);

  // v4 ui (D10): the trap's tripwire notice is the page's to say, not the panel's.
  await expect(panel.locator('[data-notice]')).toHaveCount(0);

  // No value: the page shows labels and words of its own, never what was typed, hidden or asked for by the trap. Every
  // folded row counts (its textContent: innerText skips a closed fold). The job card (v2) is read on its own below: it
  // says what TailorIT's lookup said, whose words can hold a profile value ("Austin, TX, USA"; a resume titled as the
  // profile's job title).
  const shown = (await panel.locator('main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelector('[data-job-card]')?.remove();
    copy.querySelector('[data-job-resume]')?.remove();
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
  // v4 ui: the card says the job, its place and the match; the resume is the review's row (or the résumé line).
  const said = [lookup.job.title, lookup.job.companyName, lookup.job.location, '75%', COPY.job.matchTip(9, 12)]
    .map((word) => word.toLowerCase());
  expect(cardText).not.toContain(GOLDEN_RESUME.label.toLowerCase());
  for (const word of said) expect(cardText, `the card's ${word}`).toContain(word);
  for (const value of [GOLDEN.email, GOLDEN.first, GOLDEN.last, ...profileSentinels()].map((each) => each.toLowerCase())) {
    if (cardText.includes(value)) expect(said.some((word) => word.includes(value)), `${value} on the card`).toBe(true);
  }
  for (const hidden of [...served.markers, ...served.canaries]) expect(cardText).not.toContain(hidden.toLowerCase());

  await page.bringToFront();
  await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers, canaries: served.canaries,
    labels: served.labels, applicationKey: applicationKeyOf(served.url) });
});
