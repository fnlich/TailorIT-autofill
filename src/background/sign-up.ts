/*
 * v4, "Sign up & Autofill" (the owner, 2026-11-07: "bottom: Autofill button (If new account is needed to apply the
 * application (like workday, iCIMS), `SignUp&Autofill`"; docs/_v4/run.md). The side panel's button sends panel/fill
 * {signIn: true}; for that one run in that tab the worker acts as if Sign-in mode were Auto:
 * - the tab's content settings say Sign-in Auto (index.ts contentSettingsFor), so the run, and the run of the next
 *   document a sign-in brings, sign in at the account wall (content/sign-in.ts, every guard held);
 * - signin/credential is answered for that tab as under Sign-in Auto (background/sign-in.ts), with the same refusals:
 *   the connection must hold credentials:read and the disclosure be acknowledged (or no sign-in is answered, and the
 *   page's toast says to add one in TailorIT), a top or claim frame alone, https, once per tab, wall and host, and the
 *   password never kept.
 * Where Autofill (or Sign up & Autofill) reaches a page that shows a wall or a choice of how to apply but no form, the
 * first form a frame of that tab then says hello with is started once (takeFill: run/start, with {signIn} under Sign up
 * & Autofill), so the application fills as usual after the wall.
 * A grant is the tab's alone, in memory only, and ends at the first of: the tab's run coming to rest at review, done or
 * stopped (a report says so: end), SIGN_UP_GRANT_MS after it was made, a new panel/fill of the tab, the tab closing, or
 * the worker restarting. Never for a dry run.
 */

/** How long a grant lasts at most: as long as Sign-in Auto's once-per-tab window. */
export const SIGN_UP_GRANT_MS = 10 * 60_000;

/** What a grant holds: Sign-in Auto for the tab (Sign up & Autofill), and whether the tab's next form is started. */
export interface Grant {
  signIn: boolean;
  fill: boolean;
}

/** The tabs' grants. */
export interface SignUps {
  /** Grants `tabId` what `grant` says, for one run (replacing any grant it held). */
  grant(tabId: number, grant: Grant): void;
  /** Whether `tabId` holds a live Sign up & Autofill grant (Sign-in Auto for its one run). */
  live(tabId: number): boolean;
  /** Whether a form that said hello in `tabId` is to be started now, and with Sign up & Autofill: once per grant. */
  takeFill(tabId: number): { signIn: boolean } | null;
  /** Ends `tabId`'s grant; answers whether it held Sign-in Auto (its settings then change back). */
  end(tabId: number): boolean;
}

export function createSignUps(now: () => number): SignUps {
  const grants = new Map<number, Grant & { until: number }>();
  const liveGrant = (tabId: number) => {
    const grant = grants.get(tabId);
    if (grant === undefined) return null;
    if (now() >= grant.until) {
      grants.delete(tabId);
      return null;
    }
    return grant;
  };
  return {
    grant(tabId, grant) {
      if (!grant.signIn && !grant.fill) {
        grants.delete(tabId);
        return;
      }
      grants.set(tabId, { ...grant, until: now() + SIGN_UP_GRANT_MS });
    },
    live: (tabId) => liveGrant(tabId)?.signIn === true,
    takeFill(tabId) {
      const grant = liveGrant(tabId);
      if (grant === null || !grant.fill) return null;
      grant.fill = false;
      if (!grant.signIn) grants.delete(tabId);
      return { signIn: grant.signIn };
    },
    end(tabId) {
      const grant = liveGrant(tabId);
      grants.delete(tabId);
      return grant?.signIn === true;
    },
  };
}
