/*
 * A Greenhouse form drawn again whole while the run fills it (fixtures/synthetic/greenhouse-widgets in its 'rebuild'
 * start: its markup first, then the whole form, the form element that is the adapter's form root included, thrown away
 * and drawn again with new nodes, as Twitch's page is drawn again once its first render fails). The content runtime
 * runs on it with the fake worker planning each pass with the real planFrame over the golden profile: the run finds
 * the new form root by the adapter's hook rather than holding the detached one, its loop scans the new form, writes
 * again what the rebuild emptied and fills the selects the new React answers, and the launcher moves to the new form.
 * Every event on a control is untrusted, the fillers' or the declared mouseup, and nothing is submitted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import {
  mountGreenhouseForm, mountHeaderButton, newLog, type GreenhouseLog,
} from '../../fixtures/synthetic/greenhouse-widgets/app';
import { GREENHOUSE_ACTIVATION, greenhouseAdapter } from '../adapters/greenhouse/index';
import type { FillResult } from '../core/types/fill';
import { ALLOWED_EVENTS } from '../dom/fillers/events';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, goldenProfile, sentinelsIn, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** The rebuilt form's address: the Greenhouse adapter handles it. */
const URL_9102 = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9102';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';

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

interface Page {
  fixture: Fixture;
  log: GreenhouseLog;
  events: EventLog;
  worker: FakeWorker;
  runtime: ContentRuntime;
  /** The form root the page showed first. */
  first: Element;
}

/** The page in its rebuild start (the page's own module script left out: the test mounts the app), and the runtime on
 *  it. */
async function open(attachMs: number): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  mounted.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log,
    start: 'rebuild', attachMs, degreeMs: 100, schoolPageMs: 100, searchMs: 100 }).unmount);
  const first = greenhouseAdapter.detect(fixture.doc)!.formRoot;
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker();
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => URL_9102, isTop: true,
    settle: { quietMs: 200 } });
  runtimes.push(runtime);
  return { fixture, log, events, worker, runtime, first };
}

/** The anchor the launcher sits in, inside the UI's shadow root: hidden while its form root is off the page. */
const anchorOf = (runtime: ContentRuntime) => runtime.ui!.shadow.querySelector<HTMLElement>('.anchor')!;

/** Untrusted events only, each the fillers' or the declared mouseup; no submission; no value in a report or a log. */
function expectInvariants(page: Page): void {
  expect(untrustedViolations(page.events.events)).toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, ...GREENHOUSE_ACTIVATION]);
  expect(page.events.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  expect(page.events.events.filter((event) => ['mousedown', 'pointerdown', 'keydown', 'focus', 'focusin', 'submit']
    .includes(event.type))).toEqual([]);
  expect(page.log.pressed).toEqual([]);
  expect(sentinelsIn(JSON.stringify(page.worker.reports))).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls))).toEqual([]);
}

describe('a Greenhouse form drawn again whole mid-run', () => {
  it('finds the new form root by its hook, writes again what the rebuild emptied, and fills the new selects', async () => {
    const page = await open(1500);
    const end = await page.runtime.fill({});
    expect(end).not.toBeNull();
    const report = page.worker.reports.at(-1)!;
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;

    // The form the run began on is gone; the run and the runtime hold the new one, and the launcher stands on it.
    const now = greenhouseAdapter.detect(page.fixture.doc)!.formRoot;
    expect(page.first.isConnected).toBe(false);
    expect(now).not.toBe(page.first);
    expect(page.log.draws).toBe(1);
    expect(page.runtime.page!.root).toBe(now);
    expect(anchorOf(page.runtime).hidden).toBe(false);

    // A text box written before the rebuild, emptied by it, is written again on the new form and verified there.
    expect(row('First Name')).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(page.log.values.first_name).toBe(goldenProfile().identity.firstName);
    expect((now.querySelector<HTMLInputElement>('#first_name'))!.value).toBe(goldenProfile().identity.firstName);
    // A select the old markup never answered is opened on the new form and chosen as React holds it.
    expect(row(AUTHORIZED)).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(page.log.values.question_9001).toBe('1');
    expectInvariants(page);
  });

  it('moves the launcher to a form drawn again while no run is on, so a run starts on the new form', async () => {
    const page = await open(300);
    await expect.poll(() => page.log.draws, { timeout: 5_000 }).toBe(1);
    // The old root's removal reaches the UI's layout, which asks the runtime for the new one.
    await expect.poll(() => page.runtime.page?.root.isConnected, { timeout: 5_000 }).toBe(true);
    await expect.poll(() => anchorOf(page.runtime).hidden, { timeout: 5_000 }).toBe(false);
    expect(page.first.isConnected).toBe(false);
    expect(page.runtime.page!.root).toBe(greenhouseAdapter.detect(page.fixture.doc)!.formRoot);
    expectInvariants(page);
  });
});
