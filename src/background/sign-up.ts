/*
 * v4, "Sign up & Autofill" (the owner, 2026-11-07: "bottom: Autofill button (If new account is needed to apply the
 * application (like workday, iCIMS), `SignUp&Autofill`"; docs/SPEC-AMENDMENTS.md §13). The side panel's button sends panel/fill
 * {signIn: true}; for that one run in that tab the worker acts as if Sign-in mode were Auto:
 * - the tab's content settings say Sign-in Auto (index.ts contentSettingsFor), so the run, and the run of the next
 *   document a sign-in brings, sign in at the account wall (content/sign-in.ts, every guard held);
 * - signin/credential is answered for that tab as under Sign-in Auto (background/sign-in.ts), with the same refusals:
 *   the disclosure acknowledged (or no sign-in is answered, and the page's toast says to sign in on the page) and, since
 *   jr6, a job-site password saved in this browser's Sign-up Information (none: the page's toast says to save one; the
 *   connection's credentials:read before), a top or claim frame alone, https, once per tab, wall and host, and the
 *   password never kept.
 * Where Autofill (or Sign up & Autofill) reaches a page that shows a wall or a choice of how to apply but no form, the
 * first form a frame of that tab then says hello with is started once (takeFill: run/start, with {signIn} under Sign up
 * & Autofill), so the application fills as usual after the wall.
 * A grant is the tab's alone, in memory only, and ends at the first of: the tab's run coming to rest at review, done or
 * stopped (a report says so: end), SIGN_UP_GRANT_MS after it was made, a new panel/fill of the tab, the tab's top frame
 * showing a document on another origin (below), the tab closing, or the worker restarting. Never for a dry run.
 *
 * The v4 review (security M1, behaviour M3): a grant is tied to the place it was given for, not to the tab alone. It
 * records the origin of the tab's application frame then (frames.ts wallFrameOf: its claim frame, else its top frame)
 * and, where that frame had one, its application key (GrantPlace). Sign-in Auto holds for a frame of that origin alone
 * (live: the content settings, and signin/credential's sender), and the next form is started only in a frame of that
 * origin, at the same application where both name one (takeFill; index.ts allows the top frame, and the claim frame
 * and its chain frames, alone). The tab's top frame saying hello for a new document on another origin ends the grant
 * (moved): another site opened in the tab is never filled or signed in to unasked. A grant that held Sign-in Auto and
 * ends by time (its timer, or a read after its time) is told (`ended`), so the tab's frames hear their settings again
 * (index.ts pushTab) and stop reading Sign-in Auto; every other end answers whether it held it, and its caller tells.
 *
 * jr6 apply F3a (the owner, 2026-11-10: "extension should also click `apply` to find and run the form"; the session's
 * jr6 APPLYPLAN §1 D2-D4, §5 F3a): the grant follows the application in the same tab and site, so one Autofill press
 * on a posting carries through the site's own Apply to its form.
 * - **The entry grant.** Autofill on a page with no form reaches the tab's application frame whatever it told
 *   (panel.ts). Where that frame shows a wall or a choice the grant is given at once, as above. Anywhere else it is
 *   **pending** (`Grant.entry`): it starts nothing until that frame says it pressed the site's Apply (entry/pressed:
 *   `pressed`, which **arms** it) within ENTRY_ARM_MS, and it ends at that frame's refusal (`refused`), the panel's
 *   Cancel (`endEntry`) or ENTRY_ARM_MS unarmed. A press is taken only from a document this grant sent run/start to
 *   (panel/fill's, a step's) on the grant's origin; index.ts checks it is the tab's application frame for that
 *   document, and rate-limits it. Never a fill grant with no key: an entry grant whose frame named no application, and
 *   whose press named none either, ends at the press.
 * - **The press's destination** (`nextKey`, C4, apply-flow-new-2): a same-origin link the frame's parsers read as an
 *   application or posting of another key (SmartRecruiters' one-click page). Within ENTRY_NEXT_MS of the latest press,
 *   takeFill and takeStep also take that key, on the grant's origin; the referrer chain is no longer needed. On a
 *   company's own page whose presses named no key (a button), the first form of the same origin within ENTRY_NEXT_MS is
 *   started, once. OQ4 (another origin) is not answered: `moved` still ends the grant; an armed one ended within
 *   ENTRY_NEXT_MS of its press leaves the tab saying refusal 'elsewhere' for ENTRY_ELSEWHERE_MS (or until the next press).
 * - **Steps** (AF-3, `takeStep`): after a press of this grant, a top or claim frame of the grant's origin and application
 *   whose document shows a wall or a choice and no form gets one run/start per document, at most ENTRY_MAX_STEPS per
 *   grant, within the grant's time, never for a document this grant already sent run/start to or started (one mark
 *   shared with takeFill: a gate that is a form root, started by takeFill, is never started again as a step). The line
 *   P review (revA-1): and only within ENTRY_NEXT_MS of the grant's latest press, step or kept re-press (`lastAt`), so a
 *   step continues the press's own chain; a page the person opens later in the tab (the job's choice, the site's
 *   account page that names no application) is theirs, though the grant's own time still runs.
 * - **Waiting** (apply-c-new-1): from an armed press until something of it is taken (a form, a step), at most
 *   ENTRY_WAITING_MS, the tab says it is entering (PageState.entering), while the frame that pressed may be gone. The
 *   line P review (P-B1): or until the frame of a document this grant reached says, after the press, that its entry is
 *   over (`settled`: a wall or a choice its press drew in place, taken by the frame or left to the person).
 * - **A press again** (apply-c-new-1): a plain Autofill at the same origin and application while an armed grant waits
 *   for its form keeps that grant (`keep`) instead of replacing it; it holds Sign-in Auto no longer.
 * Logs: closed codes, flags and counts only (grant.armed in index.ts; grant.step and grant.ended here).
 */
