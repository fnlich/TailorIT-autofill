/*
 * v4 ui: the side panel's set-up view (the owner, 2026-11-07: "If extension is not logged in, show (1. Setup TailorIT
 * account, 2. Complete the profile details). If profile is not completed, only show Complete the profile details";
 * Jobright's screenshot 1, in TailorIT's words and teal). Centred: a bolt, "Autofill with TailorIT", one line, then the
 * steps as cards, each with a teal tick pill when done or a dark GO pill, and a "?" holding its explanation:
 *
 * 1. "Set up your TailorIT account" (only while the view was entered not connected): GO first shows what connecting
 *    means (the first-run disclosure, docs/PRIVACY.md, which the options page shows above its Connect: "Choosing
 *    Connect means you agree to this"), then its Connect starts pairing (auth/startPairing, as the options page's does:
 *    TailorIT's connect page opens, where a person without an account signs up). While the pairing waits, the pill reads
 *    "Waiting…" and a link opens the options page's connect section for the typed code. An expired or revoked
 *    connection shows GO again, the reason in the step's "?".
 * 2. "Complete your profile details": GO opens the profile editor (the panel's, Profile.tsx); its "?" lists what is
 *    missing. GO waits for step 1.
 *
 * Then "Start applying", grey until both are done (or, once connected, the profile could not be read: the v4 review,
 * M-L6, nothing locks the person out); it opens the main view. The panel decides when this view shows
 * (Panel.tsx). No gear here (Jobright has none). It shows no value: the account's name only, in the done step's "?".
 */
import { useId, useState } from 'react';
import type { AuthStatus } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { clockText, useSecondsLeft } from '../options/countdown';
import { animationFrames, type FrameScheduler } from '../page/frames';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import type { ProfileCheck } from './profile-check';

const WORDS = COPY.setup;

export interface SetupViewProps {
  platform: PagePlatform;
  status: AuthStatus;
  /** auth/status read again (after Connect). */
  refresh(): void;
  profile: ProfileCheck;
  /** Whether step 1 shows: the set-up view was entered not connected (the panel keeps it across the editor), so both
   *  steps stay, ticked, once done. */
  withAccount: boolean;
  /** GO on step 2: the profile editor. */
  onEditProfile(): void;
  /** Start applying: the main view. */
  onStart(): void;
  /** The options page, for the typed code. */
  settingsUrl: string;
  now: () => number;
  frames?: FrameScheduler;
}

