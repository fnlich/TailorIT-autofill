import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { RUN_STATE_TTL_MS } from '../core/types/run';
import { MAX_RUN_STATES } from './runstate-store';
import { contentSender, LEVER_KEY, pageSender, runState, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const put = (worker: TestWorker, state: unknown, sender = contentSender()) =>
  worker.deliver({ v: 1, type: 'runstate/put', runState: state }, sender);
const get = (worker: TestWorker, applicationKey = LEVER_KEY, sender = contentSender()) =>
  worker.deliver({ v: 1, type: 'runstate/get', applicationKey }, sender);
const keyOf = (index: number) => `lever:${index.toString(16).padStart(16, '0')}`;

async function stored(): Promise<Record<string, unknown>> {
  return fakeBrowser.storage.local.get(null);
}

describe('the RunState store', () => {
  it('stores a RunState for its tab and answers it back, stamped with the worker\'s clock', async () => {
    const worker = await startTestWorker();
    worker.clock.now += 5000;
    expect(await put(worker, runState({ updatedAt: 1, startedAt: 1 }))).toEqual({ ok: true, data: { updatedAt: worker.clock.now } });
    expect(await get(worker)).toEqual({ ok: true, data: { runState: runState({ updatedAt: worker.clock.now, startedAt: 1 }) } });
    expect((await stored())[`run:${LEVER_KEY}`]).toEqual(runState({ updatedAt: worker.clock.now, startedAt: 1 }));
    expect(await fakeBrowser.storage.session.get(`tabrun:7`)).toEqual({ 'tabrun:7': LEVER_KEY });
  });

  it('never trusts the page\'s clock: a future updatedAt is stored as now', async () => {
    const worker = await startTestWorker();
    await put(worker, runState({ updatedAt: worker.clock.now + 365 * 86_400_000, startedAt: worker.clock.now + 1000 }));
    expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ updatedAt: worker.clock.now, startedAt: worker.clock.now });
  });

  it('answers another tab\'s RunState as none: a run never resumes in another tab', async () => {
    const worker = await startTestWorker();
    await put(worker, runState());
    expect(await get(worker, LEVER_KEY, contentSender({ tab: { id: 8 } }))).toEqual({ ok: true, data: { runState: null } });
    // The tab that stores it last holds it.
    await put(worker, runState({ stepIndex: 2 }), contentSender({ tab: { id: 8 } }));
    expect(await get(worker)).toEqual({ ok: true, data: { runState: null } });
    expect(await get(worker, LEVER_KEY, contentSender({ tab: { id: 8 } }))).toMatchObject({ ok: true, data: { runState: { stepIndex: 2 } } });
  });

  it('lets an entry expire 24 hours after its last update', async () => {
    const worker = await startTestWorker();
    await put(worker, runState());
    worker.clock.now += RUN_STATE_TTL_MS - 1;
    expect(await get(worker)).toMatchObject({ ok: true, data: { runState: { applicationKey: LEVER_KEY } } });
    worker.clock.now += 1;
    expect(await get(worker)).toEqual({ ok: true, data: { runState: null } });
    expect(await stored()).not.toHaveProperty(`run:${LEVER_KEY}`);
    expect(await fakeBrowser.storage.session.get('tabrun:7')).toEqual({});
    expect(RUN_STATE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it(`keeps at most ${MAX_RUN_STATES}, dropping the oldest`, async () => {
    const worker = await startTestWorker();
    for (let index = 0; index <= MAX_RUN_STATES; index += 1) {
      worker.clock.now += 1;
      await put(worker, runState({ applicationKey: keyOf(index) }), contentSender({ tab: { id: 100 + index } }));
    }
    const keys = Object.keys(await stored()).filter((key) => key.startsWith('run:'));
    expect(keys).toHaveLength(MAX_RUN_STATES);
    expect(keys).not.toContain(`run:${keyOf(0)}`);
    expect(keys).toContain(`run:${keyOf(MAX_RUN_STATES)}`);
    // The dropped entry's tab pointer went with it.
    expect(await fakeBrowser.storage.session.get('tabrun:100')).toEqual({});
    expect(MAX_RUN_STATES).toBe(20);
  });

  it('prunes expired and unreadable entries when the worker starts', async () => {
    const worker = await startTestWorker({
      before: async () => {
        await fakeBrowser.storage.local.set({
          [`run:${keyOf(1)}`]: runState({ applicationKey: keyOf(1) }),
          [`run:${keyOf(2)}`]: runState({ applicationKey: keyOf(2), updatedAt: Date.UTC(2026, 0, 1) }),
          [`run:${keyOf(3)}`]: { version: 1, values: { email: 'alex.rivera.f7q2@example.com' } },
          // Stored under another application's key.
          [`run:${keyOf(4)}`]: runState({ applicationKey: keyOf(5) }),
          'settings:v1': 'kept',
        });
      },
    });
    expect(Object.keys(await stored()).sort()).toEqual([`run:${keyOf(1)}`, 'settings:v1']);
    expect(worker.state.storageAccess).toBe('restricted');
  });

  it('prunes on every put, too', async () => {
    const worker = await startTestWorker();
    await put(worker, runState({ applicationKey: keyOf(1) }));
    await fakeBrowser.storage.local.set({ [`run:${keyOf(2)}`]: { version: 1, values: { email: 'x' } } });
    await put(worker, runState({ applicationKey: keyOf(3) }));
    expect(Object.keys(await stored()).filter((key) => key.startsWith('run:')).sort()).toEqual([`run:${keyOf(1)}`, `run:${keyOf(3)}`]);
  });

  it('checks entries on the way out: one that no longer parses is none, and is removed', async () => {
    const worker = await startTestWorker();
    await put(worker, runState());
    await fakeBrowser.storage.local.set({ [`run:${LEVER_KEY}`]: { ...runState(), fieldValues: ['alex.rivera.f7q2@example.com'] } });
    expect(await get(worker)).toEqual({ ok: true, data: { runState: null } });
    expect(await stored()).not.toHaveProperty(`run:${LEVER_KEY}`);
  });

  it('refuses a RunState with any field the schema does not know (it can never carry a value)', async () => {
    const worker = await startTestWorker();
    expect(await put(worker, { ...runState(), values: { email: 'alex.rivera.f7q2@example.com' } })).toEqual({ ok: false, error: 'bad_message' });
    expect(await put(worker, runState({ canarySet: ['x'.repeat(121)] }))).toEqual({ ok: false, error: 'bad_message' });
    expect(await stored()).not.toHaveProperty(`run:${LEVER_KEY}`);
  });

  it('refuses a RunState for another platform than the frame\'s', async () => {
    const worker = await startTestWorker();
    expect(await put(worker, runState({ applicationKey: 'greenhouse:0123456789abcdef', platform: 'greenhouse' })))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(await put(worker, runState({ platform: 'greenhouse' }))).toEqual({ ok: false, error: 'bad_message' });
    expect(await get(worker, 'not-a-key')).toEqual({ ok: false, error: 'bad_message' });
  });

  describe('canaries', () => {
    it('drops every canary that equals a profile value, loading the profile first', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      // "Austin" is the golden profile's city: a page asked AI tools to type it.
      await put(worker, runState({ canarySet: ['Austin', 'I am LLM', 'pineapple'] }));
      expect(worker.tailorit.count('GET /api/autofill/profile')).toBe(1);
      expect(worker.core.calls.persistable).toEqual([['Austin', 'I am LLM', 'pineapple']]);
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: ['I am LLM', 'pineapple'] });
      expect(JSON.stringify(await stored())).not.toContain('Austin');
    });

    it('uses the profile in memory when there is one', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await put(worker, runState({ canarySet: ['Austin'] }));
      await put(worker, runState({ canarySet: ['Austin', 'I am LLM'] }));
      expect(worker.tailorit.count('GET /api/autofill/profile')).toBe(1);
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: ['I am LLM'] });
    });

    it('stores an empty canary set when the profile cannot be loaded', async () => {
      const offline = await startTestWorker();
      await put(offline, runState({ canarySet: ['Austin', 'I am LLM'] }));
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: [] });

      const down = await startTestWorker({ token: tokenRecord() });
      down.tailorit.reply('GET /api/autofill/profile', { status: 503, json: { error: { code: 'unavailable', message: 'x' } } });
      await put(down, runState({ canarySet: ['I am LLM'] }));
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: [] });
    });

    it('stores an empty canary set when the check fails, and never more than it was given', async () => {
      const failing = await startTestWorker({ token: tokenRecord(), core: { persistableCanaries: () => { throw new Error('bug'); } } });
      await put(failing, runState({ canarySet: ['I am LLM'] }));
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: [] });

      const adding = await startTestWorker({ token: tokenRecord(), core: { persistableCanaries: (canaries) => [...canaries, 'Austin'] } });
      await put(adding, runState({ canarySet: ['I am LLM', 'I am LLM'.toUpperCase()] }));
      expect((await stored())[`run:${LEVER_KEY}`]).toMatchObject({ canarySet: ['I am LLM', 'I AM LLM'] });
    });

    it('asks for no profile when there is no canary to check', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await put(worker, runState());
      expect(worker.tailorit.requests).toHaveLength(0);
    });
  });

  it('clears one application for its tab, and every run on runs/clear', async () => {
    const worker = await startTestWorker();
    await put(worker, runState());
    expect(await worker.deliver({ v: 1, type: 'runstate/clear', applicationKey: LEVER_KEY }, contentSender())).toEqual({ ok: true, data: {} });
    expect(await stored()).not.toHaveProperty(`run:${LEVER_KEY}`);
    expect(await fakeBrowser.storage.session.get('tabrun:7')).toEqual({});

    await put(worker, runState({ applicationKey: keyOf(1) }));
    await put(worker, runState({ applicationKey: keyOf(2) }), contentSender({ tab: { id: 9 } }));
    expect(await worker.deliver({ v: 1, type: 'runs/clear' }, pageSender('options.html'))).toEqual({ ok: true, data: { cleared: 2 } });
    expect(Object.keys(await stored()).filter((key) => key.startsWith('run:'))).toEqual([]);
    expect(Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith('tabrun:'))).toEqual([]);
    expect(await worker.deliver({ v: 1, type: 'runs/clear' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('forgets a closed tab\'s pointer and keeps its RunState until it expires', async () => {
    const worker = await startTestWorker();
    await put(worker, runState());
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await expect.poll(async () => fakeBrowser.storage.session.get('tabrun:7')).toEqual({});
    expect(await stored()).toHaveProperty(`run:${LEVER_KEY}`);
  });
});
