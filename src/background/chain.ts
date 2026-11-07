/*
 * The snapshot build of 2026-11-06 (core-x, items 7 and 14; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): the worker keys a page whose address
 * names no job (adapters/chain.ts chainPageOf: SuccessFactors' /career post-back with _s.crb and no job (never its
 * /portalcareer: the behaviour review's minor 9), SmartRecruiters' one-click application,
 * iCIMS's IForm frame on <co>.icims.com/forms) by the application of the same tab's claimed page it was reached from, so
 * its RunState, the posting's "no AI" note (policy hits are kept under the posting's key) and TailorIT's job follow it.
 * - A top frame's chain page: its hello names the browser's referrer by its hash alone (adapters/chain.ts hrefHash: the
 *   content script reads document.referrer in its isolated world, which no page script can change). The worker keeps,
 *   per tab, the last CHAIN_HISTORY claimed top documents (storage.session `chain:<tabId>`: each one's address hash, its
 *   application key and canonical address, its family, its document and when it was last claimed; never an address the
 *   page showed). The page takes the key of the record whose address hash is that referrer: the same tab, the same
 *   platform and family (SuccessFactors' career host, SmartRecruiters' company), another document (a navigation), within
 *   CHAIN_MS of that page's last hello. A chain page the worker keyed is itself recorded, so the step after it (the
 *   one-click application's screening, a post-back's next page) chains from it in turn.
 * - A subframe's chain page (iCIMS's IForm frame on <co>.icims.com/forms): its hello says it is one (`chain: { frame:
 *   true }`), and the worker keys it from the frame registry alone (the security fix of 2026-11-06, S4: no message goes
 *   between frames, so nothing tells a page the extension is there). It takes the application of the tab's claim frame
 *   (frames.ts claimFrameOf: the top frame, or the one subframe that claims a wrapper's application) only where that
 *   frame is the one frame of the tab, the asking frame aside, that holds an iCIMS application on a portal of the same
 *   company (adapters/chain.ts chainFamilyOf) whose chain origin (chainChildOrigin) is the asking frame's origin, is
 *   neither chained nor a wrapper, and said its last hello within CHAIN_MS. Two such portal frames, none, another
 *   company's, another tab's or a stale one: none (if unsure, unkeyed). The registry knows the frames of a tab, not
 *   which frames which: the asking frame is keyed by its company's one claimed portal frame in its tab. A forms frame
 *   that said hello before its portal frame did is asked again by the worker's sweep (frame/ping), and says hello again
 *   (content/runtime.ts).
 * - The families (adapters/chain.ts chainFamilyOf): SuccessFactors' is per career host (career8.successfactors.com and
 *   career10.successfactors.com are two families, whichever company they serve), SmartRecruiters' per company, iCIMS's
 *   per company (its portal's and its forms host's).
 * - Never across tabs, never across hosts or companies, never from a stale page; where two records could answer, none
 *   does (if unsure, unkeyed). A closed tab's records go with it.
 * Nothing here logs a key, an address or a hash.
 */
import { applicationOf } from '../adapters';
import { chainChildOrigin, chainFamilyOf, chainPageOf, hrefHash } from '../adapters/chain';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { claimFrameOf, type FrameEntry } from './frames';

/** How long after a claimed page's last hello a page reached from it may take its application. */
export const CHAIN_MS = 30 * 60_000;
/** The claimed top documents kept per tab. */
export const CHAIN_HISTORY = 6;
/** storage.session: `chain:<tabId>`, the tab's claimed top documents; `chainportal:<tabId>:<frameId>`, a portal
 *  frame's document and its application (notePortal). */
export const CHAIN_PREFIX = 'chain:';
export const CHAIN_PORTAL_PREFIX = 'chainportal:';

/** A claimed top document, as the tab's chain keeps it. */
interface TopRecord {
  hash: string;
  applicationKey: string;
  /** The application's canonical address (the posting's), for TailorIT: never the page's own address. */
  url: string;
  family: string;
  documentId: string | null;
  at: number;
}

/** A portal frame's document and its application's canonical address (notePortal). */
interface PortalRecord {
  documentId: string | null;
  applicationKey: string;
  url: string;
}

/** What a chain page takes: the application's key and its canonical address. */
export interface Inherited {
  applicationKey: string;
  url: string;
  /** A subframe's: the frame that framed it. */
  parentFrameId?: number;
}

export interface ChainDeps {
  session: StorageArea;
  now(): number;
}

