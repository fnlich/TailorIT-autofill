/*
 * The audit of 2026-11-06 (S-6): nothing of a private (incognito) tab's runs outlives the private session. Its RunState
 * stays in a storage.session record of that tab alone, gone when the tab closes; its launcher drags and hides, its
 * telemetry and its accepted matches are never written.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FieldKey } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { LAUNCHER_KEY } from './launcher';
import { MATCH_CACHE_KEY } from './match-cache';
import type { StorageArea } from '../platform/types';
import { AI_TASKS_KEY } from '../shared/stored';
import { createRunStateStore, PRIVATE_RUN_PREFIX } from './runstate-store';
import { TELEMETRY_COUNTED_KEY, TELEMETRY_KEY } from './telemetry';
import {
  beginRun, contentSender, fieldSpec, frameReport, LEVER_KEY, pageSender, runState, skippedRow, START_MS, startTestWorker,
  TASK_ID, tokenRecord, type TestWorker,
} from './worker.testkit';

/** Batch hashes, as ai-tasks.ts names them. */
const HASH_1 = `pick:${'1'.repeat(32)}`;
const HASH_2 = `pick:${'2'.repeat(32)}`;
/** A frame of a private tab. */
const PRIVATE = contentSender({ tab: { id: 7, incognito: true } });
const local = async () => fakeBrowser.storage.local.get(null);
const session = async () => fakeBrowser.storage.session.get(null);
const closeTab = (tabId: number) => fakeBrowser.tabs.onRemoved.trigger(tabId, { windowId: 1, isWindowClosing: false });

async function privateFrame(options: Parameters<typeof startTestWorker>[0] = {}): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), ...options });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, PRIVATE);
  return worker;
}

describe('a private tab\'s RunState (the audit, S-6)', () => {
  it('is kept in storage.session for that tab alone, never in storage.local, and goes when the tab closes', async () => {
    const worker = await privateFrame();
    const state = runState({ applicationKey: LEVER_KEY, status: 'review' });
    expect(await worker.deliver({ v: 1, type: 'runstate/put', runState: state }, PRIVATE)).toMatchObject({ ok: true });
    expect(Object.keys(await local()).filter((key) => key.startsWith('run:'))).toEqual([]);
    expect(Object.keys(await session()).filter((key) => key.startsWith('tabrun:'))).toEqual([]);
    expect(await worker.deliver({ v: 1, type: 'runstate/get', applicationKey: LEVER_KEY }, PRIVATE))
      .toMatchObject({ ok: true, data: { runState: { applicationKey: LEVER_KEY, status: 'review' } } });
    // Another tab never reads it.
    const other = contentSender({ tab: { id: 8 } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, other);
    expect(await worker.deliver({ v: 1, type: 'runstate/get', applicationKey: LEVER_KEY }, other))
      .toEqual({ ok: true, data: { runState: null } });
    // The private tab closes: nothing of it is left.
    await closeTab(7);
    await expect.poll(async () => Object.keys(await session()).filter((key) => key.startsWith(PRIVATE_RUN_PREFIX)))
      .toEqual([]);
    expect(JSON.stringify(await local())).not.toContain(LEVER_KEY);
  });

  it('keeps the AI tasks a private run notes in that tab\'s record, never the shared one, and drops them with it', async () => {
    const store = memoryStore();
    const runStates = createRunStateStore({ local: store.local, session: store.session, now: () => START_MS,
      profile: async () => ({ ok: false, failure: 'not-connected' }) as never, core: { persistableCanaries: () => [] } });
    await runStates.markPrivate(7);
    await runStates.aiTasks(LEVER_KEY, 7).note(HASH_1, TASK_ID);
    expect(await runStates.aiTasks(LEVER_KEY, 7).get(HASH_1)).toBe(TASK_ID);
    expect(store.session.data.has(AI_TASKS_KEY)).toBe(false);
    // Another (normal) tab's run of the same application never reads it, and notes in the shared record.
    expect(await runStates.aiTasks(LEVER_KEY, 8).get(HASH_1)).toBeNull();
    await runStates.aiTasks(LEVER_KEY, 8).note(HASH_2, TASK_ID);
    expect(store.session.data.has(AI_TASKS_KEY)).toBe(true);
    // A put of the private tab folds its own tasks in, and stays in storage.session.
    expect(await runStates.put(runState({ applicationKey: LEVER_KEY }), 7)).toMatchObject({ ok: true });
    expect((await runStates.get(LEVER_KEY, 7))?.aiTasks).toEqual({ [HASH_1]: TASK_ID });
    expect([...store.local.data.keys()]).toEqual([]);
    await runStates.forgetTab(7);
    expect([...store.session.data.keys()].filter((key) => key.startsWith(PRIVATE_RUN_PREFIX))).toEqual([]);
    expect(await runStates.aiTasks(LEVER_KEY, 7).get(HASH_1)).toBeNull();
  });
});

/** Two storage areas in memory, as the store reads them. */
function memoryStore() {
  const area = () => {
    const data = new Map<string, unknown>();
    const storage: StorageArea & { data: Map<string, unknown> } = {
      data,
      get: async (key) => structuredClone(data.get(key)),
      getMany: async (prefix) => Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, structuredClone(value)])),
      set: async (entries) => {
        for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
      },
      remove: async (keys) => {
        for (const key of keys) data.delete(key);
      },
      restrictToTrustedContexts: async () => undefined,
    };
    return storage;
  };
  return { local: area(), session: area() };
}

