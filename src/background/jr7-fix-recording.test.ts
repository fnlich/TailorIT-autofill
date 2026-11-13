/*
 * jr7 FIX-background (the review's D-6): the platforms the Queue tab may Submit on (QUEUE_SUBMIT_PLATFORMS) whose
 * confirmation no worker test recorded, through the real worker (index.ts, frames.ts, chain.ts, submissions.ts) over
 * WXT's fake browser and a fake TailorIT. Synthetic addresses of the snapshot shapes; no per-person value:
 * - Paycom (PC7-03, PC7-06): the /applications document takes its posting's application by the tab's latest posting
 *   press (the pair); its Submit is armed there under the posting's key, and "Application Submitted!" drawn in it (a
 *   success message) records POST /applied once, by the posting's address, never the application's number; another tab,
 *   the application's own key, another posting and a late sign are refused;
 * - ADP: the guest page, then the application's steps behind the code (a new document, the same key); the success card
 *   drawn there records it once, by the canonical guest address (never the steps' OTP_login query); refused alike;
 * - the cheap others: Ashby, BambooHR and Workable (a message drawn at the form's own address), Rippling and Eightfold
 *   (their page after submitting under the form's key): armed, recorded once; another tab refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { QUEUE_SUBMIT_PLATFORMS } from '../shared/queue-submit';
import { lookupAddressOf } from './job-cards';
import { SUBMIT_ARM_MS } from './submissions';
import { contentSender, goldens, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const OTHER_TAB = 8;
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };
type Evidence = 'confirmation-page' | 'success-message';

const top = (url: string, documentId: string, tabId = TAB) =>
  contentSender({ url, tab: { id: tabId, url }, frameId: 0, documentId });
type Sender = ReturnType<typeof top>;
const hello = (worker: TestWorker, from: Sender, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, from) as Promise<Answer>;
const arm = (worker: TestWorker, from: Sender, applicationKey: string) =>
  worker.deliver({ v: 1, type: 'submit/armed', applicationKey, by: 'auto' }, from) as Promise<Answer>;
const sign = (worker: TestWorker, from: Sender, applicationKey: string, evidence: Evidence = 'success-message') =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence }, from) as Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.requests
  .filter((request) => request.method === 'POST' && request.path === '/api/autofill/applied')
  .map((request) => JSON.parse(request.body!) as Record<string, unknown>);

async function recordingWorker(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  return worker;
}

/** Lets the worker's unawaited work (notePair after a wall) run to its end. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ── Paycom (PC7-03's pair, PC7-06's sign) ──
const PAYCOM = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF';
const PC_POSTING = `${PAYCOM}/jobs/4321`;
const PC_APPLICATION = `${PAYCOM}/applications#/applications/98765`;
const PC_POSTING_KEY = keyOf(PC_POSTING);

/** The posting's contact dialog shown (the tab's posting press), then its /applications document, keyed by the pair, its
 *  Submit armed there under the posting's key. */
async function paycomArmed(): Promise<{ worker: TestWorker; application: Sender }> {
  const worker = await recordingWorker();
  await hello(worker, top(PC_POSTING, 'doc-posting'), { hasForm: false });
  await worker.deliver({ v: 1, type: 'frame/wall', wall: 'create-account' }, top(PC_POSTING, 'doc-posting'));
  await settle();
  const application = top(PC_APPLICATION, 'doc-application');
  expect((await hello(worker, application)).data?.chained).toEqual({ applicationKey: PC_POSTING_KEY });
  expect(await arm(worker, application, PC_POSTING_KEY)).toEqual({ ok: true, data: {} });
  return { worker, application };
}

describe('jr7 FIX-background, D-6: Paycom’s confirmation recorded once under the posting’s key', () => {
  it('the paired /applications document’s Submit, then its "Application Submitted!": POST /applied once', async () => {
    expect((QUEUE_SUBMIT_PLATFORMS as readonly string[]).includes('paycom')).toBe(true);
    expect(keyOf(PC_APPLICATION)).not.toBe(PC_POSTING_KEY);
    const { worker, application } = await paycomArmed();
    expect(await sign(worker, application, PC_POSTING_KEY)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: lookupAddressOf(PC_POSTING) }]);
    // The posting's address alone: never the application page, never its number.
    expect(JSON.stringify(applied(worker))).not.toMatch(/98765|applications/);
    expect(await sign(worker, application, PC_POSTING_KEY)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toHaveLength(1);
  });

  it('refuses another tab, the application’s own key, another posting and a late sign', async () => {
    // Another tab: its /applications document is not paired, so it arms nothing under the posting's key.
    const tabs = await paycomArmed();
    const otherTab = top(PC_APPLICATION, 'doc-other', OTHER_TAB);
    await hello(tabs.worker, otherTab);
    expect(await arm(tabs.worker, otherTab, PC_POSTING_KEY)).toMatchObject({ ok: false, error: 'bad_message' });
    expect(await sign(tabs.worker, otherTab, PC_POSTING_KEY)).toMatchObject({ ok: false, error: 'expired' });
    // The application page's own key, and another posting's, name no arm.
    expect(await sign(tabs.worker, tabs.application, keyOf(PC_APPLICATION))).toMatchObject({ ok: false });
    expect(await sign(tabs.worker, tabs.application, keyOf(`${PAYCOM}/jobs/9999`))).toMatchObject({ ok: false });
    expect(applied(tabs.worker)).toEqual([]);
    const late = await paycomArmed();
    late.worker.clock.now += SUBMIT_ARM_MS + 1;
    expect(await sign(late.worker, late.application, PC_POSTING_KEY)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(late.worker)).toEqual([]);
  });
});

