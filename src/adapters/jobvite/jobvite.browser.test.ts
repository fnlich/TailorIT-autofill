/*
 * The Jobvite adapter (DESIGN-NEW-ATS §5, builder B) on the owner's snapshots of 2026-11-06 (fixtures/jobvite; the
 * design's ids jobvite-0 to -7): each case's hooks and scan held against its hand-written expectations, the Data
 * Consent gate (its residence select filled like a step, its "I Accept" the agent's entry, never "I Decline"), the three
 * steps (Next, Send Application, which step is last), the uploads outside the form, and every rule shown to matter by
 * the same page read with that rule undone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import consentEmptyExpect from '../../../fixtures/jobvite/ninjaone-consent-empty.expect.json';
import consentEmptyHtml from '../../../fixtures/jobvite/ninjaone-consent-empty.html?raw';
import consentExpect from '../../../fixtures/jobvite/ninjaone-consent.expect.json';
import consentHtml from '../../../fixtures/jobvite/ninjaone-consent.html?raw';
import postingExpect from '../../../fixtures/jobvite/ninjaone-posting.expect.json';
import postingHtml from '../../../fixtures/jobvite/ninjaone-posting.html?raw';
import step1ResumeExpect from '../../../fixtures/jobvite/ninjaone-step1-resume.expect.json';
import step1ResumeHtml from '../../../fixtures/jobvite/ninjaone-step1-resume.html?raw';
import step1Expect from '../../../fixtures/jobvite/ninjaone-step1.expect.json';
import step1Html from '../../../fixtures/jobvite/ninjaone-step1.html?raw';
import step2Expect from '../../../fixtures/jobvite/ninjaone-step2.expect.json';
import step2Html from '../../../fixtures/jobvite/ninjaone-step2.html?raw';
import step3Expect from '../../../fixtures/jobvite/ninjaone-step3.expect.json';
import step3Html from '../../../fixtures/jobvite/ninjaone-step3.html?raw';
import { pressEntry } from '../../content/press';
import { classifyByRules } from '../../core/resolver/classifyRules';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScannedField } from '../../dom/types';
import { configuredAdapter, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { adaptersFor } from '../index';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { JOBVITE_CONFIG, JOBVITE_FIXTURES, jobviteAdapter } from './index';

const POSTING = 'https://jobs.jobvite.com/ninjaone/job/o5b1AfwB';
const APPLY = `${POSTING}/apply`;

const CASES = [
  { name: 'ninjaone-posting', html: postingHtml, json: postingExpect, address: POSTING },
  { name: 'ninjaone-consent-empty', html: consentEmptyHtml, json: consentEmptyExpect, address: APPLY },
  { name: 'ninjaone-consent', html: consentHtml, json: consentExpect, address: APPLY },
  { name: 'ninjaone-step1', html: step1Html, json: step1Expect, address: APPLY },
  { name: 'ninjaone-step1-resume', html: step1ResumeHtml, json: step1ResumeExpect, address: APPLY },
  { name: 'ninjaone-step2', html: step2Html, json: step2Expect, address: APPLY },
  { name: 'ninjaone-step3', html: step3Html, json: step3Expect, address: APPLY },
] as const;

afterEach(() => removeFixtures(document));

const open = (html: string) => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
/** The adapter a config builds with one of its rules undone. */
const without = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...JOBVITE_CONFIG, ...change });
const scanned = (fixture: Fixture, adapter: Adapter = jobviteAdapter) =>
  scan(adapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'jobvite' });
const byControl = (fields: readonly ScannedField[], id: string) => fields.find((field) => field.idAttr === id);

