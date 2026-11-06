/*
 * The whole message catalogue, one strict zod union per channel. A content script shares a process with the ATS page,
 * so everything it sends is parsed as untrusted: objects are strict and every string and array is capped. The worker
 * also checks each sender (background/senders.ts); a known type on the wrong channel is refused.
 *
 * The catalogue is fixed here so phases fill in handlers, not shapes; docs/ARCHITECTURE.md ("Message catalogue") lists
 * who sends each message and what it answers. Phase 6 (wave 2) wired the last of them: panel/confirmDraft and
 * draft/confirm, panel/saveAnswer, answer/save and answer/read.
 */
import { z } from 'zod';
import { EXTENSION_SCOPES } from '../contract/tailorit/connect';
import { RESUME_CHOICE_REASONS } from '../contract/tailorit/lookup';
import { AUTOFILL_AI_LIMITS } from '../contract/tailorit/ai';
import { AutofillProfileSchema, AutofillSensitiveSchema, WORK_ARRANGEMENTS } from '../contract/tailorit/profile';
import { AUTOFILL_JOB_SEARCH_MAX, AUTOFILL_JOB_SEARCH_QUERY_MAX } from '../contract/tailorit/tracker';
import { AUTOFILL_FILE_KINDS, AUTOFILL_RESUME_KINDS } from '../contract/tailorit/resumes';
import { AUTOFILL_AGENT_FINISHED_STATES, AUTOFILL_AGENT_REASONS } from '../contract/tailorit/agent';
import { AutofillSignInHostSchema, AUTOFILL_SIGN_IN_LIMITS } from '../contract/tailorit/credentials';
import { FIELD_FORMATS, FIELD_KINDS, FIELD_VISIBILITIES, LABEL_SOURCES, MATCHER_STAGES,
  PLATFORMS } from '../core/enums';
import { MAX_REVEAL_EDGES } from '../core/loop/bookkeeping';
import { SHOWN_CATEGORIES } from '../core/steps/blocks';
import { MAX_TELEMETRY_COUNTS, TELEMETRY_OUTCOMES } from '../core/telemetry/events';
import { REASON_CODES } from '../core/types/fill';
import { ANSWER_BASES, FILE_REFS, RULE_IDS } from '../core/types/intent';
import { MATCH_FLAGS, MATCH_RULES } from '../core/types/match';
import { MAX_REPEATABLE_BLOCKS, MAX_RUN_STATE_DRAFTS, MAX_STEPS, PAUSE_REASONS, REPEATABLE_KINDS, RUN_STATUSES } from
  '../core/types/run';
import { RECOGNITION_REASONS } from '../shared/recognition';
import { FrameReportSchema } from '../shared/report';
import { ContentSettingsSchema, SettingsSchema } from '../shared/settings';
import { MESSAGE_VERSION } from './envelope';

const Text = (max: number) => z.string().max(max);
const Key = z.string().min(1).max(600);
const Id = z.string().min(1).max(64);
const Hash = z.string().regex(/^(?:[a-f0-9]{16,64}|none|lazy)$/);
const Count = z.number().int().nonnegative();

/** The longest posting text plan/request carries (Phase 6): TailorIT's cap on a draft's job text
 *  (AUTOFILL_AI_LIMITS.draft.jobText, in code points, as zod counts them), which the frame's visibleText cap keeps. */
export const MAX_POSTING_TEXT = 20_000;

/** The longest company and job title a page's own heading gives (Phase G): TailorIT's caps on a cover letter's
 *  (AUTOFILL_COVER_LETTER_LIMITS). */
export const MAX_POSTING_NAME = 200;

/** The company and the job title the page names in its own title (Phase G; content/job-relay.ts postingNamesOf): a
 *  cover letter for a posting TailorIT does not have is found or written for them. Page text, never kept. */
export const PostingNamesSchema = z.strictObject({ company: Text(MAX_POSTING_NAME).min(1),
  title: Text(MAX_POSTING_NAME).min(1) });

// ── Payloads ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const OptionSchema = z.strictObject({
  index: Count,
  label: Text(300),
  value: Text(300).optional(),
  group: Text(300).optional(),
  disabled: z.boolean(),
  selected: z.boolean(),
});

export const ConstraintsSchema = z.strictObject({
  maxSelections: Count.optional(),
  minSelections: Count.optional(),
  exactSelections: Count.optional(),
  selectAllThatApply: z.boolean().optional(),
  format: z.enum(FIELD_FORMATS).optional(),
  pattern: Text(100).optional(),
  maxLength: Count.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  accept: z.array(Text(100)).max(20).optional(),
});

export const CurrentValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('text'), text: Text(20_000) }),
  z.strictObject({ kind: z.literal('checked'), checked: z.boolean() }),
  z.strictObject({ kind: z.literal('selected'), labels: z.array(Text(300)).max(300) }),
  z.strictObject({ kind: z.literal('files'), count: Count }),
]);

export const FieldSpecSchema = z.strictObject({
  key: Key,
  baseKey: Key,
  platform: z.enum(PLATFORMS),
  section: z.strictObject({ id: Text(200), block: Count.optional() }),
  kind: z.enum(FIELD_KINDS),
  label: Text(300),
  labelSource: z.enum(LABEL_SOURCES),
  /** A visible source names the field: one that is false is never written and never asks for the sensitive part. */
  labelVisible: z.boolean(),
  description: Text(2000),
  required: z.boolean(),
  options: z.union([z.array(OptionSchema).max(5000), z.literal('lazy')]),
  /** A widget's list read only in part: the planner matches it exactly or not at all. */
  optionsPartial: z.literal(true).optional(),
  optionSetHash: Hash,
  constraints: ConstraintsSchema,
  autocomplete: z.array(Text(60)).max(10),
  nameAttr: Text(300),
  idAttr: Text(300),
  ordinal: Count,
  domOrder: Count,
  visibility: z.enum(FIELD_VISIBILITIES),
  disabled: z.boolean(),
  readOnly: z.boolean(),
  current: CurrentValueSchema,
});

export const WriteValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: Text(20_000) }),
  z.strictObject({ kind: z.literal('option'), index: Count, cleanLabel: Text(300), freeText: Text(1000).optional() }),
  /** Each index with the clean label of the option it means, in the same order: the frame refuses the write when an
   *  option there now reads otherwise. */
  z.strictObject({ kind: z.literal('options'), indices: z.array(Count).max(300), cleanLabels: z.array(Text(300)).max(300) })
    .refine((value) => value.cleanLabels.length === value.indices.length),
  z.strictObject({ kind: z.literal('query'), queries: z.array(Text(300)).max(4) }),
  z.strictObject({ kind: z.literal('check') }),
  /** The run's resume or its cover letter (Phase G), received over the resume port when it is written. */
  z.strictObject({ kind: z.literal('file'), ref: z.enum(FILE_REFS) }),
  z.strictObject({ kind: z.literal('date'), iso: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/) }),
]);

const ProfilePath = Text(200);
export const ValueOriginSchema = z.discriminatedUnion('provenance', [
  z.strictObject({ provenance: z.literal('profile'), path: ProfilePath, transform: z.enum(RULE_IDS).optional() }),
  z.strictObject({ provenance: z.literal('saved'), savedAnswerId: Id }),
  z.strictObject({ provenance: z.literal('rule'), ruleId: z.enum(RULE_IDS), path: ProfilePath.optional() }),
  z.strictObject({ provenance: z.literal('llm-pick'), taskId: Id, pickedCandidate: Count, labelHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ provenance: z.literal('llm-draft'), taskId: Id, confirmedByUser: z.boolean() }),
  /** An AI answer's text (the owner's amendments): its task, and what it rested on (`guess`: marked "AI guess"). */
  z.strictObject({ provenance: z.literal('llm-answer'), taskId: Id, basis: z.enum(ANSWER_BASES) }),
]);

export const MatchSchema = z.strictObject({
  stage: z.enum(MATCHER_STAGES),
  optionIndex: Count.nullable(),
  rule: z.enum(MATCH_RULES).nullable(),
  confidence: z.number().min(0).max(1),
  score: z.number().optional(),
  margin: z.number().optional(),
  freeText: Text(1000).optional(),
  flags: z.array(z.enum(MATCH_FLAGS)).max(MATCH_FLAGS.length),
  suggestions: z.array(z.strictObject({ index: Count, score: z.number() })).max(3),
  reason: z.enum(REASON_CODES),
});

export const PlannedWriteSchema = z.strictObject({
  key: Key,
  value: WriteValueSchema,
  origin: ValueOriginSchema,
  match: MatchSchema,
});

/**
 * The most entries each of RunState's records may hold, from the core's runaway-wizard guard (MAX_STEPS): one per step
 * for the step-signature records; per step, one counter per kind of repeatable section (experience, education,
 * language); per step, one batch per pass (MAX_PASSES, 8, docs/design/core.md) for each of the four AI task kinds
 * (pick, classify, draft and, since the owner's amendments, answer).
 */
export const RUN_STATE_RECORD_CAPS = {
  stepAttempts: MAX_STEPS,
  filledFieldKeys: MAX_STEPS,
  repeatableCounters: MAX_STEPS * 3,
  aiTasks: MAX_STEPS * 8 * 4,
} as const;

/** A record of at most `max` entries. zod's record has no cap of its own, so the count is checked first, before any
 *  entry is parsed: an endless record costs one count, not a parse. */
function cappedRecord<V extends z.ZodType>(key: z.ZodString, value: V, max: number) {
  return z.custom<Record<string, unknown>>((input) =>
    typeof input === 'object' && input !== null && !Array.isArray(input) && Object.keys(input).length <= max)
    .pipe(z.record(key, value));
}

