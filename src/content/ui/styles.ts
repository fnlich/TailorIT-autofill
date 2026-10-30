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
 * and none of these reaches out. Colours: one per status, with a chip; drafts are dashed.
 */

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
.hl[data-status="verified"] { border-color: #1a7f37; }
.hl[data-status="filled"] { border-color: #0969da; }
.hl[data-status="flagged"] { border-color: #b35c00; }
.hl[data-status="blocked"] { border-color: #c62828; }
.hl[data-draft="true"] { border-style: dashed; }
.hl.focus { border-color: #4b3fd8; box-shadow: 0 0 0 4px rgba(75, 63, 216, 0.45); }
.chip { position: absolute; top: -9px; left: 4px; padding: 0 5px; border-radius: 3px; color: #ffffff;
  font: 600 10px/16px system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; pointer-events: none; }
.hl[data-status="verified"] .chip { background: #1a7f37; }
.hl[data-status="filled"] .chip { background: #0969da; }
.hl[data-status="flagged"] .chip { background: #b35c00; }
.hl[data-status="blocked"] .chip { background: #c62828; }
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
