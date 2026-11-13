/*
 * jr8 WORKDAY (the owner's rule of 2026-11-13, and the coordinator's note: one predicate for Next mode Auto and the
 * panel's "Continue to the next page"): content/required-left.ts reads a step's required questions as filled when the
 * page shows an answer in them, whoever gave it, but never by a native select's or radio group's own default (FIX7PLAN
 * O-3) unless the run wrote it, the person touched it, or the run could not decide the question by its own limits
 * (ICIMS7-V4). Made-up pages and values only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import infoAfterHtml from '../../fixtures/workday/jr8-aristocrat-my-information-after.html?raw';
import { genericAdapter } from '../adapters/generic';
import { workdayAdapter } from '../adapters/workday';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { FillResult, ReasonCode } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult } from '../dom/types';
import { lastFillOf } from './report';
import { countedAsShown, filledAsShown, requiredUnfilledOf } from './required-left';

afterEach(() => removeFixtures(document));

/** A step of required questions: two native selects showing their own default (one marked selected, one its first
 *  option), a radio group whose markup checked Yes, an empty badge box and an empty city box. */
const PAGE = `<!doctype html><html><body><form id="f">
  <label for="period">Desired salary period</label>
  <select id="period" required><option value="hr" selected>Hr.</option><option value="yr">Yr.</option></select>
  <label for="plain">Preferred shift</label>
  <select id="plain" required><option>Day</option><option>Night</option></select>
  <fieldset><legend>Willing to relocate?</legend>
    <input type="radio" name="move" id="move-yes" value="y" checked required><label for="move-yes">Yes</label>
    <input type="radio" name="move" id="move-no" value="n"><label for="move-no">No</label></fieldset>
  <label for="badge">Badge number</label><input id="badge" type="text" required>
  <label for="city">City</label><input id="city" type="text" required>
</form></body></html>`;

async function step() {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.getElementById('f')!;
  return { ...fixture, scan: () => scan(root, genericAdapter, { platform: 'icims' }) };
}

/** The run's rows for every field of a scan: required, flagged with `reason`, nothing written. */
function rowsOf(scanned: ScanResult, reason: ReasonCode): FillResult[] {
  return scanned.fields.map((field) => ({ key: field.key, label: field.label, kind: field.kind, category: 'unknown',
    section: 'main', required: true, status: 'flagged', provenance: null, matcherStage: 'not-applicable',
    confidence: 0, reason, wrote: false, verification: 'not-applicable', needsUserAction: true }) as FillResult);
}

const nobody = () => false;
const labelsLeft = (scanned: ScanResult, rows: readonly FillResult[], touched: (el: Element) => boolean = nobody) =>
  scanned.fields.filter((field) => !filledAsShown(scanned, field, rows.find((row) => row.key === field.key), touched))
    .map((field) => field.label);

