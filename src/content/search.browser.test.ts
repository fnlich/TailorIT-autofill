/*
 * v4 (drop): a search's candidate answers in the content runtime, with the fake worker planning each pass with the real
 * planFrame over the golden profile:
 * - a remote typeahead's results go to the worker marked as a search's results (FieldSpec.searchResults), so the
 *   planner chooses among them only in the fill band and never asks the LLM about them;
 * - a long combobox with no option that is the value, whose own text box does not filter it for a declared widget
 *   (dom/widgets' searchesList), gets the planner's query write but is never typed into: the field is left with why
 *   nothing was chosen from its read (no-match), its box untouched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import typeaheadHtml from '../../fixtures/synthetic/remote-typeahead/index.html?raw';
import type { FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { PlanOutput } from '../core/plan/types';
import { ALLOWED_EVENTS } from '../dom/fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

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

async function fill(html: string, board: string) {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const events = logEvents(fixture.doc);
  const plans: PlanOutput[] = [];
  const worker = createFakeWorker({ editPlan: (plan) => {
    plans.push(plan);
    return plan;
  } });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, {
    href: () => `https://jobs.lever.co/tailorit-fixture/${board}/apply`, isTop: true, settle: { quietMs: 200 } });
  runtimes.push(runtime);
  await runtime.fill({});
  const report = worker.reports.at(-1)!;
  const row = (label: string) => report.fields.find((each) => each.label === label) as FillResult;
  return { fixture, events, worker, report, row, plans };
}

/** A generic page whose "Country" is an ARIA combobox no adapter declares, with sixty countries that are not the
 *  person's: its text box says it filters (aria-autocomplete="list"), but the page never filters it. */
const LONG_LIST = `<!doctype html><html><body><main><h1>Platform Engineer</h1>
  <form action="/__submitted" method="post">
    <label for="name">Full name</label><input id="name" name="name">
    <label for="country">Country</label>
    <input id="country" name="country" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lb"
      autocomplete="off">
    <ul id="lb" role="listbox" hidden>${Array.from({ length: 60 }, (_, at) =>
    `<li role="option" id="o${at}">Elsewhere ${at + 1}</li>`).join('')}</ul>
    <button type="submit">Submit application</button>
  </form></main>
  <script>
    const box = document.getElementById('country');
    const list = document.getElementById('lb');
    box.addEventListener('click', () => { list.hidden = !list.hidden; box.setAttribute('aria-expanded', String(!list.hidden)); });
    box.addEventListener('focusout', () => { list.hidden = true; box.setAttribute('aria-expanded', 'false'); });
    for (const option of list.querySelectorAll('[role=option]')) {
      option.addEventListener('click', () => { box.value = option.textContent; list.hidden = true; });
    }
  </script></body></html>`;

describe('v4 (drop): search results and long lists in the content runtime', () => {
  it("marks a remote typeahead's results as a search's for the worker", async () => {
    const ran = await fill(typeaheadHtml, 'remote-typeahead');
    expect(ran.row('School')).toMatchObject({ status: 'verified', wrote: true });
    const results = ran.worker.of('plan/request').map((message) => message.specs as FieldSpec[])
      .filter((specs) => specs.length === 1 && specs[0]!.label === 'School' && Array.isArray(specs[0]!.options)
        && specs[0]!.options.length > 0);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((specs) => specs[0]!.searchResults === true)).toBe(true);
  });

  it('never types into a long list its adapter does not declare a search: no-match, the box untouched', async () => {
    const ran = await fill(LONG_LIST, 'long-list');
    // The planner asked for a search (its candidate answers), which the frame refused for this list.
    expect(ran.plans.flatMap((plan) => plan.writes).some((write) => write.value.kind === 'query')).toBe(true);
    expect(ran.row('Country')).toMatchObject({ status: 'flagged', reason: 'no-match', wrote: false });
    expect((ran.fixture.doc.getElementById('country') as HTMLInputElement).value).toBe('');
    expect(ran.events.on('country').filter((event) => !event.trusted && event.type === 'input')).toEqual([]);
    expect(untrustedViolations(ran.events.events)).toEqual([]);
    expect(ran.events.events.filter((event) => !event.trusted
      && !(ALLOWED_EVENTS as readonly string[]).includes(event.type))).toEqual([]);
  });
});
