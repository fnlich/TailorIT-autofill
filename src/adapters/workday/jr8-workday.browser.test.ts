/*
 * jr8 WORKDAY (the owner's report of 2026-11-13, snapshot13: aristocrat.wd3's "Infrastructure Engineer III", each step
 * as the run left it, fixtures/workday/jr8-aristocrat-{my-information,my-experience,application-questions,
 * voluntary-disclosures}-after.html, and the owner's own correct Application Questions,
 * jr8-aristocrat-application-questions-correct.html), each rule held against Workday's script stood in for by
 * listeners (no MHTML holds React), with the golden synthetic profile behind the fake worker:
 * 1. a prompt ("How Did You Hear About Us?", Field of Study) commits its search's one match on Enter by itself
 *    (WidgetDecl.choosesOnQuery): the answer the page chose ends the search, read back as filled, with no second query,
 *    no "Other" and no click over it;
 * 2. Workday's skeleton (a step whose questions still load, an Add's block still loading) is a busy sign for
 *    WORKDAY_SKELETON_BUSY_MS: the run scans a step, counts a block and goes on only once Workday drew the fields;
 * 3. Next on Auto presses Next only once every required field the step shows is filled, at the validation and again
 *    right before its click; otherwise the run rests for the person.
 * Every value here is made up; the fixtures hold none (the converter's --redact).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import infoAfterHtml from '../../../fixtures/workday/jr8-aristocrat-my-information-after.html?raw';
import expAfterHtml from '../../../fixtures/workday/jr8-aristocrat-my-experience-after.html?raw';
import questionsAfterHtml from '../../../fixtures/workday/jr8-aristocrat-application-questions-after.html?raw';
import questionsCorrectHtml from '../../../fixtures/workday/jr8-aristocrat-application-questions-correct.html?raw';
import disclosuresAfterHtml from '../../../fixtures/workday/jr8-aristocrat-voluntary-disclosures-after.html?raw';
import brookfieldHtml from '../../../fixtures/workday/jr6-brookfield-voluntary-disclosures.html?raw';
import stepsHtml from '../../../fixtures/synthetic/workday/steps.html?raw';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { addBlocks, sectionsOf } from '../../content/repeatables';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import type { RepeatableCounter, RepeatableKind } from '../../core/types/run';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { deadline } from '../../dom/time';
import type { FieldTarget, ScanResult } from '../../dom/types';
import { searchTypeahead } from '../../dom/widgets';
import { awaitList } from '../../dom/widgets/interact';
import type { Adapter } from '../types';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { WORKDAY_SKELETON_BUSY_MS } from './application';
import { workdayAdapter } from './index';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  vi.restoreAllMocks();
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  removeFixtures(document);
});

const AUTO_NEXT = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' as const } };

async function load(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = workdayAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root, scan: () => scan(root, workdayAdapter, { platform: 'workday' }) };
}

/** The field whose control (or widget's element or text box) is `el`. */
function fieldAt(result: ScanResult, el: Element): FieldTarget {
  const field = result.fields.find((each) => {
    const target = result.target(each.key);
    return target?.control === el || target?.widget?.element === el || target?.widget?.input === el;
  });
  if (field === undefined) throw new Error(`no field at #${el.id}`);
  return result.target(field.key)!;
}

/** How many times the run logged `event` (its console.info lines, spied). */
const logged = (event: string) => logs.mock.calls.filter((call) => String(call[0]).endsWith(` ${event}`)).length;

const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// ── 1. Prompts that choose on the query ─────────────────────────────────────────────────────────────────────────────

/** What a prompt stand-in saw: each Enter in its box, with the words typed then, and whether it committed a leaf. */
interface PromptLog { enters: Array<{ typed: string; committed: boolean }> }

