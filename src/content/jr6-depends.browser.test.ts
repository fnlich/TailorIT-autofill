/*
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 14: ICIMS-02, O3, ICIMS-19's re-plan, ADP-2) in the content runtime: a synthetic
 * Country-then-State page, read by the generic adapter with one rule added, the platform packages' Adapter.dependsOn
 * (State is reset by Country's write), and filled with the real planner and the golden profile behind the fake worker.
 * The page draws State before Country, as a page whose fields nothing orders does, and answers a Country change as
 * iCIMS answers it (its State list reloaded, data-ddd-child-link and icimsdropdown-ajax: SP\jr6\audit\icims.md
 * ICIMS-02): State says it is busy (aria-busy) while the list loads, then shows the country's list and loses the answer
 * it held. So a run must:
 * - write Country before State, and wait for State's list before writing it (pass.ts parentsFirst, awaitDependents):
 *   State is written once, after the reload, and never lost to it;
 * - decide State again after Country's write where its first decision was made while the page did not let it be
 *   answered (disabled until a country is chosen, its list unchanged: no change of options tells the books), through
 *   the books' 'parent-written' (loop.ts reshapes, bookkeeping.ts dependsAgain);
 * - decide again a field the page drew anew after a write (Postal Code, disabled, then replaced by an enabled box of the
 *   same name once a country is chosen), through the books' 'reshaped'.
 * jr6 line W review (REVC-7): a second page whose Country is a lazy list (a select-only combobox whose rows are drawn
 * only once it opens, as Oracle's cx-select on a first visit: SP\jr6\oracle-p2\timeline.log), so the first pass cannot
 * write it, and whose new country empties Address Line 1: the street is held back until the Country is written, then
 * typed once, after it (loop.ts heldDependents), never typed before it and again.
 * Every value is the golden profile's (fixtures/profiles/alex-rivera.profile.json); the page is synthetic.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const HREF = 'https://careers.example.org/apply/jr6-depends';

/** The page: State (disabled until a country is chosen where `stateWaits`), Country, and Postal Code (disabled, then
 *  drawn anew enabled where `postalWaits`). A Country change marks State busy and, RELOAD_MS later, reloads its list for
 *  the country (the answer it held lost: window.__resets), enables it, and draws Postal Code anew. */
function page(options: { stateWaits: boolean; postalWaits: boolean }): string {
  return `<!doctype html><html><head><title>Apply</title></head><body>
<form id="app" action="about:blank">
  <p><label for="state">State</label>
    <select id="state" name="state"${options.stateWaits ? ' disabled' : ''}><option value="">Select a state</option>
      <option>Alabama</option><option>Texas</option></select></p>
  <p><label for="country">Country</label>
    <select id="country" name="country"><option value="">Select a country</option><option>Canada</option>
      <option>United States</option></select></p>
  ${options.postalWaits ? '<p id="postal-row"><label for="postal">Postal Code</label><input id="postal" name="postal" type="text" disabled></p>' : ''}
</form>
<script>
  window.__order = [];
  window.__resets = 0;
  const RELOAD_MS = 400;
  const LISTS = { 'Canada': ['Ontario', 'Quebec'], 'United States': ['Alabama', 'Texas'] };
  const state = document.getElementById('state');
  const country = document.getElementById('country');
  country.addEventListener('change', () => {
    window.__order.push('country:' + country.value);
    state.setAttribute('aria-busy', 'true');
    setTimeout(() => {
      if (state.value !== '') window.__resets += 1;
      state.replaceChildren(new Option('Select a state', ''), ...(LISTS[country.value] || []).map((name) => new Option(name)));
      state.disabled = false;
      state.removeAttribute('aria-busy');
      const postal = document.getElementById('postal');
      if (postal !== null) {
        const box = document.createElement('input');
        box.id = 'postal';
        box.name = 'postal';
        box.type = 'text';
        postal.replaceWith(box);
      }
    }, RELOAD_MS);
  });
  state.addEventListener('change', () => { window.__order.push('state:' + state.value); });
</script></body></html>`;
}

/** The generic adapter with the platform packages' rule: State is reset by Country's write (Adapter.dependsOn). */
function dependsAdapter(doc: Document): Adapter {
  return { ...genericAdapter, dependsOn: (control: Element) => (control.id === 'state' ? doc.getElementById('country')
    : null) };
}

/** jr6 line W review (REVC-7): Country a select-only combobox whose rows are drawn only while it is open (read lazily),
 *  then Address Line 1 and ZIP Code, which a chosen country empties (window.__resets: each box that lost what it held).
 *  window.__order: each country chosen, and each change of a box. */
