/*
 * The ADP Workforce Now adapter on the owner's snapshots of 2026-11-06 (fixtures/adp, DESIGN-NEW-ATS §1): each case's
 * hooks and scan held to its hand-written expectations, then each rule the adapter adds over the configured layer held
 * against the same page read without it (the rule undone), so every rule is shown to be the one that reads it:
 * - the page states: the code dialog (email-code, the person's), the guest page (filled like a step, nothing pressed);
 * - the wizard's one address: its step from the aria-current header item, Next, Submit and finality;
 * - the labels no attribute ties: the drawn Yes/No groups' qLabel, the Self-ID groups' h4, the phones' labels, the
 *   guest page's labels, the preferred-name span, and the required class;
 * - the react-selects' box, the referral's wfn-radio-button hosts, the e-signature's signature consent.
 * The guest page's Continue carries the invisible reCAPTCHA binding only, so the page does not pause (core pass Z1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import codeDialogExpect from '../../../fixtures/adp/code-dialog.expect.json';
import codeDialogHtml from '../../../fixtures/adp/code-dialog.html?raw';
import guestExpect from '../../../fixtures/adp/guest.expect.json';
import guestHtml from '../../../fixtures/adp/guest.html?raw';
import personalExpect from '../../../fixtures/adp/personal.expect.json';
import personalHtml from '../../../fixtures/adp/personal.html?raw';
import questionsExpect from '../../../fixtures/adp/questions.expect.json';
import questionsHtml from '../../../fixtures/adp/questions.html?raw';
import selfAttestExpect from '../../../fixtures/adp/self-attest.expect.json';
import selfAttestHtml from '../../../fixtures/adp/self-attest.html?raw';
import selfIdExpect from '../../../fixtures/adp/self-id.expect.json';
import selfIdHtml from '../../../fixtures/adp/self-id.html?raw';
import { classifyByRules } from '../../core/resolver/classifyRules';
import { stepSignature } from '../../core/steps/signature';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause, pageChallenged } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { signIn, type SignInContext } from '../../content/sign-in';
import type { ScanResult, ScannedField } from '../../dom/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { configuredHooks } from '../configured';
import { ADP_CONFIG, ADP_SNAPSHOTS, adpAdapter } from './index';

/** The guest page's address (adp-6) and the wizard's (adp-1 to adp-5), as the fixtures' headers keep them. */
const GUEST = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196&ccId=19000101_000001';
const STEPS = 'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196&ccId=19000101_000001&jobId=590196&requisitionId=9207368240764_11&lang=en_US&params=jobId&OTP_login=true';

const CASES = [
  { name: 'guest', html: guestHtml, json: guestExpect, address: GUEST },
  { name: 'code-dialog', html: codeDialogHtml, json: codeDialogExpect, address: GUEST },
  { name: 'personal', html: personalHtml, json: personalExpect, address: STEPS },
  { name: 'questions', html: questionsHtml, json: questionsExpect, address: STEPS },
  { name: 'self-id', html: selfIdHtml, json: selfIdExpect, address: STEPS },
  { name: 'self-attest', html: selfAttestHtml, json: selfAttestExpect, address: STEPS },
] as const;

type CaseName = (typeof CASES)[number]['name'];

afterEach(() => removeFixtures(document));

async function open(name: CaseName) {
  const { html } = CASES.find((each) => each.name === name)!;
  return loadFixture(document, html, SNAPSHOT_VIEWPORT);
}

/** The scan of a case's root with `adapter` (the adapter itself, or one with a rule undone). */
async function scanWith(name: CaseName, adapter: Adapter = adpAdapter): Promise<{ doc: Document; result: ScanResult }> {
  const fixture = await open(name);
  const root = adpAdapter.detect(fixture.doc)!.formRoot;
  return { doc: fixture.doc, result: scan(root, adapter, { platform: 'adp' }) };
}

/** The field whose control (or group, widget) is `selector`'s element, or undefined. */
function fieldAt(doc: Document, result: ScanResult, selector: string): ScannedField | undefined {
  const el = doc.querySelector(selector);
  return result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && (target.control === el || target.widget?.element === el || target.members.includes(el as HTMLInputElement));
  });
}

