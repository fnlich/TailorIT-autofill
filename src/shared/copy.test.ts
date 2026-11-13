import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSENT_CATEGORIES, FIELD_KINDS, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { AI_OPENED_CATEGORIES } from '../core/resolver/categories';
import { TELEMETRY_FIELDS } from '../core/telemetry/events';
import { REASON_CODES } from '../core/types/fill';
import { PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';
import { SAVE_ANSWER_OUTCOMES } from '../messaging/schemas';
import { SIGNUP_COPY } from '../ui/page/signup-copy';
import { CAPTURE_COPY, COPY, PAGE_COPY } from './copy';
import { NOTICE_CODES } from './report';
import { DISCLOSURE_VERSION } from './stored';

/** A sentence a person reads: it starts with a capital or a quote, ends with a full stop, and is not a placeholder. */
const SENTENCE = /^["A-Z(].*[.]$/s;

/**
 * The jr6 integration fixes (the completeness review's gap 2): each version of the first-run disclosure, with the
 * sha256 of its words (JSON of the four paragraphs and the consent line, as `disclosureHash` reads them). A connected
 * browser that acknowledged an older version is asked again (stored.ts DISCLOSURE_VERSION), so new words need a new
 * version: changing them without a row here fails, and so does a version with no row. Versions before 14 predate this
 * table. 15 (jr6) had reached no one when the jr6 integration fixes reworded it (the button's name as it reads, and what
 * a download Apply is told), so it kept its number.
 */
const DISCLOSURE_HASHES: readonly { version: number; sha256: string }[] = [
  { version: 14, sha256: 'ad97b204db52277072884bbc2168b5f85d7d2edad738e7a10885428ad03f0532' }, // v1.5 part 2
  { version: 15, sha256: '3383e740883fcc6c5fe8048c3c0d6df52db758235fbe6b33d69433fd14da3e1d' }, // jr6
];

/** The disclosure's words as DISCLOSURE_HASHES pins them. */
function disclosureHash(): string {
  const { disclosure, consentLine } = COPY.options.connection;
  return createHash('sha256').update(JSON.stringify([...disclosure, consentLine])).digest('hex');
}

/** Every string a COPY tree holds (a function's own source too, for the words it builds). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [String(value)];
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** The disclosure's sentences, as a person reads them. */
const disclosureSentences = () => COPY.options.connection.disclosure
  .flatMap((paragraph) => paragraph.split(/(?<=\.)\s+(?=["A-Z])/));

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

  // The jr6 integration fixes (the completeness review's gap 2; the password review's sec-4/R4): the disclosure's words
  // and its version change together.
  it('pins the disclosure to its version: new words need a new DISCLOSURE_VERSION and a row of their own', () => {
    const versions = DISCLOSURE_HASHES.map((row) => row.version);
    expect(versions, 'one row per version, in order').toEqual([...new Set(versions)].sort((a, b) => a - b));
    expect(new Set(DISCLOSURE_HASHES.map((row) => row.sha256)).size, 'each version its own words').toBe(versions.length);
    const last = DISCLOSURE_HASHES.at(-1)!;
    expect(DISCLOSURE_VERSION, 'DISCLOSURE_VERSION is the last row\'s').toBe(last.version);
    expect(disclosureHash(), `the words of version ${last.version} changed: raise DISCLOSURE_VERSION and add a row`)
      .toBe(last.sha256);
  });

  // The jr6 review (C3): where a site asks for the email first, Autofill goes on only on Sign-in Auto or with Sign up &
  // Autofill. Version 14 said it in the sentence that names Sign-in on Auto. Since jr6 SHELL-A (BUILD D-d) a declared
  // email gate's email is typed in either Sign-in mode (content/orchestrator.ts gateFilling, runtime.ts wallStep), its
  // Next pressed only on Auto or with Sign up & Autofill; ADP's guest page is filled like any step in every mode, and
  // its Continue is pressed on Auto alone (signInContainerNow). So version 15's clause stands in a sentence of its own,
  // naming its Next as Auto's alone and never saying it goes on: Manual never presses it.
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

  // jr6 apply F1 (F1.md §7, C6; the jr6 integration, disclosure 15): Autofill on a page with no form presses the site's
  // own Apply and the steps on the way (a consent among them, never its Decline), fills in the same tab on that site, and
  // presses nothing where the Apply would open a new tab, lead to another site or download a file.
  it('says where Autofill presses on a page with no form: the next step, the same tab and site, and what it refuses', () => {
    const [first] = COPY.options.connection.disclosure;
    for (const words of ['Consent & Continue', 'never its Decline', 'Apply manually', 'same tab', 'new tab',
      'another site', 'presses nothing']) expect(first).toContain(words);
    expect(first).not.toMatch(/Open Application/);
  });

  // The jr6 integration fixes (SEC-5): the door refuses an Apply that downloads a file, and the runtime says it as the
  // refusal 'none' (content/runtime.ts: `result.refusal === 'download' ? 'none'`), whose words are the "no form" line's.
  // So the notice says that, never that it tells you why.
  it('says what a download Apply is told: that there is no Apply Autofill could press', () => {
    const holding = disclosureSentences().filter((sentence) => sentence.includes('download a file'));
    expect(holding, 'one sentence names the download (reworded? update this test)').toHaveLength(1);
    const clause = holding[0]!.split(';').find((part) => part.includes('download a file'))!;
    expect(clause, clause).not.toMatch(/tells you why/);
    expect(clause, clause).toContain('no Apply it could press');
    expect(COPY.mainView.entryRefused.none).toContain('no Apply that Autofill could press');
  });

  // The jr6 integration fixes (DOC-11): the panel's button reads Sign Up & Autofill (mainView.signUpFill). Every word of
  // ours that names it, the notice and docs/PRIVACY.md included, names it so, and the no-password toast never asks for
  // it "again": Sign-in Auto shows that toast too, where the person never chose the button.
  it('names Sign Up & Autofill as its button reads, wherever the copy, the notice or PRIVACY.md names it', () => {
    const button = COPY.mainView.signUpFill;
    const privacy = readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
    const named = [...stringsOf(COPY), ...stringsOf(PAGE_COPY), ...stringsOf(SIGNUP_COPY), privacy]
      .flatMap((words) => words.match(/sign[ -]?up & autofill/gi) ?? []);
    expect(named.length).toBeGreaterThan(10);
    expect([...new Set(named)]).toEqual([button]);
    expect(disclosureSentences().filter((sentence) => sentence.includes(button))).toHaveLength(2);
    expect(COPY.toasts.noSignIn).toContain(button);
    expect(COPY.toasts.noSignIn).not.toMatch(/\bagain\b/);
  });

  // The jr6 integration (RULES revD-01 and revD-04, owner question 435): AI answers' All also guesses a non-compete,
  // relatives and military training where the profile does not answer, each always marked an AI guess
  // (GUESS_ONLY_CATEGORIES); a job's essential functions never go to the AI, so the help never names them.
  it('says what AI answers: All guesses, the guess-only topics marked so, never the essential functions', () => {
    const { help } = COPY.options.modes.ai;
    for (const words of ['non-compete', 'relatives', 'military training', 'always marked an AI guess',
      'only the question and its options are sent']) expect(help).toContain(words);
    expect(help).not.toMatch(/essential function/i);
    expect(help).toMatch(SENTENCE);
  });

  // The jr6 integration fixes (DOC-1): while a job's essential functions stay out of AI_OPENED_CATEGORIES (RULES
  // revD-01), docs/PRIVACY.md, the store listing's source, never says they go to the AI: each clause naming them that
  // says something goes, or gets a guess, says "never".
  it.skipIf(AI_OPENED_CATEGORIES.has('screening.essentialFunctions'))(
    'never says in docs/PRIVACY.md that a job’s essential functions go to the AI', () => {
      const privacy = readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
      const clauses = privacy.split(/[;:()\n]|(?<=\.)\s+/).filter((clause) => /essential function/i.test(clause));
      expect(clauses.length).toBeGreaterThan(2);
      const saysTheyGo = clauses.filter((clause) => /\b(?:do|does|now|also) go\b|\bgo(?:es)? to (?:the )?(?:AI|Claude)\b|\bbest guess\b/i
        .test(clause) && !/\bnever\b/i.test(clause));
      expect(saysTheyGo).toEqual([]);
    });

  // The jr6 integration fixes (SEC-3, the coordinator's choice (b): keep the fetch, fix the words): an email gate with no
  // Sign-up Information email takes the profile's (background/index.ts profileEmail: profileCache.get()), which fetches
  // the profile when the worker has dropped it. PRIVACY.md and ARCHITECTURE.md say so, never that nothing is fetched.
  it('says an email gate’s profile email is read as any Autofill run reads the profile, fetched when not held', () => {
    const privacy = readFileSync(new URL('../../docs/PRIVACY.md', import.meta.url), 'utf8');
    const gates = privacy.slice(privacy.indexOf('## Email gates'), privacy.indexOf('## What reaches an AI model'));
    expect(gates).toContain('as any Autofill run reads the profile');
    expect(gates).toMatch(/GET \/profile/);
    expect(gates).not.toMatch(/nothing new is fetched/);
    const architecture = readFileSync(new URL('../../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
    expect(architecture).not.toMatch(/the profile cache the fill already read, no new request/);
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

  // ── jr6 SHELL-A (FIXPLAN §6.12 items 1, 4 and 5; BUILD D-d; the APPLY merge's open item 10): its new words only ──
  it('says the page’s own password rule in its toast, each rule its own, the page’s number for its minimum', () => {
    const kinds = ['length', 'upper', 'lower', 'digit', 'special', 'alpha', 'login'] as const;
    const said = kinds.map((kind) => COPY.toasts.passwordRule(kind, 20));
    for (const words of said) {
      expect(words, words).toMatch(SENTENCE);
      expect(words, words).toContain('Sign-up Information');
      expect(words, words).toContain('typed nothing');
    }
    expect(new Set(said).size).toBe(kinds.length);
    expect(COPY.toasts.passwordRule('length', 20)).toContain('at least 20 characters');
    // Only the length rule carries a number: the page's own.
    for (const kind of kinds.filter((each) => each !== 'length')) expect(COPY.toasts.passwordRule(kind, 20)).not.toMatch(/\d/);
  });

  it('says each kind of account error in its own words, and what the person does next', () => {
    const { account } = COPY.toasts;
    expect(Object.keys(account).sort()).toEqual(['reset-password', 'verify-email', 'wrong-credentials']);
    for (const words of Object.values(account)) expect(words, words).toMatch(SENTENCE);
    expect(new Set(Object.values(account)).size).toBe(3);
    expect(account['verify-email']).toMatch(/\bemail\b/);
    expect(account['reset-password']).toMatch(/Forgot password/);
    expect(account['reset-password']).toContain('Sign-up Information');
    expect(account['wrong-credentials']).toMatch(/didn't accept/);
  });

  // The jr6 integration fixes (DOC-12, owner question 436): Sign-up Information keeps one password for every job site
  // (owner question 384), so the toasts for a reset or a refused password never send the person to change it there
  // without saying that it is every job site's.
  it('says the saved password is every job site’s wherever an account error points at Sign-up Information', () => {
    const { account } = COPY.toasts;
    for (const kind of ['reset-password', 'wrong-credentials'] as const) {
      expect(account[kind], kind).toContain('Sign-up Information');
      expect(account[kind], kind).toMatch(/\bevery job site\b/);
      expect(account[kind], kind).toMatch(SENTENCE);
    }
    expect(account['reset-password']).not.toMatch(/then save the new one/);
  });

  it('says an email gate’s Next is the person’s, never asks for a password there, and that the run waits for one to be '
    + 'saved', () => {
    for (const words of [COPY.toasts.gateTyped, COPY.toasts.gate]) {
      expect(words, words).toMatch(SENTENCE);
      expect(words, words).toMatch(/\bNext\b/);
      expect(words, words).not.toMatch(/password/i);
      expect(words, words).toMatch(/code/);
    }
    expect(COPY.toasts.gate).toContain('Sign Up & Autofill');
    expect(COPY.toasts.noSignInWaiting).toMatch(SENTENCE);
    expect(COPY.toasts.noSignInWaiting).toContain('Sign-up Information');
    expect(COPY.toasts.noSignInWaiting).toContain('5 minutes');
    expect(COPY.toasts.noSignInWaiting).not.toBe(COPY.toasts.noSignIn);
  });

  it('says the sign-in step, not the Apply, in the panel’s status while the frame works at a wall', () => {
    expect(COPY.mainView.signingIn).toMatch(SENTENCE);
    expect(COPY.mainView.signingIn).toMatch(/sign-in/);
    expect(COPY.mainView.signingIn).not.toMatch(/Apply/);
    expect(COPY.mainView.signingIn).not.toBe(COPY.mainView.entering);
  });
  // ── end jr6 SHELL-A ──

  // ── jr7 INT-7: the words the packages left to the integration (INT7-NOTES) ──
  it('names the documents hand-over plainly, for any site, as the assessment\'s note reads', () => {
    const words = COPY.queue.notes.documents;
    expect(words).not.toMatch(/your answer|:/); // the placeholder's shape is gone
    expect(words).toMatch(/^This site asks whether to save your documents/);
    expect(words).not.toMatch(/UltiPro|UKG/); // any adapter's 'documents' hand-over
    expect(words).not.toMatch(/\.$/); // read inside "Needs you (…)", as the assessment's note is
    expect(COPY.queue.notes.assessment).not.toMatch(/\.$/);
    expect(COPY.agent.line({ phase: 'off', job: null, doneToday: 0,
      last: { state: 'needs-you', reason: 'other', note: 'documents' } })).toContain(`(${words})`);
  });

  it('says a field the page kept locked was not filled, and what the person can do, never only that it is locked', () => {
    const words = COPY.reasons['disabled-or-readonly'];
    expect(words).toMatch(SENTENCE);
    expect(words).toMatch(/not filled/);
    expect(words).toMatch(/yourself/);
  });

  it('names a required block left empty in words that fit a list of entries and a signature pad alike', () => {
    expect(PAGE_COPY.requiredBlockLeft('Skills')).toBe('Skills: required, still empty');
    expect(PAGE_COPY.requiredBlockLeft('Signature')).toBe('Signature: required, still empty');
    expect(PAGE_COPY.requiredBlockLeft('Signature')).not.toMatch(/add at least one/);
  });
  // ── end jr7 INT-7 ──
});
