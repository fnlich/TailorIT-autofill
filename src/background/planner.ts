/*
 * plan/request and plan/poll: the worker runs the core's planFrame over one pass of a frame's fields with the
 * canonical profile it holds, and answers that frame's planned writes and value-free rows. The request carries the
 * frame's whole scan as context and the keys this pass plans (planKeys, each a spec's key: the schema checks it); the
 * worker plans and answers those only (the Phase 3 review, LC-2). So a frame receives values for its own fields only,
 * never the profile. When the plan needs the sensitive part and it is not in memory, the worker fetches it once per
 * run and plans again; a 403 makes it 'not-shared' and any other failure 'unavailable', and the core leaves those
 * fields blank and flagged. A pass that plans a file field first attaches the run's resume (resume-choice.ts), the one
 * the resume port then sends. A dry run's answer never carries a write. Every answer is checked against
 * PlanAnswerSchema (its caps included) before it leaves.
 *
 * The LLM steps (Phase 4; docs/design/runtime.md §4.5): a plan's awaiting keys go, with their questions, to the run's
 * RunAi (ai-tasks.ts), which submits them as TailorIT tasks, one in flight per run; the answer lists those keys as
 * awaiting, each with the row that stands until the LLM answers. plan/poll answers the keys whose answers are in: they
 * are planned again over the scan and canaries they were asked with, and the run's answers, so a pick arrives as an
 * llm-pick write (which the frame checks again before it writes) and a classification as the field's category; keys
 * still waited for stay awaiting. A poll answers at once: the frame waits between polls, and each poll keeps the worker
 * awake. A key the run does not know (a worker that restarted lost its memory) is left out of the answer, and a poll
 * that names no key the run knows answers expired: the frame plans those fields again with plan/request, and the batch
 * is read again by its task id (RunState.aiTasks) or reattached by TailorIT's dedupe key. An item never sent, and an
 * answer already in, are planned again within the same message.
 *
 * Repeatable sections (Phase 5): plan/request names the sections the frame's adapter shows on its step, and planFrame
 * gives each block its profile entry (core/steps/blocks.ts: a block the site prefilled keeps the entry it holds) and
 * fills the block from it; the answer carries each section's entry count, block entries and current-job flags, never a
 * fingerprint. A request that carries an assignment (the frame's, from an earlier answer) is planned with it, and the
 * fields that wait for the LLM are planned again with the entries their blocks were given.
 *
 * Phase 6 (wave 2):
 * - Saved answers: every plan reads the person's saved answers the profile cache holds (GET /answers, read with the
 *   profile, memory only), and the company the frame's address names (adapters/company.ts companyOfUrl), so a
 *   free-text answer applies only on its own company's forms. The run's memo keeps that company for Save my answer;
 *   a worker stopped meanwhile takes the frame's own word for it instead (row-actions.ts, E5).
 * - Drafts: a plan that asks for drafts sends them with the posting text the frame read (plan/request's postingText;
 *   '' without it, as for a form embedded in another page), the lookup's company and job title, and the resume the run
 *   attaches (resume-choice.ts), with the request's canaries. The request's reveal edges (revealEdges) are planned
 *   with, so a box an EEO, legal or sensitive question revealed gets no draft (the Phase 6 review, E2).
 * - Save my answer (T6-1): the answer names the planned keys whose answer the person may save (`savable`, the core's
 *   screen), and the frame offers Save on those only.
 * - The accepted-match cache (match-cache.ts): every plan reads it, its stale entries are dropped, and the writes'
 *   candidates go to the accept book, which stores them once the field was unchanged at the run's done.
 *
 * The owner's amendments (docs/SPEC-AMENDMENTS.md):
 * - Answers: a plan that asks for drafts or answers sends them with the same job context (the posting text the frame
 *   read, the lookup's company and title, the resume the run attaches). Every plan reads the run's lookup for the
 *   posting's company and location ("Have you worked here before?", interpretation 1's country), from the worker's
 *   memory: the lookup never reaches the frame.
 * - Profile only: a request that says its run fills from the profile only (plan/request's noAi) is planned with no LLM
 *   step, and so are its fields when they are planned again; nothing is asked of TailorIT's AI. The first such request
 *   marks the run (in memory, by its memo), so its later plans and polls, those of keys asked before the mark included,
 *   ask nothing either, and draft/rewrite is refused (the Phase E review, security MINOR 4).
 * - Edit with AI (draft/rewrite): the one field is planned as a rewrite (PlanInput.rewrite) over the scan the frame
 *   sent, the run's earlier draft or answer of it forgotten, and its draft asked with what the box holds now; the
 *   answer is plan/request's (the field awaiting), and plan/poll brings the write. Never in a dry run, a profile-only
 *   run, or with AI-written answers off (settings.llm.drafts: the Phase E review, MINOR 8).
 * - The answer names the keys the page may offer Edit with AI on (`aiEditable`), and says when the frame's scan holds
 *   an "I did not use AI" attestation (`aiAttestation`).
 *
 * Cover letters (Phase G; cover-letters.ts): a plan's cover-letter uploads (PlanOutput.coverLetter) have the run ask
 * TailorIT for its letter once (the lookup's job, else the request's `posting` names; the resume the run attaches; and,
 * where TailorIT's AI may write it, the request's posting text and canaries), and wait for it as awaiting keys the frame
 * polls; plan/poll plans them again once the letter is settled, with the letter's state in PlanInput.coverLetter. The
 * letter's id stays in the run's memo for the resume port.
 */
