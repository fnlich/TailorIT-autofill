/*
 * The UltiPro adapter on the owner's snapshots of 2026-11-06 (fixtures/ultipro, DESIGN-NEW-ATS §1): each page's hooks
 * and scan held to its hand-written expectations, then each rule held against the same page read without it (the rule
 * undone): the three page states (the account step, the résumé review and its "Save and continue", the application
 * and its Submit host), the panels as sections, Country's class-only required mark, the start date (one date in its
 * component's shadow boxes, jr6 U-07), the period boxes with no label of their own, the Skills typeahead, and the
 * never-pressed controls. The start date is one row of application.expect.json, its control the component.
 * KNOWN: what the scanner reads differently from the page today, each to be emptied once it reads it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import applicationExpect from '../../../fixtures/ultipro/application.expect.json';
import applicationHtml from '../../../fixtures/ultipro/application.html?raw';
import registerExpect from '../../../fixtures/ultipro/register.expect.json';
import registerHtml from '../../../fixtures/ultipro/register.html?raw';
import resumeReviewExpect from '../../../fixtures/ultipro/resume-review.expect.json';
import resumeReviewHtml from '../../../fixtures/ultipro/resume-review.html?raw';
// ── jr7 ULTIPRO-7 P2: the owner's snapshot7 ultipro1 and ultipro2, nine of their pages ──
import jr7U1PostingExpect from '../../../fixtures/ultipro/jr7-ultipro1-posting.expect.json';
import jr7U1PostingHtml from '../../../fixtures/ultipro/jr7-ultipro1-posting.html?raw';
import jr7U2PostingExpect from '../../../fixtures/ultipro/jr7-ultipro2-posting.expect.json';
import jr7U2PostingHtml from '../../../fixtures/ultipro/jr7-ultipro2-posting.html?raw';
import jr7U1RegisterExpect from '../../../fixtures/ultipro/jr7-ultipro1-register.expect.json';
import jr7U1RegisterHtml from '../../../fixtures/ultipro/jr7-ultipro1-register.html?raw';
import jr7U2RegisterExpect from '../../../fixtures/ultipro/jr7-ultipro2-register.expect.json';
import jr7U2RegisterHtml from '../../../fixtures/ultipro/jr7-ultipro2-register.html?raw';
import jr7U1Apply1Expect from '../../../fixtures/ultipro/jr7-ultipro1-apply-1.expect.json';
import jr7U1Apply1Html from '../../../fixtures/ultipro/jr7-ultipro1-apply-1.html?raw';
import jr7U2Apply1Expect from '../../../fixtures/ultipro/jr7-ultipro2-apply-1.expect.json';
import jr7U2Apply1Html from '../../../fixtures/ultipro/jr7-ultipro2-apply-1.html?raw';
import jr7U1Apply11Expect from '../../../fixtures/ultipro/jr7-ultipro1-apply-11.expect.json';
import jr7U1Apply11Html from '../../../fixtures/ultipro/jr7-ultipro1-apply-11.html?raw';
import jr7U1SubmittedExpect from '../../../fixtures/ultipro/jr7-ultipro1-submitted.expect.json';
import jr7U1SubmittedHtml from '../../../fixtures/ultipro/jr7-ultipro1-submitted.html?raw';
import jr7U2SubmittedExpect from '../../../fixtures/ultipro/jr7-ultipro2-submitted.expect.json';
import jr7U2SubmittedHtml from '../../../fixtures/ultipro/jr7-ultipro2-submitted.html?raw';
// ── end jr7 ULTIPRO-7 P2 ──
import { sourceOf } from '../../content/apply.testkit';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { signIn, type SignInContext } from '../../content/sign-in';
import { scan } from '../../dom/scan';
import { signInContainerOf, signInRefusal } from '../../dom/sign-in-form';
import type { ScanResult, ScannedField } from '../../dom/types';
import { configProblems, configuredHooks } from '../configured';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { ULTIPRO_CONFIG, ULTIPRO_SNAPSHOTS, ultiproAdapter } from './index';

const APPLY = 'https://recruiting.ultipro.com/cam1010csii/JobBoard/54a25c3a-e399-42b0-a553-16ed056e0517/OpportunityApply?opportunityId=772ddf9d-79f1-4752-bf3b-688ded6980c7';
const REGISTER = 'https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F54a25c3a-e399-42b0-a553-16ed056e0517%2FOpportunityApply%3FopportunityId%3D772ddf9d-79f1-4752-bf3b-688ded6980c7%7Cta%3DCAM1010CSII';

const CASES = [
  { name: 'register', html: registerHtml, json: registerExpect, address: REGISTER },
  { name: 'resume-review', html: resumeReviewHtml, json: resumeReviewExpect, address: APPLY },
  { name: 'application', html: applicationHtml, json: applicationExpect, address: APPLY },
  // ── jr7 ULTIPRO-7 P2: each page at the address its header names ──
  { name: 'jr7-ultipro1-posting', html: jr7U1PostingHtml, json: jr7U1PostingExpect, address: sourceOf(jr7U1PostingHtml)! },
  { name: 'jr7-ultipro2-posting', html: jr7U2PostingHtml, json: jr7U2PostingExpect, address: sourceOf(jr7U2PostingHtml)! },
  { name: 'jr7-ultipro1-register', html: jr7U1RegisterHtml, json: jr7U1RegisterExpect, address: sourceOf(jr7U1RegisterHtml)! },
  { name: 'jr7-ultipro2-register', html: jr7U2RegisterHtml, json: jr7U2RegisterExpect, address: sourceOf(jr7U2RegisterHtml)! },
  { name: 'jr7-ultipro1-apply-1', html: jr7U1Apply1Html, json: jr7U1Apply1Expect, address: sourceOf(jr7U1Apply1Html)! },
  { name: 'jr7-ultipro2-apply-1', html: jr7U2Apply1Html, json: jr7U2Apply1Expect, address: sourceOf(jr7U2Apply1Html)! },
  { name: 'jr7-ultipro1-apply-11', html: jr7U1Apply11Html, json: jr7U1Apply11Expect, address: sourceOf(jr7U1Apply11Html)! },
  { name: 'jr7-ultipro1-submitted', html: jr7U1SubmittedHtml, json: jr7U1SubmittedExpect, address: sourceOf(jr7U1SubmittedHtml)! },
  { name: 'jr7-ultipro2-submitted', html: jr7U2SubmittedHtml, json: jr7U2SubmittedExpect, address: sourceOf(jr7U2SubmittedHtml)! },
  // ── end jr7 ULTIPRO-7 P2 ──
] as const;

type CaseName = (typeof CASES)[number]['name'];

/**
 * What the scanner reads differently from the page on these snapshots, and why. Each listed difference must still be
 * there, so the list is emptied once the scanner reads them.
 * - The account step's labels read now (core pass Z2 of 2026-11-06): the ukg-label words are slotted into its shadow
 *   root's <slot>, whose own box (display: contents) the camouflage rules used to judge at the page's origin, cut by the
 *   account card's overflow: hidden ('unknown'); they read the slotted words' own box now (dom/camouflage.ts
 *   ownTextBox).
 * - Its three boxes still read camouflaged in this capture: what draws them is ukg-field's shadow-root style, which the
 *   page adopts as a constructed style sheet, and the snapshot (ultipro-2) holds none of it (its ukg-field templates hold
 *   no <style>, and no captured sheet names .ukg-field-container or .input-wrapper). Nothing in the capture shows a box
 *   around them, so the scanner refuses them here; a live page's computed style decides.
 */
