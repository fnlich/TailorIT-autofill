/*
 * jr7 ENGINE-7 E1 (FIX7PLAN §6.2, reading): how the page is read, on synthetic pages shaped as the jr7 audits describe
 * each platform's markup (SP\jr7\audit\*.md), each hook declared by a test adapter as its platform package declares it.
 * Every value is synthetic. One describe per item; each rule's test fails without it (the handoff's undo proofs).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { fill } from './fillers';
import { domGuardBeforeWrite } from './guard';
import { requiredLeftOf } from '../content/press';
import { detectPause } from './pause-detect';
import { scan } from './scan';

afterEach(() => removeFixtures(document));

const BASE_STYLE = `body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  input, select, textarea { display: block; width: 300px; padding: 6px; border: 1px solid #888; background: #fff; }`;

/** A page of the framework's own markup with `body` inside a form#f. */
const page = (body: string, style = '') => `<!doctype html><html><head><style>${BASE_STYLE}${style}</style></head>
  <body><form id="f" method="post">${body}</form></body></html>`;

// ── item 7 (RBP7-21): labels of one control that say the same words count once ─────────────────────────────────────
describe('item 7 (RBP7-21): two labels of one control saying the same words', () => {
  /** Pinpoint's job-preference block as its verifier measured it (snapshot7 pinpointhq1): drawn twice with the same
   *  ids, so the first input of each id takes both label[for]; each input also says the words in its aria-label. */
  const BLOCK = `<div class="prefs"><label for="loc">Locations</label><input id="loc" aria-label="Locations">
    <label for="title">Job Title</label><input id="title" aria-label="Job Title"></div>`;

  it('reads them once, and two labels in other words joined as before', async () => {
    const { doc } = await loadFixture(document, page(`${BLOCK}${BLOCK}
      <label for="pair">Preferred</label><label for="pair">start date</label><input id="pair">`));
    const fields = scan(doc.getElementById('f')!, genericAdapter, { platform: 'pinpoint' }).fields;
    const labels = fields.map((field) => field.label);
    expect(labels.filter((label) => label === 'Locations Locations' || label === 'Job Title Job Title')).toEqual([]);
    expect(labels.filter((label) => label === 'Locations')).toHaveLength(2);
    expect(labels.filter((label) => label === 'Job Title')).toHaveLength(2);
    expect(labels).toContain('Preferred start date');
  });
});

// ── item 6 (RBP7-20): react-select's DummyInput is not read-only by its aria-readonly ──────────────────────────────
describe("item 6 (RBP7-20): a declared react-select's DummyInput", () => {
  /** A non-searchable react-select as Pinpoint draws its EEO questions (snapshot7 pinpointhq1): its control box, and
   *  inside it the DummyInput, a transparent input that says role=combobox, aria-readonly="true" and inputmode="none".
   *  `attrs` stands a test's change in. */
  const select = (attrs: string) => page(`<div class="react-select"><div class="react-select__control" id="ctl"
      style="border:1px solid #888;width:300px;height:38px;display:flex;align-items:center">
      <span>Select...</span><input id="dummy" role="combobox" aria-label="Gender" ${attrs}
        style="opacity:0;width:1px;border:0;padding:0;background:0"></div></div>`);
  /** The adapter Pinpoint's package declares: the input a react-select widget with its box and (`bridge`) the bridge. */
  const adapter = (options: { bridge?: boolean; readOnlyBox?: boolean } = {}) => ({ ...genericAdapter, id: 'generic' as const,
    widgetFor: (control: Element) => control.id !== 'dummy' ? null : {
      kind: 'combobox' as const, opener: control.ownerDocument.getElementById('ctl')!, box: control.ownerDocument.getElementById('ctl')!,
      ...(options.bridge === false ? {} : { bridge: 'react-select' as const }),
      ...(options.readOnlyBox === true ? { readOnlyBox: true as const } : {}), snapshot: 'synthetic' } });
  const readOnlyOf = async (attrs: string, options: { bridge?: boolean; readOnlyBox?: boolean } = {}) => {
    const { doc } = await loadFixture(document, select(attrs));
    const field = scan(doc.getElementById('f')!, adapter(options), { platform: 'pinpoint' }).fields
      .find((each) => each.label === 'Gender');
    removeFixtures(document);
    return field?.readOnly ?? 'no field';
  };

  it('is writable through the bridge, and every other aria-readonly box stays read-only', async () => {
    const dummy = 'aria-readonly="true" inputmode="none"';
    expect(await readOnlyOf(dummy)).toBe(false);
    expect(await readOnlyOf(dummy, { readOnlyBox: true })).toBe(false);
    // No bridge declared, or an aria-readonly box that is no DummyInput (it can be typed into): read-only, as before.
    expect(await readOnlyOf(dummy, { bridge: false })).toBe(true);
    expect(await readOnlyOf('aria-readonly="true"')).toBe(true);
    expect(await readOnlyOf('aria-readonly="true"', { readOnlyBox: true })).toBe(true);
    // Its native readonly still makes it read-only.
    expect(await readOnlyOf(`${dummy} readonly`)).toBe(true);
  });
});

