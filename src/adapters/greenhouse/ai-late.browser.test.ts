/*
 * TailorIT's AI answers on Greenhouse's react-selects and drafts as the real worker brings them (s2 core-gh, decision 14:
 * the owner's live runs of 2026-11-07, where every react-select only the AI answers, and some drafts, ended empty,
 * max-passes-reached). The real worker runs ONE AI task at a time per run (background/ai-tasks.ts createRunAi: classify,
 * pick, draft and answer batches chained, each a TailorIT task of tens of seconds), so a run's answers come back one
 * batch after another, never all at the next poll as the testkit's fake worker brings them. This file puts that chain
 * in front of the fake worker (fakeWorker): the keys a plan asks go into batches as the worker makes them (by kind, in
 * its order, at most DRAFT_MAX_QUESTIONS drafts and ANSWER_MAX_ITEMS answers a batch, the plan's own `ask` read through
 * FakeWorkerOptions.editPlan), and only the batch at the head of the chain is answered, `polls` polls after it got
 * there (the task's time, counted in the loop's own polls: no sleep). A key the answer plans again and asks anew (a
 * classification in, then its draft or answer asked) joins the chain's tail, as withAnswers' ask does.
 * The page: Greenhouse's react-select v5 inside Greenhouse's wrapper (as fixtures/synthetic/greenhouse-widgets draws
 * it: classNamePrefix "select", the wrapper's mouseup toggling menuIsOpen), with questions no rule fills from the
 * profile: react-selects only the AI answers, one the rules read as years of a skill, free-text questions and short
 * texts, beside the names and the email.
 * The two fixes: the loop goes on past MAX_PASSES while answers are still coming (core/loop/bookkeeping.ts
 * MAX_AI_PASSES), and a lazy list is read before it is classified, so it is classified once (core/plan/frame.ts).
 */
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { createElement as h, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import Select, { components, type ControlProps, type GroupBase, type SingleValue } from 'react-select';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import { ANSWER_MAX_ITEMS, DRAFT_MAX_QUESTIONS } from '../../core/confidence';
import { MAX_PASSES } from '../../core/loop/bookkeeping';
import type { PlanOutput } from '../../core/plan/types';
import type { FillResult } from '../../core/types/fill';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { installBridge } from '../../page/bridge';
import { createFakeWorker, testVocab, type FakeWorker } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';

const URL_9100 = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9100';

const CICD = 'How would you rate your experience with CI/CD?';
const PAIRING = 'Are you comfortable pairing remotely with teammates across time zones?';
const TYPESCRIPT = 'How many years of experience do you have with TypeScript?';
const EXCITES = 'What interests and excites you about joining TailorIT Fixture?';
const NOTICE = 'What is your notice period?';
const OPEN_SOURCE = 'Have you contributed to open-source projects?';
const HPC = 'Describe your experience with HPC.';
const SALARY = 'What are your salary expectations?';
const WHY = 'Why do you want to work at TailorIT Fixture?';
const PROUD = 'Tell us about a project you are proud of.';
/** The questions only TailorIT's AI answers, by the page that shows them. */
const SMALL = [CICD, PAIRING, TYPESCRIPT, EXCITES, NOTICE];
const LARGE = [...SMALL, OPEN_SOURCE, HPC, SALARY, WHY];
/** One free-text question more: four drafts are two of the worker's draft batches (DRAFT_MAX_QUESTIONS). */
const LARGER = [...LARGE, PROUD];

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

// ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Choice {
  value: string;
  label: string;
}

/** React's value of each question, by id. */
type Values = Record<string, unknown>;

const required = (on: boolean) => (on ? h('span', { 'aria-hidden': 'true' }, '*') : null);

