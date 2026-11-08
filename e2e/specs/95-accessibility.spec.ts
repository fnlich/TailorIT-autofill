/*
 * The optional accessibility check (Phase 6; docs/design/runtime.md §12): @axe-core/playwright 4.13.0 over the report
 * page after a trap run (in TailorIT's look: its brand, Autofill, the progress and the field lists, v3 Phase 3; the
 * custom question's box opened, v4 ui), over the side panel's Settings view with a tooltip showing and its set-up view
 * with the disclosure unfolded (v4 ui), and over the options page with the anonymous counters showing,
 * none with a serious or critical violation; every fold is opened first, since axe skips a closed one (the Phase F1
 * review). v2: also the job card with its resume picker open, the custom question, and a problem strip.
 * Along the way it checks the counters end to end: opted in, a fill counts its fields with the
 * five fields and nothing else, and Clear empties them. The settings and the counts go back to their defaults
 * afterwards: the extension's context outlives this test.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { TELEMETRY_FIELDS } from '../../src/core/telemetry/events';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import type { TelemetryAnswer } from '../../src/messaging/schemas';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { trap } from '../helpers/traps.ts';
import { shownReports } from '../../src/ui/report/model';

/** The violations a person relying on assistive technology would be stopped by. */
async function seriousViolations(page: Page): Promise<Array<{ id: string; impact: string; targets: string[] }>> {
  await page.locator('details').evaluateAll((all) => all.forEach((each) => {
    (each as HTMLDetailsElement).open = true;
  }));
  // v3 Phase 3: every row's fold opened too; v4 ui: the custom question's box.
  await page.locator('button.tia-row__toggle[aria-expanded="false"], button[data-ask-action="open"][aria-expanded="false"]')
    .evaluateAll((all) => all.forEach((each) => (each as HTMLButtonElement).click()));
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({ id: violation.id, impact: violation.impact ?? '',
      targets: violation.nodes.map((node) => node.target.join(' ')) }));
}

test('the report page and the options page have no serious or critical accessibility violation', async ({ extContext, connected: ext, routeLog }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, telemetry: { optIn: true } } });
  try {
    await ext.data({ v: 1, type: 'telemetry/clear' });
    const served = trap('06');
    routeLog.serve({ [served.url]: served.file });
    const page = await extContext.newPage();
    await page.goto(served.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.fields.length).toBeGreaterThan(0);

    const panel = await ext.reportPage(tabId);
    await panel.bringToFront();
    // v4 ui (D8): every row but a blocked one.
    await expect(panel.locator('li[data-field-key]')).toHaveCount(shownReports([report])[0]!.fields.length);
    expect(await seriousViolations(panel), 'the report page').toEqual([]);

    // The fill was counted: exactly the five fields and a count per entry.
    const { counts } = await ext.data<TelemetryAnswer>({ v: 1, type: 'telemetry/get' });
    expect(counts.length).toBeGreaterThan(0);
    for (const count of counts) expect(Object.keys(count).sort()).toEqual([...TELEMETRY_FIELDS, 'count'].sort());
    expect(counts.every((count) => count.platform === 'lever')).toBe(true);

    const options = await extContext.newPage();
    await options.goto(ext.url('options.html'));
    await expect(options.locator('[data-telemetry="counts"]')).toBeVisible();
    await expect(options.locator('a[data-telemetry-export]')).toHaveAttribute('download', COPY.options.telemetry.exportName);
    expect(await seriousViolations(options), 'the options page').toEqual([]);

    await options.getByRole('button', { name: COPY.options.telemetry.clear, exact: true }).click();
    await expect(options.locator('[data-telemetry="empty"]')).toBeVisible();
    expect((await ext.data<TelemetryAnswer>({ v: 1, type: 'telemetry/get' })).counts).toEqual([]);
  } finally {
    await ext.data({ v: 1, type: 'telemetry/clear' }).catch(() => undefined);
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});

test('the side panel’s Settings view, a tooltip and its set-up view have no serious or critical accessibility violation (v4 ui)', async ({ extContext, connected: ext, routeLog }) => {
  const url = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a096/apply';
  routeLog.serve({ [url]: 'fixtures/synthetic/policy-apply.html' });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await ext.reportPage(tabId);
  await panel.bringToFront();
  await panel.locator('button[data-panel-settings]').click();
  await expect(panel.locator('[data-settings-view]')).toBeVisible();
  // A "?" focused: its bubble shows.
  await panel.locator('[data-setting-group="modes.afterPageTurn"] .tia-helptip__button').focus();
  await expect(panel.locator('[data-setting-group="modes.afterPageTurn"] [role="tooltip"]')).toBeVisible();
  expect(await seriousViolations(panel), 'the Settings view').toEqual([]);
  // Not connected: the set-up view, its first step's disclosure unfolded. (The next test's fixture connects again.)
  await ext.data({ v: 1, type: 'auth/disconnect' });
  await panel.reload();
  await expect(panel.locator('[data-setup]')).toBeVisible();
  await panel.locator('button[data-step-action="account"]').click();
  await expect(panel.locator('[data-consent]')).toBeVisible();
  expect(await seriousViolations(panel), 'the set-up view').toEqual([]);
});

test('the report page after a profile-only fill (v4: no policy card) has no serious or critical accessibility violation', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  // TailorIT's stored copy of the posting says no AI tools: the run fills from the profile only, with no card.
  await tailorit.scenario('lookup-posting-text');
  const url = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a095/apply';
  routeLog.serve({ [url]: 'fixtures/synthetic/policy-apply.html' });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.fill(page);
  expect((await ext.settled(tabId)).status).toBe('review');
  const panel = await ext.reportPage(tabId);
  await panel.bringToFront();
  expect(await seriousViolations(panel), 'the report page after a profile-only fill').toEqual([]);
});

test('the report page with the job card, its resume picker, the custom question and a problem strip has no serious or critical violation (v2)', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  await tailorit.scenario('lookup-applied');
  const url = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000a095c/apply';
  routeLog.serve({ [url]: 'fixtures/synthetic/policy-apply.html' });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await ext.reportPage(tabId);
  await expect(panel.locator('[data-job-card]')).toHaveAttribute('data-job-state', 'found');
  await panel.getByRole('button', { name: COPY.job.change, exact: true }).click();
  await expect(panel.locator('[data-resume-choice=""]').first()).toBeVisible();
  expect(await seriousViolations(panel), 'the report page with the job card').toEqual([]);
  try {
    // TailorIT now speaks another version: the connection line becomes a problem strip with its settings link.
    await tailorit.scenario('version-mismatch');
    await ext.send({ v: 1, type: 'panel/resumes', tabId });
    await panel.reload();
    await expect(panel.locator('.tia-connection.tia-strip a')).toBeVisible();
    expect(await seriousViolations(panel), 'a problem strip').toEqual([]);
  } finally {
    // Back to the same version, so later specs see no mismatch.
    await tailorit.reset();
    await ext.send({ v: 1, type: 'panel/resumes', tabId });
  }
});
