/*
 * v1.4 F (PLAN decision 18, the owner: "User can select resume and coverletter templates on autofill settings"): the
 * templates a tailored resume and its cover letter are written on, kept in the account's autofill profile
 * (`documents.resumeTemplateId`, `documents.coverLetterTemplateId`), so TailorIT's web pages and this extension share
 * them. Drawn in three places: Options' "Documents" card and the side panel's Settings view (DocumentsFields, with its
 * own Save), and the profile editor's Documents section (TemplateField over the editor's own draft and Save).
 *
 * - Reading: panel/documents (the worker: GET /profile and GET /templates, scope profile:read): the two choices and
 *   TailorIT's lists, read again whenever `readKey` (the connection) changes. Not connected, or a connection without
 *   the scope, says so.
 * - The choices: "Resume's own template" (null: the resume tailored keeps its template) then the resume templates;
 *   "No template" (null: TailorIT's own letter layout) then the letter templates, TailorIT's marked. A stored template
 *   TailorIT no longer lists stays a choice, named as such, so nothing changes unasked.
 * - Saving: panel/documents {save} with the two choices alone: the worker changes those two on the profile as TailorIT
 *   holds it now, with its revision, and keeps every other field (profile-editor.ts documents). Save is grey until a
 *   choice changed; a connection without profile:write shows them read-only.
 */
import { useEffect, useId, useState } from 'react';
import type { DocumentsAnswer, TailorKind } from '../../messaging/page-schemas';
import type { AuthStatus, ProfileSaveRefusal } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { request } from './request';

const WORDS = COPY.documents;

/** What the templates are read for: the connection (null: not connected, nothing is asked). */
export function documentsKeyOf(status: AuthStatus | null): string | null {
  return status?.connection === 'connected' ? `${status.expiresAt ?? 0}|${status.scopes.join(',')}` : null;
}

/** What panel/documents answered, once ready. */
export type TemplateLists = Extract<DocumentsAnswer, { outcome: 'ready' }>;

/** The templates as read: reading, refused (why), or ready. */
export type TemplatesState = { kind: 'loading' } | { kind: 'refused'; outcome: ProfileSaveRefusal }
  | { kind: 'ready'; lists: TemplateLists };

/** Reads panel/documents for `readKey` (null: not now), and again on `retry`. */
export function useTemplates(platform: PagePlatform, readKey: string | null): { state: TemplatesState;
  retry(): void; set(lists: TemplateLists): void } {
  const [state, setState] = useState<{ key: string; state: TemplatesState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = readKey === null ? null : `${readKey}|${attempt}`;
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/documents' }).then((answer) => {
      if (!live) return;
      const read: TemplatesState = !answer.ok ? { kind: 'refused', outcome: answer.error === 'not_connected'
        ? 'not-connected' : answer.error === 'rate_limited' ? 'rate-limited' : 'unavailable' }
        : answer.data.outcome === 'ready' ? { kind: 'ready', lists: answer.data }
          : { kind: 'refused', outcome: answer.data.outcome };
      setState({ key, state: read });
    });
    return () => {
      live = false;
    };
  }, [platform, key]);
  return {
    state: readKey === null ? { kind: 'refused', outcome: 'not-connected' }
      : state !== null && state.key === key ? state.state : { kind: 'loading' },
    retry: () => setAttempt((count) => count + 1),
    set: (lists) => setState({ key: key ?? '', state: { kind: 'ready', lists } }),
  };
}

/** A select's choices for `kind` (module header): its "none", TailorIT's list, and a stored one it no longer lists. */
export function templateChoices(kind: TailorKind, lists: Pick<TemplateLists, 'resumeTemplates' | 'coverLetterTemplates'>,
  value: string | null): Array<readonly [string, string]> {
  const listed: Array<readonly [string, string]> = kind === 'resume'
    ? lists.resumeTemplates.map((each) => [each.id, each.name] as const)
    : lists.coverLetterTemplates.map((each) => [each.id, each.isSystem ? WORDS.system(each.name) : each.name] as const);
  const missing = value !== null && !listed.some(([id]) => id === value) ? [[value, WORDS.missing] as const] : [];
  return [['', kind === 'resume' ? WORDS.ownTemplate : WORDS.noTemplate], ...listed, ...missing];
}