import { log } from '../shared/log';
import type { Timers } from './timers';

/** How long a grant lasts at most: as long as Sign-in Auto's once-per-tab window. */
export const SIGN_UP_GRANT_MS = 10 * 60_000;
/** jr6 apply F3a: how long a pending entry grant waits for its frame's press (entry/pressed): the frame's longest
 *  entry wait (content/press.ts's 20 s cap) plus 10 s. */
export const ENTRY_ARM_MS = 30_000;
/** jr6 apply F3a: how long after a press its destination keys (nextKey) and a company page's button rule hold, and how
 *  recent a press must be for its grant's end on another origin to say 'elsewhere'. The line P review (revA-1): and how
 *  long after the grant's latest press, step or kept re-press a new document's wall or choice may get a step. */
export const ENTRY_NEXT_MS = 60_000;
/** jr6 apply F3a: how long after a press the worker says the tab is entering while nothing of it was taken yet. */
export const ENTRY_WAITING_MS = 30_000;
/** jr6 apply F3a: how long the tab says refusal 'elsewhere' after an armed grant ended on another origin. */
export const ENTRY_ELSEWHERE_MS = 60_000;
/** jr6 apply F3a: the most steps (a run/start at a new document's wall or choice) one grant gives. */
export const ENTRY_MAX_STEPS = 3;
/** jr6 apply F3a: entry/pressed's limit per tab (index.ts): a frame that says it pressed more is no person's press. */
export const ENTRY_PRESSED_LIMIT = { count: 6, windowMs: 60_000 } as const;

/** What a grant holds: Sign-in Auto for the tab (Sign up & Autofill), and whether the tab's next form is started.
 *  jr6 apply F3a: `entry`, the fill waits for the frame's press of the site's own Apply (pending until entry/pressed). */
export interface Grant {
  signIn: boolean;
  fill: boolean;
  entry?: boolean;
}

/** Where a grant was given, or a frame asked about it (the v4 review, M1): a frame's origin, and its application key
 *  where it has one (a hash, never an address). */
export interface GrantPlace {
  origin: string;
  applicationKey?: string | undefined;
}

/** jr6 apply F3a: a frame's place and its document (Chrome's documentId; null where Chrome gave none). */
export interface FramePlace extends GrantPlace {
  documentId: string | null;
}

