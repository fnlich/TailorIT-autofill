/*
 * jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5 items 1 to 3): the content halves of the iCIMS leaf's chain, on the owner's
 * snapshot6 IForm cases already in the repository (fixtures/icims/jr6-sentinel-iform-selfid: a final IForm, its portal
 * frame-1 and its leaf frame-2; jr6-nyu-iform-signature: 4/4 of step 4 of 5, not final), with the golden synthetic
 * profile and the fake worker:
 * - ICIMS7-01: the claim frame names its forms frames' origins (declaredChildOrigins, from Adapter.chainChildOrigins,
 *   which ICIMS-7 implements: here a stand-in hook); a leaf whose referrer is its parent's origin, another iCIMS host,
 *   is loaded by its portal (snapshot7's arc-onesolutions → oneblood shape, synthetic addresses);
 * - ICIMS7-V1: the leaf tells the worker once per document that its form's Submit was pressed (watchLeafPress,
 *   chain/pressed); and a (2/2) leaf judged by (1/2) facts reads not final, by (2/2) facts final (the verifier's
 *   STALE/FRESH probe, on the sentinel's leaf: snapshot7's jr7-icims1-iform-2 is ICIMS-7's fixture);
 * - ICIMS7-V2: the leaf's adapter is read through the facts it holds (leafAdapter): the person's own Next during a
 *   step's wait (transition.ts) and the person's own final Submit (runtime.ts, submit/armed) are seen.
 * The forms' own posts are cancelled (nothing leaves the page). Nothing here reads or prints a value of the snapshots.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { applicationOf } from '../adapters';
import { icimsAdapter } from '../adapters/icims';
import type { Adapter, ChainStepFacts } from '../adapters/types';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { deadline } from '../dom/time';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { chainFactsOf, declaredChildOrigins, holdChainFacts, leafAdapter, loadedByPortal, parentOriginOf,
  watchLeafPress } from './chain-frame';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { awaitTransition } from './transition';

const PAGES = import.meta.glob(['../../fixtures/icims/jr6-nyu-iform-signature*.html',
  '../../fixtures/icims/jr6-sentinel-iform-selfid*.html'], { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const ROUTES = import.meta.glob(['../../fixtures/icims/jr6-nyu-iform-signature.routes.json',
  '../../fixtures/icims/jr6-sentinel-iform-selfid.routes.json'], { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? '', address };
}

async function load(name: string) {
  const { html, address } = fileOf(name);
  if (html === '' || address === '') throw new Error(`no fixture ${name}`);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return { ...fixture, address };
}

/** The person's own click on `element` in a fixture's frame: trusted, at its middle, once it is scrolled into view. */
async function personClicks(frame: HTMLIFrameElement, element: Element): Promise<void> {
  element.scrollIntoView({ block: 'center' });
  const at = element.getBoundingClientRect();
  await userEvent.click(frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

/** The leaf's root and its Submit as the adapter finds them (the first shown copy). */
function leafOf(doc: Document) {
  const root = icimsAdapter.detect(doc)!.formRoot;
  const button = doc.querySelector<HTMLInputElement>('input[name="icims_submit"]')!;
  return { root, button };
}

/** What the portals' bars say (the jr6 ICIMS package's reading), and a two-form packet's two pages. */
const SELFID: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, packet: null, counters: 0 };
const SIGNATURE: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false, packet: { n: 4, m: 4 },
  counters: 1 };
const FIRST_OF_TWO: ChainStepFacts = { ...SELFID, packet: { n: 1, m: 2 }, counters: 1 };
const SECOND_OF_TWO: ChainStepFacts = { ...SELFID, packet: { n: 2, m: 2 }, counters: 1 };

afterEach(() => removeFixtures(document));

