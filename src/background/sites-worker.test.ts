/*
 * The company career sites in the worker (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13): the sentinel's
 * registration as the person's choice and Chrome's permission stand; page/recognised checked again and answered with
 * one injection into that document; the router taking an injected frame's messages and nothing else new; LinkedIn
 * (deferred to v5) and the employee HR systems never reached. The Phase 8 review: everything injected stops with the
 * career sites (P1/B8), a tab keeps a few documents (B7), a company page's "open review" keeps its click after a
 * restart (B6), TailorIT hears a company page's origin and path alone and never as it loads (P3), a company page takes
 * its own host's sign-in alone (P6), and the side panel offers a reload on a company page (B10). v5 p1-rules (PLAN
 * decisions 9 and 10): on by default with every https and http page granted at install, turned off without giving the
 * permission back, and the CAPTCHA and anti-bot vendors' pages excluded and refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { SITES_MATCH } from '../shared/hosts';
import { INJECTED_PREFIX, SITES_KEY, TAB_DOCUMENTS } from './sites';
import {
  contentSender, pageSender, restartTestWorker, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const COMPANY = 'https://careers.northwind.example/jobs/42/apply';

/** The sentinel's (then the injected script's) top frame on a page off the ATS hosts. */
const offAts = (url: string, overrides: Record<string, unknown> = {}) => contentSender({ url, tab: { id: 7, url },
  documentId: 'doc-co', ...overrides });

const recognised = (url: string, reason = 'application-form', overrides: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'page/recognised', reason }, offAts(url, overrides)) as Promise<{ ok: boolean; error?: string;
    data?: { injected: boolean } }>;

let worker: TestWorker;

/** A worker with the company career sites turned on (or not) in storage, or (undefined) never chosen, and Chrome's
 *  permission granted (or not). */
async function withSites(on: boolean | undefined, granted: boolean) {
  worker = await startTestWorker({
    token: tokenRecord(),
    before: async (fakes) => {
      if (granted) fakes.granted.add(SITES_MATCH);
      if (on !== undefined) await fakeBrowser.storage.local.set({ [SITES_KEY]: { sites: on } });
    },
  });
  return worker;
}

/** Chrome's registrations, once the worker's reconcile (at start-up, after a permission change) has landed. */
const registered = async (ids: string[]) => vi.waitFor(() => expect([...worker.fakes.registrations.keys()].sort()).toEqual(ids));

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  fakeBrowser.reset();
});

