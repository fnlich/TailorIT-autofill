/*
 * The options page's settings: read once with settings/get, and changed only through settings/save. While a change is
 * on its way the page shows it and holds every control still; then it shows exactly what the worker answered, which
 * is what storage.local now holds. A refused save shows the settings as they were, and says so.
 */
import { useEffect, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { request } from '../page/request';

/** The settings as the page shows them, and how to change them. */
export interface SettingsState {
  /** The change on its way while there is one, else the settings as the worker last answered them; null until read. */
  shown: Settings | null;
  /** A change is on its way: every control waits. */
  saving: boolean;
  /** What the last change came to ("Saved."), or null. */
  note: string | null;
  /** The first read failed. */
  failed: boolean;
  save(next: Settings): void;
}

export function useSettings(platform: PagePlatform): SettingsState {
  const [stored, setStored] = useState<Settings | null>(null);
  const [pending, setPending] = useState<Settings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void request(platform, { v: 1, type: 'settings/get' }).then((answer) => {
      if (!live) return;
      if (answer.ok) setStored(answer.data.settings);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [platform]);

  const save = (next: Settings) => {
    setPending(next);
    setNote(null);
    void request(platform, { v: 1, type: 'settings/save', settings: next }).then((answer) => {
      setPending(null);
      if (answer.ok) {
        setStored(answer.data.settings);
        setNote(COPY.options.saved);
      } else {
        setNote(COPY.options.notSaved);
      }
    });
  };

  return { shown: pending ?? stored, saving: pending !== null, note, failed, save };
}
