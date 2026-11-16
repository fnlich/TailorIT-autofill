/*
 * The extension pages' messages and answers (the side panel, the options page, the review panel's port, the preview
 * port, TailorIT's connect page), apart from messaging/schemas.ts: the content script never parses them, so it never
 * carries them, nor the contract schemas only they name (the profile's, the agent's, the tracker's, the resumes'), which
 * keeps it within its 1 MiB budget (snapshot round 2). They are built with schemas.ts's own helpers and payloads, and
 * schemas.ts re-exports their types. Every rule of schemas.ts's header holds here.
 */
import { z } from 'zod';
import { AUTOFILL_AGENT_FINISHED_STATES, AUTOFILL_AGENT_REASONS, AutofillAgentIdSchema } from '../contract/tailorit/agent';
import { EXTENSION_SCOPES } from '../contract/tailorit/connect';
import { RESUME_CHOICE_REASONS } from '../contract/tailorit/lookup';
import { AutofillProfileSchema, AutofillSensitiveSchema, WORK_ARRANGEMENTS } from '../contract/tailorit/profile';
import { AUTOFILL_FILE_KINDS, AUTOFILL_RESUME_KINDS } from '../contract/tailorit/resumes';
import { AUTOFILL_JOB_SEARCH_MAX, AUTOFILL_JOB_SEARCH_QUERY_MAX } from '../contract/tailorit/tracker';
import { TAILOR_STEPS } from '../contract/tailorit/tailor'; // v1.4 F
import { FIELD_KINDS, MATCHER_STAGES, PLATFORMS } from '../core/enums';
import { QUEUE_AUTOFILL_CHOICES } from '../core/types/settings'; // v1.5 QX
import { MAX_TELEMETRY_COUNTS, TELEMETRY_OUTCOMES } from '../core/telemetry/events';
import { HISTORY_KINDS, PROFILE_GAPS } from '../shared/profile-gaps';
import { FrameReportSchema } from '../shared/report';
import { SettingsSchema } from '../shared/settings';
import {
  AGENT_NOTES, Count, DOCUMENT_GRANT, DoneAnswerSchema, FieldDescribeAnswerSchema, Id, Key, PageStateSchema, PingAnswerSchema,
  POLICY_DECISIONS, PressAnswerSchema, SaveAnswerAnswerSchema, STEP_TARGETS, Text, TRANSFER_MESSAGES, v,
} from './schemas';

// ── Extension pages (side panel, options) → worker ────────────────────────────────────────────────────────────────

const TabId = Count;
const FrameRef = { tabId: TabId, frameId: Count, fieldKey: Key };

/** The longest custom question (v2): TailorIT's cap on a draft's question (AUTOFILL_AI_LIMITS.draft.question). */
export const MAX_CUSTOM_QUESTION = 1000;
/** A custom question's answer length: Short, Medium or Long (AUTOFILL_CUSTOM_QUESTION_LENGTHS: 600, 1500, 3000). */
export const ASK_LENGTHS = ['short', 'medium', 'long'] as const;
export type AskLength = (typeof ASK_LENGTHS)[number];

/** v5 p1-shell: the notes over the panel's head a person may close for good: Workday's "stay on this page" strip. */
export const PANEL_NOTES = ['workday'] as const;
export type PanelNote = (typeof PANEL_NOTES)[number];

/** A job of the tab's last "Autofill for another job" search, as the panel names it (v3 Phase 3b): its place in that
 *  search, never TailorIT's id. */
export const JobRefSchema = z.string().regex(/^j[0-9]$/);

// ── v1.4 F ──
/** What a tailoring writes, and which document a preview or an edit opens: the resume, or the cover letter. */
// v1.5 X (PLAN decision 6): how TailorIT made a resume (its `resumes.made_by`), as GET /api/autofill/resumes names it.
export const RESUME_MADE_BY = ['upload', 'editor', 'copy', 'tailor'] as const;
export type ResumeMadeBy = (typeof RESUME_MADE_BY)[number];

export const TAILOR_KINDS = ['resume', 'coverLetter'] as const;
export type TailorKind = (typeof TAILOR_KINDS)[number];
/** A template's id, as the contract caps it (AUTOFILL_TAILOR_LIMITS.templateId). */
const TemplateId = z.string().min(1).max(64);
// ── end v1.4 F ──

// ── v1.5 QX (PLAN decisions 7 and 9: the sequential auto-apply and the panel's Queue tab) ──
/** Where a queued job stands in the sequential auto-apply: waiting; its tab opening; its page loaded; filling; at rest
 *  for the person (Submit on Manual, a CAPTCHA, a sign-in, a field the skip rules hold); submitted; skipped (the person
 *  closed its tab, or TailorIT no longer had it queued); failed (no address the extension fills, a page that never
 *  loaded, a closed posting). */
