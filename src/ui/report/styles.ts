/*
 * The report's one stylesheet, as a TS string: the side panel adopts it into its document, and the in-page panel
 * (src/content/ui/panel.tsx) into its closed shadow root, so there is no CSS file and no web-accessible resource.
 * adoptStyles applies a sheet to the root it is given (a document or a shadow root), through adoptedStyleSheets where
 * the browser can construct one, else a <style> element. It works from that root alone and never assumes the global
 * document.
 *
 * Every class starts with "tia-". The tokens sit on .tia-report and .tia-page, so the extension's pages (which add
 * src/ui/page/styles.ts) share them, and a page's own styles cannot reach them inside a shadow root. Every colour is
 * src/shared/palette.ts's, TailorIT's own, light only (color-scheme: light). What both panels draw lives here: the
 * brand, the strips, notices, buttons, the feedback line, the completion and the rows. The teal fills (the progress
 * bar); text that reads as the brand is its ink.
 *
 * The in-page panel's rules (src/content/ui/styles.ts) forbid transform, opacity below 1, filter and will-change on its
 * box and buttons, so a disabled button here is greyed by colour, never faded, and every animation is a descendant's.
 */
import { FILL_STATUSES } from '../../core/enums';
import { BRAND, FONT_STACK, NEUTRAL, SHADOWS, STATUS_COLOURS, TONES } from '../../shared/palette';

/** The status tokens, one pair per status. */
const STATUS_TOKENS = FILL_STATUSES.map((status) =>
  `  --tia-${status}: ${STATUS_COLOURS[status].fg};\n  --tia-${status}-bg: ${STATUS_COLOURS[status].bg};`).join('\n');

/** The tone tokens: --tia-tone-<name>-fg and -bg (and danger's -line). */
const TONE_TOKENS = Object.entries(TONES).map(([name, tone]) =>
  Object.entries(tone).map(([part, colour]) => `  --tia-tone-${name}-${part}: ${colour};`).join('\n')).join('\n');

/** Each status's own colour on what it marks: a card's edge, an icon, a chip, a tally. */
const STATUS_RULES = FILL_STATUSES.map((status) => [
  `.tia-row--card[data-status="${status}"] { border-left-color: var(--tia-${status}); }`,
  `.tia-row__icon--${status} { color: var(--tia-${status}); }`,
  `.tia-chip--${status}, .tia-tag--${status} { color: var(--tia-${status}); background: var(--tia-${status}-bg); }`,
].join('\n')).join('\n');

/** A strip's tint and dot, per tone. */
const STRIP_TONES = ([['brand', 'brand'], ['working', 'brand'], ['attention', 'warning'], ['done', 'success'],
  ['neutral', 'neutral'], ['problem', 'danger']] as const).map(([strip, tone]) =>
  `.tia-strip[data-tone="${strip}"] { background: var(--tia-tone-${tone}-bg); }\n`
  + `.tia-strip[data-tone="${strip}"]::before { background: var(--tia-tone-${tone}-fg); }`).join('\n');

/** A notice's tint and icon, per tone. */
const NOTICE_TONES = (['warning', 'danger', 'info'] as const).map((tone) =>
  `.tia-notice[data-tone="${tone}"] { background: var(--tia-tone-${tone}-bg); }\n`
  + `.tia-notice[data-tone="${tone}"] .tia-notice__icon { color: var(--tia-tone-${tone}-fg); }`).join('\n');

