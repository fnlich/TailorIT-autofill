/*
 * awaitOptions() in a real browser, with real timers and short windows and caps passed in. The fixture's page script
 * plays a dependent state list: it shows "Loading...", aria-busy and a progress bar, then real options after a delay
 * (or never), re-renders the same options, or replaces the list's element. Every answer is checked against when the
 * page's condition was met: soon after it, never on a fixed delay; only lists that never load run to the cap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { OptionSetHash } from '../core/types/field';
import { awaitOptions, isOptionList, optionsState } from './await-options';
import { loadFixture, removeFixtures, type Fixture } from './fixture.testkit';
import { hashOfOptions } from './option-hash';
import { scan } from './scan';
import { monotonicNow, startDeadline } from './time';
import type { FieldTarget } from './types';

/** How late past its condition an answer may come on a loaded test machine; answers are never early. */
const SLACK_MS = 500;
const QUIET_MS = 100;
const OPTIONS = { platform: 'lever' as const };

/** The hooks the fixture's page script exposes. Times are the page's own performance.now(). */
interface PageHooks {
  startLoading(): void;
  clearBusy(): void;
  loadAfter(ms: number, labels: string[]): void;
  loadedAt?: number;
  fillNow(labels: string[]): void;
  fillAfter(ms: number, labels: string[]): void;
  replaceAfter(ms: number, labels: string[]): void;
  removeAfter(ms: number): void;
  trickle(everyMs: number, batches: string[][]): void;
  lastBatchAt?: number;
}

const PAGE = `<!doctype html><body style="background:#fff"><form>
  <label for="country">Country</label>
  <select id="country"><option value="">Select a country</option><option>United States</option><option>Canada</option></select>
  <div class="field" id="state-field"><label for="state">State</label>
    <select id="state"><option value="">Select a state</option></select></div>
  <label for="city">City</label><input id="city">
</form><script>
  const field = document.getElementById('state-field');
  const current = () => document.getElementById('state');
  const fill = (labels) => current().replaceChildren(...labels.map((label) => new Option(label)));
  window.startLoading = () => {
    fill(['Loading...']);
    field.setAttribute('aria-busy', 'true');
    if (document.getElementById('state-bar') !== null) return;
    const bar = document.createElement('div');
    bar.id = 'state-bar';
    bar.setAttribute('role', 'progressbar');
    bar.style.cssText = 'width:80px;height:6px;background:#06c';
    field.append(bar);
  };
  window.clearBusy = () => {
    field.removeAttribute('aria-busy');
    document.getElementById('state-bar')?.remove();
  };
  window.loadAfter = (ms, labels) => {
    window.startLoading();
    setTimeout(() => {
      window.clearBusy();
      fill(labels);
      window.loadedAt = performance.now();
    }, ms);
  };
  window.fillNow = fill;
  window.fillAfter = (ms, labels) => setTimeout(() => fill(labels), ms);
  window.replaceAfter = (ms, labels) => setTimeout(() => {
    const next = document.createElement('select');
    next.id = 'state';
    next.append(...labels.map((label) => new Option(label)));
    current().replaceWith(next);
  }, ms);
  window.removeAfter = (ms) => setTimeout(() => field.remove(), ms);
  window.trickle = (everyMs, batches) => {
    let n = 0;
    const id = setInterval(() => {
      fill(batches[n]);
      n += 1;
      if (n === batches.length) { clearInterval(id); window.lastBatchAt = performance.now(); }
    }, everyMs);
  };
</script></body>`;

interface Page {
  fixture: Fixture;
  root: Element;
  hooks: PageHooks;
  /** The state list as the scanner sees it now, and its live elements. */
  state(): { target: FieldTarget; hash: OptionSetHash };
  /** How the run finds the list again once the page replaced it: a fresh scan, by the field's baseKey. */
  refind(): Element | null;
}

async function page(): Promise<Page> {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.querySelector('form')!;
  const stateField = () => {
    const result = scan(root, null, OPTIONS);
    const field = result.fields.find((candidate) => candidate.idAttr === 'state');
    return field === undefined ? null : { field, target: result.target(field.key)! };
  };
  const baseKey = stateField()!.field.baseKey;
  return {
    fixture, root, hooks: fixture.view as unknown as PageHooks,
    state: () => {
      const found = stateField()!;
      return { target: found.target, hash: found.field.optionSetHash };
    },
    refind: () => {
      const result = scan(root, null, OPTIONS);
      const field = result.fields.find((candidate) => candidate.baseKey === baseKey);
      return field === undefined ? null : result.target(field.key)?.control ?? null;
    },
  };
}

