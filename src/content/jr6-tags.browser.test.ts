/*
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a box of several answers its adapter declares (WidgetDecl.tags:
 * UltiPro's review Skills, typed and added by the Add beside it), through the pass's own write (writeField's writeTags):
 * the planner's text (the person's values joined with MANY_SEPARATOR) split again, each value missing from the chips a
 * guarded write of its own (its Guard on a fresh scan, guardWriteInFrame on that value), the row verified by the chips
 * and so is the read-back after the settle (verifyWritten). A box at its cap is filled, max-selections-reached; a box
 * whose chips show every value is already-correct, nothing typed; a canary in the planned text blocks the field before
 * anything is typed. The page is synthetic (SP\jr6\audit\ultipro.md's shape), its values the golden profile's skills.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter, WidgetDecl } from '../adapters/types';
import { MANY_SEPARATOR } from '../core/resolver/values';
import type { BaseKey } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult, WidgetReading } from '../dom/types';
import { writeField, type PassEnv, type WidgetWriteEnv } from './pass';
import { verifyWritten } from './verify';

const PAGE = `<!doctype html><html><head><style>
  .chip { display: inline-block; margin: 2px; padding: 2px 4px; border: 1px solid #888; }
</style></head><body><form id="f">
  <label for="skill-input">Skills</label>
  <ul id="chips"></ul>
  <div class="form-inline"><input id="skill-input" type="text" maxlength="80" autocomplete="off">
    <button id="add" type="button" disabled>Add</button></div>
</form>
<script>
  window.__typed = [];
  const box = document.getElementById('skill-input');
  const add = document.getElementById('add');
  const chips = document.getElementById('chips');
  box.addEventListener('input', () => { add.disabled = box.value.trim() === ''; });
  add.addEventListener('click', () => {
    window.__typed.push(box.value);
    const chip = document.createElement('li');
    chip.className = 'chip';
    const words = document.createElement('strong');
    words.textContent = box.value.trim();
    chip.append(words);
    chips.append(chip);
    box.value = '';
    add.disabled = true;
  });
</script></body></html>`;

/** The golden profile's skills (fixtures/profiles/alex-rivera.profile.json) as the planner joins them. */
const SKILLS = ['TypeScript', 'PostgreSQL', 'Kubernetes'].join(MANY_SEPARATOR);

afterEach(() => removeFixtures(document));

/** The page, its Skills box declared as the ULTIPRO package will declare it (at most `cap` chips), and the planned text
 *  written through writeField; `chipped` are chips the page shows before the run. */
async function write(text: string, options: { cap?: number; chipped?: readonly string[]; canaries?: string[] } = {}) {
  const fixture = await loadFixture(document, PAGE, { width: 1280, height: 900 });
  const doc = fixture.doc;
  const root = doc.getElementById('f')!;
  for (const words of options.chipped ?? []) {
    const chip = doc.createElement('li');
    chip.className = 'chip';
    chip.append(Object.assign(doc.createElement('strong'), { textContent: words }));
    doc.getElementById('chips')!.append(chip);
  }
  const adapter = {
    widgetFor: (control: Element) => (control.id === 'skill-input' ? { kind: 'typeahead-remote', opener: control as HTMLElement,
      tags: { chips: () => Array.from(doc.querySelectorAll('#chips li')), add: () => doc.getElementById('add'),
        ...(options.cap === undefined ? {} : { cap: options.cap }) },
      snapshot: 'synthetic UltiPro Skills' } as WidgetDecl : null),
  } as unknown as Adapter;
  const readings = new Map<BaseKey, WidgetReading>();
  const read = (): ScanResult => scan(root, adapter, { platform: 'ultipro', frameId: 0, widgetReadings: readings });
  const last = read();
  const field = last.fields[0]!;
  const env = { adapter, root, platform: 'ultipro', frameId: 0, dryRun: false, canaries: options.canaries ?? [],
    signal: new AbortController().signal, valid: () => true, stopped: () => false, runId: () => 'run',
    heldBy: () => null } as unknown as PassEnv;
  const planned: PlannedWrite = { key: field.key, value: { kind: 'text', text },
    origin: { provenance: 'profile', path: 'skills' },
    match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 0.97, flags: [], suggestions: [],
      reason: 'ok' } } as unknown as PlannedWrite;
  const row = { key: field.key, label: 'Skills', kind: 'text', category: 'skills.list', section: field.section.id,
    required: false, status: 'verified', provenance: 'profile', matcherStage: 'not-applicable', confidence: 0.97,
    reason: 'ok', wrote: false, verification: 'not-checked', needsUserAction: false } as FillResult;
  const widgets: WidgetWriteEnv = { readings, plan: async () => ({ results: [], writes: [] }) as never };
  const result = await writeField(env, last, field, planned, row, new WeakMap(), { widgets });
  const chipWords = Array.from(doc.querySelectorAll('#chips strong'), (chip) => chip.textContent);
  return { field, result, chipWords, typed: (fixture.view as unknown as { __typed: string[] }).__typed, read };
}

describe('a box of several answers, through the pass (writeField, jr6 ENGINE E3 item 13)', () => {
  it('scans as a text field, adds each value through its Add, and is verified by its chips now and after the settle',
    async () => {
      const { field, result, chipWords, typed, read } = await write(SKILLS);
      expect([field.kind, field.current]).toEqual(['text', { kind: 'empty' }]);
      expect(result.row).toMatchObject({ status: 'verified', reason: 'ok', wrote: true, verification: 'verified' });
      expect(typed).toEqual(['TypeScript', 'PostgreSQL', 'Kubernetes']);
      expect(chipWords).toEqual(['TypeScript', 'PostgreSQL', 'Kubernetes']);
      expect(result.written?.value).toEqual({ kind: 'text', text: SKILLS });
      // The read-back for the loop's hash: what the box holds, empty, as the scan reads it.
      expect(result.readBack).toEqual({ kind: 'empty' });
      expect(verifyWritten(read(), result.written!)).toMatchObject({ status: 'verified', verification: 'verified' });
    });

  it('adds only what the chips miss, and is already-correct where they show every value', async () => {
    const some = await write(SKILLS, { chipped: ['typescript'] });
    expect(some.typed).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(some.chipWords).toEqual(['typescript', 'PostgreSQL', 'Kubernetes']);
    expect(some.result.row).toMatchObject({ status: 'verified', wrote: true });
    removeFixtures(document);
    const all = await write(SKILLS, { chipped: ['Kubernetes', 'TypeScript', 'PostgreSQL'] });
    expect(all.typed).toEqual([]);
    expect(all.result.row).toMatchObject({ status: 'skipped', reason: 'already-correct', wrote: false });
    expect(all.result.written).toBeUndefined();
  });

  it('fills a box at its cap with what it takes, max-selections-reached, then and after the settle', async () => {
    const { result, chipWords, read } = await write(SKILLS, { cap: 2 });
    expect(chipWords).toEqual(['TypeScript', 'PostgreSQL']);
    expect(result.row).toMatchObject({ status: 'filled', reason: 'max-selections-reached', wrote: true,
      verification: 'mismatch', needsUserAction: true });
    expect(verifyWritten(read(), result.written!)).toMatchObject({ status: 'filled',
      reason: 'max-selections-reached' });
  });

  it('blocks a planned text that holds a canary before anything is typed', async () => {
    const { result, typed, chipWords } = await write(SKILLS, { canaries: ['PostgreSQL'] });
    expect(result.row).toMatchObject({ status: 'blocked', wrote: false });
    expect(typed).toEqual([]);
    expect(chipWords).toEqual([]);
  });
});
