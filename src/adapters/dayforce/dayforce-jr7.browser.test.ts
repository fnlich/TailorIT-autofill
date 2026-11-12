/*
 * jr7 DFPC-7 (SP\jr7\FIX7PLAN.md §6.11, Dayforce; P1): the Dayforce adapter on the owner's snapshot7 dayforce1 captures
 * (fixtures/dayforce/jr7-dayforce1-*.html: the posting, its way-to-apply choice and six captures of step 1), each read at
 * 1500 px (DF7-12: Ant's affix bar of Cancel, Previous, Next and Submit keeps the width it was captured with, so at the
 * 1280 px snapshot viewport Next sits off-screen in the fixture; a capture artifact, the live page recomputes it):
 * - DF7-01: the posting's Apply is its entry; DF7-02: the choice's "Apply without an Account" is the entry of an entry
 *   choice, its Sign In and "Create one now." never pressed; one Autofill press goes posting → choice → the application
 *   in one document (quirks.entryPresses 2);
 * - AUTO7-13: every step-1 capture is not the last step, its Next the snapshots' button;
 * - DF7-03: the page after submitting, on a page of our own built from Jobright's rule (no capture shows it, Q7-1),
 *   read only where a person sees it, and on no captured page;
 * - DF7-05: Education History and Employment History are repeatables filled in place (no Add; each editor's Update its
 *   Save; a saved card's words read for the planner, never filled again);
 * - DF7-V2: the résumé first and its import waited for (quirks.resumeParse); identityHosts dfid.dayforcehcm.com.
 * Each rule is also held against the page read without it (the rule undone).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import posting from '../../../fixtures/dayforce/jr7-dayforce1-posting.html?raw';
import choice from '../../../fixtures/dayforce/jr7-dayforce1-choice.html?raw';
import apply1 from '../../../fixtures/dayforce/jr7-dayforce1-apply-1.html?raw';
import apply2 from '../../../fixtures/dayforce/jr7-dayforce1-apply-2.html?raw';
import apply3 from '../../../fixtures/dayforce/jr7-dayforce1-apply-3.html?raw';
import apply4 from '../../../fixtures/dayforce/jr7-dayforce1-apply-4.html?raw';
import apply5 from '../../../fixtures/dayforce/jr7-dayforce1-apply-5.html?raw';
import apply6 from '../../../fixtures/dayforce/jr7-dayforce1-apply-6.html?raw';
import { applyWorker, openAt, sourceOf, wallsOf } from '../../content/apply.testkit';
import { startContentRuntime } from '../../content/runtime';
import { signsOf } from '../../content/submitted';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { startDeadline } from '../../dom/time';
import { scan } from '../../dom/scan';
import { applicationOf } from '../index';
import { genericAdapter } from '../generic';
import { configProblems, configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import type { Adapter } from '../types';
import { DAYFORCE_CONFIG, DAYFORCE_JR7_CASES, dayforceAdapter } from './index';

/** DF7-12: the width the captures' affix bar was drawn at fits. */
const WIDE = { width: 1500, height: 900 };
const PAGES = { posting, choice, 'apply-1': apply1, 'apply-2': apply2, 'apply-3': apply3, 'apply-4': apply4,
  'apply-5': apply5, 'apply-6': apply6 } as const;
type Name = keyof typeof PAGES;
const STEP1: Name[] = ['apply-1', 'apply-2', 'apply-3', 'apply-4', 'apply-5', 'apply-6'];
const addressOf = (name: Name) => sourceOf(PAGES[name])!;

afterEach(() => removeFixtures(document));

async function open(name: Name): Promise<Document> {
  return (await loadFixture(document, PAGES[name], WIDE)).doc;
}

/** The adapter built from the config with `change` applied (a rule undone). */
const variant = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...DAYFORCE_CONFIG, ...change });
const testIdOf = (el: Element | null | undefined) => el?.getAttribute('test-id') ?? null;

