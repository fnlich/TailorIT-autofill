/*
 * jr7 ENGINE-7 E2 (FIX7PLAN §6.2), the DOM half: UKGR-5 (E1 item 3, built in E2 once O-7 settled) and the doors' DOM
 * parts, on synthetic pages shaped as the jr7 audits describe each platform's markup, each hook declared by a test
 * adapter as its platform package declares it. Every value is synthetic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter, UploadPromptKind } from '../adapters/types';
import { openEditors } from './fillers/editor-opener';
import { answerUploadPrompt } from './fillers/upload-prompt';
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

// ── DFPC-7's PC7-04: Paycom's outlined boxes (a declared aria-hidden decoration) and its selects in listbox wrappers ──
describe("PC7-04: Paycom's MUI outlined text box and its select in a role=listbox wrapper", () => {
  /** MUI's outlined text box as Paycom draws it (snapshot7 paycomonline1 apply-2): a white page; the input, with no
   *  border or fill, in its input root; the border drawn by a <fieldset aria-hidden="true"> laid over that root, beside
   *  the input. `edge`: the fieldset's border colour. `holds`: the fieldset also holds a control. `hiddenInput`: the
   *  input itself aria-hidden. `clipped`: the input clipped to nothing (a honeypot's way). Then a select alone in a
   *  role=listbox wrapper with no option, and a real listbox whose option rows hold checkboxes. */
  const page = (o: { edge?: string; holds?: boolean; hiddenInput?: boolean; clipped?: boolean } = {}) => `<!doctype html>
  <html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    .root { position: relative; display: inline-flex; width: 300px; margin: 8px; background: #fff; border-radius: 4px; }
    .root input { display: block; width: 100%; border: 0; outline: none; background: transparent; padding: 8px 14px;
      box-sizing: border-box; color: #222; font: inherit;
      ${o.clipped === true ? 'position: absolute; clip-path: inset(50%); width: 1px; height: 1px; overflow: hidden;' : ''} }
    .outline { position: absolute; inset: -5px 0 0; margin: 0; padding: 0 8px; border: 1px solid ${o.edge ?? 'rgba(0, 0, 0, 0.23)'};
      border-radius: 4px; pointer-events: none; min-width: 0; }
    .outline legend { visibility: hidden; max-width: 0.01px; height: 11px; padding: 0; font-size: 0.75em; }
  </style></head><body><form id="f">
    <label for="first">First name</label>
    <div class="root"><input id="first" type="text" ${o.hiddenInput === true ? 'aria-hidden="true"' : ''}>
      <fieldset aria-hidden="true" class="outline" id="outline"><legend><span>First name</span></legend>
        ${o.holds === true ? '<input id="inner" type="checkbox">' : ''}</fieldset></div>
    <label for="state">State</label>
    <div role="listbox" aria-label="State"><select id="state"><option value="">Select</option><option>Texas</option></select></div>
    <div role="listbox" aria-label="Skills"><div role="option" aria-selected="false"><label><input id="skill-1" type="checkbox"> Go</label></div>
      <div role="option" aria-selected="false"><label><input id="skill-2" type="checkbox"> Rust</label></div></div>
  </form></body></html>`;
  const paycom = (declared = true): Adapter => ({ ...genericAdapter, id: 'generic',
    ...(declared ? { controlBox: (control: Element) => control.parentElement?.querySelector(':scope > fieldset') ?? null }
      : {}) });
  const read = async (html: string, adapter: Adapter) => {
    const { doc } = await loadFixture(document, html);
    const fields = scan(doc.getElementById('f')!, adapter, { platform: 'paycom' }).fields;
    removeFixtures(document);
    const first = fields.find((each) => each.idAttr === 'first');
    return { first: first === undefined ? 'no field' : first.visibility !== 'visible' ? 'not visible' : first.camouflaged,
      ids: fields.map((field) => field.idAttr) };
  };

  it('the declared fieldset draws the box: not camouflaged; undeclared, it is', async () => {
    expect((await read(page(), paycom())).first).toBe(false);
    expect((await read(page(), paycom(false))).first).toBe(true);
  });

  it('negatives: a white-on-white edge, a decoration holding a control, an aria-hidden or clipped input', async () => {
    expect((await read(page({ edge: '#fff' }), paycom())).first).toBe(true);
    expect((await read(page({ holds: true }), paycom())).first).toBe(true);
    expect((await read(page({ hiddenInput: true }), paycom())).first).not.toBe(false);
    expect((await read(page({ clipped: true }), paycom())).first).not.toBe(false);
  });

  it('a select alone in a role=listbox wrapper with no option is a field; a real listbox\'s option rows stay parts',
    async () => {
      const { ids } = await read(page(), paycom());
      expect(ids).toContain('state');
      expect(ids.filter((id) => id.startsWith('skill-'))).toEqual([]);
    });
});

