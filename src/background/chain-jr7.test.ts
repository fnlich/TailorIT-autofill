/*
 * jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5): the tab's chains through the real worker (index.ts, frames.ts, chain.ts,
 * submissions.ts) over WXT's fake browser and a fake TailorIT. Synthetic addresses with the shapes of the owner's
 * snapshot7 captures; every per-person value is a placeholder:
 * - ICIMS7-01 with AUTO-7's A1 (O-1): a portal whose forms host is not its own name's (arc-onesolutions frames its IForm
 *   from oneblood.icims.com) declares the forms frame's origin in its hello; the IForm leaf is keyed by it, its final
 *   Submit armed, and its confirmation in the portal's frame records the job submitted: POST /applied exactly once;
 * - ICIMS7-V1: the step facts the portal said before a leaf's press never reach a leaf document chained after it: a
 *   (2/2) leaf is never handed its (1/2) facts;
 * - PC7-03: Paycom's /applications page (a new document) takes the application of the tab's posting whose press came
 *   within PAIR_MS, once per press;
 * - UKGR-3: UKG Ready's applicant session takes its posting's application by the referrer.
 * UKG Ready's and Paycom's addresses are read by their packages' own parsers (UKGREADY-7, DFPC-7): the posting keyed
 * per job; the session or the application an application page whose number is never read (FIX7PLAN §6.14 item 2,
 * §6.11 Paycom item 2). jr7 INT-7: the stand-ins this file held until those parsers merged are gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import type { ChainStepFacts } from '../adapters/types';
import { CHAIN_FACTS_PREFIX, CHAIN_MS, CHAIN_PAIR_PREFIX, PAIR_MS } from './chain';
import { contentSender, goldens, startTestWorker, tokenRecord, typeOfSent, type TestWorker } from './worker.testkit';
import type { TabMessage } from '../platform/fake';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const OTHER_TAB = 8;
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };

function sender(url: string, frameId: number, documentId: string, top: string, tabId = TAB, incognito = false) {
  return contentSender({ url, tab: { id: tabId, url: top, ...(incognito ? { incognito } : {}) }, frameId, documentId });
}
type Sender = ReturnType<typeof sender>;
const hello = (worker: TestWorker, from: Sender, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: from.frameId === 0, hasForm: true, ...extra }, from) as
    Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.count('POST /api/autofill/applied');

/** Lets the worker's unawaited work (leafChained after a hello, notePair) run to its end. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Frames take every message; a portal's ping is answered by its own document. */
function answering(worker: TestWorker): void {
  worker.fakes.frameAnswers = (sent: TabMessage) => (typeOfSent(sent) === 'frame/ping'
    ? { ok: true, data: { pong: true } } : { ok: true, data: {} });
}

// ── iCIMS: arc-onesolutions' shape (the portal's forms host is another company's name) ──
const IC_WRAPPER = 'https://arc-acmeone.icims.com/jobs/17204/platform-engineer/form?form=F&step=6&isPacket=1&type=4&hashed=1';
const IC_PORTAL = `${IC_WRAPPER}&in_iframe=1`;
const FORMS_ORIGIN = 'https://acmeblood.icims.com';
const IC_FORMS = `${FORMS_ORIGIN}/forms?module=Forms&action=showForm&form=F&user=USER&item=1&token=T&isPacket=1&in_iframe=1&step=6`;
const IC_FORMS_2 = `${FORMS_ORIGIN}/forms?token=T&isPacket=1&selected=Second_Form&in_iframe=1&step=6`;
const IC_DONE_TOP = 'https://arc-acmeone.icims.com/jobs/17204/platform-engineer/job?mode=submit_apply';
const IC_DONE_FRAME = `${IC_DONE_TOP}&in_iframe=1`;

const icFrame = (url: string, frameId: number, documentId: string, top = IC_WRAPPER, tabId = TAB) =>
  sender(url, frameId, documentId, top, tabId);
const asLeaf = { isTop: false, chain: { frame: true } };

/** The wrapper (0) and its claimed portal frame (3), which declares `origins` (none: the hello of jr6). */
async function portalUp(worker: TestWorker, origins?: unknown[], tabId = TAB): Promise<Sender> {
  await hello(worker, icFrame(IC_WRAPPER, 0, `doc-wrapper-${tabId}`, IC_WRAPPER, tabId), { hasForm: false, wraps: true });
  const portal = icFrame(IC_PORTAL, 3, `doc-portal-${tabId}`, IC_WRAPPER, tabId);
  expect((await hello(worker, portal, { isTop: false, hasForm: false, claimed: true,
    ...(origins === undefined ? {} : { childOrigins: origins }) })).ok).toBe(true);
  return portal;
}

