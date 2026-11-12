/*
 * jr7 JDEF-7, P1 (FIX7PLAN §6.15, JobDiva): the JobDiva adapter on the owner's snapshot7 captures (two agencies'
 * candidate portals, jobdiva1 and jobdiva2: fixtures/jobdiva/jr7-*, converted with the jr7 converter in the live style
 * order), each rule held to what the page shows and read again with the rule undone:
 * - the address (JDV-2, JDV-V4): one key per job, also on the address as captured (the older link's query);
 * - each capture's root, state, entry, step, finality, Next, Submit, busy sign and success sign (JDV-3, JDV-7, JDV-8,
 *   JDV-V2, JDV-V3, JDV-10, JDV-14);
 * - the fields: the text boxes' labels (JDV-4), the résumé (JDV-6), the phone's layout and drawn box (JDV-11), the EEO
 *   questions' titles and options (JDV-9);
 * - the agent's entry door: Apply Now, then Quick Apply (No Account), never an account choice (JDV-7).
 * P2 (after ENGINE-7 E2, RULES-7 R2, AUTO-7 and CHAIN-7) runs Submit and the two in-place EEO steps to "Thank you!"
 * under one arm (JDV-8's regression test). The fixtures hold no answer of the owner's; nothing here prints a page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import posting1Html from '../../../fixtures/jobdiva/jr7-jobdiva1-posting.html?raw';
import choice1Html from '../../../fixtures/jobdiva/jr7-jobdiva1-choice.html?raw';
import quick1Html from '../../../fixtures/jobdiva/jr7-jobdiva1-quick-apply.html?raw';
import quick1LaterHtml from '../../../fixtures/jobdiva/jr7-jobdiva1-quick-apply-later.html?raw';
import posting1Routes from '../../../fixtures/jobdiva/jr7-jobdiva1-posting.routes.json';
import posting2Html from '../../../fixtures/jobdiva/jr7-jobdiva2-posting.html?raw';
import choice2Html from '../../../fixtures/jobdiva/jr7-jobdiva2-choice.html?raw';
import quick2Html from '../../../fixtures/jobdiva/jr7-jobdiva2-quick-apply.html?raw';
import quick2FilledHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-quick-apply-filled.html?raw';
import eeoHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-eeo.html?raw';
import veteranHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-veteran.html?raw';
import confirmationHtml from '../../../fixtures/jobdiva/jr7-jobdiva2-confirmation.html?raw';
import confirmationRoutes from '../../../fixtures/jobdiva/jr7-jobdiva2-confirmation.routes.json';
import posting2Routes from '../../../fixtures/jobdiva/jr7-jobdiva2-posting.routes.json';
import { pressEntry, pressEntryChoice } from '../../content/press';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configProblems, configuredAdapter, configuredSuccessSigns, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { genericAdapter } from '../generic';
import { adaptersFor, applicationOf } from '../index';
import { wordsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { JOBDIVA_SNAPSHOTS } from './config';
import { JOBDIVA_CONFIG, JOBDIVA_FIXTURES, JOBDIVA_PHONE_PATTERN, jobDivaAdapter } from './index';

afterEach(() => removeFixtures(document));

const CAPTURES = {
  'jr7-jobdiva1-posting': posting1Html, 'jr7-jobdiva1-choice': choice1Html, 'jr7-jobdiva1-quick-apply': quick1Html,
  'jr7-jobdiva1-quick-apply-later': quick1LaterHtml, 'jr7-jobdiva2-posting': posting2Html,
  'jr7-jobdiva2-choice': choice2Html, 'jr7-jobdiva2-quick-apply': quick2Html,
  'jr7-jobdiva2-quick-apply-filled': quick2FilledHtml, 'jr7-jobdiva2-eeo': eeoHtml, 'jr7-jobdiva2-veteran': veteranHtml,
  'jr7-jobdiva2-confirmation': confirmationHtml,
} as const;
type Capture = keyof typeof CAPTURES;

const open = (name: Capture): Promise<Fixture> => loadFixture(document, CAPTURES[name], SNAPSHOT_VIEWPORT);
/** The adapter a config builds with some of its rules changed and some of its code hooks left out (the rule-built
 *  hook, from the changed rules, then stands). */
