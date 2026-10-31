/*
 * The 4-step wizard fixture and its e2e-only test adapter, in a real layout engine (fixtures/synthetic/wizard-4-step;
 * docs/FIXTURES.md "wizard-4-step"). The page loads into a srcdoc frame at the snapshot size; each state of its
 * index.expect.json is reached from a fresh load by its steps, untrusted click()s as a filler would make, so the page's
 * own script reacts. Then:
 * - the adapter answers each step as the state's `wizard` entry says (signature parts, Next, finality, repeatables);
 * - the scan with the adapter matches the state's fields (compareWithExpectation, as for the snapshots), and each
 *   position's fields carry their block;
 * - assertNotSubmit refuses Submit and "Add education" (a typeless button inside the form) and lets Next, Back and
 *   "Add another position" through;
 * - the page itself: an untrusted click adds a position but never a school, nothing ever submits, "I currently work
 *   here" disables and clears its End date, Next and Back keep the step in the address.
 * The step machine's use of these hooks is the e2e spec's (e2e/specs/31-wizard.spec.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import expectJson from '../../../fixtures/synthetic/wizard-4-step/index.expect.json';
import html from '../../../fixtures/synthetic/wizard-4-step/index.html?raw';
import { assertNotSubmit } from '../../dom/fillers/not-submit';
import { loadFixture, logEvents, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { genericAdapter } from '../generic';
import type { Adapter } from '../types';
import { compareWithExpectation, type Expectation, readExpectation, SNAPSHOT_VIEWPORT } from './expectations.testkit';
import { e2eAdaptersFor, E2E_TEST_ADAPTER_MARKER, TRAP_09_URL, WIZARD_URL } from './index';

/** What the test adapter answers on one step (index.expect.json's `wizard` entries). */
interface WizardAnswers {
  shown: number;
  heading: string;
  progress: string;
  urlPart: string;
  anchor: string;
  final: 'final' | 'not-final' | 'unknown';
  next: string | null;
  repeatables: Record<string, number>;
}

/** One state of the page: its steps (clicks only) and what it then holds. */
interface WizardState {
  name: string;
  clicks: string[];
  wizard: WizardAnswers;
  expectation: Expectation;
}

/** What the page script keeps on window (index.html's header). */
interface PageRecord {
  step: number;
  shown: number[];
  next: Array<{ step: number; trusted: boolean }>;
  back: Array<{ step: number; trusted: boolean }>;
  added: { experience: number; education: number };
  ignored: { education: number };
}

type RawState = { name: string; steps: Array<{ click?: string }>; wizard: WizardAnswers; fields: unknown };

/** The page as it loads, then each state, from index.expect.json. */
function readStates(json: typeof expectJson): WizardState[] {
  const loads = readExpectation(json);
  const raw = json as unknown as { wizard: WizardAnswers; states: RawState[] };
  return [{ name: 'as it loads', clicks: [], wizard: raw.wizard, expectation: loads },
    ...raw.states.map((state) => ({
      name: state.name,
      clicks: state.steps.map((step) => {
        if (typeof step.click !== 'string') throw new Error(`${state.name}: a step that is not a click`);
        return step.click;
      }),
      wizard: state.wizard,
      expectation: readExpectation({ fixture: `${loads.fixture} › ${state.name}`, source: loads.source,
        captured: loads.captured, fields: state.fields }),
    }))];
}

const STATES = readStates(expectJson);
const adapter: Adapter = e2eAdaptersFor(new URL(WIZARD_URL))[0]!;

/** The page loaded, its state's clicks made (untrusted click()s, as a filler makes them). */
async function reach(clicks: readonly string[]): Promise<Fixture> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  for (const selector of clicks) clickOn(fixture, selector);
  return fixture;
}

function clickOn(fixture: Fixture, selector: string): void {
  const el = fixture.doc.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`no element for ${selector}`);
  el.click();
}

const record = (fixture: Fixture) => (fixture.view as unknown as { __wizard: PageRecord }).__wizard;
const rootOf = (fixture: Fixture) => adapter.detect(fixture.doc)!.formRoot;
const byId = (fixture: Fixture, id: string) => fixture.doc.getElementById(id)!;

