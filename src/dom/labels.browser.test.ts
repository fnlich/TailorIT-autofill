import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { cleanLabel, descriptionOf, fieldContainer, labelOfControl, labelOfGroup, optionLabelOf } from './labels';
import { newScanCache } from './scan-cache';

const ctx = (adapter: Adapter | null = null) => ({ cache: newScanCache(), adapter });

describe('cleanLabel', () => {
  it.each([
    ['First name *', 'First name', true],
    ['First name*:', 'First name', true],
    ['Email (required)', 'Email', true],
    ['Phone (optional)', 'Phone', false],
    ['  Website   URL  ', 'Website URL', false],
    ['Name * (required)', 'Name', true],
    // Lever's heavy asterisk, with and without a space, and the look-alikes other forms draw.
    ['Resume/CV \u{2731}', 'Resume/CV', true],
    ['Full name\u{2731}', 'Full name', true],
    ['Email \u{2217}', 'Email', true],
    ['Phone \u{FF0A}', 'Phone', true],
    ['Rating \u{2605}', 'Rating \u{2605}', false],
  ])('%j reads %j', (raw, text, required) => {
    expect(cleanLabel(raw)).toEqual({ text, required });
  });

  it("reads Lever's required mark from its markup, the only sign its Resume/CV is required", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><ul><li class="application-question resume">
      <label><div class="application-label">Resume/CV <span class="required">\u{2731}</span></div>
      <div class="application-field"><input type="file" id="resume" name="resume"></div></label></li></ul></body>`);
    expect(labelOfControl(fixture.doc.getElementById('resume')!, ctx())).toMatchObject({ source: 'wrapping-label',
      text: 'Resume/CV', required: true });
  });

  it("leaves an adapter-declared upload widget's text out of the label that wraps it (Lever's resume)", async () => {
    // fixtures/lever/*.html: the resume input sits at opacity 0 inside the visible ATTACH RESUME/CV link, all inside the
    // question's wrapping <label>.
    const fixture = await loadFixture(document, `<!doctype html><body><form id="application-form"><ul>
      <li class="application-question resume"><label>
        <div class="application-label">Resume/CV <span class="required">\u{2731}</span></div>
        <div class="application-field"><a href="#top" class="visible-resume-upload" style="position:relative;display:inline-block;padding:8px">
          <span class="default-label">ATTACH RESUME/CV</span>
          <input class="invisible-resume-upload" id="resume-upload-input" name="resume" tabindex="-1" type="file"
            style="opacity:0;position:absolute;left:0;top:0;width:100%;height:100%"></a></div></label></li></ul></form></body>`);
    const input = fixture.doc.getElementById('resume-upload-input')!;
    const lever = { uploadWidgets: (root: Element) => Array.from(root.querySelectorAll('a.visible-resume-upload'))
      .map((control) => ({ control, input: control.querySelector('input[type="file"]')! })) } as unknown as Adapter;
    expect(labelOfControl(input, ctx())).toMatchObject({ text: 'Resume/CV \u{2731} ATTACH RESUME/CV', required: false });
    expect(labelOfControl(input, ctx(lever))).toMatchObject({ source: 'wrapping-label', text: 'Resume/CV', required: true });
  });
});

describe('labelOfControl', () => {
  afterEach(() => removeFixtures(document));

  it('reads each source in order, a visible one always before aria-label', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <label for="a">Label for</label><label for="a">and a second</label><input id="a" aria-label="Aria words">
      <span id="named">Labelled by</span><input id="b" aria-labelledby="named">
      <label>Wrapping <input id="c" aria-label="Aria words"> label</label>
      <fieldset><legend>Legend words</legend><input id="d"></fieldset>
      <input id="e" placeholder="Placeholder words">
      <input id="f" aria-label="Only aria">
      <div><span>Shown beside</span><input id="g" aria-label="Shown beside"></div>
      <input id="h">
      <span id="hidden-name" style="display:none">Hidden name</span><input id="i" aria-labelledby="hidden-name">
      <label for="j" style="color:#fff">Camouflaged</label><input id="j" placeholder="Fallback">
      <label for="k">First name<!-- a comment --></label><input id="k">
    </body>`);
    const read = (id: string) => {
      const label = labelOfControl(fixture.doc.getElementById(id)!, ctx());
      return [label.source, label.text, label.visible];
    };
    expect(read('a')).toEqual(['for', 'Label for and a second', true]);
    expect(read('b')).toEqual(['aria-labelledby', 'Labelled by', true]);
    expect(read('c')).toEqual(['wrapping-label', 'Wrapping label', true]);
    expect(read('d')).toEqual(['legend', 'Legend words', true]);
    expect(read('e')).toEqual(['placeholder', 'Placeholder words', true]);
    expect(read('f')).toEqual(['aria-label', 'Only aria', false]);
    expect(read('g')).toEqual(['aria-label', 'Shown beside', true]);
    expect(read('h')).toEqual(['none', '', false]);
    expect(read('i')).toEqual(['none', '', false]);
    expect(read('j')).toEqual(['placeholder', 'Fallback', true]);
    expect(read('k')).toEqual(['for', 'First name', true]);
  });

  it('takes a legend only when the control is its fieldset\'s only field', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <fieldset><legend>Contact</legend><input id="one"><input id="two"></fieldset></body>`);
    expect(labelOfControl(fixture.doc.getElementById('one')!, ctx()).source).toBe('none');
  });

  it("uses the adapter's label, written from a snapshot, before a placeholder", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <div class="question">Adapter words</div><input id="x" placeholder="Placeholder"></body>`);
    const adapter = { labelFor: (el: Element) => (el.id === 'x' ? el.ownerDocument.querySelector('.question') : null) };
    const label = labelOfControl(fixture.doc.getElementById('x')!, ctx(adapter as unknown as Adapter));
    expect([label.source, label.text]).toEqual(['adapter', 'Adapter words']);
  });

  it('reads a trailing required mark as required', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><label for="x">Email <span>*</span></label><input id="x"></body>');
    expect(labelOfControl(fixture.doc.getElementById('x')!, ctx())).toMatchObject({ text: 'Email', required: true });
  });

  it('takes no label whose first line is drawn white on white (S4)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><head><style>
      #hp-label::first-line { color: #fff; }</style></head><body style="background:#fff;color:#111"><form>
      <label for="last">Last name</label><input id="last" style="border:1px solid #333">
      <label id="hp-label" for="hp" style="display:block">Email</label><input id="hp" style="border:1px solid #333"></form></body>`);
    expect(labelOfControl(fixture.doc.getElementById('hp')!, ctx())).toMatchObject({ source: 'none', visible: false });
    expect(labelOfControl(fixture.doc.getElementById('last')!, ctx())).toMatchObject({ source: 'for', text: 'Last name' });
  });

  it('counts an aria-label as visible only when its words stand whole, in order, beside the control (DOM-11)', async () => {
    // A one-letter aria-label "e" read as visible because "e" occurs in "Please leave this box empty.".
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div><p>Please leave this box empty.</p><input id="one-letter" type="email" aria-label="e"></div>
      <div><p>Your email address</p><input id="whole" aria-label="Email"></div>
      <div><p>Email</p><input id="part" aria-label="mail"></div>
      <div><span>Phone number (mobile)</span><input id="sequence" aria-label="Phone number"></div>
      <div><span>Number of phones</span><input id="out-of-order" aria-label="Phone number"></div>
      <div><span>Zip</span><input id="short" aria-label="ZIP"></div>
    </form></body>`);
    const visible = (id: string) => labelOfControl(fixture.doc.getElementById(id)!, ctx()).visible;
    for (const id of ['one-letter', 'part', 'out-of-order']) expect([id, visible(id)]).toEqual([id, false]);
    for (const id of ['whole', 'sequence', 'short']) expect([id, visible(id)]).toEqual([id, true]);
  });

  it('names a field by its aria-label when a placeholder is the only visible source, the placeholder its gate (DOM-10)',
    async () => {
      // "e.g. Jane" is an example, not a name: the aria-label names the field, and never reaches an LLM.
      const fixture = await loadFixture(document, `<!doctype html><head><style>
        #unseen::placeholder { color: transparent; }</style></head><body style="background:#fff"><form>
        <div><input id="example" aria-label="First name" placeholder="e.g. Jane"></div>
        <div><input id="unseen" aria-label="Last name" placeholder="Smith"></div>
        <div><input id="only-placeholder" placeholder="City"></div>
      </form></body>`);
      const read = (id: string, held?: WeakMap<Element, string>) => {
        const label = labelOfControl(fixture.doc.getElementById(id)!, { ...ctx(), ...(held ? { heldPlaceholders: held } : {}) });
        return [label.source, label.text, label.visible];
      };
      expect(read('example')).toEqual(['aria-label', 'First name', true]);
      expect(read('unseen')).toEqual(['aria-label', 'Last name', false]);
      expect(read('only-placeholder')).toEqual(['placeholder', 'City', true]);
      // Our write hides the placeholder that was the gate: held at the text seen, it still is.
      const example = fixture.doc.getElementById('example') as HTMLInputElement;
      const held = new WeakMap<Element, string>([[example, 'e.g. Jane']]);
      example.value = 'Alex';
      expect(read('example', held)).toEqual(['aria-label', 'First name', true]);
      expect(read('example')).toEqual(['aria-label', 'First name', false]);
      example.setAttribute('placeholder', 'e.g. Smith');
      expect(read('example', held)).toEqual(['aria-label', 'First name', false]);
    });
});

