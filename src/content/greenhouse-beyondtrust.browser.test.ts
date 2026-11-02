/*
 * The three questions the live BeyondTrust form left for the person (2026-11-01), on the real react-select v5 in
 * Greenhouse's wrapper (fixtures/synthetic/greenhouse-widgets in its 'beyondtrust' form): the content runtime fills it
 * with the fake worker planning each pass with the real planFrame, version 3's defaults, and the golden profile whose
 * US entry names a citizen. "Please confirm the basis of your right to work in the country of employment" takes the
 * permanent right (its sentences read by their meaning, policy.ts legal.work-basis), "Please review and acknowledge
 * BeyondTrust's" its one option "Acknowledge/Confirm" (a required consent asked as a choice, consent.required), and the
 * demographic consent box, optional until the gender answer is chosen and required from then on, is planned again and
 * ticked with click() (bookkeeping.ts 'required'). Every event on a control is untrusted, the fillers' or the declared
 * mouseup, and nothing is submitted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageExpect from '../../fixtures/synthetic/greenhouse-widgets/beyondtrust.expect.json';
import pageHtml from '../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import { mountGreenhouseForm, mountHeaderButton, newLog, type GreenhouseLog } from '../../fixtures/synthetic/greenhouse-widgets/app';
import { compareWithExpectation, readExpectation } from '../adapters/test/expectations.testkit';
import { GREENHOUSE_ACTIVATION, greenhouseAdapter } from '../adapters/greenhouse/index';
import type { FillResult } from '../core/types/fill';
import type { Profile } from '../core/types/profile';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { ALLOWED_EVENTS } from '../dom/fillers/events';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { createFakeWorker, goldenProfile, sentinelsIn, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const URL_9103 = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9103';
const RIGHT_TO_WORK = 'Please confirm the basis of your right to work in the country of employment';
const ACKNOWLEDGE = "Please review and acknowledge BeyondTrust's";
const GENDER = 'How would you describe your gender identity?';
const CONSENT = 'By checking this box, I consent to BeyondTrust collecting, storing, and processing my responses to the '
  + 'demographic data surveys above.';
const CONSENT_BOX = 'gdpr_demographic_data_consent_given_1';

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

/** The golden profile, its US entry naming a citizen (authorized, no sponsorship now or later). */
function citizen(): Profile {
  const golden = goldenProfile();
  return { ...golden, workAuthorization: golden.workAuthorization.map((entry) => (entry.country === 'US'
    ? { ...entry, status: { kind: 'value', value: 'citizen' } } : entry)) };
}

interface Page {
  fixture: Fixture;
  log: GreenhouseLog;
  events: EventLog;
  worker?: FakeWorker;
  runtime?: ContentRuntime;
}

/** The page with the BeyondTrust questions (the page's own module script left out: the test mounts the app). */
async function open(): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  mounted.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log,
    form: 'beyondtrust' }).unmount);
  return { fixture, log, events: logEvents(fixture.doc) };
}

const box = (page: Page) => page.fixture.doc.getElementById(CONSENT_BOX) as HTMLInputElement;

describe('the live BeyondTrust form’s three questions', () => {
  it('meet their hand-written expectations, the consent box optional until a demographic answer', async () => {
    const page = await open();
    const root = greenhouseAdapter.detect(page.fixture.doc)!.formRoot;
    const scanned = () => scan(root, greenhouseAdapter, { platform: 'greenhouse' });
    expect(compareWithExpectation(page.fixture.doc, scanned(), readExpectation(pageExpect))).toEqual([]);
    expect(box(page).getAttribute('aria-required')).toBe('false');
    expect(scanned().fields.find((field) => field.idAttr === CONSENT_BOX)).toMatchObject({ kind: 'checkbox',
      required: false, label: CONSENT });
  });

  it('are filled: the right to work by its meaning, the acknowledgment chosen, the box ticked once it is required', async () => {
    const page = await open();
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, profile: citizen() });
    const runtime = await startContentRuntime(worker.platform, page.fixture.doc, { href: () => URL_9103, isTop: true,
      settle: { quietMs: 200 } });
    runtimes.push(runtime);
    expect(await runtime.fill({})).not.toBeNull();
    const report = worker.reports.at(-1)!;
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;
    const read = { wrote: true, verification: 'verified' };

    // The permanent right: the question names no country, so the profile's only entry's (interpretation 1), filled,
    // read back and flagged for a look (docs/SPEC-AMENDMENTS.md §6).
    expect(row(RIGHT_TO_WORK)).toMatchObject({ ...read, category: 'workAuth.authorized', provenance: 'profile',
      status: 'flagged', reason: 'filled-low-confidence' });
    expect(page.log.values.question_70199751).toBe('70199750');
    // The acknowledgment, a required consent asked as a choice.
    expect(row(ACKNOWLEDGE)).toMatchObject({ ...read, status: 'verified', category: 'consent.other', provenance: 'rule' });
    expect(page.log.values.question_70199752).toBe('70199752');
    // The gender question takes its decline (the golden profile declines it), which makes the box required.
    expect(row(GENDER)).toMatchObject({ ...read, status: 'verified', category: 'eeo.gender' });
    expect(page.log.values['31771']).toBe('31775');
    expect(box(page).getAttribute('aria-required')).toBe('true');
    // The box: planned again as required, ticked with click() as React holds it, read back.
    expect(row(CONSENT)).toMatchObject({ ...read, status: 'verified', category: 'consent.other', provenance: 'rule',
      required: true, needsUserAction: false });
    expect(box(page).checked).toBe(true);
    expect(page.log.values.gdpr_demographic_data_consent_given).toBe(true);
    expect(page.events.on(CONSENT_BOX).filter((event) => event.type === 'click').every((event) => !event.trusted))
      .toBe(true);

    // Untrusted events only, each the fillers' or the declared mouseup; nothing pressed, nothing submitted, no value
    // in a report or a log.
    expect(untrustedViolations(page.events.events)).toEqual([]);
    const allowed = new Set<string>([...ALLOWED_EVENTS, ...GREENHOUSE_ACTIVATION]);
    expect(page.events.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
    expect(page.events.events.filter((event) => ['mousedown', 'pointerdown', 'keydown', 'focus', 'focusin', 'submit']
      .includes(event.type))).toEqual([]);
    expect(page.log.pressed).toEqual([]);
    expect(sentinelsIn(JSON.stringify(worker.reports))).toEqual([]);
    expect(sentinelsIn(JSON.stringify(logs.mock.calls))).toEqual([]);
  });

  it('leave the box unticked in a dry run, which writes nothing and so makes nothing required', async () => {
    const page = await open();
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, profile: citizen() });
    const runtime = await startContentRuntime(worker.platform, page.fixture.doc, { href: () => URL_9103, isTop: true,
      settle: { quietMs: 200 } });
    runtimes.push(runtime);
    expect(await runtime.fill({ dryRun: true })).not.toBeNull();
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((candidate) => candidate.label === CONSENT)).toMatchObject({ wrote: false,
      reason: 'consent-optional-unticked' });
    expect(box(page).checked).toBe(false);
    expect(box(page).getAttribute('aria-required')).toBe('false');
  });
});
