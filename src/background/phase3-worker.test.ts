/*
 * The worker's side of v3 Phase 3a: the launcher's place and hiding per site (storage.local, a hash of the host only),
 * the side panel's watch telling the tab's top frame to hide its launcher, Skip sent to the one frame that writes the
 * field, the live report (stored and shown, never counted or cached), the frame's word that its form asks for a cover
 * letter, and the job card looked up as a form's page loads.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { JOB_RELAY_LIMIT, LOOKUP_ON_LOAD_LIMIT } from './job-cards';
import {
  createLauncherStore, LAUNCHER_KEY, LAUNCHER_LIMIT, MAX_LAUNCHER_SITES, registrableDomainOf, siteKeyOf,
} from './launcher';
import {
  beginRun, contentSender, frameReport, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const LEVER_FRAME = contentSender();
const EMBED = contentSender({ frameId: 3, documentId: 'doc-3', url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123' });
const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());

async function hello(worker: TestWorker, sender = LEVER_FRAME, extra: Record<string, unknown> = {}) {
  return worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true, ...extra }, sender);
}

describe('the launcher’s place and hiding (v3 Phase 3)', () => {
  it('keeps where the person dropped it and whether they hid it, per site: an ATS by its platform, and nothing else', async () => {
    const worker = await startTestWorker();
    expect(await hello(worker)).toMatchObject({ ok: true, data: { launcher: { top: null, hidden: false } } });
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.42 }, LEVER_FRAME)).toEqual({ ok: true, data: {} });
    expect(await hello(worker)).toMatchObject({ ok: true, data: { launcher: { top: 0.42, hidden: false } } });
    const stored = (await fakeBrowser.storage.local.get(LAUNCHER_KEY))[LAUNCHER_KEY] as Record<string, unknown>;
    // Every Lever board is one site, kept by its platform: the key names no company.
    expect(siteKeyOf('https://jobs.lever.co/acme/1/apply')).toBe('lever');
    expect(siteKeyOf('https://acme.wd5.myworkdayjobs.com/en-US/careers')).toBe('workday');
    expect(stored).toEqual({ everywhere: false, sites: { lever: { top: 0.42 } } });
    // Nothing of the address is kept: neither the host nor the path.
    expect(JSON.stringify(stored)).not.toMatch(/acme|apply|jobs\.lever/i);
    // A company's own careers page: a hash of its registrable domain (a guess at the domain could reverse it).
    expect(registrableDomainOf('careers.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomainOf('jobs.acme.com')).toBe('acme.com');
    expect(siteKeyOf('https://careers.acme.com/jobs')).toBe(siteKeyOf('https://www.acme.com/'));
    expect(siteKeyOf('https://careers.acme.com/jobs')).toMatch(/^[0-9a-f]{16}$/);
    // Another site keeps its own place.
    expect(await hello(worker, EMBED)).toMatchObject({ ok: true, data: { launcher: { top: null, hidden: false } } });
    // A place outside the window's height, or anything else, is refused by the schema.
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 1.5 }, LEVER_FRAME)).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.5, url: 'https://x' }, LEVER_FRAME))
      .toEqual({ ok: false, error: 'bad_message' });
    // Only a content script may place it.
    expect(await page(worker, { type: 'launcher/place', top: 0.1 })).toEqual({ ok: false, error: 'bad_sender' });
  });

  it('hides it on the site, or everywhere, and the side panel shows it again for the tab, telling its frames', async () => {
    const worker = await startTestWorker();
    await hello(worker);
    await hello(worker, EMBED);
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'none' } });
    await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'site' }, LEVER_FRAME);
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'site' } });
    expect(await hello(worker)).toMatchObject({ ok: true, data: { launcher: { hidden: true } } });
    expect(await hello(worker, EMBED)).toMatchObject({ ok: true, data: { launcher: { hidden: false } } });
    // Only the top frame draws the tab: an embedded frame's hide or place is refused.
    expect(await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'everywhere' }, EMBED)).toEqual({ ok: false,
      error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.3 }, EMBED)).toEqual({ ok: false, error: 'bad_sender' });
    await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'everywhere' }, LEVER_FRAME);
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'everywhere' } });
    expect(await page(worker, { type: 'panel/launcher', tabId: 99 })).toEqual({ ok: true, data: { hidden: 'everywhere' } });

    expect(await page(worker, { type: 'panel/showLauncher', tabId: 7 })).toEqual({ ok: true, data: {} });
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'none' } });
    const told = sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'launcher/prefs');
    expect(told.map((sent) => [sent.options?.frameId, sent.message])).toEqual(expect.arrayContaining([
      [0, { v: 1, type: 'launcher/prefs', launcher: { top: null, hidden: false }, shown: true }],
      [3, { v: 1, type: 'launcher/prefs', launcher: { top: null, hidden: false }, shown: true }],
    ]));
    // A content script cannot show it again: that is the person's, from the extension's own page.
    expect(await worker.deliver({ v: 1, type: 'panel/showLauncher', tabId: 7 }, LEVER_FRAME)).toEqual({ ok: false,
      error: 'bad_sender' });
  });

  it('keeps "Hide until next visit" for the tab’s page only, and the side panel offers it back', async () => {
    const worker = await startTestWorker();
    await hello(worker);
    expect(await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'next-visit' }, LEVER_FRAME)).toEqual({ ok: true,
      data: {} });
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'visit' } });
    // Nothing of it is stored for the site.
    expect(await hello(worker)).toMatchObject({ ok: true, data: { launcher: { hidden: false } } });
    // A later page of the tab (another document) is not hidden.
    const later = contentSender({ documentId: 'doc-later' });
    await hello(worker, later);
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'none' } });
    await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'next-visit' }, later);
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'visit' } });
    expect(await page(worker, { type: 'panel/showLauncher', tabId: 7 })).toEqual({ ok: true, data: {} });
    expect(await page(worker, { type: 'panel/launcher', tabId: 7 })).toEqual({ ok: true, data: { hidden: 'none' } });
  });

  it('takes a person’s drags and hides at a person’s pace (LAUNCHER_LIMIT per tab)', async () => {
    const worker = await startTestWorker();
    for (let at = 0; at < LAUNCHER_LIMIT.count; at += 1) {
      expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.5 }, LEVER_FRAME)).toEqual({ ok: true, data: {} });
    }
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.5 }, LEVER_FRAME)).toMatchObject({ ok: false,
      error: 'rate_limited' });
    expect(await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'site' }, LEVER_FRAME)).toMatchObject({ ok: false,
      error: 'rate_limited' });
    // Another tab has its own budget.
    expect(await worker.deliver({ v: 1, type: 'launcher/place', top: 0.5 }, contentSender({ tab: { id: 8 } })))
      .toEqual({ ok: true, data: {} });
  });

  it('keeps at most MAX_LAUNCHER_SITES sites, the oldest going first, one write at a time', async () => {
    const held = new Map<string, unknown>();
    const store = createLauncherStore({
      get: async (key) => structuredClone(held.get(key)),
      getMany: async () => ({}),
      set: async (entries) => {
        for (const [key, value] of Object.entries(entries)) held.set(key, structuredClone(value));
      },
      remove: async (keys) => {
        for (const key of keys) held.delete(key);
      },
      restrictToTrustedContexts: async () => undefined,
    });
    // All at once: the keyed queue keeps each read-modify-write whole, so none is lost.
    await Promise.all(Array.from({ length: MAX_LAUNCHER_SITES + 1 }, (_, at) =>
      store.place(`https://careers.company${at}.com/jobs/1`, 0.5)));
    const stored = held.get(LAUNCHER_KEY) as { sites: Record<string, unknown> };
    expect(Object.keys(stored.sites)).toHaveLength(MAX_LAUNCHER_SITES);
    expect(stored.sites).not.toHaveProperty(siteKeyOf('https://careers.company0.com')!);
    expect(stored.sites).toHaveProperty(siteKeyOf(`https://careers.company${MAX_LAUNCHER_SITES}.com`)!);
  });

  it('tells the tab’s top frame while the browser’s side panel shows the tab, and when it no longer does', async () => {
    const worker = await startTestWorker();
    await hello(worker);
    await hello(worker, EMBED);
    const side = worker.connect('panel', pageSender());
    side.post({ v: 1, type: 'panel/watch', tabId: 7, side: true });
    // The report page (no `side`) changes nothing.
    const reportPage = worker.connect('panel', pageSender());
    reportPage.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await Promise.resolve();
    const sideOf = () => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'panel/side')
      .map((sent) => [sent.tabId, sent.options?.frameId, (sent.message as { open: boolean }).open]);
    await expect.poll(sideOf).toEqual([[7, 0, true]]);
    side.post({ v: 1, type: 'panel/watch', tabId: 8, side: true });
    await expect.poll(sideOf).toEqual([[7, 0, true], [7, 0, false]]);
    side.post({ v: 1, type: 'panel/watch', tabId: 7, side: true });
    await expect.poll(sideOf).toEqual([[7, 0, true], [7, 0, false], [7, 0, true]]);
    // A page that loads in the tab while the side panel shows it hears so in its hello: its launcher stays hidden.
    expect(await hello(worker)).toMatchObject({ ok: true, data: { side: true } });
    expect(((await hello(worker, EMBED)) as { data: object }).data).not.toHaveProperty('side');
    side.disconnect();
    await expect.poll(sideOf).toEqual([[7, 0, true], [7, 0, false], [7, 0, true], [7, 0, false]]);
    expect(((await hello(worker)) as { data: object }).data).not.toHaveProperty('side');
  });
});

describe('Skip, the live report and the cover letter’s flag (v3 Phase 3)', () => {
  it('sends Skip to the one frame that holds the field, and says when it writes another', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker);
    await hello(worker, EMBED);
    worker.fakes.frameAnswers = ({ message, options }) => ((message as { type?: string }).type === 'run/skip'
      ? (options?.frameId === 3 ? { ok: true, data: {} } : { ok: false, error: 'expired' }) : { ok: true, data: {} });
    expect(await page(worker, { type: 'panel/skip', tabId: 7, frameId: 3, fieldKey: 'greenhouse|main|email|none|0' }))
      .toEqual({ ok: true, data: {} });
    expect(await page(worker, { type: 'panel/skip', tabId: 7, frameId: 0, fieldKey: 'lever|main|email|none|0' }))
      .toEqual({ ok: false, error: 'expired' });
    expect(await page(worker, { type: 'panel/skip', tabId: 7, frameId: 5, fieldKey: 'x' })).toEqual({ ok: false, error: 'expired' });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/skip')
      .map((sent) => [sent.options?.frameId, sent.message])).toEqual([
      [3, { v: 1, type: 'run/skip', fieldKey: 'greenhouse|main|email|none|0' }],
      [0, { v: 1, type: 'run/skip', fieldKey: 'lever|main|email|none|0' }],
    ]);
  });

  it('stores a live report and shows it, but never counts it: the next report is counted as if it had not been', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await page(worker, { type: 'settings/save', settings: { ...DEFAULT_SETTINGS, telemetry: { optIn: true } } });
    const runId = await beginRun(worker);
    // One field written and verified, as the run's own report has it; while it fills, the same row still waits.
    const done = frameReport(runId).fields.map((field) => ({ ...field, status: 'verified' as const, provenance: 'profile' as const,
      matcherStage: 'exact' as const, confidence: 1, reason: 'ok' as const, wrote: true, verification: 'verified' as const }));
    const final = { ...frameReport(runId), fields: done };
    const pending = { ...final, status: 'fill-step' as const,
      fields: done.map((field) => ({ ...field, wrote: false, verification: 'not-checked' as const })) };
    const keys = pending.fields.map((field) => field.key);
    expect(pending.fields.length).toBeGreaterThan(0);
    expect(await worker.deliver({ v: 1, type: 'report/live', runId, report: { ...pending,
      filling: { current: keys[0], pending: keys } } }, LEVER_FRAME)).toEqual({ ok: true, data: {} });
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true, data: { reports: [{
      status: 'fill-step', filling: { current: keys[0] } }] } });
    expect(await page(worker, { type: 'telemetry/get' })).toEqual({ ok: true, data: { counts: [] } });
    // The run's own report, after it: counted, every row once.
    await worker.deliver({ v: 1, type: 'report/put', runId, report: final }, LEVER_FRAME);
    const counted = (await page(worker, { type: 'telemetry/get' })) as { data: { counts: Array<{ count: number }> } };
    expect(counted.data.counts.reduce((sum, each) => sum + each.count, 0)).toBe(done.length);
    // A live report built before the stored one (on its way while the run's own report went) never replaces it.
    expect(await worker.deliver({ v: 1, type: 'report/live', runId, report: { ...pending, updatedAt: final.updatedAt - 1,
      filling: { current: keys[0], pending: keys } } }, LEVER_FRAME)).toEqual({ ok: true, data: {} });
    const after = (await page(worker, { type: 'panel/reports', tabId: 7 })) as { data: { reports: Array<Record<string, unknown>> } };
    expect(after.data.reports[0]).toMatchObject({ status: final.status });
    expect(after.data.reports[0]).not.toHaveProperty('filling');
    // A live report must say how far it is.
    expect(await worker.deliver({ v: 1, type: 'report/live', runId, report: frameReport(runId) }, LEVER_FRAME))
      .toEqual({ ok: false, error: 'bad_message' });
  });

  it('says a page on an applicant-tracking host no frame of ours said hello on waits for a reload', async () => {
    const worker = await startTestWorker();
    const atsTab = await fakeBrowser.tabs.create({ url: 'https://jobs.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00' });
    const otherTab = await fakeBrowser.tabs.create({ url: 'https://www.example.org/careers' });
    expect(await page(worker, { type: 'panel/reports', tabId: atsTab.id })).toMatchObject({ ok: true, data: { page: {
      support: 'none', reload: true } } });
    expect(((await page(worker, { type: 'panel/reports', tabId: otherTab.id })) as { data: { page: object } }).data.page)
      .not.toHaveProperty('reload');
  });

  it('says a page on an applicant-tracking host that shows no posting has no application form, never to reload (K1)', async () => {
    // Where the content script says no hello (the v3 Phase 6/7b review's S3): the old four platforms' boards, Workday's
    // sign-in that names no job, an employer's own pages on an ATS domain.
    const worker = await startTestWorker();
    for (const url of ['https://job-boards.greenhouse.io/acme', 'https://jobs.lever.co/acme', 'https://jobs.ashbyhq.com/acme',
      'https://apply.workable.com/acme/', 'https://acme.wd5.myworkdayjobs.com/en-US/External/login',
      'https://internal-acme.icims.com/jobs/1/engineer/job']) {
      const tab = await fakeBrowser.tabs.create({ url });
      const read = (await page(worker, { type: 'panel/reports', tabId: tab.id })) as { data: { page: Record<string, unknown> } };
      expect(read.data.page, url).toMatchObject({ support: url.includes('internal-acme') ? 'none' : 'no-form' });
      expect(read.data.page, url).not.toHaveProperty('reload');
    }
  });

  it('carries the frame’s word that its form asks for a cover letter into the tab’s page state', async () => {
    const worker = await startTestWorker();
    await hello(worker);
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true, data: { page: {
      support: 'form' } } });
    expect(((await page(worker, { type: 'panel/reports', tabId: 7 })) as { data: { page: object } }).data.page)
      .not.toHaveProperty('letter');
    await hello(worker, LEVER_FRAME, { letter: true });
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true, data: { page: {
      support: 'form', letter: true } } });
  });
});

describe('the job card, looked up as a form’s page loads (v3 Phase 3)', () => {
  /** The frame's relay, as job-relay.ts answers: job/lookup, then {}. */
  function relaying(worker: TestWorker): void {
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string; action?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return (await worker.deliver({ v: 1, type: 'job/lookup' }, LEVER_FRAME)) as { ok: boolean };
    };
  }

  it('asks TailorIT once as a connected form loads, so the side panel shows the card from memory', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    relaying(worker);
    await hello(worker);
    await expect.poll(() => worker.tailorit.count('POST /api/autofill/lookup')).toBe(1);
    expect(await page(worker, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true, data: { tabId: 7,
      card: { state: 'answered' } } });
    expect(worker.tailorit.count('POST /api/autofill/lookup')).toBe(1);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh')).toHaveLength(1);
  });

  /** A relay as the frame `sender` answers job/refresh: job/lookup from it, then {}. */
  function relayingAs(worker: TestWorker, sender: ReturnType<typeof contentSender>): void {
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return (await worker.deliver({ v: 1, type: 'job/lookup' }, sender)) as { ok: boolean };
    };
  }
  const LOOKUP = 'POST /api/autofill/lookup';
  const lookupBodies = (worker: TestWorker) => worker.tailorit.requests
    .filter((request) => `${request.method} ${request.path}` === LOOKUP)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);

  it('asks only for a posting a parser reads, never in a private tab, and sends its address without the query string', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    // An address no parser reads as a posting (Workday's own sign-in page, which names none), and a posting in a
    // private tab: nothing is asked.
    const workday = contentSender({ url: 'https://acme.wd5.myworkdayjobs.com/en-US/careers/login' });
    relayingAs(worker, workday);
    await hello(worker, workday);
    const hidden = contentSender({ tab: { id: 7, incognito: true } });
    relayingAs(worker, hidden);
    await hello(worker, hidden);
    await Promise.resolve();
    expect(worker.tailorit.count(LOOKUP)).toBe(0);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh')).toEqual([]);
    // A posting whose address carries the page's tracking: its canonical address goes, with no query string.
    const tracked = contentSender({ documentId: 'doc-tracked', url: `${LEVER_FRAME.url}?lever-source=LinkedIn&utm_campaign=x` });
    relayingAs(worker, tracked);
    await hello(worker, tracked);
    await expect.poll(() => worker.tailorit.count(LOOKUP)).toBe(1);
    expect(lookupBodies(worker)).toEqual([{ url: LEVER_FRAME.url!.replace(/\/apply$/, ''), includePostingText: false }]);
  });

  it('never spends the panel’s own budget, and asks a few at a time when a session restores many tabs', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    const tabs = Array.from({ length: LOOKUP_ON_LOAD_LIMIT.count + 2 }, (_, at) => contentSender({ tab: { id: 20 + at },
      documentId: `doc-${at}` }));
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return (await worker.deliver({ v: 1, type: 'job/lookup' }, tabs.find((tab) => tab.tab!.id === sent.tabId)!)) as
        { ok: boolean };
    };
    for (const tab of tabs) await hello(worker, tab);
    await expect.poll(() => worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count);
    await Promise.resolve();
    expect(worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count);
    // The panel's own reads of the first tab still have their whole budget (JOB_RELAY_LIMIT a minute per frame).
    for (let at = 0; at < JOB_RELAY_LIMIT.count; at += 1) {
      expect(await worker.deliver({ v: 1, type: 'job/lookup' }, tabs[0]!)).toEqual({ ok: false, error: 'expired' });
    }
    expect(await worker.deliver({ v: 1, type: 'job/lookup' }, tabs[0]!)).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('asks nothing for a page with no form, or while not connected', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    relaying(worker);
    await hello(worker, LEVER_FRAME, { hasForm: false });
    const offline = await startTestWorker({ lookupOnLoad: true });
    relaying(offline);
    await hello(offline);
    await Promise.resolve();
    expect([worker.tailorit.count('POST /api/autofill/lookup'), offline.tailorit.count('POST /api/autofill/lookup')])
      .toEqual([0, 0]);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'job/refresh')).toEqual([]);
  });

  it('asks for a recognised posting page with no form too (v3 Phase 3b), read from its address, not its word', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    // A posting's own page (Lever's overview, no /apply), top frame, no form: its card frame.
    const posting = contentSender({ url: LEVER_FRAME.url!.replace(/\/apply$/, '') });
    relayingAs(worker, posting);
    await hello(worker, posting, { hasForm: false });
    await expect.poll(() => worker.tailorit.count(LOOKUP)).toBe(1);
    expect(lookupBodies(worker)).toEqual([{ url: posting.url, includePostingText: false }]);
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true, data: { page: {
      support: 'no-form', posting: true } } });
    expect(await page(worker, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true, data: { tabId: 7,
      card: { state: 'answered' } } });
    expect(worker.tailorit.count(LOOKUP)).toBe(1);

    // Not a posting: a subframe on a posting address, a Workday posting, a page no parser reads, a company's site.
    const other = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    const senders = [
      contentSender({ tab: { id: 8 }, frameId: 2, documentId: 'doc-sub', url: posting.url }),
      contentSender({ tab: { id: 9 }, documentId: 'doc-wd', url: 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin/Engineer_R1' }),
      contentSender({ tab: { id: 10 }, documentId: 'doc-board', url: 'https://jobs.lever.co/tailorit-fixture' }),
      contentSender({ tab: { id: 11 }, documentId: 'doc-site', url: 'https://example.com/careers/engineer' }),
    ];
    other.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return (await other.deliver({ v: 1, type: 'job/lookup' }, senders.find((tab) => tab.tab!.id === sent.tabId)!)) as
        { ok: boolean };
    };
    for (const sender of senders) await hello(other, sender, { hasForm: false });
    await Promise.resolve();
    expect(other.tailorit.count(LOOKUP)).toBe(0);
    expect(sentToFrames(other).filter((sent) => typeOfSent(sent) === 'job/refresh')).toEqual([]);
    for (const tabId of [9, 10, 11]) {
      const state = await page(other, { type: 'panel/reports', tabId }) as { data: { page: object } };
      expect(state.data.page).not.toHaveProperty('posting');
    }
  });
});
