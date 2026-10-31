import { z } from 'zod';
import { AUTOFILL_FIELD_KINDS, InstantSchema } from './common';
import { ATS_KINDS } from './lookup';

// The AI steps the extension asks TailorIT for, run as tasks on its Claude queue: the tiebreak between options it
// could not choose between (POST /api/autofill/ai/pick), what an unusual question asks (POST …/ai/classify) and, from
// Phase 6, a draft for a free-text question (POST …/ai/draft). Claude has no authority over a form: a pick answers an
// option's index or null, a classification a category from a closed list or null, a draft capped text the person must
// confirm. TailorIT checks every answer before it stores it, and the extension checks it again against the form as it
// is then. Page text travels only in the fields named for it (labels, options, hints, sections, questions, job text),
// which TailorIT quotes to Claude as data, never as instructions; profile text only in a pick's intended value and its
// aliases. Nothing sensitive is sent: the extension screens a question before it asks, and TailorIT answers one that
// still looks sensitive null (reason `sensitive`) without asking Claude.
//
// A route waits up to AUTOFILL_AI_WAIT_MS for its task and answers 200 with the finished task, else 202 {taskId}; the
// extension then polls GET /api/ai/tasks/:id every AUTOFILL_AI_POLL_MS (DELETE on the same path cancels it). The same
// body sent again while its task is queued or running answers that task (TailorIT's dedupe key is the kind and a hash
// of the task's input), never a second one; a finished task is read again by its id, within
// AUTOFILL_TASK_RETENTION_MS, rather than asked again. A token sees only these kinds' tasks: any other id answers 404.

/** The task kinds the extension creates. All three are reserved at once, so ai_tasks is rebuilt once; drafts' route
 *  and handler come in Phase 6. */
export const AUTOFILL_TASK_KINDS = ['autofill_pick', 'autofill_classify', 'autofill_draft'] as const;
export type AutofillTaskKind = (typeof AUTOFILL_TASK_KINDS)[number];

/** TailorIT's AI_TASK_STATUSES: queued and running are not finished yet; succeeded, failed and cancelled are. */
export const AUTOFILL_TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type AutofillTaskStatus = (typeof AUTOFILL_TASK_STATUSES)[number];

/** How long an AI route waits for its task before it answers 202 {taskId}: well under the 30 s Chrome gives a
 *  service worker's fetch. */
export const AUTOFILL_AI_WAIT_MS = 10_000;
/** How often the extension polls a task the route answered 202 for. */
export const AUTOFILL_AI_POLL_MS = 1500;
/** TailorIT deletes an autofill task this long after it finished (its input holds page text): its id then answers
 *  404, and the extension asks again. */
export const AUTOFILL_TASK_RETENTION_MS = 60 * 60_000;
/** Tasks of one kind an account may have queued or running at once (TailorIT's queue rule). Past it a route answers
 *  409 `ai_busy`, so the extension keeps one task in flight per kind and the second place stays free. */
export const AUTOFILL_AI_MAX_ACTIVE_PER_KIND = 2;

/**
 * Every cap of the AI requests and answers. Above any of them TailorIT refuses the whole request (400
 * `validation_failed`), so the extension keeps under them: zod counts code points. `requestText` counts every string
 * in a request together (its JSON is longer still); `classify.text` is reached by cutting with cutAtWord.
 */
export const AUTOFILL_AI_LIMITS = {
  requestText: 100_000,
  /** An item's key: the extension's field key, at most this many code points. */
  key: 300,
  pick: { items: 20, options: 30, aliases: 10, intendedValue: 300, alias: 200, label: 500, optionLabel: 300 },
  classify: { items: 20, options: 20, text: 200 },
  draft: {
    questions: 3,
    question: 1000,
    /** A field whose maxLength is under this gets no draft. */
    minLength: 50,
    /** The longest draft, and the most a question's maxLength may name. */
    maxLength: 5000,
    /** The cap of a question with no maxLength. */
    defaultLength: 3000,
    jobText: 20_000,
    company: 200,
    jobTitle: 200,
    canaries: 50,
    canary: 200,
  },
} as const;

/**
 * What an AI route refuses with, besides every token route's refusals (401, 403, 409 `conflict`, 429), and the status
 * of each: `validation_failed` (a body over a cap, a pick category not in the list), `not_found` (a draft's resume),
 * `ai_busy` (finish polling the task in flight, then retry; no Retry-After) and `ai_unavailable` (Claude is off, signed
 * out or paused on this server, or this server has no handler for the kind yet).
 */
