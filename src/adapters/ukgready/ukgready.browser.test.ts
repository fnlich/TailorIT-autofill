/*
 * The UKG Ready adapter on the owner's snapshot7 [secure7.saashr.com] (fixtures/ukgready/jr7-saashr-*: one application,
 * posting to confirmation; jr7 FIX7PLAN §6.14, P1): each hook held to what the page shows, case by case. The roots (the
 * start form; the app container around the step body and its portaled dialogs; none on the posting, the choice and the
 * confirmation), the entry (Apply, then "Type it in myself"), the steps (Continue, a Contact editor's Save, "Almost
 * There!"'s OK declared through stepSubmitNext, then "Sign & submit application" and the consent's "I Agree", never a
 * Next), the step signature of every dialog round, the success sign, the uploads and "Upload Complete"'s Cancel, the
 * repeatables and their saved entries, Contact's editor openers, the exclusions (the SSN box, the Security Question, the
 * reference editor, the header, the review's summary), the labels and sections of FIX7PLAN §3.3. The scans read text
 * boxes alone where ENGINE-7's UKGR-5/6/7 are not merged (selects at opacity 0 and boxes below the inner scroller are
 * hidden at jr7-engine-e0); P2 asserts the filled outcomes. Facts only: the fixtures' personal text is REDACTED, and
 * nothing here reads a value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { deadline } from '../../dom/time';
import type { ScanResult } from '../../dom/types';
import { signsOf } from '../../content/submitted';
import { configProblems, configuredAdapter } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import type { AtsConfig } from '../configured/types';
import { successSignsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { UKGREADY_CASES } from './config';
import { UKGREADY_CONFIG, UKGREADY_SNAPSHOTS, ukgReadyAdapter } from './index';

/** Each case's page, loaded when a test opens it (21 pages, about 6 MB). */
const HTML = import.meta.glob('../../../fixtures/ukgready/*.html', { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;
type CaseName = (typeof UKGREADY_CASES)[number];

afterEach(() => removeFixtures(document));

/** A case loaded at the snapshot's viewport, its entrance animations ended (the alerts fade in over 200 ms; "Saving"'s
 *  bar never ends its own, so the wait is capped). */
async function open(name: CaseName): Promise<Document> {
  const load = HTML[`../../../fixtures/ukgready/${name}.html`];
  if (load === undefined) throw new Error(`no fixture ${name}`);
  const { doc } = await loadFixture(document, await load(), SNAPSHOT_VIEWPORT);
  const finite = doc.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
    deadline(3_000)]);
  return doc;
}

/** An element's words on one line, or null. */
const words = (el: Element | null | undefined) => (el == null ? null : (el.textContent ?? '').replace(/\s+/g, ' ').trim());

/** The adapter built from the config with `code` changed (a hook undone). */
const variant = (code: Partial<NonNullable<AtsConfig['code']>>, rules: Partial<AtsConfig> = {}): Adapter =>
  configuredAdapter({ ...UKGREADY_CONFIG, ...rules, code: { ...UKGREADY_CONFIG.code, ...code } });

/** The scan of a case's root. */
function scanOf(doc: Document, adapter: Adapter = ukgReadyAdapter): ScanResult {
  return scan(adapter.detect(doc)!.formRoot, adapter, { platform: 'ukgready' });
}

/** The scanned field whose control is `el`, its label, kind, section and block. */
function fieldOf(result: ScanResult, el: Element | null) {
  const field = result.fields.find((each) => {
    const target = result.target(each.key);
    return target !== null && (target.control === el || target.members.includes(el as HTMLInputElement));
  });
  return field === undefined ? null
    : { label: field.label, kind: field.kind, section: field.section.id, block: field.section.block ?? null };
}

/** What a root is, by name. */
function rootName(doc: Document, adapter: Adapter = ukgReadyAdapter): string {
  const root = adapter.detect(doc)?.formRoot ?? null;
  if (root === null) return 'none';
  if (root.matches('div#_app')) return 'app';
  return root.matches('.c-type-it-myself-container form') ? 'start' : root.localName;
}