describe('the Jobvite adapter: its hooks and scans on the snapshots', () => {
  it('names each snapshot it was written from, and is the registry\'s adapter on its host', () => {
    expect([...JOBVITE_FIXTURES].sort()).toEqual(CASES.map((each) => `fixtures/jobvite/${each.name}.html`).sort());
    expect(adaptersFor(new URL(APPLY))[0]).toBe(jobviteAdapter);
    expect(ATS_CONFIGS.jobvite).toBe(JOBVITE_CONFIG);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json }) => {
    const fixture = await open(html);
    expect(compareHooks(fixture.doc, jobviteAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const read = await scanCase(document, html, address);
      expect(read.adapter).toBe(jobviteAdapter);
      expect(compareWithExpectation(read.doc, read.result, readExpectation(json))).toEqual([]);
    });
});

describe('the Data Consent gate (ninjaone-consent-empty, ninjaone-consent)', () => {
  it('fills the residence select like a step and presses nothing there', async () => {
    const fixture = await open(consentEmptyHtml);
    expect(jobviteAdapter.detect(fixture.doc)?.formRoot).toBe(q(fixture, 'form[name="consentForm"]'));
    expect(jobviteAdapter.authState?.(fixture.doc)).toBeNull();
    expect(jobviteAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    expect(jobviteAdapter.nextButton?.(fixture.doc.body)).toBeNull();
    expect(jobviteAdapter.entryControl?.(fixture.doc)).toBeNull();
    // Undone (no residence state): no root on the gate, so its one question is never read.
    expect(without({ states: JOBVITE_CONFIG.states!.filter((state) => state.name !== 'residence') }).detect(fixture.doc))
      .toBeNull();
  });

  /** The consent gate (ninjaone-consent), its clicks recorded and its submissions held in the test (nothing leaves). */
  async function consentGate() {
    const fixture = await open(consentHtml);
    const pressed: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    }, true);
    fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
    const form = q<HTMLFormElement>(fixture, 'form[name="consentForm"]');
    const accept = q(fixture, 'form[name="consentForm"] button[type="submit"]');
    const enter = () => pressEntry(fixture.doc, [jobviteAdapter], new AbortController().signal, 300, 300);
    return { fixture, form, accept, pressed, enter };
  }

  it("offers \"I Accept\" as the agent's entry, never \"I Decline\", and the door submits the consent form by it alone",
    async () => {
      const { fixture, form, accept, pressed, enter } = await consentGate();
      expect(jobviteAdapter.detect(fixture.doc)).toBeNull();
      expect(detectPause(fixture.doc, null, jobviteAdapter)).toEqual({ kind: 'entry-choice', evidence: 'adapter' });
      expect(jobviteAdapter.entryControl?.(fixture.doc)).toBe(accept);
      const never = jobviteAdapter.neverPress!(fixture.doc.documentElement);
      for (const decline of Array.from(fixture.doc.querySelectorAll('form[name="consentForm"] a.jv-button'))) {
        expect(never).toContain(decline);
      }
      expect(never).toContain(accept);
      expect(jobviteAdapter.entryNeverPressed).toBe(true);
      // Core pass Z1, item 27: "I Accept" is a type=submit button of the consent form, which holds nothing but it and
      // the residence select the state declares, so the entry door presses it (the Taleo precedent).
      expect(jobviteAdapter.entryConsentForm?.(fixture.doc)).toEqual({ form,
        selects: [q(fixture, 'select#jv-country-select')] });
      expect(await enter()).toEqual({ outcome: 'pressed' });
      expect(pressed).toEqual([accept]);
      // Undone (no consent state): the gate is no pause and offers no entry.
      const noConsent = without({ states: JOBVITE_CONFIG.states!.filter((state) => state.name !== 'consent') });
      expect(noConsent.authState?.(fixture.doc)).toBeNull();
      expect(noConsent.entryControl?.(fixture.doc)).toBeNull();
    });

  // The behaviour review of 2026-11-06 (minor 17): the consent door's own checks, each pinned (Z1n, Z1o).
  it('submits the consent form only on the adapter’s entry choice, by a control that form owns (adversarial)',
    async () => {
      // An adapter that declares the consent form but reads no entry choice on the page (Z1n).
      const first = await consentGate();
      const noChoice: Adapter = { ...jobviteAdapter, authState: () => null };
      expect(await pressEntry(first.fixture.doc, [noChoice], new AbortController().signal, 300, 300))
        .toEqual({ outcome: 'not-offered' });
      expect(first.pressed).toEqual([]);
      removeFixtures(document);
      // A consent form declared that is not the control's own: an empty form beside it (Z1o).
      const second = await consentGate();
      const other = second.fixture.doc.createElement('form');
      other.method = 'post';
      second.fixture.doc.body.append(other);
      const notItsForm: Adapter = { ...jobviteAdapter, entryConsentForm: () => ({ form: other, selects: [] }) };
      expect(await pressEntry(second.fixture.doc, [notItsForm], new AbortController().signal, 300, 300))
        .toEqual({ outcome: 'blocked', block: 'other' });
      expect(second.pressed).toEqual([]);
    });

  it('never submits the consent form while it holds anything but the choice and its declared select (adversarial)',
    async () => {
      // The rule undone (no entrySubmits): the door never presses a control that submits a form.
      const undone = without({ states: JOBVITE_CONFIG.states!.map((state) => (state.name === 'consent'
        ? { ...state, entrySubmits: undefined } : state)) });
      /** An element of the form's document, its attributes set. */
      const made = (form: HTMLFormElement, tag: string, attributes: Record<string, string>) => {
        const el = form.ownerDocument.createElement(tag);
        for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
        return el;
      };
      for (const [what, change] of [
        ['no consent form declared', null],
        ['an application field in the form', (form: HTMLFormElement) => form.append(made(form, 'input',
          { id: 'em', name: 'email', type: 'email', 'aria-label': 'Email' }))],
        ['a hidden input in the form', (form: HTMLFormElement) => form.append(made(form, 'input',
          { type: 'hidden', name: 'resume', value: 'x' }))],
        ['an undeclared select in the form', (form: HTMLFormElement) => form.append(made(form, 'select',
          { name: 'other' }))],
        ['a field outside the form that names it (form=)', (form: HTMLFormElement) => form.ownerDocument.body
          .append(made(form, 'input', { name: 'phone', form: 'consentForm-id' }))],
        ['a second submit button in the form', (form: HTMLFormElement) => form.append(made(form, 'button',
          { type: 'submit', name: 'apply' }))],
      ] as const) {
        const { form, pressed } = await consentGate();
        form.id = 'consentForm-id';
        change?.(form);
        const adapter = change === null ? undone : jobviteAdapter;
        expect(await pressEntry(form.ownerDocument, [adapter], new AbortController().signal, 300, 300), what)
          .toEqual({ outcome: 'blocked', block: 'other' });
        expect(pressed, what).toEqual([]);
        removeFixtures(document);
      }
    });

  it("presses the posting's first Apply as the entry, and nothing on a page with a form", async () => {
    const posting = await open(postingHtml);
    const pressed: Element[] = [];
    posting.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    }, true);
    expect(await pressEntry(posting.doc, [jobviteAdapter], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual([posting.doc.querySelectorAll('a.jv-button-apply')[0]]);
    removeFixtures(document);
    const step1 = await open(step1Html);
    expect(jobviteAdapter.entryControl?.(step1.doc)).toBeNull();
  });
});