const KNOWN: Record<string, ReadonlyArray<{ control: string; property: string }>> = {
  register: ['firstName', 'lastName', 'phoneNumber'].map((name) => ({ control: `input[name="${name}"]`,
    property: 'fillable' })),
  // jr7 ULTIPRO-7 P2: snapshot7's two account steps, as the 2026-11-06 one (above): the boxes UP7-V1's controlBox reads
  // drawn once their ukg-field's shadow container draws a box, which no capture keeps the style of.
  ...Object.fromEntries(['jr7-ultipro1-register', 'jr7-ultipro2-register'].map((name) => [name,
    ['firstName', 'lastName', 'phoneNumber'].map((box) => ({ control: `input[name="${box}"]`, property: 'fillable' }))])),
};

afterEach(() => removeFixtures(document));

async function open(name: CaseName) {
  return loadFixture(document, CASES.find((each) => each.name === name)!.html, SNAPSHOT_VIEWPORT);
}

async function scanWith(name: CaseName, adapter: Adapter = ultiproAdapter): Promise<{ doc: Document; result: ScanResult }> {
  const fixture = await open(name);
  return { doc: fixture.doc, result: scan(ultiproAdapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'ultipro' }) };
}

function fieldAt(doc: Document, result: ScanResult, selector: string): ScannedField | undefined {
  const el = doc.querySelector(selector);
  return result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && (target.control === el || target.widget?.element === el || target.members.includes(el as HTMLInputElement));
  });
}

