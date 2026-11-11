import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import type { FieldCategory } from '../types/intent';
import { NAME_ID_RULES, nameIdRule, nameIdText, WHOLE_TOKEN_ONLY } from './nameId';

describe('NAME_ID_RULES (§8.3)', () => {
  it('holds the design’s generic patterns and nothing platform-specific', () => {
    expect(NAME_ID_RULES.map((rule) => [rule.id, rule.pattern])).toEqual([
      ['name-id.first-name', 'first_?name|fname|given_?name'],
      ['name-id.last-name', 'last_?name|lname|surname|family_?name'],
      ['name-id.email', 'e_?mail'],
      ['name-id.phone', 'phone|mobile|tel'],
      ['name-id.linkedin', 'linkedin'],
      ['name-id.github', 'github'],
      // s2 core-wd: Workday's name="twitterAccount", the "X" box (fixtures/workday/s2-verily-field-of-study-open).
      ['name-id.twitter', 'twitter'],
      ['name-id.resume', 'resume|cv'],
      ['name-id.cover-letter', 'cover_?letter'],
      // jr6 RULES: Workday's agreement box, name="acceptTermsAndAgreements" (WD-09), and iCIMS's address search, name
      // "…PersonProfileFields.AddressStreet1" (ICIMS-08), each read from an owner's snapshot.
      ['name-id.accept-terms', 'accepttermsandagreements'],
      ['name-id.address-street1', 'addressstreet1'],
    ]);
    for (const abbreviation of WHOLE_TOKEN_ONLY) {
      expect(NAME_ID_RULES.some((rule) => rule.pattern.split('|').includes(abbreviation)), abbreviation).toBe(true);
    }
  });
});

describe('nameIdText', () => {
  it.each([
    ['job_application[first_name]', 'first', 'job_application_first_name first'],
    ['first-name', '', 'first_name'],
    ['First.Name', '', 'first_name'],
    ['', 'emailAddress', 'emailaddress'],
    ['urls[LinkedIn]', '', 'urls_linkedin'],
    ['a  b', 'c__d--e', 'a_b c_d_e'],
    ['', '', ''],
    ['[]', '_', ''],
  ])('%j and %j give %j', (nameAttr, idAttr, text) => {
    expect(nameIdText(nameAttr, idAttr)).toBe(text);
  });
});