/** A Greenhouse select: react-select inside the wrapper that holds menuIsOpen, toggled by the wrapper's mouseup. */
function GhSelect({ id, label, options, values }: { id: string; label: string; options: Choice[]; values: Values }):
  ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<SingleValue<Choice>>(null);
  const [input, setInput] = useState('');
  const toggle = useRef<(next?: boolean) => void>(() => undefined);
  toggle.current = (next) => setOpen((was) => next ?? !was);
  const parts = useMemo(() => ({
    Control: (props: ControlProps<Choice, false>) => h('div', {
      onMouseUp: () => toggle.current(),
      onKeyUp: (event: KeyboardEvent) => {
        if (event.code === 'Escape' || event.code === 'Tab') toggle.current(false);
        else if (event.code !== 'Enter') toggle.current(true);
      },
    }, h(components.Control<Choice, false, GroupBase<Choice>>, props)),
    IndicatorSeparator: null,
  }), []);
  return h('div', { className: 'field-wrapper' }, h('div', { className: 'select' }, h('div', { className: 'select__container' },
    h('label', { id: `${id}-label`, htmlFor: id, className: 'label select__label' }, label, required(true)),
    h(Select<Choice, false>, {
      instanceId: id, inputId: id, required: true, 'aria-labelledby': `${id}-label`, className: 'select-shell',
      classNamePrefix: 'select', isClearable: true, options, placeholder: 'Select...', components: parts,
      menuIsOpen: open, value, inputValue: input,
      onInputChange: (next: string) => setInput(next),
      onChange: (next: SingleValue<Choice>) => {
        setValue(next);
        toggle.current(false);
        values[id] = next?.value ?? null;
      },
      onBlur: () => toggle.current(false), onMenuOpen: () => undefined, onMenuClose: () => undefined,
      maxMenuHeight: 300, menuPlacement: 'bottom', menuPosition: 'absolute', closeMenuOnSelect: true,
      blurInputOnSelect: false, openMenuOnClick: true, openMenuOnFocus: false, isSearchable: true,
    }))));
}

/** A text box or a textarea, drawn as Greenhouse draws one. */
function GhText({ id, label, multiline = false, values }: { id: string; label: string; multiline?: boolean;
  values: Values }): ReactElement {
  const [text, setText] = useState('');
  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setText(event.target.value);
    values[id] = event.target.value;
  };
  return h('div', { className: 'field-wrapper' }, h('div', { className: 'text-input-wrapper' },
    h('div', { className: 'input-wrapper' },
      h('label', { id: `${id}-label`, htmlFor: id, className: 'label' }, label, required(true)),
      multiline ? h('textarea', { id, className: 'input input__multi-line', 'aria-required': true, value: text, onChange })
        : h('input', { id, className: 'input input__single-line', 'aria-required': true, type: 'text', maxLength: 255,
          value: text, onChange }))));
}

const YES_NO: Choice[] = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
const LEVELS: Choice[] = ['Beginner', 'Intermediate', 'Advanced', 'Expert'].map((label) => ({ value: label, label }));
const BUCKETS: Choice[] = ['0-1 years', '2-4 years', '5-7 years', '8+ years'].map((label) => ({ value: label, label }));

function Form({ values, more, most }: { values: Values; more: boolean; most: boolean }): ReactElement {
  return h('div', { className: 'application--questions' },
    h(GhText, { id: 'first_name', label: 'First Name', values }),
    h(GhText, { id: 'last_name', label: 'Last Name', values }),
    h(GhText, { id: 'email', label: 'Email', values }),
    h(GhSelect, { id: 'question_1', label: CICD, options: LEVELS, values }),
    h(GhSelect, { id: 'question_2', label: PAIRING, options: YES_NO, values }),
    h(GhSelect, { id: 'question_3', label: TYPESCRIPT, options: BUCKETS, values }),
    h(GhText, { id: 'question_4', label: EXCITES, multiline: true, values }),
    h(GhText, { id: 'question_5', label: NOTICE, values }),
    ...(more ? [h(GhSelect, { key: 'q6', id: 'question_6', label: OPEN_SOURCE, options: YES_NO, values }),
      h(GhText, { key: 'q7', id: 'question_7', label: HPC, multiline: true, values }),
      h(GhText, { key: 'q8', id: 'question_8', label: SALARY, values }),
      h(GhText, { key: 'q9', id: 'question_9', label: WHY, multiline: true, values })] : []),
    ...(most ? [h(GhText, { key: 'q10', id: 'question_10', label: PROUD, multiline: true, values })] : []));
}

async function greenhousePage(more: boolean, most: boolean): Promise<{ fixture: Fixture; values: Values }> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
  const values: Values = {};
  const root = createRoot(fixture.doc.getElementById('gh-root')!);
  const cache = createCache({ key: 'remix-css', container: fixture.doc.head });
  root.render(h(CacheProvider, { value: cache }, h(Form, { values, more, most })));
  removals.push(() => root.unmount());
  removals.push(installBridge(fixture.doc));
  // React draws on its own schedule: wait for the last question to be in the page.
  await vi.waitFor(() => expect(fixture.doc.getElementById('question_5')).not.toBeNull());
  return { fixture, values };
}

// ── The worker's one task at a time ─────────────────────────────────────────────────────────────────────────────

