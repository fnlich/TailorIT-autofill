/*
 * jr6 ADP (FIXPLAN §6.6, BUILD.md §4 E-ADP): the ADP Workforce Now adapter on the owner's captures of 2026-11-10
 * (snapshot6 adp1 and adp2, converted as fixtures/adp/jr6-*.html: ADP_JR6_SNAPSHOTS), the auditor's harness
 * (jr6-snapshots, a print-out) turned into asserts. Every test reads the page the adapter reads, with its hooks, the
 * scanner and the entry door; outcomes that need ENGINE's E1 to E3 or RULES' rules (a list chosen, a label classified,
 * a success sign under the promo's focus trap, the posting text off a posting address) are P2's or integration's
 * (SP\jr6\build\ADP.md). Measured with no profile value: nothing here plans or writes an answer.
 * - The page table: each case's root, state, step, finality, Next, Submit, entry and posting text.
 * - E-ADP (apply-path B2, B3, B4, B7; ADP-10, ADP-11): the job details offer the header's Apply; the Privacy Policy
 *   pane offers Consent & Continue and never Decline & Close; "Get your verification code" is the person's email-code
 *   pause; the guest view drawn after them is the guest state; OneTrust's filter "Apply" is never offered; the entry
 *   door presses Apply, then Consent & Continue, in one document.
 * - ADP-1 (the Resume step's uploads), ADP-2/3/15 (ADP's own lists), adp-new-1 (errors), ADP-6 (the success rule),
 *   ADP-8 (the date picker's layout), ADP-16 (the pay basis group's label).
 * P2 (FIXPLAN §6.6 "P2 asserts", after merging ENGINE E1-E3 and RULES R1-R4; the last part of this file): what the
 * merged engine and rules make of these pages, planned with the golden synthetic profile (fixtures/profiles/
 * alex-rivera.*) or variants of it built here, and the lists no capture shows open built here too. No value of the
 * owner's appears: the currencies named are CAD, EUR and GBP only, and the source is read from the golden profile.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { dependenciesOf } from '../../content/pass';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { newSuccessSign, shownSignsOf, successShown } from '../../content/submitted';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { BaseKey } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { fillFile } from '../../dom/fillers/file';
import { awaitUpload } from '../../dom/fillers/upload';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, ScannedField, WidgetReading } from '../../dom/types';
import { deadline, startDeadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { fillWidget, isActionable, readWidget } from '../../dom/widgets';
import { configuredHooks, configuredSuccessSigns } from '../configured';
import { successSignsOf } from '../success';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { ADP_CONFIG, ADP_JR6_SNAPSHOTS, adpAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/adp/jr6-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/adp/jr6-*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
/** P2: the 2026-11-06 captures (adp-1, adp-2, adp-3) the same P2 asserts name beside the jr6 ones. */
const EARLIER = import.meta.glob(['../../../fixtures/adp/personal.html', '../../../fixtures/adp/questions.html',
  '../../../fixtures/adp/self-id.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** A jr6 case's page (or, for P2, a 2026-11-06 one), by its name. */
const page = (name: string): string => {
  const html = PAGES[`../../../fixtures/adp/${name}.html`] ?? EARLIER[`../../../fixtures/adp/${name}.html`];
  if (html === undefined) throw new Error(`no fixture ${name}`);
  return html;
};

afterEach(() => removeFixtures(document));

const open = (name: string): Promise<Fixture> => loadFixture(document, page(name), SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;

/** The scan of a case's root. */
async function scanned(name: string, adapter: Adapter = adpAdapter): Promise<{ fixture: Fixture; result: ScanResult }> {
  const fixture = await open(name);
  const root = adpAdapter.detect(fixture.doc)!.formRoot;
  return { fixture, result: scan(root, adapter, { platform: 'adp' }) };
}

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

/** ADP's modal focus trap undone where it stands (a promo or a pane closed): every element it hid gets its own
 *  aria-hidden back (data-old-aria-hidden, "null" for none), and the trap's markers go. */
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
}

const WIZARD = { detect: '#jobApplicationSubmit', auth: null, entry: null, posting: false } as const;
const STEP = (heading: string): Row => ({ ...WIZARD, step: heading, final: 'not-final', next: 'ja_sv_cw_next_footer_btn',
  submit: null });
const LAST = (): Row => ({ ...WIZARD, step: 'Self-Attest & Submit', final: 'final', next: null, submit: 'submitApplication' });
const NONE: Omit<Row, 'entry' | 'posting' | 'auth' | 'step'> = { detect: null, final: 'unknown', next: null, submit: null };

const TABLE: Record<string, Row> = {
  'jr6-posting': { ...NONE, auth: null, step: null, entry: 'recruitment_jobDescription_apply', posting: true },
  'jr6-consent': { ...NONE, auth: 'entry-choice', step: 'state:consent', entry: 'Consent & Continue', posting: false },
  'jr6-guest-blank': { detect: 'div.guest-login-container', auth: null, step: 'state:guest', final: 'not-final', next: null,
    submit: null, entry: null, posting: false },
  'jr6-guest-send-code': { ...NONE, auth: 'email-code', step: 'state:code-choice', entry: null, posting: false },
  'jr6-code-dialog': { ...NONE, detect: 'sdf-focus-pane#login_view_show_opt_dialog div.otpDialogContent', auth: 'email-code',
    step: 'state:code', entry: null, posting: false },
  'jr6-landing': { ...NONE, auth: null, step: null, entry: null, posting: true },
  'jr6-personal-blank': STEP('Personal Information'),
  'jr6-personal-us-errors': STEP('Personal Information'),
  'jr6-personal-us-state': STEP('Personal Information'),
  'jr6-personal-filled': STEP('Personal Information'),
  'jr6-resume-choice': STEP('Resume'),
  'jr6-resume-blank': STEP('Resume'),
  'jr6-resume-uploaded': STEP('Resume'),
  'jr6-questions-filled': STEP('Questions'),
  'jr6-questions2-blank': STEP('Questions'),
  'jr6-questions2-filled': STEP('Questions'),
  'jr6-self-id-blank': STEP('Voluntary Self-ID'),
  'jr6-self-id-filled': STEP('Voluntary Self-ID'),
  'jr6-review': STEP('Review your application'),
  'jr6-self-attest-blank': LAST(),
  'jr6-self-attest-signed': LAST(),
  'jr6-confirmation': { ...NONE, auth: null, step: null, entry: null, posting: false },
  'jr6-confirmation-2': { ...NONE, auth: null, step: null, entry: null, posting: false },
};

describe('jr6 ADP: the page table of the owner’s 2026-11-10 captures', () => {
  it('names the 23 jr6 pages it was read from, each a committed fixture', () => {
    expect(ADP_JR6_SNAPSHOTS.map((path) => path.replace(/^fixtures\/adp\/|\.html$/g, '')).sort())
      .toEqual(Object.keys(TABLE).sort());
    for (const path of ADP_JR6_SNAPSHOTS) expect(PAGES[`../../../${path}`], path).toBeTypeOf('string');
    expect(ADP_CONFIG.snapshots).toEqual(expect.arrayContaining(Object.keys(TABLE)));
  });

  it.each(Object.entries(TABLE))('%s: root, state, step, finality, Next, Submit, entry and posting text', async (name, row) => {
    const fixture = await open(name);
    const { doc } = fixture;
    const root = adpAdapter.detect(doc)?.formRoot ?? null;
    expect(root === null ? null : root).toBe(row.detect === null ? null : doc.querySelector(row.detect));
    expect(adpAdapter.authState!(doc)).toBe(row.auth);
    const signature = adpAdapter.stepSignature!(doc);
    expect(signature.heading ?? signature.anchors.find((anchor) => anchor.startsWith('state:')) ?? null).toBe(row.step);
    expect(adpAdapter.isFinalStep!(doc)).toBe(row.final);
    expect(root === null ? null : adpAdapter.nextButton!(root)?.id ?? null).toBe(row.next);
    expect(root === null ? null : adpAdapter.submitButton!(root)?.id ?? null).toBe(row.submit);
    const entry = adpAdapter.entryControl!(doc);
    expect(entry === null ? null : entry.getAttribute('aria-label') ?? entry.id).toBe(row.entry);
    expect(adpAdapter.postingText!(doc) !== null).toBe(row.posting);
  });
});

// ── E-ADP: the entry (BUILD.md §4) ───────────────────────────────────────────────────────────────────────────────

describe('jr6 E-ADP: the job details, the Privacy Policy pane, the code choice and the guest view', () => {
  it.each(['jr6-posting', 'jr6-consent', 'jr6-guest-blank', 'jr6-guest-send-code', 'jr6-landing'])(
    '%s: every hook answers what the page shows (its expectation)', async (name) => {
      const fixture = await open(name);
      const json = EXPECTS[`../../../fixtures/adp/${name}.expect.json`];
      expect(compareHooks(fixture.doc, adpAdapter, readHooks(json))).toEqual([]);
    });

  it('the job details offer the header’s Apply, by its id (jr6-posting)', async () => {
    const fixture = await open('jr6-posting');
    const entry = adpAdapter.entryControl!(fixture.doc);
    expect(entry).toBe(q(fixture, 'div.job-description-details-sub-right-container button#recruitment_jobDescription_apply'));
    expect(isUserVisible(entry!)).toBe(true);
    // The posting's own text, and no form: the agent's entry door may press it (never a run: it is never pressed).
    expect(adpAdapter.postingText!(fixture.doc)).toBe(q(fixture, 'div.job-description-data'));
    expect(adpAdapter.detect(fixture.doc)).toBeNull();
    expect(adpAdapter.entryNeverPressed).toBe(true);
    expect(adpAdapter.neverPress!(fixture.doc.body)).toContain(entry);
    // The rule undone (no posting.entry): nothing is offered.
    expect(configuredHooks({ ...ADP_CONFIG, posting: { text: 'div.job-description-data', from: 'test' } })
      .entryControl!(fixture.doc)).toBeNull();
  });

  it('never offers OneTrust’s filter "Apply", even shown, nor the word "Apply" alone (jr6-posting variant)', async () => {
    const fixture = await open('jr6-posting');
    const { doc } = fixture;
    // The filter dialog drawn shown on the details, with the header's Apply gone: nothing is offered.
    const section = doc.createElement('section');
    section.id = 'ot-fltr-modal';
    const filterApply = doc.createElement('button');
    filterApply.id = 'filter-apply-handler';
    filterApply.textContent = 'Apply';
    section.append(filterApply);
    doc.body.append(section);
    const other = doc.createElement('button');
    other.type = 'button';
    other.textContent = 'Apply';
    doc.body.append(other);
    expect(isUserVisible(filterApply)).toBe(true);
    expect(adpAdapter.entryControl!(doc)?.id).toBe('recruitment_jobDescription_apply');
    for (const apply of Array.from(doc.querySelectorAll('button#recruitment_jobDescription_apply, '
      + 'button#recruitment_jobDescription_candidateApply'))) apply.remove();
    expect(adpAdapter.entryControl!(doc)).toBeNull();
    const never = adpAdapter.neverPress!(doc.body);
    expect(never).toContain(filterApply);
    expect(never).toContain(section);
    const clicks = heldClicks(fixture);
    expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'not-offered' });
    expect(clicks).toEqual([]);
  });

  it('the Privacy Policy pane offers its primary Consent & Continue, never Decline & Close (jr6-consent)', async () => {
    const fixture = await open('jr6-consent');
    const { doc } = fixture;
    const consent = q(fixture, 'sdf-focus-pane#jdv_privacy_dailog sdf-button[emphasis="primary"]');
    const decline = q(fixture, 'sdf-focus-pane#jdv_privacy_dailog sdf-button[emphasis="secondary"]');
    expect([consent.getAttribute('aria-label'), decline.getAttribute('aria-label')])
      .toEqual(['Consent & Continue', 'Decline & Close']);
    // Both carry id="undefined": the entry is named by slot, emphasis and words.
    expect([consent.id, decline.id]).toEqual(['undefined', 'undefined']);
    expect(adpAdapter.authState!(doc)).toBe('entry-choice');
    expect(detectPause(doc, null, adpAdapter)).toMatchObject({ kind: 'entry-choice' });
    expect(adpAdapter.entryControl!(doc)).toBe(consent);
    const never = adpAdapter.neverPress!(doc.body);
    expect(never).toContain(decline);
    // The run at the choice presses the entry alone, through the door.
    const clicks = heldClicks(fixture);
    expect(pressEntryChoice(doc, adpAdapter)).toBe('pressed');
    expect(clicks).toEqual(['Consent & Continue']);
    // The primary button's words cross-checked: with other words, nothing is offered (Decline never).
    consent.setAttribute('aria-label', 'Decline & Close');
    expect(adpAdapter.entryControl!(doc)).toBeNull();
    expect(pressEntryChoice(doc, adpAdapter)).toBe('none');
    expect(clicks).toEqual(['Consent & Continue']);
    // The rule undone (no consent state): the pane is no state, nothing is offered on it.
    const undone = configuredHooks({ ...ADP_CONFIG, states: ADP_CONFIG.states!.filter((state) => state.name !== 'consent') });
    consent.setAttribute('aria-label', 'Consent & Continue');
    expect(undone.authState!(doc)).toBeNull();
    expect(undone.entryControl!(doc)).toBeNull();
  });

  it('presses Apply, then the pane’s Consent & Continue drawn in place, in one document (jr6-consent)', async () => {
    const fixture = await open('jr6-consent');
    const { doc } = fixture;
    // The details as loaded, before Apply: the pane taken out and its focus trap undone.
    const pane = q(fixture, 'sdf-focus-pane#jdv_privacy_dailog');
    const at = { parent: pane.parentNode!, next: pane.nextSibling };
    const trapped = Array.from(doc.querySelectorAll('[data-old-aria-hidden]'))
      .map((el) => [el, el.getAttribute('aria-hidden'), el.getAttribute('data-old-aria-hidden')] as const);
    pane.remove();
    undoFocusTrap(doc);
    expect(adpAdapter.authState!(doc)).toBeNull();
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
    const answer = await pressEntry(doc, [adpAdapter], new AbortController().signal, 3_000, 3_000);
    expect(answer.outcome).toBe('pressed');
    expect(clicks).toEqual(['recruitment_jobDescription_apply', 'Consent & Continue']);
    await deadline(300);
    expect(clicks).not.toContain('Decline & Close');
    expect(adpAdapter.quirks).toMatchObject({ entryPresses: 2, formLateMs: 20_000, formInPlace: true });
  }, 30_000);

  it('"Get your verification code" is the person’s email-code pause: nothing offered or pressed (jr6-guest-send-code)',
    async () => {
      const fixture = await open('jr6-guest-send-code');
      const { doc } = fixture;
      expect(adpAdapter.authState!(doc)).toBe('email-code');
      expect(detectPause(doc, null, adpAdapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
      expect(adpAdapter.detect(doc)).toBeNull();
      expect(adpAdapter.entryControl!(doc)).toBeNull();
      expect(adpAdapter.signInContainer!(doc)).toBeNull();
      // Its Send, and its Close in the pane's shadow root, are never pressed.
      const never = adpAdapter.neverPress!(doc.body);
      expect(never).toContain(q(fixture, 'sdf-button#recruitment_login_guestLogin'));
      const close = q(fixture, 'sdf-focus-pane#login_view_identifier_dialog').shadowRoot!.querySelector('sdf-close-button')!;
      expect(never).toContain(close);
      expect(never).toContain(close.shadowRoot!.querySelector('button'));
      const clicks = heldClicks(fixture);
      expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 300, 300))
        .toEqual({ outcome: 'blocked', block: 'email-code' });
      expect(clicks).toEqual([]);
      // The rule undone: the page is no state and no form (the guest page behind is hidden by the pane's trap).
      const undone = configuredHooks({ ...ADP_CONFIG,
        states: ADP_CONFIG.states!.filter((state) => state.name !== 'code-choice') });
      expect(undone.authState!(doc)).toBeNull();
      expect(undone.detect(doc)).toBeNull();
    });

  it('the guest view drawn after them is the guest state, filled like a step (jr6-guest-blank)', async () => {
    const fixture = await open('jr6-guest-blank');
    const { doc } = fixture;
    const container = q(fixture, 'div.guest-login-container');
    expect(adpAdapter.authState!(doc)).toBeNull();
    expect(adpAdapter.detect(doc)?.formRoot).toBe(container);
    expect(adpAdapter.stepSignature!(doc)).toEqual({ anchors: ['state:guest'] });
    expect(adpAdapter.signInContainer!(doc)?.button).toBe(q(fixture, 'sdf-button#recruitment_login_recaptcha'));
    expect(adpAdapter.entryControl!(doc)).toBeNull();
    // The entry stops at a form: the guest view offers nothing to press.
    const clicks = heldClicks(fixture);
    expect(await pressEntry(doc, [adpAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'not-offered' });
    expect(clicks).toEqual([]);
    const result = scan(container, adpAdapter, { platform: 'adp' });
    expect(result.fields.map((field) => field.label)).toEqual(['First Name', 'Last Name', 'Email', 'Mobile Number']);
  });
});

// ── ADP-10: the posting's text ───────────────────────────────────────────────────────────────────────────────────

describe('jr6 ADP-10 (adapter part): the posting’s text', () => {
  it('reads the description on the job details and the signed-in landing, nowhere else', async () => {
    for (const name of Object.keys(TABLE)) {
      const fixture = await open(name);
      const text = adpAdapter.postingText!(fixture.doc);
      expect(text === null ? null : text.className, name).toBe(TABLE[name]!.posting ? 'job-description-data' : null);
      removeFixtures(document);
    }
  }, 120_000);
});

// ── ADP-1: the Resume step's uploads ─────────────────────────────────────────────────────────────────────────────

describe('jr6 ADP-1: the Resume step’s résumé and attachments', () => {
  it.each(['jr6-resume-blank', 'jr6-resume-choice'])('%s: two upload fields, the résumé required, none unrecognised',
    async (name) => {
      const { fixture, result } = await scanned(name);
      expect(result.unrecognisedUploads).toEqual([]);
      const files = result.fields.filter((field) => field.kind === 'file');
      expect(files.map((field) => [field.label, field.required])).toEqual([['Resume', true], ['Attachments', false]]);
      const resume = result.target(files[0]!.key)!;
      expect(resume.control).toBe(q(fixture, '#resumeUploadContainer input[type="file"][name="file"]'));
      expect(resume.proxy).toBe(q(fixture, '#resumeUploadContainer sdf-button[id^="fileUpload-"]'));
      expect(result.target(files[1]!.key)!.proxy).toBe(q(fixture, '.additional-documents-container sdf-button[id^="fileUpload-"]'));
      // The rules undone: both slots are unrecognised again.
      const undone = configuredHooks({ ...ADP_CONFIG, uploads: undefined });
      const plain = scan(adpAdapter.detect(fixture.doc)!.formRoot, { ...adpAdapter, uploadWidgets: undone.uploadWidgets },
        { platform: 'adp' });
      expect(plain.unrecognisedUploads).toHaveLength(2);
    });

  it('jr6-resume-uploaded: the résumé taken (its input gone, its row shown), only the attachments left', async () => {
    const { fixture, result } = await scanned('jr6-resume-uploaded');
    expect(fixture.doc.querySelector('#resumeUploadContainer input[type="file"]')).toBeNull();
    expect(result.fields.filter((field) => field.kind === 'file').map((field) => field.label)).toEqual(['Attachments']);
    expect(result.unrecognisedUploads).toEqual([]);
  });

  it('confirms the résumé ADP took out of the page by the row that names it; pending while none does', async () => {
    const fixture = await open('jr6-resume-blank');
    const { doc } = fixture;
    const input = q<HTMLInputElement>(fixture, '#resumeUploadContainer input[type="file"][name="file"]');
    expect(adpAdapter.uploadWidgets!(doc.body).map((widget) => widget.input)).toContain(input);
    // Connected, no row yet: the configured rule's answer (no done sign shown).
    expect(adpAdapter.uploadState!(input, 'alex-rivera-resume.pdf')).toBe('pending');
    // ADP's script stood in for (jr6-resume-uploaded's markup): the input taken out, the file's row drawn.
    const area = q(fixture, '#resumeUploadContainer');
    input.remove();
    expect(adpAdapter.uploadState!(input, 'alex-rivera-resume.pdf')).toBe('pending');
    const row = doc.createElement('div');
    row.className = 'fileDetails';
    const name = doc.createElement('span');
    name.className = 'fileName';
    name.textContent = 'another.pdf';
    const remove = doc.createElement('button');
    remove.id = 'recruitment_afterResumeUpload_remove_0';
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove');
    remove.textContent = 'Remove';
    row.append(name, remove);
    area.append(row);
    expect(adpAdapter.uploadState!(input, 'alex-rivera-resume.pdf')).toBe('pending');
    row.querySelector('.fileName')!.textContent = ' alex-rivera-resume.pdf ';
    expect(adpAdapter.uploadState!(input, 'alex-rivera-resume.pdf')).toBe('confirmed');
    // The configured rule alone knows no rule for an input out of the page: it reads nothing there.
    expect(configuredHooks(ADP_CONFIG).uploadState!(input, 'alex-rivera-resume.pdf')).toBeNull();
    // The area itself gone: failed.
    area.remove();
    expect(adpAdapter.uploadState!(input, 'alex-rivera-resume.pdf')).toBe('failed');
  });
});

// ── ADP-2, ADP-3, ADP-15: ADP's own lists ────────────────────────────────────────────────────────────────────────

describe('jr6 ADP-2, ADP-3, ADP-15: ADP’s own lists (wfn-dropdown-list, sdf-select-simple)', () => {
  it.each(['jr6-personal-us-errors', 'jr6-personal-us-state', 'jr6-personal-filled'])(
    '%s: the State after Country is a declared, required combobox, its filter box no field', async (name) => {
      const { fixture, result } = await scanned(name);
      const host = q(fixture, 'wfn-dropdown-list#PersonalAddress_state');
      const state = fieldOf(result, host)!;
      expect(state).toBeDefined();
      expect([state.kind, state.required, state.label.startsWith('State / Territory')]).toEqual(['combobox', true, true]);
      const widget = result.target(state.key)!.widget!;
      expect(widget.declared).toBe(true);
      const simple = host.shadowRoot!.querySelector('sdf-select-simple')!;
      expect(widget.opener).toBe(simple.shadowRoot!.querySelector('div.trigger-button[role="button"]'));
      expect(widget.drawnWhole).toBe(true);
      // No field is the list's filter box (ADP-15), and none other than the State is its list.
      expect(result.fields.some((field) => /filter your options/i.test(field.label))).toBe(false);
      expect(result.fields.filter((field) => result.target(field.key)?.widget?.element === host)).toHaveLength(1);
      // The State is reset by the Country's write (FIXPLAN §3.1 item 10).
      expect(adpAdapter.dependsOn!(host)).toBe(q(fixture, 'input#PersonalAddress_country'));
      // The rules undone: no State field; where the capture shows the list open, its filter box is a field again.
      const plain = scan(adpAdapter.detect(fixture.doc)!.formRoot,
        { ...adpAdapter, widgetRoots: (root) => Array.from(root.querySelectorAll('#refferalOptions')) }, { platform: 'adp' });
      expect(fieldOf(plain, host)).toBeUndefined();
      expect(plain.fields.some((field) => /filter your options/i.test(field.label))).toBe(name === 'jr6-personal-us-errors');
    });

  it('jr6-personal-us-errors: the open list is the shadow listbox, its options the page’s sdf-select-items', async () => {
    const fixture = await open('jr6-personal-us-errors');
    const host = q(fixture, 'wfn-dropdown-list#PersonalAddress_state');
    const decl = adpAdapter.widgetFor!(host)!;
    const list = typeof decl.results!.list === 'function' ? decl.results!.list() : decl.results!.list;
    const simple = host.shadowRoot!.querySelector('sdf-select-simple')!;
    expect(list).toBe(simple.shadowRoot!.querySelector('div#listbox[role="listbox"]'));
    const options = Array.from(list!.querySelectorAll(decl.results!.option));
    expect(options.length).toBeGreaterThan(50);
    expect(options.some((option) => option.getAttribute('aria-label') === 'CA - California')).toBe(true);
    expect(decl.parts).toEqual([simple.shadowRoot!.querySelector('input#select-filter-input')]);
    // Nothing chosen: the trigger shows its placeholder, no answer.
    expect(decl.shownAnswer!([])).toBeNull();
    // The list closed (hidden): none open, and no portal list either.
    (list!.closest('div.list') as HTMLElement).style.display = 'none';
    expect(typeof decl.results!.list === 'function' ? decl.results!.list() : null).toBeNull();
  });

  it('the State as a text box (jr6-personal-blank) depends on the Country too; other fields on nothing', async () => {
    const fixture = await open('jr6-personal-blank');
    const country = q(fixture, 'input#PersonalAddress_country');
    expect(adpAdapter.dependsOn!(q(fixture, 'input#PersonalAddress_state'))).toBe(country);
    expect(adpAdapter.dependsOn!(q(fixture, 'input#PersonalAddress_city'))).toBeNull();
    expect(adpAdapter.dependsOn!(country)).toBeNull();
  });

  it.each(['jr6-questions2-blank', 'jr6-questions2-filled'])(
    '%s: the source list and the currency are declared comboboxes with their own labels', async (name) => {
      const { fixture, result } = await scanned(name);
      const source = fieldOf(result, q(fixture, 'sdf-select-simple#question_7'))!;
      expect([source.label, source.kind, source.required]).toEqual(['How did you learn about this position?', 'combobox',
        true]);
      const currency = fieldOf(result, q(fixture, 'sdf-select-simple#add_info_select_box'))!;
      expect([currency.label, currency.kind, currency.required]).toEqual(['Select currency type', 'combobox', true]);
      expect(result.fields.some((field) => /filter your options/i.test(field.label))).toBe(false);
      // The source list's options, as the page draws them in its shadow listbox.
      const decl = adpAdapter.widgetFor!(q(fixture, 'sdf-select-simple#question_7'))!;
      const list = typeof decl.results!.list === 'function' ? decl.results!.list() : decl.results!.list;
      expect(Array.from(list?.querySelectorAll(decl.results!.option) ?? []).map((option) => option.getAttribute('aria-label')))
        .toEqual(['Employee referral', 'Contacted by company Recruiter', 'Indeed', 'LinkedIn', 'ZipRecruiter', 'Glassdoor',
          'Dice', 'Other']);
      // The rule undone (no labelFor for sdf-select-simple): the source list has no label.
      const plain = scan(adpAdapter.detect(fixture.doc)!.formRoot, { ...adpAdapter,
        labelFor: (control) => (control.matches('sdf-select-simple') ? null : adpAdapter.labelFor!(control)) },
      { platform: 'adp' });
      expect(fieldOf(plain, q(fixture, 'sdf-select-simple#question_7'))?.label).toBe('');
    });

  it('no case shows a list’s filter box as a field', async () => {
    for (const name of Object.keys(TABLE)) {
      const fixture = await open(name);
      const root = adpAdapter.detect(fixture.doc)?.formRoot ?? null;
      if (root !== null) {
        const result = scan(root, adpAdapter, { platform: 'adp' });
        expect(result.fields.some((field) => /filter your options/i.test(field.label)), name).toBe(false);
      }
      removeFixtures(document);
    }
  }, 120_000);
});

// ── adp-new-1: errors ─────────────────────────────────────────────────────────────────────────────────────────────

describe('jr6 adp-new-1: ADP’s errors', () => {
  it.each(['jr6-personal-us-errors', 'jr6-personal-us-state'])('%s: the address message and ADP’s error labels, each '
    + 'with its field’s control id', async (name) => {
    const fixture = await open(name);
    const root = adpAdapter.detect(fixture.doc)!.formRoot;
    const errors = adpAdapter.errors!(root);
    expect(errors.some((error) => error.el === q(fixture, 'h4#addressErrorMessage') && error.fieldKeyHint === undefined))
      .toBe(true);
    const hints = errors.map((error) => error.fieldKeyHint).filter((hint) => hint !== undefined);
    expect(hints).toEqual(expect.arrayContaining(['PersonalAddress_address_line1', 'PersonalAddress_city',
      'PersonalAddress_postalCode']));
    if (name === 'jr6-personal-us-errors') {
      expect(hints.filter((hint) => hint === 'PersonalAddress_state').length).toBeGreaterThanOrEqual(1);
      expect(errors.map((error) => error.el)).toContain(q(fixture, 'wfn-dropdown-list#PersonalAddress_state'));
    }
  });

  it.each(['jr6-personal-blank', 'jr6-personal-filled', 'jr6-questions-filled', 'jr6-questions2-blank',
    'jr6-questions2-filled', 'jr6-resume-blank', 'jr6-self-id-blank', 'jr6-self-attest-blank'])(
    '%s: no error as loaded (ADP’s on-load aria-invalid is none)', async (name) => {
      const fixture = await open(name);
      expect(adpAdapter.errors!(adpAdapter.detect(fixture.doc)!.formRoot)).toEqual([]);
    });

  it('jr6-questions2-blank: an on-load aria-invalid counts once its question shows a message', async () => {
    const fixture = await open('jr6-questions2-blank');
    const root = adpAdapter.detect(fixture.doc)!.formRoot;
    const box = q(fixture, 'textarea#question_11');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    // The generic reading alone keeps it (the rule undone).
    expect(configuredHooks(ADP_CONFIG).errors!(root).map((error) => error.el)).toContain(box);
    expect(adpAdapter.errors!(root)).toEqual([]);
    const message = box.closest('div.qMainDiv')!.querySelector('.vdl-validation-error')!;
    message.textContent = 'This field is required.';
    expect(adpAdapter.errors!(root).map((error) => error.el)).toEqual(expect.arrayContaining([box, message]));
  });
});

// ── ADP-6: the page after Submit ─────────────────────────────────────────────────────────────────────────────────

describe('jr6 ADP-6: the page after Submit (Jobright’s adp-workforcenow rule)', () => {
  it('declares the sign, its words, its companion and the promo’s focus trap as underModal', () => {
    expect(ADP_CONFIG.success).toMatchObject({ css: '#vdlContainerFluid.success-card .success-message-container p.message',
      underModal: 'sdf-focus-pane[data-sdf-modal]' });
  });

  it.each(['jr6-confirmation', 'jr6-confirmation-2'])('%s: the sign, once the promo’s focus trap is undone', async (name) => {
    const fixture = await open(name);
    const sign = q(fixture, '#vdlContainerFluid.success-card .success-message-container p.message');
    // The promo open: its focus trap hides the sign (ENGINE E2 builds underModal's reading: a P2 assert).
    expect(q(fixture, 'sdf-focus-pane[data-sdf-modal]')).not.toBeNull();
    undoFocusTrap(fixture.doc);
    expect(configuredSuccessSigns(fixture.doc, ADP_CONFIG)).toEqual([sign]);
    // Its words and companion are both required.
    q(fixture, '.success-message-container span.message-header').textContent = 'Welcome';
    expect(successSignsOf(fixture.doc, [ADP_CONFIG.success!])).toEqual([]);
  });

  it('no other jr6 page shows it, its focus traps undone or not', async () => {
    for (const name of Object.keys(TABLE).filter((each) => !each.startsWith('jr6-confirmation'))) {
      const fixture = await open(name);
      expect(configuredSuccessSigns(fixture.doc, ADP_CONFIG), name).toEqual([]);
      undoFocusTrap(fixture.doc);
      expect(configuredSuccessSigns(fixture.doc, ADP_CONFIG), name).toEqual([]);
      removeFixtures(document);
    }
  }, 120_000);
});

// ── ADP-8, ADP-16 ────────────────────────────────────────────────────────────────────────────────────────────────

describe('jr6 ADP-8 and ADP-16: the start-date picker’s layout and the pay basis group’s label', () => {
  it('reads the date picker as MM/DD/YYYY, whatever its placeholder says (jr6-questions2-blank)', async () => {
    const { fixture, result } = await scanned('jr6-questions2-blank');
    const box = q(fixture, 'input#question_8');
    expect(box.getAttribute('placeholder')).toBe('MM/DM/YYYY');
    expect(adpAdapter.formatFor!(box)).toEqual({ format: 'date', pattern: 'MM/DD/YYYY' });
    const field = fieldOf(result, box)!;
    expect(field.label).toBe('If an offer is presented, how soon can you start?');
    expect(toFieldSpec(field).constraints).toMatchObject({ format: 'date', pattern: 'MM/DD/YYYY' });
    expect(adpAdapter.formatFor!(q(fixture, 'input#desiredSalaryId'))).toBeNull();
    // The rule undone: no layout.
    const plain = scan(adpAdapter.detect(fixture.doc)!.formRoot, { ...adpAdapter, formatFor: undefined }, { platform: 'adp' });
    expect(fieldOf(plain, box)?.constraints.format).toBeUndefined();
  });

  it('titles the desired salary’s Annually | Hourly group by its block’s title plus "pay basis" (jr6-questions2-blank)',
    async () => {
      const { fixture, result } = await scanned('jr6-questions2-blank');
      const group = q(fixture, '#desiredEmplSalaryBlock #salaryOptions div[role="radiogroup"]');
      const field = fieldOf(result, group)!;
      expect([field.kind, field.label, (field.options as Array<{ label: string }>).map((option) => option.label)])
        .toEqual(['radio', 'What is your desired salary? pay basis', ['Annually', 'Hourly']]);
      expect(adpAdapter.labelFor!(group)).toBe(q(fixture, 'span#desiredSalaryLabel'));
      // The other questions keep their label.qLabel, and no suffix.
      const first = q(fixture, '[aria-labelledby="sdf-radio-group-1-label"]');
      expect(adpAdapter.labelFor!(first)?.matches('label.qLabel')).toBe(true);
      expect(adpAdapter.labelSuffix!(first)).toBeNull();
      // The rule undone (no suffix): the title alone.
      const plain = scan(adpAdapter.detect(fixture.doc)!.formRoot, { ...adpAdapter, labelSuffix: undefined },
        { platform: 'adp' });
      expect(fieldOf(plain, group)?.label).toBe('What is your desired salary?');
    });
});

// ══ P2 (FIXPLAN §6.6 "P2 asserts"; SP\jr6\build\ADP.md): ENGINE E1-E3 and RULES R1-R4 on ADP's pages ════════════════

const golden = goldenProfile();

/** The golden profile with these preferences (expected pay and start built here: CAD, EUR and GBP only). */
const withPreferences = (preferences: Partial<Profile['preferences']>): Profile => ({ ...golden,
  preferences: { ...golden.preferences, ...preferences } });
/** The golden profile paid `min` a year or an hour in `currency`. */
const paid = (currency: 'CAD' | 'EUR' | 'GBP', period: 'year' | 'hour', min: number): Profile =>
  withPreferences({ expectedSalary: { kind: 'value', value: { min, currency, period } } });
/** The golden profile with these screening answers. */
const withScreening = (screening: Partial<Profile['screening']>): Profile => ({ ...golden,
  screening: { ...golden.screening, ...screening } });

/** Lists no capture shows open (the audit's assumption, SP\jr6\audit\adp.md §3), as the run would read them once it
 *  opens them: built here, each test that uses one says so. */
const DECLINE = 'I do not wish to self-identify';
const SELF_ID_LISTS = {
  vsidGender: ['Male', 'Female', DECLINE],
  vsidEthinicity: ['Hispanic or Latino', 'Not Hispanic or Latino', DECLINE],
  vsidRace: ['American Indian or Alaska Native', 'Asian', 'Black or African American',
    'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', DECLINE],
} as const;
const CLEARANCE_TYPES = ['No Clearance', 'Public Trust', 'Confidential', 'Secret', 'Top Secret', 'TS/SCI'];

/** The currency list the employer-1 Questions step draws (its react-select menu, open in jr6-questions-filled): page
 *  text, read as the run reads a list (each option's words). */
function menuCurrencies(): string[] {
  const doc = new DOMParser().parseFromString(page('jr6-questions-filled'), 'text/html');
  return Array.from(doc.querySelectorAll('.MDFSelectBox__menu-list .MDFSelectBox__option'))
    .map((option) => (option.textContent ?? '').replace(/\s+/g, ' ').trim());
}

/** A page planned as a run plans it. */
interface Planned {
  fixture: Fixture;
  result: ScanResult;
  out: PlanOutput;
  /** The field by its label (page text), else by its control's id. */
  field(name: string): ScannedField;
  row(name: string): FillResult;
  write(name: string): PlannedWrite | undefined;
  /** What the plan asks the AI for the field: an answer's scope, 'classify' or 'draft'; null for nothing. */
  asked(name: string): string | null;
}

/** A case scanned with `lists` read as the run reads them (by the field's control id) and planned with `profile`
 *  (the golden one by default), DEFAULT_SETTINGS and, where given, the posting's company. */
async function planned(name: string, options: { profile?: Profile; lists?: Readonly<Record<string, readonly string[]>>;
  company?: string } = {}): Promise<Planned> {
  const fixture = await open(name);
  const root = adpAdapter.detect(fixture.doc)!.formRoot;
  const first = scan(root, adpAdapter, { platform: 'adp' });
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields) {
    const labels = options.lists?.[field.idAttr];
    if (labels === undefined) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: field.kind === 'multiselect', complete: true,
      options: labels.map((label) => ({ label, disabled: false })) });
  }
  const result = scan(root, adpAdapter, { platform: 'adp', widgetReadings: readings });
  const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: options.profile ?? golden,
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    ...(options.company === undefined ? {} : { posting: { company: options.company } }) });
  const field = (wanted: string) => {
    const found = result.fields.find((each) => each.label === wanted)
      ?? result.fields.find((each) => each.idAttr === wanted);
    if (found === undefined) throw new Error(`no field "${wanted}" on ${name}`);
    return found;
  };
  return { fixture, result, out, field,
    row: (wanted) => out.results.find((row) => row.key === field(wanted).key)!,
    write: (wanted) => out.writes.find((write) => write.key === field(wanted).key),
    asked: (wanted) => {
      const key = field(wanted).key;
      const answer = out.ask?.answers?.find((item) => item.key === key);
      if (answer !== undefined) return answer.scope;
      if (out.ask?.classify?.some((item) => item.key === key) === true) return 'classify';
      return out.ask?.drafts?.some((item) => item.key === key) === true ? 'draft' : null;
    } };
}

