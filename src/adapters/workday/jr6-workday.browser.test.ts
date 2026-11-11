/*
 * jr6 WORKDAY (FIXPLAN §6.4): the Workday adapter on the owner's 26 jr6 pages (fixtures/workday/jr6-*, the captures of
 * 2026-11-06 converted with the jr6 converter) and the committed account and My Experience pages, written from the jr6
 * auditor's print harness (SP\jr6\audit\workday.md §4) as asserts. P1 holds what the adapter reads:
 * - every jr6 page's step: detected, its account state and pause, its signature, finality, Next and Submit, its entry,
 *   its repeatable sections and held uploads (the harness's first line per page, hand-checked against each page);
 * - the hooks of FIXPLAN §3.1 items 12 to 14 and 17 (WD-02 passwordRules, WD-03 createAccountSwitch, WD-05
 *   accountErrorKind, WD-07 removeButton), WD-18's tags declaration, WD-20's Education sections, and WD-10 and
 *   workday-new-1's labels as the planner reads them;
 * - nothing presses the Create Account link or a block's Delete (both stay never pressed).
 * P2 (FIXPLAN §6.4 "P2 asserts", after merging jr6-engine E1-E3 and jr6-rules R1-R4) holds what the merged scanner,
 * planner and fillers make of the same pages: each finding's question read and answered as the plan says (WD-07 to
 * WD-17, WD-20, WD-25 to WD-30, workday-new-1 and -2; RULES' handoff edits 13 and 21), Skills filled one value at a
 * time and read back by its pills (WD-18), and the dates' parts focused before their writes, their alert read (WD-23).
 * A capture taken filled is set back to the step before the person's answers first (`unanswer`: its redacted choices
 * and pills taken away); a list no capture shows open gets the words Workday tenants commonly use (ASSUMED_LISTS, so
 * named in each test). Plans use the golden synthetic profile (or variants built here) and DEFAULT_SETTINGS; the
 * fixtures hold none of the owner's values.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { writeField, type PassEnv, type WidgetWriteEnv } from '../../content/pass';
import { verifyWritten } from '../../content/verify';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import { MANY_SEPARATOR } from '../../core/resolver/values';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types/settings';
import { fillDateParts } from '../../dom/fillers/date-parts';
import { verifyAfterSettle } from '../../dom/fillers/verify';
import { detectPause } from '../../dom/pause-detect';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type Fixture } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import type { ScanResult, WidgetReading } from '../../dom/types';
import { visibleText } from '../../dom/visible-text';
import { chipWords, tagIdentity } from '../../dom/widgets/tag-chips';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { WORKDAY_JR6_SNAPSHOTS, WORKDAY_SKILLS_CAP } from './application';
import { workdayAdapter } from './index';
// The owner's jr6 pages.
import gnwAq from '../../../fixtures/workday/jr6-gnw-application-questions.html?raw';
import parsonsAq from '../../../fixtures/workday/jr6-parsons-application-questions.html?raw';
import travelersAq from '../../../fixtures/workday/jr6-travelers-application-questions.html?raw';
import verilyAq from '../../../fixtures/workday/jr6-verily-application-questions.html?raw';
import cisiveAq from '../../../fixtures/workday/jr6-cisive-application-questions.html?raw';
import danaAq1 from '../../../fixtures/workday/jr6-danafarber-application-questions-1.html?raw';
import danaAq2 from '../../../fixtures/workday/jr6-danafarber-application-questions-2.html?raw';
import resolveVd from '../../../fixtures/workday/jr6-resolvetech-voluntary-disclosures.html?raw';
import cisiveVd from '../../../fixtures/workday/jr6-cisive-voluntary-disclosures.html?raw';
import webVd from '../../../fixtures/workday/jr6-web-voluntary-disclosures.html?raw';
import gnwVd from '../../../fixtures/workday/jr6-gnw-voluntary-disclosures.html?raw';
import travelersVd from '../../../fixtures/workday/jr6-travelers-voluntary-disclosures.html?raw';
import aepVd from '../../../fixtures/workday/jr6-aep-voluntary-disclosures.html?raw';
import veraVd from '../../../fixtures/workday/jr6-verawholehealth-voluntary-disclosures.html?raw';
import brookVd from '../../../fixtures/workday/jr6-brookfield-voluntary-disclosures.html?raw';
import verilyVd from '../../../fixtures/workday/jr6-verily-voluntary-disclosures.html?raw';
import parsonsVd from '../../../fixtures/workday/jr6-parsons-voluntary-disclosures.html?raw';
import danaInfo from '../../../fixtures/workday/jr6-danafarber-my-information.html?raw';
import cisiveInfo from '../../../fixtures/workday/jr6-cisive-my-information.html?raw';
import webInfo from '../../../fixtures/workday/jr6-web-my-information.html?raw';
import danaExp from '../../../fixtures/workday/jr6-danafarber-my-experience.html?raw';
import parsonsExp from '../../../fixtures/workday/jr6-parsons-my-experience.html?raw';
import travelersExp from '../../../fixtures/workday/jr6-travelers-my-experience.html?raw';
import aepCreate from '../../../fixtures/workday/jr6-aep-create-account.html?raw';
import brookSignIn from '../../../fixtures/workday/jr6-brookfield-sign-in.html?raw';
import aepAutofill from '../../../fixtures/workday/jr6-aep-autofill-resume.html?raw';
// Committed pages of the same flows.
import resolveExp from '../../../fixtures/workday/resolvetech-my-experience.html?raw';
import exelixisExp from '../../../fixtures/workday/s2-exelixis-my-experience.html?raw';
import pureExp from '../../../fixtures/workday/s2-pureinsurance-my-experience-errors.html?raw';
import verilyStudy from '../../../fixtures/workday/s2-verily-field-of-study-open.html?raw';
import danaSelf from '../../../fixtures/workday/danafarber-self-identify.html?raw';
import verilyCreate from '../../../fixtures/workday/s2-verily-create-account.html?raw';
import wdCreate from '../../../fixtures/workday/workday-create-account.html?raw';
import sfCreate from '../../../fixtures/workday/salesforce-create-account.html?raw';
import wdSignIn from '../../../fixtures/workday/workday-sign-in.html?raw';
import snapSignIn from '../../../fixtures/workday/snap-sign-in.html?raw';
import wdLanding from '../../../fixtures/workday/workday-landing.html?raw';
import wdForgot from '../../../fixtures/workday/workday-forgot-password.html?raw';
import verilyVerify from '../../../fixtures/workday/verily-sign-in-verify.html?raw';
// P2: the committed pages FIXPLAN §6.4's P2 asserts name, and the Degree list one capture shows open.
import danaVd from '../../../fixtures/workday/danafarber-voluntary-disclosures.html?raw';
import resolveSource from '../../../fixtures/workday/resolvetech-source-open.html?raw';
import aepAq2 from '../../../fixtures/workday/aep-application-questions-2.html?raw';
import webAq from '../../../fixtures/workday/web-application-questions.html?raw';
import exelixisState from '../../../fixtures/workday/s2-exelixis-state-open.html?raw';
import pureDegree from '../../../fixtures/workday/s2-pureinsurance-degree-open.html?raw';

afterEach(() => removeFixtures(document));

const load = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const byId = (doc: Document, id: string) => Array.from(doc.querySelectorAll<HTMLElement>(`[data-automation-id="${id}"]`));

/** What a jr6 page's step reads (the harness's first line per page), hand-checked against each page. */
interface Step {
  name: string;
  html: string;
  auth: 'sign-in' | 'create-account' | null;
  heading: string;
  progress: string;
  anchor: string;
  final: 'not-final' | 'unknown';
  /** Next's words, or null where it is withheld (a required date the step shows is empty) or there is none. */
  next: string | null;
  repeatables?: Array<{ kind: string; blocks: number; add: string }>;
  /** Uploads whose field shows a file Workday holds. */
  held?: boolean[];
}

