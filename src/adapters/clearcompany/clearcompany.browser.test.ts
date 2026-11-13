/*
 * The ClearCompany adapter (DESIGN-NEW-ATS §5, builder B) on the owner's snapshots of 2026-11-06 (fixtures/clearcompany;
 * the design's ids clearcompany-0 to -6 and -8): each case's hooks and scan held against its hand-written expectations,
 * the account step (Sign-in mode's, Continue the person's), the pages read from the breadcrumb (Continue, Submit, Back
 * never), the uploads behind their menus, the page's saving signs, the repeated rows, the clipped "I Agree" box, and
 * every rule shown to matter by the same page read with that rule undone.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import loadingExpect from '../../../fixtures/clearcompany/atlas-loading.expect.json';
import loadingHtml from '../../../fixtures/clearcompany/atlas-loading.html?raw';
import savingExpect from '../../../fixtures/clearcompany/atlas-uploads-saving.expect.json';
import savingHtml from '../../../fixtures/clearcompany/atlas-uploads-saving.html?raw';
import ferrilliExpect from '../../../fixtures/clearcompany/ferrilli-page2.expect.json';
import ferrilliHtml from '../../../fixtures/clearcompany/ferrilli-page2.html?raw';
import accountExpect from '../../../fixtures/clearcompany/vafb-account.expect.json';
import accountHtml from '../../../fixtures/clearcompany/vafb-account.html?raw';
import page2Expect from '../../../fixtures/clearcompany/vafb-page2.expect.json';
import page2Html from '../../../fixtures/clearcompany/vafb-page2.html?raw';
import page3Expect from '../../../fixtures/clearcompany/vafb-page3.expect.json';
import page3Html from '../../../fixtures/clearcompany/vafb-page3.html?raw';
import menuExpect from '../../../fixtures/clearcompany/vafb-uploads-menu-open.expect.json';
import menuHtml from '../../../fixtures/clearcompany/vafb-uploads-menu-open.html?raw';
import uploadsExpect from '../../../fixtures/clearcompany/vafb-uploads.expect.json';
import uploadsHtml from '../../../fixtures/clearcompany/vafb-uploads.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { settleCapFor } from '../../dom/settle';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime } from '../../content/runtime';
import { signIn, type SignInContext } from '../../content/sign-in';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { signInFormOf } from '../../dom/sign-in-form';
import { SETTLE_CAP_MS } from '../../dom/thresholds';
import type { ScannedField } from '../../dom/types';
import { configuredAdapter, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { adaptersFor } from '../index';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { CLEARCOMPANY_CONFIG, CLEARCOMPANY_FIXTURES, clearCompanyAdapter } from './index';

const VAFB = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const VAFB_PAGES = `${VAFB}/8c16cd46-9b5e-ded1-cf8b-6417fd8e13c7`;
const FERRILLI = 'https://ferrilli.clearcompany.com/careers/jobs/5b431c56-73cc-fc8f-6dcd-00326e07264a/apply/e1158680-dfe1-e362-4721-174afa94cb63';
const ATLAS = 'https://atlas-tech.clearcompany.com/careers/jobs/401628c4-6e08-137e-31a1-d1ad933c002c/apply/ef7d125c-bc12-0e1f-a131-2d443c9ad4a7?source=REDACTED';

const CASES = [
  { name: 'vafb-account', html: accountHtml, json: accountExpect, address: VAFB },
  { name: 'vafb-uploads', html: uploadsHtml, json: uploadsExpect, address: VAFB_PAGES },
  { name: 'vafb-uploads-menu-open', html: menuHtml, json: menuExpect, address: VAFB_PAGES },
  { name: 'vafb-page2', html: page2Html, json: page2Expect, address: VAFB_PAGES },
  { name: 'vafb-page3', html: page3Html, json: page3Expect, address: VAFB_PAGES },
  { name: 'ferrilli-page2', html: ferrilliHtml, json: ferrilliExpect, address: FERRILLI },
  { name: 'atlas-uploads-saving', html: savingHtml, json: savingExpect, address: ATLAS },
  { name: 'atlas-loading', html: loadingHtml, json: loadingExpect, address: ATLAS },
] as const;

beforeAll(() => {
  testVocab();
});
afterEach(() => removeFixtures(document));

const open = (html: string) => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
const without = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...CLEARCOMPANY_CONFIG, ...change });
const fieldsOf = (fixture: Fixture, adapter: Adapter = clearCompanyAdapter): readonly ScannedField[] =>
  scan(adapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'clearcompany' }).fields;
const CONTINUE = 'button[data-localized-key="forms.application.continue"]';
const SUBMIT = 'button[data-localized-key="forms.application.submit"]';

describe('the ClearCompany adapter: its hooks and scans on the snapshots', () => {
  it("names each snapshot it was written from, and is the registry's adapter on the tenants' /careers/ pages", () => {
    expect([...CLEARCOMPANY_FIXTURES].sort()).toEqual(CASES.map((each) => `fixtures/clearcompany/${each.name}.html`).sort());
    expect(adaptersFor(new URL(VAFB_PAGES))[0]).toBe(clearCompanyAdapter);
    expect(adaptersFor(new URL('https://vafb.clearcompany.com/blank/page'))[0]).not.toBe(clearCompanyAdapter);
    expect(ATS_CONFIGS.clearcompany).toBe(CLEARCOMPANY_CONFIG);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json }) => {
    const fixture = await open(html);
    expect(compareHooks(fixture.doc, clearCompanyAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const read = await scanCase(document, html, address);
      expect(read.adapter).toBe(clearCompanyAdapter);
      expect(compareWithExpectation(read.doc, read.result, readExpectation(json))).toEqual([]);
    });
});

describe('the account step (vafb-account)', () => {
  it("pauses as an account's creation: Sign-in Auto types the email twice, the rest and Continue are the person's",
    async () => {
      const fixture = await open(accountHtml);
      expect(detectPause(fixture.doc, null, clearCompanyAdapter)).toEqual({ kind: 'create-account', evidence: 'adapter' });
      // Its root is the account's own form (the behaviour review of 2026-11-06): the run finds the page and pauses there.
      expect(clearCompanyAdapter.detect(fixture.doc)?.formRoot).toBe(q(fixture, 'form#personal-info-form'));
      const form = signInFormOf(clearCompanyAdapter, fixture.doc, 'create-account')!;
      expect([form.email, form.confirmEmail, form.password, form.button, form.personPresses]).toEqual([
        q(fixture, 'input.email'), q(fixture, 'input.email-confirm'), null, q(fixture, `form#personal-info-form ${CONTINUE}`), true]);
      // No run presses Continue: the step is no step of the run's (no Next, finality unknown).
      expect(clearCompanyAdapter.nextButton?.(fixture.doc.body)).toBeNull();
      expect(clearCompanyAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
      expect(clearCompanyAdapter.neverPress!(fixture.doc.documentElement)).toContain(q(fixture, 'button.have-account-button'));
      // Undone (no account state): no pause, no declared form; the page would read as nothing at all.
      const noState = without({ states: undefined });
      expect([noState.authState?.(fixture.doc), signInFormOf(noState, fixture.doc, 'create-account')]).toEqual([null, null]);
      // The state's root undone: no root, the page is nothing of the adapter's.
      const noRoot = without({ states: CLEARCOMPANY_CONFIG.states!.map(({ root: _root, ...state }) => state) });
      expect(noRoot.detect(fixture.doc)).toBeNull();
    });

  // The behaviour review of 2026-11-06 (builder B1: an own adapter's state is never the generic's): with its root, a run
  // finds the account page and pauses there; nothing is filled from the profile. Sign-in Auto reads the declared form,
  // but types into a create-account form only beside a password box (content/sign-in.ts), which this one has not: it
  // types nothing and presses nothing, and the page is the person's.
  it('pauses a run there with nothing filled, and Sign-in Auto types nothing into a form with no password box', async () => {
    const fixture = await open(accountHtml);
    // Read at its own address (the converter wrote every form's action as /__submitted, which then resolves there).
    const base = fixture.doc.createElement('base');
    base.href = VAFB;
    fixture.doc.head.prepend(base);
    const form = q(fixture, 'form#personal-info-form');
    const controls = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
    const before = controls.map((input) => [input.value, input.checked]);
    const changed = () => controls.filter((input, at) => input.value !== before[at]![0] || input.checked !== before[at]![1]);
    const clicks: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push(event.composedPath()[0] as Element);
      event.preventDefault();
    }, true);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => VAFB, isTop: true,
      settle: { quietMs: 200 } });
    try {
      await runtime.fill({});
      // The run found the page (its root) and paused as an account's creation: the person's.
      expect(worker.reports.map((report) => [report.status, report.notices])).toEqual([['auth-needed', [{ code: 'auth' }]]]);
      expect(worker.of('plan/request')).toEqual([]);
      expect(changed()).toEqual([]);
    } finally {
      runtime.stop();
    }
    const outcome = await signIn({ doc: fixture.doc, adapter: clearCompanyAdapter, href: () => VAFB,
      channel: { request: async () => ({ ok: true, data: { host: 'vafb.clearcompany.com', email: 'guest@example.com',
        password: 'not-a-real-password' } }) } as unknown as SignInContext['channel'],
      isTop: true, signal: new AbortController().signal, settleMs: 300 });
    expect(outcome).toBe('unavailable');
    expect(changed()).toEqual([]);
    expect(clicks).toEqual([]);
  });
});

describe('the pages (vafb-uploads, vafb-page2, vafb-page3, ferrilli-page2)', () => {
  it('reads each page from its breadcrumb, presses Continue before the last and never Back', async () => {
    const expected = [
      { html: uploadsHtml, anchors: ['page-0 active'], progress: 'Page 1 Page 2 Page 3', heading: '', final: 'not-final' },
      { html: page2Html, anchors: ['page-1 active'], progress: 'Page 1 Page 2 Page 3', heading: 'Contact Information',
        final: 'not-final' },
      { html: page3Html, anchors: ['page-2 active'], progress: 'Page 1 Page 2 Page 3', heading: 'Additional Information',
        final: 'final' },
      { html: ferrilliHtml, anchors: ['page-1 active'], progress: 'Page 1 Page 2', heading: 'APPLICANT INFORMATION',
        final: 'final' },
    ] as const;
    for (const { html, anchors, progress, heading, final } of expected) {
      const fixture = await open(html);
      const root = clearCompanyAdapter.detect(fixture.doc)!.formRoot;
      expect(clearCompanyAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: [...anchors], heading, progress });
      expect(clearCompanyAdapter.isFinalStep?.(fixture.doc)).toBe(final);
      expect(clearCompanyAdapter.nextButton?.(root) ?? null).toBe(final === 'final' ? null : q(fixture, CONTINUE));
      const back = fixture.doc.querySelector('button.back-button');
      if (back !== null) expect(clearCompanyAdapter.neverPress!(root)).toContain(back);
      if (final === 'final') {
        expect(clearCompanyAdapter.submitButton?.(root)).toBe(q(fixture, SUBMIT));
        // Undone (no Submit rule): the last page's one button.submit-button is neither Next nor Submit: unknown.
        expect(without({ submit: undefined }).isFinalStep?.(fixture.doc)).toBe('unknown');
      }
      removeFixtures(document);
    }
  });

  it('labels the radio groups by their question, which no fieldset or legend names', async () => {
    const fixture = await open(page2Html);
    const work = () => (adapter: Adapter) => fieldsOf(fixture, adapter).find((field) => field.kind === 'radio'
      && field.options !== 'lazy' && field.options.length === 3);
    expect(work()(clearCompanyAdapter)).toMatchObject({ label: 'What kind of work are you looking for?', required: true,
      labelSource: 'adapter' });
    expect(work()(without({ questions: undefined }))?.labelSource).toBe('none');
  });

  it('reads the clipped "I Agree" box through its wrapping label, required by its question\'s star', async () => {
    const fixture = await open(page3Html);
    const agree = (adapter: Adapter) => fieldsOf(fixture, adapter).find((field) => field.kind === 'checkbox');
    expect(agree(clearCompanyAdapter)).toMatchObject({ label: 'Please confirm you read and understand the above.',
      required: true, proxy: 'adapter', visibility: 'hidden-native-with-visible-label' });
    // Undone: with no proxy the box is a hidden control ignored; with no question rule it has no question, so nothing
    // says it is required (the box has no required of its own; the star ends the question's title).
    expect(agree(without({ proxies: undefined }))).toBeUndefined();
    expect(agree(without({ questions: undefined }))?.required).toBe(false);
  });

  it('reads a hidden follow-up question once its option shows it', async () => {
    const fixture = await open(page3Html);
    const holder = q(fixture, 'div.child-field-holder-0[style*="display: none"]');
    const label = holder.querySelector('label.field-title')!.textContent!.trim();
    expect(fieldsOf(fixture).some((field) => field.label === label)).toBe(false);
    holder.removeAttribute('style');
    expect(fieldsOf(fixture).find((field) => field.label === label)?.kind).toBe('textarea');
  });
});

describe('the uploads and the page\'s saving (vafb-uploads, vafb-uploads-menu-open, atlas-uploads-saving)', () => {
  it('reads each upload behind its Upload menu by its title, the Résumé required by its star', async () => {
    for (const html of [uploadsHtml, menuHtml]) {
      const fixture = await open(html);
      const root = clearCompanyAdapter.detect(fixture.doc)!.formRoot;
      const resume = q<HTMLInputElement>(fixture, 'div.qa-resume-upload.resume input[type="file"]');
      expect(clearCompanyAdapter.uploadWidgets?.(root)[0]).toEqual({ input: resume,
        control: q(fixture, 'div.qa-resume-upload.resume button.dropdown-toggle') });
      expect(fieldsOf(fixture).map((field) => [field.kind, field.label, field.required])).toEqual([['file', 'Resume', true],
        ['file', 'Cover Letter', false]]);
      // Before a file is in, its row is absent: pending.
      expect(clearCompanyAdapter.uploadState?.(resume, 'resume.pdf')).toBe('pending');
      // Undone: with no upload rule the inputs are no fields; with no question rule the Résumé has no title, so no star
      // makes it required.
      expect(fieldsOf(fixture, without({ uploads: undefined }))).toEqual([]);
      expect(fieldsOf(fixture, without({ questions: undefined }))[0]?.required).toBe(false);
      removeFixtures(document);
    }
  });

  it("reads the file's row as the upload done, and the page's saving and loading as busy", async () => {
    const saving = await open(savingHtml);
    const resume = q<HTMLInputElement>(saving, 'div.qa-resume-upload.resume input[type="file"]');
    // The behaviour review (M2): the row confirms only the file it names (td.file-name), never an older file's row;
    // and a named row is a file the page holds (uploadHeld), which a row naming none is not.
    expect(clearCompanyAdapter.uploadState?.(resume, 'resume.pdf')).toBe('pending');
    expect(clearCompanyAdapter.uploadHeld?.(resume)).toBe(true);
    q(saving, 'tbody.file-list > tr.file-row > td.file-name').textContent = ' resume.pdf ';
    expect(clearCompanyAdapter.uploadState?.(resume, 'resume.pdf')).toBe('confirmed');
    expect(without({ uploads: [{ ...CLEARCOMPANY_CONFIG.uploads![0]!, name: undefined }] })
      .uploadState?.(resume, 'other.pdf')).toBe('confirmed');
    q(saving, 'tbody.file-list > tr.file-row > td.file-name').textContent = '';
    expect(clearCompanyAdapter.uploadHeld?.(resume)).toBe(false);
    expect(clearCompanyAdapter.isBusy?.(saving.doc)).toBe(true);
    expect(without({ busy: undefined }).isBusy?.(saving.doc)).toBe(false);
    // Each sign alone: the spinner, the notice, the button's "Saving...".
    for (const [index, sign] of CLEARCOMPANY_CONFIG.busy!.entries()) {
      expect(without({ busy: [sign] }).isBusy?.(saving.doc), `busy[${index}]`).toBe(true);
    }
    removeFixtures(document);
    const loading = await open(loadingHtml);
    expect([clearCompanyAdapter.detect(loading.doc), clearCompanyAdapter.isBusy?.(loading.doc)]).toEqual([null, true]);
    removeFixtures(document);
    const idle = await open(page2Html);
    expect(clearCompanyAdapter.isBusy?.(idle.doc)).toBe(false);
  });

  it('waits out its save as long as any page may (30 s), its notice saying "up to 60 seconds" (the behaviour review, minor 4)', () => {
    expect(settleCapFor(clearCompanyAdapter)).toBe(30_000);
    expect(settleCapFor(without({ quirks: undefined }))).toBe(SETTLE_CAP_MS);
  });
});

describe('the repeated rows (ferrilli-page2)', () => {
  it('reads Employment History and Education as repeatables, each row its own block, with its Add and Present', async () => {
    const fixture = await open(ferrilliHtml);
    const root = clearCompanyAdapter.detect(fixture.doc)!.formRoot;
    const [experience, education] = clearCompanyAdapter.repeatables!(root);
    expect([experience?.kind, experience?.blocks().length, education?.kind, education?.blocks().length])
      .toEqual(['experience', 4, 'education', 1]);
    for (const entry of [experience!, education!]) {
      expect(entry.addButton()?.textContent?.trim()).toBe('Add Additional Row');
      expect(entry.blocks()[0]!.contains(entry.currentlyHere!(entry.blocks()[0]!))).toBe(true);
    }
    const companies = fieldsOf(fixture).filter((field) => field.section.id === 'experience' && field.ordinal === 0
      && field.label.startsWith('Company Name'));
    // Each row's label[for] read within the row (core pass Z2 of 2026-11-06, dom/labels.ts explicitLabels): the rows
    // reuse the first row's ids, which the browser ties every row's label to; until then the first row read "Company
    // Name" four times and the other rows took the question rule's title.
    expect(companies.map((field) => [field.section.block, field.label, field.labelSource])).toEqual([
      [0, 'Company Name', 'for'], [1, 'Company Name', 'for'], [2, 'Company Name', 'for'], [3, 'Company Name', 'for']]);
    const firstRow = fixture.doc.querySelector<HTMLInputElement>('[id="87977d19-cf17-123c-4ac9-4e73751925f3"][data-group="0"]')!;
    expect(firstRow.labels).toHaveLength(4);
    // Undone: with no repeatables the four rows share one section and are told apart by order alone, and the label[for]
    // is read as the browser ties it: the first row's four labels (jr7 ENGINE-7 E1 item 7, RBP7-21: saying the same
    // words, they count once), the other rows' controls none (their question rule's title instead).
    const flat = fieldsOf(fixture, without({ code: undefined })).filter((field) => field.label.startsWith('Company Name'));
    expect(new Set(flat.map((field) => field.section.id))).toEqual(new Set(['employment-history']));
    expect(flat.map((field) => [field.label, field.labelSource])).toEqual([
      ['Company Name', 'for'], ['Company Name', 'adapter'],
      ['Company Name', 'adapter'], ['Company Name', 'adapter']]);
  });
});
