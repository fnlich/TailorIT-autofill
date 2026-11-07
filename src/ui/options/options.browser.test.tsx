import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CONSENT_CATEGORIES } from '../../core/enums';
import { DEFAULT_SETTINGS, type Settings } from '../../core/types/settings';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, mount, settle, typeInto, unmountAll, type FakeWorker } from '../ui.testkit';
import type { FrameScheduler } from './countdown';
import { Options } from './Options';

const TEXT = COPY.options;

/** Frames the test runs by hand, and a clock it moves. */
function handFrames() {
  const pending: Array<() => void> = [];
  const clock = { now: Date.UTC(2026, 9, 30, 12, 0, 0) };
  const frames: FrameScheduler = (callback) => {
    pending.push(callback);
    return () => {
      const at = pending.indexOf(callback);
      if (at >= 0) pending.splice(at, 1);
    };
  };
  return {
    frames,
    now: () => clock.now,
    async advance(ms: number) {
      clock.now += ms;
      await act(async () => {
        for (const callback of pending.splice(0)) callback();
      });
    },
  };
}

async function open(worker: FakeWorker, time = handFrames()): Promise<HTMLElement> {
  const root = await mount(<Options platform={worker.platform} now={time.now} frames={time.frames} />);
  await settle();
  return root;
}

const setting = (root: ParentNode, name: string) => root.querySelector<HTMLInputElement>(`input[data-setting="${name}"]`)!;
const saves = (worker: FakeWorker) => worker.sentOfType('settings/save').map((message) => message.settings as Settings);

