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
 * P2 (after merging jr6-engine E1-E3 and jr6-rules R1-R4: FIXPLAN §6.10 "P2 asserts", the last describes): the shared
 * outcomes on the same snapshots, each held against the adapter rule it rests on, undone:
 * - U-01, U-02 (RULES item 23): each block's From and To planned from its own entry;
 * - U-04 (ENGINE E1): School's typed text kept where no suggestion matches, Degree chosen from the page's own list,
 *   both through the pass's own write;
 * - U-05 (ENGINE E3, RULES R0): the Skills box one text field, each skill no chip shows added by its row's Add;
 * - U-07 (ENGINE E2, E3): the start date drawn by its datepicker container, written part by part through the pass;
 *   one AI answer for it;
 * - U-08 (gated Q7, not built), U-09 (RULES item 24), U-10 (RULES 57), U-11 (RULES 58, 18): the application's
 *   questions; U-15: the AI asks left; U-16 (ENGINE U-16, RULES 76): the national number, once; U-17 (RULES 77).
 * The fixer's (the jr6 review's REVC-2, TOOLING round 2 R2.4 item 1): no list on the three pages holds a REDACTED
 * option beside public choices (the education editor's Major and Minor did, a field of study told by elimination, until
 * ultipro-0 and -1 were converted again with the synthetic list fixtures/synthetic/ultipro/jr6-fields-of-study.txt).
 */
import { afterEach, describe, expect, it } from 'vitest';
import applicationHtml from '../../../fixtures/ultipro/application.html?raw';
import registerHtml from '../../../fixtures/ultipro/register.html?raw';
import resumeReviewHtml from '../../../fixtures/ultipro/resume-review.html?raw';
import fieldsOfStudy from '../../../fixtures/synthetic/ultipro/jr6-fields-of-study.txt?raw';
import { lateAdapters, lateFormMs, LATE_FORM_CAP_MS, watchForLateForm } from '../../content/late-form';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { writeField, type PassEnv, type WidgetWriteEnv } from '../../content/pass';
import { requiredLeftOf } from '../../content/press';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import { phoneText } from '../../core/resolver/format';
import { classifyField } from '../../core/resolver/resolve';
import { MANY_SEPARATOR } from '../../core/resolver/values';
import type { BaseKey } from '../../core/types/field';
import type { PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { fillDateParts } from '../../dom/fillers/date-parts';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { startDeadline } from '../../dom/time';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, ScannedField, WidgetReading } from '../../dom/types';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { fillabilityOf, scanCase, type ScannedCase } from '../test/expectations.testkit';
import type { Adapter, WidgetDecl } from '../types';
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

/** Synthetic stand-ins for a parse of three jobs (never the owner's): the golden profile's two jobs (their title and
 *  company read from it), then one the profile does not hold. */
const JOBS = goldenProfile().experience;
const PARSED = [[JOBS[0]!.title, JOBS[0]!.company, 'Austin, TX'], [JOBS[1]!.title, JOBS[1]!.company, ''],
  ['Intern', 'Northwind Traders', 'Dallas, TX']] as const;

/** The review as the parser leaves it with PARSED in its three Work Experience blocks. */
function parse(doc: Document): void {
  for (const [index, [title, company, place]] of PARSED.entries()) {
    const block = doc.querySelector(`${REVIEW} [aria-label="Work Experience ${index + 1}"]`)!;
    (block.querySelector('[data-automation="job-title-textbox"]') as HTMLInputElement).value = title;
    (block.querySelector('[data-automation="company-textbox"]') as HTMLInputElement).value = company;
    (block.querySelector('[data-automation="location-textbox"]') as HTMLInputElement).value = place;
  }
}

// ── jr6 ULTIPRO P2 helpers ──
/** A field's row and planned write in a plan. */
function outcomeOf(plan: PlanOutput, field: ScannedField | undefined) {
  return { row: plan.results.find((each) => each.key === field?.key),
    write: plan.writes.find((each) => each.key === field?.key) };
}

/** What a planned write puts in its field: an option's words, a text, a date's ISO form, else its kind. */
function shownOf(write: PlannedWrite | undefined): string | undefined {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.iso;
  return value.kind;
}

/** What a plan asks TailorIT's AI, by the asked fields' labels (a tiebreak carries its own). */
function asksOf(plan: PlanOutput, result: ScanResult) {
  const labels = (items: ReadonlyArray<{ key: string }> | undefined) => (items ?? [])
    .map((item) => result.fields.find((field) => field.key === item.key)?.label ?? item.key);
  return { tiebreaks: (plan.ask?.tiebreaks ?? []).map((item) => String(item.fieldLabel)),
    classify: labels(plan.ask?.classify), drafts: labels(plan.ask?.drafts), answers: labels(plan.ask?.answers) };
}

/** The classifier's rule for a field alone (resolve.ts classifyField), or how it was read when no rule names it. */
function ruleOf(field: ScannedField | undefined): string | undefined {
  if (field === undefined) return undefined;
  const classified = classifyField(toFieldSpec(field), testVocab());
  return classified.by === 'rules' ? classified.rules.rule : classified.by;
}

