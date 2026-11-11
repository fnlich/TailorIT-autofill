/*
 * jr6 ULTIPRO P1 (FIXPLAN §6.10; the audit SP\jr6\audit\ultipro.md, whose harness these asserts replace): UltiPro's
 * adapter parts on the owner's three snapshots (fixtures/ultipro: register [ultipro-2], resume-review [ultipro-1],
 * application [ultipro-0]), each rule held against the same page read without it (the rule undone). Outcomes are
 * measured with the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants built here; the review's
 * parsed entries, a degree list, skill chips and a profile start date are synthetic stand-ins written into the page in
 * the test, never the owner's values.
 * - the pages as the step machine reads them (the harness's per-page table), and the addresses;
 * - U-01: the review's Work Experience and Education blocks, Add never offered, each block's Delete never pressed, and
 *   the planner finding each parsed entry by its fingerprint;
 * - U-02: a From box whose own label is the part word alone, labelled by its group first;
 * - U-04: School Name and Degree as typeahead.js searches (School's free text, Degree's page list);
 * - U-05: the Skills box as a box of several answers (its chips, its row's Add);
 * - U-06 (now part): the résumé parser's upload and its saved résumés, no field;
 * - U-07: the start date as one date in three parts, planned and written as one;
 * - U-09: the EEO "I decline to say" boxes labelled by their list's question;
 * - U-12: the uploaded documents' rows, no field;
 * - U-16: the phone boxes' national layout;
 * - apply-path C3: the application drawn late is waited for, 30 s.
 * What needs ENGINE E1 to E3 or RULES' new rules (the free text kept, the tags filled, the period boxes' dates, the
 * decline boxes ticked, the national number in the scan) is P2's: SP\jr6\build\ULTIPRO.md lists it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import applicationHtml from '../../../fixtures/ultipro/application.html?raw';
import registerHtml from '../../../fixtures/ultipro/register.html?raw';
import resumeReviewHtml from '../../../fixtures/ultipro/resume-review.html?raw';
import { lateAdapters, lateFormMs, LATE_FORM_CAP_MS, watchForLateForm } from '../../content/late-form';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import { phoneText } from '../../core/resolver/format';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { fillDateParts } from '../../dom/fillers/date-parts';
import { removeFixtures } from '../../dom/fixture.testkit';
import { startDeadline } from '../../dom/time';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, ScannedField } from '../../dom/types';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { scanCase, type ScannedCase } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { pageDegreeOptions, ULTIPRO_CONFIG, ULTIPRO_PHONE_PATTERN, ULTIPRO_TYPEAHEAD_EMPTY_MS, ultiproAdapter } from './index';
import { parseUltiproUrl } from './url';

const APPLY = 'https://recruiting.ultipro.com/cam1010csii/JobBoard/54a25c3a-e399-42b0-a553-16ed056e0517/OpportunityApply?opportunityId=772ddf9d-79f1-4752-bf3b-688ded6980c7';
const REGISTER = 'https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F54a25c3a-e399-42b0-a553-16ed056e0517%2FOpportunityApply%3FopportunityId%3D772ddf9d-79f1-4752-bf3b-688ded6980c7%7Cta%3DCAM1010CSII';
const DETAIL = APPLY.replace('OpportunityApply', 'OpportunityDetail');

const REVIEW = 'div[data-bind="if: isParsingResume()"]';
const PAGES = { register: { html: registerHtml, address: REGISTER }, 'resume-review': { html: resumeReviewHtml, address: APPLY },
  application: { html: applicationHtml, address: APPLY } } as const;
type PageName = keyof typeof PAGES;

afterEach(() => removeFixtures(document));

/** The page at its own address, its root found by the adapter the registry offers first (expectations.testkit). */
const open = (name: PageName): Promise<ScannedCase> => scanCase(document, PAGES[name].html, PAGES[name].address);

/** The adapter with some of its hooks taken away (a rule undone). */
function without(...hooks: Array<keyof Adapter>): Adapter {
  const copy: Partial<Adapter> = { ...ultiproAdapter };
  for (const hook of hooks) delete copy[hook];
  return copy as Adapter;
}

const rescan = (page: ScannedCase, adapter: Adapter = ultiproAdapter): ScanResult =>
  scan(page.root, adapter, { platform: 'ultipro' });