/** The tabs' grants. */
export interface SignUps {
  /** Grants `tabId` what `grant` says, for one run, at `place` (replacing any grant it held); `place.documentId` is the
   *  document panel/fill sends run/start to. A grant of nothing, or none with no place to give it for: the tab holds
   *  none. */
  grant(tabId: number, grant: Grant, place: (GrantPlace & { documentId?: string | null }) | null): void;
  /** Whether `tabId` holds a live Sign up & Autofill grant (Sign-in Auto for its one run): for a frame of `origin`, or
   *  (no origin) for any frame of the tab. */
  live(tabId: number, origin?: string): boolean;
  /** Whether a form that said hello in `tabId` from `frame` (the top frame, or the claim frame or one of its chain
   *  frames: the caller checks) is to be started now, and with Sign up & Autofill: once per grant, in a frame of the
   *  grant's origin, at its application where both name one (jr6 apply F3a: or a destination its press named, within
   *  ENTRY_NEXT_MS; never while an entry grant is pending). */
  takeFill(tabId: number, frame: GrantPlace & { documentId?: string | null }): { signIn: boolean } | null;
  /** The tab's top frame says hello for a new document on `origin`: a grant given for another origin ends. Answers
   *  whether it held Sign-in Auto (its settings then change back). */
  moved(tabId: number, origin: string): boolean;
  /** Ends `tabId`'s grant; answers whether it held Sign-in Auto (its settings then change back). */
  end(tabId: number): boolean;
  // ── jr6 apply F3a ──
  /** The tab's application frame pressed the site's own Apply (entry/pressed; index.ts checked the frame and the
   *  limit): arms the grant when `frame` is on its origin, in a document it sent run/start to, and the fill has a key
   *  (the grant's, or `nextKey`). Answers whether it was armed. */
  pressed(tabId: number, frame: FramePlace, nextKey?: string): boolean;
  /** The tab's application frame shows a wall or a choice and no form (frame/wall): whether it gets run/start now (a
   *  step), and with Sign up & Autofill. Only within ENTRY_NEXT_MS of the grant's latest press, step or kept re-press
   *  (the line P review, revA-1). */
  takeStep(tabId: number, frame: FramePlace & { hasForm: boolean }, kind: 'wall' | 'choice'): { signIn: boolean } | null;
  /** A plain Autofill at `frame` while an armed grant of the tab waits for its form there (same origin and
   *  application): the grant is kept (holding Sign-in Auto no longer), and `frame`'s document is one it sent run/start
   *  to. Answers whether it was kept; else the caller grants anew. */
  keep(tabId: number, frame: FramePlace): boolean;
  /** The tab's application frame said its entry was refused (frame/wall's entryRefused, newly): an entry grant
   *  (pending or armed) that sent run/start to that document ends. Answers whether it held Sign-in Auto. */
  refused(tabId: number, frame: FramePlace): boolean;
  /** The panel's Cancel: an entry grant (pending or armed) of the tab ends. Answers whether it held Sign-in Auto. */
  endEntry(tabId: number): boolean;
  /** Whether the tab waits for what an armed press brings (nothing taken yet, at most ENTRY_WAITING_MS after it). */
  waiting(tabId: number): boolean;
  /** The line P review (P-B1): the tab's application frame, in a document this grant sent run/start to (or started) on
   *  its origin, says after the grant's latest press that its entry is over (frame/wall without `entering`): the tab
   *  waits for that press no longer (`waiting`). Nothing else of the grant changes. Answers whether it changed that. */
  settled(tabId: number, frame: FramePlace): boolean;
  /** Whether the tab's last armed press led to another origin within ENTRY_NEXT_MS (its grant ended there): for
   *  ENTRY_ELSEWHERE_MS, or until the next grant or press. */
  elsewhere(tabId: number): boolean;
}

/** What the grants need: the clock, the timers that end a grant at its time while the worker lives, and the word that
 *  a grant holding Sign-in Auto ended by time. */
export interface SignUpDeps {
  now(): number;
  timers?: Timers;
  ended?(tabId: number): void;
  /** jr6 apply F3a: what the tab's page state reads of its grant (waiting, elsewhere) may have changed. */
  changed?(tabId: number): void;
}

