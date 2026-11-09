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
    // v5 p1-shell (settings version 8): the panel on the page by default.
    expect(setting(root, 'panel.page').checked).toBe(true);
    // v4 (D6): no draft confirmation, and no "Ask me each time" for a posting that forbids AI.
    expect(root.querySelector('input[data-setting="llm.confirmDrafts"], input[data-setting="llm.whenForbidden.ask"]')).toBeNull();
    expect([...root.querySelectorAll<HTMLInputElement>('input[name="when-forbidden"]')].map((input) => input.value))
      .toEqual(['profile-only', 'use-ai']);
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
    await click(setting(root, 'llm.whenForbidden.use-ai'));
    await click(setting(root, 'interpretations.twoOrMoreRaces'));
    await click(setting(root, 'panel.side'));
    expect(saves(worker)).toHaveLength(8);
    // Each save is the whole settings, built on the last answer; consent stays in the closed list's order.
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto',
      consents: 'required' },
      preapprovedConsent: ['terms', 'certify', 'dataRetention', 'marketing', 'backgroundCheck', 'signature'],
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false, whenForbidden: 'use-ai' }, panel: 'side',
      interpretations: { ...DEFAULT_SETTINGS.interpretations, twoOrMoreRaces: false } });
    expect(root.textContent).toContain(TEXT.saved);
    for (const name of ['modes.next.auto', 'consent.marketing', 'llm.whenForbidden.use-ai', 'panel.side']) {
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
    // v4 ui: the side panel's order and look (radio cards, each title with its "?").
    expect([...card.querySelectorAll<HTMLElement>('[data-setting-group]')].map((group) => [group.dataset.settingGroup,
      group.querySelector('.tia-mode__name')?.textContent])).toEqual([
      ['modes.afterPageTurn', TEXT.modes.afterPageTurn.name], ['view', TEXT.modes.view.name],
      ['panel', TEXT.modes.panel.name], ['modes.next', TEXT.modes.next.name], ['modes.submit', TEXT.modes.submit.name], ['modes.signIn', TEXT.modes.signIn.name],
      ['modes.consents', TEXT.modes.consents.name], ['modes.ai', TEXT.modes.ai.name],
      ['modes.resumeOnPage', TEXT.modes.resumeOnPage.name], ['modes.recordOwn', TEXT.modes.recordOwn.name],
      // v1.3 B (settings version 9).
      ['modes.keepAnswers', TEXT.modes.keepAnswers.name],
      ['modes.noMatch', TEXT.modes.noMatch.name], ['modes.notifications', TEXT.modes.notifications.name],
      ['modes.agentSkip', TEXT.modes.agentSkip.name]]);
    // v1.3 B: "Keep my submitted answers in TailorIT" is On, and Off is saved at once.
    expect(setting(root, 'modes.keepAnswers.on').checked).toBe(true);
    await click(setting(root, 'modes.keepAnswers.off'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, keepAnswers: 'off' } });
    await click(setting(root, 'modes.keepAnswers.on'));
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
    // Each mode's explanation is its "?", describing its group.
    for (const [group, help] of [['modes.next', TEXT.modes.next.help], ['modes.consents', TEXT.modes.consents.help],
      ['modes.ai', TEXT.modes.ai.help]] as const) {
      const shown = card.querySelector<HTMLElement>(`[data-setting-group="${group}"]`)!;
      const tip = shown.querySelector<HTMLElement>('[role="tooltip"]')!;
      expect([tip.textContent, shown.getAttribute('aria-describedby')]).toEqual([help, tip.id]);
    }
    expect(card.querySelector('.tia-help')).toBeNull();
  });
  // s2 profile (snapshot round 2, settings version 7).
  it('shows "When a list has no match" and the notifications’ time with the modes, each choice said and saved at once', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const noMatch = root.querySelector<HTMLElement>('[data-card="modes"] [data-setting-group="modes.noMatch"]')!;
    expect([...noMatch.querySelectorAll('label')].map((label) => label.textContent)).toEqual(['Choose its Other',
      'Leave it empty']);
    expect(setting(root, 'modes.noMatch.other').checked).toBe(true);
    expect(noMatch.querySelector('[role="tooltip"]')?.textContent).toBe(TEXT.modes.noMatch.help);
    await click(setting(root, 'modes.noMatch.leave'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, noMatch: 'leave' } });
    const times = root.querySelector<HTMLElement>('[data-card="modes"] [data-setting-group="modes.notifications"]')!;
    expect([...times.querySelectorAll('label')].map((label) => label.textContent)).toEqual(['Until I close them',
      '30 seconds', '10 seconds', '5 seconds', 'Never show them']);
    expect(setting(root, 'modes.notifications.until-closed').checked).toBe(true);
    await click(setting(root, 'modes.notifications.off'));
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, noMatch: 'leave',
      notifications: 'off' } });
    await click(setting(root, 'modes.notifications.10s'));
    expect(saves(worker).at(-1)?.modes.notifications).toBe('10s');
  });

  it('shows "Résumé already on the page" with the modes: Keep it by default, Upload mine again saved at once, each choice said (the behaviour review of 2026-11-06)', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    const group = root.querySelector<HTMLElement>('[data-card="modes"] [data-setting-group="modes.resumeOnPage"]')!;
    expect(group.querySelector('.tia-mode__name')?.textContent).toBe('Résumé already on the page');
    expect([...group.querySelectorAll('label')].map((label) => label.textContent)).toEqual(['Keep it', 'Upload mine again']);
    expect(setting(root, 'modes.resumeOnPage.keep').checked).toBe(true);
    // The "?" says what each choice does: the page's file kept; the person's uploaded through the site's own upload,
    // the site's Remove and Delete never pressed, and a field with no way to add a file left to them.
    const help = group.querySelector('[role="tooltip"]')?.textContent ?? '';
    expect(help).toBe(TEXT.modes.resumeOnPage.help);
    for (const words of ['Keep it leaves that file', 'Upload mine again uploads the résumé you chose',
      "Neither presses the site's Remove or Delete", 'the field is left to you']) expect(help).toContain(words);
    // D4: a kept résumé counts as filled: nothing "flags" it.
    expect(help).not.toContain('flag');
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
    // v5 p1-shell: "Where the panel shows" with the modes.
    expect(root.textContent).toContain(TEXT.modes.panel.help);
  });

  it('offers no "Your fixes" card: Save my answer is not offered any more (v4, D6)', async () => {
    const root = await open(createFakeWorker());
    expect(root.querySelector('[data-card="answers"], input[data-setting="offerToSaveAnswers"]')).toBeNull();
    expect(root.textContent).not.toContain(TEXT.answers.offerHelp);
  });

  it('puts every card\'s and setting\'s explanation in a "?" beside its title or name, still describing it (v4 ui)', async () => {
    const root = await open(createFakeWorker());
    // The cards' explanations.
    for (const [name, help] of [['modes', TEXT.modes.intro], ['ai', TEXT.ai.intro], ['interpretations', TEXT.interpretations.intro],
      ['runs', TEXT.data.intro], ['telemetry', TEXT.telemetry.intro],
      // v1.4 F: the templates.
      ['documents', COPY.documents.help]] as const) {
      const head = root.querySelector(`[data-card="${name}"] .tia-card__head`)!;
      expect([name, head.querySelector('[role="tooltip"]')?.textContent]).toEqual([name, help]);
    }
    // A toggle's explanation describes its box.
    const drafts = setting(root, 'llm.drafts');
    const tip = document.getElementById(drafts.getAttribute('aria-describedby')!)!;
    expect([tip.getAttribute('role'), tip.textContent]).toEqual(['tooltip', TEXT.ai.draftsHelp]);
    expect(tip.closest('[data-helptip]')).not.toBeNull();
    // What stays as text: the plan's sentence on what never goes to the AI.
    expect(root.querySelector('[data-ai-never]')?.textContent).toBe(TEXT.ai.never);
    // No explanatory paragraph left outside the counters' list of what they count.
    expect([...root.querySelectorAll('.tia-help')].every((help) => help.closest('[data-card="telemetry"]') !== null)).toBe(true);
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
    // v4 ui: why, in the group's "?".
    const group = root.querySelector<HTMLElement>('[data-setting-group="modes.signIn"]')!;
    expect(group.dataset.modeBlocked).toBe('auto');
    expect(group.querySelector('[role="tooltip"]')?.textContent).toBe(`${TEXT.modes.signIn.help} ${TEXT.modes.signIn.needsScope}`);
    unmountAll();
    const allowed = createFakeWorker();
    allowed.script.auth = authStatus({ scopes: ['profile:read', 'agent:run', 'credentials:read'] });
    const again = await open(allowed);
    expect(setting(again, 'modes.signIn.auto').disabled).toBe(false);
    const open_ = again.querySelector<HTMLElement>('[data-setting-group="modes.signIn"]')!;
    expect(open_.dataset.modeBlocked).toBeUndefined();
    expect(open_.querySelector('[role="tooltip"]')?.textContent).toBe(TEXT.modes.signIn.help);
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

  // v5 p1-rules (PLAN decision 10): the permission is the install's own (every https and http page is a required host),
  // so a choice that could not be saved gives nothing back (the Phase 8 review's P8 gave back an optional one).
  it('gives nothing back when the choice could not be saved: the permission is the install’s', async () => {
    const worker = createFakeWorker();
    worker.on('sites/get', () => ({ ok: true, data: { on: false, granted: true } }));
    worker.on('sites/set', () => ({ ok: false, error: 'internal' }));
    const root = await open(worker);
    await click(setting(root, 'sites.on'));
    await settle();
    expect(worker.platform.hostRequests).toEqual([['https://*/*']]);
    expect(worker.platform.hostRemovals).toEqual([]);
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

describe('the Documents card (v1.4 F, PLAN decision 18)', () => {
  afterEach(() => unmountAll());

  const card = (root: ParentNode) => root.querySelector<HTMLElement>('[data-card="documents"]')!;
  const select = (root: ParentNode, kind: string) =>
    card(root).querySelector<HTMLSelectElement>(`[data-template-field="${kind}"] select`)!;
  const choose = async (field: HTMLSelectElement, value: string) => act(async () => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('reads the profile’s two templates with TailorIT’s lists, and saves them alone', async () => {
    const worker = createFakeWorker();
    worker.script.documents = { ...(worker.script.documents as Extract<typeof worker.script.documents,
      { outcome: 'ready' }>), resumeTemplateId: 'one-column-slate', coverLetterTemplateId: 'gone-template' };
    const root = await open(worker);
    expect(worker.sentOfType('panel/documents')).toEqual([{ v: 1, type: 'panel/documents' }]);
    expect(select(root, 'resume').value).toBe('one-column-slate');
    // A stored template TailorIT no longer lists stays a choice, named as such: nothing changes unasked.
    expect(select(root, 'coverLetter').value).toBe('gone-template');
    expect(select(root, 'coverLetter').selectedOptions[0]?.textContent).toBe(COPY.documents.missing);
    const save = card(root).querySelector<HTMLButtonElement>('button[data-action="save-documents"]')!;
    expect(save.disabled).toBe(true);
    await choose(select(root, 'resume'), '');
    await choose(select(root, 'coverLetter'), '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47');
    await click(save);
    expect(worker.sentOfType('panel/documents').at(-1)).toEqual({ v: 1, type: 'panel/documents',
      save: { resumeTemplateId: null, coverLetterTemplateId: '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47' } });
    expect(card(root).querySelector('[data-documents-note]')?.textContent).toBe(COPY.documents.saved);
    expect(select(root, 'resume').selectedOptions[0]?.textContent).toBe(COPY.documents.ownTemplate);
  });

  it('asks nothing until connected, shows them read-only without profile:write, and says a refusal with Try Again', async () => {
    const offline = createFakeWorker();
    offline.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const off = await open(offline);
    expect(offline.sentOfType('panel/documents')).toEqual([]);
    expect(card(off).textContent).toContain(COPY.documents.refusals['not-connected']);
    unmountAll();
    const reader = createFakeWorker();
    reader.script.documents = { ...(reader.script.documents as Extract<typeof reader.script.documents,
      { outcome: 'ready' }>), canWrite: false };
    const read = await open(reader);
    expect(select(read, 'resume').disabled).toBe(true);
    expect(card(read).querySelector('[data-documents-read-only]')?.textContent).toBe(COPY.documents.readOnly);
    expect(card(read).querySelector('button[data-action="save-documents"]')).toBeNull();
    unmountAll();
    const refusing = createFakeWorker();
    refusing.script.documents = { outcome: 'not-allowed' };
    const refused = await open(refusing);
    expect(card(refused).textContent).toContain(COPY.documents.refusals['not-allowed']);
    refusing.script.documents = (createFakeWorker()).script.documents;
    await click(card(refused).querySelector('button[data-documents-retry]'));
    expect(card(refused).querySelector('[data-documents="ready"]')).not.toBeNull();
  });
});
