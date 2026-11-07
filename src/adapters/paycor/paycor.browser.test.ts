/*
 * Paycor Recruiting's configured adapter on the owner's snapshot (fixtures/paycor/regard-form, converted from paycor-0,
 * a résumé already in): the scan held against the hand-written expectations, and each rule of ./config.ts held to what
 * the page shows and read again with the rule undone: the root over both forms, the titles of the comments, privacy and
 * résumé questions, the résumé's star, its upload and the page's signs of it, Submit, the busy signs and the
 * never-pressed controls. The résumé's empty state (its drop box shown, its file bar hidden: the page's own two states,
 * #resumeDrop and #resumeDropped, both in the markup) is read by showing one and hiding the other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formExpect from '../../../fixtures/paycor/regard-form.expect.json';
import formHtml from '../../../fixtures/paycor/regard-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { PAYCOR_CONFIG, paycorAdapter } from './index';

const EXPECTATION = readExpectation(formExpect);

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = PAYCOR_CONFIG;
  return configuredAdapter(rest);
}

async function open() {
  const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
  const root = paycorAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;
const read = (root: Element, adapter: typeof paycorAdapter) => scan(root, adapter, { platform: 'paycor' }).fields;
/** The résumé's drop box shown and its file bar hidden: the page before a file is in. */
function beforeUpload(doc: Document): void {
  q(doc, '#resumeDrop').style.display = 'block';
  q(doc, '#resumeDropped').style.display = 'none';
}

afterEach(() => removeFixtures(document));

describe('the Paycor adapter: the snapshot against its expectations', () => {
  it('regard-form: the scan matches the hand-written expectations', async () => {
    const scanned = await scanCase(document, formHtml, EXPECTATION.source);
    expect(scanned.adapter.id).toBe('paycor');
    expect(compareWithExpectation(scanned.doc, scanned.result, EXPECTATION)).toEqual([]);
  });
});

describe('the Paycor adapter: each rule, and the page read without it', () => {
  it('takes the container of both forms as the root, which the résumé\'s form alone does not hold', async () => {
    const page = await open();
    expect(page.root.matches('div.gnewtonSubmitResume')).toBe(true);
    expect(page.root.contains(q(page.doc, 'form#uploadResume'))).toBe(true);
    expect(page.root.contains(q(page.doc, 'form#gnewtonForm'))).toBe(true);
    expect(configuredAdapter({ ...PAYCOR_CONFIG, root: { css: 'div.gnewtonSubmitResume', holds: 'form#elsewhere', from: 'none' } })
      .detect(page.doc)).toBeNull();
  });

  it('titles the comments by their section, the privacy box by its label with its statement; nothing without the rule', async () => {
    const page = await open();
    const pick = (adapter: typeof paycorAdapter) => read(page.root, adapter)
      .filter((field) => ['textarea', 'checkbox'].includes(field.kind))
      .map((field) => [field.kind, field.label, field.description.slice(0, 40)]);
    expect(pick(paycorAdapter)).toEqual([['textarea', 'Comments', ''],
      ['checkbox', 'Acceptance', 'By checking this box, you acknowledge an']]);
    expect(pick(without('questions'))).toEqual([['textarea', '', ''], ['checkbox', '', '']]);
  });

  it('reads the résumé before upload: its control, its title and its star; its control words without the rules', async () => {
    const page = await open();
    beforeUpload(page.doc);
    const input = q<HTMLInputElement>(page.doc, 'input#uploadResumeInput');
    expect(paycorAdapter.uploadWidgets?.(page.root)).toEqual([{ control: q(page.doc, 'label#resumeDropLocalFile'), input }]);
    const files = (adapter: typeof paycorAdapter) => read(page.root, adapter).filter((field) => field.kind === 'file')
      .map((field) => [field.label, field.required]);
    expect(files(paycorAdapter)).toEqual([['Apply with a Resume', true]]);
    expect(files(without('required'))).toEqual([['Apply with a Resume', false]]);
    // Without the upload, its control's own words ("Choose a File") name it.
    expect(files(without('uploads'))).toEqual([['Choose a File', true]]);
  });

  it('reads the page\'s upload signs: uploading, the file\'s bar, a file too large', async () => {
    const page = await open();
    const input = q<HTMLInputElement>(page.doc, 'input#uploadResumeInput');
    // The behaviour review (M2): the file's bar confirms only the file it names (span.filename), and holds a file
    // (uploadHeld) while the input itself holds none.
    expect(paycorAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    expect(paycorAdapter.uploadHeld?.(input)).toBe(true);
    q(page.doc, '#resumeDropped span.filename').textContent = 'resume.pdf';
    expect(paycorAdapter.uploadState?.(input, 'resume.pdf')).toBe('confirmed');
    q(page.doc, '#resumeDropped').style.display = 'none';
    expect(paycorAdapter.uploadHeld?.(input)).toBe(false);
    q(page.doc, '#resumeDropped').style.display = '';
    q(page.doc, '#resumeDropping').style.display = 'block';
    expect(paycorAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    expect(paycorAdapter.isBusy?.(page.doc)).toBe(true);
    expect(without('busy').isBusy?.(page.doc)).toBe(false);
    q(page.doc, '#fileUploadErrorMessage').style.display = 'block';
    expect(paycorAdapter.uploadState?.(input, 'resume.pdf')).toBe('failed');
    expect(without('uploads').uploadState?.(input, 'resume.pdf')).toBeNull();
  });

  it('names Submit, busy while its spinner shows; none without the rules', async () => {
    const page = await open();
    const submit = q(page.doc, 'button[ns-qa="submitBtn"]');
    expect(paycorAdapter.submitButton?.(page.root)).toBe(submit);
    expect(paycorAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(paycorAdapter.isBusy?.(page.doc)).toBe(false);
    q(page.doc, '#submitSpinner').style.display = 'inline';
    expect(paycorAdapter.isBusy?.(page.doc)).toBe(true);
    expect(without('submit').submitButton?.(page.root)).toBeNull();
  });

  it('never presses Clear All Fields, the drives, remove, the job list, the popover or the logo', async () => {
    const page = await open();
    const never = paycorAdapter.neverPress?.(page.root) ?? [];
    for (const css of ['div.button.newtonStoreReset', '#google_drive_button', '#dropbox_button', '#resumeDropped a.closeBtn',
      '#gnewtonBackToHome a', '.ns-popover-go-to-job', '.ns-popover-cancel-button', '#gnewtonLogo a']) {
      expect(never, css).toContain(q(page.doc, css));
    }
    expect(never).not.toContain(q(page.doc, 'button[ns-qa="submitBtn"]'));
    expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
  });
});
