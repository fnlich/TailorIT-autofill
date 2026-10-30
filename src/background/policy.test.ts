/*
 * The posting pages' policy records: at most MAX_POLICY_RECORDS applications, the least recently used going first, and
 * policy/hit limited per frame, so a page that pushes posting addresses cannot fill storage.session (S9).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createWorkerPlatform } from '../platform/chrome';
import { installHandFakes } from '../platform/fake';
import { createPolicyBook, MAX_POLICY_RECORDS, POLICY_HIT_LIMIT } from './policy';
import { contentSender, startTestWorker, type TestWorker } from './worker.testkit';

const keyOf = (index: number) => `lever:${index.toString(16).padStart(16, '0')}`;

/** The application keys that have a policy record. */
async function recorded(): Promise<string[]> {
  const stored = await fakeBrowser.storage.session.get(null);
  return Object.keys(stored).filter((key) => key.startsWith('policy:')).map((key) => key.slice('policy:'.length)).sort();
}

const policyHit = (worker: TestWorker, applicationKey: string, sender = contentSender(), patternId: string | null = null) =>
  worker.deliver({ v: 1, type: 'policy/hit', applicationKey, patternId }, sender);

describe('the policy records', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    installHandFakes();
  });

  it('keep at most MAX_POLICY_RECORDS applications, the least recently recorded or read going first', async () => {
    const book = createPolicyBook(createWorkerPlatform().storage.session);
    for (let i = 0; i < MAX_POLICY_RECORDS; i += 1) expect(await book.record(keyOf(i), i === 1 ? 'no-ai' : null)).toBe(true);
    expect(await recorded()).toHaveLength(MAX_POLICY_RECORDS);
    // Reading the oldest makes it the most recently used: the next record takes the second oldest instead.
    expect(await book.postingPage(keyOf(0))).toBe('clear');
    await book.record(keyOf(MAX_POLICY_RECORDS), null);
    expect(await recorded()).toHaveLength(MAX_POLICY_RECORDS);
    expect(await book.postingPage(keyOf(0))).toBe('clear');
    expect(await book.postingPage(keyOf(1))).toBe('unseen');
    expect(await book.postingPage(keyOf(MAX_POLICY_RECORDS))).toBe('clear');
    // Recording again makes a record recent too.
    await book.record(keyOf(2), 'no-ai');
    await book.record(keyOf(MAX_POLICY_RECORDS + 1), null);
    expect(await book.postingPage(keyOf(2))).toBe('hit');
    expect(await book.postingPage(keyOf(3))).toBe('unseen');
  });

  it('keep the cap when their order is unreadable or records are missing from it', async () => {
    const session = createWorkerPlatform().storage.session;
    const extra = Object.fromEntries(Array.from({ length: MAX_POLICY_RECORDS + 5 },
      (_, i) => [`policy:${keyOf(1000 + i)}`, { hits: [], clear: true }]));
    await fakeBrowser.storage.session.set({ ...extra, 'policy-order': 'not a list' });
    const book = createPolicyBook(session);
    await book.record(keyOf(1), 'no-ai');
    expect(await recorded()).toHaveLength(MAX_POLICY_RECORDS);
    expect(await book.postingPage(keyOf(1))).toBe('hit');
  });

  it('touch nothing when an application has no record', async () => {
    const book = createPolicyBook(createWorkerPlatform().storage.session);
    expect(await book.postingPage(keyOf(5))).toBe('unseen');
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });
});

describe('policy/hit', () => {
  it('is limited per frame: POLICY_HIT_LIMIT, then rate_limited until the window passes', async () => {
    const worker = await startTestWorker();
    for (let i = 0; i < POLICY_HIT_LIMIT.count; i += 1) expect(await policyHit(worker, keyOf(i))).toEqual({ ok: true, data: {} });
    expect(await policyHit(worker, keyOf(99))).toEqual({ ok: false, error: 'rate_limited',
      retryAfterSeconds: POLICY_HIT_LIMIT.windowMs / 1000 });
    // Another frame of the tab has its own count.
    expect(await policyHit(worker, keyOf(99), contentSender({ frameId: 2 }))).toEqual({ ok: true, data: {} });
    worker.clock.now += POLICY_HIT_LIMIT.windowMs;
    expect(await policyHit(worker, keyOf(98))).toEqual({ ok: true, data: {} });
  });

  it("forgets a closed tab's counts", async () => {
    const worker = await startTestWorker();
    for (let i = 0; i <= POLICY_HIT_LIMIT.count; i += 1) await policyHit(worker, keyOf(i));
    expect(await policyHit(worker, keyOf(50))).toMatchObject({ ok: false, error: 'rate_limited' });
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    expect(await policyHit(worker, keyOf(50))).toEqual({ ok: true, data: {} });
  });

  it('cannot fill storage.session from a page that pushes posting addresses', async () => {
    const worker = await startTestWorker();
    let stored = 0;
    for (let i = 0; i < 2000; i += 1) {
      // A page that keeps going as fast as the limit lets it.
      if (i % POLICY_HIT_LIMIT.count === 0) worker.clock.now += POLICY_HIT_LIMIT.windowMs;
      const url = `https://jobs.lever.co/acme/00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
      const answer = await policyHit(worker, keyOf(i), contentSender({ url }));
      if ((answer as { ok: boolean }).ok) stored += 1;
    }
    expect(stored).toBeGreaterThan(MAX_POLICY_RECORDS);
    expect(await recorded()).toHaveLength(MAX_POLICY_RECORDS);
    const order = (await fakeBrowser.storage.session.get('policy-order'))['policy-order'] as string[];
    expect([...order].sort()).toEqual(await recorded());
  });
});
