/*
 * Snapshot round 2, decision 2 (phone-order.ts): a pass writes a phone's country before its number, in each section,
 * whatever order its edges gave; everything else keeps its order.
 */
import { describe, expect, it } from 'vitest';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { phoneCountryFirst } from './phone-order';

const item = (key: string, category: FillResult['category'], section: string) => ({
  write: { key, value: { kind: 'text', text: '' } } as unknown as PlannedWrite,
  planned: { key, category, section } as unknown as FillResult,
});

describe('phoneCountryFirst', () => {
  it("moves a phone's country before its number in the same section, and leaves the rest in order", () => {
    const name = item('name', 'identity.firstName', 'main');
    const phone = item('phone', 'contact.phone', 'main');
    const email = item('email', 'contact.email', 'main');
    const country = item('country', 'contact.phoneCountry', 'main');
    expect(phoneCountryFirst([name, phone, email, country]).map((entry) => entry.write.key))
      .toEqual(['name', 'country', 'phone', 'email']);
    expect(phoneCountryFirst([country, phone]).map((entry) => entry.write.key)).toEqual(['country', 'phone']);
    // Another section's number is not this country's.
    const other = item('other-phone', 'contact.phone', 'references[0]');
    expect(phoneCountryFirst([other, country, phone]).map((entry) => entry.write.key))
      .toEqual(['other-phone', 'country', 'phone']);
    expect(phoneCountryFirst([phone, email]).map((entry) => entry.write.key)).toEqual(['phone', 'email']);
  });
});
