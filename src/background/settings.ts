/*
 * The person's settings, in storage.local under `settings:v1`, checked with SettingsSchema on the way in and out. A
 * stored value that no longer parses gives the defaults; a version 1 value (an install from before the owner's
 * amendments, docs/SPEC-AMENDMENTS.md) is migrated, each choice still on version 1's default taking version 2's
 * (migrateSettings), a version 2 value takes version 3's new switch at its default (migrateSettingsV2, §11), and a
 * version 3 value takes the modes (migrateSettingsV3, §12: auto-advance is the Next mode, the `all` answers the AI
 * answers mode), and a version 4 value takes "Résumé already on the page" at its default, Keep it (migrateSettingsV4,
 * the behaviour review of 2026-11-06), and a version 5 value loses "Ask me each time" (Profile only) and the draft
 * confirmation (migrateSettingsV5, v4: the run never asks the person), and a version 6 value takes snapshot round 2's
 * two modes at their defaults, Other and Until closed (migrateSettingsV6), and every version 7 value shows the panel on
 * the page, its in-page card and its side panel alike (migrateSettingsV7, v5: the owner's word), and every version 8
 * value keeps the answers of the applications the person submits (migrateSettingsV8, v1.3 B: On), and every version 9
 * value shows the confirm before editing an uploaded resume (migrateSettingsV9, v1.5 X); each is stored again.
 * Content scripts get only the part they need (panel placement, the modes, the AI switches, the offer to save answers)
 * with frame/hello and run/begin, and again with settings/changed whenever the person saves them (pushSettings: every
 * registered frame with a form, so a run in progress reads the Next mode as it is now: the Phase 5 review, C-S2), each
 * frame the settings as they act for it (contentSettingsFor: the agent's tab's documents their own, the audit's m1);
 * they never read storage.
 * The audit of 2026-11-06 (M4): a page's save names the settings it last read (`base`), and only what it changed from
 * them is applied to the settings stored now (mergeSettings), so the options page left open never puts back a mode the
 * side panel's gear changed meanwhile.
 */
import {
  DEFAULT_SETTINGS, migrateSettings, migrateSettingsV2, migrateSettingsV3, migrateSettingsV4, migrateSettingsV5,
  migrateSettingsV6, migrateSettingsV7, migrateSettingsV8, migrateSettingsV9, SETTINGS_VERSION, type Settings,
} from '../core/types/settings';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { SETTINGS_KEY, SettingsSchema, type ContentSettings } from '../shared/settings';
import {
  SettingsV1Schema, SettingsV2Schema, SettingsV3Schema, SettingsV4Schema, SettingsV5Schema, SettingsV6Schema,
  SettingsV7Schema, SettingsV8Schema, SettingsV9Schema,
} from '../shared/settings-stored';
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
  /** v4: the tab holds a Sign up & Autofill grant (background/sign-up.ts): Sign-in acts as Auto there, unless held. */
  signUp?: boolean;
}

/** What a content script may know of the settings. In the agent's window Next and Submit are Auto (Submit on Manual in
 *  any document but the one the job's Submit was pressed in, once it was) and every new page fills as it appears, with
 *  the person's own skip rules and Sign-in mode (v4: no setting asks the person any more, so nothing else changes
 *  there). v5 p1-shell (the review's F5): there the sidebar never opens by itself ("Default view" Minimized), so
 *  nothing of it pushes the agent's pages aside or reads them for its card. */
