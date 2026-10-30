/*
 * The person's settings, in storage.local under `settings:v1`, checked with SettingsSchema on the way in and out. A
 * stored value that no longer parses gives the cautious defaults. Content scripts get only the part they need (panel
 * placement, auto-advance, the AI switches) with frame/hello and run/begin; they never read storage.
 */
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { SETTINGS_KEY, SettingsSchema, type ContentSettings } from '../shared/settings';

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
  return { panel: settings.panel, autoAdvance: settings.autoAdvance, llm: { ...settings.llm } };
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
