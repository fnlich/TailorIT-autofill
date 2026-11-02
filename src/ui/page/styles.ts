/*
 * The extension's own pages (the side panel and report page, the options page, the development capture page): their
 * layout, on top of the report's stylesheet, whose tokens, brand, strips and buttons they share. A TS string like the
 * report's, adopted into the page's document, so the pages need no CSS file either. Light only, on TailorIT's canvas
 * with white cards; every colour comes from src/shared/palette.ts through the report's tokens.
 */
import { NEUTRAL } from '../../shared/palette';
import { PROFILE_CSS } from '../panel/profile-styles';
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
.tia-page a.tia-button--quiet { color: var(--tia-ink); }
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
/* v3 Phase 3 (Jobright's layout): under Autofill, Dry run, Continue and Cancel on a tinted strip, as Jobright's credits
   row sits under its button. */
.tia-toolbar { gap: 0; }
.tia-toolbar .tia-cta { position: relative; z-index: 1; }
.tia-toolbar__more {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: -10px 0 0; padding: 14px 6px 4px;
  border-radius: 0 0 var(--tia-r-row) var(--tia-r-row); background: var(--tia-brand-wash);
  box-shadow: inset 0 0 0 1px var(--tia-ring-track);
}
.tia-toolbar__more .tia-button { min-height: 30px; padding: 0 6px; }
.tia-button[data-emphasis] { border-color: var(--tia-ink); background: var(--tia-bg); color: var(--tia-ink); }

.tia-dashboard {
  display: grid; gap: 14px; margin: 0; padding: 12px 16px 14px; border: 1px solid var(--tia-line);
  border-radius: var(--tia-r-card); background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-dashboard__title { margin: 0; font: 800 17px/1.3 var(--tia-font); }
.tia-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; margin: 4px 0 0; font-size: 13px; }

/* v3 Phase 3: the gear's menu (the modes), the launcher brought back, a page Autofill does not work on, the foot. */
.tia-iconbutton {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 0;
  padding: 0; border: 0; border-radius: 999px; background: var(--tia-track); color: var(--tia-fg); cursor: pointer;
}
.tia-iconbutton:hover, .tia-iconbutton[aria-expanded="true"] { background: var(--tia-line); }
.tia-iconbutton:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-menu {
  display: grid; gap: 10px; margin: -4px 0 0; padding: 14px 16px; border: 1px solid var(--tia-line);
  border-radius: var(--tia-r-card); background: var(--tia-bg); box-shadow: var(--tia-shadow-pop);
}
.tia-menu__title { margin: 0; font: 800 15px/1.3 var(--tia-font); }
.tia-page a.tia-menu__all { display: inline-flex; align-items: center; gap: 2px; justify-self: start; font-size: 13px;
  font-weight: 600; }
