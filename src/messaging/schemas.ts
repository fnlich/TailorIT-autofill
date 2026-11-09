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
import { AUTOFILL_AI_LIMITS } from '../contract/tailorit/ai';
import { AutofillSignInHostSchema, AUTOFILL_SIGN_IN_LIMITS } from '../contract/tailorit/credentials';
import { FIELD_FORMATS, FIELD_KINDS, FIELD_VISIBILITIES, LABEL_SOURCES, MATCHER_STAGES,
  PLATFORMS } from '../core/enums';
import { MAX_REVEAL_EDGES } from '../core/loop/bookkeeping';
import { MAX_SEARCH_QUERIES } from '../core/matcher/searchLimits';
import { SHOWN_CATEGORIES } from '../core/steps/blocks';
import { REASON_CODES } from '../core/types/fill';
import { ANSWER_BASES, FILE_REFS, RULE_IDS } from '../core/types/intent';
import { MATCH_FLAGS, MATCH_RULES } from '../core/types/match';
import { MAX_REPEATABLE_BLOCKS, MAX_RUN_STATE_DRAFTS, MAX_STEPS, PAUSE_REASONS, REPEATABLE_KINDS, RUN_STATUSES } from
  '../core/types/run';
import {
  LEARNED_KEY, MAX_LEARNED_LABEL, MAX_LEARNED_OPTIONS, MAX_LEARNED_PER_HOST, STORED_LIST_IDS,
} from '../shared/learned-lists';
import { RECOGNITION_REASONS } from '../shared/recognition';
import { FrameReportSchema } from '../shared/report';
import { ContentSettingsSchema } from '../shared/settings';
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
  z.strictObject({ kind: z.literal('files'), count: Count, held: z.literal(true).optional(),
    names: z.array(Text(300)).max(20).optional() }),
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
  /** The core pass of 2026-11-06: the field's own label, past its 300 characters, states that no AI was used. */
  statesNoAi: z.literal(true).optional(),
  required: z.boolean(),
  options: z.union([z.array(OptionSchema).max(5000), z.literal('lazy')]),
  /** A widget's list read only in part: the planner matches it exactly or not at all. */
  optionsPartial: z.literal(true).optional(),
  /** v4 (drop): the options are what one typed query showed, not the field's list: chosen from in the fill band only. */
  searchResults: z.literal(true).optional(),
  /** s2 core-wd: the options are what the list's own "Other" query showed: only that "Other" is chosen from them. */
  searchOther: z.literal(true).optional(),
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
  /** v4 (drop): a search's candidate answers, typed one at a time (core/matcher/candidates.ts), MAX_SEARCH_QUERIES at
   *  most. */
  z.strictObject({ kind: z.literal('query'), queries: z.array(Text(300)).max(MAX_SEARCH_QUERIES),
    /** s2 core-wd: once the queries find nothing, the list's own "Other" is searched for (NO_MATCH_OTHER_QUERY). */
    other: z.literal(true).optional() }),
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
 *  drawn in the same document). // v5 p2-detect: or (`network`) the answer to the platform's own request that sends the
 *  application, seen by the page-world submit watcher in the arming document (content/submitted.ts watchNetworkSigns). */
export const SUBMIT_EVIDENCE = ['confirmation-page', 'success-message',
  // v5 p2-detect
  'network'] as const;
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

/** s2 profile (the review fix P1): what a page with no form waits for while no run holds it, as its wall's toast says
 *  (content/runtime.ts showWallToast): a check to solve, a sign-in to make there (or the saved one failed), or a
 *  job-site sign-in to add in TailorIT. The side panel says it when the page's toasts are not shown until closed. */
