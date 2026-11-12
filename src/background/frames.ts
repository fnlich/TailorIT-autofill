/*
 * The frames that announced themselves, per tab, in storage.session (memory only, gone when the browser restarts).
 * The panel's Fill starts every registered frame that has a form. An entry keeps the frame's origin and platform,
 * never its full address: page URLs stay out of storage.
 *
 * Frames come and go without a word: when a top frame loads another page, the subframes of the old one vanish. So
 * whenever a frame says hello from a document the registry has not seen, the worker asks each of the tab's other
 * frames, at its own {frameId, documentId}, whether that document is still there (`frame/ping`), and forgets only those
 * in which nothing receives, twice, a grace period apart. It never goes by arrival order: a subframe of the new page
 * can say hello, and report, before its top frame does, and it answers, so it stays. A panel that reads or starts to
 * follow a tab asks the same of all its frames, because a page with none of our frames says no hello at all.
 * The snapshot build of 2026-11-06 (core-x; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): an entry also says whether the top frame is a
 * company's wrapper (`wraps`) and a subframe claims its application (`claimed`: claimFrameOf), and, for a document whose
 * address names no job, the application the tab's chain gave it (`chained`, background/chain.ts) with that application's
 * canonical posting address (`chainUrl`, the one TailorIT is asked with for it), never the page's own address.
 */
import { applicationOf } from '../adapters';
import { parseAtsUrl } from '../contract/tailorit';
import type { Platform } from '../core/enums';
import type { EntryRefusal, PageState, SignInWall, WallWaits } from '../messaging/schemas';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { platformOfUrl } from '../shared/hosts';
import { log } from '../shared/log';
import type { Timers } from './timers';

export interface FrameEntry {
  tabId: number;
  frameId: number;
  documentId: string | null;
  origin: string;
  platform: Platform | null;
  isTop: boolean;
  hasForm: boolean;
  registeredAt: number;
  /** How many times a single-page application changed the frame's address within this document, as its hello said
   *  (v2; absent: none). A count, never an address. */
  nav?: number;
  /** v3 Phase 3: the frame's form asks for a cover letter (its hello said so; absent: it does not). */
  letter?: true;
  /** v3 Phase 3b: the tab's top frame shows, with no form, a posting a platform's parser reads (the worker's own reading
   *  of the frame's address at its hello, never the frame's word): its card shows in the side panel. */
  posting?: true;
  /** The v3 Phase 4 review: the tab's top frame shows, with no form, the platform's page after submitting (Lever's
   *  /thanks, Greenhouse's /confirmation): its card is the one POST /applied answered, never looked up. */
  confirmation?: true;
  /** The review (M2): the application the frame's address belongs to, as the worker's parser reads it at the hello (a
   *  hash, never the address): the job chosen and "Apply without resume" follow it. */
  applicationKey?: string;
  // ── snapshot build 2026-11-06 (core-x, items 3, 7 and 14) ──
  /** The top frame is a company's wrapper that draws the application in a frame of its own (its hello said so). */
  wraps?: true;
  /** A subframe whose adapter claims the tab's application (its hello said so; claimFrameOf checks it). */
  claimed?: true;
  /** The frame's document took its application from the tab's chain (background/chain.ts): its key is that one, and
   *  `chainUrl` the application's canonical address, the one TailorIT is asked with for it (never the page's own); a
   *  subframe's names the frame that framed it (`chainedFrom`). */
  chained?: true;
  chainUrl?: string;
  chainedFrom?: number;
  // ── v4 run (docs/SPEC-AMENDMENTS.md §13) ──
  /** The account wall the frame shows now, as its frame/wall said (a top or claim frame's; absent: none). Kept while
   *  the same document says hello again. */
  wall?: SignInWall;
  /** The frame shows a choice of how to apply its adapter answers with a declared entry (frame/wall's `choice`). */
  choice?: true;
  /** s2 profile (P1): what the frame's page waits for while no run holds it (frame/wall's `waits`). */
  waits?: WallWaits;
  /** v5 p2-fill: the frame shows a posting with no form whose adapter offers its own Apply (frame/wall's `entry`). */
  entry?: true;
  /** v5 p2-fill review (L5): the frame's last Autofill could not press that Apply (frame/wall's `entryRefused`), while
   *  no wall or choice shows. Not kept by a hello. */
  entryRefused?: true;
  // ── jr6 apply F3a (APPLYPLAN §5 F3a item 4) ──
  /** The frame is pressing the site's own Apply or waiting for what the press brings (frame/wall's `entering`), a wall
   *  or a choice its press drew in this document included (the line P review, revA-3 and P-B3: its sign-in step, the
   *  choice it waits past, so the panel's Cancel reaches it there too). Kept while the same document says hello again
   *  with no form, as `entry` is. */
  entering?: true;
  /** Why its last entry was refused (frame/wall's `refusal`), beside `entryRefused` alone. Not kept by a hello. */
  refusal?: EntryRefusal;
  /** The frame's document said `entry` once (apply-b-new-2: ADP's job details, an application address with no form):
   *  its top frame is the tab's card frame while it shows no form, through the consent and the guest view drawn in
   *  place at the same address. Kept by setWall, and by a hello of the same document at the same address. */
  entrySaid?: true;
  // ── jr7 AUTO-7 (ICIMS7-11, FIX7PLAN D-6 and §6.4 item 20) ──
  /** The top frame's posting address its adapter gives TailorIT in place of the page's own (a Jibe page's iCIMS
   *  posting), as the worker's own check took it (checkedTailoritAddress): TailorIT is asked with it (lookup, Add job).
   *  Kept for the document it was said in. */
  tailoritUrl?: string;
  // ── end jr7 AUTO-7 ──
}