/** One template choice: its label, then a native select ('' stands for none). */
export function TemplateField({ kind, value, choices, disabled = false, onChange }: { kind: TailorKind;
  value: string | null; choices: ReadonlyArray<readonly [string, string]>; disabled?: boolean;
  onChange(value: string | null): void }) {
  const id = useId();
  return (
    <div className="tia-docfield" data-template-field={kind}>
      <label className="tia-docfield__label" htmlFor={id}>{kind === 'resume' ? WORDS.resumeTemplate : WORDS.letterTemplate}</label>
      <select id={id} className="tia-docfield__select" value={value ?? ''} disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value === '' ? null : event.currentTarget.value)}>
        {choices.map(([choice, words]) => <option key={choice} value={choice}>{words}</option>)}
      </select>
    </div>
  );
}

/** Options' Documents card's and the Settings view's fields, with their own Save (module header). */
export function DocumentsFields({ platform, readKey }: { platform: PagePlatform; readKey: string | null }) {
  const templates = useTemplates(platform, readKey);
  const [draft, setDraft] = useState<{ from: TemplateLists; resume: string | null; letter: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { state } = templates;
  if (state.kind !== 'ready') {
    return (
      <div className="tia-docfields" data-documents={state.kind === 'loading' ? 'loading' : state.outcome}>
        <p className="tia-note" role="status">{state.kind === 'loading' ? WORDS.loading : WORDS.refusals[state.outcome]}</p>
        {state.kind === 'refused' && state.outcome !== 'not-connected' && (
          <button type="button" className="tia-button" data-documents-retry="" onClick={templates.retry}>{WORDS.tryAgain}</button>
        )}
      </div>
    );
  }
  const { lists } = state;
  // A draft made over an older read starts again from this one.
  const shown = draft !== null && draft.from === lists ? draft
    : { from: lists, resume: lists.resumeTemplateId, letter: lists.coverLetterTemplateId };
  const dirty = shown.resume !== lists.resumeTemplateId || shown.letter !== lists.coverLetterTemplateId;
  const save = async () => {
    setSaving(true);
    setNote(null);
    const answer = await request(platform, { v: 1, type: 'panel/documents',
      save: { resumeTemplateId: shown.resume, coverLetterTemplateId: shown.letter } });
    setSaving(false);
    if (answer.ok && answer.data.outcome === 'ready') {
      templates.set(answer.data);
      setDraft(null);
      setNote(WORDS.saved);
      return;
    }
    setNote(WORDS.refusals[!answer.ok ? (answer.error === 'not_connected' ? 'not-connected'
      : answer.error === 'rate_limited' ? 'rate-limited' : 'unavailable')
      : answer.data.outcome === 'ready' ? 'unavailable' : answer.data.outcome]);
  };
  const edit = (next: Partial<{ resume: string | null; letter: string | null }>) => {
    setNote(null);
    setDraft({ ...shown, ...next });
  };
  return (
    <div className="tia-docfields" data-documents="ready">
      <TemplateField kind="resume" value={shown.resume} choices={templateChoices('resume', lists, shown.resume)}
        disabled={!lists.canWrite || saving} onChange={(resume) => edit({ resume })} />
      <TemplateField kind="coverLetter" value={shown.letter} choices={templateChoices('coverLetter', lists, shown.letter)}
        disabled={!lists.canWrite || saving} onChange={(letter) => edit({ letter })} />
      {!lists.canWrite && <p className="tia-note" data-documents-read-only="">{WORDS.readOnly}</p>}
      {lists.canWrite && (
        <div className="tia-docfields__actions">
          <button type="button" className="tia-button tia-button--primary" data-action="save-documents"
            disabled={!dirty || saving} onClick={() => void save()}>{saving ? WORDS.saving : WORDS.save}</button>
          {note !== null && <p className="tia-note" role="status" data-documents-note="">{note}</p>}
        </div>
      )}
    </div>
  );
}
