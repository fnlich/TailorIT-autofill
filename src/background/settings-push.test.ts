/*
 * The audit of 2026-11-06 (m1, M4): settings/changed reaches each frame as its settings act for it, the auto-apply
 * agent's tab included (Submit stays on Manual in every document but the one the job's Submit was pressed in); and a
 * page's save applies only what that page changed, so a mode changed elsewhere meanwhile is kept.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import type { WorkerPlatform } from '../platform/types';
import { AGENT_RUN_KEY } from './agent';
import { mergeSettings } from './settings';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent } from './worker.testkit';

const OPTIONS = pageSender('options.html');
const PANEL = pageSender('sidepanel.html');
const GREENHOUSE = 'https://job-boards.greenhouse.io/northwind/jobs/5512345002';
const TASK = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a64', jobId: 1042, url: GREENHOUSE, company: 'Northwind',
  title: 'Senior Backend Engineer', resumeId: null };
const AGENT_TAB = 41;

/** Windows that open one tab each, as Chrome's do. */
function windows(): WorkerPlatform['windows'] & { opened: string[] } {
  const tabs = new Set<number>();
  const opened: string[] = [];
  return {
    opened,
    async open() {
      tabs.add(AGENT_TAB);
      return { windowId: 4, tabId: AGENT_TAB };
    },
    async navigate(tabId, url) {
      opened.push(url);
      return tabs.has(tabId);
    },
    async closeTab(tabId) {
      tabs.delete(tabId);
    },
    tabExists: async (tabId) => tabs.has(tabId),
    othersOpen: async () => true,
  };
}

describe('settings/changed in the auto-apply agent\'s tab (the audit, m1)', () => {
  it('keeps Submit on Manual in a document the job\'s Submit was not pressed in', async () => {
    const win = windows();
    const worker = await startTestWorker({ token: tokenRecord(), windows: win });
    worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: TASK } });
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS);
    worker.timers.advance(1);
    await vi.waitFor(() => expect(win.opened).toEqual([GREENHOUSE]));
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const agentFrame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, agentFrame);
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false },
      agentFrame) as { data: { runId: string } };
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'auto', runId: begun.data.runId },
      agentFrame);
    // The page loaded again before any sign: its hello says Submit on Manual there.
    const reloaded = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a2' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, reloaded))
      .toMatchObject({ ok: true, data: { settings: { modes: { submit: 'manual' } } } });
    // The person saves a setting: that document hears Submit on Manual still, never the agent's Auto.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, offerToSaveAnswers: false } },
      OPTIONS);
    const pushed = sentToFrames(worker).filter((sent) => sent.tabId === AGENT_TAB && typeOfSent(sent) === 'settings/changed');
    expect(pushed.at(-1)).toMatchObject({ options: { documentId: 'doc-a2' },
      message: { settings: { modes: { next: 'auto', submit: 'manual' } } } });
  });
});

describe('a page\'s save applies only its own change (the audit, M4)', () => {
  it('keeps a mode the side panel\'s gear changed while the options page stayed open', async () => {
    const worker = await startTestWorker();
    // Both pages read the defaults.
    const read = await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS) as { data: { settings: Settings } };
    const base = read.data.settings;
    // The gear turns Next page to Auto.
    const gear = { ...base, modes: { ...base.modes, next: 'auto' as const } };
    await worker.deliver({ v: 1, type: 'settings/save', settings: gear, base }, PANEL);
    // The options page, still showing what it read, turns on the anonymous counters.
    const options = { ...base, telemetry: { optIn: true } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: options, base }, OPTIONS)).toEqual({ ok: true,
      data: { settings: { ...base, modes: { ...base.modes, next: 'auto' }, telemetry: { optIn: true } } } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toMatchObject({ 'settings:v1': {
      modes: { next: 'auto' }, telemetry: { optIn: true } } });
  });

  it('merges leaf by leaf: what the page changed wins, everything else is what is stored now', () => {
    const base = DEFAULT_SETTINGS;
    const current: Settings = { ...base, modes: { ...base.modes, submit: 'auto' }, preapprovedConsent: ['privacy'] };
    const next: Settings = { ...base, panel: 'in-page', modes: { ...base.modes, consents: 'required' },
      preapprovedConsent: ['privacy', 'terms'] };
    expect(mergeSettings(current, base, next)).toEqual({ ...base, panel: 'in-page',
      modes: { ...base.modes, submit: 'auto', consents: 'required' }, preapprovedConsent: ['privacy', 'terms'] });
    // Nothing changed: the stored settings, whole.
    expect(mergeSettings(current, base, base)).toEqual(current);
  });
});