/** The option label a write chooses, the labels it chooses, or the text it types. */
const optionOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'option' ? write.value.cleanLabel : undefined);
const optionsOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'options' ? write.value.cleanLabels
  : undefined);
const typedOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'text' ? write.value.text : undefined);

/** ADP's sdf-select-simple stood in for (its script is not in a capture), on a wfn-dropdown-list or sdf-select-simple
 *  host: its trigger opens and closes its list (div.list); a press on one of its sdf-select-items chooses it, as ADP
 *  draws a choice: the item's words in a span#selected-label in the trigger, in place of the placeholder, and the list
 *  closed. Every press inside it is recorded: "trigger", an item by its words, anything else (the filter box, the
 *  pane's Close) by its name and id. The list starts closed. */
function standInSelect(host: Element): { presses: string[]; open(): boolean } {
  const simple = host.matches('sdf-select-simple') ? host : host.shadowRoot!.querySelector('sdf-select-simple')!;
  const shadow = simple.shadowRoot!;
  const trigger = shadow.querySelector<HTMLElement>('div.trigger-button[role="button"]')!;
  const list = shadow.querySelector<HTMLElement>('div.list')!;
  const presses: string[] = [];
  const show = (open: boolean) => {
    list.style.display = open ? '' : 'none';
    trigger.setAttribute('aria-expanded', String(open));
  };
  show(false);
  shadow.addEventListener('click', (event) => {
    // The page's nodes are its frame's: compared by name, not by this window's Element.
    const path = event.composedPath() as Element[];
    if (path.includes(trigger)) {
      presses.push('trigger');
      show(list.style.display === 'none');
      return;
    }
    const item = path.find((node) => node.localName === 'sdf-select-item');
    if (item === undefined) {
      presses.push(`${path[0]?.localName ?? '?'}#${path[0]?.id ?? ''}`);
      return;
    }
    presses.push(item.getAttribute('aria-label') ?? '');
    const chosen = simple.ownerDocument.createElement('span');
    chosen.id = 'selected-label';
    chosen.setAttribute('part', 'selected-label');
    chosen.textContent = item.getAttribute('aria-label');
    (trigger.querySelector('#select-placeholder, #selected-label') as Element).replaceWith(chosen);
    item.setAttribute('aria-selected', 'true');
    show(false);
  });
  return { presses, open: () => list.style.display !== 'none' };
}

