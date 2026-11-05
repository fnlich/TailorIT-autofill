/*
 * The worker's half of Phase 6, wave 2, end to end in Node: saved answers and the company reach every plan; drafts go
 * to TailorIT with the posting's visible text, the lookup's company and title, the canaries and the resume, and come
 * back as llm-draft writes; Save my answer reads the field from its frame and PUTs it at once, never storing it, with
 * TailorIT's refusals as outcomes; Confirm draft reaches only a draft that waits; and the accepted-match cache takes a
 * match only once the application reached done with the field unchanged. The core is scripted here (draftingCore); the
 * real planner's half is src/core/plan/drafts.test.ts and accepted.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import golden from '../contract/tailorit/v1/fixtures/AutofillSavedAnswerList/valid/golden.json';
import type { DraftItem } from '../core/plan/drafts';
import type { PlanOutput } from '../core/plan/types';
import type { UntrustedText } from '../core/types/text';
import type { CoreFunctions } from './core';
import type { FieldKey, FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { MATCH_CACHE_KEY } from './match-cache';
import {
  beginRun, contentSender, DRAFT_TEXT, fieldSpec, frameReport, goldens, LEVER_KEY, pageSender, questionsOf, runState,
  sentToFrames, skippedRow, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const DRAFT = 'POST /api/autofill/ai/draft';
const PUT = 'PUT /api/autofill/answers';
const NORTHWIND = 'https://jobs.lever.co/northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply';
const PANEL = pageSender();

/** A free-text question. */
const WHY = fieldSpec(1, { kind: 'textarea', label: 'Why do you want to work here?',
  key: 'lever|main|why|none|0' as FieldKey });

/**
 * planFrame scripted for drafts: a textarea with no draft yet waits for one; one with a text gets its llm-draft write;
 * one with a discard keeps a flagged row with its reason. Every other field is skipped. Each plan also names one cache
 * candidate per field, and a write of a select.
 */
function draftingCore(): Pick<CoreFunctions, 'planFrame'> {
  return {
    planFrame(input) {
      const wanted = input.planKeys === undefined ? null : new Set<string>(input.planKeys);
      const specs = input.specs.filter((spec) => wanted === null || wanted.has(spec.key));
      const output: PlanOutput = { writes: [], results: [], awaiting: [], needsSensitive: false, persistableCanaries: [] };
      const drafts: DraftItem[] = [];
      for (const spec of specs) {
        const row = skippedRow(spec);
        if (spec.kind !== 'textarea') {
          output.results.push(row);
          continue;
        }
        const verdict = input.ai?.drafts?.get(spec.key);
        if (verdict === undefined) {
          drafts.push({ key: spec.key, question: spec.label as UntrustedText, maxLength: spec.constraints.maxLength ?? null });
          output.awaiting.push(spec.key);
          output.results.push({ ...row, status: 'flagged', reason: 'free-text-requires-user', needsUserAction: true });
        } else if (verdict.text === null) {
          output.results.push({ ...row, status: 'flagged', reason: verdict.why, needsUserAction: true });
        } else {
          output.writes.push({ key: spec.key, value: { kind: 'text', text: verdict.text },
            origin: { provenance: 'llm-draft', taskId: verdict.taskId, confirmedByUser: false },
            match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [],
              reason: 'ok' } });
          output.results.push({ ...row, status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation',
            needsUserAction: true });
        }
      }
      if (drafts.length > 0) output.ask = { tiebreaks: [], classify: [], drafts };
      return output;
    },
  };
}

async function draftsOn(worker: TestWorker): Promise<void> {
  await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, drafts: true } } }, PANEL);
}

async function request(worker: TestWorker, runId: string, specs: FieldSpec[], extra: Record<string, unknown> = {},
  sender = contentSender()) {
  return (await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
    canaries: ['I am LLM'], notices: [], ...extra }, sender)) as { ok: boolean; data?: Record<string, unknown> };
}

describe('saved answers and the company in every plan', () => {
  it('hands planFrame the answers read with the profile, and the company the frame’s address names', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/answers', { json: golden });
    const sender = contentSender({ url: NORTHWIND });
    const runId = await beginRun(worker, {}, sender);
    await request(worker, runId, [fieldSpec(1)], {}, sender);
    const input = worker.core.calls.planFrame.at(-1)!;
    expect(input.savedAnswers.map((answer) => answer.id)).toEqual(golden.items.map((item) => item.id));
    expect(input.company).toEqual({ platform: 'lever', board: 'northwind' });
    expect(input.cache).toBeDefined();
  });
});

