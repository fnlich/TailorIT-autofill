/*
 * jr8 ICIMS r2 (ICIMS-8.md open item 1): the claim frame's word that its page and its wrapper show the forms frame
 * (ChainStepFacts.shown, a boolean beside the step facts) goes through the real worker's relay unchanged: kept with the
 * facts (storage.session, no address) and handed to the leaf chained from the claim frame (chain/leafFacts), as the step
 * facts are (chain-facts.test.ts holds the rest of the relay: who may say them, who hears them, when). Anything else
 * beside the facts is refused (the schema is strict). Addresses have the snapshots' shapes; no value of a person's.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ChainStepFacts } from '../adapters/types';
import { CHAIN_FACTS_PREFIX } from './chain';
import { contentSender, startTestWorker, tokenRecord, typeOfSent, type TestWorker } from './worker.testkit';
import type { TabMessage } from '../platform/fake';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const WRAPPER = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1';
const PORTAL = `${WRAPPER}&in_iframe=1`;
const FORMS = 'https://edgewaterit.icims.com/forms?module=Forms&action=showForm&form=F&user=USER&item=1&token=T&in_iframe=1&step=1';
const SIGNATURE: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false, packet: { n: 4, m: 4 },
  counters: 1 };

const frame = (url: string, frameId: number, documentId: string) => contentSender({ url,
  tab: { id: TAB, url: frameId === 0 ? url : WRAPPER }, frameId, documentId });
const hello = (worker: TestWorker, sender: ReturnType<typeof frame>, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender) as
    Promise<{ ok: boolean; data?: { chained?: unknown } }>;
const handed = (worker: TestWorker) => worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'chain/leafFacts')
  .map((sent) => (sent.message as { facts: unknown }).facts);

async function portalWithLeaf(): Promise<{ worker: TestWorker; portal: ReturnType<typeof frame> }> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.fakes.frameAnswers = (sent: TabMessage) => (typeOfSent(sent) === 'frame/ping'
    ? { ok: true, data: { pong: true } } : { ok: true, data: {} });
  await hello(worker, frame(WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
  const portal = frame(PORTAL, 3, 'doc-portal');
  expect((await hello(worker, portal, { hasForm: false, claimed: true })).ok).toBe(true);
  expect((await hello(worker, frame(FORMS, 5, 'doc-forms'), { isTop: false, chain: { frame: true } })).data?.chained)
    .toBeDefined();
  return { worker, portal };
}

describe('jr8 ICIMS r2: the forms frame\'s word goes through the worker with the step facts', () => {
  it('keeps and hands shown: true, then shown: false, unchanged; refuses any other word beside the facts', async () => {
    const { worker, portal } = await portalWithLeaf();
    const say = (facts: unknown) => worker.deliver({ v: 1, type: 'chain/facts', facts }, portal);
    expect(await say({ ...SIGNATURE, shown: true })).toEqual({ ok: true, data: {} });
    expect(handed(worker).at(-1)).toEqual({ ...SIGNATURE, shown: true });
    const kept = await fakeSession(worker);
    expect(kept[`${CHAIN_FACTS_PREFIX}${TAB}:3`]).toMatchObject({ facts: { ...SIGNATURE, shown: true } });
    expect(JSON.stringify(kept)).not.toMatch(/https?:|icims\.com|USER|token=/i);
    expect(await say({ ...SIGNATURE, shown: false })).toEqual({ ok: true, data: {} });
    expect(handed(worker).at(-1)).toEqual({ ...SIGNATURE, shown: false });
    expect(await say(SIGNATURE)).toEqual({ ok: true, data: {} });
    expect(handed(worker).at(-1)).toEqual(SIGNATURE);
    const before = handed(worker).length;
    expect((await say({ ...SIGNATURE, shown: 'yes' }) as { ok: boolean }).ok).toBe(false);
    expect((await say({ ...SIGNATURE, seen: true }) as { ok: boolean }).ok).toBe(false);
    expect(handed(worker)).toHaveLength(before);
  });
});

/** The facts records in storage.session as they stand. */
async function fakeSession(_worker: TestWorker): Promise<Record<string, unknown>> {
  const all = await fakeBrowser.storage.session.get(null);
  return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(CHAIN_FACTS_PREFIX)));
}
