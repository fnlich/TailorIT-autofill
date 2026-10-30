/*
 * run/begin: a frame starts a run. The worker mints the run, fetches the profile into its memory (GET /profile) and
 * looks the page up (POST /lookup with the sender frame's own address and the stored posting text), then answers the
 * run id, the content settings and the posting's policy states: never the profile, never the lookup. The lookup's
 * suggested resume stays in memory for the resume port; its posting text is read only by the policy patterns.
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
}

/** Whether an application key fits the frame: `${platform}:${hex16}`, its platform the frame host's (when known). */
export function keyFitsFrame(applicationKey: string, frameUrl: string): boolean {
  if (!ApplicationKeySchema.safeParse(applicationKey).success) return false;
  const platform = platformOfUrl(frameUrl);
  return platform === null || applicationKey.startsWith(`${platform}:`);
}

async function lookUp(server: ServerClient, url: string): Promise<AutofillLookupResponse | null> {
  if (url.length > AUTOFILL_LOOKUP_URL_MAX) return null;
  const answer = await server.lookup({ url, includePostingText: true });
  if (answer.ok) return answer.value;
  log('run.lookup-failed', { status: answer.status ?? 0 });
  return null;
}

/** Handles run/begin for the frame that sent it. */
export async function beginRun(deps: RunBeginDeps, message: RunBegin, from: FrameRef & { url: string }):
  Promise<Answer<RunBeginAnswer>> {
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

  const [profile, lookup] = await Promise.all([deps.profiles.refresh(), lookUp(deps.server, from.url)]);
  if (!profile.ok) {
    log('run.refused', { profile: true });
    return refuse(profile.failure === 'not-connected' ? 'not_connected' : profile.failure === 'internal' ? 'internal' : 'unavailable');
  }

  const run = await deps.runs.create({ frame: from, applicationKey: message.applicationKey, dryRun: message.dryRun });
  deps.runs.memo(run.runId).lookup = lookup;
  const [postingPage, settings] = await Promise.all([deps.policy.postingPage(message.applicationKey), deps.settings.content()]);
  const storedCopy = storedCopyState(lookup?.job?.postingText, deps.core);
  log('run.begun', { dryRun: message.dryRun, lookup: lookup !== null, job: lookup?.job != null });
  return ok({ runId: run.runId, settings, policy: { postingPage, storedCopy } });
}
