/*
 * jr7 ADP-7 (FIX7PLAN §6.9, P1): the ADP Workforce Now adapter on the owner's snapshot7 adp1 captures of 2026-11-11
 * (one application, from its posting to its confirmation, converted as fixtures/adp/jr7-adp1-*.html: ADP_JR7_SNAPSHOTS),
 * the auditor's harness (SP\jr7\adp-work, a print-out) turned into asserts, and the package's findings:
 * - the page table: each page's address, root, state, step, finality, Next, Submit, entry, posting text and success
 *   sign; ADP never in Run auto-apply (ADP7-1: a one-time code per application);
 * - ADP7-2 (adapter half): Address Line 1, read-only while ADP's address lookup starts, is reset by the Country's write
 *   (dependsOn), so the books decide it again after that write;
 * - ADP7-5: the State list's "XX - Name" rows (jr6 AD-R1, in jr6-done) on snapshot7's list;
 * - ADP7-10 (owner question Q7-14, default yes): the signed-in landing's "Complete Your Application" is an entry;
 * - ADP7-13: the Questions step's number and sum boxes are laid out as one number.
 * Planned with the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants of it built here; no value of
 * the owner's appears, and the employer a question names is never written here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { dependenciesOf } from '../../content/pass';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { newSuccessSign, shownSignsOf, successShown } from '../../content/submitted';
import { agentApplicationUrl, AUTOFILL_AGENT_ATS } from '../../contract/tailorit';
import { createLoop, mayWrite, observeScan, recordRows, recordWrite } from '../../core/loop/bookkeeping';
import { mac } from '../../core/loop/loop.testkit';
import { answerRefusal, answerText } from '../../core/plan/answers';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { BaseKey } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, ScannedField, WidgetReading } from '../../dom/types';
import { deadline, startDeadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks, configuredSuccessSigns } from '../configured';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { ADP_CONFIG, ADP_JR7_SNAPSHOTS, adpAdapter } from './index';

const PAGES = import.meta.glob(['../../../fixtures/adp/jr7-adp1-*.html', '../../../fixtures/adp/jr6-landing.html',
  '../../../fixtures/adp/questions.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const page = (name: string): string => {
  const html = PAGES[`../../../fixtures/adp/${name}.html`];
  if (html === undefined) throw new Error(`no fixture ${name}`);
  return html;
};
/** A case's captured address (its header's source). */
const sourceOf = (name: string): URL => new URL(/"source":"([^"]+)"/.exec(page(name))![1]!);

afterEach(() => removeFixtures(document));

const open = (name: string): Promise<Fixture> => loadFixture(document, page(name), SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

/** The field whose control or widget element is `el`. */
const fieldOf = (result: ScanResult, el: Element | null): ScannedField | undefined =>
  result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && (target.control === el || target.widget?.element === el);
  });

/** Every click a fixture's document receives, held (nothing navigates), named by its aria-label, else its id. */
function heldClicks(fixture: Fixture): string[] {
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    clicks.push(target.getAttribute('aria-label') ?? (target.id || target.localName));
    event.preventDefault();
  }, true);
  return clicks;
}

/** ADP's modal focus trap undone where it stands (a pane closed): every element it hid gets its own aria-hidden back
 *  (data-old-aria-hidden, "null" for none), and the trap's markers go. */
function undoFocusTrap(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('[data-old-aria-hidden]'))) {
    const old = el.getAttribute('data-old-aria-hidden');
    if (old === null || old === 'null') el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', old);
    el.removeAttribute('data-old-aria-hidden');
  }
}

// ── The page table (the auditor's harness, as asserts) ─────────────────────────────────────────────────────────────

interface Row {
  /** The form root's selector, or null. */
  detect: string | null;
  auth: ReturnType<NonNullable<Adapter['authState']>>;
  /** A state's anchor, or the step's heading. */
  step: string | null;
  final: 'final' | 'not-final' | 'unknown';
  next: string | null;
  submit: string | null;
  /** The entry control's aria-label, else its id. */
  entry: string | null;
  posting: boolean;
  /** The captured address: the details' (recruitment.html) or the signed-in wizard's (postLogin.html). */
  path: 'details' | 'wizard';
}

