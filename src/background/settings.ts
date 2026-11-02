/*
 * The person's settings, in storage.local under `settings:v1`, checked with SettingsSchema on the way in and out. A
 * stored value that no longer parses gives the defaults; a version 1 value (an install from before the owner's
 * amendments, docs/SPEC-AMENDMENTS.md) is migrated, each choice still on version 1's default taking version 2's
 * (migrateSettings), a version 2 value takes version 3's new switch at its default (migrateSettingsV2, §11), and a
 * version 3 value takes the modes (migrateSettingsV3, §12: auto-advance is the Next mode, the `all` answers the AI
 * answers mode); each is stored again. Content scripts get only the part they need (panel placement, the modes, the AI
 * switches, the offer to save answers) with frame/hello and run/begin, and again with settings/changed whenever the
 * person saves them (pushSettings: every registered frame with a form, so a run in progress reads the Next mode as it
 * is now: the Phase 5 review, C-S2); they never read storage.
 */
import {
  DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, type Settings,
} from '../core/types/settings';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import {
  SETTINGS_KEY, SettingsSchema, SettingsV1Schema, SettingsV2Schema, SettingsV3Schema, type ContentSettings,
} from '../shared/settings';
import { frameTarget, type FrameEntry } from './frames';

/** The settings, as the worker reads and saves them. */
export interface SettingsStore {
  get(): Promise<Settings>;
  /** Stores checked settings and answers them as stored. */
  save(settings: Settings): Promise<Settings>;
  /** The part a content script receives. */
  content(): Promise<ContentSettings>;
}

/** How the settings act now, beside what the person chose: Submit stays Manual until the person acknowledged the
 *  disclosure as it reads now (the v3 Phase 4 review); Sign-in stays Manual unless the connection may read sign-ins
 *  (credentials:read) and the disclosure was acknowledged (v3 Phase 5); `agent`: the frame is in the auto-apply agent's
 *  window, whose runs press Next and Submit by themselves (v3 Phase 5). */
export interface ContentHolds {
  holdSubmit?: boolean;
  holdSignIn?: boolean;
  agent?: boolean;
  /** The agent's job's Submit was pressed in another document of its tab: Submit stays on Manual in this one. */
  agentSubmitHeld?: boolean;
}

/** What a content script may know of the settings. In the agent's window Next and Submit are Auto (Submit on Manual in
 *  any document but the one the job's Submit was pressed in, once it was) and every new page fills as it appears, with
 *  the person's own skip rules and Sign-in mode; a posting that forbids AI under "Ask me each
 *  time" is filled from the profile only there (nobody is there to answer its card), so the agent's "the posting forbids
 *  AI" skip rule decides at the Submit. */
export function contentSettingsOf(settings: Settings, options: ContentHolds = {}): ContentSettings {
  const agent = options.agent === true;
  return { panel: settings.panel, modes: {
    next: agent ? 'auto' : settings.modes.next,
    afterPageTurn: agent ? 'auto' : settings.modes.afterPageTurn,
    submit: agent ? (options.agentSubmitHeld === true ? 'manual' : 'auto')
      : options.holdSubmit === true ? 'manual' : settings.modes.submit,
    agentSkip: { ...settings.modes.agentSkip },
    signIn: options.holdSignIn === true ? 'manual' : settings.modes.signIn },
    llm: { ...settings.llm, ...(agent && settings.llm.whenForbidden === 'ask' ? { whenForbidden: 'profile-only' as const } : {}) },
    offerToSaveAnswers: settings.offerToSaveAnswers };
}

/** The settings as they act now (v3 Phase 3 review): every mode has shipped since v3 Phase 5 (Sign-in), so a stored
 *  value is taken as it is. Until then this kept Sign-in, and before v3 Phase 4 Submit, Manual on every read and save,
 *  so no install holds an Auto chosen before it acted. */
export function withShippedModes(settings: Settings): Settings {
  return settings;
}

/** The store over storage.local, read once and kept in memory. */
export function createSettingsStore(local: StorageArea): SettingsStore {
  let cached: Settings | null = null;

  const store: SettingsStore = {
    async get() {
      if (cached !== null) return cached;
      const stored = await local.get(SETTINGS_KEY);
      if (stored === undefined) {
        cached = DEFAULT_SETTINGS;
        return cached;
      }
      const parsed = SettingsSchema.safeParse(stored);
      if (parsed.success) {
        cached = withShippedModes(parsed.data);
        return cached;
      }
      const v3 = SettingsV3Schema.safeParse(stored);
      const v2 = v3.success ? null : SettingsV2Schema.safeParse(stored);
      const v1 = v3.success || v2?.success === true ? null : SettingsV1Schema.safeParse(stored);
      let from: 1 | 2 | 3;
      if (v3.success) {
        from = 3;
        cached = migrateSettingsV3(v3.data);
      } else if (v2?.success === true) {
        from = 2;
        cached = migrateSettingsV2(v2.data);
      } else if (v1?.success === true) {
        from = 1;
        cached = migrateSettings(v1.data);
      } else {
        log('settings.unreadable');
        cached = DEFAULT_SETTINGS;
        return cached;
      }
      try {
        await local.set({ [SETTINGS_KEY]: cached });
        log('settings.migrated', { from, to: 4 });
      } catch {
        // Kept in memory only: the next start migrates the stored value again.
        log('settings.migrated', { from, to: 4, stored: false });
      }
      return cached;
    },
    async save(settings) {
      const checked = withShippedModes(SettingsSchema.parse(settings));
      await local.set({ [SETTINGS_KEY]: checked });
      cached = checked;
      log('settings.saved');
      return checked;
    },
    async content() {
      // Without the connection's word, Sign-in acts as Manual (index.ts passes the holds it knows).
      return contentSettingsOf(await store.get(), { holdSignIn: true });
    },
  };
  return store;
}

/** Tells every registered frame with a form the content settings just saved (settings/changed). A frame that cannot be
 *  reached is skipped: its next run reads them at run/begin. Answers how many frames received them. `agentTab`: the
 *  auto-apply agent's tab, whose frames get the agent's settings (v3 Phase 5). */
export async function pushSettings(deps: { session: StorageArea; tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'> },
  settings: Settings, options: Omit<ContentHolds, 'agent'> & { agentTab?: number | null } = {}): Promise<number> {
  const { agentTab = null, ...holds } = options;
  const frames = (Object.values(await deps.session.getMany('frames:')) as FrameEntry[]).filter((frame) => frame.hasForm);
  const reached = await Promise.all(frames.map(async (frame) => {
    const message = { v: 1, type: 'settings/changed',
      settings: contentSettingsOf(settings, { ...holds, agent: frame.tabId === agentTab }) } as const;
    try {
      await deps.tabs.sendToFrame(frame.tabId, message, frameTarget(frame));
      return true;
    } catch {
      log('frame.unreachable');
      return false;
    }
  }));
  const count = reached.filter(Boolean).length;
  log('settings.pushed', { frames: count });
  return count;
}