describe('the options page', () => {
  afterEach(() => unmountAll());

  it('shows the stored settings, saves each change through the worker, and shows what the worker answered', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    // Version 2's defaults (the owner's amendments, docs/SPEC-AMENDMENTS.md), and version 4's modes (v3 Phase 3).
    expect(setting(root, 'modes.next.manual').checked).toBe(true);
    expect(setting(root, 'modes.afterPageTurn.auto').checked).toBe(true);
    expect(setting(root, 'modes.consents.all').checked).toBe(true);
    expect(setting(root, 'modes.ai.all').checked).toBe(true);
    expect(setting(root, 'view.expanded').checked).toBe(true);
    expect(setting(root, 'llm.tiebreak').checked).toBe(true);
    expect(setting(root, 'llm.classify').checked).toBe(true);
    expect(setting(root, 'llm.drafts').checked).toBe(true);
    expect(setting(root, 'llm.answers').checked).toBe(true);
    expect(setting(root, 'llm.whenForbidden.profile-only').checked).toBe(true);
    expect(setting(root, 'interpretations.eeoDeclineByDefault').checked).toBe(true);
    expect(setting(root, 'panel.side').checked).toBe(true);
    // Under Consent boxes: All agreements every kind is ticked: each toggle shows so, fixed, and a line says where the
    // choice is (v3 Phase 3 review).
    for (const category of CONSENT_CATEGORIES) {
      expect([setting(root, `consent.${category}`).checked, setting(root, `consent.${category}`).disabled], category)
        .toEqual([true, true]);
    }
    expect(root.querySelector('[data-consents-all]')?.textContent).toBe(TEXT.consent.allMode);
    // Required only: the kinds pre-approved, each the person's to change.
    await click(setting(root, 'modes.consents.required'));
    expect(root.querySelector('[data-consents-all]')).toBeNull();
    for (const category of CONSENT_CATEGORIES) {
      expect([setting(root, `consent.${category}`).checked, setting(root, `consent.${category}`).disabled], category)
        .toEqual([category !== 'marketing' && category !== 'sms', false]);
    }

    await click(setting(root, 'modes.next.auto'));
    await click(setting(root, 'consent.marketing'));
    await click(setting(root, 'consent.privacy'));
    await click(setting(root, 'llm.drafts'));
    // v4 (D6): the draft confirmation and "Ask me each time" are gone; "Use AI anyway" stands for the policy choice.
    await click(setting(root, 'llm.whenForbidden.use-ai'));
    await click(setting(root, 'interpretations.twoOrMoreRaces'));
    await click(setting(root, 'panel.in-page'));
    expect(saves(worker)).toHaveLength(8);
    // Each save is the whole settings, built on the last answer; consent stays in the closed list's order.
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto',
      consents: 'required' },
      preapprovedConsent: ['terms', 'certify', 'dataRetention', 'marketing', 'backgroundCheck', 'signature'],
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false, whenForbidden: 'use-ai' }, panel: 'in-page',
      interpretations: { ...DEFAULT_SETTINGS.interpretations, twoOrMoreRaces: false } });
    expect(root.textContent).toContain(TEXT.saved);
    for (const name of ['modes.next.auto', 'consent.marketing', 'llm.whenForbidden.use-ai', 'panel.in-page']) {
      expect(setting(root, name).checked, name).toBe(true);
    }
    for (const name of ['consent.privacy', 'llm.drafts', 'interpretations.twoOrMoreRaces', 'llm.whenForbidden.profile-only']) {
      expect(setting(root, name).checked, name).toBe(false);
    }
  });

  it('shows the modes in their own card, each saved at once, Submit since v3 Phase 4, Sign-in and the skip rules since v3 Phase 5', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const card = root.querySelector<HTMLElement>('[data-card="modes"]')!;
    expect(card.id).toBe('settings-modes');
    expect(card.querySelector('h2')?.textContent).toBe(TEXT.modes.heading);
    expect([...card.querySelectorAll<HTMLElement>('[data-setting-group]')].map((group) => [group.dataset.settingGroup,
      group.querySelector('legend')?.textContent])).toEqual([['modes.signIn', TEXT.modes.signIn.name],
      ['modes.next', TEXT.modes.next.name],
      ['modes.afterPageTurn', TEXT.modes.afterPageTurn.name], ['modes.submit', TEXT.modes.submit.name],
      ['modes.recordOwn', TEXT.modes.recordOwn.name], ['modes.consents', TEXT.modes.consents.name], ['modes.ai', TEXT.modes.ai.name],
      ['modes.resumeOnPage', TEXT.modes.resumeOnPage.name], ['view', TEXT.modes.view.name],
      ['modes.agentSkip', TEXT.modes.agentSkip.name]]);
    // Submit is Manual unless the person sets it to Auto.
    expect(setting(root, 'modes.submit.manual').checked).toBe(true);
    await click(setting(root, 'modes.submit.auto'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' } });
    await click(setting(root, 'modes.submit.manual'));
    // The skip rules (v3 Phase 5), each a box saved at once.
    expect(setting(root, 'modes.agentSkip.legalGuess').checked).toBe(false);
    await click(setting(root, 'modes.agentSkip.legalGuess'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes,
      agentSkip: { ...DEFAULT_SETTINGS.modes.agentSkip, legalGuess: true } } });
    await click(setting(root, 'modes.agentSkip.legalGuess'));
    // The AI's answers to legal, pay and attention-check questions (version 3's switch) are the AI answers mode.
    expect(root.querySelector('input[data-setting="llm.answerAll"]')).toBeNull();
    await click(setting(root, 'modes.ai.profile'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, ai: 'profile' } });
    await click(setting(root, 'modes.consents.required'));
    await click(setting(root, 'modes.afterPageTurn.manual'));
    await click(setting(root, 'view.minimized'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, view: 'minimized', modes: { ...DEFAULT_SETTINGS.modes,
      ai: 'profile', consents: 'required', afterPageTurn: 'manual' } });
    for (const help of [TEXT.modes.next.help, TEXT.modes.consents.help, TEXT.modes.ai.help]) expect(card.textContent).toContain(help);
  });

  it('shows "Résumé already on the page" with the modes: Keep it by default, Upload mine again saved at once, each choice said (the behaviour review of 2026-11-06)', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const group = root.querySelector<HTMLElement>('[data-card="modes"] [data-setting-group="modes.resumeOnPage"]')!;
    expect(group.querySelector('legend')?.textContent).toBe('Résumé already on the page');
    expect([...group.querySelectorAll('label')].map((label) => label.textContent)).toEqual(['Keep it', 'Upload mine again']);
    expect(setting(root, 'modes.resumeOnPage.keep').checked).toBe(true);
    // The help says what each choice does: the page's file kept and flagged; the person's uploaded through the site's
    // own upload, the site's Remove and Delete never pressed, and a field with no way to add a file left to them.
    const help = group.querySelector('.tia-mode__help')?.textContent ?? '';
    expect(help).toBe(TEXT.modes.resumeOnPage.help);
    for (const words of ['Keep it leaves that file', 'Upload mine again uploads the résumé you chose',
      "Neither presses the site's Remove or Delete", 'the field is left to you']) expect(help).toContain(words);
    await click(setting(root, 'modes.resumeOnPage.upload'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, resumeOnPage: 'upload' } });
    expect(setting(root, 'modes.resumeOnPage.upload').checked).toBe(true);
    await click(setting(root, 'modes.resumeOnPage.keep'));
    expect(saves(worker).at(-1)).toEqual(DEFAULT_SETTINGS);
  });

  it('shows the settings the worker stored, not the ones it was sent, and the old ones when a save is refused', async () => {
    const worker = createFakeWorker();
    // The worker stores something else than asked (as storage would after a schema change): the page shows it.
    worker.on('settings/save', () => ({ ok: true, data: { settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, tiebreak: false, classify: true, drafts: false } } } }));
    const root = await open(worker);
    await click(setting(root, 'modes.next.auto'));
    expect(setting(root, 'modes.next.auto').checked).toBe(false);
    expect(setting(root, 'llm.tiebreak').checked).toBe(false);

    worker.on('settings/save', () => ({ ok: false, error: 'bad_message' }));
    await click(setting(root, 'llm.classify'));
    expect(setting(root, 'llm.classify').checked).toBe(true);
    expect(root.textContent).toContain(TEXT.notSaved);
  });

  it('holds every control still while a change is on its way', async () => {
    const worker = createFakeWorker();
    let answer: (value: unknown) => void = () => undefined;
    worker.on('settings/save', (message) => new Promise((resolve) => {
      answer = () => resolve({ ok: true, data: { settings: message.settings } });
    }));
    const root = await open(worker);
    await click(setting(root, 'modes.next.auto'));
    expect(setting(root, 'modes.next.auto').checked).toBe(true);
    expect(setting(root, 'llm.drafts').disabled).toBe(true);
    expect(setting(root, 'modes.consents.required').disabled).toBe(true);
    await act(async () => answer(undefined));
    await settle();
    expect(setting(root, 'llm.drafts').disabled).toBe(false);
  });

  it('offers only the closed list of consent categories, with a warning on certify, and says what never goes to the AI', async () => {
    const root = await open(createFakeWorker());
    const offered = [...root.querySelectorAll<HTMLInputElement>('input[data-setting^="consent."]')].map((input) => input.dataset.setting);
    expect(offered).toEqual(CONSENT_CATEGORIES.map((category) => `consent.${category}`));
    expect(root.querySelector('[data-warning="certify"]')?.textContent).toBe(TEXT.consent.certifyWarning);
    expect(root.textContent).toContain(TEXT.consent.never);
    expect(root.querySelector('[data-ai-never]')?.textContent).toBe(TEXT.ai.never);
    expect(root.textContent).toContain(TEXT.modes.next.help);
    expect(root.textContent).toContain(TEXT.panel.inPageHelp);
  });

  it('offers to save the person’s fixes, on by default, and saves the change', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    expect(setting(root, 'offerToSaveAnswers').checked).toBe(true);
    expect(root.textContent).toContain(TEXT.answers.offerHelp);
    await click(setting(root, 'offerToSaveAnswers'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, offerToSaveAnswers: false });
  });

  describe('the anonymous counters', () => {
    const counted = [
      { platform: 'lever', fieldKind: 'text', matcherStage: 'not-applicable', outcome: 'success', tripwireTriggered: false, count: 12 },
      { platform: 'greenhouse', fieldKind: 'select', matcherStage: 'fuzzy', outcome: 'fail', tripwireTriggered: true, count: 3 },
    ] as const;

    it('are off by default, and the opt-in lists the five fields counted and nothing more', async () => {
      const worker = createFakeWorker();
      const root = await open(worker);
      expect(setting(root, 'telemetry.optIn').checked).toBe(false);
      const fields = [...root.querySelectorAll<HTMLElement>('[data-telemetry-fields] li')];
      expect(fields.map((item) => item.dataset.field)).toEqual(['platform', 'fieldKind', 'matcherStage', 'outcome',
        'tripwireTriggered']);
      expect(fields.map((item) => item.textContent)).toEqual(Object.values(TEXT.telemetry.fields));
      expect(root.textContent).toContain(TEXT.telemetry.never);
      expect(root.querySelector('[data-telemetry="empty"]')?.textContent).toBe(TEXT.telemetry.empty);
      expect(root.querySelector('[data-telemetry-export]')).toBeNull();

      await click(setting(root, 'telemetry.optIn'));
      expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, telemetry: { optIn: true } });
      // The counts are read again once the opt-in changed.
      expect(worker.sentOfType('telemetry/get').length).toBeGreaterThanOrEqual(2);
    });

    it('show the counts kept in this browser, export them as a JSON file, and clear them', async () => {
      const worker = createFakeWorker();
      worker.script.settings = { ...DEFAULT_SETTINGS, telemetry: { optIn: true } };
      worker.script.counts = counted.map((count) => ({ ...count }));
      const root = await open(worker);
      const table = root.querySelector('[data-telemetry="counts"]')!;
      expect([...table.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(Object.values(TEXT.telemetry.columns));
      expect([...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((cell) => cell.textContent)))
        .toEqual([
          ['Lever', COPY.fieldKinds.text, COPY.stages['not-applicable'], TEXT.telemetry.outcomes.success, TEXT.telemetry.no, '12'],
          ['Greenhouse', COPY.fieldKinds.select, COPY.stages.fuzzy, TEXT.telemetry.outcomes.fail, TEXT.telemetry.yes, '3'],
        ]);

      const link = root.querySelector<HTMLAnchorElement>('a[data-telemetry-export]')!;
      expect(link.getAttribute('download')).toBe(TEXT.telemetry.exportName);
      expect(link.textContent).toBe(TEXT.telemetry.export);
      const prefix = 'data:application/json;charset=utf-8,';
      expect(link.href.startsWith(prefix)).toBe(true);
      const file = JSON.parse(decodeURIComponent(link.href.slice(prefix.length))) as { fields: string[]; counts: object[] };
      expect(file).toEqual({ fields: ['platform', 'fieldKind', 'matcherStage', 'outcome', 'tripwireTriggered'], counts: counted });
      for (const entry of file.counts) {
        expect(Object.keys(entry).sort()).toEqual(['count', 'fieldKind', 'matcherStage', 'outcome', 'platform', 'tripwireTriggered']);
      }

      await click(button(root, TEXT.telemetry.clear));
      expect(worker.sentOfType('telemetry/clear')).toHaveLength(1);
      expect(root.querySelector('[data-telemetry="counts"]')).toBeNull();
      expect(root.textContent).toContain(TEXT.telemetry.cleared);
      expect(root.querySelector('[data-telemetry="empty"]')).not.toBeNull();
    });
  });

  it('shows the first-run disclosure before Connect, and Connect opens TailorIT with its countdown', async () => {
    const worker = createFakeWorker();
    const time = handFrames();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    worker.on('auth/startPairing', () => {
      worker.script.auth = { ...worker.script.auth, pairingExpiresAt: time.now() + 10 * 60 * 1000 };
      return { ok: true, data: { expiresAt: worker.script.auth.pairingExpiresAt } };
    });
    const root = await open(worker, time);
    const disclosure = root.querySelector('[data-disclosure]')!;
    const connect = button(root, TEXT.connection.connect)!;
    expect(disclosure.textContent).toContain(TEXT.connection.disclosure[0]);
    expect(disclosure.textContent).toContain(TEXT.connection.consentLine);
    expect(disclosure.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await click(connect);
    expect(worker.sentOfType('auth/startPairing')).toEqual([{ v: 1, type: 'auth/startPairing' }]);
    await time.advance(0);
    expect(root.querySelector('[data-pairing]')?.textContent).toBe(`${TEXT.connection.waiting} ${TEXT.connection.endsIn('10:00')}`);
    await time.advance(19_000);
    expect(root.querySelector('[data-pairing]')?.textContent).toContain(TEXT.connection.endsIn('9:41'));
    await time.advance(10 * 60 * 1000);
    expect(root.querySelector('[data-pairing="lapsed"]')?.textContent).toBe(TEXT.connection.lapsed);
  });

  it('connects with a typed code, and explains a code TailorIT refuses', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    worker.on('auth/redeemCode', (message) => (message.code === 'K7QM-2XRD-9VHT-PA3C'
      ? { ok: true, data: authStatus({ scopes: ['profile:read', 'resumes:read', 'jobs:lookup', 'ai:run', 'answers:write'] }) }
      : { ok: false, error: 'expired' }));
    const root = await open(worker);
    const input = root.querySelector<HTMLInputElement>('input.tia-code__input')!;

    await typeInto(input, 'not a code');
    await click(button(root, TEXT.connection.codeSubmit));
    expect(root.textContent).toContain(TEXT.connection.codeInvalid);
    expect(worker.sentOfType('auth/redeemCode')).toEqual([]);

    await typeInto(input, 'zzzz zzzz zzzz zzzz');
    await click(button(root, TEXT.connection.codeSubmit));
    expect(root.textContent).toContain(TEXT.connection.codeRefused);

    // Typed loosely (lower case, spaces): sent in the form TailorIT shows it.
    await typeInto(input, 'k7qm 2xrd 9vht pa3c');
    await click(button(root, TEXT.connection.codeSubmit));
    expect(worker.sentOfType('auth/redeemCode').at(-1)).toEqual({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' });
    expect(root.textContent).toContain(TEXT.connection.connectedAs('Morgan Lee', 'morgan@example.test'));
    expect(root.textContent).toContain(TEXT.connection.sensitiveNotShared);
    expect(root.querySelector('[data-disclosure]')).toBeNull();
  });

  it('shows the connection, disconnects, and explains expired, revoked, a version mismatch and refused storage', async () => {
    const worker = createFakeWorker();
    worker.on('auth/disconnect', () => ({ ok: true, data: authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null }) }));
    const root = await open(worker);
    expect(root.textContent).toContain(TEXT.connection.connectedAs('Morgan Lee', 'morgan@example.test'));
    expect(root.textContent).toContain(TEXT.connection.sensitiveShared);
    expect(button(root, TEXT.connection.connect)).toBeNull();
    await click(button(root, TEXT.connection.disconnect));
    expect(worker.sentOfType('auth/disconnect')).toHaveLength(1);
    expect(root.textContent).toContain(TEXT.connection.disconnected);
    expect(root.querySelector('[data-disclosure]')).not.toBeNull();

    for (const [status, text] of [
      [authStatus({ connection: 'expired', account: null }), TEXT.connection.expired],
      [authStatus({ connection: 'revoked', account: null }), TEXT.connection.revoked],
      [authStatus({ versionMismatch: true }), TEXT.connection.versionMismatch],
      [authStatus({ storageAccess: 'refused' }), TEXT.connection.storageRefused],
    ] as const) {
      const each = createFakeWorker();
      each.script.auth = status;
      expect((await open(each)).textContent, text).toContain(text);
    }
  });

  it('clears the saved runs and says how many went', async () => {
    const worker = createFakeWorker();
    worker.on('runs/clear', () => ({ ok: true, data: { cleared: 3 } }));
    const root = await open(worker);
    await click(button(root, TEXT.data.clear));
    expect(worker.sentOfType('runs/clear')).toEqual([{ v: 1, type: 'runs/clear' }]);
    expect(root.textContent).toContain(TEXT.data.cleared(3));
  });
});