/** The field labelled `label` (the `at`-th of that label). */
const labelled = (result: ScanResult, label: string, at = 0): ScannedField | undefined =>
  result.fields.filter((field) => field.label === label)[at];

/** The adapter with one widget declaration's member taken away (a widget rule undone). */
function withoutDecl(member: 'freeText' | 'tags'): Adapter {
  return { ...ultiproAdapter, widgetFor: (control) => {
    const decl = ultiproAdapter.widgetFor!(control);
    if (decl === null) return null;
    const { [member]: _gone, ...rest } = decl;
    return rest as WidgetDecl;
  } };
}

/**
 * One field written the way the run's pass writes it (content/pass.ts writeField: the DOM guard on a fresh scan, the
 * frame-side Guard, then the fillers or the widget helpers), its planned write and row the plan's with `profile`; a
 * search's results are matched by planFrame itself, as the worker's plan/request would. `reading` is the widget's
 * reading the run holds before the write. Null when the plan writes nothing there.
 */
async function writeThroughPass(page: ScannedCase, label: string, options: { adapter?: Adapter; profile?: Profile;
  reading?: WidgetReading } = {}) {
  const adapter = options.adapter ?? ultiproAdapter;
  const profile = options.profile ?? goldenProfile();
  const readings = new Map<BaseKey, WidgetReading>();
  const read = (): ScanResult => scan(page.root, adapter, { platform: 'ultipro', frameId: 0, widgetReadings: readings });
  const first = labelled(read(), label)!;
  if (options.reading !== undefined) readings.set(first.baseKey, options.reading);
  const last = read();
  const field = last.fields.find((each) => each.baseKey === first.baseKey)!;
  const { row, write } = outcomeOf(planned(last, profile), field);
  const matched: string[][] = [];
  if (write === undefined || row === undefined) return { field, row, write, result: null, matched, read };
  const env = { adapter, root: page.root, platform: 'ultipro', frameId: 0, dryRun: false, canaries: [],
    signal: new AbortController().signal, valid: () => true, stopped: () => false, runId: () => 'run',
    heldBy: () => null } as unknown as PassEnv;
  const widgets: WidgetWriteEnv = { readings, plan: async (specs) => {
    matched.push(specs.flatMap((spec) => (spec.options === 'lazy' ? [] : spec.options.map((option) => option.label))));
    const answer = planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
      settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    return { results: answer.results, writes: answer.writes } as never;
  } };
  const result = await writeField(env, last, field, write, row, new WeakMap(), { widgets });
  return { field, row, write, result, matched, read };
}
// ── end jr6 ULTIPRO P2 helpers ──

describe('jr6 UltiPro: the pages as the step machine reads them (the audit harness, as asserts)', () => {
  it('the account step: its form, no Next, its Create account the sign-in container\'s button (ultipro-2)', async () => {
    const page = await open('register');
    expect(page.adapter).toBe(ultiproAdapter);
    // Element identities are compared as booleans: a failing diff of a whole form overflows the browser runner's channel.
    expect(page.root === page.doc.querySelector('form#registrationDetailsForm')).toBe(true);
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
    expect(page.root === page.doc.querySelector(REVIEW)).toBe(true);
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
    expect(page.root === page.doc.querySelector('#OpportunityApply')).toBe(true);
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
      expect(remove !== null && never.includes(remove)).toBe(true);
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
    expect(plainTitles).toEqual([undefined, { kind: 'text', text: JOBS[0]!.title }, { kind: 'text', text: JOBS[0]!.title }]);
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
    const box = page.doc.querySelector<HTMLSelectElement>(
      `${REVIEW} [aria-label="Work Experience 1"] [data-automation="from-month-dropdown"]`)!;
    expect(ultiproAdapter.labelFirst?.(box)).toBe(true);
    expect(box.labels).toHaveLength(1);
    box.labels[0]!.replaceChildren('Start month of this job');
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
    const shown = decl.tags!.chips();
    expect(shown).toHaveLength(20);
    expect(shown.every((chip, at) => chip === chips[at])).toBe(true);
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
    expect(excluded.includes(saved)).toBe(true);
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
    expect(ultiproAdapter.excluded!(page.root)).toHaveLength(0);
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
    const excluded = ultiproAdapter.excluded!(page.root);
    for (const name of ['month', 'day', 'year']) expect(excluded.includes(part(page.doc, name)), name).toBe(true);
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
    expect(page.result.target(dates[0]!.key)?.control === host(page.doc)).toBe(true);
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
    expect(ultiproAdapter.excluded!(page.root).includes(row)).toBe(true);
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
    expect(found === root).toBe(true);
  });
});

// ── jr6 ULTIPRO P2 (FIXPLAN §6.10 "P2 asserts"; SP\jr6\build\ULTIPRO.md): the outcomes ENGINE E1-E3 and RULES R1-R4
// give these pages, with the golden profile or variants built here, each held against the adapter rule it rests on ──

