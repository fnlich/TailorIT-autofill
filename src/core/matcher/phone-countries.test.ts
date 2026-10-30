/*
 * A real phone country picker, as a fixture (phone-countries.fixture.json): Greenhouse's intl-tel-input list, whose
 * items show a country's name and its dial code side by side ("Afghanistan+93"). The dial code is no part of the
 * country's name, so every country must still choose its own item, and none another's; before the matcher left dial
 * codes out, no country could match at all, and the phone's required Country field was left blank on every Greenhouse
 * application.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { intendedCountry } from './intended';
import { doneMatch, inputOf, outcomeOf, prepared, vocab } from './matcher.testkit';

const fixture = JSON.parse(readFileSync(new URL('./phone-countries.fixture.json', import.meta.url), 'utf8')) as {
  options: Array<[name: string, dialCode: string, code: string]>;
};

describe('a phone country picker’s list (intl-tel-input on Greenhouse)', () => {
  it('holds the 244 items it was captured with, each with its dial code', () => {
    expect(fixture.options).toHaveLength(244);
    for (const [, dial] of fixture.options) expect(dial).toMatch(/^\+\d{1,4}$/);
  });

  it('chooses each country’s own item, read as the page shows it, and never another country’s', () => {
    const options = prepared(fixture.options.map(([name, dial]) => `${name}${dial}`), 'country');
    const wrong: string[] = [];
    let own = 0;
    for (const [at, [name, , code]] of fixture.options.entries()) {
      const match = doneMatch(outcomeOf(inputOf(intendedCountry(code, name, vocab), options, 'country'), false));
      if (match.optionIndex === at) own += 1;
      else if (match.optionIndex !== null) wrong.push(`${code} chose ${fixture.options[match.optionIndex]![0]}`);
    }
    expect(wrong).toEqual([]);
    expect(own).toBe(244);
  });

  it('reads a dial code before or after the name, bracketed or not, and only in the country domain', () => {
    const us = intendedCountry('US', 'United States', vocab);
    for (const labels of [['United States +1', 'Canada +1'], ['+1 United States', '+1 Canada'],
      ['United States (+1)', 'Canada (+1)'], ['Jersey +44 1534', 'United States+1']]) {
      expect(doneMatch(outcomeOf(inputOf(us, labels, 'country'), false)).optionIndex, labels.join(' / '))
        .toBe(labels.findIndex((label) => label.includes('United States')));
    }
    const [plan] = prepared(['Plan +1'], 'generic').list;
    expect(plan!.norm.key).toBe('plan 1');
    expect(prepared(['Afghanistan+93'], 'country').list[0]!.clean).toBe('Afghanistan+93');
  });
});
