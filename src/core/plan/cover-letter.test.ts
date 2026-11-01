/*
 * Cover-letter uploads in planFrame (Phase G; frame.ts planCoverLetter): a field the rules read as file.coverLetter
 * waits for the run's letter until the worker has asked TailorIT; once ready it is planned as the profile's own
 * document (provenance profile, path coverLetter) through guardWrite; a letter that will not come leaves it flagged
 * with why; an AI-written one is never attached where the AI may not write; a dry run promises what a fill would do.
 */
import { describe, expect, it } from 'vitest';
import { checkCategoryPolicy, checkProvenanceShape } from '../guard/provenance';
import { guardWrite } from '../guard/write';
import type { PlannedWrite } from '../types/fill';
import type { ProfilePath } from '../types/intent';
import { DEFAULT_SETTINGS } from '../types/settings';
import { fieldOf, goldenProfile, planOf, specOf } from './plan.testkit';
import type { CoverLetterState } from './types';

const LETTER = specOf('Cover Letter', 'file', { visibility: 'hidden-file-with-visible-control' });
const RESUME = specOf('Resume/CV', 'file', { visibility: 'hidden-file-with-visible-control' });
const NAME = specOf('First name', 'text');
const ready = (aiWritten: boolean): CoverLetterState => ({ state: 'ready', aiWritten });
const DRAFTS_OFF = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, drafts: false } };

describe('planFrame: a cover-letter upload waits for the run’s letter', () => {
  it('waits, asked for with TailorIT’s AI allowed to write it, and never in `awaiting` (no LLM question)', () => {
    const out = planOf([NAME, RESUME, LETTER]);
    expect(out.coverLetter).toEqual({ keys: [LETTER.key], generate: true });
    expect(out.awaiting).toEqual([]);
    expect(fieldOf(out, LETTER)).toMatchObject({ write: undefined, row: { category: 'file.coverLetter', status: 'flagged',
      reason: 'cover-letter-waiting', provenance: null } });
    // The resume is the resume's: the letter never takes its place.
    expect(fieldOf(out, RESUME).write).toMatchObject({ value: { kind: 'file', ref: 'resume' },
      origin: { provenance: 'profile', path: 'resume' } });
  });

  it('keeps waiting while the worker asks, with the same question', () => {
    const out = planOf([LETTER], { coverLetter: { state: 'waiting' } });
    expect(out.coverLetter).toEqual({ keys: [LETTER.key], generate: true });
    expect(fieldOf(out, LETTER).row.reason).toBe('cover-letter-waiting');
  });

  it('asks for the person’s own letter only: in a profile-only run, with AI-written answers off, in a dry run', () => {
    expect(planOf([LETTER], { noAi: true }).coverLetter).toEqual({ keys: [LETTER.key], generate: false });
    expect(planOf([LETTER], { settings: DRAFTS_OFF }).coverLetter).toEqual({ keys: [LETTER.key], generate: false });
    expect(planOf([LETTER], { dryRun: true }).coverLetter).toEqual({ keys: [LETTER.key], generate: false });
    // A form holding an "I did not use AI" attestation is a profile-only frame too.
    const attest = specOf('I certify that I did not use AI tools to complete this application', 'checkbox');
    expect(planOf([attest, LETTER]).coverLetter).toEqual({ keys: [LETTER.key], generate: false });
  });

  it('asks nothing for an upload that holds a file, a honeypot, or a disabled one', () => {
    const held = { ...LETTER, current: { kind: 'files' as const, count: 1 } };
    const out = planOf([held]);
    expect(out.coverLetter).toBeUndefined();
    expect(fieldOf(out, held)).toMatchObject({ write: undefined, row: { status: 'flagged', reason: 'prefill-kept' } });
    // An upload hidden but by the one allowed way (behind its visible control) is a honeypot.
    const hidden = { ...LETTER, visibility: 'hidden-native-with-visible-label' as const };
    expect(planOf([hidden]).coverLetter).toBeUndefined();
    expect(fieldOf(planOf([hidden]), hidden).row.status).toBe('blocked');
    const disabled = { ...LETTER, disabled: true };
    expect(planOf([disabled]).coverLetter).toBeUndefined();
    // Any other upload asks for nothing, and gets nothing.
    const portfolio = specOf('Portfolio', 'file');
    expect(planOf([portfolio]).coverLetter).toBeUndefined();
    expect(fieldOf(planOf([portfolio], { coverLetter: ready(false) }), portfolio).write).toBeUndefined();
  });

  it('asks nothing for, and writes nothing into, an upload whose accept list refuses a PDF', () => {
    const wordOnly = { ...LETTER, constraints: { accept: ['.doc', '.docx'] } };
    for (const coverLetter of [undefined, { state: 'waiting' } as const, ready(false), ready(true)]) {
      const out = planOf([wordOnly], coverLetter === undefined ? {} : { coverLetter });
      expect(out.coverLetter, coverLetter?.state).toBeUndefined();
      expect(fieldOf(out, wordOnly), coverLetter?.state).toMatchObject({ write: undefined,
        row: { status: 'flagged', reason: 'format-unsupported', provenance: null, needsUserAction: true } });
    }
    // A list that takes a PDF, by its extension, its type or its family, waits for the letter as any upload does.
    for (const accept of [['.pdf', '.docx'], ['application/pdf'], ['application/*']]) {
      const takes = { ...LETTER, constraints: { accept } };
      expect(planOf([takes]).coverLetter, accept.join()).toEqual({ keys: [LETTER.key], generate: true });
      expect(fieldOf(planOf([takes], { coverLetter: ready(false) }), takes).write, accept.join())
        .toMatchObject({ value: { kind: 'file', ref: 'cover-letter' } });
    }
  });
});

