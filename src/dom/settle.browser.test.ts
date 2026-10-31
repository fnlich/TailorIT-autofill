/*
 * settle() in a real browser, with real timers and short windows and caps passed in. Each fixture's own page script
 * plays the page (it mutates, shows aria-busy, loads options), started from the test at a known moment, so every
 * assertion is about when settle() answered: soon after the page's condition was met, never on a fixed delay. The
 * caps are the only waits that run to their end, and only where the page never settles.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures, type Fixture } from './fixture.testkit';
import { registerOwnUiHost } from './own-ui';
import { busySigns, isLoadingOptionLabel, listHolding, settle, settleCapFor } from './settle';
import { SETTLE_CAP_MAX_MS, SETTLE_CAP_MS } from './thresholds';
import { every, monotonicNow, startDeadline } from './time';

/** How late past its condition an answer may come on a loaded test machine; answers are never early. */
const SLACK_MS = 500;
const QUIET_MS = 100;

/** The hooks the fixtures' page scripts expose. Times are the page's own performance.now(). */
interface PageHooks {
  churn(everyMs: number, times: number): void;
  churnEndedAt?: number;
  clearBusyAfter(ms: number): void;
  clearedAt?: number;
  churnShadow(everyMs: number, times: number): void;
  addShadowLater(everyMs: number, times: number): void;
  attachShadowLater(ms: number, everyMs: number, times: number): void;
  shadowEndedAt?: number;
  loadStatesAfter(ms: number): void;
  loadedAt?: number;
}

const SCRIPT = `<script>
  const status = () => document.getElementById('status');
  window.churn = (everyMs, times) => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      status().textContent = String(n);
      if (n === times) { clearInterval(id); window.churnEndedAt = performance.now(); }
    }, everyMs);
  };
  window.clearBusyAfter = (ms) => setTimeout(() => {
    document.getElementById('saving').setAttribute('aria-busy', 'false');
    window.clearedAt = performance.now();
  }, ms);
  const churnInside = (shadow, everyMs, times) => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      shadow.querySelector('p').textContent = String(n);
      if (n === times) { clearInterval(id); window.shadowEndedAt = performance.now(); }
    }, everyMs);
  };
  window.churnShadow = (everyMs, times) => churnInside(document.getElementById('widget').shadowRoot, everyMs, times);
  window.attachShadowLater = (ms, everyMs, times) => setTimeout(() => {
    const shadow = document.getElementById('late').attachShadow({ mode: 'open' });
    shadow.append(document.createElement('p'));
    churnInside(shadow, everyMs, times);
  }, ms);
  window.addShadowLater = (everyMs, times) => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(document.createElement('p'));
    document.querySelector('form').append(host);
    churnInside(shadow, everyMs, times);
  };
  window.loadStatesAfter = (ms) => setTimeout(() => {
    document.getElementById('state').replaceChildren(new Option('Texas'), new Option('Ohio'));
    window.loadedAt = performance.now();
  }, ms);
</script>`;

async function page(form: string, bodyAttributes = ''): Promise<{ fixture: Fixture; root: Element; hooks: PageHooks }> {
  const fixture = await loadFixture(document,
    `<!doctype html><body ${bodyAttributes} style="background:#fff"><form>${form}</form>${SCRIPT}</body>`);
  return { fixture, root: fixture.doc.querySelector('form')!, hooks: fixture.view as unknown as PageHooks };
}

const NAME = '<label for="name">Name</label><input id="name"><p id="status">0</p>';
const SAVING = '<div id="saving" aria-busy="true" style="width:200px;height:20px">Saving</div>';
const STATE_LOADING = '<div class="field"><label for="state">State</label><select id="state"><option>Loading...</option></select></div>';

