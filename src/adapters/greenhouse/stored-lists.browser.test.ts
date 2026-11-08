/*
 * Greenhouse's stored lists (snapshot round 2, decisions 1 and 2; the worker's background/stored-lists.ts, named by id
 * in adapters/greenhouse/lists.ts and served to a run's scans by lists/known: here, as it serves them): the phone's 244
 * countries and the EEOC block's three fixed questions are the captures' own lists, as a whole read takes them; the
 * phone's country (fieldset.phone-input's "Country") is read as the phone's ("Country code", contact.phoneCountry), with
 * its stored list, so it is planned on the first pass, from the phone's own country (snapshot3's Lightning AI and
 * snapshot2's forms chose the address's "+1" for a +91 phone), and the number beside it is planned without its code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import lightningHtml from '../../../fixtures/greenhouse/s2-lightning-0.html?raw';
import genderOpenHtml from '../../../fixtures/greenhouse/s2-pie-eeo-6.html?raw';
import hispanicOpenHtml from '../../../fixtures/greenhouse/s2-pie-eeo-7.html?raw';
import veteranOpenHtml from '../../../fixtures/greenhouse/s2-pie-eeo-8.html?raw';
import countryOpenHtml from '../../../fixtures/greenhouse/rushdown-country-open.html?raw';
import profileJson from '../../../fixtures/profiles/alex-rivera.profile.json';
import sensitiveJson from '../../../fixtures/profiles/alex-rivera.sensitive.json';
import phoneCountries from '../../core/matcher/phone-countries.fixture.json';
import type { AutofillProfile, AutofillSensitive } from '../../contract/tailorit';
import { GOLDEN_RESUME, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import { attachResume, canonicalizeProfile } from '../../core/profile/canonicalize';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { readList } from '../../dom/widgets';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { greenhouseAdapter } from './index';
import {
  EEOC_GENDER, EEOC_HISPANIC, EEOC_VETERAN, GREENHOUSE_PHONE_COUNTRIES, STORED_LISTS,
} from '../../background/stored-lists';
import type { StoredListId } from '../../shared/learned-lists';

/** The stored lists as the worker serves a run (lists/known): every scan of the run gets them. */
const SERVED: ReadonlyMap<StoredListId, readonly string[]> =
  new Map(Object.entries(STORED_LISTS) as Array<[StoredListId, readonly string[]]>);

afterEach(() => removeFixtures(document));

async function load(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  return { ...fixture, root: greenhouseAdapter.detect(fixture.doc)!.formRoot };
}

/** The golden person with another phone (canonicalized, the golden sensitive part, the golden resume attached). */
function personWith(phone: Partial<AutofillProfile['contact']['phone']>): Profile {
  const wire = profileJson as unknown as AutofillProfile;
  const contact = { ...wire.contact, phone: { ...wire.contact.phone, ...phone } };
  return attachResume(canonicalizeProfile({ ...wire, contact }, sensitiveJson as unknown as AutofillSensitive, testVocab(),
    NOW).profile, GOLDEN_RESUME, 48_213);
}

describe("Greenhouse's stored lists are the captures' own", () => {
  it('the phone country: rushdown-country-open\'s 244 options, the 2026-10-29 captures\' pairs and Pie\'s intl-tel-input list', async () => {
    const page = await load(countryOpenHtml);
    const listbox = page.doc.getElementById(page.doc.getElementById('country')!.getAttribute('aria-controls')!)!;
    const read = await readList(listbox, { drawnWhole: true });
    expect(read.complete).toBe(true);
    expect(read.options.map((option) => option.label)).toEqual(GREENHOUSE_PHONE_COUNTRIES);
    const pairs = (phoneCountries as unknown as { options: Array<[string, string, string]> }).options
      .map(([name, dial]) => `${name} ${dial}`);
    expect(GREENHOUSE_PHONE_COUNTRIES).toEqual(['United States +1', ...pairs.filter((label) => label !== 'United States +1')]);
    removeFixtures(document);
    // snapshot3's Pie Insurance (2026-11-07): intl-tel-input's own list beside the number, the same pairs.
    const pie = await load(veteranOpenHtml);
    const items = Array.from(pie.doc.querySelectorAll('ul#iti-0__country-listbox > li.iti__country')).map((item) =>
      `${item.querySelector('.iti__country-name')!.textContent} ${item.querySelector('.iti__dial-code')!.textContent}`);
    expect(new Set(items)).toEqual(new Set(GREENHOUSE_PHONE_COUNTRIES));
  });

  it.each([['gender', genderOpenHtml, EEOC_GENDER], ['hispanic_ethnicity', hispanicOpenHtml, EEOC_HISPANIC],
    ['veteran_status', veteranOpenHtml, EEOC_VETERAN]] as const)('EEOC %s: the list s2-pie-eeo shows open', async (id, html, stored) => {
    const page = await load(html);
    const input = page.doc.getElementById(id)!;
    expect(input.closest('div.eeoc__container')).not.toBeNull();
    const listbox = page.doc.getElementById(input.getAttribute('aria-controls')!)!;
    expect((await readList(listbox)).options.map((option) => option.label)).toEqual(stored);
  });
});