export const RunStateSchema = z.strictObject({
  version: z.literal(1),
  applicationKey: z.string().regex(/^[a-z]+:[a-f0-9]{16}$/),
  platform: z.enum(PLATFORMS),
  status: z.enum(RUN_STATUSES),
  resumeStatus: z.enum(RUN_STATUSES).nullable(),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  stepSignature: z.string().regex(/^[a-f0-9]{16}$/).nullable(),
  stepIndex: Count,
  stepAttempts: cappedRecord(z.string().max(64), Count, RUN_STATE_RECORD_CAPS.stepAttempts),
  filledFieldKeys: cappedRecord(z.string().max(64), z.array(Key).max(500), RUN_STATE_RECORD_CAPS.filledFieldKeys),
  repeatableCounters: cappedRecord(Text(64), z.strictObject({ profile: Count, rendered: Count, addClicks: Count }),
    RUN_STATE_RECORD_CAPS.repeatableCounters),
  canarySet: z.array(Text(120)).max(32),
  tripwire: z.strictObject({ triggered: z.boolean(), hits: Count }),
  policyDecision: z.enum(['accepted', 'declined']).nullable(),
  revealEdges: z.array(z.tuple([Key, Key])).max(500),
  aiTasks: cappedRecord(z.string().max(64), Id, RUN_STATE_RECORD_CAPS.aiTasks),
  /** The drafts still waiting for the person, by stored base key (the Phase 6 review, E4). Keys only. */
  drafts: z.array(Key).max(MAX_RUN_STATE_DRAFTS).optional(),
  lastFill: z.strictObject({ flagged: Count, blocked: Count, unresolved: Count }).nullable(),
  startedAt: Count,
  updatedAt: Count,
});

const NoticeHit = z.strictObject({ kind: z.enum(['tripwire', 'policy', 'attention-check']), count: Count });

/** A repeatable section the frame's adapter shows on the step (Phase 5): its kind, and each block's profile entry when
 *  the frame holds an assignment from an earlier answer (null: the worker assigns them from the specs); and (the Phase
 *  7a review) the blocks that show a saved entry's summary, with its words by category (page text, as a spec's current
 *  value is), so the worker finds the entry each holds by its fingerprint. */
export const RepeatableRequestSchema = z.strictObject({
  kind: z.enum(REPEATABLE_KINDS),
  entries: z.array(Count.nullable()).max(MAX_REPEATABLE_BLOCKS).nullable(),
  shown: z.array(z.strictObject({
    block: Count.max(MAX_REPEATABLE_BLOCKS - 1),
    values: z.array(z.strictObject({ category: z.enum(SHOWN_CATEGORIES), text: z.string().min(1).max(300) }))
      .max(SHOWN_CATEGORIES.length),
  })).max(MAX_REPEATABLE_BLOCKS).optional(),
});

/** What the frame learns of a section it named: the profile's entry count, each block's entry (null: none) and
 *  whether that entry is a current job. Counts, indices and flags only. */
export const RepeatableAnswerSchema = z.strictObject({
  kind: z.enum(REPEATABLE_KINDS),
  profile: Count,
  entries: z.array(Count.nullable()).max(MAX_REPEATABLE_BLOCKS),
  current: z.array(z.boolean()).max(MAX_REPEATABLE_BLOCKS),
});

/** The launcher's place and hiding for one site (v3 Phase 3): `top` its place down the right edge as a fraction of the
 *  window's height (null: the default), `hidden` whether the person hid it on this site or everywhere. Value-free. */
export const LauncherPrefsSchema = z.strictObject({ top: z.number().min(0).max(1).nullable(), hidden: z.boolean() });
export type LauncherPrefs = z.infer<typeof LauncherPrefsSchema>;

/** The longest instruction Edit with AI's box takes (v3 Phase 3b): TailorIT's cap on a draft's `instruction`. */
export const MAX_EDIT_INSTRUCTION = AUTOFILL_AI_LIMITS.draft.instruction;

/** Who pressed a Submit (v3 Phase 4): the person on the page itself (a trusted click on the adapter's Submit), the
 *  person through the panel's Submit application, or Submit mode Auto. */
export const SUBMIT_PRESSERS = ['page', 'panel', 'auto'] as const;
export type SubmitPresser = (typeof SUBMIT_PRESSERS)[number];

/** What showed that an application was sent (v3 Phase 4): the platform's page after submitting (Lever's /thanks,
 *  Greenhouse's /confirmation), or its success message in the form's place (Ashby's, or Greenhouse's confirmation
 *  drawn in the same document). */
export const SUBMIT_EVIDENCE = ['confirmation-page', 'success-message'] as const;
export type SubmitEvidence = (typeof SUBMIT_EVIDENCE)[number];

/** The page's own buttons the panel may press for the person (v3 Phase 4): Next on a step the adapter says is not the
 *  last, Submit on the last. */
export const STEP_TARGETS = ['next', 'submit'] as const;
export type StepTarget = (typeof STEP_TARGETS)[number];

/** What starts a run: the launcher's trusted click, the side panel's Fill, a reload resuming one, or (v3 Phase 5) the
 *  auto-apply agent, from the worker alone, in the window it opened. */