/**
 * Workday's prompt stood in for on a capture's prompt (its box `boxId`): its pills taken away first (the answer the run
 * left, REDACTED by the converter, back to none), then: a typed query drawn a microtask after its input event (React);
 * Enter commits the one leaf of `leaves` whose words are the query's (any case) `delayMs` later, as Workday's search
 * answers from its server: the pill drawn (the capture's own pill markup), the box emptied, no list left open; a query
 * no leaf is draws nothing. `delayMs` is the server's time.
 */
function standInPrompt(doc: Document, boxId: string, leaves: readonly string[], delayMs = 120): PromptLog {
  const box = doc.getElementById(boxId) as HTMLInputElement;
  const container = box.closest('[data-automation-id="multiSelectContainer"]')!;
  const list = container.querySelector('[data-automation-id="selectedItemList"]')!;
  const template = list.querySelector('li')!.cloneNode(true) as HTMLElement;
  list.replaceChildren();
  const log: PromptLog = { enters: [] };
  box.addEventListener('input', () => queueMicrotask(() => box.setAttribute('data-typed', String(box.value.length))));
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const typed = box.value;
    const leaf = leaves.find((each) => each.toLowerCase() === typed.trim().toLowerCase()) ?? null;
    log.enters.push({ typed, committed: leaf !== null });
    if (leaf === null) return;
    void deadline(delayMs).then(() => {
      const pill = template.cloneNode(true) as HTMLElement;
      pill.querySelector('[data-automation-id="promptOption"]')!.textContent = leaf;
      pill.querySelector('[data-automation-id="selectedItem"]')!.setAttribute('aria-label', leaf);
      list.replaceChildren(pill);
      box.value = '';
    });
  });
  return log;
}

/** The hooks a search gets in these tests: every query passes its Guard; the worker takes the result named `wanted`. */
function hooksFor(page: Awaited<ReturnType<typeof load>>, box: HTMLInputElement, wanted: string | null) {
  const matched: string[][] = [];
  return {
    matched,
    hooks: {
      guard: async () => ({ ok: true as const, target: fieldAt(page.scan(), box) }),
      match: async (results: ReadonlyArray<{ label: string; disabled: boolean }>) => {
        matched.push(results.map((result) => result.label));
        const index = results.findIndex((result) => result.label === wanted);
        return index < 0 ? { choose: null, reason: 'no-match' as const, blocked: false }
          : { choose: { index, cleanLabel: results[index]!.label } };
      },
    },
  };
}

