/*
 * The extension's own pages (the side panel and report page, the options page, the development capture page): their
 * layout, on top of the report's stylesheet, whose colour tokens and buttons they share. A TS string like the
 * report's, adopted into the page's document, so the pages need no CSS file either.
 */
import { adoptStyles, REPORT_CSS } from '../report/styles';

export const PAGE_CSS = `
html { color-scheme: light dark; }
body { margin: 0; }
.tia-page { min-height: 100vh; box-sizing: border-box; padding: 12px 14px 24px; background: var(--tia-bg); }
.tia-page *, .tia-page *::before, .tia-page *::after { box-sizing: border-box; }
.tia-page a { color: var(--tia-accent); }
.tia-panel__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 10px; }
.tia-panel__title { margin: 0; font-size: 18px; }
.tia-connection { margin: 2px 0 10px; font-size: 13px; color: var(--tia-muted); }
.tia-connection--problem { color: var(--tia-blocked); }
.tia-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
.tia-status { margin: 0 0 8px; font-weight: 600; }
.tia-feedback { margin: 0 0 10px; font-size: 13px; }
.tia-problem { margin: 0 0 10px; color: var(--tia-blocked); }
.tia-options { max-width: 760px; margin: 0 auto; padding: 24px 20px 48px; }
.tia-options__title { margin: 0 0 16px; font-size: 22px; }
.tia-card { margin: 0 0 16px; padding: 14px 16px; border: 1px solid var(--tia-line); border-radius: 8px; }
.tia-card__title { margin: 0 0 6px; font-size: 16px; }
.tia-card p { margin: 0 0 8px; }
.tia-help { margin: 2px 0 0; font-size: 13px; color: var(--tia-muted); }
.tia-fieldset { margin: 0; padding: 0; border: 0; }
.tia-field { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; align-items: start; margin: 10px 0 0; }
.tia-field input { margin: 3px 0 0; }
.tia-field__name { font-weight: 600; }
.tia-warning {
  margin: 6px 0 0; padding: 6px 8px; border-radius: 6px; font-size: 13px; color: var(--tia-flagged); background: var(--tia-flagged-bg);
}
.tia-disclosure { margin: 8px 0 12px; padding: 10px 12px; border-radius: 6px; background: var(--tia-card); }
.tia-disclosure__title { margin: 0 0 6px; font-size: 14px; }
.tia-disclosure p { margin: 0 0 8px; }
.tia-row-of-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 0; }
.tia-code { display: grid; gap: 4px; margin: 12px 0 0; }
.tia-code__input {
  width: 17em; padding: 4px 8px; border: 1px solid var(--tia-line); border-radius: 6px; font: inherit;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--tia-fg); background: var(--tia-bg);
}
.tia-error { color: var(--tia-blocked); }
.tia-note { font-size: 13px; }
.tia-save-note {
  position: sticky; bottom: 12px; width: fit-content; margin: 0; padding: 6px 12px; border: 1px solid var(--tia-line);
  border-radius: 6px; font-size: 13px; background: var(--tia-card);
}
.tia-capture { max-width: 640px; margin: 0 auto; padding: 24px 20px; }
`;

/** Applies the report's stylesheet and the pages' layout to an extension page's document. */
export function adoptPageStyles(doc: Document): void {
  adoptStyles(doc, REPORT_CSS);
  adoptStyles(doc, PAGE_CSS);
}