describe('the three steps (ninjaone-step1 to -step3)', () => {
  // jr6 JV-23: each step by its ng-form alone (no header: Jobvite's "invalid fields only" view hides the step's first
  // header, jr6-jobvite.browser.test.ts).
  it('reads each step by its ng-form, presses Next on the first two and never on the last', async () => {
    const expected = [
      { html: step1Html, step: 'scopeData.step1', final: 'not-final' },
      { html: step2Html, step: 'scopeData.step2', final: 'not-final' },
      { html: step3Html, step: 'scopeData.step3', final: 'final' },
    ] as const;
    for (const { html, step, final } of expected) {
      const fixture = await open(html);
      const root = jobviteAdapter.detect(fixture.doc)!.formRoot;
      expect(jobviteAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: [step] });
      expect(jobviteAdapter.isFinalStep?.(fixture.doc)).toBe(final);
      expect(jobviteAdapter.nextButton?.(root) ?? null)
        .toBe(final === 'final' ? null : q(fixture, 'button[aria-label="Next"]'));
      expect(jobviteAdapter.submitButton?.(root)).toBe(q(fixture, 'button[aria-label="Send Application"]'));
      removeFixtures(document);
    }
    // Undone (no Submit rule): the last step's finality is unknown, so nothing is pressed there.
    const last = await open(step3Html);
    expect(without({ submit: undefined }).isFinalStep?.(last.doc)).toBe('unknown');
  });

  it('reads the error template once it shows, and the sending spinner as busy', async () => {
    const fixture = await open(step3Html);
    const root = jobviteAdapter.detect(fixture.doc)!.formRoot;
    expect(jobviteAdapter.errors?.(root)).toEqual([]);
    expect(jobviteAdapter.isBusy?.(fixture.doc)).toBe(false);
    const alert = q(fixture, 'div.jv-apply-error p[role="alert"]');
    alert.parentElement!.classList.remove('ng-hide');
    expect(jobviteAdapter.errors?.(root).map((each) => each.el)).toEqual([alert]);
    expect(without({ errors: undefined }).errors?.(root)).toEqual([]);
    q(fixture, 'button[aria-label="Send Application"] > span[ng-show="submitting"]').classList.remove('ng-hide');
    expect(jobviteAdapter.isBusy?.(fixture.doc)).toBe(true);
    expect(without({ busy: undefined }).isBusy?.(fixture.doc)).toBe(false);
  });

  it("reads each closing name and date pair of step 2 as its form's signature, first (core pass Z2)", async () => {
    const fixture = await open(step2Html);
    const fields = scanned(fixture).fields;
    const pairs = ['jv-field-f7', 'jv-field-date8', 'jv-field-f20', 'jv-field-date21'].map((id) => byControl(fields, id)!);
    expect(pairs.map((field) => [field.label, field.labelSource, field.required])).toEqual([
      ['Your Name signature', 'adapter', true], ["Today's Date signature", 'adapter', true],
      ['Your Name signature', 'adapter', true], ["Today's Date signature", 'adapter', true]]);
    // The name is the signature consent, never the profile's full name; the date is today's, on the signature's terms
    // (consent.signature-date; jr6 RULES item 11, JV-1).
    expect(classifyByRules(toFieldSpec(pairs[0]!))?.category).toBe('consent.signature');
    expect(classifyByRules(toFieldSpec(pairs[1]!))).toMatchObject({ category: 'consent.signatureDate',
      rule: 'label.signature-date' });
    // Step 1's names (JVA_NAME, but no self-identification form's) keep their own label[for].
    removeFixtures(document);
    const step1 = scanned(await open(step1Html)).fields;
    expect(step1.filter((field) => field.label.endsWith('signature'))).toEqual([]);
    // Undone (no labelFirst, as the scanner read it until then): the label[for] wins, and the name is the full name.
    removeFixtures(document);
    const { labelFirst: _first, ...rest } = JOBVITE_CONFIG.code!;
    const plain = scanned(await open(step2Html), without({ code: rest }));
    const name = byControl(plain.fields, 'jv-field-f7')!;
    expect([name.label, name.labelSource]).toEqual(['Your Name', 'for']);
    expect(classifyByRules(toFieldSpec(name))?.category).toBe('identity.fullName');
  });

  it('tells the two signature pairs of step 2 apart by their sub-section headings', async () => {
    const fixture = await open(step2Html);
    const fields = scanned(fixture).fields;
    const names = fields.filter((field) => field.label === 'Your Name signature');
    expect(names.map((field) => [field.section.id, field.ordinal])).toEqual([['equal-opportunity', 0],
      ['pre-employment-request-for-veteran-classificatio~be3250', 0]]);
    expect(new Set(names.map((field) => field.key)).size).toBe(2);
    // Undone (the step's h3 declared a section, as the design first read it): both pairs fold into one section and
    // are told apart only by their order.
    const { sections: _popovers, ...code } = JOBVITE_CONFIG.code!;
    const folded = scanned(fixture, without({ code, sections: [{ container: 'div.jv-apply-section',
      heading: 'h3.jv-step-header', from: 'ninjaone-step2' }] })).fields.filter((field) => field.label === 'Your Name signature');
    expect(folded.map((field) => [field.section.id, field.ordinal])).toEqual([['voluntary-self-identification', 0],
      ['voluntary-self-identification', 1]]);
  });
});

