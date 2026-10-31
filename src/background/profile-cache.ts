/*
 * The profile in the worker's memory, the only place it lives. run/begin fetches GET /profile; the sensitive part
 * (work authorization, EEO, age, pronouns, pay) is fetched only when a plan needs it. Both are canonicalized with the
 * core's canonicalizeProfile over the bundled vocabulary, and both are dropped after 5 idle minutes, when the token
 * changes, and when the worker stops. The person's saved answers (Phase 6) are read with the profile (GET /answers,
 * beside GET /profile), mapped for the core and screened again (saved-answers.ts), and dropped with it: memory only. A
 * failed read of them plans with none (the profile still fills), and is counted, never logged with a value.
 */
import type { AutofillProfileEnvelope, AutofillSensitiveEnvelope } from '../contract/tailorit';
import type { Profile, SensitiveState } from '../core/types/profile';
import type { SavedAnswer } from '../core/types/saved';
import { log } from '../shared/log';
import { ymdOf, type CoreFunctions } from './core';
import { savedAnswersOf } from './saved-answers';
import type { ServerClient } from './server-client';
import type { Timers } from './timers';

/** How long the profile stays in memory after its last use. */
export const PROFILE_IDLE_MS = 5 * 60 * 1000;

/** The canonical profile, as plans read it. */
export interface LoadedProfile {
  profile: Profile;
  /** 'not-shared' once TailorIT answered 403 for the sensitive part: this token may not read it. */
  sensitiveState: SensitiveState;
  revision: number;
  /** The resume the profile names (TailorIT's documents.resumeId); null lets TailorIT choose per job. */
  resumeId: string | null;
  /** The person's saved answers (Phase 6), as the core reads them; none when they could not be read. */
  savedAnswers: readonly SavedAnswer[];
}

/** 'not-connected': no token, or TailorIT refused it. 'unavailable': TailorIT could not be read. 'internal': a bug. */
export type ProfileFailure = 'not-connected' | 'unavailable' | 'internal';
/** The profile, or why there is none. */
export type ProfileResult = { ok: true; value: LoadedProfile } | { ok: false; failure: ProfileFailure };

/** The worker's one copy of the profile. */
export interface ProfileCache {
  /** Fetches GET /profile now and keeps it. A sensitive part read at the same revision is kept with it. */
  refresh(): Promise<ProfileResult>;
  /** The profile in memory, or fetched when there is none. */
  get(): Promise<ProfileResult>;
  /** Fetches GET /profile/sensitive once. A 403 gives 'not-shared'; anything else that fails, 'unavailable'. */
  loadSensitive(): Promise<'loaded' | 'not-shared' | 'unavailable'>;
  /** Forgets everything now. */
  drop(): void;
  /** Whether anything is held (for tests and the idle check). */
  readonly holding: boolean;
}

/** What the profile cache needs. */
export interface ProfileCacheDeps {
  server: ServerClient;
  timers: Timers;
  core: Pick<CoreFunctions, 'canonicalizeProfile' | 'vocab'>;
  now(): number;
}

interface Held {
  envelope: AutofillProfileEnvelope;
  sensitive: AutofillSensitiveEnvelope | null;
  notShared: boolean;
  answers: readonly SavedAnswer[];
  loaded: LoadedProfile;
}

/** An empty cache; run/begin fills it. */
export function createProfileCache(deps: ProfileCacheDeps): ProfileCache {
  let held: Held | null = null;
  let cancelIdle: (() => void) | null = null;
  let fetching: Promise<ProfileResult> | null = null;
  /** Bumped by every drop, so an answer that arrives after a drop is not kept. */
  let generation = 0;

  function touch(): void {
    cancelIdle?.();
    cancelIdle = deps.timers.after(PROFILE_IDLE_MS, () => {
      cancelIdle = null;
      if (held !== null) log('profile.dropped', { idle: true });
      forget();
    });
  }

  function forget(): void {
    held = null;
    generation += 1;
    cancelIdle?.();
    cancelIdle = null;
  }

  /** Canonical form of the wire parts; null when the core failed (a bug, reported as 'internal'). */
  function canonical(envelope: AutofillProfileEnvelope, sensitive: AutofillSensitiveEnvelope | null, notShared: boolean,
    answers: readonly SavedAnswer[]): LoadedProfile | null {
    try {
      const result = deps.core.canonicalizeProfile(envelope.profile, sensitive?.sensitive ?? null, deps.core.vocab(),
        ymdOf(deps.now()));
      return {
        profile: result.profile,
        sensitiveState: notShared ? 'not-shared' : result.sensitiveState,
        revision: envelope.revision,
        resumeId: envelope.profile.documents.resumeId,
        savedAnswers: answers,
      };
    } catch {
      log('profile.canonicalize-failed');
      return null;
    }
  }

  async function fetchProfile(): Promise<ProfileResult> {
    // A fetch is a use: what is held cannot lapse while TailorIT answers.
    if (held !== null) touch();
    const started = generation;
    const [answer, saved] = await Promise.all([deps.server.profile(), deps.server.answers()]);
    if (!answer.ok) {
      log('profile.load-failed', { status: answer.status ?? 0 });
      const gone = answer.failure === 'not-connected' || answer.failure === 'unauthorized';
      return { ok: false, failure: gone ? 'not-connected' : 'unavailable' };
    }
    if (started !== generation) return { ok: false, failure: 'unavailable' };
    const envelope = answer.value;
    // A sensitive part from another revision is stale: it goes, and is fetched again when a plan needs it.
    const sensitive = held?.sensitive && held.sensitive.revision === envelope.revision ? held.sensitive : null;
    const notShared = held?.notShared ?? false;
    const answers = saved.ok ? savedAnswersOf(saved.value.items) : [];
    if (!saved.ok) log('profile.answers-failed', { status: saved.status ?? 0 });
    const loaded = canonical(envelope, sensitive, notShared, answers);
    if (loaded === null) return { ok: false, failure: 'internal' };
    held = { envelope, sensitive, notShared, answers, loaded };
    touch();
    log('profile.loaded', { revision: envelope.revision, sensitive: sensitive !== null, answers: answers.length });
    return { ok: true, value: loaded };
  }

  const cache: ProfileCache = {
    refresh() {
      fetching ??= fetchProfile().finally(() => {
        fetching = null;
      });
      return fetching;
    },
    async get() {
      if (held !== null) {
        touch();
        return { ok: true, value: held.loaded };
      }
      return cache.refresh();
    },
    async loadSensitive() {
      if (held === null) return 'unavailable';
      touch();
      const started = generation;
      const answer = await deps.server.sensitive();
      if (started !== generation || held === null) return 'unavailable';
      if (!answer.ok) {
        if (answer.failure !== 'forbidden') {
          log('profile.sensitive', { loaded: false, status: answer.status ?? 0 });
          return 'unavailable';
        }
        const loaded = canonical(held.envelope, null, true, held.answers);
        if (loaded === null) return 'unavailable';
        held = { ...held, sensitive: null, notShared: true, loaded };
        touch();
        log('profile.sensitive', { loaded: false, status: 403 });
        return 'not-shared';
      }
      const loaded = canonical(held.envelope, answer.value, false, held.answers);
      if (loaded === null) return 'unavailable';
      held = { ...held, sensitive: answer.value, notShared: false, loaded };
      touch();
      log('profile.sensitive', { loaded: true, status: 200 });
      return 'loaded';
    },
    drop() {
      if (held !== null) log('profile.dropped', { idle: false });
      forget();
    },
    get holding() {
      return held !== null;
    },
  };
  return cache;
}
