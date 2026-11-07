/*
 * The content runtime on the synthetic Ashby page (fixtures/synthetic/ashby-widgets; app.ts says what it reproduces),
 * with the fake worker planning each pass with the real planFrame and the golden profile (the Phase 2 review):
 * - a resume Ashby shows uploaded is verified; one its toast says failed to upload is flagged upload-failed, written
 *   and never verified (Adapter.uploadState, fillers/upload.ts);
 * - Ashby saves every answer as it is written (Adapter.autosaves): while the person's setting keeps AI drafts for
 *   their confirmation, a draft is held back, nothing of it written or saved, until their Confirm draft writes it;
 * - the posting: the Application tab shows none (its left pane of facts is no posting), so the couldn't-read notice
 *   shows; the overview, drawn seconds after the page loads, is read once drawn, its statement found;
 * - the Overview tab's route change to the Application tab finds the form drawn there, and a stored run resumes once
 *   a late form is drawn;
 * - while Ashby's own adapter waits for its late form, the generic adapter never claims the page; after, it may;
 * - the start date planned from the profile's date is written MM/DD/YYYY, as Ashby's date box reads it;
 * - the SMS consent beside the phone (a click saves it on Ashby's server at once) follows Consent boxes (v3 Phase 3):
 *   under All agreements, the default, its Yes is chosen and Ashby has it once; under Required only it is never touched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog, PATHS, type AshbyLog, type AshbyView } from '../../fixtures/synthetic/ashby-widgets/app';
import { ashbyAdapter } from '../adapters/ashby';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import type { FillResult } from '../core/types/fill';
import type { RunState } from '../core/types/run';
import type { Profile } from '../core/types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import {
  createFakeWorker, FAKE_DRAFT, fakePdf, GOLDEN_RESUME, goldenProfile, sentinelsIn, testVocab, type FakeWorker,
  type FakeWorkerOptions,
} from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const POSTING = 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b2';
const APPLICATION = `${POSTING}/application`;
const WHY = 'Why do you want to join TailorIT Fixture?';
const START = 'When can you start a new role?';
const RESUME = { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' };

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

interface Opened {
  fixture: Fixture;
  log: AshbyLog;
  show(view: AshbyView): void;
}

/** The page (its own module script left out: the test mounts the app). */
async function open(options: { drawAfterMs?: number; uploadFails?: boolean; view?: AshbyView;
  description?: readonly string[]; before?: (fixture: Fixture) => void } = {}): Promise<Opened> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 3200 });
  options.before?.(fixture);
  const log = newLog();
  const app = mountAshbyForm(fixture.doc.getElementById('ashby-panel')!, { log, searchMs: 200, drawAfterMs: options.drawAfterMs,
    uploadFails: options.uploadFails, view: options.view, description: options.description });
  mounted.push(app.unmount);
  // A form drawn at once is there before the runtime starts (React draws it a moment after its render call).
  if ((options.drawAfterMs ?? 0) === 0 && (options.view ?? 'application') === 'application') {
    await until(() => ashbyAdapter.detect(fixture.doc) !== null);
  }
  return { fixture, log, show: app.show };
}

interface Started extends Opened {
  worker: FakeWorker;
  runtime: ContentRuntime;
}

async function start(opened: Opened, worker: FakeWorkerOptions = {}, href: () => string = () => APPLICATION,
  adapters?: (url: URL) => Adapter[]): Promise<Started> {
  const fake = createFakeWorker({ settings: DEFAULT_SETTINGS, ...worker });
  const runtime = await startContentRuntime(fake.platform, opened.fixture.doc, { href, isTop: true, settle: { quietMs: 200 },
    ...(adapters === undefined ? {} : { adapters }) });
  runtimes.push(runtime);
  return { ...opened, worker: fake, runtime };
}

const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
function rowOf(report: FrameReport, label: string): FillResult {
  const row = report.fields.find((candidate) => candidate.label === label);
  if (row === undefined) throw new Error(`no row "${label}": ${report.fields.map((each) => each.label).join(' | ')}`);
  return row as FillResult;
}

/** Waits until `ready` holds. */
async function until(ready: () => boolean, timeout = 8_000): Promise<void> {
  await vi.waitFor(() => expect(ready()).toBe(true), { timeout, interval: 50 });
}

/** Consent boxes: Required only: an optional agreement is ticked only when pre-approved. */
const REQUIRED_ONLY: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' } };