describe('settle', () => {
  afterEach(() => removeFixtures(document));

  it('settles a quiet page after one quiet window, long before the cap', async () => {
    const { root } = await page(NAME);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 5_000 });
    expect(result.settled).toBe(true);
    const ms = result.settled ? result.ms : -1;
    expect(ms).toBeGreaterThanOrEqual(QUIET_MS - 1);
    expect(ms).toBeLessThan(QUIET_MS + SLACK_MS);
  });

  it('waits while the page mutates, and settles one quiet window after the last mutation', async () => {
    const { fixture, root, hooks } = await page(NAME);
    hooks.churn(40, 10);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 5_000 });
    expect(result.settled).toBe(true);
    expect(fixture.doc.getElementById('status')!.textContent).toBe('10');
    const quietFor = fixture.view.performance.now() - hooks.churnEndedAt!;
    expect(quietFor).toBeGreaterThanOrEqual(QUIET_MS - 2);
    expect(quietFor).toBeLessThan(QUIET_MS + SLACK_MS);
  });

  it('waits for an aria-busy region to clear', async () => {
    const { fixture, root, hooks } = await page(`${NAME}${SAVING}`);
    hooks.clearBusyAfter(500);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 5_000 });
    expect(result.settled).toBe(true);
    const quietFor = fixture.view.performance.now() - hooks.clearedAt!;
    expect(quietFor).toBeGreaterThanOrEqual(QUIET_MS - 2);
    expect(quietFor).toBeLessThan(QUIET_MS + SLACK_MS);
  });

  it('looks again after each quiet window, so a busy sign that clears without a mutation is seen', async () => {
    const { root } = await page(NAME);
    let busy = true;
    const adapter = { isBusy: () => busy } as unknown as Adapter;
    startDeadline(450, () => {
      busy = false;
    });
    const result = await settle(root, { adapter, quietMs: QUIET_MS, capMs: 5_000 });
    expect(result.settled).toBe(true);
    const ms = result.settled ? result.ms : -1;
    expect(ms).toBeGreaterThanOrEqual(450);
    expect(ms).toBeLessThan(450 + QUIET_MS + SLACK_MS);
  });

  it('answers page-still-busy at the cap when a busy sign never clears, or the page never stops mutating', async () => {
    const { root } = await page(`${NAME}${SAVING}`);
    let since = monotonicNow();
    expect(await settle(root, { quietMs: QUIET_MS, capMs: 600 })).toEqual({ settled: false, reason: 'page-still-busy' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(598);
    expect(monotonicNow() - since).toBeLessThan(600 + SLACK_MS);

    removeFixtures(document);
    const churning = await page(NAME);
    churning.hooks.churn(30, 1_000);
    since = monotonicNow();
    expect(await settle(churning.root, { quietMs: QUIET_MS, capMs: 600 }))
      .toEqual({ settled: false, reason: 'page-still-busy' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(598);
  });

  it("ignores the extension's own UI: its mutations, its host coming and going, and its aria-busy", async () => {
    const { fixture, root } = await page(NAME);
    const ticker = new AbortController();
    // A page element that keeps changing holds the page busy to the cap...
    const pageBadge = fixture.doc.getElementById('status')!;
    let n = 0;
    every(30, () => pageBadge.setAttribute('data-tick', String((n += 1))), ticker.signal);
    expect(await settle(root, { quietMs: QUIET_MS, capMs: 500 })).toEqual({ settled: false, reason: 'page-still-busy' });
    ticker.abort();

    // ...while the same churn in our own host, inside the form, does not.
    const host = fixture.doc.createElement('div');
    registerOwnUiHost(host);
    host.setAttribute('aria-busy', 'true');
    host.style.cssText = 'width:200px;height:40px';
    root.append(host);
    const ours = new AbortController();
    let another: HTMLElement | null = null;
    every(30, () => {
      n += 1;
      host.setAttribute('data-tick', String(n));
      host.textContent = `Filling ${n}`;
      // A second host of ours comes and goes inside the form: the records' target is the form, not our UI.
      if (another === null) {
        another = fixture.doc.createElement('div');
        registerOwnUiHost(another);
        root.append(another);
      } else {
        another.remove();
        another = null;
      }
    }, ours.signal);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 3_000 });
    ours.abort();
    expect(result.settled).toBe(true);
    expect(result.settled ? result.ms : -1).toBeLessThan(QUIET_MS + SLACK_MS);
    expect(busySigns(root, null)).toEqual([]);
  });

  it('answers aborted the moment the run aborts, or at once when it already has', async () => {
    const { root } = await page(`${NAME}${SAVING}`);
    const run = new AbortController();
    startDeadline(200, () => run.abort());
    const since = monotonicNow();
    expect(await settle(root, { signal: run.signal, quietMs: QUIET_MS, capMs: 5_000 }))
      .toEqual({ settled: false, reason: 'aborted' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(198);
    expect(monotonicNow() - since).toBeLessThan(200 + SLACK_MS);
    const again = monotonicNow();
    expect(await settle(root, { signal: run.signal })).toEqual({ settled: false, reason: 'aborted' });
    expect(monotonicNow() - again).toBeLessThan(50);
  });

  it('answers aborted for a root with no window to watch it in', async () => {
    const inert = document.implementation.createHTMLDocument('inert');
    const form = inert.createElement('form');
    inert.body.append(form);
    expect(await settle(form, { quietMs: QUIET_MS })).toEqual({ settled: false, reason: 'aborted' });
  });

  it('watches open shadow roots, those there at the start and those that arrive', async () => {
    const widget = `<div id="widget"></div><script>
      document.getElementById('widget').attachShadow({ mode: 'open' }).append(document.createElement('p'));
    </script>`;
    const first = await page(`${NAME}${widget}`);
    first.hooks.churnShadow(40, 10);
    expect((await settle(first.root, { quietMs: QUIET_MS, capMs: 5_000 })).settled).toBe(true);
    expect(first.fixture.view.performance.now() - first.hooks.shadowEndedAt!).toBeGreaterThanOrEqual(QUIET_MS - 2);

    removeFixtures(document);
    const later = await page(NAME);
    later.hooks.addShadowLater(40, 10);
    expect((await settle(later.root, { quietMs: QUIET_MS, capMs: 5_000 })).settled).toBe(true);
    expect(later.fixture.view.performance.now() - later.hooks.shadowEndedAt!).toBeGreaterThanOrEqual(QUIET_MS - 2);
  });

  it('gives a shadow root attached without any mutation record one more window before calling the page quiet',
    async () => {
      const { fixture, root, hooks } = await page(`${NAME}<div id="late"></div>`);
      hooks.attachShadowLater(50, 40, 10);
      expect((await settle(root, { quietMs: QUIET_MS, capMs: 5_000 })).settled).toBe(true);
      expect(fixture.view.performance.now() - hooks.shadowEndedAt!).toBeGreaterThanOrEqual(QUIET_MS - 2);
    });

  it('waits for an option list that is still loading', async () => {
    const { fixture, root, hooks } = await page(`${NAME}${STATE_LOADING}`);
    hooks.loadStatesAfter(500);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 5_000 });
    expect(result.settled).toBe(true);
    expect(fixture.view.performance.now() - hooks.loadedAt!).toBeGreaterThanOrEqual(QUIET_MS - 2);
  });

  it('counts a list still loading only up to the options cap, and a busy page to the full cap', async () => {
    const { root } = await page(`${NAME}${STATE_LOADING}`);
    expect(busySigns(root, null)).toEqual(['options-loading']);
    const result = await settle(root, { quietMs: QUIET_MS, capMs: 3_000, optionsCapMs: 400 });
    expect(result.settled).toBe(true);
    const ms = result.settled ? result.ms : -1;
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(400 + QUIET_MS + SLACK_MS);

    removeFixtures(document);
    const busy = await page(`${NAME}${STATE_LOADING}${SAVING}`);
    expect(busySigns(busy.root, null)).toEqual(['aria-busy', 'options-loading']);
    expect(await settle(busy.root, { quietMs: QUIET_MS, capMs: 900, optionsCapMs: 400 }))
      .toEqual({ settled: false, reason: 'page-still-busy' });
  });
});

