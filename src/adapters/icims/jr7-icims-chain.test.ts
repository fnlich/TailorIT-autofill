/*
 * jr7 ICIMS-7, P2 (FIX7PLAN §6.7 "the chain (with CHAIN-7) on jr7-icims1-iform-1/-2 and jr7-icims3-iform"; ICIMS7-04 on
 * jr7-icims3-assessment; ICIMS7-11): the owner's snapshot7 applications through the real worker (index.ts, frames.ts,
 * chain.ts, submissions.ts) over WXT's fake browser and a fake TailorIT, at the very addresses the captures were taken
 * at (their route maps, every per-person value REDACTED by the converter):
 * - arc-onesolutions: its portal frame declares the forms origin its page shows (oneblood.icims.com, ICIMS7-01, as
 *   jr7-icims.browser.test.ts measures the adapter declaring it), the (1/2) leaf is keyed and hears the (1/2) facts,
 *   the (2/2) leaf after the press hears only the (2/2) ones (ICIMS7-V1), its final Submit is armed, and the page after
 *   submitting in the portal's frame records the job once (ICIMS7-02 with O-1);
 * - careers-quartzbenefits: the leaf's final Submit, then the Assessments step (its own address keyed as the job's,
 *   ICIMS7-04 (1); its hand-over, (2)), then, minutes later, the page after the person's Continue: recorded once (3);
 * - the Jibe posting (oneblood.jibeapply.com) names TailorIT the iCIMS posting its Apply leads to: the application
 *   arc-onesolutions' gate and steps are keyed under (D-6).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../index';
import { checkedTailoritAddress } from '../../background/frames';
import { SUBMIT_ARM_MS } from '../../background/submissions';
import { contentSender, goldens, startTestWorker, tokenRecord, typeOfSent, type TestWorker }
  from '../../background/worker.testkit';
import type { TabMessage } from '../../platform/fake';
import type { ChainStepFacts } from '../types';
import { checkedIcimsPosting, icimsPostingOf } from '../jibe/url';
import arcIform1 from '../../../fixtures/icims/jr7-icims1-iform-1.routes.json';
import arcIform2 from '../../../fixtures/icims/jr7-icims1-iform-2.routes.json';
import arcDone from '../../../fixtures/icims/jr7-icims1-confirmation.routes.json';
import jibeGate from '../../../fixtures/icims/jr7-icims2-login.routes.json';
import quartzIform from '../../../fixtures/icims/jr7-icims3-iform.routes.json';
import quartzAssessment from '../../../fixtures/icims/jr7-icims3-assessment.routes.json';
import quartzDone from '../../../fixtures/icims/jr7-icims3-confirmation.routes.json';
import jibePosting from '../../../fixtures/jibe/jr7-icims2-jibe-posting.routes.json';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** The address a route map serves `page` at. */
function at(routes: Record<string, string>, page: string): string {
  const found = Object.entries(routes).find(([, path]) => path === `fixtures/${page}.html`)?.[0];
  if (found === undefined) throw new Error(`no address for ${page}`);
  return found;
}

const TAB = 7;
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };
const frame = (url: string, frameId: number, documentId: string, top: string) =>
  contentSender({ url, tab: { id: TAB, url: top }, frameId, documentId });
type Sender = ReturnType<typeof frame>;
const hello = (worker: TestWorker, from: Sender, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: from.frameId === 0, hasForm: true, ...extra }, from) as
    Promise<Answer>;
const asLeaf = { isTop: false, chain: { frame: true } };
const applied = (worker: TestWorker) => worker.tailorit.count('POST /api/autofill/applied');
const handed = (worker: TestWorker) => worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'chain/leafFacts')
  .map((sent) => ({ frameId: sent.options?.frameId, documentId: sent.options?.documentId,
    facts: (sent.message as { facts: unknown }).facts }));

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Frames take every message; a portal's ping is answered by its own document. */
function answering(worker: TestWorker): void {
  worker.fakes.frameAnswers = (sent: TabMessage) => (typeOfSent(sent) === 'frame/ping'
    ? { ok: true, data: { pong: true } } : { ok: true, data: {} });
}

async function started(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  answering(worker);
  return worker;
}

// ── arc-onesolutions (snapshot7 iCIMS1) ──
const ARC = {
  wrapper: at(arcIform1, 'icims/jr7-icims1-iform-1'),
  portal: at(arcIform1, 'icims/jr7-icims1-iform-1.frame-1'),
  leaf1: at(arcIform1, 'icims/jr7-icims1-iform-1.frame-2'),
  portal2: at(arcIform2, 'icims/jr7-icims1-iform-2.frame-1'),
  leaf2: at(arcIform2, 'icims/jr7-icims1-iform-2.frame-2'),
  doneTop: at(arcDone, 'icims/jr7-icims1-confirmation'),
  doneFrame: at(arcDone, 'icims/jr7-icims1-confirmation.frame-1'),
};
const ONEBLOOD = 'https://oneblood.icims.com';
const FIRST: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, counters: 1,
  packet: { n: 1, m: 2 } };
