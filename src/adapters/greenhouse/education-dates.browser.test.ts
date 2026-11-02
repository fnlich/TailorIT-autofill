/*
 * Greenhouse's Education dates (fixtures/greenhouse/affirm-job and twitch-job): each block asks "Start date month" and
 * "End date month" as react-selects whose lists show only when opened (lazy), and "Start date year" and "End date year"
 * as text boxes. Planned by the real planFrame with the golden profile (its school 2015-08 to 2019-05), the lists read
 * as a run reads them once opened (the widget readings): a month list chooses the option it shows for the month, by
 * its name, its abbreviation ("Aug") or its number ("08", "08 - August") (resolve.ts datePartChoice, the Phase 2
 * review); a list whose options name months but not this one leaves it flagged; a year box takes the four digits.
 */
import { afterEach, describe, expect, it } from 'vitest';
import affirmHtml from '../../../fixtures/greenhouse/affirm-job.html?raw';
import twitchHtml from '../../../fixtures/greenhouse/twitch-job.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { WidgetReading } from '../../dom/types';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { greenhouseAdapter } from './index';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

afterEach(() => removeFixtures(document));

/** The fixture scanned, each month list read as `months` (lazy before). */
async function specsOf(html: string, months: readonly string[] | null): Promise<FieldSpec[]> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  const first = scan(root, greenhouseAdapter, { platform: 'greenhouse' });
  if (months === null) return first.fields.map(toFieldSpec);
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields.filter((candidate) => /date month$/i.test(candidate.label))) {
    readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: months.map((label) => ({ label, disabled: false })) });
  }
  return scan(root, greenhouseAdapter, { platform: 'greenhouse', widgetReadings: readings }).fields.map(toFieldSpec);
}

function plan(specs: FieldSpec[]) {
  return planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
}

/** What the plan writes into the first Education block's date fields, by label. */
function dates(specs: FieldSpec[]): Record<string, unknown> {
  const output = plan(specs);
  const out: Record<string, unknown> = {};
  for (const label of ['Start date month', 'Start date year', 'End date month', 'End date year']) {
    const spec = specs.find((candidate) => candidate.label === label)!;
    const write = output.writes.find((candidate) => candidate.key === spec.key);
    const row = output.results.find((candidate) => candidate.key === spec.key)!;
    out[label] = write === undefined ? row.reason
      : write.value.kind === 'option' ? write.value.cleanLabel : write.value.kind === 'text' ? write.value.text : write.value;
  }
  return out;
}

describe("Greenhouse's Education dates", () => {
  it.each([['affirm', affirmHtml], ['twitch', twitchHtml]])('%s: each month from its list, each year as four digits', async (_, html) => {
    expect(dates(await specsOf(html, null))).toEqual({ 'Start date month': 'waiting-for-options', 'Start date year': '2015',
      'End date month': 'waiting-for-options', 'End date year': '2019' });
    removeFixtures(document);
    expect(dates(await specsOf(html, MONTHS))).toEqual({ 'Start date month': 'August', 'Start date year': '2015',
      'End date month': 'May', 'End date year': '2019' });
  });

  it('reads a list of abbreviations or numbers, and leaves a list that names months but not this one flagged', async () => {
    expect(dates(await specsOf(affirmHtml, MONTHS.map((month) => month.slice(0, 3)))))
      .toMatchObject({ 'Start date month': 'Aug', 'End date month': 'May' });
    removeFixtures(document);
    expect(dates(await specsOf(affirmHtml, MONTHS.map((month, at) => `${String(at + 1).padStart(2, '0')} - ${month}`))))
      .toMatchObject({ 'Start date month': '08 - August', 'End date month': '05 - May' });
    removeFixtures(document);
    expect(dates(await specsOf(affirmHtml, MONTHS.map((_, at) => String(at + 1).padStart(2, '0')))))
      .toMatchObject({ 'Start date month': '08', 'End date month': '05' });
    removeFixtures(document);
    // Only the first half of the year: August is not there, and nothing else is taken for it.
    const output = dates(await specsOf(affirmHtml, MONTHS.slice(0, 6)));
    expect(output['Start date month']).not.toMatch(/^(?:January|February|March|April|May|June)$/);
    expect(output['End date month']).toBe('May');
  });
});
