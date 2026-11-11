/*
 * The SmartRecruiters adapter on the owner's snapshots of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): its hooks on each
 * page (a posting, an expired posting, the one-click application's first page and its screening step), held against
 * each case's hand-written expectations; the scan of the application's two pages, whose controls sit in open shadow
 * roots (the expectations name them by shadow-piercing chains, deepControl); and each hook's own proof, the scan or the
 * hook read again without it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import bertelsmannExpiredExpect from '../../../fixtures/smartrecruiters/bertelsmann-expired.expect.json';
import bertelsmannExpiredHtml from '../../../fixtures/smartrecruiters/bertelsmann-expired.html?raw';
import wiserOneClickExpect from '../../../fixtures/smartrecruiters/jr6-wiser-one-click.expect.json';
import wiserOneClickHtml from '../../../fixtures/smartrecruiters/jr6-wiser-one-click.html?raw';
import wiserScreeningExpect from '../../../fixtures/smartrecruiters/jr6-wiser-screening.expect.json';
import wiserScreeningHtml from '../../../fixtures/smartrecruiters/jr6-wiser-screening.html?raw';
import xplorFilledExpect from '../../../fixtures/smartrecruiters/jr6-xplor-one-click-filled.expect.json';
import xplorFilledHtml from '../../../fixtures/smartrecruiters/jr6-xplor-one-click-filled.html?raw';
import xplorOneClickExpect from '../../../fixtures/smartrecruiters/xplor-one-click.expect.json';
import xplorOneClickHtml from '../../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import xplorPostingExpect from '../../../fixtures/smartrecruiters/xplor-posting.expect.json';
import xplorPostingHtml from '../../../fixtures/smartrecruiters/xplor-posting.html?raw';
import xplorScreeningExpect from '../../../fixtures/smartrecruiters/xplor-screening.expect.json';
import xplorScreeningHtml from '../../../fixtures/smartrecruiters/xplor-screening.html?raw';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { memberLabel } from '../../dom/widgets/options';
import type { ScanResult } from '../../dom/types';
import { adaptersFor } from '../index';
import { fillabilityOf, readExpectation, sectionIdOf, SNAPSHOT_VIEWPORT, type Expectation } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { SMARTRECRUITERS_JR6_SNAPSHOTS, SMARTRECRUITERS_SNAPSHOTS, smartRecruitersAdapter } from './index';

const FORM = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const CASES = [
  { name: 'xplor-posting', html: xplorPostingHtml, json: xplorPostingExpect, address: 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer' },
  { name: 'bertelsmann-expired', html: bertelsmannExpiredHtml, json: bertelsmannExpiredExpect, address: 'https://jobs.smartrecruiters.com/Bertelsmann-Jobs/744000159908317--senior-infrastructure-engineer-ai-ml-penguin-random-house-open-to-remote-' },
  { name: 'xplor-one-click', html: xplorOneClickHtml, json: xplorOneClickExpect, address: `${FORM}?dcr_ci=Xplor` },
  { name: 'xplor-screening', html: xplorScreeningHtml, json: xplorScreeningExpect, address: `${FORM}/screening?dcr_ci=Xplor` },
] as const;
/** jr6 (FIXPLAN §6.9, SR-8): the owner's filled first pages and answered screening, converted with the jr6 converter. */
const WISER = 'https://jobs.smartrecruiters.com/oneclick-ui/company/WiserSolutions/publication/1477f9aa-cf19-47a8-93a4-7178574f6b11';
const JR6_CASES = [
  { name: 'jr6-xplor-one-click-filled', html: xplorFilledHtml, json: xplorFilledExpect, address: `${FORM}?dcr_ci=Xplor` },
  { name: 'jr6-wiser-one-click', html: wiserOneClickHtml, json: wiserOneClickExpect, address: `${WISER}?dcr_ci=WiserSolutions` },
  { name: 'jr6-wiser-screening', html: wiserScreeningHtml, json: wiserScreeningExpect,
    address: `${WISER}/screening?dcr_ci=WiserSolutions` },
] as const;

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: its links resolve there. */
async function load(html: string, address: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture;
}

/** Every element under `scope` matching `selector`, open shadow roots included. */
function deepAll(scope: Document | Element | ShadowRoot, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (at: Document | Element | ShadowRoot) => {
    for (const el of Array.from(at.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot !== null) visit(el.shadowRoot);
    }
  };
  visit(scope);
  return found;
}

/** The elements an expectation's control names: steps joined by " >>> ", the first looked for anywhere in the
 *  document, each next one anywhere inside the open shadow root of an element the step before found. */