function lazyPage(): string {
  return `<!doctype html><html><head><title>Apply</title></head><body>
<form id="app" action="about:blank">
  <div><span id="country-label">Country</span>
    <div id="country" role="combobox" tabindex="0" aria-labelledby="country-label" aria-haspopup="listbox"
      aria-expanded="false" aria-controls="country-list">Select a country</div>
    <ul id="country-list" role="listbox" aria-labelledby="country-label" hidden></ul></div>
  <p><label for="address">Address Line 1</label><input id="address" name="address" type="text"></p>
  <p><label for="zip">ZIP Code</label><input id="zip" name="zip" type="text"></p>
</form>
<script>
  window.__order = [];
  window.__resets = 0;
  const country = document.getElementById('country');
  const list = document.getElementById('country-list');
  const boxes = ['address', 'zip'].map((id) => document.getElementById(id));
  const show = (open) => {
    list.replaceChildren(...(open ? ['Canada', 'United States'] : []).map((name, at) => {
      const row = document.createElement('li');
      row.id = 'country-option-' + at;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(country.textContent === name));
      row.textContent = name;
      row.addEventListener('click', () => {
        country.textContent = name;
        window.__order.push('country:' + name);
        // A new country draws the address block again: its boxes are emptied.
        for (const box of boxes) {
          if (box.value !== '') window.__resets += 1;
          box.value = '';
        }
        show(false);
      });
      return row;
    }));
    list.hidden = !open;
    country.setAttribute('aria-expanded', String(open));
  };
  country.addEventListener('click', () => show(list.hidden));
  country.addEventListener('focusout', () => show(false));
  for (const box of boxes) box.addEventListener('change', () => { window.__order.push(box.id); });
</script></body></html>`;
}

/** The generic adapter with Oracle's chain of rules for the lazy page (ORACLE's dependsOn): Address Line 1 is reset by
 *  Country's write, ZIP Code by Address Line 1's. */
function lazyAdapter(doc: Document): Adapter {
  const parentOf: Record<string, string> = { address: 'country', zip: 'address' };
  return { ...genericAdapter, dependsOn: (control: Element) => (control.id in parentOf
    ? doc.getElementById(parentOf[control.id]!) : null) };
}

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A run on the page, to its end: the page's record of the writes and resets, and the run's rows by label. */
async function run(options: { stateWaits: boolean; postalWaits: boolean }, adapterOf = dependsAdapter) {
  return runOn(page(options), adapterOf);
}

/** A run on `html`, to its end (see run). */
async function runOn(html: string, adapterOf: (doc: Document) => Adapter) {
  const fixture = await loadFixture(document, html, { width: 1100, height: 900 });
  const doc = fixture.doc;
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => HREF, isTop: true,
    adapters: () => [adapterOf(doc)], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  await runtime.fill();
  await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 30_000 });
  const view = fixture.view as unknown as { __order: string[]; __resets: number };
  const rows = new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));
  return { doc, order: view.__order, resets: view.__resets, rows };
}

describe('jr6 ENGINE E3 item 14: a Country-then-State page whose State a Country write resets (dependsOn)', () => {
  it('writes Country first, waits for State\'s list, and writes State once, never lost to the reload', async () => {
    const { doc, order, resets, rows } = await run({ stateWaits: false, postalWaits: false });
    expect(order).toEqual(['country:United States', 'state:Texas']);
    expect(resets).toBe(0);
    expect((doc.getElementById('state') as HTMLSelectElement).value).toBe('Texas');
    expect(rows.get('State')).toMatchObject({ status: 'verified', wrote: true });
    expect(rows.get('Country')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);

  it('decides State again once Country is written, where the page let no answer in before', async () => {
    const { doc, order, rows } = await run({ stateWaits: true, postalWaits: false });
    expect(order).toEqual(['country:United States', 'state:Texas']);
    expect((doc.getElementById('state') as HTMLSelectElement).value).toBe('Texas');
    expect(rows.get('State')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);

  it('decides again a field the page drew anew after a write, as the run never wrote it', async () => {
    const { doc, rows } = await run({ stateWaits: false, postalWaits: true });
    const postal = doc.getElementById('postal') as HTMLInputElement;
    expect(postal.disabled).toBe(false);
    expect(postal.value).not.toBe('');
    expect(rows.get('Postal Code')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);

  // jr6 line W review (REVC-7).
  it('holds dependents back while their parent waits for its options, a chain too: each typed once, after it',
    async () => {
      const { doc, order, resets, rows } = await runOn(lazyPage(), lazyAdapter);
      expect(order).toEqual(['country:United States', 'address', 'zip']);
      expect(resets).toBe(0);
      expect(doc.getElementById('country')!.textContent).toBe('United States');
      for (const id of ['address', 'zip']) expect((doc.getElementById(id) as HTMLInputElement).value, id).not.toBe('');
      for (const label of ['Country', 'Address Line 1', 'ZIP Code']) {
        expect(rows.get(label), label).toMatchObject({ status: 'verified', wrote: true });
      }
    }, 40_000);

  it('the control: with no parent named, the boxes are typed before the lazy Country and again after it', async () => {
    const { order, resets, rows } = await runOn(lazyPage(), () => genericAdapter);
    expect(order).toEqual(['address', 'zip', 'country:United States', 'address', 'zip']);
    expect(resets).toBe(2);
    expect(rows.get('Address Line 1')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);
});
