/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §2-3): the closed check through the
 * real worker (closed-check.ts, closed-reports.ts, report-closed-setting.ts, job-cards.ts): when it looks (2.5 s after a
 * lookup answers the page's own open job, once more 8 s later, at most twice per document, never in a private tab,
 * before the disclosure, for a closed job or one chosen for the page), what goes by itself (via page, the setting on),
 * the card's lines, Report as closed, and the Options switch. The in-page function itself is closed-check.browser.test.ts's.
 * Undo proofs: drop index.ts's openJob and the first test fails; read the setting as off when absent and the first
 * fails too; let a private tab's lookup look and the private test fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AutofillClosedProbeResult, AutofillLookupResponse } from '../contract/tailorit';
import { CLOSED_POSTING_MAX_CHARS, CLOSED_PROBE_AGAIN_MS, CLOSED_PROBE_FIRST_MS, closedFindingOf, probeMarkersFor,
  validThroughPassed } from './closed-check';
import { CLOSED_HOLD_KEY, isoOf } from './closed-reports';
import { JOB_CARD_TTL_MS } from './job-cards';
import { REPORT_CLOSED_KEY, reportClosedAutomatically, setReportClosedAutomatically } from './report-closed-setting';
import { SIDEBAR_PAGE_MESSAGES } from './senders';
import {
  contentSender, goldens, LEVER_POSTING_URL, LEVER_URL, pageSender, START_MS, startTestWorker, tokenRecord,
  type TestWorker, type TestWorkerOptions,
} from './worker.testkit';

const CLOSED = 'POST /api/autofill/jobs/1042/closed';
const golden = goldens.lookup as unknown as AutofillLookupResponse;
const NOTHING: AutofillClosedProbeResult = { markers: [], validThrough: null, hasPosting: false };
const EXPIRED: AutofillClosedProbeResult = { markers: ['generic.job_expired'], validThrough: null, hasPosting: false };

/** A connected worker with the closed check on, whose tab 7 shows `sender`'s page (a Lever form by default), relaying. */
async function withPage(options: TestWorkerOptions & { sender?: ReturnType<typeof contentSender>; hasForm?: boolean } = {}):
  Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord(), closedCheck: true, ...options });
  const sender = options.sender ?? contentSender();
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: options.hasForm ?? true }, sender);
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string; action?: string };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    const answer = (await worker.deliver({ v: 1, type: 'job/lookup' }, sender)) as { ok: boolean };
    return answer.ok ? { ok: true, data: {} } : answer;
  };
  worker.tailorit.reply(CLOSED, { json: { outcome: 'queued' } });
  return worker;
}

const card = async (worker: TestWorker) => ((await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender())) as {
  data: { card: Record<string, unknown> } }).data.card;
const sentReports = (worker: TestWorker) => worker.tailorit.requests.filter((request) => request.path === '/api/autofill/jobs/1042/closed')
  .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);
