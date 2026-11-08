/*
 * s2 core-wd: "three styles, then Other or leave" (plan/noMatch.ts, plan/frame.ts queryValue and planNoMatchOther,
 * matcher/other.ts noMatchOtherMatch; the owner, 2026-11-07: "there is no matched after with 3 different style value,
 * last will be other or don't write (user can set on setting it)"), and a referral source's kind chosen where a list
 * names no source of its own (Choice.fallback; Workday's "How Did You Hear About Us?", the wd study §5).
 */
import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../types/field';
import type { Profile } from '../types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../types/settings';
import { NO_MATCH_OTHER_CATEGORIES } from './noMatch';
import { fieldOf, goldenProfile, planOf, specOf } from './plan.testkit';

const leave: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, noMatch: 'leave' } };
const other: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, noMatch: 'other' } };

/** The School search's planned write (no results yet). */
const SCHOOL_SEARCH = specOf('School', 'typeahead-remote', { options: [] });
/** What the "Other" query showed, marked so. */
const otherResults = (label: string, labels: readonly string[], extra: Partial<FieldSpec> = {}) =>
  specOf(label, 'typeahead-remote', { optionLabels: labels, searchResults: true, searchOther: true, ...extra });

describe('s2 core-wd: three styles, then the list\'s own "Other"', () => {
  it('asks for the "Other" query by default (the setting unset is read as \'other\'), and not under \'leave\'', () => {
    const unset: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes } };
    delete unset.modes.noMatch;
    for (const settings of [unset, other]) {
      expect(fieldOf(planOf([SCHOOL_SEARCH], { settings }), SCHOOL_SEARCH).write?.value)
        .toEqual({ kind: 'query', queries: ['University of Texas at Austin', 'UT Austin', 'University of Texas'],
          other: true });
    }
    expect(fieldOf(planOf([SCHOOL_SEARCH], { settings: leave }), SCHOOL_SEARCH).write?.value)
      .toEqual({ kind: 'query', queries: ['University of Texas at Austin', 'UT Austin', 'University of Texas'] });
  });

  it('asks for it on a long list searched instead of chosen from whole, too', () => {
    const countries = Array.from({ length: 60 }, (_, at) => `Country ${at}`);
    const long = specOf('Country', 'combobox', { optionLabels: countries, optionsPartial: true });
    // address.country is no entity search of NO_MATCH_OTHER_CATEGORIES: its list's "Other" is never sought.
    expect(fieldOf(planOf([long]), long).write?.value).toMatchObject({ kind: 'query' });
    expect(fieldOf(planOf([long]), long).write?.value).not.toHaveProperty('other');
    const school = specOf('School', 'combobox', { optionLabels: countries, optionsPartial: true });
    expect(fieldOf(planOf([school]), school).write?.value).toMatchObject({ kind: 'query', other: true });
  });

  it('chooses the list\'s own "Other" among what the "Other" query showed, the person\'s school kept for its box', () => {
    const results = otherResults('School', ['Otterbein University', 'Other', 'Brother Rice High School']);
    expect(fieldOf(planOf([results]), results)).toMatchObject({
      write: { value: { kind: 'option', index: 1, cleanLabel: 'Other', freeText: 'The University of Texas at Austin' },
        origin: { provenance: 'profile', path: 'education[0].institution' } },
      // Written, in the flag band: the setting's decision, not the person's answer (shared/report.ts counts it filled).
      row: { status: 'flagged', reason: 'other-option-with-free-text', matcherStage: 'other' } });
  });

  it('reads the strict "Other" alone: never "None of the above", "Others" or an "Other" with more words', () => {
    for (const labels of [['None of the above'], ['Others'], ['Other universities in Texas'], ['Something else'],
      ['Other', 'Other school'], ['!Other']]) {
      const results = otherResults('School', labels);
      expect(fieldOf(planOf([results]), results), labels.join()).toMatchObject({ write: undefined,
        row: { status: 'flagged', reason: 'no-match' } });
    }
    for (const label of ['Other', 'Other School', 'Other - Not Listed', 'Not Listed', 'Other (please specify)']) {
      const results = otherResults('School', ['Rice University', label]);
      expect(fieldOf(planOf([results]), results).write?.value, label).toMatchObject({ kind: 'option', index: 1 });
    }
  });

  it('never chooses an "Other" under \'leave\', nor for an EEO, legal, consent or yes/no question', () => {
    const school = otherResults('School', ['Other']);
    expect(fieldOf(planOf([school], { settings: leave }), school).write).toBeUndefined();
    for (const [label, kind] of [['Gender', 'combobox'], ['Are you legally authorized to work in the US?', 'combobox'],
      ['Will you now or in the future require sponsorship?', 'combobox'],
      ['Are you willing to relocate?', 'combobox']] as const) {
      const results = otherResults(label, ['Other'], { kind });
      const planned = fieldOf(planOf([results]), results);
      expect(planned.write, label).toBeUndefined();
    }
    expect(NO_MATCH_OTHER_CATEGORIES.has('eeo.gender')).toBe(false);
    expect(NO_MATCH_OTHER_CATEGORIES.has('workAuth.authorized')).toBe(false);
  });

  it('never chooses an "Other" for a profile answer that is no entity search (a degree, a job title)', () => {
    for (const label of ['Degree', 'Job title']) {
      const results = otherResults(label, ['Other'], { section: { id: 'experience', block: 0 } });
      expect(fieldOf(planOf([results]), results).write, label).toBeUndefined();
    }
  });

  it('never asks for the "Other" query for a value that is not the profile\'s own entity search', () => {
    const gender = specOf('Gender', 'typeahead-remote', { options: [] });
    const write = fieldOf(planOf([gender]), gender).write;
    expect(write?.value.kind === 'query' ? write.value.other : undefined).toBeUndefined();
  });

  it('leaves stage e\'s "Other" on a list read whole unchosen under \'leave\' (the default chooses it, as before)', () => {
    const school = specOf('School', 'select', { optionLabels: ['Rice University', 'Baylor University',
      'Other (please specify)'] });
    expect(fieldOf(planOf([school]), school).write?.value).toMatchObject({ kind: 'option', index: 2,
      freeText: 'The University of Texas at Austin' });
    expect(fieldOf(planOf([school], { settings: leave }), school)).toMatchObject({ write: undefined,
      row: { status: 'flagged', reason: 'no-match' } });
  });
});