export const QUEUE_ITEM_STATUSES = ['queued', 'opening', 'opened', 'filling', 'ready', 'submitted', 'skipped', 'failed'] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];
/** The run: none yet; opening tabs; paused (the seconds left kept); every job done; stopped. */
export const QUEUE_PHASES = ['idle', 'running', 'paused', 'finished', 'stopped'] as const;
export type QueuePhase = (typeof QUEUE_PHASES)[number];
/** Why a running queue's timer waits: as many queued tabs open as the settings allow; the browser offline; TailorIT did
 *  not answer (tried again shortly). */
export const QUEUE_HOLDS = ['cap', 'offline', 'server'] as const;
export type QueueHold = (typeof QUEUE_HOLDS)[number];
/** Why the queue stopped: the person's Stop; Run auto-apply turned on (the two never run together); the connection
 *  changed, went or lacks agent:run; the disclosure changed; Chrome opened no tab. */
export const QUEUE_STOPS = ['person', 'agent', 'connection', 'disclosure', 'no-tab'] as const;
export type QueueStop = (typeof QUEUE_STOPS)[number];
/** v2.0 P9 (autofill API 8): why a run stopped (QueueStatus.stoppedBy): QUEUE_STOPS, or 'daily-limit' (TailorIT's
 *  claim of the next job answered that the account's daily auto-apply limit is reached; the jobs left stay queued).
 *  Kept apart from QUEUE_STOPS, whose words src/shared/copy.ts holds: the limit's words are TailorIT's own. */
export const QUEUE_STATUS_STOPS = [...QUEUE_STOPS, 'daily-limit'] as const;
export type QueueStatusStop = (typeof QUEUE_STATUS_STOPS)[number];
/** Why the queue cannot start now (the agent's blocks that apply). */
export const QUEUE_BLOCKS = ['not-connected', 'no-scope', 'disclosure'] as const;
export type QueueBlock = (typeof QUEUE_BLOCKS)[number];
/** How many jobs queue/list answers at a time. */
export const QUEUE_LIST_PAGE = 50;
// ── end v1.5 QX ──

// ── jr6 ──
/** The longest email the sign-up information takes (as TailorIT caps one). */
const SIGNUP_EMAIL_LIMIT = 254;
/** The longest password a page may send (the rules hold it to 64: core/signup-password.ts). */
const SIGNUP_PASSWORD_LIMIT = 256;
/** The jr6 review (R12): what Sign-up Information says the worker did by itself (SignupStatus.notice). */
export const SIGNUP_NOTICES = ['gone', 'reverted'] as const;
export type SignupNotice = (typeof SIGNUP_NOTICES)[number];
// ── end jr6 ──

