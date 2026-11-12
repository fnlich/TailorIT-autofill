/*
 * jr7 AUTO-7 (SP\jr7\FIX7PLAN.md §6.4 items 7, 14 and 16; AUTO7-06, UP7-01, WD7-05, ICIMS7-04 (3)): the page after
 * submitting that names no application, and the confirmation an assessment holds back, through the real worker
 * (index.ts, submissions.ts) over WXT's fake browser and a fake TailorIT. Synthetic addresses of the snapshot7 shapes.
 * - submit/after: a frame whose page no parser reads (UltiPro's …/OpportunityApply/ApplicationSubmitted) is the
 *   confirmation of the Submit it armed within CONFIRMATION_PAGE_MS, only where its platform's adapter reads that
 *   address as its page after submitting (Adapter.confirmationAfter, ULTIPRO-7's to implement: a stand-in here), on the
 *   armed page's origin; refused from another frame, late, on another origin, for a page a parser reads, with no hook.
 * - ICIMS7-04 (3): a step that is the person's by design shown after the Submit (frame/hello's handOver) makes the arm
 *   wait SUBMIT_ARM_MS for its confirmation page, not CONFIRMATION_PAGE_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { oracleAdapter } from '../adapters/oracle';
import { ultiproAdapter } from '../adapters/ultipro';
import { confirmationAfterOf, CONFIRMATION_PAGE_MS, ROUTE_WAITS_FOR_SIGN, SUBMIT_ARM_MS } from './submissions';
import { contentSender, goldens, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  logs.mockRestore();
  delete (ultiproAdapter as { confirmationAfter?: unknown }).confirmationAfter;
  delete (oracleAdapter as { confirmationAfter?: unknown }).confirmationAfter;
});

const TAB = 7;
const BOARD = 'https://recruiting.ultipro.com/ACME1000/JobBoard/54a25c3a-e399-42b0-a553-16ed056e0517';
const FORM = `${BOARD}/OpportunityApply?opportunityId=772ddf9d-79f1-4752-bf3b-688ded6980c7`;
const SUBMITTED = `${BOARD}/OpportunityApply/ApplicationSubmitted?applicationId=11111111-2222-4333-8444-555555555555`;
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
type Answer = { ok: boolean; error?: string };

/** ULTIPRO-7's hook, as FIX7PLAN §3.1 shapes it (a stand-in): the same tenant's ApplicationSubmitted route. */
function standIn(): void {
  (ultiproAdapter as { confirmationAfter?: (armed: URL, here: URL) => boolean }).confirmationAfter = (armed, here) =>
    here.pathname.toLowerCase().endsWith('/opportunityapply/applicationsubmitted')
    && here.pathname.split('/')[1]?.toLowerCase() === armed.pathname.split('/')[1]?.toLowerCase();
}

const frame = (url: string, documentId: string, frameId = 0) =>
  contentSender({ url, tab: { id: TAB, url }, frameId, documentId });

async function armedForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame(FORM, 'doc-form'));
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: keyOf(FORM), by: 'auto' },
    frame(FORM, 'doc-form'))).toEqual({ ok: true, data: {} });
  return worker;
}
const after = (worker: TestWorker, sender: ReturnType<typeof frame>) =>
  worker.deliver({ v: 1, type: 'submit/after' }, sender) as Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.count('POST /api/autofill/applied');

describe('jr7 AUTO-7: submit/after, a page after submitting that names no application', () => {
  it('reads no application on UltiPro’s ApplicationSubmitted (no per-person id read into a key)', () => {
    expect(applicationOf(new URL(SUBMITTED))).toBeNull();
  });

  it('takes it once as the arm’s confirmation where the platform’s adapter reads it (a new document)', async () => {
    standIn();
    const worker = await armedForm();
    expect(await after(worker, frame(SUBMITTED, 'doc-done'))).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
    expect(await after(worker, frame(SUBMITTED, 'doc-done'))).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(1);
  });

  it('refuses it with no hook, from another frame, late, on another origin, and on a page a parser reads', async () => {
    const none = await armedForm();
    expect(await after(none, frame(SUBMITTED, 'doc-done'))).toMatchObject({ ok: false, error: 'expired' });
    standIn();
    const other = await armedForm();
    expect(await after(other, frame(SUBMITTED, 'doc-done', 4))).toMatchObject({ ok: false, error: 'expired' });
    const late = await armedForm();
    late.clock.now += CONFIRMATION_PAGE_MS + 1;
    expect(await after(late, frame(SUBMITTED, 'doc-done'))).toMatchObject({ ok: false, error: 'expired' });
    const keyed = await armedForm();
    expect(await after(keyed, frame(FORM, 'doc-form'))).toMatchObject({ ok: false, error: 'bad_message' });
    for (const worker of [none, other, late, keyed]) expect(applied(worker)).toBe(0);
    // The hook's own rule, held by the worker: never across origins.
    expect(confirmationAfterOf('ultipro', new URL(FORM),
      new URL(SUBMITTED.replace('recruiting.ultipro.com', 'recruiting2.ultipro.com')))).toBe(false);
    expect(confirmationAfterOf('ultipro', new URL(FORM), new URL(SUBMITTED))).toBe(true);
    expect(confirmationAfterOf('greenhouse', new URL(FORM), new URL(SUBMITTED))).toBe(false);
  });
});

