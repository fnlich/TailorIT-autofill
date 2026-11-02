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
 */
import { applicationOf } from '../adapters';
import { parseAtsUrl } from '../contract/tailorit';
import type { Platform } from '../core/enums';
import type { PageState } from '../messaging/schemas';
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
}

const keyOf = (tabId: number, frameId: number) => `frames:${tabId}:${frameId}`;

/** Records a frame. One key per frame, so frames of one tab registering at once never overwrite each other. */
export async function registerFrame(
  session: StorageArea,
  frame: { tabId: number; frameId: number; documentId: string | undefined; url: string; isTop: boolean; hasForm: boolean;
    nav?: number; letter?: true; keepKey?: string },
  now: number,
): Promise<FrameEntry> {
  const entry: FrameEntry = {
    tabId: frame.tabId,
    frameId: frame.frameId,
    documentId: frame.documentId ?? null,
    origin: new URL(frame.url).origin,
    platform: platformOfUrl(frame.url),
    isTop: frame.isTop,
    hasForm: frame.hasForm,
    registeredAt: now,
    ...(frame.nav === undefined || frame.nav === 0 ? {} : { nav: frame.nav }),
    ...(frame.letter === true && frame.hasForm ? { letter: true as const } : {}),
    ...(!frame.hasForm && frame.frameId === 0 && postingAddress(frame.url) ? { posting: true as const } : {}),
    ...(!frame.hasForm && frame.frameId === 0 && confirmationAddress(frame.url) ? { confirmation: true as const } : {}),
    ...applicationKeyOf(frame.url, frame.keepKey),
  };
  await session.set({ [keyOf(frame.tabId, frame.frameId)]: entry });
  return entry;
}

/** Every registered frame of a tab. */
export async function framesOfTab(session: StorageArea, tabId: number): Promise<FrameEntry[]> {
  return Object.values(await session.getMany(`frames:${tabId}:`)) as FrameEntry[];
}

/** Whether an address shows a posting with no form that a platform's own parser reads (v3 Phase 3b): Lever's and
 *  Ashby's overviews, as the adapter's parser and TailorIT's parseAtsUrl both read them (the lookup on load's own rule,
 *  job-cards.ts recognisedPosting); never Workday, which has no parser yet. */
export function postingAddress(url: string): boolean {
  try {
    const ref = applicationOf(new URL(url));
    return ref !== null && ref.page === 'posting' && ref.platform !== 'workday' && parseAtsUrl(url) !== null;
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
 *  page with no form, else (the review) its top frame on the platform's page after submitting. */
export function cardFrameOf(frames: readonly FrameEntry[]): FrameEntry | null {
  return formFrameOf(frames) ?? frames.find((frame) => frame.frameId === 0 && frame.posting === true)
    ?? frames.find((frame) => frame.frameId === 0 && frame.confirmation === true) ?? null;
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
        formKey: `${posting.frameId}:${document}${nav === 0 ? '' : `#${nav}`}`.slice(0, 120) };
    }
    return { support: frames.length > 0 ? 'no-form' : 'none', platform: null, formKey: null };
  }
  const document = (form.documentId ?? `at-${form.registeredAt}`).slice(0, 96);
  const nav = navOf(form);
  return { support: 'form', platform: form.platform,
    formKey: `${form.frameId}:${document}${nav === 0 ? '' : `#${nav}`}`.slice(0, 120),
    ...(frames.some((frame) => frame.hasForm && frame.letter === true) ? { letter: true } : {}) };
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
