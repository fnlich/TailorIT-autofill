/*
 * v5 p1-panel (PLAN decision 5): "Application Submitted!" over the page (ui/applied.ts): a modal dialog in a closed root
 * of its own, with TailorIT's mark and name, our success drawing, the title and the line, and Go To Application
 * Tracker, which opens TailorIT's tracker inside the person's trusted click once the button has been seen
 * CONTROL_SEEN_MS (S-1), then closes; a click before that, or an untrusted one, does nothing. Escape closes it, Tab stays
 * between its two buttons, a hidden tab shows it when it becomes visible (never after the page goes), and one shows at a
 * time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { appliedShown, showApplied, type AppliedPopup } from './applied';
import { CONTROL_SEEN_MS, createVisibilityWatch, type VisibilityWatch } from './visible';

const TRACKER = 'https://tailorit.test/tracker';

afterEach(() => {
  appliedShown(document)?.remove();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

function open(): { popup: AppliedPopup; opened: string[]; watch: VisibilityWatch } {
  const opened: string[] = [];
  const watch = createVisibilityWatch(window);
  const popup = showApplied(document, { trackerUrl: TRACKER, open: (url) => opened.push(url), watch })!;
  return { popup, opened, watch };
}

/** A person's click on one of the window's controls: through its host, at the control's place. */
async function trustedClick(popup: AppliedPopup, target: Element): Promise<void> {
  const host = popup.host.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  await userEvent.click(popup.host, { force: true, position: { x: at.left - host.left + at.width / 2,
    y: at.top - host.top + at.height / 2 } });
}

async function seen(watch: VisibilityWatch, el: Element): Promise<void> {
  await vi.waitFor(() => expect(watch.shownFor(el, CONTROL_SEEN_MS)).toBe(true), { timeout: 3_000, interval: 25 });
}

describe('the applied popup (v5)', () => {
  it('shows a modal window over the page with the brand, our drawing, the title, the line and the tracker button', () => {
    const { popup } = open();
    expect(popup.dialog.open).toBe(true);
    expect(popup.dialog.matches(':modal')).toBe(true);
    // In a closed root of its own: the page cannot reach it.
    expect(popup.host.shadowRoot).toBeNull();
    expect(popup.dialog.querySelector('h2')?.textContent).toBe(COPY.applied.title);
    expect(popup.dialog.querySelector('p')?.textContent).toBe(COPY.applied.body);
    expect(popup.dialog.querySelector('.name')?.textContent).toBe('TailorIT');
    expect(popup.dialog.querySelectorAll('svg.success circle')).toHaveLength(2);
    expect(popup.tracker.textContent).toBe(COPY.applied.tracker);
    expect(popup.close.getAttribute('aria-label')).toBe(COPY.applied.close);
    const titleId = popup.dialog.getAttribute('aria-labelledby')!;
    expect(popup.dialog.querySelector(`[id="${titleId}"]`)?.textContent).toBe(COPY.applied.title);
    // The focus starts on its close button.
    expect(popup.host.ownerDocument.activeElement).toBe(popup.host);
    // One at a time: another word shows the same window.
    expect(showApplied(document, { trackerUrl: TRACKER })).toBe(popup);
  });

  it('opens the tracker only on a trusted click on a button seen CONTROL_SEEN_MS, then closes', async () => {
    // The watch the window judges its clicks by, held at "not seen long enough" until the test lets it answer, so the
    // refusal does not hang on how fast the click comes (S-1); every question it is asked is kept.
    const real = createVisibilityWatch(window);
    let answering = false;
    const asked: number[] = [];
    const watch: VisibilityWatch = { ...real, shownFor: (el, ms) => {
      asked.push(ms);
      return answering && real.shownFor(el, ms);
    } };
    const opened: string[] = [];
    const popup = showApplied(document, { trackerUrl: TRACKER, open: (url) => opened.push(url), watch })!;
    // A page's untrusted click does nothing.
    popup.tracker.click();
    expect([opened, popup.dialog.open]).toEqual([[], true]);
    // A person's click on a button not seen long enough is refused (S-1), and asked about CONTROL_SEEN_MS.
    await trustedClick(popup, popup.tracker);
    expect(opened).toEqual([]);
    expect(popup.dialog.open).toBe(true);
    expect(asked).toEqual([CONTROL_SEEN_MS]);
    answering = true;
    await seen(watch, popup.tracker);
    await trustedClick(popup, popup.tracker);
    expect(opened).toEqual([TRACKER]);
    await popup.closed;
    expect([popup.dialog.open, popup.host.isConnected, appliedShown(document)]).toEqual([false, false, null]);
  });

  it('closes on its ×, once seen, and on Escape', async () => {
    const first = open();
    await seen(first.watch, first.popup.close);
    await trustedClick(first.popup, first.popup.close);
    await first.popup.closed;
    expect(first.opened).toEqual([]);
    const second = open();
    await userEvent.keyboard('{Escape}');
    await second.popup.closed;
    expect(second.popup.host.isConnected).toBe(false);
  });

  it('keeps Tab between its two buttons', async () => {
    const { popup } = open();
    const root = popup.close.getRootNode() as ShadowRoot;
    expect(root.activeElement).toBe(popup.close);
    await userEvent.keyboard('{Tab}');
    expect(root.activeElement).toBe(popup.tracker);
    await userEvent.keyboard('{Tab}');
    expect(root.activeElement).toBe(popup.close);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(root.activeElement).toBe(popup.tracker);
  });

  it('waits for a hidden tab to be visible, and shows nothing once the page went', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    expect(showApplied(document, { trackerUrl: TRACKER })).toBeNull();
    expect(appliedShown(document)).toBeNull();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(appliedShown(document)?.dialog.open).toBe(true);
    appliedShown(document)!.remove();

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    expect(showApplied(document, { trackerUrl: TRACKER })).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(appliedShown(document)).toBeNull();
  });
});