export const RUN_TRIGGERS = ['launcher', 'panel', 'resume', 'agent'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** The account pages Sign-in mode Auto fills (v3 Phase 5): a sign-in, or an account's creation; and (v3 Phase 7b) an
 *  email gate, whose answer carries the email alone, never the password. */
export const SIGN_IN_WALLS = ['sign-in', 'create-account', 'email-gate'] as const;
export type SignInWall = (typeof SIGN_IN_WALLS)[number];

/** What came of the agent's press on a posting page's entry control (v3 Phase 5; agent/enter): 'pressed' (the
 *  adapter's declared Apply or Application, that one element), 'not-offered' (none shows, or a form shows already),
 *  'blocked' (a CAPTCHA, a sign-in or a code shows). */
export const ENTRY_OUTCOMES = ['pressed', 'not-offered', 'blocked'] as const;
export type EntryOutcome = (typeof ENTRY_OUTCOMES)[number];
/** What blocked an entry (v3 Phase 5 review): a sign-in or account page (Sign-in mode Manual, or none to use), a sign-in
 *  the site did not take, an email code, a CAPTCHA or bot check, or another choice (Workday's entry choice). */
export const ENTRY_BLOCKS = ['sign-in', 'sign-in-failed', 'email-code', 'captcha', 'other'] as const;
export type EntryBlock = (typeof ENTRY_BLOCKS)[number];

// ── Content script → worker (one-shot messages) ───────────────────────────────────────────────────────────────────

const v = z.literal(MESSAGE_VERSION);

const contentMessages = [
  z.strictObject({ v, type: z.literal('ping') }),
  /** A frame announces itself. The worker trusts the sender's address, never a URL in a payload. `nav` counts the
   *  address changes of a single-page application within this document (v2): the frame says hello again at each one
   *  while it shows a form, so the worker reads the side panel's job card again for the new posting. A count, never an
   *  address. */
  z.strictObject({ v, type: z.literal('frame/hello'), isTop: z.boolean(), hasForm: z.boolean(), nav: Count.optional(),
    /** v3 Phase 3: the frame's form asks for a cover letter (a file or text box its label names one), so the side panel
     *  shows the card's cover-letter row. A flag, never a label. */
    letter: z.literal(true).optional() }),
  /** Answers a run id and the content settings; never the profile. */
  z.strictObject({ v, type: z.literal('run/begin'), applicationKey: z.string().max(80),
    /** 'agent' (v3 Phase 5): the auto-apply agent's run, which the worker takes only from the tab it opened. */
    trigger: z.enum(RUN_TRIGGERS), dryRun: z.boolean() }),
  /** The frame's whole scan (`specs`, context for planning across the frame), the keys this pass plans (`planKeys`,
   *  each one a spec's key: the worker answers them only), and the page's canaries and notices (the Phase 3 review,
   *  LC-2); the repeatable sections the step shows (`repeatables`, Phase 5, each kind once). */
  z.strictObject({ v, type: z.literal('plan/request'), runId: Id, pass: Count, specs: z.array(FieldSpecSchema).max(500),
    planKeys: z.array(Key).max(500), canaries: z.array(Text(120)).max(32), notices: z.array(NoticeHit).max(10),
    repeatables: z.array(RepeatableRequestSchema).max(REPEATABLE_KINDS.length).optional(),
    /** Phase 6: the posting as the frame shows it (its visible text outside the form root), sent by the top frame
     *  while drafts are on: a draft's job text. Page text, never stored. */
    postingText: Text(MAX_POSTING_TEXT).optional(),
    /** The Phase 6 review (E2): the loop's reveal edges on this step, [parent, child] base keys (the writer whose write
     *  revealed the child), for a draft's context. Keys only. */
    revealEdges: z.array(z.tuple([Key, Key])).max(MAX_REVEAL_EDGES).optional(),
    /** The owner's amendments: this run fills from the profile only (its posting forbids AI, or its form holds an "I
     *  did not use AI" attestation, and the person's setting says so): the worker asks the LLM nothing. */
    noAi: z.literal(true).optional(),
    /** Phase G: the company and job title the frame's own page title names, sent with a pass that plans an upload (a
     *  dry run's too, whose check for the person's own letter needs them): a cover letter for a posting TailorIT does
     *  not have is asked for with them. Page text, never kept. */
    posting: PostingNamesSchema.optional() })
    .refine((message) => {
      const keys = new Set(message.specs.map((spec) => spec.key));
      return message.planKeys.every((key) => keys.has(key));
    }, { message: 'planKeys name keys that are not among specs', path: ['planKeys'] })
    .refine((message) => new Set((message.repeatables ?? []).map((section) => section.kind)).size
      === (message.repeatables ?? []).length, { message: 'a repeatable kind named twice', path: ['repeatables'] }),
  /** Writes for fields that were waiting for the LLM. */
  z.strictObject({ v, type: z.literal('plan/poll'), runId: Id, keys: z.array(Key).max(500) }),
  /** Edit with AI (the owner's amendments), on the person's trusted click on the button in one of this frame's text
   *  boxes, while its run rests: the frame's whole scan as plan/request carries it, the one field to rewrite
   *  (`fieldKey`, a spec's key), the canaries, the posting's visible text (the top frame only) and the reveal edges.
   *  Answered as plan/request is, the field awaiting its draft (then plan/poll). */
  z.strictObject({ v, type: z.literal('draft/rewrite'), runId: Id, fieldKey: Key,
    specs: z.array(FieldSpecSchema).max(500), canaries: z.array(Text(120)).max(32),
    postingText: Text(MAX_POSTING_TEXT).optional(),
    revealEdges: z.array(z.tuple([Key, Key])).max(MAX_REVEAL_EDGES).optional(),
    /** v3 Phase 3b: the person's instruction typed in Edit with AI's box ("Tell me what to add, change or improve"),
     *  at most 750 characters: the draft question's `instruction`. The person's own words, never kept or logged. */
    instruction: Text(MAX_EDIT_INSTRUCTION).optional() })
    .refine((message) => message.specs.some((spec) => spec.key === message.fieldKey),
      { message: 'fieldKey names no spec', path: ['fieldKey'] }),
  z.strictObject({ v, type: z.literal('runstate/get'), applicationKey: z.string().max(80) }),
  z.strictObject({ v, type: z.literal('runstate/put'), runState: RunStateSchema }),
  z.strictObject({ v, type: z.literal('runstate/clear'), applicationKey: z.string().max(80) }),
  z.strictObject({ v, type: z.literal('report/put'), runId: Id, report: FrameReportSchema }),
  /** v3 Phase 3: the run's progress while it fills (its live report: `filling` always set), for the panels only. The
   *  worker stores and shows it like report/put's, under the same limit, but it feeds neither the anonymous counters
   *  nor the accepted-match cache: its rows may still be waiting for their writes. */
  z.strictObject({ v, type: z.literal('report/live'), runId: Id, report: FrameReportSchema })
    .refine((message) => message.report.filling !== undefined, { message: 'a live report says how far it is',
      path: ['report', 'filling'] }),
  /** A posting page with no form saw a "do not use AI" pattern: its id only, never the text. */
  z.strictObject({ v, type: z.literal('policy/hit'), applicationKey: z.string().max(80), patternId: Text(40).nullable() }),
  /** Sent from the launcher's trusted click. */
  z.strictObject({ v, type: z.literal('panel/open') }),
  /** Phase 6: the in-page panel opened (`open` true) or closed in this frame, on the person's trusted click. While it
   *  is open, this frame alone receives report/update. */
  z.strictObject({ v, type: z.literal('panel/shown'), open: z.boolean() }),
  /** Phase 6, wave 2: the in-page panel's Save my answer, on the person's trusted click, for one of this frame's own
   *  fields. The worker treats it as the side panel's panel/saveAnswer for the sending frame: it reads the answer back
   *  with answer/read and sends it straight to TailorIT. */
  z.strictObject({ v, type: z.literal('answer/save'), fieldKey: Key }),
  /** The job card's relay (v2): the frame's answer to the worker's job/refresh. The worker looks the sender's own
   *  address up (job/lookup) or adds its posting to TailorIT (job/add), never an address in a payload, keeps the card in
   *  its memory and answers {}: no card data ever reaches the page's process. Taken only while a job/refresh of the same
   *  action waits for this document. */
  z.strictObject({ v, type: z.literal('job/lookup') }),
  z.strictObject({ v, type: z.literal('job/add') }),
  /** v3 Phase 3: the person dragged the launcher (a trusted drag of its grip) to `top`, its place down the right edge
   *  as a fraction of the window's height. The worker keeps it for the frame's site (storage.local). A number only. */
  z.strictObject({ v, type: z.literal('launcher/place'), top: z.number().min(0).max(1) }),
  /** v3 Phase 3: the person hid the launcher from its menu (a trusted click): on the frame's site, or everywhere
   *  (storage.local); "until next visit" only in the worker's memory, for the tab's page now, so the side panel can
   *  offer it back. Frame 0 only. */
  z.strictObject({ v, type: z.literal('launcher/hide'), scope: z.enum(['next-visit', 'site', 'everywhere']) }),
  /** v3 Phase 4: a Submit of this application was pressed in this frame: the person's trusted click on the adapter's
   *  Submit (`page`), or the press the panel's Submit application (`panel`) or Submit mode Auto (`auto`) made. The
   *  worker keeps it, with the run's job and resume, for SUBMIT_ARM_MS: only a confirmation seen after it records the
   *  application as Applied. */
  z.strictObject({ v, type: z.literal('submit/armed'), applicationKey: z.string().max(80),
    by: z.enum(SUBMIT_PRESSERS),
    /** The frame's run, when one filled the form (the person's own Submit included): the worker reads its job and
     *  resume from its own memory. */
    runId: Id.optional(),
    /** The run's resume upload verified on the form (its row): only then is the resume named to the tracker. */
    resume: z.literal(true).optional() }),
  /** v3 Phase 4: the platform's sign that the application was sent (its confirmation page, or its success message in
   *  the form's place), seen in this frame after a Submit was pressed. The worker records Applied in TailorIT only
   *  when this tab armed the same application within SUBMIT_ARM_MS. */
  z.strictObject({ v, type: z.literal('submit/detected'), applicationKey: z.string().max(80),
    evidence: z.enum(SUBMIT_EVIDENCE) }),
  /** v3 Phase 5, Sign-in mode Auto: the top frame's run paused at a sign-in (`sign-in`) or create-account
   *  (`create-account`) page and asks for the job-site sign-in of its own host. The worker reads the host from Chrome's
   *  sender address, never from a payload, fetches GET /credentials?host= only while the person chose Auto, the
   *  connection may read sign-ins and the disclosure was acknowledged, and answers it to this frame alone, once per
   *  tab, host and wall: the one message that ever carries the password. At an email gate (`email-gate`, v3 Phase 7b)
   *  the answer carries the email alone. */
  z.strictObject({ v, type: z.literal('signin/credential'), wall: z.enum(SIGN_IN_WALLS) }),
  /** Round 3 of the v3 Phase 6/7b review (X8): the auto-apply agent's entry press was made in this frame (press.ts
   *  pressEntry, for agent/enter), told at once, before the entry waits on what the press brings: a press that takes
   *  the document away ends it before agent/enter is answered. The worker takes it from the agent's tab's top frame,
   *  for a document it asked to enter, as the job begun. Nothing else. */
  z.strictObject({ v, type: z.literal('agent/entered') }),
  /** v3 Phase 8: the sentinel recognised its top frame (src/sentinel): why, from a closed list. The worker checks the
   *  frame's address again itself (Chrome's, never a payload's), limits the asks per tab and injects the content script
   *  into that one document. The only message a company's own page sends before then. */
  z.strictObject({ v, type: z.literal('page/recognised'), reason: z.enum(RECOGNITION_REASONS) }),
] as const;

/** Only the e2e build compiles this in: the content script reports that storage.local refused it. */
const e2eContentMessages = __E2E__
  ? [z.strictObject({ v, type: z.literal('e2e/probe'), storageLocal: z.enum(['refused', 'allowed']).optional(),
    /** The review: the document's start-up is over (its confirmation page's sign, if any, was told and answered). */
    settled: z.literal(true).optional() })]
  : [];

export const ContentMessageSchema = z.discriminatedUnion('type', [...contentMessages, ...e2eContentMessages]);
export type ContentMessage = z.infer<typeof ContentMessageSchema>;

// ── Extension pages (side panel, options) → worker ────────────────────────────────────────────────────────────────

const TabId = Count;
const FrameRef = { tabId: TabId, frameId: Count, fieldKey: Key };

/** The person's choice at a policy card: 'fill' is Fill anyway, 'cancel' is Cancel. */
export const POLICY_DECISIONS = ['fill', 'cancel'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/** The longest custom question (v2): TailorIT's cap on a draft's question (AUTOFILL_AI_LIMITS.draft.question). */
export const MAX_CUSTOM_QUESTION = 1000;
/** A custom question's answer length: Short, Medium or Long (AUTOFILL_CUSTOM_QUESTION_LENGTHS: 600, 1500, 3000). */
export const ASK_LENGTHS = ['short', 'medium', 'long'] as const;
export type AskLength = (typeof ASK_LENGTHS)[number];

/** What the worker asks the form frame to relay for the job card (v2): its lookup, or Add/Save to tracker. */
export const JOB_RELAY_ACTIONS = ['lookup', 'add'] as const;
export type JobRelayAction = (typeof JOB_RELAY_ACTIONS)[number];

/** A job of the tab's last "Autofill for another job" search, as the panel names it (v3 Phase 3b): its place in that
 *  search, never TailorIT's id. */
export const JobRefSchema = z.string().regex(/^j[0-9]$/);

export const PageMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('ping') }),
  z.strictObject({ v, type: z.literal('panel/fill'), tabId: TabId, dryRun: z.boolean() }),
  /** The toolbar's Continue and Cancel, for every frame that reported. Continue only resumes a pause; it never
   *  answers a policy card. */
  z.strictObject({ v, type: z.literal('panel/continue'), tabId: TabId }),
  z.strictObject({ v, type: z.literal('panel/cancel'), tabId: TabId }),
  /** The side panel's policy card: the decision for the one frame whose run waits at policy-notice. */
  z.strictObject({ v, type: z.literal('panel/policyDecision'), tabId: TabId, frameId: Count,
    decision: z.enum(POLICY_DECISIONS) }),
  z.strictObject({ v, type: z.literal('panel/focus'), ...FrameRef }),
  z.strictObject({ v, type: z.literal('panel/describe'), ...FrameRef }),
  z.strictObject({ v, type: z.literal('panel/confirmDraft'), ...FrameRef }),
  z.strictObject({ v, type: z.literal('panel/saveAnswer'), ...FrameRef }),
  z.strictObject({ v, type: z.literal('settings/get') }),
  /** The audit of 2026-11-06 (M4): `base`, the settings the page last read; the worker then applies only what the page
   *  changed from them onto the settings stored now, so a mode changed meanwhile elsewhere (the side panel's gear, the
   *  options page in another window) is kept. Without it, the settings sent are stored whole. */
  z.strictObject({ v, type: z.literal('settings/save'), settings: SettingsSchema, base: SettingsSchema.optional() }),
  z.strictObject({ v, type: z.literal('auth/status') }),
  z.strictObject({ v, type: z.literal('auth/startPairing') }),
  z.strictObject({ v, type: z.literal('auth/redeemCode'), code: z.string().regex(/^[0-9A-Za-z -]{16,24}$/) }),
  z.strictObject({ v, type: z.literal('auth/disconnect') }),
  /** v3 Phase 4 review: the person read the updated disclosure (AuthStatus.disclosure 'changed') and chose I
   *  understand: its version is kept with the connection. */
  z.strictObject({ v, type: z.literal('auth/acknowledgeDisclosure') }),
  z.strictObject({ v, type: z.literal('runs/clear') }),
  /** Phase 6: the anonymous counters, read and cleared by the options page. */
  z.strictObject({ v, type: z.literal('telemetry/get') }),
  z.strictObject({ v, type: z.literal('telemetry/clear') }),
  /** One read of a tab's reports; the `panel` port follows them (below). */
  z.strictObject({ v, type: z.literal('panel/reports'), tabId: TabId }),
  /** The side panel's job card (v2): what TailorIT knows of the job in the tab's form frame, from the worker's memory,
   *  or looked up through that frame (job/refresh) when the memory has none. */
  z.strictObject({ v, type: z.literal('panel/job'), tabId: TabId }),
  /** "Add this job to TailorIT" and "Save to tracker" (v2): the posting of the tab's form frame goes to TailorIT's jobs
   *  and the person's tracker (job/refresh {action: 'add'}). */
  z.strictObject({ v, type: z.literal('panel/addJob'), tabId: TabId }),
  /** The resume picker behind the card's Change (v2): the account's resumes, the one the card attaches marked. */
  z.strictObject({ v, type: z.literal('panel/resumes'), tabId: TabId }),
  /** The person chose the resume to attach in this tab (null: TailorIT's suggestion again). Kept in the worker's memory;
   *  the card is looked up again with it, and the tab's next fill attaches it. */
  z.strictObject({ v, type: z.literal('panel/setResume'), tabId: TabId, resumeId: Id.nullable() }),
  /** "Ask a custom question" (v2): the person's own question, answered by TailorIT's AI from the tab's active resume. */
  z.strictObject({ v, type: z.literal('panel/ask'), tabId: TabId, question: z.string().min(1).max(MAX_CUSTOM_QUESTION),
    length: z.enum(ASK_LENGTHS) }),
  /** The job card's cover letter (Phase G): whether the person has a letter for the tab's job (`write` false: TailorIT
   *  writes nothing), or Write it now (`write` true: TailorIT's AI writes one when there is none). States only. */
  z.strictObject({ v, type: z.literal('panel/letter'), tabId: TabId, write: z.boolean() }),
  /** v3 Phase 3: Skip on the field the run in that frame writes now (the side panel's, after 2 s on it). The frame gives
   *  that one write up and goes on; a key, never a value, and never a guard. */
  z.strictObject({ v, type: z.literal('panel/skip'), ...FrameRef }),
  /** v3 Phase 3: whether the launcher is hidden on the tab's site, or everywhere (the panel offers to show it again). */
  z.strictObject({ v, type: z.literal('panel/launcher'), tabId: TabId }),
  /** v3 Phase 3: "Show the TailorIT button again": the site's and the everywhere flag cleared, the tab's frames told. */
  z.strictObject({ v, type: z.literal('panel/showLauncher'), tabId: TabId }),
  /** v3 Phase 3b, "Autofill for another job": the person's tracked jobs whose title or company holds the words typed
   *  (GET /api/autofill/jobs/search). Answered with references to the search, never TailorIT's ids. */
  z.strictObject({ v, type: z.literal('panel/jobSearch'), tabId: TabId, query: Text(AUTOFILL_JOB_SEARCH_QUERY_MAX) }),
  /** v3 Phase 3b: the job the person chose from the tab's last search (`ref`), which the card, the match, the resume
   *  and the fill use for this page from now on (the lookup's `jobId`); null: the page's own match again. */
  z.strictObject({ v, type: z.literal('panel/chooseJob'), tabId: TabId, ref: JobRefSchema.nullable() }),
  /** v3 Phase 3b, "Ask TailorIT to support this site": the tab's host name, alone, to TailorIT. */
  z.strictObject({ v, type: z.literal('panel/siteRequest'), tabId: TabId }),
  /** v3 Phase 3b, "Your autofill information": the profile as TailorIT holds it, for the side panel's editor. */
  z.strictObject({ v, type: z.literal('panel/profile') }),
  /** v3 Phase 3b: the editor's save, from the revision it loaded; `sensitive` only where the connection may read and
   *  write it. Sent straight to TailorIT, never kept or logged. */
  z.strictObject({ v, type: z.literal('panel/saveProfile'), revision: Count, profile: AutofillProfileSchema,
    sensitive: AutofillSensitiveSchema.optional() }),
  /** v3 Phase 3b: Change's "Apply without resume" for this tab (`without` true: a fill attaches none, and the resume
   *  field is left to the person), or not (TailorIT's choice, or the resume chosen, again). */
  z.strictObject({ v, type: z.literal('panel/withoutResume'), tabId: TabId, without: z.boolean() }),
  /** v3 Phase 4: the panel's "Continue to the next page" or "Submit application", on the person's click in the side
   *  panel, for the frame whose report offers it. `confirmed`: the person confirmed a Submit with required fields
   *  still empty. */
  z.strictObject({ v, type: z.literal('panel/press'), tabId: TabId, frameId: Count, target: z.enum(STEP_TARGETS),
    confirmed: z.boolean() }),
  /** v3 Phase 4 review: Try again, when TailorIT's tracker could not be told of a submitted application (offline, or a
   *  server failure): the worker asks once more for the same submission. */
  z.strictObject({ v, type: z.literal('panel/retryApplied'), tabId: TabId }),
  /** v3 Phase 5: the auto-apply agent, as the options page and the side panel show it (value-free). */
  z.strictObject({ v, type: z.literal('agent/status') }),
  /** v3 Phase 8: Options › "Where Autofill works" › Company career sites: on only while the person turned it on and
   *  Chrome holds its permission. */
  z.strictObject({ v, type: z.literal('sites/get') }),
  /** v3 Phase 8: turns it on (the page asked Chrome for its permission on the person's click first) or off (the worker
   *  gives the permission back); the worker registers the sentinel while it is on. */
  z.strictObject({ v, type: z.literal('sites/set'), on: z.boolean() }),
  /** Options › "Run auto-apply": on or off. Turning it on needs the person's one-time confirmation (`confirmed`, once:
   *  the worker keeps it), a connection with agent:run and the disclosure acknowledged. */
  z.strictObject({ v, type: z.literal('agent/set'), on: z.boolean(), confirmed: z.literal(true).optional() }),
  /** The status's Stop: the job running now is left for the person (needs-you, cancelled), its window closed, and
   *  Run auto-apply turned off. */
  z.strictObject({ v, type: z.literal('agent/stop') }),
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

