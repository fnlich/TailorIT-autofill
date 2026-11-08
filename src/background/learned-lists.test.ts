/*
 * Learned lists (snapshot round 2, decision 1; learned-lists.ts): a host's dropdown lists kept in storage.local by
 * hashed keys only, the most recent of each label offered back to the same host's frames, never another's; at most 200
 * lists, the least recently learned going first; nothing kept from a private tab; the host from Chrome's sender
 * address, never a payload.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { learnedKeyOf, MAX_LEARNED_LISTS } from '../shared/learned-lists';
import { createLearnedListStore, hostKeyOf, LEARNED_LISTS_KEY } from './learned-lists';
import type { StorageArea } from '../platform/types';
import { contentSender, startTestWorker, tokenRecord } from './worker.testkit';

const WORKDAY = 'https://exampleco.wd1.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply/applyManually';
const OTHER = 'https://otherco.wd5.myworkdayjobs.com/en-US/External/job/Analyst_R2/apply';
const DEGREE = learnedKeyOf('degree');
const PREFIX = learnedKeyOf('prefix');

/** A storage.local of the test's own. */
function memory(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => data[key],
    getMany: async (prefix) => Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith(prefix))),
    set: async (entries) => {
      Object.assign(data, structuredClone(entries));
    },
    remove: async (keys) => {
      for (const key of keys) delete data[key];
    },
    restrictToTrustedContexts: async () => undefined,
  };
}

describe('the learned-list store', () => {
  it('offers a host its own lists, the most recently learned of each label, and no other host any', async () => {
    const local = memory();
    let now = 1_000;
    const store = createLearnedListStore(local, () => now);
    await store.learn(WORKDAY, DEGREE, ['Select One', "Bachelor's Degree", "Master's Degree"]);
    now += 1;
    await store.learn(WORKDAY, PREFIX, ['Select One', 'Mr.', 'Ms.']);
    now += 1;
    await store.learn(WORKDAY, DEGREE, ['Select One', "Bachelor's Degree", "Master's Degree", 'Doctorate']);
    expect(await store.known(WORKDAY)).toEqual([
      { key: DEGREE, labels: ['Select One', "Bachelor's Degree", "Master's Degree", 'Doctorate'] },
      { key: PREFIX, labels: ['Select One', 'Mr.', 'Ms.'] }]);
    expect(await store.known(OTHER)).toEqual([]);
    // Kept by hashed keys alone: no address, no host, no question's words.
    const stored = JSON.stringify(local.data[LEARNED_LISTS_KEY]);
    expect(stored).not.toContain('exampleco');
    expect(stored).not.toContain('degree');
    expect(stored).toContain(hostKeyOf(WORKDAY)!);
  });

  it('keeps at most 200 lists, the least recently learned going first, and refuses a list past its caps', async () => {
    const local = memory();
    const store = createLearnedListStore(local, () => 5);
    for (let at = 0; at <= MAX_LEARNED_LISTS; at += 1) await store.learn(WORKDAY, learnedKeyOf(`q${at}`), ['Yes', 'No']);
    const entries = (local.data[LEARNED_LISTS_KEY] as { entries: unknown[] }).entries;
    expect(entries).toHaveLength(MAX_LEARNED_LISTS);
    const keys = (await store.known(WORKDAY)).map((list) => list.key);
    expect(keys).not.toContain(learnedKeyOf('q0'));
    expect(keys).toContain(learnedKeyOf(`q${MAX_LEARNED_LISTS}`));
    const before = JSON.stringify(local.data);
    await store.learn(WORKDAY, 'not-a-key', ['Yes']);
    await store.learn(WORKDAY, DEGREE, []);
    await store.learn(WORKDAY, DEGREE, ['x'.repeat(161)]);
    await store.learn('not an address', DEGREE, ['Yes']);
    expect(JSON.stringify(local.data)).toBe(before);
  });

  it('reads a stored record that does not parse as no lists', async () => {
    const local = memory();
    local.data[LEARNED_LISTS_KEY] = { entries: [{ host: 'x', key: DEGREE, hash: 'h', labels: ['Yes'], at: 1 }, 'junk'] };
    expect(await createLearnedListStore(local, () => 1).known(WORKDAY)).toEqual([]);
  });
});

describe('lists/known and lists/learn through the worker', () => {
  it('keeps a frame\'s list for its host as Chrome reports it, and answers it to that host alone', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const frame = contentSender({ url: WORKDAY });
    expect(await worker.deliver({ v: 1, type: 'lists/learn', key: DEGREE, labels: ['Select One', 'Doctorate'] }, frame))
      .toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'lists/known' }, frame))
      .toEqual({ ok: true, data: { lists: [{ key: DEGREE, labels: ['Select One', 'Doctorate'] }] } });
    expect(await worker.deliver({ v: 1, type: 'lists/known' }, contentSender({ url: OTHER })))
      .toEqual({ ok: true, data: { lists: [] } });
    // A payload names no host: an address in it is refused as a bad message.
    expect(await worker.deliver({ v: 1, type: 'lists/known', url: OTHER }, frame)).toMatchObject({ ok: false,
      error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'lists/learn', key: 'degree', labels: ['Yes'] }, frame))
      .toMatchObject({ ok: false, error: 'bad_message' });
  });

  it('keeps nothing from a private tab, which is still offered the host\'s lists', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'lists/learn', key: PREFIX, labels: ['Mr.', 'Ms.'] }, contentSender({ url: WORKDAY }));
    const privateFrame = contentSender({ url: WORKDAY, tab: { id: 9, incognito: true } });
    expect(await worker.deliver({ v: 1, type: 'lists/learn', key: DEGREE, labels: ['Doctorate'] }, privateFrame))
      .toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'lists/known' }, privateFrame))
      .toEqual({ ok: true, data: { lists: [{ key: PREFIX, labels: ['Mr.', 'Ms.'] }] } });
    const stored = await fakeBrowser.storage.local.get(LEARNED_LISTS_KEY);
    expect(JSON.stringify(stored)).not.toContain('Doctorate');
  });
});
