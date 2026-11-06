/*
 * What the in-page UI's DOM tests share for the audit of 2026-11-06's S-1: waiting until a trusted click on one of our
 * controls counts (seen without a break for CONTROL_SEEN_MS), the auditor's clickjack (a top-layer decoy that hides
 * itself as the pointer comes), and when each trusted click reached the host.
 */
import { expect, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { monotonicNow } from '../../dom/time';
import type { PageUi } from './page-ui';

/** Waits until a trusted click on `el` counts: the watch has seen it, without a break, for CONTROL_SEEN_MS (S-1). */
export async function ready(ui: PageUi, el: Element): Promise<void> {
  await vi.waitFor(() => expect(ui.readyNow(el)).toBe(true), { timeout: 3_000, interval: 25 });
}

/**
 * The audit of 2026-11-06's clickjack (S-1; scratchpad audit-ext-sec/exposure/clickjack.mjs): the page's own decoy
 * ("Chat with us") in the top layer over `target`, so a person sees only the decoy; it hides itself as the pointer
 * comes onto it, so the click aimed at the decoy lands on our control, which the watch has seen again only a moment
 * before. Resolves once the watch says the control shows again, with the time the decoy went (monotonic ms).
 */
export async function uncoveredAsThePointerComes(ui: PageUi, target: Element): Promise<number> {
  const doc = target.ownerDocument;
  const box = target.getBoundingClientRect();
  const decoy = doc.createElement('div');
  decoy.dataset.testRoot = '';
  decoy.setAttribute('popover', 'manual');
  decoy.textContent = 'Chat with us';
  decoy.style.cssText = `position:fixed;inset:auto;margin:0;padding:0;border:0;left:${box.left - 12}px;`
    + `top:${box.top - 12}px;width:${box.width + 24}px;height:${box.height + 24}px;background:#2a7;color:#fff`;
  doc.body.append(decoy);
  // The pointer starts away from it, as a person's comes from elsewhere on the page.
  await userEvent.hover(doc.documentElement, { force: true, position: { x: 2, y: 2 } });
  decoy.showPopover();
  await vi.waitFor(() => expect(ui.visibleNow(target)).toBe(false));
  let gone = Number.NaN;
  decoy.addEventListener('mouseenter', () => {
    decoy.hidePopover();
    gone = monotonicNow();
  }, { once: true });
  await userEvent.hover(decoy, { force: true });
  await vi.waitFor(() => expect(Number.isNaN(gone)).toBe(false));
  await vi.waitFor(() => expect(ui.visibleNow(target)).toBe(true), { interval: 10 });
  return gone;
}

/** When each trusted click reached the host (monotonic ms), recorded in the capture phase as it is dispatched. */
export function clickTimes(ui: PageUi): number[] {
  const times: number[] = [];
  ui.host.addEventListener('click', (event) => {
    if (event.isTrusted) times.push(monotonicNow());
  }, { capture: true });
  return times;
}
