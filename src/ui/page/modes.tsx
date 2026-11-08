/*
 * The modes (v3 Phase 3, docs/SPEC-AMENDMENTS.md §12), as the person chooses them: one group of choices per mode. The
 * options page's Modes card saves each choice at once; the side panel's Settings view (v4 ui) gathers them and saves
 * with its Save. Both draw this, so the two always read the same.
 *
 * v4 ui (the owner, 2026-11-07, Jobright's Settings view: screenshot 5): each group is a title with a "?" (HelpTip)
 * holding its explanation, then its choices as radio cards, one per line on a grey card, the chosen one's dot filled
 * with TailorIT's teal. In the side panel's order: Autofill after page turn (Automatically / Manually), Default view
 * (Expanded / Minimized), Next page, Submit, Sign-in (Manual / Auto, since v3 Phase 5), Consent boxes (All agreements /
 * Required only), AI answers (All / Profile only), Résumé already on the page (Keep it / Upload mine again), Record
 * applications I submit myself (On / Off), (snapshot round 2, settings version 7) When a list has no match (Choose its
 * Other / Leave it empty) and TailorIT notifications on the page (Until I close them / 30, 10 or 5 seconds / Never
 * show them), and (v3 Phase 5) the skip rules Submit mode Auto and the auto-apply agent read, each a box. Sign-in's Auto can be chosen only while it may act (signInAvailability: a connection holding
 * credentials:read, the disclosure acknowledged); otherwise its card is disabled and the group's "?" says why, and the
 * worker holds it Manual anyway.
 * v5 p1-shell (settings version 8): "Where the panel shows" (On the page / Chrome's side panel) is drawn right after
 * Default view, whose choices now say whether the sidebar opens by itself; the options page shows it here too.
 * v5 p1-shell (the review's S7): in the sidebar on the page (ui/panel/on-page.tsx), a choice that lets the extension act
 * more on its own than the settings as stored (`stored`) cannot be made: Submit's and Sign-in's Auto, and turning a
 * skip rule off; the group's "?" says where it is made, and the worker refuses such a save from the sidebar anyway.
 */
import { useId } from 'react';
import { useOnPage } from '../panel/on-page';
import {
  MODE_CHOICES, PANEL_PLACES, PANEL_VIEWS, type Modes, type PanelPlace, type PanelView, type Settings,
} from '../../core/types/settings';
import type { AuthStatus } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { HelpTip } from './HelpTip';

const WORDS = COPY.options.modes;

/** The modes shown now, in the order they are drawn (the view is drawn second, after Autofill after page turn). */
export const SHOWN_MODES = ['afterPageTurn', 'next', 'submit', 'signIn', 'consents', 'ai', 'resumeOnPage', 'recordOwn',
  'noMatch', 'notifications'] as const satisfies ReadonlyArray<keyof Modes>;
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
 *  `signIn`: why Sign-in's Auto cannot be chosen now (null: it can). `stored`: the settings as stored, which (in the
 *  sidebar on the page alone) no choice here may go beyond in what the extension does on its own (the header). */