const WIZARD = { detect: '#jobApplicationSubmit', auth: null, entry: null, posting: false, path: 'wizard' } as const;
const STEP = (heading: string): Row => ({ ...WIZARD, step: heading, final: 'not-final', next: 'ja_sv_cw_next_footer_btn',
  submit: null });
const LAST = (): Row => ({ ...WIZARD, step: 'Self-Attest & Submit', final: 'final', next: null, submit: 'submitApplication' });
const NONE = { detect: null, final: 'unknown', next: null, submit: null } as const;
const DETAILS = { ...NONE, auth: null, step: null, entry: 'recruitment_jobDescription_apply', posting: true,
  path: 'details' } as const;
const CODE_CHOICE = { ...NONE, auth: 'email-code', step: 'state:code-choice', entry: null, posting: false,
  path: 'details' } as const;

/** snapshot7 adp1, in the order the captures were taken (BRIEF7's table: 16 captures, one application). */
const TABLE: Record<string, Row> = {
  'jr7-adp1-posting': DETAILS,
  'jr7-adp1-posting-2': DETAILS,
  'jr7-adp1-consent': { ...NONE, auth: 'entry-choice', step: 'state:consent', entry: 'Consent & Continue', posting: false,
    path: 'details' },
  'jr7-adp1-guest': { detect: 'div.guest-login-container', auth: null, step: 'state:guest', final: 'not-final', next: null,
    submit: null, entry: null, posting: false, path: 'details' },
  'jr7-adp1-code-choice': CODE_CHOICE,
  'jr7-adp1-code-choice-2': CODE_CHOICE,
  'jr7-adp1-code': { ...NONE, detect: 'sdf-focus-pane#login_view_show_opt_dialog div.otpDialogContent',
    auth: 'email-code', step: 'state:code', entry: null, posting: false, path: 'details' },
  'jr7-adp1-personal-blank': STEP('Personal Information'),
  'jr7-adp1-personal-filled': STEP('Personal Information'),
  'jr7-adp1-resume': STEP('Resume'),
  'jr7-adp1-questions-filled': STEP('Questions'),
  'jr7-adp1-review': STEP('Review your application'),
  'jr7-adp1-self-attest-blank': LAST(),
  'jr7-adp1-self-attest-ticked': LAST(),
  'jr7-adp1-self-attest-signed': LAST(),
  'jr7-adp1-confirmation': { ...NONE, auth: null, step: null, entry: null, posting: false, path: 'wizard' },
};

/** The page after Submit (jr6 ADP-6's rule, Jobright's ats-submission-rules adp-workforcenow). */
const SIGN = '#vdlContainerFluid.success-card .success-message-container p.message';

describe('jr7 ADP: the page table of the owner’s snapshot7 adp1 captures', () => {
  it('names the 16 jr7 pages it was read from, each a committed fixture', () => {
    expect(ADP_JR7_SNAPSHOTS.map((path) => path.replace(/^fixtures\/adp\/|\.html$/g, ''))).toEqual(Object.keys(TABLE));
    for (const path of ADP_JR7_SNAPSHOTS) expect(PAGES[`../../../${path}`], path).toBeTypeOf('string');
    expect(ADP_CONFIG.snapshots).toEqual(expect.arrayContaining(Object.keys(TABLE)));
  });

  it.each(Object.entries(TABLE))('%s: root, state, step, finality, Next, Submit, entry, posting text and success sign',
    async (name, row) => {
      const fixture = await open(name);
      const { doc } = fixture;
      const root = adpAdapter.detect(doc)?.formRoot ?? null;
      expect(root).toBe(row.detect === null ? null : doc.querySelector(row.detect));
      expect(adpAdapter.authState!(doc)).toBe(row.auth);
      const signature = adpAdapter.stepSignature!(doc);
      expect(signature.heading ?? signature.anchors.find((anchor) => anchor.startsWith('state:')) ?? null).toBe(row.step);
      expect(adpAdapter.isFinalStep!(doc)).toBe(row.final);
      expect(root === null ? null : adpAdapter.nextButton!(root)?.id ?? null).toBe(row.next);
      expect(root === null ? null : adpAdapter.submitButton!(root)?.id ?? null).toBe(row.submit);
      const entry = adpAdapter.entryControl!(doc);
      expect(entry === null ? null : entry.getAttribute('aria-label') ?? entry.id).toBe(row.entry);
      expect(adpAdapter.postingText!(doc) !== null).toBe(row.posting);
      // FIX7PLAN §7's rule for a success sign: shown on the page after Submit alone (1 there, 0 on every other page).
      const confirmation = name === 'jr7-adp1-confirmation';
      expect(successShown(doc, 'adp')).toBe(confirmation);
      expect(shownSignsOf(doc, 'adp').size).toBe(confirmation ? 1 : 0);
      // The captured address: the details' address before the code, the signed-in wizard's after it.
      const url = sourceOf(name);
      expect(url.pathname).toBe(row.path === 'details' ? '/mascsr/default/mdf/recruitment/recruitment.html'
        : '/mascsr/applicant/mdf/recruitment/postLogin.html');
    });

  it('keeps every page of the application under the posting’s one key, an ADP application address', () => {
    const posting = applicationOf(sourceOf('jr7-adp1-posting'));
    expect(posting?.page).toBe('application');
    for (const name of Object.keys(TABLE)) {
      const app = applicationOf(sourceOf(name));
      expect([app?.page, app?.applicationKey === posting?.applicationKey], name).toEqual(['application', true]);
    }
  });

  it('ADP7-1: ADP never joins Run auto-apply: no agent address on any page, and not in AUTOFILL_AGENT_ATS (a one-time '
    + 'code per application, the person’s)', () => {
    expect((AUTOFILL_AGENT_ATS as readonly string[]).includes('adp')).toBe(false);
    for (const name of Object.keys(TABLE)) expect(agentApplicationUrl(sourceOf(name).href), name).toBeNull();
  });
});