const AQ = 'applyFlowPrimaryQuestionsPage';
const VD = 'applyFlowVoluntaryDisclosuresPage';
const SAVE = 'Save and Continue';
const STEPS: Step[] = [
  { name: 'jr6-gnw-application-questions', html: gnwAq, auth: null, heading: 'Application Questions', progress: 'current step 4 of 7', anchor: AQ, final: 'not-final', next: SAVE },
  // "When could you start?" is a required date, empty: Next is withheld (application.ts requiredDateEmpty).
  { name: 'jr6-parsons-application-questions', html: parsonsAq, auth: null, heading: 'Application Questions', progress: 'current step 4 of 7', anchor: AQ, final: 'not-final', next: null },
  { name: 'jr6-travelers-application-questions', html: travelersAq, auth: null, heading: 'Application Questions', progress: 'current step 4 of 6', anchor: AQ, final: 'not-final', next: SAVE },
  { name: 'jr6-verily-application-questions', html: verilyAq, auth: null, heading: 'Application Questions', progress: 'current step 4 of 7', anchor: AQ, final: 'not-final', next: SAVE },
  { name: 'jr6-cisive-application-questions', html: cisiveAq, auth: null, heading: 'Application Questions', progress: 'current step 4 of 7', anchor: AQ, final: 'not-final', next: SAVE },
  { name: 'jr6-danafarber-application-questions-1', html: danaAq1, auth: null, heading: 'Application Questions 1 of 2', progress: 'current step 4 of 8', anchor: AQ, final: 'not-final', next: SAVE },
  { name: 'jr6-danafarber-application-questions-2', html: danaAq2, auth: null, heading: 'Application Questions 2 of 2', progress: 'current step 5 of 8', anchor: 'applyFlowSupplementaryQuestionsPage', final: 'not-final', next: SAVE },
  { name: 'jr6-resolvetech-voluntary-disclosures', html: resolveVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 4 of 6', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-cisive-voluntary-disclosures', html: cisiveVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-web-voluntary-disclosures', html: webVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-gnw-voluntary-disclosures', html: gnwVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-travelers-voluntary-disclosures', html: travelersVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 6', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-aep-voluntary-disclosures', html: aepVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 6 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-verawholehealth-voluntary-disclosures', html: veraVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 6', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-brookfield-voluntary-disclosures', html: brookVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 6', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-verily-voluntary-disclosures', html: verilyVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-parsons-voluntary-disclosures', html: parsonsVd, auth: null, heading: 'Voluntary Disclosures', progress: 'current step 5 of 7', anchor: VD, final: 'not-final', next: SAVE },
  { name: 'jr6-danafarber-my-information', html: danaInfo, auth: null, heading: 'My Information', progress: 'current step 2 of 8', anchor: 'applyFlowMyInfoPage', final: 'not-final', next: SAVE },
  { name: 'jr6-cisive-my-information', html: cisiveInfo, auth: null, heading: 'My Information', progress: 'current step 2 of 7', anchor: 'applyFlowMyInfoPage', final: 'not-final', next: SAVE },
  { name: 'jr6-web-my-information', html: webInfo, auth: null, heading: 'My Information', progress: 'current step 2 of 7', anchor: 'applyFlowMyInfoPage', final: 'not-final', next: SAVE },
  { name: 'jr6-danafarber-my-experience', html: danaExp, auth: null, heading: 'My Experience', progress: 'current step 3 of 8', anchor: 'applyFlowMyExpPage', final: 'not-final', next: SAVE,
    repeatables: [{ kind: 'education', blocks: 1, add: 'Add Another' }], held: [true] },
  // Required dates empty in its jobs: Next withheld. jr6 WD-20: its "Education (Completed Degrees Only)" is Education.
  { name: 'jr6-parsons-my-experience', html: parsonsExp, auth: null, heading: 'My Experience', progress: 'current step 3 of 7', anchor: 'applyFlowMyExpPage', final: 'not-final', next: null,
    repeatables: [{ kind: 'experience', blocks: 3, add: 'Add Another' }, { kind: 'education', blocks: 1, add: 'Add Another' }], held: [true] },
  { name: 'jr6-travelers-my-experience', html: travelersExp, auth: null, heading: 'My Experience', progress: 'current step 3 of 6', anchor: 'applyFlowMyExpPage', final: 'not-final', next: null,
    repeatables: [{ kind: 'experience', blocks: 3, add: 'Add Another' }, { kind: 'education', blocks: 1, add: 'Add Another' }], held: [true] },
  { name: 'jr6-aep-create-account', html: aepCreate, auth: 'create-account', heading: 'Create Account/Sign In', progress: 'current step 1 of 8', anchor: 'signInContent', final: 'unknown', next: null },
  { name: 'jr6-brookfield-sign-in', html: brookSignIn, auth: 'sign-in', heading: 'Create Account/Sign In', progress: 'current step 1 of 7', anchor: 'signInContent', final: 'unknown', next: null },
  { name: 'jr6-aep-autofill-resume', html: aepAutofill, auth: null, heading: 'Autofill with Resume', progress: 'current step 1 of 7', anchor: 'applyFlowAutoFillPage', final: 'not-final', next: 'Continue' },
];

describe('jr6 WORKDAY: every jr6 page’s step, as the adapter reads it', () => {
  it('holds the 26 jr6 cases, every page the jr6 hooks were written from', () => {
    expect(new Set(STEPS.map((step) => step.name)).size).toBe(26);
    expect(STEPS.map((step) => `fixtures/workday/${step.name}.html`).sort()).toEqual([...WORKDAY_JR6_SNAPSHOTS].sort());
  });

  it.each(STEPS)('$name', async (step) => {
    const { doc } = await load(step.html);
    const found = workdayAdapter.detect(doc);
    expect(found).not.toBeNull();
    const root = found!.formRoot;
    expect(workdayAdapter.authState!(doc)).toBe(step.auth);
    expect(detectPause(doc, root, workdayAdapter)?.kind ?? null).toBe(step.auth);
    expect(workdayAdapter.stepSignature!(doc)).toEqual({ heading: step.heading, progress: step.progress, anchors: [step.anchor] });
    expect(workdayAdapter.isFinalStep!(doc)).toBe(step.final);
    const next = workdayAdapter.nextButton!(root);
    expect(next === null ? null : words(next)).toBe(step.next);
    expect(workdayAdapter.submitButton!(root)).toBeNull();
    expect(workdayAdapter.entryControl!(doc)).toBeNull();
    expect(workdayAdapter.repeatables!(root).map((section) => ({ kind: section.kind, blocks: section.blocks().length,
      add: words(section.addButton()) }))).toEqual(step.repeatables ?? []);
    expect((workdayAdapter.uploadWidgets!(root)).map((upload) => workdayAdapter.uploadHeld!(upload.input)))
      .toEqual(step.held ?? []);
    // The scan reads the step without a fault (P2 asserts what the planner makes of it).
    expect(scan(root, workdayAdapter, { platform: 'workday' }).fields.length).toBeGreaterThanOrEqual(step.auth === null ? 0 : 1);
  });
});

/** Create Account's form on a page. */
async function createForm(html: string) {
  const fixture = await load(html);
  const form = workdayAdapter.signInForm!(fixture.doc, 'create-account');
  expect(form).not.toBeNull();
  return { doc: fixture.doc, form: form! };
}

describe('jr6 WD-02: Create Account’s own password rules (passwordRules)', () => {
  const EVERY_TENANT = { minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] };

  it.each([['workday-create-account', wdCreate], ['salesforce-create-account', sfCreate],
    ['s2-verily-create-account', verilyCreate], ['jr6-aep-create-account', aepCreate]])(
    '%s: a minimum of 8, and an upper, a lower, a digit, a special and a letter', async (_name, html) => {
      const { form } = await createForm(html);
      expect(workdayAdapter.passwordRules!(form)).toEqual(EVERY_TENANT);
    });

  it('reads none on the Sign In form, nor where the list is gone', async () => {
    const signIn = await load(wdSignIn);
    expect(workdayAdapter.passwordRules!(workdayAdapter.signInForm!(signIn.doc, 'sign-in')!)).toBeNull();
    removeFixtures(document);
    const { doc, form } = await createForm(wdCreate);
    byId(doc, 'passwordRulesList').forEach((list) => list.remove());
    expect(workdayAdapter.passwordRules!(form)).toBeNull();
  });

  it('fails open on a page in another language, or a list of words it does not know', async () => {
    const { doc, form } = await createForm(wdCreate);
    doc.documentElement.setAttribute('lang', 'fr-FR');
    expect(workdayAdapter.passwordRules!(form)).toBeNull();
    doc.documentElement.setAttribute('lang', 'en-US');
    for (const item of Array.from(doc.querySelectorAll('[data-automation-id="passwordRulesList"] li'))) {
      item.textContent = 'Un caractère spécial';
    }
    expect(workdayAdapter.passwordRules!(form)).toBeNull();
  });

  it('leaves out a rule it does not know or a person cannot see, and takes the largest minimum', async () => {
    const { doc, form } = await createForm(wdCreate);
    const items = Array.from(doc.querySelectorAll<HTMLElement>('[data-automation-id="passwordRulesList"] li'));
    const item = (text: string) => items.find((each) => words(each) === text)!;
    item('A special character').textContent = 'Not the same as your email';
    item('An uppercase character').style.display = 'none';
    item('A minimum of 8 characters').textContent = 'A minimum of 12 characters.';
    const extra = doc.createElement('li');
    extra.textContent = 'A minimum of 10 characters';
    items[0]!.parentElement!.append(extra);
    expect(workdayAdapter.passwordRules!(form)).toEqual({ minLength: 12, requires: ['lower', 'digit', 'alpha'] });
  });
});

describe('jr6 WD-03: the Sign In view’s Create Account link (createAccountSwitch), never pressed', () => {
  it.each([['workday-sign-in', wdSignIn], ['jr6-brookfield-sign-in', brookSignIn], ['snap-sign-in', snapSignIn],
    ['verily-sign-in-verify', verilyVerify]])('%s: the link, which neverPress still names', async (_name, html) => {
    const { doc } = await load(html);
    const link = workdayAdapter.createAccountSwitch!(doc);
    expect(link).toBe(byId(doc, 'createAccountLink')[0]);
    expect(link?.localName).toBe('button');
    expect(words(link)).toBe('Create Account');
    expect(workdayAdapter.neverPress!(doc.body)).toContain(link);
  });

  it.each([['workday-landing (before "Sign in with email")', wdLanding], ['workday-create-account', wdCreate],
    ['salesforce-create-account', sfCreate], ['s2-verily-create-account', verilyCreate],
    ['jr6-aep-create-account', aepCreate], ['workday-forgot-password', wdForgot]])('%s: none', async (_name, html) => {
    const { doc } = await load(html);
    expect(workdayAdapter.createAccountSwitch!(doc)).toBeNull();
  });

  it('none while the link is hidden', async () => {
    const { doc } = await load(wdSignIn);
    byId(doc, 'createAccountLink')[0]!.style.display = 'none';
    expect(workdayAdapter.createAccountSwitch!(doc)).toBeNull();
  });
});

describe('jr6 WD-05: the kind of the account error above the form (accountErrorKind)', () => {
  /** verily's Sign In with its error, the error's words set to `text` (made-up words in Workday's way) where given. */
  async function verilyError(text?: string) {
    const { doc } = await load(verilyVerify);
    const form = doc.querySelector('form[data-automation-id="signInFormo"]')!;
    const errors = workdayAdapter.errors!(form).map((each) => each.el);
    const alert = byId(doc, 'errorMessage')[0]!;
    expect(errors).toEqual([alert]);
    if (text !== undefined) alert.textContent = text;
    return { doc, alert };
  }

  it("verily-sign-in-verify: Workday's own error is verify-email", async () => {
    const { alert } = await verilyError();
    expect(workdayAdapter.accountErrorKind!(alert)).toBe('verify-email');
  });

  it.each([
    ['Please reset your password before you sign in.', 'reset-password'],
    ['Your administrator has requested a password reset.', 'reset-password'],
    ['Wrong email address or password. Your account might be locked.', 'wrong-credentials'],
    ['The email or password is incorrect.', 'wrong-credentials'],
    ['Please verify your email address first.', 'verify-email'],
    ['Something went wrong. Try again later.', null],
  ] as const)('"%s": %s', async (text, kind) => {
    const { alert } = await verilyError(text);
    expect(workdayAdapter.accountErrorKind!(alert)).toBe(kind);
  });

  it('reads the error from a part of it, and none from an element that is no account error', async () => {
    const { doc, alert } = await verilyError();
    const part = doc.createElement('span');
    part.textContent = ' (code 1)';
    alert.append(part);
    expect(workdayAdapter.accountErrorKind!(part)).toBe('verify-email');
    expect(workdayAdapter.accountErrorKind!(doc.querySelector('input[data-automation-id="email"]')!)).toBeNull();
    const outside = doc.createElement('div');
    outside.setAttribute('data-automation-id', 'errorMessage');
    outside.textContent = 'Verify your account before you sign in.';
    doc.body.append(outside);
    expect(workdayAdapter.accountErrorKind!(outside)).toBeNull();
  });
});

