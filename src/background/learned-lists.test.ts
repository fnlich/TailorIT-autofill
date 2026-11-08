/*
 * Learned lists (snapshot round 2, decision 1; learned-lists.ts): a site's dropdown lists kept in storage.local by
 * keyed hashes only (the site's an HMAC under the install's own secret: the review of round 2, L1), the most recent of
 * each label offered back to the same site's frames, never another's; at most 200 lists, 60 of one site and 256 KiB of
 * labels, the earliest learned going first, and no time kept; myworkdaysite.com's tenants apart, a path naming none
 * never kept; nothing kept from a private tab; the site from Chrome's sender address, never a payload.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sha256Hex } from '../core/text/sha256';
import { learnedKeyOf, MAX_LEARNED_LISTS, storedListsWanted } from '../shared/learned-lists';
import {
  createLearnedListStore, LEARNED_LISTS_KEY, MAX_LEARNED_BYTES, MAX_LEARNED_SITE_LISTS, siteOf,
} from './learned-lists';
import { STORED_LISTS } from './stored-lists';
import type { StorageArea } from '../platform/types';
import { contentSender, startTestWorker, tokenRecord } from './worker.testkit';

const WORKDAY = 'https://exampleco.wd1.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply/applyManually';
const OTHER = 'https://otherco.wd5.myworkdayjobs.com/en-US/External/job/Analyst_R2/apply';
const DEGREE = learnedKeyOf('degree');
const PREFIX = learnedKeyOf('prefix');
/** A secret of the test's own (the install's 32 random bytes). */
const bytes = (fill: number) => (count: number) => new Uint8Array(count).fill(fill);

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

const entriesOf = (local: { data: Record<string, unknown> }) =>
  (local.data[LEARNED_LISTS_KEY] as { entries: Array<Record<string, unknown>> }).entries;

describe('the learned-list store', () => {
  it('offers a site its own lists, the most recently learned of each label, and no other site any', async () => {
    const local = memory();
    const store = createLearnedListStore(local, bytes(7));
    await store.learn(WORKDAY, DEGREE, ['Select One', "Bachelor's Degree", "Master's Degree"]);
    await store.learn(WORKDAY, PREFIX, ['Select One', 'Mr.', 'Ms.']);
    await store.learn(WORKDAY, DEGREE, ['Select One', "Bachelor's Degree", "Master's Degree", 'Doctorate']);
    expect(await store.known(WORKDAY)).toEqual([
      { key: DEGREE, labels: ['Select One', "Bachelor's Degree", "Master's Degree", 'Doctorate'] },
      { key: PREFIX, labels: ['Select One', 'Mr.', 'Ms.'] }]);
    expect(await store.known(OTHER)).toEqual([]);
    // Kept by keyed hashes alone: no address, no host, no question's words, and no time.
    const stored = JSON.stringify(local.data[LEARNED_LISTS_KEY]);
    expect(stored).not.toContain('exampleco');
    expect(stored).not.toContain('degree');
    expect(entriesOf(local).every((entry) => Object.keys(entry).sort().join() === 'hash,key,labels,site')).toBe(true);
  });

  it('keys a site by an HMAC under the install\'s own secret: a guess at its host is not checked against the record', async () => {
    const host = 'exampleco.wd1.myworkdayjobs.com';
    const one = memory();
    await createLearnedListStore(one, bytes(1)).learn(WORKDAY, DEGREE, ['Yes', 'No']);
    const two = memory();
    await createLearnedListStore(two, bytes(2)).learn(WORKDAY, DEGREE, ['Yes', 'No']);
    const siteOne = entriesOf(one)[0]!.site as string;
    expect(siteOne).toMatch(/^[0-9a-f]{32}$/);
    expect(siteOne).not.toBe(entriesOf(two)[0]!.site);
    for (const plain of [sha256Hex(host).slice(0, 16), sha256Hex(host).slice(0, 32), learnedKeyOf(host)]) {
      expect(JSON.stringify(one.data)).not.toContain(plain);
    }
    // The secret is kept with the record, so the same install finds its lists again.
    expect(await createLearnedListStore(one, bytes(9)).known(WORKDAY)).toEqual([{ key: DEGREE, labels: ['Yes', 'No'] }]);
  });

  it('keeps myworkdaysite.com\'s tenants apart, and nothing for a path that names none', async () => {
    const tenantA = 'https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/Engineer_R1/apply';
    const tenantB = 'https://wd5.myworkdaysite.com/recruiting/globex/Careers/job/Analyst_R2';
    const none = 'https://wd5.myworkdaysite.com/en-US/External/job/Engineer_R1';
    expect([siteOf(tenantA), siteOf(tenantB), siteOf(none), siteOf(WORKDAY)]).toEqual(['wd5.myworkdaysite.com/acme',
      'wd5.myworkdaysite.com/globex', null, 'exampleco.wd1.myworkdayjobs.com']);
    const local = memory();
    const store = createLearnedListStore(local, bytes(3));
    await store.learn(tenantA, DEGREE, ['Doctorate']);
    await store.learn(none, PREFIX, ['Mr.']);
    expect(await store.known(tenantA)).toEqual([{ key: DEGREE, labels: ['Doctorate'] }]);
    expect(await store.known(tenantB)).toEqual([]);
    expect(await store.known(none)).toEqual([]);
    expect(entriesOf(local)).toHaveLength(1);
  });

  it('keeps at most 200 lists, 60 of one site and 256 KiB of labels, the earliest learned going first', async () => {
    const local = memory();
    const store = createLearnedListStore(local, bytes(4));
    const sites = [0, 1, 2, 3].map((n) => `https://site${n}.wd1.myworkdayjobs.com/en-US/External/job/R${n}`);
    for (let at = 0; at <= MAX_LEARNED_LISTS; at += 1) {
      await store.learn(sites[at % 4]!, learnedKeyOf(`q${at}`), ['Yes', 'No']);
    }
    expect(entriesOf(local)).toHaveLength(MAX_LEARNED_LISTS);
    const keys = (await store.known(sites[0]!)).map((list) => list.key);
    expect(keys).not.toContain(learnedKeyOf('q0'));
    expect(keys).toContain(learnedKeyOf(`q${MAX_LEARNED_LISTS}`));
    // One site: at most 60.
    const one = memory();
    const single = createLearnedListStore(one, bytes(5));
    for (let at = 0; at <= MAX_LEARNED_SITE_LISTS; at += 1) await single.learn(WORKDAY, learnedKeyOf(`s${at}`), ['A']);
    expect(entriesOf(one)).toHaveLength(MAX_LEARNED_SITE_LISTS);
    expect((await single.known(WORKDAY)).map((list) => list.key)).not.toContain(learnedKeyOf('s0'));
    // Long lists: no more than 256 KiB of labels in all.
    const big = memory();
    const heavy = createLearnedListStore(big, bytes(6));
    const labels = Array.from({ length: 300 }, (_, at) => `${'x'.repeat(150)}${at}`);
    for (let at = 0; at < 8; at += 1) await heavy.learn(sites[at % 4]!, learnedKeyOf(`b${at}`), labels);
    const kept = entriesOf(big);
    expect(kept.length).toBeLessThan(8);
    expect(new TextEncoder().encode(JSON.stringify(kept.map((entry) => entry.labels))).length).toBeLessThanOrEqual(
      MAX_LEARNED_BYTES + 8);
    expect(kept.at(-1)!.key).toBe(learnedKeyOf('b7'));
  });

  it('refuses a list past its caps, and drops round 2\'s first record', async () => {
    const local = memory();
    local.data['lists:v1'] = { entries: [] };
    const store = createLearnedListStore(local, bytes(8));
    await store.learn(WORKDAY, 'not-a-key', ['Yes']);
    await store.learn(WORKDAY, DEGREE, []);
    await store.learn(WORKDAY, DEGREE, ['x'.repeat(161)]);
    await store.learn('not an address', DEGREE, ['Yes']);
    expect(local.data[LEARNED_LISTS_KEY]).toBeUndefined();
    await store.learn(WORKDAY, DEGREE, ['Yes']);
    expect(local.data['lists:v1']).toBeUndefined();
  });

  it('reads a stored record that does not parse as no lists', async () => {
    const local = memory();
    local.data[LEARNED_LISTS_KEY] = { entries: [{ site: 'x', key: DEGREE, hash: 'h', labels: ['Yes'] }, 'junk'] };
    expect(await createLearnedListStore(local, bytes(1)).known(WORKDAY)).toEqual([]);
  });
});

