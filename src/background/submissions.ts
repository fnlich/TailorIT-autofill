/*
 * Recording "applied" (v3 Phase 4; docs/SPEC-AMENDMENTS.md §12 Decision 6; docs/PRIVACY.md "Applied"). When an
 * application is sent, TailorIT's tracker says Applied, and the side panel says "Application submitted".
 * - submit/armed (content): a Submit of the application was pressed in a frame of the tab: the person's trusted click on
 *   the adapter's own Submit, or the press the panel's Submit application or Submit mode Auto made. The worker keeps,
 *   per tab and application, when, which frame and document, by whom, and what the run knew (the job the person chose
 *   for the application, else the run's lookup's; the resume the run attached, only when its upload row verified on the
 *   form: the frame's `resume`), for SUBMIT_ARM_MS. The arm is kept in storage.session (SUBMIT_ARM_PREFIX), so a
 *   worker stopped while the person solves a check or the page sends still records it, with the posting's canonical
 *   address (Chrome's sender address, read by the platform's parser: never an address the frame sent, the address the
 *   lookup on load sends), so a Try again after the worker was stopped still records it (the audit of 2026-11-06, m4).
 *   The run's job and resume come from its memory, else from its record (runs.ts noteAttached: the audit's M6), so a
 *   Submit after the worker was stopped still names them.
 *   Refused: in a private (incognito) tab; a person's own Submit with no run of ours when "Record applications I submit
 *   myself" is off; and anything until the person acknowledged the disclosure as it reads now.
 * - submit/detected (content): the platform's sign that it was sent, seen after the press: Lever's /thanks page,
 *   Greenhouse's /confirmation page or its confirmation drawn in place, Ashby's success message. It counts only for an
 *   application this tab armed, once: a success message within SUBMIT_ARM_MS; a confirmation page only from the frame
 *   that armed it and within CONFIRMATION_PAGE_MS of the press that led to it (the review, M6); v5 p2-detect: a network
 *   sign (Workday's finalize answered, ClearCompany's completed message) only from the frame and document that armed
 *   it, within SUBMIT_ARM_MS. Never from page text
 *   alone, never in a private tab. Then POST /api/autofill/applied {jobId}, else {url} (the canonical posting address,
 *   as the lookup on load sends it), with the resume; its lookup becomes the card of the frame that saw it.
 * - The arm goes only once TailorIT recorded it (or refused it for good: 403, 400, 404); offline or a failure on
 *   TailorIT's side leaves it, and the side panel's Try again (panel/retryApplied) asks once more.
 * - The tab's page state says where recording stands (PageState.submitted): 'recording', 'recorded', 'not-recorded'
 *   or 'not-allowed' (a connection made before tracker:write), kept in storage.session (SUBMITTED_PREFIX) until the
 *   document that saw it goes, the frame moves to another posting, or the tab closes.
 * - The auto-apply agent's tab (v3 Phase 5): its sign finishes the agent's job instead (agent.ts: POST
 *   /api/autofill/agent/:id/result {state: submitted}, which marks the job Applied in TailorIT), so POST /applied is not
 *   called for it.
 * - Both messages are counted (SUBMIT_MESSAGE_LIMIT a minute per tab), and the application key must fit the frame.
 * - A token change drops every arm and every page state with them (the audit's m4): what was armed for one connection
 *   is never recorded, or offered again, under the next.
 * - v5 p1-panel (PLAN decision 5): once TailorIT recorded the application (its POST /applied answered, a Try again's
 *   included), the tab's top frame is told (`applied`: applied/popup), once per recorded submission, and shows
 *   "Application Submitted!" over the page. Never for the auto-apply agent's own tab (its job's result records it), nor
 *   for one not recorded.
 * - v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16): submit/form (content): the questions and answers of
 *   the form whose Submit the frame armed (content/form-capture.ts), held in this worker's memory only (never storage),
 *   for that frame and document's arm, SUBMIT_ARM_MS at most. Once the site confirmed that Submit, the form goes to
 *   POST /api/autofill/submissions (submitted-forms.ts): the questions always, the answers only while "Keep my
 *   submitted answers in TailorIT" is on. For a job TailorIT has (the arm names its id), after POST /applied recorded
 *   it, as before (/submissions moves the entry to Applied again, which changes nothing); for a posting TailorIT has
 *   no job of, in place of /applied (it does what /applied does, in one transaction, and also adds the posting, from
 *   its ATS or the page's own posting, which /applied could only refuse): its 400 changes nothing on TailorIT's side,
 *   so POST /applied then records the application as before; offline or a failure on TailorIT's side keeps the form
 *   for Try again. The form goes once sent (or the arm goes, the tab closes, the token changes). The auto-apply agent's
 *   own tab: once its result recorded the job, the same body is sent. With no confirmed Submit nothing is ever sent,
 *   and a frame that sent no form (a worker restarted meanwhile) records with POST /applied alone.
 * No log line names the job, the address or the person; storage holds ids, keys and times, and an arm's posting address
 * in storage.session only, never in storage.local.
 */
