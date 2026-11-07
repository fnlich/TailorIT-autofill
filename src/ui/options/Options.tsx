/*
 * The options page (it opens in a tab): the connection to TailorIT and every setting the person may change. Each change
 * is one settings/save, and the page shows what the worker answered: the change shows while it is on its way, then
 * the stored settings the answer carries; a refused save shows the settings as they were. TailorIT's look: its mark
 * and wordmark over white cards on its canvas, native checkboxes and radios in its ink.
 *
 * - Connection: the first-run disclosure, always above Connect while not connected; Connect (auth/startPairing) and
 *   the pairing's countdown; the typed code (auth/redeemCode); "Connected as …" and Disconnect (auth/disconnect);
 *   expired, revoked, a version mismatch and refused storage access, each said in plain words.
 * - Modes (v3 Phase 3, settings version 4: src/ui/page/modes.tsx, also in the side panel's gear menu): Sign-in
 *   (Manual; Auto only while the connection may read sign-ins and the disclosure was acknowledged, v3 Phase 5), Next
 *   page (Manual), Autofill after page turn (Automatically), Submit (Manual, v3 Phase 4), Record applications I submit
 *   myself (On), Consent boxes (All agreements), AI answers (All: the answers to legal, pay and attention-check
 *   questions the profile does not answer, version 3's switch), the side panel's view (Expanded) and the skip rules.
 * - Auto-apply (v3 Phase 5, src/ui/page/agent.tsx): Run auto-apply, off; turning it on the first time asks the person
 *   to confirm that applications go out unattended with AI-guessed answers (agent/set {on, confirmed}); it can be
 *   turned on only while connected with agent:run and the disclosure acknowledged, and says why not otherwise. Its
 *   status line, Stop and a link to TailorIT's Auto-apply page.
 * - Review panel: the side panel (the default) or the in-page panel (src/content/ui/panel.tsx), which opens from the
 *   launcher; a frame too small for it opens the side panel instead.
 * - Consent boxes: the core's closed list of categories, for Consent boxes: Required only; the usual ones pre-approved
 *   since settings version 2 (all but marketing and SMS: docs/SPEC-AMENDMENTS.md); certify carries a warning. Nothing
 *   outside the list can be pre-approved, so AI attestations and unrecognised consent never appear.
 * - AI help: pick, classify, drafts and answers (all on), and what a posting that forbids AI does (profile only, the
 *   default; use the AI anyway), with the plan's sentence on what never goes to the AI. v4 (D6): "Wait for me to confirm
 *   each draft" and "Ask me each time" are not offered any more (drafts are written and accepted; no policy card).
 * - Interpretations: all three on (the posting's country, Two or More Races, the decline default for unanswered
 *   self-identification), each saying what it does.
 * - v4 (D6): no "Your fixes" card: Save my answer is not offered any more, so its offer has nothing to turn on.
 * - Anonymous counters (Phase 6): the opt-in, off, listing the five fields counted and nothing else; the counts kept in
 *   this browser (telemetry/get), exported as a JSON file through an <a download> link (the page builds it from what it
 *   read: nothing is sent), and cleared (telemetry/clear).
 * - Saved runs: Clear (runs/clear), showing how many went.
 * v4 ui (the owner, 2026-11-07: "all explanation will be tooltip"): each card's and each setting's explanation is a "?"
 * (HelpTip) beside its title or its name, still describing its control; what a setting is now, the first-run
 * disclosure, the plan's sentence on what never goes to the AI and the list of what the counters count stay as text.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatConnectCode, normalizeConnectCode } from '../../contract/tailorit/connect';
import { CONSENT_CATEGORIES } from '../../core/enums';
import { TELEMETRY_FIELDS } from '../../core/telemetry/events';
import type { TelemetryCount } from '../../core/types/telemetry';
import type { AiForbiddenMode, Settings } from '../../core/types/settings';
import type { ErrorCode } from '../../messaging/envelope';
import type { SitesState } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { SITES_MATCH } from '../../shared/hosts';
import { LogoMark, Wordmark } from '../brand/Logo';
import { DisclosureChanged } from '../page/disclosure';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { AgentStatusLine, useAgentStatus, type AgentState } from '../page/agent';
import { ModesFields, signInAvailability } from '../page/modes';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { animationFrames, clockText, useSecondsLeft, type FrameScheduler } from './countdown';
import { useSettings, type SettingsState } from './settings';

const TEXT = COPY.options;

export interface OptionsProps {
  platform: PagePlatform;
  /** The clock (ms), for the pairing countdown. */
  now?: () => number;
  /** When the countdown repaints: the browser's animation frames by default. */
  frames?: FrameScheduler;
}

