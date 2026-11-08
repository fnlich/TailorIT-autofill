/*
 * React first on Greenhouse's form (docs/SPEC-AMENDMENTS.md §12): the content runtime fills fixtures/synthetic/
 * greenhouse-widgets (the real react-select v5 in Greenhouse's wrapper) with the page-world bridge installed in its
 * frame, as the extension's MAIN-world script installs it, and the fake worker planning each pass with the real
 * planFrame over the golden profile. Each select's list is still read through the page (its one mouseup), so the
 * planner sees what a person sees, but for the lists the adapter stores (snapshot round 2: the phone's country,
 * "Country code", and the EEOC block's Gender, Hispanic/Latino and Veteran Status), planned from those; then every planned option is chosen by react-select's own selectOption: no option
 * is clicked, no select gets a mouseup beyond its read (a search's one, before it is typed into), and the long lists
 * (the country of residence's 197, the phone country's 244) are chosen without a word typed. Each is read back and
 * verified, as React's own state shows. And on a page that answers every command itself, choosing nothing (the
 * bridge's no-match): each select gets the write's one command, never two (a long list is not asked again by its
 * search), and the events' path fills every select as before: the long lists typed into, the options clicked. Every
 * event on a control is untrusted, the fillers' or the declared mouseup, and nothing is submitted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import { mountGreenhouseForm, mountHeaderButton, newLog, type GreenhouseLog } from '../../fixtures/synthetic/greenhouse-widgets/app';
import { GREENHOUSE_ACTIVATION } from '../adapters/greenhouse/index';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { BRIDGE_COMMAND, BRIDGE_RESULT, encodeAnswer, parseCommand, type BridgeCommand } from '../dom/bridge-protocol';
import { ALLOWED_EVENTS } from '../dom/fillers/events';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { installBridge } from '../page/bridge';
import { createFakeWorker, sentinelsIn, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const URL_9100 = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9100';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?';
const SKILLS = 'Which of these skills have you used?';
const RESIDENCE = 'What is your current country of residence?';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
const removals: Array<() => void> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const remove of removals.splice(0)) remove();
  removeFixtures(document);
});

interface Page {
  fixture: Fixture;
  log: GreenhouseLog;
  events: EventLog;
  worker: FakeWorker;
  /** Every bridge command the page's window saw (what a page script could see). */
  commands: BridgeCommand[];
  /** The id of the element each command was sent on, in the same order. */
  targets: string[];
}

/** The standard form with the bridge in its frame, filled once; with `noMatch`, a page that answers every command
 *  itself, before the bridge, with the bridge's no-match. */
async function filled({ noMatch = false, late = false } = {}): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  removals.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log,
    degreeMs: 100, schoolPageMs: 100, searchMs: 100, ...(late ? { start: 'late' as const, attachMs: 1_500 } : {}) }).unmount);
  removals.push(installBridge(fixture.doc));
  const commands: BridgeCommand[] = [];
  const targets: string[] = [];
  const watch = (event: Event) => {
    const command = parseCommand((event as CustomEvent<unknown>).detail);
    if (command === null) return;
    commands.push(command);
    targets.push((event.target as Element).id);
    if (!noMatch) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    (event.target as Element).dispatchEvent(new fixture.view.CustomEvent(BRIDGE_RESULT,
      { detail: encodeAnswer({ v: 1, id: command.id, ok: false, reason: 'no-match' }) }));
  };
  fixture.view.addEventListener(BRIDGE_COMMAND, watch, true);
  removals.push(() => fixture.view.removeEventListener(BRIDGE_COMMAND, watch, true));
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => URL_9100, isTop: true,
    settle: { quietMs: 200 } });
  runtimes.push(runtime);
  expect(await runtime.fill({})).not.toBeNull();
  return { fixture, log, events, worker, commands, targets };
}

