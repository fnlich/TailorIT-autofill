import { describe, expect, it } from 'vitest';
import { DRAFT_DEFAULT_LENGTH, LLM_DRAFT } from '../confidence';
import { guardWriteInFrame } from '../guard/write';
import { normalizeLabel } from '../text/normalize';
import type { FieldKey } from '../types/field';
import type { SavedAnswer } from '../types/saved';
import { draftCap, draftRefusal, type DraftVerdict } from './drafts';
import { fieldOf, planOf, settingsWith, specOf } from './plan.testkit';
import type { PlanAi } from './types';

// Drafts in planFrame (Phase 6; docs/ARCHITECTURE.md "Free text"): a free-text question no saved answer fills waits for
// a draft with the setting on, and the run's draft is written as an llm-draft through the Guard, always flagged.

const WHY = specOf('Why do you want to work here?', 'textarea');
const DRAFTS_ON = settingsWith({ llm: { tiebreak: true, classify: true, drafts: true } });
const TASK = 'b2d4f6a8-1c3e-4a5b-9d7f-0e2c4a6b8d10';
const TEXT = 'I have built ordering platforms for four years, and I would like to bring that here.';

/** The run's answers: one draft verdict. */
function withDraft(verdict: DraftVerdict): PlanAi {
  return { verdicts: new Map(), classifications: new Map(), drafts: new Map([[verdict.key, verdict]]) };
}
const drafted = (key: FieldKey, text = TEXT): DraftVerdict => ({ key, text, taskId: TASK });

