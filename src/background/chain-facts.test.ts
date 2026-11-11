/*
 * jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; FIXPLAN §6.12 item 2, ICIMS-17): the worker's half of the step facts, in
 * the real worker (index.ts's chain/facts and hello wiring, background/chain.ts factsSaid, leafChained and forgetTab),
 * over WXT's fake browser. The tab's claim frame, an iCIMS portal page that frames an IForm, says its step bar's facts;
 * the worker keeps them for that frame's document (storage.session, no address) and hands them (chain/leafFacts) to the
 * leaf frames chained from it in the same tab: at once, and to a leaf chained later only while that portal document
 * still answers. Any other frame, document, tab or a private tab: refused, nothing kept, nothing handed. A closed tab's
 * facts go with it. Addresses have the shapes of the owner's snapshots (core-x-worker.test.ts's); every per-person value
 * is a placeholder. The content halves are src/content/jr6-chain-facts.browser.test.ts's.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ChainStepFacts } from '../adapters/types';
import { CHAIN_FACTS_PREFIX } from './chain';
import { FRAME_PROBE_TIMEOUT_MS } from './frames';
import { contentSender, NO_RECEIVER, startTestWorker, tokenRecord, typeOfSent, type TestWorker } from './worker.testkit';
import type { TabMessage } from '../platform/fake';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const OTHER_TAB = 8;
const ICIMS_WRAPPER = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1';
const ICIMS_PORTAL = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1&in_iframe=1';
const ICIMS_FORMS = 'https://edgewaterit.icims.com/forms?module=Forms&action=showForm&form=F&user=USER&item=1&token=T&in_iframe=1&step=1';

/** What a portal's bar says on NYU's signature form (4/4 of step 4 of 5), as the content tests read it. */
const SIGNATURE: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false, packet: { n: 4, m: 4 },
  counters: 1 };

/** A frame of the tab: its address (the tab's too for a top frame), its frame and document ids. */
function frame(url: string, frameId: number, documentId: string, tabId = TAB, incognito = false) {
  return contentSender({ url, tab: { id: tabId, url: frameId === 0 ? url : ICIMS_WRAPPER, ...(incognito ? { incognito } : {}) },
    frameId, documentId });
}

type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };
const hello = (worker: TestWorker, sender: ReturnType<typeof frame>, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender) as
    Promise<Answer>;
const say = (worker: TestWorker, sender: ReturnType<typeof frame>, facts: ChainStepFacts | null) =>
  worker.deliver({ v: 1, type: 'chain/facts', facts }, sender) as Promise<Answer>;
const asks = { isTop: false, chain: { frame: true } };

/** The chain/leafFacts the worker sent: where, and what. */
const handed = (worker: TestWorker) => worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'chain/leafFacts')
  .map((sent) => ({ tabId: sent.tabId, options: sent.options, facts: (sent.message as { facts: unknown }).facts }));

/** Lets the worker's unawaited handing (leafChained after a hello) run to its end. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** How frames answer: the leaf documents take the facts; the portal's documents answer a ping themselves unless `gone`
 *  (no receiving end) or `silent` (no answer at all). */
function frames(worker: TestWorker, portal: { gone?: Set<string>; silent?: Set<string> } = {}): void {
  worker.fakes.frameAnswers = (sent: TabMessage) => {
    const doc = sent.options?.documentId;
    if (doc !== undefined && portal.gone?.has(doc)) throw new Error(NO_RECEIVER);
    if (doc !== undefined && portal.silent?.has(doc)) return new Promise(() => undefined);
    return typeOfSent(sent) === 'frame/ping' ? { ok: true, data: { pong: true } } : { ok: true, data: {} };
  };
}

/** A top portal page that frames the IForm itself (frame 0, no form), and its leaf (frame 5) chained from it. */
async function topPortal(worker: TestWorker, documentId = 'doc-portal-top', tabId = TAB): Promise<ReturnType<typeof frame>> {
  const portal = frame(ICIMS_PORTAL, 0, documentId, tabId);
  expect((await hello(worker, portal, { hasForm: false })).ok).toBe(true);
  return portal;
}
async function leaf(worker: TestWorker, documentId = 'doc-forms', tabId = TAB): Promise<ReturnType<typeof frame>> {
  const sender = frame(ICIMS_FORMS, 5, documentId, tabId);
  expect((await hello(worker, sender, asks)).data?.chained).toBeDefined();
  return sender;
}

/** storage.session's kept facts, as text. */
async function keptFacts(): Promise<Record<string, unknown>> {
  const all = await fakeBrowser.storage.session.get(null);
  return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(CHAIN_FACTS_PREFIX)));
}