type Kind = 'classify' | 'pick' | 'draft' | 'answer';
const KIND_ORDER: readonly Kind[] = ['classify', 'pick', 'draft', 'answer'];
const BATCH_MAX: Record<Kind, number> = { classify: 20, pick: 20, draft: DRAFT_MAX_QUESTIONS, answer: ANSWER_MAX_ITEMS };
/** Every batch one key: the most tasks a run can need (a page whose questions come in one at a time). */
const SINGLES: Record<Kind, number> = { classify: 1, pick: 1, draft: 1, answer: 1 };

interface PollAnswer {
  ok: boolean;
  error?: string;
  data?: { writes: unknown[]; results: Array<{ key: string }>; awaiting: string[]; persistableCanaries: string[] };
}

interface Chain {
  /** The worker's batches, in the order it runs them: each its kind and the keys it answers. */
  readonly queue: Array<{ kind: Kind; keys: string[] }>;
  /** Every batch answered, in order. */
  readonly answered: Array<{ kind: Kind; keys: string[] }>;
  /** What each plan asked each key as, latest first (editPlan's spy). */
  readonly kindOf: Map<string, Kind>;
  /** How many times each key was asked for a classification. */
  readonly classified: Map<string, number>;
}

/**
 * A fake worker whose AI answers come one batch at a time, `polls` polls after the batch got to the chain's head
 * (module header). With `polls` 0 and `serial` false it is the testkit's fake worker as it is: every answer at the
 * next poll.
 */
function fakeWorker(polls: number, serial = true, sizes: Record<Kind, number> = BATCH_MAX):
  { worker: FakeWorker; chain: Chain } {
  const kindOf = new Map<string, Kind>();
  const classified = new Map<string, number>();
  const chain: Chain = { queue: [], answered: [], kindOf, classified };
  const worker = createFakeWorker({
    settings: DEFAULT_SETTINGS,
    ai: {
      // TailorIT's classification: the free-text question is one, the rest name nothing it knows.
      classify: (item) => (item.label.startsWith('What interests') ? { key: item.key, category: 'free_text_question', why: 'ok' }
        : { key: item.key, category: null, why: 'unknown-field' }),
    },
    editPlan(plan: PlanOutput) {
      for (const item of plan.ask?.classify ?? []) {
        kindOf.set(item.key, 'classify');
        classified.set(item.key, (classified.get(item.key) ?? 0) + 1);
      }
      for (const item of plan.ask?.tiebreaks ?? []) kindOf.set(item.id.split('#')[0]!, 'pick');
      for (const item of plan.ask?.drafts ?? []) kindOf.set(item.key, 'draft');
      for (const item of plan.ask?.answers ?? []) kindOf.set(item.key, 'answer');
      return plan;
    },
  });
  if (!serial) return { worker, chain };
  const queued = (key: string) => chain.queue.some((batch) => batch.keys.includes(key));
  /** The keys a plan asked, batched as the worker's ask() batches them, at the chain's tail. */
  const enqueue = (keys: readonly string[]) => {
    const fresh = keys.filter((key) => !queued(key));
    for (const kind of KIND_ORDER) {
      const ofKind = fresh.filter((key) => (kindOf.get(key) ?? 'answer') === kind);
      for (let at = 0; at < ofKind.length; at += sizes[kind]) {
        chain.queue.push({ kind, keys: ofKind.slice(at, at + sizes[kind]) });
      }
    }
  };
  let headPolls = 0;
  const runtime = worker.platform.runtime;
  const send = runtime.send.bind(runtime);
  const intercept = async (raw: unknown): Promise<unknown> => {
    const message = raw as { type: string; keys?: string[] } & Record<string, unknown>;
    if (message.type === 'plan/request') {
      const answer = await send(message) as PollAnswer;
      if (answer.ok) enqueue(answer.data!.awaiting);
      return answer;
    }
    if (message.type !== 'plan/poll') return send(message);
    const keys = message.keys ?? [];
    // A batch none of whose keys the frame still polls has nobody to answer: the worker's task ends unread.
    while (chain.queue.length > 0 && !chain.queue[0]!.keys.some((key) => keys.includes(key))) {
      chain.answered.push(chain.queue.shift()!);
      headPolls = 0;
    }
    headPolls += 1;
    const head = chain.queue[0];
    if (head === undefined || headPolls <= polls) {
      return { ok: true, data: { writes: [], results: [], awaiting: [...keys], persistableCanaries: [] } };
    }
    // The head's task ends: its keys are planned again with their answers; the rest still wait.
    chain.answered.push(chain.queue.shift()!);
    headPolls = 0;
    const release = keys.filter((key) => head.keys.includes(key));
    const answer = await send({ ...message, keys: release }) as PollAnswer;
    if (!answer.ok) return answer;
    // A key planned again and asked anew (its classification in, its answer or draft asked) is a new batch.
    enqueue(answer.data!.awaiting.filter((key) => release.includes(key)));
    answer.data!.awaiting.push(...keys.filter((key) => !release.includes(key)));
    return answer;
  };
  Object.defineProperty(runtime, 'send', { value: intercept, configurable: true, writable: true });
  return { worker, chain };
}

