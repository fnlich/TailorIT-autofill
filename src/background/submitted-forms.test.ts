/*
 * v1.3 B: the worker's translations of a submitted form (submitted-forms.ts) and of TailorIT's known answers, and the
 * run-start batch's claim of a prefetched answer (ai-tasks.ts signatureOf, claimedVerdict). Undo proofs: each `it`
 * names the rule whose removal fails it.
 */
import { describe, expect, it } from 'vitest';
import { AutofillSubmissionRequestSchema, type AutofillFormsKnownResponse } from '../contract/tailorit';
import { optionsOf } from '../core/plan/plan.testkit';
import type { AnswerItem, AnswerVerdict } from '../core/plan/answers';
import { optionSetHash } from '../core/text/keys';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { CapturedField } from '../messaging/schemas';
import { capFits, claimedVerdict, signatureOf } from './ai-tasks';
import { knownSpecsOf } from './known-forms';
import { formCategoryOf, provenanceOf, submissionBodyOf, submittedAnswersOf, type BodyContext } from './submitted-forms';
import { fieldSpec } from './worker.testkit';

const field = (index: number, extra: Partial<FieldSpec>, answer?: CapturedField['answer'], step = 0): CapturedField =>
  ({ spec: fieldSpec(index, extra) as unknown as CapturedField['spec'], step, ...(answer === undefined ? {} : { answer }) });
const SOURCES = optionsOf(['LinkedIn', 'Referral', 'Other']);
const FORM = { posting: { title: 'Engineer', company: 'Northwind', description: 'We build things.' }, fields: [
  field(1, { label: 'First name' }, { kind: 'text', text: 'Alex' }),
  field(2, { label: 'How did you hear about us?', kind: 'select', options: SOURCES,
    optionSetHash: optionSetHash(['LinkedIn', 'Referral', 'Other']) }, { kind: 'options', labels: ['Referral'] }),
  field(3, { label: 'Resume', kind: 'file' }, { kind: 'file', fileName: 'Alex Rivera Resume.pdf' }),
  field(4, { label: 'Gender', kind: 'radio', options: optionsOf(['Female', 'Male']),
    optionSetHash: optionSetHash(['Female', 'Male']) }, { kind: 'options', labels: ['Female'] }, 1),
  field(5, { label: 'Anything else?', kind: 'textarea' }),
] };
const ctx = (extra: Partial<BodyContext> = {}): BodyContext => ({ jobId: 1042, url: null, resumeId: null,
  keepAnswers: true, categoryOf: (spec) => (spec.label === 'Gender' ? 'eeo.gender' : null), rowOf: () => undefined,
  ...extra });