describe('group labels', () => {
  afterEach(() => removeFixtures(document));

  it("takes a group's question from its container and each option from its member's own label", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <fieldset id="set"><legend>Do you need sponsorship?</legend>
        <label><input type="radio" name="s" id="yes"> Yes</label>
        <input type="radio" name="s" id="no"><label for="no">No</label>
        <input type="radio" name="s" id="blank"></fieldset>
      <div role="radiogroup" id="group" aria-labelledby="q"><span id="q">Pick one</span>
        <label><input type="radio" name="t"> A</label></div></body>`);
    const members = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('#set input'));
    expect(labelOfGroup(members, fixture.doc.getElementById('set'), ctx())).toMatchObject({ source: 'legend',
      text: 'Do you need sponsorship?' });
    const radiogroup = fixture.doc.getElementById('group')!;
    expect(labelOfGroup(Array.from(radiogroup.querySelectorAll('input')), radiogroup, ctx()))
      .toMatchObject({ source: 'aria-labelledby', text: 'Pick one' });
    expect(optionLabelOf(fixture.doc.getElementById('yes') as HTMLInputElement, ctx()).text).toBe('Yes');
    expect(optionLabelOf(fixture.doc.getElementById('no') as HTMLInputElement, ctx()).text).toBe('No');
    expect(optionLabelOf(fixture.doc.getElementById('blank') as HTMLInputElement, ctx()).text).toBe('');
  });
});

describe('descriptions and field containers', () => {
  afterEach(() => removeFixtures(document));

  it('reads visible aria-describedby help text only', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body>
      <input id="x" aria-describedby="hint secret"><p id="hint">Use your legal name.</p>
      <p id="secret" style="display:none">Hidden hint</p></body>`);
    expect(descriptionOf(fixture.doc.getElementById('x')!, ctx())).toBe('Use your legal name.');
  });

  it('finds the outermost ancestor that holds no other field', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div id="outer"><div id="inner"><input id="x"></div><button type="button">Attach</button></div>
      <input id="y"></form></body>`);
    expect(fieldContainer(fixture.doc.getElementById('x')!)?.id).toBe('outer');
  });
});
