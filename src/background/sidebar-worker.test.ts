/*
 * v5 p1-shell (PLAN decisions 1, 2 and 8): the worker's side of the sidebar on the page. The sidebar's views ask what
 * the side panel asks, over the tab's top-frame content channel: the worker takes those page messages and ports from
 * frame 0 alone, for its own tab alone, and only while "Where the panel shows" is On the page; never the settings
 * page's own. sidebar/load runs the sidebar's bundle in that one document; the toolbar icon opens the sidebar on a page
 * of ours, or the side panel on any other; the header's Workday note is closed for good.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { SITES_MATCH } from '../shared/hosts';
import { SIDEBAR_APP_FILE } from '../shared/sidebar';
import { LOOKUP_ON_LOAD_LIMIT } from './job-cards';
import { NOTES_KEY, SIDEBAR_LOAD_LIMIT } from './sidebar';
import { contentSender, EXTENSION_ID, frameReport, goldens, LEVER_URL, NO_RECEIVER, pageSender, sentToFrames,
  startTestWorker, tokenRecord, typeOfSent, type TestWorker } from './worker.testkit';

const TOP = contentSender();
const SUBFRAME = contentSender({ frameId: 2, documentId: 'doc-2' });
const OPTIONS = pageSender('options.html');
const COMPANY = 'https://careers.northwind.example/jobs/42/apply';

const hello = (worker: TestWorker, sender = TOP) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: sender.frameId === 0, hasForm: true }, sender);
const toSide = (worker: TestWorker) =>
  worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'side' } }, OPTIONS);

describe('the sidebar on the page (v5 p1-shell)', () => {
  describe('its page messages', () => {
    it('are taken from the tab\'s top frame, naming its own tab, while the panel shows on the page', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, TOP)).toEqual({ ok: true,
        data: { settings: DEFAULT_SETTINGS } });
      expect(await worker.deliver({ v: 1, type: 'auth/status' }, TOP)).toMatchObject({ ok: true,
        data: { connection: 'connected' } });
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, TOP)).toMatchObject({ ok: true,
        data: { tabId: 7 } });
      expect(await worker.deliver({ v: 1, type: 'panel/launcher', tabId: 7 }, TOP)).toEqual({ ok: true,
        data: { hidden: 'none' } });
    });

    it('are refused naming another tab, from a subframe, or once the panel is Chrome\'s side panel', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      for (const message of [{ v: 1, type: 'panel/reports', tabId: 8 }, { v: 1, type: 'panel/fill', tabId: 8, dryRun: false },
        { v: 1, type: 'panel/cancel', tabId: 99 }, { v: 1, type: 'panel/focus', tabId: 8, frameId: 0, fieldKey: 'k' }]) {
        expect(await worker.deliver(message, TOP), message.type).toEqual({ ok: false, error: 'bad_sender' });
      }
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, SUBFRAME)).toEqual({ ok: false,
        error: 'bad_sender' });
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, SUBFRAME)).toEqual({ ok: false, error: 'bad_sender' });
      await toSide(worker);
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, TOP)).toEqual({ ok: false,
        error: 'bad_sender' });
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, TOP)).toEqual({ ok: false, error: 'bad_sender' });
      // The extension's own pages are taken as ever.
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())).toMatchObject({ ok: true });
    });

    it('never include the settings page\'s own or the in-page card\'s, even from the top frame', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      for (const message of [{ v: 1, type: 'auth/disconnect' }, { v: 1, type: 'auth/redeemCode', code: 'ABCD-EFGH-JKLM-NPQR' },
        { v: 1, type: 'runs/clear' }, { v: 1, type: 'telemetry/get' }, { v: 1, type: 'telemetry/clear' },
        { v: 1, type: 'sites/get' }, { v: 1, type: 'sites/set', on: true }, { v: 1, type: 'agent/set', on: true, confirmed: true },
        { v: 1, type: 'panel/policyDecision', tabId: 7, frameId: 0, decision: 'fill' },
        { v: 1, type: 'panel/confirmDraft', tabId: 7, frameId: 0, fieldKey: 'k' },
        { v: 1, type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: 'k' },
        { v: 1, type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: 'k' }]) {
        expect(await worker.deliver(message, TOP), message.type).toEqual({ ok: false, error: 'bad_sender' });
      }
      // Still connected: Disconnect never went through.
      expect(await worker.deliver({ v: 1, type: 'auth/status' }, OPTIONS)).toMatchObject({ ok: true,
        data: { connection: 'connected' } });
    });

    it('keep the profile\'s sensitive part, I understand and a save that lets it act more on its own on the extension\'s pages (the review, S7)', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      const profile = goldens.profile.profile;
      for (const message of [{ v: 1, type: 'auth/acknowledgeDisclosure' }, { v: 1, type: 'panel/profile' },
        { v: 1, type: 'panel/saveProfile', revision: 3, profile, sensitive: goldens.sensitive.sensitive },
        { v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' } } },
        { v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } },
          base: DEFAULT_SETTINGS },
        { v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes,
          agentSkip: { ...DEFAULT_SETTINGS.modes.agentSkip, requiredEmpty: false } } } }]) {
        expect(await worker.deliver(message, TOP), message.type).toEqual({ ok: false, error: 'bad_sender' });
      }
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
        data: { settings: DEFAULT_SETTINGS } });
      // The rest stays the sidebar's: the profile without its sensitive part, a save that changes nothing of that kind
      // (or lets it act less on its own), and Chrome's side panel chosen.
      expect(await worker.deliver({ v: 1, type: 'panel/profile', sensitive: false }, TOP)).not.toEqual({ ok: false,
        error: 'bad_sender' });
      const calmer = { ...DEFAULT_SETTINGS, view: 'minimized' as const, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' as const } };
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: calmer, base: DEFAULT_SETTINGS }, TOP))
        .toEqual({ ok: true, data: { settings: calmer } });
      // A base that held Auto while the stored settings hold Manual: only the page's own change applies, which raises
      // nothing.
      const autoBase = { ...calmer, modes: { ...calmer.modes, submit: 'auto' as const } };
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...autoBase, offerToSaveAnswers: false },
        base: autoBase }, TOP)).toMatchObject({ ok: true, data: { settings: { modes: { submit: 'manual' },
        offerToSaveAnswers: false } } });
      // The extension's own pages may.
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...calmer, modes: { ...calmer.modes,
        submit: 'auto' } } }, OPTIONS)).toMatchObject({ ok: true });
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, TOP)).toMatchObject({ ok: true,
        data: { settings: { modes: { submit: 'auto' } } } });
    });

    it('look a job up for a sidebar that opened by itself only as a page that loads is (the review, S1)', async () => {
      const LOOKUP = 'POST /api/autofill/lookup';
      const relay = (worker: TestWorker, senders: ReturnType<typeof contentSender>[]) => {
        worker.fakes.frameAnswers = async (sent) => {
          const message = sent.message as { type?: string };
          if (message.type !== 'job/refresh') return { ok: true, data: {} };
          return (await worker.deliver({ v: 1, type: 'job/lookup' }, senders.find((each) => each.tab!.id === sent.tabId)!)) as
            { ok: boolean };
        };
      };
      // LOOKUP_ON_LOAD_LIMIT's budget, spent by pages that loaded: the last tab's page was not looked up.
      const worker = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
      const tabs = Array.from({ length: LOOKUP_ON_LOAD_LIMIT.count + 1 }, (_, at) => contentSender({ tab: { id: 20 + at },
        documentId: `doc-${at}` }));
      relay(worker, tabs);
      for (const tab of tabs) await hello(worker, tab);
      await expect.poll(() => worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count);
      const last = tabs.at(-1)!;
      const lastTab = last.tab!.id;
      expect(await worker.deliver({ v: 1, type: 'panel/job', tabId: lastTab, onLoad: true }, last)).toEqual({ ok: true,
        data: { tabId: lastTab, card: null } });
      expect(worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count);
      // The person opened it: looked up as the side panel's card is.
      expect(await worker.deliver({ v: 1, type: 'panel/job', tabId: lastTab }, last)).toMatchObject({ ok: true,
        data: { tabId: lastTab } });
      expect(worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count + 1);
      // A card held already is shown without a lookup.
      expect(await worker.deliver({ v: 1, type: 'panel/job', tabId: lastTab, onLoad: true }, last)).toMatchObject({
        ok: true, data: { tabId: lastTab, card: { state: expect.any(String) } } });
      expect(worker.tailorit.count(LOOKUP)).toBe(LOOKUP_ON_LOAD_LIMIT.count + 1);

      // A private tab, or the disclosure not acknowledged as it reads now: no card, nothing asked.
      const quiet = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true, disclosure: 1 });
      const privateTop = contentSender({ tab: { id: 30, incognito: true }, documentId: 'doc-p' });
      relay(quiet, [TOP, privateTop]);
      await hello(quiet);
      await hello(quiet, privateTop);
      for (const [sender, tabId] of [[TOP, 7], [privateTop, 30]] as const) {
        expect(await quiet.deliver({ v: 1, type: 'panel/job', tabId, onLoad: true }, sender)).toEqual({ ok: true,
          data: { tabId, card: null } });
      }
      expect(quiet.tailorit.count(LOOKUP)).toBe(0);
      expect(sentToFrames(quiet).filter((sent) => typeOfSent(sent) === 'job/refresh')).toEqual([]);
    });

    it('are parsed as the pages\' own, strictly', async () => {
      const worker = await startTestWorker();
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7, extra: true }, TOP)).toEqual({ ok: false,
        error: 'bad_message' });
      expect(await worker.deliver({ v: 1, type: 'panel/reports', tabId: 'seven' }, TOP)).toEqual({ ok: false,
        error: 'bad_message' });
    });
  });

  describe('its ports', () => {
    it('follow the sender\'s own tab, never as the browser\'s side panel, and close on another tab', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      const port = worker.connect('panel', TOP);
      port.post({ v: 1, type: 'panel/watch', tabId: 7, side: true });
      await vi.waitFor(() => expect(port.received).toContainEqual(expect.objectContaining({ type: 'panel/update',
        tabId: 7 })));
      // Not the browser's side panel: the tab's launcher is never told to hide for it.
      expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'panel/side')).toEqual([]);
      const other = worker.connect('panel', TOP);
      other.post({ v: 1, type: 'panel/watch', tabId: 8 });
      await vi.waitFor(() => expect(other.disconnectedByWorker).toBe(true));
      expect(other.received).toEqual([]);
    });

    it('are refused from a subframe and while the panel is Chrome\'s side panel', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      const sub = worker.connect('panel', SUBFRAME);
      await vi.waitFor(() => expect(sub.disconnectedByWorker).toBe(true));
      await toSide(worker);
      for (const name of ['panel', 'preview']) {
        const port = worker.connect(name, TOP);
        await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
      }
    });

    it('never carry a preview, even of the sender\'s own tab (the review, S6 and F10: no résumé bytes in the page)', async () => {
      const worker = await startTestWorker({ token: tokenRecord() });
      await hello(worker);
      const port = worker.connect('preview', TOP);
      await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
      expect(port.received).toEqual([]);
    });
  });

  describe('sidebar/load', () => {
    it('runs the sidebar\'s bundle in the top frame\'s own document and answers its tab', async () => {
      const worker = await startTestWorker();
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, TOP)).toEqual({ ok: true, data: { tabId: 7 } });
      expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-1'] }, files: [SIDEBAR_APP_FILE] }]);
    });

    it('runs it in a subframe\'s own document for its in-page card, and nowhere while the panel is Chrome\'s side panel', async () => {
      const worker = await startTestWorker();
      // A frame inside another page: the in-page card's views come with the same bundle, in that document alone; the
      // sidebar's page messages stay the top frame's (above).
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, SUBFRAME)).toEqual({ ok: true, data: { tabId: 7 } });
      expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-2'] }, files: [SIDEBAR_APP_FILE] }]);
      worker.fakes.injections.length = 0;
      await toSide(worker);
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, TOP)).toEqual({ ok: false, error: 'expired' });
      expect(worker.fakes.injections).toEqual([]);
      // An extension page has no such message.
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, pageSender())).toEqual({ ok: false, error: 'bad_sender' });
    });

    it('answers unavailable where Chrome would not run it, and holds a stream of asks', async () => {
      const worker = await startTestWorker();
      worker.fakes.injectAnswer = () => {
        throw new Error('Cannot access contents of the page.');
      };
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, TOP)).toEqual({ ok: false, error: 'unavailable' });
      worker.fakes.injectAnswer = () => undefined;
      for (let index = 1; index < SIDEBAR_LOAD_LIMIT.count; index += 1) {
        expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, TOP)).toMatchObject({ ok: true });
      }
      expect(await worker.deliver({ v: 1, type: 'sidebar/load' }, TOP)).toMatchObject({ ok: false, error: 'rate_limited' });
    });
  });

  it('opens the settings page at the section a sidebar\'s link names, for the top frame alone', async () => {
    const worker = await startTestWorker();
    const before = (await fakeBrowser.tabs.query({})).length;
    expect(await worker.deliver({ v: 1, type: 'sidebar/options', section: 'settings-modes' }, TOP)).toEqual({ ok: true,
      data: {} });
    const tabs = await fakeBrowser.tabs.query({});
    expect(tabs).toHaveLength(before + 1);
    expect(tabs.at(-1)?.url).toBe(`chrome-extension://${EXTENSION_ID}/options.html#settings-modes`);
    expect(await worker.deliver({ v: 1, type: 'sidebar/options' }, SUBFRAME)).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'sidebar/options', section: 'https://example.org' }, TOP))
      .toEqual({ ok: false, error: 'bad_message' });
  });

  describe('the toolbar icon', () => {
    it('is Chrome\'s side panel\'s while the panel shows there, and its own click on the page', async () => {
      const worker = await startTestWorker();
      const behaviour = () => worker.fakes.sidePanelCalls.filter((call) => call.method === 'setPanelBehavior').at(-1);
      await vi.waitFor(() => expect(behaviour()?.args).toEqual({ openPanelOnActionClick: false }));
      await toSide(worker);
      expect(behaviour()?.args).toEqual({ openPanelOnActionClick: true });
      await worker.deliver({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS }, OPTIONS);
      expect(behaviour()?.args).toEqual({ openPanelOnActionClick: false });
    });

    it('opens the sidebar on a page of ours, the launcher shown again where the person hid it', async () => {
      const worker = await startTestWorker();
      await hello(worker);
      await worker.deliver({ v: 1, type: 'launcher/hide', scope: 'site' }, TOP);
      worker.fakes.frameAnswers = (sent) => (typeOfSent(sent) === 'sidebar/open' ? { ok: true, data: { opening: true } }
        : { ok: true, data: {} });
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: LEVER_URL } as never);
      await vi.waitFor(() => expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'sidebar/open'))
        .toEqual([{ tabId: 7, message: { v: 1, type: 'sidebar/open', reveal: true }, options: { frameId: 0 } }]));
      expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'launcher/prefs').map((sent) => sent.message))
        .toContainEqual({ v: 1, type: 'launcher/prefs', launcher: { top: null, hidden: false }, shown: true });
      expect(await worker.deliver({ v: 1, type: 'panel/launcher', tabId: 7 }, pageSender())).toEqual({ ok: true,
        data: { hidden: 'none' } });
      expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([]);
    });

    it('opens the side panel on a page no frame of ours may draw, inside the click', async () => {
      const worker = await startTestWorker();
      await fakeBrowser.action.onClicked.trigger({ id: 9, url: 'chrome://extensions/' } as never);
      expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([{ method: 'open',
        args: { tabId: 9 } }]);
      // The Chrome Web Store, which Chrome lets no extension script: inside the click too.
      await fakeBrowser.action.onClicked.trigger({ id: 9, url: 'https://chromewebstore.google.com/detail/x/abc' } as never);
      expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toHaveLength(2);
      expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'sidebar/open')).toEqual([]);
      // A page of ours whose frame does not answer (it loaded before the extension): the side panel, as Chrome allows.
      worker.fakes.frameAnswers = () => {
        throw new Error(NO_RECEIVER);
      };
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: LEVER_URL } as never);
      await vi.waitFor(() => expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open'))
        .toHaveLength(3));
      expect(worker.fakes.injections).toEqual([]);
    });

    it("injects the content script into a company's own https page that runs none, then opens the sidebar there", async () => {
      const worker = await startTestWorker({ before: (fakes) => {
        fakes.granted.add(SITES_MATCH);
      } });
      let listening = false;
      worker.fakes.frameAnswers = (sent) => {
        if (typeOfSent(sent) !== 'sidebar/open') return { ok: true, data: {} };
        if (!listening) throw new Error(NO_RECEIVER);
        return { ok: true, data: { opening: true } };
      };
      worker.fakes.topDocument = () => ({ documentId: 'doc-co', url: COMPANY });
      const asked = () => sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'sidebar/open').length;
      const waiting = worker.timers.pending;
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: COMPANY } as never);
      // Asked before, and once the script ran; then again after a pause, once it listens.
      await vi.waitFor(() => expect(worker.timers.pending).toBe(waiting + 1));
      expect(asked()).toBe(2);
      expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-co'] },
        files: ['content-script.js'] }]);
      listening = true;
      worker.timers.advance(150);
      await vi.waitFor(() => expect(asked()).toBe(3));
      expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([]);
      // Its frame is the worker's now: the sidebar's messages are taken from it.
      const injected = contentSender({ url: COMPANY, tab: { id: 7, url: COMPANY }, documentId: 'doc-co' });
      expect(await worker.deliver({ v: 1, type: 'panel/launcher', tabId: 7 }, injected)).toMatchObject({ ok: true });
      // Clicked again, the script answers at once: nothing injected twice.
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: COMPANY } as never);
      await vi.waitFor(() => expect(asked()).toBe(4));
      expect(worker.fakes.injections).toHaveLength(1);
    });

    it('injects the content script into an applicant-tracking tab that loaded before the extension (the review, F7)', async () => {
      const worker = await startTestWorker();
      let listening = false;
      worker.fakes.frameAnswers = (sent) => {
        if (typeOfSent(sent) !== 'sidebar/open') return { ok: true, data: {} };
        if (!listening) throw new Error(NO_RECEIVER);
        return { ok: true, data: { opening: true } };
      };
      worker.fakes.injectAnswer = async () => {
        listening = true;
      };
      worker.fakes.topDocument = () => ({ documentId: 'doc-ats', url: LEVER_URL });
      // With the career sites off: the applicant-tracking hosts are not theirs.
      await worker.deliver({ v: 1, type: 'sites/set', on: false }, OPTIONS);
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: LEVER_URL } as never);
      await vi.waitFor(() => expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'sidebar/open'))
        .toHaveLength(2));
      expect(worker.fakes.injections).toEqual([{ target: { tabId: 7, documentIds: ['doc-ats'] },
        files: ['content-script.js'] }]);
      expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toEqual([]);
      // Never in a private tab, nor once the frame shows another page.
      listening = false;
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: LEVER_URL, incognito: true } as never);
      await vi.waitFor(() => expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toHaveLength(1));
      worker.fakes.topDocument = () => ({ documentId: 'doc-co', url: COMPANY });
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: LEVER_URL } as never);
      await vi.waitFor(() => expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toHaveLength(2));
      expect(worker.fakes.injections).toHaveLength(1);
    });

    it('never injects into TailorIT\'s own https pages (the review, S11)', async () => {
      const own = 'https://app.tailorit.example';
      const worker = await startTestWorker({ origin: own, before: (fakes) => {
        fakes.granted.add(SITES_MATCH);
      } });
      worker.fakes.frameAnswers = () => {
        throw new Error(NO_RECEIVER);
      };
      worker.fakes.topDocument = () => ({ documentId: 'doc-own', url: `${own}/tracker` });
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: `${own}/tracker` } as never);
      await vi.waitFor(() => expect(worker.fakes.sidePanelCalls.filter((call) => call.method === 'open')).toHaveLength(1));
      expect(worker.fakes.injections).toEqual([]);
      // Nor does the sentinel's registration reach them, nor its page/recognised.
      await vi.waitFor(() => expect([...worker.fakes.registrations.values()][0]?.excludeMatches)
        .toContain('https://app.tailorit.example/*'));
      expect(await worker.deliver({ v: 1, type: 'page/recognised', reason: 'application-form' },
        contentSender({ url: `${own}/apply`, tab: { id: 7, url: `${own}/apply` }, documentId: 'doc-own' })))
        .toEqual({ ok: false, error: 'bad_message' });
    });

    it('injects nothing in a private tab, on an http page, where the frame moved on, or with the career sites off', async () => {
      const worker = await startTestWorker({ before: (fakes) => {
        fakes.granted.add(SITES_MATCH);
      } });
      worker.fakes.frameAnswers = () => {
        throw new Error(NO_RECEIVER);
      };
      const opened = () => worker.fakes.sidePanelCalls.filter((call) => call.method === 'open').length;
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: COMPANY, incognito: true } as never);
      await vi.waitFor(() => expect(opened()).toBe(1));
      // An http page off the ATS hosts is not one the icon reaches: the side panel inside the click.
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: 'http://careers.northwind.example/jobs/42' } as never);
      expect(opened()).toBe(2);
      worker.fakes.topDocument = () => ({ documentId: 'doc-li', url: 'https://www.linkedin.com/jobs/view/1' });
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: COMPANY } as never);
      await vi.waitFor(() => expect(opened()).toBe(3));
      worker.fakes.topDocument = () => ({ documentId: 'doc-co', url: COMPANY });
      await worker.deliver({ v: 1, type: 'sites/set', on: false }, OPTIONS);
      await fakeBrowser.action.onClicked.trigger({ id: 7, url: COMPANY } as never);
      await vi.waitFor(() => expect(opened()).toBe(4));
      expect(worker.fakes.injections).toEqual([]);
    });
  });

  describe('the header\'s notes', () => {
    it('keeps the Workday note closed once closed, for the side panel and the sidebar alike', async () => {
      const worker = await startTestWorker();
      expect(await worker.deliver({ v: 1, type: 'panel/notes' }, pageSender())).toEqual({ ok: true, data: { closed: [] } });
      expect(await worker.deliver({ v: 1, type: 'panel/closeNote', note: 'workday' }, TOP)).toEqual({ ok: true, data: {} });
      expect(await worker.deliver({ v: 1, type: 'panel/notes' }, pageSender())).toEqual({ ok: true,
        data: { closed: ['workday'] } });
      expect(await fakeBrowser.storage.local.get(NOTES_KEY)).toEqual({ [NOTES_KEY]: { closed: ['workday'] } });
      // Closing it again changes nothing; a note it does not know is refused.
      expect(await worker.deliver({ v: 1, type: 'panel/closeNote', note: 'workday' }, pageSender())).toMatchObject({ ok: true });
      expect(await worker.deliver({ v: 1, type: 'panel/closeNote', note: 'other' }, pageSender())).toEqual({ ok: false,
        error: 'bad_message' });
      expect(await worker.deliver({ v: 1, type: 'panel/notes' }, SUBFRAME)).toEqual({ ok: false, error: 'bad_sender' });
    });
  });

  it('keeps a sidebar\'s reports to its tab as the side panel\'s are', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await hello(worker);
    const run = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: 'lever:0123456789abcdef',
      trigger: 'launcher', dryRun: false }, TOP) as { ok: boolean; data?: { runId: string } };
    if (run.ok && run.data !== undefined) {
      await worker.deliver({ v: 1, type: 'report/put', runId: run.data.runId, report: frameReport(run.data.runId) }, TOP);
    }
    const read = await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, TOP) as { ok: boolean; data: { tabId: number } };
    expect(read).toMatchObject({ ok: true, data: { tabId: 7 } });
  });
});