describe('submissionBodyOf: POST /submissions\' body', () => {
  it('sends every question, with its key, options, section, step and category, and each answer by its ref', () => {
    const body = submissionBodyOf(FORM, ctx())!;
    expect(AutofillSubmissionRequestSchema.safeParse(body).success).toBe(true);
    expect(body.jobId).toBe(1042);
    expect(body.questions.map((question) => question.questionKey)).toEqual(['first name', 'how did you hear about us',
      'resume', 'gender', 'anything else']);
    expect(body.questions[1]).toMatchObject({ options: ['LinkedIn', 'Referral', 'Other'], section: 'main', step: 0 });
    expect(body.questions[3]).toMatchObject({ step: 1, category: 'sensitive_eeo' });
    expect(body.answers).toEqual([
      { ref: FORM.fields[0]!.spec.key, answer: { kind: 'text', text: 'Alex' }, provenance: null },
      { ref: FORM.fields[1]!.spec.key, answer: { kind: 'options', labels: ['Referral'] }, provenance: null },
      // A file's name alone, never its content.
      { ref: FORM.fields[2]!.spec.key, answer: { kind: 'file', fileName: 'Alex Rivera Resume.pdf' }, provenance: null },
      // Sensitive answers go to the person's own TailorIT.
      { ref: FORM.fields[3]!.spec.key, answer: { kind: 'options', labels: ['Female'] }, provenance: null },
    ]);
    // A job TailorIT has: no posting.
    expect(body.posting).toBeUndefined();
  });

  // Undo proof: send `answers` whatever keepAnswers says and this fails.
  it('sends the questions only while "Keep my submitted answers in TailorIT" is off', () => {
    const body = submissionBodyOf(FORM, ctx({ keepAnswers: false }))!;
    expect(body.questions).toHaveLength(5);
    expect(body).not.toHaveProperty('answers');
  });

  it('sends the page\'s posting only for a job TailorIT has no id of, by its address', () => {
    const body = submissionBodyOf(FORM, ctx({ jobId: null, url: 'https://example.com/jobs/1' }))!;
    expect(body).toMatchObject({ url: 'https://example.com/jobs/1', posting: FORM.posting });
    expect(body).not.toHaveProperty('jobId');
    expect(submissionBodyOf(FORM, ctx({ jobId: null, url: null }))).toBeNull();
  });

  it('leaves out a question whose label normalizes to nothing, with its answer, and an answer that fits no kind', () => {
    const odd = { posting: null, fields: [field(1, { label: '???' }, { kind: 'text', text: 'x' }),
      field(2, { label: 'Notes' }, { kind: 'checked', checked: true })] };
    const body = submissionBodyOf(odd, ctx())!;
    expect(body.questions.map((question) => question.label)).toEqual(['Notes']);
    expect(body.answers).toEqual([]);
  });

  it('names where each answer came from: the run\'s write, or the person', () => {
    expect(provenanceOf(undefined)).toBeNull();
    const row = { provenance: 'profile' as const, wrote: true, reason: 'ok' as const, detail: undefined };
    expect(provenanceOf(row)).toBe('profile');
    expect(provenanceOf({ ...row, reason: 'changed-by-you' })).toBe('person');
    expect(provenanceOf({ ...row, wrote: false, provenance: null })).toBe('person');
    expect(provenanceOf({ ...row, provenance: 'submitted-before' })).toBe('submitted-before');
  });

  it('names categories as TailorIT does: sensitive ones by their class', () => {
    expect(formCategoryOf('eeo.gender')).toBe('sensitive_eeo');
    expect(formCategoryOf('workAuth.sponsorship')).toBe('sensitive_legal');
    expect(formCategoryOf('salary.expected')).toBe('sensitive_compensation');
    expect(formCategoryOf('consent.privacy')).toBe('consent');
    expect(formCategoryOf('attentionCheck')).toBe('attention_check');
    expect(formCategoryOf('freeText.whyCompany')).toBe('free_text_question');
    expect(formCategoryOf('referral.source')).toBe('referral_source');
  });
});

