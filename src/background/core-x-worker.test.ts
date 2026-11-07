/*
 * The snapshot build of 2026-11-06 (core-x; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) in the real worker (index.ts, chain.ts, frames.ts,
 * sign-in.ts, run-begin.ts, job-cards.ts, server-client.ts), over WXT's fake browser and a fake TailorIT. Addresses
 * have the shapes of the owner's snapshots; every per-person value is a placeholder.
 * - items 7 and 14, the tab's chain: SmartRecruiters' one-click application reached from its posting, and
 *   SuccessFactors' /portalcareer post-back reached from its account page, take that page's application by the
 *   browser's referrer (its hash); iCIMS's IForm frame takes the application of its company's one claimed portal frame
 *   in the tab, from the frame registry alone (the security fix of 2026-11-06, S4: no token). The posting's "no AI"
 *   note then reaches the form's run/begin. Refused: another tab, another host or company, a stale chain, the same
 *   document, a referrer of another page, an unclaimed portal, two claimed portals, another tab's portal, another
 *   company's, a stale one, a hello that says nothing of a chain.
 * - item 6: TailorIT is asked with the posting's canonical address: from iCIMS's step pages, from a chain page (never
 *   its session token or the person's iCIMS id).
 * - item 3: Sign-in Auto's credential is answered to the frame that claims a company wrapper's application (an iCIMS
 *   portal's iframe#icims_content_iframe below its wrapper), never to any other subframe.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import { CHAIN_MS } from './chain';
import { contentSender, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const SR_POSTING = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer?trid=T';
const SR_ONE_CLICK = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001?dcr_ci=Xplor';
const SR_SCREENING = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001/screening?dcr_ci=Xplor';
const SR_OTHER_COMPANY = 'https://jobs.smartrecruiters.com/oneclick-ui/company/WiserSolutions/publication/289a97ff-0000-4000-8000-000000000002?dcr_ci=WiserSolutions';
const SF_ACCOUNT = 'https://career8.successfactors.com/career?company=donnelleyf&site=&lang=en_US&login_ns=register&career_ns=job_application&career_job_req_id=4984&_s.crb=TOKEN1';
// The /career post-back with no job (the behaviour review of 2026-11-06, minor 9: /portalcareer is no chain page).
const SF_FORM = 'https://career8.successfactors.com/career?_s.crb=TOKEN2';
const SF_OTHER_HOST_FORM = 'https://career10.successfactors.com/career?_s.crb=TOKEN2';
const ICIMS_WRAPPER = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1';
const ICIMS_PORTAL = 'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?form=F&step=1&hashed=1&in_iframe=1';
const ICIMS_FORMS = 'https://edgewaterit.icims.com/forms?module=Forms&action=showForm&form=F&user=USER&item=1&token=T&in_iframe=1&step=1';
const ICIMS_OTHER_FORMS = 'https://nyu.icims.com/forms?module=Forms&action=showForm&form=F&user=USER&in_iframe=1';
const ICIMS_HOME = 'https://careers-edgewaterit.icims.com/jobs/intro?in_iframe=1';

const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;

/** A frame of the tab: its address (the tab's too for a top frame), its frame and document ids. */
function frame(url: string, frameId: number, documentId: string, tabId = TAB) {
  return contentSender({ url, tab: { id: tabId, url: frameId === 0 ? url : ICIMS_WRAPPER }, frameId, documentId });
}

type HelloAnswer = { ok: boolean; data?: { chained?: { applicationKey: string } } };
const hello = (worker: TestWorker, sender: ReturnType<typeof frame>, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender) as
    Promise<HelloAnswer>;

/** The address the last lookup named to TailorIT. */
function lastLookupUrl(worker: TestWorker): string {
  const lookups = worker.tailorit.requests.filter((request) => request.path === '/api/autofill/lookup');
  return (JSON.parse(lookups.at(-1)!.body!) as { url: string }).url;
}