export function Options({ platform, now = Date.now, frames = animationFrames }: OptionsProps) {
  const root = useRef<HTMLElement>(null);
  const auth = useAuthStatus(platform, root);
  const settings = useSettings(platform);
  return (
    <main className="tia-page tia-options" ref={root}>
      <header className="tia-options__head">
        <LogoMark size={36} />
        {/* Reads exactly COPY.optionsTitle: the wordmark, then "Autofill settings". */}
        <h1 className="tia-options__title tia-brand__name">
          <Wordmark large />
          {' '}
          <span className="tia-brand__product">{COPY.brand.settings}</span>
        </h1>
      </header>
      <Connection platform={platform} auth={auth} now={now} frames={frames} />
      <SettingsCards platform={platform} settings={settings} auth={auth} />
      <Counters platform={platform} settings={settings} />
      <SavedRuns platform={platform} />
      {settings.note !== null && <p className="tia-save-note" role="status">{settings.note}</p>}
    </main>
  );
}

/** One titled card of the page, with its explanation in a "?" beside the title (v4 ui). */
function Card({ title, children, name, help }: { title: string; children: ReactNode; name: string; help?: string }) {
  const id = useId();
  return (
    <section className="tia-card" aria-labelledby={id} data-card={name} id={`settings-${name}`}>
      <div className="tia-card__head">
        <h2 className="tia-card__title" id={id}>{title}</h2>
        {help !== undefined && <HelpTip text={help} topic={title} />}
      </div>
      {children}
    </section>
  );
}

/** The choices of what a posting that forbids AI does, as v4 offers them (D6: "Ask me each time" is gone). */
const SHOWN_FORBIDDEN_MODES = ['profile-only', 'use-ai'] as const satisfies readonly AiForbiddenMode[];

/** A checkbox with its name and help, and anything that belongs under it (a warning). */
function Toggle({ setting, name, help, checked, disabled, onChange, children }: {
  setting: string;
  name: string;
  help?: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="tia-field">
      <input type="checkbox" id={id} data-setting={setting} checked={checked} disabled={disabled}
        aria-describedby={help ? `${id}-help` : undefined} onChange={(event) => onChange(event.target.checked)} />
      <div>
        <span className="tia-field__head">
          <label htmlFor={id} className="tia-field__name">{name}</label>
          {help && <HelpTip text={help} topic={name} id={`${id}-help`} />}
        </span>
        {children}
      </div>
    </div>
  );
}

// ── Connection ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a refused auth/redeemCode means to the person. */
function redeemRefusal(error: ErrorCode, retryAfterSeconds?: number): string {
  if (error === 'bad_message') return TEXT.connection.codeInvalid;
  if (error === 'expired') return TEXT.connection.codeRefused;
  if (error === 'rate_limited') return TEXT.connection.rateLimited(retryAfterSeconds);
  return TEXT.connection.unreachable;
}

