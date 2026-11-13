/*
 * jr7 AUTO-7 (SP\jr7\FIX7PLAN.md §6.4 item 20; ICIMS7-11, D-6): the address a Jibe page's adapter names for TailorIT
 * (frame/hello's tailoritAddress) is checked again by the worker (frames.ts checkedTailoritAddress) and only then asked
 * with: an https iCIMS posting or form of the same numeric job id, no credentials, no query, no fragment, named by a
 * Jibe posting page alone. Synthetic addresses of snapshot7 icims2's shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { checkedTailoritAddress } from './frames';
import { contentSender, startTestWorker, tokenRecord } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const JIBE = 'https://acme.jibeapply.com/jobs/31337?lang=en-us';
const ICIMS = 'https://careers-acme.icims.com/jobs/31337/job';

describe('jr7 AUTO-7, ICIMS7-11: the worker’s check of a Jibe page’s iCIMS address', () => {
  it('takes the same job’s https iCIMS posting, built from parts', () => {
    expect(checkedTailoritAddress(JIBE, ICIMS)).toBe(ICIMS);
    expect(checkedTailoritAddress(JIBE, 'https://careers-acme.icims.com/jobs/31337/engineer/job')).not.toBeNull();
  });

  it('refuses another job, a query, a fragment, credentials, http, another host, and any page but a Jibe posting', () => {
    for (const named of ['https://careers-acme.icims.com/jobs/31338/job', `${ICIMS}?mode=apply`, `${ICIMS}#x`,
      'https://user:pass@careers-acme.icims.com/jobs/31337/job', 'http://careers-acme.icims.com/jobs/31337/job',
      'https://evil.example/jobs/31337/job', 'https://jobs.lever.co/acme/31337', 'not an address']) {
      expect(checkedTailoritAddress(JIBE, named), named).toBeNull();
    }
    expect(checkedTailoritAddress('https://acme.jibeapply.com/about', ICIMS)).toBeNull();
    expect(checkedTailoritAddress('https://careers-acme.icims.com/jobs/31337/job', ICIMS)).toBeNull();
  });

  it('keeps a checked address on the top frame’s entry (TailorIT is asked with it), never a refused one', async () => {
    for (const named of [ICIMS, 'https://careers-acme.icims.com/jobs/99999/job']) {
      const worker = await startTestWorker({ token: tokenRecord() });
      const sender = contentSender({ url: JIBE, tab: { id: 7, url: JIBE }, frameId: 0, documentId: 'doc-jibe' });
      expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, tailoritAddress: named },
        sender)).toMatchObject({ ok: true });
      const entry = (await fakeBrowser.storage.session.get('frames:7:0'))['frames:7:0'] as { tailoritUrl?: string };
      expect(entry.tailoritUrl, named).toBe(named === ICIMS ? ICIMS : undefined);
    }
    // A subframe's is never kept.
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false, tailoritAddress: ICIMS },
      contentSender({ url: JIBE, tab: { id: 7, url: JIBE }, frameId: 3, documentId: 'doc-sub' }));
    const sub = (await fakeBrowser.storage.session.get('frames:7:3'))['frames:7:3'] as { tailoritUrl?: string } | undefined;
    expect(sub?.tailoritUrl).toBeUndefined();
  });
});