// ── The review panel's port (`panel`, extension pages only) ───────────────────────────────────────────────────────

/** What a tab's page holds (v2), read from the frame registry, never from an address: 'form' (a frame of ours found an
 *  application form; `platform` and `formKey` are the lowest such frame's), 'no-form' (frames of ours, none with a form:
 *  a posting page), 'none' (no frame of ours). `formKey` changes whenever that frame shows another document, so the side
 *  panel reads the job card again. */
export const PAGE_SUPPORT = ['form', 'no-form', 'none'] as const;
/** Where recording a submitted application stands (v3 Phase 4; PageState.submitted). */
export const SUBMITTED_STATES = ['recording', 'recorded', 'not-recorded', 'not-allowed'] as const;
export type SubmittedState = (typeof SUBMITTED_STATES)[number];
export const PageStateSchema = z.strictObject({
  support: z.enum(PAGE_SUPPORT),
  platform: z.enum(PLATFORMS).nullable(),
  formKey: Text(120).nullable(),
  /** v3 Phase 3: the form frame's form asks for a cover letter (its frame/hello said so). */
  letter: z.boolean().optional(),
  /** v3 Phase 3 review: no frame of ours is there, but the tab shows a page on an applicant-tracking host (one opened
   *  before the extension was installed or updated): reloading it brings Autofill. */
  reload: z.literal(true).optional(),
  /** v3 Phase 8 (the review's B10): the reload is a company's own page's, while the company career sites act: the
   *  sentinel reads a page once it is loaded again. */
  site: z.literal(true).optional(),
  /** v3 Phase 3b: no form, but the tab's top frame shows a posting a platform's parser reads: the job card shows. */
  posting: z.literal(true).optional(),
  /** The v3 Phase 4 review: no form, but the tab's top frame shows the platform's page after submitting: the card POST
   *  /applied answered shows, without Autofill. */
  confirmation: z.literal(true).optional(),
  /** v3 Phase 4: an application of the tab was submitted and its platform confirmed it, since the tab's page loaded:
   *  whether TailorIT's tracker now says Applied ('recorded'), is being told ('recording'), or could not be told
   *  ('not-recorded'; 'not-allowed': a connection made before tracker:write). */
  submitted: z.enum(SUBMITTED_STATES).optional(),
});
export type PageState = z.infer<typeof PageStateSchema>;

/** A tab's reports, one per frame that reported, by frame id. They hold labels and statuses, never a value. `page` is
 *  the tab's page state (v2; absent from an older worker). */
const TabReportsShape = { tabId: TabId, reports: z.array(FrameReportSchema).max(20), page: PageStateSchema.optional() };

/** What changed for every side panel (v2): the connection (a token stored or dropped, perhaps from another window) or
 *  the settings. */