import { z } from 'zod';
import { applicationOf, type ApplicationRef } from '../adapters';
// v5 p2-detect
import { confirmsApplication } from '../adapters/address';
import { AUTOFILL_LOOKUP_URL_MAX } from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { SUBMITTED_STATES, SUBMIT_PRESSERS, type ContentMessage, type SubmittedState } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { lookupAddressOf, type JobCards } from './job-cards';
import type { createRateLimit } from './locks';
import type { ContentChannel } from './router';
import { keyFitsFrame } from './run-begin';
import type { RunRegistry } from './runs';
import type { ServerClient } from './server-client';
// v1.3 B
import type { FieldSpec } from '../core/types/field';
import type { FieldCategory } from '../core/types/intent';
import type { FrameReport } from '../shared/report';
import { submissionBodyOf, type HeldForm } from './submitted-forms';

/** How long after a Submit was pressed its success message counts. */
export const SUBMIT_ARM_MS = 10 * 60_000;
/** How long after a Submit the platform's confirmation page (a new address) counts: the navigation that press led to. */
export const CONFIRMATION_PAGE_MS = 60_000;
/** submit/armed and submit/detected per tab: a person submits now and then. */
export const SUBMIT_MESSAGE_LIMIT = { count: 12, windowMs: 60_000 } as const;
/** storage.session keys: `${SUBMIT_ARM_PREFIX}${tabId}|${applicationKey}` and `${SUBMITTED_PREFIX}${tabId}`. */
export const SUBMIT_ARM_PREFIX = 'submit-arm:';
export const SUBMITTED_PREFIX = 'submitted:';

type Of<T extends ContentMessage['type']> = Extract<ContentMessage, { type: T }>;

/** A frame, as recording reads it. */
type FrameRef = Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'url'>;

/** What recording needs. */
export interface SubmissionsDeps {
  server: Pick<ServerClient, 'applied'> & Partial<Pick<ServerClient, 'submissions'>>;
  session: StorageArea;
  runs: Pick<RunRegistry, 'find' | 'memo'>;
  jobs: Pick<JobCards, 'remember' | 'epoch' | 'chosen' | 'chosenJob' | 'without'>;
  generation(): number;
  now(): number;
  limit: ReturnType<typeof createRateLimit>;
  /** "Record applications I submit myself" (modes.recordOwn). */
  recordOwn(): Promise<boolean>;
  /** The application key the frame registry holds for a frame (read from its address at its last hello), or null. */
  frameKey(tabId: number, frameId: number): Promise<string | null>;
  /** The person acknowledged the disclosure as it reads now (auth.ts): until then nothing is recorded. */
  disclosed(): Promise<boolean>;
  /** The tab's page state changed (the side panel's "Application submitted"). */
  changed(tabId: number): void;
  /** v3 Phase 5: the auto-apply agent takes the sign of its own tab for its task's application ('not-ours' for any
   *  other tab, or another posting's sign, which is recorded the normal way), and says whether TailorIT took its
   *  result. */
  agentSubmitted?(tabId: number, applicationKey: string): Promise<'not-ours' | 'recorded' | 'not-recorded'>;
  /** v5 p1-panel: TailorIT recorded the tab's application: its top frame shows "Application Submitted!" (module
   *  header). */
  applied?(tabId: number): void;
  /** v1.3 B: "Keep my submitted answers in TailorIT" (settings.modes.keepAnswers 'on'). Absent: on. */
  keepAnswers?(): Promise<boolean>;
  /** v1.3 B: the extension's classification of a question (classifyField's category), for TailorIT's screen. */
  categoryOf?(spec: FieldSpec): FieldCategory | null;
  /** v1.3 B: the frame's report rows, for where each answer came from. */
  rowsOf?(tabId: number, frameId: number): Promise<FrameReport['fields']>;
}