describe('jr7 CHAIN-7 ICIMS7-01 (with AUTO-7 A1, O-1): a portal that declares its forms frame’s origin', () => {
  it('keys the leaf on oneblood’s shape: final Submit armed, confirmation in the portal’s frame, POST /applied once',
    async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
      answering(worker);
      await portalUp(worker, [FORMS_ORIGIN]);
      const key = keyOf(IC_PORTAL);
      const leaf = icFrame(IC_FORMS, 5, 'doc-forms');
      expect((await hello(worker, leaf, asLeaf)).data?.chained).toEqual({ applicationKey: key });
      // The leaf's final Submit (the run's, Submit mode Auto).
      expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto' }, leaf))
        .toEqual({ ok: true, data: {} });
      // job?mode=submit_apply loads in the portal's frame (a new document, still claimed): submitted, once.
      const done = icFrame(IC_DONE_FRAME, 3, 'doc-done', IC_DONE_TOP);
      await hello(worker, done, { isTop: false, hasForm: false, claimed: true });
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'confirmation-page' },
        done)).toEqual({ ok: true, data: {} });
      expect(applied(worker)).toBe(1);
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'confirmation-page' },
        done)).toMatchObject({ ok: false, error: 'expired' });
      expect(applied(worker)).toBe(1);
      // TailorIT heard the posting's canonical address, never the leaf's or the portal's tokens.
      const sent = worker.tailorit.requests.filter((each) => each.path === '/api/autofill/applied');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toContain('arc-acmeone.icims.com/jobs/17204');
      expect(sent[0]!.body).not.toMatch(/USER|token=|acmeblood|in_iframe|hashed/);
    });

  it('ICIMS7-V2 with A1: the person’s own Submit on the leaf (by: page) is recorded once too', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    answering(worker);
    await portalUp(worker, [FORMS_ORIGIN]);
    const key = keyOf(IC_PORTAL);
    const leaf = icFrame(IC_FORMS, 5, 'doc-forms');
    await hello(worker, leaf, asLeaf);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'page' }, leaf))
      .toEqual({ ok: true, data: {} });
    const done = icFrame(IC_DONE_FRAME, 3, 'doc-done', IC_DONE_TOP);
    await hello(worker, done, { isTop: false, hasForm: false, claimed: true });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'confirmation-page' },
      done)).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toBe(1);
  });

  it('keys nothing on the host-name rule alone, as before (the jr6 hello declares no origin)', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    answering(worker);
    await portalUp(worker);
    expect((await hello(worker, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf)).data?.chained).toBeUndefined();
  });

  it('refuses a declared origin of another forms host, two declared origins, and anything no forms origin', async () => {
    for (const origins of [['https://otherforms.icims.com'], [FORMS_ORIGIN, 'https://otherforms.icims.com'],
      ['https://acmeblood.icims.com.example.com'], ['https://www.icims.com'], ['https://login.icims.com'],
      ['https://careers-acmeblood.icims.com'], ['https://example.com']]) {
      const worker = await startTestWorker({ token: tokenRecord() });
      answering(worker);
      const declared = await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true,
        childOrigins: origins }, icFrame(IC_PORTAL, 3, 'doc-portal'));
      // The schema takes the shape; the worker keeps none it may not.
      expect((declared as Answer).ok, origins.join()).toBe(true);
      await hello(worker, icFrame(IC_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
      expect((await hello(worker, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf)).data?.chained, origins.join())
        .toBeUndefined();
    }
  });

  it('takes no forms origin declared by another platform’s page: it keys no iCIMS leaf and may say no facts', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    answering(worker);
    const posting = 'https://job-boards.greenhouse.io/acme/jobs/5512345002';
    const greenhouse = sender(posting, 0, 'doc-gh', posting);
    await hello(worker, greenhouse, { hasForm: false, childOrigins: [FORMS_ORIGIN] });
    expect(await worker.deliver({ v: 1, type: 'chain/facts', facts: FIRST }, greenhouse))
      .toMatchObject({ ok: false, error: 'expired' });
    expect((await hello(worker, sender(IC_FORMS, 5, 'doc-forms', posting), asLeaf)).data?.chained).toBeUndefined();
  });

  it('refuses a hello whose childOrigins are no origins (the schema), and an address said as one', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    for (const childOrigins of [[`${FORMS_ORIGIN}/forms`], ['http://acmeblood.icims.com'], ['x'], new Array(5)
      .fill(FORMS_ORIGIN), [`${FORMS_ORIGIN}?user=USER`]]) {
      expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, claimed: true,
        childOrigins }, icFrame(IC_PORTAL, 3, 'doc-portal'))).toMatchObject({ ok: false, error: 'bad_message' });
    }
  });

  it('keys a leaf only from the tab’s one fresh claim frame: not an unclaimed frame, another tab or a stale portal',
    async () => {
      // An unclaimed subframe that declares the origin: no portal.
      const loose = await startTestWorker({ token: tokenRecord() });
      answering(loose);
      await hello(loose, icFrame(IC_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
      await hello(loose, icFrame(IC_PORTAL, 4, 'doc-loose'), { isTop: false, hasForm: false, childOrigins: [FORMS_ORIGIN] });
      expect((await hello(loose, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf)).data?.chained).toBeUndefined();
      // Another tab's portal declared it: this tab's leaf is not keyed.
      const tabs = await startTestWorker({ token: tokenRecord() });
      answering(tabs);
      await portalUp(tabs, [FORMS_ORIGIN], OTHER_TAB);
      await hello(tabs, icFrame(IC_WRAPPER, 0, 'doc-wrapper'), { hasForm: false, wraps: true });
      expect((await hello(tabs, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf)).data?.chained).toBeUndefined();
      // A portal whose last hello is older than CHAIN_MS.
      const stale = await startTestWorker({ token: tokenRecord() });
      answering(stale);
      await portalUp(stale, [FORMS_ORIGIN]);
      stale.clock.now += CHAIN_MS + 1;
      expect((await hello(stale, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf)).data?.chained).toBeUndefined();
    });

  it('relays the portal’s step facts to the keyed leaf (factsPortalOf and leavesOf by the declared origin)', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    answering(worker);
    const portal = await portalUp(worker, [FORMS_ORIGIN]);
    await hello(worker, icFrame(IC_FORMS, 5, 'doc-forms'), asLeaf);
    expect(await worker.deliver({ v: 1, type: 'chain/facts', facts: FIRST }, portal)).toEqual({ ok: true, data: {} });
    expect(handed(worker)).toEqual([{ frameId: 5, documentId: 'doc-forms', facts: FIRST }]);
  });
});