// ── ICIMS7-01 ──
describe('jr7 CHAIN-7 ICIMS7-01: the claim frame’s declared forms origins, and a leaf of another iCIMS host', () => {
  const declaring = (origins: unknown): Adapter => ({ ...icimsAdapter, chainChildOrigins: () => origins as string[] });

  it('names the origins its adapters declare, on the claim frame alone, as origins only', async () => {
    const portal = await load('jr6-sentinel-iform-selfid.frame-1');
    const at = new URL(portal.address);
    const one = () => [declaring(['https://sentinel.icims.com'])];
    expect(declaredChildOrigins(portal.doc, at, one, true)).toEqual(['https://sentinel.icims.com']);
    expect(declaredChildOrigins(portal.doc, at, one, false)).toEqual([]);
    expect(declaredChildOrigins(portal.doc, null, one, true)).toEqual([]);
    // No hook (the jr6 adapter): none. Each once, no address, no other scheme, at most four.
    expect(declaredChildOrigins(portal.doc, at, () => [{ ...icimsAdapter, chainChildOrigins: undefined }], true))
      .toEqual([]);
    expect(declaredChildOrigins(portal.doc, at, () => [declaring(['https://sentinel.icims.com',
      'https://sentinel.icims.com', 'https://sentinel.icims.com/forms?user=U', 'http://sentinel.icims.com', 'x',
      'https://a.icims.com', 'https://b.icims.com', 'https://c.icims.com', 'https://d.icims.com'])], true))
      .toEqual(['https://sentinel.icims.com', 'https://a.icims.com', 'https://b.icims.com', 'https://c.icims.com']);
    // A hook that throws: none at all.
    expect(declaredChildOrigins(portal.doc, at, () => [declaring(['https://sentinel.icims.com']), { ...icimsAdapter,
      chainChildOrigins: () => {
        throw new Error('broken');
      } }], true)).toEqual([]);
  });

  it('says them in the claim frame’s hello; a frame that claims nothing says none', async () => {
    const portal = await load('jr6-sentinel-iform-selfid.frame-1');
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, portal.doc, { href: () => portal.address, isTop: true,
      ancestors: () => [], adapters: () => [declaring(['https://sentinel.icims.com'])] });
    runtimes.push(runtime);
    await expect.poll(() => worker.of('frame/hello').length).toBeGreaterThan(0);
    expect(worker.of('frame/hello')[0]).toMatchObject({ childOrigins: ['https://sentinel.icims.com'] });
    const alone = await load('jr6-sentinel-iform-selfid.frame-1');
    const silent = createFakeWorker();
    runtimes.push(await startContentRuntime(silent.platform, alone.doc, { href: () => alone.address, isTop: false,
      ancestors: () => [], wrapper: () => null, adapters: () => [declaring(['https://sentinel.icims.com'])] }));
    await expect.poll(() => silent.of('frame/hello').length).toBeGreaterThan(0);
    expect(silent.of('frame/hello')[0]).not.toHaveProperty('childOrigins');
  });

  it('a leaf of another iCIMS host is loaded by its portal when its referrer is its parent frame’s origin', () => {
    const LEAF = 'https://acmeblood.icims.com/forms?module=Forms&action=showForm&isPacket=1';
    const PORTAL = 'https://arc-acmeone.icims.com/';
    // As Chrome gives a cross-origin referrer: the portal's origin; its parent's origin (location.ancestorOrigins).
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: PORTAL, parent: 'https://arc-acmeone.icims.com' }))
      .toBe(true);
    expect(loadedByPortal({ isTop: false, href: LEAF,
      referrer: 'https://arc-acmeone.icims.com/jobs/17204/x/form?in_iframe=1', parent: 'https://arc-acmeone.icims.com' }))
      .toBe(true);
    // Without its parent's origin, or a parent of another origin: as before (another family: none).
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: PORTAL })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: PORTAL, parent: null })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: PORTAL, parent: 'https://other.icims.com' })).toBe(false);
    // Its own form's post (its own address), another platform, iCIMS's own hosts, http, a top frame: none.
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: LEAF, parent: 'https://acmeblood.icims.com' }))
      .toBe(false);
    for (const referrer of ['https://jobs.lever.co/', 'https://www.icims.com/', 'https://login.icims.com/',
      'http://arc-acmeone.icims.com/']) {
      expect(loadedByPortal({ isTop: false, href: LEAF, referrer, parent: new URL(referrer).origin }), referrer)
        .toBe(false);
    }
    expect(loadedByPortal({ isTop: true, href: LEAF, referrer: PORTAL, parent: 'https://arc-acmeone.icims.com' }))
      .toBe(false);
    const doc = document.implementation.createHTMLDocument('leaf');
    expect(holdChainFacts(doc, SELFID, { isTop: false, href: LEAF, referrer: PORTAL,
      parent: 'https://arc-acmeone.icims.com' })).toBe(true);
    expect(chainFactsOf(doc)).toEqual(SELFID);
  });

  it('reads its parent’s origin from Chrome’s ancestorOrigins, none where there is none', () => {
    const list = (origins: string[]) => ({ length: origins.length, item: (index: number) => origins[index] ?? null });
    expect(parentOriginOf({ location: { ancestorOrigins: list(['https://a.icims.com', 'https://b.icims.com']) } } as
      unknown as Window)).toBe('https://a.icims.com');
    expect(parentOriginOf({ location: { ancestorOrigins: list([]) } } as unknown as Window)).toBeNull();
    expect(parentOriginOf({ location: {} } as unknown as Window)).toBeNull();
    expect(parentOriginOf(null)).toBeNull();
  });
});