describe('Options › Auto-apply and Sign-in (v3 Phase 5)', () => {
  it('turns Run auto-apply on only after the person confirms, once; shows the status, Stop and TailorIT’s page', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const card = root.querySelector<HTMLElement>('[data-card="agent"]')!;
    expect(card.querySelector('h2')?.textContent).toBe(TEXT.agent.heading);
    const run = setting(card, 'agent.on');
    expect(run.checked).toBe(false);
    expect(card.querySelector('[data-agent-line]')?.textContent).toBe(COPY.agent.line(worker.script.agent));
    expect(card.querySelector<HTMLAnchorElement>('a[data-tailorit-link="auto-apply"]')?.href)
      .toMatch(/\/auto-apply$/);
    // The first time: the confirmation, and nothing sent until the person confirms.
    await click(run);
    expect(card.querySelector('[data-agent-confirm]')?.textContent).toContain(TEXT.agent.confirm);
    expect(worker.sentOfType('agent/set')).toEqual([]);
    await click(card.querySelector<HTMLButtonElement>('button[data-action="agent-cancel"]')!);
    expect(card.querySelector('[data-agent-confirm]')).toBeNull();
    expect(setting(card, 'agent.on').checked).toBe(false);
    await click(setting(card, 'agent.on'));
    await click(card.querySelector<HTMLButtonElement>('button[data-action="agent-confirm"]')!);
    expect(worker.sentOfType('agent/set')).toEqual([{ v: 1, type: 'agent/set', on: true, confirmed: true }]);
    expect(setting(card, 'agent.on').checked).toBe(true);
    // Stop: off, the job running left for the person.
    await click(card.querySelector<HTMLButtonElement>('button[data-action="agent-stop"]')!);
    expect(worker.sentOfType('agent/stop')).toHaveLength(1);
    expect(setting(card, 'agent.on').checked).toBe(false);
    // Confirmed once: on again at a click, with no question.
    await click(setting(card, 'agent.on'));
    expect(card.querySelector('[data-agent-confirm]')).toBeNull();
    expect(worker.sentOfType('agent/set').at(-1)).toEqual({ v: 1, type: 'agent/set', on: true });
  });

  it('cannot be turned on while not allowed, and says why', async () => {
    const worker = createFakeWorker();
    worker.script.agent = { ...worker.script.agent, allowed: false, blocked: 'no-scope' };
    const root = await open(worker);
    const card = root.querySelector<HTMLElement>('[data-card="agent"]')!;
    expect(setting(card, 'agent.on').disabled).toBe(true);
    expect(card.querySelector('[data-agent-blocked]')?.textContent).toBe(TEXT.agent.blocked['no-scope']);
  });

  it('offers Sign-in’s Auto only with credentials:read and the disclosure acknowledged, saying how otherwise', async () => {
    const worker = createFakeWorker();
    worker.script.auth = authStatus({ scopes: ['profile:read', 'agent:run'] });
    const root = await open(worker);
    expect(setting(root, 'modes.signIn.manual').checked).toBe(true);
    expect(setting(root, 'modes.signIn.auto').disabled).toBe(true);
    expect(root.querySelector('[data-setting-group="modes.signIn"] [data-mode-blocked]')?.textContent)
      .toBe(TEXT.modes.signIn.needsScope);
    unmountAll();
    const allowed = createFakeWorker();
    allowed.script.auth = authStatus({ scopes: ['profile:read', 'agent:run', 'credentials:read'] });
    const again = await open(allowed);
    expect(setting(again, 'modes.signIn.auto').disabled).toBe(false);
    expect(again.querySelector('[data-setting-group="modes.signIn"] [data-mode-blocked]')).toBeNull();
    await click(setting(again, 'modes.signIn.auto'));
    expect(saves(allowed).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } });
  });
});