export const AUTOFILL_AI_REFUSALS = {
  validation_failed: 400,
  not_found: 404,
  ai_busy: 409,
  ai_unavailable: 503,
} as const;

/**
 * The `error.code` of a task that did not succeed: `ai_failed` (this request went wrong; asking again may work),
 * `ai_unavailable` (Claude cannot run now), `interrupted` (TailorIT restarted while it ran) and `cancelled` (DELETE
 * /api/ai/tasks/:id). The view keeps the code a string, so a code added later never breaks the extension's parse.
 */
export const AUTOFILL_TASK_ERROR_CODES = ['ai_failed', 'ai_unavailable', 'interrupted', 'cancelled'] as const;
export type AutofillTaskErrorCode = (typeof AUTOFILL_TASK_ERROR_CODES)[number];

/**
 * What a tiebreak may be about: entity names from the profile and generic custom questions, never a sensitive
 * question. Country, region and phone country code are closed lists the extension matches exactly; they are not in the
 * list, so TailorIT refuses a pick of one (400). Equals the extension's PICK_CATEGORIES.
 */
export const AUTOFILL_PICK_CATEGORIES = [
  'school',
  'degree',
  'field_of_study',
  'language',
  'language_proficiency',
  'referral_source',
  'generic',
] as const;
export type AutofillPickCategory = (typeof AUTOFILL_PICK_CATEGORIES)[number];

/**
 * The categories that never lead to a fill. Claude is told to use them whenever a question is of that nature; the
 * extension's SERVER_CATEGORY_MAP leaves such a field to the person, so a classification can only make the extension
 * more careful, never write a sensitive answer.
 */
export const AUTOFILL_NEEDS_USER_CATEGORIES = [
  'sensitive_eeo',
  'sensitive_legal',
  'sensitive_compensation',
  'consent',
  'attention_check',
  'free_text_question',
] as const;

/**
 * What a field asks for, as a classification answers it. The extension's SERVER_CATEGORY_MAP maps each one to its own
 * categories, by the field's section where one needs it: `employer`, `job_title`, `location`, `start_date`, `end_date`
 * and `role_description` in an employment entry are that entry's; `start_date` elsewhere is when the person can start.
 */
export const AUTOFILL_FIELD_CATEGORIES = [
  'first_name',
  'middle_name',
  'last_name',
  'full_name',
  'preferred_name',
  'email',
  'phone',
  'phone_country_code',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'location',
  'linkedin',
  'github',
  'portfolio',
  'website',
  'current_employer',
  'current_title',
  'employer',
  'job_title',
  'role_description',
  'years_experience',
  'school',
  'degree',
  'field_of_study',
  'graduation_date',
  'gpa',
  'language',
  'language_proficiency',
  'skills',
  'start_date',
  'end_date',
  'notice_period',
  'relocation',
  'work_arrangement',
  'referral_source',
  'resume_upload',
  'cover_letter_upload',
  ...AUTOFILL_NEEDS_USER_CATEGORIES,
] as const;
export type AutofillFieldCategory = (typeof AUTOFILL_FIELD_CATEGORIES)[number];

/** A task's id: TailorIT's random UUID in lower case, the only thing GET and DELETE /api/ai/tasks/:id hold. */
export const AutofillTaskIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** The observed option-set hash: 16 lower-case hex digits (the extension's hash of the field's usable options). */
export const OptionSetHashSchema = z.string().regex(/^[0-9a-f]{16}$/);

/** An item's identity in its request: the extension's field key, each one once, repeated in its answer. TailorIT
 *  numbers the items itself, so a key (which holds label text) never reaches Claude. */
const ItemKeySchema = z.string().min(1).max(AUTOFILL_AI_LIMITS.key);

/**
 * `text` with at most `max` code points (zod's count): a longer text is cut after its last whole word within them, so
 * no word is split, and only a first word longer than `max` is cut inside. Nothing is added; spaces at the cut go.
 */
export function cutAtWord(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  const head = points.slice(0, Math.max(0, max));
  let end = head.length;
  if (!/\s/.test(points[end] ?? '')) {
    while (end > 0 && !/\s/.test(head[end - 1]!)) end -= 1;
  }
  const kept = head.slice(0, end).join('').trimEnd();
  return kept === '' ? head.join('').trimEnd() : kept;
}