// ── ICIMS7-V1 ──
describe('jr7 CHAIN-7 ICIMS7-V1: the leaf tells its press, and fresh facts decide its last form', () => {
  it('a (2/2) leaf with (1/2) facts is not final, its Submit a Next; with (2/2) facts final, its Submit the Submit',
    async () => {
      const leaf = await load('jr6-sentinel-iform-selfid.frame-2');
      const { root, button } = leafOf(leaf.doc);
      expect(icimsAdapter.isFinalStep!(leaf.doc, FIRST_OF_TWO)).toBe('not-final');
      expect(icimsAdapter.nextButton!(root, FIRST_OF_TWO)).toBe(button);
      expect(icimsAdapter.submitButton!(root, FIRST_OF_TWO)).toBeNull();
      expect(icimsAdapter.isFinalStep!(leaf.doc, SECOND_OF_TWO)).toBe('final');
      expect(icimsAdapter.nextButton!(root, SECOND_OF_TWO)).toBeNull();
      expect(icimsAdapter.submitButton!(root, SECOND_OF_TWO)).toBe(button);
    });

  it('tells once per document: a click on its form’s Submit, its submit, else the document leaving', async () => {
    const leaf = await load('jr6-sentinel-iform-selfid.frame-2');
    const { root, button } = leafOf(leaf.doc);
    root.addEventListener('submit', (event) => event.preventDefault());
    // A page's own handler that sends the form by script: the click is cancelled, no submit event follows.
    button.addEventListener('click', (event) => event.preventDefault());
    const controller = new AbortController();
    const send = vi.fn();
    let active = false;
    watchLeafPress({ view: leaf.doc.defaultView as Window & typeof globalThis, doc: leaf.doc, signal: controller.signal,
      active: () => active, send });
    // Not keyed yet: nothing.
    button.click();
    expect(send).not.toHaveBeenCalled();
    active = true;
    // Another control of the page: nothing.
    const plain = leaf.doc.createElement('button');
    plain.type = 'button';
    root.append(plain);
    plain.click();
    expect(send).not.toHaveBeenCalled();
    button.click();
    expect(send).toHaveBeenCalledTimes(1);
    button.click();
    root.dispatchEvent(new Event('submit', { cancelable: true }));
    leaf.doc.defaultView!.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenCalledTimes(1);
    controller.abort();
    // A form's own submit (a page script's requestSubmit), and the document leaving, on documents that saw no click.
    for (const fire of [(form: Element) => form.dispatchEvent(new Event('submit', { cancelable: true })),
      (form: Element) => form.ownerDocument.defaultView!.dispatchEvent(new Event('pagehide'))]) {
      const other = await load('jr6-sentinel-iform-selfid.frame-2');
      const told = vi.fn();
      const life = new AbortController();
      watchLeafPress({ view: other.doc.defaultView as Window & typeof globalThis, doc: other.doc, signal: life.signal,
        active: () => true, send: told });
      fire(leafOf(other.doc).root);
      expect(told).toHaveBeenCalledTimes(1);
      life.abort();
    }
  });
});

// ── ICIMS7-V2 ──
describe('jr7 CHAIN-7 ICIMS7-V2: the leaf’s adapter read through the facts it holds (leafAdapter)', () => {
  const SENTINEL_PORTAL = 'https://careers-sentinel.icims.com/';

  it('asks every hook with the document’s facts where the caller gives none; only on a leaf', async () => {
    const leaf = await load('jr6-sentinel-iform-selfid.frame-2');
    const { root, button } = leafOf(leaf.doc);
    const view = leafAdapter(icimsAdapter, { isTop: false, href: leaf.address });
    expect(view).not.toBe(icimsAdapter);
    // No facts held: unknown, as before.
    expect(view.isFinalStep!(leaf.doc)).toBe('unknown');
    expect(view.submitButton!(root)).toBeNull();
    holdChainFacts(leaf.doc, SELFID, { isTop: false, href: leaf.address, referrer: SENTINEL_PORTAL });
    expect(view.isFinalStep!(leaf.doc)).toBe('final');
    expect(view.submitButton!(root)).toBe(button);
    expect(view.nextButton!(root)).toBeNull();
    expect(view.stepSubmitNext!.laterStep(leaf.doc)).toBeNull();
    // Facts the caller gives win (SHELL-B's callers), and the raw adapter is unchanged.
    expect(view.isFinalStep!(leaf.doc, FIRST_OF_TWO)).toBe('not-final');
    expect(view.nextButton!(root, FIRST_OF_TWO)).toBe(button);
    expect(icimsAdapter.isFinalStep!(leaf.doc)).toBe('unknown');
    expect(view.id).toBe(icimsAdapter.id);
    // The top frame, a portal page, an unreadable address: the adapter itself.
    expect(leafAdapter(icimsAdapter, { isTop: true, href: leaf.address })).toBe(icimsAdapter);
    expect(leafAdapter(icimsAdapter, { isTop: false, href: fileOf('jr6-sentinel-iform-selfid.frame-1').address }))
      .toBe(icimsAdapter);
    expect(leafAdapter(icimsAdapter, { isTop: false, href: 'not an address' })).toBe(icimsAdapter);
  });

  it('transition.ts sees the person’s own Next on a not-final leaf through the view, never through the raw adapter',
    async () => {
      const leaf = await load('jr6-nyu-iform-signature.frame-2');
      const { root, button } = leafOf(leaf.doc);
      root.addEventListener('submit', (event) => event.preventDefault());
      holdChainFacts(leaf.doc, SIGNATURE, { isTop: false, href: leaf.address, referrer: 'https://uscareers-nyu.icims.com/' });
      const wait = (adapter: Adapter) => awaitTransition({ doc: leaf.doc, adapter, root: () => root,
        signature: () => 'same', from: 'same', capMs: 1_500, watchNext: true, signal: new AbortController().signal,
        settle: { quietMs: 20 } });
      const viewed = wait(leafAdapter(icimsAdapter, { isTop: false, href: leaf.address }));
      await personClicks(leaf.frame, button);
      expect(await viewed).toEqual({ kind: 'unchanged' });
      const raw = wait(icimsAdapter);
      await personClicks(leaf.frame, button);
      expect(await raw).toMatchObject({ kind: 'timed-out' });
    });
});

