/*
 * jr7 WORKDAY-7 P2 (FIX7PLAN §6.6 "P2 asserts"; §6.4 item 7): what the merged engine, rules and runtime make of the
 * owner's snapshot7 Workday captures (jr7-workday.testkit.ts), after jr7-engine-e2, jr7-rules-r2, jr7-auto-done and
 * jr7-chain-done:
 * - RULES-7's Workday items on the steps they were found on, planned as a run plans them (the golden synthetic profile,
 *   DEFAULT_SETTINGS, the posting's company): WD7-01, WD7-02 with WD7V-01 (O-4: one commit, asked only together),
 *   WD7-03, WD7-09, WD7-10, WD7-11, WD7-12, WD7V-02, and the gated WD7-07 and WD7-08 at their defaults (Q7-3, Q7-4: the
 *   person's);
 * - WD7-04 and WD7-05 through AUTO-7's content runtime: each tenant's Review, the person's own Submit, then Workday's
 *   single-page route to the page after submitting in the same document: the address sign (confirmationAfter) under
 *   the Review's key, and, where the worker does not take it, the drawn sign once its dialog has faded in, with no
 *   later change of the page;
 * - the worker's own reading (background/submissions.ts confirmationAfterOf) with the address its arm keeps
 *   (job-cards.ts lookupAddressOf: the posting's canonical address).
 * A capture taken filled is set back to before its answers first (`unanswer`); a list no capture shows open gets the
 * words Workday tenants commonly use (`assumedList`, named so in each test). No value of the owner's is read: the
 * fixtures hold REDACTED where the owner's answers were, and the plans use the golden synthetic profile.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import { lookupAddressOf } from '../../background/job-cards';
import { confirmationAfterOf } from '../../background/submissions';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { deadline } from '../../dom/time';
import type { WidgetReading } from '../../dom/types';
import { applicationOf } from '../index';
import { successSignsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { WORKDAY_SUCCESS, workdayAdapter } from './index';
import { byName, COMPANY, FOLDERS, type Case } from './jr7-workday.testkit';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// ── The plan of a step ──────────────────────────────────────────────────────────────────────────────────────────────

/** A capture taken filled set back to before the person's answers (jr6-workday's `unanswer`): each dropdown's chosen
 *  answer (REDACTED by the converter) back to "Select One", as Workday draws an empty one, and each prompt's pills
 *  taken away. */
function unanswer(doc: Document): void {
  for (const button of Array.from(doc.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'))) {
    if ((button.getAttribute('value') ?? '') === '') continue;
    const field = button.closest('[data-automation-id^="formField-"]');
    const label = words(field?.querySelector('label, legend')).replace(/\*/g, '').trim();
    const star = (field?.querySelector('label abbr, legend abbr') ?? null) !== null;
    button.setAttribute('value', '');
    button.textContent = 'Select One';
    button.setAttribute('aria-label', `${label} Select One${star ? ' Required' : ''}`);
  }
  for (const pill of Array.from(doc.querySelectorAll('[data-automation-id="selectedItem"]'))) {
    (pill.closest('li') ?? pill).remove();
  }
}

/** The list a closed dropdown gets by its question (no capture shows these lists open: the words Workday tenants
 *  commonly use); none for any other, which stays waiting for its options. */
function assumedList(label: string): readonly string[] | null {
  if (/\bpreferred language\b/i.test(label)) return ['English', 'Spanish', 'French'];
  if (/^(?:are|do|does|have|has|will|is|can|did|would|were|if)\b/i.test(label)) return ['Yes', 'No'];
  return null;
}

/** What the plan asks TailorIT's AI about a field: a classification, an answer, a draft, or nothing. */
function askOf(plan: PlanOutput, key: FieldSpec['key']): 'classify' | 'answer' | 'draft' | null {
  if (plan.ask?.classify.some((item) => item.key === key) === true) return 'classify';
  if (plan.ask?.answers?.some((item) => item.key === key) === true) return 'answer';
  if (plan.ask?.drafts?.some((item) => item.key === key) === true) return 'draft';
  return null;
}

/** A step planned as the run plans it: set back to before its answers, each closed dropdown read with its assumed list
 *  (a "Select One" row first, never chosen, as Workday draws it), scanned again, then planFrame with the golden
 *  profile, DEFAULT_SETTINGS and the posting's company. */
async function stepPlan(item: Case) {
  const { doc } = await loadFixture(document, item.html, SNAPSHOT_VIEWPORT);
  unanswer(doc);
  const root = workdayAdapter.detect(doc)!.formRoot;
  const readings = new Map<BaseKey, WidgetReading>();
  for (const field of scan(root, workdayAdapter, { platform: 'workday' }).fields) {
    const labels = field.kind === 'combobox' && field.options === 'lazy' ? assumedList(field.label) : null;
    if (labels === null) continue;
    readings.set(field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: [{ label: 'Select One', disabled: true }, ...labels.map((label) => ({ label, disabled: false }))] });
  }
  const specs = scan(root, workdayAdapter, { platform: 'workday', widgetReadings: readings }).fields.map(toFieldSpec);
  const kinds = workdayAdapter.repeatables!(root).map((section) => section.kind);
  const plan = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: COMPANY[item.folder], location: 'Austin, TX, USA' },
    ...(kinds.length > 0 ? { repeatables: kinds.map((kind) => ({ kind, entries: null })) } : {}) });
  const specOf = (label: RegExp): FieldSpec => {
    const found = specs.filter((spec) => label.test(spec.label));
    expect(found, String(label)).toHaveLength(1);
    return found[0]!;
  };
  return {
    specs, plan, specOf,
    row: (label: RegExp): FillResult => plan.results.find((row) => row.key === specOf(label).key)!,
    write: (label: RegExp): PlannedWrite | undefined => plan.writes.find((write) => write.key === specOf(label).key),
    ask: (label: RegExp) => askOf(plan, specOf(label).key),
  };
}

