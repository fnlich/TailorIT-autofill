/*
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16, the coordinator's decision 5): a job's known questions and
 * the person's earlier answers (POST /api/autofill/forms/known), in the worker's memory only.
 * - Prefetched as a page loads (job-cards.ts loadCard, when its lookup says `formKnown`), and read at run/begin once
 *   the lookup names the job (run-begin.ts), by TailorIT's job id; a posting TailorIT keeps questions of with no job is
 *   read by its address at run/begin. A read is kept KNOWN_FORM_TTL_MS, and goes with the token (dropTokenData) or once
 *   it failed (a later run asks again).
 * - A run's plans add the questions its frame shows that TailorIT does not keep for the job (`fields`, at most
 *   AUTOFILL_FORM_LIMITS.fields a read, KNOWN_FIELDS_READS a run), so the person's answers to the same question on
 *   other jobs fill them too (RunKnown.withFields).
 * - The answers become the resolver's SubmittedAnswer list (submitted-forms.ts submittedAnswersOf), and the questions
 *   the run-start AI batch's (planner.ts). Nothing here is stored or logged but counts.
 * - v1.5 X (PLAN decision 4): the person's prebuilt draft answers for the job (`drafts`), the ready ones, join that list
 *   marked `draft` (submitted-forms.ts draftAnswersOf); a not-ready one is left to the fill's own AI path. A run of the
 *   auto-apply agent reads them the same way.
 */
import {
  AUTOFILL_FORM_LIMITS, AutofillQuestionKeySchema, type AutofillFormFieldKey, type AutofillKnownQuestion,
} from '../contract/tailorit';
import type { FieldKind, Platform } from '../core/enums';
import { cutInjected } from '../core/guard/injected';
import { OPTION_SET_LAZY, OPTION_SET_NONE, optionSetHash } from '../core/text/keys';
import { normalizeLabel } from '../core/text/normalize';
import type { BaseKey, FieldKey, FieldSpec, OptionSetHash, SectionRef } from '../core/types/field';
import type { SubmittedAnswer } from '../core/types/submitted';
import { log } from '../shared/log';
import type { ServerClient } from './server-client';
import { draftAnswersOf, submittedAnswersOf } from './submitted-forms';

/** How long a job's known form is kept before it is read again. */
export const KNOWN_FORM_TTL_MS = 10 * 60_000;
/** How long a plan waits for a read before it plans without it (a TailorIT that hangs never holds a fill). */
export const KNOWN_FORM_WAIT_MS = 3_000;
/** A run reads its frame's other questions at most this many times. */
export const KNOWN_FIELDS_READS = 8;

/** What a run knows of its job's form: the questions TailorIT keeps, and the person's earlier answers. */
export interface KnownForm {
  jobId: number | null;
  questions: AutofillKnownQuestion[];
  answers: SubmittedAnswer[];
}

/** The reads by job id, as the worker keeps them. */
export interface KnownForms {
  /** Reads the job's form unless one is held or on its way (loadCard). */
  prefetch(jobId: number): void;
  /** The job's form: held, on its way, or read now; null when TailorIT could not say. */
  get(jobId: number): Promise<KnownForm | null>;
  /** A read by the posting's address (a posting with no job), never kept. */
  byUrl(url: string): Promise<KnownForm | null>;
  /** The person's earlier answers to `fields`, for the job or posting (never kept). */
  fields(target: { jobId: number } | { url: string }, fields: AutofillFormFieldKey[]): Promise<SubmittedAnswer[] | null>;
  dropTokenData(): void;
}

let prefix = 0;

/** The reads over the server client. */
export function createKnownForms(deps: { server: Pick<ServerClient, 'knownForm'>; now(): number; generation(): number }):
  KnownForms {
  const held = new Map<number, { at: number; generation: number; read: Promise<KnownForm | null> }>();

  async function read(body: { jobId: number } | { url: string }, fields?: AutofillFormFieldKey[]):
    Promise<KnownForm | null> {
    const answer = await deps.server.knownForm({ ...body, ...(fields === undefined ? {} : { fields }) });
    if (!answer.ok) {
      log('forms.known-failed', { status: answer.status ?? 0 });
      return null;
    }
    prefix += 1;
    // v1.5 X (PLAN decision 4): the person's ready prebuilt draft answers too, marked `draft` (submitted-forms.ts).
    const drafts = draftAnswersOf(answer.value);
    const answers = [...submittedAnswersOf(answer.value), ...drafts]
      .map((item) => ({ ...item, id: `r${prefix}.${item.id}` }));
    log('forms.known', { questions: answer.value.questions.length, answers: answers.length - drafts.length,
      drafts: drafts.length, notReady: (answer.value.drafts ?? []).length - drafts.length });
    return { jobId: answer.value.jobId, questions: answer.value.questions, answers };
  }

  function start(jobId: number): Promise<KnownForm | null> {
    const generation = deps.generation();
    const reading = read({ jobId });
    const entry = { at: deps.now(), generation, read: reading };
    held.set(jobId, entry);
    // A failed read is not kept: the next asks again.
    void reading.then((form) => {
      if (form === null && held.get(jobId) === entry) held.delete(jobId);
    });
    return reading;
  }

  function fresh(jobId: number) {
    const entry = held.get(jobId);
    if (entry === undefined) return null;
    if (deps.now() - entry.at > KNOWN_FORM_TTL_MS || entry.generation !== deps.generation()) {
      held.delete(jobId);
      return null;
    }
    return entry;
  }

  return {
    prefetch(jobId) {
      if (fresh(jobId) === null) void start(jobId);
    },
    get(jobId) {
      return fresh(jobId)?.read ?? start(jobId);
    },
    byUrl: (url) => read({ url }),
    async fields(target, fields) {
      if (fields.length === 0) return [];
      return (await read(target, fields.slice(0, AUTOFILL_FORM_LIMITS.fields)))?.answers ?? null;
    },
    dropTokenData() {
      held.clear();
    },
  };
}

