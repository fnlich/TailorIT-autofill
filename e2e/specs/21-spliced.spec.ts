/*
 * Traps 1, 1b, 2, 3 and 8 spliced into a real Lever and a real Greenhouse snapshot (docs/ARCHITECTURE.md "Testing":
 * the route handler splices them in "so the real adapters face them too"), with the adapters' own splice
 * (src/adapters/splice.testkit.ts): the traps' job descriptions go into a white block at the start of the form, trap
 * 3's label comment into the form's first <label> and its option comment after the first </option> (beside the
 * form's comment on Greenhouse, which has no native select). The snapshot is served at its own address.
 * - The tripwire notice shows; every canary is held but Austin, which is the profile's own city; no hidden marker or
 *   canary reaches a request, report, RunState, storage, log or value (assertTrapInvariants).
 * - The field whose label holds trap 3's comment reads its label without the comment and is filled and verified, as
 *   trap 3's own "First name" is (the trap table); the comment's canary reaches no value. The other identity fields are
 *   verified from the profile too.
 */
import { readFileSync } from 'node:fs';
import { SPLICED_TRAPS, spliceTraps, type TrapSources } from '../../src/adapters/splice.testkit';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { expectation, snapshotLabels } from '../helpers/labels.ts';
import { trap } from '../helpers/traps.ts';
import { routesFile } from '../routes.ts';

const SOURCES = Object.fromEntries(SPLICED_TRAPS.map((spliced) => [spliced.id, readFileSync(spliced.file, 'utf8')])) as TrapSources;
const MARKERS = SPLICED_TRAPS.flatMap((spliced) => trap(spliced.id).markers);
const CANARIES = SPLICED_TRAPS.flatMap((spliced) => trap(spliced.id).canaries);

const CASES = [
  // The field whose label trap 3's comment lands in, and the other identity fields.
  { name: 'lever/zoox-fostercity', commented: 'Resume/CV', identity: ['Full name', 'Email', 'Phone'] },
  { name: 'greenhouse/gitlab-job', commented: 'First Name', identity: ['Last Name', 'Email'] },
] as const;

for (const spliced of CASES) {
  test(`traps 1, 1b, 2, 3 and 8 spliced into ${spliced.name}`, async ({ extContext, connected: ext, routeLog, logs }) => {
    // Nothing spliced in is a control, so the snapshot's own expectations still list every label.
    const expected = expectation(spliced.name);
    const html = spliceTraps(readFileSync(`fixtures/${spliced.name}.html`, 'utf8'), SOURCES);
    routeLog.serve({ ...routesFile(`fixtures/${spliced.name}.routes.json`),
      [expected.source]: { body: html, contentType: 'text/html; charset=utf-8' } });
    const page = await extContext.newPage();
    await page.goto(expected.source);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'tripwire')).toBeGreaterThanOrEqual(1);

    for (const label of [spliced.commented, ...spliced.identity]) {
      expect(row(report, label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
    }
    const commented = expected.fields.find((field) => field.label === spliced.commented)!.control;
    const held = await page.locator(commented).first().evaluate((el) => {
      const input = el as HTMLInputElement;
      return input.type === 'file' ? input.files?.length ?? 0 : input.value.length;
    });
    expect(held, `${spliced.commented} holds what was written`).toBeGreaterThan(0);

    const key = applicationKeyOf(expected.source)!;
    const canaries = ((await ext.runState(key))?.canarySet ?? []).map((canary) => canary.toLowerCase());
    expect(canaries).toEqual(expect.arrayContaining(['i am llm', 'banana', 'robot', 'pineapple']));
    expect(canaries).not.toContain('austin');
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: MARKERS, canaries: CANARIES,
      labels: snapshotLabels(spliced.name), applicationKey: key });
  });
}
