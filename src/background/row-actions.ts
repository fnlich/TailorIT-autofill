/*
 * The row actions that reach a frame's field (Phase 6, wave 2; docs/ARCHITECTURE.md "UI" › "Actions per row"):
 * Save my answer (Requirement F) and Confirm draft.
 *
 * Save my answer: the side panel's panel/saveAnswer {tabId, frameId, fieldKey}, or the in-page panel's answer/save
 * {fieldKey} for its own frame. Only a row the frame's report offers it on (flagged, the person's own edit:
 * detail.userEdited, never a file, nor a class whose saved answers are 'never') with the setting on, and only:
 * 1. the question screened first: one naming a sensitive topic or reading like an attention check, in its label or its
 *    section's words, is never read or sent ('sensitive'); a free-text answer needs the company the frame's address
 *    named at its last plan ('company-unknown'), or, when the worker no longer knows it (it was stopped since: the
 *    Phase 6 review, E5), the company the frame's own address names now, which its answer/read answer carries;
 * 2. answer/read {fieldKey} to that frame: the field's answer as it holds it now (option labels, never indices; a text;
 *    a checked state) and its observed option-set hash, or why it cannot be saved (a field no plan named savable:
 *    'sensitive'). Option labels that are an EEO answer, a decline phrase or a sensitive topic are never sent
 *    ('sensitive'): a question whose label names no topic ("How do you identify?") is answered in its options (the
 *    Phase 6 review, T6-1);
 * 3. PUT /answers at once, keyed by the question's normalized label (the resolver's key), that hash ('' for none) and
 *    the scope (the company, '<platform>:<board>', for free text only; '' otherwise), with the kind, the visible label,
 *    the platform and the question's category as TailorIT names it.
 * The answer is never stored in the extension and never logged: it passes from the frame's answer to the request.
 * TailorIT's refusals are the panel's to word: 400 'sensitive' (a question it never keeps), 409 'limit', 403
 * 'not-allowed'. The next run reads it back with the profile (profile-cache.ts).
 *
 * Confirm draft: panel/confirmDraft {tabId, frameId, fieldKey}, for a row the report shows as an AI draft that waits for
 * the person, becomes draft/confirm {fieldKey} to that frame alone (the in-page panel confirms in its own frame). The
 * frame answers `expired` when no such draft waits there.
 */
import { AutofillQuestionKeySchema, PutAutofillSavedAnswerBodySchema, type AutofillFieldCategory } from
  '../contract/tailorit';
import { CLASS_POLICIES, policyClassOf } from '../core/resolver/categories';
import { namesUnsavableAnswer, SERVER_CATEGORY_MAP } from '../core/resolver/classify';
import { answerFitsKind } from '../core/resolver/saved';
import { normalizeLabel } from '../core/text/normalize';
import type { FieldKind } from '../core/enums';
import type { FieldCategory } from '../core/types/intent';
import type { Vocab } from '../core/vocab/types';
import { answerSchema, ok, refuse, type Answer } from '../messaging/envelope';
import { AnswerReadAnswerSchema, DoneAnswerSchema, type PageMessage, type SaveAnswerOutcome } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import type { FrameReport } from '../shared/report';
import { framesOfTab, frameTarget, type FrameEntry } from './frames';
import type { Reports } from './reports';
import type { FrameRef, RunRegistry } from './runs';
import { companyOfScope, neverSaved, scopeOf } from './saved-answers';
import type { ServerClient } from './server-client';
import type { SettingsStore } from './settings';

type Row = FrameReport['fields'][number];
type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;
type Saved = Answer<{ outcome: SaveAnswerOutcome }>;

/** The kinds a saved answer can fill (the resolver's answerFitsKind): a typed text, a list's options, a lone box. */
const SAVABLE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea', 'select', 'radio', 'combobox',
  'checkbox-group', 'multiselect', 'checkbox']);