function deepControl(doc: Document, chain: string): Element[] {
  let scopes: Array<Document | ShadowRoot> = [doc];
  let found: Element[] = [];
  for (const step of chain.split(' >>> ')) {
    found = scopes.flatMap((scope) => deepAll(scope, step));
    scopes = found.flatMap((el) => (el.shadowRoot === null ? [] : [el.shadowRoot]));
  }
  return found;
}

/** The differences between a scan and its expectation, as compareWithExpectation reads them (docs/FIXTURES.md
 *  "Expectations"), its controls named by deepControl. [] when they agree. */
function compareDeep(doc: Document, result: ScanResult, expectation: Expectation): string[] {
  const out: string[] = [];
  const fieldOf = new Map<Element, (typeof result.fields)[number]>();
  for (const field of result.fields) {
    const target = result.target(field.key);
    if (target === null) continue;
    const widget = target.widget;
    const parts = widget === undefined ? [] : [widget.element, ...(widget.input === null ? [] : [widget.input]), ...widget.members];
    for (const el of [target.control, ...target.members, ...parts]) fieldOf.set(el, field);
  }
  const claimed = new Set<unknown>();
  for (const entry of expectation.fields) {
    const elements = deepControl(doc, entry.control);
    if (elements.length !== 1) {
      out.push(`${entry.control}: ${elements.length} elements`);
      continue;
    }
    const field = fieldOf.get(elements[0]!);
    if (field === undefined) {
      out.push(`${entry.control}: no field`);
      continue;
    }
    claimed.add(field);
    const target = result.target(field.key);
    const verdict = fillabilityOf(field, target?.widget);
    const reason = verdict.fillable ? undefined : verdict.reason;
    if (field.label !== entry.label) out.push(`${entry.control}: label ${JSON.stringify(field.label)}`);
    if (field.required !== entry.required) out.push(`${entry.control}: required ${String(field.required)}`);
    if (verdict.fillable !== entry.fillable || reason !== entry.reason) out.push(`${entry.control}: fillable ${String(reason ?? true)}`);
    if (field.kind !== entry.kind) out.push(`${entry.control}: kind ${field.kind}`);
    if (field.section.id !== sectionIdOf(entry.section)) out.push(`${entry.control}: section ${field.section.id}`);
    if (entry.options !== undefined) {
      const options = target?.widget?.kind === 'radio' ? target.widget.members.length
        : field.options === 'lazy' ? 'lazy' : field.options.length;
      if (options !== entry.options) out.push(`${entry.control}: options ${String(options)}`);
    }
  }
  for (const field of result.fields) if (!claimed.has(field)) out.push(`unlisted: a ${field.kind} field "${field.label}"`);
  return out;
}

/**
 * What the scanner reads differently from a case's expectation, and why. The core pass of 2026-11-06 made dom/scan.ts
 * adapterParts take a widget root across open shadow roots (holdsComposed), so xplor-screening's six Yes/No questions
 * (spl-radio-group elements in sr-screening-questions-form's shadow root, declared by the adapter's widgetRoots and
 * widgetFor) are fields; until then each was "no field" here.
 * jr6 SR-1 (FIXPLAN §6.9 item 1): xplor-screening's five dropdowns are declared with the whole list the page publishes
 * (WidgetDecl.knownOptions), which the scanner reads as each field's options from ENGINE E1 on (tag jr6-engine-e1, not
 * merged into this branch in P1): until then each still reads 'lazy'. The package's P2, merging jr6-engine, removes
 * these five (the comparison then fails while one is left).
 */
const KNOWN: Record<string, readonly string[]> = {
  'xplor-screening': ['a0151063-d62b-49e7-9c6f-d17e59b99090', '562715e2-4960-44f3-9e8d-2750ae765f9a',
    '9320d6d5-0b22-4e3f-b913-e7076e5e8083', '5d965982-4693-4ca6-91ff-9dde3767755c', 'd9203a60-8103-4251-8402-eb366923db58']
    .map((id) => `spl-autocomplete#question_${id} >>> input[role="combobox"]: options lazy`),
};

/** The scan of a case's root with `adapter` (the SmartRecruiters adapter, or one with a hook taken away). */
async function scanWith(index: 2 | 3, adapter: Adapter) {
  const { html, address } = CASES[index];
  const fixture = await load(html, address);
  const root = adapter.detect(fixture.doc)!.formRoot;
  return { fixture, root, result: scan(root, adapter, { platform: 'smartrecruiters' }) };
}

