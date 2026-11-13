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
