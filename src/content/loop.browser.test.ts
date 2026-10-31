/*
 * The reactive loop (loop.ts) end to end in the content runtime, with the fake worker planning each pass with the real
 * planFrame over the golden profile, on the synthetic fixtures (fixtures/synthetic: conditional-reveal and
 * async-options, whose headers say what each page does) and a few small pages of its own: what is revealed, swapped,
 * removed and reset; dependent lists that load fast, slowly, never, or fail; a page that stays busy; the pass limit; a
 * stalled page; Cancel mid-loop; the follow-up box; a dry run.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import asyncOptions from '../../fixtures/synthetic/async-options/index.html?raw';
import conditionalReveal from '../../fixtures/synthetic/conditional-reveal/index.html?raw';
import { baseKeyOf, MAX_PASSES, MAX_VALUE_FLIPS, storedBaseKey } from '../core/loop/bookkeeping';
import type { PlanOutput } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import {
  createFakeWorker, fakePdf, FREE_TEXT_SENTINELS, PAGE_TEXT_SENTINELS, selfDescribedProfile, sentinelsIn, testVocab,
  VALUE_SENTINELS, withoutPageLabels, type FakeWorker, type FakeWorkerOptions,
} from './content.testkit';
import type { OptionsTimings, SettleTimings } from './loop';
import type { RunEnd } from './orchestrator';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** An address on the reserved fixture board, read by the generic adapter. */
const boardUrl = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;

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

interface StartOptions {
  worker?: FakeWorkerOptions;
  settle?: SettleTimings;
  awaitOptions?: OptionsTimings;
}

interface Started {
  fixture: Fixture;
  events: EventLog;
  worker: FakeWorker;
  runtime: ContentRuntime;
}

async function start(html: string, name: string, options: StartOptions = {}): Promise<Started> {
  const fixture = await loadFixture(document, html);
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker(options.worker);
  // The page's own timers (the phone reset at 120 ms) fall inside this quiet window.
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl(name), isTop: true,
    settle: options.settle ?? { quietMs: 200 }, ...(options.awaitOptions ? { awaitOptions: options.awaitOptions } : {}) });
  runtimes.push(runtime);
  return { fixture, events, worker, runtime };
}

interface Ran extends Started {
  end: RunEnd | null;
  report: FrameReport;
  row(label: string): FillResult;
  rowOf(label: string): FillResult | undefined;
  value(id: string): string;
  /** The extension's writes on a control: its untrusted change events (a radio's change is Chromium's own). */
  writes(id: string): number;
  /** A number the page script keeps on window. */
  counter(name: string): unknown;
}

function ranOf(started: Started, end: RunEnd | null): Ran {
  const report = started.worker.reports.at(-1)!;
  const rowOf = (label: string) => report.fields.find((row) => row.label === label) as FillResult | undefined;
  return {
    ...started,
    end,
    report,
    rowOf,
    row(label) {
      const found = rowOf(label);
      if (found === undefined) throw new Error(`no row labelled ${JSON.stringify(label)}`);
      return found;
    },
    value: (id) => (started.fixture.doc.getElementById(id) as HTMLInputElement).value,
    writes: (id) => started.events.on(id).filter((event) => !event.trusted && event.type === 'change').length,
    counter: (name) => (started.fixture.view as unknown as Record<string, unknown>)[name],
  };
}

async function fill(html: string, name: string, options: StartOptions = {}): Promise<Ran> {
  const started = await start(html, name, options);
  return ranOf(started, await started.runtime.fill());
}

/** The base key of a row. */
const base = (row: FillResult) => baseKeyOf(row.key);

/** What every run here must hold: no submission, untrusted events only, a provenance on every written row, and no
 *  profile value in a report, a RunState or a log line. */
function expectInvariants(ran: Ran): void {
  expect(untrustedViolations(ran.events.events)).toEqual([]);
  expect(ran.events.events.filter((event) => event.type === 'submit')).toEqual([]);
  for (const report of ran.worker.reports) {
    for (const row of report.fields) {
      if (row.status === 'filled' || row.status === 'verified') expect(row.provenance, row.label).not.toBeNull();
    }
  }
  expect(sentinelsIn(JSON.stringify(ran.worker.reports))).toEqual([]);
  expect(sentinelsIn(JSON.stringify(ran.worker.runStates), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
  // The free text a follow-up types (the referral source; the golden profile declines to self-describe): nowhere but
  // in page text, a row's label and its key's label slug (L-S6).
  expect(sentinelsIn(JSON.stringify(ran.worker.reports.map(withoutPageLabels)), FREE_TEXT_SENTINELS)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(ran.worker.runStates), FREE_TEXT_SENTINELS)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls), FREE_TEXT_SENTINELS)).toEqual([]);
}

/** The pass index of every plan/request, and the labels each one asked about: its planKeys' specs (the rest of the
 *  scan rides along as context, LC-2). */
function planned(worker: FakeWorker): Array<{ pass: number; labels: string[] }> {
  return worker.of('plan/request').map((message) => {
    const specs = message.specs as FieldSpec[];
    const keys = message.planKeys as string[] | undefined;
    const asked = keys === undefined ? specs : specs.filter((spec) => keys.includes(spec.key));
    return { pass: message.pass as number, labels: asked.map((spec) => spec.label) };
  });
}

const SPONSOR_NOW = 'Do you currently require visa sponsorship to work in the United States?';
const SPONSOR_FUTURE = 'Will you require visa sponsorship to work in the United States in the future?';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const CLEARANCE = 'Do you hold an active U.S. security clearance?';
const SOURCE = 'How did you hear about us?';

