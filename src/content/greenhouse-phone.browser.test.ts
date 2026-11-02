/*
 * The phone's country on Greenhouse's form (2026-11-01), on the real react-select v5 in Greenhouse's wrapper
 * (fixtures/synthetic/greenhouse-widgets, its 'phone' form: the names, the email and the phone, served at .../9104 and
 * .../9105, the first with its phone and country answering each other): the content runtime fills it with the fake
 * worker planning each pass with the real planFrame and three people besides the golden one. The phone's country lists
 * the live form's 244 countries, so the profile's country is searched for by its name ("Canada"), typed into the
 * select's own text box after its one mouseup, and the one result that is it clicked; it reads back by its flag. With
 * the phone and its country answering each other as on the live form (MountOptions.phonePicks): a number typed with a
 * dial code picks the country by itself, which stands only when it is the profile's (the United Kingdom for "+44 ..."),
 * never when it is another country of that code (the United States for a Canadian's "+1 512 ..."); and a country
 * chosen from the list draws the number in its national form ("(512) 555-0188"), which still holds the profile's
 * number: it is never typed again with its code, which the country already shows. Every event on a control is
 * untrusted, the fillers' or the declared mouseup, and nothing is submitted.
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

/** The three people (e2e/mock-server's profile-phone-no-code, profile-canada and profile-uk). */
const NO_CODE = () => personWith({ number: '512 555 0147', country: 'US' });
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
async function open(phonePicks: boolean): Promise<{ fixture: Fixture; log: GreenhouseLog }> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 1600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  mounted.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log, form: 'phone',
    phonePicks }).unmount);
  return { fixture, log };
}

/** The phone form, as its hand-written expectations say, filled once for `profile`. */
async function filled(profile: Profile, phonePicks: boolean): Promise<Page> {
  const { fixture, log } = await open(phonePicks);
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

describe("the phone's country, searched for by its name", () => {
  it('a phone with no country code: the United States typed and chosen, the number drawn nationally still its own', async () => {
    const page = await filled(NO_CODE(), true);
    expect(row(page, 'Country')).toMatchObject({ ...VERIFIED, kind: 'combobox', provenance: 'profile' });
    expect(page.log.values.country).toBe('us');
    expect(flagOf(page)).toBe('iti__flag iti__us');
    expect(page.log.typed.country).toEqual(['United States']);
    // Typed as the profile writes it; the country, once chosen, draws it "(512) 555-0147": the same digits.
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('(512) 555-0147');
    expectInvariants(page, '5125550147');
  });

  it("a Canadian's \"+1 512 ...\": the United States the number picked is replaced by Canada, typed, and the number drawn nationally holds the profile's", async () => {
    const page = await filled(CANADIAN(), true);
    // The page's own pick (the United States) was in the field: the profile's country replaced it, flagged for a look.
    expect(row(page, 'Country')).toMatchObject({ kind: 'combobox', provenance: 'profile', wrote: true,
      verification: 'verified', status: 'flagged', reason: 'prefill-conflict' });
    expect(page.log.values.country).toBe('ca');
    expect(flagOf(page)).toBe('iti__flag iti__ca');
    expect(page.log.typed.country).toEqual(['Canada']);
    // "+1 512 555 0188" as the profile writes it, then "(512) 555-0188" once Canada is chosen: never typed again with
    // its "+1", which Canada shows already.
    expect(row(page, 'Phone')).toMatchObject({ ...VERIFIED, category: 'contact.phone' });
    expect(phoneBox(page).value).toBe('(512) 555-0188');
    expect(page.log.values.phone).toBe('(512) 555-0188');
    expectInvariants(page, '15125550188');
  });

  it("a Briton's \"+44 20 ...\": the United Kingdom typed where the number picks nothing, and kept, never typed, where it picked it", async () => {
    const typed = await filled(BRITON(), false);
    expect(row(typed, 'Country')).toMatchObject({ ...VERIFIED, kind: 'combobox', provenance: 'profile' });
    expect(typed.log.values.country).toBe('gb');
    expect(flagOf(typed)).toBe('iti__flag iti__gb');
    expect(typed.log.typed.country).toEqual(['United Kingdom']);
    expect(row(typed, 'Phone')).toMatchObject(VERIFIED);
    expect(phoneBox(typed).value).toBe('+44 20 7946 0958');
    expectInvariants(typed, '442079460958');
    removeFixtures(document);

    const picked = await filled(BRITON(), true);
    expect(row(picked, 'Country')).toMatchObject({ status: 'skipped', reason: 'already-correct', wrote: false });
    expect(picked.log.values.country).toBe('gb');
    expect(flagOf(picked)).toBe('iti__flag iti__gb');
    expect(picked.log.typed.country).toBeUndefined();
    expect(row(picked, 'Phone')).toMatchObject(VERIFIED);
    expect(phoneBox(picked).value).toBe('+44 20 7946 0958');
    expectInvariants(picked, '442079460958');
  });
});