/** The timers run on, and the worker's work after them settles. */
async function after(worker: TestWorker, ms: number): Promise<void> {
  worker.timers.advance(ms);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await vi.waitFor(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('the closed check (v3.0 X1-EXT)', () => {
  it('looks once, 2.5 s after the panel’s lookup answers the page’s own open job, and reports what it found by itself', async () => {
    const worker = await withPage();
    worker.fakes.probeAnswer = () => EXPIRED;
    expect((await card(worker)).closedSeen).toBeUndefined();
    await after(worker, CLOSED_PROBE_FIRST_MS - 1);
    expect(worker.fakes.probes).toEqual([]);
    await after(worker, 1);
    // In that one document, in its frame, with the closed list's markers for the page's platform and the read's cap.
    expect(worker.fakes.probes).toEqual([{ target: { tabId: 7, documentIds: ['doc-1'] },
      args: [JSON.parse(JSON.stringify(probeMarkersFor('lever'))), CLOSED_POSTING_MAX_CHARS] }]);
    await vi.waitFor(() => expect(sentReports(worker)).toHaveLength(1));
    // The job, the posting's address as the lookup names it, the signal and its marker, how and when: nothing else.
    expect(sentReports(worker)).toEqual([{ url: LEVER_POSTING_URL, signal: 'marker', marker: 'generic.job_expired',
      via: 'page', seenAt: isoOf(START_MS) }]);
    // The card says so: "This posting looks closed. Reported to TailorIT.", and offers no button.
    expect(await card(worker)).toMatchObject({ closedSeen: true, reported: 'auto' });
    expect((await card(worker)).reportable).toBeUndefined();
    // Nothing of it is kept but the queue's own storage.session record, gone once sent.
    expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain(LEVER_POSTING_URL);
    expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).not.toContain(LEVER_POSTING_URL);
    // No third look, and none for a card read again from memory.
    await after(worker, 60_000);
    await card(worker);
    expect(worker.fakes.probes).toHaveLength(1);
  });

  it('looks a second time 8 s later on a posting page that showed nothing yet and no form; never a third', async () => {
    const worker = await withPage({ sender: contentSender({ url: LEVER_POSTING_URL }), hasForm: false });
    worker.fakes.probeAnswer = () => NOTHING;
    await card(worker);
    await after(worker, CLOSED_PROBE_FIRST_MS);
    expect(worker.fakes.probes).toHaveLength(1);
    await after(worker, CLOSED_PROBE_AGAIN_MS - 1);
    expect(worker.fakes.probes).toHaveLength(1);
    worker.fakes.probeAnswer = () => ({ markers: [], validThrough: '2026-10-01', hasPosting: false });
    await after(worker, 1);
    expect(worker.fakes.probes).toHaveLength(2);
    // The second found the posting's end date passed: valid_through_past.
    await vi.waitFor(() => expect(sentReports(worker)).toEqual([{ url: LEVER_POSTING_URL, signal: 'valid_through_past',
      via: 'page', seenAt: isoOf(START_MS) }]));
    // Read again once the card's ten minutes passed: the same document is not looked at again.
    worker.clock.now += JOB_CARD_TTL_MS;
    await card(worker);
    await after(worker, 60_000);
    expect(worker.fakes.probes).toHaveLength(2);
  });

  it('has no second look where the page drew its posting, or a form is there', async () => {
    const drawn = await withPage({ sender: contentSender({ url: LEVER_POSTING_URL }), hasForm: false });
    drawn.fakes.probeAnswer = () => ({ ...NOTHING, hasPosting: true });
    await card(drawn);
    await after(drawn, CLOSED_PROBE_FIRST_MS + CLOSED_PROBE_AGAIN_MS + 1000);
    expect(drawn.fakes.probes).toHaveLength(1);
    const form = await withPage();
    form.fakes.probeAnswer = () => NOTHING;
    await card(form);
    await after(form, CLOSED_PROBE_FIRST_MS + CLOSED_PROBE_AGAIN_MS + 1000);
    expect(form.fakes.probes).toHaveLength(1);
    expect(sentReports(form)).toEqual([]);
  });

  it('never looks in a private tab, before the disclosure is acknowledged, for a closed job or one chosen for the page', async () => {
    const privateTab = await withPage({ sender: contentSender({ tab: { id: 7, incognito: true } }) });
    privateTab.fakes.probeAnswer = () => EXPIRED;
    await card(privateTab);
    await after(privateTab, 30_000);
    expect(privateTab.fakes.probes).toEqual([]);
    // Nor is Report as closed offered there.
    expect((await card(privateTab)).reportable).toBeUndefined();
    expect(await privateTab.deliver({ v: 1, type: 'panel/reportClosed', tabId: 7 }, pageSender()))
      .toEqual({ ok: true, data: { outcome: 'private' } });

    const undisclosed = await withPage({ disclosure: 1 });
    undisclosed.fakes.probeAnswer = () => EXPIRED;
    await card(undisclosed);
    await after(undisclosed, 30_000);
    expect(undisclosed.fakes.probes).toEqual([]);
    expect((await card(undisclosed)).reportable).toBeUndefined();

    const closedJob = await withPage();
    closedJob.tailorit.reply('POST /api/autofill/lookup', { json: { ...golden, job: { ...golden.job!, active: false } } });
    closedJob.fakes.probeAnswer = () => EXPIRED;
    await card(closedJob);
    await after(closedJob, 30_000);
    expect(closedJob.fakes.probes).toEqual([]);

    const chosen = await withPage();
    chosen.tailorit.reply('POST /api/autofill/lookup', { json: { ...golden, job: { ...golden.job!, matchedBy: 'chosen' } } });
    chosen.fakes.probeAnswer = () => EXPIRED;
    await card(chosen);
    await after(chosen, 30_000);
    expect(chosen.fakes.probes).toEqual([]);
    for (const worker of [privateTab, undisclosed, closedJob, chosen]) expect(sentReports(worker)).toEqual([]);
  });

  it('never looks at a document that is gone by the time it would', async () => {
    const worker = await withPage();
    worker.fakes.probeAnswer = () => EXPIRED;
    await card(worker);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender({ documentId: 'doc-2' }));
    await after(worker, 30_000);
    expect(worker.fakes.probes).toEqual([]);
  });

  it('with the setting off, says the posting looks closed and offers Report as closed, sending nothing by itself', async () => {
    const worker = await withPage();
    expect(await worker.deliver({ v: 1, type: 'reports/closedAuto', on: false }, pageSender('options.html')))
      .toEqual({ ok: true, data: { on: false } });
    worker.fakes.probeAnswer = () => EXPIRED;
    await card(worker);
    await after(worker, CLOSED_PROBE_FIRST_MS);
    expect(worker.fakes.probes).toHaveLength(1);
    expect(sentReports(worker)).toEqual([]);
    const shown = await card(worker);
    expect(shown).toMatchObject({ closedSeen: true, reportable: true });
    expect(shown.reported).toBeUndefined();
    // The person's own report: sent at once, signal and via person.
    expect(await worker.deliver({ v: 1, type: 'panel/reportClosed', tabId: 7 }, pageSender()))
      .toEqual({ ok: true, data: { outcome: 'reported' } });
    expect(sentReports(worker)).toEqual([{ url: LEVER_POSTING_URL, signal: 'person', via: 'person', seenAt: isoOf(START_MS) }]);
    expect(await card(worker)).toMatchObject({ closedSeen: true, reported: 'person' });
  });

  it("says TailorIT's words for its daily cap on Report as closed, and holds automatic reports until its reset", async () => {
    const worker = await withPage();
    const resetAt = '2026-10-31T07:00:00.000Z';
    worker.tailorit.reply(CLOSED, { status: 429, json: { error: { code: 'rate_limited',
      message: 'You can report up to 50 closed jobs a day. You can report more after 12:00 AM Pacific Time.', resetAt } } });
    await card(worker);
    expect(await worker.deliver({ v: 1, type: 'panel/reportClosed', tabId: 7 }, pageSender())).toEqual({ ok: true, data: {
      outcome: 'limited', message: 'You can report up to 50 closed jobs a day. You can report more after 12:00 AM Pacific Time.' } });
    expect(await fakeBrowser.storage.session.get(CLOSED_HOLD_KEY)).toEqual({ [CLOSED_HOLD_KEY]: Date.parse(resetAt) });
    // The look that then finds a closed sign queues its report, which waits for the reset.
    worker.fakes.probeAnswer = () => EXPIRED;
    await after(worker, CLOSED_PROBE_FIRST_MS);
    expect(worker.fakes.probes).toHaveLength(1);
    expect(worker.tailorit.count(CLOSED)).toBe(1);
  });

  it('says held and reported from the lookup: "Only you see this job…", "You reported this posting as closed"', async () => {
    const worker = await withPage();
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...golden, job: { ...golden.job!, held: true, reported: true } } });
    const shown = await card(worker);
    expect(shown).toMatchObject({ held: true, reported: 'person' });
    expect(shown.reportable).toBeUndefined();
  });

  it('answers Report as closed with not-connected or unavailable where there is no open job of the page’s own', async () => {
    const worker = await withPage();
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...golden, job: null } });
    expect(await worker.deliver({ v: 1, type: 'panel/reportClosed', tabId: 7 }, pageSender()))
      .toEqual({ ok: true, data: { outcome: 'unavailable' } });
    const offline = await startTestWorker({ closedCheck: true });
    expect(await offline.deliver({ v: 1, type: 'panel/reportClosed', tabId: 7 }, pageSender()))
      .toEqual({ ok: true, data: { outcome: 'not-connected' } });
    expect(sentReports(worker)).toEqual([]);
  });
});

