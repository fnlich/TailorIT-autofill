import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { contentSettingsOf } from './settings';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent } from './worker.testkit';

const OPTIONS = pageSender('options.html');
const CHOSEN = { ...DEFAULT_SETTINGS, panel: 'side' as const, view: 'minimized' as const,
  modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' as const, consents: 'required' as const },
  preapprovedConsent: ['privacy' as const], llm: { ...DEFAULT_SETTINGS.llm, tiebreak: false, classify: true, drafts: true },
  offerToSaveAnswers: false };
/** CHOSEN as a frame receives it: its content settings. */
const CHOSEN_CONTENT = { panel: 'side', view: 'minimized', modes: { next: CHOSEN.modes.next, afterPageTurn: CHOSEN.modes.afterPageTurn,
  submit: CHOSEN.modes.submit, agentSkip: CHOSEN.modes.agentSkip, signIn: CHOSEN.modes.signIn,
  noMatch: CHOSEN.modes.noMatch, notifications: CHOSEN.modes.notifications }, llm: CHOSEN.llm,
  offerToSaveAnswers: false };
/** v5 p1-shell: CHOSEN as versions 1 to 7 stored it, Chrome's side panel; and where every version 8 migration puts
 *  the panel, the page (the owner, 2026-11-08: the Jobright-like sidebar for everyone). */
const OLD_PANEL = { panel: 'side' as const };
/** v5: every earlier install's panel on the page, and (the review's F9) its Default view Expanded. */
const ON_PAGE = { panel: 'page' as const, view: 'expanded' as const };
/** CHOSEN's modes as version 6 stored them, before "When a list has no match" and the notifications' time. */
const { noMatch: _noMatch, notifications: _notifications, ...CHOSEN_MODES_V6 } = CHOSEN.modes;

/** Version 1's settings as an install stored them before the owner's amendments, on its defaults. */
const V1_DEFAULTS = { version: 1, panel: 'side', autoAdvance: false, preapprovedConsent: [],
  llm: { tiebreak: true, classify: true, drafts: false }, telemetry: { optIn: false }, offerToSaveAnswers: true,
  interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false } };

