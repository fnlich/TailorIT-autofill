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
 * The outcomes that need ENGINE's E1 to E3 or RULES' rules (FIXPLAN §6.4 "P2 asserts") are P2's and are added here
 * then. Plans use the golden synthetic profile and DEFAULT_SETTINGS; the fixtures hold none of the owner's values.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { FieldSpec } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { detectPause } from '../../dom/pause-detect';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { WORKDAY_SKILLS_CAP } from './application';
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
  it('holds the 26 jr6 cases', () => {
    expect(new Set(STEPS.map((step) => step.name)).size).toBe(26);
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