export const WALL_WAITS = ['challenge', 'sign-in', 'sign-in-failed', 'no-sign-in'] as const;
export type WallWaits = (typeof WALL_WAITS)[number];

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
    letter: z.literal(true).optional(),
    // ── snapshot build 2026-11-06 (core-x, items 3, 7 and 14) ──
    /** The top frame is a company's wrapper that draws the application in a frame of its own (Adapter.applicationFrame:
     *  iCIMS's iframe#icims_content_iframe): the agent acts in that frame, not here. */
    wraps: z.literal(true).optional(),
    /** A subframe whose adapter claims the tab's application: the wrapper's own application frame, directly below it,
     *  on its origin, at the same application (content/runtime.ts claimsApplication). */
    claimed: z.literal(true).optional(),
    /** A page whose address names no job but continues an application (adapters/chain.ts): a top frame's names its
     *  referrer's hash (`from`, 16 hex digits, never an address), a subframe's says only that it is one (`frame`: the
     *  security fix of 2026-11-06, S4, the worker reads the tab's frame registry). The worker keys it by that
     *  application where its rules allow (background/chain.ts). */
    chain: z.union([z.strictObject({ from: z.string().regex(/^[0-9a-f]{16}$/) }),
      z.strictObject({ frame: z.literal(true) })]).optional() }),
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
  // ── v4 run (docs/SPEC-AMENDMENTS.md §13) ──
  /** v4: the frame's account wall (a sign-in, a create-account page, an email gate) as it shows now, or null once it
   *  went; sent by a tab's top frame or the frame that claims its application, at each change (content/runtime.ts). The
   *  worker keeps it on the frame's registry entry, for PageState.wall (the side panel's "Sign up & Autofill"). */
  z.strictObject({ v, type: z.literal('frame/wall'), wall: z.enum(SIGN_IN_WALLS).nullable(),
    /** The page shows a choice of how to apply that its adapter answers with a declared entry (Workday's "Start Your
     *  Application": Apply Manually): Autofill there presses it (D7). */
    choice: z.literal(true).optional(),
    /** s2 profile (P1): what the page waits for now, as its wall's toast says (WALL_WAITS); absent: nothing. */
    waits: z.enum(WALL_WAITS).optional(),
    // v5 p2-fill: a posting page with no form whose adapter offers its own Apply now (Adapter.entryControl, from its
    // fixtures): the panel's main button reads "Open Application" there and presses it (content/runtime.ts atWall).
    entry: z.literal(true).optional() }),
  /** v3 Phase 8: the sentinel recognised its top frame (src/sentinel): why, from a closed list. The worker checks the
   *  frame's address again itself (Chrome's, never a payload's), limits the asks per tab and injects the content script
   *  into that one document. The only message a company's own page sends before then. */
  z.strictObject({ v, type: z.literal('page/recognised'), reason: z.enum(RECOGNITION_REASONS) }),
  // ── s2 lists (snapshot round 2, decision 1: learned lists) ──
  /** The lists the sending frame's host showed before (background/learned-lists.ts), and the stored lists of the ids
   *  its scan's adapter names (`stored`: background/stored-lists.ts, the lists the content script never carries),
   *  asked before a step's loop where the scan holds a learnable dropdown or a stored list not served yet
   *  (dom/widgets/known.ts). The worker reads the host from Chrome's sender address, never a payload. Answered
   *  LearnedListsAnswerSchema. */
  z.strictObject({ v, type: z.literal('lists/known'),
    stored: z.array(z.enum(STORED_LIST_IDS)).max(STORED_LIST_IDS.length).optional() }),
  /** A learnable dropdown's complete whole read: its label's key (the first 16 hex digits of its slug's SHA-256) and
   *  its option labels (page text, never a value), kept for the sender's host. Nothing is kept from a private tab. */
  z.strictObject({ v, type: z.literal('lists/learn'), key: z.string().regex(LEARNED_KEY),
    labels: z.array(z.string().min(1).max(MAX_LEARNED_LABEL)).min(1).max(MAX_LEARNED_OPTIONS) }),
  // ── v5 p1-shell (PLAN decision 1: the sidebar on the page) ──
  /** A frame asks for the sidebar's bundle (shared/sidebar.ts SIDEBAR_APP_FILE): the tab's top frame to open the
   *  sidebar, a frame inside another page for its in-page card's views. The worker runs it in that one document, while
   *  "Where the panel shows" is On the page, and answers the frame's tab id, which every panel message of the sidebar
   *  names (the worker takes none that names another, nor any from a subframe). */
  z.strictObject({ v, type: z.literal('sidebar/load') }),
  /** The sidebar's link to the extension's own settings page (a page may not open an extension page itself): the
   *  worker opens options.html at `section` (its fragment, an id of that page) in a new tab. Frame 0 alone. */
  z.strictObject({ v, type: z.literal('sidebar/options'), section: z.string().regex(/^[a-z][a-z-]{0,39}$/).optional() }),
  // ── v5 p2-fill (PLAN decision 14) ──
  /** A frame of ours with a form, as a run begins there: the worker runs the page patches' bundle
   *  (background/page-patches.ts PAGE_PATCHES_FILE) in that one document, world MAIN, once; the patches then hold the
   *  page's dialogs through a write and arm its own file picker for a résumé control's press, on command alone. */
  z.strictObject({ v, type: z.literal('page/patches') }),
  // ── end v5 p2-fill ──
] as const;