// ── item 4 (EFA-3): a one-time-code box its adapter names no code box ───────────────────────────────────────────────
describe('item 4 (EFA-3): one-time-code boxes the adapter names no code boxes', () => {
  /** Eightfold's apply form as the jdef audit describes it (snapshot7 twillio): ordinary boxes marked
   *  autocomplete="one-time-code" to keep the browser's autofill off, each with a data-test-id naming its section. */
  const APPLY = page(`<label for="phone">Phone Number</label>
    <input id="phone" type="tel" autocomplete="one-time-code" data-test-id="Contact_Information_phone">
    <label for="city">City</label><input id="city" autocomplete="one-time-code" data-test-id="Contact_Information_city">
    <label for="why">Why this role?</label>
    <input id="why" autocomplete="one-time-code" data-test-id="Position_Specific_Questions_why">
    <button type="submit" data-test-id="submitApplicationButton">Submit</button>`);
  /** A code page: one box marked one-time-code, which the adapter does not name. */
  const CODE = page(`<label for="otp">Enter the code we texted to your phone</label>
    <input id="otp" autocomplete="one-time-code" data-test-id="Verify_code"><button type="submit">Verify</button>`);
  /** The adapter JDEF-7 declares (FIX7PLAN §6.15, Eightfold item 2). */
  const eightfold: Adapter = { ...genericAdapter, id: 'generic',
    notCodeBox: (input) => input.closest('form:has([data-test-id="submitApplicationButton"])') !== null
      && /^(?:Contact_Information_|Position_Specific_Questions_)/.test(input.getAttribute('data-test-id') ?? '') };

  it('reads them as fields, pauses nothing, and lets the guard write them', async () => {
    const { doc } = await loadFixture(document, APPLY);
    const root = doc.getElementById('f')!;
    expect(detectPause(doc, root, eightfold)).toBeNull();
    const result = scan(root, eightfold, { platform: 'eightfold' });
    expect(result.authFields).toBe(0);
    expect(result.fields.map((field) => field.label)).toEqual(['Phone Number', 'City', 'Why this role?']);
    const phone = result.fields[0]!;
    expect(domGuardBeforeWrite(result, phone)).toMatchObject({ ok: true });
    // Without the adapter's word they are code boxes: the step is an emailed code, and none is a field.
    expect(detectPause(doc, root, genericAdapter)).toEqual({ kind: 'email-code', evidence: 'one-time-code' });
    expect(scan(root, genericAdapter, { platform: 'eightfold' }).authFields).toBe(3);
  });

  it('still pauses on a code box the adapter does not name', async () => {
    const { doc } = await loadFixture(document, CODE);
    const root = doc.getElementById('f')!;
    expect(detectPause(doc, root, eightfold)).toEqual({ kind: 'email-code', evidence: 'one-time-code' });
    expect(scan(root, eightfold, { platform: 'eightfold' }).authFields).toBe(1);
  });
});

