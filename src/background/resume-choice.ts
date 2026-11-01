/*
 * Which resume a run attaches (ARCHITECTURE "Resume transfer"): the one the person chose in the side panel for the
 * run's tab (v2: its lookup asked TailorIT for it, so TailorIT names it as the suggestion when it can be attached), else
 * the lookup's suggestion, which TailorIT already falls back to the profile's choice, the default or the latest; and when
 * the lookup failed, the chosen resume, else the profile's own choice. The planner attaches it to the profile it plans
 * with, and the resume port sends it, so the field a plan fills with the resume and the file that arrives are the same
 * one. A run chooses once and keeps the answer in its memory-only memo; a choice TailorIT could not be asked for is not
 * kept, so a later ask can still find it, and nothing read with a token that has since changed is kept or used.
 *
 * v2: the tab's choice is read at every ask, so a Change the person makes while a run goes on applies to every file the
 * run has not uploaded yet: the run's kept choice goes, and its lookup's suggestion (asked for the old choice) is asked
 * again for the new one. A file already uploaded stays as it is.
 */
import type { AutofillFileKind } from '../contract/tailorit';
import type { ProfileCache } from './profile-cache';
import type { RunMemo, RunRegistry } from './runs';
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
  /** The resume the person chose for a tab in the side panel now (job-cards.ts; null: none). */
  chosen?(tabId: number): string | null;
}

/** Chooses a run's resume from the frame at `url`: null when there is none to attach or TailorIT could not say. */
export type ResumeChooser = (runId: string, url: string) => Promise<ResumeChoice | null>;

/** The chooser the planner and the resume port share; both read and keep the choice in the run's memo. */
export function createResumeChooser(deps: ResumeChooserDeps): ResumeChooser {
  /** The tab's choice changed since the run chose (a Change mid-run): what was chosen for the old one goes. */
  async function followTab(memo: RunMemo, url: string, current: () => boolean): Promise<boolean> {
    if (memo.tabId === undefined || deps.chosen === undefined) return true;
    const now = deps.chosen(memo.tabId);
    if (now === (memo.chosen ?? null)) return true;
    memo.chosen = now;
    memo.resume = undefined;
    // The lookup named its suggestion for the old choice; its job facts stay, its suggestion is asked again.
    if (memo.lookup !== undefined && memo.lookup !== null) {
      const answer = await deps.server.lookup({ url, includePostingText: false, ...(now === null ? {} : { resumeId: now }) });
      if (!current()) return false;
      if (memo.lookup !== null && memo.lookup !== undefined) {
        memo.lookup = { ...memo.lookup, suggestedResume: answer.ok ? answer.value.suggestedResume : null,
          match: answer.ok ? answer.value.match : null };
      }
    }
    return true;
  }

  return async (runId, url) => {
    const memo = deps.runs.memo(runId);
    const generation = deps.generation?.() ?? 0;
    const current = () => (deps.generation?.() ?? 0) === generation;
    if (!(await followTab(memo, url, current))) return null;
    if (memo.resume !== undefined) return memo.resume;
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
