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
