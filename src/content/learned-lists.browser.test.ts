/*
 * Stored and learned lists in a run (snapshot round 2, decision 1): the content runtime on the owner's Workday My
 * Information snapshot (fixtures/workday/s2-exelixis-state-open.html, the State list closed and Workday's script stood
 * in for: a click on a dropdown's button draws the snapshot's own list, a click on an option writes it on the button),
 * with the fake worker planning each pass with the real planFrame over the golden profile. The run asks the worker
 * once for the host's learned lists (the step holds dropdowns with no stored list), every scan gives a dropdown the list
 * learned for its label, and State, its stored list's while the country shown is the United States, is planned on the
 * first pass and chosen with one opening of its list. Nothing is submitted, and no value reaches a message.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import stateOpenHtml from '../../fixtures/workday/s2-exelixis-state-open.html?raw';
import { workdayAdapter } from '../adapters/workday/index';
import { asDropdownList, WORKDAY_SELECT_ONE, WORKDAY_US, WORKDAY_US_STATES } from '../adapters/workday/lists';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { labelSlug } from '../core/text/keys';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { learnedListKey } from '../dom/widgets';
import { createFakeWorker, sentinelsIn, testVocab } from './content.testkit';
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

/** The snapshot, its lists closed, Country showing the United States, and Workday's script stood in for. */
async function page(): Promise<{ fixture: Fixture; opened: string[] }> {
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
  const country = doc.querySelector<HTMLButtonElement>('button#country--country')!;
  country.textContent = WORKDAY_US;
  country.setAttribute('value', 'stand-in-id');
  popup.remove();
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
    doc.body.append(popup);
    list.scrollTop = 0;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', 'xfw6t');
    openFor = button;
    opened.push(button.id);
  });
  return { fixture, opened };
}

describe('stored and learned lists in a run on Workday', () => {
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
    expect(labels('address--countryRegion')).toEqual(asDropdownList(WORKDAY_US_STATES));
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
