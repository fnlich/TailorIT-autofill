/*
 * jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; FIXPLAN §6.12 item 2, ICIMS-17; ICIMS.md "edit 3"; ENGINE.md edits 3, 4
 * and 16): an iCIMS IForm leaf judged by its portal frame's step facts, on the owner's snapshot6 IForm cases
 * (fixtures/icims/jr6-nyu-iform-signature, jr6-nyu-iform-offer, jr6-sentinel-iform-selfid: each a portal frame-1 that draws
 * the step bar and a leaf frame-2 that holds the form), with the golden synthetic profile and the fake worker:
 * - the doors (dom/fillers/not-submit.ts): with the leaf's facts in the context, its own "Submit" is the step machine's
 *   Next where they say a later form or step follows (NYU's Portal Specific Forms 4/4, step 4 of 5), and the adapter's
 *   Submit, through the Submit exception alone, where they say the last (NYU's Job Specific Forms; sentinel's Portal
 *   Specific Forms); without facts, with two counters, or for any other control, refused as before;
 * - the portal (the tab's claim frame) says its facts to the worker after its hello and again when its page changes
 *   (chain/facts); no other frame says any;
 * - the leaf holds the worker's facts (chain/leafFacts) from the worker alone and only where its portal loaded it (its
 *   referrer a portal of its family); its run presses its "Submit" as Next on the signature form, never on a final form,
 *   and never without facts.
 * The forms' own posts are cancelled in the tests (nothing leaves the page). Nothing here reads or prints a value of the
 * snapshots: the facts are page structure, the answers the golden profile's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationOf } from '../adapters';
import { icimsAdapter } from '../adapters/icims';
import type { Adapter, ChainStepFacts } from '../adapters/types';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { assertNotSubmit, submitPressAllowed } from '../dom/fillers/not-submit';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { claimFrameFacts, holdChainFacts, chainFactsOf, loadedByPortal, CHAIN_FACTS_RETRY_MS } from './chain-frame';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const PAGES = import.meta.glob(['../../fixtures/icims/jr6-nyu-iform-*.html', '../../fixtures/icims/jr6-sentinel-iform-*.html'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ROUTES = import.meta.glob(['../../fixtures/icims/jr6-nyu-iform-*.routes.json',
  '../../fixtures/icims/jr6-sentinel-iform-*.routes.json'], { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case: its markup and its address (its route map's). */
function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? '', address };
}

/** Loads a page at its own address (a <base>, so its links read as the page's). */
async function load(name: string) {
  const { html, address } = fileOf(name);
  if (html === '' || address === '') throw new Error(`no fixture ${name}`);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return { ...fixture, address };
}

/** What each portal's bar says (the ICIMS package's reading, src/adapters/icims/jr6-icims.browser.test.ts ICIMS-17). */
const SIGNATURE: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false, packet: { n: 4, m: 4 },
  counters: 1 };
const OFFER: ChainStepFacts = { stepId: 'Step_perJobSubmittalFormsStep', lastStep: true, packet: null, counters: 0 };
const SELFID: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, packet: null, counters: 0 };

/** The leaf's root and its Submit as the adapter finds them (the first shown copy), and the other controls of its form. */
function leafOf(doc: Document) {
  const root = icimsAdapter.detect(doc)!.formRoot;
  const [button, copy] = Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="icims_submit"]'));
  const save = doc.querySelector<HTMLInputElement>('input[name="icims_save"]');
  return { root, button: button!, copy: copy ?? null, save };
}

afterEach(() => removeFixtures(document));

// ---------------------------------------------------------------------------------------------------------------------
// The doors: not-submit.ts with the leaf's facts (ICIMS.md edit 3; ENGINE.md edits 3, 4, 16)
// ---------------------------------------------------------------------------------------------------------------------