describe('jr8: a required question is filled as the page shows it (required-left.ts)', () => {
  it('never reads a native select’s or radio group’s own default as an answer to a question the run left', async () => {
    const page = await step();
    const scanned = page.scan();
    expect(scanned.fields.map((field) => [field.label, field.required])).toEqual([['Desired salary period', true],
      ['Preferred shift', true], ['Willing to relocate?', true], ['Badge number', true], ['City', true]]);
    const rows = rowsOf(scanned, 'no-profile-value');
    expect(labelsLeft(scanned, rows)).toEqual(['Desired salary period', 'Preferred shift', 'Willing to relocate?',
      'Badge number', 'City']);
    expect(requiredUnfilledOf(scanned, rows, nobody)).toBe(5);
    expect(lastFillOf(countedAsShown(scanned, rows, nobody)).flagged).toBe(5);
    // No row at all (a question drawn after the fill): a default is still no answer.
    expect(requiredUnfilledOf(scanned, [], nobody)).toBe(5);
  });

  it('reads a default as the answer once the run wrote it, the person chose it, or the run could not tell the question',
    async () => {
      const page = await step();
      const scanned = page.scan();
      const rows = rowsOf(scanned, 'no-profile-value');
      const period = page.doc.getElementById('period')!;
      const yes = page.doc.getElementById('move-yes')!;
      expect(labelsLeft(scanned, rows, (el) => el === period || el === yes)).toEqual(['Preferred shift', 'Badge number',
        'City']);
      const written = rows.map((row) => (row.label === 'Preferred shift'
        ? { ...row, status: 'verified', wrote: true, reason: 'ok', needsUserAction: false } as FillResult : row));
      expect(labelsLeft(scanned, written)).toEqual(['Desired salary period', 'Willing to relocate?', 'Badge number',
        'City']);
      // ICIMS7-V4: a question the run could not tell, the page's own answer in it, stands.
      expect(labelsLeft(scanned, rowsOf(scanned, 'unknown-field'))).toEqual(['Badge number', 'City']);
      expect(requiredUnfilledOf(scanned, rowsOf(scanned, 'format-unsupported'), nobody)).toBe(2);
    });

  it('reads any other answer the page shows as filled, whoever gave it, and counts it so for Next', async () => {
    const page = await step();
    (page.doc.getElementById('city') as HTMLInputElement).value = 'Fixture City';
    (page.doc.getElementById('plain') as HTMLSelectElement).selectedIndex = 1;
    const scanned = page.scan();
    const rows = rowsOf(scanned, 'no-profile-value');
    expect(labelsLeft(scanned, rows)).toEqual(['Desired salary period', 'Willing to relocate?', 'Badge number']);
    const counted = countedAsShown(scanned, rows, nobody);
    expect(counted.filter((row) => row.detail?.filledByYou === true).map((row) => row.label)).toEqual(['Preferred shift',
      'City']);
    expect(lastFillOf(counted).flagged).toBe(3);
    // The rows themselves are as they were (a count's reading only).
    expect(rows.every((row) => row.detail === undefined)).toBe(true);
    expect(requiredUnfilledOf(scanned, rows, nobody)).toBe(3);
  });

  it('reads a row the run marked the page’s (an Ashby Yes/No pressed, detail.filledByYou) as filled', async () => {
    const page = await step();
    const scanned = page.scan();
    const rows = rowsOf(scanned, 'no-profile-value').map((row) => (row.label === 'Badge number'
      ? { ...row, detail: { filledByYou: true as const } } : row));
    expect(labelsLeft(scanned, rows)).not.toContain('Badge number');
  });

  it('counts a required row left for the person whose field no scan reads (an upload the fill attached nothing to)',
    async () => {
      const page = await step();
      const scanned = page.scan();
      (page.doc.getElementById('city') as HTMLInputElement).value = 'Fixture City';
      const now = page.scan();
      const gone: FillResult = { ...rowsOf(scanned, 'resume-unavailable')[0]!, key: 'upload|resume|file' as FillResult['key'],
        label: 'Resume' };
      expect(requiredUnfilledOf(now, [...rowsOf(now, 'unknown-field'), gone], nobody)).toBe(2);
    });

  it('reads a Workday prompt’s pill, drawn by the page, as filled (snapshot13’s “How Did You Hear About Us?”)',
    async () => {
      const fixture = await loadFixture(document, infoAfterHtml, SNAPSHOT_VIEWPORT);
      const root = workdayAdapter.detect(fixture.doc)!.formRoot;
      const scanned = scan(root, workdayAdapter, { platform: 'workday' });
      const source = scanned.fields.find((field) => field.label === 'How Did You Hear About Us?')!;
      expect([source.kind, source.required, source.current.kind]).toEqual(['typeahead-remote', true, 'selected']);
      const row = rowsOf(scanned, 'no-profile-value').find((each) => each.key === source.key);
      expect(filledAsShown(scanned, source, row, nobody)).toBe(true);
    });
});
