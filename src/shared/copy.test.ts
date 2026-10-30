import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSENT_CATEGORIES, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { REASON_CODES } from '../core/types/fill';
import { PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';
import { CAPTURE_COPY, COPY } from './copy';
import { NOTICE_CODES } from './report';

/** A sentence a person reads: it starts with a capital or a quote, ends with a full stop, and is not a placeholder. */
const SENTENCE = /^["A-Z(].*[.]$/s;

describe('the copy', () => {
  it('has a plain sentence for every reason code, and nothing for a code that does not exist', () => {
    expect(Object.keys(COPY.reasons).sort()).toEqual([...REASON_CODES].sort());
    for (const code of REASON_CODES) {
      expect(COPY.reasons[code], code).toMatch(SENTENCE);
      expect(COPY.reasons[code], code).not.toMatch(/TODO|TBD|\bcode\b|_/i);
    }
  });

  it('has a sentence for every notice', () => {
    expect(Object.keys(COPY.notices).sort()).toEqual([...NOTICE_CODES].sort());
    for (const code of NOTICE_CODES) expect(COPY.notices[code], code).toMatch(SENTENCE);
  });

  it("keeps the plan's exact words", () => {
    expect(COPY.tripwire).toBe('This page contains text addressed to AI tools. It was ignored.');
    expect(COPY.notices.tripwire).toBe(COPY.tripwire);
    expect(COPY.notices.policy).toBe('This posting says AI-assisted applications are not allowed. Filling is your decision.');
    expect(COPY.notices['policy-unreadable'])
      .toBe("I couldn't read this posting to check whether it allows AI tools. Check it before you submit.");
    expect(COPY.reasons['sensitive-not-shared']).toBe("This browser may not read your work authorization and self-identification "
      + "answers. To allow it, connect the extension again from TailorIT's Settings › Autofill with that box ticked.");
    expect(COPY.reasons['resume-format-unsupported']).toBe('Your resume is an old Word file. Choose a PDF resume in TailorIT.');
    expect(COPY.options.ai.never).toBe('Your EEO, authorization and sponsorship answers never go to the AI, and questions that '
      + 'look like them are not sent to it.');
    expect([COPY.policyFillAnyway, COPY.policyCancel]).toEqual(['Fill anyway', 'Cancel']);
    expect(COPY.removeSelection).toBe('Remove this selection');
  });

  it("names the in-page highlights' chips for every status that gets one", () => {
    expect(Object.keys(COPY.chips).sort()).toEqual(FILL_STATUSES.filter((status) => status !== 'skipped').sort());
    expect([COPY.launcherReview(1), COPY.launcherReview(3)]).toEqual(['Review: 1 field needs you', 'Review: 3 fields need you']);
  });

  it('names every status, provenance, matcher stage, run status, pause, platform and consent category', () => {
    expect(Object.keys(COPY.statuses).sort()).toEqual([...FILL_STATUSES].sort());
    expect(Object.keys(COPY.provenances).sort()).toEqual([...PROVENANCES].sort());
    expect(Object.keys(COPY.stages).sort()).toEqual([...MATCHER_STAGES].sort());
    expect(Object.keys(COPY.runStatuses).sort()).toEqual([...RUN_STATUSES].sort());
    expect(Object.keys(COPY.pauseReasons).sort()).toEqual([...PAUSE_REASONS].sort());
    for (const reason of PAUSE_REASONS) expect(COPY.pauseReasons[reason], reason).toMatch(SENTENCE);
    expect(Object.keys(COPY.platforms).sort()).toEqual([...PLATFORMS].sort());
    expect(Object.keys(COPY.options.consent.categories)).toEqual([...CONSENT_CATEGORIES]);
    for (const category of CONSENT_CATEGORIES) expect(COPY.options.consent.categories[category].help, category).toMatch(SENTENCE);
  });

  it('counts in words that fit the count', () => {
    expect(COPY.panel.started(0)).toBe('No application form was found in this tab.');
    expect(COPY.panel.started(1)).toBe('Filling the form.');
    expect(COPY.panel.started(2)).toBe('Filling 2 forms.');
    expect(COPY.options.data.cleared(1)).toBe('Cleared 1 saved run.');
    expect(COPY.options.data.cleared(3)).toBe('Cleared 3 saved runs.');
    expect(COPY.report.step(0, 6)).toBe('Step 1 of 6');
    expect(COPY.report.step(2)).toBe('Step 3');
  });

  it('gives docs/PRIVACY.md the disclosure the options page shows, word for word', () => {
    const privacy = readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
    for (const paragraph of [...COPY.options.connection.disclosure, COPY.options.connection.consentLine]) {
      expect(privacy, paragraph.slice(0, 40)).toContain(paragraph);
    }
  });

  it('keeps the development capture tool out of COPY, so production bundles never carry its words', () => {
    const shared = JSON.stringify(COPY, (_key, value: unknown) => (typeof value === 'function' ? String(value) : value));
    for (const text of Object.values(CAPTURE_COPY)) {
      const words = typeof text === 'function' ? String(text) : text;
      expect(shared.includes(words), words).toBe(false);
    }
  });
});