/** The length of every string in a request together (UTF-16 units: at least their code points, less than the JSON). */
function textLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + textLength(item), 0);
  if (value === null || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum: number, item) => sum + textLength(item), 0);
}

/** Each item's key once, and no more text than TailorIT takes. */
function checkItems(list: string, items: readonly { key: string }[], request: unknown, ctx: z.RefinementCtx): void {
  const keys = new Set<string>();
  items.forEach((item, index) => {
    if (keys.has(item.key)) {
      ctx.addIssue({ code: 'custom', path: [list, index, 'key'], message: 'Each item needs its own key' });
    }
    keys.add(item.key);
  });
  if (textLength(request) > AUTOFILL_AI_LIMITS.requestText) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: `The request holds more than ${AUTOFILL_AI_LIMITS.requestText.toLocaleString('en-US')} characters`,
    });
  }
}

/** One option a tiebreak may choose. */
export const AutofillPickOptionSchema = z.object({
  /** The option's position among the field's visible options, as the extension scanned them: what an answer names. */
  index: z.number().int().nonnegative(),
  /** Its clean label (injected text cut), exactly as sent: page text. */
  label: z.string().max(AUTOFILL_AI_LIMITS.pick.optionLabel),
});
export type AutofillPickOption = z.infer<typeof AutofillPickOptionSchema>;

/** One field the extension could not settle: which of these options means what the person means? */
export const AutofillPickItemSchema = z.object({
  key: ItemKeySchema,
  category: z.enum(AUTOFILL_PICK_CATEGORIES),
  /** The option set the options were read under, repeated in the answer. */
  optionSetHash: OptionSetHashSchema,
  /** What the person means, from their profile ("The University of Texas at Austin"; a degree with its field, "MS in
   *  Computer Science"): profile text, never page text. */
  intendedValue: z.string().min(1).max(AUTOFILL_AI_LIMITS.pick.intendedValue),
  /** Other names for it ("UT Austin"), from the profile and the extension's vocabulary. */
  aliases: z.array(z.string().max(AUTOFILL_AI_LIMITS.pick.alias)).max(AUTOFILL_AI_LIMITS.pick.aliases).default([]),
  /** The question as the form shows it (page text); '' when the extension may not quote it (a label known only from
   *  aria-label). */
  label: z.string().max(AUTOFILL_AI_LIMITS.pick.label),
  /** The candidates, in the field's order, each index once: only options that passed the extension's guard. */
  options: z.array(AutofillPickOptionSchema).min(1).max(AUTOFILL_AI_LIMITS.pick.options),
});
export type AutofillPickItem = z.infer<typeof AutofillPickItemSchema>;

function checkPick(request: { items: readonly AutofillPickItem[] }, ctx: z.RefinementCtx): void {
  request.items.forEach((item, at) => {
    const indices = new Set<number>();
    item.options.forEach((option, index) => {
      if (indices.has(option.index)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', at, 'options', index, 'index'],
          message: 'Each option needs its own index',
        });
      }
      indices.add(option.index);
    });
  });
  checkItems('items', request.items, request, ctx);
}

/** POST /api/autofill/ai/pick (scope ai:run): one task for a form pass's ties, at most 20. */
export const AutofillPickRequestSchema = z
  .object({ items: z.array(AutofillPickItemSchema).min(1).max(AUTOFILL_AI_LIMITS.pick.items) })
  .superRefine(checkPick);
export type AutofillPickRequest = z.infer<typeof AutofillPickRequestSchema>;

/**
 * Why a pick is what it is. `matched`: Claude named an option the item offered. `no_match`: it named none (null).
 * `invalid`: its answer was not one of the item's sent indices (another number, a fraction, a string); or the answer
 * as a whole was not trusted, which makes every item `invalid`: it did not name each item exactly once (one missing,
 * repeated or added, or numbered with a string), or it talked of being an AI. `sensitive`: TailorIT did not ask,
 * because the question or the value looked sensitive, or the value is one of the person's sensitive answers.
 */
export const AUTOFILL_PICK_REASONS = ['matched', 'no_match', 'invalid', 'sensitive'] as const;
export type AutofillPickReason = (typeof AUTOFILL_PICK_REASONS)[number];

export const AutofillPickSchema = z.object({
  key: ItemKeySchema,
  optionSetHash: OptionSetHashSchema,
  /** The chosen option's `index`, as the request sent it; null unless `matched`. */
  index: z.number().int().nonnegative().nullable(),
  reason: z.enum(AUTOFILL_PICK_REASONS),
});
export type AutofillPick = z.infer<typeof AutofillPickSchema>;

