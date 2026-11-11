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
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, ScannedField } from '../../dom/types';
import { deadline, startDeadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks, configuredSuccessSigns } from '../configured';
import { successSignsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { ADP_CONFIG, ADP_JR6_SNAPSHOTS, adpAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/adp/jr6-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/adp/jr6-*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
/** A jr6 case's page, by its name. */
const page = (name: string): string => {
  const html = PAGES[`../../../fixtures/adp/${name}.html`];
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
