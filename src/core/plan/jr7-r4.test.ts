/*
 * jr7 RULES-7 R4 (RBP7-07, RBP-7's P2 on snapshot7 rippling1): a typed-name signature asked in a sentence past the
 * first 500 characters of a long help text, after words that name documents. The help texts here are synthetic,
 * written to the capture's shape (its length and the order of its words); the golden synthetic profile fills them.
 */
import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../resolver/classifyRules';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, planOf, specOf } from './plan.testkit';

const golden = goldenProfile();

/** Synthetic: about 560 characters certifying the documents submitted, then the ask for the typed name. */
const LONG_HELP = 'I certify that all of the information I have provided in this application, including my resume, my cover '
  + 'letters, my online profiles and any other materials or statements submitted with or in support of it, is true, '
  + 'correct and complete to the best of my knowledge and belief. I understand that any misrepresentation, falsification '
  + 'or material omission of information in this application or in any document, interview or test that is part of the '
  + 'hiring process may result in my not being hired or, if I am hired, in the end of my employment at any time. '
  + 'Please acknowledge this by typing your full name in the text field.';

describe('R4 (RBP7-07): a typed-name signature asked late in a long help text', () => {
  it('is past the first 500 characters, after words that name documents', () => {
    expect(LONG_HELP.length).toBeGreaterThan(500);
    expect(LONG_HELP.indexOf('typing your full name')).toBeGreaterThan(500);
  });
  it('reads the box as the signature and types the full name', () => {
    const spec = specOf('Truth Certification/Attestation Clause', 'text', { required: true, platform: 'rippling',
      description: LONG_HELP });
    expect(classifyByRules(spec)).toMatchObject({ asks: 'consent.signature', needsUser: 'description-only' });
    const { write, row } = fieldOf(planOf([spec]), spec);
    expect(row.category).toBe('consent.signature');
    expect(write?.value).toEqual({ kind: 'text', text: golden.identity.fullName });
  });
  it('never makes an upload whose help mentions the name a signature', () => {
    const upload = specOf('Resume', 'file', { required: true, platform: 'rippling', description: 'Upload your resume '
      + 'as a PDF. Please name the file with your full name, for example First Last Resume.' });
    expect(classifyByRules(upload)?.category).toBe('file.resume');
    // Even a help that asks for the name typed: a file input (its label naming nothing) takes no typed signature, so
    // the upload is never handed over as one.
    const asked = specOf('Attachment', 'file', { required: true, platform: 'rippling',
      description: `${LONG_HELP} Upload your resume as a PDF.` });
    const rules = classifyByRules(asked);
    expect(rules?.category ?? rules?.asks ?? null).not.toBe('consent.signature');
  });
  it('never makes a box whose help only says to type the name a signature', () => {
    const certifies = LONG_HELP.replace(/Please acknowledge.*$/, '');
    const plain = specOf('Attestation', 'text', { description: `${certifies} Please type your full name.` });
    const rules = classifyByRules(plain);
    expect(rules?.category ?? rules?.asks).not.toBe('consent.signature');
  });
});

describe('R4 (UKGREADY-7 P2): a second email and a work phone are no repeats of the person’s one', () => {
  const contact = (label: string, kind: 'text' = 'text', extra: { nameAttr?: string; ordinal?: number } = {}) =>
    specOf(label, kind, { platform: 'ukgready', section: { id: 'contact' }, ordinal: extra.ordinal ?? 0,
      ...(extra.nameAttr ? { nameAttr: extra.nameAttr } : {}) });
  const written = (spec: ReturnType<typeof contact>, profile = golden) => {
    const value = fieldOf(planOf([spec], { profile }), spec).write?.value;
    return value?.kind === 'text' ? value.text : value?.kind;
  };
  it('(a) leaves a secondary or alternate email, by its label or its name, and fills the primary', () => {
    for (const spec of [contact('Secondary Email'), contact('Alternate Email'), contact('Email', 'text',
      { nameAttr: 'secondaryEmail' })]) {
      expect(written(spec), spec.label).toBeUndefined();
    }
    expect(written(contact('Email'))).toBe(golden.contact.email);
  });
  it('(b) leaves a work phone unless the profile’s phone is a work phone; home, cell and mobile keep it', () => {
    expect(written(contact('Work Phone'))).toBeUndefined();
    expect(written(contact('Phone', 'text', { nameAttr: 'workPhone' }))).toBeUndefined();
    for (const label of ['Home Phone', 'Cell Phone', 'Mobile Phone', 'Phone']) {
      expect(written(contact(label)), label).toBeDefined();
    }
    const atWork: Profile = { ...golden, contact: { ...golden.contact, phone: { ...golden.contact.phone!, type: 'work' } } };
    expect(written(contact('Work Phone'), atWork)).toBeDefined();
  });
});
