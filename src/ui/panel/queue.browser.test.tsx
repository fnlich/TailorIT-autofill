/*
 * v1.5 QX (PLAN decisions 9 and 10) over the scripted worker:
 * - the tab bar under the head: a tablist of Autofill and Queue with their icons, the chosen tab aria-selected and alone
 *   in the tab order, each naming its panel; the arrow keys, Home and End choose and focus; Autofill is today's view;
 *   no tab bar in the Settings view;
 * - the Queue tab: the progress bar "x of y", "Next tab in 8.5s" counting down on the clock's frames, why the timer
 *   waits, paused, done and stopped lines; Start or Stop and Pause or Resume, each taking a click only once shown
 *   CONTROL_SEEN_MS; every job with its status chip, a row with an open tab a button to it, a page at a time; the
 *   empty, disconnected and error states; Run auto-apply's lines;
 * - the settings: each radio group's cards side by side, two to a row (2 x 2 for more), the skip rules one per line, in
 *   the panel's Settings view and Options alike; the panel's Settings in the owner's order; the queue's fields saved
 *   with the draft, a value out of bounds refused.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import { Options } from '../options/Options';
import {
  button, click, createFakeWorker, manualClock, mount, queueItem, queueStatus, SEEN_AT_ONCE, settle, typeInto,
  unmountAll, type FakeWorker,
} from '../ui.testkit';
import { Panel } from './Panel';
import { CONTROL_SEEN_MS } from './seen';

const WORDS = COPY.queue;

afterEach(() => unmountAll());

async function open(worker: FakeWorker, clock: Parameters<typeof Panel>[0]['seenClock'] = SEEN_AT_ONCE): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={clock} />);
  await settle();
  return root;
}

const tabs = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tabNamed = (root: ParentNode, name: 'autofill' | 'queue') =>
  root.querySelector<HTMLButtonElement>(`[role="tab"][data-panel-tab="${name}"]`)!;
const control = (root: ParentNode, kind: string) => root.querySelector<HTMLButtonElement>(`button[data-action="queue-${kind}"]`);
const lineOf = (root: ParentNode) => root.querySelector('[data-queue-line]')?.textContent ?? null;

async function key(target: HTMLElement, name: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
  await settle();
}

/** The Queue tab chosen. */
async function queueTab(root: HTMLElement): Promise<HTMLElement> {
  await click(tabNamed(root, 'queue'));
  await settle();
  return root.querySelector<HTMLElement>('[data-queue]')!;
}