// ── item 9 (RBP7-V3): a required upload no rule recognises holds Submit ─────────────────────────────────────────────
describe('item 9 (RBP7-V3): a required upload the scan recognises no control of', () => {
  /** BambooHR's "Resume*" as its verifier measured it (snapshot7 bamboohr1): a hidden input[type=file] beside a visible
   *  button no upload rule names (`attrs`: the input's), and a filled name. */
  const form = (attrs: string) => page(`<div class="upload"><span>Resume*</span>
      <input type="file" id="resume" name="resume" ${attrs} style="display:none">
      <button type="button" id="pick">Upload File</button></div>
    <div><label for="name">Name</label><input id="name" value="Alex"></div>`);
  const leftOn = async (attrs: string, adapter: Adapter = genericAdapter, file = false) => {
    const { doc } = await loadFixture(document, form(attrs));
    if (file) {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'resume.pdf', { type: 'application/pdf' }));
      (doc.getElementById('resume') as HTMLInputElement).files = data.files;
    }
    const scanned = scan(doc.getElementById('f')!, adapter, { platform: 'bamboohr' });
    removeFixtures(document);
    return { uploads: scanned.unrecognisedUploads.length, left: requiredLeftOf(scanned) };
  };

  it("counts it left while it holds no file, by its own required mark or its adapter's", async () => {
    expect(await leftOn('required')).toEqual({ uploads: 1, left: 1 });
    expect(await leftOn('aria-required="true"')).toEqual({ uploads: 1, left: 1 });
    const marks: Adapter = { ...genericAdapter, id: 'generic', requiredFor: (el) => el.id === 'pick' };
    expect(await leftOn('', marks)).toEqual({ uploads: 1, left: 1 });
    // Once a file is in, or where nothing marks it required, it holds nothing.
    expect(await leftOn('required', genericAdapter, true)).toEqual({ uploads: 1, left: 0 });
    expect(await leftOn('')).toEqual({ uploads: 1, left: 0 });
  });
});

// ── item 5 (EFA-4): an option's words painted in an aria-hidden label of that very input ───────────────────────────
describe("item 5 (EFA-4): a declared proxy's radio whose own label[for] is aria-hidden", () => {
  /** One of Eightfold's radio questions as the jdef audit describes it (snapshot7 twillio): each radio at opacity 0 in
   *  its selector wrapper, its own label[for] aria-hidden drawing the words, its aria-label `aria(word)`. */
  const option = (word: string, aria: string, labelFor = `q-${word}`, opacity = 0) => `<div class="radio-module_selector__x1"
      style="position:relative;display:inline-block;padding:6px 12px;border:1px solid #888">
      <input type="radio" id="q-${word}" name="q" value="${word}" aria-label="${aria}"
        style="opacity:${opacity};position:absolute;left:0;top:0;width:100%;height:100%;margin:0">
      <label for="${labelFor}" aria-hidden="true" class="selector-label">${word}</label></div>`;
  const question = (options: string) => page(`<div role="radiogroup" id="group">
      <p id="title">Are you legally authorized to work here?</p>${options}</div>`);
  /** The adapter JDEF-7 declares: the wrapper the radio's proxy, its words the wrapper's selector label, the title. */
  const eightfold = (proxies = true): Adapter => ({ ...genericAdapter, id: 'generic',
    ...(proxies ? { proxyFor: (input: HTMLInputElement) => input.closest('[class*="radio-module_selector__"]') } : {}),
    optionTextFor: (input) => input.closest('[class*="radio-module_selector__"]')
      ?.querySelector('[class*="selector-label"]')?.textContent ?? null,
    labelFor: (control) => (control.id === 'group' ? control.ownerDocument.getElementById('title') : null) });
  const optionsOf = async (html: string, adapter: Adapter) => {
    const { doc } = await loadFixture(document, html);
    const field = scan(doc.getElementById('f')!, adapter, { platform: 'eightfold' }).fields
      .find((each) => each.kind === 'radio');
    removeFixtures(document);
    return field === undefined || field.options === 'lazy' ? null : field.options.map((each) => each.label);
  };
  const Q = 'Are you legally authorized to work here?';

  it('reads its words, and never where no proxy is declared, the aria-label says other words, or the label is another\'s',
    async () => {
      expect(await optionsOf(question(option('No', `No, ${Q}`) + option('Yes', `Yes, ${Q}`)), eightfold()))
        .toEqual(['No', 'Yes']);
      expect(await optionsOf(question(option('No', `No, ${Q}`) + option('Yes', `Yes, ${Q}`)), eightfold(false)))
        .not.toEqual(['No', 'Yes']);
      // Radios a person can see themselves (a field with no proxy): their hidden labels' words are never read.
      const shown = question(option('No', `No, ${Q}`, 'q-No', 1) + option('Yes', `Yes, ${Q}`, 'q-Yes', 1));
      expect(await optionsOf(shown, eightfold(false))).not.toBeNull();
      expect(await optionsOf(shown, eightfold(false))).not.toEqual(['No', 'Yes']);
      expect(await optionsOf(question(option('No', `${Q} No`) + option('Yes', `${Q} Yes`)), eightfold()))
        .not.toEqual(['No', 'Yes']);
      // Each label names the other radio: never read for this one.
      expect(await optionsOf(question(option('No', `No, ${Q}`, 'q-Yes') + option('Yes', `Yes, ${Q}`, 'q-No')),
        eightfold())).not.toEqual(['No', 'Yes']);
    });
});

