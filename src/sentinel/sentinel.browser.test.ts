/*
 * The sentinel at work (v3 Phase 8, and its review: B5, P2, P7): dormant until it recognises the page, one
 * page/recognised then, nothing written to the page at any time, a form the page draws late (however late) and a
 * single-page application's next address both read, each reading at the browser's next frame once its gap is over,
 * and a stop once the worker took it, after its last ask, on the worker's stop, or once the extension is gone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { SENTINEL_MAX_ASKS, SENTINEL_POLL_MS, SENTINEL_SETTLE_MS, startSentinel, type SentinelPlatform } from './index';

const stops: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
  for (const stop of stops.splice(0)) stop();
  removeFixtures(document);
});

const APPLICATION = `<form><label for="n">Full name</label><input id="n" name="name"><label for="e">Email</label>
  <input id="e" type="email"><label for="p">Phone</label><input id="p" type="tel"></form>`;
const COMPANY = 'https://careers.acme.example/apply/1';
const wait = (ms: number) => deadline(ms);
/** Two of the fixture frame's own frames: a reading waiting for one has run. */
const frames = (view: Window) => new Promise<void>((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())));

async function watch(html: string, href: () => string, answer: () => unknown = () => ({ ok: true, data: { injected: true } }),
  options: { isTop?: boolean; platform?: Partial<SentinelPlatform>; fake?: boolean } = {}) {
  const { doc, view, frame } = await loadFixture(document, html);
  const sent: unknown[] = [];
  const writes: MutationRecord[] = [];
  const observer = new MutationObserver((records) => writes.push(...records));
  observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
  // The fake clock is the test's realm's (the sentinel's timers); the fixture frame draws its own frames in real time.
  if (options.fake === true) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  stops.push(startSentinel(doc, { send: async (message) => {
    sent.push(message);
    return answer();
  }, ...options.platform }, { isTop: options.isTop ?? true, href }));
  return { doc, view, frame, sent, writes: () => {
    writes.push(...observer.takeRecords());
    return writes;
  } };
}

/** The page's own script drawing `html` into `parent` (nodes parsed in the test's document, adopted into the page's). */
function draw(doc: Document, parent: Element, html: string): void {
  parent.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes).map((node) => doc.adoptNode(node)));
}

