/*
 * The Dayforce adapter on the owner's snapshots of 2026-11-06 (fixtures/dayforce, DESIGN-NEW-ATS §1): each step's hooks
 * and scan held to its hand-written expectations, then each rule held against the same page read without it (the rule
 * undone): the steps and their Next, Submit and busy sign; the radio questions' titles; the dial codes' labels; the
 * Ant selects' box; the drawn radios' and box's chosen state; the uploads, the duplicated résumé id resolved by its
 * section and the parser left out; the reCAPTCHA challenge on Submit, the person's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import candidateInfoExpect from '../../../fixtures/dayforce/candidate-info.expect.json';
import candidateInfoHtml from '../../../fixtures/dayforce/candidate-info.html?raw';
import questionnaireExpect from '../../../fixtures/dayforce/questionnaire.expect.json';
import questionnaireHtml from '../../../fixtures/dayforce/questionnaire.html?raw';
import submitChallengeExpect from '../../../fixtures/dayforce/submit-challenge.expect.json';
import submitChallengeHtml from '../../../fixtures/dayforce/submit-challenge.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause, pageChallenged } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import type { ScanResult, ScannedField } from '../../dom/types';
import { configProblems, configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { DAYFORCE_CONFIG, DAYFORCE_SNAPSHOTS, dayforceAdapter } from './index';

const BASE = 'https://jobs.dayforcehcm.com';
const CASES = [
  { name: 'candidate-info', html: candidateInfoHtml, json: candidateInfoExpect,
    address: `${BASE}/en-US/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual` },
  { name: 'questionnaire', html: questionnaireHtml, json: questionnaireExpect,
    address: `${BASE}/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual&clientNamespace=savealot&careerSiteXRefCode=candidateportal&id=9234&step=1` },
  { name: 'submit-challenge', html: submitChallengeHtml, json: submitChallengeExpect,
    address: `${BASE}/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual&clientNamespace=savealot&careerSiteXRefCode=candidateportal&id=9234&step=2` },
] as const;

type CaseName = (typeof CASES)[number]['name'];

afterEach(() => removeFixtures(document));

async function open(name: CaseName) {
  return loadFixture(document, CASES.find((each) => each.name === name)!.html, SNAPSHOT_VIEWPORT);
}

/** The scan of a case's root with `adapter` (Dayforce's, or one built with a rule undone). */
async function scanWith(name: CaseName, adapter: Adapter = dayforceAdapter): Promise<{ doc: Document; result: ScanResult }> {
  const fixture = await open(name);
  return { doc: fixture.doc, result: scan(dayforceAdapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'dayforce' }) };
}

/** The adapter built from the config with `change` applied (a rule undone). */
const variant = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...DAYFORCE_CONFIG, ...change });

function fieldAt(doc: Document, result: ScanResult, selector: string): ScannedField | undefined {
  const el = doc.querySelector(selector);
  return result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && (target.control === el || target.widget?.element === el || target.members.includes(el as HTMLInputElement));
  });
}