describe('the UKG Ready adapter: its config and cases', () => {
  it('names each of the 21 cases it was written from, and its config is sound and registered', () => {
    expect([...UKGREADY_SNAPSHOTS].sort()).toEqual(Object.keys(HTML).map((path) => path.replace('../../../', '')).sort());
    expect(UKGREADY_SNAPSHOTS).toHaveLength(21);
    expect(configProblems(UKGREADY_CONFIG)).toEqual([]);
    expect(ATS_CONFIGS.ukgready).toBe(UKGREADY_CONFIG);
    expect(ukgReadyAdapter.quirks).toEqual({ formLateMs: 30_000, formInPlace: true, formAtPosting: true, entryPresses: 2 });
  });
});

describe('roots and the entry (UKGR-4, UKGR-11, UKGR-21, UKGR-V1)', () => {
  it('reads the start form, then the app container on every session step and dialog, and none elsewhere', async () => {
    const seen: Record<string, string> = {};
    for (const name of UKGREADY_CASES) {
      seen[name] = rootName(await open(name));
      removeFixtures(document);
    }
    const app = UKGREADY_CASES.filter((name) => !['jr7-saashr-posting', 'jr7-saashr-choice', 'jr7-saashr-start-filled',
      'jr7-saashr-confirmation'].includes(name));
    expect(seen).toEqual({ 'jr7-saashr-posting': 'none', 'jr7-saashr-choice': 'none', 'jr7-saashr-start-filled': 'start',
      'jr7-saashr-confirmation': 'none', ...Object.fromEntries(app.map((name) => [name, 'app'])) });
  });

  it('presses Apply on the posting, then "Type it in myself" on the choice drawn in place; never Use my resume or Log in',
    async () => {
      const posting = await open('jr7-saashr-posting');
      const apply = ukgReadyAdapter.entryControl!(posting);
      expect([words(apply), apply?.getAttribute('title')]).toEqual(['Apply', 'Apply']);
      expect(ukgReadyAdapter.authState!(posting)).toBeNull();
      const never = ukgReadyAdapter.neverPress!(posting.body);
      expect(never.map(words)).toContain('Show All Jobs');
      expect(ukgReadyAdapter.entryNeverPressed).toBe(true);
      expect(words(ukgReadyAdapter.postingText!(posting))?.length).toBeGreaterThan(0);
      removeFixtures(document);
      const choice = await open('jr7-saashr-choice');
      expect(ukgReadyAdapter.authState!(choice)).toBe('entry-choice');
      expect(words(ukgReadyAdapter.entryControl!(choice))).toBe('Type it in myself');
      expect(ukgReadyAdapter.detect(choice)).toBeNull();
      const choiceNever = ukgReadyAdapter.neverPress!(choice.body).map(words);
      expect(choiceNever).toEqual(expect.arrayContaining(['Use my resume', 'Log in']));
      removeFixtures(document);
      // The start form is the first step: no entry is left there.
      expect(ukgReadyAdapter.entryControl!(await open('jr7-saashr-start-filled'))).toBeNull();
      removeFixtures(document);
      expect(ukgReadyAdapter.entryControl!(await open('jr7-saashr-contact'))).toBeNull();
    });
});