describe('jr8: a Workday prompt that chooses its search’s match on Enter (snapshot13, choosesOnQuery)', () => {
  it('is declared so on every prompt of the captures, never on a dropdown', async () => {
    for (const html of [infoAfterHtml, expAfterHtml]) {
      const page = await load(html);
      const result = page.scan();
      const prompts = result.fields.filter((field) => field.kind === 'typeahead-remote');
      expect(prompts.length).toBeGreaterThan(0);
      for (const field of prompts) expect(result.target(field.key)!.widget!.choosesOnQuery).toBe(true);
      for (const field of result.fields.filter((each) => each.kind === 'combobox')) {
        expect(result.target(field.key)!.widget!.choosesOnQuery).toBeUndefined();
      }
      removeFixtures(document);
    }
  });

  it.each([
    ['How Did You Hear About Us?', infoAfterHtml, 'source--source', 'LinkedIn'],
    ['Field of Study', expAfterHtml, 'education-7--fieldOfStudy', 'Computer Science'],
  ] as const)('%s: the answer the page chose ends the search, filled, after one query and one Enter', async (_, html, id,
    leaf) => {
    const page = await load(html);
    const log = standInPrompt(page.doc, id, [leaf, 'Other']);
    const box = page.doc.getElementById(id) as HTMLInputElement;
    const { hooks, matched } = hooksFor(page, box, leaf);
    const result = await searchTypeahead(fieldAt(page.scan(), box), [leaf, `${leaf} (2)`, `${leaf} (3)`],
      { adapter: workdayAdapter, root: page.root }, hooks);
    expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 1, blocked: false });
    expect(result.chosen).toMatchObject({ index: 0, cleanLabel: leaf });
    // The one answer the page shows was the one result the worker matched; nothing else was typed or pressed.
    expect(matched).toEqual([[leaf]]);
    expect(log.enters).toEqual([{ typed: leaf, committed: true }]);
    expect(fieldAt(page.scan(), box).field.current).toEqual({ kind: 'selected', labels: [leaf] });
  });

  it('chooses nothing over the page’s choice the worker does not take: no second query, read back as it shows',
    async () => {
      const page = await load(infoAfterHtml);
      const log = standInPrompt(page.doc, 'source--source', ['Indeed']);
      const box = page.doc.getElementById('source--source') as HTMLInputElement;
      const { hooks, matched } = hooksFor(page, box, null);
      const result = await searchTypeahead(fieldAt(page.scan(), box), ['Indeed', 'Other'],
        { adapter: workdayAdapter, root: page.root }, hooks);
      expect(result).toMatchObject({ chosen: null, verified: false, reason: 'verify-mismatch', typed: 1 });
      expect(matched).toEqual([['Indeed']]);
      expect(log.enters).toHaveLength(1);
    });

  it('ends the wait for a results list as soon as the page answered the query another way (awaitList answered)',
    async () => {
      const page = await load(infoAfterHtml);
      const box = page.doc.getElementById('source--source') as HTMLInputElement;
      const widget = fieldAt(page.scan(), box).widget!;
      const ctx = { adapter: workdayAdapter, root: page.root };
      // No list ever shows: answered, the wait ends at its first quiet window; else at its cap.
      expect(await awaitList(widget, ctx, { prevHash: null, capMs: 2_000, answered: () => true }))
        .toMatchObject({ status: 'ready' });
      expect(await awaitList(widget, ctx, { prevHash: null, capMs: 600, answered: () => false }))
        .toMatchObject({ status: 'never-loaded' });
    });

  it('reads a page that answers Enter with nothing as before: no pill, no list, nothing chosen', async () => {
    const page = await load(infoAfterHtml);
    const log = standInPrompt(page.doc, 'source--source', []);
    const box = page.doc.getElementById('source--source') as HTMLInputElement;
    const { hooks, matched } = hooksFor(page, box, 'LinkedIn');
    const result = await searchTypeahead(fieldAt(page.scan(), box), ['LinkedIn', 'Linked In'],
      { adapter: workdayAdapter, root: page.root }, hooks);
    // Nothing drawn after the Enter: the page ignored it (s2 wd's rule), the box given back what it held.
    expect(result).toMatchObject({ chosen: null, reason: 'needs-your-click', typed: 1 });
    expect(log.enters.map((enter) => enter.committed)).toEqual([false]);
    expect(matched).toEqual([]);
    expect(box.value).toBe('');
  });
});

describe('jr8: the run on aristocrat’s My Information (snapshot13, the content runtime)', () => {
  it('fills “How Did You Hear About Us?” once, read back as filled, never typing a second query or “Other”',
    async () => {
      const page = await load(infoAfterHtml);
      const log = standInPrompt(page.doc, 'source--source', ['LinkedIn', 'Other']);
      const typed: string[] = [];
      page.doc.getElementById('source--source')!.addEventListener('input', (event) => {
        typed.push((event.target as HTMLInputElement).value);
      });
      const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
      const runtime = await startContentRuntime(worker.platform, page.doc, {
        href: () => 'https://aristocrat.wd3.myworkdayjobs.com/en-US/External/job/x/Infrastructure-Engineer-III_R0000000/apply/applyManually',
        isTop: true, adapters: () => [workdayAdapter], settle: { quietMs: 60 } });
      runtimes.push(runtime);
      await runtime.fill();
      await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 60_000 });
      expect(log.enters).toEqual([{ typed: 'LinkedIn', committed: true }]);
      expect(typed.filter((text) => text !== '')).toEqual(['LinkedIn']);
      const row = worker.reports.at(-1)!.fields.find((each) => each.label === 'How Did You Hear About Us?')!;
      expect(row).toMatchObject({ status: 'verified', category: 'referral.source', needsUserAction: false });
      expect(words(page.doc.querySelector('#source--source')!.closest('[data-automation-id="multiSelectContainer"]')!
        .querySelector('[data-automation-id="promptOption"]'))).toBe('LinkedIn');
    }, 90_000);
});

