import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageState } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, formPage, frameReport, manualClock, mount, PROFILE_SENTINELS, row,
  SEEN_AT_ONCE, settle, unfoldRows, unmountAll, type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { RECONNECTS } from './reports';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';
import { pinnedTabOf } from './tab';

const keysShown = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('li[data-field-key]')].map((each) => each.dataset.fieldKey);
/** What the page sent other than its reads: the messages its buttons sent. */
const actions = (worker: FakeWorker) => worker.platform.sent.filter((message) =>
  !['panel/reports', 'auth/status', 'settings/get', 'agent/status', 'panel/profile'].includes(String((message as { type?: unknown }).type)));
const watches = (worker: FakeWorker) => worker.posted.filter((message) => (message as { type?: unknown }).type === 'panel/watch');

async function open(worker: FakeWorker, pinnedTabId: number | null, now?: () => number,
  seenClock: SeenClock = SEEN_AT_ONCE): Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={pinnedTabId} now={now} seenClock={seenClock} />);
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
    // The browser's side panel says so in its watch (v3 Phase 3: the tab's launcher hides while it shows the tab).
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 3, side: true }]);
    expect(keysShown(root)).toEqual(['on-three']);
    expect(root.querySelector('main')?.dataset.tabId).toBe('3');

    await act(async () => worker.platform.activate(4));
    await settle();
    expect(worker.sentOfType('panel/reports').map((message) => message.tabId)).toEqual([3, 4]);
    expect(watches(worker)).toEqual([{ v: 1, type: 'panel/watch', tabId: 3, side: true },
      { v: 1, type: 'panel/watch', tabId: 4, side: true }]);
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

  it('has one main button: Autofill sends panel/fill, or panel/continue while a run waits; Cancel only on the progress (v4 ui)', async () => {
    const worker = createFakeWorker();
    worker.script.frames = 2;
    // Before any run: Autofill alone, no Dry run, Continue or Cancel.
    const before = await open(createFakeWorker(), 5);
    expect(button(before, COPY.panel.fill)!.disabled).toBe(false);
    for (const gone of [COPY.panel.dryRun, COPY.panel.continue, COPY.panel.cancel]) expect(button(before, gone)).toBeNull();
    unmountAll();
    // A run at review waits for nothing: Autofill fills again.
    worker.script.reports.set(5, [frameReport(0, { status: 'review' })]);
    const resting = await open(worker, 5);
    expect(resting.querySelector<HTMLElement>('.tia-cta')?.dataset.mainAction).toBe('fill');
    await click(button(resting, COPY.panel.fill));
    expect(resting.textContent).toContain(COPY.panel.started(2));
    unmountAll();
    // A run that waits to go on: the same Autofill sends panel/continue (its label stays).
    worker.script.reports.set(5, [frameReport(0, { status: 'handoff', pauseReason: 'page-busy' })]);
    const root = await open(worker, 5);
    expect(root.querySelector<HTMLElement>('.tia-cta')?.dataset.mainAction).toBe('continue');
    await click(button(root, COPY.panel.fill));
    expect(root.textContent).toContain(COPY.panel.continued(2));
    unmountAll();
    // A run that works: the button spins and waits; Cancel is the progress line's.
    worker.script.reports.set(5, [frameReport(0, { status: 'fill-step', fields: [row('a', { wrote: false })],
      filling: { current: 'a', pending: ['a'] } })]);
    const working = await open(worker, 5);
    const main = working.querySelector<HTMLButtonElement>('.tia-cta')!;
    expect([main.disabled, main.dataset.working, main.querySelector('svg.tia-spin') !== null]).toEqual([true, 'true', true]);
    await click(working.querySelector('.tia-progress-line button[data-action="cancel"]'));
    expect(working.textContent).toContain(COPY.panel.cancelled(2));
    expect(actions(worker)).toEqual([
      { v: 1, type: 'panel/fill', tabId: 5, dryRun: false },
      { v: 1, type: 'panel/continue', tabId: 5 },
      { v: 1, type: 'panel/cancel', tabId: 5 },
    ].map((message) => expect.objectContaining(message)));
  });

  it('reads "Sign up & Autofill" while the tab\'s form shows an account wall, and sends panel/fill with signIn (v4 ui)', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage({ wall: 'create-account' }));
    // Even with a run waiting at the sign-in: the wall's button signs up.
    worker.script.reports.set(5, [frameReport(0, { status: 'auth-needed' })]);
    const root = await open(worker, 5);
    expect(button(root, COPY.panel.fill)).toBeNull();
    const main = button(root, COPY.mainView.signUpFill)!;
    expect(main.dataset.mainAction).toBe('sign-up');
    // Its explanation is the "?" beside it.
    expect(root.querySelector('.tia-toolbar [data-helptip] [role="tooltip"]')?.textContent).toBe(COPY.mainView.signUpHelp);
    await click(main);
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false, signIn: true }]);
    // No wall: Autofill again.
    worker.script.pages.set(5, formPage());
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0)], page: formPage() }));
    await settle();
    expect(button(root, COPY.panel.fill)).not.toBeNull();
  });

  it('takes no click on the main button until what it says has been shown CONTROL_SEEN_MS, then sends what it shows (the v4 review, L4)', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const clock = manualClock();
    const root = await open(worker, 5, undefined, clock);
    const main = () => root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    const shown = () => [main().textContent, main().dataset.mainAction, main().disabled];
    const runs = () => [...worker.sentOfType('panel/fill'), ...worker.sentOfType('panel/continue')];
    /** Moves the clock to `at` and runs the frames due. */
    const to = async (at: number) => {
      clock.at = at;
      await clock.flush();
    };
    // Newly drawn: Autofill, which a click does nothing on until it has been shown CONTROL_SEEN_MS.
    expect(shown()).toEqual([COPY.panel.fill, 'fill', true]);
    await click(main());
    await to(CONTROL_SEEN_MS - 1);
    await click(main());
    expect(runs()).toEqual([]);
    await to(CONTROL_SEEN_MS);
    expect(shown()).toEqual([COPY.panel.fill, 'fill', false]);

    // The page shows a password box: the button now reads Sign up & Autofill and refuses at once, the person's click
    // aimed at Autofill included, until the new label has been shown CONTROL_SEEN_MS.
    const wallAt = 1_000;
    clock.at = wallAt;
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: formPage({ wall: 'sign-in' }) }));
    await settle();
    expect(shown()).toEqual([COPY.mainView.signUpFill, 'sign-up', true]);
    await click(main());
    await to(wallAt + CONTROL_SEEN_MS - 1);
    await click(main());
    expect(runs()).toEqual([]);
    // The page takes it away again: Autofill, shown afresh, waits again (a meaning shown before counts for nothing).
    const goneAt = wallAt + CONTROL_SEEN_MS - 1;
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: formPage() }));
    await settle();
    expect(shown()).toEqual([COPY.panel.fill, 'fill', true]);
    await to(goneAt + CONTROL_SEEN_MS - 1);
    await click(main());
    expect(runs()).toEqual([]);
    // And back: shown long enough, the click sends what the button shows.
    const backAt = goneAt + CONTROL_SEEN_MS;
    clock.at = backAt;
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: formPage({ wall: 'sign-in' }) }));
    await settle();
    expect(shown()).toEqual([COPY.mainView.signUpFill, 'sign-up', true]);
    await to(backAt + CONTROL_SEEN_MS);
    expect(shown()).toEqual([COPY.mainView.signUpFill, 'sign-up', false]);
    await click(main());
    expect(runs()).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false, signIn: true }]);

    // A run that pauses: the same label, a new meaning (Continue), which waits too.
    const pausedAt = backAt + 5_000;
    clock.at = pausedAt;
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5,
      reports: [frameReport(0, { status: 'handoff', pauseReason: 'page-busy', updatedAt: 9 })], page: formPage() }));
    await settle();
    expect(shown()).toEqual([COPY.panel.fill, 'continue', true]);
    await click(main());
    await to(pausedAt + CONTROL_SEEN_MS);
    await click(main());
    expect(runs().slice(1)).toEqual([{ v: 1, type: 'panel/continue', tabId: 5 }]);
  });

  it('offers Autofill on a posting page whose application frame shows an entry choice; a wall there signs up (the v4 review, M4)', async () => {
    const worker = createFakeWorker();
    const posting: PageState = { support: 'no-form', platform: 'workday', formKey: null, posting: true };
    worker.script.pages.set(5, posting);
    const root = await open(worker, 5);
    // A posting alone: no Autofill, and the strip says why.
    expect(root.querySelector('button.tia-cta')).toBeNull();
    expect(root.querySelector('[data-strip="no-form"]')?.textContent).toBe(COPY.strip.noForm);
    // Workday's "Start Your Application" (its address read as the posting's): Autofill, a plain fill, which presses the
    // declared entry; nothing says there is no form to fill.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: { ...posting, choice: true } }));
    await settle();
    const main = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect([main.textContent, main.dataset.mainAction, main.disabled]).toEqual([COPY.panel.fill, 'fill', false]);
    expect(root.querySelector('[data-strip]')).toBeNull();
    await click(main);
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    // Even where a run of the tab waits to go on: the choice's Autofill is a fill.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5,
      reports: [frameReport(0, { status: 'handoff', pauseReason: 'entry-choice' })], page: { ...posting, choice: true } }));
    await settle();
    expect(root.querySelector<HTMLElement>('button.tia-cta')?.dataset.mainAction).toBe('fill');
    await click(button(root, COPY.panel.fill));
    expect(worker.sentOfType('panel/fill')).toHaveLength(2);
    expect(worker.sentOfType('panel/continue')).toEqual([]);
    // An account wall there wins: Sign up & Autofill.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { ...posting, choice: true, wall: 'create-account' } }));
    await settle();
    expect(root.querySelector<HTMLElement>('button.tia-cta')?.dataset.mainAction).toBe('sign-up');
    await click(button(root, COPY.mainView.signUpFill));
    expect(worker.sentOfType('panel/fill').at(-1)).toEqual({ v: 1, type: 'panel/fill', tabId: 5, dryRun: false, signIn: true });
    // The page after submitting keeps its card without Autofill, whatever it shows.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'no-form', platform: 'workday', formKey: null, confirmation: true, choice: true } }));
    await settle();
    expect(root.querySelector('button.tia-cta')).toBeNull();
  });
  it("sends Show on page from a row's label, with no drawer, no policy card and no notice (v4 ui, D1 and D10)", async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(2, { status: 'policy-notice', notices: [{ code: 'policy' }, { code: 'tripwire' }],
      fields: [row('degree', { status: 'flagged', provenance: null, matcherStage: 'none', reason: 'ambiguous-options',
        detail: { suggestions: [{ index: 1, score: 0.8 }] } })] })]);
    const root = await open(worker, 5);
    await click(root.querySelector('li[data-field-key="degree"] button.tia-row__go'));
    expect(root.querySelector('li[data-field-key="degree"] button.tia-row__toggle')).toBeNull();
    expect(root.querySelector('[data-notice]')).toBeNull();
    expect(button(root, COPY.policyFillAnyway)).toBeNull();
    expect(actions(worker)).toEqual([{ v: 1, type: 'panel/focus', tabId: 5, frameId: 2, fieldKey: 'degree' }]);
  });
  it('offers no Confirm draft and no Save my answer on any row (v4 ui, D6)', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(3, { platform: 'greenhouse', adapter: 'greenhouse', fields: [
      row('why', { kind: 'textarea', category: 'freeText.whyCompany', status: 'flagged', provenance: 'llm-draft',
        reason: 'llm-draft-needs-confirmation', needsUserAction: true }),
      row('notice', { category: 'screening.other', status: 'flagged', provenance: null, reason: 'unknown-field',
        needsUserAction: true, wrote: false, detail: { userEdited: true } }),
    ] })]);
    const root = await open(worker, 5);
    await unfoldRows(root);
    expect(button(root, COPY.report.confirmDraft)).toBeNull();
    expect(button(root, COPY.report.saveAnswer)).toBeNull();
    expect(actions(worker)).toEqual([]);
  });
  it('says why a button did nothing, and reads the connection again when it was not connected', async () => {
    const worker = createFakeWorker();
    worker.on('panel/fill', () => ({ ok: false, error: 'not_connected' }));
    const root = await open(worker, 5);
    const reads = worker.sentOfType('auth/status').length;
    await click(button(root, COPY.panel.fill));
    expect(root.textContent).toContain(COPY.panel.needsConnection);
    expect(worker.sentOfType('auth/status').length).toBe(reads + 1);
    unmountAll();
    // A run that waits to go on, which by then reaches no frame.
    worker.script.reports.set(5, [frameReport(0, { status: 'handoff', pauseReason: 'page-busy' })]);
    worker.on('panel/continue', () => ({ ok: true, data: { frames: 0 } }));
    const paused = await open(worker, 5);
    await click(button(paused, COPY.panel.fill));
    expect(paused.textContent).toContain(COPY.panel.continued(0));
  });
  it('fills a new step the run rests on under Autofill after page turn: Manually, from the same Autofill (the v4 review, H1)', async () => {
    const worker = createFakeWorker();
    // What the run sends after the person's Next under Manually (content/steps.browser.test.ts): the new step at
    // review, nothing read on it, and no page-turned notice (v4, D7: never raised); the run's own notices stay.
    worker.script.reports.set(5, [frameReport(0, { status: 'review', fields: [], notices: [{ code: 'tripwire' }] })]);
    const root = await open(worker, 5);
    const main = button(root, COPY.panel.fill)!;
    expect([main.disabled, main.dataset.mainAction]).toEqual([false, 'fill']);
    await click(main);
    // A plain Autofill: the run resting after the page turn takes it as going on there (the worker's run/start).
    expect(actions(worker)).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    // No "0/0 fields filled · 0%" for a step nothing was read on.
    expect(root.querySelector('.tia-progress-line')).toBeNull();
    expect(root.textContent).not.toContain('0%');
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

  it('shows what blocks everything as a strip; the connection itself is the set-up view and the Settings view (v4 ui)', async () => {
    const connected = createFakeWorker();
    const shown = await open(connected, 5);
    // No foot: the account shows in Settings.
    expect(shown.querySelector('.tia-panel__foot, [data-tailorit-link="jobs"]')).toBeNull();
    await click(shown.querySelector('button[data-panel-settings]'));
    expect(shown.querySelector('.tia-settings [data-connection]')?.textContent).toBe(COPY.panel.connectedAs('Morgan Lee'));

    const blocked = createFakeWorker();
    blocked.script.auth = authStatus({ storageAccess: 'refused', versionMismatch: true });
    const problem = await open(blocked, 5);
    const line = problem.querySelector('.tia-connection--problem')!;
    for (const text of [COPY.panel.storageRefused, COPY.panel.versionMismatch]) expect(line.textContent).toContain(text);
    expect(line.querySelector('a')?.getAttribute('href')).toBe('chrome-extension://memory-extension/options.html');

    // Not connected, expired or revoked: the set-up view's first step, its reason in the step's "?".
    const revoked = createFakeWorker();
    revoked.script.auth = authStatus({ connection: 'revoked', account: null });
    const setup = await open(revoked, 5);
    expect(setup.querySelector('main')?.dataset.view).toBe('setup');
    expect(setup.querySelector('[data-step="account"] [role="tooltip"]')?.textContent).toContain(COPY.setup.accountRevoked);
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

describe('the auto-apply agent’s status in the side panel (v3 Phase 5)', () => {
  it('shows nothing while off; while on, its value-free line with Stop and TailorIT’s page, read again at each change', async () => {
    const worker = createFakeWorker();
    const root = await open(worker, 5);
    expect(root.querySelector('[data-agent]')).toBeNull();
    worker.script.agent = { on: true, confirmed: true, phase: 'running', blocked: null, allowed: true, pending: false,
      job: { company: 'Northwind', title: 'Senior Backend Engineer' }, doneToday: 2,
      last: { state: 'needs-you', reason: 'captcha' } };
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'agent' }));
    await settle();
    const strip = root.querySelector<HTMLElement>('[data-agent="running"]')!;
    expect(strip.querySelector('[data-agent-line]')?.textContent).toBe('Auto-apply: running Senior Backend Engineer at '
      + 'Northwind · 2 done today · last: Needs you (a check that you are human)');
    expect(strip.querySelector('a[data-tailorit-link="auto-apply"]')?.textContent).toBe(COPY.agent.open);
    await click(strip.querySelector<HTMLButtonElement>('button[data-action="agent-stop"]')!);
    expect(worker.sentOfType('agent/stop')).toEqual([{ v: 1, type: 'agent/stop' }]);
    expect(root.querySelector('[data-agent]')).toBeNull();
  });

  it('stays, off, while a result waits to be told TailorIT, and says so (the v3 Phase 5 review)', async () => {
    const worker = createFakeWorker();
    worker.script.agent = { on: false, confirmed: true, phase: 'off', blocked: null, allowed: true, pending: true,
      job: null, doneToday: 0, last: null };
    const root = await open(worker, 5);
    await settle();
    const strip = root.querySelector<HTMLElement>('[data-agent="off"]')!;
    expect(strip.querySelector('[data-agent-line]')?.textContent)
      .toBe('Auto-apply: off · 0 done today · a result not yet told TailorIT');
    expect(strip.querySelector('button[data-action="agent-stop"]')).toBeNull();
  });

  it('stays, off, while the agent paused itself, and says why (the audit of 2026-11-06, M5 and m14)', async () => {
    const worker = createFakeWorker();
    worker.script.agent = { on: false, confirmed: true, phase: 'off', blocked: null, paused: 'window-closed',
      allowed: true, pending: false, job: null, doneToday: 1, last: { state: 'needs-you', reason: 'cancelled' } };
    const root = await open(worker, 5);
    await settle();
    const strip = root.querySelector<HTMLElement>('[data-agent="off"]')!;
    expect(strip.querySelector('[data-agent-line]')?.textContent).toBe('Auto-apply: paused because you closed its '
      + 'window; turn Run auto-apply on to go on · 1 done today · last: Needs you (stopped)');
    expect(strip.querySelector('button[data-action="agent-stop"]')).toBeNull();
  });
});