const variant = (change: Partial<AtsConfig>, leftOut: readonly string[] = [], recode: Record<string, unknown> = {}):
  Adapter => {
  const code: Record<string, unknown> = { ...JOBDIVA_CONFIG.code, ...recode };
  for (const name of leftOut) delete code[name];
  return configuredAdapter({ ...JOBDIVA_CONFIG, ...change, code: code as AtsConfig['code'] });
};
const changed = (change: Partial<AtsConfig>) => variant(change);
const recoded = (leftOut: readonly string[]) => variant({}, leftOut);
const said = (el: Element | null | undefined) => (el === null || el === undefined ? null : wordsOf(el));
const fieldsOf = (doc: Document, adapter: Adapter = jobDivaAdapter) => {
  const root = adapter.detect(doc)?.formRoot;
  return root === undefined ? [] : scan(root, adapter, { platform: 'jobdiva' }).fields;
};

/** What a capture shows to the adapter: [root shown, authState, isFinalStep, isBusy, entry, Submit, Next, signs]. */
type Seen = [boolean, string | null, string, boolean, string | null, string | null, string | null, number];
const SEEN: Record<Capture, Seen> = {
  'jr7-jobdiva1-posting': [false, null, 'unknown', false, 'Apply Now', null, null, 0],
  'jr7-jobdiva1-choice': [false, 'entry-choice', 'unknown', false, 'Quick Apply (No Account)', null, null, 0],
  'jr7-jobdiva1-quick-apply': [true, null, 'final', true, null, 'Submit Application', null, 0],
  'jr7-jobdiva1-quick-apply-later': [true, null, 'final', false, null, 'Submit Application', null, 0],
  'jr7-jobdiva2-posting': [false, null, 'unknown', false, 'Apply Now', null, null, 0],
  'jr7-jobdiva2-choice': [false, 'entry-choice', 'unknown', false, 'Quick Apply (No Account)', null, null, 0],
  'jr7-jobdiva2-quick-apply': [true, null, 'final', false, null, 'Submit Application', null, 0],
  'jr7-jobdiva2-quick-apply-filled': [true, null, 'final', false, null, 'Submit Application', null, 0],
  'jr7-jobdiva2-eeo': [true, null, 'not-final', false, null, null, 'Next', 0],
  'jr7-jobdiva2-veteran': [true, null, 'not-final', false, null, null, 'Save', 0],
  'jr7-jobdiva2-confirmation': [false, null, 'unknown', false, null, null, null, 1],
};