export function ModesFields({ settings, disabled, onChange, idPrefix, signIn, stored }: {
  settings: Settings;
  disabled: boolean;
  onChange(next: Settings): void;
  /** Keeps the radios' group names apart where the page draws the modes twice. */
  idPrefix: string;
  signIn: SignInBlock | null;
  stored?: Settings | null;
}) {
  const onPage = useOnPage();
  /** S7: in the sidebar, Auto stays out of reach where the stored settings do not hold it. */
  const held = (mode: ShownMode): { choice: string; why: string } | null =>
    onPage !== null && stored != null && (mode === 'submit' || mode === 'signIn') && stored.modes[mode] !== 'auto'
      ? { choice: 'auto', why: COPY.onPage.raise } : null;
  const group = (mode: ShownMode) => (
    <ModeGroup key={mode} name={`${idPrefix}-${mode}`} setting={`modes.${mode}`} words={wordsOf(mode)}
      choices={MODE_CHOICES[mode]} value={settings.modes[mode]} disabled={disabled}
      blocked={mode === 'signIn' && signIn !== null ? { choice: 'auto', why: SIGN_IN_BLOCKS[signIn] } : held(mode)}
      onChoose={(choice) => onChange({ ...settings, modes: { ...settings.modes, [mode]: choice } })} />
  );
  const [first, ...rest] = SHOWN_MODES;
  return (
    <div className="tia-modes" data-modes="">
      {group(first)}
      <ModeGroup name={`${idPrefix}-view`} setting="view" words={{ name: WORDS.view.name, help: WORDS.view.help,
        choices: { expanded: WORDS.view.expanded, minimized: WORDS.view.minimized } }} choices={PANEL_VIEWS}
        value={settings.view} disabled={disabled} blocked={null}
        onChoose={(choice) => onChange({ ...settings, view: choice as PanelView })} />
      <ModeGroup name={`${idPrefix}-panel`} setting="panel" words={{ name: WORDS.panel.name, help: WORDS.panel.help,
        choices: { page: WORDS.panel.page, side: WORDS.panel.side } }} choices={PANEL_PLACES}
        value={settings.panel} disabled={disabled} blocked={null}
        onChoose={(choice) => onChange({ ...settings, panel: choice as PanelPlace })} />
      {rest.map(group)}
      <SkipRules settings={settings} disabled={disabled} onChange={onChange}
        kept={onPage !== null && stored != null ? stored.modes.agentSkip : null} />
    </div>
  );
}

/** A group's title with its "?" (the explanation, and why a choice cannot be taken now). */
function GroupHead({ nameId, tipId, name, help }: { nameId: string; tipId: string; name: string; help: string }) {
  return (
    <p className="tia-mode__head">
      <span className="tia-mode__name" id={nameId}>{name}</span>
      <HelpTip text={help} topic={name} id={tipId} />
    </p>
  );
}

/** One mode: its title and "?", then its choices as radio cards; `blocked` a choice that cannot be taken now, and why
 *  (said in the "?"). */
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
  const nameId = useId();
  const tipId = useId();
  return (
    <div className="tia-mode" role="radiogroup" aria-labelledby={nameId} aria-describedby={tipId}
      data-setting-group={setting} data-mode-blocked={blocked === null ? undefined : blocked.choice}>
      <GroupHead nameId={nameId} tipId={tipId} name={words.name}
        help={blocked === null ? words.help : `${words.help} ${blocked.why}`} />
      <div className="tia-mode__choices">
        {choices.map((choice) => (
          <label key={choice} className="tia-radiocard">
            <input type="radio" className="tia-radiocard__input" name={name} value={choice}
              data-setting={`${setting}.${choice}`} checked={value === choice}
              disabled={disabled || blocked?.choice === choice} onChange={() => onChoose(choice)} />
            <span className="tia-radiocard__label">{words.choices[choice]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** The skip rules (v3 Phase 5): one box each. `kept` (S7, the sidebar on the page): the rules as stored, none of which
 *  may be turned off here. */
function SkipRules({ settings, disabled, onChange, kept }: { settings: Settings; disabled: boolean;
  onChange(next: Settings): void; kept: Modes['agentSkip'] | null }) {
  const nameId = useId();
  const tipId = useId();
  const words = WORDS.agentSkip;
  return (
    <div className="tia-mode" role="group" aria-labelledby={nameId} aria-describedby={tipId}
      data-setting-group="modes.agentSkip">
      <GroupHead nameId={nameId} tipId={tipId} name={words.name}
        help={kept === null ? words.help : `${words.help} ${COPY.onPage.raise}`} />
      <div className="tia-mode__choices">
        {SKIP_RULES.map((rule) => (
          <label key={rule} className="tia-radiocard tia-radiocard--box">
            <input type="checkbox" className="tia-radiocard__input" data-setting={`modes.agentSkip.${rule}`}
              checked={settings.modes.agentSkip[rule]}
              disabled={disabled || (kept !== null && kept[rule] && settings.modes.agentSkip[rule])}
              onChange={(event) => onChange({ ...settings, modes: { ...settings.modes,
                agentSkip: { ...settings.modes.agentSkip, [rule]: event.target.checked } } })} />
            <span className="tia-radiocard__label">{words[rule]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