const optionOf = (write: PlannedWrite | undefined) => (write?.value.kind === 'option' ? write.value.cleanLabel
  : undefined);

/** The employers' own questions (their words, as the pages draw them). */
const Q = {
  sponsorship: /^Will you now, or in the future, require any immigration filing or visa sponsorship by Aristocrat/,
  entitlement: /^Do you currently have the right\/entitlement to work in the country where the job is located\?$/,
  noticePeriod: /^What is your notice period in weeks, if applicable\?$/,
  preferredLanguage: /^What is your preferred language for written communications\?$/,
  experience: /^Do you have \d+ years of experience with /,
  military: /^Please list any job related military experience or skills$/,
  begin: /^If hired, when can you begin work\?$/,
  previousEmployee: /^Please select if you were a previous Unity employee\.$/,
  previouslyWorked: /^Have you previously worked at Unity, and if so, in what capacity\?$/,
  exportControl: /^For the purpose of determining if an export control license may be required/,
  aiTranscripts: /^Do you consent to the use of AI to create written transcripts and summaries of your interviews\?$/,
};

describe('jr7 WORKDAY-7 P2: RULES-7’s Workday items on the steps they were found on (golden profile)', () => {
  it('aristocrat’s Application Questions: WD7-01, WD7-09, WD7-02 with WD7V-01, WD7V-02 (assumed lists)', async () => {
    const step = await stepPlan(byName('jr7-workday1-application-questions-blank'));
    // WD7-01: "require any immigration filing or visa sponsorship" is the sponsorship question: the golden "No".
    expect(step.row(Q.sponsorship)).toMatchObject({ kind: 'combobox', category: 'workAuth.sponsorship' });
    expect(optionOf(step.write(Q.sponsorship))).toBe('No');
    // WD7-09: "right/entitlement to work" is the authorization question: "Yes".
    expect(step.row(Q.entitlement)).toMatchObject({ kind: 'combobox', category: 'workAuth.authorized' });
    expect(optionOf(step.write(Q.entitlement))).toBe('Yes');
    // WD7-02 + WD7V-01 (O-4): the required notice period is a textarea of its own question, no follow-up box of the
    // consent before it, so it is asked of TailorIT's AI (the golden profile has no notice period).
    const notice = step.specOf(Q.noticePeriod);
    expect(notice).toMatchObject({ kind: 'textarea', required: true });
    expect(step.row(Q.noticePeriod)).toMatchObject({ category: 'availability.noticePeriod', reason: 'no-profile-value' });
    expect(step.ask(Q.noticePeriod)).toBe('answer');
    expect(step.write(Q.noticePeriod)).toBeUndefined();
    // WD7V-02: the preferred language of written communications is the profile's native language (assumed list).
    expect(step.row(Q.preferredLanguage)).toMatchObject({ kind: 'combobox', category: 'languages.preferred' });
    expect(optionOf(step.write(Q.preferredLanguage))).toBe('English');
  });

  it('republic’s Application Questions 2 of 2: WD7-03, both experience questions asked of the AI', async () => {
    const step = await stepPlan(byName('jr7-workday2-application-questions-2-filled'));
    const asked = step.specs.filter((spec) => Q.experience.test(spec.label));
    expect(asked).toHaveLength(2);
    // "problem identification techniques" is a work task, never an identifier (WD7-03): asked as its neighbour is.
    expect(asked.map((spec) => /\bidentification\b/.test(spec.label))).toEqual([false, true]);
    for (const spec of asked) {
      expect(step.plan.results.find((row) => row.key === spec.key)).toMatchObject({ category: 'experience.yearsIn' });
      expect(askOf(step.plan, spec.key), spec.label.slice(0, 60)).toBe('answer');
    }
  });

  it('republic’s Application Questions 1 of 2: WD7-11 the military question left empty, WD7-12 the start asked', async () => {
    const step = await stepPlan(byName('jr7-workday2-application-questions-1-filled'));
    // WD7-11: the profile's skills are never written into a military-experience question (optional): left empty.
    expect(step.specOf(Q.military)).toMatchObject({ kind: 'textarea', required: false });
    expect(step.row(Q.military).category).not.toBe('skills.list');
    expect(step.write(Q.military)).toBeUndefined();
    // WD7-12: "when can you begin work" is the start date: asked of the AI (the golden profile gives none).
    expect(step.row(Q.begin)).toMatchObject({ category: 'availability.startDate' });
    expect(step.ask(Q.begin)).toBe('answer');
    // And the sponsorship question of this tenant's own words stays "No" (WD7-01's family).
    const sponsorship = step.specs.find((spec) => /require employment-based immigration sponsorship/.test(spec.label))!;
    expect(optionOf(step.plan.writes.find((write) => write.key === sponsorship.key))).toBe('No');
  });

  it('unity’s My Information: WD7-10, the previous-employee choice is "No"', async () => {
    const step = await stepPlan(byName('jr7-workday3-my-information-blank'));
    expect(step.row(Q.previousEmployee)).toMatchObject({ kind: 'radio', category: 'screening.previouslyEmployed' });
    expect(optionOf(step.write(Q.previousEmployee))).toBe('No');
  });

  it('unity’s Application Questions: WD7-10 again; WD7-07 and WD7-08 stay the person’s (Q7-3, Q7-4 defaults)', async () => {
    const step = await stepPlan(byName('jr7-workday3-application-questions-filled'));
    expect(step.row(Q.previouslyWorked)).toMatchObject({ category: 'screening.previouslyEmployed' });
    expect(optionOf(step.write(Q.previouslyWorked))).toBe('No');
    for (const question of [Q.exportControl, Q.aiTranscripts]) {
      expect(step.row(question), String(question)).toMatchObject({ needsUserAction: true });
      expect(step.write(question), String(question)).toBeUndefined();
      expect(step.ask(question), String(question)).toBeNull();
    }
    expect(step.row(Q.aiTranscripts)).toMatchObject({ category: 'consent.aiAttestation' });
  });
});

