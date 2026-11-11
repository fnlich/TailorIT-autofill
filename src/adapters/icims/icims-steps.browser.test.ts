/*
 * The iCIMS adapter on the owner's snapshots of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06: ten portals, signed in): the gates that
 * ask more than an email, the page after the gate's Next, the Candidate Profile, both questions pages (one with the
 * page's own errors), EEO (one the application's last step), two IForms' own forms and the page after submitting, each
 * in the frame or page that draws it. Each case's hooks and scan are held to its hand-written expectations
 * (fixtures/icims/<case>.expect.json); then each step rule on its own: the step bar's last step, the step's Submit as
 * Next or Submit, the signature, the errors, the repeatable collections, the uploads, the account pages and the success
 * message. The behaviour review of 2026-11-06: an IForm's own form frame is chained (core-x), so its fields are read and
 * held to its expectation, its Signature box left to the person (minor 8; since jr6 RULES item 44, ICIMS-15, ticked on
 * the signature's terms under Consents: All); the resume's parse and the file on record (M5); the questions' address
 * word after an error (minor 10).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import { assertNotSubmit, submitPressAllowed } from '../../dom/fillers/not-submit';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { chainPageOf } from '../chain';
import { signInFormOf } from '../../dom/sign-in-form';
import { genericAdapter } from '../generic';
import { compareWithExpectation, fillabilityOf, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { ICIMS_SNAPSHOTS, icimsAdapter, icimsSubmitted, stepWordOf } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/icims/*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
const ROUTES = import.meta.glob('../../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;

/** The owner's snapshots of 2026-11-06 converted (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06 has each one's source). */
const OWNER_CASES = ['ars-gate-phone', 'aon-gate-consent', 'nyu-email-verify', 'githubinc-profile', 'nyu-profile',
  'githubinc-candidate-questions', 'githubinc-job-questions-error', 'nyu-voluntary-information', 'aaalife-eeo-final',
  'edgewater-self-id-veteran', 'nyu-self-id-disability', 'nyu-submitted'] as const;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case: its markup, its address (its route map's), and its expectation where it has one. */
function fileOf(name: string): { name: string; html: string; address: string; json: unknown } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { name, html: byFile(PAGES, `${name}.html`) ?? '', address, json: byFile(EXPECTS, `${name}.expect.json`) };
}

/** Every page or frame of the owner's cases that has an expectation. */
const CASES = Object.keys(EXPECTS).map((path) => path.split('/').pop()!.replace(/\.expect\.json$/, ''))
  .filter((name) => (OWNER_CASES as readonly string[]).includes(name.replace(/\.frame-\d+$/, ''))).sort().map(fileOf);

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: its forms and links resolve there. */
async function load(name: string) {
  const { html, address } = fileOf(name);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture;
}

/** The form root the adapter finds on a loaded case. */
function rootOf(doc: Document): Element {
  const found = icimsAdapter.detect(doc);
  if (found === null) throw new Error('no root');
  return found.formRoot;
}

afterEach(() => removeFixtures(document));