// ── The runtime: the leaf keyed, its facts held, the person's own final Submit armed and the press told ──
const HELLO_SETTINGS = { panel: CAUTIOUS_SETTINGS.panel, modes: { next: CAUTIOUS_SETTINGS.modes.next,
  afterPageTurn: CAUTIOUS_SETTINGS.modes.afterPageTurn, submit: CAUTIOUS_SETTINGS.modes.submit,
  agentSkip: CAUTIOUS_SETTINGS.modes.agentSkip, signIn: CAUTIOUS_SETTINGS.modes.signIn },
llm: { ...CAUTIOUS_SETTINGS.llm }, offerToSaveAnswers: CAUTIOUS_SETTINGS.offerToSaveAnswers };
const helloAnswer = (frameId: number, applicationKey?: string) => ({ ok: true, data: { frameId, connected: true,
  settings: HELLO_SETTINGS, ...(applicationKey === undefined ? {} : { chained: { applicationKey } }) } });
const done = { ok: true, data: {} };

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
});

describe('jr7 CHAIN-7 on the leaf’s runtime (ICIMS7-V1, ICIMS7-V2)', () => {
  async function leafRuntime() {
    testVocab();
    const leaf = await load('jr6-sentinel-iform-selfid.frame-2');
    const key = applicationOf(new URL(fileOf('jr6-sentinel-iform-selfid.frame-1').address))!.applicationKey;
    const { button, root } = leafOf(leaf.doc);
    root.addEventListener('submit', (event) => event.preventDefault());
    const worker = createFakeWorker({ script: { 'frame/hello': [helloAnswer(5, key), helloAnswer(5), helloAnswer(5)],
      'submit/armed': [done, done], 'chain/pressed': [done, done] } as never });
    const runtime = await startContentRuntime(worker.platform, leaf.doc, { href: () => leaf.address, isTop: false,
      ancestors: () => [], referrer: () => 'https://careers-sentinel.icims.com/', adapters: () => [icimsAdapter] });
    runtimes.push(runtime);
    await expect.poll(() => runtime.page?.app.applicationKey ?? null).toBe(key);
    return { leaf, worker, runtime, button, key };
  }

  it('the person’s trusted click on the final Submit arms it, with the facts held, and tells the press once', async () => {
    const { worker, button, key, leaf, runtime } = await leafRuntime();
    expect(await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts: SELFID })).toEqual(done);
    // The runtime's adapter is the facts-bound view (ICIMS7-V2).
    const { root } = leafOf(leaf.doc);
    expect(runtime.page!.adapter.isFinalStep!(leaf.doc)).toBe('final');
    expect(runtime.page!.adapter.submitButton!(root)).toBe(button);
    await personClicks(leaf.frame, button);
    await expect.poll(() => worker.of('submit/armed').length).toBe(1);
    expect(worker.of('submit/armed')[0]).toMatchObject({ applicationKey: key, by: 'page' });
    await expect.poll(() => worker.of('chain/pressed').length).toBe(1);
    expect(worker.of('chain/pressed')[0]).toEqual({ v: 1, type: 'chain/pressed' });
    await personClicks(leaf.frame, button);
    await deadline(300);
    expect(worker.of('chain/pressed')).toHaveLength(1);
  });

  it('without facts the person’s click arms nothing, and the press is still told', async () => {
    const { worker, button, leaf } = await leafRuntime();
    await personClicks(leaf.frame, button);
    await expect.poll(() => worker.of('chain/pressed').length).toBe(1);
    expect(worker.of('submit/armed')).toHaveLength(0);
  });
});
