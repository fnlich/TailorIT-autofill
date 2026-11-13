/*
 * jr8 (the owner's report of 2026-11-13, snapshot10: Ashby's Honeydew form): "What is your primary state of
 * residence?", a list of the states' two-letter codes, was left empty. The question is the page's own text (never an
 * answer); every value here is the golden profile's or built in code from it.
 * - The rules read the question as the state the person lives in (label.residence-state): the AI's screen reads a
 *   list of the states' codes as naming the TN visa, so it would never classify it.
 * - The profile's region, written "Texas" or "TX", picks "TX" from a list of codes and "Texas" from a list of names; a
 *   list without the person's state gets nothing (never a wrong state).
 * - A long list it searches (none of the options read is the state) types the state's name, then its code: a list of
 *   codes filters "Texas" to nothing.
 */
import { describe, expect, it } from 'vitest';
import { searchCandidates } from '../matcher/candidates';
import { intendedRegion } from '../matcher/intended';
import { canonicalizeProfile } from '../profile/canonicalize';
import { classifyField } from '../resolver/resolve';
import type { WriteValue } from '../types/intent';
import type { Profile } from '../types/profile';
import { fieldOf, goldenWire, NOW, planOf, specOf, vocab } from './plan.testkit';

/** The question as snapshot10 draws it (two spaces after "What"). */
const QUESTION = 'What  is your primary state of residence?';
/** The states' and DC's two-letter codes, as the form lists them. */
const CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
const NAMES = ['Alabama', 'California', 'New York', 'Ohio', 'Tennessee', 'Texas', 'Utah', 'Washington'];

/** The golden profile with its address's region written as `region`, canonicalized as the worker does. */
function livingIn(region: string): Profile {
  const wire = goldenWire();
  const address = { ...wire.profile.contact.address, region };
  const profile = { ...wire.profile, contact: { ...wire.profile.contact, address } };
  return canonicalizeProfile(profile, wire.sensitive, vocab, NOW).profile;
}

/** The option a plan chose for the field, by its label; null when it writes none. */
function chosen(value: WriteValue | undefined, options: readonly string[]): string | null {
  return value?.kind === 'option' ? options[value.index] ?? null : null;
}

describe('jr8: the state of residence asked as a question', () => {
  it('is the state the person lives in, by the rules, whether its list is read or not', () => {
    for (const label of [QUESTION, 'What is your state of residence?', 'Primary state of residence']) {
      for (const optionLabels of [undefined, CODES]) {
        const spec = specOf(label, 'combobox', optionLabels === undefined ? { options: 'lazy' } : { optionLabels });
        const classified = classifyField(spec, vocab);
        expect(classified.by === 'rules' ? [classified.rules.category, classified.rules.rule] : classified.by)
          .toEqual(['address.region', 'label.residence-state']);
      }
    }
  });

  it('leaves a question about another state alone', () => {
    for (const label of ['What is the state of residence of your employer?', 'What state is the role in?',
      'What is your primary state of residence for tax purposes, if different?']) {
      const classified = classifyField(specOf(label, 'combobox', { optionLabels: CODES }), vocab);
      expect(classified.by === 'rules' ? classified.rules.rule : null).not.toBe('label.residence-state');
    }
  });
});

describe('jr8: the profile region on a list of codes or of names', () => {
  it('picks the code from a list of codes, the region written "Texas" or "TX"', () => {
    for (const region of ['Texas', 'TX']) {
      const spec = specOf(QUESTION, 'combobox', { optionLabels: CODES, required: true });
      const { write, row } = fieldOf(planOf([spec], { profile: livingIn(region) }), spec);
      expect([region, chosen(write?.value, CODES), row.category]).toEqual([region, 'TX', 'address.region']);
    }
  });

  it('picks the name from a list of names', () => {
    for (const region of ['Texas', 'TX']) {
      const spec = specOf(QUESTION, 'combobox', { optionLabels: NAMES, required: true });
      expect(chosen(fieldOf(planOf([spec], { profile: livingIn(region) }), spec).write?.value, NAMES)).toBe('Texas');
    }
  });

  it('chooses no other state from a list without the person\'s', () => {
    const codes = CODES.filter((code) => code !== 'TX');
    const spec = specOf(QUESTION, 'combobox', { optionLabels: codes.slice(0, 40), required: true });
    const { write, row } = fieldOf(planOf([spec], { profile: livingIn('Texas') }), spec);
    expect(write).toBeUndefined();
    expect(row).toMatchObject({ wrote: false, category: 'address.region' });
  });
});

describe('jr8: a long list searched for the state', () => {
  it('types the state\'s name, then its code', () => {
    expect(searchCandidates(intendedRegion({ code: 'TX', name: 'Texas' }, 'US', 'TX', vocab), vocab))
      .toEqual(['Texas', 'TX', 'Tex.']);
    expect(searchCandidates(intendedRegion({ code: 'ON', name: 'Ontario' }, 'CA', 'ON', vocab), vocab).slice(0, 2))
      .toEqual(['Ontario', 'ON']);
  });

  it('searches a list of 50 codes or more that does not show the state, by its name, then its code', () => {
    // Every USPS code but the person's, sorted: the list a page draws 50 of at a time.
    const codes = [...CODES, 'AA', 'AE', 'AP', 'AS', 'GU', 'MP', 'PR', 'VI'].sort().filter((code) => code !== 'TX')
      .slice(0, 50);
    const spec = specOf(QUESTION, 'combobox', { optionLabels: codes, required: true });
    const { write } = fieldOf(planOf([spec], { profile: livingIn('Texas') }), spec);
    expect(write?.value).toMatchObject({ kind: 'query', queries: ['Texas', 'TX', 'Tex.'] });
  });
});