export const PageMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('ping') }),
  z.strictObject({ v, type: z.literal('panel/fill'), tabId: TabId, dryRun: z.boolean(),
    /** v4: "Sign up & Autofill": this run signs in, or creates the account, at the tab's next account wall once, as
     *  Sign-in mode Auto would (the same rules: since jr6 the job-site password saved in this browser's Sign-up
     *  Information, the disclosure acknowledged, a password never kept), whatever the mode says. */
    signIn: z.literal(true).optional() }),
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
   *  or looked up through that frame (job/refresh) when the memory has none. v5 p1-shell (the review's S1): `onLoad`,
   *  from a sidebar that opened by itself: a lookup it sets off is one as the page loads, under loadCard's rules (no
   *  private tab, the disclosure acknowledged as it reads now, LOOKUP_ON_LOAD_LIMIT); never a person's opening. */
  z.strictObject({ v, type: z.literal('panel/job'), tabId: TabId, onLoad: z.literal(true).optional() }),
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
  /** v3 Phase 3b, "Your autofill information": the profile as TailorIT holds it, for the side panel's editor. v4 ui:
   *  `sensitive: false` (the side panel's check that the profile is complete) leaves the sensitive part unread. */
  z.strictObject({ v, type: z.literal('panel/profile'), sensitive: z.literal(false).optional() }),
  /** v5 p1-panel (the Phase 1 review, S6): whether the profile is complete for the panel, worked out in the worker:
   *  the names of what is missing (shared/profile-gaps.ts), never the profile, which stays out of a page's process. */
  z.strictObject({ v, type: z.literal('panel/profileCheck') }),
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
  // ── v5 p1-shell (PLAN decision 8: the header's notes) ──
  /** The notes over the panel's head the person closed (Workday's "stay on this page" strip), kept in storage.local. */
  z.strictObject({ v, type: z.literal('panel/notes') }),
  /** The person closed a note: it stays closed, on the page and in the side panel. */
  z.strictObject({ v, type: z.literal('panel/closeNote'), note: z.enum(PANEL_NOTES) }),
  // ── v1.4 F (PLAN decisions 16-18): tailoring, the documents' preview and editor, the templates ──
  /** The tab's tailoring (background/tailor.ts): its state for the card frame's application (no `start`: a read from
   *  memory, nothing asked), or "Tailor resume for this job" ('resume') or "Generate cover letter" ('coverLetter'),
   *  each a trusted click on a control seen CONTROL_SEEN_MS, which starts TailorIT's tailoring for the tab's job. */
  z.strictObject({ v, type: z.literal('panel/tailor'), tabId: TabId, start: z.enum(TAILOR_KINDS).optional() }),
  /** Preview (the full-window preview page, preview.html, an extension page) or Edit (TailorIT's editor, in a new tab)
   *  of the resume or the cover letter a fill of the tab attaches: the worker opens it, as it alone knows their ids. */
  z.strictObject({ v, type: z.literal('panel/openDocument'), tabId: TabId, kind: z.enum(TAILOR_KINDS),
    how: z.enum(['preview', 'edit']),
    // ── v1.5 X (PLAN decisions 2 and 3) ──
    /** Preview: the documents the panel shows a Preview for (the dialog's tabs; `kind` among them). Absent: `kind`. */
    kinds: z.array(z.enum(TAILOR_KINDS)).min(1).max(TAILOR_KINDS.length).optional(),
    /** Edit of an uploaded resume, where the page could not show the confirm (`confirm: 'panel'`): the person's
     *  Continue on the panel's own, and its "Don't show this again". */
    confirmed: z.literal(true).optional(), skipConfirm: z.boolean().optional() })
    .refine((message) => message.kinds === undefined || message.kinds.includes(message.kind),
      { message: 'kind is no tab', path: ['kind'] })
    .refine((message) => message.how === 'edit' || (message.confirmed === undefined && message.skipConfirm === undefined),
      { message: 'only Edit is confirmed', path: ['confirmed'] }),
    // ── end v1.5 X ──
  /** The templates a tailored resume and its letter are written on (the profile's `documents`), with the lists TailorIT
   *  offers; `save` changes those two alone, on the profile as TailorIT holds it now, with its revision. */
  z.strictObject({ v, type: z.literal('panel/documents'), save: z.strictObject({ resumeTemplateId: TemplateId.nullable(),
    coverLetterTemplateId: TemplateId.nullable() }).optional() }),
  // ── end v1.4 F ──
  // ── v1.5 QX (PLAN decisions 7 and 9): the Queue tab ──
  /** The sequential auto-apply as the Queue tab shows it (value-free: counts, phases, the seconds left). */
  z.strictObject({ v, type: z.literal('queue/status') }),
  /** A page of the jobs it lists, from `offset` (a multiple of QUEUE_LIST_PAGE): the run's, or TailorIT's queued ones
   *  before a run. */
  z.strictObject({ v, type: z.literal('queue/list'), offset: Count.max(100_000) }),
  /** Start (the first queued tab opens at once; Run auto-apply goes off), Stop, Pause and Resume (the seconds left kept):
   *  each a trusted click on a control seen CONTROL_SEEN_MS. */
  z.strictObject({ v, type: z.literal('queue/start') }),
  z.strictObject({ v, type: z.literal('queue/stop') }),
  z.strictObject({ v, type: z.literal('queue/pause') }),
  z.strictObject({ v, type: z.literal('queue/resume') }),
  /** A row's click: its job's tab, while it is open, brought to the front. */
  z.strictObject({ v, type: z.literal('queue/focus'), id: AutofillAgentIdSchema }),
  // ── end v1.5 QX ──
  // ── jr6 (the owner's words of 2026-11-10): the job-site sign-up information, kept in this browser ──
  // The extension's own pages alone (the options page, Chrome's side panel): never the sidebar on the page
  // (background/senders.ts SIDEBAR_PAGE_MESSAGES holds none of them), whose page process hears what is typed. No answer
  // ever carries the password: it leaves the worker only to be typed into a job site's own sign-in form
  // (signin/credential).
  /** Sign-up Information as the settings show it: whether a password is saved, the email, when it was saved. */
  z.strictObject({ v, type: z.literal('signup/status') }),
  /** Save: the email and a new password (one that meets every rule of core/signup-password.ts, checked again by the
   *  worker); without `password`, the saved one is kept under the email. */
  z.strictObject({ v, type: z.literal('signup/save'), email: z.string().min(3).max(SIGNUP_EMAIL_LIMIT),
    password: z.string().min(1).max(SIGNUP_PASSWORD_LIMIT).optional() }),
  /** Delete: the password and its key go; Sign-in on Auto goes back to Manual (it needs one). */
  z.strictObject({ v, type: z.literal('signup/delete') }),
  /** "Import from TailorIT", once, while none is saved here and the connection may read job-site sign-ins
   *  (credentials:read): the every-site sign-in TailorIT keeps, saved here when its password meets the rules. */
  z.strictObject({ v, type: z.literal('signup/import') }),
  // ── end jr6 ──
  // ── v2.0 P9 (A20) ──
  /** Options › Auto-apply › "Close the application tab when it's submitted": read (no `on`) or set. The options page's
   *  own (never the sidebar's: background/senders.ts SIDEBAR_PAGE_MESSAGES names it not). */
  z.strictObject({ v, type: z.literal('autoApply/closeTab'), on: z.boolean().optional() }),
  // ── end v2.0 P9 ──
  // ── v3.0 X1-EXT (autofill API 9; background/closed-check.ts, closed-reports.ts) ──
  /** The job card's Report as closed: the posting of the tab's card frame's job, which TailorIT shows as open, is
   *  closed, in the person's own words (signal and via `person`): sent at once, whatever "Report closed jobs to TailorIT
   *  automatically" says. */
  z.strictObject({ v, type: z.literal('panel/reportClosed'), tabId: TabId }),
  /** Options › "Report closed jobs to TailorIT automatically": read (no `on`) or set. The options page's own (never the
   *  sidebar's: background/senders.ts SIDEBAR_PAGE_MESSAGES names it not). */
  z.strictObject({ v, type: z.literal('reports/closedAuto'), on: z.boolean().optional() }),
  // ── end v3.0 X1-EXT ──
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