/** Whether a report offers Save my answer on a row: the run left it flagged, the person then changed it with their own
 *  input, and its kind of question may ever take a saved answer (the report's own rule, src/ui/report/model.ts). */
export function offersSave(row: Row): boolean {
  return row.status === 'flagged' && row.detail?.userEdited === true && row.kind !== 'file'
    && CLASS_POLICIES[policyClassOf(row.category)].savedAnswers !== 'never';
}

/** Whether a row is an AI draft that still waits for the person. */
export const awaitsConfirmation = (row: Row) => row.provenance === 'llm-draft' && row.needsUserAction;

/** TailorIT's category for the question (PUT's `category`, never stored): the classification's own, or null. */
export function serverCategoryOf(category: FieldCategory): AutofillFieldCategory | null {
  if (policyClassOf(category) === 'free-text') return 'free_text_question';
  for (const [server, target] of Object.entries(SERVER_CATEGORY_MAP)) {
    if (target === category) return server as AutofillFieldCategory;
  }
  return null;
}

/** What the handlers need. */
export interface AnswerDeps {
  platform: Pick<WorkerPlatform, 'tabs' | 'storage'>;
  reports: Pick<Reports, 'ofTab'>;
  runs: Pick<RunRegistry, 'memo'>;
  server: Pick<ServerClient, 'putAnswer'>;
  settings: Pick<SettingsStore, 'get'>;
  /** The vocabulary the answer's option labels are screened with (T6-1). */
  vocab(): Vocab;
  connected(): Promise<boolean>;
}

