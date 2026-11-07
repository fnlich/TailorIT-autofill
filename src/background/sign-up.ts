/*
 * v4, "Sign up & Autofill" (the owner, 2026-11-07: "bottom: Autofill button (If new account is needed to apply the
 * application (like workday, iCIMS), `SignUp&Autofill`"; docs/_v4/run.md). The side panel's button sends panel/fill
 * {signIn: true}; for that one run in that tab the worker acts as if Sign-in mode were Auto:
 * - the tab's content settings say Sign-in Auto (index.ts contentSettingsFor), so the run, and the run of the next
 *   document a sign-in brings, sign in at the account wall (content/sign-in.ts, every guard held);
 * - signin/credential is answered for that tab as under Sign-in Auto (background/sign-in.ts), with the same refusals:
 *   the connection must hold credentials:read and the disclosure be acknowledged (or no sign-in is answered, and the
 *   page's toast says to sign in on the page), a top or claim frame alone, https, once per tab, wall and host, and the
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
 */
import type { Timers } from './timers';

/** How long a grant lasts at most: as long as Sign-in Auto's once-per-tab window. */
export const SIGN_UP_GRANT_MS = 10 * 60_000;

/** What a grant holds: Sign-in Auto for the tab (Sign up & Autofill), and whether the tab's next form is started. */
export interface Grant {
  signIn: boolean;
  fill: boolean;
}

/** Where a grant was given, or a frame asked about it (the v4 review, M1): a frame's origin, and its application key
 *  where it has one (a hash, never an address). */
export interface GrantPlace {
  origin: string;
  applicationKey?: string | undefined;
}

/** The tabs' grants. */
export interface SignUps {
  /** Grants `tabId` what `grant` says, for one run, at `place` (replacing any grant it held). A grant of nothing, or
   *  none with no place to give it for: the tab holds none. */
  grant(tabId: number, grant: Grant, place: GrantPlace | null): void;
  /** Whether `tabId` holds a live Sign up & Autofill grant (Sign-in Auto for its one run): for a frame of `origin`, or
   *  (no origin) for any frame of the tab. */
  live(tabId: number, origin?: string): boolean;
  /** Whether a form that said hello in `tabId` from `frame` (the top frame, or the claim frame or one of its chain
   *  frames: the caller checks) is to be started now, and with Sign up & Autofill: once per grant, in a frame of the
   *  grant's origin, at its application where both name one. */
  takeFill(tabId: number, frame: GrantPlace): { signIn: boolean } | null;
  /** The tab's top frame says hello for a new document on `origin`: a grant given for another origin ends. Answers
   *  whether it held Sign-in Auto (its settings then change back). */
  moved(tabId: number, origin: string): boolean;
  /** Ends `tabId`'s grant; answers whether it held Sign-in Auto (its settings then change back). */
  end(tabId: number): boolean;
}

/** What the grants need: the clock, the timers that end a grant at its time while the worker lives, and the word that
 *  a grant holding Sign-in Auto ended by time. */
export interface SignUpDeps {
  now(): number;
  timers?: Timers;
  ended?(tabId: number): void;
}

type Held = Grant & GrantPlace & { until: number; cancel(): void };

export function createSignUps(deps: SignUpDeps): SignUps {
  const { now, timers, ended } = deps;
  const grants = new Map<number, Held>();
  /** Drops `tabId`'s grant and its timer; answers what it was. */
  const drop = (tabId: number): Held | null => {
    const held = grants.get(tabId) ?? null;
    held?.cancel();
    grants.delete(tabId);
    return held;
  };
  /** A grant past its time ends here, and is told when it held Sign-in Auto. */
  const expire = (tabId: number, held: Held) => {
    if (grants.get(tabId) !== held) return;
    drop(tabId);
    if (held.signIn) ended?.(tabId);
  };
  const liveGrant = (tabId: number): Held | null => {
    const grant = grants.get(tabId);
    if (grant === undefined) return null;
    if (now() >= grant.until) {
      expire(tabId, grant);
      return null;
    }
    return grant;
  };
  return {
    grant(tabId, grant, place) {
      drop(tabId);
      if ((!grant.signIn && !grant.fill) || place === null) return;
      const held: Held = { ...grant, origin: place.origin,
        ...(place.applicationKey === undefined ? {} : { applicationKey: place.applicationKey }),
        until: now() + SIGN_UP_GRANT_MS, cancel: () => undefined };
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
      if (grant.applicationKey !== undefined && frame.applicationKey !== undefined
        && grant.applicationKey !== frame.applicationKey) return null;
      grant.fill = false;
      if (!grant.signIn) drop(tabId);
      return { signIn: grant.signIn };
    },
    moved(tabId, origin) {
      const grant = liveGrant(tabId);
      if (grant === null || grant.origin === origin) return false;
      drop(tabId);
      return grant.signIn;
    },
    end(tabId) {
      const grant = liveGrant(tabId);
      drop(tabId);
      return grant?.signIn === true;
    },
  };
}
