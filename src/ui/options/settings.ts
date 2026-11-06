/*
 * The options page's settings: read with settings/get, and changed only through settings/save. While a change is on
 * its way the page shows it and holds every control still; then it shows exactly what the worker answered, which is
 * what storage.local now holds. A refused save shows the settings as they were, and says so.
 *
 * The audit of 2026-11-06 (M4): the page may stay open while the side panel's gear changes a mode, so it reads the
 * settings again whenever the worker says they changed (panel/changed {what: 'settings'}, on a port of its own) and
 * whenever it is seen again (visibility, focus), and each save names the settings it last read (`base`): the worker
 * applies only what the page changed from them, so a mode changed elsewhere is never put back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import { PanelPortMessageSchema } from '../../messaging/schemas';
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
  /** Reads and saves made, so a read's answer older than a newer read or a save is dropped. */
  const asks = useRef(0);

  const read = useCallback(() => {
    asks.current += 1;
    const ask = asks.current;
    void request(platform, { v: 1, type: 'settings/get' }).then((answer) => {
      if (ask !== asks.current) return;
      if (answer.ok) {
        setStored(answer.data.settings);
        setFailed(false);
      } else setFailed(true);
    });
  }, [platform]);

  useEffect(() => {
    read();
    return () => {
      asks.current += 1;
    };
  }, [read]);

  // Seen again (another tab or window was in front): the settings may have changed there.
  useEffect(() => {
    const doc = globalThis.document as Document | undefined;
    if (doc === undefined) return undefined;
    const view = doc.defaultView;
    const onVisible = () => {
      if (doc.visibilityState === 'visible') read();
    };
    doc.addEventListener('visibilitychange', onVisible);
    view?.addEventListener('focus', read);
    return () => {
      doc.removeEventListener('visibilitychange', onVisible);
      view?.removeEventListener('focus', read);
    };
  }, [read]);

  // The worker says the settings changed (the side panel's gear, another options page): read them again.
  useEffect(() => {
    let port: ReturnType<PagePlatform['runtime']['connect']>;
    try {
      port = platform.runtime.connect('panel');
    } catch {
      return undefined;
    }
    const stop = port.onMessage((raw) => {
      const parsed = PanelPortMessageSchema.safeParse(raw);
      if (parsed.success && parsed.data.type === 'panel/changed' && parsed.data.what === 'settings') read();
    });
    return () => {
      stop();
      try {
        port.disconnect();
      } catch {
        // Gone already.
      }
    };
  }, [platform, read]);

  const save = (next: Settings) => {
    const base = stored;
    setPending(next);
    setNote(null);
    // A read on its way is older than this save's answer.
    asks.current += 1;
    void request(platform, { v: 1, type: 'settings/save', settings: next, ...(base === null ? {} : { base }) })
      .then((answer) => {
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