describe('the steps and the two Submits (UKGR-8, UKGR-V4)', () => {
  it('reads Next and Submit on every case: Continue, a Contact editor\'s Save, "Almost There!"\'s OK, Sign & submit, I Agree',
    async () => {
      const seen: Record<string, [string | undefined, string | null, string | null, string | null]> = {};
      for (const name of UKGREADY_CASES) {
        const doc = await open(name);
        const root = ukgReadyAdapter.detect(doc)?.formRoot ?? doc.body;
        const next = ukgReadyAdapter.nextButton!(root);
        const submit = ukgReadyAdapter.submitButton!(root);
        seen[name] = [ukgReadyAdapter.isFinalStep!(doc), words(next), next?.dataset.trackingId ?? null,
          submit?.dataset.trackingId === undefined ? null : words(submit)];
        removeFixtures(document);
      }
      const CONTINUE = '4e4551c6-96b8-432e-ab2b-d76869a117f0';
      const SAVE = '4cf21393-3a80-4a94-ac97-1474564c688f';
      const step = ['not-final', 'Continue', CONTINUE, null];
      const SIGN = 'Sign & submit application';
      expect(seen).toEqual({
        'jr7-saashr-posting': ['unknown', null, null, null],
        'jr7-saashr-choice': ['unknown', null, null, null],
        'jr7-saashr-start-filled': ['not-final', 'Continue', 'd7c52fbf-94be-4da2-81eb-3f75f5ec4e74', null],
        'jr7-saashr-contact': ['not-final', 'Save', SAVE, null],
        'jr7-saashr-contact-address-filled': ['not-final', 'Save', SAVE, null],
        'jr7-saashr-documents': step,
        // "Upload Complete": nothing pressed while it shows (its Cancel is the upload-prompt door's).
        'jr7-saashr-documents-populate': ['unknown', null, null, null],
        // "Saving" is busy (below); its step's Continue stands behind it.
        'jr7-saashr-documents-after': step,
        'jr7-saashr-work-history': step,
        // An entry's editor: its Save is the repeatable's (saveBlocks), never the step's Next.
        'jr7-saashr-work-entry-filled': ['not-final', null, null, null],
        'jr7-saashr-work-entry2-filled': ['not-final', null, null, null],
        'jr7-saashr-education': step,
        'jr7-saashr-education-entry-filled': ['not-final', null, null, null],
        'jr7-saashr-additional-info': step,
        'jr7-saashr-references': step,
        'jr7-saashr-reference-entry': ['not-final', null, null, null],
        'jr7-saashr-questionnaire': step,
        'jr7-saashr-questionnaire-filled': ['not-final', 'Review & Submit Application',
          '833d1484-3343-4e95-b3d8-22ba1a798740_modal_ok_button', null],
        'jr7-saashr-review': ['final', null, null, SIGN],
        'jr7-saashr-review-sign': ['final', null, null, 'I Agree'],
        'jr7-saashr-confirmation': ['unknown', null, null, null],
      });
    });

  it('declares "Almost There!"\'s OK, whose words say submit, as a Next while the progress reads n < m; its visible copy',
    async () => {
      const doc = await open('jr7-saashr-questionnaire-filled');
      const root = ukgReadyAdapter.detect(doc)!.formRoot;
      const next = ukgReadyAdapter.nextButton!(root)!;
      const declared = ukgReadyAdapter.stepSubmitNext!;
      expect(declared.buttons.some((css) => next.matches(css))).toBe(true);
      expect(words(declared.laterStep(doc))).toBe('7/9');
      // The measuring copy (UKGR-V4) is the same button in another place: never the Next, never pressed.
      const copies = Array.from(doc.querySelectorAll('#react_modal button[data-tracking-id$="_modal_ok_button"]'));
      expect(copies).toHaveLength(2);
      expect(next.closest('.c-modal-button-group-measurement')).toBeNull();
      expect(ukgReadyAdapter.neverPress!(root)).toContain(copies.find((copy) => copy !== next));
      removeFixtures(document);
      // On the confirmation the progress reads 9/9: no later step.
      expect(declared.laterStep(await open('jr7-saashr-confirmation'))).toBeNull();
    });

  it('never takes "I Agree", Back, Close or the consent\'s Cancel as a Next, and the two Submits are two steps', async () => {
    const review = await open('jr7-saashr-review');
    const reviewSignature = ukgReadyAdapter.stepSignature!(review);
    expect(successSignsOf(review, [UKGREADY_CONFIG.success!])).toEqual([]);
    removeFixtures(document);
    const sign = await open('jr7-saashr-review-sign');
    const root = ukgReadyAdapter.detect(sign)!.formRoot;
    expect(ukgReadyAdapter.nextButton!(root)).toBeNull();
    // The second press (I Agree) is its own step: its signature differs from the review's (autoPressKey), one
    // application under one key (the session's), the earlier arm replaced by it (content/runtime.ts arm).
    expect(ukgReadyAdapter.stepSignature!(sign)).not.toEqual(reviewSignature);
    expect(ukgReadyAdapter.stepSignature!(sign).anchors).toContain('dialog:consent');
    const never = ukgReadyAdapter.neverPress!(root).map((el) => (el as HTMLElement).dataset.trackingId);
    expect(never).toEqual(expect.arrayContaining(['e3619e49-50a4-4c4c-9fd4-de376b9ba44a', 'undefined_close']));
    expect(successSignsOf(sign, [UKGREADY_CONFIG.success!])).toEqual([]);
  });

  it('gives every dialog round a signature of its own (UKGR-V1): an editor open or closed, an entry saved', async () => {
    const contact = await open('jr7-saashr-contact');
    const withEditor = ukgReadyAdapter.stepSignature!(contact);
    expect(withEditor).toEqual({ heading: 'Contact Information', progress: '1/9',
      anchors: ['view:step', 'dialog:editor:contact', 'entries:2', 'missing:1'] });
    contact.querySelector('#react_popup')!.classList.remove('visible');
    expect(ukgReadyAdapter.stepSignature!(contact).anchors).toEqual(['view:step', 'dialog:none', 'entries:2', 'missing:1']);
    removeFixtures(document);
    const history = await open('jr7-saashr-work-history');
    expect(ukgReadyAdapter.stepSignature!(history).anchors).toEqual(['view:step', 'dialog:none', 'entries:3', 'missing:0']);
    history.querySelector('.c-work-experience-widget-container .c-widget-fat-item')!.remove();
    expect(ukgReadyAdapter.stepSignature!(history).anchors).toContain('entries:2');
  });
});