describe('a private tab writes nothing that outlives it (the audit, S-6)', () => {
  it('keeps no launcher place or hiding in storage.local: a hide is its page\'s alone', async () => {
    const worker = await privateFrame();
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.4 }, PRIVATE)).toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'site' }, PRIVATE)).toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'everywhere' }, PRIVATE))
      .toEqual({ ok: true, data: {} });
    expect((await local())[LAUNCHER_KEY]).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'panel/launcher', tabId: 7 }, pageSender()))
      .toEqual({ ok: true, data: { hidden: 'visit' } });
    // A normal tab's hide is kept, as before.
    const normal = contentSender({ tab: { id: 8 } });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, normal);
    await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'site' }, normal);
    expect((await local())[LAUNCHER_KEY]).toBeDefined();
  });

  it('counts no telemetry, even opted in', async () => {
    const worker = await privateFrame({ before: async () => {
      await fakeBrowser.storage.local.set({ 'settings:v1': { ...DEFAULT_SETTINGS, telemetry: { optIn: true } } });
    } });
    const runId = await beginRun(worker, {}, PRIVATE);
    const report = frameReport(runId, 0, { fields: [{ ...skippedRow(fieldSpec(1)), status: 'verified', wrote: true,
      verification: 'verified', provenance: 'profile', needsUserAction: false, reason: 'ok' } as never] });
    expect(await worker.deliver({ v: 1, type: 'report/put', runId, report }, PRIVATE)).toEqual({ ok: true, data: {} });
    expect((await local())[TELEMETRY_KEY]).toBeUndefined();
    expect((await session())[TELEMETRY_COUNTED_KEY]).toBeUndefined();
  });

  it('accepts no match into the cache when its application is done', async () => {
    const key = 'lever|main|source|9d4c2b7e1f0a3c58|0' as FieldKey;
    const worker = await privateFrame({ core: { planFrame: (input) => ({ writes: [],
      results: input.specs.map(skippedRow), awaiting: [], needsSensitive: false, persistableCanaries: [],
      cacheCandidates: [{ fieldKey: key, cacheKey: 'm2|lever|source|9d4c2b7e1f0a3c58|ref:linkedin',
        entry: { label: 'linkedin', stage: 'exact', confidence: 1 } }] }) } });
    const runId = await beginRun(worker, {}, PRIVATE);
    await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], planKeys: [fieldSpec(1).key],
      canaries: [], notices: [] }, PRIVATE);
    const report = frameReport(runId, 0, { fields: [{ ...skippedRow(fieldSpec(1)), key, status: 'verified',
      provenance: 'profile', wrote: true, verification: 'verified', kind: 'select', category: 'referral.source' } as never] });
    await worker.deliver({ v: 1, type: 'report/put', runId, report }, PRIVATE);
    expect(await worker.deliver({ v: 1, type: 'runstate/put', runState: runState({ applicationKey: LEVER_KEY,
      status: 'done' }) }, PRIVATE)).toMatchObject({ ok: true });
    expect((await session())[MATCH_CACHE_KEY]).toBeUndefined();
  });
});