describe('a top frame’s chain (items 7 and 14)', () => {
  it('gives SmartRecruiters’ one-click application its posting’s application, and its screening step after it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const posting = keyOf(SR_POSTING);
    expect(posting).not.toBe(keyOf(SR_ONE_CLICK));
    await hello(worker, frame(SR_POSTING, 0, 'doc-posting'), { hasForm: false });
    const oneClick = await hello(worker, frame(SR_ONE_CLICK, 0, 'doc-form'), { chain: { from: hrefHash(SR_POSTING) } });
    expect(oneClick.data?.chained).toEqual({ applicationKey: posting });
    // Its next step, reached from it, takes it too.
    const screening = await hello(worker, frame(SR_SCREENING, 0, 'doc-screening'),
      { chain: { from: hrefHash(SR_ONE_CLICK) } });
    expect(screening.data?.chained).toEqual({ applicationKey: posting });
    // The same document's later hello keeps it, with no chain named again.
    expect((await hello(worker, frame(SR_SCREENING, 0, 'doc-screening'))).data?.chained)
      .toEqual({ applicationKey: posting });
  });

  it('lets the posting’s "no AI" note reach the form, which TailorIT is asked about by the posting’s address', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const posting = keyOf(SR_POSTING);
    await hello(worker, frame(SR_POSTING, 0, 'doc-posting'), { hasForm: false });
    expect(await worker.deliver({ v: 1, type: 'policy/hit', applicationKey: posting, patternId: 'no-ai' },
      frame(SR_POSTING, 0, 'doc-posting'))).toEqual({ ok: true, data: {} });
    const form = frame(SR_ONE_CLICK, 0, 'doc-form');
    await hello(worker, form, { chain: { from: hrefHash(SR_POSTING) } });
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: posting, trigger: 'launcher',
      dryRun: false }, form) as { ok: boolean; data: { policy: { postingPage: string } } };
    expect(begun).toMatchObject({ ok: true, data: { policy: { postingPage: 'hit' } } });
    expect(lastLookupUrl(worker)).toBe('https://jobs.smartrecruiters.com/Xplor/744000159905715');
  });

  it('gives SuccessFactors’ post-back its account page’s application, asked about by the posting’s address', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const account = keyOf(SF_ACCOUNT);
    await hello(worker, frame(SF_ACCOUNT, 0, 'doc-account'), { hasForm: false });
    const form = frame(SF_FORM, 0, 'doc-form');
    expect((await hello(worker, form, { chain: { from: hrefHash(SF_ACCOUNT) } })).data?.chained)
      .toEqual({ applicationKey: account });
    await worker.deliver({ v: 1, type: 'run/begin', applicationKey: account, trigger: 'launcher', dryRun: false }, form);
    const url = lastLookupUrl(worker);
    // Core pass Z1, item 37: TailorIT's own canonical address of the posting (its parseAtsUrl's), which it reads alike.
    expect(url).toBe('https://career8.successfactors.com/career?career_job_req_id=4984&career_ns=job_listing&company=donnelleyf');
    expect(url).not.toContain('TOKEN');
  });

  it('never chains across tabs, hosts or companies, from a stale page, within one document, or from another page', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, frame(SR_POSTING, 0, 'doc-posting'), { hasForm: false });
    await hello(worker, frame(SF_ACCOUNT, 0, 'doc-account', 8), { hasForm: false });
    const from = { chain: { from: hrefHash(SR_POSTING) } };
    // Another tab.
    expect((await hello(worker, frame(SR_ONE_CLICK, 0, 'doc-x', 9), from)).data?.chained).toBeUndefined();
    // Another company on the same host.
    expect((await hello(worker, frame(SR_OTHER_COMPANY, 0, 'doc-y'), from)).data?.chained).toBeUndefined();
    // Another SuccessFactors career host than the account page's.
    expect((await hello(worker, frame(SF_OTHER_HOST_FORM, 0, 'doc-z', 8), { chain: { from: hrefHash(SF_ACCOUNT) } }))
      .data?.chained).toBeUndefined();
    // A referrer that is no claimed page of the tab.
    expect((await hello(worker, frame(SR_ONE_CLICK, 0, 'doc-w'), { chain: { from: hrefHash(SR_SCREENING) } }))
      .data?.chained).toBeUndefined();
    // The claimed page's own document (no navigation).
    await hello(worker, frame(SR_POSTING, 0, 'doc-same'), { hasForm: false });
    expect((await hello(worker, frame(SR_ONE_CLICK, 0, 'doc-same'), from)).data?.chained).toBeUndefined();
    // A stale chain: the claimed page's last hello longer ago than CHAIN_MS.
    const stale = await startTestWorker({ token: tokenRecord() });
    await hello(stale, frame(SR_POSTING, 0, 'doc-posting'), { hasForm: false });
    stale.clock.now += CHAIN_MS + 1;
    expect((await hello(stale, frame(SR_ONE_CLICK, 0, 'doc-form'), from)).data?.chained).toBeUndefined();
  });

  it('never chains a page whose address names its own job, nor from a private tab', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, frame(SR_POSTING, 0, 'doc-posting'), { hasForm: false });
    // The posting itself, again (no chain page).
    expect((await hello(worker, frame(SR_POSTING, 0, 'doc-2'), { chain: { from: hrefHash(SR_POSTING) } }))
      .data?.chained).toBeUndefined();
    const incognito = { ...frame(SR_ONE_CLICK, 0, 'doc-3'), tab: { id: TAB, url: SR_ONE_CLICK, incognito: true } };
    expect((await hello(worker, incognito, { chain: { from: hrefHash(SR_POSTING) } })).data?.chained).toBeUndefined();
  });
});