describe('jr6 P2, U-01 and U-02 (RULES item 23, label.period-part): each block\'s From and To from its own entry', () => {
  const PARTS = ['from-month-dropdown', 'from-year-textbox', 'to-month-dropdown', 'to-year-textbox'] as const;
  /** The block's period boxes as planned: each one's planned words (a month's option, a year), else its row's reason. */
  function periods(page: ScannedCase, result: ScanResult, plan: PlanOutput, block: string): Array<string | undefined> {
    const scope = page.doc.querySelector(`${REVIEW} [aria-label="${block}"]`)!;
    return PARTS.map((part) => {
      const { row, write } = outcomeOf(plan, fieldOf(result, scope.querySelector(`[data-automation="${part}"]`)));
      return shownOf(write) ?? row?.reason;
    });
  }

  it('plans job 1 from Jun 2021 with no To (its current job), job 2 from Jul 2019 to May 2021, the third block '
    + 'nothing, the school from 2015 to 2019; none asked of the AI', async () => {
    const page = await open('resume-review');
    parse(page.doc);
    const result = rescan(page);
    const plan = planned(result);
    expect(periods(page, result, plan, 'Work Experience 1')).toEqual(['Jun', '2021', 'end-date-not-applicable',
      'end-date-not-applicable']);
    expect(periods(page, result, plan, 'Work Experience 2')).toEqual(['Jul', '2019', 'May', '2021']);
    expect(periods(page, result, plan, 'Work Experience 3')).toEqual(Array(4).fill('no-profile-value'));
    expect(periods(page, result, plan, 'Education 1')).toEqual(['Aug', '2015', 'May', '2019']);
    // Each box is its entry's start or end by its own label and its block's section; none waits for the AI.
    const boxes = result.fields.filter((field) => /^(?:From|To) (?:Month|Year \(YYYY\))$/.test(field.label));
    expect(boxes).toHaveLength(16);
    for (const field of boxes) {
      expect(ruleOf(field), field.label).toBe('label.period-part');
      expect(outcomeOf(plan, field).row?.category, field.label)
        .toBe(`${field.section.id}.${field.label.startsWith('From') ? 'startDate' : 'endDate'}`);
      expect(plan.awaiting.includes(field.key), field.label).toBe(false);
    }
    // The third job, which the profile does not hold: its required From left for the person, its To skipped.
    const third = page.doc.querySelector(`${REVIEW} [aria-label="Work Experience 3"]`)!;
    const row = (part: string) => outcomeOf(plan, fieldOf(result, third.querySelector(`[data-automation="${part}"]`))).row;
    expect(row('from-month-dropdown')).toMatchObject({ status: 'flagged', needsUserAction: true });
    expect(row('to-month-dropdown')).toMatchObject({ status: 'skipped', needsUserAction: false });
  });

  it('undone: without the blocks every job takes job 1\'s From; without the group\'s label the From boxes go to the AI',
    async () => {
    const page = await open('resume-review');
    parse(page.doc);
    const plain = rescan(page, without('repeatables'));
    const plainPlan = planned(plain);
    for (const block of ['Work Experience 1', 'Work Experience 2', 'Work Experience 3']) {
      expect(periods(page, plain, plainPlan, block), block).toEqual(['Jun', '2021', 'end-date-not-applicable',
        'end-date-not-applicable']);
    }
    const bare = rescan(page, without('labelFirst'));
    const asked = asksOf(planned(bare), bare).classify;
    expect(asked.filter((label) => label === 'Month')).toHaveLength(3);
    expect(asked.filter((label) => label === 'Year (YYYY)')).toHaveLength(3);
  });
});

