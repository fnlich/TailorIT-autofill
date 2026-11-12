/*
 * jr7 DFPC-7 (SP\jr7\FIX7PLAN.md §6.11, Paycom; P1): the Paycom adapter (./config.ts) on the owner's snapshot7
 * paycomonline1 captures (fixtures/paycom/jr7-paycomonline1-*.html), hook by hook, each rule also held against the page
 * read without it (the rule undone):
 * - PC7-01: the portal's root on the pre-screen and the application, none on the posting or the confirmation;
 * - PC7-05: the contact dialog filled like a step, its Continue To Application Sign-in mode's (never Next); the Start
 *   Application dialog an entry choice whose entry is "Apply Manually", "Autofill with Resume/CV" never;
 * - PC7-04: the pre-screen's Next and the application's Submit by their words (never Save and Complete Later); the
 *   questions' titles without their "N . *", the star their required mark; the yes/no groups' titles; dates drawn in
 *   three boxes one date; the outlined boxes' drawn border declared; Education and Employment repeatables (no Add);
 * - PC7-06: "Application Submitted!" beside its buttons, only on the confirmation;
 * - PC7-07 (gated Q7-10): the signature pad the person's: a required block left while nothing is drawn, its buttons
 *   never pressed;
 * - entry: the posting's shown Apply while no dialog shows; the host's employee pages never Paycom's.
 * The account capture holds the dialog's fields under an aria-hidden wrapper (a capture-time state: the live dialog
 * shows them), lifted where the scan reads them. Labels compared are the page's own words.
 */
import { afterEach, describe, expect, it } from 'vitest';
import posting from '../../../fixtures/paycom/jr7-paycomonline1-posting.html?raw';
import account from '../../../fixtures/paycom/jr7-paycomonline1-account.html?raw';
import prescreen from '../../../fixtures/paycom/jr7-paycomonline1-prescreen.html?raw';
import apply1 from '../../../fixtures/paycom/jr7-paycomonline1-apply-1.html?raw';
import apply2 from '../../../fixtures/paycom/jr7-paycomonline1-apply-2.html?raw';
import apply3 from '../../../fixtures/paycom/jr7-paycomonline1-apply-3.html?raw';
import signature from '../../../fixtures/paycom/jr7-paycomonline1-signature.html?raw';
import confirmation from '../../../fixtures/paycom/jr7-paycomonline1-confirmation.html?raw';
import { signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { ScanResult } from '../../dom/types';
import { platformOfUrl } from '../../shared/hosts';
import { configProblems, configuredAdapter } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import type { AtsConfig } from '../configured/types';
import { adaptersFor } from '../index';
import { genericAdapter } from '../generic';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { PAYCOM_CONFIG, PAYCOM_FIXTURES, paycomAdapter } from './index';

const PAGES = { posting, account, prescreen, 'apply-1': apply1, 'apply-2': apply2, 'apply-3': apply3, signature,
  confirmation } as const;
type Name = keyof typeof PAGES;

afterEach(() => removeFixtures(document));

async function open(name: Name): Promise<Document> {
  const { doc } = await loadFixture(document, PAGES[name], SNAPSHOT_VIEWPORT);
  // The account capture's dialog fields sit under an aria-hidden wrapper the live dialog does not keep (the header).
  if (name === 'account') {
    doc.querySelectorAll('[role="dialog"] [aria-hidden="true"]').forEach((el) => {
      if (el.querySelector('input') !== null) el.removeAttribute('aria-hidden');
    });
  }
  return doc;
}

/** The adapter built from the config with `change` applied (a rule undone). */
const variant = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...PAYCOM_CONFIG, ...change });
/** The config's code without `name` (that hook undone: the rule-built one stands). */
const withoutCode = (name: keyof NonNullable<AtsConfig['code']>): Adapter => {
  const code: Record<string, unknown> = { ...PAYCOM_CONFIG.code };
  delete code[name];
  return variant({ code });
};
const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The scan of the page's root with `adapter`, and a field found by its control's selector. */
function scanned(doc: Document, adapter: Adapter = paycomAdapter): { result: ScanResult; field: (css: string) =>
  ScanResult['fields'][number] | undefined } {
  const root = paycomAdapter.detect(doc)!.formRoot;
  const result = scan(root, adapter, { platform: 'paycom' });
  return { result, field: (css: string) => {
    const el = doc.querySelector(css);
    return result.fields.find((each) => {
      const target = result.target(each.key);
      return target !== null && (target.control === el || target.members.includes(el as HTMLInputElement));
    });
  } };
}

