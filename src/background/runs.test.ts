/*
 * The run registry (runs.ts): a record read from storage.session while another call changes it keeps that change (the
 * Phase G review, MINOR 6: noteLetterWritten over a concurrent setSensitive).
 */
import { describe, expect, it } from 'vitest';
import type { StorageArea } from '../platform/types';
import { createRunRegistry } from './runs';
import { LEVER_KEY } from './worker.testkit';

/** storage.session in memory, whose reads, once gated, wait until `release` lets the oldest one through. */
function gatedSession() {
  const data = new Map<string, unknown>();
  const waiting: Array<() => void> = [];
  let gated = false;
  const area: StorageArea = {
    async get(key) {
      // What storage held when the read began, answered once it is let through.
      const value = structuredClone(data.get(key));
      if (gated) await new Promise<void>((resolve) => waiting.push(resolve));
      return value;
    },
    async getMany(prefix) {
      return Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) =>
        [key, structuredClone(value)]));
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
  return {
    area,
    data,
    gate: () => {
      gated = true;
    },
    release: async () => {
      waiting.shift()?.();
      for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const platform = { now: () => 1_000, randomBytes: (length: number) => new Uint8Array(length).fill(7) };
const FRAME = { tabId: 7, frameId: 0, documentId: 'doc-1' };

describe('the run registry', () => {
  it('keeps a setSensitive that ran while noteLetterWritten read the record (a worker that restarted)', async () => {
    const session = gatedSession();
    const first = createRunRegistry(platform, session.area);
    const { runId } = await first.create({ frame: FRAME, applicationKey: LEVER_KEY, dryRun: false });
    // A new worker: its memory is empty, so each call reads storage.session.
    const registry = createRunRegistry(platform, session.area);
    session.gate();
    const found = registry.find(runId, FRAME);
    const noted = registry.noteLetterWritten(runId);
    await session.release();
    expect(await found).toMatchObject({ runId, sensitive: 'untried' });
    // The plan fetched the sensitive part meanwhile.
    await registry.setSensitive(runId, 'loaded');
    await session.release();
    await noted;
    expect(session.data.get(`runs:${runId}`)).toMatchObject({ sensitive: 'loaded', letterWritten: true });
    expect(await registry.find(runId, FRAME)).toMatchObject({ sensitive: 'loaded', letterWritten: true });
  });
});