describe('the success sign (UKGR-12)', () => {
  it('reads "We got it!" with its companion on the confirmation alone, through the registry too', async () => {
    const counts: Record<string, number> = {};
    for (const name of UKGREADY_CASES) {
      const doc = await open(name);
      counts[name] = signsOf(doc, 'ukgready').length;
      expect(successSignsOf(doc, [UKGREADY_CONFIG.success!]).length, name).toBe(counts[name]);
      removeFixtures(document);
    }
    expect(Object.entries(counts).filter(([, count]) => count > 0)).toEqual([['jr7-saashr-confirmation', 1]]);
  });
});

describe('the uploads and the dialogs after them (UKGR-10)', () => {
  it('names the résumé and the cover letter by their sections behind "Choose", and nothing is busy before "Saving"',
    async () => {
      const doc = await open('jr7-saashr-documents');
      const root = ukgReadyAdapter.detect(doc)!.formRoot;
      const widgets = ukgReadyAdapter.uploadWidgets!(root);
      expect(widgets.map((widget) => [widget.input.id, words(widget.control)])).toEqual([['_file_input_0', 'Choose'],
        ['_file_input_1', 'Choose']]);
      const result = scanOf(doc);
      expect(widgets.map((widget) => fieldOf(result, widget.input)?.label)).toEqual(['Resume Upload',
        'Cover Letter & Upload Documents']);
      expect(widgets.map((widget) => ukgReadyAdapter.uploadHeld!(widget.input))).toEqual([false, false]);
      expect(ukgReadyAdapter.isBusy!(doc)).toBe(false);
      expect(ukgReadyAdapter.uploadPrompt!(doc)).toBeNull();
      // "Type or paste it myself" and "Add Another Document" are never pressed.
      expect(ukgReadyAdapter.neverPress!(root).map(words)).toEqual(expect.arrayContaining(['Type or paste it myself',
        'Add Another Document']));
    });

  it('answers "Upload Complete" with its Cancel, never Populate, and is busy while "Saving" shows', async () => {
    const doc = await open('jr7-saashr-documents-populate');
    const prompt = ukgReadyAdapter.uploadPrompt!(doc)!;
    expect([words(prompt.press), prompt.kind]).toEqual(['Cancel', 'dismiss']);
    expect(prompt.press.closest('.c-modal-button-group-measurement')).toBeNull();
    const root = ukgReadyAdapter.detect(doc)!.formRoot;
    const populate = Array.from(doc.querySelectorAll('#react_modal button')).filter((button) => words(button) === 'Populate');
    expect(populate).toHaveLength(2);
    expect(populate.every((button) => ukgReadyAdapter.neverPress!(root).includes(button))).toBe(true);
    expect(ukgReadyAdapter.isBusy!(doc)).toBe(false);
    removeFixtures(document);
    const after = await open('jr7-saashr-documents-after');
    expect(ukgReadyAdapter.isBusy!(after)).toBe(true);
    expect(ukgReadyAdapter.uploadPrompt!(after)).toBeNull();
    // After the upload the résumé shows its file row (and its input is gone): no résumé widget is left to fill.
    const widgets = ukgReadyAdapter.uploadWidgets!(ukgReadyAdapter.detect(after)!.formRoot);
    expect(widgets.map((widget) => widget.input.id)).toEqual(['_file_input_1']);
    expect(after.querySelectorAll('.c-resume-widget-container .uploaded-file-container .uploaded-file')).toHaveLength(1);
  });
});