/** The adapter without one of its hooks. */
const without = (hook: keyof Adapter): Adapter => ({ ...smartRecruitersAdapter, [hook]: undefined });

afterEach(() => removeFixtures(document));

describe('the SmartRecruiters adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect(CASES.map((each) => `fixtures/smartrecruiters/${each.name}.html`).sort()).toEqual([...SMARTRECRUITERS_SNAPSHOTS].sort());
  });

  it('is the adapter of every page of jobs.smartrecruiters.com it reads', () => {
    for (const { address } of CASES) expect(adaptersFor(new URL(address))[0]).toBe(smartRecruitersAdapter);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, smartRecruitersAdapter, readHooks(json))).toEqual([]);
  });

  it.each([CASES[2], CASES[3]])('$name: the scan of its root is the expectation', async ({ name, html, json, address }) => {
    const fixture = await load(html, address);
    const root = smartRecruitersAdapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const found = compareDeep(fixture.doc, result, readExpectation(json));
    const known = KNOWN[name] ?? [];
    for (const each of known) expect(found).toContain(each);
    expect(found.filter((each) => !known.includes(each))).toEqual([]);
  });

  // jr6 (SR-8): the three jr6 cases, their hooks and their scans held against their expectations, as the owner's four.
  it('names each jr6 snapshot it reads', () => {
    expect(JR6_CASES.map((each) => `fixtures/smartrecruiters/${each.name}.html`)).toEqual([...SMARTRECRUITERS_JR6_SNAPSHOTS]);
    for (const { address } of JR6_CASES) expect(adaptersFor(new URL(address))[0]).toBe(smartRecruitersAdapter);
  });

  it.each(JR6_CASES)('$name: every hook answers what the page shows', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    expect(compareHooks(fixture.doc, smartRecruitersAdapter, readHooks(json))).toEqual([]);
  });

  it.each(JR6_CASES)('$name: the scan of its root is the expectation', async ({ html, json, address }) => {
    const fixture = await load(html, address);
    const root = smartRecruitersAdapter.detect(fixture.doc)!.formRoot;
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    expect(compareDeep(fixture.doc, result, readExpectation(json))).toEqual([]);
  });
});

describe('each hook, read without it', () => {
  const labelOf = (result: ScanResult, kind: string) => result.fields.filter((field) => field.kind === kind)
    .map((field) => field.label);

  it("widgetRoots, widgetFor: a screening Yes/No question's options are its own children, slotted into its fieldset", async () => {
    const { fixture, root } = await scanWith(3, smartRecruitersAdapter);
    const groups = smartRecruitersAdapter.widgetRoots!(root);
    expect(groups.map((group) => group.id)).toEqual(['spl-form-element_21', 'spl-form-element_27', 'spl-form-element_30',
      'spl-form-element_33', 'spl-form-element_36', 'spl-form-element_43']);
    const first = smartRecruitersAdapter.widgetFor!(groups[0]!)!;
    expect(first.kind).toBe('radio');
    expect(first.members).toEqual(Array.from(groups[0]!.querySelectorAll(':scope > spl-radio[role="radio"]')));
    expect(first.members!.map((member) => memberLabel(member))).toEqual(['Yes', 'No']);
    expect(smartRecruitersAdapter.widgetFor!(groups[5]!)!.members!.map((member) => memberLabel(member)))
      .toEqual(['Yes', 'No', 'Prefer not to answer']);
    // No ARIA reading finds them: the fieldset holds none of them in its own tree.
    const fieldset = deepControl(fixture.doc, 'spl-radio-group#spl-form-element_21 >>> fieldset[role="radiogroup"]')[0]!;
    expect(fieldset.querySelectorAll('[role="radio"]').length).toBe(0);
    expect(smartRecruitersAdapter.widgetFor!(fieldset)).toBeNull();
  });

  it("excluded: the Easy Apply drop zone (SmartRecruiters' own resume parsing) is no field", async () => {
    expect(labelOf((await scanWith(2, smartRecruitersAdapter)).result, 'file')).toEqual(['Resume']);
    removeFixtures(document);
    expect(labelOf((await scanWith(2, without('excluded'))).result, 'file')).toHaveLength(2);
  });

  it("labelFor: the phone's number is labelled across its shadow roots, the drop zones by their questions", async () => {
    const plain = await scanWith(2, without('labelFor'));
    const phone = plain.result.fields.find((field) => field.label === 'Phone number')!;
    expect(fillabilityOf(phone, plain.result.target(phone.key)?.widget)).toEqual({ fillable: false, reason: 'no-visible-label' });
    expect(labelOf(plain.result, 'file')).not.toContain('Resume');
    removeFixtures(document);
    const screening = await scanWith(3, without('labelFor'));
    expect(labelOf(screening.result, 'file')).not.toContain('Additional attachments');
  });

  it('uploadWidgets: each drop zone opens its file input through its own label', async () => {
    const { root, fixture } = await scanWith(3, smartRecruitersAdapter);
    const widgets = smartRecruitersAdapter.uploadWidgets!(root);
    const zone = deepControl(fixture.doc, 'spl-dropzone[data-spl-field]')[0]!;
    expect(widgets).toEqual([{ control: zone.shadowRoot!.querySelector('label[for="spl-dropzone-file-input-3"]'),
      input: zone.shadowRoot!.querySelector('input[type="file"]') }]);
  });
});