/** jr6 apply F3a: the entry part of a grant. */
interface EntryHeld {
  /** Given where the frame showed no wall or choice: nothing is started before its press arms it. */
  pending: boolean;
  /** Until when a pending grant may be armed. */
  armBy: number;
  /** The latest press of this grant (absent: none yet). */
  pressedAt?: number;
  /** The line P review (revA-1): the latest press, step or kept re-press of this grant (absent: no press yet); a step
   *  is given within ENTRY_NEXT_MS of it alone. */
  lastAt?: number;
  /** The destination keys this grant's presses named (nextKey), taken within ENTRY_NEXT_MS of the latest press. */
  keys: Set<string>;
  /** The steps given (takeStep). */
  steps: number;
  /** Something of the latest press was taken (a form started, a step given): the tab no longer waits for it. */
  taken: boolean;
}

type Held = Omit<Grant, 'entry'> & GrantPlace & {
  until: number;
  cancel(): void;
  /** jr6 apply F3a: given as an entry grant (pending at first): its fill needs a key, the frame's or its press's. */
  byEntry: boolean;
  /** jr6 apply F3a: the documents this grant sent run/start to or started (presses come from these alone; a step is
   *  given to none of them). */
  documents: Set<string>;
  entry?: EntryHeld;
  /** jr6 apply F3a: the timers of its entry (the arming window, the waiting window). */
  entryTimers: Array<() => void>;
};

