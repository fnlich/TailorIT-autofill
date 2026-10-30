/*
 * The whole message catalogue, one strict zod union per channel. A content script shares a process with the ATS page,
 * so everything it sends is parsed as untrusted: objects are strict and every string and array is capped. The worker
 * also checks each sender (background/senders.ts); a known type on the wrong channel is refused.
 *
 * The catalogue is fixed here so phases fill in handlers, not shapes; docs/ARCHITECTURE.md ("Message catalogue") lists
 * who sends each message and what it answers. From Phase 2 the worker answers everything but panel/confirmDraft and
 * panel/saveAnswer (Phase 6), which get not_implemented.
 */
import { z } from 'zod';
import { EXTENSION_SCOPES } from '../contract/tailorit/connect';
import { FIELD_FORMATS, FIELD_KINDS, FIELD_VISIBILITIES, LABEL_SOURCES, MATCHER_STAGES,
  PLATFORMS } from '../core/enums';
import { REASON_CODES } from '../core/types/fill';
import { RULE_IDS } from '../core/types/intent';
import { MATCH_FLAGS, MATCH_RULES } from '../core/types/match';
import { MAX_STEPS, PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';
import { FrameReportSchema } from '../shared/report';
import { ContentSettingsSchema, SettingsSchema } from '../shared/settings';
import { MESSAGE_VERSION } from './envelope';

const Text = (max: number) => z.string().max(max);
const Key = z.string().min(1).max(600);
const Id = z.string().min(1).max(64);
const Hash = z.string().regex(/^(?:[a-f0-9]{16,64}|none|lazy)$/);
const Count = z.number().int().nonnegative();

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
  z.strictObject({ kind: z.literal('file'), ref: z.literal('resume') }),
  z.strictObject({ kind: z.literal('date'), iso: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/) }),
]);

const ProfilePath = Text(200);
export const ValueOriginSchema = z.discriminatedUnion('provenance', [
  z.strictObject({ provenance: z.literal('profile'), path: ProfilePath, transform: z.enum(RULE_IDS).optional() }),
  z.strictObject({ provenance: z.literal('saved'), savedAnswerId: Id }),
  z.strictObject({ provenance: z.literal('rule'), ruleId: z.enum(RULE_IDS), path: ProfilePath.optional() }),
  z.strictObject({ provenance: z.literal('llm-pick'), taskId: Id, pickedCandidate: Count, labelHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ provenance: z.literal('llm-draft'), taskId: Id, confirmedByUser: z.boolean() }),
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
 * language); per step, one batch per pass (MAX_PASSES, 8, docs/design/core.md) for each of the three AI task kinds.
 */
export const RUN_STATE_RECORD_CAPS = {
  stepAttempts: MAX_STEPS,
  filledFieldKeys: MAX_STEPS,
  repeatableCounters: MAX_STEPS * 3,
  aiTasks: MAX_STEPS * 8 * 3,
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
  lastFill: z.strictObject({ flagged: Count, blocked: Count, unresolved: Count }).nullable(),
  startedAt: Count,
  updatedAt: Count,
});

const NoticeHit = z.strictObject({ kind: z.enum(['tripwire', 'policy', 'attention-check']), count: Count });

// ── Content script → worker (one-shot messages) ───────────────────────────────────────────────────────────────────

const v = z.literal(MESSAGE_VERSION);

const contentMessages = [
  z.strictObject({ v, type: z.literal('ping') }),
  /** A frame announces itself. The worker trusts the sender's address, never a URL in a payload. */
  z.strictObject({ v, type: z.literal('frame/hello'), isTop: z.boolean(), hasForm: z.boolean() }),
  /** Answers a run id and the content settings; never the profile. */
  z.strictObject({ v, type: z.literal('run/begin'), applicationKey: z.string().max(80),
    trigger: z.enum(['launcher', 'panel', 'resume']), dryRun: z.boolean() }),
  /** This pass's fields and the page's canaries and notices. */
  z.strictObject({ v, type: z.literal('plan/request'), runId: Id, pass: Count, specs: z.array(FieldSpecSchema).max(500),
    canaries: z.array(Text(120)).max(32), notices: z.array(NoticeHit).max(10) }),
  /** Writes for fields that were waiting for the LLM. */
  z.strictObject({ v, type: z.literal('plan/poll'), runId: Id, keys: z.array(Key).max(500) }),
  z.strictObject({ v, type: z.literal('runstate/get'), applicationKey: z.string().max(80) }),
  z.strictObject({ v, type: z.literal('runstate/put'), runState: RunStateSchema }),
  z.strictObject({ v, type: z.literal('runstate/clear'), applicationKey: z.string().max(80) }),
  z.strictObject({ v, type: z.literal('report/put'), runId: Id, report: FrameReportSchema }),
  /** A posting page with no form saw a "do not use AI" pattern: its id only, never the text. */
  z.strictObject({ v, type: z.literal('policy/hit'), applicationKey: z.string().max(80), patternId: Text(40).nullable() }),
  /** Sent from the launcher's trusted click. */
  z.strictObject({ v, type: z.literal('panel/open') }),
] as const;

