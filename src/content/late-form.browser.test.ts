/*
 * A form root drawn late (late-form.ts): the content runtime looks for it again as the page changes, but only where an
 * adapter of the address says its page draws it late (Ashby's React draws it seconds after the page loads). On the
 * synthetic Ashby page (fixtures/synthetic/ashby-widgets) the runtime starts with no form, tells the worker so, and once
 * React draws the form it mounts the launcher and says hello again with the form; a page an adapter says nothing about
 * (a fixture-board page whose form appears later) is not watched, as before.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ashbyHtml from '../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog } from '../../fixtures/synthetic/ashby-widgets/app';
import { ashbyAdapter } from '../adapters/ashby';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { quietWait } from '../dom/settle';
import { startDeadline } from '../dom/time'; // jr6 ifix B3
import { createFakeWorker, testVocab } from './content.testkit';
import { LATE_FORM_CAP_MS, LATE_FORM_LOOK_MS, lateAdapters, lateFormMs, watchForLateForm,
  // jr6 apply F2 item 5
  ATTRIBUTE_RECORDS_READ, attributesShow, FORM_PARTS, PROMPT_PARTS, watchForSiteForm } from './late-form';
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

// ── jr6 apply F2 item 5 (APPLYPLAN D5; C3, apply-c-new-1): a form drawn hidden and shown by an attribute ──
describe('the late watches hear an attribute that shows a form (jr6 apply F2 item 5)', () => {
  /** The records a change to `doc` makes, as a MutationObserver of SHOWN_ATTRIBUTES hears them. */
  async function recordsOf(doc: Document, change: () => void): Promise<MutationRecord[]> {
    const view = doc.defaultView!;
    const heard: MutationRecord[] = [];
    const observer = new view.MutationObserver((records) => heard.push(...records));
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'] });
    change();
    await until(view, doc, () => heard.length > 0, 500);
    observer.disconnect();
    return heard;
  }

  it('counts an attribute change on an element that is or holds a control, never one that holds none', async () => {
    const fixture = await loadFixture(document, `<main><div id="wrap" class="closed"><form><label for="n">Name</label>
      <input id="n"></form></div><div id="spinner" style="width:10px"><span>..</span></div>
      <dialog id="d"><button id="b" type="button">Apply manually</button></dialog><p id="lone" hidden>Text</p></main>`);
    const doc = fixture.doc;
    expect(attributesShow(await recordsOf(doc, () => doc.getElementById('wrap')!.className = 'open'), FORM_PARTS))
      .toBe(true);
    expect(attributesShow(await recordsOf(doc, () => doc.getElementById('spinner')!.style.width = '20px'), PROMPT_PARTS))
      .toBe(false);
    expect(attributesShow(await recordsOf(doc, () => doc.getElementById('lone')!.hidden = false), PROMPT_PARTS)).toBe(false);
    // A dialog opened: a control for the prompt watch (its button), no form's part for the company page's.
    const opened = await recordsOf(doc, () => (doc.getElementById('d') as HTMLDialogElement).setAttribute('open', ''));
    expect(attributesShow(opened, PROMPT_PARTS)).toBe(true);
    expect(attributesShow(opened, FORM_PARTS)).toBe(false);
    // Nodes added are no attribute change.
    expect(attributesShow(await recordsOf(doc, () => doc.querySelector('main')!.append(doc.createElement('input'))),
      FORM_PARTS)).toBe(false);
  });

  it('counts a batch of more attribute changes than it reads, as addsFormParts does', async () => {
    const fixture = await loadFixture(document, `<main>${'<span class="a">x</span>'.repeat(ATTRIBUTE_RECORDS_READ + 5)}</main>`);
    const records = await recordsOf(fixture.doc, () => {
      for (const span of Array.from(fixture.doc.querySelectorAll('span'))) span.className = 'b';
    });
    expect(attributesShow(records, FORM_PARTS)).toBe(true);
  });

  it('watchForLateForm looks when a dialog holding a form opens by its attribute alone (undo proof: the attribute watch)',
    async () => {
      const fixture = await loadFixture(document, `<main><dialog id="d"><form><label for="n">Name</label><input id="n">
        </form></dialog><div id="spinner" style="width:10px">..</div></main>`);
      let looks = 0;
      watchForLateForm(fixture.doc, 2_000, () => {
        looks += 1;
        return false;
      }, new AbortController().signal);
      // A style that shows no control: no look.
      fixture.doc.getElementById('spinner')!.style.width = '30px';
      expect(await until(fixture.view, fixture.doc, () => looks > 0, LATE_FORM_LOOK_MS * 4)).toBe(false);
      // The dialog opened: a look, with no node added.
      fixture.doc.getElementById('d')!.setAttribute('open', '');
      expect(await until(fixture.view, fixture.doc, () => looks === 1, 1_000)).toBe(true);
    });

  it('watchForSiteForm looks when a class shows a form\u2019s parts, never for a style on a plain element', async () => {
    const fixture = await loadFixture(document, `<main><section id="apply" class="hidden" style="display:none"><form>
      <input id="n"></form></section><div id="banner" class="a">News</div></main>`);
    let looks = 0;
    watchForSiteForm(fixture.doc, () => {
      looks += 1;
      return false;
    }, new AbortController().signal);
    fixture.doc.getElementById('banner')!.className = 'b';
    expect(await until(fixture.view, fixture.doc, () => looks > 0, 400)).toBe(false);
    const section = fixture.doc.getElementById('apply')!;
    section.className = 'shown';
    section.style.display = 'block';
    expect(await until(fixture.view, fixture.doc, () => looks === 1, 1_500)).toBe(true);
  });

  // jr6 ifix B3 (the integration review's behaviour lens): the company page's watch runs for the document's life, so a
  // class toggled on the body (a scroll class) or on a wrapper that holds a search box (a sticky header) must not cost a
  // full look every 12 s. Fake timers: 60 s of toggles every 100 ms each.
  it('never looks for a class toggled on the body; once for a sticky header holding a search box; again for a form shown (B3)',
    async () => {
      const fixture = await loadFixture(document, `<main><header id="top" class="a"><label for="q">Search jobs</label>
        <input id="q" type="search"></header><section id="apply" style="display:none"><form><input id="n"></form>
        </section><p>News</p></main>`);
      const { doc, view } = fixture;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // The browser's next frame, on the same fake clock (dom/time's timer).
      const frames = new Map<number, () => void>();
      let nextFrameId = 1;
      vi.spyOn(view, 'requestAnimationFrame').mockImplementation((run) => {
        const id = nextFrameId++;
        frames.set(id, startDeadline(16, () => {
          frames.delete(id);
          run(0);
        }));
        return id;
      });
      vi.spyOn(view, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.get(id)?.();
        frames.delete(id);
      });
      let looks = 0;
      const stopped = new AbortController();
      try {
        watchForSiteForm(doc, () => {
          looks += 1;
          return false;
        }, stopped.signal);
        const toggle = async (el: Element) => {
          for (let at = 0; at < 600; at += 1) {
            el.classList.toggle('scrolled');
            await vi.advanceTimersByTimeAsync(100);
          }
        };
        await toggle(doc.body);
        await toggle(doc.documentElement);
        expect(looks).toBe(0);
        await toggle(doc.getElementById('top')!);
        expect(looks).toBe(1);
        // A wrapper drawn hidden and then shown by its style still counts.
        doc.getElementById('apply')!.style.display = 'block';
        await vi.advanceTimersByTimeAsync(15_000);
        expect(looks).toBe(2);
      } finally {
        stopped.abort();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
});
// ── end jr6 apply F2 item 5 ──
