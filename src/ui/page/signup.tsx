/*
 * jr6, Settings › Sign-up Information (the owner's words of 2026-11-10: "user can set and manage the password on
 * extension settings"; "password should be stronger (16 letter above, include special, and uppercase letter so that can
 * pass on myworkday)"; Jobright's own name for the card, read for behaviour only): the email and the password TailorIT
 * Autofill types into the job sites' own sign-in and create-account forms. Drawn on the extension's own pages alone: the
 * options page's card and Chrome's side panel's Settings view (given through ui/page/signup-slot.ts). Never in the
 * sidebar on the page, whose page process hears what is typed: the sidebar shows whether one is saved and links here.
 * - The email box starts with the one saved, else the profile's (signup/status's suggestedEmail: the TailorIT profile's,
 *   read for it by the worker, else the account's), else the account's as this page read it (AuthStatus), and can be
 *   changed.
 * - The password box is empty and masked: a saved password is never sent to any page, this one included (it is
 *   decrypted in the worker alone, for the moment a job site's form is filled), so "Saved" shows in its place. Show and
 *   Hide reveal what is typed here, or the one "Generate strong password" made (20 characters, crypto.getRandomValues:
 *   core/signup-password.ts), which shows at once so the person can note it, and is masked again (the jr6 review below).
 * - The checklist follows the rules as the password is typed (core/signup-password.ts); Save is offered once every one
 *   is met (or, with a password saved, for a changed email alone, the password kept). The worker checks them again.
 * - Delete asks first (accounts made with the password then need the site's "Forgot password"); Sign-in on Auto goes
 *   back to Manual with it, which the note says.
 * - "Import from TailorIT", while none is saved here and the connection may read job-site sign-ins: once.
 * Nothing here logs, keeps or copies the password: it lives in this component's state until Save sends it to the worker
 * (signup/save) and the box is emptied.
 * The jr6 review:
 * - R15: the status is read again whenever the worker says it changed (panel/changed {what: 'signup'}, on a port of the
 *   card's own: a save, a delete or an import on another page, a password that could no longer be read), and a first
 *   read that fails is tried once more.
 * - sec-8: what Show reveals (a generated password included) is masked again REMASK_MS later, and at once when the page
 *   is hidden or loses the focus (a side panel stays open across tabs and screen shares).
 * - R6: that a saved password is not shown again is said beside Save; R12: what the worker did by itself (`notice`).
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  generateSignupPassword, SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_RULES, signupPasswordChecks, signupPasswordValid,
  type RandomBytes,
} from '../../core/signup-password';
import { PanelPortMessageSchema } from '../../messaging/page-schemas';
import type { SignupStatus } from '../../messaging/schemas';
import { Icon } from '../brand/Icon';
import { adoptStyles } from '../report/styles';
import { afterFrames, animationFrames } from './frames';
import { request } from './request';
import { SIGNUP_COPY as WORDS } from './signup-copy';
import type { SignUpFieldsProps } from './signup-slot';

/** The card's few lines of its own (the pages' styles hold the rest), applied where it is drawn. */
export const SIGNUP_CSS = `
.tia-signup { display: grid; gap: 10px; }
.tia-signup__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tia-signup__row .tia-input { flex: 1 1 14em; min-width: 0; }
.tia-signup__rules { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
.tia-signup__rule { display: flex; align-items: center; gap: 6px; color: var(--tia-muted); }
.tia-signup__rule[data-met="true"] { color: var(--tia-fg); }
.tia-signup__rule[data-met="true"] .tia-icon { color: var(--tia-ink); }
.tia-signup__status { margin: 0; font-size: 13px; }
.tia-signup__confirm { display: grid; gap: 8px; padding: 10px 12px; border-radius: var(--tia-r-control);
  background: var(--tia-tone-warning-bg); color: var(--tia-tone-warning-fg); font-size: 13px; }
`;

/** The browser's own randomness (an extension page's crypto.getRandomValues). */
const browserRandom: RandomBytes = (count) => globalThis.crypto.getRandomValues(new Uint8Array(count));

/** The jr6 review (sec-8): how long what Show reveals stays shown. */
export const REMASK_MS = 30_000;

/** An email the box may save; the worker checks it again. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Note = { text: string; error: boolean };

/** When a password was saved, as the status line says it. */
const whenOf = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The fields as the side panel's page gives them to the Settings view (ui/page/signup-slot.ts). */
export const renderSignUpFields = (props: SignUpFieldsProps) => <SignUpFields {...props} />;