/** A tab's reports, one per frame that reported, by frame id. They hold labels and statuses, never a value. `page` is
 *  the tab's page state (v2; absent from an older worker). */
const TabReportsShape = { tabId: TabId, reports: z.array(FrameReportSchema).max(20), page: PageStateSchema.optional(),
  /** v2.0 fix wave (REQ-1): TailorIT's words for its AI's refusal that the tab's run met (ai-notice.ts), once per run,
   *  while that run's report is among `reports`. */
  aiNotice: Text(400).optional() };

/** What changed for every side panel (v2): the connection (a token stored or dropped, perhaps from another window) or
 *  the settings. */
export const PANEL_CHANGES = ['connection', 'settings', 'agent',
  // v1.4 F: a tab's tailoring moved on (a step, done, failed): each panel reads its own tab's with panel/tailor.
  'tailor',
  // v1.5 QX: the sequential auto-apply moved on (a tab opened, a job's status, a phase).
  'queue',
  // jr6: the job-site password was saved or deleted: each panel reads the connection's status again (its `signUp`).
  'signup',
  // v3.0 X1-EXT: what a job card says of a closed posting changed (a look found one, a report went or was refused):
  // each panel reads its own tab's card again (from the worker's memory: nothing is asked of TailorIT for it).
  'job'] as const;

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
  /** jr6: whether a job-site password is saved in this browser's Sign-up Information (Sign-in Auto needs one). A word,
   *  never the email or the password: the sidebar on the page reads it too. */
  signUp: z.enum(['set', 'not-set']).optional(),
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

/** v3.0 FIX-EXT (REQ-1): a job's source credit on the card and in "Autofill for another job"'s list ("Source:
 *  Himalayas"), where the source's terms ask for one: its name, and the source's https link (background/job-credit.ts;
 *  the source's address, never the posting's). */
export const JobCardCreditSchema = z.strictObject({
  text: Text(200).min(1),
  url: Text(2048).regex(/^https:\/\/\S+$/i).optional(),
});
export type JobCardCredit = z.infer<typeof JobCardCreditSchema>;

/**
 * What the side panel's job card shows (v2): 'unavailable' when TailorIT could not say (it failed, or the frame did not
 * relay); else the job (null: not in the person's TailorIT jobs), their tracker entry, the resume a fill attaches (its
 * title, which may be the person's name, its file kind and why it was chosen), its match, and whether "Add this job to
 * TailorIT" can work from this page's address (Greenhouse's and Lever's own pages). Never an id, an address, the posting
 * text, a file name or the ATS reading; the date it was posted only as a time (ms), to say "2 days ago". (v3.0 FIX-EXT:
 * the one link it may hold is the job's source's own, in its credit.)
 */
