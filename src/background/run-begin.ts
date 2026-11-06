/*
 * run/begin: a frame starts a run. The worker mints the run, fetches the profile into its memory (GET /profile) and
 * looks the page up (POST /lookup with the sender frame's own address and the stored posting text), then answers the
 * run id, the content settings and the posting's policy states: never the profile, never the lookup. The lookup's
 * suggested resume stays in memory for the resume port; its posting text is read only by the policy patterns.
 *
 * v2: the lookup asks for the resume the person chose for the tab in the side panel (resumeId), which the run keeps as
 * its chosen resume; the lookup, without its posting text, also becomes the frame document's job card (job-cards.ts),
 * so the card shows what this fill attaches with no request of its own. A lookup answered after the token changed is
 * not kept: the run reads it again with the new one when it needs it. The address is the top frame's tab address now
 * (senders.ts, which follows a single-page application); a subframe such an application moved is not looked up.
 *
 * v3 Phase 3b: the job the person chose for the page ("Autofill for another job") goes with the lookup as `jobId`, so
 * the run's job (the card, the match, the resume, the AI's company and title, the cover letter's job) is that one.
 */
import { AUTOFILL_LOOKUP_URL_MAX, type AutofillLookupResponse } from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { ContentMessage, RunBeginAnswerSchema } from '../messaging/schemas';
import { platformOfUrl } from '../shared/hosts';
import { log } from '../shared/log';
import { ApplicationKeySchema } from '../shared/stored';
import type { z } from 'zod';
import type { CoreFunctions } from './core';
import type { createRateLimit } from './locks';
import { storedCopyState, type PolicyBook } from './policy';
import type { ProfileCache } from './profile-cache';
import type { JobCards } from './job-cards';
import type { FrameRef, RunRegistry } from './runs';
import type { RunStateStore } from './runstate-store';
import type { ServerClient } from './server-client';
import type { SettingsStore } from './settings';

/** run/begin's limit per tab (runtime.md §4.1). */
export const RUN_BEGIN_LIMIT = { count: 6, windowMs: 60_000 } as const;

type RunBeginAnswer = z.infer<typeof RunBeginAnswerSchema>;
type RunBegin = Extract<ContentMessage, { type: 'run/begin' }>;

/** What run/begin needs. */
export interface RunBeginDeps {
  storageAccess(): 'pending' | 'restricted' | 'refused';
  connected(): Promise<boolean>;
  limit: ReturnType<typeof createRateLimit>;
  profiles: ProfileCache;
  server: ServerClient;
  runs: RunRegistry;
  runStates: RunStateStore;
  policy: PolicyBook;
  settings: SettingsStore;
  core: Pick<CoreFunctions, 'policyHits'>;
  /** The side panel's job cards (v2): the tab's chosen resume, and where the lookup is kept as the card (with the
   *  document's epoch taken before it was asked, so a lookup that outlived its page is not kept); and whether Chrome's
   *  address for the frame may be a posting a single-page application has left (then nothing is looked up). */
  jobs?: Pick<JobCards, 'chosen' | 'remember' | 'epoch' | 'addressStale'> & Partial<Pick<JobCards, 'chosenJob'>>;
  /** The token keeper's generation (auth.ts). */
  generation?(): number;
}

/** Whether an application key fits the frame: `${platform}:${hex16}`, its platform the frame host's (when known). A
 *  company's own https page (v3 Phase 8: the frames the worker injected off the ATS hosts) takes the site's keys alone. */
export function keyFitsFrame(applicationKey: string, frameUrl: string): boolean {
  if (!ApplicationKeySchema.safeParse(applicationKey).success) return false;
  const platform = platformOfUrl(frameUrl) ?? (/^https:\/\//i.test(frameUrl) ? 'site' : null);
  return platform === null || applicationKey.startsWith(`${platform}:`);
}

async function lookUp(server: ServerClient, url: string, chosen: string | null, job: number | null):
  Promise<AutofillLookupResponse | null> {
  if (url.length > AUTOFILL_LOOKUP_URL_MAX) return null;
  const answer = await server.lookup({ url, includePostingText: true, ...(chosen === null ? {} : { resumeId: chosen }),
    ...(job === null ? {} : { jobId: job }) });
  if (answer.ok) return answer.value;
  log('run.lookup-failed', { status: answer.status ?? 0 });
  return null;
}

/** Handles run/begin for the frame that sent it. */
export async function beginRun(deps: RunBeginDeps, message: RunBegin,
  from: FrameRef & { url: string; addressFrom?: 'tab' | 'document' }): Promise<Answer<RunBeginAnswer>> {
  if (deps.storageAccess() === 'refused') {
    log('run.refused', { storage: true });
    return refuse('unavailable');
  }
  const retry = deps.limit.take(`${from.tabId}/`);
  if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
  if (!keyFitsFrame(message.applicationKey, from.url)) return refuse('bad_message');
  if (!(await deps.connected())) return refuse('not_connected');
  if (message.trigger === 'resume' && !(await deps.runStates.activeFor(message.applicationKey, from.tabId))) {
    log('run.refused', { resume: true });
    return refuse('expired');
  }

  const generation = deps.generation?.() ?? 0;
  const chosen = deps.jobs?.chosen(from.tabId) ?? null;
  const job = deps.jobs?.chosenJob?.(from.tabId, message.applicationKey) ?? null;
  const epoch = deps.jobs?.epoch(from) ?? '';
  // A subframe a single-page application moved: Chrome's address for it is the posting it left, so none is asked for
  // (the run goes on as with a lookup that failed).
  const stale = (await deps.jobs?.addressStale(from)) ?? false;
  const [profile, lookup] = await Promise.all([deps.profiles.refresh(),
    stale ? Promise.resolve(null) : lookUp(deps.server, from.url, chosen, job)]);
  if (!profile.ok) {
    log('run.refused', { profile: true });
    return refuse(profile.failure === 'not-connected' ? 'not_connected' : profile.failure === 'internal' ? 'internal' : 'unavailable');
  }

  const run = await deps.runs.create({ frame: from, applicationKey: message.applicationKey, dryRun: message.dryRun });
  const memo = deps.runs.memo(run.runId);
  memo.chosen = chosen;
  // The tab the run belongs to, so its resume follows a Change the person makes while it runs (resume-choice.ts).
  memo.tabId = from.tabId;
  // Read with a token that has since changed: not kept (the run reads it again with the new one when it needs it).
  if ((deps.generation?.() ?? 0) === generation) {
    memo.lookup = lookup;
    deps.jobs?.remember(from, lookup, { generation, epoch, chosen, job });
    // The audit of 2026-11-06 (M6): the job's id in the run's record too, for a Submit after the worker was stopped.
    await deps.runs.noteAttached(run.runId, { jobId: lookup?.job?.id ?? null });
  }
  const [postingPage, settings] = await Promise.all([deps.policy.postingPage(message.applicationKey), deps.settings.content()]);
  const storedCopy = storedCopyState(lookup?.job?.postingText, deps.core);
  log('run.begun', { dryRun: message.dryRun, lookup: lookup !== null, job: lookup?.job != null });
  return ok({ runId: run.runId, settings, policy: { postingPage, storedCopy } });
}