describe("Greenhouse's form, React first", () => {
  it('chooses every planned option through the bridge, reads each back, and never clicks an option', async () => {
    const page = await filled();
    const report = page.worker.reports.at(-1)!;
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;
    const verified = { wrote: true, verification: 'verified' };

    expect(row(AUTHORIZED)).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values.question_9001).toBe('1');
    expect(row(SPONSORSHIP)).toMatchObject(verified);
    expect(page.log.values.question_9002).toBe('0');
    expect(row('Gender')).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values.gender).toBe('3');
    expect(row('Veteran Status')).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values.veteran_status).toBe('1');
    expect(row(SKILLS)).toMatchObject(verified);
    expect((page.log.values['question_9004[]'] as string[]).length).toBeGreaterThan(0);
    // The long lists: chosen by their label, nothing typed into their text box.
    expect(row(RESIDENCE)).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values.question_9005).toBe('US');
    expect(row('Country code')).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values.country).toBe('us');
    expect(page.log.typed.question_9005).toBeUndefined();
    expect(page.log.typed.country).toBeUndefined();
    // The searches: typed into after their one mouseup, the listed result chosen through the bridge.
    expect(row('Location (City)')).toMatchObject({ ...verified, status: 'verified' });
    expect(page.log.values['candidate-location']).toBe('Austin, Texas, United States');

    // Every choice was the bridge's: one command for each option chosen, none for anything else, no option clicked,
    // and no select opened but to be read (or searched).
    const chosen = page.commands.map((command) => (command.op === 'react-select.choose' ? command.label : command.op));
    expect(chosen).toEqual(expect.arrayContaining(['Yes', 'No', 'I am not a protected veteran', 'United States',
      'United States +1', 'Austin, Texas, United States']));
    expect(page.events.events.filter((event) => event.type === 'click' && /^react-select-.+-option-\d+$/.test(event.target)))
      .toEqual([]);
    for (const [id, count] of Object.entries(page.log.mouseups)) expect(count, id).toBeLessThanOrEqual(1);

    expect(untrustedViolations(page.events.events)).toEqual([]);
    const allowed = new Set<string>([...ALLOWED_EVENTS, ...GREENHOUSE_ACTIVATION]);
    expect(page.events.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
    expect(page.events.events.filter((event) => ['mousedown', 'pointerdown', 'keydown', 'keyup', 'focus', 'focusin',
      'submit'].includes(event.type))).toEqual([]);
    expect(page.log.pressed).toEqual([]);
    expect(sentinelsIn(JSON.stringify(page.worker.reports))).toEqual([]);
    expect(sentinelsIn(JSON.stringify(logs.mock.calls))).toEqual([]);
  });

  // s2 lists: the phone's country is planned on the first pass from its stored list, so its command can come before
  // the page's React attached; the run waits for the page once, finds it again and sends its command once more.
  it('chooses a stored list through the bridge on a page whose React attaches late, never by a click', async () => {
    const page = await filled({ late: true });
    const report = page.worker.reports.at(-1)!;
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;
    expect(row('Country code')).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(page.log.values.country).toBe('us');
    expect(page.commands.filter((command, at) => page.targets[at] === 'country' && command.op === 'react-select.choose')
      .map((command) => (command.op === 'react-select.choose' ? command.label : ''))).toContain('United States +1');
    expect(page.log.typed.country).toBeUndefined();
    expect(page.events.events.filter((event) => event.type === 'click' && /^react-select-.+-option-\d+$/.test(event.target)))
      .toEqual([]);
  });

  it('sends each write one command when the page answers no-match to all, and its events then fill as before', async () => {
    const page = await filled({ noMatch: true });
    const report = page.worker.reports.at(-1)!;
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;
    const verified = { wrote: true, verification: 'verified' };
    for (const label of [AUTHORIZED, SPONSORSHIP, 'Gender', 'Veteran Status', RESIDENCE, 'Country code', 'Location (City)']) {
      expect(row(label), label).toMatchObject(verified);
    }
    expect(page.log.values.question_9005).toBe('US');
    expect(page.log.values.country).toBe('us');
    // One command per option asked for (a multi-select's each of its own): the long lists' searches did not ask again.
    const perTarget = new Map<string, number>();
    page.commands.forEach((command, at) => {
      const key = `${page.targets[at]} ${command.op === 'react-select.choose' ? command.label : command.op}`;
      perTarget.set(key, (perTarget.get(key) ?? 0) + 1);
    });
    expect([...perTarget.entries()].filter(([, count]) => count > 1)).toEqual([]);
    expect(page.targets.filter((target) => target === 'question_9005')).toHaveLength(1);
    expect(page.targets.filter((target) => target === 'country')).toHaveLength(1);
    // The events' path, as before the bridge: typed searches, clicked options.
    expect(page.log.typed.question_9005).toEqual(['United States']);
    expect(page.log.typed.country).toEqual(['United States']);
    expect(page.events.events.filter((event) => event.type === 'click' && /^react-select-.+-option-\d+$/.test(event.target))
      .length).toBeGreaterThan(0);
    expect(untrustedViolations(page.events.events)).toEqual([]);
    expect(page.log.pressed).toEqual([]);
  });
});