/** The field whose control, widget or member is the element `selector` names (open shadow roots included via `el`). */
function fieldOf(result: ScanResult, el: Element | null): ScannedField | undefined {
  return result.fields.find((field) => {
    const target = result.target(field.key);
    return target !== null && el !== null && (target.control === el || target.widget?.element === el
      || target.members.includes(el as HTMLInputElement));
  });
}

/** The fields whose control sits inside `scope` (open shadow roots included). */
function fieldsIn(result: ScanResult, scope: Element): ScannedField[] {
  return result.fields.filter((field) => {
    const control = result.target(field.key)?.control;
    if (control === undefined) return false;
    for (let at: Node | null = control; at !== null; at = at.parentNode ?? (at as ShadowRoot).host ?? null) {
      if (at === scope) return true;
    }
    return false;
  });
}

/** planFrame over a scan with the golden profile (or a variant) and the default settings, as the worker plans it. */
function planned(result: ScanResult, profile: Profile = goldenProfile()): PlanOutput {
  return planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW, posting: { company: 'Example Employer' },
    repeatables: [{ kind: 'experience', entries: null }, { kind: 'education', entries: null }] });
}

describe('jr6 UltiPro: the pages as the step machine reads them (the audit harness, as asserts)', () => {
  it('the account step: its form, no Next, its Create account the sign-in container\'s button (ultipro-2)', async () => {
    const page = await open('register');
    expect(page.adapter).toBe(ultiproAdapter);
    expect(page.root).toBe(page.doc.querySelector('form#registrationDetailsForm'));
    expect(ultiproAdapter.stepSignature?.(page.doc)).toEqual({ anchors: ['state:register'] });
    expect(ultiproAdapter.isFinalStep?.(page.doc)).toBe('not-final');
    expect(ultiproAdapter.nextButton?.(page.root)).toBeNull();
    expect(ultiproAdapter.signInContainer?.(page.doc)).toMatchObject({ email: null, password: null,
      container: page.root });
    expect(page.result.fields.map((field) => field.label)).toEqual(['First name', 'Last name', 'Phone number']);
    expect(ultiproAdapter.repeatables?.(page.root)).toEqual([]);
  });

  it('the résumé review: its own root, "Save and continue" its Next, Submit the host (ultipro-1)', async () => {
    const page = await open('resume-review');
    expect(page.root).toBe(page.doc.querySelector(REVIEW));
    expect(ultiproAdapter.stepSignature?.(page.doc)).toEqual({ anchors: ['state:review'] });
    expect(ultiproAdapter.isFinalStep?.(page.doc)).toBe('not-final');
    expect(ultiproAdapter.nextButton?.(page.root)?.textContent).toBe('Save and continue');
    expect(ultiproAdapter.submitButton?.(page.root)?.getAttribute('data-automation')).toBe('btn-submit');
    expect(ultiproAdapter.sections?.(page.root).map((section) => section.label)).toEqual(['Contact Information',
      'Work Experience', 'Education', 'Skills']);
    expect(page.result.fields).toHaveLength(69);
  });

  it('the application: one final page, no Next, Submit the host, no error shown (ultipro-0)', async () => {
    const page = await open('application');
    expect(page.root).toBe(page.doc.querySelector('#OpportunityApply'));
    expect(ultiproAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(ultiproAdapter.nextButton?.(page.root)).toBeNull();
    expect(ultiproAdapter.submitButton?.(page.root)?.localName).toBe('ukg-button');
    expect(ultiproAdapter.errors?.(page.root)).toEqual([]);
    expect(ultiproAdapter.uploadWidgets?.(page.root)).toEqual([]);
    expect(page.result.fields).toHaveLength(32);
  });

  it('the addresses: the posting parses as one (no Apply declared: apply-path C2 waits for a capture), the hosts', () => {
    const detail = new URL(DETAIL);
    expect(parseUltiproUrl(detail)).toMatchObject({ page: 'posting',
      applicationUrl: ultiproAdapter.canonicalApplicationUrl(new URL(APPLY)) });
    expect(ultiproAdapter.canonicalApplicationUrl(detail)).toBeNull();
    expect(ULTIPRO_CONFIG.posting).toBeUndefined();
    for (const host of ['recruiting2.ultipro.com', 'recruiting.ultipro.ca', 'acme.rec.pro.ukg.net']) {
      const other = new URL(APPLY.replace('recruiting.ultipro.com', host));
      expect(ultiproAdapter.matchesUrl(other), host).toBe(true);
      expect(parseUltiproUrl(other)?.page, host).toBe('application');
    }
    expect(ultiproAdapter.matchesUrl(new URL(APPLY.replace('recruiting.ultipro.com', 'n12.ultipro.com')))).toBe(false);
  });
});

describe('U-01: the review\'s parsed entries are blocks, matched by their fingerprint', () => {
  /** Synthetic stand-ins for a parse of three jobs (never the owner's): the golden profile's two jobs, then one the
   *  profile does not hold. */
  const PARSED = [['Senior Software Engineer', 'Quillfeather Labs', 'Austin, TX'], ['Software Engineer', 'Marrowgate Systems', ''],
    ['Intern', 'Northwind Traders', 'Dallas, TX']] as const;

  function parse(doc: Document): void {
    for (const [index, [title, company, place]] of PARSED.entries()) {
      const block = doc.querySelector(`${REVIEW} [aria-label="Work Experience ${index + 1}"]`)!;
      (block.querySelector('[data-automation="job-title-textbox"]') as HTMLInputElement).value = title;
      (block.querySelector('[data-automation="company-textbox"]') as HTMLInputElement).value = company;
      (block.querySelector('[data-automation="location-textbox"]') as HTMLInputElement).value = place;
    }
  }

  it('declares Work Experience and Education, their blocks the panel-list-items; Add never offered (Q1)', async () => {
    const page = await open('resume-review');
    const sections = ultiproAdapter.repeatables!(page.root);
    expect(sections.map((section) => section.kind)).toEqual(['experience', 'education']);
    const [experience, education] = sections;
    expect(experience!.blocks().map((block) => block.getAttribute('aria-label'))).toEqual(['Work Experience 1',
      'Work Experience 2', 'Work Experience 3']);
    expect(education!.blocks().map((block) => block.getAttribute('aria-label'))).toEqual(['Education 1']);
    // The panels' Add shows, and is still never offered: adding to the parser's entries waits for owner question Q1.
    const add = page.doc.querySelector<HTMLElement>(`${REVIEW} button[data-automation="primary-action-button"][aria-label="Add Experience"]`)!;
    expect(add.checkVisibility()).toBe(true);
    expect(experience!.addButton()).toBeNull();
    expect(education!.addButton()).toBeNull();
    // None in the application layout, whose entries are summaries (U-03, deferred).
    expect(ultiproAdapter.repeatables!((await open('application')).root)).toEqual([]);
  });

  it("each block's Delete is its removeButton, and stays never pressed", async () => {
    const page = await open('resume-review');
    const [experience] = ultiproAdapter.repeatables!(page.root);
    const never = ultiproAdapter.neverPress!(page.doc.body);
    for (const [index, block] of experience!.blocks().entries()) {
      const remove = experience!.removeButton!(block);
      expect(remove?.getAttribute('aria-label')).toBe(`Delete Work Experience ${index + 1}`);
      expect(never).toContain(remove);
    }
    const block = experience!.blocks()[0]!;
    (block.querySelector('button[data-automation="remove-button"]') as HTMLElement).style.display = 'none';
    expect(experience!.removeButton!(block)).toBeNull();
  });

  it('sections each entry\'s fields by its block', async () => {
    const page = await open('resume-review');
    const titles = page.result.fields.filter((field) => field.label === 'Job Title');
    expect(titles.map((field) => field.section)).toEqual([{ id: 'experience', block: 0 }, { id: 'experience', block: 1 },
      { id: 'experience', block: 2 }]);
    expect(page.result.fields.find((field) => field.label === 'School Name')?.section).toEqual({ id: 'education', block: 0 });
    // The rule undone: one section, no block.
    const plain = rescan(page, without('repeatables'));
    expect(plain.fields.filter((field) => field.label === 'Job Title').map((field) => field.section))
      .toEqual([{ id: 'work-experience' }, { id: 'work-experience' }, { id: 'work-experience' }]);
  });

  it('the planner fills each parsed entry from its own profile entry, never job 1 into every block', async () => {
    const page = await open('resume-review');
    parse(page.doc);
    const result = rescan(page);
    const plan = planned(result);
    const rows = (label: string) => result.fields.filter((field) => field.label === label)
      .map((field) => ({ row: plan.results.find((each) => each.key === field.key),
        write: plan.writes.find((each) => each.key === field.key) }));
    const titles = rows('Job Title');
    // Block 1 holds job 1, block 2 job 2 (already correct, kept); block 3 holds a job the profile does not: unwritten.
    expect(titles.map(({ row }) => row?.reason)).toEqual(['already-correct', 'already-correct', 'no-profile-value']);
    expect(titles.every(({ write }) => write === undefined)).toBe(true);
    expect(rows('Company / Organization').every(({ write }) => write === undefined)).toBe(true);
    // Each entry's own Location and Description: block 2's job has no location in the profile, so its box is kept.
    expect(rows('Location').map(({ row }) => `${row?.category}/${row?.reason}`)).toEqual(['experience.location/already-correct',
      'experience.location/no-profile-value', 'experience.location/no-profile-value']);
    const descriptions = rows('Description').filter(({ row }) => row?.category === 'experience.description');
    expect(descriptions.map(({ write }) => (write?.value.kind === 'text' ? write.value.text.split('.')[0] : null)))
      .toEqual(['Leads the Quillfeather ledger platform team', 'Built the Marrowgate billing service', null]);
    // The rule undone (no blocks): job 1's title and company over jobs 2 and 3 (prefill-conflict), the person's current
    // place over each job's.
    const plain = rescan(page, without('repeatables'));
    const plainPlan = planned(plain);
    const plainTitles = plain.fields.filter((field) => field.label === 'Job Title')
      .map((field) => plainPlan.writes.find((each) => each.key === field.key)?.value);
    expect(plainTitles).toEqual([undefined, { kind: 'text', text: 'Senior Software Engineer' },
      { kind: 'text', text: 'Senior Software Engineer' }]);
  });
});

describe('U-02: a From box whose own label is the part word alone', () => {
  it('reads "From Month" and "From Year (YYYY)", its group\'s label first (label contract §3.2)', async () => {
    const page = await open('resume-review');
    const block = page.doc.querySelector(`${REVIEW} [aria-label="Work Experience 1"]`)!;
    const labelOf = (selector: string) => fieldOf(page.result, block.querySelector(selector));
    expect(labelOf('[data-automation="from-month-dropdown"]')).toMatchObject({ label: 'From Month', labelSource: 'adapter',
      labelVisible: true });
    expect(labelOf('[data-automation="from-year-textbox"]')).toMatchObject({ label: 'From Year (YYYY)', labelSource: 'adapter' });
    expect(labelOf('[data-automation="to-month-dropdown"]')?.label).toBe('To Month');
    expect(labelOf('[data-automation="to-year-textbox"]')?.label).toBe('To Year (YYYY)');
    const education = page.doc.querySelector(`${REVIEW} [aria-label="Education 1"]`)!;
    expect(fieldOf(page.result, education.querySelector('[data-automation="from-month-dropdown"]'))?.label).toBe('From Month');
    // Every period box of the review reads its group and its part.
    expect(page.result.fields.filter((field) => /^(?:Month|Year \(YYYY\))$/.test(field.label))).toEqual([]);
    // The rule undone: the box's own label[for] stands, the bare part word.
    const plain = rescan(page, without('labelFirst'));
    expect(fieldOf(plain, block.querySelector('[data-automation="from-month-dropdown"]'))?.label).toBe('Month');
    expect(fieldOf(plain, block.querySelector('[data-automation="from-year-textbox"]'))?.label).toBe('Year (YYYY)');
  });

  it('a From box whose own label says more than the part word keeps it', async () => {
    const page = await open('resume-review');
    const box = page.doc.querySelector(`${REVIEW} [aria-label="Work Experience 1"] [data-automation="from-month-dropdown"]`)!;
    expect(ultiproAdapter.labelFirst?.(box)).toBe(true);
    box.labels?.[0]?.replaceChildren('Start month of this job');
    expect(ultiproAdapter.labelFirst?.(box)).toBe(false);
    expect(ultiproAdapter.labelFor?.(box)).toBeNull();
    expect(fieldOf(rescan(page), box)?.label).toBe('Start month of this job');
  });
});

describe('U-04: School Name and Degree are typeahead.js searches', () => {
  it('declares each with its suggestions list; School keeps its typed text, Degree does not', async () => {
    const page = await open('resume-review');
    const block = page.doc.querySelector(`${REVIEW} [aria-label="Education 1"]`)!;
    const school = block.querySelector<HTMLInputElement>('[data-automation="school-textbox"]')!;
    const degree = block.querySelector<HTMLInputElement>('[data-automation="degree-textbox"]')!;
    for (const [box, free] of [[school, true], [degree, false]] as const) {
      const decl = ultiproAdapter.widgetFor!(box)!;
      const list = box.parentElement!.querySelector(':scope > span.tt-dropdown-menu[role="listbox"]');
      expect(list).not.toBeNull();
      expect(decl).toMatchObject({ kind: 'typeahead-remote', opener: box, emptyAfterMs: ULTIPRO_TYPEAHEAD_EMPTY_MS,
        results: { list, option: '.tt-suggestion' } });
      expect(decl.freeText === true).toBe(free);
      expect(decl.knownOptions).toBeUndefined();
      // The scan: a declared search on the box itself, fillable by the widget helpers.
      const field = fieldOf(page.result, box)!;
      expect(field).toMatchObject({ kind: 'typeahead-remote', required: true, section: { id: 'education', block: 0 } });
      expect(page.result.target(field.key)?.widget).toMatchObject({ declared: true, input: box });
    }
    expect(ULTIPRO_TYPEAHEAD_EMPTY_MS).toBe(1_000);
    // The rule undone: undeclared comboboxes no helper acts on (widget-phase-4 in the audit).
    const plain = rescan(page, without('widgetFor'));
    for (const box of [school, degree]) expect(plain.target(fieldOf(plain, box)!.key)?.widget?.declared).toBe(false);
  });

  it('no other typeahead is taken for a school or a degree (the Skills box, role combobox in the application layout)',
    async () => {
    const page = await open('application');
    const skills = page.doc.querySelector('input[data-automation="item-typeahead"][role="combobox"]')!;
    expect(skills.classList.contains('tt-input')).toBe(true);
    expect(ultiproAdapter.widgetFor!(skills)?.tags).toBeDefined();
    expect(ultiproAdapter.widgetFor!(skills)?.results).toBeUndefined();
    // A school box with no suggestions list beside it is none.
    const review = await open('resume-review');
    const school = review.doc.querySelector<HTMLInputElement>(`${REVIEW} [data-automation="school-textbox"]`)!;
    school.parentElement!.querySelector('span.tt-dropdown-menu')!.remove();
    expect(ultiproAdapter.widgetFor!(school)).toBeNull();
  });

  it("Degree takes the page's own degree list where a script publishes it for that box (knownOptions)", async () => {
    const page = await open('resume-review');
    const degree = page.doc.querySelector<HTMLInputElement>(`${REVIEW} [data-automation="degree-textbox"]`)!;
    expect(degree.getAttribute('data-bind')).toMatch(/\bsource\s*:\s*[\w$.[\]]*\bdegreeOptions\b/);
    // The fixture holds no script (the converter keeps none): a synthetic one stands for the page's.
    const script = page.doc.createElement('script');
    script.type = 'text/plain';
    script.textContent = 'var schoolOptions = [];\nvar degreeOptions = [{"Id":1,"Name":"High School Diploma"},'
      + '{"Id":2,"Name":" Bachelor\'s  Degree "},{"Id":3,"Name":"Master\'s Degree"},{"Id":4,"Name":"Bachelor\'s Degree"},'
      + '{"Id":5},{"Id":6,"Name":""}];\nvar other = 1;';
    page.doc.body.append(script);
    expect(pageDegreeOptions(degree)).toEqual(['High School Diploma', "Bachelor's Degree", "Master's Degree"]);
    expect(ultiproAdapter.widgetFor!(degree)).toMatchObject({ kind: 'combobox',
      knownOptions: ['High School Diploma', "Bachelor's Degree", "Master's Degree"] });
    // School never takes it; a box whose source names another list neither; a list that is no JSON gives none.
    const school = page.doc.querySelector<HTMLInputElement>(`${REVIEW} [data-automation="school-textbox"]`)!;
    expect(pageDegreeOptions(school)).toEqual([]);
    expect(ultiproAdapter.widgetFor!(school)?.knownOptions).toBeUndefined();
    script.textContent = "var degreeOptions = [{Name: 'Doctorate'}];";
    expect(pageDegreeOptions(degree)).toEqual([]);
    expect(ultiproAdapter.widgetFor!(degree)?.kind).toBe('typeahead-remote');
  });
});

describe('U-05: the review\'s Skills box takes several skills, one at a time', () => {
  it('declares its chips (the skills it shows) and its row\'s Add', async () => {
    const page = await open('resume-review');
    const box = page.doc.querySelector<HTMLInputElement>(`${REVIEW} input[data-automation="item-typeahead"]`)!;
    const decl = ultiproAdapter.widgetFor!(box)!;
    expect(decl).toMatchObject({ kind: 'typeahead-remote', opener: box });
    expect(decl.tags).toBeDefined();
    const chips = page.doc.querySelectorAll(`${REVIEW} strong[data-automation="skill-label"]`);
    expect(chips).toHaveLength(20);
    expect(decl.tags!.chips()).toEqual(Array.from(chips));
    const add = box.closest('div.form-inline')!.querySelector('button[data-automation="item-add-button"]');
    expect(decl.tags!.add!()).toBe(add);
    expect(decl.tags!.search).toBeUndefined();
    // A chip a person cannot see is none; a chip drawn later is counted.
    (chips[0]!.closest('[data-automation="selected-item"]') as HTMLElement).style.display = 'none';
    expect(decl.tags!.chips()).toHaveLength(19);
    // Its Add hidden: none.
    (add as HTMLElement).style.display = 'none';
    expect(decl.tags!.add!()).toBeNull();
    // The field: still the Skills panel's, labelled by its heading.
    expect(fieldOf(page.result, box)).toMatchObject({ label: 'Skills', section: { id: 'skills' }, required: true });
  });

  it('a typeahead outside the Skills panel is no box of several answers', async () => {
    const page = await open('resume-review');
    const box = page.doc.querySelector<HTMLInputElement>(`${REVIEW} input[data-automation="item-typeahead"]`)!;
    box.closest('div[aria-label="Skills"]')!.setAttribute('aria-label', 'Behaviors');
    expect(ultiproAdapter.widgetFor!(box)).toBeNull();
  });
});

describe('U-06 (now part, Decision 16): the résumé parser holds no field', () => {
  /** Shows the parser's area, as the page does until a résumé is parsed (ultipro-0: its visible binding). */
  function showParser(doc: Document): HTMLElement {
    const area = doc.querySelector('#section-header-resumeParsingUploader')!.parentElement!.parentElement as HTMLElement;
    area.style.removeProperty('display');
    return area;
  }

  it('neither its upload nor its saved résumés, while the review inside it stays the review\'s', async () => {
    const page = await open('application');
    const area = showParser(page.doc);
    const parser = page.doc.querySelector('#ResumeParsingUploader')!;
    const upload = parser.querySelector('input[type="file"][data-automation="upload-file-input"]')!;
    const saved = page.doc.querySelector('select[data-automation="existing-resume-selector"]')!;
    expect(area.checkVisibility()).toBe(true);
    const excluded = ultiproAdapter.excluded!(page.root);
    expect(excluded.some((part) => part.contains(upload))).toBe(true);
    expect(excluded).toContain(saved);
    expect(excluded.some((part) => part.matches(REVIEW) || part.contains(page.doc.querySelector(REVIEW)))).toBe(false);
    const result = rescan(page);
    expect(fieldsIn(result, parser)).toEqual([]);
    // The rule undone: the parser's upload is a résumé field, its saved résumés a list asked of the AI.
    const plain = rescan(page, { ...ultiproAdapter, excluded: undefined });
    expect(fieldsIn(plain, parser).map((field) => field.kind).sort()).toEqual(['file', 'select']);
  });

  it('the review state, its root inside the parser\'s container, keeps every field (ultipro-1)', async () => {
    const page = await open('resume-review');
    expect(page.doc.querySelector('#ResumeParsingUploader')!.contains(page.root)).toBe(true);
    expect(ultiproAdapter.excluded!(page.root)).toEqual([]);
    expect(page.result.fields).toHaveLength(rescan(page, { ...ultiproAdapter, excluded: undefined }).fields.length);
  });
});

describe('U-07: the start date is one date drawn in three parts', () => {
  const host = (doc: Document) => doc.querySelector('ukg-date-input-text[role="group"]')!;
  const part = (doc: Document, name: string) =>
    host(doc).shadowRoot!.querySelector<HTMLInputElement>(`input[data-automation="ukg-date-input-text-${name}"]`)!;

  it('declares the component a date, its shadow boxes its parts in their order, typed digit by digit', async () => {
    const page = await open('application');
    expect(ultiproAdapter.dateFor!(host(page.doc))).toEqual({ parts: [
      { part: 'month', input: part(page.doc, 'month'), display: null },
      { part: 'day', input: part(page.doc, 'day'), display: null },
      { part: 'year', input: part(page.doc, 'year'), display: null }], keys: 'digits', snapshot: 'ultipro-0' });
    expect(ultiproAdapter.dateFor!(part(page.doc, 'month'))).toBeNull();
    for (const name of ['month', 'day', 'year']) expect(ultiproAdapter.excluded!(page.root)).toContain(part(page.doc, name));
    // The box around it: its datepicker container (ENGINE E2 reads it as the drawn box only where it shows one; this
    // capture holds none of UKG's component styles, so the component reads camouflaged here: P2 stages a border).
    expect(ultiproAdapter.controlBox!(host(page.doc))).toBe(page.doc.querySelector(
      'ukg-input-container[data-automation="ukg-datepicker-container"]'));
    expect(ultiproAdapter.controlBox!(part(page.doc, 'month'))).toBeNull();
    expect(ultiproAdapter.controlBox!(page.doc.querySelector('select#Gender')!)).toBeNull();
  });

  it('scans one required date field labelled by the start-date question, no field per box', async () => {
    const page = await open('application');
    const dates = page.result.fields.filter((field) => field.label.startsWith('When can you start?'));
    expect(dates).toHaveLength(1);
    expect(dates[0]).toMatchObject({ kind: 'date', label: 'When can you start? (MM/DD/YYYY)', labelSource: 'adapter',
      labelVisible: true, required: true, section: { id: 'questions' }, constraints: { format: 'date' } });
    expect(page.result.target(dates[0]!.key)?.control).toBe(host(page.doc));
    // The rule undone: three boxes, each a text field of its own.
    const plain = rescan(page, without('dateFor', 'excluded'));
    expect(fieldsIn(plain, host(page.doc)).map((field) => field.kind)).toEqual(['text', 'text', 'text']);
  });

  it('a profile start date is planned as one date and written into the three boxes', async () => {
    const page = await open('application');
    const golden = goldenProfile();
    const profile: Profile = { ...golden, preferences: { ...golden.preferences,
      startDate: { kind: 'date', date: { y: 2026, m: 12, d: 7 } } } };
    const date = page.result.fields.find((field) => field.kind === 'date')!;
    const write = planned(page.result, profile).writes.find((each) => each.key === date.key);
    expect(write?.value).toEqual({ kind: 'date', iso: '2026-12-07' });
    const outcome = await fillDateParts(page.result.target(date.key)!, '2026-12-07', { adapter: ultiproAdapter,
      root: page.root });
    expect(outcome).toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(['month', 'day', 'year'].map((name) => part(page.doc, name).value)).toEqual(['12', '07', '2026']);
  });
});

describe('U-09: each "I decline to say" box is labelled by its list\'s question (label contract §3.2)', () => {
  const BOXES = [['gender-decline-checkbox', 'Gender', 'Gender'], ['ethnic-origin-decline-checkbox', 'Ethnic Origin', 'HispanicOrigin'],
    ['race-decline-checkbox', 'Race', 'EthnicOrigin'],
    ['us-federal-contractor-question-decline-checkbox', 'Are you a protected veteran?', 'USFederalContractor']] as const;

  it('reads "<question> I decline to say", in its list\'s section, optional', async () => {
    const page = await open('application');
    for (const [automation, question, select] of BOXES) {
      const box = page.doc.querySelector(`#CountryQuestions input[data-automation="${automation}"]`)!;
      expect(ultiproAdapter.labelFor!(box)).toBe(page.doc.querySelector(`label.control-label[for="${select}"]`));
      expect(fieldOf(page.result, box)).toMatchObject({ kind: 'checkbox', label: `${question} I decline to say`,
        labelSource: 'adapter', labelVisible: true, required: false, section: { id: 'questions' } });
      expect(fieldOf(page.result, page.doc.querySelector(`select#${select}`))?.label).toBe(question);
    }
    // The rule undone: each box is its own label's words alone.
    const plain = rescan(page, without('labelFirst'));
    for (const [automation] of BOXES) {
      expect(fieldOf(plain, page.doc.querySelector(`input[data-automation="${automation}"]`))?.label).toBe('I decline to say');
    }
  });

  it('a box outside the country questions, or beside no list, keeps its own label', async () => {
    const page = await open('application');
    const box = page.doc.querySelector('input[data-automation="gender-decline-checkbox"]')!;
    page.doc.querySelector('select#Gender')!.removeAttribute('id');
    expect(ultiproAdapter.labelFor!(box)).toBeNull();
    expect(ultiproAdapter.labelFirst!(box)).toBe(false);
    const race = page.doc.querySelector('input[data-automation="race-decline-checkbox"]')!;
    page.doc.querySelector('#CountryQuestions')!.removeAttribute('id');
    expect(ultiproAdapter.labelFirst!(race)).toBe(false);
  });
});

describe('U-12: the uploaded documents\' rows hold no field', () => {
  it('no field in a file row; the panel\'s own upload stays one', async () => {
    const page = await open('application');
    const row = page.doc.querySelector('#Documents div[data-automation="file-row"]')!;
    expect(ultiproAdapter.excluded!(page.root)).toContain(row);
    expect(fieldsIn(page.result, row)).toEqual([]);
    expect(page.result.fields.filter((field) => field.section.id === 'documents').map((field) => field.label))
      .toEqual(['Upload a file']);
    // The rule undone: the row's box, its document type and its description are fields again.
    const plain = rescan(page, { ...ultiproAdapter, excluded: undefined });
    expect(fieldsIn(plain, row).map((field) => field.kind)).toEqual(['checkbox', 'select', 'text']);
  });
});

describe('U-16: the phone boxes take the national number', () => {
  it('declares the national layout on Primary and Secondary Phone and the account step\'s phone, nothing else', async () => {
    const national = { format: 'tel', pattern: ULTIPRO_PHONE_PATTERN };
    for (const name of ['application', 'resume-review'] as const) {
      const page = await open(name);
      for (const id of ['Phone', 'SecondaryPhone']) {
        for (const box of Array.from(page.doc.querySelectorAll(`input#${id}`))) expect(ultiproAdapter.formatFor!(box), id).toEqual(national);
      }
      expect(ultiproAdapter.formatFor!(page.doc.querySelector('input#City')!)).toBeNull();
    }
    const register = await open('register');
    expect(ultiproAdapter.formatFor!(register.doc.querySelector('input[name="phoneNumber"]')!)).toEqual(national);
    expect(ultiproAdapter.formatFor!(register.doc.querySelector('input[name="firstName"]')!)).toBeNull();
  });

  it('the declared layout gives the golden number\'s ten national digits (format.ts phoneText)', () => {
    const constraints = { format: 'tel' as const, pattern: ULTIPRO_PHONE_PATTERN };
    expect(phoneText({ text: '+1 512 555 0147', digits: '15125550147', countryCallingCode: '1' }, constraints, false))
      .toBe('5125550147');
    // A national number of another length stays as the person wrote it.
    expect(phoneText({ text: '+44 20 7946 095', digits: '44207946095', countryCallingCode: '44' }, constraints, false))
      .toBe('+44 20 7946 095');
  });
});

describe('apply-path C3: the application drawn after the sign-in round trip is waited for', () => {
  it('declares formLateMs 30 s (the cap): only UltiPro may claim its address while it waits', () => {
    expect(ultiproAdapter.quirks?.formLateMs).toBe(30_000);
    expect(LATE_FORM_CAP_MS).toBe(30_000);
    const adapters = adaptersFor(new URL(APPLY));
    expect(adapters).toContain(ultiproAdapter);
    expect(lateFormMs(adapters)).toBe(30_000);
    expect(lateAdapters(adapters)).toEqual([ultiproAdapter]);
    expect(lateAdapters(adapters)).not.toContain(genericAdapter);
    // The quirk undone: nothing waits.
    expect(lateFormMs([{ ...ultiproAdapter, quirks: undefined }])).toBe(0);
  });

  it('finds #OpportunityApply once the page draws it, after the content script started', async () => {
    const page = await open('application');
    const root = page.root;
    const parent = root.parentElement!;
    const next = root.nextSibling;
    root.remove();
    expect(ultiproAdapter.detect(page.doc)).toBeNull();
    const found = await new Promise<Element | null>((resolve) => {
      const controller = new AbortController();
      watchForLateForm(page.doc, lateFormMs([ultiproAdapter]), () => {
        const hit = ultiproAdapter.detect(page.doc);
        if (hit !== null) resolve(hit.formRoot);
        return hit !== null;
      }, controller.signal, () => resolve(null));
      startDeadline(300, () => parent.insertBefore(root, next));
      startDeadline(5_000, () => {
        controller.abort();
        resolve(null);
      });
    });
    expect(found).toBe(root);
  });
});