export const JobCardSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unavailable') }),
  z.strictObject({
    state: z.literal('answered'),
    job: z.strictObject({ title: Text(300), company: Text(200), location: Text(300), closed: z.boolean(),
      postedAt: Count.nullable(), salary: Text(120).nullable(), workArrangement: z.enum(WORK_ARRANGEMENTS).nullable(),
      /** v4: the industry as TailorIT's Jobs page names it ("Finance"), under the company on the card; absent or null
       *  when TailorIT does not say. */
      industry: Text(120).nullable().optional(),
      /** v3.0 FIX-EXT (REQ-1): the source's credit; absent when its source asks for none (or TailorIT sends none). */
      credit: JobCardCreditSchema.optional() })
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
    // ── v3.0 X1-EXT (autofill API 9) ──
    /** The job is held for review (the lookup's `held`): only this person sees it in TailorIT until it is approved. */
    held: z.literal(true).optional(),
    /** The extension's look in this page found a closed sign (background/closed-check.ts): "This posting looks
     *  closed." */
    closedSeen: z.literal(true).optional(),
    /** The posting was reported closed to TailorIT: by itself ('auto', "Reported to TailorIT"), or by the person
     *  ('person': the button, or the lookup's `reported`, "You reported this posting as closed"). */
    reported: z.enum(['auto', 'person']).optional(),
    /** The card may offer Report as closed: a job TailorIT shows as open, the page's own (not one chosen for it), the
     *  disclosure acknowledged, and not a private window. */
    reportable: z.literal(true).optional(),
    // ── end v3.0 X1-EXT ──
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

/** v3 Phase 8: Options › "Where Autofill works" › Company career sites: turned on by the person, and Chrome holding its
 *  permission (it acts only with both). */
export const SitesStateSchema = z.strictObject({ on: z.boolean(), granted: z.boolean() });
export type SitesState = z.infer<typeof SitesStateSchema>;

/** panel/resumes: the account's resumes as the picker lists them (title, file kind, built or uploaded), the one the
 *  tab's card attaches marked `current`. Never a file name. */
export const ResumeListAnswerSchema = z.strictObject({
  items: z.array(z.strictObject({ id: Id, label: Text(200), fileKind: z.enum(AUTOFILL_FILE_KINDS),
    kind: z.enum(AUTOFILL_RESUME_KINDS), current: z.boolean(),
    // v1.5 X (PLAN decision 6): how TailorIT made it (an upload, the editor, an editable copy, a tailoring) and when
    // (an ISO instant), for the picker's folders; absent from a TailorIT before v1.5 (the kind decides then).
    madeBy: z.enum(RESUME_MADE_BY).optional(), createdAt: Text(40).optional() })).max(200),
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
  z.strictObject({ outcome: z.enum(ASK_REFUSALS),
    /** v2.0 fix wave (REQ-1): TailorIT's words for its AI's refusal (ai-notice.ts aiRefusalOf), shown as they are. */
    message: Text(400).optional() }),
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

// ── v1.4 F (PLAN decisions 16-18) ──
/**
 * Why a tailoring did not start or did not finish (panel/tailor): 'needs-copy' (the resume is an upload with no editable
 * copy: TailorIT's 409 needs_editable_copy), 'rate-limited' (this panel's pace, or TailorIT's hourly cap), 'ai-off' (the
 * person's AI-written answers are off, the posting forbids AI under profile-only, or the form says "I did not use AI"),
 * 'ai-unavailable' (TailorIT's AI is off, signed out or paused), 'busy' (two tailorings of the account already run),
 * 'no-job' (TailorIT has no such job and the page names no company and title), 'not-allowed' (this connection may not
 * run TailorIT's AI: connect again), 'not-connected', 'failed' (TailorIT's tailoring failed), 'unavailable' (TailorIT
 * or the page could not be reached, or it took too long).
 */
export const TAILOR_FAILURES = ['needs-copy', 'rate-limited', 'ai-off', 'ai-unavailable', 'busy', 'no-job', 'not-allowed',
  'not-connected', 'failed', 'unavailable'] as const;
export type TailorFailure = (typeof TAILOR_FAILURES)[number];
const Score = z.number().int().min(0).max(100);
/** panel/tailor: the tab's tailoring for its card frame's application, states only (never an id, a word of the
 *  resume or the posting): none; running (TailorIT's step, and its line for it); done (the new resume's title, which
 *  may hold the person's name as any resume's does, whether a letter was written, the ATS score and the one before);
 *  or failed, with why. `kind` is the control that started it. */
export const TailorViewSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('idle') }),
  z.strictObject({ state: z.literal('running'), kind: z.enum(TAILOR_KINDS), step: z.enum(TAILOR_STEPS).nullable(),
    message: Text(200).nullable() }),
  z.strictObject({ state: z.literal('done'), kind: z.enum(TAILOR_KINDS), title: Text(200), letter: z.boolean(),
    score: Score.nullable(), scoreBefore: Score.nullable() }),
  z.strictObject({ state: z.literal('failed'), kind: z.enum(TAILOR_KINDS), reason: z.enum(TAILOR_FAILURES),
    /** v2.0 fix wave (REQ-1): TailorIT's words for its AI's refusal (ai-notice.ts aiRefusalOf), shown as they are. */
    message: Text(400).optional() }),
]);
export type TailorView = z.infer<typeof TailorViewSchema>;

/** panel/openDocument: whether a page was opened (false: there is no such document for the tab yet). v1.5 X: Preview
 *  `onPage` (the dialog over the tab's page, not the full-window page); Edit of an uploaded resume `confirm`, the confirm
 *  shown first: over the page ('page'), or for the panel to show (`panel`: the page could not), Continue then sending
 *  panel/openDocument again with `confirmed`. */
export const OpenDocumentAnswerSchema = z.strictObject({ opened: z.boolean(),
  onPage: z.literal(true).optional(), confirm: z.enum(['page', 'panel']).optional() });

/** panel/documents' refusals: as panel/saveProfile's ('conflict': the profile changed between the read and the save). */
export const DOCUMENTS_REFUSALS = ['conflict', 'invalid', 'not-allowed', 'not-connected', 'rate-limited',
  'unavailable'] as const;
/** panel/documents: the profile's two template choices (null: the resume's own template; no template for the letter),
 *  TailorIT's lists, whether this connection may save them (profile:write), and `saved` after a save. */