describe('conditional fields, over several passes', () => {
  it('fills what each write reveals, swaps and removes, types Other\'s free text, and stops fighting a reset', async () => {
    const ran = await fill(conditionalReveal, 'conditional-reveal');
    expectInvariants(ran);
    expect(ran.end).toBe('review');
    expect(ran.report.status).toBe('review');
    for (const label of ['Full name', 'Email', 'City', 'Country']) {
      expect(ran.row(label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
    }

    // Yes reveals the sponsorship questions (No, from the explicit values) and the clearance question (blank).
    const authorized = ran.row(AUTHORIZED);
    expect(authorized).toMatchObject({ category: 'workAuth.authorized', status: 'verified', provenance: 'profile' });
    for (const [label, id] of [[SPONSOR_NOW, 'sponsorship-now'], [SPONSOR_FUTURE, 'sponsorship-future']] as const) {
      expect(ran.row(label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
      expect(ran.row(label).detail?.revealedBy, label).toBe(base(authorized));
      expect(ran.value(id)).toBe('no');
    }
    expect(ran.row(CLEARANCE)).toMatchObject({ status: 'flagged', reason: 'legal-not-in-profile', wrote: false,
      provenance: null });
    expect(ran.row(CLEARANCE).detail?.revealedBy).toBe(base(authorized));
    expect(ran.rowOf('What visa type do you hold?')).toBeUndefined();
    expect(ran.events.on('visa-type')).toEqual([]);

    // Other for a source the list lacks, and the box it reveals gets the profile's own source, once.
    const source = ran.row(SOURCE);
    expect(source).toMatchObject({ category: 'referral.source', status: 'flagged', matcherStage: 'other',
      reason: 'other-option-with-free-text', provenance: 'profile', wrote: true });
    expect(ran.value('source')).toBe('other');
    expect(ran.row('Please specify')).toMatchObject({ provenance: 'rule', wrote: true, status: 'verified' });
    expect(ran.row('Please specify').detail?.revealedBy).toBe(base(source));
    expect(ran.value('source-other')).toBe('LinkedIn');
    expect(ran.writes('source-other')).toBe(1);

    // The Country write swaps the state list: Texas, written once, from the United States' list.
    const country = ran.row('Country');
    expect(ran.row('State/Province')).toMatchObject({ category: 'address.region', status: 'verified', wrote: true });
    expect((ran.fixture.doc.getElementById('region') as HTMLSelectElement).selectedOptions[0]?.text).toBe('Texas');
    expect(ran.writes('region')).toBe(1);

    // It removes Postal code (its answer dropped, reported) and puts ZIP code in its place, named after Country though
    // City is the writer just before it in the page: the DOM's attribution.
    expect(ran.row('Postal code')).toMatchObject({ reason: 'field-disappeared', wrote: true, status: 'filled' });
    expect(ran.fixture.doc.getElementById('postal')).toBeNull();
    expect(ran.row('ZIP code')).toMatchObject({ category: 'address.postalCode', status: 'verified', wrote: true });
    expect(ran.row('ZIP code').detail?.revealedBy).toBe(base(country));
    expect(ran.value('zip')).toBe('78701');

    // The page resets Phone after every write: rewritten once, then flagged at the flip past the limit.
    expect(ran.row('Phone')).toMatchObject({ category: 'contact.phone', status: 'flagged', reason: 'value-oscillated' });
    expect(ran.writes('phone')).toBe(2);
    await vi.waitFor(() => expect(ran.counter('__phoneResets')).toBe(2));
    expect(ran.counter('__phoneResets') as number + ran.writes('phone') - 1).toBe(MAX_VALUE_FLIPS + 1);
    expect(ran.value('phone')).toBe('');

    // Two planning passes: the second asks only about what the first revealed, changed or saw reset.
    expect(ran.report.counters.passes).toBe(2);
    expect(ran.report.notices.map((notice) => notice.code)).not.toContain('page-busy');
    const plans = planned(ran.worker);
    expect(plans.map((plan) => plan.pass)).toEqual([0, 1]);
    expect(plans[1]!.labels.sort()).toEqual(['Phone', 'Please specify', 'State/Province', 'ZIP code', CLEARANCE,
      SPONSOR_FUTURE, SPONSOR_NOW].sort());
    const edges = ran.worker.runStates.at(-1)!.revealEdges;
    for (const [parent, child] of [[authorized, SPONSOR_NOW], [authorized, SPONSOR_FUTURE], [authorized, CLEARANCE],
      [source, 'Please specify'], [country, 'ZIP code'], [country, 'State/Province']] as const) {
      // Stored with each section and label slug hashed (L-S3).
      expect(edges, `${parent.label} -> ${child}`).toContainEqual([storedBaseKey(base(parent)),
        storedBaseKey(base(ran.row(child)))]);
    }
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] content.loop-ended', { passes: 2,
      nothingPending: true, maxPasses: false, stalled: false, cut: false }]);
  });

  it('plans one pass in a dry run, writes nothing, and reveals nothing', async () => {
    const started = await start(conditionalReveal, 'conditional-reveal-dry');
    const ran = ranOf(started, await started.runtime.fill({ dryRun: true }));
    expect(ran.end).toBe('review');
    expect(ran.events.events).toEqual([]);
    expect(ran.report.mode).toBe('dry-run');
    expect(ran.report.counters.passes).toBe(1);
    expect(planned(ran.worker).map((plan) => plan.pass)).toEqual([0]);
    expect(ran.report.fields.every((row) => !row.wrote && row.verification === 'not-checked')).toBe(true);
    expect(ran.row('Country')).toMatchObject({ status: 'verified', provenance: 'profile' });
    for (const label of ['ZIP code', 'Please specify', SPONSOR_NOW]) expect(ran.rowOf(label), label).toBeUndefined();
    expect(ran.worker.runStates).toEqual([]);
  });

  it('writes nothing more once the person cancels mid-loop, and ends stopped', async () => {
    const started = await start(conditionalReveal, 'conditional-reveal-cancel', { worker: { onMessage: (message) => {
      if (message.type === 'plan/request' && (message as { pass?: number }).pass === 1) {
        void started.worker.platform.deliver({ v: 1, type: 'run/cancel' });
      }
    } } });
    const ran = ranOf(started, await started.runtime.fill());
    expect(ran.end).toBe('stopped');
    expect(ran.report.status).toBe('stopped');
    expect(ran.row('Full name')).toMatchObject({ status: 'verified', wrote: true });
    for (const label of ['ZIP code', 'State/Province', 'Please specify', SPONSOR_NOW]) {
      expect(ran.row(label), label).toMatchObject({ status: 'flagged', reason: 'user-stopped', wrote: false });
    }
    for (const id of ['zip', 'region', 'source-other', 'sponsorship-now']) expect(ran.writes(id), id).toBe(0);
    expect(ran.writes('phone')).toBe(1);
    expect(ran.report.counters.passes).toBe(2);
    expect(ran.runtime.ui!.launcher.view.state).toBe('idle');
    expectInvariants(ran);
  });

  it('leaves the box alone when the worker blocks it, and flags the choice as typed nowhere (LC-10)', async () => {
    const blockBox = (plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput => {
      const box = specs.find((spec) => spec.label === 'Please specify');
      if (box === undefined) return plan;
      return { ...plan, writes: plan.writes.filter((write) => write.key !== box.key),
        results: plan.results.map((row) => (row.key === box.key ? { ...row, status: 'blocked', reason: 'tripwire-in-label',
          provenance: null, wrote: false, verification: 'not-applicable', needsUserAction: true } : row)) };
    };
    const ran = await fill(conditionalReveal, 'conditional-reveal-blocked-box', { worker: { editPlan: blockBox } });
    expect(ran.value('source-other')).toBe('');
    expect(ran.events.on('source-other')).toEqual([]);
    expect(ran.row('Please specify')).toMatchObject({ status: 'blocked', reason: 'tripwire-in-label', wrote: false });
    // "Your answer typed in" would be untrue: nothing was.
    expect(ran.row(SOURCE)).toMatchObject({ status: 'flagged', reason: 'other-without-free-text', wrote: true });
    expectInvariants(ran);
  });
});

/** A plain page around a form: `after` goes after it (a page's script). */
const page = (form: string, after = '') => `<!doctype html><html><head><style>body{margin:0;background:#fff;color:#222;
  font:16px/1.5 system-ui,sans-serif} form label{display:block;margin-top:12px} input,select{display:block;
  border:1px solid #888;padding:4px}</style></head><body><main><h1>Engineer</h1><p>A visible description of the role.</p>
  <form id="application" action="/__submitted" method="post">${form}<button type="submit">Submit application</button>
  </form>${after}</main></body></html>`;

describe('the loop\'s ends and edges', () => {
  it('stops after MAX_PASSES planning passes on a page that reveals a new field after every write', async () => {
    const ran = await fill(page('<div id="cities"><label for="city-0">City</label><input id="city-0" name="city-0"></div>',
      `<script>(() => { const cities = document.getElementById('cities'); let next = 1;
        cities.addEventListener('change', () => { const id = 'city-' + next; next += 1;
          const label = document.createElement('label'); label.htmlFor = id; label.textContent = 'City';
          const input = document.createElement('input'); input.id = id; input.name = id;
          cities.append(label, input); }); })();</script>`), 'max-passes');
    expect(ran.end).toBe('review');
    expect(ran.report.counters.passes).toBe(MAX_PASSES);
    expect(planned(ran.worker).map((plan) => plan.pass)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Each pass wrote the City its last write revealed; the one the eighth revealed is left, flagged.
    const rows = ran.report.fields.filter((row) => row.label === 'City');
    expect(rows).toHaveLength(MAX_PASSES + 1);
    expect(rows.slice(0, MAX_PASSES).every((row) => row.status === 'verified' && row.wrote)).toBe(true);
    expect(rows.at(-1)).toMatchObject({ status: 'flagged', reason: 'max-passes-reached', wrote: false });
    expect(rows.at(-1)!.detail?.revealedBy).toBe(baseKeyOf(rows.at(-2)!.key as FieldKey));
    expectInvariants(ran);
  });

  it('ends on a stalled page: a field the worker never rows is left for the person, not asked about for ever', async () => {
    const dropEmail = (plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput => {
      const email = specs.find((spec) => spec.label === 'Email');
      return email === undefined ? plan : { ...plan, writes: plan.writes.filter((write) => write.key !== email.key),
        results: plan.results.filter((row) => row.key !== email.key) };
    };
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <label for="email">Email</label><input id="email" type="email" name="email">`), 'stalled',
    { worker: { editPlan: dropEmail } });
    expect(ran.end).toBe('review');
    expect(ran.row('Full name')).toMatchObject({ status: 'verified', wrote: true });
    expect(ran.row('Email')).toMatchObject({ status: 'flagged', reason: 'internal-error', wrote: false, provenance: null });
    expect(ran.value('email')).toBe('');
    expect(planned(ran.worker).map((plan) => plan.pass)).toEqual([0, 1]);
    expect(ran.report.counters.passes).toBe(2);
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] content.loop-ended', { passes: 2,
      nothingPending: false, maxPasses: false, stalled: true, cut: false }]);
  });

  it('flags a choice of Other whose box never shows: its free text was typed nowhere', async () => {
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <label for="source">How did you hear about us?</label><select id="source" name="source">
      <option value="">Select...</option><option value="indeed">Indeed</option><option value="glassdoor">Glassdoor</option>
      <option value="other">Other</option></select>`), 'other-without-box');
    expect(ran.value('source')).toBe('other');
    expect(ran.row(SOURCE)).toMatchObject({ status: 'flagged', reason: 'other-without-free-text', wrote: true,
      provenance: 'profile' });
    expectInvariants(ran);
  });

  it('never plans a list while it shows its old options and is still loading new ones', async () => {
    // The country list is busy when the page loads, still showing two options; the full list replaces them later.
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <div id="country-field"><label for="country">Country</label><select id="country" name="country" aria-busy="true">
      <option value="">Select...</option><option value="CA">Canada</option><option value="MX">Mexico</option></select></div>`,
    `<script>setTimeout(() => { const country = document.getElementById('country');
      const us = document.createElement('option'); us.value = 'US'; us.textContent = 'United States';
      country.append(us); country.removeAttribute('aria-busy'); }, 400);</script>`), 'held-back');
    const plans = planned(ran.worker);
    expect(plans[0]!.labels).toEqual(['Full name']);
    expect(plans.some((plan) => plan.labels.includes('Country'))).toBe(true);
    expect(ran.value('country')).toBe('US');
    expect(ran.writes('country')).toBe(1);
    expect(ran.row('Country')).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
    expectInvariants(ran);
  });
});

/** The async-options page as its variant: a srcdoc frame reads it from data-variant. */
const asyncPage = (variant: string) => asyncOptions.replace('<html lang="en">', `<html lang="en" data-variant="${variant}">`);

describe('a dependent list whose options load asynchronously', () => {
  for (const [variant, delay] of [['fast', 400], ['slow', 1200]] as const) {
    it(`chooses the state once its options are there (${delay} ms), and the page settles`, async () => {
      const ran = await fill(asyncPage(variant), `async-options-${variant}`);
      expectInvariants(ran);
      expect(ran.end).toBe('review');
      for (const label of ['Full name', 'Email', 'Country']) {
        expect(ran.row(label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
      }
      expect(ran.row('State')).toMatchObject({ category: 'address.region', status: 'verified', wrote: true });
      expect((ran.fixture.doc.getElementById('state') as HTMLSelectElement).selectedOptions[0]?.text).toBe('Texas');
      expect(ran.writes('state')).toBe(1);
      expect(ran.counter('__optionsSettledAt')).not.toBeNull();
      // The state waited in the first pass (its placeholder only) and was chosen in the next.
      const plans = planned(ran.worker);
      expect(plans[0]!.labels).toContain('State');
      expect(plans.slice(1).some((plan) => plan.labels.includes('State'))).toBe(true);
      expect(ran.report.counters.passes).toBeGreaterThanOrEqual(2);
      expect(ran.report.notices.map((notice) => notice.code)).not.toContain('page-busy');
    });
  }

  for (const variant of ['never', 'failed'] as const) {
    it(`flags the state options-never-loaded within the cap when its options ${variant === 'never' ? 'never come' : 'fail'}`,
      async () => {
        const cap = 1_500;
        const ran = await fill(asyncPage(variant), `async-options-${variant}`,
          { settle: { quietMs: 200, optionsCapMs: cap }, awaitOptions: { capMs: cap } });
        const finished = Date.now();
        expectInvariants(ran);
        expect(ran.end).toBe('review');
        expect(ran.report.status).toBe('review');
        expect(ran.row('Country')).toMatchObject({ status: 'verified', wrote: true });
        expect(ran.row('State')).toMatchObject({ category: 'address.region', status: 'flagged',
          reason: 'options-never-loaded', wrote: false, provenance: null });
        expect(ran.value('state')).toBe('');
        expect(ran.events.on('state')).toEqual([]);
        expect(ran.report.notices.map((notice) => notice.code)).not.toContain('page-busy');
        expect(finished - (ran.counter('__optionsRequestedAt') as number)).toBeLessThanOrEqual(cap + 1_000);
      });
  }

  it('ends a wait for a list\'s options at once when the person cancels', async () => {
    const started = await start(asyncPage('never'), 'async-options-cancel', { settle: { quietMs: 200,
      optionsCapMs: 300 }, awaitOptions: { capMs: 5_000 } });
    const running = started.runtime.fill()!;
    const requestedAt = () => (started.fixture.view as unknown as { __optionsRequestedAt: number | null })
      .__optionsRequestedAt;
    // Well past the settle (300 ms of loading counts as busy), well before the 5 s wait's cap.
    await vi.waitFor(() => {
      expect(requestedAt()).not.toBeNull();
      expect(Date.now() - requestedAt()!).toBeGreaterThan(1_000);
    }, { timeout: 4_000, interval: 50 });
    await started.worker.platform.deliver({ v: 1, type: 'run/cancel' });
    const ran = ranOf(started, await running);
    expect(Date.now() - requestedAt()!).toBeLessThan(3_000);
    expect(ran.end).toBe('stopped');
    expect(ran.report.status).toBe('stopped');
    expect(ran.row('Country')).toMatchObject({ status: 'verified', wrote: true });
    expect(ran.row('State')).toMatchObject({ status: 'flagged', reason: 'user-stopped', wrote: false });
    expect(ran.events.on('state')).toEqual([]);
  });

  it('pauses at the settle cap on a page that stays busy: the state left page-busy, and Continue starts afresh',
    async () => {
      const started = await start(asyncPage('page-busy'), 'async-options-page-busy', { settle: { quietMs: 200,
        capMs: 1_500 } });
      const requested = Date.now();
      const ran = ranOf(started, await started.runtime.fill());
      expectInvariants(ran);
      expect(ran.end).toBe('paused');
      expect(ran.report).toMatchObject({ status: 'handoff', pauseReason: 'page-busy' });
      expect(ran.report.notices.map((notice) => notice.code)).toContain('page-busy');
      expect(Date.now() - requested).toBeGreaterThanOrEqual(1_500);
      for (const label of ['Full name', 'Email', 'Country']) {
        expect(ran.row(label), label).toMatchObject({ provenance: 'profile', wrote: true });
      }
      // The states did arrive, but the pass stopped at the cap: the state is the person's, unwritten.
      expect(ran.fixture.doc.querySelector('#state option[value="TX"]')).not.toBeNull();
      expect(ran.row('State')).toMatchObject({ category: 'address.region', status: 'flagged', reason: 'page-busy',
        wrote: false, provenance: null });
      expect(ran.writes('state')).toBe(0);
      expect(ran.worker.runStates.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'page-busy',
        resumeStatus: 'fill-step' });
      expect(ran.runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', action: 'continue', reason: 'pause' });
      expect(ran.runtime.ui!.notices.shown).toContain('page-busy');
      expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] content.page-busy', { 'aria-busy': true,
        progressbar: true, adapter: false, 'options-loading': false }]);
      await started.worker.platform.deliver({ v: 1, type: 'run/continue' });
      await vi.waitFor(() => expect(started.worker.of('run/begin')).toHaveLength(2));
    });
});

/** A referral select whose Other puts a box labelled `boxLabel` right after it, at once or `delayMs` later. */
const otherBoxPage = (boxLabel: string, delayMs: number | null = null) => page(`<label for="name">Full name</label>
  <input id="name" name="name"><div id="src-field"><label for="source">How did you hear about us?</label>
  <select id="source" name="source"><option value="">Select...</option><option value="indeed">Indeed</option>
  <option value="glassdoor">Glassdoor</option><option value="other">Other</option></select></div>`,
`<script>(() => { const s = document.getElementById('source'); s.addEventListener('change', () => {
  if (s.value !== 'other' || document.getElementById('box')) return;
  const add = () => { const l = document.createElement('label'); l.htmlFor = 'box'; l.textContent = ${JSON.stringify(boxLabel)};
    const i = document.createElement('input'); i.id = 'box'; i.name = 'box';
    document.getElementById('src-field').after(l, i); };
  ${delayMs === null ? 'add();' : `setTimeout(add, ${delayMs});`} }); })();</script>`);

describe('the Phase 3 review: the follow-up box', () => {
  for (const label of ['What visa type do you hold?', 'Expected salary', 'Pronouns',
    'Type your full name as your electronic signature']) {
    it(`types the referral's free text into no box that does not ask for it: "${label}" (L-S1, LC-1)`, async () => {
      const ran = await fill(otherBoxPage(label), `follow-up-label-${label.length}`);
      expect(ran.value('box')).toBe('');
      expect(ran.writes('box')).toBe(0);
      expect(ran.row(SOURCE)).toMatchObject({ reason: 'other-without-free-text', status: 'flagged', wrote: true });
      expectInvariants(ran);
    });
  }

  for (const label of ['Please specify your visa type', 'If other, please specify your pronouns',
    'Please specify your expected salary']) {
    it(`types nothing into a box that asks, when its own category is legal or sensitive: "${label}" (L-S1)`, async () => {
      const ran = await fill(otherBoxPage(label), `follow-up-category-${label.length}`);
      expect(ran.value('box')).toBe('');
      expect(ran.writes('box')).toBe(0);
      expect(ran.row(label)).toMatchObject({ wrote: false, provenance: null });
      expect(ran.row(SOURCE)).toMatchObject({ reason: 'other-without-free-text', wrote: true });
      expectInvariants(ran);
    });
  }

  it('types nothing into a "Please specify" box the page shows later, which the DOM never tied to the choice (LC-1)',
    async () => {
      const ran = await fill(otherBoxPage('Please specify', 120), 'follow-up-late');
      expect(ran.value('source')).toBe('other');
      expect(ran.value('box')).toBe('');
      expect(ran.writes('box')).toBe(0);
      expect(ran.row(SOURCE)).toMatchObject({ reason: 'other-without-free-text', wrote: true });
      expectInvariants(ran);
    });

  it('types nothing into a late box an earlier write was credited with, even a legal one (LC-1, R3)', async () => {
    for (const label of ['Additional information', 'What visa type do you hold?']) {
      const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name"><div id="more"></div>`,
        `<script>(() => { const name = document.getElementById('name'); const more = document.getElementById('more');
          name.addEventListener('change', () => {
            more.insertAdjacentHTML('beforeend', '<label for="source">How did you hear about us?</label>'
              + '<select id="source" name="source"><option value="">Select...</option><option value="indeed">Indeed</option>'
              + '<option value="glassdoor">Glassdoor</option><option value="other">Other</option></select>');
            setTimeout(() => more.insertAdjacentHTML('beforeend',
              '<label for="extra">' + ${JSON.stringify(label)} + '</label><input id="extra" name="extra">'), 340);
          }, { once: true }); })();</script>`), `follow-up-r3-${label.length}`);
      expect(ran.value('source'), label).toBe('other');
      expect(ran.value('extra'), label).toBe('');
      expect(ran.writes('extra'), label).toBe(0);
      expect(ran.row(SOURCE), label).toMatchObject({ reason: 'other-without-free-text' });
      removeFixtures(document);
    }
  });

  it('keeps what the person typed into the box between the pass\'s scan and the write (L-S7)', async () => {
    let doc: Document | null = null;
    const started = await start(otherBoxPage('Please specify'), 'follow-up-typed', { worker: { onMessage: (message) => {
      // The pass that plans the box: its scan saw the box empty, and the person types before the write.
      const box = doc?.getElementById('box') as HTMLInputElement | null | undefined;
      if (message.type === 'plan/request' && box !== null && box !== undefined) box.value = 'A friend';
    } } });
    doc = started.fixture.doc;
    const ran = ranOf(started, await started.runtime.fill());
    expect(ran.value('box')).toBe('A friend');
    expect(ran.writes('box')).toBe(0);
    expect(ran.row('Please specify')).toMatchObject({ wrote: false, provenance: null });
    expect(ran.row(SOURCE)).toMatchObject({ reason: 'other-without-free-text', wrote: true });
    expectInvariants(ran);
  });

  it('types the free text into the box that asks for it, once, and says so (the case that must still work)', async () => {
    const ran = await fill(otherBoxPage('Please specify'), 'follow-up-ok');
    expect(ran.value('box')).toBe('LinkedIn');
    expect(ran.writes('box')).toBe(1);
    expect(ran.row('Please specify')).toMatchObject({ status: 'verified', provenance: 'rule', wrote: true });
    expect(ran.row(SOURCE)).toMatchObject({ reason: 'other-option-with-free-text', wrote: true });
    expectInvariants(ran);
  });
});

