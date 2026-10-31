/*
 * The synthetic fixtures' states as the scanner reads them (docs/FIXTURES.md "States"): Phase 3's pages, and Phase 4's
 * widgets, remote-typeahead and ai-steps. Each page loads into a srcdoc frame at the snapshot size, its variant (if the state
 * names one) put on <html> as data-variant before it loads. Each state is reached from a fresh load: its steps act on the page as a filler would, with untrusted events
 * (a select's value set, then input and change dispatched, bubbling; a radio's click()), so the page's own script
 * reacts; a state with an `until` selector waits for the page to match it (a MutationObserver, capped, never a fixed
 * delay). The registry's adapters for the fixture's address then find the form root, as the content runtime does (the
 * generic adapter, since these pages are no Lever markup), the scan runs with that adapter, and the result is held
 * against the state's hand-written fields with the adapters' compareWithExpectation, exactly as the snapshots are.
 * The page as it loads is held against the top-level fields the same way.
 *
 * The async-options page also shows what loading rows mean to a field's key: a list that shows "Loading..." keeps the
 * key it had with its placeholder alone, and the key changes once, when the states arrive.
 */
import { afterEach, describe, expect, it } from 'vitest';
import aiExpect from '../../fixtures/synthetic/ai-steps/index.expect.json';
import aiHtml from '../../fixtures/synthetic/ai-steps/index.html?raw';
import asyncExpect from '../../fixtures/synthetic/async-options/index.expect.json';
import asyncHtml from '../../fixtures/synthetic/async-options/index.html?raw';
import conditionalExpect from '../../fixtures/synthetic/conditional-reveal/index.expect.json';
import conditionalHtml from '../../fixtures/synthetic/conditional-reveal/index.html?raw';
import typeaheadExpect from '../../fixtures/synthetic/remote-typeahead/index.expect.json';
import typeaheadHtml from '../../fixtures/synthetic/remote-typeahead/index.html?raw';
import widgetsExpect from '../../fixtures/synthetic/widgets/index.expect.json';
import widgetsHtml from '../../fixtures/synthetic/widgets/index.html?raw';
import { adaptersFor } from '../adapters';
import { compareWithExpectation, type Expectation, readExpectation, SNAPSHOT_VIEWPORT }
  from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { platformOfUrl } from '../shared/hosts';
import { loadFixture, removeFixtures, type Fixture } from './fixture.testkit';
import { scan } from './scan';
import { startDeadline } from './time';
import type { ScanResult } from './types';

/** How long a state's `until` may take: the slowest variant answers after 1200 ms. */
const UNTIL_CAP_MS = 5_000;

/** One step of a state (docs/FIXTURES.md). */
type Step = { choose: string; value: string } | { click: string };

/** One state of a synthetic page. */
interface State {
  name: string;
  variant: string | null;
  steps: Step[];
  until: string | null;
  /** The state's fields, in the shape the expectations testkit reads. */
  expectation: Expectation;
}

/** A synthetic page's expectations: as it loads, and its states. */
interface Synthetic {
  html: string;
  loads: Expectation;
  states: State[];
}

/** A step, its shape checked (a JSON import types every step as a loose object). */
function readStep(json: unknown, where: string): Step {
  const step = json as Partial<Record<'choose' | 'value' | 'click', unknown>> | null;
  if (step !== null && typeof step.choose === 'string' && typeof step.value === 'string' && step.click === undefined) {
    return { choose: step.choose, value: step.value };
  }
  if (step !== null && typeof step.click === 'string' && step.choose === undefined && step.value === undefined) {
    return { click: step.click };
  }
  throw new Error(`${where}: a malformed step ${JSON.stringify(json)}`);
}

/** A synthetic page's index.expect.json, read: its top-level fields, and each state's fields as an expectation of its
 *  own (readExpectation checks each entry). */
