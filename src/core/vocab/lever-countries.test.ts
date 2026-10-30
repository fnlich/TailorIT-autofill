import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { intendedCountry } from '../matcher/intended';
import { finalMatch, inputOf, vocab } from '../matcher/matcher.testkit';
import { canonicalCountry } from '../profile/entities';

// A real ATS country list, as a fixture (lever-countries.fixture.json): every option the vocabulary should know is
// known, by its label (canonicalCountry) and as the option a profile's country code chooses (the matcher). Kosovo is
// no ISO 3166-1 country, and "Congo" names both Congos in the vocabulary, so a Republic of the Congo profile is left
// blank on this list; only the list itself (it names the other Congo apart) could say which one it means.

const fixture = JSON.parse(readFileSync(new URL('./lever-countries.fixture.json', import.meta.url), 'utf8')) as {
  options: Array<[label: string, code: string]>;
};
const labels = fixture.options.map(([label]) => label);
const known = fixture.options.filter(([label, code]) => code !== 'XK' && label !== 'Congo');

describe('the Lever country list', () => {
  it('holds the 250 options it was captured with', () => {
    expect(fixture.options).toHaveLength(250);
  });

  it.each(known)('reads %j as %s', (label, code) => {
    expect(canonicalCountry(label, vocab)).toEqual({ value: code, issues: [] });
  });

  it('chooses each country\'s own option for a profile that holds its code', async () => {
    const wrong: string[] = [];
    for (const [, code] of known) {
      const { match } = await finalMatch(inputOf(intendedCountry(code, code, vocab), labels, 'country'));
      const chosen = match.optionIndex === null ? null : fixture.options[match.optionIndex]![1];
      if (chosen !== code) wrong.push(`${code} chose ${chosen}`);
    }
    expect(wrong).toEqual([]);
  });

  it('leaves the Republic of the Congo blank rather than guess which Congo "Congo" is', async () => {
    const { match } = await finalMatch(inputOf(intendedCountry('CG', 'CG', vocab), labels, 'country'));
    expect(match.optionIndex).toBeNull();
  });

  it('keeps "Congo" for neither Congo when it is all a profile says', () => {
    expect(canonicalCountry('Congo', vocab).issues).toEqual([{ path: 'country', code: 'country-unknown' }]);
  });
});