// ── item 1 (UKGR-6): a native select at opacity 0 inside its adapter's declared box ────────────────────────────────
describe("item 1 (UKGR-6): a native select hidden only by its opacity, inside the adapter's declared box", () => {
  /** UKG Ready's select as its audit measured it (snapshot7 secure7.saashr): a bordered c-form-control box showing the
   *  chosen option, and over it the select at opacity 0, z-index 2. `selectStyle` and `boxStyle` stand a change in. */
  const page2 = (options: { selectStyle?: string; boxStyle?: string; outside?: boolean } = {}) => page(`
    <label for="vet">Veteran status</label>
    <div class="c-form-control" id="box" style="position:relative;width:300px;height:36px;border:1px solid #888;
      background:#fff;${options.boxStyle ?? ''}">
      <span class="c-form-control__value">Select one</span>
      ${options.outside === true ? '' : `<select id="vet" style="position:absolute;left:0;top:0;width:100%;height:100%;
        opacity:0;z-index:2;appearance:none;${options.selectStyle ?? ''}"><option value="">Select one</option>
        <option value="n">Not a veteran</option><option value="y">Veteran</option></select>`}
    </div>
    ${options.outside === true ? '<select id="vet" style="opacity:0;width:300px;height:36px"><option value="">Select one</option><option value="n">Not a veteran</option></select>' : ''}`);
  const ukg = (declared = true): Adapter => ({ ...genericAdapter, id: 'generic',
    ...(declared ? { controlBox: (control: Element) => control.ownerDocument.getElementById('box') } : {}) });
  const fieldOf = async (html: string, adapter: Adapter) => {
    const { doc } = await loadFixture(document, html);
    const result = scan(doc.getElementById('f')!, adapter, { platform: 'ukgready' });
    return { doc, result, field: result.fields.find((each) => each.label === 'Veteran status') };
  };

  it('is a visible select, not camouflaged, written natively and read back by its value', async () => {
    const { doc, result, field } = await fieldOf(page2(), ukg());
    expect([field?.kind, field?.visibility, field?.camouflaged]).toEqual(['select', 'visible', false]);
    const outcome = fill(result.target(field!.key)!, { kind: 'option', index: 1, cleanLabel: 'Not a veteran' },
      { adapter: ukg(), root: doc.getElementById('f') });
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect((doc.getElementById('vet') as HTMLSelectElement).value).toBe('n');
  });

  it('stays a hidden control with no box declared, a box out of sight, a select outside it or hidden otherwise', async () => {
    for (const [html, adapter] of [[page2(), ukg(false)], [page2({ boxStyle: 'visibility:hidden' }), ukg()],
      [page2({ boxStyle: 'position:absolute;left:-5000px' }), ukg()],
      [page2({ outside: true }), ukg()], [page2({ selectStyle: 'visibility:hidden' }), ukg()],
      [page2({ selectStyle: 'display:none' }), ukg()]] as const) {
      const { field, result } = await fieldOf(html, adapter);
      expect(field, html.slice(0, 0)).toBeUndefined();
      expect(result.counters.hiddenControlsIgnored).toBeGreaterThan(0);
      removeFixtures(document);
    }
  });
});