describe('a subframe’s chain: iCIMS’s IForm frame (items 7 and 14; the security fix of 2026-11-06, S4)', () => {
  /** The wrapper (frame 0) and the portal's frame (frame 3) of an IForm page, which claims the wrapper's application. */
  async function portal(worker: TestWorker, tabId = TAB, documentId = 'doc-portal'): Promise<void> {
    await hello(worker, frame(ICIMS_WRAPPER, 0, 'doc-wrapper', tabId), { hasForm: false, wraps: true });
    const answer = await hello(worker, frame(ICIMS_PORTAL, 3, documentId, tabId),
      { isTop: false, hasForm: false, claimed: true });
    expect(answer.ok).toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/token/i);
  }
  const asks = { isTop: false, chain: { frame: true } };

  it('gives the form frame the portal frame’s application, asked about by the posting’s address', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await portal(worker);
    const forms = frame(ICIMS_FORMS, 5, 'doc-forms');
    const answer = await hello(worker, forms, asks);
    expect(answer.data?.chained).toEqual({ applicationKey: keyOf(ICIMS_PORTAL) });
    await worker.deliver({ v: 1, type: 'run/begin', applicationKey: keyOf(ICIMS_PORTAL), trigger: 'launcher',
      dryRun: false }, forms);
    const url = lastLookupUrl(worker);
    expect(url).toBe('https://careers-edgewaterit.icims.com/jobs/4828/job');
    expect(url).not.toContain('USER');
  });

  it('keys a form frame that said hello before its portal once it says hello again', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const forms = frame(ICIMS_FORMS, 5, 'doc-forms');
    expect((await hello(worker, forms, asks)).data?.chained).toBeUndefined();
    await portal(worker);
    expect((await hello(worker, forms, asks)).data?.chained).toEqual({ applicationKey: keyOf(ICIMS_PORTAL) });
  });

  it('a top portal page that frames the form itself gives it its application', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, frame(ICIMS_PORTAL, 0, 'doc-portal-top'), { hasForm: false });
    expect((await hello(worker, frame(ICIMS_FORMS, 5, 'doc-forms'), asks)).data?.chained)
      .toEqual({ applicationKey: keyOf(ICIMS_PORTAL) });
  });

  it('refuses with no claimed portal, two claimed portals, another tab’s, another company’s, or a stale one', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    // An unclaimed portal frame: a portal page below a top frame that wraps nothing.
    await hello(worker, frame(ICIMS_HOME, 0, 'doc-home', 20), { hasForm: false });
    await hello(worker, frame(ICIMS_PORTAL, 4, 'doc-unclaimed', 20), { isTop: false, hasForm: false });
    expect((await hello(worker, frame(ICIMS_FORMS, 5, 'doc-a', 20), asks)).data?.chained).toBeUndefined();
    // A claimed portal frame in another tab only.
    await portal(worker, 21);
    expect((await hello(worker, frame(ICIMS_FORMS, 5, 'doc-b', 22), asks)).data?.chained).toBeUndefined();
    // Another company's forms host than the claimed portal's.
    expect((await hello(worker, frame(ICIMS_OTHER_FORMS, 6, 'doc-c', 21), asks)).data?.chained).toBeUndefined();
    // The portal frame itself, and a top frame at a forms address.
    expect((await hello(worker, frame(ICIMS_FORMS, 3, 'doc-d', 21), asks)).data?.chained).toBeUndefined();
    expect((await hello(worker, frame(ICIMS_FORMS, 0, 'doc-top', 23), { chain: { frame: true } })).data?.chained)
      .toBeUndefined();
    // Two claimed portals of the company in one tab (two frames say they claim): none.
    await portal(worker, 24);
    await hello(worker, frame(ICIMS_PORTAL, 6, 'doc-portal-2', 24), { isTop: false, hasForm: false, claimed: true });
    expect((await hello(worker, frame(ICIMS_FORMS, 7, 'doc-e', 24), asks)).data?.chained).toBeUndefined();
    // A second portal frame of the company beside the claimed one: none either.
    await portal(worker, 25);
    await hello(worker, frame(ICIMS_PORTAL, 6, 'doc-portal-3', 25), { isTop: false, hasForm: false });
    expect((await hello(worker, frame(ICIMS_FORMS, 7, 'doc-f', 25), asks)).data?.chained).toBeUndefined();
    // A hello that names no chain.
    await portal(worker, 26);
    expect((await hello(worker, frame(ICIMS_FORMS, 5, 'doc-g', 26), { isTop: false })).data?.chained).toBeUndefined();
    // Stale: the claimed portal's last hello longer ago than CHAIN_MS.
    await portal(worker, 27);
    worker.clock.now += CHAIN_MS + 1;
    expect((await hello(worker, frame(ICIMS_FORMS, 5, 'doc-h', 27), asks)).data?.chained).toBeUndefined();
  });

  it('refuses a token a page made up, as any hello the schema does not know', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await portal(worker);
    const answer = await hello(worker, frame(ICIMS_FORMS, 5, 'doc-forms'),
      { isTop: false, chain: { token: 'made-up-token-000000000' } });
    expect(answer.ok).toBe(false);
  });
});