describe('planFrame: a letter ready to upload', () => {
  it('is the person’s letter, written as the profile’s cover letter through guardWrite', () => {
    const out = planOf([LETTER], { coverLetter: ready(false) });
    expect(out.coverLetter).toBeUndefined();
    expect(fieldOf(out, LETTER)).toMatchObject({
      write: { value: { kind: 'file', ref: 'cover-letter' }, origin: { provenance: 'profile', path: 'coverLetter' } },
      row: { status: 'verified', provenance: 'profile', reason: 'cover-letter-attached', needsUserAction: false },
    });
  });

  it('is marked as the AI’s when TailorIT’s AI wrote it during this run', () => {
    expect(fieldOf(planOf([LETTER], { coverLetter: ready(true) }), LETTER).row)
      .toMatchObject({ status: 'verified', provenance: 'profile', reason: 'cover-letter-written' });
  });

  it('never attaches an AI-written letter where the AI may not write: a profile-only run, AI-written answers off', () => {
    expect(fieldOf(planOf([LETTER], { coverLetter: ready(true), noAi: true }), LETTER)).toMatchObject({
      write: undefined, row: { status: 'flagged', reason: 'ai-off-for-posting', provenance: null } });
    expect(fieldOf(planOf([LETTER], { coverLetter: ready(true), settings: DRAFTS_OFF }), LETTER)).toMatchObject({
      write: undefined, row: { status: 'flagged', reason: 'drafts-disabled' } });
    // The person's own letter is attached there.
    expect(fieldOf(planOf([LETTER], { coverLetter: ready(false), noAi: true }), LETTER).row.reason)
      .toBe('cover-letter-attached');
  });

  it('keeps a file the field already holds', () => {
    const held = { ...LETTER, current: { kind: 'files' as const, count: 1 } };
    expect(fieldOf(planOf([held], { coverLetter: ready(false) }), held)).toMatchObject({ write: undefined,
      row: { status: 'flagged', reason: 'prefill-kept' } });
  });

  it('is planned by a dry run, which the worker answers with no write', () => {
    const out = planOf([LETTER], { coverLetter: ready(false), dryRun: true });
    expect(out.writes).toEqual([]);
    expect(fieldOf(out, LETTER).row).toMatchObject({ status: 'verified', reason: 'cover-letter-attached',
      provenance: 'profile', wrote: false });
  });
});