describe('awaitOptions', () => {
  afterEach(() => removeFixtures(document));

  it.each([400, 800, 1_200])('answers ready once real options arrive after %i ms, with the hash the next scan gives',
    async (delay) => {
      const { fixture, hooks, state } = await page();
      const before = state();
      hooks.loadAfter(delay, ['Texas', 'Ohio']);
      const result = await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 3_000 });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.ms).toBeGreaterThanOrEqual(delay);
      expect(result.ms).toBeLessThan(delay + QUIET_MS + SLACK_MS);
      expect(fixture.view.performance.now() - hooks.loadedAt!).toBeGreaterThanOrEqual(QUIET_MS - 2);
      expect(result.optionSetHash).toBe(hashOfOptions(['Texas', 'Ohio']));
      expect(result.optionSetHash).toBe(state().hash);
      expect(result.optionSetHash).not.toBe(before.hash);
    });

  it('answers never-loaded at the cap when the options never arrive, saying what it still waited for', async () => {
    const { hooks, state } = await page();
    const before = state();
    hooks.startLoading();
    const since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 700 }))
      .toEqual({ status: 'never-loaded', reason: 'options-never-loaded', waiting: 'busy' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(698);
    expect(monotonicNow() - since).toBeLessThan(700 + SLACK_MS);

    hooks.clearBusy();
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 300 }))
      .toEqual({ status: 'never-loaded', reason: 'options-never-loaded', waiting: 'loading' });
  });

  it('answers never-loaded for a list that holds only placeholders', async () => {
    const { hooks, state } = await page();
    const before = state();
    hooks.fillAfter(150, ['Select a state', '-- Choose --']);
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 600 }))
      .toEqual({ status: 'never-loaded', reason: 'options-never-loaded', waiting: 'placeholders' });
  });

  it('answers never-loaded for a list re-rendered with the same options, and ready once they differ', async () => {
    const { hooks, state } = await page();
    hooks.fillNow(['Texas', 'Ohio']);
    const loaded = state();
    hooks.fillAfter(150, ['Ohio', 'Texas']);
    expect(await awaitOptions(loaded.target, { prevHash: loaded.hash, quietMs: QUIET_MS, capMs: 600 }))
      .toEqual({ status: 'never-loaded', reason: 'options-never-loaded', waiting: 'unchanged' });
    hooks.fillAfter(150, ['Ohio', 'Texas', 'Utah']);
    const changed = await awaitOptions(loaded.target, { prevHash: loaded.hash, quietMs: QUIET_MS, capMs: 2_000 });
    expect(changed).toMatchObject({ status: 'ready', optionSetHash: hashOfOptions(['Ohio', 'Texas', 'Utah']) });
  });

  it('answers ready at the cap for real, changed options that arrived inside the last window', async () => {
    const { hooks, state } = await page();
    const before = state();
    hooks.fillAfter(250, ['Texas']);
    // The mutation at 250 ms starts a 300 ms window that would end after the 400 ms cap.
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: 300, capMs: 400 }))
      .toMatchObject({ status: 'ready', optionSetHash: hashOfOptions(['Texas']) });
  });

  it('takes any real options when there was no earlier set to compare with', async () => {
    const { hooks, state } = await page();
    hooks.fillNow(['Texas']);
    const result = await awaitOptions(state().target, { prevHash: null, quietMs: QUIET_MS, capMs: 2_000 });
    expect(result).toMatchObject({ status: 'ready', optionSetHash: hashOfOptions(['Texas']) });
  });

  it('answers only once the list has been quiet: never on a batch the page is still adding to', async () => {
    const { fixture, hooks, state } = await page();
    const before = state();
    hooks.trickle(60, [['Alabama'], ['Alabama', 'Alaska'], ['Alabama', 'Alaska', 'Arizona'],
      ['Alabama', 'Alaska', 'Arizona', 'Arkansas']]);
    const result = await awaitOptions(before.target, { prevHash: before.hash, quietMs: 150, capMs: 3_000 });
    expect(result).toMatchObject({ status: 'ready',
      optionSetHash: hashOfOptions(['Alabama', 'Alaska', 'Arizona', 'Arkansas']) });
    expect(fixture.view.performance.now() - hooks.lastBatchAt!).toBeGreaterThanOrEqual(148);
  });

  it('answers aborted the moment the run aborts, or at once when it already has', async () => {
    const { hooks, state } = await page();
    const before = state();
    hooks.startLoading();
    const run = new AbortController();
    startDeadline(200, () => run.abort());
    const since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, signal: run.signal, capMs: 5_000 }))
      .toEqual({ status: 'aborted' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(198);
    expect(monotonicNow() - since).toBeLessThan(200 + SLACK_MS);
    expect(await awaitOptions(before.target, { prevHash: before.hash, signal: run.signal }))
      .toEqual({ status: 'aborted' });
  });

  it('follows a list the page replaces, through refind; without it the list is gone', async () => {
    const replaced = await page();
    const before = replaced.state();
    replaced.hooks.replaceAfter(300, ['Texas', 'Ohio']);
    const found = await awaitOptions(before.target, { prevHash: before.hash, refind: replaced.refind, quietMs: QUIET_MS,
      capMs: 3_000 });
    expect(found).toMatchObject({ status: 'ready', optionSetHash: hashOfOptions(['Texas', 'Ohio']) });

    removeFixtures(document);
    const lost = await page();
    const lostBefore = lost.state();
    lost.hooks.replaceAfter(200, ['Texas', 'Ohio']);
    const since = monotonicNow();
    expect(await awaitOptions(lostBefore.target, { prevHash: lostBefore.hash, quietMs: QUIET_MS, capMs: 3_000 }))
      .toEqual({ status: 'gone' });
    expect(monotonicNow() - since).toBeLessThan(200 + QUIET_MS + SLACK_MS);
  });

  it('keeps looking for a list that left the page until the cap, then answers gone', async () => {
    const { hooks, state, refind } = await page();
    const before = state();
    hooks.removeAfter(150);
    const since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, refind, quietMs: QUIET_MS, capMs: 700 }))
      .toEqual({ status: 'gone' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(698);
  });

  it('counts the cap from startedAt, so a wait the caller already spent is not waited again', async () => {
    const { hooks, state } = await page();
    const before = state();
    hooks.startLoading();
    let since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 700,
      startedAt: since - 500 })).toMatchObject({ status: 'never-loaded', waiting: 'busy' });
    expect(monotonicNow() - since).toBeGreaterThanOrEqual(198);
    expect(monotonicNow() - since).toBeLessThan(200 + SLACK_MS);

    since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, capMs: 700, startedAt: since - 5_000 }))
      .toMatchObject({ status: 'never-loaded', waiting: 'busy' });
    hooks.loadAfter(0, ['Texas']);
    expect(await awaitOptions(before.target, { prevHash: before.hash, quietMs: QUIET_MS, capMs: 2_000 }))
      .toMatchObject({ status: 'ready' });
    since = monotonicNow();
    expect(await awaitOptions(before.target, { prevHash: before.hash, capMs: 700, startedAt: since - 5_000 }))
      .toMatchObject({ status: 'ready', optionSetHash: hashOfOptions(['Texas']) });
    expect(monotonicNow() - since).toBeLessThan(50);
  });

  it('reads native selects only', async () => {
    const { fixture } = await page();
    const city = fixture.doc.getElementById('city')!;
    expect(isOptionList(city)).toBe(false);
    expect(isOptionList(fixture.doc.getElementById('state')!)).toBe(true);
    await expect(awaitOptions(city, { prevHash: null })).rejects.toThrow(TypeError);
  });
});

