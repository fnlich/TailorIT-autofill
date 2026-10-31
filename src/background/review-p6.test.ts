/*
 * The Phase 6 review's findings on the worker side, end to end in Node: Save my answer for free text after a worker
 * restart (E5), a row counted once per run (E8), the lookup's stored posting text never in a draft (E11), Save my
 * answer screening the question's section and the answer's own words (T6-1), and the planner's pass-through of the
 * reveal edges and the savable keys (E2, T6-1). The core is scripted where it decides nothing here.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { DraftItem } from '../core/plan/drafts';
import type { PlanOutput } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { UntrustedText } from '../core/types/text';
import { bundledVocab } from '../core/vocab/bundled.testkit';
import type { FrameReport } from '../shared/report';
import type { CoreFunctions } from './core';
import { TELEMETRY_COUNTED_KEY } from './telemetry';
import {
  beginRun, contentSender, fieldSpec, frameReport, goldens, pageSender, restartTestWorker, sentToFrames, skippedRow,
  startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const NORTHWIND = 'https://jobs.lever.co/northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply';
const PUT = 'PUT /api/autofill/answers';
const DRAFT = 'POST /api/autofill/ai/draft';
const PANEL = pageSender();

/** A frame with a report holding `row`, after one plan (so the run knows its company). */
async function reported(worker: TestWorker, row: Record<string, unknown>, sender = contentSender()): Promise<string> {
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, sender);
  const runId = await beginRun(worker, {}, sender);
  await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], planKeys: [fieldSpec(1).key],
    canaries: [], notices: [] }, sender);
  const report = frameReport(runId, 0, { fields: [{ ...skippedRow(fieldSpec(1)), ...row } as never] });
  expect(await worker.deliver({ v: 1, type: 'report/put', runId, report }, sender)).toEqual({ ok: true, data: {} });
  return runId;
}

const FIXED = { key: 'lever|main|office|none|0', label: 'Which of our offices would you visit first?', kind: 'text',
  category: 'unknown', status: 'flagged', reason: 'unknown-field', needsUserAction: true, detail: { userEdited: true } };

describe('E5: Save my answer for free text after a worker restart', () => {
  const free = { ...FIXED, key: 'lever|main|why|none|0', label: 'Why do you want to work here?', kind: 'textarea',
    category: 'freeText.whyCompany', reason: 'free-text-requires-user' };

  it('scopes it to the company the frame’s own address names, which its answer carries', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, free, contentSender({ url: NORTHWIND }));
    // The person takes a while: the idle worker is stopped, and the panel's click starts it again.
    const again = await restartTestWorker(worker);
    again.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Mine.' },
      company: 'lever:northwind' } });
    expect(await again.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: free.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'saved' } });
    const put = again.tailorit.requests.find((call) => `${call.method} ${call.path}` === PUT)!;
    expect(JSON.parse(put.body!)).toMatchObject({ scope: 'lever:northwind', category: 'free_text_question' });
    // Nothing of the address is kept for it.
    const kept = JSON.stringify({ ...(await fakeBrowser.storage.local.get(null)),
      ...(await fakeBrowser.storage.session.get(null)) });
    expect(kept).not.toContain('northwind');
  });

  it('refuses it as company-unknown when the frame’s address names none either', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, free, contentSender({ url: NORTHWIND }));
    const again = await restartTestWorker(worker);
    again.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Mine.' },
      company: null } });
    expect(await again.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: free.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'company-unknown' } });
    expect(again.tailorit.count(PUT)).toBe(0);
  });
});

