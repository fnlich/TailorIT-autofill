import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import trap01 from '../../fixtures/traps/01-white-on-white.html?raw';
import trap01b from '../../fixtures/traps/01b-canary-equals-profile.html?raw';
import trap02 from '../../fixtures/traps/02-zero-and-offscreen.html?raw';
import trap03 from '../../fixtures/traps/03-html-comment.html?raw';
import trap03b from '../../fixtures/traps/03b-hidden-option-placeholder.html?raw';
import trap04 from '../../fixtures/traps/04-honeypots.html?raw';
import trap05 from '../../fixtures/traps/05-check-all-instruction.html?raw';
import trap06 from '../../fixtures/traps/06-attention-check.html?raw';
import trap07 from '../../fixtures/traps/07-option-injection.html?raw';
import trap08 from '../../fixtures/traps/08-canary-in-draft.html?raw';
import trap09 from '../../fixtures/traps/09-hidden-file-input.html?raw';
import trap10 from '../../fixtures/traps/10-select-all-that-apply.html?raw';
import trap11 from '../../fixtures/traps/11-forged-wxt-events.html?raw';
import leverSpotify from '../../fixtures/lever/spotify-ny.html?raw';
import { genericAdapter } from '../adapters/generic';
import { leverAdapter } from '../adapters/lever';
import type { Adapter } from '../adapters/types';
import type { PlanOutput } from '../core/plan/types';
import type { FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { logEvents, loadFixture, removeFixtures, untrustedViolations, watchHoneypots, type EventLog,
  type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import {
  createFakeWorker, fakePdf, PAGE_TEXT_SENTINELS, sentinelsIn, testVocab, trapUrl, VALUE_SENTINELS,
  type FakeWorker, type FakeWorkerOptions,
} from './content.testkit';
import type { RunEnd } from './orchestrator';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** The test-only adapter of trap 9 (d): it declares the visible Attach button as its hidden input's upload widget. */
const TRAP_09_ADAPTER: Adapter = {
  ...genericAdapter,
  uploadWidgets: (root) => [{ control: root.querySelector('#attach-d')!, input: root.querySelector<HTMLInputElement>('#file-d')! }],
  labelFor: (control) => (control.id === 'file-d' ? control.ownerDocument.getElementById('label-d') : null),
};

/** A run over a fixture, and what it left. */
interface Ran {
  fixture: Fixture;
  worker: FakeWorker;
  runtime: ContentRuntime;
  end: RunEnd | null;
  events: EventLog;
  honeypots: { changes(): number };
  report: FrameReport;
  row(label: string): FillResult;
  value(id: string): string;
  checked(name: string): string[];
}

interface RunOptions {
  worker?: FakeWorkerOptions;
  adapter?: Adapter;
  dryRun?: boolean;
  /** The page's address (a trap's by default). */
  href?: string;
}

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

async function start(html: string, id: string, options: RunOptions = {}) {
  const fixture = await loadFixture(document, html);
  const events = logEvents(fixture.doc);
  const honeypots = watchHoneypots(fixture.doc);
  const worker = createFakeWorker(options.worker);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, {
    href: () => options.href ?? trapUrl(id), isTop: true, quiet: { quietMs: 60 },
    ...(options.adapter ? { adapters: () => [options.adapter!] } : {}),
  });
  runtimes.push(runtime);
  return { fixture, events, honeypots, worker, runtime };
}

function ranOf(started: Awaited<ReturnType<typeof start>>, end: RunEnd | null): Ran {
  const { fixture, worker } = started;
  const report = worker.reports.at(-1)!;
  return {
    ...started,
    end,
    report,
    row(label) {
      const found = report.fields.find((row) => row.label === label);
      if (found === undefined) throw new Error(`no row labelled ${JSON.stringify(label)}`);
      return found as FillResult;
    },
    value: (id) => (fixture.doc.getElementById(id) as HTMLInputElement).value,
    checked: (name) => Array.from(fixture.doc.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`))
      .filter((input) => input.checked).map((input) => input.value),
  };
}

/** Loads a trap, fills it once, and answers what happened. */
async function fillTrap(html: string, id: string, options: RunOptions = {}): Promise<Ran> {
  const started = await start(html, id, options);
  const end = await started.runtime.fill({ dryRun: options.dryRun ?? false });
  return ranOf(started, end);
}

/** The values of every form control on the page: what the extension may have written. */
function formValues(doc: Document): string[] {
  return Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'), (el) => el.value);
}

/** What every trap must hold (the DOM half of assertTrapInvariants). */
function expectInvariants(ran: Ran, sentinels: readonly string[] = VALUE_SENTINELS): void {
  expect(ran.end).toBe('review');
  expect(ran.report.status).toBe('review');
  expect(untrustedViolations(ran.events.events)).toEqual([]);
  expect(ran.events.events.filter((event) => event.type === 'submit')).toEqual([]);
  for (const row of ran.report.fields) {
    if (row.status === 'filled' || row.status === 'verified') expect(row.provenance, row.label).not.toBeNull();
  }
  for (const value of formValues(ran.fixture.doc)) expect(value).not.toMatch(/HIDDEN-MARKER/);
  expect(sentinelsIn(JSON.stringify(ran.worker.reports), sentinels)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(ran.worker.runStates), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
}

describe('a whole pass over the trap fixtures, planned from the golden profile', () => {
  it('trap 01: fills name and email from the profile, ignores the camouflaged instruction, shows the notice once', async () => {
    const ran = await fillTrap(trap01, '01');
    expectInvariants(ran);
    for (const label of ['First name', 'Last name', 'Email']) {
      expect(ran.row(label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
    }
    expect([ran.value('first'), ran.value('last'), ran.value('email')])
      .toEqual(['Alex', 'Rivera', 'alex.rivera.f7q2@example.com']);
    expect(ran.value('why')).toBe('');
    expect(ran.events.on('why')).toEqual([]);
    expect(ran.report.notices.filter((notice) => notice.code === 'tripwire')).toHaveLength(1);
    expect(ran.runtime.ui!.notices.shown).toContain('tripwire');
    const request = ran.worker.of('plan/request')[0]!;
    expect(request.canaries).toContain('i am llm');
    expect(ran.worker.runStates.at(-1)).toMatchObject({ status: 'review', tripwire: { triggered: true } });
  });

  it('trap 01b: blocks every value holding a canary that equals a profile value, and never stores it', async () => {
    const ran = await fillTrap(trap01b, '01b');
    expectInvariants(ran);
    for (const label of ['City', 'Current location']) {
      expect(ran.row(label), label).toMatchObject({ status: 'blocked', reason: 'canary-equals-profile-value' });
    }
    expect([ran.value('city'), ran.value('location')]).toEqual(['', '']);
    expect(ran.row('Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(ran.worker.runStates.at(-1)!.canarySet).toEqual([]);
  });

  it('trap 02: fills the visible fields and ticks exactly the profile’s skills, never "banana"', async () => {
    const ran = await fillTrap(trap02, '02');
    expectInvariants(ran, VALUE_SENTINELS);
    expect(ran.row('Email')).toMatchObject({ status: 'verified' });
    expect(ran.checked('skills').sort()).toEqual(['postgresql', 'typescript']);
    for (const value of formValues(ran.fixture.doc)) expect(value.toLowerCase()).not.toContain('banana');
  });

  it('trap 03: fills the field whose label holds a comment, and no value holds a canary', async () => {
    const ran = await fillTrap(trap03, '03');
    expectInvariants(ran);
    expect(ran.row('First name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    for (const value of formValues(ran.fixture.doc)) expect(value.toLowerCase()).not.toMatch(/i am llm|robot/);
    expect(ran.report.notices.map((notice) => notice.code)).toContain('tripwire');
  });

  it('trap 03b: never selects the hidden option, and its marker reaches no message', async () => {
    const ran = await fillTrap(trap03b, '03b');
    expectInvariants(ran);
    const degree = ran.fixture.doc.getElementById('degree') as HTMLSelectElement;
    expect(degree.selectedOptions[0]?.hidden).not.toBe(true);
    expect(JSON.stringify(ran.worker.messages)).not.toContain('HIDDEN-MARKER-03B');
  });

  it('trap 04: leaves every honeypot untouched and fills the real Email', async () => {
    const ran = await fillTrap(trap04, '04');
    expectInvariants(ran);
    expect(ran.honeypots.changes()).toBe(0);
    for (const id of ['website', 'alt-phone', 'hp-check', 'hp-radio', 'fax']) expect(ran.events.on(id), id).toEqual([]);
    expect(ran.row('Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(ran.report.counters.hiddenControlsIgnored).toBe(6);
  });

  it('trap 05: ticks only the profile’s skills, aborts the all-matching group, and ticks no loose box', async () => {
    // (c)'s loose checkboxes are labelled with skill names, which are then the rows' labels: page text.
    const ran = await fillTrap(trap05, '05');
    expectInvariants(ran, VALUE_SENTINELS);
    expect(ran.checked('skills_a').sort()).toEqual(['kubernetes', 'typescript']);
    // One click per box the profile asks for: none on the other four.
    expect(ran.events.events.filter((event) => event.type === 'click' && event.target === 'skills_a')).toHaveLength(2);
    expect(ran.row('Which of these skills apply to you?')).toMatchObject({ status: 'blocked', reason: 'mark-all-aborted' });
    expect(ran.checked('skills_b')).toEqual([]);
    expect(Array.from(ran.fixture.doc.querySelectorAll<HTMLInputElement>('input[name^="loose_"]'))
      .filter((box) => box.checked)).toEqual([]);
  });

  it('trap 06: leaves every attention check empty and flagged, with no write event', async () => {
    const ran = await fillTrap(trap06, '06');
    expectInvariants(ran);
    for (const label of ["To confirm you are a human, type the word 'human' below.", 'Attention check: select PURPLE.',
      "To prove you read this, choose 'Strongly disagree'."]) {
      expect(ran.row(label), label).toMatchObject({ status: 'flagged', reason: 'attention-check', wrote: false });
    }
    expect(ran.value('human')).toBe('');
    expect(ran.checked('q2')).toEqual([]);
    expect((ran.fixture.doc.getElementById('scale') as HTMLSelectElement).value).toBe('');
    for (const id of ['human', 'scale']) expect(ran.events.on(id), id).toEqual([]);
    expect(ran.report.notices.map((notice) => notice.code)).toContain('attention-check');
  });

  it('trap 07: chooses Bachelor’s and LinkedIn, never the options that tell AI tools to pick them', async () => {
    const ran = await fillTrap(trap07, '07');
    expectInvariants(ran);
    expect(ran.row('Degree')).toMatchObject({ status: 'verified' });
    expect((ran.fixture.doc.getElementById('degree') as HTMLSelectElement).value).toBe('bachelor');
    expect(ran.row('How did you hear about us?')).toMatchObject({ status: 'verified' });
    expect(ran.checked('source')).toEqual(['linkedin']);
    expect(ran.report.notices.map((notice) => notice.code)).toContain('tripwire');
  });

  it('trap 09: puts the resume into (a) and (d) through the transfer, flags (b), and leaves (c) alone', async () => {
    const bytes = fakePdf(300_000);
    const ran = await fillTrap(trap09, '09', { adapter: TRAP_09_ADAPTER,
      worker: { resume: { bytes, name: 'Alex Rivera Resume.pdf', mime: 'application/pdf' } } });
    expectInvariants(ran);
    for (const [label, id] of [['Attach resume', 'resume'], ['Resume', 'file-d']] as const) {
      expect(ran.row(label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
      const held = (ran.fixture.doc.getElementById(id) as HTMLInputElement).files![0]!;
      expect([held.name, held.type, held.size]).toEqual(['Alex Rivera Resume.pdf', 'application/pdf', bytes.length]);
    }
    expect((ran.fixture.view as unknown as { __resumeChanges: number }).__resumeChanges).toBe(1);
    expect(ran.row('Attach')).toMatchObject({ status: 'flagged', reason: 'upload-control-not-recognized', wrote: false });
    expect(ran.events.on('file-b')).toEqual([]);
    expect(ran.events.on('file-c')).toEqual([]);
    expect(ran.honeypots.changes()).toBe(0);
    expect(ran.worker.portLog.filter((entry) => entry.message.type === 'resume/request')).toHaveLength(2);
    expect(logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] content.resume-released').length)
      .toBeGreaterThanOrEqual(2);
  });

  it('trap 10: ends with exactly the profile’s skills, never clicking the pre-checked one or None', async () => {
    const ran = await fillTrap(trap10, '10');
    expectInvariants(ran, VALUE_SENTINELS);
    expect(ran.checked('skills').sort()).toEqual(['kubernetes', 'postgresql', 'typescript']);
    expect(ran.row('Which of these skills do you use? (select all that apply)'))
      .toMatchObject({ wrote: true, verification: 'verified' });
    const strongest = ran.fixture.doc.getElementById('strongest') as HTMLSelectElement;
    expect(Array.from(strongest.selectedOptions, (option) => option.value).sort()).toEqual(['postgresql', 'typescript']);
    expect(ran.row('Which of these skills are your strongest? (choose up to 2)'))
      .toMatchObject({ reason: 'max-selections-reached', verification: 'verified' });
    expect(ran.report.notices.map((notice) => notice.code)).not.toContain('tripwire');
    expect(ran.report.notices.map((notice) => notice.code)).not.toContain('attention-check');
  });

  it('trap 11: reaches review through the forged WXT events, logs them, and keeps its UI', async () => {
    const ran = await fillTrap(trap11, '11', { worker: { id: 'flmloalhjldmcihejnmkndbcnhaacmng' } });
    expectInvariants(ran);
    expect((ran.fixture.view as unknown as { __forgedEvents: number }).__forgedEvents).toBe(3);
    const forged = logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] content.forged-wxt-event');
    expect(forged.map(([, data]) => data)).toEqual(expect.arrayContaining([{ started: true }, { locationChange: true }]));
    expect(ran.runtime.stopped).toBe(false);
    expect(ran.runtime.ui!.host.isConnected).toBe(true);
    expect(ran.runtime.ui!.launcher.view.state).toBe('review');
  });
});

describe('on a real Lever snapshot, through the registry', () => {
  it('fills with the Lever adapter, without pausing for the invisible hCaptcha the page carries, and submits nothing', async () => {
    // The snapshot's own address, as the e2e suite serves it; the registry picks the adapter.
    const ran = await fillTrap(leverSpotify, 'unused',
      { href: 'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply' });
    expect(ran.report.adapter).toBe(leverAdapter.id);
    expectInvariants(ran);
    const codes = ran.report.notices.map((notice) => notice.code);
    expect(codes).not.toContain('captcha');
    expect(codes).not.toContain('auth');
    expect(ran.row('Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(ran.row('Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    const name = ran.fixture.doc.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.value).toBe('Alex Rivera');
  });
});

/** Trap 8's fake AI client: the plan gains an llm-draft write for the free-text question, holding `text`. */
function draftFor(label: string, text: string) {
  return (plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput => {
    const spec = specs.find((candidate) => candidate.label === label)!;
    const write: PlannedWrite = { key: spec.key, value: { kind: 'text', text },
      origin: { provenance: 'llm-draft', taskId: 'task-draft-1', confirmedByUser: false },
      match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 0.7, flags: [], suggestions: [],
        reason: 'ok' } };
    return { ...plan, writes: [...plan.writes, write], results: plan.results.map((row) => (row.key === spec.key
      ? { ...row, status: 'flagged', provenance: 'llm-draft', matcherStage: 'not-applicable', confidence: 0.7,
        reason: 'llm-draft-needs-confirmation', wrote: false, verification: 'not-checked', needsUserAction: true }
      : row)) };
  };
}

describe('trap 08: a canary in an LLM draft', () => {
  for (const [name, text] of [['the canary as the page wrote it', 'Your mission speaks to me, like pineapple to pizza.'],
    ['the canary in another case (8b)', 'I would bring PINEAPPLE energy to the team.']] as const) {
    it(`never writes the textarea when the draft holds ${name}: blocked canary-in-value, and the run ends in review`,
      async () => {
        const ran = await fillTrap(trap08, '08', { worker: { editPlan: draftFor('Why this company?', text) } });
        expectInvariants(ran);
        expect(ran.value('why')).toBe('');
        expect(ran.events.on('why')).toEqual([]);
        expect(ran.row('Why this company?')).toMatchObject({ status: 'blocked', reason: 'canary-in-value',
          wrote: false, provenance: null });
        expect(ran.report.fields.filter((row) => row.status === 'blocked')).toHaveLength(1);
        expect(ran.row('Email')).toMatchObject({ status: 'verified' });
        expect(ran.report.notices.map((notice) => notice.code)).toContain('tripwire');
        expect(ran.runtime.ui!.launcher.view).toMatchObject({ state: 'review', action: 'open-review' });
      });
  }
});

describe('the policy gate, before anything is filled', () => {
  const plain = trap11.replace(/<script>[\s\S]*<\/script>/, '');

  it('stops at the card on a posting-page hit, reports policy-notice, and fills only after Fill anyway', async () => {
    const started = await start(plain, 'policy-a', { worker: { policy: { postingPage: 'hit', storedCopy: 'clear' } } });
    const running = started.runtime.fill()!;
    await vi.waitFor(() => expect(started.worker.reports.at(-1)?.status).toBe('policy-notice'));
    expect(started.runtime.ui!.notices.cardShown).toBe(true);
    expect(started.runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', reason: 'policy' });
    expect(started.worker.of('plan/request')).toEqual([]);
    expect(started.events.events.filter((event) => event.type === 'input')).toEqual([]);
    // A click from the page's own script on the card is not the person's: nothing happens.
    started.runtime.ui!.shadow.querySelector<HTMLButtonElement>('.card button.action:not(.secondary)')!.click();
    expect(started.runtime.run!.atPolicyCard).toBe(true);
    expect(await started.worker.platform.deliver({ v: 1, type: 'run/continue' })).toEqual({ ok: true, data: {} });
    const ran = ranOf(started, await running);
    expectInvariants(ran);
    expect(ran.row('First name')).toMatchObject({ status: 'verified' });
    expect(ran.report.notices.map((notice) => notice.code)).toContain('policy');
    expect(ran.worker.runStates.at(-1)!.policyDecision).toBe('accepted');
    expect(started.runtime.ui!.notices.cardShown).toBe(false);
  });

  it('reports policy-notice, with the policy notice, before it waits, so the side panel’s choice can reach it',
    async () => {
      // The worker forwards panel/continue and panel/cancel only to frames that have reported.
      const waitingAtReport: Array<boolean | undefined> = [];
      const started = await start(plain, 'policy-report', { worker: {
        policy: { postingPage: 'hit', storedCopy: 'unavailable' },
        onMessage: (message) => {
          if (message.type === 'report/put') waitingAtReport.push(started.runtime.run?.atPolicyCard);
        },
      } });
      const running = started.runtime.fill()!;
      await vi.waitFor(() => expect(started.worker.reports).toHaveLength(1));
      expect(waitingAtReport).toEqual([true]);
      expect(started.worker.reports[0]).toMatchObject({ status: 'policy-notice', fields: [],
        notices: [{ code: 'policy' }] });
      expect(started.worker.of('plan/request')).toEqual([]);
      // The side panel's Cancel, as the worker forwards it.
      expect(await started.worker.platform.deliver({ v: 1, type: 'run/cancel' })).toEqual({ ok: true, data: {} });
      expect(await running).toBe('stopped');
      expect(started.events.events).toEqual([]);
    });

  it('writes nothing after Cancel', async () => {
    const started = await start(plain, 'policy-b', { worker: { policy: { postingPage: 'clear', storedCopy: 'hit' } } });
    const running = started.runtime.fill()!;
    await vi.waitFor(() => expect(started.runtime.run!.atPolicyCard).toBe(true));
    await started.worker.platform.deliver({ v: 1, type: 'run/cancel' });
    expect(await running).toBe('stopped');
    expect(started.worker.of('plan/request')).toEqual([]);
    expect(started.events.events).toEqual([]);
    expect(formValues(started.fixture.doc)).toEqual(['', '', '']);
    expect(started.worker.reports.at(-1)).toMatchObject({ status: 'stopped', fields: [] });
    expect(started.worker.runStates.at(-1)).toMatchObject({ status: 'stopped', policyDecision: 'declined' });
    expect(started.runtime.ui!.launcher.view.state).toBe('idle');
  });

  it('stops on the frame’s own visible text, and says so when only TailorIT’s stored copy did', async () => {
    const page = plain.replace('VISIBLE-MARKER-11', 'Please do not use AI tools to apply. VISIBLE-MARKER-11');
    const own = await start(page, 'policy-c', { worker: { policy: { postingPage: 'clear', storedCopy: 'clear' } } });
    void own.runtime.fill();
    await vi.waitFor(() => expect(own.runtime.run!.atPolicyCard).toBe(true));
    expect(own.runtime.ui!.shadow.querySelector<HTMLElement>('.card .source')!.hidden).toBe(true);
    own.runtime.run!.decline();

    const stored = await start(plain, 'policy-d', { worker: { policy: { postingPage: 'unseen', storedCopy: 'hit' } } });
    void stored.runtime.fill();
    await vi.waitFor(() => expect(stored.runtime.run!.atPolicyCard).toBe(true));
    expect(stored.runtime.ui!.shadow.querySelector<HTMLElement>('.card .source')!.hidden).toBe(false);
    stored.runtime.run!.decline();
  });

  it('shows the couldn’t-read notice when nothing could be read, and fills anyway', async () => {
    const ran = await fillTrap(plain, 'policy-e', { worker: { policy: { postingPage: 'unseen', storedCopy: 'unavailable' } } });
    expectInvariants(ran);
    expect(ran.report.notices.map((notice) => notice.code)).toContain('policy-unreadable');
    expect(ran.runtime.ui!.notices.shown).toContain('policy-unreadable');
    expect(ran.row('Email')).toMatchObject({ status: 'verified' });
  });

  it('adds posting-outside-frame in a frame whose top page runs none of our scripts', async () => {
    const fixture = await loadFixture(document, plain);
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('policy-f'),
      quiet: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    expect(worker.of('frame/hello')[0]).toMatchObject({ isTop: false, hasForm: true });
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).toContain('posting-outside-frame');
  });
});

describe('expired answers and the run’s other ends', () => {
  const plain = trap11.replace(/<script>[\s\S]*<\/script>/, '');

  it('begins again once when plan/request answers expired', async () => {
    const ran = await fillTrap(plain, 'expired-a', { worker: { script: { 'plan/request': [{ ok: false, error: 'expired' }] } } });
    expectInvariants(ran);
    expect(ran.worker.of('run/begin')).toHaveLength(2);
    expect(ran.worker.of('plan/request')).toHaveLength(2);
    expect(ran.report.runId).toBe('run-2');
  });

  it('begins again once when report/put answers expired, and sends the report under the new run', async () => {
    const ran = await fillTrap(plain, 'expired-b', { worker: { script: { 'report/put': [{ ok: false, error: 'expired' }] } } });
    expect(ran.end).toBe('review');
    expect(ran.worker.of('run/begin')).toHaveLength(2);
    expect(ran.report.runId).toBe('run-2');
    expect(ran.worker.of('report/put').map((message) => message.runId)).toEqual(['run-1', 'run-2']);
  });

  it('shows the launcher’s error state at the second expired', async () => {
    const expired = { ok: false, error: 'expired' };
    const started = await start(plain, 'expired-c', { worker: { script: { 'plan/request': [expired, expired] } } });
    expect(await started.runtime.fill()).toBe('error');
    expect(started.runtime.ui!.launcher.view).toMatchObject({ state: 'error', action: 'fill', reason: 'failed' });
    expect(started.events.events).toEqual([]);
  });

  it('says to connect first when the worker is not connected', async () => {
    const started = await start(plain, 'not-connected', { worker: { connected: false } });
    expect(await started.runtime.fill()).toBe('error');
    expect(started.runtime.ui!.launcher.view).toMatchObject({ state: 'error', reason: 'not-connected' });
  });

  it('writes nothing in a dry run, and reports the rows as planned', async () => {
    const started = await start(plain, 'dry-run');
    await started.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: true });
    await vi.waitFor(() => expect(started.runtime.run?.ended).toBe('review'));
    const ran = ranOf(started, 'review');
    expect(ran.events.events).toEqual([]);
    expect(formValues(ran.fixture.doc)).toEqual(['', '', '']);
    expect(ran.report.mode).toBe('dry-run');
    expect(ran.report.fields.every((row) => !row.wrote && row.verification === 'not-checked')).toBe(true);
    expect(ran.row('Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(ran.worker.runStates).toEqual([]);
  });

  it('ends at once, writing nothing, when the extension goes away under the page', async () => {
    const started = await start(plain, 'invalidated', { worker: { onMessage: (message) => {
      if (message.type === 'plan/request') started.worker.platform.invalidate();
    } } });
    expect(await started.runtime.fill()).toBe('aborted');
    expect(started.events.events).toEqual([]);
    expect(started.runtime.stopped).toBe(true);
    expect(started.runtime.ui).toBeNull();
    expect(started.fixture.doc.documentElement.lastElementChild?.localName).not.toBe('div');
  });

  it('plans nothing when the person cancels before the plan, and writes nothing more once they cancel mid-run',
    async () => {
      // The hooks run during fill(), once start() has returned.
      const before = await start(plain, 'cancel-a', { worker: { onMessage: (message) => {
        if (message.type === 'run/begin') void before.worker.platform.deliver({ v: 1, type: 'run/cancel' });
      } } });
      expect(await before.runtime.fill()).toBe('stopped');
      expect(before.worker.of('plan/request')).toEqual([]);
      expect(before.worker.reports.at(-1)).toMatchObject({ status: 'stopped' });

      const during = await start(plain, 'cancel-b', { worker: { onMessage: (message) => {
        if (message.type === 'plan/request') void during.worker.platform.deliver({ v: 1, type: 'run/cancel' });
      } } });
      expect(await during.runtime.fill()).toBe('stopped');
      expect(during.events.events).toEqual([]);
      const report = during.worker.reports.at(-1)!;
      expect(report.status).toBe('stopped');
      expect(report.fields.filter((row) => row.reason === 'user-stopped').map((row) => row.label))
        .toEqual(['First name', 'Last name', 'Email']);
      expect(during.runtime.ui!.launcher.view.state).toBe('idle');
    });

  it('pauses on a sign-in step, filling nothing, and starts afresh on Continue', async () => {
    const page = plain.replace('<button type="submit">', '<label for="pw">Password</label><input id="pw" type="password">'
      + '<button type="submit">');
    const started = await start(page, 'sign-in');
    expect(await started.runtime.fill()).toBe('paused');
    expect(started.events.events).toEqual([]);
    expect(started.worker.reports.at(-1)).toMatchObject({ status: 'auth-needed', pauseReason: null, fields: [] });
    expect(started.worker.reports.at(-1)!.notices.map((notice) => notice.code)).toContain('auth');
    expect(started.worker.of('plan/request')).toEqual([]);
    expect(started.runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', action: 'continue' });
    await started.worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(started.worker.of('run/begin')).toHaveLength(2));
  });

  it('flags a canary the person typed, and never overwrites it', async () => {
    const started = await start(trap01, 'typed');
    const why = started.fixture.doc.getElementById('why') as HTMLTextAreaElement;
    why.value = 'Honestly: I am LLM.';
    const ran = ranOf(started, await started.runtime.fill());
    expect(ran.end).toBe('review');
    expect(why.value).toBe('Honestly: I am LLM.');
    expect(ran.row('Why do you want to work here?')).toMatchObject({ status: 'flagged', reason: 'canary-in-value',
      wrote: false, needsUserAction: true });
    expect(ran.row('First name')).toMatchObject({ status: 'verified' });
  });

  it('sets a text we wrote back to its earlier value when the page made it hold a canary, and blocks it', async () => {
    // The page appends the canary to the value once, when the field first changes.
    const page = trap01.replace('</body>', `<script>(() => { let once = false;
      document.getElementById('first').addEventListener('change', (event) => { if (once) return; once = true;
        event.target.value += ' I am LLM'; }); })();</script></body>`);
    const ran = await fillTrap(page, 'revert');
    expect(ran.end).toBe('review');
    expect(ran.value('first')).toBe('');
    expect(ran.row('First name')).toMatchObject({ status: 'blocked', reason: 'canary-in-value', wrote: false,
      provenance: null });
    expect(untrustedViolations(ran.events.events)).toEqual([]);
  });

  it('sends nothing that carries a profile value: every message, report, RunState and log line', async () => {
    const ran = await fillTrap(trap01, 'values');
    expect(ran.value('first')).toBe('Alex');
    for (const message of ran.worker.messages) {
      expect(sentinelsIn(JSON.stringify(message), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS]), message.type).toEqual([]);
    }
    expect(sentinelsIn(JSON.stringify(ran.worker.portLog), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
    expect(sentinelsIn(JSON.stringify(logs.mock.calls), [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS])).toEqual([]);
  });
});