describe('jr6 P2 ADP-2: the State list once Country is chosen (ENGINE E1, E3)', () => {
  it.each(['jr6-personal-us-errors', 'jr6-personal-us-state', 'jr6-personal-filled'])(
    '%s: the State is a required combobox the widget helpers act on, fillable, planned as the region', async (name) => {
      const ran = await planned(name);
      const host = q(ran.fixture, 'wfn-dropdown-list#PersonalAddress_state');
      const state = fieldOf(ran.result, host)!;
      const widget = ran.result.target(state.key)!.widget!;
      expect([state.label, state.kind, state.required]).toEqual(['State / Territory', 'combobox', true]);
      expect([widget.declared, isActionable(widget)]).toEqual([true, true]);
      expect(fillabilityOf(state, widget)).toEqual({ fillable: true });
      expect(ran.row('State / Territory').category).toBe('address.region');
      // The declaration's results undone: the helpers no longer act on it (widget-phase-4, as before E1).
      const bare = scan(adpAdapter.detect(ran.fixture.doc)!.formRoot, { ...adpAdapter, widgetFor: (control) => {
        const decl = adpAdapter.widgetFor!(control);
        return decl !== null && control.matches('wfn-dropdown-list') ? { ...decl, results: undefined } : decl;
      } }, { platform: 'adp' });
      const unread = fieldOf(bare, host)!;
      expect(fillabilityOf(unread, bare.target(unread.key)!.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    });

  it('jr6-personal-us-errors: reads the whole list through its results, chooses the planned row by a press and reads it '
    + 'back by its shown answer (ADP’s script stood in for)', async () => {
    const fixture = await open('jr6-personal-us-errors');
    const host = q(fixture, 'wfn-dropdown-list#PersonalAddress_state');
    const select = standInSelect(host);
    // Every press in the page, as the document sees it (a press inside the list reads as its host's).
    const anywhere = heldClicks(fixture);
    const root = adpAdapter.detect(fixture.doc)!.formRoot;
    const readings = new Map<BaseKey, WidgetReading>();
    const target = () => {
      const result = scan(root, adpAdapter, { platform: 'adp', widgetReadings: readings });
      return result.target(fieldOf(result, host)!.key)!;
    };
    const ctx = { adapter: adpAdapter, root, readings };
    expect(await readWidget(target(), ctx)).toMatchObject({ status: 'read' });
    const reading = [...readings.values()][0];
    const labels = reading?.kind === 'options' ? reading.options.map((option) => option.label) : [];
    expect(labels.length).toBeGreaterThan(50);
    expect(labels).toEqual(expect.arrayContaining(['AL - Alabama', 'CA - California', 'TX - Texas']));
    // Opened by its trigger, read, and shut again by it.
    expect([select.presses, select.open()]).toEqual([['trigger', 'trigger'], false]);
    select.presses.length = 0;
    const outcome = await fillWidget(target(), { kind: 'option', index: labels.indexOf('TX - Texas'),
      cleanLabel: 'TX - Texas' }, ctx);
    expect(outcome).toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    // The trigger, then the planned row: never the filter box, the pane's Close or another row, and nothing outside.
    expect(select.presses).toEqual(['trigger', 'TX - Texas']);
    expect(new Set(anywhere)).toEqual(new Set(['PersonalAddress_state']));
    expect(anywhere).toHaveLength(4);
    expect(adpAdapter.widgetFor!(host)!.shownAnswer!([])).toBe('TX - Texas');
  });

  it('keeps one base key as the text box and as the list, its parent the Country (dependsOn: ENGINE E3 decides it '
    + 'again after the Country’s write)', async () => {
    const keysOf = async (name: string) => {
      const fixture = await open(name);
      const result = scan(adpAdapter.detect(fixture.doc)!.formRoot, adpAdapter, { platform: 'adp' });
      const state = result.fields.find((field) => field.idAttr === 'PersonalAddress_state')!;
      const country = result.fields.find((field) => field.idAttr === 'PersonalAddress_country')!;
      const parents = dependenciesOf(result, adpAdapter);
      removeFixtures(document);
      return { kind: state.kind, state: state.baseKey, country: country.baseKey, parent: parents.get(state.baseKey),
        others: [...parents.keys()].filter((key) => key !== state.baseKey) };
    };
    // As loaded the State is a text box; once a country is chosen, ADP draws its list under the same id.
    const box = await keysOf('jr6-personal-blank');
    const list = await keysOf('jr6-personal-filled');
    expect([box.kind, list.kind]).toEqual(['text', 'combobox']);
    expect(list.state).toBe(box.state);
    expect([box.parent, list.parent]).toEqual([box.country, list.country]);
    expect([box.others, list.others]).toEqual([[], []]);
  });

  it.fails('ADP-2 (known gap, the option matcher): the golden region is chosen from the State’s whole list, whose rows '
    + 'read "TX - Texas" (today a search the list cannot take: no write lands)', async () => {
    const ran = await planned('jr6-personal-us-errors');
    expect(optionOf(ran.write('State / Territory'))).toBe('TX - Texas');
  });
});

describe('jr6 P2 ADP-3, ADP-7, ADP-8, ADP-16, ADP-19, ADP-20: the employer-2 Questions step (jr6-questions2-blank)', () => {
  it('ADP-3: "How did you learn about this position?" is fillable and takes the profile’s source', async () => {
    const ran = await planned('jr6-questions2-blank');
    const source = ran.field('How did you learn about this position?');
    expect(fillabilityOf(source, ran.result.target(source.key)!.widget)).toEqual({ fillable: true });
    expect(ran.row('How did you learn about this position?'))
      .toMatchObject({ category: 'referral.source', status: 'verified', provenance: 'profile' });
    const chosen = optionOf(ran.write('How did you learn about this position?'));
    expect(chosen?.toLowerCase()).toBe(golden.referralSource!.id);
    expect((source.options as Array<{ label: string }>).map((option) => option.label)).toContain(chosen);
  });

  it('ADP-7, ADP-16, ADP-8: the golden profile (no expected pay, no start date) leaves the pay and asks the AI for the '
    + 'start', async () => {
    const ran = await planned('jr6-questions2-blank');
    // The currency list is the page's 158 rows: more than an AI answer takes (ANSWER_MAX_OPTIONS), so it is left.
    expect((ran.field('add_info_select_box').options as unknown[]).length).toBe(158);
    for (const label of ['add_info_select_box', 'What is your desired salary? pay basis', 'desiredSalaryId']) {
      expect(ran.write(label), label).toBeUndefined();
      expect(ran.asked(label), label).toBeNull();
    }
    expect(ran.row('add_info_select_box')).toMatchObject({ category: 'salary.currency', reason: 'no-profile-value' });
    expect(ran.row('What is your desired salary? pay basis'))
      .toMatchObject({ category: 'salary.period', reason: 'no-profile-value' });
    expect(ran.row('If an offer is presented, how soon can you start?'))
      .toMatchObject({ category: 'availability.startDate' });
    expect(ran.write('If an offer is presented, how soon can you start?')).toBeUndefined();
    expect(ran.asked('If an offer is presented, how soon can you start?')).toBe('standard');
    // ADP-8: the AI is asked for a date in the picker's layout (formatFor), never free text such as "two weeks".
    const start = ran.field('If an offer is presented, how soon can you start?');
    expect(ran.out.ask?.answers?.find((item) => item.key === start.key)).toMatchObject({ format: 'MM/DD/YYYY' });
  });

  it('ADP-7, ADP-16, ADP-8: a yearly pay in EUR and two weeks’ notice give the currency, Annually and the start date '
    + 'in MM/DD/YYYY', async () => {
    const euro = paid('EUR', 'year', 150_000);
    const ran = await planned('jr6-questions2-blank', { profile: { ...euro,
      preferences: { ...euro.preferences, startDate: { kind: 'notice', weeks: 2 } } } });
    expect(ran.write('add_info_select_box')).toMatchObject({ value: { cleanLabel: 'Euro Member Countries ( EUR )' },
      origin: { provenance: 'profile', path: 'preferences.expectedSalary' } });
    expect(ran.write('What is your desired salary? pay basis')).toMatchObject({ value: { cleanLabel: 'Annually' },
      origin: { provenance: 'profile', path: 'preferences.expectedSalary' } });
    expect(typedOf(ran.write('desiredSalaryId'))).toBe('150000');
    // NOW is 2026-10-30: two weeks on, typed as the picker reads it (MM/DD/YYYY).
    expect(ran.write('If an offer is presented, how soon can you start?')).toMatchObject({
      value: { kind: 'text', text: '11/13/2026' }, origin: { provenance: 'rule', ruleId: 'availability.from-notice' } });
  });

  it('ADP-7, ADP-16: an hourly pay in CAD gives Hourly and the CAD row', async () => {
    const ran = await planned('jr6-questions2-blank', { profile: paid('CAD', 'hour', 60) });
    expect(optionOf(ran.write('What is your desired salary? pay basis'))).toBe('Hourly');
    expect(optionOf(ran.write('add_info_select_box'))).toBe('Canada Dollar ( CAD )');
  });

  it('ADP-19, ADP-20: the employee-referral question is No, the GED question Yes', async () => {
    const ran = await planned('jr6-questions2-blank');
    expect(ran.row('Did any of our employees inform you about this position?'))
      .toMatchObject({ category: 'referral.employeeReferred', status: 'verified' });
    expect(ran.write('Did any of our employees inform you about this position?')).toMatchObject({
      value: { cleanLabel: 'No' }, origin: { provenance: 'rule', ruleId: 'referral.not-employee' } });
    expect(ran.write('Are you a high school graduate or passed the GED?')).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'education.high-school' } });
    expect(ran.row('Are you a high school graduate or passed the GED?').category).toBe('education.highSchool');
  });
});