describe('E8: a row is counted once per run', () => {
  type Row = FrameReport['fields'][number];
  const written = (key: string): Row => ({ key, label: `Label ${key}`, kind: 'text', category: 'contact.email',
    section: 'contact', required: true, status: 'verified', provenance: 'profile', matcherStage: 'not-applicable',
    confidence: 1, reason: 'ok', wrote: true, verification: 'verified', needsUserAction: false });
  const total = async (worker: TestWorker) => ((await worker.deliver({ v: 1, type: 'telemetry/get' },
    pageSender('options.html'))) as { data: { counts: Array<{ count: number }> } }).data.counts
    .reduce((sum, count) => sum + count.count, 0);

  it('counts a step the person comes Back to once, and once more after a worker restart', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, telemetry: { optIn: true } } },
      pageSender('options.html'));
    const runId = await beginRun(worker);
    const put = (target: TestWorker, fields: Row[], index: number) => target.deliver({ v: 1, type: 'report/put', runId,
      report: frameReport(runId, 0, { fields, step: { index } }) }, contentSender());
    await put(worker, [written('workday|a|email|none|0')], 0);
    await put(worker, [written('workday|b|phone|none|0')], 1);
    await put(worker, [written('workday|a|email|none|0')], 0);
    expect(await total(worker)).toBe(2);
    const again = await restartTestWorker(worker);
    await put(again, [written('workday|b|phone|none|0')], 1);
    expect(await total(again)).toBe(2);
    // Keys only.
    expect(JSON.stringify((await fakeBrowser.storage.session.get(TELEMETRY_COUNTED_KEY))[TELEMETRY_COUNTED_KEY]))
      .not.toContain('Label');
  });
});

/** planFrame scripted for drafts: a textarea with no draft waits for one; every other field is skipped. */
function draftingCore(): Pick<CoreFunctions, 'planFrame'> {
  return {
    planFrame(input) {
      const wanted = input.planKeys === undefined ? null : new Set<string>(input.planKeys);
      const specs = input.specs.filter((spec) => wanted === null || wanted.has(spec.key));
      const output: PlanOutput = { writes: [], results: [], awaiting: [], needsSensitive: false, persistableCanaries: [] };
      const drafts: DraftItem[] = [];
      for (const spec of specs) {
        if (spec.kind === 'textarea' && input.ai?.drafts?.get(spec.key) === undefined) {
          drafts.push({ key: spec.key, question: spec.label as UntrustedText, maxLength: null });
          output.awaiting.push(spec.key);
        }
        output.results.push(skippedRow(spec));
      }
      if (drafts.length > 0) output.ask = { tiebreaks: [], classify: [], drafts };
      return output;
    },
  };
}

const WHY = fieldSpec(1, { kind: 'textarea', label: 'Why do you want to work here?', key: 'lever|main|why|none|0' as FieldKey });

describe('E11: a draft’s job text is the frame’s posting text only', () => {
  it('never takes the lookup’s stored posting text, with the frame’s or without', async () => {
    for (const postingText of [undefined, 'We build tools. VISIBLE-MARKER-E11']) {
      const worker = await startTestWorker({ token: tokenRecord(), core: draftingCore() });
      worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: { ...goldens.lookup.job,
        postingText: 'STORED-POSTING-TEXT from TailorIT' } } });
      await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
        llm: { ...DEFAULT_SETTINGS.llm, drafts: true } } }, PANEL);
      const runId = await beginRun(worker);
      await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [WHY], planKeys: [WHY.key], canaries: [],
        notices: [], ...(postingText === undefined ? {} : { postingText }) }, contentSender());
      await vi.waitFor(() => expect(worker.tailorit.count(DRAFT)).toBe(1));
      const sent = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === DRAFT)!;
      expect(sent.body, String(postingText)).not.toContain('STORED-POSTING-TEXT');
      expect(JSON.parse(sent.body!).jobText, String(postingText)).toBe(postingText ?? '');
    }
  });
});