describe('the panel’s tab bar (v1.5 QX)', () => {
  it('draws Autofill and Queue under the head as a tablist, Autofill first and chosen, each naming its panel', async () => {
    const root = await open(createFakeWorker());
    const list = root.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe(WORDS.tabs.label);
    // Under the head, before the stage.
    expect(root.querySelector('.tia-panel__head')!.nextElementSibling).toBe(list);
    expect(tabs(root).map((tab) => [tab.textContent, tab.getAttribute('aria-selected'), tab.tabIndex,
      tab.querySelector('svg') !== null])).toEqual([[WORDS.tabs.autofill, 'true', 0, true], [WORDS.tabs.queue, 'false', -1, true]]);
    const autofill = tabNamed(root, 'autofill');
    const panel = document.getElementById(autofill.getAttribute('aria-controls')!)!;
    expect([panel.getAttribute('role'), panel.getAttribute('aria-labelledby')]).toEqual(['tabpanel', autofill.id]);
    // Today's view under it: the main button.
    expect(panel.querySelector('button.tia-cta')).not.toBeNull();
    // The chosen tab in TailorIT's teal on white, the other grey on the bar's track.
    expect([getComputedStyle(autofill).color, getComputedStyle(autofill).backgroundColor])
      .toEqual(['rgb(8, 117, 140)', 'rgb(255, 255, 255)']);
    expect(getComputedStyle(tabNamed(root, 'queue')).color).toBe('rgb(102, 102, 102)');
    expect(getComputedStyle(list).backgroundColor).toBe('rgb(242, 242, 242)');
  });

  it('moves with the arrow keys, Home and End, choosing and focusing; a click chooses too', async () => {
    const root = await open(createFakeWorker());
    const autofill = tabNamed(root, 'autofill');
    autofill.focus();
    await key(autofill, 'ArrowRight');
    expect(tabNamed(root, 'queue').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabNamed(root, 'queue'));
    expect(root.querySelector('[data-queue]')).not.toBeNull();
    expect(root.querySelector('button.tia-cta')).toBeNull();
    const queuePanel = document.getElementById(tabNamed(root, 'queue').getAttribute('aria-controls')!)!;
    expect([queuePanel.getAttribute('role'), queuePanel.getAttribute('aria-labelledby')])
      .toEqual(['tabpanel', tabNamed(root, 'queue').id]);
    // Wraps around.
    await key(tabNamed(root, 'queue'), 'ArrowRight');
    expect(document.activeElement).toBe(tabNamed(root, 'autofill'));
    await key(tabNamed(root, 'autofill'), 'ArrowLeft');
    expect(document.activeElement).toBe(tabNamed(root, 'queue'));
    await key(tabNamed(root, 'queue'), 'Home');
    expect([document.activeElement, tabNamed(root, 'autofill').getAttribute('aria-selected')])
      .toEqual([tabNamed(root, 'autofill'), 'true']);
    await key(tabNamed(root, 'autofill'), 'End');
    expect(tabNamed(root, 'queue').getAttribute('aria-selected')).toBe('true');
    // Another key does nothing.
    await key(tabNamed(root, 'queue'), 'a');
    expect(tabNamed(root, 'queue').getAttribute('aria-selected')).toBe('true');
    await click(tabNamed(root, 'autofill'));
    expect(root.querySelector('button.tia-cta')).not.toBeNull();
    // Not in the Settings view.
    await click(root.querySelector('button[data-panel-settings]'));
    expect(root.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe('the Queue tab (v1.5 QX)', () => {
  it('lists TailorIT’s queued jobs before a run, “0 of y”, and Start once it has been shown long enough', async () => {
    const worker = createFakeWorker();
    worker.script.queue.items = [1, 2, 3].map((n) => queueItem(n));
    const clock = manualClock();
    const root = await open(worker, clock);
    const view = await queueTab(root);
    expect(view.dataset.queue).toBe('idle');
    expect(root.querySelector('[data-queue-progress]')?.textContent).toBe('0 of 3');
    const bar = root.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuetext')])
      .toEqual(['0', '3', '0 of 3']);
    expect(lineOf(root)).toBe(WORDS.idle(3));
    expect([...root.querySelectorAll('.tia-queue__row')].map((row) => [row.querySelector('.tia-queue__jobtitle')?.textContent,
      row.querySelector('.tia-queue__company')?.textContent, row.querySelector('.tia-queue__chip')?.textContent]))
      .toEqual([1, 2, 3].map((n) => [`Engineer ${n}`, 'Northwind', WORDS.statuses.queued]));
    // No tab yet: no row is a button.
    expect(root.querySelector('button[data-action="queue-focus"]')).toBeNull();
    // Start: not until shown CONTROL_SEEN_MS (a page cannot swap it in under the pointer).
    expect(control(root, 'start')!.disabled).toBe(true);
    await click(control(root, 'start'));
    clock.at = CONTROL_SEEN_MS - 1;
    await clock.flush();
    await click(control(root, 'start'));
    expect(worker.sentOfType('queue/start')).toEqual([]);
    clock.at = CONTROL_SEEN_MS;
    await clock.flush();
    expect(control(root, 'start')!.disabled).toBe(false);
    // Pause is out of reach while nothing runs.
    expect(control(root, 'pause')!.disabled).toBe(true);
    await click(control(root, 'start'));
    await settle();
    expect(worker.sentOfType('queue/start')).toEqual([{ v: 1, type: 'queue/start' }]);
    // Stop now, held CONTROL_SEEN_MS again before it takes a click.
    expect(control(root, 'start')).toBeNull();
    expect([control(root, 'stop')!.textContent, control(root, 'stop')!.disabled]).toEqual([WORDS.stop, true]);
    await click(control(root, 'stop'));
    expect(worker.sentOfType('queue/stop')).toEqual([]);
  });

  it('counts the seconds to the next tab down, live, and says why the timer waits, paused, done or stopped', async () => {
    const worker = createFakeWorker();
    worker.script.queue = { source: 'run', items: [queueItem(1, { status: 'filling', tab: true }), queueItem(2)],
      status: queueStatus({ phase: 'running', total: 2, opened: 1, nextInMs: 8_500, openTabs: 1,
        counts: { ...queueStatus().counts, queued: 1, filling: 1 } }) };
    const clock = manualClock();
    const root = await open(worker, clock);
    await queueTab(root);
    expect(lineOf(root)).toBe('Next tab in 8.5s');
    expect(root.querySelector('[data-queue-progress]')?.textContent).toBe('1 of 2');
    expect(root.querySelector('[data-queue-counts]')?.textContent).toBe('Filling 1');
    clock.at += 2_000;
    await clock.flush();
    expect(lineOf(root)).toBe('Next tab in 6.5s');
    clock.at += 6_450;
    await clock.flush();
    expect(lineOf(root)).toBe('Next tab in 0.1s');
    // The screen reader's status never says the seconds.
    expect(root.querySelector('[data-queue-status]')?.textContent).toBe(WORDS.live('running', 1, 2));
    expect(root.querySelector('[data-queue-line]')?.getAttribute('aria-live')).toBe('off');
    // Held at the cap, paused, done, stopped: each says so.
    const states = [
      [queueStatus({ phase: 'running', hold: 'cap', nextInMs: 9_000, openTabs: 5, total: 9, opened: 5 }), WORDS.held.cap(5, 9_000)],
      [queueStatus({ phase: 'running', hold: 'offline', nextInMs: 0, total: 9, opened: 5 }), WORDS.held.offline],
      [queueStatus({ phase: 'paused', nextInMs: 4_200, total: 9, opened: 5 }), WORDS.paused(4_200)],
      [queueStatus({ phase: 'running', nextInMs: null, openTabs: 2, total: 9, opened: 9 }), WORDS.allOpened(2)],
      [queueStatus({ phase: 'finished', total: 9, opened: 9 }), WORDS.finished],
      [queueStatus({ phase: 'stopped', stoppedBy: 'agent', total: 9, opened: 5 }), WORDS.stopped.agent],
    ] as const;
    for (const [status, line] of states) {
      worker.script.queue.status = status;
      await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'queue' }));
      await settle();
      expect(lineOf(root)).toBe(line);
    }
    expect(WORDS.paused(4_200)).toBe('Paused · the next tab opens 4.2s after Resume');
  });

  it('pauses and resumes, each control held until shown long enough', async () => {
    const worker = createFakeWorker();
    worker.script.queue = { source: 'run', items: [queueItem(1, { status: 'opened', tab: true })],
      status: queueStatus({ phase: 'running', total: 2, opened: 1, nextInMs: 5_000 }) };
    const root = await open(worker);
    await queueTab(root);
    expect(control(root, 'pause')!.textContent).toBe(WORDS.pause);
    await click(control(root, 'pause'));
    await settle();
    expect(worker.sentOfType('queue/pause')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('[data-queue]')!.dataset.queue).toBe('paused');
    expect(control(root, 'pause')).toBeNull();
    await click(control(root, 'resume'));
    await settle();
    expect(worker.sentOfType('queue/resume')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('[data-queue]')!.dataset.queue).toBe('running');
  });

  it('shows each job’s status chip and why it was skipped or failed; a row with an open tab brings it to the front', async () => {
    const worker = createFakeWorker();
    worker.script.queue = { source: 'run', status: queueStatus({ phase: 'running', total: 4, opened: 4 }), items: [
      queueItem(1, { status: 'submitted' }), queueItem(2, { status: 'ready', tab: true }),
      queueItem(3, { status: 'failed', reason: 'page_error', tab: true }), queueItem(4, { status: 'skipped', reason: 'cancelled' })] };
    const root = await open(worker);
    await queueTab(root);
    const rows = [...root.querySelectorAll<HTMLElement>('.tia-queue__row')];
    expect(rows.map((row) => [row.dataset.queueRow, row.querySelector<HTMLElement>('.tia-queue__chip')?.dataset.tone,
      row.querySelector('.tia-queue__why')?.textContent ?? null])).toEqual([['submitted', 'success', null],
      ['ready', 'warning', null], ['failed', 'danger', COPY.agent.reasons.page_error],
      ['skipped', 'neutral', COPY.agent.reasons.cancelled]]);
    const focusable = [...root.querySelectorAll<HTMLButtonElement>('button[data-action="queue-focus"]')];
    expect(focusable.map((each) => each.getAttribute('aria-label'))).toEqual([
      WORDS.row('Engineer 2', 'Northwind', WORDS.statuses.ready, true),
      WORDS.row('Engineer 3', 'Northwind', `${WORDS.statuses.failed}, ${COPY.agent.reasons.page_error}`, true)]);
    await click(focusable[0]);
    expect(worker.sentOfType('queue/focus')).toEqual([{ v: 1, type: 'queue/focus', id: queueItem(2).id }]);
    // The chips' colours: the tones' own.
    const chip = rows[0]!.querySelector('.tia-queue__chip')!;
    expect([getComputedStyle(chip).color, getComputedStyle(chip).backgroundColor])
      .toEqual(['rgb(2, 112, 60)', 'rgb(214, 249, 233)']);
  });

  it('lists a page at a time, Show More reading the next', async () => {
    const worker = createFakeWorker();
    worker.script.queue.items = Array.from({ length: 120 }, (_, n) => queueItem(n + 1));
    const root = await open(worker);
    await queueTab(root);
    expect(root.querySelectorAll('.tia-queue__row')).toHaveLength(50);
    await click(root.querySelector('button[data-action="queue-more"]'));
    await settle();
    expect(root.querySelectorAll('.tia-queue__row')).toHaveLength(100);
    await click(root.querySelector('button[data-action="queue-more"]'));
    await settle();
    expect(root.querySelectorAll('.tia-queue__row')).toHaveLength(120);
    expect(root.querySelector('button[data-action="queue-more"]')).toBeNull();
    expect(worker.sentOfType('queue/list').map((message) => message.offset)).toContain(100);
  });

  it('says when nothing is queued, when this browser is not connected, and when the queue could not be read', async () => {
    const empty = createFakeWorker();
    let root = await open(empty);
    await queueTab(root);
    expect(root.querySelector('[data-queue-empty]')?.textContent).toContain(WORDS.empty);
    expect(root.querySelector('[data-queue-empty] a[data-tailorit-link="auto-apply"]')).not.toBeNull();
    expect(control(root, 'start')!.disabled).toBe(true);
    unmountAll();

    const offline = createFakeWorker();
    offline.script.queue.status = queueStatus({ blocked: 'not-connected' });
    offline.on('queue/list', () => ({ ok: false, error: 'not_connected' }));
    root = await open(offline);
    await queueTab(root);
    expect(root.querySelector('[data-queue-note="blocked"]')?.textContent).toBe(WORDS.blocked['not-connected']);
    expect(control(root, 'start')).toBeNull();
    expect(root.querySelector('.tia-queue__list, [data-queue-empty]')).toBeNull();
    unmountAll();

    const broken = createFakeWorker();
    let fail = true;
    broken.script.queue.items = [queueItem(1)];
    broken.on('queue/list', (message) => (fail ? { ok: false, error: 'unavailable' }
      : { ok: true, data: { source: 'queue', items: [queueItem(1)], offset: message.offset, total: 1, more: false } }));
    root = await open(broken);
    await queueTab(root);
    expect(root.querySelector('[data-queue-empty="error"]')?.textContent).toContain(WORDS.readFailed);
    fail = false;
    await click(root.querySelector('button[data-action="queue-retry"]'));
    await settle();
    expect(root.querySelectorAll('.tia-queue__row')).toHaveLength(1);
  });

  it('says Run auto-apply is on (Start turns it off), and that Start turned it off', async () => {
    const worker = createFakeWorker();
    worker.script.queue.items = [queueItem(1)];
    worker.script.queue.status = queueStatus({ agentOn: true });
    const root = await open(worker);
    await queueTab(root);
    expect(root.querySelector('[data-queue-note="agent-on"]')?.textContent).toBe(WORDS.agentOn);
    worker.script.queue.status = queueStatus({ phase: 'running', agentStopped: true, total: 1, opened: 1 });
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'queue' }));
    await settle();
    expect(root.querySelector('[data-queue-note="agent-on"]')).toBeNull();
    expect(root.querySelector('[data-queue-note="agent-stopped"]')?.textContent).toBe(WORDS.agentStopped);
    // What Start does, by the settings as they act: its "?".
    expect(root.querySelector('.tia-queue__head [role="tooltip"]')?.textContent).toBe(WORDS.startHelp('auto', 'manual'));
  });
});

