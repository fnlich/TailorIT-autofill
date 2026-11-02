/*
 * The followed tab's reports, live. The first read is panel/reports {tabId}; then the `panel` port carries every
 * change: the page posts panel/watch {tabId} (again whenever the tab changes) and the worker answers panel/update.
 *
 * A worker restart drops the port, and so does Chrome stopping an idle worker. The panel reconnects at once and
 * watches its tab again, which wakes the worker: a frame's report only reaches a panel that is connected. If the port
 * keeps dropping (more than RECONNECTS.count times in RECONNECTS.windowMs), the panel stops and offers a Reconnect
 * button instead of looping. Timing comes from the injected clock: there is no timer here.
 *
 * Every message is parsed with the catalogue's strict schema, so an update carrying anything a report may not hold
 * (a value, a row of the wrong shape) is dropped whole and never rendered.
 *
 * v3 Phase 3: the browser's side panel (no ?tabId) says so in its watch, so the worker can hide the tab's launcher
 * while it shows the tab; the report page does not.
 * v2: each read and push also carries the tab's page state (a form found, frames with none, none of ours), null until
 * known or from an older worker. When the followed tab finishes loading a page (tabs.onUpdated, status 'complete'),
 * the tab is read again: a page without our script says no hello, and the read's frame check prunes what went. The
 * port also says when the connection or the settings changed (panel/changed), whichever window it happened in: each
 * bumps its count in `changes`, so the panel reads them again.
 */
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { PanelPortMessageSchema, type PageState } from '../../messaging/schemas';
import type { PagePlatform, PortLike } from '../../platform/types';
import type { FrameReport } from '../../shared/report';
import { request } from '../page/request';

/** How the panel's link to the worker stands: 'lost' after too many drops, 'gone' once the extension is invalid. */
export type LinkState = 'live' | 'lost' | 'gone';

/** At most this many drops in this window are reconnected on their own. */
export const RECONNECTS = { count: 5, windowMs: 10_000 } as const;

const NO_REPORTS: readonly FrameReport[] = [];

/** Asks the worker to follow `tabId` on `port` (`side`: as the browser's side panel, v3 Phase 3: the tab's launcher
 *  hides while it shows). A port that closed under us reconnects through its onDisconnect. */
function watch(port: PortLike | null, tabId: number, side: boolean): void {
  try {
    port?.post({ v: 1, type: 'panel/watch', tabId, ...(side ? { side: true as const } : {}) });
  } catch {
    // Closed: the reconnect watches again.
  }
}

/** How many times the worker said the connection, the settings or (v3 Phase 5) the auto-apply agent changed since the
 *  panel opened. */
export interface PanelChanges {
  connection: number;
  settings: number;
  agent: number;
}

/** The tab's reports and page state as last read or pushed, the link's state, a way to reconnect by hand, and the
 *  connection and settings changes the worker announced. */
export function useTabReports(platform: PagePlatform, tabId: number | null, now: () => number,
  options: { side?: boolean } = {}): {
  reports: readonly FrameReport[];
  page: PageState | null;
  link: LinkState;
  reconnect(): void;
  changes: PanelChanges;
} {
  const [shown, setShown] = useState<{ tabId: number | null; reports: readonly FrameReport[]; page: PageState | null }>(
    { tabId: null, reports: NO_REPORTS, page: null });
  const [changes, setChanges] = useState<PanelChanges>({ connection: 0, settings: 0, agent: 0 });
  const [link, setLink] = useState<LinkState>('live');
  const [generation, setGeneration] = useState(0);
  const port = useRef<PortLike | null>(null);
  const watched = useRef<number | null>(null);
  /** Updates the port delivered for the watched tab since it was chosen: a one-shot read older than them is dropped. */
  const pushes = useRef(0);
  const clock = useEffectEvent(() => now());
  // The panel is the side panel or the report page for its whole life (its address says which).
  const sideNow = useRef(options.side === true);

  useEffect(() => {
    let closed = false;
    const drops: number[] = [];
    const open = (rewatch: boolean) => {
      if (closed) return;
      let next: PortLike;
      try {
        if (!platform.runtime.isValid()) throw new Error('invalid');
        next = platform.runtime.connect('panel');
      } catch {
        setLink('gone');
        return;
      }
      port.current = next;
      next.onMessage((raw) => {
        if (closed || port.current !== next) return;
        const parsed = PanelPortMessageSchema.safeParse(raw);
        if (parsed.success && parsed.data.type === 'panel/changed') {
          const what = parsed.data.what;
          setChanges((count) => ({ ...count, [what]: count[what] + 1 }));
          return;
        }
        if (!parsed.success || parsed.data.type !== 'panel/update' || parsed.data.tabId !== watched.current) return;
        pushes.current += 1;
        setShown({ tabId: parsed.data.tabId, reports: parsed.data.reports, page: parsed.data.page ?? null });
      });
      next.onDisconnect(() => {
        if (closed || port.current !== next) return;
        port.current = null;
        const at = clock();
        drops.push(at);
        while (drops.length > 0 && drops[0]! <= at - RECONNECTS.windowMs) drops.shift();
        if (drops.length > RECONNECTS.count) {
          setLink('lost');
          return;
        }
        open(true);
      });
      if (rewatch && watched.current !== null) watch(next, watched.current, sideNow.current);
    };
    // The first port's watch comes from the tab effect below; a reconnect (by hand, or after a drop) watches again.
    open(generation > 0);
    return () => {
      closed = true;
      const current = port.current;
      port.current = null;
      current?.disconnect();
    };
  }, [platform, generation]);

  useEffect(() => {
    watched.current = tabId;
    pushes.current = 0;
    if (tabId === null) return undefined;
    watch(port.current, tabId, sideNow.current);
    let live = true;
    /** One read of the tab; an answer older than a push that came after it was sent is dropped. */
    const read = () => {
      const before = pushes.current;
      void request(platform, { v: 1, type: 'panel/reports', tabId }).then((answer) => {
        if (!live || !answer.ok || pushes.current > before || watched.current !== tabId || answer.data.tabId !== tabId) return;
        setShown({ tabId, reports: answer.data.reports, page: answer.data.page ?? null });
      });
    };
    read();
    // The tab loaded a page: read it again (its frame check prunes a page of ours that went).
    const stop = platform.onTabLoaded((loaded) => {
      if (loaded === tabId) read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [platform, tabId]);

  const reconnect = useCallback(() => {
    setLink('live');
    setGeneration((count) => count + 1);
  }, []);
  const current = shown.tabId === tabId && tabId !== null;
  return { reports: current ? shown.reports : NO_REPORTS, page: current ? shown.page : null, link, reconnect, changes };
}
