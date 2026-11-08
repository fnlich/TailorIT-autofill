/*
 * Stored and learned lists in a run (snapshot round 2, decision 1): the content runtime on the owner's Workday My
 * Information snapshot (fixtures/workday/s2-exelixis-state-open.html, the State list closed and Workday's script stood
 * in for: a click on a dropdown's button draws the snapshot's own list, a click on an option writes it on the button),
 * with the fake worker planning each pass with the real planFrame over the golden profile. The run asks the worker
 * once (lists/known) for the host's learned lists (the step holds dropdowns with no stored list) and for the stored
 * lists its adapter names (Country, and with it the States: the worker's, background/stored-lists.ts, never the
 * content script's); every scan gives a dropdown the list learned for its label, and State, its stored list's while
 * the country shown is the United States, is planned on the first pass and chosen with one opening of its list.
 * Nothing is submitted, and no value reaches a message.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import stateOpenHtml from '../../fixtures/workday/s2-exelixis-state-open.html?raw';
import { workdayAdapter } from '../adapters/workday/index';
import { WORKDAY_SELECT_ONE, WORKDAY_US } from '../adapters/workday/lists';
import { STORED_LISTS } from '../background/stored-lists';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { labelSlug } from '../core/text/keys';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { learnedListKey } from '../dom/widgets';
import profileJson from '../../fixtures/profiles/alex-rivera.profile.json';
import sensitiveJson from '../../fixtures/profiles/alex-rivera.sensitive.json';
import type { AutofillProfile, AutofillSensitive } from '../contract/tailorit';
import { attachResume, canonicalizeProfile } from '../core/profile/canonicalize';
import type { Profile } from '../core/types/profile';
import { createFakeWorker, GOLDEN_RESUME, NOW, sentinelsIn, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const HREF = 'https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Engineer_JR-0000001/apply/applyManually';
const PREFIXES = [WORKDAY_SELECT_ONE, 'Dr.', 'Mr.', 'Ms.'];

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The snapshot, its lists closed, Country showing `country` (the United States by default), and Workday's script
 *  stood in for; the State's list shows `states` when given (another country's), else the snapshot's own. */
async function page(country = WORKDAY_US, states?: readonly string[]): Promise<{ fixture: Fixture; opened: string[] }> {
  const fixture = await loadFixture(document, stateOpenHtml, SNAPSHOT_VIEWPORT);
  const doc = fixture.doc;
  const list = doc.querySelector<HTMLElement>('ul[role="listbox"]#xfw6t')!;
  const popup = list.closest<HTMLElement>('[data-popper-placement]')!;
  for (const button of Array.from(doc.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'))) {
    button.removeAttribute('aria-expanded');
    button.removeAttribute('aria-controls');
    button.textContent = WORKDAY_SELECT_ONE;
    button.setAttribute('value', '');
  }
  const countryButton = doc.querySelector<HTMLButtonElement>('button#country--country')!;
  countryButton.textContent = country;
  countryButton.setAttribute('value', 'stand-in-id');
  popup.remove();
  const rows = Array.from(list.children).map((row) => row.cloneNode(true) as HTMLElement);
  const stateRows = states === undefined ? rows : [WORKDAY_SELECT_ONE, ...states].map((label, at) => {
    const row = rows[at]!.cloneNode(true) as HTMLElement;
    row.id = `stand-in-${at}`;
    row.querySelector('div')!.textContent = label;
    return row;
  });
  const opened: string[] = [];
  let openFor: HTMLButtonElement | null = null;
  const close = () => {
    popup.remove();
    openFor?.removeAttribute('aria-expanded');
    openFor?.removeAttribute('aria-controls');
    openFor = null;
  };
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const option = target.closest('[role="option"]');
    if (option !== null && list.contains(option) && openFor !== null) {
      openFor.textContent = option.textContent?.trim() ?? '';
      openFor.setAttribute('value', 'stand-in-choice');
      close();
      return;
    }
    const button = target.closest<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    if (button === null) return;
    if (openFor === button) return close();
    close();
    list.replaceChildren(...(button.id === 'address--countryRegion' ? stateRows : rows).map((row) => row.cloneNode(true)));
    doc.body.append(popup);
    list.scrollTop = 0;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', 'xfw6t');
    openFor = button;
    opened.push(button.id);
  });
  return { fixture, opened };
}

/** The golden person living in Toronto, Ontario (the mock's profile-canada address): canonicalized with the golden
 *  sensitive part. */
function torontonian(): Profile {
  const wire = profileJson as unknown as AutofillProfile;
  const contact = { ...wire.contact, address: { ...wire.contact.address, city: 'Toronto', region: 'ON',
    postalCode: 'M5V 2T6', country: 'CA' } };
  return attachResume(canonicalizeProfile({ ...wire, contact }, sensitiveJson as unknown as AutofillSensitive, testVocab(),
    NOW).profile, GOLDEN_RESUME, 48_213);
}