export function SetupView({ platform, status, refresh, profile, withAccount, onEditProfile, onStart, settingsUrl, now,
  frames = animationFrames }: SetupViewProps) {
  const headingId = useId();
  const consentId = useId();
  const connected = status.connection === 'connected';
  const [consent, setConsent] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const pairingUntil = connected ? null : status.pairingExpiresAt;
  const left = useSecondsLeft(pairingUntil, now, frames);
  const waiting = pairingUntil !== null && (left === null ? pairingUntil > now() : left > 0);
  const profileDone = connected && profile.state === 'read' && profile.gaps.length === 0;
  // The v4 review (M-L6): a profile that could not be read never locks the person out (the fill reads it itself), here
  // either: once connected, Start applying opens, step 2 still a GO whose "?" says it could not be read.
  const unreadable = connected && profile.state === 'unreadable';
  const ready = connected && (profileDone || unreadable);

  const connect = async () => {
    setConnecting(true);
    setFailed(false);
    const answer = await request(platform, { v: 1, type: 'auth/startPairing' });
    setConnecting(false);
    if (!answer.ok) setFailed(true);
    else setConsent(false);
    // The status now holds the pending pairing.
    refresh();
  };

  const accountHelp = connected ? WORDS.accountDone(status.account?.name ?? null)
    : status.connection === 'expired' ? `${WORDS.accountHelp} ${WORDS.accountExpired}`
      : status.connection === 'revoked' ? `${WORDS.accountHelp} ${WORDS.accountRevoked}` : WORDS.accountHelp;
  const missing = profile.state === 'read' ? profile.gaps.map((gap) => WORDS.gaps[gap]) : [];
  const profileHelp = profileDone ? WORDS.profileDone : unreadable ? `${WORDS.profileHelp} ${WORDS.profileUnreadable}`
    : missing.length > 0 ? `${WORDS.profileHelp} ${WORDS.profileMissing(missing)}` : WORDS.profileHelp;

  return (
    <section className="tia-setup" aria-labelledby={headingId} data-setup="">
      <Icon name="bolt" size={44} className="tia-icon tia-setup__bolt" />
      <h2 className="tia-setup__heading" id={headingId}>{WORDS.heading}</h2>
      <p className="tia-setup__intro">{WORDS.intro}</p>
      <ol className="tia-setup__steps" aria-label={WORDS.steps}>
        {withAccount && (
          <li className="tia-step" data-step="account" data-step-state={connected ? 'done' : waiting ? 'waiting' : 'go'}>
            <div className="tia-step__row">
              <span className="tia-step__number" aria-hidden="true">1</span>
              <span className="tia-step__name">{WORDS.account}</span>
              <HelpTip text={accountHelp} topic={WORDS.account} />
              {connected ? <DonePill step={WORDS.account} /> : waiting ? (
                <span className="tia-step__pill tia-step__pill--waiting" role="status"
                  aria-label={WORDS.waitingLabel(WORDS.account)}>{WORDS.waiting}</span>
              ) : (
                <button type="button" className="tia-step__pill tia-step__pill--go" aria-label={WORDS.goLabel(WORDS.account)}
                  aria-expanded={consent} aria-controls={consentId} data-step-action="account" disabled={connecting}
                  onClick={() => setConsent((open) => !open)}>{WORDS.go}</button>
              )}
            </div>
            {!connected && consent && !waiting && (
              <div className="tia-consent" id={consentId} data-consent="">
                <h3 className="tia-consent__heading">{COPY.options.connection.disclosureHeading}</h3>
                <div className="tia-consent__text" tabIndex={0} role="region"
                  aria-label={COPY.options.connection.disclosureHeading}>
                  {COPY.options.connection.disclosure.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
                </div>
                <p className="tia-consent__line">{COPY.options.connection.consentLine}</p>
                <div className="tia-consent__actions">
                  <button type="button" className="tia-button tia-button--primary" data-step-action="connect"
                    disabled={connecting} onClick={() => void connect()}>{COPY.options.connection.connect}</button>
                  <button type="button" className="tia-button tia-button--quiet" onClick={() => setConsent(false)}>
                    {WORDS.notNow}
                  </button>
                </div>
              </div>
            )}
            {!connected && waiting && (
              <p className="tia-step__more">
                {left !== null && left > 0 && <span>{COPY.options.connection.endsIn(clockText(left))}</span>}
                <a href={`${settingsUrl}#settings-connection`} target="_blank" rel="noreferrer" data-open-settings="connect">
                  {WORDS.typeCode}
                </a>
              </p>
            )}
          </li>
        )}
        <li className="tia-step" data-step="profile" data-step-state={profileDone ? 'done' : 'go'}>
          <div className="tia-step__row">
            <span className="tia-step__number" aria-hidden="true">{withAccount ? 2 : 1}</span>
            <span className="tia-step__name">{WORDS.profile}</span>
            <HelpTip text={profileHelp} topic={WORDS.profile} />
            {profileDone ? <DonePill step={WORDS.profile} /> : (
              <button type="button" className="tia-step__pill tia-step__pill--go" aria-label={WORDS.goLabel(WORDS.profile)}
                data-step-action="profile" disabled={!connected} onClick={onEditProfile}>{WORDS.go}</button>
            )}
          </div>
        </li>
      </ol>
      {failed && <p className="tia-feedback" role="status">{COPY.options.connection.openFailed}</p>}
      <button type="button" className="tia-cta tia-setup__start" disabled={!ready} data-action="start-applying"
        onClick={onStart}>{WORDS.start}</button>
    </section>
  );
}

/** A done step's teal pill with its tick. */
function DonePill({ step }: { step: string }) {
  return (
    <span className="tia-step__pill tia-step__pill--done" role="img" aria-label={WORDS.doneLabel(step)}>
      <Icon name="tick" size={16} className="tia-icon" />
    </span>
  );
}
