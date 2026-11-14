/*
 * v2.0 P9 (autofill API 8, docs/design/v2.0/09-extension-api8.md "The renamed provenance, without touching src/core"):
 * TailorIT renamed the provenance of an answer it prepared for the job from `prebuilt` to `prepared`. The extension's own
 * name stays `prebuilt` (src/core, which the content script reads); only the wire changes, at the background's boundary.
 * - In: forms/known's `drafts` (who prepared each: `server-ai` or `mcp`, never a provenance of the answers' list) become
 *   this job's answers marked `draft` (submitted-forms.ts draftAnswersOf), which the core fills with `prebuilt`.
 * - Out: POST /submissions names such an answer `prepared` (submitted-forms.ts PREPARED_AS), never `prebuilt`, which
 *   API 8 refuses.
 * Undo proof: put back v1.5's guard (`prebuilt` where the contract lists it, else `llm-answer`) and the answer goes out
 * as `llm-answer`: the last two expectations of the first `it` fail.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTOFILL_ANSWER_PROVENANCES, AutofillFormsKnownResponseSchema, AutofillSubmissionRequestSchema,
} from '../contract/tailorit';
import { PROVENANCES } from '../core/enums';
import { fieldOf, planOf, specOf } from '../core/plan/plan.testkit';
import type { CapturedField } from '../messaging/schemas';
import { draftAnswersOf, provenanceOf, submissionBodyOf } from './submitted-forms';
import { fieldSpec } from './worker.testkit';

/** One of the contract's examples (src/contract/tailorit/v1/fixtures). */
const example = (schema: string, kind: 'valid' | 'invalid', name: string): unknown => JSON.parse(readFileSync(
  new URL(`../contract/tailorit/v1/fixtures/${schema}/${kind}/${name}.json`, import.meta.url), 'utf8'));

describe("the prepared answer's provenance on the wire (API 8)", () => {
  it("reads TailorIT's prepared answer in, fills it as `prebuilt` inside, and names it `prepared` out", () => {
    // In: the contract's own example of forms/known with two ready drafts.
    const known = AutofillFormsKnownResponseSchema.parse(example('AutofillFormsKnownResponse', 'valid', 'drafts'));
    const drafts = draftAnswersOf(known);
    const why = drafts.find((answer) => answer.labelKey === 'why do you want to work at northwind');
    expect(why).toMatchObject({ draft: true, sameJob: true, answer: { kind: 'text' } });

    // Inside: the core fills the question with it under the extension's own name.
    const spec = specOf('Why do you want to work at Northwind?', 'textarea');
    const planned = fieldOf(planOf([spec], { submittedAnswers: drafts }), spec);
    expect(planned.write?.origin).toMatchObject({ provenance: 'prebuilt' });
    expect(planned.row).toMatchObject({ provenance: 'prebuilt' });
    // The run's report row once the write landed.
    const row = { ...planned.row, wrote: true };

    // Out: the submission names it `prepared`, which the contract takes.
    expect(provenanceOf(row)).toBe('prepared');
    const captured: CapturedField = { spec: fieldSpec(1, { label: spec.label, kind: 'textarea' }) as
      unknown as CapturedField['spec'], step: 0, answer: { kind: 'text', text: 'Calm deploys.' } };
    const body = submissionBodyOf({ posting: null, fields: [captured] }, { jobId: 1042, url: null, resumeId: null,
      keepAnswers: true, categoryOf: () => null, rowOf: () => row })!;
    expect(body.answers).toEqual([{ ref: captured.spec.key, answer: { kind: 'text', text: 'Calm deploys.' },
      provenance: 'prepared' }]);
    expect(AutofillSubmissionRequestSchema.safeParse(body).success).toBe(true);
  });

  it('keeps the two names apart: `prebuilt` is the extension’s alone, `prepared` the wire’s alone', () => {
    expect(PROVENANCES).toContain('prebuilt');
    expect(PROVENANCES).not.toContain('prepared');
    expect(AUTOFILL_ANSWER_PROVENANCES).toContain('prepared');
    expect(AUTOFILL_ANSWER_PROVENANCES).not.toContain('prebuilt');
    // The contract's examples: a prepared answer goes; the old name is refused.
    expect(AutofillSubmissionRequestSchema.safeParse(example('AutofillSubmissionRequest', 'valid', 'prepared-answer'))
      .success).toBe(true);
    expect(AutofillSubmissionRequestSchema.safeParse(example('AutofillSubmissionRequest', 'invalid',
      'prebuilt-provenance')).success).toBe(false);
  });

  it('never sends the internal name, whatever wrote the answer', () => {
    for (const provenance of PROVENANCES) {
      const named = provenanceOf({ provenance, wrote: true, reason: 'ok', detail: undefined });
      expect(named === null || (AUTOFILL_ANSWER_PROVENANCES as readonly string[]).includes(named), provenance).toBe(true);
    }
  });
});
