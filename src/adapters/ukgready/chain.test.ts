/*
 * UKG Ready's application from its posting to its success, through the real worker (background/index.ts, chain.ts,
 * submissions.ts) over WXT's fake browser and a fake TailorIT (jr7 FIX7PLAN §6.14 Tests; UKGR-3, UKGR-8, UKGR-12): the
 * posting's document (its choice and its start form are drawn in place there), then the applicant session's new
 * document, which takes the posting's application by the browser's referrer (CHAIN-7's family ukgready:<host>:<company>),
 * its later steps at the same address, the review's "Sign & submit application" and the consent's "I Agree" (two
 * presses of one application, the second replacing the first), and "We got it!" drawn in place: TailorIT hears the job
 * applied exactly once, named by the posting's address with its ShowJob alone, never a session value. Synthetic
 * addresses in the shapes of the owner's snapshot7 [secure7.saashr.com]; made-up numbers.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { contentSender, goldens, startTestWorker, tokenRecord, typeOfSent, type TestWorker } from '../../background/worker.testkit';
import type { TabMessage } from '../../platform/fake';
import { hrefHash } from '../chain';
import { applicationOf } from '../index';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const CAREERS = 'https://secure7.saashr.com/ta/1234567.careers';
/** jr7-saashr-posting's shape: the posting, where its choice and its start form are drawn in place. */
const POSTING = `${CAREERS}?lang=en-US&ein_id=111111111&ShowJob=222222222&src=REDACTED`;
const OTHER_POSTING = `${CAREERS}?ShowJob=222222299`;
/** jr7-saashr-contact's shape: the applicant session after the start form's Continue (made-up session values). */
const SESSION = `${CAREERS}?rnd=ABC&Ext=careers&sft=XYZXYZXYZX&ActiveSessionId=33333333333#applicant/profile`;

type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string } } };
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
const top = (url: string, documentId: string) =>
  contentSender({ url, tab: { id: TAB, url }, frameId: 0, documentId });
type Sender = ReturnType<typeof top>;
const hello = (worker: TestWorker, from: Sender, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, from) as Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.count('POST /api/autofill/applied');

/** Frames take every message. */
function answering(worker: TestWorker): void {
  worker.fakes.frameAnswers = (sent: TabMessage) => (typeOfSent(sent) === 'frame/ping'
    ? { ok: true, data: { pong: true } } : { ok: true, data: {} });
}

/** The posting's document, then its start form drawn in place, then the session's document keyed by the referrer. */
async function toSession(worker: TestWorker): Promise<{ session: Sender; key: string }> {
  const posting = top(POSTING, 'doc-posting');
  await hello(worker, posting, { hasForm: false });
  // The start form ("Type it in myself") is drawn at the posting's own address: the same document, now with a form.
  await hello(worker, posting, { hasForm: true });
  const session = top(SESSION, 'doc-session');
  const answer = await hello(worker, session, { chain: { from: hrefHash(POSTING) } });
  return { session, key: answer.data?.chained?.applicationKey ?? '' };
}

describe('UKG Ready from its posting to its success (UKGR-3, UKGR-8, UKGR-12)', () => {
  it('keys the session per job by its posting, and records the application once after Sign & submit, then I Agree',
    async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
      answering(worker);
      const { session, key } = await toSession(worker);
      expect(key).toBe(keyOf(POSTING));
      expect(key).not.toBe(keyOf(SESSION));
      // Every later step (work, education, the questionnaire, the review) is the same document at the same address.
      for (const [nav, step] of [[1, 'work'], [2, 'education'], [3, 'review']] as const) {
        expect((await hello(worker, top(SESSION.replace('profile', step), 'doc-session'), { nav })).data?.chained)
          .toEqual({ applicationKey: key });
      }
      // The review's "Sign & submit application" (the person's), then the consent's "I Agree": one application, the
      // second arm in the first's place.
      expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'page' }, session))
        .toEqual({ ok: true, data: {} });
      expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'page' }, session))
        .toEqual({ ok: true, data: {} });
      expect(applied(worker)).toBe(0);
      // "We got it!" drawn in place (content/submitted.ts: the success rule): submitted, once.
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'success-message' },
        session)).toEqual({ ok: true, data: {} });
      expect(applied(worker)).toBe(1);
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'success-message' },
        session)).toMatchObject({ ok: false });
      expect(applied(worker)).toBe(1);
      // TailorIT heard the posting by its ShowJob alone: no session value, no other parameter of the page.
      const sent = worker.tailorit.requests.filter((each) => each.path === '/api/autofill/applied');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toContain('secure7.saashr.com/ta/1234567.careers?ShowJob=222222222');
      expect(sent[0]!.body).not.toMatch(/33333333333|XYZXYZ|rnd=|sft=|ActiveSessionId|ein_id|lang=|src=/);
      expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).not.toMatch(/33333333333|XYZXYZ|rnd=ABC/);
    });

  it('refuses a success under another job\'s key, and keeps the session unkeyed without its posting\'s referrer',
    async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
      answering(worker);
      const { session, key } = await toSession(worker);
      expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'page' }, session))
        .toEqual({ ok: true, data: {} });
      // Another posting's key: never this arm's confirmation.
      expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(OTHER_POSTING),
        evidence: 'success-message' }, session)).toMatchObject({ ok: false });
      expect(applied(worker)).toBe(0);
      // A session reached from no posting this tab showed takes no posting's application.
      const lone = await hello(worker, top(SESSION, 'doc-session-lone'), { chain: { from: hrefHash(OTHER_POSTING) } });
      expect(lone.data?.chained).toBeUndefined();
    });
});
