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
 * - jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; FIXPLAN §6.12 item 2, ICIMS-17): the step facts of the tab's claim
 *   frame, a portal page that frames an iCIMS IForm leaf (content/chain-frame.ts watchChainFacts, chain/facts: the step's
 *   id, whether it is the last, the packet counter, how many counters), are kept for that frame's document
 *   (storage.session `chainfacts:<tabId>:<frameId>`: its document, its application key and the facts, never an address)
 *   and handed (chain/leafFacts) to the leaf frames chained from it in the same tab, of its family's forms origin and at
 *   its application: at once when it says them, and to a leaf chained later once that portal document still answers
 *   (a frame/ping it answers itself: a portal frame that loaded another document since, its leaves gone with it, never
 *   speaks for the new leaves). Said by any other frame or document: refused. One tab's handing goes one at a time, so a
 *   leaf hears the latest facts last. Only ids, a boolean and counts; still no message between frames (S4).
 * Nothing here logs a key, an address or a hash.
 */
import { applicationOf } from '../adapters';
import { chainChildOrigin, chainFamilyOf, chainPageOf, hrefHash } from '../adapters/chain';
import type { ChainStepFacts } from '../adapters/types'; // jr6 SHELL-B
import type { StorageArea, WorkerPlatform } from '../platform/types'; // jr6 SHELL-B: WorkerPlatform
import { log } from '../shared/log';
import { claimFrameOf, FRAME_PROBE_TIMEOUT_MS, frameTarget, type FrameEntry } from './frames'; // jr6 SHELL-B: the probe's
import { createKeyedQueue } from './locks'; // jr6 SHELL-B
import type { Timers } from './timers'; // jr6 SHELL-B

/** How long after a claimed page's last hello a page reached from it may take its application. */
export const CHAIN_MS = 30 * 60_000;
/** The claimed top documents kept per tab. */
export const CHAIN_HISTORY = 6;
/** storage.session: `chain:<tabId>`, the tab's claimed top documents; `chainportal:<tabId>:<frameId>`, a portal
 *  frame's document and its application (notePortal). */
export const CHAIN_PREFIX = 'chain:';
export const CHAIN_PORTAL_PREFIX = 'chainportal:';
/** jr6 SHELL-B: storage.session `chainfacts:<tabId>:<frameId>`, a claim frame's document's step facts (factsSaid). */
export const CHAIN_FACTS_PREFIX = 'chainfacts:';

/** jr6 SHELL-B: a claim frame's document's step facts, as factsSaid keeps them. */
interface FactsRecord {
  documentId: string | null;
  applicationKey: string;
  facts: ChainStepFacts | null;
}

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
  /** jr6 SHELL-B: one message to one frame's document (a leaf's chain/leafFacts, a portal's frame/ping); absent: no
   *  facts are handed. */
  tabs?: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  /** jr6 SHELL-B: the portal's probe gives up after FRAME_PROBE_TIMEOUT_MS by these; absent: no probe, no facts handed to
   *  a leaf chained later. */
  timers?: Timers;
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

// ── jr6 SHELL-B (module header): the claim frame's step facts, kept and handed ──
const isFactsRecord = (value: unknown): value is FactsRecord => typeof value === 'object' && value !== null
  && ((value as FactsRecord).documentId === null || typeof (value as FactsRecord).documentId === 'string')
  && typeof (value as FactsRecord).applicationKey === 'string' && typeof (value as FactsRecord).facts === 'object';

/** The frame that may say step facts: the tab's claim frame (frames.ts claimFrameOf) in the document registered for it,
 *  holding an application, no chain page itself and no wrapper, on a portal whose pages frame chain pages
 *  (chainChildOrigin: an iCIMS portal); null for any other frame or document. */
function factsPortalOf(frames: readonly FrameEntry[], from: { frameId: number; documentId: string | null }):
  FrameEntry | null {
  const claim = claimFrameOf(frames);
  if (claim === null || claim.frameId !== from.frameId || claim.documentId !== from.documentId) return null;
  if (claim.applicationKey === undefined || claim.chained === true || claim.wraps === true) return null;
  const origin = urlOf(claim.origin);
  return origin !== null && chainChildOrigin(origin) !== null ? claim : null;
}

/** The leaf frames chained from `portal` in its tab (core-x items 7 and 14: chainedFrom), at its application and on its
 *  family's forms origin (chainChildOrigin), never the top frame. */
function leavesOf(frames: readonly FrameEntry[], portal: FrameEntry): FrameEntry[] {
  const origin = urlOf(portal.origin);
  const forms = origin === null ? null : chainChildOrigin(origin);
  return frames.filter((frame) => frame.frameId !== 0 && frame.chained === true && frame.chainedFrom === portal.frameId
    && frame.applicationKey === portal.applicationKey && forms !== null && frame.origin === forms);
}
// ── end jr6 SHELL-B ──