export function createSignUps(deps: SignUpDeps): SignUps {
  const { now, timers, ended, changed } = deps;
  const grants = new Map<number, Held>();
  /** jr6 apply F3a: until when each tab says refusal 'elsewhere', and its timer. */
  const elsewhereUntil = new Map<number, { until: number; cancel(): void }>();
  const tell = (tabId: number) => changed?.(tabId);
  /** Drops `tabId`'s grant and its timers; answers what it was. */
  const drop = (tabId: number): Held | null => {
    const held = grants.get(tabId) ?? null;
    held?.cancel();
    for (const cancel of held?.entryTimers.splice(0) ?? []) cancel();
    grants.delete(tabId);
    return held;
  };
  /** A grant past its time ends here, and is told when it held Sign-in Auto. */
  const expire = (tabId: number, held: Held) => {
    if (grants.get(tabId) !== held) return;
    drop(tabId);
    if (held.entry !== undefined) {
      log('grant.ended', { timed: true, pending: held.entry.pending });
      tell(tabId);
    }
    if (held.signIn) ended?.(tabId);
  };
  const liveGrant = (tabId: number): Held | null => {
    const grant = grants.get(tabId);
    if (grant === undefined) return null;
    // jr6 apply F3a: a pending entry grant ends ENTRY_ARM_MS after it was given, unarmed.
    if (now() >= grant.until || (grant.entry?.pending === true && now() >= grant.entry.armBy)) {
      expire(tabId, grant);
      return null;
    }
    return grant;
  };
  const clearElsewhere = (tabId: number) => {
    const held = elsewhereUntil.get(tabId);
    if (held === undefined) return;
    held.cancel();
    elsewhereUntil.delete(tabId);
    tell(tabId);
  };
  /** Whether the grant's latest press is recent enough for its destination keys (ENTRY_NEXT_MS). */
  const fresh = (held: Held): boolean => held.entry?.pressedAt !== undefined
    && now() - held.entry.pressedAt < ENTRY_NEXT_MS;
  /** Whether a frame showing `frameKey` is at the grant's application: the grant's key where both name one (the v4
   *  review, M1), or, for a grant given at a wall or a choice whose frame named no application, any (v4); jr6 apply
   *  F3a: or a key a recent press of this grant named. `strict` (a step, an entry grant): never the keyless "any". */
  const fits = (held: Held, frameKey: string | undefined, strict: boolean): boolean => {
    if (held.applicationKey !== undefined) {
      if (frameKey === undefined || frameKey === held.applicationKey) return true;
    } else if (!strict && !held.byEntry) {
      return true;
    }
    return frameKey !== undefined && fresh(held) && held.entry!.keys.has(frameKey);
  };
  /** jr6 apply F3a (apply-flow-new-2): a company's own page whose presses named no key (a button): its first form of
   *  the same origin within ENTRY_NEXT_MS of the press. */
  const buttonRule = (held: Held): boolean => held.applicationKey?.startsWith('site:') === true
    && held.entry !== undefined && held.entry.keys.size === 0 && fresh(held);
  const docOf = (documentId: string | null | undefined): string | null => documentId ?? null;
  return {
    grant(tabId, grant, place) {
      drop(tabId);
      clearElsewhere(tabId);
      if ((!grant.signIn && !grant.fill) || place === null) return;
      const document = docOf(place.documentId);
      const byEntry = grant.entry === true && grant.fill;
      const held: Held = { signIn: grant.signIn, fill: grant.fill, origin: place.origin,
        ...(place.applicationKey === undefined ? {} : { applicationKey: place.applicationKey }),
        until: now() + SIGN_UP_GRANT_MS, cancel: () => undefined, byEntry,
        documents: new Set(document === null ? [] : [document]), entryTimers: [] };
      // jr6 apply F3a: an entry grant waits for its frame's press, ENTRY_ARM_MS at most.
      if (byEntry) {
        held.entry = { pending: true, armBy: now() + ENTRY_ARM_MS, keys: new Set(), steps: 0, taken: false };
        if (timers !== undefined) {
          held.entryTimers.push(timers.after(ENTRY_ARM_MS, () => {
            if (held.entry?.pending === true) expire(tabId, held);
          }));
        }
      }
      grants.set(tabId, held);
      if (timers !== undefined) held.cancel = timers.after(SIGN_UP_GRANT_MS, () => expire(tabId, held));
    },
    live(tabId, origin) {
      const grant = liveGrant(tabId);
      return grant !== null && grant.signIn && (origin === undefined || grant.origin === origin);
    },
    takeFill(tabId, frame) {
      const grant = liveGrant(tabId);
      if (grant === null || !grant.fill || frame.origin !== grant.origin) return null;
      // jr6 apply F3a: a pending entry grant starts nothing before its press.
      if (grant.entry?.pending === true) return null;
      if (!fits(grant, frame.applicationKey, grant.byEntry) && !buttonRule(grant)) return null;
      grant.fill = false;
      const document = docOf(frame.documentId);
      if (document !== null) grant.documents.add(document);
      if (grant.entry !== undefined) grant.entry.taken = true;
      if (!grant.signIn) drop(tabId);
      if (grant.entry !== undefined) tell(tabId);
      return { signIn: grant.signIn };
    },
    moved(tabId, origin) {
      const grant = liveGrant(tabId);
      if (grant === null || grant.origin === origin) return false;
      drop(tabId);
      // jr6 apply F3a: OQ4 not answered, another origin ends it; a recent press says where it went ('elsewhere').
      if (grant.entry !== undefined) {
        if (fresh(grant)) {
          elsewhereUntil.get(tabId)?.cancel();
          elsewhereUntil.set(tabId, { until: now() + ENTRY_ELSEWHERE_MS,
            cancel: timers?.after(ENTRY_ELSEWHERE_MS, () => clearElsewhere(tabId)) ?? (() => undefined) });
        }
        log('grant.ended', { moved: true, pressed: grant.entry.pressedAt !== undefined });
        tell(tabId);
      }
      return grant.signIn;
    },
    end(tabId) {
      const grant = liveGrant(tabId);
      drop(tabId);
      clearElsewhere(tabId);
      if (grant?.entry !== undefined) tell(tabId);
      return grant?.signIn === true;
    },
    pressed(tabId, frame, nextKey) {
      const grant = liveGrant(tabId);
      const document = docOf(frame.documentId);
      if (grant === null || !grant.fill || frame.origin !== grant.origin || document === null
        || !grant.documents.has(document)) return false;
      // Never a fill grant with no key: the frame's application, or the press's destination.
      if (grant.applicationKey === undefined && nextKey === undefined) {
        if (grant.entry?.pending === true) {
          drop(tabId);
          log('grant.ended', { keyless: true, pending: true });
          if (grant.signIn) ended?.(tabId);
          tell(tabId);
        }
        return false;
      }
      for (const cancel of grant.entryTimers.splice(0)) cancel();
      const entry: EntryHeld = grant.entry ?? { pending: false, armBy: 0, keys: new Set(), steps: 0, taken: false };
      entry.pending = false;
      entry.pressedAt = now();
      entry.lastAt = entry.pressedAt;
      entry.taken = false;
      if (nextKey !== undefined) entry.keys.add(nextKey);
      grant.entry = entry;
      // The tab waits for what the press brings, ENTRY_WAITING_MS at most; the panel hears when that ends.
      if (timers !== undefined) grant.entryTimers.push(timers.after(ENTRY_WAITING_MS, () => tell(tabId)));
      elsewhereUntil.get(tabId)?.cancel();
      elsewhereUntil.delete(tabId);
      tell(tabId);
      return true;
    },
    takeStep(tabId, frame, kind) {
      const grant = liveGrant(tabId);
      const document = docOf(frame.documentId);
      const entry = grant?.entry;
      // Never without a press of this grant, never at a form, never on another origin, never twice for a document.
      if (grant === null || entry === undefined || entry.pressedAt === undefined || frame.hasForm
        || frame.origin !== grant.origin || document === null || grant.documents.has(document)) return null;
      // The line P review (revA-1): only the press's own chain, within ENTRY_NEXT_MS of its latest press, step or kept
      // re-press, a frame that names no application included; never a page the person opens later.
      if (entry.lastAt === undefined || now() - entry.lastAt >= ENTRY_NEXT_MS) return null;
      if (entry.steps >= ENTRY_MAX_STEPS || !fits(grant, frame.applicationKey, true)) return null;
      entry.steps += 1;
      entry.taken = true;
      entry.lastAt = now();
      grant.documents.add(document);
      log('grant.step', { wall: kind === 'wall', steps: entry.steps });
      tell(tabId);
      return { signIn: grant.signIn };
    },
    keep(tabId, frame) {
      const grant = liveGrant(tabId);
      const document = docOf(frame.documentId);
      if (grant === null || !grant.fill || grant.entry?.pressedAt === undefined || frame.origin !== grant.origin
        || document === null || !fits(grant, frame.applicationKey, true)) return false;
      grant.documents.add(document);
      // The line P review (revA-1): the person's press again is a fresh word: the steps' window counts from it.
      grant.entry.lastAt = now();
      // A plain Autofill is the person's latest word: Sign-in Auto ends with it.
      if (grant.signIn) {
        grant.signIn = false;
        ended?.(tabId);
      }
      return true;
    },
    refused(tabId, frame) {
      const grant = liveGrant(tabId);
      const document = docOf(frame.documentId);
      if (grant === null || grant.entry === undefined || frame.origin !== grant.origin || document === null
        || !grant.documents.has(document)) return false;
      drop(tabId);
      log('grant.ended', { refused: true, pending: grant.entry.pending });
      tell(tabId);
      return grant.signIn;
    },
    endEntry(tabId) {
      const grant = liveGrant(tabId);
      if (grant === null || grant.entry === undefined) return false;
      drop(tabId);
      log('grant.ended', { cancelled: true, pending: grant.entry.pending });
      tell(tabId);
      return grant.signIn;
    },
    waiting(tabId) {
      const entry = liveGrant(tabId)?.entry;
      return entry !== undefined && entry.pressedAt !== undefined && !entry.taken
        && now() - entry.pressedAt < ENTRY_WAITING_MS;
    },
    settled(tabId, frame) {
      const grant = liveGrant(tabId);
      const document = docOf(frame.documentId);
      const entry = grant?.entry;
      if (grant === null || entry === undefined || entry.pressedAt === undefined || entry.taken
        || frame.origin !== grant.origin || document === null || !grant.documents.has(document)) return false;
      entry.taken = true;
      tell(tabId);
      return true;
    },
    elsewhere(tabId) {
      const held = elsewhereUntil.get(tabId);
      if (held === undefined) return false;
      if (now() < held.until) return true;
      held.cancel();
      elsewhereUntil.delete(tabId);
      return false;
    },
  };
}