// ── ADP Workforce Now ──
const ADP_GUEST = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=00000000-0000-4000-8000-000000000001&jobId=590196&ccId=19000101_000001';
const ADP_STEPS = 'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=00000000-0000-4000-8000-000000000001&jobId=590196&ccId=19000101_000001&jobId=590196&requisitionId=1&lang=en_US&params=jobId&OTP_login=true';
const ADP_KEY = keyOf(ADP_GUEST);

async function adpArmed(): Promise<{ worker: TestWorker; steps: Sender }> {
  const worker = await recordingWorker();
  await hello(worker, top(ADP_GUEST, 'doc-guest'));
  // Behind the emailed code: the application's steps, a new document of the same application.
  const steps = top(ADP_STEPS, 'doc-steps');
  await hello(worker, steps);
  expect(await arm(worker, steps, ADP_KEY)).toEqual({ ok: true, data: {} });
  return { worker, steps };
}

describe('jr7 FIX-background, D-6: ADP’s confirmation recorded once under its application’s key', () => {
  it('the steps’ Submit, then the success card drawn there: POST /applied once, by the canonical guest address', async () => {
    expect((QUEUE_SUBMIT_PLATFORMS as readonly string[]).includes('adp')).toBe(true);
    expect(keyOf(ADP_STEPS)).toBe(ADP_KEY);
    const { worker, steps } = await adpArmed();
    expect(await sign(worker, steps, ADP_KEY)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: ADP_GUEST }]);
    expect(JSON.stringify(applied(worker))).not.toMatch(/OTP_login|postLogin/);
    expect(await sign(worker, steps, ADP_KEY)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toHaveLength(1);
  });

  it('refuses another tab, another posting and a late sign', async () => {
    const tabs = await adpArmed();
    expect(await sign(tabs.worker, top(ADP_STEPS, 'doc-other', OTHER_TAB), ADP_KEY))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(await sign(tabs.worker, tabs.steps, keyOf(ADP_GUEST.replace('590196', '590197'))))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(applied(tabs.worker)).toEqual([]);
    const late = await adpArmed();
    late.worker.clock.now += SUBMIT_ARM_MS + 1;
    expect(await sign(late.worker, late.steps, ADP_KEY)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(late.worker)).toEqual([]);
  });
});

// ── The cheap others ──
describe('jr7 FIX-background, D-6: Ashby, BambooHR, Workable, Rippling and Eightfold recorded once', () => {
  const RIPPLING = 'https://ats.rippling.com/acme-careers/jobs/73bf0c96-e3e8-42ca-820c-01f2360ed78d/apply';
  const EIGHTFOLD = 'https://acme.eightfold.ai/careers/apply?pid=1234567890124';
  const CASES: Array<[string, string, string, Evidence]> = [
    ['ashby', 'https://jobs.ashbyhq.com/acme/0e1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b/application', '', 'success-message'],
    ['bamboohr', 'https://acme.bamboohr.com/careers/123', '', 'success-message'],
    ['workable', 'https://apply.workable.com/acme/j/F88446C814/apply/', '', 'success-message'],
    ['rippling', RIPPLING, `${RIPPLING}?step=confirmation`, 'confirmation-page'],
    ['eightfold', EIGHTFOLD, EIGHTFOLD.replace('/careers/apply?', '/careers/apply/success?'), 'confirmation-page'],
  ];

  it.each(CASES)('%s: armed on its form, its sign recorded once; another tab refused', async (platform, form, done,
    evidence) => {
    expect((QUEUE_SUBMIT_PLATFORMS as readonly string[]).includes(platform)).toBe(true);
    const key = keyOf(form);
    expect(key.startsWith(`${platform}:`)).toBe(true);
    const shown = done === '' ? form : done;
    if (done !== '') expect(applicationOf(new URL(done))).toMatchObject({ page: 'confirmation', applicationKey: key });
    const worker = await recordingWorker();
    await hello(worker, top(form, 'doc-form'));
    expect(await arm(worker, top(form, 'doc-form'), key)).toEqual({ ok: true, data: {} });
    expect(await sign(worker, top(shown, 'doc-form', OTHER_TAB), key, evidence)).toMatchObject({ ok: false });
    expect(applied(worker)).toEqual([]);
    expect(await sign(worker, top(shown, done === '' ? 'doc-form' : 'doc-done'), key, evidence))
      .toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: lookupAddressOf(form) }]);
    expect(await sign(worker, top(shown, 'doc-form'), key, evidence)).toMatchObject({ ok: false });
    expect(applied(worker)).toHaveLength(1);
  });
});