/** The sections of a My Experience page, each block's Delete as removeButton answers it ('Delete', or null). */
async function deletesOf(html: string) {
  const { doc } = await load(html);
  const root = workdayAdapter.detect(doc)!.formRoot;
  const never = workdayAdapter.neverPress!(doc.body);
  return workdayAdapter.repeatables!(root).map((section) => ({ kind: section.kind,
    deletes: section.blocks().map((block) => {
      const button = section.removeButton!(block);
      if (button !== null) expect(never, `${section.kind}'s Delete stays never pressed`).toContain(button);
      return button === null ? null : words(button);
    }) }));
}

describe('jr6 WD-07: each block’s own Delete (removeButton), still never pressed', () => {
  it('s2-exelixis-my-experience: four jobs and the second school; the first school shows none', async () => {
    expect(await deletesOf(exelixisExp)).toEqual([{ kind: 'experience', deletes: ['Delete', 'Delete', 'Delete', 'Delete'] },
      { kind: 'education', deletes: [null, 'Delete'] }]);
  });

  it('s2-pureinsurance-my-experience-errors: the first job shows none', async () => {
    expect(await deletesOf(pureExp)).toEqual([{ kind: 'experience', deletes: [null, 'Delete', 'Delete', 'Delete'] },
      { kind: 'education', deletes: ['Delete'] }]);
  });

  it.each([['jr6-parsons-my-experience', parsonsExp], ['jr6-travelers-my-experience', travelersExp]])(
    '%s: three jobs and a school', async (_name, html) => {
      expect(await deletesOf(html)).toEqual([{ kind: 'experience', deletes: ['Delete', 'Delete', 'Delete'] },
        { kind: 'education', deletes: ['Delete'] }]);
    });

  it('none while the Delete is hidden', async () => {
    const { doc } = await load(exelixisExp);
    const section = workdayAdapter.repeatables!(workdayAdapter.detect(doc)!.formRoot)[0]!;
    const block = section.blocks()[1]!;
    section.removeButton!(block)!.style.display = 'none';
    expect(section.removeButton!(block)).toBeNull();
  });
});

describe('jr6 WD-18: Skills declared a box of several answers (tags)', () => {
  /** The prompts of a page by their field's automation id, each with its tags declaration. */
  async function promptsOf(html: string) {
    const { doc } = await load(html);
    return Array.from(doc.querySelectorAll('[data-automation-id="multiSelectContainer"] input')).map((input) => ({
      field: input.closest('[data-automation-id^="formField-"]')?.getAttribute('data-automation-id') ?? '',
      tags: workdayAdapter.widgetFor!(input)?.tags ?? null,
    }));
  }

  it.each([['resolvetech-my-experience', resolveExp, 0], ['s2-exelixis-my-experience', exelixisExp, 0],
    ['jr6-danafarber-my-experience', danaExp, 15], ['jr6-parsons-my-experience', parsonsExp, 15]] as const)(
    '%s: its Skills prompt alone, a search, the cap, its pills the chips (%i)', async (_name, html, pills) => {
      const prompts = await promptsOf(html);
      const skills = prompts.filter((prompt) => prompt.field === 'formField-skills');
      expect(skills).toHaveLength(1);
      expect(skills[0]!.tags?.search).toBe(true);
      expect(skills[0]!.tags?.cap).toBe(WORKDAY_SKILLS_CAP);
      expect(skills[0]!.tags!.chips()).toHaveLength(pills);
      expect(prompts.filter((prompt) => prompt.field !== 'formField-skills').every((prompt) => prompt.tags === null)).toBe(true);
      expect(prompts.length).toBeGreaterThan(1);
    });

  it('declares no other prompt so (Field of Study)', async () => {
    const prompts = await promptsOf(verilyStudy);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((prompt) => prompt.tags === null)).toBe(true);
  });
});

describe('jr6 WD-20: an Education section by any of its names', () => {
  /** Every id and aria-labelledby of a section and its blocks renamed from `from` to `to`. */
  function rename(doc: Document, from: string, to: string) {
    for (const el of Array.from(doc.querySelectorAll(`[id^="${from}-"], [aria-labelledby^="${from}-"]`))) {
      for (const attribute of ['id', 'aria-labelledby']) {
        const value = el.getAttribute(attribute);
        if (value !== null && value.startsWith(`${from}-`)) el.setAttribute(attribute, `${to}${value.slice(from.length)}`);
      }
    }
  }

  const kindsOf = (doc: Document) => workdayAdapter.repeatables!(workdayAdapter.detect(doc)!.formRoot)
    .map((section) => `${section.kind}:${section.blocks().length}`);

  it('jr6-parsons-my-experience: "Education (Completed Degrees Only)" is the Education section, its block its own', async () => {
    const { doc } = await load(parsonsExp);
    expect(kindsOf(doc)).toEqual(['experience:3', 'education:1']);
  });

  it.each(['Schools-Attended', 'Schooling', 'Academic-Experience', 'Educational-Background', 'Education-History'])(
    'reads a section named %s as Education', async (name) => {
      const { doc } = await load(resolveExp);
      rename(doc, 'Education', name);
      expect(kindsOf(doc)).toEqual(['experience:1', 'education:1']);
    });

  it('reads no other section as Education (Languages, Certifications, Skills)', async () => {
    const { doc } = await load(resolveExp);
    rename(doc, 'Education', 'Certifications');
    expect(kindsOf(doc)).toEqual(['experience:1']);
  });
});

/** A step planned with the golden synthetic profile and DEFAULT_SETTINGS (the auditor's harness, its plan): each
 *  field's spec and its row. */
async function planned(html: string, company: string): Promise<{ specs: FieldSpec[]; plan: PlanOutput }> {
  const { doc } = await load(html);
  const root = workdayAdapter.detect(doc)!.formRoot;
  const specs = scan(root, workdayAdapter, { platform: 'workday' }).fields.map(toFieldSpec);
  const kinds = (workdayAdapter.repeatables!(root)).map((section) => section.kind);
  const plan = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW, posting: { company, location: 'Austin, TX, USA' },
    ...(kinds.length > 0 ? { repeatables: kinds.map((kind) => ({ kind, entries: null })) } : {}) });
  return { specs, plan };
}

const categoryOf = (specs: FieldSpec[], plan: PlanOutput, label: string) => {
  const spec = specs.find((each) => each.label === label);
  expect(spec, label).toBeDefined();
  return plan.results.find((row) => row.key === spec!.key)?.category ?? null;
};

describe('jr6 WD-10 and workday-new-1: Self Identify’s labels, as the planner reads them', () => {
  it('danafarber-self-identify: the disability boxes read as the disability question; Name, Employee ID and the date '
    + 'no longer do', async () => {
    const { specs, plan } = await planned(danaSelf, 'Dana-Farber Cancer Institute');
    expect(specs.map((spec) => spec.label)).toEqual(['Language of this form', 'Name', 'Employee ID (if applicable)',
      'Date signed', 'Voluntary Self-Identification of Disability']);
    expect(categoryOf(specs, plan, 'Voluntary Self-Identification of Disability')).toBe('eeo.disability');
    for (const label of ['Name', 'Employee ID (if applicable)', 'Date signed', 'Language of this form']) {
      expect(categoryOf(specs, plan, label), label).not.toBe('eeo.disability');
    }
  });
});

describe('jr6 WD-20: the planner assigns the parsons Education block', () => {
  it('jr6-parsons-my-experience: an education request beside the experience one', async () => {
    const { plan } = await planned(parsonsExp, 'Parsons');
    expect((plan.repeatables ?? []).map((each) => each.kind)).toEqual(['experience', 'education']);
  });
});

// ── jr6 WORKDAY P2 (FIXPLAN §6.4 "P2 asserts"): what the merged ENGINE and RULES make of the pages ──────────────────

/** A capture taken filled set back to the step before the person's answers (the jr6 auditor's harness, its
 *  `unanswer`): each dropdown's chosen answer (redacted by the converter) back to "Select One", as Workday draws an
 *  empty one, and each prompt's pills (redacted) taken away. */
function unanswer(doc: Document): void {
  for (const button of Array.from(doc.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'))) {
    if ((button.getAttribute('value') ?? '') === '') continue;
    const field = button.closest('[data-automation-id^="formField-"]');
    const label = words(field?.querySelector('label, legend')).replace(/\*/g, '').trim();
    const star = (field?.querySelector('label abbr, legend abbr') ?? null) !== null;
    button.setAttribute('value', '');
    button.textContent = 'Select One';
    button.setAttribute('aria-label', `${label} Select One${star ? ' Required' : ''}`);
  }
  for (const pill of Array.from(doc.querySelectorAll('[data-automation-id="selectedItem"]'))) {
    (pill.closest('li') ?? pill).remove();
  }
}

/** Lists no capture shows open: the words Workday tenants commonly use (the jr6 auditor's assumed lists, kept in
 *  SP\jr6\workday-p1b), given to the closed dropdowns by their questions. Every test on one says "(assumed list)". */
const ASSUMED_LISTS = {
  yesNo: ['Yes', 'No'],
  gender: ['Male', 'Female', 'I do not wish to self-identify'],
  hispanic: ['Yes', 'No', 'I do not wish to self-identify'],
  race: ['American Indian or Alaska Native (Not Hispanic or Latino) (United States of America)',
    'Asian (Not Hispanic or Latino) (United States of America)',
    'Black or African American (Not Hispanic or Latino) (United States of America)',
    'Hispanic or Latino (United States of America)',
    'Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino) (United States of America)',
    'Two or More Races (Not Hispanic or Latino) (United States of America)',
    'White (Not Hispanic or Latino) (United States of America)', 'I do not wish to self-identify'],
  veteran: ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran',
    'I do not wish to self-identify'],
  formLanguage: ['English', 'Español'],
} as const;

/** The assumed list a closed dropdown gets by its question; none for any other (it stays waiting for its options). */
function assumedList(label: string): readonly string[] | null {
  if (/^language of this form$/i.test(label)) return ASSUMED_LISTS.formLanguage;
  if (/\bgender\b/i.test(label)) return ASSUMED_LISTS.gender;
  if (/\bhispanic\b/i.test(label)) return ASSUMED_LISTS.hispanic;
  if (/\bethnic|\brace\b/i.test(label)) return ASSUMED_LISTS.race;
  if (/\bveterans?\b/i.test(label)) return ASSUMED_LISTS.veteran;
  // A question asked yes or no, its question mark or not (Genworth's relationship question has none).
  if (/^(?:are|do|does|have|has|will|is|can|did|would|were|if)\b/i.test(label)) return ASSUMED_LISTS.yesNo;
  return null;
}

/** The golden profile with the jr6 auditor's "+profile" screening answers, each one the golden profile leaves open: no
 *  restrictive agreement, no military or government service, no relatives at any company, no clearance. */