export function SignUpFields({ platform, onChanged, accountEmail = null, random = browserRandom, remaskMs = REMASK_MS }:
  SignUpFieldsProps & {
    /** Tests pass their own bytes; the pages use the browser's. */
    random?: RandomBytes;
    /** Tests pass a shorter one (REMASK_MS). */
    remaskMs?: number;
  }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SignupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  /** The jr6 review (R15): bumped each time the worker says Sign-up Information changed: the status is read again. */
  const [changes, setChanges] = useState(0);
  /** What the person typed in the email box (null: untouched, the saved or suggested one shows). */
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    const root = box.current?.getRootNode();
    if (root !== undefined) adoptStyles(root, SIGNUP_CSS);
  }, []);

  // The status, read at first and again on each change the worker tells of (R15): a read that fails is tried once more.
  useEffect(() => {
    let live = true;
    const read = (again: boolean) => {
      void request(platform, { v: 1, type: 'signup/status' }).then((answer) => {
        if (!live) return;
        if (answer.ok) {
          setStatus(answer.data);
          setFailed(false);
        } else if (again) read(false);
        else setFailed(true);
      });
    };
    read(true);
    return () => {
      live = false;
    };
  }, [platform, changes]);

  // The jr6 review (R15): the worker's word that Sign-up Information changed (panel/changed {what: 'signup'}).
  useEffect(() => {
    let port: ReturnType<typeof platform.runtime.connect>;
    try {
      port = platform.runtime.connect('panel');
    } catch {
      return undefined;
    }
    const stop = port.onMessage((raw) => {
      const parsed = PanelPortMessageSchema.safeParse(raw);
      if (parsed.success && parsed.data.type === 'panel/changed' && parsed.data.what === 'signup') {
        setChanges((count) => count + 1);
      }
    });
    return () => {
      stop();
      try {
        port.disconnect();
      } catch {
        // Gone already.
      }
    };
  }, [platform]);

  // The jr6 review (sec-8): what Show reveals is masked again after remaskMs, or once the page is hidden or blurred.
  useEffect(() => {
    if (!shown) return undefined;
    const doc = box.current?.ownerDocument ?? null;
    const view = doc?.defaultView ?? null;
    const mask = () => setShown(false);
    const onVisibility = () => {
      if (doc?.visibilityState !== 'visible') mask();
    };
    // The pages' one way to wait (ui/page/frames.ts): frames run only while the page shows, and a hidden one is masked.
    const stop = afterFrames(remaskMs, mask, () => Date.now(), animationFrames);
    view?.addEventListener('blur', mask);
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      view?.removeEventListener('blur', mask);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }, [shown, remaskMs]);

  const email = typedEmail ?? status?.email ?? status?.suggestedEmail ?? (status === null ? null : accountEmail) ?? '';
  const checks = signupPasswordChecks(password);
  const emailOk = EMAIL.test(email) && email.length <= 254;
  const canSave = status !== null && !busy && emailOk
    && (password !== '' ? signupPasswordValid(password) : status.set && email !== status.email);

  /** A worker's answer taken: the status shown, the boxes emptied, the page told. */
  const took = (next: SignupStatus, said: Note) => {
    setStatus(next);
    setTypedEmail(null);
    setPassword('');
    setShown(false);
    setNote(said);
    onChanged?.();
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'signup/save', email,
      ...(password === '' ? {} : { password }) });
    setBusy(false);
    if (answer.ok) took(answer.data, { text: WORDS.saved, error: false });
    else setNote({ text: WORDS.notSaved, error: true });
  };

  const remove = async () => {
    setBusy(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'signup/delete' });
    setBusy(false);
    setConfirming(false);
    if (answer.ok) took(answer.data.status, { text: answer.data.reverted ? WORDS.reverted : WORDS.removed, error: false });
    else setNote({ text: WORDS.notSaved, error: true });
  };

  const importNow = async () => {
    setBusy(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'signup/import' });
    setBusy(false);
    if (!answer.ok) {
      setNote({ text: WORDS.importFailed, error: true });
      return;
    }
    const { outcome } = answer.data;
    if (outcome === 'imported') took(answer.data.status, { text: WORDS.imported, error: false });
    else {
      setStatus(answer.data.status);
      setNote({ text: outcome === 'weak' ? WORDS.importWeak : WORDS.importNone, error: outcome === 'weak' });
    }
  };

  const generate = () => {
    setPassword(generateSignupPassword(random));
    setShown(true);
    setNote({ text: WORDS.generated, error: false });
  };

  if (failed) return <p className="tia-error" data-signup="" role="alert">{WORDS.unreadable}</p>;
  return (
    <div className="tia-signup" ref={box} data-signup="" data-signup-state={status === null ? 'loading'
      : status.set ? 'set' : 'not-set'}>
      <p className="tia-signup__status" data-signup-status="">
        {status === null ? '' : status.set && status.updatedAt !== null ? WORDS.setOn(whenOf(status.updatedAt))
          : WORDS.notSet}
      </p>
      {/* The jr6 review (R12): what the worker did by itself since the person last saved or deleted one. */}
      {status?.notice !== undefined && (
        <p className="tia-note" role="status" data-signup-notice={status.notice}>{WORDS.notices[status.notice]}</p>
      )}
      <div className="tia-docfield">
        <label className="tia-docfield__label" htmlFor={`${id}-email`}>{WORDS.email}</label>
        <input id={`${id}-email`} className="tia-input" type="email" autoComplete="off" spellCheck={false}
          data-signup-email="" value={email} disabled={busy || status === null} maxLength={254}
          onChange={(event) => {
            setNote(null);
            setTypedEmail(event.target.value);
          }} />
      </div>
      <div className="tia-docfield">
        <label className="tia-docfield__label" htmlFor={`${id}-password`}>{WORDS.password}</label>
        <div className="tia-signup__row">
          <input id={`${id}-password`} className="tia-input" type={shown ? 'text' : 'password'} autoComplete="new-password"
            spellCheck={false} autoCapitalize="off" data-signup-password="" value={password} maxLength={SIGNUP_PASSWORD_MAX}
            placeholder={status?.set === true ? WORDS.passwordSaved : ''} aria-describedby={`${id}-rules`}
            disabled={busy || status === null} onChange={(event) => {
              setNote(null);
              setPassword(event.target.value);
            }} />
          <button type="button" className="tia-button" data-action="signup-show" aria-pressed={shown}
            aria-label={shown ? WORDS.hideLabel : WORDS.showLabel} disabled={password === ''}
            onClick={() => setShown(!shown)}>
            <Icon name="eye" size={16} />
            {shown ? WORDS.hide : WORDS.show}
          </button>
        </div>
      </div>
      <button type="button" className="tia-linkbutton" data-action="signup-generate" disabled={busy || status === null}
        onClick={generate}>
        {WORDS.generate}
      </button>
      <div id={`${id}-rules`}>
        <p className="tia-docfield__label">{WORDS.rulesHeading}</p>
        <ul className="tia-signup__rules" data-signup-rules="">
          {SIGNUP_PASSWORD_RULES.map((rule) => (
            <li key={rule} className="tia-signup__rule" data-rule={rule} data-met={String(password !== '' && checks[rule])}>
              <Icon name={password !== '' && checks[rule] ? 'check' : 'circle'} size={14} />
              <span>{WORDS.rules[rule]}</span>
              <span className="tia-visually-hidden">{password !== '' && checks[rule] ? WORDS.met : WORDS.unmet}</span>
            </li>
          ))}
        </ul>
      </div>
      {status?.importable === true && (
        <p className="tia-note" data-signup-import="">
          {WORDS.importOffer}{' '}
          <button type="button" className="tia-linkbutton" data-action="signup-import" disabled={busy} onClick={() => void importNow()}>
            {WORDS.importButton}
          </button>
        </p>
      )}
      {confirming ? (
        <div className="tia-signup__confirm" role="alertdialog" aria-label={WORDS.remove} data-signup-confirm="">
          <span>{WORDS.removeConfirm}</span>
          <div className="tia-signup__row">
            <button type="button" className="tia-button" data-action="signup-delete-confirm" disabled={busy}
              onClick={() => void remove()}>{WORDS.removeYes}</button>
            <button type="button" className="tia-button" data-action="signup-delete-cancel" disabled={busy}
              onClick={() => setConfirming(false)}>{WORDS.removeNo}</button>
          </div>
        </div>
      ) : (
        <>
          {/* The jr6 review (R6): said beside Save, not only in the card's "?". */}
          <p className="tia-note" data-signup-once="">{WORDS.notShownAgain}</p>
          <div className="tia-signup__row">
            <button type="button" className="tia-button tia-button--primary" data-action="signup-save" disabled={!canSave}
              onClick={() => void save()}>
              {busy && <Icon name="spinner" size={16} className="tia-icon tia-spin" />}
              {busy ? WORDS.saving : WORDS.save}
            </button>
            {status?.set === true && (
              <button type="button" className="tia-button" data-action="signup-delete" disabled={busy}
                onClick={() => setConfirming(true)}>{WORDS.remove}</button>
            )}
          </div>
        </>
      )}
      {note !== null && (
        <p className={note.error ? 'tia-error' : 'tia-note'} role="status" data-signup-note="">{note.text}</p>
      )}
    </div>
  );
}
