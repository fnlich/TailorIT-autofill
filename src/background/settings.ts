/*
 * The person's settings, in storage.local under `settings:v1`, checked with SettingsSchema on the way in and out. A
 * stored value that no longer parses gives the cautious defaults. Content scripts get only the part they need (panel
 * placement, auto-advance, the AI switches, the offer to save answers) with frame/hello and run/begin, and again with
 * settings/changed whenever the person saves them (pushSettings: every registered frame with a form, so a run in
 * progress reads auto-advance as it is now: the Phase 5 review, C-S2); they never read storage.
 */
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { SETTINGS_KEY, SettingsSchema, type ContentSettings } from '../shared/settings';
import { frameTarget, type FrameEntry } from './frames';

/** The settings, as the worker reads and saves them. */
export interface SettingsStore {
  get(): Promise<Settings>;
  /** Stores checked settings and answers them as stored. */
  save(settings: Settings): Promise<Settings>;
  /** The part a content script receives. */
  content(): Promise<ContentSettings>;
}

/** What a content script may know of the settings. */
export function contentSettingsOf(settings: Settings): ContentSettings {
  return { panel: settings.panel, autoAdvance: settings.autoAdvance, llm: { ...settings.llm },
    offerToSaveAnswers: settings.offerToSaveAnswers };
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
      if (!parsed.success) log('settings.unreadable');
      cached = parsed.success ? parsed.data : DEFAULT_SETTINGS;
      return cached;
    },
    async save(settings) {
      const checked = SettingsSchema.parse(settings);
      await local.set({ [SETTINGS_KEY]: checked });
      cached = checked;
      log('settings.saved');
      return checked;
    },
    async content() {
      return contentSettingsOf(await store.get());
    },
  };
  return store;
}

/** Tells every registered frame with a form the content settings just saved (settings/changed). A frame that cannot be
 *  reached is skipped: its next run reads them at run/begin. Answers how many frames received them. */
export async function pushSettings(deps: { session: StorageArea; tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'> },
  settings: Settings): Promise<number> {
  const message = { v: 1, type: 'settings/changed', settings: contentSettingsOf(settings) } as const;
  const frames = (Object.values(await deps.session.getMany('frames:')) as FrameEntry[]).filter((frame) => frame.hasForm);
  const reached = await Promise.all(frames.map(async (frame) => {
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