describe('jr6 P2 ADP-7, ADP-9, adp-new-2, ADP-19: the employer-1 Questions step (questions, jr6-questions-filled)', () => {
  const REQUIREMENT = 'This position requires you to obtain and maintain a US Government Security Clearance, which '
    + 'requires US citizenship. Do you meet this requirement?';
  const CLEARANCE = 'Do you have a security clearance? If yes, please indicate which type (Hold CTRL to select multiple)';
  const ELIGIBLE = 'If you do not have a government security clearance, are you eligible to obtain and maintain one?';
  const AGENCY = 'Have you ever been employed as a civilian employee at a government agency?';

  it('ADP-7: "Select currency type" is left for the golden profile (no expected pay, its list never needed); a pay in '
    + 'GBP waits for the list, then takes GBP’s row', async () => {
    const currencies = menuCurrencies();
    expect(currencies).toHaveLength(158);
    const unread: Readonly<Record<string, readonly string[]>> = {};
    for (const lists of [unread, { question_currency_type_8: currencies }]) {
      const left = await planned('questions', { lists });
      expect(left.row('question_currency_type_8')).toMatchObject({ category: 'salary.currency',
        reason: 'no-profile-value' });
      expect([left.write('question_currency_type_8'), left.asked('question_currency_type_8')]).toEqual([undefined, null]);
      removeFixtures(document);
    }
    const gbp = paid('GBP', 'year', 120_000);
    expect((await planned('questions', { profile: gbp })).row('question_currency_type_8').reason)
      .toBe('waiting-for-options');
    removeFixtures(document);
    const read = await planned('questions', { profile: gbp, lists: { question_currency_type_8: currencies } });
    expect(optionOf(read.write('question_currency_type_8'))).toMatch(/\( GBP \)$/);
  });

  it.each(['questions', 'jr6-questions-filled'])('%s, ADP-9: the golden profile leaves the clearance questions to the '
    + 'person (the `all` scope asks the Yes/No ones)', async (name) => {
    const ran = await planned(name, { lists: { question_2: CLEARANCE_TYPES } });
    expect(ran.row(REQUIREMENT)).toMatchObject({ category: 'workAuth.status', reason: 'legal-not-in-profile' });
    expect(ran.row(CLEARANCE)).toMatchObject({ category: 'workAuth.clearance', reason: 'legal-not-in-profile' });
    expect(ran.row(ELIGIBLE)).toMatchObject({ category: 'workAuth.clearance', reason: 'legal-not-in-profile' });
    for (const label of [REQUIREMENT, CLEARANCE, ELIGIBLE]) expect(ran.write(label), label).toBeUndefined();
    expect([ran.asked(REQUIREMENT), ran.asked(ELIGIBLE)]).toEqual(['all', 'all']);
  });

  it.each(['questions', 'jr6-questions-filled'])('%s, ADP-9: no clearance held chooses the none type (the list built '
    + 'here); citizenship alone answers neither the requirement nor the eligibility', async (name) => {
    const ran = await planned(name, { lists: { question_2: CLEARANCE_TYPES },
      profile: withScreening({ clearance: { kind: 'value', value: { level: 'none' } },
        citizenships: { kind: 'value', value: ['US'] } }) });
    expect(optionsOf(ran.write(CLEARANCE))).toEqual(['No Clearance']);
    expect(ran.write(REQUIREMENT)).toBeUndefined();
    expect(ran.write(ELIGIBLE)).toBeUndefined();
  });

  it('adp-new-2: the government-agency question is government service, asked in the `all` scope, Yes from the '
    + 'profile’s government answer', async () => {
    const ran = await planned('questions');
    expect(ran.row(AGENCY)).toMatchObject({ category: 'screening.governmentService', reason: 'legal-not-in-profile' });
    expect(ran.asked(AGENCY)).toBe('all');
    removeFixtures(document);
    const served = await planned('questions', { profile: withScreening({ governmentService: { kind: 'value',
      value: { military: false, government: true } } }) });
    expect(optionOf(served.write(AGENCY))).toBe('Yes');
  });

  it('ADP-19: the employee-referral question is No; "worked here before" is No for the posting’s company', async () => {
    const ran = await planned('questions', { company: 'VSolvit' });
    expect(ran.write('Did any of our employees inform you about this position?')).toMatchObject({
      value: { cleanLabel: 'No' }, origin: { provenance: 'rule', ruleId: 'referral.not-employee' } });
    expect(ran.row('Have you ever been employed by VSolvit before?'))
      .toMatchObject({ category: 'screening.previouslyEmployed', status: 'verified' });
    expect(optionOf(ran.write('Have you ever been employed by VSolvit before?'))).toBe('No');
  });
});

