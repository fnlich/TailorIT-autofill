/*
 * jr7 ORACLE-7 P1 (FIX7PLAN §6.10): the Oracle adapter's jr7 hooks on the owner's snapshot7 oraclecloud1 captures (one
 * application on a tenant of Oracle's ocs cloud, from its posting to the page after submitting:
 * fixtures/oracle/jr7-oraclecloud1-*, converted with the redaction list) and on variants built inside each test (the
 * page's markup changed in place; values made up). It began as the jr7 auditor's and verifier's harnesses
 * (SP\jr7\audit\oracle.md §3, oracle-verify.md §1), whose readings are asserted here:
 * - jr7-O1: the code Oracle asks for at Submit is the account state 'email-code', the step signature changes when its
 *   dialog shows, the resting run then pauses there (the agent reads needs-you email_code), and its Verify is never
 *   pressed;
 * - jr7-O2: the site's my-profile is the page after submitting, and its active tile of the armed application, with its
 *   status shown, is the drawn sign; another application's, a draft's or a resolved one's never;
 * - jr7-O4: the tile layout's Education and Experience editors are repeatable blocks, read by their boxes' names; their
 *   invalid rows are errors; the tiles' Edit and Delete are never pressed; the Skill editor is no repeatable;
 * - jr7-O7: the required Skills block with nothing in it is a required block left.
 * The shared outcomes (Submit Auto holding on the blank section with ENGINE-7 E1, the agent keeping the tab with AUTO-7,
 * the success sign recorded by the worker, the rows RULES-7 reads) are P2's (SP\jr7\build\ORACLE-7.md).
 * Nothing here prints or keeps a value.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import postingHtml from '../../../fixtures/oracle/jr7-oraclecloud1-posting.html?raw';
import gateHtml from '../../../fixtures/oracle/jr7-oraclecloud1-email-gate.html?raw';
import blankHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-blank.html?raw';
import filledHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-filled.html?raw';
import editorAHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-editor-a.html?raw';
import editorBHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-editor-b.html?raw';
import readyHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-ready.html?raw';
import codeHtml from '../../../fixtures/oracle/jr7-oraclecloud1-submit-code.html?raw';
import confirmationHtml from '../../../fixtures/oracle/jr7-oraclecloud1-confirmation.html?raw';
import { agentVerdict } from '../../background/agent';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { stepSignature } from '../../core/steps/signature';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { deadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { oracleAdapter } from './index';

const SITE = 'https://fa-extu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1';
const JOB = `${SITE}/job/4285`;
const GATE = `${JOB}/apply/email`;
const SECTION = `${JOB}/apply/section/1/`;
const PROFILE = `${SITE}/my-profile`;

/** Every captured page, at the address the capture was saved at. */
const PAGES = [
  { name: 'posting', html: postingHtml, address: JOB },
  { name: 'email-gate', html: gateHtml, address: GATE },
  { name: 'section-blank', html: blankHtml, address: SECTION },
  { name: 'section-filled', html: filledHtml, address: SECTION },
  { name: 'section-editor-a', html: editorAHtml, address: SECTION },
  { name: 'section-editor-b', html: editorBHtml, address: SECTION },
  { name: 'section-ready', html: readyHtml, address: SECTION },
  { name: 'submit-code', html: codeHtml, address: SECTION },
  { name: 'confirmation', html: confirmationHtml, address: PROFILE },
] as const;

/** The application key of an address, as the worker and the runtime key it. */
function keyOf(address: string): string {
  const app = applicationOf(new URL(address));
  if (app === null) throw new Error(`no application at ${address}`);
  return app.applicationKey;
}

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: its forms and links resolve there. */
function setBase(doc: Document, address: string): void {
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
}

/** The page once its fade-ins have run, as a person sees it (oracle.browser.test.ts faded). */
function faded(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
  }
}

async function load(html: string, address: string): Promise<Document> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  setBase(fixture.doc, address);
  faded(fixture.doc);
  return fixture.doc;
}

/** The flow's form root on a section page (detect's answer; under the Submit's checklist, which hides the page from a
 *  person, the flow's own form). */
function rootOf(doc: Document): Element {
  const root = oracleAdapter.detect(doc)?.formRoot ?? doc.querySelector('form.apply-flow__content-form');
  if (root === null) throw new Error('no form root');
  return root;
}

/** The submit-code capture's dialog, copied into `doc` (built as nodes, never assigned as markup). */
function codeDialogIn(doc: Document): Element {
  const holder = new DOMParser().parseFromString(codeHtml, 'text/html');
  return doc.importNode(holder.querySelector('.apply-flow-summary-pin-code-required')!, true);
}