describe('optionsState', () => {
  afterEach(() => removeFixtures(document));

  it('says why a list is not ready, in order, and gives a ready list the scanner\'s hash', async () => {
    const { fixture, root, hooks, state } = await page();
    const list = () => fixture.doc.getElementById('state') as HTMLSelectElement;
    const field = fixture.doc.getElementById('state-field')!;
    const empty = state().hash;
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'placeholders' });
    hooks.fillNow([]);
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'placeholders' });
    hooks.fillNow(['Texas', 'Loading more...']);
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'loading' });
    hooks.fillNow(['Select a state', 'Texas']);
    expect(optionsState(list(), empty)).toEqual({ ready: true, optionSetHash: hashOfOptions(['Texas']) });
    expect(optionsState(list(), state().hash)).toEqual({ ready: false, waiting: 'unchanged' });
    expect(state().hash).toBe(hashOfOptions(['Texas']));
    // aria-busy around the whole form is the page's (settle's), not the list's.
    root.setAttribute('aria-busy', 'true');
    expect(optionsState(list(), empty).ready).toBe(true);
    field.setAttribute('aria-busy', 'true');
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'busy' });
    field.removeAttribute('aria-busy');
    const bar = fixture.doc.createElement('progress');
    field.append(bar);
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'busy' });
    bar.value = 1;
    expect(optionsState(list(), empty).ready).toBe(true);
    field.style.display = 'none';
    expect(optionsState(list(), empty)).toEqual({ ready: false, waiting: 'hidden' });
    const detached = list();
    field.remove();
    expect(optionsState(detached, empty)).toEqual({ ready: false, waiting: 'gone' });
  });
});
