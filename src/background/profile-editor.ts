/*
 * "Your autofill information" in the side panel (v3 Phase 3b; docs/ARCHITECTURE.md "v3 Phase 3b"): the person views
 * and edits the autofill profile TailorIT keeps, without leaving the application. The worker is still the only caller
 * of TailorIT:
 * - panel/profile: GET /profile (scope profile:read) and, only when the connection holds profile:sensitive, GET
 *   /profile/sensitive, answered to the side panel, an extension page, for its editor: the person's own data, shown
 *   only there, kept in the panel's memory while the editor is open, never in storage, a log line or a message to a
 *   page. `canWrite` says whether the connection holds profile:write (a connection made before API version 3 does not:
 *   the editor is then read-only and says to connect again).
 * - panel/saveProfile: PUT /profile with the revision the editor loaded, the sensitive part only where the connection
 *   may read and write it (TailorIT answers 403 otherwise). A stale revision is TailorIT's 409 `revision_conflict`
 *   ('conflict': the editor offers to load it again, the person's changes kept on screen), a value TailorIT refuses its
 *   400 ('invalid'). The profile's note, "Anything else we should know?", comes back with the lines TailorIT keeps from
 *   the AI (`anythingElseFlaggedLines`), which the editor names.
 * - Coherence: a save the worker made, or one it may have made (any answer but a refusal before TailorIT), drops the
 *   worker's own profile cache, so the next plan reads the profile as saved; a run in progress reads it at its next
 *   plan. A 409 drops it too: the profile changed elsewhere, so the copy the worker holds is no longer TailorIT's.
 *   Nothing else is cached.
 * - v5 p1-panel (the Phase 1 review, S6): panel/profileCheck reads the profile (never its sensitive part) and answers
 *   only the names of what it lacks (shared/profile-gaps.ts: the set-up view's items, and no work experience or no
 *   education), so the profile never reaches a page's process for the panel's check (the on-page sidebar).
 * - At most PROFILE_EDIT_LIMIT reads and saves a minute (one key: the side panel is one person's); the check has its
 *   own key under the same limit.
 * No value is ever logged: statuses and counts only.
 */
import { AutofillProfileSaveSchema, AutofillSensitiveSaveSchema, type ExtensionScope } from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { PageMessage, PanelSaveProfileAnswer, ProfileView } from '../messaging/schemas';
import type { ProfileCheckAnswer } from '../messaging/page-schemas';
import { log } from '../shared/log';
import { historyGaps, profileGaps } from '../shared/profile-gaps';
import type { createRateLimit } from './locks';
import type { ProfileCache } from './profile-cache';
import type { ServerClient } from './server-client';

/** The editor's reads and saves a minute: a person's pace, and a bound on what a stuck panel could ask. */
export const PROFILE_EDIT_LIMIT = { count: 20, windowMs: 60_000 } as const;

type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;

/** What the editor's handlers need. */
export interface ProfileEditorDeps {
  server: Pick<ServerClient, 'profile' | 'sensitive' | 'putProfile'>;
  /** The worker's profile cache: dropped after a save, so plans read the profile as saved. */
  profiles: Pick<ProfileCache, 'drop'>;
  connected(): Promise<boolean>;
  /** The connection's scopes (the token record's). */
  scopes(): Promise<readonly ExtensionScope[]>;
  limit: ReturnType<typeof createRateLimit>;
  /** v5 p1-panel (S6): the account's sign-in address, which an empty profile email stands for; null when not known. */
  accountEmail?(): Promise<string | null>;
}

