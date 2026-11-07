/*
 * The person's settings, in storage.local under `settings:v1`, checked with SettingsSchema on the way in and out. A
 * stored value that no longer parses gives the defaults; a version 1 value (an install from before the owner's
 * amendments, docs/SPEC-AMENDMENTS.md) is migrated, each choice still on version 1's default taking version 2's
 * (migrateSettings), a version 2 value takes version 3's new switch at its default (migrateSettingsV2, §11), and a
 * version 3 value takes the modes (migrateSettingsV3, §12: auto-advance is the Next mode, the `all` answers the AI
 * answers mode), and a version 4 value takes "Résumé already on the page" at its default, Keep it (migrateSettingsV4,
 * the behaviour review of 2026-11-06); each is stored again. Content scripts get only the part they need (panel placement, the modes, the AI
 * switches, the offer to save answers) with frame/hello and run/begin, and again with settings/changed whenever the
 * person saves them (pushSettings: every registered frame with a form, so a run in progress reads the Next mode as it
 * is now: the Phase 5 review, C-S2), each frame the settings as they act for it (contentSettingsFor: the agent's tab's
 * documents their own, the audit's m1); they never read storage.
 * The audit of 2026-11-06 (M4): a page's save names the settings it last read (`base`), and only what it changed from
 * them is applied to the settings stored now (mergeSettings), so the options page left open never puts back a mode the
 * side panel's gear changed meanwhile.
 */
import {
  DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, migrateSettingsV4, type Settings,
} from '../core/types/settings';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { SETTINGS_KEY, SettingsSchema, type ContentSettings } from '../shared/settings';
import { SettingsV1Schema, SettingsV2Schema, SettingsV3Schema, SettingsV4Schema } from '../shared/settings-stored';
import { frameTarget, type FrameEntry } from './frames';
import { createKeyedQueue } from './locks';

/** The settings, as the worker reads and saves them. */
export interface SettingsStore {
  get(): Promise<Settings>;
  /** Stores checked settings and answers them as stored. With `base` (the settings the page last read), only what
   *  `settings` changed from it is applied to the stored settings (mergeSettings, the audit's M4). */
  save(settings: Settings, base?: Settings): Promise<Settings>;
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

/** A plain object (not an array): its keys are merged one by one. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The audit of 2026-11-06 (M4): `next` as a change of `base` applied to `current`. Every setting (a leaf: a choice, a
 * switch, the pre-approved list as a whole) that `next` holds as `base` did is taken from `current`, which may have
 * changed since the page read `base`; every one the page changed is taken from `next`.
 */
export function mergeSettings(current: Settings, base: Settings, next: Settings): Settings {
  const merge = (now: unknown, was: unknown, wanted: unknown): unknown => {
    if (isRecord(now) && isRecord(was) && isRecord(wanted)) {
      const out: Record<string, unknown> = { ...now };
      for (const key of Object.keys(wanted)) out[key] = merge(now[key], was[key], wanted[key]);
      return out;
    }
    return JSON.stringify(wanted) === JSON.stringify(was) ? now : wanted;
  };
  return merge(current, base, next) as Settings;
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
  /** One save at a time: each merges onto what the one before stored (M4). */
  const saves = createKeyedQueue();

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
      const v4 = SettingsV4Schema.safeParse(stored);
      const v3 = v4.success ? null : SettingsV3Schema.safeParse(stored);
      const v2 = v4.success || v3?.success === true ? null : SettingsV2Schema.safeParse(stored);
      const v1 = v4.success || v3?.success === true || v2?.success === true ? null : SettingsV1Schema.safeParse(stored);
      let from: 1 | 2 | 3 | 4;
      if (v4.success) {
        from = 4;
        cached = migrateSettingsV4(v4.data);
      } else if (v3?.success === true) {
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
        log('settings.migrated', { from, to: 5 });
      } catch {
        // Kept in memory only: the next start migrates the stored value again.
        log('settings.migrated', { from, to: 5, stored: false });
      }
      return cached;
    },
    save(settings, base) {
      return saves.run(SETTINGS_KEY, async () => {
        const wanted = base === undefined ? settings : mergeSettings(await store.get(), base, settings);
        const checked = withShippedModes(SettingsSchema.parse(wanted));
        await local.set({ [SETTINGS_KEY]: checked });
        cached = checked;
        log('settings.saved');
        return checked;
      });
    },
    async content() {
      // Without the connection's word, Sign-in acts as Manual (index.ts passes the holds it knows).
      return contentSettingsOf(await store.get(), { holdSignIn: true });
    },
  };
  return store;
}

/** Tells every registered frame with a form the content settings as they act now for it (settings/changed). A frame
 *  that cannot be reached is skipped: its next run reads them at run/begin. Answers how many frames received them.
 *  `contentFor`: the frame's own (index.ts contentSettingsFor), so the auto-apply agent's tab gets the agent's
 *  settings for its task's application, with Submit on Manual in a document but the one the job's Submit was pressed
 *  in (v3 Phase 5; the audit of 2026-11-06, m1: the whole tab got Submit on Auto before). */
export async function pushSettings(deps: { session: StorageArea; tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'> },
  contentFor: (frame: FrameEntry) => Promise<ContentSettings>): Promise<number> {
  const frames = (Object.values(await deps.session.getMany('frames:')) as FrameEntry[]).filter((frame) => frame.hasForm);
  const reached = await Promise.all(frames.map(async (frame) => {
    const message = { v: 1, type: 'settings/changed', settings: await contentFor(frame) } as const;
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