describe('busySigns', () => {
  afterEach(() => removeFixtures(document));

  it.each([
    ['a visible aria-busy region', SAVING, ['aria-busy']],
    ['a hidden aria-busy region', '<div aria-busy="true" style="display:none">Saving</div>', []],
    ['aria-busy="false"', '<div aria-busy="false" style="width:200px;height:20px">Saved</div>', []],
    ['an indeterminate role=progressbar', '<div role="progressbar" style="width:120px;height:8px;background:#06c"></div>',
      ['progressbar']],
    ['a determinate role=progressbar (a step indicator)', `<div role="progressbar" aria-valuenow="40"
      aria-valuemin="0" aria-valuemax="100" style="width:120px;height:8px;background:#06c"></div>`, []],
    ['an indeterminate <progress>', '<progress style="width:120px"></progress>', ['progressbar']],
    ['a determinate <progress>', '<progress value="2" max="5" style="width:120px"></progress>', []],
    ['a select with a loading option', STATE_LOADING, ['options-loading']],
    ['aria-busy on a select', '<label for="s">State</label><select id="s" aria-busy="true"><option>Texas</option></select>',
      ['options-loading']],
    ['aria-busy on a list\'s field container', `<div class="field" aria-busy="true"><label for="s">State</label>
      <select id="s"><option>Select a state</option></select></div>`, ['options-loading']],
    ['a progress bar in a list\'s field container', `<div class="field"><label for="s">State</label><select id="s">
      </select><progress style="width:60px"></progress></div>`, ['options-loading']],
    ['aria-busy around two controls', `<div aria-busy="true"><label for="s">State</label><select id="s"><option>Texas
      </option></select><label for="c">City</label><input id="c"></div>`, ['aria-busy']],
    ['a loaded list', `<div class="field"><label for="s">State</label><select id="s"><option>Select a state</option>
      <option>Texas</option></select></div>`, []],
  ])('%s', async (_name, markup, expected) => {
    const { root } = await page(`${NAME}${markup}`);
    expect(busySigns(root, null)).toEqual(expected);
  });

  it('counts aria-busy on the form root or around it', async () => {
    const { root } = await page(NAME, 'aria-busy="true"');
    expect(busySigns(root, null)).toEqual(['aria-busy']);
  });

  it('counts aria-busy inside an open shadow root', async () => {
    const { root } = await page(`${NAME}<div id="widget"></div><script>
      const inner = document.createElement('div');
      inner.setAttribute('aria-busy', 'true');
      inner.style.cssText = 'width:200px;height:20px';
      inner.textContent = 'Loading';
      document.getElementById('widget').attachShadow({ mode: 'open' }).append(inner);
    </script>`);
    expect(busySigns(root, null)).toEqual(['aria-busy']);
  });

  it("takes the adapter's isBusy, and counts an adapter that throws as busy", async () => {
    const { root } = await page(NAME);
    expect(busySigns(root, { isBusy: () => true } as unknown as Adapter)).toEqual(['adapter']);
    expect(busySigns(root, { isBusy: () => false } as unknown as Adapter)).toEqual([]);
    const broken = { isBusy: () => { throw new Error('no such element'); } } as unknown as Adapter;
    expect(busySigns(root, broken)).toEqual(['adapter']);
  });

  it('finds the list whose field container holds a busy element, and none for the page around it', async () => {
    const { fixture } = await page(`${NAME}<div class="field" id="wrap"><label for="s">State</label><select id="s">
      </select><span id="spin"></span></div><span id="loose"></span>`);
    expect(listHolding(fixture.doc.getElementById('spin')!)).toBe(fixture.doc.getElementById('s'));
    expect(listHolding(fixture.doc.getElementById('wrap')!)).toBe(fixture.doc.getElementById('s'));
    expect(listHolding(fixture.doc.getElementById('loose')!)).toBeNull();
  });
});

