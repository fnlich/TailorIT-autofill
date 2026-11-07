/*
 * CareerPlug's configured adapter on the owner's snapshots (fixtures/careerplug: cloudscouts-form from careerplug-0, no
 * résumé yet; eitacies-uploaded from careerplug-1, a résumé in): the scan held against the hand-written expectations, and
 * each rule of ./config.ts held to what the page shows and read again with the rule undone: the uploads (their question,
 * their control, the file taken), the paste editors excluded, the EEO section, Submit, the never-pressed controls and
 * the posting text.
 * The State select's label[for] is drawn out of sight and its aria-label ("States") is not the words it shows ("State",
 * its prompt): core pass Z2 of 2026-11-06 reads a select's prompt as its visible placeholder (DOM-10: the aria-label
 * names it, the prompt makes it fillable; dom/labels.ts selectPrompt). It read no visible label until then.
 */
import { afterEach, describe, expect, it } from 'vitest';
import cloudExpect from '../../../fixtures/careerplug/cloudscouts-form.expect.json';
import cloudHtml from '../../../fixtures/careerplug/cloudscouts-form.html?raw';
import eitaciesExpect from '../../../fixtures/careerplug/eitacies-uploaded.expect.json';
import eitaciesHtml from '../../../fixtures/careerplug/eitacies-uploaded.html?raw';
import jazzHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { CAREERPLUG_CONFIG, careerPlugAdapter } from './index';

const CASES = [
  { name: 'cloudscouts-form', html: cloudHtml, expectation: readExpectation(cloudExpect) },
  { name: 'eitacies-uploaded', html: eitaciesHtml, expectation: readExpectation(eitaciesExpect) },
] as const;

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = CAREERPLUG_CONFIG;
  return configuredAdapter(rest);
}

