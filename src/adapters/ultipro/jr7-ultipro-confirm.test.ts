/*
 * jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 1, UP7-01; §7 "not recorded, so applied twice"): UltiPro's page after submitting
 * through the real worker against the fake TailorIT, as submissions.test.ts holds JazzHR's /apply/confirm. The
 * confirmation names no opportunity (its applicationId is never read: FIX7PLAN §5 D-10), so its key is the board's page,
 * not the form's: the worker takes it for the tab's Submit armed in the same frame on the same board, once, by the
 * adapter's confirmationAfter. That reading is AUTO-7's (FIX7PLAN §6.4 item 7: submissions.ts confirmedArm asks
 * confirmationAfter, by the arm's canonical posting address), in since jr7-auto-done (the recording case was held
 * `it.fails` in P1, flipped in P2). Synthetic addresses only.
 */
import { describe, expect, it } from 'vitest';
import { applicationOf } from '../index';
import { contentSender, goldens, startTestWorker, tokenRecord, type TestWorker } from '../../background/worker.testkit';
import { ultiproAdapter } from './index';

const PAGES = 'https://recruiting.ultipro.com/acme1000/JobBoard/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FORM = `${PAGES}/OpportunityApply?opportunityId=2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f`;
const CONFIRM = `${PAGES}/OpportunityApply/ApplicationSubmitted?applicationId=3d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a`;
const OTHER = CONFIRM.replace('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e');
const formKey = applicationOf(new URL(FORM))!.applicationKey;
const keyOf = (url: string) => applicationOf(new URL(url))!.applicationKey;
const at = (url: string, more: Record<string, unknown> = {}) => contentSender({ url, tab: { id: 7, url }, ...more });

async function armed(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, at(FORM));
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: formKey, by: 'page' }, at(FORM)))
    .toEqual({ ok: true, data: {} });
  return worker;
}
const confirmed = (worker: TestWorker, url = CONFIRM, more: Record<string, unknown> = { documentId: 'doc-2' }) =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey: keyOf(url), evidence: 'confirmation-page' }, at(url, more));

describe("UltiPro's page after submitting, through the worker (jr7 UP7-01)", () => {
  it('reads a key of its own, the board\'s, which the adapter pairs with the form', () => {
    expect(keyOf(CONFIRM)).not.toBe(formKey);
    expect(keyOf(CONFIRM)).toBe(keyOf(CONFIRM.replace('3d4e5f6a', '4e5f6a7b')));
    expect(ultiproAdapter.confirmationAfter!(new URL(FORM), new URL(CONFIRM))).toBe(true);
    expect(ultiproAdapter.confirmationAfter!(new URL(FORM), new URL(OTHER))).toBe(false);
  });

  // Flipped in P2: jr7-auto-done's confirmedArm asks the adapter's confirmationAfter (AUTO-7 item 7).
  it("records it for the tab's Submit armed on the same board, once", async () => {
    const worker = await armed();
    expect(await confirmed(worker)).toEqual({ ok: true, data: {} });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(1);
    expect(await confirmed(worker)).toEqual({ ok: false, error: 'expired' });
  });

  it('refuses one from another frame, of another board, or past the minute', async () => {
    const worker = await armed();
    expect(await confirmed(worker, CONFIRM, { frameId: 2, documentId: 'doc-3' })).toEqual({ ok: false, error: 'expired' });
    expect(await confirmed(worker, OTHER)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    worker.clock.now += 61_000;
    expect(await confirmed(worker)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
  });
});
