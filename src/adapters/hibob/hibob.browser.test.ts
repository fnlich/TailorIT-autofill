/*
 * HiBob's configured adapter on the owner's snapshot (fixtures/hibob/mplc-form, converted from hibob-0): the scan held
 * against the hand-written expectations, and each rule of ./config.ts held to what the page shows and read again with
 * the rule undone: the root over four forms, the Country dropdown, the Yes/No question's title and its
 * drawn choice, the consent's aria-checked, required by the host and by the title, Apply outside every form, and the
 * never-pressed controls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formExpect from '../../../fixtures/hibob/mplc-form.expect.json';
import formHtml from '../../../fixtures/hibob/mplc-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { HIBOB_CONFIG, hiBobAdapter } from './index';

const EXPECTATION = readExpectation(formExpect);

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = HIBOB_CONFIG;
  return configuredAdapter(rest);
}

async function open() {
  const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
  const root = hiBobAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const read = (root: Element, adapter: typeof hiBobAdapter) => scan(root, adapter, { platform: 'hibob' }).fields;

afterEach(() => removeFixtures(document));

describe('the HiBob adapter: the snapshot against its expectations', () => {
  it('mplc-form: the scan matches the hand-written expectations', async () => {
    const scanned = await scanCase(document, formHtml, EXPECTATION.source);
    expect(scanned.adapter.id).toBe('hibob');
    expect(compareWithExpectation(scanned.doc, scanned.result, EXPECTATION)).toEqual([]);
  });
});

describe('the HiBob adapter: each rule, and the page read without it', () => {
  it('takes the application element over its four forms; a form root alone holds one section', async () => {
    const page = await open();
    expect(page.root.localName).toBe('careers-ui-job-ad-application-form');
    expect(page.root.querySelectorAll('form').length).toBe(4);
    expect(page.root.contains(q(page.doc, 'button#apply-to-job-btn'))).toBe(true);
    const firstForm = q(page.doc, 'form.form-root');
    expect(scan(firstForm, hiBobAdapter, { platform: 'hibob' }).fields.map((field) => field.label))
      .not.toContain('Are you based in the United States?');
  });

  it('leaves the sections to the standard reading: each collapsible section title, a role=heading', async () => {
    const page = await open();
    const sections = read(page.root, hiBobAdapter).map((field) => field.section.id);
    expect([...new Set(sections)]).toEqual(['personal-information', 'questionnaire']);
  });

  it('declares the Country dropdown, required by its host; no field without the rule', async () => {
    const page = await open();
    const opener = q(page.doc, 'b-single-select div[role="button"][aria-haspopup="true"]');
    expect(hiBobAdapter.widgetFor?.(opener)).toMatchObject({ kind: 'combobox', opener, expanded: opener, snapshot: 'hibob-0' });
    const country = (adapter: typeof hiBobAdapter) => read(page.root, adapter).filter((field) => field.label === 'Country')
      .map((field) => [field.kind, field.required, field.options]);
    expect(country(hiBobAdapter)).toEqual([['combobox', true, 'lazy']]);
    expect(country(without('widgets'))).toEqual([]);
    expect(country(without('required'))).toEqual([['combobox', false, 'lazy']]);
  });

  it('titles the Yes/No question by its div.label, required by its class; nothing names it without the rule', async () => {
    const page = await open();
    const question = (adapter: typeof hiBobAdapter) => read(page.root, adapter).filter((field) => field.kind === 'radio')
      .map((field) => [field.label, field.required]);
    expect(question(hiBobAdapter)).toEqual([['Are you based in the United States?', true]]);
    expect(question(without('questions'))).toEqual([['', false]]);
    expect(question(without('required'))).toEqual([['Are you based in the United States?', false]]);
  });

  it('reads the drawn choices: the Yes/No wrapper\'s selected, the consent\'s aria-checked; neither without the rule',
    async () => {
      const page = await open();
      const yes = q<HTMLInputElement>(page.doc, 'input.brd-input[value="66476476"]');
      const no = q<HTMLInputElement>(page.doc, 'input.brd-input[value="66476477"]');
      const consent = q<HTMLInputElement>(page.doc, 'input#initialConsent');
      const states = () => [hiBobAdapter.checkedOf?.(yes), hiBobAdapter.checkedOf?.(no), hiBobAdapter.checkedOf?.(consent)];
      const chosen = (adapter: typeof hiBobAdapter) => read(page.root, adapter).flatMap((field) => (field.kind === 'radio'
        && Array.isArray(field.options) ? field.options.map((option) => option.selected) : []));
      // The fixture holds none of the applicant's choices (the converter clears them: core pass Z1, item 36).
      expect(states()).toEqual([false, false, false]);
      // The test draws the choices itself on its own copy, as hibob-0 drew them: the chosen radio's wrapper and label
      // class "selected", the ticked consent's aria-checked="true".
      yes.parentElement!.classList.add('selected');
      q(page.doc, `label[for="${yes.id}"]`).classList.add('selected');
      consent.setAttribute('aria-checked', 'true');
      expect(states()).toEqual([true, false, true]);
      expect(chosen(hiBobAdapter)).toEqual([true, false]);
      expect(chosen(without('checked'))).toEqual([false, false]);
    });

  it('names Apply outside every form, never Back, Overview, the menu, Delete, a chip\'s remove, Add or the privacy link',
    async () => {
      const page = await open();
      const apply = q(page.doc, 'button#apply-to-job-btn');
      expect(apply.closest('form')).toBeNull();
      expect(hiBobAdapter.submitButton?.(page.root)).toBe(apply);
      expect(hiBobAdapter.isFinalStep?.(page.doc)).toBe('final');
      expect(without('submit').submitButton?.(page.root)).toBeNull();
      const never = hiBobAdapter.neverPress?.(page.root) ?? [];
      for (const css of ['b-back-button button', 'a[role="tab"].overview', 'b-round-button.menu-button button',
        'button#bf-delete-btn', 'b-chip [role="button"].remove-button', 'button[data-testid="addButton"]',
        'careers-ui-experience-display-item button[aria-label="Menu"]', 'careers-ui-privacy-policy a']) {
        expect(never, css).toContain(q(page.doc, css));
      }
      expect(never).not.toContain(apply);
      expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
    });
});