/** The tabs' chains, as index.ts wires them. */
export function createChains(deps: ChainDeps) {
  const fresh = (at: number) => deps.now() - at >= 0 && deps.now() - at <= CHAIN_MS;

  async function recordsOf(tabId: number): Promise<TopRecord[]> {
    const held = await deps.session.get(`${CHAIN_PREFIX}${tabId}`);
    return Array.isArray(held) ? held.filter(isRecord) : [];
  }

  // ── jr6 SHELL-B (module header): the claim frame's step facts ──
  /** One tab's handing of facts at a time (`facts:<tabId>`): a leaf hears the latest facts last. */
  const handing = createKeyedQueue();

  /** chain/leafFacts to one leaf frame's document; a document gone answers nothing, and is no failure. */
  async function hand(tabId: number, leaf: { frameId: number; documentId: string | null },
    facts: ChainStepFacts | null): Promise<void> {
    await deps.tabs?.sendToFrame(tabId, { v: 1, type: 'chain/leafFacts', facts },
      leaf.documentId === null ? { frameId: leaf.frameId } : { frameId: leaf.frameId, documentId: leaf.documentId })
      .catch(() => undefined);
  }

  /** Whether the portal frame's registered document still answers, itself ({pong: true} to a frame/ping at its
   *  document), within FRAME_PROBE_TIMEOUT_MS: a document gone, cached or silent is not. */
  function answers(tabId: number, portal: FrameEntry): Promise<boolean> {
    const { tabs, timers } = deps;
    if (tabs === undefined || timers === undefined) return Promise.resolve(false);
    return new Promise((resolve) => {
      const cancel = timers.after(FRAME_PROBE_TIMEOUT_MS, () => resolve(false));
      tabs.sendToFrame(tabId, { v: 1, type: 'frame/ping' }, frameTarget(portal)).then((answer) => {
        cancel();
        const data = (answer as { ok?: unknown; data?: { pong?: unknown } } | undefined);
        resolve(data?.ok === true && data.data?.pong === true);
      }, () => {
        cancel();
        resolve(false);
      });
    });
  }

  // ── end jr6 SHELL-B ──

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

    /** jr6 SHELL-B (module header): a leaf frame's document the tab's chain keyed (`leaf`, as registered: chained from
     *  its portal frame) hears the step facts that portal frame's registered document said, once that document still
     *  answers (a frame/ping it answers itself), read again then (the latest), under the tab's handing. None kept, kept
     *  for another document of that frame, or the portal no longer the tab's claim frame: nothing. Called once the
     *  leaf's hello is registered, so a factsSaid after it finds the leaf. */
    leafChained(tabId: number, leaf: FrameEntry, framesNow: () => Promise<readonly FrameEntry[]>): Promise<void> {
      return handing.run(`facts:${tabId}`, async () => {
        if (deps.tabs === undefined || leaf.chained !== true || leaf.chainedFrom === undefined) return;
        const frames = (await framesNow()).filter((each) => each.tabId === tabId);
        const portal = frames.find((each) => each.frameId === leaf.chainedFrom) ?? null;
        if (portal === null || factsPortalOf(frames, portal) !== portal
          || !leavesOf(frames, portal).some((each) => each.frameId === leaf.frameId
            && each.documentId === leaf.documentId)) return;
        const key = `${CHAIN_FACTS_PREFIX}${tabId}:${portal.frameId}`;
        const kept = (held: unknown): held is FactsRecord => isFactsRecord(held) && held.documentId === portal.documentId
          && held.applicationKey === portal.applicationKey && held.facts !== null;
        if (!kept(await deps.session.get(key))) return;
        if (!(await answers(tabId, portal))) {
          log('frame.chain-refused', { top: false, facts: true, found: 6 });
          return;
        }
        const held = await deps.session.get(key);
        if (!kept(held)) return;
        await hand(tabId, leaf, held.facts);
        log('frame.chained', { top: false, facts: true, leaves: 1 });
      }).catch(() => undefined);
    },

    /** jr6 SHELL-B (module header; INTEGRATION.md SHELL-B item 1): chain/facts from `from`, a frame of the tab: kept for
     *  its document and handed to the leaf frames chained from it (leavesOf), only where it is the tab's claim frame on a
     *  portal whose pages frame chain pages, in its registered document (factsPortalOf). Answers whether it was taken.
     *  `framesNow` reads the tab's registered frames now. */
    async factsSaid(tabId: number, from: { frameId: number; documentId: string | null }, facts: ChainStepFacts | null,
      framesNow: () => Promise<readonly FrameEntry[]>): Promise<boolean> {
      return handing.run(`facts:${tabId}`, async () => {
        const frames = (await framesNow()).filter((each) => each.tabId === tabId);
        const portal = factsPortalOf(frames, from);
        if (portal === null) {
          log('frame.chain-refused', { top: false, facts: true, found: 7 });
          return false;
        }
        const record: FactsRecord = { documentId: portal.documentId, applicationKey: portal.applicationKey!, facts };
        await deps.session.set({ [`${CHAIN_FACTS_PREFIX}${tabId}:${portal.frameId}`]: record });
        const leaves = leavesOf(frames, portal);
        await Promise.all(leaves.map((leaf) => hand(tabId, leaf, facts)));
        log('frame.chained', { top: false, facts: true, leaves: leaves.length });
        return true;
      });
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

    /** A closed tab's chain and its portals' records go with it (jr6 SHELL-B: and its claim frames' step facts). */
    async forgetTab(tabId: number): Promise<void> {
      const portals = Object.keys(await deps.session.getMany(`${CHAIN_PORTAL_PREFIX}${tabId}:`));
      const facts = Object.keys(await deps.session.getMany(`${CHAIN_FACTS_PREFIX}${tabId}:`)); // jr6 SHELL-B
      await deps.session.remove([`${CHAIN_PREFIX}${tabId}`, ...portals, ...facts]);
    },
  };
}

/** The tabs' chains, as index.ts wires them. */
export type Chains = ReturnType<typeof createChains>;