describe('JobDiva (jr7 JDEF-7 P1): the adapter and its registration', () => {
  it('is registered: its config sound, its success rule in ATS_CONFIGS, its fixtures the ones it was read from', () => {
    expect(configProblems(JOBDIVA_CONFIG)).toEqual([]);
    expect(ATS_CONFIGS.jobdiva).toBe(JOBDIVA_CONFIG);
    expect(JOBDIVA_FIXTURES).toEqual(Object.keys(CAPTURES).map((name) => `fixtures/jobdiva/${name}.html`));
    expect([...JOBDIVA_SNAPSHOTS].sort()).toEqual(Object.keys(CAPTURES).sort());
    expect(jobDivaAdapter.quirks).toEqual({ entryPresses: 2, formInPlace: true, formLateMs: 20_000 });
    expect(jobDivaAdapter.entryNeverPressed).toBe(true);
  });

  it('JDV-2, JDV-V4: keys the job, also on the address as jobdiva2 captured it (the older link\'s query)', () => {
    // jobdiva2's captured address: the portal key and the older link's query (its id the job's), no fragment kept.
    const captured = new URL(Object.keys(posting2Routes)[0]!);
    const job = captured.searchParams.get('id')!;
    const key = captured.searchParams.get('a')!;
    expect(job).toMatch(/^\d{8}$/);
    const ref = applicationOf(captured);
    expect(ref?.platform).toBe('jobdiva');
    expect(ref?.page).toBe('application');
    expect(ref?.applicationUrl).toBe(`https://www2.jobdiva.com/portal/?a=${key}#/jobs/${job}`);
    expect(adaptersFor(captured)).toEqual([jobDivaAdapter, genericAdapter]);
    // The whole flow is that one address: the confirmation keys the same.
    expect(applicationOf(new URL(Object.keys(confirmationRoutes)[0]!))?.applicationKey).toBe(ref?.applicationKey);
    const routed = new URL(`${captured.href}#/jobs/${job}?jobtitle=x`);
    expect(applicationOf(routed)?.applicationKey).toBe(ref?.applicationKey);
    // jobdiva1's address as captured has lost its fragment (#/jobs/<id>): the job list, no job; with the route, a job.
    const portal1 = new URL(Object.keys(posting1Routes)[0]!);
    expect(applicationOf(portal1)).toBeNull();
    expect(applicationOf(new URL(`${portal1.href}#/jobs/12345678`))?.platform).toBe('jobdiva');
    expect(applicationOf(new URL(`${portal1.href}#/jobs/12345678`))?.applicationKey).not.toBe(ref?.applicationKey);
  });

  it('JDV-2: every capture of one application is that job\'s one key, its address as captured (the fragment kept)', () => {
    // The header's source: the address the capture was saved at, its route #/jobs/<id> kept.
    const sourceOf = (html: string) => (JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(html)![1]!) as
      { source: string }).source;
    const keys = (prefix: string) => Object.entries(CAPTURES).filter(([name]) => name.startsWith(prefix)).map(([, html]) => {
      const ref = applicationOf(new URL(sourceOf(html)));
      expect(ref?.platform).toBe('jobdiva');
      expect(ref?.page).toBe('application');
      return ref!.applicationKey;
    });
    const one = keys('jr7-jobdiva1-');
    const two = keys('jr7-jobdiva2-');
    expect([one.length, new Set(one).size, two.length, new Set(two).size]).toEqual([4, 1, 7, 1]);
    expect(one[0]).not.toBe(two[0]);
  });

  it('reads each capture: root, state, finality, busy, entry, Submit, Next and the success sign', async () => {
    for (const name of Object.keys(CAPTURES) as Capture[]) {
      const { doc } = await open(name);
      const root = jobDivaAdapter.detect(doc)?.formRoot ?? null;
      const seen: Seen = [root !== null, jobDivaAdapter.authState!(doc), jobDivaAdapter.isFinalStep!(doc),
        jobDivaAdapter.isBusy!(doc), said(jobDivaAdapter.entryControl!(doc)),
        root === null ? null : said(jobDivaAdapter.submitButton!(root)),
        root === null ? null : said(jobDivaAdapter.nextButton!(root)), configuredSuccessSigns(doc, JOBDIVA_CONFIG).length];
      expect(seen, name).toEqual(SEEN[name]);
      removeFixtures(document);
    }
  }, 60_000);

  it('JDV-3: the root is the open dialog\'s body; without its holds rule, the confirmation\'s body would be one', async () => {
    const { doc } = await open('jr7-jobdiva2-confirmation');
    expect(jobDivaAdapter.detect(doc)).toBeNull();
    const loose = changed({ root: { css: JOBDIVA_CONFIG.root.css, from: JOBDIVA_CONFIG.root.from } });
    expect(loose.detect(doc)?.formRoot.matches('#quickApplyModal .modal-body-main')).toBe(true);
    removeFixtures(document);
    const quick = await open('jr7-jobdiva2-quick-apply');
    expect(jobDivaAdapter.detect(quick.doc)?.formRoot.matches('#quickApplyModal.show .modal-body-main')).toBe(true);
  });

  it('JDV-4, JDV-6, JDV-11: reads the Quick Apply form\'s fields, labelled, required where marked, the résumé a file',
    async () => {
      for (const name of ['jr7-jobdiva1-quick-apply-later', 'jr7-jobdiva2-quick-apply', 'jr7-jobdiva2-quick-apply-filled'] as const) {
        const { doc } = await open(name);
        const rows = fieldsOf(doc).map((field) => [field.kind, field.required, field.label, field.camouflaged]);
        expect(rows, name).toEqual([['text', true, 'First Name', false], ['text', true, 'Last Name', false],
          ['text', true, 'Email', false], ['text', false, 'Phone', false],
          ['checkbox', false, 'I consent to receive employment-related text messages to this number', false],
          ['file', true, 'Upload Your Resume', false]]);
        removeFixtures(document);
      }
      const { doc } = await open('jr7-jobdiva2-quick-apply');
      // JDV-4 undone: no question rule, the boxes have no visible label (label.jd-label is a sibling with no for).
      expect(fieldsOf(doc, variant({ questions: [] }, ['labelFor'])).filter((field) => field.kind === 'text').map((field) => field.label))
        .toEqual(['', '', '', '']);
      // The title's star is the résumé's required mark (it has no attribute): drawn without it, it reads optional.
      const resumeTitle = Array.from(doc.querySelectorAll('label.jd-label')).find((el) => /^Upload Your Resume/.test(wordsOf(el)))!;
      resumeTitle.querySelector('span.jd-text-red')!.remove();
      expect(fieldsOf(doc).find((field) => field.kind === 'file')?.required).toBe(false);
      // JDV-6 undone: the résumé's hidden input is no field, an upload the scan does not know.
      const root = jobDivaAdapter.detect(doc)!.formRoot;
      const bare = changed({ uploads: [] });
      expect(scan(root, bare, { platform: 'jobdiva' }).fields.some((field) => field.kind === 'file')).toBe(false);
      expect(jobDivaAdapter.uploadWidgets!(root).map(({ control }) => control.className)).toEqual(['jd-dropzone']);
    });

  it('JDV-6: the résumé card reads as a file the page holds; none on the blank form', async () => {
    const blank = await open('jr7-jobdiva2-quick-apply');
    const input = blank.doc.querySelector<HTMLInputElement>('.jd-dropzone input[type="file"]')!;
    expect(jobDivaAdapter.uploadHeld!(input)).toBe(false);
    removeFixtures(document);
    const filled = await open('jr7-jobdiva2-quick-apply-filled');
    const held = filled.doc.querySelector<HTMLInputElement>('.jd-dropzone input[type="file"]')!;
    expect(jobDivaAdapter.uploadHeld!(held)).toBe(true);
    expect(jobDivaAdapter.uploadState!(held, 'Alex Rivera Resume.pdf')).toBe('pending');
  });

  it('JDV-11: the phone takes the national number beside "+1", its edge drawn by .jd-form-phone', async () => {
    const { doc } = await open('jr7-jobdiva2-quick-apply');
    const phone = fieldsOf(doc).find((field) => field.label === 'Phone')!;
    expect(phone.constraints).toMatchObject({ format: 'tel', pattern: JOBDIVA_PHONE_PATTERN });
    const tel = doc.querySelector('.jd-form-phone input[type="tel"]')!;
    expect(jobDivaAdapter.controlBox!(tel)).toBe(doc.querySelector('.jd-form-phone'));
    // Undone: the box draws no edge of its own (.jd-form-phone input { border: 0 }), so it reads camouflaged; and its
    // layout is the type's alone.
    const bare = recoded(['controlBox', 'formatFor']);
    const plain = fieldsOf(doc, bare).find((field) => field.label === 'Phone')!;
    expect(plain.camouflaged).toBe(true);
    expect(plain.constraints.pattern).toBeUndefined();
  });

  it('JDV-9: titles each EEO question by its group, each option by its own words', async () => {
    const expected: Record<string, Array<[string, boolean, string[]]>> = {
      'jr7-jobdiva2-eeo': [['Sex', true, ['Female', 'Male', 'Non-binary', 'I do not wish to provide this information']],
        ['Race', true, ['Hispanic or Latino', 'White', 'Black or African American',
          'Native Hawaiian or other Pacific Islander', 'Asian', 'American Indian or Alaskan Native', 'Two or more races',
          'I do not wish to provide this information']]],
      'jr7-jobdiva2-veteran': [['Protected Veteran Status', true, [
        'I identify as one or more of the classifications of protected veteran listed above',
        'I am not a protected veteran', 'I do not wish to provide this information']]],
    };
    const optionsOf = (doc: Document, adapter: Adapter) => fieldsOf(doc, adapter).map((field) => [field.label,
      field.required, Array.isArray(field.options) ? field.options.map((option) => option.label) : []]);
    for (const name of ['jr7-jobdiva2-eeo', 'jr7-jobdiva2-veteran'] as const) {
      const { doc } = await open(name);
      expect(fieldsOf(doc).every((field) => field.kind === 'radio'), name).toBe(true);
      expect(optionsOf(doc, jobDivaAdapter), name).toEqual(expected[name]);
      // Undone: the title read for every radio too, so each option is named by its question.
      const titled = optionsOf(doc, recoded(['labelFor']));
      expect(titled.every(([label, , options]) => (options as string[]).every((option) => option === label)), name).toBe(true);
      // Undone: no words of the option's own, so none reads (no label element holds them).
      const wordless = optionsOf(doc, recoded(['optionTextFor']));
      expect(wordless.every(([, , options]) => (options as string[]).every((option) => option === '')), name).toBe(true);
      removeFixtures(document);
    }
  });

  it('JDV-8, JDV-V2: the two EEO steps and the form are three steps; by the heading alone the EEO steps were one',
    async () => {
      const signatureOf = async (name: Capture, adapter: Adapter) => {
        const { doc } = await open(name);
        const signature = hashSignature(adapter.stepSignature!(doc));
        removeFixtures(document);
        return signature;
      };
      const own = [await signatureOf('jr7-jobdiva2-quick-apply', jobDivaAdapter),
        await signatureOf('jr7-jobdiva2-eeo', jobDivaAdapter), await signatureOf('jr7-jobdiva2-veteran', jobDivaAdapter)];
      expect(new Set(own).size).toBe(3);
      const { anchors: _anchors, ...headingOnly } = JOBDIVA_CONFIG.steps!;
      const byHeading = changed({ steps: headingOnly });
      expect(await signatureOf('jr7-jobdiva2-eeo', byHeading)).toBe(await signatureOf('jr7-jobdiva2-veteran', byHeading));
    });

  it('JDV-7, JDV-14: Submit is Submit Application by its words; another button of its class is no Submit', async () => {
    const { doc } = await open('jr7-jobdiva2-quick-apply');
    const root = jobDivaAdapter.detect(doc)!.formRoot;
    const submit = jobDivaAdapter.submitButton!(root)!;
    expect(submit.matches('#quickApplyModal .job-app-btns button.jd-btn-mobile')).toBe(true);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    // The test draws the dialog's button with the cancel dialog's words (its class is Submit's).
    submit.querySelector('span span')!.textContent = 'Yes, cancel application';
    expect(jobDivaAdapter.submitButton!(root)).toBeNull();
    expect(jobDivaAdapter.isFinalStep!(doc)).toBe('unknown');
    // Undone (the words not read): that button would be Submit and the step final.
    const byClass = recoded(['submitButton', 'isFinalStep']);
    expect(byClass.submitButton!(root)).toBe(submit);
    expect(byClass.isFinalStep!(doc)).toBe('final');
    removeFixtures(document);
    const filled = await open('jr7-jobdiva2-quick-apply-filled');
    expect((jobDivaAdapter.submitButton!(jobDivaAdapter.detect(filled.doc)!.formRoot) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('JDV-14: never presses the cancel dialog, the choice\'s account buttons, Back, Cancel, the links or the companion',
    async () => {
      const posting = await open('jr7-jobdiva1-posting');
      const never = jobDivaAdapter.neverPress!(posting.doc.documentElement);
      const byWords = (doc: Document, words: string) => Array.from(doc.querySelectorAll('button, a'))
        .filter((el) => wordsOf(el) === words);
      for (const words of ['Yes, cancel application', 'No, keep going', 'Sign Into My Account', 'Create an Account + Apply',
        'Quick Apply (No Account)', 'Cancel', 'Apply Now', 'Job List', 'Sign In', 'Register With Us', 'Search Jobs']) {
        const found = byWords(posting.doc, words);
        expect(found.length, words).toBeGreaterThan(0);
        for (const el of found) expect(never.includes(el), words).toBe(true);
      }
      expect(never).not.toContain(byWords(posting.doc, 'Submit Application')[0]);
      removeFixtures(document);
      const eeo = await open('jr7-jobdiva2-eeo');
      const eeoNever = jobDivaAdapter.neverPress!(eeo.doc.documentElement);
      expect(eeoNever).toContain(byWords(eeo.doc, 'Back')[0]);
      expect(eeoNever).not.toContain(byWords(eeo.doc, 'Next')[0]);
      removeFixtures(document);
      const done = await open('jr7-jobdiva2-confirmation');
      expect(jobDivaAdapter.neverPress!(done.doc.documentElement)).toContain(byWords(done.doc, 'Return to Open Jobs')[0]);
    });

  it('JDV-7: the entry is Apply Now with no dialog open, Quick Apply (No Account) on the choice, nothing once the form shows',
    async () => {
      const quick = await open('jr7-jobdiva2-quick-apply');
      // Both dialogs show (the choice stays open under Quick Apply): the form decides; nothing is offered.
      expect(jobDivaAdapter.authState!(quick.doc)).toBeNull();
      expect(jobDivaAdapter.entryControl!(quick.doc)).toBeNull();
      // Undone (the open form not read first): the choice's Quick Apply would be offered again over the form.
      const blind = changed({ states: [{ name: 'entry-choice', when: '#applyOptionsModal.show', auth: 'entry-choice',
        from: 'jr7-jobdiva2-choice' }] });
      expect(blind.authState!(quick.doc)).toBe('entry-choice');
      removeFixtures(document);
      const choice = await open('jr7-jobdiva2-choice');
      const clicks: string[] = [];
      choice.doc.addEventListener('click', (event) => {
        clicks.push(wordsOf(event.target as Element));
        event.preventDefault();
      }, true);
      expect(pressEntryChoice(choice.doc, jobDivaAdapter)).toBe('pressed');
      expect(clicks).toEqual(['Quick Apply (No Account)']);
      // Undone (the entry door's exemption): the entry is one of the never-pressed choice buttons, so it is refused.
      expect(pressEntryChoice(choice.doc, recoded(['entryNeverPressed']))).toBe('none');
      expect(clicks).toEqual(['Quick Apply (No Account)']);
    });

  it('JDV-7: the agent\'s entry presses Apply Now, then the choice it draws in place offers Quick Apply (No Account)',
    async () => {
      const { doc } = await open('jr7-jobdiva1-posting');
      const choice = doc.querySelector<HTMLElement>('#applyOptionsModal')!;
      const clicks: string[] = [];
      doc.addEventListener('click', (event) => {
        const words = wordsOf(event.target as Element);
        clicks.push(words);
        event.preventDefault();
        // As the portal does: Apply Now opens the choice in place (jr7-jobdiva1-choice: class show, display block).
        if (words === 'Apply Now') {
          choice.classList.add('show');
          choice.style.display = 'block';
          choice.removeAttribute('aria-hidden');
        }
      }, true);
      const answer = await pressEntry(doc, [jobDivaAdapter], new AbortController().signal, 1_000, 1_000);
      expect(answer.outcome).toBe('pressed');
      expect(clicks).toEqual(['Apply Now', 'Quick Apply (No Account)']);
    }, 20_000);

  it('JDV-V3: busy while a section of the dialog loads; not once it loaded', async () => {
    const loading = await open('jr7-jobdiva1-quick-apply');
    expect(jobDivaAdapter.isBusy!(loading.doc)).toBe(true);
    expect(changed({ busy: [] }).isBusy!(loading.doc)).toBe(false);
  });

  it('JDV-10: the success sign is the dialog\'s cell beside Return to Open Jobs, on the confirmation alone', async () => {
    const { doc } = await open('jr7-jobdiva2-confirmation');
    const [sign] = configuredSuccessSigns(doc, JOBDIVA_CONFIG);
    expect(sign?.matches('#quickApplyModal .col-12.text-center.font-weight-bold')).toBe(true);
    // Its companion required: with Return to Open Jobs gone, no sign.
    const companion = Array.from(doc.querySelectorAll('button')).find((el) => wordsOf(el) === 'Return to Open Jobs')!;
    companion.remove();
    expect(configuredSuccessSigns(doc, JOBDIVA_CONFIG)).toEqual([]);
  });

  it('reads the posting\'s text on the postings', async () => {
    for (const name of ['jr7-jobdiva1-posting', 'jr7-jobdiva2-posting'] as const) {
      const { doc } = await open(name);
      expect(wordsOf(jobDivaAdapter.postingText!(doc)!).length, name).toBeGreaterThan(200);
      removeFixtures(document);
    }
  });
});