describe('jr7 AUTO-7, ICIMS7-04 (3): a confirmation an assessment holds back', () => {
  const PORTAL = 'https://careers-acmebenefits.icims.com/jobs/2446/delivery-specialist/questions?in_iframe=1';
  const DONE = 'https://careers-acmebenefits.icims.com/jobs/2446/delivery-specialist/job?mode=submit_apply&from=assessment&in_iframe=1';
  const WRAPPER = 'https://careers-acmebenefits.icims.com/jobs/2446/delivery-specialist/questions';
  const icFrame = (url: string, frameId: number, documentId: string) =>
    contentSender({ url, tab: { id: TAB, url: WRAPPER }, frameId, documentId });

  async function armedThenAssessment(handOver: boolean): Promise<TestWorker> {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, wraps: true },
      icFrame(WRAPPER, 0, 'doc-wrapper'));
    const portal = icFrame(PORTAL, 3, 'doc-questions');
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true, claimed: true }, portal);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: keyOf(PORTAL), by: 'auto' }, portal))
      .toEqual({ ok: true, data: {} });
    // The step after the final Submit, the person's by design (its key: ICIMS7-04 (1) reads /assessment as the job's).
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true,
      ...(handOver ? { handOver: 'assessment' } : {}) }, icFrame(PORTAL, 3, 'doc-assessment'));
    await vi.waitFor(async () => {
      const stored = await worker.platform.storage.session.getMany('submit-arm:');
      const arm = Object.values(stored)[0] as { handOverAt?: number } | undefined;
      expect(arm?.handOverAt !== undefined).toBe(handOver);
    });
    return worker;
  }

  it('waits SUBMIT_ARM_MS for the job page after the person’s Continue, from the claim frame', async () => {
    const worker = await armedThenAssessment(true);
    worker.clock.now += 5 * 60_000;
    const done = icFrame(DONE, 3, 'doc-done');
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true }, done);
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(DONE),
      evidence: 'confirmation-page' }, done)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
    expect(5 * 60_000).toBeLessThan(SUBMIT_ARM_MS);
  });

  it('control: with no hand-over, the confirmation page counts only within CONFIRMATION_PAGE_MS', async () => {
    const worker = await armedThenAssessment(false);
    worker.clock.now += 5 * 60_000;
    const done = icFrame(DONE, 3, 'doc-done');
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true }, done);
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(DONE),
      evidence: 'confirmation-page' }, done)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(0);
  });
});

// ── The coordinator's decision on ORACLE-7's open item 1 (2026-11-12): Oracle's route alone never records ──
describe('jr7 AUTO-7: Oracle’s my-profile route waits for the keyed tile (ROUTE_WAITS_FOR_SIGN)', () => {
  const SITE = 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1';
  const SECTION = `${SITE}/job/12345/apply/section/1`;
  const PROFILE = `${SITE}/my-profile`;
  /** ORACLE-7's hook, as its handoff describes it (a stand-in): the same origin's my-profile of the same site. */
  function oracleStandIn(): void {
    (oracleAdapter as { confirmationAfter?: (armed: URL, here: URL) => boolean }).confirmationAfter = (armed, here) =>
      armed.origin === here.origin && here.pathname.endsWith('/sites/CX_1/my-profile')
      && armed.pathname.includes('/sites/CX_1/job/');
  }
  async function armedSection(): Promise<{ worker: TestWorker; key: string }> {
    oracleStandIn();
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame(SECTION, 'doc-app'));
    const key = keyOf(SECTION);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' },
      frame(SECTION, 'doc-app'))).toEqual({ ok: true, data: {} });
    return { worker, key };
  }
  const sign = (worker: TestWorker, key: string, evidence: 'confirmation-page' | 'success-message') =>
    worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence }, frame(PROFILE, 'doc-app')) as
      Promise<Answer>;

  it('names Oracle alone; my-profile names no application', () => {
    expect([...ROUTE_WAITS_FOR_SIGN]).toEqual(['oracle']);
    expect(applicationOf(new URL(PROFILE))).toBeNull();
    oracleStandIn();
    expect(confirmationAfterOf('oracle', new URL(SECTION), new URL(PROFILE))).toBe(true);
  });

  it('the route alone (a route of the arming document, or a new document) records nothing', async () => {
    const { worker, key } = await armedSection();
    expect(await sign(worker, key, 'confirmation-page')).toMatchObject({ ok: false, error: 'expired' });
    expect(await after(worker, frame(PROFILE, 'doc-profile'))).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(0);
  });

  it('the keyed tile, read in the arming document after the route, records it once, within SUBMIT_ARM_MS', async () => {
    const { worker, key } = await armedSection();
    expect(await sign(worker, key, 'confirmation-page')).toMatchObject({ ok: false, error: 'expired' });
    // On this tenant my-profile comes about two minutes after the press (the person types Oracle's code first).
    worker.clock.now += 2 * 60_000 + 17_000;
    expect(await sign(worker, key, 'success-message')).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
    expect(await sign(worker, key, 'success-message')).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(1);
  });
});