/** Only the e2e build compiles this in: the content script reports that storage.local refused it. */
const e2eContentMessages = __E2E__
  ? [z.strictObject({ v, type: z.literal('e2e/probe'), storageLocal: z.enum(['refused', 'allowed']).optional(),
    /** The review: the document's start-up is over (its confirmation page's sign, if any, was told and answered). */
    settled: z.literal(true).optional() })]
  : [];

export const ContentMessageSchema = z.discriminatedUnion('type', [...contentMessages, ...e2eContentMessages]);
export type ContentMessage = z.infer<typeof ContentMessageSchema>;

/** The person's choice at a policy card: 'fill' is Fill anyway, 'cancel' is Cancel. */
export const POLICY_DECISIONS = ['fill', 'cancel'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/** What the worker asks the form frame to relay for the job card (v2): its lookup, or Add/Save to tracker. */
export const JOB_RELAY_ACTIONS = ['lookup', 'add'] as const;
export type JobRelayAction = (typeof JOB_RELAY_ACTIONS)[number];

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
  /** v4 (the owner, 2026-11-07): the tab's application frame shows an account wall (a sign-in, a create-account page,
   *  an email gate) right now: the side panel's main button reads "Sign up & Autofill" (panel/fill {signIn: true}). */
  wall: z.enum(SIGN_IN_WALLS).optional(),
  /** v4 review: the tab's application frame shows an entry choice and no form (Workday's "Start Your Application":
   *  Apply Manually and the like, declared by the adapter's authState 'entry-choice'): the side panel offers Autofill
   *  there, even on a posting page, and the run presses the declared entry. */
  choice: z.literal(true).optional(),
  /** s2 profile (the review fix P1): what the tab's application frame, with no run holding it, waits for now (its
   *  wall's toast: frame/wall's `waits`); the side panel says it when the page's toasts are not shown until closed. */
  waits: z.enum(WALL_WAITS).optional(),
  // v5 p2-fill (PLAN Phase 2, Jobright's "Open Application"): the tab's application frame shows a posting with no form
  // whose adapter offers its own Apply (frame/wall's `entry`): the panel's main button reads "Open Application", and
  // its panel/fill presses that Apply, then fills the form it brings.
  entry: z.literal(true).optional(),
});
export type PageState = z.infer<typeof PageStateSchema>;

// ── Worker → content script ───────────────────────────────────────────────────────────────────────────────────────

export const WorkerToContentSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('run/start'), dryRun: z.boolean(),
    /** v3 Phase 5: the auto-apply agent's run (taken from the worker's own script alone): Next and Submit on Auto, the
     *  person's skip rules. `retry`: its one retry after the page refused its Submit. */
    agent: z.literal(true).optional(), retry: z.literal(true).optional(),
    /** v4: "Sign up & Autofill" (panel/fill {signIn: true}): this run signs in or creates the account at the account
     *  wall as Sign-in mode Auto would; a frame that shows the wall with no form signs in there first. */
    signIn: z.literal(true).optional() }),
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
  /** v5 p1-shell (PLAN decision 2): the toolbar icon, under "Where the panel shows: On the page": the tab's top frame
   *  opens the sidebar (`reveal`: the person's click brings the launcher back where they hid it). The worker's alone. */
  z.strictObject({ v, type: z.literal('sidebar/open'), reveal: z.literal(true).optional() }),
  // v5 p1-panel (PLAN decision 5): the tab's application was submitted, its platform confirmed it, and TailorIT's
  // tracker recorded it: the worker's alone, to the tab's top frame, once per recorded submission. The page shows
  // "Application Submitted!" over itself while the tab is visible (content/ui/applied.ts). Nothing names the job.
  z.strictObject({ v, type: z.literal('applied/popup') }),
  // v5 p2-stream (each AI answer fills as it lands): answers the run's frame waits for came in (an item on its task's
  // stream, or a batch's end): the frame polls at once (plan/poll) instead of at its next tick. The worker's alone, to
  // the run's own frame and document; it names the run only, never a key or an answer.
  z.strictObject({ v, type: z.literal('plan/ready'), runId: Id }),
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
  // ── snapshot build 2026-11-06 (core-x, items 7 and 14) ──
  /** A chain page the worker keyed (background/chain.ts): the application key it takes (a hash, never an address). */
  chained: z.strictObject({ applicationKey: z.string().regex(/^[a-z]+:[0-9a-f]{16}$/) }).optional(),
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

