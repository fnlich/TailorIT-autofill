/*
 * The runs the worker knows. run/begin mints a run id per document and remembers the run's tab, frame, document,
 * applicationKey and mode, so plan/request, plan/poll, report/put and the resume port can check that a message comes
 * from the frame that began it. The record is value-free and kept in storage.session (`runs:<runId>`), so a run
 * survives the worker being stopped between messages; what a run looked up (its lookup answer) stays in memory only,
 * but for the ids a Submit records (the audit of 2026-11-06, M6): the job its lookup named and the resume it attaches,
 * which its record keeps (noteAttached) until the token changes.
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
import type { RunLetter } from './cover-letters';
import type { RunKnown } from './known-forms';
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
  /** The run's cover letter (Phase G, cover-letters.ts): asked once, stopped when the run goes. */
  letter?: RunLetter;
  /** v1.3 B: the job's known questions and the person's earlier answers (known-forms.ts), memory only. */
  known?: RunKnown;
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
   *  for it, its cover letter), so nothing of one connection reaches the next; a run that still needs them reads them
   *  again. */
  dropTokenData(): Promise<void>;
  /** TailorIT started writing the run's cover letter (Phase G): its record says so (a flag, no id), so a worker that
   *  restarted still marks that letter as the AI's. */
  noteLetterWritten(runId: string): Promise<void>;
  /** The audit of 2026-11-06 (M6): the job the run's lookup named and the resume it attaches (ids, null: none), kept
   *  in its record so a Submit after the worker was stopped still records them. An id left out stays as it was. */
  noteAttached(runId: string, ids: { jobId?: number | null; resumeId?: string | null }): Promise<void>;
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
    // Another call loaded it, and may have changed it, while this one read storage: memory's copy is the current one.
    const meanwhile = known.get(runId);
    if (meanwhile) return meanwhile;
    if (record !== null) known.set(runId, record);
    return record;
  }

  async function remove(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    for (const runId of runIds) {
      known.delete(runId);
      memos.get(runId)?.ai?.stop();
      memos.get(runId)?.letter?.stop();
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
    async dropTokenData() {
      for (const memo of memos.values()) {
        memo.lookup = undefined;
        memo.resume = undefined;
        memo.chosen = undefined;
        // A cover letter asked with the old token is never uploaded with the new one (Phase G).
        memo.letter?.stop();
        memo.letter = undefined;
        // v1.3 B: what the old connection's TailorIT knew of the form.
        memo.known = undefined;
      }
      // The ids the old connection's lookup gave go from the records too (M6).
      for (const record of await all()) {
        if (record.jobId === undefined && record.resumeId === undefined) continue;
        const next: RunRecord = { ...(known.get(record.runId) ?? record) };
        delete next.jobId;
        delete next.resumeId;
        known.set(record.runId, next);
        await session.set({ [keyOf(record.runId)]: next });
      }
    },
    async noteAttached(runId, ids) {
      const loaded = await load(runId);
      const record = loaded === null ? null : known.get(runId) ?? loaded;
      if (record === null) return;
      const next: RunRecord = { ...record, ...(ids.jobId === undefined ? {} : { jobId: ids.jobId }),
        ...(ids.resumeId === undefined ? {} : { resumeId: ids.resumeId }) };
      if (next.jobId === record.jobId && next.resumeId === record.resumeId) return;
      known.set(runId, next);
      await session.set({ [keyOf(runId)]: next });
    },
    async noteLetterWritten(runId) {
      const loaded = await load(runId);
      // What memory holds now: a setSensitive that ran while the record was read is kept (the Phase G review, MINOR 6).
      const record = loaded === null ? null : known.get(runId) ?? loaded;
      if (record === null || record.letterWritten === true) return;
      const next = { ...record, letterWritten: true as const };
      known.set(runId, next);
      await session.set({ [keyOf(runId)]: next });
    },
  };
}