// ── 2. The skeleton ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Workday's skeleton, as jr6-brookfield-voluntary-disclosures.html draws one where questions still load: a "Loading"
 *  drawn for screen readers only beside the aria-hidden grey shapes a person sees. */
function skeleton(doc: Document): HTMLElement {
  const holder = doc.createElement('div');
  const label = doc.createElement('div');
  label.textContent = 'Loading';
  label.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)';
  const shapes = doc.createElement('div');
  shapes.setAttribute('aria-hidden', 'true');
  shapes.style.cssText = 'display:block;width:344px;height:120px;background:#eee';
  holder.append(label, shapes);
  return holder;
}

describe('jr8: Workday’s skeleton is a busy sign (snapshot13; jr6-brookfield-voluntary-disclosures.html)', () => {
  it('reads the step a capture shows still loading as busy, and as quiet once its questions are drawn', async () => {
    const page = await load(brookfieldHtml);
    const labels = Array.from(page.doc.querySelectorAll('div')).filter((div) => div.childElementCount === 0
      && words(div) === 'Loading');
    expect(labels).toHaveLength(2);
    expect(page.doc.querySelectorAll('[data-automation-id^="formField-"]')).toHaveLength(0);
    expect(workdayAdapter.isBusy!(page.doc)).toBe(true);
    // Workday draws each section's question in place of its skeleton.
    for (const label of labels) {
      const field = page.doc.createElement('div');
      field.setAttribute('data-automation-id', 'formField-x');
      field.textContent = 'A question';
      label.parentElement!.replaceWith(field);
    }
    expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
  });

  it('is busy only while its shapes are drawn, and for WORKDAY_SKELETON_BUSY_MS at most', async () => {
    const page = await load(brookfieldHtml);
    const shapes = Array.from(page.doc.querySelectorAll<HTMLElement>('div + div[aria-hidden="true"]'))
      .filter((each) => words(each.previousElementSibling) === 'Loading');
    expect(shapes).toHaveLength(2);
    // Shapes not drawn (display none, transparent): no skeleton a person sees.
    for (const each of shapes) each.style.display = 'none';
    expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
    for (const each of shapes) each.style.cssText = 'opacity:0';
    expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
    for (const each of shapes) each.style.cssText = '';
    // Words that are no loading sign beside the shapes: none either.
    shapes[0]!.previousElementSibling!.textContent = 'Loading dock experience';
    shapes[1]!.previousElementSibling!.textContent = 'Loaded';
    expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
    shapes[0]!.previousElementSibling!.textContent = 'Loading';
    // From the first look that found it, then past the bound: no longer busy (the run reads the step as it is).
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000_000);
    expect(workdayAdapter.isBusy!(page.doc)).toBe(true);
    clock.mockReturnValue(1_000_000 + WORKDAY_SKELETON_BUSY_MS - 1);
    expect(workdayAdapter.isBusy!(page.doc)).toBe(true);
    clock.mockReturnValue(1_000_000 + WORKDAY_SKELETON_BUSY_MS);
    expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
  });

  it('is read on no capture of snapshot13 (each taken once the step was drawn)', async () => {
    for (const html of [infoAfterHtml, expAfterHtml, questionsAfterHtml, questionsCorrectHtml, disclosuresAfterHtml]) {
      const page = await load(html);
      expect(workdayAdapter.isBusy!(page.doc)).toBe(false);
      removeFixtures(document);
    }
  });
});