async function fill(polls: number, { serial = true, more = false, most = false, singles = false } = {}) {
  const { fixture, values } = await greenhousePage(more || most, most);
  const { worker, chain } = fakeWorker(polls, serial, singles ? SINGLES : BATCH_MAX);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => URL_9100, isTop: true,
    settle: { quietMs: 100 }, ai: { pollMs: 10, capMs: 20_000 } });
  runtimes.push(runtime);
  const end = await runtime.fill({});
  const report = worker.reports.at(-1)!;
  const row = (label: string) => report.fields.find((candidate) => candidate.label === label) as FillResult;
  const brief = (label: string) => {
    const found = row(label);
    return found === undefined ? null : { status: found.status, reason: found.reason, wrote: found.wrote,
      provenance: found.provenance };
  };
  return { end, report, row, brief, values, worker, chain, fixture };
}

/** What a run left, for the diagnosis: its passes, the chain's batches and each AI question's row. */
function diagnosis(ran: Awaited<ReturnType<typeof fill>>, labels: readonly string[]) {
  return { end: ran.end, passes: ran.report.counters.passes, maxPasses: MAX_PASSES,
    answered: ran.chain.answered.map((batch) => `${batch.kind}x${batch.keys.length}`),
    stillQueued: ran.chain.queue.map((batch) => `${batch.kind}x${batch.keys.length}`),
    classifyKeys: [...ran.chain.classified.keys()].map((key) => key.split('|').slice(2).join('|')),
    rows: Object.fromEntries(labels.map((label) => [label, ran.brief(label)])) };
}

/** The AI-only react-selects: read first (no rule names them), classified, then answered. */
const AI_ONLY_IDS = ['question_1', 'question_2', 'question_6'];

describe("TailorIT's AI answers on Greenhouse, one task at a time", () => {
  it("fills every AI question when every answer comes at the next poll (the testkit's fake worker)", async () => {
    const ran = await fill(0, { serial: false, most: true });
    expect(ran.end).toBe('review');
    expect(ran.report.counters.passes).toBeLessThan(MAX_PASSES);
    for (const label of LARGER) expect(ran.row(label), label).toMatchObject({ wrote: true, status: 'verified' });
    for (const id of AI_ONLY_IDS) expect(ran.values[id], id).not.toBeUndefined();
  });

  it('fills every AI question when the worker answers one task at a time, the AI-only react-selects included',
    async () => {
      const ran = await fill(3, { most: true });
      expect(ran.end, JSON.stringify(diagnosis(ran, LARGER))).toBe('review');
      expect(ran.chain.queue).toEqual([]);
      for (const label of LARGER) expect(ran.row(label), label).toMatchObject({ wrote: true, status: 'verified' });
      for (const id of AI_ONLY_IDS) expect(ran.values[id], id).not.toBeUndefined();
    });

  it('goes on past MAX_PASSES while answers are still coming in, one question a task', async () => {
    const ran = await fill(1, { most: true, singles: true });
    expect(ran.end, JSON.stringify(diagnosis(ran, LARGER))).toBe('review');
    // More tasks than the pass budget holds: the loop waits for them all (MAX_AI_PASSES), never max-passes-reached.
    expect(ran.report.counters.passes).toBeGreaterThan(MAX_PASSES);
    expect(ran.chain.queue).toEqual([]);
    for (const label of LARGER) expect(ran.row(label), label).toMatchObject({ wrote: true, status: 'verified' });
    for (const id of AI_ONLY_IDS) expect(ran.values[id], id).not.toBeUndefined();
  });

  it('reads each AI-only react-select before it asks for its classification, and asks once', async () => {
    const ran = await fill(0, { serial: false });
    const asked = [...ran.chain.classified.keys()].map((key) => key.split('|'));
    for (const slug of ['how-would-you-rate-your-experience-with-ci-cd', 'are-you-comfortable-pairing-remotely-with-teamma~97ca5f']) {
      const hashes = asked.filter((parts) => parts[2] === slug).map((parts) => parts[3]);
      expect(hashes, slug).toHaveLength(1);
      expect(hashes[0], slug).not.toBe('lazy');
    }
  });
});