describe('the steps', () => {
  it("the first page: Next (its spl-button's own button), not final; Experience and Education's Add never pressed", async () => {
    const { fixture, root } = await scanWith(2, smartRecruitersAdapter);
    const next = deepControl(fixture.doc, 'oc-button[data-test="footer-next"] spl-button >>> button')[0];
    expect(smartRecruitersAdapter.nextButton!(root)).toBe(next);
    expect(smartRecruitersAdapter.submitButton!(root)).toBeNull();
    expect(smartRecruitersAdapter.isFinalStep!(fixture.doc)).toBe('not-final');
    const never = smartRecruitersAdapter.neverPress!(root);
    for (const test of ['add-experience', 'add-education']) {
      expect(never).toContain(deepControl(fixture.doc, `oc-button[data-test="${test}"] spl-button >>> button`)[0]);
    }
    expect(never).not.toContain(next);
    expect(smartRecruitersAdapter.stepSignature!(fixture.doc)).toEqual({ urlPart: 'first', anchors: ['oc-oneclick-form'] });
  });

  it('the screening step: Submit, final; Back never pressed', async () => {
    const { fixture, root } = await scanWith(3, smartRecruitersAdapter);
    const submit = deepControl(fixture.doc, 'oc-button[data-test="footer-submit"] spl-button >>> button')[0];
    expect(smartRecruitersAdapter.submitButton!(root)).toBe(submit);
    expect(smartRecruitersAdapter.nextButton!(root)).toBeNull();
    expect(smartRecruitersAdapter.isFinalStep!(fixture.doc)).toBe('final');
    expect(smartRecruitersAdapter.neverPress!(root))
      .toContain(deepControl(fixture.doc, 'oc-button[data-test="footer-back"] spl-button >>> button')[0]);
    expect(smartRecruitersAdapter.stepSignature!(fixture.doc)).toEqual({ urlPart: 'screening', anchors: ['oc-screening-questions'] });
  });

  it('reads an error summary once it holds words, and none while it is empty (every snapshot)', async () => {
    const { fixture, root } = await scanWith(2, smartRecruitersAdapter);
    const summaries = deepAll(fixture.doc, 'ul[data-test="validation-summary"]');
    expect(summaries.length).toBe(2);
    expect(smartRecruitersAdapter.errors!(root).map((each) => each.el)).not.toContain(summaries[0]);
    const item = fixture.doc.createElement('li');
    item.textContent = 'x';
    summaries[0]!.append(item);
    expect(smartRecruitersAdapter.errors!(root).map((each) => each.el)).toContain(summaries[0]);
  });
});

describe("the agent's entry", () => {
  it("presses the posting's first visible \"I'm interested\", once, never its SmartR copy", async () => {
    const { html, address } = CASES[0];
    const fixture = await load(html, address);
    const pressed: Element[] = [];
    // Nothing navigates: a link's click is held, and the page's own scripts are gone from the snapshot.
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    });
    expect(await pressEntry(fixture.doc, [smartRecruitersAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([fixture.doc.querySelector('a.js-oneclick[data-sr-track-position="bottom"]')]);
  });

  it('offers none on an expired posting, nor on a link to another company', async () => {
    const expired = await load(CASES[1].html, CASES[1].address);
    expect(await pressEntry(expired.doc, [smartRecruitersAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'not-offered' });
    removeFixtures(document);
    const { fixture } = { fixture: await load(CASES[0].html, CASES[0].address) };
    for (const link of Array.from(fixture.doc.querySelectorAll('a.js-oneclick'))) {
      link.setAttribute('href', (link.getAttribute('href') ?? '').replace('/company/Xplor/', '/company/Other/'));
    }
    expect(smartRecruitersAdapter.entryControl!(fixture.doc)).toBeNull();
  });
});