describe('the resume on Ashby, as the page shows its upload', () => {
  it('is verified once Ashby shows it uploaded, and its SMS consent is never touched under Required only', async () => {
    const started = await start(await open(), { resume: RESUME, settings: REQUIRED_ONLY });
    expect(await started.runtime.fill()).toBe('review');
    const report = lastReport(started.worker);
    expect(rowOf(report, 'Resume')).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true,
      verification: 'verified' });
    expect(started.log.uploads).toEqual([{ name: GOLDEN_RESUME.fileName, ok: true }]);
    expect(started.log.saves.filter((save) => save.op === 'ApiSetFormValueToFile')).toHaveLength(1);
    // The SMS consent: one click saves it on Ashby's server, so under Required only it is never clicked.
    expect(started.log.saves.filter((save) => save.op === 'ApiSubmitCandidateTextingConsent')).toEqual([]);
    expect(started.log.values.communicationConsent).toBeUndefined();
    expect(sentinelsIn(JSON.stringify(started.worker.reports))).toEqual([]);
  });

  it('chooses its SMS consent’s Yes under Consent boxes: All agreements, the default, and Ashby has it once', async () => {
    const started = await start(await open(), { resume: RESUME });
    expect(await started.runtime.fill()).toBe('review');
    const report = lastReport(started.worker);
    const sms = report.fields.find((row) => row.category === 'consent.sms');
    expect(sms).toMatchObject({ kind: 'radio', required: false, provenance: 'rule', wrote: true, verification: 'verified' });
    expect(started.log.values.communicationConsent).toBe('given');
    expect(started.log.saves.filter((save) => save.op === 'ApiSubmitCandidateTextingConsent')).toHaveLength(1);
  });

  it('is flagged upload-failed, written and never verified, when Ashby says it failed to upload', async () => {
    const started = await start(await open({ uploadFails: true }), { resume: RESUME });
    expect(await started.runtime.fill()).toBe('review');
    expect(started.log.uploads).toEqual([{ name: GOLDEN_RESUME.fileName, ok: false }]);
    expect(rowOf(lastReport(started.worker), 'Resume')).toMatchObject({ category: 'file.resume', status: 'flagged',
      reason: 'upload-failed', wrote: true, verification: 'mismatch', needsUserAction: true });
    // Ashby's file item names the file all the same: the toast is what says it failed.
    expect(started.fixture.doc.querySelector('.ashby-application-form-input-file-item-name')?.textContent)
      .toBe(GOLDEN_RESUME.fileName);
  });
});

describe('AI drafts on a page that saves as it is filled', () => {
  it('writes the draft at once (v4, D6: no draft is held back for the person\'s confirmation any more), as it does on any page', async () => {
    const started = await start(await open());
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ provenance: 'llm-draft', wrote: true,
      reason: 'llm-draft-written', needsUserAction: false });
    expect((started.fixture.doc.getElementById(PATHS.why) as HTMLTextAreaElement).value).toBe(FAKE_DRAFT);
    // Nothing waits: the draft row has nothing to confirm.
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm',
      fieldKey: rowOf(lastReport(started.worker), WHY).key })).toMatchObject({ ok: false });
  });
});

describe("Ashby's posting, for the policy notices", () => {
  it("reads the Application tab's left pane of facts as no posting (v4, D9: the couldn't-read notice is no longer raised)", async () => {
    const opened = await open();
    // The left pane is as long as a live one: more than enough to pass for a posting.
    expect(opened.fixture.doc.querySelector('.ashby-job-posting-left-pane')!.textContent!.length).toBeGreaterThan(1_500);
    const started = await start(opened, { policy: { postingPage: 'unseen', storedCopy: 'unavailable' } });
    expect(await started.runtime.fill()).toBe('review');
    expect(lastReport(started.worker).notices.map((notice) => notice.code)).not.toContain('policy-unreadable');
    expect(lastReport(started.worker).notices.map((notice) => notice.code)).not.toContain('policy-profile-only');
  });

  it('reads the overview once Ashby draws it, and finds its statement', async () => {
    const started = await start(await open({ view: 'overview', drawAfterMs: 600,
      description: ['About the team', 'Please do not use AI tools to apply.'] }), {}, () => POSTING);
    expect(started.runtime.page).toBeNull();
    // Nothing is read before the overview is drawn: the page shows only its left pane then.
    expect(started.worker.of('policy/hit')).toEqual([]);
    await until(() => started.worker.of('policy/hit').length > 0);
    expect(started.worker.of('policy/hit').map((hit) => hit.patternId)).toEqual(['do-not-use-ai']);
  });

  it('reads a clean overview once drawn as a clean reading', async () => {
    const started = await start(await open({ view: 'overview', drawAfterMs: 400 }), {}, () => POSTING);
    await until(() => started.worker.of('policy/hit').length > 0);
    expect(started.worker.of('policy/hit').map((hit) => hit.patternId)).toEqual([null]);
  });
});