describe('s2 core-wd: a referral source\'s kind (Choice.fallback)', () => {
  const withSource = (id: string, extra: Partial<NonNullable<Profile['referralSource']>> = {}): Profile => ({
    ...goldenProfile(), referralSource: { id, ...extra } });
  const SOURCE = (labels: readonly string[]) => specOf('How did you hear about us?', 'select', { optionLabels: labels });

  it('chooses the kind of source the profile names where the list names no source of its own', () => {
    const list = SOURCE(['Select...', 'Employee Referral', 'Job Board', 'Social Media', 'University']);
    const planned = fieldOf(planOf([list], { profile: withSource('other', { otherText: 'A meetup newsletter',
      category: 'social-media' }) }), list);
    expect(planned.write?.value).toMatchObject({ kind: 'option', index: 3, cleanLabel: 'Social Media' });
    expect(planned.write?.origin).toMatchObject({ provenance: 'profile', path: 'referralSource' });
  });

  it('chooses the source itself where the list names it, whatever its kind', () => {
    const list = SOURCE(['Select...', 'Indeed', 'Job Board', 'Social Media']);
    const planned = fieldOf(planOf([list], { profile: withSource('indeed', { category: 'social-media' }) }), list);
    expect(planned.write?.value).toMatchObject({ kind: 'option', index: 1, cleanLabel: 'Indeed' });
  });

  it('types the kind as a remote search\'s reduced style', () => {
    const search = specOf('How Did You Hear About Us?', 'typeahead-remote', { options: [] });
    const planned = fieldOf(planOf([search], { profile: withSource('indeed', { category: 'job-board' }) }), search);
    expect(planned.write?.value).toEqual({ kind: 'query', queries: ['Indeed', 'Indeed.com', 'Job board'], other: true });
  });
});