/** The handlers of Save my answer and Confirm draft. */
export function createAnswerHandlers(deps: AnswerDeps) {
  const { platform } = deps;

  async function frameOf(tabId: number, frameId: number): Promise<FrameEntry | null> {
    return (await framesOfTab(platform.storage.session, tabId)).find((frame) => frame.frameId === frameId) ?? null;
  }

  /** The frame's report and the row of the field, as the worker holds them. */
  async function rowOf(tabId: number, frameId: number, fieldKey: string): Promise<{ report: FrameReport; row: Row } | null> {
    const report = (await deps.reports.ofTab(tabId)).find((candidate) => candidate.frameId === frameId);
    const row = report?.fields.find((candidate) => candidate.key === fieldKey);
    return report === undefined || row === undefined ? null : { report, row };
  }

  /** A refusal of the save, logged by its outcome. */
  function refused(outcome: Exclude<SaveAnswerOutcome, 'saved'>): Saved {
    log('answer.refused', { sensitive: outcome === 'sensitive', limit: outcome === 'limit',
      unsupported: outcome === 'unsupported', company: outcome === 'company-unknown', canary: outcome === 'canary',
      scope: outcome === 'not-allowed' });
    return ok({ outcome });
  }

  async function save(tabId: number, frame: FrameEntry, fieldKey: string): Promise<Saved> {
    if (!(await deps.connected())) return refuse('not_connected');
    if (!(await deps.settings.get()).offerToSaveAnswers) return refuse('expired');
    const found = await rowOf(tabId, frame.frameId, fieldKey);
    if (found === null || !offersSave(found.row)) return refuse('expired');
    const { report, row } = found;
    // The question first: one a saved answer may never answer is never read.
    if (neverSaved(row.label, row.section)) return refused('sensitive');
    if (!SAVABLE_KINDS.has(row.kind)) return refused('unsupported');
    const questionKey = normalizeLabel(row.label);
    if (!AutofillQuestionKeySchema.safeParse(questionKey).success) return refused('unsupported');
    const forCompany = CLASS_POLICIES[policyClassOf(row.category)].savedAnswers === 'company';
    // The company the run's last plan read from the frame's address; undefined when this worker never planned for the
    // run (it was stopped since): the frame's own word then decides, below (E5).
    const planned = forCompany ? deps.runs.memo(report.runId).company : null;
    if (forCompany && planned === null) return refused('company-unknown');

    let raw: unknown;
    try {
      raw = await platform.tabs.sendToFrame(tabId, { v: 1, type: 'answer/read', fieldKey }, frameTarget(frame));
    } catch {
      log('frame.unreachable');
      return refuse('unavailable');
    }
    const read = answerSchema(AnswerReadAnswerSchema).safeParse(raw);
    if (!read.success) return refuse('unavailable');
    if (!read.data.ok) return refuse(read.data.error === 'expired' ? 'expired' : 'unavailable');
    const value = read.data.data;
    if ('refused' in value) return refused(value.refused);
    const company = !forCompany ? null : planned ?? (value.company === undefined || value.company === null ? null
      : companyOfScope(value.company));
    if (forCompany && company === null) return refused('company-unknown');
    if (!answerFitsKind(value.answer, row.kind)) return refused('unsupported');
    // The answer's own words: an EEO answer, a decline phrase or a sensitive topic is never kept (T6-1).
    if (value.answer.kind === 'options' && namesUnsavableAnswer(value.answer.labels, deps.vocab())) {
      return refused('sensitive');
    }
    const body = PutAutofillSavedAnswerBodySchema.safeParse({
      questionKey,
      optionSetHash: value.optionSetHash === 'none' ? '' : value.optionSetHash,
      scope: company === null ? '' : scopeOf(company),
      fieldKind: row.kind,
      questionLabel: row.label,
      platform: report.platform,
      answer: value.answer,
      category: serverCategoryOf(row.category),
    });
    if (!body.success) return refused('unsupported');

    const put = await deps.server.putAnswer(body.data);
    if (put.ok) {
      log('answer.saved', { company: company !== null });
      return ok({ outcome: 'saved' });
    }
    switch (put.failure) {
      case 'bad-request':
        return refused('sensitive');
      case 'conflict':
        return refused('limit');
      case 'forbidden':
        return refused('not-allowed');
      case 'not-connected':
      case 'unauthorized':
        return refuse('not_connected');
      case 'rate-limited':
        return { ok: false, error: 'rate_limited', ...(put.retryAfterSeconds === undefined ? {}
          : { retryAfterSeconds: put.retryAfterSeconds }) };
      default:
        return refuse('unavailable');
    }
  }

  return {
    /** The side panel's Save my answer, for one frame's field. */
    async saveAnswer(message: Of<'panel/saveAnswer'>): Promise<Saved> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      return save(message.tabId, frame, message.fieldKey);
    },
    /** The in-page panel's Save my answer (answer/save), for one of the sending frame's own fields. */
    async saveOwn(fieldKey: string, from: FrameRef): Promise<Saved> {
      const frame = await frameOf(from.tabId, from.frameId);
      if (frame === null || frame.documentId !== (from.documentId ?? null)) return refuse('expired');
      return save(from.tabId, frame, fieldKey);
    },
    /** The side panel's Confirm draft: draft/confirm to that frame, while its report shows the draft waiting. */
    async confirmDraft(message: Of<'panel/confirmDraft'>): Promise<Answer<Record<string, never>>> {
      const frame = await frameOf(message.tabId, message.frameId);
      if (frame === null) return refuse('expired');
      const found = await rowOf(message.tabId, message.frameId, message.fieldKey);
      if (found === null || !awaitsConfirmation(found.row)) return refuse('expired');
      let raw: unknown;
      try {
        raw = await platform.tabs.sendToFrame(message.tabId, { v: 1, type: 'draft/confirm', fieldKey: message.fieldKey },
          frameTarget(frame));
      } catch {
        log('frame.unreachable');
        return refuse('unavailable');
      }
      const parsed = answerSchema(DoneAnswerSchema).safeParse(raw);
      if (!parsed.success) return refuse('unavailable');
      if (!parsed.data.ok) return refuse(parsed.data.error === 'expired' ? 'expired' : 'unavailable');
      log('draft.confirmed');
      return ok({});
    },
  };
}

/** The handlers, as index.ts wires them. */
export type AnswerHandlers = ReturnType<typeof createAnswerHandlers>;