async function open(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = careerPlugAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const read = (root: Element, adapter: typeof careerPlugAdapter) => scan(root, adapter, { platform: 'careerplug' }).fields;

afterEach(() => removeFixtures(document));

describe('the CareerPlug adapter: the snapshots against their expectations', () => {
  it.each(CASES)('$name: the scan matches the hand-written expectations', async ({ html, expectation }) => {
    const scanned = await scanCase(document, html, expectation.source);
    expect(scanned.adapter.id).toBe('careerplug');
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual([]);
  });

  it("names the State select by its aria-label, made visible by its prompt, before and after an answer (core pass Z2)",
    async () => {
      const page = await open(cloudHtml);
      const select = q<HTMLSelectElement>(page.doc, '#app_applicant_attributes_state');
      expect([select.options[0]!.value, select.options[0]!.text]).toEqual(['', 'State']);
      const state = () => read(page.root, careerPlugAdapter).find((field) => field.idAttr === 'app_applicant_attributes_state')!;
      expect([state().label, state().labelSource, state().labelVisible]).toEqual(['States', 'aria-label', true]);
      // Answered, the prompt stays in its list: the field keeps its name and its key.
      const key = state().key;
      select.selectedIndex = 5;
      expect([state().key, state().labelVisible]).toEqual([key, true]);
      // A select with no prompt (its first option an answer), or a prompt in other words, and the same aria-label has no
      // visible label: the aria-label is shown nowhere (DOM-11).
      select.options[0]!.value = 'XX';
      expect(state().labelVisible).toBe(false);
      select.options[0]!.value = '';
      select.options[0]!.text = 'Choose...';
      expect(state().labelVisible).toBe(false);
    });
});

describe('the CareerPlug adapter: each rule, and the page read without it', () => {
  it('takes form#new_app as the root, and none on another page', async () => {
    const page = await open(cloudHtml);
    expect(page.root.id).toBe('new_app');
    removeFixtures(document);
    const jazz = await loadFixture(document, jazzHtml, SNAPSHOT_VIEWPORT);
    expect(careerPlugAdapter.detect(jazz.doc)).toBeNull();
  });

  it('titles each upload by its question, its "Upload File" label its control; "Upload File" without the rules', async () => {
    const page = await open(cloudHtml);
    const resume = q<HTMLInputElement>(page.doc, '#app_has_attachments_attributes_0_attachment');
    expect(careerPlugAdapter.uploadWidgets?.(page.root)).toEqual([
      { control: q(page.doc, 'label[for="app_has_attachments_attributes_0_attachment"]'), input: resume },
      { control: q(page.doc, 'label[for="app_has_attachments_attributes_1_attachment"]'),
        input: q<HTMLInputElement>(page.doc, '#app_has_attachments_attributes_1_attachment') }]);
    const files = (adapter: typeof careerPlugAdapter) => read(page.root, adapter).filter((field) => field.kind === 'file')
      .map((field) => [field.label, field.required]);
    expect(files(careerPlugAdapter)).toEqual([['Resume/CV', true], ['Cover Letter', false]]);
    expect(files(without('uploads'))).toEqual([['Upload File', false], ['Upload File', false]]);
    // Without the title, the control still never labels its input: nothing names them.
    expect(files(without('questions'))).toEqual([['', false], ['', false]]);
  });

  it('reads the file taken from the result area, and an open upload area as none yet', async () => {
    const empty = await open(cloudHtml);
    const resume = q<HTMLInputElement>(empty.doc, '#app_has_attachments_attributes_0_attachment');
    expect(careerPlugAdapter.uploadState?.(resume, 'resume.pdf')).toBe('pending');
    removeFixtures(document);
    const taken = await open(eitaciesHtml);
    const kept = q<HTMLInputElement>(taken.doc, '#app_has_attachments_attributes_0_attachment');
    expect(careerPlugAdapter.uploadState?.(kept, 'resume.pdf')).toBe('confirmed');
    expect(careerPlugAdapter.uploadState?.(q<HTMLInputElement>(taken.doc, '#app_has_attachments_attributes_1_attachment'), 'x'))
      .toBe('pending');
    expect(without('uploads').uploadState?.(kept, 'resume.pdf')).toBeNull();
  });

  it('keeps an opened paste editor out of the fields; a field of its own without the rule', async () => {
    const page = await open(cloudHtml);
    q(page.doc, '#resume_text_input').classList.add('in');
    const pasted = (adapter: typeof careerPlugAdapter) => read(page.root, adapter)
      .some((field) => field.idAttr === 'app_applicant_attributes_resume_text');
    expect(pasted(careerPlugAdapter)).toBe(false);
    expect(pasted(without('excluded'))).toBe(true);
  });

  it('sections the EEO block by its title; the standard section without the rule', async () => {
    const page = await open(cloudHtml);
    const section = (adapter: typeof careerPlugAdapter) => read(page.root, adapter)
      .find((field) => field.label === 'Gender')?.section.id;
    expect(section(careerPlugAdapter)).toMatch(/^us-equal-opportunity-employment-information/);
    expect(section(without('sections'))).toBe('main');
  });

  it('names Submit, never the Indeed widget, Español, the shares, the logo, Remove file or the paste switches', async () => {
    const page = await open(cloudHtml);
    const submit = q(page.doc, 'form#new_app input[type="submit"][name="commit"]');
    expect(careerPlugAdapter.submitButton?.(page.root)).toBe(submit);
    expect(careerPlugAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(without('submit').submitButton?.(page.root)).toBeNull();
    const never = careerPlugAdapter.neverPress?.(page.root) ?? [];
    for (const css of ['div.indeed-apply-widget', 'a[href*="?loc=es"]', 'a[aria-label^="Share"]', 'a[href$="/account"]',
      'a.remove[aria-label="Remove file"]', 'a.paste-link']) {
      expect(never, css).toContain(q(page.doc, css));
    }
    expect(never).not.toContain(submit);
    expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
  });

  it('reads the posting text on the same page; none without the rule', async () => {
    const page = await open(cloudHtml);
    expect(careerPlugAdapter.postingText?.(page.doc)).toBe(q(page.doc, 'div.job-description-container'));
    expect(without('posting').postingText?.(page.doc)).toBeNull();
  });
});
