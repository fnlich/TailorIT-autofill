/*
 * v5 p1-panel (PLAN decision 6): the main view's modals. What stopped Autofill (no application form, the page's form not
 * reachable now, a failure, the extension updated under an on-page panel) opens a modal centred over the panel with
 * Cancel and Try Again (Refresh Page for an update, where the host can reload its page); the autofill information's
 * check (no work experience or no education) holds a fill in a modal with Edit Autofill Information and Autofill
 * Anyway. The modals' actions wait CONTROL_SEEN_MS, as the main button does; the focus stays inside; Escape closes.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { adoptPageStyles } from '../page/styles';
import {
  click, completeProfile, createFakeWorker, formPage, frameReport, manualClock, mount, SEEN_AT_ONCE, settle, unmountAll,
  type FakeWorker,
} from '../ui.testkit';
import { Panel } from './Panel';
import { historyGaps } from './profile-check';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';

async function open(worker: FakeWorker, options: { refresh?: () => void; clock?: SeenClock } = {}): Promise<HTMLElement> {
  adoptPageStyles(document);
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={options.clock ?? SEEN_AT_ONCE}
    {...(options.refresh === undefined ? {} : { refreshPage: options.refresh })} />);
  await settle();
  return root;
}

const modalOf = (root: ParentNode) => root.querySelector<HTMLElement>('.tia-modal');
const action = (root: ParentNode, name: string) => root.querySelector<HTMLButtonElement>(`[data-modal-action="${name}"]`);
const fills = (worker: FakeWorker) => worker.sentOfType('panel/fill');

afterEach(() => unmountAll());

describe('the main view’s modals (v5)', () => {
  it('says no application form was found when the fill reached no frame on a page without one; Try Again asks again', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { support: 'no-form', platform: 'lever', formKey: null, choice: true });
    worker.script.frames = 0;
    const root = await open(worker);
    await click(root.querySelector('button.tia-cta'));
    const modal = modalOf(root)!;
    expect([modal.dataset.modal, modal.dataset.modalReason]).toEqual(['error', 'no-form']);
    const dialog = modal.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(COPY.modals.errors['no-form']);
    // No feedback line beside it: the modal says it.
    expect(root.querySelector('.tia-feedback')).toBeNull();
    // The focus starts on Cancel, inside the modal.
    expect(document.activeElement).toBe(action(root, 'cancel'));
    expect([action(root, 'cancel')?.textContent, action(root, 'retry')?.textContent])
      .toEqual([COPY.modals.cancel, COPY.modals.tryAgain]);
    worker.script.frames = 1;
    await click(action(root, 'retry'));
    expect(fills(worker)).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false },
      { v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    expect(modalOf(root)).toBeNull();
  });

  it('tells a form the fill could not reach from a page with none, and a failure from both; never a refusal the line says', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    worker.script.frames = 0;
    const root = await open(worker);
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)?.dataset.modalReason).toBe('unavailable');
    await click(action(root, 'cancel'));
    expect(modalOf(root)).toBeNull();

    worker.on('panel/fill', () => ({ ok: false, error: 'internal' }));
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)?.dataset.modalReason).toBe('failed');
    expect(modalOf(root)?.textContent).toContain(COPY.modals.errors.failed);
    // Escape closes it.
    await act(async () => {
      modalOf(root)!.querySelector('[role="alertdialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape',
        bubbles: true }));
    });
    expect(modalOf(root)).toBeNull();

    // Not connected and too many fills keep the line under the button.
    worker.on('panel/fill', () => ({ ok: false, error: 'rate_limited', retryAfterSeconds: 10 }));
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)).toBeNull();
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.rateLimited);
  });

  it('says the extension was updated where the host can reload its page, with Refresh Page; else it failed', async () => {
    const refreshes: number[] = [];
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const root = await open(worker, { refresh: () => refreshes.push(1) });
    worker.platform.invalidate();
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)?.dataset.modalReason).toBe('updated');
    expect(action(root, 'retry')).toBeNull();
    expect(action(root, 'refresh')?.textContent).toBe(COPY.modals.refresh);
    await click(action(root, 'refresh'));
    expect(refreshes).toEqual([1]);
    unmountAll();

    // The side panel (no reload of its own): a failure, and its strip says to open it again.
    const side = createFakeWorker();
    side.script.pages.set(5, formPage());
    const panel = await open(side);
    side.platform.invalidate();
    await click(panel.querySelector('button.tia-cta'));
    expect(modalOf(panel)?.dataset.modalReason).toBe('failed');
  });

  it('raises the update modal by itself once the on-page panel’s link is gone for good, once', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const root = await open(worker, { refresh: () => undefined });
    expect(modalOf(root)).toBeNull();
    worker.platform.invalidate();
    await act(async () => worker.ports.at(-1)!.disconnect());
    await settle();
    expect(modalOf(root)?.dataset.modalReason).toBe('updated');
    await click(action(root, 'cancel'));
    expect(modalOf(root)).toBeNull();
    await settle();
    expect(modalOf(root)).toBeNull();
  });

  it('holds a fill when the autofill information has no work experience or education: Edit, or Autofill Anyway', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    worker.script.profile = completeProfile({ experience: [], education: [] });
    const root = await open(worker);
    await click(root.querySelector('button.tia-cta'));
    const modal = modalOf(root)!;
    expect(modal.dataset.modal).toBe('history');
    expect(modal.textContent).toContain(COPY.modals.history.text(['experience', 'education']));
    expect(COPY.modals.history.text(['experience', 'education']))
      .toBe('Your autofill information has no work experience or education. Add them before you autofill?'); // v3.2 EXT
    expect(COPY.modals.history.text(['education'])).toContain('has no education. Add it before');
    expect([historyGaps(completeProfile()), historyGaps(completeProfile({ education: [] }))]).toEqual([[], ['education']]);
    // Nothing went: the fill waits for the person's word.
    expect(fills(worker)).toEqual([]);
    await click(action(root, 'anyway'));
    expect(fills(worker)).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    expect(modalOf(root)).toBeNull();
    // Again, then Edit Autofill Information: the profile editor, whose Back returns to the main view.
    await click(root.querySelector('button.tia-cta'));
    expect(action(root, 'edit')?.textContent).toBe(COPY.modals.history.edit);
    await click(action(root, 'edit'));
    expect(root.querySelector('main')?.dataset.view).toBe('editor');
    expect(fills(worker)).toHaveLength(1);
  });

  it('never holds a Continue, nor a fill whose profile has both', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    const root = await open(worker);
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)).toBeNull();
    expect(fills(worker)).toHaveLength(1);
    unmountAll();
    // A run paused at a hand-off: its Autofill goes on with it, whatever the profile holds.
    const paused = createFakeWorker();
    paused.script.pages.set(5, formPage());
    paused.script.profile = completeProfile({ experience: [] });
    paused.script.reports.set(5, [frameReport(0, { status: 'handoff', pauseReason: 'captcha' })]);
    const panel = await open(paused);
    await click(panel.querySelector('button.tia-cta[data-main-action="continue"]'));
    expect(modalOf(panel)).toBeNull();
    expect(paused.sentOfType('panel/continue')).toEqual([{ v: 1, type: 'panel/continue', tabId: 5 }]);
  });

  it('takes no click on a modal’s action until it has been shown CONTROL_SEEN_MS; Tab stays inside', async () => {
    const clock = manualClock();
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage());
    worker.script.frames = 0;
    const root = await open(worker, { clock });
    clock.at += CONTROL_SEEN_MS;
    await clock.flush();
    await click(root.querySelector('button.tia-cta'));
    expect(modalOf(root)?.dataset.modalReason).toBe('unavailable');
    const retry = action(root, 'retry')!;
    expect(retry.disabled).toBe(true);
    await click(retry);
    expect(fills(worker)).toHaveLength(1);
    clock.at += CONTROL_SEEN_MS - 1;
    await clock.flush();
    expect(action(root, 'retry')!.disabled).toBe(true);
    clock.at += 1;
    await clock.flush();
    expect(action(root, 'retry')!.disabled).toBe(false);
    // Tab from the last button comes back to the first; Shift+Tab from the first goes to the last.
    const dialog = root.querySelector<HTMLElement>('[role="alertdialog"]')!;
    action(root, 'retry')!.focus();
    await act(async () => {
      action(root, 'retry')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(action(root, 'cancel'));
    await act(async () => {
      action(root, 'cancel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(action(root, 'retry'));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
