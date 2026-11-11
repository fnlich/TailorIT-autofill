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
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { deadline, startDeadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
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
