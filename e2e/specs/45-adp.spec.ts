/*
 * ADP Workforce Now end to end on the owner's converted snapshots (fixtures/adp, DESIGN-NEW-ATS §5 builder A), each
 * served at its own address with its .routes.json, through the ADP adapter:
 * - step 1 of the wizard (personal.html, adp-1), a step the adapter reads as not final (its Next shows): a dry run
 *   writes nothing; a fill writes and verifies the profile's first and last name from the step's own labels, leaves the
 *   disabled Email (the signed-in account's) alone and submits nothing; under the default Next mode (Manual) both rest
 *   waiting for the person's Next (wait-transition), which the run never presses;
 * - the emailed-code dialog (code-dialog.html, adp-0): the run hands the step to the person (handoff, email-code): the
 *   code is theirs, and nothing is written, neither the code box nor the guest page behind the dialog.
 * Both hold the trap invariants: no report, RunState, storage or log holds a value.
 */
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, rowOf, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants, controlValues } from '../helpers/invariants.ts';
import { expectation, snapshotLabels } from '../helpers/labels.ts';
import { writeEvents } from '../helpers/page-state.ts';
import { BETWEEN_STEPS } from '../helpers/wizard.ts';
import { routesFile } from '../routes.ts';

function caseOf(name: 'adp/personal' | 'adp/code-dialog') {
  const expected = expectation(name);
  return { url: expected.source, fields: expected.fields, labels: snapshotLabels(name),
    routes: routesFile(`fixtures/${name}.routes.json`) };
}

/** The tab's top-frame report once it rests between steps (BETWEEN_STEPS: waiting for the person's Next included). */
async function between(ext: Extension, tabId: number, mode: FrameReport['mode']): Promise<FrameReport> {
  const held: { report: FrameReport | null } = { report: null };
  await expect.poll(async () => {
    const report = (await ext.reports(tabId)).find((candidate) => candidate.frameId === 0) ?? null;
    held.report = report !== null && report.mode === mode && (BETWEEN_STEPS as readonly string[]).includes(report.status)
      ? report : null;
    return held.report?.status ?? `not yet (${report === null ? 'no report' : `${report.mode} ${report.status}`})`;
  }, { timeout: 45_000, intervals: [200, 300, 500] }).toMatch(new RegExp(`^(?:${BETWEEN_STEPS.join('|')})$`));
  return held.report!;
}

test.describe('ADP Workforce Now (DESIGN-NEW-ATS builder A)', () => {
  test("step 1: a dry run writes nothing, and a fill verifies the profile's names, never the account's email", async ({ extContext, connected: ext, routeLog, logs }) => {
    const snapshot = caseOf('adp/personal');
    routeLog.serve(snapshot.routes);
    const dry = await extContext.newPage();
    await dry.goto(snapshot.url);
    const before = await controlValues(dry);
    const planned = await between(ext, await ext.fill(dry, { dryRun: true }), 'dry-run');
    expect(planned.fields.length).toBeGreaterThan(0);
    expect(planned.fields.filter((field) => field.wrote || field.verification !== 'not-checked')).toEqual([]);
    expect(await writeEvents(dry), 'a write event in a dry run').toEqual([]);
    expect(await controlValues(dry)).toEqual(before);
    await dry.close();

    const page = await extContext.newPage();
    await page.goto(snapshot.url);
    const tabId = await ext.fill(page);
    const report = await between(ext, tabId, 'fill');
    expect(report.status).toBe('wait-transition');
    for (const [label, value, control] of [['First Name', GOLDEN.first, '#personalInfomationFirstName'],
      ['Last Name', GOLDEN.last, '#personalInfomationLastName']] as const) {
      expect(row(report, label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
      expect(await page.locator(control).inputValue(), label).toBe(value);
    }
    // The signed-in account's email box is disabled (adp-1): never written.
    expect(await page.locator('#personalInfomationEmail').inputValue()).toBe('');
    expect(rowOf(report, 'Email')?.wrote ?? false).toBe(false);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: snapshot.labels, applicationKey: applicationKeyOf(snapshot.url) });
  });

  test("the emailed-code dialog is the person's: the run hands it over and writes nothing", async ({ extContext, connected: ext, routeLog, logs }) => {
    const snapshot = caseOf('adp/code-dialog');
    routeLog.serve(snapshot.routes);
    const page = await extContext.newPage();
    await page.goto(snapshot.url);
    const before = await controlValues(page);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('handoff');
    expect(report.pauseReason).toBe('email-code');
    expect(await writeEvents(page), 'a write event at the code dialog').toEqual([]);
    expect(await controlValues(page)).toEqual(before);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: snapshot.labels, applicationKey: applicationKeyOf(snapshot.url) });
  });
});
