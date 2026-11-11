/*
 * jr6 RULES item 44 (FIXPLAN §6.3, ICIMS-15), applied at the forms merge (BUILD.md 4b: content/loop.ts `queue()` wraps
 * its order in core/plan/order.ts signatureLast): a signature asked as a box is ticked last in the pass, after the
 * form's other answers, as Jobright's fillSignatureCheckboxes ticks iCIMS's IForm signature once the rest is filled
 * (cited by RULES in order.ts). The page is synthetic and draws its Signature box first, so the page's order alone would
 * tick it before anything else is written; the run fills it with the real planner and the golden profile behind the fake
 * worker, under the default settings (Consents: All, so the box is ticked on the signature's terms).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, goldenProfile, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const HREF = 'https://careers.example.org/apply/jr6-signature-last';

/** The page: a Signature box drawn before the name and email boxes; each control's first change is recorded in
 *  window.__order, in the order the page saw it. */
const PAGE = `<!doctype html><html><head><title>Apply</title></head><body>
<form id="app" action="about:blank">
  <p><label><input type="checkbox" id="signature" name="signature"> Signature</label></p>
  <p><label for="first">First Name</label><input id="first" name="first" type="text" autocomplete="given-name"></p>
  <p><label for="last">Last Name</label><input id="last" name="last" type="text" autocomplete="family-name"></p>
  <p><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email"></p>
</form>
<script>
  window.__order = [];
  document.addEventListener('change', (event) => {
    const name = event.target && event.target.name;
    if (name && !window.__order.includes(name)) window.__order.push(name);
  }, true);
</script></body></html>`;

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('jr6 RULES item 44 (ICIMS-15): a signature box is ticked last in the pass (loop.ts signatureLast)', () => {
  it('writes the name and email first, then ticks the Signature box the page draws above them', async () => {
    const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
    const doc = fixture.doc;
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, doc, { href: () => HREF, isTop: true,
      adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 30_000 });
    const order = (fixture.view as unknown as { __order: string[] }).__order;
    const rows = new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));

    // Every answer the page asks is written, the Signature box last though the page draws it first.
    expect(order).toEqual(['first', 'last', 'email', 'signature']);
    expect((doc.getElementById('signature') as HTMLInputElement).checked).toBe(true);
    expect((doc.getElementById('first') as HTMLInputElement).value).toBe(goldenProfile().identity.firstName);
    expect(rows.get('Signature')).toMatchObject({ category: 'consent.signature', provenance: 'rule', status: 'verified',
      wrote: true, verification: 'verified', needsUserAction: false });
  }, 40_000);
});