describe("Ashby's late form and its route change", () => {
  it('finds the form the Application tab draws after the Overview tab changes the address', async () => {
    let href = POSTING;
    const opened = await open({ view: 'overview' });
    const started = await start(opened, {}, () => href);
    expect(started.runtime.page).toBeNull();
    expect(started.worker.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false]);
    // The Application tab: Ashby's router changes the address and draws the form.
    href = APPLICATION;
    opened.show('application');
    opened.fixture.view.dispatchEvent(new PopStateEvent('popstate'));
    await until(() => started.runtime.page !== null);
    expect(started.runtime.page?.adapter).toBe(ashbyAdapter);
    await until(() => started.worker.of('frame/hello').some((hello) => hello.hasForm === true));
    expect(started.runtime.ui).not.toBeNull();
  });

  it('resumes a stored run once the late form is drawn', async () => {
    const first = await start(await open());
    expect(await first.runtime.fill()).toBe('review');
    const stored = first.worker.runStates.at(-1)!;
    first.runtime.stop();
    for (const unmount of mounted.splice(0)) unmount();
    removeFixtures(document);
    // A reload: the form is drawn late, and the run is resumed from its stored state once it is.
    const resumed: RunState = { ...stored, status: 'scan-step', updatedAt: Date.now() };
    const again = await start(await open({ drawAfterMs: 600 }), {
      script: { 'runstate/get': [{ ok: true, data: { runState: resumed } }] } });
    expect(again.runtime.page).toBeNull();
    expect(again.worker.of('run/begin')).toEqual([]);
    await until(() => again.worker.of('run/begin').length > 0);
    expect(again.worker.of('run/begin').at(-1)).toMatchObject({ trigger: 'resume' });
  });

  it('lets no generic adapter claim the page while Ashby waits for its form, and lets it after', async () => {
    // A search box beside the place the form is drawn: a page the generic adapter would take at once.
    const search = (fixture: Fixture) => {
      const form = fixture.doc.createElement('form');
      const label = fixture.doc.createElement('label');
      label.htmlFor = 'q';
      label.textContent = 'Search jobs';
      const input = fixture.doc.createElement('input');
      input.id = 'q';
      input.name = 'q';
      form.append(label, input);
      fixture.doc.querySelector('.ashby-job-posting-left-pane')!.append(form);
    };
    const quick: Adapter = { ...ashbyAdapter, quirks: { ...ashbyAdapter.quirks, formLateMs: 900 } };
    const both = () => [quick, genericAdapter];
    const drawn = await start(await open({ drawAfterMs: 400, before: search }), {}, () => APPLICATION, both);
    expect(drawn.runtime.page).toBeNull();
    await until(() => drawn.runtime.page !== null);
    expect(drawn.runtime.page?.adapter).toBe(quick);
    drawn.runtime.stop();
    for (const unmount of mounted.splice(0)) unmount();
    removeFixtures(document);

    // No Ashby form ever drawn: once the wait is over the generic adapter takes the page.
    const never = await start(await open({ drawAfterMs: 60_000, before: search }), {}, () => APPLICATION, both);
    expect(never.runtime.page).toBeNull();
    await until(() => never.runtime.page !== null, 4_000);
    expect(never.runtime.page?.adapter).toBe(genericAdapter);
  });
});

describe("Ashby's date, end to end", () => {
  it('writes the start date the profile gives MM/DD/YYYY, which Ashby saves as that day', async () => {
    const golden = goldenProfile();
    const profile: Profile = { ...golden, preferences: { ...golden.preferences,
      startDate: { kind: 'date', date: { y: 2026, m: 12, d: 1 } } } };
    const started = await start(await open(), { profile });
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), START)).toMatchObject({ category: 'availability.startDate', wrote: true,
      verification: 'verified' });
    expect((started.fixture.doc.querySelector('input.ashby-application-form-input-date') as HTMLInputElement).value)
      .toBe('12/01/2026');
    await until(() => started.log.values[PATHS.start] === '2026-12-01');
    expect(started.log.calendars).toBe(0);
  });
});
