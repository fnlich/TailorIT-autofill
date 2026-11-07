/*
 * Breezy HR's configured adapter on the owner's snapshot (fixtures/breezy/concurrent-form, converted from breezy-0;
 * breezy-1 is the same page with every question answered): the scan held against the hand-written expectations, and each
 * rule of ./config.ts held to what the page shows and read again with the rule undone: the sections, the titles (the h3
 * before a control, Desired Salary's three controls, the consent's words, the EEO questions), the EEO groups' required,
 * the résumé's upload and its sign, Submit, the never-pressed controls, the errors and the confirmation drawn in place.
 * Pinned, not hidden: no visible words name the résumé in either snapshot, so it reads with no label.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formExpect from '../../../fixtures/breezy/concurrent-form.expect.json';
import formHtml from '../../../fixtures/breezy/concurrent-form.html?raw';
import jazzHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import { newSuccessSign, shownSignsOf, signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configuredAdapter, configuredSuccessSigns } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { BREEZY_CONFIG, breezyAdapter } from './index';

const EXPECTATION = readExpectation(formExpect);

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = BREEZY_CONFIG;
  return configuredAdapter(rest);
}

async function open() {
  const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
  const root = breezyAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const read = (root: Element, adapter: typeof breezyAdapter) => scan(root, adapter, { platform: 'breezy' }).fields;

afterEach(() => removeFixtures(document));

describe('the Breezy adapter: the snapshot against its expectations', () => {
  it('concurrent-form: the scan matches the hand-written expectations, but for the unnamed résumé', async () => {
    const scanned = await scanCase(document, formHtml, EXPECTATION.source);
    expect(scanned.adapter.id).toBe('breezy');
    expect(compareWithExpectation(scanned.doc, scanned.result, EXPECTATION)).toEqual([{ control: 'input#main-attachment',
      property: 'fillable', expected: 'fillable', actual: 'not fillable (no-visible-label), as a file' }]);
  });
});

describe('the Breezy adapter: each rule, and the page read without it', () => {
  it('takes form[name=form] as the root whatever its validity classes, and none on another page', async () => {
    const page = await open();
    expect(page.root.getAttribute('name')).toBe('form');
    expect(page.root.classList.contains('ng-invalid')).toBe(true);
    removeFixtures(document);
    const jazz = await loadFixture(document, jazzHtml, SNAPSHOT_VIEWPORT);
    expect(breezyAdapter.detect(jazz.doc)).toBeNull();
  });

  it('sections the fields by their section headers; by each question\'s h3 without the rule', async () => {
    const page = await open();
    const sections = (adapter: typeof breezyAdapter) => [...new Set(read(page.root, adapter).map((field) => field.section.id))];
    expect(sections(breezyAdapter)).toEqual(['main', 'personal-details', 'cover-letter', 'were-an-equal-opportunity-employer']);
    expect(sections(without('sections'))).toContain('full-name');
  });

  it('titles every control as the page shows it; placeholders and nothing without the rules', async () => {
    const page = await open();
    const titled = read(page.root, breezyAdapter).map((field) => [field.label, field.labelSource]);
    expect(titled).toContainEqual(['Full Name', 'adapter']);
    expect(titled).toContainEqual(['Cover Letter', 'adapter']);
    expect(titled).toContainEqual(['Veteran status', 'adapter']);
    expect(titled).toContainEqual(['Desired Salary currency', 'adapter']);
    expect(titled).toContainEqual(['Desired Salary period', 'adapter']);
    const plain = read(page.root, without('questions')).map((field) => [field.label, field.labelSource]);
    expect(plain).toContainEqual(['Full Name', 'placeholder']);
    expect(plain.filter(([, source]) => source === 'none')).toHaveLength(8);
    // Without the suffix the two salary selects read alike.
    const alike = read(page.root, without('code')).filter((field) => field.kind === 'select').map((field) => field.label);
    expect(alike).toEqual(['Desired Salary', 'Desired Salary']);
  });

  it('requires each EEO group by its ng-required, answered or not; only the unanswered Veteran without the rule', async () => {
    const page = await open();
    const groups = (adapter: typeof breezyAdapter) => read(page.root, adapter).filter((field) => field.kind === 'radio')
      .map((field) => [field.label, field.required]);
    expect(groups(breezyAdapter)).toEqual([['Race or Ethnicity', true], ['Gender', true], ['Veteran status', true]]);
    expect(groups(without('required'))).toEqual([['Race or Ethnicity', false], ['Gender', false],
      ['Veteran status', true]]);
  });

  it("pairs the hidden résumé input with its opener elsewhere and reads the file's link as the file taken", async () => {
    const page = await open();
    const input = q<HTMLInputElement>(page.doc, 'input#main-attachment');
    const opener = q(page.doc, 'ul.apply-buttons a.button.resume');
    const link = q(page.doc, 'a.bzyLinkColor[ng-if="candidate.resume.file_name"]');
    // The résumé's own area (the input's div.file-input-container) holds no opener: it is found from the form.
    expect(breezyAdapter.uploadWidgets?.(page.root)).toEqual([{ control: opener, input }]);
    // The behaviour review (M2): the file's link is a file the page holds; it confirms only the file it names.
    expect(breezyAdapter.uploadHeld?.(input)).toBe(true);
    expect(breezyAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    link.lastElementChild!.textContent = 'resume.pdf';
    expect(breezyAdapter.uploadState?.(input, 'resume.pdf')).toBe('confirmed');
    // A file link elsewhere in the form, outside the résumé's own container, is not the résumé's: it neither holds nor
    // confirms it.
    const stray = link.cloneNode(true) as Element;
    stray.lastElementChild!.textContent = 'resume.pdf';
    opener.after(stray);
    // The opener's grey "Attached" is outside the résumé's area: never a sign of its own (a stray one confirms nothing).
    link.remove();
    expect(opener.classList.contains('gray')).toBe(true);
    expect(breezyAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    expect(breezyAdapter.uploadHeld?.(input)).toBe(false);
    expect(without('uploads').uploadState?.(input, 'resume.pdf')).toBeNull();
    expect(read(page.root, without('uploads')).some((field) => field.kind === 'file')).toBe(false);
  });

  it('M2: reads the held résumé as a file in the scan, so no second upload is planned', async () => {
    const page = await open();
    const input = q<HTMLInputElement>(page.doc, 'input#main-attachment');
    const resume = scan(page.root, breezyAdapter, { platform: 'breezy' }).fields.find((field) => field.kind === 'file');
    expect(resume?.current).toEqual({ kind: 'files', count: 1, held: true });
    expect(input.files?.length ?? 0).toBe(0);
  });

  it('names Submit Application, final while it shows; none without the rule', async () => {
    const page = await open();
    const submit = q(page.doc, 'form[name="form"] button[type="submit"].bzyButtonColor');
    expect(breezyAdapter.submitButton?.(page.root)).toBe(submit);
    expect(breezyAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(without('submit').submitButton?.(page.root)).toBeNull();
  });

  it('never presses Indeed, LinkedIn, the résumé\'s opener and link, the breadcrumb or the brand', async () => {
    const page = await open();
    const never = breezyAdapter.neverPress?.(page.root) ?? [];
    for (const css of ['a.button.indeed', 'a.button.linkedin', 'ul.apply-buttons a.button.resume',
      'a.bzyLinkColor[ng-if="candidate.resume.file_name"]', 'ul.breadcrumbs a', 'a.brand']) {
      expect(never, css).toContain(q(page.doc, css));
    }
    expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
  });

  it('reads an error the page shows, and none while every one is hidden', async () => {
    const page = await open();
    expect(breezyAdapter.errors?.(page.root)).toEqual([]);
    const required = q(page.doc, 'span[ng-show="form.cName.$error.required"]');
    required.classList.remove('ng-hide');
    required.parentElement!.classList.remove('ng-hide');
    expect(breezyAdapter.errors?.(page.root).map((error) => error.el)).toEqual([required]);
    expect(without('errors').errors?.(page.root)).toEqual([]);
  });

  it('gives content/submitted.ts the confirmation drawn in place of the form, once the form is gone', async () => {
    const page = await open();
    const confirmed = q(page.doc, 'div.confirmation-container .application-confirmed');
    // Hidden (ng-hide) in the snapshot: no sign shows yet (the behaviour review of 2026-11-06, M1).
    expect(configuredSuccessSigns(page.doc, BREEZY_CONFIG)).toEqual([]);
    // Armed as the runtime arms a press (M1): the signs shown at the press.
    const before = shownSignsOf(page.doc, 'breezy');
    expect(before.size).toBe(0);
    expect(newSuccessSign(page.doc, 'breezy', { before, root: page.root, adapter: breezyAdapter })).toBeNull();
    // What `applied` does: the form's wrappers hide, the confirmation shows.
    page.doc.querySelectorAll('[ng-show="!applied"]').forEach((el) => el.classList.add('ng-hide'));
    q(page.doc, 'div.confirmation-container').classList.remove('ng-hide');
    expect(configuredSuccessSigns(page.doc, BREEZY_CONFIG)).toEqual([confirmed]);
    expect(newSuccessSign(page.doc, 'breezy', { before, root: page.root, adapter: breezyAdapter })).toBe(confirmed);
    expect(configuredSuccessSigns(page.doc, { ...BREEZY_CONFIG, success: undefined })).toEqual([]);
  });

  it('M1: a press armed with every sign signsOf reads (the runtime before its own filter) still sees the confirmation as new', async () => {
    const page = await open();
    // signsOf itself answers the shown signs only, so even an arm that takes them all leaves the hidden one out.
    const before = new Set(signsOf(page.doc, 'breezy'));
    page.doc.querySelectorAll('[ng-show="!applied"]').forEach((el) => el.classList.add('ng-hide'));
    q(page.doc, 'div.confirmation-container').classList.remove('ng-hide');
    expect(newSuccessSign(page.doc, 'breezy', { before, root: page.root, adapter: breezyAdapter }))
      .toBe(q(page.doc, 'div.confirmation-container .application-confirmed'));
  });
});
