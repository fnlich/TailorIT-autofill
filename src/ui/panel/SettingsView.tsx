/*
 * v4 ui: the side panel's Settings view (the owner, 2026-11-07: "If setting is clicked, only show setting. so back
 * button will be needed to back to main. setting includes Autofill information"; Jobright's screenshot 5, in TailorIT's
 * words and teal). It replaces everything under the panel's head: a round ✕ and "Settings" (back to the main view),
 * then the modes as radio-card groups, each title with a "?" holding its explanation (src/ui/page/modes.tsx, the same
 * groups the options page draws), then "Autofill information" (the profile editor; its Back returns here), the account
 * ("Connected as …") and "All settings" (the options page), and a full-width Save pinned at the bottom.
 *
 * The choices are a draft until Save: Save is grey until something changed, and saves with settings/save {settings,
 * base}, `base` being the settings this view last read (the audit's M4: the worker applies only the change, so a change
 * made meanwhile elsewhere is kept). What the worker stored is shown after. ✕ discards an unsaved change. Settings the
 * worker says changed elsewhere while nothing here is changed are shown at once.
 * v1.4 F (PLAN decision 18): "Documents" after the modes, the templates a tailored resume and its letter are written on
 * (ui/page/documents.tsx), with a Save of their own: they are the TailorIT profile's, not this browser's settings.
 * v1.5 QX (PLAN decision 10; the owner, 2026-11-10: "settings order: all settings(top right), connected status,
 * Autofill Information, Documents templates, queue settings, autofill settings"): "All Settings" at the head's right;
 * then the connection ("Connected as …", or not connected); "Autofill Information"; Documents; Queue Settings (the
 * sequential auto-apply's, ui/page/modes.tsx QueueFields); Autofill Settings (the modes). The queue's and the modes'
 * choices are one draft, saved together with Save; each radio group's cards side by side, two to a row.
 */
import { useId, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import type { AuthStatus } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { DocumentsFields, documentsKeyOf } from '../page/documents';
import { ModesFields, QueueFields, signInAvailability } from '../page/modes';
import { request } from '../page/request';

const WORDS = COPY.settingsView;

/** Whether two settings say the same. */
const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

export interface SettingsViewProps {
  platform: PagePlatform;
  /** The settings as the panel last read them (null: not read yet). */
  settings: Settings | null;
  status: AuthStatus | null;
  /** ✕: back to the main view, an unsaved change dropped. */
  onClose(): void;
  /** What the worker stored after a Save. */
  onSaved(settings: Settings): void;
  /** "Autofill information": the profile editor. */
  onAutofillInfo(): void;
  /** The options page. */
  settingsUrl: string;
}

export function SettingsView({ platform, settings, status, onClose, onSaved, onAutofillInfo, settingsUrl }: SettingsViewProps) {
  const headingId = useId();
  /** What this view last read or saved (the save's base), and the person's draft over it. */
  const [base, setBase] = useState<Settings | null>(settings);
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirty = base !== null && draft !== null && !same(base, draft);

  // The panel read the settings (first, or again after a change elsewhere): shown at once while nothing is changed
  // here; a draft in progress keeps its base, so its Save applies only its own change. (React's pattern for state that
  // follows a prop: adjusted while rendering, once per new read.)
  const [seen, setSeen] = useState(settings);
  if (settings !== seen) {
    setSeen(settings);
    if (settings !== null && (base === null || draft === null || same(base, draft))) {
      setBase(settings);
      setDraft(settings);
    }
  }

  const save = async () => {
    if (draft === null || base === null || !dirty) return;
    setSaving(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'settings/save', settings: draft, base });
    setSaving(false);
    if (answer.ok) {
      setBase(answer.data.settings);
      setDraft(answer.data.settings);
      setNote(WORDS.saved);
      onSaved(answer.data.settings);
    } else {
      setNote(WORDS.notSaved);
    }
  };

  const connected = status?.connection === 'connected';
  const account = status?.connection === 'connected'
    ? status.account ? COPY.panel.connectedAs(status.account.name) : COPY.panel.connected : WORDS.notConnected;
  const change = (next: Settings) => {
    setNote(null);
    setDraft(next);
  };

  return (
    <section className="tia-settings" aria-labelledby={headingId} data-settings-view="">
      <div className="tia-settings__head">
        <button type="button" className="tia-roundbutton" aria-label={WORDS.close} title={WORDS.close}
          data-action="close-settings" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
        <h2 className="tia-settings__heading" id={headingId}>{WORDS.heading}</h2>
        {/* v1.5 QX: 1. All Settings, top right. */}
        <a className="tia-settings__all" href={settingsUrl} target="_blank" rel="noreferrer" data-open-settings="">
          {WORDS.allSettings}
          <Icon name="chevron-right" size={16} />
        </a>
      </div>
      <div className="tia-settings__body">
        {/* 2. The connection. */}
        <p className={connected ? 'tia-connection' : 'tia-connection tia-connection--off'}
          data-connection={connected ? 'connected' : 'not-connected'} data-settings-section="connection">{account}</p>
        {/* 3. Autofill Information. */}
        <div className="tia-settings__links" data-settings-section="autofill-info">
          <button type="button" className="tia-linkrow" data-open-profile="" onClick={onAutofillInfo}>
            <Icon name="person" size={18} className="tia-icon tia-linkrow__icon" />
            <span className="tia-linkrow__label">{WORDS.autofillInfo}</span>
            <Icon name="chevron-right" size={16} className="tia-icon tia-linkrow__chevron" />
          </button>
        </div>
        {/* 4. Documents: v1.4 F, the profile's templates, saved on their own. */}
        <section className="tia-settings__documents tia-settings__section" data-settings-documents=""
          data-settings-section="documents">
          <h3 className="tia-card__title">{COPY.documents.title}</h3>
          <DocumentsFields platform={platform} readKey={documentsKeyOf(status)} />
        </section>
        {draft === null ? <p className="tia-note" role="status">{WORDS.loading}</p> : (
          <>
            {/* 5. Queue Settings (v1.5 QX). */}
            <section className="tia-settings__section" data-settings-section="queue" aria-labelledby={`${headingId}-queue`}>
              <h3 className="tia-card__title" id={`${headingId}-queue`}>{WORDS.queue}</h3>
              <QueueFields settings={draft} disabled={saving} idPrefix="panel" onChange={change} />
            </section>
            {/* 6. Autofill Settings: the modes. */}
            <section className="tia-settings__section" data-settings-section="autofill"
              aria-labelledby={`${headingId}-autofill`}>
              <h3 className="tia-card__title" id={`${headingId}-autofill`}>{WORDS.autofill}</h3>
              <ModesFields settings={draft} disabled={saving} idPrefix="panel" signIn={signInAvailability(status)}
                stored={base} onChange={change} />
            </section>
          </>
        )}
      </div>
      <div className="tia-settings__foot">
        {note !== null && <p className="tia-settings__note" role="status">{note}</p>}
        <button type="button" className="tia-cta tia-settings__save" disabled={!dirty || saving} data-action="save-settings"
          onClick={() => void save()}>
          {saving && <Icon name="spinner" size={18} className="tia-icon tia-spin" />}
          {saving ? WORDS.saving : WORDS.save}
        </button>
      </div>
    </section>
  );
}