describe("the sentinel's registration", () => {
  // v5 p1-rules (PLAN decision 10, like Jobright): every https and http page is granted at install, and the career
  // sites are on unless the person turned them off.
  it('is made at install with nothing chosen (on by default), while Chrome holds the permission', async () => {
    await withSites(undefined, true);
    await registered(['tailorit-sites']);
    expect(worker.fakes.registrations.get('tailorit-sites')).toMatchObject({ js: ['sentinel.js'], matches: [SITES_MATCH],
      allFrames: false, runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED' });
    expect(await worker.deliver({ v: 1, type: 'sites/get' }, pageSender('options.html')))
      .toEqual({ ok: true, data: { on: true, granted: true } });
  });

  it('stays off for a person who turned the career sites off, and waits for the permission withheld in Chrome', async () => {
    await withSites(false, true);
    await registered([]);
    fakeBrowser.reset();
    await withSites(undefined, false);
    await registered([]);
    // The person gives the extension its site access again in Chrome: onAdded reconciles.
    worker.fakes.grant([SITES_MATCH]);
    await registered(['tailorit-sites']);
  });

  it('is made only once the person turns the career sites on and Chrome holds the permission', async () => {
    await withSites(false, false);
    await registered([]);
    const page = pageSender('options.html');
    expect(await worker.deliver({ v: 1, type: 'sites/set', on: true }, page)).toEqual({ ok: true, data: { on: true, granted: false } });
    await registered([]);
    // Chrome grants it (the options page asked on the person's click): onAdded reconciles.
    worker.fakes.grant([SITES_MATCH]);
    await registered(['tailorit-sites']);
    expect(worker.fakes.registrations.get('tailorit-sites')).toMatchObject({ js: ['sentinel.js'], matches: [SITES_MATCH],
      allFrames: false, runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED' });
  });

  it('excludes the ATS hosts and every LinkedIn host, and goes with the permission', async () => {
    await withSites(true, true);
    await registered(['tailorit-sites']);
    const sites = worker.fakes.registrations.get('tailorit-sites') as { excludeMatches: string[] };
    expect(sites.excludeMatches).toEqual(expect.arrayContaining(['https://job-boards.greenhouse.io/*', 'https://*.icims.com/*',
      'https://*.linkedin.com/*', 'https://*.linkedin.cn/*', 'https://*.lnkd.in/*', 'https://*.licdn.com/*',
      // v5 p1-rules (PLAN decision 9): the CAPTCHA and anti-bot vendors' own pages.
      '*://*.google.com/recaptcha/*', '*://*.recaptcha.net/*', '*://*.hcaptcha.com/*', '*://challenges.cloudflare.com/*',
      '*://*.arkoselabs.com/*', '*://*.captcha-delivery.com/*', '*://*.protechts.net/*']));
    // The person takes it back in Chrome's own settings.
    worker.fakes.revoke([SITES_MATCH]);
    await registered([]);
  });

  it('unregisters when the person turns them off, keeping the install\'s permission (v5 p1-rules)', async () => {
    await withSites(undefined, true);
    await registered(['tailorit-sites']);
    const answer = await worker.deliver({ v: 1, type: 'sites/set', on: false }, pageSender('options.html'));
    expect(answer).toEqual({ ok: true, data: { on: false, granted: true } });
    expect(worker.fakes.granted.has(SITES_MATCH)).toBe(true);
    expect([...worker.fakes.registrations.keys()]).toEqual([]);
    expect(await fakeBrowser.storage.local.get(SITES_KEY)).toEqual({ [SITES_KEY]: { sites: false } });
  });

  it('is put back as it should be when Chrome holds a stale one', async () => {
    worker = await startTestWorker({ token: tokenRecord(), before: async (fakes) => {
      fakes.granted.add(SITES_MATCH);
      fakes.registrations.set('tailorit-sites', { id: 'tailorit-sites', js: ['sentinel.js'], matches: [SITES_MATCH], allFrames: true,
        runAt: 'document_idle', persistAcrossSessions: true, world: 'ISOLATED' });
      await fakeBrowser.storage.local.set({ [SITES_KEY]: { sites: true } });
    } });
    await vi.waitFor(() => expect(worker.fakes.registrations.get('tailorit-sites')).toMatchObject({ allFrames: false }));
  });
});

describe('page/recognised', () => {
  it("injects the content script into that one document of a company's page, once, which then speaks as the site", async () => {
    await withSites(true, true);
    expect(await recognised(COMPANY)).toEqual({ ok: true, data: { injected: true } });
    expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-co'] }, files: ['content-script.js'] }]);
    // The same document again: its sentinel is no sentinel there any more.
    expect(await recognised(COMPANY)).toMatchObject({ ok: false, error: 'bad_sender' });
    expect(worker.fakes.injections).toHaveLength(1);
    const hello = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, offAts(COMPANY)) as { ok: boolean };
    expect(hello.ok).toBe(true);
    const frame = (await fakeBrowser.storage.session.get('frames:7:0'))['frames:7:0'] as { applicationKey: string; platform: string };
    expect(frame).toMatchObject({ platform: 'site', applicationKey: expect.stringMatching(/^site:[0-9a-f]{16}$/) as unknown as string });
    // Never an ATS application's key; another document of the same frame was never recognised.
    expect(await worker.deliver({ v: 1, type: 'runstate/get', applicationKey: 'lever:0123456789abcdef' }, offAts(COMPANY)))
      .toMatchObject({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, offAts(COMPANY, { documentId: 'doc-2' })))
      .toMatchObject({ ok: false, error: 'bad_sender' });
  });

  it('checks the address itself: LinkedIn, an ATS domain, an http page, a subframe or a private tab get nothing', async () => {
    await withSites(true, true);
    for (const url of ['https://www.linkedin.com/jobs/view/4012345678/', 'https://uk.linkedin.com/jobs/view/1/',
      'https://lnkd.in/abc', 'https://login.icims.com/u/login', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/x',
      // v5 p1-rules (PLAN decision 9): a CAPTCHA or anti-bot vendor's own page, should one ever be a top frame.
      'https://www.google.com/recaptcha/api2/fallback?k=x', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x',
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html', 'https://geo.captcha-delivery.com/captcha/']) {
      expect(await recognised(url), url).toMatchObject({ ok: false });
    }
    expect(await recognised('http://careers.northwind.example/jobs/1')).toMatchObject({ ok: false, error: 'bad_sender' });
    expect(await recognised(COMPANY, 'application-form', { frameId: 3 })).toMatchObject({ ok: false, error: 'bad_sender' });
    expect(await recognised(COMPANY, 'application-form', { tab: { id: 7, url: COMPANY, incognito: true } }))
      .toMatchObject({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'page/recognised', reason: 'ats-frame' }, contentSender())).toMatchObject({ ok: false,
      error: 'bad_sender' });
    expect(worker.fakes.injections).toEqual([]);
  });

  it('injects nothing while the career sites are off, or Chrome does not hold the permission', async () => {
    await withSites(false, true);
    expect(await recognised(COMPANY)).toMatchObject({ ok: false, error: 'bad_message' });
    await withSites(true, false);
    expect(await recognised(COMPANY)).toMatchObject({ ok: false, error: 'bad_message' });
    expect(worker.fakes.injections).toEqual([]);
  });

  it('takes at most ten a minute from a tab', async () => {
    await withSites(false, true);
    for (let n = 0; n < 10; n += 1) await recognised(COMPANY);
    expect(await recognised(COMPANY)).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('forgets a frame whose injection Chrome refused', async () => {
    await withSites(true, true);
    worker.fakes.injectAnswer = () => {
      throw new Error('Cannot access contents of the page.');
    };
    expect(await recognised(COMPANY)).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, offAts(COMPANY))).toMatchObject({
      ok: false, error: 'bad_sender' });
  });

  it('keeps an injected frame known across a worker restart', async () => {
    await withSites(true, true);
    await recognised(COMPANY);
    worker = await restartTestWorker(worker, { before: (fakes) => void fakes.granted.add(SITES_MATCH) });
    const hello = await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, offAts(COMPANY)) as { ok: boolean };
    expect(hello.ok).toBe(true);
  });
});

/** The injected documents' records in storage.session. */
const injectedKeys = async () => Object.keys(await fakeBrowser.storage.session.get(null)).filter((key) => key.startsWith(INJECTED_PREFIX));
const hello = (overrides: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, offAts(COMPANY, overrides)) as Promise<{ ok: boolean;
    error?: string }>;

describe('the career sites stopping (the Phase 8 review, P1/B8)', () => {
  const stops: Array<[string, () => Promise<unknown>]> = [
    ['turned off', () => worker.deliver({ v: 1, type: 'sites/set', on: false }, pageSender('options.html'))],
    ["Chrome's permission taken back", async () => worker.fakes.revoke([SITES_MATCH])],
  ];
  for (const [name, stop] of stops) {
    it(`stops what was injected once ${name}: its records go, the router refuses it, every top frame is told`, async () => {
      await withSites(true, true);
      await registered(['tailorit-sites']);
      const tabs = await Promise.all([fakeBrowser.tabs.create({ url: COMPANY }), fakeBrowser.tabs.create({ url: 'https://news.example/' })]);
      expect(await recognised(COMPANY)).toMatchObject({ ok: true });
      expect((await hello()).ok).toBe(true);
      expect(await injectedKeys()).toEqual([`${INJECTED_PREFIX}7:doc-co`]);
      await stop();
      await registered([]);
      await vi.waitFor(async () => expect(await injectedKeys()).toEqual([]));
      // Every tab's top frame told site/stop: an injected page ends its run and its UI, a sentinel stops.
      await vi.waitFor(() => expect(worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'site/stop')
        .map((sent) => [sent.tabId, sent.options])).toEqual(expect.arrayContaining(tabs.map((tab) => [tab.id, { frameId: 0 }]))));
      expect(await hello()).toMatchObject({ ok: false, error: 'bad_sender' });
      // Nor after a restart.
      worker = await restartTestWorker(worker);
      expect(await hello()).toMatchObject({ ok: false, error: 'bad_sender' });
    });
  }

  it('stops them too when Chrome took the permission back while the worker was stopped', async () => {
    await withSites(true, true);
    await registered(['tailorit-sites']);
    await recognised(COMPANY);
    // The browser's tabs as the new worker finds them; Chrome holds the permission no more.
    let tabId: number | undefined;
    worker = await restartTestWorker(worker, { before: async () => {
      tabId = (await fakeBrowser.tabs.create({ url: COMPANY })).id;
    } });
    await vi.waitFor(async () => expect(await injectedKeys()).toEqual([]));
    await vi.waitFor(() => expect(worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'site/stop')
      .map((sent) => sent.tabId)).toContain(tabId));
    expect(await hello()).toMatchObject({ ok: false, error: 'bad_sender' });
  });

  it('leaves no injected page behind when they stop while a recognition is injecting (round 2, M2)', async () => {
    await withSites(true, true);
    await registered(['tailorit-sites']);
    const tab = await fakeBrowser.tabs.create({ url: COMPANY });
    let release: () => void = () => undefined;
    worker.fakes.injectAnswer = () => new Promise<void>((resolve) => {
      release = resolve;
    });
    const recognition = recognised(COMPANY, 'application-form', { tab: { id: tab.id, url: COMPANY } });
    await vi.waitFor(() => expect(worker.fakes.injections).toHaveLength(1));
    const off = worker.deliver({ v: 1, type: 'sites/set', on: false }, pageSender('options.html'));
    for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    // The script runs in the page only now: whatever stops them must reach it after this.
    const injectedAt = worker.fakes.tabMessages.length;
    release();
    await recognition;
    await off;
    await vi.waitFor(() => expect(worker.fakes.tabMessages.slice(injectedAt).filter((sent) => typeOfSent(sent) === 'site/stop')
      .map((sent) => sent.tabId)).toContain(tab.id));
    expect(await injectedKeys()).toEqual([]);
    expect(await hello({ tab: { id: tab.id, url: COMPANY } })).toMatchObject({ ok: false, error: 'bad_sender' });
  });

  it('tells no tab anything while the career sites never acted', async () => {
    await withSites(false, false);
    await fakeBrowser.tabs.create({ url: COMPANY });
    await registered([]);
    worker = await restartTestWorker(worker);
    await registered([]);
    expect(worker.fakes.tabMessages.filter((sent) => typeOfSent(sent) === 'site/stop')).toEqual([]);
  });
});

