import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, frameReport, mount, PROFILE_SENTINELS, row, settle, unmountAll,
  type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { RECONNECTS } from './reports';
import { pinnedTabOf } from './tab';

const keysShown = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('li[data-field-key]')].map((each) => each.dataset.fieldKey);
/** What the page sent other than its reads: the messages its buttons sent. */
const actions = (worker: FakeWorker) => worker.platform.sent.filter((message) =>
  !['panel/reports', 'auth/status', 'settings/get'].includes(String((message as { type?: unknown }).type)));
const watches = (worker: FakeWorker) => worker.posted.filter((message) => (message as { type?: unknown }).type === 'panel/watch');

async function open(worker: FakeWorker, pinnedTabId: number | null, now?: () => number): Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={pinnedTabId} now={now} />);
  await settle();
  return root;
}

describe('the review panel', () => {
  afterEach(() => unmountAll());

  it('reads ?tabId=N as the tab to pin, and nothing else', () => {
    expect(pinnedTabOf('?tabId=12')).toBe(12);
    expect(pinnedTabOf('?x=1&tabId=0')).toBe(0);
    for (const search of ['', '?tabId=', '?tabId=-1', '?tabId=1.5', '?tabId=abc', '?tabId=12345678901']) {
      expect(pinnedTabOf(search), search).toBeNull();
    }
  });

  it("follows its window's active tab: it reads the tab's reports, watches it, and moves when another tab is chosen", async () => {
    const worker = createFakeWorker({ activeTabId: 3 });
    worker.script.reports.set(3, [frameReport(0, { fields: [row('on-three')] })]);
    worker.script.reports.set(4, [frameReport(0, { fields: [row('on-four')] })]);
    const root = await open(worker, null);
    expect(worker.sentOfType('panel/reports')).toEqual([{ v: 1, type: 'panel/reports', tabId: 3 }]);
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 3 }]);
    expect(keysShown(root)).toEqual(['on-three']);
    expect(root.querySelector('main')?.dataset.tabId).toBe('3');

    await act(async () => worker.platform.activate(4));
    await settle();
    expect(worker.sentOfType('panel/reports').map((message) => message.tabId)).toEqual([3, 4]);
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 3 }, { v: 1, type: 'panel/watch', tabId: 4 }]);
    expect(keysShown(root)).toEqual(['on-four']);

    // A tab chosen in another window leaves this panel where it is.
    await act(async () => worker.platform.activateElsewhere(9));
    await settle();
    expect(worker.sentOfType('panel/reports')).toHaveLength(2);
    expect(watches(worker)).toHaveLength(2);
    expect(keysShown(root)).toEqual(['on-four']);
  });

  it('keeps to the pinned tab whatever tab becomes active', async () => {
    const worker = createFakeWorker({ activeTabId: 3 });
    worker.script.reports.set(7, [frameReport(0, { fields: [row('pinned')] })]);
    const root = await open(worker, 7);
    await act(async () => worker.platform.activate(4));
    await settle();
    expect(worker.sentOfType('panel/reports')).toEqual([{ v: 1, type: 'panel/reports', tabId: 7 }]);
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 7 }]);
    expect(keysShown(root)).toEqual(['pinned']);
  });

  it('sends exactly one message per button: Fill, Dry run, Continue, Cancel', async () => {
    const worker = createFakeWorker();
    worker.script.frames = 2;
    // Before any run, Continue and Cancel have nothing to act on.
    const before = await open(createFakeWorker(), 5);
    expect([button(before, COPY.panel.continue)!.disabled, button(before, COPY.panel.cancel)!.disabled]).toEqual([true, true]);
    expect([button(before, COPY.panel.fill)!.disabled, button(before, COPY.panel.dryRun)!.disabled]).toEqual([false, false]);
    unmountAll();
    worker.script.reports.set(5, [frameReport(0, { status: 'review' })]);
    const root = await open(worker, 5);
    await click(button(root, COPY.panel.fill));
    expect(root.textContent).toContain(COPY.panel.started(2));
    await click(button(root, COPY.panel.dryRun));
    expect(root.textContent).toContain(COPY.panel.dryRunStarted(2));
    await click(button(root, COPY.panel.continue));
    await click(button(root, COPY.panel.cancel));
    expect(root.textContent).toContain(COPY.panel.cancelled(2));
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/fill', tabId: 5, dryRun: false },
      { v: 1, type: 'panel/fill', tabId: 5, dryRun: true },
      { v: 1, type: 'panel/continue', tabId: 5 },
      { v: 1, type: 'panel/cancel', tabId: 5 },
    ]);
  });

  it("sends Show on page and a row's describe for that row, and the policy card's buttons as its frame's decision", async () => {
    const worker = createFakeWorker();
    worker.on('panel/describe', () => ({ ok: true, data: { options: [{ index: 1, label: 'Bachelor of Science' }] } }));
    worker.script.reports.set(5, [frameReport(2, { status: 'policy-notice', notices: [{ code: 'policy' }], fields: [
      row('degree', { status: 'flagged', provenance: null, matcherStage: 'none', reason: 'ambiguous-options',
        detail: { suggestions: [{ index: 1, score: 0.8 }] } }),
    ] })]);
    const root = await open(worker, 5);
    await click(button(root, COPY.report.showOnPage));
    await click(button(root, COPY.report.showSuggestions(1)));
    expect(root.textContent).toContain('Bachelor of Science (80%)');
    const card = root.querySelector('[data-notice="policy"]')!;
    await click(button(card, COPY.policyFillAnyway));
    expect(root.textContent).toContain(COPY.panel.started(1));
    await click(button(card, COPY.policyCancel));
    expect(root.textContent).toContain(COPY.panel.cancelled(1));
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/focus', tabId: 5, frameId: 2, fieldKey: 'degree' },
      { v: 1, type: 'panel/describe', tabId: 5, frameId: 2, fieldKey: 'degree' },
      { v: 1, type: 'panel/policyDecision', tabId: 5, frameId: 2, decision: 'fill' },
      { v: 1, type: 'panel/policyDecision', tabId: 5, frameId: 2, decision: 'cancel' },
    ]);
    await click(button(root, COPY.report.hideSuggestions));
    expect(root.textContent).not.toContain('Bachelor of Science');
  });

  it('sends Confirm draft and Save my answer for that row’s frame and key, and says what came of each', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(3, { platform: 'greenhouse', adapter: 'greenhouse', fields: [
      row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged', provenance: 'llm-draft',
        reason: 'llm-draft-needs-confirmation', needsUserAction: true }),
      row('notice', { category: 'screening.other', status: 'flagged', provenance: null, reason: 'unknown-field',
        needsUserAction: true, wrote: false, detail: { userEdited: true } }),
    ] })]);
    const root = await open(worker, 5);
    // A refusal: the panel says they did not work.
    await click(button(root, COPY.report.confirmDraft));
    expect(root.textContent).toContain(COPY.panel.confirmFailed);
    await click(button(root, COPY.report.saveAnswer));
    expect(root.textContent).toContain(COPY.panel.saveFailed);
    worker.on('panel/confirmDraft', () => ({ ok: true, data: {} }));
    worker.on('panel/saveAnswer', () => ({ ok: true, data: { outcome: 'saved' } }));
    await click(button(root, COPY.report.confirmDraft));
    expect(root.textContent).toContain(COPY.panel.draftConfirmed);
    await click(button(root, COPY.report.saveAnswer));
    expect(root.textContent).toContain(COPY.panel.answerSaved);
    // Phase 6, wave 2: an answer TailorIT would not keep says why.
    worker.on('panel/saveAnswer', () => ({ ok: true, data: { outcome: 'sensitive' } }));
    await click(button(root, COPY.report.saveAnswer));
    expect(root.textContent).toContain(COPY.panel.saveOutcomes.sensitive);
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/confirmDraft', tabId: 5, frameId: 3, fieldKey: 'why' },
      { v: 1, type: 'panel/saveAnswer', tabId: 5, frameId: 3, fieldKey: 'notice' },
      { v: 1, type: 'panel/confirmDraft', tabId: 5, frameId: 3, fieldKey: 'why' },
      { v: 1, type: 'panel/saveAnswer', tabId: 5, frameId: 3, fieldKey: 'notice' },
      { v: 1, type: 'panel/saveAnswer', tabId: 5, frameId: 3, fieldKey: 'notice' },
    ]);
  });

  it('keeps the toolbar’s Continue for pauses: a frame at the policy card gets only its own card’s decision', async () => {
    // Frame 0 waits at a CAPTCHA pause, frame 3 at the policy card.
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { status: 'handoff', pauseReason: 'captcha', notices: [{ code: 'captcha' }] }),
      frameReport(3, { status: 'policy-notice', notices: [{ code: 'policy' }] })]);
    const root = await open(worker, 5);
    const cards = [...root.querySelectorAll<HTMLElement>('[data-notice="policy"]')];
    expect(cards.map((card) => card.dataset.policyFrame)).toEqual(['3']);
    await click(button(root.querySelector('.tia-toolbar')!, COPY.panel.continue));
    await click(button(cards[0]!, COPY.policyFillAnyway));
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/continue', tabId: 5 },
      { v: 1, type: 'panel/policyDecision', tabId: 5, frameId: 3, decision: 'fill' },
    ]);
    // A frame that no longer waits says so.
    worker.on('panel/policyDecision', () => ({ ok: false, error: 'expired' }));
    await click(button(cards[0]!, COPY.policyCancel));
    expect(root.textContent).toContain(COPY.panel.continued(0));
  });

  it('gives each frame waiting at the policy card a card of its own, naming it, whose buttons decide for it alone', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(4, { status: 'policy-notice', platform: 'greenhouse', adapter: 'greenhouse' }),
      frameReport(0, { status: 'policy-notice' })]);
    const root = await open(worker, 5);
    const cards = [...root.querySelectorAll<HTMLElement>('[data-notice="policy"]')];
    expect(cards.map((card) => card.dataset.policyFrame)).toEqual(['0', '4']);
    expect(cards[1]!.textContent).toContain(COPY.report.frame(COPY.platforms.greenhouse, true));
    await click(button(cards[1]!, COPY.policyCancel));
    await click(button(cards[0]!, COPY.policyFillAnyway));
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/policyDecision', tabId: 5, frameId: 4, decision: 'cancel' },
      { v: 1, type: 'panel/policyDecision', tabId: 5, frameId: 0, decision: 'fill' },
    ]);
  });

  it('says why a button did nothing, and reads the connection again when it was not connected', async () => {
    const worker = createFakeWorker();
    worker.on('panel/fill', () => ({ ok: false, error: 'not_connected' }));
    // A run that reported and waits for nothing: Continue reaches no frame.
    worker.script.reports.set(5, [frameReport(0, { status: 'review' })]);
    const root = await open(worker, 5);
    const reads = worker.sentOfType('auth/status').length;
    await click(button(root, COPY.panel.fill));
    expect(root.textContent).toContain(COPY.panel.needsConnection);
    expect(worker.sentOfType('auth/status').length).toBe(reads + 1);
    worker.on('panel/continue', () => ({ ok: true, data: { frames: 0 } }));
    await click(button(root, COPY.panel.continue));
    expect(root.textContent).toContain(COPY.panel.continued(0));
  });

  it('reconnects when the port drops, as a worker restart does, and watches its tab again', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('before')] })]);
    const root = await open(worker, 5);
    expect(worker.platform.connects).toBe(1);

    worker.script.reports.set(5, [frameReport(0, { fields: [row('after')] })]);
    await act(async () => worker.ports[0]!.disconnect());
    await settle();
    expect(worker.platform.connects).toBe(2);
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 5 }, { v: 1, type: 'panel/watch', tabId: 5 }]);
    expect(keysShown(root)).toEqual(['after']);

    // Live updates arrive on the new port.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { fields: [row('pushed')] })] }));
    await settle();
    expect(keysShown(root)).toEqual(['pushed']);
  });

  it('stops reconnecting a port that keeps dropping, and offers Reconnect instead', async () => {
    const worker = createFakeWorker();
    const root = await open(worker, 5, () => 1000);
    for (let drop = 0; drop <= RECONNECTS.count; drop += 1) {
      await act(async () => worker.ports.at(-1)!.disconnect());
      await settle();
    }
    expect(worker.platform.connects).toBe(RECONNECTS.count + 1);
    expect(root.textContent).toContain(COPY.panel.linkLost);
    await click(button(root, COPY.panel.reconnect));
    expect(worker.platform.connects).toBe(RECONNECTS.count + 2);
    expect(watches(worker).at(-1)).toEqual({ v: 1, type: 'panel/watch', tabId: 5 });
    expect(root.textContent).not.toContain(COPY.panel.linkLost);
  });

  it('drops a pushed update that carries a value, or names another tab, and keeps what it showed', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('kept')] })]);
    const root = await open(worker, 5);
    const [email] = PROFILE_SENTINELS;
    const tainted = { ...row('tainted'), value: email };
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { fields: [tainted] })] }));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 6, reports: [frameReport(0, { fields: [row('other-tab')] })] }));
    await settle();
    expect(keysShown(root)).toEqual(['kept']);
    for (const sentinel of PROFILE_SENTINELS) expect(root.outerHTML).not.toContain(sentinel);
  });

  it('shows the connection, and why filling cannot work', async () => {
    const connected = createFakeWorker();
    const shown = await open(connected, 5);
    expect(shown.querySelector('[data-connection]')?.textContent).toBe(COPY.panel.connectedAs('Morgan Lee'));

    const missing = createFakeWorker();
    missing.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null,
      storageAccess: 'refused', versionMismatch: true });
    const problem = await open(missing, 5);
    const line = problem.querySelector('[data-connection="not-connected"]')!;
    for (const text of [COPY.panel.notConnected, COPY.panel.storageRefused, COPY.panel.versionMismatch]) expect(line.textContent).toContain(text);
    expect(line.querySelector('a')?.getAttribute('href')).toBe('chrome-extension://memory-extension/options.html');

    const revoked = createFakeWorker();
    revoked.script.auth = authStatus({ connection: 'revoked', account: null });
    expect((await open(revoked, 5)).textContent).toContain(COPY.panel.revoked);
  });

  it('says so when the extension is gone, and when there is no tab to follow', async () => {
    const gone = createFakeWorker();
    gone.platform.invalidate();
    expect((await open(gone, 5)).textContent).toContain(COPY.panel.extensionGone);

    const noTab = createFakeWorker({ activeTabId: null });
    const root = await open(noTab, null);
    expect(root.textContent).toContain(COPY.panel.noTab);
    expect(button(root, COPY.panel.fill)).toBeNull();
    await vi.waitFor(() => expect(noTab.sentOfType('panel/reports')).toEqual([]));
  });
});
