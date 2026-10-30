/*
 * The whole message catalogue, one strict zod union per channel. A content script shares a process with the ATS page,
 * so everything it sends is parsed as untrusted: objects are strict and every string and array is capped. The worker
 * also checks each sender (background/senders.ts); a known type on the wrong channel is refused.
 *
 * Phase 0 answers only ping and frame/hello (everything else gets not_implemented); the rest of the catalogue is fixed
 * here so later phases fill in handlers, not shapes.
 */
import { z } from 'zod';
import { FIELD_FORMATS, FIELD_KINDS, FIELD_VISIBILITIES, LABEL_SOURCES, MATCHER_STAGES,
  PLATFORMS } from '../core/enums';
import { REASON_CODES } from '../core/types/fill';
import { RULE_IDS } from '../core/types/intent';
import { MATCH_FLAGS, MATCH_RULES } from '../core/types/match';
import { PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';
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
  z.strictObject({ kind: z.literal('options'), indices: z.array(Count).max(300) }),
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

export const RunStateSchema = z.strictObject({
  version: z.literal(1),
  applicationKey: z.string().regex(/^[a-z]+:[a-f0-9]{16}$/),
  platform: z.enum(PLATFORMS),
  status: z.enum(RUN_STATUSES),
  resumeStatus: z.enum(RUN_STATUSES).nullable(),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  stepSignature: z.string().regex(/^[a-f0-9]{16}$/).nullable(),
  stepIndex: Count,
  stepAttempts: z.record(z.string().max(64), Count),
  filledFieldKeys: z.record(z.string().max(64), z.array(Key).max(500)),
  repeatableCounters: z.record(Text(64), z.strictObject({ profile: Count, rendered: Count, addClicks: Count })),
  canarySet: z.array(Text(120)).max(32),
  tripwire: z.strictObject({ triggered: z.boolean(), hits: Count }),
  policyDecision: z.enum(['accepted', 'declined']).nullable(),
  revealEdges: z.array(z.tuple([Key, Key])).max(500),
  aiTasks: z.record(z.string().max(64), Id),
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

export const PageMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('ping') }),
  z.strictObject({ v, type: z.literal('panel/fill'), tabId: TabId, dryRun: z.boolean() }),
  z.strictObject({ v, type: z.literal('panel/continue'), tabId: TabId }),
  z.strictObject({ v, type: z.literal('panel/cancel'), tabId: TabId }),
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
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

// ── TailorIT's connect page → worker (externally_connectable) ─────────────────────────────────────────────────────

export const ExternalMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('pair/complete'), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().regex(/^[0-9A-Za-z -]{16,24}$/) }),
]);
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>;

// ── Worker → content script ───────────────────────────────────────────────────────────────────────────────────────

export const WorkerToContentSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('run/start'), dryRun: z.boolean() }),
  z.strictObject({ v, type: z.literal('run/continue') }),
  z.strictObject({ v, type: z.literal('run/cancel') }),
  z.strictObject({ v, type: z.literal('field/focus'), fieldKey: Key }),
  /** The labels of a row's suggested options, fetched only when the row is expanded, never stored. */
  z.strictObject({ v, type: z.literal('field/describe'), fieldKey: Key }),
  z.strictObject({ v, type: z.literal('draft/confirm'), fieldKey: Key }),
  /** Read an answer the person asked to save; the worker sends it straight to TailorIT and never stores it. */
  z.strictObject({ v, type: z.literal('answer/read'), fieldKey: Key }),
  /** The tab's combined report, for the frame that shows the in-page panel while it is open. */
  z.strictObject({ v, type: z.literal('report/update'), reports: z.array(FrameReportSchema).max(20) }),
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