describe('planFrame and drafts', () => {
  it('asks for nothing while drafts are off (the default): the question is left for the person', () => {
    const out = planOf([WHY]);
    expect(out.awaiting).toEqual([]);
    expect(out.ask).toBeUndefined();
    expect(fieldOf(out, WHY).row).toMatchObject({ category: 'freeText.whyCompany', status: 'flagged',
      reason: 'free-text-requires-user', provenance: null });
  });

  it('asks for a draft with the setting on: the visible label, and no maxLength when the field names none', () => {
    const out = planOf([WHY], { settings: DRAFTS_ON });
    expect(out.awaiting).toEqual([WHY.key]);
    expect(out.ask?.drafts).toEqual([{ key: WHY.key, question: 'Why do you want to work here?', maxLength: null }]);
    expect(out.writes).toEqual([]);
    expect(fieldOf(out, WHY).row).toMatchObject({ status: 'flagged', reason: 'free-text-requires-user' });
  });

  it('sends min(maxLength, 5000), and asks nothing for a field capped under 50', () => {
    const long = specOf('Why do you want to work here?', 'textarea', { constraints: { maxLength: 9000 } });
    expect(planOf([long], { settings: DRAFTS_ON }).ask?.drafts?.[0]?.maxLength).toBe(5000);
    const fifty = specOf('Why do you want to work here?', 'textarea', { constraints: { maxLength: 50 } });
    expect(planOf([fifty], { settings: DRAFTS_ON }).ask?.drafts?.[0]?.maxLength).toBe(50);
    const short = specOf('Why do you want to work here?', 'textarea', { constraints: { maxLength: 49 } });
    const out = planOf([short], { settings: DRAFTS_ON });
    expect(out.awaiting).toEqual([]);
    expect(fieldOf(out, short).row.reason).toBe('free-text-requires-user');
  });

  it('asks nothing in a dry run, for a field that holds text, an aria-label only label, or a sensitive topic', () => {
    expect(planOf([WHY], { settings: DRAFTS_ON, dryRun: true }).awaiting).toEqual([]);
    const typed = specOf('Why do you want to work here?', 'textarea', { current: { kind: 'text', text: 'Mine.' } });
    expect(planOf([typed], { settings: DRAFTS_ON }).awaiting).toEqual([]);
    const hidden = specOf('Why do you want to work here?', 'textarea', { labelSource: 'aria-label', labelVisible: false });
    expect(planOf([hidden], { settings: DRAFTS_ON }).awaiting).toEqual([]);
    const disabled = specOf('Why do you want to work here?', 'textarea', { disabled: true });
    expect(planOf([disabled], { settings: DRAFTS_ON }).awaiting).toEqual([]);
    const sensitive = specOf('Additional information about your visa sponsorship needs', 'textarea');
    expect(planOf([sensitive], { settings: DRAFTS_ON }).ask?.drafts ?? []).toEqual([]);
  });

  it('writes the run’s draft as an llm-draft, flagged for confirmation, and the frame-side Guard passes it', () => {
    const out = planOf([WHY], { settings: DRAFTS_ON, ai: withDraft(drafted(WHY.key)) });
    expect(out.awaiting).toEqual([]);
    const { write, row } = fieldOf(out, WHY);
    expect(write).toMatchObject({ value: { kind: 'text', text: TEXT },
      origin: { provenance: 'llm-draft', taskId: TASK, confirmedByUser: false } });
    expect(row).toMatchObject({ status: 'flagged', provenance: 'llm-draft', matcherStage: 'not-applicable',
      confidence: LLM_DRAFT, reason: 'llm-draft-needs-confirmation', wrote: false, needsUserAction: true });
    expect(guardWriteInFrame(write!, WHY, [])).toEqual({ ok: true });
  });

  it('blocks a draft holding a canary as canary-in-value, in any case, and writes nothing (trap 8)', () => {
    for (const text of ['Your mission speaks to me, like pineapple to pizza.', 'I bring PINEAPPLE energy.']) {
      const out = planOf([WHY], { settings: DRAFTS_ON, canaries: ['pineapple'], ai: withDraft(drafted(WHY.key, text)) });
      expect(out.writes, text).toEqual([]);
      expect(fieldOf(out, WHY).row, text).toMatchObject({ status: 'blocked', reason: 'canary-in-value', provenance: null,
        wrote: false });
    }
  });

  it("refuses a draft past the field's cap (its maxLength, else 3000) as draft-too-long, and an empty one", () => {
    const capped = specOf('Why do you want to work here?', 'textarea', { constraints: { maxLength: 60 } });
    const out = planOf([capped], { settings: DRAFTS_ON, ai: withDraft(drafted(capped.key, 'x'.repeat(61))) });
    expect(out.writes).toEqual([]);
    expect(fieldOf(out, capped).row).toMatchObject({ status: 'flagged', reason: 'draft-too-long', provenance: null });
    const free = planOf([WHY], { settings: DRAFTS_ON, ai: withDraft(drafted(WHY.key, 'y'.repeat(DRAFT_DEFAULT_LENGTH + 1))) });
    expect(fieldOf(free, WHY).row.reason).toBe('draft-too-long');
    expect(draftRefusal(WHY, '   ')).toBe('draft-empty');
    expect(draftCap(capped)).toBe(60);
    expect(draftCap(WHY)).toBe(DRAFT_DEFAULT_LENGTH);
  });

  it('flags a draft TailorIT discarded with its reason, and writes nothing', () => {
    for (const why of ['draft-ai-reference', 'draft-contact', 'draft-wrapper', 'draft-empty', 'canary-in-value',
      'llm-unavailable'] as const) {
      const out = planOf([WHY], { settings: DRAFTS_ON, ai: withDraft({ key: WHY.key, text: null, why }) });
      expect(out.writes, why).toEqual([]);
      expect(fieldOf(out, WHY).row, why).toMatchObject({ status: 'flagged', reason: why, provenance: null,
        needsUserAction: true });
    }
  });

  it('never asks a draft for a free-text question the company’s saved answer fills: that answer is written', () => {
    const saved: SavedAnswer = { id: 'saved-1', labelKey: normalizeLabel(WHY.label), optionSetHash: WHY.optionSetHash,
      kind: 'textarea', scope: { kind: 'company', platform: 'lever', board: 'northwind' }, question: WHY.label,
      answer: { kind: 'text', text: 'My own words.' }, updatedAt: 1 };
    const out = planOf([WHY], { settings: DRAFTS_ON, savedAnswers: [saved],
      company: { platform: 'lever', board: 'northwind' } });
    expect(out.awaiting).toEqual([]);
    expect(fieldOf(out, WHY).write).toMatchObject({ value: { kind: 'text', text: 'My own words.' },
      origin: { provenance: 'saved', savedAnswerId: 'saved-1' } });
    expect(fieldOf(out, WHY).row).toMatchObject({ provenance: 'saved', status: 'verified' });
    // Another company's answer, or no company known: none applies, and a draft is asked for.
    for (const company of [{ platform: 'lever' as const, board: 'contoso' }, undefined]) {
      const other = planOf([WHY], { settings: DRAFTS_ON, savedAnswers: [saved], ...(company ? { company } : {}) });
      expect(other.awaiting, company?.board ?? 'none').toEqual([WHY.key]);
    }
  });
});