/** A gender question whose self-describe option puts a box labelled `boxLabel` right after it, at once or `delayMs`
 *  later. */
const selfDescribePage = (boxLabel: string, delayMs: number | null = null) => page(`<h2>Voluntary self-identification</h2>
  <div id="gender-field"><label for="gender">Gender</label><select id="gender" name="gender">
  <option value="">Select...</option><option value="m">Male</option><option value="f">Female</option>
  <option value="self">Prefer to self-describe</option></select></div>`,
`<script>(() => { const s = document.getElementById('gender'); s.addEventListener('change', () => {
  if (s.value !== 'self' || document.getElementById('box')) return;
  const add = () => { const l = document.createElement('label'); l.htmlFor = 'box'; l.textContent = ${JSON.stringify(boxLabel)};
    const i = document.createElement('input'); i.id = 'box'; i.name = 'box';
    document.getElementById('gender-field').after(l, i); };
  ${delayMs === null ? 'add();' : `setTimeout(add, ${delayMs});`} }); })();</script>`);

describe('the Phase 3 review: a self-described gender (the plan\'s eeo.self-describe, after L-S1)', () => {
  const WORDS = 'Genderqueer';
  const selfDescribing = { worker: { profile: selfDescribedProfile(WORDS) } };
  /** The person's own words appear in no report, RunState or log line. */
  const expectWordsKept = (ran: Ran) => {
    for (const where of [ran.worker.reports, ran.worker.runStates, logs.mock.calls]) {
      expect(JSON.stringify(where).toLowerCase()).not.toContain(WORDS.toLowerCase());
    }
  };

  for (const label of ['Please describe', 'Please describe your gender']) {
    it(`types the person's own words into the box the choice revealed, flagged for them: "${label}"`, async () => {
      const ran = await fill(selfDescribePage(label), `self-describe-${label.length}`, selfDescribing);
      expect(ran.value('gender')).toBe('self');
      expect(ran.row('Gender')).toMatchObject({ category: 'eeo.gender', status: 'flagged', provenance: 'profile',
        reason: 'other-option-with-free-text', wrote: true });
      expect(ran.value('box')).toBe(WORDS);
      expect(ran.writes('box')).toBe(1);
      expect(ran.row(label)).toMatchObject({ status: 'flagged', provenance: 'profile', wrote: true,
        verification: 'verified', needsUserAction: true });
      expectInvariants(ran);
      expectWordsKept(ran);
    });
  }

  for (const label of ['Please describe your race', 'Please specify your visa type',
    'If other, please specify your pronouns']) {
    it(`types nothing into a box of another EEO, a legal or a sensitive question: "${label}"`, async () => {
      const ran = await fill(selfDescribePage(label), `self-describe-refused-${label.length}`, selfDescribing);
      expect(ran.value('gender')).toBe('self');
      expect(ran.value('box')).toBe('');
      expect(ran.writes('box')).toBe(0);
      expect(ran.row('Gender')).toMatchObject({ reason: 'other-without-free-text', wrote: true });
      expectInvariants(ran);
      expectWordsKept(ran);
    });
  }

  it('types nothing into a box the page shows later, on an edge the DOM never saw', async () => {
    const ran = await fill(selfDescribePage('Please describe', 120), 'self-describe-guessed', selfDescribing);
    expect(ran.value('gender')).toBe('self');
    expect(ran.value('box')).toBe('');
    expect(ran.writes('box')).toBe(0);
    expect(ran.row('Gender')).toMatchObject({ reason: 'other-without-free-text', wrote: true });
    expectWordsKept(ran);
  });
});