describe("a tab's injected documents (the Phase 8 review, B7)", () => {
  it(`keeps the last ${TAB_DOCUMENTS} of a tab, so a page the back/forward cache brings back is still known`, async () => {
    await withSites(true, true);
    const documents = Array.from({ length: TAB_DOCUMENTS + 1 }, (_, index) => `doc-${index}`);
    for (const documentId of documents) {
      worker.clock.now += 1000;
      expect(await recognised(COMPANY, 'application-form', { documentId }), documentId).toMatchObject({ ok: true });
    }
    // The second document, back from the cache: still the site's. The first, the oldest, is forgotten.
    expect((await hello({ documentId: 'doc-1' })).ok).toBe(true);
    expect(await hello({ documentId: 'doc-0' })).toMatchObject({ ok: false, error: 'bad_sender' });
    expect(await injectedKeys()).toHaveLength(TAB_DOCUMENTS);
  });
});

describe("a company page's open review after a restart (the Phase 8 review, B6)", () => {
  it('opens the side panel inside the click, before the worker reads storage', async () => {
    await withSites(true, true);
    await recognised(COMPANY);
    worker = await restartTestWorker(worker, { awaitStartUp: false, before: (fakes) => void fakes.granted.add(SITES_MATCH) });
    const answer = worker.deliver({ v: 1, type: 'panel/open' }, offAts(COMPANY));
    // Nothing awaited yet: the call is already made.
    expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([{ method: 'open', args: { tabId: 7 } }]);
    expect(await answer).toMatchObject({ ok: true });
  });
});