describe('submittedAnswersOf: TailorIT\'s earlier answers as the resolver reads them', () => {
  const known: AutofillFormsKnownResponse = {
    jobId: 1042,
    questions: [
      { id: 7, questionKey: 'how did you hear about us', label: 'How did you hear about us?', kind: 'select',
        options: ['LinkedIn', 'Referral'], optionSetHash: optionSetHash(['LinkedIn', 'Referral']), section: 'main',
        required: false, step: 1, position: 4, source: 'submission', firstSeenAt: '2026-11-01T00:00:00.000Z',
        lastSeenAt: '2026-11-01T00:00:00.000Z' },
      { id: 8, questionKey: 'approximately', label: 'Do you need a visa?', kind: 'radio', options: ['Yes', 'No'],
        optionSetHash: null, section: '', required: true, step: 0, position: 2, source: 'ats-api',
        firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z' },
    ],
    answers: [
      { match: 'sameJob', questionId: 7, questionKey: 'how did you hear about us',
        optionSetHash: optionSetHash(['LinkedIn', 'Referral']), questionLabel: 'How did you hear about us?',
        fieldKind: 'select', answer: { kind: 'options', labels: ['Referral'] }, submittedAt: '2026-11-02T00:00:00.000Z' },
      { match: 'sameJob', questionId: 8, questionKey: 'approximately', optionSetHash: '', questionLabel: 'Do you need a visa?',
        fieldKind: 'radio', answer: { kind: 'options', labels: ['No'] }, submittedAt: '2026-11-02T00:00:00.000Z' },
      { match: 'otherJob', questionId: null, questionKey: 'resume', optionSetHash: '', questionLabel: 'Resume',
        fieldKind: 'file', answer: { kind: 'file', fileName: 'r.pdf' }, submittedAt: '2026-11-02T00:00:00.000Z' },
      { match: 'otherJob', questionId: null, questionKey: 'portfolio', optionSetHash: '', questionLabel: 'Portfolio',
        fieldKind: 'text', answer: { kind: 'text', text: 'https://x.example' }, submittedAt: 'never' },
    ],
  };

  it('keeps the key and option set, recomputes a Greenhouse-read question\'s, and never an upload\'s answer', () => {
    const answers = submittedAnswersOf(known);
    expect(answers).toEqual([
      { id: 's0', labelKey: 'how did you hear about us', optionSetHash: optionSetHash(['LinkedIn', 'Referral']),
        kind: 'select', answer: { kind: 'options', labels: ['Referral'] }, sameJob: true, submittedAt: Date.parse('2026-11-02'),
        questionId: 7, section: 'main', order: 10_004 },
      { id: 's1', labelKey: 'do you need a visa', optionSetHash: optionSetHash(['Yes', 'No']), kind: 'radio',
        answer: { kind: 'options', labels: ['No'] }, sameJob: true, submittedAt: Date.parse('2026-11-02'), questionId: 8,
        section: '', order: 2 },
      { id: 's3', labelKey: 'portfolio', optionSetHash: 'none', kind: 'text',
        answer: { kind: 'text', text: 'https://x.example' }, sameJob: false, submittedAt: 0 },
    ]);
  });

  it('plans the known questions as specs of their own (`known|<id>`), never a field\'s key, and no upload', () => {
    const specs = knownSpecsOf([...known.questions, { ...known.questions[0]!, id: 9, kind: 'file', options: [],
      optionSetHash: '' }], 'greenhouse');
    expect(specs.map((spec) => spec.key)).toEqual(['known|8', 'known|7']);
    expect(specs[1]).toMatchObject({ label: 'How did you hear about us?', section: { id: 'main' }, labelVisible: true,
      current: { kind: 'empty' }, optionSetHash: known.questions[0]!.optionSetHash });
    expect(specs[0]!.optionSetHash).toBe(optionSetHash(['Yes', 'No']));
  });
});

describe('the run-start batch\'s claim (ai-tasks.ts)', () => {
  const option = (index: number, labelHash: string) => ({ index, label: `o${index}` as AnswerItem['options'][number]['label'],
    labelHash });
  const item = (key: string, extra: Partial<AnswerItem> = {}): AnswerItem => ({ key: key as FieldKey, scope: 'standard',
    shape: 'choice', kind: 'select', question: 'Do you enjoy hiking?' as AnswerItem['question'],
    hint: '' as AnswerItem['hint'], section: '' as AnswerItem['section'], optionSetHash: 'h', maxLength: null,
    format: null, options: [option(0, 'a'), option(1, 'b')], ...extra });

  it('one question whatever its key, hint or section; another for another label, options or scope', () => {
    expect(signatureOf(item('known|1'))).toBe(signatureOf(item('greenhouse|main|x|h|0', {
      hint: 'Pick one' as AnswerItem['hint'], options: [option(1, 'a'), option(2, 'b')] })));
    expect(signatureOf(item('a'))).not.toBe(signatureOf(item('a', { question: 'Do you enjoy running?' as AnswerItem['question'] })));
    expect(signatureOf(item('a'))).not.toBe(signatureOf(item('a', { options: [option(0, 'a'), option(1, 'c')] })));
    expect(signatureOf(item('a'))).not.toBe(signatureOf(item('a', { scope: 'all' })));
  });

  // Undo proof: keep the prefetched index and the placeholder-shifted field picks the wrong option.
  it('names the field\'s own option with the label hash the answer chose, and refuses a text past its cap', () => {
    const pre = item('known|1');
    const field = item('greenhouse|main|x|h|0', { options: [option(1, 'a'), option(2, 'b')] });
    const verdict: AnswerVerdict = { key: 'known|1' as FieldKey, kind: 'choice', optionSetHash: 'h', index: 1,
      labelHash: 'b', basis: 'guess', taskId: 't' };
    expect(claimedVerdict(verdict, pre, field)).toEqual({ ...verdict, key: field.key, index: 2 });
    const text = item('known|2', { shape: 'text', kind: 'text', options: [], optionSetHash: null });
    const short = { ...text, key: 'f' as FieldKey, maxLength: 5 };
    const long: AnswerVerdict = { key: text.key, kind: 'text', text: 'too long', basis: 'resume', taskId: 't' };
    expect(claimedVerdict(long, text, short)).toBeNull();
    expect(claimedVerdict({ ...long, text: 'ok' }, text, short)).toEqual({ ...long, text: 'ok', key: 'f' });
    expect(capFits(text, short)).toBe(false);
    expect(capFits({ ...text, maxLength: 5 }, { ...short, maxLength: 50 })).toBe(true);
  });
});