describe('the claim frame’s step facts, kept and handed to its leaf (jr6 SHELL-B, ICIMS-17)', () => {
  it('hands them at once to the leaf chained from the claim frame, at its document, and keeps them with no address', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    frames(worker);
    const portal = await topPortal(worker);
    await leaf(worker);
    expect(await say(worker, portal, SIGNATURE)).toEqual({ ok: true, data: {} });
    expect(handed(worker)).toEqual([{ tabId: TAB, options: { frameId: 5, documentId: 'doc-forms' }, facts: SIGNATURE }]);
    const kept = await keptFacts();
    expect(Object.keys(kept)).toEqual([`${CHAIN_FACTS_PREFIX}${TAB}:0`]);
    expect(kept[`${CHAIN_FACTS_PREFIX}${TAB}:0`]).toMatchObject({ documentId: 'doc-portal-top', facts: SIGNATURE });
    // Ids, a boolean and counts: never an address, a host, a token or the person's iCIMS id.
    expect(JSON.stringify(kept)).not.toMatch(/https?:|icims\.com|USER|token=/i);
    // Null clears what the leaf holds.
    expect(await say(worker, portal, null)).toEqual({ ok: true, data: {} });
    expect(handed(worker).at(-1)).toEqual({ tabId: TAB, options: { frameId: 5, documentId: 'doc-forms' }, facts: null });
  });

  it('takes them from the frame that claims a wrapper’s application, too, and hands them to its leaf only', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    frames(worker);
    const wrapper = frame(ICIMS_WRAPPER, 0, 'doc-wrapper');
    await hello(worker, wrapper, { hasForm: false, wraps: true });
    const portal = frame(ICIMS_PORTAL, 3, 'doc-portal');
    expect((await hello(worker, portal, { isTop: false, hasForm: false, claimed: true })).ok).toBe(true);
    await leaf(worker);
    // Another tab's leaf of the same company, chained from its own portal there.
    await topPortal(worker, 'doc-other-portal', OTHER_TAB);
    await leaf(worker, 'doc-other-forms', OTHER_TAB);
    expect(await say(worker, portal, SIGNATURE)).toEqual({ ok: true, data: {} });
    expect(handed(worker)).toEqual([{ tabId: TAB, options: { frameId: 5, documentId: 'doc-forms' }, facts: SIGNATURE }]);
  });

  it('refuses them from any other frame, document or a private tab: nothing kept, nothing handed', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    frames(worker);
    const wrapper = frame(ICIMS_WRAPPER, 0, 'doc-wrapper');
    await hello(worker, wrapper, { hasForm: false, wraps: true });
    await hello(worker, frame(ICIMS_PORTAL, 3, 'doc-portal'), { isTop: false, hasForm: false, claimed: true });
    const forms = await leaf(worker);
    const refused = { ok: false, error: 'expired' };
    // The wrapper (it defers to the frame it claims for), the leaf itself, the claim frame's earlier document.
    expect(await say(worker, wrapper, SIGNATURE)).toEqual(refused);
    expect(await say(worker, forms, SIGNATURE)).toEqual(refused);
    expect(await say(worker, frame(ICIMS_PORTAL, 3, 'doc-portal-old'), SIGNATURE)).toEqual(refused);
    // A frame of the tab that claims nothing.
    await hello(worker, frame(ICIMS_PORTAL, 9, 'doc-unclaimed'), { isTop: false, hasForm: false });
    expect(await say(worker, frame(ICIMS_PORTAL, 9, 'doc-unclaimed'), SIGNATURE)).toEqual(refused);
    // The claim frame of a private tab.
    expect((await say(worker, frame(ICIMS_PORTAL, 3, 'doc-portal', TAB, true), SIGNATURE)).ok).toBe(false);
    // The claim (top) frame of another site's application, whose pages frame no chain pages (Lever's).
    const lever = contentSender({ tab: { id: OTHER_TAB }, frameId: 0, documentId: 'doc-lever' });
    expect((await hello(worker, lever)).ok).toBe(true);
    expect(await say(worker, lever, SIGNATURE)).toEqual(refused);
    expect(handed(worker)).toEqual([]);
    expect(await keptFacts()).toEqual({});
  });

  it('hands the kept facts to a leaf chained later, once the portal document still answers itself', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    frames(worker);
    const portal = await topPortal(worker);
    expect(await say(worker, portal, SIGNATURE)).toEqual({ ok: true, data: {} });
    expect(handed(worker)).toEqual([]);
    await leaf(worker);
    await settle();
    expect(handed(worker)).toEqual([{ tabId: TAB, options: { frameId: 5, documentId: 'doc-forms' }, facts: SIGNATURE }]);
    // The same leaf document saying hello again is not handed them twice.
    await leaf(worker);
    await settle();
    expect(handed(worker)).toHaveLength(1);
    // The leaf's next document (its own post) is handed them again: its content side decides whether it may hold them.
    await leaf(worker, 'doc-forms-2');
    await settle();
    expect(handed(worker).at(-1)).toEqual({ tabId: TAB, options: { frameId: 5, documentId: 'doc-forms-2' },
      facts: SIGNATURE });
  });

  it('hands nothing to a later leaf when the portal document is gone, silent, or said them in an earlier document', async () => {
    // Gone: no receiving end for the portal's document.
    const gone = await startTestWorker({ token: tokenRecord() });
    frames(gone, { gone: new Set(['doc-portal-top']) });
    await say(gone, await topPortal(gone), SIGNATURE);
    await leaf(gone);
    await settle();
    expect(handed(gone)).toEqual([]);

    // Silent: no answer within the probe's time.
    const silent = await startTestWorker({ token: tokenRecord() });
    frames(silent, { silent: new Set(['doc-portal-top']) });
    await say(silent, await topPortal(silent), SIGNATURE);
    await leaf(silent);
    await settle();
    silent.timers.advance(FRAME_PROBE_TIMEOUT_MS);
    await settle();
    expect(handed(silent)).toEqual([]);

    // Said by the frame's earlier document: the portal page loaded another since and said nothing yet.
    const reloaded = await startTestWorker({ token: tokenRecord() });
    frames(reloaded);
    await say(reloaded, await topPortal(reloaded, 'doc-portal-top'), SIGNATURE);
    await topPortal(reloaded, 'doc-portal-top-2');
    await leaf(reloaded);
    await settle();
    expect(handed(reloaded)).toEqual([]);
  });

  it('forgets a closed tab’s facts with its chain', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    frames(worker);
    await say(worker, await topPortal(worker), SIGNATURE);
    expect(Object.keys(await keptFacts())).toHaveLength(1);
    await fakeBrowser.tabs.onRemoved.trigger(TAB, { windowId: 1, isWindowClosing: false });
    await settle();
    expect(await keptFacts()).toEqual({});
  });
});