const SECOND: ChainStepFacts = { ...FIRST, packet: { n: 2, m: 2 } };

describe('jr7 ICIMS-7 P2: arc-onesolutions’ IForms, at the captured addresses (ICIMS7-01, V1, 02 with O-1)', () => {
  it('reads every page of the application under one key; the leaves are on another host the portal’s name gives none of',
    () => {
      const key = keyOf(ARC.portal);
      for (const href of [ARC.wrapper, ARC.portal, ARC.portal2, ARC.doneTop, ARC.doneFrame]) expect(keyOf(href), href).toBe(key);
      for (const href of [ARC.leaf1, ARC.leaf2]) {
        expect(new URL(href).origin).toBe(ONEBLOOD);
        expect(applicationOf(new URL(href)), href).toBeNull();
      }
      // The portal frame keeps its address from (1/2) to (2/2): only its counter changes.
      expect(ARC.portal2).toBe(ARC.portal);
    });

  it('keys the (1/2) leaf by the declared origin, hands the (2/2) leaf only fresh facts, records the final Submit once',
    async () => {
      const worker = await started();
      await hello(worker, frame(ARC.wrapper, 0, 'doc-wrapper', ARC.wrapper), { hasForm: false, wraps: true });
      const portal = frame(ARC.portal, 3, 'doc-portal', ARC.wrapper);
      expect((await hello(worker, portal, { isTop: false, hasForm: false, claimed: true, childOrigins: [ONEBLOOD] })).ok)
        .toBe(true);
      const key = keyOf(ARC.portal);
      const first = frame(ARC.leaf1, 5, 'doc-leaf-1', ARC.wrapper);
      expect((await hello(worker, first, asLeaf)).data?.chained).toEqual({ applicationKey: key });
      expect(await worker.deliver({ v: 1, type: 'chain/facts', facts: FIRST }, portal)).toEqual({ ok: true, data: {} });
      expect(handed(worker)).toEqual([{ frameId: 5, documentId: 'doc-leaf-1', facts: FIRST }]);
      // The (1/2) leaf's Submit (a Next) pressed; the (2/2) form loads in the same frame: no stale (1/2) facts reach it.
      expect(await worker.deliver({ v: 1, type: 'chain/pressed' }, first)).toEqual({ ok: true, data: {} });
      const second = frame(ARC.leaf2, 5, 'doc-leaf-2', ARC.wrapper);
      expect((await hello(worker, second, asLeaf)).data?.chained).toEqual({ applicationKey: key });
      await settle();
      expect(handed(worker)).toHaveLength(1);
      expect(await worker.deliver({ v: 1, type: 'chain/facts', facts: SECOND }, portal)).toEqual({ ok: true, data: {} });
      expect(handed(worker).slice(1)).toEqual([{ frameId: 5, documentId: 'doc-leaf-2', facts: SECOND }]);
      // Its final Submit, then the page after submitting in the portal's frame (a new document, still claimed).
      expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' }, second))
        .toEqual({ ok: true, data: {} });
      const done = frame(ARC.doneFrame, 3, 'doc-done', ARC.doneTop);
      await hello(worker, done, { isTop: false, hasForm: false, claimed: true });
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(ARC.doneFrame),
        evidence: 'confirmation-page' }, done)).toEqual({ ok: true, data: {} });
      expect(applied(worker)).toBe(1);
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(ARC.doneFrame),
        evidence: 'confirmation-page' }, done)).toMatchObject({ ok: false, error: 'expired' });
      expect(applied(worker)).toBe(1);
      // TailorIT is told the posting, never the forms host or a token of the frames' addresses.
      const sent = worker.tailorit.requests.filter((each) => each.path === '/api/autofill/applied');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toContain('arc-onesolutions.icims.com/jobs/17204');
      expect(sent[0]!.body).not.toMatch(/oneblood|token=|user=|in_iframe|hashed|REDACTED/);
    });

  it('control (jr6’s hello, no declared origin): the leaf is keyed by nothing, its Submit arms nothing', async () => {
    const worker = await started();
    await hello(worker, frame(ARC.wrapper, 0, 'doc-wrapper', ARC.wrapper), { hasForm: false, wraps: true });
    await hello(worker, frame(ARC.portal, 3, 'doc-portal', ARC.wrapper), { isTop: false, hasForm: false, claimed: true });
    const leaf = frame(ARC.leaf1, 5, 'doc-leaf-1', ARC.wrapper);
    expect((await hello(worker, leaf, asLeaf)).data?.chained).toBeUndefined();
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: keyOf(ARC.portal), by: 'auto' }, leaf))
      .toMatchObject({ ok: false });
  });
});

// ── careers-quartzbenefits (snapshot7 icims3) ──
const QZ = {
  wrapper: at(quartzIform, 'icims/jr7-icims3-iform'),
  portal: at(quartzIform, 'icims/jr7-icims3-iform.frame-1'),
  leaf: at(quartzIform, 'icims/jr7-icims3-iform.frame-2'),
  assessmentTop: at(quartzAssessment, 'icims/jr7-icims3-assessment'),
  assessment: at(quartzAssessment, 'icims/jr7-icims3-assessment.frame-1'),
  doneTop: at(quartzDone, 'icims/jr7-icims3-confirmation'),
  doneFrame: at(quartzDone, 'icims/jr7-icims3-confirmation.frame-1'),
};
const QUARTZ: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, counters: 0, packet: null };