// ── ICIMS7-V1: fresh facts only ──
const FIRST: ChainStepFacts = { stepId: 'Step_perPortalSubmittalFormsStep', lastStep: true, packet: { n: 1, m: 2 },
  counters: 1 };
const SECOND: ChainStepFacts = { ...FIRST, packet: { n: 2, m: 2 } };

/** The chain/leafFacts the worker sent: to which leaf document, and what. */
const handed = (worker: TestWorker) => worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'chain/leafFacts')
  .map((sent) => ({ frameId: sent.options?.frameId, documentId: sent.options?.documentId,
    facts: (sent.message as { facts: unknown }).facts }));
const pressed = (worker: TestWorker, from: Sender) =>
  worker.deliver({ v: 1, type: 'chain/pressed' }, from) as Promise<Answer>;

/** The portal declared and said (1/2); its first leaf document (frame 5) holds them. */
async function packetFirst(): Promise<{ worker: TestWorker; portal: Sender; first: Sender }> {
  const worker = await startTestWorker({ token: tokenRecord() });
  answering(worker);
  const portal = await portalUp(worker, [FORMS_ORIGIN]);
  const first = icFrame(IC_FORMS, 5, 'doc-forms-1');
  await hello(worker, first, asLeaf);
  await worker.deliver({ v: 1, type: 'chain/facts', facts: FIRST }, portal);
  expect(handed(worker)).toEqual([{ frameId: 5, documentId: 'doc-forms-1', facts: FIRST }]);
  return { worker, portal, first };
}

