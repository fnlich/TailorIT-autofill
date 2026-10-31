/*
 * The reactive loop (loop.ts) end to end in the content runtime, with the fake worker planning each pass with the real
 * planFrame over the golden profile, on the synthetic fixtures (fixtures/synthetic: conditional-reveal and
 * async-options, whose headers say what each page does) and a few small pages of its own: what is revealed, swapped,
 * removed and reset; dependent lists that load fast, slowly, never, or fail; a page that stays busy; the pass limit; a
 * stalled page; Cancel mid-loop; the follow-up box; a dry run.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import asyncOptions from '../../fixtures/synthetic/async-options/index.html?raw';
import conditionalReveal from '../../fixtures/synthetic/conditional-reveal/index.html?raw';
import { baseKeyOf, MAX_PASSES, MAX_VALUE_FLIPS } from '../core/loop/bookkeeping';
import type { PlanOutput } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import {
  createFakeWorker, PAGE_TEXT_SENTINELS, sentinelsIn, testVocab, VALUE_SENTINELS, type FakeWorker,
  type FakeWorkerOptions,
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
  expect(JSON.stringify(logs.mock.calls).toLowerCase()).not.toContain('linkedin');
}

/** The pass index of every plan/request, and the labels each one asked about. */
function planned(worker: FakeWorker): Array<{ pass: number; labels: string[] }> {
  return worker.of('plan/request').map((message) => ({ pass: message.pass as number,
    labels: (message.specs as FieldSpec[]).map((spec) => spec.label) }));
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
      expect(edges, `${parent.label} -> ${child}`).toContainEqual([base(parent), base(ran.row(child))]);
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

  it('leaves the box alone when the worker blocks it, and keeps the choice flagged', async () => {
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
    expect(ran.row(SOURCE)).toMatchObject({ status: 'flagged', reason: 'other-option-with-free-text', wrote: true });
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