describe('drafts', () => {
  it('asks TailorIT with the visible posting text, the lookup’s company and title, the canaries and the resume', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: draftingCore() });
    await draftsOn(worker);
    const runId = await beginRun(worker);
    const first = await request(worker, runId, [WHY], { postingText: 'We build tools for hiring teams. VISIBLE-MARKER-01' });
    expect(first).toMatchObject({ ok: true, data: { awaiting: [WHY.key], writes: [] } });
    await vi.waitFor(() => expect(worker.tailorit.count(DRAFT)).toBe(1));
    const sent = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === DRAFT)!;
    expect(JSON.parse(sent.body!)).toEqual({ questions: [{ key: WHY.key, question: WHY.label, maxLength: null }],
      jobText: 'We build tools for hiring teams. VISIBLE-MARKER-01', company: goldens.lookup.job.companyName,
      jobTitle: goldens.lookup.job.title, resumeId: goldens.lookup.suggestedResume.id, canaries: ['I am LLM'] });
    const polled = (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [WHY.key] }, contentSender())) as {
      data: { writes: unknown[]; results: unknown[] } };
    expect(polled.data.writes).toEqual([expect.objectContaining({ key: WHY.key, value: { kind: 'text', text: DRAFT_TEXT },
      origin: expect.objectContaining({ provenance: 'llm-draft', confirmedByUser: false }) })]);
  });

  it('sends no posting text from a frame that sent none (a form embedded in another page)', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: draftingCore() });
    await draftsOn(worker);
    const runId = await beginRun(worker);
    await request(worker, runId, [WHY]);
    await vi.waitFor(() => expect(worker.tailorit.count(DRAFT)).toBe(1));
    const sent = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === DRAFT)!;
    expect(JSON.parse(sent.body!)).toMatchObject({ jobText: '', company: goldens.lookup.job.companyName });
  });

  it('asks nothing with drafts off: the field is drafts-disabled at once', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: draftingCore() });
    // Drafts are on by default since settings version 2 (docs/SPEC-AMENDMENTS.md): turned off here.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false } } }, PANEL);
    const runId = await beginRun(worker);
    const answer = await request(worker, runId, [WHY], { postingText: 'A posting.' });
    expect(answer).toMatchObject({ ok: true, data: { awaiting: [], results: [expect.objectContaining({ key: WHY.key,
      reason: 'drafts-disabled' })] } });
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });

  it("flags a draft TailorIT discarded with the core's reason, and writes nothing", async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: draftingCore() });
    await draftsOn(worker);
    worker.tailorit.reply(DRAFT, (call) => ({ json: { id: '3f6a2d1e-8b4c-4e7a-9d05-1c2b3a4f5e60', kind: 'autofill_draft',
      status: 'succeeded', result: { drafts: questionsOf(call).map((question) => ({ key: question.key, text: null,
        reason: 'contact' })) }, error: null, createdAt: '2026-10-30T12:00:00.000Z', startedAt: '2026-10-30T12:00:00.100Z',
      finishedAt: '2026-10-30T12:00:04.000Z' } }));
    const runId = await beginRun(worker);
    await request(worker, runId, [WHY]);
    await vi.waitFor(() => expect(worker.tailorit.count(DRAFT)).toBe(1));
    const polled = (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [WHY.key] }, contentSender())) as {
      data: { writes: unknown[]; results: Array<Record<string, unknown>> } };
    expect(polled.data.writes).toEqual([]);
    expect(polled.data.results).toEqual([expect.objectContaining({ key: WHY.key, reason: 'draft-contact', status: 'flagged' })]);
  });
});

// ── Save my answer and Confirm draft ──────────────────────────────────────────────────────────────────────────────

/** A frame with a report holding `row`, and the frame's answers to the worker's messages. */
async function reported(worker: TestWorker, row: Record<string, unknown>, sender = contentSender()) {
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, sender);
  const runId = await beginRun(worker, {}, sender);
  // A plan, so the run knows its company.
  await request(worker, runId, [fieldSpec(1)], {}, sender);
  const base = skippedRow(fieldSpec(1));
  const report = frameReport(runId, 0, { fields: [{ ...base, ...row } as never] });
  expect(await worker.deliver({ v: 1, type: 'report/put', runId, report }, sender)).toEqual({ ok: true, data: {} });
  return runId;
}