// ── The entry, the code and the page after Submit, on snapshot7 ─────────────────────────────────────────────────────

describe('jr7 ADP: the entry, the code panes and the confirmation (snapshot7 adp1)', () => {
  it('the details show both Apply buttons; the entry door presses the header’s alone, once (jr7-adp1-posting)',
    async () => {
      const fixture = await open('jr7-adp1-posting');
      const { doc } = fixture;
      const header = q(fixture, 'button#recruitment_jobDescription_apply');
      const bottom = q(fixture, 'button#recruitment_jobDescription_candidateApply');
      expect([isUserVisible(header), isUserVisible(bottom)]).toEqual([true, true]);
      expect(adpAdapter.entryControl!(doc)).toBe(header);
      // Never "Complete Your Application" here: the details of a new application draw none.
      expect(doc.querySelector('button#recruitment_jobDescription_complete')).toBeNull();
      const clicks = heldClicks(fixture);
      const answer = await pressEntry(doc, [adpAdapter], new AbortController().signal, 1_500, 1_500);
      expect(answer.outcome).toBe('pressed');
      expect(clicks).toEqual(['recruitment_jobDescription_apply']);
    }, 30_000);

  it('presses Apply, then the pane’s Consent & Continue drawn in place, never Decline (jr7-adp1-consent)', async () => {
    const fixture = await open('jr7-adp1-consent');
    const { doc } = fixture;
    const pane = q(fixture, 'sdf-focus-pane#jdv_privacy_dailog');
    const at = { parent: pane.parentNode!, next: pane.nextSibling };
    const trapped = Array.from(doc.querySelectorAll('[data-old-aria-hidden]'))
      .map((el) => [el, el.getAttribute('aria-hidden'), el.getAttribute('data-old-aria-hidden')] as const);
    pane.remove();
    undoFocusTrap(doc);
    expect(adpAdapter.entryControl!(doc)?.id).toBe('recruitment_jobDescription_apply');
    // ADP's script stood in for: Apply draws the pane 300 ms later, its focus trap with it.
    doc.addEventListener('click', (event) => {
      if ((event.target as Element).id !== 'recruitment_jobDescription_apply') return;
      startDeadline(300, () => {
        at.parent.insertBefore(pane, at.next);
        for (const [el, hidden, old] of trapped) {
          if (hidden !== null) el.setAttribute('aria-hidden', hidden);
          if (old !== null) el.setAttribute('data-old-aria-hidden', old);
        }
      });
    }, true);
    const clicks = heldClicks(fixture);
    expect((await pressEntry(doc, [adpAdapter], new AbortController().signal, 3_000, 3_000)).outcome).toBe('pressed');
    await deadline(300);
    expect(clicks).toEqual(['recruitment_jobDescription_apply', 'Consent & Continue']);
  }, 30_000);

  it('the pane alone: its choice presses Consent & Continue (jr7-adp1-consent)', async () => {
    const fixture = await open('jr7-adp1-consent');
    const clicks = heldClicks(fixture);
    expect(pressEntryChoice(fixture.doc, adpAdapter)).toBe('pressed');
    expect(clicks).toEqual(['Consent & Continue']);
  });

  // The code choice holds no form (the entry door is blocked there); the code's pane is the state's root (a form: the
  // door offers nothing). Either way nothing is pressed: Send, Verify and Resend Code are the person's.
  it.each([['jr7-adp1-code-choice', { outcome: 'blocked', block: 'email-code' }],
    ['jr7-adp1-code-choice-2', { outcome: 'blocked', block: 'email-code' }],
    ['jr7-adp1-code', { outcome: 'not-offered' }]] as const)(
    '%s: the person’s email-code pause: nothing offered or pressed', async (name, door) => {
      const fixture = await open(name);
      const { doc } = fixture;
      const root = adpAdapter.detect(doc)?.formRoot ?? null;
      expect(detectPause(doc, root, adpAdapter)).toMatchObject({ kind: 'email-code' });
      const clicks = heldClicks(fixture);
      expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 300, 300)).toEqual(door);
      expect(clicks).toEqual([]);
    });

  it('the guest page is the guest state, its Continue the declared sign-in button; the entry stops at it '
    + '(jr7-adp1-guest)', async () => {
    const fixture = await open('jr7-adp1-guest');
    const { doc } = fixture;
    const container = q(fixture, 'div.guest-login-container');
    expect(adpAdapter.signInContainer!(doc)?.button).toBe(q(fixture, 'sdf-button#recruitment_login_recaptcha'));
    const clicks = heldClicks(fixture);
    expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'not-offered' });
    expect(clicks).toEqual([]);
    const result = scan(container, adpAdapter, { platform: 'adp' });
    expect(result.fields.map((field) => field.label)).toEqual(['First Name', 'Last Name', 'Email', 'Mobile Number']);
  });

  it('the page after Submit shows the sign, new once the wizard’s root is gone (jr7-adp1-confirmation)', async () => {
    const fixture = await open('jr7-adp1-confirmation');
    const { doc } = fixture;
    const sign = q(fixture, SIGN);
    // No promo over it in this capture: the sign is shown as it is.
    expect(isUserVisible(sign)).toBe(true);
    expect(configuredSuccessSigns(doc, ADP_CONFIG)).toEqual([sign]);
    expect([...shownSignsOf(doc, 'adp')]).toEqual([sign]);
    const root = doc.createElement('div');
    expect(newSuccessSign(doc, 'adp', { before: new Set(), root, adapter: adpAdapter })).toBe(sign);
    // Its companion is required: without "Thank You!" there is no sign.
    q(fixture, '.success-message-container span.message-header').textContent = 'Thanks';
    expect(configuredSuccessSigns(doc, ADP_CONFIG)).toEqual([]);
  });
});

