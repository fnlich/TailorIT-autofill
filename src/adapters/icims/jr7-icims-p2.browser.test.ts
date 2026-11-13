/*
 * The iCIMS adapter on the owner's snapshot7 (fixtures/icims/jr7-*), the jr7 build's ICIMS-7 package, P2 (FIX7PLAN §6.7
 * "P2 asserts", after jr7-engine-e2, jr7-rules-r2, jr7-auto-done and jr7-chain-done merged): the shared outcomes on the
 * package's fixtures, with the real planner, the real content runtime and the fake worker:
 * - the expectations: every jr7 page or frame with a root is its scan, with its hooks; the IForm portal frames, the
 *   Assessments step, the postings and the confirmations hold their hooks alone (fixtures/icims/jr7-*.expect.json);
 * - RULES-7 on the adapter's readings: ICIMS7-05 (the current job's End Date "If presently employed put today's date":
 *   today), -06 (the attestations: Yes), -07 (a background check's willingness: consent.backgroundCheck), -08 (Duties:
 *   the entry's description), -13 (no "Other (Non Internet)" for LinkedIn), -14 ("Other School" and the licence boxes:
 *   never written, never asked), V3 (Desired Salary's parts each as itself; the page's "Hr." never counted as filled,
 *   O-3), V4 ("Today's Date" parts: today; the leaf's Next held by none of them);
 * - ENGINE-7's L1 on arc-onesolutions' "Other School" box (dependsOn its School list);
 * - CHAIN-7: the three portal frames' declared forms origins in the claim frame's hello, the portal facts, and the
 *   verifier's STALE/FRESH probe on arc-onesolutions' (2/2) leaf (jr7-icims1-iform-2.frame-2);
 * - AUTO-7: the Assessments frame's hello says its hand-over (ICIMS7-04), the Jibe posting's hello the job's iCIMS
 *   posting (ICIMS7-11).
 * Lists the captures redact (iCIMS's dropdowns) are SYNTHETIC public words; values are the golden synthetic profile's or
 * variants built in the test. Nothing here prints or reads a snapshot's value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { declaredChildOrigins, holdChainFacts, leafAdapter, loadedByPortal } from '../../content/chain-frame';
import { heldIn } from '../../content/orchestrator';
import { lastFillOf } from '../../content/report';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { planFrame } from '../../core/plan/frame';
import type { PlanInput } from '../../core/plan/types';
import { classifyField } from '../../core/resolver/resolve';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { accountLeft } from '../../dom/account-section';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult, WidgetReading } from '../../dom/types';
import { adaptersFor } from '../index';
import { jibeAdapter } from '../jibe';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { ChainStepFacts } from '../types';
import { icimsAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/jr7-*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const EXPECTS = import.meta.glob('../../../fixtures/icims/jr7-*.expect.json', { import: 'default', eager: true }) as
  Record<string, unknown>;
const ROUTES = import.meta.glob('../../../fixtures/icims/jr7-*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const JIBE = import.meta.glob(['../../../fixtures/jibe/*.html', '../../../fixtures/jibe/*.routes.json'],
  { eager: true, import: 'default', query: '?raw' }) as Record<string, string>;

const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case: its markup and its address (its route map's). */
function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? '', address };
}

/** Loads a page at its own address (a srcdoc page's base is about:srcdoc: its links resolve there). */
async function load(name: string) {
  const { html, address } = fileOf(name);
  if (html === '' || address === '') throw new Error(`no fixture ${name}`);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return { ...fixture, address };
}

function rootOf(doc: Document): Element {
  const found = icimsAdapter.detect(doc);
  if (found === null) throw new Error('no root');
  return found.formRoot;
}

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

// ---------------------------------------------------------------------------------------------------------------------
// The expectations
// ---------------------------------------------------------------------------------------------------------------------

/** Every jr7 page or frame with an expectation. */
const EXPECTED = Object.keys(EXPECTS).map((path) => path.split('/').pop()!.replace(/\.expect\.json$/, '')).sort();
const ROOTED = EXPECTED.filter((name) => readExpectation(byFile(EXPECTS, `${name}.expect.json`)).fields.length > 0);