function screened(): Profile {
  const golden = goldenProfile();
  return { ...golden, screening: { ...golden.screening, restrictiveAgreement: { kind: 'value', value: false },
    governmentService: { kind: 'value', value: { military: false, government: false } },
    relativesAt: { kind: 'value', value: [] }, clearance: { kind: 'value', value: { level: 'none' } } } };
}

/** DEFAULT_SETTINGS with other modes, and other pre-approved consents where given. */
const withModes = (modes: Partial<Settings['modes']>, preapproved?: Settings['preapprovedConsent']): Settings => ({
  ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, ...modes },
  ...(preapproved === undefined ? {} : { preapprovedConsent: [...preapproved] }) });

/** Today, as the plan writes a date (content.testkit NOW). */
const TODAY = `${NOW.y}-${String(NOW.m).padStart(2, '0')}-${String(NOW.d).padStart(2, '0')}`;

/** What the plan asks TailorIT's AI about a field: a classification, an answer, a draft, or nothing. */
function askOf(plan: PlanOutput, key: FieldSpec['key']): 'classify' | 'answer' | 'draft' | null {
  if (plan.ask?.classify.some((item) => item.key === key) === true) return 'classify';
  if (plan.ask?.answers?.some((item) => item.key === key) === true) return 'answer';
  if (plan.ask?.drafts?.some((item) => item.key === key) === true) return 'draft';
  return null;
}

interface StepOptions {
  profile?: Profile;
  settings?: Settings;
  /** A change of the page made before the scan (a variant). */
  prepare?: (doc: Document) => void;
  /** The list each closed dropdown gets by its question (assumedList unless given). */
  lists?: (label: string) => readonly string[] | null;
}

type Label = string | RegExp;
const labelled = (label: Label) => (spec: FieldSpec) => (typeof label === 'string' ? spec.label === label
  : label.test(spec.label));

/** A step planned as the run plans it (the auditor's harness, its plan): the page set back to before the person's
 *  answers, each closed dropdown read with its list (a "Select One" row first, never chosen, as Workday draws it),
 *  scanned again, then planFrame with the golden profile, the posting's company and its repeatable sections. */
async function stepPlan(html: string, company: string, options: StepOptions = {}) {
  const { doc } = await load(html);
  unanswer(doc);
  options.prepare?.(doc);
  const root = workdayAdapter.detect(doc)!.formRoot;
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of scan(root, workdayAdapter, { platform: 'workday' }).fields) {
    const labels = field.kind === 'combobox' && field.options === 'lazy' ? (options.lists ?? assumedList)(field.label)
      : null;
    if (labels === null) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: [{ label: 'Select One', disabled: true }, ...labels.map((label) => ({ label, disabled: false }))] });
  }
  const specs = scan(root, workdayAdapter, { platform: 'workday', widgetReadings: readings }).fields.map(toFieldSpec);
  const kinds = workdayAdapter.repeatables!(root).map((section) => section.kind);
  const plan = planFrame({ specs, canaries: [], profile: options.profile ?? goldenProfile(), sensitiveState: 'loaded',
    savedAnswers: [], settings: options.settings ?? DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company, location: 'Austin, TX, USA' },
    ...(kinds.length > 0 ? { repeatables: kinds.map((kind) => ({ kind, entries: null })) } : {}) });
  const specOf = (label: Label): FieldSpec => {
    const found = specs.filter(labelled(label));
    expect(found, String(label)).toHaveLength(1);
    return found[0]!;
  };
  return {
    doc, specs, plan, specOf,
    all: (label: Label): FieldSpec[] => specs.filter(labelled(label)),
    rowOf: (spec: FieldSpec): FillResult => plan.results.find((row) => row.key === spec.key)!,
    writeOf: (spec: FieldSpec): PlannedWrite | undefined => plan.writes.find((write) => write.key === spec.key),
    row: (label: Label): FillResult => plan.results.find((row) => row.key === specOf(label).key)!,
    write: (label: Label): PlannedWrite | undefined => plan.writes.find((write) => write.key === specOf(label).key),
    ask: (label: Label) => askOf(plan, specOf(label).key),
  };
}

const optionOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'option' ? write.value.cleanLabel
  : undefined);
const optionsOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'options' ? write.value.cleanLabels
  : undefined);
const textOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'text' ? write.value.text : undefined);
const ruleOf = (write: PlannedWrite | undefined) => (write?.origin.provenance === 'rule' ? write.origin.ruleId
  : undefined);

describe('jr6 WD-08 (RULES item 1): the race or ethnicity question answered from the profile (golden: declined)', () => {
  const DROPDOWNS: Array<[string, string, string, Label]> = [
    ['jr6-gnw-voluntary-disclosures', gnwVd, 'Genworth',
      'Please select the ethnicity which most accurately describes how you identify yourself.'],
    ['jr6-resolvetech-voluntary-disclosures', resolveVd, 'Resolve Tech Solutions',
      'Please select the ethnicity which most accurately describes how you identify yourself.'],
    ['jr6-travelers-voluntary-disclosures', travelersVd, 'Travelers',
      'Please select the race/ethnicity that best applies to you'],
  ];
  it.each(DROPDOWNS)('%s: its dropdown takes its list’s decline (assumed list)', async (_name, html, company, label) => {
    const step = await stepPlan(html, company);
    expect(step.row(label)).toMatchObject({ kind: 'combobox', category: 'eeo.race', needsUserAction: false });
    expect(optionOf(step.write(label))).toBe('I do not wish to self-identify');
    expect(ruleOf(step.write(label))).toBe('eeo.decline');
  });

  const GROUPS: Array<[string, string, string, Label, string]> = [
    ['jr6-cisive-voluntary-disclosures', cisiveVd, 'Cisive',
      /^Please select the ethnicity witch most accurately describe\(s\) how you identify yourself/,
      'I do not wish to answer. (United States of America)'],
    ['jr6-verawholehealth-voluntary-disclosures', veraVd, 'Vera Whole Health',
      /^Please select the ethnicity which most accurately describes how you identify yourself/,
      'Decline to State (United States of America)'],
    ['danafarber-voluntary-disclosures', danaVd, 'Dana-Farber Cancer Institute',
      'If you identify with one or more ethnic groups please choose from the list below.',
      'I do not wish to answer (United States of America)'],
  ];
  it.each(GROUPS)('%s: its boxes tick the page’s own decline alone', async (_name, html, company, label, decline) => {
    const step = await stepPlan(html, company);
    expect(step.row(label)).toMatchObject({ kind: 'checkbox-group', category: 'eeo.race', needsUserAction: false });
    expect(optionsOf(step.write(label))).toEqual([decline]);
    expect(ruleOf(step.write(label))).toBe('eeo.decline');
  });
});

describe('jr6 WD-09 (RULES item 2): the terms box Workday names acceptTermsAndAgreements, ticked', () => {
  const CASES: Array<[string, string, string, string]> = [
    ['jr6-resolvetech-voluntary-disclosures', resolveVd, 'Resolve Tech Solutions', 'Please confirm your consent.'],
    ['jr6-travelers-voluntary-disclosures', travelersVd, 'Travelers', 'You must AGREE to proceed.'],
  ];
  it.each(CASES)('%s: ticked under Consents: All, and under Consents: Required only (it is required)',
    async (_name, html, company, label) => {
      // Under Required only the terms stay pre-approved by default (DEFAULT_PREAPPROVED_CONSENT); where the person took
      // them off that list, the box is ticked because the page requires it.
      const noTerms = DEFAULT_SETTINGS.preapprovedConsent.filter((consent) => consent !== 'terms');
      for (const [settings, rule] of [[DEFAULT_SETTINGS, 'consent.preapproved'],
        [withModes({ consents: 'required' }), 'consent.preapproved'],
        [withModes({ consents: 'required' }, noTerms), 'consent.required']] as const) {
        const step = await stepPlan(html, company, { settings });
        expect(step.specOf(label).required).toBe(true);
        expect(step.row(label)).toMatchObject({ kind: 'checkbox', category: 'consent.terms', needsUserAction: false });
        expect(step.write(label)?.value).toEqual({ kind: 'check' });
        expect(ruleOf(step.write(label))).toBe(rule);
        removeFixtures(document);
      }
    });
});