// ── WD7-04 and WD7-05 through AUTO-7's runtime ──────────────────────────────────────────────────────────────────────

/** A capture loaded at its own address (a <base>), its form's own submission held (the page's script sends none). */
async function served(item: Case): Promise<Fixture> {
  const fixture = await loadFixture(document, item.html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = item.source.href;
  fixture.doc.head.prepend(base);
  fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
  return fixture;
}

/** The person's own trusted click on Review's Submit (the adapter's submitButton). */
async function personSubmits(fixture: Fixture): Promise<void> {
  const root = workdayAdapter.detect(fixture.doc)!.formRoot;
  const submit = workdayAdapter.submitButton!(root)!;
  submit.scrollIntoView({ block: 'center' });
  const at = submit.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

/** Workday's single-page app stood in for: the page after submitting drawn in the same document (its styles and body),
 *  then the address changed to its own and the route told (popstate), as the live app's history change is. */
function routeTo(fixture: Fixture, item: Case, setHref: (href: string) => void): void {
  const next = new DOMParser().parseFromString(item.html, 'text/html');
  for (const style of Array.from(fixture.doc.head.querySelectorAll('style'))) style.remove();
  for (const style of Array.from(next.head.querySelectorAll('style'))) fixture.doc.head.append(fixture.doc.importNode(style, true));
  fixture.doc.body.replaceWith(fixture.doc.importNode(next.body, true));
  fixture.doc.querySelector('base')?.setAttribute('href', item.source.href);
  setHref(item.source.href);
  fixture.view.dispatchEvent(new fixture.view.PopStateEvent('popstate'));
}

/** Review, the person's Submit, the route to the page after submitting; `script` answers the worker's messages. */
async function submitThenRoute(folder: Case['folder'], script: Record<string, unknown[]> = {}) {
  const review = byName(`jr7-${folder}-review`);
  const confirmation = byName(`jr7-${folder}-confirmation`);
  let href = review.source.href;
  const fixture = await served(review);
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, script });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => [workdayAdapter], settle: { quietMs: 120 } });
  runtimes.push(runtime);
  const key = applicationOf(review.source)!.applicationKey;
  await deadline(800);
  await personSubmits(fixture);
  await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ applicationKey: key })]),
    { timeout: 10_000 });
  routeTo(fixture, confirmation, (next) => { href = next; });
  return { fixture, worker, key };
}