describe('the uploads outside the form (ninjaone-step1, ninjaone-step1-resume)', () => {
  it('reads the resume and cover letter inputs in the body-level popovers, by their openers and headings', async () => {
    const fixture = await open(step1Html);
    const root = jobviteAdapter.detect(fixture.doc)!.formRoot;
    expect(jobviteAdapter.uploadWidgets?.(root)).toEqual([
      { input: q(fixture, '#file-input-0'), control: q(fixture, 'button[attachment-label="Resume"]') },
      { input: q(fixture, '#file-input-1'), control: q(fixture, 'button[attachment-label="Cover Letter"]') }]);
    const fields = scanned(fixture).fields;
    expect(byControl(fields, 'file-input-0')).toMatchObject({ kind: 'file', label: 'Add Resume', required: true,
      section: { id: 'add-resume' }, proxy: 'adapter' });
    expect(byControl(fields, 'file-input-1')).toMatchObject({ kind: 'file', label: 'Add Cover Letter', required: false,
      section: { id: 'additional-files' } });
    // Undone: with the form as the root the popovers' inputs are outside it; without the code's labels they have none
    // (their own label[for], "File", is in the closed popover); without its sections the resume falls under the last
    // heading before the popovers.
    const formRoot = without({ root: { css: 'form[name="scopeData.applyForm"]', from: 'ninjaone-step1' } });
    expect(scanned(fixture, formRoot).fields.some((field) => field.kind === 'file')).toBe(false);
    const { code, ...rules } = JOBVITE_CONFIG;
    const bare = configuredAdapter({ ...rules, code: { ...code, labelFor: undefined, sections: undefined } });
    const unlabelled = byControl(scanned(fixture, bare).fields, 'file-input-0');
    expect([unlabelled?.labelSource, unlabelled?.section.id]).toEqual(['none', 'additional-files']);
  });

  it('keeps the resume a field once it is in (its row stands for the upload), and reads the page\'s signs of it', async () => {
    const fixture = await open(step1ResumeHtml);
    const root = jobviteAdapter.detect(fixture.doc)!.formRoot;
    const input = q<HTMLInputElement>(fixture, '#file-input-0');
    const row = q(fixture, '#attachResume ul.jv-file-list div.jv-file');
    expect(jobviteAdapter.uploadWidgets?.(root)[0]).toEqual({ input, control: row });
    expect(byControl(scanned(fixture).fields, 'file-input-0')?.label).toBe('Add Resume');
    // The behaviour review (M2): the row confirms only the file it names, never an older file's row; it is a file the
    // page holds (uploadHeld) while the input itself holds none.
    expect(jobviteAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    expect(jobviteAdapter.uploadHeld?.(input)).toBe(true);
    q(fixture, '#attachResume span[ng-click="editOrPreviewResume()"]').textContent = 'resume.pdf';
    expect(jobviteAdapter.uploadState?.(input, 'resume.pdf')).toBe('confirmed');
    expect(jobviteAdapter.uploadState?.(input, 'other.pdf')).toBe('pending');
    q(fixture, '#attachResume span.jv-spinner').classList.remove('ng-hide');
    expect(jobviteAdapter.uploadState?.(input, 'resume.pdf')).toBe('pending');
    // The cover letter's row once a file is in is unseen: its own files decide.
    expect(jobviteAdapter.uploadState?.(q<HTMLInputElement>(fixture, '#file-input-1'), 'letter.pdf')).toBeNull();
    // Undone (the opener alone as the control): the opener is ng-hide, so the resume is no field once it is in.
    const openerOnly = without({ uploads: [{ ...JOBVITE_CONFIG.uploads![0]!,
      control: '#attachResume button[attachment-label="Resume"]' }, JOBVITE_CONFIG.uploads![1]!] });
    expect(byControl(scanned(fixture, openerOnly).fields, 'file-input-0')).toBeUndefined();
    removeFixtures(document);
    // Before a resume is in, its row is absent: still pending.
    const empty = await open(step1Html);
    expect(jobviteAdapter.uploadState?.(q<HTMLInputElement>(empty, '#file-input-0'), 'resume.pdf')).toBe('pending');
    expect(jobviteAdapter.uploadHeld?.(q<HTMLInputElement>(empty, '#file-input-0'))).toBe(false);
  });

  it('keeps the paste boxes out of the fields, even shown', async () => {
    const fixture = await open(step1Html);
    // No snapshot shows one open: shown here by taking off its ng-hide and aria-hidden.
    const box = q(fixture, '#jv-edit-resume-textarea0').closest('div.jv-add-attachment-paste')!;
    box.classList.remove('ng-hide');
    box.removeAttribute('aria-hidden');
    expect(scanned(fixture).fields.some((field) => field.idAttr === 'jv-edit-resume-textarea0')).toBe(false);
    expect(scanned(fixture, without({ excluded: undefined })).fields.some((field) => field.idAttr === 'jv-edit-resume-textarea0'))
      .toBe(true);
  });
});
