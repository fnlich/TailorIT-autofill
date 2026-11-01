/*
 * The runs the worker knows. run/begin mints a run id per document and remembers the run's tab, frame, document,
 * applicationKey and mode, so plan/request, plan/poll, report/put and the resume port can check that a message comes
 * from the frame that began it. The record is value-free and kept in storage.session (`runs:<runId>`), so a run
 * survives the worker being stopped between messages; what a run looked up (its lookup answer) stays in memory only.
 * A run is gone when its tab closes, when its frame begins another run, when the document it was begun in is gone (its
 * frame loaded another one, or the frame check found it gone: only that document's runs go), and when the browser
 * restarts.
 */
import type { AutofillLookupResponse } from '../contract/tailorit';
import type { CompanyScope } from '../core/resolver/saved';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { RUN_PREFIX, RunRecordSchema, type RunRecord } from '../shared/stored';
import { toBase64Url } from './bytes';
import type { RunAi } from './ai-tasks';
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
 *  `resume` is undefined until the run chose the resume it attaches (resume-choice.ts), null when it has none; `ai`
 *  is the run's LLM questions and answers (Phase 4, ai-tasks.ts), stopped when the run goes; `company` the company its
 *  frame's address names (Phase 6). */
export interface RunMemo {
  lookup?: AutofillLookupResponse | null;
  resume?: ResumeChoice | null;
  ai?: RunAi;
  /** The company the run's frame address names (Phase 6, set at each plan; null: none), for a free-text answer the
   *  person saves. */
  company?: CompanyScope | null;
  /** The resume the person chose in the side panel for the run's tab (v2; null: none chosen), as the run last chose
   *  with: its lookup asked for it, and the run attaches it first (resume-choice.ts). A Change while the run goes on
   *  replaces it at the next file the run uploads. */
  chosen?: string | null;
  /** The run's tab (v2, set at run/begin), whose resume choice the run follows. */
  tabId?: number;
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
  /** The document a run was begun in (null: one Chrome gave no id), or undefined when no such run is known. */
  documentOf(runId: string): Promise<string | null | undefined>;
  /** Forgets the runs a frame began in one document (null: a document Chrome gave no id). The runs of the frame's
   *  other documents stay: a page restored from the back/forward cache may be running one. */
  forgetDocument(tabId: number, frameId: number, documentId: string | null): Promise<void>;
  forgetTab(tabId: number): Promise<void>;
  /** The token changed: every run forgets what it read with the old one (its lookup, its resume and the resume chosen
   *  for it), so nothing of one connection reaches the next; a run that still needs them reads them again. */
  dropTokenData(): void;
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

  /** The run's record, from memory or storage.session; null when there is no such run. */
  async function load(runId: string): Promise<RunRecord | null> {
    const held = known.get(runId);
    if (held) return held;
    const parsed = RunRecordSchema.safeParse(await session.get(keyOf(runId)));
    const record = parsed.success && parsed.data.runId === runId ? parsed.data : null;
    if (record !== null) known.set(runId, record);
    return record;
  }

  async function remove(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    for (const runId of runIds) {
      known.delete(runId);
      memos.get(runId)?.ai?.stop();
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
      const record = await load(runId);
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
    async documentOf(runId) {
      const record = await load(runId);
      return record === null ? undefined : record.documentId;
    },
    async forgetDocument(tabId, frameId, documentId) {
      await remove((await all())
        .filter((run) => run.tabId === tabId && run.frameId === frameId && run.documentId === documentId)
        .map((run) => run.runId));
    },
    async forgetTab(tabId) {
      await remove((await all()).filter((run) => run.tabId === tabId).map((run) => run.runId));
    },
    dropTokenData() {
      for (const memo of memos.values()) {
        memo.lookup = undefined;
        memo.resume = undefined;
        memo.chosen = undefined;
      }
    },
  };
}
