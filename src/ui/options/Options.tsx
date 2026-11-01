/*
 * The options page (it opens in a tab): the connection to TailorIT and every setting the person may change. Each change
 * is one settings/save, and the page shows what the worker answered: the change shows while it is on its way, then
 * the stored settings the answer carries; a refused save shows the settings as they were. TailorIT's look: its mark
 * and wordmark over white cards on its canvas, native checkboxes and radios in its ink.
 *
 * - Connection: the first-run disclosure, always above Connect while not connected; Connect (auth/startPairing) and
 *   the pairing's countdown; the typed code (auth/redeemCode); "Connected as …" and Disconnect (auth/disconnect);
 *   expired, revoked, a version mismatch and refused storage access, each said in plain words.
 * - Review panel: the side panel (the default) or the in-page panel (src/content/ui/panel.tsx), which opens from the
 *   launcher; a frame too small for it opens the side panel instead.
 * - Filling: auto-advance, off; the final Submit is never pressed.
 * - Consent boxes: the core's closed list of categories, all off; certify carries a warning. Nothing outside the list
 *   can be pre-approved, so AI attestations and unrecognised consent never appear.
 * - AI help: pick (on), classify (on), drafts (off), with the plan's sentence on what never goes to the AI.
 * - Interpretations: both off, each saying what it does and that the field stays flagged.
 * - Your fixes: the offer to save an answer after the person fixed a flagged field (Requirement F), on by default.
 * - Anonymous counters (Phase 6): the opt-in, off, listing the five fields counted and nothing else; the counts kept in
 *   this browser (telemetry/get), exported as a JSON file through an <a download> link (the page builds it from what it
 *   read: nothing is sent), and cleared (telemetry/clear).
 * - Saved runs: Clear (runs/clear), showing how many went.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatConnectCode, normalizeConnectCode } from '../../contract/tailorit/connect';
import { CONSENT_CATEGORIES } from '../../core/enums';
import { TELEMETRY_FIELDS } from '../../core/telemetry/events';
import type { TelemetryCount } from '../../core/types/telemetry';
import type { Settings } from '../../core/types/settings';
import type { ErrorCode } from '../../messaging/envelope';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { LogoMark, Wordmark } from '../brand/Logo';
import { request } from '../page/request';
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
      <SettingsCards settings={settings} />
      <Counters platform={platform} settings={settings} />
      <SavedRuns platform={platform} />
      {settings.note !== null && <p className="tia-save-note" role="status">{settings.note}</p>}
    </main>
  );
}

/** One titled card of the page. */
function Card({ title, children, name }: { title: string; children: ReactNode; name: string }) {
  const id = useId();
  return (
    <section className="tia-card" aria-labelledby={id} data-card={name}>
      <h2 className="tia-card__title" id={id}>{title}</h2>
      {children}
    </section>
  );
}

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
        <label htmlFor={id} className="tia-field__name">{name}</label>
        {help && <p className="tia-help" id={`${id}-help`}>{help}</p>}
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
              <p className="tia-help">
                {status.scopes.includes('profile:sensitive') ? TEXT.connection.sensitiveShared : TEXT.connection.sensitiveNotShared}
              </p>
              {status.expiresAt !== null && (
                <p className="tia-help">
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
                <label htmlFor={codeId} className="tia-field__name">{TEXT.connection.codeLabel}</label>
                <input id={codeId} className="tia-code__input" value={code} maxLength={24} autoComplete="off" spellCheck={false}
                  aria-describedby={`${codeId}-help`} disabled={working} onChange={(event) => setCode(event.target.value)} />
                <p className="tia-help" id={`${codeId}-help`}>{TEXT.connection.codeHelp}</p>
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

function SettingsCards({ settings }: { settings: SettingsState }) {
  const { shown, saving, failed, save } = settings;
  if (shown === null) return <p className={failed ? 'tia-error' : 'tia-note'}>{failed ? TEXT.unreadable : TEXT.loading}</p>;
  const set = (patch: Partial<Settings>) => save({ ...shown, ...patch });
  return (
    <>
      <Card title={TEXT.panel.heading} name="panel">
        <fieldset className="tia-fieldset">
          <legend className="tia-help">{TEXT.panel.intro}</legend>
          {(['side', 'in-page'] as const).map((placement) => (
            <PlacementChoice key={placement} placement={placement} checked={shown.panel === placement} disabled={saving}
              onChoose={() => set({ panel: placement })} />
          ))}
        </fieldset>
        <p className="tia-help">{TEXT.panel.inPageHelp}</p>
      </Card>

      <Card title={TEXT.filling.heading} name="filling">
        <Toggle setting="autoAdvance" name={TEXT.filling.autoAdvance} help={TEXT.filling.autoAdvanceHelp}
          checked={shown.autoAdvance} disabled={saving} onChange={(autoAdvance) => set({ autoAdvance })} />
      </Card>

      <Card title={TEXT.consent.heading} name="consent">
        <p className="tia-help">{TEXT.consent.intro}</p>
        {CONSENT_CATEGORIES.map((category) => (
          <Toggle key={category} setting={`consent.${category}`} name={TEXT.consent.categories[category].name}
            help={TEXT.consent.categories[category].help} checked={shown.preapprovedConsent.includes(category)} disabled={saving}
            onChange={(checked) => set({
              preapprovedConsent: CONSENT_CATEGORIES.filter((each) =>
                (each === category ? checked : shown.preapprovedConsent.includes(each))),
            })}>
            {category === 'certify' && <p className="tia-warning" data-warning="certify">{TEXT.consent.certifyWarning}</p>}
          </Toggle>
        ))}
        <p className="tia-help">{TEXT.consent.never}</p>
      </Card>

      <Card title={TEXT.ai.heading} name="ai">
        <p className="tia-help">{TEXT.ai.intro}</p>
        <Toggle setting="llm.tiebreak" name={TEXT.ai.tiebreak} help={TEXT.ai.tiebreakHelp} checked={shown.llm.tiebreak}
          disabled={saving} onChange={(tiebreak) => set({ llm: { ...shown.llm, tiebreak } })} />
        <Toggle setting="llm.classify" name={TEXT.ai.classify} help={TEXT.ai.classifyHelp} checked={shown.llm.classify}
          disabled={saving} onChange={(classify) => set({ llm: { ...shown.llm, classify } })} />
        <Toggle setting="llm.drafts" name={TEXT.ai.drafts} help={TEXT.ai.draftsHelp} checked={shown.llm.drafts}
          disabled={saving} onChange={(drafts) => set({ llm: { ...shown.llm, drafts } })} />
        <p className="tia-note" data-ai-never="">{TEXT.ai.never}</p>
      </Card>

      <Card title={TEXT.answers.heading} name="answers">
        <Toggle setting="offerToSaveAnswers" name={TEXT.answers.offer} help={TEXT.answers.offerHelp}
          checked={shown.offerToSaveAnswers} disabled={saving} onChange={(offerToSaveAnswers) => set({ offerToSaveAnswers })} />
      </Card>

      <Card title={TEXT.interpretations.heading} name="interpretations">
        <p className="tia-help">{TEXT.interpretations.intro}</p>
        <Toggle setting="interpretations.postingCountryForLegal" name={TEXT.interpretations.postingCountryForLegal}
          help={TEXT.interpretations.postingCountryForLegalHelp} checked={shown.interpretations.postingCountryForLegal}
          disabled={saving}
          onChange={(postingCountryForLegal) => set({ interpretations: { ...shown.interpretations, postingCountryForLegal } })} />
        <Toggle setting="interpretations.twoOrMoreRaces" name={TEXT.interpretations.twoOrMoreRaces}
          help={TEXT.interpretations.twoOrMoreRacesHelp} checked={shown.interpretations.twoOrMoreRaces} disabled={saving}
          onChange={(twoOrMoreRaces) => set({ interpretations: { ...shown.interpretations, twoOrMoreRaces } })} />
      </Card>
    </>
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
    <Card title={COUNTERS.heading} name="telemetry">
      <p className="tia-help">{COUNTERS.intro}</p>
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
    <Card title={TEXT.data.heading} name="runs">
      <p className="tia-help">{TEXT.data.intro}</p>
      <div className="tia-row-of-buttons">
        <button type="button" className="tia-button" disabled={working} onClick={() => void clear()}>{TEXT.data.clear}</button>
        {result !== null && <span className="tia-note" role="status">{result}</span>}
      </div>
    </Card>
  );
}
