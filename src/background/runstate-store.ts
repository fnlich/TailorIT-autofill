/*
 * RunState, the multi-step machine's memory across reloads (Requirement C). Stored per application in storage.local
 * (`run:<applicationKey>`) and indexed per tab in storage.session (`tabrun:<tabId>`), because a run resumes only in its
 * own tab. Every entry is checked with RunStateSchema on the way in and on the way out, weighs at most
 * MAX_RUN_STATE_BYTES, expires 24 hours after its last update (by the worker's clock, not the page's), and at most 20
 * are kept, the oldest dropped first.
 *
 * RunState holds no field value. Its one page-derived text, the canary set, is checked here: every canary that equals
 * a profile value is dropped before storing (the core's persistableCanaries), with the profile loaded first if it is
 * not in memory; when it cannot be loaded, the canary set is stored empty. A canary is never stored unchecked.
 *
 * RunState.aiTasks (Phase 4) is the worker's own: a batch hash to its TailorIT task id, never a value. The worker notes
 * an id the moment TailorIT gives one (aiTasks()), in storage.session's `aitasks` record, since the content script puts
 * its RunState only at a run's end; every put folds the application's entries in. A batch asked again after a worker
 * restart or a reload is read by its id, from either place, within TailorIT's hour.
 */
import { AUTOFILL_TASK_RETENTION_MS } from '../contract/tailorit';
import { RUN_STATE_TTL_MS, type RunState } from '../core/types/run';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { RunStateSchema } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { AI_TASKS_KEY, AiTaskRecordSchema, MAX_AI_TASK_ENTRIES, type AiTaskRecord } from '../shared/stored';
import type { AiTaskIds } from './ai-tasks';
import type { CoreFunctions } from './core';
import { createKeyedQueue } from './locks';
import type { ProfileResult } from './profile-cache';

/** At most this many RunStates are kept. */
export const MAX_RUN_STATES = 20;

/**
 * The most a stored RunState may weigh: its JSON, in UTF-8 bytes, as storage.local counts it against its 10 MiB quota.
 * The worst legitimate one, at the step guard (30 steps of 25 written fields at the longest key the core builds, 100
 * reveal edges, 32 full-length canaries, every repeatable counter, four AI tasks a step), is about 160 KiB; a real
 * application (6 to 8 steps) stays under 60 KiB. 256 KiB leaves 60% over the first, and keeps 20 of them at 5 MiB,
 * half the quota, so settings always fit. A put past it is refused (`too_large`) before anything is read or written.
 */
export const MAX_RUN_STATE_BYTES = 256 * 1024;
const STATE_PREFIX = 'run:';
const TAB_PREFIX = 'tabrun:';

const stateKey = (applicationKey: string) => `${STATE_PREFIX}${applicationKey}`;
const tabKey = (tabId: number) => `${TAB_PREFIX}${tabId}`;

/** Statuses a run never resumes from. */
const FINISHED: ReadonlySet<RunState['status']> = new Set(['done', 'stopped']);

/** RunState, as the content script and runs/clear reach it. */
export interface RunStateStore {
  /** This tab's RunState for the application, or null (none, expired, or another tab's). */
  get(applicationKey: string, tabId: number): Promise<RunState | null>;
  /** Stores a RunState for this tab, its canaries checked; answers the stored updatedAt, or `too_large` (nothing
   *  stored) when its stored form would exceed MAX_RUN_STATE_BYTES. */
  put(runState: RunState, tabId: number): Promise<Answer<{ updatedAt: number }>>;
  clear(applicationKey: string, tabId: number): Promise<void>;
  /** runs/clear: every RunState and tab index. Answers how many RunStates went. */
  clearAll(): Promise<number>;
  /** Whether this tab holds an unfinished RunState for the application (run/begin's 'resume' trigger). */
  activeFor(applicationKey: string, tabId: number): Promise<boolean>;
  /** A closed tab's index goes; its RunState stays until it expires. */
  forgetTab(tabId: number): Promise<void>;
  /** Drops expired and unreadable entries, then the oldest beyond MAX_RUN_STATES. */
  prune(): Promise<void>;
  /** The AI tasks' ids of one application, for a run in this tab (Phase 4): noted in storage.session at once, and read
   *  from there or from this tab's RunState.aiTasks. */
  aiTasks(applicationKey: string, tabId: number): AiTaskIds;
}