export const REPORT_CSS = `
.tia-report, .tia-page {
  color-scheme: light;
  --tia-font: ${FONT_STACK};
  --tia-bg: ${NEUTRAL.surface};
  --tia-canvas: ${NEUTRAL.canvas};
  --tia-fg: ${NEUTRAL.fg};
  --tia-muted: ${NEUTRAL.muted};
  --tia-line: ${NEUTRAL.line};
  --tia-control: ${NEUTRAL.control};
  --tia-control-hover: ${NEUTRAL.controlHover};
  --tia-input: ${NEUTRAL.input};
  --tia-chip: ${NEUTRAL.chip};
  --tia-subtle: ${NEUTRAL.subtle};
  --tia-track: ${NEUTRAL.track};
  --tia-hover: ${NEUTRAL.hover};
  --tia-on-ink: ${NEUTRAL.surface};
  --tia-brand: ${BRAND.fill};
  --tia-brand-hover: ${BRAND.fillHover};
  --tia-brand-active: ${BRAND.fillActive};
  --tia-ink: ${BRAND.ink};
  --tia-ink-hover: ${BRAND.inkHover};
  --tia-brand-container: ${BRAND.container};
  --tia-brand-tint: ${BRAND.tint};
  --tia-brand-wash: ${BRAND.wash};
  --tia-ring-track: ${BRAND.ringTrack};
  --tia-focus: ${BRAND.ink};
${STATUS_TOKENS}
${TONE_TOKENS}
  --tia-r-control: 10px;
  --tia-r-row: 12px;
  --tia-r-card: 16px;
  --tia-r-panel: 20px;
  --tia-shadow-control: ${SHADOWS.control};
  --tia-shadow-card: ${SHADOWS.card};
  --tia-shadow-pop: ${SHADOWS.pop};
  color: var(--tia-fg);
  font: 400 14px/1.5 var(--tia-font);
  -webkit-font-smoothing: antialiased;
}
.tia-report *, .tia-report *::before, .tia-report *::after { box-sizing: border-box; }
.tia-report { display: flex; flex-direction: column; gap: 16px; }
.tia-visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
.tia-icon { display: block; flex: none; }

.tia-brand { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--tia-fg); }
.tia-mark { display: block; flex: none; }
.tia-brand__name { white-space: nowrap; }
.tia-wordmark { font-weight: 800; letter-spacing: -0.035em; }
.tia-wordmark__it { color: var(--tia-ink); }
.tia-brand__product { font-weight: 600; letter-spacing: -0.01em; }

.tia-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; margin: 0;
  padding: 0 12px; border: 1px solid var(--tia-control); border-radius: var(--tia-r-control); background: var(--tia-bg);
  color: var(--tia-fg); font: 600 13px/1.2 var(--tia-font); text-decoration: none; cursor: pointer;
  box-shadow: var(--tia-shadow-control);
}
.tia-button:hover { border-color: var(--tia-control-hover); background: var(--tia-hover); }
.tia-button:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-button--primary { border-color: var(--tia-ink); background: var(--tia-ink); color: var(--tia-on-ink); box-shadow: none; }
.tia-button--primary:hover { border-color: var(--tia-ink-hover); background: var(--tia-ink-hover); }
.tia-button--quiet { min-height: 28px; padding: 0 8px; border-color: transparent; background: transparent; color: var(--tia-ink);
  box-shadow: none; }
.tia-button--quiet:hover { border-color: transparent; background: var(--tia-brand-wash); }
.tia-button:disabled, .tia-button:disabled:hover { border-color: var(--tia-track); background: var(--tia-track);
  color: var(--tia-muted); box-shadow: none; cursor: default; }

.tia-strip {
  position: relative; display: block; margin: 0; padding: 9px 12px 9px 28px; border-radius: var(--tia-r-row);
  font: 600 13px/1.35 var(--tia-font); color: var(--tia-fg); background: var(--tia-tone-brand-bg); overflow-wrap: anywhere;
}
.tia-strip::before {
  content: ""; position: absolute; top: 14px; left: 12px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--tia-ink);
}
${STRIP_TONES}
.tia-strip[data-tone="working"]::before { animation: tia-pulse 1.4s ease-in-out infinite; }
.tia-strip a { color: inherit; text-decoration: underline; font-weight: 700; }
.tia-strip .tia-button { min-height: 28px; margin-left: 4px; vertical-align: middle; }
@keyframes tia-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(8 117 140 / 0.35); }
  50% { box-shadow: 0 0 0 4px rgb(8 117 140 / 0); }
}

.tia-feedback {
  margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control); background: var(--tia-subtle); color: var(--tia-fg);
  font: 400 13px/1.45 var(--tia-font);
}

.tia-notices { display: grid; gap: 8px; margin: 0; }
.tia-notice {
  display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px 14px; border-radius: var(--tia-r-row);
  color: var(--tia-fg); font: 400 13px/1.45 var(--tia-font);
}
.tia-notice[data-tone="danger"] { box-shadow: inset 0 0 0 1px var(--tia-tone-danger-line); }
${NOTICE_TONES}
.tia-notice__icon { margin-top: -1px; }
.tia-notice__body { flex: 1 1 auto; min-width: 0; }
.tia-notice__text { margin: 0; }
.tia-notice__text + .tia-notice__text { margin-top: 4px; font-weight: 600; }
.tia-notice__source { margin: 4px 0 0; font-size: 12px; color: var(--tia-muted); }
.tia-notice__actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 0; }
.tia-empty { margin: 0; color: var(--tia-muted); }

.tia-completion { display: grid; gap: 8px; }
.tia-completion__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.tia-completion__label { font-weight: 700; }
.tia-completion__value { font-size: 13px; font-weight: 700; color: var(--tia-ink); font-variant-numeric: tabular-nums; }
.tia-progress { height: 10px; border-radius: 999px; background: var(--tia-track); overflow: hidden; }
.tia-progress__fill { height: 100%; min-width: 0; border-radius: 999px; background: var(--tia-brand); }
.tia-completion__needs, .tia-allclear {
  display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 600;
}
.tia-completion__needs { color: var(--tia-tone-warning-fg); }
.tia-allclear { color: var(--tia-tone-success-fg); }
.tia-completion__needs .tia-icon, .tia-allclear .tia-icon { flex: none; }
.tia-completion__ai { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--tia-ink); }
.tia-completion__ai .tia-icon { flex: none; }
.tia-completion__required { margin: 0; font-size: 13px; color: var(--tia-muted); font-variant-numeric: tabular-nums; }
.tia-tally { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.tia-tag {
  display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; background: var(--tia-chip);
  color: var(--tia-fg); font: 600 12px/1.4 var(--tia-font); font-variant-numeric: tabular-nums;
}

.tia-frame { display: grid; gap: 10px; padding-top: 14px; border-top: 1px solid var(--tia-line); }
.tia-frame__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; }
.tia-frame__name { margin: 0; font: 800 15px/1.3 var(--tia-font); color: var(--tia-fg); }
.tia-frame__status { font-size: 12px; font-weight: 600; color: var(--tia-muted); }
.tia-frame__note { margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control); background: var(--tia-subtle); font-size: 13px; }
.tia-frame__note--pause { background: var(--tia-tone-warning-bg); }
.tia-frame__note--dry-run { background: var(--tia-brand-tint); }
.tia-section { display: grid; gap: 6px; }
.tia-section__name {
  margin: 4px 0 0; font: 700 11px/1.4 var(--tia-font); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--tia-muted); overflow-wrap: anywhere;
}
.tia-rows { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }

.tia-row { margin: 0; border-radius: var(--tia-r-row); background: var(--tia-bg); }
.tia-row--card {
  margin: 2px 0; padding: 12px 12px 12px 10px; border: 1px solid var(--tia-line); border-left: 3px solid var(--tia-muted);
  box-shadow: var(--tia-shadow-control);
}
.tia-row--line { border-left: 2px solid transparent; }
.tia-row[data-draft="true"] { border-left: 2px dashed var(--tia-ink); }
.tia-row__head, .tia-row__line { display: flex; align-items: flex-start; gap: 8px; }
.tia-row__icon { margin-top: 1px; color: var(--tia-muted); }
${STATUS_RULES}
.tia-row__title { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.tia-row__label { font-weight: 600; overflow-wrap: anywhere; }
.tia-row__required { margin-left: 2px; color: var(--tia-blocked); }
.tia-row__draft {
  display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border-radius: 999px;
  background: var(--tia-brand-container); color: var(--tia-ink); font: 700 11px/1.6 var(--tia-font); white-space: nowrap;
}
.tia-row__draft .tia-icon { display: inline-block; }
.tia-row__ai {
  display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-radius: 999px;
  background: var(--tia-brand-container); color: var(--tia-ink); font: 700 11px/1.6 var(--tia-font); white-space: nowrap;
}
.tia-row__ai--guess { background: var(--tia-tone-warning-bg); color: var(--tia-tone-warning-fg); }
.tia-row__source { font-size: 12px; color: var(--tia-muted); }
.tia-chip {
  flex: none; padding: 1px 8px; border-radius: 999px; font: 600 12px/1.5 var(--tia-font); white-space: nowrap;
}
.tia-row__body { display: grid; gap: 8px; margin: 8px 0 0 26px; }
.tia-row__reason { margin: 0; font-size: 13px; }
.tia-row__facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; font-size: 12px; color: var(--tia-muted); }
.tia-row__fact { display: flex; gap: 4px; padding: 1px 8px; border-radius: 8px; background: var(--tia-subtle); }
.tia-row__fact dt { font-weight: 600; }
.tia-row__fact dd { margin: 0; }
.tia-row__actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 -8px; }
.tia-row__actions .tia-button--primary { margin-left: 8px; }
.tia-row__more { margin: 0; }
.tia-row__line {
  align-items: center; padding: 7px 8px; border-radius: var(--tia-r-control); cursor: pointer; list-style: none;
}
.tia-row__line::-webkit-details-marker { display: none; }
.tia-row__line:hover { background: var(--tia-hover); }
.tia-row__line:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: -2px; }
.tia-row__line .tia-row__icon { margin-top: 0; }
.tia-row__chevron { flex: none; color: var(--tia-muted); }
.tia-chevron--up, .tia-row__more[open] .tia-chevron--down { display: none; }
.tia-row__more[open] .tia-chevron--up { display: block; }
.tia-row--line .tia-row__body { margin: 2px 8px 10px 34px; }
.tia-suggestions { padding: 8px 10px; border-radius: var(--tia-r-control); background: var(--tia-subtle); font-size: 13px; }
.tia-suggestions__heading { margin: 0; font-weight: 600; }
.tia-suggestions__list { margin: 4px 0 0; padding-left: 20px; }
.tia-suggestions__score { color: var(--tia-muted); }

@media (prefers-reduced-motion: reduce) {
  .tia-strip[data-tone="working"]::before { animation: none; }
}
@media (forced-colors: active) {
  .tia-button { border: 1px solid ButtonText; }
  .tia-progress__fill { background: Highlight; }
}
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