const FIXED = { key: 'lever|main|office|none|0', label: 'Which of our offices would you visit first?', kind: 'text',
  category: 'unknown', status: 'flagged', reason: 'unknown-field', needsUserAction: true, detail: { userEdited: true } };

describe('Save my answer', () => {
  it('reads the answer from the frame and PUTs it at once, keyed by the normalized label, never stored', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, FIXED);
    worker.fakes.frameAnswers = ({ message }) => ((message as { type: string }).type === 'answer/read'
      ? { ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'The Lisbon office' } } } : { ok: true, data: {} });
    const answer = await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL);
    expect(answer).toEqual({ ok: true, data: { outcome: 'saved' } });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'answer/read'))
      .toEqual([expect.objectContaining({ tabId: 7, message: { v: 1, type: 'answer/read', fieldKey: FIXED.key } })]);
    const put = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === PUT)!;
    expect(JSON.parse(put.body!)).toEqual({ questionKey: 'which of our offices would you visit first', optionSetHash: '',
      scope: '', fieldKind: 'text', questionLabel: FIXED.label, platform: 'lever',
      answer: { kind: 'text', text: 'The Lisbon office' }, category: null });
    // Never kept: not in either storage area.
    const stored = JSON.stringify({ ...(await fakeBrowser.storage.local.get(null)), ...(await fakeBrowser.storage.session.get(null)) });
    expect(stored).not.toContain('Lisbon');
  });

  it("scopes a free-text answer to the frame's company, and refuses one whose address names none", async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const free = { ...FIXED, key: 'lever|main|why|none|0', label: 'Why do you want to work here?', kind: 'textarea',
      category: 'freeText.whyCompany', reason: 'free-text-requires-user' };
    await reported(worker, free, contentSender({ url: NORTHWIND }));
    worker.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Mine.' } } });
    expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: free.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'saved' } });
    const put = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === PUT)!;
    expect(JSON.parse(put.body!)).toMatchObject({ scope: 'lever:northwind', category: 'free_text_question' });

    const fixture = await startTestWorker({ token: tokenRecord() });
    await reported(fixture, free, contentSender({ url: 'https://jobs.lever.co/tailorit-fixture/trap-01/apply' }));
    expect(await fixture.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: free.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'company-unknown' } });
    expect(fixture.tailorit.count(PUT)).toBe(0);
  });

  it("answers TailorIT's refusals as outcomes: 400 sensitive, 409 limit, 403 not-allowed", async () => {
    for (const [status, code, outcome] of [[400, 'validation_failed', 'sensitive'], [409, 'conflict', 'limit'],
      [403, 'forbidden', 'not-allowed']] as const) {
      const worker = await startTestWorker({ token: tokenRecord() });
      await reported(worker, FIXED);
      worker.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Mine.' } } });
      worker.tailorit.reply(PUT, { status, json: { error: { code, message: 'No.' } } });
      expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL),
        String(status)).toEqual({ ok: true, data: { outcome } });
    }
  });

  it('never reads a sensitive question, nor one the report does not offer, nor with the setting off', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const gender = { ...FIXED, key: 'lever|main|gender-words|none|0', label: 'Describe your gender identity' };
    await reported(worker, gender);
    expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: gender.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'sensitive' } });
    for (const row of [{ ...FIXED, detail: undefined }, { ...FIXED, status: 'verified' }, { ...FIXED, kind: 'file' },
      { ...FIXED, category: 'eeo.gender' }]) {
      const other = await startTestWorker({ token: tokenRecord() });
      await reported(other, row);
      expect(await other.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL))
        .toEqual({ ok: false, error: 'expired' });
      expect(sentToFrames(other).filter((sent) => typeOfSent(sent) === 'answer/read')).toEqual([]);
    }
    const off = await startTestWorker({ token: tokenRecord() });
    await off.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, offerToSaveAnswers: false } }, PANEL);
    await reported(off, FIXED);
    expect(await off.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL))
      .toEqual({ ok: false, error: 'expired' });
    // The worker with the setting off read nothing (the Phase 6 review, E10: this asserted on another worker).
    expect(sentToFrames(off).filter((sent) => typeOfSent(sent) === 'answer/read')).toEqual([]);
    expect(off.tailorit.count(PUT)).toBe(0);
  });

  it("passes the frame's own refusal on (a canary in the answer), and PUTs nothing", async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, FIXED);
    worker.fakes.frameAnswers = () => ({ ok: true, data: { refused: 'canary' } });
    expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'canary' } });
    expect(worker.tailorit.count(PUT)).toBe(0);
  });

  it('answer/save is the in-page panel’s: the sending frame’s own field, read back from that frame', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, FIXED);
    worker.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Mine.' } } });
    expect(await worker.deliver({ v: 1, type: 'answer/save', fieldKey: FIXED.key }, contentSender()))
      .toEqual({ ok: true, data: { outcome: 'saved' } });
    expect(await worker.deliver({ v: 1, type: 'answer/save', fieldKey: FIXED.key }, pageSender()))
      .toEqual({ ok: false, error: 'bad_sender' });
  });
});

