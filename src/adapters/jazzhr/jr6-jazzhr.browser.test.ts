/*
 * jr6 (FIXPLAN 6.8): the JazzHR audit's harness (SP\jr6\audit\jazzhr.md §3) as asserts. JazzHR's pages as the owner
 * captured them (fixtures/jazzhr: the four 2026-11-06 Bootstrap cases and jr6-centroid-form, the 2026-11-10 capture in
 * the classic "resumator" layout), measured through the real registry, adapter, scan and planner: which adapter takes
 * the page, what it says of the step (final, Submit, busy, errors, posting text, the Human Check), and the writes the
 * golden synthetic profile (never the owner's data) gives with DEFAULT_SETTINGS, every one of the classic page's
 * writes guarded, landed and read back as the runtime does them.
 * P1 asserted what JazzHR's own rules decide. P2 (after merging jr6-engine and jr6-rules) asserts the shared outcomes on
 * the same pages:
 * - JZ-4, ENGINE E2's reveal door: the classic page's résumé in a whole run of the content runtime (the fake worker
 *   plans each pass with the golden profile and serves the golden résumé, a fake PDF): "Attach resume" pressed once,
 *   the input found once shown, at least 300 ms after the press (Jobright 1.25.2's JazzHR uploadResume waits 300 ms,
 *   module cgRxd), the file written and read back, no navigation; on the synthetic classic page (its own toggle
 *   script), on jr6-centroid-form as captured (the converter strips every script: the press shows nothing, so nothing
 *   is written and the row is the person's) and with JazzHR's toggle stood in for there; never on the Bootstrap layout,
 *   whose input shows;
 * - RULES' answers to the Bootstrap captures' questions: JZ-6 (item 21) the Race/Ethnicity list, JZ-7 (29) the
 *   citizenship / employment eligibility select, JZ-8 (30) a status asked yes or no, JZ-9 (47) the state, JZ-11 (54)
 *   inside the United States, jazzhr-new-1 (59) the references box. Each on the capture the plan names, with the golden
 *   profile or a variant of it built here (a status, EEO answers), and relabelled where the plan says so: the page's
 *   own label text replaced in the loaded page, as every DOM variant here is made (no fixture file is changed).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import centroidHtml from '../../../fixtures/jazzhr/jr6-centroid-form.html?raw';
import invaluableHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import nucleusHtml from '../../../fixtures/jazzhr/nucleussecurity-form.html?raw';
import panoptHtml from '../../../fixtures/jazzhr/panoptimization-form.html?raw';
import wellhiveHtml from '../../../fixtures/jazzhr/wellhive-submitting.html?raw';
import classicHtml from '../../../fixtures/synthetic/jazzhr/classic.html?raw';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import type { Race, WorkStatus } from '../../core/enums';
import { planFrame } from '../../core/plan/frame';
import { classifyField } from '../../core/resolver/resolve';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { fill } from '../../dom/fillers';
import { revealUpload } from '../../dom/fillers/upload';
import { verifyAfterSettle } from '../../dom/fillers/verify';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { domGuardBeforeWrite } from '../../dom/guard';
import { detectPause, pageChallenged } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { deadline } from '../../dom/time';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor, applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { jazzhrAdapter } from './index';

/** What each capture's step says: [final, Submit (tag#id), busy, posting text's id, fields scanned]. */
const CASES = [
  { name: 'jr6-centroid-form', html: centroidHtml, step: ['final', 'input#resumator-submit-resume', false,
    'resumator-job-description', 9] },
  { name: 'invaluable-form', html: invaluableHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description', 15] },
  { name: 'nucleussecurity-form', html: nucleusHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description',
    15] },
  { name: 'panoptimization-form', html: panoptHtml, step: ['final', 'a#resumator-submit-resume', false, 'job-description',
    12] },
  // Captured after Submit was pressed: "Submitting...please wait...", Submit gone (correct for this state).
  { name: 'wellhive-submitting', html: wellhiveHtml, step: ['unknown', 'none', true, 'job-description', 12] },
] as const;

