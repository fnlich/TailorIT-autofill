/*
 * The report's one stylesheet, as a TS string: the side panel adopts it into its document, and the in-page panel
 * (src/content/ui/panel.tsx) into its closed shadow root, so there is no CSS file and no web-accessible resource.
 * adoptStyles applies a sheet to the root it is given (a document or a shadow root), through adoptedStyleSheets where
 * the browser can construct one, else a <style> element. It works from that root alone and never assumes the global
 * document.
 *
 * Every class starts with "tia-". The colour tokens sit on .tia-report and .tia-page, so the extension's pages (which
 * add src/ui/page/styles.ts) share them, and a page's own styles cannot reach them inside a shadow root. The status
 * colours are src/shared/palette.ts's, which the page's highlights use too.
 */
import { FILL_STATUSES } from '../../core/enums';
import { STATUS_COLOURS, STATUS_COLOURS_DARK, type StatusColour } from '../../shared/palette';

/** The status tokens, one pair per status. */
const statusTokens = (colours: Readonly<Record<(typeof FILL_STATUSES)[number], StatusColour>>, indent: string) =>
  FILL_STATUSES.map((status) =>
    `${indent}--tia-${status}: ${colours[status].fg};\n${indent}--tia-${status}-bg: ${colours[status].bg};`).join('\n');

export const REPORT_CSS = `
.tia-report, .tia-page {
  --tia-bg: #ffffff;
  --tia-fg: #1f2328;
  --tia-muted: #59636e;
  --tia-line: #d1d9e0;
  --tia-card: #f6f8fa;
  --tia-accent: #0b57d0;
  --tia-on-accent: #ffffff;
${statusTokens(STATUS_COLOURS, '  ')}
  color: var(--tia-fg);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .tia-report, .tia-page {
    --tia-bg: #0d1117;
    --tia-fg: #e6edf3;
    --tia-muted: #9198a1;
    --tia-line: #3d444d;
    --tia-card: #151b23;
    --tia-accent: #4c8df6;
    --tia-on-accent: #0d1117;
${statusTokens(STATUS_COLOURS_DARK, '    ')}
  }
}
.tia-report *, .tia-report *::before, .tia-report *::after { box-sizing: border-box; }
.tia-visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
.tia-button {
  font: inherit; font-size: 13px; line-height: 1.3; padding: 4px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--tia-line); background: var(--tia-card); color: var(--tia-fg);
}
.tia-button:hover { border-color: var(--tia-muted); }
.tia-button:focus-visible { outline: 2px solid var(--tia-accent); outline-offset: 1px; }
.tia-button:disabled { opacity: 0.55; cursor: default; }
.tia-button--primary { background: var(--tia-accent); border-color: var(--tia-accent); color: var(--tia-on-accent); }
.tia-notices { display: grid; gap: 8px; margin: 0 0 12px; }
.tia-notice { margin: 0; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--tia-line); background: var(--tia-card); }
.tia-notice--tripwire, .tia-notice--policy { border-color: var(--tia-flagged); background: var(--tia-flagged-bg); }
.tia-notice__text { margin: 0; }
.tia-notice__source { margin: 4px 0 0; font-size: 13px; color: var(--tia-muted); }
.tia-notice__actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.tia-empty { margin: 0; color: var(--tia-muted); }
.tia-frame { margin: 0 0 16px; }
.tia-frame__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0 0 4px; }
.tia-frame__name { margin: 0; font-size: 15px; }
.tia-frame__status { color: var(--tia-muted); }
.tia-frame__note { margin: 0 0 6px; color: var(--tia-muted); }
.tia-section { margin: 10px 0 0; }
.tia-section__name { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--tia-muted); overflow-wrap: anywhere; }
.tia-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.tia-row {
  padding: 8px 10px; border: 1px solid var(--tia-line); border-left-width: 4px; border-radius: 6px; background: var(--tia-bg);
}
.tia-row[data-status="verified"] { border-left-color: var(--tia-verified); }
.tia-row[data-status="filled"] { border-left-color: var(--tia-filled); }
.tia-row[data-status="skipped"] { border-left-color: var(--tia-skipped); }
.tia-row[data-status="flagged"] { border-left-color: var(--tia-flagged); }
.tia-row[data-status="blocked"] { border-left-color: var(--tia-blocked); }
.tia-row[data-draft="true"] { border-left-style: dashed; }
.tia-row__draft { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--tia-muted); }
.tia-row__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.tia-row__label { font-weight: 600; overflow-wrap: anywhere; }
.tia-run-status { margin: 0; color: var(--tia-muted); }
.tia-row__required { margin-left: 2px; color: var(--tia-blocked); }
.tia-chip { flex: none; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.tia-chip--verified { color: var(--tia-verified); background: var(--tia-verified-bg); }
.tia-chip--filled { color: var(--tia-filled); background: var(--tia-filled-bg); }
.tia-chip--skipped { color: var(--tia-skipped); background: var(--tia-skipped-bg); }
.tia-chip--flagged { color: var(--tia-flagged); background: var(--tia-flagged-bg); }
.tia-chip--blocked { color: var(--tia-blocked); background: var(--tia-blocked-bg); }
.tia-row__reason { margin: 4px 0; }
.tia-row__facts { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 0; font-size: 12px; color: var(--tia-muted); }
.tia-row__fact { display: flex; gap: 4px; }
.tia-row__fact dt { font-weight: 600; }
.tia-row__fact dd { margin: 0; }
.tia-row__actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; }
.tia-suggestions { margin: 6px 0 0; padding: 6px 8px; border-radius: 6px; background: var(--tia-card); font-size: 13px; }
.tia-suggestions__heading { margin: 0; font-weight: 600; }
.tia-suggestions__list { margin: 4px 0 0; padding-left: 20px; }
.tia-suggestions__score { color: var(--tia-muted); }
`;

const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

/** The sheets already applied to each root, so mounting twice applies nothing twice. */
const applied = new WeakMap<object, Set<string>>();

/**
 * Applies `css` once to `root`: a document, or a shadow root (anything else, such as a node not yet attached, is left
 * alone). It prefers a constructed sheet in adoptedStyleSheets, and falls back to a <style> element where the browser
 * cannot construct one.
 */
export function adoptStyles(root: Node, css: string): void {
  const isDocument = root.nodeType === DOCUMENT_NODE;
  if (!isDocument && !(root.nodeType === DOCUMENT_FRAGMENT_NODE && 'host' in root)) return;
  const done = applied.get(root) ?? new Set<string>();
  if (done.has(css)) return;
  const target = root as Document | ShadowRoot;
  const doc = isDocument ? (root as Document) : root.ownerDocument;
  if (!doc) return;
  try {
    const Sheet = doc.defaultView?.CSSStyleSheet;
    if (!Sheet) throw new Error('no-constructable-stylesheets');
    const sheet = new Sheet();
    sheet.replaceSync(css);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = css;
    if (isDocument) (doc.head ?? doc.documentElement).append(style);
    else target.append(style);
  }
  done.add(css);
  applied.set(root, done);
}

/** Applies the report's stylesheet to the root the report is mounted in. */
export function adoptReportStyles(root: Node): void {
  adoptStyles(root, REPORT_CSS);
}