/** A promise's value, or `fallback` once `ms` passed (the timer is the caller's). */
export function within<T>(promise: Promise<T>, ms: number, fallback: T,
  timer: (ms: number) => Promise<void>): Promise<T> {
  return Promise.race([promise, timer(ms).then(() => fallback)]);
}

/** The key and option set a question would be kept under, for a field a plan shows (null: none to ask about). */
export function fieldKeyOf(spec: Pick<FieldSpec, 'label' | 'optionSetHash' | 'kind'>): AutofillFormFieldKey | null {
  if (spec.kind === 'file') return null;
  const questionKey = normalizeLabel(spec.label);
  if (!AutofillQuestionKeySchema.safeParse(questionKey).success) return null;
  const hashed = /^[0-9a-f]{16}$/.test(spec.optionSetHash);
  return { questionKey, optionSetHash: hashed ? spec.optionSetHash : '' };
}

/** A known question's section as the extension sent it (keys.ts sectionKey: `id`, or `id[block]`). */
function sectionOf(text: string): SectionRef {
  const block = /^(.*)\[(\d{1,4})\]$/.exec(text);
  return block === null ? { id: text } : { id: block[1]!, block: Number(block[2]) };
}

const OPTION_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'combobox', 'multiselect',
  'checkbox-group']);

/**
 * The job's known questions as specs the planner can plan (the run-start AI batch, planner.ts): each one's label, kind,
 * options, section, whether it is required and its place, a visible label (it was one when a person submitted it, or
 * the ATS's own question), no value, and a key of its own (`known|<id>`), never a field's, so no answer to it is ever
 * written anywhere: a field takes one only through RunAi's signature match. An upload is none.
 */
export function knownSpecsOf(questions: readonly AutofillKnownQuestion[], platform: Platform): FieldSpec[] {
  const sorted = [...questions].sort((a, b) => a.step - b.step || a.position - b.position);
  return sorted.flatMap((question, at): FieldSpec[] => {
    if (question.kind === 'file') return [];
    const label = [...question.label].slice(0, 300).join('');
    const listed = OPTION_KINDS.has(question.kind) && question.options.length > 0;
    const options = listed ? question.options.map((text, index) => ({ index, label: text, disabled: false,
      selected: false })) : [];
    const hash = !OPTION_KINDS.has(question.kind) ? OPTION_SET_NONE : !listed ? OPTION_SET_LAZY
      : question.optionSetHash !== null && question.optionSetHash !== '' ? question.optionSetHash as OptionSetHash
        : optionSetHash(question.options.map((text) => cutInjected(text).clean));
    const key = `known|${question.id}` as FieldKey;
    return [{ key, baseKey: key as unknown as BaseKey, platform, section: sectionOf(question.section),
      kind: question.kind, label, labelSource: 'adapter', labelVisible: true, description: '',
      required: question.required, options: listed ? options : OPTION_KINDS.has(question.kind) ? 'lazy' : [],
      optionSetHash: hash, constraints: {}, autocomplete: [], nameAttr: '', idAttr: '', ordinal: 0, domOrder: at,
      visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' } }];
  });
}

/** One run's knowledge of its job's form (RunMemo.known): the first read, then what its plans added. */
export interface RunKnown {
  /** The job's (or posting's) read at run/begin; null when none was made or it failed. */
  first: Promise<KnownForm | null>;
  /** Every earlier answer the run's reads gave, merged. */
  answers: SubmittedAnswer[];
  /** The field keys the run asked about (`questionKey|optionSetHash`), so none is asked twice. */
  asked: Set<string>;
  reads: number;
  /** The first read's answers are in `answers`. */
  merged?: boolean;
  /** The run-start AI batch was asked (planner.ts). */
  prestarted: boolean;
  target: { jobId: number } | { url: string } | null;
}