describe("the e2e-only test adapter on the 4-step wizard's pages", () => {
  afterEach(() => removeFixtures(document));

  it("is the generic adapter with the marker, for the wizard's addresses alone", () => {
    expect(adapter).toMatchObject({ id: 'generic', testOnly: E2E_TEST_ADAPTER_MARKER });
    for (const address of [WIZARD_URL, `${WIZARD_URL}?lever-source=e2e#step-3`,
      'https://jobs.lever.co/tailorit-fixture/wizard-4-step-auto/apply',
      'https://jobs.lever.co/tailorit-fixture/wizard-4-step-worker-stop/apply']) {
      const url = new URL(address);
      expect(adapter.matchesUrl(url), address).toBe(true);
      expect(adapter.canonicalApplicationUrl(url), address).toBe(`${url.origin}${url.pathname}`);
      expect(e2eAdaptersFor(url).map((found) => found.stepSignature !== undefined), address).toEqual([true]);
    }
    for (const other of [`${WIZARD_URL}/`, 'http://jobs.lever.co/tailorit-fixture/wizard-4-step/apply',
      'https://jobs.eu.lever.co/tailorit-fixture/wizard-4-step/apply', 'https://jobs.lever.co/tailorit-fixture/wizard-4-stepx/apply',
      'https://jobs.lever.co/tailorit-fixture/wizard-4-step-/apply', 'https://jobs.lever.co/tailorit-fixture/wizard-4-step-Auto/apply',
      'https://jobs.lever.co/acme/wizard-4-step/apply', 'https://jobs.lever.co/tailorit-fixture/trap-01/apply']) {
      expect(adapter.matchesUrl(new URL(other)), other).toBe(false);
      expect(adapter.canonicalApplicationUrl(new URL(other)), other).toBeNull();
      expect(e2eAdaptersFor(new URL(other)), other).toEqual([]);
    }
    // Trap 09's page keeps its own adapter, which has no step hooks.
    const trap = e2eAdaptersFor(new URL(TRAP_09_URL));
    expect(trap.map((found) => [found.uploadWidgets !== undefined, found.stepSignature === undefined])).toEqual([[true, true]]);
  });

  it.each(STATES)('$name: answers the step as the expectations say', async ({ clicks, wizard }) => {
    const fixture = await reach(clicks);
    const root = rootOf(fixture);
    expect(root).toBe(byId(fixture, 'application'));
    expect(record(fixture).step).toBe(wizard.shown);
    expect(adapter.stepSignature!(fixture.doc)).toEqual({ heading: wizard.heading, progress: wizard.progress,
      urlPart: wizard.urlPart, anchors: [wizard.anchor] });
    expect(adapter.isFinalStep!(fixture.doc)).toBe(wizard.final);
    expect(adapter.nextButton!(root)).toBe(wizard.next === null ? null : fixture.doc.querySelector(wizard.next));
    expect(adapter.submitButton!(root)).toBe(byId(fixture, 'submit'));
    const sections = adapter.repeatables!(root);
    expect(Object.fromEntries(sections.map((section) => [section.kind, section.blocks().length]))).toEqual(wizard.repeatables);
    for (const section of sections) {
      expect(section.addButton(), section.kind).toBe(byId(fixture, `add-${section.kind}`));
      for (const block of section.blocks()) {
        const box = section.currentlyHere?.(block) ?? null;
        expect(box, section.kind).toBe(section.kind === 'experience'
          ? block.querySelector('input[type="checkbox"]') : null);
      }
    }
  });

  it.each(STATES)('$name: scans as the expectations say', async ({ clicks, expectation }) => {
    const fixture = await reach(clicks);
    const result = scan(rootOf(fixture), adapter, { platform: 'lever' });
    expect(compareWithExpectation(fixture.doc, result, expectation)).toEqual([]);
  });

  it("gives each position's fields their own block, so each is filled from its own profile entry", async () => {
    const fixture = await reach(['#next-details', '#add-experience']);
    const result = scan(rootOf(fixture), adapter, { platform: 'lever' });
    const sectionOf = (id: string) => result.fields.find((field) => field.idAttr === id)?.section;
    for (const name of ['company', 'title', 'start', 'end', 'current']) {
      expect(sectionOf(`${name}-0`), name).toEqual({ id: 'experience', block: 0 });
      expect(sectionOf(`${name}-1`), name).toEqual({ id: 'experience', block: 1 });
    }
    const companies = result.fields.filter((field) => field.label === 'Company');
    expect(new Set(companies.map((field) => field.key)).size).toBe(2);
    // The generic adapter, which declares no repeatable section, cannot tell the two blocks apart by section.
    const plain = scan(rootOf(fixture), genericAdapter, { platform: 'lever' });
    expect(plain.fields.filter((field) => field.label === 'Company').map((field) => field.section))
      .toEqual([{ id: 'experience' }, { id: 'experience' }]);
  });

  it('refuses a click on Submit and on "Add education", and lets Next, Back and "Add another position" through', async () => {
    const fixture = await reach(['#next-details', '#next-experience']);
    const root = rootOf(fixture);
    const allowed = (id: string, allowNext = false) => assertNotSubmit(byId(fixture, id), { adapter, root, allowNext });
    // A typeless button inside the form is a submit button.
    expect(allowed('add-education')).toEqual({ ok: false, refusal: 'submits-form' });
    expect(allowed('add-education', true)).toEqual({ ok: false, refusal: 'submits-form' });
    expect(allowed('submit')).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(allowed('submit', true)).toEqual({ ok: false, refusal: 'adapter-submit' });
    for (const id of ['next-education', 'back-education', 'add-experience', 'next-details']) {
      expect(allowed(id), id).toEqual({ ok: true });
    }
  });

  it('adds a position on an untrusted click but never a school, and never submits', async () => {
    const fixture = await reach(['#next-details']);
    const log = logEvents(fixture.doc);
    clickOn(fixture, '#add-experience');
    expect(record(fixture).added).toEqual({ experience: 1, education: 0 });
    expect(fixture.doc.querySelectorAll('#experience-blocks > .block')).toHaveLength(2);
    expect(byId(fixture, 'experience-1').querySelector('.block-title')!.textContent).toBe('Position 2');
    clickOn(fixture, '#next-experience');
    clickOn(fixture, '#add-education');
    clickOn(fixture, '#add-education');
    expect(record(fixture).added).toEqual({ experience: 1, education: 0 });
    expect(record(fixture).ignored).toEqual({ education: 2 });
    expect(fixture.doc.querySelectorAll('#education-blocks > *')).toHaveLength(0);
    // The click on a submit button was cancelled: no submit event, and the frame still shows the page.
    expect(log.events.filter((event) => event.type === 'submit')).toEqual([]);
    expect(fixture.frame.contentDocument).toBe(fixture.doc);
    log.stop();
  });

  it('disables and clears the End date while "I currently work here" is ticked, and enables it again', async () => {
    const fixture = await reach(['#next-details']);
    const end = byId(fixture, 'end-0') as HTMLInputElement;
    const box = byId(fixture, 'current-0') as HTMLInputElement;
    end.value = '2021-05';
    box.click();
    expect([box.checked, end.disabled, end.value]).toEqual([true, true, '']);
    box.click();
    expect([box.checked, end.disabled]).toEqual([false, false]);
    // A position added later behaves the same.
    clickOn(fixture, '#add-experience');
    (byId(fixture, 'current-1') as HTMLInputElement).click();
    expect((byId(fixture, 'end-1') as HTMLInputElement).disabled).toBe(true);
    expect(end.disabled).toBe(false);
  });

  it('keeps the step in the address, and moves back and forth with Next and Back', async () => {
    const fixture = await reach([]);
    const hash = () => fixture.view.location.hash;
    expect([record(fixture).step, hash()]).toEqual([1, '']);
    clickOn(fixture, '#next-details');
    clickOn(fixture, '#next-experience');
    expect([record(fixture).step, hash()]).toEqual([3, '#step-3']);
    clickOn(fixture, '#back-education');
    expect([record(fixture).step, hash()]).toEqual([2, '#step-2']);
    clickOn(fixture, '#back-experience');
    expect([record(fixture).step, hash()]).toEqual([1, '']);
    expect(record(fixture).shown).toEqual([1, 2, 3, 2, 1]);
    expect(record(fixture).next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
    expect(record(fixture).back).toEqual([{ step: 3, trusted: false }, { step: 2, trusted: false }]);
    // The final step has no Next, and the step machine is told so.
    for (const id of ['next-details', 'next-experience', 'next-education']) clickOn(fixture, `#${id}`);
    expect([record(fixture).step, adapter.nextButton!(rootOf(fixture)), adapter.isFinalStep!(fixture.doc)])
      .toEqual([4, null, 'final']);
    expect(byId(fixture, 'summary').textContent).toBe(
      'Your details: 0 of 3 answered' + 'Experience: 0 of 4 answered' + 'Education: 0 of 1 answered');
  });
});