export const DocumentsAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('ready'), resumeTemplateId: TemplateId.nullable(),
    coverLetterTemplateId: TemplateId.nullable(),
    resumeTemplates: z.array(z.strictObject({ id: TemplateId, name: Text(120) })).max(100),
    coverLetterTemplates: z.array(z.strictObject({ id: TemplateId, name: Text(120), isSystem: z.boolean() })).max(200),
    canWrite: z.boolean(), saved: z.literal(true).optional() }),
  z.strictObject({ outcome: z.enum(DOCUMENTS_REFUSALS) }),
]);
export type DocumentsAnswer = z.infer<typeof DocumentsAnswerSchema>;
// ── end v1.4 F ──

/** panel/launcher (v3 Phase 3): where the person hid the launcher of the tab's site: nowhere, on that site, or on every
 *  site. */
export const PanelLauncherAnswerSchema = z.strictObject({ hidden: z.enum(['none', 'visit', 'site', 'everywhere']) });
export type PanelLauncherAnswer = z.infer<typeof PanelLauncherAnswerSchema>;

/** panel/jobSearch (v3 Phase 3b): the jobs found, each with the reference panel/chooseJob takes, its title, company and
 *  where it is (v3.0 FIX-EXT, REQ-1: and its source's credit, when it has one); or why there are none ('not-allowed':
 *  a connection made before version 3; 'not-connected'; 'rate-limited'; 'unavailable'). Never TailorIT's id. */
export const JOB_SEARCH_REFUSALS = ['not-allowed', 'not-connected', 'rate-limited', 'unavailable'] as const;
export type JobSearchRefusal = (typeof JOB_SEARCH_REFUSALS)[number];
export const PanelJobSearchAnswerSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('found'), items: z.array(z.strictObject({ ref: JobRefSchema, title: Text(300),
    company: Text(200), location: Text(300), credit: JobCardCreditSchema.optional() })).max(AUTOFILL_JOB_SEARCH_MAX) }),
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
/** v5 p1-panel (S6): panel/profileCheck's answer: the names of what the profile lacks, from closed lists, and nothing
 *  else. */
export const ProfileCheckAnswerSchema = z.strictObject({
  gaps: z.array(z.enum(PROFILE_GAPS)).max(PROFILE_GAPS.length),
  history: z.array(z.enum(HISTORY_KINDS)).max(HISTORY_KINDS.length),
});
export type ProfileCheckAnswer = z.infer<typeof ProfileCheckAnswerSchema>;

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

/** Why the auto-apply agent cannot run now (v3 Phase 5): not connected, a connection without agent:run (made before
 *  version 3), the disclosure not acknowledged as it reads now, no browser window of the person's open, or (the audit
 *  of 2026-11-06, M5) the browser offline, so no job is taken. */
export const AGENT_BLOCKS = ['not-connected', 'no-scope', 'disclosure', 'no-window', 'offline'] as const;
export type AgentBlock = (typeof AGENT_BLOCKS)[number];
// ── v2.0 P9 (autofill API 8: the claim's daily limit) ──
/** What the agent's status says blocks it (AgentStatus.blocked): AGENT_BLOCKS, or 'daily-limit' (TailorIT's claim
 *  answered that the account's daily auto-apply limit is reached: the agent waits for the reset, Run auto-apply on).
 *  Kept apart from AGENT_BLOCKS, whose words src/shared/copy.ts holds (the content script reads that file): the limit's
 *  words are TailorIT's own (AutoApplyLimit.message). */
export const AGENT_STATUS_BLOCKS = [...AGENT_BLOCKS, 'daily-limit'] as const;
export type AgentStatusBlock = (typeof AGENT_STATUS_BLOCKS)[number];
/** TailorIT's daily auto-apply limit, as a claim answered it reached (the contract's AutofillDailyLimit): its words for
 *  the person, shown as they are (null: it sent none), and when it resets (ms since the epoch). */
export const AutoApplyLimitSchema = z.strictObject({ message: Text(400).nullable(), resetsAt: Count });
export type AutoApplyLimit = z.infer<typeof AutoApplyLimitSchema>;
/** autoApply/closeTab's answer (A20): whether a tab auto-apply opened closes once its application is submitted. */
export const CloseTabAnswerSchema = z.strictObject({ on: z.boolean() });
// ── end v2.0 P9 ──

// ── v3.0 X1-EXT (autofill API 9) ──
/**
 * What came of Report as closed, which the card says: 'reported' (TailorIT took it for review), 'closed' (the person's
 * own page job, closed now), 'already-closed' (TailorIT shows the job as closed already), 'limited' (the day's reports
 * are used up: `message`, TailorIT's own words, says until when), 'not-allowed' (a connection made before adding jobs:
 * connect again), 'private' (never from a private window), 'not-connected', 'unavailable' (no open job on the card,
 * TailorIT could not be reached, or it refused).
 */
