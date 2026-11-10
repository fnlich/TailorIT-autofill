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

/* v1.5 QX (PLAN decision 9): the tab bar under the head (Simplify's pill tabs, in TailorIT's teal), and the Queue tab. */
.tia-panel[data-view="main"] > .tia-tabs { flex: none; }
.tia-tabs { display: flex; gap: 4px; margin: -2px 0 0; padding: 4px; border-radius: 12px; background: var(--tia-track); }
.tia-tabs__tab {
  display: inline-flex; flex: 1 1 0; align-items: center; justify-content: center; gap: 6px; min-height: 36px; margin: 0;
  padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--tia-muted);
  font: 600 14px/1.2 var(--tia-font); cursor: pointer;
}
.tia-tabs__tab:hover { color: var(--tia-fg); }
.tia-tabs__tab[aria-selected="true"] {
  background: var(--tia-bg); color: var(--tia-ink); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08), 0 0 0 1px var(--tia-line);
}
.tia-tabs__tab:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-tabs__icon { flex: none; }
.tia-queue { display: grid; gap: 12px; }
.tia-queue__card {
  display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-queue__head { display: flex; align-items: center; gap: 4px; }
.tia-queue__title { margin: 0; font: 800 16px/1.3 var(--tia-font); color: var(--tia-fg); }
.tia-queue__progress { display: flex; align-items: center; gap: 10px; }
.tia-progressbar {
  position: relative; flex: 1 1 auto; height: 8px; overflow: hidden; border-radius: 999px; background: var(--tia-ring-track);
}
.tia-progressbar__fill {
  position: absolute; top: 0; bottom: 0; left: 0; border-radius: inherit; background: var(--tia-brand);
  transition: width 0.3s ease-out;
}
.tia-queue__count { flex: none; font: 700 13px/1.2 var(--tia-font); color: var(--tia-fg); font-variant-numeric: tabular-nums; }
.tia-queue__line { margin: 0; font: 600 14px/1.45 var(--tia-font); color: var(--tia-fg); font-variant-numeric: tabular-nums; }
.tia-queue__counts { margin: -4px 0 0; font-size: 12px; line-height: 1.4; color: var(--tia-muted); }
.tia-queue__controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.tia-queue__control {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; margin: 0; padding: 0 12px;
  border: 1px solid var(--tia-control); border-radius: var(--tia-r-control); background: var(--tia-bg); color: var(--tia-fg);
  font: 700 14px/1.2 var(--tia-font); cursor: pointer; box-shadow: var(--tia-shadow-control);
}
.tia-queue__control:hover { border-color: var(--tia-control-hover); background: var(--tia-hover); }
.tia-queue__control--start { border-color: var(--tia-ink); background: var(--tia-ink); color: var(--tia-on-ink); box-shadow: none; }
.tia-queue__control--start:hover { border-color: var(--tia-ink-hover); background: var(--tia-ink-hover); }
.tia-queue__control--stop { border-color: var(--tia-tone-danger-line); color: var(--tia-tone-danger-fg); }
.tia-queue__control--stop:hover { border-color: var(--tia-tone-danger-fg); background: var(--tia-tone-danger-bg); }
.tia-queue__control:disabled { opacity: 0.5; cursor: default; }
.tia-queue__control:disabled:hover { border-color: var(--tia-control); background: var(--tia-bg); }
.tia-queue__control--start:disabled:hover { border-color: var(--tia-ink); background: var(--tia-ink); }
.tia-queue__control:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-queue__note {
  margin: 0; padding: 8px 10px; border-radius: var(--tia-r-control); background: var(--tia-subtle); color: var(--tia-fg);
  font: 400 12px/1.45 var(--tia-font);
}
.tia-queue__note[data-tone="warning"] { background: var(--tia-tone-warning-bg); color: var(--tia-tone-warning-fg); }
.tia-queue__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.tia-queue__row { margin: 0; }
.tia-queue__item {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; margin: 0; padding: 8px 12px;
  border: 1px solid var(--tia-line); border-radius: var(--tia-r-control); background: var(--tia-bg); color: var(--tia-fg);
  font: inherit; text-align: left;
}
button.tia-queue__item { cursor: pointer; }
button.tia-queue__item:hover { border-color: var(--tia-control-hover); background: var(--tia-hover); }
button.tia-queue__item:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-queue__job { display: grid; flex: 1 1 auto; min-width: 0; gap: 1px; }
.tia-queue__jobtitle {
  overflow: hidden; font: 700 13px/1.35 var(--tia-font); color: var(--tia-fg); text-overflow: ellipsis; white-space: nowrap;
}
.tia-queue__company, .tia-queue__why {
  overflow: hidden; font: 400 12px/1.35 var(--tia-font); color: var(--tia-muted); text-overflow: ellipsis; white-space: nowrap;
}
.tia-queue__chip { flex: none; }
.tia-queue__chip[data-tone="neutral"] { background: var(--tia-tone-neutral-bg); color: var(--tia-tone-neutral-fg); }
.tia-queue__chip[data-tone="info"] { background: var(--tia-tone-info-bg); color: var(--tia-tone-info-fg); }
.tia-queue__chip[data-tone="brand"] { background: var(--tia-tone-brand-bg); color: var(--tia-tone-brand-fg); }
.tia-queue__chip[data-tone="warning"] { background: var(--tia-tone-warning-bg); color: var(--tia-tone-warning-fg); }
.tia-queue__chip[data-tone="success"] { background: var(--tia-tone-success-bg); color: var(--tia-tone-success-fg); }
.tia-queue__chip[data-tone="danger"] { background: var(--tia-tone-danger-bg); color: var(--tia-tone-danger-fg); }
.tia-queue__empty {
  display: grid; justify-items: start; gap: 8px; padding: 16px; border: 1px dashed var(--tia-control);
  border-radius: var(--tia-r-card); background: var(--tia-bg); font: 400 13px/1.45 var(--tia-font);
}
.tia-queue__empty p { margin: 0; }
.tia-queue__more { justify-self: center; }

@media (prefers-reduced-motion: reduce) {
  .tia-stage > .tia-sheet.tia-dashboard { transition: none; }
  .tia-progressbar__fill { transition: none; }
}
@media (forced-colors: active) {
  .tia-stage > .tia-sheet.tia-dashboard, .tia-modal__box { border: 1px solid CanvasText; }
}
`;

/** Applies the stylesheet to the root `node` is drawn in (once per root). */
export function adoptPanelV5Styles(node: Node): void {
  adoptStyles(node.getRootNode(), PANEL_V5_CSS);
}