describe("the phone's country, read as the phone's, planned from its stored list", () => {
  it('scans "Country code", required, its 244 countries whole; EEOC Gender, Hispanic/Latino and Veteran with their lists', async () => {
    const page = await load(lightningHtml);
    const result = scan(page.root, greenhouseAdapter, { platform: 'greenhouse', storedLists: SERVED });
    const country = result.fields.find((field) => field.idAttr === 'country')!;
    expect(country).toMatchObject({ kind: 'combobox', label: 'Country code', labelSource: 'adapter', required: true });
    expect(country.options === 'lazy' ? 'lazy' : country.options.map((option) => option.label)).toEqual(GREENHOUSE_PHONE_COUNTRIES);
    expect(country.optionsPartial).toBeUndefined();
    expect(result.target(country.key)!.widget).toMatchObject({ knownFrom: 'adapter', drawnWhole: true });
    for (const [id, stored] of [['gender', EEOC_GENDER], ['hispanic_ethnicity', EEOC_HISPANIC],
      ['veteran_status', EEOC_VETERAN]] as const) {
      const field = result.fields.find((each) => each.idAttr === id)!;
      expect(field.options === 'lazy' ? 'lazy' : field.options.map((option) => option.label), id).toEqual(stored);
    }
    // The adapter names the lists by id; a scan the worker served none reads them lazy, as before.
    expect(result.target(country.key)!.widget?.storedList).toBe('greenhouse.phone-countries');
    const unserved = scan(page.root, greenhouseAdapter, { platform: 'greenhouse' });
    expect(unserved.fields.filter((field) => ['country', 'gender', 'hispanic_ethnicity', 'veteran_status']
      .includes(field.idAttr)).map((field) => field.options)).toEqual(['lazy', 'lazy', 'lazy', 'lazy']);
    // Any other react-select is lazy until read, as before.
    expect(result.fields.filter((field) => field.kind === 'combobox' && field.options === 'lazy').length).toBeGreaterThan(0);
  });

  it('chooses the phone\'s own country, India for a +91 phone beside a home in the United States, and the number without its code', async () => {
    const page = await load(lightningHtml);
    const specs = scan(page.root, greenhouseAdapter, { platform: 'greenhouse', storedLists: SERVED }).fields.map(toFieldSpec);
    const keyOf = (id: string) => specs.find((spec) => spec.idAttr === id)!.key;
    for (const [phone, wanted, number] of [
      [{ number: '+91 98765 43210', country: 'IN' }, 'India +91', '98765 43210'],
      [{ number: '+1 512 555 0147', country: 'US' }, 'United States +1', '512 555 0147'],
      [{ number: '+44 20 7946 0958', country: 'GB' }, 'United Kingdom +44', '20 7946 0958'],
    ] as const) {
      const plan = planFrame({ specs, canaries: [], profile: personWith(phone), sensitiveState: 'loaded', savedAnswers: [],
        settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
      expect(plan.results.find((row) => row.key === keyOf('country')), wanted).toMatchObject({
        category: 'contact.phoneCountry' });
      expect(plan.writes.find((write) => write.key === keyOf('country')), wanted).toMatchObject({ value: { kind: 'option',
        index: GREENHOUSE_PHONE_COUNTRIES.indexOf(wanted), cleanLabel: wanted } });
      expect(plan.writes.find((write) => write.key === keyOf('phone')), wanted).toMatchObject({ value: { kind: 'text',
        text: number } });
    }
  });
});
