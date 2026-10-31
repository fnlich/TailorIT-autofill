/*
 * Drafts' translation (Phase 6; ai-tasks.ts): the core's questions as TailorIT's draft requests, and TailorIT's answers
 * as the core's verdicts.
 */
import { describe, expect, it } from 'vitest';
import { AUTOFILL_DRAFT_REASONS, AutofillDraftRequestSchema } from '../contract/tailorit';
import type { DraftItem } from '../core/plan/drafts';
import type { FieldKey } from '../core/types/field';
import type { UntrustedText } from '../core/types/text';
import { draftBatches, draftVerdicts } from './ai-tasks';

const item = (at: number, question = `Question ${at}?`): DraftItem => ({ key: `lever|main|q${at}|none|0` as FieldKey,
  question: question as UntrustedText, maxLength: at % 2 === 0 ? null : 500 });
const CONTEXT = { jobText: 'We build tools. VISIBLE-MARKER-01', company: 'Northwind', jobTitle: 'Engineer', resumeId: null };

describe('draft requests', () => {
  it('batch at most three questions a task, each request valid as TailorIT reads it', () => {
    const { batches, withheld } = draftBatches([1, 2, 3, 4].map((at) => item(at)), CONTEXT, ['I am LLM', 'x']);
    expect(withheld).toEqual([]);
    expect(batches.map((batch) => batch.body.questions.length)).toEqual([3, 1]);
    for (const batch of batches) {
      expect(AutofillDraftRequestSchema.safeParse(batch.body).success).toBe(true);
      // A one-letter canary is under TailorIT's floor of two: dropped, never the request.
      expect(batch.body).toMatchObject({ jobText: CONTEXT.jobText, company: 'Northwind', jobTitle: 'Engineer',
        resumeId: null, canaries: ['I am LLM'] });
    }
  });

  it('never sends a question naming a sensitive topic, and cuts the job text to TailorIT’s cap', () => {
    const { batches, withheld } = draftBatches([item(1, 'Explain your visa sponsorship needs.'), item(2)],
      { ...CONTEXT, jobText: `${'word '.repeat(6000)}end` }, []);
    expect(withheld).toEqual([{ key: item(1).key, text: null, why: 'llm-disabled-for-category' }]);
    expect(batches).toHaveLength(1);
    expect([...batches[0]!.body.jobText].length).toBeLessThanOrEqual(20_000);
    expect(AutofillDraftRequestSchema.safeParse(batches[0]!.body).success).toBe(true);
  });
});

describe('draft answers', () => {
  const asked = [item(1), item(2)];

  it('give drafted and trimmed texts, and every other reason as why there is none', () => {
    const expected = { empty: 'draft-empty', too_long: 'draft-too-long', canary: 'canary-in-value',
      ai_reference: 'draft-ai-reference', wrapper: 'draft-wrapper', contact: 'draft-contact', invalid: 'llm-invalid-output',
      sensitive: 'llm-disabled-for-category' } as const;
    for (const reason of AUTOFILL_DRAFT_REASONS) {
      const text = reason === 'drafted' || reason === 'trimmed' ? 'My draft.' : null;
      const verdicts = draftVerdicts(asked, { drafts: asked.map((question) => ({ key: question.key, text, reason })) }, 'task-1');
      const verdict = verdicts.get(asked[0]!.key);
      if (text !== null) expect(verdict, reason).toEqual({ key: asked[0]!.key, text: 'My draft.', taskId: 'task-1' });
      else expect(verdict, reason).toEqual({ key: asked[0]!.key, text: null, why: expected[reason as keyof typeof expected] });
    }
  });

  it('treat a question answered twice or not at all, or a text where none belongs, as invalid', () => {
    const verdicts = draftVerdicts(asked, { drafts: [
      { key: asked[0]!.key, text: 'One.', reason: 'drafted' }, { key: asked[0]!.key, text: 'Two.', reason: 'drafted' },
    ] }, 'task-1');
    expect([verdicts.get(asked[0]!.key), verdicts.get(asked[1]!.key)]).toEqual([
      { key: asked[0]!.key, text: null, why: 'llm-invalid-output' }, { key: asked[1]!.key, text: null, why: 'llm-invalid-output' }]);
    const odd = draftVerdicts([asked[0]!], { drafts: [{ key: asked[0]!.key, text: 'A text.', reason: 'contact' }] }, 't');
    expect(odd.get(asked[0]!.key)).toEqual({ key: asked[0]!.key, text: null, why: 'llm-invalid-output' });
  });
});
