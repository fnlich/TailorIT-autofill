/*
 * The side panel's "Your autofill information" editor (v3 Phase 3b, Profile.tsx): its layout, adopted with the pages'
 * stylesheet (ui/page/styles.ts adoptPageStyles). Every colour comes from the report's tokens (src/shared/palette.ts).
 * A column of white cards on the panel's canvas, one per section; short fields two to a row where the panel is wide
 * enough, one to a row where it is not.
 */
export const PROFILE_CSS = `
.tia-profile { display: grid; gap: 12px; }
.tia-profile__head { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px; }
.tia-profile__head .tia-profile__back { grid-column: 1 / -1; }
.tia-profile__head .tia-helptip { justify-self: start; }
.tia-profile__back { justify-self: start; gap: 2px; padding-left: 2px; }
.tia-profile__back-icon { transform: rotate(180deg); }
.tia-profile__title { margin: 0; font: 600 18px/1.25 var(--tia-font); color: var(--tia-fg); }
.tia-profile__form { display: grid; gap: 12px; }
.tia-profile__all { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 0; border: 0; }
.tia-profile__section {
  display: grid; gap: 10px; padding: 14px 16px 16px; border-radius: var(--tia-r-card); background: var(--tia-bg);
  box-shadow: var(--tia-shadow-card);
}
.tia-profile__heading { margin: 0; font: 600 15px/1.3 var(--tia-font); color: var(--tia-fg); }
.tia-profile__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.tia-profile__field { display: grid; gap: 4px; min-width: 0; }
.tia-profile__label { font: 600 13px/1.35 var(--tia-font); color: var(--tia-fg); }
.tia-profile__input {
  width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid var(--tia-input);
  border-radius: var(--tia-r-control); font: inherit; color: var(--tia-fg); background: var(--tia-bg);
}
.tia-profile__input--area { min-height: 72px; resize: vertical; }
.tia-profile__input--short { max-width: 9em; }
.tia-profile__input:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 1px; }
.tia-profile__input:disabled { background: var(--tia-track); color: var(--tia-muted); }
.tia-profile__field[data-invalid] .tia-profile__input { border-color: var(--tia-tone-danger-fg); }
.tia-profile__error { margin: 0; font-size: 13px; color: var(--tia-tone-danger-fg); }
.tia-profile__entry {
  display: grid; gap: 10px; min-width: 0; margin: 0; padding: 10px 12px 12px; border: 1px solid var(--tia-line);
  border-radius: var(--tia-r-row);
}
.tia-profile__legend {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 0 4px;
  font: 600 13px/1.35 var(--tia-font);
}
.tia-profile__checks { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
.tia-profile__check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
.tia-profile__check input { width: 16px; height: 16px; margin: 0; accent-color: var(--tia-ink); }
.tia-profile__flagged {
  display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 12px; border-radius: var(--tia-r-control);
  background: var(--tia-tone-warning-bg); font-size: 13px;
}
.tia-profile__flagged .tia-icon { margin-top: 2px; color: var(--tia-tone-warning-fg); }
.tia-profile__problems {
  margin: 0; padding: 10px 14px; border-radius: var(--tia-r-row); background: var(--tia-tone-danger-bg);
  font-size: 13px;
}
.tia-profile__problems-title { margin: 0 0 4px; font-weight: 600; }
.tia-profile__problems ul { margin: 0; padding-left: 18px; }
.tia-profile__conflict {
  display: grid; gap: 6px; justify-items: start; padding: 10px 14px; border-radius: var(--tia-r-row);
  background: var(--tia-tone-warning-bg);
}
.tia-profile__conflict-title { display: flex; align-items: center; gap: 2px; margin: 0; font-weight: 600; }
.tia-profile__conflict .tia-help { color: var(--tia-fg); }
/* The review of v3 Phase 3b: what Load the latest kept of the person's edits. */
.tia-profile__merged {
  display: grid; gap: 4px; padding: 10px 14px; border-radius: var(--tia-r-row); background: var(--tia-track);
  font-size: 13px;
}
.tia-profile__merged p { margin: 0; }
.tia-profile__failed { display: grid; gap: 8px; justify-items: start; }
.tia-profile__actions { display: flex; justify-content: flex-end; }
.tia-profile__actions .tia-button { min-height: 40px; padding: 0 20px; }
.tia-profile__foot { margin: 0; font-size: 13px; }
@media (forced-colors: active) {
  .tia-profile__section { border: 1px solid CanvasText; }
}
`;