const without = (...hooks: Array<keyof Adapter>): Adapter => {
  const copy: Partial<Adapter> = { ...ultiproAdapter };
  for (const hook of hooks) delete copy[hook];
  return copy as Adapter;
};

describe('the UltiPro adapter: its hooks and scans on the snapshots', () => {
  it('names each snapshot it was written from, and its config is sound', () => {
    expect(CASES.map((each) => `fixtures/ultipro/${each.name}.html`).sort()).toEqual([...ULTIPRO_SNAPSHOTS].sort());
    expect(configProblems(ULTIPRO_CONFIG)).toEqual([]);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ name, json }) => {
    const fixture = await open(name);
    expect(compareHooks(fixture.doc, ultiproAdapter, readHooks(json))).toEqual([]);
  });

  // jr7 ULTIPRO-7 P2: a page with no form (a posting, the page after submitting, the documents dialog's state) has no
  // root to scan: its hooks say so (detect null) and it lists no field.
  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ name, html, json, address }) => {
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter).toBe(ultiproAdapter);
    // The start date is one date (jr6 U-07), its row's control the ukg-date-input-text component; an entry may still
    // step into an open shadow root with " >>> " (expectations.testkit selectComposed, core pass Z2 of 2026-11-06).
    const found = compareWithExpectation(scanned.doc, scanned.result, readExpectation(json));
    const known = KNOWN[name] ?? [];
    for (const each of known) expect(found, `${each.control} ${each.property}`).toContainEqual(expect.objectContaining(each));
    expect(found.filter((each) => !known.some((one) => one.control === each.control && one.property === each.property)))
      .toEqual([]);
  });
});