function urlOf(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is TopRecord => typeof value === 'object' && value !== null
  && typeof (value as TopRecord).hash === 'string' && typeof (value as TopRecord).applicationKey === 'string'
  && typeof (value as TopRecord).url === 'string' && typeof (value as TopRecord).family === 'string'
  && typeof (value as TopRecord).at === 'number';

const isPortal = (value: unknown): value is PortalRecord => typeof value === 'object' && value !== null
  && ((value as PortalRecord).documentId === null || typeof (value as PortalRecord).documentId === 'string')
  && typeof (value as PortalRecord).applicationKey === 'string' && typeof (value as PortalRecord).url === 'string';

/** The tabs' chains, as index.ts wires them. */
export function createChains(deps: ChainDeps) {
  const fresh = (at: number) => deps.now() - at >= 0 && deps.now() - at <= CHAIN_MS;

  async function recordsOf(tabId: number): Promise<TopRecord[]> {
    const held = await deps.session.get(`${CHAIN_PREFIX}${tabId}`);
    return Array.isArray(held) ? held.filter(isRecord) : [];
  }

  return {
    /** A tab's top frame said hello with an application (its address's, or one its chain gave it): kept as the tab's
     *  latest claimed document. `applicationUrl`: the application's canonical address (a chained page's, inherited). */
    async noteTop(tabId: number, frame: { url: string; documentId: string | null; applicationKey: string;
      applicationUrl?: string }): Promise<void> {
      const url = urlOf(frame.url);
      const family = url === null ? null : chainFamilyOf(url);
      const hash = hrefHash(frame.url);
      const canonical = frame.applicationUrl ?? (url === null ? null : applicationOf(url)?.applicationUrl ?? null);
      if (family === null || hash === null || canonical === null) return;
      const kept = (await recordsOf(tabId)).filter((record) => fresh(record.at) && record.hash !== hash);
      const next: TopRecord = { hash, applicationKey: frame.applicationKey, url: canonical, family,
        documentId: frame.documentId, at: deps.now() };
      await deps.session.set({ [`${CHAIN_PREFIX}${tabId}`]: [...kept, next].slice(-CHAIN_HISTORY) });
    },

    /** A top frame's chain page said hello, reached from the address whose hash is `fromHash` (its referrer): the
     *  application it takes (module header), or null. */
    async inheritTop(tabId: number, frame: { url: string; documentId: string | null }, fromHash: string):
      Promise<Inherited | null> {
      const url = urlOf(frame.url);
      const page = url === null ? null : chainPageOf(url);
      if (page === null || page.role !== 'top') return null;
      const matches = (await recordsOf(tabId)).filter((record) => record.hash === fromHash && fresh(record.at)
        && record.family === page.family && record.applicationKey.startsWith(`${page.platform}:`)
        && record.documentId !== frame.documentId);
      const keys = new Set(matches.map((record) => record.applicationKey));
      if (matches.length === 0 || keys.size !== 1) {
        log('frame.chain-refused', { top: true, found: matches.length });
        return null;
      }
      const record = matches.at(-1)!;
      log('frame.chained', { top: true });
      return { applicationKey: record.applicationKey, url: record.url };
    },

    /** A subframe's chain page said hello (module header): the application it takes from its company's one claimed
     *  portal frame in its tab, or null. `framesNow` reads the tab's registered frames now. */
    async inheritFrame(tabId: number, frame: { frameId: number; url: string },
      framesNow: () => Promise<readonly FrameEntry[]>): Promise<Inherited | null> {
      const refuse = (why: number): null => {
        log('frame.chain-refused', { top: false, found: why });
        return null;
      };
      const url = urlOf(frame.url);
      const page = url === null ? null : chainPageOf(url);
      if (url === null || page === null || page.role !== 'frame' || frame.frameId === 0) return refuse(0);
      const frames = (await framesNow()).filter((each) => each.tabId === tabId);
      // The tab's portal frames of the asking frame's company holding an application of its platform: a wrapper (which
      // defers to the frame it claims for) and a chained page aside.
      const portals = frames.filter((each) => {
        const origin = urlOf(each.origin);
        return each.frameId !== frame.frameId && each.wraps !== true && each.chained !== true
          && each.applicationKey?.startsWith(`${page.platform}:`) === true && origin !== null
          && chainFamilyOf(origin) === page.family && chainChildOrigin(origin) === url.origin;
      });
      if (portals.length !== 1) return refuse(portals.length === 0 ? 1 : 2);
      const portal = portals[0]!;
      const claim = claimFrameOf(frames);
      if (claim === null || claim.frameId !== portal.frameId || claim.documentId !== portal.documentId) return refuse(3);
      if (!fresh(portal.registeredAt) || portal.applicationKey === undefined) return refuse(4);
      const held = await deps.session.get(`${CHAIN_PORTAL_PREFIX}${tabId}:${portal.frameId}`);
      if (!isPortal(held) || held.documentId !== portal.documentId || held.applicationKey !== portal.applicationKey) {
        return refuse(5);
      }
      log('frame.chained', { top: false });
      return { applicationKey: held.applicationKey, url: held.url, parentFrameId: portal.frameId };
    },

    /** A frame of the tab that holds an application on a portal whose pages frame chain pages (adapters/chain.ts
     *  chainChildOrigin: an iCIMS portal) said hello: its application's canonical address is kept for its document, so
     *  a chain subframe it frames is named by it (never the portal page's own address). */
    async notePortal(tabId: number, frame: { frameId: number; documentId: string | null; applicationKey: string;
      url: string }): Promise<void> {
      const url = urlOf(frame.url);
      if (url === null || chainChildOrigin(url) === null) return;
      const canonical = applicationOf(url)?.applicationUrl ?? null;
      if (canonical === null) return;
      const record: PortalRecord = { documentId: frame.documentId, applicationKey: frame.applicationKey, url: canonical };
      await deps.session.set({ [`${CHAIN_PORTAL_PREFIX}${tabId}:${frame.frameId}`]: record });
    },

    /** A closed tab's chain and its portals' records go with it. */
    async forgetTab(tabId: number): Promise<void> {
      const portals = Object.keys(await deps.session.getMany(`${CHAIN_PORTAL_PREFIX}${tabId}:`));
      await deps.session.remove([`${CHAIN_PREFIX}${tabId}`, ...portals]);
    },
  };
}

/** The tabs' chains, as index.ts wires them. */
export type Chains = ReturnType<typeof createChains>;