describe('stored and learned lists in a run on Workday', () => {
  // The review of round 2 (L2): a list learned for a State depends on its Country, and one the plan finds stale is read
  // again, once.
  it("keys a State's learned list by its Country, and reads a stale one again once: Ontario chosen from the page's list", async () => {
    const provinces = ['Alberta', 'British Columbia', 'Ontario', 'Quebec'];
    const { fixture, opened } = await page('Canada', provinces);
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const first = scan(root, workdayAdapter, { platform: 'workday' });
    const state = first.fields.find((field) => field.idAttr === 'address--countryRegion')!;
    expect(first.target(state.key)!.widget).toMatchObject({ learnContext: 'Canada' });
    const stale = [WORKDAY_SELECT_ONE, 'Alberta', 'Quebec'];
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, profile: torontonian(),
      learnedLists: [{ key: learnedListKey(labelSlug(state), 'Canada'), labels: stale },
        // Another country's States, under the State's label alone or another country: never offered for Canada's.
        { key: learnedListKey(labelSlug(state)), labels: [WORKDAY_SELECT_ONE, 'Ontario'] },
        { key: learnedListKey(labelSlug(state), 'Mexico'), labels: [WORKDAY_SELECT_ONE, 'Ontario'] }] });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      settle: { quietMs: 150 } });
    runtimes.push(runtime);
    expect(await runtime.fill({})).not.toBeNull();

    const specs = worker.of('plan/request')[0]!.specs as Array<{ idAttr: string; options: Array<{ label: string }> | 'lazy' }>;
    const first0 = specs.find((spec) => spec.idAttr === 'address--countryRegion')!.options;
    expect(first0 === 'lazy' ? first0 : first0.map((option) => option.label)).toEqual(stale);
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((field) => field.label === 'State')).toMatchObject({ status: 'verified', wrote: true });
    expect(fixture.doc.querySelector('button#address--countryRegion')!.textContent).toBe('Ontario');
    // Opened twice: its list read whole once the learned one proved stale, then the choice.
    expect(opened.filter((id) => id === 'address--countryRegion')).toHaveLength(2);
    // The page's list learned again, under the State's label with its Country.
    expect(worker.of('lists/learn').filter((message) => message.key === learnedListKey(labelSlug(state), 'Canada'))
      .map((message) => message.labels)).toEqual([[WORKDAY_SELECT_ONE, ...provinces]]);
  });

  it('asks for the host\'s learned lists once, plans State and the learned Prefix on the first pass, and chooses State at once', async () => {
    const { fixture, opened } = await page();
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const first = scan(root, workdayAdapter, { platform: 'workday' });
    const prefix = first.fields.find((field) => field.idAttr === 'name--legalName--title')!;
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
      learnedLists: [{ key: learnedListKey(labelSlug(prefix)), labels: PREFIXES }] });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      settle: { quietMs: 150 } });
    runtimes.push(runtime);
    expect(await runtime.fill({})).not.toBeNull();

    expect(worker.of('lists/known')).toHaveLength(1);
    const specs = worker.of('plan/request')[0]!.specs as Array<{ idAttr: string; options: Array<{ label: string }> | 'lazy' }>;
    const labels = (id: string) => {
      const options = specs.find((spec) => spec.idAttr === id)?.options;
      return options === undefined || options === 'lazy' ? options : options.map((option) => option.label);
    };
    // The stored lists the scan's adapter names came with the same lists/known, as the worker serves them.
    expect(worker.of('lists/known')[0]).toMatchObject({ stored: ['workday.countries', 'workday.us-states'] });
    expect(labels('country--country')).toEqual(STORED_LISTS['workday.countries']);
    expect(labels('address--countryRegion')).toEqual(STORED_LISTS['workday.us-states']);
    expect(labels('name--legalName--title')).toEqual(PREFIXES);

    const report = worker.reports.at(-1)!;
    const state = report.fields.find((field) => field.label === 'State') as FillResult;
    expect(state).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(fixture.doc.querySelector('button#address--countryRegion')!.textContent).toBe('Texas');
    // One opening for State's choice, none to read it.
    expect(opened.filter((id) => id === 'address--countryRegion')).toEqual(['address--countryRegion']);
    // The learned list carries page text only; no value reaches a message or a log.
    expect(sentinelsIn(JSON.stringify(worker.of('lists/learn')))).toEqual([]);
    expect(sentinelsIn(JSON.stringify(logs.mock.calls))).toEqual([]);
  });
});