export const PANEL_CHANGES = ['connection', 'settings', 'agent'] as const;

export const PanelPortMessageSchema = z.discriminatedUnion('type', [
  /** Page → worker: follow this tab (the side panel sends it again when the active tab changes). `side` (v3 Phase 3):
   *  the browser's side panel, not the report page, so the tab's launcher hides while it is open. */
  z.strictObject({ v, type: z.literal('panel/watch'), tabId: TabId, side: z.literal(true).optional() }),
  /** Worker → page: the watched tab's reports, once at the watch and again on every change. */
  z.strictObject({ v, type: z.literal('panel/update'), ...TabReportsShape }),
  /** Worker → page (v2): the connection or the settings changed. The panel reads them again, and drops a job card it
   *  read with the old connection at once. Nothing else: no token, no account, no setting. */
  z.strictObject({ v, type: z.literal('panel/changed'), what: z.enum(PANEL_CHANGES) }),
]);
export type PanelPortMessage = z.infer<typeof PanelPortMessageSchema>;

// ── TailorIT's connect page → worker (externally_connectable) ─────────────────────────────────────────────────────

export const ExternalMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('pair/complete'), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().regex(/^[0-9A-Za-z -]{16,24}$/) }),
]);
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>;

// ── Worker → content script ───────────────────────────────────────────────────────────────────────────────────────

export const WorkerToContentSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('run/start'), dryRun: z.boolean(),
    /** v3 Phase 5: the auto-apply agent's run (taken from the worker's own script alone): Next and Submit on Auto, the
     *  person's skip rules. `retry`: its one retry after the page refused its Submit. */
    agent: z.literal(true).optional(), retry: z.literal(true).optional() }),
  /** v3 Phase 5: the agent's tab shows a posting, not its form: press the adapter's declared entry control (Greenhouse's
   *  and Lever's Apply, Ashby's Application tab), that one element and nothing else. The worker's own script alone. */
  z.strictObject({ v, type: z.literal('agent/enter') }),
  /** Continue after a pause; it never answers the policy card (run/policyDecision does). */
  z.strictObject({ v, type: z.literal('run/continue') }),
  z.strictObject({ v, type: z.literal('run/cancel') }),
  /** The person's choice at the side panel's policy card, sent to this frame alone. */
  z.strictObject({ v, type: z.literal('run/policyDecision'), decision: z.enum(POLICY_DECISIONS) }),
  z.strictObject({ v, type: z.literal('field/focus'), fieldKey: Key }),
  /** The labels of a row's suggested options, fetched only when the row is expanded, never stored. */
  z.strictObject({ v, type: z.literal('field/describe'), fieldKey: Key }),
  /** Confirm an AI draft (the side panel's Confirm draft): the frame marks it confirmed, the person's own. */
  z.strictObject({ v, type: z.literal('draft/confirm'), fieldKey: Key }),
  /** Read an answer the person asked to save; the worker sends it straight to TailorIT and never stores it. */
  z.strictObject({ v, type: z.literal('answer/read'), fieldKey: Key }),
  /** The tab's combined report, for the frame that shows the in-page panel while it is open. */
  z.strictObject({ v, type: z.literal('report/update'), reports: z.array(FrameReportSchema).max(20) }),
  /** The person saved their settings (settings/save): the part a frame may know, so a run reads auto-advance as it is
   *  now, not as it was at run/begin (the Phase 5 review, C-S2). Sent to every registered frame with a form. */
  z.strictObject({ v, type: z.literal('settings/changed'), settings: ContentSettingsSchema }),
  /** Is this document still here? Sent to its {frameId, documentId} when another frame of the tab loads a document;
   *  the frame answers {pong: true}. Any answer keeps the frame; only "nothing receives here" lets it go, so a content
   *  script listens before it says frame/hello. */
  z.strictObject({ v, type: z.literal('frame/ping') }),
  /** The side panel wants this document's job card ('lookup'), or Add/Save to tracker ('add') (v2): the frame relays it
   *  as job/lookup or job/add, so the worker reads the frame's own address from Chrome, and answers {} once the worker
   *  answered that. It never learns what TailorIT said. */
  z.strictObject({ v, type: z.literal('job/refresh'), action: z.enum(JOB_RELAY_ACTIONS) }),
  /** A custom question's job text (v2): the posting's visible text outside the form root ('' in a frame inside another
   *  page) and the page's canaries. Page text, passed on and never kept. */
  z.strictObject({ v, type: z.literal('job/postingText') }),
  /** v3 Phase 3: the side panel's Skip, for the field this frame's run writes now. Answered `expired` when it writes
   *  another one, or none. */
  z.strictObject({ v, type: z.literal('run/skip'), fieldKey: Key }),
  /** v3 Phase 3: the launcher's place and whether the person hid it, for this frame's site (the worker's storage.local),
   *  sent when the person shows it again from the side panel. */
  z.strictObject({ v, type: z.literal('launcher/prefs'), launcher: LauncherPrefsSchema,
    /** The person asked for it back from the side panel: "Hide until next visit" is undone too. */
    shown: z.literal(true).optional() }),
  /** v3 Phase 3: the browser's side panel shows this tab (or no longer does): the launcher hides while it does. */
  z.strictObject({ v, type: z.literal('panel/side'), open: z.boolean() }),
  /** v3 Phase 4: the side panel's "Continue to the next page" or "Submit application", the person's click there, for
   *  this frame's run: it presses the adapter's own Next or Submit, and nothing else, if the step still offers it. */
  z.strictObject({ v, type: z.literal('run/press'), target: z.enum(STEP_TARGETS), confirmed: z.boolean() }),
  /** v3 Phase 8 (the review's P1/B8): the company career sites were turned off, or Chrome's permission taken back: the
   *  worker's alone, to every tab's top frame. A page the worker injected ends its run and removes its UI; the sentinel
   *  stops (platform/sentinel.ts reads it without this schema); a page on an ATS host ignores it. */
  z.strictObject({ v, type: z.literal('site/stop') }),
]);
export type WorkerToContent = z.infer<typeof WorkerToContentSchema>;

// ── Answers (data parts) ──────────────────────────────────────────────────────────────────────────────────────────

export const PingAnswerSchema = z.strictObject({ pong: z.literal(true) });
export const FrameHelloAnswerSchema = z.strictObject({
  frameId: Count,
  connected: z.boolean(),
  settings: ContentSettingsSchema,
  /** v3 Phase 3: the launcher's place and hiding for the frame's site (absent from an older worker). */
  launcher: LauncherPrefsSchema.optional(),
  /** v3 Phase 3 review: the browser's side panel shows the tab now (a top frame's hello only), so a page that loads
   *  beside it keeps its launcher hidden. */
  side: z.literal(true).optional(),
});
export const RunBeginAnswerSchema = z.strictObject({
  runId: Id,
  settings: ContentSettingsSchema,
  /** What the worker knows of the posting's AI policy before the frame reads its own visible text: a policy/hit from
   *  the posting page this browser session saw for this application ('unseen' when none was opened), and the policy
   *  patterns run over TailorIT's stored copy from the lookup ('unavailable' when there is none). States only, never
   *  text. A hit anywhere stops the run at policy-notice before anything is written. */
  policy: z.strictObject({
    postingPage: z.enum(['hit', 'clear', 'unseen']),
    storedCopy: z.enum(['hit', 'clear', 'unavailable']),
  }),
});
export const PlanAnswerSchema = z.strictObject({
  writes: z.array(PlannedWriteSchema).max(500),
  results: z.array(FrameReportSchema.shape.fields.element).max(500),
  awaiting: z.array(Key).max(500),
  /** Canaries the worker allows into RunState (none that equals a profile value). */
  persistableCanaries: z.array(Text(120)).max(32),
  /** One per section plan/request named (Phase 5); absent when it named none. */
  repeatables: z.array(RepeatableAnswerSchema).max(REPEATABLE_KINDS.length).optional(),
  /** The planned keys whose answer the person may save (Save my answer: the Phase 6 review, T6-1); absent: none. */
  savable: z.array(Key).max(500).optional(),
  /** The planned keys the page may offer Edit with AI on (the owner's amendments); absent: none. */
  aiEditable: z.array(Key).max(500).optional(),
  /** The frame's scan holds an "I did not use AI" attestation: the frame fills from the profile only from now on. */
  aiAttestation: z.literal(true).optional(),
});

/** An answer with nothing to report: runstate/clear, report/put, policy/hit, panel/open, panel/shown, panel/focus,
 *  panel/policyDecision, panel/confirmDraft, and a frame's answer to run/start, run/continue, run/cancel,
 *  run/policyDecision, field/focus, draft/confirm, report/update and settings/changed. A frame answers
 *  run/policyDecision {} once the decision settled its policy card, and `expired` when no run there waits at one; it
 *  answers draft/confirm `expired` when no draft of that field waits for the person. */
export const DoneAnswerSchema = z.strictObject({});

/**
 * What came of a Save my answer (Phase 6, wave 2): panel/saveAnswer's and answer/save's answer. 'saved': TailorIT keeps
 * it. Otherwise why it was not saved, which the panel says: 'sensitive' (a self-identification, legal, pay, consent or
 * attention-check question, which TailorIT never keeps: its 400, or the extension's own screen), 'limit' (the account
 * keeps 500: TailorIT's 409), 'unsupported' (a file, a list whose options were never read, an empty answer, or a kind
 * of field saved answers never fill), 'company-unknown' (a free-text answer is kept for one company, and this form's
 * address names none), 'canary' (the answer holds words hidden page text asked AI tools to write), 'not-allowed' (this
 * connection may not save answers: TailorIT's 403).
 */
export const SAVE_ANSWER_OUTCOMES = ['saved', 'sensitive', 'limit', 'unsupported', 'company-unknown', 'canary',
  'not-allowed'] as const;
export type SaveAnswerOutcome = (typeof SAVE_ANSWER_OUTCOMES)[number];
export const SaveAnswerAnswerSchema = z.strictObject({ outcome: z.enum(SAVE_ANSWER_OUTCOMES) });