describe('what TailorIT hears of a company page (the Phase 8 review, P3)', () => {
  const ADDRESS = 'https://careers.northwind.example/jobs/42/apply?gh_jid=4012&session=s3cret&utm_source=mail#apply';
  const lookups = () => worker.tailorit.requests.filter((request) => request.path === '/api/autofill/lookup')
    .map((request) => (JSON.parse(request.body ?? '{}') as { url?: string }).url);

  it('looks nothing up as the page loads, and the side panel\'s lookup sends its origin, path and gh_jid alone', async () => {
    worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true, before: async (fakes) => {
      fakes.granted.add(SITES_MATCH);
      await fakeBrowser.storage.local.set({ [SITES_KEY]: { sites: true } });
    } });
    const sender = offAts(ADDRESS);
    expect(await worker.deliver({ v: 1, type: 'page/recognised', reason: 'application-form' }, sender)).toMatchObject({ ok: true });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, sender)).toMatchObject({ ok: true });
    for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(lookups()).toEqual([]);
    // The side panel opened: its job card asks through the frame, which relays job/lookup.
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return worker.deliver({ v: 1, type: 'job/lookup' }, sender);
    };
    await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender());
    expect(lookups()).toEqual(['https://careers.northwind.example/jobs/42/apply?gh_jid=4012']);
  });
});