describe('jr6 P2 ADP-4, ADP-5, ADP-14, adp-new-3: the Personal Information step', () => {
  it.each(['personal', 'jr6-personal-blank'])('%s: "State / Territory" typed as the region; Address Line 3 skipped and '
    + 'never asked; the preferred-name box left unticked', async (name) => {
    const ran = await planned(name);
    expect(ran.field('State / Territory').kind).toBe('text');
    expect(ran.row('State / Territory')).toMatchObject({ category: 'address.region', status: 'verified' });
    expect(typedOf(ran.write('State / Territory'))).toBe('TX');
    expect(ran.row('Address Line 3')).toMatchObject({ category: 'address.line3', status: 'skipped' });
    expect([ran.write('Address Line 3'), ran.asked('Address Line 3')]).toEqual([undefined, null]);
    expect(ran.row('I have a preferred or chosen name'))
      .toMatchObject({ category: 'identity.hasPreferredName', status: 'skipped' });
    expect(ran.write('I have a preferred or chosen name')).toBeUndefined();
    removeFixtures(document);
    // A preferred name that is not the first name ticks it.
    const chosen = await planned(name, { profile: { ...golden, identity: { ...golden.identity, preferredName: 'Lex' } } });
    expect(chosen.write('I have a preferred or chosen name')).toMatchObject({ value: { kind: 'check' } });
  });

  it('jr6-personal-us-errors: ADP’s "City is required" reads as City, the State list’s message is left out too; '
    + 'County and Address Line 3 skipped, never asked', async () => {
    const ran = await planned('jr6-personal-us-errors');
    // The page writes its message into the labels (adp-new-1's error labels).
    expect(q(ran.fixture, 'label.mdf-label-error[for="PersonalAddress_city"]').textContent).toMatch(/is required/);
    const city = ran.result.fields.find((field) => field.idAttr === 'PersonalAddress_city')!;
    expect(city.label).toBe('City');
    expect(ran.row('City')).toMatchObject({ category: 'address.city', status: 'verified' });
    expect(typedOf(ran.write('City'))).toBe(golden.address!.city);
    expect(ran.field('PersonalAddress_state').label).toBe('State / Territory');
    expect(ran.row('State / Territory').category).toBe('address.region');
    for (const [label, category] of [['County', 'address.county'], ['Address Line 3', 'address.line3']] as const) {
      expect(ran.row(label), label).toMatchObject({ category, status: 'skipped' });
      expect([ran.write(label), ran.asked(label)], label).toEqual([undefined, null]);
    }
  });
});

