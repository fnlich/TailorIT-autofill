/*
 * Which resume a run attaches (ARCHITECTURE "Resume transfer"): the one the person chose in the side panel for the
 * run's tab (v2: its lookup asked TailorIT for it, so TailorIT names it as the suggestion when it can be attached), else
 * the lookup's suggestion, which TailorIT already falls back to the profile's choice, the default or the latest; and when
 * the lookup failed, the chosen resume, else the profile's own choice. The planner attaches it to the profile it plans
 * with, and the resume port sends it, so the field a plan fills with the resume and the file that arrives are the same
 * one. A run chooses once and keeps the answer in its memory-only memo; a choice TailorIT could not be asked for is not
 * kept, so a later ask can still find it, and nothing read with a token that has since changed is kept or used.
 */
import type { AutofillFileKind } from '../contract/tailorit';
import type { ProfileCache } from './profile-cache';
import type { RunRegistry } from './runs';
import type { ServerClient } from './server-client';

/** The resume a run attaches: its id, what TailorIT says it is, and the name it is uploaded under. */
export interface ResumeChoice {
  id: string;
  fileKind: AutofillFileKind;
  fileName: string;
}

/** What choosing needs. */
export interface ResumeChooserDeps {
  runs: RunRegistry;
  server: ServerClient;
  profiles: ProfileCache;
  /** The token keeper's generation (auth.ts): what was read across a change is dropped. */
  generation?(): number;
}

/** Chooses a run's resume from the frame at `url`: null when there is none to attach or TailorIT could not say. */
export type ResumeChooser = (runId: string, url: string) => Promise<ResumeChoice | null>;

/** The chooser the planner and the resume port share; both read and keep the choice in the run's memo. */
export function createResumeChooser(deps: ResumeChooserDeps): ResumeChooser {
  return async (runId, url) => {
    const memo = deps.runs.memo(runId);
    if (memo.resume !== undefined) return memo.resume;
    const generation = deps.generation?.() ?? 0;
    const current = () => (deps.generation?.() ?? 0) === generation;
    const chosen = memo.chosen ?? null;
    // After the worker was stopped the run's lookup is gone: read it again from the frame's own address.
    if (memo.lookup === undefined) {
      const answer = await deps.server.lookup({ url, includePostingText: false, ...(chosen === null ? {} : { resumeId: chosen }) });
      if (!current()) return null;
      memo.lookup = answer.ok ? answer.value : null;
    }
    const suggested = memo.lookup?.suggestedResume;
    if (suggested) {
      memo.resume = { id: suggested.id, fileKind: suggested.fileKind, fileName: suggested.fileName };
      return memo.resume;
    }
    let wanted = chosen;
    if (wanted === null) {
      const profile = await deps.profiles.get();
      if (!profile.ok || !current()) return null;
      if (profile.value.resumeId === null) {
        memo.resume = null;
        return null;
      }
      wanted = profile.value.resumeId;
    }
    const list = await deps.server.resumes();
    if (!list.ok || !current()) return null;
    const item = list.value.items.find((entry) => entry.id === wanted);
    memo.resume = item ? { id: item.id, fileKind: item.fileKind, fileName: item.fileName } : null;
    return memo.resume;
  };
}