/** A saved answer's value as the frame reads it back (TailorIT's AutofillSavedAnswerValue, within its caps): the
 *  chosen options' clean labels, never their positions; a text; or a lone box's state. */
export const SavedAnswerValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(5000) }),
  z.strictObject({ kind: z.literal('options'), labels: z.array(z.string().min(1).max(300)).min(1).max(50) }),
  z.strictObject({ kind: z.literal('checked'), checked: z.boolean() }),
]);

/** A frame's answer to answer/read: the field's answer as it holds it now and the option-set hash it shows, and the
 *  company its own address names ('<platform>:<board>', null: none; the Phase 6 review, E5), or why it cannot be saved
 *  ('unsupported': nothing to save, or a kind saved answers never fill; 'canary': it holds a word hidden page text
 *  asked AI tools to write; 'sensitive': no plan named the field savable, T6-1). Passed straight to TailorIT: never
 *  stored, never logged. */
export const AnswerReadAnswerSchema = z.union([
  z.strictObject({ optionSetHash: z.string().regex(/^(?:[a-f0-9]{16}|none)$/), answer: SavedAnswerValueSchema,
    company: z.string().max(220).regex(new RegExp(`^(?:${PLATFORMS.join('|')}):[^\\sA-Z]+$`)).nullable().optional() }),
  z.strictObject({ refused: z.enum(['unsupported', 'canary', 'sensitive']) }),
]);

/** runstate/get: this tab's RunState for the application, or null when there is none, it has expired (24 h after its
 *  last update) or another tab holds it (a run never resumes in another tab). */
export const RunStateGetAnswerSchema = z.strictObject({ runState: RunStateSchema.nullable() });

/** runstate/put: the worker's own clock at storing, which becomes the stored updatedAt (expiry runs from it). */
export const RunStatePutAnswerSchema = z.strictObject({ updatedAt: Count });

/** A frame's answer to field/describe, forwarded as panel/describe's: the visible labels of a row's suggested options,
 *  by option index. Fetched only when the row is expanded; never stored, never logged. */
export const FieldDescribeAnswerSchema = z.strictObject({
  options: z.array(z.strictObject({ index: Count, label: Text(300) })).max(3),
});

/** A frame's answer to job/postingText (v2): the posting's visible text outside the form root ('' in a frame inside
 *  another page), the page's canaries (the nearest 32), and whether the frame's visible text says AI-assisted
 *  applications are not allowed (`policy`, so the side panel shows that notice with the answer even before any run).
 *  Page text: passed to TailorIT with a custom question, never kept, never logged. */
export const JobPostingTextAnswerSchema = z.strictObject({
  text: Text(MAX_POSTING_TEXT),
  canaries: z.array(Text(120)).max(32),
  policy: z.boolean(),
  /** Phase G: the company and job title the frame's page title names (absent: it names none), for a cover letter the
   *  side panel writes for a posting TailorIT does not have. */
  names: PostingNamesSchema.optional(),
  /** The Phase G review (MINOR 5): the form's fields hold an "I did not use AI" statement (planFrame's reading), so the
   *  side panel's Write it now writes nothing before any run has said so. Absent: none. */
  attestation: z.literal(true).optional(),
});

// ── Answers to extension pages ────────────────────────────────────────────────────────────────────────────────────

/** settings/get and settings/save: the settings as stored. */
export const SettingsAnswerSchema = z.strictObject({ settings: SettingsSchema });

/** auth/status, and the answer to auth/redeemCode and auth/disconnect: the connection as the options page shows it.
 *  The token itself is never in it, nor in any other answer. */
export const AuthStatusSchema = z.strictObject({
  /** 'connected': a token is held. The other three hold none: 'expired' and 'revoked' (TailorIT answered 401) say why
   *  the last one went, until the worker restarts. */
  connection: z.enum(['connected', 'not-connected', 'expired', 'revoked']),
  /** The account's name and email, read from TailorIT's session into memory; null when not connected or not read. */
  account: z.strictObject({ name: Text(200), email: Text(254) }).nullable(),
  scopes: z.array(z.enum(EXTENSION_SCOPES)).max(EXTENSION_SCOPES.length),
  /** When the token expires, in ms since the epoch; null when not connected. */
  expiresAt: Count.nullable(),
  /** Whether Chrome agreed to keep storage.local away from content scripts. 'refused' blocks filling. */
  storageAccess: z.enum(['pending', 'restricted', 'refused']),
  /** TailorIT answered with another API version: nothing is filled until one side is updated. */
  versionMismatch: z.boolean(),
  /** A pairing started here and not completed yet: when it lapses, in ms since the epoch. */
  pairingExpiresAt: Count.nullable(),
  /** v3 Phase 4 review: while connected, whether the person has acknowledged the disclosure as it reads now
   *  ('current'), or it changed since they connected or last chose I understand ('changed': the side panel and the
   *  options page show it again; Submit mode Auto, recording Applied and the lookup as a page loads wait for it). */
  disclosure: z.enum(['current', 'changed']).optional(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

/** auth/startPairing: TailorIT's connect page was opened; the pairing lapses at `expiresAt` (ms since the epoch). */
export const StartPairingAnswerSchema = z.strictObject({ expiresAt: Count });

/** panel/fill, panel/continue and panel/cancel: how many frames of the tab the message reached. */
export const PanelSentAnswerSchema = z.strictObject({ frames: Count });

/** panel/reports: the tab's reports (the same shape the panel port pushes). */
export const TabReportsAnswerSchema = z.strictObject(TabReportsShape);
export type TabReports = z.infer<typeof TabReportsAnswerSchema>;

/** The job card's match (v2): the attached resume's keywords found in the job ("9 of 12 keywords", 75%), or why there
 *  is no number: the posting names no keywords, or the resume's text could not be read. */
export const JobCardMatchSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ok'), matchedCount: Count, total: z.number().int().positive(),
    percentage: z.number().int().min(0).max(100) })
    .refine((match) => match.matchedCount <= match.total, { message: 'more keywords found than the job names' }),
  z.strictObject({ state: z.literal('no-keywords') }),
  z.strictObject({ state: z.literal('unreadable') }),
]);
export type JobCardMatch = z.infer<typeof JobCardMatchSchema>;

/**
 * What the side panel's job card shows (v2): 'unavailable' when TailorIT could not say (it failed, or the frame did not
 * relay); else the job (null: not in the person's TailorIT jobs), their tracker entry, the resume a fill attaches (its
 * title, which may be the person's name, its file kind and why it was chosen), its match, and whether "Add this job to
 * TailorIT" can work from this page's address (Greenhouse's and Lever's own pages). Never an id, an address, the posting
 * text, a file name or the ATS reading; the date it was posted only as a time (ms), to say "2 days ago".
 */
export const JobCardSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unavailable') }),
  z.strictObject({
    state: z.literal('answered'),
    job: z.strictObject({ title: Text(300), company: Text(200), location: Text(300), closed: z.boolean(),
      postedAt: Count.nullable(), salary: Text(120).nullable(), workArrangement: z.enum(WORK_ARRANGEMENTS).nullable() })
      .nullable(),
    tracked: z.strictObject({ status: z.number().int(), archived: z.boolean() }).nullable(),
    resume: z.strictObject({ label: Text(200), fileKind: z.enum(AUTOFILL_FILE_KINDS), reason: z.enum(RESUME_CHOICE_REASONS) })
      .nullable(),
    match: JobCardMatchSchema.nullable(),
    addable: z.boolean(),
    /** v3 Phase 3b: the person chose "Apply without resume" for the tab: a fill attaches none. */
    withoutResume: z.literal(true).optional(),
    /** v3 Phase 3b: the job is the one the person chose with "Autofill for another job" (the lookup's `chosen`). */
    chosen: z.literal(true).optional(),
  }),
]);
export type JobCard = z.infer<typeof JobCardSchema>;

/** panel/job: the card of the tab's form frame; null when the tab shows no form of ours or the extension is not
 *  connected. */
export const PanelJobAnswerSchema = z.strictObject({ tabId: TabId, card: JobCardSchema.nullable() });
export type PanelJobAnswer = z.infer<typeof PanelJobAnswerSchema>;

/**
 * What came of Add this job to TailorIT or Save to tracker (v2), which the panel says: 'added' (new to TailorIT, now in
 * the tracker as Saved), 'saved' (TailorIT had it: it is in the tracker now), 'closed' (the ATS has no such posting any
 * more), 'unsupported' (TailorIT cannot add from this address), 'not-allowed' (this connection was made before adding
 * jobs existed: connect again), 'rate-limited', 'not-connected', 'unavailable' (TailorIT or the ATS could not be reached,
 * or the page did not answer). The card itself is read again with panel/job.
 */
export const ADD_JOB_OUTCOMES = ['added', 'saved', 'closed', 'unsupported', 'not-allowed', 'rate-limited', 'not-connected',
  'unavailable'] as const;
export type AddJobOutcome = (typeof ADD_JOB_OUTCOMES)[number];
export const AddJobAnswerSchema = z.strictObject({ outcome: z.enum(ADD_JOB_OUTCOMES) });

/** v3 Phase 8: page/recognised's answer: the content script was injected into the frame (or was there already). */
export const PageRecognisedAnswerSchema = z.strictObject({ injected: z.boolean() });
/** v3 Phase 8: Options › "Where Autofill works" › Company career sites: turned on by the person, and Chrome holding its
 *  permission (it acts only with both). */
export const SitesStateSchema = z.strictObject({ on: z.boolean(), granted: z.boolean() });
export type SitesState = z.infer<typeof SitesStateSchema>;

/** panel/resumes: the account's resumes as the picker lists them (title, file kind, built or uploaded), the one the
 *  tab's card attaches marked `current`. Never a file name. */
