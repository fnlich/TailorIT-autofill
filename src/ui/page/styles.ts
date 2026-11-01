/*
 * The extension's own pages (the side panel and report page, the options page, the development capture page): their
 * layout, on top of the report's stylesheet, whose tokens, brand, strips and buttons they share. A TS string like the
 * report's, adopted into the page's document, so the pages need no CSS file either. Light only, on TailorIT's canvas
 * with white cards; every colour comes from src/shared/palette.ts through the report's tokens.
 */
import { NEUTRAL } from '../../shared/palette';
import { adoptStyles, REPORT_CSS } from '../report/styles';

export const PAGE_CSS = `
html { color-scheme: light; }
body { margin: 0; background: ${NEUTRAL.canvas}; }
.tia-page { min-height: 100vh; box-sizing: border-box; background: var(--tia-canvas); }
.tia-page *, .tia-page *::before, .tia-page *::after { box-sizing: border-box; }
.tia-page a { color: var(--tia-ink); text-underline-offset: 2px; }
.tia-page a:hover { color: var(--tia-ink-hover); }
.tia-page a:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; border-radius: 4px; }
.tia-page a.tia-button { color: var(--tia-fg); text-decoration: none; }
.tia-page .tia-strip a { color: inherit; }

.tia-panel { display: flex; flex-direction: column; gap: 12px; max-width: 480px; margin: 0 auto; padding: 16px 16px 28px; }
.tia-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tia-panel__head .tia-brand { font: 600 20px/1.15 var(--tia-font); }
.tia-iconlink {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px;
  border-radius: 999px; color: var(--tia-muted); background: var(--tia-track);
}
.tia-page a.tia-iconlink { color: var(--tia-fg); }
.tia-iconlink:hover { background: var(--tia-line); }
.tia-connection { display: flex; align-items: center; gap: 8px; margin: -4px 0 0; font-size: 13px; color: var(--tia-muted); }
.tia-connection::before {
  content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--tia-tone-success-fg);
}
.tia-connection.tia-strip { display: block; margin: 0; font-weight: 600; color: var(--tia-fg); }
.tia-connection.tia-strip::before { flex: initial; }
.tia-problem { margin: 0; }

.tia-toolbar { display: grid; gap: 8px; }
.tia-cta {
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 48px; margin: 0;
  padding: 0 16px; border: 0; border-radius: var(--tia-r-row); background: var(--tia-brand); color: var(--tia-on-ink);
  font: 800 19px/1.2 var(--tia-font); letter-spacing: -0.01em; cursor: pointer;
}
.tia-cta:hover { background: var(--tia-brand-hover); }
.tia-cta:active { background: var(--tia-brand-active); }
.tia-cta:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-cta:disabled { opacity: 0.55; cursor: default; }
.tia-cta:disabled:hover { background: var(--tia-brand); }
.tia-spin { animation: tia-spin 0.8s linear infinite; }
@keyframes tia-spin { to { transform: rotate(360deg); } }
.tia-toolbar__more { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.tia-toolbar__more .tia-button { min-height: 36px; padding: 0 8px; }
.tia-button[data-emphasis] { border-color: var(--tia-ink); background: var(--tia-brand-wash); color: var(--tia-ink); }

.tia-dashboard {
  display: grid; gap: 14px; margin: 4px 0 0; padding: 16px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-dashboard__title { margin: 0; font: 800 17px/1.3 var(--tia-font); }
.tia-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; margin: 4px 0 0; font-size: 13px; }

.tia-options { max-width: 760px; margin: 0 auto; padding: 28px 20px 48px; }
.tia-options__head { display: flex; align-items: center; gap: 12px; margin: 0 0 20px; }
.tia-options__title { margin: 0; font: 600 24px/1.2 var(--tia-font); color: var(--tia-fg); }
.tia-card {
  margin: 0 0 16px; padding: 20px 22px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-card__title { margin: 0 0 8px; font: 800 16px/1.3 var(--tia-font); }
.tia-card p { margin: 0 0 8px; }
.tia-help { margin: 2px 0 0; font-size: 13px; color: var(--tia-muted); }
.tia-fieldset { margin: 0; padding: 0; border: 0; }
.tia-field { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; align-items: start; margin: 12px 0 0; }
.tia-field input { width: 16px; height: 16px; margin: 3px 0 0; accent-color: var(--tia-ink); }
.tia-field__name { font-weight: 600; }
.tia-warning {
  margin: 8px 0 0; padding: 8px 12px; border-radius: var(--tia-r-control); font-size: 13px;
  color: var(--tia-tone-warning-fg); background: var(--tia-tone-warning-bg);
}
.tia-disclosure {
  margin: 8px 0 14px; padding: 14px 16px; border: 1px solid var(--tia-ring-track); border-radius: var(--tia-r-row);
  background: var(--tia-brand-wash);
}
.tia-disclosure__title { margin: 0 0 6px; font: 700 14px/1.4 var(--tia-font); }
.tia-disclosure p { margin: 0 0 8px; }
.tia-row-of-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 0; }
.tia-row-of-buttons .tia-button { min-height: 36px; padding: 0 16px; }
.tia-code { display: grid; gap: 4px; margin: 14px 0 0; }
.tia-code__input {
  width: 17em; height: 36px; padding: 0 10px; border: 1px solid var(--tia-input); border-radius: var(--tia-r-control);
  font: inherit; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--tia-fg); background: var(--tia-bg);
}
.tia-code__input:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-error { color: var(--tia-tone-danger-fg); }
.tia-note { font-size: 13px; }
.tia-save-note {
  position: sticky; bottom: 12px; width: fit-content; margin: 0; padding: 8px 14px; border-radius: var(--tia-r-control);
  font-size: 13px; color: var(--tia-on-ink); background: var(--tia-fg); box-shadow: var(--tia-shadow-card);
}
.tia-capture { max-width: 640px; margin: 0 auto; padding: 24px 20px; }
.tia-list { margin: 4px 0 6px; padding-left: 20px; font-size: 13px; color: var(--tia-muted); }
.tia-table-wrap { max-width: 100%; overflow-x: auto; margin: 10px 0 0; }
.tia-table { border-collapse: collapse; font-size: 13px; }
.tia-table caption { text-align: left; font-weight: 600; margin: 0 0 4px; }
.tia-table th, .tia-table td { padding: 4px 12px 4px 0; border-bottom: 1px solid var(--tia-line); text-align: left; }
.tia-table__count { text-align: right; font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .tia-spin { animation: none; }
}
@media (forced-colors: active) {
  .tia-cta { border: 1px solid ButtonText; }
}
`;

/** Applies the report's stylesheet and the pages' layout to an extension page's document. */
export function adoptPageStyles(doc: Document): void {
  adoptStyles(doc, REPORT_CSS);
  adoptStyles(doc, PAGE_CSS);
}