describe('jr6 WD-10 and workday-new-1 (RULES item 5): Self Identify planned from its labels', () => {
  const DISABILITY = 'Voluntary Self-Identification of Disability';
  const DANA = 'Dana-Farber Cancer Institute';

  /** The step as other tenants draw it (FIXPLAN §6.4, "the four required stars"): Workday's star on Name, Date signed
   *  and the disability boxes too (Language of this form shows it already), their controls aria-required. */
  function fourStars(doc: Document): void {
    for (const id of ['formField-name', 'formField-dateSignedOn', 'formField-disabilityStatus']) {
      const field = byId(doc, id)[0]!;
      const label = field.querySelector('label')!;
      const star = doc.createElement('abbr');
      star.setAttribute('aria-hidden', 'true');
      star.textContent = '*';
      (label.querySelector('span') ?? label).append(star);
      for (const control of Array.from(field.querySelectorAll('input, fieldset'))) {
        control.setAttribute('aria-required', 'true');
      }
    }
  }

  it('danafarber-self-identify: the form’s language English (assumed list), the name, no employee ID, signed today, '
    + 'the disability declined', async () => {
    const step = await stepPlan(danaSelf, DANA);
    expect(step.row('Language of this form')).toMatchObject({ category: 'languages.formLanguage',
      needsUserAction: false });
    expect(optionOf(step.write('Language of this form'))).toBe('English');
    expect(ruleOf(step.write('Language of this form'))).toBe('form.language');
    expect(step.row('Name')).toMatchObject({ category: 'identity.fullName', needsUserAction: false });
    expect(textOf(step.write('Name'))).toBe('Alex Rivera');
    // Employee ID: skipped, never asked of an AI.
    expect(step.row('Employee ID (if applicable)')).toMatchObject({ category: 'identity.employeeId', status: 'skipped',
      reason: 'no-profile-value', needsUserAction: false });
    expect(step.write('Employee ID (if applicable)')).toBeUndefined();
    expect(step.ask('Employee ID (if applicable)')).toBeNull();
    // Date signed: today, on the signature's terms (pre-approved under the default Consents: All).
    expect(step.row('Date signed')).toMatchObject({ category: 'consent.signatureDate', needsUserAction: false });
    expect(step.write('Date signed')?.value).toEqual({ kind: 'date', iso: TODAY });
    expect(ruleOf(step.write('Date signed'))).toBe('consent.signature-date');
    // The disability boxes: the golden profile declines, so "I do not want to answer" alone.
    expect(step.row(DISABILITY)).toMatchObject({ kind: 'checkbox-group', category: 'eeo.disability',
      needsUserAction: false });
    expect(optionsOf(step.write(DISABILITY))).toEqual(['I do not want to answer']);
    expect(ruleOf(step.write(DISABILITY))).toBe('eeo.decline');
    // Nothing on the step waits for the AI.
    expect(step.plan.awaiting).toEqual([]);
  });

  it('ticks the disability box the profile’s own answer names (a variant of the golden profile)', async () => {
    const golden = goldenProfile();
    for (const [disabled, box] of [[false, 'No, I do not have a disability and have not had one in the past'],
      [true, 'Yes, I have a disability, or have had one in the past']] as const) {
      const step = await stepPlan(danaSelf, DANA, { profile: { ...golden,
        eeo: { ...golden.eeo, disability: { kind: 'value', value: disabled } } } });
      expect(optionsOf(step.write(DISABILITY))).toEqual([box]);
      expect(step.write(DISABILITY)?.origin).toMatchObject({ provenance: 'profile', path: 'eeo.disability' });
      removeFixtures(document);
    }
  });

  it('the same with the four required stars: each of the four required, the plan unchanged', async () => {
    const step = await stepPlan(danaSelf, DANA, { prepare: fourStars });
    expect(step.specs.map((spec) => [spec.label, spec.required])).toEqual([['Language of this form', true],
      ['Name', true], ['Employee ID (if applicable)', false], ['Date signed', true], [DISABILITY, true]]);
    expect(optionOf(step.write('Language of this form'))).toBe('English');
    expect(textOf(step.write('Name'))).toBe('Alex Rivera');
    expect(step.write('Employee ID (if applicable)')).toBeUndefined();
    expect(step.write('Date signed')?.value).toEqual({ kind: 'date', iso: TODAY });
    expect(optionsOf(step.write(DISABILITY))).toEqual(['I do not want to answer']);
    expect(step.plan.results.filter((row) => row.needsUserAction)).toEqual([]);
  });

  it('dates the signature only on its approval: signatures not pre-approved under Consents: Required only, the date '
    + 'is written only where it is required', async () => {
    const strict = withModes({ consents: 'required' },
      DEFAULT_SETTINGS.preapprovedConsent.filter((consent) => consent !== 'signature'));
    const optional = await stepPlan(danaSelf, DANA, { settings: strict });
    expect(optional.write('Date signed')).toBeUndefined();
    expect(optional.row('Date signed')).toMatchObject({ category: 'consent.signatureDate', status: 'skipped',
      reason: 'consent-optional-unticked' });
    removeFixtures(document);
    const required = await stepPlan(danaSelf, DANA, { settings: strict, prepare: fourStars });
    expect(required.write('Date signed')?.value).toEqual({ kind: 'date', iso: TODAY });
    expect(ruleOf(required.write('Date signed'))).toBe('consent.required');
  });
});

describe('jr6 WD-11 (RULES item 35): gender and veteran status answered from the profile (assumed lists)', () => {
  it('danafarber-voluntary-disclosures: "Please select a gender." declined; the protected veterans question "not a '
    + 'protected veteran"', async () => {
    const step = await stepPlan(danaVd, 'Dana-Farber Cancer Institute');
    expect(step.row('Please select a gender.')).toMatchObject({ category: 'eeo.gender', needsUserAction: false });
    expect(optionOf(step.write('Please select a gender.'))).toBe('I do not wish to self-identify');
    const VETERANS = /^If you believe you belong to any of the categories of protected veterans listed below/;
    expect(step.row(VETERANS)).toMatchObject({ category: 'eeo.veteran', needsUserAction: false });
    expect(optionOf(step.write(VETERANS))).toBe('I am not a protected veteran');
    expect(step.write(VETERANS)?.origin).toMatchObject({ provenance: 'profile', path: 'eeo.veteran' });
  });

  it('jr6-web-voluntary-disclosures: "Veterans Status" and "Gender"', async () => {
    const step = await stepPlan(webVd, 'Newfold Digital');
    expect(step.row('Veterans Status')).toMatchObject({ category: 'eeo.veteran', needsUserAction: false });
    expect(optionOf(step.write('Veterans Status'))).toBe('I am not a protected veteran');
    expect(step.row('Gender')).toMatchObject({ category: 'eeo.gender', needsUserAction: false });
    expect(optionOf(step.write('Gender'))).toBe('I do not wish to self-identify');
  });
});

describe('jr6 WD-12 and WD-13 (RULES items 36 and 3): yes/no questions the profile answers (assumed lists)', () => {
  it('jr6-verily-application-questions: the age of majority is the over-18 question: Yes', async () => {
    const step = await stepPlan(verilyAq, 'Verily');
    const MAJORITY = /^Are you at least the age of majority under applicable law/;
    expect(step.row(MAJORITY)).toMatchObject({ category: 'screening.over18', needsUserAction: false });
    expect(optionOf(step.write(MAJORITY))).toBe('Yes');
    expect(step.write(MAJORITY)?.origin).toMatchObject({ provenance: 'profile', path: 'screening.over18' });
  });

  it('jr6-travelers-application-questions: an employer’s support for a visa is sponsorship: No', async () => {
    const step = await stepPlan(travelersAq, 'Travelers');
    const SUPPORT = /^Will you now or in the future require support from an employer to obtain\/extend a work visa/;
    expect(step.row(SUPPORT)).toMatchObject({ category: 'workAuth.sponsorship', needsUserAction: false });
    expect(optionOf(step.write(SUPPORT))).toBe('No');
    expect(step.write(SUPPORT)?.origin).toMatchObject({ provenance: 'profile' });
    // workday-new-2's other half (RULES item 4): "Are you currently employed by Travelers" stays the posting's own.
    const EMPLOYED = /^Are you currently employed by Travelers/;
    expect(step.row(EMPLOYED)).toMatchObject({ category: 'screening.previouslyEmployed', needsUserAction: false });
    expect(optionOf(step.write(EMPLOYED))).toBe('No');
  });
});

describe('jr6 WD-14, WD-15 and WD-17 on Genworth’s Application Questions (RULES items 37, 38, 40; assumed lists)',
  () => {
    const AGREEMENT = /^Do you have an agreement in place with a current or former employer that would prevent/;
    const RELATIONSHIP = /^Do you have a familial or personal relationship with any current Genworth employee/;
    const KPMG = 'Have you or your spouse previously worked for KPMG?';

    it('golden profile (no screening answers): the agreement and the relationship are read as theirs, the spouse '
      + 'question stays the person’s', async () => {
      const step = await stepPlan(gnwAq, 'Genworth');
      expect(step.row(AGREEMENT)).toMatchObject({ category: 'screening.restrictiveAgreement',
        reason: 'legal-not-in-profile' });
      expect(step.write(AGREEMENT)).toBeUndefined();
      // A restrictive agreement the profile leaves open is asked of the AI under the default AI scope, all (RULES
      // item 20).
      expect(step.ask(AGREEMENT)).toBe('answer');
      expect(step.row(RELATIONSHIP)).toMatchObject({ category: 'screening.relatives', reason: 'legal-not-in-profile' });
      expect(step.write(RELATIONSHIP)).toBeUndefined();
      // Its "(Relatives include spouse, …)" names other people: never sent to an AI (RULES' open issue 12).
      expect(step.ask(RELATIONSHIP)).toBeNull();
      // WD-17: "or your spouse" is another person's employment: left for the person, never answered by a rule or AI.
      expect(step.row(KPMG)).toMatchObject({ category: 'screening.previouslyEmployed', needsUserAction: true });
      expect(step.write(KPMG)).toBeUndefined();
      expect(step.ask(KPMG)).toBeNull();
    });

    it('with the screening answers: no agreement, no relatives: No to both', async () => {
      const step = await stepPlan(gnwAq, 'Genworth', { profile: screened() });
      expect(optionOf(step.write(AGREEMENT))).toBe('No');
      expect(step.write(AGREEMENT)?.origin).toMatchObject({ provenance: 'profile',
        path: 'screening.restrictiveAgreement' });
      expect(optionOf(step.write(RELATIONSHIP))).toBe('No');
      expect(step.write(RELATIONSHIP)?.origin).toMatchObject({ provenance: 'profile', path: 'screening.relativesAt' });
      expect(step.write(KPMG)).toBeUndefined();
    });
  });

describe('jr6 WD-15 and workday-new-2 on Parsons’ Application Questions (RULES items 4 and 38; owner Q14)', () => {
  const FRIEND = 'Are you a relative or close friend of a Parsons employee?';
  const VENDOR = 'Are you a relative or close friend of any Parsons customer, subcontractor or vendor?';
  const OUTSIDE = /^Are you currently the owner or employee of any outside company/;

  it('jr6-parsons-application-questions: the close-friend, customer/vendor and outside-company questions stay unread '
    + 'by the rules: classified by the AI, never a rule’s No', async () => {
    const step = await stepPlan(parsonsAq, 'Parsons', { profile: screened() });
    for (const label of [FRIEND, VENDOR, OUTSIDE]) {
      expect(step.row(label), String(label)).toMatchObject({ category: 'unknown' });
      expect(step.write(label), String(label)).toBeUndefined();
      expect(step.ask(label), String(label)).toBe('classify');
    }
  });

  it('a relative of a Parsons employee (the question without "or close friend", a variant) is the relatives question: '
    + 'No with the screening answers', async () => {
    const step = await stepPlan(parsonsAq, 'Parsons', { profile: screened(), prepare: (doc) => {
      const label = Array.from(doc.querySelectorAll('legend, label')).find((each) => words(each).startsWith(FRIEND))!;
      const text = Array.from(label.querySelectorAll('*')).concat(label).find((each) => Array.from(each.childNodes)
        .some((node) => node.nodeType === 3 && (node.textContent ?? '').includes('or close friend')))!;
      for (const node of Array.from(text.childNodes)) {
        if (node.nodeType === 3) node.textContent = (node.textContent ?? '').replace(' or close friend', '');
      }
    } });
    const RELATIVE = 'Are you a relative of a Parsons employee?';
    expect(step.row(RELATIVE)).toMatchObject({ category: 'screening.relatives', needsUserAction: false });
    expect(optionOf(step.write(RELATIVE))).toBe('No');
  });
});