// ── item 4 (UKGR-10, EFA-6): the upload-prompt door ────────────────────────────────────────────────────────────────
describe('item 4 (UKGR-10, EFA-6): the upload-prompt door', () => {
  /** A form with a file input and Submit; 150 ms after it loads (standing for the run's file write), the site draws
   *  its prompt: UKG Ready's "Upload Complete" (Populate, Cancel) or Eightfold's Data Privacy Agreement (I Agree,
   *  Cancel). Each button counts its presses. */
  const page = (kind: 'complete' | 'privacy') => `<!doctype html><html><body><form id="f">
    <input type="file" id="resume"><button type="submit" id="submit">Submit application</button></form>
    <script>
      window.presses = {};
      setTimeout(() => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const labels = ${JSON.stringify({ complete: ['Populate', 'Cancel'], privacy: ['I Agree', 'Cancel'] })}['${kind}'];
        for (const words of labels) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = words;
          button.id = words.replace(/\\s/g, '-').toLowerCase();
          button.addEventListener('click', () => { window.presses[button.id] = (window.presses[button.id] || 0) + 1; });
          dialog.append(button);
        }
        document.body.append(dialog);
      }, 150);
    </script></body></html>`;
  /** The adapter's prompt: the dialog's `pick` button, as `kind`. */
  const prompting = (pick: string, kind: UploadPromptKind): Adapter => ({ ...genericAdapter, id: 'generic',
    detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    uploadPrompt: (doc) => {
      const press = doc.getElementById(pick);
      return press === null ? null : { press, kind };
    } });
  const presses = (doc: Document) => (doc.defaultView as unknown as { presses: Record<string, number> }).presses;
  const answer = async (kind: 'complete' | 'privacy', adapter: Adapter, consents = false, capMs = 2_000) => {
    const { doc } = await loadFixture(document, page(kind));
    const outcome = await answerUploadPrompt(adapter, doc, { consents, capMs });
    const pressed = { ...presses(doc) };
    removeFixtures(document);
    return { outcome, pressed };
  };

  it("presses a dismissal's control once it shows, and never Populate", async () => {
    expect(await answer('complete', prompting('cancel', 'dismiss'))).toEqual({ outcome: 'pressed', pressed: { cancel: 1 } });
    expect(await answer('complete', prompting('populate', 'dismiss'))).toEqual({ outcome: 'refused', pressed: {} });
  });

  it('presses a consent only where the Consents mode ticks it, and never its refusal', async () => {
    expect(await answer('privacy', prompting('i-agree', 'consent'), false)).toEqual({ outcome: 'left', pressed: {} });
    expect(await answer('privacy', prompting('i-agree', 'consent'), true))
      .toEqual({ outcome: 'pressed', pressed: { 'i-agree': 1 } });
    expect(await answer('privacy', prompting('cancel', 'consent'), true)).toEqual({ outcome: 'refused', pressed: {} });
  });

  // The coordinator's note from JDEF-7 (EFA-6): Eightfold's dialog opens animated, its hook answering nothing until its
  // I Agree shows whole; its Cancel is in neverPress.
  it('waits, bounded, for a dialog that opens animated, then presses only its declared I Agree', async () => {
    const animated = `<!doctype html><html><body><form id="f">
      <input type="file" id="resume"><button type="submit" id="submit">Submit application</button></form>
      <script>
        window.presses = {};
        setTimeout(() => {
          const dialog = document.createElement('div');
          dialog.id = 'privacy';
          dialog.setAttribute('role', 'dialog');
          dialog.style.cssText = 'opacity:0;transition:opacity 600ms linear';
          for (const words of ['I Agree', 'Cancel']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = words;
            button.id = words.replace(/\\s/g, '-').toLowerCase();
            button.addEventListener('click', () => { window.presses[button.id] = (window.presses[button.id] || 0) + 1; });
            dialog.append(button);
          }
          document.body.append(dialog);
          requestAnimationFrame(() => requestAnimationFrame(() => { dialog.style.opacity = '1'; }));
        }, 150);
      </script></body></html>`;
    const eightfold: Adapter = { ...genericAdapter, id: 'generic',
      detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
      submitButton: (root) => root.ownerDocument.getElementById('submit'),
      neverPress: (root) => [root.ownerDocument.getElementById('cancel')].filter((el): el is HTMLElement => el !== null),
      uploadPrompt: (doc) => {
        const dialog = doc.getElementById('privacy');
        const shown = dialog !== null && doc.defaultView!.getComputedStyle(dialog).opacity === '1';
        return shown ? { press: doc.getElementById('i-agree')!, kind: 'consent' } : null;
      } };
    for (const consents of [true, false]) {
      const { doc } = await loadFixture(document, animated);
      const outcome = await answerUploadPrompt(eightfold, doc, { consents, capMs: 4_000 });
      expect(outcome, String(consents)).toBe(consents ? 'pressed' : 'left');
      expect(presses(doc), String(consents)).toEqual(consents ? { 'i-agree': 1 } : {});
      removeFixtures(document);
    }
  });

  // The coordinator's decision of 2026-11-12 (UKGREADY-7 open 3): the declared prompt button only, never a never-pressed
  // control, even where the hook names one.
  it('never presses a prompt control the adapter also names never-pressed', async () => {
    const guarded = (pick: string, kind: UploadPromptKind): Adapter => ({ ...prompting(pick, kind),
      neverPress: (root) => [root.ownerDocument.getElementById(pick)].filter((el): el is HTMLElement => el !== null) });
    expect(await answer('complete', guarded('cancel', 'dismiss'))).toEqual({ outcome: 'refused', pressed: {} });
    expect(await answer('privacy', guarded('i-agree', 'consent'), true)).toEqual({ outcome: 'refused', pressed: {} });
  });

  it("never presses the application's Submit, and answers none where no prompt shows", async () => {
    expect(await answer('complete', prompting('submit', 'dismiss'))).toEqual({ outcome: 'refused', pressed: {} });
    expect(await answer('complete', prompting('nowhere', 'dismiss'), false, 300)).toEqual({ outcome: 'none', pressed: {} });
  });
});