describe('the frame that claims a wrapper’s application (item 3)', () => {
  it('is answered Sign-in Auto’s credential as a top frame is; any other subframe is refused as before', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, frame(ICIMS_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
    await hello(worker, frame(ICIMS_PORTAL, 3, 'doc-portal'), { isTop: false, claimed: true });
    // Sign-in is on Manual: the claim frame passes the frame check and is told none may be used now.
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate' },
      frame(ICIMS_PORTAL, 3, 'doc-portal'))).toEqual({ ok: false, error: 'unavailable' });
    // Another subframe of the same host, one that never said it claims, and the claim frame's old document: refused.
    await hello(worker, frame(ICIMS_PORTAL, 4, 'doc-other'), { isTop: false });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate' },
      frame(ICIMS_PORTAL, 4, 'doc-other'))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate' },
      frame(ICIMS_PORTAL, 3, 'doc-old'))).toEqual({ ok: false, error: 'bad_sender' });
    // A second frame claiming the same application: unsure, so none is the claim frame.
    await hello(worker, frame(ICIMS_PORTAL, 6, 'doc-twin'), { isTop: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate' },
      frame(ICIMS_PORTAL, 3, 'doc-portal'))).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('takes the agent’s entry note from the claim frame, and from no other subframe', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, frame(ICIMS_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
    await hello(worker, frame(ICIMS_PORTAL, 3, 'doc-portal'), { isTop: false, hasForm: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'agent/entered' }, frame(ICIMS_PORTAL, 3, 'doc-portal')))
      .toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'agent/entered' }, frame(ICIMS_PORTAL, 4, 'doc-x')))
      .toEqual({ ok: false, error: 'bad_sender' });
  });
});

describe('the address TailorIT is asked with (item 6)', () => {
  it('names an iCIMS step page by its posting’s canonical address, never its tokens', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    const step = 'https://careers-edgewaterit.icims.com/jobs/4828/x/candidate?from=login&eem=EEM&code=CODE&in_iframe=1';
    const sender = frame(step, 0, 'doc-step');
    await hello(worker, sender);
    await worker.deliver({ v: 1, type: 'run/begin', applicationKey: keyOf(step), trigger: 'launcher', dryRun: false },
      sender);
    expect(lastLookupUrl(worker)).toBe('https://careers-edgewaterit.icims.com/jobs/4828/job');
  });
});