import type { z } from 'zod';
import type { PlanAsk, PlanOutput, PlanSensitiveState } from '../core/plan/types';
import type { RepeatableAnswer } from '../core/steps/blocks';
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PlanAnswerSchema, type ContentMessage } from '../messaging/schemas';
import { log } from '../shared/log';
import type { RunRecord } from '../shared/stored';
import { createRunAi, type AiTasks, type AskContext, type RunAi } from './ai-tasks';
import { createRunLetter, type LetterDeps } from './cover-letters';
import { ymdOf, type CoreFunctions } from './core';
import type { AcceptBook, MatchCache } from './match-cache';
import type { ProfileCache } from './profile-cache';
import { companyOfUrl } from './saved-answers';
import type { ResumeChooser } from './resume-choice';
import type { FrameRef, RunMemo, RunRegistry } from './runs';
import type { RunStateStore } from './runstate-store';
import type { SettingsStore } from './settings';

type PlanAnswer = z.infer<typeof PlanAnswerSchema>;
type PlanRequest = Extract<ContentMessage, { type: 'plan/request' }>;
type PlanPoll = Extract<ContentMessage, { type: 'plan/poll' }>;
type DraftRewrite = Extract<ContentMessage, { type: 'draft/rewrite' }>;

/** How many times one message plans keys again whose answers are already in (an item never sent, or a classification
 *  whose tiebreak's answer is in too). What is left waits for the next poll. */
const MAX_REPLANS = 2;

/** What the planner needs. */
export interface PlannerDeps {
  runs: RunRegistry;
  profiles: ProfileCache;
  settings: SettingsStore;
  core: Pick<CoreFunctions, 'planFrame' | 'vocab' | 'attachResume'>;
  /** The resume a run attaches; the resume port sends the same one. */
  chooseResume: ResumeChooser;
  /** The AI task client (ai-tasks.ts), shared by every run. */
  ai: AiTasks;
  /** Each run's AI task ids: RunState.aiTasks (runstate-store.ts). */
  aiTaskIds: Pick<RunStateStore, 'aiTasks'>;
  /** The accepted-match cache (Phase 6): read at every plan, its stale entries dropped. Absent: plans run without one. */
  cache?: Pick<MatchCache, 'ready' | 'get' | 'sealLabel' | 'drop'>;
  /** Which writes' matches the cache may take once accepted (Phase 6). */
  accepts?: Pick<AcceptBook, 'planned'>;
  /** What a run's cover letter is asked with (Phase G, cover-letters.ts). Absent: no plan asks for one, and a
   *  cover-letter upload waits until the frame stops waiting (tests that plan no letter). */
  letters?: LetterDeps;
  now(): number;
  /** v3 Phase 3b: whether the person chose "Apply without resume" for a tab (job-cards.ts): its runs attach none. */
  withoutResume?(tabId: number, applicationKey: string | null): boolean;
}