const keyOf = (tabId: number, frameId: number) => `frames:${tabId}:${frameId}`;

// ── jr7 AUTO-7 (ICIMS7-11, D-6; FIX7PLAN §6.4 item 20) ──
/** The address a Jibe page's adapter names for TailorIT (`candidate`, frame/hello's tailoritAddress), checked again
 *  here against the page's own address as Chrome gives it (`pageUrl`): only on a Jibe posting page, an https iCIMS
 *  posting or application page of the same numeric job id, with no credentials, no query and no fragment (built from
 *  parts, never a link's query). Anything else: null (the page's own address is given). */
export function checkedTailoritAddress(pageUrl: string, candidate: string): string | null {
  let page: URL;
  let named: URL;
  try {
    page = new URL(pageUrl);
    named = new URL(candidate);
  } catch {
    return null;
  }
  if (platformOfUrl(page.href) !== 'jibe') return null;
  if (named.protocol !== 'https:' || named.username !== '' || named.password !== '' || named.search !== ''
    || named.hash !== '') return null;
  const ref = applicationOf(named);
  if (ref === null || ref.platform !== 'icims' || (ref.page !== 'posting' && ref.page !== 'application')) return null;
  const jobOf = (url: URL) => /^\/jobs\/(\d{1,12})(?:\/|$)/.exec(url.pathname)?.[1] ?? null;
  const id = jobOf(page);
  return id !== null && id === jobOf(named) ? named.href : null;
}
// ── end jr7 AUTO-7 ──

/** The application a chain gave a frame's document (background/chain.ts): its key, its canonical address and the frame
 *  that framed it (a subframe's). */
export interface FrameChain {
  applicationKey: string;
  url: string;
  parentFrameId?: number;
}