export const REPORT_CLOSED_OUTCOMES = ['reported', 'closed', 'already-closed', 'limited', 'not-allowed', 'private',
  'not-connected', 'unavailable'] as const;
export type ReportClosedOutcome = (typeof REPORT_CLOSED_OUTCOMES)[number];
export const ReportClosedAnswerSchema = z.strictObject({ outcome: z.enum(REPORT_CLOSED_OUTCOMES),
  message: Text(400).optional() });
export type ReportClosedAnswer = z.infer<typeof ReportClosedAnswerSchema>;
/** reports/closedAuto's answer: whether closed postings are reported to TailorIT by themselves. */
export const ReportClosedAutoAnswerSchema = z.strictObject({ on: z.boolean() });
// ── end v3.0 X1-EXT ──
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
  blocked: z.enum(AGENT_STATUS_BLOCKS).nullable(), // v2.0 P9: 'daily-limit' too
  /** v2.0 P9 (API 8): while blocked 'daily-limit', TailorIT's words and its reset; absent otherwise. */
  limit: AutoApplyLimitSchema.optional(),
  /** While off: why the agent paused itself (AGENT_PAUSES); null or absent when the person turned it off. */
  paused: z.enum(AGENT_PAUSES).nullable().optional(),
  /** Run auto-apply may be turned on now: connected with agent:run, the disclosure acknowledged. */
  allowed: z.boolean(),
  /** A result is kept that TailorIT has not taken yet (offline, its failure): it is sent again (the review). */
  pending: z.boolean(),
  job: z.strictObject({ company: Text(200), title: Text(300) }).nullable(),
  doneToday: Count,
  last: z.strictObject({ state: z.enum(AUTOFILL_AGENT_FINISHED_STATES), reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
    /** jr7 AUTO-7 (ICIMS7-04): why, in the extension's words (AGENT_NOTES). */
    note: z.enum(AGENT_NOTES).optional() })
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

// ── v1.5 QX ──
/** A count per job status. */
const QueueCountsSchema = z.strictObject({ queued: Count, opening: Count, opened: Count, filling: Count, ready: Count,
  submitted: Count, skipped: Count, failed: Count }) satisfies z.ZodType<Record<QueueItemStatus, number>>;

/** queue/status, queue/start, queue/stop, queue/pause and queue/resume's answer: value-free. `nextInMs`: running, the ms
 *  until the next tab opens (null while none will); paused or held, the ms kept. `opened` of `total`: the jobs of the run
 *  no longer waiting. `submit`: Submit mode as it acts now (Manual until the disclosure is acknowledged). */