describe('the entries in editor dialogs (UKGR-9, UKGR-V1, UKGR-15)', () => {
  it('reads Work Experience\'s saved entries, its Add and the open editor as one more block with its Save', async () => {
    const history = await open('jr7-saashr-work-history');
    const [work] = ukgReadyAdapter.repeatables!(ukgReadyAdapter.detect(history)!.formRoot);
    expect([work!.kind, work!.blocks().length, words(work!.addButton())]).toEqual(['experience', 3, 'Add work']);
    expect(work!.blocks().map((block) => work!.save!(block))).toEqual([null, null, null]);
    // Each saved entry's summary: its Company name and its job title (the words are REDACTED in the fixture).
    expect(ukgReadyAdapter.prefill!.readEntries!('experience', work!.blocks())
      .map((entry) => [entry.block, entry.values.map((value) => value.category)]))
      .toEqual([0, 1, 2].map((block) => [block, ['experience.company', 'experience.title']]));
    removeFixtures(document);
    const doc = await open('jr7-saashr-work-entry-filled');
    const root = ukgReadyAdapter.detect(doc)!.formRoot;
    const [editing] = ukgReadyAdapter.repeatables!(root);
    const blocks = editing!.blocks();
    expect(blocks).toHaveLength(4);
    expect(blocks[3]!.matches('#react_popup div.c-popup[role="dialog"]')).toBe(true);
    expect(words(editing!.save!(blocks[3]!))).toBe('Save');
    expect(editing!.currentlyHere!(blocks[3]!)?.name).toBe('Present');
    // The editor's fields are the fourth block's, in an experience section (UKGR-15: no longer the posting's).
    const result = scanOf(doc);
    expect(fieldOf(result, doc.querySelector('#react_popup input[name="Company Name"]')))
      .toEqual({ label: 'Company name', kind: 'text', section: 'experience', block: 3 });
    expect(fieldOf(result, doc.querySelector('#react_popup input[name="Job From"]'))?.section).toBe('experience');
    expect(ukgReadyAdapter.formatFor!(doc.querySelector('#react_popup input[name="Job From"]')!))
      .toEqual({ format: 'date', pattern: 'MM/DD/YYYY' });
  });

  it('reads Education\'s saved entry by its school and its open editor as an education block', async () => {
    const doc = await open('jr7-saashr-education-entry-filled');
    const root = ukgReadyAdapter.detect(doc)!.formRoot;
    const [education] = ukgReadyAdapter.repeatables!(root);
    expect([education!.kind, education!.blocks().length, words(education!.addButton())]).toEqual(['education', 2,
      'Add education']);
    expect(ukgReadyAdapter.prefill!.readEntries!('education', education!.blocks())
      .map((entry) => [entry.block, entry.values.map((value) => value.category)])).toEqual([[0, ['education.school']]]);
    expect(fieldOf(scanOf(doc), doc.querySelector('#react_popup input[name="schoolName"]')))
      .toEqual({ label: 'School Name', kind: 'text', section: 'education', block: 1 });
  });

  it("opens Contact's Address while it says Missing Information and Personal Information while it shows no phone", async () => {
    const doc = await open('jr7-saashr-contact');
    const root = ukgReadyAdapter.detect(doc)!.formRoot;
    // An editor is open: none.
    expect(ukgReadyAdapter.editorOpener!(root)).toEqual([]);
    doc.querySelector('#react_popup')!.classList.remove('visible');
    const openers = ukgReadyAdapter.editorOpener!(root);
    expect(openers.map((button) => [button.getAttribute('aria-label'),
      button.closest('.c-address-widget-container, .c-contact-info-widget-container')?.className])).toEqual([
      ['Edit', 'c-address-widget-container'], ['Edit', 'c-contact-info-widget-container']]);
    // Saved, neither is opened again: the Address's tag gone, a phone shown beside the email.
    doc.querySelector('.c-address-widget-container .c-fat-item__tag')!.remove();
    const phone = doc.createElement('li');
    phone.className = 'c-metadata__item';
    doc.querySelector('.c-contact-info-widget-container ul.c-metadata')!.append(phone);
    expect(ukgReadyAdapter.editorOpener!(root)).toEqual([]);
    removeFixtures(document);
    const history = await open('jr7-saashr-work-history');
    expect(ukgReadyAdapter.editorOpener!(ukgReadyAdapter.detect(history)!.formRoot)).toEqual([]);
  });
});