describe('the page states', () => {
  it('fills the account step like a step; its Create account follows Sign-in mode, its container\'s button (ultipro-2)',
    async () => {
    const fixture = await open('register');
    const form = fixture.doc.querySelector('form#registrationDetailsForm')!;
    const host = fixture.doc.querySelector('[data-automation="registrationDetails-submit-button"]')!;
    expect(ultiproAdapter.detect(fixture.doc)?.formRoot).toBe(form);
    expect(ultiproAdapter.authState?.(fixture.doc)).toBeNull();
    expect(ultiproAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:register'] });
    // The behaviour review (minor 2): its Create account shown, the step leads on: not final; hidden, it can't tell.
    expect(ultiproAdapter.isFinalStep?.(fixture.doc)).toBe('not-final');
    expect(configuredHooks(ULTIPRO_CONFIG).isFinalStep?.(fixture.doc)).toBe('unknown');
    expect(ultiproAdapter.nextButton?.(fixture.doc.body)).toBeNull();
    // No wall: the page is no pause, and Sign-in Auto reads no form for one there.
    for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
      expect(ultiproAdapter.signInForm?.(fixture.doc, wall)).toBeNull();
    }
    // Core pass Z1, item 24: the form is the state's declared sign-in container, its Create account (outside the form)
    // the button, the native button the host's shadow root draws; no box (Sign-in Auto types nothing there). It is no
    // never-pressed control any more: Sign-in Auto's door alone presses it.
    const native = host.shadowRoot!.querySelector('button.ukg-button-native');
    // jr7 ULTIPRO-7 (UP7-04): enabled by the page once the step is filled; this tenant draws no privacy box.
    expect(ultiproAdapter.signInContainer?.(fixture.doc)).toEqual({ email: null, password: null, confirm: null, terms: [],
      button: native, container: form, enablesWhenFilled: true });
    expect(form.contains(host)).toBe(false);
    expect(ultiproAdapter.neverPress?.(fixture.doc.body)).not.toContain(host);
    // Read at its own address (the converter wrote every form's action as /__submitted, which then resolves there).
    const base = fixture.doc.createElement('base');
    base.href = REGISTER;
    fixture.doc.head.prepend(base);
    const container = signInContainerOf(ultiproAdapter, fixture.doc)!;
    expect(signInRefusal(container, new URL(REGISTER))).toBeNull();
    // Sign-in Auto (container mode, its worker's answer a stand-in) presses that one button at an https address, never
    // at http; named never to press again (the host, as before), never its face inside the host's shadow root.
    const clicks: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push(event.composedPath()[0] as Element);
      event.preventDefault();
    }, true);
    const press = (adapter: Adapter, href = REGISTER) => signIn({ doc: fixture.doc, adapter, href: () => href,
      channel: { request: async () => ({ ok: true, data: { host: 'recruiting.ultipro.com', email: 'guest@example.com', press: true } }) } as unknown as
        SignInContext['channel'],
      isTop: true, container: true, signal: new AbortController().signal, settleMs: 300 });
    expect(await press(ultiproAdapter, REGISTER.replace('https:', 'http:'))).toBe('unavailable');
    const neverAgain: Adapter = { ...ultiproAdapter, neverPress: (root) => [...(ultiproAdapter.neverPress?.(root) ?? []),
      host] };
    expect(await press(neverAgain)).toBe('unavailable');
    expect(clicks).toEqual([]);
    await press(ultiproAdapter);
    expect(clicks).toEqual([native]);
    // The rule undone: no #OpportunityApply on the account step, so the adapter would claim no root.
    const plain = configuredHooks({ ...ULTIPRO_CONFIG, states: ULTIPRO_CONFIG.states!.filter((state) => state.name !== 'register') });
    expect(plain.detect(fixture.doc)).toBeNull();
  });

  it('fills the résumé review alone, its contact ids twice in the page, and presses "Save and continue" as Next (ultipro-1)', async () => {
    const fixture = await open('resume-review');
    const review = fixture.doc.querySelector('div[data-bind="if: isParsingResume()"]')!;
    expect(ultiproAdapter.detect(fixture.doc)?.formRoot).toBe(review);
    expect(fixture.doc.querySelectorAll('input#FirstName')).toHaveLength(2);
    expect(ultiproAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:review'] });
    expect(ultiproAdapter.isFinalStep?.(fixture.doc)).toBe('not-final');
    expect(ultiproAdapter.nextButton?.(review)?.textContent).toBe('Save and continue');
    // The rule undone: the whole application root holds both copies, one of them hidden, and its Submit: final.
    const plain = configuredHooks({ ...ULTIPRO_CONFIG, states: ULTIPRO_CONFIG.states!.filter((state) => state.name !== 'review') });
    expect(plain.detect(fixture.doc)?.formRoot).toBe(fixture.doc.querySelector('#OpportunityApply'));
  });

  it('reads the application as one final page, its Submit the ukg-button host (ultipro-0)', async () => {
    const fixture = await open('application');
    const root = ultiproAdapter.detect(fixture.doc)!.formRoot;
    expect(root).toBe(fixture.doc.querySelector('#OpportunityApply'));
    expect(ultiproAdapter.isFinalStep?.(fixture.doc)).toBe('final');
    const submit = ultiproAdapter.submitButton?.(root);
    expect(submit?.localName).toBe('ukg-button');
    expect(submit?.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Submit');
    expect(ultiproAdapter.nextButton?.(root)).toBeNull();
  });
});

