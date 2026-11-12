/*
 * The iCIMS adapter on the owner's snapshot6 of 2026-11-10 (F:\Develop\Refer\snapshot6\icims1..3: careers-sentinel,
 * careers-ars and uscareers-nyu, converted as fixtures/icims/jr6-*.html; the Gmail capture of icims3 never opened), the
 * jr6 build's ICIMS package (FIXPLAN §6.5):
 * - P1: from the auditor's harness (SP\jr6\audit\icims.md section 3), what the adapter reads on every page and frame,
 *   held as asserts, and each hook the package added, tested on the snapshots and on DOM variants of them;
 * - P2 (after jr6-engine-e3 and jr6-rules-r4 merged, the section "P2" at the end): the shared outcomes. Whole runs drive
 *   iCIMS's dropdowns on the snapshots with the page's dropdown script stood in for (standIn), and the real planner decides
 *   each question RULES reads, with the golden synthetic profile or variants built in the test; each page's scan is its
 *   expectation (fixtures/icims/jr6-*.expect.json). Two outcomes RULES' code does not give yet are held as expected
 *   failures (it.fails), each naming the regression reported in the ICIMS handoff.
 * Lists a fixture redacts (iCIMS's dropdowns) are given SYNTHETIC public words (countries, states, schools) where a test
 * needs them. Nothing here prints or reads a snapshot's value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { pressEntry } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { planFrame } from '../../core/plan/frame';
import { CAUTIOUS_SETTINGS } from '../../core/plan/settings.testkit';
import type { PlanInput } from '../../core/plan/types';
import { classifyField } from '../../core/resolver/resolve';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types/settings';
import { accountLeft } from '../../dom/account-section';
import { assertNotSubmit, submitPressAllowed } from '../../dom/fillers/not-submit';
import { loadFixture, logEvents, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { newScanCache } from '../../dom/scan-cache';
import { signInFormOf } from '../../dom/sign-in-form';
import type { ScanResult, WidgetReading } from '../../dom/types';
import { fillWidget, readWidget, searchTypeahead, shownOptions, widgetListOf } from '../../dom/widgets';
import { chainPageOf } from '../chain';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { compareWithExpectation, fillabilityOf, readExpectation, scanCase, SNAPSHOT_VIEWPORT }
  from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter, ChainStepFacts } from '../types';
import { ICIMS_SNAPSHOTS, icimsAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/jr6-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/icims/jr6-*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
const ROUTES = import.meta.glob('../../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const OLD = import.meta.glob(['../../../fixtures/icims/githubinc-profile.frame-1.html',
  '../../../fixtures/icims/ars-gate-phone.html', '../../../fixtures/icims/edgewater-self-id-veteran.frame-2.html',
  '../../../fixtures/icims/nyu-self-id-disability.frame-2.html', '../../../fixtures/icims/nyu-profile.frame-1.html',
  '../../../fixtures/icims/aaalife-eeo-final.html', '../../../fixtures/icims/githubinc-candidate-questions.frame-1.html',
  '../../../fixtures/icims/githubinc-job-questions-error.frame-1.html'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The snapshot6 cases (src/adapters/icims ICIMS_SNAPSHOTS' jr6 part). */
const JR6_CASES = ['jr6-sentinel-basic-info', 'jr6-sentinel-basic-info-filled', 'jr6-sentinel-profile',
  'jr6-sentinel-profile-filled', 'jr6-sentinel-job-questions', 'jr6-sentinel-iform-selfid', 'jr6-ars-profile',
  'jr6-ars-profile-address', 'jr6-ars-profile-filled', 'jr6-ars-eeo', 'jr6-nyu-profile-parsed', 'jr6-nyu-profile-filled',
  'jr6-nyu-iform-signature', 'jr6-nyu-iform-offer'] as const;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case: its markup and its address (its route map's). */
function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? byFile(OLD, `${name}.html`) ?? '', address };
}

/** Loads a page at its own address (a srcdoc page's base is about:srcdoc: its links resolve there). */
async function load(name: string) {
  const { html, address } = fileOf(name);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture;
}

function rootOf(doc: Document): Element {
  const found = icimsAdapter.detect(doc);
  if (found === null) throw new Error('no root');
  return found.formRoot;
}

const byId = (doc: Document, id: string) => doc.getElementById(id);

afterEach(() => removeFixtures(document));

// ---------------------------------------------------------------------------------------------------------------------
// The cases: the snapshot list, the hooks' expectations, the pages each adapter reads (the auditor's harness)
// ---------------------------------------------------------------------------------------------------------------------

/** Every page or frame with a root, and every IForm portal frame: a hooks expectation each. */
const EXPECTED = Object.keys(EXPECTS).map((path) => path.split('/').pop()!.replace(/\.expect\.json$/, '')).sort();

