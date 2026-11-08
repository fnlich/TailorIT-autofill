/*
 * The company career sites, in the worker (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13; docs/PRIVACY.md
 * "Company career sites"). LinkedIn is deferred to v5 by the owner (2026-11-06): nothing here ever reaches it, nor an
 * employee HR system (shared/hosts.ts isCompanySiteUrl).
 * - The person's choice (Options › "Where Autofill works" › Company career sites) is kept in storage.local
 *   (`sites:v1`, one flag). The place acts only while both the flag and Chrome's permission hold (`active`).
 *   v5 p1-rules (PLAN decision 10, like Jobright): every https and http page is a required host permission, granted at
 *   install, so the place is on unless the person turned it off (no flag stored reads as on), and turning it off no
 *   longer gives a permission back (Chrome keeps a required one; the person may still withhold site access in Chrome's
 *   own settings, which turns the place off as before).
 * - The sentinel's registration (shared/hosts.ts registrationsFor) is reconciled to what acts: at the worker's start,
 *   at install, whenever Chrome's permissions change (onAdded, onRemoved: the person may take it back in Chrome's own
 *   settings) and after a choice. One reconcile at a time; a registration that differs is replaced.
 * - Once it stops acting (the Phase 8 review, P1/B8), everything the worker injected stops with it: the injected
 *   documents are forgotten (memory and every `injected:*` key), the router and the resume port no longer take their
 *   messages (`injected` answers null unless it acts), and every tab's top frame is told `site/stop` (a page the worker
 *   injected ends its run and removes its UI; a running sentinel stops). Whether it acted is kept in storage.session
 *   (`sites:acting`), so a worker that restarted since still tells them.
 * - page/recognised (the sentinel's one message, from a tab's top frame) is taken at most RECOGNISED_LIMIT a minute per
 *   tab, its record and injection one at a time with the reconcile (M2: never after a stop). Its address is checked again here, from Chrome's description of the sender, never the page's word: a company's
 *   own https page (isCompanySiteUrl), while the career sites act; never in a private tab. Then the content script is
 *   injected into that one document (scripting.executeScript, its document id), once per document. The document is
 *   recorded first, in storage.session (`injected:<tab>:<document id>`, its frame; never an address) and in memory, so
 *   the router takes its content messages (senders.ts) as soon as the script sends one. A tab keeps the records of its
 *   last TAB_DOCUMENTS documents (B7: a page the back/forward cache brings back is still known).
 * Nothing here requests a page, and nothing is sent to TailorIT.
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { ContentMessage, SitesState } from '../messaging/schemas';
import type { HostPermissions, SitesScripting, StorageArea } from '../platform/types';
import {
  CONTENT_SCRIPT_FILE, isCompanySiteUrl, registrationsFor, SITES_MATCH, SITES_REGISTRATION_ID, type SiteRegistration,
} from '../shared/hosts';
import { log } from '../shared/log';
import { createKeyedQueue, type createRateLimit } from './locks';
import type { ContentChannel } from './router';
import type { InjectedKind, InjectedOf } from './senders';

/** The person's choice, in storage.local. */
export const SITES_KEY = 'sites:v1';
/** Whether the career sites acted when last reconciled, in storage.session. */
export const ACTING_KEY = 'sites:acting';
/** The injected documents, in storage.session: `injected:<tabId>:<documentId>`. */
export const INJECTED_PREFIX = 'injected:';
/** page/recognised per tab: a page that keeps changing what it shows asks a few times at most. */
export const RECOGNISED_LIMIT = { count: 10, windowMs: 60_000 } as const;
/** The most injected documents a tab's records keep (the back/forward cache holds a few). */
export const TAB_DOCUMENTS = 4;

/** One injected document's record: its frame, the kind it was injected as, and when. */
interface InjectedEntry {
  frameId: number;
  kind: InjectedKind;
  at: number;
}

export interface SitesDeps {
  local: StorageArea;
  session: StorageArea;
  scripting: SitesScripting;
  permissions: HostPermissions;
  /** RECOGNISED_LIMIT, keyed `${tabId}/`. */
  limit: ReturnType<typeof createRateLimit>;
  now(): number;
  /** Tells every tab's top frame `site/stop` (the career sites stopped acting). */
  stopPages?(): Promise<void>;
  /** The e2e build only: a record of each recognition and injection, for the specs (never an address). */
  note?(event: { type: 'page-recognised'; reason: string; tabId: number; injected: boolean }): Promise<void>;
}