describe("a company page's sign-in (the Phase 8 review, P6)", () => {
  // ── snapshot build 2026-11-06 (oracle-sf-sr): jobs.smartrecruiters.com is an ATS host now; its companies' careers host
  // is still a company page (no snapshot shows a posting there), one TailorIT's every-site sign-in covers ──
  const SMART = 'https://careers.smartrecruiters.com/Northwind/744000012345-engineer';
  it('takes a sign-in saved for its own host alone, never the one for every site', async () => {
    worker = await startTestWorker({ token: tokenRecord(), before: async (fakes) => {
      fakes.granted.add(SITES_MATCH);
      await fakeBrowser.storage.local.set({ [SITES_KEY]: { sites: true } });
    } });
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } } }, pageSender('options.html'));
    const sender = offAts(SMART, { documentId: 'doc-sr' });
    expect(await worker.deliver({ v: 1, type: 'page/recognised', reason: 'application-form' }, sender)).toMatchObject({ ok: true });
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: '*', email: 'alex.rivera@example.com', password: 'pw-1' } },
      { once: true });
    // The v4 review (M5): the every-site one is never this page's, so none for it is saved: not_found.
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'sign-in' }, sender)).toEqual({ ok: false, error: 'not_found' });
    worker.tailorit.reply('GET /api/autofill/credentials', { json: { host: 'careers.smartrecruiters.com', email: 'alex.rivera@example.com',
      password: 'pw-2' } }, { once: true });
    expect(await worker.deliver({ v: 1, type: 'signin/credential', wall: 'create-account' }, sender)).toMatchObject({ ok: true,
      data: { host: 'careers.smartrecruiters.com' } });
  });
});

describe('the side panel on a company page no frame of ours is on (the Phase 8 review, B10)', () => {
  it('offers a reload while the career sites act, and nothing more otherwise', async () => {
    await withSites(true, true);
    const tab = await fakeBrowser.tabs.create({ url: COMPANY });
    const page = async () => ((await worker.deliver({ v: 1, type: 'panel/reports', tabId: tab.id }, pageSender())) as {
      data?: { page?: unknown } }).data?.page;
    expect(await page()).toMatchObject({ support: 'none', reload: true, site: true });
    await worker.deliver({ v: 1, type: 'sites/set', on: false }, pageSender('options.html'));
    expect(await page()).not.toHaveProperty('reload');
  });
});