describe('jr6 WD-16 (RULES item 39): a question that names the posting company by its initials', () => {
  const RTS = /^Have you previously been employed by RTS\? CURRENT EMPLOYEES/;

  it('resolvetech-source-open: "Have you previously been employed by RTS?" is Resolve Tech Solutions’ own: No, '
    + 'unflagged', async () => {
    const step = await stepPlan(resolveSource, 'Resolve Tech Solutions');
    expect(step.row(RTS)).toMatchObject({ kind: 'radio', category: 'screening.previouslyEmployed', reason: 'ok',
      needsUserAction: false });
    expect(optionOf(step.write(RTS))).toBe('No');
    expect(ruleOf(step.write(RTS))).toBe('screening.previously-employed');
  });

  it('the same initials under another posting company are not its own: not answered as the posting’s', async () => {
    const step = await stepPlan(resolveSource, 'Acme Corporation');
    expect(step.row(RTS).category).toBe('screening.previouslyEmployed');
    expect(step.row(RTS).reason).not.toBe('ok');
  });
});

describe('jr6 WD-17, WD-29 and WD-30 on AEP’s Application Questions 2 of 2 (RULES items 33, 40, 41; assumed lists)',
  () => {
    const CONTRACTOR = 'Are you now or have you ever been a contractor at AEP?';
    const OPT = 'Will you be using Optional Practical Training (OPT) or STEM OPT to begin employment at AEP?';
    const MILITARY = 'Do you have military training or a military certification related to this position?';
    const RELATIVES = 'Do you have relatives employed by American Electric Power?';

    it('golden: a contractor at AEP is the posting company’s own question: No; OPT: No (the posting’s country, '
      + 'flagged); military training asked of the AI (the all scope)', async () => {
      const step = await stepPlan(aepAq2, 'American Electric Power');
      expect(step.row(CONTRACTOR)).toMatchObject({ category: 'screening.previouslyEmployed', needsUserAction: false });
      expect(optionOf(step.write(CONTRACTOR))).toBe('No');
      expect(ruleOf(step.write(CONTRACTOR))).toBe('screening.previously-employed');
      expect(step.row(OPT)).toMatchObject({ category: 'workAuth.opt', reason: 'filled-low-confidence',
        needsUserAction: false });
      expect(optionOf(step.write(OPT))).toBe('No');
      expect(step.row(MILITARY)).toMatchObject({ category: 'screening.militaryTraining',
        reason: 'legal-not-in-profile' });
      expect(step.write(MILITARY)).toBeUndefined();
      expect(step.ask(MILITARY)).toBe('answer');
      // RULES item 20 (its moved row): relatives the profile leaves open are asked in the all scope.
      expect(step.row(RELATIVES)).toMatchObject({ category: 'screening.relatives', reason: 'legal-not-in-profile' });
      expect(step.ask(RELATIVES)).toBe('answer');
    });

    it('with the screening answers (no military service, not a veteran): military training No', async () => {
      const step = await stepPlan(aepAq2, 'American Electric Power', { profile: screened() });
      expect(optionOf(step.write(MILITARY))).toBe('No');
      expect(step.write(MILITARY)?.origin).toMatchObject({ provenance: 'profile', path: 'screening.governmentService',
        transform: 'legal.military-training' });
      expect(step.ask(MILITARY)).toBeNull();
      expect(optionOf(step.write(RELATIVES))).toBe('No');
    });
  });

describe('jr6 RULES item 20 on Workday (its moved row): a restrictive covenant asked in the all scope', () => {
  it('web-application-questions: asked of the AI while the profile leaves it open; with the screening answers, No '
    + '(assumed list)', async () => {
    const COVENANTS = /^Are you subject to any restrictive covenants from prior employment/;
    const golden = await stepPlan(webAq, 'Newfold Digital');
    expect(golden.row(COVENANTS)).toMatchObject({ category: 'screening.restrictiveAgreement',
      reason: 'legal-not-in-profile' });
    expect(golden.ask(COVENANTS)).toBe('answer');
    removeFixtures(document);
    const answered = await stepPlan(webAq, 'Newfold Digital', { profile: screened() });
    expect(optionOf(answered.write(COVENANTS))).toBe('No');
  });
});

describe('jr6 WD-25 and WD-26 (RULES items 62 and 13): a prefix and a county the profile never holds', () => {
  it.each([['resolvetech-source-open', resolveSource, 'Resolve Tech Solutions'],
    ['s2-exelixis-state-open', exelixisState, 'Exelixis'], ['jr6-web-my-information', webInfo, 'Newfold Digital']])(
    '%s: "Prefix" is the name’s prefix: skipped, never asked of an AI', async (_name, html, company) => {
      const step = await stepPlan(html, company);
      expect(step.row('Prefix')).toMatchObject({ category: 'identity.prefix', status: 'skipped',
        reason: 'no-profile-value', needsUserAction: false });
      expect(step.write('Prefix')).toBeUndefined();
      expect(step.ask('Prefix')).toBeNull();
    });

  it('jr6-danafarber-my-information: "County" is the address’s county: skipped, never asked of an AI', async () => {
    const step = await stepPlan(danaInfo, 'Dana-Farber Cancer Institute');
    expect(step.row('County')).toMatchObject({ category: 'address.county', status: 'skipped',
      reason: 'no-profile-value', needsUserAction: false });
    expect(step.write('County')).toBeUndefined();
    expect(step.ask('County')).toBeNull();
  });
});

describe('jr6 WD-27, WD-28 (RULES items 52 and 63)', () => {
  it('jr6-parsons-application-questions: "When could you start?" is the start date: asked of the AI (the golden '
    + 'profile holds none)', async () => {
    const step = await stepPlan(parsonsAq, 'Parsons');
    expect(step.row('When could you start?')).toMatchObject({ kind: 'date', category: 'availability.startDate' });
    expect(step.write('When could you start?')).toBeUndefined();
    expect(step.ask('When could you start?')).toBe('answer');
    expect(step.plan.awaiting).toContain(step.specOf('When could you start?').key);
  });

  it('jr6-danafarber-application-questions-1: the student training programme question is no skills pick', async () => {
    const step = await stepPlan(danaAq1, 'Dana-Farber Cancer Institute');
    const TRAINING = /^Have you ever, or are you currently participating in a student training program/;
    expect(step.row(TRAINING).category).not.toBe('skills.list');
    expect(step.row(TRAINING).category).toBe('unknown');
    expect(step.write(TRAINING)).toBeUndefined();
    expect(step.ask(TRAINING)).toBe('classify');
  });
});

describe('jr6 WD-07 (RULES item 6): a parsed Role Description in a block the run assigns is written from the profile',
  () => {
    /** Workday's résumé parse stood in for (made-up words): every Work Experience and Education text box and text area
     *  of My Experience holds a value, as after "Autofill with Resume" (the jr6 auditor's harness, its `parsed`). */
    function parsedText(doc: Document): void {
      let n = 0;
      for (const box of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '[data-automation-id="applyFlowMyExpPage"] [role="group"][aria-labelledby$="-panel"] input[type="text"], '
        + '[data-automation-id="applyFlowMyExpPage"] [role="group"][aria-labelledby$="-panel"] textarea'))) {
        if (box.closest('[data-automation-id="multiSelectContainer"]') !== null) continue;
        box.value = `Parsed value ${n}`;
        n += 1;
      }
    }

    it('s2-exelixis-my-experience: the two assigned jobs take their entries’ descriptions over the parse’s '
      + '(prefill-conflict); the parse’s two extra jobs are given none', async () => {
      const step = await stepPlan(exelixisExp, 'Exelixis', { prepare: parsedText });
      const roles = step.all('Role Description');
      expect(roles.map((spec) => [spec.section, spec.current.kind])).toEqual([0, 1, 2, 3].map((block) =>
        [{ id: 'experience', block }, 'text']));
      const golden = goldenProfile();
      for (const block of [0, 1]) {
        expect(step.rowOf(roles[block]!)).toMatchObject({ category: 'experience.description',
          reason: 'prefill-conflict' });
        expect(textOf(step.writeOf(roles[block]!))).toBe(golden.experience[block]!.description);
        expect(step.writeOf(roles[block]!)?.origin).toMatchObject({ provenance: 'profile',
          path: `experience[${block}].description` });
      }
      expect(roles.slice(2).map((spec) => step.writeOf(spec))).toEqual([undefined, undefined]);
    });
  });

describe('jr6 WD-20 (WORKDAY P1, RULES): Parsons’ "Education (Completed Degrees Only)" block written from the '
  + 'profile’s school', () => {
  /** The Degree list s2-pureinsurance-degree-open shows open (another tenant's list: Parsons' is in no capture). */
  function capturedDegrees(): string[] {
    const page = new DOMParser().parseFromString(pureDegree, 'text/html');
    return Array.from(page.querySelectorAll('ul[role="listbox"]#sy8s1d [role="option"]'), words)
      .filter((label) => label !== 'Select One');
  }

  it('jr6-parsons-my-experience: School, Degree (another tenant’s captured list) and Field of Study', async () => {
    const degrees = capturedDegrees();
    expect(degrees.length).toBeGreaterThan(5);
    const step = await stepPlan(parsonsExp, 'Parsons',
      { lists: (label) => (label === 'Degree' ? degrees : assumedList(label)) });
    for (const label of ['School or University', 'Degree', 'Field of Study']) {
      expect(step.specOf(label).section, label).toEqual({ id: 'education', block: 0 });
    }
    expect(textOf(step.write('School or University'))).toBe('The University of Texas at Austin');
    expect(step.write('School or University')?.origin).toMatchObject({ provenance: 'profile',
      path: 'education[0].institution' });
    expect(optionOf(step.write('Degree'))).toBe('Bachelor of Science (B.S)');
    expect(step.write('Field of Study')?.value).toMatchObject({ kind: 'query',
      queries: expect.arrayContaining(['Computer Science']) });
    expect(step.write('Field of Study')?.origin).toMatchObject({ path: 'education[0].degree.field' });
  });
});

describe('jr6 WD-18 (ENGINE E3 item 13): Skills one text field, planned as the profile’s skills joined', () => {
  it.each([['resolvetech-my-experience', resolveExp, 'Resolve Tech Solutions'],
    ['s2-exelixis-my-experience', exelixisExp, 'Exelixis'],
    ['jr6-danafarber-my-experience', danaExp, 'Dana-Farber Cancer Institute'],
    ['jr6-parsons-my-experience', parsonsExp, 'Parsons']])('%s', async (_name, html, company) => {
    const step = await stepPlan(html, company);
    const skills = step.specOf('Type to Add Skills');
    expect([skills.kind, skills.options, skills.current]).toEqual(['text', [], { kind: 'empty' }]);
    expect(step.row('Type to Add Skills')).toMatchObject({ category: 'skills.list', needsUserAction: false });
    expect(textOf(step.write('Type to Add Skills'))).toBe(['TypeScript', 'PostgreSQL', 'Kubernetes']
      .join(MANY_SEPARATOR));
    expect(step.ask('Type to Add Skills')).toBeNull();
  });
});

