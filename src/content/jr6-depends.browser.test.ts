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

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A run on the page, to its end: the page's record of the writes and resets, and the run's rows by label. */
async function run(options: { stateWaits: boolean; postalWaits: boolean }, adapterOf = dependsAdapter) {
  const fixture = await loadFixture(document, page(options), { width: 1100, height: 900 });
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
});
