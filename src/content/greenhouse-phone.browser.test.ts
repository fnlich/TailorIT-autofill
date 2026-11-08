/*
 * The phone's country on Greenhouse's form (2026-11-01), on the real react-select v5 in Greenhouse's wrapper
 * (fixtures/synthetic/greenhouse-widgets, its 'phone' form: the names, the email and the phone, served at .../9104 and
 * .../9105, the first with its phone and country answering each other): the content runtime fills it with the fake
 * worker planning each pass with the real planFrame and four people besides the golden one. Snapshot round 2
 * (decisions 1 and 2): the phone's country is the phone's ("Country code", contact.phoneCountry: the phone's own
 * country, never the address's), its 244 countries are its stored list, so it is planned on the first pass with the
 * number and chosen before it; its country is searched for by its name ("Canada"), typed into the select's own text
 * box after its one mouseup, and the one result that is it clicked (the bridge, which chooses it by its label, is the
 * e2e's); it reads back by its flag. The number is then typed without its dial code, which the country shows, so it
 * never picks a country of its own. Every event on a control is untrusted, the fillers' or the declared mouseup, and
 * nothing is submitted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageExpect from '../../fixtures/synthetic/greenhouse-widgets/phone.expect.json';
import pageHtml from '../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import { mountGreenhouseForm, mountHeaderButton, newLog, type GreenhouseLog } from '../../fixtures/synthetic/greenhouse-widgets/app';
import profileJson from '../../fixtures/profiles/alex-rivera.profile.json';
import sensitiveJson from '../../fixtures/profiles/alex-rivera.sensitive.json';
import { GREENHOUSE_ACTIVATION, greenhouseAdapter } from '../adapters/greenhouse/index';
import { compareWithExpectation, readExpectation } from '../adapters/test/expectations.testkit';
import type { AutofillProfile, AutofillSensitive } from '../contract/tailorit';
import { attachResume, canonicalizeProfile } from '../core/profile/canonicalize';
import type { FillResult } from '../core/types/fill';
import type { Profile } from '../core/types/profile';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { ALLOWED_EVENTS } from '../dom/fillers/events';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { createFakeWorker, GOLDEN_RESUME, NOW, sentinelsIn, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** The phone form, its phone and country answering each other (9104) or not (9105). */
const urlOf = (phonePicks: boolean) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/${phonePicks ? 9104 : 9105}`;

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
const mounted: Array<() => void> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const unmount of mounted.splice(0)) unmount();
  removeFixtures(document);
});

type Contact = AutofillProfile['contact'];

/** The golden person with another phone, and another home: canonicalized with the golden sensitive part, the golden
 *  resume attached (the mock's profile-* scenarios). */
function personWith(phone: Partial<Contact['phone']>, address: Partial<Contact['address']> = {}): Profile {
  const wire = profileJson as unknown as AutofillProfile;
  const contact = { ...wire.contact, phone: { ...wire.contact.phone, ...phone },
    address: { ...wire.contact.address, ...address } };
  return attachResume(canonicalizeProfile({ ...wire, contact }, sensitiveJson as unknown as AutofillSensitive,
    testVocab(), NOW).profile, GOLDEN_RESUME, 48_213);
}

/** The three people (e2e/mock-server's profile-phone-no-code, profile-canada and profile-uk), and (snapshot round 2) a
 *  phone of India's beside a home in the United States: the case the owner's snapshots chose "+1" for. */
const NO_CODE = () => personWith({ number: '512 555 0147', country: 'US' });
const INDIAN_PHONE = () => personWith({ number: '+91 98765 43210', country: 'IN' });
const CANADIAN = () => personWith({ number: '+1 512 555 0188', country: 'CA' },
  { city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', country: 'CA' });
const BRITON = () => personWith({ number: '+44 20 7946 0958', country: 'GB' },
  { city: 'London', region: '', postalCode: 'SW1A 1AA', country: 'GB' });

interface Page {
  fixture: Fixture;
  log: GreenhouseLog;
  events: EventLog;
  worker: FakeWorker;
  report: { fields: FillResult[] };
}

/** The phone form (the page's own module script left out: the test mounts the app). */
async function open(phonePicks: boolean, phoneClearsMs?: number): Promise<{ fixture: Fixture; log: GreenhouseLog }> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 1600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  mounted.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log, form: 'phone',
    phonePicks, ...(phoneClearsMs === undefined ? {} : { phoneClearsMs }) }).unmount);
  return { fixture, log };
}

/** The phone form, as its hand-written expectations say, filled once for `profile`. */
async function filled(profile: Profile, phonePicks: boolean, phoneClearsMs?: number): Promise<Page> {
  const { fixture, log } = await open(phonePicks, phoneClearsMs);
  const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  expect(compareWithExpectation(fixture.doc, scan(root, greenhouseAdapter, { platform: 'greenhouse' }),
    readExpectation(pageExpect))).toEqual([]);
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, profile });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => urlOf(phonePicks), isTop: true,
    settle: { quietMs: 200 } });
  runtimes.push(runtime);
  expect(await runtime.fill({})).not.toBeNull();
  return { fixture, log, events, worker, report: worker.reports.at(-1)! as unknown as { fields: FillResult[] } };
}

const row = (page: Page, label: string) => page.report.fields.find((candidate) => candidate.label === label)!;
const phoneBox = (page: Page) => page.fixture.doc.getElementById('phone') as HTMLInputElement;
const flagOf = (page: Page) => page.fixture.doc.getElementById('country')!.closest('.select__control')!
  .querySelector('.select__single-value .iti__flag')?.className ?? null;
const VERIFIED = { status: 'verified', wrote: true, verification: 'verified' } as const;

/** Untrusted events only, each the fillers' or the declared mouseup; nothing pressed, nothing submitted, no value in a
 *  report or a log (the phone's digits included). */
function expectInvariants(page: Page, digits: string): void {
  expect(untrustedViolations(page.events.events)).toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, ...GREENHOUSE_ACTIVATION]);
  expect(page.events.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  expect(page.events.events.filter((event) => ['mousedown', 'pointerdown', 'keydown', 'keyup', 'focus', 'focusin',
    'submit'].includes(event.type))).toEqual([]);
  expect(page.log.pressed).toEqual([]);
  const sentinels = [digits, digits.slice(-7)];
  expect(sentinelsIn(JSON.stringify(page.worker.reports), sentinels)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls), sentinels)).toEqual([]);
}

describe("the phone's country, chosen first, then the number typed without its code", () => {
  it('scans the phone country as "Country code" holding its stored 244 countries, planned on the first pass', async () => {
    const page = await filled(NO_CODE(), true);
    const first = page.worker.of('plan/request')[0]!;
    const specs = first.specs as Array<{ idAttr: string; label: string; options: unknown[] | 'lazy' }>;
    const country = specs.find((spec) => spec.idAttr === 'country')!;
    expect(country.label).toBe('Country code');
    expect(Array.isArray(country.options) ? country.options.length : country.options).toBe(244);
    // Planned on the first pass with the number: the country first.
    const order = page.report.fields.map((field) => field.label);
    expect(order.indexOf('Country code')).toBeLessThan(order.indexOf('Phone'));
    expect(row(page, 'Country code')).toMatchObject({ category: 'contact.phoneCountry' });
  });

  it('a phone with no country code: the United States typed and chosen, then the number as the profile writes it', async () => {
    const page = await filled(NO_CODE(), true);
    expect(row(page, 'Country code')).toMatchObject({ ...VERIFIED, kind: 'combobox', provenance: 'profile',
      category: 'contact.phoneCountry' });
    expect(page.log.values.country).toBe('us');
    expect(flagOf(page)).toBe('iti__flag iti__us');
    expect(page.log.typed.country).toEqual(['United States']);
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('512 555 0147');
    expectInvariants(page, '5125550147');
  });

  it("a Canadian's \"+1 512 ...\": Canada chosen before the number, which is typed without its \"+1\" and picks nothing", async () => {
    const page = await filled(CANADIAN(), true);
    expect(row(page, 'Country code')).toMatchObject({ ...VERIFIED, kind: 'combobox', provenance: 'profile' });
    expect(page.log.values.country).toBe('ca');
    expect(flagOf(page)).toBe('iti__flag iti__ca');
    expect(page.log.typed.country).toEqual(['Canada']);
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('512 555 0188');
    expect(page.log.values.phone).toBe('512 555 0188');
    expectInvariants(page, '15125550188');
  });

  it("a Briton's \"+44 20 ...\": the United Kingdom typed and chosen, the number typed nationally, on both pages", async () => {
    for (const phonePicks of [false, true]) {
      const page = await filled(BRITON(), phonePicks);
      expect(row(page, 'Country code')).toMatchObject({ ...VERIFIED, kind: 'combobox', provenance: 'profile' });
      expect(page.log.values.country).toBe('gb');
      expect(flagOf(page)).toBe('iti__flag iti__gb');
      expect(page.log.typed.country).toEqual(['United Kingdom']);
      expect(row(page, 'Phone')).toMatchObject(VERIFIED);
      expect(phoneBox(page).value).toBe('20 7946 0958');
      expectInvariants(page, '442079460958');
      removeFixtures(document);
    }
  });

  it('a number the page empties after the country is chosen is typed again, and holds', async () => {
    const page = await filled(NO_CODE(), false, 300);
    expect(row(page, 'Country code')).toMatchObject({ ...VERIFIED, category: 'contact.phoneCountry' });
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('512 555 0147');
    // Typed once, emptied by the page, typed once more: never more.
    const typed = page.events.events.filter((event) => event.type === 'input' && !event.trusted && event.target === 'phone');
    expect(typed).toHaveLength(2);
    expectInvariants(page, '5125550147');
  });

  it("a phone of India's beside a home in the United States: India chosen, never the address's \"+1\"", async () => {
    const page = await filled(INDIAN_PHONE(), true);
    expect(row(page, 'Country code')).toMatchObject({ ...VERIFIED, category: 'contact.phoneCountry' });
    expect(page.log.values.country).toBe('in');
    expect(flagOf(page)).toBe('iti__flag iti__in');
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('98765 43210');
    expectInvariants(page, '919876543210');
  });
});
