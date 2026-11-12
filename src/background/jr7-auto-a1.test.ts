/*
 * jr7 AUTO-7 A1 (SP\jr7\FIX7PLAN.md §6.4 items 1 and 2, D-1): the submissions registry, through the real worker
 * (index.ts, frames.ts, chain.ts, submissions.ts) over WXT's fake browser and a fake TailorIT. Synthetic addresses with
 * the shapes of the owner's snapshot7 captures (no per-person value):
 * - ICIMS7-02: a Submit armed in iCIMS's IForm leaf (a chained subframe) shows its confirmation, job?mode=submit_apply,
 *   in the portal's frame (the tab's claim frame), not in the leaf: taken there, once, and refused from any other frame,
 *   for another job, or from a frame that is no claim frame (the auditor's and the verifier's worker probes, as asserts);
 * - AUTOV-01 + J7V-SR-5: SmartRecruiters' /publication/<uuid>/success after a Submit on its chained one-click screening
 *   step (armed under the posting's key) carries the publication's key: taken by the arm's pageKey, as a new document and
 *   as a route of the same document, POST /applied once; another publication's success is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FRAME_PROBE_GRACE_MS } from './frames';
import { CONFIRMATION_PAGE_MS } from './submissions';
import { contentSender, goldens, NO_RECEIVER, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };

// ── iCIMS (the careers-<x> / <x> prefix family, as careers-quartzbenefits frames quartzbenefits.icims.com) ──
const IC_WRAPPER = 'https://careers-acmebenefits.icims.com/jobs/2446/delivery-specialist/form?form=F&step=6&isPacket=1&type=1&hashed=1';
const IC_PORTAL = `${IC_WRAPPER}&in_iframe=1`;
const IC_FORMS = 'https://acmebenefits.icims.com/forms?module=Forms&action=showForm&form=F&user=USER&item=1&token=T&isPacket=1&in_iframe=1&step=6';
const IC_DONE_TOP = 'https://careers-acmebenefits.icims.com/jobs/2446/delivery-specialist/job?mode=submit_apply';
const IC_DONE_FRAME = `${IC_DONE_TOP}&in_iframe=1`;
const IC_OTHER_DONE = 'https://careers-acmebenefits.icims.com/jobs/2447/other-role/job?mode=submit_apply&in_iframe=1';

function icFrame(url: string, frameId: number, documentId: string, top = IC_WRAPPER) {
  return contentSender({ url, tab: { id: TAB, url: top }, frameId, documentId });
}
const icHello = (worker: TestWorker, sender: ReturnType<typeof icFrame>, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender) as
    Promise<Answer>;
const detected = (worker: TestWorker, sender: ReturnType<typeof icFrame>, applicationKey: string) =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence: 'confirmation-page' }, sender) as
    Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.count('POST /api/autofill/applied');

/** The wrapper, its claimed portal frame (3) and the IForm leaf (5) chained to it, with the leaf's final Submit armed. */
async function leafArmed(): Promise<{ worker: TestWorker; key: string }> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  await icHello(worker, icFrame(IC_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
  await icHello(worker, icFrame(IC_PORTAL, 3, 'doc-portal'), { hasForm: false, claimed: true });
  const key = keyOf(IC_PORTAL);
  const leaf = icFrame(IC_FORMS, 5, 'doc-forms');
  expect((await icHello(worker, leaf, { chain: { frame: true } })).data?.chained).toEqual({ applicationKey: key });
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' }, leaf))
    .toEqual({ ok: true, data: {} });
  return { worker, key };
}

describe('jr7 AUTO-7 A1, ICIMS7-02: an IForm leaf’s confirmation, in the tab’s claim frame', () => {
  it('takes job?mode=submit_apply from the portal’s frame once; the wrapper’s own report is refused', async () => {
    const { worker, key } = await leafArmed();
    // The wrapper's top follows the address and reports it first: it is no claim frame (it wraps one).
    const top = icFrame(IC_DONE_TOP, 0, 'doc-wrapper', IC_DONE_TOP);
    await icHello(worker, top, { hasForm: false, wraps: true });
    expect(await detected(worker, top, key)).toMatchObject({ ok: false, error: 'expired' });
    // The portal's frame shows the confirmation (a new document, still claimed): taken.
    const done = icFrame(IC_DONE_FRAME, 3, 'doc-done', IC_DONE_TOP);
    await icHello(worker, done, { hasForm: false, claimed: true });
    expect(await detected(worker, done, key)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
    // Once: a second report records nothing more.
    expect(await detected(worker, done, key)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(1);
  });

  it('follows a wrapper that reloaded: the claim frame now, whatever its frame id', async () => {
    const { worker, key } = await leafArmed();
    // The old page's documents (the wrapper's, the portal's, the leaf's) are gone: they answer no ping.
    const gone = new Set(['doc-wrapper', 'doc-portal', 'doc-forms']);
    worker.fakes.frameAnswers = ({ options }) => {
      if (options?.documentId !== undefined && gone.has(options.documentId)) throw new Error(NO_RECEIVER);
      return { ok: true, data: { pong: true } };
    };
    await icHello(worker, icFrame(IC_DONE_TOP, 0, 'doc-wrapper-2', IC_DONE_TOP), { hasForm: false, wraps: true });
    const done = icFrame(IC_DONE_FRAME, 9, 'doc-done', IC_DONE_TOP);
    await icHello(worker, done, { hasForm: false, claimed: true });
    // The sweep forgets the old page's frames (the portal's 3, the leaf's 5).
    await vi.waitFor(async () => {
      worker.timers.advance(FRAME_PROBE_GRACE_MS);
      const stored = await fakeBrowser.storage.session.get(null);
      expect(Object.keys(stored).filter((each) => /^frames:7:(3|5)$/.test(each))).toEqual([]);
    });
    expect(await detected(worker, done, key)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
  });

  it('refuses another job’s confirmation in the claim frame, and the arm’s key from a frame that claims nothing',
    async () => {
      const { worker, key } = await leafArmed();
      const other = icFrame(IC_OTHER_DONE, 3, 'doc-other', IC_DONE_TOP);
      await icHello(worker, other, { hasForm: false, claimed: true });
      // Its own key: no arm. The arm's key from a frame whose address names another job: not the claim frame's.
      expect(await detected(worker, other, keyOf(IC_OTHER_DONE))).toMatchObject({ ok: false, error: 'expired' });
      expect(await detected(worker, other, key)).toMatchObject({ ok: false, error: 'expired' });
      // An unclaimed subframe at the job's confirmation address.
      const loose = icFrame(IC_DONE_FRAME, 11, 'doc-loose', IC_DONE_TOP);
      await icHello(worker, loose, { hasForm: false });
      expect(await detected(worker, loose, key)).toMatchObject({ ok: false, error: 'expired' });
      expect(applied(worker)).toBe(0);
    });

  it('refuses it after CONFIRMATION_PAGE_MS, and a Submit armed in an unchained subframe is the old rule’s', async () => {
    const late = await leafArmed();
    late.worker.clock.now += CONFIRMATION_PAGE_MS + 1;
    const done = icFrame(IC_DONE_FRAME, 3, 'doc-done', IC_DONE_TOP);
    await icHello(late.worker, done, { hasForm: false, claimed: true });
    expect(await detected(late.worker, done, late.key)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(late.worker)).toBe(0);
    // Control (the auditor's): a final Submit armed in the portal's own frame (EEO last) is taken from that frame.
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await icHello(worker, icFrame(IC_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
    const eeo = icFrame(IC_PORTAL, 3, 'doc-eeo');
    await icHello(worker, eeo, { claimed: true });
    const key = keyOf(IC_PORTAL);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' }, eeo))
      .toEqual({ ok: true, data: {} });
    const done2 = icFrame(IC_DONE_FRAME, 3, 'doc-done', IC_DONE_TOP);
    await icHello(worker, done2, { hasForm: false, claimed: true });
    expect(await detected(worker, done2, key)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
  });
});

// ── SmartRecruiters (posting → one-click → screening → success; synthetic company and ids) ──
const SR_POSTING = 'https://jobs.smartrecruiters.com/AcmeLLC/744000100000001-platform-engineer';
const SR_PUB = '11111111-2222-4333-8444-555555555555';
const SR_ONE_CLICK = `https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeLLC/publication/${SR_PUB}?dcr_ci=AcmeLLC`;
const SR_SCREENING = `https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeLLC/publication/${SR_PUB}/screening?dcr_ci=AcmeLLC`;
const SR_SUCCESS = `https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeLLC/publication/${SR_PUB}/success?dcr_ci=AcmeLLC`;
const SR_OTHER_SUCCESS = 'https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeLLC/publication/99999999-2222-4333-8444-555555555555/success?dcr_ci=AcmeLLC';

const srFrame = (url: string, documentId: string) => contentSender({ url, tab: { id: TAB, url }, frameId: 0, documentId });
const srHello = (worker: TestWorker, url: string, documentId: string, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, srFrame(url, documentId)) as
    Promise<Answer>;
const srDetected = (worker: TestWorker, url: string, documentId: string, applicationKey: string) =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence: 'confirmation-page' },
    srFrame(url, documentId)) as Promise<Answer>;

/** The posting, its one-click page and its screening step, chained by the referrer; the screening's Submit armed. */
async function screeningArmed(): Promise<{ worker: TestWorker; posting: string }> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  const posting = keyOf(SR_POSTING);
  await srHello(worker, SR_POSTING, 'doc-posting', { hasForm: false });
  expect((await srHello(worker, SR_ONE_CLICK, 'doc-form', { chain: { from: hrefHash(SR_POSTING) } })).data?.chained)
    .toEqual({ applicationKey: posting });
  expect((await srHello(worker, SR_SCREENING, 'doc-screening', { chain: { from: hrefHash(SR_ONE_CLICK) } }))
    .data?.chained).toEqual({ applicationKey: posting });
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: posting, by: 'page' },
    srFrame(SR_SCREENING, 'doc-screening'))).toEqual({ ok: true, data: {} });
  return { worker, posting };
}

describe('jr7 AUTO-7 A1, AUTOV-01 + J7V-SR-5 (D-1): SmartRecruiters’ /success after a chained Submit', () => {
  it('shares the publication’s key with the one-click and screening pages, never the posting’s', () => {
    expect(keyOf(SR_SUCCESS)).toBe(keyOf(SR_SCREENING));
    expect(keyOf(SR_SUCCESS)).toBe(keyOf(SR_ONE_CLICK));
    expect(keyOf(SR_SUCCESS)).not.toBe(keyOf(SR_POSTING));
  });

  it('takes the page as a new document, by its own key: POST /applied once', async () => {
    const { worker } = await screeningArmed();
    await srHello(worker, SR_SUCCESS, 'doc-success', { hasForm: false });
    expect(await srDetected(worker, SR_SUCCESS, 'doc-success', keyOf(SR_SUCCESS))).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
    expect(await srDetected(worker, SR_SUCCESS, 'doc-success', keyOf(SR_SUCCESS)))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(1);
  });

  it('takes the page as a route of the arming document, by its own key: POST /applied once', async () => {
    const { worker } = await screeningArmed();
    await srHello(worker, SR_SUCCESS, 'doc-screening', { hasForm: false, nav: 1 });
    expect(await srDetected(worker, SR_SUCCESS, 'doc-screening', keyOf(SR_SUCCESS))).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
  });

  it('refuses another publication’s success, a page whose own address does not read the key, and a late one',
    async () => {
      const { worker } = await screeningArmed();
      await srHello(worker, SR_OTHER_SUCCESS, 'doc-other', { hasForm: false });
      expect(await srDetected(worker, SR_OTHER_SUCCESS, 'doc-other', keyOf(SR_OTHER_SUCCESS)))
        .toMatchObject({ ok: false, error: 'expired' });
      // The arming page's key, said from a page whose own address reads another publication: not paired.
      expect(await srDetected(worker, SR_OTHER_SUCCESS, 'doc-other', keyOf(SR_SUCCESS)))
        .toMatchObject({ ok: false, error: 'expired' });
      expect(applied(worker)).toBe(0);
      const late = await screeningArmed();
      late.worker.clock.now += CONFIRMATION_PAGE_MS + 1;
      await srHello(late.worker, SR_SUCCESS, 'doc-success', { hasForm: false });
      expect(await srDetected(late.worker, SR_SUCCESS, 'doc-success', keyOf(SR_SUCCESS)))
        .toMatchObject({ ok: false, error: 'expired' });
      expect(applied(late.worker)).toBe(0);
    });

  it('control: the one-click page opened directly (not chained) is taken as before', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await srHello(worker, SR_SCREENING, 'doc-screening');
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: keyOf(SR_SCREENING), by: 'page' },
      srFrame(SR_SCREENING, 'doc-screening'))).toEqual({ ok: true, data: {} });
    await srHello(worker, SR_SUCCESS, 'doc-success', { hasForm: false });
    expect(await srDetected(worker, SR_SUCCESS, 'doc-success', keyOf(SR_SUCCESS))).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
  });
});