describe('jr8: every block added on aristocrat’s My Experience (snapshot13: only the first was)', () => {
  /** aristocrat's My Experience as the run left it (one Work Experience, one Education) with Workday's Add stood in
   *  for: a click draws the section's next block at once, its fields a skeleton for `loadMs` (Jobright 1.25.2's Add waits
   *  for the block and for the page's loading to clear), then its first field; a click while a block still loads adds
   *  nothing (the page is busy). */
  async function withAdds(loadMs: number) {
    const page = await load(expAfterHtml);
    const doc = page.doc;
    const added = { clicks: 0, ignored: 0 };
    doc.addEventListener('click', (event) => {
      const add = (event.target as Element).closest('button[data-automation-id="add-button"]');
      const section = add?.closest('[role="group"][aria-labelledby$="-section"]') ?? null;
      if (add === null || section === null) return;
      if (section.querySelector('[data-test-loading]') !== null) {
        added.ignored += 1;
        return;
      }
      added.clicks += 1;
      const prefix = section.getAttribute('aria-labelledby')!.replace(/-section$/, '');
      const blocks = section.querySelectorAll(`[role="group"][aria-labelledby^="${prefix}-"][aria-labelledby$="-panel"]`);
      const n = blocks.length + 1;
      const block = (blocks[blocks.length - 1]!).cloneNode(false) as HTMLElement;
      block.setAttribute('aria-labelledby', `${prefix}-${n}-panel`);
      const heading = doc.createElement('h5');
      heading.id = `${prefix}-${n}-panel`;
      heading.textContent = `${prefix.replace(/-/g, ' ')} ${n}`;
      const loading = skeleton(doc);
      loading.setAttribute('data-test-loading', '');
      block.append(doc.createElement('div'), loading);
      block.firstElementChild!.append(heading);
      blocks[blocks.length - 1]!.after(block);
      void deadline(loadMs).then(() => {
        const field = doc.createElement('div');
        field.setAttribute('data-automation-id', 'formField-jobTitle');
        field.textContent = 'Job Title';
        loading.replaceWith(field);
      });
    });
    return { page, added };
  }

  function env(page: Awaited<ReturnType<typeof load>>, profile: number) {
    const counters = new Map<RepeatableKind, RepeatableCounter>();
    return { adapter: workdayAdapter, root: page.root, signal: new AbortController().signal,
      settle: { quietMs: 60, capMs: 8_000 }, profile: new Map([['experience', profile], ['education', profile]] as const),
      prior: (kind: RepeatableKind) => counters.get(kind) ?? null,
      record: async (kind: RepeatableKind, counter: RepeatableCounter) => {
        counters.set(kind, counter);
      }, stopped: () => false };
  }

  it('adds each section’s blocks one at a time, each once Workday drew it, up to the profile’s entries', async () => {
    const { page, added } = await withAdds(500);
    const sections = sectionsOf(workdayAdapter, page.root);
    expect(sections.map((section) => [section.kind, section.blocks().length])).toEqual([['experience', 1],
      ['education', 1]]);
    const outcomes = await addBlocks(env(page, 3), sections);
    expect(outcomes.map((outcome) => [outcome.kind, outcome.clicks, outcome.stop, outcome.missing])).toEqual([
      ['experience', 2, 'complete', 0], ['education', 2, 'complete', 0]]);
    expect(sections.map((section) => section.blocks().length)).toEqual([3, 3]);
    expect(added).toEqual({ clicks: 4, ignored: 0 });
    // Each block holds its fields now: no skeleton left.
    expect(page.doc.querySelectorAll('[data-test-loading]')).toHaveLength(0);
  });
});

// ── 3. Next on Auto ─────────────────────────────────────────────────────────────────────────────────────────────────

const STEPS_HREF = 'https://tailoritfixture.wd5.myworkdayjobs.com/en-US/careers/job/x/Fixture-Steps_JR-0000002/apply/applyManually';

/** What the synthetic steps page recorded (its header). */
interface StepsRecord { step: number; next: Array<{ step: number; trusted: boolean }>; submit: unknown[];
  values: Record<number, Record<string, unknown>> }

