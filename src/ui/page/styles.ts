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
/* v4 ui: the main button alone (Dry run, Continue and Cancel are gone), with the "?" of Sign up & Autofill beside it. */
.tia-toolbar { display: flex; align-items: center; gap: 6px; }
.tia-toolbar .tia-cta { flex: 1 1 auto; }
.tia-cta[data-working] { cursor: progress; }

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
/* v4 ui: the modes as Jobright's radio cards (screenshot 5): a title with its "?", then one grey card per choice, the
   chosen one's ring holding a teal dot; the skip rules as boxes on the same cards. */
.tia-modes { display: grid; gap: 18px; }
.tia-mode { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
.tia-mode__head { display: flex; align-items: center; gap: 4px; margin: 0; }
.tia-mode__name { font: 700 14px/1.4 var(--tia-font); color: var(--tia-fg); }
.tia-mode__choices { display: grid; gap: 6px; }
.tia-radiocard {
  display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 10px 14px; border-radius: var(--tia-r-control);
  background: var(--tia-track); color: var(--tia-fg); font: 500 14px/1.35 var(--tia-font); cursor: pointer;
}
.tia-radiocard:hover { background: var(--tia-chip); }
.tia-radiocard:has(.tia-radiocard__input:focus-visible) { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-radiocard:has(.tia-radiocard__input:disabled) { color: var(--tia-muted); cursor: default; }
.tia-radiocard:has(.tia-radiocard__input:disabled):hover { background: var(--tia-track); }
.tia-radiocard__input {
  flex: none; width: 18px; height: 18px; margin: 0; border: 1.5px solid var(--tia-input); border-radius: 50%;
  background: var(--tia-bg); appearance: none; cursor: inherit;
}
.tia-radiocard__input:checked { border-color: var(--tia-brand); background: var(--tia-brand); box-shadow: inset 0 0 0 3.5px var(--tia-bg); }
.tia-radiocard__input:focus-visible { outline: none; }
.tia-radiocard--box .tia-radiocard__input { border: 0; border-radius: 4px; background: none; box-shadow: none; appearance: auto;
  accent-color: var(--tia-ink); }
.tia-radiocard__label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
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
.tia-unsupported__note { font-size: 12px; color: var(--tia-muted); font-style: italic; }

/* The job card (v2; v4 ui in Jobright's layout, screenshot 3): the job in a white card, the Add pill under it. */
.tia-jobcol { display: grid; gap: 12px; }
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
.tia-job__industry { overflow: hidden; font-size: 13px; line-height: 1.3; color: var(--tia-muted); text-overflow: ellipsis;
  white-space: nowrap; }
.tia-job__title {
  display: -webkit-box; margin: 0; overflow: hidden; font: 800 19px/1.3 var(--tia-font); overflow-wrap: anywhere;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.tia-job__meta { margin: -6px 0 0; font-size: 13px; color: var(--tia-fg); }
/* v4 ui: "Not this job?" under a rule at the card's foot (where Jobright puts its connections row). */
.tia-job__foot { margin: 2px -16px -4px; padding: 8px 16px 0; border-top: 1px solid var(--tia-line); }
/* v4 ui: "+ Add this job in one click", a mint pill with a sparkle on its corner (screenshot 2). */
.tia-addjob { display: flex; justify-content: center; padding: 6px 0 2px; }
.tia-addpill {
  position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 40px; margin: 0; padding: 0 20px;
  border: 0; border-radius: 999px; background: var(--tia-brand-container); color: var(--tia-fg);
  font: 700 14px/1.2 var(--tia-font); cursor: pointer;
}
.tia-addpill:hover { background: var(--tia-ring-track); }
.tia-addpill:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-addpill:disabled { cursor: progress; }
.tia-addpill__spark { position: absolute; top: -9px; right: -6px; color: var(--tia-ink); }
.tia-job__note { margin: 0; padding: 7px 10px; border-radius: var(--tia-r-control); background: var(--tia-subtle); font-size: 13px; }
.tia-job--slim { padding: 10px 14px; }
.tia-job__slim { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 13px; }
.tia-job__slim-icon { flex: none; margin-top: 1px; color: var(--tia-tone-info-fg); }

/* The match: a pill whose outline fills to the percentage, the number in it; its tip, the black bubble, on hover or
   focus (v3 Phase 3; v4 ui). */
.tia-ringwrap { position: relative; display: inline-flex; flex: none; }
.tia-ring { display: inline-flex; flex: none; flex-direction: column; align-items: center; gap: 3px; border-radius: 10px; }
.tia-ring:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-ring__tip {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 2; display: none; width: 220px; padding: 8px 10px;
  border-radius: 8px; background: var(--tia-fg); color: var(--tia-on-ink);
  font: 500 12.5px/1.45 var(--tia-font); box-shadow: var(--tia-shadow-pop);
}
.tia-ring__tip::after {
  content: ""; position: absolute; top: -5px; right: 27px; width: 10px; height: 10px; background: inherit; rotate: 45deg;
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

/* Ask a custom question (v4 ui): an outline button under Autofill that unfolds the box. */
.tia-ask { display: grid; gap: 10px; }
.tia-outline {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 44px; margin: 0;
  padding: 0 16px; border: 1.5px solid var(--tia-control); border-radius: var(--tia-r-row); background: var(--tia-bg);
  color: var(--tia-fg); font: 700 15px/1.2 var(--tia-font); cursor: pointer;
}
.tia-outline:hover, .tia-outline[aria-expanded="true"] { border-color: var(--tia-control-hover); background: var(--tia-hover); }
.tia-outline:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-ask__icon { flex: none; color: var(--tia-ink); }
.tia-ask__body[hidden] { display: none; }
.tia-ask__body {
  display: grid; gap: 8px; padding: 14px 16px 16px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-card);
  background: var(--tia-bg); box-shadow: var(--tia-shadow-card);
}
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
/* v3 Phase 5: the skip rules' boxes, the auto-apply agent's status line (the side panel's strip and the options
   page's card) and its one-time confirmation. */
.tia-agent { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.tia-agent__actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tia-agent__actions .tia-button { margin-left: 0; }
.tia-agent--options { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--tia-line); border-radius: var(--tia-r-row);
  font: 600 13px/1.35 var(--tia-font); }
.tia-agent--options a { color: var(--tia-ink); font-weight: 700; }
.tia-confirm { display: grid; gap: 8px; margin-top: 10px; padding: 14px 16px; border: 1px solid var(--tia-line);
  border-radius: var(--tia-r-card); background: var(--tia-tone-warning-bg); color: var(--tia-fg); }
.tia-confirm p { margin: 0; font-size: 13px; }

/* ── v4 ui ── */
/* The "?" (HelpTip) and its black bubble (screenshot 6): fixed where the script places it, its arrow on the "?", a
   bridge over the gap so the pointer can move onto it. */
.tia-helptip { position: relative; display: inline-flex; flex: none; vertical-align: middle; }
.tia-helptip__button {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin: 0; padding: 0;
  border: 0; border-radius: 999px; background: transparent; color: var(--tia-muted); cursor: help;
}
.tia-helptip__button:hover, .tia-helptip__button[data-open] { background: var(--tia-track); color: var(--tia-fg); }
.tia-helptip__button:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-helptip__bubble {
  position: fixed; top: 0; left: 0; z-index: 1000; width: max-content; max-width: min(260px, calc(100vw - 8px));
  padding: 8px 11px; border-radius: 8px; background: var(--tia-fg); color: var(--tia-on-ink);
  font: 500 12.5px/1.45 var(--tia-font); text-align: left; white-space: normal; overflow-wrap: anywhere;
  box-shadow: var(--tia-shadow-pop);
}
.tia-helptip__bubble[hidden] { display: none; }
.tia-helptip__bubble::after {
  content: ""; position: absolute; left: var(--tia-tip-arrow, 50%); width: 10px; height: 10px; margin-left: -5px;
  background: inherit; rotate: 45deg;
}
.tia-helptip__bubble[data-place="above"]::after { bottom: -5px; }
.tia-helptip__bubble[data-place="below"]::after { top: -5px; }
.tia-helptip__bubble::before { content: ""; position: absolute; left: 0; right: 0; height: 10px; }
.tia-helptip__bubble[data-place="above"]::before { bottom: -10px; }
.tia-helptip__bubble[data-place="below"]::before { top: -10px; }

/* The set-up view (screenshot 1): centred, a bolt, the steps as cards with a tick or a GO pill, Start applying. */
.tia-setup { display: grid; justify-items: center; gap: 10px; padding: 40px 4px 12px; text-align: center; }
.tia-setup__bolt { color: var(--tia-fg); }
.tia-setup__heading { margin: 6px 0 0; font: 700 18px/1.3 var(--tia-font); }
.tia-setup__intro { max-width: 300px; margin: 0; font-size: 14px; color: var(--tia-fg); }
.tia-setup__steps { display: grid; gap: 10px; width: 100%; margin: 14px 0 6px; padding: 0; list-style: none; text-align: left; }
.tia-step {
  display: grid; gap: 10px; padding: 10px 10px 10px 12px; border: 1px solid var(--tia-line); border-radius: 999px;
  background: var(--tia-bg); box-shadow: var(--tia-shadow-control);
}
.tia-step:has(.tia-consent), .tia-step:has(.tia-step__more) { border-radius: var(--tia-r-card); }
.tia-step__row { display: flex; align-items: center; gap: 10px; }
.tia-step__number {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px;
  border-radius: 50%; background: var(--tia-brand); color: var(--tia-fg); font: 700 13px/1 var(--tia-font);
}
.tia-step__name { flex: 1 1 auto; min-width: 0; font: 600 14px/1.3 var(--tia-font); }
.tia-step__pill {
  display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 48px; height: 32px; margin: 0;
  padding: 0 14px; border: 0; border-radius: 999px; font: 800 13px/1 var(--tia-font);
}
.tia-step__pill--done { background: var(--tia-brand); color: var(--tia-on-ink); }
.tia-step__pill--go { background: var(--tia-fg); color: var(--tia-on-ink); cursor: pointer; }
.tia-step__pill--go:hover { background: var(--tia-ink); }
.tia-step__pill--go:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-step__pill--go:disabled { background: var(--tia-track); color: var(--tia-muted); cursor: default; }
.tia-step__pill--waiting { background: var(--tia-track); color: var(--tia-fg); font-weight: 700; }
.tia-step__more { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; margin: 0 4px 4px;
  font-size: 12px; color: var(--tia-muted); }
.tia-consent { display: grid; gap: 8px; margin: 0 2px 4px; }
.tia-consent__heading { margin: 0; font: 700 14px/1.3 var(--tia-font); }
.tia-consent__text {
  max-height: 220px; overflow-y: auto; padding: 10px 12px; border-radius: var(--tia-r-control); background: var(--tia-subtle);
  font-size: 12.5px; line-height: 1.5;
}
.tia-consent__text:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-consent__text p { margin: 0 0 8px; }
.tia-consent__line { margin: 0; font-size: 13px; font-weight: 600; }
.tia-consent__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tia-setup__start { width: auto; min-width: 180px; padding: 0 28px; border-radius: 999px; }
.tia-setup__start:disabled, .tia-setup__start:disabled:hover { opacity: 1; background: var(--tia-track); color: var(--tia-muted); }

/* The Settings view (screenshot 5): ✕ and "Settings", the groups, the links, and Save pinned at the bottom. */
.tia-panel--settings { min-height: 100vh; }
.tia-settings { display: flex; flex: 1 1 auto; flex-direction: column; gap: 14px; margin: -4px -16px -28px; }
.tia-settings__head { display: flex; align-items: center; gap: 10px; padding: 0 16px 10px; border-bottom: 1px solid var(--tia-line); }
.tia-roundbutton {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: 30px; height: 30px; margin: 0;
  padding: 0; border: 0; border-radius: 50%; background: var(--tia-track); color: var(--tia-fg); cursor: pointer;
}
.tia-roundbutton:hover { background: var(--tia-line); }
.tia-roundbutton:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-settings__heading { margin: 0; font: 700 16px/1.3 var(--tia-font); }
.tia-settings__body { display: grid; flex: 1 1 auto; align-content: start; gap: 20px; padding: 4px 16px 16px; }
.tia-settings__links { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--tia-line); }
.tia-linkrow {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; margin: 0; padding: 10px 14px; border: 0;
  border-radius: var(--tia-r-control); background: var(--tia-track); color: var(--tia-fg); font: 600 14px/1.3 var(--tia-font);
  text-align: left; cursor: pointer;
}
.tia-linkrow:hover { background: var(--tia-chip); }
.tia-linkrow:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-linkrow__icon { color: var(--tia-ink); }
.tia-linkrow__label { flex: 1 1 auto; }
.tia-linkrow__chevron { color: var(--tia-muted); }
.tia-settings__links .tia-connection { margin: 4px 0 0; }
.tia-page a.tia-settings__all { display: inline-flex; align-items: center; gap: 2px; justify-self: start; font-size: 13px;
  font-weight: 600; }
.tia-settings__foot {
  position: sticky; bottom: 0; z-index: 2; display: grid; gap: 6px; padding: 12px 16px 14px; border-top: 1px solid var(--tia-line);
  background: var(--tia-bg);
}
.tia-settings__note { margin: 0; font-size: 13px; text-align: center; }
.tia-settings__save:disabled, .tia-settings__save:disabled:hover { opacity: 1; background: var(--tia-track); color: var(--tia-muted); }

/* The résumé line, under the buttons before the first run: "Résumé: <label> · Preview · Change". */
.tia-resumeline { display: grid; gap: 6px; }
.tia-resumeline__line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin: 0; font-size: 13px; }
.tia-resumeline__icon { color: var(--tia-ink); }
.tia-resumeline__text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.tia-resumeline__label { font-weight: 700; }

/* "?" beside a heading or a name: the options page's cards and fields, the editor's, the unsupported page's. */
.tia-card__head, .tia-unsupported__head, .tia-disclosure-changed__head, .tia-profile__headrow { display: flex;
  align-items: center; gap: 4px; }
.tia-card__head { margin: 0 0 8px; }
.tia-card__head .tia-card__title { margin: 0; }
.tia-field__head, .tia-profile__labelrow { display: inline-flex; align-items: center; gap: 2px; }
.tia-another__heading { display: flex; align-items: center; gap: 4px; margin: 0; font: 700 13px/1.4 var(--tia-font); }
.tia-unsupported__askrow { display: inline-flex; align-items: center; gap: 4px; }

@media (prefers-reduced-motion: reduce) {
  .tia-spin, .tia-skeleton { animation: none; }
}
@media (forced-colors: active) {
  .tia-cta { border: 1px solid ButtonText; }
  .tia-ring__arc { stroke: Highlight; }
  .tia-job, .tia-ask__body, .tia-outline, .tia-radiocard, .tia-step { border: 1px solid CanvasText; }
  .tia-radiocard__input:checked { background: Highlight; }
  .tia-helptip__bubble { border: 1px solid CanvasText; }
}
`;

/** Applies the report's stylesheet and the pages' layout to an extension page's document. */
export function adoptPageStyles(doc: Document): void {
  adoptStyles(doc, REPORT_CSS);
  adoptStyles(doc, PAGE_CSS);
  adoptStyles(doc, PROFILE_CSS);
}
