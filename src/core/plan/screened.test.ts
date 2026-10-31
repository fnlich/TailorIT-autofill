import { describe, expect, it } from 'vitest';
import { normalizeLabel } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { SavedAnswer } from '../types/saved';
import { fieldOf, planOf, settingsWith, specOf } from './plan.testkit';

// The Phase 6 review: a saved answer, Save my answer and a draft never reach an EEO, legal or sensitive question, even
// when its label names no topic (T6-1), and a draft is never asked for a box in such a context (E2).

const DRAFTS_ON = settingsWith({ llm: { tiebreak: true, classify: true, drafts: true } });

/** A global saved answer to `spec`, by its exact key. */
function savedFor(spec: FieldSpec, answer: SavedAnswer['answer']): SavedAnswer {
  return { id: `saved-${spec.baseKey}`, labelKey: normalizeLabel(spec.label), optionSetHash: spec.optionSetHash,
    kind: spec.kind, scope: { kind: 'global' }, question: spec.label, answer, updatedAt: 1 };
}

describe('T6-1: a screened question never takes a saved answer, and is never savable', () => {
  const cases: Array<[string, FieldSpec, string]> = [
    ['gender, no topic in the label', specOf('How do you identify?', 'radio',
      { optionLabels: ['Man', 'Woman', 'Non-binary', 'I prefer not to say'] }), 'Woman'],
    ['race, no topic in the label', specOf('Which best describes you?', 'radio',
      { optionLabels: ['Asian', 'Black or African American', 'White', 'Two or more races'] }), 'Asian'],
    ['a decline option', specOf('Which applies to you?', 'select', { optionLabels: ['Yes', 'No', 'Prefer not to say'] }),
      'No'],
    ['sponsorship, no topic word', specOf('Will you now or in the future require us to support your employment?',
      'radio', { optionLabels: ['Yes', 'No'] }), 'No'],
    ['under a sensitive section', specOf('Which applies to you?', 'radio',
      { optionLabels: ['Yes', 'No'], section: { id: 'voluntary-self-identification' } }), 'Yes'],
    ['in its description', specOf('Which applies to you?', 'radio',
      { optionLabels: ['Yes', 'No'], description: 'As defined by the Americans with Disabilities Act' }), 'No'],
  ];
  for (const [name, spec, chosen] of cases) {
    it(`applies none, and offers no Save: ${name}`, () => {
      const out = planOf([spec], { savedAnswers: [savedFor(spec, { kind: 'options', labels: [chosen] })] });
      const { write, row } = fieldOf(out, spec);
      expect(write).toBeUndefined();
      expect(row.provenance).not.toBe('saved');
      expect(row.status).toBe('flagged');
      expect(out.savable ?? []).not.toContain(spec.key);
    });
  }

  it('still applies, and offers Save for, a question the screen lets through', () => {
    const office = specOf('Which of our offices would you visit first?', 'text');
    const choice = specOf('Have you worked with us before?', 'radio', { optionLabels: ['Yes', 'No'] });
    const out = planOf([office, choice], { savedAnswers: [savedFor(office, { kind: 'text', text: 'Lisbon' }),
      savedFor(choice, { kind: 'options', labels: ['No'] })] });
    expect(fieldOf(out, office).write).toMatchObject({ value: { kind: 'text', text: 'Lisbon' },
      origin: { provenance: 'saved' } });
    expect(fieldOf(out, choice).write).toMatchObject({ origin: { provenance: 'saved' } });
    // Without a saved answer the person's fix is savable.
    const fresh = planOf([office, choice]);
    expect(fresh.savable).toEqual([office.key, choice.key]);
  });

  it('never names as savable a class whose saved answers are never, a file, or a blocked field', () => {
    const gender = specOf('Gender', 'select', { optionLabels: ['Male', 'Female'] });
    const resume = specOf('Resume', 'file');
    const why = specOf('Why do you want to work here?', 'textarea');
    const out = planOf([gender, resume, why]);
    expect(out.savable).toEqual([why.key]);
  });
});

describe('E2: no draft in an EEO, legal or sensitive context', () => {
  for (const section of ['criminal-history', 'disability', 'work-authorization', 'voluntary-self-identification',
    'visa-sponsorship']) {
    it(`asks none for "Please provide details" under ${section}`, () => {
      const box = specOf('Please provide details', 'textarea', { section: { id: section } });
      const out = planOf([box], { settings: DRAFTS_ON });
      expect(out.ask?.drafts ?? []).toEqual([]);
      expect(out.awaiting).toEqual([]);
      expect(fieldOf(out, box).row).toMatchObject({ status: 'flagged', provenance: null });
    });
  }

  it('asks none for a follow-up box after a legal question in the main part', () => {
    for (const [question, options] of [['Have you ever been convicted of a felony?', ['Yes', 'No']],
      ['Are you legally authorized to work in the United States?', ['Yes', 'No']],
      ['How do you identify?', ['Man', 'Woman', 'Non-binary']]] as const) {
      const asked = specOf(question, 'radio', { optionLabels: options });
      for (const label of ['If yes, please explain', 'Please provide details', 'Details', 'Please specify']) {
        const box = specOf(label, 'textarea');
        const out = planOf([asked, box], { settings: DRAFTS_ON });
        expect(out.ask?.drafts ?? [], `${question} / ${label}`).toEqual([]);
      }
    }
  });

  it('asks none for a box a sensitive question revealed, wherever it sits', () => {
    const asked = specOf('Do you have a disability or chronic condition?', 'radio', { optionLabels: ['Yes', 'No'] });
    const other = specOf('Which office would you visit first?', 'text');
    const box = specOf('Tell us more', 'textarea');
    const out = planOf([asked, other, box], { settings: DRAFTS_ON, revealEdges: [[asked.baseKey, box.baseKey]] });
    expect(out.ask?.drafts ?? []).toEqual([]);
    // Without the edge the box is a question of its own, and gets its draft.
    expect(planOf([asked, other, box], { settings: DRAFTS_ON }).ask?.drafts?.map((item) => item.key)).toEqual([box.key]);
  });

  it('asks none for a box that shares a section with an EEO, legal or pay question', () => {
    const section = { id: 'additional-questions' };
    for (const asked of [specOf('What are your salary expectations?', 'text', { section }),
      specOf('Are you a protected veteran?', 'select', { section, optionLabels: ['Yes', 'No'] }),
      specOf('Which best describes you?', 'radio', { section, optionLabels: ['Asian', 'White'] })]) {
      const box = specOf('Why do you want to work here?', 'textarea', { section });
      expect(planOf([asked, box], { settings: DRAFTS_ON }).ask?.drafts ?? [], asked.label).toEqual([]);
    }
  });

  it('still drafts a question of its own beside a legal one in the main part', () => {
    const legal = specOf('Are you legally authorized to work in the United States?', 'radio', { optionLabels: ['Yes', 'No'] });
    const why = specOf('Why do you want to work here?', 'textarea');
    expect(planOf([legal, why], { settings: DRAFTS_ON }).ask?.drafts?.map((item) => item.key)).toEqual([why.key]);
  });
});
