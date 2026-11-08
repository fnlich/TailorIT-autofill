/*
 * BambooHR's configured adapter on the owner's snapshot (fixtures/bamboohr/swyfft-form, converted from bamboohr-2; -0 and
 * -1 show the same markup filled): the scan held against the hand-written expectations, and each rule of ./config.ts
 * held to what the page shows and read again with the rule undone: the root, required by the label's Mui-required, the
 * Fabric dropdowns' widget and title, Submit outside the form, and the never-pressed controls.
 * LinkedIn URL shares its bordered wrapper with a start adornment (an icon), which core pass Z2 of 2026-11-06 reads as
 * its box (dom/camouflage.ts drawnByWrapper); it read camouflaged until then, pinned here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formExpect from '../../../fixtures/bamboohr/swyfft-form.expect.json';
import formHtml from '../../../fixtures/bamboohr/swyfft-form.html?raw';
import jazzHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause, pageChallenged } from '../../dom/pause-detect';
import { pressStep } from '../../content/press';
import { scan } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { BAMBOOHR_CONFIG, bambooHrAdapter } from './index';

const EXPECTATION = readExpectation(formExpect);

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = BAMBOOHR_CONFIG;
  return configuredAdapter(rest);
}

async function open() {
  const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
  const root = bambooHrAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const all = (doc: Document, css: string) => Array.from(doc.querySelectorAll(css));

afterEach(() => removeFixtures(document));

describe('the BambooHR adapter: the snapshot against its expectations', () => {
  it('swyfft-form: the scan matches the hand-written expectations', async () => {
    const scanned = await scanCase(document, formHtml, EXPECTATION.source);
    expect(scanned.adapter.id).toBe('bamboohr');
    expect(compareWithExpectation(scanned.doc, scanned.result, EXPECTATION)).toEqual([]);
  });
});

describe('the BambooHR adapter: each rule, and the page read without it', () => {
  it('takes form#job-application-form as the root, and finds none on another platform\'s page', async () => {
    const page = await open();
    expect(page.root.matches('form#job-application-form')).toBe(true);
    removeFixtures(document);
    const jazz = await loadFixture(document, jazzHtml, SNAPSHOT_VIEWPORT);
    expect(bambooHrAdapter.detect(jazz.doc)).toBeNull();
  });

  it('reads required from the label\'s Mui-required, the star being aria-hidden; nothing required without the rule', async () => {
    const page = await open();
    const required = (adapter: typeof bambooHrAdapter) => scan(page.root, adapter, { platform: 'bamboohr' }).fields
      .filter((field) => field.kind === 'text').map((field) => [field.label, field.required]);
    expect(required(bambooHrAdapter).filter(([, req]) => !req)).toEqual([]);
    expect(required(without('required')).filter(([, req]) => req)).toEqual([]);
  });

  it('declares each Fabric dropdown a combobox opened by its toggle, titled and required by its wrapper\'s label', async () => {
    const page = await open();
    const state = q(page.doc, 'div.fab-Select:has(> select[name="state.value"])');
    expect(bambooHrAdapter.widgetRoots?.(page.root)).toHaveLength(5);
    expect(bambooHrAdapter.widgetFor?.(state)).toMatchObject({ kind: 'combobox',
      opener: q(page.doc, 'button.fab-SelectToggle[data-menu-id="fab-menu66"]'),
      expanded: q(page.doc, 'button.fab-SelectToggle[data-menu-id="fab-menu66"]'),
      parts: [q(page.doc, 'select[name="state.value"]')], snapshot: 'bamboohr-0 to -2' });
    const fields = (adapter: typeof bambooHrAdapter) => scan(page.root, adapter, { platform: 'bamboohr' }).fields
      .filter((field) => field.kind === 'combobox').map((field) => [field.label, field.required, field.options]);
    expect(fields(bambooHrAdapter)).toEqual([['State', true, 'lazy'], ['Country', true, 'lazy'],
      ['Highest Education Obtained', true, 'lazy'], ['Gender', false, 'lazy'], ['Ethnicity', false, 'lazy']]);
    // Without the widget, the dropdowns are no field at all (their native select is hidden and holds one option).
    expect(fields(without('widgets'))).toEqual([]);
    // Without the title, nothing names them.
    expect(fields(without('questions')).map(([label]) => label)).toEqual(['', '', '', '', '']);
  });

  it('names Submit outside the form by its form attribute, never Cancel; none without the rule', async () => {
    const page = await open();
    const submit = q(page.doc, 'button[type="submit"][form="job-application-form"]');
    expect(page.root.contains(submit)).toBe(false);
    expect(bambooHrAdapter.submitButton?.(page.root)).toBe(submit);
    expect(submit.textContent).toContain('Submit Application');
    expect(bambooHrAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(without('submit').submitButton?.(page.root)).toBeNull();
    expect(without('submit').isFinalStep?.(page.doc)).toBe('unknown');
  });

  it('never presses Cancel, the description, the shares, the slidedown, the file\'s remove, Clear Selection, the picker or the links',
    async () => {
      const page = await open();
      const never = bambooHrAdapter.neverPress?.(page.root) ?? [];
      const cancel = q(page.doc, '[data-fabric-component="ActionFooter"] button[data-fabric-component="TextButton"]');
      expect(cancel.textContent).toContain('Cancel');
      const expected = [cancel, q(page.doc, 'button[data-bi-id="careers-site-view-description-button"]'),
        ...all(page.doc, 'button[aria-label^="Share "]'), q(page.doc, 'button[aria-label="Dismiss slidedown"]'),
        q(page.doc, 'button[aria-label="remove file"]'), ...all(page.doc, 'button[aria-label="Clear Selection"]'),
        q(page.doc, '[data-fabric-component="DatePicker"] button[aria-haspopup="dialog"]'),
        ...all(page.doc, 'a[data-fabric-component="TextButton"]')];
      expect(expected).toHaveLength(13);
      for (const el of expected) expect(never).toContain(el);
      expect(never).not.toContain(bambooHrAdapter.submitButton?.(page.root));
      expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
    });

  // The behaviour review of 2026-11-06 (M6, the owner's decision): a checkbox widget holds every press, never the fill.
  // v5 p1-rules (PLAN decision 9, like Jobright): the unticked checkbox no longer holds the Submit: BambooHR decides.
  it('fills beside the reCAPTCHA, whose solving is the person’s, and presses the Submit beside it', async () => {
    const page = await open();
    expect(detectPause(page.doc, page.root, bambooHrAdapter)).toBeNull();
    expect(pageChallenged(page.doc)).toBe(false);
    const submit = bambooHrAdapter.submitButton!(page.root)!;
    let clicks = 0;
    submit.addEventListener('click', (event) => {
      clicks += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    const press = { doc: page.doc, adapter: bambooHrAdapter, root: page.root,
      scan: () => scan(page.root, bambooHrAdapter, { platform: 'bamboohr' }) };
    expect(pressStep(press, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(clicks).toBe(1);
    expect(scan(page.root, bambooHrAdapter, { platform: 'bamboohr' }).fields
      .some((field) => field.nameAttr === 'g-recaptcha-response')).toBe(false);
    // Solved by the person (its token in the vendor's field): pressed as well; the widget is never touched.
    q<HTMLTextAreaElement>(page.doc, 'textarea[name="g-recaptcha-response"]').value = '03AFcWeA-token';
    expect(pageChallenged(page.doc)).toBe(false);
    expect(pressStep(press, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(clicks).toBe(2);
  });
});