describe('jr6 P2 ADP-17: the self-ID decline box beside the lists (self-id, jr6-self-id-blank, jr6-self-id-filled)', () => {
  const BOX = 'I decline to identify my race and ethnicity';

  it.each(['self-id', 'jr6-self-id-blank', 'jr6-self-id-filled'])('%s: lists that offer a decline (built here) are '
    + 'answered with it, and the box is skipped, never flagged', async (name) => {
    const ran = await planned(name, { lists: SELF_ID_LISTS });
    expect(ran.row(BOX)).toMatchObject({ category: 'eeo.race', status: 'skipped', needsUserAction: false });
    expect(ran.write(BOX)).toBeUndefined();
    const lists = ran.result.fields.filter((field) => field.idAttr in SELF_ID_LISTS);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) expect(optionOf(ran.write(list.label)), list.label).toBe(DECLINE);
  });

  it('self-id: lists that offer no decline (built here) leave the golden profile’s decline to the box, ticked; the '
    + 'lists are skipped, never flagged', async () => {
    const ran = await planned('self-id', { lists: { vsidEthinicity: SELF_ID_LISTS.vsidEthinicity.slice(0, 2),
      vsidRace: SELF_ID_LISTS.vsidRace.slice(0, 6) } });
    expect(ran.write(BOX)).toMatchObject({ value: { kind: 'check' } });
    for (const label of ['Ethnicity', 'Race']) {
      expect(ran.write(label), label).toBeUndefined();
      expect(ran.row(label), label).toMatchObject({ status: 'skipped', reason: 'decline-option-missing',
        needsUserAction: false });
    }
  });

  it.each(['self-id', 'jr6-self-id-blank', 'jr6-self-id-filled'])('%s: while the lists are unread, the box waits for '
    + 'them, nobody’s to answer yet', async (name) => {
    const ran = await planned(name);
    expect(ran.row(BOX)).toMatchObject({ reason: 'waiting-for-options', needsUserAction: false });
    expect(ran.write(BOX)).toBeUndefined();
  });
});