const profileRefusal = (failure: 'not-connected' | 'unavailable' | 'internal') =>
  refuse(failure === 'not-connected' ? 'not_connected' : failure === 'internal' ? 'internal' : 'unavailable');

/** A plan and the profile's revision it read, or the refusal the frame gets instead. */
type Planned = { output: PlanOutput; revision: number } | { refusal: Answer<never> };

/** A plan's parts as the answer carries them, gathered over the plans of one message. */
interface Gathered {
  writes: PlannedWrite[];
  results: FillResult[];
  awaiting: FieldKey[];
  /** The keys whose answer the person may save (T6-1), as the latest plan of each key said. */
  savable: FieldKey[];
  /** The keys the page may offer Edit with AI on, as the latest plan of each key said. */
  aiEditable: FieldKey[];
  /** A plan found an "I did not use AI" attestation in the frame's scan. */
  aiAttestation?: true;
  repeatables?: RepeatableAnswer[];
}

/** The context a plan's waiting keys are planned again with: its sections with the entries the plan gave their
 *  blocks (Phase 5), so a field the LLM answers is filled from the same entry. */
function withEntries(context: AskContext, output: PlanOutput): AskContext {
  if (output.repeatables === undefined) return context;
  return { ...context, repeatables: output.repeatables.map((answer) => ({ kind: answer.kind, entries: answer.entries })) };
}

