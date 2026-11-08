/*
 * v5 p1-shell (PLAN decisions 1, 2 and 8; Jobright's on-page sidebar, its toolbar icon and its header, read for
 * behaviour only): the worker's part of the sidebar on the page.
 * - sidebar/load (while "Where the panel shows" is On the page): the sidebar's bundle (shared/sidebar.ts
 *   SIDEBAR_APP_FILE) runs in the sending frame's one document (scripting.executeScript, its document id), at most
 *   SIDEBAR_LOAD_LIMIT a minute per tab, and the answer names the frame's tab, which the sidebar's messages name: the
 *   top frame's sidebar, or a frame inside another page's in-page card, whose views come with the same bundle (a
 *   subframe gets nothing more by it: the sidebar's page messages are the top frame's alone, senders.ts).
 * - The sidebar's port (`panel`; the review's S6: never `preview`) from that frame is the side panel's, held to the
 *   sender's tab (scopedPort): a message that names another tab is dropped and the port closed; `panel/watch`'s `side`
 *   (the browser's side panel, which hides the launcher) is never the sidebar's.
 * - The toolbar icon (actionClicked): Chrome opens the side panel by itself while the panel's place is the side panel
 *   (sidePanel.openOnActionClick, kept to the settings by placeIcon); on the page it fires action.onClicked instead, and
 *   the tab's top frame is told sidebar/open {reveal} (the launcher shown again where the person hid it, as Jobright's
 *   icon restores it). A page no frame of ours draws (a browser page, a site not reached) gets the side panel, which
 *   says why, asked for inside the click.
 * - The header's notes (panel/notes, panel/closeNote): Workday's "stay on this page" strip, closed for good, kept in
 *   storage.local (`notes:v1`, the note's name only).
 * - What the sidebar may not ask (the review, S1 and S7; createSidebarVet): the sidebar lives in the page's process, so
 *   the profile's sensitive part (read or saved), I understand on a changed disclosure and a save of the settings that
 *   lets the extension act more on its own (Submit or Sign-in to Auto, a skip rule off) stay on the extension's own
 *   pages; the sidebar links to them. And its job card, once it opened by itself (panel/job `onLoad`), is a lookup as
 *   the page loads: none in a private tab, before the disclosure as it reads now is acknowledged, or with on-load
 *   lookups off; LOOKUP_ON_LOAD_LIMIT's budget (job-cards.ts) then holds.
 * Nothing here reads an address beyond the click's tab (for the side panel's fallback), and nothing is sent to TailorIT.
 */
import type { Settings } from '../core/types/settings';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PANEL_NOTES, type PanelNote } from '../messaging/page-schemas';
import type { PageMessage } from '../messaging/schemas';
import type { PortLike, StorageArea, WorkerPlatform } from '../platform/types';
import { isCompanySiteUrl, platformOfUrl } from '../shared/hosts';
import { log } from '../shared/log';
import { SIDEBAR_APP_FILE } from '../shared/sidebar';
import { createKeyedQueue, type createRateLimit } from './locks';
import type { ContentChannel } from './router';
import { mergeSettings, raisesAutonomy } from './settings';

/** sidebar/load per tab: a person opening and folding the sidebar, a few pages a minute, never a stream. */
export const SIDEBAR_LOAD_LIMIT = { count: 20, windowMs: 60_000 } as const;
/** The header's notes the person closed, in storage.local. */
export const NOTES_KEY = 'notes:v1';

export interface SidebarDeps {
  scripting: Pick<WorkerPlatform['scripting'], 'inject'>;
  local: StorageArea;
  /** SIDEBAR_LOAD_LIMIT, keyed `${tabId}/`. */
  limit: ReturnType<typeof createRateLimit>;
  /** Whether "Where the panel shows" is On the page now. */
  onPage(): Promise<boolean>;
}

export interface Sidebar {
  load(from: ContentChannel): Promise<Answer<{ tabId: number }>>;
  notes(): Promise<Answer<{ closed: PanelNote[] }>>;
  closeNote(note: PanelNote): Promise<Answer<Record<string, never>>>;
}