/** The synthetic Workday steps page (fixtures/synthetic/workday/steps.html) with Workday's date script stood in for
 *  (a part's digits drawn a microtask after its input event) and, with `loadMs`, each step after the first drawn as a
 *  skeleton for that long before its questions (jr6-brookfield's capture): what the owner's run met on aristocrat. */
async function stepsPage(loadMs: number | null, adapter: Adapter = workdayAdapter) {
  const fixture = await loadFixture(document, stepsHtml, { width: 1100, height: 1000 });
  const doc = fixture.doc;
  doc.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('input[role="spinbutton"]') || !/^\d+$/.test(input.value)) return;
    queueMicrotask(() => {
      input.parentElement!.querySelector('[data-automation-id$="-display"]')!.textContent = input.value;
      input.setAttribute('aria-valuenow', String(Number(input.value)));
    });
  });
  const step = doc.getElementById('step')!;
  let drawn = 1;
  const record = () => (fixture.view as unknown as { __wd: StepsRecord }).__wd;
  if (loadMs !== null) {
    new fixture.view.MutationObserver(() => {
      if (record().step === drawn) return;
      drawn = record().step;
      const page = step.firstElementChild;
      if (page === null || page.hasAttribute('data-test-skeleton')) return;
      // Workday's step page drawn at once, its questions a skeleton until they load.
      const questions = Array.from(page.childNodes);
      page.setAttribute('data-test-skeleton', '');
      page.replaceChildren(skeleton(doc));
      void deadline(loadMs).then(() => {
        page.replaceChildren(...questions);
        page.removeAttribute('data-test-skeleton');
      });
    }).observe(step, { childList: true });
  }
  const worker = createFakeWorker({ settings: AUTO_NEXT });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => STEPS_HREF, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, doc, worker, runtime, record };
}

describe('jr8: Next on Auto after Workday drew and the run filled the step (snapshot13 steps 3 and 4)', () => {
  it('fills the step Workday draws as a skeleton first, and presses its Next only once its questions are filled',
    async () => {
      const { runtime, record } = await stepsPage(1_200);
      await runtime.fill();
      await vi.waitFor(() => expect(record().step).toBe(3), { timeout: 60_000 });
      // My Information, then My Experience: each Next pressed by the run once, after the step's questions were filled.
      expect(record().next.map((each) => each.step)).toEqual([1, 2]);
      const experience = record().values[2]!;
      const titles = Object.entries(experience).filter(([id]) => /--jobTitle$/.test(id)).map(([, value]) => value);
      // The golden profile's two jobs, both blocks written (the second added once the step was drawn).
      expect(titles).toHaveLength(2);
      expect(titles.every((title) => typeof title === 'string' && title !== '')).toBe(true);
    }, 90_000);
});