describe('jr7 WORKDAY-7 P2: WD7-05 and WD7-04 through AUTO-7’s runtime (Review → Submit → the page after submitting)', () => {
  it.each(FOLDERS)('%s: the route is the Submit’s confirmation-page, under the Review’s key, once (WD7-05)', async (folder) => {
    const { worker, key } = await submitThenRoute(folder);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: key,
      evidence: 'confirmation-page' })]), { timeout: 8_000 });
    await deadline(600);
    expect(worker.of('submit/detected')).toHaveLength(1);
  }, 60_000);

  it.each(['workday2', 'workday3'] as const)(
    '%s: with the address sign not taken, the drawn sign once its dialog faded in, no later change of the page (WD7-04)',
    async (folder) => {
      const { fixture, worker, key } = await submitThenRoute(folder, { 'submit/detected': [{ ok: false, error: 'expired' }] });
      await vi.waitFor(() => expect(worker.of('submit/detected').map((each) => each.evidence))
        .toEqual(['confirmation-page', 'success-message']), { timeout: 10_000 });
      expect(worker.of('submit/detected').every((each) => each.applicationKey === key)).toBe(true);
      // The sign is the tenant's dialog, read by WORKDAY_SUCCESS's rules (republic's first, unity's third).
      expect(successSignsOf(fixture.doc, WORKDAY_SUCCESS).length).toBeGreaterThan(0);
    }, 60_000);

  it('workday1: aristocrat’s own words read no drawn rule, so its address is its sign here (the fourth needs a real address)',
    async () => {
      const { fixture, worker } = await submitThenRoute('workday1', { 'submit/detected': [{ ok: false, error: 'expired' }] });
      await vi.waitFor(() => expect(worker.of('submit/detected').map((each) => each.evidence)).toEqual(['confirmation-page']),
        { timeout: 8_000 });
      await deadline(1_500);
      expect(successSignsOf(fixture.doc, WORKDAY_SUCCESS)).toEqual([]);
      // The fourth rule reads the document's own address, which a srcdoc fixture has none of (P1 asserts it there).
      expect(worker.of('submit/detected').map((each) => each.evidence)).toEqual(['confirmation-page']);
    }, 60_000);
});

describe('jr7 WORKDAY-7 P2: the worker reads the page after submitting with the address its arm keeps', () => {
  it.each(FOLDERS)('%s: confirmationAfterOf(workday, the arm’s lookup address, the confirmation)', (folder) => {
    const review = byName(`jr7-${folder}-review`);
    const armed = new URL(lookupAddressOf(review.source.href));
    // The arm keeps the posting's canonical address (no locale, no /apply): what TailorIT records Applied with.
    expect(armed.pathname).not.toMatch(/\/apply\b|^\/en-US\//);
    expect(confirmationAfterOf('workday', armed, byName(`jr7-${folder}-confirmation`).source)).toBe(true);
    expect(confirmationAfterOf('workday', armed, review.source)).toBe(false);
    for (const other of FOLDERS.filter((each) => each !== folder)) {
      expect(confirmationAfterOf('workday', armed, byName(`jr7-${other}-confirmation`).source), other).toBe(false);
    }
  });
});
