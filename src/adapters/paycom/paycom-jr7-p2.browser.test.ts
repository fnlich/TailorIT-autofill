/*
 * jr7 DFPC-7 P2 (SP\jr7\FIX7PLAN.md §6.11, Paycom; PC7-04's shared half): the Paycom adapter on the owner's snapshot7
 * paycomonline1 captures after jr7-engine-e2 (ENGINE-7's two edits for Paycom, d764216: a declared aria-hidden
 * decoration draws its control's box; a native select alone in a role=listbox wrapper is a field), jr7-rules-r2,
 * jr7-auto-done and jr7-chain-done, planned with the golden synthetic profile and DEFAULT_SETTINGS:
 * - the one-page application reads every box, textarea, select and date as a field a person can fill, but the
 *   account's locked email and the Country combo boxes (a list no capture shows open);
 * - the plan writes the profile's names, address, school, degree, dates (guessed days), employer and title; the
 *   Authorization's acknowledgement is required and ticked (its signature pad then the person's, PC7-07);
 * - the contact dialog's boxes take the profile's names, email and phone;
 * - two expected failures, for INT-7 to flip once their owners land them (exact edits in SP\jr7\build\DFPC-7.md):
 *   a drawn radio's words (ENGINE-7: hiddenOwnLabelSays reads an aria-hidden part of the radio's own visible label,
 *   not only a label hidden whole), and an employer's phone never written with the person's own (RULES-7).
 * The account capture's dialog fields sit under an aria-hidden wrapper the live dialog does not keep (lifted here).
 */
import { afterEach, describe, expect, it } from 'vitest';
import account from '../../../fixtures/paycom/jr7-paycomonline1-account.html?raw';
import prescreen from '../../../fixtures/paycom/jr7-paycomonline1-prescreen.html?raw';
import apply2 from '../../../fixtures/paycom/jr7-paycomonline1-apply-2.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult } from '../../dom/types';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { paycomAdapter } from './index';

afterEach(() => removeFixtures(document));

function plan(result: ScanResult): PlanOutput {
  return planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Example Employer', location: 'Remote, US' },
    repeatables: [{ kind: 'experience', entries: null }, { kind: 'education', entries: null }] });
}

/** A capture's scan and plan, and each field's outcome by its control's selector. */
async function planned(html: string, lift = false) {
  const { doc } = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  if (lift) {
    doc.querySelectorAll('[role="dialog"] [aria-hidden="true"]').forEach((el) => {
      if (el.querySelector('input') !== null) el.removeAttribute('aria-hidden');
    });
  }
  const root = paycomAdapter.detect(doc)!.formRoot;
  const result = scan(root, paycomAdapter, { platform: 'paycom' });
  const output = plan(result);
  const at = (css: string) => {
    const el = doc.querySelector(css);
    const field = result.fields.find((each) => {
      const target = result.target(each.key);
      return target !== null && (target.control === el || target.members.includes(el as HTMLInputElement));
    });
    if (field === undefined) throw new Error(`no field at ${css}`);
    return { field, row: output.results.find((each) => each.key === field.key)!,
      write: output.writes.find((each) => each.key === field.key),
      fill: fillabilityOf(field, result.target(field.key)?.widget ?? undefined) };
  };
  return { doc, result, output, at };
}

const textOf = (write: PlanOutput['writes'][number] | undefined) =>
  (write?.value as { kind?: string; text?: string } | undefined)?.text;
const optionOf = (write: PlanOutput['writes'][number] | undefined) =>
  (write?.value as { kind?: string; cleanLabel?: string } | undefined)?.cleanLabel;

