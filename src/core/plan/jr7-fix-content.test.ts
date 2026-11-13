/*
 * jr7 FIX-content (the jr7 review's fixes in the core): D-5, a voluntary self-identification form's closing name is
 * its signature (Decision 16, docs/SPEC-AMENDMENTS.md), so it follows the Consents mode's signature pre-approval.
 * Synthetic specs; the golden synthetic profile fills them. Paycom's own capture is pinned in
 * src/dom/jr7-fix-content.browser.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../resolver/classifyRules';
import { DEFAULT_SETTINGS } from '../types/settings';
import { fieldOf, goldenProfile, planOf, settingsWith, specOf } from './plan.testkit';

const golden = goldenProfile();

describe("D-5: a voluntary self-identification form's closing name is its signature", () => {
  const named = (label: string, section: string, nameAttr = '') => specOf(label, 'text',
    { platform: 'paycom', section: { id: section }, ...(nameAttr === '' ? {} : { nameAttr }) });

  it('reads a name box in a section whose words name the form as the signature, whatever its name attribute says', () => {
    for (const [label, section] of [['Full Name', 'voluntary-information'], ['Name', 'voluntaryInformation'],
      ['Your Legal Name', 'voluntary-self-identification-of-disability'], ['Full Name', 'self-identification']]) {
      const spec = named(label!, section!, 'voluntary-information-full-name-field');
      expect(classifyByRules(spec), `${label} in ${section}`).toMatchObject({ category: 'consent.signature',
        rule: 'label.consent-signature' });
    }
  });

  it('never elsewhere, nor for any other box of the form', () => {
    // The same name box in the person's own section, or in a step named by a verb (Workday's "Self Identify", whose
    // Name jr6 WD-10 pins as the person's full name).
    for (const section of ['personal-information', 'self-identify', 'voluntary-disclosures', 'main']) {
      expect(classifyByRules(named('Full Name', section))?.category, section).toBe('identity.fullName');
    }
    // Another box of the form keeps its own reading.
    expect(classifyByRules(named('Employee ID (if applicable)', 'voluntary-information'))?.category)
      .toBe('identity.employeeId');
    expect(classifyByRules(named('First Name', 'voluntary-information'))?.category).toBe('identity.firstName');
    expect(classifyByRules(named('Emergency contact name', 'voluntary-information'))?.category)
      .not.toBe('consent.signature');
  });

  it('types the name only under the signature pre-approval: the Consents mode decides', () => {
    const spec = named('Full Name', 'voluntary-information', 'voluntary-information-full-name-field');
    // The defaults (Consents: All; the signature pre-approved): the name is typed, as the signature.
    const typed = fieldOf(planOf([spec]), spec);
    expect(typed.row.category).toBe('consent.signature');
    expect(typed.write?.value).toEqual({ kind: 'text', text: golden.identity.fullName });
    // Required only, the signature not pre-approved: nothing is typed; the box is the person's.
    const requiredOnly = settingsWith({ preapprovedConsent: DEFAULT_SETTINGS.preapprovedConsent
      .filter((kind) => kind !== 'signature'), modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' } });
    const left = fieldOf(planOf([spec], { settings: requiredOnly }), spec);
    expect(left.row.category).toBe('consent.signature');
    expect(left.write).toBeUndefined();
    // Before D-5 the box read as the person's full name, typed in every mode.
    const elsewhere = named('Full Name', 'personal-information', 'voluntary-information-full-name-field');
    expect(fieldOf(planOf([elsewhere], { settings: requiredOnly }), elsewhere).write?.value)
      .toEqual({ kind: 'text', text: golden.identity.fullName });
  });
});

describe('D-8: a work phone R4(b) leaves takes its own country code with it', () => {
  const contact = (label: string, nameAttr = '') => specOf(label, 'text', { platform: 'ukgready',
    section: { id: 'contact' }, ...(nameAttr === '' ? {} : { nameAttr }) });
  const written = (spec: ReturnType<typeof contact>, profile = golden) => {
    const value = fieldOf(planOf([spec], { profile }), spec).write?.value;
    return value?.kind === 'text' ? value.text : value?.kind;
  };

  it("leaves a work phone's code, by its label or its name, and keeps a home, cell or mobile phone's", () => {
    for (const spec of [contact('Work Phone country code'), contact('Business phone country code'),
      contact('Country code', 'work-phone-country-code')]) {
      expect(fieldOf(planOf([spec]), spec).row.category, spec.label).toBe('contact.phoneCountry');
      expect(written(spec), spec.label).toBeUndefined();
    }
    for (const label of ['Home Phone country code', 'Cell Phone country code', 'Mobile Phone country code',
      'Phone country code']) {
      expect(written(contact(label)), label).toBe(`+${golden.contact.phone!.countryCallingCode}`);
    }
    // The profile's one phone marked a work phone: the work phone's code is the person's again.
    const atWork = { ...golden, contact: { ...golden.contact, phone: { ...golden.contact.phone!, type: 'work' as const } } };
    expect(written(contact('Work Phone country code'), atWork)).toBe(`+${golden.contact.phone!.countryCallingCode}`);
  });
});
