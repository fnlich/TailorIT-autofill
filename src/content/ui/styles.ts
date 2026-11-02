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
 * and none of these reaches out. Colours are TailorIT's (src/shared/palette.ts, the report's own), written in as
 * values rather than custom properties, which a page could pass in through the host: the launcher is TailorIT's teal
 * tile with its white "T" and a toned badge; notices and the policy card are white cards with a soft shadow, shaped so
 * it never covers another of our controls (palette.ts IN_PAGE_SHADOWS). Nothing is drawn over the page's fields (the
 * owner's decision of 2026-11-01): a field's status and the AI's marks are the review's. The in-page review panel's
 * frame is here too, a white card with a 20 px radius; the report inside it adds the report's own stylesheet to the
 * same root (src/content/ui/panel.tsx), whose tokens its box carries (.tia-page). Its rows scroll inside its box (a
 * flex column whose body may shrink, the box clipping what overflows): nothing of the panel is ever drawn outside the
 * box its visibility watch observes (the Phase 6 review, E1).
 *
 * IntersectionObserver v2 judges our controls (visible.ts): no transform, opacity below 1, filter, backdrop-filter or
 * will-change on the anchor, the launcher, a notice, the card, the panel, an Edit with AI button or their buttons,
 * hover included (an Edit with AI button widens by showing its label). Animations are paint-only and run on
 * descendants (the launcher's spinner is its ::after); no url() anywhere. The top frame's launcher sits in a white tab
 * at the window's right edge (v3 Phase 3, edge.ts), its close button above it and its grip under it, 8 px apart and the
 * launcher without its own shadow there, so neither it nor its badge is ever painted over them; the hide menu opens to
 * its left with a shadow too small to reach the tab.
 */
import { BRAND, FONT_STACK, IN_PAGE_SHADOWS, NEUTRAL, SHADOWS, TONES } from '../../shared/palette';

/** A notice's icon, and the launcher's badge, per tone. */
const TONE_RULES = (['warning', 'danger', 'info', 'success', 'brand'] as const).map((tone) => [
  `.notice[data-tone="${tone}"] .icon { color: ${TONES[tone].fg}; }`,
  `.badge[data-tone="${tone}"] { background: ${TONES[tone].fg}; }`,
].join('\n')).join('\n');

const WHITE = NEUTRAL.surface;

/** The stylesheet's text. */
export const UI_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.layer { position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; }
.anchor { position: absolute; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none; font: 13px/1.45 ${FONT_STACK}; color: ${NEUTRAL.fg}; }
svg.icon, svg.mark { display: block; flex: none; }
.launcher { pointer-events: auto; position: relative; box-sizing: border-box; width: 32px; height: 32px; margin: 0;
  padding: 0; border: 0; border-radius: 9px; background: ${BRAND.fill}; color: ${WHITE}; cursor: pointer;
  font: 700 14px/1 ${FONT_STACK}; text-align: center; box-shadow: ${IN_PAGE_SHADOWS.launcher}; }
.launcher:hover { box-shadow: ${IN_PAGE_SHADOWS.launcherHover}; }
.launcher:focus-visible { outline: 2px solid ${BRAND.ink}; outline-offset: 3px; }
.launcher .glyph { display: block; width: 32px; height: 32px; }
.launcher[data-state="running"] { cursor: progress; }
.launcher[data-state="running"] .glyph { visibility: hidden; }
.launcher[data-state="running"]::after { content: ""; position: absolute; top: 8px; left: 8px; width: 16px;
  height: 16px; box-sizing: border-box; border: 2px solid rgb(255 255 255 / 0.45); border-top-color: ${WHITE};
  border-radius: 50%; animation: tailorit-spin 0.8s linear infinite; }
.badge { position: absolute; top: -6px; right: -6px; display: flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; color: ${WHITE};
  background: ${TONES.warning.fg}; font: 700 10px/16px ${FONT_STACK}; font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 1.5px ${WHITE}; pointer-events: none; }
.badge svg { display: block; }
@keyframes tailorit-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .launcher[data-state="running"]::after { animation: none; } }
.edge { pointer-events: auto; position: fixed; top: 120px; right: 0; box-sizing: border-box; display: flex;
  flex-direction: column; align-items: center; gap: 8px; width: 46px; margin: 0; padding: 4px 0 6px 2px;
  border: 1px solid ${NEUTRAL.line}; border-right: 0; border-radius: 14px 0 0 14px; background: ${WHITE};
  box-shadow: ${IN_PAGE_SHADOWS.card}; font: 13px/1.45 ${FONT_STACK}; color: ${NEUTRAL.fg}; }
.edge .launcher, .edge .launcher:hover { box-shadow: none; }
button.edge__close, button.edge__grip { pointer-events: auto; display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; margin: 0; padding: 0; border: 0; background: transparent; color: ${NEUTRAL.muted};
  cursor: pointer; }
button.edge__close { width: 20px; height: 20px; border-radius: 999px; }
button.edge__close:hover, button.edge__close[aria-expanded="true"] { background: ${NEUTRAL.track}; color: ${NEUTRAL.fg}; }
button.edge__grip { width: 30px; height: 16px; border-radius: 6px; cursor: grab; touch-action: none; }
button.edge__grip:hover { background: ${NEUTRAL.track}; color: ${NEUTRAL.fg}; }
.edge[data-dragging] button.edge__grip { cursor: grabbing; background: ${NEUTRAL.track}; }
button.edge__close:focus-visible, button.edge__grip:focus-visible, button.edge__item:focus-visible {
  outline: 2px solid ${BRAND.ink}; outline-offset: 1px; }