/** What the page shows after its Submit, drawn in place as captures 7 and 8 show it: the checklist modal (div.app
 *  aria-hidden), then the form hidden and the code dialog beside it, the modal gone. */
function drawCodeDialog(doc: Document): void {
  const form = doc.querySelector<HTMLElement>('form.apply-flow__content-form')!;
  form.style.display = 'none';
  form.setAttribute('aria-hidden', 'true');
  const holder = doc.createElement('div');
  holder.className = 'apply-flow__content';
  const live = doc.createElement('div');
  live.className = 'apply-flow__content';
  live.setAttribute('aria-live', 'polite');
  live.append(codeDialogIn(doc));
  holder.append(live);
  doc.querySelector('section.apply-flow__content-container')!.append(holder);
}

afterEach(() => removeFixtures(document));

// ── jr7-O1: the code at Submit ──────────────────────────────────────────────────────────────────────────────────────
describe('jr7-O1: the code Oracle asks for at Submit', () => {
  it('reads the code dialog beside the hidden form as the account state email-code, and nothing else as it', async () => {
    const states: Record<string, string | null> = {};
    for (const page of PAGES) {
      const doc = await load(page.html, page.address);
      states[page.name] = oracleAdapter.authState?.(doc) ?? null;
      removeFixtures(document);
    }
    expect(states).toEqual({ posting: null, 'email-gate': 'email-gate', 'section-blank': null, 'section-filled': null,
      'section-editor-a': null, 'section-editor-b': null, 'section-ready': null, 'submit-code': 'email-code',
      confirmation: null });
  });

  it('pauses on the adapter’s word there (no longer only the generic code-label rule), the form root none', async () => {
    const doc = await load(codeHtml, SECTION);
    expect(oracleAdapter.detect(doc)).toBeNull();
    expect(detectPause(doc, null, oracleAdapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
    // The dialog hidden (Oracle's checklist still over it, or the dialog closed): no code is asked.
    doc.querySelector<HTMLElement>('.apply-flow-summary-pin-code-required')!.style.display = 'none';
    expect(oracleAdapter.authState?.(doc)).toBeNull();
  });

  it('changes the step signature when the dialog shows: the checklist and the code are two steps', async () => {
    const ready = await load(readyHtml, SECTION);
    const atReady = oracleAdapter.stepSignature!(ready);
    removeFixtures(document);
    const code = await load(codeHtml, SECTION);
    const atCode = oracleAdapter.stepSignature!(code);
    expect(atReady).toEqual({ anchors: [] });
    expect(atCode).toEqual({ urlPart: 'section/1', anchors: ['email-code'] });
    expect(stepSignature(atCode)).not.toBe(stepSignature(atReady));
    removeFixtures(document);
    // The pages that show neither the flow nor a code read as before.
    for (const [html, address] of [[postingHtml, JOB], [confirmationHtml, PROFILE]] as const) {
      const doc = await load(html, address);
      expect(oracleAdapter.stepSignature!(doc)).toEqual({ anchors: [] });
      removeFixtures(document);
    }
  });

  it('never presses the dialog’s Verify, nor its Send New Code', async () => {
    const doc = await load(codeHtml, SECTION);
    const never = oracleAdapter.neverPress?.(doc.documentElement) ?? [];
    const verify = Array.from(doc.querySelectorAll('.apply-flow-summary-pin-code-required button[type="submit"]'));
    expect(verify.map((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['Verify']);
    expect(never).toEqual(expect.arrayContaining([...verify,
      ...Array.from(doc.querySelectorAll('button.pin-code-form__action-button'))]));
    // The generic adapter, which claims the dialog's form, offers no Submit there either (the verifier's experiment C).
    const generic = genericAdapter.detect(doc)?.formRoot ?? null;
    expect(generic === null ? null : genericAdapter.submitButton?.(generic) ?? null).toBeNull();
  });

  describe('the resting run after its Submit (the verifier’s experiment A, with the adapter as built)', () => {
    beforeAll(() => testVocab());
    const runtimes: ContentRuntime[] = [];
    afterEach(() => {
      for (const runtime of runtimes.splice(0)) runtime.stop();
    });

    it('pauses email-code when the code dialog shows, so the agent reads needs-you email_code; nothing is typed there',
      async () => {
        const doc = await load(blankHtml, SECTION);
        // The contact and e-signature blocks alone: a form Submit mode Auto presses (the rest is P2's).
        for (const block of Array.from(doc.querySelectorAll('.apply-flow-block'))) {
          if (!/\bapply-flow-block--(?:personal-information-basic|apply-flow-e-signature)\b/.test(block.className)) block.remove();
        }
        const pressed: string[] = [];
        doc.addEventListener('click', (event) => {
          const button = (event.target as Element).closest('button');
          if (button !== null) pressed.push((button.textContent ?? '').replace(/\s+/g, ' ').trim());
          event.preventDefault();
        }, true);
        const settings: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto', next: 'auto' } };
        const worker = createFakeWorker({ settings });
        const runtime = await startContentRuntime(worker.platform, doc, { href: () => SECTION, isTop: true,
          adapters: () => [oracleAdapter], settle: { quietMs: 40 }, submitConfirmMs: 6_000, submitWatchMs: 20_000 });
        runtimes.push(runtime);
        await runtime.fill();
        await vi.waitFor(() => expect(worker.of('submit/armed').length).toBeGreaterThan(0), { timeout: 60_000 });
        expect(pressed).toContain('Submit');
        const armedAt = worker.reports.length;
        // Oracle's checklist, then its code dialog beside the hidden form (captures 7 and 8).
        doc.querySelector('div.app')!.setAttribute('aria-hidden', 'true');
        await deadline(900);
        drawCodeDialog(doc);
        doc.querySelector('div.app')!.setAttribute('aria-hidden', 'false');
        expect(oracleAdapter.authState?.(doc)).toBe('email-code');
        await vi.waitFor(() => expect(worker.reports.slice(armedAt).some((report) => report.status === 'handoff'
          && report.pauseReason === 'email-code')).toBe(true), { timeout: 15_000 });
        const paused = worker.reports.slice(armedAt).find((report) => report.status === 'handoff')!;
        expect(agentVerdict(paused, { retried: false })).toEqual({ kind: 'finish', state: 'needs-you', reason: 'email_code' });
        const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input.pin-code-input__input'));
        expect(boxes.length).toBe(6);
        expect(boxes.filter((box) => box.value !== '').length).toBe(0);
        expect(pressed.filter((words) => /verify|send new code/i.test(words))).toEqual([]);
      }, 120_000);
  });
});

// ── jr7-O2: the page after submitting ──────────────────────────────────────────────────────────────────────────────
describe('jr7-O2: my-profile after the Submit, and its tile of the armed application', () => {
  const ARMED = keyOf(SECTION);

  it('takes the site’s my-profile as the page after submitting the armed application, and keys it nothing', () => {
    expect(applicationOf(new URL(PROFILE))).toBeNull();
    expect(keyOf(JOB)).toBe(ARMED);
    // Both forms of the armed address AUTO-7 passes: the content runtime's (the address at the press) and the
    // worker's (the arm's canonical posting address).
    expect(oracleAdapter.confirmationAfter?.(new URL(SECTION), new URL(PROFILE))).toBe(true);
    const canonical = applicationOf(new URL(SECTION))!.applicationUrl;
    expect(canonical).toBe(JOB);
    expect(oracleAdapter.confirmationAfter?.(new URL(canonical), new URL(PROFILE))).toBe(true);
    expect(oracleAdapter.confirmationAfter?.(new URL(SECTION), new URL(`${PROFILE}/sign-in`))).toBe(false);
    expect(oracleAdapter.confirmationAfter?.(new URL(SECTION), new URL(SECTION))).toBe(false);
    expect(oracleAdapter.confirmationAfter?.(new URL(SECTION),
      new URL('https://fa-extu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_9/my-profile'))).toBe(false);
  });

  it('reads the active tile of the armed application, with its status shown: 1; another application’s key: 0', async () => {
    const doc = await load(confirmationHtml, PROFILE);
    const signs = oracleAdapter.successSigns?.(doc, ARMED) ?? [];
    expect(signs.length).toBe(1);
    expect(signs[0]!.matches('.cs-applications__container-active li.cs-application-tile')).toBe(true);
    expect(isUserVisible(signs[0]!)).toBe(true);
    for (const other of [keyOf(`${SITE}/job/4286`), keyOf('https://other.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/4285'),
      keyOf(`${SITE.replace('CX_1', 'CX_2')}/job/4285`), 'oracle:0000000000000000', 'greenhouse:0000000000000000']) {
      expect(oracleAdapter.successSigns?.(doc, other), other).toEqual([]);
    }
  });

  it('is absent on every other page of the application, before any Submit (the arm’s key)', async () => {
    for (const page of PAGES.filter((each) => each.name !== 'confirmation')) {
      const doc = await load(page.html, page.address);
      expect(oracleAdapter.successSigns?.(doc, ARMED), page.name).toEqual([]);
      removeFixtures(document);
    }
  });

  it('never reads a draft’s tile, a resolved one’s, one off my-profile, one hidden or with no status shown', async () => {
    const variants: ReadonlyArray<[string, (doc: Document) => void, string]> = [
      ['the tile moved to the drafts', (doc) => {
        doc.querySelector('.cs-applications__container-drafts')!.append(doc.querySelector('li.cs-application-tile')!);
      }, PROFILE],
      ['the tile moved to the resolved', (doc) => {
        doc.querySelector('.cs-applications__container-resolved')!.append(doc.querySelector('li.cs-application-tile')!);
      }, PROFILE],
      ['the active container marked a draft too', (doc) => {
        const active = doc.querySelector('.cs-applications__container-active')!;
        const drafts = doc.createElement('div');
        drafts.className = 'cs-applications__container-drafts';
        active.replaceWith(drafts);
        drafts.append(active);
      }, PROFILE],
      ['the page at the posting’s address', () => undefined, JOB],
      ['the page at the profile’s sign-in', () => undefined, `${PROFILE}/sign-in`],
      ['the page at another site’s my-profile', () => undefined, `${SITE.replace('CX_1', 'CX_2')}/my-profile`],
      ['the tile hidden', (doc) => {
        doc.querySelector<HTMLElement>('li.cs-application-tile')!.style.display = 'none';
      }, PROFILE],
      ['its status emptied', (doc) => {
        for (const status of Array.from(doc.querySelectorAll('.cs-job-status__value'))) status.textContent = '';
      }, PROFILE],
      ['its status hidden', (doc) => {
        for (const status of Array.from(doc.querySelectorAll<HTMLElement>('.cs-job-status__value'))) status.style.display = 'none';
      }, PROFILE],
      ['its link on another origin', (doc) => {
        const link = doc.querySelector('a.cs-job-info__title')!;
        link.setAttribute('href', 'https://other.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/4285');
      }, PROFILE],
      ['its link to no posting', (doc) => {
        doc.querySelector('a.cs-job-info__title')!.setAttribute('href', `${SITE}/requisitions`);
      }, PROFILE],
    ];
    for (const [name, change, address] of variants) {
      const doc = await load(confirmationHtml, address);
      change(doc);
      expect(oracleAdapter.successSigns?.(doc, ARMED), name).toEqual([]);
      removeFixtures(document);
    }
  });

  it('takes the tile among others: only the armed application’s, whatever their order', async () => {
    const doc = await load(confirmationHtml, PROFILE);
    const tile = doc.querySelector('li.cs-application-tile')!;
    const before = tile.cloneNode(true) as Element;
    before.querySelector('a.cs-job-info__title')!.setAttribute('href', `${SITE}/job/4286`);
    const after = tile.cloneNode(true) as Element;
    after.querySelector('a.cs-job-info__title')!.setAttribute('href', `${SITE}/job/1`);
    tile.before(before);
    tile.after(after);
    expect(oracleAdapter.successSigns?.(doc, ARMED)).toEqual([tile]);
    expect(oracleAdapter.successSigns?.(doc, keyOf(`${SITE}/job/4286`))).toEqual([before]);
  });

  it('reads it on an employer’s own domain only where the app’s shell shows', async () => {
    const OWN = 'https://careers.example-employer.com/hcmUI/CandidateExperience/en/sites/CX_1';
    const doc = await load(confirmationHtml, `${OWN}/my-profile`);
    const link = doc.querySelector('a.cs-job-info__title')!;
    link.setAttribute('href', `${OWN}/job/4285`);
    expect(oracleAdapter.successSigns?.(doc, keyOf(`${OWN}/job/4285`))?.length).toBe(1);
    for (const shell of Array.from(doc.querySelectorAll('oj-dialog, minimal-dialog'))) shell.remove();
    expect(oracleAdapter.successSigns?.(doc, keyOf(`${OWN}/job/4285`))).toEqual([]);
  });
});

// ── jr7-O4: the tile layout's inline editor ─────────────────────────────────────────────────────────────────────────
describe('jr7-O4: the tile layout’s Education and Experience editors', () => {
  it('declares the open editor as a repeatable block of its kind, and none where no editor of a kind is open', async () => {
    const kinds: Record<string, string[]> = {};
    for (const page of PAGES.filter((each) => each.name.startsWith('section-'))) {
      const doc = await load(page.html, page.address);
      kinds[page.name] = (oracleAdapter.repeatables?.(rootOf(doc)) ?? [])
        .map((section) => `${section.kind}:${section.blocks().length}:${section.addButton?.() === null ? 'no-add' : 'add'}`);
      removeFixtures(document);
    }
    expect(kinds).toEqual({ 'section-blank': [], 'section-filled': ['education:1:no-add'],
      'section-editor-a': ['experience:1:no-add'], 'section-editor-b': [], 'section-ready': [] });
  });

  it('reads the entry an open editor holds by its boxes’ names (values made up)', async () => {
    const education = await load(filledHtml, SECTION);
    education.querySelector<HTMLInputElement>('input[name="educationalEstablishment"]')!.value = 'Riverside College';
    const [school] = oracleAdapter.repeatables?.(rootOf(education)) ?? [];
    expect(oracleAdapter.prefill?.readEntries?.('education', school!.blocks())).toEqual([
      { block: 0, values: [{ category: 'education.school', text: 'Riverside College' }] }]);
    removeFixtures(document);
    const experience = await load(editorAHtml, SECTION);
    experience.querySelector<HTMLInputElement>('input[name="employerName"]')!.value = 'Northwind Analytics';
    experience.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value = 'Site Reliability Engineer';
    const [work] = oracleAdapter.repeatables?.(rootOf(experience)) ?? [];
    expect(oracleAdapter.prefill?.readEntries?.('experience', work!.blocks())).toEqual([{ block: 0, values: [
      { category: 'experience.company', text: 'Northwind Analytics' },
      { category: 'experience.title', text: 'Site Reliability Engineer' }] }]);
  });

  it('tells the editors’ kinds by their boxes’ names when their labels say otherwise', async () => {
    const education = await load(filledHtml, SECTION);
    for (const label of Array.from(education.querySelectorAll('label[for^="educationalEstablishment"] span'))) {
      label.textContent = 'Institution';
    }
    expect((oracleAdapter.repeatables?.(rootOf(education)) ?? []).map((section) => section.kind)).toEqual(['education']);
    // No Degree row: no education's editor.
    education.querySelector('label[for^="contentItemId"]')!.closest('.input-row')!.remove();
    expect(oracleAdapter.repeatables?.(rootOf(education)) ?? []).toEqual([]);
    removeFixtures(document);
    const experience = await load(editorAHtml, SECTION);
    for (const label of Array.from(experience.querySelectorAll('label[for^="employerName"] span, label[for^="jobTitle"] span'))) {
      label.textContent = 'Field';
    }
    const sections = oracleAdapter.repeatables?.(rootOf(experience)) ?? [];
    expect(sections.map((section) => section.kind)).toEqual(['experience']);
    // Its entry read by the boxes' names alone (values made up).
    experience.querySelector<HTMLInputElement>('input[name="employerName"]')!.value = 'Northwind Analytics';
    experience.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value = 'Site Reliability Engineer';
    expect(oracleAdapter.prefill?.readEntries?.('experience', sections[0]!.blocks())).toEqual([{ block: 0, values: [
      { category: 'experience.company', text: 'Northwind Analytics' },
      { category: 'experience.title', text: 'Site Reliability Engineer' }] }]);
  });

  it('reads an open editor’s invalid row by its message, once', async () => {
    const extra = (doc: Document) => {
      const root = rootOf(doc);
      const own = new Set((oracleAdapter.errors?.(root) ?? []).map((error) => error.el));
      for (const error of genericAdapter.errors?.(root) ?? []) own.delete(error.el);
      return Array.from(own).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    };
    const filled = await load(filledHtml, SECTION);
    // The Education editor's Degree pills: no aria-invalid anywhere, only the row's mark and message.
    expect(filled.querySelectorAll('.profile-item-content--form [aria-invalid="true"]').length).toBe(0);
    expect(extra(filled)).toEqual(['The Degree field is required.']);
    removeFixtures(document);
    // The Skill editor's box says aria-invalid itself: the standard rule's, not counted again.
    const skill = await load(editorBHtml, SECTION);
    expect((genericAdapter.errors?.(rootOf(skill)) ?? []).length).toBeGreaterThan(0);
    expect(extra(skill)).toEqual([]);
    removeFixtures(document);
    for (const [html, name] of [[blankHtml, 'blank'], [readyHtml, 'ready'], [editorAHtml, 'editor-a']] as const) {
      const doc = await load(html, SECTION);
      expect(extra(doc), name).toEqual([]);
      removeFixtures(document);
    }
  });

  it('never presses a tile’s Edit or Delete', async () => {
    const doc = await load(filledHtml, SECTION);
    const never = new Set(oracleAdapter.neverPress?.(doc.documentElement) ?? []);
    const buttons = Array.from(doc.querySelectorAll('article.apply-flow-profile-item-tile button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter((button) => !never.has(button))).toEqual([]);
    expect(new Set(buttons.map((button) => button.getAttribute('title')))).toEqual(new Set(['Edit', 'Delete']));
  });
});

// ── jr7-O7: a required block with nothing to fill ──────────────────────────────────────────────────────────────────
describe('jr7-O7: the required Skills block, empty', () => {
  const left = (doc: Document) => oracleAdapter.requiredBlocksLeft?.(rootOf(doc)) ?? [];
  const titleOf = (block: Element) => (block.querySelector('.apply-flow-block__title')?.textContent ?? '')
    .replace(/\s+/g, ' ').trim();

  it('names the blank section’s Skills block, the block itself, and no block once it holds a tile or an editor', async () => {
    const found: Record<string, string[]> = {};
    for (const page of PAGES.filter((each) => each.name.startsWith('section-'))) {
      const doc = await load(page.html, page.address);
      found[page.name] = left(doc).map((block) => `${titleOf(block)}|${block.classList.contains('apply-flow-block')}`);
      removeFixtures(document);
    }
    expect(found).toEqual({ 'section-blank': ['Skills|true'], 'section-filled': [], 'section-editor-a': [],
      'section-editor-b': [], 'section-ready': [] });
  });

  it('follows the page: a block made required, a block emptied, an editor opened, a block hidden', async () => {
    // Education's title marked required too, on the blank page: both left.
    const blank = await load(blankHtml, SECTION);
    const education = Array.from(blank.querySelectorAll('.apply-flow-block--tile-profile-items'))
      .find((block) => titleOf(block) === 'Education')!;
    education.querySelector('.apply-flow-block__title')!.classList.add('apply-flow-block__title--required');
    expect(left(blank).map(titleOf)).toEqual(['Education', 'Skills']);
    // The Skills block hidden: not left (a person sees nothing to add).
    blank.querySelector<HTMLElement>('.apply-flow-block--skill')!.style.display = 'none';
    expect(left(blank).map(titleOf)).toEqual(['Education']);
    removeFixtures(document);
    // The filled page's skills removed: left again.
    const filled = await load(filledHtml, SECTION);
    for (const tile of Array.from(filled.querySelectorAll('.apply-flow-block--skill article.apply-flow-profile-item-tile'))) {
      tile.remove();
    }
    expect(left(filled).map(titleOf)).toEqual(['Skills']);
    removeFixtures(document);
    // The Skill editor open with no tile (an entry being added): its own required box is the scan's, not a block left.
    const editing = await load(editorBHtml, SECTION);
    for (const tile of Array.from(editing.querySelectorAll('.apply-flow-block--skill article.apply-flow-profile-item-tile'))) {
      tile.remove();
    }
    expect(left(editing)).toEqual([]);
    // The editor open before its rows are drawn (no control in it yet): still an entry under way, not a block left.
    const rows = editing.querySelector('.apply-flow-block--skill .profile-item-content--form form-builder')!;
    const drawn = Array.from(rows.childNodes);
    for (const row of drawn) row.remove();
    expect(editing.querySelectorAll('.apply-flow-block--skill .apply-flow-block__form-list input').length).toBe(0);
    expect(left(editing)).toEqual([]);
    rows.append(...drawn);
    // Once the editor is gone (Cancel), the block is left again.
    editing.querySelector('.apply-flow-block--skill .profile-item-content')!.remove();
    expect(left(editing).map(titleOf)).toEqual(['Skills']);
  });

  it('never counts a required block that holds a control', async () => {
    const doc = await load(blankHtml, SECTION);
    for (const block of Array.from(doc.querySelectorAll('.apply-flow-block'))) {
      block.querySelector('.apply-flow-block__title')?.classList.add('apply-flow-block__title--required');
    }
    // Every block but the three entry lists holds a control (its rows, its pills, its hidden upload input).
    expect(left(doc).map(titleOf).sort()).toEqual(['Education', 'Experience', 'Skills']);
  });
});