/** ADP_CONFIG's hooks with one of its states undone (the rule removed). */
function configuredWithout(state: string): Pick<Adapter, 'detect' | 'authState'> {
  const hooks = configuredHooks({ ...ADP_CONFIG, states: (ADP_CONFIG.states ?? []).filter((each) => each.name !== state) });
  return { detect: hooks.detect, authState: hooks.authState };
}

/** The adapter with some of its hooks undone. */
const without = (...hooks: Array<keyof Adapter>): Adapter => {
  const copy: Partial<Adapter> = { ...adpAdapter };
  for (const hook of hooks) delete copy[hook];
  return copy as Adapter;
};

describe('the ADP Workforce Now adapter: its hooks and scans on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect(CASES.map((each) => `fixtures/adp/${each.name}.html`).sort()).toEqual([...ADP_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ name }) => {
    const fixture = await open(name);
    expect(compareHooks(fixture.doc, adpAdapter, readHooks(CASES.find((each) => each.name === name)!.json))).toEqual([]);
  });

  it.each(CASES)('$name: the scan of its root is the expectation', async ({ html, json, address }) => {
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter).toBe(adpAdapter);
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
  });
});

describe('the page states', () => {
  it('pauses on the emailed code (adp-0), the person\'s: nothing is filled or pressed there', async () => {
    const fixture = await open('code-dialog');
    expect(adpAdapter.authState?.(fixture.doc)).toBe('email-code');
    expect(detectPause(fixture.doc, null, adpAdapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
    expect(adpAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:code'] });
    expect(adpAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    expect(adpAdapter.nextButton?.(fixture.doc.body)).toBeNull();
    // The rule undone: the dialog's state gone, the guest page's own state (hidden behind the dialog) is no step, and
    // the adapter claims no root, so the page would fall to the generic adapter.
    const noCode = { ...adpAdapter, ...configuredWithout('code') };
    expect(noCode.authState?.(fixture.doc)).toBeNull();
    expect(noCode.detect(fixture.doc)).toBeNull();
  });

  it('fills the guest page (adp-6) like a step; its Continue, which mails the code, follows Sign-in mode', async () => {
    const fixture = await open('guest');
    const container = fixture.doc.querySelector('div.guest-login-container')!;
    const continueButton = fixture.doc.querySelector<HTMLElement>('#recruitment_login_recaptcha')!;
    expect(adpAdapter.authState?.(fixture.doc)).toBeNull();
    expect(adpAdapter.detect(fixture.doc)?.formRoot).toBe(container);
    expect(adpAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: ['state:guest'] });
    // The behaviour review (minor 2): its account container and Continue shown, the step leads on: not final (never
    // "can't tell", which the agent reads as an unsupported site); its Continue is still no Next.
    expect(adpAdapter.isFinalStep?.(fixture.doc)).toBe('not-final');
    expect(adpAdapter.nextButton?.(fixture.doc.body)).toBeNull();
    // Core pass Z1, item 24: the guest container is the state's declared sign-in container, Continue its button (no box:
    // the names, email and phone are the step's own fields); no never-pressed control any more, the social sign-ins are.
    expect(adpAdapter.signInContainer?.(fixture.doc)).toEqual({ email: null, password: null, confirm: null, terms: [],
      button: continueButton, container });
    const never = adpAdapter.neverPress?.(fixture.doc.body) ?? [];
    expect(never).not.toContain(continueButton);
    // Continue hidden (or the state's container rule undone): the layer can't tell.
    const { signInContainer: _container, ...guest } = ADP_CONFIG.states!.find((state) => state.name === 'guest')!;
    expect(configuredHooks({ ...ADP_CONFIG, states: ADP_CONFIG.states!.map((state) => (state.name === 'guest' ? guest : state)) })
      .isFinalStep?.(fixture.doc)).toBe('unknown');
    continueButton.style.display = 'none';
    expect(adpAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    continueButton.style.display = '';
    expect(never).toContain(fixture.doc.querySelector('#recruitment_login_signInWithGoogle'));
    // Sign-in Auto (container mode, its worker's answer a stand-in) presses Continue alone, at an https address; never
    // at http, never once named never to press again. The page's script is not there, so nothing follows the press.
    const clicks: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push(event.target as Element);
      event.preventDefault();
    }, true);
    const press = (adapter: Adapter, href = GUEST) => signIn({ doc: fixture.doc, adapter, href: () => href,
      channel: { request: async () => ({ ok: true, data: { host: 'workforcenow.adp.com', email: 'guest@example.com', press: true } }) } as unknown as
        SignInContext['channel'],
      isTop: true, container: true, signal: new AbortController().signal, settleMs: 300 });
    expect(await press(adpAdapter, GUEST.replace('https:', 'http:'))).toBe('unavailable');
    const neverAgain: Adapter = { ...adpAdapter, neverPress: (root) => [...(adpAdapter.neverPress?.(root) ?? []),
      continueButton] };
    expect(await press(neverAgain)).toBe('unavailable');
    expect(clicks).toEqual([]);
    await press(adpAdapter);
    expect(clicks).toEqual([continueButton]);
    // The rule undone (no signInContainer): Sign-in Auto finds nothing to press there.
    const undone = configuredHooks({ ...ADP_CONFIG, states: ADP_CONFIG.states!.map((state) => (state.name === 'guest'
      ? { ...state, signInContainer: undefined } : state)) });
    expect(await press({ ...adpAdapter, ...undone })).toBe('unavailable');
    expect(clicks).toHaveLength(1);
    // The rule undone: no root anywhere on the guest page (no #jobApplicationSubmit), so the generic adapter would read it.
    expect(configuredWithout('guest').detect(fixture.doc)).toBeNull();
  });

  it('does not pause on the guest page: its Continue only carries the invisible reCAPTCHA binding (core pass Z1, item 20)',
    async () => {
      // adp-6: <sdf-button id="recruitment_login_recaptcha" class="g-recaptcha ..." role="button" aria-label="Continue">
      // is a button bound to the invisible reCAPTCHA, no drawn challenge (dom/pause-detect.ts boundButton), so the page
      // fills like a step; a challenge its press raises shows as reCAPTCHA's bframe, which pauses as any challenge does.
      const fixture = await open('guest');
      expect(detectPause(fixture.doc, null, adpAdapter)).toBeNull();
      expect(pageChallenged(fixture.doc)).toBe(false);
      // The rule undone (the bound button read as a drawn widget, as before): the guest page paused as a CAPTCHA.
      fixture.doc.querySelector('#recruitment_login_recaptcha')!.removeAttribute('role');
      expect(detectPause(fixture.doc, null, adpAdapter)).toEqual({ kind: 'captcha', evidence: 'captcha-container' });
    });
});

describe('the wizard: one address, its step from the header', () => {
  it('reads each step from its aria-current header item and body, Next on steps 1 to 4, Submit on the last', async () => {
    const seen: Array<{ heading: string | undefined; final: string; next: string | null; submit: string | null }> = [];
    for (const name of ['personal', 'questions', 'self-id', 'self-attest'] as const) {
      const fixture = await open(name);
      const root = adpAdapter.detect(fixture.doc)!.formRoot;
      seen.push({ heading: adpAdapter.stepSignature?.(fixture.doc).heading, final: adpAdapter.isFinalStep!(fixture.doc),
        next: adpAdapter.nextButton?.(root)?.id ?? null, submit: adpAdapter.submitButton?.(root)?.id ?? null });
      removeFixtures(document);
    }
    expect(seen).toEqual([
      { heading: 'Personal Information', final: 'not-final', next: 'ja_sv_cw_next_footer_btn', submit: null },
      { heading: 'Questions', final: 'not-final', next: 'ja_sv_cw_next_footer_btn', submit: null },
      { heading: 'Voluntary Self-ID', final: 'not-final', next: 'ja_sv_cw_next_footer_btn', submit: null },
      { heading: 'Self-Attest & Submit', final: 'final', next: null, submit: 'submitApplication' },
    ]);
  });

  it('tells two steps apart only by the header item and the body, the address being the same', async () => {
    const fixture = await open('questions');
    const signature = adpAdapter.stepSignature!(fixture.doc);
    expect(signature).toEqual({ heading: 'Questions', anchors: ['', '1:shown', '', ''] });
    // The behaviour review (minor 1): the body anchors alone tell the four steps apart, each by its place, not folded
    // into one 'shown' (core/steps/signature.ts keeps a set of anchors).
    const bodies: string[] = [];
    for (const name of ['personal', 'questions', 'self-id', 'self-attest'] as const) {
      removeFixtures(document);
      const step = await open(name);
      bodies.push(stepSignature({ ...adpAdapter.stepSignature!(step.doc), heading: '' }));
    }
    expect(new Set(bodies).size).toBe(4);
    removeFixtures(document);
    await open('questions');
    // The rule undone: the steps' rules removed, the wizard's two steps read alike.
    const plain = configuredHooks({ ...ADP_CONFIG, steps: undefined });
    expect(plain.isFinalStep?.(fixture.doc)).toBe('unknown');
  });

  it('never presses Finish later, Exit, Previous or a header item', async () => {
    const fixture = await open('questions');
    const never = adpAdapter.neverPress!(fixture.doc.body);
    for (const selector of ['#finishLaterApplication', '#ja_sv_exit_btn', '#ja_sv_cw_prev_footer_btn']) {
      expect(never, selector).toContain(fixture.doc.querySelector(selector));
    }
    expect(fixture.doc.querySelectorAll('.mdf-segmented-wizard-header-item')).toHaveLength(6);
    expect(never).not.toContain(fixture.doc.querySelector('#ja_sv_cw_next_footer_btn'));
  });
});

describe('labels, required and widgets no attribute ties', () => {
  it("titles each drawn Yes/No group by its question's label.qLabel, required by its star (adp-2)", async () => {
    const { doc, result } = await scanWith('questions');
    const group = fieldAt(doc, result, '[aria-labelledby="sdf-radio-group-1-label"]')!;
    expect([group.kind, group.label, group.labelSource, group.required, (group.options as Array<{ label: string }>)
      .map((option) => option.label)]).toEqual(['radio', 'Are you legally authorized to work in the USA?', 'adapter', true,
      ['Yes', 'No']]);
    // The rule undone: the group's labelledby target is screen-reader-only, so it has no visible label.
    const plain = await scanWith('questions', without('labelFor'));
    expect(fieldAt(plain.doc, plain.result, '[aria-labelledby="sdf-radio-group-1-label"]')).toMatchObject({ label: '',
      labelSource: 'none', required: false });
  });

  it("titles the Self-ID groups by the h4 that reads as the group's label attribute (adp-3)", async () => {
    const { doc, result } = await scanWith('self-id');
    expect(fieldAt(doc, result, '[aria-labelledby="sdf-radio-group-1-label"]')?.label).toBe('Protected Veteran Status');
    expect(fieldAt(doc, result, '[aria-labelledby="sdf-radio-group-2-label"]')?.label).toBe('Disability Status');
    // A heading that does not read as the label attribute titles nothing.
    doc.querySelector('#vsidDis')!.textContent = 'Something else';
    expect(adpAdapter.labelFor?.(doc.querySelector('[aria-labelledby="sdf-radio-group-2-label"]')!)).toBeNull();
  });

  it('reads the referral question through the real radios in its wfn-radio-button hosts\' shadow roots (adp-2)', async () => {
    const { doc, result } = await scanWith('questions');
    const referral = fieldAt(doc, result, '#refferalOptions')!;
    expect([referral.kind, referral.label, referral.required, (referral.options as Array<{ label: string }>)
      .map((option) => option.label)]).toEqual(['radio', 'Did any of our employees inform you about this position?', false,
      ['Yes', 'No']]);
    const radios = Array.from(doc.querySelectorAll('#refferalOptions > wfn-radio-button'))
      .map((host) => host.shadowRoot!.querySelector('sdf-radio-button[role="radio"]'));
    expect(radios.every((radio) => radio !== null)).toBe(true);
    // Core pass Z2 of 2026-11-06: the members are the shadow radios (dom/scan.ts anatomyOf keeps a declared member across
    // open shadow roots; with Node.contains they were dropped and the group had none).
    expect(result.target(referral.key)?.widget?.members).toEqual(radios);
    expect(referral.current).toEqual({ kind: 'empty' });
    // So the choice is read back from their aria-checked (set here as the page would show a choice).
    radios[0]!.setAttribute('aria-checked', 'true');
    const again = result.rescan();
    expect(fieldAt(doc, again, '#refferalOptions')?.current).toEqual({ kind: 'selected', labels: ['Yes'] });
    // The rule undone: its radios sit in shadow roots with no group the scanner sees, so the question is lost.
    const plain = await scanWith('questions', without('widgetRoots'));
    expect(plain.result.fields.some((field) => field.label.startsWith('Did any of our employees'))).toBe(false);
  });

  it("labels each phone by its own label, not its aria-label \"Phone Number\" (adp-1, adp-6)", async () => {
    const { doc, result } = await scanWith('personal');
    expect(fieldAt(doc, result, '#personalInfomationMobileNumberError')).toMatchObject({ label: 'Mobile Number', required: true });
    expect(fieldAt(doc, result, '#personalInfomationMobileNumberErrorMessage')).toMatchObject({ label: 'Home Phone Number',
      required: false });
    const plain = await scanWith('personal', without('labelFor', 'requiredFor'));
    expect(fieldAt(plain.doc, plain.result, '#personalInfomationMobileNumberError')).toMatchObject({ label: 'Phone Number',
      required: false });
    expect(fieldAt(plain.doc, plain.result, '#personalInfomationMobileNumberErrorMessage')?.label).toBe('Phone Number');
  });

  it("requires the guest page's Mobile Number by its label's class alone (adp-6)", async () => {
    const { doc, result } = await scanWith('guest');
    expect(fieldAt(doc, result, '#login_view_phone')).toMatchObject({ label: 'Mobile Number', labelSource: 'adapter',
      required: true });
    const plain = await scanWith('guest', without('requiredFor'));
    expect(fieldAt(plain.doc, plain.result, '#login_view_phone')?.required).toBe(false);
  });

  it('labels the preferred-name box by the span beside it (adp-1)', async () => {
    const { doc, result } = await scanWith('personal');
    const box = fieldAt(doc, result, 'input[name="usePreferredName"]')!;
    expect([box.kind, box.label, box.labelSource, box.visibility]).toEqual(['checkbox', 'I have a preferred or chosen name',
      'adapter', 'hidden-native-with-visible-label']);
    const plain = await scanWith('personal', without('labelFor'));
    expect(fieldAt(plain.doc, plain.result, 'input[name="usePreferredName"]')?.label).toBe('Preferred or Chosen Name');
  });

  it("shows a react-select's answer by its box while its text box is transparent (adp-3)", async () => {
    const { doc, result } = await scanWith('self-id');
    const gender = fieldAt(doc, result, '#vsidGender')!;
    expect([gender.kind, gender.label, gender.visibility]).toEqual(['combobox', 'Gender', 'visible']);
    expect(result.target(gender.key)?.widget).toMatchObject({ declared: true, bridge: 'react-select',
      box: doc.querySelector('#vsidGender')!.closest('.MDFSelectBox__control') });
    const multi = await scanWith('questions');
    expect(fieldAt(multi.doc, multi.result, '#question_2')?.kind).toBe('multiselect');
    // The rule undone: chosen, its text box is drawn at opacity 0, so it is a hidden control, no field.
    const plain = await scanWith('self-id', without('widgetFor'));
    expect(fieldAt(plain.doc, plain.result, '#vsidGender')).toBeUndefined();
  });

  it('classifies the e-signature as the signature consent, its box as consent the person ticks (adp-4)', async () => {
    const { doc, result } = await scanWith('self-attest');
    const name = fieldAt(doc, result, '#electronicSignature')!;
    expect(name.label).toBe('Please type your full name. electronic signature');
    expect(classifyByRules(toFieldSpec(name))?.category).toBe('consent.signature');
    const box = fieldAt(doc, result, 'input[name="self_att_agree_chk"]')!;
    expect([box.required, classifyByRules(toFieldSpec(box))?.category]).toEqual([true, 'consent.other']);
    // The rule undone: "Please type your full name." alone is no signature to the rules.
    const plain = await scanWith('self-attest', without('labelSuffix'));
    const bare = fieldAt(plain.doc, plain.result, '#electronicSignature')!;
    expect(bare.label).toBe('Please type your full name.');
    expect(classifyByRules(toFieldSpec(bare))?.category).not.toBe('consent.signature');
  });
});
