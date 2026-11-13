/*
 * jr7 ORACLE-7 P2 (FIX7PLAN §6.10 "P2"): the shared outcomes on the owner's snapshot7 oraclecloud1 captures
 * (fixtures/oracle/jr7-oraclecloud1-*), once ENGINE-7 E2, RULES-7 r2, AUTO-7 and CHAIN-7 are merged:
 * - jr7-O1: after the run's own Submit, Oracle's checklist then its code dialog: the run pauses email-code and says
 *   nothing of an unconfirmed Submit (ENGINE-7 E2 item 3); its report is the one AUTO-7's agent keeps the tab for
 *   (needs-you email_code after the job's Submit: background/agent.test.ts "jr7-O1 part 4"); the person's code then
 *   records it by Oracle's network signs;
 * - jr7-O2: the route to my-profile alone records nothing (the worker waits for the keyed tile: AUTO-7's
 *   ROUTE_WAITS_FOR_SIGN), and the armed application's tile drawn there is the success sign under the arm's key;
 *   another application's tile none;
 * - jr7-O4 and jr7-O6: the rows RULES-7 reads on the section captures (the tile editors' labels as drawn; the lone
 *   Hispanic or Latino box);
 * - jr7-O7: Submit Auto holds on the blank section while its required Skills block is empty (ENGINE-7 E1 item 10).
 * The profile is the golden synthetic one (fixtures/profiles/alex-rivera.*) or a variant built in code; values made up.
 * Nothing here prints or keeps a value, and nothing is sent to a real site.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import blankHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-blank.html?raw';
import filledHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-filled.html?raw';
import editorAHtml from '../../../fixtures/oracle/jr7-oraclecloud1-section-editor-a.html?raw';
import codeHtml from '../../../fixtures/oracle/jr7-oraclecloud1-submit-code.html?raw';
import confirmationHtml from '../../../fixtures/oracle/jr7-oraclecloud1-confirmation.html?raw';
import { agentVerdict } from '../../background/agent';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { planFrame } from '../../core/plan/frame';
import type { RepeatableRequest } from '../../core/steps/blocks';
import type { FieldSpec } from '../../core/types/field';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { encodeNetSign, SUBMIT_NET_EVENT } from '../../dom/submit-net-protocol';
import { deadline } from '../../dom/time';
import { PAGE_COPY } from '../../shared/copy';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { oracleAdapter } from './index';

const SITE = 'https://fa-extu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1';
const JOB = `${SITE}/job/4285`;
const SECTION = `${JOB}/apply/section/1/`;
const PROFILE = `${SITE}/my-profile`;
const ARMED = applicationOf(new URL(SECTION))!.applicationKey;
const AUTO: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto', next: 'auto' } };

/** The page's own base address (a srcdoc page's is about:srcdoc): its links resolve there, and the adapter reads it. */
function setBase(doc: Document, address: string): HTMLBaseElement {
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
  return base;
}

/** The page once its fade-ins have run, as a person sees it. */
function faded(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
  }
}

/** Only the blocks whose kind `kinds` names: a form Submit mode Auto presses (or holds) with the golden profile. */
function keepBlocks(doc: Document, kinds: RegExp): void {
  for (const block of Array.from(doc.querySelectorAll('.apply-flow-block'))) {
    if (!kinds.test(block.className)) block.remove();
  }
}

/** A pressed button's name: its words, else its aria-label (a cx-select's toggle: "Open the drop-down list for ..."). */
const nameOf = (button: Element) => (button.textContent ?? '').replace(/\s+/g, ' ').trim()
  || (button.getAttribute('aria-label') ?? '');

/** The presses that are neither a list's toggle (a run reads a cx-select's list by its toggle) nor anything else a
 *  fill may press: the step buttons and the never-pressed ones a test looks for. */
const stepPresses = (pressed: readonly string[]) => pressed.filter((name) => !name.startsWith('Open the drop-down list'));

/** One element of another capture, copied into `doc` as nodes. */
function copiedFrom(html: string, selector: string, doc: Document): Element {
  const holder = new DOMParser().parseFromString(html, 'text/html');
  return doc.importNode(holder.querySelector(selector)!, true);
}

/** Oracle's checklist after the Submit (capture 7: div.app aria-hidden under its modal), then its code dialog beside the
 *  hidden form (capture 8), the modal gone. */