/** The plan/request and plan/poll handlers. */
export function createPlanner(deps: PlannerDeps) {
  /** The run's LLM questions and answers, made at its first need. */
  function aiOf(run: RunRecord): RunAi {
    const memo = deps.runs.memo(run.runId);
    memo.ai ??= createRunAi(deps.ai, deps.aiTaskIds.aiTasks(run.applicationKey, run.tabId), deps.core.vocab());
    return memo.ai;
  }

  /** The runs that fill from the profile only (by their memory-only memo, so a run that goes takes its mark with it):
   *  the first request that says noAi marks its run, and every later plan of it, its polls and plans again included,
   *  asks no AI; draft/rewrite is refused (the Phase E review, security MINOR 4). */
  const profileOnly = new WeakSet<RunMemo>();
  const aiOffFor = (run: RunRecord, context: AskContext): boolean => context.noAi === true
    || profileOnly.has(deps.runs.memo(run.runId));

  /**
   * One plan of `planKeys` over a scan and its canaries: the sensitive part fetched once per run when the plan needs
   * it (then planned again), and the run's resume attached when it plans a file field.
   */
  async function planOnce(run: RunRecord, url: string, context: AskContext, planKeys: readonly FieldKey[]):
    Promise<Planned> {
    let loaded = await deps.profiles.get();
    if (!loaded.ok) return { refusal: profileRefusal(loaded.failure) };
    const planned = new Set<string>(planKeys);
    const resume = context.specs.some((spec) => spec.kind === 'file' && planned.has(spec.key))
      ? await deps.chooseResume(run.runId, url) : null;
    // v3 Phase 3b: "Apply without resume": the resume upload is left for the person, and nothing is attached.
    const tabOf = deps.runs.memo(run.runId).tabId;
    const withoutResume = tabOf !== undefined && deps.withoutResume?.(tabOf, run.applicationKey) === true;
    const ai = aiOf(run);
    const settings = await deps.settings.get();
    await deps.cache?.ready();
    // The company the frame's address names: a free-text saved answer applies only to its own (Phase 6).
    const company = companyOfUrl(url);
    deps.runs.memo(run.runId).company = company;
    // What the run's lookup knows of the posting: its company and location (the owner's amendments). Memory only.
    const job = deps.runs.memo(run.runId).lookup?.job ?? null;
    const posting = job === null ? null : { company: job.companyName, location: job.location };
    // The run's cover letter as far as it is known (Phase G): planFrame attaches it once ready.
    const letter = deps.runs.memo(run.runId).letter?.input();
    // Whether the run, or an earlier one of its application, asked TailorIT's AI anything (a task submitted, a cover
    // letter written): its "I did not use AI" attestation is then untrue (the owner's decision of 2026-11-01).
    const aiUsed = ai.used() || run.letterWritten === true
      || (await deps.aiTaskIds.aiTasks(run.applicationKey, run.tabId).any?.()) === true;
    const plan = (state: PlanSensitiveState, profile: typeof loaded & { ok: true }) => deps.core.planFrame({
      specs: context.specs,
      planKeys,
      canaries: context.canaries,
      profile: deps.core.attachResume(profile.value.profile, withoutResume ? null : resume),
      sensitiveState: state,
      savedAnswers: profile.value.savedAnswers,
      ...(company === null ? {} : { company }),
      settings,
      vocab: deps.core.vocab(),
      ...(deps.cache === undefined ? {} : { cache: deps.cache }),
      dryRun: run.dryRun,
      now: ymdOf(deps.now()),
      ai: ai.answers,
      ...(context.repeatables === undefined ? {} : { repeatables: context.repeatables }),
      ...(context.revealEdges === undefined ? {} : { revealEdges: context.revealEdges }),
      ...(posting === null ? {} : { posting }),
      ...(aiOffFor(run, context) ? { noAi: true } : {}),
      ...(aiUsed ? { aiUsed: true } : {}),
      ...(context.rewrite === undefined ? {} : { rewrite: context.rewrite }),
      ...(letter === undefined ? {} : { coverLetter: letter }),
      ...(withoutResume ? { withoutResume: true } : {}),
    });
    try {
      const memory = loaded.value.sensitiveState;
      let state: PlanSensitiveState = memory !== 'not-loaded' ? memory
        : run.sensitive === 'not-shared' || run.sensitive === 'unavailable' ? run.sensitive : 'not-loaded';
      let output = plan(state, loaded);
      if (output.needsSensitive && state === 'not-loaded') {
        const fetched = await deps.profiles.loadSensitive();
        await deps.runs.setSensitive(run.runId, fetched);
        if (fetched === 'loaded') {
          loaded = await deps.profiles.get();
          if (!loaded.ok) return { refusal: profileRefusal(loaded.failure) };
          state = loaded.value.sensitiveState === 'not-loaded' ? 'unavailable' : loaded.value.sensitiveState;
        } else {
          state = fetched;
        }
        output = plan(state, loaded);
      }
      if (output.needsSensitive) throw new Error('the plan still needs the sensitive part');
      if (output.cacheDrops !== undefined) await deps.cache?.drop(output.cacheDrops);
      if (output.cacheCandidates !== undefined && !run.dryRun) {
        deps.accepts?.planned(run.applicationKey, output.cacheCandidates);
      }
      return { output, revision: loaded.value.revision };
    } catch {
      log('plan.failed', { fields: planKeys.length });
      return { refusal: refuse('internal') };
    }
  }

  /**
   * The context a plan's drafts and answers are asked with (Phase 6; the owner's amendments): the posting text the
   * frame read ('' without it), the lookup's company and job title, and the resume the run attaches. Made once per
   * context.
   */
  async function withDraftContext(run: RunRecord, url: string, context: AskContext): Promise<AskContext> {
    if (context.draft !== undefined) return context;
    const resume = await deps.chooseResume(run.runId, url);
    const job = deps.runs.memo(run.runId).lookup?.job ?? null;
    return { ...context, draft: { jobText: context.postingText ?? '', company: job?.companyName ?? '',
      jobTitle: job?.title ?? '', resumeId: resume?.id ?? null } };
  }

  /**
   * A plan's cover-letter uploads (Phase G): the run's letter is asked for once, by the first plan that has one to
   * fill, and they wait for it as keys the frame polls (planned again with this context once it is settled).
   * TailorIT's AI may write it only when the plan says so, the run is no dry run and it is not marked profile-only.
   * The lookup's job (id, company, title) stays here; without one, the page's own title's names are asked with.
   */
  async function awaitLetter(run: RunRecord, url: string, context: AskContext, output: PlanOutput): Promise<FieldKey[]> {
    const wanted = output.coverLetter;
    if (wanted === undefined || wanted.keys.length === 0 || deps.letters === undefined) return [];
    const memo = deps.runs.memo(run.runId);
    memo.letter ??= createRunLetter(deps.letters, () => void deps.runs.noteLetterWritten(run.runId).catch(() => undefined));
    if (memo.letter.input() === undefined) {
      const resume = await deps.chooseResume(run.runId, url);
      const job = memo.lookup?.job ?? null;
      memo.letter.ask({
        jobId: job?.id ?? null,
        company: job?.companyName ?? context.posting?.company ?? '',
        jobTitle: job?.title ?? context.posting?.title ?? '',
        jobText: context.postingText ?? '',
        resumeId: resume?.id ?? null,
        generate: wanted.generate && !run.dryRun && !aiOffFor(run, context),
        canaries: context.canaries,
        written: run.letterWritten === true,
      });
    }
    memo.letter.wait(wanted.keys, context, wanted.text === true && !run.dryRun);
    return wanted.keys;
  }

  /**
   * A plan's awaiting keys handed to the run's questions, and those whose answers are in at once (an item never sent)
   * planned again, at most MAX_REPLANS times: the keys planned again take their new rows and writes. Its cover-letter
   * uploads wait for the run's letter (awaitLetter).
   */
  async function withAnswers(run: RunRecord, url: string, asked: AskContext, output: PlanOutput, read: number):
    Promise<{ gathered: Gathered } | { refusal: Answer<never> }> {
    const ai = aiOf(run);
    const settings = await deps.settings.get();
    // A profile-only request, or any plan of a run marked profile-only since it was asked, asks nothing.
    const llm = aiOffFor(run, asked)
      ? { ...settings.llm, tiebreak: false, classify: false, drafts: false, answers: false } : settings.llm;
    let context = asked;
    const rows = new Map(output.results.map((row) => [row.key, row] as const));
    const writes = new Map(output.writes.map((write) => [write.key, write] as const));
    const savable = new Set<FieldKey>(output.savable ?? []);
    const aiEditable = new Set<FieldKey>(output.aiEditable ?? []);
    let aiAttestation = output.aiAttestation === true;
    let awaiting = [...output.awaiting, ...(await awaitLetter(run, url, asked, output))];
    let asking: readonly FieldKey[] = output.awaiting;
    let ask: PlanAsk | undefined = output.ask;
    let revision = read;
    for (let round = 0; ; round += 1) {
      if (asking.length > 0 && ask !== undefined && (((ask.drafts?.length ?? 0) > 0 && llm.drafts)
        || ((ask.answers?.length ?? 0) > 0 && llm.answers))) {
        context = await withDraftContext(run, url, context);
      }
      if (asking.length > 0 && ask !== undefined) ai.ask(ask, asking, context, llm, revision);
      const ready = awaiting.filter((key) => ai.state(key) === 'done');
      if (ready.length === 0 || round === MAX_REPLANS) break;
      ai.settle(ready);
      const again = await planOnce(run, url, context, ready);
      if ('refusal' in again) return again;
      for (const key of ready) {
        writes.delete(key);
        savable.delete(key);
        aiEditable.delete(key);
      }
      for (const key of again.output.savable ?? []) savable.add(key);
      for (const key of again.output.aiEditable ?? []) aiEditable.add(key);
      if (again.output.aiAttestation === true) aiAttestation = true;
      for (const row of again.output.results) rows.set(row.key, row);
      for (const write of again.output.writes) writes.set(write.key, write);
      const done = new Set<string>(ready);
      awaiting = [...awaiting.filter((key) => !done.has(key)), ...again.output.awaiting,
        ...(await awaitLetter(run, url, context, again.output))];
      asking = again.output.awaiting;
      ask = again.output.ask;
      revision = again.revision;
    }
    // Writes in DOM order, as planFrame gives them.
    const order = new Map(context.specs.map((spec) => [spec.key, spec.domOrder] as const));
    return { gathered: {
      writes: [...writes.values()].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
      results: [...rows.values()],
      awaiting,
      savable: [...rows.keys()].filter((key) => savable.has(key)),
      aiEditable: [...rows.keys()].filter((key) => aiEditable.has(key)),
      ...(aiAttestation ? { aiAttestation: true as const } : {}),
    } };
  }

  /** The answer, checked against PlanAnswerSchema before it leaves. */
  function answerOf(run: RunRecord, gathered: Gathered, persistableCanaries: string[], fields: number):
    Answer<PlanAnswer> {
    const answer = PlanAnswerSchema.safeParse({
      // A dry run plans rows only: nothing that could be written ever reaches the frame.
      writes: run.dryRun ? [] : gathered.writes,
      results: gathered.results,
      awaiting: gathered.awaiting,
      ...(gathered.savable.length > 0 ? { savable: gathered.savable } : {}),
      // A dry run's page offers no Edit with AI.
      ...(gathered.aiEditable.length > 0 && !run.dryRun ? { aiEditable: gathered.aiEditable } : {}),
      ...(gathered.aiAttestation === true ? { aiAttestation: true as const } : {}),
      persistableCanaries,
      ...(gathered.repeatables === undefined ? {} : { repeatables: gathered.repeatables }),
    });
    if (!answer.success) {
      log('plan.failed', { fields, shape: true });
      return refuse('internal');
    }
    log('plan.answered', { fields, writes: answer.data.writes.length, dryRun: run.dryRun,
      awaiting: answer.data.awaiting.length });
    return ok(answer.data);
  }

  return {
    async request(message: PlanRequest, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      if (message.noAi === true) {
        const memo = deps.runs.memo(run.runId);
        if (!profileOnly.has(memo)) log('plan.profile-only');
        profileOnly.add(memo);
      }
      // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      const asked: AskContext = { specs: message.specs as unknown as FieldSpec[], canaries: message.canaries,
        ...(message.repeatables === undefined ? {} : { repeatables: message.repeatables }),
        ...(message.postingText === undefined ? {} : { postingText: message.postingText }),
        ...(message.revealEdges === undefined ? {} : {
          revealEdges: message.revealEdges as unknown as Array<[BaseKey, BaseKey]> }),
        ...(message.noAi === true ? { noAi: true } : {}),
        ...(message.posting === undefined ? {} : { posting: message.posting }) };
      const planKeys = message.planKeys as unknown as FieldKey[];
      const planned = await planOnce(run, from.url, asked, planKeys);
      if ('refusal' in planned) return planned.refusal;
      const context = withEntries(asked, planned.output);
      const answered = await withAnswers(run, from.url, context, planned.output, planned.revision);
      if ('refusal' in answered) return answered.refusal;
      const { repeatables } = planned.output;
      return answerOf(run, { ...answered.gathered, ...(repeatables === undefined ? {} : { repeatables }) },
        planned.output.persistableCanaries, planKeys.length);
    },

    /**
     * The waiting keys whose answers are in, planned again with what they were asked from; those still waited for stay
     * awaiting; those the run does not know are left out. `expired` when it knows none of them, or not the run.
     */
    async poll(message: PlanPoll, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      const { ai, letter } = deps.runs.memo(run.runId);
      const keys = message.keys as unknown as FieldKey[];
      // A key waits for the LLM, or (Phase G) for the run's cover letter.
      const ofLetter = (key: FieldKey) => letter !== undefined && letter.state(key) !== 'unknown';
      const stateOf = (key: FieldKey) => (ofLetter(key) ? letter!.state(key) : ai?.state(key) ?? 'unknown');
      const contextOf = (key: FieldKey) => (ofLetter(key) ? letter!.contextOf(key) : ai?.contextOf(key));
      const known = keys.filter((key) => stateOf(key) !== 'unknown');
      if (known.length === 0) return refuse('expired');
      const gathered: Gathered = { writes: [], results: [], savable: [], aiEditable: [],
        awaiting: known.filter((key) => stateOf(key) === 'waiting') };
      // One plan per context the ready keys were asked from.
      const byContext = new Map<AskContext, FieldKey[]>();
      for (const key of known) {
        const context = contextOf(key);
        if (stateOf(key) !== 'done' || context === undefined) continue;
        byContext.set(context, [...(byContext.get(context) ?? []), key]);
      }
      for (const [context, ready] of byContext) {
        ai?.settle(ready.filter((key) => !ofLetter(key)));
        letter?.settle(ready.filter(ofLetter));
        const planned = await planOnce(run, from.url, context, ready);
        if ('refusal' in planned) return planned.refusal;
        const answered = await withAnswers(run, from.url, context, planned.output, planned.revision);
        if ('refusal' in answered) return answered.refusal;
        gathered.writes.push(...answered.gathered.writes);
        gathered.results.push(...answered.gathered.results);
        gathered.awaiting.push(...answered.gathered.awaiting);
        gathered.savable.push(...answered.gathered.savable);
        gathered.aiEditable.push(...answered.gathered.aiEditable);
        if (answered.gathered.aiAttestation === true) gathered.aiAttestation = true;
      }
      return answerOf(run, gathered, [], keys.length);
    },

    /**
     * Edit with AI (draft/rewrite, module header): the one field planned as a rewrite over the scan the frame sent,
     * the run's earlier draft or answer of it forgotten first. Answered as plan/request is: the field awaiting its
     * draft, which plan/poll then brings. `expired` for a run the worker does not know; refused in a dry run.
     */
    async rewrite(message: DraftRewrite, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      if (run.dryRun) return refuse('bad_message');
      // Edit with AI writes text with the AI: only while AI-written answers are on, and never once the run fills from
      // the profile only (the Phase E review, MINOR 8 and security MINOR 4).
      if (profileOnly.has(deps.runs.memo(run.runId)) || !(await deps.settings.get()).llm.drafts) {
        log('plan.rewrite-refused');
        return refuse('bad_message');
      }
      const key = message.fieldKey as unknown as FieldKey;
      const instruction = message.instruction?.trim() ?? '';
      const asked: AskContext = { specs: message.specs as unknown as FieldSpec[], canaries: message.canaries,
        ...(message.postingText === undefined ? {} : { postingText: message.postingText }),
        ...(message.revealEdges === undefined ? {} : {
          revealEdges: message.revealEdges as unknown as Array<[BaseKey, BaseKey]> }),
        rewrite: key, ...(instruction === '' ? {} : { instruction }) };
      aiOf(run).forget([key]);
      const planned = await planOnce(run, from.url, asked, [key]);
      if ('refusal' in planned) return planned.refusal;
      const answered = await withAnswers(run, from.url, asked, planned.output, planned.revision);
      if ('refusal' in answered) return answered.refusal;
      return answerOf(run, answered.gathered, planned.output.persistableCanaries, 1);
    },
  };
}

/** The planner, as index.ts wires it. */
export type Planner = ReturnType<typeof createPlanner>;
