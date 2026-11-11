/*
 * jr6, Settings › Sign-up Information (the owner's words of 2026-11-10: "user can set and manage the password on
 * extension settings"; "password should be stronger (16 letter above, include special, and uppercase letter so that can
 * pass on myworkday)"; Jobright's own name for the card, read for behaviour only): the email and the password TailorIT
 * Autofill types into the job sites' own sign-in and create-account forms. Drawn on the extension's own pages alone: the
 * options page's card and Chrome's side panel's Settings view (given through ui/page/signup-slot.ts). Never in the
 * sidebar on the page, whose page process hears what is typed: the sidebar shows whether one is saved and links here.
 * - The email box starts with the one saved, else the profile's (signup/status's suggestedEmail: the profile's as the
 *   worker holds it, else the account's), else the account's as this page read it (AuthStatus), and can be changed.
 * - The password box is empty and masked: a saved password is never sent to any page, this one included (it is
 *   decrypted in the worker alone, for the moment a job site's form is filled), so "Saved" shows in its place. Show and
 *   Hide reveal what is typed here, or the one "Generate strong password" made (20 characters, crypto.getRandomValues:
 *   core/signup-password.ts), which shows at once so the person can note it.
 * - The checklist follows the rules as the password is typed (core/signup-password.ts); Save is offered once every one
 *   is met (or, with a password saved, for a changed email alone, the password kept). The worker checks them again.
 * - Delete asks first (accounts made with the password then need the site's "Forgot password"); Sign-in on Auto goes
 *   back to Manual with it, which the note says.
 * - "Import from TailorIT", while none is saved here and the connection may read job-site sign-ins: once.
 * Nothing here logs, keeps or copies the password: it lives in this component's state until Save sends it to the worker
 * (signup/save) and the box is emptied.
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  generateSignupPassword, SIGNUP_PASSWORD_MAX, SIGNUP_PASSWORD_RULES, signupPasswordChecks, signupPasswordValid,
  type RandomBytes,
} from '../../core/signup-password';
import type { SignupStatus } from '../../messaging/schemas';
import { Icon } from '../brand/Icon';
import { adoptStyles } from '../report/styles';
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

/** An email the box may save; the worker checks it again. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Note = { text: string; error: boolean };

/** When a password was saved, as the status line says it. */
const whenOf = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The fields as the side panel's page gives them to the Settings view (ui/page/signup-slot.ts). */
export const renderSignUpFields = (props: SignUpFieldsProps) => <SignUpFields {...props} />;

export function SignUpFields({ platform, onChanged, accountEmail = null, random = browserRandom }: SignUpFieldsProps & {
  /** Tests pass their own bytes; the pages use the browser's. */
  random?: RandomBytes;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SignupStatus | null>(null);
  const [failed, setFailed] = useState(false);
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

  useEffect(() => {
    let live = true;
    void request(platform, { v: 1, type: 'signup/status' }).then((answer) => {
      if (!live) return;
      if (answer.ok) setStatus(answer.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [platform]);

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
      )}
      {note !== null && (
        <p className={note.error ? 'tia-error' : 'tia-note'} role="status" data-signup-note="">{note.text}</p>
      )}
    </div>
  );
}