describe('nameIdRule', () => {
  it.each<[string, string, FieldKind, FieldCategory, number]>([
    // Whole tokens: 0.95.
    ['first_name', '', 'text', 'identity.firstName', 0.95],
    ['job_application[first_name]', 'first_name', 'text', 'identity.firstName', 0.95],
    ['firstName', '', 'text', 'identity.firstName', 0.95],
    ['first-name', '', 'text', 'identity.firstName', 0.95],
    ['fname', '', 'text', 'identity.firstName', 0.95],
    ['', 'given_name', 'text', 'identity.firstName', 0.95],
    ['last_name', '', 'text', 'identity.lastName', 0.95],
    ['lname', '', 'text', 'identity.lastName', 0.95],
    ['surname', '', 'text', 'identity.lastName', 0.95],
    ['familyName', '', 'text', 'identity.lastName', 0.95],
    ['email', '', 'text', 'contact.email', 0.95],
    ['e-mail', '', 'text', 'contact.email', 0.95],
    ['candidate.email', '', 'text', 'contact.email', 0.95],
    ['phone', '', 'text', 'contact.phone', 0.95],
    ['mobile', '', 'text', 'contact.phone', 0.95],
    ['tel', '', 'text', 'contact.phone', 0.95],
    ['phone_number', '', 'text', 'contact.phone', 0.95],
    ['urls[LinkedIn]', '', 'text', 'links.linkedin', 0.95],
    ['urls[GitHub]', '', 'text', 'links.github', 0.95],
    ['resume', '', 'file', 'file.resume', 0.95],
    ['cv', '', 'file', 'file.resume', 0.95],
    ['cover_letter', '', 'file', 'file.coverLetter', 0.95],
    ['coverLetter', '', 'textarea', 'freeText.coverLetter', 0.95],
    // Inside a token: 0.85.
    ['applicantFirstName', '', 'text', 'identity.firstName', 0.85],
    ['', 'emailAddress', 'text', 'contact.email', 0.85],
    ['phoneNumber', '', 'text', 'contact.phone', 0.85],
    ['telephone', '', 'text', 'contact.phone', 0.85],
    ['phone2', '', 'text', 'contact.phone', 0.85],
    ['linkedinUrl', '', 'text', 'links.linkedin', 0.85],
    ['resumeUpload', '', 'file', 'file.resume', 0.85],
    ['coverLetterText', '', 'textarea', 'freeText.coverLetter', 0.85],
    // Whole tokens are tried first, over every pattern.
    ['emailAddress', 'phone', 'text', 'contact.phone', 0.95],
  ])('name %j, id %j on a %s field gives %s at %s', (nameAttr, idAttr, kind, category, confidence) => {
    expect(nameIdRule(nameAttr, idAttr, kind)).toMatchObject({ category, confidence, exact: confidence === 0.95 });
  });

  it('names the pattern that matched', () => {
    expect(nameIdRule('job_application[email]', '', 'text')).toEqual({ category: 'contact.email', confidence: 0.95,
      rule: 'name-id.email', exact: true });
  });

  it.each<[string, string, FieldKind]>([
    ['', '', 'text'],
    ['question_12345', 'question_12345', 'text'],
    // Abbreviations count only as whole tokens.
    ['fullname', '', 'text'],
    ['fullName', 'full_name', 'text'],
    ['hotel_name', '', 'text'],
    ['cvUpload', '', 'file'],
    // The space between the two attributes is never crossed.
    ['first', 'name', 'text'],
    // A category the kind cannot hold is no match.
    ['phone_type', '', 'select'],
    ['email', '', 'checkbox'],
    ['resume', '', 'text'],
    ['cover_letter', '', 'select'],
  ])('name %j, id %j on a %s field gives nothing', (nameAttr, idAttr, kind) => {
    expect(nameIdRule(nameAttr, idAttr, kind)).toBeNull();
  });

  it.each<[string, string]>([
    // A part of the phone that is not its number: the person's number never goes in.
    ['phone_extension', ''],
    ['', 'phoneExtension'],
    ['', 'phone-number--extension'],
    ['phone_ext', ''],
    ['mobile_ext1', ''],
    ['phone_country_code', ''],
    ['telephoneCountry', ''],
    ['country_code', 'phone'],
  ])('name %j, id %j on a text field is no phone number', (nameAttr, idAttr) => {
    expect(nameIdRule(nameAttr, idAttr, 'text')).toBeNull();
  });

  it('still reads a phone whose attributes only look like a part', () => {
    expect(nameIdRule('phone_text_ok', '', 'text')?.category).toBe('contact.phone');
    expect(nameIdRule('cellphone', '', 'text')?.category).toBe('contact.phone');
  });

  it('tries the next pattern when the kind cannot hold the first one’s category', () => {
    expect(nameIdRule('upload_email_resume', '', 'file')).toMatchObject({ category: 'file.resume',
      rule: 'name-id.resume' });
  });

  it('reads Workday’s agreement box and iCIMS’s address search by their names (jr6 RULES: WD-09, ICIMS-08)', () => {
    expect(nameIdRule('acceptTermsAndAgreements', '', 'checkbox')).toEqual({ category: 'consent.terms',
      confidence: 0.95, rule: 'name-id.accept-terms', exact: true });
    expect(nameIdRule('', 'acceptTermsAndAgreements', 'radio')?.category).toBe('consent.terms');
    // A box is a consent's only on a box or a radio.
    expect(nameIdRule('acceptTermsAndAgreements', '', 'text')).toBeNull();
    expect(nameIdRule('acceptTerms', '', 'checkbox')).toBeNull();
    const street = 'rcf3048_PersonProfileFields.AddressStreet1';
    expect(nameIdRule(street, '-1_PersonProfileFields.AddressStreet1_icimsDropdown', 'combobox')).toMatchObject({
      category: 'address.lookup', rule: 'name-id.address-street1', exact: true });
    expect(nameIdRule(street, '', 'select')?.category).toBe('address.lookup');
    // The box that replaces the search takes the street; never a remote search.
    expect(nameIdRule(street, '', 'text')?.category).toBe('address.line1');
    expect(nameIdRule(street, '', 'typeahead-remote')).toBeNull();
    expect(nameIdRule('PersonProfileFields.AddressStreet2', '', 'combobox')).toBeNull();
  });
});
