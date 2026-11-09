/*
 * v5 p1-panel (PLAN decisions 4 and 6): the main view's layout around the progress sheet (Sheet.tsx) and the modals
 * over it (Modals.tsx). The components adopt it into the root they are drawn in (a document for the side panel, a
 * shadow root for the on-page sidebar: report/styles.ts adoptStyles, once per root), so the side panel's page
 * stylesheet and the sidebar's shell need nothing of it. Every colour is a report token (src/shared/palette.ts).
 *
 * Layout: the main view fills its host's height (`--tia-panel-height`, the window's by default: the side panel's page;
 * a host whose panel sits under something of its own sets it) and never grows past it. The head stays at the top; the
 * stage under it scrolls its content by itself; the progress sheet lies over the stage's bottom, a strip
 * (SHEET_STRIP_PX) while folded and up to just under the job card while it is up; the step dock sits under the stage.
 * The width is the host's, 384 px in the sidebar: nothing here assumes more.
 */
import { adoptStyles } from '../report/styles';

/** The folded sheet's strip: its header and padding (Jobright's 56 px). */
export const SHEET_STRIP_PX = 56;

export const PANEL_V5_CSS = `
.tia-panel[data-view="main"] {
  position: relative; height: var(--tia-panel-height, 100vh); min-height: 0; overflow: hidden; padding-bottom: 0;
}
.tia-panel[data-view="main"] > .tia-panel__head { flex: none; }
.tia-stage { position: relative; flex: 1 1 auto; min-height: 0; margin: 0 -16px; }
.tia-stage__scroll {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; padding: 2px 16px 16px;
  overflow-y: auto; overscroll-behavior: contain;
}
.tia-stage[data-sheet] > .tia-stage__scroll { padding-bottom: ${SHEET_STRIP_PX + 16}px; }
.tia-sheet-anchor { flex: none; height: 0; margin: -6px 0; }
.tia-stage > .tia-sheet.tia-dashboard {
  position: absolute; z-index: 2; top: calc(100% - ${SHEET_STRIP_PX}px); right: 0; bottom: 0; left: 0; display: flex;
  flex-direction: column; gap: 0; margin: 0; padding: 12px 16px 0; overflow: hidden; border: 0;
  border-radius: var(--tia-r-card) var(--tia-r-card) 0 0; background: var(--tia-bg);
  box-shadow: 0 -1px 1px rgb(0 0 0 / 0.04), 0 0 10px 4px rgb(0 10 20 / 0.06);
  transition: top 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.tia-stage > .tia-sheet.tia-dashboard[data-open] { top: var(--tia-sheet-top, 0px); }
.tia-panel[data-view="main"] > .tia-dock {
  flex: none; margin: 0 -16px; padding: 8px 16px 12px; background: var(--tia-bg); box-shadow: 0 -1px 0 var(--tia-line);
}

/* The modals (Jobright's centred error and resume-check modals, in our look): over the panel, never the page. */
.tia-modal { position: absolute; z-index: 10; inset: 0; display: grid; place-items: center; padding: 16px; }
.tia-modal__scrim { position: absolute; inset: 0; background: rgb(15 23 42 / 0.32); }
.tia-modal__box {
  position: relative; display: grid; gap: 16px; width: 100%; max-width: 320px; padding: 20px;
  border-radius: var(--tia-r-card); background: var(--tia-bg); box-shadow: var(--tia-shadow-pop); color: var(--tia-fg);
}
.tia-modal__box:focus { outline: none; }
.tia-modal__text { margin: 0; font: 500 14px/1.5 var(--tia-font); }
.tia-modal__actions { display: flex; gap: 12px; }
.tia-modal__actions .tia-button { flex: 1 1 0; min-height: 40px; }
.tia-modal__more { justify-self: center; }
/* v1.5 X: the upload edit confirm's "Don't show this again". */
.tia-modal__check { display: flex; align-items: center; gap: 8px; font: 400 13px/1.4 var(--tia-font); cursor: pointer; }
.tia-modal__check input { width: 16px; height: 16px; margin: 0; }

@media (prefers-reduced-motion: reduce) {
  .tia-stage > .tia-sheet.tia-dashboard { transition: none; }
}
@media (forced-colors: active) {
  .tia-stage > .tia-sheet.tia-dashboard, .tia-modal__box { border: 1px solid CanvasText; }
}
`;

/** Applies the stylesheet to the root `node` is drawn in (once per root). */
export function adoptPanelV5Styles(node: Node): void {
  adoptStyles(node.getRootNode(), PANEL_V5_CSS);
}