/** Records a frame. One key per frame, so frames of one tab registering at once never overwrite each other. */
export async function registerFrame(
  session: StorageArea,
  frame: { tabId: number; frameId: number; documentId: string | undefined; url: string; isTop: boolean; hasForm: boolean;
    nav?: number; letter?: true; keepKey?: string; wraps?: true; claimed?: true; chain?: FrameChain;
    /** jr7 AUTO-7 (ICIMS7-11): the checked address TailorIT is asked with for a top frame's posting. */
    tailoritUrl?: string;
    /** v4: the same document's wall and choice, kept from its entry (frame/wall); s2 profile, what it waits for;
     *  v5 p2-fill, its posting's own Apply; jr6 apply F3a, its press under way and the entry it said. */
    wall?: SignInWall; choice?: true; waits?: WallWaits; entry?: true; entering?: true; entrySaid?: true },
  now: number,
): Promise<FrameEntry> {
  const entry: FrameEntry = {
    tabId: frame.tabId,
    frameId: frame.frameId,
    documentId: frame.documentId ?? null,
    origin: new URL(frame.url).origin,
    // v3 Phase 8: a company's own page the worker injected is the site's.
    platform: platformOfUrl(frame.url) ?? siteOf(frame.url),
    isTop: frame.isTop,
    hasForm: frame.hasForm,
    registeredAt: now,
    ...(frame.nav === undefined || frame.nav === 0 ? {} : { nav: frame.nav }),
    ...(frame.letter === true && frame.hasForm ? { letter: true as const } : {}),
    ...(!frame.hasForm && frame.frameId === 0 && postingAddress(frame.url, frame.tailoritUrl) // jr7 AUTO-7
      ? { posting: true as const } : {}),
    // core-x, item 3: the frame that claims a wrapper's application shows its page after submitting as a top frame does.
    ...(!frame.hasForm && (frame.frameId === 0 || frame.claimed === true) && confirmationAddress(frame.url)
      ? { confirmation: true as const } : {}),
    ...applicationKeyOf(frame.url, frame.keepKey),
    ...(frame.wraps === true && frame.frameId === 0 ? { wraps: true as const } : {}),
    ...(frame.claimed === true && frame.frameId !== 0 ? { claimed: true as const } : {}),
    // core-x, items 7 and 14: a chain's application, in place of the address's own.
    ...(frame.chain === undefined ? {} : { applicationKey: frame.chain.applicationKey, chained: true as const,
      chainUrl: frame.chain.url, ...(frame.chain.parentFrameId === undefined ? {}
        : { chainedFrom: frame.chain.parentFrameId }) }),
    ...(frame.wall === undefined ? {} : { wall: frame.wall }),
    ...(frame.choice === true ? { choice: true as const } : {}),
    ...(frame.waits === undefined ? {} : { waits: frame.waits }),
    ...(frame.entry === true ? { entry: true as const } : {}),
    // jr6 apply F3a.
    ...(frame.entering === true ? { entering: true as const } : {}),
    ...(frame.entrySaid === true ? { entrySaid: true as const } : {}),
    // jr7 AUTO-7 (ICIMS7-11): a top frame's alone.
    ...(frame.tailoritUrl !== undefined && frame.frameId === 0 ? { tailoritUrl: frame.tailoritUrl } : {}),
  };
  await session.set({ [keyOf(frame.tabId, frame.frameId)]: entry });
  return entry;
}

/** v4: a frame's frame/wall: its entry, for the same document, takes the wall and the choice it shows now (none:
 *  gone). Answers the entry as stored, or null when the frame is not registered for that document. */