/** The side panel's "Your autofill information". */
export function createProfileEditor(deps: ProfileEditorDeps) {
  return {
    /** panel/profile: the profile as TailorIT holds it, for the editor. */
    async read(message: Of<'panel/profile'>): Promise<Answer<ProfileView>> {
      const retry = deps.limit.take('profile');
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (!(await deps.connected())) return refuse('not_connected');
      const scopes = await deps.scopes();
      const answer = await deps.server.profile();
      if (!answer.ok) {
        log('profile.editor-read', { status: answer.status ?? 0 });
        return refuse(answer.failure === 'not-connected' || answer.failure === 'unauthorized' ? 'not_connected'
          : answer.failure === 'rate-limited' ? 'rate_limited' : 'unavailable');
      }
      let sensitive: ProfileView['sensitive'] = { state: 'not-shared' };
      // v4 ui: the side panel's completeness check asks for the profile alone (`sensitive: false`): nothing sensitive
      // is read for it.
      if (scopes.includes('profile:sensitive') && message.sensitive !== false) {
        const read = await deps.server.sensitive();
        sensitive = read.ok ? { state: 'shared', value: read.value.sensitive }
          : read.failure === 'forbidden' ? { state: 'not-shared' } : { state: 'unavailable' };
      }
      log('profile.editor-read', { status: 200, sensitive: sensitive.state === 'shared' });
      return ok({ revision: answer.value.revision, profile: answer.value.profile,
        flaggedLines: answer.value.anythingElseFlaggedLines.slice(0, 500), canWrite: scopes.includes('profile:write'),
        sensitive });
    },

    /** v5 p1-panel (S6): panel/profileCheck: what the profile lacks, by name only (module header). */
    async check(): Promise<Answer<ProfileCheckAnswer>> {
      const retry = deps.limit.take('check');
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (!(await deps.connected())) return refuse('not_connected');
      const answer = await deps.server.profile();
      if (!answer.ok) {
        log('profile.editor-read', { status: answer.status ?? 0 });
        return refuse(answer.failure === 'not-connected' || answer.failure === 'unauthorized' ? 'not_connected'
          : answer.failure === 'rate-limited' ? 'rate_limited' : 'unavailable');
      }
      const email = (await deps.accountEmail?.()) ?? null;
      return ok({ gaps: profileGaps(answer.value.profile, email), history: historyGaps(answer.value.profile) });
    },

    /** panel/saveProfile: the editor's save (module header). */
    async save(message: Of<'panel/saveProfile'>): Promise<Answer<PanelSaveProfileAnswer>> {
      const retry = deps.limit.take('profile');
      if (retry !== null) return ok({ outcome: 'rate-limited' });
      if (!(await deps.connected())) return ok({ outcome: 'not-connected' });
      const scopes = await deps.scopes();
      if (!scopes.includes('profile:write')) return ok({ outcome: 'not-allowed' });
      // What TailorIT checks on a save, checked first: a value it would refuse is said at once, and nothing is sent.
      const profile = AutofillProfileSaveSchema.safeParse(message.profile);
      const sensitive = message.sensitive === undefined ? null : AutofillSensitiveSaveSchema.safeParse(message.sensitive);
      if (!profile.success || (sensitive !== null && !sensitive.success)) {
        log('profile.editor-save', { checked: false });
        return ok({ outcome: 'invalid' });
      }
      // The sensitive part only where the connection may read it: TailorIT refuses it otherwise.
      if (sensitive !== null && !scopes.includes('profile:sensitive')) return ok({ outcome: 'not-allowed' });
      const answer = await deps.server.putProfile({ revision: message.revision, profile: profile.data,
        ...(sensitive === null ? {} : { sensitive: sensitive.data! }) });
      // TailorIT may have saved it (an answer that did not read, a time-out): the cache goes either way. A conflict
      // means it changed elsewhere since: the worker's copy is stale, and goes too.
      if (answer.ok || !['not-connected', 'unauthorized', 'forbidden', 'bad-request', 'rate-limited',
        'refused-path'].includes(answer.failure)) deps.profiles.drop();
      if (answer.ok) {
        log('profile.editor-save', { status: 200, flagged: answer.value.anythingElseFlaggedLines.length });
        return ok({ outcome: 'saved', revision: answer.value.revision,
          flaggedLines: answer.value.anythingElseFlaggedLines.slice(0, 500) });
      }
      log('profile.editor-save', { status: answer.status ?? 0 });
      if (answer.failure === 'conflict') return ok({ outcome: 'conflict' });
      if (answer.failure === 'bad-request') return ok({ outcome: 'invalid' });
      if (answer.failure === 'forbidden') return ok({ outcome: 'not-allowed' });
      if (answer.failure === 'not-connected' || answer.failure === 'unauthorized') return ok({ outcome: 'not-connected' });
      if (answer.failure === 'rate-limited') return ok({ outcome: 'rate-limited' });
      return ok({ outcome: 'unavailable' });
    },
  };
}

/** The profile editor, as index.ts wires it. */
export type ProfileEditor = ReturnType<typeof createProfileEditor>;