// ── ADP7-10: "Complete Your Application" (owner question Q7-14, default yes) ────────────────────────────────────────

describe('jr7 ADP7-10: the signed-in landing’s "Complete Your Application" is an entry', () => {
  it('is offered on the landing and pressed once, alone; never Back (jr6-landing)', async () => {
    const fixture = await open('jr6-landing');
    const { doc } = fixture;
    const complete = q(fixture, 'button#recruitment_jobDescription_complete');
    expect(complete.textContent?.trim()).toBe('Complete Your Application');
    expect(isUserVisible(complete)).toBe(true);
    // The landing: the posting's text, no form, no state, no Apply.
    expect([adpAdapter.detect(doc), adpAdapter.authState!(doc)]).toEqual([null, null]);
    expect(doc.querySelector('button#recruitment_jobDescription_apply, button#recruitment_jobDescription_candidateApply'))
      .toBeNull();
    expect(adpAdapter.entryControl!(doc)).toBe(complete);
    // A run never presses it (the entry door alone does), nor Back.
    const never = adpAdapter.neverPress!(doc.body);
    expect(never).toContain(complete);
    expect(never).toContain(q(fixture, 'button#recruitment_jobDescription_back'));
    const clicks = heldClicks(fixture);
    expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 1_500, 1_500))
      .toMatchObject({ outcome: 'pressed' });
    expect(clicks).toEqual(['recruitment_jobDescription_complete']);
    // The rule undone (the two Apply buttons alone): nothing is offered on the landing.
    const undone = configuredHooks({ ...ADP_CONFIG, posting: { ...ADP_CONFIG.posting!,
      entry: 'button#recruitment_jobDescription_apply, button#recruitment_jobDescription_candidateApply' } });
    expect(undone.entryControl!(doc)).toBeNull();
  }, 30_000);
});