describe('planFrame: no letter', () => {
  it('flags the field with why', () => {
    for (const reason of ['cover-letter-failed', 'cover-letter-none', 'cover-letter-unavailable', 'cover-letter-timed-out',
      'cover-letter-reconnect'] as const) {
      expect(fieldOf(planOf([LETTER], { coverLetter: { state: 'none', reason } }), LETTER), reason).toMatchObject({
        write: undefined, row: { status: 'flagged', reason, provenance: null, needsUserAction: true } });
    }
  });

  it('promises in a dry run that a fill has TailorIT’s AI write one, only where the AI may write', () => {
    const none = { state: 'none', reason: 'cover-letter-none' } as const;
    expect(fieldOf(planOf([LETTER], { coverLetter: none, dryRun: true }), LETTER)).toMatchObject({ write: undefined,
      row: { status: 'verified', provenance: 'profile', reason: 'cover-letter-would-write', wrote: false,
        needsUserAction: false } });
    expect(fieldOf(planOf([LETTER], { coverLetter: none, dryRun: true, noAi: true }), LETTER).row)
      .toMatchObject({ status: 'flagged', reason: 'cover-letter-none' });
    expect(fieldOf(planOf([LETTER], { coverLetter: none, dryRun: true, settings: DRAFTS_OFF }), LETTER).row)
      .toMatchObject({ status: 'flagged', reason: 'cover-letter-none' });
    // A fill that hears "none" with the AI allowed was asked with generate false: nothing to promise.
    expect(fieldOf(planOf([LETTER], { coverLetter: none }), LETTER).row).toMatchObject({ status: 'flagged',
      reason: 'cover-letter-none' });
  });
});

describe('the Guard: an upload takes only its own document', () => {
  const path = (text: string) => text as ProfilePath;
  const write = (ref: 'resume' | 'cover-letter', at: string): PlannedWrite => ({ key: LETTER.key, value: { kind: 'file', ref },
    origin: { provenance: 'profile', path: path(at) }, match: { stage: 'not-applicable', optionIndex: null, rule: null,
      confidence: 1, flags: [], suggestions: [], reason: 'ok' } });

  it('in the frame: a file write’s origin names the document it carries', () => {
    expect(checkProvenanceShape(write('cover-letter', 'coverLetter'))).toEqual({ ok: true });
    expect(checkProvenanceShape(write('resume', 'resume'))).toEqual({ ok: true });
    expect(checkProvenanceShape(write('cover-letter', 'resume'))).toEqual({ ok: false, reason: 'policy-violation' });
    expect(checkProvenanceShape(write('resume', 'coverLetter'))).toEqual({ ok: false, reason: 'policy-violation' });
    expect(checkProvenanceShape({ ...write('cover-letter', 'coverLetter'),
      origin: { provenance: 'profile', path: path('coverLetter'), transform: 'name.split' } }))
      .toEqual({ ok: false, reason: 'policy-violation' });
  });

  it('in the worker: a category takes its own document only, and any other upload none', () => {
    const origin = (at: string) => ({ provenance: 'profile' as const, path: path(at) });
    expect(checkCategoryPolicy(origin('coverLetter'), 'file.coverLetter').ok).toBe(true);
    expect(checkCategoryPolicy(origin('resume'), 'file.resume').ok).toBe(true);
    expect(checkCategoryPolicy(origin('resume'), 'file.coverLetter').ok).toBe(false);
    expect(checkCategoryPolicy(origin('coverLetter'), 'file.resume').ok).toBe(false);
    expect(checkCategoryPolicy(origin('resume'), 'file.other').ok).toBe(false);
    expect(checkCategoryPolicy(origin('coverLetter'), 'file.other').ok).toBe(false);
    expect(checkCategoryPolicy({ provenance: 'llm-answer', taskId: 't', basis: 'resume' }, 'file.coverLetter').ok).toBe(false);
    expect(checkCategoryPolicy({ provenance: 'rule', ruleId: 'guard.revert' }, 'file.coverLetter').ok).toBe(false);
  });

  it('refuses a cover letter the profile does not hold', () => {
    const ctx = { canaries: [], profile: goldenProfile(), savedAnswers: [] };
    expect(guardWrite(write('cover-letter', 'coverLetter'), { spec: LETTER, category: 'file.coverLetter' }, ctx))
      .toEqual({ ok: false, reason: 'missing-provenance' });
    const withLetter = { ...ctx, profile: { ...goldenProfile(), coverLetter: { aiWritten: false } } };
    expect(guardWrite(write('cover-letter', 'coverLetter'), { spec: LETTER, category: 'file.coverLetter' }, withLetter))
      .toEqual({ ok: true });
    expect(guardWrite(write('resume', 'resume'), { spec: LETTER, category: 'file.coverLetter' }, withLetter))
      .toEqual({ ok: false, reason: 'policy-violation' });
  });
});
