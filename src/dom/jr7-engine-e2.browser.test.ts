/*
 * jr7 ENGINE-7 E2 (FIX7PLAN §6.2), the DOM half: UKGR-5 (E1 item 3, built in E2 once O-7 settled) and the doors' DOM
 * parts, on synthetic pages shaped as the jr7 audits describe each platform's markup, each hook declared by a test
 * adapter as its platform package declares it. Every value is synthetic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { scan } from './scan';

afterEach(() => removeFixtures(document));

// ── UKGR-5: the declared box's edge drawn by its pseudo-element ────────────────────────────────────────────────────
describe("UKGR-5: a declared box whose edge is its ::before's inset ring", () => {
  /** UKG Ready's text box as its audit measured it (snapshot7 secure7.saashr): a page of rgb(251,251,251); the input,
   *  with no border or fill, inside a white span.c-form-control__field whose ::before (inset 0) draws a 0.5 px inset
   *  ring of rgba(0,0,0,.47). `ring` stands the pseudo-element's shadow in. */
  const page = (ring: string, content = "''") => `<!doctype html><html><head><style>
    body { margin: 0; background: rgb(251, 251, 251); color: #222; font: 16px/1.5 system-ui; }
    .c-form-control__field { position: relative; display: block; width: 300px; height: 36px; background: #fff; }
    .c-form-control__field::before { content: ${content}; position: absolute; inset: 0; box-shadow: ${ring};
      pointer-events: none; }
    input { display: block; width: 100%; height: 36px; border: 0; background: transparent; outline: none; padding: 0 6px;
      box-sizing: border-box; color: #222; }
  </style></head><body><form id="f"><label for="first">First name</label>
    <span class="c-form-control__field" id="box"><input id="first" type="text"></span></form></body></html>`;
  const ukg = (declared = true): Adapter => ({ ...genericAdapter, id: 'generic',
    ...(declared ? { controlBox: (control: Element) => control.ownerDocument.getElementById('box') } : {}) });
  const camouflaged = async (html: string, adapter: Adapter) => {
    const { doc } = await loadFixture(document, html);
    const field = scan(doc.getElementById('f')!, adapter, { platform: 'ukgready' }).fields
      .find((each) => each.label === 'First name');
    removeFixtures(document);
    return field?.camouflaged ?? 'no field';
  };
  const RING = 'rgba(0, 0, 0, 0.47) 0 0 0 0.5px inset';

  it('draws the box: the field is not camouflaged; without the box declared, or with no edge drawn, it is', async () => {
    expect(await camouflaged(page(RING), ukg())).toBe(false);
    expect(await camouflaged(page(RING), ukg(false))).toBe(true);
    // A pseudo-box that draws no edge: none, an outer shadow of the same reach, a ring in the fill's own colour, or
    // one that is not generated.
    expect(await camouflaged(page('none'), ukg())).toBe(true);
    expect(await camouflaged(page('rgba(0, 0, 0, 0.47) 0 0 0 0.5px'), ukg())).toBe(true);
    expect(await camouflaged(page('rgb(255, 255, 255) 0 0 0 0.5px inset'), ukg())).toBe(true);
    expect(await camouflaged(page(RING, 'none'), ukg())).toBe(true);
  });
});
