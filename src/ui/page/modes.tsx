/*
 * The modes (v3 Phase 3, docs/SPEC-AMENDMENTS.md §12), as the person chooses them: one group of radios per mode, each
 * choice saved at once through the container's onChange. The options page's Modes card and the side panel's gear menu
 * both draw them, so the two always read the same.
 *
 * Shown: Sign-in (Manual / Auto, since v3 Phase 5), Next page (Manual / Auto), Autofill after page turn (Automatically /
 * Manually), Submit (Manual / Auto, since v3 Phase 4), Record applications I submit myself (On / Off, the v3 Phase 4
 * review), Consent boxes (All agreements / Required only), AI answers (All / Profile only), the side panel's view
 * (Expanded / Minimized), and (v3 Phase 5) the skip rules Submit mode Auto and the auto-apply agent read, each a box.
 * Sign-in's Auto can be chosen only while it may act (signInAvailability: a connection holding credentials:read, the
 * disclosure acknowledged); otherwise the group says how to allow it, and the worker holds it Manual anyway.
 */
import { useId } from 'react';
import { MODE_CHOICES, PANEL_VIEWS, type Modes, type PanelView, type Settings } from '../../core/types/settings';
import type { AuthStatus } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';

const WORDS = COPY.options.modes;

/** The modes shown now, in the order they are drawn. */
export const SHOWN_MODES = ['signIn', 'next', 'afterPageTurn', 'submit', 'recordOwn', 'consents', 'ai'] as const satisfies
  ReadonlyArray<keyof Modes>;
type ShownMode = (typeof SHOWN_MODES)[number];

/** The skip rules, in the order they are drawn. */
export const SKIP_RULES = ['requiredEmpty', 'noAi', 'legalGuess'] as const satisfies
  ReadonlyArray<keyof Modes['agentSkip']>;

/** Why Sign-in's Auto cannot be chosen now, or null when it can (v3 Phase 5). */
export type SignInBlock = 'connection' | 'scope' | 'disclosure';

/** Sign-in's Auto may be chosen while the connection holds credentials:read and the disclosure was acknowledged. */
export function signInAvailability(status: AuthStatus | null): SignInBlock | null {
  if (status === null || status.connection !== 'connected') return 'connection';
  if (!status.scopes.includes('credentials:read')) return 'scope';
  if (status.disclosure === 'changed') return 'disclosure';
  return null;
}

/** What a Sign-in block says. */
const SIGN_IN_BLOCKS: Record<SignInBlock, string> = {
  connection: WORDS.signIn.needsConnection,
  scope: WORDS.signIn.needsScope,
  disclosure: WORDS.signIn.needsDisclosure,
};

/** A mode's words: its name, its help, and each choice's name. */
function wordsOf(mode: ShownMode): { name: string; help: string; choices: Record<string, string> } {
  const { name, help, ...rest } = WORDS[mode];
  const choices: Record<string, string> = {};
  for (const choice of MODE_CHOICES[mode]) choices[choice] = (rest as Record<string, string>)[choice] ?? choice;
  return { name, help, choices };
}

/** Every shown mode, the view and the skip rules. `onChange` gets the whole settings with the one choice changed.
 *  `signIn`: why Sign-in's Auto cannot be chosen now (null: it can). */
export function ModesFields({ settings, disabled, onChange, idPrefix, signIn }: {
  settings: Settings;
  disabled: boolean;
  onChange(next: Settings): void;
  /** Keeps the radios' group names apart where the page draws the modes twice. */
  idPrefix: string;
  signIn: SignInBlock | null;
}) {
  return (
    <div className="tia-modes" data-modes="">
      {SHOWN_MODES.map((mode) => (
        <ModeGroup key={mode} name={`${idPrefix}-${mode}`} setting={`modes.${mode}`} words={wordsOf(mode)}
          choices={MODE_CHOICES[mode]} value={settings.modes[mode]} disabled={disabled}
          blocked={mode === 'signIn' && signIn !== null ? { choice: 'auto', why: SIGN_IN_BLOCKS[signIn] } : null}
          onChoose={(choice) => onChange({ ...settings, modes: { ...settings.modes, [mode]: choice } })} />
      ))}
      <ModeGroup name={`${idPrefix}-view`} setting="view" words={{ name: WORDS.view.name, help: WORDS.view.help,
        choices: { expanded: WORDS.view.expanded, minimized: WORDS.view.minimized } }} choices={PANEL_VIEWS}
        value={settings.view} disabled={disabled} blocked={null}
        onChoose={(choice) => onChange({ ...settings, view: choice as PanelView })} />
      <SkipRules settings={settings} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** One mode: its name as the legend, its choices side by side, its help under them; `blocked` a choice that cannot be
 *  taken now, and why. */
function ModeGroup({ name, setting, words, choices, value, disabled, blocked, onChoose }: {
  name: string;
  setting: string;
  words: { name: string; help: string; choices: Record<string, string> };
  choices: readonly string[];
  value: string;
  disabled: boolean;
  blocked: { choice: string; why: string } | null;
  onChoose(choice: string): void;
}) {
  const helpId = useId();
  const whyId = useId();
  return (
    <fieldset className="tia-mode" data-setting-group={setting}
      aria-describedby={blocked === null ? helpId : `${helpId} ${whyId}`}>
      <legend className="tia-mode__name">{words.name}</legend>
      <div className="tia-mode__choices">
        {choices.map((choice) => (
          <label key={choice} className="tia-mode__choice">
            <input type="radio" name={name} value={choice} data-setting={`${setting}.${choice}`} checked={value === choice}
              disabled={disabled || blocked?.choice === choice} onChange={() => onChoose(choice)} />
            <span>{words.choices[choice]}</span>
          </label>
        ))}
      </div>
      <p className="tia-help tia-mode__help" id={helpId}>{words.help}</p>
      {blocked !== null && <p className="tia-note tia-mode__help" id={whyId} data-mode-blocked="">{blocked.why}</p>}
    </fieldset>
  );
}

/** The skip rules (v3 Phase 5): one box each, saved at once. */
function SkipRules({ settings, disabled, onChange }: { settings: Settings; disabled: boolean; onChange(next: Settings): void }) {
  const helpId = useId();
  const words = WORDS.agentSkip;
  return (
    <fieldset className="tia-mode" data-setting-group="modes.agentSkip" aria-describedby={helpId}>
      <legend className="tia-mode__name">{words.name}</legend>
      <div className="tia-mode__rules">
        {SKIP_RULES.map((rule) => (
          <label key={rule} className="tia-mode__choice">
            <input type="checkbox" data-setting={`modes.agentSkip.${rule}`} checked={settings.modes.agentSkip[rule]}
              disabled={disabled} onChange={(event) => onChange({ ...settings, modes: { ...settings.modes,
                agentSkip: { ...settings.modes.agentSkip, [rule]: event.target.checked } } })} />
            <span>{words[rule]}</span>
          </label>
        ))}
      </div>
      <p className="tia-help tia-mode__help" id={helpId}>{words.help}</p>
    </fieldset>
  );
}