export async function setWall(session: StorageArea, tabId: number, frameId: number, documentId: string | null,
  shown: { wall: SignInWall | null; choice: boolean; waits?: WallWaits; entry?: boolean; entryRefused?: boolean;
    entering?: boolean; refusal?: EntryRefusal }):
  Promise<FrameEntry | null> {
  const held = await frameEntry(session, tabId, frameId);
  if (held === null || held.documentId !== documentId) return null;
  const { wall: _wall, choice: _choice, waits: _waits, entry: _entry, entryRefused: _refused, entering: _entering,
    refusal: _refusal, ...rest } = held;
  const open = shown.wall === null && !shown.choice;
  const refused = shown.entryRefused === true && open;
  const entry: FrameEntry = { ...rest, ...(shown.wall === null ? {} : { wall: shown.wall }),
    ...(shown.choice ? { choice: true as const } : {}), ...(shown.waits === undefined ? {} : { waits: shown.waits }),
    // v5 p2-fill: a posting's own Apply, offered while no wall or choice shows.
    ...(shown.entry === true && open ? { entry: true as const } : {}),
    // v5 p2-fill review (L5): its refusal, likewise.
    ...(refused ? { entryRefused: true as const } : {}),
    // jr6 apply F3a: its press under way, whatever shows (the line P review, revA-3 and P-B3: a wall or a choice its
    // press drew in this document is still its entry, and the panel's Cancel must reach it); why it was refused, beside
    // the refusal alone; the entry it said, kept for the document's life (the card frame, apply-b-new-2).
    ...(shown.entering === true ? { entering: true as const } : {}),
    ...(refused && shown.refusal !== undefined ? { refusal: shown.refusal } : {}),
    ...(shown.entry === true && open ? { entrySaid: true as const } : {}) };
  await session.set({ [keyOf(tabId, frameId)]: entry });
  return entry;
}

/** v4: the frame whose wall the tab's page state shows (PageState.wall), and whose wall or choice Sign up & Autofill
 *  acts at: the tab's claim frame (claimFrameOf), else its top frame. */
export function wallFrameOf(frames: readonly FrameEntry[]): FrameEntry | null {
  return claimFrameOf(frames) ?? frames.find((frame) => frame.frameId === 0) ?? null;
}

/** v4: the wall the tab's application frame shows now (wallFrameOf), for PageState.wall; and (the v4 review, behaviour
 *  M4) on a page with no form, the choice of how to apply it shows (its frame/wall's `choice`), for PageState.choice:
 *  the side panel then offers Autofill there, a posting page included (Workday's /apply, which its parser reads as a
 *  posting). Each goes with the frame/wall that cleared it, or with its document. */
function wallOf(frames: readonly FrameEntry[], noForm: boolean): { wall?: SignInWall; choice?: true;
  waits?: WallWaits; entry?: true; entryRefused?: true; entering?: true; refusal?: EntryRefusal } {
  const frame = wallFrameOf(frames);
  return { ...(frame?.wall === undefined ? {} : { wall: frame.wall }),
    ...(noForm && frame?.choice === true ? { choice: true as const } : {}),
    // v5 p2-fill: a posting with no form whose adapter offers its own Apply: the panel's Autofill presses it.
    ...(noForm && frame?.entry === true ? { entry: true as const } : {}),
    // v5 p2-fill review (L5): its last press refused: the panel says why (jr6 apply F3a: with its reason).
    ...(noForm && frame?.entryRefused === true ? { entryRefused: true as const,
      ...(frame.refusal === undefined ? {} : { refusal: frame.refusal }) } : {}),
    // jr6 apply F3a: its press under way: the panel's Autofill shows its spinner, and its Cancel; the line P review
    // (revA-3, P-B3): beside a wall or a choice its press drew too (the wall's Sign Up & Autofill spins meanwhile).
    ...(noForm && frame?.entering === true ? { entering: true as const } : {}),
    // s2 profile (P1): a page with no form whose wall's toast stands.
    ...(noForm && frame?.waits !== undefined ? { waits: frame.waits } : {}) };
}

/** The chain an entry holds, as registerFrame takes it again (the same document's next hello keeps it). */
export function chainOf(entry: FrameEntry): FrameChain | undefined {
  if (entry.chained !== true || entry.applicationKey === undefined || entry.chainUrl === undefined) return undefined;
  return { applicationKey: entry.applicationKey, url: entry.chainUrl,
    ...(entry.chainedFrom === undefined ? {} : { parentFrameId: entry.chainedFrom }) };
}