.tia-modes { display: grid; gap: 12px; }
.tia-mode { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.tia-mode__name { padding: 0; font: 700 13px/1.4 var(--tia-font); }
.tia-mode__choices { display: flex; flex-wrap: wrap; gap: 6px; }
.tia-mode__choice {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--tia-control);
  border-radius: 999px; background: var(--tia-bg); font: 600 13px/1.3 var(--tia-font); cursor: pointer;
}
.tia-mode__choice:has(input:checked) { border-color: var(--tia-ink); background: var(--tia-brand-wash); color: var(--tia-ink); }
.tia-mode__choice:has(input:focus-visible) { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-mode__choice input { margin: 0; accent-color: var(--tia-ink); }
.tia-mode__help { margin: 0; }
.tia-launcher-hidden { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.tia-launcher-hidden .tia-button { margin-left: 0; }
.tia-unsupported {
  display: grid; gap: 8px; padding: 16px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-unsupported__head { display: flex; align-items: center; gap: 8px; }
.tia-unsupported__icon { color: var(--tia-tone-info-fg); }
.tia-unsupported__title { margin: 0; font: 800 16px/1.3 var(--tia-font); }
.tia-unsupported__intro { margin: 0; font-size: 13px; }
.tia-unsupported__sites { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.tia-unsupported__site {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 8px 10px; border-radius: var(--tia-r-control);
  background: var(--tia-subtle);
}
.tia-unsupported__name { font-weight: 700; }
.tia-unsupported__hosts { font-size: 12px; color: var(--tia-muted); overflow-wrap: anywhere; }
.tia-panel__foot { display: grid; justify-items: center; gap: 2px; margin-top: 4px; }
.tia-panel__foot .tia-connection { margin: 0; }

/* The job card (v2; v3 Phase 3 in Jobright's layout): the job in a white card, then Autofill, then what the fill uses in a
   second card. */
.tia-jobcol { display: grid; gap: 12px; }
.tia-docs {
  display: grid; gap: 0; padding: 4px 16px 12px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-docs > * + * { margin-top: 10px; }
.tia-docs[hidden] { display: none; }
.tia-page a.tia-docs__link, .tia-page button.tia-docs__link {
  display: flex; align-items: center; gap: 8px; margin: 0 -16px; padding: 10px 16px; color: var(--tia-fg);
  font-size: 13px; font-weight: 700; text-decoration: none;
}
/* v3 Phase 3b: "Your autofill information" opens the panel's editor, a button drawn as the link row it replaces. */
.tia-page button.tia-docs__link {
  width: calc(100% + 32px); border: 0; border-radius: 0; background: none; font-family: var(--tia-font);
  line-height: inherit; text-align: left; cursor: pointer;
}
.tia-page a.tia-docs__link:hover, .tia-page button.tia-docs__link:hover { background: var(--tia-hover); color: var(--tia-fg); }
.tia-page button.tia-docs__link:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: -2px; }
.tia-docs__label { flex: 1 1 auto; }
.tia-docs__chevron { color: var(--tia-muted); }
.tia-job__applied {
  display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  background: var(--tia-tone-success-bg); color: var(--tia-tone-success-fg); font: 700 11px/1.6 var(--tia-font);
  vertical-align: 3px; white-space: nowrap;
}
.tia-job__applied .tia-icon { display: inline-block; }
.tia-job {
  display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-job__top { display: flex; align-items: center; gap: 12px; }
.tia-job__tile {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: 40px; height: 40px;
  border-radius: var(--tia-r-control); background: var(--tia-brand-container); color: var(--tia-ink);
  font: 800 17px/1 var(--tia-font);
}
.tia-job__tile--unknown { background: var(--tia-track); color: var(--tia-muted); }
.tia-job__who { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; }
.tia-job__company {
  overflow: hidden; font: 700 14px/1.3 var(--tia-font); text-overflow: ellipsis; white-space: nowrap; color: var(--tia-fg);
}
.tia-job__via { font-size: 12px; line-height: 1.3; color: var(--tia-muted); }
.tia-job__title {
  display: -webkit-box; margin: 0; overflow: hidden; font: 800 17px/1.3 var(--tia-font); overflow-wrap: anywhere;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.tia-job__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.tia-job__chip { padding: 3px 9px; border-radius: 8px; font-size: 12px; overflow-wrap: anywhere; }
.tia-job__chip[data-tone="brand"] { color: var(--tia-ink); background: var(--tia-brand-container); }
.tia-job__chip[data-tone="warning"] { color: var(--tia-tone-warning-fg); background: var(--tia-tone-warning-bg); }
.tia-job__chip[data-tone="danger"] { color: var(--tia-tone-danger-fg); background: var(--tia-tone-danger-bg); }
.tia-job__meta { margin: -4px 0 0; font-size: 12px; color: var(--tia-muted); }
.tia-job__warning {
  display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control);
  background: var(--tia-tone-warning-bg); color: var(--tia-fg); font-size: 13px; font-weight: 600;
}
.tia-job__warning-icon { flex: none; margin-top: 1px; color: var(--tia-tone-warning-fg); }
.tia-job__help { margin: 0; font-size: 13px; color: var(--tia-muted); }
.tia-job__resume { display: grid; gap: 3px; padding-top: 10px; border-top: 1px solid var(--tia-line); }
.tia-docs > .tia-job__resume:first-child { padding-top: 8px; border-top: 0; }
.tia-job__resume-head { display: flex; align-items: flex-start; gap: 8px; }
.tia-job__doc { flex: none; margin-top: 1px; color: var(--tia-ink); }
.tia-job__resume-text { flex: 1 1 auto; min-width: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.tia-job__attaches { color: var(--tia-muted); }
.tia-job__resume-label { font-weight: 700; }
.tia-job__kind { padding: 0 7px; font-size: 11px; vertical-align: 1px; }
.tia-job__change { flex: none; margin: -4px -8px 0 0; }
.tia-job__why { margin: 0 0 0 26px; font-size: 12px; color: var(--tia-muted); }
/* Phase G: the cover letter, under the resume, laid out as it is: its name above its line. */
.tia-job__letter { display: grid; gap: 3px; padding-top: 10px; border-top: 1px solid var(--tia-line); }
.tia-job__letter-text {
  display: grid; flex: 1 1 auto; gap: 1px; min-width: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere;
}
.tia-job__letter-label { font-weight: 700; }
.tia-job__letter-line { color: var(--tia-muted); }
.tia-job__letter .tia-button .tia-icon { margin-right: 4px; vertical-align: -2px; }
.tia-job__resume-line { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 13px; }
.tia-job__actions { display: flex; }
.tia-job__actions .tia-button { flex: 1 1 auto; min-height: 36px; }
.tia-job__note { margin: 0; padding: 7px 10px; border-radius: var(--tia-r-control); background: var(--tia-subtle); font-size: 13px; }
.tia-job--slim { padding: 10px 14px; }
.tia-job__slim { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 13px; }
.tia-job__slim-icon { flex: none; margin-top: 1px; color: var(--tia-tone-info-fg); }

/* The match: a pill whose outline fills to the percentage, the number in it and its band under it; its tip on hover or
   focus (v3 Phase 3). */
.tia-ringwrap { position: relative; display: inline-flex; flex: none; }
.tia-ring { display: inline-flex; flex: none; flex-direction: column; align-items: center; gap: 3px; border-radius: 10px; }
.tia-ring:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-ring__tip {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 2; display: none; width: 220px; padding: 8px 10px;
  border-radius: var(--tia-r-control); background: var(--tia-fg); color: var(--tia-on-ink);
  font: 400 12px/1.45 var(--tia-font); box-shadow: var(--tia-shadow-pop);
}
.tia-ringwrap:hover .tia-ring__tip, .tia-ring:focus-visible + .tia-ring__tip { display: block; }
.tia-ring__pill { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 34px; }
.tia-ring__svg { position: absolute; top: 0; left: 0; overflow: visible; }
.tia-ring__track, .tia-ring__arc { fill: none; stroke-width: 3; }
.tia-ring__track { stroke: var(--tia-ring-track); }
.tia-ring__arc { stroke: var(--tia-brand); stroke-linecap: round; }
.tia-ring__value {
  position: relative; font: 800 16px/1 var(--tia-font); color: var(--tia-ink); font-variant-numeric: tabular-nums;
}
.tia-ring__pct { font-size: 11px; }
.tia-ring__caption { font: 700 10px/1 var(--tia-font); color: var(--tia-muted); }

/* The card while TailorIT is asked: grey blocks that breathe, none with reduced motion. */
.tia-skeleton { display: block; border-radius: 6px; background: var(--tia-track); animation: tia-breathe 1.1s ease-in-out infinite alternate; }
.tia-skeleton--line { width: 60%; height: 12px; }
.tia-skeleton--short { width: 34%; height: 10px; margin-top: 4px; }
.tia-skeleton--title { width: 82%; height: 18px; }
.tia-skeleton--chips { width: 56%; height: 20px; border-radius: 8px; }
@keyframes tia-breathe { to { background: var(--tia-line); } }

/* Change: the account's resumes to choose from. */
.tia-picker { display: grid; gap: 6px; margin: 6px 0 0; padding: 10px; border-radius: var(--tia-r-control); background: var(--tia-subtle); }
.tia-picker__heading { margin: 0; font: 700 13px/1.4 var(--tia-font); }
.tia-picker__note { margin: 0; font-size: 13px; color: var(--tia-muted); }
.tia-picker__list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.tia-picker__item {
  display: grid; gap: 1px; width: 100%; padding: 8px 10px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-control);
  background: var(--tia-bg); color: var(--tia-fg); font: inherit; text-align: left; cursor: pointer;
}
.tia-picker__item:hover { border-color: var(--tia-control-hover); }
.tia-picker__item[aria-pressed="true"] { border-color: var(--tia-ink); background: var(--tia-brand-wash); }
.tia-picker__item:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-picker__label { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.tia-picker__meta { font-size: 12px; color: var(--tia-muted); }
.tia-picker__actions { display: flex; justify-content: flex-end; gap: 4px; }

/* Ask a custom question: a fold under the buttons. */
.tia-ask {
  border: 1px solid var(--tia-line); border-radius: var(--tia-r-card); background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
.tia-ask__summary {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px; font: 700 14px/1.3 var(--tia-font); cursor: pointer;
  list-style: none;
}
.tia-ask__summary::-webkit-details-marker { display: none; }
.tia-ask__summary:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: -2px; border-radius: var(--tia-r-card); }
.tia-ask__icon { flex: none; color: var(--tia-ink); }
.tia-ask__heading { flex: 1 1 auto; }
/* One chevron at a time: down while folded, up while open. */
.tia-ask .tia-chevron--up, .tia-ask[open] .tia-chevron--down { display: none; }
.tia-ask[open] .tia-chevron--up { display: block; }
.tia-ask__body { display: grid; gap: 8px; padding: 0 16px 16px; }
.tia-ask__policy {
  margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control); background: var(--tia-tone-warning-bg); font-size: 13px;
}
.tia-ask__why { margin: 0; font-size: 13px; color: var(--tia-muted); }
.tia-ask__label { font: 600 13px/1.4 var(--tia-font); }
.tia-ask__input {
  width: 100%; min-height: 72px; padding: 8px 10px; border: 1px solid var(--tia-input); border-radius: var(--tia-r-control);
  font: inherit; color: var(--tia-fg); background: var(--tia-bg); resize: vertical;
}
.tia-ask__input:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-ask__input:disabled { background: var(--tia-track); }
.tia-ask__lengths { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin: 0; padding: 0; border: 0; font-size: 13px; }
.tia-ask__legend { float: left; margin: 0 2px 0 0; padding: 0; font-weight: 600; }
.tia-ask__length { display: inline-flex; align-items: center; gap: 5px; }
.tia-ask__length input { margin: 0; accent-color: var(--tia-ink); }
.tia-ask__submit { display: inline-flex; align-items: center; justify-self: start; gap: 6px; min-height: 36px; padding: 0 16px; }
.tia-ask__refused { margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control); background: var(--tia-subtle); font-size: 13px; }
.tia-ask__answer {
  display: grid; gap: 8px; padding: 12px; border: 1px solid var(--tia-line); border-left: 3px solid var(--tia-brand);
  border-radius: var(--tia-r-row); background: var(--tia-bg);
}
.tia-ask__from { margin: 0; font-size: 12px; font-weight: 600; color: var(--tia-muted); }
.tia-ask__text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.tia-ask__actions { display: flex; gap: 8px; }
.tia-ask__actions .tia-button { min-height: 32px; padding: 0 14px; }
.tia-ask__copied { margin: 0; font-size: 12px; color: var(--tia-muted); }

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

/* v3 Phase 3b: "Autofill for another job", "Apply without resume" and the resume's preview, "Ask TailorIT to support this
   site"; v3 Phase 4: "Application submitted". */
.tia-linkbutton {
  justify-self: start; margin: 0; padding: 2px 0; border: 0; background: none; color: var(--tia-ink);
  font: 600 13px/1.4 var(--tia-font); text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.tia-linkbutton:hover { color: var(--tia-ink-hover); }
.tia-linkbutton:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; border-radius: 4px; }
.tia-input {
  width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid var(--tia-input); border-radius: var(--tia-r-control);
  font: inherit; color: var(--tia-fg); background: var(--tia-bg);
}
.tia-input:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-another { display: grid; gap: 8px; }
.tia-another__chosen { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font-size: 13px; }
.tia-another__box { display: grid; gap: 8px; padding: 12px; border-radius: var(--tia-r-row); background: var(--tia-track); }
.tia-another__box .tia-help { margin: 0; }
.tia-another__form { display: grid; gap: 8px; }
.tia-another__form .tia-button { justify-self: start; }
.tia-another__list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.tia-another__item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--tia-r-control);
  background: var(--tia-bg);
}
.tia-another__what { display: grid; flex: 1 1 auto; min-width: 0; }
.tia-another__title { overflow-wrap: anywhere; }
.tia-another__where { font-size: 12px; color: var(--tia-muted); overflow-wrap: anywhere; }
.tia-preview { display: grid; gap: 8px; }
.tia-preview__frame {
  width: 100%; height: 520px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-control); background: var(--tia-bg);
}
.tia-preview__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tia-job__buttons { display: flex; flex: none; gap: 4px; }
.tia-unsupported__ask { display: grid; gap: 6px; }
.tia-unsupported__ask .tia-button { justify-self: start; }
.tia-submitted {
  display: grid; gap: 6px; padding: 14px 16px; border-radius: var(--tia-r-card); background: var(--tia-tone-success-bg);
}
.tia-submitted__title { display: flex; align-items: center; gap: 8px; margin: 0; font: 800 16px/1.3 var(--tia-font); }
.tia-submitted__icon { color: var(--tia-tone-success-fg); }
.tia-submitted__state { margin: 0; font-size: 13px; }
.tia-submitted__job { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.tia-submitted__actions { display: flex; flex-wrap: wrap; gap: 8px; }
/* The review: the disclosure shown again when it changed since the person connected, with I understand. */
.tia-disclosure-changed { display: grid; gap: 8px; padding: 14px 16px; border: 1px solid var(--tia-line);
  border-radius: var(--tia-r-card); background: var(--tia-tone-warning-bg); color: var(--tia-fg); }
.tia-disclosure-changed p { margin: 0; font-size: 13px; }
.tia-disclosure-changed__heading { margin: 0; font: 800 15px/1.3 var(--tia-font); }
.tia-disclosure-changed .tia-button { justify-self: start; }

@media (prefers-reduced-motion: reduce) {
  .tia-spin, .tia-skeleton { animation: none; }
}
@media (forced-colors: active) {
  .tia-cta { border: 1px solid ButtonText; }
  .tia-ring__arc { stroke: Highlight; }
  .tia-job, .tia-ask { border: 1px solid CanvasText; }
}
`;

/** Applies the report's stylesheet and the pages' layout to an extension page's document. */
export function adoptPageStyles(doc: Document): void {
  adoptStyles(doc, REPORT_CSS);
  adoptStyles(doc, PAGE_CSS);
  adoptStyles(doc, PROFILE_CSS);
}