describe('the iCIMS adapter on the owner’s snapshots of 2026-11-06', () => {
  it('names each snapshot it was written from, and every case has its expectations', () => {
    // jr6: the snapshot6 cases are jr6-icims.browser.test.ts's.
    expect(OWNER_CASES.map((name) => `fixtures/icims/${name}.html`).sort())
      .toEqual([...ICIMS_SNAPSHOTS].filter((path) => !/\/(?:eastwestbank|gdms|jr6)-/.test(path)).sort());
    expect(CASES.length).toBe(15);
    for (const each of CASES) expect(each.html.length > 0 && each.address !== '', each.name).toBe(true);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ name, json }) => {
    const fixture = await load(name);
    expect(compareHooks(fixture.doc, icimsAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readExpectation(each.json).fields.length > 0))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(icimsAdapter);
      expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
    });

  it('says why a case with a root holds its hooks alone (the IForms’ own forms, a gate whose consent has no label)', () => {
    const hooksOnly = CASES.filter((each) => readHooks(each.json).detect !== null
      && readExpectation(each.json).fields.length === 0);
    // The IForms' frames are chained and read (minor 8: what a run reads there is pinned below), their radios' words in
    // no element, so no entry could name them as a person reads them.
    expect(hooksOnly.map((each) => each.name)).toEqual(['aon-gate-consent.frame-1', 'edgewater-self-id-veteran.frame-2',
      'nyu-self-id-disability.frame-2']);
    for (const each of hooksOnly) expect((each.json as { note?: string }).note, each.name).toMatch(/^Hooks only: /);
  });

  it('never reads a wrapper (the company’s page around the frame) as a root, by either adapter', async () => {
    const wrappers = OWNER_CASES.filter((name) => byFile(PAGES, `${name}.frame-1.html`) !== undefined);
    expect(wrappers.length).toBe(10);
    for (const name of wrappers) {
      const fixture = await load(name);
      expect(icimsAdapter.detect(fixture.doc), name).toBeNull();
      expect(genericAdapter.detect(fixture.doc), name).toBeNull();
      expect(icimsAdapter.authState!(fixture.doc), name).toBeNull();
      removeFixtures(document);
    }
  });
});

describe('the steps: the step bar, the step’s Submit, the signature', () => {
  const TABLE = [
    { name: 'githubinc-profile.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'nyu-profile.frame-1', final: 'not-final', next: 'input#cp_form_submit_i', submit: null },
    { name: 'githubinc-candidate-questions.frame-1', final: 'not-final', next: 'input#quesp_form_submit_i', submit: null },
    { name: 'githubinc-job-questions-error.frame-1', final: 'not-final', next: 'input#quesp_form_submit_i', submit: null },
    { name: 'nyu-voluntary-information.frame-1', final: 'not-final', next: 'input#eeop_form_submit_i', submit: null },
    // careers-aaalife: Candidate Profile > Candidate Questions > EEO, the bar's last step.
    { name: 'aaalife-eeo-final', final: 'final', next: null, submit: 'input#eeop_form_submit_i' },
    // An IForm's own frame holds no bar (the portal's page around it does).
    { name: 'edgewater-self-id-veteran.frame-2', final: 'unknown', next: null, submit: null },
    { name: 'nyu-self-id-disability.frame-2', final: 'unknown', next: null, submit: null },
  ] as const;

  it.each(TABLE)('$name: $final, its Submit the step’s Next or the application’s Submit', async (row) => {
    const fixture = await load(row.name);
    const root = rootOf(fixture.doc);
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe(row.final);
    const pick = (selector: string | null) => (selector === null ? null : fixture.doc.querySelector(selector));
    expect(icimsAdapter.nextButton!(root)).toBe(pick(row.next));
    expect(icimsAdapter.submitButton!(root)).toBe(pick(row.submit));
  });

  it('reads the last step from the bar alone: the profile made the last step is final', async () => {
    const fixture = await load('githubinc-profile.frame-1');
    const root = rootOf(fixture.doc);
    for (const later of Array.from(fixture.doc.querySelectorAll('.iCIMS_Steps li.iCIMS_Steps_NotCurrent'))) later.remove();
    // core-x, item 1: a bar is read only where every item's own count fits it ("Step 1 of 4" left alone is a bar that
    // lost its later steps, which says nothing), so the one step left says it is the only one, as a one-step bar would.
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    const content = fixture.doc.querySelector('.iCIMS_Steps li.iCIMS_Steps_Current .iCIMS_Steps_Content')!;
    content.textContent = (content.textContent ?? '').replace(/of\s+4/, 'of 1');
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('final');
    expect(icimsAdapter.submitButton!(root)).toBe(fixture.doc.querySelector('input#cp_form_submit_i'));
    expect(icimsAdapter.nextButton!(root)).toBeNull();
    // No bar: unknown, and nothing is the step's Next or Submit.
    fixture.doc.querySelector('.iCIMS_Steps')!.remove();
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(icimsAdapter.submitButton!(root)).toBeNull();
  });

  it('every step’s button says "Submit": the step machine presses it as Next where a later step shows, the last step’s by its door alone', async () => {
    // core-x, item 1 (stepSubmitNext): the step's own Submit, by its id, on a step whose bar shows a later step, is the
    // step machine's Next; without the step machine's word it is refused as any submit word is.
    const step = await load('nyu-voluntary-information.frame-1');
    const root = rootOf(step.doc);
    const next = icimsAdapter.nextButton!(root)!;
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root, allowNext: true })).toEqual({ ok: true });
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root })).toEqual({ ok: false, refusal: 'submit-word' });
    removeFixtures(document);
    const last = await load('aaalife-eeo-final');
    const lastRoot = rootOf(last.doc);
    const submit = icimsAdapter.submitButton!(lastRoot)!;
    expect(submitPressAllowed(submit, icimsAdapter, lastRoot)).toBe(true);
    expect(assertNotSubmit(submit, { adapter: icimsAdapter, root: lastRoot, allowNext: true }).ok).toBe(false);
  });

  it('tells every step apart, and keeps a step’s signature when a block is added in place', async () => {
    const signatures = new Map<string, string>();
    for (const name of ['githubinc-profile.frame-1', 'githubinc-candidate-questions.frame-1',
      'githubinc-job-questions-error.frame-1', 'nyu-voluntary-information.frame-1', 'aaalife-eeo-final',
      'edgewater-self-id-veteran.frame-2', 'nyu-self-id-disability.frame-2']) {
      const fixture = await load(name);
      signatures.set(name, hashSignature(icimsAdapter.stepSignature!(fixture.doc)));
      removeFixtures(document);
    }
    expect(new Set(signatures.values()).size).toBe(signatures.size);
    const profile = await load('nyu-profile.frame-1');
    const before = hashSignature(icimsAdapter.stepSignature!(profile.doc));
    // As "Add More (Professional Experience)" draws a second block: a copy of the first, its names numbered anew.
    const block = profile.doc.querySelector('.iCIMS_CollectionContainer.rcf3211-1-Container')!;
    const copy = block.cloneNode(true) as Element;
    for (const control of Array.from(copy.querySelectorAll('[name]'))) {
      control.setAttribute('name', (control.getAttribute('name') ?? '').replace(/^-1_/, '-2_'));
    }
    block.after(copy);
    expect(hashSignature(icimsAdapter.stepSignature!(profile.doc))).toBe(before);
  });
});