describe('RULES regression (jr6-rules item 56, f1245ff): Workday’s "Resume/CV/Cover Letter" drop zone', () => {
  /** The step before Workday's parse: the file it holds taken away (its file-upload-item). */
  const blank = (doc: Document) => {
    for (const item of Array.from(doc.querySelectorAll('[data-automation-id="file-upload-item"]'))) item.remove();
  };
  const CASES: Array<[string, string, string, boolean]> = [
    ['jr6-danafarber-my-experience', danaExp, 'Dana-Farber Cancer Institute', true],
    ['jr6-travelers-my-experience', travelersExp, 'Travelers', false],
  ];

  it.each(CASES)('%s: the drop zone sits under the help text "Resume/CV/Cover Letter"', async (_name, html, company,
    required) => {
    const step = await stepPlan(html, company, { prepare: blank });
    const upload = step.specOf('Upload a file (5MB max)');
    expect([upload.kind, upload.required, upload.description, upload.section.id, upload.current.kind]).toEqual(['file',
      required, 'Resume/CV/Cover Letter', 'resume-cv-cover-letter', 'empty']);
  });

  // Before jr6-rules' f1245ff (classifyRules.ts RESUME_HEADING, labelRuleVote) this drop zone was the résumé's
  // (file.resume: the résumé uploaded on a blank step, as on every "Resume/CV" step); since, help text that is more than
  // a résumé's heading makes no upload the résumé's, so these steps never get the résumé (Dana-Farber's is required).
  // Expected to fail until RULES' heading takes Workday's "Resume/CV/Cover Letter": then make these it().
  for (const [name, html, company] of CASES) {
    it.fails(`${name}: the drop zone is the résumé’s, and a blank step gets the résumé`, async () => {
      const step = await stepPlan(html, company, { prepare: blank });
      expect(step.row('Upload a file (5MB max)').category).toBe('file.resume');
      expect(step.write('Upload a file (5MB max)')?.value.kind).toBe('file');
    });
  }
});

// ── jr6 WORKDAY P2: the fillers on Workday's own markup (ENGINE E3 items 13 and 15) ────────────────────────────────

/** An element with its attributes and children (the stand-ins' markup). */
function element(doc: Document, tag: string, attributes: Record<string, string>, ...children: Array<Node | string>):
  HTMLElement {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/** A pill as Workday draws one in a prompt's selectedItemList (jr6-danafarber-my-experience.html's Skills: li >
 *  div[role=option][data-automation-id=selectedItem] > its DELETE_charm icon, then p[data-automation-id=promptOption]
 *  holding the answer's words). */
function pill(doc: Document, answer: string): HTMLElement {
  return element(doc, 'li', { role: 'presentation', 'data-automation-id': 'menuItem' },
    element(doc, 'div', { role: 'option', 'data-automation-id': 'selectedItem', 'aria-label': answer },
      element(doc, 'div', { 'data-automation-id': 'DELETE_charm', role: 'presentation', 'aria-hidden': 'true' }),
      element(doc, 'p', { 'data-automation-id': 'promptOption', 'data-automation-label': answer }, answer)));
}

/** The Skills prompt's list of pills, drawn where the page has none yet (as the danafarber capture holds it). */
function pillList(doc: Document): Element {
  const container = doc.getElementById('skills--skills')!.closest('[data-automation-id="multiSelectContainer"]')!;
  const found = container.querySelector('[data-automation-id="selectedItemList"]');
  if (found !== null) return found;
  const list = element(doc, 'ul', { role: 'listbox', 'data-automation-id': 'selectedItemList' });
  container.querySelector('[data-automation-id="multiselectInputContainer"]')!.append(list);
  return list;
}

/** The skills the stand-in's catalogue offers (made up): each golden skill, after a longer name that contains it, so
 *  only the choice of the result that is the value itself chooses it. */
const CATALOGUE = ['TypeScript Compiler', 'TypeScript', 'PostgreSQL Administration', 'PostgreSQL',
  'Kubernetes Administration', 'Kubernetes', 'Docker'];

/** Workday's Skills prompt as its script draws it, stood in for on a real page (the s2 prompts' stand-in of
 *  workday-s2.browser.test.ts; s2-verily-field-of-study-open.html's popup markup): the typed text drawn a microtask
 *  after its input event, as React draws it; an Enter keydown in the box after typed text draws the popup that names
 *  the prompt's container (data-associated-widget), its rows the catalogue's skills containing the typed words, each a
 *  radio leaf, or Workday's own "No Items." row (a leaf of type 2, no radio); a click on a row's label chooses it: its
 *  pill drawn in the container's list, the popup gone, the box emptied. Queries and choices are kept, in order. */
function standInSkills(doc: Document, catalogue: readonly string[]) {
  const box = doc.getElementById('skills--skills') as HTMLInputElement;
  const container = box.closest('[data-automation-id="multiSelectContainer"]')!;
  const queries: string[] = [];
  const chosen: string[] = [];
  let popup: HTMLElement | null = null;
  const close = () => {
    popup?.remove();
    popup = null;
  };
  box.addEventListener('input', () => queueMicrotask(() => box.setAttribute('data-typed', box.value)));
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || box.value.trim() === '') return;
    const query = box.value.trim();
    queries.push(query);
    close();
    const found = catalogue.filter((name) => name.toLowerCase().includes(query.toLowerCase()));
    const rows = found.length === 0
      ? [element(doc, 'div', { role: 'option', 'data-automation-id': 'menuItem', 'aria-label': 'No Items.' },
        element(doc, 'div', { 'data-automation-id': 'promptLeafNode', 'data-uxi-multiselectlistitem-type': '2' },
          element(doc, 'div', { 'data-automation-id': 'promptOption' }, 'No Items.')))]
      : found.map((name, at) => element(doc, 'div', { role: 'option', 'data-automation-id': 'menuItem',
        id: `menuItem-stand-in-${at}`, 'aria-label': `${name} not checked`, 'aria-selected': 'false' },
      element(doc, 'div', { 'data-automation-id': 'promptLeafNode', 'data-uxi-multiselectlistitem-type': '1' },
        element(doc, 'input', { type: 'radio', 'data-automation-id': 'radioBtn', 'aria-checked': 'false' }),
        element(doc, 'div', { 'data-automation-id': 'promptOption', 'data-automation-label': name }, name))));
    popup = element(doc, 'div', { 'data-popper-placement': 'bottom' },
      element(doc, 'div', { 'data-automation-id': 'responsiveMonikerPrompt', 'data-associated-widget': container.id },
        element(doc, 'div', { 'data-automation-id': 'activeListContainer', role: 'listbox' }, ...rows)));
    doc.body.append(popup);
  });
  doc.addEventListener('click', (event) => {
    const row = (event.target as Element).closest('[role="option"][data-automation-id="menuItem"]');
    if (row === null || popup === null || !popup.contains(row)) return;
    if (row.querySelector('[data-automation-id="radioBtn"]') === null) return;
    const name = words(row.querySelector('[data-automation-id="promptOption"]'));
    chosen.push(name);
    pillList(doc).append(pill(doc, name));
    close();
    box.value = '';
  });
  /** The words of the pills the prompt shows, in order. */
  const pills = () => Array.from(container.querySelectorAll('[data-automation-id="selectedItem"]'),
    (item) => words(item.querySelector('[data-automation-id="promptOption"]')));
  return { box, queries, chosen, pills };
}

/** Skills planned with the golden profile and written through the pass, as the run writes a field (content/pass.ts
 *  writeField: its Guard on a fresh scan, then the tags filler), with Workday's prompt stood in for. */
async function writeSkills(html: string, company: string,
  options: { prepare?: (doc: Document) => void; catalogue?: readonly string[] } = {}) {
  const { doc } = await load(html);
  options.prepare?.(doc);
  const prompt = standInSkills(doc, options.catalogue ?? CATALOGUE);
  const root = workdayAdapter.detect(doc)!.formRoot;
  const readings = new Map<BaseKey, WidgetReading>();
  const read = (): ScanResult => scan(root, workdayAdapter, { platform: 'workday', frameId: 0,
    widgetReadings: readings });
  const last = read();
  const field = last.fields.find((each) => each.label === 'Type to Add Skills')!;
  const kinds = workdayAdapter.repeatables!(root).map((section) => section.kind);
  const plan = planFrame({ specs: last.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false,
    now: NOW, posting: { company, location: 'Austin, TX, USA' },
    ...(kinds.length > 0 ? { repeatables: kinds.map((kind) => ({ kind, entries: null })) } : {}) });
  const planned = plan.writes.find((write) => write.key === field.key)!;
  const row = plan.results.find((each) => each.key === field.key)!;
  const env = { adapter: workdayAdapter, root, platform: 'workday', frameId: 0, dryRun: false, canaries: [],
    signal: new AbortController().signal, valid: () => true, stopped: () => false, runId: () => 'run',
    heldBy: () => null } as unknown as PassEnv;
  const widgets: WidgetWriteEnv = { readings, plan: async () => ({ results: [], writes: [] }) as never };
  const result = await writeField(env, last, field, planned, row, new WeakMap(), { widgets });
  return { doc, prompt, field, planned, result, read };
}