describe('"Report closed jobs to TailorIT automatically" (report-closed-setting.ts, reports/closedAuto)', () => {
  it('reads on unless the person turned it off: absent, anything but false, or a storage that fails', async () => {
    const data = new Map<string, unknown>();
    const local = {
      get: async (key: string) => data.get(key),
      getMany: async () => ({}),
      async set(entries: Record<string, unknown>) {
        for (const [key, value] of Object.entries(entries)) data.set(key, value);
      },
      async remove(keys: readonly string[]) {
        for (const key of keys) data.delete(key);
      },
      async restrictToTrustedContexts() {},
    };
    expect(REPORT_CLOSED_KEY).toBe('reports:closedAuto');
    expect(await reportClosedAutomatically(local)).toBe(true);
    data.set(REPORT_CLOSED_KEY, 'no');
    expect(await reportClosedAutomatically(local)).toBe(true);
    expect(await setReportClosedAutomatically(local, false)).toBe(false);
    expect(await reportClosedAutomatically(local)).toBe(false);
    expect(await reportClosedAutomatically({ ...local, get: async () => Promise.reject(new Error('refused')) })).toBe(true);
  });

  it('is read and set by the options page alone, in storage.local, never by a page’s frame or the sidebar', async () => {
    const worker = await startTestWorker();
    const options = pageSender('options.html');
    expect(await worker.deliver({ v: 1, type: 'reports/closedAuto' }, options)).toEqual({ ok: true, data: { on: true } });
    expect(await worker.deliver({ v: 1, type: 'reports/closedAuto', on: false }, options)).toEqual({ ok: true, data: { on: false } });
    expect(await fakeBrowser.storage.local.get(REPORT_CLOSED_KEY)).toEqual({ [REPORT_CLOSED_KEY]: false });
    expect(await worker.deliver({ v: 1, type: 'reports/closedAuto', on: true }, contentSender())).toMatchObject({ ok: false });
    expect(SIDEBAR_PAGE_MESSAGES.has('reports/closedAuto')).toBe(false);
    // The card's Report as closed is the sidebar's too (the worker reads the card frame's own job and address).
    expect(SIDEBAR_PAGE_MESSAGES.has('panel/reportClosed')).toBe(true);
  });
});