describe('labels, required and sections', () => {
  it('sections each control by its panel (ultipro-0)', async () => {
    const { doc, result } = await scanWith('application');
    expect(fieldAt(doc, result, '#ApplicantSource')?.section).toEqual({ id: 'questions' });
    expect(ultiproAdapter.sections?.(doc.querySelector('#OpportunityApply')!).map((each) => each.label)).toEqual([
      'Contact Information', 'Work Experience', 'Education', 'Skills', 'Behaviors', 'Motivations',
      'Licenses and Certifications', 'Links', 'Documents', 'Questions']);
  });

  it("requires Country by its label's class alone (ultipro-0)", async () => {
    const { doc, result } = await scanWith('application');
    expect(fieldAt(doc, result, 'select#Country')?.required).toBe(true);
    const plain = await scanWith('application', { ...ultiproAdapter, requiredFor: undefined });
    expect(fieldAt(plain.doc, plain.result, 'select#Country')?.required).toBe(false);
  });

  it("labels the start date, one date in its component's three shadow boxes, by the light question (ultipro-0, jr6 U-07)",
    async () => {
    // Its reading (label, kind, required, section, fillable) is application.expect.json's; here, that the adapter gives
    // it: one date field, its control the component, its boxes no field of their own.
    const { doc, result } = await scanWith('application');
    const dates = result.fields.filter((field) => field.label.startsWith('When can you start? (MM/DD/YYYY)'));
    expect(dates.map((field) => [field.kind, field.label, field.labelSource])).toEqual([['date',
      'When can you start? (MM/DD/YYYY)', 'adapter']]);
    const host = result.target(dates[0]!.key)!.control;
    expect(host.localName).toBe('ukg-date-input-text');
    expect(host).toBe(doc.querySelector('ukg-date-input-text[role="group"]'));
    // The rule undone: each box is "Month", " Day", "Year" from its own aria-label, the question lost.
    const plain = await scanWith('application', without('labelFor', 'labelSuffix', 'dateFor', 'excluded'));
    expect(plain.result.fields.filter((field) => /^(?:Month|Day|Year)$/.test(field.label)).map((field) => field.label))
      .toEqual(['Month', 'Day', 'Year']);
  });

  it('labels a period box with no label of its own by its group and its own label (ultipro-1)', async () => {
    const { doc, result } = await scanWith('resume-review');
    const toMonth = '[aria-label="Work Experience 1"] [data-automation="to-month-dropdown"]';
    expect(fieldAt(doc, result, toMonth)).toMatchObject({ label: 'To Month', labelSource: 'adapter' });
    expect(fieldAt(doc, result, '[aria-label="Education 1"] [data-automation="from-year-textbox"]')?.label).toBe('From Year (YYYY)');
    // The rule undone: its aria-label "To month" is not shown beside it, so it has no visible label.
    const plain = await scanWith('resume-review', without('labelFor', 'labelSuffix'));
    expect(fieldAt(plain.doc, plain.result, toMonth)).toMatchObject({ label: 'To month', labelVisible: false });
  });

  it("labels the Skills typeahead by its panel's heading (ultipro-1)", async () => {
    const { doc, result } = await scanWith('resume-review');
    expect(fieldAt(doc, result, 'input[data-automation="item-typeahead"]')).toMatchObject({ label: 'Skills', labelVisible: true });
    const plain = await scanWith('resume-review', without('labelFor'));
    expect(fieldAt(plain.doc, plain.result, 'input[data-automation="item-typeahead"]')?.labelVisible).toBe(false);
  });

  it('leaves the account names read-only (ultipro-0)', async () => {
    const { doc, result } = await scanWith('application');
    for (const id of ['#FirstName', '#FamilyName', '#FormerName', '#PreferredName']) {
      expect(fieldAt(doc, result, `input${id}`)?.readOnly, id).toBe(true);
    }
  });

  it('never presses Cancel, Sign Out, a Remove, a document\'s delete or the résumé parser (ultipro-0)', async () => {
    const fixture = await open('application');
    const never = ultiproAdapter.neverPress!(fixture.doc.body);
    for (const selector of ['a[data-automation="btn-cancel"]', '[data-automation="application-incorrect-name-text-signout-link"]',
      'button[data-automation="remove-button"]', 'a[data-automation="delete-file-link"]', '#ResumeParsingUploader upload-button',
      'button[data-automation="cancel-button"]']) {
      for (const el of Array.from(fixture.doc.querySelectorAll(selector))) expect(never, selector).toContain(el);
    }
    expect(never).not.toContain(fixture.doc.querySelector('ukg-button[data-automation="btn-submit"]'));
  });
});