/** A Submit armed, as storage.session keeps it: ids, keys and times only. */
const ArmSchema = z.strictObject({
  at: z.number().int().nonnegative(),
  by: z.enum(SUBMIT_PRESSERS),
  frameId: z.number().int().nonnegative(),
  documentId: z.string().max(100).nullable(),
  jobId: z.number().int().positive().nullable(),
  resumeId: z.string().max(64).nullable(),
  /** When its sign was taken: a second sign records nothing more, and Try again asks with it. */
  detectedAt: z.number().int().nonnegative().optional(),
  /** The posting's canonical address (lookupAddressOf of Chrome's sender address; m4), when it has one. */
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX).optional(),
});
type Arm = z.infer<typeof ArmSchema>;

const SubmittedSchema = z.strictObject({ state: z.enum(SUBMITTED_STATES), docKey: z.string().max(200),
  applicationKey: z.string().max(80) });
type Submitted = z.infer<typeof SubmittedSchema>;

/** The submissions of the tabs. */
export function createSubmissions(deps: SubmissionsDeps) {
  /** Where recording stands per tab, as last read or written (storage.session holds it across a restart). */
  const states = new Map<number, Submitted>();
  /** Requests in flight per tab: a Try again while one runs waits for it. */
  const recording = new Map<number, Promise<void>>();
  /** The frame that saw each tab's confirmation, with its address, memory only: Try again records through it. */
  const seenIn = new Map<number, FrameRef>();
  /** v1.3 B: each armed Submit's form, by `${tabId}|${applicationKey}`: memory only, never storage (module header). */
  const forms = new Map<string, HeldForm>();
  const formKey = (tabId: number, applicationKey: string) => `${tabId}|${applicationKey}`;
  /** The form held for an arm: sent from the frame and document that armed it, within SUBMIT_ARM_MS of the press. */
  function formOf(tabId: number, applicationKey: string, held: Arm): HeldForm | null {
    const form = forms.get(formKey(tabId, applicationKey));
    if (form === undefined) return null;
    if (deps.now() - form.at > SUBMIT_ARM_MS) {
      forms.delete(formKey(tabId, applicationKey));
      return null;
    }
    return form.frameId === held.frameId && form.documentId === held.documentId ? form : null;
  }
  /** POST /submissions for a held form, or null when it has none to send (no form, no body, or a TailorIT client
   *  without the route). */
  async function sendForm(tabId: number, applicationKey: string, held: Arm, ids: { jobId: number | null;
    url: string | null }): Promise<Awaited<ReturnType<ServerClient['submissions']>> | null> {
    const form = formOf(tabId, applicationKey, held);
    if (form === null || deps.server.submissions === undefined) return null;
    // Taken at once: a second record of the same arm running beside this one (two signs at once) sends nothing more.
    forms.delete(formKey(tabId, applicationKey));
    const rows = new Map(((await deps.rowsOf?.(tabId, form.frameId).catch(() => undefined)) ?? [])
      .map((row) => [row.key, row] as const));
    const keepAnswers = (await deps.keepAnswers?.()) ?? true;
    const body = submissionBodyOf(form, { ...ids, resumeId: held.resumeId, keepAnswers,
      categoryOf: (spec) => deps.categoryOf?.(spec) ?? null, rowOf: (key) => rows.get(key) });
    if (body === null) {
      log('submit.form-refused', { fields: form.fields.length });
      return null;
    }
    const answer = await deps.server.submissions(body);
    log('submit.form-sent', { status: answer.ok ? 200 : answer.status ?? 0, questions: body.questions.length,
      answers: body.answers?.length ?? 0, posting: body.posting !== undefined });
    // Gone once TailorIT answered for good (as the arm: submissions.ts record), its 400 included (POST /applied
    // records it then): back only for a Try again after offline or a failure on TailorIT's side.
    if (!answer.ok && !['forbidden', 'bad-request', 'not-found', 'unauthorized', 'not-connected'].includes(answer.failure)
      && !forms.has(formKey(tabId, applicationKey))) {
      forms.set(formKey(tabId, applicationKey), form);
    }
    return answer;
  }
  const armKey = (tabId: number, applicationKey: string) => `${SUBMIT_ARM_PREFIX}${tabId}|${applicationKey}`;
  const docKeyOf = (from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId'>) =>
    `${from.tabId}:${from.frameId}:${from.documentId ?? ''}`;

  async function armOf(key: string): Promise<Arm | null> {
    const parsed = ArmSchema.safeParse(await deps.session.get(key));
    return parsed.success ? parsed.data : null;
  }

  async function submittedOf(tabId: number): Promise<Submitted | null> {
    const held = states.get(tabId);
    if (held !== undefined) return held;
    const parsed = SubmittedSchema.safeParse(await deps.session.get(`${SUBMITTED_PREFIX}${tabId}`));
    if (!parsed.success) return null;
    states.set(tabId, parsed.data);
    return parsed.data;
  }

  async function set(tabId: number, entry: Submitted): Promise<void> {
    states.set(tabId, entry);
    await deps.session.set({ [`${SUBMITTED_PREFIX}${tabId}`]: entry });
    deps.changed(tabId);
  }

  async function forgetState(tabId: number): Promise<void> {
    states.delete(tabId);
    await deps.session.remove([`${SUBMITTED_PREFIX}${tabId}`]);
    deps.changed(tabId);
  }

  async function dropArm(key: string): Promise<void> {
    await deps.session.remove([key]);
  }

  /** The application a frame's address belongs to, as the parser reads it (null: none). */
  function refOf(url: string): ApplicationRef | null {
    try {
      return applicationOf(new URL(url));
    } catch {
      return null;
    }
  }

  // ── v5 p2-detect ──
  /** The tab's Submit armed in the frame `from` names, not yet confirmed, within CONFIRMATION_PAGE_MS, on the posting
   *  whose page after submitting the frame's address is (adapters/address.ts confirmsApplication, by the posting's
   *  address the arm keeps): the newest, with its application's key, else null. */
  async function confirmedArm(from: FrameRef): Promise<{ applicationKey: string; key: string; held: Arm } | null> {
    const prefix = `${SUBMIT_ARM_PREFIX}${from.tabId}|`;
    let best: { applicationKey: string; key: string; held: Arm } | null = null;
    for (const [key, value] of Object.entries(await deps.session.getMany(prefix))) {
      const parsed = ArmSchema.safeParse(value);
      if (!parsed.success) continue;
      const arm = parsed.data;
      const age = deps.now() - arm.at;
      if (arm.frameId !== from.frameId || arm.detectedAt !== undefined || age < 0 || age > CONFIRMATION_PAGE_MS
        || arm.url === undefined || !confirmsApplication(arm.url, from.url)) continue;
      if (best === null || arm.at > best.held.at) best = { applicationKey: key.slice(prefix.length), key, held: arm };
    }
    return best;
  }
  // ── end v5 p2-detect ──

  /** POST /applied for an arm whose sign was taken; the state follows, and the arm goes once TailorIT answered for
   *  good. */
  async function record(applicationKey: string, held: Arm, from: FrameRef, docKey: string): Promise<void> {
    const { tabId } = from;
    const key = armKey(tabId, applicationKey);
    await set(tabId, { state: 'recording', docKey, applicationKey });
    // The agent's own job (v3 Phase 5): its result records Applied; POST /applied is not called for it.
    const agent = (await deps.agentSubmitted?.(tabId, applicationKey)) ?? 'not-ours';
    if (agent !== 'not-ours') {
      await dropArm(key);
      // v1.3 B: the agent's result recorded the job: its form's questions and answers go with the same body.
      if (agent === 'recorded') await sendForm(tabId, applicationKey, held, { jobId: held.jobId, url: held.url ?? null });
      forms.delete(formKey(tabId, applicationKey));
      await set(tabId, { state: agent, docKey, applicationKey });
      return;
    }
    const generation = deps.generation();
    const epoch = deps.jobs.epoch(from);
    const url = held.url ?? null;
    const body = held.jobId !== null ? { jobId: held.jobId } : url !== null ? { url } : null;
    if (body === null) {
      await dropArm(key);
      await set(tabId, { state: 'not-recorded', docKey, applicationKey });
      return;
    }
    // v1.3 B (module header): for a job TailorIT has no id of, a held form goes as POST /submissions in place of
    // /applied, so TailorIT can add the posting; its 400 changed nothing: /applied then.
    const first = held.jobId === null ? await sendForm(tabId, applicationKey, held, { jobId: null, url })
      .catch(() => null) : null;
    if (first !== null && !first.ok && first.failure === 'bad-request') log('submit.form-fallback');
    const answer = first !== null && (first.ok || first.failure !== 'bad-request')
      ? (first.ok ? { ok: true as const, value: first.value.lookup } : first)
      : await deps.server.applied({ ...body, ...(held.resumeId === null ? {} : { resumeId: held.resumeId }) });
    log('submit.recorded', { status: answer.ok ? 200 : answer.status ?? 0 });
    // v1.3 B: a job TailorIT has: once /applied recorded it (and the page says so), the form's questions and answers;
    // their own outcome changes nothing of the record.
    const thenForm = answer.ok && first === null
      ? () => sendForm(tabId, applicationKey, held, { jobId: held.jobId, url }).catch(() => {
        log('submit.form-refused', { fields: 0 });
        return null;
      }) : async () => null;
    if ((await submittedOf(tabId))?.docKey !== docKey) {
      await thenForm();
      return;
    }
    if (answer.ok) {
      await dropArm(key);
      deps.jobs.remember(from, answer.value, { generation, epoch, chosen: deps.jobs.chosen(tabId),
        job: deps.jobs.chosenJob(tabId, applicationKey) });
      await set(tabId, { state: 'recorded', docKey, applicationKey });
      deps.applied?.(tabId); // v5 p1-panel
      await thenForm();
      return;
    }
    // Refused for good: the arm goes. Offline or a failure on TailorIT's side: it stays for Try again.
    if (['forbidden', 'bad-request', 'not-found', 'unauthorized', 'not-connected'].includes(answer.failure)) {
      await dropArm(key);
      // v1.3 B: its form with it.
      forms.delete(formKey(tabId, applicationKey));
    }
    await set(tabId, { state: answer.failure === 'forbidden' ? 'not-allowed' : 'not-recorded', docKey, applicationKey });
  }

  /** Runs one recording of the tab at a time (a Try again waits for the one in flight). */
  async function recordOnce(applicationKey: string, held: Arm, from: FrameRef, docKey: string): Promise<void> {
    const run = record(applicationKey, held, from, docKey);
    recording.set(from.tabId, run);
    try {
      await run;
    } finally {
      if (recording.get(from.tabId) === run) recording.delete(from.tabId);
    }
  }

  return {
    /** submit/armed (module header). */
    async armed(message: Of<'submit/armed'>, from: ContentChannel): Promise<Answer<Record<string, never>>> {
      const retry = deps.limit.take(`${from.tabId}/`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (from.incognito === true) return refuse('expired');
      if (!keyFitsFrame(message.applicationKey, from.url)) return refuse('bad_message');
      // The application is the frame's address's; or, when the press itself moved the page to an address no parser
      // reads, the one the worker read from the frame's address at its hello.
      const ref = refOf(from.url);
      const fits = ref !== null ? ref.applicationKey === message.applicationKey
        : (await deps.frameKey(from.tabId, from.frameId)) === message.applicationKey;
      if (!fits) return refuse('bad_message');
      if (!(await deps.disclosed())) {
        log('submit.refused', { armed: false });
        return refuse('expired');
      }
      const run = message.runId === undefined ? null : await deps.runs.find(message.runId, from);
      // The person's own Submit with no run of ours is recorded only while they keep that mode on (Jobright's).
      if (run === null && message.by === 'page' && !(await deps.recordOwn())) {
        log('submit.refused', { armed: false });
        return refuse('expired');
      }
      const memo = run === null ? null : deps.runs.memo(run.runId);
      const chosen = deps.jobs.chosenJob(from.tabId, message.applicationKey);
      // The run's lookup and resume from its memory; after the worker was stopped, from its record (M6).
      const looked = memo === null ? null : memo.lookup !== undefined ? memo.lookup?.job?.id ?? null : run?.jobId ?? null;
      const attached = memo === null ? null : memo.resume !== undefined ? memo.resume?.id ?? null
        : run?.resumeId ?? null;
      const key = armKey(from.tabId, message.applicationKey);
      const url = ref === null ? null : lookupAddressOf(from.url);
      // The resume only when the run's own upload verified on the form, and the person did not choose to apply
      // without one.
      const resumeId = message.resume === true && !deps.jobs.without(from.tabId, message.applicationKey)
        ? attached : null;
      const arm: Arm = { at: deps.now(), by: message.by, frameId: from.frameId, documentId: from.documentId ?? null,
        jobId: chosen ?? looked, resumeId, ...(url !== null && url.length <= AUTOFILL_LOOKUP_URL_MAX ? { url } : {}) };
      await deps.session.set({ [key]: arm });
      log('submit.armed', { page: message.by === 'page', panel: message.by === 'panel', auto: message.by === 'auto',
        run: run !== null });
      return ok({});
    },

    /** v1.3 B: submit/form (module header): held for the arm of the same frame and document, memory only. */
    async form(message: Of<'submit/form'>, from: ContentChannel): Promise<Answer<Record<string, never>>> {
      const retry = deps.limit.take(`${from.tabId}/`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (from.incognito === true) return refuse('expired');
      if (!keyFitsFrame(message.applicationKey, from.url)) return refuse('bad_message');
      const ref = refOf(from.url);
      const fits = ref !== null ? ref.applicationKey === message.applicationKey
        : (await deps.frameKey(from.tabId, from.frameId)) === message.applicationKey;
      if (!fits) return refuse('bad_message');
      if (!(await deps.disclosed())) {
        log('submit.form-refused', { fields: message.fields.length });
        return refuse('expired');
      }
      forms.set(formKey(from.tabId, message.applicationKey), { at: deps.now(), frameId: from.frameId,
        documentId: from.documentId ?? null, fields: message.fields, posting: message.posting ?? null });
      log('submit.form-held', { fields: message.fields.length });
      return ok({});
    },

    /** submit/detected (module header). */
    async detected(message: Of<'submit/detected'>, from: ContentChannel): Promise<Answer<Record<string, never>>> {
      const retry = deps.limit.take(`${from.tabId}/`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      if (from.incognito === true) return refuse('expired');
      if (!keyFitsFrame(message.applicationKey, from.url)) return refuse('bad_message');
      let applicationKey = message.applicationKey;
      let key = armKey(from.tabId, applicationKey);
      let held = await armOf(key);
      // ── v5 p2-detect: a page after submitting whose own address names its posting but not the whole application
      // (JazzHR's /apply/confirm/<code>): the tab's Submit armed in this frame on that posting (confirmedArm). ──
      if (held === null && message.evidence === 'confirmation-page') {
        const found = await confirmedArm(from);
        if (found !== null) ({ applicationKey, key, held } = found);
      }
      const age = held === null ? Number.POSITIVE_INFINITY : deps.now() - held.at;
      const page = message.evidence === 'confirmation-page';
      // ── v5 p2-detect: a network sign is the arming document's own (its page-world watcher's, content/submitted.ts
      // watchNetworkSigns): only from the frame and document that armed it. ──
      const own = message.evidence !== 'network' || (held !== null && held.frameId === from.frameId
        && held.documentId === (from.documentId ?? null));
      // A confirmation page counts only in the frame that pressed, soon after the press that led to it; a success
      // message within SUBMIT_ARM_MS. Once: a sign already taken records nothing more.
      const fresh = held !== null && held.detectedAt === undefined && age >= 0 && own
        && (page ? held.frameId === from.frameId && age <= CONFIRMATION_PAGE_MS : age <= SUBMIT_ARM_MS);
      if (held === null || !fresh) {
        if (held !== null && held.detectedAt === undefined && age > SUBMIT_ARM_MS) await dropArm(key);
        log('submit.refused', { armed: held !== null });
        return refuse('expired');
      }
      // A confirmation page's own address, when it names the same application, is the posting's too.
      const ref = refOf(from.url);
      const seenUrl = ref !== null && ref.applicationKey === applicationKey && held.url === undefined
        ? lookupAddressOf(from.url) : null;
      const taken: Arm = { ...held, detectedAt: deps.now(),
        ...(seenUrl !== null && seenUrl.length <= AUTOFILL_LOOKUP_URL_MAX ? { url: seenUrl } : {}) };
      await deps.session.set({ [key]: taken });
      log('submit.detected', { page });
      seenIn.set(from.tabId, { tabId: from.tabId, frameId: from.frameId, documentId: from.documentId, url: from.url });
      await recordOnce(applicationKey, taken, from, docKeyOf(from));
      return ok({});
    },

    /** panel/retryApplied: Try again, for the tab whose recording failed (offline, TailorIT's failure). `frameOf`
     *  names the frame that saw the confirmation, as the registry holds it now. */
    async retry(tabId: number, frameOf: (tabId: number, frameId: number) => Promise<FrameRef | null>):
      Promise<Answer<Record<string, never>>> {
      await recording.get(tabId);
      const state = await submittedOf(tabId);
      if (state === null || state.state !== 'not-recorded') return refuse('expired');
      const held = await armOf(armKey(tabId, state.applicationKey));
      if (held === null || held.detectedAt === undefined) return refuse('expired');
      const frameId = Number(state.docKey.split(':')[1]);
      const seen = seenIn.get(tabId);
      const frame = seen !== undefined && docKeyOf(seen) === state.docKey ? seen
        : Number.isInteger(frameId) ? await frameOf(tabId, frameId) : null;
      if (frame === null || docKeyOf(frame) !== state.docKey) return refuse('expired');
      await recordOnce(state.applicationKey, held, frame, state.docKey);
      return ok({});
    },

    /** Where recording stands for the tab's page (undefined: nothing was submitted there). */
    async stateOf(tabId: number): Promise<SubmittedState | undefined> {
      return (await submittedOf(tabId))?.state;
    },

    /** A frame's document went: what it saw goes with it. */
    async forgetDocument(tabId: number, frameId: number, documentId: string | null): Promise<void> {
      if ((await submittedOf(tabId))?.docKey === `${tabId}:${frameId}:${documentId ?? ''}`) await forgetState(tabId);
    },

    /** A frame moved to another address in its document (a board's next posting): what it saw goes, unless the address
     *  is the same application's (its confirmation page). */
    async moved(tabId: number, frameId: number, documentId: string | null, applicationKey: string | null): Promise<void> {
      const held = await submittedOf(tabId);
      if (held === null || held.docKey !== `${tabId}:${frameId}:${documentId ?? ''}`) return;
      if (held.applicationKey !== applicationKey) await forgetState(tabId);
    },

    async forgetTab(tabId: number): Promise<void> {
      states.delete(tabId);
      seenIn.delete(tabId);
      for (const key of [...forms.keys()]) if (key.startsWith(`${tabId}|`)) forms.delete(key);
      const prefix = `${SUBMIT_ARM_PREFIX}${tabId}|`;
      const stored = Object.keys(await deps.session.getMany(prefix));
      await deps.session.remove([`${SUBMITTED_PREFIX}${tabId}`, ...stored]);
      deps.limit.forget(`${tabId}/`);
    },

    /** The token changed: what was armed for it goes (its job and resume are the old connection's), and with the arms
     *  every page state, so no Try again is offered that could only fail, and nothing the old connection recorded is
     *  said of the new one (the audit of 2026-11-06, m4). Each tab whose state went is told. */
    async dropTokenData(): Promise<void> {
      const held = Object.keys(await deps.session.getMany(SUBMITTED_PREFIX));
      const tabs = new Set([...states.keys(), ...held.map((key) => Number(key.slice(SUBMITTED_PREFIX.length)))]
        .filter((tabId) => Number.isInteger(tabId)));
      states.clear();
      seenIn.clear();
      // v1.3 B: a form armed under the old connection is never sent under the next.
      forms.clear();
      await deps.session.remove([...Object.keys(await deps.session.getMany(SUBMIT_ARM_PREFIX)), ...held]);
      for (const tabId of tabs) deps.changed(tabId);
    },
  };
}

/** The submissions, as index.ts wires them. */
export type Submissions = ReturnType<typeof createSubmissions>;