describe('jr7 DFPC-7: the Dayforce adapter on snapshot7 dayforce1', () => {
  it('names the jr7 cases it was written from, and its config is sound', () => {
    expect(DAYFORCE_CONFIG.snapshots).toEqual(expect.arrayContaining([...DAYFORCE_JR7_CASES]));
    expect(DAYFORCE_JR7_CASES.map((name) => name.replace('jr7-dayforce1-', '')).sort()).toEqual(Object.keys(PAGES).sort());
    expect(configProblems(DAYFORCE_CONFIG)).toEqual([]);
    // The addresses read as one application (the posting's key the form's), as ./url.ts reads them.
    const keys = Object.keys(PAGES).map((name) => applicationOf(new URL(addressOf(name as Name)))?.applicationKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^dayforce:/);
  });

  it('DF7-01: the posting shows no form, and its Apply is the entry (pressed by the entry door alone)', async () => {
    const doc = await open('posting');
    expect(dayforceAdapter.detect(doc)).toBeNull();
    expect(testIdOf(dayforceAdapter.entryControl!(doc))).toBe('apply-button');
    expect(dayforceAdapter.entryNeverPressed).toBe(true);
    expect(dayforceAdapter.neverPress!(doc.body)).toContain(doc.querySelector('button[test-id="apply-button"]'));
    expect(testIdOf(dayforceAdapter.postingText!(doc))).toBe('job-detail-body');
    // Undone: no entry.
    expect(variant({ posting: undefined }).entryControl!(doc)).toBeNull();
  });

  it('DF7-02: the choice is an entry choice, its entry "Apply without an Account"; Sign In and Create one now never', async () => {
    const doc = await open('choice');
    expect(dayforceAdapter.detect(doc)).toBeNull();
    expect(dayforceAdapter.authState!(doc)).toBe('entry-choice');
    expect(testIdOf(dayforceAdapter.entryControl!(doc))).toBe('apply-without-account');
    const never = dayforceAdapter.neverPress!(doc.body);
    expect(never).toContain(doc.querySelector('button[test-id="logged-out-content-signin-button"]'));
    expect(never).toContain(doc.querySelector('a[test-id="logged-out-content-register"]'));
    expect(dayforceAdapter.quirks?.entryPresses).toBe(2);
    // Undone: nothing names the page, nothing is pressed.
    const without = variant({ states: undefined });
    expect(without.authState!(doc)).toBeNull();
    expect(without.entryControl!(doc)).toBeNull();
  });

  it('DF7-01 + DF7-02: one Autofill press goes posting → choice → the application in one document (2 presses)', async () => {
    const pressesFor = async (config: AtsConfig) => {
      const { doc } = await openAt(PAGES.posting, addressOf('posting'), WIDE);
      const clicks: Array<string | null> = [];
      let current = addressOf('posting');
      // The site's own routes, simulated: the page and its address swapped on its buttons' clicks.
      const swap = (name: Name) => {
        const parsed = new DOMParser().parseFromString(PAGES[name], 'text/html');
        doc.head.querySelectorAll('style').forEach((el) => el.remove());
        for (const style of Array.from(parsed.head.querySelectorAll('style'))) doc.head.append(doc.importNode(style, true));
        doc.body.replaceChildren(...Array.from(parsed.body.childNodes, (node) => doc.importNode(node, true)));
        current = addressOf(name);
        doc.defaultView!.dispatchEvent(new PopStateEvent('popstate'));
      };
      doc.addEventListener('click', (event) => {
        const id = (event.target as Element).closest('[test-id]')?.getAttribute('test-id') ?? null;
        clicks.push(id);
        if (id === 'apply-button') startDeadline(300, () => swap('choice'));
        if (id === 'apply-without-account') startDeadline(300, () => swap('apply-1'));
      }, true);
      const adapter = configuredAdapter(config);
      const read = (d: Document) => new Proxy(d, { get(target, property) {
        if (property === 'location') return { href: current };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      } });
      const servedNow: Adapter = { ...adapter, detect: (d) => adapter.detect(read(d)),
        entryControl: (d) => adapter.entryControl!(read(d)), authState: (d) => adapter.authState!(read(d)) };
      const worker = applyWorker();
      const runtime = await startContentRuntime(worker.platform, doc, { href: () => current, isTop: true,
        adapters: () => [servedNow, genericAdapter], settle: { quietMs: 120 } });
      await vi.waitFor(() => expect(wallsOf(worker).length).toBeGreaterThan(0), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      const withForm = () => worker.of('frame/hello').filter((message) => message.hasForm === true).length;
      await vi.waitFor(() => expect(withForm() > 0 || wallsOf(worker).some((wall) => wall.refused)).toBe(true),
        { timeout: 30_000 }).catch(() => undefined);
      runtime.stop();
      removeFixtures(document);
      return { clicks, withForm: withForm(), refused: wallsOf(worker).some((wall) => wall.refused) };
    };
    const built = await pressesFor(DAYFORCE_CONFIG);
    expect(built.clicks).toEqual(['apply-button', 'apply-without-account']);
    expect(built.withForm).toBeGreaterThan(0);
    expect(built.refused).toBe(false);
    // Undone (one press per agent/enter): the choice is told, never pressed in that document.
    const one = await pressesFor({ ...DAYFORCE_CONFIG, quirks: { resumeParse: true } });
    expect(one.clicks).toEqual(['apply-button']);
    expect(one.withForm).toBe(0);
  }, 90_000);

  it.each(STEP1)('AUTO7-13, %s: step 1, its Next the snapshots\' button, never the last step', async (name) => {
    const doc = await open(name);
    const root = dayforceAdapter.detect(doc)!.formRoot;
    expect(root.id).toBe('jobPostingApplication');
    expect(dayforceAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(testIdOf(dayforceAdapter.nextButton!(root))).toBe('application-next-step');
    expect(dayforceAdapter.entryControl!(doc)).toBeNull();
    expect(dayforceAdapter.authState!(doc)).toBeNull();
  });

  it('DF7-03: the page after submitting, by Jobright\'s rule, on a page of our own; on no captured page', async () => {
    const { doc } = await loadFixture(document, '<!doctype html><body><div id="jobPostingApplication"></div>'
      + '<main><div test-id="application-successfullsubmission-message" hidden>Your application was submitted.</div>'
      + '<div test-id="application-successfullsubmission-message-with-confirmation-number" hidden>Thank you, 123</div>'
      + '<div test-id="application-successfullsubmission-message" id="empty"> </div></main></body>');
    expect(signsOf(doc, 'dayforce')).toEqual([]);
    const plain = doc.querySelector<HTMLElement>('[test-id="application-successfullsubmission-message"]')!;
    plain.hidden = false;
    expect(signsOf(doc, 'dayforce')).toEqual([plain]);
    const numbered = doc.querySelector<HTMLElement>('[test-id$="-with-confirmation-number"]')!;
    numbered.hidden = false;
    expect(signsOf(doc, 'dayforce')).toEqual([plain, numbered]);
    removeFixtures(document);
    for (const name of Object.keys(PAGES) as Name[]) expect(signsOf(await open(name), 'dayforce'), name).toEqual([]);
  });

  it('DF7-05: Education and Employment History are repeatables filled in place: no Add, Update their Save', async () => {
    const doc = await open('apply-1');
    const root = dayforceAdapter.detect(doc)!.formRoot;
    const sections = dayforceAdapter.repeatables!(root);
    expect(sections.map((section) => section.kind)).toEqual(['education', 'experience']);
    for (const section of sections) {
      expect(section.blocks().map((block) => block.getAttribute('test-id'))).toEqual(
        [section.kind === 'education' ? 'educationhistory-record' : 'workhistory-record']);
      expect(section.addButton()).toBeNull();
      expect(testIdOf(section.save!(section.blocks()[0]!))).toBe(
        section.kind === 'education' ? 'educationHistory-update-button' : 'workHistory-update-button');
    }
    expect(testIdOf(sections[1]!.currentlyHere!(sections[1]!.blocks()[0]!))).toBe('work-history-currentjob-checkbox');
    // The editors' boxes are their entry's: the scan places them in the section's block.
    const result = scan(root, dayforceAdapter, { platform: 'dayforce' });
    const sectionOf = (css: string) => result.fields.find((field) => result.target(field.key)?.control
      === doc.querySelector(css))?.section;
    expect(sectionOf('#jobPostingApplication_educationHistory_0_schoolName')).toMatchObject({ block: 0 });
    expect(sectionOf('#jobPostingApplication_workHistory_0_companyName')).toMatchObject({ block: 0 });
    // The Add buttons, the editors' Cancel and the Reference editor's Update are never pressed (Decision 16, Q7-11).
    const never = dayforceAdapter.neverPress!(doc.body);
    for (const id of ['add-educationhistory-record', 'add-workhistory-record', 'add-reference-record',
      'educationHistory-cancel-button', 'workHistory-cancel-button', 'reference-cancel-button', 'reference-update-button']) {
      expect(never, id).toContain(doc.querySelector(`button[test-id="${id}"]`));
    }
    // Undone: no repeatables, the editors' boxes loose (no entry's block).
    const { repeatables: _undone, ...rest } = DAYFORCE_CONFIG.code!;
    const loose = variant({ code: rest });
    expect(loose.repeatables!(root)).toEqual([]);
    const looseScan = scan(root, loose, { platform: 'dayforce' });
    const school = looseScan.fields.find((field) => looseScan.target(field.key)?.control
      === doc.querySelector('#jobPostingApplication_educationHistory_0_schoolName'));
    expect(school?.section.block).toBeUndefined();
  });

  it('DF7-05: a saved card is a block read by its words (never filled again); an open editor by its fields', async () => {
    const doc = await open('apply-3');
    const root = dayforceAdapter.detect(doc)!.formRoot;
    const [education, experience] = dayforceAdapter.repeatables!(root);
    // apply-3: a new education editor above the imported card; four imported employment cards.
    expect(education!.blocks().map((block) => block.querySelector('input') !== null)).toEqual([true, false]);
    expect(experience!.blocks().every((block) => block.querySelector('input') === null)).toBe(true);
    expect(education!.save!(education!.blocks()[1]!)).toBeNull();
    const read = dayforceAdapter.prefill!.readEntries!;
    const educationRead = read('education', education!.blocks());
    expect(educationRead.map((entry) => entry.block)).toEqual([1]);
    expect(educationRead[0]!.values.map((value) => value.category)).toEqual(['education.school']);
    const experienceRead = read('experience', experience!.blocks());
    expect(experienceRead.map((entry) => entry.block)).toEqual([0, 1, 2, 3]);
    for (const entry of experienceRead) {
      expect(entry.values.map((value) => value.category)).toEqual(['experience.company', 'experience.title']);
      expect(entry.values.every((value) => value.text !== '')).toBe(true);
    }
    // Each kind reads its own section's cards alone, and an open editor never by card words (it holds fields).
    expect(read('education', experience!.blocks())).toEqual([]);
    const editor = education!.blocks()[0]!;
    const stray = editor.ownerDocument.createElement('span');
    stray.setAttribute('test-id', 'education-history-read-schoolName-city-state');
    stray.textContent = 'Another School, Town, ST';
    editor.append(stray);
    expect(read('education', education!.blocks()).map((entry) => entry.block)).toEqual([1]);
    stray.remove();
    // The school and the employer are the card line's first part (its ", " joins the name, the city and the state).
    const card = education!.blocks()[1]!.querySelector('[test-id="education-history-read-schoolName-city-state"]')!;
    card.textContent = 'Example University, Austin, TX';
    expect(read('education', education!.blocks())[0]!.values).toEqual([{ category: 'education.school',
      text: 'Example University' }]);
    // Undone: no card is read, so the planner would fill an imported entry again.
    const { prefill: _undone, ...rest } = DAYFORCE_CONFIG.code!;
    expect(variant({ code: rest }).prefill).toBeUndefined();
  });

  it('DF7-V2 and identityHosts: the résumé first, its import waited for; the sign-in leaves to dfid', () => {
    expect(dayforceAdapter.quirks).toMatchObject({ resumeParse: true, entryPresses: 2 });
    const hosts = dayforceAdapter.identityHosts!;
    expect(hosts.some((pattern) => pattern.test('dfid.dayforcehcm.com'))).toBe(true);
    for (const host of ['jobs.dayforcehcm.com', 'dfid.dayforcehcm.com.example.com', 'xdfid.dayforcehcm.com']) {
      expect(hosts.some((pattern) => pattern.test(host)), host).toBe(false);
    }
  });
});
