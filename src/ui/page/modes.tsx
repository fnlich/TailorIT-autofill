/*
 * The modes (v3 Phase 3, docs/SPEC-AMENDMENTS.md §12), as the person chooses them: one group of radios per mode, each
 * choice saved at once through the container's onChange. The options page's Modes card and the side panel's gear menu
 * both draw them, so the two always read the same.
 *
 * Shown: Next page (Manual / Auto), Autofill after page turn (Automatically / Manually), Consent boxes (All agreements /
 * Required only), AI answers (All / Profile only) and the side panel's view (Expanded / Minimized). Sign-in, Submit and
 * the agent's skip rules are kept in the settings (version 4) but not shown until their behaviour exists (Phases 4 and
 * 5), so nothing here offers what the extension does not do.
 */
import { useId } from 'react';
import { MODE_CHOICES, PANEL_VIEWS, type Modes, type PanelView, type Settings } from '../../core/types/settings';
import { COPY } from '../../shared/copy';

const WORDS = COPY.options.modes;

/** The modes shown now, in the order they are drawn. */
export const SHOWN_MODES = ['next', 'afterPageTurn', 'consents', 'ai'] as const satisfies ReadonlyArray<keyof Modes>;
type ShownMode = (typeof SHOWN_MODES)[number];

/** A mode's words: its name, its help, and each choice's name. */
function wordsOf(mode: ShownMode): { name: string; help: string; choices: Record<string, string> } {
  const { name, help, ...choices } = WORDS[mode];
  return { name, help, choices };
}

/** Every shown mode and the view, as radio groups. `onChange` gets the whole settings with the one choice changed. */
export function ModesFields({ settings, disabled, onChange, idPrefix }: {
  settings: Settings;
  disabled: boolean;
  onChange(next: Settings): void;
  /** Keeps the radios' group names apart where the page draws the modes twice. */
  idPrefix: string;
}) {
  return (
    <div className="tia-modes" data-modes="">
      {SHOWN_MODES.map((mode) => (
        <ModeGroup key={mode} name={`${idPrefix}-${mode}`} setting={`modes.${mode}`} words={wordsOf(mode)}
          choices={MODE_CHOICES[mode]} value={settings.modes[mode]} disabled={disabled}
          onChoose={(choice) => onChange({ ...settings, modes: { ...settings.modes, [mode]: choice } })} />
      ))}
      <ModeGroup name={`${idPrefix}-view`} setting="view" words={{ name: WORDS.view.name, help: WORDS.view.help,
        choices: { expanded: WORDS.view.expanded, minimized: WORDS.view.minimized } }} choices={PANEL_VIEWS}
        value={settings.view} disabled={disabled}
        onChoose={(choice) => onChange({ ...settings, view: choice as PanelView })} />
    </div>
  );
}

/** One mode: its name as the legend, its choices side by side, its help under them. */
function ModeGroup({ name, setting, words, choices, value, disabled, onChoose }: {
  name: string;
  setting: string;
  words: { name: string; help: string; choices: Record<string, string> };
  choices: readonly string[];
  value: string;
  disabled: boolean;
  onChoose(choice: string): void;
}) {
  const helpId = useId();
  return (
    <fieldset className="tia-mode" data-setting-group={setting} aria-describedby={helpId}>
      <legend className="tia-mode__name">{words.name}</legend>
      <div className="tia-mode__choices">
        {choices.map((choice) => (
          <label key={choice} className="tia-mode__choice">
            <input type="radio" name={name} value={choice} data-setting={`${setting}.${choice}`} checked={value === choice}
              disabled={disabled} onChange={() => onChoose(choice)} />
            <span>{words.choices[choice]}</span>
          </label>
        ))}
      </div>
      <p className="tia-help tia-mode__help" id={helpId}>{words.help}</p>
    </fieldset>
  );
}