/** A pick task's result: one answer per item, in the request's order. */
export const AutofillPickResultSchema = z.object({
  picks: z.array(AutofillPickSchema).max(AUTOFILL_AI_LIMITS.pick.items),
});
export type AutofillPickResult = z.infer<typeof AutofillPickResultSchema>;

/** One field nothing on the extension's side classified. Every text is page text, cut with cutAtWord to 200. */
export const AutofillClassifyItemSchema = z.object({
  key: ItemKeySchema,
  kind: z.enum(AUTOFILL_FIELD_KINDS),
  /** The question as the form shows it. */
  label: z.string().max(AUTOFILL_AI_LIMITS.classify.text),
  /** Its visible description, if any. */
  hint: z.string().max(AUTOFILL_AI_LIMITS.classify.text).default(''),
  /** The heading of the part of the form it sits in ("Employment", "Voluntary Self-Identification"). */
  section: z.string().max(AUTOFILL_AI_LIMITS.classify.text).default(''),
  /** Its first options' clean labels, at most 20. */
  options: z
    .array(z.string().max(AUTOFILL_AI_LIMITS.classify.text))
    .max(AUTOFILL_AI_LIMITS.classify.options)
    .default([]),
});
export type AutofillClassifyItem = z.infer<typeof AutofillClassifyItemSchema>;

/** POST /api/autofill/ai/classify (scope ai:run): one task for a form pass's unclassified fields, at most 20. */
export const AutofillClassifyRequestSchema = z
  .object({
    /** The form's ATS. */
    platform: z.enum(ATS_KINDS),
    items: z.array(AutofillClassifyItemSchema).min(1).max(AUTOFILL_AI_LIMITS.classify.items),
  })
  .superRefine((request, ctx) => checkItems('items', request.items, request, ctx));
export type AutofillClassifyRequest = z.infer<typeof AutofillClassifyRequestSchema>;

/**
 * Why a classification is what it is. `classified`: a category from the list. `unknown`: Claude named none (null).
 * `invalid`: it named something not in the list; or the answer as a whole was not trusted, which makes every item
 * `invalid`: it did not name each item exactly once, or it talked of being an AI. `sensitive`: TailorIT did not ask.
 */
export const AUTOFILL_CLASSIFY_REASONS = ['classified', 'unknown', 'invalid', 'sensitive'] as const;
export type AutofillClassifyReason = (typeof AUTOFILL_CLASSIFY_REASONS)[number];

export const AutofillClassificationSchema = z.object({
  key: ItemKeySchema,
  /** Null unless `classified`. */
  category: z.enum(AUTOFILL_FIELD_CATEGORIES).nullable(),
  reason: z.enum(AUTOFILL_CLASSIFY_REASONS),
});
export type AutofillClassification = z.infer<typeof AutofillClassificationSchema>;

/** A classify task's result: one answer per item, in the request's order. */
export const AutofillClassifyResultSchema = z.object({
  items: z.array(AutofillClassificationSchema).max(AUTOFILL_AI_LIMITS.classify.items),
});
export type AutofillClassifyResult = z.infer<typeof AutofillClassifyResultSchema>;

/** One free-text question to draft an answer for (Phase 6). */
export const AutofillDraftQuestionSchema = z.object({
  key: ItemKeySchema,
  /** The question as the form shows it: page text. */
  question: z.string().min(1).max(AUTOFILL_AI_LIMITS.draft.question),
  /** The field's maxLength, at most 5000; null when it has none (the draft is then kept to 3000). */
  maxLength: z.number().int().min(AUTOFILL_AI_LIMITS.draft.minLength).max(AUTOFILL_AI_LIMITS.draft.maxLength).nullable(),
});
export type AutofillDraftQuestion = z.infer<typeof AutofillDraftQuestionSchema>;