describe('jr6 P2 ADP-18, ADP-1: the Resume step', () => {
  const METHOD = 'How would you like to provide the candidate’s resume?';

  it('ADP-18 (jr6-resume-choice): the résumé is provided by upload when the run has one, never otherwise', async () => {
    const ran = await planned('jr6-resume-choice');
    expect(ran.row(METHOD).category).toBe('application.resumeMethod');
    expect(ran.write(METHOD)).toMatchObject({ value: { cleanLabel: 'Upload File' },
      origin: { provenance: 'rule', ruleId: 'resume.upload-method' } });
    removeFixtures(document);
    const { resume: _none, ...without } = golden;
    expect((await planned('jr6-resume-choice', { profile: without })).write(METHOD)).toBeUndefined();
  });

  it.each(['jr6-resume-blank', 'jr6-resume-choice'])('ADP-1 (%s): the résumé goes into "Resume"; "Attachments" takes '
    + 'nothing and is never asked', async (name) => {
    const ran = await planned(name);
    expect(ran.row('Resume')).toMatchObject({ category: 'file.resume', status: 'verified', required: true });
    expect(ran.write('Resume')).toMatchObject({ value: { kind: 'file', ref: 'resume' } });
    expect([ran.write('Attachments'), ran.asked('Attachments')]).toEqual([undefined, null]);
    expect(ran.row('Attachments').category).not.toBe('file.resume');
  });

  it('ADP-1 (jr6-resume-blank): the file filler writes the résumé, and the upload is confirmed by its row once ADP '
    + 'takes the input out of the page (ADP’s script stood in for)', async () => {
    const fixture = await open('jr6-resume-blank');
    const { doc } = fixture;
    const input = q<HTMLInputElement>(fixture, '#resumeUploadContainer input[type="file"][name="file"]');
    const area = q(fixture, '#resumeUploadContainer');
    expect(adpAdapter.uploadWidgets!(doc.body).map((widget) => widget.input)).toContain(input);
    // ADP's script: once the input holds a file, the input goes and the file's row is drawn (jr6-resume-uploaded).
    input.addEventListener('change', () => {
      const name = input.files?.[0]?.name ?? '';
      startDeadline(200, () => {
        input.remove();
        const row = doc.createElement('div');
        row.className = 'fileDetails';
        const shown = doc.createElement('span');
        shown.className = 'fileName';
        shown.textContent = name;
        row.append(shown);
        area.append(row);
      });
    });
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'Alex Rivera Resume.pdf', { type: 'application/pdf' });
    expect(fillFile(input, file)).toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(await awaitUpload(adpAdapter, input, file.name, undefined, { quietMs: 100, capMs: 3_000 })).toBe('confirmed');
    expect(input.isConnected).toBe(false);
    // The configured rule alone reads nothing once the input is gone: the upload would never be confirmed.
    const configuredOnly: Adapter = { ...adpAdapter, uploadState: configuredHooks(ADP_CONFIG).uploadState };
    expect(await awaitUpload(configuredOnly, input, file.name, undefined, { quietMs: 100, capMs: 1_000 })).toBeNull();
  });
});