describe('the sentinel', () => {
  it('says nothing on a page it does not recognise, and writes nothing to it', async () => {
    const { sent, writes } = await watch('<!doctype html><p>News</p><form role="search"><input type="search"></form>',
      () => 'https://news.example/');
    await wait(SENTINEL_SETTLE_MS + 100);
    expect(sent).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('sends page/recognised once for a page it recognises, then stops', async () => {
    const { doc, sent, writes } = await watch(`<!doctype html>${APPLICATION}`, () => COMPANY);
    await wait(100);
    expect(sent).toEqual([{ v: 1, type: 'page/recognised', reason: 'application-form' }]);
    draw(doc, doc.body, APPLICATION);
    await wait(SENTINEL_SETTLE_MS + 100);
    expect(sent).toHaveLength(1);
    expect(writes().filter((record) => record.target !== doc.body)).toEqual([]);
  });

  it("reads a form the page draws long after it loaded: the watch lasts the document's life (B5)", async () => {
    const { doc, view, sent } = await watch('<!doctype html><main></main>', () => COMPANY, undefined, { fake: true });
    await vi.advanceTimersByTimeAsync(1);
    await frames(view);
    expect(sent).toEqual([]);
    // Past the 30 seconds the first build watched for.
    await vi.advanceTimersByTimeAsync(31_000);
    draw(doc, doc.querySelector('main')!, APPLICATION);
    await vi.advanceTimersByTimeAsync(1);
    await frames(view);
    expect(sent).toEqual([{ v: 1, type: 'page/recognised', reason: 'application-form' }]);
  });

  it('reads again only at the end of its gap, which doubles with each reading of the same address (P2)', async () => {
    const { doc, view, sent } = await watch('<!doctype html><main></main>', () => COMPANY, undefined, { fake: true });
    await vi.advanceTimersByTimeAsync(1);
    await frames(view);
    // A control that makes nothing of an application: a reading, SENTINEL_SETTLE_MS after the first.
    await vi.advanceTimersByTimeAsync(100);
    draw(doc, doc.querySelector('main')!, '<input type="search">');
    await vi.advanceTimersByTimeAsync(SENTINEL_SETTLE_MS - 150);
    await frames(view);
    await vi.advanceTimersByTimeAsync(100);
    await frames(view);
    // The form, drawn now, is read only twice SENTINEL_SETTLE_MS after that second reading.
    await vi.advanceTimersByTimeAsync(50);
    draw(doc, doc.querySelector('main')!, APPLICATION);
    await vi.advanceTimersByTimeAsync(2 * SENTINEL_SETTLE_MS - 150);
    await frames(view);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    await frames(view);
    expect(sent).toEqual([{ v: 1, type: 'page/recognised', reason: 'application-form' }]);
  });

  it('asks for no reading when the page adds nothing of a form', async () => {
    let reads = 0;
    const { doc, view } = await watch('<!doctype html><main></main>', () => {
      reads += 1;
      return COMPANY;
    }, undefined, { fake: true });
    await vi.advanceTimersByTimeAsync(1);
    await frames(view);
    const before = reads;
    for (let index = 0; index < 5; index += 1) {
      draw(doc, doc.querySelector('main')!, '<p>More news</p><div><span>x</span></div>');
      await vi.advanceTimersByTimeAsync(SENTINEL_SETTLE_MS * 4);
      await frames(view);
    }
    // Only the address poll read the address since; no reading of the page did (a reading reads it once more).
    expect(reads - before).toBe(Math.floor((5 * SENTINEL_SETTLE_MS * 4) / SENTINEL_POLL_MS));
  });

  it("follows a single-page careers site's address to a posting, and asks at most SENTINEL_MAX_ASKS times while refused",
    async () => {
      let href = 'https://www.amazon.jobs/en/search';
      const { sent } = await watch('<!doctype html><main>Careers</main>', () => href, () => ({ ok: false, error: 'rate_limited' }));
      await wait(100);
      expect(sent).toEqual([]);
      for (const id of ['1', '2', '3', '4']) {
        href = `https://www.amazon.jobs/en/jobs/${id}/engineer`;
        await wait(SENTINEL_POLL_MS + 150);
      }
      expect(sent).toHaveLength(SENTINEL_MAX_ASKS);
      expect(sent[0]).toEqual({ v: 1, type: 'page/recognised', reason: 'career-site' });
    }, 15_000);

  it('says nothing on LinkedIn or an employee HR system, even at a page it would recognise elsewhere', async () => {
    for (const href of ['https://www.linkedin.com/jobs/view/4012345678/?gh_jid=1', 'https://acme.myworkday.com/acme/d/home.htmld']) {
      const { sent } = await watch(`<!doctype html>${APPLICATION}`, () => href);
      await wait(SENTINEL_SETTLE_MS + 100);
      expect(sent, href).toEqual([]);
      removeFixtures(document);
    }
  });

  it('does nothing in a subframe or a private tab', async () => {
    const sub = await watch(`<!doctype html>${APPLICATION}`, () => COMPANY, undefined, { isTop: false });
    const incognito = await watch(`<!doctype html>${APPLICATION}`, () => COMPANY, undefined, { platform: { incognito: true } });
    await wait(100);
    expect(sub.sent).toEqual([]);
    expect(incognito.sent).toEqual([]);
  });

  it("stops on the worker's stop, once the extension is gone, and when sending throws (P7)", async () => {
    let stop: (() => void) | null = null;
    let listening = false;
    const told = await watch('<!doctype html><main></main>', () => COMPANY, undefined, { platform: { onStop: (cb) => {
      stop = cb;
      listening = true;
      return () => {
        listening = false;
      };
    } } });
    await wait(100);
    expect(listening).toBe(true);
    stop!();
    expect(listening).toBe(false);
    draw(told.doc, told.doc.querySelector('main')!, APPLICATION);
    await wait(SENTINEL_SETTLE_MS + 100);
    expect(told.sent).toEqual([]);

    let alive = true;
    const gone = await watch('<!doctype html><main></main>', () => COMPANY, undefined, { platform: { alive: () => alive } });
    await wait(100);
    alive = false;
    draw(gone.doc, gone.doc.querySelector('main')!, APPLICATION);
    await wait(SENTINEL_SETTLE_MS + 100);
    expect(gone.sent).toEqual([]);

    let throws = 0;
    const invalidated = await watch(`<!doctype html><main>${APPLICATION}</main>`, () => COMPANY, undefined, { platform: { send: () => {
      throws += 1;
      throw new Error('Extension context invalidated.');
    } } });
    await wait(100);
    draw(invalidated.doc, invalidated.doc.querySelector('main')!, APPLICATION);
    await wait(SENTINEL_SETTLE_MS + 100);
    expect(throws).toBe(1);
  });

  it('reads only at a frame the browser draws: a hidden tab, which draws none, is never read until shown (P2)', async () => {
    const { doc, view } = await loadFixture(document, '<!doctype html><main>Careers</main>');
    // The tab hidden: the browser holds every frame request until it is shown again.
    const held: FrameRequestCallback[] = [];
    view.requestAnimationFrame = (callback) => held.push(callback);
    view.cancelAnimationFrame = () => undefined;
    const sent: unknown[] = [];
    stops.push(startSentinel(doc, { send: async (message) => {
      sent.push(message);
      return { ok: true, data: { injected: true } };
    } }, { isTop: true, href: () => 'https://www.amazon.jobs/en/jobs/1/engineer' }));
    await wait(SENTINEL_SETTLE_MS + 100);
    expect({ sent: sent.length, waiting: held.length }).toEqual({ sent: 0, waiting: 1 });
    for (const callback of held.splice(0)) callback(0);
    await wait(50);
    expect(sent).toEqual([{ v: 1, type: 'page/recognised', reason: 'career-site' }]);
  });
});
