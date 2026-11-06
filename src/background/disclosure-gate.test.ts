/*
 * The lookup on load waits for the disclosure (docs/SPEC-AMENDMENTS.md §12 Decision 6, the v3 Phase 4 review: "Until
 * the person acknowledged the disclosure as it reads now ... no page is looked up as it loads"), through the real
 * worker against the fake TailorIT, with a frame that relays job/refresh as a real one does. The audit of 2026-11-06
 * found the gate untested: a mutation that dropped it survived, because no earlier test relayed the lookup at all.
 */
import { describe, expect, it } from 'vitest';
import {
  contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const LOOKUP = 'POST /api/autofill/lookup';

/** The frame answers job/refresh as a real one does: job/lookup from its document now (`sender()`). */
function relaying(worker: TestWorker, sender: () => ReturnType<typeof contentSender>): void {
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    return (await worker.deliver({ v: 1, type: 'job/lookup' }, sender())) as { ok: boolean };
  };
}

describe('the lookup on load and the disclosure', () => {
  it('looks a form up as it loads only once the disclosure as it reads now was acknowledged', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), disclosure: 1, lookupOnLoad: true });
    let frame = contentSender();
    relaying(worker, () => frame);
    // A form loads before the person acknowledged the changed disclosure: nothing is set off for it.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame);
    // I understand: the next document that loads is looked up, and only it.
    await worker.deliver({ v: 1, type: 'auth/acknowledgeDisclosure' }, pageSender());
    frame = contentSender({ documentId: 'doc-2' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame);
    await expect.poll(() => worker.tailorit.count(LOOKUP)).toBe(1);
    // What the first document's hello would have set off went before the second's: by now it would show.
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh')
      .map((sent) => sent.options?.documentId)).toEqual(['doc-2']);
  });
});