describe('what a look found (closedFindingOf, validThroughPassed)', () => {
  const now = Date.UTC(2026, 10, 14, 12);
  it('takes a strong marker first, then a validThrough before now, then a weak marker; only the markers it was given', () => {
    const all = probeMarkersFor('smartrecruiters');
    expect(closedFindingOf({ markers: ['generic.job_expired', 'smartrecruiters.expired'], validThrough: '2026-01-01',
      hasPosting: false }, now, all)).toEqual({ signal: 'marker', marker: 'smartrecruiters.expired' });
    expect(closedFindingOf({ markers: ['generic.job_expired'], validThrough: '2026-01-01T00:00:00Z', hasPosting: true }, now, all))
      .toEqual({ signal: 'valid_through_past' });
    expect(closedFindingOf({ markers: ['generic.job_expired'], validThrough: null, hasPosting: true }, now, all))
      .toEqual({ signal: 'marker', marker: 'generic.job_expired' });
    // A platform marker a look on another platform was not given counts for nothing.
    expect(closedFindingOf({ markers: ['smartrecruiters.expired'], validThrough: null, hasPosting: false }, now,
      probeMarkersFor('lever'))).toBeNull();
    expect(closedFindingOf({ markers: [], validThrough: '2027-01-01', hasPosting: true }, now, all)).toBeNull();
  });

  it('reads a date alone as passed only once its day is over, a date-time at its instant, and nothing else as a date', () => {
    expect(validThroughPassed('2026-11-14', now)).toBe(false);
    expect(validThroughPassed('2026-11-13', now)).toBe(true);
    expect(validThroughPassed('2026-11-14T11:59:00Z', now)).toBe(true);
    expect(validThroughPassed('2026-11-14T12:01:00Z', now)).toBe(false);
    expect(validThroughPassed('soon', now)).toBe(false);
    expect(validThroughPassed(null, now)).toBe(false);
  });

  it('gives a look the title and posting markers of its platform and the generic ones, never an address marker', () => {
    expect(probeMarkersFor('smartrecruiters').map((marker) => marker.id)).toEqual(['smartrecruiters.expired',
      'generic.no_longer_accepting', 'generic.job_expired', 'generic.position_filled', 'generic.job_not_found']);
    expect(probeMarkersFor('lever').map((marker) => marker.id)).not.toContain('smartrecruiters.expired');
    expect(probeMarkersFor(null).every((marker) => marker.where === 'title' || marker.where === 'posting')).toBe(true);
    expect(LEVER_URL).toContain('/apply');
  });
});