describe('jr7 CHAIN-7 ICIMS7-V1: a leaf document chained after a leaf’s press hears only facts said after it', () => {
  it('control (the hazard): without the press, the (2/2) leaf document is handed the (1/2) facts', async () => {
    const { worker } = await packetFirst();
    await hello(worker, icFrame(IC_FORMS_2, 5, 'doc-forms-2'), asLeaf);
    await settle();
    expect(handed(worker).at(-1)).toEqual({ frameId: 5, documentId: 'doc-forms-2', facts: FIRST });
  });

  it('after the press: the next leaf document is handed nothing, then the (2/2) facts once the portal says them',
    async () => {
      const { worker, portal, first } = await packetFirst();
      expect(await pressed(worker, first)).toEqual({ ok: true, data: {} });
      await hello(worker, icFrame(IC_FORMS_2, 5, 'doc-forms-2'), asLeaf);
      await settle();
      expect(handed(worker)).toHaveLength(1);
      expect(await worker.deliver({ v: 1, type: 'chain/facts', facts: SECOND }, portal)).toEqual({ ok: true, data: {} });
      expect(handed(worker).slice(1)).toEqual([{ frameId: 5, documentId: 'doc-forms-2', facts: SECOND }]);
    });

  it('after the press: (2/2) said before the next leaf document’s hello is handed to it at its hello', async () => {
    const { worker, portal, first } = await packetFirst();
    await pressed(worker, first);
    await worker.deliver({ v: 1, type: 'chain/facts', facts: SECOND }, portal);
    // The pressing document hears nothing newer than its own form's facts.
    expect(handed(worker)).toHaveLength(1);
    await hello(worker, icFrame(IC_FORMS_2, 5, 'doc-forms-2'), asLeaf);
    await settle();
    expect(handed(worker).slice(1)).toEqual([{ frameId: 5, documentId: 'doc-forms-2', facts: SECOND }]);
  });

  it('a press before the portal said any: the next facts reach the next leaf document', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    answering(worker);
    const portal = await portalUp(worker, [FORMS_ORIGIN]);
    const first = icFrame(IC_FORMS, 5, 'doc-forms-1');
    await hello(worker, first, asLeaf);
    expect(await pressed(worker, first)).toEqual({ ok: true, data: {} });
    await hello(worker, icFrame(IC_FORMS_2, 5, 'doc-forms-2'), asLeaf);
    await worker.deliver({ v: 1, type: 'chain/facts', facts: SECOND }, portal);
    expect(handed(worker)).toEqual([{ frameId: 5, documentId: 'doc-forms-2', facts: SECOND }]);
    // Ids, numbers and counts only.
    const kept = Object.entries(await fakeBrowser.storage.session.get(null))
      .filter(([key]) => key.startsWith(CHAIN_FACTS_PREFIX));
    expect(JSON.stringify(kept)).not.toMatch(/https?:|icims\.com|USER|token=/i);
  });

  it('takes chain/pressed from a keyed leaf alone: the portal, the wrapper, an unkeyed frame, another tab, private',
    async () => {
      const { worker, portal } = await packetFirst();
      const refused = { ok: false, error: 'expired' };
      expect(await pressed(worker, portal)).toMatchObject(refused);
      expect(await pressed(worker, icFrame(IC_WRAPPER, 0, `doc-wrapper-${TAB}`))).toMatchObject(refused);
      const loose = icFrame(IC_FORMS, 9, 'doc-loose');
      await hello(worker, loose, { isTop: false });
      expect(await pressed(worker, loose)).toMatchObject(refused);
      expect(await pressed(worker, icFrame(IC_FORMS, 5, 'doc-forms-1', IC_WRAPPER, OTHER_TAB))).toMatchObject(refused);
      expect(await pressed(worker, sender(IC_FORMS, 5, 'doc-forms-1', IC_WRAPPER, TAB, true))).toMatchObject(refused);
      // A stale document of the leaf frame (not the one registered).
      expect(await pressed(worker, icFrame(IC_FORMS, 5, 'doc-forms-0'))).toMatchObject(refused);
      // None of them changed what a next leaf document hears: still the (1/2) facts (no press was taken).
      await hello(worker, icFrame(IC_FORMS_2, 5, 'doc-forms-2'), asLeaf);
      await settle();
      expect(handed(worker).at(-1)).toEqual({ frameId: 5, documentId: 'doc-forms-2', facts: FIRST });
    });
});

// ── PC7-03: Paycom's pair ──
const PAYCOM = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF';
const PC_POSTING = `${PAYCOM}/jobs/4321`;
const PC_APPLICATION = `${PAYCOM}/applications#/applications/98765`;
const PC_OTHER_TENANT = 'https://www.paycomonline.net/v4/ats/web.php/portal/FEDCBA9876543210FEDCBA9876543210/applications#/applications/98765';