const sourceOf = (html: string) => /"source":"([^"]+)"/.exec(html)![1]!;
const nameOf = (el: Element | null | undefined) => (el == null ? 'none' : `${el.localName}${el.id ? `#${el.id}` : ''}`);

/** The page's plan with the golden profile, or `profile` (a variant of it built here). */
function planOf(fields: ReturnType<typeof scan>['fields'], profile: Profile = goldenProfile()) {
  return planFrame({ specs: fields.map(toFieldSpec), canaries: [], profile, sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Company', location: 'Austin, TX, USA' } });
}

/** The profile's writes every JazzHR page asks the same of (id → category), JazzHR's own fields: the names, email,
 *  phone, address and résumé. */
const CORE = [
  ['resumator-firstname-value', 'identity.firstName', 'text'],
  ['resumator-lastname-value', 'identity.lastName', 'text'],
  ['resumator-email-value', 'contact.email', 'text'],
  ['resumator-phone-value', 'contact.phone', 'text'],
  ['resumator-address-value', 'address.line1', 'text'],
  ['resumator-city-value', 'address.city', 'text'],
  ['resumator-state-value', 'address.region', 'text'],
  ['resumator-postal-value', 'address.postalCode', 'text'],
  ['resumator-resume-value', 'file.resume', 'file'],
] as const;

/** The golden résumé's size as the fake worker serves it (a fake PDF named as the golden résumé). */
const RESUME_BYTES = 48_213;

/** Every link of a loaded page pointed at about:blank#<its id> (a DOM variant made here): a navigation a click might
 *  cause is then seen (the frame loads again, or its address changes) and loads nothing. The capture's links point at
 *  the live posting itself; the synthetic page's at "#", which a srcdoc frame resolves against the test runner. The
 *  reveal door's own cancel does not read the address. */
function linksOffline(doc: Document): void {
  for (const link of Array.from(doc.querySelectorAll('a[href]'))) link.setAttribute('href', `about:blank#${link.id || 'link'}`);
}

/** JazzHR's résumé toggle, which the converter strips with every script, stood in for on the capture as the synthetic
 *  page's own script does it: "Attach resume" shows the upload wrapper, hides the two choices and cancels the link,
 *  bound on the link in the bubble phase as a page's own script binds it. */
function standInToggle(doc: Document): void {
  doc.getElementById('resumator-choose-upload')!.addEventListener('click', (event) => {
    event.preventDefault();
    doc.getElementById('resumator-resume-upload-wrapper')!.classList.remove('none');
    doc.getElementById('resumator-resume-options')!.classList.add('none');
  });
}

/** Whether a loaded classic page still hides its résumé's upload wrapper (and so its file input). */
function uploadHidden(doc: Document): boolean {
  return doc.defaultView!.getComputedStyle(doc.getElementById('resumator-resume-upload-wrapper')!).display === 'none';
}

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('jr6 JazzHR: each capture through the registry, adapter, scan and plan', () => {
  it.each(CASES)('$name: JazzHR\'s adapter, its step, and the profile\'s writes of the core fields', async ({ html, step }) => {
    const url = new URL(sourceOf(html));
    const page = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
    expect(platformOfUrl(url.href)).toBe('jazzhr');
    expect(applicationOf(url)).toMatchObject({ platform: 'jazzhr', page: 'application' });
    const adapter = adaptersFor(url, page.doc).find((each) => each.detect(page.doc) !== null);
    expect(adapter?.id).toBe('jazzhr');
    const root = adapter!.detect(page.doc)!.formRoot;
    expect(root.matches('form#form_submit_new_resume')).toBe(true);
    const [final, submit, busy, posting, count] = step;
    expect([adapter!.isFinalStep?.(page.doc), nameOf(adapter!.submitButton?.(root)), adapter!.isBusy?.(page.doc),
      adapter!.postingText?.(page.doc)?.id, adapter!.nextButton, adapter!.entryControl?.(page.doc) ?? null,
      adapter!.errors?.(root)]).toEqual([final, submit, busy, posting, undefined, null, []]);
    // The Human Check is the person's: no pause, nothing challenged before a press (v5 PLAN decision 9).
    expect([detectPause(page.doc, root, adapter!), pageChallenged(page.doc)]).toEqual([null, false]);
    const scanned = scan(root, adapter!, { platform: 'jazzhr' });
    expect([scanned.fields.length, scanned.unrecognisedUploads.length, scanned.authFields]).toEqual([count, 0, 0]);
    const out = planOf(scanned.fields);
    const writes = CORE.map(([id]) => {
      const field = scanned.fields.find((each) => each.idAttr === id)!;
      const write = out.writes.find((each) => each.key === field.key);
      return [id, out.results.find((each) => each.key === field.key)?.category, write?.value.kind, write?.origin.provenance];
    });
    expect(writes).toEqual(CORE.map(([id, category, kind]) => [id, category, kind, 'profile']));
  });
});

describe('jr6 JazzHR: the classic layout\'s writes, guarded, landed and read back (JZ-1, JZ-4)', () => {
  it('jr6-centroid-form: every planned write passes the DOM guard, lands and reads back; the résumé once its reveal '
    + 'shows the input (P2: ENGINE E2\'s door, JazzHR\'s toggle stood in for)', async () => {
    const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
    linksOffline(page.doc);
    standInToggle(page.doc);
    const root = jazzhrAdapter.detect(page.doc)!.formRoot;
    const first = scan(root, jazzhrAdapter, { platform: 'jazzhr' });
    const out = planOf(first.fields);
    const file = new File([new Uint8Array(fakePdf(4_096))], GOLDEN_RESUME.fileName, { type: 'application/pdf' });
    // As the runtime keeps them (DOM-7): a placeholder our write hides still names its box.
    const held = new WeakMap<Element, string>();
    const rescan = () => scan(root, jazzhrAdapter, { platform: 'jazzhr', heldPlaceholders: held });
    const outcomes: Array<[string, string, string]> = [];
    for (const write of out.writes) {
      const field = first.fields.find((each) => each.key === write.key)!;
      const wanted = { key: field.key, baseKey: field.baseKey, label: field.label, kind: field.kind };
      let guard = domGuardBeforeWrite(first, wanted);
      expect(guard.ok, field.label).toBe(true);
      if (!guard.ok) continue;
      if (write.value.kind === 'file') {
        // The hidden input, its link the control; the upload filler's reveal (as content/pass.ts calls it) presses
        // "Attach resume" once and finds the input again, by the guard's fresh scan, once a person sees it.
        expect([field.label, field.visibility]).toEqual(['Resume', 'hidden-file-with-visible-control']);
        const revealed = await revealUpload(jazzhrAdapter, guard.target.control as HTMLInputElement, () => {
          const again = domGuardBeforeWrite(first, wanted);
          return again.ok ? again.target.control as HTMLInputElement : null;
        }, undefined);
        expect(revealed.outcome).toBe('revealed');
        guard = domGuardBeforeWrite(first, wanted);
        expect(guard.ok, field.label).toBe(true);
        if (!guard.ok) continue;
      }
      if (field.labelSource === 'placeholder') held.set(guard.target.control, field.label);
      const outcome = fill(guard.target, write.value, { adapter: jazzhrAdapter, root, file });
      const verified = verifyAfterSettle(rescan(), field.key, write.value,
        write.value.kind === 'file' ? { file: { name: file.name, size: file.size } } : {});
      outcomes.push([field.label, `${outcome.wrote}/${outcome.reason}`, `${verified.verification}/${verified.reason}`]);
    }
    expect(outcomes).toEqual(['First name', 'Last name', 'Email address', 'Address', 'City', 'State', 'Postal',
      'Phone number', 'Resume'].map((label) => [label, 'true/ok', 'verified/ok']));
    expect(out.writes).toHaveLength(9);
    expect(out.awaiting).toEqual([]);
    expect(page.doc.querySelector<HTMLInputElement>('#resumator-resume-value')!.files?.[0]?.name)
      .toBe(GOLDEN_RESUME.fileName);
  });
});

describe('jr6 JazzHR: facts the findings rest on (the classic layout)', () => {
  it('JZ-2, JZ-3, JZ-13: Submit is an input[type=button], the adapter\'s Submit; Cancel beside it is never pressed',
    async () => {
      const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
      const root = jazzhrAdapter.detect(page.doc)!.formRoot;
      const submit = page.doc.querySelector('input#resumator-submit-resume');
      expect(submit?.getAttribute('type')).toBe('button');
      expect(page.doc.querySelector('a#resumator-submit-resume')).toBeNull();
      expect(jazzhrAdapter.submitButton?.(root)).toBe(submit);
      const cancel = page.doc.querySelector('input#resumator-cancel-resume');
      expect(cancel?.getAttribute('type')).toBe('button');
      expect(jazzhrAdapter.neverPress?.(root)).toContain(cancel);
    });

  it('JZ-4: the classic layout hides the file input until "Attach resume", the upload\'s control, never pressed by a run',
    async () => {
      const page = await loadFixture(document, centroidHtml, SNAPSHOT_VIEWPORT);
      const root = jazzhrAdapter.detect(page.doc)!.formRoot;
      const wrapper = page.doc.querySelector('#resumator-resume-upload-wrapper')!;
      expect(wrapper.classList.contains('none')).toBe(true);
      expect(page.view.getComputedStyle(wrapper).display).toBe('none');
      const attach = page.doc.querySelector('#resumator-choose-upload')!;
      expect(jazzhrAdapter.neverPress?.(root)).toContain(attach);
      const fields = scan(root, jazzhrAdapter, { platform: 'jazzhr' }).fields.filter((field) => field.kind === 'file');
      expect(fields.map((field) => [field.label, field.required])).toEqual([['Resume', true]]);
    });
});

// ── P2 (FIXPLAN 6.8, "P2 asserts"), after merging jr6-engine (E1-E3) and jr6-rules (R1-R4) ─────────────────────────

const CENTROID = sourceOf(centroidHtml);
const INVALUABLE = sourceOf(invaluableHtml);
/** The synthetic classic page's address (fixtures/synthetic/jazzhr/classic.html's header). */
const CLASSIC = 'https://tailorit-fixture.applytojob.com/apply/0000000B01/Linux-Systems-Engineer';

/**
 * A whole run of the content runtime on `html` at `href`, as a person's Autofill starts it, the page's links kept
 * offline (linksOffline) and `change` made to the page before the run. The fake worker plans each pass with the golden
 * profile and DEFAULT_SETTINGS (Next and Submit: Manual) and serves the golden résumé; a cover letter is none. It
 * records every click the page receives (the element's id, or its tag), the time "Attach resume" was clicked and the
 * time a file first went into the résumé's input, and whether the page navigated.
 */
async function runOn(html: string, href: string, change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, html, { width: 1280, height: 2400 });
  const doc = fixture.doc;
  linksOffline(doc);
  change?.(doc);
  const clicks: string[] = [];
  const at: { press: number | null; file: number | null } = { press: null, file: null };
  doc.addEventListener('click', (event) => {
    // The page's elements are of its frame's realm: read by node type, never instanceof.
    const node = event.target as Node | null;
    const target = node?.nodeType === Node.ELEMENT_NODE ? node as Element : null;
    clicks.push(target?.id || target?.localName || 'unknown');
    if (target?.id === 'resumator-choose-upload') at.press ??= performance.now();
  }, { capture: true });
  const input = () => doc.getElementById('resumator-resume-value') as HTMLInputElement;
  input().addEventListener('change', () => {
    if ((input().files?.length ?? 0) > 0) at.file ??= performance.now();
  });
  let loads = 0;
  fixture.frame.addEventListener('load', () => {
    loads += 1;
  });
  let hashChanges = 0;
  fixture.view.addEventListener('hashchange', () => {
    hashChanges += 1;
  });
  const address = fixture.view.location.href;
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
    resume: { bytes: fakePdf(RESUME_BYTES), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' },
    letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => href, isTop: true,
    settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fixture, doc, input, clicks, at,
    /** One Autofill to its end: the run's end and its report's rows (the Resume row apart). */
    fill: async () => {
      const end = await runtime.fill({});
      const rows = (worker.reports.at(-1)?.fields ?? []) as FillResult[];
      return { end, rows, resume: rows.find((row) => row.category === 'file.resume') };
    },
    /** Whether the page navigated: its frame loaded again, its address changed, or a hashchange came. */
    navigated: async () => {
      await deadline(150);
      return loads > 0 || fixture.view.location.href !== address || hashChanges > 0;
    },
    /** The synthetic page's own log (fixtures/synthetic/jazzhr/classic.html). */
    jazz: () => (fixture.view as unknown as { __jazz: { toggled: string[]; pressed: string[]; submitted: number } }).__jazz,
  };
}

/** The core fields' rows of a classic page's run: each written and read back. */
const CLASSIC_WRITTEN = ['First name', 'Last name', 'Email address', 'Address', 'City', 'State', 'Postal', 'Phone number']
  .map((label) => ({ label, status: 'verified', wrote: true, reason: 'ok' }));

describe('jr6 P2 JZ-4 (ENGINE E2 item 9): the classic résumé, revealed once and written, in a whole run', () => {
  it('the synthetic classic page (JazzHR’s toggle): “Attach resume” pressed once, no navigation, the file written '
    + 'and read back at least 300 ms after the press; a second Autofill presses nothing', async () => {
    const run = await runOn(classicHtml, CLASSIC);
    const first = await run.fill();
    expect(first.end).not.toBeNull();
    expect(first.resume).toMatchObject({ label: 'Resume', required: true, status: 'verified', provenance: 'profile',
      wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(first.rows.filter((row) => row !== first.resume)).toMatchObject(CLASSIC_WRITTEN);
    expect(run.input().files?.[0]).toMatchObject({ name: GOLDEN_RESUME.fileName, size: RESUME_BYTES });
    // JazzHR's toggle heard "Attach resume" alone; nothing else was pressed, nothing submitted.
    expect(run.jazz()).toEqual({ toggled: ['resumator-choose-upload'], pressed: [], submitted: 0 });
    expect(run.clicks).toEqual(['resumator-choose-upload']);
    expect(run.at.file! - run.at.press!).toBeGreaterThanOrEqual(290);
    expect(await run.navigated()).toBe(false);
    // Again: the input shows (nothing to reveal) and holds the file; nothing is pressed, the file stays.
    const second = await run.fill();
    expect(second.resume).toMatchObject({ label: 'Resume', wrote: false });
    expect(run.jazz().toggled).toEqual(['resumator-choose-upload']);
    expect(run.clicks).toEqual(['resumator-choose-upload']);
    expect(run.input().files?.[0]?.name).toBe(GOLDEN_RESUME.fileName);
    expect(await run.navigated()).toBe(false);
  }, 60_000);

  it('jr6-centroid-form as captured (the converter strips JazzHR’s script): “Attach resume” pressed once, no '
    + 'navigation, the input stays hidden: nothing written, the Resume row the person’s; a second Autofill presses '
    + 'nothing', async () => {
    const run = await runOn(centroidHtml, CENTROID);
    const first = await run.fill();
    expect(first.end).not.toBeNull();
    expect(first.resume).toMatchObject({ label: 'Resume', required: true, status: 'flagged', wrote: false,
      reason: 'needs-your-click', needsUserAction: true });
    expect(first.rows.filter((row) => row !== first.resume)).toMatchObject(CLASSIC_WRITTEN);
    expect(run.input().files?.length ?? 0).toBe(0);
    expect(uploadHidden(run.doc)).toBe(true);
    expect(run.clicks).toEqual(['resumator-choose-upload']);
    expect(await run.navigated()).toBe(false);
    // Never a second press in this document, though the input is still hidden.
    const second = await run.fill();
    expect(second.resume).toMatchObject({ wrote: false, reason: 'needs-your-click', needsUserAction: true });
    expect(run.clicks).toEqual(['resumator-choose-upload']);
    expect(await run.navigated()).toBe(false);
  }, 60_000);

  it('jr6-centroid-form with JazzHR’s toggle stood in for: pressed once, no navigation, the file written and read '
    + 'back at least 300 ms after the press', async () => {
    const run = await runOn(centroidHtml, CENTROID, standInToggle);
    const first = await run.fill();
    expect(first.resume).toMatchObject({ label: 'Resume', status: 'verified', wrote: true, verification: 'verified',
      reason: 'ok', needsUserAction: false });
    expect(first.rows.filter((row) => row !== first.resume)).toMatchObject(CLASSIC_WRITTEN);
    expect(run.input().files?.[0]).toMatchObject({ name: GOLDEN_RESUME.fileName, size: RESUME_BYTES });
    expect(uploadHidden(run.doc)).toBe(false);
    expect(run.clicks).toEqual(['resumator-choose-upload']);
    expect(run.at.file! - run.at.press!).toBeGreaterThanOrEqual(290);
    expect(await run.navigated()).toBe(false);
  }, 60_000);

  it('invaluable-form (the Bootstrap layout: its input shown, the link hidden): nothing pressed, the résumé written '
    + 'as before', async () => {
    const run = await runOn(invaluableHtml, INVALUABLE);
    const first = await run.fill();
    expect(first.resume).toMatchObject({ label: 'Resume', status: 'verified', wrote: true, verification: 'verified' });
    expect(run.input().files?.[0]).toMatchObject({ name: GOLDEN_RESUME.fileName, size: RESUME_BYTES });
    expect(run.clicks).not.toContain('resumator-choose-upload');
    expect(run.at.press).toBeNull();
    expect(await run.navigated()).toBe(false);
  }, 60_000);
});

/** The golden profile with its U.S. work-authorization entry stating `status`, its other answers kept (synthetic). */
function withStatus(status: WorkStatus): Profile {
  const golden = goldenProfile();
  return { ...golden, workAuthorization: golden.workAuthorization.map((each) => (each.country === 'US'
    ? { ...each, status: { kind: 'value', value: status } } : each)) };
}

/** The golden profile with these EEO answers (synthetic): its races, whether Hispanic or Latino, its gender. */
function withEeo(race: Race[], hispanic: boolean, gender: 'female' | 'male'): Profile {
  const golden = goldenProfile();
  return { ...golden, eeo: { ...golden.eeo, race: { kind: 'value', value: race },
    hispanicLatino: { kind: 'value', value: hispanic }, gender: { kind: 'value', value: { identity: gender } } } };
}

/** The option a write chose, the options it ticked, or the text it typed. */
function answerOf(write: PlannedWrite | undefined): string | string[] | undefined {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return [...value.cleanLabels];
  if (value.kind === 'text') return value.text;
  return value.kind;
}

/** The page's own label text of the question whose label is for `id`, replaced (a DOM variant made here). */
const relabel = (id: string, text: string) => (doc: Document) => {
  doc.querySelector(`label[for="${id}"]`)!.firstChild!.textContent = text;
};

/**
 * A capture loaded (after `change`) and scanned by JazzHR's adapter; `plan(css, profile)` plans the page with the golden
 * profile or `profile` and answers, for the field whose control (or one of whose boxes) `css` names: its label and kind,
 * how the rules read it ([category, rule]), its answer and the write's origin, its row, the AI scopes it is asked in,
 * and whether a draft is asked for it.
 */
async function captured(html: string, change?: (doc: Document) => void) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  change?.(fixture.doc);
  const root = jazzhrAdapter.detect(fixture.doc)!.formRoot;
  const scanned = scan(root, jazzhrAdapter, { platform: 'jazzhr' });
  const fieldOf = (css: string) => {
    const el = fixture.doc.querySelector(css);
    const field = scanned.fields.find((each) => {
      const target = scanned.target(each.key);
      return target !== null && (target.control === el || target.members.some((member) => member === el));
    });
    if (field === undefined) throw new Error(`no field for ${css}`);
    return field;
  };
  const plan = (css: string, profile: Profile = goldenProfile()) => {
    const field = fieldOf(css);
    const out = planOf(scanned.fields, profile);
    const classified = classifyField(toFieldSpec(field), testVocab());
    const rules = classified.by === 'rules' ? classified.rules : null;
    const write = out.writes.find((each) => each.key === field.key);
    const row = out.results.find((each) => each.key === field.key)!;
    return { field, write, label: field.label, kind: field.kind, read: [rules?.category ?? null, rules?.rule ?? null],
      answer: answerOf(write), origin: write?.origin, row: { status: row.status, reason: row.reason,
        needsUserAction: row.needsUserAction },
      scopes: (out.ask?.answers ?? []).filter((each) => each.key === field.key).map((each) => each.scope),
      drafted: (out.ask?.drafts ?? []).some((each) => each.key === field.key) };
  };
  return { ...fixture, root, scanned, fieldOf, plan };
}

const RACE = '#resumator-eeo_race-value';
const GENDER = '#resumator-eeo_gender-value';
const CITIZEN = '#resumator-citizen-value';
/** invaluable-form's required Yes/No select "Will you be working from inside the United States?". */
const INSIDE_ID = 'resumator-questionnaire-q3021276';
/** wellhive-submitting's required Yes/No boxes "Are you a US Citizen or Permanent Resident? (Note - EAD …)" (its Yes)
 *  and "Are you able to work remotely from a state within the United States?" (its Yes). */
const CITIZEN_BOX = '#resumator-checkbox-3076695-1';
const REMOTE_BOX = '#resumator-checkbox-3076696-1';
/** wellhive-submitting's required select "From which state will you be working?" (51 states). */
const STATE_ID = 'resumator-questionnaire-q3076710';
const REFERENCES = '#resumator-references-value';

/** JazzHR's standard Race/Ethnicity list answered for each synthetic person: [who, profile, the option]. */
const RACES: Array<[string, Profile, string]> = [
  ['white, not Hispanic', withEeo(['white'], false, 'male'), 'White, not Hispanic or Latino'],
  ['Asian, not Hispanic', withEeo(['asian'], false, 'female'), 'Asian, not Hispanic or Latino'],
  ['two races, not Hispanic', withEeo(['asian', 'white'], false, 'male'), 'Two or More Races, not Hispanic or Latino'],
  ['MENA, not Hispanic', withEeo(['middle-eastern-north-african'], false, 'male'),
    'MENA (Middle Eastern and North African)'],
  ['Hispanic', withEeo(['white'], true, 'female'), 'Hispanic or Latino'],
];

describe('jr6 P2 JZ-6 (RULES item 21): JazzHR’s Race/Ethnicity list takes the person’s own answer', () => {
  it.each([['invaluable-form', invaluableHtml], ['nucleussecurity-form', nucleusHtml]] as const)(
    '%s: white, Asian, two races and MENA (each not Hispanic) their own option, Hispanic “Hispanic or Latino”, the '
    + 'gender its own', async (_name, html) => {
      const page = await captured(html);
      for (const [who, profile, option] of RACES) {
        expect(page.plan(RACE, profile), who).toMatchObject({ label: 'Race/Ethnicity', read: ['eeo.race', 'label.race'],
          answer: option, origin: { provenance: 'profile', path: 'eeo.race' } });
        expect(page.plan(RACE, profile).answer, who).not.toBe('Decline to answer');
      }
      expect(page.plan(GENDER, withEeo(['white'], false, 'male'))).toMatchObject({ read: ['eeo.gender', 'label.gender'],
        answer: 'Male' });
      expect(page.plan(GENDER, withEeo(['asian'], false, 'female')).answer).toBe('Female');
      // The golden profile declines both: the list's own first option, "Decline to answer", already shows.
      expect(page.plan(RACE).row).toMatchObject({ status: 'skipped', reason: 'already-correct' });
    });

  it('invaluable-form: an option the matcher cannot read makes a missing answer no-match, never a decline', async () => {
    const white = withEeo(['white'], false, 'male');
    const select = (doc: Document) => doc.querySelector<HTMLSelectElement>(RACE)!;
    const dropWhite = (doc: Document) => Array.from(select(doc).options).find((option) => option.text.startsWith('White'))!
      .remove();
    const unread = await captured(invaluableHtml, (doc) => {
      dropWhite(doc);
      select(doc).add(new Option('Something we cannot read', 'unread'));
    });
    expect(unread.plan(RACE, white)).toMatchObject({ answer: undefined,
      row: { status: 'flagged', reason: 'no-match', needsUserAction: true } });
    removeFixtures(document);
    // The same list read whole, the person's answer not offered: declined (rule eeo.not-offered, as before).
    const whole = await captured(invaluableHtml, dropWhite);
    expect(whole.plan(RACE, white)).toMatchObject({ answer: 'Decline to answer',
      origin: { provenance: 'rule', ruleId: 'eeo.not-offered' } });
  });
});

describe('jr6 P2 JZ-7 (RULES item 29): JazzHR’s citizenship / employment eligibility select', () => {
  it.each([['nucleussecurity-form', nucleusHtml], ['panoptimization-form', panoptHtml]] as const)(
    '%s: a U.S. citizen gets “I am a U.S. Citizen/Permanent Resident”, asked either way; the golden profile, which '
    + 'states no status, the `all` scope', async (_name, html) => {
      const page = await captured(html);
      // The label contract (RULES' handoff edit 12): the select keeps its options' own words, the countries read there.
      const options = page.fieldOf(CITIZEN).options;
      expect(Array.isArray(options) ? options.map((option) => option.label) : options).toEqual(expect.arrayContaining([
        'I am a U.S. Citizen/Permanent Resident', 'I am a Canadian Citizen/Permanent Resident']));
      const citizen = { label: 'What\'s your citizenship / employment eligibility?', kind: 'select',
        read: ['workAuth.status', 'label.citizenship'], answer: 'I am a U.S. Citizen/Permanent Resident',
        origin: { provenance: 'profile', path: 'workAuthorization[0].status', transform: 'legal.work-status' },
        row: { reason: 'ok', needsUserAction: false } };
      expect(page.plan(CITIZEN, withStatus('citizen'))).toMatchObject(citizen);
      expect(page.plan(CITIZEN, withStatus('permanent-resident')).answer).toBe('I am a U.S. Citizen/Permanent Resident');
      // No status in the golden profile: asked of the AI in the `all` scope, never "the country is unknown".
      expect(page.plan(CITIZEN)).toMatchObject({ answer: undefined,
        row: { status: 'flagged', reason: 'legal-not-in-profile' }, scopes: ['all'] });
      removeFixtures(document);
      const relabelled = await captured(html, relabel('resumator-citizen-value',
        'What is your U.S. citizenship / employment eligibility?'));
      expect(relabelled.plan(CITIZEN, withStatus('citizen'))).toMatchObject({ ...citizen,
        label: 'What is your U.S. citizenship / employment eligibility?' });
    });
});

describe('jr6 P2 JZ-8 (RULES item 30): a citizen or permanent resident asked yes or no', () => {
  it('wellhive-submitting: the Yes/No boxes “Are you a US Citizen or Permanent Resident? (Note - EAD …)”: Yes for a '
    + 'citizen (its Yes ticked, read back), No for a work visa, the person’s with no status', async () => {
    const page = await captured(wellhiveHtml);
    const citizen = page.plan(CITIZEN_BOX, withStatus('citizen'));
    expect(citizen).toMatchObject({
      label: 'Are you a US Citizen or Permanent Resident? (Note - EAD does not qualify for this position)',
      kind: 'checkbox-group', read: ['workAuth.status', 'label.citizenship'], answer: ['Yes'],
      origin: { provenance: 'profile', path: 'workAuthorization[0].status', transform: 'legal.work-status' },
      row: { reason: 'ok', needsUserAction: false } });
    expect(page.plan(CITIZEN_BOX, withStatus('permanent-resident')).answer).toEqual(['Yes']);
    expect(page.plan(CITIZEN_BOX, withStatus('work-visa')).answer).toEqual(['No']);
    expect(page.plan(CITIZEN_BOX)).toMatchObject({ answer: undefined,
      row: { status: 'flagged', reason: 'legal-not-in-profile', needsUserAction: true } });
    // Written as the radio it asks: its Yes ticked, its No left, both read back.
    const target = page.scanned.target(citizen.field.key)!;
    expect(fill(target, citizen.write!.value, { adapter: jazzhrAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
    expect(target.members.map((box) => box.checked)).toEqual([true, false]);
    expect(verifyAfterSettle(page.scanned.rescan(), citizen.field.key, citizen.write!.value))
      .toEqual({ verification: 'verified', reason: 'ok' });
  });

  it.each(['Are you a US Citizen or Permanent Resident?', 'Are you a U.S. citizen?'])(
    'invaluable-form: its Yes/No select asked “%s”: Yes for a citizen, No for a work visa', async (label) => {
      const page = await captured(invaluableHtml, relabel(INSIDE_ID, label));
      expect(page.plan(`#${INSIDE_ID}`, withStatus('citizen'))).toMatchObject({ label, kind: 'select',
        read: ['workAuth.status', 'label.citizenship'], answer: 'Yes',
        origin: { provenance: 'profile', transform: 'legal.work-status' } });
      expect(page.plan(`#${INSIDE_ID}`, withStatus('work-visa')).answer).toBe('No');
    });
});

describe('jr6 P2 JZ-9 (RULES item 47): the state a person works from or lives in', () => {
  it('wellhive-submitting: “From which state will you be working?” is the profile’s state, Texas, flagged, and '
    + 'written; asked “What state do you live in?”, Texas unflagged', async () => {
    const page = await captured(wellhiveHtml);
    const work = page.plan(`#${STATE_ID}`);
    expect(work).toMatchObject({ label: 'From which state will you be working?', kind: 'select',
      read: ['address.region', 'label.work-state'], answer: 'Texas',
      origin: { provenance: 'profile', path: 'address.region' },
      row: { status: 'flagged', reason: 'filled-low-confidence', needsUserAction: false }, scopes: [] });
    const target = page.scanned.target(work.field.key)!;
    expect(fill(target, work.write!.value, { adapter: jazzhrAdapter, root: page.root })).toMatchObject({ wrote: true });
    expect((target.control as HTMLSelectElement).selectedOptions[0]?.text).toBe('Texas');
    expect(verifyAfterSettle(page.scanned.rescan(), work.field.key, work.write!.value))
      .toEqual({ verification: 'verified', reason: 'ok' });
    removeFixtures(document);
    const lives = await captured(wellhiveHtml, relabel(STATE_ID, 'What state do you live in?'));
    expect(lives.plan(`#${STATE_ID}`)).toMatchObject({ read: ['address.region', 'label.residence-state'],
      answer: 'Texas', row: { reason: 'ok', needsUserAction: false } });
  });
});

describe('jr6 P2 JZ-11 (RULES item 54): living or working inside the United States', () => {
  it('invaluable-form: “Will you be working from inside the United States?” Yes from the address’s country, flagged; '
    + 'asked “Do you currently reside in the United States?” too', async () => {
    const inside = { kind: 'select', read: ['location.inCountry', 'label.in-country'], answer: 'Yes',
      origin: { provenance: 'rule', ruleId: 'location.in-country', path: 'address.country' },
      row: { status: 'flagged', reason: 'filled-low-confidence', needsUserAction: false }, scopes: [] };
    const page = await captured(invaluableHtml);
    expect(page.plan(`#${INSIDE_ID}`)).toMatchObject({ ...inside,
      label: 'Will you be working from inside the United States?' });
    removeFixtures(document);
    const resides = await captured(invaluableHtml, relabel(INSIDE_ID, 'Do you currently reside in the United States?'));
    expect(resides.plan(`#${INSIDE_ID}`)).toMatchObject({ ...inside,
      label: 'Do you currently reside in the United States?' });
  });

  it('wellhive-submitting: the Yes/No boxes “Are you able to work remotely from a state within the United States?” '
    + 'Yes, flagged, its Yes ticked and read back', async () => {
    const page = await captured(wellhiveHtml);
    const remote = page.plan(REMOTE_BOX);
    expect(remote).toMatchObject({ label: 'Are you able to work remotely from a state within the United States?',
      kind: 'checkbox-group', read: ['location.inCountry', 'label.in-country'], answer: ['Yes'],
      origin: { provenance: 'rule', ruleId: 'location.in-country', path: 'address.country' },
      row: { status: 'flagged', reason: 'filled-low-confidence', needsUserAction: false }, scopes: [] });
    const target = page.scanned.target(remote.field.key)!;
    expect(fill(target, remote.write!.value, { adapter: jazzhrAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified' });
    expect(target.members.map((box) => box.checked)).toEqual([true, false]);
  });
});

describe('jr6 P2 jazzhr-new-1 (RULES item 59): the references box is the person’s', () => {
  it('panoptimization-form: “References: Please enter names and contact information” is flagged, never drafted; the '
    + 'same box asking about the person alone is drafted', async () => {
    const page = await captured(panoptHtml);
    expect(page.plan(REFERENCES)).toMatchObject({ label: 'References: Please enter names and contact information',
      kind: 'textarea', answer: undefined, drafted: false, scopes: [],
      row: { status: 'flagged', reason: 'free-text-requires-user', needsUserAction: true } });
    removeFixtures(document);
    // The drafting is on under DEFAULT_SETTINGS: a question of the person's own on the same box gets a draft.
    const own = await captured(panoptHtml, relabel('resumator-references-value',
      'Tell us about a project you are proud of:'));
    expect(own.plan(REFERENCES).drafted).toBe(true);
  });
});