describe('the Dayforce adapter: its hooks and scans on the snapshots', () => {
  it('names each snapshot it was written from, and its config is sound', () => {
    expect(CASES.map((each) => `fixtures/dayforce/${each.name}.html`).sort()).toEqual([...DAYFORCE_SNAPSHOTS].sort());
    expect(configProblems(DAYFORCE_CONFIG)).toEqual([]);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ name, json }) => {
    const fixture = await open(name);
    expect(compareHooks(fixture.doc, dayforceAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES)('$name: the scan of its root is the expectation', async ({ html, json, address }) => {
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter).toBe(dayforceAdapter);
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
  });
});

describe('the steps', () => {
  it('reads each step by its body and the steps bar, Next on the first two, Submit on the last', async () => {
    const seen: unknown[] = [];
    for (const { name } of CASES) {
      const fixture = await open(name);
      const root = dayforceAdapter.detect(fixture.doc)!.formRoot;
      seen.push({ signature: dayforceAdapter.stepSignature!(fixture.doc), final: dayforceAdapter.isFinalStep!(fixture.doc),
        next: dayforceAdapter.nextButton?.(root)?.getAttribute('test-id') ?? null,
        submit: dayforceAdapter.submitButton?.(root)?.getAttribute('test-id') ?? null });
      removeFixtures(document);
    }
    expect(seen).toEqual([
      { signature: { heading: 'Candidate Info', progress: '', anchors: ['application-step-candidateinfo',
        'application-progress-step-Candidate-Info'] }, final: 'not-final', next: 'application-next-step', submit: null },
      { signature: { heading: 'Questionnaire', progress: 'Questionnaire 1 of 1', anchors: ['application-step-questionnaire',
        'application-progress-step-Questionnaire'] }, final: 'not-final', next: 'application-next-step', submit: null },
      { signature: { heading: '', progress: '', anchors: ['application-step-submit', 'application-progress-step-Submit'] },
        final: 'final', next: null, submit: 'application-submit' },
    ]);
  });

  it('is busy while Next shows its loading state (dayforce-0), and not otherwise', async () => {
    const fixture = await open('questionnaire');
    expect(dayforceAdapter.isBusy?.(fixture.doc)).toBe(true);
    fixture.doc.querySelector('button[test-id="application-next-step"]')!.classList.remove('ant-btn-loading');
    expect(dayforceAdapter.isBusy?.(fixture.doc)).toBe(false);
    // The rule undone.
    fixture.doc.querySelector('button[test-id="application-next-step"]')!.classList.add('ant-btn-loading');
    expect(variant({ busy: [] }).isBusy?.(fixture.doc)).toBe(false);
  });

  it("hands Submit's reCAPTCHA image challenge to the person (dayforce-1), and holds every press while it shows", async () => {
    const fixture = await open('submit-challenge');
    expect(detectPause(fixture.doc, null, dayforceAdapter)).toEqual({ kind: 'captcha', evidence: 'captcha-frame' });
    expect(pageChallenged(fixture.doc)).toBe(true);
    // Before Submit (dayforce-2) the invisible badge pauses nothing.
    removeFixtures(document);
    const before = await open('candidate-info');
    expect(detectPause(before.doc, null, dayforceAdapter)).toBeNull();
  });
});

describe('labels, widgets and uploads', () => {
  it("titles each radio question by its label in the li's fieldset, its legend being drawn off-screen (dayforce-0)", async () => {
    const { doc, result } = await scanWith('questionnaire');
    const name = 'input[name="sections,0,questionnaire,questions,4,selectedOption"]';
    expect(fieldAt(doc, result, name)).toMatchObject({ kind: 'radio', label: 'Were you referred by a current Team Member?',
      labelSource: 'adapter', visibility: 'hidden-native-with-visible-label' });
    // The rule undone (the code's label hook falls back to the rules, so both go).
    const plain = await scanWith('questionnaire', variant({ questions: [], code: undefined }));
    expect(fieldAt(plain.doc, plain.result, name)).toMatchObject({ label: '', labelSource: 'none' });
  });

  it('reads a drawn radio and the acknowledgement as their wrappers show them chosen (dayforce-0, -1)', async () => {
    const fixture = await open('questionnaire');
    const yes = fixture.doc.querySelector<HTMLInputElement>('input[name="sections,0,questionnaire,questions,4,selectedOption"]')!;
    expect(dayforceAdapter.checkedOf?.(yes)).toBe(false);
    yes.closest('label')!.classList.add('ant-radio-wrapper-checked');
    expect(dayforceAdapter.checkedOf?.(yes)).toBe(true);
    // The rule undone: the input's own checked, which Ant leaves to React.
    expect(variant({ checked: [] }).checkedOf?.(yes) ?? null).toBeNull();
    removeFixtures(document);
    const submit = await open('submit-challenge');
    const box = submit.doc.querySelector<HTMLInputElement>('#jobPostingApplication_userAcknowledged')!;
    box.closest('label')!.classList.add('ant-checkbox-wrapper-checked');
    expect(dayforceAdapter.checkedOf?.(box)).toBe(true);
  });

  it("labels each dial code by its phone's label and \"country code\" (dayforce-2)", async () => {
    const { doc, result } = await scanWith('candidate-info');
    expect(fieldAt(doc, result, '#rc_select_5')).toMatchObject({ kind: 'combobox', label: 'Mobile Phone Number country code',
      labelSource: 'adapter' });
    const plain = await scanWith('candidate-info', variant({ code: undefined }));
    expect(fieldAt(plain.doc, plain.result, '#rc_select_5')?.label).toBe('Country dialing code');
  });

  it('shows a select-only Ant select by its selector while its readonly box is drawn at opacity 0 (dayforce-2)', async () => {
    const { doc, result } = await scanWith('candidate-info');
    const source = fieldAt(doc, result, '#jobPostingApplication_personalInfo_candidateSource')!;
    expect([source.kind, source.required, source.readOnly, source.visibility]).toEqual(['combobox', true, false, 'visible']);
    expect(result.target(source.key)?.widget).toMatchObject({ declared: true, readOnlyBox: true,
      opener: doc.querySelector('#jobPostingApplication_personalInfo_candidateSource')!.closest('.ant-select-selector') });
    // The rule undone: an opacity-0 readonly box is a hidden control.
    const plain = await scanWith('candidate-info', variant({ widgets: [] }));
    expect(fieldAt(plain.doc, plain.result, '#jobPostingApplication_personalInfo_candidateSource')).toBeUndefined();
  });

  it('pairs each upload with its section, the résumé apart from the parser that shares its id (dayforce-2)', async () => {
    const fixture = await open('candidate-info');
    const root = dayforceAdapter.detect(fixture.doc)!.formRoot;
    const inputs = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('#jobPostingApplication_files_resume'));
    expect(inputs).toHaveLength(2);
    const [parser, resume] = inputs as [HTMLInputElement, HTMLInputElement];
    expect(dayforceAdapter.uploadWidgets?.(root).map((each) => [each.input.id, each.control.getAttribute('test-id')])).toEqual([
      ['jobPostingApplication_files_resume', 'resume-upload-button'],
      ['jobPostingApplication_files_coverLetter', 'cover-letter-upload-button'],
      ['jobPostingApplication_files_additionalDocument', 'additional-documents-upload-button']]);
    expect(dayforceAdapter.uploadWidgets?.(root)[0]?.input).toBe(resume);
    expect(dayforceAdapter.excluded?.(root)).toEqual([fixture.doc.querySelector('div[test-id="import-resume-section"]')]);
    expect(dayforceAdapter.excluded?.(root)[0]?.contains(parser)).toBe(true);
    // The résumé's list shows a file the page took (uploadHeld): on the untouched page no file of the run's is
    // confirmed (the behaviour review, M2), only one the done item names; the cover letter declares no sign (its
    // input's own files decide).
    expect(dayforceAdapter.uploadHeld?.(resume)).toBe(true);
    expect(dayforceAdapter.uploadState?.(resume, 'x.pdf')).toBe('pending');
    const item = resume.closest('section')!.querySelector('.ant-upload-list-item-done')!;
    item.querySelector('span.ant-upload-list-item-name')!.textContent = 'x.pdf';
    expect(dayforceAdapter.uploadState?.(resume, 'x.pdf')).toBe('confirmed');
    expect(dayforceAdapter.uploadState?.(resume, 'y.pdf')).toBe('pending');
    item.classList.remove('ant-upload-list-item-done');
    expect(dayforceAdapter.uploadState?.(resume, 'x.pdf')).toBe('pending');
    expect(dayforceAdapter.uploadHeld?.(resume)).toBe(false);
    expect(dayforceAdapter.uploadState?.(fixture.doc.querySelector<HTMLInputElement>('#jobPostingApplication_files_coverLetter')!,
      'x.pdf')).toBeNull();
    // The label[for] names the parser's input, the first of the id: the résumé input is titled by its section.
    expect(resume.labels).toHaveLength(0);
    expect(dayforceAdapter.labelFor?.(resume)?.textContent).toBe('Resume Upload');
    // The rule undone: without the parser excluded, its input is a field labelled "Attachment:".
    const scanned = scan(root, variant({ excluded: [] }), { platform: 'dayforce' });
    expect(scanned.fields.some((field) => field.kind === 'file' && field.label === 'Attachment')).toBe(true);
  });

  it('never presses Cancel, Import Resume, Update, a record\'s Edit or Delete, or Remove file (dayforce-2)', async () => {
    const fixture = await open('candidate-info');
    const never = dayforceAdapter.neverPress!(fixture.doc.body);
    for (const selector of ['button[test-id="application-cancel"]', 'button[test-id="import-resume-section-button"]',
      'button[test-id="personal-info-update-button"]', 'button[test-id="educationHistory-edit-button"]',
      'button[test-id="workHistory-delete-button"]', 'button[title="Remove file"]']) {
      for (const el of Array.from(fixture.doc.querySelectorAll(selector))) expect(never, selector).toContain(el);
    }
    expect(never).not.toContain(fixture.doc.querySelector('button[test-id="application-next-step"]'));
  });
});