/** POST /api/autofill/ai/draft (scope ai:run; Phase 6): at most three questions of one form. */
export const AutofillDraftRequestSchema = z
  .object({
    questions: z.array(AutofillDraftQuestionSchema).min(1).max(AUTOFILL_AI_LIMITS.draft.questions),
    /** The job description the form's own page shows (page text); '' on a form embedded in a company's page, whose
     *  drafts go by the company and the title alone. Never TailorIT's stored copy. */
    jobText: z.string().max(AUTOFILL_AI_LIMITS.draft.jobText),
    /** The lookup's company and job title, '' when it found no job. */
    company: z.string().max(AUTOFILL_AI_LIMITS.draft.company).default(''),
    jobTitle: z.string().max(AUTOFILL_AI_LIMITS.draft.jobTitle).default(''),
    /** The resume whose facts the drafts may use; null: the profile's resume, else the default. */
    resumeId: z.string().max(64).nullable(),
    /** The page's tripwire tokens ("I am LLM"): a draft holding one is refused (`canary`). */
    canaries: z
      .array(z.string().min(2).max(AUTOFILL_AI_LIMITS.draft.canary))
      .max(AUTOFILL_AI_LIMITS.draft.canaries)
      .default([]),
  })
  .superRefine((request, ctx) => checkItems('questions', request.questions, request, ctx));
export type AutofillDraftRequest = z.infer<typeof AutofillDraftRequestSchema>;

/**
 * Why a draft is what it is. `drafted`: within its cap. `trimmed`: cut at the last sentence end within the cap.
 * `empty`: the resume had nothing to say. `too_long`: over the cap with no sentence end to cut at. `canary`: it held a
 * canary. `ai_reference`: it spoke of being an AI. `sensitive`: TailorIT did not ask. Only the first two carry text.
 */
export const AUTOFILL_DRAFT_REASONS = [
  'drafted',
  'trimmed',
  'empty',
  'too_long',
  'canary',
  'ai_reference',
  'sensitive',
] as const;
export type AutofillDraftReason = (typeof AUTOFILL_DRAFT_REASONS)[number];

export const AutofillDraftSchema = z.object({
  key: ItemKeySchema,
  /** Plain text in the first person, for the person to edit or confirm; null unless `drafted` or `trimmed`. */
  text: z.string().max(AUTOFILL_AI_LIMITS.draft.maxLength).nullable(),
  reason: z.enum(AUTOFILL_DRAFT_REASONS),
});
export type AutofillDraft = z.infer<typeof AutofillDraftSchema>;

/** A draft task's result: one answer per question, in the request's order. */
export const AutofillDraftResultSchema = z.object({
  drafts: z.array(AutofillDraftSchema).max(AUTOFILL_AI_LIMITS.draft.questions),
});
export type AutofillDraftResult = z.infer<typeof AutofillDraftResultSchema>;

/** An AI route's answer when its task has not finished within AUTOFILL_AI_WAIT_MS (202): poll it. */
export const AutofillTaskAcceptedSchema = z.object({ taskId: AutofillTaskIdSchema });
export type AutofillTaskAccepted = z.infer<typeof AutofillTaskAcceptedSchema>;

/** A task as TailorIT's AiTaskView shows it, with the kind's result. */
function taskOf<K extends AutofillTaskKind, R extends z.ZodType>(kind: K, result: R) {
  return z.object({
    id: AutofillTaskIdSchema,
    kind: z.literal(kind),
    status: z.enum(AUTOFILL_TASK_STATUSES),
    /** Null until it succeeded. */
    result: result.nullable(),
    /** Why it failed or was cancelled (`code` is one of AUTOFILL_TASK_ERROR_CODES, or one added later). */
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    createdAt: InstantSchema,
    startedAt: InstantSchema.nullable(),
    finishedAt: InstantSchema.nullable(),
  });
}

/** POST …/ai/pick's 200 answer: the task, finished. */
export const AutofillPickTaskSchema = taskOf('autofill_pick', AutofillPickResultSchema);
export type AutofillPickTask = z.infer<typeof AutofillPickTaskSchema>;
/** POST …/ai/classify's 200 answer. */
export const AutofillClassifyTaskSchema = taskOf('autofill_classify', AutofillClassifyResultSchema);
export type AutofillClassifyTask = z.infer<typeof AutofillClassifyTaskSchema>;
/** POST …/ai/draft's 200 answer (Phase 6). */
export const AutofillDraftTaskSchema = taskOf('autofill_draft', AutofillDraftResultSchema);
export type AutofillDraftTask = z.infer<typeof AutofillDraftTaskSchema>;

/** GET /api/ai/tasks/:id, and DELETE on the same path (the task after cancelling; a finished one unchanged). */
export const AutofillTaskViewSchema = z.discriminatedUnion('kind', [
  AutofillPickTaskSchema,
  AutofillClassifyTaskSchema,
  AutofillDraftTaskSchema,
]);
export type AutofillTaskView = z.infer<typeof AutofillTaskViewSchema>;
