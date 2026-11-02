/*
 * A form root drawn late (late-form.ts): the content runtime looks for it again as the page changes, but only where an
 * adapter of the address says its page draws it late (Ashby's React draws it seconds after the page loads). On the
 * synthetic Ashby page (fixtures/synthetic/ashby-widgets) the runtime starts with no form, tells the worker so, and once
 * React draws the form it mounts the launcher and says hello again with the form; a page an adapter says nothing about
 * (a fixture-board page whose form appears later) is not watched, as before.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ashbyHtml from '../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog } from '../../fixtures/synthetic/ashby-widgets/app';
import { ashbyAdapter } from '../adapters/ashby';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { quietWait } from '../dom/settle';
import { createFakeWorker, testVocab } from './content.testkit';
import { LATE_FORM_CAP_MS, LATE_FORM_LOOK_MS, lateAdapters, lateFormMs, watchForLateForm } from './late-form';
import { startContentRuntime, type ContentRuntime } from './runtime';

const ASHBY = 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b1/application';

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const unmount of unmounts.splice(0)) unmount();
  removeFixtures(document);
});

/** Waits until `ready` holds, at most `capMs`. */
async function until(view: Window & typeof globalThis, doc: Document, ready: () => boolean, capMs = 4_000): Promise<boolean> {
  const wait = quietWait<boolean>({ view, quietMs: 50, capMs, signal: undefined, aborted: false,
    atQuiet: () => (ready() ? true : null),
    atCap: () => ready() });
  wait.observe(doc.documentElement);
  return wait.done;
}

describe('lateFormMs', () => {
  it("is the longest wait an address's adapters say, held at the cap; none for the generic adapter", () => {
    expect(lateFormMs([genericAdapter])).toBe(0);
    expect(lateFormMs([ashbyAdapter, genericAdapter])).toBe(ashbyAdapter.quirks!.formLateMs);
    // Ashby's form came 4.8 to 6.8 s after the page loaded on one fast headless run: its wait is the runtime's cap.
    expect(ashbyAdapter.quirks!.formLateMs).toBe(LATE_FORM_CAP_MS);
    const slow: Adapter = { ...genericAdapter, quirks: { formLateMs: 10 * LATE_FORM_CAP_MS } };
    expect(lateFormMs([slow])).toBe(LATE_FORM_CAP_MS);
    expect(lateFormMs([{ ...genericAdapter, quirks: { formLateMs: Number.NaN } }])).toBe(0);
  });
});

describe('lateAdapters', () => {
  it('keeps only the adapters that wait for a late form, while one does; else every adapter', () => {
    expect(lateAdapters([ashbyAdapter, genericAdapter])).toEqual([ashbyAdapter]);
    expect(lateAdapters([genericAdapter])).toEqual([genericAdapter]);
  });
});

describe('watchForLateForm', () => {
  it('looks once after each burst of mutations, and stops at the look that finds it', async () => {
    const fixture = await loadFixture(document, '<main></main>');
    let looks = 0;
    let found = false;
    const signal = new AbortController().signal;
    watchForLateForm(fixture.doc, 2_000, () => {
      looks += 1;
      return found;
    }, signal);
    const main = fixture.doc.querySelector('main')!;
    for (let at = 0; at < 5; at += 1) main.append(fixture.doc.createElement('p'));
    await until(fixture.view, fixture.doc, () => looks === 1);
    found = true;
    main.append(fixture.doc.createElement('form'));
    await until(fixture.view, fixture.doc, () => looks === 2);
    main.append(fixture.doc.createElement('p'));
    expect(await until(fixture.view, fixture.doc, () => looks > 2, LATE_FORM_LOOK_MS * 4)).toBe(false);
    expect(looks).toBe(2);
  });

  it('stops at its cap and when its signal aborts', async () => {
    const fixture = await loadFixture(document, '<main></main>');
    let looks = 0;
    watchForLateForm(fixture.doc, 50, () => {
      looks += 1;
      return false;
    }, new AbortController().signal);
    const stopped = new AbortController();
    watchForLateForm(fixture.doc, 2_000, () => {
      looks += 10;
      return false;
    }, stopped.signal);
    stopped.abort();
    await until(fixture.view, fixture.doc, () => false, 120);
    fixture.doc.body.append(fixture.doc.createElement('p'));
    expect(await until(fixture.view, fixture.doc, () => looks > 0, LATE_FORM_LOOK_MS * 4)).toBe(false);
    expect(watchForLateForm(fixture.doc, 0, () => true, new AbortController().signal)()).toBeUndefined();
  });

  it('says when its wait ran out, and only then', async () => {
    const fixture = await loadFixture(document, '<main></main>');
    let expired = 0;
    watchForLateForm(fixture.doc, 80, () => false, new AbortController().signal, () => {
      expired += 1;
    });
    watchForLateForm(fixture.doc, 2_000, () => true, new AbortController().signal, () => {
      expired += 10;
    });
    fixture.doc.body.append(fixture.doc.createElement('p'));
    expect(await until(fixture.view, fixture.doc, () => expired === 1, 1_000)).toBe(true);
    expect(await until(fixture.view, fixture.doc, () => expired > 1, LATE_FORM_LOOK_MS * 4)).toBe(false);
  });
});

describe('the content runtime on a page that draws its form late', () => {
  it('mounts the launcher and says hello with the form once Ashby draws it', async () => {
    const fixture = await loadFixture(document, ashbyHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2400 });
    const fake = createFakeWorker();
    unmounts.push(mountAshbyForm(fixture.doc.getElementById('ashby-panel')!, { log: newLog(), drawAfterMs: 600 }).unmount);
    const runtime = await startContentRuntime(fake.platform, fixture.doc, { href: () => ASHBY, isTop: true });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false]);
    expect(await until(fixture.view, fixture.doc, () => runtime.page !== null)).toBe(true);
    expect(runtime.page?.adapter).toBe(ashbyAdapter);
    expect(runtime.page?.root).toBe(fixture.doc.getElementById('form'));
    expect(await until(fixture.view, fixture.doc, () => fake.of('frame/hello').length === 2)).toBe(true);
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false, true]);
    expect(runtime.ui).not.toBeNull();
  });

  it('watches nothing where no adapter says its form comes late: the page stays without a launcher', async () => {
    const fixture = await loadFixture(document, '<main></main>');
    const fake = createFakeWorker();
    const runtime = await startContentRuntime(fake.platform, fixture.doc, {
      href: () => 'https://jobs.lever.co/tailorit-fixture/late-form/apply', isTop: true });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    const form = fixture.doc.createElement('form');
    const label = fixture.doc.createElement('label');
    label.htmlFor = 'n';
    label.textContent = 'Name';
    const input = fixture.doc.createElement('input');
    input.id = 'n';
    form.append(label, input);
    fixture.doc.querySelector('main')!.append(form);
    expect(await until(fixture.view, fixture.doc, () => runtime.page !== null, 600)).toBe(false);
    expect(fake.of('frame/hello')).toHaveLength(1);
  });
});