describe('P2: the snapshot7 expectations (fixtures/icims/jr7-*.expect.json)', () => {
  it('lists every page or frame with a root, and the hooks-only pages (portals, the Assessments step, postings, '
    + 'confirmations, the two veteran forms whose Name box shows no label)', () => {
    expect(ROOTED).toEqual(['jr7-icims1-eeo.frame-1', 'jr7-icims1-iform-2.frame-2', 'jr7-icims1-login.frame-1',
      'jr7-icims1-profile-1.frame-1', 'jr7-icims1-profile-2.frame-1', 'jr7-icims1-profile-3.frame-1',
      'jr7-icims1-profile-4.frame-1', 'jr7-icims1-profile-5.frame-1', 'jr7-icims1-profile.frame-1',
      'jr7-icims2-login.frame-1', 'jr7-icims3-eeo.frame-1', 'jr7-icims3-login.frame-1', 'jr7-icims3-profile.frame-1',
      'jr7-icims3-questions.frame-1']);
    expect(EXPECTED.filter((name) => !ROOTED.includes(name))).toEqual(['jr7-icims1-confirmation.frame-1',
      'jr7-icims1-iform-1.frame-1', 'jr7-icims1-iform-1.frame-2', 'jr7-icims1-iform-2.frame-1',
      'jr7-icims1-posting.frame-1', 'jr7-icims3-assessment.frame-1', 'jr7-icims3-confirmation.frame-1',
      'jr7-icims3-iform.frame-1', 'jr7-icims3-iform.frame-2', 'jr7-icims3-posting.frame-1']);
    for (const name of EXPECTED) {
      const { address } = fileOf(name);
      expect(readExpectation(byFile(EXPECTS, `${name}.expect.json`)).source, name).toBe(address);
      const note = (byFile(EXPECTS, `${name}.expect.json`) as { note?: string }).note ?? '';
      expect(note, name).toMatch(ROOTED.includes(name) ? /^jr7 P2: / : /^Hooks only \(jr7 P2\): /);
    }
  });

  it.each(EXPECTED)('%s: every hook answers what the page shows', async (name) => {
    const fixture = await load(name);
    expect(compareHooks(fixture.doc, icimsAdapter, readHooks(byFile(EXPECTS, `${name}.expect.json`)))).toEqual([]);
  });

  it.each(ROOTED)('%s: the scan of its root is the expectation', async (name) => {
    const { html, address } = fileOf(name);
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter).toBe(icimsAdapter);
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(byFile(EXPECTS, `${name}.expect.json`))))
      .toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// RULES-7 on the adapter's readings (planned with the real planFrame; lists read as a run reads them)
// ---------------------------------------------------------------------------------------------------------------------

type Profile = ReturnType<typeof goldenProfile>;

interface Planned {
  result: ScanResult;
  specs: FieldSpec[];
  rows: readonly FillResult[];
  row(id: string): FillResult;
  write(id: string): PlannedWrite | undefined;
  awaits(id: string): boolean;
  rule(id: string): string;
}

/** Plans a loaded page as a run's first pass does, the lists in `lists` read (SYNTHETIC words), by their select's id. */
function planOn(doc: Document, extra: Partial<PlanInput> & { lists?: Readonly<Record<string, readonly string[]>> } = {}):
  Planned {
  const root = rootOf(doc);
  const first = scan(root, icimsAdapter, { platform: 'icims' });
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of first.fields) {
    const listed = extra.lists?.[first.target(field.key)!.control.id.replace(/_icimsDropdown$/, '')];
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
    result, specs, rows: plan.results,
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
/** The test clock's today (content.testkit NOW) as iCIMS's date parts spell it: "Oct", "30", "2026". */
const TODAY = { month: 'Oct', day: String(NOW.d), year: String(NOW.y) };
const YES_NO = ['Yes', 'No'];
/** SYNTHETIC: the golden profile's expected pay, a year's and an hour's (its own has none). */
const withPay = (min: number, period: 'year' | 'hour'): Profile => {
  const golden = goldenProfile();
  return { ...golden, preferences: { ...golden.preferences,
    expectedSalary: { kind: 'value', value: { min, currency: 'USD', period } } } } as Profile;
};

describe('P2: what RULES-7 decides on the snapshots', () => {
  it('ICIMS7-05 (jr7-icims1-profile.frame-1): the current job’s End Date "If presently employed put today’s date" is '
    + 'today; the profile’s Next holds for the create-login alone', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const ran = planOn(fixture.doc);
    const parts = { month: '-1_PersonProfileFields.rcf3215_Month', day: '-1_PersonProfileFields.rcf3215_Date',
      year: '-1_PersonProfileFields.rcf3215_Year' };
    for (const id of Object.values(parts)) {
      expect(ran.row(id), id).toMatchObject({ category: 'experience.endDate', status: 'verified', required: true });
    }
    expect(optionOf(ran.write(parts.month))).toBe(TODAY.month);
    expect(optionOf(ran.write(parts.day))).toBe(TODAY.day);
    expect(textOf(ran.write(parts.year))).toBe(TODAY.year);
    // None of the three is left: the step's hold counts the create-login's three boxes alone (Sign-in mode's).
    expect(lastFillOf(Object.values(parts).map((id) => ran.row(id))).flagged).toBe(0);
    expect(accountLeft(icimsAdapter, fixture.doc, rootOf(fixture.doc))).toBe(3);
    // A variant whose label asks the box be left blank for a current employer: left, never today.
    fixture.doc.getElementById('label_-1_PersonProfileFields.rcf3215')!.textContent =
      'End Date (leave blank if current employer)';
    const blank = planOn(fixture.doc);
    for (const id of Object.values(parts)) expect(blank.write(id), id).toBeUndefined();
  });

  it('ICIMS7-06: the attestations are consents, answered Yes (arc-onesolutions’ rcf2140, careers-quartzbenefits’ '
    + 'rcf2035, "… my skills …")', async () => {
    for (const [name, id] of [['jr7-icims1-profile.frame-1', 'rcf2140'], ['jr7-icims3-profile.frame-1', 'rcf2035']] as
      const) {
      const fixture = await load(name);
      const ran = planOn(fixture.doc, { lists: { [id]: YES_NO } });
      expect(ran.row(id), name).toMatchObject({ category: 'consent.other', status: 'verified' });
      expect(optionOf(ran.write(id)), name).toBe('Yes');
      expect(ran.rule(id), name).not.toBe('label.skills');
      removeFixtures(document);
    }
  });

  it('ICIMS7-07 (jr7-icims3-questions.frame-1): Q47, a background check’s willingness, is consent.backgroundCheck: '
    + 'Yes, never the criminal-history question', async () => {
    const fixture = await load('jr7-icims3-questions.frame-1');
    const ran = planOn(fixture.doc);
    expect(ran.row('Q47')).toMatchObject({ category: 'consent.backgroundCheck', status: 'verified', required: true });
    expect(optionOf(ran.write('Q47'))).toBe('Yes');
    expect(ran.rule('Q47')).not.toBe('label.criminal');
    expect(ran.awaits('Q47')).toBe(false);
  });

  it('ICIMS7-08, -13, -14 (jr7-icims1-profile.frame-1): Duties is the entry’s description; no "Other (Non Internet)" for '
    + 'LinkedIn; Other School and the licence boxes are never written nor asked', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const ran = planOn(fixture.doc);
    // ICIMS7-08: the profile's own description of the entry, never the AI's text.
    expect(ran.row('-1_PersonProfileFields.rcf3219')).toMatchObject({ category: 'experience.description',
      status: 'verified' });
    expect(textOf(ran.write('-1_PersonProfileFields.rcf3219'))).toBe(goldenProfile().experience[0]!.description);
    expect(ran.awaits('-1_PersonProfileFields.rcf3219')).toBe(false);
    // ICIMS7-13: the list holds no LinkedIn and no catch-all for it; "Other (Non Internet)" is no catch-all.
    const source = fixture.doc.getElementById('rcf3048') as HTMLSelectElement;
    expect([...source.options].some((option) => option.text.trim() === 'Other (Non Internet)')).toBe(true);
    expect(ran.row('rcf3048')).toMatchObject({ category: 'referral.source', reason: 'no-match' });
    expect(ran.write('rcf3048')).toBeUndefined();
    // ICIMS7-14.
    expect(ran.row('-1_CandProfileFields.OtherSchool')).toMatchObject({ category: 'education.school', status: 'skipped',
      reason: 'conditional-question' });
    expect(ran.row('-1_PersonProfileFields.rcf3261')).toMatchObject({ category: 'skills.certifications',
      status: 'skipped', reason: 'no-profile-value' });
    for (const id of ['-1_PersonProfileFields.rcf3262', '-1_PersonProfileFields.rcf3263']) {
      expect(ran.row(id), id).toMatchObject({ category: 'skills.certificationDetail', status: 'skipped' });
    }
    for (const id of ['-1_CandProfileFields.OtherSchool', '-1_PersonProfileFields.rcf3261', '-1_PersonProfileFields.rcf3262',
      '-1_PersonProfileFields.rcf3263']) {
      expect(ran.write(id), id).toBeUndefined();
      expect(ran.awaits(id), id).toBe(false);
    }
    // ICIMS7-13's control: a list that holds LinkedIn chooses it.
    const linkedin = fixture.doc.createElement('option');
    linkedin.value = 'LINKEDIN';
    linkedin.text = 'LinkedIn';
    source.append(linkedin);
    expect(optionOf(planOn(fixture.doc).write('rcf3048'))).toBe('LinkedIn');
  });

  it('ICIMS7-V3 (jr7-icims1-profile.frame-1): Desired Salary’s currency, amount and time frame each as itself, from a '
    + 'SYNTHETIC profile pay', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const yearly = planOn(fixture.doc, { profile: withPay(120_000, 'year') });
    expect(yearly.row('CandProfileFields.Salary_Currency')).toMatchObject({ category: 'salary.currency' });
    expect(yearly.row('CandProfileFields.Salary')).toMatchObject({ category: 'salary.expected' });
    expect(yearly.row('CandProfileFields.Salary_Timeframe')).toMatchObject({ category: 'salary.period' });
    // The page shows its first options, "USD $" and "Hr.": the currency is already the profile's; the page's "Hr."
    // beside a year's pay is never kept (O-3): the time frame is written.
    expect(yearly.row('CandProfileFields.Salary_Currency')).toMatchObject({ status: 'skipped', reason: 'already-correct' });
    expect(textOf(yearly.write('CandProfileFields.Salary'))).toBe('120000');
    expect(optionOf(yearly.write('CandProfileFields.Salary_Timeframe'))).toBe('Yr.');
    const hourly = planOn(fixture.doc, { profile: withPay(70, 'hour') });
    expect(hourly.row('CandProfileFields.Salary_Timeframe')).toMatchObject({ status: 'skipped', reason: 'already-correct' });
    expect(textOf(hourly.write('CandProfileFields.Salary'))).toBe('70');
    // A page showing another currency and another time frame: each written as the profile's.
    (fixture.doc.getElementById('CandProfileFields.Salary_Currency') as HTMLSelectElement).selectedIndex = 1;
    (fixture.doc.getElementById('CandProfileFields.Salary_Timeframe') as HTMLSelectElement).selectedIndex = 3;
    const moved = planOn(fixture.doc, { profile: withPay(70, 'hour') });
    expect(optionOf(moved.write('CandProfileFields.Salary_Currency'))).toBe('USD $');
    expect(optionOf(moved.write('CandProfileFields.Salary_Timeframe'))).toBe('Hr.');
    for (const id of ['CandProfileFields.Salary_Currency', 'CandProfileFields.Salary', 'CandProfileFields.Salary_Timeframe']) {
      expect(moved.awaits(id), id).toBe(false);
    }
  });

  it('ICIMS7-V3 with V4 (O-3): with no profile pay the time frame is no answer of ours, and the page’s own "Hr." never '
    + 'counts as filled', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const ran = planOn(fixture.doc);
    const frame = ran.row('CandProfileFields.Salary_Timeframe');
    expect(frame).toMatchObject({ category: 'salary.period', status: 'flagged', reason: 'no-profile-value' });
    expect(ran.write('CandProfileFields.Salary_Timeframe')).toBeUndefined();
    expect(ran.awaits('CandProfileFields.Salary_Timeframe')).toBe(false);
    // The page shows its first option ("Hr.") as chosen: ENGINE-7's FILLED reading keeps the row left (heldIn).
    const select = fixture.doc.getElementById('CandProfileFields.Salary_Timeframe') as HTMLSelectElement;
    expect(select.selectedIndex).toBe(0);
    const held = heldIn(ran.result.rescan(), frame);
    expect(held.detail?.filledByYou).not.toBe(true);
    expect(lastFillOf([held]).flagged).toBe(1);
  });

  it('ICIMS7-V4 (jr7-icims1-iform-1.frame-2, the (1/2) leaf): "Today’s Date" is today’s, and nothing left holds its '
    + 'Next, the page’s own prefill included', async () => {
    const fixture = await load('jr7-icims1-iform-1.frame-2');
    const ran = planOn(fixture.doc);
    const parts = { month: 'icims_f_Date_Month', day: 'icims_f_Date_Date', year: 'icims_f_Date_Year' };
    for (const id of Object.values(parts)) {
      expect(ran.row(id), id).toMatchObject({ category: 'consent.signatureDate', status: 'verified', required: true });
    }
    expect(optionOf(ran.write(parts.month))).toBe(TODAY.month);
    expect(optionOf(ran.write(parts.day))).toBe(TODAY.day);
    expect(textOf(ran.write(parts.year))).toBe(TODAY.year);
    expect(lastFillOf(ran.rows).flagged).toBe(0);
    // iCIMS prefills the date (the capture's values are dropped): a SYNTHETIC today in the three parts plans no change,
    // and holds nothing either.
    const doc = fixture.doc;
    const month = doc.getElementById(parts.month) as HTMLSelectElement;
    month.selectedIndex = [...month.options].findIndex((option) => option.text.trim() === TODAY.month);
    const day = doc.getElementById(parts.day) as HTMLSelectElement;
    day.selectedIndex = [...day.options].findIndex((option) => option.text.trim() === TODAY.day);
    (doc.getElementById(parts.year) as HTMLInputElement).value = TODAY.year;
    const prefilled = planOn(doc);
    // The two lists already show today's; the year box keeps the page's own text (prefill-kept): each done.
    expect(prefilled.row(parts.month)).toMatchObject({ status: 'skipped', reason: 'already-correct' });
    expect(prefilled.row(parts.day)).toMatchObject({ status: 'skipped', reason: 'already-correct' });
    expect(prefilled.row(parts.year)).toMatchObject({ status: 'skipped', reason: 'prefill-kept' });
    for (const id of Object.values(parts)) expect(prefilled.write(id), id).toBeUndefined();
    expect(lastFillOf(prefilled.rows).flagged).toBe(0);
  });

  it('ENGINE-7 L1 (jr7-icims1-profile.frame-1): "Other School" stands under its School list (dependsOn), as NYU’s '
    + 'companion box does, so a School search that settles no match plans it again', async () => {
    const fixture = await load('jr7-icims1-profile.frame-1');
    const doc = fixture.doc;
    const other = doc.getElementById('-1_CandProfileFields.OtherSchool')!;
    expect(icimsAdapter.dependsOn!(other)).toBe(doc.getElementById('-1_CandProfileFields.School_icimsDropdown'));
    // Only an "Other" box named by the list's own words: another wording, or another list's, stands under none.
    const label = doc.getElementById('label_-1_CandProfileFields.OtherSchool')!;
    label.textContent = 'Other Degree';
    expect(icimsAdapter.dependsOn!(other)).toBeNull();
    label.textContent = 'School Notes';
    expect(icimsAdapter.dependsOn!(other)).toBeNull();
    label.textContent = 'other  school';
    expect(icimsAdapter.dependsOn!(other)).toBe(doc.getElementById('-1_CandProfileFields.School_icimsDropdown'));
    // The other text boxes of the profile stand under no list.
    for (const box of Array.from(doc.querySelectorAll('input[type="text"]'))) {
      if (box === other || box.id === '') continue;
      expect(icimsAdapter.dependsOn!(box), box.id).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// CHAIN-7 on the snapshots: the declared origins, the portal facts, the STALE/FRESH probe
// ---------------------------------------------------------------------------------------------------------------------

/** What each IForm portal frame's bar says (chainStepFacts, measured on the snapshots by the audit). */
const ARC_FIRST: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, counters: 1,
  packet: { n: 1, m: 2 } };
const ARC_SECOND: ChainStepFacts = { ...ARC_FIRST, packet: { n: 2, m: 2 } };
const QUARTZ: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, counters: 0, packet: null };

describe('P2: the chain (CHAIN-7) on the snapshots', () => {
  it.each([['jr7-icims1-iform-1', 'https://oneblood.icims.com', ARC_FIRST],
    ['jr7-icims1-iform-2', 'https://oneblood.icims.com', ARC_SECOND],
    ['jr7-icims3-iform', 'https://quartzbenefits.icims.com', QUARTZ]] as const)(
    '%s: the claim frame names its forms origin through the registry’s adapters, and its bar’s facts',
    async (name, origin, facts) => {
      const portal = await load(`${name}.frame-1`);
      const at = new URL(portal.address);
      expect(declaredChildOrigins(portal.doc, at, (url) => adaptersFor(url), true)).toEqual([origin]);
      expect(declaredChildOrigins(portal.doc, at, (url) => adaptersFor(url), false)).toEqual([]);
      expect(icimsAdapter.chainStepFacts!(portal.doc)).toEqual(facts);
      // The leaf's own address is on that origin, and the leaf is loaded by its portal (its referrer the portal's origin,
      // its parent frame's origin the portal's: Chrome's cross-origin referrer).
      const leaf = fileOf(`${name}.frame-2`).address;
      expect(new URL(leaf).origin).toBe(origin);
      expect(loadedByPortal({ isTop: false, href: leaf, referrer: `${at.origin}/`, parent: at.origin })).toBe(true);
    });

  it('says arc-onesolutions’ declared origin in its portal frame’s hello (the real adapters)', async () => {
    const portal = await load('jr7-icims1-iform-1.frame-1');
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, portal.doc, { href: () => portal.address, isTop: true,
      ancestors: () => [], adapters: (url) => adaptersFor(url) });
    runtimes.push(runtime);
    await expect.poll(() => worker.of('frame/hello').length).toBeGreaterThan(0);
    expect(worker.of('frame/hello')[0]).toMatchObject({ childOrigins: ['https://oneblood.icims.com'] });
  });

  it('the verifier’s STALE/FRESH probe (jr7-icims1-iform-2.frame-2): the (2/2) leaf with the (1/2) facts is not final, '
    + 'its Submit a Next; with its own (2/2) facts final, its Submit the Submit', async () => {
    const leaf = await load('jr7-icims1-iform-2.frame-2');
    const root = rootOf(leaf.doc);
    const button = leaf.doc.querySelector<HTMLInputElement>('input[name="icims_submit"]')!;
    // No facts: unknown, nothing pressed.
    expect(icimsAdapter.isFinalStep!(leaf.doc)).toBe('unknown');
    expect(icimsAdapter.nextButton!(root)).toBeNull();
    expect(icimsAdapter.submitButton!(root)).toBeNull();
    // STALE: the (1/2) step's facts.
    expect(icimsAdapter.isFinalStep!(leaf.doc, ARC_FIRST)).toBe('not-final');
    expect(icimsAdapter.nextButton!(root, ARC_FIRST)).toBe(button);
    expect(icimsAdapter.submitButton!(root, ARC_FIRST)).toBeNull();
    // FRESH: its own (2/2).
    expect(icimsAdapter.isFinalStep!(leaf.doc, ARC_SECOND)).toBe('final');
    expect(icimsAdapter.nextButton!(root, ARC_SECOND)).toBeNull();
    expect(icimsAdapter.submitButton!(root, ARC_SECOND)).toBe(button);
    // The leaf runtime's view reads the facts it holds (CHAIN-7's leafAdapter), here the fresh ones its portal said.
    const portal = new URL(fileOf('jr7-icims1-iform-2.frame-1').address);
    expect(holdChainFacts(leaf.doc, ARC_SECOND, { isTop: false, href: leaf.address, referrer: `${portal.origin}/`,
      parent: portal.origin })).toBe(true);
    const view = leafAdapter(icimsAdapter, { isTop: false, href: leaf.address });
    expect(view.isFinalStep!(leaf.doc)).toBe('final');
    expect(view.submitButton!(root)).toBe(button);
  });

  it('careers-quartzbenefits’ leaf with its portal’s facts is the application’s last form (only Assessments after it)',
    async () => {
      const leaf = await load('jr7-icims3-iform.frame-2');
      const root = rootOf(leaf.doc);
      const button = leaf.doc.querySelector<HTMLInputElement>('input[name="icims_submit"]')!;
      expect(icimsAdapter.isFinalStep!(leaf.doc, QUARTZ)).toBe('final');
      expect(icimsAdapter.submitButton!(root, QUARTZ)).toBe(button);
      expect(icimsAdapter.nextButton!(root, QUARTZ)).toBeNull();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// AUTO-7 on the snapshots: the hand-over and the Jibe posting's address in the hello
// ---------------------------------------------------------------------------------------------------------------------

describe('P2: what the runtime tells the worker (AUTO-7)', () => {
  it('ICIMS7-04 (jr7-icims3-assessment.frame-1): the Assessments step’s hello says its hand-over; a step’s does not',
    async () => {
      for (const [name, handOver] of [['jr7-icims3-assessment.frame-1', 'assessment'],
        ['jr7-icims3-questions.frame-1', undefined]] as const) {
        const page = await load(name);
        const worker = createFakeWorker();
        runtimes.push(await startContentRuntime(worker.platform, page.doc, { href: () => page.address, isTop: true,
          ancestors: () => [], adapters: (url) => adaptersFor(url) }));
        await expect.poll(() => worker.of('frame/hello').length).toBeGreaterThan(0);
        expect((worker.of('frame/hello')[0] as { handOver?: string }).handOver, name).toBe(handOver);
        for (const runtime of runtimes.splice(0)) runtime.stop();
        removeFixtures(document);
      }
    });

  it('ICIMS7-11 (fixtures/jibe/jr7-icims2-jibe-posting): the Jibe posting’s hello names the job’s iCIMS posting',
    async () => {
      const html = byFile(JIBE, 'jr7-icims2-jibe-posting.html')!;
      const address = Object.keys(JSON.parse(byFile(JIBE, 'jr7-icims2-jibe-posting.routes.json')!) as object)[0]!;
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      const worker = createFakeWorker();
      runtimes.push(await startContentRuntime(worker.platform, fixture.doc, { href: () => address, isTop: true,
        ancestors: () => [], adapters: (url) => adaptersFor(url) }));
      expect(adaptersFor(new URL(address))[0]).toBe(jibeAdapter);
      await expect.poll(() => worker.of('frame/hello').length).toBeGreaterThan(0);
      expect(worker.of('frame/hello')[0]).toMatchObject({ isTop: true, hasForm: false,
        tailoritAddress: 'https://arc-onesolutions.icims.com/jobs/17204/job' });
    });
});
