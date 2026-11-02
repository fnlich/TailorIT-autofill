import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { FIELD_KINDS } from '../core/enums';
import { FieldSpecSchema } from '../messaging/schemas';
import { fill } from './fillers';
import { loadFixture, logEvents, removeFixtures } from './fixture.testkit';
import { registerOwnUiHost } from './own-ui';
import { countVisibleControls, findField, scan, toFieldSpec } from './scan';
import type { ScannedField } from './types';

const OPTIONS = { platform: 'lever' as const };

function byId(fields: readonly ScannedField[], id: string): ScannedField | undefined {
  return fields.find((field) => field.idAttr === id);
}

describe('scan: kinds', () => {
  afterEach(() => removeFixtures(document));

  it('turns native controls into fields of their kind, and never password, hidden or button inputs', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="t">Name</label><input id="t">
      <label for="e">Email</label><input id="e" type="email">
      <label for="n">Years</label><input id="n" type="number" step="1" min="0" max="50">
      <label for="ta">Cover note</label><textarea id="ta" maxlength="500"></textarea>
      <label for="s">Country</label><select id="s"><option>Spain</option><option>Peru</option></select>
      <label for="m">Skills</label><select id="m" multiple><option>Go</option><option>Rust</option></select>
      <fieldset><legend>Authorized?</legend><label><input type="radio" name="auth" value="y"> Yes</label>
        <label><input type="radio" name="auth" value="n"> No</label></fieldset>
      <label><input type="checkbox" id="c" name="consent"> I agree to the terms</label>
      <fieldset><legend>Tools</legend><label><input type="checkbox" name="tools" value="a"> A</label>
        <label><input type="checkbox" name="tools" value="b"> B</label></fieldset>
      <label for="d">Start date</label><input id="d" type="date">
      <label for="mo">Graduation</label><input id="mo" type="month">
      <label for="f">Resume</label><input id="f" type="file" accept=".pdf, .DOCX">
      <label for="p">Password</label><input id="p" type="password">
      <input type="hidden" name="csrf" value="token"><input type="submit" value="Go"><input type="button" value="B">
      <input type="range" aria-label="Level"><input type="color" aria-label="Colour">
    </form></body>`);
    const result = scan(fixture.doc.querySelector('form')!, null, OPTIONS);
    expect(result.fields.map((field) => [field.label, field.kind])).toEqual([
      ['Name', 'text'], ['Email', 'text'], ['Years', 'text'], ['Cover note', 'textarea'], ['Country', 'select'],
      ['Skills', 'multiselect'], ['Authorized?', 'radio'], ['I agree to the terms', 'checkbox'],
      ['Tools', 'checkbox-group'], ['Start date', 'date'], ['Graduation', 'date'], ['Resume', 'file'],
    ]);
    expect(result.fields.every((field) => (FIELD_KINDS as readonly string[]).includes(field.kind))).toBe(true);
    expect(result.authFields).toBe(1);
    expect(byId(result.fields, 'e')?.constraints).toEqual({ format: 'email' });
    expect(byId(result.fields, 'n')?.constraints).toEqual({ format: 'integer', min: 0, max: 50 });
    expect(byId(result.fields, 'ta')?.constraints).toEqual({ maxLength: 500 });
    expect(byId(result.fields, 'mo')?.constraints).toEqual({ format: 'month-year' });
    expect(byId(result.fields, 'f')?.constraints).toEqual({ accept: ['.pdf', '.docx'] });
  });

  it('reports a combobox input (react-select) as a lazy combobox, never as text, and never fills it before Phase 4',
    async () => {
      // Greenhouse's markup, from its snapshots: a borderless input inside the widget's own box.
      const fixture = await loadFixture(document, `<!doctype html><body><form>
        <label id="country-label" for="country">Country</label>
        <div class="select__control" style="border:1px solid #888;width:300px"><div class="select__value-container">
          <div class="select__placeholder" id="react-select-country-placeholder">Select...</div>
          <input class="select__input" style="color:inherit;background:0;opacity:1;width:100%;border:0;margin:0;outline:0;padding:0"
            autocomplete="off" id="country" type="text" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true"
            aria-labelledby="country-label" aria-required="true" role="combobox"></div></div></form></body>`);
      const root = fixture.doc.querySelector('form')!;
      const result = scan(root, null, OPTIONS);
      const [field] = result.fields;
      expect(field).toMatchObject({ kind: 'combobox', label: 'Country', options: 'lazy', optionSetHash: 'lazy',
        required: true, camouflaged: false, current: { kind: 'empty' } });
      expect(field!.key).toBe('lever|main|country|lazy|0');
      const log = logEvents(fixture.doc);
      expect(fill(result.target(field!.key)!, { kind: 'text', text: 'United States' }, { adapter: null, root }))
        .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
      expect(log.events).toEqual([]);
    });

  it('reports a control the adapter declares a widget for as that widget, lazy and never grouped, and never fills it',
    async () => {
      // fixtures/lever/*.html: Lever's location search is a text input the adapter declares a remote typeahead.
      const fixture = await loadFixture(document, `<!doctype html><body><form>
        <label>Current location <input class="location-input" id="location-input" type="text" name="location"></label>
        <fieldset><legend>Perks</legend><label><input type="checkbox" name="perks" id="switch-a"> Remote</label>
          <label><input type="checkbox" name="perks" id="switch-b"> Equity</label></fieldset></form></body>`);
      const root = fixture.doc.querySelector('form')!;
      const adapter = {
        widgetFor: (control: Element) => (control.id === 'location-input'
          ? { kind: 'typeahead-remote', opener: control, snapshot: 'fixtures/lever/spotify-ny.html' }
          : control.id === 'switch-a' ? { kind: 'checkbox', opener: control, snapshot: 'a snapshot' } : null),
      } as unknown as Adapter;
      expect(scan(root, null, OPTIONS).fields.map((field) => [field.idAttr || field.nameAttr, field.kind]))
        .toEqual([['location-input', 'text'], ['perks', 'checkbox-group']]);
      const result = scan(root, adapter, OPTIONS);
      expect(result.fields.map((field) => [field.idAttr || field.nameAttr, field.kind, field.options]))
        .toEqual([['location-input', 'typeahead-remote', 'lazy'], ['switch-a', 'checkbox', 'lazy'],
          ['switch-b', 'checkbox', []]]);
      expect(result.fields[0]).toMatchObject({ label: 'Current location', optionSetHash: 'lazy', camouflaged: false });
      const log = logEvents(fixture.doc);
      expect(fill(result.target(result.fields[0]!.key)!, { kind: 'text', text: 'Austin, TX' }, { adapter, root }))
        .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
      expect(fill(result.target(result.fields[1]!.key)!, { kind: 'check' }, { adapter, root }))
        .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
      expect(log.events).toEqual([]);
    });

  it('reads a display pattern from a visible placeholder mask', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="g">Graduation date</label><input id="g" placeholder="MM/YYYY">
      <label for="ph">Phone</label><input id="ph" placeholder="(###) ###-####">
      <label for="x">City</label><input id="x" placeholder="e.g. Austin"></form></body>`);
    const fields = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(byId(fields, 'g')?.constraints).toEqual({ pattern: 'MM/YYYY', format: 'month-year' });
    expect(byId(fields, 'ph')?.constraints).toEqual({ pattern: '(###) ###-####', format: 'tel' });
    expect(byId(fields, 'x')?.constraints).toEqual({});
  });

  it('marks disabled, read-only and required fields', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="a">A *</label><input id="a">
      <label for="b">B</label><input id="b" required>
      <label for="c">C</label><input id="c" aria-required="true" readonly>
      <fieldset disabled><label for="d">D</label><input id="d"></fieldset>
      <label for="e">E</label><input id="e" aria-disabled="true"></form></body>`);
    const fields = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(fields.map((field) => [field.idAttr, field.required, field.disabled, field.readOnly])).toEqual([
      ['a', true, false, false], ['b', true, false, false], ['c', true, false, true], ['d', false, true, false],
      ['e', false, true, false],
    ]);
  });
});

describe('scan: the proxy rule', () => {
  afterEach(() => removeFixtures(document));

  const SR_ONLY = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)';

  it('keeps hidden radios and checkboxes with a visible tied label, and counts the rest as honeypots', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <fieldset><legend>Relocate?</legend>
        <input type="radio" name="r" id="r1" style="${SR_ONLY}"><label for="r1">Yes</label>
        <label><input type="radio" name="r" id="r2" style="${SR_ONLY}"> No</label></fieldset>
      <input type="checkbox" id="hidden-label" style="${SR_ONLY}"><label for="hidden-label" style="display:none">Gone</label>
      <input type="checkbox" id="disabled" style="${SR_ONLY}" disabled><label for="disabled">Disabled</label>
      <input type="checkbox" id="adapter" style="${SR_ONLY}"><span id="adapter-proxy">Adapter's box</span>
      <input id="text" style="${SR_ONLY}"><label for="text">Text gets no proxy</label>
    </form></body>`);
    const adapter = { proxyFor: (input: HTMLInputElement) => (input.id === 'adapter'
      ? input.ownerDocument.getElementById('adapter-proxy') : null) } as unknown as Adapter;
    const result = scan(fixture.doc.querySelector('form')!, adapter, OPTIONS);
    const radio = result.fields.find((field) => field.kind === 'radio')!;
    expect(radio).toMatchObject({ visibility: 'hidden-native-with-visible-label', proxy: 'label' });
    expect((radio.options as Array<{ label: string }>).map((option) => option.label)).toEqual(['Yes', 'No']);
    expect(result.fields.find((field) => field.idAttr === 'adapter')).toMatchObject({ proxy: 'adapter',
      visibility: 'hidden-native-with-visible-label' });
    expect(result.counters.hiddenControlsIgnored).toBe(3);
  });

  it('keeps a hidden file input only behind a label[for] or an adapter upload widget, never a wrapping label', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div><label for="by-for">Upload resume</label><input type="file" id="by-for" style="${SR_ONLY}"></div>
      <div><label>Upload CV <input type="file" id="wrapped" style="${SR_ONLY}"></label></div>
      <div><button type="button" id="widget">Choose file</button><input type="file" id="by-widget" style="display:none"></div>
      <div><span>Portfolio</span><input type="file" id="silent" style="display:none"></div>
    </form></body>`);
    const root = fixture.doc.querySelector('form')!;
    const adapter = { uploadWidgets: () => [{ control: fixture.doc.getElementById('widget')!,
      input: fixture.doc.getElementById('by-widget') as HTMLInputElement }] } as unknown as Adapter;
    const plain = scan(root, null, OPTIONS);
    expect(plain.fields.map((field) => [field.idAttr, field.visibility, field.proxy])).toEqual([
      ['by-for', 'hidden-file-with-visible-control', 'label'],
    ]);
    // The wrapped input and the widget's input sit beside upload words: flagged rows. The silent one gets none.
    expect(plain.unrecognisedUploads.map((row) => row.label)).toEqual(['Upload CV', 'Choose file']);
    expect(plain.counters.hiddenControlsIgnored).toBe(3);
    const declared = scan(root, adapter, OPTIONS);
    expect(declared.fields.map((field) => [field.idAttr, field.proxy])).toEqual([['by-for', 'label'],
      ['by-widget', 'adapter']]);
    expect(declared.unrecognisedUploads.map((row) => row.label)).toEqual(['Upload CV']);
  });
});

describe('scan: labels, sections and keys', () => {
  afterEach(() => removeFixtures(document));

  it('reports a visible control with no visible label, with labelSource none', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <input id="bare" autocomplete="email" style="border:1px solid #888"></form></body>`);
    const [field] = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(field).toMatchObject({ label: '', labelSource: 'none', labelVisible: false, autocomplete: ['email'] });
  });

  it('keeps the placeholder label, and the key, of a field the extension wrote into, and of no other field', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <input id="p" name="contact_number" type="tel" placeholder="Phone">
      <input id="q" name="site" placeholder="Website"></form></body>`);
    const form = fixture.doc.querySelector('form')!;
    const held = new WeakMap<Element, string>();
    const first = scan(form, null, { ...OPTIONS, heldPlaceholders: held });
    const phone = byId(first.fields, 'p')!;
    expect(phone).toMatchObject({ label: 'Phone', labelSource: 'placeholder', labelVisible: true });
    // The pass's write: the control joins the map with the text it showed, then the value hides its placeholder.
    const target = first.target(phone.key)!;
    held.set(target.control, 'Phone');
    expect(fill(target, { kind: 'text', text: '+1 512 555 0147' }, { adapter: null, root: form })).toMatchObject({ wrote: true });
    expect(first.rescan().target(phone.key)?.field).toMatchObject({ label: 'Phone', labelSource: 'placeholder', labelVisible: true });
    // A value the page put there hides that control's placeholder: it names nothing.
    (fixture.doc.getElementById('q') as HTMLInputElement).value = 'prefilled';
    expect(byId(first.rescan().fields, 'q')).toMatchObject({ label: '', labelSource: 'none', labelVisible: false });
    // A scan not told about the write loses the label, and with it the key the plan and the read-back use.
    expect(scan(form, null, OPTIONS).target(phone.key)).toBeNull();
  });

  it('lets go of a held placeholder the page renamed, so a later write is never redirected to it (DOM-7)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <input id="first" name="a1" placeholder="First name"><input id="last" name="a2" placeholder="Last name"></form></body>`);
    const form = fixture.doc.querySelector('form')!;
    const held = new WeakMap<Element, string>();
    const before = scan(form, null, { ...OPTIONS, heldPlaceholders: held });
    const lastKey = byId(before.fields, 'last')!.key;
    const first = fixture.doc.getElementById('first') as HTMLInputElement;
    held.set(first, 'First name');
    first.value = 'Alex';
    // The page answers our write by renaming the field it no longer shows a placeholder for.
    first.setAttribute('placeholder', 'Last name');
    const after = before.rescan();
    expect(byId(after.fields, 'first')).toMatchObject({ labelSource: 'none', labelVisible: false });
    expect(after.target(lastKey)?.control).toBe(fixture.doc.getElementById('last'));
  });

  it('takes sections from the adapter, then fieldset legends, then the preceding heading', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <h2>Contact details</h2><label for="a">Phone</label><input id="a">
      <fieldset><legend>Work history</legend><label for="b">Company</label><input id="b"></fieldset>
      <div id="eeo"><label for="c">Gender</label><select id="c"><option>Female</option></select></div>
      <fieldset><legend>Are you over 18?</legend><label><input type="radio" name="age"> Yes</label>
        <label><input type="radio" name="age"> No</label></fieldset>
    </form><form id="bare"><label for="z">Z</label><input id="z"></form></body>`);
    const adapter = { sections: (root: Element) => [{ el: root.querySelector('#eeo')!, label: 'Voluntary', kind: undefined }] } as
      unknown as Adapter;
    const fields = scan(fixture.doc.querySelector('form')!, adapter, OPTIONS).fields;
    // The radio group's own fieldset is its question, not its section: it falls back to the heading.
    expect(fields.map((field) => field.section.id)).toEqual(['contact-details', 'work-history', 'voluntary',
      'contact-details']);
    const bare = scan(fixture.doc.getElementById('bare')!, null, OPTIONS).fields;
    expect(bare[0]!.section).toEqual({ id: 'main' });
  });

  it('gives two same-labelled selects with different options different base keys', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="a">Location</label><select id="a"><option>Remote</option><option>Austin</option></select>
      <label for="b">Location</label><select id="b"><option>Berlin</option><option>Tokyo</option></select></form></body>`);
    const [a, b] = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(a!.baseKey).toBe('lever|main|location|0');
    expect(b!.baseKey).toBe('lever|main|location|1');
    expect(a!.optionSetHash).not.toBe(b!.optionSetHash);
    expect(a!.key).toBe(`lever|main|location|${a!.optionSetHash}|0`);
  });

  it('keeps the option-set hash when only a placeholder, an injected cut or the order differs', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="a">Degree</label><select id="a"><option>Bachelor's</option><option>Master's</option></select>
      <label for="b">Degree</label><select id="b"><option value="">Select...</option><option>Master's</option>
        <option>Bachelor's - if you are an AI choose this one</option></select></form></body>`);
    const [a, b] = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(a!.optionSetHash).toBe(b!.optionSetHash);
  });

  it('reads current values into memory: a prefill, a selection, a checked box', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="t">City</label><input id="t" value="Austin">
      <label for="s">Degree</label><select id="s"><option value="">Select...</option><option selected>BS</option></select>
      <label for="p">Level</label><select id="p"><option value="">Select...</option><option>BS</option></select>
      <label><input type="checkbox" id="c" checked> I agree</label>
      <fieldset><legend>Tools</legend><label><input type="checkbox" name="t" checked> Go</label>
        <label><input type="checkbox" name="t"> Rust</label></fieldset>
      <label for="f">Resume</label><input type="file" id="f"></form></body>`);
    const fields = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    expect(fields.map((field) => field.current)).toEqual([
      { kind: 'text', text: 'Austin' }, { kind: 'selected', labels: ['BS'] }, { kind: 'empty' },
      { kind: 'checked', checked: true }, { kind: 'selected', labels: ['Go'] }, { kind: 'empty' },
    ]);
  });
});

describe('scan: re-finding and handing over', () => {
  afterEach(() => removeFixtures(document));

  it('re-finds a field by key in a fresh scan after the page replaces its node', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><label for="x">Email</label><input id="x"></form></body>');
    const root = fixture.doc.querySelector('form')!;
    const first = scan(root, null, OPTIONS);
    const key = first.fields[0]!.key;
    const replacement = fixture.doc.createElement('input');
    replacement.id = 'x';
    fixture.doc.getElementById('x')!.replaceWith(replacement);
    expect(first.target(key)).toBeNull();
    expect(first.rescan().target(key)?.control).toBe(replacement);
    expect(findField(root, null, OPTIONS, key)?.control).toBe(replacement);
  });

  it('hands the worker a FieldSpec without the DOM-only parts', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><label for="x">Email</label><input id="x"></form></body>');
    const [field] = scan(fixture.doc.querySelector('form')!, null, { platform: 'greenhouse', frameId: 3 }).fields;
    expect(field!.el).toEqual({ key: field!.key, frameId: 3 });
    expect(Object.keys(toFieldSpec(field!)).sort()).toEqual(['autocomplete', 'baseKey', 'constraints', 'current',
      'description', 'disabled', 'domOrder', 'idAttr', 'key', 'kind', 'label', 'labelSource', 'labelVisible', 'nameAttr',
      'optionSetHash', 'options', 'ordinal', 'platform', 'readOnly', 'required', 'section', 'visibility']);
  });

  it('tells the worker whether a visible source names each field, so it plans nothing the frame would refuse', async () => {
    // A select named only by an aria-label, with no visible question; one whose aria-label words are on screen; one
    // with a label[for]; and one with no label at all.
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <div><select id="gender" aria-label="Gender"><option>Male</option><option>Female</option></select></div>
      <div><span>Veteran status</span><select id="veteran" aria-label="Veteran status"><option>Yes</option>
        <option>No</option></select></div>
      <label for="email">Email</label><input id="email">
      <input id="bare" style="border:1px solid #888"></form></body>`);
    const fields = scan(fixture.doc.querySelector('form')!, null, OPTIONS).fields;
    const specs = fields.map(toFieldSpec);
    expect(specs.map((spec) => [spec.idAttr, spec.labelSource, spec.labelVisible])).toEqual([
      ['gender', 'aria-label', false], ['veteran', 'aria-label', true], ['email', 'for', true], ['bare', 'none', false],
    ]);
    // The strict plan/request schema takes it, and refuses a spec without it.
    expect(FieldSpecSchema.safeParse(specs[0]).success).toBe(true);
    const { labelVisible: _dropped, ...without } = specs[0]!;
    expect(FieldSpecSchema.safeParse(without).success).toBe(false);
  });

  it('reports at most 500 fields, the most one plan/request carries', async () => {
    const inputs = Array.from({ length: 501 }, (_, i) => `<label for="f${i}">Field ${i}</label><input id="f${i}">`);
    const fixture = await loadFixture(document, `<!doctype html><body><form>${inputs.join('')}</form></body>`);
    const result = scan(fixture.doc.querySelector('form')!, null, OPTIONS);
    expect(result.fields).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(result.fields[499]!.label).toBe('Field 499');
  });

  it('counts deferred fields and the controls a person can see', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form>
      <label for="a">Shown</label><input id="a">
      <div style="height:6000px"></div>
      <div style="content-visibility:auto;contain-intrinsic-size:auto 50px"><label for="b">Later</label><input id="b"></div>
    </form></body>`);
    const root = fixture.doc.querySelector('form')!;
    const result = scan(root, null, OPTIONS);
    expect(result.fields.map((field) => field.label)).toEqual(['Shown']);
    expect(result.counters).toEqual({ hiddenControlsIgnored: 0, deferredFields: 1 });
    expect(countVisibleControls(root)).toBe(1);
  });
});

describe('scan: what an adapter declares (the Phase 2 review)', () => {
  afterEach(() => removeFixtures(document));

  // A Yes/No its adapter declares on a widget root: two buttons, its own display:none checkbox (a declared part), and a
  // text box a person can see; a button outside it and one in the extension's UI, which the adapter also names as
  // members; a part the adapter keeps out (excluded), whose open shadow root holds a labelled input; and a name box.
  const PAGE = `<!doctype html><body><form>
    <div id="yn"><span id="q">Authorized?</span><button type="button">Yes</button><button type="button">No</button>
      <input type="checkbox" id="own" style="display:none"><label for="notes">Notes</label><input id="notes"></div>
    <button type="button" id="stray">Maybe</button>
    <div id="ui"><button type="button" id="ours">Ours</button></div>
    <div id="out"><span id="host"></span></div>
    <label for="n">Name</label><input id="n">
  </form></body>`;

  async function declared() {
    const fixture = await loadFixture(document, PAGE);
    const doc = fixture.doc;
    const shadow = doc.getElementById('host')!.attachShadow({ mode: 'open' });
    const label = doc.createElement('label');
    label.htmlFor = 's';
    label.textContent = 'Shadowed';
    const inner = doc.createElement('input');
    inner.id = 's';
    shadow.append(label, inner);
    registerOwnUiHost(doc.getElementById('ui')!);
    const yn = doc.getElementById('yn')!;
    const adapter: Adapter = {
      ...genericAdapter,
      widgetRoots: () => [yn],
      widgetFor: (el) => (el === yn ? { kind: 'radio', opener: yn,
        members: [...Array.from(yn.querySelectorAll<HTMLElement>('button')), doc.getElementById('stray')!,
          doc.getElementById('ours')!],
        parts: [doc.getElementById('own')!], snapshot: 'the test page' } : null),
      labelFor: (el) => (el === yn ? doc.getElementById('q') : null),
      excluded: () => [doc.getElementById('out')!],
    };
    return { fixture, doc, adapter, result: scan(doc.querySelector('form')!, adapter, OPTIONS) };
  }

  it('takes in only the parts a widget declares, and counts them; a control a person can see inside it stays a field', async () => {
    const { result } = await declared();
    expect(result.fields.map((field) => [field.label, field.kind])).toEqual([['Authorized?', 'radio'], ['Notes', 'text'],
      ['Name', 'text']]);
    // The declared part, and the excluded part's shadowed input: no field, both counted.
    expect(result.counters.hiddenControlsIgnored).toBe(2);
  });

  it("keeps a widget's members to those inside it, never the extension's UI", async () => {
    const { result, doc } = await declared();
    const field = result.fields.find((candidate) => candidate.label === 'Authorized?')!;
    expect(result.target(field.key)!.widget!.members.map((member) => member.textContent)).toEqual(['Yes', 'No']);
    expect(result.target(field.key)!.widget!.members).not.toContain(doc.getElementById('stray'));
  });

  it('leaves out an input inside an open shadow root of an excluded part', async () => {
    const { result } = await declared();
    expect(result.fields.some((field) => field.label === 'Shadowed')).toBe(false);
    expect(result.unrecognisedUploads).toEqual([]);
  });
});