describe('the page’s errors (careers-githubinc’s Job Specific Questions after its Submit)', () => {
  it('reads the step’s message and the field row it marks, never the session’s or the cookies’ notice', async () => {
    const fixture = await load('githubinc-job-questions-error.frame-1');
    const root = rootOf(fixture.doc);
    const errors = icimsAdapter.errors!(root).map((error) => error.el);
    expect(errors).toEqual([fixture.doc.querySelector('div[role="alert"].iCIMS_ErrorMessage'),
      fixture.doc.querySelector('select#Q6596')]);
    // "You will be logged out in 60 seconds due to inactivity." shown is no error of the form (here drawn above the form,
    // out of the dialog that holds it).
    const logout = fixture.doc.querySelector<HTMLElement>('#logoutErrorMessage')!;
    root.before(logout);
    logout.style.display = 'block';
    expect(logout.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(icimsAdapter.errors!(root).map((error) => error.el)).toEqual(errors);
    // A page with no error shows none.
    removeFixtures(document);
    const clean = await load('githubinc-candidate-questions.frame-1');
    expect(icimsAdapter.errors!(rootOf(clean.doc))).toEqual([]);
  });
});

describe('the profile: its collections and its uploads', () => {
  it('reads Education and Professional Experience as repeatable, each with its Add More', async () => {
    const fixture = await load('nyu-profile.frame-1');
    const root = rootOf(fixture.doc);
    const sections = icimsAdapter.repeatables!(root);
    expect(sections.map((section) => section.kind)).toEqual(['education', 'experience']);
    expect(sections.map((section) => section.blocks())).toEqual([
      [fixture.doc.querySelector('.iCIMS_CollectionContainer[class~="CandProfileFields.Education-1-Container"]')],
      [fixture.doc.querySelector('.iCIMS_CollectionContainer.rcf3211-1-Container')]]);
    expect(sections.map((section) => section.addButton())).toEqual([
      fixture.doc.getElementById('CandProfileFields.EducationButton_-1'), fixture.doc.getElementById('rcf3211Button_-1')]);
    // Phones and Addresses are collections too, never a repeatable kind.
    expect(fixture.doc.getElementById('PersonProfileFields.PhonesButton_-1')).not.toBeNull();
    removeFixtures(document);
    const github = await load('githubinc-profile.frame-1');
    expect(icimsAdapter.repeatables!(rootOf(github.doc))).toEqual([]);
  });

  it('takes the resume by its "My Computer" button while it shows; once a resume was read, by its Replace Resume', async () => {
    const fixture = await load('nyu-profile.frame-1');
    const input = fixture.doc.getElementById('PortalProfileFields.Resume_File');
    expect(icimsAdapter.uploadWidgets!(rootOf(fixture.doc))).toEqual([{ control: input!.parentElement, input }]);
    expect(input!.parentElement!.matches('div.iCIMS_FileFieldButton.iCIMS_resumeUpload')).toBe(true);
    removeFixtures(document);
    // jr6 ICIMS-23: the held resume's input stays its field, the button a person sees for it "Replace Resume" (never
    // pressed: neverPress), the hidden "My Computer" button no control of it.
    const github = await load('githubinc-profile.frame-1');
    const held = github.doc.getElementById('PortalProfileFields.Resume_File');
    expect(icimsAdapter.uploadWidgets!(rootOf(github.doc)))
      .toEqual([{ control: github.doc.getElementById('PortalProfileFields.Resume_Button'), input: held }]);
  });
});

// ── behaviour review 2026-11-06 (M5): the resume's parse and the file on record ──
describe('the profile: the resume’s parse and the file on record', () => {
  /** The resume's row as the page draws it once it holds `name` (githubinc-profile.frame-1's), on a profile that holds
   *  none yet (nyu-profile.frame-1): its file name label shown, holding the name. */
  function showCurrent(doc: Document, name: string): HTMLElement {
    const current = doc.getElementById('PortalProfileFields.Resume_FileNameLabel')!;
    current.classList.remove('iCIMS_NoDisplay');
    current.querySelector(':scope > span')!.textContent = name;
    return current;
  }

  /** "Parsing resume, please wait...", shown as the page shows it while it reads a resume. */
  function showLoading(doc: Document): void {
    doc.getElementById('PortalProfileFields.Resume_Loading')!.classList.remove('iCIMS_NoDisplay');
  }

  it('is busy while "Parsing resume, please wait..." shows, and not while it is hidden', async () => {
    const fixture = await load('nyu-profile.frame-1');
    expect(fixture.doc.getElementById('PortalProfileFields.Resume_Loading')!.textContent!.trim())
      .toBe('Parsing resume, please wait...');
    expect(icimsAdapter.isBusy!(fixture.doc)).toBe(false);
    showLoading(fixture.doc);
    expect(icimsAdapter.isBusy!(fixture.doc)).toBe(true);
    removeFixtures(document);
    const github = await load('githubinc-profile.frame-1');
    expect(icimsAdapter.isBusy!(github.doc)).toBe(false);
  });

  it('reads the upload pending while the page parses it or names another file, confirmed once it names the written one',
    async () => {
      const fixture = await load('nyu-profile.frame-1');
      const input = fixture.doc.getElementById('PortalProfileFields.Resume_File') as HTMLInputElement;
      // No file on record yet: still under way.
      expect(icimsAdapter.uploadState!(input, 'resume.pdf')).toBe('pending');
      showCurrent(fixture.doc, 'resume.pdf');
      expect(icimsAdapter.uploadState!(input, 'resume.pdf')).toBe('confirmed');
      expect(icimsAdapter.uploadState!(input, ' resume.pdf ')).toBe('confirmed');
      // Another file on record is not the one written.
      expect(icimsAdapter.uploadState!(input, 'other.pdf')).toBe('pending');
      // While the page parses it, never confirmed.
      showLoading(fixture.doc);
      expect(icimsAdapter.uploadState!(input, 'resume.pdf')).toBe('pending');
      // Any other input is no upload this adapter reads.
      const other = fixture.doc.createElement('input');
      other.type = 'file';
      fixture.doc.body.append(other);
      expect(icimsAdapter.uploadState!(other, 'resume.pdf')).toBeNull();
    });

  it('reads a resume held where its row shows the file on record, that row alone; none on a profile with none', async () => {
    const fixture = await load('githubinc-profile.frame-1');
    const input = fixture.doc.getElementById('PortalProfileFields.Resume_File') as HTMLInputElement;
    expect(icimsAdapter.uploadHeld!(input)).toBe(true);
    // The page hides its input with its buttons then; jr6 ICIMS-23: the input stays the resume's field, held, "Replace
    // Resume" the control a person sees for it, never pressed.
    const replace = fixture.doc.getElementById('PortalProfileFields.Resume_Button');
    expect(icimsAdapter.uploadWidgets!(rootOf(fixture.doc))).toEqual([{ control: replace, input }]);
    expect(icimsAdapter.neverPress!(rootOf(fixture.doc))).toContain(replace);
    const scanned = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    const field = scanned.fields.find((each) => scanned.target(each.key)?.control === input)!;
    expect(field.current).toEqual({ kind: 'files', count: 1, held: true });
    fixture.doc.getElementById('PortalProfileFields.Resume_FileNameLabel')!.classList.add('iCIMS_NoDisplay');
    expect(icimsAdapter.uploadHeld!(input)).toBe(false);
    // No file on record shown: no held resume, and the hidden upload buttons offer no control.
    expect(icimsAdapter.uploadWidgets!(rootOf(fixture.doc))).toEqual([]);
    removeFixtures(document);

    const nyu = await load('nyu-profile.frame-1');
    const empty = nyu.doc.getElementById('PortalProfileFields.Resume_File') as HTMLInputElement;
    expect(icimsAdapter.uploadHeld!(empty)).toBe(false);
    // A file name shown in another row is not this field's.
    const elsewhere = nyu.doc.createElement('div');
    elsewhere.className = 'iCIMS_TableRow';
    const label = elsewhere.appendChild(nyu.doc.createElement('div'));
    label.id = 'PortalProfileFields.Resume_FileNameLabel';
    label.className = 'iCIMS_CurrentFile';
    label.appendChild(nyu.doc.createElement('span')).textContent = 'resume.pdf';
    rootOf(nyu.doc).prepend(elsewhere);
    expect(icimsAdapter.uploadHeld!(empty)).toBe(false);
    elsewhere.remove();
    // Its own row showing one, the scan reads the field holding a file, so none is planned again.
    showCurrent(nyu.doc, 'resume.pdf');
    expect(icimsAdapter.uploadHeld!(empty)).toBe(true);
    const result = scan(rootOf(nyu.doc), icimsAdapter, { platform: 'icims' });
    const resume = result.fields.find((field) => result.target(field.key)?.control === empty)!;
    expect(resume.current).toEqual({ kind: 'files', count: 1, held: true });
  });
});

// ── behaviour review 2026-11-06 (minor 10): the questions' address word ──
describe('the questions’ two steps by their address word (?global=1 the Candidate Questions’)', () => {
  /** A route map's address of `name` (its redacted tokens stand for the per-person values). */
  const addressOf = (name: string) => new URL(fileOf(name).address);

  it('keeps each step’s word after its Submit: the page it posts to carries its own global', () => {
    // careers-githubinc's Candidate Questions, before its Submit, and the address its form#questions posts to (the raw
    // snapshot's action: questions?back=...&global=1&csrf=...&in_iframe=1&hashed=...; the converted page's action is
    // the harness's), where an error shows it again.
    const candidate = addressOf('githubinc-candidate-questions.frame-1');
    expect(candidate.searchParams.get('global')).toBe('1');
    expect(stepWordOf(candidate)).toBe('questions-global');
    const afterCandidate = new URL(candidate);
    afterCandidate.search = '?back=&global=1&csrf=REDACTED&in_iframe=1&hashed=REDACTED';
    expect(stepWordOf(afterCandidate)).toBe('questions-global');
    // The Job Specific Questions after its Submit found an error (questions?back=&global=&csrf=...): its own word, as
    // before it (questions, no global: careers-edgewaterit's and us-careers-aon's).
    const error = addressOf('githubinc-job-questions-error.frame-1');
    expect(error.searchParams.get('global')).toBe('');
    expect(stepWordOf(error)).toBe('questions');
    const before = new URL(error);
    before.search = '?in_iframe=1';
    expect(stepWordOf(before)).toBe('questions');
    // Every other step's word is its path's last part.
    expect(stepWordOf(addressOf('nyu-voluntary-information.frame-1'))).toBe('eeo');
    expect(stepWordOf(addressOf('nyu-profile.frame-1'))).toBe('candidate');
  });
});

// ── behaviour review 2026-11-06 (minor 8): an IForm's own form, chained ──
describe('an IForm’s own form, read since its frame is chained', () => {
  /** What the scan reads on each IForm's frame: each field's control name, kind, label and whether a fill would write it
   *  (no-visible-label: no words a person sees name it). jr6: the radios' question is the self-identification form's
   *  title (ICIMS-14: groupOf, labelFor), the date's parts its caption with the part (ICIMS-10); edgewater's name box
   *  stays unlabelled (its aria-label "Name" is not the "Your Name" a person sees above it). */
  const READ = {
    'edgewater-self-id-veteran.frame-2': [
      ['icims_f_Veteran', 'radio', 'VOLUNTARY SELF-IDENTIFICATION OF VETERAN STATUS', 'fillable'],
      ['icims_f_Name', 'text', 'Name', 'no-visible-label'], ['icims_f_Date_Month', 'select', "Today's Date month", 'fillable'],
      ['icims_f_Date_Date', 'select', "Today's Date day", 'fillable'],
      ['icims_f_Date_Year', 'text', "Today's Date year", 'fillable'], ['icims_f_signature', 'checkbox', 'Signature', 'fillable']],
    'nyu-self-id-disability.frame-2': [['icims_f_Name', 'text', 'Name', 'fillable'],
      ['icims_f_Date_Month', 'select', 'Date month', 'fillable'], ['icims_f_Date_Date', 'select', 'Date day', 'fillable'],
      ['icims_f_Date_Year', 'text', 'Date year', 'fillable'],
      ['icims_f_Disability', 'radio', 'Voluntary Self-Identification of Disability', 'fillable'],
      ['icims_f_signature', 'checkbox', 'Signature', 'fillable']],
  } as const;

  it.each(Object.keys(READ) as Array<keyof typeof READ>)('%s: its frame is chained and its fields are read', async (name) => {
    // The frame's address (its route map's, its per-person values redacted) is a chain page of the portal's company.
    const company = name.startsWith('nyu') ? 'nyu' : 'edgewaterit';
    expect(chainPageOf(new URL(fileOf(name).address))).toEqual({ platform: 'icims', role: 'frame', family: `icims:${company}` });
    const fixture = await load(name);
    const result = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
    expect(result.fields.map((field) => {
      const verdict = fillabilityOf(field, result.target(field.key)?.widget);
      return [result.target(field.key)?.control.getAttribute('name'), field.kind, field.label,
        verdict.fillable ? 'fillable' : verdict.reason];
    })).toEqual(READ[name]);
  });

  // jr6 RULES item 44 (ICIMS-15): a signature on a box is decided like any consent box, so under the default Consents:
  // All it is ticked, on the signature's terms (owner Q6 may later keep IForm signatures for the person).
  it.each(['edgewater-self-id-veteran.frame-2', 'nyu-self-id-disability.frame-2'])(
    '%s: its Signature box is ticked on the signature’s terms (ICIMS-15)', async (name) => {
      const fixture = await load(name);
      const result = scan(rootOf(fixture.doc), icimsAdapter, { platform: 'icims' });
      const specs = result.fields.map(toFieldSpec);
      const signature = specs.find((spec) => spec.label === 'Signature' && spec.kind === 'checkbox')!;
      expect(result.target(signature.key)!.control).toBe(fixture.doc.querySelector('input[name="icims_f_signature"]'));
      const plan = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
        settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
      const write = plan.writes.find((each) => each.key === signature.key);
      const row = plan.results.find((each) => each.key === signature.key);
      expect(write).toMatchObject({ value: { kind: 'check' }, origin: { provenance: 'rule',
        ruleId: 'consent.signature-preapproved' } });
      expect(row).toMatchObject({ category: 'consent.signature', needsUserAction: false, wrote: false });
    });
});

describe('the account pages', () => {
  it('pauses for the person after the gate’s Next: "Please verify your email account"', async () => {
    const fixture = await load('nyu-email-verify.frame-1');
    expect(icimsAdapter.detect(fixture.doc)).toBeNull();
    expect(detectPause(fixture.doc, null, icimsAdapter)).toEqual({ kind: 'email-code', evidence: 'adapter' });
    // Its words gone (another system message), no pause is named.
    fixture.doc.querySelector('.iCIMS_SystemMessage')!.textContent = 'Something else';
    expect(icimsAdapter.authState!(fixture.doc)).toBeNull();
  });

  it('leaves Next to the person where the gate also asks for a phone or a consent’s scope', async () => {
    for (const name of ['ars-gate-phone', 'aon-gate-consent.frame-1']) {
      const fixture = await load(name);
      const form = signInFormOf(icimsAdapter, fixture.doc, 'email-gate')!;
      expect(form.personPresses, name).toBe(true);
      // Hidden, it asks nothing more: Next is pressed as on GDMS's gate.
      for (const more of Array.from(fixture.doc.querySelectorAll<HTMLElement>('select#gdpr_consent_type, input#phoneNumber'))) {
        more.style.display = 'none';
      }
      expect(signInFormOf(icimsAdapter, fixture.doc, 'email-gate')!.personPresses, name).toBeUndefined();
      removeFixtures(document);
    }
  });

  it('reads the profile’s "Create a login" as an account’s creation the person presses, a section of the profile', async () => {
    for (const name of ['githubinc-profile.frame-1', 'nyu-profile.frame-1']) {
      const fixture = await load(name);
      // core-x, item 2: the account section (accountSection) pauses nothing; the rest of the profile fills.
      expect(detectPause(fixture.doc, rootOf(fixture.doc), icimsAdapter), name).toBeNull();
      const form = signInFormOf(icimsAdapter, fixture.doc, 'create-account')!;
      expect(form.personPresses, name).toBe(true);
      expect(form.form, name).toBe(rootOf(fixture.doc));
      expect(signInFormOf(icimsAdapter, fixture.doc, 'sign-in'), name).toBeNull();
      removeFixtures(document);
    }
  });
});

describe('the page after submitting (uscareers-nyu’s /job?mode=submit_apply)', () => {
  it('shows its success message, which no step page shows', async () => {
    const fixture = await load('nyu-submitted.frame-1');
    expect(icimsSubmitted(fixture.doc)).toBe(true);
    (fixture.doc.querySelector('.iCIMS_SuccessMessage') as HTMLElement).style.display = 'none';
    expect(icimsSubmitted(fixture.doc)).toBe(false);
    removeFixtures(document);
    for (const name of ['githubinc-profile.frame-1', 'aaalife-eeo-final', 'nyu-email-verify.frame-1']) {
      const page = await load(name);
      expect(icimsSubmitted(page.doc), name).toBe(false);
      removeFixtures(document);
    }
  });
});