export const QueueStatusSchema = z.strictObject({
  phase: z.enum(QUEUE_PHASES),
  hold: z.enum(QUEUE_HOLDS).nullable(),
  nextInMs: Count.nullable(),
  total: Count,
  opened: Count,
  counts: QueueCountsSchema,
  openTabs: Count,
  maxOpenTabs: Count,
  stoppedBy: z.enum(QUEUE_STATUS_STOPS).nullable(), // v2.0 P9: 'daily-limit' too
  /** v2.0 P9 (API 8): stopped by 'daily-limit', TailorIT's words and its reset; absent otherwise. */
  limit: AutoApplyLimitSchema.optional(),
  /** Start turned Run auto-apply off (the two never run together). */
  agentStopped: z.boolean(),
  /** Run auto-apply is on now: Start turns it off. */
  agentOn: z.boolean(),
  blocked: z.enum(QUEUE_BLOCKS).nullable(),
  /** A result TailorIT has not taken yet (offline, its failure): it is sent again. */
  pending: z.boolean(),
  autofillOnOpen: z.enum(QUEUE_AUTOFILL_CHOICES),
  submit: z.enum(['manual', 'auto']),
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

/** One job of queue/list: its title and company as TailorIT named them, its status (and why, for a job not
 *  submitted), and whether its tab is open (a click brings it to the front). */
export const QueueListItemSchema = z.strictObject({
  id: AutofillAgentIdSchema,
  title: Text(300),
  company: Text(200),
  status: z.enum(QUEUE_ITEM_STATUSES),
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
  tab: z.boolean(),
  // ── jr7 AUTO-7 ──
  /** AUTO7-01 (FIX7PLAN D-4): Submit is the person's on this job's site in the Queue tab (no success sign read there:
   *  background/settings.ts QUEUE_SUBMIT_PLATFORMS), while its tab is open and not done. */
  submitYours: z.literal(true).optional(),
  /** ICIMS7-04: why the job rests with the person, in the extension's words (AGENT_NOTES). */
  note: z.enum(AGENT_NOTES).optional(),
  // ── end jr7 AUTO-7 ──
});
export type QueueListItem = z.infer<typeof QueueListItemSchema>;

/** queue/list's answer: `source` 'run' (the run's jobs) or 'queue' (TailorIT's queued jobs, before a run); `total` of
 *  them, `more` while a later page has some. */
export const QueueListAnswerSchema = z.strictObject({
  source: z.enum(['run', 'queue']),
  items: z.array(QueueListItemSchema).max(QUEUE_LIST_PAGE),
  offset: Count,
  total: Count,
  more: z.boolean(),
});
export type QueueListAnswer = z.infer<typeof QueueListAnswerSchema>;

/** queue/focus's answer: whether the job's tab was brought to the front (false: it has none open now). */
export const QueueFocusAnswerSchema = z.strictObject({ focused: z.boolean() });
// ── end v1.5 QX ──

/** v5 p1-shell: panel/notes's answer: the notes the person closed. */
export const PanelNotesAnswerSchema = z.strictObject({ closed: z.array(z.enum(PANEL_NOTES)).max(PANEL_NOTES.length) });

// ── jr6 ──
/** Sign-up Information as the settings show it (signup/status, and with the other answers): whether a password is saved,
 *  its email and when; the email the box starts with when none is saved (the profile's); whether "Import from TailorIT"
 *  is offered (none saved here, and the connection may read job-site sign-ins). Never the password. */
export const SignupStatusSchema = z.strictObject({
  set: z.boolean(),
  email: Text(SIGNUP_EMAIL_LIMIT).nullable(),
  updatedAt: Count.nullable(),
  suggestedEmail: Text(SIGNUP_EMAIL_LIMIT).nullable(),
  importable: z.boolean(),
  /** The jr6 review (R12): what the worker did by itself since the person last saved or deleted one, which the card
   *  says: 'gone', a saved password that could no longer be read in this browser was removed; 'reverted', Sign-in went
   *  back from Auto to Manual for want of one (an install that chose Auto before jr6). Absent: nothing to say. */
  notice: z.enum(SIGNUP_NOTICES).optional(),
});
export type SignupStatus = z.infer<typeof SignupStatusSchema>;

/** signup/delete's answer: the status after, and whether Sign-in went back from Auto to Manual. */
export const SignupDeleteAnswerSchema = z.strictObject({ status: SignupStatusSchema, reverted: z.boolean() });

/** What "Import from TailorIT" came to: saved here; TailorIT holds no sign-in for every site; or its password misses a
 *  rule (nothing saved: the person sets a new one here). */
export const SIGNUP_IMPORT_OUTCOMES = ['imported', 'none', 'weak'] as const;
export const SignupImportAnswerSchema = z.strictObject({ outcome: z.enum(SIGNUP_IMPORT_OUTCOMES),
  status: SignupStatusSchema });
// ── end jr6 ──

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
  'panel/profileCheck': ProfileCheckAnswerSchema, // v5 p1-panel
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
  // v5 p1-shell
  'panel/notes': PanelNotesAnswerSchema,
  'panel/closeNote': DoneAnswerSchema,
  // v1.4 F
  'panel/tailor': TailorViewSchema,
  'panel/openDocument': OpenDocumentAnswerSchema,
  'panel/documents': DocumentsAnswerSchema,
  // v1.5 QX
  'queue/status': QueueStatusSchema,
  'queue/list': QueueListAnswerSchema,
  'queue/start': QueueStatusSchema,
  'queue/stop': QueueStatusSchema,
  'queue/pause': QueueStatusSchema,
  'queue/resume': QueueStatusSchema,
  'queue/focus': QueueFocusAnswerSchema,
  // jr6
  'signup/status': SignupStatusSchema,
  'signup/save': SignupStatusSchema,
  'signup/delete': SignupDeleteAnswerSchema,
  'signup/import': SignupImportAnswerSchema,
  'autoApply/closeTab': CloseTabAnswerSchema, // v2.0 P9
  // v3.0 X1-EXT
  'panel/reportClosed': ReportClosedAnswerSchema,
  'reports/closedAuto': ReportClosedAutoAnswerSchema,
} as const satisfies Record<PageMessage['type'], z.ZodType>;

/** pair/complete's answer: {} once the code is redeemed (TailorIT's page reads only `ok`). */
export const EXTERNAL_ANSWER_SCHEMAS = { 'pair/complete': DoneAnswerSchema } as const satisfies Record<ExternalMessage['type'], z.ZodType>;

/** The `preview` port (v3 Phase 3b): the side panel's PDF preview of the resume a fill of the tab attaches. The panel
 *  posts preview/request {tabId}; the worker answers as the resume port does (resume/header, resume/chunk, each
 *  acknowledged with resume/ack, resume/end, then the panel's resume/done; resume/error), from the same checked fetch,
 *  a PDF only. Extension pages only: the bytes never reach a page's process. */
export const PreviewPortMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('preview/request'), tabId: TabId,
    /** v4: which file of the tab's fill: the resume (the default) or the cover letter it attached or would attach. */
    kind: z.enum(['resume', 'coverLetter']).optional(),
    /** v1.5 X: the preview page embedded in the page's dialog names the worker's grant for that dialog: a framed
     *  extension page gets nothing without it (background/document-dialog.ts). */
    grant: z.string().regex(DOCUMENT_GRANT).optional() }),
  ...TRANSFER_MESSAGES,
]);