/** What the RunState store needs. */
export interface RunStateStoreDeps {
  local: StorageArea;
  session: StorageArea;
  now(): number;
  /** The profile, from memory or fetched (the canary check). */
  profile(): Promise<ProfileResult>;
  core: Pick<CoreFunctions, 'persistableCanaries'>;
}

/** The store over storage.local and its per-tab index in storage.session. */
export function createRunStateStore(deps: RunStateStoreDeps): RunStateStore {
  const { local, session } = deps;
  /** One queue for every RunState write, so a prune never races a put. */
  const queue = createKeyedQueue();

  const expired = (state: { updatedAt: number }) => state.updatedAt + RUN_STATE_TTL_MS <= deps.now();

  /** The noted AI tasks still within TailorIT's hour; an unreadable record reads as none. */
  async function taskEntries(): Promise<AiTaskRecord> {
    const parsed = AiTaskRecordSchema.safeParse(await session.get(AI_TASKS_KEY));
    if (!parsed.success) return [];
    return parsed.data.filter((entry) => entry.at + AUTOFILL_TASK_RETENTION_MS > deps.now());
  }

  /** An application's noted tasks, as RunState.aiTasks holds them. */
  const tasksOf = (entries: AiTaskRecord, applicationKey: string) => Object.fromEntries(entries
    .filter((entry) => entry.applicationKey === applicationKey).map((entry) => [entry.hash, entry.taskId]));

  /** RunState.aiTasks with the application's noted tasks folded in, the latest kept within its cap. */
  function withTasks(aiTasks: Readonly<Record<string, string>>, noted: Record<string, string>): Record<string, string> {
    const merged = { ...aiTasks, ...noted };
    return Object.fromEntries(Object.entries(merged).slice(-MAX_AI_TASK_ENTRIES));
  }

  /** The stored entry when it parses and has not expired; an entry that does neither is removed. */
  async function read(applicationKey: string): Promise<RunState | null> {
    const stored = await local.get(stateKey(applicationKey));
    if (stored === undefined) return null;
    const parsed = RunStateSchema.safeParse(stored);
    if (parsed.success && parsed.data.applicationKey === applicationKey && !expired(parsed.data)) {
      // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      return parsed.data as unknown as RunState;
    }
    await local.remove([stateKey(applicationKey)]);
    return null;
  }

  /** The canaries that may be stored: those the core lets through, never more than were given. */
  async function checkedCanaries(canaries: readonly string[]): Promise<string[]> {
    if (canaries.length === 0) return [];
    const loaded = await deps.profile();
    if (!loaded.ok) return [];
    let kept: string[];
    try {
      kept = deps.core.persistableCanaries(canaries, loaded.value.profile);
    } catch {
      return [];
    }
    const given = new Set(canaries);
    return [...new Set(kept)].filter((canary) => given.has(canary));
  }

  async function pruneNow(): Promise<void> {
    const stored = await local.getMany(STATE_PREFIX);
    const live: Array<{ key: string; updatedAt: number }> = [];
    const dead: string[] = [];
    for (const [key, value] of Object.entries(stored)) {
      const parsed = RunStateSchema.safeParse(value);
      if (parsed.success && stateKey(parsed.data.applicationKey) === key && !expired(parsed.data)) {
        live.push({ key, updatedAt: parsed.data.updatedAt });
      } else {
        dead.push(key);
      }
    }
    live.sort((a, b) => a.updatedAt - b.updatedAt);
    dead.push(...live.slice(0, Math.max(0, live.length - MAX_RUN_STATES)).map((entry) => entry.key));
    if (dead.length === 0) return;
    await local.remove(dead);
    const gone = new Set(dead.map((key) => key.slice(STATE_PREFIX.length)));
    const pointers = await session.getMany(TAB_PREFIX);
    const stale = Object.entries(pointers).filter(([, key]) => typeof key !== 'string' || gone.has(key)).map(([key]) => key);
    if (stale.length > 0) await session.remove(stale);
    log('runstate.pruned', { removed: dead.length });
  }

  const store: RunStateStore = {
    async get(applicationKey, tabId) {
      if ((await session.get(tabKey(tabId))) !== applicationKey) return null;
      const state = await read(applicationKey);
      // The tab's pointer goes with an entry that expired or no longer parses.
      if (state === null) await session.remove([tabKey(tabId)]);
      return state;
    },
    put(runState, tabId) {
      return queue.run('runstate', async (): Promise<Answer<{ updatedAt: number }>> => {
        const now = deps.now();
        const aiTasks = withTasks(runState.aiTasks, tasksOf(await taskEntries(), runState.applicationKey));
        const stamped = { ...runState, aiTasks, startedAt: Math.min(runState.startedAt, now), updatedAt: now };
        // Weighed as it would be stored, before the canary check (which may fetch the profile) and before any write;
        // dropping canaries only makes it lighter.
        const bytes = new TextEncoder().encode(JSON.stringify(stamped)).length;
        if (bytes > MAX_RUN_STATE_BYTES) {
          log('runstate.too-large', { kib: Math.ceil(bytes / 1024) });
          return refuse('too_large');
        }
        const canarySet = await checkedCanaries(runState.canarySet);
        const stored = RunStateSchema.parse({ ...stamped, canarySet });
        await local.set({ [stateKey(stored.applicationKey)]: stored });
        // A run lives in one tab: any other tab's pointer to this application goes.
        const pointers = await session.getMany(TAB_PREFIX);
        const others = Object.entries(pointers)
          .filter(([key, value]) => value === stored.applicationKey && key !== tabKey(tabId))
          .map(([key]) => key);
        if (others.length > 0) await session.remove(others);
        await session.set({ [tabKey(tabId)]: stored.applicationKey });
        log('runstate.stored', { canaries: canarySet.length, dropped: runState.canarySet.length - canarySet.length });
        await pruneNow();
        return ok({ updatedAt: now });
      });
    },
    clear(applicationKey, tabId) {
      return queue.run('runstate', async () => {
        await local.remove([stateKey(applicationKey)]);
        if ((await session.get(tabKey(tabId))) === applicationKey) await session.remove([tabKey(tabId)]);
      });
    },
    clearAll() {
      return queue.run('runstate', async () => {
        const states = Object.keys(await local.getMany(STATE_PREFIX));
        const pointers = Object.keys(await session.getMany(TAB_PREFIX));
        if (states.length > 0) await local.remove(states);
        if (pointers.length > 0) await session.remove(pointers);
        await session.remove([AI_TASKS_KEY]);
        return states.length;
      });
    },
    async activeFor(applicationKey, tabId) {
      const state = await store.get(applicationKey, tabId);
      return state !== null && !FINISHED.has(state.status);
    },
    async forgetTab(tabId) {
      await session.remove([tabKey(tabId)]);
    },
    prune() {
      return queue.run('runstate', pruneNow);
    },
    aiTasks(applicationKey, tabId) {
      return {
        async get(hash) {
          const noted = (await taskEntries()).find((entry) => entry.applicationKey === applicationKey && entry.hash === hash);
          if (noted !== undefined) return noted.taskId;
          return (await store.get(applicationKey, tabId))?.aiTasks[hash] ?? null;
        },
        note(hash, taskId) {
          return queue.run('aitasks', async () => {
            const entries = (await taskEntries())
              .filter((entry) => !(entry.applicationKey === applicationKey && entry.hash === hash));
            const next = [...entries, { applicationKey, hash, taskId, at: deps.now() }].slice(-MAX_AI_TASK_ENTRIES);
            await session.set({ [AI_TASKS_KEY]: AiTaskRecordSchema.parse(next) });
          });
        },
        async any() {
          if ((await taskEntries()).some((entry) => entry.applicationKey === applicationKey)) return true;
          return Object.keys((await store.get(applicationKey, tabId))?.aiTasks ?? {}).length > 0;
        },
        forget(hash) {
          return queue.run('aitasks', async () => {
            const entries = await taskEntries();
            const kept = entries.filter((entry) => !(entry.applicationKey === applicationKey && entry.hash === hash));
            if (kept.length !== entries.length) await session.set({ [AI_TASKS_KEY]: kept });
            // A RunState that still names it would send the next ask to the same dead id.
            await queue.run('runstate', async () => {
              const state = await store.get(applicationKey, tabId);
              if (state === null || !(hash in state.aiTasks)) return;
              const aiTasks = Object.fromEntries(Object.entries(state.aiTasks).filter(([name]) => name !== hash));
              await local.set({ [stateKey(applicationKey)]: RunStateSchema.parse({ ...state, aiTasks }) });
            });
          });
        },
      };
    },
  };
  return store;
}