export function createSidebar(deps: SidebarDeps): Sidebar {
  const writes = createKeyedQueue();
  const closedNotes = async (): Promise<PanelNote[]> => {
    const stored = (await deps.local.get(NOTES_KEY)) as { closed?: unknown } | undefined;
    const closed = Array.isArray(stored?.closed) ? stored.closed : [];
    return PANEL_NOTES.filter((note) => closed.includes(note));
  };
  return {
    async load(from) {
      if (from.reach === 'sentinel') return refuse('bad_sender');
      const retry = deps.limit.take(`${from.tabId}/`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (!(await deps.onPage())) {
        log('sidebar.inject-refused', { side: true });
        return refuse('expired');
      }
      try {
        await deps.scripting.inject(from.tabId, { frameId: from.frameId, ...(from.documentId === undefined ? {}
          : { documentId: from.documentId }) }, SIDEBAR_APP_FILE);
      } catch {
        // Chrome refused (the document went, or no host permission reaches it): the launcher stays.
        log('sidebar.inject-refused', { failed: true });
        return refuse('unavailable');
      }
      log('sidebar.injected');
      return ok({ tabId: from.tabId });
    },
    async notes() {
      return ok({ closed: await closedNotes() });
    },
    closeNote(note) {
      return writes.run(NOTES_KEY, async () => {
        const closed = await closedNotes();
        if (!closed.includes(note)) await deps.local.set({ [NOTES_KEY]: { closed: [...closed, note] } });
        return ok({});
      });
    },
  };
}

/**
 * A sidebar's port, held to the sender's tab: each message that names a tab must name `tabId` (one that names another
 * closes the port, its message dropped), and panel/watch never says it is the browser's side panel. What the worker
 * posts goes through unchanged.
 */
export function scopedPort(port: PortLike, tabId: number): PortLike {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    log('sidebar.refused', { port: true });
    port.disconnect();
  };
  return {
    name: port.name,
    ...(port.sender === undefined ? {} : { sender: port.sender }),
    post: (message) => port.post(message),
    onMessage: (cb) => port.onMessage((message) => {
      if (closed) return;
      const named = typeof message === 'object' && message !== null ? message as Record<string, unknown> : null;
      if (named !== null && 'tabId' in named && named.tabId !== tabId) {
        close();
        return;
      }
      if (named !== null && named.type === 'panel/watch' && 'side' in named) {
        const { side: _side, ...rest } = named;
        cb(rest);
        return;
      }
      cb(message);
    }),
    onDisconnect: (cb) => port.onDisconnect(cb),
    disconnect: () => {
      closed = true;
      port.disconnect();
    },
  };
}

/** The Chrome Web Store's pages, which Chrome lets no extension script: the side panel opens there, inside the click. */
const WEB_STORE = /^https:\/\/(?:chromewebstore\.google\.com\/|chrome\.google\.com\/webstore(?:[/?#]|$))/i;

/** Whether a page at `url` (the click's tab, as its activeTab grant lets Chrome say) is one a content script of ours may
 *  draw the sidebar on: an applicant-tracking host's, or (v3 Phase 8, with the career sites) any company's own https
 *  page, where the worker injects the content script on the click when none runs yet (sites.ts injectTop); never a
 *  browser page, LinkedIn's, an employee HR system's, a CAPTCHA vendor's or an http page off the ATS hosts, where no
 *  script of ours runs (shared/hosts.ts isCompanySiteUrl), nor the Chrome Web Store's, where Chrome runs none. Unknown
 *  (no address): try the page. */
export function iconReachesPage(url: string | undefined): boolean {
  if (url === undefined) return true;
  if (platformOfUrl(url) !== null) return true;
  if (WEB_STORE.test(url)) return false;
  return isCompanySiteUrl(url) || (__E2E__ && /^http:\/\/127\.0\.0\.1:\d+\//.test(url));
}

/** What the sidebar's vet reads (createSidebarVet). */
export interface SidebarVetDeps {
  settings(): Promise<Settings>;
  /** Whether the person acknowledged the disclosure as it reads now (auth.ts disclosed). */
  disclosed(): Promise<boolean>;
  /** Whether pages are looked up as they load at all (the worker's option). */
  lookupOnLoad: boolean;
}

/** The router's `sidebar.vet` (module header): a refusal for what the sidebar may not ask, no card for a lookup as the
 *  page loads that loadCard's rules would not make, else null (the pages' handler answers). */
export function createSidebarVet(deps: SidebarVetDeps): (message: PageMessage, channel: ContentChannel) =>
  Promise<Answer<unknown> | null> {
  const kept = () => {
    log('sidebar.refused', { kept: true });
    return refuse('bad_sender');
  };
  return async (message, channel) => {
    switch (message.type) {
      case 'panel/profile':
        return message.sensitive === false ? null : kept();
      case 'panel/saveProfile':
        return message.sensitive === undefined ? null : kept();
      case 'settings/save': {
        const current = await deps.settings();
        const wanted = message.base === undefined ? message.settings : mergeSettings(current, message.base, message.settings);
        return raisesAutonomy(current, wanted) ? kept() : null;
      }
      case 'panel/job':
        if (message.onLoad !== true) return null;
        if (channel.incognito === true || !deps.lookupOnLoad || !(await deps.disclosed())) {
          log('job.lookup-on-load-deferred');
          return ok({ tabId: message.tabId, card: null });
        }
        return null;
      default:
        return null;
    }
  };
}