describe('settings', () => {
  it('answers the defaults until something is saved', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS } });
  });

  it('saves to storage.local and answers what it stored', async () => {
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS)).toEqual({ ok: true, data: { settings: CHOSEN } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': CHOSEN });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: CHOSEN } });
  });

  it('reads a version 4 value stored before "Record applications I submit myself" as on, keeping every choice (the v3 Phase 4 review)', async () => {
    const { recordOwn: _added, ...before } = CHOSEN.modes;
    const worker = await startTestWorker({ before: async () => {
      await fakeBrowser.storage.local.set({ 'settings:v1': { ...CHOSEN, modes: before } });
    } });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
      data: { settings: { ...CHOSEN, modes: { ...CHOSEN.modes, recordOwn: 'on' } } } });
    const off = { ...CHOSEN, modes: { ...CHOSEN.modes, recordOwn: 'off' as const } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: off }, OPTIONS)).toEqual({ ok: true,
      data: { settings: off } });
  });

  it('keeps Sign-in Auto as chosen (v3 Phase 5), and a frame gets it only while the connection may read sign-ins', async () => {
    const chosen = { ...CHOSEN, modes: { ...CHOSEN.modes, signIn: 'auto' as const, submit: 'auto' as const } };
    const allowed = await startTestWorker({ token: tokenRecord() });
    expect(await allowed.deliver({ v: 1, type: 'settings/save', settings: chosen }, OPTIONS)).toEqual({ ok: true,
      data: { settings: chosen } });
    expect(await allowed.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'auto', submit: 'auto' } } } });
    // A connection without credentials:read (the sign-in box unticked when connecting): Manual, as it acts.
    const scopes = tokenRecord().scopes.filter((scope) => scope !== 'credentials:read');
    const unticked = await startTestWorker({ token: tokenRecord({ scopes }),
      before: async () => fakeBrowser.storage.local.set({ 'settings:v1': chosen }) });
    expect(await unticked.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: chosen } });
    expect(await unticked.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'manual', submit: 'auto' } } } });
    // The disclosure not acknowledged as it reads now: Sign-in and Submit both Manual, as they act.
    const older = await startTestWorker({ token: tokenRecord(), disclosure: 2,
      before: async () => fakeBrowser.storage.local.set({ 'settings:v1': chosen }) });
    expect(await older.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender()))
      .toMatchObject({ ok: true, data: { settings: { modes: { signIn: 'manual', submit: 'manual' } } } });
  });

  it('gives the agent’s tab Next and Submit on Auto, the person’s posting rule kept (v3 Phase 5 review; v4: no card)', () => {
    const ask = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, whenForbidden: 'use-ai' as const } };
    expect(contentSettingsOf(ask, { agent: true })).toMatchObject({ modes: { next: 'auto', afterPageTurn: 'auto',
      submit: 'auto' }, llm: { whenForbidden: 'use-ai' } });
    expect(contentSettingsOf(ask).llm.whenForbidden).toBe('use-ai');
    expect(contentSettingsOf(ask, { agent: false, holdSubmit: true }).modes.submit).toBe('manual');
    // v5 p1-shell (the review's F5): the sidebar never opens by itself in the agent's window.
    expect(contentSettingsOf({ ...ask, view: 'expanded' }, { agent: true }).view).toBe('minimized');
    expect(contentSettingsOf({ ...ask, view: 'expanded' }).view).toBe('expanded');
    // Any other choice is the person's in the agent's window too.
    for (const whenForbidden of ['use-ai', 'profile-only'] as const) {
      expect(contentSettingsOf({ ...ask, llm: { ...ask.llm, whenForbidden } }, { agent: true }).llm.whenForbidden)
        .toBe(whenForbidden);
    }
  });

  it('refuses settings that do not parse, and keeps what was stored', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS);
    for (const settings of [
      { ...CHOSEN, panel: 'floating' },
      { ...CHOSEN, preapprovedConsent: ['i-did-not-use-ai'] },
      { ...CHOSEN, extra: true },
      { ...CHOSEN, version: 1 },
      { ...CHOSEN, version: 3 },
      { ...CHOSEN, autoAdvance: true },
      { ...CHOSEN, view: 'folded' },
      { ...CHOSEN, modes: { ...CHOSEN.modes, consents: 'some' } },
      { ...CHOSEN, modes: { ...CHOSEN.modes, agentSkip: undefined } },
      { ...CHOSEN, llm: { ...CHOSEN.llm, answerAll: true } },
      { ...CHOSEN, llm: { ...CHOSEN.llm, whenForbidden: 'sometimes' } },
      { ...CHOSEN, llm: { tiebreak: true, classify: true, drafts: true } },
    ]) {
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings }, OPTIONS)).toEqual({ ok: false, error: 'bad_message' });
    }
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': CHOSEN });
  });

  it('reads stored settings that no longer parse as the defaults', async () => {
    const worker = await startTestWorker({
      before: async () => fakeBrowser.storage.local.set({ 'settings:v1': { version: 1, panel: 'sideways' } }),
    });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS } });
  });

  it('migrates version 1 settings still on its defaults to version 4’s, and stores them (the owner’s amendments)', async () => {
    const worker = await startTestWorker({
      before: async () => fakeBrowser.storage.local.set({ 'settings:v1': V1_DEFAULTS }),
    });
    // v5 p1-shell: its place, Chrome's side panel, moves to the page (the owner's word), as every migrated install's.
    const expected = { ...DEFAULT_SETTINGS, panel: 'page' };
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: expected } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
  });

  it('keeps every version 1 choice the person changed when it migrates', async () => {
    const chosen = { ...V1_DEFAULTS, panel: 'in-page', autoAdvance: true, preapprovedConsent: ['privacy', 'marketing'],
      llm: { tiebreak: false, classify: false, drafts: true }, telemetry: { optIn: true }, offerToSaveAnswers: false,
      interpretations: { postingCountryForLegal: true, twoOrMoreRaces: false } };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': chosen }) });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true, data: { settings: {
      // v5 p1-shell: version 7's 'in-page' (the small card) is the sidebar on the page (version 8).
      version: 8, panel: 'page', view: 'expanded',
      // Auto-advance became the Next mode; version 3's `all` answers took their default (All), and act only while
      // answers are on; the other modes take theirs.
      modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' },
      preapprovedConsent: ['privacy', 'marketing'],
      // The AI turned off (tiebreak and classification): answers stay off, drafts as the person set them (MINOR 4).
      llm: { tiebreak: false, classify: false, drafts: true, answers: false, whenForbidden: 'profile-only' },
      telemetry: { optIn: true }, offerToSaveAnswers: false,
      // Interpretation 2 was on version 1's default (off), so it takes version 2's.
      interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true, eeoDeclineByDefault: true },
    } } });
  });

  it('migrates version 2 settings to version 8’s, every choice kept, the `all` answers on (the owner’s decision of 2026-11-01) and "Ask me each time" Profile only (v4)', async () => {
    const { modes: _modes, view: _view, version: _version, ...rest } = CHOSEN;
    const v2 = { ...rest, ...OLD_PANEL, version: 2, autoAdvance: true, llm: { ...CHOSEN.llm, answers: false, confirmDrafts: true,
      whenForbidden: 'ask' } };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v2 }) });
    const expected = { ...CHOSEN, ...ON_PAGE, view: 'expanded', modes: { ...DEFAULT_SETTINGS.modes, next: 'auto', ai: 'all' },
      llm: { ...CHOSEN.llm, answers: false, whenForbidden: 'profile-only' } };
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
      data: { settings: expected } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
  });

  it('migrates version 3 settings to version 8’s: auto-advance is the Next mode, the `all` answers the AI answers mode (v3 Phase 3)', async () => {
    const { modes: _modes, view: _view, ...rest } = CHOSEN;
    for (const [autoAdvance, answerAll] of [[true, false], [false, true]] as const) {
      const v3 = { ...rest, ...OLD_PANEL, version: 3, autoAdvance, llm: { ...CHOSEN.llm, confirmDrafts: false, answerAll } };
      const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v3 }) });
      // Every other choice kept; the consents take the owner's default (All); the view its default (Expanded).
      const expected = { ...CHOSEN, ...ON_PAGE, view: 'expanded', modes: { ...DEFAULT_SETTINGS.modes,
        next: autoAdvance ? 'auto' : 'manual', ai: answerAll ? 'all' : 'profile' } };
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
        data: { settings: expected } });
      expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
    }
    expect(DEFAULT_SETTINGS.modes).toEqual({ signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual',
      recordOwn: 'on', consents: 'all', ai: 'all', resumeOnPage: 'keep',
      agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false }, noMatch: 'other', notifications: 'until-closed' });
    expect(DEFAULT_SETTINGS.view).toBe('expanded');
  });

  it('migrates version 4 settings to version 8’s, every choice kept and "Résumé already on the page" Keep it, and stores them (the behaviour review of 2026-11-06)', async () => {
    const { resumeOnPage: _added, ...v4modes } = CHOSEN_MODES_V6;
    const v4 = { ...CHOSEN, ...OLD_PANEL, version: 4, modes: { ...v4modes, recordOwn: 'off', submit: 'auto' },
      llm: { ...CHOSEN.llm, confirmDrafts: false } };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v4 }) });
    const expected = { ...CHOSEN, ...ON_PAGE, modes: { ...CHOSEN.modes, recordOwn: 'off', submit: 'auto', resumeOnPage: 'keep' } };
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
      data: { settings: expected } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
    // A version 4 value from before "Record applications I submit myself" reads it as on, too.
    const { recordOwn: _older, ...older } = v4modes;
    const oldest = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1':
      { ...v4, modes: older } }) });
    expect(await oldest.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true,
      data: { settings: { version: 8, modes: { recordOwn: 'on', resumeOnPage: 'keep' } } } });
  });

  it('migrates version 5 settings to version 8’s (v4, D6): "Ask me each time" Profile only, the draft confirmation gone, and stores them', async () => {
    const v5 = { ...CHOSEN, ...OLD_PANEL, version: 5, modes: CHOSEN_MODES_V6,
      llm: { ...CHOSEN.llm, confirmDrafts: true, whenForbidden: 'ask' } };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v5 }) });
    const expected = { ...CHOSEN, ...ON_PAGE, llm: { ...CHOSEN.llm, whenForbidden: 'profile-only' } };
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
      data: { settings: expected } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
    // A save that still names them is refused: they are gone.
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN,
      llm: { ...CHOSEN.llm, whenForbidden: 'ask' } } }, OPTIONS)).toEqual({ ok: false, error: 'bad_message' });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN,
      llm: { ...CHOSEN.llm, confirmDrafts: false } } }, OPTIONS)).toEqual({ ok: false, error: 'bad_message' });
  });

  // s2 profile (snapshot round 2): "When a list has no match" and how long the page's notifications stay.
  it('migrates version 6 settings to version 8’s, every choice kept, Other and Until closed, and stores them', async () => {
    const v6 = { ...CHOSEN, ...OLD_PANEL, version: 6, modes: CHOSEN_MODES_V6 };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v6 }) });
    const expected = { ...CHOSEN, ...ON_PAGE, modes: { ...CHOSEN.modes, noMatch: 'other', notifications: 'until-closed' } };
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
      data: { settings: expected } });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
  });

  // v5 p1-shell (settings version 8): "Where the panel shows".
  it('migrates version 7 settings to version 8’s: the panel on the page and Default view Expanded for every install (the review, F9), every other choice kept, and stores them', async () => {
    for (const [stored, read] of [['in-page', 'page'], ['side', 'page']] as const) {
      const v7 = { ...CHOSEN, version: 7, panel: stored };
      const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': v7 }) });
      const expected = { ...CHOSEN, panel: read, view: 'expanded' };
      expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toEqual({ ok: true,
        data: { settings: expected } });
      expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': expected });
    }
    // Version 8 holds no 'in-page', and its default is the page.
    const worker = await startTestWorker();
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, panel: 'in-page' } }, OPTIONS))
      .toEqual({ ok: false, error: 'bad_message' });
    expect(DEFAULT_SETTINGS.panel).toBe('page');
    expect(contentSettingsOf({ ...CHOSEN, panel: 'page', view: 'expanded' })).toMatchObject({ panel: 'page',
      view: 'expanded' });
  });

  it('saves a list with no match left empty and each notification time, gives them to a frame, and refuses a choice it does not know or a version 7 value without them', async () => {
    const worker = await startTestWorker();
    for (const notifications of ['off', '5s', '10s', '30s', 'until-closed'] as const) {
      const chosen = { ...CHOSEN, modes: { ...CHOSEN.modes, noMatch: 'leave' as const, notifications } };
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: chosen }, OPTIONS)).toEqual({ ok: true,
        data: { settings: chosen } });
      expect(contentSettingsOf(chosen).modes).toMatchObject({ noMatch: 'leave', notifications });
      // The agent's window keeps the person's own.
      expect(contentSettingsOf(chosen, { agent: true }).modes).toMatchObject({ noMatch: 'leave', notifications });
    }
    for (const modes of [{ ...CHOSEN.modes, noMatch: 'skip' }, { ...CHOSEN.modes, notifications: '60s' },
      CHOSEN_MODES_V6]) {
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, modes } }, OPTIONS))
        .toEqual({ ok: false, error: 'bad_message' });
    }
  });

  it('acts as Sign-in Auto for a tab Sign up & Autofill granted, unless Sign-in is held (v4)', () => {
    expect(contentSettingsOf(DEFAULT_SETTINGS, { signUp: true }).modes.signIn).toBe('auto');
    expect(contentSettingsOf(DEFAULT_SETTINGS, { signUp: true, holdSignIn: true }).modes.signIn).toBe('manual');
    expect(contentSettingsOf(DEFAULT_SETTINGS).modes.signIn).toBe('manual');
  });

  it('saves "Upload mine again", and refuses a version 5 value without "Résumé already on the page" or with a choice it does not know', async () => {
    const worker = await startTestWorker();
    const upload = { ...CHOSEN, modes: { ...CHOSEN.modes, resumeOnPage: 'upload' as const } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: upload }, OPTIONS)).toEqual({ ok: true,
      data: { settings: upload } });
    const { resumeOnPage: _gone, ...without } = CHOSEN.modes;
    for (const modes of [without, { ...CHOSEN.modes, resumeOnPage: 'replace' }]) {
      expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, modes } }, OPTIONS))
        .toEqual({ ok: false, error: 'bad_message' });
    }
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': upload });
  });

  it('keeps the AI off for a person who turned it off in version 1: no drafts, no answers (the Phase E review, MINOR 4)', async () => {
    const off = { ...V1_DEFAULTS, llm: { tiebreak: false, classify: false, drafts: false } };
    const worker = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': off }) });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true, data: { settings: {
      llm: { tiebreak: false, classify: false, drafts: false, answers: false } } } });
    // One of the two still on: the new defaults, as before.
    const one = { ...V1_DEFAULTS, llm: { tiebreak: false, classify: true, drafts: false } };
    const again = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': one }) });
    expect(await again.deliver({ v: 1, type: 'settings/get' }, OPTIONS)).toMatchObject({ ok: true, data: { settings: {
      llm: { tiebreak: false, classify: true, drafts: true, answers: true } } } });
  });

  it('reach every frame with a form, and (v5, the review, F1) every top frame of ours, once saved, as its content settings, so a run reads auto-advance afresh (the Phase 5 review, C-S2) and a sidebar follows where the panel shows', async () => {
    const worker = await startTestWorker();
    const other = contentSender({ tab: { id: 8 }, frameId: 3, documentId: 'doc-3' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: true }, other);
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false },
      contentSender({ frameId: 5, documentId: 'doc-5' }));
    // A posting's top frame with no form (its sidebar open): told too.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false },
      contentSender({ tab: { id: 9 }, documentId: 'doc-9' }));
    // One frame is gone: the save is answered all the same.
    worker.fakes.frameAnswers = ({ options }) => {
      if (options?.frameId === 3) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, data: {} };
    };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, OPTIONS))
      .toEqual({ ok: true, data: { settings: CHOSEN } });
    const pushed = sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'settings/changed')
      .sort((a, b) => a.tabId - b.tabId);
    const message = { v: 1, type: 'settings/changed', settings: CHOSEN_CONTENT };
    expect(pushed).toEqual([
      { tabId: 7, message, options: { frameId: 0, documentId: 'doc-1' } },
      { tabId: 8, message, options: { frameId: 3, documentId: 'doc-3' } },
      { tabId: 9, message, options: { frameId: 0, documentId: 'doc-9' } },
    ]);
    // A save that does not parse tells no frame anything.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, panel: 'floating' } }, OPTIONS);
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'settings/changed')).toHaveLength(3);
  });

  it('are read and written by extension pages, and (v5) by the sidebar from a tab\'s top frame only while the panel shows on the page', async () => {
    const worker = await startTestWorker();
    // A subframe never.
    const sub = contentSender({ frameId: 2, documentId: 'doc-2' });
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, sub)).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, sub)).toEqual({ ok: false, error: 'bad_sender' });
    // The top frame, while the panel shows on the page (the default): the sidebar's Settings view.
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, contentSender())).toEqual({ ok: true,
      data: { settings: DEFAULT_SETTINGS } });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: CHOSEN }, contentSender())).toEqual({ ok: true,
      data: { settings: CHOSEN } });
    // CHOSEN's place is Chrome's side panel: the page's channel is closed from then on.
    expect(await worker.deliver({ v: 1, type: 'settings/get' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings: { ...CHOSEN, panel: 'page' } }, contentSender()))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await fakeBrowser.storage.local.get('settings:v1')).toEqual({ 'settings:v1': CHOSEN });
  });

  it('reach a frame only as its content settings, with frame/hello\'s connection state', async () => {
    const offline = await startTestWorker({ before: async () => fakeBrowser.storage.local.set({ 'settings:v1': CHOSEN }) });
    expect(await offline.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender())).toEqual({
      ok: true,
      data: { frameId: 0, connected: false, settings: CHOSEN_CONTENT, launcher: { top: null, hidden: false } },
    });
    const connected = await startTestWorker({ token: tokenRecord() });
    expect(await connected.deliver({ v: 1, type: 'frame/hello', isTop: false, hasForm: false }, contentSender({ frameId: 2 })))
      .toMatchObject({ ok: true, data: { frameId: 2, connected: true } });
    // frame/hello reads no profile and asks TailorIT nothing.
    expect(connected.tailorit.requests).toHaveLength(0);
  });
});
