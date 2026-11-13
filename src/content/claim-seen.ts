/*
 * jr8 ICIMS (the owner's report of 2026-11-13, snapshot11: "auto fill is stopped during the auto-fill", the side panel
 * saying "iCIMS form, embedded in this page · Stopped"): how the run's frame check (S1, orchestrator.ts: a frame inside
 * another page fills, presses Next and presses Submit only while it is seen there) sees the frame that claims its
 * wrapper's application (chain-frame.ts claimsApplication: its parent is the tab's top frame, of its own origin, whose
 * adapter names this very frame element its application frame: iCIMS's iframe#icims_content_iframe).
 * Any other frame inside another page is seen by its launcher, drawn at its form's top-right corner, through
 * IntersectionObserver v2 (ui/visible.ts): the page around it may hide the frame, and nothing inside the frame can read
 * that page. A claim frame's page around it is its own site's wrapper of the same application, which it can read, and an
 * iCIMS portal sizes its frame to the frame's content: the form's corner is the frame's corner, wherever the person
 * scrolled, so the launcher there was hidden by what does not hide the form (measured in Chrome on
 * careers-healthedge's Candidate Profile: the portal pins its content at min-width 980px, so under the page push the
 * frame reaches under our own sidebar, which covers the corner; a scroll past the form's top, the portal's sticky
 * header and another extension's panel at the window's edge do the same), and the run stopped with the form-hidden
 * notice before it filled anything. So a claim frame is seen when its frame element shows on the wrapper's page by the
 * rules every field is read with (dom/visibility.ts isUserVisible: display, visibility, opacity, its box, off-screen,
 * clipped by an ancestor, clip-path): a wrapper that hides the frame (opacity 0, display none, a zero-height or
 * off-screen box) still stops the run, as S1 asks. Nothing here reads or sends a value.
 */
import { isUserVisible } from '../dom/visibility';

/** Whether the wrapper page shows the frame element a claim frame is drawn in; null when there is no wrapper to read
 *  (the caller then asks the launcher). */
export function claimFrameSeen(wrapper: { doc: Document; frame: Element | null } | null): boolean | null {
  if (wrapper === null || wrapper.frame === null) return null;
  try {
    return isUserVisible(wrapper.frame);
  } catch {
    return null;
  }
}

// ── jr8 ICIMS r2 (the coordinator's word on open item 1): an IForm's own frame ──
/*
 * An iCIMS IForm's form is framed a level deeper, on <co>.icims.com/forms, by the claim frame's page (the portal page
 * at /form): a chain frame on another origin, which can read neither its portal nor the wrapper around it, so its run
 * kept the launcher rule, and its launcher, at the form's top-right corner, was hidden by the same scroll or sidebar.
 * The claim frame reads both: its one forms frame (the iframe whose address is on an origin its adapter declares,
 * chain-frame.ts declaredChildOrigins) shown on its page, and itself shown on the wrapper's page (claimFrameSeen),
 * each by the fields' rules, and says it as ChainStepFacts.shown beside its step facts; the worker hands it to the leaf
 * with them (background/chain.ts, unchanged), and the leaf's frame check reads it (runtime.ts frameShown). One forms
 * frame only: with several the claim frame cannot say which is the leaf's. Booleans only.
 */

/** Whether `doc`'s page shows its one forms frame (an iframe on an origin of `origins`) and, where this frame sits in
 *  a wrapper (`wrapper`: 'top' for the top frame, which no page holds), the wrapper shows this frame; null where it
 *  cannot say (no such frame, several, or a wrapper it cannot read). */
export function formsFrameShown(doc: Document, origins: readonly string[],
  wrapper: { doc: Document; frame: Element | null } | null | 'top'): boolean | null {
  if (origins.length === 0) return null;
  const frames = Array.from(doc.querySelectorAll('iframe[src]')).filter((frame) => {
    try {
      return origins.includes(new URL(frame.getAttribute('src') ?? '', doc.baseURI).origin);
    } catch {
      return false;
    }
  });
  if (frames.length !== 1) return null;
  const outer = wrapper === 'top' ? true : claimFrameSeen(wrapper);
  if (outer === null) return null;
  try {
    return outer && isUserVisible(frames[0]!);
  } catch {
    return null;
  }
}

/** `facts` with `shown` as the content script reads it (none where it cannot say; an adapter's own never kept). */
export function withFormsShown<T extends { shown?: boolean }>(facts: T | null, shown: boolean | null): T | null {
  if (facts === null) return null;
  const { shown: _said, ...rest } = facts;
  return (shown === null ? rest : { ...rest, shown }) as T;
}