describe('the options page: Where Autofill works (v3 Phase 8)', () => {
  afterEach(() => unmountAll());

  it("asks Chrome for every https page on the person's click, then turns the company career sites on", async () => {
    const worker = createFakeWorker();
    let state = { on: false, granted: false };
    worker.on('sites/get', () => ({ ok: true, data: state }));
    worker.on('sites/set', (message) => {
      state = { on: message.on as boolean, granted: message.on as boolean };
      return { ok: true, data: state };
    });
    const root = await open(worker);
    const toggle = setting(root, 'sites.on');
    expect(toggle.checked).toBe(false);
    await click(toggle);
    await settle();
    expect(worker.platform.hostRequests).toEqual([['https://*/*']]);
    expect(worker.sentOfType('sites/set')).toEqual([{ v: 1, type: 'sites/set', on: true }]);
    expect(setting(root, 'sites.on').checked).toBe(true);
    // Off: nothing is asked of Chrome; the worker gives the permission back.
    await click(setting(root, 'sites.on'));
    await settle();
    expect(worker.platform.hostRequests).toHaveLength(1);
    expect(worker.sentOfType('sites/set').at(-1)).toEqual({ v: 1, type: 'sites/set', on: false });
    expect(setting(root, 'sites.on').checked).toBe(false);
  });

  it("stays off when Chrome does not give the permission, and says when Chrome's was taken back", async () => {
    const worker = createFakeWorker();
    worker.on('sites/get', () => ({ ok: true, data: { on: true, granted: false } }));
    worker.platform.requestHosts = async (origins) => {
      worker.platform.hostRequests.push([...origins]);
      return false;
    };
    const root = await open(worker);
    expect(setting(root, 'sites.on').checked).toBe(false);
    expect(root.textContent).toContain(TEXT.sites.needsPermission);
    await click(setting(root, 'sites.on'));
    await settle();
    expect(worker.sentOfType('sites/set')).toEqual([]);
    expect(root.textContent).toContain(TEXT.sites.refused);
  });

  it('gives back what Chrome just granted when the choice could not be saved (the Phase 8 review, P8)', async () => {
    const worker = createFakeWorker();
    worker.on('sites/get', () => ({ ok: true, data: { on: false, granted: false } }));
    worker.on('sites/set', () => ({ ok: false, error: 'internal' }));
    const root = await open(worker);
    await click(setting(root, 'sites.on'));
    await settle();
    expect(worker.platform.hostRequests).toEqual([['https://*/*']]);
    expect(worker.platform.hostRemovals).toEqual([['https://*/*']]);
    expect(setting(root, 'sites.on').checked).toBe(false);
    expect(root.textContent).toContain(TEXT.sites.failed);
  });
});

describe('the options page left open (the audit of 2026-11-06, M4)', () => {
  afterEach(() => unmountAll());

  it('reads the settings again when the worker says they changed, and saves its change with what it read', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    expect(setting(root, 'modes.next.manual').checked).toBe(true);
    // The side panel's gear turns Next page to Auto meanwhile; the worker tells every page.
    const gear: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' } };
    worker.script.settings = gear;
    await act(async () => {
      for (const port of worker.ports) port.post({ v: 1, type: 'panel/changed', what: 'settings' });
    });
    await settle();
    expect(setting(root, 'modes.next.auto').checked).toBe(true);
    // The page's own change goes with the settings it read, so the worker applies that change alone.
    await click(setting(root, 'llm.classify'));
    const sent = worker.sentOfType('settings/save').at(-1)!;
    expect(sent.base).toEqual(gear);
    expect(sent.settings).toEqual({ ...gear, llm: { ...gear.llm, classify: false } });
  });

  it('reads the settings again when it is seen again', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const reads = worker.sentOfType('settings/get').length;
    worker.script.settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' } };
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(worker.sentOfType('settings/get').length).toBe(reads + 1);
    expect(setting(root, 'modes.submit.auto').checked).toBe(true);
  });
});
