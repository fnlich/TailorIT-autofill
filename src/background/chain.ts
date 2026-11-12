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
 * - jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5):
 *   - ICIMS7-01: a portal whose forms host is not its own name's (snapshot7's arc-onesolutions frames its IForms from
 *     oneblood.icims.com, so chainChildOrigin names none) says, in its hello, the origin of the forms frame it shows
 *     (Adapter.chainChildOrigins: origins only, never an address). notePortal keeps it with the portal's document
 *     (declaredChildOrigin: an https origin whose /forms page is a chain subframe page of the portal's platform), and
 *     inheritFrame keys a chain subframe on the one origin the tab's one fresh claimed portal declared, every other guard
 *     as before; the host-name rule stays. Never by document.referrer.
 *   - ICIMS7-V1: the relay hands facts by the leaf's chain link (chainedFrom), never a family; every saying of a portal
 *     document's facts takes the next number (`seq`); a leaf's press of its form's Submit (chain/pressed: Next or the
 *     final Submit, the run's or the person's) marks its portal's facts as said before it (`pressedSeq`), so a leaf
 *     document chained after it hears only facts said after the press, and the pressing document none newer than its own
 *     (`pressedBy`). None means unknown: nothing is pressed. A (2/2) leaf is never handed its (1/2) facts.
 *   - PC7-03: a pair page (adapters/chain.ts: Paycom's …/applications#/applications/<m>, a new document) takes the
 *     application of the tab's top frame's posting of its family whose latest press (its Apply, the agent's entry, its
 *     sign-in step, a change of its dialog) was noted within PAIR_MS (notePair: storage.session `chainpair:<tabId>`:
 *     the family, the application's key and canonical address, the posting's document and when; no address of the page),
 *     once per press (inheritPair). Never by the page's number, never by its referrer.
 *   - UKGR-3: UKG Ready's applicant session is a top chain page (adapters/chain.ts), keyed by its referrer as above.
 * Nothing here logs a key, an address or a hash.
 */
import { applicationOf } from '../adapters';
import { chainChildOrigin, chainFamilyOf, chainPageOf, declaredChildOrigin, hrefHash, pairPostingFamilyOf } from '../adapters/chain'; // jr7 CHAIN-7: the last two
import { PLATFORMS, type Platform } from '../core/enums'; // jr7 CHAIN-7
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
// ── jr7 CHAIN-7 (module header) ──
/** PC7-03: storage.session `chainpair:<tabId>`, the tab's latest posting press a pair page may take (notePair). */
export const CHAIN_PAIR_PREFIX = 'chainpair:';
/** PC7-03: how long after a posting's latest press its pair page may take its application (FIX7PLAN §6.5 item 5). */
export const PAIR_MS = 60_000;
/** ICIMS7-01: the origins a portal's hello may declare (Adapter.chainChildOrigins). */
export const MAX_CHILD_ORIGINS = 4;
/** ICIMS7-V1: the pressing leaf documents a portal document's facts remember (the latest). */
const MAX_PRESSED_BY = 8;
// ── end jr7 CHAIN-7 ──

/** jr6 SHELL-B: a claim frame's document's step facts, as factsSaid keeps them. */
interface FactsRecord {
  documentId: string | null;
  applicationKey: string;
  facts: ChainStepFacts | null;
  // ── jr7 CHAIN-7 (ICIMS7-V1; module header) ──
  /** The number of this saying of the document's facts (1, 2, …); a record kept before jr7 reads 0. */
  seq?: number;
  /** The `seq` that was latest when a leaf chained from the portal pressed its form's Submit, last (absent: none). */
  pressedSeq?: number;
  /** The leaf documents that pressed (the latest MAX_PRESSED_BY): each holds facts of its own form, never newer ones. */
  pressedBy?: Array<string | null>;
  // ── end jr7 CHAIN-7 ──
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
  /** jr7 CHAIN-7 (ICIMS7-01): the forms frames' origins the document declared (declaredChildOrigin), where it did. */
  origins?: string[];
}

/** jr7 CHAIN-7 (PC7-03): a posting's latest press a pair page of its family may take (notePair). */
interface PairRecord {
  family: string;
  applicationKey: string;
  /** The application's canonical address (the posting's), for TailorIT: never the page's own. */
  url: string;
  documentId: string | null;
  at: number;
  used: boolean;
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
 *  (chainChildOrigin: an iCIMS portal; jr7 CHAIN-7, ICIMS7-01: or whose document declared its forms frames' origins,
 *  `declared`); null for any other frame or document. */
function factsPortalOf(frames: readonly FrameEntry[], from: { frameId: number; documentId: string | null },
  declared: (portal: FrameEntry) => readonly string[]): FrameEntry | null {
  const claim = claimFrameOf(frames);
  if (claim === null || claim.frameId !== from.frameId || claim.documentId !== from.documentId) return null;
  if (claim.applicationKey === undefined || claim.chained === true || claim.wraps === true) return null;
  return formsOrigins(claim, declared).length > 0 ? claim : null;
}

/** jr7 CHAIN-7 (ICIMS7-01, ICIMS7-V1): the origins of the chain subframes `portal` frames: its family's forms host
 *  (chainChildOrigin), and those its document declared (`declared`). */
function formsOrigins(portal: FrameEntry, declared: (portal: FrameEntry) => readonly string[]): string[] {
  const origin = urlOf(portal.origin);
  const named = origin === null ? null : chainChildOrigin(origin);
  return [...new Set([...(named === null ? [] : [named]), ...declared(portal)])];
}

/** The leaf frames chained from `portal` in its tab (core-x items 7 and 14: chainedFrom), at its application and on its
 *  forms origins (formsOrigins; jr7 CHAIN-7 ICIMS7-V1: by the leaf's own chain link, never a family), never the top
 *  frame. */
function leavesOf(frames: readonly FrameEntry[], portal: FrameEntry, declared: (portal: FrameEntry) => readonly string[]):
  FrameEntry[] {
  const forms = formsOrigins(portal, declared);
  return frames.filter((frame) => frame.frameId !== 0 && frame.chained === true && frame.chainedFrom === portal.frameId
    && frame.applicationKey === portal.applicationKey && forms.includes(frame.origin));
}

// ── jr7 CHAIN-7 (module header) ──
const isPair = (value: unknown): value is PairRecord => typeof value === 'object' && value !== null
  && typeof (value as PairRecord).family === 'string' && typeof (value as PairRecord).applicationKey === 'string'
  && typeof (value as PairRecord).url === 'string' && typeof (value as PairRecord).at === 'number'
  && typeof (value as PairRecord).used === 'boolean'
  && ((value as PairRecord).documentId === null || typeof (value as PairRecord).documentId === 'string');

/** The platform an application key names (`${platform}:${hex16}`), or null. */
function platformOfKey(applicationKey: string): Platform | null {
  const platform = applicationKey.split(':')[0] ?? '';
  return (PLATFORMS as readonly string[]).includes(platform) ? platform as Platform : null;
}

/** ICIMS7-01: the origins a portal's hello declared that the worker takes (declaredChildOrigin, for the platform of the
 *  application it holds), at most MAX_CHILD_ORIGINS, each once. */
function takenOrigins(applicationKey: string, origins: readonly unknown[] | undefined): string[] {
  const platform = platformOfKey(applicationKey);
  if (platform === null || origins === undefined) return [];
  const taken = origins.filter((origin): origin is string => typeof origin === 'string'
    && declaredChildOrigin(origin, platform));
  return [...new Set(taken)].slice(0, MAX_CHILD_ORIGINS);
}

/** ICIMS7-V1: whether a kept saying may go to `leaf`: said after the latest press of a leaf chained from its portal, and
 *  `leaf` no document that pressed (each holds the facts of its own form). */
function freshFor(held: FactsRecord, leaf: { documentId: string | null }): boolean {
  if ((held.pressedBy ?? []).includes(leaf.documentId)) return false;
  return held.pressedSeq === undefined || (held.seq ?? 0) > held.pressedSeq;
}
// ── end jr7 CHAIN-7 ──
// ── end jr6 SHELL-B ──

/** The tabs' chains, as index.ts wires them. */
export function createChains(deps: ChainDeps) {
  const fresh = (at: number) => deps.now() - at >= 0 && deps.now() - at <= CHAIN_MS;

  async function recordsOf(tabId: number): Promise<TopRecord[]> {
    const held = await deps.session.get(`${CHAIN_PREFIX}${tabId}`);
    return Array.isArray(held) ? held.filter(isRecord) : [];
  }

  // ── jr7 CHAIN-7 (ICIMS7-01; module header) ──
  /** A portal frame's kept record (notePortal), for the document registered for it now; null otherwise. */
  async function portalRecordOf(tabId: number, frame: FrameEntry): Promise<PortalRecord | null> {
    const held = await deps.session.get(`${CHAIN_PORTAL_PREFIX}${tabId}:${frame.frameId}`);
    return isPortal(held) && held.documentId === frame.documentId && held.applicationKey === frame.applicationKey
      ? held : null;
  }

  /** The tab's portal frames' declared origins, read once for a decision (each frame's record for its document now). */
  async function declaredOf(tabId: number, frames: readonly FrameEntry[]): Promise<(portal: FrameEntry) => readonly string[]> {
    const held = new Map<number, readonly string[]>();
    await Promise.all(frames.map(async (frame) => {
      if (frame.applicationKey === undefined || frame.chained === true) return;
      const record = await portalRecordOf(tabId, frame);
      if (record?.origins !== undefined) held.set(frame.frameId, takenOrigins(record.applicationKey, record.origins));
    }));
    return (portal) => held.get(portal.frameId) ?? [];
  }
  // ── end jr7 CHAIN-7 ──

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
      // jr7 CHAIN-7 (PC7-03): a pair page is keyed by its tab's posting press alone (inheritPair), never its referrer.
      if (page === null || page.role !== 'top' || page.pair === true) return null;
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
      // jr7 CHAIN-7 (ICIMS7-01): the origins each portal frame's document declared (notePortal).
      const declared = await declaredOf(tabId, frames);
      // The tab's portal frames of the asking frame's company holding an application of its platform: a wrapper (which
      // defers to the frame it claims for) and a chained page aside. jr7 CHAIN-7 (ICIMS7-01): or of any company of the
      // platform whose document declared exactly one forms origin, the asking frame's.
      const portals = frames.filter((each) => {
        const origin = urlOf(each.origin);
        if (each.frameId === frame.frameId || each.wraps === true || each.chained === true
          || each.applicationKey?.startsWith(`${page.platform}:`) !== true || origin === null) return false;
        const named = chainFamilyOf(origin) === page.family && chainChildOrigin(origin) === url.origin;
        const own = declared(each); // jr7 CHAIN-7
        return named || (own.length === 1 && own[0] === url.origin); // jr7 CHAIN-7
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
        const declared = await declaredOf(tabId, frames); // jr7 CHAIN-7 (ICIMS7-01)
        if (portal === null || factsPortalOf(frames, portal, declared) !== portal
          || !leavesOf(frames, portal, declared).some((each) => each.frameId === leaf.frameId
            && each.documentId === leaf.documentId)) return;
        const key = `${CHAIN_FACTS_PREFIX}${tabId}:${portal.frameId}`;
        // jr7 CHAIN-7 (ICIMS7-V1): only facts said after the latest press of a leaf of this portal, never to a leaf
        // document that pressed.
        const kept = (held: unknown): held is FactsRecord => isFactsRecord(held) && held.documentId === portal.documentId
          && held.applicationKey === portal.applicationKey && held.facts !== null && freshFor(held, leaf);
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
        const declared = await declaredOf(tabId, frames); // jr7 CHAIN-7 (ICIMS7-01)
        const portal = factsPortalOf(frames, from, declared);
        if (portal === null) {
          log('frame.chain-refused', { top: false, facts: true, found: 7 });
          return false;
        }
        // jr7 CHAIN-7 (ICIMS7-V1): the document's next saying, its presses kept; handed to its leaves but those that
        // pressed.
        const key = `${CHAIN_FACTS_PREFIX}${tabId}:${portal.frameId}`;
        const before = await deps.session.get(key);
        const same = isFactsRecord(before) && before.documentId === portal.documentId
          && before.applicationKey === portal.applicationKey ? before : null;
        const record: FactsRecord = { documentId: portal.documentId, applicationKey: portal.applicationKey!, facts,
          seq: (same?.seq ?? 0) + 1,
          ...(same?.pressedSeq === undefined ? {} : { pressedSeq: same.pressedSeq, pressedBy: same.pressedBy ?? [] }) };
        await deps.session.set({ [key]: record });
        const leaves = leavesOf(frames, portal, declared).filter((leaf) => freshFor(record, leaf));
        await Promise.all(leaves.map((leaf) => hand(tabId, leaf, facts)));
        log('frame.chained', { top: false, facts: true, leaves: leaves.length });
        return true;
      });
    },

    // ── jr7 CHAIN-7 (ICIMS7-V1; module header) ──
    /** chain/pressed from `from`, a leaf frame of the tab chained from its portal frame (as registered: chained, at the
     *  portal's application, in its registered document, on its forms origins): the portal document's facts kept so far
     *  count as said before this press (`pressedSeq`), and the pressing document holds no newer ones (`pressedBy`). A
     *  portal that said none yet keeps the press for its document. Answers whether it was taken; any other frame:
     *  refused, nothing changed. */
    async leafPressed(tabId: number, from: { frameId: number; documentId: string | null },
      framesNow: () => Promise<readonly FrameEntry[]>): Promise<boolean> {
      return handing.run(`facts:${tabId}`, async () => {
        const frames = (await framesNow()).filter((each) => each.tabId === tabId);
        const leaf = frames.find((each) => each.frameId === from.frameId && each.documentId === from.documentId) ?? null;
        const portal = leaf === null || leaf.chained !== true ? null
          : frames.find((each) => each.frameId === leaf.chainedFrom) ?? null;
        const declared = await declaredOf(tabId, frames);
        if (leaf === null || portal === null || portal.applicationKey === undefined
          || !leavesOf(frames, portal, declared).includes(leaf)) {
          log('frame.chain-refused', { top: false, facts: true, pressed: true, found: 8 });
          return false;
        }
        const key = `${CHAIN_FACTS_PREFIX}${tabId}:${portal.frameId}`;
        const before = await deps.session.get(key);
        const same = isFactsRecord(before) && before.documentId === portal.documentId
          && before.applicationKey === portal.applicationKey ? before : null;
        const record: FactsRecord = { documentId: portal.documentId, applicationKey: portal.applicationKey,
          facts: same?.facts ?? null, seq: same?.seq ?? 0, pressedSeq: same?.seq ?? 0,
          pressedBy: [...(same?.pressedBy ?? []).filter((each) => each !== leaf.documentId), leaf.documentId]
            .slice(-MAX_PRESSED_BY) };
        await deps.session.set({ [key]: record });
        log('frame.chained', { top: false, facts: true, pressed: true });
        return true;
      });
    },

    /** PC7-03 (module header): the tab's top frame, a posting a pair page of its family takes (adapters/chain.ts
     *  pairPostingFamilyOf: Paycom's …/jobs/<n>), in its registered document (`frame`, holding its application), pressed
     *  (its Apply, the agent's entry, its sign-in step) or changed its dialog now: kept as the tab's latest press, not yet
     *  taken. `url`: the frame's address, Chrome's. Any other frame or page: nothing. */
    async notePair(tabId: number, frame: FrameEntry, url: string): Promise<void> {
      const at = urlOf(url);
      const family = at === null ? null : pairPostingFamilyOf(at);
      if (frame.frameId !== 0 || frame.tabId !== tabId || frame.applicationKey === undefined || family === null
        || frame.applicationKey.split(':')[0] !== family.split(':')[0]) return;
      const canonical = frame.chainUrl ?? applicationOf(at!)?.applicationUrl ?? null;
      if (canonical === null) return;
      const record: PairRecord = { family, applicationKey: frame.applicationKey, url: canonical,
        documentId: frame.documentId, at: deps.now(), used: false };
      await deps.session.set({ [`${CHAIN_PAIR_PREFIX}${tabId}`]: record });
    },

    /** PC7-03 (module header): a top frame's pair page said hello: the application of the tab's latest posting press of
     *  its family (notePair), from another document, within PAIR_MS of that press, not taken before; taken now, once.
     *  Null otherwise. */
    async inheritPair(tabId: number, frame: { url: string; documentId: string | null }): Promise<Inherited | null> {
      const url = urlOf(frame.url);
      const page = url === null ? null : chainPageOf(url);
      if (page === null || page.role !== 'top' || page.pair !== true) return null;
      const key = `${CHAIN_PAIR_PREFIX}${tabId}`;
      const held = await deps.session.get(key);
      const age = isPair(held) ? deps.now() - held.at : -1;
      if (!isPair(held) || held.used || held.family !== page.family || !held.applicationKey.startsWith(`${page.platform}:`)
        || held.documentId === frame.documentId || age < 0 || age > PAIR_MS) {
        log('frame.chain-refused', { top: true, pair: true, found: isPair(held) ? 1 : 0 });
        return null;
      }
      await deps.session.set({ [key]: { ...held, used: true } });
      log('frame.chained', { top: true, pair: true });
      return { applicationKey: held.applicationKey, url: held.url };
    },
    // ── end jr7 CHAIN-7 ──

    /** A frame of the tab that holds an application on a portal whose pages frame chain pages (adapters/chain.ts
     *  chainChildOrigin: an iCIMS portal; jr7 CHAIN-7, ICIMS7-01: or whose hello declared the origins of the forms
     *  frames it shows, `childOrigins`, as declaredChildOrigin takes them) said hello: its application's canonical
     *  address is kept for its document, with the origins it declared, so a chain subframe it frames is named by it
     *  (never the portal page's own address). */
    async notePortal(tabId: number, frame: { frameId: number; documentId: string | null; applicationKey: string;
      url: string; childOrigins?: readonly string[] }): Promise<void> {
      const url = urlOf(frame.url);
      const origins = takenOrigins(frame.applicationKey, frame.childOrigins); // jr7 CHAIN-7
      if (url === null || (chainChildOrigin(url) === null && origins.length === 0)) return; // jr7 CHAIN-7: or declared
      const canonical = applicationOf(url)?.applicationUrl ?? null;
      if (canonical === null) return;
      const record: PortalRecord = { documentId: frame.documentId, applicationKey: frame.applicationKey, url: canonical,
        ...(origins.length === 0 ? {} : { origins }) }; // jr7 CHAIN-7
      await deps.session.set({ [`${CHAIN_PORTAL_PREFIX}${tabId}:${frame.frameId}`]: record });
    },

    /** A closed tab's chain and its portals' records go with it (jr6 SHELL-B: and its claim frames' step facts; jr7
     *  CHAIN-7: and its posting's press). */
    async forgetTab(tabId: number): Promise<void> {
      const portals = Object.keys(await deps.session.getMany(`${CHAIN_PORTAL_PREFIX}${tabId}:`));
      const facts = Object.keys(await deps.session.getMany(`${CHAIN_FACTS_PREFIX}${tabId}:`)); // jr6 SHELL-B
      await deps.session.remove([`${CHAIN_PREFIX}${tabId}`, `${CHAIN_PAIR_PREFIX}${tabId}`, ...portals, ...facts]); // jr7 CHAIN-7: the pair
    },
  };
}

/** The tabs' chains, as index.ts wires them. */
export type Chains = ReturnType<typeof createChains>;
