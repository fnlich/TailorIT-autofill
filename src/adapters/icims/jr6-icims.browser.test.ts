/*
 * The iCIMS adapter on the owner's snapshot6 of 2026-11-10 (F:\Develop\Refer\snapshot6\icims1..3: careers-sentinel,
 * careers-ars and uscareers-nyu, converted as fixtures/icims/jr6-*.html; the Gmail capture of icims3 never opened), the
 * jr6 build's ICIMS package, P1 (FIXPLAN §6.5): from the auditor's harness (SP\jr6\audit\icims.md section 3), what the
 * adapter reads on every page and frame, held as asserts, and each hook the package added, tested on the snapshots and on
 * DOM variants of them. Outcomes that need ENGINE E1 to E3 or RULES' rules (a widget driven, a label's category, a block
 * left unwritten) are P2's, after those merge; none is asserted here. Lists a fixture redacts (iCIMS's dropdowns) are
 * given SYNTHETIC public words (countries) where a test needs them. Nothing here prints or reads a snapshot's value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pressEntry } from '../../content/press';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import { assertNotSubmit, submitPressAllowed } from '../../dom/fillers/not-submit';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { signInFormOf } from '../../dom/sign-in-form';
import { chainPageOf } from '../chain';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { ChainStepFacts } from '../types';
import { ICIMS_SNAPSHOTS, icimsAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/jr6-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/icims/jr6-*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
const ROUTES = import.meta.glob('../../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const OLD = import.meta.glob(['../../../fixtures/icims/githubinc-profile.frame-1.html',
  '../../../fixtures/icims/ars-gate-phone.html', '../../../fixtures/icims/edgewater-self-id-veteran.frame-2.html',
  '../../../fixtures/icims/nyu-self-id-disability.frame-2.html'],
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
    for (const name of EXPECTED) {
      expect(fileOf(name).html.length > 0 && fileOf(name).address !== '', name).toBe(true);
      expect((byFile(EXPECTS, `${name}.expect.json`) as { note?: string }).note, name).toMatch(/^Hooks only \(jr6 P1\): /);
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
      expect(icimsAdapter.accountSection!(root), name).not.toBeNull();
      expect(icimsAdapter.accountRows!(root), name).toBeNull();
      removeFixtures(document);
    }
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

  it.each([['jr6-sentinel-iform-selfid.frame-2', "Today's Date"], ['nyu-self-id-disability.frame-2', 'Date'],
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