describe('T6-1: Save my answer never keeps an EEO, legal or sensitive answer', () => {
  /** The real vocabulary: the answer's words are screened with it. */
  const vocab = bundledVocab();

  it('refuses a question under a sensitive section, and an answer that is an EEO answer or a decline', async () => {
    const cases: Array<[Record<string, unknown>, unknown]> = [
      [{ ...FIXED, section: 'voluntary-self-identification' }, { kind: 'text', text: 'Mine.' }],
      [{ ...FIXED, section: 'disability[0]' }, { kind: 'text', text: 'Mine.' }],
      [{ ...FIXED, key: 'lever|main|identify|1a2b3c4d5e6f7a8b|0', label: 'How do you identify?', kind: 'radio' },
        { kind: 'options', labels: ['Woman'] }],
      [{ ...FIXED, key: 'lever|main|describes|1a2b3c4d5e6f7a8b|0', label: 'Which best describes you?', kind: 'select' },
        { kind: 'options', labels: ['Black or African American'] }],
      [{ ...FIXED, key: 'lever|main|applies|1a2b3c4d5e6f7a8b|0', label: 'Which applies to you?', kind: 'select' },
        { kind: 'options', labels: ['I prefer not to say'] }],
    ];
    for (const [row, answer] of cases) {
      const worker = await startTestWorker({ token: tokenRecord(), core: { vocab: () => vocab } });
      await reported(worker, row);
      worker.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: (answer as { kind: string }).kind === 'text'
        ? 'none' : '1a2b3c4d5e6f7a8b', answer } });
      expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: row.key as string },
        PANEL), JSON.stringify(row)).toEqual({ ok: true, data: { outcome: 'sensitive' } });
      expect(worker.tailorit.count(PUT)).toBe(0);
    }
  });

  it('passes the frame’s own refusal of a field no plan named savable', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await reported(worker, FIXED);
    worker.fakes.frameAnswers = () => ({ ok: true, data: { refused: 'sensitive' } });
    expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: FIXED.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'sensitive' } });
    expect(worker.tailorit.count(PUT)).toBe(0);
  });

  it('still saves an ordinary answer to an ordinary question', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: { vocab: () => vocab } });
    const row = { ...FIXED, key: 'lever|main|team|1a2b3c4d5e6f7a8b|0', label: 'Which team would you like to meet?',
      kind: 'select' };
    await reported(worker, row);
    worker.fakes.frameAnswers = () => ({ ok: true, data: { optionSetHash: '1a2b3c4d5e6f7a8b',
      answer: { kind: 'options', labels: ['Data'] } } });
    expect(await worker.deliver({ v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: row.key }, PANEL))
      .toEqual({ ok: true, data: { outcome: 'saved' } });
  });
});

describe('E2 and T6-1: the planner passes the reveal edges in, and the savable keys out', () => {
  it('hands planFrame the request’s reveal edges, and answers the plan’s savable keys', async () => {
    const one = fieldSpec(1);
    const two = fieldSpec(2);
    const worker = await startTestWorker({ token: tokenRecord(), core: { planFrame: (input) => ({ writes: [],
      results: input.specs.map(skippedRow), awaiting: [], needsSensitive: false, persistableCanaries: [],
      savable: [two.key] }) } });
    const runId = await beginRun(worker);
    const answer = await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [one, two],
      planKeys: [one.key, two.key], canaries: [], notices: [], revealEdges: [[one.baseKey, two.baseKey]] },
    contentSender()) as { ok: boolean; data: { savable?: string[] } };
    expect(answer.ok).toBe(true);
    expect(answer.data.savable).toEqual([two.key]);
    expect(worker.core.calls.planFrame.at(-1)!.revealEdges).toEqual([[one.baseKey, two.baseKey]]);
    // Nothing named savable: none in the answer.
    const none = await startTestWorker({ token: tokenRecord(), core: { planFrame: (input) => ({ writes: [],
      results: input.specs.map(skippedRow), awaiting: [], needsSensitive: false, persistableCanaries: [] }) } });
    const other = await beginRun(none);
    const plain = await none.deliver({ v: 1, type: 'plan/request', runId: other, pass: 0, specs: [one], planKeys: [one.key],
      canaries: [], notices: [] }, contentSender()) as { data: Record<string, unknown> };
    expect(plain.data.savable).toBeUndefined();
    expect(sentToFrames(none).filter((sent) => typeOfSent(sent) === 'answer/read')).toEqual([]);
    void ([] as FieldSpec[]);
  });
});