/** Only the e2e build compiles this in: the content script reports that storage.local refused it. */
const e2eContentMessages = __E2E__
  ? [z.strictObject({ v, type: z.literal('e2e/probe'), storageLocal: z.enum(['refused', 'allowed']) })]
  : [];

export const ContentMessageSchema = z.discriminatedUnion('type', [...contentMessages, ...e2eContentMessages]);
export type ContentMessage = z.infer<typeof ContentMessageSchema>;

// ── Extension pages (side panel, options) → worker ────────────────────────────────────────────────────────────────

const TabId = Count;
const FrameRef = { tabId: TabId, frameId: Count, fieldKey: Key };

/** The person's choice at a policy card: 'fill' is Fill anyway, 'cancel' is Cancel. */
export const POLICY_DECISIONS = ['fill', 'cancel'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

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
  z.strictObject({ v, type: z.literal('settings/save'), settings: SettingsSchema }),
  z.strictObject({ v, type: z.literal('auth/status') }),
  z.strictObject({ v, type: z.literal('auth/startPairing') }),
  z.strictObject({ v, type: z.literal('auth/redeemCode'), code: z.string().regex(/^[0-9A-Za-z -]{16,24}$/) }),
  z.strictObject({ v, type: z.literal('auth/disconnect') }),
  z.strictObject({ v, type: z.literal('runs/clear') }),
  /** One read of a tab's reports; the `panel` port follows them (below). */
  z.strictObject({ v, type: z.literal('panel/reports'), tabId: TabId }),
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

// ── The review panel's port (`panel`, extension pages only) ───────────────────────────────────────────────────────

/** A tab's reports, one per frame that reported, by frame id. They hold labels and statuses, never a value. */
const TabReportsShape = { tabId: TabId, reports: z.array(FrameReportSchema).max(20) };

export const PanelPortMessageSchema = z.discriminatedUnion('type', [
  /** Page → worker: follow this tab (the side panel sends it again when the active tab changes). */
  z.strictObject({ v, type: z.literal('panel/watch'), tabId: TabId }),
  /** Worker → page: the watched tab's reports, once at the watch and again on every change. */
  z.strictObject({ v, type: z.literal('panel/update'), ...TabReportsShape }),
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
  z.strictObject({ v, type: z.literal('run/start'), dryRun: z.boolean() }),
  /** Continue after a pause; it never answers the policy card (run/policyDecision does). */
  z.strictObject({ v, type: z.literal('run/continue') }),
  z.strictObject({ v, type: z.literal('run/cancel') }),
  /** The person's choice at the side panel's policy card, sent to this frame alone. */
  z.strictObject({ v, type: z.literal('run/policyDecision'), decision: z.enum(POLICY_DECISIONS) }),
  z.strictObject({ v, type: z.literal('field/focus'), fieldKey: Key }),
  /** The labels of a row's suggested options, fetched only when the row is expanded, never stored. */
  z.strictObject({ v, type: z.literal('field/describe'), fieldKey: Key }),
  z.strictObject({ v, type: z.literal('draft/confirm'), fieldKey: Key }),
  /** Read an answer the person asked to save; the worker sends it straight to TailorIT and never stores it. */
  z.strictObject({ v, type: z.literal('answer/read'), fieldKey: Key }),
  /** The tab's combined report, for the frame that shows the in-page panel while it is open. */
  z.strictObject({ v, type: z.literal('report/update'), reports: z.array(FrameReportSchema).max(20) }),
  /** Is this document still here? Sent to its {frameId, documentId} when another frame of the tab loads a document;
   *  the frame answers {pong: true}. Any answer keeps the frame; only "nothing receives here" lets it go, so a content
   *  script listens before it says frame/hello. */
  z.strictObject({ v, type: z.literal('frame/ping') }),
]);
export type WorkerToContent = z.infer<typeof WorkerToContentSchema>;

// ── Answers (data parts) ──────────────────────────────────────────────────────────────────────────────────────────

export const PingAnswerSchema = z.strictObject({ pong: z.literal(true) });
export const FrameHelloAnswerSchema = z.strictObject({
  frameId: Count,
  connected: z.boolean(),
  settings: ContentSettingsSchema,
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
});

/** An answer with nothing to report: runstate/clear, report/put, policy/hit, panel/open, panel/focus,
 *  panel/policyDecision, and a frame's answer to run/start, run/continue, run/cancel, run/policyDecision, field/focus,
 *  draft/confirm and report/update. A frame answers run/policyDecision {} once the decision settled its policy card,
 *  and `expired` when no run there waits at one. */
export const DoneAnswerSchema = z.strictObject({});

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
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

/** auth/startPairing: TailorIT's connect page was opened; the pairing lapses at `expiresAt` (ms since the epoch). */
export const StartPairingAnswerSchema = z.strictObject({ expiresAt: Count });

/** panel/fill, panel/continue and panel/cancel: how many frames of the tab the message reached. */
export const PanelSentAnswerSchema = z.strictObject({ frames: Count });

/** panel/reports: the tab's reports (the same shape the panel port pushes). */
export const TabReportsAnswerSchema = z.strictObject(TabReportsShape);
export type TabReports = z.infer<typeof TabReportsAnswerSchema>;

/** runs/clear: how many stored runs were removed. */
export const RunsClearAnswerSchema = z.strictObject({ cleared: Count });

// ── Which answer goes with which message ──────────────────────────────────────────────────────────────────────────

/** The data schema of the worker's answer to each content message (wrap it in envelope.ts's answerSchema). The e2e
 *  build's probe answers {} and is left out, so production bundles never name it. */
export const CONTENT_ANSWER_SCHEMAS = {
  ping: PingAnswerSchema,
  'frame/hello': FrameHelloAnswerSchema,
  'run/begin': RunBeginAnswerSchema,
  'plan/request': PlanAnswerSchema,
  'plan/poll': PlanAnswerSchema,
  'runstate/get': RunStateGetAnswerSchema,
  'runstate/put': RunStatePutAnswerSchema,
  'runstate/clear': DoneAnswerSchema,
  'report/put': DoneAnswerSchema,
  'policy/hit': DoneAnswerSchema,
  'panel/open': DoneAnswerSchema,
} as const satisfies Record<Exclude<ContentMessage['type'], 'e2e/probe'>, z.ZodType>;

/** The data schema of the worker's answer to each page message. panel/confirmDraft and panel/saveAnswer answer
 *  not_implemented until Phase 6. */
export const PAGE_ANSWER_SCHEMAS = {
  ping: PingAnswerSchema,
  'panel/fill': PanelSentAnswerSchema,
  'panel/continue': PanelSentAnswerSchema,
  'panel/cancel': PanelSentAnswerSchema,
  'panel/policyDecision': DoneAnswerSchema,
  'panel/focus': DoneAnswerSchema,
  'panel/describe': FieldDescribeAnswerSchema,
  'panel/confirmDraft': DoneAnswerSchema,
  'panel/saveAnswer': DoneAnswerSchema,
  'panel/reports': TabReportsAnswerSchema,
  'settings/get': SettingsAnswerSchema,
  'settings/save': SettingsAnswerSchema,
  'auth/status': AuthStatusSchema,
  'auth/startPairing': StartPairingAnswerSchema,
  'auth/redeemCode': AuthStatusSchema,
  'auth/disconnect': AuthStatusSchema,
  'runs/clear': RunsClearAnswerSchema,
} as const satisfies Record<PageMessage['type'], z.ZodType>;

/** The data schema of a frame's answer to each message the worker sends it. answer/read arrives in Phase 6. */
export const FRAME_ANSWER_SCHEMAS = {
  'run/start': DoneAnswerSchema,
  'run/continue': DoneAnswerSchema,
  'run/cancel': DoneAnswerSchema,
  'run/policyDecision': DoneAnswerSchema,
  'field/focus': DoneAnswerSchema,
  'field/describe': FieldDescribeAnswerSchema,
  'draft/confirm': DoneAnswerSchema,
  'report/update': DoneAnswerSchema,
  'frame/ping': PingAnswerSchema,
} as const satisfies Record<Exclude<WorkerToContent['type'], 'answer/read'>, z.ZodType>;

/** pair/complete's answer: {} once the code is redeemed (TailorIT's page reads only `ok`). */
export const EXTERNAL_ANSWER_SCHEMAS = { 'pair/complete': DoneAnswerSchema } as const satisfies Record<ExternalMessage['type'], z.ZodType>;

// ── The resume port ───────────────────────────────────────────────────────────────────────────────────────────────

/** 256 KiB chunks, base64; at most 40 of them (10 MiB). */
export const RESUME_CHUNK_BYTES = 262_144;
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

export const ResumePortMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('resume/request'), runId: Id }),
  z.strictObject({ v, type: z.literal('resume/header'), name: Text(255), mime: Text(100), size: Count.max(RESUME_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), chunkCount: Count.max(40) }),
  z.strictObject({ v, type: z.literal('resume/chunk'), index: Count.max(39), data: z.string().max(Math.ceil(RESUME_CHUNK_BYTES / 3) * 4) }),
  z.strictObject({ v, type: z.literal('resume/ack'), index: Count.max(39) }),
  z.strictObject({ v, type: z.literal('resume/end') }),
  z.strictObject({ v, type: z.literal('resume/done'), ok: z.boolean() }),
  z.strictObject({ v, type: z.literal('resume/error'), reason: z.enum(['resume-unavailable', 'resume-transfer-failed',
    'resume-format-unsupported', 'pdf-only-input']) }),
]);
