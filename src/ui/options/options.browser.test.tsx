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
    expect(setting(root, 'autoAdvance').checked).toBe(false);
    expect(setting(root, 'llm.tiebreak').checked).toBe(true);
    expect(setting(root, 'llm.classify').checked).toBe(true);
    expect(setting(root, 'llm.drafts').checked).toBe(false);
    expect(setting(root, 'panel.side').checked).toBe(true);
    for (const category of CONSENT_CATEGORIES) expect(setting(root, `consent.${category}`).checked, category).toBe(false);

    await click(setting(root, 'autoAdvance'));
    await click(setting(root, 'consent.certify'));
    await click(setting(root, 'consent.privacy'));
    await click(setting(root, 'llm.drafts'));
    await click(setting(root, 'interpretations.twoOrMoreRaces'));
    await click(setting(root, 'panel.in-page'));
    expect(saves(worker)).toHaveLength(6);
    // Each save is the whole settings, built on the last answer; consent stays in the closed list's order.
    expect(saves(worker).at(-1)).toEqual({ ...DEFAULT_SETTINGS, autoAdvance: true, preapprovedConsent: ['privacy', 'certify'],
      llm: { tiebreak: true, classify: true, drafts: true }, panel: 'in-page',
      interpretations: { postingCountryForLegal: false, twoOrMoreRaces: true } });
    expect(root.textContent).toContain(TEXT.saved);
    for (const name of ['autoAdvance', 'consent.certify', 'consent.privacy', 'llm.drafts', 'interpretations.twoOrMoreRaces', 'panel.in-page']) {
      expect(setting(root, name).checked, name).toBe(true);
    }
  });

  it('shows the settings the worker stored, not the ones it was sent, and the old ones when a save is refused', async () => {
    const worker = createFakeWorker();
    // The worker stores something else than asked (as storage would after a schema change): the page shows it.
    worker.on('settings/save', () => ({ ok: true, data: { settings: { ...DEFAULT_SETTINGS, llm: { tiebreak: false, classify: true, drafts: false } } } }));
    const root = await open(worker);
    await click(setting(root, 'autoAdvance'));
    expect(setting(root, 'autoAdvance').checked).toBe(false);
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
    await click(setting(root, 'autoAdvance'));
    expect(setting(root, 'autoAdvance').checked).toBe(true);
    expect(setting(root, 'llm.drafts').disabled).toBe(true);
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
    expect(root.textContent).toContain(TEXT.filling.autoAdvanceHelp);
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