describe('the settings’ layout (v1.5 QX, PLAN decision 10)', () => {
  /** The rows a group's cards sit on: their tops, deduplicated. */
  const rowsOf = (group: Element) => [...new Set([...group.querySelectorAll('.tia-radiocard')]
    .map((card) => Math.round(card.getBoundingClientRect().top)))];

  it('puts the panel’s Settings in the owner’s order: All Settings top right, the connection, Autofill Information, Documents, Queue, Autofill', async () => {
    const root = await open(createFakeWorker());
    await click(root.querySelector('button[data-panel-settings]'));
    const settings = root.querySelector<HTMLElement>('[data-settings-view]')!;
    const all = settings.querySelector<HTMLElement>('a[data-open-settings]')!;
    const head = settings.querySelector('.tia-settings__head')!;
    expect(all.parentElement).toBe(head);
    expect(Math.round(all.getBoundingClientRect().right)).toBeGreaterThan(Math.round(head.getBoundingClientRect().right) - 20);
    expect([...settings.querySelectorAll<HTMLElement>('[data-settings-section]')].map((each) => each.dataset.settingsSection))
      .toEqual(['connection', 'autofill-info', 'documents', 'queue', 'autofill']);
    expect(settings.querySelector('[data-settings-section="connection"]')?.textContent).toBe(COPY.panel.connectedAs('Morgan Lee'));
    expect([...settings.querySelectorAll('[data-settings-section] > h3')].map((title) => title.textContent))
      .toEqual([COPY.documents.title, COPY.settingsView.queue, COPY.settingsView.autofill]);
  });

  it('lays each radio group out side by side, two to a row (2 x 2 for more), the skip rules one per line', async () => {
    const root = await open(createFakeWorker());
    await click(root.querySelector('button[data-panel-settings]'));
    const group = (name: string) => root.querySelector(`[data-setting-group="${name}"]`)!;
    // Two choices: one row.
    for (const name of ['queue.autofillOnOpen', 'modes.afterPageTurn', 'modes.submit', 'view']) {
      expect([name, rowsOf(group(name)).length]).toEqual([name, 1]);
    }
    // Five choices: two to a row, three rows; the two of a row side by side, as wide.
    const times = group('modes.notifications');
    expect(rowsOf(times)).toHaveLength(3);
    const [first, second] = [...times.querySelectorAll('.tia-radiocard')].map((card) => card.getBoundingClientRect());
    expect(first!.top).toBe(second!.top);
    expect(first!.right).toBeLessThan(second!.left);
    expect(Math.round(first!.width)).toBe(Math.round(second!.width));
    // The skip rules: a box per line.
    expect(rowsOf(group('modes.agentSkip'))).toHaveLength(3);
  });

  it('keeps the queue’s fields in the draft until Save, and refuses seconds out of bounds', async () => {
    const worker = createFakeWorker();
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    const save = () => root.querySelector<HTMLButtonElement>('button[data-action="save-settings"]')!;
    const duration = root.querySelector<HTMLInputElement>('input[data-setting="queue.durationSec"]')!;
    expect(duration.value).toBe('8');
    expect(root.querySelector('[data-queue-waits]')?.textContent).toBe('Waits: 8 s, 8.5 s, 9 s, 9.5 s …');
    await typeInto(duration, '12.5');
    expect(root.querySelector('[data-queue-waits]')?.textContent).toBe('Waits: 12.5 s, 13 s, 13.5 s, 14 s …');
    const acceleration = root.querySelector<HTMLInputElement>('input[data-setting="queue.accelerationSec"]')!;
    await act(async () => acceleration.focus());
    await typeInto(acceleration, '700');
    // Kept as typed while the box has the focus; refused on leaving it, the draft unchanged.
    expect(acceleration.value).toBe('700');
    await act(async () => acceleration.blur());
    expect(acceleration.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[data-setting-group="queue.accelerationSec"] [role="alert"]')?.textContent)
      .toBe(COPY.options.queue.invalid.accelerationSec);
    await click(root.querySelector('input[data-setting="queue.autofillOnOpen.manual"]'));
    const tabsOpen = root.querySelector<HTMLSelectElement>('select[data-setting="queue.maxOpenTabs"]')!;
    await act(async () => {
      tabsOpen.value = '3';
      tabsOpen.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(worker.sentOfType('settings/save')).toEqual([]);
    await click(save());
    expect(worker.sentOfType('settings/save')[0]!.settings).toMatchObject({ queue: { durationSec: 12.5, accelerationSec: 0.5,
      autofillOnOpen: 'manual', maxOpenTabs: 3 } });
  });

  it('gives Options a Queue card between Documents and Modes, its radio groups side by side too', async () => {
    adoptPageStyles(document);
    const worker = createFakeWorker();
    const root = await mount(<Options platform={worker.platform} />);
    await settle();
    expect([...root.querySelectorAll<HTMLElement>('[data-card]')].map((card) => card.dataset.card).slice(1, 4))
      .toEqual(['documents', 'queue', 'modes']);
    const card = root.querySelector('[data-card="queue"]')!;
    expect(card.querySelector('.tia-card__head [role="tooltip"]')?.textContent).toBe(COPY.options.queue.intro);
    expect(rowsOf(card.querySelector('[data-setting-group="queue.autofillOnOpen"]')!)).toHaveLength(1);
    expect(rowsOf(root.querySelector('[data-card="modes"] [data-setting-group="modes.notifications"]')!)).toHaveLength(3);
    // A choice saves at once, as every Options choice does.
    await click(card.querySelector('input[data-setting="queue.autofillOnOpen.manual"]'));
    expect(worker.sentOfType('settings/save').at(-1)!.settings).toMatchObject({ queue: { autofillOnOpen: 'manual' } });
    expect(button(root, WORDS.start)).toBeNull();
  });
});
