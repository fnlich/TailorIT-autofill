/*
 * The v2 words: the strip before a run, the job card, Add and Save, Change, the custom question, and the first-run
 * disclosure's lookup sentence.
 */
import { describe, expect, it } from 'vitest';
import { AUTOFILL_FILE_KINDS, RESUME_CHOICE_REASONS, WORK_ARRANGEMENTS } from '../contract/tailorit';
import { ADD_JOB_OUTCOMES, ASK_LENGTHS, ASK_REFUSALS } from '../messaging/page-schemas';
import { COPY } from './copy';

/** A sentence a person reads: it starts with a capital or a quote, ends with a full stop. */
const SENTENCE = /^["A-Z(].*[.]$/s;

describe('the v2 copy', () => {
  it('words the job card: its match, keywords, posting date, tracker warning and every reason and kind', () => {
    expect(COPY.job.keywords(9, 12)).toBe('9 of 12 keywords');
    expect(COPY.job.matchLabel(75, COPY.job.bands.good)).toBe('75% match: Good');
    // v3 Phase 3: Jobright's bands, and the tip saying what the score counts.
    expect(Object.values(COPY.job.bands)).toEqual(['Excellent', 'Good', 'Fair', 'Poor']);
    // v3.2 EXT (E5): one sentence.
    expect(COPY.job.matchTip(9, 12)).toBe('9 of 12 keywords in this posting are in your resume.');
    expect(COPY.job.applied).toBe('Applied');
    expect([0, 1, 2, 13, 21, 90].map(COPY.job.posted)).toEqual(['Posted today', 'Posted yesterday', 'Posted 2 days ago',
      'Posted 13 days ago', 'Posted 3 weeks ago', 'Posted 3 months ago']);
    expect(COPY.job.alreadyApplied('Applied')).toBe('Already in your tracker as Applied. Check before you apply again.');
    expect(COPY.job.via('Lever')).toBe('Lever application');
    expect(Object.keys(COPY.job.resumeReasons).sort()).toEqual([...RESUME_CHOICE_REASONS].sort());
    expect(Object.keys(COPY.job.fileKinds).sort()).toEqual([...AUTOFILL_FILE_KINDS].sort());
    expect(Object.keys(COPY.job.arrangements).sort()).toEqual([...WORK_ARRANGEMENTS].sort());
    for (const sentence of [COPY.job.loading.replace('…', '.'), COPY.job.unavailable, COPY.job.disconnected, COPY.job.notFoundHelp,
      COPY.job.cannotAdd, COPY.job.noKeywords, COPY.job.unreadable, COPY.job.noResume]) expect(sentence).toMatch(SENTENCE);
    // The help never claims more than the card knows, and the main button is named as the panel names it.
    expect(COPY.job.notFoundHelp).toContain(COPY.panel.fill);
  });

  it('says what came of every Add or Save, and why a custom question got no answer', () => {
    expect(Object.keys(COPY.job.addOutcomes).sort()).toEqual([...ADD_JOB_OUTCOMES].sort());
    for (const outcome of ADD_JOB_OUTCOMES) expect(COPY.job.addOutcomes[outcome], outcome).toMatch(SENTENCE);
    expect(Object.keys(COPY.ask.outcomes).sort()).toEqual([...ASK_REFUSALS].sort());
    for (const outcome of ASK_REFUSALS) expect(COPY.ask.outcomes[outcome], outcome).toMatch(SENTENCE);
    expect(Object.keys(COPY.ask.lengths)).toEqual([...ASK_LENGTHS]);
    expect(COPY.ask.writtenFrom('Backend resume')).toBe('Written from your resume: Backend resume');
    expect(COPY.ask.policy).toMatch(SENTENCE);
  });

  it("says where the tab stands before a run, naming the form's site", () => {
    expect(COPY.strip.form('Lever')).toBe('Lever application form found');
    expect(COPY.strip.form(null)).toBe('Application form found');
    for (const sentence of [COPY.strip.noForm, COPY.strip.none]) expect(sentence).toMatch(SENTENCE);
  });

  it('tells the person, before they connect, when TailorIT is asked which job page they are on', () => {
    const [, lookups] = COPY.options.connection.disclosure;
    // v3 Phase 3: as an application page loads, not only while the side panel shows it; v3 Phase 3b: a posting too.
    expect(lookups).toContain('When an application page or a job posting on those sites loads');
    // v5 p1-rules (disclosure version 10): the panel, on the page or in Chrome's side panel.
    expect(lookups).toContain('while its panel shows one');
    // v4: no Dry run to choose (disclosure version 8).
    expect(lookups).toContain('when you choose Autofill, add the job');
    expect(lookups).not.toContain('Dry run');
    expect(lookups).toContain('does not keep the page\'s address');
  });

  it('asks to connect again when the versions differ', () => {
    expect(COPY.panel.versionMismatch).toContain('connect again');
    expect(COPY.options.connection.versionMismatch).toContain('connect again');
  });
});