export interface Sites {
  /** Reconciles Chrome's registration to what acts now, and stops what was injected once it no longer acts. */
  reconcile(): Promise<void>;
  /** Loads the injected documents into memory, then reconciles (the worker's start). */
  start(): Promise<void>;
  state(): Promise<SitesState>;
  set(on: boolean): Promise<SitesState>;
  recognised(message: Extract<ContentMessage, { type: 'page/recognised' }>, from: ContentChannel): Promise<Answer<{ injected: boolean }>>;
  /** The router's reading of a frame off the ATS hosts (senders.ts InjectedOf): null unless the career sites act. */
  injected: InjectedOf;
  /** Whether the career sites act now (the side panel's reload hint). */
  active(): Promise<boolean>;
  forgetTab(tabId: number): void;
}

const keyOf = (tabId: number, documentId: string) => `${INJECTED_PREFIX}${tabId}:${documentId}`;

/** Whether two registrations are the same in what the extension sets. */
function same(a: SiteRegistration, b: SiteRegistration): boolean {
  const list = (value: readonly string[] | undefined) => JSON.stringify([...(value ?? [])].sort());
  return a.id === b.id && list(a.js) === list(b.js) && list(a.matches) === list(b.matches)
    && list(a.excludeMatches) === list(b.excludeMatches) && a.allFrames === b.allFrames && a.runAt === b.runAt
    && a.persistAcrossSessions === b.persistAcrossSessions && a.world === b.world;
}

/** A company's own page, as the career sites' registration reaches it (shared/hosts.ts isCompanySiteUrl). */
export const siteAddress = isCompanySiteUrl;