/**
 * The snapshot build of 2026-11-06 (core-x, item 3): the frame whose adapter claims the tab's application, where the
 * agent's presses, Next and Submit, the success read and Sign-in Auto act. The tab's top frame, when it holds an
 * application and draws it itself; when it is a company's wrapper drawing it in a frame of its own (its hello's `wraps`:
 * iCIMS's iframe#icims_content_iframe), the one subframe whose hello says it claims it (`claimed`: directly below the
 * wrapper, on its origin), on the wrapper's origin and at the wrapper's application. Null when there is none, or more
 * than one (if unsure, none).
 * jr6 SHELL-B (F3a.md's open issue; the apply audit's AP-2 race, SP\jr6\audit\apply-a.md): a wrapper that reloads (iCIMS's
 * top moving to /login after Apply, with a fresh frame below it) leaves its old claimed frame registered until the
 * sweep forgets it (FRAME_PROBE_GRACE_MS); a new claimed frame that says hello before then made two, and the claim none,
 * so the gate's run never started. Of several claimed frames, the one that holds a form wins where it is the only one
 * (the old frame showed the posting, which holds none); each is still on the wrapper's origin (so of its family), at its
 * application and no chain page. Several holding a form, or none: unsure, none, as before.
 */
export function claimFrameOf(frames: readonly FrameEntry[]): FrameEntry | null {
  const top = frames.find((frame) => frame.frameId === 0) ?? null;
  if (top === null || top.applicationKey === undefined) return null;
  if (top.wraps !== true) return top;
  const claimed = frames.filter((frame) => frame.frameId !== 0 && frame.claimed === true && frame.origin === top.origin
    && frame.applicationKey === top.applicationKey && frame.chained !== true);
  if (claimed.length === 1) return claimed[0]!;
  const holding = claimed.filter((frame) => frame.hasForm); // jr6 SHELL-B
  return holding.length === 1 ? holding[0]! : null; // jr6 SHELL-B
}

/** core-x, items 3 and 7: the frames the agent may act in for the tab's application: its claim frame, and a chain
 *  subframe the claim frame framed (iCIMS's IForm frame) at the same application. */
export function agentFramesOf(frames: readonly FrameEntry[]): FrameEntry[] {
  const claim = claimFrameOf(frames);
  if (claim === null) return [];
  return [claim, ...frames.filter((frame) => frame.chained === true && frame.chainedFrom === claim.frameId
    && frame.applicationKey === claim.applicationKey)];
}

/** The site platform of a company's own page (v3 Phase 8: applicationOf's `site` application), else null. */
function siteOf(url: string): Platform | null {
  try {
    return applicationOf(new URL(url))?.platform === 'site' ? 'site' : null;
  } catch {
    return null;
  }
}

/** Every registered frame of a tab. */
export async function framesOfTab(session: StorageArea, tabId: number): Promise<FrameEntry[]> {
  return Object.values(await session.getMany(`frames:${tabId}:`)) as FrameEntry[];
}

/** Whether an address shows a posting with no form that a platform's own parser reads (v3 Phase 3b): Lever's and
 *  Ashby's overviews, as the adapter's parser and TailorIT's parseAtsUrl both read them (the lookup on load's own rule,
 *  job-cards.ts recognisedPosting), and since TailorIT's API 5 Workday's, iCIMS's, Taleo's, SuccessFactors' and
 *  Oracle's; since its API 6 (contract6) those of the new ATSs that have one, and SmartRecruiters' (Jobvite's,
 *  Rippling's, Breezy's, Pinpoint's, UltiPro's and SmartRecruiters' postings). A posting TailorIT's parseAtsUrl does
 *  not read (a platform ahead of its contract) is no card frame here: the card reads through its form frame. */
export function postingAddress(url: string, tailoritUrl?: string): boolean {
  try {
    const ref = applicationOf(new URL(url));
    // jr7 AUTO-7 (ICIMS7-11, D-6): a Jibe posting is TailorIT's by the iCIMS address the worker checked for it.
    return ref !== null && ref.page === 'posting' && parseAtsUrl(tailoritUrl ?? url) !== null;
  } catch {
    return false;
  }
}