describe('jr8: the owner’s rule: never Next past a required field the step shows empty', () => {
  /** A required question Workday draws on My Information once its boxes hold the run's answers, as the run reads the
   *  step (`when`: at its validation, the adapter's finality read; or right before its click, the second read of Next):
   *  a required text box with Workday's star and no row of the fill. */
  function lateQuestion(doc: Document) {
    const make = (tag: string, attributes: Record<string, string>, ...children: Array<Node | string>) => {
      const el = doc.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      el.append(...children);
      return el;
    };
    const star = make('abbr', { 'aria-hidden': 'true' }, '*');
    const field = make('div', { 'data-automation-id': 'formField-late', 'data-fkit-id': 'late--late' },
      make('label', { for: 'late--late' }, make('span', {}, 'Employee ID', star)),
      make('div', {}, make('input', { type: 'text', id: 'late--late', name: 'late', 'aria-required': 'true', value: '' })));
    doc.querySelector('[data-automation-id="applyFlowMyInfoPage"]')!.append(field);
  }
  const filled = (doc: Document) => (doc.getElementById('name--legalName--lastName') as HTMLInputElement | null)
    ?.value !== '';

  it('rests for the person when the validation finds a required field empty that the fill has no row for', async () => {
    let drawn = false;
    let doc: Document | null = null;
    const adapter: Adapter = { ...workdayAdapter, isFinalStep: (at, facts) => {
      if (!drawn && doc !== null && filled(doc)) {
        drawn = true;
        lateQuestion(doc);
      }
      return workdayAdapter.isFinalStep!(at, facts);
    } };
    const page = await stepsPage(null, adapter);
    doc = page.doc;
    await page.runtime.fill();
    await vi.waitFor(() => expect(page.runtime.run?.ended).toBeDefined(), { timeout: 60_000 });
    await deadline(500);
    expect(drawn).toBe(true);
    expect(page.record().next).toEqual([]);
    expect(page.record().step).toBe(1);
    // Held at the validation itself: the run never went on to press Next (the re-check before a click never ran).
    expect(page.runtime.run?.ended).toBe('waiting');
    expect(logged('content.next-withheld')).toBe(0);
  }, 90_000);

  it('holds Next right before its click when a required field shows empty since the validation', async () => {
    let phase: 'filling' | 'validating' | 'validated' = 'filling';
    let doc: Document | null = null;
    const adapter: Adapter = { ...workdayAdapter,
      // The validation reads the step's finality and its Next in one go; the press reads Next again after its waits:
      // the question is drawn at that later read, after the validation found nothing empty.
      isFinalStep: (at, facts) => {
        if (doc !== null && filled(doc) && phase === 'filling') {
          phase = 'validating';
          queueMicrotask(() => {
            phase = 'validated';
          });
        }
        return workdayAdapter.isFinalStep!(at, facts);
      },
      nextButton: (root, facts) => {
        if (doc !== null && phase === 'validated' && doc.getElementById('late--late') === null) lateQuestion(doc);
        return workdayAdapter.nextButton!(root, facts);
      } };
    const page = await stepsPage(null, adapter);
    doc = page.doc;
    await page.runtime.fill();
    await vi.waitFor(() => expect(page.runtime.run?.ended).toBeDefined(), { timeout: 60_000 });
    await deadline(500);
    expect(doc.getElementById('late--late')).not.toBeNull();
    expect(page.record().next).toEqual([]);
    expect(logged('content.next-withheld')).toBe(1);
  }, 90_000);

  it('tells the panel how many required fields are left at rest, and refuses its Continue until they are filled',
    async () => {
      // Next on Manual: the run fills and rests for the person. A required question the profile cannot answer shows.
      const fixture = await loadFixture(document, stepsHtml, { width: 1100, height: 1000 });
      lateQuestion(fixture.doc);
      const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => STEPS_HREF, isTop: true,
        adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      await runtime.fill();
      await vi.waitFor(() => expect(worker.reports.at(-1)?.buttons).toMatchObject({ final: 'not-final',
        requiredLeft: 1 }), { timeout: 30_000 });
      const record = () => (fixture.view as unknown as { __wd: StepsRecord }).__wd;
      expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'next', confirmed: false }))
        .toEqual({ ok: true, data: { outcome: 'required-empty', count: 1 } });
      expect(record().next).toEqual([]);
      // The person fills it: the next report counts none left, and Continue presses the page's Next (never Submit).
      const late = fixture.doc.getElementById('late--late') as HTMLInputElement;
      late.scrollIntoView({ block: 'center' });
      const box = late.getBoundingClientRect();
      await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
      await userEvent.keyboard('42');
      await vi.waitFor(async () => {
        expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'next', confirmed: false }))
          .toEqual({ ok: true, data: { outcome: 'pressed' } });
      }, { timeout: 10_000 });
      expect(record().next).toEqual([{ step: 1, trusted: false }]);
      expect(record().submit).toEqual([]);
    }, 90_000);

  it('presses Next where every required field the step shows is filled (the rule holds nothing more)', async () => {
    const page = await stepsPage(null);
    await page.runtime.fill();
    await vi.waitFor(() => expect(page.record().next.length).toBeGreaterThan(0), { timeout: 60_000 });
    expect(page.record().next[0]).toEqual({ step: 1, trusted: false });
  }, 90_000);
});