async function codeAfterChecklist(doc: Document): Promise<void> {
  doc.querySelector('div.app')!.setAttribute('aria-hidden', 'true');
  await deadline(900);
  const form = doc.querySelector<HTMLElement>('form.apply-flow__content-form')!;
  form.style.display = 'none';
  form.setAttribute('aria-hidden', 'true');
  const holder = doc.createElement('div');
  holder.className = 'apply-flow__content';
  holder.append(copiedFrom(codeHtml, '.apply-flow-summary-pin-code-required', doc));
  doc.querySelector('section.apply-flow__content-container')!.append(holder);
  doc.querySelector('div.app')!.setAttribute('aria-hidden', 'false');
}

afterEach(() => removeFixtures(document));

describe('jr7 ORACLE-7 P2: a run on oraclecloud1 after its Submit', () => {
  beforeAll(() => testVocab());
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });

  /** The blank section trimmed to its contact and e-signature blocks, filled and submitted by Submit mode Auto; the
   *  page's own route kept in `href` (a popstate tells the runtime). */
  async function submitted(script: Record<string, unknown[]> = {}) {
    const fixture = await loadFixture(document, blankHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const base = setBase(doc, SECTION);
    faded(doc);
    keepBlocks(doc, /\bapply-flow-block--(?:personal-information-basic|apply-flow-e-signature)\b/);
    const pressed: string[] = [];
    doc.addEventListener('click', (event) => {
      const button = (event.target as Element).closest('button');
      if (button !== null) pressed.push(nameOf(button));
      event.preventDefault();
    }, true);
    let href = SECTION;
    const worker = createFakeWorker({ settings: AUTO, script });
    const runtime = await startContentRuntime(worker.platform, doc, { href: () => href, isTop: true,
      adapters: () => [oracleAdapter], settle: { quietMs: 40 }, submitConfirmMs: 4_000, submitWatchMs: 60_000 });
    runtimes.push(runtime);
    await runtime.fill();
    await vi.waitFor(() => expect(worker.of('submit/armed').length).toBe(1), { timeout: 60_000 });
    const route = (next: string) => {
      href = next;
      base.href = next;
      fixture.view.dispatchEvent(new fixture.view.PopStateEvent('popstate'));
    };
    return { fixture, doc, worker, runtime, pressed, route };
  }

  it('jr7-O1: the code at Submit is an email-code pause, no Submit unconfirmed beside it; the agent keeps the tab for it, '
    + 'and the person’s code then records it by Oracle’s network signs', async () => {
    const { doc, worker, pressed } = await submitted();
    expect(stepPresses(pressed)).toEqual(['Submit']);
    const armedAt = worker.reports.length;
    await codeAfterChecklist(doc);
    await vi.waitFor(() => expect(worker.reports.slice(armedAt).some((report) => report.status === 'handoff'
      && report.pauseReason === 'email-code')).toBe(true), { timeout: 15_000 });
    // Past the Submit's confirm wait (4 s here, SUBMIT_CONFIRM_MS in the product): ENGINE-7 E2 item 3 adds nothing.
    await deadline(5_000);
    const after = worker.reports.slice(armedAt);
    const paused = after.findIndex((report) => report.status === 'handoff');
    expect(after.slice(paused).flatMap((report) => report.notices.map((notice) => notice.code)))
      .not.toContain('submit-unconfirmed');
    // The report AUTO-7's agent reads after the job's own Submit (submit/armed sent: its pressedAt): needs-you
    // email_code, its tab kept and its window flagged (background/agent.test.ts, "jr7-O1 part 4").
    const last = after.at(-1)!;
    expect([last.status, last.pauseReason]).toEqual(['handoff', 'email-code']);
    expect(agentVerdict(last, { retried: false })).toEqual({ kind: 'finish', state: 'needs-you', reason: 'email_code' });
    // Nothing typed into the code, Verify never pressed.
    expect(Array.from(doc.querySelectorAll<HTMLInputElement>('input.pin-code-input__input'))
      .filter((box) => box.value !== '').length).toBe(0);
    expect(stepPresses(pressed)).toEqual(['Submit']);
    // The person types the code and Verify: Oracle's CREATE then CONFIRM answers (synthetic signs) record it, once.
    doc.dispatchEvent(new CustomEvent(SUBMIT_NET_EVENT, { detail: encodeNetSign('oracle-created') }));
    doc.dispatchEvent(new CustomEvent(SUBMIT_NET_EVENT, { detail: encodeNetSign('oracle-confirmed') }));
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: ARMED, evidence: 'network' })]), { timeout: 10_000 });
  }, 120_000);

  it('jr7-O2: the route to my-profile alone records nothing; the armed application’s tile there is its sign, once',
    async () => {
      // The worker refuses the route's confirmation (AUTO-7: Oracle's waits for its keyed tile).
      const { doc, worker, route } = await submitted({ 'submit/detected': [{ ok: false, error: 'expired' }] });
      doc.querySelector<HTMLElement>('form.apply-flow__content-form')!.style.display = 'none';
      route(PROFILE);
      await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
        applicationKey: ARMED, evidence: 'confirmation-page' })]), { timeout: 10_000 });
      // My Applications draws its tiles once loaded: the captured posting's tile (kept by the converter).
      doc.querySelector('section.apply-flow__content-container')!.append(copiedFrom(confirmationHtml, 'cs-applications', doc));
      await vi.waitFor(() => expect(worker.of('submit/detected').map((each) => [each.applicationKey, each.evidence]))
        .toEqual([[ARMED, 'confirmation-page'], [ARMED, 'success-message']]), { timeout: 10_000 });
      await deadline(1_000);
      expect(worker.of('submit/detected')).toHaveLength(2);
    }, 120_000);

  it('jr7-O2: another application’s tile at my-profile is no sign of this one', async () => {
    const { doc, worker, route } = await submitted({ 'submit/detected': [{ ok: false, error: 'expired' }] });
    doc.querySelector<HTMLElement>('form.apply-flow__content-form')!.style.display = 'none';
    route(PROFILE);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toHaveLength(1), { timeout: 10_000 });
    const tiles = copiedFrom(confirmationHtml, 'cs-applications', doc);
    tiles.querySelector('a.cs-job-info__title')!.setAttribute('href', `${SITE}/job/4286`);
    doc.querySelector('section.apply-flow__content-container')!.append(tiles);
    await deadline(2_000);
    expect(worker.of('submit/detected').map((each) => each.evidence)).toEqual(['confirmation-page']);
  }, 120_000);

  it('jr7-O7: Submit Auto holds on the blank section while its required Skills block is empty', async () => {
    const fixture = await loadFixture(document, blankHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    setBase(doc, SECTION);
    faded(doc);
    keepBlocks(doc, /\bapply-flow-block--(?:personal-information-basic|skill|apply-flow-e-signature)\b/);
    const pressed: string[] = [];
    doc.addEventListener('click', (event) => {
      const button = (event.target as Element).closest('button');
      if (button !== null) pressed.push(nameOf(button));
      event.preventDefault();
    }, true);
    const worker = createFakeWorker({ settings: AUTO });
    const runtime = await startContentRuntime(worker.platform, doc, { href: () => SECTION, isTop: true,
      adapters: () => [oracleAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    await deadline(1_500);
    expect(worker.of('submit/armed')).toEqual([]);
    expect(stepPresses(pressed)).toEqual([]);
    const report = worker.reports.at(-1)!;
    expect(report.notices.map((notice) => notice.code)).toContain('submit-held-required');
    expect(report.fields.filter((row) => row.label === PAGE_COPY.requiredBlockLeft('Skills'))
      .map((row) => [row.status, row.required, row.needsUserAction])).toEqual([['flagged', true, true]]);
    expect(agentVerdict(report, { retried: false })).toEqual({ kind: 'finish', state: 'needs-you',
      reason: 'required_field_empty' });
  }, 120_000);
});

// ── jr7-O4 and jr7-O6: the rows RULES-7 reads ───────────────────────────────────────────────────────────────────────
describe('jr7 ORACLE-7 P2: the section captures’ rows (RULES-7)', () => {
  beforeAll(() => testVocab());

  async function load(html: string): Promise<Document> {
    const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
    setBase(fixture.doc, SECTION);
    faded(fixture.doc);
    return fixture.doc;
  }

  /** The frame's plan with `profile` (the golden one by default), its repeatable sections requested with the entries
   *  their open editors show (prefill.readEntries), as the runtime asks the worker. */
  function planned(doc: Document, profile: Profile = goldenProfile()) {
    const root = oracleAdapter.detect(doc)!.formRoot;
    const result = scan(root, oracleAdapter, { platform: 'oracle' });
    const specs: FieldSpec[] = result.fields.map(toFieldSpec);
    const sections = oracleAdapter.repeatables?.(root) ?? [];
    const repeatables: RepeatableRequest[] = sections.map((section) => ({ kind: section.kind, entries: null,
      shown: oracleAdapter.prefill?.readEntries?.(section.kind, section.blocks()) ?? [] }));
    const plan = planFrame({ specs, canaries: [], profile, sensitiveState: 'loaded', savedAnswers: [],
      settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
      posting: { company: 'Acme', location: 'Austin, TX, USA' }, ...(repeatables.length > 0 ? { repeatables } : {}) });
    const row = (label: string) => {
      const found = plan.results.filter((one) => one.label === label);
      expect(found, label).toHaveLength(1);
      return found[0]!;
    };
    const writes = (label: string) => plan.writes.filter((write) => write.key === row(label).key);
    return { plan, row, writes };
  }

  it('jr7-O4: the Education editor’s rows are the entry’s, and an entry no profile entry matches is kept as it is',
    async () => {
      const doc = await load(filledHtml);
      const { row } = planned(doc);
      expect(Object.fromEntries(['Degree', 'Major', 'Education Institution'].map((label) => [label, row(label).category])))
        .toEqual({ Degree: 'education.degree', Major: 'education.field', 'Education Institution': 'education.school' });
      expect(row('Education Institution').key).toMatch(/\|education\[0\]\|/);
      // The opened tile's entry, as Oracle shows it in its box (made up): no profile entry matches it, so nothing of the
      // profile is written over it.
      doc.querySelector<HTMLInputElement>('input[name="educationalEstablishment"]')!.value = 'Riverside College of Art';
      const kept = planned(doc);
      expect(['Degree', 'Major', 'Education Institution'].flatMap((label) => kept.writes(label))).toEqual([]);
    });

  it('jr7-O4: the Experience editor’s rows are the entry’s: its city, country and duties, never the person’s address',
    async () => {
      const doc = await load(editorAHtml);
      const { row } = planned(doc);
      expect(Object.fromEntries(['Employer Name', 'Job Title', 'Employer City', 'Employer Country', 'Responsibilities',
        'Current Job'].map((label) => [label, row(label).category]))).toEqual({ 'Employer Name': 'experience.company',
        'Job Title': 'experience.title', 'Employer City': 'experience.city', 'Employer Country': 'experience.country',
        Responsibilities: 'experience.description', 'Current Job': 'experience.current' });
      for (const label of ['Employer City', 'Employer Country']) expect(row(label).key, label).toMatch(/\|experience\[0\]\|/);
      // The opened tile's entry (made up), matched by no profile entry: kept, nothing written over it.
      doc.querySelector<HTMLInputElement>('input[name="employerName"]')!.value = 'Harborline Freight';
      doc.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value = 'Dispatcher';
      const kept = planned(doc);
      expect(['Employer Name', 'Job Title', 'Employer City', 'Responsibilities'].flatMap((label) => kept.writes(label)))
        .toEqual([]);
    });

  it('jr7-O6: the lone Hispanic or Latino box reads already correct for a decline, and is ticked for an explicit yes',
    async () => {
      const doc = await load(blankHtml);
      const declined = planned(doc);
      expect(declined.row('Hispanic or Latino')).toMatchObject({ category: 'eeo.hispanicLatino' });
      expect(declined.row('Hispanic or Latino').reason).not.toBe('format-unsupported');
      expect(declined.writes('Hispanic or Latino').filter((write) => write.value.kind === 'check'
        && (write.value as { checked?: boolean }).checked === true)).toEqual([]);
      const golden = goldenProfile();
      const yes: Profile = { ...golden, eeo: { ...golden.eeo, hispanicLatino: { kind: 'value', value: true } } };
      expect(planned(doc, yes).writes('Hispanic or Latino')).toEqual([expect.objectContaining({
        value: expect.objectContaining({ kind: 'check' }) })]);
    });
});