describe('Confirm draft', () => {
  const DRAFTED = { key: WHY.key, label: WHY.label, kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged',
    provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', wrote: true, verification: 'verified',
    needsUserAction: true };

  it('sends draft/confirm to that frame while its report shows the draft waiting, and passes its answer on', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, DRAFTED);
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'panel/confirmDraft', tabId: 7, frameId: 0, fieldKey: WHY.key }, PANEL))
      .toEqual({ ok: true, data: {} });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'draft/confirm'))
      .toEqual([expect.objectContaining({ message: { v: 1, type: 'draft/confirm', fieldKey: WHY.key } })]);
    worker.fakes.frameAnswers = () => ({ ok: false, error: 'expired' });
    expect(await worker.deliver({ v: 1, type: 'panel/confirmDraft', tabId: 7, frameId: 0, fieldKey: WHY.key }, PANEL))
      .toEqual({ ok: false, error: 'expired' });
  });

  it('answers expired, sending nothing, for a row that is no waiting draft', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, { ...DRAFTED, needsUserAction: false, status: 'verified' });
    expect(await worker.deliver({ v: 1, type: 'panel/confirmDraft', tabId: 7, frameId: 0, fieldKey: WHY.key }, PANEL))
      .toEqual({ ok: false, error: 'expired' });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'draft/confirm')).toEqual([]);
  });
});

describe('the accepted-match cache', () => {
  it("stores a planned match only once the application's RunState reached done with the field still ours", async () => {
    const key = 'lever|main|source|9d4c2b7e1f0a3c58|0' as FieldKey;
    const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: (input) => ({ writes: [],
      results: input.specs.map(skippedRow), awaiting: [], needsSensitive: false, persistableCanaries: [],
      cacheCandidates: [{ fieldKey: key, cacheKey: 'm2|lever|source|9d4c2b7e1f0a3c58|ref:linkedin',
        entry: { label: 'linkedin', stage: 'exact', confidence: 1 } }] }) } });
    const runId = await reported(worker, { key, status: 'verified', provenance: 'profile', wrote: true,
      verification: 'verified', kind: 'select', category: 'referral.source' });
    void runId;
    expect((await fakeBrowser.storage.session.get(MATCH_CACHE_KEY))[MATCH_CACHE_KEY]).toBeUndefined();
    // The confirmation page marks the application done.
    expect(await worker.deliver({ v: 1, type: 'runstate/put', runState: runState({ applicationKey: LEVER_KEY,
      status: 'done' }) }, contentSender())).toMatchObject({ ok: true });
    // Sealed (match-cache.ts): no value or label readable, the key's page parts as they were.
    expect((await fakeBrowser.storage.session.get(MATCH_CACHE_KEY))[MATCH_CACHE_KEY]).toEqual({
      secret: expect.stringMatching(/^[0-9a-f]{64}$/), entries: [[expect.stringMatching(/^[0-9a-f]{32}$/),
        { label: expect.stringMatching(/^[0-9a-f]{32}$/), stage: 'exact', confidence: 1, acceptedBy: 'run-complete',
          at: worker.clock.now }]] });
    expect(JSON.stringify(await fakeBrowser.storage.session.get(MATCH_CACHE_KEY))).not.toContain('linkedin');
  });
});