export const ResumeListAnswerSchema = z.strictObject({
  items: z.array(z.strictObject({ id: Id, label: Text(200), fileKind: z.enum(AUTOFILL_FILE_KINDS),
    kind: z.enum(AUTOFILL_RESUME_KINDS), current: z.boolean() })).max(200),
});
export type ResumeListAnswer = z.infer<typeof ResumeListAnswerSchema>;

/**
 * What came of a custom question (v2): the answer and the title of the resume it was written from; or why there is
 * none: 'no-resume' (the account has no resume to write from), 'sensitive' (a self-identification, legal, pay or consent
 * question, or an attention check: never sent to the AI, by the extension's own screen or TailorIT's), 'unusable' (the
 * AI's answer failed a check: a canary, talk of being an AI, a foreign link), 'rate-limited', 'not-connected',
 * 'unavailable' (TailorIT's AI could not answer just now), 'ai-off' (AI-written answers, the drafts setting, are turned
 * off: nothing is sent). An answer says whether the posting says AI-assisted applications are not allowed (`policy`:
 * the form frame's visible text, or a notice a run of the tab raised), so the panel shows that notice with it. Kept in
 * the side panel's memory only.
 */
export const ASK_REFUSALS = ['no-resume', 'sensitive', 'unusable', 'rate-limited', 'not-connected', 'unavailable',
  'ai-off'] as const;
export const ASK_OUTCOMES = ['answered', ...ASK_REFUSALS] as const;
export type AskOutcome = (typeof ASK_OUTCOMES)[number];
export const PanelAskAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('answered'), text: Text(3000).min(1), resumeLabel: Text(200), policy: z.boolean() }),
  z.strictObject({ outcome: z.enum(ASK_REFUSALS) }),
]);
export type PanelAskAnswer = z.infer<typeof PanelAskAnswerSchema>;

/**
 * What the job card's cover-letter row says (Phase G; panel/letter), states only: 'yours' (a finished letter of the
 * person's for this job), 'written' (TailorIT's AI has just written it: Write it now), 'none' (no letter for this job:
 * one is written when the form asks for one), 'failed' (TailorIT could not write one, or the person's own is not
 * finished), 'ai-off' (AI-written answers are off, or the posting forbids AI: nothing is written), 'not-allowed' (this
 * connection was made before cover letters: connect again), 'rate-limited', 'not-connected', 'unavailable' (TailorIT
 * could not be asked: no job facts, no resume, or it failed). Never a letter's id or a word of it.
 */
export const LETTER_OUTCOMES = ['yours', 'written', 'none', 'failed', 'ai-off', 'not-allowed', 'rate-limited',
  'not-connected', 'unavailable'] as const;
export type LetterOutcome = (typeof LETTER_OUTCOMES)[number];
export const PanelLetterAnswerSchema = z.strictObject({ outcome: z.enum(LETTER_OUTCOMES) });
export type PanelLetterAnswer = z.infer<typeof PanelLetterAnswerSchema>;

/** panel/launcher (v3 Phase 3): where the person hid the launcher of the tab's site: nowhere, on that site, or on every
 *  site. */
export const PanelLauncherAnswerSchema = z.strictObject({ hidden: z.enum(['none', 'visit', 'site', 'everywhere']) });
export type PanelLauncherAnswer = z.infer<typeof PanelLauncherAnswerSchema>;

/** panel/jobSearch (v3 Phase 3b): the jobs found, each with the reference panel/chooseJob takes, its title, company and
 *  where it is; or why there are none ('not-allowed': a connection made before version 3; 'not-connected';
 *  'rate-limited'; 'unavailable'). Never TailorIT's id. */
export const JOB_SEARCH_REFUSALS = ['not-allowed', 'not-connected', 'rate-limited', 'unavailable'] as const;
export type JobSearchRefusal = (typeof JOB_SEARCH_REFUSALS)[number];
export const PanelJobSearchAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('found'), items: z.array(z.strictObject({ ref: JobRefSchema, title: Text(300),
    company: Text(200), location: Text(300) })).max(AUTOFILL_JOB_SEARCH_MAX) }),
  z.strictObject({ outcome: z.enum(JOB_SEARCH_REFUSALS) }),
]);
export type PanelJobSearchAnswer = z.infer<typeof PanelJobSearchAnswerSchema>;

/** panel/siteRequest (v3 Phase 3b): 'sent'; 'no-host' (the browser did not say which site the tab shows: the toolbar
 *  icon lets the extension read the tab's address for that tab, while it stays on the same origin); 'not-allowed',
 *  'not-connected', 'rate-limited', 'unavailable'. */
export const SITE_REQUEST_OUTCOMES = ['sent', 'no-host', 'not-allowed', 'not-connected', 'rate-limited',
  'unavailable'] as const;
export type SiteRequestOutcome = (typeof SITE_REQUEST_OUTCOMES)[number];
export const PanelSiteRequestAnswerSchema = z.strictObject({ outcome: z.enum(SITE_REQUEST_OUTCOMES) });

/** panel/profile (v3 Phase 3b): the profile as TailorIT holds it (the person's own data, for their editor), its
 *  revision, the note's lines TailorIT keeps from the AI (`flaggedLines`), whether this connection may save it
 *  (profile:write) and the sensitive part when it may read it (profile:sensitive). Shown in the side panel only, kept
 *  in its memory while the editor is open, never stored or logged. */
export const ProfileViewSchema = z.strictObject({
  revision: Count,
  profile: AutofillProfileSchema,
  flaggedLines: z.array(Count).max(500),
  canWrite: z.boolean(),
  sensitive: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('shared'), value: AutofillSensitiveSchema }),
    z.strictObject({ state: z.literal('not-shared') }),
    z.strictObject({ state: z.literal('unavailable') }),
  ]),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;

/** panel/saveProfile (v3 Phase 3b): 'saved', with the new revision and the note's lines TailorIT keeps from the AI;
 *  else 'conflict' (it changed elsewhere since it was loaded: load it again), 'invalid' (TailorIT refused a value),
 *  'not-allowed' (this connection may not change the profile: connect again), 'not-connected', 'rate-limited',
 *  'unavailable'. */
export const PROFILE_SAVE_REFUSALS = ['conflict', 'invalid', 'not-allowed', 'not-connected', 'rate-limited',
  'unavailable'] as const;
export type ProfileSaveRefusal = (typeof PROFILE_SAVE_REFUSALS)[number];
export const PanelSaveProfileAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('saved'), revision: Count, flaggedLines: z.array(Count).max(500) }),
  z.strictObject({ outcome: z.enum(PROFILE_SAVE_REFUSALS) }),
]);
export type PanelSaveProfileAnswer = z.infer<typeof PanelSaveProfileAnswerSchema>;

/** panel/press and run/press (v3 Phase 4): 'pressed' (the page's own Next or Submit was clicked); 'required-empty' (a
 *  Submit with required fields still empty, `count` of them, that the person did not confirm); 'not-offered' (the step
 *  no longer offers that button: another step, a step not final, a button hidden or disabled); 'blocked' (a CAPTCHA,
 *  a sign-in or a code shows: the person's); 'refused' (assertNotSubmit refused the click); 'busy' (the run works);
 *  'gone' (no run there); 'not-accepted' (the review: the page's own checks refused it, `count` fields marked: a form's
 *  validation during the click, or a Next that left the step where it was with errors shown). */
export const PRESS_OUTCOMES = ['pressed', 'required-empty', 'not-offered', 'blocked', 'refused', 'busy', 'gone',
  'not-accepted'] as const;
export type PressOutcome = (typeof PRESS_OUTCOMES)[number];
export const PressAnswerSchema = z.strictObject({ outcome: z.enum(PRESS_OUTCOMES), count: Count.optional() });
export type PressAnswer = z.infer<typeof PressAnswerSchema>;

/** agent/enter's answer (v3 Phase 5). */
export const EntryAnswerSchema = z.strictObject({ outcome: z.enum(ENTRY_OUTCOMES), block: z.enum(ENTRY_BLOCKS).optional() });
export type EntryAnswer = z.infer<typeof EntryAnswerSchema>;

/** signin/credential's answer (v3 Phase 5): the job-site sign-in for the frame's own host, to that frame alone. The one
 *  message that carries a password: never logged, stored or put in a report. `host`: the sign-in's own host, or `*`
 *  (the one for every site, used only on a host signInHostCovered covers), which the frame checks against its own. */
export const SignInCredentialAnswerSchema = z.strictObject({
  host: AutofillSignInHostSchema,
  email: z.string().min(1).max(AUTOFILL_SIGN_IN_LIMITS.email),
  /** Absent only in the answer for an email gate (v3 Phase 7b), which types the email alone. */
  password: z.string().min(1).max(AUTOFILL_SIGN_IN_LIMITS.password).regex(/^[^\r\n]*$/).optional(),
});
export type SignInCredential = z.infer<typeof SignInCredentialAnswerSchema>;

/** Why the auto-apply agent cannot run now (v3 Phase 5): not connected, a connection without agent:run (made before
 *  version 3), the disclosure not acknowledged as it reads now, no browser window of the person's open, or (the audit
 *  of 2026-11-06, M5) the browser offline, so no job is taken. */
export const AGENT_BLOCKS = ['not-connected', 'no-scope', 'disclosure', 'no-window', 'offline'] as const;
export type AgentBlock = (typeof AGENT_BLOCKS)[number];
/** Why the agent paused itself, Run auto-apply off until the person turns it on again (the audit of 2026-11-06): the
 *  browser opened no window for a job, jobs in a row whose pages did not load (M5), or the person closed its window,
 *  which is their Stop (m14). */
export const AGENT_PAUSES = ['no-window', 'page-errors', 'window-closed'] as const;
export type AgentPause = (typeof AGENT_PAUSES)[number];
/** Where the agent stands: off; on and waiting for a job (the queue empty, or its next look); on and running one; on
 *  but blocked (AGENT_BLOCKS). */