export function createSites(deps: SitesDeps): Sites {
  const queue = createKeyedQueue();
  const memory = new Map<string, InjectedEntry>();
  let loaded = false;
  /** Whether the career sites act, as the last reconcile found (undefined before the first). */
  let acting: boolean | undefined;

  /** The person's choice: on unless they turned it off (v5 p1-rules, PLAN decision 10: on by default). */
  async function chosen(): Promise<boolean> {
    return ((await deps.local.get(SITES_KEY)) as { sites?: unknown } | undefined)?.sites !== false;
  }

  async function granted(): Promise<boolean> {
    return deps.permissions.contains([SITES_MATCH]).catch(() => false);
  }

  /** Whether the career sites act: the person's choice, while Chrome holds its permission (read first: v5 p1-rules made
   *  the choice on by default, and a worker Chrome gave no site access reads no more than before). */
  async function active(): Promise<boolean> {
    return (await granted()) && (await chosen());
  }

  /** Everything injected stops (the module header): the records forgotten, every tab's top frame told. */
  async function stopInjected(): Promise<void> {
    memory.clear();
    const stored = await deps.session.getMany(INJECTED_PREFIX).catch(() => ({}));
    await deps.session.remove([...Object.keys(stored), ACTING_KEY]).catch(() => undefined);
    await deps.stopPages?.().catch(() => undefined);
    log('sites.stopped');
  }

  function reconcile(): Promise<void> {
    return queue.run('reconcile', async () => {
      const sites = await active();
      const wanted = registrationsFor({ sites });
      try {
        const current = await deps.scripting.registered([SITES_REGISTRATION_ID]);
        const stale = current.filter((held) => !wanted.some((want) => same(want, held))).map((held) => held.id);
        if (stale.length > 0) await deps.scripting.unregister(stale);
        const missing = wanted.filter((want) => !current.some((held) => same(want, held)));
        if (missing.length > 0) await deps.scripting.register(missing);
        log('sites.reconciled', { sites });
      } catch {
        log('sites.reconcile-failed');
      }
      const before = acting ?? ((await deps.session.get(ACTING_KEY).catch(() => undefined)) === true);
      acting = sites;
      if (sites && !before) await deps.session.set({ [ACTING_KEY]: true }).catch(() => undefined);
      if (!sites && (before || memory.size > 0)) await stopInjected();
    });
  }

  async function state(): Promise<SitesState> {
    return { on: await chosen(), granted: await granted() };
  }

  async function entryOf(tabId: number, documentId: string): Promise<InjectedEntry | null> {
    const held = memory.get(keyOf(tabId, documentId));
    if (held !== undefined) return held;
    return ((await deps.session.get(keyOf(tabId, documentId))) as InjectedEntry | undefined) ?? null;
  }

  const kindIn = (entry: InjectedEntry | null | undefined, frameId: number): InjectedKind | null =>
    (entry !== null && entry !== undefined && entry.frameId === frameId ? entry.kind : null);

  /** The tab's records beyond its last TAB_DOCUMENTS documents, forgotten (the oldest first). */
  async function bound(tabId: number): Promise<void> {
    const prefix = `${INJECTED_PREFIX}${tabId}:`;
    const stored = (await deps.session.getMany(prefix)) as Record<string, InjectedEntry>;
    const keys = Object.keys(stored).sort((a, b) => (stored[b]?.at ?? 0) - (stored[a]?.at ?? 0));
    const drop = keys.slice(TAB_DOCUMENTS);
    for (const key of drop) memory.delete(key);
    if (drop.length > 0) await deps.session.remove(drop);
  }

  return {
    reconcile,
    async start() {
      try {
        for (const [key, value] of Object.entries(await deps.session.getMany(INJECTED_PREFIX))) {
          memory.set(key, value as InjectedEntry);
        }
      } finally {
        loaded = true;
      }
      await reconcile();
    },
    state,
    active,
    async set(on) {
      await deps.local.set({ [SITES_KEY]: { sites: on } });
      // v5 p1-rules (PLAN decision 10): the permission is the install's own (a required host), so turning the place off
      // gives nothing back: the registration goes (reconcile) and what was injected stops.
      await reconcile();
      return state();
    },
    async recognised(message, from) {
      const retry = deps.limit.take(`${from.tabId}/`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (from.reach !== 'sentinel' || from.frameId !== 0 || from.incognito === true || from.documentId === undefined) {
        return refuse('bad_sender');
      }
      const refused = async () => {
        log('sites.refused');
        await deps.note?.({ type: 'page-recognised', reason: message.reason, tabId: from.tabId, injected: false });
        return refuse('bad_message');
      };
      if (!(await active()) || !siteAddress(from.url)) return refused();
      log('sites.recognised');
      const documentId = from.documentId;
      const key = keyOf(from.tabId, documentId);
      if (kindIn(await entryOf(from.tabId, documentId), from.frameId) !== null) return ok({ injected: true });
      // Recorded and injected one at a time with the reconcile (round 2 of the Phase 8 review, M2): the career sites
      // turned off while this waited are read again here, and a reconcile that stops them waits until the injection is
      // done, so it forgets this document and tells its page to stop too.
      const injected = await queue.run('reconcile', async (): Promise<Answer<{ injected: boolean }> | null> => {
        if (!(await active())) return null;
        // Recorded before the script runs: its first message must find its document known.
        const entry: InjectedEntry = { frameId: from.frameId, kind: 'site', at: deps.now() };
        memory.set(key, entry);
        await deps.session.set({ [key]: entry });
        await bound(from.tabId);
        try {
          await deps.scripting.inject(from.tabId, { frameId: from.frameId, documentId }, CONTENT_SCRIPT_FILE);
        } catch {
          memory.delete(key);
          await deps.session.remove([key]);
          log('sites.inject-failed');
          return refuse('unavailable');
        }
        return ok({ injected: true });
      });
      if (injected === null) return refused();
      if (!injected.ok) return injected;
      log('sites.injected');
      await deps.note?.({ type: 'page-recognised', reason: message.reason, tabId: from.tabId, injected: true });
      return injected;
    },
    injected: {
      // From memory: undefined until both the records and the first reconcile are in (a worker that restarted), null
      // while the career sites do not act.
      now: (tabId, frameId, documentId) => {
        if (!loaded || acting === undefined) return undefined;
        if (!acting || documentId === undefined) return null;
        return kindIn(memory.get(keyOf(tabId, documentId)), frameId);
      },
      read: async (tabId, frameId, documentId) => {
        if (documentId === undefined || !(await active())) return null;
        return kindIn(await entryOf(tabId, documentId), frameId);
      },
    },
    forgetTab(tabId) {
      const prefix = `${INJECTED_PREFIX}${tabId}:`;
      for (const key of [...memory.keys()].filter((each) => each.startsWith(prefix))) memory.delete(key);
      void deps.session.getMany(prefix).then((stored) => deps.session.remove(Object.keys(stored))).catch(() => undefined);
      deps.limit.forget(`${tabId}/`);
    },
  };
}