describe('jr7 DFPC-7 P2: Paycom\'s fields fill, after ENGINE-7\'s two edits', () => {
  it('PC7-04: apply-2 reads 101 fields, 94 a person can fill: all but the locked email and the Country combo boxes',
    async () => {
      const { result } = await planned(apply2);
      expect(result.fields.length).toBe(101);
      // jr7 INT-7: the reason read where the union is narrowed (tsc: a filter's callback does not narrow it).
      const unfillable = result.fields.flatMap((field) => {
        const fill = fillabilityOf(field, result.target(field.key)?.widget ?? undefined);
        return fill.fillable ? [] : [{ field, fill }];
      });
      expect(result.fields.length - unfillable.length).toBe(94);
      expect(unfillable.map(({ field, fill }) => `${field.label}: ${fill.reason}`).sort()).toEqual([
        'Country: widget-phase-4', 'Country: widget-phase-4', 'Country: widget-phase-4', 'Country: widget-phase-4',
        'Country: widget-phase-4', 'Country: widget-phase-4', 'Email Address: disabled-or-readonly']);
      // Every outlined box, textarea and native select now reads drawn (none camouflaged), and the 14 selects are fields.
      expect(unfillable.some(({ fill }) => fill.reason === 'camouflaged')).toBe(false);
      expect(result.fields.filter((field) => field.kind === 'select').length).toBe(14);
      expect(result.fields.filter((field) => field.kind === 'textarea').length).toBe(4);
    });

  it('PC7-04: the plan writes the profile\'s names, address, school, degree, dates, employer and title', async () => {
    const { at } = await planned(apply2);
    expect(textOf(at('#personal-information-legal-first-name-field').write)).toBe('Alex');
    expect(textOf(at('#personal-information-legal-last-name-field').write)).toBe('Rivera');
    expect(textOf(at('#personal-information-street-address-field').write)).toBe('4417 Quillfeather Lane');
    expect(textOf(at('#personal-information-city-field').write)).toBe('Austin');
    expect(optionOf(at('#personal-information-state-field').write)).toBe('Texas');
    expect(textOf(at('#personal-information-zipcode-field').write)).toBe('78701');
    expect(textOf(at('#education-institution-name-field-2').write)).toBe('The University of Texas at Austin');
    expect(optionOf(at('#education-degree-field-2').write)).toBe('Bachelors');
    expect(textOf(at('#employment-employer-name-field-2').write)).toBe('Quillfeather Labs');
    expect(textOf(at('#employment-job-title-field-2').write)).toBe('Senior Software Engineer');
    // A date drawn in three boxes is one date: the profile's month, its day the 1st and flagged (DF7-04's rule).
    const start = at('#education-start-date-field-2 .uiLibDateInputFacade');
    expect(start.field.kind).toBe('date');
    expect(start.write?.value).toMatchObject({ kind: 'date', iso: '2015-08-01' });
    expect(start.row.reason).toBe('filled-low-confidence');
    // The locked account email is read, never written.
    expect(at('#personal-information-email-address-field').write).toBeUndefined();
  });

  it('PC7-04: the Authorization\'s acknowledgement is required and ticked; the Ethnicity list is labelled', async () => {
    const { at } = await planned(apply2);
    const ack = at('#authorization-acknowledge-disclosure-field');
    expect(ack.field.label).toMatch(/^I hereby acknowledge that I have read the above disclosure/);
    expect(ack.field.required).toBe(true);
    expect(ack.write?.value).toEqual({ kind: 'check' });
    const ethnicity = at('select[data-testid="Ethnicity-select"]');
    expect(ethnicity.field.label).toBe('Ethnicity');
    expect(ethnicity.fill.fillable).toBe(true);
  });

  it('PC7-05: the contact dialog\'s boxes take the profile\'s names, email and phone', async () => {
    const { at } = await planned(account, true);
    expect(textOf(at('input#firstName').write)).toBe('Alex');
    expect(textOf(at('input#lastName').write)).toBe('Rivera');
    const email = textOf(at('input#email').write);
    expect(email).toMatch(/@example\.com$/);
    expect(textOf(at('input#confirmEmail').write)).toBe(email);
    expect(textOf(at('input[name="candidate-primary-phone-field"]').write)).toBe('512 555 0147');
    for (const css of ['input#firstName', 'input#lastName', 'input#email', 'input#confirmEmail']) {
      expect(at(css).fill.fillable, css).toBe(true);
    }
  });

  it('PC7-04: a drawn radio\'s own words are what its adapter reads (optionTextFor), never its aria-label', async () => {
    const { doc } = await loadFixture(document, prescreen, SNAPSHOT_VIEWPORT);
    const radios = Array.from(doc.querySelectorAll<HTMLInputElement>('input.uiLibRadioInput'));
    expect(radios.map((radio) => paycomAdapter.optionTextFor!(radio))).toEqual(['Yes', 'No']);
    expect(radios.map((radio) => radio.getAttribute('aria-label')?.trim())).toEqual(['Yes 1 of 2.', 'No 2 of 2.']);
  });

  // ENGINE-7 E3-1 (DFPC-7's edit 5, jr7-engine-e3): hiddenOwnLabelSays also reads an aria-hidden part of the radio's
  // own shown label (Paycom's aria-hidden <p>), so the options read their words. Flipped by INT-7 once e3 merged.
  it('PC7-04 (ENGINE-7 E3-1): the pre-screen\'s options read "Yes" and "No", and work authorization plans "Yes"',
    async () => {
      const { at } = await planned(prescreen);
      const question = at('input.uiLibRadioInput');
      expect(Array.isArray(question.field.options) && question.field.options.map((option) => option.label))
        .toEqual(['Yes', 'No']);
      expect(question.row.category).toBe('workAuth.authorized');
      expect(optionOf(question.write)).toBe('Yes');
    });

  // RULES-7 R3-1 (DFPC-7's edit 6, jr7-rules-r3): a job's or school's block never takes contact.phone, so the
  // person's own phone is never planned into an employer's phone box. Flipped by INT-7 once r3 merged.
  it('PC7-04 (RULES-7 R3-1): an employer\'s phone is never written with the person\'s own phone', async () => {
    const { at } = await planned(apply2);
    const phone = at('#employment-employer-phone-number-field-2');
    expect(phone.field.section).toMatchObject({ id: 'experience', block: 0 });
    expect(phone.write).toBeUndefined();
  });
});