describe('jr6 WD-18 (ENGINE E3 item 13): Skills filled one skill at a time, read back by its pills', () => {
  const GOLDEN = ['TypeScript', 'PostgreSQL', 'Kubernetes'];

  it.each([['resolvetech-my-experience', resolveExp, 'Resolve Tech Solutions'],
    ['s2-exelixis-my-experience', exelixisExp, 'Exelixis']])(
    '%s: each skill searched, its own result chosen, its pill read back then and after the settle',
    async (_name, html, company) => {
      const { prompt, field, planned, result, read } = await writeSkills(html, company);
      expect([field.kind, field.current]).toEqual(['text', { kind: 'empty' }]);
      expect(planned.value).toEqual({ kind: 'text', text: GOLDEN.join(MANY_SEPARATOR) });
      expect(prompt.queries).toEqual(GOLDEN);
      // The result that is the value itself, never the longer name listed before it.
      expect(prompt.chosen).toEqual(GOLDEN);
      expect(prompt.pills()).toEqual(GOLDEN);
      expect(prompt.box.value).toBe('');
      expect(result.row).toMatchObject({ wrote: true, verification: 'verified', needsUserAction: false });
      expect(verifyWritten(read(), result.written!)).toMatchObject({ verification: 'verified' });
    });

  it.each([['jr6-danafarber-my-experience', danaExp, 'Dana-Farber Cancer Institute'],
    ['jr6-parsons-my-experience', parsonsExp, 'Parsons']])(
    '%s: the 15 pills the page shows are kept, and a skill a pill shows is not searched again', async (_name, html,
      company) => {
      let shown: Element[] = [];
      const { prompt, result } = await writeSkills(html, company, { prepare: (doc) => {
        pillList(doc).append(pill(doc, 'PostgreSQL'));
        shown = Array.from(pillList(doc).querySelectorAll('[data-automation-id="selectedItem"]'));
      } });
      expect(shown).toHaveLength(16);
      expect(prompt.queries).toEqual(['TypeScript', 'Kubernetes']);
      expect(shown.every((each) => each.isConnected)).toBe(true);
      expect(prompt.pills()).toHaveLength(18);
      expect(prompt.pills().slice(-3)).toEqual(['PostgreSQL', 'TypeScript', 'Kubernetes']);
      expect(result.row).toMatchObject({ wrote: true, verification: 'verified' });
    });

  it('never past its cap: on a step showing one pill fewer than the cap, one skill is added, the row says so',
    async () => {
      const { prompt, result, read } = await writeSkills(resolveExp, 'Resolve Tech Solutions', { prepare: (doc) => {
        const list = pillList(doc);
        for (let at = 1; at < WORKDAY_SKILLS_CAP; at += 1) list.append(pill(doc, `Fixture Skill ${at}`));
      } });
      expect(prompt.queries).toEqual(['TypeScript']);
      expect(prompt.pills()).toHaveLength(WORKDAY_SKILLS_CAP);
      expect(result.row).toMatchObject({ wrote: true, reason: 'max-selections-reached', needsUserAction: true });
      expect(verifyWritten(read(), result.written!)).toMatchObject({ reason: 'max-selections-reached' });
    });

  it('chooses only the result that is the value: a skill Workday lists under a longer name alone is left '
    + '(ENGINE E3’s exact results), the row filled but not verified', async () => {
    const { prompt, result } = await writeSkills(resolveExp, 'Resolve Tech Solutions',
      { catalogue: CATALOGUE.filter((name) => name !== 'Kubernetes') });
    expect(prompt.queries).toEqual(GOLDEN);
    expect(prompt.chosen).toEqual(['TypeScript', 'PostgreSQL']);
    expect(result.row).toMatchObject({ wrote: true, reason: 'verify-mismatch', verification: 'mismatch' });
  });

  it.each([['jr6-danafarber-my-experience', danaExp], ['jr6-parsons-my-experience', parsonsExp]])(
    '%s: each of the capture’s 15 pills reads as its answer alone (its DELETE_charm icon draws no text)',
    async (_name, html) => {
      const { doc } = await load(html);
      const tags = workdayAdapter.widgetFor!(doc.getElementById('skills--skills')!)!.tags!;
      const chips = tags.chips();
      expect(chips).toHaveLength(15);
      const answers = chips.map((chip) => tagIdentity(visibleText(
        chip.querySelector('[data-automation-id="promptOption"]')!, { singleLine: true, cap: TEXT_CAP_LABEL })));
      expect(answers.every((answer) => answer !== '')).toBe(true);
      expect(chipWords(tags)).toEqual(answers);
      expect(chips.map((chip) => visibleText(chip.querySelector('[data-automation-id="DELETE_charm"]')!)))
        .toEqual(chips.map(() => ''));
    });
});

/** Workday's date script stood in for on a real page, as snapshot5 shows it behaves and ENGINE's synthetic date page
 *  models it (src/dom/fillers/jr6-doors.browser.test.ts): each part draws its digits a microtask after its input
 *  event; the date's own state takes a part from its typed digits, or from the setter's write while the part has the
 *  page's focus (a focus or focusin since its last write), as `takes` says; leaving a part (its focusout) validates its
 *  date: whole and every part taken, its field's alerts go, else the field shows "Error: Invalid Date". Each part's
 *  events are kept in order (a key as "key:<its key>"). */
function standInDates(doc: Document, takes: 'focused' | 'keys' | 'never') {
  const events = new Map<string, string[]>();
  const taken = new Set<string>();
  const focused = new Set<string>();
  for (const input of Array.from(doc.querySelectorAll<HTMLInputElement>(
    '[data-automation-id="dateInputWrapper"] input[role="spinbutton"]'))) {
    const display = doc.getElementById(input.id.replace(/-input$/, '-display'));
    const wrapper = input.closest('[data-automation-id="dateInputWrapper"]')!;
    const field = wrapper.closest('[data-automation-id^="formField-"]')!;
    const kept: string[] = [];
    events.set(input.id, kept);
    let typed = '';
    for (const type of ['focus', 'focusin', 'input', 'change', 'keydown', 'focusout', 'blur']) {
      input.addEventListener(type, (event) => {
        kept.push(event.type === 'keydown' ? `key:${(event as KeyboardEvent).key}` : event.type);
      });
    }
    input.addEventListener('focusin', () => focused.add(input.id));
    input.addEventListener('input', () => {
      const digits = input.value;
      queueMicrotask(() => {
        if (!/^\d+$/.test(digits)) return;
        if (display !== null) display.textContent = digits;
        input.setAttribute('aria-valuenow', String(Number(digits)));
      });
      if (takes === 'focused' && focused.has(input.id) && /^\d+$/.test(digits)) taken.add(input.id);
      focused.delete(input.id);
      typed = '';
    });
    input.addEventListener('keydown', (event) => {
      if (!/^\d$/.test(event.key)) return;
      typed += event.key;
      const digits = typed;
      if (takes !== 'never') taken.add(input.id);
      queueMicrotask(() => {
        if (display !== null) display.textContent = digits;
        input.setAttribute('aria-valuenow', String(Number(digits)));
      });
    });
    input.addEventListener('focusout', () => {
      const whole = Array.from(wrapper.querySelectorAll('input[role="spinbutton"]')).every((part) => taken.has(part.id));
      const alerts = Array.from(field.querySelectorAll('[data-automation-id="inputAlert"]'));
      if (whole) {
        for (const alert of alerts) alert.remove();
      } else if (alerts.length === 0) {
        (wrapper.closest('fieldset') ?? field).append(element(doc, 'p', { 'data-automation-id': 'inputAlert' },
          'Error: Invalid Date'));
      }
    });
  }
  return { of: (id: string) => events.get(id) ?? [] };
}

describe('jr6 WD-23 (ENGINE E3 item 15): Workday’s dates, each part focused before its write, its alert read', () => {
  /** The golden profile's first job's From, as the plan writes it. */
  const FROM_ISO = '2021-06';

  /** The page, its date script stood in for, and a reader of the date field whose wrapper is `id`. */
  async function datePage(html: string, id: string, takes: 'focused' | 'keys' | 'never') {
    const { doc } = await load(html);
    const root = workdayAdapter.detect(doc)!.formRoot;
    const dates = standInDates(doc, takes);
    const read = () => scan(root, workdayAdapter, { platform: 'workday' });
    const target = () => {
      const result = read();
      const wrapper = doc.getElementById(id)!;
      return result.target(result.fields.find((each) => result.target(each.key)?.control === wrapper)!.key)!;
    };
    const part = (name: 'Month' | 'Year') => dates.of(`${id}-dateSection${name}-input`);
    return { doc, root, read, target, part };
  }

  it('s2-pureinsurance-my-experience-errors: From written with each part focused first, so Workday takes it and the '
    + 'capture’s "Invalid Date" alert goes', async () => {
    const FROM = 'workExperience-5--startDate';
    const page = await datePage(pureExp, FROM, 'focused');
    // The capture as the owner saw it after the old filler: the date empty, its alert under it.
    expect(page.target().field.current).toEqual({ kind: 'empty' });
    expect(page.target().dateParts?.alert?.()).not.toBeNull();
    const active = page.doc.activeElement;
    const log = logEvents(page.doc);
    expect(await fillDateParts(page.target(), FROM_ISO, { adapter: workdayAdapter, root: page.root }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    for (const name of ['Month', 'Year'] as const) {
      expect(page.part(name), name).toEqual(['focus', 'focusin', 'input', 'change', 'focusout', 'blur']);
    }
    // Untrusted, and the page's focus never moved.
    expect(page.doc.activeElement).toBe(active);
    expect(untrustedViolations(log.events)).toEqual([]);
    expect(page.target().dateParts?.alert?.()).toBeNull();
    expect(page.target().field.current).toEqual({ kind: 'text', text: FROM_ISO });
    expect(verifyAfterSettle(page.read(), page.target().field.key, { kind: 'date', iso: FROM_ISO }))
      .toEqual({ verification: 'verified', reason: 'ok' });
  });

  it('s2-exelixis-my-experience: a setter’s write Workday does not take shows its alert once left, and the date is '
    + 'written again once with its digits, each part focused first: the alert goes', async () => {
    const FROM = 'workExperience-346--startDate';
    const page = await datePage(exelixisExp, FROM, 'keys');
    expect(await fillDateParts(page.target(), FROM_ISO, { adapter: workdayAdapter, root: page.root }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.part('Month')).toEqual(['focus', 'focusin', 'input', 'change', 'focusout', 'blur', 'focus', 'focusin',
      'input', 'change', 'key:0', 'key:6', 'focusout', 'blur']);
    expect(page.part('Year').filter((event) => event.startsWith('key:'))).toEqual(['key:2', 'key:0', 'key:2',
      'key:1']);
    expect(page.target().dateParts?.alert?.()).toBeNull();
    expect(page.target().field.current).toEqual({ kind: 'text', text: FROM_ISO });
  });

  it('s2-exelixis-my-experience: written again once only: an alert that stays is value-rejected-by-site, then and '
    + 'after the settle', async () => {
    const FROM = 'workExperience-346--startDate';
    const page = await datePage(exelixisExp, FROM, 'never');
    expect(await fillDateParts(page.target(), FROM_ISO, { adapter: workdayAdapter, root: page.root }))
      .toEqual({ wrote: true, verification: 'mismatch', reason: 'value-rejected-by-site', needsUserAction: false });
    expect(page.part('Month').filter((event) => event.startsWith('key:'))).toEqual(['key:0', 'key:6']);
    expect(page.target().dateParts?.alert?.()).not.toBeNull();
    expect(verifyAfterSettle(page.read(), page.target().field.key, { kind: 'date', iso: FROM_ISO }))
      .toEqual({ verification: 'mismatch', reason: 'value-rejected-by-site' });
  });
});
