import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSENT_CATEGORIES, FIELD_KINDS, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { TELEMETRY_FIELDS } from '../core/telemetry/events';
import { REASON_CODES } from '../core/types/fill';
import { PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';
import { SAVE_ANSWER_OUTCOMES } from '../messaging/schemas';
import { SIGNUP_COPY } from '../ui/page/signup-copy';
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
    expect(COPY.notices['final-unknown']).toBe("I can't tell whether this is the last step, so I won't press anything.");
    expect(COPY.notices['max-steps'])
      .toBe('This application has more steps than I can follow, so I stopped here. Please finish it yourself.');
    expect(COPY.reasons['sensitive-not-shared']).toBe("This browser may not read your work authorization and self-identification "
      + "answers. To allow it, connect the extension again from TailorIT's Settings › Autofill with that box ticked.");
    expect(COPY.reasons['resume-format-unsupported']).toBe('Your resume is an old Word file. Choose a PDF resume in TailorIT.');
    // The plan's sentence, as the owner's decision of 2026-11-01 left it: the answers never go, and since then the
    // legal, pay and attention-check questions the profile does not answer may (docs/SPEC-AMENDMENTS.md §11).
    expect(COPY.options.ai.never).toBe('Your EEO, authorization, sponsorship, criminal record and pay answers never go to '
      + 'the AI. Self-identification and consent questions are never sent to it.');
    expect([COPY.policyFillAnyway, COPY.policyCancel]).toEqual(['Fill anyway', 'Cancel']);
    // Phase 6: the page's card and the panel's say the same line when only TailorIT's saved copy held the statement.
    expect(COPY.policyFromStoredCopy).toBe(COPY.notices['policy-stored-copy']);
  });

  it('names every field kind, and on the options page each of the five counted fields and nothing more', () => {
    expect(Object.keys(COPY.fieldKinds).sort()).toEqual([...FIELD_KINDS].sort());
    expect(Object.keys(COPY.options.telemetry.fields)).toEqual([...TELEMETRY_FIELDS]);
    expect(Object.keys(COPY.options.telemetry.columns)).toEqual([...TELEMETRY_FIELDS, 'count']);
  });

  it("names the launcher's progress, never a count of fields that need the person (v4, D11), and draws nothing on the page (the owner's decision of 2026-11-01)", () => {
    expect([COPY.launcherReview(), COPY.launcherReview(100), COPY.launcherReview(40)]).toEqual(['Autofill is done. Open the review',
      'Autofill is done. Open the review', 'Autofill is done: 40% filled. Open the review']);
    expect(COPY.launcherNeedsYou).not.toMatch(/needs you/i);
    expect(Object.keys(COPY)).not.toContain('chips');
    expect(Object.keys(COPY)).not.toContain('removeSelection');
    expect([COPY.aiChip, COPY.aiGuessChip]).toEqual(['AI', 'AI guess']);
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

  it('says what came of every Save my answer, and why one was not saved (Phase 6)', () => {
    expect(Object.keys(COPY.panel.saveOutcomes).sort()).toEqual([...SAVE_ANSWER_OUTCOMES].sort());
    for (const outcome of SAVE_ANSWER_OUTCOMES) expect(COPY.panel.saveOutcomes[outcome], outcome).toMatch(SENTENCE);
    expect(COPY.panel.saveOutcomes.saved).toBe(COPY.panel.answerSaved);
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

  it('names the brand as the headers draw it, the main button Autofill, and the progress as a percent (v3 Phase 3)', () => {
    expect(`${COPY.brand.name.join('')} ${COPY.brand.product}`).toBe(COPY.appName);
    expect(`${COPY.brand.name.join('')} ${COPY.brand.settings}`).toBe(COPY.optionsTitle);
    expect([COPY.panel.fill, COPY.panel.dryRun, COPY.panel.continue, COPY.panel.cancel]).toEqual(['Autofill', 'Dry run', 'Continue',
      'Cancel']);
    // Jobright's progress line: "Autofilling… 78%", then (v4 ui, the owner's screenshot 4) "7/7 required fields filled
    // | 100%".
    // v5 p1-panel: the sheet's header in Title Case (PLAN decisions 3 and 4: "7/9 Required Fields Filled | 77%").
    expect(COPY.report.progressFilled(9, 12, true)).toBe('9/12 Required Fields Filled');
    expect(COPY.report.progressFilled(2, 3, false)).toBe('2/3 Fields Filled');
    expect(COPY.report.progressDryRun(3, 4, true)).toBe('3/4 Required Fields Would Be Filled');
    expect(COPY.report.percent(75)).toBe('75%');
    expect(COPY.report.progressText(9, 12, true, 75)).toBe('9 of 12 required fields filled, 75%');
    // While it fills, "required" only when the form has required fields (v3 Phase 3 review).
    expect(COPY.report.progressWorking(75, true)).toBe('Autofilling, 75% of the required fields filled');
    expect(COPY.report.progressWorking(66, false)).toBe('Autofilling, 66% of the fields filled');
    expect([COPY.report.scanning, COPY.report.autofilling, COPY.report.requiredGroup, COPY.report.optionalGroup])
      .toEqual(['Scanning The Page', 'Autofilling', 'Required', 'Optional']);
    expect(COPY.report.sectionAdded(COPY.report.repeatables.education, 2, 3)).toBe('Education · 2 of 3 added');
    expect(COPY.launcherFilling(78)).toBe('Autofilling, 78%');
    expect([COPY.report.needsYou(1), COPY.report.needsYou(3)]).toEqual(['1 field is left for you', '3 fields are left for you']);
    // Worded apart from the launcher's count, which also counts the Add buttons left.
    expect(COPY.report.needsYou(3)).not.toBe(COPY.launcherReview(3).replace('Review: ', ''));
    for (const sentence of [COPY.report.allClear, COPY.panelEmpty, COPY.notices['deferred-fields'], COPY.notices['form-hidden'],
      COPY.panel.focusFailed]) {
      expect(sentence).toMatch(SENTENCE);
      expect(sentence).not.toMatch(/\bFill again\b|choose Fill\b/);
    }
  });

  it('gives docs/PRIVACY.md the disclosure the options page shows, word for word', () => {
    const privacy = readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
    for (const paragraph of [...COPY.options.connection.disclosure, COPY.options.connection.consentLine]) {
      expect(privacy, paragraph.slice(0, 40)).toContain(paragraph);
    }
  });

  // The jr6 review (C3): where a site asks for the email first, Autofill goes on only on Sign-in Auto or with Sign up &
  // Autofill. Oracle's email gate is typed and its Next pressed only then (content/orchestrator.ts typeableWallShown,
  // runtime.ts wallStep). ADP's guest page is filled like any step in every mode, and its Continue is pressed on Auto
  // alone (signInContainerNow). So the disclosure says it in the sentence that names Sign-in on Auto, as version 14 does.
  // Once SHELL types a gate's email on Manual too (BUILD D-d), the clause may stand in a sentence of its own, naming its
  // Next as Auto's alone and never saying it goes on: Manual never presses it.
  it('says what it does where a site asks for your email first for Sign-in on Auto alone, or names Next as Auto’s alone', () => {
    const clause = 'asks for your email first';
    const sentences = COPY.options.connection.disclosure.flatMap((paragraph) => paragraph.split(/(?<=\.)\s+(?=["A-Z])/));
    const holding = sentences.filter((sentence) => sentence.includes(clause));
    expect(holding, `one sentence says "${clause}" (reworded? update this test)`).toHaveLength(1);
    const sentence = holding[0]!;
    const lead = sentence.slice(0, sentence.indexOf(clause));
    const autoAlone = lead.includes('Sign-in on Auto') && !lead.includes('Manual');
    expect(autoAlone || /\bNext only\b[^.;]*\bAuto\b/.test(sentence), sentence).toBe(true);
    if (!autoAlone) expect(sentence, sentence).not.toMatch(/\bgoes on\b/);
  });

  // The jr6 review (R3, R10): the job-site sign-in is the one saved in Sign-up Information (this browser) since jr6:
  // no word about signing in sends the person to TailorIT's Settings › Autofill to fix it, or says TailorIT holds one.
  it('sends the person to Sign-up Information, never TailorIT’s settings, for the job-site sign-in', () => {
    const signInWords = [COPY.notices['sign-in-auto'], COPY.notices['sign-in-unavailable'], COPY.notices['sign-in-failed'],
      COPY.mainView.signUpHelp, COPY.mainView.signUpNeedsPassword, COPY.toasts.signIn, COPY.toasts.signInFailed,
      COPY.toasts.noSignIn, COPY.toasts.signInTyped, ...Object.values(COPY.options.modes.signIn)];
    for (const words of signInWords) {
      expect(words, words).not.toMatch(/Settings › Autofill|saved in TailorIT/);
    }
    for (const words of [COPY.notices['sign-in-auto'], COPY.notices['sign-in-unavailable'], COPY.notices['sign-in-failed'],
      COPY.mainView.signUpHelp, COPY.mainView.signUpNeedsPassword, COPY.toasts.noSignIn]) {
      expect(words, words).toContain('Sign-up Information');
    }
    // "Import from TailorIT" is offered without saying TailorIT holds a sign-in it may not hold.
    expect(SIGNUP_COPY.importOffer).not.toMatch(/TailorIT keeps/);
    expect(SIGNUP_COPY.importNone).toContain("sign-ins saved for one site aren't imported");
  });

  it('keeps the development capture tool out of COPY, so production bundles never carry its words', () => {
    const shared = JSON.stringify(COPY, (_key, value: unknown) => (typeof value === 'function' ? String(value) : value));
    for (const text of Object.values(CAPTURE_COPY)) {
      const words = typeof text === 'function' ? String(text) : text;
      expect(shared.includes(words), words).toBe(false);
    }
  });
});