/** Whether an address is a platform's page after submitting (the review): Lever's /thanks, Greenhouse's
 *  /confirmation, as the adapters' parsers read them. */
export function confirmationAddress(url: string): boolean {
  try {
    return applicationOf(new URL(url))?.page === 'confirmation';
  } catch {
    return false;
  }
}

/** The application key of an address (a hash), when a parser reads it; else `kept` (the same document's last one). */
function applicationKeyOf(url: string, kept?: string): { applicationKey?: string } {
  try {
    const ref = applicationOf(new URL(url));
    if (ref !== null) return { applicationKey: ref.applicationKey };
  } catch {
    // Not an address: the key the document had stands.
  }
  return kept === undefined ? {} : { applicationKey: kept };
}

/** The frame a tab's job card reads through (v3 Phase 3b): its form frame, else its top frame on a recognised posting
 *  page with no form, else (the review) its top frame on the platform's page after submitting, else (jr6 apply F3a,
 *  apply-b-new-2) its top frame with no form whose document said its adapter offers the site's own Apply (ADP's job
 *  details, at an application address). */
export function cardFrameOf(frames: readonly FrameEntry[]): FrameEntry | null {
  return formFrameOf(frames) ?? frames.find((frame) => frame.frameId === 0 && frame.posting === true)
    ?? frames.find((frame) => frame.frameId === 0 && frame.confirmation === true)
    ?? frames.find((frame) => frame.frameId === 0 && !frame.hasForm && frame.entrySaid === true
      && frame.applicationKey !== undefined) ?? null;
}

/** The frame a tab's form is in (v2): its lowest registered frame with a form, or null. */
export function formFrameOf(frames: readonly FrameEntry[]): FrameEntry | null {
  return frames.filter((frame) => frame.hasForm).sort((a, b) => a.frameId - b.frameId)[0] ?? null;
}

/** The navigation count a frame's hello gave (0: none). */
export const navOf = (frame: Pick<FrameEntry, 'nav'>): number => frame.nav ?? 0;

/**
 * What a tab's page holds (v2), from the registry alone, never an address: 'form' with the form frame's platform and a
 * key that changes when that frame shows another document, or when a single-page application moved it to another
 * address within its document (its navigation count); else 'no-form' when a frame of ours is there (a posting page),
 * else 'none'.
 */