describe('jr7 DFPC-7: the Paycom adapter on snapshot7 paycomonline1', () => {
  it('names the cases it was written from; its config is sound and registered for its success sign', () => {
    expect([...PAYCOM_FIXTURES].sort()).toEqual(Object.keys(PAGES).map((name) => `fixtures/paycom/jr7-paycomonline1-${name}.html`)
      .sort());
    expect(configProblems(PAYCOM_CONFIG)).toEqual([]);
    expect(ATS_CONFIGS.paycom).toBe(PAYCOM_CONFIG);
  });

  it('runs on the candidate pages alone, never on the host\'s employee pages (the HR host rule)', () => {
    const key = '0123456789ABCDEF0123456789ABCDEF';
    for (const href of [`https://www.paycomonline.net/v4/ats/web.php/portal/${key}/jobs/1`,
      `https://www.paycomonline.net/v4/ats/web.php/portal/${key}/applications#/applications/2`]) {
      expect(paycomAdapter.matchesUrl(new URL(href)), href).toBe(true);
      expect(adaptersFor(new URL(href)), href).toEqual([paycomAdapter, genericAdapter]);
    }
    for (const href of ['https://www.paycomonline.net/v4/ee/web.php/app/login',
      `https://www.paycomonline.net/v4/cl/web.php/portal/${key}/jobs/1`,
      `https://www.paycomonline.net/v4/ats/web.php/portal/${key}/career-page`]) {
      expect(paycomAdapter.matchesUrl(new URL(href)), href).toBe(false);
      expect(platformOfUrl(href), href).not.toBe('paycom');
    }
  });

  it('entry: the posting\'s shown Apply while no dialog shows, pressed by the entry door alone', async () => {
    const doc = await open('posting');
    expect(paycomAdapter.detect(doc)).toBeNull();
    const entry = paycomAdapter.entryControl!(doc);
    expect(entry?.getAttribute('data-testid')).toBe('Apply-loadingbutton');
    expect(words(entry)).toBe('Apply');
    expect(paycomAdapter.entryNeverPressed).toBe(true);
    // The header's Sign In and Create Account: never.
    const never = paycomAdapter.neverPress!(doc.body);
    for (const button of Array.from(doc.querySelectorAll('button')).filter((each) => /^(?:Sign In|Create Account)$/
      .test(words(each)))) expect(never.includes(button)).toBe(true);
    // Undone (the rule and the code that reads it by its words): no entry.
    const code: Record<string, unknown> = { ...PAYCOM_CONFIG.code };
    delete code.entryControl;
    expect(variant({ posting: undefined, code }).entryControl!(doc)).toBeNull();
    // A loading button of the posting's that reads other words (an applied posting's): no entry.
    const applies = Array.from(doc.querySelectorAll('button[data-testid="Apply-loadingbutton"] span span'));
    applies.forEach((span) => { span.textContent = 'Applied'; });
    expect(paycomAdapter.entryControl!(doc)).toBeNull();
    applies.forEach((span) => { span.textContent = 'Apply'; });
    expect(words(paycomAdapter.entryControl!(doc))).toBe('Apply');
    // Any dialog shown over the posting (a sign-in no capture shows): no entry while it shows.
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = 'Sign In';
    doc.body.append(dialog);
    expect(paycomAdapter.entryControl!(doc)).toBeNull();
    dialog.remove();
    removeFixtures(document);
    // The contact dialog shown over the posting: no entry there.
    expect(paycomAdapter.entryControl!(await open('account'))).toBeNull();
  });

  it('PC7-05: the contact dialog is a step of its own; its Continue To Application is Sign-in mode\'s, never Next', async () => {
    const doc = await open('account');
    const root = paycomAdapter.detect(doc)!.formRoot;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(paycomAdapter.authState!(doc)).toBeNull();
    expect(paycomAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(paycomAdapter.nextButton!(root)).toBeNull();
    const container = paycomAdapter.signInContainer!(doc);
    expect(container?.button.getAttribute('data-testid')).toBe('createAccountNextButton-loadingbutton');
    expect(container?.container).toBe(root);
    expect(container?.password).toBeNull();
    const never = paycomAdapter.neverPress!(root);
    expect(never.includes(doc.querySelector('[data-testid="signInClickableTextClickableText"]'))).toBe(true);
    expect(never.includes(doc.querySelector('[data-testid="createAccountClickableTextClickableText"]'))).toBe(true);
    const { field } = scanned(doc);
    expect(field('input#firstName')?.label).toBe('Legal First Name');
    expect(field('input#confirmEmail')?.label).toBe('Confirm Email');
    expect(field('input[name="candidate-primary-phone-field"]')?.label).toBe('Primary Phone Number');
    // The texts consent's group: its question's words before it, never the group's unseen aria-label.
    expect(field('input[name^="candidate-primary-phone-message-opt-in"]')?.label)
      .toMatch(/^Do you consent to receiving text communications/);
    // Undone: no state, so the dialog is no step (nothing filled, nothing pressed).
    const without = variant({ states: PAYCOM_CONFIG.states!.filter((state) => state.name !== 'contact') });
    expect(without.detect(doc)).toBeNull();
    expect(without.signInContainer!(doc)).toBeNull();
  });

  it('PC7-04: the pre-screen\'s question without its "N . *", required by its star, and its Next by its words', async () => {
    const doc = await open('prescreen');
    const root = paycomAdapter.detect(doc)!.formRoot;
    expect(root.id).toBe('ats-portal');
    expect(paycomAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(words(paycomAdapter.nextButton!(root))).toBe('Next');
    expect(paycomAdapter.submitButton!(root)).toBeNull();
    expect(paycomAdapter.neverPress!(root).includes(Array.from(doc.querySelectorAll('button'))
      .find((button) => words(button) === 'Cancel'))).toBe(true);
    const { result } = scanned(doc);
    expect(result.fields.map((each) => [each.kind, each.label, each.required])).toEqual([
      ['radio', 'Are you legally authorized to work in the United States?', true]]);
    // Its options are its own (their words, read by ENGINE-7 E1 item 5), never the question's.
    const options = result.fields[0]!.options;
    expect(Array.isArray(options) && options.every((option) => !/legally authorized/.test(option.label))).toBe(true);
    // Undone: the title read whole, its number and star in it; its star not read as required.
    const loose = scanned(doc, withoutCode('labelFor')).result.fields[0];
    expect(loose?.label).not.toBe('Are you legally authorized to work in the United States?');
    expect(scanned(doc, withoutCode('requiredFor')).result.fields[0]?.required).toBe(false);
    // Undone: Next by the rules' selector alone, which also names the portal's other loading buttons as Submit.
    expect(withoutCode('isFinalStep').isFinalStep!(doc)).toBe('unknown');
  });

  it('PC7-05: the Start Application dialog is an entry choice: "Apply Manually", never "Autofill with Resume/CV"', async () => {
    const doc = await open('apply-1');
    expect(paycomAdapter.detect(doc)).toBeNull();
    expect(paycomAdapter.authState!(doc)).toBe('entry-choice');
    const entry = paycomAdapter.entryControl!(doc);
    expect(words(entry)).toBe('Apply Manually');
    const parser = Array.from(doc.querySelectorAll('[role="dialog"] button')).find((button) =>
      words(button) === 'Autofill with Resume/CV')!;
    expect(paycomAdapter.neverPress!(doc.body).includes(parser)).toBe(true);
    // Undone: the rule-built entry, the dialog's first button: the site's parser.
    expect(words(withoutCode('entryControl').entryControl!(doc))).toBe('Autofill with Resume/CV');
  });

  it('PC7-04: the application\'s Submit by its words, final; Save and Complete Later never', async () => {
    const doc = await open('apply-2');
    const root = paycomAdapter.detect(doc)!.formRoot;
    expect(paycomAdapter.isFinalStep!(doc)).toBe('final');
    expect(words(paycomAdapter.submitButton!(root))).toBe('Submit');
    expect(paycomAdapter.nextButton!(root)).toBeNull();
    const later = Array.from(doc.querySelectorAll('button')).find((button) => words(button) === 'Save and Complete Later')!;
    const never = paycomAdapter.neverPress!(root);
    expect(never.includes(later)).toBe(true);
    for (const button of Array.from(doc.querySelectorAll('button')).filter((each) =>
      /^(?:Remove|Clear Contents|Show More|Careers|My Account|Add Institution|Add Employer)$/.test(words(each))
      || each.matches('[data-testid="sideNavMainItemButton"]'))) {
      if (/^Add /.test(words(button))) continue;
      expect(never.includes(button), words(button)).toBe(true);
    }
    // Undone: Submit by the rules' selector, the first loading button: Save and Complete Later.
    expect(words(withoutCode('submitButton').submitButton!(root))).toBe('Save and Complete Later');
  });

  it('PC7-04: titles beside their fields, dates one field each, the outlined boxes\' border declared', async () => {
    const doc = await open('apply-2');
    const root = paycomAdapter.detect(doc)!.formRoot;
    const { result, field } = scanned(doc);
    expect(field('input[name="education-currently-enrolled-field-2"]')?.label).toBe('Currently Enrolled');
    expect(field('input[name="employment-current-employer-field-2"]')?.label).toBe('Current Employer');
    expect(field('textarea#questions-98620-field')).toMatchObject({ required: true });
    expect(field('textarea#questions-98620-field')?.label).toMatch(/^If applicable, what office location/);
    expect(field('input[name="questions-98619-field"]')?.label).toMatch(/^Will you now or in the future require sponsorship/);
    // A date drawn in three boxes is one field of kind date, labelled as drawn; its boxes no fields of their own.
    const dates = result.fields.filter((each) => each.kind === 'date');
    expect(dates.length).toBe(11);
    expect(dates.filter((each) => each.section.id === 'education').map((each) => each.label))
      .toEqual(['Start Date', 'End Date']);
    expect(dates.find((each) => each.section.id === 'questions')?.label).toBe('What is your earliest availability to start?');
    expect(field('#education-start-date-field-2-month')).toBeUndefined();
    // The outlined boxes: their border is the aria-hidden fieldset beside the control (ENGINE-7 judges it).
    for (const css of ['#personal-information-legal-first-name-field', '#questions-98620-field',
      '#personal-information-state-field']) {
      const box = paycomAdapter.controlBox!(doc.querySelector(css)!);
      expect(box?.localName, css).toBe('fieldset');
      expect(box?.getAttribute('aria-hidden'), css).toBe('true');
    }
    expect(paycomAdapter.controlBox!(doc.querySelector('input[name="questions-98619-field"]')!)).toBeNull();
    // A native select whose label names no id (Ethnicity: <label for="">), titled by that label before its box (scanned
    // once ENGINE-7 reads a select inside Paycom's role=listbox wrapper: the handoff's exact edit).
    expect(words(paycomAdapter.labelFor!(doc.querySelector('select[data-testid="Ethnicity-select"]')!))).toBe('Ethnicity');
    // Undone: no date declared, so its three boxes are none of the scan's dates.
    expect(scan(root, withoutCode('dateFor'), { platform: 'paycom' }).fields.filter((each) => each.kind === 'date'))
      .toEqual([]);
  });

  it('PC7-04: Education and Employment are repeatables, an entry per block, none added', async () => {
    const doc = await open('apply-2');
    const root = paycomAdapter.detect(doc)!.formRoot;
    const sections = paycomAdapter.repeatables!(root);
    expect(sections.map((section) => [section.kind, section.blocks().length])).toEqual([['education', 1],
      ['experience', 4]]);
    for (const section of sections) expect(section.addButton()).toBeNull();
    // Each employer's block holds its own entry's boxes alone.
    const employment = sections[1]!.blocks();
    employment.forEach((block, index) => {
      expect(block.querySelector(`[id="employment-employer-name-field-${index + 2}"]`), String(index)).not.toBeNull();
      expect(block.querySelectorAll('[id^="employment-employer-name-field-"]').length).toBe(1);
    });
    const { field } = scanned(doc);
    expect(field('#employment-job-title-field-3')?.section).toMatchObject({ id: 'experience', block: 1 });
    // Undone: no repeatables, every employer's boxes one section's.
    const loose = scanned(doc, withoutCode('repeatables')).field('#employment-job-title-field-3')?.section;
    expect(loose?.block).toBeUndefined();
  });

  it('PC7-07 (gated Q7-10): the signature pad is the person\'s: a required block while nothing is drawn', async () => {
    const doc = await open('signature');
    const root = paycomAdapter.detect(doc)!.formRoot;
    const left = paycomAdapter.requiredBlocksLeft!(root);
    expect(left.length).toBe(1);
    expect(left[0]!.querySelector('#authorization-signature-image-field')).not.toBeNull();
    expect(words(left[0]!.querySelector('h4'))).toMatch(/^Signature/);
    const never = paycomAdapter.neverPress!(root);
    for (const button of Array.from(doc.querySelectorAll('#authorization-signature-image-field button'))) {
      expect(never.includes(button), words(button)).toBe(true);
    }
    // Drawn (its prompt gone): none left.
    doc.querySelectorAll('#authorization-signature-image-field h1').forEach((h1) => h1.remove());
    expect(paycomAdapter.requiredBlocksLeft!(root)).toEqual([]);
    removeFixtures(document);
    // No pad shown (before the acknowledgement): none.
    const before = await open('apply-3');
    expect(paycomAdapter.requiredBlocksLeft!(paycomAdapter.detect(before)!.formRoot)).toEqual([]);
  });

  it('PC7-06: "Application Submitted!" beside its buttons, on the confirmation alone; its buttons never pressed',
    async () => {
      const doc = await open('confirmation');
      expect(paycomAdapter.detect(doc)).toBeNull();
      const signs = signsOf(doc, 'paycom');
      expect(signs.map(words)).toEqual(['Application Submitted!']);
      const buttons = Array.from(doc.querySelectorAll('#ats-portal button')).filter((button) =>
        /^(?:Export Application|Set Up Password)$/.test(words(button)));
      expect(buttons.length).toBe(2);
      const never = paycomAdapter.neverPress!(doc.body);
      for (const button of buttons) expect(never.includes(button)).toBe(true);
      // Its companion gone: no sign.
      buttons.forEach((button) => button.remove());
      expect(signsOf(doc, 'paycom')).toEqual([]);
      removeFixtures(document);
      for (const name of Object.keys(PAGES).filter((each) => each !== 'confirmation') as Name[]) {
        expect(signsOf(await open(name), 'paycom'), name).toEqual([]);
        removeFixtures(document);
      }
    }, 60_000);
});