describe('the snapshot6 cases', () => {
  it('are the adapter’s jr6 snapshots, each page and frame with a root (and each IForm portal) holding its hooks', () => {
    expect([...ICIMS_SNAPSHOTS].filter((path) => path.includes('/jr6-')).sort())
      .toEqual(JR6_CASES.map((name) => `fixtures/icims/${name}.html`).sort());
    expect(EXPECTED).toEqual(['jr6-ars-eeo', 'jr6-ars-profile', 'jr6-ars-profile-address', 'jr6-ars-profile-filled',
      'jr6-nyu-iform-offer.frame-1', 'jr6-nyu-iform-offer.frame-2', 'jr6-nyu-iform-signature.frame-1',
      'jr6-nyu-iform-signature.frame-2', 'jr6-nyu-profile-filled.frame-1', 'jr6-nyu-profile-parsed.frame-1',
      'jr6-sentinel-basic-info-filled.frame-1', 'jr6-sentinel-basic-info.frame-1', 'jr6-sentinel-iform-selfid.frame-1',
      'jr6-sentinel-iform-selfid.frame-2', 'jr6-sentinel-job-questions.frame-1', 'jr6-sentinel-profile-filled.frame-1',
      'jr6-sentinel-profile.frame-1']);
    // P2: each page or frame with a root holds its fields too; the IForms' portal frames (no root) their hooks alone.
    for (const name of EXPECTED) {
      expect(fileOf(name).html.length > 0 && fileOf(name).address !== '', name).toBe(true);
      const portal = /iform-.*\.frame-1$/.test(name);
      expect((byFile(EXPECTS, `${name}.expect.json`) as { note?: string }).note, name)
        .toMatch(portal ? /^Hooks only \(jr6 P1\): / : /^jr6 P2: /);
    }
  });

  it.each(EXPECTED)('%s: every hook answers what the page shows', async (name) => {
    const fixture = await load(name);
    expect(compareHooks(fixture.doc, icimsAdapter, readHooks(byFile(EXPECTS, `${name}.expect.json`)))).toEqual([]);
  });

  it('picks the iCIMS adapter first on every address, and chains each IForm’s own frame by its portal’s company', () => {
    const names = Object.keys(PAGES).map((path) => path.split('/').pop()!.replace(/\.html$/, ''))
      .filter((name) => !name.endsWith('.third-party-frame') && !name.startsWith('jr6-apply-'));
    expect(names.length).toBe(27);
    for (const name of names) {
      const url = new URL(fileOf(name).address);
      expect(adaptersFor(url).map((adapter) => adapter.id), name).toEqual(['icims', 'generic']);
      const leaf = /iform-.*\.frame-2$/.test(name);
      const company = name.includes('sentinel') ? 'sentinel' : 'nyu';
      expect(chainPageOf(url), name).toEqual(leaf ? { platform: 'icims', role: 'frame', family: `icims:${company}` } : null);
    }
  });

  it('reads each company wrapper as no root, its application frame the frame that draws the step', async () => {
    const wrappers = JR6_CASES.filter((name) => fileOf(`${name}.frame-1`).html !== '');
    expect(wrappers.length).toBe(10);
    for (const name of wrappers) {
      const fixture = await load(name);
      expect(icimsAdapter.detect(fixture.doc), name).toBeNull();
      expect(genericAdapter.detect(fixture.doc), name).toBeNull();
      expect(icimsAdapter.applicationFrame!(fixture.doc), name).toBe(fixture.doc.querySelector('iframe#icims_content_iframe'));
      removeFixtures(document);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// FX-R1 (the jr6 fixers' review, platforms-a): careers-sentinel's posting title holds a string the owner's redaction
// list gained after its six cases were converted. They were converted again with the current converter (jr6-tooling's
// round 2) and list, the posting's own title, which nothing reads, given synthetic text (--replace-text "head >
// title=…" and "h1.iCIMS_Header=…", the files in fixtures/synthetic/jr6-icims/): a REDACTED inside a posting's title
// would tell the listed value by elimination (the converter refuses that in a posting's description, not in its title).
// ---------------------------------------------------------------------------------------------------------------------

const SYNTHETIC = import.meta.glob('../../../fixtures/synthetic/jr6-icims/*.txt',
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A page's or frame's own document, parsed (nothing loaded), and its fixture header. */
function parsedOf(name: string): { doc: Document; header: { replacedText?: readonly number[] } } {
  const { html } = fileOf(name);
  const header = JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)?.[1] ?? '{}') as
    { replacedText?: readonly number[] };
  return { doc: new DOMParser().parseFromString(html, 'text/html'), header };
}

describe('careers-sentinel’s posting title (FX-R1)', () => {
  /** Each case, and the synthetic page title of its step (the step's own words, then the synthetic posting title). */
  const STEP_TITLES = [['jr6-sentinel-basic-info', 'title-basic-information'],
    ['jr6-sentinel-basic-info-filled', 'title-basic-information'], ['jr6-sentinel-profile', 'title-candidate-profile'],
    ['jr6-sentinel-profile-filled', 'title-candidate-profile'],
    ['jr6-sentinel-job-questions', 'title-job-specific-questions'], ['jr6-sentinel-iform-selfid', 'title-iform']] as const;

  it.each(STEP_TITLES)('%s: the page’s and its frame’s title and the frame’s posting heading are synthetic text',
    (name, titleFile) => {
      const title = byFile(SYNTHETIC, `${titleFile}.txt`)!.trim();
      const heading = byFile(SYNTHETIC, 'posting-title.txt')!.trim();
      expect(title).toBe(`${title.split(' - ')[0]} - ${heading}`);
      const wrapper = parsedOf(name);
      const frame = parsedOf(`${name}.frame-1`);
      expect(wrapper.doc.title).toBe(title);
      expect(frame.doc.title).toBe(title);
      expect([...frame.doc.querySelectorAll('h1.iCIMS_Header')].map((h1) => h1.textContent!.trim())).toEqual([heading]);
      // The converter's own record, by position (head > title, then h1.iCIMS_Header): the wrapper has no posting heading.
      expect(wrapper.header.replacedText).toEqual([1, 0]);
      expect(frame.header.replacedText).toEqual([1, 1]);
    });

  // TOOLING's shared Apply postings (BUILD.md D-b, `jr6-apply-*`) are read in full too: TOOLING's G.2 (`78f6d8f`) gave
  // careers-sentinel's page and frame titles (and the frame's title and description metas) synthetic text, and ARS's
  // title never held REDACTED, so the heading-only exception of `fd236c3` went at the forms merge (jr6 round 2).
  it('no jr6 page or frame, TOOLING’s postings too, shows REDACTED in its title or its posting heading', () => {
    const names = Object.keys(PAGES).map((path) => path.split('/').pop()!.replace(/\.html$/, ''))
      .filter((name) => !name.endsWith('.third-party-frame'));
    expect(names.length).toBe(30);
    expect(names.filter((name) => name.startsWith('jr6-apply-')).length).toBe(3);
    for (const name of names) {
      const { doc } = parsedOf(name);
      const shown = [doc.title, ...[...doc.querySelectorAll('h1.iCIMS_Header')].map((h1) => h1.textContent ?? '')];
      expect(shown.filter((text) => text.includes('REDACTED')), name).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The posting's Apply (BUILD.md section 4: ICIMS keeps it unchanged)
// ---------------------------------------------------------------------------------------------------------------------

describe('the posting’s Apply (TOOLING’s shared jr6-apply fixtures)', () => {
  it.each(['jr6-apply-ars-posting', 'jr6-apply-sentinel-posting.frame-1'])(
    '%s: offers the visible "Apply for this job online", and the agent’s entry presses it once', async (name) => {
      const fixture = await load(name);
      const entry = icimsAdapter.entryControl!(fixture.doc);
      expect(entry).not.toBeNull();
      expect(entry!.matches('a.iCIMS_ApplyOnlineButton[title="Apply for this job online"]')).toBe(true);
      const target = new URL(entry!.getAttribute('href')!, fixture.doc.baseURI);
      expect(target.searchParams.get('mode')).toBe('apply');
      expect(icimsAdapter.postingText!(fixture.doc)).not.toBeNull();
      expect(icimsAdapter.detect(fixture.doc)).toBeNull();
      expect(icimsAdapter.authState!(fixture.doc)).toBeNull();
      // Apply is one of the never-pressed controls: the entry door presses that element alone.
      expect(icimsAdapter.entryNeverPressed).toBe(true);
      expect(icimsAdapter.neverPress!(fixture.doc.documentElement)).toContain(entry);
      const pressed: Element[] = [];
      fixture.doc.addEventListener('click', (event) => {
        pressed.push(event.target as Element);
        event.preventDefault();
      });
      expect(await pressEntry(fixture.doc, [icimsAdapter], new AbortController().signal, 300, 300))
        .toEqual({ outcome: 'pressed' });
      expect(pressed).toEqual([entry]);
    });

  it('offers no Apply on the sentinel wrapper (its frame draws the posting)', async () => {
    const fixture = await load('jr6-apply-sentinel-posting');
    expect(icimsAdapter.entryControl!(fixture.doc)).toBeNull();
    expect(icimsAdapter.applicationFrame!(fixture.doc)).toBe(fixture.doc.querySelector('iframe#icims_content_iframe'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-05: the steps, careers-sentinel's Basic Information step and the Assessments step
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-05: the step bar with Basic Information, and an Assessments step', () => {
  const TABLE = [
    { name: 'jr6-sentinel-basic-info.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-sentinel-basic-info-filled.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-sentinel-profile.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-sentinel-profile-filled.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-sentinel-job-questions.frame-1', final: 'not-final', next: 'input#quesp_form_submit_i', submit: null },
    { name: 'jr6-ars-profile', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-ars-profile-filled', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'jr6-ars-eeo', final: 'final', next: null, submit: 'input#eeop_form_submit_i' },
    { name: 'jr6-nyu-profile-parsed.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    // An IForm's own frame holds no bar: its portal's facts decide (ICIMS-17, below).
    { name: 'jr6-sentinel-iform-selfid.frame-2', final: 'unknown', next: null, submit: null },
  ] as const;

  it.each(TABLE)('$name: $final, its Submit the step’s Next or the application’s Submit', async (row) => {
    const fixture = await load(row.name);
    const root = rootOf(fixture.doc);
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe(row.final);
    const pick = (selector: string | null) => (selector === null ? null : fixture.doc.querySelector(selector));
    expect(icimsAdapter.nextButton!(root)).toBe(pick(row.next));
    expect(icimsAdapter.submitButton!(root)).toBe(pick(row.submit));
  });

  it('lets the step machine press sentinel’s "Submit Profile" as Next, and nothing else', async () => {
    const fixture = await load('jr6-sentinel-profile.frame-1');
    const root = rootOf(fixture.doc);
    const next = icimsAdapter.nextButton!(root)!;
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root, allowNext: true })).toEqual({ ok: true });
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root })).toEqual({ ok: false, refusal: 'submit-word' });
    expect(submitPressAllowed(next, icimsAdapter, root)).toBe(false);
    // Without Basic Information among the steps it knows, the bar says nothing (the audit's reading before the fix).
    const first = fixture.doc.querySelector('li#Step_basicProfileStep')!;
    first.id = 'Step_unknownStep';
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(icimsAdapter.nextButton!(root)).toBeNull();
  });

  /** Rebuilds sentinel's profile bar with these step ids, the current one marked, each item's count fitting. */
  function rebar(doc: Document, ids: readonly string[], current: string): void {
    const list = doc.querySelector('.iCIMS_Steps ul')!;
    const model = list.querySelector('li')!;
    list.replaceChildren(...ids.map((id, at) => {
      const item = model.cloneNode(true) as HTMLElement;
      item.id = id;
      item.className = id === current ? ' iCIMS_Steps_Current' : ' iCIMS_Steps_NotCurrent';
      item.querySelector('.iCIMS_Steps_Content')!.textContent = ` Step \u00a0 ${at + 1} \u00a0 of \u00a0 ${ids.length}. \u00a0 x`;
      return item;
    }));
  }

  it('reads a step followed by Assessments steps alone as final, one followed by another step as not, Assessments itself as unknown', async () => {
    const fixture = await load('jr6-sentinel-profile.frame-1');
    const root = rootOf(fixture.doc);
    const button = fixture.doc.querySelector('input#cp_form_submit_i');
    rebar(fixture.doc, ['Step_basicProfileStep', 'Step_profileStep', 'Step_assessmentsStep'], 'Step_profileStep');
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('final');
    expect(icimsAdapter.submitButton!(root)).toBe(button);
    expect(icimsAdapter.nextButton!(root)).toBeNull();
    expect(icimsAdapter.stepSubmitNext!.laterStep(fixture.doc)).toBeNull();
    rebar(fixture.doc, ['Step_profileStep', 'Step_assessmentsStep', 'Step_jobQuestionsStep'], 'Step_profileStep');
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('not-final');
    expect(icimsAdapter.nextButton!(root)).toBe(button);
    expect(icimsAdapter.stepSubmitNext!.laterStep(fixture.doc)).toBe(fixture.doc.querySelector('li#Step_assessmentsStep'));
    rebar(fixture.doc, ['Step_profileStep', 'Step_assessmentsStep', 'Step_jobQuestionsStep'], 'Step_assessmentsStep');
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(icimsAdapter.nextButton!(root)).toBeNull();
    expect(icimsAdapter.submitButton!(root)).toBeNull();
  });

  it('tells sentinel’s steps apart', async () => {
    const signatures = new Set<string>();
    for (const name of ['jr6-sentinel-basic-info.frame-1', 'jr6-sentinel-profile.frame-1',
      'jr6-sentinel-job-questions.frame-1', 'jr6-sentinel-iform-selfid.frame-2']) {
      const fixture = await load(name);
      signatures.add(hashSignature(icimsAdapter.stepSignature!(fixture.doc)));
      removeFixtures(document);
    }
    expect(signatures.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-17: an IForm's steps, judged by its portal frame's facts
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-17: the portal’s step facts (chainStepFacts) and the IForm leaf’s Submit', () => {
  const PORTALS = [
    // uscareers-nyu's Portal Specific Forms ( 4/4 ), step 4 of 5.
    { name: 'jr6-nyu-iform-signature', facts: { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false,
      packet: { n: 4, m: 4 }, counters: 1 }, leaf: 'not-final' },
    // uscareers-nyu's Job Specific Forms, the last step.
    { name: 'jr6-nyu-iform-offer', facts: { stepId: 'Step_perJobSubmittalFormsStep', lastStep: true, packet: null,
      counters: 0 }, leaf: 'final' },
    // careers-sentinel's Portal Specific Forms, the last step.
    { name: 'jr6-sentinel-iform-selfid', facts: { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true,
      packet: null, counters: 0 }, leaf: 'final' },
  ] as const;

  it.each(PORTALS)('$name: the portal frame says what its bar says, and only it', async ({ name, facts }) => {
    const portal = await load(`${name}.frame-1`);
    expect(icimsAdapter.chainStepFacts!(portal.doc)).toEqual(facts);
    expect(icimsAdapter.isFinalStep!(portal.doc)).toBe('unknown');
    removeFixtures(document);
    for (const other of [`${name}.frame-2`, name, 'jr6-sentinel-profile.frame-1', 'jr6-ars-eeo']) {
      const page = await load(other);
      expect(icimsAdapter.chainStepFacts!(page.doc), other).toBeNull();
      removeFixtures(document);
    }
  });

  it.each(PORTALS)('$name: the leaf’s Submit is Next or the final Submit by the facts, unknown without them',
    async ({ name, facts, leaf }) => {
      const fixture = await load(`${name}.frame-2`);
      const root = rootOf(fixture.doc);
      const button = Array.from(fixture.doc.querySelectorAll<HTMLElement>('input[name="icims_submit"]'))[0]!;
      expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
      expect(icimsAdapter.isFinalStep!(fixture.doc, null)).toBe('unknown');
      expect(icimsAdapter.nextButton!(root)).toBeNull();
      expect(icimsAdapter.stepSubmitNext!.laterStep(fixture.doc)).toBeNull();
      expect(icimsAdapter.isFinalStep!(fixture.doc, facts)).toBe(leaf);
      expect(icimsAdapter.nextButton!(root, facts)).toBe(leaf === 'not-final' ? button : null);
      expect(icimsAdapter.stepSubmitNext!.laterStep(fixture.doc, facts)).toBe(leaf === 'not-final' ? root : null);
      expect(icimsAdapter.stepSubmitNext!.buttons.some((selector) => button.matches(selector))).toBe(true);
      // The final Submit by the facts (the contract's submitButton takes them since ENGINE E2, ICIMS edit 4; the caller
      // that passes them, dom/fillers/not-submit.ts, is SHELL's at integration).
      expect(icimsAdapter.submitButton!(root)).toBeNull();
      expect(icimsAdapter.submitButton!(root, facts)).toBe(leaf === 'final' ? button : null);
      // Without the facts (dom/fillers/not-submit.ts passes none), the leaf's Submit is never pressed as Next.
      expect(assertNotSubmit(button, { adapter: icimsAdapter, root, allowNext: true }).ok).toBe(false);
    });

  it('reads the counter rule: an earlier form of the packet is not final, two counters or a counter out of its packet unknown', async () => {
    const fixture = await load('jr6-nyu-iform-offer.frame-2');
    const root = rootOf(fixture.doc);
    const last: ChainStepFacts = { stepId: 'Step_perJobSubmittalFormsStep', lastStep: true, packet: null, counters: 0 };
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, packet: { n: 2, m: 4 }, counters: 1 })).toBe('not-final');
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, packet: { n: 4, m: 4 }, counters: 1 })).toBe('final');
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, packet: { n: 1, m: 2 }, counters: 2 })).toBe('unknown');
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, packet: { n: 5, m: 4 }, counters: 1 })).toBe('unknown');
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, packet: { n: 0, m: 4 }, counters: 1 })).toBe('unknown');
    expect(icimsAdapter.isFinalStep!(fixture.doc, { ...last, lastStep: false })).toBe('not-final');
    expect(icimsAdapter.nextButton!(root, { ...last, counters: 2 })).toBeNull();
    // A page that draws its own bar is judged by it, whatever facts are passed.
    removeFixtures(document);
    const profile = await load('jr6-ars-eeo');
    expect(icimsAdapter.isFinalStep!(profile.doc, { ...last, lastStep: false })).toBe('final');
  });

  it('reads two counters on the portal as no packet', async () => {
    const portal = await load('jr6-nyu-iform-signature.frame-1');
    const heading = portal.doc.querySelector('.iCIMS_PageStepText')!;
    heading.append(' ( 1/2 )');
    expect(icimsAdapter.chainStepFacts!(portal.doc)).toMatchObject({ counters: 2, packet: null });
    // A later step hidden: no facts at all.
    heading.remove();
    (portal.doc.querySelector('li#Step_perJobSubmittalFormsStep') as HTMLElement).style.display = 'none';
    expect(icimsAdapter.chainStepFacts!(portal.doc)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-04 and ICIMS-07: the create-login (its rows, its rules), and the résumé's part on Basic Information
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-04: Basic Information’s create-login as rows (accountRows)', () => {
  it.each(['jr6-sentinel-basic-info.frame-1', 'jr6-sentinel-basic-info-filled.frame-1'])(
    '%s: the Login, Password and Re-enter rows, no single group; the form the person presses', async (name) => {
      const fixture = await load(name);
      const root = rootOf(fixture.doc);
      const rows = ['PersonProfileFields.Login', 'PersonProfileFields.Password', 'PersonProfileFields.Password_Confirm']
        .map((id) => byId(fixture.doc, id)!.closest('.iCIMS_TableRow'));
      expect(icimsAdapter.accountSection!(root)).toBeNull();
      expect(icimsAdapter.accountRows!(root)).toEqual(rows);
      // The rows are no field of the profile; the names and the email stay its fields.
      const excluded = icimsAdapter.excluded!(root);
      for (const row of rows) expect(excluded).toContain(row);
      expect(excluded.some((part) => part.contains(byId(fixture.doc, 'PersonProfileFields.FirstName')))).toBe(false);
      const form = signInFormOf(icimsAdapter, fixture.doc, 'create-account')!;
      expect(form.personPresses).toBe(true);
      expect(form.button).toBe(fixture.doc.querySelector('input#cp_form_submit_i'));
      // A row holding another box is no account row.
      rows[0]!.append(fixture.doc.createElement('input'));
      expect(icimsAdapter.accountRows!(root)).toBeNull();
    });

  it('keeps the single "Create a login" group where one holds the three boxes alone (githubinc, uscareers-nyu, careers-ars)', async () => {
    for (const name of ['githubinc-profile.frame-1', 'jr6-nyu-profile-parsed.frame-1', 'jr6-ars-profile']) {
      const fixture = await load(name);
      const root = rootOf(fixture.doc);
      const group = icimsAdapter.accountSection!(root);
      expect(group, name).not.toBeNull();
      expect(icimsAdapter.accountRows!(root), name).toBeNull();
      // jr6 P2: that group holding anything else is no section, nor rows (no Basic Information pane): the page pauses as
      // an account's creation, as before (icims-core.browser.test.ts, jr6-password's, holds the pause).
      group!.append(fixture.doc.createElement('input'));
      expect(icimsAdapter.accountSection!(root), name).toBeNull();
      expect(icimsAdapter.accountRows!(root), name).toBeNull();
      removeFixtures(document);
    }
  });

  it('reads the rows only inside Basic Information’s pane', async () => {
    const fixture = await load('jr6-sentinel-basic-info.frame-1');
    const root = rootOf(fixture.doc);
    expect(icimsAdapter.accountRows!(root)).toHaveLength(3);
    fixture.doc.querySelector('.iCIMS_BasicProfilePane')!.classList.remove('iCIMS_BasicProfilePane');
    expect(icimsAdapter.accountRows!(root)).toBeNull();
  });

  it('waits for the résumé’s parse on Basic Information too (its résumé part is no table row)', async () => {
    const fixture = await load('jr6-sentinel-basic-info.frame-1');
    const input = byId(fixture.doc, 'PortalProfileFields.Resume_File') as HTMLInputElement;
    expect(icimsAdapter.uploadWidgets!(rootOf(fixture.doc))).toEqual([{ control: input.parentElement, input }]);
    expect(icimsAdapter.quirks?.resumeParse).toBe(true);
    expect(icimsAdapter.isBusy!(fixture.doc)).toBe(false);
    expect(icimsAdapter.uploadState!(input, 'resume.pdf')).toBe('pending');
    byId(fixture.doc, 'PortalProfileFields.Resume_Loading')!.classList.remove('iCIMS_NoDisplay');
    expect(icimsAdapter.isBusy!(fixture.doc)).toBe(true);
    removeFixtures(document);
    // After the parse's reload (from=profilebuild): the file on record, read as held, and the upload confirmed by name.
    const after = await load('jr6-sentinel-basic-info-filled.frame-1');
    const held = byId(after.doc, 'PortalProfileFields.Resume_File') as HTMLInputElement;
    expect(fileOf('jr6-sentinel-basic-info-filled.frame-1').address).toContain('from=profilebuild');
    expect(icimsAdapter.uploadHeld!(held)).toBe(true);
    byId(after.doc, 'PortalProfileFields.Resume_FileNameLabel')!.querySelector(':scope > span')!.textContent = 'resume.pdf';
    expect(icimsAdapter.uploadState!(held, 'resume.pdf')).toBe('confirmed');
    expect(icimsAdapter.uploadState!(held, 'other.pdf')).toBe('pending');
  });
});

describe('ICIMS-07: the create-login’s own password rules (passwordRules)', () => {
  const ALL = ['alpha', 'lower', 'upper', 'digit', 'special'];
  it.each([['jr6-sentinel-basic-info.frame-1', 8], ['jr6-ars-profile', 8], ['jr6-nyu-profile-parsed.frame-1', 10],
    ['githubinc-profile.frame-1', 8]] as const)('%s: at least %i characters, every class, not the login', async (name, min) => {
    const fixture = await load(name);
    const form = signInFormOf(icimsAdapter, fixture.doc, 'create-account')!;
    expect(icimsAdapter.passwordRules!(form)).toEqual({ minLength: min, requires: ALL, notLogin: true });
  });

  it('reads fail open: a rule whose words it does not read is left out, none at all is null', async () => {
    const fixture = await load('jr6-sentinel-basic-info.frame-1');
    const form = signInFormOf(icimsAdapter, fixture.doc, 'create-account')!;
    const item = (id: string) => byId(fixture.doc, `PersonProfileFields.Password.${id}`)!;
    item('Length').textContent = 'eight characters';
    item('Special').textContent = '1 symbol';
    item('Number').remove();
    expect(icimsAdapter.passwordRules!(form)).toEqual({ requires: ['alpha', 'lower', 'upper'], notLogin: true });
    item('PasswordLoginSame').textContent = 'Something else';
    for (const id of ['Alphabet', 'LowerCase', 'UpperCase']) item(id).remove();
    expect(icimsAdapter.passwordRules!(form)).toBeNull();
    byId(fixture.doc, 'PersonProfileFields.Password.MsgContainer')!.remove();
    expect(icimsAdapter.passwordRules!(form)).toBeNull();
    // The gate's form has no password: none.
    removeFixtures(document);
    const gate = await load('jr6-ars-profile');
    const other = { ...signInFormOf(icimsAdapter, gate.doc, 'create-account')!, password: null };
    expect(icimsAdapter.passwordRules!(other)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-01, -03, -08, -18: iCIMS's dropdowns (their declaration is held by dropdowns.browser.test.ts), labels
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-03 and -18: a dropdown’s label and required mark', () => {
  it('labels School, Degree and Major by their row’s label (their trigger’s aria-label alone names them)', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    for (const [id, words] of [['-1_CandProfileFields.School', 'School'], ['-1_CandProfileFields.Degree', 'Degree'],
      ['-1_CandProfileFields.Major', 'Major'], ['-1_PersonProfileFields.AddressCountry', 'Country']]) {
      const anchor = byId(fixture.doc, `${id}_icimsDropdown`)!;
      const label = icimsAdapter.labelFor!(anchor)!;
      expect(label, id).toBe(byId(fixture.doc, `label_${id}`));
      expect(label.textContent!.trim(), id).toBe(words);
    }
    const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    const school = scanned.fields.find((field) => scanned.target(field.key)?.control.id === '-1_CandProfileFields.School_icimsDropdown')!;
    expect([school.label, school.labelVisible, school.labelSource]).toEqual(['School', true, 'adapter']);
  });

  it('reads a dropdown required where its select says so', async () => {
    const fixture = await load('jr6-ars-profile');
    const country = byId(fixture.doc, '-1_PersonProfileFields.AddressCountry_icimsDropdown')!;
    expect(icimsAdapter.requiredFor!(country)).toBe(true);
    byId(fixture.doc, '-1_PersonProfileFields.AddressCountry')!.removeAttribute('i_required');
    expect(icimsAdapter.requiredFor!(country)).toBe(false);
    expect(icimsAdapter.requiredFor!(byId(fixture.doc, 'PersonProfileFields.FirstName')!)).toBe(false);
  });

  it('labels the gate’s Country Code by its search box’s label, and keeps its phone box’s autocomplete', async () => {
    const fixture = await load('ars-gate-phone');
    const anchor = fixture.doc.querySelector('a#dropdown')!;
    expect(icimsAdapter.labelFor!(anchor)).toBe(fixture.doc.querySelector('label[for="countryCode"]'));
    expect(byId(fixture.doc, 'phoneNumber')!.getAttribute('autocomplete')).toBe('tel-national');
    const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    expect(scanned.fields.map((field) => field.label)).toEqual(['Email', 'Phone Country Code', 'Number']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-02 and -19: the control whose write resets another (dependsOn)
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-02 and -19: dependsOn', () => {
  it('puts State under its own block’s Country, by its trigger or its select, never another block’s', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const anchor = (id: string) => byId(fixture.doc, `${id}_icimsDropdown`)!;
    expect(icimsAdapter.dependsOn!(anchor('-1_PersonProfileFields.AddressState')))
      .toBe(anchor('-1_PersonProfileFields.AddressCountry'));
    expect(icimsAdapter.dependsOn!(byId(fixture.doc, '-1_PersonProfileFields.AddressState')!))
      .toBe(anchor('-1_PersonProfileFields.AddressCountry'));
    expect(icimsAdapter.dependsOn!(anchor('-1_CandProfileFields.EducationState')))
      .toBe(anchor('-1_CandProfileFields.EducationCountry'));
    const states = Array.from(fixture.doc.querySelectorAll('a.dropdown-select[id$="PersonProfileFields.rcf3217_icimsDropdown"]'));
    expect(states.length).toBe(4);
    for (const state of states) {
      const block = state.id.slice(0, state.id.indexOf('_'));
      expect(icimsAdapter.dependsOn!(state)).toBe(anchor(`${block}_PersonProfileFields.rcf3218`));
    }
    // A Country depends on nothing; nor does a box.
    expect(icimsAdapter.dependsOn!(anchor('-1_PersonProfileFields.AddressCountry'))).toBeNull();
    expect(icimsAdapter.dependsOn!(byId(fixture.doc, 'PersonProfileFields.FirstName')!)).toBeNull();
    // A parent whose child link names another list is no parent.
    byId(fixture.doc, '-1_PersonProfileFields.AddressCountry')!.setAttribute('data-ddd-child-link', 'Other');
    expect(icimsAdapter.dependsOn!(anchor('-1_PersonProfileFields.AddressState'))).toBeNull();
  });

  it.each(['jr6-ars-profile', 'jr6-ars-profile-filled', 'jr6-nyu-profile-parsed.frame-1'])(
    '%s: "Please specify" under "How did you hear about us?"', async (name) => {
      const fixture = await load(name);
      expect(icimsAdapter.dependsOn!(byId(fixture.doc, 'rcf3049')!)).toBe(byId(fixture.doc, 'rcf3048'));
      expect(icimsAdapter.dependsOn!(byId(fixture.doc, 'rcf3048')!)).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-10: the date parts; ICIMS-14 and -16: an IForm's words
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-10: a date’s parts, each its date’s label with its part', () => {
  it('labels every block’s Start and End Date parts on the parsed profile', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const parts = Array.from(fixture.doc.querySelectorAll('select[id$="PersonProfileFields.rcf3214_Month"], select[id$="PersonProfileFields.rcf3214_Date"], input[id$="PersonProfileFields.rcf3214_Year"]'));
    expect(parts.length).toBe(12);
    for (const part of parts) {
      const base = part.id.replace(/_(?:Month|Date|Year)$/, '');
      expect(icimsAdapter.labelFor!(part), part.id).toBe(byId(fixture.doc, `label_${base}`));
      expect(icimsAdapter.labelFirst!(part), part.id).toBe(true);
      expect(icimsAdapter.labelSuffix!(part), part.id).toBe({ Month: 'month', Date: 'day', Year: 'year' }[part.id.split('_').at(-1)!]);
    }
    const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    const labels = scanned.fields.filter((field) => /rcf3214_(?:Month|Date|Year)$/.test(scanned.target(field.key)!.control.id))
      .map((field) => field.label);
    expect(new Set(labels)).toEqual(new Set(['Start Date (if you do not know the day, enter 1) month',
      'Start Date (if you do not know the day, enter 1) day', 'Start Date (if you do not know the day, enter 1) year']));
    // Any other control has no part.
    for (const other of [byId(fixture.doc, 'PersonProfileFields.FirstName')!, byId(fixture.doc, '-1_PersonProfileFields.PhoneType')!]) {
      expect(icimsAdapter.labelSuffix!(other)).toBeNull();
      expect(icimsAdapter.labelFirst!(other)).toBe(false);
    }
  });

  it.each([['jr6-sentinel-iform-selfid.frame-2', "Today's Date"], ['nyu-self-id-disability.frame-2', 'Date signature'],
    ['edgewater-self-id-veteran.frame-2', "Today's Date"]] as const)('%s: the IForm’s date by the words drawn before it',
    async (name, words) => {
      const fixture = await load(name);
      const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
      const labels = Object.fromEntries(scanned.fields.map((field) => [scanned.target(field.key)!.control.id, field.label]));
      expect([labels.icims_f_Date_Month, labels.icims_f_Date_Date, labels.icims_f_Date_Year])
        .toEqual([`${words} month`, `${words} day`, `${words} year`]);
    });
});

describe('ICIMS-14 and -16: an IForm’s radios and its text box', () => {
  const FORMS = [
    { name: 'jr6-sentinel-iform-selfid.frame-2', radio: 'icims_f_Veteran', title: 'VOLUNTARY SELF-IDENTIFICATION OF VETERAN STATUS',
      options: ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
        'I AM NOT A PROTECTED VETERAN', 'I DON\'T WISH TO ANSWER'] },
    { name: 'edgewater-self-id-veteran.frame-2', radio: 'icims_f_Veteran', title: 'VOLUNTARY SELF-IDENTIFICATION OF VETERAN STATUS',
      options: ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
        'I AM NOT A PROTECTED VETERAN', 'I DON\'T WISH TO ANSWER'] },
    { name: 'nyu-self-id-disability.frame-2', radio: 'icims_f_Disability', title: 'Voluntary Self-Identification of Disability',
      options: ['Yes, I have a disability, or have had one in the past',
        'No, I do not have a disability and have not had one in the past', 'I do not want to answer'] },
  ] as const;

  it.each(FORMS)('$name: the radios’ group is their element, its question the form’s title, each option its words',
    async ({ name, radio, title, options }) => {
      const fixture = await load(name);
      const radios = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${radio}"]`));
      expect(radios.length).toBe(3);
      const group = icimsAdapter.groupOf!(radios[0]!)!;
      expect(radios.every((each) => icimsAdapter.groupOf!(each) === group && group.contains(each))).toBe(true);
      expect(group.querySelectorAll('input, select, textarea').length).toBe(3);
      expect(icimsAdapter.labelFor!(group)!.textContent!.replace(/\s+/g, ' ').trim()).toBe(title);
      expect(radios.map((each) => icimsAdapter.optionTextFor!(each))).toEqual(options);
      const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
      const field = scanned.fields.find((each) => each.kind === 'radio')!;
      expect([field.label, field.labelVisible]).toEqual([title, true]);
    });

  it('names no group or option words outside an IForm, nor for its signature box', async () => {
    const fixture = await load('jr6-nyu-iform-offer.frame-2');
    const signature = fixture.doc.querySelector<HTMLInputElement>('input#icims_f_signature')!;
    expect(icimsAdapter.optionTextFor!(signature)).toBeNull();
    expect(icimsAdapter.groupOf!(signature)).toBeNull();
    removeFixtures(document);
    const profile = await load('jr6-ars-profile');
    const radio = profile.doc.createElement('input');
    radio.type = 'radio';
    radio.name = 'x';
    rootOf(profile.doc).append(radio);
    expect(icimsAdapter.groupOf!(radio)).toBeNull();
    expect(icimsAdapter.optionTextFor!(radio)).toBeNull();
  });

  it('labels the cover letter’s box by the words before its own paragraph (ICIMS-16)', async () => {
    const fixture = await load('jr6-nyu-iform-offer.frame-2');
    const box = byId(fixture.doc, 'icims_f_OfferText')!;
    const label = icimsAdapter.labelFor!(box)!;
    expect(label.localName).toBe('p');
    expect(label.nextElementSibling!.contains(box)).toBe(true);
    const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    const field = scanned.fields.find((each) => scanned.target(each.key)!.control === box)!;
    expect([field.kind, field.label, field.labelVisible, field.required])
      .toEqual(['textarea', 'Please copy and paste your cover letter below', true, true]);
    // Another control before the box's words: no caption.
    label.prepend(fixture.doc.createElement('input'));
    expect(icimsAdapter.labelFor!(box)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// ICIMS-22 and -23: the parsed profile's blocks and the résumé on record
// ---------------------------------------------------------------------------------------------------------------------

describe('ICIMS-22: each parsed block’s own Delete, declared and never pressed', () => {
  it('names the 2nd to 4th employment blocks’ Delete, none in the first, every one never pressed', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const root = rootOf(fixture.doc);
    const experience = icimsAdapter.repeatables!(root).find((section) => section.kind === 'experience')!;
    const blocks = experience.blocks();
    expect(blocks.length).toBe(4);
    const removes = blocks.map((block) => experience.removeButton!(block));
    expect(removes[0]).toBeNull();
    for (const [at, remove] of removes.slice(1).entries()) {
      expect(remove!.getAttribute('aria-label')).toBe(`Delete Professional Experience (${at + 2})`);
      expect(blocks[at + 1]!.contains(remove!)).toBe(true);
      expect(icimsAdapter.neverPress!(root)).toContain(remove);
      expect(assertNotSubmit(remove!, { adapter: icimsAdapter, root, allowNext: true })).toEqual({ ok: false,
        refusal: 'adapter-never-press' });
    }
    const education = icimsAdapter.repeatables!(root).find((section) => section.kind === 'education')!;
    expect(education.removeButton!(education.blocks()[0]!)).toBeNull();
  });
});

describe('ICIMS-23: a résumé on record is the résumé’s field, held', () => {
  it.each(['jr6-sentinel-profile.frame-1', 'jr6-nyu-profile-parsed.frame-1', 'jr6-ars-profile-filled'])(
    '%s: its input with "Replace Resume" as the control a person sees, holding a file', async (name) => {
      const fixture = await load(name);
      const root = rootOf(fixture.doc);
      const input = byId(fixture.doc, 'PortalProfileFields.Resume_File') as HTMLInputElement;
      const replace = byId(fixture.doc, 'PortalProfileFields.Resume_Button')!;
      expect(icimsAdapter.uploadWidgets!(root)).toEqual([{ control: replace, input }]);
      expect(icimsAdapter.excluded!(root).some((part) => part.contains(input))).toBe(false);
      expect(icimsAdapter.neverPress!(root)).toContain(replace);
      const scanned = scan(root, icimsAdapter, { platform: 'icims' });
      const field = scanned.fields.find((each) => scanned.target(each.key)?.control === input)!;
      expect([field.kind, field.current]).toEqual(['file', { kind: 'files', count: 1, held: true }]);
    });

  it('offers the "My Computer" button where no résumé is on record (careers-ars’s blank profile)', async () => {
    const fixture = await load('jr6-ars-profile');
    const input = byId(fixture.doc, 'PortalProfileFields.Resume_File') as HTMLInputElement;
    expect(icimsAdapter.uploadWidgets!(rootOf(fixture.doc))).toEqual([{ control: input.parentElement, input }]);
    expect(icimsAdapter.uploadHeld!(input)).toBe(false);
  });
});

describe('ICIMS-22: the parsed blocks are each filled from the entry it holds, never by its place', () => {
  it('assigns blocks by their fingerprint: the profile’s entries swapped, two it lacks given none', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const root = rootOf(fixture.doc);
    const profile = goldenProfile();
    const [first, second] = profile.experience;
    const blocks = icimsAdapter.repeatables!(root).find((section) => section.kind === 'experience')!.blocks();
    expect(blocks.length).toBe(4);
    // As iCIMS's parse leaves them (the fixture's values are cleared): SYNTHETIC values, the golden profile's two entries
    // in the other order, then two employers the profile does not hold.
    const put = (block: Element, field: string, value: string) => {
      block.querySelector<HTMLInputElement>(`input[id$="_PersonProfileFields.${field}"]`)!.value = value;
    };
    for (const [block, company, title] of [[blocks[0]!, second!.company, second!.title],
      [blocks[1]!, first!.company, first!.title], [blocks[2]!, 'Northwind Traders', 'Clerk'],
      [blocks[3]!, 'Contoso Pharmacy', 'Cashier']] as const) {
      put(block, 'rcf3212', company);
      put(block, 'rcf3213', title);
    }
    const scanned = scan(root, icimsAdapter, { platform: 'icims' });
    const output = planFrame({ specs: scanned.fields.map(toFieldSpec), canaries: [], profile, sensitiveState: 'loaded',
      savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
      repeatables: [{ kind: 'experience', entries: null }] });
    const answer = output.repeatables?.find((section) => section.kind === 'experience');
    expect(answer?.entries).toEqual([1, 0, null, null]);
    expect(answer?.profile).toBe(2);
  });
});

// =====================================================================================================================
// P2 (FIXPLAN §6.5 "P2 asserts", after jr6-engine-e3 and jr6-rules-r4 merged): what a run reads, decides and writes on
// the snapshots, with the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants of it built here
// =====================================================================================================================

/** SYNTHETIC public words for the lists every capture redacts (iCIMS's dropdowns load theirs from the server). */
const COUNTRIES = ['Canada', 'Mexico', 'United Kingdom', 'United States'];
const STATES: Readonly<Record<string, readonly string[]>> = {
  'United States': ['Alabama', 'California', 'New York', 'Texas', 'Washington'], Canada: ['Alberta', 'Ontario', 'Quebec'] };
const statesOf = (country: string): readonly string[] => STATES[country] ?? [];
const SCHOOLS = ['Texas A&M University', 'The University of Texas at Austin', 'University of Texas at Dallas', 'Other'];
const DEGREES = ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate', 'Other'];
/** The golden profile's own field of study (its first education entry's), among other SYNTHETIC ones. */
const GOLDEN_FIELD = goldenProfile().education[0]!.degree.field!.name;
const MAJORS = [GOLDEN_FIELD, 'Economics', 'Mathematics', 'Other'];
const YES_NO = ['Yes', 'No'];
const TIME_ZONES = ['Eastern Time', 'Central Time', 'Mountain Time', 'Pacific Time'];
/** "Please specify" once a source is chosen (SYNTHETIC: a job board's names). */
const SPECIFY = ['Indeed', 'LinkedIn', 'Monster', 'Other'];

/** A dropdown's rows: a list, or a dependent's by its parent's answer. */
type Rows = readonly string[] | ((parent: string) => readonly string[]);

/** Each profile's dropdowns, by its select's id after its block's prefix ("-1_", "-330156_"). */
const LISTS: Readonly<Record<string, Rows>> = {
  'PersonProfileFields.AddressCountry': COUNTRIES, 'PersonProfileFields.AddressState': statesOf,
  'PersonProfileFields.AddressStreet1': ['Enter manually'], rcf2018: ['Jr.', 'Sr.', 'II', 'III'], rcf3553: YES_NO,
  rcf3339: YES_NO, rcf3180: YES_NO, rcf3077: TIME_ZONES, 'CandProfileFields.School': SCHOOLS,
  'CandProfileFields.Degree': DEGREES, 'CandProfileFields.Major': MAJORS, 'CandProfileFields.EducationCountry': COUNTRIES,
  'CandProfileFields.EducationState': statesOf, 'PersonProfileFields.rcf3218': COUNTRIES,
  'PersonProfileFields.rcf3217': statesOf,
};

/** What the stood-in page saw a run do. */
interface Stand {
  /** Each choice, "<select id>=<words>", and each native list's change, in order. */
  chosen: string[];
  /** The dropdowns opened (by their select's id), in order. */
  opened: string[];
  /** The dependents whose answer a run had chosen and the page then cleared (its parent's change). */
  lost: string[];
}

/** A select's id after its block's prefix. */
const tailOf = (id: string): string => id.replace(/^-?\d+_/, '');

/**
 * iCIMS's dropdown script, which no capture keeps, stood in for on a loaded snapshot (SP\jr6\audit\icims.md ICIMS-01,
 * -02, -08, -19; Jobright's ~contents/sites/icims ./client-search-widget for the same page), with SYNTHETIC lists:
 * - a click on a trigger toggles its container (dropdown-invisible) and its aria-expanded; once open, its list shows its
 *   rows after `loadMs`, its loading bar (.dropdown-loading) shown meanwhile; a search dropdown's box
 *   (icimsdropdown-search="1") draws the rows holding what is typed, after `slow` (per select id tail) or the same load,
 *   the rows shown before staying until then;
 * - a result's click shows its words in the trigger, keeps them in the hidden select, shuts the container and changes
 *   the select; the address lookup's "Enter manually" (dropdown-index -2) is replaced by the text box careers-ars draws
 *   in its place (jr6-ars-profile-filled.html: input#-1_PersonProfileFields.AddressStreet1, the same id and name,
 *   autocomplete street-address);
 * - a parent's change (data-ddd-child-link) clears its dependent in the same block `resetMs` later, as the owner's
 *   saves show ("Country chosen, State reset"), the dependent's rows then its parent's answer's;
 * - "How did you hear about us?" (select#rcf3048) changed: "Please specify" (select#rcf3049) is enabled 200 ms later with
 *   SPECIFY.
 */
function standIn(doc: Document, lists: Readonly<Record<string, Rows>>,
  timing: { loadMs?: number; resetMs?: number; slow?: Readonly<Record<string, number>> } = {}): Stand {
  const stand: Stand = { chosen: [], opened: [], lost: [] };
  const view = doc.defaultView!;
  const parentAnswer = new Map<string, string>();
  const ours = new Set<string>();
  const parts = (id: string) => ({
    anchor: doc.getElementById(`${id}_icimsDropdown`), ctnr: doc.getElementById(`${id}_icimsDropdown_ctnr`),
    list: doc.getElementById(`${id}_dropdown-results`), shown: doc.getElementById(`${id}_fakeSelected_icimsDropdown`),
    select: doc.getElementById(id) as HTMLSelectElement | null,
  });
  const prompt = () => Object.assign(doc.createElement('span'), { className: 'dropdown-placeholder',
    textContent: '— Make a Selection —' });
  const rowsOf = (id: string): readonly string[] => {
    const source = lists[tailOf(id)];
    if (source === undefined) return [];
    return typeof source === 'function' ? source(parentAnswer.get(id) ?? '') : source;
  };
  const draw = (id: string, query: string) => {
    const { ctnr, list, select } = parts(id);
    const loading = ctnr?.querySelector('.dropdown-loading') ?? null;
    loading?.classList.remove('hide');
    view.setTimeout(() => {
      const search = select?.getAttribute('icimsdropdown-search') === '1';
      const rows = rowsOf(id).filter((row) => !search || row.toLowerCase().includes(query.trim().toLowerCase()));
      const item = (at: number) => {
        const li = doc.createElement('li');
        li.id = `result-selectable_${id}_${at}`;
        li.className = 'dropdown-result result-selectable';
        li.setAttribute('role', 'option');
        li.setAttribute('dropdown-index', String(at));
        return li;
      };
      const first = item(-1);
      first.append(prompt());
      list?.replaceChildren(first, ...rows.map((text, at) => {
        const li = item(text === 'Enter manually' ? -2 : at);
        li.textContent = text;
        return li;
      }));
      loading?.classList.add('hide');
    }, (query === '' ? undefined : timing.slow?.[tailOf(id)]) ?? timing.loadMs ?? 120);
  };
  const open = (id: string, yes: boolean) => {
    const { anchor, ctnr } = parts(id);
    ctnr?.classList.toggle('dropdown-invisible', !yes);
    anchor?.setAttribute('aria-expanded', String(yes));
    if (yes) {
      stand.opened.push(id);
      draw(id, '');
    }
  };
  for (const anchor of Array.from(doc.querySelectorAll<HTMLElement>('a.dropdown-select[id$="_icimsDropdown"]'))) {
    const id = anchor.id.slice(0, -'_icimsDropdown'.length);
    const { ctnr, list, shown, select } = parts(id);
    if (ctnr === null || list === null || shown === null || select === null) continue;
    anchor.addEventListener('click', () => open(id, ctnr.classList.contains('dropdown-invisible')));
    const box = ctnr.querySelector<HTMLInputElement>('input.dropdown-search');
    box?.addEventListener('input', () => draw(id, box.value));
    list.addEventListener('click', (event) => {
      const row = (event.target as Element).closest('li.result-selectable');
      if (row === null || row.getAttribute('dropdown-index') === '-1') return;
      const words = (row.textContent ?? '').trim();
      shown.replaceChildren(words);
      select.replaceChildren(new Option(words, words, true, true));
      stand.chosen.push(`${id}=${words}`);
      ours.add(id);
      open(id, false);
      if (row.getAttribute('dropdown-index') === '-2') {
        const street = doc.createElement('input');
        Object.assign(street, { id, name: id, className: 'iCIMS_Forms_Global customFieldContainer iCIMS_Forms_TextField',
          autocomplete: 'street-address' });
        street.setAttribute('aria-required', 'true');
        select.parentElement!.replaceChildren(street);
        return;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const link = select.getAttribute('data-ddd-child-link') ?? '';
      const prefix = /^-?\d+_/.exec(id)?.[0] ?? '';
      const child = link === '' ? undefined : Array.from(doc.querySelectorAll('select[data-ddd-parent-link]'))
        .find((each) => each.id.startsWith(prefix) && (each.id === `${prefix}${link}` || each.id.endsWith(`.${link}`)));
      if (child === undefined) return;
      parentAnswer.set(child.id, words);
      view.setTimeout(() => {
        const childParts = parts(child.id);
        if (ours.delete(child.id)) stand.lost.push(child.id);
        childParts.shown?.replaceChildren(prompt());
        childParts.select?.replaceChildren(new Option('', ''));
      }, timing.resetMs ?? 200);
    });
  }
  const source = doc.getElementById('rcf3048') as HTMLSelectElement | null;
  const specify = doc.getElementById('rcf3049') as HTMLSelectElement | null;
  source?.addEventListener('change', () => {
    stand.chosen.push(`rcf3048=${source.selectedOptions[0]?.text.trim() ?? ''}`);
    view.setTimeout(() => {
      if (specify === null) return;
      specify.replaceChildren(...['— Make a Selection —', ...SPECIFY].map((text, at) => new Option(text, at === 0 ? '' : text)));
      specify.disabled = false;
    }, 200);
  });
  specify?.addEventListener('change', () => stand.chosen.push(`rcf3049=${specify.selectedOptions[0]?.text.trim() ?? ''}`));
  return stand;
}

/** The words a dropdown's trigger shows: '' while it shows its prompt. */
function shownOf(doc: Document, id: string): string {
  const shown = doc.getElementById(`${id}_fakeSelected_icimsDropdown`);
  return shown === null || shown.querySelector('.dropdown-placeholder') !== null ? '' : (shown.textContent ?? '').trim();
}

/** Where a choice comes in a stand's record (-1: never). */
const chosenAt = (stand: Stand, entry: string): number => stand.chosen.indexOf(entry);

/** A whole run (Fill, the default settings) on a snapshot with its dropdown script stood in for, to its end. */
async function runOn(runtimes: ContentRuntime[], name: string, options: { adapter?: Adapter;
  vary?: (doc: Document) => void; timing?: Parameters<typeof standIn>[2] } = {}) {
  const fixture = await load(name);
  const doc = fixture.doc;
  // A step's Submit pressed in a test posts nothing (a run presses none on these steps: Next is Manual).
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  options.vary?.(doc);
  const stand = standIn(doc, LISTS, options.timing);
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => fileOf(name).address, isTop: true,
    adapters: () => [options.adapter ?? icimsAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  await runtime.fill();
  await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 90_000 });
  const report = worker.reports.at(-1)!;
  return { doc, stand, report, rows: (label: string) => report.fields.filter((row) => row.label === label) };
}

describe('P2: a run drives iCIMS’s dropdowns on the snapshots (ICIMS-01, -02, -03, -08, -19, icims-new-1, -new-2)', () => {
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });

  it('jr6-ars-profile: opens, reads and chooses each list; "Enter manually", then the street; the source, then its detail',
    async () => {
      const { doc, stand, rows } = await runOn(runtimes, 'jr6-ars-profile');
      // ICIMS-01/-03: each dropdown the plan answers is opened by its trigger, read and chosen, by its row's label.
      expect([shownOf(doc, '-1_PersonProfileFields.AddressCountry'), shownOf(doc, '-1_PersonProfileFields.AddressState'),
        shownOf(doc, 'rcf3553')]).toEqual(['United States', 'Texas', 'Yes']);
      expect(chosenAt(stand, '-1_PersonProfileFields.AddressCountry=United States'))
        .toBeLessThan(chosenAt(stand, '-1_PersonProfileFields.AddressState=Texas'));
      expect(rows('Country')).toMatchObject([{ category: 'address.country', status: 'verified', wrote: true }]);
      expect(rows('State/Province')).toMatchObject([{ category: 'address.region', status: 'verified', wrote: true }]);
      // Nothing to write in Suffix (the golden profile holds none): never opened.
      expect(stand.opened).not.toContain('rcf2018');
      expect(rows('Suffix')).toMatchObject([{ category: 'identity.suffix', status: 'skipped', wrote: false }]);
      // ICIMS-08: the address lookup is a list: its "Enter manually" chosen (address.enter-manually), never a typed
      // street; the box drawn in its place is then the street (address.line1), typed on the next pass.
      expect(stand.chosen).toContain('-1_PersonProfileFields.AddressStreet1=Enter manually');
      const street = doc.getElementById('-1_PersonProfileFields.AddressStreet1') as HTMLInputElement;
      expect([street.localName, street.value]).toEqual(['input', goldenProfile().address!.line1]);
      expect(rows('Address')).toMatchObject([{ kind: 'text', category: 'address.line1', status: 'verified', wrote: true }]);
      // ICIMS-19 (ENGINE E3's re-plan, RULES' referral detail): "Please specify", disabled until a source is chosen, is
      // decided again once "How did you hear about us?" is written, and takes the profile's source by its name.
      expect(chosenAt(stand, 'rcf3048=Job Board')).toBeGreaterThanOrEqual(0);
      expect(chosenAt(stand, 'rcf3049=LinkedIn')).toBeGreaterThan(chosenAt(stand, 'rcf3048=Job Board'));
      expect(rows('Please specify')).toMatchObject([{ category: 'referral.detail', status: 'verified', wrote: true }]);
      expect(stand.lost).toEqual([]);
    }, 120_000);

  it.each([
    { name: 'jr6-sentinel-profile.frame-1', chosen: { '-1_PersonProfileFields.AddressCountry': 'United States',
      '-1_PersonProfileFields.AddressState': 'Texas' } },
    { name: 'githubinc-profile.frame-1', chosen: { '-1_PersonProfileFields.AddressCountry': 'United States',
      '-1_PersonProfileFields.AddressState': 'Texas', rcf3553: 'Yes' } },
  ])('$name: opens, reads and chooses each list the plan answers, each by its row’s label', async ({ name, chosen }) => {
    const { doc, stand } = await runOn(runtimes, name);
    for (const [id, words] of Object.entries(chosen)) expect(shownOf(doc, id), id).toBe(words);
    expect(chosenAt(stand, '-1_PersonProfileFields.AddressCountry=United States'))
      .toBeLessThan(chosenAt(stand, '-1_PersonProfileFields.AddressState=Texas'));
    expect(stand.lost).toEqual([]);
  }, 120_000);

  it('jr6-nyu-profile-parsed.frame-1: the parsed profile’s lists, each block’s Country before its State; no block without a place touched',
    async () => {
      const { doc, stand, rows } = await runOn(runtimes, 'jr6-nyu-profile-parsed.frame-1');
      const expected: Record<string, string> = { '-1_PersonProfileFields.AddressCountry': 'United States',
        '-1_PersonProfileFields.AddressState': 'Texas', '-1_CandProfileFields.School': 'The University of Texas at Austin',
        '-1_CandProfileFields.Degree': "Bachelor's Degree", '-1_CandProfileFields.Major': GOLDEN_FIELD,
        '-1_CandProfileFields.EducationCountry': 'United States', '-1_CandProfileFields.EducationState': 'Texas',
        // The first employment block holds the golden profile's current job (Austin, TX, US).
        '-330156_PersonProfileFields.rcf3218': 'United States', '-330156_PersonProfileFields.rcf3217': 'Texas' };
      for (const [id, words] of Object.entries(expected)) expect(shownOf(doc, id), id).toBe(words);
      for (const [parent, child] of [['-1_PersonProfileFields.AddressCountry', '-1_PersonProfileFields.AddressState'],
        ['-1_CandProfileFields.EducationCountry', '-1_CandProfileFields.EducationState'],
        ['-330156_PersonProfileFields.rcf3218', '-330156_PersonProfileFields.rcf3217']] as const) {
        expect(chosenAt(stand, `${parent}=United States`), parent).toBeLessThan(chosenAt(stand, `${child}=Texas`));
      }
      // The second job has no place in the profile, the last two blocks no entry at all (iCIMS's parse of employers the
      // profile lacks): their lists are never opened (ICIMS-09: never the home address there).
      for (const block of ['-330157_', '-330154_', '-330155_']) {
        for (const tail of ['PersonProfileFields.rcf3218', 'PersonProfileFields.rcf3217']) {
          expect(stand.opened, `${block}${tail}`).not.toContain(`${block}${tail}`);
        }
      }
      // ICIMS-20: the source the profile names is in no option: "Other".
      expect(stand.chosen).toContain('rcf3048=Other');
      // ICIMS-24: the School list took the school; its companion box is never written.
      expect((doc.getElementById('-1_CandProfileFields.Minor') as HTMLInputElement).value).toBe('');
      expect(rows('Enter school name if not in the list above')).toMatchObject([{ wrote: false }]);
      expect(stand.lost).toEqual([]);
    }, 150_000);

  it('ICIMS-02: Country is written before State wherever the page draws them, and State once its list is back', async () => {
    // A DOM variant: the State row drawn before the Country row; the State's results for a typed query 2 s in coming
    // (longer than the 1.5 s a list may stay unchanged: its loading bar holds the wait); Country's change clearing State
    // 200 ms later.
    const stateFirst = (doc: Document) => {
      const row = (id: string) => doc.getElementById(id)!.closest('.iCIMS_TableRow')!;
      row('-1_PersonProfileFields.AddressCountry').before(row('-1_PersonProfileFields.AddressState'));
    };
    const timing = { slow: { 'PersonProfileFields.AddressState': 2_000 } };
    const ran = await runOn(runtimes, 'jr6-ars-profile', { vary: stateFirst, timing });
    expect(chosenAt(ran.stand, '-1_PersonProfileFields.AddressCountry=United States'))
      .toBeLessThan(chosenAt(ran.stand, '-1_PersonProfileFields.AddressState=Texas'));
    expect(shownOf(ran.doc, '-1_PersonProfileFields.AddressState')).toBe('Texas');
    expect(ran.stand.chosen.filter((entry) => entry.startsWith('-1_PersonProfileFields.AddressState='))).toHaveLength(1);
    expect(ran.stand.lost).toEqual([]);
    for (const runtime of runtimes.splice(0)) runtime.stop();
    removeFixtures(document);
    // Without the adapter's dependsOn the page's order stands: State is searched first, its list empty until a country
    // is chosen, and it is left (the books never decide it again).
    const { dependsOn: _parent, ...noParent } = icimsAdapter;
    const bare = await runOn(runtimes, 'jr6-ars-profile', { adapter: noParent, vary: stateFirst, timing });
    expect(bare.stand.chosen).toContain('-1_PersonProfileFields.AddressCountry=United States');
    expect(shownOf(bare.doc, '-1_PersonProfileFields.AddressState')).toBe('');
  }, 240_000);

  it('ICIMS-01, -02 (ENGINE edit 2): a search waits while its list’s loading bar shows, past the time a list may stay empty', async () => {
    /** Country searched on a fresh page whose server takes 2.5 s to answer a typed query (the rows shown on opening
     *  stay until then), by `adapter`. */
    const search = async (adapter: Adapter) => {
      removeFixtures(document);
      const fixture = await load('jr6-ars-profile');
      const doc = fixture.doc;
      standIn(doc, LISTS, { slow: { 'PersonProfileFields.AddressCountry': 2_500 } });
      const root = rootOf(doc);
      const target = () => {
        const fresh = scan(root, adapter, { platform: 'icims' });
        return fresh.target(fresh.fields.find((each) => fresh.target(each.key)?.control.id
          === '-1_PersonProfileFields.AddressCountry_icimsDropdown')!.key)!;
      };
      const result = await searchTypeahead(target(), ['United States'], { adapter, root }, {
        guard: async () => ({ ok: true, target: target() }),
        match: async (results) => {
          const index = results.findIndex((each) => each.label === 'United States');
          return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
            : { choose: { index, cleanLabel: 'United States' } };
        },
      });
      return { result, shown: shownOf(doc, '-1_PersonProfileFields.AddressCountry') };
    };
    expect(await search(icimsAdapter)).toMatchObject({ result: { chosen: { cleanLabel: 'United States' }, verified: true },
      shown: 'United States' });
    // The same search with no busy sign declared gives up while the bar still shows.
    const blind: Adapter = { ...icimsAdapter, widgetFor: (control) => {
      const decl = icimsAdapter.widgetFor!(control);
      return decl === null ? null : { ...decl, busy: [] };
    } };
    expect(await search(blind)).toMatchObject({ result: { chosen: null }, shown: '' });
  }, 60_000);

  it('icims-new-1: an open container’s search box is the dropdown’s part, never a field of its own (jr6-ars-profile-address)', async () => {
    const fixture = await load('jr6-ars-profile-address');
    const doc = fixture.doc;
    const ctnr = doc.getElementById('-1_PersonProfileFields.AddressCountry_icimsDropdown_ctnr')!;
    // As captured: Country's container open, its search box shown.
    expect(ctnr.classList.contains('dropdown-invisible')).toBe(false);
    const box = ctnr.querySelector<HTMLInputElement>('input.dropdown-search')!;
    expect(box.getBoundingClientRect().height).toBeGreaterThan(0);
    const result = scan(rootOf(doc), icimsAdapter, { platform: 'icims' });
    expect(result.fields.filter((field) => /type to search/i.test(field.label))).toEqual([]);
    const country = result.fields.find((field) => result.target(field.key)!.control.id
      === '-1_PersonProfileFields.AddressCountry_icimsDropdown')!;
    const widget = result.target(country.key)!.widget!;
    expect(widget.input).toBe(box);
    // ICIMS-01 (ENGINE edit 1): its open list reads as a person sees it (the rows' words SYNTHETIC: the capture's are
    // redacted), its prompt aside.
    const list = widgetListOf(widget)!;
    Array.from(list.querySelectorAll('li[dropdown-index]:not([dropdown-index="-1"])')).forEach((row, at) => {
      row.textContent = COUNTRIES[at % COUNTRIES.length]!;
    });
    const read = shownOptions(list, newScanCache(), undefined, widget.results!.option);
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((option) => COUNTRIES.includes(option.label))).toBe(true);
    // Without the declaration the open box is a field ("— Type to Search —"), as the audit read it.
    const bare = scan(rootOf(doc), { ...icimsAdapter, widgetFor: () => null }, { platform: 'icims' });
    expect(bare.fields.filter((field) => /type to search/i.test(field.label)).length).toBeGreaterThan(0);
  });

  it('icims-new-2: a dropdown the adapter does not declare is refused before any click', async () => {
    const fixture = await load('jr6-ars-profile');
    const doc = fixture.doc;
    // A DOM variant: Time Zone's select no longer says it is iCIMS's dropdown, so widgetFor declares nothing for it.
    doc.getElementById('rcf3077')!.removeAttribute('icimsdropdown-enabled');
    const anchor = doc.getElementById('rcf3077_icimsDropdown')!;
    expect(icimsAdapter.widgetFor!(anchor)).toBeNull();
    const events = logEvents(doc);
    const root = rootOf(doc);
    const result = scan(root, icimsAdapter, { platform: 'icims' });
    const field = result.fields.find((each) => result.target(each.key)!.control === anchor)!;
    const target = result.target(field.key)!;
    expect(fillabilityOf(field, target.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    expect(await readWidget(target, { adapter: icimsAdapter, root })).toEqual({ status: 'unread',
      reason: 'widget-unsupported' });
    expect(await fillWidget(target, { kind: 'option', index: 1, cleanLabel: 'Central Time' }, { adapter: icimsAdapter,
      root })).toMatchObject({ wrote: false, reason: 'widget-unsupported' });
    expect(events.on('rcf3077_icimsDropdown').filter((event) => event.type === 'click')).toEqual([]);
    expect(doc.getElementById('rcf3077_icimsDropdown_ctnr')!.classList.contains('dropdown-invisible')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P2: what RULES decides on the snapshots (planned with the real planFrame; lists read as a run reads them)
// ---------------------------------------------------------------------------------------------------------------------

/** A planned snapshot: its scan, its specs, and each field's row, write and rule by its control's id or name. */
interface Planned {
  result: ScanResult;
  specs: FieldSpec[];
  row(id: string): FillResult;
  write(id: string): PlannedWrite | undefined;
  /** Whether the plan asks the AI about it (PlanOutput.awaiting). */
  awaits(id: string): boolean;
  rule(id: string): string;
}

/** Plans a loaded snapshot as a run's first pass does, the lists in `lists` read (SYNTHETIC words), by their select's id
 *  tail. */
function planOn(doc: Document, extra: Partial<PlanInput> & { lists?: Readonly<Record<string, readonly string[]>> } = {}):
  Planned {
  const root = rootOf(doc);
  const first = scan(root, icimsAdapter, { platform: 'icims' });
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields) {
    const listed = extra.lists?.[tailOf(first.target(field.key)!.control.id.replace(/_icimsDropdown$/, ''))];
    if (listed === undefined) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: listed.map((label) => ({ label, disabled: false })) });
  }
  const result = scan(root, icimsAdapter, { platform: 'icims', widgetReadings: readings });
  const specs = result.fields.map(toFieldSpec);
  const { lists: _lists, ...rest } = extra;
  const plan = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW, posting: { company: 'Acme' },
    repeatables: icimsAdapter.repeatables!(root).map((section) => ({ kind: section.kind, entries: null })), ...rest });
  const keyOf = (id: string) => {
    const field = result.fields.find((each) => {
      const control = result.target(each.key)!.control;
      return control.id === id || control.id === `${id}_icimsDropdown` || control.getAttribute('name') === id;
    });
    if (field === undefined) throw new Error(`no field ${id}`);
    return field.key;
  };
  return {
    result, specs,
    row: (id) => plan.results.find((each) => each.key === keyOf(id))!,
    write: (id) => plan.writes.find((each) => each.key === keyOf(id)),
    awaits: (id) => plan.awaiting.includes(keyOf(id)),
    rule: (id) => {
      const classified = classifyField(specs.find((spec) => spec.key === keyOf(id))!, testVocab());
      return classified.by === 'rules' ? classified.rules.rule : classified.by;
    },
  };
}

const optionOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'option' ? write.value.cleanLabel : undefined);
const textOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'text' ? write.value.text : undefined);
const withModes = (modes: Partial<Settings['modes']>): Settings =>
  ({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, ...modes } });

describe('P2: what the rules decide on the snapshots (RULES R1-R4 on the iCIMS adapter’s readings)', () => {
  it('ICIMS-04 (jr6-sentinel-basic-info.frame-1): no pause; the names, the email and the résumé planned; the account rows left', async () => {
    const fixture = await load('jr6-sentinel-basic-info.frame-1');
    const root = rootOf(fixture.doc);
    expect(detectPause(fixture.doc, root, icimsAdapter)).toBeNull();
    // Login, Password and Re-enter, required and empty: Next holds for them (they follow Sign-in mode, never the profile).
    expect(accountLeft(icimsAdapter, fixture.doc, root)).toBe(3);
    const ran = planOn(fixture.doc);
    expect(textOf(ran.write('PersonProfileFields.FirstName'))).toBe('Alex');
    expect(textOf(ran.write('PersonProfileFields.LastName'))).toBe('Rivera');
    expect(textOf(ran.write('PersonProfileFields.Email'))).toBe(goldenProfile().contact.email);
    expect(ran.write('PortalProfileFields.Resume_File')?.value.kind).toBe('file');
    expect(ran.result.fields.some((field) => /login|password/i.test(field.label))).toBe(false);
    // Once the person typed them, none is left.
    for (const id of ['PersonProfileFields.Login', 'PersonProfileFields.Password', 'PersonProfileFields.Password_Confirm']) {
      (fixture.doc.getElementById(id) as HTMLInputElement).value = 'x';
    }
    expect(accountLeft(icimsAdapter, fixture.doc, root)).toBe(0);
  });

  it('ICIMS-08 (jr6-ars-profile, -address, -filled): the lookup chooses "Enter manually", never a street; its box is the street', async () => {
    for (const name of ['jr6-ars-profile', 'jr6-ars-profile-address']) {
      const fixture = await load(name);
      const ran = planOn(fixture.doc, { lists: { 'PersonProfileFields.AddressStreet1': ['Enter manually'] } });
      expect(ran.row('-1_PersonProfileFields.AddressStreet1'), name).toMatchObject({ kind: 'combobox',
        category: 'address.lookup', status: 'verified' });
      expect(ran.rule('-1_PersonProfileFields.AddressStreet1'), name).toBe('name-id.address-street1');
      expect(ran.write('-1_PersonProfileFields.AddressStreet1'), name).toMatchObject({ value: { kind: 'option',
        cleanLabel: 'Enter manually' }, origin: { provenance: 'rule', ruleId: 'address.enter-manually' } });
      removeFixtures(document);
    }
    const filled = await load('jr6-ars-profile-filled');
    const ran = planOn(filled.doc);
    expect(ran.row('-1_PersonProfileFields.AddressStreet1')).toMatchObject({ kind: 'text', category: 'address.line1',
      status: 'verified' });
    expect(textOf(ran.write('-1_PersonProfileFields.AddressStreet1'))).toBe(goldenProfile().address!.line1);
  });

  it('ICIMS-09 (jr6-nyu-profile-parsed.frame-1): a block’s City is its entry’s, never the home address; none in a block with no place', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const golden = goldenProfile();
    // A variant of the golden profile living elsewhere than its jobs and school (SYNTHETIC).
    const ran = planOn(fixture.doc, { profile: { ...golden, address: { ...golden.address, city: 'Round Rock' } } });
    expect(textOf(ran.write('-1_PersonProfileFields.AddressCity'))).toBe('Round Rock');
    expect(ran.row('-1_CandProfileFields.EducationCity')).toMatchObject({ category: 'education.city' });
    expect(textOf(ran.write('-1_CandProfileFields.EducationCity'))).toBe('Austin');
    expect(ran.row('-330156_PersonProfileFields.rcf3216')).toMatchObject({ category: 'experience.city' });
    expect(textOf(ran.write('-330156_PersonProfileFields.rcf3216'))).toBe('Austin');
    for (const block of ['-330157_', '-330154_', '-330155_']) {
      for (const id of ['PersonProfileFields.rcf3216', 'PersonProfileFields.rcf3218', 'PersonProfileFields.rcf3217']) {
        expect(ran.write(`${block}${id}`), `${block}${id}`).toBeUndefined();
        expect(ran.row(`${block}${id}`), `${block}${id}`).toMatchObject({ status: 'skipped', reason: 'no-profile-value' });
      }
    }
  });

  it('ICIMS-10 (nyu-profile.frame-1): a date’s month, its day (1, as the label asks, the profile holding none) and its 4-digit year', async () => {
    const fixture = await load('nyu-profile.frame-1');
    const ran = planOn(fixture.doc);
    expect(optionOf(ran.write('-1_PersonProfileFields.rcf3214_Month'))).toBe('Jun');
    expect(optionOf(ran.write('-1_PersonProfileFields.rcf3214_Date'))).toBe('1');
    expect(textOf(ran.write('-1_PersonProfileFields.rcf3214_Year'))).toBe('2021');
    for (const part of ['_Month', '_Date', '_Year']) {
      expect(ran.row(`-1_PersonProfileFields.rcf3214${part}`)).toMatchObject({ category: 'experience.startDate',
        status: 'verified' });
      // The golden profile's first job is its current one: no end date.
      expect(ran.row(`-1_PersonProfileFields.rcf3215${part}`)).toMatchObject({ category: 'experience.endDate',
        status: 'skipped', reason: 'end-date-not-applicable' });
    }
  });

  it.each([['jr6-ars-eeo', ['CandProfileFields.Gender', 'CandProfileFields.Race']],
    ['aaalife-eeo-final', ['CandProfileFields.Gender', 'CandProfileFields.Race', 'CandProfileFields.Disability']]] as const)(
    'ICIMS-11 (%s): "Opt Out" is the decline the golden profile gives', async (name, ids) => {
      const fixture = await load(name);
      const ran = planOn(fixture.doc);
      for (const id of ids) {
        expect(ran.write(id), id).toMatchObject({ value: { kind: 'option', cleanLabel: 'Opt Out' },
          origin: { provenance: 'rule', ruleId: 'eeo.decline' } });
        expect(ran.row(id).status, id).toBe('verified');
      }
    });

  it.each([
    { name: 'jr6-ars-profile', phone: '-1_PersonProfileFields.PhoneType', address: '-1_PersonProfileFields.AddressType' },
    { name: 'jr6-sentinel-profile.frame-1', phone: '167544_PersonProfileFields.PhoneType',
      address: '-1_PersonProfileFields.AddressType' },
    { name: 'jr6-nyu-profile-parsed.frame-1', phone: '-1_PersonProfileFields.PhoneType', address: null },
    { name: 'githubinc-profile.frame-1', phone: '-1_PersonProfileFields.PhoneType',
      address: '-1_PersonProfileFields.AddressType' },
  ])('ICIMS-12, -13 ($name): the phone’s "Type" Mobile, the address’s "Type" Home, by their names', async ({ name, phone,
    address }) => {
    const fixture = await load(name);
    const ran = planOn(fixture.doc);
    expect([ran.row(phone).label, ran.row(phone).category, ran.rule(phone)])
      .toEqual(['Type', 'contact.phoneType', 'name-id.phone-type']);
    expect(optionOf(ran.write(phone))).toBe('Mobile');
    if (address === null) return;
    expect([ran.row(address).label, ran.row(address).category, ran.rule(address)])
      .toEqual(['Type', 'address.type', 'name-id.address-type']);
    expect(ran.write(address)).toMatchObject({ value: { kind: 'option', cleanLabel: 'Home' },
      origin: { provenance: 'rule', ruleId: 'address.type-home' } });
  });

  it.each([
    { name: 'jr6-sentinel-iform-selfid.frame-2', radio: 'icims_f_Veteran', category: 'eeo.veteran',
      answer: 'I AM NOT A PROTECTED VETERAN' },
    { name: 'edgewater-self-id-veteran.frame-2', radio: 'icims_f_Veteran', category: 'eeo.veteran',
      answer: 'I AM NOT A PROTECTED VETERAN' },
    { name: 'nyu-self-id-disability.frame-2', radio: 'icims_f_Disability', category: 'eeo.disability',
      answer: 'I do not want to answer' },
  ])('ICIMS-14 ($name): the radios’ words read through optionTextFor, then the EEO rules', async ({ name, radio, category,
    answer }) => {
    const fixture = await load(name);
    const radios = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${radio}"]`));
    const ran = planOn(fixture.doc);
    const field = ran.result.fields.find((each) => each.kind === 'radio')!;
    expect(field.options === 'lazy' ? [] : field.options.map((option) => option.label))
      .toEqual(radios.map((each) => icimsAdapter.optionTextFor!(each)));
    expect(ran.row(radio)).toMatchObject({ category, status: 'verified', needsUserAction: false });
    expect(optionOf(ran.write(radio))).toBe(answer);
  });

  it('ICIMS-15 (jr6-nyu-iform-signature.frame-2): the page’s one box, its Signature, ticked on the signature’s terms', async () => {
    const fixture = await load('jr6-nyu-iform-signature.frame-2');
    for (const consents of ['all', 'required'] as const) {
      const ran = planOn(fixture.doc, { settings: withModes({ consents }) });
      expect(ran.result.fields.map((field) => field.label), consents).toEqual(['Signature']);
      expect(ran.rule('icims_f_signature'), consents).toBe('label.consent-signature');
      expect(ran.write('icims_f_signature'), consents).toMatchObject({ value: { kind: 'check' },
        origin: { provenance: 'rule', ruleId: 'consent.signature-preapproved' } });
      expect(ran.row('icims_f_signature'), consents).toMatchObject({ category: 'consent.signature', needsUserAction: false });
    }
  });

  // jr6 RULES fix IC-R1 (jr6-rules 9656079, with labelSuffix's "signature" for NYU's bare "Date"): an IForm's signature
  // date drawn in parts is today, part by part, on the signature's terms; never sent to the AI.
  it('IC-R1 (edgewater-self-id-veteran.frame-2, nyu-self-id-disability.frame-2): the IForm’s signature date is today, '
    + 'part by part', async () => {
    const PARTS = ['icims_f_Date_Month', 'icims_f_Date_Date', 'icims_f_Date_Year'];
    for (const name of ['edgewater-self-id-veteran.frame-2', 'nyu-self-id-disability.frame-2']) {
      const fixture = await load(name);
      const ran = planOn(fixture.doc);
      for (const id of PARTS) {
        expect(ran.row(id), `${name} ${id}`).toMatchObject({ category: 'consent.signatureDate', status: 'verified',
          needsUserAction: false });
        expect(ran.write(id)?.origin, `${name} ${id}`).toEqual({ provenance: 'rule', ruleId: 'consent.signature-date' });
        expect(ran.awaits(id), `${name} ${id}`).toBe(false);
      }
      expect(textOf(ran.write('icims_f_Date_Year')), name).toBe(String(NOW.y));
      removeFixtures(document);
    }
    // Consents: Required only, the signature not pre-approved: Sentinel's optional parts are left.
    const sentinel = await load('jr6-sentinel-iform-selfid.frame-2');
    const cautious = planOn(sentinel.doc, { settings: CAUTIOUS_SETTINGS });
    for (const id of PARTS) expect(cautious.write(id), id).toBeUndefined();
  });

  it('ICIMS-16 (jr6-nyu-iform-offer.frame-2): the cover letter typed into its box once written; waited for until then', async () => {
    const fixture = await load('jr6-nyu-iform-offer.frame-2');
    expect(planOn(fixture.doc).row('icims_f_OfferText')).toMatchObject({ category: 'freeText.coverLetter',
      reason: 'cover-letter-waiting' });
    const letter = 'SYNTHETIC letter: I would bring ledger-platform work to this role.';
    const ran = planOn(fixture.doc, { coverLetter: { state: 'ready', aiWritten: true, text: letter } });
    expect(ran.rule('icims_f_OfferText')).toBe('label.cover-letter');
    expect(textOf(ran.write('icims_f_OfferText'))).toBe(letter);
    expect(ran.row('icims_f_OfferText')).toMatchObject({ status: 'verified', needsUserAction: false });
  });

  it('ICIMS-19 (jr6-ars-profile-filled): "Please specify" takes the profile’s source by its name among the list the source shows', async () => {
    const fixture = await load('jr6-ars-profile-filled');
    // A DOM variant: the list "Please specify" shows for a job board (SYNTHETIC; the capture's list is the one the
    // person's own source shows).
    const specify = fixture.doc.getElementById('rcf3049') as HTMLSelectElement;
    const draw = (labels: readonly string[]) => specify.replaceChildren(...['— Make a Selection —', ...labels]
      .map((text, at) => new Option(text, at === 0 ? '' : text)));
    draw(SPECIFY);
    const ran = planOn(fixture.doc);
    expect(optionOf(ran.write('rcf3048'))).toBe('Job Board');
    expect([ran.row('rcf3049').category, ran.rule('rcf3049')]).toEqual(['referral.detail', 'name-id.referral-detail']);
    expect(optionOf(ran.write('rcf3049'))).toBe('LinkedIn');
    // A list without the source's name: its own "Other" (RULES' REFERRAL_LISTS).
    draw(['Indeed', 'Monster', 'Other']);
    expect(optionOf(planOn(fixture.doc).write('rcf3049'))).toBe('Other');
  });

  it('ICIMS-20 (jr6-nyu-profile-parsed.frame-1): "How did you hear about us?" names no option of the source: "Other"', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const ran = planOn(fixture.doc);
    expect([ran.row('rcf3048').category, ran.rule('rcf3048')]).toEqual(['referral.source', 'label.referral-source']);
    expect(optionOf(ran.write('rcf3048'))).toBe('Other');
  });

  it('ICIMS-21 (jr6-sentinel-job-questions.frame-1): "What state are you physically located in today?" is the home state', async () => {
    const fixture = await load('jr6-sentinel-job-questions.frame-1');
    const ran = planOn(fixture.doc);
    expect([ran.row('Q266').label, ran.row('Q266').category, ran.rule('Q266')])
      .toEqual(['What state are you physically located in today?', 'address.region', 'label.residence-state']);
    expect(optionOf(ran.write('Q266'))).toBe('Texas');
  });

  it('ICIMS-24, -25 (jr6-nyu-profile-parsed.frame-1): the school chosen in its list, its companion box left; "Did You Graduate?" Yes', async () => {
    const fixture = await load('jr6-nyu-profile-parsed.frame-1');
    const listed = planOn(fixture.doc, { lists: { 'CandProfileFields.School': SCHOOLS } });
    expect(optionOf(listed.write('-1_CandProfileFields.School'))).toBe('The University of Texas at Austin');
    // RULES item 65: the companion pairs with the list of its own section and block.
    expect(listed.row('-1_CandProfileFields.Minor')).toMatchObject({ label: 'Enter school name if not in the list above',
      category: 'education.school', status: 'skipped', reason: 'conditional-question', needsUserAction: false });
    expect(listed.write('-1_CandProfileFields.Minor')).toBeUndefined();
    // Unlisted: the school typed into the box.
    const unlisted = planOn(fixture.doc, { lists: { 'CandProfileFields.School': ['Texas A&M University', 'Other'] } });
    expect(textOf(unlisted.write('-1_CandProfileFields.Minor'))).toBe('The University of Texas at Austin');
    // ICIMS-25: graduated, the entry holding a degree and an end date past.
    expect([listed.row('-1_CandProfileFields.IsGraduated').category, listed.rule('-1_CandProfileFields.IsGraduated')])
      .toEqual(['education.graduated', 'label.graduated']);
    expect(listed.write('-1_CandProfileFields.IsGraduated')).toMatchObject({ value: { kind: 'option', cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'education.graduated' } });
  });

  it.each(['githubinc-profile.frame-1', 'jr6-sentinel-profile.frame-1', 'jr6-nyu-profile-parsed.frame-1',
    'jr6-ars-profile-filled'])('ICIMS-23 (%s): a résumé on record is never written; under "Upload mine again" it is flagged', async (name) => {
    const fixture = await load(name);
    const id = 'PortalProfileFields.Resume_File';
    const upload = planOn(fixture.doc, { settings: withModes({ resumeOnPage: 'upload' }) });
    // RULES edit 16 (item 64's label contract): the hidden input, "Replace Resume" the control a person sees, on iCIMS.
    expect(upload.specs.find((spec) => spec.idAttr === id)).toMatchObject({ platform: 'icims', kind: 'file',
      visibility: 'hidden-file-with-visible-control', current: { kind: 'files', held: true } });
    expect(upload.write(id)).toBeUndefined();
    expect(upload.row(id)).toMatchObject({ category: 'file.resume', status: 'flagged', reason: 'resume-held-no-input',
      needsUserAction: true });
    const keep = planOn(fixture.doc);
    expect(keep.write(id)).toBeUndefined();
    expect(keep.row(id)).toMatchObject({ category: 'file.resume', reason: 'prefill-kept' });
  });

  it('keeps RULES’ moved rows on the older pages (RULES.md, "Expectations that moved"): githubinc’s questions', async () => {
    // Item 53 (JV-13): "Are you a current Full-Time GitHub employee?" No, the posting's company being GitHub.
    const candidate = await load('githubinc-candidate-questions.frame-1');
    const asked = planOn(candidate.doc, { posting: { company: 'GitHub' } });
    expect([asked.row('Q54').label, asked.row('Q54').category, asked.rule('Q54')])
      .toEqual(['Are you a current Full-Time GitHub employee?', 'screening.previouslyEmployed', 'label.previously-employed']);
    expect(optionOf(asked.write('Q54'))).toBe('No');
    // Its neighbour sets GitHub aside and names Microsoft with its subsidiaries: no rule's answer.
    expect(asked.row('Q2957').category).toBe('screening.previouslyEmployed');
    expect(asked.write('Q2957')).toBeUndefined();
    removeFixtures(document);
    // Item 48 (ICIMS-26, JV-16): "Do you have N+ years experience …": years in, which the titles do not settle: the AI's.
    const questions = await load('githubinc-job-questions-error.frame-1');
    const years = planOn(questions.doc, { posting: { company: 'GitHub' } });
    for (const id of ['Q6595', 'Q6596']) {
      expect([years.row(id).category, years.rule(id)], id).toEqual(['experience.yearsIn', 'label.years-in']);
      expect(years.write(id), id).toBeUndefined();
      expect(years.awaits(id), id).toBe(true);
    }
  });

  it('icims-new-3 (githubinc-profile.frame-1): "Preferred Last Name" is the last name', async () => {
    const fixture = await load('githubinc-profile.frame-1');
    const ran = planOn(fixture.doc);
    expect([ran.row('rcf2034').label, ran.row('rcf2034').category, ran.rule('rcf2034')])
      .toEqual(['Preferred Last Name', 'identity.lastName', 'label.last-name']);
    expect(textOf(ran.write('rcf2034'))).toBe('Rivera');
  });

  it('keeps RULES’ label contracts (RULES.md edit 11): the Types’ names, "Please specify" right after its source, "Time Zone"', async () => {
    for (const name of ['jr6-ars-profile', 'jr6-ars-profile-filled', 'githubinc-profile.frame-1', 'jr6-nyu-profile-parsed.frame-1']) {
      const fixture = await load(name);
      const ran = planOn(fixture.doc);
      expect(ran.specs.some((spec) => /PersonProfileFields\.PhoneType$/.test(spec.nameAttr)), name).toBe(true);
      const source = ran.specs.findIndex((spec) => spec.idAttr === 'rcf3048');
      expect([ran.specs[source]?.label, ran.specs[source + 1]?.idAttr], name)
        .toEqual(['How did you hear about us?', 'rcf3049']);
      removeFixtures(document);
    }
    const ars = await load('jr6-ars-profile');
    expect(planOn(ars.doc).result.fields.filter((field) => field.label === 'Time Zone').map((field) => field.required))
      .toEqual([true]);
  });

  // iCIMS declares Time Zone a remote search (its select says icimsdropdown-search="1", FIXPLAN §6.5 item 1);
  // preferences.timeZone takes typeahead-remote since jr6-rules 4b91326.
  it('ICIMS-26 (jr6-ars-profile): Time Zone is the profile’s time zone (preferences.timeZone)', async () => {
    const fixture = await load('jr6-ars-profile');
    const ran = planOn(fixture.doc, { lists: { rcf3077: TIME_ZONES } });
    expect([ran.row('rcf3077').category, ran.rule('rcf3077')]).toEqual(['preferences.timeZone', 'label.time-zone']);
  });

  // In a run the companion box is left (skipped, conditional-question) while the School list types its search, never
  // rowed waiting-for-options, which the loop's books ended options-never-loaded (jr6-rules fa6bd2b).
  it('ICIMS-24 in a run (jr6-nyu-profile-parsed.frame-1): the companion box’s row says skipped once the list took the school', async () => {
    const runtimes: ContentRuntime[] = [];
    try {
      const { doc, rows } = await runOn(runtimes, 'jr6-nyu-profile-parsed.frame-1');
      expect(shownOf(doc, '-1_CandProfileFields.School')).toBe('The University of Texas at Austin');
      expect(rows('Enter school name if not in the list above')).toMatchObject([{ status: 'skipped',
        reason: 'conditional-question', needsUserAction: false }]);
    } finally {
      for (const runtime of runtimes) runtime.stop();
    }
  }, 150_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// P2: the snapshot6 pages' expectations (fixtures/icims/jr6-*.expect.json): each scan of a root is its expectation
// ---------------------------------------------------------------------------------------------------------------------

describe('P2: the snapshot6 pages’ scans are their expectations', () => {
  const ROOTED = EXPECTED.filter((name) => readExpectation(byFile(EXPECTS, `${name}.expect.json`)).fields.length > 0);

  it('lists every page or frame with a root; the IForms’ portal frames hold their hooks alone', () => {
    expect(EXPECTED.filter((name) => !ROOTED.includes(name))).toEqual(['jr6-nyu-iform-offer.frame-1',
      'jr6-nyu-iform-signature.frame-1', 'jr6-sentinel-iform-selfid.frame-1']);
    expect(ROOTED).toHaveLength(14);
  });

  it.each(ROOTED)('%s: the scan of its root is the expectation', async (name) => {
    const { html, address } = fileOf(name);
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter).toBe(icimsAdapter);
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(byFile(EXPECTS, `${name}.expect.json`))))
      .toEqual([]);
  });
});
