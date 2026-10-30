/*
 * The runs the worker knows. run/begin mints a run id per document and remembers the run's tab, frame, document,
 * applicationKey and mode, so plan/request, plan/poll, report/put and the resume port can check that a message comes
 * from the frame that began it. The record is value-free and kept in storage.session (`runs:<runId>`), so a run
 * survives the worker being stopped between messages; what a run looked up (its lookup answer) stays in memory only.
 * A run is gone when its tab closes, when its frame begins another run or loads another document, and when the
 * browser restarts.
 */
import type { AutofillLookupResponse } from '../contract/tailorit';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { RUN_PREFIX, RunRecordSchema, type RunRecord } from '../shared/stored';
import { toBase64Url } from './bytes';
import type { ResumeChoice } from './resume-choice';

/** At most this many runs are remembered at once; the oldest go first. */
export const MAX_RUNS = 50;

/** Where a message came from: a frame of a tab, in one document. */
export interface FrameRef {
  tabId: number;
  frameId: number;
  documentId: string | undefined;
}

/** What a run keeps in memory only. `lookup` is undefined until run/begin's lookup ran, null when it failed;
 *  `resume` is undefined until the run chose the resume it attaches (resume-choice.ts), null when it has none. */
export interface RunMemo {
  lookup?: AutofillLookupResponse | null;
  resume?: ResumeChoice | null;
}

/** The runs the worker knows, by id. */
export interface RunRegistry {
  /** Mints a run for a frame, replacing that frame's earlier run. */
  create(input: { frame: FrameRef; applicationKey: string; dryRun: boolean }): Promise<RunRecord>;
  /** The run, when it exists and belongs to this frame and document; else null. */
  find(runId: string, frame: FrameRef): Promise<RunRecord | null>;
  setSensitive(runId: string, sensitive: RunRecord['sensitive']): Promise<void>;
  /** The run's memory-only extras. */
  memo(runId: string): RunMemo;
  forgetFrame(tabId: number, frameId: number): Promise<void>;
  forgetTab(tabId: number): Promise<void>;
}

const keyOf = (runId: string) => `${RUN_PREFIX}${runId}`;

/** The registry over storage.session (`runs:<runId>`), with a memory copy. */
export function createRunRegistry(platform: Pick<WorkerPlatform, 'now' | 'randomBytes'>, session: StorageArea): RunRegistry {
  const known = new Map<string, RunRecord>();
  const memos = new Map<string, RunMemo>();

  async function all(): Promise<RunRecord[]> {
    const stored = await session.getMany(RUN_PREFIX);
    const records: RunRecord[] = [];
    const broken: string[] = [];
    for (const [key, value] of Object.entries(stored)) {
      const parsed = RunRecordSchema.safeParse(value);
      if (parsed.success && keyOf(parsed.data.runId) === key) records.push(parsed.data);
      else broken.push(key);
    }
    if (broken.length > 0) await session.remove(broken);
    return records;
  }

  async function remove(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    for (const runId of runIds) {
      known.delete(runId);
      memos.delete(runId);
    }
    await session.remove(runIds.map(keyOf));
  }

  return {
    async create({ frame, applicationKey, dryRun }) {
      const record = RunRecordSchema.parse({
        runId: toBase64Url(platform.randomBytes(16)),
        tabId: frame.tabId,
        frameId: frame.frameId,
        documentId: frame.documentId ?? null,
        applicationKey,
        dryRun,
        sensitive: 'untried',
        startedAt: platform.now(),
      });
      const records = await all();
      const replaced = records.filter((run) => run.tabId === frame.tabId && run.frameId === frame.frameId);
      const others = records.filter((run) => !replaced.includes(run)).sort((a, b) => a.startedAt - b.startedAt);
      const overflow = others.slice(0, Math.max(0, others.length - (MAX_RUNS - 1)));
      await remove([...replaced, ...overflow].map((run) => run.runId));
      await session.set({ [keyOf(record.runId)]: record });
      known.set(record.runId, record);
      return record;
    },
    async find(runId, frame) {
      let record = known.get(runId) ?? null;
      if (record === null) {
        const parsed = RunRecordSchema.safeParse(await session.get(keyOf(runId)));
        record = parsed.success && parsed.data.runId === runId ? parsed.data : null;
        if (record !== null) known.set(runId, record);
      }
      if (record === null) return null;
      const sameFrame = record.tabId === frame.tabId && record.frameId === frame.frameId
        && record.documentId === (frame.documentId ?? null);
      return sameFrame ? record : null;
    },
    async setSensitive(runId, sensitive) {
      const record = known.get(runId);
      if (!record) return;
      const next = { ...record, sensitive };
      known.set(runId, next);
      await session.set({ [keyOf(runId)]: next });
    },
    memo(runId) {
      let memo = memos.get(runId);
      if (!memo) {
        memo = {};
        memos.set(runId, memo);
      }
      return memo;
    },
    async forgetFrame(tabId, frameId) {
      await remove((await all()).filter((run) => run.tabId === tabId && run.frameId === frameId).map((run) => run.runId));
    },
    async forgetTab(tabId) {
      await remove((await all()).filter((run) => run.tabId === tabId).map((run) => run.runId));
    },
  };
}