function readSynthetic(html: string, json: unknown): Synthetic {
  const loads = readExpectation(json);
  const raw = (json as { states?: unknown }).states;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${loads.fixture}: no states`);
  const states = raw.map((entry: unknown): State => {
    const state = entry as Partial<Record<'name' | 'variant' | 'steps' | 'until' | 'fields', unknown>>;
    const name = typeof state.name === 'string' ? state.name : '';
    const where = `${loads.fixture} › ${name}`;
    if (name === '' || !(state.variant === null || typeof state.variant === 'string')
      || !(state.until === null || typeof state.until === 'string') || !Array.isArray(state.steps)) {
      throw new Error(`${where}: a malformed state`);
    }
    return {
      name, variant: state.variant, until: state.until,
      steps: state.steps.map((step: unknown) => readStep(step, where)),
      expectation: readExpectation({ fixture: where, source: loads.source, captured: loads.captured,
        fields: state.fields }),
    };
  });
  return { html, loads, states };
}

const PAGES = {
  'conditional-reveal': readSynthetic(conditionalHtml, conditionalExpect),
  'async-options': readSynthetic(asyncHtml, asyncExpect),
  widgets: readSynthetic(widgetsHtml, widgetsExpect),
  'remote-typeahead': readSynthetic(typeaheadHtml, typeaheadExpect),
  'ai-steps': readSynthetic(aiHtml, aiExpect),
} as const;

/** The page with `variant` put on its <html> as data-variant, before it loads; the page as it is for none. */
function withVariant(html: string, variant: string | null): string {
  if (variant === null) return html;
  const page = new DOMParser().parseFromString(html, 'text/html');
  page.documentElement.setAttribute('data-variant', variant);
  return `<!doctype html>\n${page.documentElement.outerHTML}`;
}

/** Applies one step as a filler would: untrusted events only, and the page's own script reacts to them. */
function apply(fixture: Fixture, step: Step): void {
  const selector = 'choose' in step ? step.choose : step.click;
  const el = fixture.doc.querySelector(selector);
  if (el === null) throw new Error(`no element for ${selector}`);
  if ('click' in step) {
    (el as HTMLElement).click();
    return;
  }
  const select = el as HTMLSelectElement;
  select.value = step.value;
  if (select.value !== step.value) throw new Error(`${selector} has no option ${step.value}`);
  select.dispatchEvent(new fixture.view.Event('input', { bubbles: true }));
  select.dispatchEvent(new fixture.view.Event('change', { bubbles: true }));
}

/** Resolves once the page matches `selector`; rejects at the cap. Ends on the DOM condition, never a fixed delay. */
function until(doc: Document, selector: string): Promise<void> {
  if (doc.querySelector(selector) !== null) return Promise.resolve();
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (view === null) return Promise.reject(new Error('no window'));
  return new Promise((resolve, reject) => {
    const observer = new view.MutationObserver(() => {
      if (doc.querySelector(selector) === null) return;
      done();
      resolve();
    });
    const cancel = startDeadline(UNTIL_CAP_MS, () => {
      observer.disconnect();
      reject(new Error(`the page never matched ${selector}`));
    });
    function done(): void {
      observer.disconnect();
      cancel();
    }
    observer.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

/** A page loaded (with a variant, if any), as the content runtime would scan it. */
interface Scanned extends Fixture {
  adapter: Adapter;
  result: ScanResult;
}

/** Loads a page, applies a state's steps and waits for its `until`, then scans it with the first of the registry's
 *  adapters for its address whose detect() finds a form root. */
async function reach(page: Synthetic, state: Pick<State, 'variant' | 'steps' | 'until'>): Promise<Scanned> {
  const fixture = await loadFixture(document, withVariant(page.html, state.variant), SNAPSHOT_VIEWPORT);
  for (const step of state.steps) apply(fixture, step);
  if (state.until !== null) await until(fixture.doc, state.until);
  return { ...fixture, ...scanned(fixture, page.loads.source) };
}

/** Scans a loaded page now, as reach() does. */
function scanned(fixture: Fixture, source: string): { adapter: Adapter; result: ScanResult } {
  const url = new URL(source);
  const platform = platformOfUrl(url.href);
  if (platform === null) throw new Error(`${source} is not on an ATS host`);
  for (const adapter of adaptersFor(url)) {
    const found = adapter.detect(fixture.doc);
    if (found !== null) return { adapter, result: scan(found.formRoot, adapter, { platform }) };
  }
  throw new Error(`no adapter found a form root on ${source}`);
}

describe('the synthetic pages, as they load and in each of their states', () => {
  afterEach(() => removeFixtures(document));

  for (const [name, page] of Object.entries(PAGES)) {
    it(`${name}: as it loads`, async () => {
      const { doc, adapter, result } = await reach(page, { variant: null, steps: [], until: null });
      expect(adapter.id).toBe('generic');
      expect(compareWithExpectation(doc, result, page.loads)).toEqual([]);
    });

    for (const state of page.states) {
      it(`${name}: ${state.name}${state.variant === null ? '' : ` (${state.variant})`}`, async () => {
        const { doc, adapter, result } = await reach(page, state);
        expect(adapter.id).toBe('generic');
        expect(compareWithExpectation(doc, result, state.expectation)).toEqual([]);
      });
    }
  }
});

describe('a list that loads its options', () => {
  afterEach(() => removeFixtures(document));

  const page = PAGES['async-options'];
  const chooseUs: Step = { choose: '#country', value: 'US' };
  /** The State field of a scan. */
  const stateOf = (result: ScanResult) => {
    const field = result.fields.find((candidate) => candidate.idAttr === 'state');
    if (field === undefined) throw new Error('no State field');
    return field;
  };

  it('keeps its key while it shows "Loading...", and changes it once, when the states arrive', async () => {
    const loads = await reach(page, { variant: 'fast', steps: [], until: null });
    const before = stateOf(loads.result);
    apply(loads, chooseUs);
    const loading = stateOf(scanned(loads, page.loads.source).result);
    expect(loading.options).toMatchObject([{ label: 'Loading...', selected: true }]);
    expect(loading.key).toBe(before.key);
    // The one option a person sees, Loading..., is selected by default: no value.
    expect(loading.current).toEqual({ kind: 'empty' });
    await until(loads.doc, '#state option[value="TX"]');
    const loaded = stateOf(scanned(loads, page.loads.source).result);
    expect(loaded.baseKey).toBe(before.baseKey);
    expect(loaded.key).not.toBe(before.key);
    expect(loaded.options).toHaveLength(52);
  });

  it('keeps the key it had when its request fails and only the placeholder comes back', async () => {
    const loads = await reach(page, { variant: 'failed', steps: [], until: null });
    const before = stateOf(loads.result);
    apply(loads, chooseUs);
    expect(stateOf(scanned(loads, page.loads.source).result).key).toBe(before.key);
    await until(loads.doc, '#state-status:not(:empty)');
    expect(stateOf(scanned(loads, page.loads.source).result).key).toBe(before.key);
  });
});