// ── item 5 (UKGR-9): the editor-opener door ────────────────────────────────────────────────────────────────────────
describe('item 5 (UKGR-9): the editor-opener door', () => {
  /** UKG Ready's Contact summary (snapshot7 secure7.saashr): "Missing Information" and its Edit, which draws the
   *  editor; beside it a Delete, and the step's Submit. Each button counts its presses. */
  const PAGE = `<!doctype html><html><body><form id="f">
    <section id="contact"><h3>Contact</h3><p>Missing Information</p>
      <button type="button" id="edit">Edit</button><button type="button" id="delete">Delete</button>
      <button type="button" id="hidden-edit" style="display:none">Edit</button></section>
    <button type="submit" id="submit">Sign &amp; submit application</button></form>
    <script>
      window.presses = {};
      for (const button of document.querySelectorAll('button')) {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          window.presses[button.id] = (window.presses[button.id] || 0) + 1;
        });
      }
    </script></body></html>`;
  const opening = (ids: string[]): Adapter => ({ ...genericAdapter, id: 'generic',
    detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    editorOpener: (root) => ids.map((id) => root.ownerDocument.getElementById(id)!) });

  it('presses each declared opener once per document, and never a Delete, a hidden one or Submit', async () => {
    const { doc } = await loadFixture(document, PAGE);
    const root = doc.getElementById('f')!;
    const adapter = opening(['edit', 'delete', 'hidden-edit', 'submit']);
    expect(openEditors(adapter, doc, root)).toBe(1);
    expect(openEditors(adapter, doc, root)).toBe(0);
    expect((doc.defaultView as unknown as { presses: Record<string, number> }).presses).toEqual({ edit: 1 });
  });

  // The coordinator's decision of 2026-11-12 (UKGREADY-7 open 3): no exemption from neverPress, unlike the reveal door.
  it('never presses an opener the adapter also names never-pressed (an existing entry\'s Edit), nor one inside one',
    async () => {
      const { doc } = await loadFixture(document, PAGE);
      const root = doc.getElementById('f')!;
      const guarded = (never: string): Adapter => ({ ...opening(['edit']),
        neverPress: (scope) => [scope.ownerDocument.getElementById(never)!] });
      expect(openEditors(guarded('edit'), doc, root)).toBe(0);
      expect(openEditors(guarded('contact'), doc, root)).toBe(0);
      expect((doc.defaultView as unknown as { presses: Record<string, number> }).presses).toEqual({});
    });
});