export const AGENT_PHASES = ['off', 'waiting', 'running', 'blocked'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

/** agent/status, agent/set and agent/stop's answer (v3 Phase 5): value-free. `job` is the queued job's company and
 *  title as TailorIT named them; `doneToday` the jobs it finished today (this browser's day); `last` the latest result's
 *  state and reason. */
export const AgentStatusSchema = z.strictObject({
  on: z.boolean(),
  /** The person confirmed, once, that applications will be submitted unattended with AI-guessed answers. */
  confirmed: z.boolean(),
  phase: z.enum(AGENT_PHASES),
  blocked: z.enum(AGENT_BLOCKS).nullable(),
  /** While off: why the agent paused itself (AGENT_PAUSES); null or absent when the person turned it off. */
  paused: z.enum(AGENT_PAUSES).nullable().optional(),
  /** Run auto-apply may be turned on now: connected with agent:run, the disclosure acknowledged. */
  allowed: z.boolean(),
  /** A result is kept that TailorIT has not taken yet (offline, its failure): it is sent again (the review). */
  pending: z.boolean(),
  job: z.strictObject({ company: Text(200), title: Text(300) }).nullable(),
  doneToday: Count,
  last: z.strictObject({ state: z.enum(AUTOFILL_AGENT_FINISHED_STATES), reason: z.enum(AUTOFILL_AGENT_REASONS).nullable() })
    .nullable(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** runs/clear: how many stored runs were removed. */
export const RunsClearAnswerSchema = z.strictObject({ cleared: Count });

/** One anonymous count: the spec's five fields (closed lists and a boolean) and how many times they were counted.
 *  Nothing else: no key, label, address, account, time or version (core/telemetry/events.ts). */
export const TelemetryCountSchema = z.strictObject({
  platform: z.enum(PLATFORMS),
  fieldKind: z.enum(FIELD_KINDS),
  matcherStage: z.enum(MATCHER_STAGES),
  outcome: z.enum(TELEMETRY_OUTCOMES),
  tripwireTriggered: z.boolean(),
  count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/** telemetry/get and telemetry/clear: the counts as storage.local holds them (none after a clear, or before the
 *  person opted in), one per combination of the five fields. */
export const TelemetryAnswerSchema = z.strictObject({ counts: z.array(TelemetryCountSchema).max(MAX_TELEMETRY_COUNTS) });
export type TelemetryAnswer = z.infer<typeof TelemetryAnswerSchema>;

// ── Which answer goes with which message ──────────────────────────────────────────────────────────────────────────

/** The data schema of the worker's answer to each content message (wrap it in envelope.ts's answerSchema). The e2e
 *  build's probe answers {} and is left out, so production bundles never name it. */
export const CONTENT_ANSWER_SCHEMAS = {
  ping: PingAnswerSchema,
  'frame/hello': FrameHelloAnswerSchema,
  'run/begin': RunBeginAnswerSchema,
  'plan/request': PlanAnswerSchema,
  'plan/poll': PlanAnswerSchema,
  'draft/rewrite': PlanAnswerSchema,
  'runstate/get': RunStateGetAnswerSchema,
  'runstate/put': RunStatePutAnswerSchema,
  'runstate/clear': DoneAnswerSchema,
  'report/put': DoneAnswerSchema,
  'report/live': DoneAnswerSchema,
  'policy/hit': DoneAnswerSchema,
  'panel/open': DoneAnswerSchema,
  'panel/shown': DoneAnswerSchema,
  'answer/save': SaveAnswerAnswerSchema,
  'job/lookup': DoneAnswerSchema,
  'job/add': DoneAnswerSchema,
  'launcher/place': DoneAnswerSchema,
  'launcher/hide': DoneAnswerSchema,
  'submit/armed': DoneAnswerSchema,
  'submit/detected': DoneAnswerSchema,
  'signin/credential': SignInCredentialAnswerSchema,
  'agent/entered': DoneAnswerSchema,
  'page/recognised': PageRecognisedAnswerSchema,
} as const satisfies Record<Exclude<ContentMessage['type'], 'e2e/probe'>, z.ZodType>;

/** The data schema of the worker's answer to each page message. */
export const PAGE_ANSWER_SCHEMAS = {
  ping: PingAnswerSchema,
  'panel/fill': PanelSentAnswerSchema,
  'panel/continue': PanelSentAnswerSchema,
  'panel/cancel': PanelSentAnswerSchema,
  'panel/policyDecision': DoneAnswerSchema,
  'panel/focus': DoneAnswerSchema,
  'panel/describe': FieldDescribeAnswerSchema,
  'panel/confirmDraft': DoneAnswerSchema,
  'panel/saveAnswer': SaveAnswerAnswerSchema,
  'panel/reports': TabReportsAnswerSchema,
  'panel/job': PanelJobAnswerSchema,
  'panel/addJob': AddJobAnswerSchema,
  'panel/resumes': ResumeListAnswerSchema,
  'panel/setResume': DoneAnswerSchema,
  'panel/ask': PanelAskAnswerSchema,
  'panel/letter': PanelLetterAnswerSchema,
  'panel/skip': DoneAnswerSchema,
  'panel/launcher': PanelLauncherAnswerSchema,
  'panel/showLauncher': DoneAnswerSchema,
  'panel/jobSearch': PanelJobSearchAnswerSchema,
  'panel/chooseJob': DoneAnswerSchema,
  'panel/siteRequest': PanelSiteRequestAnswerSchema,
  'panel/profile': ProfileViewSchema,
  'panel/saveProfile': PanelSaveProfileAnswerSchema,
  'panel/withoutResume': DoneAnswerSchema,
  'panel/retryApplied': DoneAnswerSchema,
  'panel/press': PressAnswerSchema,
  'settings/get': SettingsAnswerSchema,
  'settings/save': SettingsAnswerSchema,
  'auth/status': AuthStatusSchema,
  'auth/startPairing': StartPairingAnswerSchema,
  'auth/redeemCode': AuthStatusSchema,
  'auth/disconnect': AuthStatusSchema,
  'auth/acknowledgeDisclosure': AuthStatusSchema,
  'runs/clear': RunsClearAnswerSchema,
  'telemetry/get': TelemetryAnswerSchema,
  'telemetry/clear': TelemetryAnswerSchema,
  'agent/status': AgentStatusSchema,
  'agent/set': AgentStatusSchema,
  'agent/stop': AgentStatusSchema,
  'sites/get': SitesStateSchema,
  'sites/set': SitesStateSchema,
} as const satisfies Record<PageMessage['type'], z.ZodType>;

/** The data schema of a frame's answer to each message the worker sends it. */
export const FRAME_ANSWER_SCHEMAS = {
  'run/start': DoneAnswerSchema,
  'run/continue': DoneAnswerSchema,
  'run/cancel': DoneAnswerSchema,
  'run/policyDecision': DoneAnswerSchema,
  'field/focus': DoneAnswerSchema,
  'field/describe': FieldDescribeAnswerSchema,
  'draft/confirm': DoneAnswerSchema,
  'answer/read': AnswerReadAnswerSchema,
  'report/update': DoneAnswerSchema,
  'settings/changed': DoneAnswerSchema,
  'frame/ping': PingAnswerSchema,
  'job/refresh': DoneAnswerSchema,
  'job/postingText': JobPostingTextAnswerSchema,
  'run/skip': DoneAnswerSchema,
  'launcher/prefs': DoneAnswerSchema,
  'panel/side': DoneAnswerSchema,
  'run/press': PressAnswerSchema,
  'agent/enter': EntryAnswerSchema,
  'site/stop': DoneAnswerSchema,
} as const satisfies Record<WorkerToContent['type'], z.ZodType>;

/** pair/complete's answer: {} once the code is redeemed (TailorIT's page reads only `ok`). */
export const EXTERNAL_ANSWER_SCHEMAS = { 'pair/complete': DoneAnswerSchema } as const satisfies Record<ExternalMessage['type'], z.ZodType>;

// ── The resume port ───────────────────────────────────────────────────────────────────────────────────────────────

/** 256 KiB chunks, base64; at most 40 of them (10 MiB). The cover letter (Phase G) travels the same way, under the same
 *  cap (TailorIT's AUTOFILL_COVER_LETTER_MAX_BYTES is its resume cap). */
export const RESUME_CHUNK_BYTES = 262_144;
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

/** The transfer's own messages, after the request (the resume port's and the preview port's). */
const TRANSFER_MESSAGES = [
  z.strictObject({ v, type: z.literal('resume/header'), name: Text(255), mime: Text(100), size: Count.max(RESUME_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), chunkCount: Count.max(40) }),
  z.strictObject({ v, type: z.literal('resume/chunk'), index: Count.max(39), data: z.string().max(Math.ceil(RESUME_CHUNK_BYTES / 3) * 4) }),
  z.strictObject({ v, type: z.literal('resume/ack'), index: Count.max(39) }),
  z.strictObject({ v, type: z.literal('resume/end') }),
  z.strictObject({ v, type: z.literal('resume/done'), ok: z.boolean() }),
  z.strictObject({ v, type: z.literal('resume/error'), reason: z.enum(['resume-unavailable', 'resume-transfer-failed',
    'resume-format-unsupported', 'pdf-only-input']) }),
] as const;

export const ResumePortMessageSchema = z.discriminatedUnion('type', [
  /** Phase G: `document` names what the write takes, the run's resume (absent, or 'resume') or its cover letter; the
   *  rest of the transfer is the same for both. */
  z.strictObject({ v, type: z.literal('resume/request'), runId: Id, document: z.enum(FILE_REFS).optional() }),
  ...TRANSFER_MESSAGES,
]);

/** The `preview` port (v3 Phase 3b): the side panel's PDF preview of the resume a fill of the tab attaches. The panel
 *  posts preview/request {tabId}; the worker answers as the resume port does (resume/header, resume/chunk, each
 *  acknowledged with resume/ack, resume/end, then the panel's resume/done; resume/error), from the same checked fetch,
 *  a PDF only. Extension pages only: the bytes never reach a page's process. */
export const PreviewPortMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('preview/request'), tabId: TabId }),
  ...TRANSFER_MESSAGES,
]);
