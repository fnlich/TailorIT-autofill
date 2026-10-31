/*
 * The in-page UI's one stylesheet (docs/design/runtime.md §10.1), as a TypeScript string: there are no CSS files, so
 * the extension has no web-accessible resources. It is applied to the closed shadow root as a constructable stylesheet
 * (adoptedStyleSheets), built with the constructor of the page's own window, because a sheet may only be adopted by a
 * root of the document it was made for. Where the realm refuses that (no constructable stylesheets, or the assignment
 * throws), a <style> element inside the shadow root carries the same text. Whether either survives a strict page CSP
 * (style-src 'none') is the e2e suite's smoke check; the host's own styles are set through the CSSOM, which a CSP's
 * style-src does not govern.
 *
 * Every rule is scoped by the shadow root, and the host resets inheritance (all: initial), so no page style reaches in
 * and none of these reaches out. Colours: one per status, with a chip, from src/shared/palette.ts (the report's own),
 * so a status reads the same on the page and in the panel; drafts are dashed. The in-page review panel's frame is here
 * too; the report inside it adds the report's own stylesheet to the same root (src/content/ui/panel.tsx). Its rows
 * scroll inside its box (a flex column whose body may shrink, the box clipping what overflows): nothing of the panel is
 * ever drawn outside the box its visibility watch observes (the Phase 6 review, E1).
 */
import { ACCENT, STATUS_COLOURS } from '../../shared/palette';

/** The statuses a highlight is drawn for (skipped fields get none). */
const HIGHLIGHTED = ['verified', 'filled', 'flagged', 'blocked'] as const;

/** One colour per status: the outline, and the chip that names it. */
const STATUS_RULES = HIGHLIGHTED.map((status) => [
  `.hl[data-status="${status}"] { border-color: ${STATUS_COLOURS[status].fg}; }`,
  `.hl[data-status="${status}"] .chip { background: ${STATUS_COLOURS[status].fg}; }`,
].join('\n')).join('\n');

/** The stylesheet's text. */
export const UI_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.layer { position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; }
.anchor { position: absolute; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; }
.launcher { pointer-events: auto; position: relative; box-sizing: border-box; width: 32px; height: 32px; margin: 0;
  padding: 0; border: 2px solid #ffffff; border-radius: 16px; background: #4b3fd8; color: #ffffff; cursor: pointer;
  font: 700 14px/28px system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); }
.launcher:focus-visible { outline: 3px solid #8c84ff; outline-offset: 2px; }
.launcher[data-state="running"] { cursor: progress; background: #6d64e8; }
.launcher[data-state="running"] .glyph { visibility: hidden; }
.launcher[data-state="running"]::after { content: ""; position: absolute; top: 5px; left: 5px; width: 14px;
  height: 14px; border: 2px solid rgba(255, 255, 255, 0.45); border-top-color: #ffffff; border-radius: 50%;
  animation: tailorit-spin 0.8s linear infinite; }
.launcher[data-state="needs-you"] { background: #b35c00; }
.launcher[data-state="review"] { background: #1a7f37; }
.launcher[data-state="error"] { background: #c62828; }
.badge { position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px;
  box-sizing: border-box; border-radius: 8px; background: #ffffff; color: #1f2328;
  font: 700 10px/16px system-ui, sans-serif; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25); }
@keyframes tailorit-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .launcher[data-state="running"]::after { animation: none; } }
.notices { display: flex; flex-direction: column; align-items: stretch; gap: 6px; width: 300px; max-width: 90vw; }
.notice, .card { pointer-events: auto; box-sizing: border-box; margin: 0; padding: 8px 10px; border-radius: 6px;
  background: #ffffff; border: 1px solid #d0d7de; border-left: 4px solid #4b3fd8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }
.notice { display: flex; gap: 8px; align-items: flex-start; }
.notice[data-code="tripwire"], .card { border-left-color: #c62828; }
.notice p, .card p { margin: 0; flex: 1 1 auto; }
.card .source { margin-top: 4px; color: #57606a; font-size: 12px; }
.card .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
button.action, button.dismiss { pointer-events: auto; margin: 0; cursor: pointer;
  font: 600 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; border-radius: 4px; }
button.action { padding: 5px 10px; border: 1px solid #4b3fd8; background: #4b3fd8; color: #ffffff; }
button.action.secondary { background: #ffffff; color: #4b3fd8; }
button.dismiss { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; border: 0; background: transparent;
  color: #57606a; font-size: 14px; line-height: 20px; }
button.dismiss::before { content: "\\00d7"; }
button.action:focus-visible, button.dismiss:focus-visible { outline: 2px solid #8c84ff; outline-offset: 1px; }
.highlights { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; }
.hl { position: absolute; box-sizing: border-box; border: 2px solid; border-radius: 4px; pointer-events: none; }
.hl.focus { border-color: ${ACCENT}; box-shadow: 0 0 0 4px rgba(75, 63, 216, 0.45); }
.chip { position: absolute; top: -9px; left: 4px; padding: 0 5px; border-radius: 3px; color: #ffffff;
  font: 600 10px/16px system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; pointer-events: none; }
${STATUS_RULES}
.hl[data-draft="true"] { border-style: dashed; }
.notices.with-panel .notice { display: none; }
.panel { pointer-events: auto; box-sizing: border-box; display: flex; flex-direction: column; width: 380px;
  max-width: calc(100vw - 16px); max-height: 70vh; margin: 0; overflow: hidden; background: var(--tia-bg);
  color: var(--tia-fg); border: 1px solid var(--tia-line); border-top: 4px solid ${ACCENT}; border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); text-align: left; }
.panel__root { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.panel__head { flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  padding: 10px 12px 8px; border-bottom: 1px solid var(--tia-line); }
.panel__title { margin: 0; font-size: 15px; font-weight: 700; }
.panel__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px 12px 12px; overscroll-behavior: contain; }
.panel__loading { margin: 0; color: var(--tia-muted); }
button.panel__close { flex: 0 0 auto; width: 24px; height: 24px; margin: 0; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: var(--tia-muted); cursor: pointer; font: 600 16px/24px system-ui, sans-serif; }
button.panel__close::before { content: "\\00d7"; }
button.panel__close:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
`;

/** How the stylesheet reached the shadow root. */
export type StyleMode = 'adopted' | 'style-element';

/** Applies `css` to a shadow root: a constructable stylesheet from the root's own window, else a <style> element. */
export function applyStyles(root: ShadowRoot, css: string = UI_CSS): StyleMode {
  const doc = root.ownerDocument;
  try {
    const view = doc.defaultView as (Window & typeof globalThis) | null;
    if (view === null || typeof view.CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in root)) {
      throw new Error('no constructable stylesheets');
    }
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    if (root.adoptedStyleSheets.length !== 1) throw new Error('the sheet was not adopted');
    return 'adopted';
  } catch {
    const style = doc.createElement('style');
    style.textContent = css;
    root.prepend(style);
    return 'style-element';
  }
}