export async function pageOfTab(session: StorageArea, tabId: number): Promise<PageState> {
  const frames = await framesOfTab(session, tabId);
  const form = formFrameOf(frames);
  if (form === null) {
    // A recognised posting page (v3 Phase 3b): its card shows, read for its document.
    const posting = cardFrameOf(frames);
    if (posting !== null) {
      const document = (posting.documentId ?? `at-${posting.registeredAt}`).slice(0, 96);
      const nav = navOf(posting);
      return { support: 'no-form', platform: posting.platform,
        ...(posting.confirmation === true ? { confirmation: true as const } : { posting: true as const }),
        formKey: `${posting.frameId}:${document}${nav === 0 ? '' : `#${nav}`}`.slice(0, 120), ...wallOf(frames, true) };
    }
    return { support: frames.length > 0 ? 'no-form' : 'none', platform: null, formKey: null, ...wallOf(frames, true) };
  }
  const document = (form.documentId ?? `at-${form.registeredAt}`).slice(0, 96);
  const nav = navOf(form);
  return { support: 'form', platform: form.platform,
    formKey: `${form.frameId}:${document}${nav === 0 ? '' : `#${nav}`}`.slice(0, 120),
    ...(frames.some((frame) => frame.hasForm && frame.letter === true) ? { letter: true } : {}), ...wallOf(frames, false) };
}

/** One registered frame, or null. */
export async function frameEntry(session: StorageArea, tabId: number, frameId: number): Promise<FrameEntry | null> {
  return ((await session.get(keyOf(tabId, frameId))) as FrameEntry | undefined) ?? null;
}

/** Forgets some frames of a tab. */
export async function forgetFrames(session: StorageArea, tabId: number, frameIds: readonly number[]): Promise<void> {
  if (frameIds.length > 0) await session.remove(frameIds.map((frameId) => keyOf(tabId, frameId)));
}

/** Forgets a closed tab's frames. */
export async function forgetTab(session: StorageArea, tabId: number): Promise<void> {
  await session.remove(Object.keys(await session.getMany(`frames:${tabId}:`)));
}

/** How long a frame in which nothing received a probe has before it is asked again, and then forgotten: its content
 *  script may be a moment from listening. */
export const FRAME_PROBE_GRACE_MS = 1000;
/** How long one probe waits for an answer. A frame that neither answers nor is refused in time is kept. */
export const FRAME_PROBE_TIMEOUT_MS = 2000;

/** Where a message reaches one registered frame's own document. */
export const frameTarget = (frame: FrameEntry) =>
  frame.documentId === null ? { frameId: frame.frameId } : { frameId: frame.frameId, documentId: frame.documentId };

export interface FrameSweepDeps {
  session: StorageArea;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  timers: Timers;
  /** Runs a task under the tab's lock, the one frame/hello registers under, so a frame that registers anew is never
   *  forgotten in its place. */
  lock<T>(tabId: number, task: () => Promise<T>): Promise<T>;
  /** Forgets a frame whose document is gone: its registry entry, and that document's report and runs (another of the
   *  frame's documents, one restored from the back/forward cache that said no hello, keeps its own). Called under the
   *  lock. */
  forget(tabId: number, frameId: number, documentId: string | null): Promise<void>;
}

/** Sweeps a tab: probes its frames (all of them, or all but `exceptFrameId`: the one that just said hello) and
 *  forgets those whose documents are gone. */
export function createFrameSweep(deps: FrameSweepDeps): (tabId: number, exceptFrameId?: number) => Promise<void> {
  /** Whether anything still receives in the frame's document. A frame that answers (an error answer included) or
   *  whose listener gave no answer is there; so is one that has not answered when the probe gives up. */
  function probe(tabId: number, frame: FrameEntry): Promise<'there' | 'gone'> {
    return new Promise((resolve) => {
      const cancel = deps.timers.after(FRAME_PROBE_TIMEOUT_MS, () => resolve('there'));
      deps.tabs.sendToFrame(tabId, { v: 1, type: 'frame/ping' }, frameTarget(frame)).then(
        () => {
          cancel();
          resolve('there');
        },
        (failure: unknown) => {
          cancel();
          resolve(failure === 'gone' ? 'gone' : 'there');
        },
      );
    });
  }

  async function goneOf(tabId: number, frames: FrameEntry[]): Promise<FrameEntry[]> {
    const answers = await Promise.all(frames.map(async (frame) => ({ frame, state: await probe(tabId, frame) })));
    return answers.filter((answer) => answer.state === 'gone').map((answer) => answer.frame);
  }

  return async (tabId, exceptFrameId) => {
    const others = (await framesOfTab(deps.session, tabId)).filter((frame) => frame.frameId !== exceptFrameId);
    const silent = await goneOf(tabId, others);
    if (silent.length === 0) return;
    await new Promise<void>((resolve) => deps.timers.after(FRAME_PROBE_GRACE_MS, resolve));
    const gone = await goneOf(tabId, silent);
    for (const frame of gone) {
      await deps.lock(tabId, async () => {
        // Only the document that was asked: a frame that has since said hello from another one stays.
        const current = await frameEntry(deps.session, tabId, frame.frameId);
        if (current === null || current.documentId !== frame.documentId) return;
        await deps.forget(tabId, frame.frameId, frame.documentId);
        log('frame.forgotten', { frameId: frame.frameId });
      });
    }
  };
}