.edge__menu { position: absolute; top: 0; right: calc(100% + 10px); box-sizing: border-box; width: 232px; margin: 0;
  padding: 6px; border: 1px solid ${NEUTRAL.line}; border-radius: 12px; background: ${WHITE};
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); text-align: left; }
.edge__menu[data-up] { top: auto; bottom: 0; }
.edge__menu[hidden], .launcher[hidden] { display: none; }
button.edge__item { pointer-events: auto; display: block; box-sizing: border-box; width: 100%; margin: 0;
  padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: ${NEUTRAL.fg};
  font: 600 13px/1.3 ${FONT_STACK}; text-align: left; cursor: pointer; }
button.edge__item:hover { background: ${NEUTRAL.track}; }
.edge__note { margin: 4px 10px 2px; font: 400 12px/1.4 ${FONT_STACK}; color: ${NEUTRAL.muted}; }
.notices { display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 320px; max-width: 90vw; }
.notice, .card { pointer-events: auto; box-sizing: border-box; margin: 0; padding: 12px; border-radius: 12px;
  background: ${WHITE}; color: ${NEUTRAL.fg}; border: 1px solid ${NEUTRAL.line};
  box-shadow: ${IN_PAGE_SHADOWS.card};
  font: 400 13px/1.45 ${FONT_STACK}; text-align: left; }
.notice { display: flex; gap: 10px; align-items: flex-start; }
.notice[data-tone="danger"] { background: ${TONES.danger.bg}; border-color: ${TONES.danger.line}; }
${TONE_RULES}
.notice p, .card p { margin: 0; }
.notice p { flex: 1 1 auto; min-width: 0; }
.card__brand { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font: 700 12px/1.2 ${FONT_STACK};
  color: ${NEUTRAL.fg}; }
.card__brand .name { white-space: nowrap; }
.card__brand .it { color: ${BRAND.ink}; }
.card__body { display: flex; gap: 10px; align-items: flex-start; }
.card__body .icon { color: ${TONES.warning.fg}; }
.card__text { flex: 1 1 auto; min-width: 0; }
.card .source { margin-top: 4px; color: ${NEUTRAL.muted}; font-size: 12px; }
.card .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
button.action, button.dismiss { pointer-events: auto; box-sizing: border-box; margin: 0; cursor: pointer;
  font: 700 13px/1.2 ${FONT_STACK}; }
button.action { height: 32px; padding: 0 14px; border: 1px solid ${BRAND.ink}; border-radius: 10px;
  background: ${BRAND.ink}; color: ${WHITE}; }
button.action:hover { border-color: ${BRAND.inkHover}; background: ${BRAND.inkHover}; }
button.action.secondary { border-color: ${NEUTRAL.control}; background: ${WHITE}; color: ${NEUTRAL.fg};
  box-shadow: ${SHADOWS.control}; }
button.action.secondary:hover { border-color: ${NEUTRAL.controlHover}; background: ${NEUTRAL.hover}; }
button.dismiss { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  margin: -3px -4px 0 0; padding: 0; border: 0; border-radius: 999px; background: transparent; color: ${NEUTRAL.muted}; }
button.dismiss:hover { background: ${NEUTRAL.track}; color: ${NEUTRAL.fg}; }
button.action:focus-visible, button.dismiss:focus-visible { outline: 2px solid ${BRAND.ink}; outline-offset: 2px; }
.ai-edits { position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; }
button.ai-edit { pointer-events: auto; position: absolute; box-sizing: border-box; display: flex; align-items: center;
  gap: 6px; height: ${24}px; min-width: ${24}px; margin: 0; padding: 0; border: 0; border-radius: 8px;
  background: ${WHITE}; color: ${BRAND.ink}; cursor: pointer; font: 700 12px/24px ${FONT_STACK}; white-space: nowrap;
  box-shadow: ${IN_PAGE_SHADOWS.launcher}; }
button.ai-edit svg.mark { width: 24px; height: 24px; }
button.ai-edit .ai-edit__label { display: none; padding: 0 8px 0 0; }
button.ai-edit:hover .ai-edit__label, button.ai-edit:focus-visible .ai-edit__label,
button.ai-edit[aria-busy="true"] .ai-edit__label { display: inline; }
button.ai-edit:hover { box-shadow: ${IN_PAGE_SHADOWS.launcherHover}; }
button.ai-edit:focus-visible { outline: 2px solid ${BRAND.ink}; outline-offset: 2px; }
button.ai-edit[aria-busy="true"] { cursor: progress; }
.notices.with-panel .notice { display: none; }
.panel { pointer-events: auto; box-sizing: border-box; display: flex; flex-direction: column; width: 380px;
  max-width: calc(100vw - 16px); max-height: 70vh; margin: 0; overflow: hidden; background: var(--tia-bg);
  color: var(--tia-fg); border: 1px solid var(--tia-line); border-radius: 20px;
  box-shadow: ${IN_PAGE_SHADOWS.panel};
  text-align: left; color-scheme: light; }
.panel__root { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.panel__head { flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px; padding: 14px 14px 12px 16px;
  border-bottom: 1px solid var(--tia-line); }
.panel__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel__title { margin: 0; font: 600 16px/1.2 var(--tia-font); }
.panel__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 16px 16px; overscroll-behavior: contain; }
.panel__loading { margin: 0; color: var(--tia-muted); }
button.panel__close { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 32px;
  height: 32px; margin: 0; padding: 0; border: 0; border-radius: 999px; background: var(--tia-track);
  color: var(--tia-fg); cursor: pointer; }
button.panel__close:hover { background: var(--tia-line); }
button.panel__close:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
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