function Connection({ platform, auth, now, frames }: {
  platform: PagePlatform;
  auth: AuthState;
  now: () => number;
  frames: FrameScheduler;
}) {
  const { status } = auth;
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  const codeId = useId();
  const pairingUntil = status !== null && status.connection !== 'connected' ? status.pairingExpiresAt : null;
  const left = useSecondsLeft(pairingUntil, now, frames);

  const connect = async () => {
    setWorking(true);
    setMessage(null);
    const answer = await request(platform, { v: 1, type: 'auth/startPairing' });
    setWorking(false);
    if (!answer.ok) setMessage({ text: TEXT.connection.openFailed, error: true });
    // The status now holds the pending pairing, whose countdown shows.
    auth.refresh();
  };

  const redeem = async () => {
    const normalized = normalizeConnectCode(code);
    if (normalized === null) {
      setMessage({ text: TEXT.connection.codeInvalid, error: true });
      return;
    }
    setWorking(true);
    setMessage(null);
    const answer = await request(platform, { v: 1, type: 'auth/redeemCode', code: formatConnectCode(normalized) });
    setWorking(false);
    if (answer.ok) {
      setCode('');
      auth.accept(answer.data);
    } else {
      setMessage({ text: redeemRefusal(answer.error, answer.retryAfterSeconds), error: true });
    }
  };

  /** The review: I understand, on the disclosure that changed since the person connected. */
  const acknowledge = async () => {
    setWorking(true);
    const answer = await request(platform, { v: 1, type: 'auth/acknowledgeDisclosure' });
    setWorking(false);
    if (answer.ok) auth.accept(answer.data);
    else auth.refresh();
  };

  const disconnect = async () => {
    setWorking(true);
    setMessage(null);
    const answer = await request(platform, { v: 1, type: 'auth/disconnect' });
    setWorking(false);
    if (answer.ok) {
      auth.accept(answer.data);
      setMessage({ text: TEXT.connection.disconnected, error: false });
    } else {
      setMessage({ text: COPY.panel.failed, error: true });
    }
  };

  return (
    <Card title={TEXT.connection.heading} name="connection">
      {status === null ? (
        <p className={auth.failed ? 'tia-error' : 'tia-note'}>{auth.failed ? COPY.panel.noAnswer : TEXT.loading}</p>
      ) : (
        <div data-connection={status.connection}>
          {status.storageAccess === 'refused' && <p className="tia-warning" role="alert">{TEXT.connection.storageRefused}</p>}
          {status.versionMismatch && <p className="tia-warning" role="alert">{TEXT.connection.versionMismatch}</p>}
          {status.connection === 'connected' ? (
            <>
              <p>
                {status.account
                  ? TEXT.connection.connectedAs(status.account.name, status.account.email)
                  : TEXT.connection.connectedNoAccount}
              </p>
              <p className="tia-note">
                {status.scopes.includes('profile:sensitive') ? TEXT.connection.sensitiveShared : TEXT.connection.sensitiveNotShared}
              </p>
              {status.disclosure === 'changed' && <DisclosureChanged onUnderstand={() => void acknowledge()} />}
              {status.expiresAt !== null && (
                <p className="tia-note">
                  {TEXT.connection.lastsUntil(new Date(status.expiresAt).toLocaleDateString(undefined, { dateStyle: 'long' }))}
                </p>
              )}
              <div className="tia-row-of-buttons">
                <button type="button" className="tia-button" disabled={working} onClick={() => void disconnect()}>
                  {TEXT.connection.disconnect}
                </button>
              </div>
            </>
          ) : (
            <>
              {status.connection === 'expired' && <p className="tia-warning">{TEXT.connection.expired}</p>}
              {status.connection === 'revoked' && <p className="tia-warning">{TEXT.connection.revoked}</p>}
              <div className="tia-disclosure" data-disclosure="">
                <h3 className="tia-disclosure__title">{TEXT.connection.disclosureHeading}</h3>
                {TEXT.connection.disclosure.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                <p>{TEXT.connection.consentLine}</p>
              </div>
              <div className="tia-row-of-buttons">
                <button type="button" className="tia-button tia-button--primary" disabled={working} onClick={() => void connect()}>
                  {TEXT.connection.connect}
                </button>
              </div>
              {pairingUntil !== null && left !== null && (
                <p className="tia-note" role="status" data-pairing={left > 0 ? 'waiting' : 'lapsed'}>
                  {left > 0 ? `${TEXT.connection.waiting} ${TEXT.connection.endsIn(clockText(left))}` : TEXT.connection.lapsed}
                </p>
              )}
              <form className="tia-code" onSubmit={(event) => {
                event.preventDefault();
                void redeem();
              }}>
                <span className="tia-field__head">
                  <label htmlFor={codeId} className="tia-field__name">{TEXT.connection.codeLabel}</label>
                  <HelpTip text={TEXT.connection.codeHelp} topic={TEXT.connection.codeLabel} id={`${codeId}-help`} />
                </span>
                <input id={codeId} className="tia-code__input" value={code} maxLength={24} autoComplete="off" spellCheck={false}
                  aria-describedby={`${codeId}-help`} disabled={working} onChange={(event) => setCode(event.target.value)} />
                <div>
                  <button type="submit" className="tia-button" disabled={working || code.trim() === ''}>
                    {TEXT.connection.codeSubmit}
                  </button>
                </div>
              </form>
            </>
          )}
          {message !== null && (
            <p className={message.error ? 'tia-error' : 'tia-note'} role={message.error ? 'alert' : 'status'}>{message.text}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── The settings ──────────────────────────────────────────────────────────────────────────────────────────────────

function SettingsCards({ platform, settings, auth }: { platform: PagePlatform; settings: SettingsState; auth: AuthState }) {
  const { shown, saving, failed, save } = settings;
  if (shown === null) return <p className={failed ? 'tia-error' : 'tia-note'}>{failed ? TEXT.unreadable : TEXT.loading}</p>;
  const set = (patch: Partial<Settings>) => save({ ...shown, ...patch });
  return (
    <>
      <Card title={TEXT.modes.heading} name="modes" help={TEXT.modes.intro}>
        <ModesFields settings={shown} disabled={saving} onChange={save} idPrefix="options"
          signIn={signInAvailability(auth.status)} />
      </Card>

      <AutoApply platform={platform} auth={auth} />

      <WhereItWorks platform={platform} />

      <Card title={TEXT.panel.heading} name="panel" help={`${TEXT.panel.intro} ${TEXT.panel.inPageHelp}`}>
        <fieldset className="tia-fieldset">
          <legend className="tia-visually-hidden">{TEXT.panel.intro}</legend>
          {(['side', 'in-page'] as const).map((placement) => (
            <PlacementChoice key={placement} placement={placement} checked={shown.panel === placement} disabled={saving}
              onChoose={() => set({ panel: placement })} />
          ))}
        </fieldset>
      </Card>

      <Card title={TEXT.consent.heading} name="consent" help={`${TEXT.consent.intro} ${TEXT.consent.never}`}>
        {/* Under All agreements every kind is ticked, whatever its toggle: each shows ticked and cannot be changed, and
            the line says where the choice is (v3 Phase 3 review). The kinds pre-approved are kept for Required only. */}
        {shown.modes.consents === 'all' && (
          <p className="tia-note" data-consents-all="">{TEXT.consent.allMode}</p>
        )}
        {CONSENT_CATEGORIES.map((category) => (
          <Toggle key={category} setting={`consent.${category}`} name={TEXT.consent.categories[category].name}
            help={TEXT.consent.categories[category].help}
            checked={shown.modes.consents === 'all' || shown.preapprovedConsent.includes(category)}
            disabled={saving || shown.modes.consents === 'all'}
            onChange={(checked) => set({
              preapprovedConsent: CONSENT_CATEGORIES.filter((each) =>
                (each === category ? checked : shown.preapprovedConsent.includes(each))),
            })}>
            {category === 'certify' && <p className="tia-warning" data-warning="certify">{TEXT.consent.certifyWarning}</p>}
          </Toggle>
        ))}
      </Card>

      <Card title={TEXT.ai.heading} name="ai" help={TEXT.ai.intro}>
        <Toggle setting="llm.tiebreak" name={TEXT.ai.tiebreak} help={TEXT.ai.tiebreakHelp} checked={shown.llm.tiebreak}
          disabled={saving} onChange={(tiebreak) => set({ llm: { ...shown.llm, tiebreak } })} />
        <Toggle setting="llm.classify" name={TEXT.ai.classify} help={TEXT.ai.classifyHelp} checked={shown.llm.classify}
          disabled={saving} onChange={(classify) => set({ llm: { ...shown.llm, classify } })} />
        <Toggle setting="llm.drafts" name={TEXT.ai.drafts} help={TEXT.ai.draftsHelp} checked={shown.llm.drafts}
          disabled={saving} onChange={(drafts) => set({ llm: { ...shown.llm, drafts } })} />
        <Toggle setting="llm.answers" name={TEXT.ai.answers} help={TEXT.ai.answersHelp} checked={shown.llm.answers}
          disabled={saving} onChange={(answers) => set({ llm: { ...shown.llm, answers } })} />
        <fieldset className="tia-fieldset" data-setting-group="llm.whenForbidden">
          <legend className="tia-field__name">{TEXT.ai.whenForbidden.heading}</legend>
          {SHOWN_FORBIDDEN_MODES.map((mode) => (
            <ForbiddenChoice key={mode} mode={mode} checked={shown.llm.whenForbidden === mode} disabled={saving}
              onChoose={() => set({ llm: { ...shown.llm, whenForbidden: mode } })} />
          ))}
        </fieldset>
        <p className="tia-note" data-ai-never="">{TEXT.ai.never}</p>
      </Card>

      <Card title={TEXT.interpretations.heading} name="interpretations" help={TEXT.interpretations.intro}>
        <Toggle setting="interpretations.postingCountryForLegal" name={TEXT.interpretations.postingCountryForLegal}
          help={TEXT.interpretations.postingCountryForLegalHelp} checked={shown.interpretations.postingCountryForLegal}
          disabled={saving}
          onChange={(postingCountryForLegal) => set({ interpretations: { ...shown.interpretations, postingCountryForLegal } })} />
        <Toggle setting="interpretations.twoOrMoreRaces" name={TEXT.interpretations.twoOrMoreRaces}
          help={TEXT.interpretations.twoOrMoreRacesHelp} checked={shown.interpretations.twoOrMoreRaces} disabled={saving}
          onChange={(twoOrMoreRaces) => set({ interpretations: { ...shown.interpretations, twoOrMoreRaces } })} />
        <Toggle setting="interpretations.eeoDeclineByDefault" name={TEXT.interpretations.eeoDeclineByDefault}
          help={TEXT.interpretations.eeoDeclineByDefaultHelp} checked={shown.interpretations.eeoDeclineByDefault}
          disabled={saving}
          onChange={(eeoDeclineByDefault) => set({ interpretations: { ...shown.interpretations, eeoDeclineByDefault } })} />
      </Card>
    </>
  );
}

// ── Auto-apply (v3 Phase 5) ───────────────────────────────────────────────────────────────────────────────────────

/** Run auto-apply, its one-time confirmation, why it cannot be turned on, its status, Stop and TailorIT's page. */
function AutoApply({ platform, auth }: { platform: PagePlatform; auth: AuthState }) {
  const anchor = useRef<HTMLDivElement>(null);
  const agent: AgentState = useAgentStatus(platform, anchor, { listen: true });
  const { status, refresh } = agent;
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  /** The switch as the person just set it, until the worker answered. */
  const [pending, setPending] = useState<boolean | null>(null);
  const words = TEXT.agent;
  const connection = auth.status?.connection;
  const disclosure = auth.status?.disclosure;
  // The connection, or the disclosure's acknowledgement, changed on this page: read the agent again.
  useEffect(() => {
    refresh();
  }, [refresh, connection, disclosure]);

  const turn = async (on: boolean, confirmed: boolean) => {
    setWorking(true);
    setPending(on);
    const answer = await request(platform, { v: 1, type: 'agent/set', on, ...(confirmed ? { confirmed: true as const } : {}) });
    setWorking(false);
    setPending(null);
    setAsking(false);
    if (answer.ok) agent.accept(answer.data);
    else refresh();
  };
  const toggle = (on: boolean) => {
    if (on && status?.confirmed !== true) {
      setAsking(true);
      return;
    }
    void turn(on, false);
  };

  return (
    <Card title={words.heading} name="agent" help={words.intro}>
      <div ref={anchor}>
        {status === null ? <p className="tia-note">{TEXT.loading}</p> : (
          <>
            <Toggle setting="agent.on" name={words.run} help={words.runHelp} checked={pending ?? (status.on || asking)}
              disabled={working || (!status.on && !status.allowed)} onChange={toggle} />
            {status.blocked !== null && <p className="tia-note" data-agent-blocked={status.blocked}>{words.blocked[status.blocked]}</p>}
            {asking && (
              <div className="tia-confirm" role="alertdialog" aria-labelledby="agent-confirm-heading" data-agent-confirm="">
                <h3 className="tia-disclosure__title" id="agent-confirm-heading">{words.confirmHeading}</h3>
                <p>{words.confirm}</p>
                <div className="tia-row-of-buttons">
                  <button type="button" className="tia-button tia-button--primary" data-action="agent-confirm" disabled={working}
                    onClick={() => void turn(true, true)}>{words.confirmYes}</button>
                  <button type="button" className="tia-button" data-action="agent-cancel" disabled={working}
                    onClick={() => setAsking(false)}>{words.confirmNo}</button>
                </div>
              </div>
            )}
            <AgentStatusLine platform={platform} agent={agent} className="tia-agent tia-agent--options" />
          </>
        )}
      </div>
    </Card>
  );
}

// ── Where Autofill works (v3 Phase 8) ─────────────────────────────────────────────────────────────────────────────

/** The company career sites: turning them on asks Chrome for every https page on the person's own click (requestHosts,
 *  called inside the click, before anything is awaited), and turning them off gives the permission back (the worker).
 *  They act only while the person turned them on and Chrome holds the permission. A choice to turn them on that could
 *  not be saved gives back what Chrome just granted (the Phase 8 review, P8). */
function WhereItWorks({ platform }: { platform: PagePlatform }) {
  const words = TEXT.sites;
  const [state, setState] = useState<SitesState | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void request(platform, { v: 1, type: 'sites/get' }).then((answer) => {
      if (live && answer.ok) setState(answer.data);
    });
    return () => {
      live = false;
    };
  }, [platform]);

  const toggle = (on: boolean) => {
    // Chrome counts the click as the person's only while nothing has been awaited: ask first.
    const granted = on ? platform.requestHosts([SITES_MATCH]) : Promise.resolve(true);
    setWorking(true);
    setMessage(null);
    void (async () => {
      let held = false;
      try {
        held = await granted;
      } catch {
        held = false;
      }
      if (!held) {
        setWorking(false);
        setMessage(words.refused);
        return;
      }
      const answer = await request(platform, { v: 1, type: 'sites/set', on })
        .catch(() => ({ ok: false as const, error: 'unavailable' as const }));
      if (!answer.ok && on) await platform.removeHosts([SITES_MATCH]).catch(() => false);
      setWorking(false);
      if (answer.ok) setState(answer.data);
      else setMessage(words.failed);
    })();
  };

  return (
    <Card title={words.heading} name="sites" help={words.intro}>
      {state === null ? <p className="tia-note">{TEXT.loading}</p> : (
        <Toggle setting="sites.on" name={words.toggle} help={words.hint} checked={state.on && state.granted}
          disabled={working} onChange={toggle}>
          {state.on && !state.granted && <p className="tia-note" data-sites-permission="">{words.needsPermission}</p>}
          {message !== null && <p className="tia-error" role="status">{message}</p>}
        </Toggle>
      )}
    </Card>
  );
}

/** One choice of what a posting that forbids AI does, with what it means. */
function ForbiddenChoice({ mode, checked, disabled, onChoose }: {
  mode: (typeof SHOWN_FORBIDDEN_MODES)[number];
  checked: boolean;
  disabled: boolean;
  onChoose(): void;
}) {
  const id = useId();
  const words = TEXT.ai.whenForbidden;
  const help = mode === 'profile-only' ? words['profile-onlyHelp'] : words['use-aiHelp'];
  return (
    <div className="tia-field">
      <input type="radio" id={id} name="when-forbidden" value={mode} data-setting={`llm.whenForbidden.${mode}`}
        checked={checked} disabled={disabled} aria-describedby={`${id}-help`} onChange={() => onChoose()} />
      <span className="tia-field__head">
        <label htmlFor={id} className="tia-field__name">{words[mode]}</label>
        <HelpTip text={help} topic={words[mode]} id={`${id}-help`} />
      </span>
    </div>
  );
}

function PlacementChoice({ placement, checked, disabled, onChoose }: {
  placement: Settings['panel'];
  checked: boolean;
  disabled: boolean;
  onChoose(): void;
}) {
  const id = useId();
  return (
    <div className="tia-field">
      <input type="radio" id={id} name="panel-placement" value={placement} data-setting={`panel.${placement}`} checked={checked}
        disabled={disabled} onChange={() => onChoose()} />
      <label htmlFor={id} className="tia-field__name">{placement === 'side' ? TEXT.panel.side : TEXT.panel.inPage}</label>
    </div>
  );
}

// ── Anonymous counters ────────────────────────────────────────────────────────────────────────────────────────────

const COUNTERS = TEXT.telemetry;

/** The counts as a JSON file the person can save: the five fields' names and each count. Built from what the page
 *  read, as a data: address for the <a download> link; nothing leaves the browser. */
export function countersFile(counts: readonly TelemetryCount[]): string {
  const json = JSON.stringify({ fields: TELEMETRY_FIELDS, counts }, null, 2);
  return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
}

/** The opt-in (a setting, saved with the others), what it counts, the counts kept here, Export and Clear. */
function Counters({ platform, settings }: { platform: PagePlatform; settings: SettingsState }) {
  const { shown, saving, save } = settings;
  const [counts, setCounts] = useState<readonly TelemetryCount[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const optIn = shown?.telemetry.optIn ?? false;
  const listId = useId();
  const captionId = useId();

  // Read again whenever the opt-in changes: turning it on starts from what is kept; off keeps the counts until cleared.
  useEffect(() => {
    let live = true;
    void request(platform, { v: 1, type: 'telemetry/get' }).then((answer) => {
      if (!live) return;
      if (answer.ok) {
        setCounts(answer.data.counts);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [platform, optIn]);

  const clear = async () => {
    setWorking(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'telemetry/clear' });
    setWorking(false);
    if (answer.ok) {
      setCounts(answer.data.counts);
      setNote({ text: COUNTERS.cleared, error: false });
    } else {
      setNote({ text: COUNTERS.clearFailed, error: true });
    }
  };

  return (
    <Card title={COUNTERS.heading} name="telemetry" help={COUNTERS.intro}>
      {shown !== null && (
        <Toggle setting="telemetry.optIn" name={COUNTERS.optIn} checked={optIn} disabled={saving}
          onChange={(checked) => save({ ...shown, telemetry: { optIn: checked } })}>
          <p className="tia-help" id={listId}>{COUNTERS.optInHelp}</p>
          <ul className="tia-list" aria-labelledby={listId} data-telemetry-fields="">
            {TELEMETRY_FIELDS.map((field) => <li key={field} data-field={field}>{COUNTERS.fields[field]}</li>)}
          </ul>
          <p className="tia-help">{COUNTERS.never}</p>
        </Toggle>
      )}
      {counts === null ? (
        <p className={failed ? 'tia-error' : 'tia-note'}>{failed ? COUNTERS.unreadable : COUNTERS.loading}</p>
      ) : counts.length === 0 ? (
        <p className="tia-note" data-telemetry="empty">{COUNTERS.empty}</p>
      ) : (
        <div className="tia-table-wrap">
          <table className="tia-table" data-telemetry="counts">
            <caption id={captionId}>{COUNTERS.caption}</caption>
            <thead>
              <tr>
                {([...TELEMETRY_FIELDS, 'count'] as const).map((column) => (
                  <th key={column} scope="col">{COUNTERS.columns[column]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {counts.map((count) => (
                <tr key={`${count.platform}|${count.fieldKind}|${count.matcherStage}|${count.outcome}|${count.tripwireTriggered}`}>
                  <td>{COPY.platforms[count.platform]}</td>
                  <td>{COPY.fieldKinds[count.fieldKind]}</td>
                  <td>{COPY.stages[count.matcherStage]}</td>
                  <td>{COUNTERS.outcomes[count.outcome]}</td>
                  <td>{count.tripwireTriggered ? COUNTERS.yes : COUNTERS.no}</td>
                  <td className="tia-table__count">{count.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {counts !== null && counts.length > 0 && (
        <div className="tia-row-of-buttons">
          <a className="tia-button" href={countersFile(counts)} download={COUNTERS.exportName} data-telemetry-export="">
            {COUNTERS.export}
          </a>
          <button type="button" className="tia-button" disabled={working} onClick={() => void clear()}>{COUNTERS.clear}</button>
        </div>
      )}
      {note !== null && <p className={note.error ? 'tia-error' : 'tia-note'} role={note.error ? 'alert' : 'status'}>{note.text}</p>}
    </Card>
  );
}

// ── Saved runs ────────────────────────────────────────────────────────────────────────────────────────────────────

function SavedRuns({ platform }: { platform: PagePlatform }) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const clear = async () => {
    setWorking(true);
    setResult(null);
    const answer = await request(platform, { v: 1, type: 'runs/clear' });
    setWorking(false);
    setResult(answer.ok ? TEXT.data.cleared(answer.data.cleared) : TEXT.data.failed);
  };
  return (
    <Card title={TEXT.data.heading} name="runs" help={TEXT.data.intro}>
      <div className="tia-row-of-buttons">
        <button type="button" className="tia-button" disabled={working} onClick={() => void clear()}>{TEXT.data.clear}</button>
        {result !== null && <span className="tia-note" role="status">{result}</span>}
      </div>
    </Card>
  );
}