describe('the stored lists a scan asks for', () => {
  it('asks each once, Workday\'s States with its Countries (the run\'s own first pass may choose the United States)', () => {
    expect(storedListsWanted(['workday.countries'])).toEqual(['workday.countries', 'workday.us-states']);
    expect(storedListsWanted(['greenhouse.phone-countries', 'greenhouse.eeoc-gender', 'greenhouse.phone-countries']))
      .toEqual(['greenhouse.phone-countries', 'greenhouse.eeoc-gender']);
    expect(storedListsWanted(['workday.us-states', 'workday.countries'])).toEqual(['workday.us-states',
      'workday.countries']);
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

  it('serves the stored lists a frame names by id, with the host\'s learned lists, and no list it did not name', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const frame = contentSender({ url: WORKDAY });
    const answer = await worker.deliver({ v: 1, type: 'lists/known', stored: ['workday.countries', 'workday.us-states'] },
      frame) as { ok: true; data: { lists: unknown[]; stored: Array<{ id: string; labels: string[] }> } };
    expect(answer.ok).toBe(true);
    expect(answer.data.stored.map((list) => list.id)).toEqual(['workday.countries', 'workday.us-states']);
    expect(answer.data.stored[0]!.labels).toEqual(STORED_LISTS['workday.countries']);
    expect(answer.data.stored[0]!.labels).toHaveLength(250);
    expect(await worker.deliver({ v: 1, type: 'lists/known', stored: ['greenhouse.eeoc-gender'] }, frame))
      .toEqual({ ok: true, data: { lists: [], stored: [{ id: 'greenhouse.eeoc-gender',
        labels: ['Male', 'Female', 'Decline To Self Identify'] }] } });
    // None named: none served. An id the worker does not store is a bad message.
    expect(await worker.deliver({ v: 1, type: 'lists/known' }, frame)).toEqual({ ok: true, data: { lists: [] } });
    expect(await worker.deliver({ v: 1, type: 'lists/known', stored: ['workday.degrees'] }, frame))
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
