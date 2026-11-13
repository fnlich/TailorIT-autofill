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
 * P2 (FIX7PLAN §6.9 "P2", after merging jr7-engine-e2, jr7-rules-r2, jr7-auto-done, jr7-chain-done): the shared outcomes
 * on these pages, the real content runtime with a fake worker where the engine drives:
 * - ADP7-2 with ENGINE-7 E2 item 1: Address Line 1 read-only as loaded, written once the page lets it in; never let in,
 *   flagged for the person; the locked Email carried over from the guest page never waits;
 * - ADP7-7 (E2 item 2, O-5): past the code, Personal Information is filled with no Continue;
 * - RULES-7's ADP7-3, ADP7-4, ADP7-8 and ADP7-9 on the Questions step;
 * - the self-ID decline box decided again at its list's first read (E2's jr6 leftover L2, through ADP's dependsOn).
 * Planned with the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants of it built here; no value of
 * the owner's appears, and the employer a question names is never written here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { dependenciesOf } from '../../content/pass';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
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
  '../../../fixtures/adp/questions.html', '../../../fixtures/adp/self-id.html', '../../../fixtures/adp/jr6-self-id-blank.html'],
{ query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const page = (name: string): string => {
  const html = PAGES[`../../../fixtures/adp/${name}.html`];
  if (html === undefined) throw new Error(`no fixture ${name}`);
  return html;
};
/** A case's captured address (its header's source). */
const sourceOf = (name: string): URL => new URL(/"source":"([^"]+)"/.exec(page(name))![1]!);

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

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
      // The golden profile has no pay: the rate is asked of the AI, as one sum. (Its years, since RULES-7's ADP7-9, are
      // the profile's: typed, never asked; P2 below.)
      expect(ran.asked('question_1')?.format).toBe('currency');
      // The other questions keep no layout of ours: the time zone list, the currency list beside the rate.
      for (const other of ['question_2', 'question_currency_type_1']) {
        expect(adpAdapter.formatFor!(q(ran.fixture, `#${other}`)), other).toBeNull();
      }
      // A profile with no experience entries: its years are asked of the AI too, as one number.
      removeFixtures(document);
      const noYears = await planned('jr7-adp1-questions-filled', { profile: { ...golden, experience: [] } });
      expect(noYears.asked('question_0')?.format).toBe('number');
      // The rule undone: the asks go out with no layout (free text), as the verifier measured.
      removeFixtures(document);
      const plain = await planned('jr7-adp1-questions-filled', { adapter: withoutNumbers,
        profile: { ...golden, experience: [] } });
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

  it('a profile value is still typed in the number box (the years question worded "relevant", as RULES read it before '
    + 'ADP7-9)', async () => {
      // RULES-7's ADP7-9 reads "related" too (P2 below asserts the page's own words); "relevant" here, relabelled.
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

// ══ P2 (FIX7PLAN §6.9 "P2"): ENGINE-7 E2, RULES-7 R1-R2 and E2's jr6 leftovers on ADP's pages ════════════════════════

/** A case's page in the real content runtime at its own captured address (adapters: ADP's and the generic one), with
 *  a fake worker planning by the real planFrame over the golden synthetic profile and DEFAULT_SETTINGS. */
async function runAt(name: string, worker = createFakeWorker({ settings: DEFAULT_SETTINGS })) {
  testVocab();
  const fixture = await open(name);
  const source = sourceOf(name).href;
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => source, isTop: true,
    settle: { quietMs: 100 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

/** The last report's rows, by label. */
const rowsOf = (worker: ReturnType<typeof createFakeWorker>) =>
  new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));

/** jr7-adp1-personal-blank as ADP draws it before a run: the Email the guest page carried over shown in its locked box
 *  (the converter empties every typed value; the golden email stands in), and Address Line 1 read-only while ADP's
 *  lookup starts, made writable (as jr7-adp1-personal-filled draws it) `readyMs` after the run starts, or never. */
function asLoaded(fixture: Fixture, readyMs: number | null): HTMLInputElement {
  const email = q<HTMLInputElement>(fixture, 'input#personalInfomationEmail');
  expect([email.disabled, email.value]).toEqual([true, '']);
  email.value = golden.contact.email;
  const line1 = q<HTMLInputElement>(fixture, LINE1);
  expect([line1.readOnly, line1.getAttribute('placeholder')]).toEqual([true, 'Initializing...']);
  const ready = () => {
    line1.removeAttribute('readonly');
    line1.setAttribute('placeholder', 'Enter a location');
    line1.classList.add('pac-target-input');
  };
  if (readyMs !== null) startDeadline(readyMs, ready);
  return line1;
}

describe('jr7 ADP P2 ADP7-2 with ENGINE-7 E2 item 1: Address Line 1 as loaded, in the real runtime '
  + '(jr7-adp1-personal-blank; the auditor’s run harness as asserts)', () => {
  for (const readyMs of [400, 1_500]) {
    it(`writable ${readyMs} ms into the run: waited for, then written with the golden street and verified`, async () => {
      const { fixture, worker, runtime } = await runAt('jr7-adp1-personal-blank');
      const line1 = asLoaded(fixture, readyMs);
      await runtime.fill();
      expect(line1.value).toBe(golden.address!.line1);
      expect(rowsOf(worker).get('Address Line 1')).toMatchObject({ status: 'verified', wrote: true });
      // The Email the page locked, holding its value: skipped, never waited for, never the person's to do.
      expect(rowsOf(worker).get('Email')).toMatchObject({ status: 'skipped', reason: 'disabled-or-readonly',
        needsUserAction: false });
      expect(q<HTMLInputElement>(fixture, 'input#personalInfomationEmail').value).toBe(golden.contact.email);
    }, 90_000);
  }

  it('never writable: flagged for the person past the bound; the loop ends with nothing pending, not cut', async () => {
    const logs = vi.spyOn(console, 'info');
    try {
      const { fixture, worker, runtime } = await runAt('jr7-adp1-personal-blank');
      const line1 = asLoaded(fixture, null);
      await runtime.fill();
      expect(line1.value).toBe('');
      expect(rowsOf(worker).get('Address Line 1')).toMatchObject({ status: 'flagged', reason: 'disabled-or-readonly',
        wrote: false, needsUserAction: true });
      // The rest of the step is filled as before: the names typed.
      expect(rowsOf(worker).get('First Name')).toMatchObject({ status: 'verified', wrote: true });
      expect(rowsOf(worker).get('Last Name')).toMatchObject({ status: 'verified', wrote: true });
      const ended = logs.mock.calls.filter((call) => call[0] === '[tailorit-autofill] content.loop-ended')
        .map((call) => call[1] as { cut: boolean; nothingPending: boolean });
      expect(ended.at(-1)).toMatchObject({ cut: false, nothingPending: true });
    } finally {
      logs.mockRestore();
    }
  }, 90_000);
});

describe('jr7 ADP P2 ADP7-7 with ENGINE-7 E2 item 2 (O-5): past the code, Personal Information goes on by itself', () => {
  it('jr7-adp1-code → jr7-adp1-personal-blank: one resumed run fills the step with no Continue, and waits for '
    + 'Address Line 1 still read-only at its start', async () => {
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    // The code: the person's pause (the OTP pane's content is the state's root; nothing is typed in it).
    const code = await runAt('jr7-adp1-code', worker);
    expect(await code.runtime.fill()).toBe('paused');
    expect(worker.runStates.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'email-code' });
    expect(q<HTMLInputElement>(code.fixture, 'input#oneTimePassWord').value).toBe('');
    code.runtime.stop();
    removeFixtures(document);
    const begun = worker.of('run/begin').length;
    const reported = worker.reports.length;

    // The person typed the code and pressed Verify: ADP's wizard loads Personal Information in a new document of the
    // same tab, at postLogin.html, under the same application key (the page table above).
    const next = await runAt('jr7-adp1-personal-blank', worker);
    const line1 = asLoaded(next.fixture, 800);
    const first = q<HTMLInputElement>(next.fixture, 'input#personalInfomationFirstName');
    await vi.waitFor(() => expect(first.value).not.toBe(''), { timeout: 30_000 });
    await vi.waitFor(() => expect(next.runtime.run?.ended ?? null).not.toBeNull(), { timeout: 60_000 });
    expect(first.value).toBe(golden.identity.firstName);
    // ADP7-2's wait in the resumed run (O-5): the box, read-only as the run began, is written once the page lets it in.
    expect(line1.value).toBe(golden.address!.line1);
    expect(worker.runStates.at(-1)!.status).not.toBe('handoff');
    // One run, the load's own resume; the pause never shown again in the new document.
    expect(worker.of('run/begin').slice(begun).map((begin) => begin.trigger)).toEqual(['resume']);
    expect(worker.reports.slice(reported).map((report) => report.status)).not.toContain('handoff');
  }, 120_000);
});

/** The time zones the list offers (ASSUMED: no capture shows it open), as the run reads it once it opens it. */
const TIME_ZONES = ['Eastern Time', 'Central Time', 'Mountain Time', 'Pacific Time', 'Alaska Time', 'Hawaii Time'];

/** The golden profile paid `min` an hour or a year in EUR (never a currency a capture may hold). */
const paidEur = (period: 'hour' | 'year', min: number): Profile => ({ ...golden,
  preferences: { ...golden.preferences, expectedSalary: { kind: 'value', value: { min, currency: 'EUR', period } } } });

describe('jr7 ADP P2 RULES-7 on the Questions step (jr7-adp1-questions-filled)', () => {
  it('ADP7-9: "How many years of related experience do you have?" is the profile’s total years, typed as a number',
    async () => {
      const ran = await planned('jr7-adp1-questions-filled');
      const field = ran.field('question_0');
      expect(field.label).toBe('How many years of related experience do you have?');
      expect(ran.row('question_0')).toMatchObject({ category: 'experience.totalYears' });
      const write = ran.write('question_0');
      expect(write?.value.kind === 'text' ? write.value.text : undefined).toMatch(/^\d+$/);
      expect(toFieldSpec(field).constraints.format).toBe('number');
      expect(ran.asked('question_0')).toBeNull();
    });

  it('ADP7-8: the minimum hourly rate is the expected pay: an hourly pay typed; a yearly one or none never converted, '
    + 'asked of the AI as one sum (all scope), flagged', async () => {
    const label = 'What is the minimum hourly rate you would consider for this position?';
    const hourly = await planned('jr7-adp1-questions-filled', { profile: paidEur('hour', 70) });
    expect(hourly.field('question_1').label).toBe(label);
    expect(hourly.row('question_1')).toMatchObject({ category: 'salary.expected' });
    const typed = hourly.write('question_1');
    expect(typed?.value.kind === 'text' ? typed.value.text : undefined).toBe('70');
    for (const profile of [paidEur('year', 150_000), golden]) {
      removeFixtures(document);
      const left = await planned('jr7-adp1-questions-filled', { profile });
      expect(left.row('question_1')).toMatchObject({ category: 'salary.expected', reason: 'no-profile-value' });
      expect(left.write('question_1')).toBeUndefined();
      expect(left.asked('question_1')).toEqual({ scope: 'all', format: 'currency' });
    }
  });

  it('ADP7-4: "What time zone do you live in?", a required multi-select, takes the golden zone as a one-element set',
    async () => {
      const ran = await planned('jr7-adp1-questions-filled', { lists: { question_2: TIME_ZONES } });
      const field = ran.field('question_2');
      expect([field.label, field.kind, field.required]).toEqual(['What time zone do you live in?', 'multiselect', true]);
      expect(ran.row('question_2')).toMatchObject({ category: 'preferences.timeZone' });
      const write = ran.write('question_2');
      expect(write?.value.kind === 'options' ? write.value.cleanLabels : write?.value.kind).toEqual(['Central Time']);
    });

  it('ADP7-3: "Have you ever worked for <the employer>? … If no, type N/A." (a required text box) takes our own N/A',
    async () => {
      const fixture = await open('jr7-adp1-questions-filled');
      const result = scan(adpAdapter.detect(fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
      const field = result.fields.find((each) => each.idAttr === 'question_5')!;
      expect([field.kind, field.required]).toEqual(['text', true]);
      expect(field.label).toMatch(/^Have you ever worked for .+\? .*If no, type N\/A\.$/);
      // The employer is read from the page's own question, never written here.
      const company = /worked for (.+?)\?/.exec(field.label)![1]!;
      const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: golden,
        sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
        posting: { company } });
      expect(out.results.find((row) => row.key === field.key)).toMatchObject({ category: 'screening.previouslyEmployed' });
      const write = out.writes.find((each) => each.key === field.key);
      expect(write?.value.kind === 'text' ? write.value.text : undefined).toBe('N/A');
    });
});

/** The self-ID lists, as the run would read them once it opens them (ASSUMED: no capture shows them open), offering no
 *  decline: the golden profile's decline then goes to the box. */
const NO_DECLINE: Readonly<Record<string, readonly string[]>> = {
  vsidEthinicity: ['Hispanic or Latino', 'Not Hispanic or Latino'],
  vsidRace: ['American Indian or Alaska Native', 'Asian', 'Black or African American',
    'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races'],
};
const DECLINE_BOX = 'I decline to identify my race and ethnicity';

/** ADP's dependsOn with its P2 line undone (the box follows no list). */
const withoutBox: Adapter = { ...adpAdapter,
  dependsOn: (control) => (control.matches('input[name="enthinicityAndRaceId"]') ? null : adpAdapter.dependsOn!(control)) };

describe('jr7 ADP P2 (ENGINE-7 E2’s jr6 leftover L2): the self-ID decline box decided again at its list’s first read',
  () => {
    // self-id draws Ethnicity and Race to choose in; jr6-self-id-blank draws Race disabled, so the box follows
    // Ethnicity there (Race opens later, a new field the box then follows).
    it.each([['self-id', 'vsidRace'], ['jr6-self-id-blank', 'vsidEthinicity']])('%s: left while the lists are unread, '
      + 'it is planned again once %s, the later list a person can choose in, is read, and ticked where the lists offer '
      + 'no decline',
    async (name, list) => {
      const fixture = await open(name);
      const root = adpAdapter.detect(fixture.doc)!.formRoot;
      const unread = scan(root, adpAdapter, { platform: 'adp' });
      const box = unread.fields.find((field) => field.label === DECLINE_BOX)!;
      const parent = unread.fields.find((field) => field.idAttr === list)!;
      expect(parent.optionSetHash).toBe('lazy');
      expect(Object.fromEntries([...dependenciesOf(unread, adpAdapter)].filter(([child]) => child === box.baseKey)))
        .toEqual({ [box.baseKey]: parent.baseKey });
      const before = planOf(fixture, name, unread, golden);
      expect(before.row(DECLINE_BOX)).toMatchObject({ status: 'skipped', reason: 'conditional-question' });
      const books = recordRows(observeScan(createLoop(), unread.fields.map(toFieldSpec),
        { dependsOn: dependenciesOf(unread, adpAdapter) }).state, before.out.results);
      // The run opens the lists and reads them (their first read).
      const readings = new Map<BaseKey, WidgetReading>();
      for (const field of unread.fields) {
        const labels = NO_DECLINE[field.idAttr];
        if (labels !== undefined) readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
          options: labels.map((label) => ({ label, disabled: false })) });
      }
      const read = scan(root, adpAdapter, { platform: 'adp', widgetReadings: readings });
      const seen = observeScan(books, read.fields.map(toFieldSpec), { dependsOn: dependenciesOf(read, adpAdapter) });
      expect(seen.state.fields.get(box.baseKey)).toMatchObject({ status: 'pending', cause: 'parent-settled' });
      const after = planOf(fixture, name, read, golden);
      expect(after.write(DECLINE_BOX)).toMatchObject({ value: { kind: 'check' } });
      // The rule undone (the box follows no list): it stays as it was decided while the lists were unread.
      const plain = observeScan(books, read.fields.map(toFieldSpec), { dependsOn: dependenciesOf(read, withoutBox) });
      expect(plain.state.fields.get(box.baseKey)?.status).toBe('resolved');
    });
  });