// ── ADP7-2 (adapter half): Address Line 1 decided again after the Country's write ─────────────────────────────────────

const golden = goldenProfile();

/** A page planned as a run plans it: scanned with `lists` read (by the field's control id) and planned with `profile`
 *  (the golden one by default) and DEFAULT_SETTINGS. */
interface Planned {
  fixture: Fixture;
  result: ScanResult;
  out: PlanOutput;
  field(name: string): ScannedField;
  row(name: string): FillResult;
  write(name: string): PlannedWrite | undefined;
  /** The AI ask of the field: its scope and layout, or null. */
  asked(name: string): { scope: string; format: string | null } | null;
}

function planOf(fixture: Fixture, name: string, result: ScanResult, profile: Profile): Planned {
  const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile, sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
  const field = (wanted: string) => {
    const found = result.fields.find((each) => each.label === wanted) ?? result.fields.find((each) => each.idAttr === wanted);
    if (found === undefined) throw new Error(`no field "${wanted}" on ${name}`);
    return found;
  };
  return { fixture, result, out, field,
    row: (wanted) => out.results.find((row) => row.key === field(wanted).key)!,
    write: (wanted) => out.writes.find((write) => write.key === field(wanted).key),
    asked: (wanted) => {
      const answer = out.ask?.answers?.find((item) => item.key === field(wanted).key);
      return answer === undefined ? null : { scope: answer.scope, format: answer.format };
    } };
}

async function planned(name: string, options: { profile?: Profile; lists?: Readonly<Record<string, readonly string[]>>;
  adapter?: Adapter } = {}): Promise<Planned> {
  const fixture = await open(name);
  const adapter = options.adapter ?? adpAdapter;
  const root = adapter.detect(fixture.doc)!.formRoot;
  const first = scan(root, adapter, { platform: 'adp' });
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields) {
    const labels = options.lists?.[field.idAttr];
    if (labels === undefined) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: field.kind === 'multiselect', complete: true,
      options: labels.map((label) => ({ label, disabled: false })) });
  }
  return planOf(fixture, name, scan(root, adapter, { platform: 'adp', widgetReadings: readings }), options.profile ?? golden);
}

/** ADP's dependsOn with its jr7 line undone (the State's alone, as jr6 left it). */
const withoutLine1: Adapter = { ...adpAdapter,
  dependsOn: (control) => (control.id === 'PersonalAddress_address_line1' ? null : adpAdapter.dependsOn!(control)) };

const LINE1 = 'input#PersonalAddress_address_line1';

