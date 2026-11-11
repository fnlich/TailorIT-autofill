/*
 * jr6 ENGINE E1 (FIXPLAN §6.2 item 5, U-04): a remote typeahead its adapter declares free text (WidgetDecl.freeText:
 * UltiPro's School Name, which Jobright's ~contents/sites/ultipro rules type as plain text) keeps the planner's first
 * query when no result matches, through the pass's own write (writeField's searchField): the planner's row written and
 * verified by the box's value, no "Other" query after it, and the read-back after the settle (verifyWritten) finding
 * the same text. A widget that does not declare it is left as before: the box put back, the row flagged no-match. The
 * page is synthetic (SP\jr6\audit\ultipro.md's shape), its values the test's own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import type { BaseKey } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult, WidgetReading } from '../dom/types';
import { writeField, type PassEnv, type WidgetWriteEnv } from './pass';
import { verifyWritten } from './verify';

const PAGE = `<!doctype html><html><head><style>[hidden] { display: none !important; }</style></head><body>
<form id="f">
  <label for="school">School Name</label>
  <input id="school" class="tt-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
    aria-owns="school-menu" autocomplete="off">
  <div id="school-menu" class="tt-menu" role="listbox" hidden><div class="tt-dataset"></div></div>
</form>
<script>
  window.__typed = [];
  const SCHOOLS = ['Lakeside University', 'Riverside College'];
  const box = document.getElementById('school');
  const menu = document.getElementById('school-menu');
  const dataset = menu.querySelector('.tt-dataset');
  box.addEventListener('input', () => {
    window.__typed.push(box.value);
    const query = box.value.trim().toLowerCase();
    const found = SCHOOLS.filter((name) => query !== '' && name.toLowerCase().includes(query));
    dataset.replaceChildren(...(found.length === 0 ? [Object.assign(document.createElement('div'),
      { className: 'tt-empty', textContent: 'No matches' })] : found.map((name) => Object.assign(
      document.createElement('div'), { className: 'tt-suggestion', textContent: name }))));
    menu.hidden = query === '';
  });
  box.addEventListener('focusout', () => { menu.hidden = true; });
</script></body></html>`;

const SCHOOL = 'Northgate Community College';

afterEach(() => removeFixtures(document));

/** The page, its School declared a remote typeahead (free text unless `free` is false), read as a search, and its query
 *  write made through writeField with a worker that finds no result to choose. */
async function search(free: boolean, other = false) {
  const fixture = await loadFixture(document, PAGE, { width: 1280, height: 900 });
  const doc = fixture.doc;
  const root = doc.getElementById('f')!;
  const adapter = {
    widgetFor: (control: Element) => (control.id === 'school' ? { kind: 'typeahead-remote', opener: control,
      results: { list: doc.getElementById('school-menu')!, option: '.tt-suggestion' }, emptyAfterMs: 400,
      ...(free ? { freeText: true } : {}), snapshot: 'synthetic UltiPro school' } : null),
  } as unknown as Adapter;
  const readings = new Map<BaseKey, WidgetReading>();
  const read = (): ScanResult => scan(root, adapter, { platform: 'ultipro', frameId: 0, widgetReadings: readings });
  readings.set(read().fields[0]!.baseKey, { kind: 'remote' });
  const last = read();
  const field = last.fields[0]!;
  const env = { adapter, root, platform: 'ultipro', frameId: 0, dryRun: false, canaries: [],
    signal: new AbortController().signal, valid: () => true, stopped: () => false, runId: () => 'run',
    heldBy: () => null } as unknown as PassEnv;
  const write: PlannedWrite = { key: field.key,
    value: { kind: 'query', queries: [SCHOOL, 'Northgate College'], ...(other ? { other: true } : {}) },
    origin: { provenance: 'profile', path: 'education[0].institution', transform: 'typeahead.query' },
    match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 0.9, flags: [], suggestions: [],
      reason: 'ok' } } as unknown as PlannedWrite;
  const planned = { key: field.key, label: 'School Name', kind: 'typeahead-remote', category: 'education.school',
    section: field.section.id, required: true, status: 'filled', provenance: 'profile', matcherStage: 'not-applicable',
    confidence: 0.9, reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false } as FillResult;
  const asked: string[][] = [];
  const widgets: WidgetWriteEnv = { readings, plan: async (specs) => {
    asked.push(specs.flatMap((spec) => (spec.options === 'lazy' ? [] : spec.options.map((option) => option.label))));
    return { results: [{ ...planned, status: 'flagged', reason: 'no-match', provenance: null }], writes: [] } as never;
  } };
  const result = await writeField(env, last, field, write, planned, new WeakMap(), { widgets });
  return { doc, result, asked, typed: (fixture.view as unknown as { __typed: string[] }).__typed, after: read() };
}

describe('a free-text search through the pass (jr6 ENGINE E1, U-04)', () => {
  it('keeps the first query as the answer: written, verified, and so read back after the settle', async () => {
    const { doc, result, typed, after } = await search(true, true);
    expect(result.row).toMatchObject({ status: 'verified', wrote: true, verification: 'verified', provenance: 'profile',
      reason: 'ok', needsUserAction: false });
    expect((doc.getElementById('school') as HTMLInputElement).value).toBe(SCHOOL);
    // No "Other" query follows a free text that stood, though the planner asked for one.
    expect(typed).toEqual([SCHOOL, 'Northgate College', SCHOOL]);
    expect(result.written?.value).toEqual({ kind: 'text', text: SCHOOL });
    expect(result.readBack).toEqual({ kind: 'selected', labels: [SCHOOL] });
    expect(verifyWritten(after, result.written!)).toMatchObject({ status: 'verified', verification: 'verified' });
  });

  it('a search that does not declare it puts the box back and flags the field, as before', async () => {
    const { doc, result, typed } = await search(false);
    expect(result.row).toMatchObject({ status: 'flagged', wrote: false, reason: 'no-match', provenance: null });
    expect(result.written).toBeUndefined();
    expect((doc.getElementById('school') as HTMLInputElement).value).toBe('');
    expect(typed).toEqual([SCHOOL, 'Northgate College', '']);
  });
});