export function contentSettingsOf(settings: Settings, options: ContentHolds = {}): ContentSettings {
  const agent = options.agent === true;
  return { panel: settings.panel, view: agent ? 'minimized' : settings.view, modes: {
    next: agent ? 'auto' : settings.modes.next,
    afterPageTurn: agent ? 'auto' : settings.modes.afterPageTurn,
    submit: agent ? (options.agentSubmitHeld === true ? 'manual' : 'auto')
      : options.holdSubmit === true ? 'manual' : settings.modes.submit,
    agentSkip: { ...settings.modes.agentSkip },
    signIn: options.holdSignIn === true ? 'manual' : options.signUp === true ? 'auto' : settings.modes.signIn,
    // Version 7 (s2 profile): the person's own, everywhere (the agent's window too).
    noMatch: settings.modes.noMatch, notifications: settings.modes.notifications },
    llm: { ...settings.llm },
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

/** v5 p1-shell (the review's S7): whether `next` lets the extension act more on its own than `current`: Submit or
 *  Sign-in moved to Auto, or a rule that leaves a job for the person (agentSkip) turned off. A save from the sidebar on
 *  the page that does so is refused: those choices are made on the extension's own pages. */
export function raisesAutonomy(current: Settings, next: Settings): boolean {
  const { modes: was } = current;
  const { modes: now } = next;
  return (now.submit === 'auto' && was.submit !== 'auto') || (now.signIn === 'auto' && was.signIn !== 'auto')
    || (!now.agentSkip.requiredEmpty && was.agentSkip.requiredEmpty) || (!now.agentSkip.noAi && was.agentSkip.noAi)
    || (!now.agentSkip.legalGuess && was.agentSkip.legalGuess);
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
      // v1.5 X: version 9 (before the extension's UI choices), and v1.3 B: version 8 (before "Keep my submitted answers
      // in TailorIT").
      const v9 = SettingsV9Schema.safeParse(stored);
      if (v9.success) {
        cached = migrateSettingsV9(v9.data);
        try {
          await local.set({ [SETTINGS_KEY]: cached });
          log('settings.migrated', { from: 9, to: SETTINGS_VERSION });
        } catch {
          log('settings.migrated', { from: 9, to: SETTINGS_VERSION, stored: false });
        }
        return cached;
      }
      const v8 = SettingsV8Schema.safeParse(stored);
      if (v8.success) {
        cached = migrateSettingsV8(v8.data);
        try {
          await local.set({ [SETTINGS_KEY]: cached });
          log('settings.migrated', { from: 8, to: SETTINGS_VERSION });
        } catch {
          log('settings.migrated', { from: 8, to: SETTINGS_VERSION, stored: false });
        }
        return cached;
      }
      // v5 p1-shell: version 7 (before "Where the panel shows").
      const v7 = SettingsV7Schema.safeParse(stored);
      const v6 = v7.success ? null : SettingsV6Schema.safeParse(stored);
      const v5 = v7.success || v6?.success === true ? null : SettingsV5Schema.safeParse(stored);
      const v4 = v7.success || v6?.success === true || v5?.success === true ? null : SettingsV4Schema.safeParse(stored);
      const newer = v7.success || v6?.success === true || v5?.success === true;
      const v3 = newer || v4?.success === true ? null : SettingsV3Schema.safeParse(stored);
      const v2 = newer || v4?.success === true || v3?.success === true ? null : SettingsV2Schema.safeParse(stored);
      const v1 = newer || v4?.success === true || v3?.success === true || v2?.success === true ? null
        : SettingsV1Schema.safeParse(stored);
      let from: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      if (v7.success) {
        from = 7;
        cached = migrateSettingsV7(v7.data);
      } else if (v6?.success === true) {
        from = 6;
        cached = migrateSettingsV6(v6.data);
      } else if (v5?.success === true) {
        from = 5;
        cached = migrateSettingsV5(v5.data);
      } else if (v4?.success === true) {
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
        log('settings.migrated', { from, to: SETTINGS_VERSION });
      } catch {
        // Kept in memory only: the next start migrates the stored value again.
        log('settings.migrated', { from, to: SETTINGS_VERSION, stored: false });
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

/** Tells every registered frame with a form, and (v5 p1-shell, the review's F1) every tab's top frame of ours, whose
 *  sidebar follows "Where the panel shows" and "Default view", the content settings as they act now for it
 *  (settings/changed). A frame that cannot be reached is skipped: its next run reads them at run/begin. Answers how many
 *  frames received them.
 *  `contentFor`: the frame's own (index.ts contentSettingsFor), so the auto-apply agent's tab gets the agent's
 *  settings for its task's application, with Submit on Manual in a document but the one the job's Submit was pressed
 *  in (v3 Phase 5; the audit of 2026-11-06, m1: the whole tab got Submit on Auto before). */
export async function pushSettings(deps: { session: StorageArea; tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'> },
  contentFor: (frame: FrameEntry) => Promise<ContentSettings>): Promise<number> {
  const frames = (Object.values(await deps.session.getMany('frames:')) as FrameEntry[])
    .filter((frame) => frame.hasForm || frame.frameId === 0);
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
