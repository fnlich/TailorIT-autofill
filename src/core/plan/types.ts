/*
 * The planner's contract with the worker. For each plan/request the worker hands planFrame (frame.ts) the frame's
 * scan and the keys this pass plans, with the canonical profile it holds, and answers the frame with the PlanOutput as
 * it is (PlanAnswerSchema in messaging/schemas.ts). So a frame receives values for its own fields only, never the
 * profile.
 */
import type { MatchCacheEntry, MatchCacheStore } from '../matcher/cache';
import type { TiebreakItem, TiebreakVerdict } from '../matcher/types';
import type { ClassifyItem, ClassifyVerdict } from '../resolver/classify';
import type { CompanyScope } from '../resolver/saved';
import type { RepeatableAnswer, RepeatableRequest } from '../steps/blocks';
import type { BaseKey, FieldKey, FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../types/fill';
import type { Profile, SensitiveState, Ymd } from '../types/profile';
import type { SavedAnswer } from '../types/saved';
import type { Settings } from '../types/settings';
import type { Vocab } from '../vocab/types';
import type { AnswerItem, AnswerVerdict } from './answers';
import type { DraftItem, DraftVerdict } from './drafts';

/** canonicalizeProfile's state, plus 'unavailable': the worker tried to fetch the sensitive part and failed for a reason
 *  other than a 403 (a timeout, a 5xx). Fields that need it are then left blank and flagged sensitive-unavailable. */
export type PlanSensitiveState = SensitiveState | 'unavailable';

export interface PlanInput {
  /** The frame's whole scan, in DOM order, as it scanned it (parsed and capped by the worker): the fields to plan and
   *  the context the planner reads across the frame (a code select beside a phone). */
  specs: readonly FieldSpec[];
  /** The keys of the specs to plan this pass (a later pass plans only what is pending). Only these are resolved,
   *  matched, written and rowed; the rest are context only. Absent: every spec (the Phase 3 review, LC-2). */
  planKeys?: readonly FieldKey[];
  /** The page's canaries as the frame extracted them (at most 32). Every outgoing value is scanned for them. */
  canaries: readonly string[];
  profile: Profile;
  sensitiveState: PlanSensitiveState;
  /** The person's saved answers (Phase 6): GET /answers, fetched with the profile, in the worker's memory only. */
  savedAnswers: readonly SavedAnswer[];
  /** The company the form belongs to (its platform and board, from the frame's address), for answers saved for one
   *  company: free text only. Absent when the address names none: then no company's answer applies. */
  company?: CompanyScope;
  settings: Settings;
  vocab: Vocab;
  /** The worker's accepted-match cache, read only. */
  cache?: MatchCacheStore;
  /** A dry run plans rows only: `writes` is empty, so no value reaches the frame. */
  dryRun: boolean;
  now: Ymd;
  /** What the LLM has answered in this run (Phase 4); absent: nothing yet. The worker keeps it for the run only. */
  ai?: PlanAi;
  /** The repeatable sections the frame's adapter shows on this step (Phase 5, steps/blocks.ts): each block's entry is
   *  assigned (or the frame's assignment kept) and the resolver fills the block from it. Absent: none, and a block's
   *  fields use the entry its place names. */
  repeatables?: readonly RepeatableRequest[];
  /** The loop's reveal edges on this step (parent, child base keys: the writer whose write revealed the child), for a
   *  draft's context (Phase 6 review, E2). Absent: none known. */
  revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  /** What TailorIT's lookup knows of the posting (the run's lookup, in the worker's memory): its company, for "Have
   *  you worked here before?", and its location, whose country interpretation 1 reads. Absent: no job was found. */
  posting?: { company?: string; location?: string };
  /** The run fills from the profile only (the owner's amendments): its posting forbids AI, and the person's setting
   *  says so (settings.llm.whenForbidden). No tiebreak, classification, draft or answer is asked, and nothing is
   *  editable with AI; a question only the AI could answer is left for the person (ai-off-for-posting). */
  noAi?: boolean;
  /** The run, or an earlier one of its application, has asked TailorIT's AI something (a task submitted, a cover
   *  letter written): an "I did not use AI" attestation is then false, and never ticked (the owner's decision of
   *  2026-11-01). Absent: none known. */
  aiUsed?: boolean;
  /** Edit with AI: the one field whose text the person asked TailorIT to rewrite (its draft, with what it holds now).
   *  Only that key is planned. */
  rewrite?: FieldKey;
  /** v5 p2-stream (one round): a question nothing classified, which the AI would answer once classified unknown, asks
   *  its category and its answer in one task (AnswerItem.classify) instead of a classification first; the category,
   *  once in, decides as before, and the answer is used only where it then leaves the question to the AI. Absent: a
   *  classification first, as before (and always where the answer would not be used: AI answers off, a dry run). */
  oneRound?: boolean;
  /** The run's cover letter as the worker knows it (Phase G; memory only). Absent: not asked yet, so a cover-letter
   *  upload the plan could fill waits for it (PlanOutput.coverLetter). Ready: the plan attaches it (withCoverLetter). */
  coverLetter?: CoverLetterState;
  /** v3 Phase 3b: the person chose "Apply without resume" for the tab: a resume upload is left for them
   *  (resume-not-attached, skipped; needing them only where the form requires one). */
  withoutResume?: boolean;
}

/** Why a cover-letter upload has no letter (Phase G), as its row says: TailorIT could not write one, or the person's own
 *  is not finished (`failed`); there is none and TailorIT's AI may not write one here; TailorIT could not be asked or
 *  could not send it; it took past the worker's cap; the connection was made before cover letters. */
export type CoverLetterGap = Extract<ReasonCode, 'cover-letter-failed' | 'cover-letter-none' | 'cover-letter-unavailable'
  | 'cover-letter-timed-out' | 'cover-letter-reconnect'>;

/**
 * Where the run's cover letter stands (Phase G): ready to upload (`aiWritten`: TailorIT's AI wrote it, during this run
 * or before it, and the person never edited it; else it is the person's own), still being found or written, or none,
 * with why.
 */
export type CoverLetterState =
  /** `text`: its words, once a cover-letter text box asked for them (v3 Phase 3b); `textUnavailable`: they were asked
   *  for and could not be read. */
  | { state: 'ready'; aiWritten: boolean; text?: string; textUnavailable?: true }
  | { state: 'waiting' }
  | { state: 'none'; reason: CoverLetterGap };

/** A tiebreak verdict, with the TailorIT task that gave it: an llm-pick write names that task. */
export interface AnsweredVerdict {
  verdict: TiebreakVerdict;
  taskId: string;
}

/** The LLM's answers so far in a run, which planFrame completes waiting fields with (Phase 4). */
export interface PlanAi {
  /** Tiebreak verdicts by item id (tiebreakId). A verdict completes only the item it was given for. */
  verdicts: ReadonlyMap<string, AnsweredVerdict>;
  /** Classifications by field key. */
  classifications: ReadonlyMap<string, ClassifyVerdict>;
  /** Drafts by field key (Phase 6, drafts.ts): a text, or why there is none. */
  drafts?: ReadonlyMap<string, DraftVerdict>;
  /** AI answers by field key (answers.ts): a chosen option, a text, or why there is none. */
  answers?: ReadonlyMap<string, AnswerVerdict>;
  /** v5 p2-stream (the P2 review, M1): fields an answer task asked with their category held back (TailorIT's answer
   *  screen, or the extension's own): a classify task names them first, as before one round. */
  classifyFirst?: ReadonlySet<string>;
}

/** The questions a plan needs the LLM for (Phase 4): each awaiting key has exactly one. */
export interface PlanAsk {
  /** Single-answer fields the cascade could not decide, as tiebreak items (settings.llm.tiebreak on). */
  tiebreaks: TiebreakItem[];
  /** Fields nothing classified, screened and with something to classify (settings.llm.classify on). */
  classify: ClassifyItem[];
  /** Free-text questions to draft an answer for (Phase 6, settings.llm.drafts on; drafts.ts), or the one field Edit with
   *  AI rewrites. */
  drafts?: DraftItem[];
  /** Questions nothing else settled, for TailorIT's AI to answer (settings.llm.answers on; answers.ts). */
  answers?: AnswerItem[];
}

/** A match the planner would cache once accepted (core/matcher/cache.ts cacheEntryFor): the field it was written to,
 *  the cache key and the entry. The worker keeps it in memory and stores it only when the field was unchanged at the
 *  run's done (acceptedBy 'run-complete'); never an unconfirmed LLM pick, an EEO, legal, consent or sensitive field. */
export interface CacheCandidate {
  fieldKey: FieldKey;
  cacheKey: string;
  entry: Omit<MatchCacheEntry, 'acceptedBy' | 'at'>;
}

export interface PlanOutput {
  /** One per field to write, in DOM order; each has passed guardWrite. */
  writes: PlannedWrite[];
  /** One row per planned spec, in the request's order. The row of a field with a write is the row its fill produces when the
   *  value reads back as planned (wrote false, verification 'not-checked'); the frame settles it after the fill. In a
   *  dry run these rows are the report. */
  results: FillResult[];
  /** Keys waiting for the LLM, whose writes come back through plan/poll (Phase 4). Each has a row in `results`: the
   *  one that stands until the LLM answers (blank and flagged), and the question in `ask`. */
  awaiting: FieldKey[];
  /** The planned keys whose answer the person may save (Save my answer, T6-1): a class that takes saved answers, a
   *  kind one can fill, a question the classify screen lets through. Any other row offers no Save. Absent: none. */
  savable?: FieldKey[];
  /** What to ask the LLM for the awaiting keys; absent when nothing waits. */
  ask?: PlanAsk;
  /** True when a field needs the sensitive part while sensitiveState is 'not-loaded'. The worker then fetches
   *  GET /profile/sensitive, once per run, and plans again; writes, results and awaiting are empty. */
  needsSensitive: boolean;
  /** The canaries the worker may keep in RunState: none that equals a profile value. */
  persistableCanaries: string[];
  /** One per requested repeatable section (PlanInput.repeatables): the profile's entry count, each block's entry and
   *  whether it is a current job. Indices, counts and flags only. Absent when none was requested. */
  repeatables?: RepeatableAnswer[];
  /** The writes' matches the worker may cache once accepted (Phase 6); absent when there are none. Never sent to the
   *  frame. */
  cacheCandidates?: CacheCandidate[];
  /** Cache keys whose entries no longer fit the options (matchOne's cacheDrop): the worker deletes them. Absent when
   *  there are none. Never sent to the frame. */
  cacheDrops?: string[];
  /** The planned keys the page may offer Edit with AI on (drafts.ts aiEditableField); absent: none (a dry run, a run
   *  filling from the profile only). */
  aiEditable?: FieldKey[];
  /** The frame's scan holds an "I did not use AI" attestation: the frame fills from the profile only from now on
   *  (unless the person's setting is to use the AI anyway), and says so. */
  aiAttestation?: true;
  /** The cover-letter uploads that wait for the run's cover letter (Phase G), never in `awaiting` (they are no LLM
   *  question): the worker asks TailorIT once per run, then plans them again. `generate`: TailorIT's AI may write one
   *  when the person has none (never in a dry run, a profile-only run, or with AI-written answers off). `text` (v3
   *  Phase 3b): a cover-letter text box among them, so the worker reads the ready letter's words too. Absent: none. */
  coverLetter?: { keys: FieldKey[]; generate: boolean; text?: true };
}
