/*
 * s2 wd (snapshot round 2, the coordinator's decision 3), in the content script end to end: a run on the synthetic
 * Workday steps page (fixtures/synthetic/workday/steps.html, drawn with the snapshots' markup) at My Experience, with
 * the real planFrame and the golden profile behind the fake worker. Each job's From date is one date field
 * (Adapter.dateFor), written by the pass part by part (dom/fillers/date-parts.ts) and read back from its displays after
 * the settle; the page's date script stood in for by a listener that draws a part's digits a microtask after its input
 * event, as React draws them. A page that takes nothing gets each part's own value back, and its date is the person's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import stepsHtml from '../../fixtures/synthetic/workday/steps.html?raw';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const HREF = 'https://tailoritfixture.wd5.myworkdayjobs.com/en-US/careers/job/x/Fixture-Steps_JR-0000002/apply/applyManually';

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

/** The synthetic steps page at My Experience (its first step's boxes given values and its Save and Continue pressed),
 *  each date part drawing its digits a microtask after its input event when `commits`. */
async function atMyExperience(commits: boolean) {
  const fixture = await loadFixture(document, stepsHtml, { width: 1100, height: 1000 });
  const doc = fixture.doc;
  for (const id of ['name--legalName--firstName', 'name--legalName--lastName', 'address--city', 'address--postalCode']) {
    (doc.getElementById(id) as HTMLInputElement).value = 'x';
  }
  const country = doc.getElementById('country--country')!;
  country.setAttribute('value', 'c0a2');
  doc.querySelector<HTMLElement>('[data-automation-id="pageFooterNextButton"]')!.click();
  expect(workdayAdapter.stepSignature!(doc).anchors).toEqual(['applyFlowMyExpPage']);
  doc.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!commits || !input.matches('input[role="spinbutton"]') || !/^\d+$/.test(input.value)) return;
    queueMicrotask(() => {
      input.parentElement!.querySelector('[data-automation-id$="-display"]')!.textContent = input.value;
      input.setAttribute('aria-valuenow', String(Number(input.value)));
    });
  });
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => HREF, isTop: true,
    adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, doc, worker, runtime };
}

/** Each job's From date as its displays show it, in page order. */
const shownDates = (doc: Document) => Array.from(doc.querySelectorAll('[data-automation-id="dateInputWrapper"]'),
  (wrapper) => Array.from(wrapper.querySelectorAll('[data-automation-id$="-display"]'), (part) => part.textContent).join('/'));

describe('Workday’s dates written by a run (s2 wd)', () => {
  it('writes each job’s From part by part, reads it back from its displays, and offers Next once they show', async () => {
    const { doc, worker, runtime } = await atMyExperience(true);
    await runtime.fill();
    await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 30_000 });
    // The golden profile's two jobs (from 2021-06, current; from 2019-07): the run added the second block.
    expect(shownDates(doc)).toEqual(['06/2021', '07/2019']);
    const rows = worker.reports.at(-1)!.fields.filter((row) => row.label === 'From');
    expect(rows.map((row) => [row.status, row.category])).toEqual([['verified', 'experience.startDate'],
      ['verified', 'experience.startDate']]);
    const root = workdayAdapter.detect(doc)!.formRoot;
    expect(workdayAdapter.nextButton!(root)?.getAttribute('data-automation-id')).toBe('pageFooterNextButton');
  });

  it('leaves the date to the person where the page takes nothing, each part holding what it held', async () => {
    const { doc, worker, runtime } = await atMyExperience(false);
    await runtime.fill();
    await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 30_000 });
    expect(shownDates(doc)).toEqual(['MM/YYYY', 'MM/YYYY']);
    expect(Array.from(doc.querySelectorAll<HTMLInputElement>('input[role="spinbutton"]'), (part) => part.value))
      .toEqual(['', '', '', '']);
    const rows = worker.reports.at(-1)!.fields.filter((row) => row.label === 'From');
    expect(rows.map((row) => [row.reason, row.needsUserAction])).toEqual([['needs-your-click', true],
      ['needs-your-click', true]]);
    expect(workdayAdapter.nextButton!(workdayAdapter.detect(doc)!.formRoot)).toBeNull();
  });
});