const top = (url: string, documentId: string, tabId = TAB, incognito = false) =>
  sender(url, 0, documentId, url, tabId, incognito);
const wall = (worker: TestWorker, from: Sender, shown: 'create-account' | null) =>
  worker.deliver({ v: 1, type: 'frame/wall', wall: shown }, from);

/** The posting's document, its contact dialog shown (frame/wall): the tab's latest posting press. */
async function postingPressed(tabId = TAB, incognito = false): Promise<{ worker: TestWorker; posting: string }> {
  const worker = await startTestWorker({ token: tokenRecord() });
  const posting = keyOf(PC_POSTING);
  await hello(worker, top(PC_POSTING, 'doc-posting', tabId, incognito), { hasForm: false });
  await wall(worker, top(PC_POSTING, 'doc-posting', tabId, incognito), 'create-account');
  await settle();
  return { worker, posting };
}

describe('jr7 CHAIN-7 PC7-03: Paycom’s application takes its posting’s, by the tab’s latest posting press', () => {
  it('the posting’s and the application’s own keys differ (the number is never the posting’s)', () => {
    expect(keyOf(PC_APPLICATION)).not.toBe(keyOf(PC_POSTING));
  });

  it('keys the /applications document by the posting within PAIR_MS of the press, once, named by the posting', async () => {
    const { worker, posting } = await postingPressed();
    worker.clock.now += PAIR_MS - 1;
    const first = await hello(worker, top(PC_APPLICATION, 'doc-application'));
    expect(first.data?.chained).toEqual({ applicationKey: posting });
    // The same document's later hellos keep it (a route of its own).
    expect((await hello(worker, top(`${PAYCOM}/applications#/applications/98765/questions`, 'doc-application'),
      { nav: 1 })).data?.chained).toEqual({ applicationKey: posting });
    // Once per press: another document after it is its own.
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application-2'))).data?.chained).toBeUndefined();
    // The kept press holds no page address, no application number.
    const kept = await fakeBrowser.storage.session.get(`${CHAIN_PAIR_PREFIX}${TAB}`);
    expect(JSON.stringify(kept)).not.toMatch(/98765|applications/);
  });

  it('a new press (the sign-in step, the person’s Apply) is taken again; each of the notes counts', async () => {
    const { worker, posting } = await postingPressed();
    worker.clock.now += PAIR_MS + 1;
    // The posting's sign-in step under Sign-in Auto asks its credential just before pressing Continue.
    await worker.deliver({ v: 1, type: 'signin/credential', wall: 'create-account' }, top(PC_POSTING, 'doc-posting'));
    await settle();
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application'))).data?.chained)
      .toEqual({ applicationKey: posting });
    // The person's Autofill pressed the posting's Apply (entry/pressed), on a posting shown again.
    await hello(worker, top(PC_POSTING, 'doc-posting-2'), { hasForm: false });
    await wall(worker, top(PC_POSTING, 'doc-posting-2'), null);
    worker.clock.now += PAIR_MS + 1;
    await worker.deliver({ v: 1, type: 'entry/pressed' }, top(PC_POSTING, 'doc-posting-2'));
    await settle();
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application-3'))).data?.chained)
      .toEqual({ applicationKey: posting });
    // The agent's entry pressed on the posting (agent/entered).
    await hello(worker, top(PC_POSTING, 'doc-posting-3'), { hasForm: false });
    worker.clock.now += PAIR_MS + 1;
    await worker.deliver({ v: 1, type: 'agent/entered' }, top(PC_POSTING, 'doc-posting-3'));
    await settle();
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application-4'))).data?.chained)
      .toEqual({ applicationKey: posting });
  });

  it('refuses after PAIR_MS, for another client key, in another tab, in a private tab, and with no press', async () => {
    const late = await postingPressed();
    late.worker.clock.now += PAIR_MS + 1;
    expect((await hello(late.worker, top(PC_APPLICATION, 'doc-application'))).data?.chained).toBeUndefined();
    const tenant = await postingPressed();
    expect((await hello(tenant.worker, top(PC_OTHER_TENANT, 'doc-application'))).data?.chained).toBeUndefined();
    const tabs = await postingPressed();
    expect((await hello(tabs.worker, top(PC_APPLICATION, 'doc-application', OTHER_TAB))).data?.chained).toBeUndefined();
    const hidden = await postingPressed(TAB, true);
    expect((await hello(hidden.worker, top(PC_APPLICATION, 'doc-application', TAB, true))).data?.chained)
      .toBeUndefined();
    // The posting said hello but nothing was pressed or shown there.
    const quiet = await startTestWorker({ token: tokenRecord() });
    await hello(quiet, top(PC_POSTING, 'doc-posting'), { hasForm: false });
    expect((await hello(quiet, top(PC_APPLICATION, 'doc-application'))).data?.chained).toBeUndefined();
  });

  it('never takes the pair by a referrer the page names, nor a press of a subframe', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, top(PC_POSTING, 'doc-posting'), { hasForm: false });
    // The application's hello names the posting as its referrer: no press, no pair.
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application'), { chain: { from: hrefHash(PC_POSTING) } }))
      .data?.chained).toBeUndefined();
    // A subframe of the posting's tab says a wall: no press noted.
    await hello(worker, sender(PC_POSTING, 4, 'doc-frame', PC_POSTING), { isTop: false, hasForm: false });
    await wall(worker, sender(PC_POSTING, 4, 'doc-frame', PC_POSTING), 'create-account');
    await settle();
    expect((await hello(worker, top(PC_APPLICATION, 'doc-application-2'))).data?.chained).toBeUndefined();
  });
});