describe('not-submit.ts on an IForm leaf, with its portal’s step facts (jr6 SHELL-B, ICIMS-17)', () => {
  it('jr6-nyu-iform-signature.frame-2 (4/4 of step 4 of 5): its Submit is the step machine’s Next, and only with the facts', async () => {
    const leaf = await load('jr6-nyu-iform-signature.frame-2');
    const { root, button, copy, save } = leafOf(leaf.doc);
    const allowed = (facts?: ChainStepFacts | null, allowNext = true) => assertNotSubmit(button, { adapter: icimsAdapter,
      root, ...(allowNext ? { allowNext: true } : {}), ...(facts === undefined ? {} : { facts }) });
    expect(allowed(SIGNATURE)).toEqual({ ok: true });
    // Unknown: no facts, null facts, two counters, a counter out of its packet.
    expect(allowed()).toEqual({ ok: false, refusal: 'submit-word' });
    expect(allowed(null)).toEqual({ ok: false, refusal: 'submit-word' });
    expect(allowed({ ...SIGNATURE, counters: 2 })).toEqual({ ok: false, refusal: 'submit-word' });
    expect(allowed({ ...SIGNATURE, packet: { n: 5, m: 4 } })).toEqual({ ok: false, refusal: 'submit-word' });
    // Not the step machine's word: refused.
    expect(allowed(SIGNATURE, false)).toEqual({ ok: false, refusal: 'submit-word' });
    // The last form of the last step: the adapter's Submit, never Next.
    expect(allowed({ ...SIGNATURE, lastStep: true })).toEqual({ ok: false, refusal: 'adapter-submit' });
    // Its other copy and "Save & Return Later" stay refused, facts or not.
    if (copy !== null) {
      expect(assertNotSubmit(copy, { adapter: icimsAdapter, root, allowNext: true, facts: SIGNATURE }).ok).toBe(false);
    }
    if (save !== null) {
      expect(assertNotSubmit(save, { adapter: icimsAdapter, root, allowNext: true, facts: SIGNATURE }).ok).toBe(false);
    }
    // Not a final step: the Submit exception opens nothing.
    expect(submitPressAllowed(button, icimsAdapter, root, SIGNATURE)).toBe(false);
  });

  it.each([['jr6-nyu-iform-offer.frame-2', OFFER], ['jr6-sentinel-iform-selfid.frame-2', SELFID]] as const)(
    '%s (the last step): its Submit is the adapter’s Submit, through the Submit exception alone, and only with the facts',
    async (name, facts) => {
      const leaf = await load(name);
      const { root, button } = leafOf(leaf.doc);
      expect(submitPressAllowed(button, icimsAdapter, root, facts)).toBe(true);
      expect(submitPressAllowed(button, icimsAdapter, root)).toBe(false);
      expect(submitPressAllowed(button, icimsAdapter, root, null)).toBe(false);
      expect(submitPressAllowed(button, icimsAdapter, root, { ...facts, packet: { n: 1, m: 2 }, counters: 1 })).toBe(false);
      // Never the step machine's Next: the adapter's Submit, whatever the flags.
      expect(assertNotSubmit(button, { adapter: icimsAdapter, root, allowNext: true, facts }))
        .toEqual({ ok: false, refusal: 'adapter-submit' });
      // An earlier form of the packet: Next.
      expect(assertNotSubmit(button, { adapter: icimsAdapter, root, allowNext: true,
        facts: { ...facts, packet: { n: 1, m: 2 }, counters: 1 } })).toEqual({ ok: true });
    });

  it('takes the leaf’s own form as the later step only where it is the button’s own form and the step’s root, with facts', async () => {
    const leaf = await load('jr6-nyu-iform-signature.frame-2');
    const { root, button } = leafOf(leaf.doc);
    const declared = icimsAdapter.stepSubmitNext!;
    const lying = (laterStep: (doc: Document) => Element | null): Adapter => ({ ...icimsAdapter,
      stepSubmitNext: { buttons: declared.buttons, laterStep } });
    const other = leaf.doc.createElement('form');
    other.textContent = 'Another form';
    leaf.doc.body.append(other);
    const check = (adapter: Adapter, at: Element = root) =>
      assertNotSubmit(button, { adapter, root: at, allowNext: true, facts: SIGNATURE });
    // Another form, though shown, holding nothing of the button: not its sign (the rule for a later step apart from the
    // button still holds it: shown and apart).
    expect(check(lying(() => other))).toEqual({ ok: true });
    other.style.display = 'none';
    expect(check(lying(() => other))).toEqual({ ok: false, refusal: 'submit-word' });
    // The button itself, an element inside the form around it, or the document: refused.
    expect(check(lying(() => button))).toEqual({ ok: false, refusal: 'submit-word' });
    expect(check(lying(() => leaf.doc.body))).toEqual({ ok: false, refusal: 'submit-word' });
    const holder = button.parentElement!;
    expect(holder).not.toBe(root);
    expect(check(lying(() => holder))).toEqual({ ok: false, refusal: 'submit-word' });
    // The adapter's own answer: the button's form, which is the root.
    expect(check(icimsAdapter)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The content side's pieces (chain-frame.ts)
// ---------------------------------------------------------------------------------------------------------------------

describe('chain-frame.ts: the claim frame’s facts and the leaf’s hold (jr6 SHELL-B)', () => {
  const LEAF = 'https://nyu.icims.com/forms?module=Forms&action=showForm&isPacket=1';
  it('holds facts only in an IForm leaf its portal loaded: a subframe at a forms address, referred by its family’s portal', () => {
    const portal = 'https://uscareers-nyu.icims.com/';
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: portal })).toBe(true);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: 'https://uscareers-nyu.icims.com/jobs/16462/x/form' }))
      .toBe(true);
    // Its own form's post, a link of its own: its own address.
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: LEAF })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: 'https://nyu.icims.com/' })).toBe(false);
    // Another company's portal, another platform, none, http, a top frame, a page that is no leaf.
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: 'https://careers-sentinel.icims.com/' })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: 'https://jobs.lever.co/acme' })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: '' })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: LEAF, referrer: 'http://uscareers-nyu.icims.com/' })).toBe(false);
    expect(loadedByPortal({ isTop: true, href: LEAF, referrer: portal })).toBe(false);
    expect(loadedByPortal({ isTop: false, href: 'https://uscareers-nyu.icims.com/jobs/16462/x/form?in_iframe=1',
      referrer: portal })).toBe(false);
    const doc = document.implementation.createHTMLDocument('leaf');
    expect(holdChainFacts(doc, SIGNATURE, { isTop: false, href: LEAF, referrer: LEAF })).toBe(false);
    expect(chainFactsOf(doc)).toBeNull();
    expect(holdChainFacts(doc, SIGNATURE, { isTop: false, href: LEAF, referrer: portal })).toBe(true);
    expect(chainFactsOf(doc)).toEqual(SIGNATURE);
    // Null clears; facts its portal did not load it for clear too.
    expect(holdChainFacts(doc, null, { isTop: false, href: LEAF, referrer: portal })).toBe(true);
    expect(chainFactsOf(doc)).toBeNull();
    holdChainFacts(doc, SIGNATURE, { isTop: false, href: LEAF, referrer: portal });
    holdChainFacts(doc, OFFER, { isTop: false, href: LEAF, referrer: LEAF });
    expect(chainFactsOf(doc)).toBeNull();
  });

  it('reads facts only on a claim frame with no form, as ids, a boolean and counts', async () => {
    const portal = await load('jr6-nyu-iform-signature.frame-1');
    const at = new URL(portal.address);
    const icims = () => [icimsAdapter];
    expect(claimFrameFacts(portal.doc, at, icims, true, false)).toEqual(SIGNATURE);
    expect(claimFrameFacts(portal.doc, at, icims, false, false)).toBeNull();
    expect(claimFrameFacts(portal.doc, at, icims, true, true)).toBeNull();
    expect(claimFrameFacts(portal.doc, null, icims, true, false)).toBeNull();
    const saying = (facts: unknown): Adapter => ({ ...icimsAdapter, chainStepFacts: () => facts as ChainStepFacts });
    // A hook that throws, two that disagree, or words that are no step id: none.
    expect(claimFrameFacts(portal.doc, at, () => [{ ...icimsAdapter, chainStepFacts: () => {
      throw new Error('broken');
    } }], true, false)).toBeNull();
    expect(claimFrameFacts(portal.doc, at, () => [icimsAdapter, saying(OFFER)], true, false)).toBeNull();
    expect(claimFrameFacts(portal.doc, at, () => [icimsAdapter, saying(SIGNATURE)], true, false)).toEqual(SIGNATURE);
    expect(claimFrameFacts(portal.doc, at, () => [saying({ ...SIGNATURE, stepId: 'Step_Alex Rivera' })], true, false))
      .toBeNull();
    expect(claimFrameFacts(portal.doc, at, () => [saying({ ...SIGNATURE, counters: 1000 })], true, false)).toBeNull();
    expect(claimFrameFacts(portal.doc, at, () => [saying({ ...SIGNATURE, extra: 'x' })], true, false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The runtime: the portal says its facts, the leaf's run judges its Submit by them
// ---------------------------------------------------------------------------------------------------------------------

/** The content settings a scripted hello answers (the fake worker's own shape, content.testkit.ts createFakeWorker). */
const HELLO_SETTINGS = { panel: CAUTIOUS_SETTINGS.panel, modes: { next: CAUTIOUS_SETTINGS.modes.next,
  afterPageTurn: CAUTIOUS_SETTINGS.modes.afterPageTurn, submit: CAUTIOUS_SETTINGS.modes.submit,
  agentSkip: CAUTIOUS_SETTINGS.modes.agentSkip, signIn: CAUTIOUS_SETTINGS.modes.signIn },
llm: { ...CAUTIOUS_SETTINGS.llm }, offerToSaveAnswers: CAUTIOUS_SETTINGS.offerToSaveAnswers };
const hello = (frameId: number, applicationKey?: string) => ({ ok: true, data: { frameId, connected: true,
  settings: HELLO_SETTINGS, ...(applicationKey === undefined ? {} : { chained: { applicationKey } }) } });
/** Next on Auto: the step machine presses Next itself; Submit stays the person's. */
const AUTO_NEXT = { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const,
  submit: 'manual' as const } };
const done = { ok: true, data: {} };

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
});

describe('the claim frame says its step facts (jr6 SHELL-B, chain/facts)', () => {
  it('jr6-nyu-iform-signature.frame-1 as the tab’s top frame: after its hello, then at each change of its page', async () => {
    const portal = await load('jr6-nyu-iform-signature.frame-1');
    const worker = createFakeWorker({ script: { 'chain/facts': [done, done, done, done] } as never });
    const runtime = await startContentRuntime(worker.platform, portal.doc, { href: () => portal.address, isTop: true,
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await expect.poll(() => worker.of('chain/facts').length).toBe(1);
    const types = worker.messages.map((message) => message.type);
    expect(types.indexOf('frame/hello')).toBeLessThan(types.indexOf('chain/facts'));
    expect(worker.of('chain/facts')[0]).toEqual({ v: 1, type: 'chain/facts', facts: SIGNATURE });
    // The page draws another counter: said again; then a later step hidden (no facts): said as none.
    const badge = portal.doc.querySelector('.iCIMS_PageStepText .iCIMS_Badge')!;
    badge.textContent = '3/4';
    await expect.poll(() => worker.of('chain/facts').length).toBe(2);
    expect(worker.of('chain/facts')[1]).toMatchObject({ facts: { ...SIGNATURE, packet: { n: 3, m: 4 } } });
    (portal.doc.querySelector('li#Step_perJobSubmittalFormsStep') as HTMLElement).style.display = 'none';
    await expect.poll(() => worker.of('chain/facts').length).toBe(3);
    expect(worker.of('chain/facts')[2]).toMatchObject({ facts: null });
    // A change that leaves them as they were says nothing.
    portal.doc.body.append(portal.doc.createElement('p'));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(worker.of('chain/facts')).toHaveLength(3);
    // Ids, a boolean and counts alone.
    expect(JSON.stringify(worker.of('chain/facts'))).not.toMatch(/https?:|icims\.com|Portal Specific/);
  });

  it('as the subframe that claims its wrapper’s application, too; a frame that claims nothing says none', async () => {
    const portal = await load('jr6-nyu-iform-signature.frame-1');
    const wrapperAddress = portal.address.replace(/&in_iframe=1$/, '');
    const wrapper = await loadFixture(document, '<!doctype html><body><iframe id="icims_content_iframe"></iframe></body>');
    const frame = wrapper.doc.getElementById('icims_content_iframe');
    const worker = createFakeWorker({ script: { 'frame/hello': [hello(5), hello(5)], 'chain/facts': [done, done] } as never });
    const runtime = await startContentRuntime(worker.platform, portal.doc, { href: () => portal.address, isTop: false,
      ancestors: () => [], wrapper: () => ({ doc: wrapper.doc, href: wrapperAddress, frame }),
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(worker.of('frame/hello')[0]).toMatchObject({ claimed: true, hasForm: false });
    await expect.poll(() => worker.of('chain/facts').length).toBe(1);
    expect(worker.of('chain/facts')[0]).toMatchObject({ facts: SIGNATURE });
    removeFixtures(document);
    const alone = await load('jr6-nyu-iform-signature.frame-1');
    const silent = createFakeWorker({ script: { 'chain/facts': [done] } as never });
    runtimes.push(await startContentRuntime(silent.platform, alone.doc, { href: () => alone.address, isTop: false,
      ancestors: () => [], adapters: () => [icimsAdapter], settle: { quietMs: 40 } }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(silent.of('frame/hello').length).toBeGreaterThan(0);
    expect(silent.of('chain/facts')).toEqual([]);
  });

  it('says them again when the worker refused them (its claim unsure for a moment), at most a few times', async () => {
    const portal = await load('jr6-nyu-iform-signature.frame-1');
    const refused = { ok: false, error: 'expired' };
    const worker = createFakeWorker({ script: { 'chain/facts': [refused, done] } as never });
    runtimes.push(await startContentRuntime(worker.platform, portal.doc, { href: () => portal.address, isTop: true,
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } }));
    await expect.poll(() => worker.of('chain/facts').length).toBe(1);
    await expect.poll(() => worker.of('chain/facts').length, { timeout: CHAIN_FACTS_RETRY_MS + 3_000 }).toBe(2);
    expect(worker.of('chain/facts')[1]).toMatchObject({ facts: SIGNATURE });
    await new Promise((resolve) => setTimeout(resolve, CHAIN_FACTS_RETRY_MS + 500));
    expect(worker.of('chain/facts')).toHaveLength(2);
  });

  it('says nothing from a leaf, or from a step page that holds its own form and bar', async () => {
    for (const name of ['jr6-nyu-iform-signature.frame-2', 'jr6-sentinel-iform-selfid.frame-2']) {
      const page = await load(name);
      const worker = createFakeWorker({ script: { 'chain/facts': [done] } as never });
      runtimes.push(await startContentRuntime(worker.platform, page.doc, { href: () => page.address, isTop: true,
        adapters: () => [icimsAdapter], settle: { quietMs: 40 } }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(worker.of('chain/facts'), name).toEqual([]);
      removeFixtures(document);
    }
  });
});

describe('the IForm leaf’s run judges its Submit by the facts the worker hands it (jr6 SHELL-B, chain/leafFacts)', () => {
  /** The leaf frame of a case started as a chain subframe the worker keyed (its portal's application), its form's own
   *  post cancelled; `referrer` as Chrome gives it (its portal's origin: the portal loaded it). */
  async function leafRun(name: string, referrer?: string) {
    testVocab();
    const leaf = await load(`${name}.frame-2`);
    const portalAddress = fileOf(`${name}.frame-1`).address;
    const key = applicationOf(new URL(portalAddress))!.applicationKey;
    const { button, root } = leafOf(leaf.doc);
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    root.addEventListener('submit', (event) => event.preventDefault());
    const worker = createFakeWorker({ settings: AUTO_NEXT,
      script: { 'frame/hello': [hello(3, key), hello(3), hello(3), hello(3)] } as never });
    const runtime = await startContentRuntime(worker.platform, leaf.doc, { href: () => leaf.address, isTop: false,
      ancestors: () => [], referrer: () => referrer ?? `${new URL(portalAddress).origin}/`, adapters: () => [icimsAdapter],
      settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await expect.poll(() => runtime.page?.app.applicationKey ?? null).toBe(key);
    return { leaf, worker, runtime, clicked, button, key };
  }

  it('jr6-nyu-iform-signature (4/4 of step 4 of 5): its run presses the leaf’s Submit as Next, once the facts are held', async () => {
    const { worker, runtime, clicked, leaf } = await leafRun('jr6-nyu-iform-signature');
    expect(await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts: SIGNATURE })).toEqual(done);
    expect(chainFactsOf(leaf.doc)).toEqual(SIGNATURE);
    void runtime.fill();
    await expect.poll(() => clicked.mock.calls.length, { timeout: 15_000 }).toBe(1);
  });

  it('presses nothing without facts, with facts it may not hold, or with facts that say nothing certain', async () => {
    const cases: Array<{ facts?: ChainStepFacts; referrer?: string; from?: 'page'; answer: unknown }> = [
      { answer: null },
      // The leaf posted its own form (its own address its referrer): the portal's counter speaks of the form it framed.
      { facts: SIGNATURE, referrer: 'https://nyu.icims.com/forms?module=Forms', answer: { ok: false, error: 'expired' } },
      // From one of the extension's pages, not the worker.
      { facts: SIGNATURE, from: 'page', answer: { ok: false, error: 'bad_sender' } },
      // Two counters on the portal: the leaf's form cannot be told.
      { facts: { ...SIGNATURE, counters: 2, packet: null }, answer: done },
    ];
    for (const each of cases) {
      const { worker, runtime, clicked } = await leafRun('jr6-nyu-iform-signature', each.referrer);
      if (each.facts !== undefined) {
        const message = { v: 1, type: 'chain/leafFacts', facts: each.facts };
        const answer = each.from === 'page'
          ? await worker.platform.deliverFrom(message, { id: worker.platform.runtime.id,
            url: `chrome-extension://${worker.platform.runtime.id}/sidepanel.html` })
          : await worker.platform.deliver(message);
        expect(answer).toEqual(each.answer);
      }
      await runtime.fill();
      expect(clicked, JSON.stringify(each)).not.toHaveBeenCalled();
      expect(worker.reports.at(-1)?.status).toBe('review');
      for (const running of runtimes.splice(0)) running.stop();
      removeFixtures(document);
    }
  });

  it.each([['jr6-sentinel-iform-selfid', SELFID]] as const)(
    '%s (the last step): its run never presses the leaf’s Submit as Next; the final Submit is the Submit gates’', async (name, facts) => {
      const { worker, runtime, clicked } = await leafRun(name);
      expect(await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts })).toEqual(done);
      await runtime.fill();
      expect(clicked).not.toHaveBeenCalled();
      expect(worker.reports.at(-1)?.status).toBe('review');
    });

  it('takes the facts the worker clears or replaces: none held, nothing pressed', async () => {
    const { worker, runtime, clicked, leaf } = await leafRun('jr6-nyu-iform-signature');
    await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts: SIGNATURE });
    expect(await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts: null })).toEqual(done);
    expect(chainFactsOf(leaf.doc)).toBeNull();
    await runtime.fill();
    expect(clicked).not.toHaveBeenCalled();
  });
});
