/*
 * The owner's real Lever and Greenhouse snapshots (docs/FIXTURES.md "The Lever and Greenhouse fixtures"), each served
 * at its own address with its .routes.json (the third-party frames answered by their empty stand-ins), through the
 * real adapters, in a dry run and then in a fill, each in a tab of its own.
 * - Dry run: nothing is written (no row wrote, every row not-checked, no write event, every value as the page had it).
 * - Fill: the identity fields the golden profile answers are verified from the profile; every control the
 *   expectations mark not fillable keeps its value; and each row the dry run promised ends with the dry run's status,
 *   unless what happened was the filler's or the page's to say (a read-back that differed, a widget that ignored us).
 * - Both: no report, RunState, storage or log holds a value (assertTrapInvariants, with no markers).
 */
import type { Page } from '@playwright/test';
import type { ReasonCode } from '../../src/core/types/fill';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants, controlValues } from '../helpers/invariants.ts';
import { expectation, snapshotLabels, type ExpectedField } from '../helpers/labels.ts';
import { writeEvents } from '../helpers/page-state.ts';
import { routesFile } from '../routes.ts';

const CASES = ['lever/spotify-ny', 'lever/zoox-fostercity', 'greenhouse/gitlab-job', 'greenhouse/discord-job',
  'greenhouse/figma-legacy-host', 'greenhouse/gitlab-embed'] as const;

/** The identity rows each platform's forms label as their snapshots show. */
const IDENTITY: Record<'lever' | 'greenhouse', Array<{ label: string; value: string; digits?: boolean }>> = {
  lever: [{ label: 'Full name', value: GOLDEN.full }, { label: 'Email', value: GOLDEN.email },
    { label: 'Phone', value: GOLDEN.phoneDigits, digits: true }],
  greenhouse: [{ label: 'First Name', value: GOLDEN.first }, { label: 'Last Name', value: GOLDEN.last },
    { label: 'Email', value: GOLDEN.email }],
};

/** Reasons only a fill can give: what the filler, the read-back or the page said. A dry run cannot know them. */
const FILL_ONLY: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['verify-mismatch', 'widget-unsupported', 'needs-your-click',
  'unexpected-selection', 'element-not-found', 'disabled-or-readonly', 'value-rejected-by-site', 'format-unsupported',
  'maxlength-exceeded', 'pdf-only-input', 'resume-unavailable', 'resume-transfer-failed', 'resume-format-unsupported',
  'field-disappeared', 'value-oscillated', 'page-busy']);

function caseOf(name: (typeof CASES)[number]) {
  const expected = expectation(name);
  return {
    platform: name.startsWith('lever/') ? 'lever' as const : 'greenhouse' as const,
    url: expected.source,
    fields: expected.fields,
    labels: snapshotLabels(name),
    routes: routesFile(`fixtures/${name}.routes.json`),
  };
}

/** Each not-fillable control's value, by its expectation's selector. */
async function notFillableValues(page: Page, fields: readonly ExpectedField[]): Promise<string[][]> {
  return Promise.all(fields.filter((field) => !field.fillable).map((field) => page.locator(field.control).evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio'
      ? String((el as HTMLInputElement).checked) : (el as HTMLInputElement).value))));
}

for (const name of CASES) {
  test.describe(name, () => {
    const snapshot = caseOf(name);

    test('a dry run writes nothing, and reports what a fill would do', async ({ extContext, connected: ext, routeLog, logs }) => {
      routeLog.serve(snapshot.routes);
      const page = await extContext.newPage();
      await page.goto(snapshot.url);
      const before = await controlValues(page);
      const tabId = await ext.fill(page, { dryRun: true });
      const report = await ext.settled(tabId, { mode: 'dry-run' });
      expect(report.fields.length).toBeGreaterThan(0);
      expect(report.fields.filter((field) => field.wrote || field.verification !== 'not-checked')).toEqual([]);
      expect(await writeEvents(page), 'a write event in a dry run').toEqual([]);
      expect(await controlValues(page)).toEqual(before);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: snapshot.labels,
        applicationKey: applicationKeyOf(snapshot.url) });
    });

    test("a fill verifies the profile's identity fields and leaves what is not fillable alone", async ({ extContext, connected: ext, routeLog, logs }) => {
      routeLog.serve(snapshot.routes);
      const dry = await extContext.newPage();
      await dry.goto(snapshot.url);
      const planned = await ext.settled(await ext.fill(dry, { dryRun: true }), { mode: 'dry-run' });
      await dry.close();

      const page = await extContext.newPage();
      await page.goto(snapshot.url);
      const untouched = await notFillableValues(page, snapshot.fields);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId);
      expect(report.status).toBe('review');
      expect(report.mode).toBe('fill');
      for (const identity of IDENTITY[snapshot.platform]) {
        expect(row(report, identity.label), identity.label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
        const control = snapshot.fields.find((field) => field.label === identity.label)!.control;
        const value = await page.locator(control).first().inputValue();
        if (identity.digits) expect(value.replace(/\D/g, ''), identity.label).toContain(identity.value.slice(-10));
        else expect(value, identity.label).toBe(identity.value);
      }
      expect(await notFillableValues(page, snapshot.fields)).toEqual(untouched);
      // The dry run's promise, kept: each row it planned ends with its status, but where only a fill could tell.
      const planByKey = new Map(planned.fields.map((field) => [field.key, field] as const));
      const broken = report.fields.filter((field) => !FILL_ONLY.has(field.reason) && planByKey.has(field.key)
        && planByKey.get(field.key)!.status !== field.status)
        .map((field) => ({ label: field.label, planned: planByKey.get(field.key)!.status, ended: field.status, reason: field.reason }));
      expect(broken, 'rows that ended unlike their dry run').toEqual([]);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: snapshot.labels,
        applicationKey: applicationKeyOf(snapshot.url) });
    });
  });
}