// ── UKGR-3: UKG Ready's applicant session ──
const UKG = 'https://secure7.saashr.com/ta/1234567.careers';
const UKG_POSTING = `${UKG}?lang=en-US&ein_id=111111111&ShowJob=222222222&src=LinkedIn`;
const UKG_OTHER_POSTING = `${UKG}?lang=en-US&ein_id=111111111&ShowJob=222222299&src=LinkedIn`;
const UKG_SESSION = `${UKG}?rnd=ABC&Ext=careers&sft=XYZXYZXYZX&ActiveSessionId=33333333333#applicant/profile`;
const UKG_OTHER_COMPANY = 'https://secure7.saashr.com/ta/7654321.careers?ShowJob=222222222';

describe('jr7 CHAIN-7 UKGR-3: UKG Ready’s applicant session takes its posting’s application by the referrer', () => {
  it('keys the session by the posting it came from, per job; its later hellos keep it', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, top(UKG_POSTING, 'doc-posting'), { hasForm: false });
    await hello(worker, top(UKG_OTHER_POSTING, 'doc-other'), { hasForm: false });
    expect(keyOf(UKG_POSTING)).not.toBe(keyOf(UKG_OTHER_POSTING));
    const session = await hello(worker, top(UKG_SESSION, 'doc-session'), { chain: { from: hrefHash(UKG_POSTING) } });
    expect(session.data?.chained).toEqual({ applicationKey: keyOf(UKG_POSTING) });
    expect((await hello(worker, top(UKG_SESSION.replace('profile', 'work'), 'doc-session'), { nav: 1 })).data?.chained)
      .toEqual({ applicationKey: keyOf(UKG_POSTING) });
    // The tab's chain keeps no session value.
    expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).not.toMatch(/33333333333|XYZXYZ|rnd=ABC/);
  });

  it('refuses a referrer the tab never showed, another company’s posting, another tab and a stale one', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker, top(UKG_OTHER_COMPANY, 'doc-company'), { hasForm: false });
    expect((await hello(worker, top(UKG_SESSION, 'doc-session'), { chain: { from: hrefHash(UKG_POSTING) } }))
      .data?.chained).toBeUndefined();
    expect((await hello(worker, top(UKG_SESSION, 'doc-session-2'), { chain: { from: hrefHash(UKG_OTHER_COMPANY) } }))
      .data?.chained).toBeUndefined();
    await hello(worker, top(UKG_POSTING, 'doc-posting', OTHER_TAB), { hasForm: false });
    expect((await hello(worker, top(UKG_SESSION, 'doc-session-3'), { chain: { from: hrefHash(UKG_POSTING) } }))
      .data?.chained).toBeUndefined();
    await hello(worker, top(UKG_POSTING, 'doc-posting'), { hasForm: false });
    worker.clock.now += CHAIN_MS + 1;
    expect((await hello(worker, top(UKG_SESSION, 'doc-session-4'), { chain: { from: hrefHash(UKG_POSTING) } }))
      .data?.chained).toBeUndefined();
  });
});