describe('isLoadingOptionLabel', () => {
  it.each([
    ['Loading...', true], ['Loading\u{2026}', true], ['LOADING', true], ['Please wait', true], ['One moment please', true],
    ['Loading states...', true], ['Fetching cities...', true], ['Searching...', true],
    ['Fetching cities', false], ['Searching for a new role', false], ['Loading dock supervisor', false],
    ['Texas', false], ['Lodging', false], ['Load balancer', false], ['Searchlight', false], ['Select a state', false],
    ['', false],
  ])('%s: %s', (label, expected) => {
    expect(isLoadingOptionLabel(label)).toBe(expected);
  });
});

describe('settleCapFor', () => {
  it('is SETTLE_CAP_MS, raised by an adapter up to SETTLE_CAP_MAX_MS, never lowered', () => {
    const quirk = (settleCapMs: number) => ({ quirks: { settleCapMs } }) as unknown as Adapter;
    expect(settleCapFor(null)).toBe(SETTLE_CAP_MS);
    expect(settleCapFor({} as Adapter)).toBe(SETTLE_CAP_MS);
    expect(settleCapFor(quirk(12_000))).toBe(12_000);
    expect(settleCapFor(quirk(3_000))).toBe(SETTLE_CAP_MS);
    expect(settleCapFor(quirk(1e12))).toBe(SETTLE_CAP_MAX_MS);
    expect(settleCapFor(quirk(Number.POSITIVE_INFINITY))).toBe(SETTLE_CAP_MAX_MS);
    expect(settleCapFor(quirk(Number.NaN))).toBe(SETTLE_CAP_MS);
  });
});