describe('jr7 ICIMS-7 P2: careers-quartzbenefits’ last form, its Assessments step, then the page after (ICIMS7-04)', () => {
  /** The leaf's final Submit armed; then the claim frame shows the Assessments step, saying its hand-over or not. */
  async function armedThenAssessment(handOver: boolean): Promise<TestWorker> {
    const worker = await started();
    await hello(worker, frame(QZ.wrapper, 0, 'doc-wrapper', QZ.wrapper), { hasForm: false, wraps: true });
    const portal = frame(QZ.portal, 3, 'doc-portal', QZ.wrapper);
    await hello(worker, portal, { isTop: false, hasForm: false, claimed: true,
      childOrigins: ['https://quartzbenefits.icims.com'] });
    const key = keyOf(QZ.portal);
    const leaf = frame(QZ.leaf, 5, 'doc-leaf', QZ.wrapper);
    expect((await hello(worker, leaf, asLeaf)).data?.chained).toEqual({ applicationKey: key });
    await worker.deliver({ v: 1, type: 'chain/facts', facts: QUARTZ }, portal);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' }, leaf))
      .toEqual({ ok: true, data: {} });
    // ICIMS7-04 (1): the Assessments step's own address is the job's.
    expect(keyOf(QZ.assessment)).toBe(key);
    await hello(worker, frame(QZ.assessment, 3, 'doc-assessment', QZ.assessmentTop), { isTop: false, hasForm: false,
      claimed: true, ...(handOver ? { handOver: 'assessment' } : {}) });
    await vi.waitFor(async () => {
      const stored = await worker.platform.storage.session.getMany('submit-arm:');
      const arm = Object.values(stored)[0] as { handOverAt?: number } | undefined;
      expect(arm?.handOverAt !== undefined).toBe(handOver);
    });
    return worker;
  }

  it('waits for the person’s Continue: the page after it, five minutes on, in the claim frame, is recorded once',
    async () => {
      const worker = await armedThenAssessment(true);
      worker.clock.now += 5 * 60_000;
      expect(5 * 60_000).toBeLessThan(SUBMIT_ARM_MS);
      const done = frame(QZ.doneFrame, 3, 'doc-done', QZ.doneTop);
      expect(new URL(QZ.doneFrame).searchParams.get('from')).toBe('assessment');
      await hello(worker, done, { isTop: false, hasForm: false, claimed: true });
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(QZ.doneFrame),
        evidence: 'confirmation-page' }, done)).toEqual({ ok: true, data: {} });
      expect(applied(worker)).toBe(1);
    });

  it('control: with no hand-over said, that page so late is no confirmation of the arm', async () => {
    const worker = await armedThenAssessment(false);
    worker.clock.now += 5 * 60_000;
    const done = frame(QZ.doneFrame, 3, 'doc-done', QZ.doneTop);
    await hello(worker, done, { isTop: false, hasForm: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(QZ.doneFrame),
      evidence: 'confirmation-page' }, done)).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toBe(0);
  });
});

// ── The Jibe posting (snapshot7 icims2) ──
const JIBE = at(jibePosting, 'jibe/jr7-icims2-jibe-posting');
const GATE = at(jibeGate, 'icims/jr7-icims2-login');

describe('jr7 ICIMS-7 P2: the Jibe posting names TailorIT the job arc-onesolutions’ application is (ICIMS7-11, D-6)', () => {
  it('builds the iCIMS posting from the gate its Apply opened, the very application of arc-onesolutions’ pages', () => {
    const posting = icimsPostingOf(new URL(JIBE), new URL(GATE));
    expect(posting).toBe('https://arc-onesolutions.icims.com/jobs/17204/job');
    expect(applicationOf(new URL(GATE))?.applicationUrl).toBe(posting);
    expect(keyOf(GATE)).toBe(keyOf(ARC.portal));
    // The worker's two checks (AUTO-7's, and the Jibe adapter's own) take it, and refuse it named by another page.
    expect(checkedTailoritAddress(JIBE, posting!)).toBe(posting);
    expect(checkedIcimsPosting(new URL(JIBE), new URL(posting!))).toBe(posting);
    expect(checkedTailoritAddress(GATE, posting!)).toBeNull();
  });

  it('keeps it on the Jibe posting’s top frame, the address TailorIT is asked with', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const posting = icimsPostingOf(new URL(JIBE), new URL(GATE))!;
    const sender = contentSender({ url: JIBE, tab: { id: TAB, url: JIBE }, frameId: 0, documentId: 'doc-jibe' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, tailoritAddress: posting },
      sender)).toMatchObject({ ok: true });
    const entry = (await fakeBrowser.storage.session.get(`frames:${TAB}:0`))[`frames:${TAB}:0`] as
      { tailoritUrl?: string };
    expect(entry.tailoritUrl).toBe(posting);
  });
});