describe('what is never filled (UKGR-13, UKGR-14, UKGR-V1)', () => {
  it('leaves out the SSN box, the Security Question, the header and its menus on Contact', async () => {
    const doc = await open('jr7-saashr-contact');
    const result = scanOf(doc);
    for (const css of ['input[name="SSN"]', '.c-security-question-widget-container input[name="question"]',
      '.c-security-question-widget-container input[name="answer"]', 'header#_header input[type="search"]']) {
      expect(doc.querySelector(css), css).not.toBeNull();
      expect(fieldOf(result, doc.querySelector(css)), css).toBeNull();
    }
    // The rules undone: each is a field again (a phone-shaped SSN box: UKGR-14).
    const unexcluded = scanOf(doc, variant({}, { excluded: [] }));
    expect(fieldOf(unexcluded, doc.querySelector('input[name="SSN"]'))).not.toBeNull();
    expect(fieldOf(unexcluded, doc.querySelector('.c-security-question-widget-container input[name="answer"]'))).not.toBeNull();
  });

  it('leaves out the reference editor, whose section is "Professional References" were it read (the RULES contract)',
    async () => {
      const doc = await open('jr7-saashr-reference-entry');
      const names = ['refCompany', 'contactPerson', 'refEmail', 'refPhone'];
      const result = scanOf(doc);
      for (const name of names) expect(fieldOf(result, doc.querySelector(`#react_popup input[name="${name}"]`)), name).toBeNull();
      const unexcluded = scanOf(doc, variant({}, { excluded: [] }));
      for (const name of names) {
        expect(fieldOf(unexcluded, doc.querySelector(`#react_popup input[name="${name}"]`))?.section, name)
          .toBe('professional-references');
      }
    });

  it("leaves out the review's read-only summary", async () => {
    const doc = await open('jr7-saashr-review');
    expect(doc.querySelectorAll('.c-profile-summary-container input').length).toBeGreaterThan(10);
    expect(scanOf(doc).fields).toEqual([]);
  });
});

describe('labels and boxes (UKGR-16, UKGR-18, FIX7PLAN §3.3, item 14)', () => {
  it('names each phone code by its phone, the Primary radios "Primary phone", and draws a box on the field span', async () => {
    const doc = await open('jr7-saashr-contact');
    const codes = Array.from(doc.querySelectorAll('#react_popup li.c-phone-section-warapper__code-field select'));
    expect(codes.map((code) => [ukgReadyAdapter.labelFirst!(code), words(ukgReadyAdapter.labelFor!(code)),
      ukgReadyAdapter.labelSuffix!(code)])).toEqual([[true, 'Home Phone', 'country code'],
      [true, 'Work Phone', 'country code'], [true, 'Cell Phone', 'country code']]);
    const result = scanOf(doc);
    expect(fieldOf(result, doc.querySelector('#react_popup input[name="primary"]'))).toEqual({ label: 'Primary phone',
      kind: 'radio', section: 'contact-information', block: null });
    const first = doc.querySelector('#react_popup input[name="firstName"]')!;
    expect(ukgReadyAdapter.controlBox!(first)?.getAttribute('data-test')).toBe('form-control-field');
    expect(ukgReadyAdapter.controlBox!(first)?.contains(first)).toBe(true);
  });

  it('reads the e-signature as "Full Name to confirm", its prompt its help text, in the consent\'s section', async () => {
    const doc = await open('jr7-saashr-review-sign');
    const box = doc.querySelector('input#signature')!;
    const result = scanOf(doc);
    expect(fieldOf(result, box)).toEqual({ label: 'Full Name to confirm', kind: 'text',
      section: 'consent-acknowledgement', block: null });
    expect(ukgReadyAdapter.descriptionFor!(box).map((el) => words(el)?.startsWith('Please type your full name to confirm:')))
      .toEqual([true]);
    // The hooks undone: the bare "Full Name" (a name box, not a signature).
    expect(fieldOf(scanOf(doc, variant({ labelFirst: undefined, labelSuffix: undefined })), box)?.label).toBe('Full Name');
  });

  it('reads UKG\'s date pickers as MM/DD/YYYY, and nothing else', async () => {
    const doc = await open('jr7-saashr-documents');
    expect(ukgReadyAdapter.formatFor!(doc.querySelector('input[name="availableStartDate"]')!))
      .toEqual({ format: 'date', pattern: 'MM/DD/YYYY' });
    expect(ukgReadyAdapter.formatFor!(doc.querySelector('input[name="requiredSalary"]')!)).toBeNull();
  });
});