describe('the Phase 3 review: what the books keep', () => {
  it('stores no echoed value in RunState: each reveal edge\'s label slug is hashed (L-S3, L-S6)', async () => {
    // The page echoes what was typed into the labels of the fields it reveals: the name, and the box's free text.
    const ran = await fill(page(`<div id="name-field"><label for="name">Full name</label><input id="name" name="name">
      </div><div id="src-field"><label for="source">How did you hear about us?</label><select id="source" name="source">
      <option value="">Select...</option><option value="indeed">Indeed</option><option value="other">Other</option>
      </select></div>`,
    `<script>(() => { const reveal = (after, id, text) => { if (document.getElementById(id)) return;
        const l = document.createElement('label'); l.htmlFor = id; l.textContent = text;
        const i = document.createElement('input'); i.id = id; i.name = id; document.getElementById(after).after(l, i); };
      const n = document.getElementById('name');
      n.addEventListener('change', () => reveal('name-field', 'echo', 'Preferred name if not ' + n.value));
      const s = document.getElementById('source');
      s.addEventListener('change', () => { if (s.value !== 'other') return; reveal('src-field', 'box', 'Please specify');
        const box = document.getElementById('box');
        box.addEventListener('change', () => reveal('src-field', 'more', 'Tell us more about ' + box.value)); });
    })();</script>`), 'echo');
    expect(ran.value('box')).toBe('LinkedIn');
    const edges = ran.worker.runStates.at(-1)!.revealEdges;
    expect(edges.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(edges)).not.toMatch(/rivera|alex|linkedin|preferred|tell-us/i);
    expect(edges).toContainEqual([storedBaseKey(base(ran.row(SOURCE))), storedBaseKey(base(ran.row('Please specify')))]);
    // The report keeps the page's labels, by design: page text, in the session's memory (docs/PRIVACY.md).
    expect(ran.rowOf('Preferred name if not Alex Rivera')).toBeDefined();
    expectInvariants({ ...ran, worker: { ...ran.worker, reports: [] } });
  });

  it('plans a phone again with the code select beside it: the code is never typed into the number (LC-2)', async () => {
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <label for="code">Country code</label><select id="code" name="code"><option value="">Select...</option>
      <option value="44">United Kingdom (+44)</option><option value="1">United States (+1)</option></select>
      <label for="phone">Phone number</label><input id="phone" name="phone" type="tel">`,
    `<script>(() => { const phone = document.getElementById('phone'); let once = false; window.__phoneSeen = [];
      phone.addEventListener('input', () => window.__phoneSeen.push(phone.value));
      phone.addEventListener('change', () => { if (once) return; once = true;
        setTimeout(() => { phone.value = ''; }, 120); }); })();</script>`), 'phone-again');
    expect(ran.counter('__phoneSeen')).toEqual(['512 555 0147', '512 555 0147']);
    expect(planned(ran.worker)[1]!.labels).toEqual(['Phone number']);
    expect(ran.row('Phone number')).toMatchObject({ status: 'verified', wrote: true });
    expectInvariants(ran);
  });

  it('sends an upload once: an input the widget empties after taking the file stays verified (LC-3)', async () => {
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <label for="resume">Resume</label><input id="resume" name="resume" type="file" accept=".pdf"><ul id="uploaded"></ul>`,
    `<script>(() => { const input = document.getElementById('resume'); window.__uploads = 0;
      input.addEventListener('change', () => { if (!input.files || input.files.length === 0) return;
        const name = input.files[0].name; setTimeout(() => { window.__uploads += 1;
          const li = document.createElement('li'); li.textContent = name; document.getElementById('uploaded').append(li);
          input.value = ''; }, 50); }); })();</script>`), 'upload-once',
    { worker: { resume: { bytes: fakePdf(20_000), name: 'Alex Rivera Resume.pdf', mime: 'application/pdf' } } });
    await vi.waitFor(() => expect(ran.counter('__uploads')).toBe(1));
    expect(ran.worker.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(1);
    expect(ran.row('Resume')).toMatchObject({ status: 'verified', wrote: true, provenance: 'profile' });
    expect(planned(ran.worker).filter((plan) => plan.labels.includes('Resume'))).toHaveLength(1);
  });

  it('never overwrites another value the page put in place of ours: flagged, as written and not read back (LC-4)',
    async () => {
      const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
        <label for="city">City</label><input id="city" name="city">`,
      `<script>(() => { const name = document.getElementById('name'); let once = false;
        name.addEventListener('change', () => { if (once) return; once = true;
          setTimeout(() => { name.value = 'Alexander Rivera'; }, 60); }); })();</script>`), 'replaced');
      expect(ran.value('name')).toBe('Alexander Rivera');
      expect(ran.writes('name')).toBe(1);
      expect(ran.row('Full name')).toMatchObject({ status: 'filled', reason: 'verify-mismatch', wrote: true,
        needsUserAction: true });
    });

  it('waits for a list whose loading row says "Loading... please wait", then chooses from its options (LC-7)',
    async () => {
      const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
        <label for="country">Country</label><select id="country" name="country"><option value="">Select...</option>
        <option value="CA">Canada</option><option value="US">United States</option></select>
        <label for="state">State</label><select id="state" name="state"><option value="">Select a state</option></select>`,
      `<script>(() => { const country = document.getElementById('country'); const state = document.getElementById('state');
        country.addEventListener('change', () => {
          state.innerHTML = '<option value="">Loading... please wait</option>';
          setTimeout(() => { state.innerHTML = '<option value="">Select a state</option><option value="CA">California</option>'
            + '<option value="TX">Texas</option>'; }, 1200);
        }); })();</script>`), 'loading-please-wait');
      expect(ran.value('state')).toBe('TX');
      expect(ran.writes('state')).toBe(1);
      expect(ran.row('State')).toMatchObject({ status: 'verified', wrote: true });
      expectInvariants(ran);
    });

  it('plans a list held back while busy once its busy sign clears, though its options never change (LC-8)',
    async () => {
      const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
        <div id="country-field"><label for="country">Country</label><select id="country" name="country" aria-busy="true">
        <option value="">Select...</option><option value="CA">Canada</option><option value="US">United States</option>
        <option value="MX">Mexico</option></select></div>`,
      `<script>setTimeout(() => document.getElementById('country').removeAttribute('aria-busy'), 300);</script>`),
      'held-same', { awaitOptions: { capMs: 1_500 } });
      expect(ran.value('country')).toBe('US');
      expect(ran.row('Country')).toMatchObject({ status: 'verified', wrote: true, provenance: 'profile' });
      expectInvariants(ran);
    });

  it('keeps our row for a list we wrote whose options grow afterwards, still holding our answer (LC-9)', async () => {
    const ran = await fill(page(`<label for="name">Full name</label><input id="name" name="name">
      <label for="country">Country</label><select id="country" name="country"><option value="">Select...</option>
      <option value="CA">Canada</option><option value="US">United States</option></select>`,
    `<script>(() => { const country = document.getElementById('country');
      country.addEventListener('change', () => setTimeout(() => { const o = document.createElement('option');
        o.value = 'MX'; o.textContent = 'Mexico'; country.append(o); }, 50), { once: true }); })();</script>`), 'grown');
    expect(ran.value('country')).toBe('US');
    expect(ran.writes('country')).toBe(1);
    expect(ran.row('Country')).toMatchObject({ status: 'verified', wrote: true, provenance: 'profile',
      verification: 'verified' });
    expectInvariants(ran);
  });

  it('rows what a pass revealed before a Cancel during its settle cuts the loop (LC-11)', async () => {
    const started = await start(page(`<label for="name">Full name</label><input id="name" name="name"><div id="more"></div>`,
      `<script>(() => { const name = document.getElementById('name'); const more = document.getElementById('more');
        name.addEventListener('change', () => {
          more.insertAdjacentHTML('beforeend', '<label for="city">City</label><input id="city" name="city">');
          window.__revealed = true;
          let n = 0; const tick = setInterval(() => { more.dataset.n = String(n++); if (n > 8) clearInterval(tick); }, 100);
        }, { once: true }); })();</script>`), 'cancel-in-settle');
    const running = started.runtime.fill()!;
    await vi.waitFor(() => expect((started.fixture.view as unknown as { __revealed?: boolean }).__revealed).toBe(true),
      { timeout: 3_000, interval: 10 });
    await started.worker.platform.deliver({ v: 1, type: 'run/cancel' });
    const ran = ranOf(started, await running);
    expect(ran.end).toBe('stopped');
    expect(ran.row('City')).toMatchObject({ status: 'flagged', reason: 'user-stopped', wrote: false });
    expect(ran.writes('city')).toBe(0);
  });

  it('refinds the lists the page keeps replacing with one shared scan at a time, within a budget (L-S5)', async () => {
    const lists = 30;
    const started = await start(page(`<div><label for="name">Full name</label><input id="name" name="name"></div>
      ${Array.from({ length: lists }, (_, at) => `<div class="f"><label for="s${at}">State</label><select id="s${at}">
        <option value="">Select...</option></select></div>`).join('')}`,
    `<script>document.getElementById('name').addEventListener('change', () => setTimeout(() => setInterval(() => {
      for (const c of document.querySelectorAll('div.f')) c.replaceWith(c.cloneNode(true)); }, 100), 700),
      { once: true });</script>`), 'refind-budget', { awaitOptions: { capMs: 3_000 } });
    const root = started.fixture.doc.getElementById('application')!;
    const queryAll = started.fixture.view.Element.prototype.querySelectorAll;
    let queries = 0;
    root.querySelectorAll = function count(this: Element, selector: string) {
      queries += 1;
      return queryAll.call(this, selector);
    } as typeof root.querySelectorAll;
    const ran = ranOf(started, await started.runtime.fill());
    expect(ran.end).toBe('review');
    expect(ran.report.fields.filter((row) => row.label === 'State').every((row) => row.reason === 'options-never-loaded'))
      .toBe(true);
    expect(queries).toBeLessThan(200);
  });
});

describe('the Phase 3 review: a correction the person types (LC-4)', () => {
  let form: HTMLFormElement | null = null;
  afterEach(() => {
    form?.remove();
    form = null;
  });

  it('never overwrites a value the person changed after our write, and says it is theirs', async () => {
    // In the test's own document, where the person's typing (userEvent: trusted events) can reach the form.
    const label = (htmlFor: string, text: string) => Object.assign(document.createElement('label'), { htmlFor,
      textContent: text });
    const box = (id: string, name: string) => Object.assign(document.createElement('input'), { id, name });
    form = Object.assign(document.createElement('form'), { id: 'application' });
    const input = box('lc4-name', 'name');
    const more = Object.assign(document.createElement('div'), { id: 'lc4-more' });
    form.append(label('lc4-name', 'Full name'), input, more, Object.assign(document.createElement('button'),
      { type: 'submit', textContent: 'Submit application' }));
    document.body.append(form);
    // The name's change shows a City question, so a second pass comes.
    input.addEventListener('change', () => {
      if (document.getElementById('lc4-city')) return;
      more.append(label('lc4-city', 'City'), box('lc4-city', 'city'));
    });
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, document, { href: () => boardUrl('lc4-typed'),
      isTop: true, settle: { quietMs: 400 } });
    runtimes.push(runtime);
    const running = runtime.fill()!;
    await vi.waitFor(() => expect(input.value).toBe('Alex Rivera'), { timeout: 5_000, interval: 5 });
    await userEvent.fill(input, 'Alexander Rivera');
    expect(await running).toBe('review');
    expect(input.value).toBe('Alexander Rivera');
    expect((document.getElementById('lc4-city') as HTMLInputElement).value).toBe('Austin');
    const report = worker.reports.at(-1)!;
    expect(report.fields.find((row) => row.label === 'Full name')).toMatchObject({ status: 'flagged',
      reason: 'changed-by-you', provenance: null, wrote: false, needsUserAction: true });
    expect(worker.of('plan/request').length).toBeGreaterThanOrEqual(2);
  });
});
