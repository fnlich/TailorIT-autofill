/*
 * v2.0 P9 (autofill API 8; docs/design/v2.0/09-extension-api8.md): the words the API 8 work adds, apart from
 * src/shared/copy.ts, which the content script reads (its bundle must not grow). Only the options page and the sidebar's
 * views (src/ui/page/agent.tsx, src/ui/panel/QueueView.tsx) read this file. Drafts for the owner's review.
 * TailorIT's daily auto-apply limit is said in TailorIT's own words (the claim's `dailyLimit.message`, shown as it is);
 * `limitReached` stands in only where a TailorIT sent none.
 */

/** A reset time as this browser says it ("9:00 AM"), or null when there is none. */
function timeOf(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

export const API8_COPY = {
  /** The daily limit, where TailorIT sent no words of its own. */
  limitReached: (resetsAt: number | null) => {
    const time = timeOf(resetsAt);
    return `You've reached today's auto-apply limit.${time === null ? '' : ` Auto-apply starts again at ${time}.`}`;
  },
  /** Under the limit: TailorIT's Settings › Account, in a new tab. */
  subscribe: 'Subscribe',
  /** Options › Auto-apply (A20). */
  closeTab: "Close the application tab when it's submitted",
  closeTabHelp: 'Only tabs auto-apply opened; never the ones you opened.',
} as const;