describe('jr6 P2, U-04 (ENGINE E1 freeText, knownOptions): School Name and Degree through the pass', () => {
  const box = (doc: Document, automation: 'school-textbox' | 'degree-textbox') =>
    doc.querySelector<HTMLInputElement>(`${REVIEW} [data-automation="${automation}"]`)!;

  /** typeahead.js's part of the box, as a stand-in (the capture runs no script): on each of `on`, the box's own
   *  suggestions list draws the rows `found` gives for the box's text, a row's click putting its words in the box and
   *  closing the list; leaving the box closes it. Returns what was typed, query by query. */
  function standIn(input: HTMLInputElement, found: (text: string) => readonly string[],
    on: readonly string[] = ['input']): string[] {
    const typed: string[] = [];
    const menu = input.parentElement!.querySelector<HTMLElement>(':scope > span.tt-dropdown-menu')!;
    const dataset = menu.querySelector(':scope > div')!;
    const draw = (event: Event) => {
      if (event.type === 'input') typed.push(input.value);
      dataset.replaceChildren(...found(input.value.trim()).map((words) => {
        const row = Object.assign(input.ownerDocument.createElement('div'), { className: 'tt-suggestion', textContent: words });
        row.addEventListener('click', () => {
          input.value = words;
          menu.style.display = 'none';
        });
        return row;
      }));
      menu.style.display = 'block';
    };
    for (const type of on) input.addEventListener(type, draw);
    input.addEventListener('focusout', () => {
      menu.style.display = 'none';
    });
    return typed;
  }

  /** The golden school's queries (core/resolver typeaheadQueries: its name, an alias, a shorter name). */
  const QUERIES = ['University of Texas at Austin', 'UT Austin', 'University of Texas'];

  it('School: no suggestion is the school, so the planner\'s first query stands as typed text, verified', async () => {
    const page = await open('resume-review');
    const typed = standIn(box(page.doc, 'school-textbox'), () => ['Lakeside University', 'Riverside College']);
    const { write, result, matched } = await writeThroughPass(page, 'School Name', { reading: { kind: 'remote' } });
    expect(write?.value).toMatchObject({ kind: 'query', queries: QUERIES });
    // Each query typed; the results the page drew matched by the planner, none of them the school; the first typed again.
    expect(typed).toEqual([...QUERIES, QUERIES[0]]);
    expect(matched.length).toBeGreaterThan(0);
    for (const labels of matched) expect(labels).toEqual(['Lakeside University', 'Riverside College']);
    expect(result?.row).toMatchObject({ category: 'education.school', status: 'verified', wrote: true,
      verification: 'verified', provenance: 'profile', needsUserAction: false });
    expect(result?.written?.value).toEqual({ kind: 'text', text: QUERIES[0] });
    expect(box(page.doc, 'school-textbox').value).toBe(QUERIES[0]);
  });

  it('School on a page that answers no query keeps its first query too; undone (no freeText), the box is put back',
    async () => {
    const page = await open('resume-review');
    const kept = await writeThroughPass(page, 'School Name', { reading: { kind: 'remote' } });
    expect(kept.result?.row).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(box(page.doc, 'school-textbox').value).toBe(QUERIES[0]);
    removeFixtures(document);
    const again = await open('resume-review');
    const undone = await writeThroughPass(again, 'School Name', { adapter: withoutDecl('freeText'),
      reading: { kind: 'remote' } });
    expect(undone.result?.row).toMatchObject({ status: 'flagged', wrote: false, reason: 'needs-your-click',
      needsUserAction: true });
    expect(undone.result?.written).toBeUndefined();
    expect(box(again.doc, 'school-textbox').value).toBe('');
  });

  it('Degree: the page\'s own list (a synthetic degreeOptions script) planned as a choice, the bachelor\'s, chosen and '
    + 'read back', async () => {
    const page = await open('resume-review');
    // Undone (no list on the page, as in the capture): a search, its queries the degree's own names.
    expect(outcomeOf(planned(page.result), labelled(page.result, 'Level of Education / Degree')).write?.value)
      .toMatchObject({ kind: 'query' });
    const DEGREES = ['High School Diploma', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'];
    const script = page.doc.createElement('script');
    script.type = 'text/plain';
    script.textContent = `var degreeOptions = ${JSON.stringify(DEGREES.map((Name, Id) => ({ Id, Name })))};`;
    page.doc.body.append(script);
    standIn(box(page.doc, 'degree-textbox'), (text) => DEGREES.filter((name) => name.toLowerCase()
      .includes(text.toLowerCase())), ['focus', 'click', 'input']);
    const { field, write, result } = await writeThroughPass(page, 'Level of Education / Degree');
    expect(field.kind).toBe('combobox');
    expect(field.options === 'lazy' ? 'lazy' : field.options.map((option) => option.label)).toEqual(DEGREES);
    expect(write?.value).toEqual({ kind: 'option', index: 2, cleanLabel: "Bachelor's Degree" });
    expect(result?.row).toMatchObject({ category: 'education.degree', status: 'verified', wrote: true,
      verification: 'verified' });
    expect(result?.readBack).toEqual({ kind: 'selected', labels: ["Bachelor's Degree"] });
    expect(box(page.doc, 'degree-textbox').value).toBe("Bachelor's Degree");
  });
});

describe('jr6 P2, U-05 (ENGINE E3 tags filler, RULES R0 MANY_SEPARATOR): the review\'s Skills', () => {
  /** The golden profile's skills (fixtures/profiles/alex-rivera.profile.json), as the planner joins them. */
  const SKILLS = ['TypeScript', 'PostgreSQL', 'Kubernetes'];

  /** The Skills row's Add as a stand-in (the capture runs no script): enabled while the box holds text; pressed, a chip
   *  of the box's words joins the panel's chips and the box is emptied. */
  function standInAdd(doc: Document) {
    const input = doc.querySelector<HTMLInputElement>(`${REVIEW} input[data-automation="item-typeahead"]`)!;
    const add = input.closest('div.form-inline')!.querySelector<HTMLButtonElement>('button[data-automation="item-add-button"]')!;
    const region = input.closest('div[role="region"][aria-label="Skills"]')!;
    const list = region.querySelector('[data-automation="selected-item"]')!.parentElement!;
    const pressed: string[] = [];
    input.addEventListener('input', () => {
      add.disabled = input.value.trim() === '';
    });
    add.addEventListener('click', () => {
      pressed.push(input.value);
      const item = Object.assign(doc.createElement('div'), { className: 'multigroup-item alert alert-info pull-left' });
      item.setAttribute('data-automation', 'selected-item');
      const words = Object.assign(doc.createElement('strong'), { textContent: input.value.trim() });
      words.setAttribute('data-automation', 'skill-label');
      item.append(words);
      list.append(item);
      input.value = '';
      add.disabled = true;
    });
    const chips = () => Array.from(region.querySelectorAll('strong[data-automation="skill-label"]'), (chip) => chip.textContent);
    return { input, pressed, chips };
  }

  it('is one text field holding its box\'s text; the skills no chip shows are added one at a time by its Add, the one '
    + 'a chip shows in other letters skipped, and the field read back by its chips', async () => {
    const page = await open('resume-review');
    const skills = standInAdd(page.doc);
    expect(skills.chips()).toHaveLength(20);
    page.doc.querySelectorAll(`${REVIEW} strong[data-automation="skill-label"]`)[3]!.textContent = 'typescript';
    const { field, write, result } = await writeThroughPass(page, 'Skills');
    expect(field).toMatchObject({ kind: 'text', required: true, current: { kind: 'empty' }, section: { id: 'skills' } });
    expect(write?.value).toEqual({ kind: 'text', text: SKILLS.join(MANY_SEPARATOR) });
    expect(skills.pressed).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(skills.chips().slice(20)).toEqual(['PostgreSQL', 'Kubernetes']);
    expect(skills.input.value).toBe('');
    // Written and verified by its chips, nothing left for the person. The planner's own flag on a skills text (its
    // fill-and-flag band) stays on the row, as on any flagged row read back (core/plan/settle.ts).
    expect(result?.row).toMatchObject({ category: 'skills.list', wrote: true, verification: 'verified',
      needsUserAction: false });
    expect(result?.written?.value).toEqual(write?.value);
  });

  it('undone (no tags declared): the skills typed into the box as one text, its Add never pressed (the audit\'s U-05)',
    async () => {
    const page = await open('resume-review');
    const skills = standInAdd(page.doc);
    const { field, result } = await writeThroughPass(page, 'Skills', { adapter: without('widgetFor') });
    expect(field.kind).toBe('text');
    expect(result?.row).toMatchObject({ wrote: true });
    expect(skills.input.value).toBe(SKILLS.join(MANY_SEPARATOR));
    expect(skills.pressed).toEqual([]);
    expect(skills.chips()).toHaveLength(20);
  });

  it('counts the required box answered while a chip shows (content/press.ts requiredLeftOf); undone, never', async () => {
    const page = await open('resume-review');
    const shown = requiredLeftOf(rescan(page));
    const plainShown = requiredLeftOf(rescan(page, without('widgetFor')));
    for (const chip of Array.from(page.doc.querySelectorAll(`${REVIEW} [data-automation="selected-item"]`))) chip.remove();
    expect(requiredLeftOf(rescan(page)) - shown).toBe(1);
    expect(requiredLeftOf(rescan(page, without('widgetFor')))).toBe(plainShown);
  });
});

describe('jr6 P2, U-07 (ENGINE E2 controlBox, E3 WD-23): the start date through the pass', () => {
  const datePart = (doc: Document, name: string) => doc.querySelector('ukg-date-input-text[role="group"]')!.shadowRoot!
    .querySelector<HTMLInputElement>(`input[data-automation="ukg-date-input-text-${name}"]`)!;
  const LABEL = 'When can you start? (MM/DD/YYYY)';

  it('is drawn by its datepicker container once that shows a border (staged: the capture holds none of UKG\'s styles), '
    + 'and a profile date is written part by part, each part focused before its write', async () => {
    const page = await open('application');
    const date = (adapter: Adapter = ultiproAdapter) => labelled(rescan(page, adapter), LABEL)!;
    expect(fillabilityOf(date())).toEqual({ fillable: false, reason: 'camouflaged' });
    page.doc.querySelector<HTMLElement>('ukg-input-container[data-automation="ukg-datepicker-container"]')!.style.border
      = '1px solid rgb(120, 120, 120)';
    expect(fillabilityOf(date())).toEqual({ fillable: true });
    // Undone (no controlBox): the container's border draws nothing of the component's.
    expect(fillabilityOf(date(without('controlBox')))).toEqual({ fillable: false, reason: 'camouflaged' });
    const events: string[] = [];
    for (const name of ['month', 'day', 'year']) {
      for (const type of ['focus', 'focusin', 'input', 'change', 'focusout', 'blur']) {
        datePart(page.doc, name).addEventListener(type, (event) => events.push(`${name} ${type}${event.isTrusted ? '!' : ''}`));
      }
    }
    const golden = goldenProfile();
    const profile: Profile = { ...golden, preferences: { ...golden.preferences,
      startDate: { kind: 'date', date: { y: 2026, m: 12, d: 7 } } } };
    const { write, result } = await writeThroughPass(page, LABEL, { profile });
    expect(write?.value).toEqual({ kind: 'date', iso: '2026-12-07' });
    expect(result?.row).toMatchObject({ category: 'availability.startDate', status: 'verified', wrote: true,
      verification: 'verified', needsUserAction: false });
    expect(['month', 'day', 'year'].map((name) => datePart(page.doc, name).value)).toEqual(['12', '07', '2026']);
    // Untrusted focus and focusin right before each part's write (the page's focus never moves), the parts left after.
    expect(events).toEqual(['month focus', 'month focusin', 'month input', 'month change', 'day focus', 'day focusin',
      'day input', 'day change', 'year focus', 'year focusin', 'year input', 'year change', 'month focusout', 'month blur',
      'day focusout', 'day blur', 'year focusout', 'year blur']);
  });

  it('without a profile date it is one question for the AI, never one per box', async () => {
    const page = await open('application');
    const plan = planned(page.result);
    const date = labelled(page.result, LABEL)!;
    expect(asksOf(plan, page.result).answers.filter((label) => label.startsWith('When can you start?'))).toEqual([LABEL]);
    expect(plan.awaiting.filter((key) => key === date.key)).toHaveLength(1);
    expect(outcomeOf(plan, date).row).toMatchObject({ category: 'availability.startDate', reason: 'no-profile-value' });
  });
});

describe('jr6 P2, U-09 (RULES item 24): the golden profile declines Gender, Ethnic Origin and Race', () => {
  const QUESTIONS = [['Gender', 'eeo.gender', 'label.gender'], ['Ethnic Origin', 'eeo.hispanicLatino', 'label.ethnic-origin'],
    ['Race', 'eeo.race', 'label.race']] as const;

  it('ticks each one\'s decline box and leaves its list, which is then no question for the person; the veteran list '
    + 'is answered and its box left; nothing here asked of the AI', async () => {
    const page = await open('application');
    const plan = planned(page.result);
    for (const [question, category, rule] of QUESTIONS) {
      const list = labelled(page.result, question);
      const decline = labelled(page.result, `${question} I decline to say`);
      expect(ruleOf(list), question).toBe(rule);
      expect(outcomeOf(plan, list), question).toMatchObject({ row: { category, status: 'skipped',
        reason: 'decline-option-missing', needsUserAction: false }, write: undefined });
      expect(ruleOf(decline), question).toBe('label.eeo-decline-box');
      expect(outcomeOf(plan, decline), question).toMatchObject({ row: { category, status: 'verified' },
        write: { value: { kind: 'check' }, origin: { provenance: 'rule', ruleId: 'eeo.decline' } } });
    }
    expect(shownOf(outcomeOf(plan, labelled(page.result, 'Are you a protected veteran?')).write)).toBe('No');
    expect(outcomeOf(plan, labelled(page.result, 'Are you a protected veteran? I decline to say'))).toMatchObject({
      row: { status: 'skipped', reason: 'already-correct' }, write: undefined });
    const eeo = page.result.fields.filter((field) => /^(?:Gender|Ethnic Origin|Race|Are you a protected veteran\?)/
      .test(field.label));
    expect(eeo).toHaveLength(8);
    expect(eeo.filter((field) => plan.awaiting.includes(field.key))).toEqual([]);
  });

  it('undone (each box its own words alone): the lists are left for the person, the boxes optional consents, unticked',
    async () => {
    const page = await open('application');
    const plain = rescan(page, without('labelFirst'));
    const plan = planned(plain);
    for (const [question] of QUESTIONS) {
      expect(outcomeOf(plan, labelled(plain, question)).row, question).toMatchObject({ status: 'flagged',
        reason: 'decline-option-missing', needsUserAction: true });
    }
    const boxes = plain.fields.filter((field) => field.label === 'I decline to say');
    expect(boxes).toHaveLength(4);
    for (const decline of boxes) {
      expect(outcomeOf(plan, decline)).toMatchObject({ row: { category: 'consent.other',
        reason: 'consent-optional-unticked' }, write: undefined });
    }
  });
});

describe('jr6 P2, U-10, U-11 (RULES items 57, 58, 18) and U-08 (gated Q7): the application\'s questions', () => {
  it('drafts the SQL question; skips Middle and Former Name with no AI; types the current place; answers the referral No',
    async () => {
    const page = await open('application');
    const plan = planned(page.result);
    const sql = page.result.fields.find((field) => field.label.startsWith('Do you have experience with SQL'))!;
    expect(outcomeOf(plan, sql).row).toMatchObject({ category: 'freeText.other', kind: 'textarea', required: true });
    expect(asksOf(plan, page.result).drafts).toEqual([sql.label]);
    // "Middle", between First Name and Last Name: the middle name, which the golden profile has none of.
    const middle = labelled(page.result, 'Middle');
    expect(outcomeOf(plan, middle)).toMatchObject({ row: { category: 'identity.middleName', status: 'skipped',
      reason: 'no-profile-value' }, write: undefined });
    // "Former Name": the account's here (read-only), a name the profile never holds.
    const former = labelled(page.result, 'Former Name');
    expect(ruleOf(former)).toBe('label.former-name');
    expect(outcomeOf(plan, former)).toMatchObject({ row: { category: 'identity.formerName', status: 'skipped' },
      write: undefined });
    expect([middle, former].filter((field) => plan.awaiting.includes(field!.key))).toEqual([]);
    const located = labelled(page.result, 'Where are you currently located?');
    expect(ruleOf(located)).toBe('label.location');
    expect(outcomeOf(plan, located)).toMatchObject({ row: { category: 'location.current', status: 'verified' },
      write: { value: { kind: 'text', text: 'Austin, TX' } } });
    const referred = labelled(page.result, 'Were you referred by a current employee?');
    expect(ruleOf(referred)).toBe('label.employee-referred');
    expect(outcomeOf(plan, referred)).toMatchObject({ row: { category: 'referral.employeeReferred', status: 'verified' },
      write: { value: { kind: 'option', cleanLabel: 'No' }, origin: { provenance: 'rule', ruleId: 'referral.not-employee' } } });
  });

  it('on the review, Middle and Former Name (editable there) are skipped with no AI too', async () => {
    const page = await open('resume-review');
    const plan = planned(page.result);
    expect(outcomeOf(plan, labelled(page.result, 'Middle')).row).toMatchObject({ category: 'identity.middleName',
      status: 'skipped', reason: 'no-profile-value' });
    expect(outcomeOf(plan, labelled(page.result, 'Former Name')).row).toMatchObject({ category: 'identity.formerName',
      status: 'skipped', reason: 'no-profile-value' });
    const asked = asksOf(plan, page.result);
    expect([...asked.classify, ...asked.answers].filter((label) => label === 'Middle' || label === 'Former Name')).toEqual([]);
  });

  it('U-08 (gated Q7, not built): the compound work-authorisation question stays the person\'s, asked of no AI',
    async () => {
    const page = await open('application');
    const plan = planned(page.result);
    const authorized = labelled(page.result, 'Are you legally authorized to work in the US?')!;
    expect(outcomeOf(plan, authorized)).toMatchObject({ row: { category: 'workAuth.authorized', status: 'flagged',
      reason: 'ambiguous-options', needsUserAction: true }, write: undefined });
    expect(plan.awaiting.includes(authorized.key)).toBe(false);
  });
});

describe('jr6 P2, U-15: the AI asks left', () => {
  it('the review asks one classification, its school\'s Description (no rule reads it), parsed or not (the audit '
    + 'counted 22)', async () => {
    const page = await open('resume-review');
    const only = { tiebreaks: [], classify: ['Description'], drafts: [], answers: [] };
    const plan = planned(page.result);
    expect(asksOf(plan, page.result)).toEqual(only);
    expect(plan.ask?.classify.map((item) => page.result.fields.find((field) => field.key === item.key)?.section))
      .toEqual([{ id: 'education', block: 0 }]);
    parse(page.doc);
    const parsed = rescan(page);
    expect(asksOf(planned(parsed), parsed)).toEqual(only);
    // Undone (the From boxes' group label, U-02): the three jobs' six From boxes go to the AI again.
    const bare = rescan(page, without('labelFirst'));
    expect(asksOf(planned(bare), bare).classify).toHaveLength(7);
  });

  it('the application asks one draft and three answers (the audit counted 10): no Documents row, no date part, no name',
    async () => {
    const page = await open('application');
    const sql = page.result.fields.find((field) => field.label.startsWith('Do you have experience with SQL'))!;
    expect(asksOf(planned(page.result), page.result)).toEqual({ tiebreaks: [], classify: [], drafts: [sql.label],
      answers: ['When can you start? (MM/DD/YYYY)', 'Are you comfortable working in a fully remote setting?',
        'What are your annual salary requirements?'] });
  });
});

describe('jr6 P2, U-16 (ENGINE withAdapterFormat, RULES item 76): the national number, once', () => {
  it('plans the ten national digits into Primary Phone and the account step\'s phone; Secondary Phone left empty',
    async () => {
    for (const name of ['resume-review', 'application'] as const) {
      const page = await open(name);
      const plan = planned(page.result);
      const primary = labelled(page.result, 'Primary Phone');
      expect(primary?.constraints, name).toMatchObject({ format: 'tel', pattern: ULTIPRO_PHONE_PATTERN });
      expect(outcomeOf(plan, primary), name).toMatchObject({ row: { category: 'contact.phone', status: 'verified' },
        write: { value: { kind: 'text', text: '5125550147' } } });
      expect(outcomeOf(plan, labelled(page.result, 'Secondary Phone')), name).toMatchObject({ row: {
        category: 'contact.phone', status: 'skipped', reason: 'no-profile-value' }, write: undefined });
    }
    const register = await open('register');
    expect(outcomeOf(planned(register.result), labelled(register.result, 'Phone number')).write).toMatchObject({
      value: { kind: 'text', text: '5125550147' }, origin: { provenance: 'profile', path: 'contact.phone',
        transform: 'phone.format' } });
    // Undone (no formatFor): the number as the person wrote it.
    const plain = rescan(register, without('formatFor'));
    expect(shownOf(outcomeOf(planned(plain), labelled(plain, 'Phone number')).write)).toBe('+1 512 555 0147');
  });

  it('a national number the parser drew is already correct; undone, it is overwritten with its country code (the '
    + 'audit\'s prefill-conflict)', async () => {
    const page = await open('resume-review');
    page.doc.querySelector<HTMLInputElement>(`${REVIEW} input#Phone`)!.value = '(512) 555-0147';
    const result = rescan(page);
    expect(outcomeOf(planned(result), labelled(result, 'Primary Phone'))).toMatchObject({ row: { status: 'skipped',
      reason: 'already-correct' }, write: undefined });
    const plain = rescan(page, without('formatFor'));
    expect(outcomeOf(planned(plain), labelled(plain, 'Primary Phone'))).toMatchObject({ row: { status: 'flagged',
      reason: 'prefill-conflict' }, write: { value: { kind: 'text', text: '+1 512 555 0147' } } });
  });
});

describe('jr6 P2, U-17 (RULES item 77): a job\'s place too long for its Location box', () => {
  it('writes "San Francisco, CA" into the first job\'s Location (maxlength 20), never cut; undone (no blocks), the '
    + 'person\'s own place goes into every job\'s', async () => {
    const page = await open('resume-review');
    const golden = goldenProfile();
    const far: Profile = { ...golden, experience: [{ ...golden.experience[0]!, location: { text: 'San Francisco, California',
      city: 'San Francisco', region: { code: 'CA', name: 'California' }, country: 'US' } }, ...golden.experience.slice(1)] };
    const location = page.doc.querySelector<HTMLInputElement>(
      `${REVIEW} [aria-label="Work Experience 1"] [data-automation="location-textbox"]`)!;
    expect(location.maxLength).toBe(20);
    expect(outcomeOf(planned(page.result, far), fieldOf(page.result, location))).toMatchObject({
      row: { category: 'experience.location', status: 'verified' }, write: { value: { kind: 'text', text: 'San Francisco, CA' },
        origin: { provenance: 'profile', path: 'experience[0].location', transform: 'location.compose' } } });
    const plain = rescan(page, without('repeatables'));
    const plainPlan = planned(plain, far);
    expect(plain.fields.filter((field) => field.label === 'Location').map((field) => {
      const { row, write } = outcomeOf(plainPlan, field);
      return `${row?.category} ${shownOf(write)}`;
    })).toEqual(Array(3).fill('location.current Austin, TX'));
  });
});

// ── jr6 ULTIPRO fixer (the jr6 review's REVC-2; TOOLING round 2, R2.4 item 1): no list tells a REDACTED option ──

describe('jr6 fix, REVC-2 (privacy): no list on the three pages tells a REDACTED option by elimination', () => {
  /** The elements `selector` names under `root`, open shadow roots included. */
  function deepAll(root: Document | Element, selector: string): Element[] {
    const found: Element[] = [];
    const walk = (scope: Document | Element | ShadowRoot) => {
      found.push(...Array.from(scope.querySelectorAll(selector)));
      for (const el of Array.from(scope.querySelectorAll('*'))) if (el.shadowRoot !== null) walk(el.shadowRoot);
    };
    walk(root);
    return found;
  }

  it('holds no REDACTED option beside a public choice, nor one keeping its own value (the converter now refuses such '
    + 'a page: TOOLING jobvite-new-2)', async () => {
    const told: string[] = [];
    for (const name of Object.keys(PAGES) as PageName[]) {
      const { doc } = await loadFixture(document, PAGES[name].html);
      for (const list of deepAll(doc, 'select, datalist, [role="listbox" i]')) {
        const options = deepAll(list, 'option, [role="option" i]');
        const redacted = options.filter((option) => /REDACTED/.test(`${option.textContent ?? ''} ${option.getAttribute('label') ?? ''}`));
        if (redacted.length === 0) continue;
        // A public choice: words and a value of its own (an <option> with no value attribute is valued by its words);
        // a placeholder (value "") tells nothing.
        const valueOf = (option: Element) => option.getAttribute('value')
          ?? (option.localName === 'option' ? (option.textContent ?? '').trim() : '');
        const choices = options.filter((option) => !redacted.includes(option) && valueOf(option) !== ''
          && /[\p{L}\p{N}]/u.test(option.textContent ?? ''));
        const kept = redacted.filter((option) => !/^(?:|REDACTED)$/.test(option.getAttribute('value') ?? ''));
        if (choices.length > 0 || kept.length > 0) {
          told.push(`${name}: ${list.localName}[data-automation="${list.getAttribute('data-automation') ?? ''}"] `
            + `${redacted.length} REDACTED beside ${choices.length} public, ${kept.length} keeping its value`);
        }
      }
      removeFixtures(document);
    }
    expect(told).toEqual([]);
  });

  it('gives the education editor\'s Major and Minor the synthetic list after their placeholder, as converted '
    + '(--replace-text, fixtures/synthetic/ultipro/jr6-fields-of-study.txt)', async () => {
    const lines = fieldsOfStudy.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    for (const name of ['resume-review', 'application'] as const) {
      const { doc } = await loadFixture(document, PAGES[name].html);
      for (const automation of ['major-dropdown', 'minor-dropdown']) {
        // One each per page: the review's education block (resume-review), the application's education editor.
        const selects = Array.from(doc.querySelectorAll<HTMLSelectElement>(`select[data-automation="${automation}"]`));
        expect(selects, `${name} ${automation}`).toHaveLength(1);
        const [placeholder, ...rest] = Array.from(selects[0]!.options);
        expect(placeholder?.value, `${name} ${automation}`).toBe('');
        expect(rest.map((option) => [option.text, option.value]), `${name} ${automation}`)
          .toEqual(lines.map((line) => [line, line]));
      }
      removeFixtures(document);
    }
  });
});
// ── end jr6 ULTIPRO fixer (REVC-2) ──