/** s2 lists: lists/known's answer: the host's learned lists, the most recently learned of each key (at most
 *  MAX_LEARNED_PER_HOST), and the stored lists asked for. Option labels only. */
export const LearnedListsAnswerSchema = z.strictObject({ lists: z.array(z.strictObject({
  key: z.string().regex(LEARNED_KEY),
  labels: z.array(z.string().min(1).max(MAX_LEARNED_LABEL)).min(1).max(MAX_LEARNED_OPTIONS),
})).max(MAX_LEARNED_PER_HOST),
  /** The stored lists asked for (lists/known's `stored`), each by its id, as a whole read takes it. */
  stored: z.array(z.strictObject({ id: z.enum(STORED_LIST_IDS),
    labels: z.array(z.string().min(1).max(MAX_LEARNED_LABEL)).min(1).max(MAX_LEARNED_OPTIONS) }))
    .max(STORED_LIST_IDS.length).optional() });
export type LearnedListsAnswer = z.infer<typeof LearnedListsAnswerSchema>;

/** v3 Phase 8: page/recognised's answer: the content script was injected into the frame (or was there already). */
export const PageRecognisedAnswerSchema = z.strictObject({ injected: z.boolean() });
/** v5 p1-shell: sidebar/load's answer: the sending frame's tab, once the sidebar's bundle ran in its document. */
export const SidebarLoadAnswerSchema = z.strictObject({ tabId: Count });
/** v5 p1-shell: sidebar/open's answer: whether the sidebar opens (false: this frame shows none, or it is the side
 *  panel's place now). */
export const SidebarOpenAnswerSchema = z.strictObject({ opening: z.boolean() });
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
  'frame/wall': DoneAnswerSchema,
  'page/recognised': PageRecognisedAnswerSchema,
  // s2 lists
  'lists/known': LearnedListsAnswerSchema,
  'lists/learn': DoneAnswerSchema,
  // v5 p1-shell
  'sidebar/load': SidebarLoadAnswerSchema,
  'sidebar/options': DoneAnswerSchema,
  // v5 p2-fill
  'page/patches': DoneAnswerSchema,
} as const satisfies Record<Exclude<ContentMessage['type'], 'e2e/probe'>, z.ZodType>;

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
  // v5 p1-shell
  'sidebar/open': SidebarOpenAnswerSchema,
  'applied/popup': DoneAnswerSchema, // v5 p1-panel
  'plan/ready': DoneAnswerSchema, // v5 p2-stream
} as const satisfies Record<WorkerToContent['type'], z.ZodType>;

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

// ── The content budget (snapshot round 2): what an extension page's schemas build with ──
/** The helpers messaging/page-schemas.ts builds the extension pages' schemas with. Those schemas live apart, so the
 *  content script, which never reads them, never carries them (nor the contract schemas only they name). */
export { Count, Id, Key, Text, TRANSFER_MESSAGES, v };
/** The extension pages' types, from messaging/page-schemas.ts (types only: nothing of that module reaches the content
 *  script through here). */
export type {
  AddJobOutcome, AgentBlock, AgentPause, AgentPhase, AgentStatus, AskLength, AskOutcome, AuthStatus, ExternalMessage, JobCard, JobCardMatch, JobSearchRefusal, LetterOutcome, PageMessage, PanelAskAnswer, PanelJobAnswer, PanelJobSearchAnswer, PanelLauncherAnswer, PanelLetterAnswer, PanelPortMessage, PanelSaveProfileAnswer, ProfileSaveRefusal, ProfileView, ResumeListAnswer, SiteRequestOutcome, SitesState, TabReports, TelemetryAnswer,
} from './page-schemas';