describe('jr6 P2 ADP-6: the page after Submit read under the BrightJump promo’s focus trap (ENGINE E2 underModal)', () => {
  it.each(['jr6-confirmation', 'jr6-confirmation-2'])('%s: the sign counts with the promo open; the run takes it as '
    + 'this Submit’s', async (name) => {
    const fixture = await open(name);
    const { doc } = fixture;
    const sign = q(fixture, '#vdlContainerFluid.success-card .success-message-container p.message');
    // The promo's trap hides the sign as the capture shows it.
    expect(q(fixture, 'sdf-focus-pane[data-sdf-modal]')).not.toBeNull();
    expect(isUserVisible(sign)).toBe(false);
    expect(configuredSuccessSigns(doc, ADP_CONFIG)).toEqual([sign]);
    expect(successShown(doc, 'adp')).toBe(true);
    expect([...shownSignsOf(doc, 'adp')]).toEqual([sign]);
    // The wizard's root, which ADP took out of the page with its Submit.
    const root = doc.createElement('div');
    expect(newSuccessSign(doc, 'adp', { before: new Set(), root, adapter: adpAdapter })).toBe(sign);
    // The rule's underModal undone: the trap hides it again.
    expect(configuredSuccessSigns(doc, { ...ADP_CONFIG, success: { ...ADP_CONFIG.success!, underModal: undefined } }))
      .toEqual([]);
  });

  it('the last step before Submit shows none (jr6-self-attest-signed)', async () => {
    const fixture = await open('jr6-self-attest-signed');
    expect(successShown(fixture.doc, 'adp')).toBe(false);
    expect(shownSignsOf(fixture.doc, 'adp').size).toBe(0);
  });
});

// ── PRIV-1 (the privacy review of line W): no row of ADP's lists or radio groups tells the owner's choice ────────────
//
// The converter cleared a chosen row's own marks (CHOSEN_MARKS: sdf-select-item's `selected` class and aria-selected),
// but ADP draws a choice in more places, each naming the row by elimination, since the rows' words are public: a
// widget's roving tab stop (tabindex="0" on the chosen row of an open sdf-select-item list, "-1" on the others), the
// check the chosen list row draws in its shadow tree (div#checked-icon), the dot a checked sdf-radio-button draws in its
// own (circle.radio-dot in its svg.toggled), and the chosen value a wfn-radio-button mirrors on each row of its group
// (radio-group-value). These tests read every jr6 page's markup as committed, the declarative shadow roots included, and
// name a list or a group (its field's id, its row count), never a row.

/** A list or a group of choice rows in a page's markup. */
interface ChoiceRows {
  kind: 'list' | 'radios';
  /** Where it is drawn: a list's field, the id of the nearest sdf-select-simple or wfn-dropdown-list ("portal" for a list
   *  drawn in a body-level sdf-floating-pane-portal); a radio group's nearest id. */
  field: string;
  rows: Element[];
}

/** Every list of sdf-select-item rows (by their listbox), every sdf-radio-group's sdf-radio-buttons and every group of
 *  wfn-radio-buttons (by their parent) in a page's markup. DOMParser keeps each declarative shadow root as its host's
 *  <template shadowrootmode> child, whose content is walked as the host's. */
function choiceRowsOf(html: string): ChoiceRows[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const groups = new Map<Element, ChoiceRows>();
  const nearestId = (chain: readonly Element[]): string => [...chain].reverse().find((el) => el.id !== '')?.id ?? '(none)';
  const listField = (chain: readonly Element[]): string => {
    for (const el of [...chain].reverse()) {
      if ((el.localName === 'sdf-select-simple' || el.localName === 'wfn-dropdown-list') && el.id !== '') return el.id;
      if (el.localName === 'sdf-floating-pane-portal') return 'portal';
    }
    return '(none)';
  };
  const add = (owner: Element, row: Element, make: () => Omit<ChoiceRows, 'rows'>): void => {
    const group = groups.get(owner) ?? { ...make(), rows: [] };
    group.rows.push(row);
    groups.set(owner, group);
  };
  const visit = (parent: ParentNode, chain: readonly Element[]): void => {
    for (const el of Array.from(parent.children)) {
      const owner = chain[chain.length - 1];
      if (owner !== undefined && el.localName === 'sdf-select-item') {
        add(owner, el, () => ({ kind: 'list', field: listField(chain) }));
      } else if (el.localName === 'sdf-radio-button') {
        const radioGroup = [...chain].reverse().find((each) => each.localName === 'sdf-radio-group');
        if (radioGroup !== undefined) add(radioGroup, el, () => ({ kind: 'radios', field: nearestId(chain) }));
      } else if (owner !== undefined && el.localName === 'wfn-radio-button') {
        add(owner, el, () => ({ kind: 'radios', field: nearestId(chain) }));
      }
      const next = [...chain, el];
      visit(el, next);
      if (el instanceof HTMLTemplateElement) visit(el.content, next);
    }
  };
  visit(doc, []);
  return [...groups.values()].filter((group) => group.rows.length > 1);
}

/** A jr6 page's case name, from its glob path. */
const caseOf = (path: string): string => path.replace(/^.*\/|\.html$/g, '');

/** What a row draws: each element under it, its shadow tree included, as its tag, id (digits read alike) and classes, in
 *  order; never its words or an attribute's value, nor the row's own attributes (its option's identity). */
function drawnOf(row: Element): string {
  const parts: string[] = [];
  const walk = (parent: ParentNode): void => {
    for (const el of Array.from(parent.children)) {
      parts.push(`${el.localName}#${el.id.replace(/\d+/g, 'N')}.${[...el.classList].sort().join('.')}`);
      walk(el);
      if (el instanceof HTMLTemplateElement) walk(el.content);
    }
  };
  walk(row);
  return parts.join(' ');
}

describe('jr6 PRIV-1 (review: privacy): no row of ADP’s lists or radio groups tells the owner’s choice', () => {
  // PRIV-1 itself. A widget's roving tab stop stands on its first row or nowhere: the converter moves a stop that stands
  // on another row to the first (TOOLING's fix, PRIV-2), so where it stands tells nothing, and ADP's radio groups draw it
  // there whatever is checked. As converted before that fix, jr6-questions2-filled's source list and the State list open
  // on jr6-personal-filled and -us-state held it on the chosen row: this test failed on exactly those three.
  it.fails('no list or radio group holds its tab stop on a row but its first (every jr6 page)', () => {
    const told: string[] = [];
    const walked = { list: 0, radios: 0 };
    for (const [path, html] of Object.entries(PAGES)) {
      for (const group of choiceRowsOf(html)) {
        walked[group.kind] += 1;
        const tabs = group.rows.map((row) => row.getAttribute('tabindex') ?? '');
        const stops = tabs.flatMap((value, at) => (value === '0' ? [at] : []));
        // One tabindex on every row, or one stop on the first row and "-1" or none on the others.
        const alike = new Set(tabs).size === 1
          || (stops.length === 1 && stops[0] === 0 && tabs.slice(1).every((value) => value === '-1' || value === ''));
        if (!alike) told.push(`${caseOf(path)}: ${group.kind} in ${group.field} (${tabs.length} rows)`);
      }
    }
    // The walk reaches every list and group: the State's (in its field, or in the portal once open), the source's and
    // the currency's on both employer-2 Questions pages; 34 sdf-radio-groups and 4 pairs of wfn-radio-buttons.
    expect(walked).toEqual({ list: 7, radios: 38 });
    expect(told).toEqual([]);
  });

  // The marks the review did not name. TOOLING's fix (PRIV-2 with REVC-4) takes out the part a widget draws on its
  // chosen row alone: sdf-select-item's div#checked-icon, sdf-radio-button's circle.radio-dot and its svg's `toggled`.
  // As converted before it, this failed on jr6-personal-filled and -us-state (the State list), jr6-questions2-filled (its
  // source and currency lists, its Yes/No groups and its pay basis), jr6-questions-filled, jr6-resume-choice, and
  // jr6-questions2-blank's pay basis (drawn there too: a site default or not, it cannot be told apart).
  it.fails('no row of a list or radio group draws more than the others in its tree (every jr6 page)', () => {
    const told: string[] = [];
    for (const [path, html] of Object.entries(PAGES)) {
      for (const group of choiceRowsOf(html)) {
        if (new Set(group.rows.map(drawnOf)).size > 1) {
          told.push(`${caseOf(path)}: ${group.kind} in ${group.field} (${group.rows.length} rows)`);
        }
      }
    }
    expect(told).toEqual([]);
  });

  // Known leak, handed to TOOLING (SP\jr6\build\ADP.md, "PRIV-1 fixer", edit 1): a wfn-radio-button group mirrors its
  // chosen option's value on each row (radio-group-value="<that row's value>"), which no converter rule clears yet:
  // jr6-questions-filled's employee-referral pair and jr6-guest-send-code's code channel. It turns `it` when the
  // converter blanks it and ADP converts its pages again.
  it.fails('known leak: no wfn-radio-button names its group’s chosen value (every jr6 page)', () => {
    const told: string[] = [];
    for (const [path, html] of Object.entries(PAGES)) {
      for (const group of choiceRowsOf(html)) {
        if (group.rows.some((row) => (row.getAttribute('radio-group-value') ?? '') !== '')) {
          told.push(`${caseOf(path)}: ${group.kind} in ${group.field} (${group.rows.length} rows)`);
        }
      }
    }
    expect(told).toEqual([]);
  });
});