describe('jr7 ADP7-2 (adapter half): Address Line 1, read-only while ADP’s lookup starts, is reset by the Country',
  () => {
    it.each(['jr7-adp1-personal-blank', 'jr7-adp1-personal-filled'])(
      '%s: Address Line 1 and the State name the Country their parent, nothing else does', async (name) => {
        const fixture = await open(name);
        const result = scan(adpAdapter.detect(fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
        const base = (id: string) => result.fields.find((field) => field.idAttr === id)!.baseKey;
        const parents = dependenciesOf(result, adpAdapter);
        const country = base('PersonalAddress_country');
        expect(Object.fromEntries(parents)).toEqual({ [base('PersonalAddress_address_line1')]: country,
          [base('PersonalAddress_state')]: country });
        // The rule undone: the State's alone.
        expect([...dependenciesOf(result, withoutLine1).keys()]).toEqual([base('PersonalAddress_state')]);
      });

    it('as loaded (jr7-adp1-personal-blank) the box is required, read-only ("Initializing...") and skipped; writable '
      + 'after the Country’s write, the books plan it again and the plan types the golden street', async () => {
      const ran = await planned('jr7-adp1-personal-blank');
      const box = q<HTMLInputElement>(ran.fixture, LINE1);
      expect([box.readOnly, box.getAttribute('placeholder'), box.value]).toEqual([true, 'Initializing...', '']);
      const line1 = fieldOf(ran.result, box)!;
      expect([line1.label, line1.required]).toEqual(['Address Line 1', true]);
      expect(ran.row('Address Line 1')).toMatchObject({ status: 'skipped', reason: 'disabled-or-readonly', wrote: false });
      const country = ran.field('PersonalAddress_country');

      // The books after pass 1: every row recorded, then the Country written (its value as the page would show it).
      const specs = ran.result.fields.map(toFieldSpec);
      const settled = recordRows(observeScan(createLoop(), specs, { dependsOn: dependenciesOf(ran.result, adpAdapter) })
        .state, ran.out.results);
      const books = recordRows(recordWrite(settled, country.key, { valueMac: mac('United States') }),
        [{ ...ran.row('PersonalAddress_country'), status: 'verified', wrote: true, reason: 'ok' }]);
      // ADP's lookup ready (stood in for: the page's own change, jr7-adp1-personal-filled's box).
      box.removeAttribute('readonly');
      box.setAttribute('placeholder', 'Enter a location');
      box.classList.add('pac-target-input');
      const again = scan(adpAdapter.detect(ran.fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
      const valueMacs = new Map([[country.baseKey, mac('United States')]]);
      const seen = observeScan(books, again.fields.map(toFieldSpec), { valueMacs,
        dependsOn: dependenciesOf(again, adpAdapter) });
      expect(seen.state.fields.get(line1.baseKey)).toMatchObject({ status: 'pending', cause: 'parent-written' });
      expect(mayWrite(seen.state, fieldOf(again, box)!.key)).toBe(true);
      // Planned again, the box writable: the golden street.
      const replanned = planOf(ran.fixture, 'jr7-adp1-personal-blank', again, golden);
      const write = replanned.write('Address Line 1');
      expect(write?.value.kind === 'text' ? write.value.text : undefined).toBe(golden.address!.line1);
      // The rule undone (the State's alone): the box stays decided, nothing plans it again.
      const plain = observeScan(books, again.fields.map(toFieldSpec), { valueMacs,
        dependsOn: dependenciesOf(again, withoutLine1) });
      expect(plain.state.fields.get(line1.baseKey)?.status).toBe('resolved');
      expect(plain.pending).not.toContain(fieldOf(again, box)!.key);
    });

    it('the Country’s write comes first in a pass that writes both (jr7-adp1-personal-filled, the box writable)',
      async () => {
        const ran = await planned('jr7-adp1-personal-filled');
        const box = q<HTMLInputElement>(ran.fixture, LINE1);
        expect([box.readOnly, box.getAttribute('placeholder')]).toEqual([false, 'Enter a location']);
        expect(ran.row('Address Line 1')).toMatchObject({ category: 'address.line1' });
        const write = ran.write('Address Line 1');
        expect(write?.value.kind === 'text' ? write.value.text : undefined).toBe(golden.address!.line1);
      });
  });

// ── ADP7-5: the State list's "XX - Name" rows (jr6 AD-R1) on snapshot7's list ───────────────────────────────────────

describe('jr7 ADP7-5: the State’s rows "XX - Name" (jr7-adp1-personal-filled)', () => {
  it('the State is ADP’s required list once the Country is chosen, and the golden region is chosen from its rows',
    async () => {
      const ran = await planned('jr7-adp1-personal-filled');
      const host = q(ran.fixture, 'wfn-dropdown-list#PersonalAddress_state');
      const state = fieldOf(ran.result, host)!;
      expect([state.label, state.kind, state.required]).toEqual(['State / Territory', 'combobox', true]);
      expect(ran.row('State / Territory').category).toBe('address.region');
      const write = ran.write('State / Territory');
      expect(write?.value.kind === 'option' ? write.value.cleanLabel : write?.value.kind).toBe('TX - Texas');
    });
});

// ── ADP7-13: the Questions step's number and sum boxes ───────────────────────────────────────────────────────────

/** ADP's formatFor with its jr7 lines undone (the date picker's alone). */
const withoutNumbers: Adapter = { ...adpAdapter,
  formatFor: (control) => (control.matches('input.vdl-date-time-picker__input') ? adpAdapter.formatFor!(control) : null) };

describe('jr7 ADP7-13: a question’s number and sum boxes are laid out as one number', () => {
  it('jr7-adp1-questions-filled: the years box is a number, the hourly rate a sum; the AI asks carry the layouts',
    async () => {
      const ran = await planned('jr7-adp1-questions-filled');
      const years = q(ran.fixture, 'input#question_0');
      const rate = q(ran.fixture, 'input#question_1');
      expect([years.closest('div.qMainDiv') !== null, rate.closest('div.qMainDiv') !== null]).toEqual([true, true]);
      expect([adpAdapter.formatFor!(years), adpAdapter.formatFor!(rate)])
        .toEqual([{ format: 'number' }, { format: 'currency' }]);
      const yearsField = fieldOf(ran.result, years)!;
      const rateField = fieldOf(ran.result, rate)!;
      expect([yearsField.label, yearsField.required, toFieldSpec(yearsField).constraints.format])
        .toEqual(['How many years of related experience do you have?', true, 'number']);
      expect([rateField.label, rateField.required, toFieldSpec(rateField).constraints.format])
        .toEqual(['What is the minimum hourly rate you would consider for this position?', true, 'currency']);
      expect(ran.asked('question_0')?.format).toBe('number');
      expect(ran.asked('question_1')?.format).toBe('currency');
      // The other questions keep no layout of ours: the time zone list, the currency list beside the rate.
      for (const other of ['question_2', 'question_currency_type_1']) {
        expect(adpAdapter.formatFor!(q(ran.fixture, `#${other}`)), other).toBeNull();
      }
      // The rule undone: the asks go out with no layout (free text), as the verifier measured.
      const plain = await planned('jr7-adp1-questions-filled', { adapter: withoutNumbers });
      expect([plain.asked('question_0')?.format, plain.asked('question_1')?.format]).toEqual([null, null]);
    });

  it('questions (the 2026-11-06 employer): question_8 is the same sum box', async () => {
    const fixture = await open('questions');
    const box = q(fixture, 'input#question_8');
    expect(box.closest('div.qMainDiv')).not.toBeNull();
    expect(adpAdapter.formatFor!(box)).toEqual({ format: 'currency' });
    const result = scan(adpAdapter.detect(fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
    expect(toFieldSpec(fieldOf(result, box)!).constraints.format).toBe('currency');
  });

  it('a profile value is still typed in the number box (the years question worded as RULES reads it today)',
    async () => {
      // "related" is RULES-7's word to add (ADP7-9); "relevant" is read today: the box relabelled in the page here.
      const fixture = await open('jr7-adp1-questions-filled');
      const label = fixture.doc.querySelector('label.qLabel[for="question_0"] wfn-text') ?? fixture.doc
        .querySelector('label.qLabel[for="question_0"]')!;
      const words = Array.from(label.childNodes).find((node) => node.nodeType === 3 && /related/.test(node.textContent ?? ''));
      expect(words).toBeDefined();
      words!.textContent = words!.textContent!.replace('related', 'relevant');
      const result = scan(adpAdapter.detect(fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
      const ran = planOf(fixture, 'jr7-adp1-questions-filled', result, golden);
      expect(ran.row('How many years of relevant experience do you have?').category).toBe('experience.totalYears');
      const write = ran.write('How many years of relevant experience do you have?');
      expect(write?.value.kind).toBe('text');
      const typed = write?.value.kind === 'text' ? write.value.text : '';
      expect(typed).toMatch(/^\d+$/);
      expect(toFieldSpec(fieldOf(result, q(fixture, 'input#question_0'))!).constraints.format).toBe('number');
    });

  it('an AI answer in the sum box is written as its one number, and words are refused (plan/answers.ts)', async () => {
    const fixture = await open('jr7-adp1-questions-filled');
    const rate = q(fixture, 'input#question_1');
    const specOf = (adapter: Adapter) => {
      const result = scan(adapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'adp' });
      return toFieldSpec(fieldOf(result, rate)!);
    };
    const laid = specOf(adpAdapter);
    expect(answerText(laid, '$25.50')).toBe('25.5');
    expect(answerRefusal(laid, 'about twenty dollars an hour')).toBe('llm-invalid-output');
    // The rule undone: the words would be typed into ADP's sum box as they are.
    const plain = specOf(withoutNumbers);
    expect(answerText(plain, 'about twenty dollars an hour')).toBe('about twenty dollars an hour');
    expect(answerRefusal(plain, 'about twenty dollars an hour')).toBeNull();
  });
});
