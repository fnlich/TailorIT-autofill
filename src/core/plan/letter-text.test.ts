/*
 * v3 Phase 3b in planFrame: a cover-letter text box (frame.ts planCoverLetterText) gets the run's letter typed in, as a
 * cover-letter upload gets it attached (docs/SPEC-AMENDMENTS.md §12 Decision 7): it waits for the letter and its words,
 * writes them through guardWrite (provenance profile, path coverLetter.text, which nothing but a cover-letter text box
 * takes), never an AI-written letter where the AI may not write, keeps a box that holds text, and a dry run reads no
 * words. And "Apply without resume" (PlanInput.withoutResume): the resume upload is left for the person.
 */
import { describe, expect, it } from 'vitest';
import { checkCategoryPolicy, checkProvenanceShape } from '../guard/provenance';
import type { PlannedWrite } from '../types/fill';
import { COVER_LETTER_TEXT_PATH, type ProfilePath } from '../types/intent';
import { DEFAULT_SETTINGS } from '../types/settings';
import { fieldOf, planOf, specOf } from './plan.testkit';
import type { CoverLetterState } from './types';

const BOX = specOf('Cover Letter', 'textarea');
const RESUME = specOf('Resume/CV', 'file', { visibility: 'hidden-file-with-visible-control' });
const WORDS = 'Dear Northwind team,\n\nI would like to apply.';
const ready = (aiWritten: boolean, text?: string): CoverLetterState =>
  ({ state: 'ready', aiWritten, ...(text === undefined ? {} : { text }) });
const DRAFTS_OFF = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, drafts: false } };

describe('planFrame: a cover-letter text box takes the run’s letter, typed in (v3 Phase 3b)', () => {
  it('waits for the letter and its words, never asking for a draft of its own', () => {
    const out = planOf([BOX]);
    expect(out.coverLetter).toEqual({ keys: [BOX.key], generate: true, text: true });
    expect(out.ask?.drafts ?? []).toEqual([]);
    expect(fieldOf(out, BOX).row).toMatchObject({ status: 'flagged', reason: 'cover-letter-waiting' });
    // Ready, its words not read yet: still waiting, for the words.
    const words = planOf([BOX], { coverLetter: ready(false) });
    expect(words.coverLetter).toEqual({ keys: [BOX.key], generate: true, text: true });
  });

  it('types the person’s letter, or the AI’s where the AI may write, through the guard', () => {
    const theirs = fieldOf(planOf([BOX], { coverLetter: ready(false, WORDS) }), BOX);
    expect(theirs.write).toMatchObject({ value: { kind: 'text', text: WORDS },
      origin: { provenance: 'profile', path: COVER_LETTER_TEXT_PATH } });
    expect(theirs.row).toMatchObject({ status: 'verified', reason: 'cover-letter-typed', provenance: 'profile' });
    const ais = fieldOf(planOf([BOX], { coverLetter: ready(true, WORDS) }), BOX);
    expect(ais.row.reason).toBe('cover-letter-written');
    // Never an AI-written letter in a profile-only run, or with AI-written answers off; the person's own still is.
    for (const asked of [{ noAi: true }, { settings: DRAFTS_OFF }]) {
      expect(fieldOf(planOf([BOX], { ...asked, coverLetter: ready(true, WORDS) }), BOX).write).toBeUndefined();
      expect(fieldOf(planOf([BOX], { ...asked, coverLetter: ready(false, WORDS) }), BOX).write).toBeDefined();
    }
    expect(planOf([BOX], { noAi: true }).coverLetter).toEqual({ keys: [BOX.key], generate: false, text: true });
  });

  it('keeps a box that holds text, refuses words past its length, and says why there is none', () => {
    const held = { ...BOX, current: { kind: 'text' as const, text: 'My own letter' } };
    expect(fieldOf(planOf([held], { coverLetter: ready(false, WORDS) }), held)).toMatchObject({ write: undefined,
      row: { reason: 'prefill-kept' } });
    // A letter longer than the box takes is never cut: the row says plainly that the letter is too long for it.
    const short = { ...BOX, constraints: { maxLength: 10 } };
    expect(fieldOf(planOf([short], { coverLetter: ready(false, WORDS) }), short)).toMatchObject({ write: undefined,
      row: { status: 'flagged', reason: 'cover-letter-too-long', needsUserAction: true,
        detail: { letterLength: { length: [...WORDS].length, limit: 10 } } } });
    expect(fieldOf(planOf([BOX], { coverLetter: { state: 'none', reason: 'cover-letter-none' } }), BOX).row)
      .toMatchObject({ status: 'flagged', reason: 'cover-letter-none' });
    expect(fieldOf(planOf([BOX], { coverLetter: { state: 'ready', aiWritten: false, textUnavailable: true } }), BOX).row)
      .toMatchObject({ status: 'flagged', reason: 'cover-letter-unavailable' });
  });

  it('keeps the page’s canaries a letter holds: the letter is no profile value they would give away', () => {
    const canary = 'pineapple upside down';
    const words = `Dear Northwind team,\n\nI once baked a pineapple upside down cake for my whole team.`;
    const out = planOf([BOX], { canaries: [canary], coverLetter: ready(false, words) });
    expect(out.persistableCanaries).toContain(canary);
    // The letter holding the canary is never typed in (the Guard's canary screen), and the canary is kept for the
    // next document of the application.
    expect(fieldOf(out, BOX).write).toBeUndefined();
    // A canary that equals a profile value is still dropped.
    expect(planOf([BOX], { canaries: ['Alex Rivera'] }).persistableCanaries).not.toContain('Alex Rivera');
  });

  it('reads no words in a dry run: a ready letter is what a fill would type', () => {
    const out = planOf([BOX], { dryRun: true, coverLetter: ready(false) });
    expect(out.writes).toEqual([]);
    expect(fieldOf(out, BOX).row).toMatchObject({ status: 'verified', reason: 'cover-letter-typed', wrote: false });
  });

  it('lets the letter’s words into a cover-letter text box only, as text, untransformed', () => {
    const origin = { provenance: 'profile' as const, path: COVER_LETTER_TEXT_PATH as ProfilePath };
    expect(checkCategoryPolicy(origin, 'freeText.coverLetter').ok).toBe(true);
    for (const category of ['freeText.whyCompany', 'contact.email', 'freeText.other', 'file.coverLetter'] as const) {
      expect(checkCategoryPolicy(origin, category).ok, category).toBe(false);
    }
    expect(checkCategoryPolicy({ ...origin, transform: 'other.free-text' }, 'freeText.coverLetter').ok).toBe(false);
    const asFile = { key: 'k', value: { kind: 'file', ref: 'cover-letter' }, origin } as unknown as PlannedWrite;
    expect(checkProvenanceShape(asFile).ok).toBe(false);
    const asText = { key: 'k', value: { kind: 'text', text: WORDS }, origin } as unknown as PlannedWrite;
    expect(checkProvenanceShape(asText).ok).toBe(true);
  });
});

describe('planFrame: "Apply without resume" (v3 Phase 3b)', () => {
  it('leaves the resume upload for the person, skipped, needing them only where the form requires one', () => {
    const out = planOf([RESUME], { withoutResume: true });
    expect(fieldOf(out, RESUME)).toMatchObject({ write: undefined, row: { status: 'skipped', reason: 'resume-not-attached',
      needsUserAction: false } });
    const required = { ...RESUME, required: true };
    expect(fieldOf(planOf([required], { withoutResume: true }), required).row).toMatchObject({ status: 'skipped',
      reason: 'resume-not-attached', needsUserAction: true });
  });
});
